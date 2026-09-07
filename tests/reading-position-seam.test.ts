// @vitest-environment jsdom
/**
 * **The read count that authorised the work, checked against the reads.**
 *
 * `geometry-cost.ts` is handed a hand-maintained integer saying how many layout
 * reads a frame performed, and A8's whole decision rests on that integer. GPT
 * Sol, reviewing Stage 1 on 2026-09-06 (F15), showed the suite could not see it
 * move:
 *
 * > Changing covered `measureRow` from `rows.length` to `rows.length + 1` failed
 * > exactly. In contrast, changing `readingPosition`'s read count to `1`, and
 * > separately moving its timer start immediately before `noteGeometry`, both
 * > left all 12 tests green.
 *
 * So the number the conclusion came from was the one number nothing checked —
 * [silent-success.md](../docs/reusable/silent-success.md)'s exact shape, where
 * the reassuring reading and the broken reading are the same reading.
 *
 * The two mutations Sol performed are what this file is built to fail on, and
 * they need different instruments:
 *
 * - **a wrong count** is caught by spying on the accessor itself, so the
 *   published integer is compared with the rects the browser was actually asked
 *   for, rather than with another copy of the same assumption;
 * - **a moved timer** is caught by interleaving the clock reads and the layout
 *   reads into one ordered log, because a timer started next to `noteGeometry`
 *   reports a sampler costing almost nothing while it reads every row in the
 *   article — a number that would argue *against* the work, quietly and in the
 *   confident direction.
 *
 * `src/web/reading-position.ts` exists so this file can call the thing at all;
 * it was previously a closure inside a closure in `App.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  geometryCost,
  resetGeometryCost,
  startGeometryCost,
  stopGeometryCost,
} from "../src/web/geometry-cost.js";
import type { Section } from "../src/web/position.js";
import { measureReadingPosition } from "../src/web/reading-position.js";
import type { BlockId } from "../src/types.js";

/** One ordered log of everything measured or timed, in the order it happened. */
let events: string[] = [];

const realRect = Element.prototype.getBoundingClientRect;
const realNow = performance.now;

beforeEach(() => {
  events = [];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    // Which element was asked matters: `stickyOffset` reads the controls bar and
    // is charged to its own leaf, so counting it against `readingPosition`
    // would hide an off-by-one in exactly the place this file is watching.
    events.push(this.matches("tr[data-block]") ? "row-rect" : "other-rect");
    return { top: 100, bottom: 120, left: 0, right: 0, width: 0, height: 20 } as DOMRect;
  } as typeof Element.prototype.getBoundingClientRect;
  performance.now = function (this: Performance) {
    events.push("clock");
    return realNow.call(this);
  } as typeof performance.now;
});

afterEach(() => {
  stopGeometryCost();
  Element.prototype.getBoundingClientRect = realRect;
  performance.now = realNow;
  document.body.innerHTML = "";
});

/** `n` section rows, every one of them resolvable. */
function article(n: number): {
  sections: Section[];
  rows: HTMLElement[];
  rowOf: Map<BlockId, number>;
} {
  const sections: Section[] = [];
  const rows: HTMLElement[] = [];
  const rowOf = new Map<BlockId, number>();
  /* A controls bar, because `stickyOffset` reads its rect and without one it
     takes the no-bar path and reads nothing at all — which would make the
     exclusive-accounting assertion below vacuously true. */
  const bar = document.createElement("div");
  bar.className = "controls";
  document.body.appendChild(bar);
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < n; i++) {
    const id = `spya-seam${i}` as BlockId;
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", id);
    tbody.appendChild(tr);
    rows.push(tr);
    sections.push({ row: i, blockId: id } as Section);
    rowOf.set(id, i);
  }
  table.appendChild(tbody);
  document.body.appendChild(table);
  return { sections, rows, rowOf };
}

function measureOnce(n: number, holes = 0) {
  const { sections, rows, rowOf } = article(n);
  const withHoles: (HTMLElement | null)[] = rows.map((r, i) => (i < holes ? null : r));
  const resolved = withHoles.reduce<number>((acc, el) => (el ? acc + 1 : acc), 0);
  resetGeometryCost();
  startGeometryCost("counts");
  measureReadingPosition({ sections, rowOf, rows: withHoles, resolved, held: null });
  return { cost: geometryCost(), resolved };
}

describe("the published read count is the reads that happened", () => {
  it("charges one rect per resolved row, plus the one scrollY", () => {
    const { cost } = measureOnce(7);
    const rowRects = events.filter((e) => e === "row-rect").length;
    expect(rowRects).toBe(7);
    // The mutation this fails on: `1 + resolved` → `1`. Asserted against the
    // spy, not against a second copy of the constant.
    expect(cost.readingPosition.reads).toBe(rowRects + 1);
  });

  it("moves when the article does — a count that ignored the rows would not", () => {
    // The changed-input control. Without it, a `reads` hardcoded to 8 would
    // satisfy the assertion above on this one fixture and nothing else.
    const small = measureOnce(3).cost.readingPosition.reads;
    const large = measureOnce(40).cost.readingPosition.reads;
    expect(small).toBe(4);
    expect(large).toBe(41);
  });

  it("counts the rows it resolved, not the rows it was handed", () => {
    // A hole is skipped without a read. Counting `rows.length` here would report
    // a busy sampler on an article whose tree never resolved — the inversion
    // that would argue hardest for work nobody needs.
    const { cost, resolved } = measureOnce(10, 4);
    expect(resolved).toBe(6);
    expect(events.filter((e) => e === "row-rect").length).toBe(6);
    expect(cost.readingPosition.reads).toBe(7);
  });

  it("does not charge itself for the controls bar, which is its own leaf", () => {
    const { cost } = measureOnce(5);
    // The bar's rect really is read — and charged to `stickyOffset`, not here.
    // This is the exclusive-reads convention the whole instrument rests on: the
    // ten sites must add up to the frame's reads with nothing counted twice, so
    // a parent that absorbed its leaf's rect would inflate the total silently.
    expect(events).toContain("other-rect");
    expect(cost.readingPosition.reads).toBe(6);
    expect(cost.stickyOffset.reads).toBe(1);
  });
});

describe("the timer starts before the reads, not beside the report", () => {
  it("takes its first clock reading before it touches the layout", () => {
    measureOnce(6);
    const firstClock = events.indexOf("clock");
    const firstRead = events.findIndex((e) => e.endsWith("-rect"));
    expect(firstClock).toBeGreaterThanOrEqual(0);
    expect(firstRead).toBeGreaterThanOrEqual(0);
    // The mutation this fails on: moving `parentGeometryClock()` down to sit
    // beside `noteGeometry`. That reports a sampler costing almost nothing
    // while it reads every row — wrong in the direction nobody questions.
    expect(firstClock).toBeLessThan(firstRead);
  });

  it("closes the interval after the reads, so the timing spans them", () => {
    measureOnce(6);
    const lastClock = events.lastIndexOf("clock");
    const lastRead = events.map((e) => e.endsWith("-rect")).lastIndexOf(true);
    expect(lastClock).toBeGreaterThan(lastRead);
  });

  it("reads the clock exactly twice — the probe is not paying for itself", () => {
    // One for the start, one inside `noteGeometry`. A third would mean the
    // probe had started consuming the clock the way scroll.ts § apply did,
    // which is docs/postmortems/260907a-a-probe-that-read-the-same-clock-twice.md.
    measureOnce(6);
    expect(events.filter((e) => e === "clock").length).toBe(2);
  });

  it("reads no clock at all when the probe is off", () => {
    const { sections, rows, rowOf } = article(4);
    stopGeometryCost();
    events = [];
    measureReadingPosition({ sections, rowOf, rows, resolved: 4, held: null });
    // The paired zero: the reads still happen, so this is "the probe is silent",
    // not "nothing ran".
    expect(events.filter((e) => e === "clock")).toEqual([]);
    expect(events.filter((e) => e === "row-rect").length).toBe(4);
  });
});
