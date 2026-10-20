// Firestore sync for per-user library data (saved list, history, progress, watched).
// Document: users/{uid}  (guests and unconfigured Firebase are skipped).
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getFirebaseApp } from "./firebase";

const SYNCED_KEY = "hwto_cloud_synced_uid";

function db() {
  const app = getFirebaseApp();
  return app ? getFirestore(app) : null;
}

export function canSync(user) {
  return !!user && !user.isGuest && !!db();
}

export async function loadCloudData(uid) {
  const d = db();
  if (!d) return null;
  const snap = await getDoc(doc(d, "users", uid));
  return snap.exists() ? snap.data() : null;
}

export async function saveCloudData(uid, data) {
  const d = db();
  if (!d) return;
  await setDoc(doc(d, "users", uid), { ...data, updatedAt: Date.now() });
}

export const hasSyncedBefore = (uid) =>
  localStorage.getItem(SYNCED_KEY) === uid;
export const markSynced = (uid) => localStorage.setItem(SYNCED_KEY, uid);

// First login on a device: union of local + cloud. Later logins: cloud wins,
// so deletions made on another device propagate.
export function mergeData(local, cloud, cloudWins) {
  if (!cloud) return local;
  if (cloudWins) {
    return {
      saved: cloud.saved || {},
      savedOrder: cloud.savedOrder || null,
      progress: cloud.progress || {},
      history: cloud.history || [],
      watched: cloud.watched || {},
    };
  }
  const progress = { ...(cloud.progress || {}) };
  for (const [k, v] of Object.entries(local.progress || {})) {
    progress[k] = Math.max(progress[k] || 0, v || 0);
  }
  const histMap = new Map();
  for (const h of [...(cloud.history || []), ...(local.history || [])]) {
    const key = `${h.media_type}_${h.id}_${h.season ?? ""}_${h.episode ?? ""}`;
    const prev = histMap.get(key);
    if (!prev || (h.watchedAt || 0) > (prev.watchedAt || 0)) histMap.set(key, h);
  }
  const history = [...histMap.values()]
    .sort((a, b) => (b.watchedAt || 0) - (a.watchedAt || 0))
    .slice(0, 100);
  const saved = { ...(cloud.saved || {}), ...(local.saved || {}) };
  const order = [
    ...new Set([
      ...(cloud.savedOrder || Object.keys(cloud.saved || {})),
      ...(local.savedOrder || Object.keys(local.saved || {})),
    ]),
  ].filter((k) => saved[k]);
  return {
    saved,
    savedOrder: order,
    progress,
    history,
    watched: { ...(cloud.watched || {}), ...(local.watched || {}) },
  };
}
