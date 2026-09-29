/**
 * **The judge's input** — plan 260929c § Reviews, R6. Free; reads the run
 * files and writes the pairs and their key apart:
 *
 *     npx tsx evals/shelf-topics/make-pairs.ts
 *
 * - `results/pairs/<case>.json` — what a fresh judge reads, one file per case:
 *   the reader's profile, the shelf (numbered titles and gists), and anonymous
 *   pairs of lists (A and B), each the first 12 topics with at most five member
 *   titles and a count of the rest. This falls short of plan R6's requirement
 *   to show every member title; changing it now also requires re-judging the
 *   regenerated pairs, rather than silently changing the judge's evidence.
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
 *   The Luna run pair mixes model run-to-run variation with judge variation;
 *   only the identical baseline pair isolates the judge/side check. A swapped
 *   duplicate is a side-bias check, not a second independent contrast vote.
 *
 * jev-floor was added after seeing the results (./case.ts `DERIVED_ARMS`).
 * Sides and pair order are shuffled with `crypto.randomInt` — a JS float LCG
 * once put one arm on the same side 94 times in 95 — and the key's side
 * counts per arm are printed before anyone judges.
 *
 * **`--full`** (added after GPT Sol's stage review, 2026-09-29) writes the
 * SAME contrasts with **every** member title of each of the first 12 topics,
 * as R6 asked. They go to `results/pairs-full/<case>.json` with their own key
 * in `results/pairs-full-key.json`, a fresh shuffle, and ids `f001`…, so their
 * verdicts can never be joined to the old key by mistake. In both modes the
 * key marks each pair `independent` or not: a swapped duplicate carries
 * `independent: false` and `duplicateOf` (the pair it repeats). It must not
 * be counted as a second vote, and evals/shelf-topics/tally.ts excludes it.
 *
 * The default mode reproduces the judged first-round files and **refuses to
 * overwrite** `results/pairs-key.json` once it exists, because the verdicts
 * in `results/judgements/` can only be read through that key.
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Arm, loadCases, RESULTS_DIR, type RunFile, type ShelfCase } from "./case.js";
import { shelfText, titleOf } from "./prompt.js";

const HEAD = 12;
const FULL = process.argv.includes("--full");
/** The judged first round showed five titles and "+N more"; `--full` shows all of them. */
const TITLES_PER_TOPIC = FULL ? Number.POSITIVE_INFINITY : 5;
const PAIRS_DIR = path.join(RESULTS_DIR, FULL ? "pairs-full" : "pairs");
const KEY_FILE = path.join(RESULTS_DIR, FULL ? "pairs-full-key.json" : "pairs-key.json");
const ID_PREFIX = FULL ? "f" : "p";

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
  /** A swapped duplicate's original, so the key can name it. */
  repeats?: Planned;
}

export interface KeyEntry {
  case: string;
  kind: Kind;
  A: Side;
  B: Side;
  /** False for a swapped duplicate: it is a side-bias check, not a second vote. */
  independent: boolean;
  /** The pair a swapped duplicate repeats with its sides reversed. */
  duplicateOf?: string;
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
    const shown = t.slugs.slice(0, TITLES_PER_TOPIC).map((s) => (FULL ? title(s) : title(s).slice(0, 60)));
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
  if (duplicateOf) out.push({ kind: "swapped-duplicate", a: duplicateOf.b, b: duplicateOf.a, repeats: duplicateOf });
  return out;
}

if (!FULL && existsSync(KEY_FILE) && !process.argv.includes("--overwrite")) {
  console.error(
    `${KEY_FILE} exists and results/judgements/ is read through it. Refusing to overwrite: pass --full for the full-membership pairs, or --overwrite if you mean it.`,
  );
  process.exit(1);
}
rmSync(PAIRS_DIR, { recursive: true, force: true });
mkdirSync(PAIRS_DIR, { recursive: true });

const keyOut: Record<string, KeyEntry> = {};
const sides = new Map<string, { A: number; B: number }>();
let n = 0;
for (const c of loadCases()) {
  const skipped: string[] = [];
  /* Ids first, so a duplicate can name its original wherever the shuffle put it. */
  const kept: { id: string; p: Planned; ra: RunFile; rb: RunFile }[] = [];
  for (const p of shuffle(plan(c.id))) {
    const ra = readRun(c.id, p.a);
    const rb = readRun(c.id, p.b);
    if (!ra || !rb) {
      skipped.push(`${p.a.arm}-${p.a.run} vs ${p.b.arm}-${p.b.run}`);
      continue;
    }
    kept.push({ id: `${ID_PREFIX}${String(++n).padStart(3, "0")}`, p, ra, rb });
  }
  const idOf = new Map(kept.map((k) => [k.p, k.id]));
  const pairs: { id: string; A: string[]; B: string[] }[] = [];
  for (const { id, p, ra, rb } of kept) {
    pairs.push({ id, A: render(c, ra), B: render(c, rb) });
    const original = p.repeats ? idOf.get(p.repeats) : undefined;
    keyOut[id] = {
      case: c.id,
      kind: p.kind,
      A: p.a,
      B: p.b,
      independent: p.kind !== "swapped-duplicate",
      ...(original ? { duplicateOf: original } : {}),
    };
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

writeFileSync(KEY_FILE,`${JSON.stringify(keyOut, null, 1)}\n`);
console.log(`${n} pairs in all`);
console.log("Side balance per arm (A / B):");
for (const [arm, k] of [...sides].sort()) console.log(`  ${arm.padEnd(15)} ${k.A} / ${k.B}`);
