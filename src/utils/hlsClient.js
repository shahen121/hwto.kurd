import { isElectron } from "./storage";

/**
 * Resolves the authorized HLS stream URL for movie or TV episode,
 * routing through Electron IPC on Desktop or /api/hls on Web (Vercel).
 */
export async function fetchAuthorizedHlsStream({
  type,
  id,
  season = 0,
  episode = 0,
}) {
  // 1. Desktop Electron Environment
  if (isElectron && window.electron?.resolveHlsStream) {
    try {
      const res = await window.electron.resolveHlsStream({
        type,
        id,
        season: String(season || 0),
        episode: String(episode || 0),
      });

      if (res?.status === 200 && res.data?.streamUrl) {
        return {
          ok: true,
          streamUrl: res.data.streamUrl,
          subtitles: res.data.subtitles || [],
        };
      }
      return {
        ok: false,
        status: res?.status || 500,
        error: res?.error || "Failed to resolve HLS stream in Electron.",
      };
    } catch (err) {
      return {
        ok: false,
        status: 500,
        error: err?.message || "Desktop IPC error resolving HLS stream.",
      };
    }
  }

  // 2. Web / Browser Environment
  try {
    const query = new URLSearchParams({
      type,
      id: String(id),
      season: String(season || 0),
      ep: String(episode || 0),
    });

    const res = await fetch(`/api/hls?${query.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));

    if (res.ok && json.streamUrl) {
      return {
        ok: true,
        streamUrl: json.streamUrl,
        subtitles: json.subtitles || [],
      };
    }

    return {
      ok: false,
      status: res.status,
      error: json.error || `Server responded with status ${res.status}.`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err?.message || "Network error contacting HLS resolution gateway.",
    };
  }
}
