/**
 * **Does each person, work or study a reply brings in get introduced?** — the
 * targeted screen behind plan
 * docs/plans/261024d-chats-give-the-background-for-what-they-bring-in.md
 * (Greg's report `spya-bq9wv5`). The pairwise judge answers "which is better
 * overall", which is too coarse to see one clause; this asks a blind counter
 * the one question the clause is about.
 *
 *     npx tsx evals/chat-principles/introduced.ts --sheet bg-before,bg-after   # free: shuffled replies, no arm names
 *     npx tsx evals/chat-principles/introduced.ts --tally bg-before,bg-after   # free: unblind the counts
 *
 * The counter reads `introduced-<arms>.md` only and writes
 * `introduced-<arms>-counts.txt`, one line per reply:
 * `r<n>: brought <a>; bare <b>; over <c>; bare-names: …`.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Case } from "./run.js";
import { blindCoin } from "../plain-words/run.js";

const RESULTS = path.join(import.meta.dirname, "results");

interface Row {
  readonly case: string;
  readonly run: number;
  readonly answer: string;
}

export interface KeyRow {
  readonly label: string;
  readonly case: string;
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function rowsOf(label: string): Row[] {
  return (JSON.parse(fs.readFileSync(path.join(RESULTS, `${label}.json`), "utf8")) as { rows: Row[] }).rows;
}

/** Draw an integer uniformly from 0 through `max`, using only the tested coin. */
export function uniformIndex(coin: () => boolean, max: number): number {
  const size = max + 1;
  let range = 1;
  let bits = 0;
  while (range < size) {
    range *= 2;
    bits++;
  }
  for (;;) {
    let n = 0;
    for (let bit = 0; bit < bits; bit++) n = n * 2 + (coin() ? 1 : 0);
    /* Rejection, rather than modulo, keeps every index equally likely when
       `size` is not a power of two. */
    if (n < size) return n;
  }
}

const HEADER = [
  "# Introduced or bare",
  "",
  "Each reply below is from a reading companion talking to one reader about one article. For each reply, count:",
  "- brought: people, works, studies, theories and technical terms it brings in from OUTSIDE the article",
  "  (not the article's own author, not the reader's own words, not terms the reader used first);",
  "- bare: how many of those it names without saying, near where it names them, who or what they are",
  "  (\"Dan Luu also wrote a post\" is bare; \"Dan Luu, an engineer who blogs about programming, …\" is not);",
  "- over: how many things it explains that this reader has plainly shown they already know.",
  "A link alone is not an introduction. Answer one line per reply, exactly:",
  "`r<n>: brought <a>; bare <b>; over <c>; bare-names: <comma list or none>`.",
  "",
];

/** The result rows of `labels`, each with its arm, kept to `cases` when given. */
function rowsFor(labels: string[], cases?: ReadonlySet<string>) {
  return labels.flatMap((label) =>
    rowsOf(label)
      .filter((r) => !cases || cases.has(r.case))
      .map((r) => ({ label, ...r })),
  );
}

/**
 * Every reply from `labels` (only `cases`' when given), shuffled into one blind
 * sheet under `header`: `<prefix>-<arms>.md`, and its key beside it. Shared
 * with examples.ts (plan 261024v), which asks a different question.
 */
export async function writeSheet(
  labels: string[],
  seed: number,
  prefix: string,
  header: readonly string[],
  cases?: ReadonlySet<string>,
  /** Lines shown between the reader's question and the reply. */
  context?: (c: Case, answer: string) => readonly string[],
): Promise<void> {
  /* `run.ts` reaches production's chat and store modules. The tally needs none
     of that; load the cases only for the command that renders them. */
  const { CASES } = await import("./run.js");
  if (new Set(labels).size !== labels.length) throw new Error("each arm may appear only once");
  const all = rowsFor(labels, cases);
  /* Fisher–Yates on the tested coin, so the arms interleave. */
  const coin = blindCoin(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = uniformIndex(coin, i);
    [all[i], all[j]] = [all[j]!, all[i]!];
  }
  const out = [...header];
  const key: string[] = [];
  all.forEach((r, i) => {
    const c = CASES.find((k) => k.id === r.case);
    if (!c) throw new Error(`unknown case ${r.case}`);
    key.push(`r${i + 1}: ${r.label} ${r.case} ${r.run}`);
    out.push(
      `## r${i + 1}`,
      "",
      `Reader: about them: ${c.about ?? "not said"}; why reading: ${c.why ?? "not said"}.`,
      ...c.history.map((t, k) => `> ${k % 2 === 0 ? "Reader" : "Companion"}: ${t}`),
      `Reader now: "${c.question}"`,
      "",
      ...(context?.(c, r.answer) ?? []),
      r.answer.trim(),
      "",
    );
  });
  const name = labels.join("-");
  fs.writeFileSync(path.join(RESULTS, `${prefix}-${name}.md`), `${out.join("\n")}\n`);
  fs.writeFileSync(path.join(RESULTS, `${prefix}-${name}-key.txt`), `${key.join("\n")}\n`);
  console.log(`${all.length} replies`);
}

export function readKey(
  labels: string[],
  name: string,
  prefix = "introduced",
  cases?: ReadonlySet<string>,
): Map<string, KeyRow> {
  const rows = rowsFor(labels, cases);
  const expected = new Set(rows.map((r) => `${r.label}\0${r.case}\0${r.run}`));
  if (expected.size !== rows.length) throw new Error("an arm contains duplicate case/run rows");

  const key = new Map<string, KeyRow>();
  const keyLines = fs
    .readFileSync(path.join(RESULTS, `${prefix}-${name}-key.txt`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  for (const [i, line] of keyLines.entries()) {
    const m = /^(r\d+): (\S+) (\S+) (\d+)$/.exec(line.trim());
    if (!m) throw new Error(`malformed key line ${i + 1}: ${line}`);
    const reply = m[1]!;
    if (reply !== `r${i + 1}`) throw new Error(`key line ${i + 1} is ${reply}, expected r${i + 1}`);
    if (key.has(reply)) throw new Error(`duplicate key for ${reply}`);
    const identity = `${m[2]}\0${m[3]}\0${m[4]}`;
    if (!expected.delete(identity)) throw new Error(`unexpected or duplicate key row: ${line}`);
    key.set(reply, { label: m[2]!, case: m[3]! });
  }
  if (expected.size > 0) throw new Error(`key omits ${expected.size} result row(s)`);
  return key;
}

function readCounts(name: string, key: ReadonlyMap<string, KeyRow>) {
  const sums = new Map<string, { brought: number; bare: number; over: number; n: number }>();
  const seen = new Set<string>();
  const countLines = fs
    .readFileSync(path.join(RESULTS, `introduced-${name}-counts.txt`), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  for (const [i, line] of countLines.entries()) {
    const m = /^(r\d+):\s*brought (\d+); bare (\d+); over (\d+); bare-names: (.+)$/.exec(line.trim());
    if (!m) throw new Error(`malformed count line ${i + 1}: ${line}`);
    const reply = m[1]!;
    const k = key.get(reply);
    if (!k) throw new Error(`no key for ${reply}`);
    if (seen.has(reply)) throw new Error(`duplicate count for ${reply}`);
    seen.add(reply);
    const brought = Number(m[2]);
    const bare = Number(m[3]);
    const over = Number(m[4]);
    const bareNames = m[5]!.trim();
    if (bare > brought) throw new Error(`${reply} has more bare items than brought items`);
    if ((bare === 0) !== (bareNames === "none")) throw new Error(`${reply}'s bare count and bare-names disagree`);
    if (bare > 0 && bareNames.split(/,\s*/).length !== bare) {
      throw new Error(`${reply}'s bare count and bare-names disagree`);
    }
    const s = sums.get(k.label) ?? { brought: 0, bare: 0, over: 0, n: 0 };
    s.brought += brought;
    s.bare += bare;
    s.over += over;
    s.n++;
    sums.set(k.label, s);
  }
  const missing = [...key.keys()].filter((r) => !seen.has(r));
  if (missing.length > 0) throw new Error(`the counter did not answer ${missing.join(", ")}`);
  return sums;
}

function tally(labels: string[]): void {
  const name = labels.join("-");
  if (new Set(labels).size !== labels.length) throw new Error("each arm may appear only once");
  const sums = readCounts(name, readKey(labels, name));
  for (const [label, s] of sums) {
    console.log(`${label.padEnd(12)} replies ${s.n}  brought ${s.brought}  bare ${s.bare} (${Math.round((100 * s.bare) / Math.max(1, s.brought))}%)  over ${s.over}`);
  }
}

/* A guard, so examples.ts (plan 261024v) can borrow the helpers above. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sheetArg = arg("sheet");
  const tallyArg = arg("tally");
  if (sheetArg) {
    const seed = Number(arg("seed") ?? "1");
    if (!Number.isSafeInteger(seed)) throw new Error("--seed must be an integer");
    await writeSheet(sheetArg.split(","), seed, "introduced", HEADER);
  } else if (tallyArg) tally(tallyArg.split(","));
  else throw new Error("usage: --sheet a,b[,c] [--seed n] | --tally a,b[,c]");
}
