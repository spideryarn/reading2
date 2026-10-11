# Plan review: 261011o, Marginalia's own notes

You are reviewing a plan before it is built, in the Spideryarn repo (read CLAUDE.md for the house
rules). Read-only. The plan is docs/plans/261011o-marginalia-off-the-first-open-and-notes-of-its-own.md;
Stage 1 is already built and committed (commit 301854787) — review Stage 2 mainly, and Stage 1 only
for anything it missed.

Read: src/relations.ts (the step being extended), src/types.ts § Relations, src/web/useRelations.ts,
src/web/marginalia/notes.ts, src/web/marginalia/MarginaliaColumn.tsx, src/web/marginalia/tips.ts,
docs/project/marginalia.md, docs/project/cross-references.md, docs/project/prompting-guide.md,
src/plain-words.ts, and wherever relations is read back (grep `relations` in src/store, src/routes.ts,
src/store/export*.ts, src/sharing-steps.ts).

Questions:
1. Is extending the `relations` call the right shape, versus a separate step? What breaks or gets
   braided (cost tracking, the sparse-answer throw, freshness fingerprint, export, the metadata rerun,
   anything that reads `Relations` and would mis-handle a new field)?
2. The validation and caps: anything missing? Should notes be validated against a quote?
3. The prompt: what should it say so the model writes few, useful notes and finds real
   inconsistencies, without padding? Is `low` effort plausible?
4. The UI: open lines vs shut; anything in the column's layout (collision pass, useMarginLayout)
   that a taller note would trip.
5. Anything else that is wrong, risky, or simpler.

Write findings as a numbered list with severity (P0–P3), each with the file/line and a concrete fix.
End with a one-line verdict: BUILD, BUILD WITH CHANGES, or RETHINK.
