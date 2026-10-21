const { test } = require("node:test");
const assert = require("node:assert/strict");

test("API-Football normalizes standings, lineup and play responses", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const api = await server.ssrLoadModule("/src/utils/apiFootball.js");
    const standings = api.mapApiFootballStandings({
      response: [{
        league: {
          standings: [[{
            rank: 1,
            points: 9,
            goalsDiff: 5,
            all: { played: 3, win: 3, draw: 0, lose: 0, goals: { for: 7, against: 2 } },
            team: { id: 1, name: "Club", logo: "club.svg" },
          }]],
        },
      }],
    });
    assert.equal(standings.standings.entries[0].team.displayName, "Club");
    assert.equal(
      standings.standings.entries[0].stats.find((entry) => entry.name === "ppg")
        .displayValue,
      "3.00",
    );

    const lineups = api.mapApiFootballLineups({
      response: [{
        team: { id: 1, name: "Club" },
        formation: "4-3-3",
        startXI: [{ player: { id: 12, name: "Keeper", number: 1, pos: "G", grid: "1:1" } }],
        substitutes: [{ player: { id: 13, name: "Sub", number: 12, pos: "F" } }],
      }],
    });
    assert.equal(lineups[0].roster[0].starter, true);
    assert.equal(lineups[0].roster[0].formationPlace, 1);
    assert.equal(lineups[0].roster[1].starter, false);

    const plays = api.mapApiFootballPlays({
      response: [{
        time: { elapsed: 12 },
        type: "Goal",
        detail: "Normal Goal",
        team: { name: "Club" },
        player: { name: "Scorer" },
      }],
    });
    assert.equal(plays.items[0].scoringPlay, true);
    assert.equal(plays.items[0].athletesInvolved[0].displayName, "Scorer");
  } finally {
    await server.close();
  }
});

test("scoreboard switches to API-Football only when the primary feed fails", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).startsWith("https://worldcup26.ir/")) {
      return { ok: false, status: 503, statusText: "Unavailable" };
    }
    return {
      ok: true,
      json: async () => ({
        response: [{
          fixture: {
            id: 987654321,
            date: "2026-10-21T19:00:00+00:00",
            status: { short: "FT", long: "Match Finished" },
            venue: { name: "Stadium" },
          },
          league: { name: "Premier League" },
          teams: {
            home: { id: 1, name: "Home", logo: "home.svg", winner: true },
            away: { id: 2, name: "Away", logo: "away.svg", winner: false },
          },
          goals: { home: 2, away: 1 },
        }],
        paging: { current: 1, total: 1 },
      }),
    };
  };

  try {
    const sportApi = await server.ssrLoadModule("/src/utils/sportApi.js");
    const scoreboard = await sportApi.fetchScoreboard("eng.1", "20261021");
    assert.equal(scoreboard.dataSource, "api-football");
    assert.equal(scoreboard.events[0].dataSource, "api-football");
    assert.equal(scoreboard.events[0].homeTeam.team.displayName, "Home");
    assert.equal(scoreboard.events[0].competitions[0].status.type.completed, true);
    assert.equal(requests.length, 2);
    assert.match(requests[1], /league=39/);
    assert.match(requests[1], /date=2026-10-21/);
  } finally {
    global.fetch = originalFetch;
    await server.close();
  }
});

test("standings use API-Football when the primary feed fails", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).startsWith("https://worldcup26.ir/")) {
      return { ok: false, status: 503, statusText: "Unavailable" };
    }
    return {
      ok: true,
      json: async () => ({
        response: [{
          league: {
            standings: [[{
              rank: 1,
              points: 6,
              goalsDiff: 3,
              all: { played: 2, win: 2, draw: 0, lose: 0, goals: { for: 4, against: 1 } },
              team: { id: 10, name: "Fallback FC", logo: "" },
            }]],
          },
        }],
      }),
    };
  };

  try {
    const sportApi = await server.ssrLoadModule("/src/utils/sportApi.js");
    const standings = await sportApi.fetchStandings("esp.1", 2026);
    assert.equal(standings.dataSource, "api-football");
    assert.equal(standings.standings.entries[0].team.displayName, "Fallback FC");
  } finally {
    global.fetch = originalFetch;
    await server.close();
  }
});

test("empty primary scoreboards do not spend API-Football quota", async () => {
  const { createServer } = require("vite");
  const server = await createServer({
    configFile: false,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
  });
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      json: async () => ({ events: [] }),
    };
  };

  try {
    const sportApi = await server.ssrLoadModule("/src/utils/sportApi.js");
    const scoreboard = await sportApi.fetchScoreboard("eng.1", "20261022");
    assert.deepEqual(scoreboard.events, []);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].startsWith("https://worldcup26.ir/"));
  } finally {
    global.fetch = originalFetch;
    await server.close();
  }
});
