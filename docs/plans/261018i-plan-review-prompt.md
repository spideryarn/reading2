# Plan review: Marginalia notes that save a click

You are reviewing a PLAN, read-only. Repo root is your working directory (a git worktree at
origin/dev `dc43a4e8e`). Candidate: the untracked file
`docs/plans/261018i-marginalia-notes-that-save-a-click.md` — read it first, in full. No code yet.

The report is from the product owner (admin), so "should we build something" is settled; the
question is whether this is the right simplest version, and how.

Read yourself (do not trust my summary):
- `src/relations.ts` (the whole file: `toNotes`, `noteCap`, `answerTokens`, `RELATIONS_SYSTEM`,
  the schema), `src/types.ts` around `MARGIN_NOTE_KINDS` / `MarginNote` / `MarginNotesDropped`.
- `src/web/marginalia/MarginaliaColumn.tsx` (`AsideNote`, `CitationNote`), `src/web/marginalia/tips.ts`
  (`NOTE_TIPS`), `src/web/marginalia/notes.ts`, `src/web/reader/Reader.tsx` near
  `marginaliaBibliography`.
- `src/web/BibliographyPanel.tsx` `CiteBlurb`; `src/citation-blurbs-identity.ts` `shownBlurb`;
  `docs/project/bibliography.md` on blurbs.
- `docs/project/marginalia.md`, `docs/plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md`
  (the measurement method and results), `evals/margin-notes/run.ts`.
- `docs/project/glossary.md` § Provenance is the label, not a badge; `docs/project/prompting-guide.md`;
  `docs/project/vision.md`.
- The sibling work, not yet on dev, at `/var/tmp/spideryarn-worktrees/fbh5mteu-modes-wider-world/`:
  `docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md` and `src/wider-world.ts`
  (read-only; you may not be able to reach it — say so if not).

Attack independently first:
1. Is a `source` kind inside the relations call the right shape, versus the alternatives the plan
   names, or one it doesn't? Does putting memory-based notes in a call whose other notes are
   "only the article" risk leaking memory into `explain`/`aside`?
2. Is the label (stamp *Source* + a visible muted "from AI's memory" + card) enough to tell a reader
   memory from article, given glossary's precedent and spya-h5mteu's rule?
3. The bar for writing one: operational? Will the model confidently misattribute quotes (a known
   LLM failure)? Is "not when unsure" enough, or should the eval/prompt do more (e.g. ask for the
   attribution only at the level it is sure of: author rather than exact work)?
4. The separate cap: right, or should it share? Effects on `answerTokens`, `budgetFor`, ordering,
   `overCap` accounting, and on the relation words (the 261011o measurement saw words move when notes
   were added).
5. Stage 1: is showing `CiteBlurb` in the margin correct and safe (owner-only, stale bibliography,
   `owned` / `linked` props, layout in a 288px column, the card inside a ShutNote)? Does 261003j's
   rule ("the article's own words about the work and nothing of ours", Greg spya-zmdb7y) forbid it,
   or does Greg's new request override it? Quote what 261003j actually says.
6. The eval: sound per prompting-guide.md? Are the articles right? Is hand-checking attributions
   enough, and what should pass/fail be?
7. Anything forgotten: other places a new kind must be told (export description, help page, tests
   pinning prompt text or kinds, version stamps, plain-words coverage, public DTO).

My suspicions, worth less, last: (a) the visible label may make a 288px margin noisier than worth;
(b) the extra notes may push relation-word agreement down further; (c) a quote's "why they chose it"
is speculation about the author's intent and may be better dropped.

Severity: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or authoritative
contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID (F1, F2…),
severity, evidence (file:line), and a concrete fix. End with one line: APPROVE, APPROVE WITH CHANGES,
or REVISE.
