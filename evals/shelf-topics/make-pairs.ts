/**
 * **The judge's input** — plan 260929c § Reviews, R6. Free; reads the run
 * files and writes the pairs and their key apart:
 *
 *     npx tsx evals/shelf-topics/make-pairs.ts
 *
 * - `results/pairs/<case>.json` — what a fresh judge reads, one file per case:
 *   the reader's profile, the shelf (numbered titles and gists), and anonymous
 *   pairs of lists (A and B), each the first 12 topics with their member
 *   titles.
 * - `results/pairs-key.json` — which arm and run is on which side. The judge
 *   never sees it.
 *
 * Focused contrasts (the coordinator's second round, 2026-09-29), run 1 of
 * each arm:
 *
 * - every case: jev-floor vs baseline, luna-score vs baseline, jev-floor vs
 *   luna-score, luna-order vs luna-score;
 * - greg-like only: jev-score vs jev-floor, deepseek-score vs luna-score;
 * - controls, every case: luna-score run 1 vs run 2, baseline run 1 vs run 2
 *   (the same list twice — the judge should call it a tie), and one swapped
 *   duplicate (jev-floor vs luna-score shown again with its sides reversed).
 *
 * jev-floor was added after seeing the results (./case.ts `DERIVED_ARMS`).
 * Sides and pair order are shuffled with `crypto.randomInt` — a JS float LCG
 * once put one arm on the same side 94 times in 95 — and the key's side
 * counts per arm are printed before anyone judges.
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Arm, loadCases, RESULTS_DIR, type RunFile, type ShelfCase } from "./case.js";
import { shelfText, titleOf } from "./prompt.js";

const HEAD = 12;
const TITLES_PER_TOPIC = 5;
const PAIRS_DIR = path.join(RESULTS_DIR, "pairs");

type Side = { arm: Arm; run: number };
type Kind = "contrast" | "same-arm-control" | "swapped-duplicate";

const CONTRASTS: [Arm, Arm][] = [
  ["jev-floor", "baseline"],
  ["luna-score", "baseline"],
  ["jev-floor", "luna-score"],
  ["luna-order", "luna-score"],
];
const GREG_LIKE_CONTRASTS: [Arm, Arm][] = [
  ["jev-score", "jev-floor"],
  ["deepseek-score", "luna-score"],
];
const CONTROL_ARMS: Arm[] = ["luna-score", "baseline"];

interface Planned {
  kind: Kind;
  a: Side;
  b: Side;
}

function readRun(caseId: string, s: Side): RunFile | null {
  const f = path.join(RESULTS_DIR, caseId, `${s.arm}-${s.run}.json`);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, "utf8")) as RunFile;
  return r.error || !r.list.length ? null : r;
}

function render(c: ShelfCase, r: RunFile): string[] {
  const title = titleOf(c);
  return r.list.slice(0, HEAD).map((t, i) => {
    const shown = t.slugs.slice(0, TITLES_PER_TOPIC).map((s) => title(s).slice(0, 60));
    const more = t.slugs.length > TITLES_PER_TOPIC ? `; +${t.slugs.length - TITLES_PER_TOPIC} more` : "";
    return `${i + 1}. ${t.label} (${t.count}): ${shown.join("; ")}${more}`;
  });
}

function shuffle<T>(xs: T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const coin = (x: Side, y: Side): [Side, Side] => (randomInt(2) === 0 ? [x, y] : [y, x]);

function plan(caseId: string): Planned[] {
  const out: Planned[] = [];
  const contrasts = caseId === "greg-like" ? [...CONTRASTS, ...GREG_LIKE_CONTRASTS] : CONTRASTS;
  let duplicateOf: Planned | null = null;
  for (const [x, y] of contrasts) {
    const [a, b] = coin({ arm: x, run: 1 }, { arm: y, run: 1 });
    const p: Planned = { kind: "contrast", a, b };
    out.push(p);
    if (x === "jev-floor" && y === "luna-score") duplicateOf = p;
  }
  for (const arm of CONTROL_ARMS) {
    const [a, b] = coin({ arm, run: 1 }, { arm, run: 2 });
    out.push({ kind: "same-arm-control", a, b });
  }
  if (duplicateOf) out.push({ kind: "swapped-duplicate", a: duplicateOf.b, b: duplicateOf.a });
  return out;
}

rmSync(PAIRS_DIR, { recursive: true, force: true });
mkdirSync(PAIRS_DIR, { recursive: true });
/* The first round's single file, superseded by the per-case files. */
rmSync(path.join(RESULTS_DIR, "pairs.json"), { force: true });

const keyOut: Record<string, { case: string; kind: Kind; A: Side; B: Side }> = {};
const sides = new Map<string, { A: number; B: number }>();
let n = 0;
for (const c of loadCases()) {
  const pairs: { id: string; A: string[]; B: string[] }[] = [];
  const skipped: string[] = [];
  for (const p of shuffle(plan(c.id))) {
    const ra = readRun(c.id, p.a);
    const rb = readRun(c.id, p.b);
    if (!ra || !rb) {
      skipped.push(`${p.a.arm}-${p.a.run} vs ${p.b.arm}-${p.b.run}`);
      continue;
    }
    const id = `p${String(++n).padStart(3, "0")}`;
    pairs.push({ id, A: render(c, ra), B: render(c, rb) });
    keyOut[id] = { case: c.id, kind: p.kind, A: p.a, B: p.b };
    for (const [side, s] of [
      ["A", p.a],
      ["B", p.b],
    ] as const) {
      const k = sides.get(s.arm) ?? { A: 0, B: 0 };
      k[side] += 1;
      sides.set(s.arm, k);
    }
  }
  writeFileSync(
    path.join(PAIRS_DIR, `${c.id}.json`),
    `${JSON.stringify({ case: c.id, profile: c.profile ?? "(none written)", shelf: shelfText(c).split("\n"), pairs }, null, 1)}\n`,
  );
  console.log(`${c.id}: ${pairs.length} pairs${skipped.length ? ` (skipped, a side missing or errored: ${skipped.join("; ")})` : ""}`);
}

writeFileSync(path.join(RESULTS_DIR, "pairs-key.json"), `${JSON.stringify(keyOut, null, 1)}\n`);
console.log(`${n} pairs in all`);
console.log("Side balance per arm (A / B):");
for (const [arm, k] of [...sides].sort()) console.log(`  ${arm.padEnd(15)} ${k.A} / ${k.B}`);
