import React, { useEffect, useRef, useState, useCallback } from "react";

export default function HlsPlayer({
  streamUrl,
  subtitles = [],
  initialTime = 0,
  onProgress,
  onBack,
  onTokenExpired,
  accentColor = "#e50914",
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const initialTimeRef = useRef(initialTime);
  const mediaRecoveryCountRef = useRef(0);
  const networkRetryCountRef = useRef(0);
  const lastProgressSaveRef = useRef(0);

  const [error, setError] = useState(null);
  const [qualities, setQualities] = useState([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [isBuffering, setIsBuffering] = useState(true);

  // Throttled progress updater (every 5 seconds)
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video || !onProgress || !video.duration) return;

    const now = video.currentTime;
    if (Math.abs(now - lastProgressSaveRef.current) >= 5 || video.ended) {
      lastProgressSaveRef.current = now;
      onProgress(now, video.duration);
    }
  }, [onProgress]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hlsInstance = null;
    let isMounted = true;
    setError(null);
    setIsBuffering(true);
    mediaRecoveryCountRef.current = 0;
    networkRetryCountRef.current = 0;

    const applyInitialSeek = () => {
      const seekTo = initialTimeRef.current;
      if (seekTo > 0 && Math.abs(video.currentTime - seekTo) > 1) {
        try {
          video.currentTime = seekTo;
        } catch {}
      }
    };

    // Dynamic import of hls.js to keep initial bundle size lean
    import("hls.js")
      .then(({ default: Hls }) => {
        if (!isMounted) return;

        if (Hls.isSupported()) {
          hlsInstance = new Hls({
            enableWorker: true,
            maxBufferLength: 30,
            backBufferLength: 60,
          });
          hlsRef.current = hlsInstance;

          hlsInstance.loadSource(streamUrl);
          hlsInstance.attachMedia(video);

          hlsInstance.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
            if (!isMounted) return;
            setIsBuffering(false);
            const availableLevels = (data.levels || []).map((lvl, index) => ({
              index,
              height: lvl.height || 0,
              label: lvl.height ? `${lvl.height}p` : `Level ${index + 1}`,
            }));
            setQualities(availableLevels);
            applyInitialSeek();
            video.play().catch(() => {});
          });

          hlsInstance.on(Hls.Events.ERROR, (_, data) => {
            if (!isMounted || !data) return;

            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR: {
                  const status = data.response?.code;
                  // If signed token expired (401 or 403), request a manifest refresh
                  if ((status === 401 || status === 403) && onTokenExpired) {
                    onTokenExpired();
                    return;
                  }

                  if (networkRetryCountRef.current < 2) {
                    networkRetryCountRef.current += 1;
                    hlsInstance.startLoad();
                  } else {
                    setError("تعذر الاتصال بخادم البث المباشر أو انتهت صلاحية الرابط.");
                    hlsInstance.destroy();
                  }
                  break;
                }
                case Hls.ErrorTypes.MEDIA_ERROR: {
                  if (mediaRecoveryCountRef.current < 3) {
                    mediaRecoveryCountRef.current += 1;
                    hlsInstance.recoverMediaError();
                  } else {
                    setError("حدث خطأ أثناء فك تشفير وسائط الفيديو.");
                    hlsInstance.destroy();
                  }
                  break;
                }
                default:
                  setError("تعذر تشغيل هذا البث على جهازك.");
                  hlsInstance.destroy();
                  break;
              }
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Native Safari fallback
          video.src = streamUrl;
          video.addEventListener("loadedmetadata", applyInitialSeek, { once: true });
          video.addEventListener("canplay", () => setIsBuffering(false), { once: true });
          video.play().catch(() => {});
        } else {
          setError("المتصفح الحالي لا يدعم تقنية HLS للبث المباشر.");
        }
      })
      .catch(() => {
        if (isMounted) setError("فشل تحميل مشغل HLS.");
      });

    return () => {
      isMounted = false;
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl, onTokenExpired]);

  const handleQualityChange = (e) => {
    const level = Number(e.target.value);
    setCurrentQuality(level);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
    }
  };

  return (
    <div
      className="hls-player-container"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "#000",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 5,
      }}
    >
      {/* Top Overlay Controls */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          right: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        <div style={{ display: "flex", gap: 10, pointerEvents: "auto" }}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                backdropFilter: "blur(8px)",
              }}
            >
              ← العودة
            </button>
          )}

          {qualities.length > 1 && (
            <select
              value={currentQuality}
              onChange={handleQualityChange}
              style={{
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "6px 10px",
                fontSize: 13,
                cursor: "pointer",
                backdropFilter: "blur(8px)",
              }}
            >
              <option value={-1}>جودة تلقائية (Auto)</option>
              {qualities.map((q) => (
                <option key={q.index} value={q.index}>
                  {q.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            zIndex: 30,
            background: "rgba(18,18,18,0.95)",
            border: "1px solid rgba(229,9,20,0.4)",
            borderRadius: 12,
            padding: "24px 32px",
            textAlign: "center",
            maxWidth: 420,
            color: "#fff",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>خطأ في تشغيل البث</div>
          <div style={{ fontSize: 13, color: "#ccc", marginBottom: 20 }}>{error}</div>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              style={{
                background: accentColor,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 20px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              العودة للقائمة
            </button>
          )}
        </div>
      )}

      {/* Buffering Spinner */}
      {isBuffering && !error && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            pointerEvents: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="spinner" />
        </div>
      )}

      {/* Native HTML5 Video Element */}
      <video
        ref={videoRef}
        controls
        playsInline
        crossOrigin="anonymous"
        onTimeUpdate={handleTimeUpdate}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          background: "#000",
        }}
      >
        {subtitles.map((sub, idx) => {
          const isKurdish = sub.lang === "ku" || sub.lang === "ckb";
          return (
            <track
              key={sub.url || idx}
              kind="subtitles"
              src={sub.url}
              srcLang={sub.lang || (isKurdish ? "ku" : "ar")}
              label={sub.label || (isKurdish ? "کوردی" : "العربية")}
              default={isKurdish || idx === 0}
            />
          );
        })}
      </video>
    </div>
  );
}
