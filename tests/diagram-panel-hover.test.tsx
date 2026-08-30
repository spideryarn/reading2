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

/**
 * Twelve sections over twelve paragraphs, so the reading-order chain is long
 * enough to have a middle — the two-section fixture above has one link in it,
 * and a ramp with one step in it proves nothing about a ramp.
 */
function longArticle(): { root: SummaryNode; blocks: Block[] } {
  const blocks = Array.from({ length: 12 }, (_, i) =>
    block(`b${i}`, `${TOPICS[i % TOPICS.length]} ${i}`),
  );
  const mk = (i: number) => ({
    id: `n${i + 2}`,
    depth: 1,
    parent: "n1",
    children: [],
    range: [blocks[i]?.id, blocks[i]?.id],
    title: `Section ${i}`,
    gist: `Gist ${i}`,
  });
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n1",
    nodes: {
      n1: {
        id: "n1", depth: 0, parent: null, children: blocks.map((_, i) => `n${i + 2}`),
        range: [blocks[0]?.id, blocks[11]?.id], title: "Section n1", gist: "Gist for n1",
      },
      ...Object.fromEntries(blocks.map((_, i) => [`n${i + 2}`, mk(i)])),
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

function mount(
  kind: DiagramKind = "force",
  from: () => { root: SummaryNode; blocks: Block[] } = article,
  atRow = 0,
  /* Only the lane legend cares, and only on Drift — everything else here draws
     the same either way, so it stays defaulted rather than threaded through
     every call. */
  axis: "spread" | "lanes" = "spread",
) {
  const { root: tree, blocks } = from();
  act(() => {
    root.render(
      <DiagramPanel
        slug="s"
        root={tree}
        kind={kind}
        onKind={() => {}}
        atRow={atRow}
        onJump={() => {}}
        blocks={blocks}
        /* The two scatter pictures' controls. Passed because the panel requires
           them, and fixed rather than exercised: nothing here draws a scatter. */
        axis={axis}
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

/**
 * **A wait the reader can see, and a failure they can act on.**
 *
 * Greg, 2026-08-30:
 *
 * > Make sure the diagrams in Diagram mode show loading spinners if they're
 * > generating. And/or a button to trigger generation if needed.
 *
 * Two states were text-only. Force's strip said *"Reading the article for
 * related passages…"* in the same faint grey as the sentence it shows when the
 * answer has landed — a line that changes its words and nothing else does not
 * read as *working*, it reads as a caption. And a failed request, on any of the
 * three, left the reader with a reason and no verb: the fetch runs once from an
 * effect, so the only way back was to leave the mode and come in again, which
 * nothing on screen said.
 */
describe("saying it is working, and offering a second try", () => {
  /* A request that never answers, so the panel stays in the state this is
     about. Returning a pending promise rather than a slow one keeps the test
     free of timers. */
  const neverAnswers = () => vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  /** The Force strip — the one line of chrome that picture grows, and on Force
      the only `.diag-note` there is: the projection's own strip belongs to the
      two scatters. Found by class rather than by its words, so a state that has
      lost its sentence fails here rather than quietly matching nothing. */
  const strip = () => host.querySelector(".diag-note");

  it("spins while Force is buying the embeddings", async () => {
    neverAnswers();
    mount("force");
    await settle();
    const note = strip();
    expect(note, "the strip says nothing while the call is in flight").not.toBeNull();
    expect(note?.textContent).toContain("related passages");
    expect(note?.querySelector(".cmt-spinner"), "no spinner while a model call is in flight").not.toBeNull();
  });

  it("stops spinning once the embeddings have landed", async () => {
    mount("force");
    await settle();
    expect(strip()?.querySelector(".cmt-spinner"), "still spinning after the answer").toBeNull();
  });

  it("gives Force a way to ask again when the embeddings fail", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async () => {
      asked += 1;
      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });
    mount("force");
    await settle();
    expect(asked, "the panel never asked").toBeGreaterThan(0);
    expect(strip()?.textContent, "the failure is not on screen").toContain("E_QUOTA");
    const again = strip()?.querySelector<HTMLButtonElement>("button") ?? null;
    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
    const before = asked;
    await act(async () => {
      again?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
  });

  it("gives Drift a way to ask again when the projection fails", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      if (!String(url).includes("/api/projection/")) {
        return new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 });
      }
      asked += 1;
      return new Response(JSON.stringify({ error: "no credit [E_QUOTA]" }), { status: 402 });
    });
    mount("drift");
    await settle();
    const wait = host.querySelector(".diag-wait");
    expect(wait?.textContent, "the failure is not on screen").toContain("Could not place");
    const again = wait?.querySelector<HTMLButtonElement>("button") ?? null;
    expect(again, "a failure with no verb — the reader can only leave the mode").not.toBeNull();
    const before = asked;
    await act(async () => {
      again?.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked, "the button did not start a second request").toBeGreaterThan(before);
  });
});

/**
 * **The ramp along the sequence chain, at the one seam nothing else covers.**
 *
 * `chainNearness` is tested as arithmetic in tests/diagram.test.ts and the
 * stylesheet's steps are checked in tests/diagram-css.test.ts — and both of
 * those stay green if the panel never puts the class on the path. That is the
 * whole failure: every level computed, every rule written, and a chain drawn
 * flat, with nothing thrown and nothing logged.
 *
 * Greg, 2026-08-30: *"making the connections directly either side of the
 * current node most prominent. Then a bit fainter for the ones at one remove,
 * then a bit fainter for the ones at two removes, etc etc."*
 */
describe("the chain's ramp reaches the DOM", () => {
  const levels = () =>
    [...host.querySelectorAll(".diag-link-sequence")].map((el) =>
      Number(/diag-near-(\d+)/.exec(el.getAttribute("class") ?? "")?.[1] ?? Number.NaN),
    );

  it("brightens the two lines either side of the section the reader is in", () => {
    mount("force", longArticle, 6);
    const on = levels();
    expect(on.length).toBeGreaterThan(6);
    // Exactly the pair touching the reader's own section is at the top step.
    expect(on.filter((l) => l === 0)).toHaveLength(2);
    // And the ramp really is a ramp rather than one bright pair and a cliff.
    expect(new Set(on.filter((l) => Number.isFinite(l))).size).toBeGreaterThan(2);
  });

  it("moves the bright pair when the reader moves", () => {
    /* The property a static class name would pass without: the ramp has to
       follow `atRow`. Watched fail with the memo keyed on the layout alone. */
    mount("force", longArticle, 1);
    const early = levels();
    mount("force", longArticle, 10);
    const late = levels();
    expect(early).not.toEqual(late);
    expect(early.indexOf(0)).toBeLessThan(late.indexOf(0));
  });

  it("leaves the chain unclassed when the reader is above the article", () => {
    /* `nodeAt` answers null for a reader who has not reached the first section,
       and the chain must then look exactly as it always did rather than picking
       the first node as a centre. */
    mount("force", longArticle, -1);
    expect(levels().every((l) => Number.isNaN(l))).toBe(true);
  });
});

/**
 * **A revalidation that fails must not take the picture away.**
 *
 * Both fetches re-run whenever their picture becomes the one on screen again —
 * Force → Drift → Force asks for the embeddings a second time. The comment
 * beside that guard has always promised that toggling away and back "must not
 * throw away an answer already paid for", and only half of it was true: the
 * *loading* state was suppressed, and the `catch` then replaced the ready data
 * with nothing at all. So one flaky second request emptied a picture that was
 * complete, and reported a failure about a picture the reader already had.
 *
 * It is the rule `useSketch` and `useIdeas` already write down — a failed
 * revalidation is not news, because the artefact on screen is still good —
 * applied to the two hooks that had not got it. ⟨Sol⟩, 2026-08-30, reviewing
 * the spinner work.
 */
describe("a second request that fails, over an answer that already landed", () => {
  /** A successful projection holding nothing, for the routes a test is not about. */
  const EMPTY_PROJECTION = {
    model: "m", blocks: 0, k: 0, variance: [0, 0],
    skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points: [],
  };
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it("does not buy the same answer twice for one article", async () => {
    /* **Toggling is not invalidation.** Both hooks re-ran their POST every time
       their picture came back on screen, on the reasoning that the server
       caches — but `similar.ts` says a cold process is the normal case on
       Vercel and re-embeds the article for about $0.002, so a reader stepping
       between the chips was spending money to be told what the panel was
       already holding. Nothing about a chip press says the article changed.
       ⟨Sol⟩, 2026-08-30. */
    let asked = 0;
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/similar/")) asked += 1;
      return String(url).includes("/api/projection/")
        ? new Response(JSON.stringify(EMPTY_PROJECTION), { status: 200 })
        : new Response(JSON.stringify({ model: "m", blocks: 7, eligible: 7, omitted: 0, pairs: [] }), { status: 200 });
    });

    mount("force");
    await settle();
    expect(asked, "it never asked at all").toBe(1);

    mount("drift");
    await settle();
    mount("force");
    await settle();
    mount("drift");
    await settle();
    mount("force");
    await settle();
    expect(asked, "each visit back to Force bought the embeddings again").toBe(1);
  });

  /* **The two tests that used to sit here have moved**, to
     tests/diagram-answer-survives.test.tsx. They drove a failed *repeat*
     through the panel — toggle away, toggle back, second request refused — and
     the guard above has made that path unreachable: a chip press no longer buys
     anything, so there is no second request to fail. The rule they pin is the
     hook's own and still matters, so it is now tested against the hook, through
     the one caller that can still reach it: `retry` while an answer is held. */
});

/**
 * **Every control in this band explains itself, and in a card rather than a
 * `title`.**
 *
 * Greg, 2026-08-27, about the chip row: *"add tooltips when hovering over each
 * Diagram button to explain how it works"* — and again on 2026-08-30 about
 * everything under it: *"add detailed tooltips to the various diagram-buttons
 * etc to explain how things work."*
 *
 * The `title` attribute is what the second ask is against, and it is not a
 * smaller version of a card: it waits about a second, cannot be styled,
 * truncates at the OS's idea of a line, and **does not exist at all on a touch
 * device** — which is the device the step bar was specifically built for. So
 * what this pins is the absence too: a `title` creeping back onto a control
 * here is a regression, and it is invisible on a laptop because it still shows
 * *something*.
 *
 * The cards' wording is not asserted. It is copy, it will be edited, and a test
 * that spelled it out would be a second copy of the words to keep in step. What
 * has to hold is that each control has a card, that the card is *that*
 * control's, and that it says more than the control's own label already does.
 */
describe("the controls explain themselves", () => {
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  /**
   * **Open the card and read it**, rather than looking for a mark on the
   * trigger.
   *
   * Floating UI puts nothing durable on a trigger — `aria-describedby` appears
   * only while the card is open — so an attribute check is a check that passes
   * on a control with no card at all. Focus is the opener that works here:
   * `Tooltip` includes `useFocus`, and a hover in jsdom does not reach it
   * (measured, not assumed: `mouseover` leaves nothing on screen and `focus()`
   * renders the panel). It is also the interaction that matters most for the
   * ask, because after a touch reader the keyboard reader is who a `title`
   * serves worst.
   *
   * The card is portalled to the end of `<body>`, so it is looked for in the
   * document — and that is a hole on its own: a neighbour's card left open
   * would be read as this control's, which is exactly how a test like this
   * passes with a card attached to the wrong thing. ⟨Sol⟩ named it. Two things
   * plug it: the surface is cleared before each control, and **exactly one**
   * card must be open after focusing it — then the caller checks the card's
   * head against the control it focused.
   */
  const cardFor = async (el: Element): Promise<{ head: string; body: string }> => {
    /* Close whatever is open first. A previous control's card outliving its
       blur is what would let the query below read a neighbour's words as this
       control's, and it does outlive it across a remount — the card is
       portalled to `<body>`, so it is not inside the host this file replaces.
       Blurred and waited out rather than removed from the DOM: the card is
       React's, and tearing its node out from under it took the *next* mount's
       panel down with it — five seconds of timeout and an undrawn band. */
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    (el as HTMLElement).focus();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    const cards = document.querySelectorAll('[role="tooltip"]');
    expect(cards, "focusing this control opened no card, or more than one").toHaveLength(1);
    const card = cards[0];
    const head = card?.querySelector(".tip-soon-head")?.textContent ?? "";
    const body = (card?.textContent ?? "").slice(head.length);
    (el as HTMLElement).blur();
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    return { head, body };
  };

  /** More than the label the reader can already see, which is the whole point. */
  const isDetailed = (body: string) => body.length > 80;

  /* Two 400ms waits per control — the delay group's open plus its transition —
     so four chips is already close to vitest's 5s default, and the first run of
     this timed out at 5007ms. Shortening the wait trades a slow test for a
     flaky one. */
  it("puts a card on every chip in the picture row", { timeout: 20000 }, async () => {
    mount("force");
    await settle();
    const chips = [...host.querySelectorAll(".diag-kind")];
    expect(chips.length, "the chip row is not drawn").toBeGreaterThan(3);
    for (const chip of chips) {
      const label = chip.textContent ?? "?";
      const card = await cardFor(chip);
      expect(card.head, `the open card is not ${label}'s`).toBe(label);
      expect(isDetailed(card.body), `${label}'s card is a label, not an explanation`).toBe(true);
      expect(chip.hasAttribute("title"), `${label} fell back to a title attribute`).toBe(false);
    }
  });

  it("puts a card on the step bar, which is the one built for a device titles do not reach", { timeout: 20000 }, async () => {
    mount("force");
    await settle();
    const bar = host.querySelector(".diag-step");
    expect(bar, "the step bar is not drawn").not.toBeNull();
    const parts = [...(bar?.querySelectorAll(".diag-step-btn, .diag-step-at") ?? [])];
    expect(parts.length, "the bar should be two buttons and a readout").toBe(3);

    /* **The ↑ is greyed out here**, because the fixture stands the reader on
       row 0 — and that is the case worth having. It was a `disabled` button,
       which cannot be focused and fires no mouse events, so the card saying
       *why it is dead* was unreachable by exactly the reader asking. */
    expect(parts[0]?.getAttribute("aria-disabled"), "the fixture does not reach the greyed case").toBe("true");

    const heads = ["Previous", "Where you are", "Next"];
    for (const [i, part] of parts.entries()) {
      const card = await cardFor(part);
      expect(card.head, "the open card belongs to another control").toContain(heads[i] as string);
      expect(isDetailed(card.body), `${card.head}'s card is a label, not an explanation`).toBe(true);
      expect(part.hasAttribute("title"), "a step control fell back to a title").toBe(false);
    }
  });

  /* Seven controls at two 400ms waits each is over vitest's 5s default, and a
     shorter wait is not available: 400ms is the delay group's open plus its
     transition, and trimming it would make this flaky rather than fast. */
  it("puts a card on the axis, colour and lane chips, which is where a title used to be", { timeout: 20000 }, async () => {
    /* These need a drawn scatter: the second control row and the legend render
       only when there are dots. */
    const points = [
      { id: "spya-b0", x: -0.4, y: 0.1, c: 0 },
      { id: "spya-b2", x: 0.4, y: -0.1, c: 1 },
    ];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL) =>
      String(url).includes("/api/projection/")
        ? new Response(
            JSON.stringify({
              model: "m", blocks: 2, k: 2, variance: [0.2, 0.1],
              skipped: { tooShort: 0, nonProse: 0, capped: 0 }, points,
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }), { status: 200 }),
    );
    mount("drift", article, 0, "lanes");
    await settle();

    const opts = [...host.querySelectorAll(".diag-opt-btn")];
    expect(opts.length, "the second control row is not drawn").toBeGreaterThan(2);
    for (const o of opts) {
      const label = o.textContent ?? "?";
      const card = await cardFor(o);
      expect(card.head, `the open card is not ${label}'s`).toBe(label);
      expect(isDetailed(card.body), `${label}'s card is a label, not an explanation`).toBe(true);
      expect(o.hasAttribute("title"), `${label} kept its title attribute`).toBe(false);
    }

    /* **The lane legend, which was the one still unreachable.** Its triggers
       are `<li>`s and `Tooltip`'s keyboard route is focus, so the two words the
       chip is too narrow to show could be got at by pointer only — the same
       failure the `title` attribute already had here. ⟨Sol⟩, 2026-08-30. This
       reaches them by focus, which a plain `<li>` cannot take. */
    const lanes = [...host.querySelectorAll(".diag-lane")];
    expect(lanes.length, "the lane legend is not drawn").toBeGreaterThan(0);
    for (const [i, lane] of lanes.entries()) {
      const card = await cardFor(lane);
      expect(card.head, "the open card belongs to another column").toContain(`Column ${i + 1}`);
      expect(isDetailed(card.body), "a column's card is a label, not an explanation").toBe(true);
      expect(lane.hasAttribute("title"), "a lane chip kept its title attribute").toBe(false);
    }
  });
});
