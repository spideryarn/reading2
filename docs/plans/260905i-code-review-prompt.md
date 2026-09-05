# Review: Admin and Design moved behind React.lazy, and the test that holds the boundary

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/a4-lazy-secondary-routes`, branch
`worktree-a4-lazy-secondary-routes`. TypeScript + ESM, React 19, Vite 8 (rolldown), no router
library — routing is a `Route` union in `src/web/router.ts` dispatched by `if` chains in
`src/web/App.tsx`. You reviewed the **plan** for this work earlier today; that review is
`docs/plans/260905i-plan-review-sol.md` and this is the code built from it.

## The candidate

Live pre-commit; base `6eecb377f24d92446086a006d5b3103daae40aef`.
*(Not durable — another agent editing one of these paths changes what "the candidate" means. I will
write the resulting commit SHA into this file once it lands.)*

Modified:

    src/web/App.tsx
    src/web/params.ts
    src/web/admin-columns.tsx
    src/web/AdminPage.tsx
    src/web/log-buffer.ts
    src/web/router.ts
    tests/admin-only-routes.test.tsx
    docs/project/admin.md
    docs/project/web-client.md

Untracked (a pathspec cannot name these, so here they are explicitly):

    src/web/LazyPage.tsx                        <- new
    tests/eager-client-graph.test.ts            <- new
    tests/lazy-page.test.tsx                    <- new
    scripts/measure-startup.ts                  <- new (measurement harness only)
    docs/plans/260905i-lazy-load-admin-and-design-routes.md
    docs/plans/260905i-plan-review-prompt.md
    docs/plans/260905i-plan-review-sol.md
    docs/plans/260905i-code-review-prompt.md    <- this file

Deleted: `scripts/client-eager-graph.ts` (an earlier hand-rolled character-scanning version of the
graph walk; replaced by the AST test, per your F4).

`git diff HEAD -- <paths>` for the modified set. Start with **`src/web/LazyPage.tsx`** and
**`tests/eager-client-graph.test.ts`** — that is where to begin, not the limit of scope; the manifest
above is.

## What it is meant to do

`/admin`, `/admin/users`, `/admin/feedback` and `/design` load their code when somebody asks for the
address instead of arriving in every reader's first download. Nothing else moves.

Invariants:

- **Reader, shelf and mode code stays eager.** Cached JSON cannot make an unloaded chunk execute;
  in-tab offline navigation and first activation of a cached mode after a remount must keep working.
- Session services (`useSession`, `useJobSession`, both called at the top of `App`) stay above the
  fallback.
- **The split changes startup cost, not authorisation.** `/api/admin/*` is still gated by the
  server; the chunk is a public asset with no auth in front of it; the addresses still answer 200.
- No URL or mode ID renames, no schema/data change, no new dependency, no `vite.config.ts` change.

The plan is `docs/plans/260905i-lazy-load-admin-and-design-routes.md`; its stage 2 is what was built.

## What your plan review asked for, and what happened

| ID | Your finding | What was done |
|---|---|---|
| F1 | `lazy(() => import(…))` cannot render these modules — no default export | Four module-scope named-export loaders in `App.tsx`; all four routes tested end to end in `tests/admin-only-routes.test.tsx` |
| F2 | A rejected `React.lazy` re-throws forever, so remounting is not a retry | `LazyPage` builds a fresh lazy type per attempt and keys the boundary `${routeKey}:${attempt}`; tested by rejecting the first call and resolving the second |
| F3 | Record the **emitted** graph, not a source graph | `vite build --manifest` before and after; results in the plan doc. Source closure kept as the durable guard |
| F4 | The source-graph test was underspecified and could pass falsely | Rewritten AST-based on the repo's existing `tests/helpers/ts-ast.ts`, with positive controls and fail-closed resolution |
| F5 | Unpaired before/after timing can invent a delta | Bytes are the acceptance number; time reported as "unchanged within noise" with the measured spread quoted |
| F6 | `admin-sort.ts` unnecessary; `params.ts` is the home | Done as you said; no new module |
| F7 | The local boundary would swallow chunk failures | `captureClientFailure(err, { boundary: "lazy-route" })` + a message-free `recordLog`, reported once |
| F8 | Six comments and three doc passages become false | Corrected in `router.ts`, `App.tsx`, `tests/admin-only-routes.test.tsx`, `docs/project/admin.md`; the security rule preserved |

## The measured result, so you can attack the claim as well as the code

Emitted, `npm run build`:

| | before | after |
|---|---:|---:|
| `index-*.js` | 21.50 kB (gzip 8.39) | 21.57 kB (gzip 8.43) |
| `main-*.js` | 1,490.90 kB (gzip 449.14) | 1,101.82 kB (gzip 336.72) |
| `supabase-*.js` | 0.06 kB husk, never requested | 210.46 kB (gzip 54.76), **statically** imported by main |
| `useNow-*.js` | — | 145.30 kB (gzip 50.74), **statically** imported by main |
| `AdminPage-*.js` | — | 19.70 kB (gzip 6.13), dynamic |
| `DesignPage-*.js` | — | 19.24 kB (gzip 6.36), dynamic |
| **initial JS, gzip** | **457.53 kB** | **450.65 kB** |

So the reduction is about **6.9 kB gzip, 1.5%**, not the 11.4 kB the deletion spike suggested —
rolldown hoisted what `main` now shares with the two lazy chunks into two new shared chunks, and
four chunks compress worse than one. The initial request count goes 2 → 4. The
`[INEFFECTIVE_DYNAMIC_IMPORT] src/web/lib/supabase.ts` warning is gone from the build.

Manifest after: `src/web/main.tsx` has `dynamicImports: ["_supabase-*.js", "src/web/AdminPage.tsx",
"src/web/DesignPage.tsx"]`, and both pages are `isDynamicEntry: true` and in no chunk's static
`imports`.

Baseline network trace (24 runs, 5 entry points, 2 auth states, cache disabled): initial requested
JS was **454,911 wire bytes, identical in every single run**. Time-to-readable-prose on the same
unchanged build ranged 2,505–10,984 ms depending on box load, so the timing cannot see a 1.5%
byte change and is reported descriptively only.

## What you can and cannot run

The tree is read-only; `/tmp` and the npm caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and build a
throwaway harness under `/tmp`. **`tests/eager-client-graph.test.ts` and `tests/lazy-page.test.tsx`
both need nothing outside the tree — please actually run them.** You have no network, not even
loopback, so anything needing Postgres, a dev server or a browser will fail; those are mine.

Gates I ran, with real results:

- `npm run typecheck` — green, all three projects, 1,361 files.
- `npm test` — 713 files, 709 passed, 1 skipped, **3 failed**: `tests/admin-store.test.ts`,
  `tests/hierarchy-deepen-wave.test.ts`, `tests/shelf-action-tooltips.test.tsx`. All three pass when
  re-run alone (`Test Files 3 passed`); they went red because a subagent was running its own
  `npm test` against the same local Postgres at the same moment.
- `npx biome check` on the touched files — the three new files are clean; four findings in
  `App.tsx` are at lines 1445–1645, nowhere near this change, and predate it.

## Attack it

Independently, before you read my questions below.

The invariants to try to break, in this order:

1. **The boundary is real.** Is there any remaining eager path from `src/web/boot.tsx` or
   `src/web/main.tsx` to admin or design code? Your own F4 census found none *after the intended
   three removals* — this is the code that made them, so check it made them.
2. **The guard cannot pass while the property is false.** `tests/eager-client-graph.test.ts` is the
   durable half of this work. Can you make it green on a tree where the property does not hold?
   Re-exports, path aliases, `.js`-suffixed TS specifiers, index resolution, decorators, `export *`,
   a file it never reaches, a recovered parse, a resolution it treats as external when it is local.
3. **The retry.** `LazyPage` is the thing your F2 was about. Does the memo actually produce a fresh
   lazy type on each attempt? Does the route key clear a failure in every order of route changes,
   including retry-then-switch and switch-then-retry?
4. **Nothing got worse for a reader.** Anything in this diff that could affect the reading route,
   the shelf, offline behaviour, or what a non-administrator can see.

For each finding give:

- an ID (continue from F8 — the next new one is **F9**; reuse an old ID only for the same finding),
  a severity (P0/P1/P2/P3), and whether it is **established** or **reasoned**
- (a) the input, mutation or exact reachable source path that shows it fails its own claim
- (b) the smallest change that closes it — a code block, or exact replacement wording

A finding with no (a) goes last.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an established P0 or P1, and name what established it.

## Previous findings

All eight from `docs/plans/260905i-plan-review-sol.md` are in the table above; every one was
accepted, none overruled. Treat the fixes as unreviewed code written by someone else, and spend most
of the run on what is new. Discovery is open this round.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

1. **The two new shared chunks.** `supabase-*` (54.76 kB gzip) and `useNow-*` (50.74 kB gzip) did
   not exist before; `main` now imports both statically, so they are initial requests. I have
   assumed this is neutral-to-good — separately cacheable across a deploy that only touches reader
   code — and have **not** measured that. Is there a way this is actually worse that I have missed,
   e.g. for the offline path, or the `boot.tsx → main.tsx` startup ordering that Sentry depends on?
2. **`tests/admin-only-routes.test.tsx` now pre-imports both pages** at module scope so vitest has
   them in its registry, and `show()` polls up to 50 turns for an `h1`. Does the pre-import make the
   test unable to catch a class of loader bug it should catch? Does the poll make anything a test of
   the spinner?
3. **`LazyPage` is not itself keyed by `routeKey`** — only the boundary inside it is, so the
   `attempt` counter survives a route change. I believe that is harmless (a fresh `load` identity
   rebuilds the lazy type either way) but it is the kind of thing that is harmless until it is not.
4. **1.5%.** Is it defensible to land this at all on that number, given the plan's stated
   justification is the boundary rather than the bytes? You argued yes at plan stage, before the
   shared-chunk effect was known. Does the smaller real number change your answer?

Do not change any file.
