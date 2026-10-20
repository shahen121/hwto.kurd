import { useState, useEffect, useCallback } from "react";
import { CloseIcon, DownloadIcon, SettingsIcon, SubtitlesIcon } from "./Icons";
import {
  storage,
  STORAGE_KEYS,
  secureStorage,
  isElectron,
} from "../utils/storage";
import {
  SUBTITLE_LANGUAGES,
  LANG_LABEL,
  sourceBadgeStyle,
  sourceBadgeLabel,
} from "../utils/subtitles";
import { t } from "../utils/i18n";

// ── Subtitle Browser (standalone component to avoid re-mount on parent re-render) ──
export function SubtitleBrowser({
  tmdbId,
  mediaType,
  season,
  episode,
  subdlApiKey,
  wyzieApiKey,
  selectedSubs,
  setSelectedSubs,
  onClose,
  defaultLang,
}) {
  const [langFilter, setLangFilter] = useState(defaultLang);
  const [browseResults, setBrowseResults] = useState(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState(null);

  const doSearch = async (lang) => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const res = await window.electron.searchSubtitles({
        tmdbId,
        mediaType,
        season,
        episode,
        languages: lang || "",
        subdlApiKey,
        wyzieApiKey,
      });
      if (!res.ok) {
        const errMsg = res.error || t("errorLoading");
        const is403 =
          errMsg.includes("403") ||
          errMsg.toLowerCase().includes("cannot consume");
        setBrowseError(
          is403
            ? t("apiKeyError")
            : errMsg,
        );
        setBrowseResults([]);
      } else setBrowseResults(res.results);
    } catch (e) {
      setBrowseError(e.message);
      setBrowseResults([]);
    } finally {
      setBrowsing(false);
    }
  };

  useEffect(() => {
    doSearch(langFilter);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => onClose()}
    >
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: 580,
          maxWidth: "95vw",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontWeight: 600,
              fontSize: 15,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <SubtitlesIcon size={14} /> {t("searchSubtitles")}
            {selectedSubs.length > 0
              ? ` · ${selectedSubs.length} ${t("selectedCount")}`
              : ""}
          </span>
          <button className="icon-btn" onClick={() => onClose()}>
            <CloseIcon />
          </button>
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            {t("language")}:
          </span>
          <select
            value={langFilter}
            onChange={(e) => {
              setLangFilter(e.target.value);
              doSearch(e.target.value);
            }}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text)",
              padding: "5px 10px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <option value="">{t("allLanguages")}</option>
            {SUBTITLE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
          {browsing && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: 24,
                color: "var(--text3)",
                fontSize: 13,
              }}
            >
              <div
                className="spinner"
                style={{ width: 16, height: 16, borderWidth: 2 }}
              />{" "}
              {t("searching")}
            </div>
          )}
          {browseError && (
            <div
              style={{
                padding: "16px 20px",
                color: "var(--red)",
                fontSize: 13,
              }}
            >
              ⚠ {browseError}
            </div>
          )}
          {!browsing && browseResults?.length === 0 && (
            <div
              style={{
                padding: "20px",
                color: "var(--text3)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {t("noSubtitlesFound")}
            </div>
          )}
          {!browsing &&
            browseResults?.map((r) => {
              const isSelected = selectedSubs.some(
                (s) => s.file_id === r.file_id,
              );
              return (
                <div
                  key={r.file_id}
                  onClick={() => {
                    setSelectedSubs((prev) =>
                      isSelected
                        ? prev.filter((s) => s.file_id !== r.file_id)
                        : [...prev, r],
                    );
                  }}
                  style={{
                    padding: "9px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border)",
                    background: isSelected
                      ? "rgba(229,9,20,0.08)"
                      : "transparent",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "var(--surface2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected
                      ? "rgba(229,9,20,0.08)"
                      : "transparent";
                  }}
                >
                  {/* Checkbox */}
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      border: `2px solid ${isSelected ? "var(--red)" : "var(--border)"}`,
                      background: isSelected ? "var(--red)" : "transparent",
                      flexShrink: 0,
                      marginTop: 2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.15s",
                    }}
                  >
                    {isSelected && (
                      <span
                        style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}
                      >
                        ✓
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        marginBottom: 3,
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: "rgba(99,202,183,0.15)",
                          color: "#63cab7",
                          border: "1px solid rgba(99,202,183,0.3)",
                          textTransform: "uppercase",
                        }}
                      >
                        {r.language}
                      </span>
                      <span style={sourceBadgeStyle(r)}>
                        {sourceBadgeLabel(r)}
                      </span>
                      {r.hearing_impaired && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title={t("hearingImpaired")}
                        >
                          ♿
                        </span>
                      )}
                      {r.ai_translated && (
                        <span
                          style={{ fontSize: 10, color: "var(--text3)" }}
                          title={t("aiTranslated")}
                        >
                          🤖
                        </span>
                      )}
                      {r.from_trusted && (
                        <span
                          style={{ fontSize: 10, color: "#4caf50" }}
                          title={t("trusted")}
                        >
                          ✓
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text)",
                        marginBottom: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.release ||
                        r.file_name ||
                        `${r.language.toUpperCase()} subtitle`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      {r.uploader} · {(r.download_count || 0).toLocaleString()}{" "}
                      {t("subtitleDownloads")}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            {selectedSubs.length === 0
              ? t("subtitleSearchHint")
              : `${selectedSubs.length} ${t("subtitlesTitle")} ${t("selectedCount")}`}
          </span>
          <button
            className="btn btn-primary"
            style={{ padding: "6px 18px", fontSize: 13 }}
            onClick={() => onClose()}
          >
            {t("done")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DownloadModal({
  onClose,
  m3u8Url,
  subtitles = [],
  mediaName,
  downloaderFolder,
  setDownloaderFolder,
  onOpenSettings,
  onDownloadStarted,
  mediaId,
  mediaType,
  season,
  episode,
  posterPath,
  tmdbId,
}) {
  const [downloadPath, setDownloadPath] = useState(
    () => storage.get("downloadPath") || "",
  );
  const [settingPath, setSettingPath] = useState(false);
  const [downloader, setDownloader] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState(null);

  const [subEnabled, setSubEnabled] = useState(
    () =>
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== 0 &&
      storage.get(STORAGE_KEYS.SUBTITLE_ENABLED) !== "0",
  );
  const [subdlApiKey, setSubdlApiKey] = useState("");
  const [wyzieApiKey, setWyzieApiKey] = useState(null); // null = not yet loaded

  useEffect(() => {
    let mounted = true;
    Promise.all([
      secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY),
      secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY),
    ]).then(([subdl, wyzie]) => {
      if (!mounted) return;
      if (subdl) setSubdlApiKey(subdl);
      const wyzieKey = wyzie || "";
      setWyzieApiKey(wyzieKey);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const defaultLang = storage.get(STORAGE_KEYS.SUBTITLE_LANG) || "en";

  const [subResults, setSubResults] = useState(null);
  const [subSearching, setSubSearching] = useState(false);
  const [subSearchError, setSubSearchError] = useState(null);
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [showBrowser, setShowBrowser] = useState(false);

  const canSearchOS = isElectron && !!tmdbId;

  const ua = navigator.userAgent.toLowerCase();
  const binaryHint = ua.includes("win")
    ? "Windows_x64-portable"
    : ua.includes("mac")
      ? t("macDownloaderBuildNote")
      : "Linux_x64-portable";
  const releaseUrl =
    "https://github.com/truelockmc/vid-dl-cli-only/releases/latest";

  useEffect(() => {
    if (!downloaderFolder || !isElectron) return;
    let mounted = true;
    setChecking(true);
    window.electron.checkDownloader(downloaderFolder).then((result) => {
      if (!mounted) return;
      setDownloader(result);
      setChecking(false);
    });
    return () => {
      mounted = false;
    };
  }, [downloaderFolder]);

  const searchSubtitles = useCallback(
    async (lang) => {
      if (!canSearchOS) return;
      setSubSearching(true);
      setSubSearchError(null);
      setSubResults(null);
      setSelectedSubs([]);
      try {
        const res = await window.electron.searchSubtitles({
          tmdbId,
          mediaType,
          season,
          episode,
          languages: lang,
          subdlApiKey,
          wyzieApiKey: wyzieApiKey || "",
        });
        if (!res.ok) {
          const errMsg = res.error || t("errorLoading");
          const is403 =
            errMsg.includes("403") ||
            errMsg.toLowerCase().includes("cannot consume");
          if (!is403) console.error("Subtitle search failed:", errMsg);
          setSubSearchError(
            is403 ? t("subtitleApiKeyError") : t("subtitleSearchFailed"),
          );
          setSubResults([]);
          return;
        }
        setSubResults(res.results);
        if (res.results.length > 0) setSelectedSubs([res.results[0]]);
      } catch (e) {
        console.error("Subtitle search failed:", e);
        setSubSearchError(t("subtitleSearchFailed"));
        setSubResults([]);
      } finally {
        setSubSearching(false);
      }
    },
    [canSearchOS, tmdbId, mediaType, season, episode, subdlApiKey, wyzieApiKey],
  );

  useEffect(() => {
    if (!m3u8Url || !subEnabled || !canSearchOS) return;
    if (wyzieApiKey === null) return; // still loading
    if (!wyzieApiKey && !subdlApiKey) return;
    searchSubtitles(defaultLang);
  }, [m3u8Url, subEnabled, wyzieApiKey]);

  const pickBinaryFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) setDownloaderFolder(folder);
  };
  const pickDownloadFolder = async () => {
    const folder = await window.electron.pickFolder();
    if (folder) {
      setDownloadPath(folder);
      storage.set("downloadPath", folder);
      setSettingPath(false);
    }
  };

  const handleDownload = async () => {
    if (!downloader?.token || !downloadPath || !m3u8Url) return;
    setDownloadStatus("starting");

    let resolvedSubs = [...subtitles];
    if (subEnabled && selectedSubs.length > 0) {
      for (const sub of selectedSubs) {
        try {
          let url = sub.direct_url || null;
          let resolvedFileName = null;
          if (!url && sub.file_id) {
            const urlRes = await window.electron.getSubtitleUrl({
              fileId: sub.file_id,
            });
            if (urlRes.ok) {
              url = urlRes.url;
              resolvedFileName = urlRes.file_name || null;
            }
          }
          if (url) {
            resolvedSubs.push({
              url,
              lang: sub.language,
              name: resolvedFileName || sub.release || sub.file_name,
              file_id: sub.file_id || null,
            });
          }
        } catch {}
      }
    }

    const result = await window.electron.runDownload({
      token: downloader.token,
      m3u8Url,
      subtitles: resolvedSubs,
      name: mediaName,
      downloadPath,
      mediaId,
      mediaType,
      season,
      episode,
      posterPath: posterPath || null,
      tmdbId: tmdbId || mediaId || null,
    });

    if (result.ok) {
      onDownloadStarted?.({
        id: result.id,
        name: mediaName,
        m3u8Url,
        downloadPath,
        filePath: null,
        status: "downloading",
        progress: 0,
        speed: "",
        size: "",
        totalFragments: 0,
        lastMessage: "Starting…",
        startedAt: Date.now(),
        completedAt: null,
        mediaId,
        mediaType,
        season,
        episode,
        posterPath: posterPath || null,
        tmdbId: tmdbId || mediaId || null,
        subtitles: resolvedSubs,
        subtitlePaths: [],
      });
      setDownloadStatus("ok");
    } else {
      console.error("Failed to start download:", result.error);
      setDownloadStatus(t("downloadStartFailed"));
    }
  };

  // ── No download path ───────────────────────────────────────────────────────
  if (!downloadPath || settingPath) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="download-modal" onClick={(e) => e.stopPropagation()}>
          <div className="download-modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadIcon /> {t("setDownloadFolder")}
            </span>
            <button className="icon-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <div style={{ padding: 24 }}>
            <div
              style={{
                fontSize: 14,
                color: "var(--text2)",
                marginBottom: 20,
                lineHeight: 1.6,
              }}
            >
              {settingPath ? (
                t("chooseDownloadFolderSetting")
              ) : (
                <>
                  <span style={{ color: "var(--red)", fontWeight: 600 }}>
                    {t("noDownloadFolder")}
                  </span>
                  <br />
                  {t("chooseDownloadFolder")}
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <input
                className="apikey-input"
                style={{ flex: 1, minWidth: 200, marginBottom: 0 }}
                placeholder="/home/you/Movies"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
              />
              {isElectron && (
                <button
                  className="btn btn-secondary"
                  onClick={pickDownloadFolder}
                >
                  {t("browse")} …
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1, justifyContent: "center" }}
                disabled={!downloadPath.trim()}
                onClick={() => {
                  storage.set("downloadPath", downloadPath.trim());
                  setSettingPath(false);
                }}
              >
                {t("confirm")}
              </button>
              {settingPath && (
                <button
                  className="btn btn-ghost"
                  onClick={() => setSettingPath(false)}
                >
                  {t("cancel")}
                </button>
              )}
            </div>
            {onOpenSettings && (
              <div style={{ marginTop: 14, textAlign: "center" }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, color: "var(--text3)" }}
                  onClick={() => {
                    onClose();
                    onOpenSettings("downloads");
                  }}
                >
                  <SettingsIcon /> {t("openSettings")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main modal ─────────────────────────────────────────────────────────────
  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="download-modal" onClick={(e) => e.stopPropagation()}>
          <div className="download-modal-header">
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <DownloadIcon /> {t("download")}
            </span>
            <button className="icon-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>

          {!m3u8Url && (
            <div className="download-waiting">
              <div
                className="spinner"
                style={{ width: 24, height: 24, borderWidth: 2 }}
              />
              {t("waitingForStream")}
            </div>
          )}

          {m3u8Url && (
            <>
              <div className="download-url-block">
                <div className="download-url-label">{t("streamUrlFound")}</div>
                <code className="download-url-code">{m3u8Url}</code>
              </div>

              {/* ── Subtitle section ──────────────────────────────────────── */}
              <div
                style={{
                  padding: "12px 20px",
                  borderBottom: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: subEnabled ? 8 : 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <SubtitlesIcon size={14} /> {t("subtitlesTitle")}
                  </span>
                  <div style={{ flex: 1 }} />
                  {/* Toggle */}
                  <button
                    onClick={() => {
                      const next = !subEnabled;
                      setSubEnabled(next);
                      storage.set(STORAGE_KEYS.SUBTITLE_ENABLED, next ? 1 : 0);
                      if (next && canSearchOS) {
                        if (wyzieApiKey || subdlApiKey) {
                          if (!subResults) searchSubtitles(defaultLang);
                        }
                      }
                    }}
                    title={
                      subEnabled
                        ? t("disableSubtitleDownload")
                        : t("enableSubtitleDownload")
                    }
                    style={{
                      width: 36,
                      height: 20,
                      borderRadius: 10,
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      background: subEnabled ? "var(--red)" : "var(--surface2)",
                      position: "relative",
                      transition: "background 0.2s",
                      flexShrink: 0,
                      outline: "none",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: subEnabled ? 18 : 2,
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: "#fff",
                        transition: "left 0.2s",
                      }}
                    />
                  </button>
                </div>

                {subEnabled && (
                  <>
                    {!canSearchOS && (
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>
                        {t("subtitleSearchUnavailable")}
                      </div>
                    )}
                    {canSearchOS &&
                      !wyzieApiKey &&
                      !subdlApiKey &&
                      wyzieApiKey !== null && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text2)",
                            background: "var(--surface2)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "10px 12px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          <span>
                            <span
                              style={{ color: "var(--red)", fontWeight: 600 }}
                            >
                              {t("noSubtitleKey")}
                            </span>{" "}
                            {t("subtitleKeyInstructions")}
                          </span>
                          {onOpenSettings && (
                            <button
                              className="btn btn-ghost"
                              style={{
                                alignSelf: "flex-start",
                                padding: "2px 8px",
                                fontSize: 11,
                              }}
                              onClick={() => {
                                onClose();
                                onOpenSettings("subtitles");
                              }}
                            >
                              <SettingsIcon /> {t("openSubtitleSettings")}
                            </button>
                          )}
                        </div>
                      )}
                    {subSearching && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 12,
                          color: "var(--text3)",
                        }}
                      >
                        <div
                          className="spinner"
                          style={{ width: 12, height: 12, borderWidth: 1.5 }}
                        />
                        {t("searching")} {LANG_LABEL[defaultLang] || defaultLang}{" "}
                        {t("subtitlesTitle")}…
                      </div>
                    )}
                    {subSearchError && !subSearching && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--red)",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        ⚠ {subSearchError}
                        <button
                          className="btn btn-ghost"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          onClick={() => searchSubtitles(defaultLang)}
                        >
                          {t("retry")}
                        </button>
                        {onOpenSettings && (
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "2px 8px", fontSize: 11 }}
                            onClick={() => {
                              onClose();
                              onOpenSettings("subtitles");
                            }}
                          >
                            {t("openSettings")}
                          </button>
                        )}
                      </div>
                    )}
                    {canSearchOS &&
                      !subSearching &&
                      subResults !== null &&
                      !subSearchError && (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            width: "100%",
                          }}
                        >
                          {selectedSubs.length > 0 ? (
                            <>
                              {selectedSubs.map((sub) => (
                                <div
                                  key={sub.file_id}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid var(--border)",
                                    borderRadius: 6,
                                    padding: "4px 8px",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      padding: "1px 5px",
                                      borderRadius: 3,
                                      background: "rgba(99,202,183,0.15)",
                                      color: "#63cab7",
                                      border: "1px solid rgba(99,202,183,0.3)",
                                      textTransform: "uppercase",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {sub.language}
                                  </span>
                                  <span style={sourceBadgeStyle(sub)}>
                                    {sourceBadgeLabel(sub)}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: 12,
                                      color: "var(--text2)",
                                      flex: 1,
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      minWidth: 0,
                                    }}
                                  >
                                    {sub.release ||
                                      sub.file_name ||
                                      `${sub.language.toUpperCase()} subtitle`}
                                  </span>
                                  <button
                                    className="btn btn-ghost"
                                    style={{
                                      padding: "1px 6px",
                                      fontSize: 11,
                                      flexShrink: 0,
                                      color: "var(--text3)",
                                    }}
                                    onClick={() =>
                                      setSelectedSubs((prev) =>
                                        prev.filter(
                                          (s) => s.file_id !== sub.file_id,
                                        ),
                                      )
                                    }
                                    title={t("remove")}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </>
                          ) : (
                            <span
                              style={{ fontSize: 12, color: "var(--text3)" }}
                            >
                              {t("noSubtitleSearchResults")}{" "}
                              {LANG_LABEL[defaultLang] || defaultLang}
                            </span>
                          )}
                          <div
                            style={{ display: "flex", gap: 8, marginTop: 2 }}
                          >
                            <button
                              className="btn btn-ghost"
                              style={{ padding: "3px 10px", fontSize: 11 }}
                              onClick={() => setShowBrowser(true)}
                            >
                              {selectedSubs.length > 0
                                ? `＋ ${t("addOrChange")}`
                                : t("browse")}
                            </button>
                            {selectedSubs.length > 0 && (
                              <button
                                className="btn btn-ghost"
                                style={{
                                  padding: "3px 8px",
                                  fontSize: 11,
                                  color: "var(--text3)",
                                }}
                                onClick={() => setSelectedSubs([])}
                                title={t("clearAll")}
                              >
                                {t("clearAll")}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    {canSearchOS &&
                      !subSearching &&
                      subResults === null &&
                      !subSearchError && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <span style={{ fontSize: 12, color: "var(--text3)" }}>
                            {t("notSearchedYet")}
                          </span>
                          <button
                            className="btn btn-ghost"
                            style={{ padding: "3px 10px", fontSize: 11 }}
                            onClick={() => searchSubtitles(defaultLang)}
                          >
                            {t("search")}
                          </button>
                        </div>
                      )}
                    {!subdlApiKey && (
                      <div
                        style={{
                          marginTop: 5,
                          fontSize: 11,
                          color: "var(--text3)",
                        }}
                      >
                        💡 {t("addFreeSubdlKey")}
                        results
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* ── Downloader setup ──────────────────────────────────────── */}
              {!downloader?.exists && (
                <div className="download-instructions">
                  <div className="download-instructions-title">
                    {t("downloaderSetup")}
                  </div>
                  <ol className="download-steps">
                    <li>
                      {t("downloadLatestRelease")}{" "}
                      <a
                        className="download-link"
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          isElectron &&
                            window.electron.openExternal(releaseUrl);
                        }}
                      >
                        github.com/truelockmc/vid-dl-cli-only/releases/latest
                      </a>{" "}
                      , {t("forYourOS")} <code>{binaryHint}</code>
                    </li>
                    <li>{t("extractRelease")}</li>
                    <li>
                      {t("selectDownloaderFolder")} <code>_internal</code>{" "}
                      {t("andBinary")}
                    </li>
                  </ol>
                  <div className="download-folder-row">
                    <button
                      className="btn btn-secondary"
                      onClick={pickBinaryFolder}
                    >
                      {t("chooseFolder")}
                    </button>
                    {downloaderFolder && (
                      <span className="download-folder-path">
                        {downloaderFolder}
                      </span>
                    )}
                  </div>
                  {checking && (
                    <div className="download-checking">
                      <div
                        className="spinner"
                        style={{ width: 16, height: 16, borderWidth: 2 }}
                      />{" "}
                      {t("checking")}
                    </div>
                  )}
                  {!checking &&
                    downloader &&
                    !downloader.exists &&
                    downloaderFolder && (
                      <div className="download-error">
                        {downloader.reason === "folder_permission" && (
                          <>{t("folderPermissionDenied")}</>
                        )}
                        {downloader.reason === "folder_unreadable" && (
                          <>{t("folderUnreadable")}</>
                        )}
                        {downloader.reason === "no_internal" && (
                          <>
                            {t("missingInternalFolder")}
                          </>
                        )}
                        {(downloader.reason === "no_executable" ||
                          !downloader.reason) && (
                          <>
                            {t("missingExecutable")} (<code>chmod +x</code>).
                          </>
                        )}
                      </div>
                    )}
                </div>
              )}

              {downloader?.exists && (
                <div className="download-ready">
                  <div className="download-found-badge">
                    {t("downloaderFound")}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      marginBottom: 14,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      {t("wrongBinaryFolder")}
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={pickBinaryFolder}
                    >
                      {t("change")}
                    </button>
                  </div>

                  {downloadStatus !== "ok" && (
                    <button
                      className="btn btn-primary"
                      onClick={handleDownload}
                      disabled={downloadStatus === "starting"}
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      <DownloadIcon />
                      {downloadStatus === "starting"
                        ? t("starting")
                        : t("startDownload")}
                    </button>
                  )}

                  {downloadStatus === "ok" && (
                    <div style={{ textAlign: "center", padding: "12px 0" }}>
                      <div
                        className="download-success"
                        style={{ fontSize: 15, marginBottom: 8 }}
                      >
                        {t("downloadStarted")}
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 13 }}
                        onClick={onClose}
                      >
                        {t("closeTrackDownloads")}
                      </button>
                    </div>
                  )}
                  {downloadStatus &&
                    downloadStatus !== "ok" &&
                    downloadStatus !== "starting" && (
                      <div className="download-error">{downloadStatus}</div>
                    )}

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                      marginTop: 14,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text3)" }}>
                      {t("saveTo")} <code>{downloadPath}</code>
                    </span>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => setSettingPath(true)}
                    >
                      {t("change")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {showBrowser && (
        <SubtitleBrowser
          tmdbId={tmdbId}
          mediaType={mediaType}
          season={season}
          episode={episode}
          subdlApiKey={subdlApiKey}
          wyzieApiKey={wyzieApiKey || ""}
          selectedSubs={selectedSubs}
          setSelectedSubs={setSelectedSubs}
          onClose={() => setShowBrowser(false)}
          defaultLang={defaultLang}
        />
      )}
    </>
  );
}
