// @vitest-environment jsdom
/**
 * **The step bar, wired up** — the panel mounted over a real article table,
 * with the rows placed by hand so that "which row is the reader on" has an
 * answer a test can change.
 *
 * Everything the ladder itself does is arithmetic and is tested as arithmetic
 * (tests/diagram.test.ts § paragraphStops). None of that catches the failures
 * this file is about, and all four of them shipped or nearly shipped:
 *
 *  1. the mark reading `?at=` — the section — instead of the paragraph the
 *     reader is standing in, so it lagged and jumped while they read;
 *  2. a second press landing mid-glide and stepping from a row half way
 *     between two rungs, so two presses moved one rung;
 *  3. a measurement going stale on a reflow that moved every row without the
 *     reader scrolling — a column toggle, the spine going away, a resize;
 *  4. the two scatters marking a reader who is inside the apparatus, which
 *     neither of them draws.
 *
 * ⟨Sol⟩ asked for exactly these, 2026-08-31: *"the pure `paragraphStops`
 * coverage cannot catch any of those wiring failures."* Right, and it is the
 * wiring that Greg reported.
 *
 * **How the reading line is faked.** `measureRow` (keynav.ts) takes the last
 * `tbody tr[data-block]` whose top has passed `stickyOffset() + 1`. jsdom lays
 * nothing out and there is no `.controls` bar here, so the offset is 0 and
 * every rect is 0×0 — which would make *every* row current. So each row gets a
 * `getBoundingClientRect` of its own, and `scrollTo(row)` below is what moves
 * them: exactly the arithmetic a real page does with a real scroll, and the
 * only thing in this file that is pretended.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, ProjectionResponse, Tree } from "../src/types.js";
import { DiagramPanel } from "../src/web/DiagramPanel.js";
import { buildSummaryTree, type SummaryNode } from "../src/web/tree.js";

/**
 * A `ResizeObserver` that never fires on its own and can be fired by hand.
 *
 * jsdom has none at all, and the panel needs one twice over: the scroller
 * measures itself with one, and `useReaderRow` watches the article's table with
 * one so that a reflow moving every row is not missed. `fireResize` below is
 * how the reflow test causes the second.
 */
const observers: (() => void)[] = [];
class FakeResizeObserver {
  constructor(private readonly cb: () => void) {
    observers.push(() => this.cb());
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const fireResize = () => {
  for (const fire of observers) fire();
};

/* React needs telling it is inside `act`, or every state update warns. Set once
   at module scope, as the other panel tests in this directory do. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE = { w: 340, h: 700 };

/** How far apart the fake rows sit. Only its sign and consistency matter. */
const ROW_H = 100;

const WORDS =
  "falconry hawking jesses gauntlet quarry stooping austringer merlin peregrine mews";

/**
 * Ten body paragraphs, an endnote stranded at row 6, and one more body
 * paragraph after it.
 *
 * The stranded note is the shape `splitBlocks` deliberately refuses to build a
 * supplement *node* for (src/supplement.ts) and the one the apparatus rule is
 * hardest on: the dots either side of it tile straight over the top of it, so
 * anything asking a *range* where the reader is gets a confident wrong answer.
 */
function article(): { root: SummaryNode; blocks: Block[] } {
  const blocks: Block[] = Array.from({ length: 12 }, (_, i) => ({
    id: `spya-b${i}` as BlockId,
    tag: "p",
    kind: "text",
    text: `${WORDS} ${i}`,
    words: 11,
    html: `<p>${WORDS} ${i}</p>`,
    gistable: true,
    ...(i === 6 && { treatment: "supplement" as const, role: "footnote" as const }),
  }));
  const tree = {
    version: "1",
    generator: "t",
    slug: "s",
    rootId: "n1",
    nodes: {
      n1: {
        id: "n1",
        depth: 0,
        parent: null,
        children: ["n2", "n3"],
        range: [blocks[0]?.id, blocks[11]?.id],
        title: "The whole thing",
        gist: "Gist for the whole thing",
      },
      n2: {
        id: "n2",
        depth: 1,
        parent: "n1",
        children: [],
        range: [blocks[0]?.id, blocks[5]?.id],
        title: "First half",
        gist: "Gist for the first half",
      },
      n3: {
        id: "n3",
        depth: 1,
        parent: "n1",
        children: [],
        range: [blocks[6]?.id, blocks[11]?.id],
        title: "Second half",
        gist: "Gist for the second half",
      },
    },
  } as unknown as Tree;
  const root = buildSummaryTree(tree, blocks);
  if (!root) throw new Error("fixture tree is unusable");
  return { root, blocks };
}

/**
 * A projection with a dot on every third body row — rows 0, 3, 9.
 *
 * Deliberately sparse, because that is the whole bug: on a real article a
 * fifth to a half of the paragraphs are under `MIN_WORDS` or not prose and get
 * no dot, and a ladder made of dots walks straight past them.
 */
const DOTTED = [0, 3, 9];

function projection(blocks: Block[]): ProjectionResponse {
  return {
    model: "test-embed",
    blocks: DOTTED.length,
    skipped: { nonProse: 0, tooShort: 9, capped: 0 },
    variance: [0.2, 0.1],
    k: 1,
    points: DOTTED.map((row, i) => ({
      id: blocks[row]?.id as BlockId,
      x: i * 0.1,
      y: i * -0.05,
      c: 0,
    })),
  };
}

let host: HTMLDivElement;
let root: Root;
let table: HTMLTableElement;
/** The row the fake reading line is on — see `scrollTo`. */
let onRow = 0;
let jumped: BlockId[] = [];
/** What `onFollow` was handed, when a case gives one — see "walking the picture" below. */
let followed: BlockId[] = [];

/**
 * Put the fake article in the document and place its rows.
 *
 * One `<tr data-block>` per block, which is the selector `measureRow` uses and
 * the same shape `TableView` renders. Their rects are computed rather than
 * stored so that `scrollTo` below is a single assignment.
 */
function layoutArticle(blocks: Block[]) {
  table = document.createElement("table");
  const body = document.createElement("tbody");
  table.append(body);
  blocks.forEach((b, i) => {
    const tr = document.createElement("tr");
    tr.dataset.block = b.id;
    tr.getBoundingClientRect = () =>
      ({ top: (i - onRow) * ROW_H, bottom: (i - onRow + 1) * ROW_H }) as DOMRect;
    body.append(tr);
  });
  document.body.append(table);
}

/** Scroll the article so `row` is the one under the reading line. */
async function scrollTo(row: number) {
  onRow = row;
  await act(async () => {
    window.dispatchEvent(new Event("scroll"));
    /* The listener defers to a frame, so the state does not land inside the
       dispatch. jsdom's rAF is a timer, and one turn of the loop is enough. */
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  onRow = 0;
  jumped = [];
  followed = [];
  observers.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  for (const [prop, value] of [
    ["clientWidth", SIZE.w],
    ["clientHeight", SIZE.h],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  table?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * Mount Drift over the fake article, with the projection already answered.
 *
 * `atRow` is deliberately a *lie* in most tests below — 0, the top — so that
 * anything still reading `?at=` instead of measuring shows up as a mark that
 * never moves. That is the bug, stated as a fixture.
 */
async function mount(opts: { atRow?: number | null; follow?: boolean } = {}) {
  const { root: tree, blocks } = article();
  layoutArticle(blocks);
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify(projection(blocks)), { status: 200 }),
  );
  await act(async () => {
    root.render(
      <DiagramPanel
        access={{ kind: "owner" }}
        experimental
        slug="s"
        root={tree}
        kind="drift"
        onKind={() => {}}
        atRow={opts.atRow ?? 0}
        onJump={(id) => jumped.push(id)}
        {...(opts.follow && { onFollow: (id: BlockId) => followed.push(id) })}
        blocks={blocks}
        axis="spread"
        onAxis={() => {}}
        hue="section"
        onHue={() => {}}
      />,
    );
  });
  // Let the projection's POST resolve and the picture lay out.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return blocks;
}

const readout = () => host.querySelector(".diag-step-at")?.textContent ?? "";
const nowY = () => host.querySelector("line.diag-now")?.getAttribute("y1") ?? null;
const press = async (which: "Previous" | "Next") => {
  const button = host.querySelector<HTMLButtonElement>(
    `.diag-step-btn[aria-label^="${which}"]`,
  );
  if (!button) throw new Error(`no ${which} button`);
  await act(async () => {
    button.click();
    await new Promise((r) => setTimeout(r, 5));
  });
};

describe("the mark follows the reader, not the address", () => {
  it("draws a picture with fewer dots than the article has paragraphs", async () => {
    // The premise the rest of the file rests on. If this ever stops being true
    // the fixture has stopped reproducing the bug and the tests below pass for
    // the wrong reason.
    await mount();
    expect(host.querySelectorAll(".diag-node").length).toBe(DOTTED.length);
    expect(readout()).toBe("1 / 11");
  });

  it("moves on a scroll that `?at=` never hears about", async () => {
    /* The reported bug, at its root. `?at=` names the section, so it does not
       change at all between rows 1 and 5 — and the panel drew the mark from it.
       Greg, 2026-08-31: "if I click up/down to move paragraphs in the text, it
       doesn't update the position correspondingly in the diagram." */
    await mount({ atRow: 0 });
    const first = nowY();
    await scrollTo(4);
    expect(readout()).toBe("5 / 11");
    expect(nowY(), "the you-are-here line did not follow the reader").not.toBe(first);
  });

  it("re-measures when the page reflows under it without a scroll", async () => {
    /* A column toggle rewraps every paragraph in the article, a late image
       pushes everything below it down, a font swaps in — and none of them moves
       the scrollbar, so a hook listening only to `scroll` goes on reporting a
       row that has stopped being under the reading line. It watches the
       article's table for this. ⟨Sol⟩, 2026-08-31: the first version listened
       to `scroll` and nothing else. */
    await mount({ atRow: 0 });
    await scrollTo(2);
    expect(readout()).toBe("3 / 11");
    // The reflow: same scroll position, different rows under the line.
    onRow = 8;
    await act(async () => {
      fireResize();
      await new Promise((r) => setTimeout(r, 20));
    });
    /* Row 8, which is the eighth rung rather than the ninth: row 6 is the
       endnote, and the ladder does not carry it. */
    expect(readout(), "the measurement survived a reflow that invalidated it").toBe("8 / 11");
  });
});

describe("one press is one paragraph", () => {
  it("steps to the next paragraph, not to the next dot", async () => {
    /* Greg, 2026-08-31: "If I press down, it seems to jump more than one
       paragraph." With dots on rows 0, 3 and 9, a dot ladder answers row 3. */
    const blocks = await mount();
    await scrollTo(1);
    await press("Next");
    expect(jumped).toEqual([blocks[2]?.id]);
  });

  it("counts two rapid presses as two, with the page still in flight", async () => {
    /* The second press lands before the glide has finished, so the reading line
       is still somewhere between the two rows — measure it and you step from
       half way and land on the rung you have just used. The last target stands
       instead (keynav.ts § `Chain`, which ↑ / ↓ share; this panel once had no
       such guard).

       The fixture never moves `onRow` between the presses, which is the
       strongest form of the case: nothing has caught up at all. */
    const blocks = await mount();
    await scrollTo(1);
    await press("Next");
    await press("Next");
    expect(jumped).toEqual([blocks[2]?.id, blocks[3]?.id]);
  });

  it("counts two rapid taps as two on a touch device, which is what these are for", async () => {
    /* **The chain used to be dropped by any `touchstart`**, and on an iPad every
       tap is one — so the second tap of a pair cleared the chain a moment
       before the `click` that needed it, and the race came back on exactly the
       device these buttons were added for (Greg, 2026-08-27: *"add big up/down
       buttons for touch devices (e.g. iPad)"*). The test above passed
       throughout, because `button.click()` fires no touch at all. ⟨Sol⟩,
       2026-08-31.

       So this dispatches the touch as well as the click, and the two together
       are the gesture a finger actually makes. */
    const blocks = await mount();
    await scrollTo(1);
    const tap = async () => {
      const button = host.querySelector<HTMLButtonElement>('.diag-step-btn[aria-label^="Next"]');
      if (!button) throw new Error("no Next button");
      await act(async () => {
        button.dispatchEvent(new Event("touchstart", { bubbles: true }));
        button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        button.click();
        await new Promise((r) => setTimeout(r, 5));
      });
    };
    await tap();
    await tap();
    expect(jumped).toEqual([blocks[2]?.id, blocks[3]?.id]);
  });

  it("forgets where it was going as soon as the reader moves the page themselves", async () => {
    /* A scrollbar drag and a PageDown fire neither `wheel` nor `touchstart`, so
       the chain has to key on *where* the gesture landed rather than on which
       gesture it was: anything outside the step bar ends it. Without that, the
       next press steps from a destination the reader has visibly left. ⟨Sol⟩,
       2026-08-31. */
    const blocks = await mount();
    await scrollTo(1);
    await press("Next");
    // The reader takes the page somewhere else, by a route that fires no wheel.
    await act(async () => {
      window.dispatchEvent(new Event("keydown", { bubbles: true }));
    });
    onRow = 8;
    await press("Next");
    expect(jumped).toEqual([blocks[2]?.id, blocks[9]?.id]);
  });

  it("measures the world again once the page is somewhere the press did not leave it", async () => {
    /* The other half of the same rule: the last target is worth something only
       while the page is where the press's jump ended. Until 2026-10-05 this
       waited 650 ms and expected the target forgotten with the page untouched:
       the timer, written down as the requirement (plan 261005h). What ends the
       aim is the page moving, however soon — and here by a route that fires no
       wheel, touch, pointer or key, so the listener the test above exercises
       cannot be what drops it. tests/step-chain.test.tsx has the same over the
       real scroll engine, and the pause that must *not* end it. */
    const blocks = await mount();
    await scrollTo(1);
    await press("Next");
    try {
      Object.defineProperty(window, "scrollY", { value: 800, configurable: true });
      await scrollTo(8);
      await press("Next");
      expect(jumped).toEqual([blocks[2]?.id, blocks[9]?.id]);
    } finally {
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    }
  });

  it("moves the readout on the press, not a frame later", async () => {
    /* Every other route into the panel's idea of the reader's row is a
       measurement, and a measurement costs a frame — so the readout used to
       show the *previous* paragraph until the scroll this press causes had been
       measured. In a browser on 2026-08-31 that read as six presses producing
       `9, 10, 10, 12, 12, 14`, each of which had moved the article exactly one
       paragraph. A press is the one case where the answer is known before the
       page has moved.

       `onJump` here scrolls nothing at all, so `onRow` never changes and no
       measurement can rescue the number: what the readout says afterwards is
       what the press itself put there. */
    await mount();
    await scrollTo(2);
    expect(readout()).toBe("3 / 11");
    await press("Next");
    expect(readout(), "the readout waited to be told where the press had gone").toBe("4 / 11");
    await press("Next");
    expect(readout()).toBe("5 / 11");
  });

  it("walks back up one paragraph at a time", async () => {
    const blocks = await mount();
    await scrollTo(4);
    await press("Previous");
    expect(jumped).toEqual([blocks[3]?.id]);
  });
});

describe("a reader inside the apparatus", () => {
  it("is marked nowhere, because neither scatter draws the notes", async () => {
    /* Row 6 is an endnote stranded mid-article. The dots either side tile over
       it, so `nodeAt` would light the dot at row 3 and the readout would call
       the reader the fourth paragraph of the argument — while `nowY`, which
       asks the block rather than the range, had already honestly withheld the
       line. Two halves of one picture disagreeing. ⟨Sol⟩, 2026-08-31. */
    await mount();
    await scrollTo(6);
    expect(nowY(), "a line was drawn for a reader who is not in the argument").toBeNull();
    expect(readout(), "the readout placed a reader who is in the notes").toBe("—");
    expect(host.querySelector(".diag-node.here"), "a dot was marked current").toBeNull();
  });

  it("still steps out of the notes from where the reader actually is", async () => {
    /* The mark is withheld; the ladder is not. A press must move on from row 6
       — where the reader physically is — rather than from the last place the
       picture was willing to draw them. */
    const blocks = await mount();
    await scrollTo(6);
    await press("Next");
    expect(jumped).toEqual([blocks[7]?.id]);
  });
});

describe("walking the picture, as against pressing something in it (260929g)", () => {
  /* Reader hands the Diagram band two callbacks: `onJump` is `bandJump`, which
     on a phone steps the band aside so the paragraph shows, and `onFollow` is
     plain `jumpTo`. Walking — the step buttons, the arrow keys — must take the
     second, or the first step on a phone would hide the picture being walked;
     a press on a dot or on the card's title is the reader asking to go there,
     and takes the first. GPT Sol, plan review of
     docs/plans/260929g-on-a-phone-a-band-link-closes-the-band.md, F3. */
  const node = (i: number) => {
    const el = host.querySelectorAll<HTMLElement>(".diag-node")[i];
    if (!el) throw new Error(`no node ${i}`);
    return el;
  };
  const key = async (el: HTMLElement, k: string) => {
    await act(async () => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    });
  };

  it("hands a step button's move to onFollow, not onJump", async () => {
    const blocks = await mount({ follow: true });
    await scrollTo(1);
    await press("Next");
    await press("Previous");
    expect({ followed, jumped }).toEqual({ followed: [blocks[2]?.id, blocks[1]?.id], jumped: [] });
  });

  it("hands an arrow key's move to onFollow, not onJump", async () => {
    /* Drift is flat, so ↓ and → both step to the next dot and take the article
       with them — DiagramPanel.tsx § `follow`. The dots are on rows 0, 3 and 9. */
    const blocks = await mount({ follow: true });
    await key(node(0), "ArrowDown");
    await key(node(1), "ArrowRight");
    expect({ followed, jumped }).toEqual({ followed: [blocks[3]?.id, blocks[9]?.id], jumped: [] });
  });

  it("hands a click on a dot, Enter or Space on one, and the card's title to onJump", async () => {
    const blocks = await mount({ follow: true });
    /* The dot is an SVG `<g>`, which has no `.click()` in jsdom. */
    await act(async () => void node(1).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await key(node(2), "Enter");
    await key(node(0), " ");
    const title = host.querySelector<HTMLButtonElement>(".diag-card-title");
    expect(title, "the card drew no title to press").not.toBeNull();
    await act(async () => title?.click());
    expect(jumped.slice(0, 3)).toEqual([blocks[3]?.id, blocks[9]?.id, blocks[0]?.id]);
    expect(jumped, "the card's title press did not reach onJump").toHaveLength(4);
    expect(followed).toEqual([]);
  });

  it("falls back to onJump for a step when no onFollow is given", async () => {
    /* Stated once on its own rather than only implied by every case above,
       none of which passes `onFollow`: another caller of DiagramPanel keeps the
       old behaviour. */
    const blocks = await mount();
    await key(node(0), "ArrowDown");
    /* The step bar measures the reader, not the dot, and the fake reading line
       is still on row 0 — so Next is row 1. */
    await press("Next");
    expect(jumped).toEqual([blocks[3]?.id, blocks[1]?.id]);
  });
});
