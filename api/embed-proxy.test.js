const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const vm = require("node:vm");
const { URL } = require("node:url");
const {
  stripAdScripts,
  sanitizeEmbedHtml,
  ULTIMATE_AD_SHIELD,
  handleEmbedProxy,
} = require("./embed-proxy.js");

test("stripAdScripts removes ad-network scripts by src but keeps inline page scripts", () => {
  const dirtyHtml = `
    <html><head>
      <script src="https://example.com/safe.js"></script>
      <script src="https://popcash.net/show.js"></script>
      <script src="https://histats.com/js15.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/disable-devtool"></script>
      <script>function bgImage(){return 1} /* sandbox sbx yandex */</script>
    </head><body>
      <script src="https://www.googletagmanager.com/gtag/js"></script>
    </body></html>`;
  const cleaned = stripAdScripts(dirtyHtml);
  assert.ok(cleaned.includes("https://example.com/safe.js"));
  assert.ok(!cleaned.includes("popcash.net"));
  assert.ok(!cleaned.includes("histats.com"));
  assert.ok(!cleaned.includes("disable-devtool"));
  assert.ok(!cleaned.includes("googletagmanager.com"));
  assert.ok(cleaned.includes("function bgImage()"), "Inline scripts must be preserved");
});

test("sanitizeEmbedHtml injects base href and shield inside head", () => {
  const out = sanitizeEmbedHtml("<html><head><title>x</title></head><body></body></html>", "https://vidsrc.me");
  assert.ok(out.includes('<base href="https://vidsrc.me/">'));
  assert.ok(out.indexOf('id="ultimate-ad-shield"') > out.indexOf("<head>"));
});

test("ULTIMATE_AD_SHIELD only fakes window.open, blocks _blank anchors and ad scripts", () => {
  const rawJs = ULTIMATE_AD_SHIELD.replace(/<\/?script[^>]*>/gi, "");
  let clicked = 0;
  function Anchor() {}
  Anchor.prototype.click = function () { clicked++; };
  function El() {}
  El.prototype.appendChild = (c) => c;
  const globals = {
    HTMLAnchorElement: Anchor,
    Element: El,
    bgImage: function () { return "ok"; },
  };
  const sandbox = { ...globals, window: {} };
  vm.runInNewContext(rawJs, sandbox);

  const w = sandbox.window.open("https://ad.example");
  assert.equal(w.closed, false);
  w.close();
  assert.equal(w.closed, true);
  assert.equal(typeof w.document.write, "function");

  const blank = new Anchor();
  blank.target = "_blank";
  blank.click();
  assert.equal(clicked, 0, "_blank anchors must not be clicked");
  const normal = new Anchor();
  normal.target = "";
  normal.click();
  assert.equal(clicked, 1);

  const adScript = { tagName: "SCRIPT", src: "https://popads.net/x.js" };
  const okScript = { tagName: "SCRIPT", src: "https://site.example/app.js" };
  const parent = new El();
  assert.equal(parent.appendChild(adScript), adScript);
  assert.equal(parent.appendChild(okScript), okScript);

  assert.equal(sandbox.bgImage(), "ok", "Host globals must remain untouched");
});

test("Embed Proxy HTTP Integration: fetches, cleans, and strips framing headers", async () => {
  const ext = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
    res.end(`<html><head><script src="https://popads.net/banner.js"></script></head><body></body></html>`);
  });
  await new Promise((r) => ext.listen(0, r));
  const extPort = ext.address().port;
  const targetUrl = `http://127.0.0.1:${extPort}/embed/movie/550`;

  const proxy = http.createServer((req, res) => handleEmbedProxy(req, res));
  await new Promise((r) => proxy.listen(0, r));
  const proxyPort = proxy.address().port;

  try {
    const errRes = await fetch(`http://127.0.0.1:${proxyPort}/embed-proxy`);
    assert.equal(errRes.status, 400);

    const res = await fetch(`http://127.0.0.1:${proxyPort}/embed-proxy?url=${encodeURIComponent(targetUrl)}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-frame-options"), null);
    assert.equal(res.headers.get("content-security-policy"), null);
    const html = await res.text();
    assert.ok(html.includes(`<base href="http://127.0.0.1:${extPort}/">`));
    assert.ok(html.includes('id="ultimate-ad-shield"'));
    assert.ok(!html.includes("popads.net"));
  } finally {
    ext.close();
    proxy.close();
  }
});

test("Shield rewrites same-origin-target fetch/XHR through raw proxy and leaves others alone", () => {
  const js = ULTIMATE_AD_SHIELD.split("__TARGET_ORIGIN__").join("https://vidsrc.me").replace(/<\/?script[^>]*>/gi, "");
  const seen = [];
  function XHR() {}
  XHR.prototype.open = function (m, u) { seen.push(u); };
  function Anchor() {}
  Anchor.prototype.click = function () {};
  function El() {}
  El.prototype.appendChild = (c) => c;
  const win = { fetch: (u) => { seen.push(u); return Promise.resolve(); }, XMLHttpRequest: XHR };
  const sandbox = { window: win, XMLHttpRequest: XHR, HTMLAnchorElement: Anchor, Element: El, URL };
  vm.runInNewContext(js, sandbox);

  win.fetch("https://vidsrc.me/vs_src.php?type=movie&id=1");
  win.fetch("/rel/path");
  win.fetch("https://other.example/x");
  new XHR().open("GET", "https://vidsrc.me/cdn-cgi/rum?");
  assert.equal(
    seen[0],
    "/embed-proxy?raw=1&url=" + encodeURIComponent("https://vidsrc.me/vs_src.php?type=movie&id=1"),
  );
  assert.equal(seen[1], "/embed-proxy?raw=1&url=" + encodeURIComponent("https://vidsrc.me/rel/path"));
  assert.equal(seen[2], "https://other.example/x");
  assert.ok(seen[3].startsWith("/embed-proxy?raw=1&url="));
});

test("Embed Proxy raw mode passes JSON through with CORS and skips cdn-cgi", async () => {
  const ext = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((r) => ext.listen(0, r));
  const extPort = ext.address().port;
  const proxy = http.createServer((req, res) => handleEmbedProxy(req, res));
  await new Promise((r) => proxy.listen(0, r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const u = encodeURIComponent(`http://127.0.0.1:${extPort}/vs_src.php?id=1`);
    const r1 = await fetch(`${base}/embed-proxy?raw=1&url=${u}`);
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get("access-control-allow-origin"), "*");
    assert.equal(await r1.text(), '{"ok":true}');

    const rum = encodeURIComponent(`http://127.0.0.1:${extPort}/cdn-cgi/rum?`);
    const r2 = await fetch(`${base}/embed-proxy?raw=1&url=${rum}`);
    assert.equal(r2.status, 204);
  } finally {
    ext.close();
    proxy.close();
  }
});
