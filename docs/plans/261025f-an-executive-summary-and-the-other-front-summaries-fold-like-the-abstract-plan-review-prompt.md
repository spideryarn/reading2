You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, ESM).

The plan: docs/plans/261025f-an-executive-summary-and-the-other-front-summaries-fold-like-the-abstract.md

Read first, for context:
- docs/project/front-and-back-matter.md (what the fold is, the evidence rule)
- src/matter.ts (kinds, labels, `stretchEvidence`, `labelledSection`, `holdStretches`, `combineMatter`, the prompt and schema)
- src/matter-labels.ts (the free label rule; this plan adds a source there)
- src/matter-current.ts (versions, `MATTER_READABLE_VERSIONS`, the read check)
- src/matter-shape.ts, src/matter-step.ts (the closed kind lists held equal)
- src/web/matter-view.ts (`stubLabel`, `stubCount`, `stubWhat`) and src/web/TableView.tsx around line 828
- src/section-ranges.ts
- tests/matter.test.ts, tests/matter-view.test.ts for the existing test style
- scripts/matter-eval.ts (the eval; answers are cached by a hash of the whole request body)

What Greg decided (verbatim answer "B" to docs/user-feedback/questions/q-r8kumx.md): fold a paper's executive summary to a one-line stub like the abstract, and the other front summaries (Key points, Highlights, Significance, Author summary); a row in Structure; the stub says which kind. His warning, via the orchestrator: a body section titled "Key points" or "Highlights" deep in the piece is not front matter. No backfill.

What I want from you, ranked by severity, each with a concrete failure scenario (inputs → wrong fold or crash):
1. Ways the placement rule ("inside the opening window" AND "no non-label heading before it at its level or higher; a paragraph label: no non-label heading before it at all") still folds the article's own prose, or misses the three real cases described in the plan's table. Think about PDF extraction (all headings one level, title as heading, headings missing), HTML journal pages, blogs, newsletters.
2. Ways the extent rule (heading section; paragraph label to next heading / label / numbered section line / Abstract or Keywords line; whole-or-nothing at 1,500 words) folds too much or too little.
3. Whether keeping `summary` out of the model's schema and parser while it is in MATTER_KINDS is sound: does anything else derive from MATTER_KINDS that reaches the request (`matterInput`, `shownHeadings`, `isLabel`, KIND_SCHEMA), so the request would change anyway? Would the model's prompt line "a Significance… box; an executive summary… must stay showing" conflict with the label rule's folds in `combineMatter` (segment kinds taken from the classifier first)?
4. The version bump to matter/4 with matter/3 and matter/2 still readable: sound?
5. The stub label read from the stretch's first block on the client: any way it shows the wrong label or the article's own words?
6. Anything simpler that does the same job.

Write findings only, no code edits. Be specific: file, function, line where it bites.
