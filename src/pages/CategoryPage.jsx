import { useState, useEffect, useCallback, useMemo } from "react";
import { tmdbFetch, imgUrl } from "../utils/api";
import MediaCard from "../components/MediaCard";
import { PlayIcon, BookmarkIcon, StarIcon } from "../components/Icons";
import { TOP_CATEGORIES } from "../components/TopCategoryBar";
import { t, isRTL } from "../utils/i18n";

const SORT_OPTIONS = [
  { id: "popularity.desc", labelKey: "mostPopular" },
  { id: "vote_average.desc", labelKey: "topRated" },
  { id: "release_date.desc", labelKey: "newest" },
];

function buildCategoryEndpoints(categoryId, mediaFilter, sortBy, page) {
  const today = new Date().toISOString().slice(0, 10);
  const tvSort =
    sortBy === "release_date.desc" ? "first_air_date.desc" : sortBy;
  const movieSort =
    sortBy === "release_date.desc" ? "primary_release_date.desc" : sortBy;
  const minVotes = sortBy === "vote_average.desc" ? "&vote_count.gte=150" : "";

  switch (categoryId) {
    case "movies":
      return [
        {
          mediaType: "movie",
          path: `/discover/movie?sort_by=${movieSort}&release_date.lte=${today}${minVotes}&page=${page}`,
        },
      ];

    case "series":
      return [
        {
          mediaType: "tv",
          path: `/discover/tv?sort_by=${tvSort}&first_air_date.lte=${today}${minVotes}&page=${page}`,
        },
      ];

    case "new":
      if (mediaFilter === "movie") {
        return [
          {
            mediaType: "movie",
            path: `/movie/now_playing?page=${page}`,
          },
        ];
      }
      if (mediaFilter === "tv") {
        return [
          {
            mediaType: "tv",
            path: `/tv/on_the_air?page=${page}`,
          },
        ];
      }
      return [
        {
          mediaType: "all",
          path: `/trending/all/day?page=${page}`,
        },
      ];

    case "anime": {
      const targetType = mediaFilter === "movie" ? "movie" : "tv";
      const s = targetType === "movie" ? movieSort : tvSort;
      return [
        {
          mediaType: targetType,
          path: `/discover/${targetType}?with_genres=16&with_original_language=ja&sort_by=${s}${minVotes}&page=${page}`,
        },
      ];
    }

    case "asian": {
      const targetType = mediaFilter === "movie" ? "movie" : "tv";
      const s = targetType === "movie" ? movieSort : tvSort;
      return [
        {
          mediaType: targetType,
          path: `/discover/${targetType}?with_original_language=ko|zh|th&without_genres=16&sort_by=${s}${minVotes}&page=${page}`,
        },
      ];
    }

    case "indian": {
      const targetType = mediaFilter === "tv" ? "tv" : "movie";
      const s = targetType === "movie" ? movieSort : tvSort;
      return [
        {
          mediaType: targetType,
          path: `/discover/${targetType}?with_original_language=hi|ta|te|ml&sort_by=${s}${minVotes}&page=${page}`,
        },
      ];
    }

    case "turkish": {
      const targetType = mediaFilter === "movie" ? "movie" : "tv";
      const s = targetType === "movie" ? movieSort : tvSort;
      return [
        {
          mediaType: targetType,
          path: `/discover/${targetType}?with_original_language=tr&sort_by=${s}${minVotes}&page=${page}`,
        },
      ];
    }

    default:
      return [
        {
          mediaType: "movie",
          path: `/discover/movie?sort_by=${movieSort}&page=${page}`,
        },
      ];
  }
}

export default function CategoryPage({
  categoryId,
  apiKey,
  onSelect,
  watchlist = [],
  toggleWatchlist,
  watchProgress = {},
  watched = {},
  onMarkWatched,
  onMarkUnwatched,
}) {
  const categoryMeta = useMemo(
    () =>
      TOP_CATEGORIES.find((c) => c.id === categoryId) || {
        id: categoryId,
        labelKey: "category",
        subtitleKey: "",
        defaultMediaType: "movie",
      },
    [categoryId],
  );

  const supportsTypeToggle = !["movies", "series"].includes(categoryId);

  const [mediaFilter, setMediaFilter] = useState(
    categoryMeta.defaultMediaType || "movie",
  );
  const [sortBy, setSortBy] = useState("popularity.desc");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Reset filters when switching category
  useEffect(() => {
    const defType =
      TOP_CATEGORIES.find((c) => c.id === categoryId)?.defaultMediaType ||
      "movie";
    setMediaFilter(defType);
    setSortBy("popularity.desc");
  }, [categoryId]);

  const fetchPageData = useCallback(
    async (targetPage, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setError(null);
      }

      try {
        const endpoints = buildCategoryEndpoints(
          categoryId,
          mediaFilter,
          sortBy,
          targetPage,
        );
        const responses = await Promise.all(
          endpoints.map((ep) => tmdbFetch(ep.path, apiKey)),
        );

        let fetched = [];
        let maxTotalPages = 1;

        responses.forEach((data, idx) => {
          const fallbackType = endpoints[idx].mediaType;
          if (data?.total_pages) {
            maxTotalPages = Math.max(
              maxTotalPages,
              Math.min(data.total_pages, 500),
            );
          }
          const list = (data?.results || [])
            .filter((item) => item && item.media_type !== "person")
            .map((item) => ({
              ...item,
              media_type:
                item.media_type ||
                (fallbackType === "all"
                  ? item.first_air_date
                    ? "tv"
                    : "movie"
                  : fallbackType),
            }));
          fetched = fetched.concat(list);
        });

        setTotalPages(maxTotalPages);
        setPage(targetPage);

        setItems((prev) => {
          const base = append ? prev : [];
          const seen = new Set(base.map((x) => `${x.media_type}_${x.id}`));
          const merged = [...base];
          for (const item of fetched) {
            const key = `${item.media_type}_${item.id}`;
            if (!seen.has(key) && item.poster_path) {
              seen.add(key);
              merged.push(item);
            }
          }
          return merged;
        });
      } catch (err) {
        setError(t("errorLoading"));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [categoryId, mediaFilter, sortBy, apiKey],
  );

  useEffect(() => {
    fetchPageData(1, false);
  }, [fetchPageData]);

  const handleLoadMore = () => {
    if (loadingMore || page >= totalPages) return;
    fetchPageData(page + 1, true);
  };

  const featuredItem = useMemo(
    () => items.find((item) => item.backdrop_path) || items[0] || null,
    [items],
  );

  const inWatchlist = featuredItem
    ? watchlist.some(
        (w) =>
          w.id === featuredItem.id && w.media_type === featuredItem.media_type,
      )
    : false;

  return (
    <div className="category-page fade-in">
      {/* ── Featured Category Hero Banner ── */}
      {featuredItem && !loading && (
        <div className="cat-hero">
          <div
            className="cat-hero-bg"
            style={{
              backgroundImage: featuredItem.backdrop_path
                ? `url(${imgUrl(featuredItem.backdrop_path, "w1280")})`
                : "none",
            }}
          />
          <div className="cat-hero-gradient" />

          <div className="cat-hero-content" dir={isRTL() ? "rtl" : "ltr"}>
            <div className="cat-hero-kicker">
              <span className="cat-hero-badge">
                {t(categoryMeta.labelKey)}
              </span>
              <span className="cat-hero-sub-label">{t("featuredInCategory")}</span>
            </div>

            <h1 className="cat-hero-title">
              {featuredItem.title || featuredItem.name}
            </h1>

            <div className="cat-hero-meta" dir="ltr">
              {featuredItem.vote_average > 0 && (
                <span className="hero-rating">
                  <StarIcon /> {featuredItem.vote_average.toFixed(1)}
                </span>
              )}
              <span>
                {(
                  featuredItem.release_date ||
                  featuredItem.first_air_date ||
                  ""
                ).slice(0, 4)}
              </span>
              <span className="cat-type-chip">
                {featuredItem.media_type === "tv"
                  ? t("seriesTag")
                  : t("movieTag")}
              </span>
            </div>

            {featuredItem.overview && (
              <p className="cat-hero-overview">{featuredItem.overview}</p>
            )}

            <div className="cat-hero-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onSelect(featuredItem)}
              >
                <PlayIcon /> {t("watchNow")}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => toggleWatchlist?.(featuredItem)}
              >
                <BookmarkIcon filled={inWatchlist} />
                {inWatchlist ? t("inWatchlist") : t("addToWatchlist")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Category Header & Filter Controls ── */}
      <div className="cat-controls-wrap" dir={isRTL() ? "rtl" : "ltr"}>
        <div className="cat-header-info">
          <h2 className="cat-page-title">
            {t(categoryMeta.labelKey)}
          </h2>
          <p className="cat-page-subtitle">
            {categoryMeta.subtitleKey ? t(categoryMeta.subtitleKey) : ""}
          </p>
        </div>

        <div className="cat-filters">
          {supportsTypeToggle && (
            <div className="cat-filter-group">
              {categoryId === "new" && (
                <button
                  type="button"
                  className={`cat-filter-btn ${mediaFilter === "all" ? "active" : ""}`}
                  onClick={() => setMediaFilter("all")}
                >
                  {t("all")}
                </button>
              )}
              <button
                type="button"
                className={`cat-filter-btn ${mediaFilter === "movie" ? "active" : ""}`}
                onClick={() => setMediaFilter("movie")}
              >
                {t("movies")}
              </button>
              <button
                type="button"
                className={`cat-filter-btn ${mediaFilter === "tv" ? "active" : ""}`}
                onClick={() => setMediaFilter("tv")}
              >
                {t("series")}
              </button>
            </div>
          )}

          {categoryId !== "new" && (
            <div className="cat-sort-group">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`cat-sort-btn ${sortBy === opt.id ? "active" : ""}`}
                  onClick={() => setSortBy(opt.id)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Content Grid ── */}
      <div className="cat-grid-section">
        {loading ? (
          <div className="loading-center">
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">{t("errorLoading")}</div>
            <div className="empty-state-sub">{error}</div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => fetchPageData(1, false)}
            >
              {t("retry")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">{t("noResults")}</div>
          </div>
        ) : (
          <>
            <div className="cards-grid cat-cards-grid">
              {items.map((item) => {
                const progKey = `${item.media_type}_${item.id}`;
                return (
                  <MediaCard
                    key={progKey}
                    item={item}
                    onClick={() => onSelect(item)}
                    progress={watchProgress[progKey]}
                    watched={watched}
                    onMarkWatched={onMarkWatched}
                    onMarkUnwatched={onMarkUnwatched}
                  />
                );
              })}
            </div>

            {/* ── Load More Button ("عرض المزيد") ── */}
            {page < totalPages && (
              <div className="load-more-container">
                <button
                  type="button"
                  className="load-more-btn"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <span className="load-more-spinner" />
                      <span>{t("loading")}</span>
                    </>
                  ) : (
                    <span>{t("loadMore")}</span>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
