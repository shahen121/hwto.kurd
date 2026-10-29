const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const vm = require("node:vm");
const app = require("../server.js");
const {
  getScrapeDoTokens,
  fetchViaScrapeDoWithRotation,
  AD_SHIELD_JS,
  sanitizeVidcoreHtml,
  sanitizeVidlinkHtml,
  patchPlayerChunk,
  staticChunkCache,
  getScrapeDoSessionId,
  CF_WORKER_URL,
} = require("./vidcore.js");

test("Scrape.do multi-token Round-Robin rotation & fallback on 401/403/429", async () => {
  const saved = {
    t1: process.env.SCRAPE_DO_TOKEN_1,
    t2: process.env.SCRAPE_DO_TOKEN_2,
    t3: process.env.SCRAPE_DO_TOKEN_3,
    t0: process.env.SCRAPE_DO_TOKEN,
  };

  try {
    process.env.SCRAPE_DO_TOKEN_1 = "token_alpha";
    process.env.SCRAPE_DO_TOKEN_2 = "token_beta";
    process.env.SCRAPE_DO_TOKEN_3 = "token_gamma";
    delete process.env.SCRAPE_DO_TOKEN;

    const tokens = getScrapeDoTokens();
    assert.deepEqual(tokens, ["token_alpha", "token_beta", "token_gamma"]);

    // Simulate token_alpha returning 429 (quota exhausted), token_beta returning 403, and token_gamma succeeding (200)
    const attemptedTokens = [];
    const res = await fetchViaScrapeDoWithRotation(
      "https://vidcore.io/movie/550",
      async (url) => {
        const u = new URL(url);
        const tok = u.searchParams.get("token");
        attemptedTokens.push(tok);
        if (tok === "token_alpha") return { status: 429 };
        if (tok === "token_beta") return { status: 403 };
        return { status: 200, text: async () => "OK_FROM_GAMMA" };
      },
    );

    assert.equal(res.status, 200);
    assert.deepEqual(attemptedTokens, [
      "token_alpha",
      "token_beta",
      "token_gamma",
    ]);

    // Next call starts from token_beta (Round-Robin) and supports POST with customHeaders=true
    const secondCallTokens = [];
    let capturedUrl = "";
    let capturedOpts = null;
    const res2 = await fetchViaScrapeDoWithRotation(
      "https://vidcore.io/APA91ywF/test",
      async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        const u = new URL(url);
        const tok = u.searchParams.get("token");
        secondCallTokens.push(tok);
        return { status: 200 };
      },
      {
        method: "POST",
        headers: {
          Origin: "https://vidcore.io",
          Referer: "https://vidcore.io/",
          "x-csrf-token": "test_csrf_123",
        },
      },
    );
    assert.equal(res2.status, 200);
    assert.deepEqual(secondCallTokens, ["token_beta"]);
    assert.equal(capturedUrl.includes("customHeaders=true"), true);
    assert.equal(capturedUrl.includes("sessionId="), true);
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers["x-csrf-token"], "test_csrf_123");
    // Content-Length is intentionally stripped so the fetch implementation can
    // compute the correct value for the WHATWG-compliant body.
    assert.equal(capturedOpts.headers["Content-Length"], undefined);
  } finally {
    if (saved.t1 !== undefined) process.env.SCRAPE_DO_TOKEN_1 = saved.t1;
    else delete process.env.SCRAPE_DO_TOKEN_1;
    if (saved.t2 !== undefined) process.env.SCRAPE_DO_TOKEN_2 = saved.t2;
    else delete process.env.SCRAPE_DO_TOKEN_2;
    if (saved.t3 !== undefined) process.env.SCRAPE_DO_TOKEN_3 = saved.t3;
    else delete process.env.SCRAPE_DO_TOKEN_3;
    if (saved.t0 !== undefined) process.env.SCRAPE_DO_TOKEN = saved.t0;
    else delete process.env.SCRAPE_DO_TOKEN;
  }
});

test("Vidcore & Vidlink proxy + Cloudflare Worker integration", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. /gtag-shield.js returns Ad-Shield script
    const r1 = await fetch(`${base}/gtag-shield.js`);
    assert.equal(r1.status, 200);
    const t1 = await r1.text();
    assert.equal(t1.includes("__vidcoreShieldInitialized"), true);

    // 2. /stream-proxy/ref/* redirects (302) to Cloudflare Worker
    const r2 = await fetch(
      `${base}/stream-proxy/ref/https/example.com/master.m3u8`,
      { redirect: "manual" },
    );
    assert.equal(r2.status, 302);
    assert.equal(
      r2.headers.get("location"),
      "https://hwto.proteome626.workers.dev/stream-proxy/ref/https%3A%2F%2Fexample.com%2Fmaster.m3u8",
    );

    // 3. /vidcore/movie/550 sanitizes HTML and strips ads + injects subtitle RTL fix
    const r3 = await fetch(`${base}/vidcore/movie/550`);
    assert.equal(r3.status, 200);
    const t3 = await r3.text();
    assert.equal(t3.includes("/gtag-shield.js"), true);
    assert.equal(t3.includes('"ad":true'), false);
    assert.equal(t3.includes('id="hwto-sub-fix"'), true);

    // 4. Chunk 281 is kept clean and valid without internal syntax errors
    const chunkMatch = t3.match(/\/(?:vidcore\/)?_next\/static\/chunks\/281-[a-zA-Z0-9]+\.js/);
    assert.ok(chunkMatch, "Should find chunk 281 in Vidcore HTML");
    const r4 = await fetch(`${base}${chunkMatch[0]}`);
    assert.equal(r4.status, 200);
    const t4 = await r4.text();
    assert.doesNotThrow(() => {
      new vm.Script(t4);
    }, "Chunk 281 must compile cleanly without SyntaxError");

    // 5. /vidlink/movie/550 sanitizes HTML, sets limitAds:true, injects interceptor & subtitle RTL fix, and removes invalid preloads
    const r5 = await fetch(`${base}/vidlink/movie/550`);
    assert.equal(r5.status, 200);
    const t5 = await r5.text();
    assert.equal(t5.includes("/gtag-shield.js"), true);
    assert.equal(t5.includes('\\"limitAds\\":true'), true);
    assert.equal(t5.includes('id="hwto-sub-fix"'), true);
    assert.equal(t5.includes('id="hwto-vidlink-interceptor"'), true);
    assert.equal(/<link[^>]*rel=["']?preload["']?[^>]*href=["']\s*["']/i.test(t5), false);
  } finally {
    server.close();
  }
});

test("Vidlink Client-side Interceptor rewrites fetch, XHR (.mpd, .m4s, .m3u8, .ts, .mp4), and cleans invalid <link rel=preload>", async () => {
  // 1. Verify sanitizeVidlinkHtml strips invalid/empty/Yandex preload tags
  const sampleHtml = `<!DOCTYPE html><html><head><link rel="preload" as="image" href="https://mc.yandex.ru/watch/98154677"/><link rel="preload" as="image" href=""/><link rel="preload" as="script" href="/_next/static/chunks/webpack.js"/></head><body></body></html>`;
  const cleanedHtml = sanitizeVidlinkHtml(sampleHtml);
  assert.equal(cleanedHtml.includes('href="https://mc.yandex.ru/watch/98154677"'), false);
  assert.equal(/<link[^>]*rel=["']?preload["']?[^>]*href=["']\s*["']/i.test(cleanedHtml), false);
  assert.equal(
    cleanedHtml.includes('href="/vidlink/_next/static/chunks/webpack.js"'),
    true,
  );

  // 2. Verify AD_SHIELD_JS monkey-patches window.fetch and XMLHttpRequest.prototype.open for DASH/HLS/MP4
  const fetchedUrls = [];
  const xhrOpened = [];

  function MockXHR() {}
  MockXHR.prototype.open = function (method, url, async) {
    xhrOpened.push({ method, url, async, instance: this });
  };

  function MockDocument() {}
  MockDocument.prototype.createElement = function (tag) {
    return {
      tagName: tag,
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      getAttribute(k) {
        return this.attrs[k] ?? null;
      },
      removeAttribute(k) {
        delete this.attrs[k];
      },
    };
  };

  const sandbox = {
    window: null,
    Document: MockDocument,
    document: {
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    XMLHttpRequest: MockXHR,
    URL,
    encodeURIComponent,
    Object,
    Array,
    String,
    Date,
    fetch: async function (input) {
      fetchedUrls.push(String(input));
      return { status: 200, url: String(input) };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.parent = { postMessage: () => {} };
  sandbox.window.location = { origin: "https://hwto-kurd.vercel.app" };

  vm.runInNewContext(AD_SHIELD_JS, sandbox);

  // Test A: DASH .mpd via XHR
  const mpdUrl =
    "https://surge.flooderrr.store/sacdn/dash/87308238/index_web.mpd?host=https%3A%2F%2Fsacdn.hakunaymatata.com&sc=abc123";
  const xhr1 = new sandbox.XMLHttpRequest();
  xhr1.open("GET", mpdUrl, true);
  assert.equal(
    xhrOpened[0].url,
    `https://hwto.proteome626.workers.dev/stream-proxy/ref/${encodeURIComponent(mpdUrl)}?ref=vidlink`,
  );
  // dash.js relies on xhr.responseURL being the original MPD URL to resolve relative segment templates
  assert.equal(xhr1.responseURL, mpdUrl);

  // Test B: Subsequent DASH .m4s segment with full flooderrr.store URL via XHR
  const segUrl =
    "https://surge.flooderrr.store/sacdn/dash/87308238/chunk-stream0-00001.m4s?host=https%3A%2F%2Fsacdn.hakunaymatata.com&sc=abc123";
  const xhr2 = new sandbox.XMLHttpRequest();
  xhr2.open("GET", segUrl, true);
  assert.equal(
    xhrOpened[1].url,
    `https://hwto.proteome626.workers.dev/stream-proxy/ref/${encodeURIComponent(segUrl)}?ref=vidlink`,
  );

  // Test C: Subsequent DASH .m4s segment if resolved as root-relative /sacdn/dash/... via fetch
  const relSegPath =
    "/sacdn/dash/87308238/init-stream0.m4s?host=https%3A%2F%2Fsacdn.hakunaymatata.com&sc=abc123";
  const expectedResolvedSeg = `https://surge.flooderrr.store${relSegPath}`;
  const fetchRes = await sandbox.window.fetch(relSegPath);
  assert.equal(
    fetchedUrls[0],
    `https://hwto.proteome626.workers.dev/stream-proxy/ref/${encodeURIComponent(expectedResolvedSeg)}?ref=vidlink`,
  );
  assert.equal(fetchRes.url, expectedResolvedSeg);

  // Test D: Direct .m3u8 and hakunaymatata.com .mp4 via fetch
  const hlsUrl = "https://sacdn.hakunaymatata.com/hls/movie/master.m3u8?token=xyz";
  await sandbox.window.fetch(hlsUrl);
  assert.equal(
    fetchedUrls[1],
    `https://hwto.proteome626.workers.dev/stream-proxy/ref/${encodeURIComponent(hlsUrl)}?ref=vidlink`,
  );
});

test("Scrape.do Session Sticky Token Pinning", async () => {
  const saved = {
    t1: process.env.SCRAPE_DO_TOKEN_1,
    t2: process.env.SCRAPE_DO_TOKEN_2,
    t3: process.env.SCRAPE_DO_TOKEN_3,
    t0: process.env.SCRAPE_DO_TOKEN,
  };

  try {
    process.env.SCRAPE_DO_TOKEN_1 = "tok_A";
    process.env.SCRAPE_DO_TOKEN_2 = "tok_B";
    process.env.SCRAPE_DO_TOKEN_3 = "tok_C";
    delete process.env.SCRAPE_DO_TOKEN;

    const testSession = "user_sess_99";
    const usedTokens = [];

    // First call with testSession
    await fetchViaScrapeDoWithRotation(
      "https://vidcore.io/movie/550",
      async (url) => {
        const u = new URL(url);
        usedTokens.push(u.searchParams.get("token"));
        return { status: 200, text: async () => "OK" };
      },
      { sessionId: testSession },
    );

    // Second call with the same testSession MUST use the EXACT same token
    await fetchViaScrapeDoWithRotation(
      "https://vidcore.io/APA91ywF/verify",
      async (url) => {
        const u = new URL(url);
        usedTokens.push(u.searchParams.get("token"));
        return { status: 200, text: async () => "OK" };
      },
      { sessionId: testSession, method: "POST" },
    );

    assert.equal(usedTokens.length, 2);
    assert.equal(
      usedTokens[0],
      usedTokens[1],
      "Same session must pin to the same token to prevent IP rotation and 555 errors",
    );
  } finally {
    if (saved.t1 !== undefined) process.env.SCRAPE_DO_TOKEN_1 = saved.t1;
    else delete process.env.SCRAPE_DO_TOKEN_1;
    if (saved.t2 !== undefined) process.env.SCRAPE_DO_TOKEN_2 = saved.t2;
    else delete process.env.SCRAPE_DO_TOKEN_2;
    if (saved.t3 !== undefined) process.env.SCRAPE_DO_TOKEN_3 = saved.t3;
    else delete process.env.SCRAPE_DO_TOKEN_3;
    if (saved.t0 !== undefined) process.env.SCRAPE_DO_TOKEN = saved.t0;
    else delete process.env.SCRAPE_DO_TOKEN;
  }
});

test("Static chunk cache and prefix normalization in handleVidcoreProxy", async () => {
  const dummyChunkPath = "/_next/static/chunks/test-chunk-abc.js";
  const dummyCode = 'console.log("cached chunk code");';
  staticChunkCache.set(dummyChunkPath, {
    body: dummyCode,
    contentType: "application/javascript; charset=utf-8",
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Direct request to /_next/static/...
    const res1 = await fetch(`${base}${dummyChunkPath}`);
    assert.equal(res1.status, 200);
    assert.equal(await res1.text(), dummyCode);
    assert.equal(
      res1.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );

    // 2. Request through /vidcore/_next/static/... hits the same cache
    const res2 = await fetch(`${base}/vidcore${dummyChunkPath}`);
    assert.equal(res2.status, 200);
    assert.equal(await res2.text(), dummyCode);
    assert.equal(
      res2.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  } finally {
    server.close();
    staticChunkCache.delete(dummyChunkPath);
  }
});

test("AD_SHIELD_JS fake proxies spoof origin, protocol, port, hostname, and window references", () => {
  const sandbox = {
    window: null,
    document: {},
    URL,
    encodeURIComponent,
    Object,
    Array,
    String,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.window.location = {
    origin: "http://localhost:3000",
    protocol: "http:",
    port: "3000",
    hostname: "localhost",
    host: "localhost:3000",
    pathname: "/vidcore/movie/550",
    search: "?token=123",
  };

  vm.runInNewContext(AD_SHIELD_JS, sandbox);

  const fakeWin = sandbox.window.__fakeWin;
  const fakeLoc = sandbox.window.__fakeLoc;
  const fakeDoc = sandbox.window.__fakeDoc;

  assert.ok(fakeWin, "__fakeWin must be created");
  assert.ok(fakeLoc, "__fakeLoc must be created");
  assert.ok(fakeDoc, "__fakeDoc must be created");

  assert.equal(fakeLoc.hostname, "vidcore.io");
  assert.equal(fakeLoc.host, "vidcore.io");
  assert.equal(fakeLoc.protocol, "https:");
  assert.equal(fakeLoc.port, "");
  assert.equal(fakeLoc.origin, "https://vidcore.io");

  assert.equal(fakeDoc.domain, "vidcore.io");
  assert.equal(fakeDoc.referrer, "https://vidcore.io/");

  assert.equal(fakeWin.origin, "https://vidcore.io");
  assert.equal(fakeWin.location.hostname, "vidcore.io");
  assert.equal(fakeWin.self, fakeWin);
  assert.equal(fakeWin.window, fakeWin);

  // Verify fake window.open proxy satisfies anti-adblock and sandbox checks
  assert.equal(typeof sandbox.window.open, "function");
  const openedWin = sandbox.window.open("https://ad-trap.example");
  assert.ok(openedWin, "window.open must return a fake window object instead of null");
  assert.equal(openedWin.closed, false);
  assert.equal(typeof openedWin.focus, "function");
  assert.equal(typeof openedWin.blur, "function");
  assert.equal(typeof openedWin.close, "function");
  assert.equal(typeof openedWin.postMessage, "function");
  assert.ok(openedWin.location && typeof openedWin.location.assign === "function");
  assert.ok(openedWin.document && typeof openedWin.document.write === "function");
  assert.ok(openedWin.document && typeof openedWin.document.open === "function");
  assert.ok(openedWin.document && typeof openedWin.document.close === "function");
  openedWin.close();
  assert.equal(openedWin.closed, true);
});

test("AD_SHIELD_JS intercepts APA91 requests and routes them to /vidcore/APA91...", async () => {
  const fetchedUrls = [];
  const xhrOpened = [];
  function MockXHR() {}
  MockXHR.prototype.open = function (method, url) {
    xhrOpened.push({ method, url });
  };
  const sandbox = {
    window: null,
    document: { querySelectorAll: () => [], addEventListener: () => {} },
    XMLHttpRequest: MockXHR,
    URL,
    encodeURIComponent,
    fetch: async (input) => {
      fetchedUrls.push(String(input));
      return { status: 200, url: String(input) };
    },
  };
  sandbox.window = sandbox;
  sandbox.window.parent = { postMessage: () => {} };
  sandbox.window.location = { origin: "https://hwto-kurd.vercel.app" };
  vm.runInNewContext(AD_SHIELD_JS, sandbox);

  // 1. Relative /APA91 via XHR
  const xhr = new sandbox.XMLHttpRequest();
  xhr.open("POST", "/APA91ywFtest123");
  assert.equal(xhrOpened[0].url, "https://hwto-kurd.vercel.app/vidcore/APA91ywFtest123");

  // 2. Full vidcore.io /APA91 via fetch
  await sandbox.window.fetch("https://vidcore.io/APA91ywFfull");
  assert.equal(fetchedUrls[0], "https://hwto-kurd.vercel.app/vidcore/APA91ywFfull");

  // 3. Already prefixed /vidcore/APA91
  await sandbox.window.fetch("/vidcore/APA91ywFclean");
  assert.equal(fetchedUrls[1], "https://hwto-kurd.vercel.app/vidcore/APA91ywFclean");
});

test("Cache busting (?v=6) and clean untouched JS chunks in vidcore", () => {
  // 1. Verify HTML sanitization adds /vidcore/_next/static/... and ?v=6 to Next.js chunks
  const sampleVidcoreHtml = `
    <html>
      <head>
        <link rel="preload" href="/_next/static/chunks/281-d15eeb1ca15a1654.js" as="script"/>
        <script src="/_next/static/chunks/281-d15eeb1ca15a1654.js" async=""></script>
        <script src="/_next/static/chunks/main-app-14eacbf1653a965d.js" async=""></script>
      </head>
      <body></body>
    </html>
  `;
  const sanitized = sanitizeVidcoreHtml(sampleVidcoreHtml);
  assert.ok(sanitized.includes("/vidcore/_next/static/chunks/281-d15eeb1ca15a1654.js?v=6"));
  assert.ok(sanitized.includes("/vidcore/_next/static/chunks/main-app-14eacbf1653a965d.js?v=6"));
  // Ensure idempotent (no ?v=6?v=6)
  const sanitizedTwice = sanitizeVidcoreHtml(sanitized);
  assert.ok(!sanitizedTwice.includes("?v=6?v=6"));

  // 2. Verify patchPlayerChunk returns code 100% untouched without any .replace()
  const mockCode = `
    function wrapper() {
      let t=[];for(let a=0;a<50;a++)t.push(e);let a=Date.now();return console.table(t),console.clear(),Date.now()-a<=10
      let{en:l,from:b,ad:h,mobile:u}=e;
    }
  `;
  const cleanCode = patchPlayerChunk(mockCode, "/_next/static/chunks/main-app.js");
  assert.equal(cleanCode, mockCode, "Chunks must remain completely untouched 100%");
});

test("AD_SHIELD_JS blocks clarity.ms, stubs clarity.q, and mutes transient SourceBuffer errors", () => {
  const capturedErrors = [];
  const sandbox = {
    window: null,
    document: {},
    console: {
      error: (...args) => capturedErrors.push(args.join(" ")),
    },
    URL,
    encodeURIComponent,
    Object,
    Array,
    String,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.window.location = {
    origin: "https://hwto-kurd.vercel.app",
    hostname: "hwto-kurd.vercel.app",
    protocol: "https:",
    port: "",
    pathname: "/vidcore/movie/550",
  };

  vm.runInNewContext(AD_SHIELD_JS, sandbox);

  // 1. Check window.clarity stub and .q array
  assert.equal(typeof sandbox.window.clarity, "function");
  assert.ok(Array.isArray(sandbox.window.clarity.q), "clarity.q must be an array");
  assert.doesNotThrow(() => {
    sandbox.window.clarity("set", "test");
    sandbox.window.clarity.q.push("item");
    sandbox.window.clarity.q.unshift("item0");
  }, "clarity.q.unshift must not throw");

  // 2. Check console.error muting
  sandbox.console.error("Uncaught Error: SourceBufferSink failed to append");
  sandbox.console.error("This SourceBuffer has been removed from the parent media source.");
  sandbox.console.error("Script error at www.clarity.ms/tag/abc");
  assert.equal(capturedErrors.length, 0, "Transient SourceBuffer & clarity errors must be muted");

  // Normal errors must NOT be muted
  sandbox.console.error("Real critical application error");
  assert.equal(capturedErrors.length, 1);
  assert.ok(capturedErrors[0].includes("Real critical application error"));

  // 3. HTML sanitization strips clarity.ms tags
  const htmlWithClarity = `
    <html>
      <head>
        <script src="https://www.clarity.ms/tag/12345"></script>
        <script>window.clarity("start");</script>
      </head>
      <body></body>
    </html>
  `;
  const cleanVidcore = sanitizeVidcoreHtml(htmlWithClarity);
  assert.ok(!cleanVidcore.includes("clarity.ms"), "Vidcore HTML must strip clarity.ms");
  const cleanVidlink = sanitizeVidlinkHtml(htmlWithClarity);
  assert.ok(!cleanVidlink.includes("clarity.ms"), "Vidlink HTML must strip clarity.ms");
});

test("Strict Zero-SyntaxError verification on AD_SHIELD_JS, UNIVERSAL_SUBTITLE_INJECTOR_JS, and Next.js RSC sanitized HTML", () => {
  const { UNIVERSAL_SUBTITLE_INJECTOR_JS } = require("./subtitles.js");

  // 1. Both injected scripts must be completely valid JS without syntax errors
  assert.doesNotThrow(() => {
    new Function(AD_SHIELD_JS);
  }, "AD_SHIELD_JS must compile without any syntax error");

  assert.doesNotThrow(() => {
    new Function(UNIVERSAL_SUBTITLE_INJECTOR_JS);
  }, "UNIVERSAL_SUBTITLE_INJECTOR_JS must compile without any syntax error");

  // 2. Next.js streaming RSC payload with embedded clarity script references and JSON strings
  const mockRscHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Player</title>
      </head>
      <body>
        <script>self.__next_f=self.__next_f||[];self.__next_f.push([0])</script>
        <script>self.__next_f.push([1,"1:HL[\\\"/_next/static/css/app.css\\\",\\\"style\\\"]\\n"])</script>
        <script>self.__next_f.push([1,"14:[\\\"$\\\",\\\"script\\\",null,{\\\"src\\\":\\\"https://www.clarity.ms/tag/p5j6v64p52\\\",\\\"strategy\\\":\\\"afterInteractive\\\"}]\\n"])</script>
        <script>self.__next_f.push([1,"15:[\\\"$\\\",\\\"div\\\",null,{\\\"children\\\":\\\"Safe content with; semicolon and quotes\\\"}]\\n"])</script>
        <script src="https://www.clarity.ms/tag/p5j6v64p52"></script>
      </body>
    </html>
  `;

  for (const sanitizer of [sanitizeVidlinkHtml, sanitizeVidcoreHtml]) {
    const sanitized = sanitizer(mockRscHtml);

    // Extract all <script> contents (ignoring external src) and compile each with vm.Script
    const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let scriptCount = 0;
    while ((match = scriptRegex.exec(sanitized)) !== null) {
      const code = match[1].trim();
      if (!code) continue;
      scriptCount++;
      assert.doesNotThrow(() => {
        new vm.Script(code);
      }, `Script block #${scriptCount} must compile with zero syntax errors`);
    }
    assert.ok(scriptCount >= 3, "Must have verified all Next.js RSC and injected script blocks");
  }
});

test("AD_SHIELD_JS dynamically spoofs domain for VidLink (vidlink.pro) vs VidCore (vidcore.io) and intercepts script src", () => {
  // Test VidLink context
  const fakeScriptInstances = [];
  function MockScript() {
    this._src = "";
    fakeScriptInstances.push(this);
  }
  Object.defineProperty(MockScript.prototype, "src", {
    get() { return this._src; },
    set(v) { this._src = v; },
    configurable: true,
  });

  const vidlinkSandbox = {
    window: null,
    document: {},
    HTMLScriptElement: MockScript,
    URL,
    encodeURIComponent,
  };
  vidlinkSandbox.window = vidlinkSandbox;
  vidlinkSandbox.window.location = {
    origin: "https://hwto-kurd.vercel.app",
    hostname: "hwto-kurd.vercel.app",
    href: "https://hwto-kurd.vercel.app/vidlink/movie/550",
    pathname: "/vidlink/movie/550",
  };

  vm.runInNewContext(AD_SHIELD_JS, vidlinkSandbox);

  // In VidLink context, fake location/origin must be vidlink.pro (NOT vidcore.io)
  assert.equal(vidlinkSandbox.__fakeLoc.hostname, "vidlink.pro");
  assert.equal(vidlinkSandbox.__fakeLoc.origin, "https://vidlink.pro");
  assert.equal(vidlinkSandbox.__fakeDoc.domain, "vidlink.pro");

  // Script src setter should route /_next/ to /vidlink/_next/
  const s1 = new MockScript();
  s1.src = "/_next/static/chunks/app-123.js";
  assert.equal(s1.src, "https://hwto-kurd.vercel.app/vidlink/_next/static/chunks/app-123.js");

  // Test VidCore context
  const vidcoreSandbox = {
    window: null,
    document: {},
    HTMLScriptElement: MockScript,
    URL,
    encodeURIComponent,
  };
  vidcoreSandbox.window = vidcoreSandbox;
  vidcoreSandbox.window.location = {
    origin: "https://hwto-kurd.vercel.app",
    hostname: "hwto-kurd.vercel.app",
    href: "https://hwto-kurd.vercel.app/vidcore/movie/550",
    pathname: "/vidcore/movie/550",
  };

  vm.runInNewContext(AD_SHIELD_JS, vidcoreSandbox);

  // In VidCore context, fake location/origin must be vidcore.io
  assert.equal(vidcoreSandbox.__fakeLoc.hostname, "vidcore.io");
  assert.equal(vidcoreSandbox.__fakeLoc.origin, "https://vidcore.io");

  // Script src setter should route /_next/static/ to /vidcore/_next/static/ with ?v=6
  const s2 = new MockScript();
  s2.src = "/_next/static/chunks/main-456.js";
  assert.equal(s2.src, "https://hwto-kurd.vercel.app/vidcore/_next/static/chunks/main-456.js?v=6");
});

test("VidCore session_number pinning across HTML and APA91 POST + .m3u8 steelpeak stream routing", async () => {
  const {
    getScrapeDoSessionId,
    buildScrapeDoUrl,
    CF_WORKER_URL,
  } = require("./vidcore.js");

  // 1. Session ID pinning between HTML page navigation and subsequent APA91 POST
  const htmlReq = {
    url: "/vidcore/movie/1283515",
    headers: {
      "x-forwarded-for": "198.51.100.55, 10.0.0.1",
    },
    socket: { remoteAddress: "198.51.100.55" },
  };
  const htmlSessId = getScrapeDoSessionId(htmlReq, "/movie/1283515");

  const apaPostReq = {
    url: "/vidcore/APA91ywF/verify",
    method: "POST",
    headers: {
      "x-forwarded-for": "198.51.100.55, 10.0.0.1",
      referer: "https://hwto-kurd.vercel.app/vidcore/movie/1283515",
      "content-type": "application/octet-stream",
    },
    socket: { remoteAddress: "198.51.100.55" },
  };
  const apaSessId = getScrapeDoSessionId(apaPostReq, "/APA91ywF/verify");

  assert.equal(
    apaSessId,
    htmlSessId,
    "HTML request and subsequent APA91 POST must share the identical session_number",
  );

  // 2. buildScrapeDoUrl includes both sessionId and session_number
  const scrapeUrl = buildScrapeDoUrl("https://vidcore.io/movie/1283515", "test_tok", true, htmlSessId);
  const parsed = new URL(scrapeUrl);
  assert.equal(parsed.searchParams.get("sessionId"), htmlSessId);
  assert.equal(parsed.searchParams.get("session_number"), htmlSessId);

  // 3. AD_SHIELD_JS routing for .m3u8, steelpeak, vd, and hls domains
  let capturedFetchUrl = "";
  const mockFetch = async (url) => {
    capturedFetchUrl = typeof url === "string" ? url : url.url;
    return { ok: true, status: 200, text: async () => "#EXTM3U" };
  };

  const sandbox = {
    window: null,
    document: {},
    fetch: mockFetch,
    console: {
      error: () => {},
      warn: () => {},
    },
    URL,
    encodeURIComponent,
    Object,
    Array,
    String,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.window.location = {
    origin: "https://hwto-kurd.vercel.app",
    hostname: "hwto-kurd.vercel.app",
    href: "https://hwto-kurd.vercel.app/vidcore/movie/1283515",
    pathname: "/vidcore/movie/1283515",
  };

  vm.runInNewContext(AD_SHIELD_JS, sandbox);

  // Fetch to steelpeak .m3u8 stream
  await sandbox.window.fetch("https://steelpeak.store/hls/master.m3u8");
  assert.ok(
    capturedFetchUrl.startsWith(`${CF_WORKER_URL}/stream-proxy/ref/`),
    "steelpeak stream must be routed through Cloudflare Worker stream-proxy",
  );
  assert.ok(capturedFetchUrl.includes(encodeURIComponent("https://steelpeak.store/hls/master.m3u8")));

  // Fetch to vd streaming domain
  await sandbox.window.fetch("https://vd12.com/live/playlist.m3u8");
  assert.ok(
    capturedFetchUrl.startsWith(`${CF_WORKER_URL}/stream-proxy/ref/`),
    "vd domain must be routed through Cloudflare Worker stream-proxy",
  );

  // Protocol-relative //steelpeak...
  await sandbox.window.fetch("//steelpeak.store/live/chunk.m3u8");
  assert.ok(
    capturedFetchUrl.startsWith(`${CF_WORKER_URL}/stream-proxy/ref/`),
    "protocol-relative stream must be routed through Cloudflare Worker stream-proxy",
  );
  assert.ok(capturedFetchUrl.includes(encodeURIComponent("https://steelpeak.store/live/chunk.m3u8")));
});

test("WHATWG URL standard compliance and raw binary body forwarding for POST /APA91... decryption", async () => {
  const { handleVidcoreProxy } = require("./vidcore.js");

  const originalFetch = global.fetch;
  const workerCalls = [];
  let capturedOpts = null;

  global.fetch = async (url, opts) => {
    const value = String(url);
    if (!value.startsWith(`${CF_WORKER_URL}/stream-proxy/ref/`)) {
      throw new Error(`Unexpected upstream fetch: ${value}`);
    }
    workerCalls.push(value);
    capturedOpts = opts;
    return new Response(JSON.stringify({ key: "decrypted_stream_token_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const rawBinaryPayload = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xaa, 0x55]);

    let responseCode = null;
    let responseBody = null;

    const res = {
      writeHead(code) {
        responseCode = code;
      },
      end(data) {
        responseBody = data;
      },
    };

    const runProxy = async (req, expectedTarget) => {
      responseCode = null;
      responseBody = null;
      const before = workerCalls.length;
      await handleVidcoreProxy(req, res);

      assert.equal(responseCode, 200);
      assert.equal(workerCalls.length, before + 1, "Worker-first path must be used");
      assert.ok(
        workerCalls[before].startsWith(`${CF_WORKER_URL}/stream-proxy/ref/`),
      );
      assert.ok(
        workerCalls[before].includes(encodeURIComponent(expectedTarget)),
        "Encoded upstream target must be forwarded to the worker",
      );
      assert.ok(responseBody.toString().includes("decrypted_stream_token_123"));
    };

    const req = {
      method: "POST",
      url: "/vidcore/APA91ywFtestBinaryKey",
      headers: {
        host: "hwto-kurd.vercel.app",
        referer: "https://hwto-kurd.vercel.app/vidcore/movie/1283515",
        "content-type": "application/octet-stream",
        "x-hwto-media-id": "1283515",
        "x-forwarded-for": "198.51.100.42",
      },
      rawBody: rawBinaryPayload,
    };

    await runProxy(req, "https://vidcore.io/APA91ywFtestBinaryKey");

    // Verify options and binary body
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers["Origin"], "https://vidcore.io");
    assert.equal(capturedOpts.headers["Referer"], "https://vidcore.io/");
    assert.equal(capturedOpts.headers["Content-Type"], "application/octet-stream");
    assert.equal(capturedOpts.headers["Content-Length"], undefined);
    assert.deepEqual(capturedOpts.body, rawBinaryPayload);

    // Verify internal x-hwto header was stripped before sending upstream
    assert.equal(capturedOpts.headers["x-hwto-media-id"], undefined);

    // Also verify when URL is direct /APA91ywFtestDirect without /vidcore prefix
    await runProxy(
      {
        method: "POST",
        url: "/APA91ywFtestDirect",
        headers: {
          host: "hwto-kurd.vercel.app",
          referer: "https://hwto-kurd.vercel.app/vidcore/movie/1283515",
          "content-type": "application/octet-stream",
        },
        rawBody: rawBinaryPayload,
      },
      "https://vidcore.io/APA91ywFtestDirect",
    );

    // Verify Vercel rewrite with x-matched-path header on /api/vidcore
    await runProxy(
      {
        method: "POST",
        url: "/api/vidcore",
        headers: {
          host: "hwto-kurd.vercel.app",
          "x-matched-path": "/APA91ywFtestVercelRewrite",
          referer: "https://hwto-kurd.vercel.app/vidcore/movie/1283515",
          "content-type": "application/octet-stream",
        },
        rawBody: rawBinaryPayload,
      },
      "https://vidcore.io/APA91ywFtestVercelRewrite",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Cache-busting /gtag-shield.js?v=6 and unoverwritable console shield in AD_SHIELD_JS", async () => {
  let responseCode = 0;
  let responseHeaders = {};
  let responseBody = "";

  const req = {
    method: "GET",
    url: "/gtag-shield.js?v=6",
    headers: { host: "localhost:3000" },
  };

  const res = {
    writeHead(code, headers) {
      responseCode = code;
      responseHeaders = headers;
    },
    end(data) {
      responseBody = data;
    },
  };

  const { handleVidcoreProxy } = require("./vidcore.js");
  await handleVidcoreProxy(req, res);

  assert.equal(responseCode, 200);
  assert.equal(responseHeaders["Content-Type"], "application/javascript; charset=utf-8");
  assert.ok(responseHeaders["Cache-Control"].includes("max-age=86400"));
  assert.ok(responseBody.includes("__shouldMuteLog"));

  // Verify unoverwritable console error in AD_SHIELD_JS
  const captured = [];
  const sandbox = {
    console: {
      error: (...args) => captured.push(args.join(" ")),
      warn: () => {},
    },
    window: {
      location: { href: "https://hwto-kurd.vercel.app/vidlink/movie/550" },
      addEventListener: () => {},
      parent: { postMessage: () => {} },
    },
    document: {},
  };

  vm.runInNewContext(responseBody, sandbox);

  // Mutes SourceBufferSink and React #418
  sandbox.console.error("[SourceBufferSink] [4888] SourceBuffer append failed");
  sandbox.console.error("Minified React error #418; visit https://react.dev/errors/418");
  assert.equal(captured.length, 0);

  // Reassigned console.error by external script still preserves filtering
  const reassignedLogs = [];
  sandbox.console.error = function(...args) {
    reassignedLogs.push(args.join(" "));
  };

  sandbox.console.error("[SourceBufferSink] [8988] This SourceBuffer has been removed");
  sandbox.console.error("Cannot read properties of undefined (reading 'unshift')");
  assert.equal(reassignedLogs.length, 0);

  // Real error is passed through
  sandbox.console.error("Actual application error");
  assert.equal(reassignedLogs.length, 1);
  assert.ok(reassignedLogs[0].includes("Actual application error"));
});






