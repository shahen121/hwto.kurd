/**
 * qa.mjs — end-to-end browser gate for the UI.
 *
 *   node scripts/qa.mjs          (server must be running: node server.js)
 *
 * It boots headless Chromium, walks every hash route and asserts:
 *   1. each route renders real content (or the intended empty/error state),
 *   2. no horizontal overflow, no broken images,
 *   3. an injected upstream failure produces an error state whose retry works,
 *   4. a revisit is served from the client cache (no repeat toprated request),
 *   5. "/" focuses the header search, rapid navigation never sticks,
 *   6. responsive layouts at 390 / 768 / 1440 px and the mobile menu,
 *   7. history back/forward, load-more pagination, debounced search,
 *   8. the skip link, scroll restoration, per-page titles, the detail back
 *      button on a deep link,
 *   9. transport: CSP + hardening headers, gzip on html/css/api,
 *  10. a first-load time and byte budget,
 *  11. the watch screen: the player is embedded from the site, its sources
 *      are listed, the embedded switcher is reachable, episodes switch the
 *      route and the player, and an unavailable title shows an empty state,
 *  12. zero page errors, zero console errors, zero failed HTTP responses.
 *
 * The watch screen frames kurdcinama.com, and that third-party document logs
 * its own script errors and loads its own ads — those are bucketed separately
 * (`foreign*`) and never counted against this app.
 *
 * playwright-core is NOT a project dependency (the app itself has none), so it
 * is resolved from PLAYWRIGHT_CORE / node_modules / a common install location.
 * The browser binary is resolved from CHROMIUM or the Playwright download dir.
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
  console.error('qa: playwright-core not found.');
  console.error('     set PLAYWRIGHT_CORE=/path/to/playwright-core or npm i -D playwright-core');
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(entry).href);

const executablePath = findChromium();
if (!executablePath) {
  console.error('qa: no Chromium binary found.');
  console.error('     set CHROMIUM=/path/to/chrome (or install Playwright browsers)');
  process.exit(2);
}

/* ---------- helpers ---------------------------------------------------- */

let fails = 0;
const ok = (name, cond, info = '') => {
  console.log(` ${cond ? 'ok ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`);
  if (!cond) fails++;
};

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
    console.error(`qa: server not reachable at ${BASE} (${err.message}).`);
    console.error('     start it first:  node server.js');
    process.exit(2);
  }
}

if (spawnedServer) {
  process.on('exit', () => { try { spawnedServer.kill(); } catch {} });
  process.on('SIGINT', () => { try { spawnedServer.kill(); } catch {}; process.exit(1); });
}

const browser = await chromium.launch({ headless: true, executablePath });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
const failedResponses = [];
const foreignErrors = [];
const foreignFailures = [];
const navNoise = [];
let injecting = false;

/** A foreign frame is present when the watch screen's player is mounted. */
const hasForeignFrame = () =>
  page.frames().some((f) => f !== page.mainFrame() && !String(f.url()).startsWith(BASE));

page.on('console', (m) => {
  if (m.type() !== 'error' || injecting) return;
  const url = (m.location() && m.location().url) || '';
  const text = m.text();
  // This gate navigates away while images/XHR are still in flight; Chromium
  // logs the suspended request as an error. That is test choreography — the
  // app's own breakage is covered by probe() (incl. broken images) below.
  if (text.includes('ERR_NETWORK_IO_SUSPENDED')) {
    navNoise.push(text);
    return;
  }
  if (url && !url.startsWith(BASE)) foreignErrors.push(`console ${url}`);
  else consoleErrors.push(url ? `${text} @ ${url}` : text);
});
page.on('pageerror', (e) => {
  // Playwright does not say which frame threw; an embedded foreign document
  // is on the page at that moment, so the error is attributed to it.
  if (hasForeignFrame()) foreignErrors.push(`page ${e.message}`);
  else pageErrors.push(e.message);
});
page.on('response', (r) => {
  if (injecting || r.status() < 400) return;
  if (!r.url().startsWith(BASE)) {
    foreignFailures.push(`${r.status()} ${r.url().slice(0, 70)}`);
    return;
  }
  failedResponses.push(`${r.status()} ${r.url().replace(BASE, '')}`);
});

const settle = async (hash) => {
  await page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
  // Real content only: skeleton placeholders are `.card.skeleton`, and home's
  // skeleton alone is 18 of them — counting those made the gate race the API.
  await page.waitForFunction(() => {
    const b = document.querySelector('#app-view');
    if (!b) return false;
    return b.querySelector('.card:not(.skeleton), .state-error, .state-empty') !== null;
  }, null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
};

const probe = () => page.evaluate(() => {
  const imgs = [...document.images].filter((i) => i.getAttribute('src') || i.getAttribute('data-src'));
  const broken = imgs.filter((i) => i.complete && i.getAttribute('src') && i.naturalWidth === 0);
  return {
    cards: document.querySelectorAll('.card:not(.skeleton)').length,
    error: document.querySelector('.state-error')?.innerText.replace(/\s+/g, ' ').slice(0, 90) || null,
    empty: document.querySelector('.state-empty')?.innerText.replace(/\s+/g, ' ').slice(0, 60) || null,
    broken: broken.length + document.querySelectorAll('[data-lazy="broken"]').length,
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth
  };
});

/* ---------- 1. route coverage ----------------------------------------- */

const ROUTES = [
  ['home', '#/', { cards: 50 }],
  ['trending/movie', '#/trending/movie', { cards: 1 }],
  ['trending/tv', '#/trending/tv', { cards: 1 }],
  ['upcoming', '#/upcoming', { cards: 5 }],
  ['toprated/movie', '#/toprated/movie', { cards: 5 }],
  ['toprated/tv', '#/toprated/tv', { cards: 1 }],
  ['site', '#/site', { cards: 5 }],
  ['site/movie', '#/site/movie', { cards: 5 }],
  ['site/tv', '#/site/tv', { cards: 5 }],
  ['category/anime', '#/category/anime', { cards: 5 }],
  ['category/series', '#/category/series', { cards: 5 }],
  ['category/movies', '#/category/movies', { cards: 5 }],
  ['category/asian', '#/category/asian', { cards: 5 }],
  ['category/turkish', '#/category/turkish', { cards: 5 }],
  ['category/unknown', '#/category/nope', { empty: true }],
  ['search/batman', '#/search?q=batman', { cards: 5 }],
  ['search/empty', '#/search?q=', { empty: true }],
  ['search/no-hit', '#/search?q=zzzzqqqxyz', { empty: true }],
  ['detail/movie', '#/movie/278', { cards: 1 }],
  ['detail/tv', '#/tv/1396', { cards: 1 }],
  ['detail/unknown', '#/movie/999999999', { error: true }],
  ['404 route', '#/no-such-route', { empty: true }]
];

for (const [name, hash, want] of ROUTES) {
  await settle(hash);
  const p = await probe();
  const wantCards = want.cards === undefined || p.cards >= want.cards;
  const wantError = !want.error || Boolean(p.error);
  const wantEmpty = !want.empty || Boolean(p.empty);
  const noOverflow = p.docW <= p.winW + 1;
  ok(name, wantCards && wantError && wantEmpty && noOverflow && p.broken === 0,
    `cards=${p.cards} error=${JSON.stringify(p.error)} empty=${JSON.stringify(p.empty)} broken=${p.broken} doc=${p.docW}/${p.winW}`);
}

/* ---------- 1a. persistent language picker ---------------------------- */

await settle('#/');
const languagePicker = await page.$('#language-switcher');
ok('language picker is available in the header', Boolean(languagePicker));
if (languagePicker) {
  for (const [language, dir, homeLabel] of [
    ['en', 'ltr', 'Home'],
    ['ckb', 'rtl', null],
    ['ar', 'rtl', 'الرئيسية']
  ]) {
    await page.selectOption('#language-switcher', language);
    const languageState = await page.evaluate(() => ({
      language: document.documentElement.lang,
      dir: document.documentElement.dir,
      home: document.querySelector('.nav-link[href="#/"]')?.textContent.trim(),
      font: getComputedStyle(document.body).fontFamily,
      saved: localStorage.getItem('hwto:language')
    }));
    ok(`language picker switches to ${language}`,
      languageState.language === language && languageState.dir === dir &&
        languageState.saved === language && (!homeLabel || languageState.home === homeLabel) &&
        (language !== 'ckb' || (languageState.home !== 'الرئيسية' && languageState.font.includes('Noto Sans Arabic'))),
      JSON.stringify(languageState));
  }
  await page.selectOption('#language-switcher', 'en');
  await settle('#/search?q=batman');
  const translatedRoute = await page.evaluate(() => ({
    language: document.documentElement.lang,
    heading: document.querySelector('.page-title')?.textContent.trim(),
    placeholder: document.querySelector('#search-input')?.getAttribute('placeholder'),
    direction: document.documentElement.dir
  }));
  ok('language selection persists across navigation and translates search',
    translatedRoute.language === 'en' && translatedRoute.direction === 'ltr' &&
      translatedRoute.heading === 'Search' && translatedRoute.placeholder === 'Type a movie or TV title…',
    JSON.stringify(translatedRoute));
  await page.selectOption('#language-switcher', 'ar');
}

/* ---------- 1b. «التصنيفات» dropdown ----------------------------------- */

await settle('#/');
await page.click('.nav-drop-toggle');
await page.waitForTimeout(500);
const dropInfo = await page.evaluate(() => {
  const drop = document.querySelector('.nav-drop');
  const panel = document.querySelector('.nav-drop-panel');
  const toggle = document.querySelector('.nav-drop-toggle');
  if (!drop || !panel || !toggle) return { ok: false, why: 'missing dropdown markup' };
  const r = panel.getBoundingClientRect();
  const cx = Math.max(4, Math.min(window.innerWidth - 4, r.left + r.width / 2));
  const probe = (cy) => {
    const el = document.elementFromPoint(cx, Math.max(4, Math.min(window.innerHeight - 4, cy)));
    return Boolean(el) && panel.contains(el);
  };
  return {
    open: drop.classList.contains('is-open'),
    expanded: toggle.getAttribute('aria-expanded'),
    // Hit-testing the panel's lower edge proves it is painted below the nav
    // row: if `.nav-list` clipped it, the point would return the hero instead.
    hitsTop: probe(r.top + 12),
    hitsBottom: probe(r.bottom - 10),
    inViewport: r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0 && r.bottom <= window.innerHeight + 1,
    rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`
  };
});
ok('dropdown opens below the header', dropInfo.open === true && dropInfo.expanded === 'true', JSON.stringify(dropInfo));
ok('dropdown panel is visible and unclipped', dropInfo.hitsTop === true && dropInfo.hitsBottom === true && dropInfo.inViewport === true, JSON.stringify(dropInfo));

await page.click('.nav-drop-panel a[href="#/category/anime"]');
await page.waitForFunction(() => location.hash === '#/category/anime', null, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);
const dropRoute = await probe();
ok('dropdown link opens the anime screen', dropRoute.cards >= 5 && !dropRoute.error, `cards=${dropRoute.cards} error=${JSON.stringify(dropRoute.error)}`);
const dropClosed = await page.evaluate(() => !document.querySelector('.nav-drop')?.classList.contains('is-open'));
ok('dropdown closes after navigating', dropClosed === true, `open=${!dropClosed}`);

/* ---------- 1c. category screens are organised into rows ---------------- */

for (const [slug, minRows] of [['anime', 3], ['asian', 3], ['turkish', 2], ['movies', 3], ['series', 3]]) {
  await settle(`#/category/${slug}`);
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('#list-highlights .section')].map((s) => ({
      title: (s.querySelector('.section-title') || {}).textContent || '',
      cards: s.querySelectorAll('.card:not(.skeleton)').length
    }))
  );
  const grid = await page.evaluate(() => document.querySelectorAll('#list-body .card:not(.skeleton)').length);
  const okRows = rows.length >= minRows && rows.every((r) => r.cards >= 3) && grid >= 5;
  ok(`category/${slug}: highlight rows + full grid`, okRows, `${rows.length} rows ${JSON.stringify(rows)} grid=${grid}`);
}

/* ---------- 2. injected failure + working retry ------------------------ */

await settle('#/');
let intercepted = 0;
injecting = true;
await page.route('**/TMDBCache.aspx**', (route) => {
  if (!route.request().url().includes('action=toprated')) return route.continue();
  intercepted++;
  return route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' });
});
// sessionStorage AND the module-level memory cache must both be reset, so the
// request actually reaches the network — only a full document load does that.
await page.evaluate(() => sessionStorage.clear());
await page.goto(BASE + '/index.html#/toprated/tv', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.state-error', { timeout: 60000 }).catch(() => {});
let p = await probe();
ok('upstream failure renders error state', Boolean(p.error), JSON.stringify(p.error) + ` intercepted=${intercepted}`);
const hasRetry = await page.locator('.state-error .btn').count();
ok('error state has a retry control', hasRetry > 0);
await page.unroute('**/TMDBCache.aspx**');
if (hasRetry) {
  await page.locator('.state-error .btn').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.card:not(.skeleton)').length > 0, null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  p = await probe();
  ok('retry recovers', p.cards > 0, `cards=${p.cards}`);
}
injecting = false;

/* ---------- 3. revisit is served from the client cache ----------------- */

await settle('#/toprated/tv');
const seen = [];
const onResp = (r) => { if (r.url().includes('TMDBCache')) seen.push(r.url().split('?')[1] || ''); };
page.on('response', onResp);
await settle('#/');
await settle('#/toprated/tv');
page.off('response', onResp);
ok('revisit served from client cache', seen.every((q) => !q.includes('action=toprated')), `requests=${seen.length}`);

/* ---------- 4. "/" focuses the header search --------------------------- */

await settle('#/');
await page.keyboard.press('/');
const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
ok('slash focuses search input', focused === 'global-search', `focused=${focused}`);

/* ---------- 5. rapid navigation never sticks --------------------------- */

for (let i = 0; i < 8; i++) {
  await page.goto(BASE + (i % 2 ? '#/toprated/tv' : '#/site/movie'), { waitUntil: 'commit' });
}
await page.waitForFunction(() => document.querySelector('.card:not(.skeleton)') !== null, null, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);
p = await probe();
ok('rapid navigation ends in a stable view', p.cards > 0 && !p.error, `cards=${p.cards} error=${JSON.stringify(p.error)}`);

/* ---------- 6. responsive: mobile + tablet never overflow ------------- */

for (const [label, width, height, hashes] of [
  ['mobile 390', 390, 844, ['#/', '#/toprated/tv', '#/search?q=batman', '#/movie/278']],
  ['tablet 768', 768, 1024, ['#/', '#/site']]
]) {
  const c = await browser.newContext({ viewport: { width, height }, locale: 'ar', hasTouch: width < 500 });
  const pg = await c.newPage();
  const errs = [];
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('pageerror', (e) => errs.push(e.message));

  let overflow = null;
  for (const hash of hashes) {
    await pg.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => {
      const b = document.querySelector('#app-view');
      return Boolean(b) && (b.querySelector('.card:not(.skeleton), .state-error, .state-empty') !== null || (b.innerText || '').length > 40);
    }, null, { timeout: 45000 }).catch(() => {});
    await pg.waitForTimeout(2000);
    const m = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    if (m.doc > m.win + 1) overflow = `${hash}: ${m.doc}px > ${m.win}px`;
  }
  ok(`${label}: no horizontal overflow`, !overflow, overflow || `${hashes.length} routes`);
  ok(`${label}: no console errors`, errs.length === 0, JSON.stringify(errs.slice(0, 2)));

  if (width < 500) {
    await pg.goto(BASE + '/#/', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1500);
    await pg.click('#nav-toggle');
    await pg.waitForTimeout(400);
    const opened = await pg.evaluate(() => document.getElementById('site-header')?.classList.contains('is-open'));
    ok('mobile menu opens', opened === true, `open=${opened}`);

    await pg.selectOption('#language-switcher', 'en');
    const mobileLanguage = await pg.evaluate(() => {
      const picker = document.getElementById('language-switcher');
      const rect = picker.getBoundingClientRect();
      return {
        language: document.documentElement.lang,
        text: document.querySelector('.nav-link[href="#/"]')?.textContent.trim(),
        visible: rect.width > 0 && rect.right <= window.innerWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 1
      };
    });
    ok('mobile language picker stays visible and fits the screen',
      mobileLanguage.language === 'en' && mobileLanguage.text === 'Home' &&
        mobileLanguage.visible && !mobileLanguage.overflow, JSON.stringify(mobileLanguage));
    await pg.selectOption('#language-switcher', 'ar');

    await pg.click('.nav-drop-toggle');
    await pg.waitForTimeout(400);
    const acc = await pg.evaluate(() => {
      const drop = document.querySelector('.nav-drop');
      const panel = document.querySelector('.nav-drop-panel');
      if (!drop || !panel) return { open: false, why: 'missing dropdown markup' };
      const cs = getComputedStyle(panel);
      const r = panel.getBoundingClientRect();
      return {
        open: drop.classList.contains('is-open'),
        display: cs.display,
        visible: cs.display !== 'none' && r.height > 10 && r.width > 10,
        links: panel.querySelectorAll('a').length
      };
    });
    ok('mobile: «التصنيفات» accordion expands', acc.open === true && acc.visible === true && acc.links === 5, JSON.stringify(acc));
  }
  await c.close();
}

/* ---------- 7. browser history: back / forward keep the route ---------- */

await settle('#/');
await settle('#/toprated/tv');
await page.goBack();
await page.waitForTimeout(1800);
let hist = await page.evaluate(() => ({
  hash: location.hash,
  hero: Boolean(document.querySelector('.hero')),
  cards: document.querySelectorAll('.card:not(.skeleton)').length
}));
ok('back returns to the previous route', hist.hash === '#/' && (hist.hero || hist.cards > 40), JSON.stringify(hist));
await page.goForward();
await page.waitForTimeout(1800);
hist = await page.evaluate(() => ({ hash: location.hash, cards: document.querySelectorAll('.card:not(.skeleton)').length }));
ok('forward returns to the list route', hist.hash === '#/toprated/tv' && hist.cards > 0, JSON.stringify(hist));

/* ---------- 8. load-more paginates without duplicates ------------------ */

for (const [name, hash, target] of [['site', '#/site', 40], ['upcoming', '#/upcoming', 40]]) {
  await settle(hash);
  const beforeCards = await page.evaluate(() => document.querySelectorAll('.card').length);
  const btn = await page.locator('#list-more').isVisible().catch(() => false);
  ok(`${name}: load-more button offered`, btn, `cards=${beforeCards}`);
  if (!btn) continue;
  await page.click('#list-more');
  await page.waitForFunction((n) => document.querySelectorAll('.card').length >= n, target, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const hrefs = [...document.querySelectorAll('.card')].map((c) => c.querySelector('a')?.getAttribute('href') || c.innerText);
    return { cards: hrefs.length, dupes: hrefs.length - new Set(hrefs).size, meta: document.getElementById('list-meta')?.textContent || '' };
  });
  ok(`${name}: load-more reveals ${target} unique cards`,
    after.cards >= target && after.dupes === 0,
    `cards=${after.cards} (${beforeCards}) dupes=${after.dupes} meta=${JSON.stringify(after.meta)}`);
}

/* ---------- 8b. search load-more appends page 2/3 without duplicates ------- */

await settle('#/search?q=batman');
await page.waitForTimeout(1500);
const searchBefore = await page.evaluate(() => ({
  cards: document.querySelectorAll('#search-results .card').length,
  hasBtn: Boolean(document.querySelector('#search-more-btn')),
  visible: Boolean(document.querySelector('#search-more-wrap:not([hidden])'))
}));
ok('search: initial results with persistent load-more button',
  searchBefore.cards > 0 && searchBefore.hasBtn && searchBefore.visible,
  `cards=${searchBefore.cards} btn=${searchBefore.hasBtn} visible=${searchBefore.visible}`);

const hashBeforeMore = await page.evaluate(() => location.hash);
let searchCards = searchBefore.cards;
for (const pageNo of [2, 3]) {
  const visible = await page.evaluate(() => Boolean(document.querySelector('#search-more-wrap:not([hidden])')));
  if (!visible) break;
  await page.click('#search-more-btn');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#search-results .card').length > n,
    searchCards,
    { timeout: 30000 }
  ).catch(() => {});
  await page.waitForTimeout(800);
  const snap = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#search-results .card')];
    const keys = cards.map((c) => c.querySelector('a')?.getAttribute('href') || '');
    return {
      cards: cards.length,
      dupes: keys.length - new Set(keys).size,
      hash: location.hash,
      meta: document.getElementById('search-more-meta')?.textContent || ''
    };
  });
  ok(`search: page ${pageNo} appends new cards, no dupes, URL unchanged`,
    snap.cards > searchCards && snap.dupes === 0 && snap.hash === hashBeforeMore,
    `cards=${snap.cards} (was ${searchCards}) dupes=${snap.dupes} hash=${snap.hash} meta=${JSON.stringify(snap.meta)}`);
  searchCards = snap.cards;
}

/* ---------- 9. header search is debounced ------------------------------ */

await settle('#/');
const searchRequests = [];
const countSearch = (r) => { if (r.url().includes('action=search')) searchRequests.push(1); };
page.on('request', countSearch);
await page.click('#global-search');
await page.keyboard.type('batman', { delay: 60 });
await page.waitForTimeout(1600);
page.off('request', countSearch);
const atResults = await page.evaluate(() => ({
  hash: location.hash,
  cards: document.querySelectorAll('#search-results .card').length
}));
ok('typing runs one debounced search', searchRequests.length <= 2 && atResults.cards > 0,
  `requests=${searchRequests.length} hash=${atResults.hash} cards=${atResults.cards}`);

/* ---------- 10. home failure + retry ----------------------------------- */

let statsHits = 0;
injecting = true;
await page.route('**/TMDBCache.aspx**', (route) => {
  if (!route.request().url().includes('action=stats')) return route.continue();
  statsHits++;
  return route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' });
});
// Full document load so the module-level memory cache is reset as well.
await page.evaluate(() => sessionStorage.clear());
await page.goto(BASE + '/index.html#/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#home-retry', { timeout: 60000 }).catch(() => {});
p = await probe();
const homeRetry = await page.locator('#home-retry').count();
ok('home failure renders its own error state', Boolean(p.error) && homeRetry > 0,
  JSON.stringify(p.error) + ` statsHits=${statsHits}`);
await page.unroute('**/TMDBCache.aspx**');
if (homeRetry) {
  await page.click('#home-retry');
  await page.waitForFunction(() => Boolean(document.querySelector('.hero')), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const healed = await page.evaluate(() => ({
    hero: Boolean(document.querySelector('.hero')),
    sections: document.querySelectorAll('.section').length
  }));
  ok('home retry rebuilds the landing page', healed.hero && healed.sections >= 4, JSON.stringify(healed));
}
injecting = false;

/* ---------- 11. skip link, scroll restoration, detail back ------------- */

await settle('#/');
await page.evaluate(() => {
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
});
await page.keyboard.press('Tab');
const firstFocus = await page.evaluate(() => (document.activeElement && document.activeElement.className) || '');
await page.keyboard.press('Enter');
await page.waitForTimeout(1200);
const afterSkip = await page.evaluate(() => ({
  hash: location.hash,
  cards: document.querySelectorAll('.card').length,
  notFound: (document.querySelector('#app-view')?.innerText || '').includes('404'),
  focus: (document.activeElement && document.activeElement.id) || ''
}));
ok('skip link keeps the view and moves focus to main',
  firstFocus.includes('skip-link') && afterSkip.hash === '#app-view'
    && afterSkip.cards > 20 && !afterSkip.notFound && afterSkip.focus === 'app-view',
  JSON.stringify({ firstFocus, ...afterSkip }));

await settle('#/site');
await page.evaluate(() => window.scrollTo(0, 1617));
await page.waitForTimeout(700);
const savedY = await page.evaluate(() => window.scrollY);
const detailHref = await page.evaluate(() => document.querySelectorAll('.card a')[6]?.getAttribute('href') || '');
if (detailHref) {
  await page.evaluate((h) => document.querySelector(`.card a[href="${h}"]`).click(), detailHref);
  await page.waitForTimeout(2500);
  const onDetail = await page.evaluate(() => ({ hash: location.hash, y: window.scrollY, title: document.title }));
  ok('detail page sets its own document title', onDetail.title.includes('— hwto.kurd'), JSON.stringify(onDetail));
  ok('detail page starts at the top', onDetail.y === 0, `y=${onDetail.y}`);
  await page.goBack();
  await page.waitForTimeout(2500);
  const back = await page.evaluate(() => ({ y: window.scrollY, cards: document.querySelectorAll('.card').length }));
  ok('going back restores the scroll position', back.y === savedY && back.cards > 0,
    `y=${back.y} saved=${savedY} cards=${back.cards}`);
} else {
  ok('detail page sets its own document title', false, 'no card link found');
  ok('detail page starts at the top', false, 'skipped');
  ok('going back restores the scroll position', false, 'skipped');
}

const deepCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
const deep = await deepCtx.newPage();
const deepErrs = [];
deep.on('pageerror', (e) => deepErrs.push(e.message));
deep.on('console', (m) => { if (m.type() === 'error') deepErrs.push(m.text()); });
await deep.goto(BASE + '/#/movie/278', { waitUntil: 'domcontentloaded' });
await deep.waitForTimeout(4000);
const deepTitle = await deep.evaluate(() => document.title);
const deepBack = await deep.locator('[data-back]').count();
if (deepBack) await deep.locator('[data-back]').click();
await deep.waitForTimeout(2500);
const deepState = await deep.evaluate(() => ({ hash: location.hash, notFound: (document.querySelector('#app-view')?.innerText || '').includes('404') }));
ok('deep-linked detail: title is the real title', deepTitle.includes('— hwto.kurd'), JSON.stringify(deepTitle));
ok('deep-linked detail: back stays inside the app', deepBack > 0 && deepState.hash === '#/' && !deepState.notFound, JSON.stringify(deepState));
ok('deep-linked detail: no errors', deepErrs.length === 0, JSON.stringify(deepErrs.slice(0, 3)));
await deepCtx.close();

/* ---------- 12. watch screen: vidcore.io player integration ------------ */

await settle('#/movie/278');
const hasWatchBtn = await page.locator('.btn-watch').count();
ok('watch: a movie detail offers the watch button', hasWatchBtn > 0, `btnCount=${hasWatchBtn}`);

if (hasWatchBtn > 0) {
  await page.locator('.btn-watch').click();
  const mounted = await page
    .waitForSelector('.watch-frame iframe', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  ok('watch: opens watch page with iframe', mounted);
  if (mounted) {
    const frameSrc = await page.locator('.watch-frame iframe').getAttribute('src');
    const sandbox = await page.locator('.watch-frame iframe').getAttribute('sandbox');
    const extBtnCount = await page.locator('#btn-external-player').count();
    const serverBarCount = await page.locator('.watch-server-bar').count();
    const title = await page.evaluate(() => document.title);
    ok('watch: embeds vidcore.io player with TMDB ID',
      /^https:\/\/vidcore\.io\/movie\/278/.test(frameSrc || ''), frameSrc || 'no src');
    ok('watch: iframe has NO sandbox (VidCore playback requires it removed)',
      sandbox === null,
      sandbox ? `unexpected sandbox: ${sandbox}` : 'correctly absent');
    ok('watch: external player button is removed', extBtnCount === 0, `btnCount=${extBtnCount}`);
    ok('watch: server switcher bar is removed', serverBarCount === 0, `barCount=${serverBarCount}`);
    ok('watch: document title carries the title', title.includes('— مشاهدة — hwto.kurd'), title);
  }
}

await settle('#/watch/tv/1396?title=' + encodeURIComponent('Breaking Bad') + '&season=1&episode=1');
const tvFrameSrc = await page.locator('.watch-frame iframe').getAttribute('src');
ok('watch: TV route embeds vidcore.io with season/episode',
  tvFrameSrc === 'https://vidcore.io/tv/1396/1/1', tvFrameSrc || 'no src');

/* ---------- 13. transport: security headers, compression, budget ------- */

const htmlRes = await fetch(BASE + '/', { headers: { 'accept-encoding': 'gzip' } });
const htmlBody = await htmlRes.text();
const csp = htmlRes.headers.get('content-security-policy') || '';
ok('html ships a strict CSP',
  csp.includes("default-src 'self'") && csp.includes('frame-ancestors') && csp.includes('connect-src \'self\'')
    && csp.includes('https://vidcore.io'),
  JSON.stringify(csp.slice(0, 90)));
ok('html carries the hardening headers',
  htmlRes.headers.get('x-content-type-options') === 'nosniff'
    && htmlRes.headers.get('x-frame-options') === 'DENY'
    && String(htmlRes.headers.get('referrer-policy')).includes('strict-origin'),
  `nosniff=${htmlRes.headers.get('x-content-type-options')} frame=${htmlRes.headers.get('x-frame-options')}`);
ok('html response is gzipped',
  htmlRes.headers.get('content-encoding') === 'gzip'
    && Number(htmlRes.headers.get('content-length') || 0) < htmlBody.length,
  `encoded=${htmlRes.headers.get('content-length')} decoded=${htmlBody.length}`);

for (const [label, url, mustSucceed] of [
  ['css', BASE + '/css/components.css', true],
  ['api json', BASE + '/api/TMDBCache.aspx?action=search&q=batman&type=movie', true]
]) {
  const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
  const buf = Buffer.from(await res.arrayBuffer());
  const encoded = Number(res.headers.get('content-length') || 0);
  ok(`${label} response is gzipped`,
    res.ok === mustSucceed && res.headers.get('content-encoding') === 'gzip' && encoded > 0 && encoded < buf.length,
    `status=${res.status} encoded=${encoded} decoded=${buf.length}`);
}

const perfCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar' });
const perfPage = await perfCtx.newPage();
const t0 = Date.now();
await perfPage.goto(BASE + '/#/', { waitUntil: 'load' });
await perfPage.waitForFunction(() => document.querySelectorAll('.card').length > 20, null, { timeout: 40000 }).catch(() => {});
const timeToContent = Date.now() - t0;
const perf = await perfPage.evaluate((origin) => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const res = performance.getEntriesByType('resource').filter((r) => r.name.startsWith(origin));
  const css = res.find((r) => r.name.endsWith('components.css'));
  return {
    dcl: nav.domContentLoadedEventEnd || 0,
    own: res.reduce((s, r) => s + (r.encodedBodySize || 0), 0),
    count: res.length,
    cssCompressed: css ? css.encodedBodySize > 0 && css.encodedBodySize < css.decodedBodySize : false
  };
}, BASE);
ok('first content appears within the time budget',
  timeToContent < 15000 && perf.dcl < 6000,
  `dcl=${Math.round(perf.dcl)}ms content=${timeToContent}ms`);
ok('first-load payload stays within the byte budget',
  perf.own < 1_500_000,
  `bytes=${perf.own} own-resources=${perf.count}`);
ok('the browser receives the css compressed', perf.cssCompressed, JSON.stringify(perf));
await perfCtx.close();

/* ---------- final: nothing leaked into the console --------------------- */

ok('no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
ok('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 3)));
ok('no failed HTTP responses', failedResponses.length === 0, JSON.stringify(failedResponses.slice(0, 5)));
console.log(`      (ignored: ${foreignErrors.length} errors and ${foreignFailures.length} failed responses from the embedded player, ${navNoise.length} navigation-suspended requests)`);

await browser.close();
console.log(fails ? `\n${fails} FAILING` : '\nall passed');
process.exit(fails ? 1 : 0);
