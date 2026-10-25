// ── Shared subtitle helpers ───────────────────────────────────────────────────

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
  { code: "ar", label: "Arabic" },
  { code: "ku", label: "Kurdish" },
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

// ── GitHub-hosted Subtitle Resolver ───────────────────────────────────────────
// Configure via VITE_SUBTITLES_BASE_URL (e.g. "https://raw.githubusercontent.com/<user>/<repo>/main/public/subtitles")
// Expected repository structure:
//   public/subtitles/movie/{tmdbId}/{lang}.vtt (or .srt)
//   public/subtitles/tv/{tmdbId}/s{season}e{episode}/{lang}.vtt (or .srt)
function getSubtitlesBaseUrl() {
  const raw = (
    (typeof import.meta !== "undefined" &&
      import.meta.env?.VITE_SUBTITLES_BASE_URL) ||
    "/subtitles"
  ).replace(/\/+$/, "");
  if (
    raw.startsWith("/") &&
    typeof window !== "undefined" &&
    window.location?.origin &&
    window.location.protocol.startsWith("http")
  ) {
    return `${window.location.origin}${raw}`;
  }
  return raw;
}

const _subCheckCache = new Map();
let _indexPromise = null;
let _indexData = undefined;

async function getSubtitlesIndex() {
  if (_indexData !== undefined) return _indexData;
  if (!_indexPromise) {
    const baseUrl = getSubtitlesBaseUrl();
    _indexPromise = fetch(`${baseUrl}/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        _indexData = data || null;
        return _indexData;
      })
      .catch(() => {
        _indexData = null;
        return null;
      });
  }
  return _indexPromise;
}

const SUB_META = {
  ku: { lang: "ku", label: "کوردی (سۆرانی)", flag: "☀️" },
  ckb: { lang: "ku", label: "کوردی (سۆرانی)", flag: "☀️" },
  ar: { lang: "ar", label: "العربية", flag: "🇸🇦" },
  en: { lang: "en", label: "English", flag: "🇬🇧" },
};

/**
 * Checks if a subtitle file exists in `public/subtitles/index.json` (or configured repo).
 * Supports both shorthand language codes (`["ku", "ar"]`) and explicit filenames (`["ku.srt", "ar.vtt"]`).
 * Returns { url, lang, available: [{ lang, label, flag, url }] } or null.
 */
export async function resolveGithubSubtitle({
  type,
  tmdbId,
  season = null,
  episode = null,
  preferredLang = null,
}) {
  const baseUrl = getSubtitlesBaseUrl();
  if (!tmdbId || !baseUrl) return null;
  const cacheKey = `${type}_${tmdbId}_${season || 0}_${episode || 0}_${preferredLang || ""}`;
  if (_subCheckCache.has(cacheKey)) return _subCheckCache.get(cacheKey);

  const normalizedPreferred = preferredLang === "ckb" ? "ku" : preferredLang;
  const itemPath =
    type === "movie"
      ? `movie/${tmdbId}`
      : `tv/${tmdbId}/s${season}e${episode}`;
  const basePath = `${baseUrl}/${itemPath}`;

  try {
    const index = await getSubtitlesIndex();
    if (index && typeof index === "object") {
      const entry = index[itemPath];
      if (Array.isArray(entry)) {
        const available = [];
        for (const rawItem of entry) {
          if (typeof rawItem !== "string") continue;
          const clean = rawItem.trim();
          const langCode = clean.split(".")[0].toLowerCase();
          const normLang = langCode === "ckb" ? "ku" : langCode;
          const meta = SUB_META[normLang];
          if (!meta) continue;
          const fileName = /\.(vtt|srt)$/i.test(clean)
            ? clean
            : `${normLang}.vtt`;
          if (!available.some((a) => a.lang === meta.lang)) {
            available.push({
              ...meta,
              url: `${basePath}/${fileName}`,
            });
          }
        }
        if (available.length > 0) {
          const defaultChoice =
            available.find(
              (s) => s.lang === (normalizedPreferred === "ar" ? "ar" : "ku"),
            ) || available[0];
          const found = {
            url: defaultChoice.url,
            lang: defaultChoice.lang,
            available,
          };
          _subCheckCache.set(cacheKey, found);
          return found;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  _subCheckCache.set(cacheKey, null);
  return null;
}
