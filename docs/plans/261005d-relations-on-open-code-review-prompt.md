# Code review: Marginalia's relation words are made when the column is shown

You are reviewing an uncommitted change in this worktree. Fix what you find inside its scope; report
anything wider for me to decide. Your answer file must end with a verdict line (approve / rework)
and a list of findings with P0 to P3, saying for each whether you fixed it.

## What was asked

Greg, 2026-10-05, answering `[Q-relations-on-import]` in
`docs/plans/261005d-marginalia-out-of-the-experimental-switch.md`:

> generate linking words when Marginalia mode is opened

So the so/but/vs relation words stop being made at import and are made the first time Marginalia is
shown for an article. "Shown" must include an article that opens with Marginalia on by default (the
first-open default, `firstOpenSearch` in `src/web/last-view.ts`), not only a press of the toggle.
Only the owner triggers the paid call; a visitor to a public article sees whatever exists. While
the words are being made the notes are drawn without them and the words appear when ready, with no
reload. No backfill for existing articles: they get theirs on the next open.

Read `docs/project/marginalia.md` § Relation words (already rewritten for this change) and
`docs/project/mode.md` first.

## What I did

- `src/web/useRelations.ts`: `useAutoRun` (press-armed) became `useAutoRunOnArrival` (the rule
  Summary's thread uses, `src/web/useAutoRun.ts`). It takes a new `shown` argument; while false the
  arrival rule is handed `loading`, so nothing is asked until the notes are on screen.
- `src/web/marginalia/MarginaliaColumn.tsx` § `OwnerMarginFeed` takes `shown`;
  `src/web/reader/Reader.tsx` passes `marginRoom` (switched on and `fit.margW > 0`).
- `src/web/activation.ts`: Marginalia's `MODE_TARGET` row went from `fixed: relations` to
  `delegated` answering `null`, so a press mints no token nobody claims, `modeGenerates` stays true
  and `modeStep` is null.
- `src/auto-mode-steps.ts`: `relations` off the import's list. `src/web/auto-modes.ts` comment.
- Comments and reader-facing copy: `src/mode-catalog.ts` (`how`), `auto-run-targets.ts`,
  `rerun-steps.ts`, `last-view.ts`.
- Tests: new `tests/marginalia-relations-on-open.test.tsx` (untracked, so it is NOT in the diff file:
  read it directly); `tests/auto-modes.test.tsx`, `tests/publication-queues-the-main-modes.test.ts`,
  `tests/marginalia-live-refresh.test.tsx`, `tests/artefact-read-hooks.test.tsx` follow.
- Docs: `marginalia.md`, `url-state.md`, `ingest-queue.md`.

The scoped diff is `docs/plans/261005d-relations-on-open-code-review.diff` (or `git diff HEAD`).

## Not verified, and why

**No test, typecheck or build has run on this change.** The box is overloaded and the Overseer has
a heavy-job lock on. **You must not run `npm test`, `vitest`, `npm run typecheck`, `tsc`, a build, a
dev server or a browser.** Review by reading. That makes these the things I most want checked by
eye:

1. **Type errors.** Every caller of `useRelations` and `OwnerMarginFeed` (including test mocks such
   as `tests/helpers/reader-reading-harness.tsx` and `tests/chat-card-host-change.test.tsx`) against
   the new signatures; the `delegated` row's shape against `ModeActivation`.
2. **Tests I have not updated that will now be red.** Grep the whole of `tests/` for anything that
   assumes: a Marginalia press arms `relations` (`pendingActivation`, `armActivationForMode`,
   `MODE_TARGET`, lists of fixed or delegated modes, `tests/pressing-a-chip-arms-it.test.tsx`,
   `tests/every-mode-draws-its-surface.test.tsx`, `tests/command-bar.test.tsx`,
   `tests/command-pick*`), that arriving with `?margin=1` or the first-open default posts no job
   (`tests/first-open-default-wiring.test.tsx`, `tests/last-view.test.ts`, anything mounting the real
   Reader with the margin on as owner), or that the import queues `relations`. Fix them.
3. **Try to break these claims:**
   - a visitor (signed out, or on someone else's public article) can never cause the POST, including
     via `tests/public-network-trace.test.tsx`'s path;
   - one attempt per article per page load: no loop on a failed job, a failed read, StrictMode, or
     `shown` flipping false/true repeatedly as a window is resized;
   - `useAutoRunOnArrival` "relies on the caller being keyed by slug" — is `OwnerMarginFeed`'s
     position in the Reader keyed so that article A's `none` cannot start a job for article B?
   - a stale or outdated list is rewritten once and not on every mount;
   - the job started on arrival is followed to its end by the quiet `useStepJob` so the words appear
     without a reload;
   - an article still mid-import (opened by its owner with the margin on by default before every
     step has published): can the relations job be posted too early, fail, and use up the one
     attempt? Say what happens; fix only if it is small.
4. **Anything else that still says the words are made on import or on a press**: source comments,
   `/help` and `/features` copy, `docs/project/`.
5. **Is `delegated` answering `null` the right row**, or does something read `MODE_TARGET` in a way
   that makes it wrong (the command bar's `generates` marker, the exhaustive switches in
   `activation.ts`)?

## Rules

- Do not invent or attribute words to Greg. The only Greg quotes that may appear are the ones
  already in the diff or the docs.
- Do not touch files outside this change's scope except tests that this change makes red.
- No git commands that discard work; do not commit.
