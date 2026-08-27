# Review: the homepage infinite render loop, and the fix for it

You are reviewing a **bug fix that has already been built and measured**, not a plan. Weight this
accordingly: look for what the fix misses, what it breaks, and what the reasoning gets wrong.

## The bug

Spideryarn's homepage (`src/web/Library.tsx`, a React 19 + TanStack Table v8 shelf of articles) was
in a permanent synchronous render loop. Measured in a real Chrome over CDP: **2,358 auto page-index
resets in 5 seconds at rest**, and `Input.insertText` of a single character into any input on the
page never returned at all — the renderer stopped running its event loop.

The ring:

1. `const dir = rawDir ?? [];` in `Library.tsx` — `rawDir` is `null` on the plain homepage (the
   `dir` query parameter deliberately has no nuqs default), so this minted a **new array every
   render**.
2. `const sorting = useMemo(() => sortingFromUrl(by, dir, natural, DEFAULT_BY), [by, dir, natural]);`
   — dep changed every render, so a **new `SortingState` array every render**.
3. TanStack's `getSortedRowModel` memo is keyed on `[table.getState().sorting,
   table.getPreSortedRowModel()]` — dep 1 changed, so it recomputed every render.
4. That memo's `onChange` is `() => table._autoResetPageIndex()`. `autoResetPageIndex` defaults on
   (the table does not set `manualPagination`), so it queued `table.resetPageIndex()` on a
   microtask.
5. `resetPageIndex()` → `setPageIndex()` → `setPagination(old => ({...old, pageIndex}))` → a new
   object → React state genuinely changed → **Library renders again** → back to 1.

Confirmed by a breakpoint on React's `scheduleUpdateOnFiber`, whose stack read:

```
scheduleUpdateOnFiber ← dispatchSetState ← onStateChange ← setState
  ← table.setPagination ← table.setPageIndex ← table.resetPageIndex
  ← table._autoResetPageIndex ← getSortedRowModel's onChange ← Library
```

and by `root.memoizedUpdaters === [Library]` read off the live fiber.

Note: the app supplies **no** `getPaginationRowModel`, so pagination is a passthrough — there is no
page index anywhere in this UI for the reset to be about.

## The fix (the scoped diff is `docs/plans/shelf-render-loop-scoped.diff`)

Two changes:

**A. Remove the per-render array.** `sortingFromUrl` now takes `("asc" | "desc")[] | null` — which
is exactly what the `sortDirParam` parser returns — and does `dir?.[i] ?? natural[id]` internally.
`Library.tsx` and `AdminPage.tsx` pass `rawDir` straight into the memo, so there is no `?? []`.

**B. `autoResetPageIndex: false` in `useSortedTable`** (`src/web/lib/DataTable.tsx`), as the
class-level guard, so the next unstable identity handed to this table is a wasted recompute rather
than a frozen tab.

## The regression test

`tests/shelf-render-loop.test.tsx` (jsdom). It hands `useSortedTable` a deliberately fresh `sorting`
array on every render, renders twice, drains with real macrotasks, and asserts renders < 5.
Verified red before the fix (52 renders) and green after (2).

## Verification

In a real signed-in Chrome, before → after: auto-resets at rest in 5s **2358 → 0**; pasting a URL
into the Add box **never acknowledged → acked in 5 ms**.

## What I want from you

Be concrete and cite files/lines. In particular:

1. **Is fix A complete?** Are there other identities handed to `useSortedTable` — `data`, `columns`,
   `rowId`, `onSortingChange` — that are unstable per render in `Library.tsx` or `AdminPage.tsx`?
   Trace `libraryColumns(shelf, now)`, `useShelf()`'s memo, `useNow()`, and the `rows`/`ordered`
   memos.
2. **Does `autoResetPageIndex: false` break anything?** Is there any code path in this repo where a
   page index actually matters? Is `autoResetAll` or another auto-reset (`autoResetExpanded`, etc.)
   able to close the same ring?
3. **Is the null-`dir` change behaviour-preserving?** `sortingFromUrl(by, null, natural, fallback)`
   vs the old `sortingFromUrl(by, [], natural, fallback)` — including the internal recursive call
   and `isAllNatural`/`sortingToUrl` round trips. Any URL that used to parse one way and now parses
   another?
4. **Is the test honest?** Would it pass against the broken build for a reason other than the fix?
   Is `renders < 5` the right threshold, and is the two-render mount the right minimum? Does the
   `CAP` escape hatch mask anything?
5. **Anything else in this app with the same shape** — a `?? []` or `?? {}` feeding a `useMemo` dep
   list, or a fresh object into a library memo. Name the files.
6. **Is the postmortem's causal account right?** `docs/postmortems/shelf-render-loop.md`. Correct
   anything overstated — particularly the claim that the loop could not start from a single render,
   and the claim that at rest the loop still yielded enough for CDP to work.

Files to read: `src/web/Library.tsx`, `src/web/AdminPage.tsx`, `src/web/lib/DataTable.tsx`,
`src/web/lib/table-sort.ts`, `src/web/params.ts`, `src/web/useShelf.ts`, `src/web/useNow.ts`,
`src/web/library-columns.tsx`, `tests/shelf-render-loop.test.tsx`,
`docs/postmortems/shelf-render-loop.md`, `docs/plans/shelf-render-loop-scoped.diff`.
