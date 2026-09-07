// @vitest-environment jsdom
/**
 * **Structure's panel puts both columns on screen, and the shared fixtures
 * cannot prove that.**
 *
 * This file exists because of GPT Sol's finding 8 reviewing the plan. The two
 * total tables that assert Structure draws a band —
 * `tests/every-mode-draws-its-surface.test.tsx` § `DRAWS` and
 * `tests/public-network-trace.test.tsx` § `BAND_SAYS` — each take **one** string
 * that must be readable inside `.mode-band.struct`, and both of their article
 * fixtures are a root with a single depth-1 part and **no section beneath it**.
 * So the only string either can name is a part title, which comes from column A:
 * every assertion about this mode over there passes just as well over a panel
 * whose right-hand column never rendered.
 *
 * Widening those fixtures would have been the other answer, and it was turned
 * down: both are shared by fourteen other modes' assertions, and a new depth-2
 * node changes what Hierarchy, Outline and Summary draw in the same run. The
 * risk belongs to this mode, so the test does too.
 *
 * ## What jsdom can and cannot prove here
 *
 * jsdom does no layout: every `scrollHeight` and `clientHeight` is 0, and no
 * container query is ever evaluated. So this file says nothing about **fit** —
 * whether two 193px tracks read, whether the columns stack below 364px, whether
 * anything overflows. Those are browser questions and are stage 3's
 * (docs/project/browser-testing.md). What is fully testable here is what the
 * panel *renders*: which rows land in which column, and that the mark, the
 * bracket header and the section list are all present together.
 *
 * docs/plans/260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch.md
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructurePanel } from "../src/web/StructurePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

/* Two parts. The second has three sections, so column B has something to be
   *wrong* about — a panel listing every section in the article, or the first
   part's, is a different bug from one drawing no column B at all, and a
   one-part fixture cannot tell them apart. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-s${String(n).padStart(4, "0")}` as BlockId;
  let b = 0;

  const block = () => {
    blocks.push({
      id: id(b),
      tag: "p",
      kind: "text",
      text: `block ${b}`,
      words: 2,
      html: `<p>block ${b}</p>`,
      gistable: true,
    });
    return b++;
  };

  /* Part one: two plain blocks, no sections. */
  const p1First = block();
  const p1Last = block();
  nodes["n-p1"] = {
    id: "n-p1",
    depth: 1,
    parent: "n-r",
    children: [],
    range: [id(p1First), id(p1Last)],
    title: "PART ONE TITLE",
    gist: "What part one establishes.",
  };

  /* Part two: three sections of two blocks each. */
  const sectionIds: NodeId[] = [];
  const p2First = b;
  for (let s = 0; s < 3; s++) {
    const first = block();
    const last = block();
    const sid = `n-s${s}` as NodeId;
    nodes[sid] = {
      id: sid,
      depth: 2,
      parent: "n-p2",
      children: [],
      range: [id(first), id(last)],
      title: `SECTION ${s} TITLE`,
      gist: `What section ${s} establishes.`,
    };
    sectionIds.push(sid);
  }
  nodes["n-p2"] = {
    id: "n-p2",
    depth: 1,
    parent: "n-r",
    children: sectionIds,
    range: [id(p2First), id(b - 1)],
    title: "PART TWO TITLE",
    gist: "What part two establishes.",
  };

  nodes["n-r"] = {
    id: "n-r",
    depth: 0,
    parent: null,
    children: ["n-p1", "n-p2"],
    range: [id(0), id(b - 1)],
    title: "Root",
    gist: "The root's gist.",
  };

  return { tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes }, blocks };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const summaryRoot = buildSummaryTree(tree, blocks, geometry.leafDepth);

/* Row 2 is part two's first block — the reader is inside SECTION 0. Derived from
   the fixture rather than written as `2`, so a change to part one's length does
   not silently move the reader into a different part and leave every assertion
   below still passing about the wrong thing. */
const IN_SECTION_0 = blocks.findIndex((x) => x.id === tree.nodes["n-p2"]?.range[0]);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let reactRoot: Root;

function render(focusRow: number) {
  act(() => {
    reactRoot.render(
      <StructurePanel
        root={summaryRoot}
        focusRow={focusRow}
        allowParagraphs={true}
        onJump={() => {}}
      />,
    );
  });
  const band = host.querySelector(".mode-band.struct");
  if (!band) throw new Error("no Structure band rendered");
  return band;
}

/**
 * The two columns, as the text of their rows, read from the DOM by position.
 *
 * **`:scope > .struct-side` and not `.struct-side`**, and the difference is the
 * whole reason this helper has a comment. The panel also renders `aria-hidden`
 * measuring copies of both columns — the full, unwindowed lists, laid out at the
 * real column width so their heights are real — inside a `.struct-measure`
 * wrapper. Those come FIRST in the DOM, so an unscoped `.struct-side` query
 * returns the hidden copies and every assertion in this file would pass over a
 * panel whose visible columns drew nothing.
 *
 * This is Outline's trap arriving in a second mode: `readable()` in
 * tests/every-mode-draws-its-surface.test.tsx and `visibleText()` in
 * tests/public-network-trace.test.tsx both strip `[aria-hidden="true"]` for
 * exactly this reason, and this file needs its own answer because it reads by
 * position rather than by text.
 */
function columns(band: Element) {
  const sides = band.querySelectorAll(".struct-grid > .struct-side");
  const textsIn = (el: Element | undefined) =>
    el === undefined
      ? []
      : [...el.querySelectorAll(".struct-row .struct-text")].map((n) => n.textContent ?? "");
  return { a: textsIn(sides[0]), b: textsIn(sides[1]) };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  /* jsdom has no ResizeObserver, and the panel installs one to re-measure its
     columns. A no-op stands in, exactly as `outline-panel.test.tsx` does: the
     effect's first `measure()` is synchronous, and in jsdom every height is 0
     anyway, so the capacity stays unmeasured and both columns draw whole —
     which is the state these tests are about. */
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

describe("the Structure band", () => {
  it("draws the parts on the left and the current part's sections on the right, at once", () => {
    const band = render(IN_SECTION_0);
    const { a, b } = columns(band);

    /* **Both, in one assertion pass.** The point of the file: a panel that drew
       only column A would satisfy every shared-fixture assertion this mode has
       and fail here. */
    expect(a).toEqual(["PART ONE TITLE", "PART TWO TITLE"]);
    expect(b).toEqual(["SECTION 0 TITLE", "SECTION 1 TITLE", "SECTION 2 TITLE"]);
  });

  it("names the part column B is the inside of, in column B", () => {
    /* The bracket's other half. Without it, three section titles beside two part
       titles is a pair of lists rather than a pair of linked columns, and the
       reader has to work out which part they belong to by matching text. */
    const band = render(IN_SECTION_0);
    expect(band.querySelector(".struct-of")?.textContent).toContain("PART TWO TITLE");
  });

  it("marks the current part in A and the current section in B, and nothing else anywhere", () => {
    const band = render(IN_SECTION_0);
    /* Scoped past the measuring copies, which carry the mark too — see
       `columns()`. Unscoped this reads four marks and the assertion below would
       have to be loosened to accommodate a duplicate, which is how a test stops
       being able to see the thing it is about. */
    const marked = [...band.querySelectorAll(".struct-grid > .struct-side [aria-current]")].map(
      (n) => n.querySelector(".struct-text")?.textContent ?? "",
    );
    /* Exactly two marks, one per column. Three would mean the two columns
       disagree about where the reader is; one would mean a column is not
       drawing. */
    expect(marked).toEqual(["PART TWO TITLE", "SECTION 0 TITLE"]);
  });

  it("says where you are rather than drawing an empty box, when you are between parts", () => {
    /* jsdom's `focusRow` for a real mount is 0, and row 0 here IS inside part
       one — but a reader can be outside every part, and the two nothings must
       not read alike. This is the state the shared fixtures actually put the
       panel in, which is a second reason they cannot see column B. */
    const band = render(9_999);
    expect(columns(band).a).toEqual(["PART ONE TITLE", "PART TWO TITLE"]);
    expect(band.querySelector(".struct-of")).toBeNull();
    expect(band.textContent).toContain("You are between parts");
  });

  it("says a part is undivided rather than showing an empty column", () => {
    const band = render(0);
    expect(band.querySelector(".struct-of")?.textContent).toContain("PART ONE TITLE");
    expect(columns(band).b).toEqual([]);
    expect(band.textContent).toContain("not divided into sections");
  });

  it("presses a row and hands out that row's own block id", () => {
    /* **Nothing checked the jump target until GPT Sol replaced every `blockId`
       with one wrong constant and all six of these passed** (code review,
       finding 7). A row that renders correctly and jumps somewhere else is the
       worst bug this panel can have: it looks right until you press it. The
       expected id comes out of the fixture tree rather than being retyped, so
       this compares the panel against the article rather than against itself. */
    const jumps: string[] = [];
    act(() => {
      reactRoot.render(
        <StructurePanel
          root={summaryRoot}
          focusRow={IN_SECTION_0}
          allowParagraphs={true}
          onJump={(id) => jumps.push(id)}
        />,
      );
    });
    const band = host.querySelector(".mode-band.struct");
    if (!band) throw new Error("no band");

    const press = (side: number, row: number) => {
      const sides = band.querySelectorAll(".struct-grid > .struct-side");
      const buttons = sides[side]?.querySelectorAll<HTMLButtonElement>(".struct-row") ?? [];
      act(() => buttons[row]?.click());
    };

    press(0, 1); // column A, PART TWO
    press(1, 2); // column B, SECTION 2
    expect(jumps).toEqual([tree.nodes["n-p2"]?.range[0], tree.nodes["n-s2"]?.range[0]]);
    /* And the two are different ids, or one wrong constant would satisfy the
       line above. */
    expect(jumps[0]).not.toBe(jumps[1]);
  });

  it("puts the current rows' gists on screen, not just in the projection", () => {
    /* The projection tests assert a `gist` field; nothing asserted it reached the
       DOM, and removing the gist from the renderer left all six panel tests green
       (Sol, finding 7). Scoped past the measuring copies for the usual reason. */
    const band = render(IN_SECTION_0);
    const gists = [...band.querySelectorAll(".struct-grid > .struct-side .struct-gist")].map(
      (n) => n.textContent ?? "",
    );
    expect(gists).toEqual(["What part two establishes.", "What section 0 establishes."]);
  });

  it("draws no band-head, because the Dock is already saying the mode's name", () => {
    /* The documented default since 2026-09-05. `.struct-of` is not one: it names
       the part, which is a fact about the column rather than about the band. */
    const band = render(IN_SECTION_0);
    expect(band.querySelector(".band-head")).toBeNull();
    expect(band.getAttribute("aria-label")).toBe("Structure");
  });
});
