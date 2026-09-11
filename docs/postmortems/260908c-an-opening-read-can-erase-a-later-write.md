# An opening read can erase a later write

Status as of 2026-09-08: **code-proved reachable; not reproduced in a browser or fixed**. Found
during the plan-only [Spideryarn improvement audit](../plans/260908f-prioritised-spideryarn-codebase-improvements.md)
at `4adcdfd6`, independently traced through mounted UI and history by GPT Sol. No production
incident rate is known. The loss is from client state; successful rows remain in Postgres.

**Update 2026-09-11: reproduced and fixed by the submit gate** Greg chose. At `33123d9f` a mounted
witness per surface (outside StrictMode) showed B created, shown, then erased when GET A landed.
Run / Find / Save now wait for `loaded`, and the opening reads have a 15-second deadline that
invalidates the snapshot before enabling writes — [web-client.md § A write waits for the opening
read](../project/web-client.md#a-write-waits-for-the-opening-read);
`tests/opening-read-gates-writes.test.tsx`. The reconciliation alternatives below were not built.

## The class and the reachable paths

**An unsequenced whole-list snapshot overwrites a causally later local write.** A mount's `live`
flag proves that a request still belongs to the page. It does not prove the request is newer than
another response from the same page.

| Opening read | Later write that the actual UI permits while it waits |
|---|---|
| `src/web/useCriteria.ts:109` → `setRows` at 125 | `CriteriaPanel.CriteriaView` renders `NewCriterion` beside its loading message; `send` applies pending, streamed and completed rows |
| `src/web/useSearch.ts:190` → `setRuns` | `SearchPanel.Box` readiness checks draft/matcher/busy, not `loaded`; a new meaning-search stream can complete first |
| `src/web/useComments.ts:291` → `setComments` at 308 | `ArticlePage.OwnedReader` starts the GET; selection opens `AnnotateDialog`, whose free Save calls `comments.create` without consulting `loaded` |

The discriminating sequence is GET captures old row A; the reader creates B; POST/stream finishes
and B is shown; old GET arrives and replaces the whole list with A. Search/Criteria can thus hide
a completed paid result; Comments can hide a saved annotation. Nothing in the mount guard rejects
that last commit. Its replacement also bypasses the hooks' per-row tombstones/colour overlays;
Criteria can replace the newer source fingerprint from `begin` with the older GET's fingerprint.

The initial nomination called Comments a new-comment **stream** race. That path no longer
describes the UI: new annotations are free creates, followed by Chat when **Also ask the AI** is
selected. The ordinary legacy retry/deepen controls need a row supplied after GET. The free-create
path above is sufficient to prove the defect; a direct invocation of an inaccessible hook method
would not be.

## Where it came from

Sol checked `git blame`, `git log -S` and file-addition history:

- `3060972aa876847ac6d07ce3a79754e263ddfef4`, 2026-08-25, introduced Comments' opening replacement
  GET and local mutation path. `5fc174317`, 2026-08-28, introduced the current free-create flow.
- `cb1f269da202e1ca929d79b54556bd1a9381445f`, 2026-08-26, introduced Search's GET/mutation pair.
- `b9f1d2a53daebceaa23b800a74ef70324206940d`, 2026-09-01, copied that shape into Referee criteria.

These commits added useful behaviour. The missing contract was the relationship between an
initial snapshot and later local writes, not any individual request's response handling.

## Why the nearby defence is insufficient

`useOrderedRead` orders **reads**. Local `put`, `create` and stream frames do not advance its
generation. `reload` may join the old GET; `refresh` permits that GET to commit before a trailing
repair; `armRefresh` at stream begin can read a still-partial result. Simply calling `discard`
also loses the only opening copy of A: after creating B, the list becomes B alone.

The [earlier slow-response postmortem](260905e-a-slow-response-overwrites-a-fast-one.md) and
`tests/artefact-read-race.test.tsx` establish the broader class, but neither is a mounted witness
for these mutable-list paths. A cross-slug test exercises `live` and can pass throughout this bug.

## The smallest fix, and the stronger alternative

Nothing was patched in this audit. Plan A recommends a small product choice first: let the reader
type while the initial list loads, but enable Run/Find/Save only after it settles. Gate on
`loaded`, including failed load, and give a stuck read a bounded abort/invalidation ending before
enabling writes. This orders the only current pre-load mutation paths and preserves initial rows.
It changes behaviour, so Greg should see the concrete wait before implementation.
At the time of this audit no product decision had been made. Greg selected the submit gate on
2026-09-11, and the update above records its implementation. The requirement was that its timeout
abort or invalidate the GET before marking it failed/loaded and enabling writes. Page-reload
recovery remains; an in-place retry would need the same fence again. The UI handlers as well as the
buttons are gated—a silent hook-level `ask` refusal would be unsafe while its return type promises
the id that callers immediately activate.

If immediate pre-load submission is required, merge the opening base with explicit locally owned
rows, reminted ids, deletions and colour choices, preserving newer fingerprints; or fence stale
snapshots and reconcile a post-write refresh without losing old rows or local failures. This is
more machinery and should not be adopted without needing the behaviour it buys.

## Defences ranked by ease and value

1. **Mounted two-operation red tests** for each surface, with A in the initial GET and B created
   later. Require both after settlement; this catches both the original A-only result and the
   tempting discard-only B-only fix. Prove the POST/completion ran. Use controlled responses,
   not timing sleeps, and keep the initial reproduction outside StrictMode.
2. **The selected ordering contract** in action readiness/handlers, with success, failure and
   timeout cases; or a narrowly shared merge contract if immediate writes are required. Exercise
   the actual UI rather than only invoking a hook directly.
3. **Regression controls for existing semantics:** remint, delete during stream, chosen colour,
   failed refresh, source fingerprint and slug change. These must survive an ordering fix.

Rejected: hiding the whole composer while loading, blanket `useOrderedRead` adoption without
write sequencing, and a generic Search/Comments/Criteria streaming state machine. Each solves a
wider or different problem than the demonstrated gap.

The lesson: **page ownership and response ordering are two different contracts**. Check each
through the actual caller, and require an old row as well as a new row in the test.
