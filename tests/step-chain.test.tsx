// @vitest-environment jsdom
/**
 * **How long a step believes its own last aim** — ↑ / ↓ (keynav.ts §
 * `useArrowNav`) and the Diagram's Previous / Next (DiagramPanel.tsx §
 * `stepTo`), both over the *real* scroll engine.
 *
 * A press steps from the row the last press aimed at rather than from a
 * measurement, because a press mid-glide would measure a row half way. Until
 * plan 261005h that aim stood for 600 ms and was then dropped by a timer: a
 * clock standing in for a fact
 * (docs/postmortems/261005d-whose-scroll-was-that-decided-by-a-clock.md). The
 * rule now is the one this file pins:
 *
 *   the aim stands while our own jump is unfinished, and after it ends for as
 *   long as the page is still at the pixel it ended on.
 *
 * Every case here ran red against the timer or against the first proposed
 * replacement ("clear the chain when the jump reports done"), and each says
 * which.
 *
 * **What is pretended.** jsdom lays nothing out, so each row answers
 * `getBoundingClientRect` from its place in the document and `window.scrollY`,
 * as tests/scroll-settlement.test.ts does. Frames are a queue this file runs by
 * hand, which is how a glide is held back; `setTimeout` is vitest's, which is
 * how ten seconds pass without the glide moving. Nothing else: `scrollToBlock`,
 * `beginJump` and the panel are the real ones.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId, ProjectionResponse, Tree } from "../src/types.js";

/** Every block ↑ / ↓ sent the page to. The real scroll still runs. */
const stepped: string[] = [];
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...real,
    scrollToBlock: (...args: Parameters<typeof real.scrollToBlock>) => {
      stepped.push(args[0]);
      return real.scrollToBlock(...args);
    },
  };
});

const { scrollToTop } = await import("../src/web/scroll.js");
const { beginJump, chainedRow, endChain, startChain, useArrowNav } = await import("../src/web/keynav.js");
const { DiagramPanel } = await import("../src/web/DiagramPanel.js");
const { buildSummaryTree } = await import("../src/web/tree.js");
type NavPlan = import("../src/web/keynav.js").NavPlan;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ the page -- */

const WORDS = "falconry hawking jesses gauntlet quarry stooping austringer merlin peregrine mews";

/** Twelve paragraphs; row 6 is an endnote, which the Diagram's ladder skips. */
const BLOCKS: Block[] = Array.from({ length: 12 }, (_, i) => ({
  id: `spya-c${i}` as BlockId,
  tag: "p",
  kind: "text",
  text: `${WORDS} ${i}`,
  words: 11,
  html: `<p>${WORDS} ${i}</p>`,
  gistable: true,
  ...(i === 6 && { treatment: "supplement" as const, role: "footnote" as const }),
}));
const id = (row: number) => BLOCKS[row]?.id as BlockId;

let frames: FrameRequestCallback[] = [];
let now = 0;
let maxScroll = 0;
const realNow = performance.now;
const realMatchMedia = window.matchMedia;

const setScrollY = (y: number) =>
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });

/**
 * Lay the article out: one `<tr data-block>` per entry of `tops`, each at that
 * distance down the document, on a page that can scroll no further than `max`.
 */
function layOut(tops: number[], max: number): void {
  const tbody = document.createElement("tbody");
  tops.forEach((top, i) => {
    const tr = document.createElement("tr");
    tr.dataset.block = id(i);
    const td = document.createElement("td");
    td.className = "text";
    tr.append(td);
    tr.getBoundingClientRect = () => {
      const t = top - window.scrollY;
      return { top: t, bottom: t + 20, height: 20 } as DOMRect;
    };
    tbody.append(tr);
  });
  const table = document.createElement("table");
  table.id = "article";
  table.append(tbody);
  document.body.append(table);
  maxScroll = max;
  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: max + window.innerHeight,
    configurable: true,
  });
}

/** A thousand pixels a row, so a centred landing and a top one are rows apart. */
const TALL = BLOCKS.map((_, i) => i * 1000);

/** Let `ms` pass on the glide's clock and run the frames that were waiting. */
async function frame(ms: number): Promise<void> {
  await act(async () => {
    now += ms;
    const queued = frames;
    frames = [];
    for (const cb of queued) cb(now);
  });
}

/** Run a glide to its end. */
async function land(): Promise<void> {
  await frame(250);
  await frame(16);
}

/**
 * **Ten seconds go by and no frame runs** — a long render holding the glide
 * back, which is the shape GPT Sol reproduced (261005c code review, C3). Any
 * timer that was going to fire has fired.
 */
async function aLongRenderPasses(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
}

/**
 * The page ends up somewhere else by a route that fires no wheel, touch,
 * pointer or key: a scrollbar drag, the browser restoring a position, another
 * feature's jump. All a page hears is the scroll event.
 */
async function thePageMovesTo(y: number): Promise<void> {
  await act(async () => {
    setScrollY(y);
    window.dispatchEvent(new Event("scroll"));
  });
}

class QuietResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  stepped.length = 0;
  frames = [];
  now = 1000;
  performance.now = () => now;
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  vi.stubGlobal("ResizeObserver", QuietResizeObserver);
  for (const [prop, value] of [
    ["clientWidth", 340],
    ["clientHeight", 700],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
  }
  Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
  setScrollY(0);
  window.scrollTo = ((o: { top: number }) => {
    setScrollY(Math.max(0, Math.min(o.top, maxScroll)));
  }) as typeof window.scrollTo;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((n: number) => {
    frames[n - 1] = () => {};
  }) as typeof window.cancelAnimationFrame;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  history.replaceState(null, "", "/read/x");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  scrollToTop();
  host.remove();
  document.getElementById("article")?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  performance.now = realNow;
  window.matchMedia = realMatchMedia;
});

/* ----------------------------------------------------------- the rule -- */

describe("the chain: an aim, and whether it still stands", () => {
  it("stands while our jump has not ended, wherever the page is", () => {
    const chain = startChain(4);
    setScrollY(123);
    expect(chainedRow(chain)).toBe(4);
  });

  it("stands after the jump ends for as long as the page is at that pixel, and not after", () => {
    const chain = startChain(4);
    setScrollY(500);
    endChain(chain);
    expect(chainedRow(chain), "the page has not moved").toBe(4);
    setScrollY(501);
    expect(chainedRow(chain), "the page moved, so the aim says nothing").toBeNull();
  });

  it("is each press's own, so an older jump ending late does not end a newer one", () => {
    const older = startChain(2);
    const newer = startChain(3);
    setScrollY(700);
    endChain(older);
    setScrollY(900);
    expect(chainedRow(newer)).toBe(3);
  });

  it("is nothing when there is none", () => {
    expect(chainedRow(null)).toBeNull();
  });
});

/* -------------------------------------------------------------- ↑ / ↓ -- */

describe("↑ / ↓ over the real scroll", () => {
  function Keys({ rows }: { rows: number }) {
    const plan: NavPlan = { starts: [Array.from({ length: rows }, (_, i) => i)] };
    useArrowNav(plan, BLOCKS.slice(0, rows), 0);
    return null;
  }
  async function mount(tops: number[], max: number, startY: number) {
    layOut(tops, max);
    setScrollY(startY);
    await act(async () => {
      root.render(createElement(Keys, { rows: tops.length }));
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  const key = async (k: "ArrowUp" | "ArrowDown") => {
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  };

  it("steps on from its aim when the glide is still waiting for a frame, however long that is", async () => {
    /* Sol's C3. The timer fired at 600 ms with the glide not yet begun, the
       second press measured the row the reader had not left, and ↓ repeated
       itself. */
    await mount(TALL, 20_000, 1000);
    await key("ArrowDown");
    await aLongRenderPasses();
    await key("ArrowDown");
    expect(stepped).toEqual([id(2), id(3)]);
  });

  it("counts two presses as two when the second lands mid-glide", async () => {
    /* The second press's own scroll cancels the first, which reports
       `cancelled` *after* the second chain exists. A rule that cleared "the
       chain" on any ending would clear the wrong one. */
    await mount(TALL, 20_000, 1000);
    await key("ArrowDown");
    await frame(50);
    await key("ArrowDown");
    await frame(50);
    await key("ArrowDown");
    expect(stepped).toEqual([id(2), id(3), id(4)]);
  });

  it("measures again once the page has moved to a pixel that is not ours", async () => {
    /* Straight away, not after a pause: the timer went on believing the aim
       for 600 ms after the reader had left by scrollbar. */
    await mount(TALL, 20_000, 1000);
    await key("ArrowDown");
    await land();
    await thePageMovesTo(7000);
    await key("ArrowDown");
    expect(stepped).toEqual([id(2), id(8)]);
  });

  describe("at the end of the article, where the page cannot bring the row to the line (Sol P-8)", () => {
    /* Rows at 0, 200, 400 and 600 on a page that scrolls no further than 300.
       A step to row 2 settles at 300, where the row under the reading line is
       still row 1 — so a fresh measurement repeats ↓ and overshoots ↑. The aim
       is right and the page has not moved, however long ago the press was. */
    const SHORT = [0, 200, 400, 600];

    it("↓ ↓ reaches the last row", async () => {
      await mount(SHORT, 300, 200);
      await key("ArrowDown");
      await land();
      expect(window.scrollY, "the fixture stopped clamping").toBe(300);
      await aLongRenderPasses();
      await key("ArrowDown");
      expect(stepped).toEqual([id(2), id(3)]);
    });

    it("↓ then ↑ goes back one row, not two", async () => {
      await mount(SHORT, 300, 200);
      await key("ArrowDown");
      await land();
      await aLongRenderPasses();
      await key("ArrowUp");
      expect(stepped).toEqual([id(2), id(1)]);
    });
  });
});

/* -------------------------------------------------------- the Diagram -- */

describe("the Diagram's Previous / Next over the real scroll", () => {
  /** What the panel asked the article to follow it to. */
  let followed: BlockId[] = [];

  function fixture() {
    const tree = {
      version: "1",
      generator: "t",
      slug: "s",
      rootId: "n1",
      nodes: {
        n1: { id: "n1", depth: 0, parent: null, children: ["n2", "n3"], range: [id(0), id(11)], title: "All", gist: "g" },
        n2: { id: "n2", depth: 1, parent: "n1", children: [], range: [id(0), id(5)], title: "First", gist: "g" },
        n3: { id: "n3", depth: 1, parent: "n1", children: [], range: [id(6), id(11)], title: "Second", gist: "g" },
      },
    } as unknown as Tree;
    const summary = buildSummaryTree(tree, BLOCKS);
    if (!summary) throw new Error("fixture tree is unusable");
    const dotted = [0, 3, 9];
    const projection: ProjectionResponse = {
      model: "test-embed",
      blocks: dotted.length,
      skipped: { nonProse: 0, tooShort: 9, capped: 0 },
      variance: [0.2, 0.1],
      k: 1,
      points: dotted.map((row, i) => ({ id: id(row), x: i * 0.1, y: i * -0.05, c: 0 })),
    };
    return { summary, projection };
  }

  /**
   * Drift, whose ladder is one rung per body paragraph, with `onFollow` wired
   * the way Reader wires it: to the real `beginJump`, completion and all.
   */
  async function mount(startY: number) {
    followed = [];
    const { summary, projection } = fixture();
    layOut(TALL, 20_000);
    setScrollY(startY);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(projection), { status: 200 }));
    await act(async () => {
      root.render(
        <DiagramPanel
          access={{ kind: "owner" }}
          experimental
          slug="s"
          root={summary}
          kind="drift"
          onKind={() => {}}
          atRow={0}
          onJump={() => {}}
          onFollow={(block, ended) => {
            followed.push(block);
            beginJump(BLOCKS, block, () => {}, undefined, ended);
          }}
          blocks={BLOCKS}
          axis="spread"
          onAxis={() => {}}
          hue="section"
          onHue={() => {}}
        />,
      );
    });
    // The projection's POST resolves, and the picture lays out on a frame.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await frame(16);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }

  const button = (which: "Previous" | "Next") => {
    const el = host.querySelector<HTMLButtonElement>(`.diag-step-btn[aria-label^="${which}"]`);
    if (!el) throw new Error(`no ${which} button`);
    return el;
  };
  const press = async (which: "Previous" | "Next") => {
    await act(async () => {
      button(which).click();
    });
  };
  /** What a finger does: the touch and the pointer, then the click. */
  const tap = async (which: "Previous" | "Next") => {
    await act(async () => {
      const el = button(which);
      el.dispatchEvent(new Event("touchstart", { bubbles: true }));
      el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      el.click();
    });
  };

  it("steps on from its aim when the glide is still waiting for a frame, however long that is", async () => {
    // Sol's C3, as for ↑ / ↓ above.
    await mount(1000);
    await press("Next");
    await aLongRenderPasses();
    await press("Next");
    expect(followed).toEqual([id(2), id(3)]);
  });

  it("counts three presses as three when each lands mid-glide", async () => {
    // Each press's jump cancels the one before, which ends its own chain only.
    await mount(1000);
    await press("Next");
    await frame(50);
    await press("Next");
    await frame(50);
    await press("Next");
    expect(followed).toEqual([id(2), id(3), id(4)]);
  });

  it("counts two rapid taps as two, with the glide the second tap's touch has just stopped", async () => {
    /* The scroll engine stops a glide on any `touchstart`, the second tap's
       included, and reports `cancelled` before that tap's click arrives. So
       "forget the aim when our jump ends" forgets it a moment before the press
       that needs it, on the device these buttons exist for (Sol P-6). The
       glide stopped at some pixel and the click arrives at that same pixel,
       which is what keeps the aim. tests/diagram-step.test.tsx has the same
       taps over an `onJump` that scrolls nothing, where this cannot go wrong. */
    await mount(1000);
    await tap("Next");
    await frame(50);
    expect(window.scrollY, "the page should be mid-air").toBeGreaterThan(1000);
    expect(window.scrollY, "the page should be mid-air").toBeLessThan(1560);
    await tap("Next");
    expect(followed).toEqual([id(2), id(3)]);
  });

  it("steps on from its aim under reduced motion, before the instant jump's corrective frame", async () => {
    /* An instant jump moves the page at once and reports `settled` a frame
       later, after its re-check. In between, nothing is "in flight"
       (`glideTarget()` is null) and a centred row sits below the reading line
       with no arrival anchor yet, so a measurement names the row before it
       (Sol P-7). Only the jump's own report says it has ended. */
    window.matchMedia = ((q: string) => ({ matches: q.includes("reduce") }) as MediaQueryList) as typeof window.matchMedia;
    await mount(1000);
    await press("Next");
    expect(window.scrollY, "an instant jump moves the page in the press").toBe(1560);
    await aLongRenderPasses();
    await press("Next");
    expect(followed).toEqual([id(2), id(3)]);
  });

  it("ends the chain of a jump that had nowhere to go, so a page that then moves is measured", async () => {
    /* Next, and then Previous while the page is still on the row it started
       from: `beginJump` finds the reader already there, moves nothing, and
       starts no scroll that could report an ending. If that branch said
       nothing, the aim would stand until some listener happened to drop it. */
    await mount(1000);
    await press("Next");
    await frame(50);
    await press("Previous");
    expect(followed, "the fixture did not reach the already-there branch").toEqual([id(2), id(1)]);
    await thePageMovesTo(7000);
    await press("Next");
    expect(followed.at(-1)).toBe(id(8));
  });

  it("measures again once the page has moved to a pixel that is not ours", async () => {
    await mount(1000);
    await press("Next");
    await land();
    await thePageMovesTo(7000);
    await press("Next");
    expect(followed).toEqual([id(2), id(8)]);
  });
});

/* ------------------------------------------------- beginJump's ending -- */

describe("beginJump tells its caller the jump has ended, once, on every branch", () => {
  const jump = (row: number, ended: () => void) => beginJump(BLOCKS, id(row), () => {}, undefined, ended);

  beforeEach(() => {
    layOut(TALL, 20_000);
    setScrollY(1000);
  });

  it("when it settles, and not before", async () => {
    const ended = vi.fn();
    expect(jump(4, ended)).toBe(true);
    await frame(50);
    expect(ended, "mid-glide is not an ending").not.toHaveBeenCalled();
    await land();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("when the reader's wheel stops it", async () => {
    const ended = vi.fn();
    jump(4, ended);
    await frame(50);
    window.dispatchEvent(new Event("wheel"));
    expect(ended).toHaveBeenCalledTimes(1);
    await land();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("when the reader is already there and nothing moves", () => {
    const ended = vi.fn();
    expect(jump(1, ended)).toBe(false);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("when the block has no row to go to", () => {
    const ended = vi.fn();
    beginJump(BLOCKS, "spya-gone" as BlockId, () => {}, undefined, ended);
    expect(ended).toHaveBeenCalledTimes(1);
  });
});
