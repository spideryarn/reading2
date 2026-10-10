// @vitest-environment jsdom
/**
 * **A Structure row says which figures, tables and media its range holds** —
 * in both faces, and identically in the drawn rows and the hidden copies the
 * faces measure. Greg, spya-sb0c7e.
 * docs/plans/261011b-skim-figures-walk-and-structure-figure-marks.md § Half 2.
 *
 * jsdom does no layout, so this says nothing about whether the mark fits on a
 * row — that is a browser question. What it can say is what is rendered: the
 * right mark on the right row, by range, and the same markup in both copies,
 * whose disagreement would be a silent clip.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { figuresOf } from "../src/figures.js";
import { OutlinePanel } from "../src/web/OutlinePanel.js";
import { StructurePanel } from "../src/web/StructurePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

/*
 * Part one: section A holds two pictures and a table; section B holds nothing.
 * Part two: one section, plain prose.
 */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-f${String(n).padStart(4, "0")}` as BlockId;
  const push = (b: Omit<Block, "id">) => {
    blocks.push({ id: id(blocks.length), ...b });
    return blocks.length - 1;
  };
  const para = () =>
    push({ tag: "p", kind: "text", text: "words", words: 1, html: "<p>words</p>", gistable: true });
  const picture = () =>
    push({
      tag: "figure",
      kind: "media",
      text: "",
      words: 0,
      html: '<figure><img src="a.png"></figure>',
      gistable: false,
    });
  const table = () =>
    push({
      tag: "table",
      kind: "other",
      text: "1 2",
      words: 2,
      html: "<table><tr><td>1</td><td>2</td></tr></table>",
      gistable: false,
    });

  const section = (nid: NodeId, parent: NodeId, title: string, rows: number[]) => {
    nodes[nid] = {
      id: nid,
      depth: 2,
      parent,
      children: [],
      range: [id(rows[0]!), id(rows[rows.length - 1]!)],
      title,
      gist: `What ${title} says.`,
    };
  };

  const a = [para(), picture(), picture(), table(), para()];
  const b = [para(), para()];
  const c = [para(), para()];
  section("n-a", "n-p1", "Section A", a);
  section("n-b", "n-p1", "Section B", b);
  section("n-c", "n-p2", "Section C", c);
  nodes["n-p1"] = {
    id: "n-p1",
    depth: 1,
    parent: "n-r",
    children: ["n-a", "n-b"],
    range: [id(a[0]!), id(b[b.length - 1]!)],
    title: "Part one",
    gist: "Part one's gist.",
  };
  nodes["n-p2"] = {
    id: "n-p2",
    depth: 1,
    parent: "n-r",
    children: ["n-c"],
    range: [id(c[0]!), id(c[c.length - 1]!)],
    title: "Part two",
    gist: "Part two's gist.",
  };
  nodes["n-r"] = {
    id: "n-r",
    depth: 0,
    parent: null,
    children: ["n-p1", "n-p2"],
    range: [id(0), id(blocks.length - 1)],
    title: "Root",
    gist: "The root's gist.",
  };
  return { tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes }, blocks };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const root = buildSummaryTree(tree, blocks, geometry.leafDepth);
const figures = figuresOf(blocks);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
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
  vi.unstubAllGlobals();
});

/** A row's title without the mark, so a count's digits are not read as title. */
function titleOf(text: Element | null): string {
  if (!text) return "";
  const copy = text.cloneNode(true) as Element;
  for (const m of copy.querySelectorAll(".fig-mark")) m.remove();
  return (copy.textContent ?? "").trim();
}

/** Each row's title → its mark's accessible name ("" for none). */
function marks(rows: Iterable<Element>, textSel: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const mark = row.querySelector(".fig-mark");
    out.set(titleOf(row.querySelector(textSel)), mark?.getAttribute("aria-label") ?? "");
  }
  return out;
}

describe("the figure mark on Structure's two columns", () => {
  function render() {
    act(() => {
      reactRoot.render(
        <StructurePanel
          root={root}
          figures={figures}
          focusRow={0}
          allowParagraphs={false}
          onJump={() => {}}
        />,
      );
    });
    return host.querySelector(".mode-band.struct")!;
  }

  it("marks the section holding figures and a table, its part, and nothing else", () => {
    const band = render();
    const drawn = marks(band.querySelectorAll(".struct-grid > .struct-side .struct-row"), ".struct-text");
    expect(drawn.get("Section A")).toBe("2 figures, 1 table");
    expect(drawn.get("Section B")).toBe("");
    expect(drawn.get("Part one")).toBe("2 figures, 1 table");
    expect(drawn.get("Part two")).toBe("");
  });

  it("draws a count only beside a kind there is more than one of, and hides the icons", () => {
    const band = render();
    const row = [...band.querySelectorAll(".struct-grid > .struct-side .struct-row")].find(
      (r) => titleOf(r.querySelector(".struct-text")) === "Section A",
    )!;
    const mark = row.querySelector(".fig-mark")!;
    expect(mark.getAttribute("role")).toBe("img");
    const kinds = [...mark.querySelectorAll(".fig-mark-kind")];
    expect(kinds.map((k) => k.getAttribute("data-kind"))).toEqual(["figure", "table"]);
    expect(kinds.map((k) => k.querySelector(".fig-mark-n")?.textContent ?? null)).toEqual(["2", null]);
    expect(kinds.every((k) => k.getAttribute("aria-hidden") === "true")).toBe(true);
    /* Inside the row's own button, never a second one. */
    expect(mark.closest("button")).toBe(row);
    expect(mark.querySelector("button")).toBeNull();
  });

  it("carries the same mark in the hidden measuring copy as in the drawn row", () => {
    const band = render();
    const drawn = band.querySelectorAll(".struct-grid > .struct-side .struct-row");
    const measured = band.querySelectorAll(".struct-measure .struct-row");
    const html = (rows: NodeListOf<Element>) =>
      new Map([...rows].map((r) => [titleOf(r.querySelector(".struct-text")), r.querySelector(".struct-line")!.innerHTML]));
    const d = html(drawn);
    const m = html(measured);
    expect(d.size).toBeGreaterThan(0);
    for (const [title, inner] of d) expect(m.get(title)).toBe(inner);
    expect([...d.values()].some((h) => h.includes("fig-mark"))).toBe(true);
  });
});

describe("the figure mark on Structure's list", () => {
  function render(expanded: boolean) {
    act(() => {
      reactRoot.render(
        <OutlinePanel
          root={root}
          figures={figures}
          supplementOf={geometry.supplementOf}
          arcByRow={null}
          focusRow={0}
          proseBeside={true}
          paragraphLabels={false}
          onJump={() => {}}
          expanded={expanded}
        />,
      );
    });
    return host.querySelector(".mode-band.outln")!;
  }

  it("marks the section holding figures and a table, its part, and nothing else", () => {
    const band = render(true);
    const drawn = marks(band.querySelectorAll(".outln-list:not([data-rung]) .outln-row"), ".outln-text");
    expect(drawn.get("Section A")).toBe("2 figures, 1 table");
    expect(drawn.get("Section B")).toBe("");
    expect(drawn.get("Part one")).toBe("2 figures, 1 table");
    expect(drawn.get("Part two")).toBe("");
    expect(drawn.get("Section C")).toBe("");
  });

  it("carries the same mark in the hidden candidates as in the drawn rows", () => {
    const band = render(false);
    const drawn = band.querySelectorAll(".outln-list:not([data-rung]) .outln-row");
    const measured = band.querySelectorAll(".outln-measure .outln-row");
    expect(measured.length).toBeGreaterThan(0);
    /* The mark's own markup, not the row's: a candidate rung may draw a gist
       the chosen one does not, and that difference is the point of measuring. */
    const markHtml = (r: Element) => r.querySelector(".fig-mark")?.outerHTML ?? "";
    const inner = new Map([...drawn].map((r) => [titleOf(r.querySelector(".outln-text")), markHtml(r)]));
    expect([...inner.values()].some((h) => h !== "")).toBe(true);
    let compared = 0;
    for (const row of measured) {
      const d = inner.get(titleOf(row.querySelector(".outln-text")));
      if (d === undefined) continue;
      expect(markHtml(row)).toBe(d);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
    /* And each candidate marks Part one, since every rung draws the parts. */
    for (const list of band.querySelectorAll(".outln-measure ol")) {
      expect(marks(list.querySelectorAll(".outln-row"), ".outln-text").get("Part one")).toBe(
        "2 figures, 1 table",
      );
    }
  });
});
