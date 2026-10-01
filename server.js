import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4173;
const UPSTREAM_HOST = 'kurdcinama.com';
const API_PREFIX = '/api/';
const API_TTL = 180 * 1000;
const UPSTREAM_TIMEOUT = 20000;
const MAX_API_RESPONSE = 2 * 1024 * 1024; // 2 MB
const MAX_CACHE_ENTRIES = 400;
const MAX_CACHE_KEY_LEN = 512;
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // requests per window per IP

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const apiCache = new Map();
const rateLimitMap = new Map();

/* Response hardening + compression -------------------------------------- */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

// HSTS only in production (HTTPS). Local dev uses HTTP.
const HSTS_HEADER = process.env.NODE_ENV === 'production'
  ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
  : {};

// Everything the app is allowed to reach: its own files, the Google Fonts
// stylesheet + font files, TMDB images and the site's own photo bucket.
// The SPA talks to the API only through the same-origin proxy, so `connect-src`
// can stay locked to 'self'. Set CSP_REPORT_ONLY=1 to audit without blocking.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https://image.tmdb.org https://kurdcinama.com",
  "font-src 'self' https://fonts.gstatic.com",
  // The watch page embeds the primary vidcore.io player using the TMDB id directly.
  "frame-src 'self' https://vidcore.io https://*.vidcore.io https://*.vidcore.net",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'"
].join('; ');

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);
const MIN_COMPRESS_BYTES = 1024;

function wantsGzip(req) {
  const enc = req.headers['accept-encoding'];
  return typeof enc === 'string' && /\bgzip\b/i.test(enc);
}

/**
 * Single write path: attaches the security headers, gzips text payloads when
 * the client asked for it and only when that actually shrinks the body.
 */
function sendBuffer(req, res, status, data, headers = {}, { compress = false, csp = false, noBody = false } = {}) {
  const send = (body, gzipped) => {
    const out = { ...SECURITY_HEADERS, ...HSTS_HEADER, ...headers, 'Content-Length': body.length };
    if (gzipped) {
      out['Content-Encoding'] = 'gzip';
      out.Vary = 'Accept-Encoding';
    }
    if (csp) {
      out['Content-Security-Policy'] = CSP;
      if (process.env.CSP_REPORT_ONLY === '1') {
        out['Content-Security-Policy-Report-Only'] = out['Content-Security-Policy'];
        delete out['Content-Security-Policy'];
      }
    }
    res.writeHead(status, out);
    if (!noBody) {
      res.end(body);
    } else {
      res.end();
    }
  };

  if (!compress || !wantsGzip(req) || data.length < MIN_COMPRESS_BYTES) {
    send(data, false);
    return;
  }
  zlib.gzip(data, { level: zlib.constants.Z_DEFAULT_COMPRESSION }, (err, gz) => {
    if (err || !gz || gz.length >= data.length) send(data, false);
    else send(gz, true);
  });
}

function sendJson(req, res, status, payload, extraHeaders = {}, noBody = false) {
  sendBuffer(
    req,
    res,
    status,
    Buffer.from(JSON.stringify(payload), 'utf8'),
    { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    { compress: true, noBody }
  );
}

function getRealIp(req) {
  // Only trust X-Forwarded-For when behind a reverse proxy (set TRUST_PROXY=1).
  // Otherwise a client can spoof it to bypass rate limiting.
  if (process.env.TRUST_PROXY === '1') {
    const xff = req.headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function cleanupRateLimit() {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (entry.resetTime < now) rateLimitMap.delete(ip);
  }
}
setInterval(cleanupRateLimit, RATE_LIMIT_WINDOW * 2).unref();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.resetTime < now) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

function isAllowedApiPath(pathname, search) {
  if (pathname !== '/api/TMDBCache.aspx') return false;
  const params = new URLSearchParams(search);
  const action = params.get('action');
  const allowedActions = new Set([
    'trending', 'upcoming', 'toprated', 'search',
    'mycontent', 'stats', 'movie', 'tv'
  ]);
  return allowedActions.has(action);
}

function proxyApi(req, res, reqUrl, isHead = false) {
  // Rate limiting
  const ip = getRealIp(req);
  if (!checkRateLimit(ip)) {
    sendJson(req, res, 429, { error: 'Too many requests, please slow down' }, { 'Cache-Control': 'no-store' });
    return;
  }

  // Validate API path and action
  if (!isAllowedApiPath(reqUrl.pathname, reqUrl.search)) {
    sendJson(req, res, 404, { error: 'Not Found' }, { 'Cache-Control': 'no-store' });
    return;
  }

  // Validate cache key length
  const target = reqUrl.pathname + reqUrl.search;
  if (target.length > MAX_CACHE_KEY_LEN) {
    sendJson(req, res, 400, { error: 'Query too long' }, { 'Cache-Control': 'no-store' });
    return;
  }

  const hit = apiCache.get(target);
  if (hit && hit.expires > Date.now()) {
    sendJson(req, res, 200, JSON.parse(hit.body.toString('utf8')), {
      'Cache-Control': 'public, max-age=180',
      'X-Cache': 'HIT'
    }, isHead);
    return;
  }

  const options = {
    hostname: UPSTREAM_HOST,
    path: target,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
      'Host': UPSTREAM_HOST,
      'User-Agent': req.headers['user-agent'] || 'hwto.kurd/1.0'
    }
  };

  const upstream = https.request(options, (ures) => {
    const chunks = [];
    let totalSize = 0;
    ures.on('data', (c) => {
      totalSize += c.length;
      if (totalSize > MAX_API_RESPONSE) {
        upstream.destroy(new Error('Response too large'));
        return;
      }
      chunks.push(c);
    });
    ures.on('end', () => {
      if (totalSize > MAX_API_RESPONSE) return;
      const body = Buffer.concat(chunks);
      const ok = ures.statusCode >= 200 && ures.statusCode < 300;
      if (ok) {
        apiCache.set(target, { body, expires: Date.now() + API_TTL });
        if (apiCache.size > MAX_CACHE_ENTRIES) {
          const oldest = apiCache.keys().next().value;
          apiCache.delete(oldest);
        }
      }
      sendBuffer(
        req,
        res,
        ures.statusCode || 502,
        body,
        {
          'Content-Type': ures.headers['content-type'] || 'application/json; charset=utf-8',
          'Cache-Control': ok ? 'public, max-age=180' : 'no-store',
          'X-Cache': 'MISS'
        },
        { compress: true, noBody: isHead }
      );
    });
  });

  upstream.on('error', (err) => {
    console.error('[proxy]', err.message);
    sendJson(req, res, 502, { error: 'تعذّر الوصول إلى خادم البيانات، حاول مجدداً' }, { 'Cache-Control': 'no-store' });
  });

  upstream.setTimeout(UPSTREAM_TIMEOUT, () => {
    upstream.destroy(new Error('upstream timeout'));
  });

  upstream.end();
}

function sendText(req, res, status, message, noBody = false) {
  sendBuffer(req, res, status, Buffer.from(message, 'utf8'), {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  }, { noBody });
}

function serveFile(req, res, filePath, status = 200, isHead = false) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendText(req, res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    sendBuffer(
      req,
      res,
      status,
      data,
      {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, must-revalidate'
      },
      { compress: COMPRESSIBLE.has(ext), csp: ext === '.html', noBody: isHead }
    );
  });
}

const server = http.createServer((req, res) => {
  let reqUrl;
  try {
    reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendText(req, res, 400, 'Bad Request');
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      ...HSTS_HEADER,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(req, res, 405, 'Method Not Allowed');
    return;
  }

  const isHead = req.method === 'HEAD';

  if (reqUrl.pathname.startsWith(API_PREFIX)) {
    proxyApi(req, res, reqUrl, isHead);
    return;
  }

  let decoded;
  try {
    decoded = decodeURIComponent(reqUrl.pathname);
  } catch {
    sendText(req, res, 400, 'Bad Request');
    return;
  }

  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendText(req, res, 403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) {
      serveFile(req, res, filePath, isHead);
      return;
    }
    if (!path.extname(relative)) {
      serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'), isHead);
      return;
    }
    sendText(req, res, 404, 'Not Found');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`hwto.kurd running at http://${HOST}:${PORT}`);
  console.log(`API proxy     -> https://${UPSTREAM_HOST}${API_PREFIX}TMDBCache.aspx`);
});
