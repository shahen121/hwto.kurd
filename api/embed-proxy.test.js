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

test("stripAdScripts eliminates all ad, popup, and devtools detector scripts", () => {
  const dirtyHtml = `
    <html>
      <head>
        <script src="https://example.com/safe.js"></script>
        <script src="https://popcash.net/show.js"></script>
        <script>
          /* adcash inline script */
          var _pop = _pop || [];
        </script>
        <script src="https://histats.com/js15.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/disable-devtool"></script>
        <script>console.log("sbx detector");</script>
      </head>
      <body>
        <div id="player"></div>
        <script src="https://www.googletagmanager.com/gtag/js"></script>
      </body>
    </html>
  `;

  const cleaned = stripAdScripts(dirtyHtml);

  assert.ok(cleaned.includes("https://example.com/safe.js"), "Safe script must be retained");
  assert.ok(!cleaned.includes("popcash.net"), "popcash must be stripped");
  assert.ok(!cleaned.includes("adcash inline script"), "adcash must be stripped");
  assert.ok(!cleaned.includes("histats.com"), "histats must be stripped");
  assert.ok(!cleaned.includes("disable-devtool"), "disable-devtool must be stripped");
  assert.ok(!cleaned.includes("sbx detector"), "sbx detector must be stripped");
  assert.ok(!cleaned.includes("googletagmanager.com"), "googletagmanager must be stripped");
});

test("sanitizeEmbedHtml injects base href and ULTIMATE_AD_SHIELD at the top of head", () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>External Player</title>
      </head>
      <body>
        <h1>Video</h1>
      </body>
    </html>
  `;

  const sanitized = sanitizeEmbedHtml(sampleHtml, "https://vidsrc.me");

  assert.ok(sanitized.includes('<base href="https://vidsrc.me/">'), "Must inject base href");
  assert.ok(sanitized.includes('id="ultimate-ad-shield"'), "Must inject ultimate-ad-shield");
  const headIdx = sanitized.indexOf("<head>");
  const shieldIdx = sanitized.indexOf('id="ultimate-ad-shield"');
  assert.ok(headIdx !== -1 && shieldIdx > headIdx, "Shield must be inside <head>");
});

test("ULTIMATE_AD_SHIELD neutralizes popups, sandbox detection, and auto-click anchors", () => {
  const rawJs = ULTIMATE_AD_SHIELD.replace(/<\/?script[^>]*>/gi, "");

  const mockWindow = {
    parent: { postMessage: () => {} },
    location: { href: "http://localhost:3000/embed-proxy?url=https%3A%2F%2Fvidsrc.me%2Fembed" },
    document: {
      body: {},
      documentElement: {},
    },
    EventTarget: function() {},
    HTMLAnchorElement: function() {},
    HTMLIFrameElement: function() {},
    Element: function() {},
    MutationObserver: function() {
      this.observe = () => {};
    },
  };
  mockWindow.window = mockWindow;
  mockWindow.EventTarget.prototype = {
    addEventListener: () => {},
  };
  mockWindow.HTMLAnchorElement.prototype = {
    click: () => {},
  };
  mockWindow.Element.prototype = {
    appendChild: (c) => c,
    insertBefore: (c) => c,
    setAttribute: () => {},
  };
  mockWindow.HTMLIFrameElement.prototype = Object.create(mockWindow.Element.prototype);
  Object.defineProperty(mockWindow.HTMLIFrameElement.prototype, "src", {
    configurable: true,
    enumerable: true,
    get: function() { return this._src; },
    set: function(val) { this._src = val; }
  });

  const sandbox = {
    window: mockWindow,
    document: mockWindow.document,
    EventTarget: mockWindow.EventTarget,
    HTMLAnchorElement: mockWindow.HTMLAnchorElement,
    HTMLIFrameElement: mockWindow.HTMLIFrameElement,
    Element: mockWindow.Element,
    MutationObserver: mockWindow.MutationObserver,
    URL,
    encodeURIComponent,
    Object,
    String,
    Date,
  };

  vm.runInNewContext(rawJs, sandbox);

  // 1. Verify fake window.open
  assert.equal(typeof sandbox.window.open, "function");
  const fakeWin = sandbox.window.open("https://ad-trap.example");
  assert.ok(fakeWin, "window.open must return fake window");
  assert.equal(fakeWin.closed, false);
  assert.equal(typeof fakeWin.focus, "function");
  assert.equal(typeof fakeWin.document.write, "function");
  fakeWin.close();
  assert.equal(fakeWin.closed, true);

  // 2. Verify fake window.frameElement
  assert.ok(sandbox.window.frameElement);
  assert.equal(sandbox.window.frameElement.hasAttribute("sandbox"), false);

  // 3. Verify nested iframe src wrapping
  const dummyIframe = Object.create(mockWindow.HTMLIFrameElement.prototype);
  dummyIframe.tagName = "IFRAME";
  dummyIframe.src = "https://cloudquest.example/embed/stream";
  assert.ok(
    dummyIframe.src.startsWith("/embed-proxy?url="),
    "Nested iframe src must be rewritten through /embed-proxy",
  );
  assert.ok(
    dummyIframe.src.includes(encodeURIComponent("https://cloudquest.example/embed/stream")),
  );
});

test("Embed Proxy HTTP Integration: fetches, cleans, and strips framing headers", async () => {
  // Mock external server
  const mockExternalServer = http.createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    });
    res.end(`
      <html>
        <head>
          <title>External Provider</title>
          <script src="https://popads.net/banner.js"></script>
        </head>
        <body>
          <iframe src="https://nested-stream.example/play"></iframe>
        </body>
      </html>
    `);
  });

  await new Promise((resolve) => mockExternalServer.listen(0, resolve));
  const extPort = mockExternalServer.address().port;
  const targetUrl = `http://127.0.0.1:${extPort}/embed/movie/550`;

  // Mock our proxy server
  const proxyServer = http.createServer((req, res) => {
    handleEmbedProxy(req, res);
  });
  await new Promise((resolve) => proxyServer.listen(0, resolve));
  const proxyPort = proxyServer.address().port;

  try {
    // 1. Missing ?url parameter
    const errRes = await fetch(`http://127.0.0.1:${proxyPort}/embed-proxy`);
    assert.equal(errRes.status, 400);

    // 2. Valid proxy request
    const res = await fetch(`http://127.0.0.1:${proxyPort}/embed-proxy?url=${encodeURIComponent(targetUrl)}`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/html"));
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.equal(res.headers.get("x-frame-options"), null, "X-Frame-Options must be stripped");
    assert.equal(res.headers.get("content-security-policy"), null, "CSP must be stripped");

    const html = await res.text();
    assert.ok(html.includes(`<base href="http://127.0.0.1:${extPort}/">`));
    assert.ok(html.includes('id="ultimate-ad-shield"'));
    assert.ok(!html.includes("popads.net"), "Ad script must be stripped");
  } finally {
    mockExternalServer.close();
    proxyServer.close();
  }
});
