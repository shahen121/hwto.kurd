// VidCore + Vidlink Ad-Free Proxy & Stream Gateway (Vercel Serverless + Node HTTP Server)

const VIDCORE_ORIGIN = process.env.VIDCORE_ORIGIN || "https://vidcore.io";
const VIDLINK_ORIGIN = process.env.VIDLINK_ORIGIN || "https://vidlink.pro";
const CF_WORKER_URL = (
  process.env.CF_WORKER_URL || "https://hwto.proteome626.workers.dev"
).replace(/\/+$/, "");

const config = {
  mode: process.env.VIDCORE_PROXY_MODE || "auto", // 'auto', 'scrape_do', 'direct'
};

let _tokenRoundRobinIndex = 0;

function getScrapeDoTokens() {
  const rawTokens = [
    process.env.SCRAPE_DO_TOKEN_1,
    process.env.SCRAPE_DO_TOKEN_2,
    process.env.SCRAPE_DO_TOKEN_3,
    process.env.SCRAPE_DO_TOKEN,
  ]
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);

  // Deduplicate while preserving order
  return [...new Set(rawTokens)];
}

function buildScrapeDoUrl(targetUrl, token, useCustomHeaders = true, sessionId = null) {
  const api = new URL("https://api.scrape.do/");
  api.searchParams.set("token", token);
  api.searchParams.set("url", targetUrl);
  if (useCustomHeaders) {
    api.searchParams.set("customHeaders", "true");
  }
  if (sessionId) {
    // Scrape.do requires sessionId to be between 1 and 7 characters
    const cleanSessionId = String(sessionId).trim().slice(0, 7);
    if (cleanSessionId) {
      api.searchParams.set("sessionId", cleanSessionId);
    }
  }
  return api.toString();
}

/**
 * Derives a consistent 6-7 character numeric/alphanumeric sessionId for Scrape.do
 * based on user IP, cookie, or user-agent, falling back to a fixed default session "998877".
 */
function getScrapeDoSessionId(req) {
  if (!req) return "998877";
  const ip =
    (req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) ||
    (req.socket && req.socket.remoteAddress) ||
    "";
  const raw = String(ip || req.headers["user-agent"] || "998877");
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  // Return positive 6-digit number string
  const num = (hash % 900000) + 100000;
  return String(num);
}

/**
 * Fetches `targetUrl` via Scrape.do using Round-Robin token selection
 * with automatic fallback across all configured tokens on quota/auth errors (401, 403, 429, 5xx) or network errors.
 * Supports both GET and POST with `customHeaders=true` preserving exact method, headers, and body.
 */
async function fetchViaScrapeDoWithRotation(
  targetUrl,
  fetchImpl = fetch,
  options = {},
) {
  const tokens = getScrapeDoTokens();
  if (tokens.length === 0) {
    throw new Error("No SCRAPE_DO_TOKEN configured in environment variables");
  }

  const reqMethod = options.method || "GET";
  const rawHeaders = options.headers || {};
  const forwardHeaders = {};
  const sessionId = options.sessionId || "998877";

  for (const [k, v] of Object.entries(rawHeaders)) {
    if (!v) continue;
    const lower = k.toLowerCase();
    // Do not forward host or hop-by-hop headers to Scrape.do proxy
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower.startsWith("x-forwarded") ||
      lower.startsWith("x-vercel")
    ) {
      continue;
    }
    forwardHeaders[k] = v;
  }

  // Ensure VidCore required origin/referer/ua are explicitly set
  if (!forwardHeaders["Origin"] && !forwardHeaders["origin"]) {
    forwardHeaders["Origin"] = VIDCORE_ORIGIN;
  }
  if (!forwardHeaders["Referer"] && !forwardHeaders["referer"]) {
    forwardHeaders["Referer"] = `${VIDCORE_ORIGIN}/`;
  }
  if (!forwardHeaders["User-Agent"] && !forwardHeaders["user-agent"]) {
    forwardHeaders["User-Agent"] = getCleanUserAgent();
  }

  const fetchOpts = {
    method: reqMethod,
    headers: forwardHeaders,
  };

  if (reqMethod !== "GET" && reqMethod !== "HEAD") {
    if (options.body && options.body.length > 0) {
      fetchOpts.body = options.body;
      forwardHeaders["Content-Length"] = String(options.body.length);
    } else {
      fetchOpts.body = "";
      forwardHeaders["Content-Length"] = "0";
    }
  }

  const startIdx = _tokenRoundRobinIndex % tokens.length;
  _tokenRoundRobinIndex = (_tokenRoundRobinIndex + 1) % tokens.length;

  let lastRes = null;
  let lastErr = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[(startIdx + i) % tokens.length];
    const scrapeUrl = buildScrapeDoUrl(targetUrl, token, true, sessionId);
    try {
      const res = await fetchImpl(scrapeUrl, fetchOpts);
      // Check if this Scrape.do response is an auth/quota failure (401, 403, 429) or proxy failure (>= 500)
      const scrapeAuth = res.headers && typeof res.headers.get === "function" ? res.headers.get("scrape.do-auth") : null;
      const initialStatus = res.headers && typeof res.headers.get === "function" ? res.headers.get("scrape.do-initial-status-code") : null;

      // If Scrape.do returns 401, 403, 429 (quota or blocked token), try next token
      if (
        (res.status === 401 || res.status === 403 || res.status === 429) &&
        initialStatus !== "404" &&
        initialStatus !== "200"
      ) {
        lastRes = res;
        continue;
      }

      // If token succeeded (including upstream 200, 404, etc.), return immediately
      if (res.status < 500) {
        return res;
      }
      lastRes = res;
    } catch (err) {
      lastErr = err;
    }
  }

  if (lastRes) return lastRes;
  throw lastErr || new Error("All Scrape.do tokens failed");
}

// Client-side Ad-Shield, Stream CORS Interceptor & Anti-Freeze Guard (served via /gtag-shield.js, injected in <head>, and prepended to webpack chunks)
const AD_SHIELD_JS = `(function() {
  if (window.__vidcoreShieldInitialized) return;
  window.__vidcoreShieldInitialized = true;
  var CF_WORKER = ${JSON.stringify(CF_WORKER_URL)};
  var lastMpdOrigin = "https://surge.flooderrr.store";
  var lastMpdBaseDir = "";
  var lastMpdQuery = "";

  try {
    // 1. Lock internal VidCore ad flags to false permanently
    Object.defineProperty(window, "adce5c77-2808-4d01-877e-41167529529d", {
      value: false, writable: false, configurable: false
    });
    Object.defineProperty(window, "a3f1feb4-0b2d-4f69-a999-7116272dab1d", {
      value: false, writable: false, configurable: false
    });
  } catch (e) {}

  // 2. Block all popup windows / tab-unders completely
  var noopWindow = {
    closed: false,
    focus: function() {},
    blur: function() {},
    close: function() {},
    postMessage: function() {},
    location: { href: "about:blank", assign: function(){}, replace: function(){} }
  };
  window.open = function(url) {
    try {
      window.parent.postMessage({ type: "AD_SHIELD_EVENT", action: "blocked_popup", url: String(url || "") }, "*");
    } catch (e) {}
    return noopWindow;
  };

  // 3. Block known ad/tracker domains from dynamic script/iframe injection
  var BLOCKED_PATTERNS = [
    /gogtib\\.com/i,
    /chiveyfewmets\\.com/i,
    /umami\\.vidcore\\.net/i,
    /googletagmanager\\.com/i,
    /google-analytics\\.com/i,
    /cloudflareinsights\\.com/i,
    /doubleclick\\.net/i,
    /popads\\.net/i,
    /popcash\\.net/i,
    /exoclick\\.com/i,
    /propellerads\\.com/i,
    /brightadnetwork\\.com/i,
    /mc\\.yandex\\.ru/i,
    /adsterra/i
  ];

  function isBlockedUrl(url) {
    if (!url || typeof url !== "string") return false;
    return BLOCKED_PATTERNS.some(function(re) { return re.test(url); });
  }

  // 4. Stream URL Resolver & Rewriter for Vidlink (MPEG-DASH .mpd, .m4s, HLS .m3u8, .ts, .mp4, flooderrr.store, hakunaymatata.com, sacdn)
  var SAFE_ASSET_RE = /(cdn\\.jsdelivr\\.net|cdn\\.jwplayer\\.com|wsrv\\.nl|image\\.tmdb\\.org|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|raw\\.githubusercontent\\.com)/i;
  var STREAM_EXT_RE = /\\.(m3u8|mpd|m4s|ts|mp4|m4a|m4v|aac|key)(\\?|$|#)/i;
  var STREAM_HOST_RE = /(flooderrr\\.store|hakunaymatata\\.com|sacdn|\\/sacdn\\/|\\/dash\\/|\\/proxy\\/|\\/mp\\/|orbitcache|premilkyway|sunnybreeze|frostywinds|cloudnestra|shadowlands|trueparadise)/i;

  function resolveVidlinkStreamUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== "string") return null;
    var rawUrl = inputUrl.trim();
    if (!rawUrl || /^(blob:|data:|javascript:|about:)/i.test(rawUrl)) return null;

    // Already routed through Cloudflare Worker proxy
    if (
      rawUrl.indexOf(CF_WORKER + "/?") === 0 ||
      rawUrl.indexOf(CF_WORKER + "?") === 0 ||
      rawUrl.indexOf("/stream-proxy/") !== -1
    ) {
      return null;
    }

    var locOrigin = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";

    // Handle root-relative or wrongly-resolved DASH/HLS paths (e.g. /sacdn/dash/... resolved against location.origin or CF_WORKER)
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

    return {
      originalUrl: rawUrl,
      proxiedUrl: CF_WORKER + "/?ref=vidlink&url=" + encodeURIComponent(rawUrl)
    };
  }

  // 5. Monkey-patch window.fetch
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        var reqUrl = "";
        if (typeof input === "string") {
          reqUrl = input;
        } else if (typeof URL !== "undefined" && input instanceof URL) {
          reqUrl = input.toString();
        } else if (input && typeof input === "object" && typeof input.url === "string") {
          reqUrl = input.url;
        }
        var rw = resolveVidlinkStreamUrl(reqUrl);
        if (rw) {
          var newInput = rw.proxiedUrl;
          if (typeof Request !== "undefined" && input instanceof Request) {
            try {
              newInput = new Request(rw.proxiedUrl, input);
            } catch (_re) {
              newInput = rw.proxiedUrl;
            }
          }
          return origFetch.call(this, newInput, init).then(function(res) {
            try {
              Object.defineProperty(res, "url", {
                get: function() { return rw.originalUrl; },
                configurable: true
              });
            } catch (_e) {}
            return res;
          });
        }
      } catch (_err) {}
      return origFetch.apply(this, arguments);
    };
  }

  // 6. Monkey-patch XMLHttpRequest.prototype.open
  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
    var origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        var urlStr = (typeof URL !== "undefined" && url instanceof URL) ? url.toString() : String(url || "");
        var rw = resolveVidlinkStreamUrl(urlStr);
        if (rw) {
          try {
            Object.defineProperty(this, "responseURL", {
              get: function() { return rw.originalUrl; },
              configurable: true
            });
          } catch (_e) {}
          var args = Array.prototype.slice.call(arguments);
          args[1] = rw.proxiedUrl;
          return origXhrOpen.apply(this, args);
        }
      } catch (_err) {}
      return origXhrOpen.apply(this, arguments);
    };
  }

  // 7. Intercept direct HTMLMediaElement.prototype.src assignment for external MP4/stream URLs
  try {
    if (typeof HTMLMediaElement !== "undefined" && HTMLMediaElement.prototype) {
      var srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
      if (srcDesc && srcDesc.set && srcDesc.get) {
        Object.defineProperty(HTMLMediaElement.prototype, "src", {
          configurable: true,
          enumerable: srcDesc.enumerable,
          get: function() {
            return srcDesc.get.call(this);
          },
          set: function(val) {
            var rw = resolveVidlinkStreamUrl(String(val || ""));
            return srcDesc.set.call(this, rw ? rw.proxiedUrl : val);
          }
        });
      }
    }
  } catch (_e) {}

  // 8. Clean up invalid <link rel="preload"> elements and block ad/tracker dynamic elements
  function cleanInvalidPreloads() {
    try {
      var links = document.querySelectorAll('link[rel="preload"]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute("href");
        if (!href || !href.trim() || href === "null" || href === "undefined" || isBlockedUrl(href)) {
          links[i].parentNode && links[i].parentNode.removeChild(links[i]);
        }
      }
    } catch (_e) {}
  }
  cleanInvalidPreloads();
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("DOMContentLoaded", cleanInvalidPreloads);
  }

  var origCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function(tagName) {
    var el = origCreateElement.apply(this, arguments);
    var tag = String(tagName || "").toLowerCase();
    if (tag === "script" || tag === "iframe") {
      var origSetAttr = el.setAttribute;
      el.setAttribute = function(name, value) {
        if (String(name).toLowerCase() === "src" && isBlockedUrl(String(value))) {
          try {
            window.parent.postMessage({ type: "AD_SHIELD_EVENT", action: "blocked_script", url: String(value) }, "*");
          } catch (e) {}
          return;
        }
        return origSetAttr.apply(this, arguments);
      };
    } else if (tag === "link") {
      var origLinkSetAttr = el.setAttribute;
      el.setAttribute = function(name, value) {
        var attrName = String(name).toLowerCase();
        var attrVal = String(value == null ? "" : value).trim();
        if (attrName === "href" && (!attrVal || attrVal === "null" || attrVal === "undefined" || isBlockedUrl(attrVal))) {
          if (String(el.getAttribute("rel") || "").toLowerCase() === "preload") {
            el.removeAttribute("rel");
          }
          return;
        }
        if (attrName === "rel" && attrVal.toLowerCase() === "preload") {
          var curHref = el.getAttribute("href");
          if (curHref !== null && (!curHref.trim() || curHref === "null" || curHref === "undefined" || isBlockedUrl(curHref))) {
            return;
          }
        }
        return origLinkSetAttr.apply(this, arguments);
      };
    } else if (tag === "video" || tag === "source") {
      var origMediaSetAttr = el.setAttribute;
      el.setAttribute = function(name, value) {
        if (String(name).toLowerCase() === "src") {
          var rw = resolveVidlinkStreamUrl(String(value || ""));
          if (rw) {
            return origMediaSetAttr.call(this, name, rw.proxiedUrl);
          }
        }
        return origMediaSetAttr.apply(this, arguments);
      };
    }
    return el;
  };

  try {
    window.parent.postMessage({ type: "AD_SHIELD_READY", status: "active", timestamp: Date.now() }, "*");
  } catch (e) {}
})();\n`;

function sanitizePreloadLinks(html) {
  // Remove <link ... rel="preload" ...> tags that have missing, empty, whitespace, or blocked/invalid href values
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*(?:["']preload["']|preload\b)/i.test(tag)) {
      return tag;
    }
    const hrefMatch = tag.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i);
    if (!hrefMatch) {
      return "";
    }
    const hrefVal = (hrefMatch[1] ?? hrefMatch[2] ?? hrefMatch[3] ?? "").trim();
    if (
      !hrefVal ||
      hrefVal === "null" ||
      hrefVal === "undefined" ||
      hrefVal === "about:blank" ||
      /mc\.yandex\.ru/i.test(hrefVal) ||
      /\/\/wsrv\.nl\/\?url=https:\/\/image\.tmdb\.org\/t\/p\/w500(?:null|undefined)?(?:&|$)/i.test(hrefVal)
    ) {
      return "";
    }
    return tag;
  });
}

function sanitizeVidcoreHtml(html) {
  let out = html;

  // 1. Force SSR ad prop to false in Next.js flight payload without altering DOM structure
  out = out.replace(/\\"ad\\":true/g, '\\"ad\\":false');
  out = out.replace(/"ad":true/g, '"ad":false');

  // 2. Force SSR "from" prop to https://vidcore.io/ so third-party domain triggers never activate
  out = out.replace(
    /\\"from\\":(null|\\"[^\\"]*\\")/g,
    '\\"from\\":\\"https://vidcore.io/\\"',
  );

  // 3. Replace Google Tag Manager script URL in BOTH <head> and RSC payload with local /gtag-shield.js
  out = out.replace(
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi,
    "/gtag-shield.js",
  );

  // 4. Strip Cloudflare edge-injected beacon script
  out = out.replace(
    /<script[^>]*src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js[^"]*"[^>]*><\/script>/gi,
    "",
  );

  out = sanitizePreloadLinks(out);

  // 5. Inject RTL / BiDi subtitle CSS fix so Kurdish & Arabic punctuation and wrapping display properly
  const subtitleCss = `<style id="hwto-sub-fix">span[style*="text-shadow"],[class*="captions"],[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>`;
  if (out.includes("</head>")) {
    out = out.replace("</head>", `${subtitleCss}</head>`);
  }

  return out;
}

function sanitizeVidlinkHtml(html) {
  let out = html;

  // Force limitAds to true in Next.js SSR flight payload so ad components are skipped
  out = out.replace(/\\"limitAds\\":false/g, '\\"limitAds\\":true');
  out = out.replace(/"limitAds":false/g, '"limitAds":true');

  // Force referer to vidlink.pro
  out = out.replace(
    /\\"referer\\":(null|\\"[^\\"]*\\")/g,
    '\\"referer\\":\\"https://vidlink.pro/\\"',
  );

  // Replace Google Tag Manager with /gtag-shield.js
  out = out.replace(
    /https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=[A-Z0-9-]+/gi,
    "/gtag-shield.js",
  );

  // Remove Yandex Metrika preload & noscript pixel cleanly without leaving empty href="" attributes
  out = sanitizePreloadLinks(out);
  out = out.replace(/<noscript>\s*<div>\s*<img[^>]*mc\.yandex\.ru[^>]*>\s*<\/div>\s*<\/noscript>/gi, "");
  out = out.replace(
    /https:\/\/mc\.yandex\.ru\/watch\/\d+/gi,
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  );
  out = sanitizePreloadLinks(out);

  // Inject Client-side Interceptor (fetch + XHR monkey-patch) early in <head> and RTL / BiDi subtitle CSS fix
  const earlyInterceptor = `<script id="hwto-vidlink-interceptor">${AD_SHIELD_JS}</script>`;
  const subtitleCss = `<style id="hwto-sub-fix">[class*="captions"],.vds-captions,[data-part="cue"],[data-part="cue-display"]{unicode-bidi:plaintext!important;font-family:"Tahoma","Segoe UI","Arial",sans-serif!important;}</style>`;
  if (out.includes("<head>")) {
    out = out.replace("<head>", `<head>${earlyInterceptor}`);
  }
  if (out.includes("</head>")) {
    out = out.replace("</head>", `${subtitleCss}</head>`);
  }

  return out;
}

function patchPlayerChunk(jsCode, pathname) {
  let out = jsCode;

  // Prepend Ad-Shield to webpack runtime chunk so it executes before any page component
  if (pathname.includes("/webpack-")) {
    out = AD_SHIELD_JS + out;
  }

  // 1. Neutralize anti-DevTools / slow-CPU console.table freeze check ("Date.now()-a<=10")
  if (out.includes("return console.table(t),console.clear(),Date.now()-a<=10")) {
    out = out.replace(
      "return console.table(t),console.clear(),Date.now()-a<=10",
      "return!0",
    );
  }

  // 2. Neutralize Sandbox detector ("Please Disable Sandbox") in both VidCore and VidLink
  if (out.includes("window.self!==window.top")) {
    out = out.replace(
      "if(!tI.current&&(tI.current=!0,window.self!==window.top))",
      "if(!1)",
    );
    out = out.replace(/if\(window\.self!==window\.top\)/g, "if(!1)");
  }
  if (out.includes("Please Disable Sandbox")) {
    out = out.replace(/<h1>Please Disable Sandbox<\/h1>/g, "");
  }

  // 3. Force component prop ad (h) to false at destructuring (VidCore)
  if (out.includes("let{en:l,from:b,ad:h,")) {
    out = out.replace(
      "let{en:l,from:b,ad:h,",
      "let h=!1,{en:l,from:b,ad:_h_ignored,",
    );
  }

  // 3b. Force limitAds:true and enableDirectLinks:false in VidLink chunks
  if (out.includes("let{data:t,limitAds:a,referer:")) {
    out = out.replace(
      /let\{data:t,limitAds:a,referer:([a-zA-Z0-9_$]+)\}=e/g,
      "let a=!0,{data:t,limitAds:_a_ignored,referer:$1}=e",
    );
  }
  if (out.includes("enableDirectLinks:g=!1")) {
    out = out.replace(/enableDirectLinks:g=!1/g, "enableDirectLinks:_g_ignored=!1,g=!1");
  }
  if (out.includes("https://brightadnetwork.com/jump/next.php")) {
    out = out.split("https://brightadnetwork.com/jump/next.php").join("about:blank");
  }

  // 4. Route VidCore XHR loader and decoded stream URL through Cloudflare Worker
  // Keep tl.current.url intact during `.m3u8` / `.mp4` extension checks, then rewrite XHR requests
  // directly to CF_WORKER_URL/stream-proxy/ref/${encodeURIComponent(url)}
  if (out.includes("await A,tl.current=T[0];")) {
    out = out.replace(
      "await A,tl.current=T[0];",
      `await A,tl.current=T[0];window.__CF_WORKER_URL=${JSON.stringify(CF_WORKER_URL)};window.__VC_STREAM_ERR=!1;`,
    );
  }

  // Flag fatal stream HTTP errors (e.g. 404 on .m3u8) immediately so VidCore switches sub-servers in <100ms
  if (out.includes('console.error("".concat(r," while loading ").concat(e.url))')) {
    out = out.replace(
      'console.error("".concat(r," while loading ").concat(e.url))',
      '(window.__VC_STREAM_ERR=!0,console.error("".concat(r," while loading ").concat(e.url)))',
    );
  }
  if (out.includes('eO.error("".concat(r," while loading ").concat(e.url))')) {
    out = out.replace(
      'eO.error("".concat(r," while loading ").concat(e.url))',
      '(window.__VC_STREAM_ERR=!0,eO.error("".concat(r," while loading ").concat(e.url)))',
    );
  }

  // 4b. Prevent infinite spinner if an upstream m3u8/mp4 returns 404/error (instant failover to next VidCore sub-server)
  if (
    out.includes(
      "let r=setInterval(()=>{if(t.duration>0)if(e){var d;(null==t||null==(d=t.player)?void 0:d.initialized)&&(clearInterval(r),a())}else clearInterval(r),a()},100)",
    )
  ) {
    out = out.replace(
      "let r=setInterval(()=>{if(t.duration>0)if(e){var d;(null==t||null==(d=t.player)?void 0:d.initialized)&&(clearInterval(r),a())}else clearInterval(r),a()},100)",
      "let _st=Date.now(),r=setInterval(()=>{if(t.duration>0){if(e){var d;(null==t||null==(d=t.player)?void 0:d.initialized)&&(clearInterval(r),a())}else clearInterval(r),a()}else if(window.__VC_STREAM_ERR||Date.now()-_st>7000){clearInterval(r);try{e$(s=>s.map(x=>(x.selected&&(x.failed=!0),x)))}catch(_e){}}},100)",
    );
  }
  if (
    out.includes(
      "let t=setInterval(()=>{tb.current.duration>0&&(clearInterval(t),e())},100)",
    )
  ) {
    out = out.replace(
      "let t=setInterval(()=>{tb.current.duration>0&&(clearInterval(t),e())},100)",
      "let _st=Date.now(),t=setInterval(()=>{if(tb.current.duration>0){clearInterval(t),e()}else if(tb.current.error||Date.now()-_st>7000){clearInterval(t);try{e$(s=>s.map(x=>(x.selected&&(x.failed=!0),x)))}catch(_e){}}},100)",
    );
  }

  // If MP4 direct assignment is used on video element (tb.current.src=tl.current.url)
  if (out.includes("tb.current.src=tl.current.url")) {
    out = out.replace(
      "tb.current.src=tl.current.url",
      `tb.current.src=(/^https?:\\/\\//i.test(tl.current.url)&&!tl.current.url.includes("/stream-proxy/")?${JSON.stringify(CF_WORKER_URL)}+"/stream-proxy/ref/"+encodeURIComponent(tl.current.url):tl.current.url)`,
    );
  }

  // Rewrite all XHR `.open("GET", t.url, !0)` calls in chunk 281 (Accelerated HLS & hls.js fallback)
  if (out.includes('a.open("GET",t.url,!0)')) {
    out = out.replace(
      /a\.open\("GET",t\.url,!0\)/g,
      `(function(){if(/^https?:\\/\\//i.test(t.url)&&!t.url.includes("/stream-proxy/")){t.url=${JSON.stringify(CF_WORKER_URL)}+"/stream-proxy/ref/"+encodeURIComponent(t.url);}})(),a.open("GET",t.url,!0)`,
    );
  }
  if (out.includes('e.readyState||e.open("GET",t.url,!0)')) {
    out = out.replace(
      /e\.readyState\|\|e\.open\("GET",t\.url,!0\)/g,
      `e.readyState||((function(){if(/^https?:\\/\\//i.test(t.url)&&!t.url.includes("/stream-proxy/")){t.url=${JSON.stringify(CF_WORKER_URL)}+"/stream-proxy/ref/"+encodeURIComponent(t.url);}})(),e.open("GET",t.url,!0))`,
    );
  }
  if (out.includes('a.open("GET",t.url,!0),d(a,t.url)')) {
    out = out.replace(
      /a\.open\("GET",t\.url,!0\),d\(a,t\.url\)/g,
      `(function(){if(/^https?:\\/\\//i.test(t.url)&&!t.url.includes("/stream-proxy/")){t.url=${JSON.stringify(CF_WORKER_URL)}+"/stream-proxy/ref/"+encodeURIComponent(t.url);}})(),a.open("GET",t.url,!0),d(a,t.url)`,
    );
  }

  // 5. Inject custom external subtitle (`?sub_url=...&sub_label=...`) into VidCore's `/wyzie?` subtitle list
  // Run inside `.finally(...)` AFTER `R.sort(...)` and unselect any previous track so the custom subtitle
  // is always at the top of the subtitle menu and guaranteed to be active even if `/wyzie?` fails.
  if (
    out.includes(
      "R.length>0&&(R.sort((e,t)=>e.track.label.localeCompare(t.track.label)),el(R))",
    )
  ) {
    out = out.replace(
      "R.length>0&&(R.sort((e,t)=>e.track.label.localeCompare(t.track.label)),el(R))",
      'R.sort((e,t)=>e.track.label.localeCompare(t.track.label));try{var _sp=new URLSearchParams(window.location.search),_su=_sp.get("sub_url"),_sl=_sp.get("sub")||"ku";if(_su&&tb.current){R.forEach(function(x){x.selected=!1;});var _lbl=_sl==="ar"?"العربية (hwto-kurd)":"کوردی (hwto-kurd)";var _tr=tb.current.addTextTrack("subtitles",_lbl);_tr.xid="custom_"+Date.now();_tr.srclang=_sl;R.unshift({url:_su,track:_tr,encoding:"utf8",downloaded:!1,selected:!0});_=!0;}}catch(_err){}R.length>0&&el(R)',
    );
  }

  // 5b. Fix VidCore subtitle rendering:
  // - Replace `whiteSpace:"nowrap"` with `whiteSpace:"pre-wrap",maxWidth:"92vw",margin:"0 auto",unicodeBidi:"plaintext"` so long lines wrap cleanly and RTL punctuation (Arabic/Kurdish) renders in the right order
  if (out.includes('sx:{whiteSpace:"nowrap",textAlign:"center"}')) {
    out = out.replace(
      'sx:{whiteSpace:"nowrap",textAlign:"center"}',
      'sx:{whiteSpace:"pre-wrap",maxWidth:"92vw",margin:"0 auto",textAlign:"center",unicodeBidi:"plaintext"}',
    );
  }
  // - Prevent VidCore's overly broad domain regex from deleting normal dialogue lines like "Mr.Smith" or "Wait.What"
  if (
    out.includes(
      '/\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.[a-zA-Z]{2,}\\b/.test(d[t].text)',
    )
  ) {
    out = out.replace(
      '/\\b[a-zA-Z0-9][-a-zA-Z0-9]*\\.[a-zA-Z]{2,}\\b/.test(d[t].text)',
      '/\\b(opensubtitles|subdl|subscene|yifysubtitles|addic7ed)\\.(org|com|net)\\b/i.test(d[t].text)',
    );
  }

  // 5c. Fix VidLink external subtitle format detection so both `.vtt` and `.srt` files work via `?sub_file=`
  if (
    out.includes(
      'S&&(0,l.jsx)(i.fQ8,{src:S,kind:"subtitles",label:_,lang:"und",type:"vtt",default:!0})',
    )
  ) {
    out = out.replace(
      'S&&(0,l.jsx)(i.fQ8,{src:S,kind:"subtitles",label:_,lang:"und",type:"vtt",default:!0})',
      'S&&(0,l.jsx)(i.fQ8,{src:S,kind:"subtitles",label:_,lang:"und",type:S&&/\\.srt(\\?|$)/i.test(S)?"srt":"vtt",default:!0})',
    );
  }

  // 6. Strip ad & analytics script URLs inside player bundle
  const adScripts = [
    "//kg.chiveyfewmets.com/rzgJYYsrJpx2H/kNmgM",
    "//cl.gogtib.com/rWXjzriQHyvUUDB/rwOme",
    "https://umami.vidcore.net/script.js",
  ];
  for (const s of adScripts) {
    if (out.includes(s)) {
      out = out.split(s).join("");
    }
  }

  return out;
}

function getCleanUserAgent(rawUa) {
  if (!rawUa || /node|curl|python|axios|undici/i.test(rawUa)) {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return rawUa;
}

async function fetchFromUpstream(origin, targetPathAndQuery, req, bodyBuffer, useScrapeDoFallback = true) {
  const targetUrl = `${origin}${targetPathAndQuery}`;
  const method = req.method || "GET";

  const forwardHeaders = {
    "User-Agent": getCleanUserAgent(req.headers["user-agent"]),
    Accept: req.headers["accept"] || "*/*",
    "Accept-Language":
      req.headers["accept-language"] || "en-US,en;q=0.9,ar;q=0.8",
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
    if (req.headers[h]) {
      forwardHeaders[h] = req.headers[h];
    }
  }
  // Forward any custom headers and cookies used by VidLink / VidCore APIs
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

  // If this is an APA91ywF decryption request, set Referer to the actual movie/tv page path
  if (targetPathAndQuery.startsWith("/APA91ywF")) {
    const incomingRef = String(req.headers["referer"] || "");
    const movieMatch = incomingRef.match(/\/(movie|tv)\/\d+/);
    if (movieMatch) {
      forwardHeaders["Referer"] = `${VIDCORE_ORIGIN}${movieMatch[0]}`;
    }
  }

  const isHtmlNavigation =
    targetPathAndQuery.startsWith("/movie/") ||
    targetPathAndQuery.startsWith("/tv/");

  const isDecryptionRoute =
    targetPathAndQuery.startsWith("/APA91ywF") ||
    targetPathAndQuery.startsWith("/servers");

  const sessionId = getScrapeDoSessionId(req);
  const hasScrapeTokens = getScrapeDoTokens().length > 0;
  const scrapeOptions = {
    method,
    headers: forwardHeaders,
    body: bodyBuffer,
    sessionId,
  };

  // Always route /APA91ywF decryption endpoints through Scrape.do to avoid AWS datacenter Cloudflare 403 blocks
  if (useScrapeDoFallback && isDecryptionRoute && hasScrapeTokens) {
    return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
  }

  if (
    useScrapeDoFallback &&
    config.mode === "scrape_do" &&
    (method === "GET" || method === "POST") &&
    isHtmlNavigation &&
    hasScrapeTokens
  ) {
    return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
  }

  try {
    const fetchOptions = {
      method,
      headers: forwardHeaders,
      redirect: "follow",
    };
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      bodyBuffer &&
      bodyBuffer.length > 0
    ) {
      fetchOptions.body = bodyBuffer;
    }

    const directRes = await fetch(targetUrl, fetchOptions);

    if (
      useScrapeDoFallback &&
      (directRes.status === 403 ||
        directRes.status === 503 ||
        directRes.status === 429) &&
      config.mode !== "direct" &&
      (method === "GET" || method === "POST") &&
      hasScrapeTokens
    ) {
      return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
    }

    return directRes;
  } catch (err) {
    if (
      useScrapeDoFallback &&
      config.mode !== "direct" &&
      (method === "GET" || method === "POST") &&
      hasScrapeTokens
    ) {
      return await fetchViaScrapeDoWithRotation(targetUrl, fetch, scrapeOptions);
    }
    throw err;
  }
}

function readRequestBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (req.body && typeof req.body === "string")
    return Promise.resolve(Buffer.from(req.body));
  if (req.body && typeof req.body === "object")
    return Promise.resolve(Buffer.from(JSON.stringify(req.body)));
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

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      return res.end();
    }

    // 1. Serve Ad-Shield script as /gtag-shield.js
    if (pathname === "/gtag-shield.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      return res.end(AD_SHIELD_JS, "utf8");
    }

    // 2. Fallback Redirect (302) for /stream-proxy/* to Cloudflare Worker
    if (pathname.startsWith("/stream-proxy/")) {
      const m = pathname.match(
        /^\/stream-proxy\/(ref|noref)\/(https?)\/([^/]+)(\/.*)?$/,
      );
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

    // 3. Support /embed/movie/... or /embed/tv/...
    if (pathname.startsWith("/embed/")) {
      const cleanTarget = pathname.replace(/^\/embed/, "") + search;
      res.writeHead(302, { Location: cleanTarget });
      return res.end();
    }

    // 4. Support /vidcore/movie/... or /vidcore/tv/...
    let forceVidlink = false;
    if (pathname.startsWith("/vidcore/")) {
      pathname = pathname.replace(/^\/vidcore/, "");
    } else if (pathname.startsWith("/vidlink/")) {
      pathname = pathname.replace(/^\/vidlink/, "");
      forceVidlink = true;
    }

    // Determine whether this sub-asset request belongs to VidLink or VidCore based on Referer
    const referer = String(req.headers["referer"] || "");
    const isFromVidlink = forceVidlink || referer.includes("/vidlink/");
    const targetOrigin = isFromVidlink ? VIDLINK_ORIGIN : VIDCORE_ORIGIN;

    const isPlayerRoute =
      pathname.startsWith("/movie/") || pathname.startsWith("/tv/");
    const isChunkRoute = pathname.startsWith("/_next/static/chunks/");

    const reqBody =
      req.method !== "GET" && req.method !== "HEAD"
        ? await readRequestBody(req)
        : null;

    const upstreamRes = await fetchFromUpstream(
      targetOrigin,
      pathname + search,
      req,
      reqBody,
      !isFromVidlink,
    );
    const contentType =
      upstreamRes.headers.get("content-type") || "application/octet-stream";

    const responseHeaders = {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "X-AdShield": "Active",
    };

    // Forward Set-Cookie headers if returned by upstream/Scrape.do
    const setCookie = upstreamRes.headers.get("set-cookie");
    if (setCookie) {
      responseHeaders["Set-Cookie"] = setCookie;
    }

    const cacheControl = upstreamRes.headers.get("cache-control");
    if (cacheControl && !isPlayerRoute && !isChunkRoute) {
      responseHeaders["Cache-Control"] = cacheControl;
    } else {
      responseHeaders["Cache-Control"] = "no-store";
    }

    // Transform HTML / RSC payloads to strip ads and inject Ad-Shield
    if (
      contentType.includes("text/html") ||
      contentType.includes("text/x-component") ||
      isPlayerRoute
    ) {
      const rawText = await upstreamRes.text();
      const cleaned = isFromVidlink
        ? sanitizeVidlinkHtml(rawText)
        : sanitizeVidcoreHtml(rawText);
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(cleaned, "utf8");
    }

    // Transform JS chunks to disable Sandbox check, DevTools freeze check, ad scripts, and route streams to CF Worker
    if (
      isChunkRoute ||
      (contentType.includes("javascript") && pathname.includes("/_next/"))
    ) {
      const rawJs = await upstreamRes.text();
      const patchedJs = patchPlayerChunk(rawJs, pathname);
      res.writeHead(upstreamRes.status, responseHeaders);
      return res.end(patchedJs, "utf8");
    }

    // Binary / JSON / WASM / Subtitle passthrough
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

// Vercel Serverless Function Configuration: Disable body parser to preserve raw/binary payloads
const vercelConfig = {
  api: {
    bodyParser: false,
  },
};

module.exports = handleVidcoreProxy;
module.exports.default = handleVidcoreProxy;
module.exports.config = vercelConfig;
module.exports.handleVidcoreProxy = handleVidcoreProxy;
module.exports.CF_WORKER_URL = CF_WORKER_URL;
module.exports.AD_SHIELD_JS = AD_SHIELD_JS;
module.exports.sanitizeVidlinkHtml = sanitizeVidlinkHtml;
module.exports.sanitizePreloadLinks = sanitizePreloadLinks;
module.exports.getScrapeDoSessionId = getScrapeDoSessionId;
module.exports.getScrapeDoTokens = getScrapeDoTokens;
module.exports.fetchViaScrapeDoWithRotation = fetchViaScrapeDoWithRotation;
