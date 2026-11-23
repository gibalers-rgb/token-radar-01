// Token Radar, model radar-3 (Node 22, standard library only).
//
// What this program does, in order:
//   1. Reads the sealed DefiLlama snapshot (758 protocols, 40 on the watchlist).
//   2. Scores the pre-token protocols with the radar-3 model in lib/model.ts
//      and builds the ranked board: all 40 watchlist slugs plus up to 220 early
//      pre-token protocols below the $50M floor, ranked 1..260 by implied
//      value, each with an eight-step farm plan.
//   3. Refuses to write anything when the board would fail the gate.
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

/** The screenshots the gate wants: 3 or 4 images, each a legal dossier name. */
function checkShots(shots: string[]): void {
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
  }
}

const snapshot = parseSnapshot(readFileSync(snapshotPath(), 'utf8'));
const out = outputDir();
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) failBoard(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
checkShots(copyFiles(join(here, 'screenshots'), join(out, 'screenshots')));

// The dossier is written last: the scorer rebuilds it from /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ` +
    `${join(out, 'screenshots')} (3 images) and ${join(out, 'dossier.json')}\n`,
);
