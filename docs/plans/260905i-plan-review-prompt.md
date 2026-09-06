# Review: the plan for lazy-loading Admin and Design out of the reader's bundle

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes`, branch
`worktree-a4-lazy-secondary-routes`. TypeScript + ESM, React 19, Vite 8 (rolldown), no router
library — routing is a `Route` union in `src/web/router.ts` dispatched by `if` chains in
`src/web/App.tsx`. This is a **plan review, before any code is written.**

## The candidate

Live pre-commit; base `6eecb377f24d92446086a006d5b3103daae40aef`.
Untracked, and the whole candidate:

- `docs/plans/260905i-lazy-load-admin-and-design-routes.md` — the plan under review
- `docs/plans/260905i-plan-review-prompt.md` — this file

No source file has been modified. A measurement spike was run and reverted; `git status` is clean
apart from the two files above.

Start with the plan doc. Its parent brief is
`docs/plans/260905e-main-app-architecture-review.md` § **A4** (around line 297) and the checklist
under `## Implementation stages and handoff` → `### Stage: Cut secondary-route startup cost`
(around line 600). **That brief is the authority; the plan is only my reading of it.** Also in
scope: `src/web/App.tsx`, `src/web/main.tsx`, `src/web/boot.tsx`, `src/web/params.ts`,
`src/web/admin-columns.tsx`, `src/web/AdminPage.tsx`, `src/web/DesignPage.tsx`,
`src/web/AppBoundary.tsx`, `vite.config.ts`, `tests/cold-start-lazy-imports.test.ts`,
`tests/client-imports.test.ts`, `tests/offline-remount.test.tsx`.

## What it is meant to do

Put `/admin` and `/design` behind `React.lazy` so their code is not in the graph a reader downloads
to read an article — with a local loading surface, a local error surface and an escape back to
reading — and change nothing else.

Invariants it must not break:

- **Reader, shelf and mode code stay eager.** Cached JSON cannot make an unloaded chunk execute, and
  in-tab offline navigation plus first activation of a cached mode after a remount must keep working
  (`tests/offline-remount.test.tsx`).
- Session services (`useSession`, `useJobSession` in `App`) stay mounted above the fallback.
- No URL or mode ID renames. No production schema/data/API change.
- The admin *gate* is the server's, on `/api/admin/`. Nothing here may be read as making the client
  split a security boundary.

Deliberately out of scope: Profile, Add and the marketing pages; mode/panel splitting; vendor or
manual chunk configuration; service worker / PWA.

Measured facts the plan rests on (I ran these; raw evidence is the plan's table):

- Baseline emitted JS: `main-*.js` 1,490.90 kB (gzip 449.14) + entry `index-*.js` 21.50 kB
  (gzip 8.38).
- Stub spike, Admin+Design replaced by `() => null`: 446.14 kB gzip total, i.e. a **ceiling** of
  11.4 kB gzip / 2.5%.
- Stub spike, *every* secondary route stubbed: 420.76 kB gzip, a ceiling of 8%.

## What you can and cannot run

The tree is read-only; `/tmp` and the npm caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything needing
Postgres, the dev server or a browser will fail — those are mine to run.

## Attack it

Independently, before you read my questions below.

The invariants to try to break: (a) that this plan's steps actually remove Admin and Design from the
eager graph — the review's own warning is that moving an import while another eager import remains
changes nothing, and the build already prints `INEFFECTIVE_DYNAMIC_IMPORT` for
`src/web/lib/supabase.ts` as proof; (b) that nothing in the plan degrades offline reading or the
signed-in shelf; (c) that the plan's measurement scheme could produce a number that is wrong in the
flattering direction.

For each finding give:

- an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
- (b) the smallest change that closes it — exact replacement wording or a code block

A finding with no (a) goes last.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. **Is 2.5% enough to build at all?** The brief explicitly permits closing the stage as deferred.
   I decided to build, on the grounds that the durable deliverable is the graph test rather than the
   bytes. Argue the other side if you think it is stronger.
2. **The `ADMIN_DEFAULT_BY` move.** `params.ts` (eager) imports it from `admin-columns.tsx` (497
   lines of admin table). I plan a new one-constant module `src/web/admin-sort.ts`. Is there a
   better existing home that does not create a cycle? Is there a *second* such edge I have missed
   between the eager graph and Admin or Design — I only grepped for the obvious ones.
3. **The graph test.** I intend to walk static imports from `src/web/main.tsx` textually, like
   `tests/cold-start-lazy-imports.test.ts` does over the emitted API bundle. Over **source** rather
   than an emitted bundle, is that a test that can pass while the property is false — re-exports,
   `import type` erased at build time, path aliases (`@/components/...`), `.js`-suffixed TS
   specifiers, dynamic imports inside otherwise-eager modules?
4. **Time-to-readable-prose.** I plan to measure it under `npx vite preview` on this box with
   Playwright. Is a local preview server, where the chunk arrives in ~0 ms, capable of showing the
   difference this change makes at all — and if not, what should the acceptance number be instead?

Do not change any file.
