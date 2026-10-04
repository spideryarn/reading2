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
import type { ReadReach } from "../src/web/reading-time.js";
import { readerReadingProbe, readingHarnessOwner, readingHarnessView } from "./helpers/reader-reading-harness.js";

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

  it("keeps neighbours a sixteenth apart as two runs — the curve must show both reaches", () => {
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
  /* A document 2000px tall, so an ease reaches at most 20px either side of a boundary. */
  const DOC = 2000;
  /** Every coordinate in a path: `M`, `C` and `V` are all it has. */
  const points = (d: string): { xs: number[]; ys: number[] } => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const m of d.matchAll(/([MCV])([^MCVZ]*)/g)) {
      const nums = (m[2] ?? "").trim().split(/[ ,]+/).map(Number);
      if (m[1] === "V") ys.push(nums[0] ?? Number.NaN);
      else nums.forEach((n, i) => {
        (i % 2 === 0 ? xs : ys).push(n);
      });
    }
    return { xs, ys };
  };

  it("is two empty paths when nothing has been read", () => {
    expect(readingAreaPaths([], DOC)).toEqual({ area: "", edge: "" });
  });

  it("draws nothing for zero-height runs, rather than a stroke across the rail", () => {
    const rows = new Map<string, Row>([
      ["b0", { index: 0, top: 40, height: 0 }],
      ["b1", { index: 1, top: 40, height: 0 }],
    ]);
    const runs = readingRuns(rows, new Map([["b0", 16], ["b1", 4]]));
    expect(readingAreaPaths(runs, DOC)).toEqual({ area: "", edge: "" });
  });

  it("zero-height runs at stretch ends or between visible runs do not change the curve", () => {
    const visible = [
      { top: 0, height: 50, reach: 4 },
      { top: 50, height: 50, reach: 12 },
    ];
    const rows = new Map<string, Row>([
      ["b0", { index: 0, top: 0, height: 0 }],
      ["b1", { index: 1, top: 0, height: 50 }],
      ["b2", { index: 2, top: 50, height: 0 }],
      ["b3", { index: 3, top: 50, height: 50 }],
      ["b4", { index: 4, top: 100, height: 0 }],
    ]);
    const reach = new Map([["b0", 16], ["b1", 4], ["b2", 16], ["b3", 12], ["b4", 16]]);
    expect(readingAreaPaths(readingRuns(rows, reach), DOC)).toEqual(readingAreaPaths(visible, DOC));
  });

  it("eases out from the left edge, runs straight down at the reach, and eases back", () => {
    expect(readingAreaPaths([{ top: 100, height: 200, reach: 6 }], DOC)).toEqual({
      /* The area is the edge, closed down the rail's left side. */
      area: "M0 100C0 110 6 110 6 120V280C6 290 0 290 0 300Z",
      edge: "M0 100C0 110 6 110 6 120V280C6 290 0 290 0 300",
    });
  });

  it("joins neighbouring runs of different reach with a curve centred on their boundary, never a step", () => {
    const paths = readingAreaPaths(
      [
        { top: 0, height: 100, reach: 5 },
        { top: 100, height: 50, reach: 12 },
        { top: 150, height: 50, reach: 4 },
      ],
      DOC,
    );
    expect(paths.edge).toBe(
      "M0 0C0 10 5 10 5 20V80C5 100 12 100 12 120V130C12 150 4 150 4 170V180C4 190 0 190 0 200",
    );
    expect(paths.area).toBe(`${paths.edge}Z`);
    /* The skyline was the `H`s (spya-bguwsn). */
    expect(paths.edge).not.toContain("H");
  });

  it("breaks across an unread gap, and draws nothing in it", () => {
    const paths = readingAreaPaths(
      [
        { top: 0, height: 100, reach: 8 },
        { top: 300, height: 100, reach: 8 },
      ],
      DOC,
    );
    expect(paths.edge).toBe("M0 0C0 10 8 10 8 20V80C8 90 0 90 0 100M0 300C0 310 8 310 8 320V380C8 390 0 390 0 400");
    expect(paths.area).toBe("M0 0C0 10 8 10 8 20V80C8 90 0 90 0 100ZM0 300C0 310 8 310 8 320V380C8 390 0 390 0 400Z");
    /* Nothing in either path has a y between the two stretches: a curve that
       reached into the gap would say the reader had read what they skipped. */
    expect(points(paths.edge).ys.some((y) => y > 100 && y < 300)).toBe(false);
  });

  it("caps an ease at a hundredth of the document, so a long run keeps a straight side", () => {
    const paths = readingAreaPaths(
      [
        { top: 0, height: 5000, reach: 16 },
        { top: 5000, height: 5000, reach: 4 },
      ],
      10000,
    );
    /* 100px either side of the boundary, not 2500. */
    expect(paths.edge).toBe("M0 0C0 50 16 50 16 100V4900C16 5000 4 5000 4 5100V9900C4 9950 0 9950 0 10000");
  });

  it("gives a run too short for two full eases half of itself to each", () => {
    /* One isolated block, 10px tall: up over the first half, back over the second. */
    expect(readingAreaPaths([{ top: 40, height: 10, reach: 16 }], DOC).edge).toBe(
      "M0 40C0 42.5 16 42.5 16 45C16 47.5 0 47.5 0 50",
    );
  });

  it("still joins two neighbours whose measured edges differ by a fraction of a pixel", () => {
    /* Row tops come from `getBoundingClientRect`, so a neighbour's top is not
       always exactly the row above's bottom. A skipped row is far taller. */
    const paths = readingAreaPaths(
      [
        { top: 0, height: 100.25, reach: 8 },
        { top: 100.5, height: 99.5, reach: 12 },
      ],
      DOC,
    );
    expect(paths.edge.match(/M/g)).toHaveLength(1);
    expect(paths.edge).toContain("C8 100.5 12 100.5 12 120.5");
  });

  it.each([
    ["a gap", 24.75],
    ["an overlap", 23.25],
  ])("never goes back up the rail when joined runs' edges disagree by %s (GPT Sol's F1)", (_what, secondTop) => {
    /* Two rows a line of text tall, with a cap above half of either: every
       ease takes its whole half-run, so a boundary that is not where the run
       above ended is the case where two eases could cross. */
    const { ys } = points(
      readingAreaPaths(
        [
          { top: 0, height: 24, reach: 16 },
          { top: secondTop, height: 24, reach: 4 },
          { top: secondTop + 24, height: 0, reach: 12 },
        ],
        20000,
      ).edge,
    );
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(ys.every((y) => y >= 0 && y <= secondTop + 24)).toBe(true);
  });

  it("never goes back up the rail even when an overlap is larger than the rows it joins", () => {
    /* Not a measurement a real page gives (a row is a line of text tall or
       folded to nothing), but the tolerance admits it, so the path must too. */
    const { ys } = points(
      readingAreaPaths(
        [
          { top: 0, height: 0.5, reach: 16 },
          { top: -0.3, height: 0.5, reach: 4 },
        ],
        20000,
      ).edge,
    );
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("never leaves the rail or its own stretch, and never goes back up it", () => {
    const runs = [
      { top: 10, height: 3, reach: 16 },
      { top: 13, height: 60, reach: 4 },
      { top: 73, height: 1, reach: 16 },
      { top: 74, height: 200, reach: 9 },
      { top: 500, height: 2, reach: 16 },
    ];
    const { xs, ys } = points(readingAreaPaths(runs, DOC).edge);
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(16);
    expect(ys.every((y) => (y >= 10 && y <= 274) || (y >= 500 && y <= 502))).toBe(true);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
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

  it("draws the area and the edge over the whole track, on the rail's document-pixel ruler", async () => {
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
    expect(paths.map((p) => p.getAttribute("class"))).toEqual(["spine-read-area"]);
    expect(paths[0]?.getAttribute("d")).toBe(
      "M0 0C0 10 16 10 16 20V380C16 400 5 400 5 420V480C5 490 0 490 0 500ZM0 700C0 710 9 710 9 720V780C9 790 0 790 0 800Z",
    );

    /* The edge is a layer of its own, on the same ruler — the order test below
       says why. */
    const line = host.querySelector<SVGSVGElement>("svg.spine-read-line");
    expect(line?.getAttribute("viewBox")).toBe("0 0 16 2000");
    expect(line?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(line?.getAttribute("aria-hidden")).toBe("true");
    const edges = [...(line?.querySelectorAll("path") ?? [])];
    expect(edges.map((p) => p.getAttribute("class"))).toEqual(["spine-read-edge"]);
    expect(edges[0]?.getAttribute("d")).toBe(
      "M0 0C0 10 16 10 16 20V380C16 400 5 400 5 420V480C5 490 0 490 0 500M0 700C0 710 9 710 9 720V780C9 790 0 790 0 800",
    );
  });

  it("keeps a full-reach edge inside the rail rather than half clipped (GPT Sol's F3)", () => {
    /* jsdom cannot see a clipped stroke, so this reads the rule: the layer
       stops half a pixel short of the rail's right side and does not clip its
       own overflow, so a 1px stroke centred on x = 16 ends exactly at it; and
       the stroke is a pixel whatever the two axes are stretched by. */
    const css = readFileSync("src/web/styles/spine.css", "utf8");
    const rule = /\.spine-read,\s*\.spine-read-line\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/width:\s*calc\(100% - 0\.5px\)/);
    expect(rule).toMatch(/overflow:\s*visible/);
    const edge = /\.spine-read-edge\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(edge).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(edge).toMatch(/stroke-width:\s*1px/);
    expect(edge).toMatch(/fill:\s*none/);
    expect(edge).toMatch(/stroke:\s*var\(--read-time\)/);
  });

  it("keeps the reading chart quieter at the chosen area and edge opacities", () => {
    const css = readFileSync("src/web/styles/spine.css", "utf8");
    const area = /\.spine-read-area\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    const edge = /\.spine-read-edge\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(area).toMatch(/fill-opacity:\s*0\.18\s*;/);
    expect(edge).toMatch(/stroke-opacity:\s*0\.65\s*;/);
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

    /* The edge alone goes over the section fill: under it the line kept a
       fifth of its colour, and the section you are in is where you most want
       to see how far you got (the browser check on 261003j). Still under the
       hairlines and everything a reader asked for. */
    expect(first("spine-read-line"), "the fixture should render the edge").toBeGreaterThanOrEqual(0);
    expect(first("spine-read-line"), "over the section fill").toBeGreaterThan(last("spine-here"));
    expect(last("spine-read-line"), "under the hairlines").toBeLessThan(first("spine-tick"));
    expect(last("spine-read-line"), "under the search marks").toBeLessThan(first("spine-matches"));
  });
});

describe("what a reach step wakes", () => {
  it.each([false, true])("updates the spine without rendering the prose again (marginalia=%s)", async (margin) => {
    readerReadingProbe.table.mockClear();
    readerReadingProbe.spine.mockClear();
    readerReadingProbe.gutter.mockClear();
    const owner = readingHarnessOwner();
    await act(async () => root.render(readingHarnessView(owner, margin)));
    const before = readerReadingProbe.table.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    const firstProps = readerReadingProbe.table.mock.lastCall?.[0] as { margin: unknown };
    if (margin) expect(firstProps.margin, "the positive control must have marginalia room").toBeInstanceOf(Map);
    else expect(firstProps.margin).toBeNull();
    const reach = new Map<BlockId, ReadReach>([["spya-aaaaaa", 5]]);
    await act(async () => root.render(readingHarnessView({ ...owner, readingTime: { ...owner.readingTime, reach } }, margin)));
    expect(readerReadingProbe.spine.mock.lastCall?.[0].reading).toBe(reach);
    expect(readerReadingProbe.gutter.mock.lastCall?.[0].levels).toBe(owner.readingTime.levels);
    expect(readerReadingProbe.table.mock.calls.length).toBe(before);
  });
});

describe("the spine's reading-time help", () => {
  it("allows recorded time below the drawing threshold to leave no shading", async () => {
    const { readReach } = await import("../src/web/reading-time.js");
    const { HELP_TOPICS } = await import("../src/web/help/help-topics.js");
    const { renderToStaticMarkup } = await import("react-dom/server");
    /* Twenty seconds spent on 230 words is recorded, but not yet drawn. */
    await mount(new Map([["b0", readReach(20, 230)]]));
    expect(layers()).toHaveLength(0);
    const help = document.createElement("div");
    help.innerHTML = renderToStaticMarkup(HELP_TOPICS.spine.body);
    const words = help.textContent?.replace(/\s+/g, " ") ?? "";
    expect(words).not.toContain("No shading means you have not read");
    expect(words).toMatch(/a quick glance.*no shading/i);
  });
});
