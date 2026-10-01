/**
 * store.js — remembers list items so the detail page can still render when
 * ?action=movie / ?action=tv returns {"error": "..."} (which happens for most
 * items that only exist in the mycontent cache, not in the details cache).
 *
 * Memory is bounded (most recent N entries) and mirrored into localStorage so
 * a full page load / direct link still has something to show.
 */

const LIMIT = 300;
const STORAGE_KEY = 'kcm:remembered';
const map = new Map();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && item.key) map.set(item.key, item.item);
    }
  } catch {
    /* ignore corrupted storage */
  }
}

function persist() {
  try {
    const arr = [];
    for (const [key, item] of map) arr.push({ key, item });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(-LIMIT)));
  } catch {
    /* storage full / disabled — memory copy still works */
  }
}

load();

const keyOf = (mediaType, id) => `${mediaType === 'tv' ? 'tv' : 'movie'}:${Number(id)}`;

export function remember(mediaType, item) {
  if (!item || item.id === undefined || item.id === null) return;
  const key = keyOf(mediaType, item.id);
  map.delete(key);
  map.set(key, item);
  while (map.size > LIMIT) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
  persist();
}

export function rememberMany(mediaType, items) {
  if (!Array.isArray(items)) return;
  for (const item of items) remember(mediaType, item);
}

export function recall(mediaType, id) {
  return map.get(keyOf(mediaType, id)) || null;
}
