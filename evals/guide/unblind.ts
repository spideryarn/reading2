/**
 * **Unblind a judge's verdicts on `conversations.ts --pairs`** — free.
 *
 *     npx tsx evals/guide/unblind.ts before after
 *
 * Reads results/conversations-key-<a>-<b>.txt and
 * results/conversations-verdicts-<a>-<b>.txt (one `n: X|Y|same; …` line per
 * pair, as the judge wrote them) and prints the wins per arm, and per side, so
 * a judge's side preference shows as such (prompting-guide.md § Measuring).
 */
import fs from "node:fs";
import path from "node:path";

const [a, b] = process.argv.slice(2);
if (!a || !b) throw new Error("usage: unblind.ts <a> <b>");
const dir = path.join(import.meta.dirname, "results");
const key = new Map(
  fs
    .readFileSync(path.join(dir, `conversations-key-${a}-${b}.txt`), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const m = /^(\d+): X=(\S+) Y=(\S+) \((\S+) run (\d+)\)/.exec(line);
      if (!m) throw new Error(`bad key line: ${line}`);
      return [m[1], { X: m[2], Y: m[3], case: m[4] }] as const;
    }),
);
const wins: Record<string, number> = { [a]: 0, [b]: 0, same: 0 };
const sides = { X: 0, Y: 0 };
const byCase: Record<string, string[]> = {};
for (const line of fs.readFileSync(path.join(dir, `conversations-verdicts-${a}-${b}.txt`), "utf8").trim().split("\n")) {
  const m = /^(\d+): (X|Y|same)\b/.exec(line);
  if (!m) continue;
  const k = key.get(m[1] as string);
  if (!k) throw new Error(`verdict for unknown pair ${m[1]}`);
  const winner = m[2] === "same" ? "same" : (k[m[2] as "X" | "Y"] as string);
  if (m[2] !== "same") sides[m[2] as "X" | "Y"]++;
  wins[winner] = (wins[winner] ?? 0) + 1;
  (byCase[k.case as string] ??= []).push(winner);
}
console.log(JSON.stringify({ wins, sides, byCase }, null, 2));
