# Code review: several Skim briefs, stages 3 and 4

Reviewed commit `626998085` and the stage-4 working-tree picker on 2026-10-27. I fixed every finding below, with a failing regression first.

## Findings

- **D1 — P1 — fixed.** *New brief* minted its id inside each transport attempt. If the POST landed but its reply and the reconciliation read were both lost, the visible Retry minted another id and created a second brief. The logical action now owns one id across retries, and the hook confirms an ambiguous write from the owner-only list before failing it. Evidence: `src/web/SkimBriefPicker.tsx:211-218`, `src/web/SkimPurpose.tsx:409-417`, `src/web/skim-briefs.ts:143-174`; regression: `tests/skim-panel.test.tsx:2974-3002`.

- **D2 — P1 — fixed.** An added-brief PATCH whose reply was lost was reported as unsaved even when the server had stored it, so the requested re-plan never happened. Create and Edit now reconcile the exact id and sentence from the list; only an unconfirmed write is reported as a failure. Evidence: `src/web/skim-briefs.ts:143-189`; regression: `tests/skim-panel.test.tsx:3061-3080`.

- **D3 — P2 — fixed.** `POST /api/jobs/:id/advance` returned raw `Advanced.job`, unlike the create and poll routes. A Skim job's rendered `profile` contains the private brief sentence, so the owner-only browser wire received that sentence along with `ownerId` and `illustrationNote`. This was not a visitor or cross-owner leak, but it violated the job-wire projection. The route now applies `publicJob`, retaining only the opaque `skimBrief` id. Evidence: `src/routes.ts:14857-14869`; regression: `tests/job-advance-public.test.ts:18-68`.

- **D4 — P0 — fixed.** The route-keyed `SkimRouteBand` remount destroyed typed default-purpose, added-brief Edit, and New-brief drafts on Back/Forward. These are reader words, so silent loss is P0. Drafts and the submitted/busy fence now live in `SkimBand`, above the key; a revisited in-flight box is disabled rather than sending a second write. Evidence: `src/web/modes/skim/SkimMode.tsx:250-329`, `src/web/SkimPurpose.tsx:86-103,294-375,392-448`; regressions: `tests/skim-panel.test.tsx:3083-3156,3183-3197`.

- **D5 — P1 — fixed.** A visitor ignored `?brief=` itself but still applied that private route's `?stop=` and `?depth=` to the public default route. Clearing the query in an effect was not enough: restoring Reader's original arrival mailbox on the next render still scrolled to the rejected stop. The visitor now masks the whole tuple and arrival from the first render, then clears all three parameters in one replace. Evidence: `src/web/modes/skim/SkimMode.tsx:611-629,642-678,757-776`; regression: `tests/skim-figures.test.tsx:356-363`.

- **D6 — P1 — fixed.** Async writes completed below the same keyed remount. A late Create unconditionally switched away from the route reached by Back, while a late Edit saved but skipped its re-plan. Late completions now leave navigation alone and carry a pending `plan`/`ensure` intent until the affected route is next chosen; the pending action is preserved rather than cleared by that choice. Evidence: `src/web/SkimPurpose.tsx:328-360,409-434`, `src/web/modes/skim/SkimMode.tsx:297-307`; regressions: `tests/skim-panel.test.tsx:3159-3251`.

## Checks and claims that held

- `writesStep` scopes only `skim`; a brief job's Quotes and Ideas remain Quotes' and Ideas' ordinary jobs. The band, completion callback, Metadata row, command bar and Retry paths do not cross default/brief progress or failure.
- Rewrite holds are keyed by `(slug, step, brief)`, so a route switch neither releases nor inherits a hold. The command bar continues to address the default hold.
- The automatic run is disabled for every added brief.
- An added brief's 404 remains an error; only the default route treats 404 as the empty state.
- The picker still creates/switches/plans once on the ordinary path, deletes the current brief back to default, re-plans the correct route from Edit, enforces 12 briefs, uses the shared control styles, fits the phone width, and keeps keyboard/touch behavior.
- The local list overlay retains writes across an older in-flight read and retires them only after a later read; deletion remains an ordered `gone` change and is not resurrected.
- The sentence remains owner-only. Visitors receive no brief list or sentence; job requests carry the opaque id, not the sentence. The model prompt necessarily receives the owner's requested sentence to plan that route.

## Verification

- `tests/skim-panel.test.tsx`: 157 passed.
- Seven supporting suites (`skim-figures`, `skim-briefs-client`, `job-advance-public`, `skim-purpose-line`, `read-error-matrix`, `stale-notice-every-mode`, `chat-delete-live-turn`): 264 passed.
- Hold/job suites: 457 passed, 18 skipped.
- Typecheck: all five TypeScript projects passed; all 4,057 source files were covered. `npm run typecheck` itself could not open tsx's IPC socket in this sandbox (`EPERM`), so I ran the same checked-file script as `node --import tsx scripts/typecheck.ts`.
- Focused hook dependency lint and `git diff --check`: passed. The repository's broader lint invocation still reports existing baseline findings outside this change.

Not run here: `npx vitest run tests/skim-briefs-pg.test.ts`, which needs the Postgres lane.
