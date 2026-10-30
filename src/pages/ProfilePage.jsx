import { useState, useMemo, useCallback } from "react";
import { imgUrl } from "../utils/api";
import { t, isRTL } from "../utils/i18n";
import {
  BookmarkIcon,
  WatchedIcon,
  PlayIcon,
  TrashIcon,
  UserIcon,
  SyncIcon,
  FilmIcon,
  TVIcon,
  StarIcon,
} from "../components/Icons";

function formatSeconds(secs) {
  if (!secs || secs <= 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  if (m < 60) {
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}:${remM < 10 ? "0" : ""}${remM}:${s < 10 ? "0" : ""}${s}`;
}

export default function ProfilePage({
  authUser,
  onSignOut,
  saved = {},
  savedOrder = null,
  onRemoveSaved,
  history = [],
  onRemoveHistory,
  progress = {},
  watched = {},
  onMarkWatched,
  onMarkUnwatched,
  onSelect,
  onForceSync,
  syncStatus = "idle", // 'idle' | 'syncing' | 'synced' | 'error'
}) {
  const [activeTab, setActiveTab] = useState("watchlist"); // 'watchlist' | 'continue' | 'watched'
  const rtl = isRTL();

  // ── Transform saved object to list ──────────────────────────────────────────
  const watchlistItems = useMemo(() => {
    const orderedKeys = savedOrder
      ? savedOrder.filter((k) => saved[k])
      : Object.keys(saved);
    return orderedKeys
      .map((k) => {
        const item = saved[k];
        if (!item) return null;
        const isTV = item.media_type === "tv" || item.type === "tv";
        return {
          ...item,
          media_type: isTV ? "tv" : "movie",
          type: isTV ? "tv" : "movie",
          poster_path: item.poster_path || item.poster || "",
          poster: item.poster || item.poster_path || "",
        };
      })
      .filter(Boolean);
  }, [saved, savedOrder]);

  // ── Continue Watching items with progress percent ───────────────────────────
  const continueItems = useMemo(() => {
    return history
      .map((item) => {
        const isTV = item.media_type === "tv" || item.type === "tv";
        const pk = isTV
          ? item.season != null && item.episode != null
            ? `tv_${item.id}_s${item.season}e${item.episode}`
            : `tv_${item.id}`
          : `movie_${item.id}`;

        const pct = item.progressPercent ?? progress[pk] ?? 0;
        return {
          ...item,
          media_type: isTV ? "tv" : "movie",
          type: isTV ? "tv" : "movie",
          poster_path: item.poster_path || item.poster || "",
          poster: item.poster || item.poster_path || "",
          _pk: pk,
          progressPercent: Math.min(Math.max(Number(pct) || 0, 0), 100),
          isWatched: Boolean(watched[pk]),
        };
      })
      .filter((item) => !item.isWatched && item.progressPercent > 0 && item.progressPercent < 100);
  }, [history, progress, watched]);

  // ── Watched items: Combine from history and saved items that are marked watched ──
  const watchedItems = useMemo(() => {
    const list = [];
    const seen = new Set();

    // From history items
    history.forEach((h) => {
      const isTV = h.media_type === "tv" || h.type === "tv";
      const pk = isTV
        ? h.season != null && h.episode != null
          ? `tv_${h.id}_s${h.season}e${h.episode}`
          : `tv_${h.id}`
        : `movie_${h.id}`;

      if (watched[pk] && !seen.has(pk)) {
        seen.add(pk);
        list.push({
          ...h,
          media_type: isTV ? "tv" : "movie",
          type: isTV ? "tv" : "movie",
          poster_path: h.poster_path || h.poster || "",
          poster: h.poster || h.poster_path || "",
          _pk: pk,
        });
      }
    });

    // From watchlist items
    watchlistItems.forEach((s) => {
      const isTV = s.media_type === "tv" || s.type === "tv";
      const pk = `${isTV ? "tv" : "movie"}_${s.id}`;
      if (watched[pk] && !seen.has(pk)) {
        seen.add(pk);
        list.push({
          ...s,
          media_type: isTV ? "tv" : "movie",
          type: isTV ? "tv" : "movie",
          poster_path: s.poster_path || s.poster || "",
          poster: s.poster || s.poster_path || "",
          _pk: pk,
        });
      }
    });

    return list;
  }, [history, watchlistItems, watched]);

  // ── Counts for profile summary stats ──────────────────────────────────────
  const stats = useMemo(() => {
    const watchedCount = Object.keys(watched).filter((k) => watched[k]).length;
    return {
      watchlist: watchlistItems.length,
      watched: Math.max(watchedCount, watchedItems.length),
      continue: continueItems.length,
    };
  }, [watchlistItems.length, watched, watchedItems.length, continueItems.length]);

  const displayName =
    authUser?.displayName || (authUser?.isGuest ? t("guestUser") : t("user"));
  const email = authUser?.email || (authUser?.isGuest ? t("guestAccount") : "");
  const avatarLetter = (displayName || "U")[0].toUpperCase();

  return (
    <div className="fade-in profile-page-container" style={{ padding: "28px 36px", maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Top Account Header Card ── */}
      <div
        className="profile-hero-card"
        style={{
          background: "linear-gradient(135deg, rgba(36, 28, 58, 0.7) 0%, rgba(18, 14, 30, 0.95) 100%)",
          border: "1px solid var(--border)",
          borderRadius: "16px",
          padding: "32px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "24px",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(12px)",
          marginBottom: "36px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "24px", flexWrap: "wrap" }}>
          {/* Avatar */}
          <div
            style={{
              position: "relative",
              width: 88,
              height: 88,
              borderRadius: "50%",
              overflow: "hidden",
              border: "3px solid var(--red)",
              boxShadow: "0 0 20px rgba(237, 34, 123, 0.4)",
              background: "var(--hwto-gradient)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {authUser?.photoURL ? (
              <img
                src={authUser.photoURL}
                alt={displayName}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <span style={{ fontSize: 36, fontWeight: 700, color: "#fff" }}>
                {avatarLetter}
              </span>
            )}
          </div>

          {/* User Details */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                {displayName}
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: "20px",
                  backgroundColor: authUser?.isGuest ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 230, 118, 0.15)",
                  color: authUser?.isGuest ? "var(--text3)" : "#00e676",
                  border: authUser?.isGuest ? "1px solid rgba(255, 255, 255, 0.15)" : "1px solid rgba(0, 230, 118, 0.3)",
                }}
              >
                {authUser?.isGuest ? t("guestAccount") : t("googleAccount")}
              </span>
            </div>

            {email && (
              <div style={{ fontSize: 14, color: "var(--text3)", marginTop: 4 }}>
                {email}
              </div>
            )}

            {/* Quick Sync Status Pill */}
            {!authUser?.isGuest && (
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  fontSize: 12,
                  color: syncStatus === "error" ? "var(--red)" : "var(--text2)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    backgroundColor:
                      syncStatus === "syncing"
                        ? "#f59e0b"
                        : syncStatus === "error"
                          ? "#ef4444"
                          : "#10b981",
                    boxShadow:
                      syncStatus === "syncing"
                        ? "0 0 8px #f59e0b"
                        : syncStatus === "error"
                          ? "0 0 8px #ef4444"
                          : "0 0 8px #10b981",
                  }}
                />
                <span>
                  {syncStatus === "syncing"
                    ? t("syncingNow")
                    : syncStatus === "error"
                      ? t("syncError")
                      : t("syncedCloud")}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Header Actions: Sync & Auth Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {!authUser?.isGuest && onForceSync && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onForceSync}
              disabled={syncStatus === "syncing"}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", fontSize: 13 }}
            >
              <SyncIcon size={16} spinning={syncStatus === "syncing"} />
              <span>{t("syncNow")}</span>
            </button>
          )}

          {authUser?.isGuest ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSignOut}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 22px",
                fontSize: 14,
                fontWeight: 600,
                background: "linear-gradient(135deg, #ed227b 0%, #ce197b 100%)",
                boxShadow: "0 4px 15px rgba(237, 34, 123, 0.35)",
              }}
            >
              <UserIcon />
              <span>{t("signIn")}</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={onSignOut}
              style={{
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 600,
                background: "rgba(239, 68, 68, 0.12)",
                color: "#ef4444",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 8,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ef4444";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.12)";
                e.currentTarget.style.color = "#ef4444";
              }}
            >
              {t("signOut")}
            </button>
          )}
        </div>
      </div>

      {/* ── Guest Enhancement Banner ── */}
      {authUser?.isGuest && (
        <div
          style={{
            background: "linear-gradient(90deg, rgba(237, 34, 123, 0.12) 0%, rgba(36, 28, 58, 0.6) 100%)",
            border: "1px solid rgba(237, 34, 123, 0.3)",
            borderRadius: "14px",
            padding: "18px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "28px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <span style={{ fontSize: 24 }}>☁️</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
                {t("guestBannerTitle")}
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", maxWidth: 640 }}>
                {t("guestBannerDesc")}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="btn btn-primary"
            style={{
              padding: "9px 20px",
              fontSize: 13,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--hwto-gradient)",
              whiteSpace: "nowrap",
            }}
          >
            <span>{t("guestSignInAction")}</span>
          </button>
        </div>
      )}

      {/* ── Quick Stats Grid ── */}
      <div
        className="profile-stats-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 36,
        }}
      >
        <div
          onClick={() => setActiveTab("watchlist")}
          style={{
            background: activeTab === "watchlist" ? "var(--surface3)" : "var(--surface)",
            border: activeTab === "watchlist" ? "1px solid var(--red)" : "1px solid var(--border)",
            borderRadius: 12,
            padding: "20px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "rgba(237, 34, 123, 0.15)",
              color: "var(--red)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <BookmarkIcon size={24} />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
              {stats.watchlist}
            </div>
            <div style={{ fontSize: 13, color: "var(--text3)" }}>
              {t("statsWatchlist")}
            </div>
          </div>
        </div>

        <div
          onClick={() => setActiveTab("continue")}
          style={{
            background: activeTab === "continue" ? "var(--surface3)" : "var(--surface)",
            border: activeTab === "continue" ? "1px solid var(--red)" : "1px solid var(--border)",
            borderRadius: 12,
            padding: "20px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "rgba(59, 130, 246, 0.15)",
              color: "#3b82f6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <PlayIcon size={20} />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
              {stats.continue}
            </div>
            <div style={{ fontSize: 13, color: "var(--text3)" }}>
              {t("statsContinue")}
            </div>
          </div>
        </div>

        <div
          onClick={() => setActiveTab("watched")}
          style={{
            background: activeTab === "watched" ? "var(--surface3)" : "var(--surface)",
            border: activeTab === "watched" ? "1px solid var(--red)" : "1px solid var(--border)",
            borderRadius: 12,
            padding: "20px",
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "rgba(16, 185, 129, 0.15)",
              color: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <WatchedIcon size={24} />
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>
              {stats.watched}
            </div>
            <div style={{ fontSize: 13, color: "var(--text3)" }}>
              {t("statsWatched")}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div
        className="profile-tabs-nav"
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          borderBottom: "1px solid var(--border)",
          paddingBottom: 14,
          marginBottom: 28,
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab("watchlist")}
          style={{
            background: activeTab === "watchlist" ? "var(--red)" : "transparent",
            color: activeTab === "watchlist" ? "#fff" : "var(--text2)",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <BookmarkIcon size={18} />
          <span>{t("tabWatchlist")} ({watchlistItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("continue")}
          style={{
            background: activeTab === "continue" ? "var(--red)" : "transparent",
            color: activeTab === "continue" ? "#fff" : "var(--text2)",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <PlayIcon size={16} />
          <span>{t("tabContinueWatching")} ({continueItems.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("watched")}
          style={{
            background: activeTab === "watched" ? "var(--red)" : "transparent",
            color: activeTab === "watched" ? "#fff" : "var(--text2)",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.2s ease",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <WatchedIcon size={18} />
          <span>{t("tabWatched")} ({watchedItems.length})</span>
        </button>
      </div>

      {/* ── Tab Content: Watchlist ── */}
      {activeTab === "watchlist" && (
        <div>
          {watchlistItems.length === 0 ? (
            <div className="empty-state" style={{ padding: "64px 20px", textAlign: "center" }}>
              <div style={{ color: "var(--text3)", marginBottom: 16 }}>
                <BookmarkIcon size={48} />
              </div>
              <h3 style={{ fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
                {t("emptyWatchlistTitle")}
              </h3>
              <p style={{ fontSize: 14, color: "var(--text3)", maxWidth: 440, margin: "0 auto" }}>
                {t("emptyWatchlistSub")}
              </p>
            </div>
          ) : (
            <div className="cards-grid">
              {watchlistItems.map((item) => {
                const isTV = item.media_type === "tv" || item.type === "tv";
                const title = item.title || item.name;
                const poster = item.poster_path || item.poster;

                return (
                  <div
                    key={`${item.media_type || item.type}_${item.id}`}
                    className="media-card"
                    style={{ position: "relative" }}
                  >
                    <div
                      className="card-poster-wrap"
                      onClick={() => onSelect?.(item)}
                      style={{ cursor: "pointer" }}
                    >
                      {poster ? (
                        <img
                          src={imgUrl(poster, "w342")}
                          alt={title}
                          className="card-poster"
                          loading="lazy"
                        />
                      ) : (
                        <div className="card-no-poster">
                          {isTV ? <TVIcon /> : <FilmIcon />}
                        </div>
                      )}

                      <div className="card-overlay">
                        <div className="card-play-btn">
                          <PlayIcon size={20} />
                        </div>
                      </div>

                      {/* Tag Chip */}
                      <span className="card-tag">
                        {isTV ? t("seriesTag") : t("movieTag")}
                      </span>

                      {/* Remove from Watchlist button */}
                      <button
                        type="button"
                        className="card-remove-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSaved?.(item);
                        }}
                        title={t("removeFromWatchlist")}
                        style={{
                          position: "absolute",
                          top: 8,
                          left: rtl ? "auto" : 8,
                          right: rtl ? 8 : "auto",
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: "rgba(0, 0, 0, 0.75)",
                          color: "#ef4444",
                          border: "1px solid rgba(239, 68, 68, 0.4)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          zIndex: 5,
                          transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.transform = "scale(1.1)";
                          e.currentTarget.style.backgroundColor = "#ef4444";
                          e.currentTarget.style.color = "#fff";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.transform = "scale(1)";
                          e.currentTarget.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
                          e.currentTarget.style.color = "#ef4444";
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    <div className="card-meta">
                      <div className="card-title" onClick={() => onSelect?.(item)} title={title}>
                        {title}
                      </div>
                      <div className="card-sub">
                        {item.vote_average > 0 && (
                          <span className="card-rating">
                            <StarIcon size={12} />
                            {item.vote_average.toFixed(1)}
                          </span>
                        )}
                        <span>{item.year || ""}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Content: Continue Watching & History ── */}
      {activeTab === "continue" && (
        <div>
          {continueItems.length === 0 ? (
            <div className="empty-state" style={{ padding: "64px 20px", textAlign: "center" }}>
              <div style={{ color: "var(--text3)", marginBottom: 16 }}>
                <PlayIcon size={32} />
              </div>
              <h3 style={{ fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
                {t("emptyContinueTitle")}
              </h3>
              <p style={{ fontSize: 14, color: "var(--text3)", maxWidth: 440, margin: "0 auto" }}>
                {t("emptyContinueSub")}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
                gap: 20,
              }}
            >
              {continueItems.map((item) => {
                const isTV = item.media_type === "tv" || item.type === "tv";
                const title = item.title || item.name;
                const poster = item.poster_path || item.poster;
                const pct = item.progressPercent || 0;
                const timeText = formatSeconds(item.currentTime);

                return (
                  <div
                    key={`${item._pk}_${item.watchedAt || item.updatedAt}`}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
                      transition: "transform 0.2s ease, border-color 0.2s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--red)";
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.transform = "translateY(0)";
                    }}
                  >
                    <div style={{ display: "flex", gap: 14, padding: 14, flex: 1 }}>
                      {/* Thumbnail */}
                      <div
                        onClick={() => onSelect?.(item)}
                        style={{
                          width: 80,
                          height: 115,
                          borderRadius: 8,
                          overflow: "hidden",
                          flexShrink: 0,
                          cursor: "pointer",
                          backgroundColor: "var(--surface2)",
                          position: "relative",
                        }}
                      >
                        {poster ? (
                          <img
                            src={imgUrl(poster, "w185")}
                            alt={title}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "var(--text3)",
                            }}
                          >
                            {isTV ? <TVIcon /> : <FilmIcon />}
                          </div>
                        )}
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            background: "rgba(0,0,0,0.35)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                          }}
                        >
                          <PlayIcon size={20} />
                        </div>
                      </div>

                      {/* Info & Progress */}
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span className={`search-result-type ${isTV ? "type-tv" : "type-movie"}`} style={{ fontSize: 10, padding: "2px 6px" }}>
                              {isTV ? t("seriesTag") : t("movieTag")}
                            </span>
                            {item.server && (
                              <span style={{ fontSize: 10, color: "var(--text3)", textTransform: "uppercase" }}>
                                {item.server}
                              </span>
                            )}
                          </div>

                          <div
                            onClick={() => onSelect?.(item)}
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: "var(--text)",
                              cursor: "pointer",
                              lineHeight: 1.3,
                              marginBottom: 4,
                            }}
                          >
                            {title}
                          </div>

                          {isTV && item.season != null && item.episode != null && (
                            <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 4 }}>
                              {t("season")} {item.season} · {t("episode")} {item.episode}
                              {item.episodeName ? ` · ${item.episodeName}` : ""}
                            </div>
                          )}
                        </div>

                        {/* Progress Bar & Percent */}
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text3)", marginBottom: 4 }}>
                            <span>{t("progressAt")} {pct}%</span>
                            {timeText && <span>{timeText}</span>}
                          </div>
                          <div
                            style={{
                              width: "100%",
                              height: 5,
                              backgroundColor: "var(--surface3)",
                              borderRadius: 3,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${pct}%`,
                                height: "100%",
                                backgroundColor: "var(--red)",
                                borderRadius: 3,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        borderTop: "1px solid var(--border)",
                        background: "rgba(0,0,0,0.15)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect?.(item)}
                        style={{
                          flex: 1,
                          padding: "10px",
                          background: "transparent",
                          border: "none",
                          color: "var(--text)",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        <PlayIcon size={16} />
                        <span>{t("resumeWatching")}</span>
                      </button>

                      {onRemoveHistory && (
                        <button
                          type="button"
                          onClick={() => onRemoveHistory(item)}
                          title={t("removeFromHistory")}
                          style={{
                            padding: "10px 14px",
                            background: "transparent",
                            border: "none",
                            borderInlineStart: "1px solid var(--border)",
                            color: "var(--text3)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            transition: "color 0.2s ease",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "#ef4444";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = "var(--text3)";
                          }}
                        >
                          <TrashIcon size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Content: Watched ── */}
      {activeTab === "watched" && (
        <div>
          {watchedItems.length === 0 ? (
            <div className="empty-state" style={{ padding: "64px 20px", textAlign: "center" }}>
              <div style={{ color: "var(--text3)", marginBottom: 16 }}>
                <WatchedIcon size={32} />
              </div>
              <h3 style={{ fontSize: 18, color: "var(--text)", marginBottom: 8 }}>
                {t("emptyWatchedTitle")}
              </h3>
              <p style={{ fontSize: 14, color: "var(--text3)", maxWidth: 440, margin: "0 auto" }}>
                {t("emptyWatchedSub")}
              </p>
            </div>
          ) : (
            <div className="cards-grid">
              {watchedItems.map((item) => {
                const isTV = item.media_type === "tv" || item.type === "tv";
                const title = item.title || item.name;
                const poster = item.poster_path || item.poster;

                return (
                  <div
                    key={item._pk}
                    className="media-card"
                    style={{ position: "relative" }}
                  >
                    <div
                      className="card-poster-wrap"
                      onClick={() => onSelect?.(item)}
                      style={{ cursor: "pointer" }}
                    >
                      {poster ? (
                        <img
                          src={imgUrl(poster, "w342")}
                          alt={title}
                          className="card-poster"
                          loading="lazy"
                        />
                      ) : (
                        <div className="card-no-poster">
                          {isTV ? <TVIcon /> : <FilmIcon />}
                        </div>
                      )}

                      {/* Watched Badge overlay */}
                      <div
                        style={{
                          position: "absolute",
                          top: 8,
                          right: rtl ? "auto" : 8,
                          left: rtl ? 8 : "auto",
                          backgroundColor: "#10b981",
                          color: "#fff",
                          borderRadius: "50%",
                          width: 28,
                          height: 28,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 8px rgba(16, 185, 129, 0.4)",
                          zIndex: 4,
                        }}
                      >
                        <WatchedIcon size={16} />
                      </div>

                      <div className="card-overlay">
                        <div className="card-play-btn">
                          <PlayIcon size={20} />
                        </div>
                      </div>

                      <span className="card-tag">
                        {isTV ? t("seriesTag") : t("movieTag")}
                      </span>
                    </div>

                    <div className="card-meta">
                      <div className="card-title" onClick={() => onSelect?.(item)} title={title}>
                        {title}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: 6,
                        }}
                      >
                        <span style={{ fontSize: 12, color: "var(--text3)" }}>
                          {isTV && item.season != null && item.episode != null
                            ? `S${item.season}E${item.episode}`
                            : item.year || ""}
                        </span>

                        {onMarkUnwatched && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMarkUnwatched(item._pk);
                            }}
                            title={t("markUnwatched")}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "var(--text3)",
                              fontSize: 12,
                              cursor: "pointer",
                              padding: "2px 6px",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "#ef4444";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--text3)";
                            }}
                          >
                            ✕ {t("markUnwatched")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
