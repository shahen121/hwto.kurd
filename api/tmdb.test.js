const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { handleTmdbRequest } = require("./tmdb");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

test("Kurdish TMDB responses retain the English overview for on-demand translation", async () => {
  global.fetch = async (url) => {
    const isEnglish = url.includes("language=en-US");
    const body = isEnglish
      ? { id: 123, title: "Hope", overview: "An English synopsis." }
      : { id: 123, title: "ئومێد", overview: "" };
    return { ok: true, status: 200, json: async () => body };
  };

  const { body } = await handleTmdbRequest({
    method: "GET",
    path: "/movie/123?language=ku-TR",
    token: "test-token",
  });

  assert.equal(body.title, "Hope");
  assert.equal(body.overview, "");
  assert.equal(body.overview_en, "An English synopsis.");
});

test("English overviews are not duplicated across localized search results", async () => {
  global.fetch = async (url) => {
    const isEnglish = url.includes("language=en-US");
    const item = isEnglish
      ? { id: 123, title: "Hope", overview: "An English synopsis." }
      : { id: 123, title: "ئومێد", overview: "" };
    return {
      ok: true,
      status: 200,
      json: async () => ({ results: [item] }),
    };
  };

  const { body } = await handleTmdbRequest({
    method: "GET",
    path: "/search/movie?query=Hope&language=ku-TR",
    token: "test-token",
  });

  assert.equal(body.results[0].title, "Hope");
  assert.equal(body.results[0].overview_en, undefined);
});
