# Code review: plan 261001a, stage 4 — a DOI or arXiv id in a PDF's reference entry becomes the row's link

You are GPT Sol. The plan is `docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md`
(§ Stage 4; you reviewed it before). The change is uncommitted in this tree and is entirely in
`docs/plans/261001a-stage-4-code-review.diff`: `src/citations.ts`, `tests/citations.test.ts`,
`docs/project/citations.md`. Context: `docs/project/citations.md` § The one safety property ("every
address a row presents as the work's own was in the article, and code found it") and § Which citation,
and whose entry; `src/citation-reference-list.ts` (how a PDF's numbered entries are split and
dehyphenated); `docs/plans/260930i-citations-mark-the-exact-citation-and-read-the-pdf-reference-list.md`.

The builder's summary:

- A PDF entry (a work with `entryNumber` and `entry`) is now rule-1 entry text in `linkFor`. Exactly
  one DOI → doi.org; no DOI and exactly one arXiv id → arxiv.org/abs.
- `entryIdentifiers`: a DOI ending in `-`, `/` or `_` before a space takes the next run as its
  continuation; a trailing period is stripped; a DOI followed by a space and a lowercase/digit run with
  no colon, or an arXiv id followed by a digit, is treated as possibly cut by a line break, and that
  entry is "unreadable" (the row keeps its Scholar search).
- The stored entry is capped at 400 characters only at write time, so a DOI past the cut is read.
- **Id inheritance, which also changes the HTML path:** a row now keyed by an identifier that finds no
  id under that key takes the id its old work key had — but only if no other row in this run shares
  that work key. Before, a search row becoming a DOI row lost its id (and with it its stored *Look it
  up* find and *Investigate* answer).

Look hardest at:

- whether a wrong DOI can become a row's link, and whether the "unreadable" heuristics are
  conservative enough (a DOI's own hyphen at a line end is lost by `dehyphenate`);
- the id-inheritance change: can it hand one work's id — and so its stored find or investigation —
  to a different work? Think about re-runs where two works swap, where a key existed in the previous
  list, and the block-ids contract (`docs/project/block-ids.md`);
- tests that could not fail.

**You may fix what you find** in these three files only (sandbox workspace-write). Other files in the
tree are being edited by another agent right now; do not touch them. Run `npm run typecheck` (or
`node --import tsx scripts/typecheck.ts` if the socket fails) and the citations test files by path.
Do not commit. Findings as id (C-1 …), severity (P0–P3), evidence file:line, and what you did. End with
a verdict.
