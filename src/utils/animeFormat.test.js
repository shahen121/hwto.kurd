import test from "node:test";
import assert from "node:assert/strict";
import { getAnimeSeasonTranslationKey } from "./animeFormat.js";

test("season formatting safely handles an unexpected array value", () => {
  assert.equal(getAnimeSeasonTranslationKey(["WINTER"]), "");
});

test("season formatting returns translation keys only for known season strings", () => {
  assert.equal(getAnimeSeasonTranslationKey("WINTER"), "animeWinter");
  assert.equal(getAnimeSeasonTranslationKey("spring"), "animeSpring");
  assert.equal(getAnimeSeasonTranslationKey("unknown"), "");
  assert.equal(getAnimeSeasonTranslationKey({ name: "FALL" }), "");
  assert.equal(getAnimeSeasonTranslationKey(null), "");
});
