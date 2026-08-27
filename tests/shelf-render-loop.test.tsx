// @vitest-environment jsdom
/**
 * **A shelf that is handed a fresh `sorting` array must not render for ever.**
 *
 * This is the regression test for the homepage freeze of 2026-08-27: typing a
 * single character into the "Add an article" box locked the tab up completely,
 * and the same page was already burning ~470 renders a second while sitting
 * still. See docs/postmortems/shelf-render-loop.md for the measurement and the
 * whole chain; the two-line version is:
 *
 *   TanStack's sorted-row-model memo is keyed on `table.getState().sorting`. A
 *   caller who hands it a new array on every render makes that memo recompute
 *   on every render, and its `onChange` queues `resetPageIndex()` — which sets
 *   React state, which renders again, which builds another new array.
 *
 * The loop is closed by `autoResetPageIndex`, which is on by default because
 * this table does not set `manualPagination`. Nothing here paginates, so that
 * reset can only ever be the hinge of a loop; `useSortedTable` turns it off.
 *
 * **The unstable array is deliberate.** `Library.tsx` no longer builds one —
 * the same commit made `sortingFromUrl` take a null `dir` so there is no
 * `?? []` per render — but the *guard* is what this test is about, and a test
 * that fed it a stable array would pass with the guard removed.
 *
 * It has to terminate whether or not it passes, so the probe below stops
 * feeding the loop after `CAP` renders rather than throwing: a red run reports
 * "51 renders" instead of hanging the suite for ever.
 */
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { SortingState } from "@tanstack/react-table";
import { useSortedTable } from "../src/web/lib/DataTable.js";
import type { SortableColumn } from "../src/web/lib/DataTable.js";

interface Row {
  slug: string;
  title: string;
}

/* Module scope: every one of these must keep its identity across renders, so
   that the array the test *does* rebuild is the only suspect. */
const DATA: Row[] = [
  { slug: "b-piece", title: "Beta" },
  { slug: "a-piece", title: "Alpha" },
];
const COLUMNS: SortableColumn<Row>[] = [
  { id: "title", header: "Title", accessorFn: (r: Row) => r.title, sortDescFirst: false },
];
const rowId = (r: Row) => r.slug;
const noop = () => {};

/** Enough renders to be unambiguous, few enough that a red run is quick. */
const CAP = 50;

let renders = 0;

function Probe() {
  renders += 1;
  /* A fresh array while we are under the cap — the shape the bug needed. Past
     it we hand back one stable array, so a broken build stops rather than
     spinning, and the assertion below still sees how far it got. */
  const stable = useRef<SortingState>([{ id: "title", desc: false }]);
  const sorting: SortingState =
    renders <= CAP ? [{ id: "title", desc: false }] : stable.current;

  const table = useSortedTable<Row>({
    data: DATA,
    columns: COLUMNS,
    sorting,
    onSortingChange: noop,
    rowId,
  });
  /* The read is load-bearing. TanStack's memos are lazy, so a table nobody asks
     for rows from never recomputes and never queues anything — exactly what
     `Library.tsx` does on every render. */
  table.getRowModel();
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  renders = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("stops rendering even when `sorting` is a new array every time", async () => {
  await act(async () => {
    root.render(createElement(Probe));
  });
  /* **A second render, and it is not padding.** TanStack arms `_autoResetPageIndex`
     on its first call and returns without queueing anything, so a component that
     renders exactly once can never start the loop — and a probe that rendered
     once would pass against the broken build. In the app this second render is
     the shelf arriving from the server. */
  await act(async () => {
    root.render(createElement(Probe));
  });
  /* The reset is queued on a promise rather than a timer, so one more flushed
     tick is what lets a loop prove itself. `act` drains React's own work; this
     drains TanStack's queue and whatever React does about it. */
  /* Flushed with real macrotasks rather than a couple of microtask turns: the
     loop advances one render per queue flush, so a short drain reads as a
     healthy page whichever build it is run against. */
  for (let i = 0; i < CAP + 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  /* Strict mode is off here, so two `root.render` calls are two renders. Before
     the fix this reached 52 — the cap, plus the render that noticed it. */
  expect(renders).toBeLessThan(5);
});
