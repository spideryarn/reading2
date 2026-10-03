// @vitest-environment jsdom
/**
 * **Where you have spent time reading, down the rail**: the `.spine-read` layer,
 * `readingRuns` and `readingAreaPaths`.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md,
 * and, for the area chart it is drawn as since 2026-10-03,
 * docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md.
 *
 * jsdom cannot see paint, so what this pins is the geometry of each run, the
 * two path strings, and the layer's place in the track's tree order, which is
 * its paint order: under the current-section fill, the hairlines and the search
 * marks. The harness is tests/spine-here.test.ts's, whose header says why each
 * piece of it is there.
 */
import { readFileSync } from "node:fs";
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
import type { BlockMatch } from "../src/web/search-hits.js";
import { type Row, readingAreaPaths, readingRuns } from "../src/web/spine-marks.js";
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

  it("merges neighbouring rows at the same reach into one run", () => {
    const reach = new Map<string, number>([
      ["b0", 16],
      ["b1", 16],
      ["b2", 16],
      ["b3", 9],
    ]);
    expect(readingRuns(rows, reach)).toEqual([
      { top: 0, height: 300, reach: 16 },
      { top: 300, height: 100, reach: 9 },
    ]);
  });

  it("keeps neighbours a sixteenth apart as two runs — the line has to step", () => {
    const reach = new Map<string, number>([
      ["b0", 9],
      ["b1", 10],
    ]);
    expect(readingRuns(rows, reach)).toEqual([
      { top: 0, height: 100, reach: 9 },
      { top: 100, height: 100, reach: 10 },
    ]);
  });

  it("does not bridge a row the reader skipped, even between two at the same reach", () => {
    const reach = new Map<string, number>([
      ["b1", 13],
      ["b3", 13],
    ]);
    expect(readingRuns(rows, reach)).toEqual([
      { top: 100, height: 100, reach: 13 },
      { top: 300, height: 100, reach: 13 },
    ]);
  });

  it("ignores reach 0 and blocks this page does not have, whatever order the map is in", () => {
    const reach = new Map<string, number>([
      ["b5", 4],
      ["gone", 16],
      ["b4", 4],
      ["b2", 0],
    ]);
    expect(readingRuns(rows, reach)).toEqual([{ top: 400, height: 200, reach: 4 }]);
  });
});

describe("readingAreaPaths", () => {
  it("is two empty paths when nothing has been read", () => {
    expect(readingAreaPaths([])).toEqual({ area: "", edge: "" });
  });

  it("fills each run from the left edge out to its reach, and lines its right-hand side only", () => {
    expect(readingAreaPaths([{ top: 100, height: 200, reach: 6 }])).toEqual({
      area: "M0 100H6V300H0Z",
      /* No stroke along the top, the bottom or the left: only the water level. */
      edge: "M6 100V300",
    });
  });

  it("joins neighbouring runs of different reach with a horizontal step, in one subpath", () => {
    const paths = readingAreaPaths([
      { top: 0, height: 100, reach: 5 },
      { top: 100, height: 50, reach: 12 },
      { top: 150, height: 50, reach: 4 },
    ]);
    expect(paths.edge).toBe("M5 0V100H12V150H4V200");
    expect(paths.area).toBe("M0 0H5V100H0ZM0 100H12V150H0ZM0 150H4V200H0Z");
  });

  it("breaks the line across an unread gap, and draws nothing along it", () => {
    const paths = readingAreaPaths([
      { top: 0, height: 100, reach: 8 },
      { top: 300, height: 100, reach: 8 },
    ]);
    expect(paths.edge).toBe("M8 0V100M8 300V400");
    expect(paths.area).toBe("M0 0H8V100H0ZM0 300H8V400H0Z");
    /* Nothing in either path has a y between the two stretches. */
    const ys = [...`${paths.area}${paths.edge}`.matchAll(/[V ](\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    expect(ys.some((y) => y > 100 && y < 300)).toBe(false);
  });

  it("still joins two neighbours whose measured edges differ by a fraction of a pixel", () => {
    /* Row tops come from `getBoundingClientRect`, so a neighbour's top is not
       always exactly the row above's bottom. A skipped row is far taller. */
    const paths = readingAreaPaths([
      { top: 0, height: 100.25, reach: 8 },
      { top: 100.5, height: 99.5, reach: 12 },
    ]);
    expect(paths.edge).toBe("M8 0V100.25H12V200");
  });

  it("reaches the viewBox's far side at full reach — the half-pixel inset is the stylesheet's", () => {
    expect(readingAreaPaths([{ top: 0, height: 100, reach: 16 }])).toEqual({
      area: "M0 0H16V100H0Z",
      edge: "M16 0V100",
    });
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

async function mount(reading?: ReadonlyMap<BlockId, number>, matches?: Map<BlockId, BlockMatch>) {
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

const layers = () => [...host.querySelectorAll<SVGSVGElement>(".spine-read")];

describe("the reading layer in the spine", () => {
  it("draws nothing when there is no reading time, which is every visitor", async () => {
    await mount();
    expect(layers()).toHaveLength(0);
    await act(async () => {
      root.render(createElement(Spine, { outline: outline(), layoutKey: "x", onJump: () => {}, reading: new Map() }));
    });
    expect(layers(), "an owner who has read nothing yet").toHaveLength(0);
  });

  it("draws one svg over the whole track, on the rail's document-pixel ruler", async () => {
    await mount(
      new Map<BlockId, number>([
        ["b0", 16],
        ["b1", 16],
        ["b2", 16],
        ["b3", 16],
        ["b4", 5],
        ["b7", 9],
      ]),
    );
    const drawn = layers();
    expect(drawn).toHaveLength(1);
    const svg = drawn[0]!;
    expect(svg.tagName.toLowerCase()).toBe("svg");
    /* Sixteen across, and the document's 2000px down: a run's top and height
       are the same numbers every other mark on the rail is placed by. */
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 2000");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");

    const paths = [...svg.querySelectorAll("path")];
    expect(paths.map((p) => p.getAttribute("class"))).toEqual(["spine-read-area", "spine-read-edge"]);
    expect(paths[0]?.getAttribute("d")).toBe("M0 0H16V400H0ZM0 400H5V500H0ZM0 700H9V800H0Z");
    expect(paths[1]?.getAttribute("d")).toBe("M16 0V400H5V500M9 700V800");
  });

  it("keeps a full-reach edge inside the rail rather than half clipped (GPT Sol's F3)", () => {
    /* jsdom cannot see a clipped stroke, so this reads the rule: the layer
       stops half a pixel short of the rail's right side and does not clip its
       own overflow, so a 1px stroke centred on x = 16 ends exactly at it; and
       the stroke is a pixel whatever the two axes are stretched by. */
    const css = readFileSync("src/web/styles/spine.css", "utf8");
    const rule = /\.spine-read\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*calc\(100% - 0\.5px\)/);
    expect(rule).toMatch(/overflow:\s*visible/);
    const edge = /\.spine-read-edge\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(edge).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(edge).toMatch(/stroke-width:\s*1px/);
    expect(edge).toMatch(/fill:\s*none/);
    expect(edge).toMatch(/stroke:\s*var\(--read-time\)/);
  });

  it("paints after the parts and under the section fill, the hairlines and the search marks", async () => {
    const matches = new Map<BlockId, BlockMatch>([
      ["b12" as BlockId, { searches: [{ runId: "r1", slot: 0 }], count: 1 }],
    ]);
    await mount(new Map<BlockId, number>([["b12", 16]]), matches);

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

describe("what a reach step wakes", () => {
  /* A reach step re-renders `OwnedReader`, which hands `Reader` a new
     capability object every render (ArticlePage.tsx), so any callback that
     depends on the whole `owner` is a new function each time — and
     `selectProse` goes to `memo(TableView)` as `onSelect`. Nothing in this repo
     mounts the whole `Reader` (tests/touch-selection-chip.test.tsx says so), so
     this reads the dependency list: a tripwire, not a render count. GPT Sol's
     F2 on docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md. */
  it("selectProse does not depend on the owner object, which is new on every reach step", () => {
    const source = readFileSync("src/web/reader/Reader.tsx", "utf8");
    const at = source.indexOf("const selectProse = useCallback(");
    expect(at, "Reader.tsx no longer has selectProse — this test has lost its subject").toBeGreaterThan(-1);
    const deps = /\n {4}\[([^\]]*)\],\n {2}\);/.exec(source.slice(at))?.[1];
    expect(deps, "selectProse's dependency list").toBeDefined();
    expect(deps?.split(",").map((d) => d.trim())).not.toContain("owner");
  });

  it("Reader hands the spine the reach map, and the gutter the levels", () => {
    const source = readFileSync("src/web/reader/Reader.tsx", "utf8");
    expect(source).toContain("reading={owner?.readingTime.reach}");
    expect(source).toContain("<ReadingTimeStyle levels={owner.readingTime.levels} />");
  });
});
