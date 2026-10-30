import React, { useState } from "react";
import { usePwaInstall } from "../utils/pwa";
import { t, isRTL } from "../utils/i18n";

export default function PwaInstallBanner({ forceModal = false, onClose }) {
  const {
    isStandalone,
    isIOS,
    isAndroid,
    canInstallAndroid,
    promptAndroidInstall,
    isDismissed,
    dismiss,
  } = usePwaInstall();

  const [installing, setInstalling] = useState(false);
  const rtl = isRTL();

  // If already running inside standalone PWA and not forced as modal, don't show
  if (isStandalone && !forceModal) {
    return null;
  }

  // If user already dismissed it and this is not an explicit modal request, don't show
  if (isDismissed && !forceModal) {
    return null;
  }

  const handleAndroidInstall = async () => {
    setInstalling(true);
    try {
      const outcome = await promptAndroidInstall();
      if (outcome && onClose) {
        onClose();
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleClose = () => {
    dismiss();
    onClose?.();
  };

  return (
    <div
      className={forceModal ? "modal-overlay fade-in" : "pwa-banner-bar fade-in"}
      dir={rtl ? "rtl" : "ltr"}
      style={{
        zIndex: 9999,
      }}
      onClick={forceModal ? handleClose : undefined}
    >
      <div
        className="pwa-install-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "linear-gradient(135deg, rgba(28, 20, 48, 0.95) 0%, rgba(14, 11, 23, 0.98) 100%)",
          border: "1px solid rgba(237, 34, 123, 0.35)",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.65), 0 0 24px rgba(237, 34, 123, 0.2)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: "16px",
          padding: "18px 20px",
          maxWidth: 520,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* Header with App Icon */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="apple-touch-icon.png"
              alt="hwto-kurd"
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                boxShadow: "0 4px 14px rgba(237, 34, 123, 0.3)",
              }}
            />
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
                {t("installAppTitle")}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                {t("installAppSubtitle")}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label={t("close")}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "none",
              color: "var(--text2)",
              borderRadius: "50%",
              width: 30,
              height: 30,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        {/* Platform-specific instructions */}
        {isIOS ? (
          <div
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 12,
              padding: "12px 14px",
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              fontSize: 13,
              color: "var(--text)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>1️⃣</span>
              <span>{t("installIosStep1")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>2️⃣</span>
              <span>{t("installIosStep2")}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>3️⃣</span>
              <span>{t("installIosStep3")}</span>
            </div>
          </div>
        ) : canInstallAndroid ? (
          <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleClose}
              style={{ padding: "9px 16px", fontSize: 13 }}
            >
              {t("pwaPromptDismiss")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAndroidInstall}
              disabled={installing}
              style={{
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 600,
                background: "var(--hwto-gradient)",
                boxShadow: "0 4px 15px rgba(237, 34, 123, 0.35)",
              }}
            >
              {installing ? t("loading") : t("installNow")}
            </button>
          </div>
        ) : (
          <div
            style={{
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 12,
              padding: "12px 14px",
              marginTop: 10,
              fontSize: 13,
              color: "var(--text2)",
              lineHeight: 1.6,
            }}
          >
            <div>📱 {t("installAppSubtitle")}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--text3)" }}>
              {isAndroid
                ? t("installAndroidManualStep")
                : t("installBrowserManualStep")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
