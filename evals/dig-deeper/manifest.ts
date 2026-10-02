/**
 * **The expected matrix, written before anything is bought, and the cells
 * that fill it** — plan 261001s § Output and integrity, Sol F8.
 *
 * A *slot* is a cell's identity: (example, arm, run) for an answer;
 * (example, run, judge, batch, pass) for a judgement. A cell's *key* is a hash
 * of everything that makes it what it is — the full outgoing request, the
 * frozen evidence's hash, the arm, the judge prompt and validator, and the hash of
 * the eval source that builds and accepts it — so a resume never reuses a cell
 * made under an older prompt or input. An answer's key is known before it is
 * bought; a judgement's includes the answers it judges, so it is computed when
 * those exist.
 *
 * `completedAt` is set only when every expected slot has a cell whose key is
 * current. A report without it says which cells are missing.
 *
 * Batches (plan § Judging, Sol F5): for each (example, run, judge, pass) the
 * non-anchor arms are split by a seeded shuffle into batches of three or
 * four, the anchor is added to each, and each batch gets fresh letters in a
 * fresh order. All of it is decided here, from a seed, before any spend.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const RUNS_DIR = path.join(import.meta.dirname, "..", "..", "output", "dig-deeper-runs");

export function runDir(run: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(run)) throw new Error(`--run must be a plain name, got "${run}"`);
  return path.join(RUNS_DIR, run);
}

export const hashOf = (value: unknown): string =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value), "utf8").digest("hex");

/** sha256 of the eval and imported production files that make a cell what it is. */
export function sourceHash(files: readonly string[]): string {
  return hashOf(files.map((f) => [f, fs.readFileSync(path.join(import.meta.dirname, f), "utf8")]));
}

/* ------------------------------------------------------------ the RNG -- */

/** A seeded generator in [0, 1): mulberry32 over the first 32 bits of the seed's hash. */
export function seeded(seed: string): () => number {
  let a = Number.parseInt(hashOf(seed).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Letters a judge sees; I and O left out so nobody reads them as digits. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

/* ----------------------------------------------------------- the slots -- */

export interface AnswerSlot {
  slot: string;
  example: string;
  arm: string;
  run: number;
}

export interface JudgeSlot {
  slot: string;
  example: string;
  run: number;
  judge: string;
  pass: "main" | "rejudge" | "finalists";
  batch: number;
  /** Arm ids in display order, the anchor among them. */
  order: string[];
  /** One letter per position, `order[i]` shown as `labels[i]`. */
  labels: string[];
}

export interface Selection {
  examples: string[];
  arms: string[];
  /** Answer generations bought per arm and example. */
  runs: number;
  /** The first N answer runs judged. Kept separate so cost draws need not all buy judging. */
  judgeRuns: number;
  judges: string[];
  /** Judge stability: re-judge run 1 of every example with a fresh shuffle. */
  rejudge: boolean;
}

export interface Manifest {
  run: string;
  createdAt: string;
  commit: string;
  selection: Selection;
  /** Which run's captures this run answers from, and each capture's sha256. */
  captures: { from: string; sha256: Record<string, string> };
  answers: AnswerSlot[];
  judgements: JudgeSlot[];
  /** A deliberate reduction from `expectedSlots(selection)`, made before the
   * retained cells were bought. The report verifies that this list explains
   * every omitted judgement; editing the matrix alone cannot look complete. */
  trimmed?: { at: string; why: string; dropped: string[] };
  /** The production-shaped finalist run, added by `finalists` before it spends. */
  finalists?: { arms: string[]; answers: AnswerSlot[]; judgements: JudgeSlot[] };
  completedAt?: string;
}

export const answerSlotId = (example: string, arm: string, run: number, pass = "main") =>
  `${pass === "main" ? "ans" : pass}:${example}:${arm}:${run}`;

/**
 * Split the non-anchor arms into batches of three or four and add the anchor
 * to each; letters and order fresh per batch. Deterministic in `seed`.
 */
export function planBatches(
  arms: readonly string[],
  anchor: string,
  seed: string,
): { order: string[]; labels: string[] }[] {
  const others = arms.filter((a) => a !== anchor);
  if (!arms.includes(anchor)) throw new Error(`the anchor arm ${anchor} is not in the selection`);
  const rand = seeded(seed);
  if (others.length === 0) return [{ order: [anchor], labels: [shuffle(LETTERS, rand)[0] as string] }];
  const count = Math.max(1, Math.ceil(others.length / 4));
  const shuffled = shuffle(others, rand);
  const batches: string[][] = Array.from({ length: count }, () => []);
  shuffled.forEach((a, i) => {
    batches[i % count]?.push(a);
  });
  return batches.map((members) => {
    const order = shuffle([anchor, ...members], rand);
    const labels = shuffle(LETTERS, rand).slice(0, order.length);
    return { order, labels };
  });
}

export function judgeSlots(
  example: string,
  run: number,
  judge: string,
  pass: JudgeSlot["pass"],
  arms: readonly string[],
  anchor: string,
  seedBase: string,
): JudgeSlot[] {
  return planBatches(arms, anchor, `${seedBase}|${example}|${run}|${judge}|${pass}`).map((b, i) => ({
    slot: `jdg:${pass}:${example}:${run}:${judge}:${i}`,
    example,
    run,
    judge,
    pass,
    batch: i,
    ...b,
  }));
}

/** Every slot of a selection. */
export function expectedSlots(sel: Selection, anchor: string, seedBase: string): Pick<Manifest, "answers" | "judgements"> {
  const answers: AnswerSlot[] = [];
  const judgements: JudgeSlot[] = [];
  for (const example of sel.examples) {
    for (let run = 1; run <= sel.runs; run++) {
      for (const arm of sel.arms) answers.push({ slot: answerSlotId(example, arm, run), example, arm, run });
      if (run <= (sel.judgeRuns ?? sel.runs)) {
        for (const judge of sel.judges) judgements.push(...judgeSlots(example, run, judge, "main", sel.arms, anchor, seedBase));
      }
    }
    if (sel.rejudge) {
      for (const judge of sel.judges) judgements.push(...judgeSlots(example, 1, judge, "rejudge", sel.arms, anchor, seedBase));
    }
  }
  return { answers, judgements };
}

const duplicateValues = (xs: readonly string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

function answerIntegrityIssues(actual: readonly AnswerSlot[], planned: readonly AnswerSlot[]): string[] {
  const issues = duplicateValues(actual.map((s) => s.slot)).map((slot) => `duplicate answer ${slot}`);
  const expectedBySlot = new Map(planned.map((s) => [s.slot, s]));
  const actualBySlot = new Map(actual.map((s) => [s.slot, s]));
  for (const [slot, expected] of expectedBySlot) {
    const found = actualBySlot.get(slot);
    if (!found) issues.push(`missing answer ${slot}`);
    else if (hashOf(found) !== hashOf(expected)) issues.push(`changed answer slot ${slot}`);
  }
  for (const slot of actualBySlot.keys()) if (!expectedBySlot.has(slot)) issues.push(`unexpected answer ${slot}`);
  return issues;
}

function judgementSlotIssues(actual: readonly JudgeSlot[], planned: readonly JudgeSlot[], dropped: readonly string[], anchor: string): string[] {
  const issues = duplicateValues(actual.map((s) => s.slot)).map((slot) => `duplicate judgement ${slot}`);
  issues.push(...duplicateValues(dropped).map((slot) => `duplicate trimmed judgement ${slot}`));
  const expectedBySlot = new Map(planned.map((s) => [s.slot, s]));
  const actualBySlot = new Map(actual.map((s) => [s.slot, s]));
  const droppedSet = new Set(dropped);
  for (const [slot, found] of actualBySlot) {
    if (!expectedBySlot.has(slot)) issues.push(`unexpected judgement ${slot}`);
    if (found.order.length !== found.labels.length || new Set(found.order).size !== found.order.length || new Set(found.labels).size !== found.labels.length || !found.order.includes(anchor)) {
      issues.push(`invalid judgement batch ${slot}`);
    }
    if (droppedSet.has(slot)) issues.push(`judgement both retained and trimmed ${slot}`);
  }
  for (const slot of droppedSet) if (!expectedBySlot.has(slot)) issues.push(`unknown trimmed judgement ${slot}`);
  for (const slot of expectedBySlot.keys()) if (!actualBySlot.has(slot) && !droppedSet.has(slot)) issues.push(`undeclared missing judgement ${slot}`);
  return issues;
}

function judgementGroupIssues(actual: readonly JudgeSlot[], planned: readonly JudgeSlot[], arms: readonly string[], anchor: string): string[] {
  const group = (s: JudgeSlot) => `${s.pass}|${s.example}|${s.run}|${s.judge}`;
  const plannedGroups = new Map<string, JudgeSlot[]>();
  const actualGroups = new Map<string, JudgeSlot[]>();
  for (const s of planned) plannedGroups.set(group(s), [...(plannedGroups.get(group(s)) ?? []), s]);
  for (const s of actual) actualGroups.set(group(s), [...(actualGroups.get(group(s)) ?? []), s]);
  const wanted = arms.filter((arm) => arm !== anchor).sort().join("\0");
  const issues: string[] = [];
  for (const [key, expected] of plannedGroups) {
    const found = actualGroups.get(key) ?? [];
    if (found.length > 0 && found.length !== expected.length) issues.push(`partly retained judgement group ${key}`);
    if (found.length === expected.length) {
      const members = found.flatMap((s) => s.order.filter((arm) => arm !== anchor)).sort().join("\0");
      if (members !== wanted) issues.push(`incomplete arm coverage in judgement group ${key}`);
    }
  }
  return issues;
}

/**
 * Check the manifest against the matrix its selection declares. Judgements
 * may be omitted only when every omitted slot is named in `trimmed.dropped`;
 * answers are never trimmable. This keeps "complete" meaningful after a
 * deliberate mid-run budget cut.
 */
export function manifestIntegrityIssues(m: Manifest, anchor: string, seedBase: string): string[] {
  const planned = expectedSlots(m.selection, anchor, seedBase);
  const dropped = m.trimmed?.dropped ?? [];
  return [
    ...answerIntegrityIssues(m.answers, planned.answers),
    ...judgementSlotIssues(m.judgements, planned.judgements, dropped, anchor),
    ...judgementGroupIssues(m.judgements, planned.judgements, m.selection.arms, anchor),
  ];
}

/* ----------------------------------------------------------- the files -- */

export const manifestPath = (run: string) => path.join(runDir(run), "manifest.json");

export function readManifest(run: string): Manifest | null {
  const p = manifestPath(run);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as Manifest) : null;
}

export function writeManifest(m: Manifest): void {
  fs.mkdirSync(runDir(m.run), { recursive: true });
  const p = manifestPath(m.run);
  fs.writeFileSync(`${p}.tmp`, `${JSON.stringify(m, null, 2)}\n`);
  fs.renameSync(`${p}.tmp`, p);
}

const cellFile = (run: string, slot: string) => path.join(runDir(run), "cells", `${slot.replaceAll(":", "__")}.json`);

export interface CellBase {
  slot: string;
  key: string;
  at: string;
  commit: string;
}

export function readCell<T extends CellBase>(run: string, slot: string): T | null {
  const p = cellFile(run, slot);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as T) : null;
}

/** A cell whose key is current, or null — a stale one is moved aside rather than reused. */
export function currentCell<T extends CellBase>(run: string, slot: string, key: string): T | null {
  const cell = readCell<T>(run, slot);
  if (!cell) return null;
  if (cell.key === key) return cell;
  const stale = path.join(runDir(run), "cells", "stale");
  fs.mkdirSync(stale, { recursive: true });
  fs.renameSync(cellFile(run, slot), path.join(stale, `${path.basename(cellFile(run, slot), ".json")}.${cell.key.slice(0, 8)}.json`));
  return null;
}

export function writeCell(run: string, cell: CellBase): void {
  const p = cellFile(run, cell.slot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, `${JSON.stringify(cell, null, 2)}\n`);
  fs.renameSync(`${p}.tmp`, p);
}

/**
 * **Is the matrix complete?** Every expected slot has a cell, and every cell's
 * key is the one the current inputs give. `keyOf` returns null for a slot whose
 * key cannot be computed yet (a judgement whose answers are missing).
 */
export function completeness(
  run: string,
  slots: readonly { slot: string }[],
  keyOf: (slot: string) => string | null,
): { missing: string[]; stale: string[] } {
  const missing: string[] = [];
  const stale: string[] = [];
  for (const { slot } of slots) {
    const cell = readCell(run, slot);
    if (!cell) {
      missing.push(slot);
      continue;
    }
    const key = keyOf(slot);
    if (key === null || cell.key !== key) stale.push(slot);
  }
  return { missing, stale };
}
