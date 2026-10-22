import assert from "node:assert/strict";
import { test } from "node:test";
import {
  certToMinAge,
  getAgeLimitSetting,
  isRestricted,
} from "./ageRating.js";

test("missing, disabled, and malformed age limits do not restrict content", () => {
  const values = new Map([
    ["missing", null],
    ["disabled", ""],
    ["malformed", "not-a-number"],
    ["negative", -1],
    ["above-rating-range", 19],
    ["too-large", 121],
  ]);
  for (const key of values.keys()) {
    const limit = getAgeLimitSetting({
      get: () => values.get(key),
    });
    assert.equal(limit, null, `${key} age limit should be treated as unset`);
    assert.equal(isRestricted(18, limit), false);
  }
});

test("configured age limits restrict only content above the selected limit", () => {
  const storage = { get: () => "13" };
  const limit = getAgeLimitSetting(storage);
  const seriesMinAge = certToMinAge("TV-MA", "US");

  assert.equal(limit, 13);
  assert.equal(seriesMinAge, 18);
  assert.equal(isRestricted(seriesMinAge, limit), true);
  assert.equal(isRestricted(13, limit), false);
  assert.equal(isRestricted(14, limit), true);
});
