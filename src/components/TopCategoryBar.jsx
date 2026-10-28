import React from "react";
import { t } from "../utils/i18n";

export const TOP_CATEGORIES = [
  {
    id: "home",
    labelKey: "home",
    subtitleKey: "categoryHomeDescription",
    badge: null,
  },
  {
    id: "movies",
    labelKey: "movies",
    subtitleKey: "categoryMoviesDescription",
    defaultMediaType: "movie",
  },
  {
    id: "series",
    labelKey: "series",
    subtitleKey: "categorySeriesDescription",
    defaultMediaType: "tv",
  },
  {
    id: "sport",
    labelKey: "sport",
    badgeKey: "sportLiveNow",
    isSport: true,
  },
  {
    id: "new",
    labelKey: "trending",
    subtitleKey: "categoryTrendingDescription",
    defaultMediaType: "all",
    badgeKey: "hot",
  },
  {
    id: "anime",
    labelKey: "anime",
    subtitleKey: "categoryAnimeDescription",
    defaultMediaType: "tv",
  },
  {
    id: "asian",
    labelKey: "asian",
    subtitleKey: "categoryAsianDescription",
    defaultMediaType: "tv",
  },
  {
    id: "indian",
    labelKey: "indian",
    subtitleKey: "categoryIndianDescription",
    defaultMediaType: "movie",
  },
  {
    id: "turkish",
    labelKey: "turkish",
    subtitleKey: "categoryTurkishDescription",
    defaultMediaType: "tv",
  },
];

export default function TopCategoryBar({
  activeCategory,
  onSelectCategory,
  onOpenSearch,
  authUser,
  onSignOut,
  onOpenProfile,
}) {
  return (
    <header className="top-cat-header">
      <div className="top-cat-inner">
        {/* Brand pill on mobile / compact */}
        <div
          className="top-cat-brand"
          onClick={() => onSelectCategory("home")}
          title="hwto-kurd"
        >
          <img src="hwto-logo.svg" alt="hwto-kurd" className="top-cat-logo" />
        </div>

        {/* Categories Navigation */}
        <nav className="top-cat-nav" aria-label={t("siteSections")}>
          {TOP_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            const label = t(cat.labelKey);
            return (
              <button
                key={cat.id}
                type="button"
                className={`top-cat-pill ${cat.isSport ? "top-cat-sport-pill" : ""} ${isActive ? "active" : ""}`}
                onClick={() => onSelectCategory(cat.id)}
              >
                {cat.isSport && <span style={{ marginRight: 4, marginLeft: 4 }}>⚽</span>}
                <span className="top-cat-label">{label}</span>
                {cat.isSport && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "#00e676",
                      boxShadow: "0 0 8px #00e676",
                      display: "inline-block",
                    }}
                  />
                )}
                {!cat.isSport && cat.badgeKey && (
                  <span className="top-cat-badge">{t(cat.badgeKey)}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Quick Actions: Search & Auth User */}
        <div className="top-cat-actions">
          <button
            type="button"
            className="top-cat-search-btn"
            onClick={onOpenSearch}
            title={t("search")}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>{t("search")}</span>
          </button>

          {authUser && (
            <div className="top-cat-user" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="top-cat-profile-pill"
                onClick={() => (onOpenProfile ? onOpenProfile() : onSelectCategory?.("profile"))}
                title={authUser.email || authUser.displayName || t("profile")}
                style={{
                  background: activeCategory === "profile" ? "var(--surface3)" : "rgba(255, 255, 255, 0.06)",
                  border: activeCategory === "profile" ? "1px solid var(--red)" : "1px solid var(--border)",
                  borderRadius: 20,
                  padding: "4px 10px 4px 6px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  color: "var(--text)",
                  transition: "all 0.2s ease",
                }}
              >
                {authUser.photoURL ? (
                  <img
                    src={authUser.photoURL}
                    alt=""
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      objectFit: "cover",
                    }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      backgroundColor: "var(--red)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {(authUser.displayName || "U")[0].toUpperCase()}
                  </span>
                )}
                <span className="top-cat-username" style={{ fontSize: 13, fontWeight: 500, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {authUser.isGuest
                    ? t("guestUser")
                    : authUser.displayName || t("user")}
                </span>
              </button>
              <button
                type="button"
                className="top-cat-logout-btn"
                onClick={onSignOut}
                title={t("signOut")}
              >
                {t("signOut")}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
