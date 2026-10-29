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
    assert.equal(capturedUrl.includes("session_number="), true);
    assert.equal(capturedUrl.includes("sessionId="), false);
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers["x-csrf-token"], "test_csrf_123");
    assert.equal(capturedOpts.headers["Content-Length"], "0");
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

test("Scrape.do retries the same token with customHeaders=false on 555 before rotating", async () => {
  const saved = {
    t1: process.env.SCRAPE_DO_TOKEN_1,
    t2: process.env.SCRAPE_DO_TOKEN_2,
    t3: process.env.SCRAPE_DO_TOKEN_3,
    t0: process.env.SCRAPE_DO_TOKEN,
  };

  try {
    process.env.SCRAPE_DO_TOKEN_1 = "token_alpha";
    process.env.SCRAPE_DO_TOKEN_2 = "token_beta";
    delete process.env.SCRAPE_DO_TOKEN_3;
    delete process.env.SCRAPE_DO_TOKEN;

    const calls = [];
    const res = await fetchViaScrapeDoWithRotation(
      "https://vidcore.io/APA91ywF/test",
      async (url, opts) => {
        const u = new URL(url);
        calls.push({ url: String(url), opts });
        const tok = u.searchParams.get("token");
        const custom = u.searchParams.get("customHeaders") === "true";
        if (tok === "token_alpha" && custom) {
          // First attempt with customHeaders=true -> rejected with 555
          return { status: 555, headers: { get: () => "555" } };
        }
        // Retry same token with customHeaders=false -> success
        return { status: 200, text: async () => "OK_RETRY" };
      },
      { method: "POST" },
    );

    assert.equal(res.status, 200);
    assert.equal(calls.length, 2, "Same token must be retried before rotating");
    const u0 = new URL(calls[0].url);
    const u1 = new URL(calls[1].url);
    assert.equal(u0.searchParams.get("token"), "token_alpha");
    assert.equal(u0.searchParams.get("customHeaders"), "true");
    assert.equal(u1.searchParams.get("token"), "token_alpha");
    assert.equal(u1.searchParams.get("customHeaders"), "false");
    assert.equal(u1.searchParams.get("session_number"), u0.searchParams.get("session_number"));
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
    const chunkMatch = t3.match(/\/_next\/static\/chunks\/281-[a-zA-Z0-9]+\.js/);
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
    cleanedHtml.includes('href="/_next/static/chunks/webpack.js?v=2"'),
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
    `https://hwto.proteome626.workers.dev/?ref=vidlink&url=${encodeURIComponent(mpdUrl)}`,
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
    `https://hwto.proteome626.workers.dev/?ref=vidlink&url=${encodeURIComponent(segUrl)}`,
  );

  // Test C: Subsequent DASH .m4s segment if resolved as root-relative /sacdn/dash/... via fetch
  const relSegPath =
    "/sacdn/dash/87308238/init-stream0.m4s?host=https%3A%2F%2Fsacdn.hakunaymatata.com&sc=abc123";
  const expectedResolvedSeg = `https://surge.flooderrr.store${relSegPath}`;
  const fetchRes = await sandbox.window.fetch(relSegPath);
  assert.equal(
    fetchedUrls[0],
    `https://hwto.proteome626.workers.dev/?ref=vidlink&url=${encodeURIComponent(expectedResolvedSeg)}`,
  );
  assert.equal(fetchRes.url, expectedResolvedSeg);

  // Test D: Direct .m3u8 and hakunaymatata.com .mp4 via fetch
  const hlsUrl = "https://sacdn.hakunaymatata.com/hls/movie/master.m3u8?token=xyz";
  await sandbox.window.fetch(hlsUrl);
  assert.equal(
    fetchedUrls[1],
    `https://hwto.proteome626.workers.dev/?ref=vidlink&url=${encodeURIComponent(hlsUrl)}`,
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

test("patchPlayerChunk intercepts error handler to suppress 555 error", () => {
  const mockChunkCode = `
    cR[[109,123,106,77,106,127,106,123].map(function(e){return String.fromCharCode(30^e)}).join("")]=Z;
  `;
  const patched = patchPlayerChunk(mockChunkCode, "/_next/static/chunks/player-test.js");
  assert.ok(patched.includes("if(v===555)"));

  let interceptedStatus = null;
  let postedMessages = [];
  const sandbox = {
    cR: {},
    Z: (val) => {
      interceptedStatus = val;
    },
    window: {
      parent: {
        postMessage: (msg) => postedMessages.push(msg),
      },
    },
    console: { warn: () => {} },
  };

  vm.runInNewContext(patched, sandbox);

  // Invoke the patched setState function with 555:
  sandbox.cR.setState(555);
  // Must NOT forward 555 to original Z and must NOT post 555 message
  assert.equal(interceptedStatus, null, "555 must be suppressed");
  assert.equal(postedMessages.length, 0, "555 must not postMessage");

  // Invoke with normal error status like 404:
  sandbox.cR.setState(404);
  assert.equal(interceptedStatus, 404);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].event, "status");
  assert.equal(postedMessages[0].data, 404);
});

test("Cache busting (?v=2), anti-freeze, and sandbox patches in vidcore", () => {
  // 1. Verify HTML sanitization adds ?v=2 to Next.js chunks
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
  assert.ok(sanitized.includes("/_next/static/chunks/281-d15eeb1ca15a1654.js?v=2"));
  assert.ok(sanitized.includes("/_next/static/chunks/main-app-14eacbf1653a965d.js?v=2"));
  // Ensure idempotent (no ?v=2?v=2)
  const sanitizedTwice = sanitizeVidcoreHtml(sanitized);
  assert.ok(!sanitizedTwice.includes("?v=2?v=2"));

  // 2. Verify patchPlayerChunk anti-freeze and sandbox bypass
  const mockCode = `
    function wrapper() {
      let t=[];for(let a=0;a<50;a++)t.push(e);let a=Date.now();return console.table(t),console.clear(),Date.now()-a<=10
      if(!tI.current&&(tI.current=!0,window.self!==window.top)){let t=()=>{document.body.innerHTML='<h1>Please Disable Sandbox</h1>'};}
      let{en:l,from:b,ad:h,mobile:u}=e;
      R.length>0&&(R.sort((e,t)=>e.track.label.localeCompare(t.track.label)),el(R))
    }
  `;
  // Verify chunk 281 remains completely clean and untouched
  const clean281 = patchPlayerChunk(mockCode, "/_next/static/chunks/281-d15eeb1ca15a1654.js");
  assert.equal(clean281, mockCode, "Chunk 281 must remain completely untouched");

  // Verify other chunks receive standard sandbox and ad bypasses
  const patched = patchPlayerChunk(mockCode, "/_next/static/chunks/main-app.js");
  assert.ok(patched.includes("return!0"), "Anti-freeze must return !0");
  assert.ok(patched.includes("if(!1)"), "Sandbox check must be bypassed with if(!1)");
  assert.ok(!patched.includes("Please Disable Sandbox"), "Please Disable Sandbox string must be stripped");
  assert.ok(patched.includes("let h=!1,{en:l,from:b,ad:_h_ignored,"), "Ad prop must be forced to false");

  // Verify valid syntax by compiling with vm.Script
  assert.doesNotThrow(() => {
    new vm.Script(patched);
  }, "Patched chunk must have zero syntax errors");
});


