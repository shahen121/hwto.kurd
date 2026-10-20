import { useState, useEffect } from "react";
import { TRANSLATIONS } from "../utils/i18n";

export default function LanguageLoadingModal({ targetLang, onComplete }) {
  const [progress, setProgress] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);

  // Translations corresponding to the target language (shows target language immediately as a preview)
  const dict = TRANSLATIONS[targetLang] || TRANSLATIONS.ar;
  const isRtl = targetLang === "ar" || targetLang === "ckb";

  const steps = [
    dict.langSwitchingStep1,
    dict.langSwitchingStep2,
    dict.langSwitchingStep3,
    dict.langSwitchingStep4,
  ];

  useEffect(() => {
    const totalDuration = 2500; // Accelerated dynamic loading (~2.5s)
    const intervalTime = 30;
    const stepIncrement = (intervalTime / totalDuration) * 100;

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + stepIncrement;
        if (next >= 100) {
          clearInterval(timer);
          setTimeout(() => {
            onComplete && onComplete();
          }, 180);
          return 100;
        }
        return next;
      });
    }, intervalTime);

    // Update status text across 4 dynamic phases
    const p1 = setTimeout(() => setPhaseIndex(1), 650);
    const p2 = setTimeout(() => setPhaseIndex(2), 1350);
    const p3 = setTimeout(() => setPhaseIndex(3), 2050);

    return () => {
      clearInterval(timer);
      clearTimeout(p1);
      clearTimeout(p2);
      clearTimeout(p3);
    };
  }, [onComplete]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        background: "rgba(10, 8, 18, 0.95)",
        backdropFilter: "blur(18px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        userSelect: "none",
      }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <style>{`
        @keyframes hwtoLogoPulse {
          0% { transform: scale(0.96); filter: drop-shadow(0 0 16px rgba(237,34,123,0.4)); }
          50% { transform: scale(1.05); filter: drop-shadow(0 0 35px rgba(237,34,123,0.9)); }
          100% { transform: scale(0.96); filter: drop-shadow(0 0 16px rgba(237,34,123,0.4)); }
        }
        @keyframes barGlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {/* Pulsing Brand Logo */}
      <div
        style={{
          width: 90,
          height: 80,
          marginBottom: 28,
          animation: "hwtoLogoPulse 2.2s infinite ease-in-out",
        }}
      >
        <img
          src="hwto-logo.svg"
          alt="hwto-kurd"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>

      {/* Main Title */}
      <h2
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#fff",
          marginBottom: 10,
          textAlign: "center",
          letterSpacing: isRtl ? 0 : 0.5,
        }}
      >
        {dict.langSwitchingTitle}
      </h2>

      {/* Dynamic Phase Text */}
      <div
        style={{
          fontSize: 14,
          color: "rgba(255,255,255,0.72)",
          marginBottom: 28,
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 500,
          transition: "opacity 0.25s ease",
        }}
      >
        {steps[phaseIndex]}
      </div>

      {/* Progress Bar Container */}
      <div
        style={{
          width: "min(420px, 85vw)",
          height: 10,
          background: "rgba(255,255,255,0.1)",
          borderRadius: 8,
          overflow: "hidden",
          position: "relative",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)",
        }}
      >
        {/* Animated Progress Bar Fill */}
        <div
          style={{
            height: "100%",
            width: `${progress}%`,
            background:
              "linear-gradient(90deg, #ed227b, #852781, #ed227b, #c8a84b)",
            backgroundSize: "200% 200%",
            animation: "barGlow 2s infinite linear",
            borderRadius: 8,
            boxShadow: "0 0 14px rgba(237,34,123,0.8)",
            transition: "width 0.05s linear",
          }}
        />
      </div>

      {/* Progress percentage and timer hint */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          width: "min(420px, 85vw)",
          marginTop: 10,
          fontSize: 12,
          color: "rgba(255,255,255,0.45)",
          fontWeight: 600,
          fontFamily: "monospace",
        }}
      >
        <span>{Math.round(progress)}%</span>
        <span>hwto-kurd v2.6</span>
      </div>
    </div>
  );
}
