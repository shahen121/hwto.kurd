// ── Firebase Configuration & Authentication Helper ──────────────────────────
// Config is read from VITE_FIREBASE_* env vars (Vercel) or automatically from
// firebase.txt in the project root (see vite.config.js).
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "firebase/auth";

export const FIREBASE_CONFIG = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyDtvAsnr-SXvdgrb3Yh5djpZY1OCtFNGJQ",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "hwto-kurd.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "hwto-kurd",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "hwto-kurd.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "611705263660",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:611705263660:web:f37a19907be8d0973ce389",
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-HW5MNTW912",
};

const AUTH_SESSION_KEY = "hwto_auth_user";

function createAppAuthError(code) {
  const error = new Error(code);
  error.code = `app/${code}`;
  return error;
}

export function isFirebaseConfigured() {
  return Boolean(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

let _auth = null;
export function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  return getApps()[0] || initializeApp(FIREBASE_CONFIG);
}
function getFirebaseAuth() {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!_auth) _auth = getAuth(app);
  return _auth;
}

function formatUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || (u.email ? u.email.split("@")[0] : "User"),
    photoURL: u.photoURL || null,
    isGuest: false,
  };
}

export function getCachedAuthUser() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setCachedAuthUser(user) {
  try {
    if (user) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(user));
    else localStorage.removeItem(AUTH_SESSION_KEY);
  } catch {}
}

export function subscribeToAuthChanges(callback) {
  const auth = getFirebaseAuth();
  if (!auth) return () => {};
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      const user = formatUser(firebaseUser);
      setCachedAuthUser(user);
      callback(user);
      return;
    }
    // Keep guest sessions alive; otherwise the Firebase session is gone.
    const cached = getCachedAuthUser();
    if (cached?.isGuest) {
      callback(cached);
    } else {
      setCachedAuthUser(null);
      callback(null);
    }
  });
}

function requireAuth() {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw createAppAuthError("firebase-not-configured");
  }
  return auth;
}

export async function signInWithEmail(email, password) {
  const cleanEmail = (email || "").trim();
  if (!cleanEmail || !password) {
    throw createAppAuthError("email-password-required");
  }
  const cred = await signInWithEmailAndPassword(
    requireAuth(),
    cleanEmail,
    password,
  );
  const user = formatUser(cred.user);
  setCachedAuthUser(user);
  return user;
}

export async function registerWithEmail(email, password, displayName) {
  const cleanEmail = (email || "").trim();
  if (!cleanEmail || !password) {
    throw createAppAuthError("email-password-required");
  }
  if (password.length < 6) {
    throw createAppAuthError("weak-password");
  }
  const cred = await createUserWithEmailAndPassword(
    requireAuth(),
    cleanEmail,
    password,
  );
  const name = (displayName || "").trim();
  if (name) await updateProfile(cred.user, { displayName: name });
  const user = formatUser({ ...cred.user, displayName: name || cred.user.displayName });
  setCachedAuthUser(user);
  return user;
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(requireAuth(), new GoogleAuthProvider());
  const user = formatUser(cred.user);
  setCachedAuthUser(user);
  return user;
}

export async function signInAsGuest() {
  const guest = {
    uid: "guest_user",
    email: "",
    displayName: "Guest",
    photoURL: null,
    isGuest: true,
  };
  setCachedAuthUser(guest);
  return guest;
}

export async function signOutUser() {
  setCachedAuthUser(null);
  const auth = getFirebaseAuth();
  if (auth) {
    try {
      await signOut(auth);
    } catch {}
  }
}
