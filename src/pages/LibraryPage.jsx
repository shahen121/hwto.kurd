import { useCallback, useMemo, useState, useEffect } from "react";
import MediaCard from "../components/MediaCard";
import { imgUrl } from "../utils/api";
import { BookmarkIcon, HistoryIcon, WatchedIcon } from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage, STORAGE_KEYS } from "../utils/storage";
import { getLocale, t } from "../utils/i18n";

export default function LibraryPage({
  history = [],
  inProgress = [],
  saved = [],
  progress = {},
  onSelect,
  watched = {},
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
}) {
  const allItems = useMemo(
    () => [...inProgress, ...saved],
    [inProgress, saved],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  // Tab State: "saved" (المحفوظات) | "history" (سجل المشاهدة)
  const [activeTab, setActiveTab] = useState(() => {
    const cached = storage.get("hwto_library_active_tab");
    if (cached === "saved" || cached === "history") return cached;
    return saved.length > 0 ? "saved" : "history";
  });

  const handleSelectTab = (tab) => {
    setActiveTab(tab);
    storage.set("hwto_library_active_tab", tab);
  };

  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );
  useEffect(() => {
    const handler = (e) => setSort(e.detail);
    window.addEventListener("hwto:library-sort-changed", handler);
    return () =>
      window.removeEventListener("hwto:library-sort-changed", handler);
  }, []);

  const sortLabels = {
    manual: t("libraryCustomOrder"),
    title: "A-Z",
    rating: t("libraryTopRated"),
    year: t("libraryNewestFirst"),
  };

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );
  const itemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  return (
    <div className="fade-in library-page-container">
      <div className="library-header">
        <div className="library-title">{t("savedAndHistory")}</div>
        <div className="library-sub">{t("librarySub")}</div>

        {/* Coordinated Segmented Tabs */}
        <div className="library-tabs-nav">
          <button
            type="button"
            className={`library-tab-btn ${activeTab === "saved" ? "active" : ""}`}
            onClick={() => handleSelectTab("saved")}
          >
            <BookmarkIcon />
            <span>{t("savedTab")}</span>
            <span className="library-tab-count">{saved.length}</span>
          </button>

          <button
            type="button"
            className={`library-tab-btn ${activeTab === "history" ? "active" : ""}`}
            onClick={() => handleSelectTab("history")}
          >
            <HistoryIcon />
            <span>{t("historyTab")}</span>
            <span className="library-tab-count">
              {history.length + inProgress.length}
            </span>
          </button>
        </div>
      </div>

      {/* ── TAB 1: SAVED (المحفوظات) ── */}
      {activeTab === "saved" && (
        <div className="library-tab-content fade-in">
          {saved.length > 0 ? (
            <div className="library-section">
              <div className="library-section-title">
                {t("watchlist")} ({saved.length})
                {sort !== "manual" && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "var(--text3)",
                      marginInlineStart: 10,
                    }}
                  >
                    {sortLabels[sort]}
                  </span>
                )}
              </div>
              <div className="cards-grid">
                {saved.map((item) => {
                  const r = getRating(item);
                  const restr = itemRestricted(item);
                  return (
                    <MediaCard
                      key={`${item.media_type}_${item.id}`}
                      item={item}
                      onClick={() => onSelect(item)}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={r.cert}
                      restricted={restr}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="library-empty-state">
              <div className="library-empty-icon">
                <BookmarkIcon />
              </div>
              <h3 className="library-empty-title">{t("noSavedYet")}</h3>
              <p className="library-empty-desc">{t("noSavedYetDesc")}</p>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: HISTORY (سجل المشاهدة) ── */}
      {activeTab === "history" && (
        <div className="library-tab-content fade-in">
          {inProgress.length > 0 && (
            <div className="library-section">
              <div className="library-section-title">
                {t("continueWatching")} ({inProgress.length})
              </div>
              <div className="cards-grid">
                {inProgress.map((item) => {
                  const pk =
                    item.media_type === "movie"
                      ? `movie_${item.id}`
                      : `tv_${item.id}_s${item.season}e${item.episode}`;
                  const r = getRating(item);
                  const restr = itemRestricted(item);
                  return (
                    <MediaCard
                      key={pk}
                      item={item}
                      onClick={() => onSelect(item)}
                      progress={progress[pk] || 0}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={r.cert}
                      restricted={restr}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="library-section">
              <div className="library-section-title">
                {t("watchHistoryTitle")} ({history.length})
              </div>
              <div className="history-rows">
                {history.map((item) => {
                  const pk =
                    item.media_type === "movie"
                      ? `movie_${item.id}`
                      : `tv_${item.id}_s${item.season}e${item.episode}`;
                  const isWatched = !!watched?.[pk];
                  return (
                    <div
                      key={`${pk}_${item.watchedAt}`}
                      className="history-row"
                      onClick={() => onSelect(item)}
                    >
                      <div className="history-thumb">
                        {item.poster_path && (
                          <img src={imgUrl(item.poster_path, "w92")} alt="" />
                        )}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          {item.title}
                          {isWatched && <WatchedIcon size={16} />}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text3)" }}>
                          {item.media_type === "tv" &&
                            item.season != null &&
                            item.episode != null && (
                              <>
                                {`S${item.season}E${item.episode}`}
                                {item.episodeName ? ` · ${item.episodeName}` : ""}
                                {" · "}
                              </>
                            )}
                          {new Date(item.watchedAt).toLocaleDateString(
                            getLocale(),
                            {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </div>
                      </div>
                      <span
                        className={`search-result-type ${item.media_type === "tv" ? "type-tv" : "type-movie"}`}
                      >
                        {item.media_type === "tv"
                          ? t("seriesTag")
                          : t("movieTag")}
                      </span>
                      {onRemoveHistory && (
                        <button
                          className="history-remove-btn"
                          title={t("removeFromHistory")}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveHistory(item);
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {history.length === 0 && inProgress.length === 0 && (
            <div className="library-empty-state">
              <div className="library-empty-icon">
                <HistoryIcon />
              </div>
              <h3 className="library-empty-title">{t("noHistoryYet")}</h3>
              <p className="library-empty-desc">{t("noHistoryYetDesc")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
