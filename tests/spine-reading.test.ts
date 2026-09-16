// @vitest-environment jsdom
/**
 * **Where you have spent time reading, down the rail**: the `.spine-read` layer
 * and `readingRuns`.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 *
 * jsdom cannot see paint, so what this pins is the geometry of each run and the
 * layer's place in the track's tree order, which is its paint order: under the
 * current-section fill, the hairlines and the search marks. The harness is
 * tests/spine-here.test.ts's, whose header says why each piece of it is there.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { Spine } from "../src/web/Spine.js";
import type { ReadLevel } from "../src/web/reading-time.js";
import type { BlockMatch } from "../src/web/search-hits.js";
import { type Row, readingRuns } from "../src/web/spine-marks.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";

const ROWS = 20;
const ROW_H = 100;
const READING_OFFSET = 175;

function entry(id: string, startRow: number, endRow: number, children: OutlineEntry[] = []): OutlineEntry {
  const node = {
    id: id as NodeId,
    parent: null,
    children: [],
    depth: 1,
    title: id,
    gist: id,
    range: [`b${startRow}`, `b${endRow}`],
  } as unknown as TreeNode;
  return { node, startRow, endRow, words: (endRow - startRow + 1) * 10, children };
}

const outline = (): OutlineEntry[] => [
  entry("main", 0, 19, [entry("m1", 0, 9), entry("m2", 10, 19)]),
];

describe("readingRuns", () => {
  const rows = new Map<string, Row>(
    Array.from({ length: 6 }, (_, i) => [`b${i}`, { index: i, top: i * 100, height: 100 }] as const),
  );

  it("merges neighbouring rows at the same step into one run", () => {
    const levels = new Map<string, ReadLevel>([
      ["b0", 4],
      ["b1", 4],
      ["b2", 4],
      ["b3", 2],
    ]);
    expect(readingRuns(rows, levels)).toEqual([
      { top: 0, height: 300, level: 4 },
      { top: 300, height: 100, level: 2 },
    ]);
  });

  it("does not bridge a row the reader skipped, even between two at the same step", () => {
    const levels = new Map<string, ReadLevel>([
      ["b1", 3],
      ["b3", 3],
    ]);
    expect(readingRuns(rows, levels)).toEqual([
      { top: 100, height: 100, level: 3 },
      { top: 300, height: 100, level: 3 },
    ]);
  });

  it("ignores step 0 and blocks this page does not have, whatever order the map is in", () => {
    const levels = new Map<string, ReadLevel>([
      ["b5", 1],
      ["gone", 4],
      ["b4", 1],
      ["b2", 0],
    ]);
    expect(readingRuns(rows, levels)).toEqual([{ top: 400, height: 200, level: 1 }]);
  });
});

let root: Root;
let host: HTMLDivElement;

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: (t: number) => void,
  ) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
    clearTimeout(id);
  document.body.innerHTML = "";

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < ROWS; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", `b${i}`);
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const block = this.getAttribute("data-block");
      if (!block) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const i = Number(block.slice(1));
      const top = i * ROW_H - window.scrollY;
      return { top, bottom: top + ROW_H, left: 0, right: 0, width: 0, height: ROW_H };
    },
  });
  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 500, writable: true, configurable: true });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

async function mount(reading?: ReadonlyMap<BlockId, ReadLevel>, matches?: Map<BlockId, BlockMatch>) {
  await act(async () => {
    root.render(createElement(Spine, { outline: outline(), layoutKey: "x", onJump: () => {}, matches, reading }));
  });
  await act(async () => {
    (window as unknown as { scrollY: number }).scrollY = 1200 - READING_OFFSET;
    window.dispatchEvent(new Event("scroll"));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 32));
  });
  expect(host.querySelector(".spine-viewport"), "the rail must have measured").not.toBeNull();
}

const runs = () => [...host.querySelectorAll<HTMLElement>(".spine-read")];

describe("the reading layer in the spine", () => {
  it("draws nothing when there is no reading time, which is every visitor", async () => {
    await mount();
    expect(runs()).toHaveLength(0);
  });

  it("draws one run per stretch, placed on the rail's document-pixel ruler", async () => {
    await mount(
      new Map<BlockId, ReadLevel>([
        ["b0", 4],
        ["b1", 4],
        ["b2", 4],
        ["b3", 4],
        ["b4", 1],
      ]),
    );
    const drawn = runs();
    expect(drawn).toHaveLength(2);
    /* 2000px of document: rows 0–3 are 0%–20%, row 4 is 20%–25%. */
    expect(drawn[0]?.style.top).toBe("0%");
    expect(drawn[0]?.style.height).toBe("20%");
    expect(drawn[0]?.dataset.level).toBe("4");
    expect(drawn[1]?.style.top).toBe("20%");
    expect(drawn[1]?.style.height).toBe("5%");
    expect(drawn[1]?.dataset.level).toBe("1");
    expect(drawn.every((el) => el.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("paints after the parts and under the section fill, the hairlines and the search marks", async () => {
    const matches = new Map<BlockId, BlockMatch>([
      ["b12" as BlockId, { searches: [{ runId: "r1", slot: 0 }], count: 1 }],
    ]);
    await mount(new Map<BlockId, ReadLevel>([["b12", 4]]), matches);

    const kids = [...(host.querySelector(".spine-track")?.children ?? [])];
    const first = (c: string) => kids.findIndex((el) => el.classList.contains(c));
    const last = (c: string) => {
      let at = -1;
      kids.forEach((el, i) => {
        if (el.classList.contains(c)) at = i;
      });
      return at;
    };
    for (const c of ["spine-part", "spine-read", "spine-here", "spine-tick", "spine-matches", "spine-hit"]) {
      expect(first(c), `the fixture should render a ${c}`).toBeGreaterThanOrEqual(0);
    }
    expect(first("spine-read"), "after every part").toBeGreaterThan(last("spine-part"));
    expect(last("spine-read"), "under the section fill").toBeLessThan(first("spine-here"));
    expect(last("spine-read"), "under the hairlines").toBeLessThan(first("spine-tick"));
    expect(last("spine-read"), "under the search marks").toBeLessThan(first("spine-matches"));
    expect(last("spine-read"), "under the hit targets").toBeLessThan(first("spine-hit"));
  });
});
