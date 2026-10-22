const { ipcMain } = require("electron");

const CACHE_TTL = 60 * 60 * 1000;
const CACHE_LIMIT = 200;
const cache = new Map();
const PROVIDER_BASES = {
  anilist: "https://graphql.anilist.co",
  kitsu: "https://kitsu.io/api/edge/",
  jikan: "https://api.jikan.moe/v4/",
  ann: "https://www.animenewsnetwork.com/",
};

function register() {
  ipcMain.handle("clear-anime-cache", () => {
    cache.clear();
    return true;
  });

  ipcMain.handle("anime-request", async (_, request = {}) => {
    const base = PROVIDER_BASES[request.provider];
    if (!base || typeof request.path !== "string") {
      return { ok: false, error: "Unsupported anime data request." };
    }

    const method = request.provider === "anilist" ? "POST" : "GET";
    if (request.method && request.method !== method) {
      return { ok: false, error: "Unsupported anime data request method." };
    }
    const url = new URL(request.path, base);
    if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) {
      return { ok: false, error: "Unsupported anime data request path." };
    }

    const cacheKey = `${request.provider}:${method}:${url.href}:${JSON.stringify(request.body || {})}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      cache.delete(cacheKey);
      cache.set(cacheKey, cached);
      return { ...cached.value, cached: true };
    }
    if (cached) cache.delete(cacheKey);

    try {
      const response = await fetch(url.href, {
        method,
        headers: {
          Accept: "application/json",
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(request.body || {}) } : {}),
        signal: AbortSignal.timeout(request.provider === "jikan" ? 5_000 : 12_000),
      });
      const data = request.provider === "ann"
        ? await response.text()
        : await response.json().catch(() => null);
      const value = response.ok
        ? { ok: true, status: response.status, data }
        : {
            ok: false,
            status: response.status,
            error:
              data?.errors?.[0]?.message ||
              data?.message ||
              `Anime data request failed (${response.status}).`,
          };

      if (value.ok && !(request.provider === "anilist" && data?.errors?.length)) {
        cache.set(cacheKey, { time: Date.now(), value });
        if (cache.size > CACHE_LIMIT) {
          cache.delete(cache.keys().next().value);
        }
      }
      return value;
    } catch (error) {
      const message = /timeout|timed out/i.test(error?.message || "")
        ? `${request.provider} request timed out.`
        : error.message || "Anime data service is unavailable.";
      return { ok: false, error: message };
    }
  });
}

module.exports = { register };
