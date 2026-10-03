/**
 * **The re-run steps as a reader names them** — the label and the note that
 * Metadata's *AI processing* rows draw, and the words the command bar's
 * *<label> › Run again* rows answer to. One table for both, so the row on the
 * page and the row in the bar cannot call one step two things.
 *
 * Greg, 2026-10-01 (SPIDERYARN-READING2-8D):
 *
 * > Add a lot more Metadata functionality to Commands, e.g. to reprocess (a
 * > particular mode) with more powerful AI.
 *
 * ## Why this is a leaf
 *
 * `RERUN_LABEL` and `RERUN_COST_NOTE` were private to Metadata.tsx until
 * 2026-10-02, and the bar could not borrow them from there: Metadata imports
 * the Dock and the Dock imports the bar, so an import back would close a cycle
 * (GPT Sol's F8 on docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md).
 * Copying them would be two sources for one label. So they live here, and this
 * file imports nothing of Metadata's, the Dock's or the bar's — only the step
 * list, the mode tables the bar already ranks against, and the Sketch's wait.
 *
 * **What stays in Metadata** is the glossary's *dynamic* label and note
 * (`GLOSSARY_RUN` there), which read the server's verdict for this article and
 * so are not a fact about the step. The bar uses the static hedge below, which
 * is true whichever way the run goes.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import type { ActionOutcome, Command } from "./command-match.js";
import type { Mode } from "../modes.js";
import { METADATA_RERUN_STEPS, type MetadataRerunStep } from "../rerun-steps.js";
import { MODE_LABEL } from "../title-text.js";
import { SKETCH_WAIT } from "./sketch-cost.js";

export { METADATA_RERUN_STEPS, type MetadataRerunStep };

/**
 * The reader-facing name of each — a noun, not the present-tense label the
 * stage rows carry.
 *
 * `Record<MetadataRerunStep, string>`, so a new member of the list is a
 * typecheck failure here rather than a blank row.
 */
export const RERUN_LABEL: Record<MetadataRerunStep, string> = {
  arc: "Arc",
  tweets: "Thread",
  glossary: "Glossary",
  quotes: "Quotes",
  ideas: "Ideas",
  timeline: "Timeline",
  quiz: "Quiz",
  faq: "FAQ",
  /* Not a mode, so no `MODE_LABEL` to borrow: the small words Marginalia draws
     beside a paragraph (so, but, vs). */
  relations: "Relation words",
  sketch: "Sketch",
  skim: "Skim",
  debate: "Debate",
  citations: "Citations",
  /* Not a mode, so no `MODE_LABEL` to borrow: the links it draws in the prose. */
  crossrefs: "Cross-references",
  /* A sub-mode of Summary, named as its chip is. */
  simple: "Simple summary",
};

/**
 * **The four rows for which "another model call" is not the whole story**,
 * said under the mode's name, before the press, because nothing else on the
 * page says it. Metadata.tsx § `RERUN_COST_NOTE`'s old home carried the long
 * version — the confirm these replaced, why the glossary's says both outcomes,
 * and why none names a price — and `RerunRow` there is where they are drawn.
 *
 * **No dollar figure**, since 2026-09-30 — Greg: *"i don't want any regular
 * users to know how much AI processing of their articles costs"*.
 * tests/no-ai-cost-for-readers.test.ts fails on a figure here.
 */
export const RERUN_COST_NOTE: Partial<Record<MetadataRerunStep, string>> = {
  glossary:
    /* *Up to date* is doing the work: `existingFor` refuses the old list when
       there is none, or the source, the prompt version or the reader profile
       differs — GPT Sol's second review listed the branches, and a note naming
       all four was too long to be read as a note. */
    "Adds more terms to an up-to-date list; otherwise writes a new one",
  sketch: `One model call, ${SKETCH_WAIT}`,
  debate: "Up to two model calls, each of which searches the web",
  skim: "Needs Quotes first; without them it stops before any model call",
};

/**
 * **The mode whose band shows this step's artefact**, where there is exactly
 * one — so its name and its nicknames can name the re-run too: `rerun terms`
 * reaches the glossary because `terms` already reaches Glossary.
 *
 * Absent for the steps that are not a mode of their own: the arc (the
 * one-sentence gist on the masthead), the quiz (a sub-mode of Remember, whose
 * own name is already the label), the sketch (one of Diagram's five pictures —
 * `rerun diagram` would be a guess about which), cross-references (links in the
 * prose) and the simple summary (one of Summary's three levels). A `Partial`
 * on purpose: a mode borrowed wrongly would teach the bar a word that runs
 * something the reader did not name.
 */
const RERUN_MODE: Partial<Record<MetadataRerunStep, Mode>> = {
  tweets: "tweets",
  glossary: "glossary",
  quotes: "quotes",
  ideas: "ideas",
  timeline: "timeline",
  faq: "faq",
  skim: "skim",
  debate: "debate",
  citations: "citations",
};

/**
 * **Names a reader might use that neither the label nor a mode supplies.**
 * Sparse, for the reason the mode aliases are (reading-view-overview.md § The
 * command bar): the cost of a loose alias is not a missed match, it is the
 * wrong row ranked first — and every row this table names spends.
 */
const RERUN_ALSO_CALLED: Partial<Record<MetadataRerunStep, readonly string[]>> = {
  crossrefs: ["cross references", "crossrefs"],
  relations: ["relations"],
  simple: ["simple"],
};

/**
 * **The verbs that turn a name into a re-run**, each spelled as a whole phrase
 * around the name. GPT Sol's F3 on plan 261002c: the matcher compares the whole
 * query against one label or one alias at a time and never combines tokens
 * (command-match.ts § `TIERS`), so the generic verbs on their own — the first
 * draft's aliases — matched `rerun` and nothing after it, and the plan's own
 * example, `rerun glossary`, found no row. So every phrase a reader would type
 * is written out, per name.
 */
const RERUN_PHRASES: readonly ((name: string) => string)[] = [
  (x) => `rerun ${x}`,
  (x) => `re-run ${x}`,
  (x) => `regenerate ${x}`,
  (x) => `redo ${x}`,
  (x) => `refresh ${x}`,
  (x) => `${x} again`,
  (x) => `run ${x} again`,
];

/** Every name the step answers to, lower-case and without repeats. */
function rerunNames(step: MetadataRerunStep): readonly string[] {
  const mode = RERUN_MODE[step];
  const names = [
    RERUN_LABEL[step],
    ...(mode === undefined ? [] : [MODE_LABEL[mode], ...MODE_CATALOG[mode].aliases]),
    ...(RERUN_ALSO_CALLED[step] ?? []),
  ].map((n) => n.toLowerCase());
  return [...new Set(names)];
}

/**
 * **What the command bar's re-run row for one step says, and the words that
 * find it** — the `CommandWords` half of the row, with no closure in it, so
 * that the ranking can be tested on exactly what production ranks
 * (tests/command-match-rerun-and-find.test.ts) and so that the day an interface
 * model needs a serialisable catalogue of commands, this half already is one
 * (docs/project/chat-llm-help-commands-vision.md).
 *
 * The label is `<name> › Run again` — the name first, so typing `glossary`
 * finds it on the label, a tie the Glossary *mode* wins by coming earlier in
 * the list (CommandBar.tsx § `commands`).
 *
 * The description is the step's note where it has one, and otherwise the two
 * facts the Metadata section's own intro line states: it is free to the
 * reader, and what is there now stays until the new run succeeds. Nothing
 * here says *out of date* — the bar knows no more about that than the page
 * does.
 */
export interface RerunWords {
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
}

export function rerunWords(step: MetadataRerunStep): RerunWords {
  return {
    label: `${RERUN_LABEL[step]} › Run again`,
    description:
      RERUN_COST_NOTE[step] ?? "Written again from scratch; free, and what is here stays until it succeeds",
    aliases: rerunNames(step).flatMap((name) => RERUN_PHRASES.map((phrase) => phrase(name))),
  };
}

/**
 * **The bar's row for one step** — its words, and what Enter does.
 *
 * `generates: true` because every press is a forced model run, the thing the
 * marker exists to say (CommandBar.tsx § `GENERATES_MARKER`). `typedOnly`
 * because there are fourteen (command-match.ts § `CommandWords`). Every step of
 * `METADATA_RERUN_STEPS`, **whatever the experimental switch says** — the
 * decision rerun-steps.ts records and Metadata already follows: the switch
 * hides a bar's clutter, never the way to redo something already made (GPT
 * Sol's F7).
 *
 * `run` is the caller's, because what it does is a closure over the job queue
 * and the address (CommandBar.tsx § `rerunRows`); this builds the rest so that
 * the ranking tests hold exactly the row production holds.
 */
export function rerunCommand(
  step: MetadataRerunStep,
  run: () => ActionOutcome | Promise<ActionOutcome>,
): Command {
  return {
    kind: "action",
    id: `rerun-${step}`,
    ...rerunWords(step),
    generates: true,
    typedOnly: true,
    run,
  };
}

/**
 * **The Metadata section a re-run lands in** — `?section=` on the Metadata
 * page (params.ts § `sectionParam`), where that step's `RerunRow` shows the run
 * it watches for.
 *
 * Never the mode itself, and this is the finding that decided the shape of the
 * feature (GPT Sol's F1 on plan 261002c): a mode opened with no artefact arms
 * generate-on-open, and `force` is part of the work key on the server
 * (src/store/jobs.ts), so the forced run the bar just started and the unforced
 * one the band would start are two jobs, and two paid runs.
 */
export const RERUN_LANDS_IN = "ai-processing" as const;
