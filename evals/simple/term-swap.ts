/**
 * **The "feedback loops" screen** — docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md.
 *
 * ```
 * npx tsx evals/simple/term-swap.ts high-none-pidpre high-none-pidpost   # free
 * ```
 *
 * For every arm whose name starts with one of the given prefixes, prints each
 * sentence on the PID paper that mentions feedback, loops or recurrence, and
 * screens for outputs (one level of one run) that call something "feedback"
 * without one of a few phrasings of the paper's contrast. A candidate is not a
 * verdict: the regex has known false positives and every candidate is read by
 * hand. The plan records that hand count.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..", "results", "simple");
const SLUG = "entropy-24-00930-spya-pywwkq";
const LEVELS = ["brief", "paragraphs", "fuller"] as const;
const ARM_ORDER = new Intl.Collator("en", { numeric: true }).compare;

/** A broad candidate for "feedback" used as the wiring's name, not a verdict. */
function swapCandidate(sentence: string): boolean {
  if (!/feedback/i.test(sentence)) return false;
  return !/(not|n't|but not|rather than|than) (with )?feedback|feedback (connections?|ones?|links?)[^.]*(lower|reduc|less|did not|didn't|not)/i.test(sentence);
}

const prefixes = process.argv.slice(2);
if (prefixes.length === 0) throw new Error("usage: term-swap.ts <arm prefix>...");

for (const prefix of prefixes) {
  const arms = fs.readdirSync(ROOT).filter((a) => a.startsWith(prefix)).sort(ARM_ORDER);
  let outputs = 0;
  let candidates = 0;
  let examinedRuns = 0;
  let failedRuns = 0;
  const runsWithCandidates = new Set<string>();
  for (const arm of arms) {
    const file = path.join(ROOT, arm, `${SLUG}.json`);
    if (!fs.existsSync(file)) continue;
    const run = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (run.ok !== true) {
      failedRuns += 1;
      console.log(`${arm}: failed — ${String(run.error)}`);
      continue;
    }
    examinedRuns += 1;
    for (const level of LEVELS) {
      const paragraphs = run[level] as { text: string }[];
      outputs += 1;
      const sentences = paragraphs.flatMap((p) => p.text.split(/(?<=[.!?])\s+/));
      const relevant = sentences.filter((s) => /feedback|loop|recurren/i.test(s));
      if (relevant.some(swapCandidate)) {
        candidates += 1;
        runsWithCandidates.add(arm);
      }
      for (const s of relevant) {
        console.log(`${arm} [${level}]${swapCandidate(s) ? " CANDIDATE" : ""} ${s}`);
      }
    }
  }
  console.log(
    `\n${prefix}: ${candidates} of ${outputs} outputs screened as candidates, ` +
      `${runsWithCandidates.size} of ${examinedRuns} successful runs` +
      `${failedRuns === 0 ? "" : `; ${failedRuns} failed`}\n`,
  );
}
