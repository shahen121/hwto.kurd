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
                className={`top-cat-pill ${isActive ? "active" : ""}`}
                onClick={() => onSelectCategory(cat.id)}
              >
                <span className="top-cat-label">{label}</span>
                {cat.badgeKey && (
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
            <div className="top-cat-user">
              <span className="top-cat-username" title={authUser.email || ""}>
                {authUser.isGuest
                  ? t("guestUser")
                  : authUser.displayName || t("user")}
              </span>
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
