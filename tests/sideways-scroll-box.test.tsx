// @vitest-environment jsdom
/**
 * The box a wide table scrolls sideways in, and the fade that says there is
 * more — [src/web/lib/SidewaysScrollBox.tsx](../src/web/lib/SidewaysScrollBox.tsx).
 * docs/plans/261006g-none-yet-is-not-a-404-and-admin-costs-scroll-cue.md § Stage 2.
 *
 * **jsdom lays nothing out**, so three things here are stand-ins and a browser
 * has to say the rest:
 *
 * - `scrollWidth`, `clientWidth` and `scrollLeft` of the scroll box are getters
 *   on `Element.prototype` reading the `layout` object below. Nothing here
 *   shows that a real table at 390px overflows, or by how much.
 * - `ResizeObserver` is `FakeResizeObserver`: it records what was observed and
 *   fires only when a test says so. That an inner table really reports a
 *   resize when its columns change is the browser's to show.
 * - A scroll is a hand-made `scroll` event after `layout.scrollLeft` is set.
 *
 * What the fades look like, and that they paint over the pinned label column,
 * is not held here at all: only their presence, side and inertness.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SortingState } from "@tanstack/react-table";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataTable, type SortableColumn, useSortedTable } from "../src/web/lib/DataTable.js";
import { SidewaysScrollBox } from "../src/web/lib/SidewaysScrollBox.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The scroll box's geometry, in pixels: what a browser would have measured. */
const layout = { content: 0, box: 0, scrollLeft: 0 };

/* jsdom ships no ResizeObserver — tests/spine-scroll.test.ts has the same fake. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void { this.targets.add(target); }
  unobserve(target: Element): void { this.targets.delete(target); }
  disconnect(): void { this.targets.clear(); }
  /** Fire every observer watching `target`, and say how many there were. */
  static resized(target: Element): number {
    const watching = FakeResizeObserver.instances.filter((o) => o.targets.has(target));
    for (const o of watching) o.callback([], o as unknown as ResizeObserver);
    return watching.length;
  }
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  Object.assign(layout, { content: 0, box: 0, scrollLeft: 0 });
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const ofBox = (el: Element, value: number) => (el.matches("[data-scroll-box]") ? value : 0);
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return ofBox(this, layout.content);
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return ofBox(this, layout.box);
  });
  vi.spyOn(Element.prototype, "scrollLeft", "get").mockImplementation(function (this: Element) {
    return ofBox(this, layout.scrollLeft);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(node: React.ReactNode): void {
  act(() => root.render(node));
}

const wrapper = () => host.querySelector<HTMLElement>("[data-sideways-scroll]");
const box = () => host.querySelector<HTMLElement>("[data-scroll-box]");
const fade = (side: "left" | "right") => host.querySelector<HTMLElement>(`[data-scroll-fade="${side}"]`);
/** Which sides say there is more: the wrapper's attributes and the fades drawn, which must agree. */
function more(): { left: boolean; right: boolean } {
  const said = { left: wrapper()?.hasAttribute("data-more-left") ?? false, right: wrapper()?.hasAttribute("data-more-right") ?? false };
  expect({ left: fade("left") !== null, right: fade("right") !== null }).toEqual(said);
  return said;
}

function scrollTo(left: number): void {
  layout.scrollLeft = left;
  act(() => {
    box()?.dispatchEvent(new Event("scroll"));
  });
}

function resized(target: Element | null | undefined, what: string): void {
  if (!target) throw new Error(`nothing to resize: ${what}`);
  let watching = 0;
  act(() => {
    watching = FakeResizeObserver.resized(target);
  });
  expect(watching, `no ResizeObserver is watching ${what}`).toBeGreaterThan(0);
}

const wide = (
  <SidewaysScrollBox className="tw:mb-4">
    <table data-inner="">
      <tbody>
        <tr>
          <td>a figure</td>
        </tr>
      </tbody>
    </table>
  </SidewaysScrollBox>
);

describe("SidewaysScrollBox", () => {
  it("says there is more to the right when the content is wider than the box", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(wide);
    expect(more()).toEqual({ left: false, right: true });
  });

  it("says nothing when the content fits", () => {
    Object.assign(layout, { content: 360, box: 360 });
    mount(wide);
    expect(more()).toEqual({ left: false, right: false });
  });

  it("shows both part-way along, and only the left at the end of the scroll", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(wide);
    scrollTo(200);
    expect(more()).toEqual({ left: true, right: true });
    scrollTo(540);
    expect(more()).toEqual({ left: true, right: false });
    scrollTo(0);
    expect(more()).toEqual({ left: false, right: true });
  });

  /* A zoomed or high-density screen stops a fraction of a pixel short of the
     arithmetic end, and a cue that never clears is worse than none. */
  it("counts a fraction of a pixel short of the end as the end", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(wide);
    scrollTo(539.5);
    expect(more()).toEqual({ left: true, right: false });
  });

  /* The pivot: *then by* changes the columns while the box keeps its width,
     and nothing scrolls. Sol's F2 on the plan. */
  it("measures again when the content changes size, with no scroll and no change to the box", () => {
    Object.assign(layout, { content: 360, box: 360 });
    mount(wide);
    expect(more().right).toBe(false);
    layout.content = 900;
    resized(host.querySelector("[data-inner]"), "the table inside the box");
    expect(more().right).toBe(true);
    layout.content = 360;
    resized(host.querySelector("[data-inner]"), "the table inside the box");
    expect(more().right).toBe(false);
  });

  it("measures again when the box changes size", () => {
    Object.assign(layout, { content: 900, box: 900 });
    mount(wide);
    expect(more().right).toBe(false);
    layout.box = 360;
    resized(box(), "the scroll box");
    expect(more().right).toBe(true);
  });

  it("draws the fades outside the scrolling box, hidden from a screen reader and from the pointer", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(wide);
    scrollTo(200);
    for (const side of ["left", "right"] as const) {
      const el = fade(side);
      expect(el?.parentElement).toBe(wrapper());
      expect(box()?.contains(el ?? null)).toBe(false);
      expect(el?.getAttribute("aria-hidden")).toBe("true");
      expect(el?.className.split(/\s+/)).toContain("tw:pointer-events-none");
    }
  });

  it("keeps the scrolling on the inner box, and the caller's margin on the outer one", () => {
    mount(wide);
    expect(box()?.parentElement).toBe(wrapper());
    expect(box()?.className.split(/\s+/)).toContain("tw:overflow-x-auto");
    expect(wrapper()?.className.split(/\s+/)).toContain("tw:mb-4");
    expect(wrapper()?.className.split(/\s+/)).not.toContain("tw:overflow-x-auto");
    expect(host.querySelector("[data-inner]")?.parentElement).toBe(box());
  });

  it("stops listening when it goes", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(wide);
    const el = box();
    act(() => root.render(null));
    expect(FakeResizeObserver.instances.every((o) => o.targets.size === 0)).toBe(true);
    expect(el ? FakeResizeObserver.resized(el) : -1).toBe(0);
  });
});

/* The shared table: the shelf and /admin/users draw it too, and neither asked
   for a cue. */
describe("DataTable's sidewaysCue", () => {
  type Line = { id: string; name: string };
  const LINES: Line[] = [{ id: "a", name: "Ada" }];
  const COLUMNS: SortableColumn<Line>[] = [
    {
      id: "name",
      header: "Name",
      accessorFn: (l) => l.name,
      sortDescFirst: false,
      meta: { label: "Name", hint: "Who", ends: ["A to Z", "Z to A"] },
    },
  ];
  const SORTING: SortingState = [{ id: "name", desc: false }];
  const idOf = (l: Line) => l.id;
  const ignore = () => {};

  function Harness({ cue }: { cue?: boolean }) {
    const table = useSortedTable({ data: LINES, columns: COLUMNS, sorting: SORTING, onSortingChange: ignore, rowId: idOf });
    const rows = table.getRowModel().rows;
    /* The first is the call the shelf and /admin/users make: no prop at all. */
    return cue ? (
      <DataTable table={table} rows={rows} caption="People" sidewaysCue />
    ) : (
      <DataTable table={table} rows={rows} caption="People" />
    );
  }

  it("is off unless asked for: one box, as before, and no wrapper", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(<Harness />);
    expect(wrapper()).toBeNull();
    expect(host.querySelector("[data-scroll-fade]")).toBeNull();
    const table = host.querySelector("table");
    expect(table?.parentElement?.className).toBe(
      "tw:relative tw:overflow-x-auto tw:rounded-lg tw:border tw:border-border",
    );
    expect(table?.parentElement?.parentElement).toBe(host);
  });

  it("measures the table's own scroll box when asked", () => {
    Object.assign(layout, { content: 900, box: 360 });
    mount(<Harness cue />);
    expect(host.querySelector("table")?.parentElement).toBe(box());
    expect(host.querySelectorAll(".tw\\:overflow-x-auto")).toHaveLength(1);
    expect(more()).toEqual({ left: false, right: true });
  });
});
