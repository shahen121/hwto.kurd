// ── Progressive Web App (PWA) & Mobile Installation Utility ─────────────────
import { useState, useEffect } from "react";

const PWA_DISMISS_KEY = "hwto_pwa_prompt_dismissed";

let _deferredPrompt = null;
const _listeners = new Set();

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator?.standalone === true ||
      document.referrer.includes("android-app://"),
  );
}

export function isIOS() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const ua = navigator.userAgent || "";
  const isApple =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isApple && !window.MSStream;
}

export function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /android/i.test(navigator.userAgent || "");
}

export function isMobileDevice() {
  return isIOS() || isAndroid();
}

export function registerServiceWorker() {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    window.electron
  ) {
    return;
  }

  window.addEventListener("load", () => {
    // Determine sw path based on base href
    const swUrl = new URL("./sw.js", window.location.href).href;
    navigator.serviceWorker
      .register(swUrl)
      .then((reg) => {
        // Check for updates periodically
        reg.addEventListener?.("updatefound", () => {
          const installing = reg.installing;
          if (installing) {
            installing.addEventListener("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                console.log("[PWA] New version installed and ready.");
              }
            });
          }
        });
      })
      .catch((err) => {
        console.warn("[PWA] Service Worker registration failed:", err);
      });
  });
}

// Global beforeinstallprompt listener for Android / Chrome
if (typeof window !== "undefined" && !window.electron) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _deferredPrompt = e;
    _listeners.forEach((fn) => fn(_deferredPrompt));
  });

  window.addEventListener("appinstalled", () => {
    _deferredPrompt = null;
    _listeners.forEach((fn) => fn(null));
    try {
      localStorage.setItem(PWA_DISMISS_KEY, "installed");
    } catch {}
  });
}

export async function promptAndroidInstall() {
  if (!_deferredPrompt) return false;
  try {
    await _deferredPrompt.prompt();
    const choice = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    _listeners.forEach((fn) => fn(null));
    return choice?.outcome === "accepted";
  } catch (err) {
    console.warn("[PWA] Prompt error:", err);
    return false;
  }
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(() => _deferredPrompt);
  const [standalone, setStandalone] = useState(() => isStandalone());
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Boolean(localStorage.getItem(PWA_DISMISS_KEY));
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handlePrompt = (prompt) => setDeferredPrompt(prompt);
    _listeners.add(handlePrompt);

    const checkStandalone = () => setStandalone(isStandalone());
    window.addEventListener("resize", checkStandalone);

    return () => {
      _listeners.delete(handlePrompt);
      window.removeEventListener("resize", checkStandalone);
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(PWA_DISMISS_KEY, Date.now().toString());
    } catch {}
  };

  const resetDismiss = () => {
    setDismissed(false);
    try {
      localStorage.removeItem(PWA_DISMISS_KEY);
    } catch {}
  };

  return {
    isStandalone: standalone,
    isIOS: isIOS(),
    isAndroid: isAndroid(),
    isMobile: isMobileDevice(),
    canInstallAndroid: Boolean(deferredPrompt),
    promptAndroidInstall,
    isDismissed: dismissed,
    dismiss,
    resetDismiss,
  };
}
