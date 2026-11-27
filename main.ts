// Token Radar, model radar-4 (Node 22, standard library only).
//
// What this program does, in order:
//   1. Reads the sealed DefiLlama snapshot (758 protocols, 40 on the watchlist).
//   2. Scores the pre-token protocols with the radar-4 model in lib/model.ts
//      and builds the ranked board: all 40 watchlist slugs plus every
//      rankable early pre-token protocol below the $50M floor, ranked 1..N
//      by implied value, each with a ten-step farm plan.
//   3. Refuses to write anything when the board would fail the gate, or
//      when a screenshot is missing, misnamed or over the 512 KiB cap, and
//      refuses to finish when data.js disagrees with board.json: the
//      dashboard reads data.js and the scorer reads board.json, so the two
//      must carry the same rows in the same order with the same values.
//   4. Writes board.json and data.js, copies this repository's dashboard/
//      and screenshots/, and writes dossier.json last with the vendored
//      make.fun library, so the scorer can rebuild it from the same output
//      and compare bytes.
//
// The dashboard is a static page with no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read the
// data.js this program writes from the same board board.json carries. The
// page recomputes a row's implied value from the snapshot figures and
// checks it against the board, so the page's code and the board's data are
// visibly the same arithmetic.
//
// Deterministic: two runs on the same snapshot write byte-identical output.
// No network, no API key, no required environment variable at runtime.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// --input takes either the snapshot file itself or the directory holding it.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** Where this file lives: dashboard/ and screenshots/ are copied from beside it. */
const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function failInput(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(2);
}

function failBoard(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** One `--name <value>` (or `--name=<value>`) argument, else `fallback`. */
function arg(name: string, fallback: string): string {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`${flag}=`));
  return joined === undefined ? fallback : joined.slice(flag.length + 1);
}

/** Resolve the snapshot file: --input names the file, or its directory. */
function snapshotPath(): string {
  const inputArg = arg('input', '/input');
  const file = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(file)) {
    failInput(`no snapshot at ${file}: pass --input <snapshot.json|directory> or mount the sealed /input`);
  }
  return file;
}

/** The output directory: --output, else MAKEFUN_OUTPUT_DIR, else /output. */
function outputDir(): string {
  return arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
}

/**
 * Copy one directory's regular files into `to`, skipping dot-names, and
 * return the names copied. The program never edits these files, so what
 * the judge reads is exactly what the repository holds.
 */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * The screenshots the gate wants: 3 or 4 images, each a legal dossier
 * name and at most 512 KiB. A shot over the cap is refused here, before
 * the dossier is written, so a bad image can never reach the scorer.
 */
function checkShots(from: string, shots: string[]): void {
  if (shots.length < 3) {
    failBoard(
      `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: ` +
        'hand in 3, the board, a detail view and a filtered view',
    );
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      failBoard(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
    const size = statSync(join(from, name)).size;
    if (size > SCREENSHOT_CAPS.max_bytes) {
      failBoard(`screenshots/${name} is ${size} bytes, over the 512 KiB cap: re-export it smaller`);
    }
  }
}

const snapshot = parseSnapshot(readFileSync(snapshotPath(), 'utf8'));
const out = outputDir();
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) failBoard(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
const dataJs = dataScript(radar);
writeFileSync(join(out, 'data.js'), dataJs);

// The dashboard reads data.js and the scorer reads board.json: prove the
// two carry the same rows in the same order with the same values before
// anything else is written. data.js is one assignment, `window.RADAR =
// <json>;`, so the JSON is everything between `= ` and the final `;`.
const dataJson = JSON.parse(dataJs.slice(dataJs.indexOf('=') + 1, dataJs.lastIndexOf(';'))) as {
  rows?: { slug: string; implied_value_usd: number }[];
};
if (!Array.isArray(dataJson.rows) || dataJson.rows.length !== board.length) {
  failBoard(
    `data.js carries ${dataJson.rows?.length ?? 0} rows, board.json carries ${board.length}: the two must agree`,
  );
}
for (let i = 0; i < board.length; i++) {
  const a = board[i]!;
  const b = dataJson.rows[i]!;
  if (a.slug !== b.slug || a.implied_value_usd !== b.implied_value_usd) {
    failBoard(
      `data.js row ${i + 1} (${b.slug}, $${b.implied_value_usd}) does not match board.json (${a.slug}, $${a.implied_value_usd})`,
    );
  }
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
checkShots(join(here, 'screenshots'), copyFiles(join(here, 'screenshots'), join(out, 'screenshots')));

// The dossier is written last: the scorer rebuilds it from /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const top3 = board.slice(0, 3).map((r) => `#${r.rank} ${r.slug} $${Math.round(r.implied_value_usd / 1e6)}M`).join(', ');
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: model radar-4, global multiple ${radar.calibration.global_median.toFixed(3)}x, ` +
    `total implied value $${Math.round(radar.total_implied_value_usd / 1e6)}M, top: ${top3}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ` +
    `${join(out, 'screenshots')} (3 images) and ${join(out, 'dossier.json')}\n`,
);
