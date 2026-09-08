/**
 * **Write a blind labelling sheet to a file, and refuse to overwrite one.**
 *
 *     npx tsx evals/debate/label-sheet-cli.ts --out <path> [--seed N] [--root DIR] <run> [<run> …]
 *
 * The instrument itself is `evals/debate/label-sheet.ts`; this is the thin entry
 * that reads the journals off disk and puts the Markdown somewhere.
 *
 * ## Why its own entry rather than a command on `run.ts`
 *
 * `evals/debate/run.ts` is the **paid** runner: it opens a spend ledger around
 * every command and its whole job is dispatching model calls. A labelling sheet
 * costs nothing, touches no network and reads only files that already exist, and
 * that property is worth being visible in the file list rather than asserted in
 * a docstring. Keeping it out of `run.ts` also means the sheet can never be
 * regenerated as a side effect of a sweep.
 *
 * ## The one refusal
 *
 * **A sheet that has been labelled must never be silently regenerated.** The
 * labels are keyed by row id, so a regenerated sheet with an extra row or a
 * different seed and the same filename would quietly re-pair somebody's answers
 * with the wrong stimulus. The write therefore uses the `wx` flag — the refusal
 * is the filesystem's, not a check that could race — and says what to do.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isMain } from "../../src/is-main.js";
import { readRunRows, RUN_ROOT } from "./journal-rows.js";
import { buildLabelSheet, DEFAULT_SEED, renderLabelSheet } from "./label-sheet.js";

interface Options {
  out: string | null;
  seed: number;
  root: string;
  runs: string[];
}

export function parseLabelSheetOptions(argv: readonly string[]): Options {
  const o: Options = { out: null, seed: DEFAULT_SEED, root: RUN_ROOT, runs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--out" || flag === "--seed" || flag === "--root") {
      if (value === undefined) throw new Error(`${flag} needs a value`);
      if (flag === "--out") o.out = value;
      else if (flag === "--root") o.root = value;
      else {
        const seed = Number(value);
        if (!Number.isFinite(seed)) throw new Error(`--seed must be a number, not "${value}"`);
        o.seed = seed;
      }
      i += 1;
      continue;
    }
    if (flag === undefined) continue;
    if (flag.startsWith("--")) throw new Error(`unknown flag "${flag}"`);
    o.runs.push(flag);
  }
  return o;
}

/**
 * Write the sheet, or refuse.
 *
 * `wx` rather than an `existsSync` first: the check and the write would be two
 * moments, and the whole point of the refusal is that the file on disk may
 * already carry somebody's labels.
 */
export async function writeSheetFile(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  try {
    await writeFile(file, text, { encoding: "utf-8", flag: "wx" });
  } catch (err: unknown) {
    if (err !== null && typeof err === "object" && (err as { code?: unknown }).code === "EEXIST") {
      throw new Error(
        `${file} already exists, and this command will not overwrite a sheet — it may already have been labelled. Choose another path, or move the old one aside deliberately.`,
      );
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const o = parseLabelSheetOptions(process.argv.slice(2));
  if (o.out === null) throw new Error("--out <path> is required");
  if (o.runs.length === 0) {
    throw new Error(
      `name at least one run directory under ${o.root} — the runs are listed rather than discovered, so a sheet says exactly what it was built from`,
    );
  }
  const reports = await Promise.all(o.runs.map((run) => readRunRows(run, o.root)));
  const sheet = buildLabelSheet(reports, { seed: o.seed, runs: o.runs });
  await writeSheetFile(o.out, renderLabelSheet(sheet));
  console.log(
    `Wrote ${o.out}: ${String(sheet.rows.length)} row(s) to label, ${String(sheet.notEvaluable.length)} not evaluable, of ${String(sheet.rowsReported)} reported; seed ${String(sheet.seed)}.`,
  );
  if (sheet.problems.length > 0) {
    console.log(
      `${String(sheet.problems.length)} problem(s) reported by the journals — they are in the sheet's header:`,
    );
    for (const problem of sheet.problems) console.log(`  - ${problem}`);
  }
}

if (isMain(import.meta.url)) {
  await main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
