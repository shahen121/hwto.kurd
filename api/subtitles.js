const fs = require("fs");
const path = require("path");

const DEFAULT_R2_BASE = "https://pub-d1bbd0e1dd5d4e81b55c524af70a17e0.r2.dev";
const subtitleContentCache = new Map();
const SUBTITLE_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

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
  if (/^https?:\/\//i.test(clean)) {
    try {
      clean = new URL(clean).pathname;
    } catch (_e) {}
  }
  clean = clean.replace(/^(\.\.[\/\\])+/, "");
  clean = clean.replace(/^\/?subtitles\/?/i, "");
  clean = clean.replace(/^\/+/, "");
  return path.normalize(clean).replace(/^(\.\.[\/\\])+/, "");
}

/**
 * Universal Subtitle Injector JS:
 * Injected into proxy players (<head>) for VidCore & VidLink.
 * Guarantees Same-Origin + Blob URLs for <track src="..."> to eliminate "Domains, protocols and ports must match".
 */
const UNIVERSAL_SUBTITLE_INJECTOR_JS = `(function() {
  if (window.__universalSubtitlesInjected) return;
  window.__universalSubtitlesInjected = true;

  var origin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";

  function toSameOriginSubUrl(url) {
    if (!url || typeof url !== "string") return "";
    var clean = url.trim();
    if (!clean) return "";

    // Convert external R2 or other domain subtitle URLs to local /subtitles/... bridge
    if (clean.indexOf("r2.dev") !== -1 || clean.indexOf("pub-") !== -1) {
      try {
        var u = new URL(clean, origin || "http://localhost");
        var p = u.pathname;
        if (p.indexOf("/subtitles/") !== 0) p = "/subtitles" + (p.indexOf("/") === 0 ? "" : "/") + p;
        return origin + p;
      } catch (_e) {
        var pathOnly = clean.replace(/^https?:\\/\\/[^\\/]+/i, "");
        if (pathOnly.indexOf("/subtitles/") !== 0) pathOnly = "/subtitles" + (pathOnly.indexOf("/") === 0 ? "" : "/") + pathOnly;
        return origin + pathOnly;
      }
    }

    if (/^https?:\\/\\//i.test(clean)) {
      try {
        var parsed = new URL(clean);
        if (origin && parsed.origin !== origin) {
          var p2 = parsed.pathname;
          if (p2.indexOf("/subtitles/") !== 0) p2 = "/subtitles" + (p2.indexOf("/") === 0 ? "" : "/") + p2;
          return origin + p2;
        }
      } catch (_e) {}
      return clean;
    }

    if (clean.indexOf("/") === 0) {
      return origin + clean;
    }
    return origin + "/subtitles/" + clean;
  }

  // Intercept HTMLTrackElement.prototype.src to always force Same-Origin or Blob URLs
  try {
    if (typeof HTMLTrackElement !== "undefined" && HTMLTrackElement.prototype) {
      var trackSrcDesc = Object.getOwnPropertyDescriptor(HTMLTrackElement.prototype, "src");
      if (trackSrcDesc && trackSrcDesc.set && trackSrcDesc.get) {
        Object.defineProperty(HTMLTrackElement.prototype, "src", {
          configurable: true,
          enumerable: trackSrcDesc.enumerable,
          get: function() { return trackSrcDesc.get.call(this); },
          set: function(val) {
            var raw = String(val || "");
            if (raw.indexOf("blob:") === 0) {
              return trackSrcDesc.set.call(this, raw);
            }
            var normalized = toSameOriginSubUrl(raw);
            return trackSrcDesc.set.call(this, normalized);
          }
        });
      }
    }
  } catch (_e) {}

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
      if (!kuUrl) kuUrl = isTv
        ? origin + "/subtitles/series/" + mId + "/s" + (mSeason || "1") + "/e" + (mEp || "1") + "_ku.vtt"
        : origin + "/subtitles/movie/" + mId + "/ku.vtt";
      if (!arUrl) arUrl = isTv
        ? origin + "/subtitles/series/" + mId + "/s" + (mSeason || "1") + "/e" + (mEp || "1") + "_ar.vtt"
        : origin + "/subtitles/movie/" + mId + "/ar.vtt";
    }
  }

  kuUrl = toSameOriginSubUrl(kuUrl);
  arUrl = toSameOriginSubUrl(arUrl);

  function activatePreferredTrack(v) {
    try {
      if (!v || !v.textTracks || v.textTracks.length === 0) return;
      var targetLang = subLang === "ar" ? "ar" : "ku";
      for (var i = 0; i < v.textTracks.length; i++) {
        var t = v.textTracks[i];
        var isTarget = t.language === targetLang || (targetLang === "ku" && (t.language === "ckb" || (t.label && (t.label.indexOf("کوردی") !== -1 || t.label.indexOf("Kurdî") !== -1))));
        var isOtherHwto = !isTarget && t.label && t.label.indexOf("hwto-kurd") !== -1;
        if (isTarget || (t.default && v.textTracks.length === 1)) {
          t.mode = "showing";
        } else if (isOtherHwto) {
          t.mode = "hidden";
        }
      }
    } catch (_e) {}
  }

  function attachTrack(v, item) {
    var existing = v.querySelectorAll('track[srclang="' + item.lang + '"]');
    if (existing.length > 0) return;

    var initialUrl = toSameOriginSubUrl(item.url);
    if (!initialUrl) return;

    var blobPlaceholder = "";
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob === "function") {
      try {
        blobPlaceholder = URL.createObjectURL(new Blob(["WEBVTT\\n\\n"], { type: "text/vtt;charset=utf-8" }));
      } catch (_e) {}
    }

    var tr = document.createElement("track");
    tr.kind = "subtitles";
    tr.label = item.label;
    tr.srclang = item.lang;
    if (item.def) tr.default = true;
    tr.src = blobPlaceholder || initialUrl;
    v.appendChild(tr);

    // Fetch local VTT from same-origin bridge and create local Blob URL
    if (typeof fetch === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob === "function") {
      fetch(initialUrl)
        .then(function(res) {
          if (!res.ok) return null;
          return res.text();
        })
        .then(function(vttText) {
          if (!vttText || vttText.indexOf("WEBVTT") === -1) return;
          try {
            var blob = new Blob([vttText], { type: "text/vtt;charset=utf-8" });
            var blobUrl = URL.createObjectURL(blob);
            var trs = v.querySelectorAll('track[srclang="' + item.lang + '"]');
            if (trs.length > 0) {
              trs[0].src = blobUrl;
            }
            activatePreferredTrack(v);
          } catch (_e) {}
        })
        .catch(function() {});
    }
  }

  function injectSubtitlesToVideo(v) {
    if (!v) return;

    try {
      if (!v.getAttribute("crossorigin")) {
        v.setAttribute("crossorigin", "anonymous");
        v.crossOrigin = "anonymous";
      }
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
        attachTrack(v, item);
        addedAny = true;
      }
    });

    if (addedAny || !v.__hwtoListenersBound) {
      v.__hwtoListenersBound = true;
      v.addEventListener("loadedmetadata", function() { activatePreferredTrack(v); });
      v.addEventListener("canplay", function() { activatePreferredTrack(v); });
    }

    if (!v.__hwtoTimeSyncBound) {
      v.__hwtoTimeSyncBound = true;
      var notifyTime = function() {
        try {
          var curT = v.currentTime || 0;
          var dur = v.duration || 0;
          var isP = Boolean(v.paused);
          window.parent.postMessage({
            type: "HWTO_VIDEO_TIME",
            currentTime: curT,
            time: curT,
            duration: dur,
            paused: isP,
          }, "*");
          window.parent.postMessage({
            type: "TIME_UPDATE",
            currentTime: curT,
            time: curT,
            duration: dur,
            paused: isP,
          }, "*");
        } catch (_e) {}
      };

      v.addEventListener("timeupdate", notifyTime);
      v.addEventListener("play", notifyTime);
      v.addEventListener("pause", notifyTime);
      v.addEventListener("seeking", notifyTime);
      v.addEventListener("seeked", notifyTime);

      if (typeof setInterval === "function") {
        setInterval(function() {
          if (!v.paused) notifyTime();
        }, 250);
      }
    }

    setTimeout(function() { activatePreferredTrack(v); }, 300);
    setTimeout(function() { activatePreferredTrack(v); }, 1200);
    if (typeof setInterval === "function") {
      setInterval(function() { activatePreferredTrack(v); }, 500);
    }
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
    if (typeof setInterval === "function") {
      setInterval(checkVideos, 500);
    }

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
 * Universal Subtitles API Handler: /api/subtitles & /subtitles/*
 */
async function subtitlesHandler(req, res) {
  const host = req.headers?.host || "localhost:3000";
  const parsedUrl = new URL(req.url || "/", `http://${host}`);
  const query = {
    ...Object.fromEntries(parsedUrl.searchParams.entries()),
    ...(req.query || {}),
  };

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
    let cleanRaw = rawFileParam;
    if (/^https?:\/\//i.test(cleanRaw)) {
      try {
        cleanRaw = new URL(cleanRaw).pathname;
      } catch (_e) {}
    }
    const safeRel = sanitizeSubtitleRelPath(cleanRaw).replace(/\\/g, "/");

    // Check local filesystem first
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
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
      });
      return fs.createReadStream(targetFile).pipe(res);
    }

    // Upstream fallback on Cloudflare R2
    if (externalBase.startsWith("http")) {
      const r2Candidates = [];

      // 1. tv/{id}/s{s}e{e}/{lang}.vtt -> series/{id}/s{s}/e{e}_{lang}.vtt
      const tvMatch1 = safeRel.match(/^tv\/(\d+)\/s(\d+)e(\d+)\/([a-zA-Z0-9_-]+)\.vtt$/i);
      if (tvMatch1) {
        r2Candidates.push(`series/${tvMatch1[1]}/s${tvMatch1[2]}/e${tvMatch1[3]}_${tvMatch1[4]}.vtt`);
      }

      // 2. tv/{id}/{s}/{e}/{lang}.vtt -> series/{id}/s{s}/e{e}_{lang}.vtt
      const tvMatch2 = safeRel.match(/^tv\/(\d+)\/(\d+)\/(\d+)\/([a-zA-Z0-9_-]+)\.vtt$/i);
      if (tvMatch2) {
        r2Candidates.push(`series/${tvMatch2[1]}/s${tvMatch2[2]}/e${tvMatch2[3]}_${tvMatch2[4]}.vtt`);
      }

      // 3. tv/{id}/s{s}/e{e}/{lang}.vtt or tv/{id}/s{s}/e{e}_{lang}.vtt
      const tvMatch3 = safeRel.match(/^tv\/(\d+)\/s(\d+)\/e(\d+)[/_]([a-zA-Z0-9_-]+)\.vtt$/i);
      if (tvMatch3) {
        r2Candidates.push(`series/${tvMatch3[1]}/s${tvMatch3[2]}/e${tvMatch3[3]}_${tvMatch3[4]}.vtt`);
      }

      // 4. series/{id}/{s}/{e}_{lang}.vtt -> series/{id}/s{s}/e{e}_{lang}.vtt
      const seriesMatch1 = safeRel.match(/^series\/(\d+)\/(\d+)\/(\d+)_([a-zA-Z0-9_-]+)\.vtt$/i);
      if (seriesMatch1) {
        r2Candidates.push(`series/${seriesMatch1[1]}/s${seriesMatch1[2]}/e${seriesMatch1[3]}_${seriesMatch1[4]}.vtt`);
      }

      // Direct safeRel
      r2Candidates.push(safeRel);

      // Check in-memory subtitle cache
      for (const cand of r2Candidates) {
        if (subtitleContentCache.has(cand)) {
          const entry = subtitleContentCache.get(cand);
          if (Date.now() - entry.timestamp < SUBTITLE_CACHE_TTL) {
            res.writeHead(200, {
              "Content-Type": "text/vtt; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
            });
            return res.end(entry.data);
          }
        }
      }

      for (const cand of r2Candidates) {
        const remoteUrl = `${externalBase}/${cand}`;
        try {
          const upstreamRes = await fetch(remoteUrl);
          if (upstreamRes.ok) {
            const contentType =
              upstreamRes.headers.get("content-type") || "text/vtt; charset=utf-8";
            const data = await upstreamRes.arrayBuffer();
            const buf = Buffer.from(data);
            subtitleContentCache.set(cand, { data: buf, timestamp: Date.now() });
            res.writeHead(200, {
              "Content-Type": contentType,
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
            });
            return res.end(buf);
          }
        } catch (_e) {}
      }
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

  // If no subtitles were registered upstream, provide default fallback same-origin paths
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
module.exports.subtitleContentCache = subtitleContentCache;
