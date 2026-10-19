/**
 * subtitle-corpus.mjs — shared helpers for the scraped VTT corpus.
 *
 * The corpus (public/subtitles/{type}/{id}/{lang}.vtt) has three defects the
 * app must never show:
 *   1. some files are UTF-16LE blobs whose 0x00 bytes were stripped, so they
 *      render as mojibake ("ÿþW E B V T T" style garbage) in the player;
 *   2. some ku/ar slots actually hold another language (English, Sinhala…);
 *   3. a few files are cue skeletons with no text at all.
 * `decodeVtt` repairs defect 1 in memory; `isServable` rejects 2 and 3.
 * Both scripts/normalize-subtitles.mjs (repair on disk) and
 * scripts/build-subtitles-index.mjs (only index servable files) use this.
 */

/** Bytes that survive as the high half of a UTF-16LE unit once 0x00 is gone. */
const HIGH_BYTES = new Set();
for (let b = 0x05; b <= 0x08; b += 1) HIGH_BYTES.add(b);
for (let b = 0x80; b <= 0xff; b += 1) HIGH_BYTES.add(b);

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g;
const LATIN = /[A-Za-z]/g;
// Anything outside the scripts a Kurdish/Arabic subtitle legitimately uses.
const JUNK = /[^\t\n\r\x20-\x7E\u00A0-\u02FF\u0600-\u06FF\u0750-\u077F\u2000-\u206F\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/** A UTF-16 byte-order mark, i.e. a clean UTF-16 file we can decode directly. */
export function hasBom(buf) {
  return (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
}

/**
 * Rebuild the UTF-16LE stream of a file whose 0x00 bytes were stripped: every
 * byte followed by a non-ASCII high byte is one unit, every other byte is a
 * Latin-1 unit (which restores ASCII and accented letters alike).
 */
function recoverStrippedUtf16(buf) {
  let start = 0;
  let header = '';
  if (/^WEBVTT/i.test(buf.slice(0, 8).toString('latin1'))) {
    const crlf = buf.indexOf('\r\n\r\n');
    const lf = buf.indexOf('\n\n');
    if (crlf >= 0) start = crlf + 4;
    else if (lf >= 0) start = lf + 2;
    if (start) header = 'WEBVTT\n\n';
  }
  const out = [];
  for (let i = start; i < buf.length; i += 1) {
    const low = buf[i];
    const high = buf[i + 1];
    if (high !== undefined && HIGH_BYTES.has(high)) {
      out.push(String.fromCharCode(low | (high << 8)));
      i += 1;
    } else {
      out.push(String.fromCharCode(low));
    }
  }
  return (
    header +
    out
      .join('')
      // The stripped 0x00 bytes resurface as NULs next to CR/LF runs; the
      // control range they leave behind is never valid cue text.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/\r\n/g, '\n')
  );
}

/**
 * Decode a VTT file the way the browser would, repairing the stripped-UTF-16
 * case. Returns the text plus how it was read.
 */
export function decodeVtt(buf) {
  if (hasBom(buf)) return { text: buf.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf-16', repaired: false };
  if (!buf.includes(0)) return { text: buf.toString('utf8'), encoding: 'utf-8', repaired: false };
  return { text: recoverStrippedUtf16(buf), encoding: 'utf-16-stripped', repaired: true };
}

/** Cue counts and per-script letter counts for one VTT text. */
export function analyze(text) {
  const cues = (text.match(/-->/g) || []).length;
  // This corpus puts a blank line between a cue's timing line and its text, so
  // walk lines and attach the first letter-bearing line to each timing line.
  // Script counts come from the cue text only: markup, timing lines and cue
  // indices are ASCII noise that would drown out short Arabic cues.
  let textCues = 0;
  let pending = false;
  let seenCue = false;
  const body = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.includes('-->')) {
      seenCue = true;
      pending = true;
      continue;
    }
    if (!seenCue) continue;
    const line = raw.replace(/<[^>]+>/g, '').trim();
    if (!line || /^\d+$/.test(line)) continue;
    body.push(line);
    if (pending && /\p{L}/u.test(line)) {
      textCues += 1;
      pending = false;
    }
  }
  const cueText = body.join('\n');
  return {
    cues,
    textCues,
    arabic: (cueText.match(ARABIC) || []).length,
    latin: (cueText.match(LATIN) || []).length,
    junk: (cueText.match(JUNK) || []).length
  };
}

/**
 * Is this text safe to offer in a ku/ar slot? Rejects empty skeletons, files
 * that are mostly a foreign script, and files with no Arabic script at all.
 */
export function isServable(text) {
  const stats = analyze(text);
  if (stats.cues < 1 || stats.textCues < 1) return { ok: false, reason: 'no cue text', stats };
  if (stats.textCues < stats.cues * 0.5) return { ok: false, reason: 'mostly empty cues', stats };
  if (stats.arabic < 8 || stats.arabic < stats.latin) return { ok: false, reason: 'not kurdish/arabic', stats };
  if (stats.junk > (stats.arabic + stats.latin) * 0.5) return { ok: false, reason: 'foreign script', stats };
  return { ok: true, reason: '', stats };
}
