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
    if (cleanSessionId) api.searchParams.set("sessionId", cleanSessionId);
  }
  return api.toString();
}

function getScrapeDoSessionId(req) {
  if (!req) return "884422";
  if (req.query && req.query.sessionId) {
    const s = String(req.query.sessionId).trim().slice(0, 10);
    if (s) return s;
  }
  const rawHeader =
    (req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) ||
    "";
  const clientIp = rawHeader
    ? rawHeader.split(",")[0].trim()
    : (req.socket && req.socket.remoteAddress) || "";
  if (!clientIp || clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "localhost") {
    return "884422";
  }
  const raw = String(clientIp);
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
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

  if (method === "POST" && headers["Content-Length"] === undefined) {
    if (options.body) {
      headers["Content-Length"] = String(
        Buffer.isBuffer(options.body)
          ? options.body.length
          : Buffer.byteLength(options.body)
      );
    } else {
      headers["Content-Length"] = "0";
    }
  }

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
      const timer = setTimeout(() => controller.abort(), 8500);
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

  // 1. Unregister broken Service Workers (fixes sw.js:1 Uncaught TypeError: Failed to convert value to 'Response')
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker && typeof navigator.serviceWorker.getRegistrations === "function") {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        for (var i = 0; i < regs.length; i++) {
          try { regs[i].unregister(); } catch (_e) {}
        }
      }).catch(function() {});
    }
  } catch (_e) {}

  // 2. Mute noisy SourceBufferSink console errors that slow down the browser
  try {
    if (typeof console !== "undefined") {
      var __origErr = typeof console.error === "function" ? console.error.bind(console) : function() {};
      var __origWarn = typeof console.warn === "function" ? console.warn.bind(console) : function() {};
      var __shouldMute = function(args) {
        if (!args || !args.length) return false;
        var s = String(args[0] || "");
        return (
          s.indexOf("SourceBufferSink") !== -1 ||
          s.indexOf("SourceBuffer") !== -1 ||
          s.indexOf("getAllBufferRanges") !== -1 ||
          s.indexOf("appendBuffer") !== -1 ||
          s.indexOf("Failed to set append window") !== -1
        );
      };
      var __activeErr = __origErr;
      var __filteredErr = function() {
        if (__shouldMute(arguments)) return;
        return __activeErr.apply(console, arguments);
      };
      try {
        Object.defineProperty(console, "error", {
          configurable: true,
          enumerable: true,
          get: function() { return __filteredErr; },
          set: function(fn) { if (typeof fn === "function" && fn !== __filteredErr) __activeErr = fn; }
        });
      } catch (_e) {
        console.error = __filteredErr;
      }
      var __activeWarn = __origWarn;
      var __filteredWarn = function() {
        if (__shouldMute(arguments)) return;
        return __activeWarn.apply(console, arguments);
      };
      try {
        Object.defineProperty(console, "warn", {
          configurable: true,
          enumerable: true,
          get: function() { return __filteredWarn; },
          set: function(fn) { if (typeof fn === "function" && fn !== __filteredWarn) __activeWarn = fn; }
        });
      } catch (_e) {
        console.warn = __filteredWarn;
      }
    }
  } catch (_e) {}

  try {
    var __fakeLoc = new Proxy(window.location, {
      get: function(target, prop) {
        if (prop === "hostname" || prop === "host") return "vidcore.io";
        if (prop === "origin") return "https://vidcore.io";
        if (prop === "protocol") return "https:";
        if (prop === "port") return "";
        if (prop === "href") return "https://vidcore.io" + (window.location.pathname || "/") + (window.location.search || "");
        var val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });

    var __fakeDoc = new Proxy(document, {
      get: function(target, prop) {
        if (prop === "domain") return "vidcore.io";
        if (prop === "URL") return "https://vidcore.io" + (window.location.pathname || "/") + (window.location.search || "");
        if (prop === "referrer") return "https://vidcore.io/";
        if (prop === "location") return __fakeLoc;
        var val = target[prop];
        return typeof val === "function" ? val.bind(target) : val;
      }
    });

    var __fakeWin = new Proxy(window, {
      get: function(target, prop) {
        if (prop === "location") return __fakeLoc;
        if (prop === "document") return __fakeDoc;
        if (prop === "origin") return "https://vidcore.io";
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

    Object.defineProperty(window, "adce5c77-2808-4d01-877e-41167529529d", { value: false, writable: false, configurable: false });
    Object.defineProperty(window, "a3f1feb4-0b2d-4f69-a999-7116272dab1d", { value: false, writable: false, configurable: false });
  } catch (e) {}

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
  window.gtag = window.gtag || function() { window.dataLayer.push(arguments); };
  window.clarity = window.clarity || function() {};
  window.ym = window.ym || function() {};

  function isBlockedUrl(url) {
    if (!url || typeof url !== "string") return false;
    return /googletagmanager|google-analytics|cloudflareinsights|doubleclick|popads|propeller|adnetwork|yandex/i.test(url);
  }

  var SAFE_ASSET_RE = /(cdn\\.(jsdelivr\\.net|jwplayer\\.com)|wsrv\\.nl|image\\.tmdb\\.org|fonts\\.(googleapis|gstatic)\\.com|raw\\.githubusercontent\\.com)/i;
  var STREAM_EXT_RE = /\\.(m3u8|mpd|m4s|ts|mp4|m4a|m4v|aac|key)(\\?|$|#)/i;
  var STREAM_HOST_RE = /(flooderrr\\.store|hakunaymatata\\.com|sacdn|\\/sacdn\\/|\\/dash\\/|\\/proxy\\/|\\/mp\\/|orbitcache|premilkyway|sunnybreeze|frostywinds|cloudnestra|shadowlands|trueparadise|goldenkite|wisecanvas|streamhi|streamcdn|vidsrc|vidstream|topcdn|vidplay|megafiles|megacloud)/i;

  function resolveVidlinkStreamUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== "string") return null;
    var rawUrl = inputUrl.trim();
    if (!rawUrl || /^(blob:|data:|javascript:|about:)/i.test(rawUrl)) return null;
    if (rawUrl.indexOf(CF_WORKER + "/?") === 0 || rawUrl.indexOf(CF_WORKER + "?") === 0 || rawUrl.indexOf("/stream-proxy/") !== -1) return null;

    var locOrigin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";

    // 3. Intercept direct https://vidcore.io/*, /wyzie/*, /APA91*, and /servers* calls to prevent CORS errors
    if (
      rawUrl.indexOf("vidcore.io/") !== -1 ||
      rawUrl.indexOf("/wyzie/") !== -1 ||
      rawUrl.indexOf("wyzie/") === 0 ||
      rawUrl.indexOf("/APA91") !== -1 ||
      rawUrl.indexOf("APA91") === 0 ||
      rawUrl.indexOf("/servers") === 0
    ) {
      var vcPath = rawUrl;
      if (/^(?:https?:)?\\/\\//i.test(vcPath)) {
        try {
          var parsedVc = new URL(vcPath.indexOf("//") === 0 ? "https:" + vcPath : vcPath);
          vcPath = parsedVc.pathname + (parsedVc.search || "");
        } catch (_e) {
          var slashPos = vcPath.indexOf("/", 8);
          vcPath = slashPos !== -1 ? vcPath.slice(slashPos) : ("/" + vcPath);
        }
      }
      if (vcPath.charAt(0) !== "/") vcPath = "/" + vcPath;
      if (vcPath.indexOf("/vidcore/") === 0) {
        vcPath = vcPath.slice("/vidcore".length);
      }
      return {
        originalUrl: rawUrl,
        proxiedUrl: (locOrigin || "") + vcPath
      };
    }

    // 4. Intercept external R2 subtitle fetches so they never trigger cross-origin errors
    if (rawUrl.indexOf("r2.dev/") !== -1 && /\\.(vtt|srt)(\\?|$)/i.test(rawUrl)) {
      try {
        var r2Parsed = new URL(rawUrl);
        var subPath = r2Parsed.pathname;
        if (subPath.indexOf("/subtitles/") !== 0) {
          subPath = "/subtitles" + (subPath.charAt(0) === "/" ? "" : "/") + subPath;
        }
        return {
          originalUrl: rawUrl,
          proxiedUrl: (locOrigin || "") + subPath
        };
      } catch (_e) {}
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
      if (/\\.(m4s|mpd)(\\?|$)/i.test(rawUrl) && lastMpdBaseDir) {
        rawUrl = lastMpdBaseDir + rawUrl.replace(/^\\.?\\//, "");
      } else {
        return null;
      }
    }

    if (!/^https?:\\/\\//i.test(rawUrl)) return null;
    if (SAFE_ASSET_RE.test(rawUrl) || isBlockedUrl(rawUrl)) return null;
    var isStream = STREAM_EXT_RE.test(rawUrl) || STREAM_HOST_RE.test(rawUrl);
    if (!isStream) return null;

    try {
      var parsed = new URL(rawUrl);
      if (/\\.mpd(\\?|$)/i.test(parsed.pathname)) {
        lastMpdOrigin = parsed.origin;
        var lastSlash = parsed.pathname.lastIndexOf("/");
        lastMpdBaseDir = parsed.origin + (lastSlash >= 0 ? parsed.pathname.slice(0, lastSlash + 1) : "/");
        lastMpdQuery = parsed.search ? parsed.search.slice(1) : "";
      } else if (/\\.(m4s|mp4|m4a|m4v)(\\?|$)/i.test(parsed.pathname) && !parsed.search && lastMpdQuery && parsed.origin === lastMpdOrigin) {
        rawUrl = rawUrl + "?" + lastMpdQuery;
      }
    } catch (_e) {}

    var isVidcore = false;
    try {
      if (typeof window !== "undefined" && window.location) {
        var h = String(window.location.href || "");
        if (h.indexOf("/vidcore/") !== -1 || (window.location.hostname && window.location.hostname.indexOf("vidcore") !== -1)) {
          isVidcore = true;
        }
      }
    } catch (_e) {}

    var proxiedUrl = "";
    if (isVidcore) {
      proxiedUrl = CF_WORKER + "/stream-proxy/ref/" + encodeURIComponent(rawUrl);
    } else {
      proxiedUrl = CF_WORKER + "/?ref=vidlink&url=" + encodeURIComponent(rawUrl);
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

function addChunkCacheBusting(html) {
  if (!html || typeof html !== "string") return html;
  return html.replace(
    /(href|src)=["'](\/_next\/static\/chunks\/[^"']+)["']/g,
    (match, attr, path) => {
      if (path.includes("v=2")) return match;
      const separator = path.includes("?") ? "&" : "?";
      return `${attr}="${path}${separator}v=2"`;
    }
  );
}

const { UNIVERSAL_SUBTITLE_INJECTOR_JS } = require("./subtitles.js");

// Inject right at the opening <head> tag so subtitle and fetch interceptors run BEFORE any player script!
function injectStrictlyIntoHead(htmlStr, injectContent) {
  if (!htmlStr || typeof htmlStr !== "string") return htmlStr;
  if (/<head\b[^>]*>/i.test(htmlStr)) {
    return htmlStr.replace(/(<head\b[^>]*>)/i, "$1" + injectContent);
  }
  if (htmlStr.includes("</head>")) {
    return htmlStr.replace("</head>", injectContent + "</head>");
  }
  return "<head>" + injectContent + "</head>" + htmlStr;
}

function sanitizeVidlinkHtml(html) {
  let out = html;
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*\/>/gi, "");
  out = out.replace(/https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi, "/gtag-shield.js");
  out = out.replace(/https:\/\/mc\.yandex\.ru\/watch\/\d+/gi, "");

  out = out.replace(/\\"limitAds\\":false/g, '\\"limitAds\\":true');
  out = out.replace(/"limitAds":false/g, '"limitAds":true');
  out = out.replace(/\\"referer\\":(null|\\"[^\\"]*\\")/g, '\\"referer\\":\\"https://vidlink.pro/\\"');

  out = sanitizePreloadLinks(out);
  out = addChunkCacheBusting(out);

  const headInject = `
<script id="hwto-universal-subs">${UNIVERSAL_SUBTITLE_INJECTOR_JS}</script>
<script id="hwto-vidlink-inline-shield">${AD_SHIELD_JS}</script>
<link rel="preconnect" href="${CF_WORKER_URL}" crossorigin />
<link rel="dns-prefetch" href="${CF_WORKER_URL}" />
<style id="hwto-sub-fix">[class*="captions"],.vds-captions,[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>
`;
  return injectStrictlyIntoHead(out, headInject);
}

function sanitizeVidcoreHtml(html) {
  let out = html;
  out = out.replace(/\\"ad\\":true/g, '\\"ad\\":false');
  out = out.replace(/"ad":true/g, '"ad":false');
  out = out.replace(
    /\\"from\\":(null|\\"(?!https:\/\/vidcore\.io)[^\\]*\\")/g,
    '\\"from\\":\\"https://vidcore.io\\"',
  );
  out = out.replace(/\\"from\\":\\"https:\/\/vidcore\.io\/\\"/g, '\\"from\\":\\"https://vidcore.io\\"');
  out = out.replace(/https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi, "/gtag-shield.js");
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script\b[^>]*static\.cloudflareinsights\.com[^>]*\/>/gi, "");

  out = sanitizePreloadLinks(out);
  out = addChunkCacheBusting(out);

  const headInject = `
<script id="hwto-universal-subs">${UNIVERSAL_SUBTITLE_INJECTOR_JS}</script>
<script id="hwto-vidcore-inline-shield">${AD_SHIELD_JS}</script>
<link rel="preconnect" href="${CF_WORKER_URL}" crossorigin />
<link rel="dns-prefetch" href="${CF_WORKER_URL}" />
<style id="hwto-sub-fix">span[style*="text-shadow"],[class*="captions"],[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>
`;
  return injectStrictlyIntoHead(out, headInject);
}

function patchPlayerChunk(jsCode, pathname = "") {
  let out = jsCode;

  if (pathname.includes("281-") || pathname.includes("/281") || pathname.includes("281.")) {
    return jsCode;
  }

  if (pathname.includes("/webpack-")) {
    out = AD_SHIELD_JS + out;
  }

  out = out.replace(
    /return\s*console\.table\(t\),\s*console\.clear\(\),\s*Date\.now\(\)\s*-\s*a\s*<=\s*10/g,
    "return!0",
  );

  if (out.includes("if(!tI.current&&(tI.current=!0,window.self!==window.top))")) {
    out = out.replace(
      "if(!tI.current&&(tI.current=!0,window.self!==window.top))",
      "if(!1)",
    );
  }
  if (out.includes("Please Disable Sandbox")) {
    out = out.split("Please Disable Sandbox").join("");
  }

  if (out.includes("let{en:l,from:b,ad:h,")) {
    out = out.replace("let{en:l,from:b,ad:h,", "let h=!1,{en:l,from:b,ad:_h_ignored,");
  }

  if (out.includes("await A,tl.current=T[0];")) {
    out = out.replace(
      "await A,tl.current=T[0];",
      `await A,tl.current=T[0];window.__CF_WORKER_URL=${JSON.stringify(CF_WORKER_URL)};window.__VC_STREAM_ERR=!1;`,
    );
  }
  if (out.includes('console.error("".concat(r," while loading ").concat(e.url))')) {
    out = out.replace(
      'console.error("".concat(r," while loading ").concat(e.url))',
      '(window.__VC_STREAM_ERR=!0,console.error("".concat(r," while loading ").concat(e.url)))',
    );
  }

  if (out.includes('sx:{whiteSpace:"nowrap",textAlign:"center"}')) {
    out = out.replace(
      'sx:{whiteSpace:"nowrap",textAlign:"center"}',
      'sx:{whiteSpace:"pre-wrap",maxWidth:"92vw",margin:"0 auto",textAlign:"center",unicodeBidi:"plaintext"}',
    );
  }

  if (out.includes('/\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.[a-zA-Z]{2,}\\b/.test(d[t].text)')) {
    out = out.replace(
      '/\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.[a-zA-Z]{2,}\\b/.test(d[t].text)',
      '/(?:https?:\\/\\/|www\\.)[a-zA-Z0-9][-a-zA-Z0-9]*\\.[a-zA-Z]{2,}\\b/i.test(d[t].text)',
    );
  }

  const zTarget = '.map(function(e){return String.fromCharCode(30^e)}).join("")]=Z';
  if (out.includes(zTarget)) {
    out = out.replace(
      zTarget,
      '.map(function(e){return String.fromCharCode(30^e)}).join("")]=function(v){if(v===555){console.warn("[VidCore] Blocked 555 error");return;}if(typeof v==="number"&&v!==0&&v!==1&&v!==2){try{window.parent.postMessage({event:"status",data:v},"*")}catch(_e){}}return Z(v)}',
    );
  }

  const adScripts = [
    "//kg." + "chiveyfewmets.com/rzgJYYsrJpx2H/kNmgM",
    "//cl." + "gogtib.com/rWXjzriQHyvUUDB/rwOme",
    "https://" + "umami.vidcore.net/script.js",
  ];
  for (const s of adScripts) {
    if (out.includes(s)) out = out.split(s).join("");
  }

  return out;
}

const staticChunkCache = new Map();

function getCleanUserAgent(rawUa) {
  if (!rawUa || /node|curl|python|axios|undici/i.test(rawUa)) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return rawUa;
}

async function fetchFromUpstream(origin, targetPathAndQuery, req, bodyBuffer, useScrapeDoFallback = true) {
  const targetUrl = origin + targetPathAndQuery;
  const method = req.method || "GET";
  const forwardHeaders = {
    "User-Agent": getCleanUserAgent(req.headers["user-agent"]),
    Accept: req.headers["accept"] || "*/*",
    "Accept-Language": req.headers["accept-language"] || "en-US,en;q=0.9,ar;q=0.8",
    Connection: "keep-alive",
    Referer: `${origin}/`,
    Origin: origin,
  };
  const optionalHeaders = ["x-csrf-token", "content-type", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url"];
  for (const h of optionalHeaders) {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  }

  for (const [k, v] of Object.entries(req.headers || {})) {
    const lower = k.toLowerCase();
    if (
      (lower.startsWith("x-") || lower === "cookie") &&
      !forwardHeaders[lower] &&
      !lower.startsWith("x-forwarded") &&
      !lower.startsWith("x-vercel")
    ) {
      forwardHeaders[k] = v;
    }
  }

  if (
    targetPathAndQuery.startsWith("/APA91") ||
    targetPathAndQuery.includes("APA91") ||
    targetPathAndQuery.startsWith("/wyzie") ||
    targetPathAndQuery.startsWith("/servers")
  ) {
    forwardHeaders["Referer"] = `${VIDCORE_ORIGIN}/`;
    forwardHeaders["Origin"] = VIDCORE_ORIGIN;
  }

  const isHtmlNavigation =
    targetPathAndQuery.startsWith("/movie/") ||
    targetPathAndQuery.startsWith("/tv/");

  const isDecryptionRoute =
    targetPathAndQuery.startsWith("/APA91") ||
    targetPathAndQuery.includes("APA91") ||
    targetPathAndQuery.startsWith("/servers") ||
    targetPathAndQuery.startsWith("/wyzie");

  const sessionId = getScrapeDoSessionId(req);
  const hasScrapeTokens = getScrapeDoTokens().length > 0;
  const scrapeOptions = {
    method,
    headers: forwardHeaders,
    sessionId,
  };
  if (method === "POST" && bodyBuffer && bodyBuffer.length > 0) {
    scrapeOptions.body = bodyBuffer;
  }

  if (
    config.mode !== "direct" &&
    hasScrapeTokens &&
    (isHtmlNavigation || isDecryptionRoute)
  ) {
    try {
      return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
    } catch (_scrapeErr) {
      // Fall through to direct fetch if Scrape.do fails so we never return 502
    }
  }

  try {
    const fetchOptions = {
      method,
      headers: forwardHeaders,
    };
    if (method === "POST" && bodyBuffer && bodyBuffer.length > 0) {
      fetchOptions.body = bodyBuffer;
    }
    const directRes = await fetch(targetUrl, fetchOptions);
    if (
      useScrapeDoFallback &&
      (directRes.status === 403 || directRes.status === 503 || directRes.status === 429) &&
      config.mode !== "direct" &&
      (method === "GET" || method === "POST") &&
      hasScrapeTokens
    ) {
      return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
    }
    return directRes;
  } catch (err) {
    if (useScrapeDoFallback && config.mode !== "direct" && (method === "GET" || method === "POST") && hasScrapeTokens) {
      return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
    }
    throw err;
  }
}

function readRequestBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(null);
  if (req.body && Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.body && typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === "object") return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleVidcoreProxy(req, res) {
  try {
    const host = req.headers.host || "localhost:3000";
    const parsedUrl = new URL(req.url || "/", `http://${host}`);
    let pathname = parsedUrl.pathname;
    const search = parsedUrl.search || "";

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400",
      });
      return res.end();
    }

    if (pathname === "/gtag-shield.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(AD_SHIELD_JS, "utf8");
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
      res.writeHead(302, { Location: workerTarget, "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
      return res.end();
    }

    if (pathname.startsWith("/embed/")) {
      const cleanTarget = pathname.replace(/^\/embed/, "") + search;
      res.writeHead(302, { Location: cleanTarget });
      return res.end();
    }

    // Delegate any Vidlink request directly to dedicated fast Vidlink proxy
    const incomingRef = String(req.headers["referer"] || "");
    if (pathname.startsWith("/vidlink/") || (incomingRef.includes("/vidlink/") && !pathname.startsWith("/vidcore/"))) {
      const handleVidlinkProxy = require("./vidlink.js").handleVidlinkProxy;
      return handleVidlinkProxy(req, res);
    }

    let origin = VIDCORE_ORIGIN;
    let targetPath = pathname;

    if (pathname.startsWith("/vidcore/")) {
      origin = VIDCORE_ORIGIN;
      targetPath = pathname.slice("/vidcore".length) || "/";
    }

    // Fast In-memory Caching + Direct Fetch for Static Assets / Chunks (bypasses Scrape.do completely)
    const isChunkStaticPath =
      targetPath.startsWith("/_next/static/") ||
      pathname.startsWith("/_next/static/") ||
      /\.(js|css|woff2|woff|ttf|wasm)$/i.test(targetPath);

    if (isChunkStaticPath && req.method === "GET") {
      const cacheKey = targetPath.startsWith("/_next/static/") ? targetPath : pathname;
      if (staticChunkCache.has(cacheKey)) {
        const cached = staticChunkCache.get(cacheKey);
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
          "Access-Control-Allow-Origin": "*",
        });
        return res.end(cached.body);
      }
    }

    const bodyBuffer = await readRequestBody(req);
    const upstreamRes = await fetchFromUpstream(origin, targetPath + search, req, bodyBuffer, !isChunkStaticPath);

    const contentType =
      upstreamRes.headers.get("content-type") || "application/octet-stream";

    const responseHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "X-AdShield": "Active",
    };

    const setCookie = upstreamRes.headers.get("set-cookie");
    if (setCookie) responseHeaders["Set-Cookie"] = setCookie;

    const isHtmlRoute =
      contentType.includes("text/html") ||
      targetPath.startsWith("/movie/") ||
      targetPath.startsWith("/tv/") ||
      targetPath.startsWith("/embed/");

    if (isHtmlRoute) {
      const isFromVidlink = origin === VIDLINK_ORIGIN;
      const rawText = await upstreamRes.text();
      const cleaned = isFromVidlink ? sanitizeVidlinkHtml(rawText) : sanitizeVidcoreHtml(rawText);
      responseHeaders["Cache-Control"] = "no-cache";
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(cleaned, "utf8");
    }

    const isChunkRoute =
      isChunkStaticPath ||
      (contentType.includes("javascript") && (pathname.includes("/_next/") || targetPath.includes("/_next/")));

    if (isChunkRoute) {
      const rawJs = await upstreamRes.text();
      const patchedJs = patchPlayerChunk(rawJs, targetPath);
      responseHeaders["Cache-Control"] = "public, max-age=31536000, immutable";
      const cacheKey = targetPath.startsWith("/_next/static/") ? targetPath : pathname;
      staticChunkCache.set(cacheKey, { body: patchedJs, contentType: "application/javascript; charset=utf-8" });
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

    if (upstreamRes.body && typeof Readable.fromWeb === "function" && req.method !== "HEAD") {
      res.writeHead(upstreamRes.status, responseHeaders);
      return Readable.fromWeb(upstreamRes.body).pipe(res);
    }

    const arrayBuffer = await upstreamRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.writeHead(upstreamRes.status, responseHeaders);
    return res.end(buffer);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
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
module.exports.getSessionTokenIndex = getSessionTokenIndex;
module.exports.UNIVERSAL_SUBTITLE_INJECTOR_JS = UNIVERSAL_SUBTITLE_INJECTOR_JS;