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
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RESULTS = path.join(import.meta.dirname, "results");

const [pair, ...rest] = process.argv.slice(2);
const arms = pair?.split(",") ?? [];
if (arms.length !== 2 || arms.some((arm) => arm.length === 0)) throw new Error("usage: tally.ts a,b [--except case1,case2]");
const [a, b] = arms as [string, string];
const exceptAt = rest.indexOf("--except");
const except = new Set(exceptAt >= 0 ? (rest[exceptAt + 1] ?? "").split(",").filter(Boolean) : []);

const key = new Map<number, { X: string; Y: string; case: string }>();
const sheet = fs.readFileSync(path.join(RESULTS, `pairs-${a}-${b}.md`), "utf8");
const keyLines = fs
  .readFileSync(path.join(RESULTS, `key-${a}-${b}.txt`), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "");
const hash = /^sheet-sha256: ([0-9a-f]{64})$/.exec(keyLines[0] ?? "");
if (sheet.includes("<!-- blind-pairs-v2 -->") && !hash) throw new Error("versioned pair sheet has no hash in its key");
if (hash) {
  const actual = createHash("sha256").update(sheet).digest("hex");
  if (actual !== hash[1]) throw new Error("pair sheet and key do not match");
  keyLines.shift();
}
for (const [i, line] of keyLines.entries()) {
  const m = /^(\d+): X=(\S+) Y=(\S+) \((\S+) run \d+\)$/.exec(line.trim());
  if (!m) throw new Error(`malformed key line ${i + 1}: ${line}`);
  const n = Number(m[1]);
  if (n !== i + 1) throw new Error(`key line ${i + 1} is pair ${n}`);
  if (key.has(n)) throw new Error(`duplicate key for pair ${n}`);
  if (new Set([m[2], m[3]]).size !== 2 || ![m[2], m[3]].includes(a) || ![m[2], m[3]].includes(b)) {
    throw new Error(`pair ${n} does not contain exactly ${a} and ${b}`);
  }
  key.set(n, { X: m[2]!, Y: m[3]!, case: m[4]! });
}
if (key.size === 0) throw new Error("pair key is empty");
const keyCases = new Set([...key.values()].map((row) => row.case));
const unknownExcept = [...except].filter((id) => !keyCases.has(id));
if (unknownExcept.length > 0) throw new Error(`unknown --except case(s): ${unknownExcept.join(", ")}`);
const verdicts = new Map<number, { pick: string; problem: string }>();
const verdictLines = fs
  .readFileSync(path.join(RESULTS, `verdicts-${a}-${b}.txt`), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "");
for (const [i, line] of verdictLines.entries()) {
  const m = /^(\d+):\s*(X|Y|same)\b.*?problem:\s*(.*)$/i.exec(line.trim());
  if (!m) throw new Error(`malformed verdict line ${i + 1}: ${line}`);
  const n = Number(m[1]);
  if (!key.has(n)) throw new Error(`verdict for unknown pair ${n}`);
  if (verdicts.has(n)) throw new Error(`duplicate verdict for pair ${n}`);
  verdicts.set(n, { pick: m[2]!.toUpperCase(), problem: m[3]!.trim() });
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
