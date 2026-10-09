/**
 * qa-subtitles.mjs — end-to-end browser gate for the local subtitle overlay.
 *
 *   node scripts/qa-subtitles.mjs     (server auto-starts on 4173 if needed)
 *
 * Asserts, on real WebVTT files from public/subtitles/:
 *   1. the control bar appears only for a title that has files, and lists
 *      exactly that title's languages with the preferred one pre-selected,
 *   2. a cue from the loaded file is rendered above the cross-origin frame,
 *      free of markup ({\an8} / <font> style leftovers),
 *   3. the sync offset (+5s / reset) is applied and remembered per title,
 *   4. hide/show and language switching work without errors,
 *   5. TV titles and movies outside index.json never show the bar,
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
try {
  const probe = await fetch(BASE + '/');
  if (!probe.ok) throw new Error('HTTP ' + probe.status);
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
        if (probe.ok) break;
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

/* ---- 1. a titled movie with files: languages + auto-preferred ---------- */

await settle('#/watch/movie/1223601?title=Sisu%3A%20Road%20to%20Revenge');
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 30000 });
const langs = await page.$$eval('#subtitle-langs .sub-lang', (nodes) => nodes.map((n) => n.textContent.trim()));
ok('bar lists exactly the title languages', langs.length === 2, JSON.stringify(langs));
const activeLang = await page.$eval('#subtitle-langs .sub-lang.is-active', (n) => n.dataset.subLang);
ok('a preferred language is pre-selected', ['ku', 'ar', 'en'].includes(activeLang), activeLang);

/* ---- 2. a real cue reaches the overlay, without markup ----------------- */

const cueVisible = await page
  .waitForFunction(
    () => {
      const overlay = document.querySelector('#subtitle-overlay');
      const cue = document.querySelector('#subtitle-cue');
      return overlay && !overlay.hidden && cue && cue.textContent.trim().length > 0;
    },
    null,
    { timeout: 20000 }
  )
  .then(() => true)
  .catch(() => false);
const cueText = await page.$eval('#subtitle-cue', (n) => n.textContent);
ok('cue text is on screen', cueVisible, JSON.stringify(cueText.slice(0, 60)));
ok('cue text carries no markup', !/[<{]/.test(cueText));

/* ---- 3. sync offset: applied, remembered, resettable ------------------- */

await page.click('[data-sub-offset="5"]');
const offsetLabel = await page.$eval('#subtitle-offset-value', (n) => n.textContent.trim());
const stored = await page.evaluate(() => localStorage.getItem('sub:offset:movie/1223601'));
ok('offset advances and is remembered per title', offsetLabel === '+5.0 ث' && stored === '5',
  `label=${JSON.stringify(offsetLabel)} stored=${JSON.stringify(stored)}`);

await page.click('[data-sub-offset="0"]');
ok('offset resets to zero', (await page.$eval('#subtitle-offset-value', (n) => n.textContent.trim())) === '0.0 ث');

/* ---- 4. hide/show + language switching --------------------------------- */

await page.click('#subtitle-toggle');
const hidden = await page.evaluate(() => ({
  pressed: document.querySelector('#subtitle-toggle').getAttribute('aria-pressed'),
  overlayHidden: document.querySelector('#subtitle-overlay').hidden
}));
ok('hide button hides the overlay', hidden.pressed === 'false' && hidden.overlayHidden, JSON.stringify(hidden));
await page.click('#subtitle-toggle');

await page.click('#subtitle-langs .sub-lang:not(.is-active)');
await page.waitForTimeout(800);
const afterSwitch = await page.evaluate(() => ({
  active: document.querySelector('#subtitle-langs .sub-lang.is-active')?.dataset.subLang,
  state: document.querySelector('#subtitle-bar').getAttribute('data-state')
}));
ok('language switch succeeds', afterSwitch.active && afterSwitch.state !== 'error', JSON.stringify(afterSwitch));

/* ---- 5. a 3-language title picks Kurdish first ------------------------- */

await settle('#/watch/movie/278?title=The%20Shawshank%20Redemption');
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 30000 });
const firstLang = await page.$eval('#subtitle-langs .sub-lang.is-active', (n) => n.dataset.subLang);
ok('Kurdish is preferred when available', firstLang === 'ku', firstLang);

/* ---- 6. titles without files never show the bar ------------------------ */

await settle('#/watch/tv/1396/1/1?title=Breaking%20Bad');
await page.waitForTimeout(1500);
ok('TV titles show no subtitle bar (index has no TV)', await barHidden());

await settle('#/watch/movie/11?title=Star%20Wars%3A%20Episode%20IV');
await page.waitForSelector('#subtitle-bar:not([hidden])', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(1200);
ok('a movie outside the index shows no subtitle bar', await barHidden());

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
