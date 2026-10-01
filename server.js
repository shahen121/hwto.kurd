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

/* Response hardening + compression -------------------------------------- */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

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
function sendBuffer(req, res, status, data, headers = {}, { compress = false, csp = false } = {}) {
  const send = (body, gzipped) => {
    const out = { ...SECURITY_HEADERS, ...headers, 'Content-Length': body.length };
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
    res.end(body);
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

function sendJson(req, res, status, payload, extraHeaders = {}) {
  sendBuffer(
    req,
    res,
    status,
    Buffer.from(JSON.stringify(payload), 'utf8'),
    { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
    { compress: true }
  );
}

function proxyApi(req, res, reqUrl) {
  const target = reqUrl.pathname + reqUrl.search;
  const hit = apiCache.get(target);
  if (hit && hit.expires > Date.now()) {
    sendJson(req, res, 200, JSON.parse(hit.body.toString('utf8')), {
      'Cache-Control': 'public, max-age=180',
      'X-Cache': 'HIT'
    });
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
    ures.on('data', (c) => chunks.push(c));
    ures.on('end', () => {
      const body = Buffer.concat(chunks);
      const ok = ures.statusCode >= 200 && ures.statusCode < 300;
      if (ok) {
        apiCache.set(target, { body, expires: Date.now() + API_TTL });
        if (apiCache.size > 400) {
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
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': ok ? 'public, max-age=180' : 'no-store',
          'X-Cache': 'MISS'
        },
        { compress: true }
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

function sendText(req, res, status, message) {
  sendBuffer(req, res, status, Buffer.from(message, 'utf8'), {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function serveFile(req, res, filePath, status = 200) {
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
      { compress: COMPRESSIBLE.has(ext), csp: ext === '.html' }
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
      'Access-Control-Allow-Origin': '*',
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

  if (reqUrl.pathname.startsWith(API_PREFIX)) {
    proxyApi(req, res, reqUrl);
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
      serveFile(req, res, filePath);
      return;
    }
    if (!path.extname(relative)) {
      serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
      return;
    }
    sendText(req, res, 404, 'Not Found');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`hwto.kurd running at http://${HOST}:${PORT}`);
  console.log(`API proxy     -> https://${UPSTREAM_HOST}${API_PREFIX}TMDBCache.aspx`);
});
