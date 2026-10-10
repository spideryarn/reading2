/**
 * **What each pipeline step is called where the reader meets what it makes** —
 * the mode or sub-mode that shows it, or, for a step that is not one, a short
 * noun and a line saying what it is and where it shows.
 *
 * Greg, 2026-10-09, on the Metadata page (`spya-u62q09`): *"Can you make sure
 * that the AI processing sections here map to whatever we're calling the nodes,
 * or have a clear explanation of what they are?"* Until then that section named
 * one step three ways — `RERUN_LABEL`'s *Thread*, the pipeline's *Writing the
 * thread*, the key `tweets` — and none of them was *Summary › Thread*, the name
 * on the button. docs/plans/261009x-metadata-ai-processing-named-as-the-modes-are.md.
 *
 * **Read from the tables that own the names, never copied.** A mode's name is
 * `MODE_LABEL`'s and its line the mode catalogue's; a sub-mode's are
 * sub-modes.ts's, written `Mode › Sub` as the command bar writes it
 * (command-runners.ts). So a rename of a mode or a sub-mode renames these rows
 * with it, and only the steps that are neither carry words of their own here.
 *
 * `Record<StepName, …>`, so a new step is a compile error here rather than a
 * row with no name.
 */
import { MODE_CATALOG } from "../mode-catalog.js";
import type { Mode } from "../modes.js";
import { MODE_LABEL } from "../title-text.js";
import type { StepName } from "../types.js";
import { ownLabel } from "./lib/own-label.js";
import { SUMMARY_SUB_MODES, subModeWords, type SubMode } from "./sub-modes.js";

type StepPlace =
  /** A mode of its own shows what it makes. */
  | { readonly mode: Mode }
  /** A sub-mode does. */
  | { readonly sub: SubMode }
  /** Neither: named here, and said where it shows. */
  | { readonly name: string; readonly what: string };

const STEP_PLACE: Record<StepName, StepPlace> = {
  fetch: { name: "Source", what: "The page or PDF we read the article from" },
  metadata: {
    name: "Title and abstract",
    what: "The title, authors and abstract read from a short paper",
  },
  extract: {
    name: "Article text",
    what: "The article's own text, separated from the webpage or read from the PDF",
  },
  /* *Blocks* because At a glance counts them by that word, a few rows up. */
  blocks: {
    name: "Blocks",
    what: "The text cut into paragraphs, headings, quotes and figures, each given a lasting name the reading view can point to",
  },
  structure: { mode: "structure" },
  labels: {
    name: "Paragraph labels",
    what: "A few words naming each paragraph, shown down the spine and in Structure",
  },
  assets: {
    name: "Figures",
    what: "The article's own images, copied to us where possible so they keep loading",
  },
  arc: {
    name: "Arc",
    what: "One sentence per part saying where the argument stands, shown in Structure and Marginalia",
  },
  tweets: { sub: { mode: "summary", view: "thread" } },
  glossary: { mode: "glossary" },
  quotes: { mode: "quotes" },
  skim: { mode: "skim" },
  ideas: { mode: "ideas" },
  timeline: { mode: "timeline" },
  quiz: { sub: { mode: "learn", view: "quiz" } },
  faq: { mode: "faq" },
  relations: {
    name: "Relation words",
    what: "The small words Marginalia puts beside a paragraph where the argument turns (so, but, vs)",
  },
  sketch: { sub: { mode: "diagram", view: "sketch" } },
  illustrated: { sub: { mode: "diagram", view: "illustrated" } },
  debate: { sub: { mode: "sources", view: "reception" } },
  "debate-claims": { sub: { mode: "sources", view: "claims" } },
  bibliography: { sub: { mode: "sources", view: "bibliography" } },
  crossrefs: {
    name: "Cross-references",
    what: "Links in the prose from a claim to the passage it rests on",
  },
  /* One step writes both of Summary's plain-words lengths, so it is named for
     the two of them rather than borrowing either sub-mode's name. Read both
     names from their owner so either rename reaches this joint row. */
  simple: {
    name: `${MODE_LABEL.summary} › ${SUMMARY_SUB_MODES.brief.label} and ${SUMMARY_SUB_MODES.fuller.label}`,
    what: "The piece in plain words, short and longer",
  },
};

/**
 * The reader's name for the step: `Glossary`, `Summary › Thread`, `Arc`.
 *
 * **A string, not a `StepName`**, because the record rows draw whatever the
 * server sent, and a server newer than this copy can send a step it has never
 * heard of — `tests/metadata-unknown-stage.test.tsx`. Such a step, or a key
 * like `__proto__`, gets `fallback` (the server's own label) rather than a
 * lookup up the prototype chain.
 */
export function stepName(step: string, fallback: string = step): string {
  const place = ownLabel(STEP_PLACE, step);
  if (place === undefined) return fallback;
  if ("mode" in place) return MODE_LABEL[place.mode];
  if ("sub" in place) return `${MODE_LABEL[place.sub.mode]} › ${subModeWords(place.sub).label}`;
  return place.name;
}

/** One line saying what the step makes; empty for a step this copy does not know. */
export function stepWhat(step: string): string {
  const place = ownLabel(STEP_PLACE, step);
  if (place === undefined) return "";
  if ("mode" in place) return MODE_CATALOG[place.mode].description;
  if ("sub" in place) return subModeWords(place.sub).description;
  return place.what;
}
