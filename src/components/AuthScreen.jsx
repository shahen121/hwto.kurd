import { useState, useEffect } from "react";
import {
  signInWithGoogle,
  signInWithGoogleRedirect,
  checkRedirectResult,
  subscribeToAuthChanges,
  signInAsGuest,
  isFirebaseConfigured,
} from "../utils/firebase";
import { t, isRTL } from "../utils/i18n";
import { isMobileDevice, isStandalone } from "../utils/pwa";

export default function AuthScreen({ onAuthenticated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRedirectOption, setShowRedirectOption] = useState(false);
  const [checkingRedirect, setCheckingRedirect] = useState(true);

  const firebaseReady = isFirebaseConfigured();

  // Check if returning from a Google redirect login or auth state restored
  useEffect(() => {
    let active = true;

    // Listen to Firebase auth state as authoritative source
    const unsub = subscribeToAuthChanges((user) => {
      if (!active) return;
      if (user) {
        onAuthenticated?.(user);
      }
    });

    checkRedirectResult()
      .then((user) => {
        if (!active) return;
        if (user) {
          onAuthenticated?.(user);
        } else {
          setCheckingRedirect(false);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error("[AuthScreen] Redirect result error:", err);
        setError(formatFirebaseError(err));
        setCheckingRedirect(false);
      });

    // Safety timeout to avoid getting stuck in loading state
    const timer = setTimeout(() => {
      if (active) setCheckingRedirect(false);
    }, 2500);

    return () => {
      active = false;
      unsub();
      clearTimeout(timer);
    };
  }, [onAuthenticated]);

  const formatFirebaseError = (err) => {
    const code = err?.code || "";
    if (code === "app/firebase-not-configured") {
      return t("firebaseNotConfigured");
    }
    if (code === "auth/popup-closed-by-user") {
      return t("authPopupClosed");
    }
    if (code === "auth/configuration-not-found") {
      return t("authConfigNotFound");
    }
    if (code === "auth/operation-not-allowed") {
      return t("authOperationNotAllowed");
    }
    if (code === "auth/unauthorized-domain") {
      const hostname = typeof window !== "undefined" ? window.location.hostname : "";
      return (
        t("authDomainNotAllowedHelp", { domain: hostname }) ||
        t("authUnauthorizedDomain")
      );
    }
    if (code === "auth/popup-blocked") {
      return t("authPopupBlockedHint");
    }
    if (code === "auth/operation-not-supported-in-this-environment") {
      return t("authUnsupportedEnvironment");
    }
    if (code === "auth/network-request-failed") {
      return t("offlineMsg");
    }
    if (code) {
      return `${t("authSignInFailed")} (${code})`;
    }
    return err?.message || t("authSignInFailed");
  };

  const handleGoogleLogin = async (preferRedirect = false) => {
    setError("");
    setLoading(true);
    setShowRedirectOption(false);
    try {
      if (typeof window !== "undefined" && window.electron) {
        throw { code: "auth/operation-not-supported-in-this-environment" };
      }
      const user = await signInWithGoogle({ preferRedirect });
      if (user) {
        onAuthenticated?.(user);
      }
    } catch (err) {
      console.error("[Auth] Google Sign-In failed:", err);
      const code = err?.code || "";
      if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
        setShowRedirectOption(true);
      }
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const user = await signInAsGuest();
      onAuthenticated?.(user);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen-backdrop">
      <div className="auth-glow auth-glow-1" />
      <div className="auth-glow auth-glow-2" />

      <div
        className="auth-card fade-in"
        dir={isRTL() ? "rtl" : "ltr"}
        style={{
          maxWidth: 420,
          margin: "auto",
        }}
      >
        <div className="auth-logo-wrap">
          <img src="hwto-logo.svg" alt="hwto-kurd" className="auth-logo-img" />
          <div className="auth-brand-title">hwto-kurd</div>
          <div className="auth-brand-sub">{t("joinHwto")}</div>
        </div>

        {checkingRedirect ? (
          <div
            style={{
              padding: "36px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
            }}
          >
            <div className="spinner" style={{ width: 34, height: 34 }} />
            <div style={{ fontSize: 13, color: "var(--text3)" }}>
              {t("signingInWait")}
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div
                className="auth-error"
                style={{
                  marginBottom: 16,
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                }}
              >
                {error}
              </div>
            )}

            <div className="auth-alt-actions" style={{ gap: 12, display: "flex", flexDirection: "column" }}>
              {firebaseReady && (
                <button
                  type="button"
                  className="auth-google-btn"
                  onClick={() => handleGoogleLogin(false)}
                  disabled={loading}
                  style={{
                    padding: "13px 18px",
                    fontSize: 14,
                    fontWeight: 600,
                    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    cursor: "pointer",
                  }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path
                      fill="#EA4335"
                      d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.3 14.8c-.2-.8-.4-1.6-.4-2.5s.2-1.7.4-2.5L1.6 7C.6 9 0 11.2 0 13.5s.6 4.5 1.6 6.5l3.7-2.9z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.9C3.5 21.4 7.4 24 12 24z"
                    />
                  </svg>
                  <span>{loading ? t("loading") : t("googleSignIn")}</span>
                </button>
              )}

              {/* Direct Redirect Option if popup fails */}
              {showRedirectOption && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleGoogleLogin(true)}
                  disabled={loading}
                  style={{
                    padding: "11px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    border: "1px solid rgba(237, 34, 123, 0.4)",
                    background: "rgba(237, 34, 123, 0.1)",
                    color: "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  🔄 {t("googleSignInRedirect")}
                </button>
              )}

              <button
                type="button"
                className="auth-guest-btn"
                onClick={handleGuestLogin}
                disabled={loading}
                style={{
                  padding: "13px 18px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t("continueAsGuest")}
              </button>
            </div>
          </>
        )}

        <div
          style={{
            marginTop: 22,
            paddingTop: 16,
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text3)",
          }}
        >
          <span>🔒</span>
          <span>{t("authFastSecure")}</span>
        </div>
      </div>
    </div>
  );
}
