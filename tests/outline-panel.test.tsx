// @vitest-environment jsdom
/**
 * Outline mode's panel — the half that needs a DOM: **which rung it chooses.**
 *
 * ## What this can and cannot prove
 *
 * jsdom does no layout. Every element's `scrollHeight` and `clientHeight` are
 * 0, so the assertion the plan originally promised — "the rendered list fits,
 * `scrollHeight <= clientHeight`" — would read `0 <= 0` here and pass on any
 * code whatsoever, including code that overflows every real browser. That is a
 * check that cannot fail, which docs/reusable/silent-success.md says is not a
 * check at all.
 *
 * So the two halves are split honestly:
 *
 *  - **Here:** the selection logic, with heights stubbed. Given candidates of
 *    known heights and a band of known height, does the panel take the largest
 *    rung that fits, fall back correctly when none fits, and settle rather than
 *    oscillate? That is real logic and it is fully testable.
 *  - **In a browser:** whether the *real* rendered list actually fits, which is
 *    a question about fonts, wrapping and the band's true width. See
 *    docs/project/browser-testing.md, and note the two traps recorded there
 *    that bite exactly this feature: a hidden tab runs no rAF and does not
 *    animate, and a stale parsed stylesheet gives correct CSS text with older
 *    computed styles.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "../src/web/OutlinePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

/* A tree big enough that the rungs differ in height: one part, four sections,
   the first with five paragraphs. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-c${String(n).padStart(4, "0")}`;
  let b = 0;
  const sectionIds: NodeId[] = [];

  for (let s = 0; s < 4; s++) {
    const first = b;
    const leaves: NodeId[] = [];
    const paras = s === 0 ? 5 : 2;
    for (let p = 0; p < paras; p++) {
      blocks.push({
        id: id(b),
        tag: "p",
        kind: "text",
        text: `block ${b}`,
        words: 2,
        html: `<p>block ${b}</p>`,
        gistable: true,
      });
      const leaf = `n-l-${s}-${p}`;
      nodes[leaf] = {
        id: leaf,
        depth: 3,
        parent: `n-s-${s}`,
        children: [],
        range: [id(b), id(b)],
        title: "",
        navLabel: `paragraph ${p} of section ${s}`,
      };
      leaves.push(leaf);
      b++;
    }
    nodes[`n-s-${s}`] = {
      id: `n-s-${s}`,
      depth: 2,
      parent: "n-p",
      children: leaves,
      range: [id(first), id(b - 1)],
      title: `Section ${s}`,
      gist: `What section ${s} establishes.`,
    };
    sectionIds.push(`n-s-${s}`);
  }
  nodes["n-p"] = {
    id: "n-p",
    depth: 1,
    parent: "n-r",
    children: sectionIds,
    range: [id(0), id(b - 1)],
    title: "The only part",
    gist: "the part's gist",
  };
  nodes["n-r"] = {
    id: "n-r",
    depth: 0,
    parent: null,
    children: ["n-p"],
    range: [id(0), id(b - 1)],
    title: "Root",
    gist: "the root's gist",
  };
  return {
    tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes },
    blocks,
  };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const root = buildSummaryTree(tree, blocks, null, geometry.leafDepth);

let host: HTMLDivElement;
let reactRoot: Root;

/**
 * Stub the two numbers the fit reads.
 *
 * `clientHeight` is the band. Each measured candidate reports a height
 * proportional to how many rows it drew, which is the honest stand-in for
 * layout: more rows, taller. The panel should then take the tallest candidate
 * that still fits.
 */
function stubHeights(bandHeight: number, pxPerRow = 10) {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("outln") ? bandHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    /* Only the candidate lists in the measuring box are asked. */
    if (this.tagName === "OL" && this.dataset.rung) {
      return this.querySelectorAll("li").length * pxPerRow;
    }
    return 0;
  });
}

function render(bandHeight: number, focusRow = 0, proseBeside = true) {
  stubHeights(bandHeight);
  act(() => {
    reactRoot.render(
      <OutlinePanel
        root={root}
        supplementOf={geometry.supplementOf}
        arcByRow={null}
        focusRow={focusRow}
        proseBeside={proseBeside}
        onJump={() => {}}
      />,
    );
  });
  return host.querySelector<HTMLElement>(".mode-band.outln")!;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  /* jsdom has no ResizeObserver. The panel installs two; a no-op stands in,
     because the effect's first `measure()` call is synchronous and is what
     these tests exercise. */
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("choosing a rung", () => {
  it("takes the tallest rung that fits", () => {
    /* Rung 1 draws 1 row here (one part). Each later rung draws more. With
       plenty of room it should reach the top of the ladder. */
    const panel = render(10_000);
    expect(panel.dataset.outlineRung).toBe("5");
    expect(panel.querySelectorAll(".outln-list:not([data-rung]) .outln-row").length)
      .toBeGreaterThan(1);
  });

  it("falls back to rung 1 when only the parts fit", () => {
    /* 10px a row, and rung 1 is the one-row list. */
    const panel = render(15);
    expect(panel.dataset.outlineRung).toBe("1");
  });

  it("steps down rather than overflowing as the band shrinks", () => {
    const tall = render(10_000).dataset.outlineRung;
    act(() => reactRoot.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    reactRoot = createRoot(host);
    const short = render(60).dataset.outlineRung;
    expect(Number(short)).toBeLessThan(Number(tall));
  });

  it("never shows fewer rows in a taller band — monotonic in height", () => {
    /* The same class as the non-monotonic column fit found by sweeping widths;
       a taller window must never take context away. */
    let last = 0;
    for (const h of [15, 40, 80, 200, 10_000]) {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
      const panel = render(h);
      const n = panel.querySelectorAll(".outln-list:not([data-rung]) .outln-row").length;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });
});

describe("what the list says", () => {
  it("draws every part exactly once, at every band height", () => {
    for (const h of [15, 80, 10_000]) {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
      const panel = render(h);
      const parts = panel.querySelectorAll(
        ".outln-list:not([data-rung]) .outln-row.lvl-1",
      );
      expect(parts).toHaveLength(1);
    }
  });

  it("marks exactly one row as the reader's location", () => {
    const panel = render(10_000, 1);
    const now = panel.querySelectorAll(
      '.outln-list:not([data-rung]) [aria-current="location"]',
    );
    expect(now).toHaveLength(1);
  });

  it("is one tab stop, not one per row", () => {
    const panel = render(10_000);
    const list = panel.querySelector('.outln-list:not([data-rung])')!;
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(panel.querySelectorAll('.outln-row[tabindex]')).toHaveLength(0);
    expect(list.getAttribute("role")).toBe("tree");
  });

  it("hides the measured candidates from assistive tech", () => {
    const panel = render(10_000);
    expect(panel.querySelector(".outln-measure")!.getAttribute("aria-hidden")).toBe("true");
  });
});
