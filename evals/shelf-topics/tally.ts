/**
 * **Join a blind judge's verdicts to their key, and count them properly.**
 * Free; no model call.
 *
 *     npx tsx evals/shelf-topics/tally.ts            # the first round: results/pairs-key.json + results/judgements/
 *     npx tsx evals/shelf-topics/tally.ts --full     # results/pairs-full-key.json + results/judgements-full/
 *     npx tsx evals/shelf-topics/tally.ts --key <file> --judgements <dir>
 *
 * A judgements directory holds one file per case,
 * `{"case": …, "judgements": [{"id", "winner": "A"|"B"|"tie", "scoreA", "scoreB", "reason"}]}`.
 *
 * What it prints:
 *
 * - **Per contrast, independent votes only.** A swapped duplicate is the same
 *   two lists again with the sides reversed. It is a side-bias check, not a
 *   second vote, and counting it (as the first write-up did) doubles that
 *   contrast's weight. The first round's key has no `independent` field, so a
 *   duplicate there is recognised by its `kind`.
 * - **The duplicates' agreement rate:** did the judge pick the same arm (or a
 *   tie both times) when the sides were swapped?
 * - **The controls:** baseline against itself should be a tie every time.
 *   Luna run 1 against run 2 mixes model variation with judge variation.
 * - **Mean score by arm**, over the independent contrast pairs it appears in,
 *   and the overall A/B split of decided contrasts as a side-bias check.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { RESULTS_DIR } from "./case.js";

type Winner = "A" | "B" | "tie";
interface Side {
  arm: string;
  run: number;
}
interface KeyEntry {
  case: string;
  kind: "contrast" | "same-arm-control" | "swapped-duplicate";
  A: Side;
  B: Side;
  independent?: boolean;
  duplicateOf?: string;
}
interface Judgement {
  id: string;
  winner: Winner;
  scoreA?: number;
  scoreB?: number;
}

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const full = argv.includes("--full");
const keyFile = flag("--key") ?? path.join(RESULTS_DIR, full ? "pairs-full-key.json" : "pairs-key.json");
const judgementsDir = flag("--judgements") ?? path.join(RESULTS_DIR, full ? "judgements-full" : "judgements");

if (!existsSync(keyFile) || !existsSync(judgementsDir)) {
  console.error(`Missing ${existsSync(keyFile) ? judgementsDir : keyFile}.`);
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, KeyEntry>;
const verdicts = new Map<string, Judgement>();
for (const f of readdirSync(judgementsDir).filter((x) => x.endsWith(".json")).sort()) {
  const file = JSON.parse(readFileSync(path.join(judgementsDir, f), "utf8")) as { judgements: Judgement[] };
  for (const j of file.judgements) {
    if (verdicts.has(j.id)) throw new Error(`${j.id} judged twice`);
    verdicts.set(j.id, j);
  }
}

const isIndependent = (k: KeyEntry) => k.independent ?? k.kind !== "swapped-duplicate";
/** The arm the judge preferred, or "tie". */
const pick = (k: KeyEntry, w: Winner) => (w === "tie" ? "tie" : w === "A" ? k.A.arm : k.B.arm);
/** One name per contrast whichever side each arm was on: baseline last, otherwise alphabetical. */
const contrastName = (k: KeyEntry): [string, string] => {
  const [x, y] = [k.A.arm, k.B.arm].sort((a, b) => (a === "baseline" ? 1 : b === "baseline" ? -1 : a < b ? -1 : 1));
  return [x as string, y as string];
};

const unjudged = Object.keys(key).filter((id) => !verdicts.has(id));
const unknown = [...verdicts.keys()].filter((id) => !key[id]);
console.log(`Key ${path.relative(process.cwd(), keyFile)}: ${Object.keys(key).length} pairs; judged ${verdicts.size}.`);
if (unjudged.length) console.log(`  NOT judged: ${unjudged.join(", ")}`);
if (unknown.length) console.log(`  Verdicts with no key entry (ignored): ${unknown.join(", ")}`);

/* ── Contrasts, independent votes only ── */
interface Tally {
  x: string;
  y: string;
  xWins: number;
  yWins: number;
  ties: number;
  byCase: string[];
}
const contrasts = new Map<string, Tally>();
const scores = new Map<string, number[]>();
let sideA = 0;
let sideB = 0;
for (const [id, k] of Object.entries(key)) {
  const v = verdicts.get(id);
  if (!v || k.kind !== "contrast" || !isIndependent(k)) continue;
  const [x, y] = contrastName(k);
  const t = contrasts.get(`${x}|${y}`) ?? { x, y, xWins: 0, yWins: 0, ties: 0, byCase: [] };
  const won = pick(k, v.winner);
  if (won === x) t.xWins += 1;
  else if (won === y) t.yWins += 1;
  else t.ties += 1;
  t.byCase.push(`${k.case}:${won === "tie" ? "tie" : won === x ? "x" : "y"}`);
  contrasts.set(`${x}|${y}`, t);
  if (v.winner === "A") sideA += 1;
  if (v.winner === "B") sideB += 1;
  for (const [side, s] of [
    [k.A, v.scoreA],
    [k.B, v.scoreB],
  ] as const) {
    if (typeof s !== "number") continue;
    const list = scores.get(side.arm) ?? [];
    list.push(s);
    scores.set(side.arm, list);
  }
}
console.log("\nContrasts (independent votes only; swapped duplicates excluded):");
for (const t of contrasts.values())
  console.log(
    `  ${`${t.x} vs ${t.y}`.padEnd(30)} ${t.x} ${t.xWins} – ${t.y} ${t.yWins} – ties ${t.ties}   (${t.byCase.join(", ")})`,
  );
console.log(`  Decided contrasts by side: A ${sideA}, B ${sideB}`);

/* ── Duplicates ── */
const originalOf = (id: string, k: KeyEntry): string | undefined =>
  k.duplicateOf ??
  Object.entries(key).find(
    ([oid, o]) =>
      oid !== id &&
      o.case === k.case &&
      o.kind === "contrast" &&
      o.A.arm === k.B.arm &&
      o.A.run === k.B.run &&
      o.B.arm === k.A.arm &&
      o.B.run === k.A.run,
  )?.[0];
let agree = 0;
let compared = 0;
const dupLines: string[] = [];
for (const [id, k] of Object.entries(key)) {
  if (isIndependent(k)) continue;
  const orig = originalOf(id, k);
  const v = verdicts.get(id);
  const o = orig ? verdicts.get(orig) : undefined;
  const ko = orig ? key[orig] : undefined;
  if (!v || !o || !ko) {
    dupLines.push(`  ${k.case} ${id}: original ${orig ?? "not found"} or a verdict missing`);
    continue;
  }
  compared += 1;
  const same = pick(k, v.winner) === pick(ko, o.winner);
  if (same) agree += 1;
  dupLines.push(`  ${k.case} ${id} (repeats ${orig}): ${pick(ko, o.winner)} then ${pick(k, v.winner)}${same ? "" : "  DISAGREE"}`);
}
console.log(`\nSwapped duplicates: the same arm (or a tie) chosen both times in ${agree} of ${compared}`);
for (const l of dupLines) console.log(l);

/* ── Controls ── */
console.log("\nSame-arm controls (A / B / tie):");
const controls = new Map<string, { A: number; B: number; tie: number }>();
for (const [id, k] of Object.entries(key)) {
  const v = verdicts.get(id);
  if (!v || k.kind !== "same-arm-control") continue;
  const c = controls.get(k.A.arm) ?? { A: 0, B: 0, tie: 0 };
  c[v.winner] += 1;
  controls.set(k.A.arm, c);
}
for (const [arm, c] of controls)
  console.log(
    `  ${arm.padEnd(12)} ${c.A} / ${c.B} / ${c.tie}${arm === "baseline" ? "   (identical lists: every one should be a tie)" : "   (run 1 vs run 2: model variation plus judge variation)"}`,
  );

/* ── Scores ── */
console.log("\nMean score (1–10) by arm, over the independent contrast pairs it appears in:");
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
for (const [arm, xs] of [...scores].sort((a, b) => mean(b[1]) - mean(a[1])))
  console.log(`  ${arm.padEnd(15)} ${mean(xs).toFixed(2)}  (n = ${xs.length})`);
