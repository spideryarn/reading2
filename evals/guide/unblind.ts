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
import { pathToFileURL } from "node:url";

interface KeyRow {
  readonly X: string;
  readonly Y: string;
  readonly case: string;
}

export interface Unblinded {
  readonly wins: Record<string, number>;
  readonly sides: { X: number; Y: number };
  readonly byCase: Record<string, string[]>;
}

/** Parse a complete blind judgment. Missing, duplicate and malformed evidence is an error, never a smaller denominator. */
export function unblind(keyText: string, verdictText: string, a: string, b: string): Unblinded {
  const key = new Map<string, KeyRow>();
  for (const line of keyText.trim().split("\n")) {
    const m = /^(\d+): X=(\S+) Y=(\S+) \((\S+) run (\d+)\)$/.exec(line);
    if (!m) throw new Error(`bad key line: ${line}`);
    if (key.has(m[1] as string)) throw new Error(`duplicate key pair ${m[1]}`);
    if (new Set([m[2], m[3]]).size !== 2 || ![m[2], m[3]].every((arm) => arm === a || arm === b)) {
      throw new Error(`key pair ${m[1]} does not contain exactly ${a} and ${b}`);
    }
    key.set(m[1] as string, { X: m[2] as string, Y: m[3] as string, case: m[4] as string });
  }
  const wins: Record<string, number> = { [a]: 0, [b]: 0, same: 0 };
  const sides = { X: 0, Y: 0 };
  const byCase: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const line of verdictText.trim().split("\n")) {
    const m = /^(\d+): (X|Y|same)\b/.exec(line);
    if (!m) throw new Error(`bad verdict line: ${line}`);
    if (seen.has(m[1] as string)) throw new Error(`duplicate verdict for pair ${m[1]}`);
    const k = key.get(m[1] as string);
    if (!k) throw new Error(`verdict for unknown pair ${m[1]}`);
    seen.add(m[1] as string);
    const winner = m[2] === "same" ? "same" : k[m[2] as "X" | "Y"];
    if (m[2] !== "same") sides[m[2] as "X" | "Y"]++;
    wins[winner] = (wins[winner] ?? 0) + 1;
    const caseWins = byCase[k.case] ?? [];
    caseWins.push(winner);
    byCase[k.case] = caseWins;
  }
  const missing = [...key.keys()].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`missing verdict for pair${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`);
  return { wins, sides, byCase };
}

async function main(): Promise<void> {
  const [a, b] = process.argv.slice(2);
  if (!a || !b) throw new Error("usage: unblind.ts <a> <b>");
  const dir = path.join(import.meta.dirname, "results");
  const result = unblind(
    fs.readFileSync(path.join(dir, `conversations-key-${a}-${b}.txt`), "utf8"),
    fs.readFileSync(path.join(dir, `conversations-verdicts-${a}-${b}.txt`), "utf8"),
    a,
    b,
  );
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
