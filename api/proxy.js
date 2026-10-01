/**
 * Vercel serverless proxy for kurdcinama.com TMDB cache API.
 *
 * Replaces the vercel.json rewrite (which sent no headers → 403 from upstream).
 * vercel.json rewrites /api/:path* to /api/proxy?path=:path* and the original
 * query string is preserved. This function rebuilds the upstream URL and
 * forwards a minimal fixed header set.
 */

const UPSTREAM = 'https://kurdcinama.com';
const API_TIMEOUT = 20000;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const urlPath = url.searchParams.get('path') || 'TMDBCache.aspx';

  // Rebuild query string from remaining params (path is stripped)
  const params = new URLSearchParams(url.search);
  params.delete('path');
  const search = params.toString();
  const searchSuffix = search ? `?${search}` : '';

  const upstreamPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
  const upstreamUrl = `${UPSTREAM}/api${upstreamPath}${searchSuffix}`;

  const headers = {
    'Accept': 'application/json',
    'Accept-Encoding': 'identity',
    'User-Agent': 'hwto-kurd-proxy/1.0'
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal
    });

    const body = await upstreamRes.text();
    const ok = upstreamRes.status >= 200 && upstreamRes.status < 300;

    res.status(upstreamRes.status);
    res.setHeader(
      'Content-Type',
      upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8'
    );
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', ok ? 's-maxage=180, stale-while-revalidate=60' : 'no-store');
    res.send(body);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    res.status(502).json({
      error: aborted ? 'انتهت مهلة الاتصال بخادم البيانات' : 'تعذّر الوصول إلى خادم البيانات، حاول مجدداً'
    });
  } finally {
    clearTimeout(timer);
  }
}
