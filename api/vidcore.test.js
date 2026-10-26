const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const vm = require("node:vm");
const app = require("../server.js");
const {
  getScrapeDoTokens,
  fetchViaScrapeDoWithRotation,
  AD_SHIELD_JS,
  sanitizeVidlinkHtml,
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

    // 4. Chunk 281 is patched with Cloudflare Worker URL, ad-blocking, and subtitle fixes
    const chunkMatch = t3.match(/\/_next\/static\/chunks\/281-[a-zA-Z0-9]+\.js/);
    assert.ok(chunkMatch, "Should find chunk 281 in Vidcore HTML");
    const r4 = await fetch(`${base}${chunkMatch[0]}`);
    assert.equal(r4.status, 200);
    const t4 = await r4.text();
    assert.equal(
      t4.includes("https://hwto.proteome626.workers.dev"),
      true,
      "Chunk 281 must route streams to Cloudflare Worker",
    );
    assert.equal(
      t4.includes("let h=!1,{en:l,from:b,ad:_h_ignored,"),
      true,
      "Chunk 281 must force ad prop to false",
    );
    assert.equal(
      t4.includes("window.__VC_STREAM_ERR"),
      true,
      "Chunk 281 must include instant sub-server failover on stream 404/error",
    );
    assert.equal(
      t4.includes('unicodeBidi:"plaintext"'),
      true,
      "Chunk 281 must apply unicodeBidi plaintext and line-wrapping to subtitles",
    );
    assert.equal(
      t4.includes("R.forEach(function(x){x.selected=!1;})"),
      true,
      "Chunk 281 must prioritize custom sub_url at the top of the subtitle list",
    );

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
  assert.equal(cleanedHtml.includes('href="/_next/static/chunks/webpack.js"'), true);

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
