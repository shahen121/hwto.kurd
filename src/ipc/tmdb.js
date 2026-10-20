// ── IPC: TMDB Proxy for Electron desktop (file:// protocol) ────────────────────
const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const { restoreEnglishMetadata } = require("./tmdbResponse");

const TMDB_BASE = "https://api.themoviedb.org/3";
let cachedToken = null;

function getTmdbToken() {
  if (cachedToken) return cachedToken;
  if (process.env.TMDB_TOKEN) {
    cachedToken = process.env.TMDB_TOKEN.trim();
    return cachedToken;
  }
  // Fallback: read .env from workspace or app path
  try {
    const envPaths = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(__dirname, "../../.env"),
      path.resolve(__dirname, "../.env"),
    ];
    for (const p of envPaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf8");
        const m = content.match(/TMDB_TOKEN\s*=\s*(.*)/i);
        if (m && m[1]) {
          cachedToken = m[1].trim();
          return cachedToken;
        }
      }
    }
  } catch {}
  return "";
}

function register() {
  ipcMain.handle("tmdb-proxy", async (_, reqPath) => {
    const token = getTmdbToken();
    if (!token) {
      return {
        ok: false,
        status: 500,
        error: "TMDB_TOKEN is not configured in .env",
      };
    }
    const cleanPath = (reqPath || "").startsWith("/") ? reqPath : `/${reqPath}`;
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      };

      const isNonEnglish =
        !cleanPath.includes("language=en") &&
        /language=[a-zA-Z-]+/.test(cleanPath);
      if (isNonEnglish) {
        const enPath = cleanPath.replace(/language=[^&]+/, "language=en-US");
        const [upstream, enUpstream] = await Promise.all([
          fetch(`${TMDB_BASE}${cleanPath}`, { headers }),
          fetch(`${TMDB_BASE}${enPath}`, { headers }).catch(() => null),
        ]);
        const data = await upstream.json().catch(() => ({}));
        const enData = enUpstream
          ? await enUpstream.json().catch(() => ({}))
          : null;

        const isKurdish =
          /[?&]language=(?:ku|ku-TR|ckb)(?:&|$)/.test(cleanPath);
        restoreEnglishMetadata(data, enData, {
          includeOverview: isKurdish,
        });

        if (!upstream.ok) {
          return {
            ok: false,
            status: upstream.status,
            error: data?.status_message || `TMDB error ${upstream.status}`,
          };
        }
        return { ok: true, status: 200, data };
      }

      const upstream = await fetch(`${TMDB_BASE}${cleanPath}`, { headers });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return {
          ok: false,
          status: upstream.status,
          error: data?.status_message || `TMDB error ${upstream.status}`,
        };
      }
      return { ok: true, status: 200, data };
    } catch (err) {
      return {
        ok: false,
        status: 502,
        error: err?.message || "TMDB unreachable",
      };
    }
  });
}

module.exports = { register };
