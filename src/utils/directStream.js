const DEFAULT_WORKER_URL = "https://hwto.proteome626.workers.dev";

export function getWorkerUrl() {
  const fromEnv =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_CF_WORKER_URL;
  return String(fromEnv || DEFAULT_WORKER_URL).replace(/\/+$/, "");
}

export function buildExtractUrl({
  type,
  id,
  season = 0,
  episode = 0,
  serverKey,
  workerUrl = getWorkerUrl(),
}) {
  const q = new URLSearchParams({
    type: String(type),
    id: String(id),
    s: String(season || 0),
    e: String(episode || 0),
    server: String(serverKey || ""),
  });
  return `${workerUrl}/extract?${q.toString()}`;
}

function pickStreamUrl(json) {
  if (!json || typeof json !== "object") return null;
  const candidate = json.streamUrl || json.url || json.m3u8 || json.stream;
  return typeof candidate === "string" && /^https?:\/\//i.test(candidate)
    ? candidate
    : null;
}

/**
 * Resolve a raw HLS stream URL for a movie/episode.
 * 1. Cloudflare Worker `/extract` endpoint.
 * 2. Optional `fallbackResolver` (e.g. the existing /api/hls resolver).
 * Never throws; returns `{ ok: false }` when nothing could be resolved so the
 * caller can fall back gracefully.
 */
export async function fetchExtractedStream(
  params,
  { fetchImpl = globalThis.fetch, fallbackResolver = null, timeoutMs = 12000 } = {},
) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(buildExtractUrl(params), {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        const streamUrl = pickStreamUrl(json);
        if (streamUrl) return { ok: true, streamUrl, source: "worker" };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // fall through to fallback
  }

  if (fallbackResolver) {
    try {
      const res = await fallbackResolver({
        type: params.type,
        id: params.id,
        season: params.season || 0,
        episode: params.episode || 0,
      });
      if (res?.ok && res.streamUrl) {
        return { ok: true, streamUrl: res.streamUrl, source: "fallback" };
      }
    } catch {
      // ignore
    }
  }
  return { ok: false, error: "stream-not-found" };
}
