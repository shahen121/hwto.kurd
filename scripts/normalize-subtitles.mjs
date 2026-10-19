/**
 * normalize-subtitles.mjs — audit and repair the scraped VTT corpus.
 *
 *   node scripts/normalize-subtitles.mjs            # repair in place, report
 *   node scripts/normalize-subtitles.mjs --dry-run  # report only, write nothing
 *   node scripts/normalize-subtitles.mjs --prune    # also delete unusable files
 *
 * Two jobs:
 *   * repair — files that are UTF-16LE with their 0x00 bytes stripped are
 *     rewritten as clean UTF-8 (they otherwise render as mojibake);
 *   * audit  — report files that are not Kurdish/Arabic (English, Sinhala…),
 *     that hold no cue text, or that are cue skeletons.
 *
 * Unusable files are only *reported* by default, because
 * scripts/build-subtitles-index.mjs simply refuses to index them — nothing the
 * viewer can reach. --prune removes them from disk when that is wanted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeVtt, isServable } from './subtitle-corpus.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUB_DIR = path.join(ROOT, 'public', 'subtitles');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const prune = args.has('--prune');

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.vtt')) files.push(p);
  }
};
if (fs.existsSync(SUB_DIR)) walk(SUB_DIR);

const repaired = [];
const unusable = [];
for (const file of files) {
  const buf = fs.readFileSync(file);
  const { text, encoding, repaired: wasRepaired } = decodeVtt(buf);
  const rel = path.relative(ROOT, file).replaceAll('\\', '/');
  if (wasRepaired) {
    repaired.push(rel);
    if (!dryRun) fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  }
  const verdict = isServable(text);
  if (!verdict.ok) {
    unusable.push({ rel, reason: verdict.reason });
    if (prune && !dryRun) fs.unlinkSync(file);
  }
  void encoding;
}

console.log(`${dryRun ? '[dry-run] ' : ''}scanned ${files.length} subtitle files`);
console.log(`  repaired (utf-16 stripped of NULs -> utf-8): ${repaired.length}`);
for (const rel of repaired.slice(0, 5)) console.log(`    ${rel}`);
if (repaired.length > 5) console.log(`    … and ${repaired.length - 5} more`);

console.log(`  unusable (excluded from the index): ${unusable.length}`);
const byReason = new Map();
for (const u of unusable) byReason.set(u.reason, [...(byReason.get(u.reason) || []), u.rel]);
for (const [reason, list] of byReason) {
  console.log(`    ${reason}: ${list.length}`);
  for (const rel of list.slice(0, 3)) console.log(`      ${rel}`);
  if (list.length > 3) console.log(`      … and ${list.length - 3} more`);
}
if (unusable.length && !prune) console.log('  (pass --prune to delete the unusable files)');
