/**
 * scripts/check.js — static verification of the project.
 *
 *   node scripts/check.js           syntax + structure + security rules
 *   node scripts/check.js --smoke   the above, then boot the server and hit
 *                                   `/` plus a proxied API request
 *
 * Exit code is non-zero on any failure so it can be used as a CI gate.
 */

import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodeVtt, isServable } from './subtitle-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);
const ok = (msg) => notes.push(msg);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT).filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`));
const jsFiles = allFiles.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
// Server-side code lives in scripts/, api/, lib/ and server.js: it runs in
// Node and may legitimately call fetch() (proxying, scraping, test harness).
// The layer rule and the secret scan apply to the browser app plus human-facing docs.
const BACKEND_PREFIXES = [
  path.join(ROOT, 'scripts') + path.sep,
  path.join(ROOT, 'api') + path.sep,
  path.join(ROOT, 'lib') + path.sep,
  path.join(ROOT, 'server.js')
];
const frontendFiles = (list) => list.filter((f) => !BACKEND_PREFIXES.some((b) => f === b || f.startsWith(b)));

/* 1. Syntax ------------------------------------------------------------- */

for (const file of jsFiles) {
  const res = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (res.status !== 0) {
    fail(`SYNTAX ${path.relative(ROOT, file)}\n${(res.stderr || '').trim()}`);
  }
}
if (!problems.length) ok(`${jsFiles.length} JS files parse cleanly`);

/* 2. Relative imports resolve ------------------------------------------- */

for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /(?:^|\n)\s*import\s+(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
    const base = spec.startsWith('/') ? path.join(PUBLIC, spec) : path.join(path.dirname(file), spec);
    if (!fs.existsSync(base)) {
      fail(`IMPORT ${path.relative(ROOT, file)} -> ${spec} (missing)`);
    }
  }
}
if (!problems.length) ok('all relative imports resolve');

/* 3. HTML asset references ---------------------------------------------- */

const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="(\/[^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  if (ref.startsWith('//')) continue;
  const target = path.join(PUBLIC, ref.replace(/^\/+/, ''));
  if (!fs.existsSync(target)) fail(`HTML ref ${ref} does not exist`);
}
if (!problems.length) ok(`${refs.length} index.html asset refs exist`);

const entry = path.join(PUBLIC, 'js', 'app.js');
if (!fs.existsSync(entry)) fail('public/js/app.js entry missing');
else ok('app.js entry present');

/* 4. Single service layer: fetch() only inside api.js -------------------- */

// Diagnostic / test harness files that legitimately call fetch() from the
// browser but are NOT part of the shipped app bundle. They are excluded from
// the layer rule only — the rest of the checks still apply to them.
const LAYER_EXEMPT = new Set([
  'public/player.js', // isolated player test page (#player / #src)
  'test-gate.js'      // local 302/cookie diagnostic tool
]);

for (const file of frontendFiles(jsFiles)) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  if (rel === 'public/js/api.js' || rel === 'server.js') continue;
  if (LAYER_EXEMPT.has(rel)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const hits = src.match(/(^|[^.\w])fetch\s*\(/g);
  if (hits) fail(`LAYER ${rel} calls fetch() — only public/js/api.js may do that`);
}
ok('fetch() confined to the api service layer');

/* 5. No secrets / upstream keys in the frontend -------------------------- */

const SECRET_PATTERNS = [
  { re: /api_key\s*=/i, label: 'api_key query parameter' },
  { re: /Bearer\s+[A-Za-z0-9._-]{20,}/, label: 'bearer token' },
  { re: /2960f9f22d4bf400bf02033371f525be/, label: 'hard-coded TMDB API key' }
];

for (const file of frontendFiles(allFiles)) {
  if (!/\.(js|html|css|json|svg|md)$/.test(file)) continue;
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  const src = fs.readFileSync(file, 'utf8');
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(src)) fail(`SECRET ${rel} contains ${p.label}`);
  }
}
ok('no API keys or tokens committed');

/* 6. Structure expectations --------------------------------------------- */

const expected = [
  'README.md',
  'server.js',
  'lib/servers.mjs',
  'lib/net-guard.mjs',
  'lib/security-policy.mjs',
  'package.json',
  'scripts/check.js',
  'scripts/qa.mjs',
  'scripts/qa-subtitles.mjs',
  'scripts/subtitle-corpus.mjs',
  'scripts/normalize-subtitles.mjs',
  'scripts/build-subtitles-index.mjs',
  'public/index.html',
  'public/favicon.svg',
  'public/logo.svg',
  'public/css/base.css',
  'public/css/layout.css',
  'public/css/components.css',
  'public/js/config.js',
  'public/js/tv_catalog.js',
  'public/js/catalog_data.js',
  'public/js/categories_data.js',
  'public/js/cache.js',
  'public/js/api.js',
  'public/js/store.js',
  'public/js/utils.js',
  'public/js/router.js',
  'public/js/localization.js',
  'public/js/ui.js',
  'public/js/app.js',
  'public/js/subtitles.js',
  'public/js/pages/home.js',
  'public/js/pages/list.js',
  'public/js/pages/search.js',
  'public/js/pages/details.js',
  'public/js/pages/watch.js',
  'public/subtitles/index.json'
];
for (const rel of expected) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`MISSING ${rel}`);
}
ok(`${expected.length} expected project files present`);

/* 7. API docs in api.js mention every action used by the app ------------- */

const apiSrc = fs.readFileSync(path.join(PUBLIC, 'js', 'api.js'), 'utf8');
const apiPath = path.join(PUBLIC, 'js', 'api.js');
const docHeader = apiSrc.split('\nimport ')[0];

// (a) every api.*() call made by the UI must be an actual export of api.js
const exported = new Set([...apiSrc.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]));
['api', 'ApiError'].forEach((n) => exported.add(n));

for (const file of frontendFiles(jsFiles)) {
  if (file === apiPath) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bapi\.(\w+)\s*\(/g)) {
    if (!exported.has(m[1])) fail(`EXPORT ${path.relative(ROOT, file)} calls api.${m[1]}() but api.js does not export it`);
  }
}
ok(`api.js exports checked: ${[...exported].filter((n) => n !== 'api' && n !== 'ApiError').join(', ')}`);

// (b) every literal action built inside api.js must be documented in its header
const actions = new Set([...apiSrc.matchAll(/action:\s*['"](\w+)['"]/g)].map((m) => m[1]));
for (const action of actions) {
  if (!docHeader.includes(action)) fail(`DOCS action=${action} is used in api.js but missing from its header comment`);
}
if (actions.size) ok(`all ${actions.size} literal actions documented: ${[...actions].join(', ')}`);

/* 8. Subtitle corpus: index.json must match the files, and the parser works
     on a real VTT file (the watch screen renders these cues). -------------- */

const subDir = path.join(PUBLIC, 'subtitles');
const subIndexPath = path.join(subDir, 'index.json');
const subtitleFiles = fs.existsSync(subDir) ? walk(subDir).filter((file) => file !== subIndexPath) : [];

if (!fs.existsSync(subIndexPath)) {
  if (!subtitleFiles.length) {
    ok('subtitle corpus is not installed; subtitle-file checks skipped');
  } else {
    fail('MISSING public/subtitles/index.json');
  }
} else {
  let subIndex = null;
  try {
    subIndex = JSON.parse(fs.readFileSync(subIndexPath, 'utf8'));
  } catch (err) {
    fail(`subtitles/index.json is not valid JSON: ${err.message}`);
  }

  if (subIndex && typeof subIndex === 'object') {
    // English files were removed on purpose — only Kurdish and Arabic stay.
    const ALLOWED_LANGS = new Set(['ku', 'ar']);
    let indexed = 0;
    let missing = 0;
    let removedLangs = 0;
    let unservable = 0;
    for (const [key, langs] of Object.entries(subIndex)) {
      if (!Array.isArray(langs)) {
        fail(`subtitle entry ${key} is not an array of languages`);
        continue;
      }
      for (const lang of langs) {
        if (!ALLOWED_LANGS.has(lang)) {
          removedLangs += 1;
          if (removedLangs <= 5) fail(`subtitle entry ${key} still lists removed language "${lang}"`);
        }
        indexed += 1;
        const file = path.join(subDir, `${key}/${lang}.vtt`);
        if (!fs.existsSync(file)) {
          missing += 1;
          if (missing <= 5) fail(`subtitle file missing: public/subtitles/${key}/${lang}.vtt`);
          continue;
        }
        // A mojibake, empty or foreign-language file must never be reachable
        // through the index (build-subtitles-index.mjs filters the same way).
        const verdict = isServable(decodeVtt(fs.readFileSync(file)).text);
        if (!verdict.ok) {
          unservable += 1;
          if (unservable <= 5) fail(`indexed subtitle is unusable (${verdict.reason}): public/subtitles/${key}/${lang}.vtt`);
        }
      }
    }
    if (missing > 5) fail(`…and ${missing - 5} more missing subtitle files`);
    if (unservable > 5) fail(`…and ${unservable - 5} more unusable indexed subtitles`);
    if (indexed && !missing) ok(`all ${indexed} indexed subtitle files exist (${Object.keys(subIndex).length} titles)`);
    if (indexed && !removedLangs) ok('subtitle index carries only ku/ar (english removed)');
    if (indexed && !missing && !unservable) ok(`every indexed subtitle is clean utf-8 kurdish/arabic text (${indexed} files audited)`);

    // The parser is exercised on a real file from the corpus. The long-standing
    // samples are preferred; a re-synced corpus that drops them falls back to
    // the first indexed file for that language instead of failing spuriously.
    const pickSample = (lang, canonicalId) => {
      const canonical = path.join(subDir, `movie/${canonicalId}/${lang}.vtt`);
      if (fs.existsSync(canonical)) return { file: canonical, strict: true, rel: `movie/${canonicalId}/${lang}.vtt` };
      const key = Object.entries(subIndex).find(([, langs]) => langs.includes(lang))?.[0];
      if (!key || !fs.existsSync(path.join(subDir, `${key}/${lang}.vtt`))) return null;
      return { file: path.join(subDir, `${key}/${lang}.vtt`), strict: false, rel: `${key}/${lang}.vtt` };
    };

    const sample = indexed ? pickSample('ku', 12500) : null;
    if (sample) {
      try {
        const subs = await import(pathToFileURL(path.join(PUBLIC, 'js', 'subtitles.js')).href);
        const cues = subs.parseVtt(fs.readFileSync(sample.file, 'utf8'));
        if (cues.length < (sample.strict ? 10 : 1)) {
          fail(`subtitle parser produced only ${cues.length} cues from ${sample.rel}`);
        } else {
          const probe = cues[Math.min(5, cues.length - 1)];
          const hit = subs.cueAt(cues, (probe.start + probe.end) / 2);
          if (hit !== probe.text) fail('cueAt() did not return the covering cue');
          else ok(`subtitle parser: ${cues.length} cues parsed from ${sample.rel}, cueAt() verified`);
        }

        // 17% of the corpus carries ASS/SRT markup — it must never reach the screen.
        const styled = pickSample('ar', 157354);
        if (styled) {
          const styledCues = subs.parseVtt(fs.readFileSync(styled.file, 'utf8'));
          const markup = styledCues.find((cue) => /[<{]/.test(cue.text));
          if (!styledCues.length) fail('subtitle parser produced no cues from the markup sample');
          else if (markup) fail(`subtitle parser left markup behind: ${JSON.stringify(markup.text.slice(0, 70))}`);
          else ok('subtitle parser strips ASS/font markup');
        }
      } catch (err) {
        fail(`subtitle parser check failed: ${err.message}`);
      }
    } else if (indexed || subtitleFiles.length) {
      fail('no Kurdish subtitle file found in public/subtitles to exercise the parser');
    }
    if (!indexed && !subtitleFiles.length) ok('subtitle index is empty; no subtitle files are installed');
  }
}

/* 9. Security contract: HA-1 (SSRF guard), HA-2 (no code execution) ----- */

/* Production parity: Vercel serves /public statically, so server.js never ships
   the HTML there — vercel.json must mirror the same policy or production would
   silently run without CSP. One source of truth: lib/security-policy.mjs. */
{
  const policy = await import(pathToFileURL(path.join(ROOT, 'lib', 'security-policy.mjs')).href);
  let vjson = null;
  try {
    vjson = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  } catch (err) {
    fail(`vercel.json is not valid JSON: ${err.message}`);
  }
  if (vjson) {
    const rules = Array.isArray(vjson.headers) ? vjson.headers : [];
    const headerValue = (source, key) => {
      for (const rule of rules) {
        if (rule.source !== source) continue;
        const hit = (rule.headers || []).find((h) => h.key.toLowerCase() === key.toLowerCase());
        if (hit) return hit.value;
      }
      return null;
    };
    const drifted = [];
    // CORP is deliberately not mirrored on every route in production: the
    // subtitles rule sets it to cross-origin instead, so the embed can read the
    // VTT. Everything else must match byte-for-byte.
    for (const [key, value] of Object.entries(policy.SECURITY_HEADERS)) {
      if (key === 'Cross-Origin-Resource-Policy') continue;
      const mirrored = headerValue('/(.*)', key);
      if (mirrored === null) drifted.push(`${key} missing`);
      else if (mirrored !== value) drifted.push(`${key} differs`);
    }
    const csp = headerValue('/(.*)', 'Content-Security-Policy');
    if (!csp) drifted.push('Content-Security-Policy missing');
    else if (csp !== policy.CSP) drifted.push('Content-Security-Policy differs from lib/security-policy.mjs');
    const subOrigin = headerValue('/subtitles/(.*)', 'Access-Control-Allow-Origin');
    if (subOrigin !== '*') drifted.push('subtitles Access-Control-Allow-Origin missing');
    const subCorp = headerValue('/subtitles/(.*)', 'Cross-Origin-Resource-Policy');
    if (subCorp !== policy.SUBTITLE_CORS_HEADERS['Cross-Origin-Resource-Policy']) {
      drifted.push('subtitles Cross-Origin-Resource-Policy missing');
    }
    if (drifted.length) drifted.forEach((d) => fail(`PARITY vercel.json: ${d}`));
    else ok('vercel.json mirrors the server security policy (CSP + headers + subtitle CORS)');

    // Every serverless function the repo ships must declare a runtime budget;
    // the default would kill the 10s+ upstreams mid-fetch.
    const fnEntries = Object.keys(vjson.functions || {});
    for (const file of walk(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (!fnEntries.includes(rel)) fail(`vercel.json has no maxDuration for ${rel}`);
    }
    if (fnEntries.every((f) => fs.existsSync(path.join(ROOT, f)))) {
      ok(`vercel.json pins a maxDuration for all ${fnEntries.length} serverless functions`);
    }
  }
}

const SERVER_FILES = [
  path.join(ROOT, 'server.js'),
  ...walk(path.join(ROOT, 'api')).filter((f) => f.endsWith('.js')),
  ...walk(path.join(ROOT, 'lib')).filter((f) => f.endsWith('.mjs'))
];

{
  // HA-2: no dynamic code execution anywhere on the server. Comments and the
  // unpacker's *text* markers are allowed; a real call is not.
  const callRe = /\beval\s*\(/;
  const allowedContext = /includes\(|indexOf\(|\.indexOf|split\(|match\(|['"`]eval\(function\(p,a,c,k/;
  const bad = [];
  for (const file of SERVER_FILES) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
      if (/\bnew\s+Function\s*\(/.test(line)) bad.push(`${rel}:${i + 1} new Function(`);
      if (/\bnew\s+AsyncFunction\s*\(/.test(line)) bad.push(`${rel}:${i + 1} new AsyncFunction(`);
      if (/\bvm\b.*\.runIn|require\(['"]node:vm/.test(line)) bad.push(`${rel}:${i + 1} node:vm`);
      if (callRe.test(line) && !allowedContext.test(line)) bad.push(`${rel}:${i + 1} eval(`);
    });
  }
  if (bad.length) bad.forEach(fail);
  else ok('HA-2: no eval/new Function/node:vm in any server module');

  // HA-1: every endpoint that reads a caller-supplied URL must route it through
  // the shared guard (lib/net-guard.mjs) before fetching it.
  const urlEntrances = [];
  for (const file of SERVER_FILES) {
    const rel = path.relative(ROOT, file);
    const src = fs.readFileSync(file, 'utf8');
    if (!/req\.query/.test(src)) continue;
    if (!/['"`]?url['"`]?\s*\]|\burl\b/.test(src)) continue;
    const readsUrl = /req\.query.{0,12}\burl\b|req\.query\?\.url|q\.url\b|req\.query\?\.\s*url/.test(src);
    if (!readsUrl) continue;
    const guarded = /safeRemoteUrl|safeTargetUrl|hostOnAllowlist|isBlockedHost/.test(src);
    urlEntrances.push({ rel, guarded });
    if (!guarded) fail(`HA-1: ${rel} reads req.query.url but never calls the net-guard`);
  }
  if (urlEntrances.length && !problems.length) {
    ok(`HA-1: ${urlEntrances.length} url-taking endpoint(s) route through lib/net-guard.mjs`);
  }
  if (!urlEntrances.length) fail('HA-1: no url-taking endpoint found — the guard would be untested');

  // HA-2 behaviour: the packer payload is decoded as TEXT. The sample unpacks to
  // a call plus an obvious side effect; only the text must ever exist.
  try {
    const s4u = await import(pathToFileURL(path.join(ROOT, 'api', 'shahid4u-extractor.js')).href);
    const packed =
      "eval(function(p,a,c,k,e,d){e=function(c){return c};return p}" +
      "('0(\\'1\\')',10,2,'sayHi|__PWN__'.split('|'),0,{}))";
    const unpacked = s4u.unpackDeanEdwards(packed);
    if (!unpacked || !unpacked.includes("sayHi('__PWN__')")) {
      fail(`HA-2: packer sample did not decode to text: ${JSON.stringify(unpacked)}`);
    } else if (globalThis.__PWN__ !== undefined) {
      fail('HA-2: the packed payload was executed instead of decoded');
    } else if (s4u.unpackDeanEdwards('eval(function(p,a,c,k,e,d){unbalanced') !== null) {
      fail('HA-2: malformed input should decode to null, not throw or execute');
    } else {
      ok('HA-2: packer decodes to text with zero execution (side-effect probe stayed undefined)');
    }
  } catch (err) {
    fail(`HA-2: extractor module check failed: ${err.message}`);
  }
}

/* ------------------------------------------------------------------------ */

function report() {
  for (const n of notes) console.log(`  ok  ${n}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
  } else {
    console.log('\nAll checks passed.');
  }
}

report();

/* 9. Optional smoke test -------------------------------------------------- */

if (process.argv.includes('--smoke') && !problems.length) {
  const PORT = Number(process.env.SMOKE_PORT) || 4177;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    // The operator allowlists are deliberately pointed at the loopback address:
    // the guard must refuse it anyway (HA-1). If the allowlist could "win", the
    // SSRF assertions below would fail loudly.
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SCRAPER_ALLOW_HOSTS: '127.0.0.1',
      SHAHID4U_ALLOW_HOSTS: '127.0.0.1,localhost',
      FASTVID_ALLOW_HOSTS: '127.0.0.1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  const base = `http://127.0.0.1:${PORT}`;

  const withTimeout = async (url, ms = 25000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const text = await res.text();
      return { status: res.status, text, headers: res.headers };
    } finally {
      clearTimeout(t);
    }
  };

  const waitForServer = async () => {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${base}/favicon.svg`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return true;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  let failed = false;
  try {
    const up = await waitForServer();
    if (!up) throw new Error(`server did not start\n${serverLog}`);

    const home = await withTimeout(`${base}/`);
    if (home.status !== 200 || !home.text.includes('id="app"')) {
      throw new Error(`GET / -> ${home.status}`);
    }
    console.log('  ok  smoke: GET / serves index.html');

    const css = await withTimeout(`${base}/css/base.css`);
    if (css.status !== 200 || !css.text.includes('--brand')) throw new Error(`GET /css/base.css -> ${css.status}`);
    console.log('  ok  smoke: GET /css/base.css');

    const langModule = await withTimeout(`${base}/js/localization.js`);
    if (langModule.status !== 200 || !langModule.text.includes('translateText')) throw new Error(`GET /js/localization.js -> ${langModule.status}`);
    console.log('  ok  smoke: localization module is served');

    const subtitlesIndex = await withTimeout(`${base}/subtitles/index.json`);
    let subIndexBody = null;
    try {
      subIndexBody = JSON.parse(subtitlesIndex.text);
    } catch {
      /* not JSON */
    }
    if (subtitlesIndex.status !== 200 || !subIndexBody || typeof subIndexBody !== 'object') {
      throw new Error(`GET /subtitles/index.json -> ${subtitlesIndex.status}`);
    }
    console.log(`  ok  smoke: subtitle index served (${Object.keys(subIndexBody).length} titles)`);

    const stats = await withTimeout(`${base}/api/TMDBCache.aspx?action=stats`);
    if (stats.status !== 200) throw new Error(`API proxy -> ${stats.status}`);
    const json = JSON.parse(stats.text);
    if (typeof json.movies !== 'number') throw new Error('API proxy returned unexpected payload');
    console.log(`  ok  smoke: API proxy works (movies=${json.movies}, tv=${json.tv_shows})`);

    const detail = await withTimeout(`${base}/api/TMDBCache.aspx?action=toprated&type=movie&limit=5`);
    if (detail.status !== 200) throw new Error(`toprated -> ${detail.status}`);
    console.log('  ok  smoke: proxied list endpoint responds');

    /* HA-1: the fetch proxies must refuse internal targets, even when the
       operator allowlist names them, and must reject non-http schemes. */
    const ssrfTargets = [
      ['loopback v4', `http://127.0.0.1:${PORT}/`],
      ['metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['private A', 'http://10.0.0.1/admin'],
      ['private B', 'http://192.168.1.1/'],
      ['private C', 'http://172.20.1.1/'],
      ['cgnat', 'http://100.64.0.1/'],
      ['benchmark net', 'http://198.18.0.1/'],
      ['loopback v6', 'http://[::1]:8080/'],
      ['ipv4-mapped v6', 'http://[::ffff:127.0.0.1]/'],
      ['hex loopback', 'http://0x7f000001/'],
      ['decimal loopback', 'http://2130706433/'],
      ['file scheme', 'file:///etc/passwd'],
      ['localhost name', 'http://localhost/'],
      ['internal tld', 'http://metadata.google.internal/']
    ];
    const ssrfFailures = [];
    for (const endpoint of ['/api/fastvid', '/api/scraper', '/api/shahid4u-extractor']) {
      for (const [label, target] of ssrfTargets) {
        const probe = await withTimeout(`${base}${endpoint}?url=${encodeURIComponent(target)}`);
        if (probe.status !== 400) ssrfFailures.push(`${endpoint} ${label} -> ${probe.status}`);
      }
    }
    if (ssrfFailures.length) {
      ssrfFailures.forEach((f) => console.log(`     ✗ ${f}`));
      throw new Error(`${ssrfFailures.length} SSRF target(s) were not rejected`);
    }
    console.log(`  ok  smoke: HA-1 rejects ${ssrfTargets.length} internal/non-http targets on 3 endpoints (allowlist cannot unblock them)`);

    // Allowlisted-host policy still applies to *public* hosts: a random public
    // host is not pinned by the allowlist and must be refused too.
    const offList = await withTimeout(`${base}/api/scraper?url=${encodeURIComponent('https://example.com/')}`);
    if (offList.status !== 400) throw new Error(`scraper accepted a non-allowlisted host -> ${offList.status}`);
    const noUrl = await withTimeout(`${base}/api/fastvid`);
    if (noUrl.status !== 400) throw new Error(`fastvid without url -> ${noUrl.status}`);
    console.log('  ok  smoke: HA-1 keeps the allowlist closed for unlisted public hosts');

    // The embed player fetches our sub_file from vidlink.pro's origin, so the
    // VTT must be CORS-open (production mirrors this in vercel.json).
    const subIndex = JSON.parse(subtitlesIndex.text);
    const sampleKey = Object.keys(subIndex)[0];
    const sampleLang = (subIndex[sampleKey] || [])[0];
    if (sampleKey && sampleLang) {
      const vtt = await withTimeout(`${base}/subtitles/${sampleKey}/${sampleLang}.vtt`);
      const acao = vtt.headers.get('access-control-allow-origin');
      if (vtt.status !== 200 || acao !== '*') {
        throw new Error(`subtitle VTT CORS -> ${vtt.status} acao=${acao}`);
      }
      console.log('  ok  smoke: subtitle VTT is served CORS-open for the embed player');
    }

    /* MD-3: the CSP served with the app must stay narrow. */
    const csp = home.headers.get('content-security-policy') || '';
    const cspChecks = {
      "has a policy at all": Boolean(csp),
      "no 'unsafe-eval'": !/unsafe-eval/.test(csp),
      "no wildcard source": !/(^|[;\s])\*([;\s]|$)/.test(csp),
      "connect-src is same-origin": /connect-src 'self' blob:;/.test(csp),
      "frame-src has no plaintext http": !/frame-src[^;]*http:/.test(csp),
      "object-src 'none'": /object-src 'none'/.test(csp),
      "frame-ancestors 'none'": /frame-ancestors 'none'/.test(csp),
      "base-uri 'self'": /base-uri 'self'/.test(csp),
      "form-action 'self'": /form-action 'self'/.test(csp),
      "default-src is 'self' only": /default-src 'self';/.test(csp)
    };
    const cspBad = Object.entries(cspChecks).filter(([, v]) => !v).map(([k]) => k);
    if (cspBad.length) throw new Error(`CSP weak: ${cspBad.join(', ')} — ${csp}`);
    console.log(`  ok  smoke: MD-3 CSP stays narrow (${Object.keys(cspChecks).length} assertions)`);

    const nosniff = home.headers.get('x-content-type-options');
    const xfo = home.headers.get('x-frame-options');
    if (nosniff !== 'nosniff' || xfo !== 'DENY') {
      throw new Error(`security headers missing: nosniff=${nosniff} x-frame-options=${xfo}`);
    }
    console.log('  ok  smoke: nosniff + X-Frame-Options DENY are present');

    const watchJs = await withTimeout(`${base}/js/pages/watch.js`);
    if (watchJs.status !== 200 || !watchJs.text.includes('vidlink.pro')) {
      throw new Error(`GET /js/pages/watch.js -> ${watchJs.status}`);
    }
    console.log('  ok  smoke: GET /js/pages/watch.js serves vidlink-based watch page');

    // Run deep E2E verification of player, server switching, and TV series matching
    try {
      const os = await import('node:os');
      const home = os.homedir();
      const pRoots = [
        path.join(ROOT, 'node_modules', 'playwright-core'),
        process.env.PLAYWRIGHT_CORE,
        path.join(home, '.config', 'opencode', 'skills', 'gstack', 'gstack-main', 'node_modules', 'playwright-core')
      ];
      let pEntry = null;
      for (const d of pRoots) {
        if (!d) continue;
        for (const f of ['index.mjs', 'index.js']) {
          const p = path.join(d, f);
          if (fs.existsSync(p)) { pEntry = p; break; }
        }
        if (pEntry) break;
      }

      const cBases = [
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
        path.join(home, 'AppData', 'Local', 'ms-playwright')
      ].filter(Boolean);
      let cExe = null;
      for (const b of cBases) {
        try {
          const vers = fs.readdirSync(b).filter(n => n.startsWith('chromium')).sort().reverse();
          for (const v of vers) {
            const p = path.join(b, v, 'chrome-win64', 'chrome.exe');
            if (fs.existsSync(p)) { cExe = p; break; }
          }
        } catch {}
        if (cExe) break;
      }

      if (pEntry && cExe) {
        const { chromium } = await import(pathToFileURL(pEntry).href);
        const browser = await chromium.launch({ headless: true, executablePath: cExe });
        try {
          const page = await browser.newPage({ locale: 'ar' });

          // 1. Movie detail -> watch
          await page.goto(`${base}/#/movie/278`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.btn-watch', { timeout: 10000 });
          await page.click('.btn-watch');
          await page.waitForSelector('.watch-frame iframe', { timeout: 10000 });
          const movieFrameSrc = await page.getAttribute('.watch-frame iframe', 'src');
          const docTitle = await page.title();
          if (!/^https:\/\/vidlink\.pro\/movie\/278/.test(movieFrameSrc || '')) {
            throw new Error(`Movie frame src mismatch: ${movieFrameSrc}`);
          }
          if (!docTitle.includes('— مشاهدة — hwto.kurd')) {
            throw new Error(`Movie doc title mismatch: ${docTitle}`);
          }
          console.log('  ok  e2e: movie watch embeds vidlink with TMDB ID');

          // Verify the server bar renders its primary entry instantly and
          // offers exactly the two supported language groups.
          const serverBar = await page.$$eval('.server-bar:not([hidden])', els => els.length);
          if (serverBar !== 1) {
            throw new Error(`Server bar should be visible, found: ${serverBar}`);
          }
          const primaryServer = await page.$$eval('#server-bar-list .server-btn[data-server-key="vidlink"]', els => els.length);
          if (primaryServer !== 1) {
            throw new Error(`Primary server button missing, found: ${primaryServer}`);
          }
          const langBtns = await page.$$eval('#server-lang .server-lang-btn', els => els.map(b => b.dataset.serverLang));
          if (JSON.stringify(langBtns) !== '["ar","ku"]') {
            throw new Error(`Language buttons should be ar+ku, found: ${JSON.stringify(langBtns)}`);
          }
          const movieSandbox = await page.getAttribute('.watch-frame iframe', 'sandbox');
          if (!movieSandbox || !movieSandbox.includes('allow-scripts') || !movieSandbox.includes('allow-same-origin')) {
            throw new Error(`Iframe must be sandboxed with scripts + same-origin so VidLink plays: ${movieSandbox}`);
          }
          if (movieSandbox.includes('allow-popups') || movieSandbox.includes('allow-top-navigation') || movieSandbox.includes('allow-modals')) {
            throw new Error(`Iframe sandbox must not allow popups/top-navigation/modals: ${movieSandbox}`);
          }
          const extBtnCount = await page.$$eval('#btn-external-player', els => els.length);
          if (extBtnCount !== 0) {
            throw new Error(`External player button should be removed, found: ${extBtnCount}`);
          }
          console.log('  ok  e2e: single primary server VidLink verified (sandboxed, no popups)');

          // 2. TV watch route with season and episode
          await page.goto(`${base}/#/watch/tv/1396?title=${encodeURIComponent('Breaking Bad')}&season=1&episode=1`, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => document.querySelector('.watch-frame iframe')?.getAttribute('src') === 'https://vidlink.pro/tv/1396/1/1', { timeout: 10000 });
          const tvFrameSrc = await page.getAttribute('.watch-frame iframe', 'src');
          if (tvFrameSrc !== 'https://vidlink.pro/tv/1396/1/1') {
            throw new Error(`TV frame src mismatch: ${tvFrameSrc}`);
          }
          console.log('  ok  e2e: TV watch embeds vidlink with season and episode');

          // Switch episode in TV watch
          await page.click('[data-ep="2"]');
          await page.waitForTimeout(500);
          const ep2Src = await page.getAttribute('.watch-frame iframe', 'src');
          if (ep2Src !== 'https://vidlink.pro/tv/1396/1/2') {
            throw new Error(`Episode click failed: ${ep2Src}`);
          }
          console.log('  ok  e2e: episode button switches player to episode 2');

          // Direct slash TV route navigation: #/watch/tv/1396/2/3 embeds VidLink directly
          await page.goto(`${base}/#/watch/tv/1396/2/3`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.watch-frame iframe', { timeout: 10000 });
          const slashTvSrc = await page.getAttribute('.watch-frame iframe', 'src');
          if (slashTvSrc !== 'https://vidlink.pro/tv/1396/2/3') {
            throw new Error(`Direct slash TV route failed to embed VidLink: ${slashTvSrc}`);
          }
          const s2Active = await page.$eval('[data-season-tab="2"]', el => el.classList.contains('is-active'));
          const ep3Active = await page.$eval('[data-ep="3"]', el => el.classList.contains('is-active'));
          if (!s2Active || !ep3Active) {
            throw new Error(`Season 2 or Episode 3 not active on slash route: s2=${s2Active}, ep3=${ep3Active}`);
          }
          console.log('  ok  e2e: direct slash TV route (#/watch/tv/:id/:season/:ep) mounts with correct active season & episode');

          // Click Season 4 tab in watch page
          await page.click('[data-season-tab="4"]');
          await page.waitForTimeout(500);
          const s4Ep1Src = await page.getAttribute('.watch-frame iframe', 'src');
          if (s4Ep1Src !== 'https://vidlink.pro/tv/1396/4/1') {
            throw new Error(`Watch season tab switch failed: ${s4Ep1Src}`);
          }
          console.log('  ok  e2e: watch season tab switches to Season 4 Episode 1');

          // Click Next Episode button
          await page.click('[data-nav-dir="next"]');
          await page.waitForTimeout(500);
          const s4Ep2Src = await page.getAttribute('.watch-frame iframe', 'src');
          if (s4Ep2Src !== 'https://vidlink.pro/tv/1396/4/2') {
            throw new Error(`Next episode button failed: ${s4Ep2Src}`);
          }
          console.log('  ok  e2e: next episode navigation button advances to Episode 2');

          // Verify external player link is absent and stream URL input matches VidLink
          const extHref = await page.$('#btn-external-player');
          if (extHref) {
            throw new Error('External player button should be removed from DOM');
          }
          const streamUrlVal = await page.$eval('#stream-url-input', el => el.value);
          if (streamUrlVal !== 'https://vidlink.pro/tv/1396/4/2') {
            throw new Error(`Stream url input mismatch: ${streamUrlVal}`);
          }
          console.log('  ok  e2e: external player button is absent and stream URL input matches VidLink');

          // 3. TV details page season and episode count check for Fallout (106379: 1 season, 8 episodes)
          await page.goto(`${base}/#/tv/106379`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.detail-seasons-section', { timeout: 15000 });
          const falloutTabs = await page.$$eval('[data-detail-season]', el => el.map(e => e.textContent.trim()));
          const falloutEps = await page.$$eval('#detail-episodes-grid a', el => el.length);
          if (falloutTabs.length !== 2 || falloutEps !== 8) {
            throw new Error(`Fallout season/episode count mismatch: tabs=${falloutTabs.length}, eps=${falloutEps}`);
          }
          console.log(`  ok  e2e: Fallout TV metadata matched perfectly (2 seasons, 8 episodes)`);

          // TV details page season and episode count check for Breaking Bad (1396: 5 seasons, S1=7 eps)
          await page.goto(`${base}/#/tv/1396`, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.detail-seasons-section', { timeout: 15000 });
          const bbTabs = await page.$$eval('[data-detail-season]', el => el.length);
          const bbS1Eps = await page.$$eval('#detail-episodes-grid a', el => el.length);
          if (bbTabs !== 5 || bbS1Eps !== 7) {
            throw new Error(`Breaking Bad season/episode count mismatch: seasons=${bbTabs}, S1eps=${bbS1Eps}`);
          }
          console.log(`  ok  e2e: Breaking Bad TV metadata matched perfectly (5 seasons, S1=7 episodes)`);

          // Click Season 5 tab for Breaking Bad (S5=16 episodes)
          await page.click('[data-detail-season="5"]');
          await page.waitForTimeout(500);
          const bbS5Eps = await page.$$eval('#detail-episodes-grid a', el => el.length);
          if (bbS5Eps !== 16) {
            throw new Error(`Breaking Bad S5 episode count mismatch: ${bbS5Eps} !== 16`);
          }
          console.log(`  ok  e2e: Breaking Bad Season 5 matches exactly 16 episodes`);
        } finally {
          await browser.close();
        }
      }
    } catch (e) {
      if (e.message?.includes('Cannot find module') || e.message?.includes('Chromium')) {
        console.log('  warn e2e verification: Playwright/Chromium environment not configured');
      } else {
        throw e;
      }
    }

    console.log('\nSmoke test passed.');
  } catch (err) {
    failed = true;
    console.error(`\nSmoke test FAILED: ${err.message}`);
  } finally {
    server.kill();
  }

  if (failed) process.exit(1);
}

if (problems.length) process.exit(1);
