// @vitest-environment jsdom
/**
 * **The ribbon between Structure's two columns joins the marked part to the
 * whole of column B, and is drawn only when there is something to join.**
 *
 * jsdom does no layout, so the panel test stubs `getBoundingClientRect` with a
 * layout of its own and checks the panel read the right elements: the marked row
 * in the *visible* column A (the hidden measuring copies carry an
 * `aria-current` row too, at a different place), column B's header and its
 * visible list. Whether the drawn shape reads as a Sankey link is a browser
 * question — docs/plans/261020l-structure-columns-sankey-ribbon.md § Evidence.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";
import { StructurePanel } from "../src/web/StructurePanel.js";
import { STRUCT_BRACKET_PX } from "../src/web/layout.js";
import { RIBBON_EDGE_INSET_PX, ribbonFrom, ribbonPath } from "../src/web/structure-ribbon.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";

/* Part one undivided; part two in two sections. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-r${String(n).padStart(4, "0")}` as BlockId;
  const block = () => {
    const n = blocks.length;
    blocks.push({ id: id(n), tag: "p", kind: "text", text: `block ${n}`, words: 2, html: `<p>block ${n}</p>`, gistable: true });
    return n;
  };
  const a0 = block();
  const a1 = block();
  nodes["n-p1"] = { id: "n-p1", depth: 1, parent: "n-r", children: [], range: [id(a0), id(a1)], title: "PART ONE", gist: "One." };
  const kids: NodeId[] = [];
  const p2First = blocks.length;
  for (let s = 0; s < 2; s++) {
    const f = block();
    const l = block();
    const sid = `n-s${s}` as NodeId;
    nodes[sid] = { id: sid, depth: 2, parent: "n-p2", children: [], range: [id(f), id(l)], title: `SECTION ${s}`, gist: `S${s}.` };
    kids.push(sid);
  }
  nodes["n-p2"] = { id: "n-p2", depth: 1, parent: "n-r", children: kids, range: [id(p2First), id(blocks.length - 1)], title: "PART TWO", gist: "Two." };
  nodes["n-r"] = { id: "n-r", depth: 0, parent: null, children: ["n-p1", "n-p2"], range: [id(0), id(blocks.length - 1)], title: "Root", gist: "Root." };
  return { tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes }, blocks };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const summaryRoot = buildSummaryTree(tree, blocks, geometry.leafDepth);
const rowOf = (node: NodeId) => blocks.findIndex((x) => x.id === tree.nodes[node]?.range[0]);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let reactRoot: Root;
let mounted = false;

function render(focusRow: number) {
  act(() => {
    reactRoot.render(
      <StructurePanel root={summaryRoot} figures={[]} focusRow={focusRow} allowParagraphs={true} onJump={() => {}} />,
    );
  });
  const band = host.querySelector(".mode-band.struct");
  if (!band) throw new Error("no Structure band rendered");
  return band;
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

/**
 * A made-up layout: a grid at (100, 50), column A's rows 300px wide, column
 * B's rows from x=428 (a 16px gutter and the bracket's inset), the marked part
 * at 200–240, column B's header at 50–70 and its list at 76–176. **The
 * measuring copies get a different place** (900, and lists of their own), so a
 * panel that read the hidden marked row would draw a ribbon starting at 850.
 * `markedTop` moves the visible marked row, for the redraw tests.
 */
let markedTop = 200;
let gridHeight = 600;
let visibleListHeight = 100;
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const hidden = el.closest(".struct-measure") !== null;
    if (el.classList.contains("struct-grid")) return rect(100, 50, 616, gridHeight);
    if (hidden) return rect(100, 900, 300, 40);
    if (el.classList.contains("struct-of")) return rect(428, 50, 288, 20);
    if (el.classList.contains("struct-col") && el.closest(".struct-inner")) {
      return rect(428, 76, 288, visibleListHeight);
    }
    if (el.classList.contains("struct-row") && el.hasAttribute("aria-current") && !el.closest(".struct-inner")) {
      return rect(100, markedTop, 300, 40);
    }
    return rect(100, 50, 300, 300);
  });
}

/** A ResizeObserver the test can fire, standing in for jsdom's missing one. */
let observers: { cb: () => void; els: Element[] }[] = [];
let fontListeners = new Set<() => void>();

function stubCapacityMetrics() {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("struct-grid") ? gridHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("struct-row") || this.querySelector(":scope > .struct-row")) return 40;
    if (this.classList.contains("struct-elided")) return 20;
    return 0;
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  mounted = true;
  markedTop = 200;
  gridHeight = 600;
  visibleListHeight = 100;
  observers = [];
  fontListeners = new Set();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      addEventListener(type: string, fn: () => void) {
        if (type === "loadingdone") fontListeners.add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        if (type === "loadingdone") fontListeners.delete(fn);
      },
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      entry: { cb: () => void; els: Element[] };
      constructor(cb: () => void) {
        this.entry = { cb, els: [] };
        observers.push(this.entry);
      }
      observe(el: Element) {
        this.entry.els.push(el);
      }
      disconnect() {
        observers = observers.filter((o) => o !== this.entry);
      }
    },
  );
});

afterEach(() => {
  if (mounted) act(() => reactRoot.unmount());
  host.remove();
  Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const EXPECTED = { x0: 300, xEdge: 324, aTop: 150, aBottom: 190, bTop: 0, bBottom: 126 };

describe("the ribbon's geometry", () => {
  const grid = rect(100, 50, 616, 600);
  const row = rect(100, 200, 300, 40);
  const head = rect(428, 50, 288, 20);
  const list = rect(428, 76, 288, 100);

  it("runs from the row's height on the left to column B's header-through-list on the right", () => {
    expect(ribbonFrom(grid, row, head, list)).toEqual(EXPECTED);
    expect(EXPECTED.xEdge).toBe(428 - RIBBON_EDGE_INSET_PX - 100);
  });

  it("starts at the list when column B has no header", () => {
    expect(ribbonFrom(grid, row, null, list)?.bTop).toBe(26);
  });

  it("is nothing when there is no marked part, no list, or no real layout", () => {
    expect(ribbonFrom(grid, null, null, list)).toBeNull();
    expect(ribbonFrom(grid, row, null, null)).toBeNull();
    const none = rect(0, 0, 0, 0);
    expect(ribbonFrom(none, none, none, none)).toBeNull();
    expect(ribbonFrom(grid, rect(100, Number.NaN, 300, 40), head, list)).toBeNull();
    /* Column B's rows left of column A's edge: reversed, not a ribbon. */
    expect(ribbonFrom(grid, row, null, rect(200, 76, 288, 100))).toBeNull();
  });

  it("rejects every endpoint when it is vertically outside the grid", () => {
    expect(ribbonFrom(grid, rect(100, 48, 300, 40), head, list)).toBeNull();
    expect(ribbonFrom(grid, rect(100, 620, 300, 40), head, list)).toBeNull();
    expect(ribbonFrom(grid, row, rect(428, 48, 288, 20), list)).toBeNull();
    expect(ribbonFrom(grid, row, rect(428, 640, 288, 20), list)).toBeNull();
    expect(ribbonFrom(grid, row, head, rect(428, 48, 288, 100))).toBeNull();
    expect(ribbonFrom(grid, row, head, rect(428, 600, 288, 100))).toBeNull();
  });

  it("is a closed band whose ends are the two heights", () => {
    expect(ribbonPath(EXPECTED)).toBe("M 300 150 C 312 150 312 0 324 0 L 324 126 C 312 126 312 190 300 190 Z");
  });

  it("puts the orange thumb on the ribbon's edge, where the stylesheet says", () => {
    const css = readFileSync("src/web/styles/structure-mode.css", "utf8");
    expect(css).toMatch(
      new RegExp(
        String.raw`\.struct-grid\[data-ribbon\] > \.struct-inner \.struct-row\[aria-current\]:not\(\.struct-ancestor\)::before \{\s*left: -${RIBBON_EDGE_INSET_PX}px;`,
      ),
    );
    expect(css).toMatch(
      /\.struct-grid\[data-ribbon\] > \.struct-side:not\(\.struct-inner\) \.struct-row\[aria-current\]:hover \{\s*background: var\(--surface-raised\);/,
    );
    expect(css).toMatch(/\.struct-ribbon \{[^}]*pointer-events: none;/s);
    expect(css).toMatch(
      /\.struct-grid\[data-ribbon\] > \.struct-inner \{\s*border-left-color: transparent;\s*\}/,
    );
  });
});

describe("the Structure panel draws it", () => {
  it("draws no ribbon without layout, and keeps the bracket", () => {
    const band = render(rowOf("n-s0"));
    expect(band.querySelector(".struct-ribbon")).toBeNull();
    expect(band.querySelector(".struct-grid")?.hasAttribute("data-ribbon")).toBe(false);
  });

  it("joins the visible marked part to column B, not the measuring copy's", () => {
    stubLayout();
    const band = render(rowOf("n-s0"));
    const path = band.querySelector(".struct-ribbon path.struct-ribbon-band");
    expect(path?.getAttribute("d")).toBe(ribbonPath(EXPECTED));
    const svg = band.querySelector(".struct-ribbon");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
    expect(svg?.textContent).toBe("");
    const edge = svg?.querySelector(".struct-ribbon-edge");
    expect({
      x: edge?.getAttribute("x"),
      y: edge?.getAttribute("y"),
      width: edge?.getAttribute("width"),
      height: edge?.getAttribute("height"),
    }).toEqual({
      x: String(EXPECTED.xEdge),
      y: String(EXPECTED.bTop),
      width: String(STRUCT_BRACKET_PX),
      height: "126",
    });
    /* The CSS hook that hands the bracket over to the ribbon's own edge. */
    expect(band.querySelector(".struct-grid")?.hasAttribute("data-ribbon")).toBe(true);
    const markedSources = band.querySelectorAll(
      ".struct-grid[data-ribbon] > .struct-side:not(.struct-inner) .struct-row[aria-current]",
    );
    expect(markedSources).toHaveLength(1);
    expect(markedSources[0]?.closest(".struct-measure")).toBeNull();
  });

  it("redraws when the marked row moves without a new render", () => {
    stubLayout();
    const band = render(rowOf("n-s0"));
    const row = band.querySelector(".struct-grid > .struct-side:not(.struct-inner) .struct-row[aria-current]");
    const watching = observers.find((o) => row && o.els.includes(row));
    expect(watching, "the marked row is observed").toBeDefined();
    markedTop = 260;
    act(() => watching?.cb());
    expect(band.querySelector(".struct-ribbon-band")?.getAttribute("d")).toBe(
      ribbonPath({ ...EXPECTED, aTop: 210, aBottom: 250 }),
    );
  });

  it("observes every visible endpoint and the actual capacity-measuring lists", () => {
    stubLayout();
    const band = render(rowOf("n-s0"));
    const grid = band.querySelector(".struct-grid");
    const sideA = band.querySelector(".struct-grid > .struct-side:not(.struct-inner)");
    const row = sideA?.querySelector(".struct-row[aria-current]");
    const listA = sideA?.querySelector(".struct-col");
    const sideB = band.querySelector(".struct-grid > .struct-inner");
    const head = sideB?.querySelector(".struct-of");
    const listB = sideB?.querySelector(".struct-col");
    const ribbonObserver = observers.find((o) => row && o.els.includes(row));
    expect(ribbonObserver?.els).toEqual([grid, listA, row, head, listB]);

    const measured = [...band.querySelectorAll("[data-struct-measure]")];
    const capacityObserver = observers.find((o) => measured.every((list) => o.els.includes(list)));
    expect(capacityObserver, "the capacity observer watches both measuring lists").toBeDefined();
    expect(measured.every((list) => list.tagName === "OL")).toBe(true);
  });

  it("redraws around a capacity-window change", () => {
    markedTop = 80;
    gridHeight = 140;
    visibleListHeight = 100;
    stubLayout();
    stubCapacityMetrics();
    const band = render(rowOf("n-s0"));
    const measured = [...band.querySelectorAll("[data-struct-measure]")];
    const capacityObserver = observers.find((o) => measured.every((list) => o.els.includes(list)));
    expect(capacityObserver).toBeDefined();

    gridHeight = 90;
    visibleListHeight = 60;
    const grid = band.querySelector<HTMLElement>(".struct-grid");
    const measuredB = band.querySelector<HTMLElement>('[data-struct-measure="b"]');
    expect(grid?.clientHeight).toBe(90);
    expect(grid?.getBoundingClientRect().bottom).toBe(140);
    expect([...measuredB?.children ?? []].map((el) => (el as HTMLElement).offsetHeight)).toEqual([40, 40, 20]);
    act(() => capacityObserver?.cb());

    expect(band.querySelectorAll(".struct-grid > .struct-inner .struct-row")).toHaveLength(1);
    expect(band.querySelector(".struct-grid > .struct-inner .struct-elided")?.textContent).toContain("later");
    expect(band.querySelector(".struct-ribbon-band")?.getAttribute("d")).toBe(
      ribbonPath({ ...EXPECTED, aTop: 30, aBottom: 70, bBottom: 86 }),
    );
  });

  it("redraws on font completion and removes every observer and listener on cleanup", () => {
    stubLayout();
    const band = render(rowOf("n-s0"));
    expect(fontListeners.size, "capacity and ribbon each subscribe to font completion").toBe(2);

    markedTop = 260;
    act(() => {
      for (const fn of [...fontListeners]) fn();
    });
    expect(band.querySelector(".struct-ribbon-band")?.getAttribute("d")).toBe(
      ribbonPath({ ...EXPECTED, aTop: 210, aBottom: 250 }),
    );

    act(() => reactRoot.unmount());
    mounted = false;
    expect(observers).toEqual([]);
    expect(fontListeners.size).toBe(0);
  });

  it("goes when the reader crosses into a part with no sections, and comes back", () => {
    stubLayout();
    render(rowOf("n-s0"));
    let band = render(rowOf("n-p1"));
    expect(band.querySelector(".struct-ribbon")).toBeNull();
    band = render(rowOf("n-s1"));
    expect(band.querySelector(".struct-ribbon")).not.toBeNull();
  });

  it("draws none on a part with no sections", () => {
    stubLayout();
    const band = render(rowOf("n-p1"));
    expect(band.querySelector(".struct-ribbon")).toBeNull();
    expect(band.querySelector(".struct-grid")?.hasAttribute("data-ribbon")).toBe(false);
  });
});
