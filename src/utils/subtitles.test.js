import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGithubSubtitle,
  R2_SUBTITLES_BASE_URL,
  getSubtitleMeta,
} from "./subtitles.js";

test("R2 Subtitle Meta: Language names correctly labeled", () => {
  assert.equal(getSubtitleMeta("ar").label, "العربية");
  assert.equal(getSubtitleMeta("ar").flag, "🇸🇦");
  assert.equal(getSubtitleMeta("ku").label, "Kurdî");
  assert.equal(getSubtitleMeta("ku").flag, "☀️");
  assert.equal(getSubtitleMeta("ckb").label, "Kurdî");
  assert.equal(getSubtitleMeta("en").label, "English");
});

test("R2 Movie Subtitles: Resolves available languages and generates direct vtt links", async () => {
  // Test with movie 346364 which exists in Cloudflare R2
  const result = await resolveGithubSubtitle({
    type: "movie",
    tmdbId: 346364,
    preferredLang: "ar",
  });

  assert.ok(result, "Result should not be null for existing movie 346364");
  assert.equal(result.lang, "ar");
  assert.equal(
    result.url,
    `${R2_SUBTITLES_BASE_URL}/movie/346364/ar.vtt`,
  );
  assert.ok(Array.isArray(result.available));
  assert.ok(result.available.length >= 2);

  const arSub = result.available.find((s) => s.lang === "ar");
  assert.ok(arSub);
  assert.equal(arSub.label, "العربية");
  assert.equal(arSub.url, `${R2_SUBTITLES_BASE_URL}/movie/346364/ar.vtt`);
  assert.equal(arSub.isDefault, true);

  const kuSub = result.available.find((s) => s.lang === "ku");
  assert.ok(kuSub);
  assert.equal(kuSub.label, "Kurdî");
  assert.equal(kuSub.url, `${R2_SUBTITLES_BASE_URL}/movie/346364/ku.vtt`);
  assert.equal(kuSub.isDefault, false);
});

test("R2 Preferred Language Selection: Correctly honors English and any preferred language", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes("/movie/88888/info.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            subtitles: ["ar", "ku", "en"],
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    const res = await resolveGithubSubtitle({
      type: "movie",
      tmdbId: 88888,
      preferredLang: "en",
    });

    assert.ok(res);
    assert.equal(res.lang, "en");
    assert.equal(res.url, `${R2_SUBTITLES_BASE_URL}/movie/88888/en.vtt`);
    const enTrack = res.available.find((s) => s.lang === "en");
    assert.ok(enTrack);
    assert.equal(enTrack.isDefault, true);
    const arTrack = res.available.find((s) => s.lang === "ar");
    assert.equal(arTrack.isDefault, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 Series Subtitles: Parses season and episode keys correctly (including s1/e1 and number formats)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url.includes("/series/99999/info.json")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            "1": {
              "1": ["ar", "ku"],
              "2": ["ku"],
            },
            "2": {
              "1": ["ar"],
            },
            "s3": {
              "e1": ["ku", "ar"],
            },
          }),
        };
      }
      return { ok: false, status: 404 };
    };

    // S1 E1
    const resS1E1 = await resolveGithubSubtitle({
      type: "tv",
      tmdbId: 99999,
      season: 1,
      episode: 1,
      preferredLang: "ku",
    });

    assert.ok(resS1E1);
    assert.equal(resS1E1.lang, "ku");
    assert.equal(
      resS1E1.url,
      `${R2_SUBTITLES_BASE_URL}/series/99999/s1/e1_ku.vtt`,
    );
    assert.equal(resS1E1.available.length, 2);
    assert.equal(resS1E1.available[0].label, "العربية");
    assert.equal(resS1E1.available[1].label, "Kurdî");

    // S1 E2
    const resS1E2 = await resolveGithubSubtitle({
      type: "series",
      tmdbId: 99999,
      season: 1,
      episode: 2,
    });
    assert.ok(resS1E2);
    assert.equal(resS1E2.lang, "ku");
    assert.equal(
      resS1E2.url,
      `${R2_SUBTITLES_BASE_URL}/series/99999/s1/e2_ku.vtt`,
    );
    assert.equal(resS1E2.available.length, 1);

    // S3 E1 (with s3 / e1 string prefixes in schema)
    const resS3E1 = await resolveGithubSubtitle({
      tmdbId: 99999,
      season: 3,
      episode: 1,
      preferredLang: "ar",
    });
    assert.ok(resS3E1);
    assert.equal(resS3E1.lang, "ar");
    assert.equal(
      resS3E1.url,
      `${R2_SUBTITLES_BASE_URL}/series/99999/s3/e1_ar.vtt`,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 Subtitles 404 Prevention: Cleanly returns null on 404 or errors without throwing", async () => {
  const missingMovie = await resolveGithubSubtitle({
    type: "movie",
    tmdbId: 999999999,
  });
  assert.equal(missingMovie, null);

  const missingSeries = await resolveGithubSubtitle({
    type: "tv",
    tmdbId: 999999999,
    season: 1,
    episode: 1,
  });
  assert.equal(missingSeries, null);

  // Missing ID returns null immediately
  const emptyCall = await resolveGithubSubtitle({
    type: "movie",
    tmdbId: null,
  });
  assert.equal(emptyCall, null);
});
