// @vitest-environment jsdom
/**
 * **Structure mode's two faces, and the retired name that reaches them.**
 *
 * Since 2026-09-10 Structure draws its two linked columns where the band is
 * wide enough for them (`structureFace`), and Outline's nested list where it is not;
 * Outline stopped being a mode the same day, and `?mode=outline` opens
 * Structure. docs/plans/260910g-structure-mode-subsumes-outline.md.
 *
 * jsdom lays nothing out, so every `offsetWidth` is 0 and a band left alone
 * keeps the face it mounted with — the columns, which is what every other file
 * that opens this mode sees. This file gives the band a width, by stubbing
 * `offsetWidth` on the band alone, and fires the `ResizeObserver` by hand, so
 * what it proves is the *decision*: which face a given measured width gets, and
 * that a change of width changes it in both directions. Whether 389px is the
 * width at which two columns actually read is a browser question.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES, modeFromParam, RETIRED_MODES } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import {
  StructureBand,
  structureFace,
  TWO_COLUMN_CONTENT_MIN,
} from "../src/web/modes/structure/StructureMode.js";
import { modeParam } from "../src/web/params.js";
import { buildSections } from "../src/web/position.js";
import { buildGeometry } from "../src/web/tree.js";
import type { Article, Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

describe("which face a band gets", () => {
  /* The container query this replaced asked for 364px of Structure's content
     box; the band's border box is that plus the border plus 1.5rem of padding.
     Every case is written as the arithmetic rather than a bare number, so a
     reader can see which input moved the threshold. */
  it("draws the columns from 364px of content up, at a 16px root with a 1px border", () => {
    const at = TWO_COLUMN_CONTENT_MIN + 1 + 24; // 389
    expect(structureFace(at, 1, 16)).toBe("columns");
    expect(structureFace(at + 200, 1, 16)).toBe("columns");
    expect(structureFace(at - 1, 1, 16)).toBe("list");
    expect(structureFace(288, 1, 16)).toBe("list");
  });

  it("moves the threshold with the root font size, because the padding is rem", () => {
    const at = TWO_COLUMN_CONTENT_MIN + 1 + 30; // 395 at a 20px root
    expect(structureFace(at, 1, 20)).toBe("columns");
    expect(structureFace(at - 1, 1, 20)).toBe("list");
    /* 389 is two columns at 16px and not at 20px — the one width that tells a
       rem-aware threshold from a px constant. */
    expect(structureFace(389, 1, 20)).toBe("list");
  });

  it("gives a band that covers the prose, and so has no border, a pixel back", () => {
    expect(structureFace(388, 0, 16)).toBe("columns");
    expect(structureFace(388, 1, 16)).toBe("list");
  });
});

describe("the retired `outline` mode", () => {
  it("is not a mode any more", () => {
    expect((MODES as readonly string[]).includes("outline")).toBe(false);
  });

  it("resolves to Structure on the client's parser and on the server's title", () => {
    expect(modeFromParam("outline")).toBe("structure");
    expect(modeParam.parse("outline")).toBe("structure");
    expect(readMode("/read/some-article?mode=outline")).toBe("structure");
    expect(readMode("/read/some-article?mode=outline&at=spya-k3m9qt")).toBe("structure");
  });

  it("names only real modes as successors, and nothing else resolves", () => {
    for (const successor of Object.values(RETIRED_MODES)) {
      expect(MODES).toContain(successor);
    }
    /* `Object.hasOwn`, not `in`: a value a stranger typed must not find a
       successor on the object's prototype. */
    for (const junk of ["toString", "constructor", "__proto__", "bogus", ""]) {
      expect(modeFromParam(junk), junk).toBeNull();
    }
    expect(modeFromParam(null)).toBeNull();
    expect(modeFromParam("structure")).toBe("structure");
  });
});

/* ------------------------------------------------------------------ mount -- */

/* Two parts, the second with two sections — enough for both faces to draw a
   part title the assertions can find. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-f${String(n).padStart(4, "0")}` as BlockId;
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

  const p1a = block();
  const p1b = block();
  nodes["n-p1"] = {
    id: "n-p1",
    depth: 1,
    parent: "n-r",
    children: [],
    range: [id(p1a), id(p1b)],
    title: "FIRST PART TITLE",
    gist: "What the first part says.",
  };
  const sections: NodeId[] = [];
  const p2First = b;
  for (let s = 0; s < 2; s++) {
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
      gist: `What section ${s} says.`,
    };
    sections.push(sid);
  }
  nodes["n-p2"] = {
    id: "n-p2",
    depth: 1,
    parent: "n-r",
    children: sections,
    range: [id(p2First), id(b - 1)],
    title: "SECOND PART TITLE",
    gist: "What the second part says.",
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
/* Only the three fields `StructureBand` reads. */
const article = { tree, blocks, navLabelStatus: "ready" } as unknown as Article;

/** The observers the band arms, so a width change can be delivered by hand. */
const observers: FakeResizeObserver[] = [];
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {
    observers.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    const at = observers.indexOf(this);
    if (at >= 0) observers.splice(at, 1);
  }
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

/** The width the band reports. Every other element keeps jsdom's 0. */
let bandWidth = 0;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let restoreWidth: () => void;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains("mode-band") ? bandWidth : 0;
    },
  });
  restoreWidth = () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetWidth", original);
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  restoreWidth();
  vi.unstubAllGlobals();
  observers.length = 0;
  bandWidth = 0;
});

function mount() {
  act(() => {
    root.render(
      <StructureBand
        article={article}
        leafDepth={geometry.leafDepth}
        sections={buildSections(geometry, blocks)}
        layoutKey="k"
        supplementOf={geometry.supplementOf}
        arcByRow={null}
        proseBeside={true}
        onJump={() => {}}
      />,
    );
  });
}

function resizeTo(width: number) {
  bandWidth = width;
  act(() => {
    for (const o of [...observers]) o.fire();
  });
}

/**
 * The narrowest band that gets the columns *here*: jsdom loads no stylesheet,
 * so the band has no border, and the root size is whatever jsdom reports —
 * read the way the component reads it rather than assumed.
 */
function edge(): number {
  const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return TWO_COLUMN_CONTENT_MIN + 1.5 * rootPx;
}

const columns = () => host.querySelector(".mode-band.struct");
const list = () => host.querySelector(".mode-band.outln");

describe("StructureBand", () => {
  it("draws the two columns on a wide band", () => {
    bandWidth = edge() + 100;
    mount();
    expect(columns()).not.toBeNull();
    expect(list()).toBeNull();
    expect(columns()?.textContent).toContain("SECOND PART TITLE");
  });

  it("draws Outline's list on a narrow band, and calls it Structure", () => {
    bandWidth = edge() - 60;
    mount();
    expect(columns()).toBeNull();
    expect(list()).not.toBeNull();
    expect(list()?.getAttribute("aria-label")).toBe("Structure");
    expect(list()?.textContent).toContain("SECOND PART TITLE");
  });

  it("changes face when the band changes width, in both directions", () => {
    bandWidth = edge() + 100;
    mount();
    expect(columns()).not.toBeNull();

    resizeTo(edge() - 1);
    expect(list()).not.toBeNull();
    expect(columns()).toBeNull();

    resizeTo(edge());
    expect(columns()).not.toBeNull();
    expect(list()).toBeNull();
  });

  it("keeps the face it has while the band reports no width", () => {
    bandWidth = 0;
    mount();
    expect(columns()).not.toBeNull();
  });
});
