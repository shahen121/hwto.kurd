const { URL } = require("url");
const { fetchViaScrapeDoWithRotation, getScrapeDoTokens } = require("./vidcore.js");

const AD_SCRIPT_PATTERNS = /(popads|popcash|adcash|aclib|histats|yandex|googletagmanager|disable-devtool|devtools-detector|\bsbx\b|sandbox|trafficjunky|propellerads|clickadu|exoclick|adservice|doubleclick)/i;

const ULTIMATE_AD_SHIELD = `<script id="ultimate-ad-shield">
(function() {
  'use strict';

  // 1. Fake Window Proxy for window.open: returns complete fake window to bypass ad checks
  var fakeWin = {
    closed: false,
    focus: function() {},
    blur: function() {},
    close: function() { this.closed = true; },
    postMessage: function() {},
    location: { href: 'about:blank', assign: function(){}, replace: function(){} },
    document: { write: function(){}, open: function(){}, close: function(){} }
  };
  window.open = function() {
    try {
      window.parent.postMessage({ type: 'AD_SHIELD_EVENT', action: 'blocked_popup' }, '*');
    } catch (e) {}
    return fakeWin;
  };

  // 2. Fake window.frameElement to bypass sandbox and anti-embed checks
  try {
    Object.defineProperty(window, 'frameElement', {
      get: function() {
        return {
          hasAttribute: function(attr) {
            return attr && String(attr).toLowerCase() === 'sandbox' ? false : false;
          },
          getAttribute: function() { return null; },
          sandbox: { length: 0, contains: function() { return false; }, value: "" }
        };
      },
      configurable: true
    });
  } catch (e) {}

  // 3. Block creation and appending of ad elements (<script>, <iframe>, auto-clicking <a>)
  var AD_KEYWORDS = /(popads|popcash|adcash|aclib|histats|yandex|googletagmanager|disable-devtool|devtools-detector|\bsbx\b|sandbox|doubleclick|clickadu|propeller|exoclick)/i;

  function isAdUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return AD_KEYWORDS.test(url);
  }

  // Trap <a> clicks with target="_blank"
  var origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {
    if (this.target === '_blank' || isAdUrl(this.href)) {
      return;
    }
    return origAnchorClick.apply(this, arguments);
  };

  // Intercept appendChild and insertBefore to block ad scripts and ad iframes
  var origAppend = Element.prototype.appendChild;
  Element.prototype.appendChild = function(child) {
    if (child && child.tagName === 'SCRIPT') {
      var src = child.src || child.getAttribute('src') || '';
      if (isAdUrl(src) || AD_KEYWORDS.test(child.textContent || '')) {
        return child;
      }
    }
    if (child && child.tagName === 'IFRAME') {
      var ifrSrc = child.src || child.getAttribute('src') || '';
      if (isAdUrl(ifrSrc)) {
        return child;
      }
    }
    return origAppend.apply(this, arguments);
  };

  var origInsertBefore = Element.prototype.insertBefore;
  Element.prototype.insertBefore = function(newChild, refChild) {
    if (newChild && newChild.tagName === 'SCRIPT') {
      var src = newChild.src || newChild.getAttribute('src') || '';
      if (isAdUrl(src) || AD_KEYWORDS.test(newChild.textContent || '')) {
        return newChild;
      }
    }
    if (newChild && newChild.tagName === 'IFRAME') {
      var ifrSrc = newChild.src || newChild.getAttribute('src') || '';
      if (isAdUrl(ifrSrc)) {
        return newChild;
      }
    }
    return origInsertBefore.apply(this, arguments);
  };

  // 4. Intercept addEventListener on window and document for click hijacking
  var origAddEventListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if ((this === window || this === document || (document.body && this === document.body)) &&
        (type === 'click' || type === 'mousedown' || type === 'pointerdown' || type === 'touchstart')) {
      var wrappedListener = function(evt) {
        try {
          return listener.apply(this, arguments);
        } catch (err) {
          // suppress ad crash
        }
      };
      return origAddEventListener.call(this, type, wrappedListener, options);
    }
    return origAddEventListener.call(this, type, listener, options);
  };

  // 5. Proxy nested iframes to pass through /embed-proxy (Requirement 2)
  function wrapIframeUrl(val) {
    if (!val || typeof val !== 'string') return val;
    if (val.startsWith('about:') || val.startsWith('blob:') || val.startsWith('javascript:')) return val;
    if (val.includes('/embed-proxy?url=')) return val;
    try {
      var resolved = new URL(val, window.location.href).href;
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        if (isAdUrl(resolved)) return 'about:blank';
        return '/embed-proxy?url=' + encodeURIComponent(resolved);
      }
    } catch (e) {}
    return val;
  }

  try {
    var iframeDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeDesc && iframeDesc.set) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        configurable: true,
        enumerable: true,
        get: iframeDesc.get,
        set: function(val) {
          return iframeDesc.set.call(this, wrapIframeUrl(val));
        }
      });
    }

    var origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, val) {
      if (this.tagName === 'IFRAME' && String(name).toLowerCase() === 'src') {
        val = wrapIframeUrl(val);
      }
      return origSetAttr.call(this, name, val);
    };

    // Observe dynamic DOM mutations for iframes
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node && node.nodeType === 1) {
            var ifrs = node.tagName === 'IFRAME' ? [node] : (node.querySelectorAll ? node.querySelectorAll('iframe') : []);
            for (var i = 0; i < ifrs.length; i++) {
              var s = ifrs[i].getAttribute('src');
              if (s && !s.includes('/embed-proxy?url=') && !s.startsWith('about:') && !s.startsWith('blob:') && !s.startsWith('javascript:')) {
                ifrs[i].setAttribute('src', wrapIframeUrl(s));
              }
            }
          }
        });
      });
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
})();
</script>`;

function stripAdScripts(html) {
  if (!html || typeof html !== "string") return "";

  // 1. Remove full <script>...</script> tags whose tag or content matches ad patterns
  let out = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi, (match, content) => {
    if (AD_SCRIPT_PATTERNS.test(match) || AD_SCRIPT_PATTERNS.test(content)) {
      return "<!-- stripped ad script -->";
    }
    return match;
  });

  // 2. Remove self-closing or unclosed <script ... src="..." ...> tags matching ad patterns
  out = out.replace(
    /<script\b[^>]*src=["'][^"']*(?:popads|popcash|adcash|aclib|histats|yandex|googletagmanager|disable-devtool|devtools-detector|sbx|sandbox)[^"']*["'][^>]*>(?:<\/script>)?/gi,
    "<!-- stripped ad script -->"
  );

  return out;
}

function sanitizeEmbedHtml(html, targetOrigin) {
  let cleaned = stripAdScripts(html);

  const baseTag = `<base href="${targetOrigin}/">`;
  const injection = `${baseTag}\n${ULTIMATE_AD_SHIELD}\n`;

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

async function handleEmbedProxy(req, res) {
  const urlParam = req.query?.url || new URL(req.url || "/", "http://localhost").searchParams.get("url");

  if (!urlParam) {
    res.statusCode = 400;
    return res.end("Missing required ?url= parameter");
  }

  let targetUrlObj;
  try {
    targetUrlObj = new URL(urlParam);
    if (!targetUrlObj.protocol.startsWith("http")) {
      throw new Error("Invalid protocol");
    }
  } catch (err) {
    res.statusCode = 400;
    return res.end(`Invalid target URL: ${urlParam}`);
  }

  const targetOrigin = targetUrlObj.origin;
  const targetHref = targetUrlObj.href;

  const reqHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,ar;q=0.8,ku;q=0.7",
    "Referer": targetOrigin + "/",
  };

  let html = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const fetchRes = await fetch(targetHref, {
      headers: reqHeaders,
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    if (fetchRes.status === 403 || fetchRes.status === 401 || fetchRes.status === 429) {
      throw new Error(`Direct fetch rejected with status ${fetchRes.status}`);
    }
    html = await fetchRes.text();
  } catch (directErr) {
    // Fallback to Scrape.do with rotation if configured
    try {
      if (getScrapeDoTokens().length > 0) {
        const scrapeRes = await fetchViaScrapeDoWithRotation(targetHref, fetch, {
          headers: reqHeaders,
        });
        html = await scrapeRes.text();
      } else {
        throw directErr;
      }
    } catch (scrapeErr) {
      res.statusCode = 502;
      return res.end(`Failed to load external embed: ${directErr.message}`);
    }
  }

  const sanitizedHtml = sanitizeEmbedHtml(html, targetOrigin);

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Content-Security-Policy");

  return res.end(sanitizedHtml, "utf8");
}

module.exports = handleEmbedProxy;
module.exports.handleEmbedProxy = handleEmbedProxy;
module.exports.stripAdScripts = stripAdScripts;
module.exports.sanitizeEmbedHtml = sanitizeEmbedHtml;
module.exports.ULTIMATE_AD_SHIELD = ULTIMATE_AD_SHIELD;
