const { URL } = require("url");
const { fetchViaScrapeDoWithRotation, getScrapeDoTokens } = require("./vidcore.js");

const AD_SCRIPT_PATTERNS = /(popads|popcash|adcash|aclib|histats|yandex|googletagmanager|disable-devtool|devtools-detector|trafficjunky|propellerads|clickadu|exoclick|doubleclick)/i;

const ULTIMATE_AD_SHIELD = `<script id="ultimate-ad-shield">
(function() {
  'use strict';
  try {
    // Minimal shield: never touches the host page's own globals (e.g. bgImage).
    var AD_RE = /(popads|popcash|adcash|aclib|histats|yandex|googletagmanager|disable-devtool|devtools-detector|doubleclick|clickadu|propeller|exoclick|trafficjunky)/i;

    // 1. window.open returns a fake window only
    var fakeWin = {
      closed: false,
      focus: function() {},
      blur: function() {},
      close: function() { this.closed = true; },
      postMessage: function() {},
      location: { href: 'about:blank', assign: function(){}, replace: function(){} },
      document: { write: function(){}, open: function(){}, close: function(){} }
    };
    window.open = function() { return fakeWin; };

    // 2. Block <a target=_blank> programmatic clicks (popup triggers)
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function() {
      try {
        if (this.target === '_blank') return;
      } catch (e) {}
      return origClick.apply(this, arguments);
    };

    // 4. Route fetch/XHR aimed at the embed's own origin through our same-origin
    // pass-through (avoids CORS). Only that one origin is touched.
    var TARGET = '__TARGET_ORIGIN__';
    function viaProxy(u) {
      try {
        var abs = new URL(String(u), TARGET + '/').href;
        if (abs.indexOf(TARGET + '/') === 0) {
          return '/embed-proxy?raw=1&url=' + encodeURIComponent(abs);
        }
      } catch (e) {}
      return u;
    }
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function(input, init) {
        try {
          if (typeof input === 'string' || input instanceof URL) {
            input = viaProxy(input);
          }
        } catch (e) {}
        return origFetch.call(this, input, init);
      };
    }
    if (window.XMLHttpRequest) {
      var origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        var args = Array.prototype.slice.call(arguments);
        try { args[1] = viaProxy(url); } catch (e) {}
        return origOpen.apply(this, args);
      };
    }

    // 3. Block known ad-network scripts only
    var origAppend = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
      try {
        if (child && child.tagName === 'SCRIPT') {
          var src = child.src || (child.getAttribute && child.getAttribute('src')) || '';
          if (AD_RE.test(src)) return child;
        }
      } catch (e) {}
      return origAppend.apply(this, arguments);
    };
  } catch (e) {}
})();
</script>`;

function stripAdScripts(html) {
  if (!html || typeof html !== "string") return "";
  // Only strip external scripts whose src points to a known ad network /
  // detector. Inline scripts are never removed (they may define page globals).
  return html.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script\s*>/gi, (match) =>
    AD_SCRIPT_PATTERNS.test(match) ? "<!-- stripped ad script -->" : match,
  );
}

function sanitizeEmbedHtml(html, targetOrigin) {
  let cleaned = stripAdScripts(html);

  const baseTag = `<base href="${targetOrigin}/">`;
  const shield = ULTIMATE_AD_SHIELD.split("__TARGET_ORIGIN__").join(targetOrigin);
  const injection = `${baseTag}\n${shield}\n`;

  // Inject right after <head> or at beginning of document
  if (/<head\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<head\b[^>]*>/i, (match) => `${match}\n${injection}`);
  } else if (/<html\b[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>${injection}</head>`);
  } else {
    cleaned = `<head>${injection}</head>\n${cleaned}`;
  }

  return cleaned;
}

const net = require("net");

function isPrivateIp(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (
    v === "::1" ||
    v === "::" ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("fe80")
  ) {
    return true;
  }
  if (v.startsWith("::ffff:")) {
    const v4 = v.slice(7);
    if (net.isIPv4(v4)) return isPrivateIp(v4);
  }
  return false;
}

const DEFAULT_ALLOWED_EMBED_HOSTS = [
  "vidsrc.me",
  "vidsrc.to",
  "vidsrc.net",
  "vidsrc.xyz",
  "vidsrc.in",
  "vidsrc.pm",
  "vidsrc.cc",
  "vidsrc.vip",
  "vidsrc.stream",
  "2embed.cc",
  "2embed.to",
  "2embed.org",
  "2embed.skin",
  "multiembed.mov",
];

function isAllowedEmbedHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();

  const isTest =
    process.env.NODE_ENV === "test" ||
    process.env.EMBED_ALLOW_LOCALHOST === "1";

  if (isTest && (host === "127.0.0.1" || host === "localhost")) {
    return true;
  }

  if (
    isPrivateIp(host) ||
    host === "metadata.google.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return false;
  }

  const extra = (process.env.EMBED_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const allowedList = [...DEFAULT_ALLOWED_EMBED_HOSTS, ...extra];
  return allowedList.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

function sendPlainText(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.end(message);
}

const MAX_EMBED_BYTES = 15 * 1024 * 1024; // 15 MB

async function handleEmbedProxy(req, res) {
  const urlParam = req.query?.url || new URL(req.url || "/", "http://localhost").searchParams.get("url");

  if (!urlParam) {
    return sendPlainText(res, 400, "Missing required ?url= parameter");
  }

  let targetUrlObj;
  try {
    targetUrlObj = new URL(urlParam);
    if (targetUrlObj.protocol !== "http:" && targetUrlObj.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch (err) {
    return sendPlainText(res, 400, "Invalid target URL");
  }

  if (!isAllowedEmbedHost(targetUrlObj.hostname)) {
    return sendPlainText(res, 403, "Target host is not permitted by embed proxy whitelist");
  }

  const targetOrigin = targetUrlObj.origin;
  const targetHref = targetUrlObj.href;

  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8,ku;q=0.7",
    "Referer": targetOrigin + "/",
  };

  // Raw mode: same-origin pass-through for sub-requests (fetch/XHR) issued by
  // the proxied page, so they are not blocked by CORS.
  const rawMode = new URL(req.url || "/", "http://localhost").searchParams.get("raw") === "1";
  if (rawMode && /\/cdn-cgi\//i.test(targetUrlObj.pathname)) {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.end();
  }

  let bodyBuf = null;
  let contentType = "text/html; charset=utf-8";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    let currentUrl = targetUrlObj;
    let fetchRes = null;
    let redirectCount = 0;
    const maxRedirects = 3;

    while (redirectCount <= maxRedirects) {
      fetchRes = await fetch(currentUrl.href, {
        headers: reqHeaders,
        signal: controller.signal,
        redirect: "manual",
      });

      if (fetchRes.status >= 300 && fetchRes.status < 400 && fetchRes.headers.get("location")) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          clearTimeout(timer);
          return sendPlainText(res, 502, "Too many redirects");
        }
        const loc = fetchRes.headers.get("location");
        let nextUrl;
        try {
          nextUrl = new URL(loc, currentUrl.href);
          if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
            clearTimeout(timer);
            return sendPlainText(res, 400, "Invalid redirect protocol");
          }
        } catch {
          clearTimeout(timer);
          return sendPlainText(res, 400, "Invalid redirect target");
        }
        if (!isAllowedEmbedHost(nextUrl.hostname)) {
          clearTimeout(timer);
          return sendPlainText(res, 403, "Redirect to disallowed host blocked");
        }
        currentUrl = nextUrl;
        continue;
      }
      break;
    }

    clearTimeout(timer);

    if (fetchRes.status === 403 || fetchRes.status === 401 || fetchRes.status === 429) {
      throw new Error(`Direct fetch rejected with status ${fetchRes.status}`);
    }
    contentType = fetchRes.headers.get("content-type") || contentType;
    const arrayBuf = await fetchRes.arrayBuffer();
    if (arrayBuf.byteLength > MAX_EMBED_BYTES) {
      return sendPlainText(res, 413, "Response payload too large");
    }
    bodyBuf = Buffer.from(arrayBuf);
  } catch (directErr) {
    // Fallback to Scrape.do with rotation if configured
    try {
      if (getScrapeDoTokens().length > 0) {
        const scrapeRes = await fetchViaScrapeDoWithRotation(targetHref, fetch, {
          headers: reqHeaders,
        });
        contentType = scrapeRes.headers.get("content-type") || contentType;
        const arrayBuf = await scrapeRes.arrayBuffer();
        if (arrayBuf.byteLength > MAX_EMBED_BYTES) {
          return sendPlainText(res, 413, "Response payload too large");
        }
        bodyBuf = Buffer.from(arrayBuf);
      } else {
        throw directErr;
      }
    } catch (scrapeErr) {
      return sendPlainText(res, 502, `Failed to load external embed: ${directErr.message}`);
    }
  }

  if (rawMode) {
    const isDocType = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/xml|text\/xml)/i.test(contentType);
    const snip = bodyBuf.slice(0, 256).toString("utf8").trim().toLowerCase();
    const hasDocTag = snip.startsWith("<!doctype") || snip.startsWith("<html") || snip.startsWith("<svg") || snip.startsWith("<?xml");
    if (isDocType || hasDocTag) {
      return sendPlainText(res, 403, "Document content is not permitted in raw mode");
    }
  }

  if (rawMode || !/html/i.test(contentType)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(bodyBuf);
  }

  const html = bodyBuf.toString("utf8");
  const sanitizedHtml = sanitizeEmbedHtml(html, targetOrigin);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");

  return res.end(sanitizedHtml, "utf8");
}

module.exports = handleEmbedProxy;
module.exports.handleEmbedProxy = handleEmbedProxy;
module.exports.stripAdScripts = stripAdScripts;
module.exports.sanitizeEmbedHtml = sanitizeEmbedHtml;
module.exports.ULTIMATE_AD_SHIELD = ULTIMATE_AD_SHIELD;
