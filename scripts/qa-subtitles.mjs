/**
 * qa-subtitles.mjs — end-to-end browser gate for the local subtitle overlay.
 *
 *   node scripts/qa-subtitles.mjs     (server auto-starts on 4173 if needed)
 *
 * Fixtures are read from public/subtitles/index.json (a single-language title
 * and a bilingual one), so a re-synced corpus never breaks the gate. It
 * asserts:
 *   1. the bar appears for a title that has files, lists exactly that title's
 *      languages, and the primary embed (VidLink) carries the VTT file via
 *      ?sub_file= — so the overlay deliberately starts hidden,
 *   2. picking a language renders a cue above the cross-origin frame, free of
 *      markup ({\an8} / <font> style leftovers),
 *   3. the sync offset (+5s / reset) is applied and remembered per title,
 *   4. hide/show and language switching work without errors,
 *   5. a remote-only title offers only Kurdish and Arabic (the resolver is
 *      intercepted returning several languages), auto-selecting the preferred
 *      one, while TV titles and movies with an empty pool never show the bar,
 *   6. every /subtitles/ request is 200, no console errors, no failed
 *      responses — the embedded player's own noise is bucketed separately,
 *      exactly like scripts/qa.mjs does.
 *
 * Environment (same contract as scripts/qa.mjs):
 *   BASE_URL        default http://127.0.0.1:4173
 *   PLAYWRIGHT_CORE path to a playwright-core package (or install it in
 *                   node_modules — it is deliberately not a dependency)
 *   CHROMIUM        path to a Chromium/Brave/Chrome binary
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';

/* ---------- dependency + browser resolution --------------------------- */

function firstExisting(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findPlaywright() {
  const roots = [
    path.join(ROOT, 'node_modules', 'playwright-core'),
    process.env.PLAYWRIGHT_CORE,
    path.join(os.homedir(), '.config', 'opencode', 'skills', 'gstack', 'gstack-main', 'node_modules', 'playwright-core')
  ].filter(Boolean);
  for (const dir of roots) {
    const entry = firstExisting([path.join(dir, 'index.mjs'), path.join(dir, 'index.js')]);
    if (entry) return entry;
  }
  return null;
}

function findChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  const home = os.homedir();
  const bases = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(home, 'Library', 'Caches', 'ms-playwright'),
    path.join(home, '.cache', 'ms-playwright')
  ].filter(Boolean);
  for (const base of bases) {
    let versions = [];
    try {
      versions = fs.readdirSync(base).filter((n) => n.startsWith('chromium')).sort().reverse();
    } catch {
      continue;
    }
    for (const v of versions) {
      const hit = firstExisting([
        path.join(base, v, 'chrome-win64', 'chrome.exe'),
        path.join(base, v, 'chrome-win', 'chrome.exe'),
        path.join(base, v, 'chrome-linux64', 'chrome'),
        path.join(base, v, 'chrome-linux', 'chrome'),
        path.join(base, v, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(base, v, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
      ]);
      if (hit) return hit;
    }
  }
  return null;
}

const entry = findPlaywright();
if (!entry) {
  console.error('qa-subtitles: playwright-core not found.');
  console.error('            set PLAYWRIGHT_CORE=/path/to/playwright-core or npm i -D playwright-core');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(entry).href);

const executablePath = findChromium();
if (!executablePath) {
  console.error('qa-subtitles: no Chromium binary found.');
  console.error('            set CHROMIUM=/path/to/chrome (or install Playwright browsers)');
  process.exit(2);
}

/* ---------- helpers ---------------------------------------------------- */

let fails = 0;
const ok = (name, cond, info = '') => {
  console.log(` ${cond ? 'ok ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
  if (!cond) fails++;
};

/** The bar/overlay must be gone (or completely out of the DOM). */
const barHidden = () =>
  page
    .evaluate(() => {
      const bar = document.querySelector('#subtitle-bar');
      const overlay = document.querySelector('#subtitle-overlay');
      return { barGone: !bar, barHidden: !bar || bar.hidden, overlayGone: !overlay || overlay.hidden };
    })
    .then((s) => s.barGone || (s.barHidden && s.overlayGone));

let spawnedServer = null;
let serverReady = false;
try {
  const probe = await fetch(BASE + '/');
  if (!probe.ok) throw new Error('HTTP ' + probe.status);
  serverReady = true;
} catch (err) {
  if (BASE.includes('127.0.0.1:4173') || BASE.includes('localhost:4173')) {
    const { spawn } = await import('node:child_process');
    spawnedServer = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, PORT: '4173', HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      try {
        const probe = await fetch(BASE + '/');
        if (probe.ok) {
          serverReady = true;
          break;
        }
      } catch {}
    }
  } else {
    console.error(`qa-subtitles: server not reachable at ${BASE} (${err.message}).`);
    console.error('            start it first:  node server.js');
    process.exit(2);
  }
}

if (spawnedServer) {
  process.on('exit', () => {
    try {
      spawnedServer.kill();
    } catch {}
  });
  process.on('SIGINT', () => {
    try {
      spawnedServer.kill();
    } catch {}
    process.exit(1);
  });
}

if (!serverReady) {
  console.error(`qa-subtitles: server did not start at ${BASE}.`);
  process.exit(2);
}

const subtitleIndexResponse = await fetch(`${BASE}/subtitles/index.json`);
if (!subtitleIndexResponse.ok) {
  console.error(`qa-subtitles: subtitle index returned HTTP ${subtitleIndexResponse.status}.`);
  process.exit(1);
}
const subtitleIndex = await subtitleIndexResponse.json();
const subtitleCount = Object.values(subtitleIndex).reduce(
  (count, langs) => count + (Array.isArray(langs) ? langs.length : 0),
  0
);
if (subtitleCount === 0) {
  console.log('qa-subtitles: skipped — public/subtitles contains no VTT subtitle files.');
  process.exit(0);
}

/* The corpus is authoritative: pick fixtures it actually carries instead of
 * hard-coding ids that may be re-synced away. A usable fixture parses and its
 * first cue starts early enough for the overlay clock to reach it in-window. */
const subEntries = Object.entries(subtitleIndex).filter(([, langs]) => Array.isArray(langs) && langs.length);
const inspectVtt = (key, lang) => {
  try {
    const text = fs.readFileSync(path.join(ROOT, 'public', 'subtitles', key, `${lang}.vtt`), 'utf8');
    const first = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->/.exec(text);
    return {
      cues: (text.match(/-->/g) || []).length,
      first: first ? Number(first[1]) * 3600 + Number(first[2]) * 60 + Number(first[3]) : Infinity
    };
  } catch {
    return { cues: 0, first: Infinity };
  }
};

const pickFixture = (candidates, cap) => {
  let relaxed = null;
  for (const [key, langs] of candidates.slice(0, cap)) {
    const info = langs.map((lang) => inspectVtt(key, lang));
    if (!info.every((i) => i.cues > 0)) continue;
    if (info.every((i) => i.first < 15)) return [key, langs];
    if (!relaxed) relaxed = [key, langs];
  }
  return relaxed;
};

const preferFirst = (list, key) => {
  const hit = list.find(([k]) => k === key);
  return hit ? [hit, ...list.filter(([k]) => k !== key)] : list;
};

const singles = preferFirst(subEntries.filter(([, langs]) => langs.length === 1), 'movie/12500');
const duals = preferFirst(subEntries.filter(([, langs]) => langs.length >= 2 && langs.includes('ku')), 'movie/100042');

const singleEntry = pickFixture(singles, 60) || singles[0] || subEntries[0];
const dualEntry = pickFixture(duals, 40) || duals[0] || singleEntry;
const singleKey = singleEntry[0];
const dualKey = dualEntry[0];
const singleLang = singleEntry[1][0];

// Two distinct absent ids: the remote resolver result is cached per title, so
// the "full pool" and "empty pool" checks must not share a movie.
const absentIds = [];
for (let id = 1; id <= 300 && absentIds.length < 2; id++) {
  if (!subtitleIndex[`movie/${id}`]) absentIds.push(id);
}
const missingId = absentIds[0] || 11;
const emptyId = absentIds[1] || missingId + 1;

const browser = await chromium.launch({ headless: true, executablePath });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
const page = await ctx.newPage();

const consoleErrors = [];
const failedResponses = [];
const foreignErrors = [];
const foreignFailures = [];
const subRequests = [];

page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const url = (m.location() && m.location().url) || '';
  // The embedded https player cannot fetch our http dev origin, so its
  // blocked sub_file request is reported against our URL — the app's own
  // subtitle loads are asserted separately, so bucket this as foreign noise.
  if (/Failed to load resource/.test(m.text()) && /\/subtitles\//.test(url)) {
    foreignErrors.push(`embed blocked ${url}`);
    return;
  }
  if (url && !url.startsWith(BASE)) foreignErrors.push(`console ${url}`);
  else consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`page ${e.message}`));
page.on('response', (res) => {
  const url = res.url();
  if (url.includes('/subtitles/')) subRequests.push({ url, status: res.status() });
  if (res.status() >= 400) {
    if (res.frame() && res.frame() !== page.mainFrame()) foreignFailures.push(`${res.status()} ${res.url()}`);
    else failedResponses.push(`${res.status()} ${url.replace(BASE, '')}`);
  }
});

const settle = async (hash) => {
  await page.goto(`${BASE}/index.html${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.watch-frame iframe', { timeout: 30000 });
};

/* The remote resolver is intercepted so the gates measure the app, not the
 * network. `remoteMode` flips one route between an empty pool and a pool with
 * a Kurdish track — the same handler serves the language probe and the file. */
let remoteMode = 'empty';
const REMOTE_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:30.000\nمرحباً بكم\n';
await page.route('**/TMDBCache.aspx?action=subtitles*', (route) => {
  if (remoteMode === 'empty') {
    return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: '{"langs":[]}' });
  }
  if (route.request().url().includes('&lang=')) {
    return route.fulfill({ status: 200, contentType: 'text/vtt; charset=utf-8', body: REMOTE_VTT });
  }
  return route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: '{"langs":[{"code":"en","label":"English"},{"code":"ku","label":"Kurdish"},{"code":"fr"},{"code":"ar"}]}'
  });
});

/* ---- 1. a movie with files: the bar lists exactly its languages --------
 *
 * The primary embed (VidLink) now carries the VTT file itself through the
 * ?sub_file= parameter, so the overlay starts hidden to avoid painting the
 * text twice; the bar is the manual fallback and the viewer reveals it by
 * picking a language.
 */

await settle(`#/watch/${singleKey}?title=Sub%20Test`);
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 30000 });
const langs = await page.$$eval('#subtitle-langs .sub-lang', (nodes) => nodes.map((n) => n.dataset.subLang));
ok('bar lists exactly the title languages (english is gone)',
  langs.length === singleEntry[1].length && langs.includes(singleLang), JSON.stringify(langs));
const embedSub = await page.$eval('.watch-frame iframe', (n) => /[?&]sub_file=/.test(n.getAttribute('src') || ''));
ok('the primary embed carries the subtitle track (sub_file param)', embedSub);
const preSelected = await page.$$eval('#subtitle-langs .sub-lang.is-active', (n) => n.length);
ok('the overlay language is not auto-selected while the embed shows the track',
  preSelected === 0, `selected=${preSelected}`);

/* ---- 2. picking a language reveals a real cue, without markup ---------- */

await page.click('#subtitle-langs .sub-lang');
const cueVisible = await page
  .waitForFunction(
    () => {
      const overlay = document.querySelector('#subtitle-overlay');
      const cue = document.querySelector('#subtitle-cue');
      return overlay && !overlay.hidden && cue && cue.textContent.trim().length > 0;
    },
    null,
    { timeout: 30000 }
  )
  .then(() => true)
  .catch(() => false);
const cueText = await page.$eval('#subtitle-cue', (n) => n.textContent);
ok('cue text is on screen', cueVisible, JSON.stringify(cueText.slice(0, 60)));
ok('cue text carries no markup', !/[<{]/.test(cueText));

/* ---- 3. sync offset: applied, remembered, resettable ------------------- */

const offsetKey = `sub:offset:${singleKey}`;
await page.click('[data-sub-offset="5"]');
const offsetLabel = await page.$eval('#subtitle-offset-value', (n) => n.textContent.trim());
const stored = await page.evaluate((k) => localStorage.getItem(k), offsetKey);
ok('offset advances and is remembered per title', offsetLabel === '+5.0 ث' && stored === '5',
  `label=${JSON.stringify(offsetLabel)} stored=${JSON.stringify(stored)}`);

await page.click('#subtitle-reset');
const afterReset = await page.evaluate(
  (k) => ({
    label: document.getElementById('subtitle-offset-value').textContent.trim(),
    stored: localStorage.getItem(k),
    toast: document.querySelector('#toast-zone .toast')?.textContent || null
  }),
  offsetKey
);
ok('reset clears the offset, restarts the timeline and confirms it',
  afterReset.label === '0.0 ث' && afterReset.stored === '0' && /أُعيد ضبط الترجمة/.test(afterReset.toast || ''),
  JSON.stringify(afterReset));

/* ---- 4. hide/show ------------------------------------------------------ */

await page.click('#subtitle-toggle');
const hidden = await page.evaluate(() => ({
  pressed: document.querySelector('#subtitle-toggle').getAttribute('aria-pressed'),
  overlayHidden: document.querySelector('#subtitle-overlay').hidden
}));
ok('hide button hides the overlay', hidden.pressed === 'false' && hidden.overlayHidden, JSON.stringify(hidden));
await page.click('#subtitle-toggle');

/* ---- 5. a bilingual title lists both, Kurdish first, and switches ------ */

await settle(`#/watch/${dualKey}?title=Bilingual%20Test`);
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 30000 });
const dualLangs = await page.$$eval('#subtitle-langs .sub-lang', (nodes) => nodes.map((n) => n.dataset.subLang));
ok('a bilingual title lists both languages', dualLangs.length >= 2, JSON.stringify(dualLangs));
if (dualEntry[1].includes('ku')) ok('Kurdish leads the language order', dualLangs[0] === 'ku', JSON.stringify(dualLangs));

await page.click(`#subtitle-langs .sub-lang[data-sub-lang="${dualLangs[0]}"]`);
const firstActive = await page.$eval('#subtitle-langs .sub-lang.is-active', (n) => n.dataset.subLang);
ok('clicking a language selects it', firstActive === dualLangs[0], firstActive);

await page.click(`#subtitle-langs .sub-lang[data-sub-lang="${dualLangs[1]}"]`);
await page.waitForTimeout(800);
const afterSwitch = await page.evaluate(() => ({
  active: document.querySelector('#subtitle-langs .sub-lang.is-active')?.dataset.subLang,
  state: document.querySelector('#subtitle-bar').getAttribute('data-state')
}));
ok('language switch succeeds', afterSwitch.active === dualLangs[1] && afterSwitch.state !== 'error',
  JSON.stringify(afterSwitch));

/* ---- 6. remote-only titles: auto-preferred overlay, then empty pool ----
 *
 * The intercepted resolver is flipped to a non-empty Kurdish pool, so this
 * section measures the auto-select path the embed-carried movies skip — then
 * flipped back to empty to measure the no-bar behaviour.
 */

remoteMode = 'full';
await settle(`#/watch/movie/${missingId}?title=Remote%20Only`);
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 30000 });
const remoteLangs = await page.$$eval('#subtitle-langs .sub-lang', (nodes) => nodes.map((n) => n.dataset.subLang));
ok('only Kurdish and Arabic are offered, whatever the resolver returns',
  JSON.stringify(remoteLangs) === '["ku","ar"]', JSON.stringify(remoteLangs));
const remoteActive = await page
  .$eval('#subtitle-langs .sub-lang.is-active', (n) => n.dataset.subLang)
  .catch(() => null);
ok('a remote-only title auto-selects the preferred language', remoteActive === 'ku', String(remoteActive));
const remoteCue = await page
  .waitForFunction(
    () => {
      const overlay = document.querySelector('#subtitle-overlay');
      return (
        overlay && !overlay.hidden && (document.querySelector('#subtitle-cue').textContent || '').trim().length > 0
      );
    },
    null,
    { timeout: 30000 }
  )
  .then(() => true)
  .catch(() => false);
ok('a remote cue renders on the overlay', remoteCue);

remoteMode = 'empty';
await settle('#/watch/tv/1396/1/1?title=Breaking%20Bad');
await page.waitForTimeout(1500);
ok('TV titles with an empty subtitle pool show no bar', await barHidden());

await settle(`#/watch/movie/${emptyId}?title=Empty%20Pool`);
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1200);
ok('a movie with no local files and an empty remote pool shows no bar', await barHidden());

/* ---- 7. leaving the screen stops everything ---------------------------- */

await page.goto(`${BASE}/index.html#/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
ok('no overlay left behind after navigating away', (await page.$('#subtitle-overlay')) === null);

const subFailed = subRequests.filter((r) => r.status >= 400);
ok('every /subtitles/ request succeeded', subFailed.length === 0,
  subRequests.map((r) => `${r.status} ${r.url.split('/subtitles/')[1]}`).join(', '));
ok('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
ok('no failed HTTP responses', failedResponses.length === 0, JSON.stringify(failedResponses.slice(0, 3)));
console.log(`      (ignored: ${foreignErrors.length} errors and ${foreignFailures.length} failed responses from the embedded player)`);

await browser.close();
console.log(fails ? `\n${fails} FAILING` : '\nsubtitle QA passed');
process.exit(fails ? 1 : 0);
