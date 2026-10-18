/**
 * subtitles.js — local WebVTT playback on the watch screen.
 *
 * The player is a cross-origin <iframe> (vidcore.io): a native <track> cannot
 * be attached to a video we do not own, and the frame's currentTime is not
 * readable. So we render our own cue overlay driven by a wall clock that
 * starts when the frame loads, plus a per-title sync offset the viewer can
 * adjust (and that is remembered in localStorage).
 *
 * Nothing here performs network I/O — every request in the app goes through
 * the api service layer.
 */

import { api } from './api.js';
import { escapeHtml } from './utils.js';
import { showToast } from './ui.js';

/* ------------------------------- parsing ------------------------------- */

function parseTimestamp(value) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(String(value || '').trim());
  if (!m) return NaN;
  const hours = m[1] ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const millis = Number(m[4].padEnd(3, '0'));
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/** WebVTT (and SRT-shaped files) -> [{start,end,text}] sorted by start. */
export function parseVtt(source) {
  const cues = [];
  if (!source) return cues;
  const blocks = String(source).replace(/\r\n?/g, '\n').split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const [rawStart, rawRest] = lines[timingIndex].split('-->');
    const start = parseTimestamp(rawStart);
    const end = parseTimestamp(String(rawRest || '').trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;

    const payload = lines
      .slice(timingIndex + 1)
      .join('\n')
      // Drop styling/markup: SRT/font tags, ASS override blocks ({\an8}, {\fs34})
      // and ASS hard line breaks — these files are a mix of all three shapes.
      .replace(/<[^>\n]*>/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (!payload) continue;

    cues.push({ start, end, text: payload });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** Text of the cue covering `time`, or '' outside every cue. */
export function cueAt(cues, time) {
  if (!cues.length || !Number.isFinite(time)) return '';
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found === -1) return '';
  const cue = cues[found];
  return time <= cue.end ? cue.text : '';
}

/* ------------------------------- offsets ------------------------------- */

// Kurdish and Arabic first (this site's audience); English is the remote
// fallback — the local corpus no longer ships English files.
const LANG_ORDER = ['ku', 'ar', 'en'];
const LANG_LABELS = { ku: 'كردية', ar: 'العربية', en: 'English' };

/** A remote row may label things slightly differently; normalise once. */
const CODE_OVERRIDES = { 'pt-br': 'pt', 'zh-tw': 'zh' };

const offsetKey = (type, id) => `sub:offset:${type}/${id}`;
const FONT_KEY = 'sub:fontScale';
const FONT_MIN = 0.7;
const FONT_MAX = 2;
const FONT_STEP = 0.1;

function readFontScale() {
  try {
    const value = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(value) && value >= FONT_MIN && value <= FONT_MAX) return Math.round(value * 10) / 10;
  } catch {
    /* private mode */
  }
  return 1;
}

function writeFontScale(value) {
  try {
    localStorage.setItem(FONT_KEY, String(value));
  } catch {
    /* private mode */
  }
}

/** The scale lives on :root — CSS resolves it as var(--sub-font-scale, 1). */
function applyFontScale(root, value) {
  document.documentElement.style.setProperty('--sub-font-scale', String(value));
  void root;
}

function readOffset(type, id) {
  try {
    const value = Number(localStorage.getItem(offsetKey(type, id)));
    return Number.isFinite(value) ? clampOffset(value) : 0;
  } catch {
    return 0;
  }
}

/** Sync drift is measured in seconds — anything beyond ±10 min is a bug. */
const clampOffset = (value) => Math.min(600, Math.max(-600, value));

function writeOffset(type, id, value) {
  try {
    localStorage.setItem(offsetKey(type, id), String(value));
  } catch {
    /* private mode — the offset still applies for this visit */
  }
}

/* ------------------------------ controller ----------------------------- */

/**
 * Wire the subtitle bar + overlay inside `root` (the watch view).
 * Returns { destroy() } — the ticker also self-stops if the view is detached.
 */
export function attachSubtitles(root, { type = 'movie', id, season, episode, signal } = {}) {
  const bar = root.querySelector('#subtitle-bar');
  const overlay = root.querySelector('#subtitle-overlay');
  const cueEl = root.querySelector('#subtitle-cue');
  const langsEl = root.querySelector('#subtitle-langs');
  const offsetEl = root.querySelector('#subtitle-offset-value');
  const fontEl = root.querySelector('#subtitle-font-value');
  const toggleEl = root.querySelector('#subtitle-toggle');
  const frame = root.querySelector('.watch-frame iframe');

  const noop = { destroy() {} };
  if (!bar || !overlay || !cueEl || !langsEl) return noop;
  if (!id) {
    bar.hidden = true;
    overlay.hidden = true;
    return noop;
  }

  /* Where each language lives: local corpus files vs the remote resolver. */
  const langSource = new Map(); // code -> 'local' | 'remote'

  let destroyed = false;
  let cues = [];
  let offset = readOffset(type, id);
  let visible = true;
  let origin = performance.now();
  let ticker = null;
  let loadCtrl = null;
  let fontScale = readFontScale();

  const renderOffset = () => {
    if (offsetEl) offsetEl.textContent = `${offset > 0 ? '+' : ''}${offset.toFixed(1)} ث`;
  };

  const renderFont = () => {
    if (fontEl) fontEl.textContent = `${Math.round(fontScale * 100)}%`;
  };

  const renderCue = () => {
    if (destroyed) return;
    if (!visible || !cues.length || origin === null) {
      overlay.hidden = true;
      return;
    }
    const text = cueAt(cues, (performance.now() - origin) / 1000 + offset);
    if (text) {
      cueEl.textContent = text;
      overlay.hidden = false;
    } else {
      overlay.hidden = true;
    }
  };

  const startTicker = () => {
    if (ticker || destroyed) return;
    ticker = setInterval(() => {
      if (!root.isConnected) {
        destroy();
        return;
      }
      renderCue();
    }, 200);
  };

  const onFrameLoad = () => {
    // The frame (re)loaded — restart the clock from its beginning.
    origin = performance.now();
    renderCue();
  };

  const selectLanguage = async (lang, source = langSource.get(lang) || 'local') => {
    if (loadCtrl) loadCtrl.abort();
    loadCtrl = new AbortController();
    const local = loadCtrl.signal;
    const aborted = () => destroyed || local.aborted || (signal && signal.aborted);

    langsEl.querySelectorAll('[data-sub-lang]').forEach((btn) => {
      const active = btn.getAttribute('data-sub-lang') === lang;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    cueEl.textContent = '';
    overlay.hidden = true;

    try {
      const text =
        source === 'local'
          ? await api.getSubtitleText({ type, id, lang, signal: local })
          : await api.getRemoteSubtitleText({ type, id, lang, season, episode, signal: local });
      if (aborted()) return;
      cues = parseVtt(text);
      if (!cues.length) throw new Error('empty');
      bar.removeAttribute('data-state');
      renderCue();
    } catch (err) {
      if (aborted() || (err && err.name === 'AbortError')) return;
      cues = [];
      overlay.hidden = true;
      bar.setAttribute('data-state', 'error');
    }
  };

  const renderLangButtons = (configs) => {
    // [{code, source, label}] — one button per language, local files first.
    const seen = new Set();
    const unique = configs.filter((c) => c && c.code && !seen.has(c.code) && seen.add(c.code));
    langsEl.innerHTML = unique
      .map(
        (lang) => `
        <button type="button" class="sub-lang" data-sub-lang="${escapeHtml(lang.code)}" data-sub-source="${escapeHtml(lang.source)}" aria-pressed="false">
          ${escapeHtml(lang.label || LANG_LABELS[lang.code] || lang.code.toUpperCase())}
        </button>`
      )
      .join('');
    langsEl.querySelectorAll('[data-sub-lang]').forEach((btn) => {
      btn.addEventListener('click', () =>
        selectLanguage(btn.getAttribute('data-sub-lang'), btn.getAttribute('data-sub-source') || 'local')
      );
    });
  };

  bar.querySelectorAll('[data-sub-offset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const delta = Number(btn.getAttribute('data-sub-offset'));
      if (!Number.isFinite(delta) || delta === 0) return;
      offset = clampOffset(Math.round((offset + delta) * 10) / 10);
      writeOffset(type, id, offset);
      renderOffset();
      renderCue();
    });
  });

  /* Font size — one shared scale (±), remembered across titles. */
  bar.querySelectorAll('[data-sub-font]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dir = Number(btn.getAttribute('data-sub-font'));
      fontScale = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round((fontScale + dir * FONT_STEP) * 10) / 10));
      writeFontScale(fontScale);
      applyFontScale(root, fontScale);
      renderFont();
    });
  });

  const resetEl = root.querySelector('#subtitle-reset');
  if (resetEl) {
    resetEl.addEventListener('click', () => {
      // The overlay runs on wall time (the frame is cross-origin, so there is
      // no playhead to read). Resetting therefore clears the stored offset AND
      // re-anchors the clock: cues start at 00:00 from this moment on, which
      // is what fixes "the subtitles are already running before the video is".
      offset = 0;
      writeOffset(type, id, 0);
      origin = performance.now();
      renderOffset();
      renderCue();
      showToast('أُعيد ضبط الترجمة إلى البداية (00:00)');
    });
  }

  if (toggleEl) {
    toggleEl.addEventListener('click', () => {
      visible = !visible;
      toggleEl.setAttribute('aria-pressed', String(visible));
      toggleEl.textContent = visible ? 'إخفاء الترجمة' : 'إظهار الترجمة';
      renderCue();
    });
  }

  if (frame) frame.addEventListener('load', onFrameLoad);
  renderOffset();
  renderFont();
  applyFontScale(root, fontScale);
  startTicker();

  /* Auto-fit: the ticker self-destroys once the watch view unmounts. */

  // The local corpus may lag behind the remote resolver; merge both language
  // pools (local wins on clash) and keep one of each entry in a stable order:
  // Kurdish, Arabic, English first — RTL/native-audience first — then the rest
  // of the remote catalogue alphabetical.
  /* Track the local index result so the remote merge keeps it. */
  let localLangs = [];
  const localLangsSnapshot = () => localLangs;
  let discovered = false; // the bar is revealed exactly once

  const mergeLangs = (localLangs, remoteLangs) => {
    langSource.clear();
    const configs = [];
    const local = new Set((localLangs || []).map((c) => String(c).toLowerCase()));
    const remote = new Map();
    for (const entry of remoteLangs || []) {
      let code = String(entry && entry.code || '').toLowerCase();
      code = code.split('-')[0]; // "pt-BR" -> "pt", "zh-TW" -> "zh"
      if (!/^[a-z]{2,5}$/.test(code)) continue;
      const label =
        entry && typeof entry.label === 'string' && entry.label.trim()
          ? entry.label.trim()
          : LANG_LABELS[code] || code.toUpperCase();
      remote.set(code, label);
    }
    for (const code of LANG_ORDER) {
      if (local.has(code)) {
        langSource.set(code, 'local');
        configs.push({ code, source: 'local', label: LANG_LABELS[code] });
      } else if (remote.has(code)) {
        langSource.set(code, 'remote');
        configs.push({ code, source: 'remote', label: remote.get(code) });
      }
    }
    const rest = [...remote.keys()].filter((c) => !LANG_ORDER.includes(c) && !seen(configs, c)).sort();
    for (const code of rest) {
      langSource.set(code, 'remote');
      configs.push({ code, source: 'remote', label: remote.get(code) });
    }
    return configs;
  };
  const seen = (configs, code) => configs.some((c) => c.code === code);

  const reveal = (configs) => {
    if (destroyed || discovered || !configs.length) return;
    discovered = true;
    renderLangButtons(configs);
    bar.hidden = false;
    const preferred = configs[0];
    if (preferred) selectLanguage(preferred.code, preferred.source);
  };

  // Discover: the local corpus first (movies), falling through to the remote
  // resolver (movies and TV) whenever the index comes back empty or missing.
  api
    .getSubtitleIndex({ signal })
    .then((index) => {
      if (destroyed) return;
      const langs = (index && index[`${type}/${id}`]) || [];
      localLangs = langs;
      const configs = mergeLangs(localLangs, null);
      if (configs.length) reveal(configs);
      else remoteLangsMerge();
    })
    .catch(() => {
      remoteLangsMerge();
    });

  const remoteLangsMerge = () => {
    if (destroyed) return;
    api
      .getRemoteSubtitleLangs({ type, id, season, episode, signal })
      .then((remoteLangs) => {
        if (destroyed) return;
        const configs = mergeLangs(localLangsSnapshot(), remoteLangs);
        reveal(configs);
      })
      .catch(() => {
        /* subtitles are optional — the player keeps working without them */
      });
  };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (ticker) clearInterval(ticker);
    ticker = null;
    if (loadCtrl) loadCtrl.abort();
    if (frame) frame.removeEventListener('load', onFrameLoad);
    overlay.hidden = true;
  }

  return { destroy };
}
