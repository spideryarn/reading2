/* Every collectSpend( call outside tests, and whether its options name a sink.
   A balanced-bracket scan rather than a parse: TypeScript 7 ships no JS API.
   Run: npx tsx evals/cost/unledgered-261007/sinkless-collectors.ts */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["grep", "-l", "collectSpend(", "--", "src", "evals", "scripts", "tools"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|mjs)$/.test(f) && !/\.test\./.test(f));

/** The top-level arguments of the call whose "(" is at `open`. */
function args(text: string, open: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = open + 1;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      depth--;
      if (depth === 0) {
        out.push(text.slice(start, i));
        return out;
      }
    } else if (c === "," && depth === 1) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/(?<![\w.])collectSpend\(/g)) {
    const line = text.slice(0, m.index).split("\n").length;
    const lineText = text.slice(text.lastIndexOf("\n", m.index) + 1, m.index);
    if (/function\s+$|^\s*(\*|\/\/)/.test(lineText) || /`[^`]*$/.test(lineText)) continue; // a definition, a comment, a doc span
    const [, opts] = args(text, m.index! + "collectSpend".length);
    const verdict = opts === undefined || !opts.trim() ? "NO OPTIONS" : /\bsink\b/.test(opts) ? "sink" : "NO SINK";
    console.log(`${verdict.padEnd(11)} ${file}:${line}  ${(opts ?? "").replace(/\s+/g, " ").trim().slice(0, 100)}`);
  }
}
