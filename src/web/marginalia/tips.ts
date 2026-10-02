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
 * — a column of dozens of notes costs one Floating UI instance, not dozens. The
 * idea stamp, the path and the arc have cards of their own and read their
 * origin line from here. docs/plans/261002g-marginalia-head-in-plain-words-and-every-note-says-where-it-came-from.md.
 */

import type { Voice } from "../voice.js";

export type MargTipKey =
  | "question-article"
  | "question-part"
  | "faq"
  | "debate"
  | "citation"
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
    what: "A question a careful reader might ask, which this passage answers. Press it to see the words that answer it.",
    how: "From FAQ mode. The question was written by AI; the answer is quoted from the article. It sits beside the first passage that answers it.",
  },
  debate: {
    head: "Debate",
    what: "A page elsewhere on the web that responds to a claim made in this passage, and how it bears on it.",
    how: "From Debate mode. AI searched the web and judged how the page bears on the claim. The quote is the page's own words; where the page had no usable title, AI wrote the headline, in the AI's typeface.",
  },
  citation: {
    head: "Cites",
    what: "A work the article cites, at the first place it does. Press it to see who wrote it and why it is cited.",
    how: "From Citations mode. The title is the work's own; the reason it is cited was written by AI from the article.",
  },
  "comment-own": {
    head: "Your note",
    what: "A comment you left on this passage.",
    how: "Written by you, with the AI's answer under it if you asked for one. All your notes are in the drawer at the foot of the window.",
  },
  "comment-owner": {
    head: "A note",
    what: "A comment the article's owner left on this passage.",
    how: "Written by the person who shared this article, with the AI's answer under it if they asked for one.",
  },
};

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
