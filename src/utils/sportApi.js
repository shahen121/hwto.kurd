// ── hwto-sport API Service (worldcup26.ir) ──────────────────────────────────
// Provides fixtures, live scoreboard, standings, and match events/plays
// with in-memory caching, error handling, and multi-league support.

import {
  API_FOOTBALL_LEAGUES,
  getApiFootballResponse,
  mapApiFootballFixture,
  mapApiFootballLineups,
  mapApiFootballPlays,
  mapApiFootballStandings,
  requestApiFootball,
} from "./apiFootball";

export const SPORT_API_BASE = "https://worldcup26.ir";

// Supported core leagues with metadata and localization keys
export const CORE_LEAGUES = [
  {
    slug: "eng.1",
    name: "English Premier League",
    nameAr: "الدوري الإنجليزي الممتاز",
    nameCkb: "پریمیەرلیگی ئینگلیزی",
    country: "England",
    countryAr: "إنجلترا",
    countryCkb: "ئینگلتەرا",
    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    season: 2026,
  },
  {
    slug: "esp.1",
    name: "Spanish LALIGA",
    nameAr: "الدوري الإسباني (لاليغا)",
    nameCkb: "خولی ئیسپانی (لال لیگا)",
    country: "Spain",
    countryAr: "إسبانيا",
    countryCkb: "ئیسپانیا",
    flag: "🇪🇸",
    season: 2026,
  },
  {
    slug: "ita.1",
    name: "Italian Serie A",
    nameAr: "الدوري الإيطالي (سيريا أ)",
    nameCkb: "خولی ئیتاڵی (سێریا ئەی)",
    country: "Italy",
    countryAr: "إيطاليا",
    countryCkb: "ئیتاڵیا",
    flag: "🇮🇹",
    season: 2026,
  },
  {
    slug: "ger.1",
    name: "German Bundesliga",
    nameAr: "الدوري الألماني (البوندسليغا)",
    nameCkb: "بۆندسلیگای ئەڵمانی",
    country: "Germany",
    countryAr: "ألمانيا",
    countryCkb: "ئەڵمانیا",
    flag: "🇩🇪",
    season: 2026,
  },
  {
    slug: "fra.1",
    name: "French Ligue 1",
    nameAr: "الدوري الفرنسي (ليغ 1)",
    nameCkb: "خولی فەرەنسی (لیگ 1)",
    country: "France",
    countryAr: "فرنسا",
    countryCkb: "فەڕەنسا",
    flag: "🇫🇷",
    season: 2026,
  },
  {
    slug: "ksa.1",
    name: "Saudi Pro League",
    nameAr: "دوري روشن السعودي",
    nameCkb: "خولی پیشەگەری ڕۆشەنی سعودی",
    country: "Saudi Arabia",
    countryAr: "السعودية",
    countryCkb: "سعودیە",
    flag: "🇸🇦",
    season: 2026,
  },
  {
    slug: "tur.1",
    name: "Turkish Super Lig",
    nameAr: "الدوري التركي الممتاز",
    nameCkb: "سوپەرلیگی تورکی",
    country: "Turkey",
    countryAr: "تركيا",
    countryCkb: "تورکیا",
    flag: "🇹🇷",
    season: 2026,
  },
  {
    slug: "ned.1",
    name: "Dutch Eredivisie",
    nameAr: "الدوري الهولندي الممتاز",
    nameCkb: "ئێردیڤیزی هۆڵەندی",
    country: "Netherlands",
    countryAr: "هولندا",
    countryCkb: "هۆڵەندا",
    flag: "🇳🇱",
    season: 2026,
  },
  {
    slug: "por.1",
    name: "Portuguese Primeira Liga",
    nameAr: "الدوري البرتغالي الممتاز",
    nameCkb: "خولی نایابی پورتوگالی",
    country: "Portugal",
    countryAr: "البرتغال",
    countryCkb: "پورتوگال",
    flag: "🇵🇹",
    season: 2026,
  },
  {
    slug: "usa.1",
    name: "MLS (Major League Soccer)",
    nameAr: "الدوري الأمريكي",
    nameCkb: "خولی ئەمریکی (MLS)",
    country: "USA",
    countryAr: "أمريكا",
    countryCkb: "ئەمریکا",
    flag: "🇺🇸",
    season: 2026,
  },
  {
    slug: "eng.fa",
    name: "English FA Cup",
    nameAr: "كأس الاتحاد الإنجليزي",
    nameCkb: "جامی یەکێتی ئینگلتەرا (FA Cup)",
    country: "England",
    countryAr: "إنجلترا",
    countryCkb: "ئینگلتەرا",
    flag: "🏆",
    season: 2026,
  },
  {
    slug: "eng.league_cup",
    name: "Carabao Cup",
    nameAr: "كأس الرابطة الإنجليزية (كاراباو)",
    nameCkb: "جامی کاراباو (کاس ڕابیتە)",
    country: "England",
    countryAr: "إنجلترا",
    countryCkb: "ئینگلتەرا",
    flag: "🏆",
    season: 2026,
  },
];

// In-memory cache for API calls with TTL (60s for live, 5m for standings/fixtures)
const _cache = new Map();

async function cachedFetch(url, ttlMs = 60000) {
  const cached = _cache.get(url);
  const now = Date.now();
  if (cached && now - cached.ts < ttlMs) {
    return cached.data;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`API error HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    _cache.set(url, { data, ts: now });
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    // If network fails but we have stale cache, return it
    if (cached) {
      return cached.data;
    }
    throw err;
  }
}

function toIsoDate(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "").slice(0, 8);
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : "";
}

function getApiFootballLeagueId(league) {
  const id = API_FOOTBALL_LEAGUES[league];
  if (!id) throw new Error(`API-Football does not support league "${league}"`);
  return String(id);
}

async function fetchApiFootballFixtures(league, filters = {}) {
  const leagueId = getApiFootballLeagueId(league);
  const season =
    CORE_LEAGUES.find((item) => item.slug === league)?.season || 2026;
  const params = {
    league: leagueId,
    season: String(season),
    page: String(Math.max(1, Number(filters.page) || 1)),
  };
  const date = toIsoDate(filters.date);
  const from =
    toIsoDate(filters.from) ||
    (!date && !filters.to ? `${season}-01-01` : "");
  const to =
    toIsoDate(filters.to) ||
    (!date && !filters.from ? `${season + 1}-12-31` : "");
  if (date) params.date = date;
  if (from) params.from = from;
  if (to) params.to = to;
  if (filters.status === "live") params.live = "all";
  else if (filters.status === "scheduled") params.status = "NS";
  else if (filters.status === "finished") params.status = "FT";

  const payload = await requestApiFootball("/fixtures", params, 30000);
  const events = getApiFootballResponse(payload).map((item) =>
    mapApiFootballFixture(item, league),
  );
  return {
    events,
    pageIndex: Number(payload.paging?.current) || Number(params.page),
    pageCount: Number(payload.paging?.total) || 1,
    count: events.length,
    dataSource: "api-football",
  };
}

async function withApiFootballFallback(primaryRequest, fallbackRequest) {
  try {
    return await primaryRequest();
  } catch (error) {
    try {
      return await fallbackRequest();
    } catch (fallbackError) {
      if (
        /API_FOOTBALL_KEY is not configured|does not support league/i.test(
          fallbackError.message,
        )
      ) {
        throw error;
      }
      throw new Error(
        `Primary sports API failed (${error.message}); API-Football fallback failed (${fallbackError.message})`,
      );
    }
  }
}

/**
 * Fetch all available soccer leagues from the backend
 */
export async function fetchSoccerLeagues() {
  const url = `${SPORT_API_BASE}/get/soccer/leagues?available=true`;
  try {
    const json = await cachedFetch(url, 300000); // 5 min cache
    if (json && Array.isArray(json.leagues)) {
      return json.leagues.map((league) => {
        const knownLeague = CORE_LEAGUES.find(
          (item) => item.slug === league.slug,
        );
        return {
          ...knownLeague,
          ...league,
          season: league.season?.year || knownLeague?.season || 2026,
        };
      });
    }
    return CORE_LEAGUES;
  } catch {
    return CORE_LEAGUES;
  }
}

/**
 * Fetch scoreboard (live scores & matches for a given date)
 * @param {string} league - League slug e.g. "eng.1"
 * @param {string} [dateStr] - Optional YYYYMMDD string
 */
export async function fetchScoreboard(league = "eng.1", dateStr = "") {
  return withApiFootballFallback(
    async () => {
      let url = `${SPORT_API_BASE}/get/soccer/${encodeURIComponent(league)}/scoreboard`;
      if (dateStr) {
        const cleanDate = dateStr.replace(/[^0-9]/g, "").slice(0, 8);
        if (cleanDate) url += `?dates=${cleanDate}`;
      }
      return cachedFetch(url, 30000);
    },
    () => fetchApiFootballFixtures(league, { date: dateStr }),
  );
}

/**
 * Fetch league fixtures schedule
 * @param {string} league - League slug e.g. "eng.1"
 * @param {object|string} [options] - Filters and pagination options
 * @param {string} [options.status] - "all", "scheduled", "live", "finished"
 * @param {string} [options.from] - Optional start date (YYYY-MM-DD or YYYYMMDD)
 * @param {string} [options.to] - Optional end date (YYYY-MM-DD or YYYYMMDD)
 * @param {number} [options.page=1] - One-based page number
 * @param {number} [options.limit=100] - Number of matches per page
 */
export async function fetchFixtures(league = "eng.1", options = {}) {
  const filters =
    typeof options === "string" ? { status: options } : options || {};
  const params = new URLSearchParams({
    status: filters.status || "all",
    page: String(Math.max(1, Number(filters.page) || 1)),
    limit: String(Math.min(200, Math.max(1, Number(filters.limit) || 100))),
  });
  for (const key of ["from", "to"]) {
    const value = filters[key]?.replace(/[^0-9]/g, "").slice(0, 8);
    if (value?.length === 8) params.set(key, value);
  }
  const url = `${SPORT_API_BASE}/get/soccer/${encodeURIComponent(league)}/fixtures?${params}`;
  return withApiFootballFallback(
    () => cachedFetch(url, 120000),
    () =>
      fetchApiFootballFixtures(league, {
        status: filters.status,
        from: filters.from,
        to: filters.to,
        page: filters.page,
      }),
  );
}

/**
 * Fetch league standings
 * @param {string} league - League slug e.g. "esp.1"
 * @param {number} [season] - Year e.g. 2026
 */
export async function fetchStandings(league = "eng.1", season = 2026) {
  const url = `${SPORT_API_BASE}/get/soccer/${encodeURIComponent(league)}/standings?season=${season}`;
  return withApiFootballFallback(
    () => cachedFetch(url, 300000),
    async () => {
      const payload = await requestApiFootball(
        "/standings",
        { league: getApiFootballLeagueId(league), season: String(season) },
        300000,
      );
      return {
        ...mapApiFootballStandings(payload),
        dataSource: "api-football",
      };
    },
  );
}

/**
 * Fetch detailed match summary including keyEvents, boxscore, lineups, venue
 * @param {string} league - League slug
 * @param {string|number} eventId - Event ID
 */
export async function fetchEventSummary(league = "eng.1", eventId, event) {
  if (!eventId) throw new Error("Event ID required");
  if (event?.dataSource === "api-football") {
    const payload = await requestApiFootball(
      "/fixtures/lineups",
      { fixture: String(eventId) },
      60000,
    );
    return {
      rosters: mapApiFootballLineups(payload),
      keyEvents: [],
      dataSource: "api-football",
    };
  }
  const url = `${SPORT_API_BASE}/get/soccer/${encodeURIComponent(league)}/events/${encodeURIComponent(eventId)}`;
  return cachedFetch(url, 60000); // 1 min cache
}

/**
 * Fetch play-by-play events timeline
 * @param {string} league - League slug
 * @param {string|number} eventId - Event ID
 */
export async function fetchMatchPlays(league = "eng.1", eventId, event) {
  if (!eventId) throw new Error("Event ID required");
  if (event?.dataSource === "api-football") {
    const payload = await requestApiFootball(
      "/fixtures/events",
      { fixture: String(eventId) },
      60000,
    );
    return mapApiFootballPlays(payload);
  }
  const url = `${SPORT_API_BASE}/get/soccer/${encodeURIComponent(league)}/events/${encodeURIComponent(eventId)}/plays`;
  return cachedFetch(url, 60000); // 1 min cache
}

/**
 * Helper to extract localized league name
 */
export function getLeagueDisplayName(
  slug,
  lang = "ar",
  availableLeagues = CORE_LEAGUES,
) {
  const found = availableLeagues.find((l) => l.slug === slug);
  if (!found) return slug;
  if (lang === "ckb") return found.nameCkb || found.name;
  if (lang === "ar") return found.nameAr || found.name;
  return found.name;
}

/**
 * Helper to format date into YYYYMMDD for API query
 */
export function formatDateToYYYYMMDD(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/**
 * Parse match state: returns 'live', 'ft', 'ht', 'upcoming', 'postponed'
 */
export function getMatchStatusInfo(statusObj) {
  if (!statusObj) {
    return { state: "upcoming", display: "Upcoming", detail: "" };
  }

  const type = statusObj.type || {};
  const state = type.state || "";
  const name = type.name || "";
  const completed = !!type.completed;
  const description = type.description || "";
  const detail = type.detail || type.shortDetail || "";
  const clock = statusObj.displayClock || "";

  if (name.includes("POSTPONED") || description.toLowerCase().includes("postponed")) {
    return { state: "postponed", display: "Postponed", detail };
  }
  if (completed || name.includes("FULL_TIME") || detail === "FT") {
    return { state: "ft", display: "FT", detail: "Full Time" };
  }
  if (name.includes("HALF_TIME") || detail === "HT") {
    return { state: "ht", display: "HT", detail: "Half Time" };
  }
  if (state === "in" || name.includes("IN_PROGRESS")) {
    return { state: "live", display: clock || "LIVE", detail: clock };
  }
  if (state === "pre") {
    return { state: "upcoming", display: detail || "Upcoming", detail };
  }

  return { state: "upcoming", display: detail || description || "Upcoming", detail };
}

/**
 * Accurately check whether a play event is a goal (excludes goal kicks and generic touches)
 */
export function isPlayGoal(play) {
  if (!play) return false;
  if (play.scoringPlay === true) return true;
  const typeType = play.type?.type || "";
  const typeText = play.type?.text?.toLowerCase() || "";
  if (typeType === "goal-kick" || typeText.includes("goal kick")) return false;
  return typeType === "goal" || typeText.startsWith("goal") || typeText.includes("goal -");
}

/**
 * Extract player jersey number safely across API variations
 */
export function getJerseyNumber(player) {
  if (!player) return "";
  return player.jersey || player.athlete?.jersey || "";
}

/**
 * Translation map for soccer statistics keys
 */
export const STAT_DICTIONARY = {
  possessionPct: {
    ar: "نسبة الاستحواذ",
    ckb: "ڕێژەی کۆنترۆڵکردن",
    en: "Ball Possession %",
  },
  shotsOnTarget: {
    ar: "تسديدات على المرمى",
    ckb: "لێدان بۆ ناو گۆڵ",
    en: "Shots on Target",
  },
  totalShots: {
    ar: "إجمالي التسديدات",
    ckb: "کۆی لێدانەکان",
    en: "Total Shots",
  },
  wonCorners: {
    ar: "ضربات ركنية",
    ckb: "لێدانی گۆشە (کۆڕنەر)",
    en: "Corner Kicks",
  },
  foulsCommitted: {
    ar: "الأخطاء المرتكبة",
    ckb: "فاوڵەکان",
    en: "Fouls Committed",
  },
  goalAssists: {
    ar: "صناعة أهداف",
    ckb: "ئاسیست (دروستکردنی گۆڵ)",
    en: "Goal Assists",
  },
  appearances: {
    ar: "المشاركات",
    ckb: "بەشدارییەکان",
    en: "Appearances",
  },
  saves: {
    ar: "التصديات",
    ckb: "ڕزگارکردن (سەیڤ)",
    en: "Saves",
  },
  yellowCards: {
    ar: "بطاقات صفراء",
    ckb: "کارتی زەرد",
    en: "Yellow Cards",
  },
  redCards: {
    ar: "بطاقات حمراء",
    ckb: "کارتی سوور",
    en: "Red Cards",
  },
  totalGoals: {
    ar: "الأهداف المسجلة",
    ckb: "کۆی گۆڵەکان",
    en: "Total Goals",
  },
};

/**
 * Translate a statistic key into current language
 */
export function getStatLabel(statKey, lang = "ar") {
  if (!statKey) return "";
  const entry = STAT_DICTIONARY[statKey];
  if (entry) {
    return entry[lang] || entry.en;
  }
  return statKey
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}
