/**
 * build-subtitles-index.mjs — regenerate public/subtitles/index.json from the
 * VTT files on disk.
 *
 *   node scripts/build-subtitles-index.mjs
 *
 * Layout on disk:  public/subtitles/{type}/{id}/{lang}.vtt
 * Index produced:  { "{type}/{id}": ["ar","ku"], … }
 *
 * The corpus (~4600 movies × Arabic/Kurdish) is authoritative: the index is a
 * derived file, so it is rebuilt from the files rather than edited by hand.
 * scripts/check.js verifies that every indexed file exists, and the watch
 * screen reads the index to offer languages on the subtitle bar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUB_DIR = path.join(ROOT, 'public', 'subtitles');
const INDEX_PATH = path.join(SUB_DIR, 'index.json');

const LANG_FILE = /^([a-z]{2,5}(?:-[a-z0-9]{2,5})?)\.vtt$/i;

const index = {};
let titles = 0;
let files = 0;

if (fs.existsSync(SUB_DIR)) {
  for (const type of fs.readdirSync(SUB_DIR, { withFileTypes: true })) {
    if (!type.isDirectory()) continue;
    const typeDir = path.join(SUB_DIR, type.name);
    for (const title of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!title.isDirectory()) continue;
      const langs = fs
        .readdirSync(path.join(typeDir, title.name))
        .map((name) => (LANG_FILE.exec(name) || [])[1])
        .filter(Boolean)
        .map((code) => code.toLowerCase());
      if (!langs.length) continue;
      index[`${type.name}/${title.name}`] = [...new Set(langs)].sort();
      titles += 1;
      files += index[`${type.name}/${title.name}`].length;
    }
  }
}

const ordered = {};
for (const key of Object.keys(index).sort()) ordered[key] = index[key];

fs.writeFileSync(INDEX_PATH, JSON.stringify(ordered) + '\n');
console.log(`wrote public/subtitles/index.json — ${titles} titles, ${files} files`);
