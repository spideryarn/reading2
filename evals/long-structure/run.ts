/**
 * The long-structure eval: four ways of getting a long document's table of
 * contents, run cold, scored, and judged blind. Plan 261005j § Stage 2.
 *
 *   npx tsx evals/long-structure/run.ts all --cap-usd 40 --runs 2
 *   npx tsx evals/long-structure/run.ts cells --cap-usd 6 --docs paper --arms one,B,C --runs 1 --name smoke
 *   npx tsx evals/long-structure/run.ts spoiled --cap-usd 6 --doc paper --name smoke
 *   npx tsx evals/long-structure/run.ts judge --cap-usd 40
 *   npx tsx evals/long-structure/run.ts report --name smoke
 *
 * `all` is cells, then the spoiled-tree check, then the judging with the judges
 * that passed it, then the report.
 *
 * Flags: `--docs a,b` (default: the seven in corpus.ts), `--arms one,A,B,C`,
 * `--runs N` (default 2), `--cap-usd N` (required for anything paid),
 * `--name <run>` (default `matrix`; results go under
 * evals/results/long-structure-2026-10-05/<run>/), `--judges opus,sol`,
 * `--doc <name>` and `--from <arm>` for `spoiled`, `--min-room N` (refuse to
 * start with less than this left on the key; default 15).
 *
 * **The cap is enforced from the ledger**: `<run>/ledger.jsonl` has one line
 * per network attempt with the provider's own cost, its total is read back
 * when a run starts, and a call is admitted only if the total, what is in
 * flight and that call's estimate fit under the cap. When they do not, the
 * run stops and the unfinished cell is not written.
 *
 * **It resumes.** A cell (document, arm, run) is one file under `<run>/cells/`,
 * written when the cell finishes, success or recorded failure. A cell with a
 * file is never bought again; a crashed or capped run picks up at the first
 * cell without one. Judgements are files the same way.
 *
 * Reads the local database only. Writes no row anywhere. Results hold ids,
 * titles and gists, never block prose.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";
import { isMain } from "../../src/is-main.js";
import { modelFor } from "../../src/models.js";
import { EXPAND_PROMPT_VERSION } from "../../src/structure-expand.js";
import { PROMPT_VERSION } from "../../src/structure-prompt.js";
import { ROOT_PROMPT_VERSION } from "../../src/structure-slices.js";
import { type Arm, type ArmResult, ARMS, finishTree, RUN_ARM } from "./arms.js";
import { CapReached, contextTokensOf, Ledger, POWER } from "./calls.js";
import { DEFAULT_DOCS, describeDoc, type DocDescription, loadDoc } from "./corpus.js";
import { DEFAULT_JUDGES, type Judgement, judgePair, named, type SpoiledCheck, spoiledCheck } from "./judge.js";
import { keyRoom } from "./key-room.js";
import { GISTS_PROMPT_VERSION, SECTIONS_PROMPT_VERSION, TOP_PROMPT_VERSION } from "./prompts.js";
import { scoreTree, topStability, type TreeScore } from "./score.js";
import { judgeById } from "../dig-deeper/judges.js";

export const RESULTS = path.resolve("evals/results/long-structure-2026-10-05");

export const PROMPT_VERSIONS = {
  wholeDocument: PROMPT_VERSION,
  slicesRoot: ROOT_PROMPT_VERSION,
  expansion: EXPAND_PROMPT_VERSION,
  top: TOP_PROMPT_VERSION,
  sections: SECTIONS_PROMPT_VERSION,
  sectionGists: GISTS_PROMPT_VERSION,
};

export interface Options {
  /** The run's directory: every file of the run is under it. */
  dir: string;
  docs: string[];
  arms: Arm[];
  runs: number;
  capUsd: number;
  fake: boolean;
  contextTokens: number;
  judges: string[];
  say: (line: string) => void;
}

export interface Cell {
  cell: string;
  at: string;
  fake: boolean;
  doc: DocDescription;
  arm: Arm;
  run: number;
  promptVersions: typeof PROMPT_VERSIONS;
  result: ArmResult;
  score: TreeScore | null;
}

const cellName = (doc: string, arm: Arm, run: number): string => `${doc}.${arm}.run${run}`;
const cellFile = (dir: string, name: string): string => path.join(dir, "cells", `${name}.json`);
const save = (file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value)}\n`);
};
const load = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

export const ledgerOf = (o: Pick<Options, "dir" | "capUsd" | "fake">): Ledger => new Ledger(path.join(o.dir, "ledger.jsonl"), o.capUsd, o.fake);

/**
 * Run every cell that has no file yet. Runs go one after another, and within
 * a run the arms take turns across documents (the order rotates by one per
 * document and per run), so a slow hour is not one arm's. One cell at a time:
 * each arm already runs its own calls eight wide, and two cells at once would
 * put one arm's timing inside another's.
 */
export async function runCells(o: Options, ledger: Ledger = ledgerOf(o)): Promise<{ ran: number; skipped: number; capped: boolean }> {
  let ran = 0;
  let skipped = 0;
  for (let run = 1; run <= o.runs; run++) {
    for (const [d, docName] of o.docs.entries()) {
      const arms = o.arms.map((_a, i) => o.arms[(i + d + run) % o.arms.length]!);
      for (const arm of arms) {
        const name = cellName(docName, arm, run);
        if (existsSync(cellFile(o.dir, name))) {
          skipped += 1;
          continue;
        }
        const doc = await loadDoc(docName);
        o.say(`${name}: starting ($${ledger.total().toFixed(4)} of $${o.capUsd.toFixed(2)} spent)`);
        let result: ArmResult;
        try {
          result = await RUN_ARM[arm]({ doc, cell: name, ledger, contextTokens: o.contextTokens });
        } catch (err) {
          if (!(err instanceof CapReached)) throw err;
          o.say(`${name}: STOPPED, not written. ${err.message}`);
          return { ran, skipped, capped: true };
        }
        const score = result.proposal ? scoreProposal(doc, result) : null;
        const cell: Cell = { cell: name, at: new Date().toISOString(), fake: o.fake, doc: describeDoc(doc), arm, run, promptVersions: PROMPT_VERSIONS, result, score };
        save(cellFile(o.dir, name), cell);
        ran += 1;
        o.say(`${name}: ${line(cell)}`);
      }
    }
  }
  return { ran, skipped, capped: false };
}

function scoreProposal(doc: Awaited<ReturnType<typeof loadDoc>>, result: ArmResult): TreeScore | null {
  try {
    return scoreTree(doc.blocks, doc.body, finishTree(doc, result.proposal!).tree);
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- the report -- */

const secs = (ms: number | null): string => (ms === null ? "-" : `${(ms / 1000).toFixed(1)}s`);

export function failuresOf(result: ArmResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of result.calls) if (c.outcome !== "ok") out[c.outcome] = (out[c.outcome] ?? 0) + 1;
  /* Arm A's calls are made inside `runSlices`, which reports counts and one
     reason, not a reason per call: an answer that did not pass and was asked
     again, and the one failure that ended the path. */
  if (typeof result.detail.reasked === "number" && result.detail.reasked > 0) out["answer-did-not-pass"] = result.detail.reasked;
  if (result.failure?.startsWith("slices:")) out[result.failure] = 1;
  return out;
}

export const reasksOf = (result: ArmResult): number =>
  result.calls.filter((c) => c.attempt > 1).length + (typeof result.detail.reasked === "number" ? result.detail.reasked : 0);

export const usdOf = (result: ArmResult): number => result.calls.reduce((a, c) => a + c.usd, 0);

function line(cell: Cell): string {
  const r = cell.result;
  const failures = Object.entries(failuresOf(r)).map(([k, v]) => `${k}:${v}`).join(" ") || "none";
  return [
    r.status + (r.failure ? `(${r.failure})` : ""),
    `top ${secs(r.topMs)}`,
    ...(cell.arm === "C" ? [`titles ${secs(r.titlesMs)}`] : []),
    `tree ${secs(r.treeMs)}`,
    `calls ${r.calls.length}`,
    `failed calls ${failures}`,
    `re-asks ${reasksOf(r)}`,
    `$${usdOf(r).toFixed(4)}`,
    `checkTree ${cell.score?.checkTreeProblems ?? r.checkTreeProblems.length}`,
    cell.score ? `parts ${cell.score.parts} sections ${cell.score.sections} over-batch ${cell.score.childlessOverBatch} headings ${cell.score.headingsStartingANode}/${cell.score.headingBlocks} seams-on-headings ${cell.score.seamsOnHeadings}/${cell.score.topLevelSeams}` : "no tree",
  ].join(" | ");
}

export function readCells(dir: string): Cell[] {
  const cells = path.join(dir, "cells");
  if (!existsSync(cells)) return [];
  return readdirSync(cells).filter((f) => f.endsWith(".json")).sort().map((f) => load<Cell>(path.join(cells, f)));
}

export function report(o: Pick<Options, "dir" | "say" | "capUsd" | "fake">): void {
  const cells = readCells(o.dir);
  for (const cell of cells) o.say(`${cell.cell.padEnd(28)} ${line(cell)}`);
  /* Repeat stability: run 1's top-level starts against run 2's, per document and arm. */
  for (const a of cells.filter((c) => c.run === 1 && c.score)) {
    const b = cells.find((c) => c.doc.name === a.doc.name && c.arm === a.arm && c.run === 2 && c.score);
    if (!b) continue;
    const s = topStability(a.score!.topStarts, b.score!.topStarts);
    o.say(`${a.doc.name}.${a.arm}: top-level starts shared by runs 1 and 2: ${s.shared} of ${s.either} (${s.jaccard.toFixed(2)})`);
  }
  const judging = path.join(o.dir, "judge");
  if (existsSync(judging)) {
    for (const f of readdirSync(judging).filter((x) => x.startsWith("spoiled.")).sort()) {
      for (const check of load<SpoiledCheck[]>(path.join(judging, f))) {
        o.say(`${f}: judge ${check.judge} ${check.usable ? "USABLE" : "NOT USABLE"}: ${check.rows.map((r) => `${r.spoil} -> ${r.passed ? "preferred the good tree" : `picked ${r.picked}`}`).join("; ")}`);
      }
    }
    for (const f of readdirSync(judging).filter((x) => x.startsWith("pair.")).sort()) {
      const j = load<Judgement>(path.join(judging, f));
      const v = j.verdict;
      o.say(`${f}: ${v ? `top ${named(v.topLevel.better, j.x, j.y)}, gists ${named(v.gists.better, j.x, j.y)}, overall ${named(v.overall.better, j.x, j.y)}, welded ${v.weldedParts.length}, invented ${v.inventedClaims.length}` : `no verdict (${j.failure})`}`);
    }
  }
  const ledger = ledgerOf({ dir: o.dir, capUsd: o.capUsd, fake: o.fake });
  o.say(`ledger: ${ledger.lines} network attempts, $${ledger.total().toFixed(4)}${o.fake ? " (fake money)" : ""}`);
}

/* ------------------------------------------------------------- judging -- */

const spoiledFile = (dir: string, doc: string): string => path.join(dir, "judge", `spoiled.${doc}.json`);

/** The spoiled-tree check on one finished cell's tree. Written once per document; never bought twice. */
export async function runSpoiled(o: Options, docName: string, from: Arm | undefined, ledger: Ledger = ledgerOf(o)): Promise<SpoiledCheck[]> {
  const file = spoiledFile(o.dir, docName);
  /* A judge whose check finished is never asked again; one left with a missing verdict is. */
  const kept = existsSync(file) ? load<SpoiledCheck[]>(file).filter((c) => c.rows.every((r) => r.failure === null)) : [];
  const todo = o.judges.filter((id) => !kept.some((c) => c.judge === id));
  if (todo.length === 0) return kept;
  const good = readCells(o.dir).find((c) => c.doc.name === docName && c.result.status === "ok" && (from === undefined || c.arm === from));
  if (!good) throw new Error(`no finished cell for ${docName}${from ? ` by arm ${from}` : ""} to spoil`);
  const doc = await loadDoc(docName);
  const seed = createHash("sha256").update(`spoiled ${docName}`).digest().readUInt32LE(0);
  const checks = await spoiledCheck({ doc, good: { name: `good:${good.arm}`, proposal: good.result.proposal! }, judges: todo, ledger, seed, cell: `spoiled.${docName}` });
  save(file, [...kept, ...checks]);
  for (const c of checks) o.say(`spoiled check, judge ${c.judge}: ${c.usable ? "USABLE" : c.inconclusive ? "INCONCLUSIVE, not used" : "NOT USABLE"} (${c.rows.map((r) => `${r.spoil}: ${r.passed ? "ok" : `picked ${r.picked}`}`).join(", ")})`);
  return [...kept, ...checks];
}

/**
 * Every arm against today's output for the same document and run (`one` where
 * it fits, else `A`), and C against B, by each judge that passed the spoiled
 * check. Which tree sits in X is a hash of the pair, so it is fixed across
 * resumes and balanced across pairs; the report prints the balance.
 */
export async function runJudging(o: Options, usable: readonly string[], ledger: Ledger = ledgerOf(o)): Promise<{ judged: number; capped: boolean }> {
  const cells = readCells(o.dir).filter((c) => c.result.status === "ok" && c.result.proposal);
  let judged = 0;
  let xFirstCount = 0;
  let pairs = 0;
  for (const docName of o.docs) {
    for (let run = 1; run <= o.runs; run++) {
      const of = (arm: Arm): Cell | undefined => cells.find((c) => c.doc.name === docName && c.run === run && c.arm === arm);
      const today = of("one") ?? of("A");
      const wanted: [Cell | undefined, Cell | undefined][] = [[of("B"), today], [of("C"), today], [of("C"), of("B")]];
      for (const [a, b] of wanted) {
        if (!a || !b || a.arm === b.arm) continue;
        const seed = createHash("sha256").update(`${docName} ${a.arm} ${b.arm} ${run}`).digest().readUInt32LE(0);
        const xFirst = seed % 2 === 0;
        pairs += 1;
        if (xFirst) xFirstCount += 1;
        for (const id of usable) {
          const file = path.join(o.dir, "judge", `pair.${docName}.${a.arm}-vs-${b.arm}.run${run}.${id}.json`);
          if (existsSync(file)) continue;
          const doc = await loadDoc(docName);
          try {
            const j = await judgePair({
              doc,
              a: { name: a.arm, proposal: a.result.proposal! },
              b: { name: b.arm, proposal: b.result.proposal! },
              xFirst,
              seed,
              judge: judgeById(id),
              ledger,
              cell: `pair.${docName}.${a.arm}-vs-${b.arm}.run${run}`,
            });
            /* A judgement with no verdict is not kept: the next run asks again. */
            if (j.verdict) save(file, j);
            else o.say(`${path.basename(file)}: no verdict (${j.failure}); not written`);
            judged += 1;
          } catch (err) {
            if (!(err instanceof CapReached)) throw err;
            o.say(`judging STOPPED. ${err.message}`);
            return { judged, capped: true };
          }
        }
      }
    }
  }
  o.say(`judging: ${pairs} pairs, the first-named arm sat in X for ${xFirstCount} of them`);
  return { judged, capped: false };
}

/* ----------------------------------------------------------------- CLI -- */

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const known = new Set(["--docs", "--arms", "--runs", "--cap-usd", "--name", "--judges", "--doc", "--from", "--min-room"]);
  for (const a of args.filter((x) => x.startsWith("--"))) if (!known.has(a)) throw new Error(`unknown flag ${a}`);
  if (!command || !["all", "cells", "spoiled", "judge", "report"].includes(command)) {
    throw new Error("usage: run.ts all|cells|spoiled|judge|report [--docs a,b] [--arms one,A,B,C] [--runs N] --cap-usd N [--name run]");
  }
  const arms = (value("--arms")?.split(",") ?? [...ARMS]) as Arm[];
  for (const a of arms) if (!ARMS.includes(a)) throw new Error(`no arm "${a}"; known: ${ARMS.join(", ")}`);
  const dir = path.join(RESULTS, value("--name") ?? "matrix");
  const say = (text: string): void => console.log(text);
  if (command === "report") {
    report({ dir, say, capUsd: Infinity, fake: false });
    return;
  }
  const capUsd = Number(value("--cap-usd"));
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error("--cap-usd N is required: the most this run's ledger may reach, in dollars");
  loadEnvLocal();
  const room = await keyRoom();
  const minRoom = Number(value("--min-room") ?? 15);
  say(`key: $${room.limitRemaining?.toFixed(2) ?? "?"} left of $${room.limit ?? "?"}`);
  if (room.limitRemaining !== null && room.limitRemaining < minRoom) throw new Error(`The key has $${room.limitRemaining.toFixed(2)} left, under the $${minRoom} floor. Stopping before any call.`);
  const model = modelFor("structure", POWER);
  const o: Options = {
    dir,
    docs: value("--docs")?.split(",") ?? DEFAULT_DOCS,
    arms,
    runs: Number(value("--runs") ?? 2),
    capUsd,
    fake: false,
    contextTokens: await contextTokensOf(model),
    judges: value("--judges")?.split(",") ?? [...DEFAULT_JUDGES],
    say,
  };
  say(`model ${model}, context ${o.contextTokens} tokens; results in ${dir}`);
  const ledger = ledgerOf(o);
  let capped = false;
  if (command === "cells" || command === "all") capped = (await runCells(o, ledger)).capped;
  let usable: string[] = o.judges;
  if (!capped && (command === "spoiled" || command === "all" || command === "judge")) {
    const docName = value("--doc") ?? readCells(dir).find((c) => c.result.status === "ok")?.doc.name;
    if (!docName) throw new Error("no finished cell to make spoiled trees from");
    try {
      const checks = await runSpoiled(o, docName, value("--from") as Arm | undefined, ledger);
      usable = checks.filter((c) => c.usable).map((c) => c.judge);
    } catch (err) {
      if (!(err instanceof CapReached)) throw err;
      say(`spoiled check STOPPED. ${err.message}`);
      capped = true;
    }
  }
  if (!capped && (command === "judge" || command === "all")) {
    if (usable.length === 0) say("no judge passed the spoiled-tree check; nothing is judged");
    else capped = (await runJudging(o, usable, ledger)).capped;
  }
  report({ dir, say, capUsd, fake: false });
  if (capped) process.exitCode = 2;
}

if (isMain(import.meta.url)) {
  await main();
  process.exit(process.exitCode ?? 0);
}
