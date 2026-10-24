/**
 * **Is an example chosen because it is clearest, or because it is the
 * reader's field?** — the targeted screen behind plan
 * docs/plans/261024v-chat-picks-the-clearest-example-not-the-reader-s-field.md
 * (Greg's report `spya-furs26`). The shape of introduced.ts, whose shuffle and
 * key it borrows: a blind counter reads every reply from every arm with no arm
 * names and answers one question.
 *
 *     npx tsx evals/chat-principles/examples.ts --sheet ex-before,ex-after   # free: shuffled replies, no arm names
 *     npx tsx evals/chat-principles/examples.ts --tally ex-before,ex-after   # free: unblind the counts
 *
 * Only the `ex-*` cases are sheeted. The counter reads `examples-<arms>.md`
 * only and writes `examples-<arms>-counts.txt`, one line per reply:
 * `r<n>: examples <a>; theirs <b>; forced <c>; forced-what: …`.
 */
import fs from "node:fs";
import path from "node:path";
import { citedPassages } from "../guide/conversations.js";
import { arg, readKey, writeSheet } from "./introduced.js";
import { CASES, type Case, load } from "./run.js";

const RESULTS = path.join(import.meta.dirname, "results");

const HEADER = [
  "# Whose examples",
  "",
  "Each reply below is from a reading companion talking to one reader about one passage. The passage,",
  "and any other passage the reply cites, are shown above the reply. For each reply, list every",
  "analogy, comparison or illustrative case the reply brings in that is NOT in those passages (the",
  "article's own examples, and plain restatements of the passage, do not count). For each one say:",
  "- theirs or general: is it drawn from the job or field in the reader's description?",
  "- forced: only for a `theirs` one, would a plainer, more general example have been clearer, or as",
  "  clear to more people? If so, name that plainer example. One the reader asked for, or that is",
  "  plainly the clearest for this point, is not forced.",
  "Answer one line per reply, exactly:",
  "`r<n>: examples <a>; theirs <b>; forced <c>; items: <item> | <item> … (or none)`",
  "where each item is `<a few words> (general)`, `<a few words> (theirs)` or",
  "`<a few words> (theirs, forced → <the plainer example>)`, and a = items, b = theirs, c = forced.",
  "",
];

/** The passage the chat was started from, and the ones the reply cites. */
function passages(c: Case, answer: string): string[] {
  const { blocks } = load(c.dir);
  const anchor = c.anchor ? blocks.find((b) => b.id === c.anchor!.blockId) : undefined;
  if (c.anchor && !anchor) throw new Error(`${c.id}: missing anchor block ${c.anchor.blockId}`);
  return [
    ...(anchor ? [`Passage [${anchor.id}]: ${anchor.text.replace(/\s+/g, " ")}`, ""] : []),
    ...(() => {
      const cited = citedPassages(answer, blocks).filter((line) => !anchor || !line.startsWith(`- [${anchor.id}]`));
      return cited.length > 0 ? ["Other passages it cites:", ...cited, ""] : [];
    })(),
    "Reply:",
    "",
  ];
}

/** Which cases this screen is about: plan 261024v's, and only those. */
const EXAMPLE_CASES: ReadonlySet<string> = new Set(CASES.filter((c) => c.id.startsWith("ex-")).map((c) => c.id));

async function tally(labels: string[]): Promise<void> {
  const name = labels.join("-");
  const key = readKey(labels, name, "examples", EXAMPLE_CASES);
  const sums = new Map<string, { examples: number; theirs: number; forced: number; n: number }>();
  const perCase = new Map<string, Array<{ run: number; value: string }>>();
  const seen = new Set<string>();
  const lines = fs
    .readFileSync(path.join(RESULTS, `examples-${name}-counts.txt`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  for (const [i, line] of lines.entries()) {
    const m = /^(r\d+):\s*examples (\d+); theirs (\d+); forced (\d+); items: (.+)$/.exec(line.trim());
    if (!m) throw new Error(`malformed count line ${i + 1}: ${line}`);
    const reply = m[1]!;
    const k = key.get(reply);
    if (!k) throw new Error(`no key for ${reply}`);
    if (seen.has(reply)) throw new Error(`duplicate count for ${reply}`);
    seen.add(reply);
    const [examples, theirs, forced] = [Number(m[2]), Number(m[3]), Number(m[4])];
    /* The counts must be the items' own, so a miscount is caught here rather
       than averaged in. */
    const items = m[5]!.trim() === "none" ? [] : m[5]!.split(" | ");
    const tags = items.map((item) => {
      if (/\(general\)$/.test(item)) return "general";
      if (/\(theirs\)$/.test(item)) return "theirs";
      if (/\(theirs, forced → .+\)$/.test(item)) return "forced";
      throw new Error(`${reply}: malformed item: ${item}`);
    });
    if (items.length !== examples || tags.filter((tag) => tag !== "general").length !== theirs || tags.filter((tag) => tag === "forced").length !== forced) {
      throw new Error(`${reply}: the counts do not match its items: ${line}`);
    }
    const s = sums.get(k.label) ?? { examples: 0, theirs: 0, forced: 0, n: 0 };
    s.examples += examples;
    s.theirs += theirs;
    s.forced += forced;
    s.n++;
    sums.set(k.label, s);
    const at = `${k.case} ${k.label}`;
    perCase.set(at, [...(perCase.get(at) ?? []), { run: k.run, value: `${examples}/${theirs}/${forced}` }]);
  }
  const missing = [...key.keys()].filter((r) => !seen.has(r));
  if (missing.length > 0) throw new Error(`the counter did not answer ${missing.join(", ")}`);
  /* Rates with their denominators (GPT Sol's plan review, F5): fewer forced
     examples is only good news if it is not fewer examples altogether. */
  for (const [label, s] of sums) {
    console.log(
      `${label.padEnd(12)} replies ${s.n}  examples ${s.examples} (${(s.examples / s.n).toFixed(1)}/reply)` +
        `  theirs ${s.theirs}/${s.examples}  forced ${s.forced}/${s.theirs}`,
    );
  }
  console.log("\nper case, examples/theirs/forced per run:");
  for (const at of [...perCase.keys()].sort()) {
    const runs = perCase
      .get(at)!
      .sort((a, b) => a.run - b.run)
      .map(({ run, value }) => `${run}:${value}`)
      .join("  ");
    console.log(`  ${at.padEnd(28)} ${runs}`);
  }
}

const sheetArg = arg("sheet");
const tallyArg = arg("tally");
if (sheetArg) {
  const seed = Number(arg("seed") ?? "1");
  if (!Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");
  await writeSheet(sheetArg.split(","), seed, "examples", HEADER, EXAMPLE_CASES, passages);
} else if (tallyArg) await tally(tallyArg.split(","));
else throw new Error("usage: --sheet a,b[,c] [--seed n] | --tally a,b[,c]");
