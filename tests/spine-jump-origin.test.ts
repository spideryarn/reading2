// @vitest-environment jsdom
/**
 * **The rail marks where the reader jumped from, while the chip is up.**
 *
 * Stage C of docs/plans/260906g-back-to-where-you-jumped-from.md. The chip
 * (ReturnChip.tsx) names the place in words; this answers the thing a label
 * cannot — *how far did I come?* — and it is one mark rather than the fading
 * trail Greg first imagined, for the reason the plan's § Why not the fading
 * spine trail gives.
 *
 * The arithmetic is in tests/spine-marks.test.ts § jumpOriginMark, which is
 * where a wrong row or a mark drawn at zero gets caught. **What is left for
 * this file is everything about the mark that is not arithmetic**, and all of
 * it is invisible:
 *
 *  - **The gate is the chip's own gate**, because it is the chip's own datum —
 *    `readStamp(history.state)` through `useJumpOrigin`, not a second record.
 *    A mark drawn on an entry no jump stamped looks exactly like a mark on one
 *    that was.
 *  - **It must not take a search lane.** The rail is 12px and `laneOrder`
 *    *packs* the lanes, so anything joining that packing shifts every search
 *    sideways — and a mark in the wrong lane looks exactly like a mark in the
 *    right one.
 *  - **Tree order is paint order** in the track, so a mark rendered after the
 *    search marks would hide a hit, and nothing would look wrong until
 *    somebody was searching.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/web/perf.js", () => ({
  useRenderCount: () => {},
  mark: (_l: string, fn: () => unknown) => fn(),
}));

/* Floating UI does real geometry and is not what is under test. */
vi.mock("../src/web/Tooltip.js", () => ({
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipGroup: ({ children }: { children: unknown }) => children,
}));

import { Spine } from "../src/web/Spine.js";
import { armJump, clearArmedJump, type JumpOrigin } from "../src/web/jump-history.js";
import { dismissJumpOrigin, watchHistoryWrites } from "../src/web/router.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";
import type { BlockMatch } from "../src/web/search-hits.js";

/* Ours is the outer wrapper in main.tsx; nuqs is not mounted here because
   nothing in this file goes through a query parameter — the stamp lives on
   `history.state`, which is the whole reason the chip needs a store of its
   own. */
watchHistoryWrites();

/** Twenty 100px rows, so the article is 2,000px and a row is 5% of the rail. */
const ROWS = 20;
const ROW_H = 100;

/* Ids in the shape this app mints, because `readStamp` validates them and a
   fixture id it rejects would make every "draws nothing" assertion pass for the
   wrong reason. The alphabet drops `1`, `i`, `l` and `o` (src/ids.ts), so a row
   is spelled `a` for 0 through `k` for 9 — row 15 is `spya-parabf`. */
const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;

/** A block id in the right shape that this twenty-row article does not have. */
const GHOST = block(99);

const at = (id: BlockId): JumpOrigin => ({ kind: "block", blockId: id });
const TOP: JumpOrigin = { kind: "top" };

function node(id: string, first: string, last: string): TreeNode {
  return {
    id: id as NodeId,
    parent: null,
    children: [],
    depth: 1,
    title: id,
    gist: id,
    range: [first, last],
  } as unknown as TreeNode;
}

function entry(
  id: string,
  startRow: number,
  endRow: number,
  children: OutlineEntry[] = [],
): OutlineEntry {
  return {
    node: node(id, block(startRow), block(endRow)),
    startRow,
    endRow,
    words: (endRow - startRow + 1) * 10,
    children,
  };
}

/** One part of three sections, which is enough rail to place a mark on. */
const OUTLINE: OutlineEntry[] = [
  entry("whole", 0, 19, [entry("s1", 0, 5), entry("s2", 6, 12), entry("s3", 13, 19)]),
];

/** One saved search matching one block, for the lane assertions. */
const MATCHES = new Map<BlockId, BlockMatch>([
  [block(11), { searches: [{ runId: "r1", slot: 0 }], count: 2 }],
]);

let root: Root;
let host: HTMLDivElement;

class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    cb: (t: number) => void,
  ) => setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = (id: number) =>
    clearTimeout(id);
  document.body.innerHTML = "";
  history.replaceState(null, "", "/read/x");
  clearArmedJump();
  /* **And take the stamp off, which the line above does not.** A same-path
     replace *preserves* the stamp on purpose (router.ts § the wrapper's three
     rules), so resetting the address leaves the previous test's origin sitting
     on the entry and the next test mounts with a mark already drawn. Found by
     running this file with `--sequence.shuffle.tests` — GPT Sol F27,
     2026-09-06, and it was true of three suites rather than this one. */
  dismissJumpOrigin();

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < ROWS; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", block(i));
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const id = this.getAttribute("data-block");
      if (!id) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const i = DIGITS.indexOf(id.charAt(9)) * 10 + DIGITS.indexOf(id.charAt(10));
      const top = i * ROW_H - window.scrollY;
      return { top, bottom: top + ROW_H, left: 0, right: 0, width: 0, height: ROW_H };
    },
  });

  Object.defineProperty(window, "scrollY", { value: 0, writable: true, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 500, writable: true, configurable: true });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 32));
  });
}

async function mount(matches?: Map<BlockId, BlockMatch>): Promise<void> {
  await act(async () => {
    root.render(
      createElement(Spine, { outline: OUTLINE, layoutKey: "x", onJump: () => {}, matches }),
    );
  });
  await settle();
  expect(
    host.querySelector(".spine-viewport"),
    "the rail must have measured before anything is asserted",
  ).not.toBeNull();
}

/**
 * A jump, as the wrapper sees one: arm the origin, then push the destination.
 * Straight `history.pushState`, which is what nuqs's flush eventually calls —
 * tests/return-chip.test.tsx drives the chip the same way.
 */
function jumped(origin: JumpOrigin, target: BlockId): void {
  act(() => {
    armJump({
      pathname: location.pathname,
      from: location.pathname + location.search,
      origin,
      target,
    });
    history.pushState(history.state, "", `/read/x?at=${target}`);
  });
}

const marks = () => host.querySelectorAll<HTMLElement>(".spine-from");
const mark = () => host.querySelector<HTMLElement>(".spine-from");
/**
 * The mark's top, which it publishes as a custom property rather than setting
 * `top` — so the stylesheet can clamp it inward and keep the 3px floor inside
 * the rail. `.spine-here` does the same thing for the same reason; Spine.tsx
 * has it.
 */
const markTop = () => mark()?.style.getPropertyValue("--from-top");

describe("the mark for where the reader jumped from", () => {
  it("draws nothing on an entry no jump stamped", async () => {
    await mount();
    /* The ordinary rail. The chip is not up here either — one datum, one
       answer. */
    expect(marks()).toHaveLength(0);
  });

  it("draws one mark at the origin block's row after a jump", async () => {
    await mount();
    jumped(at(block(7)), block(18));

    expect(marks(), "exactly one mark — this is not a trail").toHaveLength(1);
    /* Row 7 of twenty 100px rows: 700px down a 2000px article, 100px tall. */
    expect(markTop()).toBe("35%");
    expect(mark()?.style.height).toBe("5%");
  });

  it("draws nothing for a jump from the top of the article", async () => {
    await mount();
    jumped(TOP, block(18));

    /* There is no block to mark: `top` is what `measureOrigin` answers when no
       row has reached the reading line, so the reader was looking at the
       masthead. GPT Sol F8, and the chip carries the whole fact in words —
       "back to the beginning". */
    expect(marks()).toHaveLength(0);
  });

  it("draws nothing for a stamp naming a block this article no longer has", async () => {
    await mount();
    jumped(at(GHOST), block(18));

    /* The chip hides a stamp it cannot resolve rather than drawing a button
       that would do nothing; the rail skips it rather than drawing it at the
       top, which is the only failure here a reader would act on. */
    expect(marks()).toHaveLength(0);
  });

  it("draws nothing while a jump is in flight", async () => {
    await mount();
    jumped(at(block(7)), block(18));
    expect(marks(), "the mark for the jump that landed").toHaveLength(1);

    /* The 50ms — 320ms on an older Safari — between the reader asking and nuqs
       flushing the push that records it. The entry underneath still describes
       the *previous* jump, so anything drawn from it names the wrong origin.
       GPT Sol F19; the chip withholds its claim in exactly this window and the
       mark is the same claim. */
    await act(async () => {
      armJump({
        pathname: location.pathname,
        from: location.pathname + location.search,
        origin: at(block(18)),
        target: block(2),
      });
    });
    expect(marks()).toHaveLength(0);
  });

  it("goes when the reader dismisses the chip", async () => {
    await mount();
    jumped(at(block(7)), block(18));
    expect(marks()).toHaveLength(1);

    /* The ×. It strips the stamp from the entry the reader is standing on, and
       the mark is a view of that stamp — so the two go together without the
       rail knowing the chip exists. A mark left behind here would be the only
       part of the feature the reader could not get rid of. */
    await act(async () => {
      dismissJumpOrigin();
    });
    expect(marks()).toHaveLength(0);
  });

  /**
   * **A search mark is placed down the rail, and by the clamped property.**
   *
   * `.spine-match` used to set `top` inline, which meant its 3px floor grew
   * past the bottom of `.spine { overflow: hidden }` for a hit in the article's
   * final block — measured in a browser at `top: 798.9, bottom: 801.9` against
   * a rail ending at 800. It now sets `--match-top` and the stylesheet clamps
   * it, like `.spine-here` and `.spine-from`.
   *
   * This test exists because that change is otherwise **invisible to the
   * suite**: misspell the property and every rule reading it falls back to
   * `top: auto`, which stacks every search hit at the top of the rail — a
   * total, obvious, reader-facing break that no assertion in this repo would
   * have caught. jsdom applies no stylesheet, so the clamp itself cannot be
   * asserted here; what can be, and is, is that the number goes to the property
   * the clamp reads and to no other.
   */
  it("places a search mark by the clamped custom property, not by top", async () => {
    await mount(MATCHES);
    const first = host.querySelector<HTMLElement>(".spine-match");
    expect(first, "the fixture should draw a search mark").toBeTruthy();
    expect(first?.style.getPropertyValue("--match-top")).toMatch(/^\d/);
    expect(first?.style.top, "top is the stylesheet's, computed from --match-top").toBe("");
  });

  it("takes no search lane, and moves no search mark sideways", async () => {
    await mount(MATCHES);
    const before = host.querySelector<HTMLElement>(".spine-match")?.getAttribute("style");
    const lanesBefore = host
      .querySelector<HTMLElement>(".spine-matches")
      ?.style.getPropertyValue("--lanes");
    expect(before, "the fixture should draw a search mark").toBeTruthy();

    jumped(at(block(7)), block(18));

    expect(marks(), "the mark is drawn").toHaveLength(1);
    /* **The rail is 12px and `laneOrder` packs its lanes**, so a mark that
       joined the packing would shift every search's bar sideways by a lane —
       and a bar in the wrong lane looks exactly like a bar in the right one.
       Comparing the whole inline style rather than one property: `right` is
       computed from `--lane` and `--lane-w` in CSS, so the number to pin is
       the lane, and the width comes from `--lanes` beside it. */
    expect(host.querySelector<HTMLElement>(".spine-match")?.getAttribute("style")).toBe(before);
    expect(
      host.querySelector<HTMLElement>(".spine-matches")?.style.getPropertyValue("--lanes"),
    ).toBe(lanesBefore);
    expect(
      mark()?.closest(".spine-matches"),
      "the mark must not even be inside the lane container, which is where a lane comes from",
    ).toBeNull();
  });

  it("paints over the ticks and under the search marks", async () => {
    await mount(MATCHES);
    jumped(at(block(7)), block(18));

    const kids = [...(host.querySelector(".spine-track")?.children ?? [])];
    /* `classList.contains`, never the leading class name — the check that
       stops checking without going red, written up in tests/spine-here.test.ts. */
    const first = (c: string) => kids.findIndex((el) => el.classList.contains(c));
    /* Written out rather than `findLastIndex`, which this project's `lib` is
       older than: vitest never type-checks, so a test file can be green and
       uncompilable at the same time. */
    const last = (c: string) => {
      let index = -1;
      kids.forEach((el, i) => {
        if (el.classList.contains(c)) index = i;
      });
      return index;
    };

    const markAt = first("spine-from");
    expect(markAt, "the mark must be in the track").toBeGreaterThanOrEqual(0);
    expect(last("spine-from"), "exactly one mark").toBe(markAt);
    for (const c of ["spine-part", "spine-tick", "spine-matches", "spine-hit", "spine-viewport"]) {
      expect(first(c), `the fixture should render a ${c}`).toBeGreaterThanOrEqual(0);
    }

    /* One stacking context of absolutely-positioned siblings with no z-index
       between them, so tree order *is* paint order. */
    expect(markAt, "over the parts it sits on").toBeGreaterThan(last("spine-part"));
    expect(markAt, "over the hairlines, or a 3px mark reads as one of them").toBeGreaterThan(
      last("spine-tick"),
    );
    /* The one that would only ever be noticed during a search: a mark over the
       lanes hides the hit in the paragraph the reader jumped from. */
    expect(markAt, "under the search marks").toBeLessThan(first("spine-matches"));
    expect(markAt, "under the hit targets, which are what the rail is for").toBeLessThan(
      first("spine-hit"),
    );
    expect(markAt, "under the viewport band").toBeLessThan(first("spine-viewport"));
  });

  it("is decorative — the chip beside it says the same thing in words", async () => {
    await mount();
    jumped(at(block(7)), block(18));

    /* The chip is a button with a sentence on it; this is that sentence made
       visible. Announcing it twice is worse than announcing it once, and the
       rail's other decorative layers all make the same call. */
    expect(mark()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hands its top to the stylesheet to clamp, rather than setting `top` itself", async () => {
    await mount();
    /* A jump from the **last** row, which is the case the clamp exists for: the
       3px floor grows the box downward from `top`, and a row starting at 95% of
       a long article grows straight out of `.spine { overflow: hidden }`. The
       reader who jumps from the end of a piece is exactly the one who cannot
       find their way back. `.spine-here` had this bug and GPT Sol found it,
       2026-09-06; the fix is `top: min(var(--from-top), 100% - 3px)` in
       styles.css and it holds only while the number is handed over raw.

       Writing that clamp inline is not merely uglier, it is untestable here:
       jsdom's CSSOM parses `calc(min(95%, 100% - 3px))` into
       `calc(min(9500% * , - 3px))`, and every assertion above would compare one
       mangled string with another and stay green through almost any change. */
    jumped(at(block(19)), block(2));
    expect(markTop(), "the number the stylesheet clamps").toBe("95%");
    expect(
      mark()?.style.top,
      "setting `top` here would put the floor back outside the rail",
    ).toBe("");
  });
});
