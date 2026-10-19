/**
 * lib/security-policy.mjs — single source of truth for the response hardening
 * that the dev server sends (server.js) and the values mirrored in vercel.json
 * for production (Vercel serves /public statically, so server.js never runs for
 * the HTML there). scripts/check.js compares the two copies, so drifting one
 * without the other fails the gate instead of silently weakening production.
 */

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export const HSTS = 'max-age=31536000; includeSubDomains';

/**
 * MD-3: narrow policy — no 'unsafe-eval' anywhere, connect-src is same-origin
 * (every browser fetch goes through public/js/api.js), and no plaintext frames.
 * frame-src keeps https: because the alternate embed providers are configured at
 * runtime; player frames do their own networking under their own origin.
 */
export const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "frame-src 'self' https:",
  "connect-src 'self' blob:",
  "media-src 'self' blob: https:",
  "manifest-src 'self'"
].join('; ');

/** Subtitle files are read cross-origin (the embed player fetches our sub_file). */
export const SUBTITLE_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cross-Origin-Resource-Policy': 'cross-origin'
};
