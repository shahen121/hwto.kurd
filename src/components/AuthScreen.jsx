import { useState } from "react";
import {
  signInWithEmail,
  registerWithEmail,
  signInWithGoogle,
  signInAsGuest,
  isFirebaseConfigured,
} from "../utils/firebase";
import { t, isRTL } from "../utils/i18n";

export default function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const firebaseReady = isFirebaseConfigured();

  const formatFirebaseError = (err) => {
    const code = err?.code || "";
    if (code === "app/firebase-not-configured") {
      return t("firebaseNotConfigured");
    }
    if (code === "app/email-password-required") {
      return t("authEmailPasswordRequired");
    }
    if (code === "app/weak-password") {
      return t("authWeakPassword");
    }
    if (
      code === "auth/invalid-credential" ||
      code === "auth/wrong-password" ||
      code === "auth/user-not-found"
    ) {
      return t("authInvalidCredentials");
    }
    if (code === "auth/email-already-in-use") {
      return t("authEmailInUse");
    }
    if (code === "auth/invalid-email") {
      return t("authInvalidEmail");
    }
    if (code === "auth/weak-password") {
      return t("authWeakPassword");
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
      return t("authUnauthorizedDomain");
    }
    if (code === "auth/popup-blocked") {
      return t("authPopupBlocked");
    }
    if (code === "auth/operation-not-supported-in-this-environment") {
      return t("authUnsupportedEnvironment");
    }
    return t("authSignInFailed");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user =
        mode === "register"
          ? await registerWithEmail(email, password, displayName)
          : await signInWithEmail(email, password);
      onAuthenticated?.(user);
    } catch (err) {
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      if (typeof window !== "undefined" && window.electron) {
        throw { code: "auth/operation-not-supported-in-this-environment" };
      }
      const user = await signInWithGoogle();
      onAuthenticated?.(user);
    } catch (err) {
      console.error("[Auth] Google Sign-In failed:", err);
      setError(formatFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setError("");
    const user = await signInAsGuest();
    onAuthenticated?.(user);
  };

  return (
    <div className="auth-screen-backdrop">
      <div className="auth-glow auth-glow-1" />
      <div className="auth-glow auth-glow-2" />

      <div className="auth-card fade-in" dir={isRTL() ? "rtl" : "ltr"}>
        <div className="auth-logo-wrap">
          <img src="hwto-logo.svg" alt="hwto-kurd" className="auth-logo-img" />
          <div className="auth-brand-title">hwto-kurd</div>
          <div className="auth-brand-sub">
            {t("joinHwto")}
          </div>
        </div>

        {/* Mode Switcher */}
        {!firebaseReady && (
          <div className="auth-error" style={{ marginBottom: 14 }}>
            {t("continueAsGuest")}
          </div>
        )}

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "login" ? "active" : ""}`}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            {t("signIn")}
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "register" ? "active" : ""}`}
            onClick={() => {
              setMode("register");
              setError("");
            }}
          >
            {t("createAccount")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {mode === "register" && (
            <div className="auth-field">
              <label className="auth-label">{t("displayName")}</label>
              <input
                type="text"
                className="auth-input"
                placeholder={t("displayName")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>
          )}

          <div className="auth-field">
            <label className="auth-label">{t("email")}</label>
            <input
              type="email"
              className="auth-input"
              placeholder="name@example.com"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label className="auth-label">{t("password")}</label>
            <input
              type="password"
              className="auth-input"
              placeholder="••••••••"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading
              ? t("loading")
              : mode === "register"
                ? t("createAccount")
                : t("signIn")}
          </button>
        </form>

        <div className="auth-divider">
          <span>{t("orSignInWith")}</span>
        </div>

        <div className="auth-alt-actions">
          {firebaseReady && (
            <button
              type="button"
              className="auth-google-btn"
              onClick={handleGoogleLogin}
              disabled={loading}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
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
              <span>{t("googleSignIn")}</span>
            </button>
          )}

          <button
            type="button"
            className="auth-guest-btn"
            onClick={handleGuestLogin}
          >
            {t("continueAsGuest")}
          </button>
        </div>
      </div>
    </div>
  );
}
