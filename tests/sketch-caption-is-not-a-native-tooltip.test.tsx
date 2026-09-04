// @vitest-environment jsdom
/**
 * **Where the Sketch's caption is allowed to appear, and where it is not.**
 *
 * Greg, 2026-09-03:
 *
 * > The "Down the page is time..." tooltip for Diagram/Sketch mode is annoying
 * > — it shows whenever the mouse is hovering over the Sketch diagram. Perhaps
 * > append that text instead to the tooltip when I hover over the Sketch
 * > button.
 *
 * It was an SVG `<title>`, which is a native tooltip over *every pixel* of the
 * picture: it came up between the boxes, and it came up on top of boxes the
 * card below was already describing. Two assertions, because either one alone
 * passes while the feature is wrong — the caption gone from the picture and
 * gone from the chip is a silent loss, and the caption on the chip while the
 * `<title>` is still there fixes nothing.
 *
 * The `<title>` half is a DOM absence, which is the shape of assertion that
 * rots: nothing fails if the element is renamed rather than removed. So it is
 * paired with the places the caption is *supposed* to be reachable — the bar
 * above the picture, the accessible name, and the chip's card — and those are
 * what would notice a "fix" that simply deleted the sentence.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, Tree } from "../src/types.js";
import { DiagramPanel } from "../src/web/DiagramPanel.js";
import { SketchView } from "../src/web/SketchView.js";
import { jobEngine } from "../src/web/jobEngine.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

/** The sentence this whole file is about, in the shape the model writes it. */
const CAPTION = "Down the page is time; sideways is who is arguing";

/* Two blocks, and the picture's one node points at the *second* — so with the
   reader at row 0 there is no node at or above them and the you-are-here ring
   is off, which keeps this case about the caption and nothing else. */
const BLOCKS: Block[] = [
  { id: "spya-b0" as BlockId, tag: "p", kind: "text", text: "one two three", words: 3, html: "<p>one two three</p>", gistable: true },
  { id: "spya-b1" as BlockId, tag: "p", kind: "text", text: "four five six", words: 3, html: "<p>four five six</p>", gistable: true },
];

/**
 * One scene, so the bar shows the plain title rather than the scene row, and
 * `sketch.caption` is the only caption in play — the picture's own, which is
 * what the chip's card quotes.
 */
const SKETCH = {
  version: 1,
  title: "The shape of it",
  caption: CAPTION,
  scenes: [
    {
      id: "overview",
      title: "The shape of it",
      height: 600,
      items: [
        { kind: "node", id: "claim", shape: "box", x: 200, y: 100, w: 200, h: 60, text: "a claim", size: "sm", block: "spya-b1" },
      ],
    },
  ],
};

/* jsdom lays nothing out, and both panels refuse to draw against a zero width
   on purpose. Same two stubs as tests/diagram-panel-hover.test.tsx, and the
   same reason: without them the assertions below are about an empty box. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SIZE = { w: 340, h: 700 };

/** The tree `DiagramPanel` needs to draw anything at all — two sections over
    four paragraphs, the same shape tests/diagram-panel-hover.test.tsx uses. */
function article(): { root: SummaryNode; blocks: Block[] } {
  const topics = [
    "falconry hawking jesses gauntlet quarry stooping austringer merlin",
    "geology basalt sediment tectonic strata outcrop metamorphic granite",
    "baking sourdough hydration levain crumb proving banneton scoring",
    "sailing halyard leeward tacking spinnaker keel bosun rigging",
  ];
  const blocks: Block[] = topics.map((text, i) => ({
    id: `spya-c${i}` as BlockId,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  }));
  const mk = (id: string, depth: number, parent: string | null, kids: string[], a: number, b: number) => ({
    id, depth, parent, children: kids,
    range: [blocks[a]?.id, blocks[b]?.id], title: `Section ${id}`, gist: `Gist for ${id}`,
  });
  const tree = {
    version: "1", generator: "t", slug: "s", rootId: "n1",
    nodes: {
      n1: mk("n1", 0, null, ["n2", "n3"], 0, 3),
      n2: mk("n2", 1, "n1", [], 0, 1),
      n3: mk("n3", 1, "n1", [], 2, 3),
    },
  } as unknown as Tree;
  const summary = buildSummaryTree(tree, blocks);
  if (!summary) throw new Error("fixture tree is unusable");
  return { root: summary, blocks };
}

/**
 * A server that has a Sketch for this article and nothing to say about
 * anything else. `/api/jobs` answers an empty list, because both panels poll
 * it and a stub that answers neither `done` nor a list spins forever.
 */
function serving() {
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/sketch/")) {
      return new Response(
        JSON.stringify({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false }),
        { status: 200 },
      );
    }
    if (u.includes("/advance")) {
      return new Response(JSON.stringify({ job: null, ran: null, busy: false, done: true }), { status: 200 });
    }
    if (u.includes("/api/jobs")) return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    /* `useSimilar`'s answer, for the Force picture the panel opens on. */
    return new Response(
      JSON.stringify({ model: "m", blocks: 0, eligible: 0, omitted: 0, pairs: [] }),
      { status: 200 },
    );
  });
  jobEngine.start("reader-1");
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  for (const [prop, value] of [["clientWidth", SIZE.w], ["clientHeight", SIZE.h]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  jobEngine.reset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/* Two flushes: `apiFetch` asks for a token before it sends, so the sketch and
   the job list land on different microtasks, and one flush sees a panel that
   has only half arrived. */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/**
 * Open the card on one control and hand back its text, then close it again.
 *
 * Focus rather than a synthetic pointer: `Tooltip`'s keyboard route and its
 * hover route are the same open state, and focus is the one a test can deliver
 * honestly (docs/project/tooltips.md § testing a card in jsdom is why the
 * pointer route takes two events). 400ms is the group's open delay plus its
 * transition — the same wait tests/diagram-panel-hover.test.tsx uses. The card
 * is portalled to `<body>`, so it is not inside `host`.
 */
async function cardOn(el: Element | null): Promise<{ text: string; drawn: string | null }> {
  expect(el, "nothing to open a card on").not.toBeNull();
  (el as HTMLElement).focus();
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  const card = document.querySelector('[role="tooltip"]');
  expect(card, "focusing it opened no card").not.toBeNull();
  const text = card?.textContent ?? "";
  /* The paragraph `ControlTip` renders only for what was drawn for *this*
     article — the one line in these cards that is not the same words for every
     reader. `null` when the card has no such paragraph, which is what every
     other chip's card should look like. */
  const drawn = card?.querySelector(".tip-soon-drawn")?.textContent ?? null;
  (el as HTMLElement).blur();
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  return { text, drawn };
}

describe("the caption is not a tooltip over the whole picture", () => {
  it("draws no SVG <title>, and still says the caption where it should", async () => {
    serving();
    await act(async () => {
      root.render(<SketchView slug="s" blocks={BLOCKS} atRow={0} onJump={() => {}} />);
    });
    await settle();

    const svg = host.querySelector("svg.sk-svg");
    expect(svg, "no picture, so nothing below means anything").not.toBeNull();
    /* The whole complaint: a `<title>` child of the drawn SVG is a native
       tooltip everywhere inside it. `querySelector("title")` and not
       `":scope > title"`, because a nested one is the same nuisance. */
    expect(
      svg?.querySelector("title"),
      "the picture carries an SVG <title> again — that is a native tooltip over every pixel of it",
    ).toBeNull();

    /* …and the caption did not simply go. Its two homes inside this panel: a
       real hover card on the bar above the picture — a target the reader aims
       at, rather than a sentence that follows the pointer around — and the
       SVG's accessible name, which is what a screen reader hears on the one tab
       stop the scene has.

       **A card, and specifically not a `title` attribute**, which is what the
       bar had until 2026-09-03 and is the regression docs/project/tooltips.md
       argues against: asserting the attribute here would have pinned the very
       thing three other test files sweep for.

       (Not the card under the picture. `SketchCard`'s empty state *is* the
       caption, but `shown` falls back to `painted.nodes[focused]` and `focused`
       starts at 0 — so with any node at all the card is describing a node from
       the first render, and the empty state is reached only by a scene with no
       nodes in it.) */
    const title = host.querySelector(".sk-title");
    expect(title?.getAttribute("title"), "the bar is back on a native `title`").toBeNull();
    expect(
      (await cardOn(title)).text,
      "the bar above the picture no longer carries the caption",
    ).toContain(CAPTION);
    expect(
      svg?.getAttribute("aria-label"),
      "the picture's accessible name no longer carries the caption",
    ).toContain(CAPTION);
  });

  /** The panel, on whichever picture. */
  async function panel(kind: "force" | "sketch") {
    const { root: tree, blocks } = article();
    await act(async () => {
      root.render(
        <DiagramPanel access={{ kind: "owner" }} slug="s" kind={kind} root={tree} onKind={() => {}} atRow={0} onJump={() => {}}
          blocks={blocks} axis="spread" onAxis={() => {}} hue="section" onHue={() => {}} />,
      );
    });
    await settle();
  }

  it("puts it on the Sketch chip's hover card instead", async () => {
    serving();
    /* Force: the chip's card is for a reader looking at another picture and
       deciding whether to press this one. */
    await panel("force");

    expect(
      (await cardOn(host.querySelector('[data-diag-kind="sketch"]'))).drawn,
      "the chip's card does not say what was drawn for this article",
    ).toContain(CAPTION);

    /* **And only that chip.** The caption belongs to the Sketch; a paragraph
       about it on Force's card would be describing a different picture. */
    expect(
      (await cardOn(host.querySelector('[data-diag-kind="force"]'))).drawn,
      "another picture's card is carrying the Sketch's caption",
    ).toBeNull();
  });

  /**
   * **The same card whichever picture is up**, which the first version of this
   * got wrong: the hook was gated on `kind !== "sketch"`, so hovering the very
   * chip you had just pressed gave a card one paragraph shorter than the one
   * you hovered a moment earlier — and, because the gate flipping cleared the
   * text, a card opened on the way back grew a paragraph while you read it.
   * ⟨Fable, code review⟩, 2026-09-03. The gate bought one duplicate free GET.
   */
  it("says the same thing while the Sketch itself is the picture on screen", async () => {
    serving();
    await panel("sketch");

    expect(
      (await cardOn(host.querySelector('[data-diag-kind="sketch"]'))).drawn,
      "the chip's card drops the caption once its own picture is up",
    ).toContain(CAPTION);
  });
});
