// Netlify Function: API-Football proxy (port of api/football.js).
import football from "../../api/football.js";

const { handleFootballRequest } = football;

export default async (req) => {
  const { path, ...query } = Object.fromEntries(
    new URL(req.url).searchParams.entries(),
  );
  const { status, body } = await handleFootballRequest({
    method: req.method,
    path,
    query,
    key: process.env.API_FOOTBALL_KEY,
  });
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (status === 200) {
    const ttl = path === "/fixtures" ? 30 : path === "/standings" ? 300 : 60;
    headers["Netlify-CDN-Cache-Control"] =
      `public, s-maxage=${ttl}, stale-while-revalidate=300`;
  }
  return new Response(JSON.stringify(body), { status, headers });
};

export const config = { path: "/api/football" };
