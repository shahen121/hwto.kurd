// ── Shared subtitle helpers & Cloudflare R2 Subtitle Resolver ─────────────────

export const R2_SUBTITLES_BASE_URL =
  "https://pub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev";

export const SUBTITLE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "ru", label: "Russian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh-CN", label: "Chinese" },
  { code: "ar", label: "العربية" },
  { code: "ku", label: "Kurdî" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "cs", label: "Czech" },
  { code: "hu", label: "Hungarian" },
];

export const LANG_LABEL = Object.fromEntries(
  SUBTITLE_LANGUAGES.map((l) => [l.code, l.label]),
);

/** Return the style props for a source badge (SubDL / Wyzie) */
export function sourceBadgeStyle(sub) {
  const isSubDL = sub.via_subdl;
  return {
    fontSize: 9,
    fontWeight: 700,
    padding: "1px 5px",
    borderRadius: 3,
    background: isSubDL ? "rgba(99,149,255,0.15)" : "rgba(180,130,255,0.15)",
    color: isSubDL ? "#6395ff" : "#b482ff",
    border: `1px solid ${isSubDL ? "rgba(99,149,255,0.3)" : "rgba(180,130,255,0.3)"}`,
    textTransform: "uppercase",
    flexShrink: 0,
  };
}

export function sourceBadgeLabel(sub) {
  if (sub.via_subdl) return "SubDL";
  return "Wyzie";
}

export const SUB_META = {
  ku: { lang: "ku", label: "Kurdî", flag: "☀️" },
  ckb: { lang: "ku", label: "Kurdî", flag: "☀️" },
  ar: { lang: "ar", label: "العربية", flag: "🇸🇦" },
  en: { lang: "en", label: "English", flag: "🇬🇧" },
};

export function getSubtitleMeta(langCode) {
  const code = (langCode || "").trim().toLowerCase();
  const norm = code === "ckb" ? "ku" : code;
  if (SUB_META[norm]) return SUB_META[norm];
  const found = SUBTITLE_LANGUAGES.find((l) => l.code === norm);
  return {
    lang: norm,
    label: found ? found.label : norm.toUpperCase(),
    flag: "🌐",
  };
}

export function getSubtitlesBaseUrl() {
  const custom =
    (typeof import.meta !== "undefined" &&
      import.meta.env?.VITE_SUBTITLES_BASE_URL) ||
    "";
  if (custom && typeof custom === "string" && custom.trim().length > 0) {
    return custom.replace(/\/+$/, "");
  }
  return R2_SUBTITLES_BASE_URL;
}

// Memory caches
const _subCheckCache = new Map();
const _infoCache = new Map();

/**
 * Fetch info.json for a specific movie or series work.
 * Handles 404 gracefully without logging loud console errors or interrupting UI.
 */
async function fetchItemInfo(infoUrl, cacheKey) {
  if (_infoCache.has(cacheKey)) {
    return _infoCache.get(cacheKey);
  }

  const promise = (async () => {
    try {
      const res = await fetch(infoUrl);
      if (!res.ok) {
        // Subtitles not available for this item (e.g. 404)
        return null;
      }
      const data = await res.json();
      return data && typeof data === "object" ? data : null;
    } catch {
      // Network failure or offline - silently return null
      return null;
    }
  })();

  _infoCache.set(cacheKey, promise);
  return promise;
}

/**
 * Resolves subtitles hosted on Cloudflare R2 for movies and series episodes.
 *
 * Structure:
 * - Movie info:   https://<baseUrl>/movie/{tmdb_id}/info.json -> {"subtitles": ["ar", "ku"]}
 * - Movie direct: https://<baseUrl>/movie/{tmdb_id}/{lang}.vtt
 *
 * - Series info:   https://<baseUrl>/series/{tmdb_id}/info.json -> {"1": {"1": ["ar", "ku"]}}
 * - Series direct: https://<baseUrl>/series/{tmdb_id}/s{season}/e{episode}_{lang}.vtt
 *
 * Returns { url, lang, available: [{ lang, label, flag, url }] } or null.
 */
export async function resolveGithubSubtitle({
  type,
  tmdbId,
  season = null,
  episode = null,
  preferredLang = null,
}) {
  if (!tmdbId) return null;
  const baseUrl = getSubtitlesBaseUrl();
  if (!baseUrl) return null;

  const isSeries =
    type === "tv" ||
    type === "series" ||
    (type !== "movie" && (season != null || episode != null));
  const numSeason = season != null ? Number(season) : 1;
  const numEpisode = episode != null ? Number(episode) : 1;

  const cacheKey = `${isSeries ? "series" : "movie"}_${tmdbId}_${isSeries ? numSeason : 0}_${isSeries ? numEpisode : 0}_${preferredLang || ""}`;
  if (_subCheckCache.has(cacheKey)) {
    return _subCheckCache.get(cacheKey);
  }

  const normalizedPreferred = preferredLang === "ckb" ? "ku" : preferredLang;

  try {
    if (!isSeries) {
      // ── Movie Subtitles ──────────────────────────────────────────────────
      const infoUrl = `${baseUrl}/movie/${tmdbId}/info.json`;
      const info = await fetchItemInfo(infoUrl, `movie_${tmdbId}`);

      const rawSubList = Array.isArray(info?.subtitles)
        ? info.subtitles
        : Array.isArray(info)
          ? info
          : [];

      if (rawSubList.length > 0) {
        const available = [];
        for (const raw of rawSubList) {
          if (!raw || typeof raw !== "string") continue;
          const cleanCode = raw.split(".")[0].trim().toLowerCase();
          const normLang = cleanCode === "ckb" ? "ku" : cleanCode;
          const meta = getSubtitleMeta(normLang);
          const directUrl = `/subtitles/movie/${tmdbId}/${normLang}.vtt`;

          if (!available.some((a) => a.lang === meta.lang)) {
            available.push({
              ...meta,
              url: directUrl,
            });
          }
        }

        if (available.length > 0) {
          const defaultChoice =
            (normalizedPreferred &&
              available.find((s) => s.lang === normalizedPreferred)) ||
            available.find((s) => s.lang === "ku") ||
            available.find((s) => s.lang === "ar") ||
            available[0];

          available.forEach((s) => {
            s.isDefault = s.lang === defaultChoice.lang;
          });

          const result = {
            url: defaultChoice.url,
            lang: defaultChoice.lang,
            available,
          };
          _subCheckCache.set(cacheKey, result);
          return result;
        }
      }
    } else {
      // ── Series Subtitles ─────────────────────────────────────────────────
      const infoUrl = `${baseUrl}/series/${tmdbId}/info.json`;
      const info = await fetchItemInfo(infoUrl, `series_${tmdbId}`);

      if (info && typeof info === "object") {
        const seasonKey = String(numSeason);
        const episodeKey = String(numEpisode);
        const seasonGroup =
          info[seasonKey] ||
          info[numSeason] ||
          info[`s${numSeason}`] ||
          info[`S${numSeason}`];
        const rawEpisodeSubs =
          seasonGroup?.[episodeKey] ||
          seasonGroup?.[numEpisode] ||
          seasonGroup?.[`e${numEpisode}`] ||
          seasonGroup?.[`E${numEpisode}`];

        if (Array.isArray(rawEpisodeSubs) && rawEpisodeSubs.length > 0) {
          const available = [];
          for (const raw of rawEpisodeSubs) {
            if (!raw || typeof raw !== "string") continue;
            const cleanCode = raw.split(".")[0].trim().toLowerCase();
            const normLang = cleanCode === "ckb" ? "ku" : cleanCode;
            const meta = getSubtitleMeta(normLang);
            const directUrl = `/subtitles/series/${tmdbId}/s${numSeason}/e${numEpisode}_${normLang}.vtt`;

            if (!available.some((a) => a.lang === meta.lang)) {
              available.push({
                ...meta,
                url: directUrl,
              });
            }
          }

          if (available.length > 0) {
            const defaultChoice =
              (normalizedPreferred &&
                available.find((s) => s.lang === normalizedPreferred)) ||
              available.find((s) => s.lang === "ku") ||
              available.find((s) => s.lang === "ar") ||
              available[0];

            available.forEach((s) => {
              s.isDefault = s.lang === defaultChoice.lang;
            });

            const result = {
              url: defaultChoice.url,
              lang: defaultChoice.lang,
              available,
            };
            _subCheckCache.set(cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch {
    // Fail silently without errors
  }

  _subCheckCache.set(cacheKey, null);
  return null;
}

// Aliases for clear naming across components
export const resolveCloudSubtitle = resolveGithubSubtitle;
export const resolveSubtitle = resolveGithubSubtitle;
