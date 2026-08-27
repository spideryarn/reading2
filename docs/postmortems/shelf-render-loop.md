# The homepage rendered 470 times a second, and one keystroke froze it

> I sometimes find when I try and paste a url into the "Add" box in the Homepage, that the whole
> page freezes up. […] Actually, maybe even typing into it is enough to cause a freeze!
>
> — Greg, 2026-08-27

He was right about both, and about more than he asked. The shelf was **already** looping when
nobody was touching it — about 470 React renders a second, for as long as the tab was open. Typing
one character was not what started the loop; it was what tipped a loop that still yielded a little
into one that yielded nothing, and the tab stopped painting and stopped accepting input.

The Add box had nothing to do with it. Typing into the *search* box froze the page in exactly the
same way.

## What was actually happening

Five things, in a ring:

```
    Library renders
         │
         │  const dir = rawDir ?? []        ← a NEW array, every render
         ▼
    useMemo([by, dir, natural]) re-runs     ← its dep changed, so it must
         │
         │  sortingFromUrl(...) returns a NEW SortingState array
         ▼
    TanStack's getSortedRowModel memo
    is keyed on table.getState().sorting    ← changed ⇒ recompute
         │
         │  the memo's onChange fires: table._autoResetPageIndex()
         ▼
    resetPageIndex() → setPagination(old => ({...old, pageIndex}))
         │
         │  a new object ⇒ React state really changed
         ▼
    Library renders  ────────────────────────┘
```

The loop is *self-feeding*: nothing external drives it, and once entered it has no exit.

**What is measured, and what is inference.** Measured: about 470 resets a second at rest, and after
one keystroke `Input.insertText` stopped returning while the paused stack showed synchronous React
work. Inferred: exactly which scheduler transition turns the first into the second. TanStack's reset
is queued on a microtask, but React's at-rest work need not be, and CDP staying usable does not
prove the renderer was yielding normally — a debugger interrupt and a compositor screenshot both
work on a main thread that is not. GPT Sol's correction, 2026-08-27; the original text here claimed
the loop never got a frame *and* that it yielded at rest, which cannot both be true.

`?dir=` is deliberately absent from the plain homepage — an absent `dir` is what makes `?by=title`
mean "A to Z" rather than "Z to A", and [params.ts § sortDirParam](../../src/web/params.ts) records
the hour that rule cost. So `rawDir` was `null`, and `rawDir ?? []` minted a fresh empty array on
every single render.

The last link in the ring is the one nobody would have gone looking for. `autoResetPageIndex`
defaults to **on** whenever `manualPagination` is unset, and it queues a `resetPageIndex()` whenever
the sorted row model recomputes. This app has no pagination at all — no page supplies
`getPaginationRowModel`, so `getRowModel()` is a passthrough — but the reset still fires, still sets
React state, and still causes a render. A feature the app does not use was the hinge the loop turned
on.

## Why nobody saw it

**Because a page in an infinite render loop looks exactly like a page.** The DOM was correct and
stable at 339 nodes; the shelf was right; the text was right. Nothing was wrong with what was on
screen — it was simply being rebuilt several hundred times a second. This is
[silent-success.md](../reusable/silent-success.md) with the *output* as the thing that lies: every
render produced the same, correct page.

Two things then hid it further:

- **At rest the page still answered.** CDP could talk to the renderer, screenshots worked, clicks
  landed — see the note above on how much that does and does not prove. What it meant in practice is
  that nothing about using the page said "this tab is in trouble" until a keystroke.
- **It could not start from one row-model evaluation.** TanStack arms `_autoResetPageIndex` on its
  first call and returns without queueing anything. So the loop needs a *later* evaluation whose
  memo inputs have changed — in the app, the shelf arriving from the server. A second render with
  stable inputs does nothing at all. That detail is also what a regression test has to reproduce,
  and the first version of the test below passed against the broken build because it rendered
  once.

And the profiler-shaped tooling we already had was pointed elsewhere:
[performance.md](../project/performance.md) was written about the *reading view* burning CPU at
rest, with `?perf=1` counting renders per component — but the components it counts are the reading
view's, and this loop was on the shelf. The instrument existed and was aimed at the next room.

## It had already been seen, from the other end

The admin page hit the same line on the same day, and the sighting is instructive because of what it
looked like. `tests/admin-page.test.tsx` was written, and **every case in it timed out with no
error** — `act()` waits for React to go quiet and the page never went quiet.
[admin.md § the five suites](../project/admin.md) records it. A timeout with no error message reads
as a broken test rather than as broken code, which is why it was filed against the test first; the
line it was really about is the one below, copied from the shelf, comment and all.

So the loop announced itself twice on 2026-08-27 — once as a reader saying the homepage freezes, and
once as a test suite that would not finish — and neither report looked like "infinite render loop"
from where it was standing.

## The commit that introduced it

**Two commits, and the distinction is the point.** `c2f8132` (2026-08-26) wrote
`const dir = rawDir ?? [];` in `Library.tsx`, against the hand-rolled sort that preceded TanStack,
where it cost one wasted `useMemo` a render and nothing else. `ddd1d80` (2026-08-26, *"Hand the sort
to TanStack, and let the shelf be sorted two ways at once"*) added `useSortedTable` and was the first
commit containing the complete ring. `AdminPage.tsx` later copied the line, comment and all, which is
what a copied line does. GPT Sol caught this being told as one commit, 2026-08-27.

So the line that looks like the bug was not a bug when it was written, and the commit that made it
one did not touch it. Neither half is wrong on its own: a fresh `[]` per render is ordinary React
sloppiness; a defaulted-on page-index reset is ordinary library behaviour. It is the pair that
spins — which is also why neither commit's review would have been expected to catch it.

## What changed

Two fixes, and both are wanted — one removes this instance, the other removes the class.

**1. There is no per-render array any more.**
[`sortingFromUrl`](../../src/web/lib/table-sort.ts) now takes `("asc" | "desc")[] | null`, which is
what `sortDirParam` already returns, and does `dir?.[i] ?? natural[id]` inside. `Library.tsx` and
`AdminPage.tsx` pass `rawDir` straight in. The `?? []` is gone from both, and the doc comment on
`sortingFromUrl` says why it must not come back.

**2. `useSortedTable` sets `autoResetPageIndex: false`.**
This is the fix that matters for the future. Nothing here paginates, so the reset can never do
anything useful and can only ever close a ring like this one. The next person who hands the table an
unstable **`sorting` or `data`** identity gets a wasted recompute instead of a frozen tab. (Those
two, precisely: they are the sorted-row-model memo's dependencies. `columns` and `onSortingChange`
are not, and the first draft of this file said "anything", which is wider than the mechanism.)

**And it was already protecting a live defect rather than a hypothetical one.** GPT Sol's review
found `AdminPage.tsx` passing `rowId: (u) => u.id` inline — a new function every render, which
`useSortedTable` keys its `ordered` memo on, so the admin page rebuilt its core *and* sorted row
models every render. Without fix 2 that reconstitutes the whole ring on its own, with `rawDir` fixed
or not. It is now a module-level `idOf`, like the shelf's `slugOf`. `defaultColumn` was a fresh
object per render for the same reason and is now a module constant too.

## What would have caught the class

[`tests/shelf-render-loop.test.tsx`](../../tests/shelf-render-loop.test.tsx) mounts a probe that
hands `useSortedTable` a **deliberately** fresh `sorting` array on every render, renders it twice
(the second render is what arms the loop — see above), drains the queue with real macrotasks, and
asserts the render count stays under five. Against the broken build it reaches 52; against the fixed
one it is 2.

Three things about that test are load-bearing, and each of them was got wrong first:

- It renders **twice**. Once passes either way.
- It reads `table.getRowModel()`. TanStack's memos are lazy, so a table nobody asks rows from never
  recomputes and never queues anything.
- It drains with `setTimeout(…, 0)` rather than a couple of `await Promise.resolve()`. Two microtask
  turns are two renders, which is under any sane threshold — the short drain reads as a healthy page
  whichever build it runs against.

The test caps its own renders and stops feeding the loop afterwards, so a red run reports "52" in
half a second rather than hanging the suite for ever.

**It covers fix 2 and not fix 1, and that is worth saying out loud.** Put `rawDir ?? []` back and
this test stays green, because the guard underneath now holds. That is the right trade — the guard
is what protects every future caller, and it is testable, whereas "this `useMemo` dependency keeps
its identity across renders" is a property of one line in one component that no test expresses
without mounting the whole page. But it means the shelf's own `?? []` is held by a doc comment
rather than by a check, in two files. GPT Sol raised it; recorded rather than papered over.

## How it was found

Not by reading. The freeze was reproduced by driving a real Chrome over the DevTools Protocol,
signed in with `scripts/seed-local-session.ts`, and the tell was that `Input.insertText` **never
returned** — a CDP input command is acknowledged by the renderer, so a command that never comes back
is a renderer that is not running the event loop.

From there the chain was: `Debugger.pause` into the wedged renderer (V8's interrupt breaks into a
running script, which is what makes a spinning page inspectable at all); the stack showed
`processRootScheduleInMicrotask → performSyncWorkOnRoot → renderRootSync` repeating; the React fiber
reached from `document.getElementById('add-url')`'s `__reactFiber$…` property gave
`root.memoizedUpdaters === [Library]`, naming the component scheduling the work; and a breakpoint on
`scheduleUpdateOnFiber` in the React dev bundle produced the stack that named the culprit outright:

```
scheduleUpdateOnFiber ← dispatchSetState ← onStateChange ← setState
  ← table.setPagination ← table.setPageIndex ← table.resetPageIndex
  ← table._autoResetPageIndex ← getSortedRowModel's onChange ← Library
```

The measurement that turned it from "wedges on a keystroke" into "always wedged, you just could not
tell" was a **conditional breakpoint that never pauses**: a breakpoint on the line that queues the
reset, with the condition `(globalThis.__resets = (globalThis.__resets||0)+1, false)`. The condition
still runs; the page never stops. At rest it counted **2,358 resets in five seconds**. After the
fix, **0**.

That trick is worth keeping. A false-conditioned breakpoint is a counter you can attach to any line
of somebody else's minified library, from outside, without editing it.

## Related

- [performance.md](../project/performance.md) — what the page costs, and the recipes for measuring
  it without fooling yourself.
- [library.md](../project/library.md) — the shelf, and what the sort is.
- [silent-success.md](../reusable/silent-success.md) — the pattern this belongs to.
