const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("vite");

let server;
let translateToSorani;
const originalFetch = global.fetch;

before(async () => {
  server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });
  ({ translateToSorani } = await server.ssrLoadModule(
    "/src/utils/translation.js",
  ));
});

after(async () => {
  global.fetch = originalFetch;
  await server?.close();
});

test("translateToSorani requests Sorani and returns the translated synopsis", async () => {
  global.fetch = async (url) => {
    const request = new URL(url);
    assert.equal(request.searchParams.get("langpair"), "en|ckb");
    assert.equal(request.searchParams.get("q"), "An English synopsis.");
    return {
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: "وەسفێکی کوردی." },
      }),
    };
  };

  assert.equal(await translateToSorani("An English synopsis."), "وەسفێکی کوردی.");
});

test("translateToSorani splits long descriptions into service-sized requests", async () => {
  const requests = [];
  global.fetch = async (url) => {
    requests.push(new URL(url).searchParams.get("q"));
    return {
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: "کوردی" },
      }),
    };
  };

  const synopsis = "A story about a family. ".repeat(30);
  assert.equal(await translateToSorani(synopsis), "کوردی کوردی");
  assert.equal(requests.length, 2);
  assert.ok(requests.every((chunk) => chunk.length <= 450));
});
