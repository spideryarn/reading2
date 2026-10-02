/**
 * **Unblind the judge's Brief verdicts** — plan 261002h. Free.
 *
 *   npx tsx evals/simple/brief-plain-unblind.ts [verdicts-file]
 *
 * Joins `verdicts-*.txt` (one `n: Q1=X|Y|SAME; Q2=…; Q3=…` line per pair) with
 * `key.jsonl`, both under evals/results/simple/brief-plain-261002h/, and tallies
 * per set (test / control) and reader: Q1 and Q3 as new : old : same (control:
 * b1 : b2 : same), Q2 as faults charged to each arm (BOTH charges both).
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(import.meta.dirname, "..", "results", "simple", "brief-plain-261002h");
const file = process.argv[2] ?? path.join(DIR, "verdicts-opus.txt");
const key = new Map<number, { reader: string; set: string; X: string; Y: string }>();
for (const line of fs.readFileSync(path.join(DIR, "key.jsonl"), "utf8").split("\n").filter(Boolean)) {
  const k = JSON.parse(line) as { n: number; reader: string; set: string; X: string; Y: string };
  key.set(k.n, k);
}
type Tally = { a: number; b: number; same: number; faultsA: number; faultsB: number; shapeA: number; shapeB: number; shapeSame: number; n: number };
const tallies = new Map<string, Tally>();
const empty = (): Tally => ({ a: 0, b: 0, same: 0, faultsA: 0, faultsB: 0, shapeA: 0, shapeB: 0, shapeSame: 0, n: 0 });
let parsed = 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  const m = /^\s*(\d+)\s*:\s*Q1\s*=\s*(X|Y|SAME)\s*;\s*Q2\s*=\s*(NONE|X|Y|BOTH)\b.*?;\s*Q3\s*=\s*(X|Y|SAME)/i.exec(line);
  if (!m) continue;
  const k = key.get(Number(m[1]));
  if (!k) throw new Error(`no key for pair ${m[1]}`);
  parsed++;
  /* Side "a" is the new arm in a test pair, b1 in a control pair. */
  const aSide = k.set === "test" ? (k.X.startsWith("fb9pa") ? "X" : "Y") : k.X === "fb9pb1" ? "X" : "Y";
  for (const group of [`${k.set} all`, `${k.set} ${k.reader}`]) {
    const t = tallies.get(group) ?? empty();
    t.n++;
    const q1 = m[2]!.toUpperCase();
    if (q1 === "SAME") t.same++;
    else if (q1 === aSide) t.a++;
    else t.b++;
    const q2 = m[3]!.toUpperCase();
    if (q2 === "BOTH" || q2 === aSide) t.faultsA++;
    if (q2 === "BOTH" || (q2 !== "NONE" && q2 !== aSide)) t.faultsB++;
    const q3 = m[4]!.toUpperCase();
    if (q3 === "SAME") t.shapeSame++;
    else if (q3 === aSide) t.shapeA++;
    else t.shapeB++;
    tallies.set(group, t);
  }
}
console.log(`${parsed} verdicts parsed from ${path.relative(process.cwd(), file)}`);
console.log("group | n | Q1 plainer a:b:same | Q2 faults a / b | Q3 shape a:b:same   (test: a = new; control: a = b1)");
for (const [g, t] of [...tallies.entries()].sort()) {
  console.log(`${g} | ${t.n} | ${t.a}:${t.b}:${t.same} | ${t.faultsA} / ${t.faultsB} | ${t.shapeA}:${t.shapeB}:${t.shapeSame}`);
}
