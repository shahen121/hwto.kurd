export const API_FOOTBALL_LEAGUES = {
  "eng.1": 39,
  "esp.1": 140,
  "ita.1": 135,
  "ger.1": 78,
  "fra.1": 61,
  "ksa.1": 307,
  "tur.1": 203,
  "ned.1": 88,
  "por.1": 94,
  "usa.1": 253,
  "eng.fa": 45,
  "eng.league_cup": 48,
};

const PROXY_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_API_FOOTBALL_PROXY_URL) ||
  "/api/football";
const cache = new Map();

export async function requestApiFootball(path, params, ttlMs = 60000) {
  const query = new URLSearchParams({ path, ...params });
  const url = `${PROXY_URL}?${query}`;
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && now < cached.expiresAt) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `API-Football proxy returned HTTP ${response.status}`);
    }
    cache.set(url, { data: body, expiresAt: Date.now() + ttlMs });
    return body;
  })();

  cache.set(url, { promise, expiresAt: now + ttlMs });
  try {
    return await promise;
  } catch (error) {
    cache.delete(url);
    throw error;
  }
}

function normalizeStatus(status = {}) {
  const code = status.short || "";
  const isLive = ["1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE"].includes(code);
  const completed = ["FT", "AET", "PEN", "AWD", "WO"].includes(code);
  const postponed = ["PST", "CANC", "ABD", "SUSP"].includes(code);
  const state = isLive ? "in" : completed || postponed ? "post" : "pre";
  const name = isLive
    ? code === "HT"
      ? "STATUS_HALF_TIME"
      : "STATUS_IN_PROGRESS"
    : completed
      ? "STATUS_FULL_TIME"
      : postponed
        ? "STATUS_POSTPONED"
        : "STATUS_SCHEDULED";

  return {
    type: {
      state,
      name,
      completed,
      description: status.long || code,
      detail:
        status.elapsed == null
          ? code || status.long || ""
          : `${status.elapsed}${status.extra ? `+${status.extra}` : ""}'`,
    },
    displayClock:
      status.elapsed == null
        ? ""
        : `${status.elapsed}${status.extra ? `+${status.extra}` : ""}'`,
  };
}

export function mapApiFootballFixture(item, leagueSlug) {
  const fixture = item?.fixture || {};
  const league = item?.league || {};
  const teams = item?.teams || {};
  const home = teams.home || {};
  const away = teams.away || {};
  const competition = {
    id: fixture.id,
    date: fixture.date,
    venue: { fullName: fixture.venue?.name || "" },
    status: normalizeStatus(fixture.status),
    competitors: [
      {
        id: home.id,
        homeAway: "home",
        score: item.goals?.home,
        winner: Boolean(home.winner),
        team: { id: home.id, displayName: home.name, name: home.name, logo: home.logo },
      },
      {
        id: away.id,
        homeAway: "away",
        score: item.goals?.away,
        winner: Boolean(away.winner),
        team: { id: away.id, displayName: away.name, name: away.name, logo: away.logo },
      },
    ],
    league,
  };

  return {
    id: fixture.id,
    dataSource: "api-football",
    date: fixture.date,
    name: `${home.name || ""} vs ${away.name || ""}`,
    shortName: `${home.name || ""} - ${away.name || ""}`,
    league: leagueSlug,
    competitions: [competition],
    homeTeam: competition.competitors[0],
    awayTeam: competition.competitors[1],
    competition,
    venue: competition.venue,
    status: competition.status,
  };
}

function stat(name, value) {
  return { name, displayValue: value == null ? "-" : String(value) };
}

export function mapApiFootballStandings(payload) {
  const entries = payload?.response?.[0]?.league?.standings?.[0] || [];
  return {
    standings: {
      entries: entries.map((row) => {
        const played = Number(row.all?.played) || 0;
        const points = Number(row.points) || 0;
        return {
          rank: row.rank,
          team: {
            id: row.team?.id,
            displayName: row.team?.name,
            name: row.team?.name,
            logo: row.team?.logo,
          },
          note: row.description ? { description: row.description } : null,
          stats: [
            stat("gamesPlayed", row.all?.played),
            stat("wins", row.all?.win),
            stat("ties", row.all?.draw),
            stat("losses", row.all?.lose),
            stat("pointsFor", row.all?.goals?.for),
            stat("pointsAgainst", row.all?.goals?.against),
            stat("pointDifferential", row.goalsDiff),
            stat("points", row.points),
            stat("ppg", played ? (points / played).toFixed(2) : "0.00"),
          ],
        };
      }),
    },
  };
}

function mapLineupPlayer(player, starter) {
  const gridParts = String(player.grid || "").split(":");
  const formationPlace = Number(gridParts[1]) || undefined;
  const positionCode = player.pos || "";
  return {
    starter,
    jersey: player.number == null ? "" : String(player.number),
    formationPlace,
    formationGrid: player.grid || "",
    athlete: {
      id: player.id,
      displayName: player.name || "Player",
      shortName: player.name || "Player",
    },
    position: {
      abbreviation: positionCode,
      displayName: positionCode,
    },
  };
}

export function mapApiFootballLineups(payload) {
  return (payload?.response || []).map((lineup) => ({
    team: {
      id: lineup.team?.id,
      displayName: lineup.team?.name || "Team",
    },
    formation: lineup.formation || "",
    roster: [
      ...(lineup.startXI || []).map(({ player }) => mapLineupPlayer(player, true)),
      ...(lineup.substitutes || []).map(({ player }) => mapLineupPlayer(player, false)),
    ],
  }));
}

export function mapApiFootballPlays(payload) {
  return {
    items: (payload?.response || []).map((event) => {
      const kind = String(event.type || "").toLowerCase();
      const detail = event.detail || "";
      const isGoal = kind === "goal";
      return {
        clock: {
          displayValue: `${event.time?.elapsed ?? ""}${event.time?.extra ? `+${event.time.extra}` : ""}'`,
        },
        scoringPlay: isGoal,
        substitution: kind === "subst",
        redCard: kind === "card" && /red/i.test(detail),
        yellowCard: kind === "card" && /yellow/i.test(detail),
        penaltyKick: /penalty/i.test(detail),
        ownGoal: /own goal/i.test(detail),
        type: { type: isGoal ? "goal" : kind, text: detail || event.type || "" },
        text: [detail, event.player?.name].filter(Boolean).join(" - "),
        athletesInvolved: event.player?.name
          ? [{ displayName: event.player.name }]
          : [],
        team: event.team?.name || "",
        athlete: event.player?.name || "",
      };
    }),
  };
}

export function getApiFootballResponse(payload) {
  if (!Array.isArray(payload?.response)) {
    throw new Error("API-Football returned an invalid response");
  }
  return payload.response;
}
