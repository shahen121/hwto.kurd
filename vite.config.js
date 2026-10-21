import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import handler from "./api/tmdb.js";
import footballHandler from "./api/football.js";

function parseFirebaseTxt() {
  try {
    const filePath = path.resolve(process.cwd(), "firebase.txt");
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return {};
    const extract = (key) => {
      const m = raw.match(new RegExp(`${key}\\s*[:=]\\s*["']([^"']+)["']`, "i"));
      return m ? m[1].trim() : "";
    };
    return {
      apiKey: extract("apiKey"),
      authDomain: extract("authDomain"),
      projectId: extract("projectId"),
      storageBucket: extract("storageBucket"),
      messagingSenderId: extract("messagingSenderId"),
      appId: extract("appId"),
    };
  } catch {
    return {};
  }
}

function localTmdbProxyPlugin(env) {
  const attachMiddleware = (server) => {
    server.middlewares.use("/api/tmdb", async (req, res) => {
      if (!process.env.TMDB_TOKEN && env.TMDB_TOKEN) {
        process.env.TMDB_TOKEN = env.TMDB_TOKEN;
      }
      if (!process.env.VITE_TMDB_TOKEN && env.VITE_TMDB_TOKEN) {
        process.env.VITE_TMDB_TOKEN = env.VITE_TMDB_TOKEN;
      }
      const urlObj = new URL(req.url || "", "http://localhost");
      req.query = Object.fromEntries(urlObj.searchParams.entries());
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (obj) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
        return res;
      };
      await handler(req, res);
    });
  };

  return {
    name: "local-tmdb-proxy",
    configureServer(server) {
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server);
    },
  };
}

function localFootballProxyPlugin(env) {
  const attachMiddleware = (server) => {
    server.middlewares.use("/api/football", async (req, res) => {
      if (!process.env.API_FOOTBALL_KEY && env.API_FOOTBALL_KEY) {
        process.env.API_FOOTBALL_KEY = env.API_FOOTBALL_KEY;
      }
      const urlObj = new URL(req.url || "", "http://localhost");
      req.query = Object.fromEntries(urlObj.searchParams.entries());
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (obj) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(obj));
        return res;
      };
      await footballHandler(req, res);
    });
  };

  return {
    name: "local-api-football-proxy",
    configureServer(server) {
      attachMiddleware(server);
    },
    configurePreviewServer(server) {
      attachMiddleware(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const fbFromTxt = parseFirebaseTxt();
  const isDist = process.env.ELECTRON_DIST === "1";

  const defineEnv = {};
  if (fbFromTxt.apiKey && !env.VITE_FIREBASE_API_KEY) {
    defineEnv["import.meta.env.VITE_FIREBASE_API_KEY"] = JSON.stringify(
      fbFromTxt.apiKey,
    );
    defineEnv["import.meta.env.VITE_FIREBASE_AUTH_DOMAIN"] = JSON.stringify(
      fbFromTxt.authDomain,
    );
    defineEnv["import.meta.env.VITE_FIREBASE_PROJECT_ID"] = JSON.stringify(
      fbFromTxt.projectId,
    );
    defineEnv["import.meta.env.VITE_FIREBASE_STORAGE_BUCKET"] = JSON.stringify(
      fbFromTxt.storageBucket,
    );
    defineEnv["import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID"] =
      JSON.stringify(fbFromTxt.messagingSenderId);
    defineEnv["import.meta.env.VITE_FIREBASE_APP_ID"] = JSON.stringify(
      fbFromTxt.appId,
    );
  }

  return {
    plugins: [react(), localTmdbProxyPlugin(env), localFootballProxyPlugin(env)],
    base: "./",
    define: defineEnv,
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: isDist,
          drop_debugger: isDist,
        },
      },
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
            settings: ["./src/pages/SettingsPage"],
            movie: ["./src/pages/MoviePage"],
            tv: ["./src/pages/TVPage"],
            downloads: ["./src/pages/DownloadsPage"],
            sport: ["./src/pages/HwtoSportPage"],
          },
        },
      },
    },
  };
});
