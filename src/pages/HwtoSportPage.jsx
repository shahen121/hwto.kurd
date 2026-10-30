import React, { useState, useEffect, useCallback, useMemo } from "react";
import "../styles/sport.css";
import sportLogoMarkup from "../../hwto-sport LOGO.svg?raw";
import { getFormationRows } from "../utils/sportLineup";
import {
  fetchSoccerLeagues,
  fetchScoreboard,
  fetchFixtures,
  fetchStandings,
  fetchEventSummary,
  fetchMatchPlays,
  CORE_LEAGUES,
  getLeagueDisplayName,
  formatDateToYYYYMMDD,
  getMatchStatusInfo,
  isPlayGoal,
  getJerseyNumber,
  getStatLabel,
} from "../utils/sportApi";
import {
  t,
  getCurrentLanguage,
  setLanguage,
  SUPPORTED_LANGUAGES,
} from "../utils/i18n";
import { storage } from "../utils/storage";

const inlineSportLogoMarkup = sportLogoMarkup
  .replace(/<\?xml[\s\S]*?\?>/i, "")
  .replace(/<metadata>[\s\S]*?<\/metadata>/i, "");

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function TeamLineupCard({ roster, index }) {
  const allPlayers = roster.roster || [];
  const hasStarterFlags = allPlayers.some((player) => player.starter !== undefined);
  const starters = hasStarterFlags
    ? allPlayers.filter((player) => player.starter)
    : allPlayers.slice(0, 11);
  const substitutes = hasStarterFlags
    ? allPlayers.filter((player) => !player.starter)
    : allPlayers.slice(11);
  const rows = getFormationRows(allPlayers);
  const pitchRows = rows.filter((row) => row.key !== "unplaced");
  const unplaced = rows.find((row) => row.key === "unplaced")?.players || [];
  const rowLabels = {
    goalkeeper: t("sportPositionGoalkeeper"),
    defenders: t("sportPositionDefenders"),
    midfielders: t("sportPositionMidfielders"),
    forwards: t("sportPositionForwards"),
  };
  const playerName = (player) =>
    player.athlete?.displayName || player.athlete?.fullName || "Player";
  const playerKey = (player, playerIndex) =>
    player.athlete?.id || `${player.formationPlace || "player"}-${playerIndex}`;

  return (
    <article
      className={`sport-lineup-team sport-lineup-team--${index === 0 ? "home" : "away"}`}
    >
      <header className="sport-lineup-team-header">
        <div className="sport-lineup-team-identity">
          <h4>{roster.team?.displayName || `Team ${index + 1}`}</h4>
          {roster.formation && (
            <span className="sport-lineup-formation">{roster.formation}</span>
          )}
        </div>
        <span className="sport-lineup-count">
          {t("sportStartingXI")} · {starters.length}
        </span>
      </header>

      {pitchRows.length > 0 ? (
        <div
          className="sport-pitch"
          dir="ltr"
          role="group"
          aria-label={`${roster.team?.displayName || `Team ${index + 1}`} lineup`}
        >
          <div className="sport-pitch-markings" aria-hidden="true">
            <span className="sport-pitch-box sport-pitch-box--top" />
            <span className="sport-pitch-box sport-pitch-box--bottom" />
            <span className="sport-pitch-center-circle" />
          </div>
          <div className="sport-pitch-lineup">
            {pitchRows.map((row) => (
              <div
                className="sport-pitch-line"
                key={row.key}
                role="group"
                aria-label={rowLabels[row.key]}
              >
                {row.players.map((player, playerIndex) => {
                  const jersey = getJerseyNumber(player);
                  const abbreviation =
                    player.position?.abbreviation || player.position?.displayName;

                  return (
                    <div
                      className="sport-pitch-player"
                      key={playerKey(player, playerIndex)}
                      title={`${playerName(player)}${abbreviation ? ` · ${abbreviation}` : ""}`}
                    >
                      <span className="sport-pitch-shirt">
                        {jersey || "–"}
                      </span>
                      <span className="sport-pitch-player-name">
                        {player.athlete?.shortName || playerName(player)}
                      </span>
                      {abbreviation && (
                        <span className="sport-pitch-player-position">
                          {abbreviation}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="sport-lineup-unavailable">{t("sportNoLineup")}</div>
      )}

      {unplaced.length > 0 && (
        <div className="sport-lineup-unplaced">
          <span>{t("sportUnplacedPlayers")}</span>
          {unplaced.map((player, playerIndex) => (
            <span key={playerKey(player, playerIndex)}>
              {getJerseyNumber(player) ? `#${getJerseyNumber(player)} ` : ""}
              {playerName(player)}
              {player.position?.displayName
                ? ` · ${player.position.displayName}`
                : ""}
            </span>
          ))}
        </div>
      )}

      {substitutes.length > 0 && (
        <div className="sport-lineup-bench">
          <h5>
            {t("sportSubstitutes")} <span>{substitutes.length}</span>
          </h5>
          <ul>
            {substitutes.map((player, playerIndex) => (
              <li key={playerKey(player, playerIndex)}>
                <span className="sport-bench-number">
                  {getJerseyNumber(player) || "–"}
                </span>
                <span className="sport-bench-name">{playerName(player)}</span>
                <span className="sport-bench-position">
                  {player.position?.abbreviation || ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function HwtoSportPage({ onBack }) {
  const [currentLang, setCurrentLang] = useState(() => getCurrentLanguage());
  const [activeTab, setActiveTab] = useState("scoreboard"); // 'scoreboard' | 'fixtures' | 'standings'
  const [selectedLeague, setSelectedLeague] = useState(
    () => storage.get("sportSettings")?.defaultLeague || "eng.1",
  );
  const [leagues, setLeagues] = useState(CORE_LEAGUES);
  const [theme, setTheme] = useState(
    () => storage.get("sportSettings")?.theme || "dark",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  const [fixturesFilter, setFixturesFilter] = useState("all"); // 'all' | 'scheduled' | 'live' | 'finished'
  const [fixturesFrom, setFixturesFrom] = useState("");
  const [fixturesTo, setFixturesTo] = useState("");
  const [fixturesPage, setFixturesPage] = useState(1);
  const [fixturesPageCount, setFixturesPageCount] = useState(1);
  const [fixturesCount, setFixturesCount] = useState(0);

  // Dynamic date helpers
  const todayStr = useMemo(() => getLocalDateString(), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalDateString(d);
  }, []);
  const tomorrowStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return getLocalDateString(d);
  }, []);
  const latestMatchday = useMemo(() => {
    const calendar = leagues
      .find((league) => league.slug === selectedLeague)
      ?.calendar;
    const recentDates = (Array.isArray(calendar) ? calendar : [])
      .map((date) => String(date).slice(0, 10))
      .filter((date) => date <= todayStr);
    return recentDates[recentDates.length - 1] || todayStr;
  }, [leagues, selectedLeague, todayStr]);

  // Data states
  const [scoreboardData, setScoreboardData] = useState([]);
  const [fixturesData, setFixturesData] = useState([]);
  const [standingsData, setStandingsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Auto-refresh timer state
  const [autoRefresh, setAutoRefresh] = useState(
    () => storage.get("sportSettings")?.autoRefresh ?? false,
  );

  useEffect(() => {
    storage.set("sportSettings", {
      defaultLeague: selectedLeague,
      autoRefresh,
      theme,
    });
  }, [selectedLeague, autoRefresh, theme]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  // Match details modal
  const [selectedEvent, setSelectedEvent] = useState(null); // { id, league, homeTeam, awayTeam, ... }
  const [eventSummary, setEventSummary] = useState(null);
  const [eventPlays, setEventPlays] = useState([]);
  const [loadingModal, setLoadingModal] = useState(false);
  const [eventError, setEventError] = useState(null);
  const [modalTab, setModalTab] = useState("keyEvents"); // 'keyEvents' | 'plays' | 'lineups' | 'stats'

  // Sync language changes from app
  useEffect(() => {
    const handleLang = () => setCurrentLang(getCurrentLanguage());
    window.addEventListener("hwto:tmdb-lang-changed", handleLang);
    return () =>
      window.removeEventListener("hwto:tmdb-lang-changed", handleLang);
  }, []);

  // Fetch leagues list on mount
  useEffect(() => {
    let mounted = true;
    fetchSoccerLeagues()
      .then((data) => {
        if (!mounted || !Array.isArray(data)) return;
        const valid = data.filter((l) => l.slug);
        if (valid.length) setLeagues(valid);
      })
      .catch((err) => {
        if (mounted) setError(err.message || t("errorLoading"));
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch main tab data
  const loadData = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        if (activeTab === "scoreboard") {
          const yyyymmdd = formatDateToYYYYMMDD(selectedDate);
          const res = await fetchScoreboard(selectedLeague, yyyymmdd);
          setScoreboardData(res?.events || []);
        } else if (activeTab === "fixtures") {
          if (fixturesFrom && fixturesTo && fixturesFrom > fixturesTo) {
            throw new Error(t("sportInvalidDateRange"));
          }
          const res = await fetchFixtures(selectedLeague, {
            status: fixturesFilter,
            from: fixturesFrom,
            to: fixturesTo,
            page: fixturesPage,
            limit: 12,
          });
          setFixturesData(res?.events || []);
          setFixturesPageCount(Math.max(1, Number(res?.pageCount) || 1));
          setFixturesCount(Math.max(0, Number(res?.count) || 0));
        } else if (activeTab === "standings") {
          const season =
            leagues.find((league) => league.slug === selectedLeague)?.season ||
            2026;
          const res = await fetchStandings(selectedLeague, season);
          setStandingsData(res || null);
        }
      } catch (err) {
        setError(err.message || t("errorLoading"));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      activeTab,
      selectedLeague,
      selectedDate,
      fixturesFilter,
      fixturesFrom,
      fixturesTo,
      fixturesPage,
      leagues,
    ],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for global Pull-to-Refresh
  useEffect(() => {
    const handleGlobalRefresh = () => loadData(true);
    window.addEventListener("hwto:refresh", handleGlobalRefresh);
    return () => window.removeEventListener("hwto:refresh", handleGlobalRefresh);
  }, [loadData]);

  // Refresh only when enabled; the primary scoreboard is otherwise request-on-demand.
  useEffect(() => {
    if (!autoRefresh || activeTab !== "scoreboard") return;
    const interval = setInterval(() => {
      loadData(true);
    }, 90000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab, loadData]);

  // Load modal data when an event is selected
  useEffect(() => {
    if (!selectedEvent) {
      setEventSummary(null);
      setEventPlays([]);
      setEventError(null);
      return;
    }

    let mounted = true;
    setLoadingModal(true);
    setEventError(null);
    setModalTab("keyEvents");

    Promise.all([
      fetchEventSummary(selectedLeague, selectedEvent.id, selectedEvent),
      fetchMatchPlays(selectedLeague, selectedEvent.id, selectedEvent),
    ])
      .then(([summary, plays]) => {
        if (!mounted) return;
        setEventSummary(
          summary?.dataSource === "api-football"
            ? { ...summary, keyEvents: plays?.items || [] }
            : summary,
        );
        setEventPlays(plays?.items || []);
      })
      .catch((err) => {
        if (mounted) setEventError(err.message || t("sportDetailsUnavailable"));
      })
      .finally(() => {
        if (mounted) setLoadingModal(false);
      });

    return () => {
      mounted = false;
    };
  }, [selectedEvent, selectedLeague]);

  // Language switch handler
  const handleLanguageChange = (code) => {
    setLanguage(code);
    setCurrentLang(code);
  };

  // Helper to get competitor info from event
  const getCompetitors = (event) => {
    const comp = event?.competitions?.[0];
    const competitors = comp?.competitors || [];
    const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
    const away = competitors.find((c) => c.homeAway === "away") || competitors[1];
    return { home, away, competition: comp };
  };

  // Standings entries extraction
  const standingsEntries = useMemo(() => {
    if (!standingsData) return [];
    if (standingsData.children?.[0]?.standings?.entries) {
      return standingsData.children[0].standings.entries;
    }
    if (standingsData.standings?.entries) {
      return standingsData.standings.entries;
    }
    return [];
  }, [standingsData]);

  // Stat helper for standings
  const getStat = (entry, statName) => {
    const s = entry?.stats?.find((item) => item.name === statName);
    return s?.displayValue ?? "-";
  };

  const liveMatchCount = useMemo(
    () =>
      scoreboardData.filter((event) => {
        const status = getMatchStatusInfo(
          event?.competitions?.[0]?.status,
        ).state;
        return status === "live" || status === "ht";
      }).length,
    [scoreboardData],
  );

  return (
    <div className="hwto-sport-root" data-theme={theme}>
      {/* ── Brand Top Navigation ─────────────────────────────────────────── */}
      <header className="sport-header">
        <div className="sport-header-inner">
          <div className="sport-header-left">
            <div
              className="sport-brand-logo-wrap"
              onClick={() => setActiveTab("scoreboard")}
              title="hwto-sport"
            >
              <span
                className="sport-brand-logo-img"
                role="img"
                aria-label="hwto-sport"
                dangerouslySetInnerHTML={{ __html: inlineSportLogoMarkup }}
              />
              <span className="sport-brand-caption">{t("sportTagline")}</span>
            </div>

            {/* Navigation Tabs */}
            <nav className="sport-nav-tabs" aria-label={t("sportSections")}>
              <button
                type="button"
                className={`sport-nav-btn ${activeTab === "scoreboard" ? "active" : ""}`}
                aria-current={activeTab === "scoreboard" ? "page" : undefined}
                onClick={() => setActiveTab("scoreboard")}
              >
                <span>{t("sportScoreboard")}</span>
              </button>
              <button
                type="button"
                className={`sport-nav-btn ${activeTab === "fixtures" ? "active" : ""}`}
                aria-current={activeTab === "fixtures" ? "page" : undefined}
                onClick={() => setActiveTab("fixtures")}
              >
                <span>{t("sportFixtures")}</span>
              </button>
              <button
                type="button"
                className={`sport-nav-btn ${activeTab === "standings" ? "active" : ""}`}
                aria-current={activeTab === "standings" ? "page" : undefined}
                onClick={() => setActiveTab("standings")}
              >
                <span>{t("sportStandings")}</span>
              </button>
            </nav>
          </div>

          <div className="sport-header-right">
            <button
              type="button"
              className="sport-settings-btn"
              onClick={() => setSettingsOpen(true)}
              aria-label={t("sportSettings")}
              title={t("sportSettings")}
            >
              <span>{t("sportSettings")}</span>
            </button>

            {/* Language Switcher */}
            <div className="sport-lang-selector" title={t("language")}>
              {SUPPORTED_LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`sport-lang-btn ${currentLang === l.code ? "active" : ""}`}
                  onClick={() => handleLanguageChange(l.code)}
                >
                  {l.code.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Back to main site */}
            {onBack && (
              <button
                type="button"
                className="sport-back-btn"
                onClick={onBack}
                title={t("sportBackToMain")}
              >
                <span>{t("sportBackToMain")}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── League Selection Bar ─────────────────────────────────────────── */}
      <div className="sport-leagues-bar">
        <div className="sport-leagues-inner">
          {leagues.map((league) => {
            const isActive = selectedLeague === league.slug;
            const displayName = getLeagueDisplayName(
              league.slug,
              currentLang,
              leagues,
            );
            return (
              <button
                key={league.slug}
                type="button"
                className={`sport-league-pill ${isActive ? "active" : ""}`}
                onClick={() => {
                  setSelectedLeague(league.slug);
                  setFixturesPage(1);
                }}
              >
                <span>{displayName}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main Content Area ────────────────────────────────────────────── */}
      <main className="sport-main-content">
        <section className="sport-hero">
          <div className="sport-hero-copy">
            <span className="sport-eyebrow">
              {t("hwtoSport")}
            </span>
            <h1>{t("sportTagline")}</h1>
            <p>{t("sportHeroDescription")}</p>
          </div>
          <div className="sport-hero-overview">
            <div className="sport-overview-topline">
              <span>{t("sportSelectedLeague")}</span>
            </div>
            <strong>
              {getLeagueDisplayName(selectedLeague, currentLang, leagues)}
            </strong>
            <div className="sport-overview-divider" />
            <div className="sport-overview-stats">
              <div>
                <span>{t("sportMatchesToday")}</span>
                <strong>{scoreboardData.length.toLocaleString(
                  currentLang === "ar" ? "ar-SA" : currentLang === "ckb" ? "ckb-IQ" : "en-US",
                )}</strong>
              </div>
              <div>
                <span>{t("sportLiveNow")}</span>
                <strong className={liveMatchCount > 0 ? "is-live" : ""}>
                  {liveMatchCount.toLocaleString(
                    currentLang === "ar" ? "ar-SA" : currentLang === "ckb" ? "ckb-IQ" : "en-US",
                  )}
                </strong>
              </div>
            </div>
          </div>
        </section>

        {/* Date Strip & Controls for Scoreboard */}
        {activeTab === "scoreboard" && (
          <div className="sport-date-strip">
            <div className="sport-date-presets">
              <button
                type="button"
                className={`sport-date-btn ${selectedDate === latestMatchday ? "active" : ""}`}
                onClick={() => setSelectedDate(latestMatchday)}
              >
                {t("sportRecentMatchday")} ·{" "}
                {new Intl.DateTimeFormat(
                  currentLang === "ar"
                    ? "ar-SA"
                    : currentLang === "ckb"
                      ? "ckb-IQ"
                      : "en-US",
                  { day: "numeric", month: "short" },
                ).format(new Date(`${latestMatchday}T12:00:00`))}
              </button>
              <button
                type="button"
                className={`sport-date-btn ${selectedDate === todayStr ? "active" : ""}`}
                onClick={() => setSelectedDate(todayStr)}
              >
                {t("sportToday")}
              </button>
              <button
                type="button"
                className={`sport-date-btn ${selectedDate === yesterdayStr ? "active" : ""}`}
                onClick={() => setSelectedDate(yesterdayStr)}
              >
                {t("sportYesterday")}
              </button>
              <button
                type="button"
                className={`sport-date-btn ${selectedDate === tomorrowStr ? "active" : ""}`}
                onClick={() => setSelectedDate(tomorrowStr)}
              >
                {t("sportTomorrow")}
              </button>
              <input
                type="date"
                className="sport-date-custom-input"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                title={t("sportSelectDate")}
              />
            </div>

            <div className="sport-actions-bar">
              <button
                type="button"
                className={`sport-action-icon-btn ${refreshing ? "spinning" : ""}`}
                onClick={() => loadData(true)}
                title={t("sportRefresh")}
              >
                <span>{t("sportRefresh")}</span>
              </button>

              <button
                type="button"
                className={`sport-action-icon-btn ${autoRefresh ? "active" : ""}`}
                onClick={() => setAutoRefresh((prev) => !prev)}
                title={t("sportAutoRefresh")}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: autoRefresh ? "#00e676" : "#64748b",
                  }}
                />
                <span>{t("sportAutoRefresh")}</span>
              </button>
            </div>
          </div>
        )}

        {/* Status Filter for Fixtures */}
        {activeTab === "fixtures" && (
          <div className="sport-fixtures-header">
            <div className="sport-fixtures-filter-bar">
              <button
                type="button"
                className={`sport-filter-chip ${fixturesFilter === "all" ? "active" : ""}`}
                onClick={() => {
                  setFixturesFilter("all");
                  setFixturesPage(1);
                }}
              >
                {t("sportFilterAll")}
              </button>
              <button
                type="button"
                className={`sport-filter-chip ${fixturesFilter === "scheduled" ? "active" : ""}`}
                onClick={() => {
                  setFixturesFilter("scheduled");
                  setFixturesPage(1);
                }}
              >
                {t("sportFilterScheduled")}
              </button>
              <button
                type="button"
                className={`sport-filter-chip ${fixturesFilter === "live" ? "active" : ""}`}
                onClick={() => {
                  setFixturesFilter("live");
                  setFixturesPage(1);
                }}
              >
                {t("sportFilterLive")}
              </button>
              <button
                type="button"
                className={`sport-filter-chip ${fixturesFilter === "finished" ? "active" : ""}`}
                onClick={() => {
                  setFixturesFilter("finished");
                  setFixturesPage(1);
                }}
              >
                {t("sportFilterFinished")}
              </button>
            </div>

            <div className="sport-date-range">
              <label>
                <span>{t("sportDateFrom")}</span>
                <input
                  type="date"
                  value={fixturesFrom}
                  max={fixturesTo || undefined}
                  onChange={(event) => {
                    setFixturesFrom(event.target.value);
                    setFixturesPage(1);
                  }}
                />
              </label>
              <label>
                <span>{t("sportDateTo")}</span>
                <input
                  type="date"
                  value={fixturesTo}
                  min={fixturesFrom || undefined}
                  onChange={(event) => {
                    setFixturesTo(event.target.value);
                    setFixturesPage(1);
                  }}
                />
              </label>
              {(fixturesFrom || fixturesTo) && (
                <button
                  type="button"
                  className="sport-clear-dates-btn"
                  onClick={() => {
                    setFixturesFrom("");
                    setFixturesTo("");
                    setFixturesPage(1);
                  }}
                >
                  {t("sportClearDates")}
                </button>
              )}
            </div>

            <button
              type="button"
              className={`sport-action-icon-btn ${refreshing ? "spinning" : ""}`}
              onClick={() => loadData(true)}
              title={t("sportRefresh")}
            >
              <span>{t("sportRefresh")}</span>
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="sport-state-box">
            <div className="sport-spinner" />
            <p>{t("loading")}</p>
          </div>
        )}

        {/* Error Box */}
        {error && !loading && (
          <div className="sport-state-box">
            <p>{error}</p>
            <button
              type="button"
              className="sport-action-icon-btn"
              onClick={() => loadData()}
            >
              {t("retry")}
            </button>
          </div>
        )}

        {/* ── View 1: Scoreboard ────────────────────────────────────────── */}
        {activeTab === "scoreboard" && !loading && !error && (
          <>
            {scoreboardData.length === 0 ? (
              <div className="sport-state-box">
                <p>{t("sportNoMatches")}</p>
                <button
                  type="button"
                  className="sport-date-btn active"
                  onClick={() => setSelectedDate(latestMatchday)}
                >
                  {t("sportRecentMatchday")}
                </button>
              </div>
            ) : (
              <div className="sport-matches-grid">
                {scoreboardData.map((event) => {
                  const { home, away, competition } = getCompetitors(event);
                  const statusInfo = getMatchStatusInfo(competition?.status);
                  const isLive = statusInfo.state === "live";

                  const homeName = home?.team?.displayName || home?.team?.name || t("home");
                  const awayName = away?.team?.displayName || away?.team?.name || t("sportAway");
                  const homeScore = home?.score ?? "-";
                  const awayScore = away?.score ?? "-";
                  const venueName = competition?.venue?.fullName || "";

                  return (
                    <div
                      key={event.id}
                      className={`sport-match-card ${isLive ? "is-live" : ""}`}
                      onClick={() =>
                        setSelectedEvent({
                          ...event,
                          homeTeam: home,
                          awayTeam: away,
                          competition,
                        })
                      }
                    >
                      <div className="sport-card-header">
                        <span className="sport-card-league">
                          <span>
                            {getLeagueDisplayName(
                              selectedLeague,
                              currentLang,
                              leagues,
                            )}
                          </span>
                        </span>
                        <span className={`sport-status-pill ${statusInfo.state}`}>
                          {statusInfo.state === "live"
                            ? `${t("sportLiveNow")} ${statusInfo.display}`
                            : statusInfo.state === "ft"
                              ? t("sportFullTime")
                              : statusInfo.state === "ht"
                                ? t("sportHalfTime")
                                : statusInfo.state === "postponed"
                                  ? t("sportPostponed")
                                  : t("sportUpcoming")}
                        </span>
                      </div>

                      <div className="sport-teams-box">
                        {/* Home team */}
                        <div className="sport-team-row">
                          <div className="sport-team-info">
                            <span
                              className={`sport-team-name ${home?.winner ? "winner" : ""}`}
                            >
                              {homeName}
                            </span>
                          </div>
                          <span
                            className={`sport-team-score ${home?.winner ? "winner" : ""}`}
                          >
                            {statusInfo.state === "upcoming" ? "-" : homeScore}
                          </span>
                        </div>

                        {/* Away team */}
                        <div className="sport-team-row">
                          <div className="sport-team-info">
                            <span
                              className={`sport-team-name ${away?.winner ? "winner" : ""}`}
                            >
                              {awayName}
                            </span>
                          </div>
                          <span
                            className={`sport-team-score ${away?.winner ? "winner" : ""}`}
                          >
                            {statusInfo.state === "upcoming" ? "-" : awayScore}
                          </span>
                        </div>
                      </div>

                      <div className="sport-card-footer">
                        <span className="sport-venue-name" title={venueName}>
                          {venueName || t("sportVenue")}
                        </span>
                        <span className="sport-view-plays-cta">
                          <span>{t("sportMatchDetails")}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── View 2: Fixtures Schedule ─────────────────────────────────── */}
        {activeTab === "fixtures" && !loading && !error && (
          <>
            {fixturesData.length === 0 ? (
              <div className="sport-state-box">
                <p>{t("sportNoFixtures")}</p>
              </div>
            ) : (
              <div className="sport-matches-grid">
                {fixturesData.map((event) => {
                  const { home, away, competition } = getCompetitors(event);
                  const statusInfo = getMatchStatusInfo(competition?.status);
                  const homeName = home?.team?.displayName || home?.team?.name || t("home");
                  const awayName = away?.team?.displayName || away?.team?.name || t("sportAway");
                  const homeScore = home?.score ?? "-";
                  const awayScore = away?.score ?? "-";

                  let matchDateStr = "";
                  try {
                    matchDateStr = new Date(event.date).toLocaleDateString(
                      currentLang === "ar"
                        ? "ar-SA"
                        : currentLang === "ckb"
                          ? "ckb-IQ"
                          : "en-US",
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    );
                  } catch {
                    matchDateStr = event.date?.slice(0, 10) || "";
                  }

                  return (
                    <div
                      key={event.id}
                      className="sport-match-card"
                      onClick={() =>
                        setSelectedEvent({
                          ...event,
                          homeTeam: home,
                          awayTeam: away,
                          competition,
                        })
                      }
                    >
                      <div className="sport-card-header">
                        <span className="sport-card-league">
                          <span>{matchDateStr}</span>
                        </span>
                        <span className={`sport-status-pill ${statusInfo.state}`}>
                          {statusInfo.state === "ft"
                            ? t("sportFullTime")
                            : statusInfo.state === "live"
                              ? t("sportLiveNow")
                              : t("sportUpcoming")}
                        </span>
                      </div>

                      <div className="sport-teams-box">
                        <div className="sport-team-row">
                          <div className="sport-team-info">
                            <span className="sport-team-name">{homeName}</span>
                          </div>
                          <span className="sport-team-score">
                            {statusInfo.state === "upcoming" ? "-" : homeScore}
                          </span>
                        </div>

                        <div className="sport-team-row">
                          <div className="sport-team-info">
                            <span className="sport-team-name">{awayName}</span>
                          </div>
                          <span className="sport-team-score">
                            {statusInfo.state === "upcoming" ? "-" : awayScore}
                          </span>
                        </div>
                      </div>

                      <div className="sport-card-footer">
                        <span className="sport-venue-name">
                          {competition?.venue?.fullName || t("sportVenue")}
                        </span>
                        <span className="sport-view-plays-cta">
                          <span>{t("sportMatchDetails")}</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "fixtures" && !loading && !error && (
          <div className="sport-fixtures-pagination">
            <span className="sport-pagination-count">
              {t("sportFixturesCount")}:{" "}
              {fixturesCount.toLocaleString(
                currentLang === "ar"
                  ? "ar-SA"
                  : currentLang === "ckb"
                    ? "ckb-IQ"
                    : "en-US",
              )}
            </span>
            <div className="sport-pagination-controls">
              <button
                type="button"
                className="sport-pagination-btn"
                onClick={() => setFixturesPage((page) => Math.max(1, page - 1))}
                disabled={fixturesPage <= 1}
              >
                {t("sportPrevious")}
              </button>
              <span aria-live="polite">
                {t("sportPage")} {fixturesPage.toLocaleString()} {t("sportOf")}{" "}
                {fixturesPageCount.toLocaleString()}
              </span>
              <button
                type="button"
                className="sport-pagination-btn"
                onClick={() =>
                  setFixturesPage((page) => Math.min(fixturesPageCount, page + 1))
                }
                disabled={fixturesPage >= fixturesPageCount}
              >
                {t("sportNext")}
              </button>
            </div>
          </div>
        )}

        {/* ── View 3: Standings Table ───────────────────────────────────── */}
        {activeTab === "standings" && !loading && !error && (
          <div className="sport-standings-card">
            {standingsEntries.length === 0 ? (
              <div className="sport-state-box">
                <p>{t("sportNoStandings")}</p>
              </div>
            ) : (
              <div className="sport-table-wrap">
                <table className="sport-table">
                  <thead>
                    <tr>
                      <th className="sport-rank-col">{t("sportRank")}</th>
                      <th>{t("sportClub")}</th>
                      <th title={t("sportPlayed")}>{t("sportPlayed")}</th>
                      <th title={t("sportWon")}>{t("sportWon")}</th>
                      <th title={t("sportDrawn")}>{t("sportDrawn")}</th>
                      <th title={t("sportLost")}>{t("sportLost")}</th>
                      <th title={t("sportGF")}>{t("sportGF")}</th>
                      <th title={t("sportGA")}>{t("sportGA")}</th>
                      <th title={t("sportGD")}>{t("sportGD")}</th>
                      <th title={t("sportPts")} style={{ color: "var(--sport-green)" }}>
                        {t("sportPts")}
                      </th>
                      <th title="Points Per Game">{t("sportPPG")}</th>
                      <th>{t("sportZone")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standingsEntries.map((entry, idx) => {
                      const rank = entry.rank || idx + 1;
                      const teamName =
                        entry.team?.displayName ||
                        entry.team?.name ||
                        t("sportClub");
                      // Zone styling
                      const isUCL = rank <= 4;
                      const isUEL = rank === 5 || rank === 6;
                      const isRelegation = rank >= standingsEntries.length - 2;

                      const played = getStat(entry, "gamesPlayed");
                      const won = getStat(entry, "wins");
                      const drawn = getStat(entry, "ties");
                      const lost = getStat(entry, "losses");
                      const gf = getStat(entry, "pointsFor");
                      const ga = getStat(entry, "pointsAgainst");
                      const gd = getStat(entry, "pointDifferential");
                      const pts = getStat(entry, "points");

                      return (
                        <tr
                          key={entry.team?.id || idx}
                          className={
                            isUCL
                              ? "sport-rank-ucl"
                              : isUEL
                                ? "sport-rank-uel"
                                : isRelegation
                                  ? "sport-rank-relegation"
                                  : ""
                          }
                        >
                          <td className="sport-rank-col">
                            {rank <= 3 ? (
                              <span className="sport-rank-top">{rank}</span>
                            ) : (
                              rank
                            )}
                          </td>
                          <td>
                            <div className="sport-team-cell">
                              <span>{teamName}</span>
                            </div>
                          </td>
                          <td>{played}</td>
                          <td>{won}</td>
                          <td>{drawn}</td>
                          <td>{lost}</td>
                          <td>{gf}</td>
                          <td>{ga}</td>
                          <td>{gd > 0 ? `+${gd}` : gd}</td>
                          <td className="sport-pts-cell">{pts}</td>
                          <td style={{ fontWeight: 600, color: "var(--sport-cyan)" }}>
                            {getStat(entry, "ppg")}
                          </td>
                          <td>
                            {entry.note?.description ? (
                              <span
                                className="sport-zone-pill"
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: entry.note.color || "#38bdf8",
                                  background: entry.note.color
                                    ? `${entry.note.color}1e`
                                    : "rgba(56, 189, 248, 0.12)",
                                  border: `1px solid ${entry.note.color || "#38bdf8"}44`,
                                }}
                              >
                                {entry.note.description}
                              </span>
                            ) : isUCL ? (
                              <span className="sport-zone-pill ucl">UCL</span>
                            ) : isUEL ? (
                              <span className="sport-zone-pill uel">UEL</span>
                            ) : isRelegation ? (
                              <span className="sport-zone-pill rel">REL</span>
                            ) : (
                              <span style={{ color: "var(--sport-text-dim)" }}>-</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {settingsOpen && (
        <div
          className="sport-settings-backdrop"
          onClick={() => setSettingsOpen(false)}
        >
          <section
            className="sport-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sport-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sport-settings-heading">
              <div>
                <span className="sport-settings-eyebrow">{t("hwtoSport")}</span>
                <h2 id="sport-settings-title">{t("sportSettings")}</h2>
              </div>
              <button
                type="button"
                className="sport-modal-close-btn"
                onClick={() => setSettingsOpen(false)}
                aria-label={t("close")}
              >
                ×
              </button>
            </div>

            <label className="sport-setting-field">
              <span>{t("sportDefaultLeague")}</span>
              <select
                value={selectedLeague}
                onChange={(event) => {
                  setSelectedLeague(event.target.value);
                  setFixturesPage(1);
                }}
              >
                {leagues.map((league) => (
                  <option key={league.slug} value={league.slug}>
                    {getLeagueDisplayName(league.slug, currentLang, leagues)}
                  </option>
                ))}
              </select>
            </label>

            <label className="sport-setting-toggle">
              <span>
                <strong>{t("sportAutoRefreshSetting")}</strong>
                <small>{t("sportAutoRefreshDescription")}</small>
              </span>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
            </label>

            <fieldset className="sport-theme-setting">
              <legend>{t("sportTheme")}</legend>
              <div>
                <button
                  type="button"
                  className={`sport-theme-choice dark ${theme === "dark" ? "active" : ""}`}
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                >
                  {t("sportThemeDark")}
                </button>
                <button
                  type="button"
                  className={`sport-theme-choice light ${theme === "light" ? "active" : ""}`}
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                >
                  {t("sportThemeLight")}
                </button>
              </div>
            </fieldset>
          </section>
        </div>
      )}

      {/* ── Match Details & Plays Modal ──────────────────────────────────── */}
      {selectedEvent && (
        <div
          className="sport-modal-backdrop"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            className="sport-modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Top Bar */}
            <div className="sport-modal-topbar">
              <div className="sport-modal-title">
                <span>{t("sportMatchDetails")}</span>
              </div>
              <button
                type="button"
                className="sport-modal-close-btn"
                onClick={() => setSelectedEvent(null)}
                aria-label={t("close")}
              >
                ×
              </button>
            </div>

            {/* Scoreboard Hero Header */}
            <div className="sport-modal-hero">
              <div className="sport-modal-team">
                <span className="sport-modal-team-name">
                  {selectedEvent.homeTeam?.team?.displayName ||
                    selectedEvent.homeTeam?.team?.name ||
                    t("home")}
                </span>
              </div>

              <div className="sport-modal-score-box">
                <span className="sport-modal-scores">
                  {selectedEvent.homeTeam?.score ?? 0} :{" "}
                  {selectedEvent.awayTeam?.score ?? 0}
                </span>
                <span className="sport-modal-clock">
                  {selectedEvent.competition?.status?.type?.detail ||
                    t("sportFullTime")}
                </span>
                {selectedEvent.competition?.venue?.fullName && (
                  <span style={{ fontSize: 11, color: "var(--sport-text-dim)" }}>
                    {selectedEvent.competition.venue.fullName}
                  </span>
                )}
              </div>

              <div className="sport-modal-team">
                <span className="sport-modal-team-name">
                  {selectedEvent.awayTeam?.team?.displayName ||
                    selectedEvent.awayTeam?.team?.name ||
                    t("sportAway")}
                </span>
              </div>
            </div>

            {/* Modal Navigation Tabs */}
            <div className="sport-modal-tabs">
              <button
                type="button"
                className={`sport-modal-tab-btn ${modalTab === "keyEvents" ? "active" : ""}`}
                onClick={() => setModalTab("keyEvents")}
              >
                {t("sportKeyEvents")}
              </button>
              <button
                type="button"
                className={`sport-modal-tab-btn ${modalTab === "plays" ? "active" : ""}`}
                onClick={() => setModalTab("plays")}
              >
                {t("sportEventsTimeline")} ({eventPlays.length})
              </button>
              <button
                type="button"
                className={`sport-modal-tab-btn ${modalTab === "lineups" ? "active" : ""}`}
                onClick={() => setModalTab("lineups")}
              >
                {t("sportLineups")}
              </button>
              <button
                type="button"
                className={`sport-modal-tab-btn ${modalTab === "stats" ? "active" : ""}`}
                onClick={() => setModalTab("stats")}
              >
                {t("sportMatchStats")}
              </button>
            </div>

            {/* Modal Body */}
            <div className="sport-modal-body">
              {loadingModal ? (
                <div className="sport-state-box">
                  <div className="sport-spinner" />
                  <p>{t("loading")}</p>
                </div>
              ) : eventError ? (
                <div className="sport-state-box">
                  <p>{eventError}</p>
                </div>
              ) : (
                <>
                  {/* Tab 1: Key Events */}
                  {modalTab === "keyEvents" && (
                    <div className="sport-timeline">
                      {eventSummary?.keyEvents?.length > 0 ? (
                        eventSummary.keyEvents.map((item, idx) => {
                          const isGoal = isPlayGoal(item);
                          const isYellow = Boolean(item.yellowCard);
                          const isRed = Boolean(item.redCard);
                          const athlete =
                            item.athletesInvolved?.[0]?.displayName ||
                            item.athletesInvolved?.[0]?.shortName ||
                            "";

                          return (
                            <div
                              key={item.id || idx}
                              className={`sport-timeline-item ${
                                isGoal
                                  ? "goal"
                                  : isRed
                                    ? "red-card"
                                    : isYellow
                                      ? "yellow-card"
                                      : ""
                              }`}
                            >
                              <span className="sport-timeline-time">
                                {item.clock?.displayValue || `${item.clock?.value || idx}'`}
                              </span>
                              <div className="sport-timeline-desc">
                                <strong>
                                  {isGoal
                                    ? t("sportGoal")
                                    : isYellow
                                      ? t("sportYellowCard")
                                      : isRed
                                        ? t("sportRedCard")
                                        : item.type?.text || "Event"}
                                </strong>
                                {athlete && (
                                  <span
                                    style={{
                                      marginInlineStart: 8,
                                      color: "var(--sport-cyan)",
                                    }}
                                  >
                                    - {athlete}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="sport-state-box">
                          <p>{t("sportNoPlays")}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 2: Full Play-by-Play Timeline */}
                  {modalTab === "plays" && (
                    <div className="sport-timeline">
                      {eventPlays.length > 0 ? (
                        eventPlays.slice(0, 100).map((play, idx) => {
                          const isGoal = isPlayGoal(play);
                          const isGoalKick =
                            !isGoal &&
                            (play.type?.type === "goal-kick" ||
                              play.type?.text?.toLowerCase().includes("goal kick") ||
                              play.text?.toLowerCase().includes("goal kick"));
                          const isYellow = Boolean(play.yellowCard);
                          const isRed = Boolean(play.redCard);
                          const isSub = Boolean(
                            play.substitution ||
                              play.type?.type?.includes("sub") ||
                              play.text?.toLowerCase().includes("substitution"),
                          );

                          return (
                            <div
                              key={play.id || idx}
                              className={`sport-timeline-item ${
                                isGoal
                                  ? "goal"
                                  : isRed
                                    ? "red-card"
                                    : isYellow
                                      ? "yellow-card"
                                      : isSub
                                        ? "sub"
                                        : isGoalKick
                                          ? "goal-kick"
                                          : ""
                              }`}
                            >
                              <span className="sport-timeline-time">
                                {play.clock?.displayValue || `${play.period?.number || 1}H`}
                              </span>
                              <div className="sport-timeline-desc">
                                {isGoal && (
                                  <strong style={{ color: "var(--sport-green)", marginInlineEnd: 6 }}>
                                    {t("sportGoal")} -
                                  </strong>
                                )}
                                {isYellow && (
                                  <strong style={{ color: "var(--sport-yellow)", marginInlineEnd: 6 }}>
                                    {t("sportYellowCard")} -
                                  </strong>
                                )}
                                {isRed && (
                                  <strong style={{ color: "var(--sport-red)", marginInlineEnd: 6 }}>
                                    {t("sportRedCard")} -
                                  </strong>
                                )}
                                {isSub && (
                                  <strong style={{ color: "var(--sport-cyan)", marginInlineEnd: 6 }}>
                                    {t("sportSub")} -
                                  </strong>
                                )}
                                <span>{play.text || play.alternativeText}</span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="sport-state-box">
                          <p>{t("sportNoPlays")}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 3: Lineups */}
                  {modalTab === "lineups" && (
                    <div className="sport-lineups-layout">
                      {eventSummary?.rosters?.length > 0 ? (
                        eventSummary.rosters.map((roster, rIdx) => (
                          <TeamLineupCard
                            key={roster.team?.id || rIdx}
                            roster={roster}
                            index={rIdx}
                          />
                        ))
                      ) : (
                        <div className="sport-lineup-unavailable">
                          {t("sportNoLineup")}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab 4: Match Stats */}
                  {modalTab === "stats" && (() => {
                    const homeStats =
                      selectedEvent.homeTeam?.statistics ||
                      eventSummary?.boxscore?.teams?.[0]?.statistics ||
                      [];
                    const awayStats =
                      selectedEvent.awayTeam?.statistics ||
                      eventSummary?.boxscore?.teams?.[1]?.statistics ||
                      [];

                    if (!homeStats.length && !awayStats.length) {
                      return (
                        <div className="sport-state-box">
                          <p>{t("sportNoStats")}</p>
                        </div>
                      );
                    }

                    return (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 14,
                        }}
                      >
                        {homeStats.map((stat, sIdx) => {
                          const awayStat = awayStats[sIdx];
                          const statKey = stat.name || stat.abbreviation || "";
                          const label = getStatLabel(statKey, currentLang);
                          const homeVal = parseFloat(stat.displayValue) || 0;
                          const awayVal = parseFloat(awayStat?.displayValue) || 0;
                          const sum = homeVal + awayVal;
                          const homePct = sum > 0 ? Math.round((homeVal / sum) * 100) : 50;

                          return (
                            <div
                              key={sIdx}
                              style={{
                                padding: "10px 14px",
                                background: "var(--sport-surface2)",
                                borderRadius: 10,
                                border: "1px solid var(--sport-border)",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  fontSize: 13,
                                  marginBottom: 6,
                                }}
                              >
                                <strong style={{ color: "var(--sport-green)" }}>
                                  {stat.displayValue}
                                </strong>
                                <span
                                  style={{
                                    color: "var(--sport-text)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {label}
                                </span>
                                <strong style={{ color: "var(--sport-cyan)" }}>
                                  {awayStat?.displayValue ?? "-"}
                                </strong>
                              </div>

                              {/* Comparative percentage bar */}
                              <div
                                style={{
                                  height: 4,
                                  width: "100%",
                                  background: "rgba(255,255,255,0.08)",
                                  borderRadius: 2,
                                  overflow: "hidden",
                                  display: "flex",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${homePct}%`,
                                    background: "var(--sport-green)",
                                    height: "100%",
                                    transition: "width 0.4s ease",
                                  }}
                                />
                                <div
                                  style={{
                                    width: `${100 - homePct}%`,
                                    background: "var(--sport-cyan)",
                                    height: "100%",
                                    transition: "width 0.4s ease",
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
