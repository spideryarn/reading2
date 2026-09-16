# Code review: where you have spent time reading (260916c)

You are reviewing **built code**, and since 2026-09-09 the house workflow is that you **fix what you
find** inside this change and report anything wider. Work in this worktree only:
`/home/greg/code/spideryarn2/.claude/worktrees/fb41-reading-time-heatmap`. Do not commit, push,
reset, check out or otherwise throw away anything; do not touch any remote database.

## The candidate

Committed on branch `worktree-fb41-reading-time-heatmap`, three commits on top of base `7c39e670`:

- `c1f929d6` — the plan and its review (no code)
- `ec414cb4` — stage 1, server: `git show --stat ec414cb4`
- `f803b076` — stages 2–3, client, display, docs, privacy copy: `git show --stat f803b076`

Diff: `git diff 7c39e670 f803b076` (do NOT use a merge-base range against dev; only these commits are
the candidate). The plan, with the findings of your own plan review folded in, is
`docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md`; your plan
review is `docs/plans/260916c-reading-time-review-sol.md`. Start from `src/web/useReadingTime.ts`,
`src/web/reading-time.ts`, `src/store/pg-reading-time.ts`, the reading-time routes in `src/routes.ts`
(search `READING_TIME_PATTERN`), `src/web/reader/Reader.tsx` (search `proseOnScreen`),
`src/web/Spine.tsx` (search `readRuns`), `src/web/styles/gutter.css` and `spine.css` (search
`reading`), `src/web/PrivacyPage.tsx`. That list does not limit scope.

Evidence already gathered: `npm run typecheck` exit 0; scoped vitest green for
tests/reading-time.test.ts, tests/use-reading-time.test.tsx, tests/spine-reading.test.ts,
tests/reading-time-route.test.ts, tests/spine-here.test.ts, tests/public-network-trace.test.tsx,
tests/db-schema-drift.test.ts, tests/store-export-covers-tables.test.ts,
tests/store-artefact-manifest.test.ts, tests/authenticated-api-route-contract.test.ts,
tests/doc-links.test.ts, tests/privacy-page.test.ts. The full suite has not been run yet. No browser
check yet.

## What to do

1. **First, write your findings** to `docs/plans/260916c-reading-time-code-review-findings-sol.md`
   before changing any code: severity, claim, evidence (file:line), fix.
2. Then fix every P0/P1 and any P2 that is cheap and clearly right, inside this change. Add or adjust
   tests so each fix has a test that would have been red without it. Run the scoped tests you touch
   (`npx vitest run <files>`; never the whole suite — the box is shared) and `npm run typecheck`
   (read its exit code).
3. End your answer with: what you changed (file list), what you did not fix and why, and the test
   commands with results.

Severity by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

## The conclusion I would least like to be wrong about

That this is safe for readers with the switch **off** (the vast majority, and production): no
request, no sampling, no re-render cost, no change to what the reading view draws — and that a
visitor on a shared link can neither read nor write an owner's reading time.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- `useReadingTime`'s effect depends on `[slug, enabled]` only; the flush on cleanup and the `gone`
  flag — any double-send or lost batch across a slug change or StrictMode double-mount?
- `recompute` after the GET merges `server + local`; can a flush that lands before the GET answers
  make the display double-count?
- The `Reader` effect calls `setCounting` but nothing turns it off on unmount; the hook's own cleanup
  is relied on.
- `.blk-gutter::after` — does anything else on `.blk-gutter` already use `::after`, or does the gutter
  hide on touch or narrow widths so the hairline never shows there?
- The POST body limit the server agent added (`MAX_READING_TIME_BODY_BYTES`).
