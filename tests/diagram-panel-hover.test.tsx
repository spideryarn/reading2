// @vitest-environment jsdom
/**
 * **The panel, actually mounted, actually hovered.**
 *
 * Everything else about this feature is tested as arithmetic — the graph, the
 * geometry, the ranking — and all of it can be right while the picture stays
 * mute. The footer card exists to answer *why is that line there*, and that
 * answer is only delivered if a pointer landing on a bubble reaches React's
 * state. Nothing below the panel can tell you whether it does.
 *
 * Written because a browser pass reported the hover as broken and I could not
 * tell, from a report, whether the finding was about the code or about a
 * preview page whose module graph had been invalidated under it. A test
 * distinguishes those two permanently; a second browser pass would not.
 *
 * ⟨Sol, code review⟩ also asked for this: "there is no focused route or
 * `useSimilar` test; POST gating, StrictMode behaviour and slug transitions can
 * break while all three suites stay green."
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Tree } from "../src/types.js";
import type { DiagramKind } from "../src/web/diagram.js";
import { DiagramPanel } from "../src/web/DiagramPanel.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

/* jsdom lays nothing out: every element is 0×0 and there is no ResizeObserver.
   The panel refuses to draw against a zero width on purpose (a diagram laid out
   against a guessed width is visibly wrong for a frame), so without these two
   stubs it renders an empty box and every assertion below would be about
   nothing at all. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SIZE = { w: 340, h: 700 };

function block(id: string, text: string, html?: string): Block {
  return {
    id: `spya-${id}` as BlockId,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: html ?? `<p>${text}</p>`,
    gistable: true,
  };
}

const TOPICS = [
  "falconry hawking jesses gauntlet quarry stooping austringer merlin",
  "geology basalt sediment tectonic strata outcrop metamorphic granite",
  "baking sourdough hydration levain crumb proving banneton scoring",
  "sailing halyard leeward tacking spinnaker keel bosun rigging",
];

/** Two sections, plus an internal link from the first to the second. */
function article(): { root: SummaryNode; blocks: Block[] } {
  const blocks = [
    block("b0", TOPICS[0] ?? "", `<p>${TOPICS[0]} <a href="#spya-b2">the second part</a></p>`),
    block("b1", TOPICS[1] ?? ""),
    block("b2", TOPICS[2] ?? ""),
    block("b3", TOPICS[3] ?? ""),
  ];
  const mk = (id: string, depth: number, parent: string | null, kids: string[], a: number, b: number) => ({
    id, depth, parent, children: kids,
    range: [blocks[a]?.id, blocks[b]?.id], title: `Section ${id}`,
    ...(depth < 2 && { gist: `Gist for ${id}` }),
  });
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n1",
    nodes: {
      n1: mk("n1", 0, null, ["n2", "n3"], 0, 3),
      n2: mk("n2", 1, "n1", [], 0, 1),
      n3: mk("n3", 1, "n1", [], 2, 3),
    },
  } as unknown as Tree;
  const root = buildSummaryTree(tree, blocks, null);
  if (!root) throw new Error("fixture tree is unusable");
  return { root, blocks };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  for (const [prop, value] of [["clientWidth", SIZE.w], ["clientHeight", SIZE.h]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), {
      status: 200,
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function mount(kind: DiagramKind = "force") {
  const { root: tree, blocks } = article();
  act(() => {
    root.render(
      <DiagramPanel
        slug="s"
        root={tree}
        kind={kind}
        onKind={() => {}}
        atRow={0}
        onJump={() => {}}
        blocks={blocks}
        /* The two scatter pictures' controls. Passed because the panel requires
           them, and fixed rather than exercised: nothing here draws a scatter. */
        axis="spread"
        onAxis={() => {}}
        hue="section"
        onHue={() => {}}
      />,
    );
  });
}

/** The card's text, whitespace collapsed. */
const cardText = () =>
  (host.querySelector(".diag-card")?.textContent ?? "").replace(/\s+/g, " ").trim();

/**
 * **What the fallback is dressed as.**
 *
 * Drift and Trail have nothing to draw until the projection lands, so
 * `layoutDiagram` hands back `layoutTree` and the strip says "the picture below
 * is the Tree instead". The panel then has to *render* it as a tree — the SVG's
 * class picks the stylesheet and `NodeShape`'s branch picks the shapes, and
 * both used to come from the toggle rather than from what was drawn.
 *
 * The result was Tree geometry wearing Drift's stylesheet:
 * `.diag-drift .diag-box { fill: transparent; stroke: none }` erased every row,
 * the branch that draws a tree's dot and chevron never ran, and no
 * `.diag-drift .diag-label` font size exists so labels painted at the browser
 * default. Nothing throws, nothing logs, and the sentence above it says the
 * right thing while the picture under it is broken — GPT Sol's finding on the
 * built code, 2026-08-27.
 */
describe("a picture drawn without its data", () => {
  it("wears the stylesheet of the picture it fell back to", () => {
    mount("drift");
    const svg = host.querySelector("svg.diag-svg");
    expect(svg, "the panel drew nothing at all").not.toBeNull();
    expect(svg?.classList.contains("diag-tree")).toBe(true);
    expect(svg?.classList.contains("diag-drift")).toBe(false);
  });

  it("draws the tree's own shapes, not a scatter's", () => {
    /* The class alone is not enough: `NodeShape` branches on the same value,
       and a row that is a `.diag-box` rather than a `.diag-row` has no fill
       rule under `.diag-tree` either. */
    mount("drift");
    expect(host.querySelectorAll(".diag-node .diag-row").length).toBeGreaterThan(0);
  });

  it("is still a tree to a screen reader, not a list of paragraphs", () => {
    // `role` and the `aria-label`'s name both come from what is drawn. Saying
    // "one dot per paragraph" over a column of sections is the same bug told
    // to somebody who cannot see the picture to know better.
    mount("drift");
    const svg = host.querySelector("svg.diag-svg");
    expect(svg?.getAttribute("role")).toBe("tree");
    expect(svg?.getAttribute("aria-label")).toContain("Tree");
  });
});

describe("hovering a bubble", () => {
  it("draws the picture at all, before anything else is asserted", () => {
    /* The guard on every assertion below. jsdom reports zero for every
       dimension, and a panel that measured zero would render an empty box —
       against which "the card did not change" is true and meaningless. */
    mount();
    expect(host.querySelectorAll("svg .diag-node").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("svg .diag-link").length).toBeGreaterThan(0);
  });

  it("moves the card off the reading position and onto the node under the pointer", () => {
    mount();
    const before = cardText();
    expect(before).toContain("you are here");

    /* `pointerover`, not `pointerenter`: React synthesises enter/leave from the
       bubbling events, and `pointerenter` does not bubble, so dispatching the
       one the handler is named after is the version of this test that fails
       while the app works. */
    const nodes = [...host.querySelectorAll("g.diag-node")];
    const other = nodes.find((n) => n.getAttribute("data-diag-id") === "n3");
    expect(other, "the second section should be drawn").toBeTruthy();
    act(() => {
      other?.querySelector(".diag-box")?.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });

    const after = cardText();
    expect(after).not.toBe(before);
    expect(after).not.toContain("you are here");
    expect(after).toContain("Section n3");
  });

  it("shows the author's own words for a cross-reference, rather than the gist", () => {
    /* The whole reason the card exists on a graph picture: a line the reader
       cannot interrogate looks exactly as authoritative as one that is right. */
    mount();
    act(() => {
      host
        .querySelector('g.diag-node[data-diag-id="n2"] .diag-box')
        ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(cardText()).toContain("the second part");
    expect(cardText()).not.toContain("Gist for n2");
  });

  it("gives the card back to the reading position when the pointer leaves", () => {
    mount();
    act(() => {
      host
        .querySelector('g.diag-node[data-diag-id="n3"] .diag-box')
        ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(cardText()).toContain("Section n3");
    /* `relatedTarget` outside the picture is what makes this a *leave* rather
       than a move between two nodes — React synthesises `onPointerLeave` from
       `pointerout` and reads exactly that field. Without it the event fires,
       nothing happens, and the test reports a broken hover-out on working code:
       the same shape of false negative a browser pass produced for this panel. */
    act(() => {
      /* Dispatched from the **circle the pointer was last over**, not from the
         svg: React tracks where the pointer is and synthesises leave from the
         `out` event's own target and `relatedTarget`. An `out` fired at the
         parent, from an element React does not believe the pointer is on, does
         nothing at all. */
      host
        .querySelector('g.diag-node[data-diag-id="n3"] .diag-box')
        ?.dispatchEvent(
          new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
        );
    });
    expect(cardText()).toContain("you are here");
  });
});

describe("what the panel asks the server for", () => {
  it("asks for the embeddings with POST, and only on the force picture", async () => {
    /* GET is meant to be safe and this call spends money — a prefetcher or a
       proxy retry may repeat one. And five of the six pictures must not ask at
       all: pressing a toggle is not a purchase decision. */
    const calls: [string, string][] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(url), init?.method ?? "GET"]);
      return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), {
        status: 200,
      });
    });

    /* `apiFetch` asks for an auth token before it sends, so the request leaves
       on a later microtask than the effect that started it. Asserting straight
       after `act` sees an empty list and reads as "it never asked" — which is
       also what a genuinely missing request looks like. */
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    mount("tree");
    await settle();
    expect(calls, "the Tree picture must not buy anything").toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    mount("force");
    await settle();
    expect(calls.map(([, method]) => method)).toContain("POST");
    expect(calls.every(([url]) => url.includes("/api/similar/"))).toBe(true);
  });
});
