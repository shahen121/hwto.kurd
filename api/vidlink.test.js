const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const app = require("../server.js");
const {
  handleVidlinkProxy,
  vidlinkStaticCache,
  fetchVidlinkHtmlFast,
} = require("./vidlink.js");
const {
  subtitlesHandler,
  UNIVERSAL_SUBTITLE_INJECTOR_JS,
  sanitizeSubtitleRelPath,
} = require("./subtitles.js");

test("Vidlink Static Chunks: Fast direct fetch with in-memory Map cache and immutable header", async () => {
  const dummyChunk = "/_next/static/chunks/fast-chunk-999.js";
  const dummyBody = 'console.log("fast chunk code");';
  vidlinkStaticCache.set(dummyChunk, {
    body: dummyBody,
    contentType: "application/javascript; charset=utf-8",
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Direct fetch to /vidlink/_next/static/...
    const res = await fetch(`${base}/vidlink${dummyChunk}`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), dummyBody);
    assert.equal(
      res.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
  } finally {
    server.close();
    vidlinkStaticCache.delete(dummyChunk);
  }
});

test("Vidlink HTML: Preconnect header, ad limits, and universal subtitle script injection", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/vidlink/movie/550`);
    assert.equal(res.status, 200);
    const html = await res.text();

    // 1. Preconnect to Cloudflare Worker
    assert.ok(
      html.includes('rel="preconnect" href="https://hwto.proteome626.workers.dev"'),
      "Must include preconnect link to worker",
    );

    // 2. Universal Subtitles Script
    assert.ok(
      html.includes('id="hwto-universal-subs"'),
      "Must include universal subtitles script",
    );

    // 3. Fast Vidlink header
    assert.equal(res.headers.get("x-vidlink-speed"), "Fast");
  } finally {
    server.close();
  }
});

test("Vidlink Proxy Utilities: /gtag-shield.js and /stream-proxy/ with Vidlink referer", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Fetch /gtag-shield.js with Vidlink referer
    const shieldRes = await fetch(`${base}/gtag-shield.js`, {
      headers: { Referer: `${base}/vidlink/movie/550` },
    });
    assert.equal(shieldRes.status, 200);
    assert.ok(
      shieldRes.headers.get("content-type").includes("javascript"),
      "Must be javascript content-type",
    );
    const shieldJs = await shieldRes.text();
    assert.ok(
      shieldJs.includes("window.__vidcoreShieldInitialized"),
      "Must contain ad shield script",
    );

    // 2. Fetch /stream-proxy/ref/* with Vidlink referer
    const proxyRes = await fetch(
      `${base}/stream-proxy/ref/https/example.com/stream.m3u8`,
      {
        headers: { Referer: `${base}/vidlink/movie/550` },
        redirect: "manual",
      },
    );
    assert.equal(proxyRes.status, 302);
    assert.ok(
      proxyRes.headers.get("location").includes("https://hwto.proteome626.workers.dev/stream-proxy/ref/"),
      "Must redirect stream to worker",
    );
  } finally {
    server.close();
  }
});

test("Universal Subtitles API: /api/subtitles provides Kurdish and Arabic tracks", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/api/subtitles?type=movie&id=550`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.id, "550");
    assert.ok(Array.isArray(data.subtitles));
    assert.ok(data.subtitles.some((s) => s.lang === "ku"));
    assert.ok(data.subtitles.some((s) => s.lang === "ar"));

    // TV Subtitles query
    const tvRes = await fetch(`${base}/api/subtitles?type=tv&id=1399&season=1&episode=1`);
    assert.equal(tvRes.status, 200);
    const tvData = await tvRes.json();
    assert.equal(tvData.ok, true);
    assert.equal(tvData.season, "1");
    assert.equal(tvData.episode, "1");
    assert.ok(tvData.subtitles.some((s) => s.url.includes("s1e1")));
  } finally {
    server.close();
  }
});

test("Universal Subtitles: Path normalization and direct file streaming without path duplication", async () => {
  // Test sanitizeSubtitleRelPath
  assert.equal(sanitizeSubtitleRelPath("/subtitles/movie/550/ku.vtt"), path.normalize("movie/550/ku.vtt"));
  assert.equal(sanitizeSubtitleRelPath("subtitles/movie/550/ku.vtt"), path.normalize("movie/550/ku.vtt"));
  assert.equal(sanitizeSubtitleRelPath("movie/550/ku.vtt"), path.normalize("movie/550/ku.vtt"));

  // Create temporary test subtitle file
  const testSubDir = path.join(__dirname, "..", "public", "subtitles", "movie", "9999");
  fs.mkdirSync(testSubDir, { recursive: true });
  const testSubFile = path.join(testSubDir, "ku.vtt");
  const testVttContent = "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nتاقیکردنەوەی ژێرنووس";
  fs.writeFileSync(testSubFile, testVttContent);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Direct stream via /api/subtitles?file=
    const res = await fetch(`${base}/api/subtitles?file=/subtitles/movie/9999/ku.vtt`);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type").includes("text/vtt"));
    assert.equal(await res.text(), testVttContent);

    // 2. Direct static fetch via /subtitles/movie/9999/ku.vtt
    const staticRes = await fetch(`${base}/subtitles/movie/9999/ku.vtt`);
    assert.equal(staticRes.status, 200);
    assert.equal(await staticRes.text(), testVttContent);

    // 3. Missing subtitle returns 200 OK with valid empty WEBVTT, NOT 404 and NOT index.html
    const missingRes = await fetch(`${base}/subtitles/movie/00000000/ku.vtt`);
    assert.equal(missingRes.status, 200);
    assert.ok(missingRes.headers.get("content-type").includes("text/vtt"));
    assert.equal(missingRes.headers.get("access-control-allow-origin"), "*");
    assert.equal(await missingRes.text(), "WEBVTT\n\n");
  } finally {
    server.close();
    fs.rmSync(testSubDir, { recursive: true, force: true });
  }
});

test("getSourceUrl embeds universal subtitle parameters across all 5 servers", async () => {
  const { getSourceUrl } = await import("../src/utils/api.js");

  const s1 = getSourceUrl("vidcore", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s1.includes("sub_url_ku="));
  assert.ok(s1.includes("sub_url_ar="));

  const s2 = getSourceUrl("vidlink", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s2.includes("sub_file="));
  assert.ok(s2.includes("sub_label="));

  const s3 = getSourceUrl("autoembed", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s3.includes("sub_url="));
  assert.ok(s3.includes("sub_label="));
  assert.ok(s3.includes("ds_lang="));

  const s4 = getSourceUrl("vidsrc_me", "movie", 550, null, null, {}, "e50914", "ar");
  assert.ok(s4.includes("vidsrc.me"));
  assert.ok(s4.includes("sub_url="));
  assert.ok(s4.includes("ds_lang=ar"));

  const s4Alias = getSourceUrl("vidsrc_cc", "movie", 550, null, null, {}, "e50914", "ar");
  assert.ok(s4Alias.includes("vidsrc.me"));

  const s5 = getSourceUrl("multiembed", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s5.includes("multiembed.mov"));
  assert.ok(s5.includes("sub_url="));
  assert.ok(s5.includes("sub_label="));

  const s5Alias = getSourceUrl("embedsu", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s5Alias.includes("multiembed.mov"));
});

test("Subtitle 404 Prevention: missing TV subtitles return 200 OK with valid empty WEBVTT and CORS header, even with TV referer", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    // 1. Kurdish TV subtitle request with TV referer
    const kuRes = await fetch(`${base}/subtitles/tv/220542/s1e1/ku.vtt`, {
      headers: { Referer: `${base}/tv/220542/1/1` },
    });
    assert.equal(kuRes.status, 200);
    assert.ok(kuRes.headers.get("content-type").includes("text/vtt"));
    assert.equal(kuRes.headers.get("access-control-allow-origin"), "*");
    assert.equal(await kuRes.text(), "WEBVTT\n\n");

    // 2. Arabic TV subtitle request with TV referer
    const arRes = await fetch(`${base}/subtitles/tv/220542/s1e1/ar.vtt`, {
      headers: { Referer: `${base}/tv/220542/1/1` },
    });
    assert.equal(arRes.status, 200);
    assert.ok(arRes.headers.get("content-type").includes("text/vtt"));
    assert.equal(arRes.headers.get("access-control-allow-origin"), "*");
    assert.equal(await arRes.text(), "WEBVTT\n\n");
  } finally {
    server.close();
  }
});
