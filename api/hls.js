import {
  checkRateLimit,
  isSafeUrl,
  resolveAuthorizedHls,
  FETCH_TIMEOUT_MS,
  MAX_PROXY_SIZE_BYTES,
} from "../src/lib/hlsCore.js";

export default async function handler(req, res) {
  // Always prevent public or browser caching of signed stream responses
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1. IP Rate Limiting (60 requests / minute)
  const clientIp =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  const rateLimit = checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfter || 60));
    return res.status(429).json({
      error: "Rate limit exceeded. Please retry in a few moments.",
      retryAfter: rateLimit.retryAfter,
    });
  }

  // 2. Optional Proxy Mode (Disabled by default, requires HLS_ENABLE_PROXY=true)
  const proxyTarget = req.query?.proxy;
  if (proxyTarget) {
    if (process.env.HLS_ENABLE_PROXY !== "true") {
      return res.status(403).json({
        error: "Media proxy is disabled. Direct segment delivery is required.",
      });
    }

    const safe = await isSafeUrl(proxyTarget);
    if (!safe) {
      return res.status(403).json({
        error: "Destination host is not in HLS_ALLOWED_HOSTS or is restricted.",
      });
    }

    try {
      const upstream = await fetch(proxyTarget, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          Accept: "application/vnd.apple.mpegurl, video/mp2t, */*",
        },
      });

      if (!upstream.ok) {
        return res
          .status(upstream.status)
          .json({ error: `Upstream returned status ${upstream.status}` });
      }

      const contentLength = Number(upstream.headers.get("content-length") || 0);
      if (contentLength > MAX_PROXY_SIZE_BYTES) {
        return res.status(413).json({ error: "Upstream media payload exceeds maximum size." });
      }

      const contentType = upstream.headers.get("content-type") || "application/octet-stream";
      const buffer = Buffer.from(await upstream.arrayBuffer());

      if (buffer.length > MAX_PROXY_SIZE_BYTES) {
        return res.status(413).json({ error: "Upstream media payload exceeds maximum size." });
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "private, max-age=60");
      return res.status(200).send(buffer);
    } catch {
      return res.status(502).json({ error: "Failed to proxy authorized media resource." });
    }
  }

  // 3. Manifest Resolution Mode
  const { type, id, season, ep, episode } = req.query || {};

  const result = await resolveAuthorizedHls({
    type,
    id,
    season,
    episode: ep || episode,
  });

  if (result.status === 429 && result.retryAfter) {
    res.setHeader("Retry-After", String(result.retryAfter));
  }

  if (result.status === 200) {
    return res.status(200).json({ ...result.data, cached: result.cached });
  }

  return res.status(result.status).json({
    error: result.error,
    cached: result.cached || false,
  });
}
