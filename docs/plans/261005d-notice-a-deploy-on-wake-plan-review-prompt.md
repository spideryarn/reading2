# Review: a plan to notice a deploy when the app wakes, and to refresh /changelog when a new build is live

Repo: this worktree, branch `worktree-qi-wxt4gtyn-notice-deploy-on-wake`. TypeScript, ESM, a
hand-rolled client router (`src/web/router.ts`), React, Vite. This is a read-only review of a plan;
nothing is built yet. Do not change any file.

## The candidate

Live pre-commit: base `origin/dev` as merged into this worktree (`git rev-parse HEAD`); untracked:
`docs/plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md` (the plan) and this prompt.

Start with: the plan; then `src/web/stale-shell.ts`, `src/web/router.ts` § `navigate` and
§ `watchHistoryWrites`, `src/web/main.tsx`, `src/web/ChangelogPage.tsx`, `src/web/LazyPage.tsx`,
`src/web/offline.ts`, `src/web/useOnline.ts`. Background: the plan it follows,
`docs/plans/261003m-a-home-screen-app-reloads-itself-when-a-page-s-code-has-moved.md`, and the
postmortem `docs/postmortems/261003f-a-home-screen-app-outlives-every-deploy-and-has-no-reload-button.md`.
That is where to begin, not the limit of scope: `navigate()` has about 35 call sites under
`src/web/` and the plan's rule has to be right for all of them.

## What it is meant to do

A copy of the app that has been open across a deploy (an iPad home-screen app lives for days) should
get onto the live build without the reader tripping on anything and without taking a page away from
somebody mid-read. Three parts: a watcher that asks `/build.json` on becoming visible and every 15
minutes while visible; `navigate()` doing a full page load instead of `pushState` when a different
build is known to be live and the destination path differs; `/changelog` reloading itself when a
different build is noticed (a reader asked for exactly that, quoted in the plan).

Invariants it must not break: in-tab navigation between cached articles while offline; no reload
loop under any combination of stale shell / stale `build.json`; no unasked reload of any page but
`/changelog`; nothing at all happens off a build (dev, tests).

## What I want from you

1. An independent attack on the plan first. Is each statement in it accurate against the code? Which
   call sites of `navigate()` does the "push, different path, online" rule get wrong — in either
   direction (a full load that loses something a reader had, or a `pushState` that leaves an old
   copy running when a load was free)? Is there state that survives an in-app navigation today and
   would be lost by a full load (unsent drafts, a running job's progress, an armed jump, the one-shot
   auth return, anything in module memory that a page hands the next page)?
2. Is the watcher's behaviour right for iOS home-screen apps, bfcache restores, and a tab left
   visible for days? Anything about `visibilitychange`/`pageshow`/timers the plan assumes wrongly?
3. Is reloading `/changelog` through the existing once-per-build `sessionStorage` note actually
   loop-free, including when `reloadIfStale`'s note was already spent by a lazy-route reload for the
   same build?
4. Is the proposed test list able to go red for the defects that matter, and is the two-build script
   a real check or a ritual?
5. Is there a simpler design that gets most of the value? Say so if the plan should be reduced.

Severity scale: **P0** data loss, exploitable security, incorrect charging, service broadly
unusable; **P1** user-visible wrong behaviour, or an authoritative contract violated; **P2** design
or maintainability risk with no wrong behaviour today; **P3** prose defect. Mark each finding
*established* (direct evidence, an exact source path) or *reasoned*. Give every finding an ID, F1,
F2, …. End with one verdict line: build it / build it with changes / do not build it.

## My own suspicions (already mine; spend most of the run elsewhere)

- `replace: true` navigations that cross a path: are there any, and should they load?
- `navigator.onLine` as the only offline guard: `src/web/offline.ts` keeps a better `connected` fact.
- A full load from `/add/...` pages or mid-ingest.
- Whether `location.assign` to the same origin while a `fetch` with `keepalive` save is in flight
  loses the save.
