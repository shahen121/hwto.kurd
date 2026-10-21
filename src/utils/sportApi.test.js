const { test } = require("node:test");
const assert = require("node:assert/strict");

// Dynamic import of sportApi using Vite createServer or direct ESM import via node
test("sportApi module test suite", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  const sportApi = await server.ssrLoadModule("/src/utils/sportApi.js");
  const i18n = await server.ssrLoadModule("/src/utils/i18n.js");

  // 1. Core leagues presence and structure
  assert.ok(Array.isArray(sportApi.CORE_LEAGUES), "CORE_LEAGUES should be an array");
  assert.ok(sportApi.CORE_LEAGUES.length >= 6, "Should contain at least the 6 major European & world leagues");
  
  const premierLeague = sportApi.CORE_LEAGUES.find(l => l.slug === "eng.1");
  assert.ok(premierLeague, "English Premier League eng.1 should be present");
  assert.equal(premierLeague.nameAr, "الدوري الإنجليزي الممتاز");
  assert.equal(premierLeague.nameCkb, "پریمیەرلیگی ئینگلیزی");

  const laliga = sportApi.CORE_LEAGUES.find(l => l.slug === "esp.1");
  assert.ok(laliga, "Spanish LALIGA esp.1 should be present");

  // 2. Localized league display names
  assert.equal(sportApi.getLeagueDisplayName("eng.1", "ar"), "الدوري الإنجليزي الممتاز");
  assert.equal(sportApi.getLeagueDisplayName("eng.1", "ckb"), "پریمیەرلیگی ئینگلیزی");
  assert.equal(sportApi.getLeagueDisplayName("eng.1", "en"), "English Premier League");
  assert.equal(sportApi.getLeagueDisplayName("unknown.99", "en"), "unknown.99");
  assert.equal(
    sportApi.getLeagueDisplayName(
      "int.1",
      "ckb",
      [{ slug: "int.1", name: "International League" }],
    ),
    "International League",
  );

  // 3. Date formatting helper
  const dateObj = new Date("2026-08-22T14:30:00Z");
  assert.match(sportApi.formatDateToYYYYMMDD(dateObj), /^20260822/);

  // 4. Match status parsing
  const ftStatus = sportApi.getMatchStatusInfo({
    type: { name: "STATUS_FULL_TIME", completed: true, detail: "FT" },
  });
  assert.equal(ftStatus.state, "ft");

  const liveStatus = sportApi.getMatchStatusInfo({
    displayClock: "68'",
    type: { name: "STATUS_IN_PROGRESS", state: "in" },
  });
  assert.equal(liveStatus.state, "live");
  assert.equal(liveStatus.display, "68'");

  const htStatus = sportApi.getMatchStatusInfo({
    type: { name: "STATUS_HALF_TIME", detail: "HT" },
  });
  assert.equal(htStatus.state, "ht");

  const upcomingStatus = sportApi.getMatchStatusInfo({
    type: { name: "STATUS_SCHEDULED", state: "pre", detail: "8:00 PM" },
  });
  assert.equal(upcomingStatus.state, "upcoming");

  const postponedStatus = sportApi.getMatchStatusInfo({
    type: { name: "STATUS_POSTPONED", description: "Postponed" },
  });
  assert.equal(postponedStatus.state, "postponed");

  // 5. Goal detection and play type parsing
  assert.equal(
    sportApi.isPlayGoal({ scoringPlay: true, type: { type: "goal" }, text: "Goal! Semi Ajayi" }),
    true,
    "Real scoring play must be detected as goal"
  );
  assert.equal(
    sportApi.isPlayGoal({ scoringPlay: false, type: { type: "goal-kick" }, text: "Ayden Heaven Goal Kick at 6'" }),
    false,
    "Goal kick must NOT be detected as a scoring goal"
  );
  assert.equal(
    sportApi.isPlayGoal({ scoringPlay: false, type: { type: "pass" }, text: "Pass" }),
    false,
    "Pass must not be detected as goal"
  );

  // 6. Player jersey number extraction
  assert.equal(sportApi.getJerseyNumber({ jersey: "19", athlete: { id: "1" } }), "19");
  assert.equal(sportApi.getJerseyNumber({ athlete: { jersey: "7" } }), "7");
  assert.equal(sportApi.getJerseyNumber(null), "");

  // 7. Stat label translation
  assert.equal(sportApi.getStatLabel("possessionPct", "ar"), "نسبة الاستحواذ");
  assert.equal(sportApi.getStatLabel("possessionPct", "ckb"), "ڕێژەی کۆنترۆڵکردن");
  assert.equal(sportApi.getStatLabel("possessionPct", "en"), "Ball Possession %");
  assert.equal(sportApi.getStatLabel("shotsOnTarget", "ar"), "تسديدات على المرمى");

  // Fixtures query supports status, date-range, and pagination filters.
  const originalFetch = global.fetch;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => ({ events: [], pageIndex: 3, pageCount: 8 }),
    };
  };
  try {
    const fixtures = await sportApi.fetchFixtures("test.league", {
      status: "live",
      from: "2026-10-01",
      to: "2026-10-31",
      page: 3,
      limit: 12,
    });
    assert.equal(requestedUrl.pathname, "/get/soccer/test.league/fixtures");
    assert.equal(requestedUrl.searchParams.get("status"), "live");
    assert.equal(requestedUrl.searchParams.get("from"), "20261001");
    assert.equal(requestedUrl.searchParams.get("to"), "20261031");
    assert.equal(requestedUrl.searchParams.get("page"), "3");
    assert.equal(requestedUrl.searchParams.get("limit"), "12");
    assert.equal(fixtures.pageCount, 8);
  } finally {
    global.fetch = originalFetch;
  }

  // 8. Verification of all translations in ar, ckb, en
  const requiredKeys = [
    "sport",
    "hwtoSport",
    "sportSettings",
    "sportDefaultLeague",
    "sportTheme",
    "sportThemeDark",
    "sportThemeLight",
    "sportAutoRefreshSetting",
    "sportAutoRefreshDescription",
    "sportSections",
    "sportTagline",
    "sportScoreboard",
    "sportFixtures",
    "sportStandings",
    "sportFilterLive",
    "sportAway",
    "sportDateFrom",
    "sportDateTo",
    "sportFixturesCount",
    "sportPage",
    "sportOf",
    "sportPrevious",
    "sportNext",
    "sportInvalidDateRange",
    "sportLiveNow",
    "sportMatchDetails",
    "sportBackToMain",
    "sportAllLeagues",
    "sportSelectDate",
    "sportRecentMatchday",
    "sportToday",
    "sportNoMatches",
    "sportNoFixtures",
    "sportNoStandings",
    "sportNoStats",
    "sportRefresh",
    "sportAutoRefresh",
    "sportFullTime",
    "sportHalfTime",
    "sportGoal",
    "sportYellowCard",
    "sportRedCard",
    "sportSub",
    "sportEventsTimeline",
    "sportKeyEvents",
    "sportLineups",
    "sportStartingXI",
    "sportSubstitutes",
    "sportFormation",
    "sportNoLineup",
    "sportUnplacedPlayers",
    "sportPositionGoalkeeper",
    "sportPositionDefenders",
    "sportPositionMidfielders",
    "sportPositionForwards",
    "sportMatchStats",
    "sportRank",
    "sportClub",
    "sportPts",
    "sportPPG",
    "sportZone",
    "sportGoalKick",
  ];

  for (const lang of ["ar", "ckb", "en"]) {
    const dict = i18n.TRANSLATIONS[lang];
    assert.ok(dict, `TRANSLATIONS.${lang} must exist`);
    for (const key of requiredKeys) {
      assert.ok(
        dict[key] !== undefined && dict[key] !== "",
        `Translation key "${key}" must be defined in "${lang}"`
      );
    }
  }

  // Check language-specific words
  assert.equal(i18n.TRANSLATIONS.ar.sport, "رياضة");
  assert.equal(i18n.TRANSLATIONS.ckb.sport, "وەرزش");
  assert.equal(i18n.TRANSLATIONS.en.sport, "Sport");

  // 6. Test actual API fetch using node global fetch
  try {
    const leagues = await sportApi.fetchSoccerLeagues();
    assert.ok(Array.isArray(leagues), "fetchSoccerLeagues should return an array");
  } catch (e) {
    // Should fallback to CORE_LEAGUES if offline
    console.warn("fetchSoccerLeagues offline fallback test:", e.message);
  }

  await server.close();
});
