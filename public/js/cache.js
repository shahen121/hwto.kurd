import { CONFIG } from './config.js';

const memory = new Map();
const inflight = new Map();

function storageAvailable() {
  try {
    const k = '__kcm_probe__';
    sessionStorage.setItem(k, '1');
    sessionStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const persist = storageAvailable();

function now() {
  return Date.now();
}

export function cacheGet(key) {
  const mem = memory.get(key);
  if (mem && mem.expires > now()) return mem.data;
  if (mem) memory.delete(key);

  if (!persist) return undefined;
  try {
    const raw = sessionStorage.getItem('kcm:' + key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (parsed.expires > now()) {
      memory.set(key, parsed);
      return parsed.data;
    }
    sessionStorage.removeItem('kcm:' + key);
  } catch {
    /* corrupted entry — ignore */
  }
  return undefined;
}

export function cacheSet(key, data, ttl = CONFIG.cacheTTL) {
  const entry = { data, expires: now() + ttl };
  memory.set(key, entry);
  if (!persist) return;
  try {
    sessionStorage.setItem('kcm:' + key, JSON.stringify(entry));
  } catch {
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith('kcm:')) sessionStorage.removeItem(k);
      }
      sessionStorage.setItem('kcm:' + key, JSON.stringify(entry));
    } catch {
      /* storage full — memory cache still works */
    }
  }
}

export function cacheKey(params) {
  const sorted = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort()
    .map((k) => k + '=' + params[k])
    .join('&');
  return sorted;
}

export function runOnce(key, producer) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = producer().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

export function clearCache() {
  memory.clear();
  if (!persist) return;
  for (const k of Object.keys(sessionStorage)) {
    if (k.startsWith('kcm:')) sessionStorage.removeItem(k);
  }
}
