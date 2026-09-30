# Code review: 260930f (Illustrated diagram draws on the paper's own figures)

You are GPT Sol, reviewing the CODE built from a plan you already reviewed. Repo: Spideryarn
(TypeScript, ESM). You may edit files to FIX what you find inside this change's scope; report
anything wider for me to decide. Do not commit. Do not run the full test suite (the box is shared);
run scoped tests only, e.g.
`npx vitest run tests/illustrated-plate.test.ts tests/illustrated-figures.test.ts tests/illustrated-run.test.ts tests/illustrated-pg.test.ts tests/illustrated-step-registration.test.ts`
and `npm run typecheck`.

Read first:
- docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md — the plan as built, your
  plan-review findings and what was done with each (including one declined, with the reason:
  finding 4, `postgresBlobStore`).
- docs/plans/260930f-illustrated-diagram-draws-on-the-paper-figures-review-sol.md — your plan review.
- docs/plans/260930f-code-review.diff — the code change (commit 346fb5d0).
- evals/results/illustrated-figures-260930/README.md — two real runs and a probe, and what they
  showed (including the change of design after run 1: a plate's figures are now the labels its
  composition names).

The claims to try to break:
1. An article with no stored figures sends byte-identical brief and image requests to before, and
   its fingerprint is unchanged (so no existing illustration goes stale).
2. A paper whose stored figures change or arrive after painting reads stale at all three freshness
   sites (step stamp, `illustratedIsCurrent`, `loadIllustrated`) — and the three compute the same
   figures string.
3. Every figure a plate's composition names is either attached or faulted; nothing a model writes
   decides which object is sent or which block it claims.
4. The references array order and the envelope's "Image N" numbering always agree, including when
   the style plate is absent (first plate failed) or a figure lookup misses.
5. No request can exceed the per-plate figure byte budget; unreadable bytes never fail the step.
6. Also check: the regex `\bFIGURE [A-Z]\b` over a composition — false positives/negatives that
   matter; stored-artefact reading of `figures`; anything logged that is article prose (logging
   captions is forbidden); the cross-block duplicate-ref rule.

Write your findings as your final answer: each with P0/P1/P2, file:line evidence, and whether you
fixed it (and how). Say plainly if you found nothing at a level.
