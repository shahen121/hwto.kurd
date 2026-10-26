// Netlify Function: TMDB read-only proxy (port of api/tmdb.js).
import tmdb from "../../api/tmdb.js";

const { handleTmdbRequest } = tmdb;

export default async (req) => {
  const path = new URL(req.url).searchParams.get("path");
  const { status, body } = await handleTmdbRequest({
    method: req.method,
    path,
    token: process.env.TMDB_TOKEN,
  });
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (status === 200) {
    headers["Netlify-CDN-Cache-Control"] =
      "public, s-maxage=600, stale-while-revalidate=3600";
  }
  return new Response(JSON.stringify(body), { status, headers });
};

export const config = { path: "/api/tmdb" };
