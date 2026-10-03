/**
 * **The paperwork rule, once, for every prompt that writes from the whole piece.** Which prompts
 * carry it and which are exempt, and why, is `PAPERWORK_EXEMPT` below and
 * tests/paperwork-coverage.test.ts (docs/plans/261003d-paperwork-in-every-whole-piece-mode.md).
 *
 * > The structure, summary, tweet thread, and other such modes don't really need to include
 * > summaries of stuff like acknowledgements or conflicts of interest or affiliations or, you know,
 * > stuff like that that isn't really the content of the paper.
 * >
 * > — Greg, 2026-10-01, SPIDERYARN-READING2-8M
 *
 * A prompt interpolates `${paperwork(kind)}` as its own section, beside `plainWords(...)`
 * (src/plain-words.ts), the same way. The list of what counts as paperwork is the shared half, so
 * the next mode that needs it gets the same list rather than another copy; what a prompt does with
 * a paperwork passage is the kind's half, because a summary can leave it out and a table of
 * contents cannot: every block must be covered by a node (src/tree-invariants.ts). Nor can Arc,
 * which owes one sentence per part, so under `"part"` a paperwork part keeps its ordinary
 * sentence about the argument and the sentence never mentions the paperwork. A label was tried
 * first and broke Arc's sentence count (plan 261003d § Ledger).
 *
 * **Paperwork by role, not by label** (GPT Sol's plan review, P1-1). A funder can be part of the
 * argument — a sponsor's role that qualifies the evidence, an ethics constraint that shaped the
 * method — and then it is content. The rule says so rather than listing headings to drop.
 *
 * The model still SEES the paperwork. Taking it out of the article before any model reads it is
 * the deterministic version, deferred in
 * docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md § Deferred.
 */

/** What the prompt does with a passage that is only paperwork. */
export type PaperworkKind =
  /** A summary or a thread: leave it out. */
  | "summary"
  /** A table of contents: the node stays, labelled, and nothing else mentions it. */
  | "structure"
  /** A prompt that picks items out of the piece (questions, quotes, ideas, terms, dates): none from it. */
  | "pick"
  /** One sentence per part, as Arc writes: about the argument, never the paperwork. */
  | "part";

const KINDS: Record<PaperworkKind, string> = {
  summary: `Leave it out: do not summarise it, spend a sentence on it, or present it as
one of the piece's caveats or limits. Name an author only to say who argues
something.`,
  structure: `A range that is only paperwork still gets its node, because every block
must be covered. For a paperwork-only node, as an exception to the gist rules
above, its gist is a short plain label of WHAT it is ("The authors and
where they work.", "Funding and conflict-of-interest statements."), never what
it says, with no word floor and no claim. Leave "question" empty on it, at any
depth. Gists outside that node, the root's included, ignore the paperwork.`,
  pick: `Choose nothing from it alone: every question, answer, idea, quote, term,
person, organisation or date you choose must come from the piece's content.
Someone who appears only in the paperwork — a funder, an institution, a person
thanked — is not part of the piece; someone the content also names is, for what
the content says.`,
  part: `A part that is only paperwork, or opens or closes with it, still gets its one
sentence by the usual rules: where the ARGUMENT stands as that part opens. At
the start, that is what is at stake; at the end, what the piece has settled and
what it has not. It never mentions the paperwork — no sources, data, thanks,
funding, interests, authors or record, where those are only paperwork — and
neither does any other sentence.`,
};

/**
 * **The abstract is not paperwork, and has its own paragraph, in Structure
 * only** (Greg, 2026-09-30, spya-abs6bj: *"title or abstract or references or
 * acknowledgments … maybe they don't need a summary at all, or maybe it's just
 * very brief"*). He was reading Summary's per-section outline, which is
 * Structure's tree today. The abstract is the author's summary of the whole
 * piece, so it is content; what goes is a gist that summarises a summary,
 * which the root and the parts already say. A whole-piece summary may use what
 * the abstract claims, so `"summary"` gets nothing here.
 *
 * **A genuine abstract always; a front summary or key-points box only by
 * role** (GPT Sol's plan review, P1-4): an executive summary or a chapter
 * preview may make claims the body never returns to, and labelling it would
 * lose them at the coarse zoom. A closing "Summary" section is the body.
 *
 * **"Leave it empty", not "send none"**: the whole-document schema requires a
 * depth-1 `question` (src/structure.ts § `depth1Schema`), and `questionFor`
 * reads an empty one as no question (GPT Sol's plan review, P1-1). Plan
 * docs/plans/261003c-summary-and-structure-skip-the-front-matter.md.
 */
const STRUCTURE_ABSTRACT = `The abstract at the START of a paper is the author's own summary of all of
it, and the root and the other parts already say what it says. A node whose
range is only the abstract, or only the abstract and paperwork, gets the
paperwork node's treatment above: a short plain label of what it is ("The
authors' summary of the paper."), no claim, no word floor, and no question
(leave "question" empty). Gists outside that node may still draw on the
abstract. A summary or key-points box at the start is treated the same way
only where the body goes on to make each of its claims; where it says something
the body does not, it is content. A "Summary" or "Conclusions" section after
the body has begun is content, and the usual rules apply.`;

export function paperwork(kind: PaperworkKind): string {
  return `PAPERWORK IS NOT THE PIECE

Around a piece's content there may be paperwork: the title block (the title,
subtitle, byline, dates, DOI, keywords and the journal's header), the list of
authors and where they work, contact and correspondence details,
acknowledgements and thanks, funding and grants, conflict-of-interest and other
disclosures, ethics approval, author contributions, data-availability
statements, the publisher's notices, and, at the end, the reference list or
bibliography and any lists of backlinks or related links. Where it only
identifies the piece or records how it was produced, published and sourced, it
is paperwork.
${KINDS[kind]}

Judge it by what it does, not by its heading. If the piece uses any of these as
evidence, reasoning, method or a limit on its findings — a funder's role that
it says may bias the result, an ethics rule that shaped the study, an article
ABOUT research funding — it is content, and the usual rules apply.${kind === "structure" ? `\n\n${STRUCTURE_ABSTRACT}` : ""}`;
}

/**
 * **Prompts handed the whole article that do not carry the rule, and why.**
 * tests/paperwork-coverage.test.ts fails for a file that calls `articleWithIds(` or `articleText(`
 * and neither calls `paperwork(` nor is listed here. Plan
 * docs/plans/261003d-paperwork-in-every-whole-piece-mode.md § Which modes.
 */
export const PAPERWORK_EXEMPT: Record<string, string> = {
  "src/citations.ts": "the reference list is what it reads; the paperwork is its content",
  "src/citation-investigate.ts": "investigates one citation, which lives in the reference list",
  "src/converse.ts": "chat, Remember and the tutorial answer the reader, who may ask who funded it",
  "src/live.ts": "talks with the reader, who may ask about the authors or the funding",
  "src/explain.ts": "explains the passage the reader chose, which may be the acknowledgements",
  "src/search.ts": "finds what the reader searched for, which may be the funding",
  "src/quiz-mark.ts": "marks the reader's answer to a question Quiz already chose",
  "src/crossrefs.ts": "links one passage to another; a link into the paperwork is rare and harmless",
  "src/crossrefs-fingerprint.ts": "renders the article only to hash it for crossrefs.ts",
  "src/referee-claims-run.ts": "for a peer reviewer, for whom the title's claims are claims",
  "src/referee-criteria-run.ts": "ethics, data availability and conflicts are what a reviewer checks",
};
