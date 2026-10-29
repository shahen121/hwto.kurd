const { Readable } = require("stream");

// VidCore + Vidlink Ad-Free Proxy & Stream Gateway (Vercel Serverless + Node HTTP Server)

const VIDCORE_ORIGIN = process.env.VIDCORE_ORIGIN || "https://vidcore.io";
const VIDLINK_ORIGIN = process.env.VIDLINK_ORIGIN || "https://vidlink.pro";
const CF_WORKER_URL = (
  process.env.CF_WORKER_URL || "https://hwto.proteome626.workers.dev"
).replace(/\/+$/, "");

const config = {
  mode: process.env.VIDCORE_PROXY_MODE || "auto",
};

let _tokenRoundRobinIndex = 0;
const _sessionTokenMap = new Map();

function getScrapeDoTokens() {
  const rawTokens = [
    process.env.SCRAPE_DO_TOKEN_1,
    process.env.SCRAPE_DO_TOKEN_2,
    process.env.SCRAPE_DO_TOKEN_3,
    process.env.SCRAPE_DO_TOKEN,
  ]
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  return [...new Set(rawTokens)];
}

function getSessionTokenIndex(sessionId, tokensCount) {
  if (!sessionId || tokensCount <= 1) {
    const idx = _tokenRoundRobinIndex;
    _tokenRoundRobinIndex = (_tokenRoundRobinIndex + 1) % tokensCount;
    return idx;
  }
  if (_sessionTokenMap.has(sessionId)) {
    return _sessionTokenMap.get(sessionId) % tokensCount;
  }
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  const idx = hash % tokensCount;
  _sessionTokenMap.set(sessionId, idx);
  return idx;
}

function advanceSessionToken(sessionId, tokensCount) {
  if (!sessionId || tokensCount <= 1) return;
  const current = _sessionTokenMap.get(sessionId) || 0;
  _sessionTokenMap.set(sessionId, (current + 1) % tokensCount);
}

function buildScrapeDoUrl(targetUrl, token, useCustomHeaders = true, sessionId = "884422") {
  const api = new URL("https://api.scrape.do/");
  api.searchParams.set("token", token);
  api.searchParams.set("url", targetUrl);
  if (useCustomHeaders) api.searchParams.set("customHeaders", "true");
  if (sessionId) {
    const cleanSessionId = String(sessionId).trim().slice(0, 10);
    if (cleanSessionId) {
      api.searchParams.set("sessionId", cleanSessionId);
      api.searchParams.set("session_number", cleanSessionId);
    }
  }
  return api.toString();
}

function getScrapeDoSessionId(req, targetPathAndQuery = "") {
  if (!req) return "884422";
  if (
    req.query &&
    (req.query.sessionId || req.query.session_number || req.query.sid || req.query.media_id)
  ) {
    const s = String(
      req.query.sessionId || req.query.session_number || req.query.sid || req.query.media_id
    )
      .trim()
      .slice(0, 10);
    if (s) return s;
  }

  let mediaId = "";
  const pathMatch = String(targetPathAndQuery || req.url || "").match(/\/(movie|tv)\/(\d+)/i);
  if (pathMatch) {
    mediaId = pathMatch[2];
  } else {
    const ref = String((req.headers && req.headers["referer"]) || "");
    const refMatch = ref.match(/\/(movie|tv)\/(\d+)/i);
    if (refMatch) {
      mediaId = refMatch[2];
    }
  }

  if (!mediaId && req.headers && req.headers["x-hwto-media-id"]) {
    mediaId = String(req.headers["x-hwto-media-id"]).trim();
  }

  const rawHeader =
    (req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "";
  const clientIp = rawHeader
    ? rawHeader.split(",")[0].trim()
    : (req.socket && req.socket.remoteAddress) || "";

  if (!clientIp && !mediaId) {
    return "884422";
  }

  const seed = `${clientIp || "client"}_${mediaId || "vidcore"}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return String((hash % 900000) + 100000);
}

async function fetchViaScrapeDoWithRotation(targetUrl, fetchImpl = fetch, options = {}) {
  const tokens = getScrapeDoTokens();
  if (tokens.length === 0) throw new Error("No Scrape.do tokens configured");

  const sessionId = options.sessionId;
  let startIdx;
  if (options.tokenIndex !== undefined) {
    startIdx = options.tokenIndex % tokens.length;
  } else if (sessionId) {
    startIdx = getSessionTokenIndex(sessionId, tokens.length);
  } else {
    startIdx = _tokenRoundRobinIndex;
    _tokenRoundRobinIndex = (_tokenRoundRobinIndex + 1) % tokens.length;
  }

  const effectiveSessionId = sessionId || "884422";
  const method = options.method || "GET";
  const headers = { ...(options.headers || {}) };

  delete headers["Content-Length"];
  delete headers["content-length"];
  delete headers["Connection"];
  delete headers["connection"];
  delete headers["Host"];
  delete headers["host"];

  const fetchOpts = { method, headers };
  if (method === "POST" && options.body && options.body.length > 0) {
    fetchOpts.body = options.body;
  }

  let lastRes = null;
  let lastErr = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[(startIdx + i) % tokens.length];
    const scrapeUrl = buildScrapeDoUrl(targetUrl, token, true, effectiveSessionId);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetchImpl(scrapeUrl, { ...fetchOpts, signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );

      const initialStatus =
        res.headers && typeof res.headers.get === "function"
          ? res.headers.get("scrape.do-initial-status-code")
          : null;
      if (
        (res.status === 401 || res.status === 403 || res.status === 429) &&
        initialStatus !== "404" &&
        initialStatus !== "200"
      ) {
        lastRes = res;
        advanceSessionToken(sessionId, tokens.length);
        continue;
      }
      if (res.status < 500) return res;
      lastRes = res;
      advanceSessionToken(sessionId, tokens.length);
    } catch (err) {
      lastErr = err;
      advanceSessionToken(sessionId, tokens.length);
    }
  }
  if (lastRes) return lastRes;
  throw lastErr || new Error("All Scrape.do tokens failed");
}

const AD_SHIELD_JS = `(function() {
  if (window.__vidcoreShieldInitialized) return;
  window.__vidcoreShieldInitialized = true;
  var CF_WORKER = ${JSON.stringify(CF_WORKER_URL)};
  var lastMpdOrigin = "https://surge.flooderrr.store";
  var lastMpdBaseDir = "";
  var lastMpdQuery = "";

  var isVidlink = false;
  var isVidcore = false;
  try {
    var locHref = String((window.location && window.location.href) || "");
    if (locHref.indexOf("/vidlink/") !== -1 || (window.location && window.location.hostname && window.location.hostname.indexOf("vidlink") !== -1)) {
      isVidlink = true;
    }
    if (locHref.indexOf("/vidcore/") !== -1 || (window.location && window.location.hostname && window.location.hostname.indexOf("vidcore") !== -1)) {
      isVidcore = true;
    }
  } catch (_e) {}
  var spoofDomain = isVidlink ? "vidlink.pro" : "vidcore.io";
  var spoofOrigin = "https://" + spoofDomain;
  var locOrigin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";

  try {
    var __fakeLoc = new Proxy(window.location, {
      get: function(target, prop) {
        if (prop === "hostname" || prop === "host") return spoofDomain;
        if (prop === "origin") return spoofOrigin;
        if (prop === "protocol") return "https:";
        if (prop === "port") return "";
        if (prop === "href") return spoofOrigin + (window.location.pathname || "/") + (window.location.search || "");
        var val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });

    var __fakeDoc = new Proxy(document, {
      get: function(target, prop) {
        if (prop === "domain") return spoofDomain;
        if (prop === "URL") return spoofOrigin + (window.location.pathname || "/") + (window.location.search || "");
        if (prop === "referrer") return spoofOrigin + "/";
        if (prop === "location") return __fakeLoc;
        var val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });

    var __fakeWin = new Proxy(window, {
      get: function(target, prop) {
        if (prop === "location") return __fakeLoc;
        if (prop === "document") return __fakeDoc;
        if (prop === "origin") return spoofOrigin;
        if (prop === "self" || prop === "window" || prop === "top" || prop === "parent" || prop === "globalThis") {
          return __fakeWin;
        }
        var val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });

    window.__fakeWin = __fakeWin;
    window.__fakeDoc = __fakeDoc;
    window.__fakeLoc = __fakeLoc;

    if (!isVidlink) {
      Object.defineProperty(window, "adce5c77-2808-4d01-877e-41167529529d", { value: false, writable: false, configurable: false });
      Object.defineProperty(window, "a3f1feb4-0b2d-4f69-a999-7116272dab1d", { value: false, writable: false, configurable: false });
    }
  } catch (e) {}

  try {
    if (typeof console !== "undefined") {
      var __origConsoleError = typeof console.error === "function" ? console.error.bind(console) : function() {};
      var __origConsoleWarn = typeof console.warn === "function" ? console.warn.bind(console) : function() {};

      var __shouldMuteLog = function(args) {
        if (!args || !args.length) return false;
        var str = "";
        try {
          for (var i = 0; i < args.length; i++) {
            var a = args[i];
            if (typeof a === "object" && a !== null) {
              str += " " + (a.message || a.stack || a.name || String(a));
            } else {
              str += " " + String(a || "");
            }
          }
        } catch (_e) {
          return false;
        }
        return (
          str.indexOf("SourceBufferSink") !== -1 ||
          str.indexOf("[SourceBufferSink]") !== -1 ||
          str.indexOf("SourceBuffer") !== -1 ||
          str.indexOf("This SourceBuffer has been removed") !== -1 ||
          str.indexOf("appendBuffer") !== -1 ||
          str.indexOf("getAllBufferRanges") !== -1 ||
          str.indexOf("Minified React error #418") !== -1 ||
          str.indexOf("Minified React error #423") !== -1 ||
          str.indexOf("reading 'unshift'") !== -1 ||
          str.indexOf("clarity.ms") !== -1 ||
          str.indexOf("clarity") !== -1 ||
          str.indexOf("Hydration failed") !== -1
        );
      };

      var __activeError = __origConsoleError;
      var __filteredError = function() {
        if (__shouldMuteLog(arguments)) return;
        return __activeError.apply(console, arguments);
      };

      var __activeWarn = __origConsoleWarn;
      var __filteredWarn = function() {
        if (__shouldMuteLog(arguments)) return;
        return __activeWarn.apply(console, arguments);
      };

      try {
        Object.defineProperty(console, "error", {
          configurable: true,
          enumerable: true,
          get: function() { return __filteredError; },
          set: function(fn) {
            if (typeof fn === "function" && fn !== __filteredError) {
              __activeError = fn;
            }
          }
        });
      } catch (_e) {
        console.error = __filteredError;
      }

      try {
        Object.defineProperty(console, "warn", {
          configurable: true,
          enumerable: true,
          get: function() { return __filteredWarn; },
          set: function(fn) {
            if (typeof fn === "function" && fn !== __filteredWarn) {
              __activeWarn = fn;
            }
          }
        });
      } catch (_e) {
        console.warn = __filteredWarn;
      }
    }
  } catch (_e) {}

  if (typeof window !== "undefined") {
    try {
      window.addEventListener("error", function(e) {
        try {
          var msg = (e && (e.message || (e.error && e.error.message))) || "";
          if (
            msg.indexOf("SourceBuffer") !== -1 ||
            msg.indexOf("SourceBufferSink") !== -1 ||
            msg.indexOf("Minified React error #418") !== -1 ||
            msg.indexOf("Minified React error #423") !== -1 ||
            msg.indexOf("reading 'unshift'") !== -1 ||
            msg.indexOf("clarity") !== -1 ||
            msg.indexOf("Hydration failed") !== -1
          ) {
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (e.stopPropagation) e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
            return true;
          }
        } catch (_err) {}
      }, true);

      window.addEventListener("unhandledrejection", function(e) {
        try {
          var reason = e && e.reason;
          var msg = (typeof reason === "object" && reason !== null ? (reason.message || reason.stack || String(reason)) : String(reason || ""));
          if (
            msg.indexOf("SourceBuffer") !== -1 ||
            msg.indexOf("SourceBufferSink") !== -1 ||
            msg.indexOf("Minified React error #418") !== -1 ||
            msg.indexOf("Minified React error #423") !== -1 ||
            msg.indexOf("reading 'unshift'") !== -1 ||
            msg.indexOf("clarity") !== -1 ||
            msg.indexOf("Hydration failed") !== -1
          ) {
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            if (e.preventDefault) e.preventDefault();
            return true;
          }
        } catch (_err) {}
      }, true);
    } catch (_e) {}
  }

  var fakeWin = {
    closed: false,
    focus: function() {},
    blur: function() {},
    close: function() { this.closed = true; },
    postMessage: function() {},
    location: { href: "about:blank", assign: function(){}, replace: function(){} },
    document: { write: function(){}, open: function(){}, close: function(){} }
  };
  window.open = function(url) {
    try { window.parent.postMessage({ type: "AD_SHIELD_EVENT", action: "blocked_popup", url: String(url || "") }, "*"); } catch (e) {}
    return fakeWin;
  };

  window.dataLayer = window.dataLayer || [];
  if (typeof window.dataLayer.unshift !== "function") {
    window.dataLayer.unshift = Array.prototype.unshift.bind(window.dataLayer);
  }
  if (typeof window.dataLayer.push !== "function") {
    window.dataLayer.push = Array.prototype.push.bind(window.dataLayer);
  }
  window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
  var __clarityQueue = [];
  var __clarityStub = function() {
    __clarityQueue.push(arguments);
  };
  __clarityStub.q = __clarityQueue;
  __clarityStub.v = __clarityQueue;
  window.clarity = __clarityStub;
  window.ym = window.ym || function() {};

  function isBlockedUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /googletagmanager|google-analytics|cloudflareinsights|doubleclick|popads|propeller|adnetwork|yandex|clarity\\.ms|nske6pmog4/i.test(url);
  }

  var SAFE_ASSET_RE = /(cdn\\.(jsdelivr\\.net|jwplayer\\.com)|ssl\\.p\\.jwpcdn\\.com|cdnjs\\.cloudflare\\.com|wsrv\\.nl|image\\.tmdb\\.org|fonts\\.(googleapis|gstatic)\\.com|raw\\.githubusercontent\\.com)/i;
  var STREAM_EXT_RE = /\\.(m3u8|mpd|m4s|ts|mp4|m4a|m4v|aac|key)(\\?|$|#)/i;
  var STREAM_HOST_RE = /(steelpeak|vd\\b|\\.vd\\b|vd-|\\/vd\\/|hls|flooderrr\\.store|hakunaymatata\\.com|sacdn|\\/sacdn\\/|\\/dash\\/|\\/proxy\\/|\\/mp\\/|orbitcache|premilkyway|sunnybreeze|frostywinds|cloudnestra|shadowlands|trueparadise|goldenkite|wisecanvas|streamhi|streamcdn|vidsrc|vidstream|topcdn|vidplay|megafiles|megacloud)/i;

  function resolveVidlinkStreamUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== "string") return null;
    var rawUrl = inputUrl.trim();
    if (!rawUrl || /^(blob:|data:|javascript:|about:|ws:|wss:)/i.test(rawUrl)) return null;
    if (SAFE_ASSET_RE.test(rawUrl)) return null;
    if (rawUrl.indexOf(CF_WORKER + "/?") === 0 || rawUrl.indexOf(CF_WORKER + "?") === 0 || rawUrl.indexOf("/stream-proxy/") !== -1) return null;

    var locOrigin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";

    if (rawUrl.indexOf("APA91") !== -1) {
      var apaClean = rawUrl;
      if (apaClean.indexOf("http://") === 0 || apaClean.indexOf("https://") === 0) {
        try {
          var parsedApa = new URL(apaClean);
          apaClean = parsedApa.pathname + (parsedApa.search || "");
        } catch (_e) {
          var slashIdx = apaClean.indexOf("/", 8);
          apaClean = slashIdx !== -1 ? apaClean.slice(slashIdx) : apaClean;
        }
      } else {
        try {
          var parsedRel = new URL(apaClean, locOrigin || "http://localhost");
          apaClean = parsedRel.pathname + (parsedRel.search || "");
        } catch (_e) {}
      }
      while (apaClean.charAt(0) === "/") {
        apaClean = apaClean.slice(1);
      }
      if (apaClean.indexOf("vidcore/") !== 0) {
        apaClean = "vidcore/" + apaClean;
      }
      var proxiedApa = locOrigin ? (locOrigin + "/" + apaClean) : ("/" + apaClean);
      return {
        originalUrl: rawUrl,
        proxiedUrl: proxiedApa
      };
    }

    var isVidcore = false;
    var isVidlink = false;
    try {
      if (typeof window !== "undefined" && window.location) {
        var h = String(window.location.href || "");
        if (h.indexOf("/vidcore/") !== -1 || (window.location.hostname && window.location.hostname.indexOf("vidcore") !== -1)) {
          isVidcore = true;
        }
        if (h.indexOf("/vidlink/") !== -1 || (window.location.hostname && window.location.hostname.indexOf("vidlink") !== -1)) {
          isVidlink = true;
        }
      }
    } catch (_e) {}

    if (rawUrl.indexOf("vidlink.pro/api/") !== -1) {
      var apiPart = rawUrl.slice(rawUrl.indexOf("vidlink.pro/api/") + "vidlink.pro".length);
      return {
        originalUrl: rawUrl,
        proxiedUrl: locOrigin ? (locOrigin + "/vidlink" + apiPart) : ("/vidlink" + apiPart)
      };
    }
    if (rawUrl.indexOf("vidlink.pro/_next/") !== -1) {
      var nextPart = rawUrl.slice(rawUrl.indexOf("vidlink.pro/_next/") + "vidlink.pro".length);
      return {
        originalUrl: rawUrl,
        proxiedUrl: locOrigin ? (locOrigin + "/vidlink" + nextPart) : ("/vidlink" + nextPart)
      };
    }
    if (rawUrl.indexOf("https://vidlink.pro/") === 0 || rawUrl.indexOf("http://vidlink.pro/") === 0 || rawUrl.indexOf("//vidlink.pro/") === 0) {
      var relVidlink = rawUrl.replace(/^(?:https?:)?\\/\\/vidlink\\.pro/i, "");
      if (STREAM_EXT_RE.test(relVidlink) || STREAM_HOST_RE.test(relVidlink)) {
        var fullStream = rawUrl.indexOf("//") === 0 ? ("https:" + rawUrl) : rawUrl;
        return {
          originalUrl: rawUrl,
          proxiedUrl: CF_WORKER + "/stream-proxy/ref/" + encodeURIComponent(fullStream) + "?ref=vidlink"
        };
      }
      return {
        originalUrl: rawUrl,
        proxiedUrl: locOrigin ? (locOrigin + "/vidlink" + relVidlink) : ("/vidlink" + relVidlink)
      };
    }

    if (isVidlink) {
      if (rawUrl.indexOf("/_next/") === 0 || rawUrl.indexOf("_next/") === 0) {
        var cleanNext = rawUrl.indexOf("/_next/") === 0 ? rawUrl : ("/" + rawUrl);
        return {
          originalUrl: rawUrl,
          proxiedUrl: locOrigin ? (locOrigin + "/vidlink" + cleanNext) : ("/vidlink" + cleanNext)
        };
      }
      if (
        (rawUrl.indexOf("/api/") === 0 || rawUrl.indexOf("api/") === 0) &&
        rawUrl.indexOf("/api/subtitles") !== 0 &&
        rawUrl.indexOf("/api/tmdb") !== 0 &&
        rawUrl.indexOf("/api/football") !== 0 &&
        rawUrl.indexOf("/api/hls") !== 0
      ) {
        var cleanApi = rawUrl.indexOf("/api/") === 0 ? rawUrl : ("/" + rawUrl);
        return {
          originalUrl: rawUrl,
          proxiedUrl: locOrigin ? (locOrigin + "/vidlink" + cleanApi) : ("/vidlink" + cleanApi)
        };
      }
      if (locOrigin && rawUrl.indexOf(locOrigin + "/_next/") === 0) {
        var relNext = rawUrl.slice(locOrigin.length);
        return {
          originalUrl: rawUrl,
          proxiedUrl: locOrigin + "/vidlink" + relNext
        };
      }
      if (
        locOrigin &&
        rawUrl.indexOf(locOrigin + "/api/") === 0 &&
        rawUrl.indexOf(locOrigin + "/api/subtitles") !== 0 &&
        rawUrl.indexOf(locOrigin + "/api/tmdb") !== 0 &&
        rawUrl.indexOf(locOrigin + "/api/football") !== 0 &&
        rawUrl.indexOf(locOrigin + "/api/hls") !== 0
      ) {
        var relApi = rawUrl.slice(locOrigin.length);
        return {
          originalUrl: rawUrl,
          proxiedUrl: locOrigin + "/vidlink" + relApi
        };
      }
    }

    if (rawUrl.indexOf("/sacdn/") === 0 || rawUrl.indexOf("/dash/") === 0 || rawUrl.indexOf("/proxy/") === 0 || rawUrl.indexOf("/mp/") === 0) {
      rawUrl = (lastMpdOrigin || "https://surge.flooderrr.store") + rawUrl;
    } else if (rawUrl.indexOf(CF_WORKER + "/") === 0) {
      var workerRel = rawUrl.slice(CF_WORKER.length);
      if (workerRel.indexOf("/sacdn/") === 0 || workerRel.indexOf("/dash/") === 0 || workerRel.indexOf("/proxy/") === 0 || workerRel.indexOf("/mp/") === 0) {
        rawUrl = (lastMpdOrigin || "https://surge.flooderrr.store") + workerRel;
      } else if (STREAM_EXT_RE.test(workerRel) && lastMpdBaseDir) {
        rawUrl = lastMpdBaseDir + workerRel.replace(/^\\/+/, "");
      }
    } else if (locOrigin && rawUrl.indexOf(locOrigin + "/") === 0) {
      var pageRel = rawUrl.slice(locOrigin.length);
      if (pageRel.indexOf("/sacdn/") === 0 || pageRel.indexOf("/dash/") === 0 || pageRel.indexOf("/proxy/") === 0 || pageRel.indexOf("/mp/") === 0) {
        rawUrl = (lastMpdOrigin || "https://surge.flooderrr.store") + pageRel;
      } else if (/\\.(m4s|mpd)(\\?|$)/i.test(pageRel) && lastMpdBaseDir) {
        rawUrl = lastMpdBaseDir + pageRel.replace(/^\\/+/, "");
      } else {
        return null;
      }
    } else if (!/^https?:\\/\\//i.test(rawUrl)) {
      if (rawUrl.indexOf("//") === 0) {
        rawUrl = "https:" + rawUrl;
      } else if (rawUrl.indexOf(".m3u8") !== -1 || STREAM_HOST_RE.test(rawUrl)) {
        if (lastMpdBaseDir) rawUrl = lastMpdBaseDir + rawUrl.replace(/^\\.?\\//, "");
        else if (lastMpdOrigin) rawUrl = lastMpdOrigin + (rawUrl.indexOf("/") === 0 ? rawUrl : ("/" + rawUrl));
        else rawUrl = "https://vidcore.io" + (rawUrl.indexOf("/") === 0 ? rawUrl : ("/" + rawUrl));
      } else if (/\\.(m4s|mpd)(\\?|$)/i.test(rawUrl) && lastMpdBaseDir) {
        rawUrl = lastMpdBaseDir + rawUrl.replace(/^\\.?\\//, "");
      } else {
        return null;
      }
    }

    if (!/^https?:\\/\\//i.test(rawUrl)) return null;
    if (SAFE_ASSET_RE.test(rawUrl) || isBlockedUrl(rawUrl)) return null;
    var isStream = rawUrl.indexOf(".m3u8") !== -1 || STREAM_EXT_RE.test(rawUrl) || STREAM_HOST_RE.test(rawUrl);
    if (!isStream) return null;

    try {
      var parsed = new URL(rawUrl, locOrigin || "http://localhost");
      if (/\\.mpd(\\?|$)/i.test(parsed.pathname)) {
        lastMpdOrigin = parsed.origin;
        var lastSlash = parsed.pathname.lastIndexOf("/");
        lastMpdBaseDir = parsed.origin + (lastSlash >= 0 ? parsed.pathname.slice(0, lastSlash + 1) : "/");
        lastMpdQuery = parsed.search ? parsed.search.slice(1) : "";
      } else if (/\\.(m4s|mp4|m4a|m4v)(\\?|$)/i.test(parsed.pathname) && !parsed.search && lastMpdQuery && parsed.origin === lastMpdOrigin) {
        rawUrl = rawUrl + "?" + lastMpdQuery;
      }
    } catch (_e) {}

    var proxiedUrl = "";
    if (isVidcore) {
      proxiedUrl = CF_WORKER + "/stream-proxy/ref/" + encodeURIComponent(rawUrl);
    } else {
      proxiedUrl = CF_WORKER + "/stream-proxy/ref/" + encodeURIComponent(rawUrl) + "?ref=vidlink";
    }

    return {
      originalUrl: rawUrl,
      proxiedUrl: proxiedUrl
    };
  }

  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        var reqUrl = "";
        if (typeof input === "string") reqUrl = input;
        else if (typeof URL !== "undefined" && input instanceof URL) reqUrl = input.toString();
        else if (input && typeof input === "object" && typeof input.url === "string") reqUrl = input.url;
        if (isBlockedUrl(reqUrl)) {
          return Promise.resolve(new Response("", { status: 200 }));
        }
        var rw = resolveVidlinkStreamUrl(reqUrl);
        if (rw) {
          var newInput = rw.proxiedUrl;
          if (typeof Request !== "undefined" && input instanceof Request) {
            try { newInput = new Request(rw.proxiedUrl, input); } catch (_re) { newInput = rw.proxiedUrl; }
          }
          return origFetch.call(this, newInput, init).then(function(res) {
            try { Object.defineProperty(res, "url", { get: function() { return rw.originalUrl; }, configurable: true }); } catch (_e) {}
            return res;
          });
        }
      } catch (_err) {}
      return origFetch.apply(this, arguments);
    };
  }

  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        var urlStr = (typeof URL !== "undefined" && url instanceof URL) ? url.toString() : String(url || "");
        var rw = resolveVidlinkStreamUrl(urlStr);
        if (rw) {
          try { Object.defineProperty(this, "responseURL", { get: function() { return rw.originalUrl; }, configurable: true }); } catch (_e) {}
          var args = Array.prototype.slice.call(arguments);
          args[1] = rw.proxiedUrl;
          return origXhrOpen.apply(this, args);
        }
      } catch (_err) {}
      return origXhrOpen.apply(this, arguments);
    };
  }

  try {
    if (typeof HTMLMediaElement !== "undefined" && HTMLMediaElement.prototype) {
      var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      if (srcDesc && srcDesc.set && srcDesc.get) {
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          configurable: true, enumerable: srcDesc.enumerable,
          get: function() { return srcDesc.get.call(this); },
          set: function(val) {
            var rw = resolveVidlinkStreamUrl(String(val || ""));
            return srcDesc.set.call(this, rw ? rw.proxiedUrl : val);
          }
        });
      }
    }
  } catch (_e) {}

  try {
    if (typeof HTMLScriptElement !== "undefined" && HTMLScriptElement.prototype) {
      var scriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
      if (scriptSrcDesc && scriptSrcDesc.set && scriptSrcDesc.get) {
        Object.defineProperty(HTMLScriptElement.prototype, "src", {
          configurable: true,
          enumerable: scriptSrcDesc.enumerable,
          get: function() { return scriptSrcDesc.get.call(this); },
          set: function(val) {
            var raw = String(val || "");
            if (isBlockedUrl(raw)) {
              return scriptSrcDesc.set.call(this, "data:application/javascript,//");
            }
            if (isVidlink) {
              if (raw.indexOf("/_next/") === 0 || raw.indexOf("_next/") === 0) {
                var cleanRel = raw.slice(raw.indexOf("_next/") + 6);
                var newSrc = locOrigin ? (locOrigin + "/vidlink/_next/" + cleanRel) : ("/vidlink/_next/" + cleanRel);
                return scriptSrcDesc.set.call(this, newSrc);
              }
              if (raw.indexOf("vidlink.pro/_next/") !== -1) {
                var rel = raw.slice(raw.indexOf("vidlink.pro/_next/") + "vidlink.pro".length);
                var newSrc2 = locOrigin ? (locOrigin + "/vidlink" + rel) : ("/vidlink" + rel);
                return scriptSrcDesc.set.call(this, newSrc2);
              }
            } else if (isVidcore) {
              if (raw.indexOf("/_next/static/") === 0 || raw.indexOf("_next/static/") === 0) {
                var cleanRel2 = raw.slice(raw.indexOf("_next/static/") + 13);
                var qIdx = cleanRel2.indexOf("?");
                var baseClean = qIdx !== -1 ? cleanRel2.slice(0, qIdx) : cleanRel2;
                var newSrc3 = (locOrigin ? (locOrigin + "/vidcore/_next/static/") : ("/vidcore/_next/static/")) + baseClean + "?v=6";
                return scriptSrcDesc.set.call(this, newSrc3);
              }
            }
            return scriptSrcDesc.set.call(this, val);
          }
        });
      }
    }
  } catch (_e) {}

  function cleanInvalidPreloads() {
    try {
      var safeDataUri = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      var links = document.querySelectorAll('link[rel="preload"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute("href");
        if (!href || !href.trim() || href === "null" || href === "undefined" || isBlockedUrl(href)) {
          links[i].setAttribute("href", safeDataUri);
        }
      }
    } catch (_e) {}
  }
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", cleanInvalidPreloads);
  } else if (typeof setTimeout === "function") {
    setTimeout(cleanInvalidPreloads, 500);
  }

  try {
    if (typeof document !== "undefined" && document.head && !document.getElementById("hwto-sub-fix")) {
      var subtitleCss = '[class*="captions"],.vds-captions,[data-part="cue"],[data-part="cue-display"],span[style*="text-shadow"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}';
      var st = document.createElement("style");
      st.id = "hwto-sub-fix";
      st.textContent = subtitleCss;
      document.head.appendChild(st);
    }
  } catch (_e) {}

  try { window.parent.postMessage({ type: "AD_SHIELD_READY", status: "active", timestamp: Date.now() }, "*"); } catch (e) {}
})();`;

function sanitizePreloadLinks(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/<link\b[^>]*\brel=["']?preload["']?[^>]*>/gi, (tag) => {
    if (/href=["']\s*["']/i.test(tag)) return "";
    if (/yandex|analytics|googletagmanager|doubleclick/i.test(tag)) return "";
    return tag;
  });
}

function rewriteVidcoreStaticLinks(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(
    /(href|src)=["'](?:\/vidcore)?\/_next\/static\/([^"']+)["']/g,
    (match, attr, relPath) => {
      const cleanPath = relPath.replace(/[?&]v=[^&"']+/g, "");
      const separator = cleanPath.includes("?") ? "&" : "?";
      return `${attr}="/vidcore/_next/static/${cleanPath}${separator}v=6"`;
    }
  );
}

function rewriteVidlinkPaths(html) {
  if (!html || typeof html !== "string") return html;
  let out = html;
  out = out.replace(/https?:\/\/vidlink\.pro\/_next\//g, "/vidlink/_next/");
  out = out.replace(
    /https?:\/\/vidlink\.pro\/api\/(?!subtitles|tmdb|football|hls)/g,
    "/vidlink/api/"
  );

  out = out.replace(
    /(href|src)=["'](?:\/vidlink)?\/_next\/([^"']+)["']/g,
    '$1="/vidlink/_next/$2"'
  );
  out = out.replace(/(["'\\])\/_next\//g, "$1/vidlink/_next/");
  out = out.replace(/\/vidlink\/vidlink\//g, "/vidlink/");

  out = out.replace(
    /(href|src)=["'](?:\/vidlink)?\/api\/(?!subtitles|tmdb|football|hls)([^"']+)["']/g,
    '$1="/vidlink/api/$2"'
  );
  out = out.replace(/(["'\\])\/api\/(?!subtitles|tmdb|football|hls)/g, "$1/vidlink/api/");
  out = out.replace(/\/vidlink\/vidlink\//g, "/vidlink/");
  return out;
}

const { UNIVERSAL_SUBTITLE_INJECTOR_JS } = require("./subtitles.js");

const SOURCE_BUFFER_MUTE_JS = `(function() {
  if (typeof console === "undefined") return;

  var _origErr = typeof console.error === "function" ? console.error.bind(console) : function() {};
  var _origWarn = typeof console.warn === "function" ? console.warn.bind(console) : function() {};

  function shouldMute(args) {
    if (!args || !args.length) return false;
    var str = "";
    try {
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (typeof a === "object" && a !== null) {
          str += " " + (a.message || a.stack || a.name || String(a));
        } else {
          str += " " + String(a || "");
        }
      }
    } catch (_e) {
      return false;
    }
    return (
      str.indexOf("SourceBufferSink") !== -1 ||
      str.indexOf("[SourceBufferSink]") !== -1 ||
      str.indexOf("SourceBuffer") !== -1 ||
      str.indexOf("This SourceBuffer has been removed") !== -1 ||
      str.indexOf("appendBuffer") !== -1 ||
      str.indexOf("getAllBufferRanges") !== -1 ||
      str.indexOf("Minified React error #418") !== -1 ||
      str.indexOf("Minified React error #423") !== -1 ||
      str.indexOf("reading 'unshift'") !== -1 ||
      str.indexOf("clarity") !== -1 ||
      str.indexOf("Hydration failed") !== -1
    );
  }

  var _activeErr = _origErr;
  function filteredError() {
    if (shouldMute(arguments)) return;
    return _activeErr.apply(console, arguments);
  }

  var _activeWarn = _origWarn;
  function filteredWarn() {
    if (shouldMute(arguments)) return;
    return _activeWarn.apply(console, arguments);
  }

  try {
    Object.defineProperty(console, "error", {
      configurable: true,
      enumerable: true,
      get: function() { return filteredError; },
      set: function(fn) {
        if (typeof fn === "function" && fn !== filteredError) {
          _activeErr = fn;
        }
      }
    });
  } catch (_e) {
    console.error = filteredError;
  }

  try {
    Object.defineProperty(console, "warn", {
      configurable: true,
      enumerable: true,
      get: function() { return filteredWarn; },
      set: function(fn) {
        if (typeof fn === "function" && fn !== filteredWarn) {
          _activeWarn = fn;
        }
      }
    });
  } catch (_e) {
    console.warn = filteredWarn;
  }
})();`;

function injectStrictlyIntoHead(htmlStr, injectContent) {
  if (!htmlStr || typeof htmlStr !== "string") return htmlStr;
  if (htmlStr.includes("</head>")) {
    return htmlStr.replace("</head>", () => injectContent + "</head>");
  }
  if (/<head\b[^>]*>/i.test(htmlStr)) {
    return htmlStr.replace(/(<head\b[^>]*>)/i, (m, g1) => g1 + injectContent);
  }
  return "<head>" + injectContent + "</head>" + htmlStr;
}

function sanitizeVidlinkHtml(html) {
  let out = html;
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*\/>/gi, "");
  out = out.replace(/<script\b[^>]*clarity\.ms[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*clarity\.ms[^>]*\/>/gi, "");
  out = out.replace(
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi,
    "/gtag-shield.js?v=7"
  );

  out = out.replace(/\\"limitAds\\":false/g, '\\"limitAds\\":true');
  out = out.replace(/"limitAds":false/g, '"limitAds":true');
  out = out.replace(
    /\\"referer\\":(null|\\"[^\\"]*\\")/g,
    '\\"referer\\":\\"https://vidlink.pro/\\"'
  );

  out = sanitizePreloadLinks(out);
  out = rewriteVidlinkPaths(out);

  const headInject = `
<script id="hwto-vidlink-sourcebuffer-mute">${SOURCE_BUFFER_MUTE_JS}</script>
<link rel="preconnect" href="${CF_WORKER_URL}" crossorigin />
<link rel="dns-prefetch" href="${CF_WORKER_URL}" />
<style id="hwto-sub-fix">[class*="captions"],.vds-captions,[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>
<script id="hwto-vidlink-interceptor" src="/gtag-shield.js?v=7"></script>
<script id="hwto-universal-subs-src" src="/hwto-subtitles.js"></script>
<script id="hwto-universal-subs">${UNIVERSAL_SUBTITLE_INJECTOR_JS}</script>
`;
  return injectStrictlyIntoHead(out, headInject);
}

function sanitizeVidcoreHtml(html) {
  let out = html;
  out = out.replace(/\\"ad\\":true/g, '\\"ad\\":false');
  out = out.replace(/"ad":true/g, '"ad":false');
  out = out.replace(
    /\\"from\\":(null|\\"(?!https:\/\/vidcore\.io)[^\\]*\\")/g,
    '\\"from\\":\\"https://vidcore.io\\"'
  );
  out = out.replace(/\\"from\\":\\"https:\/\/vidcore\.io\/\\"/g, '\\"from\\":\\"https://vidcore.io\\"');
  out = out.replace(
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi,
    "/gtag-shield.js?v=7"
  );
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*\/>/gi, "");
  out = out.replace(/<script\b[^>]*clarity\.ms[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*clarity\.ms[^>]*\/>/gi, "");

  out = sanitizePreloadLinks(out);
  out = rewriteVidcoreStaticLinks(out);

  const headInject = `
<script id="hwto-vidcore-sourcebuffer-mute">${SOURCE_BUFFER_MUTE_JS}</script>
<link rel="preconnect" href="${CF_WORKER_URL}" crossorigin />
<link rel="dns-prefetch" href="${CF_WORKER_URL}" />
<style id="hwto-sub-fix">span[style*="text-shadow"],[class*="captions"],[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>
<script id="hwto-vidcore-interceptor" src="/gtag-shield.js?v=7"></script>
<script id="hwto-universal-subs-src" src="/hwto-subtitles.js"></script>
<script id="hwto-universal-subs">${UNIVERSAL_SUBTITLE_INJECTOR_JS}</script>
`;
  return injectStrictlyIntoHead(out, headInject);
}

function patchPlayerChunk(jsCode) {
  return jsCode;
}

const staticChunkCache = new Map();
const vidcoreHtmlCache = new Map();
const HTML_CACHE_TTL = 20 * 60 * 1000;
const CHUNK_CACHE_CONTROL = "public, max-age=31536000, immutable";
const HTML_CACHE_CONTROL = "public, max-age=1200, s-maxage=1200, stale-while-revalidate=86400";

function fetchWithTimeoutSignal(url, options = {}, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

function getCleanUserAgent(rawUa) {
  if (!rawUa || /node|curl|python|axios|undici/i.test(rawUa)) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return rawUa;
}

async function fetchViaCfWorker(targetUrl, method, headers, bodyBuffer, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(targetUrl, {
      method,
      headers,
      body: method === "POST" && bodyBuffer && bodyBuffer.length > 0 ? bodyBuffer : undefined,
      signal: controller.signal,
    });
    return res || null;
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromUpstream(
  origin,
  targetPathAndQuery,
  req,
  bodyBuffer,
  useScrapeDoFallback = true
) {
  const targetUrl = origin + targetPathAndQuery;
  const method = req.method || "GET";

  const isDecryptionRoute = targetPathAndQuery.startsWith("/APA91") || targetPathAndQuery.includes("APA91");
  const sessionId = getScrapeDoSessionId(req, targetPathAndQuery);
  const hasScrapeTokens = getScrapeDoTokens().length > 0;

  const forwardHeaders = {
    "User-Agent": getCleanUserAgent(req.headers["user-agent"]),
    Accept: req.headers["accept"] || "*/*",
    "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9,ar;q=0.8",
    Referer: `${origin}/`,
    Origin: origin,
  };

  const optionalHeaders = [
    "x-csrf-token",
    "content-type",
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-url",
  ];
  for (const h of optionalHeaders) {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  }

  if (method === "POST" || isDecryptionRoute) {
    forwardHeaders["Referer"] = `${VIDCORE_ORIGIN}/`;
    forwardHeaders["Origin"] = VIDCORE_ORIGIN;
    if (req.headers["content-type"] || req.headers["Content-Type"]) {
      forwardHeaders["Content-Type"] = req.headers["content-type"] || req.headers["Content-Type"];
    } else {
      forwardHeaders["Content-Type"] = "application/octet-stream";
    }
  }

  delete forwardHeaders["content-length"];
  delete forwardHeaders["Content-Length"];
  delete forwardHeaders["connection"];
  delete forwardHeaders["Connection"];

  // 0. FOR APA91 DECRYPTION & POST REQUESTS: TRY THE CLOUDFLARE WORKER FIRST TO AVOID 555
  if ((isDecryptionRoute || method === "POST") && config.mode !== "scrapedo") {
    try {
      const workerTargetUrl = `${CF_WORKER_URL}/stream-proxy/ref/${encodeURIComponent(targetUrl)}`;
      const workerRes = await fetchViaCfWorker(
        workerTargetUrl,
        method,
        forwardHeaders,
        method === "POST" ? bodyBuffer : undefined,
        8000
      );
      if (workerRes && workerRes.status < 500) {
        return workerRes;
      }
    } catch (_e) {}
  }

  // 1. FOR APA91 DECRYPTION & POST REQUESTS: USE SCRAPE.DO
  if ((isDecryptionRoute || method === "POST") && hasScrapeTokens && config.mode !== "direct") {
    try {
      const scrapeRes = await fetchViaScrapeDoWithRotation(targetUrl, fetch, {
        method,
        headers: forwardHeaders,
        sessionId,
        body: method === "POST" ? bodyBuffer : undefined,
      });
      if (scrapeRes && scrapeRes.status < 500) {
        return scrapeRes;
      }
    } catch (_err) {}
  }

  // 2. Direct fetch for static assets and other standard GET routes
  try {
    const directRes = await fetchWithTimeoutSignal(targetUrl, { method, headers: forwardHeaders }, 6000);
    const status = directRes?.status;
    if (directRes && status >= 200 && status < 400 && status !== 555) {
      return directRes;
    }
  } catch (_err) {}

  // 3. Fallback to Scrape.do for anything else
  if (useScrapeDoFallback && config.mode !== "direct" && hasScrapeTokens) {
    try {
      const scrapeRes = await fetchViaScrapeDoWithRotation(targetUrl, fetch, {
        method,
        headers: forwardHeaders,
        sessionId,
        body: method === "POST" ? bodyBuffer : undefined,
      });
      if (scrapeRes && scrapeRes.status < 500) {
        return scrapeRes;
      }
    } catch (_err) {}
  }

  return await fetch(targetUrl, {
    method,
    headers: forwardHeaders,
    body: method === "POST" ? bodyBuffer : undefined,
  });
}

function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(null);
  if (req.rawBody && Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  if (req.rawBody && typeof req.rawBody === "string") return Promise.resolve(Buffer.from(req.rawBody));
  if (req.body && Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.body && typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  }
  if (req.readableEnded) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleVidcoreProxy(req, res) {
  try {
    const host = req.headers.host || "localhost:3000";
    const parsedUrl = new URL(req.url || "/", `http://${host}`);
    let pathname = parsedUrl.pathname;

    const origPathParam =
      parsedUrl.searchParams.get("__orig_path") ||
      (req.query && req.query.__orig_path);

    parsedUrl.searchParams.delete("__orig_path");
    if (req.query && req.query.__orig_path) {
      delete req.query.__orig_path;
    }

    if (
      origPathParam &&
      typeof origPathParam === "string" &&
      !origPathParam.includes(":path*")
    ) {
      try {
        const matchedParsed = new URL(
          origPathParam.startsWith("/") ? origPathParam : `/${origPathParam}`,
          `http://${host}`
        );
        pathname = matchedParsed.pathname;
        for (const [k, v] of matchedParsed.searchParams.entries()) {
          if (k !== "__orig_path" && !parsedUrl.searchParams.has(k)) {
            parsedUrl.searchParams.set(k, v);
          }
        }
      } catch (_e) {
        pathname = origPathParam.split("?")[0];
      }
    } else if (pathname === "/api/vidcore" || pathname === "/api/vidcore/") {
      const headerPath =
        req.headers && (req.headers["x-invoke-path"] || req.headers["x-matched-path"]);
      if (
        headerPath &&
        typeof headerPath === "string" &&
        !headerPath.includes(":path*") &&
        !headerPath.includes("(.*)") &&
        headerPath !== "/api/vidcore"
      ) {
        pathname = headerPath.split("?")[0];
      }
    }

    const search = parsedUrl.search || "";
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    if (pathname === "/gtag-shield.js" || pathname.startsWith("/gtag-shield")) {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(AD_SHIELD_JS, "utf8");
    }

    if (pathname === "/hwto-subtitles.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(UNIVERSAL_SUBTITLE_INJECTOR_JS, "utf8");
    }

    if (pathname.startsWith("/stream-proxy/ref/")) {
      let rawTarget = pathname.slice("/stream-proxy/ref/".length) + search;
      if (rawTarget.startsWith("https/")) {
        rawTarget = "https://" + rawTarget.slice(6);
      } else if (rawTarget.startsWith("http/")) {
        rawTarget = "http://" + rawTarget.slice(5);
      } else if (!rawTarget.startsWith("http://") && !rawTarget.startsWith("https://")) {
        try {
          const dec = decodeURIComponent(rawTarget);
          if (dec.startsWith("http")) rawTarget = dec;
        } catch (_e) {}
      }
      const redirectUrl = `${CF_WORKER_URL}/stream-proxy/ref/${encodeURIComponent(rawTarget)}`;
      res.writeHead(302, {
        Location: redirectUrl,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (pathname.startsWith("/stream-proxy/")) {
      const m = pathname.match(/^\/stream-proxy\/(ref|noref)\/(https?)\/([^/]+)(\/.*)?$/);
      let workerTarget;
      if (m) {
        const refMode = m[1];
        const scheme = m[2];
        const upHost = m[3];
        const restPath = m[4] || "/";
        const rawStreamUrl = `${scheme}://${upHost}${restPath}${search}`;
        workerTarget = `${CF_WORKER_URL}/stream-proxy/${refMode}/${encodeURIComponent(rawStreamUrl)}`;
      } else {
        workerTarget = `${CF_WORKER_URL}${pathname}${search}`;
      }
      res.writeHead(302, {
        Location: workerTarget,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end();
    }

    if (pathname.startsWith("/embed/")) {
      const cleanTarget = pathname.replace(/^\/embed/, "") + search;
      res.writeHead(302, { Location: cleanTarget });
      return res.end();
    }

    const incomingRef = String(req.headers["referer"] || "");
    if (
      pathname.startsWith("/vidlink/") ||
      (incomingRef.includes("/vidlink/") && !pathname.startsWith("/vidcore/"))
    ) {
      const handleVidlinkProxy = require("./vidlink.js").handleVidlinkProxy;
      return handleVidlinkProxy(req, res);
    }

    if (pathname.startsWith("/subtitles/") || pathname === "/api/subtitles") {
      const subtitlesHandler = require("./subtitles.js");
      return subtitlesHandler(req, res);
    }

    let origin = VIDCORE_ORIGIN;
    let targetPath = pathname;

    if (pathname.startsWith("/vidcore/")) {
      origin = VIDCORE_ORIGIN;
      targetPath = pathname.slice("/vidcore".length) || "/";
    }

    const isHtmlRoute =
      targetPath.startsWith("/movie/") ||
      targetPath.startsWith("/tv/") ||
      targetPath.startsWith("/embed/") ||
      (req.headers?.accept && req.headers.accept.includes("text/html"));

    if (isHtmlRoute && req.method === "GET") {
      const cacheKey = targetPath + search;
      if (vidcoreHtmlCache.has(cacheKey)) {
        const entry = vidcoreHtmlCache.get(cacheKey);
        if (Date.now() - entry.timestamp < HTML_CACHE_TTL) {
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": HTML_CACHE_CONTROL,
            "Access-Control-Allow-Origin": "*",
            "X-Vidcore-Cache": "HIT",
            "X-AdShield": "Active",
          });
          return res.end(entry.html, "utf8");
        }
        vidcoreHtmlCache.delete(cacheKey);
      }
    }

    const isChunkStaticPath =
      targetPath.startsWith("/_next/static/") || pathname.startsWith("/_next/static/");

    if (isChunkStaticPath && req.method === "GET") {
      const cacheKey = targetPath.startsWith("/_next/static/") ? targetPath : pathname;
      if (staticChunkCache.has(cacheKey)) {
        const cached = staticChunkCache.get(cacheKey);
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": CHUNK_CACHE_CONTROL,
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(cached.body);
      }
    }

    const bodyBuffer = await readRequestBody(req);
    const upstreamRes = await fetchFromUpstream(
      origin,
      targetPath + search,
      req,
      bodyBuffer,
      true
    );

    const contentType =
      upstreamRes.headers.get("content-type") || "application/octet-stream";

    const responseHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "X-AdShield": "Active",
    };

    const setCookie = upstreamRes.headers.get("set-cookie");
    if (setCookie) responseHeaders["Set-Cookie"] = setCookie;

    if (isHtmlRoute) {
      const isFromVidlink = origin === VIDLINK_ORIGIN;
      const rawText = await upstreamRes.text();
      const cleaned = isFromVidlink
        ? sanitizeVidlinkHtml(rawText)
        : sanitizeVidcoreHtml(rawText);
      responseHeaders["Cache-Control"] = HTML_CACHE_CONTROL;
      if (upstreamRes.status === 200) {
        vidcoreHtmlCache.set(targetPath + search, {
          html: cleaned,
          timestamp: Date.now(),
        });
      }
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(cleaned, "utf8");
    }

    const isChunkRoute =
      isChunkStaticPath ||
      (contentType.includes("javascript") &&
        (pathname.includes("/_next/") || targetPath.includes("/_next/")));

    if (isChunkRoute) {
      const rawJs = await upstreamRes.text();
      const patchedJs = patchPlayerChunk(rawJs, targetPath);
      responseHeaders["Cache-Control"] = CHUNK_CACHE_CONTROL;
      const cacheKey = targetPath.startsWith("/_next/static/") ? targetPath : pathname;
      staticChunkCache.set(cacheKey, {
        body: patchedJs,
        contentType: "application/javascript; charset=utf-8",
      });
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(patchedJs, "utf8");
    }

    const isMediaSegment =
      /\.(ts|m4s|mp4|m4a|m4v)(\?|$)/i.test(targetPath) ||
      /\.(ts|m4s|mp4|m4a|m4v)(\?|$)/i.test(pathname) ||
      contentType.includes("video/");

    if (isMediaSegment) {
      responseHeaders["Cache-Control"] = "public, max-age=3600";
    }

    if (
      isMediaSegment &&
      upstreamRes.body &&
      typeof Readable.fromWeb === "function" &&
      req.method !== "HEAD"
    ) {
      res.writeHead(upstreamRes.status, responseHeaders);
      return Readable.fromWeb(upstreamRes.body).pipe(res);
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.writeHead(upstreamRes.status, responseHeaders);
    return res.end(buffer);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
}

const vercelConfig = { api: { bodyParser: false } };

module.exports = handleVidcoreProxy;
module.exports.default = handleVidcoreProxy;
module.exports.config = vercelConfig;
module.exports.handleVidcoreProxy = handleVidcoreProxy;
module.exports.CF_WORKER_URL = CF_WORKER_URL;
module.exports.AD_SHIELD_JS = AD_SHIELD_JS;
module.exports.sanitizeVidcoreHtml = sanitizeVidcoreHtml;
module.exports.sanitizeVidlinkHtml = sanitizeVidlinkHtml;
module.exports.sanitizePreloadLinks = sanitizePreloadLinks;
module.exports.getScrapeDoSessionId = getScrapeDoSessionId;
module.exports.getScrapeDoTokens = getScrapeDoTokens;
module.exports.fetchViaScrapeDoWithRotation = fetchViaScrapeDoWithRotation;
module.exports.patchPlayerChunk = patchPlayerChunk;
module.exports.staticChunkCache = staticChunkCache;
module.exports.vidcoreHtmlCache = vidcoreHtmlCache;
module.exports.CHUNK_CACHE_CONTROL = CHUNK_CACHE_CONTROL;
module.exports.HTML_CACHE_CONTROL = HTML_CACHE_CONTROL;
module.exports.getSessionTokenIndex = getSessionTokenIndex;
module.exports.buildScrapeDoUrl = buildScrapeDoUrl;
module.exports.UNIVERSAL_SUBTITLE_INJECTOR_JS = UNIVERSAL_SUBTITLE_INJECTOR_JS;
module.exports.SOURCE_BUFFER_MUTE_JS = SOURCE_BUFFER_MUTE_JS;
