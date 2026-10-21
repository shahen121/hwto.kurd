const { test } = require("node:test");
const assert = require("node:assert/strict");
const { handleFootballRequest } = require("./football");

test("API-Football proxy restricts endpoints and keeps the key server-side", async () => {
  let requestedUrl;
  let requestHeaders;
  const result = await handleFootballRequest({
    method: "GET",
    path: "/fixtures",
    query: { league: "39", season: "2026", date: "2026-10-21" },
    key: "server-only-test-key",
    fetchImpl: async (url, options) => {
      requestedUrl = new URL(url);
      requestHeaders = options.headers;
      return { ok: true, json: async () => ({ response: [{ fixture: { id: 123 } }] }) };
    },
  });

  assert.equal(result.status, 200);
  assert.equal(requestedUrl.pathname, "/fixtures");
  assert.equal(requestedUrl.searchParams.get("league"), "39");
  assert.equal(requestHeaders["x-apisports-key"], "server-only-test-key");
  assert.equal(JSON.stringify(result.body).includes("server-only-test-key"), false);

  const rejected = await handleFootballRequest({
    path: "/players",
    query: { league: "39", season: "2026" },
    key: "server-only-test-key",
  });
  assert.equal(rejected.status, 400);
});

test("API-Football proxy rejects missing configuration and unsafe query values", async () => {
  const missingKey = await handleFootballRequest({
    path: "/standings",
    query: { league: "39", season: "2026" },
  });
  assert.equal(missingKey.status, 503);

  const invalidQuery = await handleFootballRequest({
    path: "/fixtures",
    query: {
      league: "39",
      season: "2026",
      date: "2026-10-21",
      arbitrary: "https://attacker.invalid",
    },
    key: "server-only-test-key",
  });
  assert.equal(invalidQuery.status, 400);
});
