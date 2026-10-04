/**
 * **Find more, as the command bar names it and as a band offers it** — the
 * words of the bar's *‹mode› › Find more* rows, and the one answer to *is a
 * fresh Find more on offer here*, which the reading view, the band's own
 * control and the band's take of the bar's press all read.
 *
 * Greg, 2026-10-04 (spya-rbxrgc):
 *
 * > There are lots of cases where we have a sort of find more button, for
 * > example in the glossary mode. Let's make that be part of the command bar as
 * > well.
 *
 * ## Two bands, because two bands have the button
 *
 * A survey of every band on 2026-10-04 found a button that **adds to a list**
 * in Glossary and Quotes and nowhere else; the others have only a forced
 * rewrite, and those are the bar's *Run again* rows (rerun-commands.ts).
 * `FIND_MORE_MODES` is that survey's answer, and a third band with an append
 * is a third member here.
 *
 * ## Why this is not a word on the *Run again* row
 *
 * *Glossary › Run again* posts the forced run with the reader's **current**
 * profile and lands on Metadata. The band's button posts it in **the list's
 * own recorded setting**, so a plain list is added to rather than rewritten
 * (useGlossary.ts § `more`), and shows the run where the list is. So the bar
 * does not post at all: it leaves a hand-off (find-more-handoff.ts), opens the
 * band, and the band presses its own button.
 *
 * ## A leaf, like rerun-commands.ts
 *
 * No closure and no React: the words are ranked in tests exactly as production
 * ranks them, and serialise into the command-pick catalogue. Imports nothing
 * of the bar's, the Dock's or a panel's — the hooks' types only.
 *
 * docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import { MODE_LABEL } from "../title-text.js";
import { MAX_QUOTES_TOTAL } from "../types.js";
import type { ActionOutcome, Command } from "./command-match.js";
import type { GlossaryRead, UseGlossary } from "./useGlossary.js";
import type { QuotesRead, UseQuotes } from "./useQuotes.js";
import type { StepJob } from "./useStepJob.js";

/** The bands with a button that adds to their list, in the Dock's order. */
export const FIND_MORE_MODES = ["glossary", "quotes"] as const;
export type FindMoreMode = (typeof FIND_MORE_MODES)[number];

/** What the row says under its name. No figure: tests/no-ai-cost-for-readers.test.ts. */
const DESCRIPTION: Record<FindMoreMode, string> = {
  glossary: "Looks for more terms and adds them to the list you have, in the Glossary band",
  quotes: "Looks for more lines worth keeping and adds them to the list you have, in the Quotes band",
};

/**
 * **Every way of asking, spelled out around the name** — the matcher compares
 * the whole query against one alias at a time and never combines words
 * (command-match.ts § `TIERS`; rerun-commands.ts § `RERUN_PHRASES` met this
 * first), so `more quotes` finds a row only if `more quotes` is written down.
 */
const PHRASES: readonly ((name: string) => string)[] = [
  (x) => `find more ${x}`,
  (x) => `more ${x}`,
  (x) => `${x} find more`,
  (x) => `add more ${x}`,
];

/** The names the mode answers to — its label and every nickname, as `rerunNames` gathers them. */
function names(mode: FindMoreMode): readonly string[] {
  return [...new Set([MODE_LABEL[mode], ...MODE_CATALOG[mode].aliases].map((n) => n.toLowerCase()))];
}

export interface FindMoreWords {
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

/**
 * **What the row says, and the words that find it.**
 *
 * The label is `<mode> › Find more`, the mode first, so typing `glossary`
 * finds it on the label — a tie the Glossary *mode* wins by coming earlier in
 * the list. A bare `find more` is on both rows: the reader did not say which,
 * and both are offered, Glossary first.
 *
 * **`find more …` is also what the bar's `find` verb takes** (command-match.ts
 * § `VERBS`), so these aliases are the declared exception to the rule that no
 * row's words parse as an argument: the row is ranked, the *Find “more …” in
 * this article* row is appended after it, and both are drawn
 * (tests/command-match-arguments.test.ts § the collision matrix, GPT Sol's F5).
 */
export function findMoreWords(mode: FindMoreMode): FindMoreWords {
  return {
    label: `${MODE_LABEL[mode]} › Find more`,
    description: DESCRIPTION[mode],
    aliases: [...names(mode).flatMap((name) => PHRASES.map((phrase) => phrase(name))), "find more"],
  };
}

/**
 * **The bar's row for one band** — its words, and what Enter does.
 *
 * `generates: true`: the band it opens posts a model run. `typedOnly`, as the
 * *Run again* rows are, so the list the bar opens on is unchanged.
 * `opensOnly: false`, so a sentence a model read never runs it without a
 * press (CommandBar.tsx § `onlyMovesTheReader`).
 *
 * `run` is the caller's — the reading view's press (command-runners.ts §
 * `findMoreRunners`) — so the ranking tests hold the row production holds.
 */
export function findMoreCommand(mode: FindMoreMode, run: () => ActionOutcome | Promise<ActionOutcome>): Command {
  return {
    kind: "action",
    id: `find-more-${mode}`,
    ...findMoreWords(mode),
    generates: true,
    typedOnly: true,
    opensOnly: false,
    run,
  };
}

/* ------------------------------------------------------- is it on offer -- */

/**
 * **Nothing is out, so a fresh press is what the run control draws** — no job,
 * no POST on its way, no failure on screen.
 *
 * `JobProgress` draws the job's progress for the first, *Starting…* for the
 * second, and for the third a Retry (which skips the stages that worked), the
 * server's refusal, or nothing at all. `useStepJob.start` has no in-flight
 * latch, so a press that arrives from the bar in any of those would be a
 * second paid run beside the first, or past a cheaper Retry (GPT Sol's F1 on
 * plan 261004k). Glossary's run row branches on this same function.
 */
export function freshRunOffered(run: Pick<StepJob, "job" | "starting" | "failed">): boolean {
  return run.job === null && !run.starting && run.failed === null;
}

/**
 * **The glossary's list can be added to** — the read has settled with a list
 * in it, and the server says the panel's run **appends** (`panelRun`,
 * src/glossary.ts § `panelRunKind`).
 *
 * This is the gate on *drawing* the bar's row (GPT Sol's F3: no row, never a
 * row that opens a band and does nothing), read by Reader.tsx off the
 * always-mounted glossary read.
 *
 * **An absent verdict is not an append** (F2). The panel's own label falls
 * back to `stale || outdated` for an older cached response, which cannot see a
 * changed or cleared profile — and on that list the forced run rewrites. The
 * band's button says what it can; a command that promises never to replace a
 * list waits for the server to say so.
 */
export function glossaryAppendOnOffer(read: Pick<GlossaryRead, "status" | "glossary" | "panelRun">): boolean {
  return read.status === "ready" && read.glossary !== null && read.panelRun === "append";
}

/**
 * **A fresh Find more is what the glossary band offers right now** — the list
 * can be added to, nothing is out, and no forced run is waiting for its list
 * (`rewriting`, rewrite-hold.ts).
 *
 * The band's take of the bar's press reads this and nothing else
 * (GlossaryPanel.tsx § the bar's Find more); its two halves are what the run
 * row itself is drawn from.
 */
export function glossaryFindMoreOffered(
  owner: Pick<UseGlossary, "status" | "glossary" | "panelRun" | "job" | "starting" | "failed" | "rewriting">,
): boolean {
  return glossaryAppendOnOffer(owner) && freshRunOffered(owner) && !owner.rewriting;
}

/**
 * **The quotes' list can be added to** — settled, a list, written from this
 * article by today's prompt, and under the ceiling. The guard `Foot` in
 * QuotesPanel.tsx draws its *Find more* under, and the gate on the bar's row.
 * On a stale or outdated list the forced run replaces (src/quotes.ts §
 * existingFor); at the ceiling there is nothing to add.
 */
export function quotesAppendOnOffer(read: Pick<QuotesRead, "status" | "quotes" | "stale" | "outdated">): boolean {
  return (
    read.status === "ready" &&
    read.quotes !== null &&
    !read.stale &&
    !read.outdated &&
    read.quotes.quotes.length < MAX_QUOTES_TOTAL
  );
}

/** **A fresh Find more is what the quotes band offers right now** — `glossaryFindMoreOffered`'s twin. */
export function quotesFindMoreOffered(
  owner: Pick<UseQuotes, "status" | "quotes" | "stale" | "outdated" | "job" | "starting" | "failed">,
): boolean {
  return quotesAppendOnOffer(owner) && freshRunOffered(owner);
}
