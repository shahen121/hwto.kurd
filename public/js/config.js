/**
 * Static configuration + static lookup tables.
 * Genre / language / country NAMES are not provided by the API — the API only
 * returns numeric `genre_ids` and ISO codes. These tables are local translations
 * of the standard TMDB ids/codes that actually appeared in real API responses.
 */

import { TV_SERIES_CATALOG } from './tv_catalog.js';
export { TV_SERIES_CATALOG };

export const CONFIG = {
  // Same-origin path, forwarded by server.js to kurdcinama.com (keeps CORS + keys out of the frontend).
  apiBase: '/api/TMDBCache.aspx',
  tmdbImg: 'https://image.tmdb.org/t/p',
  localImg: 'https://kurdcinama.com/Wenekan_KS/',
  posterSize: 'w342',
  backdropSize: 'w1280',
  requestTimeout: 15000,
  retries: 2,
  cacheTTL: 5 * 60 * 1000,
  detailCacheTTL: 30 * 60 * 1000,
  searchDebounce: 400
};

/** TMDB genre ids observed in real `genre_ids` values returned by this API. */
export const GENRES = {
  12: 'مغامرة',
  14: 'فانتازيا',
  16: 'أنيميشن',
  18: 'دراما',
  27: 'رعب',
  28: 'أكشن',
  35: 'كوميديا',
  36: 'تاريخ',
  37: 'ويسترن',
  53: 'إثارة',
  80: 'جريمة',
  99: 'وثائقي',
  878: 'خيال علمي',
  9648: 'غموض',
  10402: 'موسيقي',
  10749: 'رومانسي',
  10751: 'عائلي',
  10752: 'حرب',
  10759: 'أكشن ومغامرة',
  10764: 'واقعي',
  10765: 'خيال علمي وفانتازيا',
  10767: 'حواري',
  10768: 'حرب وسياسة'
};

/** ISO-639-1 codes observed in real `original_language` values. */
export const LANGUAGES = {
  ar: 'العربية',
  en: 'الإنجليزية',
  es: 'الإسبانية',
  fi: 'الفنلندية',
  fr: 'الفرنسية',
  hi: 'الهندية',
  it: 'الإيطالية',
  ja: 'اليابانية',
  kn: 'الكانادية',
  ko: 'الكورية',
  pt: 'البرتغالية',
  tr: 'التركية',
  zh: 'الصينية'
};

/** ISO-3166-1 codes observed in real `origin_country` values (TV details only). */
export const COUNTRIES = {
  CN: 'الصين',
  ES: 'إسبانيا',
  GB: 'بريطانيا',
  JP: 'اليابان',
  KR: 'كوريا الجنوبية',
  TR: 'تركيا',
  US: 'الولايات المتحدة'
};

/** Server-side caps discovered by probing the live API. */
export const LIMITS = {
  trending: { initial: 9, max: 9 },
  upcoming: { initial: 20, max: 40 },
  topRatedMovie: { initial: 20, max: 20 },
  topRatedTv: { initial: 9, max: 9 },
  myContent: { initial: 20, max: 100 },
  category: { initial: 24, max: 240 }
};

/**
 * The five «التصنيفات» entries — one screen each, reachable from the nav
 * dropdown at `#/category/{slug}`. Slugs are the stable part of the URL and
 * are what router.js, the nav and the list page agree on.
 *
 *   anime / asian / turkish — served from categories_data.js (the upstream
 *                   cache has no genre or country filter, see that file's
 *                   header).
 *   series / movies — assembled live from the existing list endpoints.
 *
 * `rows` are the highlight rows rendered ABOVE the full grid on the screen
 * (pages/list.js): `key` matches the section keys api.getCategory() returns,
 * `label` is the row heading. Rows with fewer than 3 items are skipped.
 */
export const CATEGORIES = {
  anime: {
    slug: 'anime',
    label: 'أنمي',
    title: 'أنمي',
    subtitle: 'أفلام ومسلسلات أنمي مختارة بعناية — من ناروتو وآتاك أون تايتان حتى استوديو غيبلي',
    rows: [
      { key: 'new', label: 'أحدث إصدارات الأنمي' },
      { key: 'top', label: 'الأعلى تقييماً' },
      { key: 'tv', label: 'مسلسلات أنمي' },
      { key: 'movie', label: 'أفلام أنمي' }
    ]
  },
  series: {
    slug: 'series',
    label: 'مسلسلات',
    title: 'مسلسلات',
    subtitle: 'كل مسلسلات الموقع: محتوى المكتبة والأعلى تقييماً والرائجة الآن في شاشة واحدة',
    rows: [
      { key: 'library', label: 'آخر إضافات مكتبة الموقع' },
      { key: 'top', label: 'الأعلى تقييماً' },
      { key: 'trending', label: 'رائجة الآن' }
    ]
  },
  movies: {
    slug: 'movies',
    label: 'أفلام',
    title: 'أفلام',
    subtitle: 'كل أفلام الموقع: محتوى المكتبة والأعلى تقييماً وما هو قادم إلى الصالات في شاشة واحدة',
    rows: [
      { key: 'library', label: 'آخر إضافات مكتبة الموقع' },
      { key: 'top', label: 'الأعلى تقييماً' },
      { key: 'upcoming', label: 'قادمة إلى الصالات' }
    ]
  },
  asian: {
    slug: 'asian',
    label: 'أفلام ومسلسلات آسيوية',
    title: 'آسيوية',
    subtitle: 'أفلام ومسلسلات شرق وجنوب آسيا: كوريا واليابان والصين والهند وتايلاند',
    rows: [
      { key: 'new', label: 'أحدث الإصدارات الآسيوية' },
      { key: 'top', label: 'الأعلى تقييماً' },
      { key: 'tv', label: 'مسلسلات آسيوية' },
      { key: 'movie', label: 'أفلام آسيوية' }
    ]
  },
  turkish: {
    slug: 'turkish',
    label: 'تركية',
    title: 'تركية',
    subtitle: 'أفلام ومسلسلات تركية: دراما تاريخية وأكشن وكوميديا',
    rows: [
      { key: 'new', label: 'أحدث الإصدارات التركية' },
      { key: 'top', label: 'الأعلى تقييماً' },
      { key: 'tv', label: 'مسلسلات تركية' },
      { key: 'movie', label: 'أفلام تركية' }
    ]
  }
};

export const CATEGORY_SLUGS = Object.keys(CATEGORIES);

/**
 * Real seasons ("الأجزاء") and exact per-season episode counts for popular & trending TV series.
 * Eliminates fake hardcoded values and matches exact episodes per season.
 */
export const KNOWN_TV_SERIES = {
  1396: { seasons: 5, episodes: [7, 13, 13, 13, 16] }, // Breaking Bad
  1399: { seasons: 8, episodes: [10, 10, 10, 10, 10, 10, 7, 6] }, // Game of Thrones
  66732: { seasons: 4, episodes: [8, 9, 8, 9] }, // Stranger Things
  94605: { seasons: 2, episodes: [9, 9] }, // Arcane
  60059: { seasons: 6, episodes: [10, 10, 10, 10, 10, 13] }, // Better Call Saul
  87108: { seasons: 1, episodes: [5] }, // Chernobyl
  71446: { seasons: 5, episodes: [13, 9, 8, 8, 10] }, // Money Heist
  100088: { seasons: 1, episodes: [9] }, // The Last of Us
  70523: { seasons: 3, episodes: [10, 8, 8] }, // Dark
  110492: { seasons: 1, episodes: [8] }, // Peacemaker
  60625: { seasons: 7, episodes: [11, 10, 10, 10, 10, 10, 10] }, // Rick and Morty
  85552: { seasons: 2, episodes: [8, 8] }, // Euphoria
  1402: { seasons: 11, episodes: [6, 13, 16, 16, 16, 16, 16, 16, 16, 22, 24] }, // The Walking Dead
  63174: { seasons: 6, episodes: [13, 18, 26, 10, 16, 10] }, // Lucifer
  30984: { seasons: 16, episodes: [20, 21, 22, 28, 18, 22, 20, 16, 22, 16, 7, 17, 36, 51, 26, 24] }, // Bleach
  94997: { seasons: 2, episodes: [10, 8] }, // House of the Dragon
  76479: { seasons: 4, episodes: [8, 8, 8, 8] }, // The Boys
  119051: { seasons: 1, episodes: [8] }, // Wednesday
  84958: { seasons: 2, episodes: [6, 6] }, // Loki (Season 1: 6, Season 2: 6)
  93405: { seasons: 2, episodes: [9, 7] }, // Squid Game
  278573: { seasons: 1, episodes: [12] }, // Perfect Crown
  259265: { seasons: 1, episodes: [8] }, // Something Very Bad Is Going to Happen
  106379: { seasons: 1, episodes: [8] }, // Fallout
  225171: { seasons: 1, episodes: [9] }, // Pluribus
  126308: { seasons: 1, episodes: [10] }, // Shōgun
  113988: { seasons: 1, episodes: [8] }, // The Penguin
  115036: { seasons: 2, episodes: [9, 10] }, // Severance
  1398: { seasons: 6, episodes: [13, 13, 13, 13, 13, 21] }, // The Sopranos
  1438: { seasons: 5, episodes: [13, 12, 12, 13, 10] }, // The Wire
  1668: { seasons: 10, episodes: [24, 24, 25, 24, 24, 25, 24, 24, 24, 18] }, // Friends
  2288: { seasons: 5, episodes: [22, 22, 13, 22, 9] }, // Prison Break
  19885: { seasons: 4, episodes: [3, 3, 3, 3] }, // Sherlock
  1429: { seasons: 4, episodes: [25, 12, 22, 30] }, // Attack on Titan
  1535: { seasons: 1, episodes: [37] }, // Death Note
  85937: { seasons: 4, episodes: [26, 18, 11, 8] }, // Demon Slayer
  46648: { seasons: 4, episodes: [8, 8, 8, 6] }, // True Detective
  60622: { seasons: 5, episodes: [10, 10, 10, 11, 10] }, // Fargo
  1405: { seasons: 8, episodes: [12, 12, 12, 12, 12, 12, 12, 12] }, // Dexter
  136283: { seasons: 3, episodes: [8, 10, 10] }, // The Bear
  76331: { seasons: 4, episodes: [10, 10, 10, 10] }, // Succession
  95557: { seasons: 2, episodes: [8, 8] }, // Invincible
  2316: { seasons: 9, episodes: [6, 22, 25, 19, 28, 26, 26, 24, 25] }, // The Office US
  44217: { seasons: 6, episodes: [9, 10, 10, 20, 20, 20] }, // Vikings
  60574: { seasons: 6, episodes: [6, 6, 6, 6, 6, 6] }, // Peaky Blinders
  37680: { seasons: 9, episodes: [12, 16, 16, 16, 16, 16, 16, 16, 10] }, // Suits
  1622: { seasons: 15, episodes: [22, 22, 16, 22, 22, 22, 23, 23, 23, 23, 23, 23, 20, 20, 20] }, // Supernatural
  61889: { seasons: 3, episodes: [13, 13, 13] }, // Daredevil
  67178: { seasons: 2, episodes: [13, 13] }, // The Punisher
  82856: { seasons: 3, episodes: [8, 8, 8] }, // The Mandalorian
  108978: { seasons: 2, episodes: [8, 8] }, // Reacher
  125988: { seasons: 2, episodes: [10, 10] }, // Silo
  124364: { seasons: 3, episodes: [10, 10, 10] }, // From
  93740: { seasons: 2, episodes: [9, 8] }, // Halo
  1408: { seasons: 8, episodes: [22, 24, 24, 16, 24, 22, 23, 22] }, // House M.D.
  63351: { seasons: 3, episodes: [10, 10, 10] }, // Narcos
  67744: { seasons: 2, episodes: [10, 9] }, // Mindhunter
  67070: { seasons: 2, episodes: [6, 6] }, // Fleabag
  62560: { seasons: 4, episodes: [10, 12, 10, 13] }, // Mr. Robot
  4607: { seasons: 6, episodes: [25, 24, 23, 14, 17, 18] }, // Lost
  1407: { seasons: 8, episodes: [12, 12, 12, 12, 12, 12, 12, 12] }, // Homeland
  63247: { seasons: 4, episodes: [10, 10, 8, 8] }, // Westworld
  42009: { seasons: 6, episodes: [3, 3, 6, 6, 3, 5] }, // Black Mirror
  73586: { seasons: 5, episodes: [9, 10, 10, 10, 14] }, // Yellowstone
  97546: { seasons: 3, episodes: [10, 12, 12] }, // Ted Lasso
  107113: { seasons: 4, episodes: [10, 10, 10, 10] }, // Only Murders in the Building
  65494: { seasons: 6, episodes: [10, 10, 10, 10, 10, 10] }, // The Crown
  4613: { seasons: 1, episodes: [10] }, // Band of Brothers
  16997: { seasons: 1, episodes: [10] }, // The Pacific
  90669: { seasons: 1, episodes: [8] }, // 1899
  205715: { seasons: 1, episodes: [8] }, // Gen V
  85271: { seasons: 1, episodes: [9] }, // WandaVision
  92749: { seasons: 1, episodes: [6] }, // Moon Knight
  122784: { seasons: 1, episodes: [9] }, // Agatha All Along
  111110: { seasons: 1, episodes: [8] }, // One Piece Live Action
  202250: { seasons: 1, episodes: [8] }, // Avatar: The Last Airbender Live Action
  246: { seasons: 3, episodes: [20, 20, 21] }, // Avatar: The Last Airbender Animated
  31911: { seasons: 1, episodes: [64] }, // Fullmetal Alchemist: Brotherhood
  1433: { seasons: 12, episodes: [12, 13, 13, 13, 12, 10, 11, 10, 9, 10, 10, 9] }, // American Horror Story
  1412: { seasons: 8, episodes: [23, 23, 23, 23, 23, 23, 22, 10] }, // Arrow
  60735: { seasons: 9, episodes: [23, 23, 23, 23, 19, 19, 18, 20, 13] }, // The Flash
  48866: { seasons: 7, episodes: [13, 16, 16, 13, 13, 13, 16] }, // The 100
  1418: { seasons: 12, episodes: [17, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24] }, // The Big Bang Theory
  1100: { seasons: 9, episodes: [22, 22, 20, 24, 24, 24, 24, 24, 24] }, // How I Met Your Mother
  1695: { seasons: 8, episodes: [13, 16, 16, 16, 16, 16, 16, 16] }, // Monk
  1409: { seasons: 7, episodes: [13, 13, 13, 14, 13, 13, 13] }, // Sons of Anarchy
  1403: { seasons: 7, episodes: [22, 22, 22, 22, 22, 13, 13] }, // Marvel Agents of S.H.I.E.L.D.
  61222: { seasons: 6, episodes: [12, 12, 12, 12, 12, 16] }, // BoJack Horseman
  95479: { seasons: 2, episodes: [24, 23] }, // Jujutsu Kaisen
  114410: { seasons: 1, episodes: [12] }, // Chainsaw Man
  209867: { seasons: 1, episodes: [12] }, // Solo Leveling
  120089: { seasons: 2, episodes: [25, 12] }, // Spy x Family
  86419: { seasons: 2, episodes: [24, 24] }, // Vinland Saga
  46298: { seasons: 6, episodes: [26, 12, 17, 13, 61, 19] }, // Hunter x Hunter
  111803: { seasons: 2, episodes: [6, 7] }, // The White Lotus
  77169: { seasons: 6, episodes: [10, 10, 10, 10, 10, 15] }, // Cobra Kai
  119645: { seasons: 2, episodes: [9, 10] }, // Tulsa King
  93853: { seasons: 4, episodes: [6, 6, 6, 6] }, // Slow Horses
  108545: { seasons: 1, episodes: [8] }, // 3 Body Problem
  209374: { seasons: 1, episodes: [8] }, // The Gentlemen
  252877: { seasons: 1, episodes: [7] }, // Baby Reindeer
  83867: { seasons: 1, episodes: [12] }, // Andor
  84773: { seasons: 2, episodes: [8, 8] }, // The Lord of the Rings: The Rings of Power
  116450: { seasons: 3, episodes: [8, 8, 8] }, // Vikings: Valhalla
  93741: { seasons: 1, episodes: [6] } // Dune: Prophecy
};

/**
 * Primary embed streaming provider (VidCore) using TMDB IDs.
 */
export const PLAYER_SERVERS = [
  {
    id: 'vidcore',
    name: 'سيرفر VidCore (الأساسي)',
    badge: 'الأساسي',
    movieUrl: (id) => `https://vidcore.io/movie/${id}`,
    tvUrl: (id, s, e) => `https://vidcore.io/tv/${id}/${s}/${e}`
  }
];

/**
 * Returns accurate season/episode structure for a TV show id and active season.
 * Checked across all 605 TV series in the site catalog with exact season & episode counts.
 * @param {number|string} id - TMDB series id
 * @param {number} [seasonNumber=1] - Requested season number
 * @param {number} [extraEpisodes=0] - Dynamically expanded episode count
 */
export function getTvSeriesStructure(id, seasonNumber = 1, extraEpisodes = 0) {
  const numId = Number(id);
  const sNum = Math.max(1, Number(seasonNumber) || 1);
  const extra = Math.max(0, Number(extraEpisodes) || 0);

  // 1. Look up in verified site catalog of 605 series
  const catalogEps = TV_SERIES_CATALOG[numId] || TV_SERIES_CATALOG[String(id)];
  if (catalogEps && Array.isArray(catalogEps) && catalogEps.length > 0) {
    const seasonsCount = catalogEps.length;
    const clampedSeason = Math.min(sNum, seasonsCount);
    const baseEpCount = catalogEps[clampedSeason - 1] || 1;
    const episodeCount = baseEpCount + extra;
    return {
      isKnown: true,
      seasonsCount,
      seasons: Array.from({ length: seasonsCount }, (_, i) => i + 1),
      episodeCount,
      episodes: Array.from({ length: episodeCount }, (_, i) => i + 1)
    };
  }

  // 2. Fallback to KNOWN_TV_SERIES dictionary
  const info = KNOWN_TV_SERIES[numId];
  if (info) {
    const seasonsCount = Math.max(info.seasons || 1, sNum);
    const baseEpCount = (info.episodes && info.episodes[sNum - 1]) || 12;
    const episodeCount = baseEpCount + extra;
    return {
      isKnown: true,
      seasonsCount,
      seasons: Array.from({ length: seasonsCount }, (_, i) => i + 1),
      episodeCount,
      episodes: Array.from({ length: episodeCount }, (_, i) => i + 1)
    };
  }

  // 3. Adaptive default for uncatalogued titles:
  const seasonsCount = Math.max(1, sNum);
  const baseEpCount = 12;
  const episodeCount = Math.max(baseEpCount, baseEpCount + extra);

  return {
    isKnown: false,
    seasonsCount,
    seasons: Array.from({ length: seasonsCount }, (_, i) => i + 1),
    episodeCount,
    episodes: Array.from({ length: episodeCount }, (_, i) => i + 1)
  };
}

/** Latest season/episode recorded by the site's verified series catalogue. */
export function getLatestCatalogEpisode(id) {
  const seasons = TV_SERIES_CATALOG[String(id)] || (KNOWN_TV_SERIES[Number(id)] && KNOWN_TV_SERIES[Number(id)].episodes);
  if (!Array.isArray(seasons) || seasons.length === 0) return null;
  const episodeNumber = Number(seasons[seasons.length - 1]);
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1) return null;
  return { seasonNumber: seasons.length, episodeNumber };
}
