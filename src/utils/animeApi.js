import { storage } from "./storage.js";

const CACHE_KEY = "animeApiCache";
const CACHE_TTL = 60 * 60 * 1000;
const CACHE_LIMIT = 100;
const REQUEST_TIMEOUT_MS = {
  anilist: 12_000,
  kitsu: 12_000,
  jikan: 5_000,
  ann: 8_000,
};
const inFlightRequests = new Map();
const requestLimiters = {
  anilist: { interval: 700, lastRequestAt: 0, queue: Promise.resolve() },
  jikan: { interval: 400, lastRequestAt: 0, queue: Promise.resolve() },
};
const FALLBACK_GENRE_IDS = {
  Action: 1,
  Adventure: 2,
  "Avant Garde": 5,
  "Award Winning": 46,
  "Boys Love": 28,
  Comedy: 4,
  Drama: 8,
  Ecchi: 9,
  Fantasy: 10,
  "Girls Love": 26,
  Gourmet: 47,
  Horror: 14,
  Mystery: 7,
  Romance: 22,
  "Sci-Fi": 24,
  "Slice of Life": 36,
  Sports: 30,
  Supernatural: 37,
  Suspense: 41,
};
const FALLBACK_GENRES = Object.keys(FALLBACK_GENRE_IDS).sort();

export const ANIME_CATALOG_QUERY = `
  query AnimeCatalog(
    $page: Int!
    $perPage: Int!
    $search: String
    $sort: [MediaSort!]!
    $season: MediaSeason
    $seasonYear: Int
    $genre: String
    $format: MediaFormat
  ) {
    GenreCollection
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      media(
        type: ANIME
        search: $search
        sort: $sort
        season: $season
        seasonYear: $seasonYear
        genre: $genre
        format: $format
      ) {
        id
        idMal
        title { romaji english }
        coverImage { extraLarge large }
        bannerImage
        averageScore
        genres
        season
        seasonYear
        episodes
        format
        status
        description
        siteUrl
        nextAiringEpisode { airingAt episode timeUntilAiring }
      }
    }
  }
`;

export const ANIME_SCHEDULE_QUERY = `
  query AnimeSchedule($page: Int!, $perPage: Int!, $after: Int!, $before: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage }
      airingSchedules(
        airingAt_greater: $after
        airingAt_lesser: $before
        sort: TIME
      ) {
        id
        airingAt
        episode
        media {
          id idMal
          title { romaji english }
          coverImage { large }
          bannerImage
          averageScore
          format
          season
          seasonYear
          episodes
          genres
          description
          status
          siteUrl
        }
      }
    }
  }
`;

const ANIME_PROFILE_QUERY = `
  query AnimeProfile($id: Int!) {
    Media(id: $id, type: ANIME) {
      id idMal
      title { romaji english native }
      coverImage { extraLarge large }
      bannerImage
      averageScore meanScore popularity favourites
      genres tags { name rank }
      season seasonYear episodes duration format status
      startDate { year month day }
      endDate { year month day }
      description siteUrl source
      nextAiringEpisode { airingAt episode timeUntilAiring }
      airingSchedule(notYetAired: false, page: 1, perPage: 100) {
        nodes { airingAt episode }
      }
      characters(sort: [ROLE, FAVOURITES_DESC], page: 1, perPage: 12) {
        edges { role node { id name { full native } image { large } } }
      }
      staff(sort: [RELEVANCE, FAVOURITES_DESC], page: 1, perPage: 12) {
        edges { role node { id name { full } image { large } primaryOccupations } }
      }
      relations {
        edges {
          relationType
          node {
            id type format status
            title { romaji english }
            coverImage { large }
          }
        }
      }
    }
  }
`;

function readCache(key) {
  const cache = storage.get(CACHE_KEY) || {};
  const item = cache[key];
  if (!item || Date.now() - item.time >= CACHE_TTL) {
    if (item) {
      delete cache[key];
      storage.set(CACHE_KEY, cache);
    }
    return null;
  }
  return item.data;
}

function writeCache(key, data) {
  const cache = storage.get(CACHE_KEY) || {};
  cache[key] = { time: Date.now(), data };
  const keys = Object.keys(cache).sort((a, b) => cache[a].time - cache[b].time);
  while (keys.length > CACHE_LIMIT) delete cache[keys.shift()];
  storage.set(CACHE_KEY, cache);
}

async function request(provider, path, body = null) {
  const method = provider === "anilist" ? "POST" : "GET";
  const key = `${provider}:${method}:${path}:${JSON.stringify(body || {})}`;
  const cached = readCache(key);
  if (cached) return cached;
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);

  const execute = async () => {
    let response;
    if (window.electron?.animeRequest) {
      response = await window.electron.animeRequest({ provider, path, method, body });
      if (!response?.ok) throw new Error(response?.error || `${provider} request failed.`);
      response = { data: response.data, provider, cached: Boolean(response.cached) };
    } else {
      const base = {
        anilist: "https://graphql.anilist.co",
        kitsu: "https://kitsu.io/api/edge/",
        jikan: "https://api.jikan.moe/v4/",
        ann: "https://www.animenewsnetwork.com/",
      }[provider];
      const url = provider === "anilist" ? base : new URL(path, base).href;
      const raw = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body || {}) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS[provider] || 12_000),
      });
      const data = provider === "ann"
        ? await raw.text()
        : await raw.json().catch(() => null);
      if (!raw.ok) {
        throw new Error(
          data?.errors?.[0]?.message ||
            data?.message ||
            `${provider} request failed (${raw.status}).`,
        );
      }
      response = { data, provider, cached: false };
    }
    return response;
  };
  const pendingRequest = requestLimiters[provider]
    ? queueRateLimited(provider, execute)
    : execute();
  inFlightRequests.set(key, pendingRequest);
  try {
    const response = await pendingRequest;
    if (!(provider === "anilist" && response.data?.errors?.length)) {
      writeCache(key, response);
    }
    return response;
  } catch (error) {
    const message = /timeout|timed out/i.test(error?.message || "")
      ? `${provider} request timed out.`
      : error?.message || `${provider} request failed.`;
    throw new Error(message);
  } finally {
    inFlightRequests.delete(key);
  }
}

function queueRateLimited(provider, run) {
  const limiter = requestLimiters[provider];
  const next = limiter.queue.then(async () => {
    const wait = Math.max(0, limiter.lastRequestAt + limiter.interval - Date.now());
    if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
    limiter.lastRequestAt = Date.now();
    return run();
  });
  limiter.queue = next.catch(() => {});
  return next;
}

function seasonYear(filters) {
  if (filters.seasonYear) return Number(filters.seasonYear);
  return new Date().getFullYear();
}

function toCatalogAnime(item, provider) {
  if (provider === "anilist") return { ...item, provider };
  if (provider === "kitsu") {
    const attributes = item.attributes || {};
    return {
      id: `kitsu-${item.id}`,
      provider,
      providerId: item.id,
      title: {
        english: attributes.titles?.en || attributes.canonicalTitle,
        romaji: attributes.canonicalTitle,
      },
      coverImage: {
        large: attributes.posterImage?.large || attributes.posterImage?.original,
        extraLarge: attributes.posterImage?.original,
      },
      bannerImage: attributes.coverImage?.original,
      averageScore: attributes.averageRating
        ? Math.round(Number(attributes.averageRating))
        : null,
      genres: [],
      seasonYear: Number(attributes.startDate?.slice(0, 4)) || null,
      episodes: attributes.episodeCount,
      format: attributes.subtype?.toUpperCase(),
      status: attributes.status?.toUpperCase(),
      description: attributes.synopsis,
      siteUrl: `https://kitsu.io/anime/${item.id}`,
      idMal: attributes.malId,
    };
  }

  const attributes = item;
  return {
    id: `jikan-${attributes.mal_id}`,
    provider,
    providerId: attributes.mal_id,
    idMal: attributes.mal_id,
    title: { english: attributes.title_english || attributes.title, romaji: attributes.title },
    coverImage: {
      large: attributes.images?.jpg?.large_image_url || attributes.images?.jpg?.image_url,
      extraLarge: attributes.images?.jpg?.large_image_url,
    },
    bannerImage: attributes.trailer?.images?.maximum_image_url,
    averageScore: attributes.score ? Math.round(attributes.score * 10) : null,
    genres: (attributes.genres || []).map((entry) => entry.name),
    seasonYear: attributes.year || attributes.aired?.prop?.from?.year || null,
    episodes: attributes.episodes,
    format: attributes.type?.toUpperCase(),
    status: attributes.status?.toUpperCase(),
    description: attributes.synopsis,
    siteUrl: attributes.url,
    nextAiringEpisode: null,
  };
}

export function normalizeCatalog(result, provider, page, filters) {
  if (provider === "anilist") {
    const anilistData = result.data?.data;
    const media = anilistData?.Page?.media;
    if (!Array.isArray(media)) throw new Error("AniList did not return anime results.");
    return {
      results: media.map((item) => toCatalogAnime(item, provider)),
      hasNextPage: Boolean(anilistData.Page.pageInfo?.hasNextPage),
      genres: anilistData.GenreCollection || [],
      provider,
    };
  }

  const entries = result.data?.data;
  if (!Array.isArray(entries)) throw new Error(`${provider} did not return anime results.`);
  const includedGenres = new Map(
    (result.data?.included || [])
      .filter((item) => item.type === "genres")
      .map((item) => [item.id, item.attributes?.name]),
  );
  let results = entries.map((item) => {
    const anime = toCatalogAnime(item, provider);
    if (provider === "kitsu") {
      anime.genres = (item.relationships?.genres?.data || [])
        .map((entry) => includedGenres.get(entry.id))
        .filter(Boolean);
    }
    return anime;
  });
  if (filters.genre) {
    results = results.filter((anime) => anime.genres.includes(filters.genre));
  }
  const genres = provider === "kitsu"
    ? [...new Set(includedGenres.values())].filter(Boolean).sort()
    : [...new Set(results.flatMap((anime) => anime.genres))].sort();
  return {
    results,
    hasNextPage: provider === "kitsu"
      ? Boolean(result.data.links?.next)
      : Boolean(result.data.pagination?.has_next_page),
    genres: genres.length ? genres : FALLBACK_GENRES,
    provider,
    page,
  };
}

function buildKitsuPath(filters) {
  const params = new URLSearchParams();
  params.set("page[limit]", "24");
  params.set("page[offset]", String((filters.page - 1) * 24));
  params.set("include", "genres");
  const sort = {
    POPULARITY_DESC: "-userCount",
    SCORE_DESC: "-averageRating",
    TRENDING_DESC: "-userCount",
    START_DATE_DESC: "-startDate",
  }[filters.sort] || "-userCount";
  params.set("sort", sort);
  if (filters.search.trim()) params.set("filter[text]", filters.search.trim());
  if (filters.season) params.set("filter[season]", filters.season.toLowerCase());
  if (filters.seasonYear) params.set("filter[seasonYear]", String(filters.seasonYear));
  if (filters.format === "MOVIE") params.set("filter[subtype]", "movie");
  else if (filters.format) params.set("filter[subtype]", filters.format.toLowerCase());
  return `anime?${params.toString()}`;
}

function buildJikanPath(filters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: "24",
    order_by: filters.sort === "SCORE_DESC" ? "score" : "members",
    sort: "desc",
  });
  if (filters.search.trim()) params.set("q", filters.search.trim());
  if (filters.format === "MOVIE") params.set("type", "movie");
  else if (filters.format) params.set("type", filters.format.toLowerCase());
  if (filters.genre && FALLBACK_GENRE_IDS[filters.genre]) {
    params.set("genres", String(FALLBACK_GENRE_IDS[filters.genre]));
  }
  if (filters.season && filters.seasonYear) {
    const season = filters.season.toLowerCase();
    return `seasons/${filters.seasonYear}/${season}?${params.toString()}`;
  }
  if (filters.seasonYear) {
    params.set("start_date", `${filters.seasonYear}-01-01`);
    params.set("end_date", `${filters.seasonYear}-12-31`);
  }
  return `top/anime?${params.toString()}`;
}

export async function fetchAnimeCatalog(input = {}) {
  const filters = {
    page: 1,
    search: "",
    sort: "POPULARITY_DESC",
    season: "",
    seasonYear: "",
    genre: "",
    format: "",
    ...input,
  };
  const catalogCacheKey = `catalog:${JSON.stringify(filters)}`;
  const cachedCatalog = readCache(catalogCacheKey);
  if (cachedCatalog) return cachedCatalog;

  const errors = [];
  try {
    const result = await request("anilist", "", {
      query: ANIME_CATALOG_QUERY,
      variables: {
        page: filters.page,
        perPage: 24,
        search: filters.search.trim() || null,
        sort: [filters.sort],
        season: filters.season || null,
        seasonYear: filters.season ? seasonYear(filters) : filters.seasonYear ? Number(filters.seasonYear) : null,
        genre: filters.genre || null,
        format: filters.format || null,
      },
    });
    if (result.data?.errors?.length) {
      throw new Error(result.data.errors[0].message || "AniList query failed.");
    }
    const catalog = normalizeCatalog(result, "anilist", filters.page, filters);
    writeCache(catalogCacheKey, catalog);
    return catalog;
  } catch (error) {
    errors.push(`AniList: ${error.message}`);
  }

  try {
    const result = await request("kitsu", buildKitsuPath(filters));
    const catalog = normalizeCatalog(result, "kitsu", filters.page, filters);
    writeCache(catalogCacheKey, catalog);
    return catalog;
  } catch (error) {
    errors.push(`Kitsu: ${error.message}`);
  }

  try {
    const result = await request("jikan", buildJikanPath(filters));
    const catalog = normalizeCatalog(result, "jikan", filters.page, filters);
    writeCache(catalogCacheKey, catalog);
    return catalog;
  } catch (error) {
    errors.push(`Jikan: ${error.message}`);
  }
  throw new Error(errors.join(" · "));
}

export async function fetchAnimeSchedule(days = 7) {
  const now = Math.floor(Date.now() / 1000);
  const after = Math.floor((now - 10 * 60 * 60) / 3600) * 3600;
  const before = Math.ceil((now + days * 24 * 60 * 60) / 3600) * 3600;
  const entries = [];
  let hasNextPage = true;
  for (let page = 1; hasNextPage; page += 1) {
    const result = await request("anilist", "", {
      query: ANIME_SCHEDULE_QUERY,
      variables: {
        page,
        perPage: 50,
        after,
        before,
      },
    });
    if (result.data?.errors?.length) {
      throw new Error(result.data.errors[0].message || "AniList schedule query failed.");
    }
    const pageEntries = result.data?.data?.Page?.airingSchedules;
    if (!Array.isArray(pageEntries)) {
      throw new Error("AniList did not return airing schedules.");
    }
    entries.push(...pageEntries);
    hasNextPage = Boolean(result.data.data.Page.pageInfo?.hasNextPage);
  }
  return entries.map((entry) => ({
    id: entry.id,
    airingAt: entry.airingAt,
    episode: entry.episode,
    media: toCatalogAnime(entry.media, "anilist"),
  }));
}

function decodeXmlText(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, value) => {
      const codePoint = value[0].toLowerCase() === "x"
        ? Number.parseInt(value.slice(1), 16)
        : Number.parseInt(value, 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return entity;
      return String.fromCodePoint(codePoint);
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function rssTagValue(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlText(match[1]) : "";
}

export function parseAnimeNewsFeed(xml) {
  if (typeof xml !== "string") return [];
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map(([, item]) => ({
      title: rssTagValue(item, "title"),
      url: rssTagValue(item, "link"),
      excerpt: rssTagValue(item, "description"),
      date: rssTagValue(item, "pubDate"),
      animeTitle: "Anime News Network",
      source: "Anime News Network",
    }))
    .filter((entry) => entry.title && entry.url);
}

export async function fetchAnimeNews(animeList, options = {}) {
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Number(options.limit) || 12);
  let feedError;
  const readNewsFeed = async () => {
    const result = await request("ann", "all/rss.xml?ann-edition=us");
    return parseAnimeNewsFeed(result.data);
  };
  const useNewsFeed = (feed) => ({
    items: feed.slice(offset, offset + limit),
    hasMore: feed.length > offset + limit,
  });
  try {
    const feed = await readNewsFeed();
    if (feed.length > 0) return useNewsFeed(feed);
    feedError = new Error("Anime News Network returned no news stories.");
  } catch (error) {
    feedError = error;
  }

  const byId = new Map();
  for (const anime of animeList) {
    const id = Number(anime.idMal || (anime.provider === "jikan" ? anime.providerId : null));
    if (id && !byId.has(id)) byId.set(id, anime);
  }
  if (byId.size === 0) {
    throw new Error(feedError?.message || "No anime news source is available.");
  }

  const responses = await Promise.allSettled(
    [...byId].map(async ([id, anime]) => {
      const result = await request("jikan", `anime/${id}/news`);
      const entries = result.data?.data;
      if (!Array.isArray(entries)) throw new Error(`Jikan did not return news for anime ${id}.`);
      return entries.map((entry) => ({
        ...entry,
        animeTitle: anime.title?.english || anime.title?.romaji || "Anime",
        source: "MyAnimeList",
      }));
    }),
  );
  const news = [];
  const errors = [];
  for (const response of responses) {
    if (response.status === "fulfilled") news.push(...response.value);
    else errors.push(response.reason?.message || "Anime news request failed.");
  }
  if (news.length === 0) {
    throw new Error([feedError?.message, ...errors].filter(Boolean).join(" · "));
  }
  const uniqueNews = [...new Map(
    news.sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((item) => [item.url || `${item.title}-${item.date}`, item]),
  ).values()];
  return {
    items: uniqueNews.slice(offset, offset + limit),
    hasMore: uniqueNews.length > offset + limit,
  };
}

export async function fetchAnimeProfile(anime) {
  if (anime.provider === "anilist") {
    try {
      const result = await request("anilist", "", {
        query: ANIME_PROFILE_QUERY,
        variables: { id: Number(anime.id) },
      });
      if (result.data?.errors?.length) {
        throw new Error(result.data.errors[0].message || "AniList profile query failed.");
      }
      const profile = result.data?.data?.Media;
      if (!profile) throw new Error("AniList did not return an anime profile.");
      return { ...profile, provider: "anilist" };
    } catch (anilistError) {
      if (anime.idMal) {
        try {
          return await fetchJikanProfile(anime.idMal);
        } catch (jikanError) {
          throw new Error(`AniList: ${anilistError.message} · Jikan: ${jikanError.message}`);
        }
      }
      throw anilistError;
    }
  }
  if (anime.provider === "jikan") {
    return fetchJikanProfile(anime.providerId, anime);
  }

  const result = await request("kitsu", `anime/${anime.providerId}?include=episodes,characters`);
  const attributes = result.data?.data?.attributes || {};
  const included = result.data?.included || [];
  return {
    ...anime,
    description: attributes.synopsis || attributes.description || anime.description,
    episodes: included.filter((item) => item.type === "episodes").map((item) => item.attributes),
    characters: included.filter((item) => item.type === "characters").map((item) => ({
      node: { name: { full: item.attributes?.name }, image: { large: item.attributes?.image?.original } },
    })),
    staff: [],
    relations: [],
    news: [],
    provider: "kitsu",
  };
}

async function fetchJikanProfile(id, anime = {}) {
  const full = await request("jikan", `anime/${id}/full`);
  const episodes = await request("jikan", `anime/${id}/episodes?page=1`);
  const characters = await request("jikan", `anime/${id}/characters`);
  const staff = await request("jikan", `anime/${id}/staff`);
  const news = await request("jikan", `anime/${id}/news`);
  const data = full.data?.data || {};
  const cast = characters.data?.data || [];
  return {
    ...anime,
    ...toCatalogAnime(data, "jikan"),
    characters: cast.map((entry) => ({
      role: entry.role,
      node: {
        name: { full: entry.character?.name },
        image: { large: entry.character?.images?.jpg?.image_url },
      },
    })),
    staff: (staff.data?.data || []).map((entry) => ({
      role: entry.positions?.join(", ") || "Staff",
      node: {
        name: { full: entry.person?.name },
        image: { large: entry.person?.images?.jpg?.image_url },
        primaryOccupations: entry.positions || [],
      },
    })),
    episodes: episodes.data?.data || [],
    news: news.data?.data || [],
    relations: (data.relations || []).flatMap((group) =>
      (group.entry || []).map((entry) => ({
        relationType: group.relation,
        node: {
          id: `jikan-${entry.mal_id}`,
          idMal: entry.mal_id,
          providerId: entry.mal_id,
          provider: "jikan",
          title: { romaji: entry.name, english: entry.name },
          siteUrl: entry.url,
          coverImage: {},
        },
      })),
    ),
    provider: "jikan",
  };
}
