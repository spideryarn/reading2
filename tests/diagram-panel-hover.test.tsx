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

/**
 * An article whose contents page is a single entry — a real stored shape, and
 * the one that made Force draw a blank band once it became the default.
 * `layoutForce` draws only `depth > 0`, so this graph lays out to zero nodes.
 */
function rootOnlyArticle(): { root: SummaryNode; blocks: Block[] } {
  const blocks = [block("b0", TOPICS[0] ?? ""), block("b1", TOPICS[1] ?? "")];
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n1",
    nodes: {
      n1: {
        id: "n1", depth: 0, parent: null, children: [],
        range: [blocks[0]?.id, blocks[1]?.id], title: "Section n1", gist: "Gist for n1",
      },
    },
  } as unknown as Tree;
  const summary = buildSummaryTree(tree, blocks, null);
  if (!summary) throw new Error("fixture tree is unusable");
  return { root: summary, blocks };
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

function mount(kind: DiagramKind = "force", from: () => { root: SummaryNode; blocks: Block[] } = article) {
  const { root: tree, blocks } = from();
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
 * **What stands where a picture is not, and it is no longer another picture.**
 *
 * Drift and Trail have nothing to draw until the projection lands. Until
 * 2026-08-30 `layoutDiagram` handed back `layoutTree` and a strip said "the
 * picture below is the Tree instead" — and the panel then had to *render* it as
 * a tree, because the SVG's class picks the stylesheet and `NodeShape`'s branch
 * picks the shapes. Twice it did not, and the result was Tree geometry wearing
 * Drift's stylesheet: `.diag-drift .diag-box { fill: transparent; stroke: none }`
 * erased every row, and no `.diag-drift .diag-label` font size exists so labels
 * painted at the browser default. Nothing threw, nothing logged, and the
 * sentence above it said the right thing while the picture under it was broken
 * — GPT Sol's finding on the built code, 2026-08-27.
 *
 * Greg cut the Tree on 2026-08-30 and asked for the honest version:
 *
 * > just show a loading spinner or error
 *
 * So the whole class of bug is gone rather than guarded: there is no second
 * picture to be dressed as. What these pin is that the panel draws **no
 * picture at all** and says so, which is the thing a regression would undo.
 */
describe("a picture with no data yet", () => {
  it("draws no picture at all, rather than borrowing one", () => {
    mount("drift");
    expect(host.querySelector("svg.diag-svg"), "a picture was drawn with no data").toBeNull();
    /* The specific corpse to watch for. `.diag-tree` is gone from the
       stylesheet too, so this would now be an unstyled picture — which is
       exactly the failure that shipped twice. */
    expect(host.querySelector(".diag-tree")).toBeNull();
    expect(host.querySelectorAll(".diag-node").length).toBe(0);
  });

  it("shows the spinner and says what the wait is for", () => {
    // A bare spinner in a 288px band says "something". The reader has just
    // pressed a chip that costs a model call and is owed the sentence.
    mount("drift");
    const wait = host.querySelector(".diag-wait");
    expect(wait, "nothing stands where the picture will be").not.toBeNull();
    expect(wait?.querySelector(".cmt-spinner"), "no spinner").not.toBeNull();
    expect(wait?.textContent).toContain("paragraph by paragraph");
  });

  it("announces the wait once, not twice", () => {
    /* The strip above the picture used to carry these words as well, back when
       a fallback picture underneath needed explaining. Two `role="status"`
       elements saying the same thing is the same sentence read aloud twice. */
    mount("drift");
    const live = [...host.querySelectorAll('[role="status"]')];
    expect(live).toHaveLength(1);
    expect(live[0]?.className).toBe("diag-wait");
  });
});

/**
 * **The three other ways a picture can fail to appear**, all of which used to be
 * hidden behind the Tree and one of which was hidden behind an empty `<svg>`.
 *
 * ⟨Sol⟩, 2026-08-30, reviewing the built code: the panel tests covered the
 * loading case and the removal of the fallback, and nothing else — so the error
 * copy, the ready-but-empty copy and the zero-node layout were three states a
 * regression could have taken away in silence.
 */
describe("the other ways there is no picture", () => {
  /* The panel reads the projection through `useProjection`, which reads the
     route. Driving it from the route rather than stubbing the hook is what makes
     these tests able to fail for the right reason: a hook stub would still pass
     with the panel's branch deleted. */
  const answering = (respond: () => Response) => {
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) =>
      String(url).includes("/api/projection/")
        ? respond()
        : new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), {
            status: 200,
          }),
    );
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it("puts the server's own words where the picture would be, on a failure", async () => {
    /* **The reason, not a fixed sentence.** This strip said "Could not reach
       the embedding model" for every failure once, including the one actually
       happening in production — an account not allowed to use the model. */
    answering(() => new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 }));
    mount("drift");
    await settle();
    const wait = host.querySelector(".diag-wait");
    expect(wait?.textContent, "the failure is not on screen").toContain("Could not place");
    expect(wait?.textContent, "the server's own reason was thrown away").toContain("E_QUOTA");
    expect(wait?.querySelector(".cmt-spinner"), "still spinning after a failure").toBeNull();
    expect(host.querySelector("svg.diag-svg")).toBeNull();
  });

  it("says an article with too little prose is not an error", async () => {
    // Ready and empty: one long paragraph, or all headings. Dressing that as a
    // failure would send the reader looking for something to fix.
    answering(
      () =>
        new Response(
          JSON.stringify({
            model: "m", blocks: 0, k: 0, variance: [0, 0],
            skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points: [],
          }),
          { status: 200 },
        ),
    );
    mount("drift");
    await settle();
    const wait = host.querySelector(".diag-wait");
    expect(wait?.textContent).toContain("Nothing here to place");
    expect(wait?.textContent, "a success was reported as a failure").not.toContain("Could not");
    expect(wait?.querySelector(".cmt-spinner")).toBeNull();
  });

  it("explains an article with no sections rather than drawing an empty picture", () => {
    /* `layoutForce` draws only `depth > 0`, so a root-only tree lays out to a
       real layout holding no nodes — which took the SVG branch and painted a
       blank band with a working scrollbar and nothing in it. Not a wait: the
       reason is the article's own shape. */
    mount("force", rootOnlyArticle);
    expect(host.querySelectorAll("svg .diag-node").length).toBe(0);
    expect(host.querySelector("svg.diag-svg"), "an empty picture was drawn").toBeNull();
    expect(host.querySelector(".diag-wait")?.textContent).toContain("no sections inside it");
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
       proxy retry may repeat one. And the other two pictures must not ask for
       it at all: pressing a toggle is not a purchase decision, and it is
       certainly not a decision to buy the *other* picture's answer. */
    const calls: [string, string][] = [];
    /* **A body per route, not one body for everything.** The stub used to hand
       `useSimilar`'s answer to every request, which was harmless while only
       Force ever fetched — and mounting Drift here made the panel read
       `points.length` off an object that had no `points`, taking the whole
       render down. A stub that answers the wrong shape tests the code against a
       server that does not exist. */
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(url), init?.method ?? "GET"]);
      const body = String(url).includes("/api/projection/")
        ? { model: "m", blocks: 0, k: 0, variance: [0, 0], skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points: [] }
        : { model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    /* `apiFetch` asks for an auth token before it sends, so the request leaves
       on a later microtask than the effect that started it. Asserting straight
       after `act` sees an empty list and reads as "it never asked" — which is
       also what a genuinely missing request looks like. */
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    /* **Drift, as the picture that must not buy this one.** It has its own
       purchase to make — the projection — and the two answers are different
       things bought from different routes, so a gate that had slipped to "any
       picture that needs a model" would show up here as a second call. The free
       picture that used to hold this position, the Tree, was cut on
       2026-08-30. */
    mount("drift");
    await settle();
    expect(
      calls.filter(([url]) => url.includes("/api/similar/")),
      "only Force buys the embeddings",
    ).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    /* From here on, only what Force asked for. `calls` still holds Drift's
       projection request, and folding the two mounts together would make
       "every call went to /api/similar" false for a reason that has nothing to
       do with what this asserts. */
    const beforeForce = calls.length;
    mount("force");
    await settle();
    const byForce = calls.slice(beforeForce);
    expect(byForce.map(([, method]) => method)).toContain("POST");
    expect(byForce.every(([url]) => url.includes("/api/similar/"))).toBe(true);
  });
});
