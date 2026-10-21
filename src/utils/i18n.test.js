const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("vite");

let server;
let translations;

before(async () => {
  server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });
  ({ TRANSLATIONS: translations } = await server.ssrLoadModule(
    "/src/utils/i18n.js",
  ));
});

after(async () => {
  await server?.close();
});

test("every supported language has complete, non-empty translations", () => {
  const languages = Object.keys(translations);
  const expectedKeys = Object.keys(translations.en).sort();

  for (const language of languages) {
    const dictionary = translations[language];
    assert.deepEqual(
      Object.keys(dictionary).sort(),
      expectedKeys,
      `${language} translation keys must match English without missing or extra entries`,
    );

    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(
        typeof value,
        "string",
        `${language}.${key} must be a string`,
      );
      assert.ok(value.trim(), `${language}.${key} must not be empty`);
    }
  }
});

test("translated strings preserve every interpolation placeholder", () => {
  const placeholderPattern = /\{[a-zA-Z0-9_]+\}/g;
  const placeholders = (value) =>
    [...value.matchAll(placeholderPattern)]
      .map(([placeholder]) => placeholder)
      .sort();

  for (const [key, englishValue] of Object.entries(translations.en)) {
    for (const language of Object.keys(translations)) {
      assert.deepEqual(
        placeholders(translations[language][key]),
        placeholders(englishValue),
        `${language}.${key} must preserve English interpolation placeholders`,
      );
    }
  }
});
