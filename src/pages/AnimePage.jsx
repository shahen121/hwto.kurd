import { useEffect, useMemo, useState } from "react";
import { t } from "../utils/i18n";
import { BackIcon, SearchIcon, StarIcon } from "../components/Icons";
import { getAnimeSeasonTranslationKey } from "../utils/animeFormat";
import {
  fetchAnimeCatalog,
  fetchAnimeNews,
  fetchAnimeProfile,
  fetchAnimeSchedule,
} from "../utils/animeApi";
import "../styles/anime.css";

const NAV_ITEMS = [
  ["home", "animeHome"],
  ["upcoming", "animeUpcoming"],
  ["news", "animeNews"],
  ["season", "animeSeasonal"],
  ["movies", "animeMovies"],
];
const SEASONS = [
  ["WINTER", "animeWinter"],
  ["SPRING", "animeSpring"],
  ["SUMMER", "animeSummer"],
  ["FALL", "animeFall"],
];
const SORT_OPTIONS = [
  ["POPULARITY_DESC", "animeSortMostPopular"],
  ["SCORE_DESC", "animeSortBestRated"],
  ["TRENDING_DESC", "animeSortTrending"],
  ["START_DATE_DESC", "animeSortRecentlyReleased"],
];
const NEWS_BATCH_SIZE = 3;

function animeText(key, values = {}) {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    t(key),
  );
}

function formatNewsError(error) {
  if (/timeout|timed out|failed to fetch|networkerror|fetch failed/i.test(error?.message || "")) {
    return t("animeNewsTimeout");
  }
  return error?.message || t("animeNewsError");
}

function getAnimeTitle(anime) {
  return anime?.title?.english || anime?.title?.romaji || "Untitled";
}

function getDescriptionText(description) {
  if (!description) return "";
  return description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isNewEpisode(airingAt) {
  const age = Math.floor(Date.now() / 1000) - airingAt;
  return age >= 0 && age <= 10 * 60 * 60;
}

function getCurrentSeason() {
  const month = new Date().getMonth();
  if (month < 3) return "WINTER";
  if (month < 6) return "SPRING";
  if (month < 9) return "SUMMER";
  return "FALL";
}

export default function AnimePage({ onBack }) {
  const [activeSection, setActiveSection] = useState("home");
  const [anime, setAnime] = useState([]);
  const [genres, setGenres] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [news, setNews] = useState([]);
  const [hasMoreNews, setHasMoreNews] = useState(false);
  const [newsOffset, setNewsOffset] = useState(0);
  const [profileNewsData, setProfileNewsData] = useState([]);
  const [profileNewsLoading, setProfileNewsLoading] = useState(false);
  const [profileNewsError, setProfileNewsError] = useState("");
  const [newsRetryKey, setNewsRetryKey] = useState(0);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("POPULARITY_DESC");
  const [season, setSeason] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scheduleLoading, setScheduleLoading] = useState(true);
  const [newsLoading, setNewsLoading] = useState(false);
  const [error, setError] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [newsError, setNewsError] = useState("");
  const [selectedAnime, setSelectedAnime] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [scheduleRetryKey, setScheduleRetryKey] = useState(0);
  const years = useMemo(
    () => Array.from({ length: 36 }, (_, index) => new Date().getFullYear() - index),
    [],
  );

  const catalogFilters = useMemo(() => ({
    page,
    search: activeSection === "news" || activeSection === "upcoming" ? "" : search,
    sort,
    season: activeSection === "season" ? season || getCurrentSeason() : season,
    seasonYear: activeSection === "season" ? year || new Date().getFullYear() : year,
    genre,
    format: activeSection === "movies" ? "MOVIE" : "",
  }), [activeSection, genre, page, search, season, sort, year]);

  useEffect(() => {
    let mounted = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const result = await fetchAnimeCatalog(catalogFilters);
        if (!mounted) return;
        setAnime((current) =>
          page === 1 ? result.results : [...current, ...result.results],
        );
        if (result.genres.length) setGenres(result.genres);
        setHasNextPage(result.hasNextPage);
      } catch (requestError) {
        if (mounted) setError(requestError.message || t("animeLoadError"));
      } finally {
        if (mounted) setLoading(false);
      }
    }, search.trim() ? 400 : 0);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [catalogFilters, page, retryKey, search]);

  // Listen for global Pull-to-Refresh
  useEffect(() => {
    const handleGlobalRefresh = () => {
      setRetryKey((k) => k + 1);
      setScheduleRetryKey((k) => k + 1);
      setNewsRetryKey((k) => k + 1);
    };
    window.addEventListener("hwto:refresh", handleGlobalRefresh);
    return () => window.removeEventListener("hwto:refresh", handleGlobalRefresh);
  }, []);

  useEffect(() => {
    let mounted = true;
    const refreshSchedule = () => {
      fetchAnimeSchedule(7)
        .then((entries) => {
          if (mounted) {
            setSchedule(entries);
            setScheduleError("");
          }
        })
        .catch((requestError) => {
          if (mounted) setScheduleError(requestError.message || t("animeScheduleError"));
        })
        .finally(() => {
          if (mounted) setScheduleLoading(false);
        });
    };
    setScheduleLoading(true);
    setScheduleError("");
    refreshSchedule();
    const interval = window.setInterval(refreshSchedule, 15 * 60 * 1000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [scheduleRetryKey]);

  useEffect(() => {
    if (activeSection !== "news") return undefined;
    let mounted = true;
    const batch = anime.slice(0, NEWS_BATCH_SIZE);
    setNewsLoading(true);
    setNewsError("");
    fetchAnimeNews(batch, { offset: newsOffset, limit: 12 })
      .then((result) => {
        if (mounted) {
          setNews((current) => [
            ...new Map([...current, ...result.items].map((entry) => [entry.url, entry])).values(),
          ]);
          setHasMoreNews(result.hasMore);
        }
      })
      .catch((requestError) => {
        if (mounted) setNewsError(formatNewsError(requestError));
      })
      .finally(() => {
        if (mounted) setNewsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [activeSection, anime, newsOffset, newsRetryKey]);

  useEffect(() => {
    if (!selectedAnime) return undefined;
    window.scrollTo({ top: 0, behavior: "smooth" });
    let mounted = true;
    setProfile(null);
    setProfileError("");
    setProfileLoading(true);
    setProfileNewsData([]);
    setProfileNewsError("");
    setProfileNewsLoading(true);
    fetchAnimeProfile(selectedAnime)
      .then((data) => {
        if (mounted) setProfile(data);
      })
      .catch((requestError) => {
        if (mounted) setProfileError(requestError.message || t("animeProfileError"));
      })
      .finally(() => {
        if (mounted) setProfileLoading(false);
      });
    fetchAnimeNews([selectedAnime], { limit: 8 })
      .then((result) => {
        if (mounted) setProfileNewsData(result.items);
      })
      .catch((requestError) => {
        if (mounted) setProfileNewsError(formatNewsError(requestError));
      })
      .finally(() => {
        if (mounted) setProfileNewsLoading(false);
      });
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSelectedAnime(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      mounted = false;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selectedAnime]);

  useEffect(() => {
    if (activeSection !== "home" || anime.length < 2) return undefined;
    const interval = window.setInterval(
      () => setFeaturedIndex((current) => (current + 1) % Math.min(anime.length, 5)),
      7000,
    );
    return () => window.clearInterval(interval);
  }, [activeSection, anime.length]);

  const updateFilter = (setter) => (event) => {
    setter(event.target.value);
    setPage(1);
  };

  const chooseSection = (section) => {
    setActiveSection(section);
    setPage(1);
    setSearch("");
    setGenre("");
    setNews([]);
    setNewsOffset(0);
    setHasMoreNews(false);
    setFeaturedIndex(0);
    if (section === "season") {
      setSeason(getCurrentSeason());
      setYear(String(new Date().getFullYear()));
    }
    if (section === "movies") {
      setSeason("");
      setYear("");
    }
  };

  const upcomingEpisodes = useMemo(
    () => schedule.filter((entry) => entry.airingAt > Date.now() / 1000),
    [schedule],
  );
  const recentEpisodes = useMemo(
    () => schedule
      .filter((entry) => isNewEpisode(entry.airingAt))
      .sort((a, b) => b.airingAt - a.airingAt),
    [schedule],
  );
  const scheduledEpisodes = activeSection === "upcoming"
    ? upcomingEpisodes
    : recentEpisodes;
  const displayedEpisodes = search.trim()
    ? scheduledEpisodes.filter((entry) =>
      getAnimeTitle(entry.media).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    )
    : scheduledEpisodes;
  const displayedNews = search.trim()
    ? news.filter((item) =>
      `${item.title || ""} ${item.animeTitle || ""} ${item.excerpt || ""}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    )
    : news;
  const episodeSectionTitle = activeSection === "upcoming"
    ? t("animeUpcomingEpisodes")
    : t("animeLatestEpisodes");
  const profileTitle = getAnimeTitle(profile || selectedAnime);
  const profileCharacters = profile?.characters?.edges ||
    profile?.characters?.map((item) => ({ ...item, role: item.role })) || [];
  const profileStaff = profile?.staff?.edges || profile?.staff || [];
  const profileEpisodes = profile?.airingSchedule?.nodes ||
    profile?.episodes || [];
  const profileRelations = profile?.relations?.edges || profile?.relations || [];
  const profileNews = profile?.news?.length ? profile.news : profileNewsData;
  const nextAiringEpisode = profile?.nextAiringEpisode || selectedAnime?.nextAiringEpisode;
  const featuredAnime = anime[featuredIndex % Math.min(anime.length || 1, 5)];
  const orderedEpisodes = [...profileEpisodes].sort((first, second) => {
    const firstNumber = Number(first.episode || first.number || first.mal_id) || 0;
    const secondNumber = Number(second.episode || second.number || second.mal_id) || 0;
    return firstNumber - secondNumber;
  });

  return (
    <div className="anime-root">
      <header className="anime-header">
        <div className="anime-header-inner">
          <button className="anime-brand" type="button" onClick={() => {
            setSelectedAnime(null);
            chooseSection("home");
          }}>
            <span className="anime-brand-mark" aria-hidden="true">ア</span>
            <span>hwto <strong>anime</strong></span>
          </button>
          <div className="anime-header-actions">
            <span className="anime-source">{t("animePoweredBy")}</span>
            <button className="anime-back-button" type="button" onClick={onBack}>
              <BackIcon />
              <span>{t("animeBackToMain")}</span>
            </button>
          </div>
        </div>
        <nav className="anime-nav" aria-label={t("animeSections")}>
          <div className="anime-nav-inner">
            {NAV_ITEMS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`anime-nav-button ${activeSection === id ? "active" : ""}`}
                aria-current={activeSection === id ? "page" : undefined}
                onClick={() => chooseSection(id)}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="anime-content">
        {selectedAnime ? (
          <section className="anime-detail-page">
            <button
              className="anime-detail-back"
              type="button"
              onClick={() => setSelectedAnime(null)}
            >
              <BackIcon />
              <span>{t("animeBackToList")}</span>
            </button>
            {(profile?.bannerImage || selectedAnime.bannerImage) && (
              <div
                className="anime-detail-banner"
                style={{
                  backgroundImage: `linear-gradient(0deg, #100f19 2%, rgba(16, 15, 25, .12) 100%), url("${profile?.bannerImage || selectedAnime.bannerImage}")`,
                }}
              />
            )}
            <article className="anime-detail-card">
              {profileLoading && (
                <div className="anime-profile-state" role="status">{t("animeProfileLoading")}</div>
              )}
              {profileError && <div className="anime-profile-error" role="alert">{profileError}</div>}

              <header className="anime-detail-intro">
                {(profile?.coverImage?.large || selectedAnime.coverImage?.large) && (
                  <img
                    className="anime-detail-cover"
                    src={profile?.coverImage?.large || selectedAnime.coverImage?.large}
                    alt=""
                  />
                )}
                <div className="anime-detail-title-block">
                  <span className="anime-eyebrow">{t("animeDetailLabel")}</span>
                  <h1>{profileTitle}</h1>
                  <div className="anime-detail-facts">
                    <span className="anime-detail-rating">
                      <StarIcon size={16} />
                      {profile?.averageScore ?? selectedAnime.averageScore ?? "—"}
                      <small>/ 100</small>
                    </span>
                    <span>{profile?.format || selectedAnime.format || "ANIME"}</span>
                    <span>
                      {getAnimeSeasonTranslationKey(profile?.season)
                        ? t(getAnimeSeasonTranslationKey(profile.season))
                        : ""}
                      {" "}{profile?.seasonYear || selectedAnime.seasonYear || ""}
                    </span>
                    {(profile?.episodes || selectedAnime.episodes) && (
                      <span>{profile?.episodes || selectedAnime.episodes} {t("animeEpisodes")}</span>
                    )}
                    {profile?.status && <span>{profile.status.replaceAll("_", " ")}</span>}
                  </div>
                  {profile?.source && (
                    <p className="anime-profile-source">
                      {t("animeOriginalSource")}: {profile.source}
                    </p>
                  )}
                </div>
              </header>

              <section className="anime-detail-section">
                <h2>{t("animeStory")}</h2>
                <p className="anime-detail-description">
                  {getDescriptionText(profile?.description || selectedAnime.description) || t("animeDetails")}
                </p>
                <div className="anime-modal-genres">
                  {(profile?.genres || selectedAnime.genres || []).map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </section>

              {nextAiringEpisode?.airingAt && (
                <section className="anime-detail-section">
                  <h2>{t("animeNextEpisode")}</h2>
                  <div className="anime-next-episode">
                    <span className="anime-episode-number">{nextAiringEpisode.episode}</span>
                    <strong>{animeText("animeEpisodeNumber", { number: nextAiringEpisode.episode })}</strong>
                    <time>{formatDate(nextAiringEpisode.airingAt)}</time>
                  </div>
                </section>
              )}

              <section className="anime-detail-section">
                <h2>{t("animePlayer")}</h2>
                <div className="anime-player-placeholder">{t("animePlayerPlaceholder")}</div>
              </section>

              {orderedEpisodes.length > 0 && (
                <section className="anime-detail-section">
                  <div className="anime-detail-section-heading">
                    <div>
                      <span className="anime-eyebrow">{t("animeInOrder")}</span>
                      <h2>{t("animeEpisodeHistory")}</h2>
                    </div>
                    <span className="anime-section-count">
                      {orderedEpisodes.length} {t("animeEpisodes")}
                    </span>
                  </div>
                  <div className="anime-episode-list">
                    {orderedEpisodes.slice(0, 100).map((episode, index) => {
                      const number = episode.episode || episode.number || episode.mal_id || index + 1;
                      const airingAt = episode.airingAt;
                      return (
                        <div
                          className="anime-profile-episode"
                          key={`${number}-${airingAt || episode.title || ""}`}
                        >
                          <span className="anime-episode-number">{number}</span>
                          {episode.title ? (
                            <span className="anime-episode-title">{episode.title}</span>
                          ) : (
                            <span className="anime-episode-label">
                              {animeText("animeEpisodeNumber", { number })}
                            </span>
                          )}
                          {airingAt && <time>{formatDate(airingAt)}</time>}
                          {airingAt && isNewEpisode(airingAt) && (
                            <span className="anime-new-badge">{t("animeNew")}</span>
                          )}
                          <button type="button" disabled title={t("animePlayerPlaceholder")}>
                            {t("animePlay")}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {profileCharacters.length > 0 && (
                <section className="anime-detail-section">
                  <h2>{t("animeCharacters")}</h2>
                  <div className="anime-people-grid">
                    {profileCharacters.map((entry, index) => (
                      <div className="anime-person" key={entry.node?.id || entry.node?.name?.full || index}>
                        {entry.node?.image?.large && (
                          <img src={entry.node.image.large} alt="" loading="lazy" />
                        )}
                        <span>
                          <strong>{entry.node?.name?.full}</strong>
                          <small>{entry.role}</small>
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {profileStaff.length > 0 && (
                <section className="anime-detail-section">
                  <h2>{t("animeStaff")}</h2>
                  <div className="anime-staff-list">
                    {profileStaff.map((entry, index) => (
                      <span key={entry.node?.id || index}>
                        <strong>{entry.node?.name?.full}</strong>
                        <small>{entry.role || entry.node?.primaryOccupations?.join(", ")}</small>
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {profileRelations.length > 0 && (
                <section className="anime-detail-section">
                  <h2>{t("animeSeasonsAndRelated")}</h2>
                  <div className="anime-related-list">
                    {profileRelations.map((entry, index) => {
                      const related = entry.node || entry;
                      return (
                        <button
                          type="button"
                          className="anime-related-card"
                          key={related.id || index}
                          onClick={() => setSelectedAnime({
                            ...related,
                            provider: related.provider || "anilist",
                            providerId: related.providerId,
                            coverImage: related.coverImage,
                          })}
                        >
                          {related.coverImage?.large && (
                            <img src={related.coverImage.large} alt="" loading="lazy" />
                          )}
                          <span>
                            <strong>{getAnimeTitle(related)}</strong>
                            <small>{animeText("animeRelationType", {
                              type: entry.relationType || entry.relation || "",
                            })}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {(profileNewsLoading || profileNewsError || profileNews.length > 0) && (
                <section className="anime-detail-section">
                  <h2>{t("animeLatestNews")}</h2>
                  {profileNewsLoading && <div className="anime-state" role="status">{t("animeNewsLoading")}</div>}
                  {profileNewsError && <p className="anime-inline-error" role="alert">{profileNewsError}</p>}
                  <div className="anime-profile-news">
                    {profileNews.slice(0, 8).map((item, index) => (
                      <a key={item.url || index} href={item.url} target="_blank" rel="noreferrer">
                        <strong>{item.title}</strong>
                        <small>{item.source || item.animeTitle} · {item.date ? new Date(item.date).toLocaleDateString() : ""}</small>
                        {item.excerpt && <p>{item.excerpt}</p>}
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {(profile?.siteUrl || selectedAnime.siteUrl) && (
                <a
                  className="anime-external-link"
                  href={profile?.siteUrl || selectedAnime.siteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("animeOpenAniList")}
                </a>
              )}
            </article>
          </section>
        ) : (
          <>
        <section className="anime-hero">
          <div className="anime-hero-copy">
            <span className="anime-eyebrow">
              {activeSection === "upcoming" ? t("animeNextSevenDays") :
                activeSection === "news" ? t("animeNewsEyebrow") :
                  activeSection === "season" ? t("animeSeasonalCollection") :
                    activeSection === "movies" ? t("animeMovieCollection") :
                      t("animePoweredBy")}
            </span>
            <h1>{activeSection === "upcoming" ? t("animeUpcomingEpisodes") :
              activeSection === "news" ? t("animeLatestNews") :
                activeSection === "season" ? t("animeSeasonal") :
                  activeSection === "movies" ? t("animeMovies") : t("animeTitle")}</h1>
            <p>{activeSection === "upcoming" ? t("animeSchedulePageDescription") :
              activeSection === "news" ? t("animeNewsPageDescription") :
                activeSection === "season" ? t("animeSeasonPageDescription") :
                  activeSection === "movies" ? t("animeMoviesPageDescription") :
                    t("animeDescription")}</p>
          </div>
          {["home", "upcoming", "news", "season", "movies"].includes(activeSection) && (
          <div className="anime-search-wrap">
            <SearchIcon />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t("animeSearch")}
              aria-label={t("animeSearch")}
            />
          </div>
          )}
        </section>

        {activeSection === "home" && (
          <section
            key={featuredAnime?.id || "anime-featured"}
            className="anime-featured"
            style={featuredAnime?.bannerImage || featuredAnime?.coverImage?.extraLarge
              ? { backgroundImage: `linear-gradient(90deg, rgba(13, 12, 20, .96) 0%, rgba(13, 12, 20, .72) 52%, rgba(13, 12, 20, .18) 100%), linear-gradient(0deg, #100f19, transparent 30%), url("${featuredAnime.bannerImage || featuredAnime.coverImage.extraLarge}")` }
              : undefined}
          >
            <div className="anime-featured-content">
              <span className="anime-eyebrow">{t("animeFeaturedTitle")}</span>
              <h2>{featuredAnime ? getAnimeTitle(featuredAnime) : t("animeLoading")}</h2>
              {featuredAnime && (
                <>
                  <div className="anime-featured-facts">
                    {featuredAnime.averageScore != null && (
                      <span><StarIcon size={14} /> {featuredAnime.averageScore}</span>
                    )}
                    {featuredAnime.seasonYear && <span>{featuredAnime.seasonYear}</span>}
                    {featuredAnime.format && <span>{featuredAnime.format}</span>}
                  </div>
                  <p>{getDescriptionText(featuredAnime.description) || t("animeFeaturedDescription")}</p>
                  <button
                    className="anime-featured-button"
                    type="button"
                    onClick={() => setSelectedAnime(featuredAnime)}
                  >
                    {t("animeViewDetails")}
                  </button>
                </>
              )}
            </div>
            {anime.length > 1 && (
              <div className="anime-featured-dots" aria-label={t("animeFeaturedTitle")}>
                {anime.slice(0, 5).map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={index === featuredIndex % 5 ? "active" : ""}
                    aria-label={getAnimeTitle(item)}
                    onClick={() => setFeaturedIndex(index)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {(activeSection === "home" || activeSection === "upcoming") && (
          <section className="anime-airing-section">
            <div className="anime-section-heading">
              <div>
                <span className="anime-eyebrow">
                  {activeSection === "upcoming" ? t("animeNextSevenDays") : t("animeRecentUpdates")}
                </span>
                <h2>{episodeSectionTitle}</h2>
              </div>
              {activeSection === "home" && (
                <button type="button" className="anime-text-button" onClick={() => chooseSection("upcoming")}>
                  {t("animeSeeSchedule")}
                </button>
              )}
            </div>
            {scheduleError && <p className="anime-inline-error" role="alert">{scheduleError}</p>}
            {scheduleLoading && schedule.length === 0 && (
              <div className="anime-state" role="status">{t("animeScheduleLoading")}</div>
            )}
            {!scheduleLoading && !scheduleError && displayedEpisodes.length === 0 && (
              <div className="anime-empty-strip">{t("animeNoSchedule")}</div>
            )}
            {activeSection === "home" && displayedEpisodes.length > 0 && (
              <div className="anime-airing-strip">
                {displayedEpisodes.slice(0, 12).map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className="anime-airing-card"
                    onClick={() => setSelectedAnime(entry.media)}
                  >
                    <img src={entry.media.coverImage?.large} alt="" loading="lazy" />
                    <span className="anime-airing-copy">
                      <strong>{getAnimeTitle(entry.media)}</strong>
                      <span>{animeText("animeEpisodeNumber", { number: entry.episode })}</span>
                      <span>{formatDate(entry.airingAt)}</span>
                    </span>
                    {isNewEpisode(entry.airingAt) && (
                      <span className="anime-new-badge">{t("animeNew")}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {activeSection === "upcoming" && (
              <>
                {scheduleError && (
                  <button
                    type="button"
                    className="anime-more-button"
                    onClick={() => setScheduleRetryKey((current) => current + 1)}
                  >
                    {t("animeRetry")}
                  </button>
                )}
                {displayedEpisodes.length > 0 && (
                  <div className="anime-schedule-list">
                    {displayedEpisodes.map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        className="anime-schedule-row"
                        onClick={() => setSelectedAnime(entry.media)}
                      >
                        <img src={entry.media.coverImage?.large} alt="" loading="lazy" />
                        <span className="anime-schedule-title">
                          <strong>{getAnimeTitle(entry.media)}</strong>
                          <small>
                            {[
                              entry.media.format || "ANIME",
                              entry.media.averageScore != null ? `${entry.media.averageScore}/100` : null,
                              entry.media.seasonYear,
                              entry.media.episodes ? `${entry.media.episodes} ${t("animeEpisodes")}` : null,
                            ].filter(Boolean).join(" · ")}
                          </small>
                          {entry.media.description && (
                            <span className="anime-schedule-description">
                              {getDescriptionText(entry.media.description)}
                            </span>
                          )}
                        </span>
                        <span className="anime-schedule-episode">
                          {animeText("animeEpisodeNumber", { number: entry.episode })}
                        </span>
                        <time>{formatDate(entry.airingAt)}</time>
                        {isNewEpisode(entry.airingAt) && <span className="anime-new-badge">{t("animeNew")}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeSection === "news" ? (
          <section className="anime-section">
            <div className="anime-section-heading">
              <div>
                <span className="anime-eyebrow">{t("animeNewsEyebrow")}</span>
                <h2>{t("animeLatestNews")}</h2>
              </div>
              <span className="anime-source">{t("animeNewsSource")}</span>
            </div>
            {newsError && (
              <div className="anime-inline-error" role="alert">
                <p>{newsError}</p>
                <button type="button" onClick={() => setNewsRetryKey((current) => current + 1)}>
                  {t("animeRetry")}
                </button>
              </div>
            )}
            {newsLoading && <div className="anime-state" role="status">{t("animeNewsLoading")}</div>}
            {!newsLoading && anime.length === 0 && loading && (
              <div className="anime-state" role="status">{t("animeLoading")}</div>
            )}
            {!newsLoading && !newsError && anime.length > 0 && news.length === 0 && (
              <div className="anime-empty-strip">{t("animeNoNews")}</div>
            )}
            <div className="anime-news-grid">
              {displayedNews.map((item) => (
                <a
                  className="anime-news-card"
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  key={item.url || `${item.title}-${item.date}`}
                >
                  {item.images?.jpg?.image_url && <img src={item.images.jpg.image_url} alt="" loading="lazy" />}
                  <span className="anime-news-body">
                    <span className="anime-news-meta">{item.source || item.animeTitle} · {item.date ? new Date(item.date).toLocaleDateString() : ""}</span>
                    <strong>{item.title}</strong>
                    <span>{item.excerpt || item.forum_url || t("animeReadNews")}</span>
                    <span className="anime-news-link">{t("animeReadNews")} ↗</span>
                  </span>
                </a>
              ))}
            </div>
            {hasMoreNews && (
              <button
                type="button"
                className="anime-more-button"
                disabled={newsLoading}
                onClick={() => setNewsOffset((current) => current + 12)}
              >
                {newsLoading ? t("animeNewsLoading") : t("animeMoreNews")}
              </button>
            )}
          </section>
        ) : activeSection !== "upcoming" && (
          <section className="anime-catalog">
            <div className="anime-section-heading anime-catalog-heading">
              <div>
                <span className="anime-eyebrow">
                  {activeSection === "movies" ? t("animeMovieCollection") :
                    activeSection === "season" ? t("animeSeasonalCollection") :
                      activeSection === "upcoming" ? t("animePopularSeries") : t("animeCatalogLabel")}
                </span>
                <h2>{activeSection === "movies" ? t("animeMovies") :
                  activeSection === "season" ? t("animeSeasonal") :
                    activeSection === "upcoming" ? t("animeComingSoon") : t("animePopular")}</h2>
              </div>
            </div>
            <div className="anime-toolbar">
              <label>
                <span>{t("animeSort")}</span>
                <select value={sort} onChange={updateFilter(setSort)}>
                  {SORT_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>{t(label)}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("animeSeason")}</span>
                <select value={season} onChange={updateFilter(setSeason)}>
                  <option value="">{t("animeAnySeason")}</option>
                  {SEASONS.map((value) => (
                    <option key={value} value={value}>
                      {t(getAnimeSeasonTranslationKey(value))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("animeYear")}</span>
                <select value={year} onChange={updateFilter(setYear)}>
                  <option value="">{t("animeAnyYear")}</option>
                  {years.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label>
                <span>{t("animeGenre")}</span>
                <select value={genre} onChange={updateFilter(setGenre)}>
                  <option value="">{t("animeAllGenres")}</option>
                  {genres.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
            </div>
            {error && (
              <div className="anime-state anime-error" role="alert">
                <p>{error}</p>
                <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
                  {t("animeRetry")}
                </button>
              </div>
            )}
            {!error && loading && anime.length === 0 && (
              <div className="anime-state" role="status">{t("animeLoading")}</div>
            )}
            {!error && !loading && anime.length === 0 && (
              <div className="anime-state">{t("animeNoResults")}</div>
            )}
            {anime.length > 0 && (
              <>
                <div className="anime-grid">
                  {anime.map((item) => (
                    <button
                      key={item.id}
                      className="anime-card"
                      type="button"
                      onClick={() => setSelectedAnime(item)}
                    >
                      <span className="anime-card-image-wrap">
                        <img src={item.coverImage?.large || item.coverImage?.extraLarge} alt="" loading="lazy" />
                        {item.averageScore != null && (
                          <span className="anime-card-score"><StarIcon size={13} /> {item.averageScore}</span>
                        )}
                        <span className="anime-card-format">{item.format || "ANIME"}</span>
                      </span>
                      <span className="anime-card-title">{getAnimeTitle(item)}</span>
                      <span className="anime-card-meta">
                        {[item.seasonYear, item.episodes ? `${item.episodes} ${t("animeEpisodes")}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </button>
                  ))}
                </div>
                {loading && anime.length > 0 && (
                  <div className="anime-loading-more" role="status">{t("animeLoading")}</div>
                )}
                {hasNextPage && !loading && (
                  <button
                    className="anime-more-button"
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t("animeMore")}
                  </button>
                )}
              </>
            )}
          </section>
        )}
          </>
        )}
      </main>
    </div>
  );
}
