/**
 * **The list the arms choose from**: the bar's real rows for an owner on an
 * article with Experimental on — the `owner-article` slice of
 * src/command-pick-catalogue.generated.json, which
 * tests/command-pick-catalogue.test.ts writes from the bar's own functions and
 * keeps in step with them — then the five argument commands, then `none`.
 * Plan 261003k Stage 1.
 *
 * The first run (plan 261002c Stage D) used a hand copy of 51 rows, now
 * ./catalogue-261002c.ts, retired. Its results are `results/jev.json`,
 * `results/chat.json` and `results/summary.md`; this run's are in
 * `results/261003/`, and no answer is shared between the two.
 *
 * The argument options' words are ours and trusted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NONE = "none";

/** `ArgumentQuery["kind"]` in src/web/command-match.ts — see `BarAnswer` below for why it is not imported. */
export type ArgumentKind = "find" | "jump-first" | "glossary" | "tag-add" | "tag-remove";

/** `PickOption` (src/web/command-match.ts), plus what the generator adds. */
export interface CatalogueRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly kind: "mode" | "submode" | "page" | "action" | "argument";
  /** The row carries the bar's `generates` marker: pressing it may start a model call. */
  readonly generates: boolean;
  /** The places the bar draws this row (the generator's `CONTEXTS`). */
  readonly contexts: readonly string[];
}

/** The slice this eval measures. */
export const EVAL_CONTEXT = "owner-article";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BAR_ROWS: readonly CatalogueRow[] = (
  JSON.parse(
    readFileSync(path.join(HERE, "..", "..", "src", "command-pick-catalogue.generated.json"), "utf8"),
  ) as CatalogueRow[]
).filter((row) => row.contexts.includes(EVAL_CONTEXT));

const argument = (kind: ArgumentKind, label: string, description: string, aliases: string[]): CatalogueRow => ({
  id: `arg:${kind}`,
  label,
  description,
  aliases,
  kind: "argument",
  generates: false,
  contexts: [EVAL_CONTEXT],
});

export const ARGUMENT_ROWS: readonly CatalogueRow[] = [
  argument(
    "find",
    "Find words in this article",
    "Look for a word, a name or a phrase in the article and show every place it comes up. Choose this when the reader names something to look for.",
    ["search for", "does it mention", "is it mentioned"],
  ),
  argument(
    "jump-first",
    "Jump to the first mention",
    "Go to the first place the article says a word, a name or a phrase. Choose this when the reader asks where something first comes up.",
    ["first mention of", "where does it first say"],
  ),
  argument(
    "glossary",
    "Look up a term",
    "Say what one term means in this article. Choose this when the reader names a term and asks what it is or what it means.",
    ["define", "what does it mean", "look up"],
  ),
  argument(
    "tag-add",
    "Add a tag",
    "Put a tag, a short label of the reader's own, on this article. Choose this when the reader names a tag to add.",
    ["tag this as", "label", "file under"],
  ),
  argument(
    "tag-remove",
    "Remove a tag",
    "Take a tag off this article. Choose this when the reader names a tag to take off.",
    ["untag", "remove the tag"],
  ),
];

export const CATALOGUE: readonly CatalogueRow[] = [...BAR_ROWS, ...ARGUMENT_ROWS];
export const VALID_IDS: ReadonlySet<string> = new Set([...CATALOGUE.map((c) => c.id), NONE]);
export const rowFor = (id: string): CatalogueRow | undefined => CATALOGUE.find((c) => c.id === id);
export const isArgumentId = (id: string): boolean => id.startsWith("arg:");

/**
 * **Would this pick run the moment it came back, if the model were sure?**
 * Plan 261003k § The line, applied: only something that moves the reader. Not
 * a row that `generates`, not Archive, Export or the Experimental switch, not
 * a tag (it writes), and not a glossary look-up (it may ask a model).
 */
const WAITS = new Set([
  "action:archive",
  "action:export",
  "action:experimental",
  "arg:tag-add",
  "arg:tag-remove",
  "arg:glossary",
]);
export function runsAtOnce(id: string): boolean {
  const row = rowFor(id);
  return row !== undefined && !row.generates && !WAITS.has(id);
}

/**
 * Changes the reader's data, or starts paid work that was not asked for: the
 * picks that must never come back for a request with no right answer.
 */
export function writesOrSpends(id: string): boolean {
  return (
    id === "action:archive" ||
    id === "action:experimental" ||
    id === "arg:tag-add" ||
    id === "arg:tag-remove" ||
    id.startsWith("action:rerun-")
  );
}

/* ------------------------------------------ what the bar answers by itself -- */

/**
 * **What the bar's own matching gives one sentence**: how many rows
 * `rankCommands` finds among the eval's rows, and what `parseArgumentQuery`
 * reads out of it.
 *
 * Read from `bar-answers.generated.json` rather than computed here, because
 * src/web/command-match.ts reaches a `.tsx` file through its imports and the
 * project that type-checks `evals/` has no JSX. The file is written, and kept
 * in step with the phrases and the bar, by
 * tests/command-pick-catalogue.test.ts.
 */
export interface BarAnswer {
  readonly rows: number;
  readonly argument: readonly { readonly kind: ArgumentKind; readonly words: string }[];
}

const BAR_ANSWERS = JSON.parse(readFileSync(path.join(HERE, "bar-answers.generated.json"), "utf8")) as Record<string, BarAnswer>;

export function barAnswers(text: string): BarAnswer {
  const answer = BAR_ANSWERS[text];
  if (!answer) throw new Error(`no bar answer saved for "${text}" — regenerate: see tests/command-pick-catalogue.test.ts`);
  return answer;
}

/**
 * **Does the bar's own matching already give this sentence a row?** Production
 * asks a model only when it does not (plan 261003k, decision 1), so accuracy
 * on the rest is the number that matters.
 */
export function barAnswersIt(text: string): boolean {
  const a = barAnswers(text);
  return a.rows > 0 || a.argument.length > 0;
}
