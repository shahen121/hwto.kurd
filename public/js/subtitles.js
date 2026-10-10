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

// English files were removed from the corpus — only these two remain.
const LANG_ORDER = ['ku', 'ar'];
const LANG_LABELS = { ku: 'كردية', ar: 'العربية' };

const offsetKey = (type, id) => `sub:offset:${type}/${id}`;

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
export function attachSubtitles(root, { type = 'movie', id, signal } = {}) {
  const bar = root.querySelector('#subtitle-bar');
  const overlay = root.querySelector('#subtitle-overlay');
  const cueEl = root.querySelector('#subtitle-cue');
  const langsEl = root.querySelector('#subtitle-langs');
  const offsetEl = root.querySelector('#subtitle-offset-value');
  const toggleEl = root.querySelector('#subtitle-toggle');
  const frame = root.querySelector('.watch-frame iframe');

  const noop = { destroy() {} };
  if (!bar || !overlay || !cueEl || !langsEl) return noop;
  // The subtitle index currently covers movies only.
  if (type !== 'movie' || !id) {
    bar.hidden = true;
    overlay.hidden = true;
    return noop;
  }

  let destroyed = false;
  let cues = [];
  let offset = readOffset(type, id);
  let visible = true;
  let origin = performance.now();
  let ticker = null;
  let loadCtrl = null;

  const renderOffset = () => {
    if (offsetEl) offsetEl.textContent = `${offset > 0 ? '+' : ''}${offset.toFixed(1)} ث`;
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

  const selectLanguage = async (lang) => {
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
      const text = await api.getSubtitleText({ type, id, lang, signal: local });
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

  const renderLangButtons = (langs) => {
    langsEl.innerHTML = langs
      .map(
        (lang) => `
        <button type="button" class="sub-lang" data-sub-lang="${escapeHtml(lang)}" aria-pressed="false">
          ${escapeHtml(LANG_LABELS[lang] || lang.toUpperCase())}
        </button>`
      )
      .join('');
    langsEl.querySelectorAll('[data-sub-lang]').forEach((btn) => {
      btn.addEventListener('click', () => selectLanguage(btn.getAttribute('data-sub-lang')));
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
  startTicker();

  // Discover the languages for this title; the bar stays hidden if there are none.
  api
    .getSubtitleIndex({ signal })
    .then((index) => {
      if (destroyed) return;
      const langs = (index && index[`movie/${id}`]) || [];
      if (!langs.length) return;
      renderLangButtons(langs);
      bar.hidden = false;
      const preferred = LANG_ORDER.find((l) => langs.includes(l)) || langs[0];
      return selectLanguage(preferred);
    })
    .catch(() => {
      /* subtitles are optional — the player keeps working without them */
    });

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
