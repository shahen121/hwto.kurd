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
const SUBTITLES_BASE_URL = (
  (typeof import.meta !== "undefined" &&
    import.meta.env?.VITE_SUBTITLES_BASE_URL) ||
  "https://raw.githubusercontent.com/shahen121/hwto.kurd/main/public/subtitles"
).replace(/\/+$/, "");

const _subCheckCache = new Map();
let _indexPromise = null;
let _indexData = null;

async function getSubtitlesIndex() {
  if (_indexData !== null) return _indexData;
  if (!_indexPromise) {
    _indexPromise = fetch(`${SUBTITLES_BASE_URL}/index.json`)
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
 * Checks if a subtitle file exists on the GitHub subtitles repository.
 * Returns { url, lang, available: [{ lang, label, flag, url }] } or null.
 */
export async function resolveGithubSubtitle({
  type,
  tmdbId,
  season = null,
  episode = null,
  preferredLang = null,
}) {
  if (!tmdbId || !SUBTITLES_BASE_URL) return null;
  const cacheKey = `${type}_${tmdbId}_${season || 0}_${episode || 0}_${preferredLang || ""}`;
  if (_subCheckCache.has(cacheKey)) return _subCheckCache.get(cacheKey);

  const normalizedPreferred = preferredLang === "ckb" ? "ku" : preferredLang;
  const itemPath =
    type === "movie"
      ? `movie/${tmdbId}`
      : `tv/${tmdbId}/s${season}e${episode}`;
  const basePath = `${SUBTITLES_BASE_URL}/${itemPath}`;

  // 1. Fast path: check index.json if available
  try {
    const index = await getSubtitlesIndex();
    if (index && Object.keys(index).length > 0) {
      if (index[itemPath] && Array.isArray(index[itemPath])) {
        const availableLangs = index[itemPath];
        const available = [];
        if (availableLangs.includes("ku")) {
          available.push({
            ...SUB_META.ku,
            url: `${basePath}/ku.vtt`,
          });
        }
        if (availableLangs.includes("ar")) {
          available.push({
            ...SUB_META.ar,
            url: `${basePath}/ar.vtt`,
          });
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
      // Index is loaded and valid, but itemPath was not found:
      // Subtitle does not exist in the repo for this item -> return null immediately.
      // Do NOT fall through to network HEAD requests which cause 404 console errors.
      _subCheckCache.set(cacheKey, null);
      return null;
    }
  } catch {
    // Fall back to direct network check only if index failed to load
  }

  // 2. Direct network check (HEAD request fallback)
  const candidateLangs = ["ku", "ar"];
  const exts = ["vtt", "srt"];
  const available = [];

  for (const lang of candidateLangs) {
    for (const ext of exts) {
      const candidateUrl = `${basePath}/${lang}.${ext}`;
      try {
        const res = await fetch(candidateUrl, { method: "HEAD" });
        if (res.ok) {
          available.push({
            ...(SUB_META[lang] || { lang, label: lang.toUpperCase(), flag: "🌐" }),
            url: candidateUrl,
          });
          break; // found this language, don't check next ext
        }
      } catch {
        // Ignore network errors
      }
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

  _subCheckCache.set(cacheKey, null);
  return null;
}
