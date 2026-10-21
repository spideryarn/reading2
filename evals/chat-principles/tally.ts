/**
 * **Unblind a judge's verdicts against the key** — plan
 * docs/plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md.
 *
 *     npx tsx evals/chat-principles/tally.ts reading-noline,reading-none [--except asks-what-seen]
 *
 * Reads `key-a-b.txt` (written by `run.ts --pairs`) and `verdicts-a-b.txt` (the
 * judge's lines, `n: X|Y|same; why: …; problem: …`) and prints wins per arm,
 * ties, and every problem line with its arm and case. Refuses a verdicts file
 * that does not answer every pair, so a judge that stopped early is not a tie.
 */
import fs from "node:fs";
import path from "node:path";

const RESULTS = path.join(import.meta.dirname, "results");

const [pair, ...rest] = process.argv.slice(2);
if (!pair?.includes(",")) throw new Error("usage: tally.ts a,b [--except case1,case2]");
const [a, b] = pair.split(",") as [string, string];
const exceptAt = rest.indexOf("--except");
const except = new Set(exceptAt >= 0 ? (rest[exceptAt + 1] ?? "").split(",") : []);

const key = new Map<number, { X: string; Y: string; case: string }>();
for (const line of fs.readFileSync(path.join(RESULTS, `key-${a}-${b}.txt`), "utf8").split("\n")) {
  const m = /^(\d+): X=(\S+) Y=(\S+) \((\S+) run \d+\)$/.exec(line.trim());
  if (m) key.set(Number(m[1]), { X: m[2] as string, Y: m[3] as string, case: m[4] as string });
}
const verdicts = new Map<number, { pick: string; problem: string }>();
for (const line of fs.readFileSync(path.join(RESULTS, `verdicts-${a}-${b}.txt`), "utf8").split("\n")) {
  const m = /^(\d+):\s*(X|Y|same)\b.*?problem:\s*(.*)$/i.exec(line.trim());
  if (m) verdicts.set(Number(m[1]), { pick: (m[2] as string).toUpperCase(), problem: (m[3] as string).trim() });
}
const missing = [...key.keys()].filter((n) => !verdicts.has(n));
if (missing.length > 0) throw new Error(`the judge did not answer pairs ${missing.join(", ")}`);

const wins: Record<string, number> = { [a]: 0, [b]: 0, same: 0 };
const problems: string[] = [];
for (const [n, k] of key) {
  if (except.has(k.case)) continue;
  const v = verdicts.get(n)!;
  const winner = v.pick === "SAME" ? "same" : v.pick === "X" ? k.X : k.Y;
  wins[winner] = (wins[winner] ?? 0) + 1;
  if (!/^none\b/i.test(v.problem)) {
    const named = v.problem.replace(/\bX\b/g, `[${k.X}]`).replace(/\bY\b/g, `[${k.Y}]`);
    problems.push(`${n} (${k.case}): ${named}`);
  }
}
console.log(`${a} ${wins[a]}, ${b} ${wins[b]}, same ${wins.same}${except.size ? ` (except ${[...except].join(", ")})` : ""}`);
for (const p of problems) console.log(`  problem ${p}`);
