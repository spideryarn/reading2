/**
 * **Join the judge's verdicts to the key**, free:
 * `npx tsx evals/shelf-topic-clusters/tally.ts`. Prints, per contrast, who
 * won on each case and each arm's mean scores.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { OUT_DIR } from "./run.js";

interface Scores {
  meaningful: number;
  membership: number;
  coverage: number;
}
interface Verdict {
  pair: string;
  winner: "A" | "B" | "tie";
  A: Scores;
  B: Scores;
  why: string;
}

const key = JSON.parse(readFileSync(path.join(OUT_DIR, "pairs-key.json"), "utf8")) as Record<string, Record<string, { A: string; B: string }>>;
const wins = new Map<string, string[]>();
const scores = new Map<string, Scores[]>();

for (const [id, pairs] of Object.entries(key)) {
  const f = path.join(OUT_DIR, "judgements", `${id}.json`);
  if (!existsSync(f)) {
    console.log(`${id}: NO JUDGEMENT`);
    continue;
  }
  const { verdicts } = JSON.parse(readFileSync(f, "utf8")) as { verdicts: Verdict[] };
  for (const [pid, arms] of Object.entries(pairs)) {
    const v = verdicts.find((x) => x.pair === pid);
    if (!v) {
      console.log(`${id} ${pid}: MISSING`);
      continue;
    }
    const contrast = [arms.A, arms.B].sort().join(" vs ");
    const winner = v.winner === "tie" ? "tie" : arms[v.winner];
    wins.set(contrast, [...(wins.get(contrast) ?? []), `${id}: ${winner}`]);
    for (const side of ["A", "B"] as const) scores.set(arms[side], [...(scores.get(arms[side]) ?? []), v[side]]);
    console.log(`${id} ${arms.A} vs ${arms.B} → ${winner} — ${v.why}`);
  }
}

console.log();
for (const [contrast, rows] of wins) {
  const count = new Map<string, number>();
  for (const r of rows) {
    const w = r.split(": ")[1]!;
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  console.log(`${contrast}: ${[...count].map(([w, n]) => `${w} ${n}`).join(", ")}`);
}
console.log();
const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
for (const [arm, ss] of scores)
  console.log(`${arm}: meaningful ${mean(ss.map((s) => s.meaningful))}, membership ${mean(ss.map((s) => s.membership))}, coverage ${mean(ss.map((s) => s.coverage))} (n=${ss.length})`);
