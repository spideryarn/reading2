/**
 * **The paperwork rule, once, for every prompt that summarises the whole piece.**
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
 * contents cannot: every block must be covered by a node (src/tree-invariants.ts).
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
  | "structure";

const KINDS: Record<PaperworkKind, string> = {
  summary: `Leave it out: do not summarise it, spend a sentence on it, or present it as
one of the piece's caveats or limits. Name an author only to say who argues
something.`,
  structure: `A range that is only paperwork still gets its node, because every block
must be covered. For that node alone, and as the only exception to the gist
rules above: its gist is a short plain label of WHAT it is ("The authors and
where they work.", "Funding and conflict-of-interest statements."), never what
it says, with no word floor and no claim. Send no "question" on it, at any
depth. Every other gist, the root's included, ignores it.`,
};

export function paperwork(kind: PaperworkKind): string {
  return `PAPERWORK IS NOT THE PIECE

Around a piece's content there may be paperwork: the list of authors and where
they work, contact and correspondence details, acknowledgements and thanks,
funding and grants, conflict-of-interest and other disclosures, ethics
approval, author contributions, data-availability statements, and the
publisher's notices. Where it only records how the piece was produced and
published, it is paperwork.
${KINDS[kind]}

Judge it by what it does, not by its heading. If the piece uses any of these as
evidence, reasoning, method or a limit on its findings — a funder's role that
it says may bias the result, an ethics rule that shaped the study, an article
ABOUT research funding — it is content, and the usual rules apply.`;
}
