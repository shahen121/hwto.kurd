const test = require("node:test");
const assert = require("node:assert/strict");

test("buildExtractUrl targets the worker /extract endpoint with all params", async () => {
  const { buildExtractUrl } = await import("../src/utils/directStream.js");
  const url = new URL(
    buildExtractUrl({ type: "tv", id: 220542, season: 1, episode: 2, serverKey: "2embed" }),
  );
  assert.equal(url.origin, "https://hwto.proteome626.workers.dev");
  assert.equal(url.pathname, "/extract");
  assert.equal(url.searchParams.get("type"), "tv");
  assert.equal(url.searchParams.get("id"), "220542");
  assert.equal(url.searchParams.get("s"), "1");
  assert.equal(url.searchParams.get("e"), "2");
  assert.equal(url.searchParams.get("server"), "2embed");
});

test("fetchExtractedStream returns the worker stream, then fallback, then ok:false", async () => {
  const { fetchExtractedStream } = await import("../src/utils/directStream.js");
  const params = { type: "movie", id: 550, serverKey: "vidsrc" };

  const okFetch = async () => ({
    ok: true,
    json: async () => ({ streamUrl: "https://hwto.proteome626.workers.dev/stream-proxy/x.m3u8" }),
  });
  const r1 = await fetchExtractedStream(params, { fetchImpl: okFetch });
  assert.deepEqual(r1, {
    ok: true,
    streamUrl: "https://hwto.proteome626.workers.dev/stream-proxy/x.m3u8",
    source: "worker",
  });

  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const r2 = await fetchExtractedStream(params, {
    fetchImpl: notFound,
    fallbackResolver: async () => ({ ok: true, streamUrl: "https://cdn.example/fallback.m3u8" }),
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.source, "fallback");

  const boom = async () => {
    throw new Error("network");
  };
  const r3 = await fetchExtractedStream(params, { fetchImpl: boom });
  assert.equal(r3.ok, false);

  const badBody = async () => ({ ok: true, json: async () => ({ streamUrl: "javascript:alert(1)" }) });
  const r4 = await fetchExtractedStream(params, { fetchImpl: badBody });
  assert.equal(r4.ok, false, "non-http stream URLs must be rejected");
});

test("getDirectServerKey maps extra servers (and legacy aliases) to extractor keys", async () => {
  const { getDirectServerKey } = await import("../src/utils/api.js");
  assert.equal(getDirectServerKey("vidsrc_me"), "vidsrc");
  assert.equal(getDirectServerKey("vidsrc_cc"), "vidsrc");
  assert.equal(getDirectServerKey("multiembed"), "multiembed");
  assert.equal(getDirectServerKey("embedsu"), "multiembed");
  assert.equal(getDirectServerKey("2embed"), "2embed");
  assert.equal(getDirectServerKey("autoembed"), "2embed");
  assert.equal(getDirectServerKey("vidcore"), null);
  assert.equal(getDirectServerKey("vidlink"), null);
});
