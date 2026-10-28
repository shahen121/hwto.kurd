import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { SubtitlesIcon } from "./Icons";

/**
 * Parse time string (00:01:23.456 or 01:23,456) to seconds
 */
function parseTimestamp(timeStr) {
  if (!timeStr) return 0;
  const cleaned = timeStr.trim().replace(",", ".");
  const parts = cleaned.split(":");
  let secs = 0;
  if (parts.length === 3) {
    secs =
      parseFloat(parts[0]) * 3600 +
      parseFloat(parts[1]) * 60 +
      parseFloat(parts[2]);
  } else if (parts.length === 2) {
    secs = parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  } else {
    secs = parseFloat(parts[0]) || 0;
  }
  return isNaN(secs) ? 0 : secs;
}

/**
 * Parse VTT or SRT raw text into [{ start, end, text }]
 */
export function parseSubtitleText(text) {
  if (!text || typeof text !== "string") return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cues = [];
  let i = 0;

  // Skip WEBVTT header if present
  if (lines[0] && lines[0].includes("WEBVTT")) {
    i = 1;
    while (i < lines.length && lines[i].trim() !== "") i++;
    i++;
  }

  while (i < lines.length) {
    let line = lines[i].trim();

    // Skip empty lines or numeric index lines
    if (!line || /^\d+$/.test(line)) {
      i++;
      continue;
    }

    // Match timestamp line: 00:00:01.000 --> 00:00:04.000
    if (line.includes("-->")) {
      const [startStr, endStr] = line.split("-->").map((s) => s.trim());
      const cleanEnd = endStr.split(/\s+/)[0];
      const start = parseTimestamp(startStr);
      const end = parseTimestamp(cleanEnd);

      i++;
      const textLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].includes("-->")
      ) {
        const textLine = lines[i]
          .replace(/<[^>]+>/g, "") // Strip HTML/formatting tags
          .replace(/\{[^}]+\}/g, "") // Strip ASS tags
          .trim();
        if (textLine && !/^\d+$/.test(textLine)) textLines.push(textLine);
        i++;
      }

      if (textLines.length > 0 && end > start) {
        cues.push({
          start,
          end,
          text: textLines.join("\n"),
        });
      }
    } else {
      i++;
    }
  }

  return cues;
}

const STORAGE_KEYS = {
  SUB_OVERLAY_LANG: "streambert:sub_overlay_lang",
  SUB_OVERLAY_SIZE: "streambert:sub_overlay_size",
  SUB_OVERLAY_OFFSET: "streambert:sub_overlay_offset",
};

/**
 * Universal Subtitle Overlay Component
 * Overlays on top of any external <iframe> / <webview> player
 */
export default function SubtitleOverlay({
  type,
  tmdbId,
  season = null,
  episode = null,
  externalSubtitles = [],
  playing = true,
  externalCurrentTime = null,
  currentTimeRef = null,
}) {
  const [selectedLang, setSelectedLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.SUB_OVERLAY_LANG) || "ku";
    } catch {
      return "ku";
    }
  });

  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEYS.SUB_OVERLAY_SIZE));
      return saved >= 14 && saved <= 36 ? saved : 22;
    } catch {
      return 22;
    }
  });

  const [offsetSec, setOffsetSec] = useState(() => {
    try {
      const saved = parseFloat(
        localStorage.getItem(STORAGE_KEYS.SUB_OVERLAY_OFFSET),
      );
      return isNaN(saved) ? 0 : saved;
    } catch {
      return 0;
    }
  });

  const [showControls, setShowControls] = useState(false);
  const [cues, setCues] = useState([]);
  const [internalTime, setInternalTime] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const [availableSubs, setAvailableSubs] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [customFileName, setCustomFileName] = useState(null);

  const fileInputRef = useRef(null);
  const lastTickRef = useRef(Date.now());
  const fetchedSubtitleKeyRef = useRef(new Map());
  const lastFetchedMediaKeyRef = useRef("");

  // Sync internal time with external progress prop when available
  useEffect(() => {
    if (typeof externalCurrentTime === "number" && externalCurrentTime >= 0) {
      setInternalTime(externalCurrentTime);
      lastTickRef.current = Date.now();
    }
  }, [externalCurrentTime]);

  // Listen to postMessage from iframe players for auto time-sync
  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data;
      if (!d) return;
      let t = null;
      if (typeof d.currentTime === "number") t = d.currentTime;
      else if (typeof d.time === "number") t = d.time;
      else if (d.data && typeof d.data.currentTime === "number")
        t = d.data.currentTime;
      else if (d.data && typeof d.data.time === "number") t = d.data.time;

      if (t !== null && !isNaN(t) && t >= 0) {
        setInternalTime(t);
        lastTickRef.current = Date.now();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Drift-free wall-clock timer & ref synchronization
  useEffect(() => {
    if (!playing || !timerRunning) return;
    lastTickRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;

      // Check if currentTimeRef is provided and has a live position
      const refTime = currentTimeRef?.current;
      if (typeof refTime === "number" && refTime > 0) {
        setInternalTime((prev) => {
          if (Math.abs(refTime - prev) > 1.2) {
            return refTime;
          }
          return prev + delta;
        });
      } else {
        setInternalTime((prev) => prev + delta);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [playing, timerRunning, currentTimeRef]);

  // Stable key for externalSubtitles to avoid unnecessary effect runs
  const externalSubsKey = useMemo(
    () => (externalSubtitles || []).map((s) => `${s.lang}:${s.url}`).join("|"),
    [externalSubtitles],
  );

  // Synchronize availableSubs when externalSubtitles prop actually changes
  useEffect(() => {
    if (externalSubtitles && externalSubtitles.length > 0) {
      setAvailableSubs(externalSubtitles);
    }
  }, [externalSubsKey]);

  // Fetch available subtitles metadata for this media (only once per media key)
  useEffect(() => {
    let active = true;
    if (!tmdbId) return;

    if (externalSubtitles && externalSubtitles.length > 0) {
      return;
    }

    const mediaKey = `${type || "movie"}_${tmdbId}_${season || 1}_${episode || 1}`;
    if (lastFetchedMediaKeyRef.current === mediaKey) {
      return;
    }
    lastFetchedMediaKeyRef.current = mediaKey;

    const query = new URLSearchParams({
      type: type || "movie",
      id: String(tmdbId),
    });
    if (season != null) query.set("season", String(season));
    if (episode != null) query.set("episode", String(episode));

    setLoadingSubs(true);
    fetch(`/api/subtitles?${query.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        if (data && data.ok && Array.isArray(data.subtitles)) {
          setAvailableSubs(data.subtitles);
        } else {
          const itemPath =
            type === "tv"
              ? `tv/${tmdbId}/s${season || 1}e${episode || 1}`
              : `movie/${tmdbId}`;
          setAvailableSubs([
            {
              lang: "ku",
              label: "کوردی (سۆرانی)",
              flag: "☀️",
              url: `/subtitles/${itemPath}/ku.vtt`,
            },
            {
              lang: "ar",
              label: "العربية",
              flag: "🇸🇦",
              url: `/subtitles/${itemPath}/ar.vtt`,
            },
          ]);
        }
      })
      .catch(() => {
        if (!active) return;
        const itemPath =
          type === "tv"
            ? `tv/${tmdbId}/s${season || 1}e${episode || 1}`
            : `movie/${tmdbId}`;
        setAvailableSubs([
          {
            lang: "ku",
            label: "کوردی (سۆرانی)",
            flag: "☀️",
            url: `/subtitles/${itemPath}/ku.vtt`,
          },
          {
            lang: "ar",
            label: "العربية",
            flag: "🇸🇦",
            url: `/subtitles/${itemPath}/ar.vtt`,
          },
        ]);
      })
      .finally(() => {
        if (active) setLoadingSubs(false);
      });

    return () => {
      active = false;
    };
  }, [type, tmdbId, season, episode]);

  // Fetch and parse subtitle file whenever selected language changes.
  // Depends only on primitives [tmdbId, season, episode, selectedLang, type].
  // Uses fetchedSubtitleKeyRef to fetch each .vtt exactly once and prevent infinite loops.
  useEffect(() => {
    if (selectedLang === "off") {
      setCues([]);
      setLoadError(null);
      return;
    }

    if (selectedLang === "custom") {
      // Retain already loaded custom cues
      return;
    }

    if (!tmdbId) {
      setCues([]);
      return;
    }

    const subLangKey = `${type || "movie"}_${tmdbId}_${season || 0}_${episode || 0}_${selectedLang}`;

    // Return immediately if already fetched or previously attempted for this exact media/language
    if (fetchedSubtitleKeyRef.current.has(subLangKey)) {
      const cached = fetchedSubtitleKeyRef.current.get(subLangKey);
      setCues(cached.cues || []);
      setLoadError(cached.error || null);
      return;
    }

    const sub = availableSubs.find((s) => s.lang === selectedLang);
    const targetUrl =
      sub?.url ||
      (type === "tv"
        ? `/subtitles/tv/${tmdbId}/s${season || 1}e${episode || 1}/${selectedLang}.vtt`
        : `/subtitles/movie/${tmdbId}/${selectedLang}.vtt`);

    let active = true;
    setLoadError(null);

    fetch(targetUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (!active) return;
        const parsed = parseSubtitleText(text);
        // Cache result in ref so it is requested only once
        fetchedSubtitleKeyRef.current.set(subLangKey, {
          cues: parsed,
          error: null,
        });
        setCues(parsed);
      })
      .catch((err) => {
        if (!active) return;
        // Cache failure in ref so failed/missing subtitles never trigger an infinite fetch loop
        fetchedSubtitleKeyRef.current.set(subLangKey, {
          cues: [],
          error: err.message,
        });
        setLoadError(err.message);
        setCues([]);
      });

    return () => {
      active = false;
    };
  }, [tmdbId, season, episode, selectedLang, type]);

  // Handle local subtitle file upload
  const handleCustomFileUpload = (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    setCustomFileName(file.name);
    setLoadError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        const parsed = parseSubtitleText(text);
        if (parsed.length > 0) {
          setCues(parsed);
          setSelectedLang("custom");
        } else {
          setLoadError("تعذر قراءة أسطر الترجمة من الملف المحدد");
        }
      } catch (err) {
        setLoadError("خطأ في قراءة ملف الترجمة: " + err.message);
      }
    };
    reader.onerror = () => {
      setLoadError("فشل فتح الملف المحدد");
    };
    reader.readAsText(file);
  };

  const handleLangSelect = (lang) => {
    setSelectedLang(lang);
    try {
      localStorage.setItem(STORAGE_KEYS.SUB_OVERLAY_LANG, lang);
    } catch {}
  };

  const adjustOffset = (delta) => {
    setOffsetSec((prev) => {
      const next = Math.round((prev + delta) * 10) / 10;
      try {
        localStorage.setItem(STORAGE_KEYS.SUB_OVERLAY_OFFSET, String(next));
      } catch {}
      return next;
    });
  };

  const resetOffset = () => {
    setOffsetSec(0);
    try {
      localStorage.setItem(STORAGE_KEYS.SUB_OVERLAY_OFFSET, "0");
    } catch {}
  };

  const adjustTime = (delta) => {
    setInternalTime((prev) => Math.max(0, prev + delta));
  };

  const adjustFontSize = (delta) => {
    setFontSize((prev) => {
      const next = Math.min(36, Math.max(14, prev + delta));
      try {
        localStorage.setItem(STORAGE_KEYS.SUB_OVERLAY_SIZE, String(next));
      } catch {}
      return next;
    });
  };

  // Find active cue matching current adjusted time
  const effectiveTime = internalTime + offsetSec;
  const currentCue = useMemo(() => {
    if (selectedLang === "off" || cues.length === 0) return null;
    return (
      cues.find((c) => effectiveTime >= c.start && effectiveTime <= c.end) ||
      null
    );
  }, [cues, effectiveTime, selectedLang]);

  const isRtl = selectedLang === "ku" || selectedLang === "ar";

  const formatTime = (secs) => {
    const s = Math.max(0, Math.floor(secs));
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? "0" : ""}${sec}`;
  };

  return (
    <div
      className="universal-sub-overlay"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 25,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "center",
      }}
    >
      {/* Floating CC / Overlay Control Pill Button (Top Right) */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          pointerEvents: "auto",
          zIndex: 30,
        }}
      >
        <button
          onClick={() => setShowControls((v) => !v)}
          title="نظام الترجمة الفوقية (Universal Subtitles)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: showControls
              ? "var(--accent, #e50914)"
              : "rgba(20, 20, 20, 0.85)",
            color: "#fff",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: 20,
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            backdropFilter: "blur(4px)",
            transition: "all 0.2s ease",
          }}
        >
          <SubtitlesIcon size={14} />
          <span>
            {selectedLang === "off"
              ? "ترجمة: متوقفة"
              : selectedLang === "custom"
                ? `ملف: ${customFileName || "مخصص"}`
                : `ترجمة: ${selectedLang === "ar" ? "العربية" : "کوردی"}`}
          </span>
          {offsetSec !== 0 && (
            <span
              style={{
                background: "rgba(255,255,255,0.25)",
                padding: "1px 4px",
                borderRadius: 4,
                fontSize: 10,
              }}
            >
              {offsetSec > 0 ? `+${offsetSec}s` : `${offsetSec}s`}
            </span>
          )}
        </button>
      </div>

      {/* Settings Modal / Controls Drawer */}
      {showControls && (
        <div
          style={{
            position: "absolute",
            top: 48,
            right: 12,
            width: 320,
            background: "rgba(18, 18, 22, 0.95)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#fff",
            pointerEvents: "auto",
            zIndex: 35,
            boxShadow: "0 8px 24px rgba(0,0,0,0.8)",
            backdropFilter: "blur(10px)",
            fontSize: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              borderBottom: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: 6,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13, color: "#63cab7" }}>
              🎬 الترجمة الفوقية (Universal Subtitles)
            </span>
            <button
              onClick={() => setShowControls(false)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text3, #888)",
                cursor: "pointer",
                fontSize: 14,
                padding: "2px 6px",
              }}
            >
              ✕
            </button>
          </div>

          {/* Language Selection */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: "var(--text2, #aaa)", marginBottom: 5 }}>
              اللغة (Language):
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => handleLangSelect("ku")}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor:
                    selectedLang === "ku"
                      ? "#63cab7"
                      : "rgba(255,255,255,0.15)",
                  background:
                    selectedLang === "ku"
                      ? "rgba(99,202,183,0.25)"
                      : "rgba(255,255,255,0.05)",
                  color: selectedLang === "ku" ? "#fff" : "var(--text2, #ccc)",
                  cursor: "pointer",
                  fontWeight: selectedLang === "ku" ? 700 : 500,
                }}
              >
                ☀️ کوردی
              </button>
              <button
                onClick={() => handleLangSelect("ar")}
                style={{
                  flex: 1,
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor:
                    selectedLang === "ar"
                      ? "#63cab7"
                      : "rgba(255,255,255,0.15)",
                  background:
                    selectedLang === "ar"
                      ? "rgba(99,202,183,0.25)"
                      : "rgba(255,255,255,0.05)",
                  color: selectedLang === "ar" ? "#fff" : "var(--text2, #ccc)",
                  cursor: "pointer",
                  fontWeight: selectedLang === "ar" ? 700 : 500,
                }}
              >
                🇸🇦 العربية
              </button>
              <button
                onClick={() => handleLangSelect("off")}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid",
                  borderColor:
                    selectedLang === "off"
                      ? "var(--red, #e50914)"
                      : "rgba(255,255,255,0.15)",
                  background:
                    selectedLang === "off"
                      ? "rgba(229,9,20,0.25)"
                      : "rgba(255,255,255,0.05)",
                  color: selectedLang === "off" ? "#fff" : "var(--text2, #ccc)",
                  cursor: "pointer",
                }}
              >
                ⊘ إيقاف
              </button>
            </div>
          </div>

          {/* Sync Offset Controls (+0.5s / -0.5s) */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "var(--text2, #aaa)",
                marginBottom: 5,
              }}
            >
              <span>مزامنة التوقيت (Delay / Advance):</span>
              <span
                style={{
                  color: offsetSec !== 0 ? "#63cab7" : "#fff",
                  fontWeight: 700,
                }}
              >
                {offsetSec > 0 ? `+${offsetSec}s` : `${offsetSec}s`}
              </span>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button
                onClick={() => adjustOffset(-0.5)}
                style={{
                  flex: 1,
                  padding: "5px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                title="تقديم الترجمة 0.5 ثانية"
              >
                -0.5s
              </button>
              <button
                onClick={() => adjustOffset(-0.1)}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                title="تقديم 0.1 ثانية"
              >
                -0.1s
              </button>
              <button
                onClick={resetOffset}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#aaa",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                title="إعادة ضبط الفارق إلى 0"
              >
                0.0s
              </button>
              <button
                onClick={() => adjustOffset(0.1)}
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                title="تأخير 0.1 ثانية"
              >
                +0.1s
              </button>
              <button
                onClick={() => adjustOffset(0.5)}
                style={{
                  flex: 1,
                  padding: "5px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 11,
                }}
                title="تأخير الترجمة 0.5 ثانية"
              >
                +0.5s
              </button>
            </div>
          </div>

          {/* Quick Seek / Jump (+10s / -10s) */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: "var(--text2, #aaa)",
                marginBottom: 5,
              }}
            >
              <span>قفز سريع بالتوقيت:</span>
              <span style={{ fontSize: 11, color: "var(--text3, #888)" }}>
                {formatTime(effectiveTime)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button
                onClick={() => adjustTime(-60)}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title="رجوع دقيقة"
              >
                -1m
              </button>
              <button
                onClick={() => adjustTime(-10)}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title="رجوع 10 ثوان"
              >
                -10s
              </button>
              <button
                onClick={() => setTimerRunning((v) => !v)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  background: timerRunning
                    ? "rgba(76,175,80,0.2)"
                    : "rgba(255,255,255,0.1)",
                  border: "1px solid",
                  borderColor: timerRunning
                    ? "#4caf50"
                    : "rgba(255,255,255,0.2)",
                  color: timerRunning ? "#4caf50" : "#aaa",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title={timerRunning ? "إيقاف مؤقت للعداد" : "تشغيل العداد"}
              >
                {timerRunning ? "❚❚ إيقاف" : "▶ تشغيل"}
              </button>
              <button
                onClick={() => adjustTime(10)}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title="تقديم 10 ثوان"
              >
                +10s
              </button>
              <button
                onClick={() => adjustTime(60)}
                style={{
                  flex: 1,
                  padding: "4px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title="تقديم دقيقة"
              >
                +1m
              </button>
            </div>
          </div>

          {/* Font Size & Local File Upload */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
              paddingTop: 6,
              borderTop: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--text2, #aaa)" }}>حجم الخط:</span>
              <button
                onClick={() => adjustFontSize(-2)}
                style={{
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                A-
              </button>
              <span style={{ fontWeight: 700 }}>{fontSize}px</span>
              <button
                onClick={() => adjustFontSize(2)}
                style={{
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                A+
              </button>
            </div>

            {/* Custom file button */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".vtt,.srt"
                style={{ display: "none" }}
                onChange={handleCustomFileUpload}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "rgba(99,202,183,0.15)",
                  border: "1px solid rgba(99,202,183,0.3)",
                  color: "#63cab7",
                  cursor: "pointer",
                  fontSize: 10,
                }}
                title="تحميل ملف ترجمة محلي (.srt أو .vtt)"
              >
                📁 رفع ملف
              </button>
            </div>
          </div>

          {/* Status note */}
          {loadError && (
            <div
              style={{
                color: "var(--red, #ff5555)",
                fontSize: 11,
                marginTop: 4,
              }}
            >
              تعذر تحميل ملف الترجمة: {loadError}
            </div>
          )}
          {cues.length > 0 && (
            <div style={{ color: "#63cab7", fontSize: 10, marginTop: 4 }}>
              ✓ تم تحميل {cues.length} سطر ترجمة بنجاح
            </div>
          )}
        </div>
      )}

      {/* Subtitle Cue Text Display */}
      {currentCue && selectedLang !== "off" && (
        <div
          style={{
            marginBottom: 50,
            maxWidth: "88%",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              display: "inline-block",
              background: "rgba(0, 0, 0, 0.8)",
              color: "#ffffff",
              fontSize: `${fontSize}px`,
              lineHeight: 1.4,
              fontFamily: '"Tahoma", "Segoe UI", "Arial", sans-serif',
              fontWeight: 600,
              padding: "4px 16px",
              borderRadius: 6,
              textShadow:
                "0 2px 4px rgba(0,0,0,0.9), 0 0 2px #000, 0 0 4px #000",
              direction: isRtl ? "rtl" : "ltr",
              unicodeBidi: "plaintext",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {currentCue.text}
          </span>
        </div>
      )}
    </div>
  );
}
