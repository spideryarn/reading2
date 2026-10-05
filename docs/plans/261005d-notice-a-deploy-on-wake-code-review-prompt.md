# Review and fix: a deploy watcher, a self-reloading /changelog, and a crash on an unknown pipeline stage

Repo: this worktree, branch `worktree-qi-wxt4gtyn-notice-deploy-on-wake`. TypeScript, ESM, React,
Vite, vitest. You may write: fix what is inside this stage, narrowly, with a test seen red first;
report, do not fix, anything wider. Do not commit. Do not touch `src/web/router.ts`, `CLAUDE.md`,
`AGENTS.md` or anything under `docs/reusable/`. Never write a sentence attributed to Greg: the only
quotes of him allowed are ones already in the tree.

## The candidate

Committed: `f87a3ca94` then `0019c8c0c`.
`git diff f87a3ca94^..0019c8c0c`; changed paths: `git diff --name-only f87a3ca94^..0019c8c0c`.

Start with: `src/web/stale-shell.ts`, `src/web/safe-to-reload.ts`, `src/web/unload-guard.ts`,
`src/web/useReloadForNewBuild.ts`, `src/web/Metadata.tsx` § `stageIcon`, and the tests
`tests/stale-shell.test.ts`, `tests/safe-to-reload.test.ts`, `tests/changelog-page.test.tsx`,
`tests/metadata-unknown-stage.test.tsx`. Not the limit of scope: the manifest is.

## What it is meant to do

The plan is `docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md`; what is built
is its § "After GPT Sol's plan review" and § "The unexplained `[render]` crash, found". Your own plan
review is `docs/plans/261005d-notice-a-deploy-on-wake-plan-review-sol.md`; the code is supposed to
answer F1, F2, F4, F5, F6, F7, F9, F10, F11. F3 and F8 are answered by not building the navigation
change at all.

Contracts:

- Production builds only. Never a check started while the document is hidden.
- `/changelog`, and only `/changelog`, reloads itself, only when visible, still on that page, and
  `safeToReload()`; at most once per build identity per session, across both callers of the guard.
- No reload can lose an unsent Chat/Remember draft, a Feedback draft, or an upload in flight, or
  happen while not connected.
- The existing lazy-route recovery (`reloadIfStale`, `LazyPage.tsx`) behaves as before apart from the
  guard being a list.
- A stage name the client does not know draws a row with a neutral icon.

## What I want

1. An independent attack first. Is each contract above true of the code? Reachable paths that
   reload when they must not, or never reload when they should.
2. The tests: could each go red for the defect it names? I ran these and they pass:
   `npx vitest run` over the touched suites (49 files, 1002 tests) and `npm run typecheck`. Run
   `tests/stale-shell.test.ts` and `tests/safe-to-reload.test.ts` yourself (they need nothing
   outside the tree). You cannot run the database suites or a browser; the two-build script's raw
   output (pass, and control failing as it must) is in the plan's stage notes if present, otherwise
   treat it as my claim.
3. The docs changed in these commits (`docs/project/web-client.md`, `docs/project/changelog.md`, the
   postmortem, two feedback notes, the plan): is each statement accurate against the code?
4. Sibling sites of the crash's shape: a `Record<Union, Component>` (or any table) indexed by a value
   that comes off the wire, in eager client code. Report them with file and line; fix only ones that
   are certain and one-line.

Severity: **P0** data loss, exploitable security, incorrect charging, service broadly unusable;
**P1** user-visible wrong behaviour or an authoritative contract violated; **P2** design or
maintainability risk with no wrong behaviour today; **P3** prose. Mark each *established* or
*reasoned*. Number findings from F12 (F1 to F11 are the plan review's). For each: what you did
(fixed, with the test you saw red / reported only). End with one verdict line: ship it / ship it
with the fixes made / do not ship.

## My own suspicions (already mine; spend most of the run elsewhere)

- `ProfileBox.tsx` § `useUnsavedWarning` has its own `beforeunload` and is not a veto.
- The reload list in `sessionStorage` is never trimmed.
- `noteFeedbackDraft` is a module boolean set from an effect; two mounted dialogs would fight.
- A check that began visible and finished hidden.
