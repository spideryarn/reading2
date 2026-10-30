Code review of commit 1d3f1317c (`git show 1d3f1317c`), built from the plan
docs/plans/261029h-the-margin-button-starts-the-literature-search.md after your plan review
(docs/plans/261029h-plan-review-sol.md; the plan's § What GPT Sol's plan review changed says how each
finding was taken).

The rule being implemented (Greg's option A on q-sxfwqq): the first press of the margin button on an
article starts Sources' literature search (`situate`) if none is stored. A reload, a pasted link, Back
/ Forward, or arriving at an article whose margin was already on must not spend. Owner only; a
view-as tab spends nothing.

Read the diff and the code around it: src/web/useWhereAutoRun.ts, src/web/marginalia/MarginaliaColumn.tsx
§ SituateMarginFeed / OwnerMarginFeed, src/web/activation.ts § MODE_TARGET.marginalia and modeStep,
src/web/auto-run-targets.ts, src/web/useSituate.ts, src/web/useAutoRun.ts, src/web/Dock.tsx §
useActivateMode, src/web/reader/Reader.tsx (the OwnerMarginFeed mount), and the tests
tests/margin-press-starts-the-search.test.tsx and tests/every-mode-draws-its-surface.test.tsx.

Look especially for: any non-press path that now spends; a press that should spend and does not
(e.g. the `searching` gate holding a press forever if a job is visible but never progresses, or a
failed job); whether `starting` or `job` from useSituate in quiet cadence is reliable enough for the
gate; StrictMode; the narrow-window `enabled` drop; the owner.bibliography object passed into the
feed (identity churn, stale status inside the ensure closure); the "quiet" cadence missing a job
started by another tab; docs (sources.md, marginalia.md, help pages) that now say something untrue.

You may fix what you find inside this change (red test first where it is a behaviour bug). Do not
commit. Write your findings, each with an id, severity (P0–P3), evidence (file:line), and what you
changed or what you recommend, to the output file. Say plainly if you find nothing serious.
Note: model calls from this box fail until 1 November (OpenRouter key over its limit), so test only
against the mocked tests; run `npx vitest run <files>` and `npm run typecheck`.
