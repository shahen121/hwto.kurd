const fs = require("fs");
const path = require("path");

const DEFAULT_R2_BASE = "https://pub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev";

const SUB_META = {
  ku: { lang: "ku", label: "Kurdî", flag: "☀️" },
  ckb: { lang: "ku", label: "Kurdî", flag: "☀️" },
  ar: { lang: "ar", label: "العربية", flag: "🇸🇦" },
  en: { lang: "en", label: "English", flag: "🇬🇧" },
};

function getSubtitlesDirectory() {
  const candidates = [
    path.join(__dirname, "..", "public", "subtitles"),
    path.join(__dirname, "public", "subtitles"),
    path.join(process.cwd(), "public", "subtitles"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

/**
 * Strips leading /subtitles/, .. and slashes so path resolves accurately inside subDir
 */
function sanitizeSubtitleRelPath(rawFile) {
  if (!rawFile || typeof rawFile !== "string") return "";
  let clean = rawFile.replace(/\\/g, "/").trim();
  clean = clean.replace(/^(\.\.[\/\\])+/, "");
  clean = clean.replace(/^\/?subtitles\/?/i, "");
  clean = clean.replace(/^\/+/, "");
  return path.normalize(clean).replace(/^(\.\.[\/\\])+/, "");
}

/**
 * Universal Subtitle Injector JS:
 * Injected into proxy players (<head>) for VidCore & VidLink.
 */
const UNIVERSAL_SUBTITLE_INJECTOR_JS = `(function() {
  if (window.__universalSubtitlesInjected) return;
  window.__universalSubtitlesInjected = true;

  function getQueryParam(name) {
    try {
      var p = new URLSearchParams(window.location.search);
      return p.get(name) || "";
    } catch (_e) {
      return "";
    }
  }

  var subUrl = getQueryParam("sub_url") || getQueryParam("sub_file") || "";
  var subLang = (getQueryParam("sub") || getQueryParam("ds_lang") || getQueryParam("lang") || "ku").toLowerCase();
  if (subLang === "ckb") subLang = "ku";

  var kuUrl = getQueryParam("sub_url_ku");
  var arUrl = getQueryParam("sub_url_ar");

  if (subUrl) {
    if (subLang === "ar" && !arUrl) arUrl = subUrl;
    else if (!kuUrl) kuUrl = subUrl;
  }

  if (!kuUrl || !arUrl) {
    var pathMatch = (window.location.pathname || "").match(/\\/(?:vidcore|vidlink|embed)?\\/?(movie|tv|series)\\/(\\d+)(?:\\/(\\d+)\\/(\\d+))?/i);
    if (pathMatch) {
      var mType = pathMatch[1].toLowerCase();
      var mId = pathMatch[2];
      var mSeason = pathMatch[3];
      var mEp = pathMatch[4];
      var isTv = (mType === "tv" || mType === "series");
      var r2Base = "${DEFAULT_R2_BASE}";
      if (!kuUrl) kuUrl = isTv
        ? r2Base + "/series/" + mId + "/s" + (mSeason || "1") + "/e" + (mEp || "1") + "_ku.vtt"
        : r2Base + "/movie/" + mId + "/ku.vtt";
      if (!arUrl) arUrl = isTv
        ? r2Base + "/series/" + mId + "/s" + (mSeason || "1") + "/e" + (mEp || "1") + "_ar.vtt"
        : r2Base + "/movie/" + mId + "/ar.vtt";
    }
  }

  var origin = window.location.origin;
  function toAbsolute(url) {
    if (!url) return "";
    if (/^https?:\\/\\//i.test(url)) return url;
    return origin + (url.indexOf("/") === 0 ? "" : "/") + url;
  }

  kuUrl = toAbsolute(kuUrl);
  arUrl = toAbsolute(arUrl);

  function activatePreferredTrack(v) {
    try {
      if (!v || !v.textTracks || v.textTracks.length === 0) return;
      var targetLang = subLang === "ar" ? "ar" : "ku";
      for (var i = 0; i < v.textTracks.length; i++) {
        var t = v.textTracks[i];
        var isTarget = t.language === targetLang || (targetLang === "ku" && (t.language === "ckb" || (t.label && (t.label.indexOf("کوردی") !== -1 || t.label.indexOf("Kurdî") !== -1))));
        var isOtherHwto = !isTarget && t.label && t.label.indexOf("hwto-kurd") !== -1;
        if (isTarget) {
          t.mode = "showing";
        } else if (isOtherHwto) {
          t.mode = "hidden";
        }
      }
    } catch (_e) {}
  }

  function injectSubtitlesToVideo(v) {
    if (!v) return;

    try {
      v.setAttribute("playsinline", "");
      v.setAttribute("webkit-playsinline", "");
      v.playsInline = true;
    } catch (_e) {}

    var tracks = [];
    if (kuUrl) {
      tracks.push({ lang: "ku", label: "Kurdî (hwto-kurd)", url: kuUrl, def: subLang !== "ar" });
    }
    if (arUrl) {
      tracks.push({ lang: "ar", label: "العربية (hwto-kurd)", url: arUrl, def: subLang === "ar" });
    }

    var addedAny = false;
    tracks.forEach(function(item) {
      var existing = v.querySelectorAll('track[srclang="' + item.lang + '"]');
      if (existing.length === 0) {
        var tr = document.createElement("track");
        tr.kind = "subtitles";
        tr.label = item.label;
        tr.srclang = item.lang;
        tr.src = item.url;
        if (item.def) tr.default = true;
        v.appendChild(tr);
        addedAny = true;
      }
    });

    if (addedAny || !v.__hwtoListenersBound) {
      v.__hwtoListenersBound = true;
      v.addEventListener("loadedmetadata", function() { activatePreferredTrack(v); });
      v.addEventListener("canplay", function() { activatePreferredTrack(v); });
    }

    setTimeout(function() { activatePreferredTrack(v); }, 300);
    setTimeout(function() { activatePreferredTrack(v); }, 1200);
  }

  function checkVideos() {
    try {
      var vids = document.querySelectorAll("video");
      for (var i = 0; i < vids.length; i++) {
        injectSubtitlesToVideo(vids[i]);
      }
    } catch (_e) {}
  }

  function initSubtitleObserver() {
    function scheduleCheck() {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(function() { checkVideos(); }, { timeout: 1000 });
      } else {
        setTimeout(checkVideos, 250);
      }
    }

    scheduleCheck();

    if (typeof MutationObserver !== "undefined") {
      var obs = new MutationObserver(function(mutations) {
        var shouldCheck = false;
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (node.nodeType === 1) {
              if (node.nodeName === "VIDEO" || (node.querySelector && node.querySelector("video"))) {
                shouldCheck = true;
                break;
              }
            }
          }
          if (shouldCheck) break;
        }
        if (shouldCheck) scheduleCheck();
      });

      var root = document.body || document.documentElement;
      if (root) {
        obs.observe(root, { childList: true, subtree: true });
      }
    }
  }

  if (document.readyState === "complete") {
    setTimeout(initSubtitleObserver, 600);
  } else {
    window.addEventListener("load", function() {
      setTimeout(initSubtitleObserver, 600);
    });
  }
})();`;

/**
 * Universal Subtitles API Handler: /api/subtitles
 * Query params:
 *   - type: "movie" | "tv" | "series"
 *   - id: TMDB Id
 *   - season: Season number (for tv/series)
 *   - episode: Episode number (for tv/series)
 *   - file: Path to specific subtitle file to serve directly (.vtt / .srt)
 */
async function subtitlesHandler(req, res) {
  const host = req.headers?.host || "localhost:3000";
  const parsedUrl = new URL(req.url || "/", `http://${host}`);
  const query = Object.fromEntries(parsedUrl.searchParams.entries());

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  const subDir = getSubtitlesDirectory();
  const externalBase = (
    process.env.SUBTITLES_BASE_URL ||
    process.env.VITE_SUBTITLES_BASE_URL ||
    DEFAULT_R2_BASE
  ).replace(/\/+$/, "");

  // 1. Direct file stream request (or direct /subtitles/* path)
  const rawFileParam =
    query.file ||
    (parsedUrl.pathname.startsWith("/subtitles/")
      ? parsedUrl.pathname.replace(/^\/subtitles\//, "")
      : "");

  if (rawFileParam) {
    const safeRel = sanitizeSubtitleRelPath(rawFileParam).replace(/\\/g, "/");

    // Check local filesystem first (allows offline tests and local downloads)
    const targetFile = path.join(subDir, safeRel);
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
      const ext = path.extname(targetFile).toLowerCase();
      const contentType =
        ext === ".vtt"
          ? "text/vtt; charset=utf-8"
          : "text/plain; charset=utf-8";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      });
      return fs.createReadStream(targetFile).pipe(res);
    }

    // Upstream fallback on Cloudflare R2
    if (externalBase.startsWith("http")) {
      let r2Path = safeRel;

      // Map legacy tv path: tv/{id}/s{s}e{e}/{lang}.vtt -> series/{id}/s{s}/e{e}_{lang}.vtt
      const tvMatch = safeRel.match(/^tv\/(\d+)\/s(\d+)e(\d+)\/([a-zA-Z0-9_-]+)\.vtt$/i);
      if (tvMatch) {
        r2Path = `series/${tvMatch[1]}/s${tvMatch[2]}/e${tvMatch[3]}_${tvMatch[4]}.vtt`;
      }

      const remoteUrl = `${externalBase}/${r2Path}`;
      try {
        const upstreamRes = await fetch(remoteUrl);
        if (upstreamRes.ok) {
          const contentType =
            upstreamRes.headers.get("content-type") || "text/vtt; charset=utf-8";
          const data = await upstreamRes.arrayBuffer();
          res.writeHead(200, {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          });
          return res.end(Buffer.from(data));
        }
      } catch (_e) {}
    }

    // Never return 404 for subtitle files - return a valid empty WebVTT with 200 OK
    res.writeHead(200, {
      "Content-Type": "text/vtt; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    });
    return res.end("WEBVTT\n\n");
  }

  // 2. Query subtitles for media item
  const { type, id, season, episode } = query;
  if (!id) {
    res.statusCode = 400;
    return res.end(
      JSON.stringify({ ok: false, error: "Missing required parameter: id" }),
    );
  }

  const isSeries = type === "tv" || type === "series";
  const numSeason = season != null ? Number(season) : 1;
  const numEpisode = episode != null ? Number(episode) : 1;
  const available = [];

  // Query R2 info.json directly
  try {
    if (!isSeries) {
      const infoRes = await fetch(`${externalBase}/movie/${id}/info.json`);
      if (infoRes.ok) {
        const data = await infoRes.json();
        if (data && Array.isArray(data.subtitles)) {
          for (const raw of data.subtitles) {
            const clean = String(raw).split(".")[0].trim().toLowerCase();
            const norm = clean === "ckb" ? "ku" : clean;
            const meta = SUB_META[norm] || { lang: norm, label: norm, flag: "🌐" };
            if (!available.some((a) => a.lang === meta.lang)) {
              available.push({
                ...meta,
                url: `/subtitles/movie/${id}/${norm}.vtt`,
              });
            }
          }
        }
      }
    } else {
      const infoRes = await fetch(`${externalBase}/series/${id}/info.json`);
      if (infoRes.ok) {
        const data = await infoRes.json();
        const seasonKey = String(numSeason);
        const episodeKey = String(numEpisode);
        const sGroup = data?.[seasonKey] || data?.[numSeason];
        const epSubs = sGroup?.[episodeKey] || sGroup?.[numEpisode];
        if (Array.isArray(epSubs)) {
          for (const raw of epSubs) {
            const clean = String(raw).split(".")[0].trim().toLowerCase();
            const norm = clean === "ckb" ? "ku" : clean;
            const meta = SUB_META[norm] || { lang: norm, label: norm, flag: "🌐" };
            if (!available.some((a) => a.lang === meta.lang)) {
              available.push({
                ...meta,
                url: `/subtitles/series/${id}/s${numSeason}/e${numEpisode}_${norm}.vtt`,
              });
            }
          }
        }
      }
    }
  } catch (_e) {}

  // If no subtitles were registered upstream, provide default fallback paths
  if (available.length === 0) {
    if (type === "tv") {
      const itemPath = `tv/${id}/s${season || 1}e${episode || 1}`;
      available.push({
        ...SUB_META.ku,
        url: `/subtitles/${itemPath}/ku.vtt`,
      });
      available.push({
        ...SUB_META.ar,
        url: `/subtitles/${itemPath}/ar.vtt`,
      });
    } else if (isSeries) {
      const itemPath = `series/${id}/s${numSeason}/e${numEpisode}`;
      available.push({
        ...SUB_META.ku,
        url: `/subtitles/${itemPath}_ku.vtt`,
      });
      available.push({
        ...SUB_META.ar,
        url: `/subtitles/${itemPath}_ar.vtt`,
      });
    } else {
      const itemPath = `movie/${id}`;
      available.push({
        ...SUB_META.ku,
        url: `/subtitles/${itemPath}/ku.vtt`,
      });
      available.push({
        ...SUB_META.ar,
        url: `/subtitles/${itemPath}/ar.vtt`,
      });
    }
  }

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  return res.end(
    JSON.stringify({
      ok: true,
      type: type || "movie",
      id,
      season: season || null,
      episode: episode || null,
      subtitles: available,
    }),
  );
}

module.exports = subtitlesHandler;
module.exports.default = subtitlesHandler;
module.exports.subtitlesHandler = subtitlesHandler;
module.exports.UNIVERSAL_SUBTITLE_INJECTOR_JS = UNIVERSAL_SUBTITLE_INJECTOR_JS;
module.exports.sanitizeSubtitleRelPath = sanitizeSubtitleRelPath;
module.exports.SUB_META = SUB_META;
module.exports.DEFAULT_R2_BASE = DEFAULT_R2_BASE;
