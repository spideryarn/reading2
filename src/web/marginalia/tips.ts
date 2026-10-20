/**
 * **What each note in the margin is, and where it came from** — the words of
 * every card in Marginalia, in one table.
 *
 * Greg, 2026-10-01 (spya-atv4nx): *"I can't tell what that Annotation is from
 * or why or whether AI-generated … Make sure all annotations have rich
 * tooltips (see tooltips.md) explaining their origin."* So each card is
 * `ControlTip`'s shape: `what` is what a reader could guess from the note; `how`
 * is what they could not — which mode made it, who wrote the words (AI, the
 * author, the reader), and why it sits beside this passage.
 *
 * The shut lines and questions carry only their key, as `data-marg-tip`, and
 * the reading view's one delegated card draws them (BlockLinkCard.tsx § MARG_NOTE)
 * — except a *Cites* line, whose card has been the prose's own `CiteCard`
 * since 2026-10-20 (plan 261020g), so it has no row here
 * — a column of dozens of notes costs one Floating UI instance, not dozens. The
 * idea stamp, the path and the arc have cards of their own and read their
 * origin line from here. docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md.
 */

import type { DrawnRelation } from "./notes.js";
import type { Voice } from "../voice.js";
import type { MarginNoteKind } from "../../types.js";

export type MargTipKey =
  | "question-article"
  | "question-part"
  | "faq"
  | "timeline"
  | "reception"
  | "comment-own"
  | "comment-owner";

export type MargTip = { head: string; what: string; how: string };

export const MARG_TIPS: Record<MargTipKey, MargTip> = {
  "question-article": {
    head: "The article's question",
    what: "The question the whole article sets out to answer.",
    how: "Written by AI when the article's structure was built. It sits beside the opening so you can read with it in mind.",
  },
  "question-part": {
    head: "This part's question",
    what: "The question this part of the article answers. Read on to find the answer.",
    how: "Written by AI when the article's structure was built. It sits beside the part's first paragraph.",
  },
  faq: {
    head: "FAQ",
    what: "A question a careful reader might ask, which this passage answers. Press this line to open it and see the words that answer it.",
    how: "From FAQ mode. The question was written by AI; the answer is quoted from the article. It sits beside the first passage that answers it.",
  },
  timeline: {
    head: "When",
    what: "Something the article says happened, with the date it gives. Press this line to open it and see the words that mention it.",
    how: "From Timeline mode. The short description was written by AI; the date comes from the article's words. A missing year can come from its publication date, or be assumed from a year stated elsewhere in it and marked 'year assumed'. A phrase in quotation marks is the article's own. A dated event sits beside the passage that dates it; the article's own relative wording sits beside its first surviving mention.",
  },
  reception: {
    /* "Debate" until 2026-10-09, when Debate became Sources' Reception
       and Claims (plan 261009l): the stamp says what the line is, in the
       mode's frame, rather than a mode name that has gone. */
    head: "Others say",
    what: "A page elsewhere on the web that responds to a claim made in this passage, and how it bears on it.",
    how: "From Sources' Claims. AI searched the web and judged how the page bears on the claim. The quote is the page's own words; where the page had no usable title, AI wrote the headline, in the AI's typeface.",
  },
  "comment-own": {
    head: "Yours",
    what: "What you left on this passage, each saying which it is: a Comment (no AI), a Comment + AI (you also asked the AI), or a Question (you asked the AI with ? or Chat about this).",
    how: "Written by you. All of them are in the Comments drawer at the foot of the window.",
  },
  "comment-owner": {
    head: "A note",
    what: "A comment the article's owner left on this passage.",
    how: "Written by the person who shared this article, with the AI's answer under it if they asked for one.",
  },
};

/** Where a relation word came from: the same for all of them. */
const RELATION_ORIGIN =
  "Written by AI, which read each paragraph against the one before it. Made for Marginalia. Only the turns in the argument are marked; most paragraphs carry on in the same direction and get no word.";

/**
 * **What each relation word means**, in a card of its own on the word (a
 * button, so a keyboard or a finger can ask). The word is the answer; this is
 * the sentence. `Record` over the drawn set, so drawing a new word without
 * saying what it means is a type error.
 */
export const RELATION_TIPS: Record<DrawnRelation, MargTip> = {
  therefore: {
    head: "So",
    what: "This paragraph draws its conclusion from the one before it.",
    how: RELATION_ORIGIN,
  },
  but: {
    head: "But",
    what: "This paragraph pushes back on what you just read.",
    how: RELATION_ORIGIN,
  },
  contrast: {
    head: "Versus",
    what: "This paragraph sets something against what came before, without denying it.",
    how: RELATION_ORIGIN,
  },
};

/** Where a margin note came from: the same for all four kinds. */
const NOTE_ORIGIN =
  "Written by AI for Marginalia, in the same reading that marks the turns in the argument. It writes a note only where it thinks one would help, so most passages have none. It can be wrong: read the passage.";

/**
 * **What each kind of note is**, on its stamp (plan 261011o). `Record` over
 * the kinds, so a fifth kind without a card is a type error. `stamp` is the
 * word drawn in the margin.
 */
export const NOTE_TIPS: Record<MarginNoteKind, MargTip & { stamp: string }> = {
  tension: {
    stamp: "Tension",
    head: "Tension",
    what: "This passage seems not to fit with another part of the article. Follow the link to read the other passage and judge for yourself.",
    how: NOTE_ORIGIN,
  },
  recall: {
    stamp: "Recall",
    head: "Recall",
    what: "A reminder of what another part of the article said, which this passage leans on. Follow the link to read it.",
    how: NOTE_ORIGIN,
  },
  explain: {
    stamp: "Note",
    head: "Note",
    what: "A short explanation of something in this passage that is easy to stumble on.",
    how: NOTE_ORIGIN,
  },
  aside: {
    stamp: "Note",
    head: "Note",
    what: "A short note the AI thought would help at this point in the article.",
    how: NOTE_ORIGIN,
  },
  /* Greg, spya-w99qsz: "where does that come from". The one kind not from the
     article, so its card says so first, and the note says it too (plan
     261018i, Sol F2). Not "Source": that could read as a source consulted. */
  source: {
    stamp: "Origin",
    head: "Origin",
    what: "Where a quotation, an allusion or a name in this passage comes from, which the article itself does not say.",
    how: "Written by AI for Marginalia from what it already knows, not from the article, and nothing has checked it. Treat it as a lead to follow, not a fact.",
  },
};

/** The words after an origin note's text: whose they are, and that nothing checked them. */
export const SOURCE_NOTE_LABEL = "AI memory, unchecked";

export function isMargTipKey(key: string | null): key is MargTipKey {
  return key !== null && Object.hasOwn(MARG_TIPS, key);
}

/** The idea stamp's origin line, under its statement and provenance. */
export const IDEA_ORIGIN =
  "From Ideas mode, written by AI. It sits where the idea first appears in the article.";

/** The head's cards: what the path and the arc are, and who wrote them. */
export const PATH_ORIGIN: Record<Voice, string> = {
  author: "Where you are: the part, then the section. This is the author's own heading.",
  ai: "Where you are: the part, then the section. AI wrote this title, from the article's structure.",
  reader: "Where you are: the part, then the section. You gave it this title.",
  ui: "Where you are: the part, then the section.",
};
export const ARC_ORIGIN =
  "Where the argument has got to by this part: one sentence per part, written by AI from the whole article.";
