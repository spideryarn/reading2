# Narrow check: are F12, F18 and F19 closed by commit 3aa01bf31?

Repo: this worktree. Read-only: change no file. This is not a new review; discovery is closed. It
is a check of three fixes that were made after your code review
(`docs/plans/261005d-notice-a-deploy-on-wake-code-review-sol.md`) and so were not in its snapshot.

## The candidate

Committed: `3aa01bf31`. `git diff 0019c8c0c..3aa01bf31`. That range also holds your own fixes
(F13 to F17), which are not the subject, except for one line of F15 that I changed:
`useReloadForNewBuild.ts` now tests `parseRoute(window.location.pathname).kind === "changelog"`
rather than the literal path.

- **F12** — `src/web/useAutosavedText.ts` (search `releaseLeaveHold`), `src/web/unload-guard.ts`
  (reasons `upload` and `unsaved`), `src/web/safe-to-reload.ts` (the `unsaved` veto),
  `src/web/ProfileBox.tsx` § `useUnsavedWarning`, and `tests/autosaved-text.test.tsx` (two new cases,
  and the `afterEach` that settles outstanding saves).
- **F18** — `src/web/stale-shell.ts` § `reloadIfStale` (`deps.safe`), `tests/stale-shell.test.ts`.
- **F19** — `src/web/lib/table-sort.ts`, `tests/table-sort.test.ts`.

## The statements to check

For each, answer **closed** or **still open**, with the exact path if open:

1. F12: from the moment a box using `useAutosavedText` unmounts with text the server does not have
   and an older save in flight, until that text has been handed to `leave`, `safeToReload()` is
   false; and the hold is always released afterwards (success, failure, `abandon`, `seed`), so it
   cannot become a permanent veto or a permanent `beforeunload` warning. A save that never settles
   holds for as long as it does not settle; that is intended.
2. F12: no path where the hold is taken twice for one hook instance or released for the wrong one.
3. F18: `reloadIfStale` does not reload, and does not spend the session's note for that build, when
   `safeToReload()` is false; behaviour is otherwise as before.
4. F19: `sortingFromUrl` accepts own keys of `natural` only.
5. The F15 edit does not reintroduce the defect F15 named.

You can run `tests/autosaved-text.test.tsx`, `tests/stale-shell.test.ts`, `tests/table-sort.test.ts`
and `tests/safe-to-reload.test.ts`; they need nothing outside the tree. I ran them, with
`tests/changelog-page.test.tsx`, `tests/lazy-page.test.tsx`, `tests/feedback-dialog.test.tsx` and
`tests/metadata-unknown-stage.test.tsx`: 264 tests pass, and `npm run typecheck` passes.

Severity scale as before (P0 to P3, established or reasoned). Do not number new findings unless one
of the five statements is false; if you notice something outside them, one line under "Noticed".
End with one line per statement and a verdict: closed / not closed.
