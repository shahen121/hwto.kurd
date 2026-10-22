import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchAnimeNews,
  fetchAnimeSchedule,
  normalizeCatalog,
  parseAnimeNewsFeed,
} from "./animeApi.js";

async function withApiMock(fetchMock, run) {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.fetch = fetchMock;
  globalThis.window = { setTimeout: (callback) => callback() };
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

test("Kitsu catalog uses the returned genre relationships instead of fake genres", () => {
  const result = normalizeCatalog(
    {
      data: {
        data: [
          {
            id: "123",
            attributes: {
              canonicalTitle: "Test Anime",
              startDate: "2025-04-01",
              subtype: "TV",
            },
            relationships: {
              genres: {
                data: [{ id: "1", type: "genres" }],
              },
            },
          },
        ],
        included: [
          {
            id: "1",
            type: "genres",
            attributes: { name: "Action" },
          },
        ],
        links: { next: "https://kitsu.io/api/edge/anime?page[offset]=24" },
      },
    },
    "kitsu",
    1,
    { genre: "" },
  );

  assert.deepEqual(result.genres, ["Action"]);
  assert.deepEqual(result.results[0].genres, ["Action"]);
  assert.equal(result.results[0].title.english, "Test Anime");
  assert.equal(result.hasNextPage, true);
});

test("AniList catalog normalizes the GraphQL response envelope returned by the API", () => {
  const result = normalizeCatalog(
    {
      data: {
        data: {
          GenreCollection: ["Action"],
          Page: {
            pageInfo: { hasNextPage: true },
            media: [
              {
                id: 42,
                title: { romaji: "Example Anime" },
                genres: ["Action"],
                season: "FALL",
              },
            ],
          },
        },
      },
    },
    "anilist",
    1,
    { genre: "" },
  );

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title.romaji, "Example Anime");
  assert.deepEqual(result.genres, ["Action"]);
  assert.equal(result.hasNextPage, true);
});

test("Kitsu genre filtering removes entries without the selected relationship", () => {
  const result = normalizeCatalog(
    {
      data: {
        data: [
          {
            id: "1",
            attributes: { canonicalTitle: "Action show" },
            relationships: { genres: { data: [{ id: "a" }] } },
          },
          {
            id: "2",
            attributes: { canonicalTitle: "Drama show" },
            relationships: { genres: { data: [{ id: "d" }] } },
          },
        ],
        included: [
          { id: "a", type: "genres", attributes: { name: "Action" } },
          { id: "d", type: "genres", attributes: { name: "Drama" } },
        ],
        links: {},
      },
    },
    "kitsu",
    1,
    { genre: "Action" },
  );

  assert.deepEqual(result.results.map((anime) => anime.title.english), ["Action show"]);
  assert.deepEqual(result.genres, ["Action", "Drama"]);
});

test("anime schedule loads every page until AniList has no more results", async () => {
  await withApiMock(async (_, options) => {
    const page = JSON.parse(options.body).variables.page;
    return {
      ok: true,
      json: async () => ({
        data: {
          Page: {
            pageInfo: { hasNextPage: page < 6 },
            airingSchedules: [{
              id: page,
              airingAt: 1_800_000_000 + page,
              episode: page,
              media: { id: page, title: { romaji: `Anime ${page}` } },
            }],
          },
        },
      }),
    };
  }, async () => {
    const schedule = await fetchAnimeSchedule(7);
    assert.equal(schedule.length, 6);
    assert.equal(schedule[5].id, 6);
  });
});

test("anime news keeps available stories when one Jikan request fails", async () => {
  await withApiMock(async (url) => {
    if (new URL(url).hostname === "www.animenewsnetwork.com") {
      throw new Error("RSS unavailable");
    }
    const id = Number(new URL(url).pathname.match(/anime\/(\d+)\/news/)[1]);
    if (id === 2) {
      return { ok: false, status: 503, json: async () => ({ message: "Unavailable" }) };
    }
    return {
      ok: true,
      json: async () => ({
        data: [{
          url: `https://example.test/${id}`,
          title: `News for ${id}`,
          date: "2026-10-22T00:00:00+00:00",
        }],
      }),
    };
  }, async () => {
    const news = await fetchAnimeNews([
      { idMal: 1, title: { romaji: "Anime One" } },
      { idMal: 2, title: { romaji: "Anime Two" } },
      { idMal: 3, title: { romaji: "Anime Three" } },
    ]);
    assert.deepEqual(news.items.map((item) => item.title), ["News for 1", "News for 3"]);
    assert.deepEqual(news.items.map((item) => item.animeTitle), ["Anime One", "Anime Three"]);
  });
});

test("anime RSS news parses article content and pages through the full feed", async () => {
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Anime &amp; friends</title><link>https://example.test/1</link><description>Story &lt;details&gt;</description><pubDate>Thu, 22 Oct 2026 00:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Second article]]></title><link>https://example.test/2</link><description>Another story</description><pubDate>Wed, 21 Oct 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  await withApiMock(async (url) => {
    assert.match(url, /animenewsnetwork\.com/);
    return { ok: true, text: async () => rss };
  }, async () => {
    const firstPage = await fetchAnimeNews([], { limit: 1 });
    const secondPage = await fetchAnimeNews([], { offset: 1, limit: 1 });
    assert.equal(firstPage.items[0].title, "Anime & friends");
    assert.equal(firstPage.items[0].excerpt, "Story <details>");
    assert.equal(firstPage.hasMore, true);
    assert.equal(secondPage.items[0].title, "Second article");
    assert.equal(secondPage.hasMore, false);
  });
  assert.equal(parseAnimeNewsFeed(null).length, 0);
});

test("anime news uses the allowed Electron RSS request path", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const rss = "<rss><item><title>News</title><link>https://example.test/news</link></item></rss>";
  globalThis.fetch = () => {
    throw new Error("Renderer fetch should not be used.");
  };
  globalThis.window = {
    setTimeout: (callback) => callback(),
    electron: {
      animeRequest: async ({ provider, path, method }) => {
        assert.equal(provider, "ann");
        assert.equal(path, "all/rss.xml?ann-edition=us");
        assert.equal(method, "GET");
        return { ok: true, data: rss };
      },
    },
  };
  try {
    const result = await fetchAnimeNews([]);
    assert.equal(result.items[0].title, "News");
    assert.equal(result.items[0].source, "Anime News Network");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
