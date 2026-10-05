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
 * that a change of width changes it in both directions. Whether 609px is the
 * width at which two columns actually read is a browser question.
 */
import { NuqsAdapter } from "nuqs/adapters/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES, modeFromParam, RETIRED_MODES } from "../src/modes.js";
import { readMode } from "../src/read-address.js";
import { structureColumnsBand } from "../src/web/layout.js";
import { STRUCTURE_ARRIVING } from "../src/messages.js";
import type { StructureArrival } from "../src/web/modes/structure/StructureArriving.js";
import { StructureBand } from "../src/web/modes/structure/StructureMode.js";
import { modeParam } from "../src/web/params.js";
import { buildSections } from "../src/web/position.js";
import { buildGeometry } from "../src/web/tree.js";
import type { Article, Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

/* Which face a given band width gets — the threshold and its agreement with the
   band `fitMode` hands out — is tests/structure-band-width.test.ts, since
   2026-09-28, where the threshold moved to layout.ts. */

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

});

/* Retired on 2026-09-29, Greg (SPIDERYARN-READING2-4B): "Remove the Hierarchy
   mode altogether. I think the Structure mode is better/sufficient."
   docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md. */
describe("the retired `hierarchy` mode", () => {
  it("is not a mode any more", () => {
    expect((MODES as readonly string[]).includes("hierarchy")).toBe(false);
  });

  it("resolves to Structure on the client's parser and on the server's title", () => {
    expect(modeFromParam("hierarchy")).toBe("structure");
    expect(modeParam.parse("hierarchy")).toBe("structure");
    expect(readMode("/read/some-article?mode=hierarchy")).toBe("structure");
    /* The two parameters only Hierarchy read are ignored, not honoured: the
       tab says Structure whatever they say. */
    expect(readMode("/read/some-article?mode=hierarchy&text=0&cols=1,2")).toBe("structure");
  });
});

describe("RETIRED_MODES", () => {
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

function mount(proseBeside = true, rootFontPx = 16) {
  act(() => {
    root.render(
      /* The band owns `?structure=` since 2026-10-01 (Fisheye / Expanded). */
      <NuqsAdapter>
        <StructureBand
          slug="t"
          owner={false}
          article={article}
          leafDepth={geometry.leafDepth}
          sections={buildSections(geometry, blocks)}
          layoutKey="k"
          supplementOf={geometry.supplementOf}
          arcByRow={null}
          proseBeside={proseBeside}
          rootFontPx={rootFontPx}
          onJump={() => {}}
        />
      </NuqsAdapter>,
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
 * The narrowest band that gets the columns at the default root used by
 * `mount`. The component is handed the same value the layout used; it does not
 * make a second DOM read.
 */
function edge(rootFontPx = 16): number {
  return structureColumnsBand(rootFontPx).min;
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

  it("draws the list on a band that covers the prose, however wide it is", () => {
    bandWidth = edge() + 100;
    mount(false);
    expect(columns()).toBeNull();
    expect(list()).not.toBeNull();
  });

  it("re-evaluates the face when the shared root size changes but the band width does not", () => {
    bandWidth = 700;
    mount(true, 16);
    expect(columns()).not.toBeNull();

    /* At 20px the same 700px border box is below the 759px threshold. No
       ResizeObserver callback fires: the prop shared with fitView must be
       enough to change the face. */
    mount(true, 20);
    expect(list()).not.toBeNull();
    expect(columns()).toBeNull();
  });

  it("keeps the face it has while the band reports no width", () => {
    bandWidth = 0;
    mount();
    expect(columns()).not.toBeNull();
  });
});

/* **Fisheye / Expanded** — Greg, 2026-10-01 (spya-gxyhcc).
   docs/plans/261001q-structure-fisheye-expanded-and-arrow-keys.md. */
describe("Fisheye and Expanded", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });
  const chip = (label: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>(".struct-view-btn")).find(
      (b) => b.textContent === label,
    );
  const expanded = () => host.querySelector(".mode-band.outln.outln-expanded");

  it("opens on Fisheye, with the toggle in both faces", () => {
    bandWidth = edge() + 100;
    mount();
    expect(columns()).not.toBeNull();
    expect(chip("Fisheye")?.getAttribute("aria-checked")).toBe("true");
    expect(chip("Expanded")?.getAttribute("aria-checked")).toBe("false");

    resizeTo(edge() - 1);
    expect(list()).not.toBeNull();
    expect(expanded()).toBeNull();
    expect(chip("Fisheye")?.getAttribute("aria-checked")).toBe("true");
  });

  it("degrades an unknown view to Fisheye", () => {
    window.history.replaceState(null, "", "/?structure=unknown");
    bandWidth = edge() + 100;
    mount();
    expect(columns()).not.toBeNull();
    expect(expanded()).toBeNull();
    expect(chip("Fisheye")?.getAttribute("aria-checked")).toBe("true");
  });

  it("draws every part and section with its gist, as the list, however wide the band", () => {
    window.history.replaceState(null, "", "/?structure=expanded");
    bandWidth = edge() + 100;
    mount();
    expect(columns()).toBeNull();
    const band = expanded();
    expect(band).not.toBeNull();
    for (const text of [
      "FIRST PART TITLE",
      "What the first part says.",
      "SECOND PART TITLE",
      "What the second part says.",
      "SECTION 0 TITLE",
      "What section 0 says.",
      "SECTION 1 TITLE",
      "What section 1 says.",
    ]) {
      expect(band?.textContent, text).toContain(text);
    }
  });

  it("switches by the chips, writing ?structure= and taking it off again", async () => {
    bandWidth = edge() + 100;
    mount();
    act(() => chip("Expanded")!.click());
    expect(expanded()).not.toBeNull();
    expect(chip("Expanded")?.getAttribute("aria-checked")).toBe("true");
    /* nuqs writes the address on a tick of its own. */
    await vi.waitFor(() =>
      expect(new URLSearchParams(window.location.search).get("structure")).toBe("expanded"),
    );

    act(() => chip("Fisheye")!.click());
    expect(columns()).not.toBeNull();
    await vi.waitFor(() =>
      expect(new URLSearchParams(window.location.search).has("structure")).toBe(false),
    );
  });

  it("keeps measuring the face while Expanded is open", async () => {
    bandWidth = edge() + 100;
    mount();
    act(() => chip("Expanded")!.click());
    expect(expanded()).not.toBeNull();

    /* Expanded stays a list, but its mounted surface continues feeding the
       width observer. Returning to Fisheye must use the width reached while it
       was open, not the stale wide face from before it opened. */
    resizeTo(edge() - 1);
    act(() => chip("Fisheye")!.click());
    await vi.waitFor(() => expect(list()).not.toBeNull());
    expect(columns()).toBeNull();
  });
});

/* **The line that says the structure is still coming, in every presentation.**
   An article opened before its structure is built shows a stand-in outline,
   and the band says so above it — the columns, the list and Expanded alike,
   because which of the three a reader has is decided by their window and not by
   anything they chose.
   docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
   § Stage 2. The line's own states are tests/structure-arriving.test.tsx. */
describe("the structure-arriving line", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });
  function mountArriving(arrival: StructureArrival | null) {
    act(() => {
      root.render(
        <NuqsAdapter>
          <StructureBand
            slug="s"
            owner
            article={article}
            leafDepth={geometry.leafDepth}
            sections={buildSections(geometry, blocks)}
            layoutKey="k"
            supplementOf={geometry.supplementOf}
            arcByRow={null}
            proseBeside
            rootFontPx={16}
            arrival={arrival}
            onJump={() => {}}
          />
        </NuqsAdapter>,
      );
    });
  }
  const line = () => host.querySelector(".struct-arriving");

  it("is drawn above the columns", () => {
    bandWidth = edge() + 100;
    mountArriving({ state: "building" });
    expect(columns()).not.toBeNull();
    expect(columns()?.querySelector(".struct-arriving")?.textContent).toBe(STRUCTURE_ARRIVING);
    /* Above the rows: it is in the band's head row. */
    expect(columns()?.querySelector(":scope > .band-head")?.contains(line())).toBe(true);
  });

  it("is drawn above the list", () => {
    bandWidth = edge() + 100;
    mountArriving({ state: "building" });
    resizeTo(edge() - 1);
    expect(list()?.querySelector(".struct-arriving")?.textContent).toBe(STRUCTURE_ARRIVING);
    expect(list()?.querySelector(":scope > .band-head")?.contains(line())).toBe(true);
  });

  it("is drawn above Expanded", () => {
    bandWidth = edge() + 100;
    mountArriving({ state: "building" });
    /* By the chip rather than by the address: nuqs holds the value an earlier
       case in this file wrote, and a `replaceState` here does not reach it. */
    const chip = Array.from(host.querySelectorAll<HTMLButtonElement>(".struct-view-btn")).find(
      (b) => b.textContent === "Expanded",
    );
    act(() => chip?.click());
    const band = host.querySelector(".mode-band.outln.outln-expanded");
    expect(band, "fixture: Expanded must be the presentation on screen").not.toBeNull();
    expect(band?.querySelector(".struct-arriving")?.textContent).toBe(STRUCTURE_ARRIVING);
  });

  it("leaves the toggle where it was", () => {
    bandWidth = edge() + 100;
    mountArriving({ state: "building" });
    expect(host.querySelectorAll(".struct-view-btn")).toHaveLength(2);
  });

  it("is not drawn for an article whose structure is in", () => {
    bandWidth = edge() + 100;
    mountArriving(null);
    expect(line()).toBeNull();
    mount();
    expect(line(), "nor when the prop is not passed at all").toBeNull();
  });
});
