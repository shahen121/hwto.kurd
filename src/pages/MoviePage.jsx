import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  memo,
  useCallback,
  useMemo,
} from "react";
import {
  tmdbFetch,
  imgUrl,
  PLAYER_SOURCES,
  getSourceUrl,
  sourceSupportsProgress,
  sourceProgressViaFrames,
  sourceIsAsync,
  fetchAnilistData,
  cleanAnilistDescription,
  isAnimeContent,
  ANIME_DEFAULT_SOURCE,
  NON_ANIME_DEFAULT_SOURCE,
  NEEDS_INTERCEPT,
  getNextNonAsyncSource,
} from "../utils/api";
import {
  PlayIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
  StarIcon,
  FilmIcon,
  DownloadIcon,
  WatchedIcon,
  TrailerIcon,
  RatingShieldIcon,
  RatingLockIcon,
  SourceIcon,
  ShieldBlockIcon,
  PopOutIcon,
} from "../components/Icons";
import DownloadModal from "../components/DownloadModal";
import SoraniOverview from "../components/SoraniOverview";
import TrailerModal from "../components/TrailerModal";
import BlockedStatsModal from "../components/BlockedStatsModal";
import { useBlockedStats } from "../utils/useBlockedStats";
import MediaCard from "../components/MediaCard";
import HlsPlayer from "../components/HlsPlayer";
import { fetchAuthorizedHlsStream } from "../utils/hlsClient";
import {
  storage,
  STORAGE_KEYS,
  isElectron,
  getFailoverSource,
  setFailoverSource,
  clearFailoverSource,
} from "../utils/storage";
import { resolveGithubSubtitle } from "../utils/subtitles";
import SubtitleOverlay from "../components/SubtitleOverlay";
const EMPTY_SUBS = [];
import {
  fetchMovieRating,
  isRestricted,
  getAgeLimitSetting,
  getRatingCountry,
} from "../utils/ageRating";
import {
  GAMEPAD_PLAYER_SCRIPT,
  GAMEPAD_EXIT_CHECK_JS,
  GAMEPAD_EXIT_RESET_JS,
  GAMEPAD_CLEANUP_JS,
} from "../utils/playerGamepadScript";
import { setPlayerGamepadActive } from "../utils/gamepadPlayerState";
import { t, getCurrentLanguage, getLocalizedGenre } from "../utils/i18n";

export default function MoviePage({
  item,
  apiKey,
  playerSettings,
  onSave,
  isSaved,
  onHistory,
  progress,
  saveProgress,
  onBack,
  onSettings,
  onDownloadStarted,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  downloads,
  onGoToDownloads,
  onSelect,
  onLeave,
}) {
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  useEffect(() => {
    return () => {
      onLeaveRef.current?.();
    };
  }, []);

  const [details, setDetails] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [showDownload, setShowDownload] = useState(false);
  const [trailerKey, setTrailerKey] = useState(null);
  const [showTrailer, setShowTrailer] = useState(false);
  const [m3u8Url, setM3u8Url] = useState(null);
  const [interceptedSubs, setInterceptedSubs] = useState([]);
  const [githubSub, setGithubSub] = useState(null);
  const fetchedMovieSubKeyRef = useRef("");
  const [playerSource, setPlayerSource] = useState(() => {
    if (item.server) {
      const match = PLAYER_SOURCES.find((s) => s.id === item.server || s.aliases?.includes(item.server));
      if (match) return match.id;
    }
    const saved = storage.get("playerSource");
    const matchSaved = PLAYER_SOURCES.find((s) => s.id === saved || s.aliases?.includes(saved));
    return matchSaved ? matchSaved.id : NON_ANIME_DEFAULT_SOURCE;
  });

  // Accent colour + subtitle lang come from App-level state (via props),
  // so they are always fresh after Settings save without any extra storage reads.
  const playerAccentColor = playerSettings?.accentColor ?? null;
  const playerSubLang = playerSettings?.subtitleLang ?? null;

  // Automatically check GitHub subtitles repo for this movie (fetched once per id/lang key)
  useEffect(() => {
    let mounted = true;
    if (!item?.id) {
      setGithubSub(null);
      return;
    }
    const subKey = `${item.id}_${playerSubLang || ""}`;
    if (fetchedMovieSubKeyRef.current === subKey) return;
    fetchedMovieSubKeyRef.current = subKey;
    setGithubSub(null);

    resolveGithubSubtitle({
      type: "movie",
      tmdbId: item.id,
      preferredLang: playerSubLang,
    }).then((found) => {
      if (!mounted) return;
      setGithubSub(found);
    });
    return () => {
      mounted = false;
    };
  }, [item.id, playerSubLang]);
  const progressViaFrames = useMemo(
    () => sourceProgressViaFrames(playerSource),
    [playerSource],
  );
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [dubMode, setDubMode] = useState(
    () => storage.get(STORAGE_KEYS.ALLMANGA_DUB_MODE) || "sub",
  );
  const [anilistData, setAnilistData] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const sourceRef = useRef(null);
  const [subDisabled, setSubDisabled] = useState(false);
  const [selectedSubLang, setSelectedSubLang] = useState(null);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [subPos, setSubPos] = useState(null);
  const subRef = useRef(null);

  const activeSub = useMemo(() => {
    if (!githubSub || subDisabled) return null;
    if (selectedSubLang) {
      return (
        githubSub.available?.find((s) => s.lang === selectedSubLang) ||
        githubSub
      );
    }
    return githubSub;
  }, [githubSub, subDisabled, selectedSubLang]);

  const movieOverlaySubtitles = useMemo(() => {
    if (githubSub?.available && githubSub.available.length > 0) {
      return githubSub.available;
    }
    if (activeSub) return [activeSub];
    return EMPTY_SUBS;
  }, [githubSub, activeSub]);

  useEffect(() => {
    setSubDisabled(false);
    setSelectedSubLang(null);
    setShowSubMenu(false);
  }, [item.id, playerSource]);
  const playerWrapRef = useRef(null);
  const webviewRef = useRef(null);
  // Always-current refs for interval callbacks, avoids stale closures without restarting the interval
  const saveProgressRef = useRef(saveProgress);
  saveProgressRef.current = saveProgress;
  const onMarkWatchedRef = useRef(onMarkWatched);
  onMarkWatchedRef.current = onMarkWatched;
  // AllManga async URL resolution
  const [resolvedPlayerUrl, setResolvedPlayerUrl] = useState(null);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [resolveError, setResolveError] = useState(null);
  // Refs mirror the above so the resolve-effect can guard without stale closures
  const resolvingUrlRef = useRef(false);
  const resolvedPlayerUrlRef = useRef(null);
  const [collection, setCollection] = useState(null); // { name, parts }
  // Webview loading overlay
  const [webviewLoading, setWebviewLoading] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  // pipOpen=true: main webview shows about:blank, pop-out window has the real player
  const [pipOpen, setPipOpen] = useState(false);
  const pipUrlRef = useRef(null); // URL to restore when pop-out closes
  const pipWebContentsIdRef = useRef(null); // cached WebContents ID of the pop-out window

  // Derived: detect anime before any effects so effects can use it
  const isAnime = useMemo(
    () => isAnimeContent(item, details),
    [item.id, details],
  );
  const [downloaderFolder, setDownloaderFolder] = useState(
    () => storage.get("downloaderFolder") || "",
  );

  // Blocked request stats
  const {
    sessionTotal: blockedSession,
    alltimeTotal: blockedAlltime,
    showModal: showBlockedModal,
    setShowModal: setShowBlockedModal,
    getSessionDomains: getBlockedDomains,
  } = useBlockedStats(item.id);

  // Age rating
  const [rating, setRating] = useState({ cert: null, minAge: null });
  const ageLimitSetting = useMemo(() => getAgeLimitSetting(storage), []);
  const ratingCountry = useMemo(() => getRatingCountry(storage), []);
  const restricted = isRestricted(rating.minAge, ageLimitSetting);

  const progressKey = `movie_${item.id}`;
  const pct = progress[progressKey] || 0;
  const isWatched = !!watched?.[progressKey];
  const hasProgress = pct > 0;

  // ── Derived display values (must be declared before any callbacks that use them) ──
  const d = details || item;
  const title = d.title || d.name;
  const year = (d.release_date || "").slice(0, 4);
  const mediaName = `${title}${year ? " (" + year + ")" : ""}`;

  const { watchedSecs, totalSecs, displayPct, progressLabel } = useMemo(() => {
    const watchedSecs = storage.get("dlTime_" + progressKey) || 0;
    const totalSecs = d?.runtime ? d.runtime * 60 : 0;
    const derivedPct =
      watchedSecs > 0 && totalSecs > 0
        ? Math.floor((watchedSecs / totalSecs) * 100)
        : 0;
    const displayPct = pct > 0 ? pct : derivedPct;
    const fmt = (s) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = Math.floor(s % 60);
      return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
        : `${m}:${String(sec).padStart(2, "0")}`;
    };
    const progressLabel =
      watchedSecs > 0 && totalSecs > 0
        ? `${fmt(watchedSecs)} / ${fmt(totalSecs)}`
        : watchedSecs > 0
          ? fmt(watchedSecs)
          : displayPct > 0
            ? `${displayPct}%`
            : null;
    return { watchedSecs, totalSecs, displayPct, progressLabel };
  }, [progressKey, pct, d?.runtime]);

  // Read threshold from settings (default 20s), stable across renders
  const [watchedThreshold] = useState(
    () => storage.get("watchedThreshold") ?? 20,
  );

  // Ref to prevent double-marking
  const autoMarkedRef = useRef(false);
  // Tracks last known playback position, used to detect resolution-change resets
  const lastKnownTimeRef = useRef(0);
  // Timestamp until which we ignore reset detection (post-seekback cooldown)
  const seekBackCooldownRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/movie/${item.id}`, apiKey)
      .then((d) => {
        if (mounted) setDetails(d);
      })
      .catch(() => {
        if (mounted) setDetails(item);
      });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  useEffect(() => {
    let mounted = true;
    fetchMovieRating(item.id, apiKey, ratingCountry).then((r) => {
      if (mounted) setRating(r);
    });
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey, ratingCountry]);

  useEffect(() => {
    let mounted = true;
    tmdbFetch(`/movie/${item.id}/videos`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const videos = data.results || [];
        const trailer =
          videos.find((v) => v.type === "Trailer" && v.site === "YouTube") ||
          videos.find((v) => v.site === "YouTube");
        if (trailer) setTrailerKey(trailer.key);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [item.id, apiKey]);

  // Fetch movie collection (sequels/prequels)
  useEffect(() => {
    setCollection(null);
    if (!details?.belongs_to_collection?.id) return;
    let mounted = true;
    tmdbFetch(`/collection/${details.belongs_to_collection.id}`, apiKey)
      .then((data) => {
        if (!mounted) return;
        const parts = (data.parts || [])
          .map((p) => ({ ...p, media_type: "movie" }))
          .sort((a, b) =>
            (a.release_date || "").localeCompare(b.release_date || ""),
          );
        if (parts.length > 1) {
          setCollection({ name: data.name, parts });
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [details?.belongs_to_collection?.id, apiKey]);

  // Reset m3u8 URL, subtitle URL and source menu whenever the movie or source changes
  useEffect(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setShowSourceMenu(false);
    setAnilistData(null);
    resolvedPlayerUrlRef.current = null;
    setResolvedPlayerUrl(null);
    resolvingUrlRef.current = false;
    setResolvingUrl(false);
    setResolveError(null);
    setWebviewLoading(true); // instantly blank the player on every source/item switch
  }, [item.id, playerSource, dubMode]);

  // Fetch AniList data + auto-set source for anime/non-anime
  useEffect(() => {
    let mounted = true;
    if (isAnime) {
      fetchAnilistData(item.title || item.name, "ANIME", item.id).then(
        (data) => {
          if (mounted && data) setAnilistData(data);
        },
      );
      // Switch to anime source if current source is not an anime source
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (!currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(savedSrc?.tag ? saved : ANIME_DEFAULT_SOURCE);
      }
    } else {
      // Switch back to non-anime source if current source is anime-only
      const currentSrc = PLAYER_SOURCES.find((s) => s.id === playerSource);
      if (currentSrc?.tag) {
        const saved = storage.get("playerSource");
        const savedSrc = PLAYER_SOURCES.find((s) => s.id === saved);
        setPlayerSource(!savedSrc?.tag ? saved : NON_ANIME_DEFAULT_SOURCE);
      }
    }
    return () => {
      mounted = false;
    };
  }, [item.id, isAnime]);

  // Resolve AllManga movie URL via main-process IPC
  useEffect(() => {
    if (!playing) return;
    const epKey = `movie_${item.id}_${dubMode}`;

    // Auto-failover: if a previous attempt taught us AllManga doesn't have
    // this title, skip straight to the cached fallback source.
    if (sourceIsAsync(playerSource)) {
      const cached = getFailoverSource(epKey);
      if (cached && cached !== playerSource) {
        setM3u8Url(null);
        setInterceptedSubs([]);
        resolvedPlayerUrlRef.current = null;
        setResolvedPlayerUrl(null);
        resolvingUrlRef.current = false;
        setResolvingUrl(false);
        setResolveError(null);
        setPlayerSource(cached);
        return;
      }
    }

    if (!sourceIsAsync(playerSource)) return;
    // Use refs as guards
    if (resolvedPlayerUrlRef.current || resolvingUrlRef.current) return;
    resolvingUrlRef.current = true;
    setResolvingUrl(true);
    setResolveError(null);
    let mounted = true;

    if (playerSource === "authorized_hls") {
      fetchAuthorizedHlsStream({ type: "movie", id: item.id })
        .then((res) => {
          if (!mounted) return;
          if (res.ok && res.streamUrl) {
            resolvedPlayerUrlRef.current = res.streamUrl;
            setResolvedPlayerUrl(res.streamUrl);
            setM3u8Url(res.streamUrl);
          } else {
            setResolveError(res.error || t("errorLoading"));
          }
        })
        .catch((e) => {
          if (mounted) setResolveError(e.message || t("errorLoading"));
        })
        .finally(() => {
          if (mounted) {
            resolvingUrlRef.current = false;
            setResolvingUrl(false);
            setWebviewLoading(false);
          }
        });
      return;
    }

    const startTime = storage.get("dlTime_" + progressKey) || 0;
    window.electron
      ?.resolveAllManga?.({
        title,
        seasonNumber: 1,
        episodeNumber: 1,
        isMovie: true,
        translationType: dubMode,
      })
      .then((res) => {
        if (!mounted) return;
        if (res?.ok && res.url) {
          clearFailoverSource(epKey);
          if (res.isDirectMp4 !== undefined) {
            window.electron
              .setPlayerVideo({
                url: res.url,
                referer: res.referer || "https://allmanga.to",
                startTime,
              })
              .then((r) => {
                if (!mounted) return;
                resolvedPlayerUrlRef.current = r.playerUrl;
                setResolvedPlayerUrl(r.playerUrl);
                setM3u8Url(res.url);
              })
              .catch(() => {
                if (mounted) setResolveError(t("localPlayerStartFailed"));
              });
          } else {
            resolvedPlayerUrlRef.current = res.url;
            setResolvedPlayerUrl(res.url);
          }
        } else {
          // AllManga doesn't have this title → switch to the next source
          // automatically and remember the choice for next time.
          const next = getNextNonAsyncSource(playerSource);
          if (next) {
            setFailoverSource(epKey, next);
            setM3u8Url(null);
            setInterceptedSubs([]);
            resolvedPlayerUrlRef.current = null;
            setResolvedPlayerUrl(null);
            setResolveError(null);
            setPlayerSource(next);
          } else {
            console.error("Player source resolution failed:", res?.error);
            setResolveError(t("sourceLookupFailed"));
          }
        }
      })
      .catch((e) => {
        if (mounted) setResolveError(t("errorLoading"));
      })
      .finally(() => {
        if (mounted) {
          resolvingUrlRef.current = false;
          setResolvingUrl(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [playing, playerSource, dubMode]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onM3u8Found((url) => {
      setM3u8Url((prev) => (prev !== url ? url : prev));
    });
    return () => window.electron.offM3u8Found(handler);
  }, []);

  // Auto-failover from Vidcore to Vidlink to AutoEmbed if error occurs
  useEffect(() => {
    if (!playing) return;
    const onMessage = (e) => {
      if (
        e.data &&
        e.data.event === "status" &&
        (e.data.data === 404 ||
          e.data.data === 555 ||
          (typeof e.data.data === "number" && e.data.data >= 400))
      ) {
        if (playerSource === "vidcore") {
          setFailoverSource(`movie_${item.id}`, "vidlink");
          setPlayerSource("vidlink");
        } else if (playerSource === "vidlink") {
          setFailoverSource(`movie_${item.id}`, "vidsrc_me");
          setPlayerSource("vidsrc_me");
        } else if (playerSource === "vidsrc_me" || playerSource === "vidsrc_cc") {
          setFailoverSource(`movie_${item.id}`, "multiembed");
          setPlayerSource("multiembed");
        } else if (playerSource === "multiembed" || playerSource === "embedsu") {
          setFailoverSource(`movie_${item.id}`, "2embed");
          setPlayerSource("2embed");
        } else if (playerSource === "autoembed") {
          setFailoverSource(`movie_${item.id}`, "2embed");
          setPlayerSource("2embed");
        }

      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [playing, playerSource, item.id]);

  // Close source dropdown on scroll or click-outside
  useEffect(() => {
    if (!showSourceMenu) return;
    const close = () => setShowSourceMenu(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    const handleClick = (e) => {
      if (
        sourceRef.current?.contains(e.target) ||
        e.target.closest(".source-dropdown")
      )
        return;
      close();
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showSourceMenu]);

  // Close subtitle dropdown on scroll or click-outside
  useEffect(() => {
    if (!showSubMenu) return;
    const close = () => setShowSubMenu(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    const handleClick = (e) => {
      if (
        subRef.current?.contains(e.target) ||
        e.target.closest(".sub-dropdown")
      )
        return;
      close();
    };
    document.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showSubMenu]);

  useEffect(() => {
    if (!window.electron) return;
    const handler = window.electron.onSubtitleFound(({ url, lang }) => {
      // Only keep VTT, deduplicate per language (latest wins)
      if (!url || !url.toLowerCase().includes(".vtt")) return;
      setInterceptedSubs((prev) => {
        const filtered = prev.filter((s) => s.lang !== lang);
        return [...filtered, { url, lang: lang || "unknown" }];
      });
    });
    return () => window.electron.offSubtitleFound(handler);
  }, []);

  // Reset auto-mark guard when a new movie loads or watched state resets
  useEffect(() => {
    autoMarkedRef.current = false;
    lastKnownTimeRef.current = 0;
    seekBackCooldownRef.current = 0;
  }, [item.id, isWatched]);

  // Show loader instantly when play starts
  useEffect(() => {
    if (playing) setWebviewLoading(true);
  }, [playing]);

  useEffect(() => {
    if (isElectron || !playing || !webviewLoading) return;
    const t = setTimeout(() => setWebviewLoading(false), 400);
    return () => clearTimeout(t);
  }, [playing, webviewLoading, playerSource]);

  // ── Webview memory cleanup ────────────────────────────────────────────────
  // useLayoutEffect fires synchronously BEFORE React mutates the DOM, so the
  // webview is still attached when we navigate it to about:blank.
  // This lets Chromium unload.
  useLayoutEffect(() => {
    if (playing) return;
    const wv = webviewRef.current;
    if (wv) {
      try {
        wv.src = "about:blank";
      } catch {}
    }
  }, [playing]);

  // On unmount: signal main process to destroy the player WebContents and flush session cache.
  useEffect(() => {
    return () => {
      window.electron?.playerStopped?.();
    };
  }, []);

  // ── Controller support: play/pause, seek, volume, fullscreen ─────────────
  // Only active while the "controller support" setting is on.
  const [gamepadEnabled, setGamepadEnabled] = useState(
    () => storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false, // default on
  );
  useEffect(() => {
    const handler = () =>
      setGamepadEnabled(storage.get(STORAGE_KEYS.GAMEPAD_ENABLED) !== false);
    window.addEventListener("streambert:gamepad-settings-changed", handler);
    return () =>
      window.removeEventListener(
        "streambert:gamepad-settings-changed",
        handler,
      );
  }, []);

  useEffect(() => {
    setPlayerGamepadActive(gamepadEnabled && playing);
    return () => setPlayerGamepadActive(false);
  }, [playing, gamepadEnabled]);

  useEffect(() => {
    if (!isElectron) return;
    const wv = webviewRef.current;
    if (!wv || !playing || !gamepadEnabled) return;

    const inject = () => {
      wv.executeJavaScript(GAMEPAD_PLAYER_SCRIPT).catch(() => {});
    };
    wv.addEventListener("dom-ready", inject);
    try {
      inject();
    } catch {}

    // Poll for a B-button "leave the player" request from the guest script.
    const exitPoll = setInterval(async () => {
      try {
        const requested = await wv.executeJavaScript(GAMEPAD_EXIT_CHECK_JS);
        if (requested) {
          wv.executeJavaScript(GAMEPAD_EXIT_RESET_JS).catch(() => {});
          setPlaying(false);
        }
      } catch {}
    }, 250);

    return () => {
      wv.removeEventListener("dom-ready", inject);
      clearInterval(exitPoll);
      try {
        wv.executeJavaScript(GAMEPAD_CLEANUP_JS);
      } catch {}
    };
  }, [playing, gamepadEnabled]);

  // Attach webview load events so we know when the new source has painted
  useEffect(() => {
    if (!playing) return;
    if (!isElectron) {
      // Fallback timer in case iframe onLoad doesn't fire immediately
      const t = setTimeout(() => setWebviewLoading(false), 400);
      return () => clearTimeout(t);
    }
    const wv = webviewRef.current;
    if (!wv) return;
    const done = () => setWebviewLoading(false);
    wv.addEventListener("did-finish-load", done);
    wv.addEventListener("did-fail-load", done);
    return () => {
      wv.removeEventListener("did-finish-load", done);
      wv.removeEventListener("did-fail-load", done);
    };
  }, [playing, playerSource, item.id]);

  // ── Auto-track progress + auto-watched every 5s ──────────────────────────
  useEffect(() => {
    if (!playing || !sourceSupportsProgress(playerSource)) return;
    let interval = null;
    const timer = setTimeout(() => {
      interval = setInterval(async () => {
        try {
          const wv = webviewRef.current;
          if (!wv) return;
          let result;
          // When the pop-out window is open the main webview shows about:blank
          // -> query the pip window's webContents directly.
          if (
            pipWebContentsIdRef.current != null &&
            window.electron?.queryVideoProgress
          ) {
            result = await window.electron.queryVideoProgress(
              pipWebContentsIdRef.current,
            );
          } else if (progressViaFrames && window.electron?.queryVideoProgress) {
            result = await window.electron.queryVideoProgress(
              wv.getWebContentsId(),
            );
          } else {
            result = await wv.executeJavaScript(`
              (() => {
                const v = document.querySelector('video')
                if (!v || !v.duration || v.duration === Infinity || v.paused) return null
                // Re-attach seek tracker if video element was recreated (e.g. quality change)
                if (!v._seekTracked) {
                  v._seekTracked = true
                  v.addEventListener('seeked', () => {
                    v._lastUserSeek = Date.now()
                    v._lastUserSeekTo = v.currentTime
                  })
                }
                return {
                  currentTime: v.currentTime,
                  duration: v.duration,
                  recentUserSeek: v._lastUserSeek ? (Date.now() - v._lastUserSeek < 6000) : false,
                  lastUserSeekTo: v._lastUserSeekTo ?? null,
                }
              })()
            `);
          }
          if (result && result.duration > 0) {
            const ct = result.currentTime;

            // ── Resolution-change reset detection ──────────────────────────
            // Videasy resets to 0 on quality change. We only seek back if:
            // - ct is near zero (≤5s)
            // - we were well into the video (>30s)
            // - the user did NOT manually seek in the last 6s
            const now = Date.now();
            if (
              lastKnownTimeRef.current > 30 &&
              ct <= 5 &&
              !result.recentUserSeek
            ) {
              if (now > seekBackCooldownRef.current) {
                // First reset: seek back and start cooldown
                const seekTo = lastKnownTimeRef.current;
                seekBackCooldownRef.current = now + 8000;
                try {
                  await wv.executeJavaScript(`
                    (() => {
                      const v = document.querySelector('video')
                      if (v) v.currentTime = ${seekTo}
                    })()
                  `);
                } catch {}
              }
              // In both cases (first reset or cooldown): skip progress save with wrong position
              return;
            }

            // If user seeked, update ref to their chosen position immediately
            if (result.recentUserSeek && result.lastUserSeekTo !== null) {
              lastKnownTimeRef.current = result.lastUserSeekTo;
            } else {
              lastKnownTimeRef.current = ct;
            }
            const p = Math.floor((ct / result.duration) * 100);
            saveProgressRef.current(
              progressKey,
              Math.min(p, 100),
              Math.floor(ct),
              Math.floor(result.duration),
            );
            // Also persist actual seconds so DownloadsPage can show resume position
            storage.set("dlTime_" + progressKey, Math.floor(ct));

            // Auto-mark watched when remaining time ≤ threshold
            const remaining = result.duration - ct;
            if (
              !autoMarkedRef.current &&
              remaining <= watchedThreshold &&
              remaining >= 0
            ) {
              autoMarkedRef.current = true;
              onMarkWatchedRef.current?.(progressKey);
            }
          }
        } catch {}
      }, 5000);
    }, 3000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [playing, progressKey, watchedThreshold, playerSource, progressViaFrames]);

  const handlePlay = useCallback(() => {
    setM3u8Url(null);
    setInterceptedSubs([]);
    setPlaying(true);
    onHistory({ ...d, media_type: "movie", server: playerSource });
  }, [d, onHistory, playerSource]);

  // Intercept fullscreen requests from embedded players (vidsrc / 2embed use
  // the native Fullscreen API which would otherwise fullscreen the entire app).
  // Videasy and AllManga handle fullscreen internally via CSS, skip those.
  useEffect(() => {
    if (!playing) return;
    if (!NEEDS_INTERCEPT.includes(playerSource)) return;
    const enterH = window.electron?.onWebviewEnterFullscreen?.(() => {
      setPlayerFullscreen(true);
      document.documentElement.setAttribute("data-player-fullscreen", "1");
    });
    const leaveH = window.electron?.onWebviewLeaveFullscreen?.(() => {
      setPlayerFullscreen(false);
      document.documentElement.removeAttribute("data-player-fullscreen");
      if (document.fullscreenElement) document.exitFullscreen?.();
    });
    return () => {
      if (enterH) window.electron?.offWebviewEnterFullscreen?.(enterH);
      if (leaveH) window.electron?.offWebviewLeaveFullscreen?.(leaveH);
      document.documentElement.removeAttribute("data-player-fullscreen");
    };
  }, [playing, playerSource]);

  // ── PiP pop-out: navigate main webview away so only one stream is active ──
  useEffect(() => {
    if (!playing) return;
    const openH = window.electron?.onPipOpened?.(async () => {
      setPipOpen(true);
      pipWebContentsIdRef.current =
        (await window.electron.getPipWebContentsId?.()) ?? null;
    });
    const closeH = window.electron?.onPipClosed?.(() => {
      pipUrlRef.current = null;
      pipWebContentsIdRef.current = null;
      setPipOpen(false);
    });
    return () => {
      if (openH) window.electron?.offPipOpened?.(openH);
      if (closeH) window.electron?.offPipClosed?.(closeH);
    };
  }, [playing]);

  const handleSetDownloaderFolder = useCallback((folder) => {
    setDownloaderFolder(folder);
    storage.set("downloaderFolder", folder);
  }, []);

  // AniList summaries are English-only; use them only for the English UI.
  const currentLanguage = getCurrentLanguage();
  const displayOverview =
    currentLanguage === "en" && isAnime && anilistData?.description
      ? cleanAnilistDescription(anilistData.description)
      : d.overview;
  const overviewText =
    currentLanguage === "ckb"
      ? d.overview_en || (d.original_language === "en" ? d.overview : "")
      : displayOverview;
  const displayScore =
    isAnime && anilistData?.averageScore
      ? (anilistData.averageScore / 10).toFixed(1)
      : d.vote_average > 0
        ? d.vote_average.toFixed(1)
        : null;
  const displayGenres =
    getCurrentLanguage() === "en" && isAnime && anilistData?.genres?.length
      ? anilistData.genres.map((g, i) => ({ id: i, name: g }))
      : d.genres || [];

  // Unreleased detection
  const isUnreleased = useMemo(() => {
    if (!d.release_date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(d.release_date) > today;
  }, [d.release_date]);

  // Check if this movie is already downloaded or currently downloading
  const movieDownload = (downloads || []).find(
    (dl) =>
      dl.mediaType === "movie" &&
      (dl.tmdbId === item.id || dl.mediaId === item.id) &&
      (dl.status === "completed" ||
        dl.status === "local" ||
        dl.status === "downloading"),
  );

  return (
    <div className="fade-in">
      <div className="detail-hero">
        <div
          className="detail-bg"
          style={{
            backgroundImage: `url(${imgUrl(d.backdrop_path, "w1280")})`,
          }}
        />
        <div className="detail-gradient" />
        <div className="detail-content">
          <div className="detail-poster" style={{ position: "relative" }}>
            {d.poster_path ? (
              <img src={imgUrl(d.poster_path)} alt={title} loading="lazy" />
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
                <FilmIcon />
              </div>
            )}
            {isWatched && (
              <div className="detail-watched-badge">
                <WatchedIcon size={36} />
              </div>
            )}
          </div>
          <div className="detail-info">
            <div className="detail-type">{t("movieTag")}</div>
            <div className="detail-title">{title}</div>
            <div className="genres">
              {displayGenres.map((g) => (
                <span key={g.id || g.name} className="genre-tag">
                  {getLocalizedGenre(g)}
                </span>
              ))}
            </div>
            <div className="detail-meta">
              {displayScore && (
                <span className="detail-rating">
                  <StarIcon /> {displayScore}
                </span>
              )}
              {year && <span>{year}</span>}
              {d.runtime && <span>{d.runtime} {t("min")}</span>}
              {d.original_language && (
                <span>{d.original_language?.toUpperCase()}</span>
              )}
            </div>
            {rating.cert && (
              <div
                className={`age-rating-pill${restricted ? " age-rating-pill--restricted" : ""}`}
              >
                {restricted ? (
                  <RatingLockIcon size={13} />
                ) : (
                  <RatingShieldIcon size={13} />
                )}
                <span className="age-rating-pill-cert">{rating.cert}</span>
                {restricted && (
                  <span className="age-rating-pill-label">
                    {t("inappropriateAge")}
                  </span>
                )}
              </div>
            )}
            {currentLanguage === "ckb" ? (
              <SoraniOverview overview={overviewText} mediaId={item.id} />
            ) : (
              <p className="detail-overview">{displayOverview}</p>
            )}
            {!isWatched && displayPct > 0 && (
              <div className="progress-bar-row" style={{ marginBottom: 12 }}>
                <div className="progress-bar-outer">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.min(displayPct, 100)}%` }}
                  />
                </div>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {progressLabel}
                </span>
              </div>
            )}
            <div className="detail-actions">
              {isUnreleased ? (
                <button
                  className="btn btn-primary btn-restricted"
                  disabled
                  title={t("unreleasedTitle")}
                >
                  🔒 {t("unreleased")}
                </button>
              ) : restricted ? (
                <button
                  className="btn btn-primary btn-restricted"
                  disabled
                  title={t("inappropriateAge")}
                >
                  🔒 {t("restricted")}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handlePlay}>
                  <PlayIcon /> {playing ? t("restart") : t("play")}
                </button>
              )}
              {trailerKey &&
                (restricted ? (
                  <button
                    className="btn btn-secondary btn-restricted"
                    disabled
                    title={t("inappropriateAge")}
                  >
                    🔒 {t("trailer")}
                  </button>
                ) : (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowTrailer(true)}
                  >
                    <TrailerIcon /> {t("trailer")}
                  </button>
                ))}
              <button className="btn btn-secondary" onClick={onSave}>
                {isSaved ? <BookmarkFillIcon /> : <BookmarkIcon />}
                {isSaved ? t("saved") : t("save")}
              </button>
              {!isUnreleased &&
                (isWatched ? (
                  <button
                    className="btn btn-ghost watched-btn"
                    onClick={() => onMarkUnwatched?.(progressKey)}
                  >
                    <WatchedIcon size={16} /> {t("watched")}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() => onMarkWatched?.(progressKey)}
                    >
                      ✓ {t("markWatched")}
                    </button>
                    {hasProgress && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 13 }}
                        onClick={() => {
                          saveProgress(progressKey, 0);
                          storage.set("dlTime_" + progressKey, null);
                        }}
                      >
                        ⊘ {t("notStarted")}
                      </button>
                    )}
                  </>
                ))}
              <button className="btn btn-ghost" onClick={onBack}>
                <BackIcon /> {t("back")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {playing && !restricted && !isUnreleased && (
        <div className="section">
          <div
            className={`player-wrap${playerFullscreen ? " player-wrap--fullscreen" : ""}`}
            ref={playerWrapRef}
          >
            {/* Universal source-loading overlay, shown instantly on every source/item switch */}
            {webviewLoading && !resolveError && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.92)",
                  gap: 14,
                  borderRadius: "inherit",
                }}
              >
                <div className="spinner" />
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  {resolvingUrl
                    ? t("lookingUpMovie")
                    : `Loading ${PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ?? "source"}…`}
                </span>
              </div>
            )}
            {/* AllManga: error if lookup failed */}
            {sourceIsAsync(playerSource) && resolveError && !resolvingUrl && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 10,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.85)",
                  gap: 10,
                  borderRadius: "inherit",
                }}
              >
                <span style={{ fontSize: 28 }}>⚠️</span>
                <span style={{ fontSize: 14, color: "var(--text2)" }}>
                  {t("notFoundOnSource")}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {resolveError}
                </span>
                <span style={{ fontSize: 12, color: "var(--text3)" }}>
                  {t("tryAnotherSource")}
                </span>
              </div>
            )}
            {/* Pop-out active: main stream is paused, pop-out has the real player */}
            {pipOpen && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.92)",
                  gap: 16,
                  borderRadius: "inherit",
                }}
              >
                <PopOutIcon size={36} />
                <span
                  style={{
                    fontSize: 15,
                    color: "var(--text1)",
                    fontWeight: 600,
                  }}
                >
                  {t("playingPopout")}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text2)",
                    textAlign: "center",
                    maxWidth: 260,
                  }}
                >
                  {t("popoutCloseReload")}
                </span>
                <button
                  className="player-overlay-btn"
                  onClick={() => window.electron?.closePipWindow?.()}
                  style={{ marginTop: 4 }}
                >
                  {t("closePopoutReturn")}
                </button>
              </div>
            )}
            {playerSource === "authorized_hls" && resolvedPlayerUrl ? (
              <HlsPlayer
                streamUrl={resolvedPlayerUrl}
                subtitles={
                  githubSub?.available?.length
                    ? githubSub.available
                    : activeSub
                      ? [activeSub]
                      : []
                }
                initialTime={storage.get("dlTime_" + progressKey) || 0}
                onProgress={(time, dur) => {
                  setProgress(progressKey, time, dur);
                }}
                onBack={() => setPlaying(false)}
                accentColor={playerAccentColor}
                onTokenExpired={() => {
                  resolvedPlayerUrlRef.current = null;
                  setResolvedPlayerUrl(null);
                }}
              />
            ) : isElectron ? (
              <webview
                ref={webviewRef}
                src={
                  pipOpen
                    ? "about:blank"
                    : sourceIsAsync(playerSource)
                      ? resolvedPlayerUrl || "about:blank"
                      : getSourceUrl(
                          playerSource,
                          "movie",
                          item.id,
                          null,
                          null,
                          {},
                          playerAccentColor,
                          activeSub?.lang || playerSubLang,
                          activeSub?.url || null,
                        )
                }
                partition="persist:player"
                allowpopups="false"
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                  visibility:
                    webviewLoading ||
                    (sourceIsAsync(playerSource) && !resolvedPlayerUrl)
                      ? "hidden"
                      : "visible",
                }}
              />
            ) : (
              <iframe
                ref={webviewRef}
                src={getSourceUrl(
                  playerSource,
                  "movie",
                  item.id,
                  null,
                  null,
                  {},
                  playerAccentColor,
                  activeSub?.lang || playerSubLang,
                  activeSub?.url || null,
                )}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy="origin"
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                onLoad={() => setWebviewLoading(false)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: "none",
                  background: "#000",
                }}
              />
            )}
            <SubtitleOverlay
              type="movie"
              tmdbId={item.id}
              externalSubtitles={movieOverlaySubtitles}
              playing={playing && !pipOpen && !webviewLoading}
              externalCurrentTime={lastKnownTimeRef.current || null}
              currentTimeRef={lastKnownTimeRef}
            />
            {/* Left-side overlay button group, flex row, no fixed px offsets */}
            <div className="player-overlay-group">
              <button
                ref={sourceRef}
                className="player-overlay-btn"
                onClick={() => {
                  const rect = sourceRef.current?.getBoundingClientRect();
                  if (rect)
                    setMenuPos({ top: rect.bottom + 6, left: rect.left });
                  setShowSourceMenu((v) => !v);
                }}
                title={t("changeSource")}
              >
                <SourceIcon />
                {PLAYER_SOURCES.find((s) => s.id === playerSource)?.label ??
                  t("source")}
              </button>
              {githubSub && (
                <button
                  ref={subRef}
                  className="player-overlay-btn"
                  style={{
                    cursor: "pointer",
                    color: subDisabled ? "var(--text3)" : "#63cab7",
                    borderColor: subDisabled
                      ? "var(--border)"
                      : "rgba(99,202,183,0.35)",
                    opacity: subDisabled ? 0.65 : 1,
                  }}
                  onClick={() => {
                    const rect = subRef.current?.getBoundingClientRect();
                    if (rect)
                      setSubPos({ top: rect.bottom + 6, left: rect.left });
                    setShowSubMenu((v) => !v);
                    setShowSourceMenu(false);
                  }}
                  title={t("subtitles")}
                >
                  CC ·{" "}
                  {subDisabled
                    ? t("turnOffSub")
                    : (activeSub?.lang || githubSub.lang).toUpperCase()}
                </button>
              )}
              {/* Sub/Dub toggle, only for async (AllManga) sources */}
              {sourceIsAsync(playerSource) && (
                <button
                  className="player-overlay-btn"
                  onClick={() => {
                    const next = dubMode === "sub" ? "dub" : "sub";
                    setDubMode(next);
                    storage.set(STORAGE_KEYS.ALLMANGA_DUB_MODE, next);
                    setM3u8Url(null);
                    setInterceptedSubs([]);
                    resolvedPlayerUrlRef.current = null;
                    setResolvedPlayerUrl(null);
                    resolvingUrlRef.current = false;
                    setResolvingUrl(false);
                    setResolveError(null);
                  }}
                  title={t("toggleSubDub")}
                >
                  {dubMode === "sub" ? "SUB" : "DUB"}
                </button>
              )}
              {/* Blocked ads & trackers button (Electron only) */}
              {isElectron && (
                <button
                  className="player-overlay-btn"
                  onClick={() => {
                    setShowSourceMenu(false);
                    setShowBlockedModal(true);
                  }}
                  title={t("blockedAdsTrackers")}
                >
                  <ShieldBlockIcon />
                  {blockedSession > 0 && (
                    <span className="player-blocked-badge">
                      {blockedSession}
                    </span>
                  )}
                </button>
              )}
              {/* Pop-out button (Electron only) */}
              {isElectron && (
                <button
                  className="player-overlay-btn"
                  onClick={() => {
                    if (pipOpen) {
                      window.electron?.closePipWindow?.();
                      return;
                    }
                    const url = sourceIsAsync(playerSource)
                      ? resolvedPlayerUrl
                      : getSourceUrl(
                          playerSource,
                          "movie",
                          item.id,
                          null,
                          null,
                          {},
                          playerAccentColor,
                          activeSub?.lang || playerSubLang,
                          activeSub?.url || null,
                        );
                    if (!url) return;
                    pipUrlRef.current = url;
                    window.electron?.openPipWindow?.(url, item.title);
                  }}
                  title={pipOpen ? t("closePopout") : t("openPopout")}
                  disabled={
                    !pipOpen &&
                    (webviewLoading ||
                      !!(sourceIsAsync(playerSource) && !resolvedPlayerUrl))
                  }
                  style={pipOpen ? { color: "var(--red)" } : undefined}
                >
                  <PopOutIcon />
                </button>
              )}
            </div>
            {showSourceMenu && menuPos && (
              <div
                className="source-dropdown source-dropdown--fixed"
                style={{ top: menuPos.top, left: menuPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                {PLAYER_SOURCES.map((src) => (
                  <button
                    key={src.id}
                    className={
                      "source-dropdown__item" +
                      (playerSource === src.id
                        ? " source-dropdown__item--active"
                        : "")
                    }
                    onClick={() => {
                      setShowSourceMenu(false);
                      if (src.id === playerSource) return;
                      // Manual selection wins over auto-failover
                      clearFailoverSource(`movie_${item.id}_${dubMode}`);
                      setPlayerSource(src.id);
                      storage.set(STORAGE_KEYS.PLAYER_SOURCE, src.id);
                      setM3u8Url(null);
                      setInterceptedSubs([]);
                      resolvedPlayerUrlRef.current = null;
                      setResolvedPlayerUrl(null);
                      resolvingUrlRef.current = false;
                      setResolvingUrl(false);
                      setResolveError(null);
                    }}
                  >
                    <span>{src.label}</span>
                    {src.tag && (
                      <span className="source-dropdown__tag">{src.tag}</span>
                    )}
                    {src.note && (
                      <span className="source-dropdown__note">{src.note}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {showSubMenu && subPos && githubSub && (
              <div
                className="source-dropdown source-dropdown--fixed sub-dropdown"
                style={{ top: subPos.top, left: subPos.left }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    padding: "6px 12px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {t("subtitles")}
                </div>
                {githubSub.available?.map((s) => {
                  const isActive = !subDisabled && activeSub?.lang === s.lang;
                  return (
                    <button
                      key={s.lang}
                      className={
                        "source-dropdown__item" +
                        (isActive ? " source-dropdown__item--active" : "")
                      }
                      onClick={() => {
                        setSelectedSubLang(s.lang);
                        setSubDisabled(false);
                        setShowSubMenu(false);
                      }}
                    >
                      <span>{s.flag}</span>
                      <span>{s.label}</span>
                    </button>
                  );
                })}
                <div
                  style={{
                    height: 1,
                    background: "var(--border)",
                    margin: "4px 0",
                  }}
                />
                <button
                  className={
                    "source-dropdown__item" +
                    (subDisabled ? " source-dropdown__item--active" : "")
                  }
                  onClick={() => {
                    setSubDisabled(true);
                    setShowSubMenu(false);
                  }}
                >
                  <span>⊘</span>
                  <span>{t("turnOffSub")}</span>
                </button>
              </div>
            )}
            {isElectron && (
              <button
                className="player-overlay-btn"
                onClick={() =>
                  movieDownload
                    ? onGoToDownloads?.(movieDownload.id)
                    : (setShowSourceMenu(false), setShowDownload(true))
                }
                title={
                  movieDownload
                    ? movieDownload.status === "downloading"
                      ? t("downloadingViewDownloads")
                      : t("alreadyDownloadedViewDownloads")
                    : t("download")
                }
              >
                {movieDownload ? (
                  <span
                    className="player-downloaded-icon"
                    style={{
                      color:
                        movieDownload.status === "downloading"
                          ? "var(--red)"
                          : "#4caf50",
                    }}
                  >
                    {movieDownload.status === "downloading" ? "↓" : "✓"}
                  </span>
                ) : (
                  <DownloadIcon />
                )}
                {!movieDownload && m3u8Url && (
                  <span className="player-overlay-dot" />
                )}
                {!sourceSupportsProgress(playerSource) && (
                  <span
                    className="player-no-progress-hint"
                    title={t("noAutomaticProgress")}
                  >
                    ⚠ no tracking
                  </span>
                )}
              </button>
            )}
          </div>

          {displayPct > 0 && (
            <div className="progress-bar-row">
              <div className="progress-bar-outer">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${Math.min(displayPct, 100)}%` }}
                />
              </div>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>
                {progressLabel}
              </span>
            </div>
          )}
          <div className="progress-mark-row">
            <span
              style={{ fontSize: 12, color: "var(--text3)", marginRight: 4 }}
            >
              {t("markProgress")}
            </span>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                style={{ padding: "5px 14px", fontSize: 12 }}
                onClick={() => saveProgress(progressKey, p)}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>
      )}

      {collection && onSelect && (
        <div className="section">
          <div className="section-title">{collection.name}</div>
          <div className="scroll-row">
            {collection.parts.map((part) => {
              const pk = `movie_${part.id}`;
              const isCurrent = part.id === item.id;
              return (
                <CollectionCard
                  key={part.id}
                  part={part}
                  pk={pk}
                  isCurrent={isCurrent}
                  onSelect={onSelect}
                  progress={progress[pk] || 0}
                  watched={watched}
                  onMarkWatched={onMarkWatched}
                  onMarkUnwatched={onMarkUnwatched}
                />
              );
            })}
          </div>
        </div>
      )}

      {showTrailer && trailerKey && (
        <TrailerModal
          trailerKey={trailerKey}
          title={title}
          onClose={() => setShowTrailer(false)}
        />
      )}

      {showBlockedModal && (
        <BlockedStatsModal
          sessionDomains={getBlockedDomains()}
          sessionTotal={blockedSession}
          alltimeTotal={blockedAlltime}
          onClose={() => setShowBlockedModal(false)}
        />
      )}

      {showDownload && (
        <DownloadModal
          onClose={() => setShowDownload(false)}
          m3u8Url={m3u8Url}
          subtitles={interceptedSubs}
          mediaName={mediaName}
          downloaderFolder={downloaderFolder}
          setDownloaderFolder={handleSetDownloaderFolder}
          onOpenSettings={onSettings}
          onDownloadStarted={onDownloadStarted}
          mediaId={item.id}
          mediaType="movie"
          posterPath={d.poster_path}
          tmdbId={item.id}
        />
      )}
    </div>
  );
}

// ── CollectionCard ─────────────────────────────────────────────────────────
// Isolated memo'd wrapper so the onClick for each collection part is stable
// and doesn't cause MediaCard to re-render on every progress tick.
const CollectionCard = memo(function CollectionCard({
  part,
  isCurrent,
  onSelect,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
}) {
  const handleClick = useCallback(() => onSelect(part), [onSelect, part]);
  return (
    <div
      style={{
        opacity: isCurrent ? 0.5 : 1,
        pointerEvents: isCurrent ? "none" : "auto",
      }}
    >
      <MediaCard
        item={part}
        onClick={handleClick}
        progress={progress}
        watched={watched}
        onMarkWatched={onMarkWatched}
        onMarkUnwatched={onMarkUnwatched}
      />
    </div>
  );
});
