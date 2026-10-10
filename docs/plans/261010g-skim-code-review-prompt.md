# Code review: Skim deeper passes never shorter, and a previous-stop door

You are reviewing, and fixing, the code built from plan
docs/plans/261010g-skim-deeper-passes-always-longer-and-a-previous-stop-door.md (read it, including
its Log, which says how the built rule differs from the planned one: Gist <= More < Most, More may
equal Gist). Your plan-stage review is docs/plans/261010g-skim-plan-review-sol.md. The scoped diff
is docs/plans/261010g-skim-code-review.diff (commit 2a681247b against 262f9f674); the measurement is
docs/investigations/261010a-skim-per-pass-targets-and-walked-growth.md.

Files: src/skim-passes.ts (new, shared), src/skim.ts (targetsFor, passSizes, growthFailure,
growPasses, buildSkim, prompt section 2 / RULES / user message, PROMPT_VERSION skim/12),
src/types.ts (SkimDrops), src/web/skim-route.ts (re-exports), src/web/modes/skim/SkimMode.tsx
(hasPrevious), src/web/SkimPanel.tsx (SkimDoor), src/web/reader/Reader.tsx (afterBlock),
src/web/styles/skim.css, tests/skim.test.ts, tests/skim-panel.test.tsx.

Look hardest for: growPasses correctness (termination; caps, rule 7 and rule 8 still holding after it;
moving into a gap; a moved stop's again; interaction with maxCarried room after moves; whether a
route that passes growthFailure can still show a deeper pass shorter in the client, which uses
skim-passes.ts); growthFailure's fewer-than-8 and gap cases; targetsFor for every q; the prompt
wording vs the rule (contradictions with the rest of SKIM_SYSTEM, e.g. "Depth 3 should..." or
carrying guidance); hasPrevious correctness (carried stop first in a deeper pass, current stop not in
the pass); the door layout/CSS (left/right groups, wrapping, narrow windows); anything that reports
success while doing nothing. Also check nothing else in the repo still assumes cumulative growth or
the old targets (grep scripts/eval, docs, other src).

House rule: FIX what you find inside this change's scope (edit the files, keep tests green:
`npx vitest run tests/skim.test.ts tests/skim-panel.test.tsx tests/skim-route.test.ts` and
`npm run typecheck`). Do not commit. Report anything wider for the author to decide. Do not run git
commands that discard work. Write your answer as numbered findings: severity, evidence (file:line),
what you changed (or why not), and the test results at the end.
