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
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
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

test("getSourceUrl correctly generates clean URLs for active servers (VidCore & VidLink) and handles fallbacks", async () => {
  const { getSourceUrl, PLAYER_SOURCES } = await import("../src/utils/api.js");

  // Verify only 2 fast servers are active
  assert.equal(PLAYER_SOURCES.length, 2);
  assert.equal(PLAYER_SOURCES[0].id, "vidcore");
  assert.equal(PLAYER_SOURCES[1].id, "vidlink");

  // Server 1: Vidcore (supports internal proxy subtitle tracks with same-origin)
  const s1 = getSourceUrl("vidcore", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s1.includes("/vidcore/movie/550"));
  assert.ok(s1.includes("sub_url_ku="));
  assert.ok(s1.includes("sub_url_ar="));
  const decS1 = decodeURIComponent(s1);
  assert.ok(decS1.includes("/subtitles/movie/550/ku.vtt"), "Must use same-origin /subtitles path");
  assert.ok(!decS1.includes("r2.dev"), "Must NOT pass cross-origin r2.dev directly");

  // Server 2: Vidlink (supports documented sub_file with same-origin)
  const s2 = getSourceUrl("vidlink", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(s2.includes("/vidlink/movie/550"));
  assert.ok(s2.includes("sub_file="));
  assert.ok(s2.includes("sub_label="));
  const decS2 = decodeURIComponent(s2);
  assert.ok(decS2.includes("/subtitles/movie/550/ku.vtt"), "Must use same-origin /subtitles path");
  assert.ok(!decS2.includes("r2.dev"), "Must NOT pass cross-origin r2.dev directly");

  // TV URLs
  const s1Tv = getSourceUrl("vidcore", "tv", 220542, 1, 1, {}, "e50914", "ku");
  assert.ok(s1Tv.includes("/vidcore/tv/220542/1/1"));
  const s2Tv = getSourceUrl("vidlink", "tv", 220542, 1, 1, {}, "e50914", "ar");
  assert.ok(s2Tv.includes("/vidlink/tv/220542/1/1"));

  // Legacy/obsolete server keys safely fall back to the default server (vidcore)
  const fallback = getSourceUrl("vidsrc_me", "movie", 550, null, null, {}, "e50914", "ku");
  assert.ok(fallback.includes("/vidcore/movie/550"));
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

test("UNIVERSAL_SUBTITLE_INJECTOR_JS rewrites external r2.dev URLs to same-origin and sets video crossorigin", () => {
  const appendedTracks = [];
  const fakeVideo = {
    attributes: {},
    crossOrigin: null,
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = val; },
    querySelectorAll() { return []; },
    appendChild(el) { appendedTracks.push(el); },
    addEventListener() {},
  };

  const fakeDoc = {
    readyState: "complete",
    querySelectorAll(selector) {
      if (selector === "video") return [fakeVideo];
      return [];
    },
    createElement(tag) {
      return {
        tagName: tag,
        kind: "",
        label: "",
        srclang: "",
        src: "",
      };
    },
    addEventListener() {},
  };

  const sandbox = {
    window: null,
    document: fakeDoc,
    URL,
    URLSearchParams,
    HTMLTrackElement: { prototype: { src: "" } },
    Blob,
    fetch: async () => ({ ok: true, text: async () => "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nHello" }),
    setTimeout: (fn) => fn(),
  };
  sandbox.window = sandbox;
  sandbox.window.location = {
    origin: "https://hwto-kurd.vercel.app",
    href: "https://hwto-kurd.vercel.app/vidcore/movie/550?sub_url=https%3A%2F%2Fpub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev%2Fmovie%2F550%2Fku.vtt",
    search: "?sub_url=https%3A%2F%2Fpub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev%2Fmovie%2F550%2Fku.vtt",
    pathname: "/vidcore/movie/550",
  };

  const vm = require("node:vm");
  vm.runInNewContext(UNIVERSAL_SUBTITLE_INJECTOR_JS, sandbox);

  // 1. Video element must have crossorigin="anonymous" set
  assert.equal(fakeVideo.crossOrigin, "anonymous");
  assert.equal(fakeVideo.getAttribute("crossorigin"), "anonymous");

  // 2. Attached tracks must have been converted to same-origin /subtitles/... (not external r2.dev)
  assert.ok(appendedTracks.length > 0, "Tracks must be injected");
  for (const tr of appendedTracks) {
    assert.ok(
      tr.src.startsWith("https://hwto-kurd.vercel.app/subtitles/") || tr.src.startsWith("blob:"),
      `Track src ${tr.src} must be same-origin or blob URL`,
    );
    assert.ok(!tr.src.includes("pub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev"));
  }
});

