// @vitest-environment jsdom
/**
 * **The rail draws the section you are in, not only the part.**
 *
 * Greg, 2026-09-06, reading Nagel — one part holding 95% of the article and a
 * short References section beside it:
 *
 * > The Spine only really highlights in orange the current top-level section,
 * > so basically the Spine is almost completely orange when I'm reading the
 * > main section.
 *
 * `.spine-part.active` is honest and useless on that shape. The fix draws
 * `hereHit` — the current L2, which `Spine.tsx` has computed since 2026-08-28
 * and until now showed only to a screen reader. See
 * docs/plans/260906g-spine-concentric-depth-highlight.md.
 *
 * **What this file is for that a screenshot is not.** Three of the cases below
 * are ones where the ring must *not* be drawn, and all three look like a
 * working rail: a ring at exactly the part's geometry is not a visible bug, it
 * is a slightly darker band. The DOM-order case is the same kind of thing —
 * painting the ring over the search marks instead of under them is invisible
 * until you are searching, and then it silently hides the hits inside the
 * section the reader is actually in. jsdom cannot see paint, so the order of
 * the elements is asserted directly.
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
import type { OutlineEntry } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";
import type { BlockMatch } from "../src/web/search-hits.js";

const ROWS = 20;
const ROW_H = 100;
/** `READING_LINE` (0.35) of the 500px viewport the harness reports. */
const READING_OFFSET = 175;

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
  supplement = false,
): OutlineEntry {
  return {
    node: node(id, `b${startRow}`, `b${endRow}`),
    startRow,
    endRow,
    words: (endRow - startRow + 1) * 10,
    children,
    ...(supplement && { supplement: true }),
  };
}

/**
 * **The Nagel shape**: one part over 95% of the rows, and a short supplement.
 *
 * `main` is rows 0–18 (0%–95% of the rail) split into three sections —
 * m1 0–599px, m2 600–1299px, m3 1300–1899px — and `refs` is the last row alone,
 * a supplement, which `buildOutline` always gives `children: []`. So this one
 * fixture carries both the case the ring is for and one of the cases it must
 * skip.
 */
function nagel(): OutlineEntry[] {
  return [
    entry("main", 0, 18, [entry("m1", 0, 5), entry("m2", 6, 12), entry("m3", 13, 18)]),
    entry("refs", 19, 19, [], true),
  ];
}

/** A part with exactly one child, which by the partition invariant covers it. */
function singleChild(): OutlineEntry[] {
  return [entry("only", 0, 19, [entry("its-only-section", 0, 19)])];
}

/** A part with no children at all, and not a supplement. */
function childless(): OutlineEntry[] {
  return [entry("bare", 0, 19)];
}

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

  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < ROWS; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", `b${i}`);
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const block = this.getAttribute("data-block");
      if (!block) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
      const i = Number(block.slice(1));
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

async function mount(outline: OutlineEntry[], matches?: Map<BlockId, BlockMatch>): Promise<void> {
  await act(async () => {
    root.render(createElement(Spine, { outline, layoutKey: "x", onJump: () => {}, matches }));
  });
  await settle();
  expect(
    host.querySelector(".spine-viewport"),
    "the rail must have measured before anything is asserted",
  ).not.toBeNull();
}

/** Put the reading line at `pos` document pixels, then run the frame. */
async function readAt(pos: number): Promise<void> {
  await act(async () => {
    (window as unknown as { scrollY: number }).scrollY = pos - READING_OFFSET;
    window.dispatchEvent(new Event("scroll"));
  });
  await settle();
}

const rings = () => host.querySelectorAll<HTMLElement>(".spine-here");
const ring = () => host.querySelector<HTMLElement>(".spine-here");
/**
 * The ring's top, which it publishes as a custom property rather than setting
 * `top` — so that the stylesheet can clamp it inward and keep the 2px floor
 * inside the rail. The last test in this file pins that; Spine.tsx has why.
 */
const ringTop = () => ring()?.style.getPropertyValue("--here-top");

describe("the current section in the spine", () => {
  it("draws one ring, at the current section's geometry and not its part's", async () => {
    await mount(nagel());
    await readAt(800); // inside m2: 600–1299

    expect(rings(), "exactly one ring").toHaveLength(1);
    /* m2 is rows 6–12 of a 2000px document: 600px down, 700px tall. The part
       it sits in is 0%/95%, which is the whole point — a ring at those numbers
       would be the bug this file exists for. */
    expect(ringTop()).toBe("30%");
    expect(ring()?.style.height).toBe("35%");
  });

  it("moves to the next section when the reader crosses into it", async () => {
    await mount(nagel());
    await readAt(300); // m1
    expect(ringTop()).toBe("0%");

    await readAt(1500); // m3
    expect(ringTop()).toBe("65%");
    expect(ring()?.style.height).toBe("30%");
  });

  it("is the same band the button marks with aria-current", async () => {
    await mount(nagel());
    await readAt(800);

    const current = host.querySelector<HTMLElement>('.spine-hit[aria-current="location"]');
    expect(current, "a hit should be marked current").not.toBeNull();
    /* The two are computed from one `hereHitId`, and this is what keeps them
       one fact rather than two that agree today. */
    expect(ringTop()).toBe(current?.style.top);
    expect(ring()?.style.height).toBe(current?.style.height);
  });

  it("draws nothing when the reading line is outside the article", async () => {
    await mount(nagel());
    await readAt(-400); // above the first row, in the masthead

    /* `hereHit` deliberately has no fallback to the first or last band — a rail
       claiming *you are here* about a section the reader is not in is worse
       than one saying nothing. The ring inherits that rather than parking at
       one end. */
    expect(rings()).toHaveLength(0);
  });

  it("draws nothing in a supplement, whose part stands in for its own children", async () => {
    await mount(nagel());
    await readAt(1950); // the References row

    /* `buildOutline` gives a supplement `children: []` unconditionally, so
       `measure` makes it an L1 fallback and there is no L2 to ring. The dimmed
       active band is the whole of what the apparatus gets. */
    expect(rings()).toHaveLength(0);
  });

  it("draws nothing for a part with no children", async () => {
    await mount(childless());
    await readAt(800);

    expect(host.querySelector(".spine-hit"), "the part stands in as its own hit").not.toBeNull();
    expect(rings(), "a ring here would be a second fill at the part's geometry").toHaveLength(0);
  });

  it("draws nothing for a part with exactly one child", async () => {
    await mount(singleChild());
    await readAt(800);

    /* The child partitions its parent, so with one child it covers it exactly —
       permitted by tree-invariants.ts for a leaf, and present in the
       spine-card fixture. A ring there is a double-paint whose only effect is a
       darker band, which is not something anybody would report. */
    expect(rings()).toHaveLength(0);
  });

  it("paints under the search marks, not over them", async () => {
    const matches = new Map<BlockId, BlockMatch>([
      ["b7" as BlockId, { searches: [{ runId: "r1", slot: 0 }], count: 2 }],
    ]);
    await mount(nagel(), matches);
    await readAt(800);

    const kids = [...(host.querySelector(".spine-track")?.children ?? [])];
    /* **`classList.contains`, and never `className.split(" ")[0]`.** The first
       version of this read the leading class name, which is the kind of check
       that stops checking without ever going red: a part rendered as
       `class="active spine-part"` makes `indexOf("spine-part")` return `-1`,
       and `-1` is less than every real index — so "the ring comes after the
       parts" would pass on a rail where it came first. GPT Sol, 2026-09-06. */
    const first = (c: string) => kids.findIndex((el) => el.classList.contains(c));
    /* Written out rather than `findLastIndex`, which this project's `lib` is
       older than: it runs fine under vitest and fails `npm run typecheck`,
       because vitest never type-checks and so a test file can be green and
       uncompilable at the same time. */
    const last = (c: string) => {
      let at = -1;
      kids.forEach((el, i) => {
        if (el.classList.contains(c)) at = i;
      });
      return at;
    };

    const ringAt = first("spine-here");
    expect(ringAt, "the ring must be in the track").toBeGreaterThanOrEqual(0);
    expect(last("spine-here"), "exactly one ring").toBe(ringAt);

    /* The rail is one stacking context of absolutely-positioned siblings with
       no z-index between them, so tree order *is* paint order. The ring must
       come after *every* part — not merely the first, which is all an
       `indexOf` would have pinned — and before the first element of each layer
       that has to stay on top of it: the L2 hairline marking its own top edge,
       the search marks, the hit targets, and the viewport band. */
    for (const c of ["spine-part", "spine-tick", "spine-matches", "spine-hit", "spine-viewport"]) {
      expect(first(c), `the fixture should render a ${c}`).toBeGreaterThanOrEqual(0);
    }
    expect(ringAt, "after every part").toBeGreaterThan(last("spine-part"));
    expect(ringAt, "under the hairline that marks its own top edge").toBeLessThan(first("spine-tick"));
    /* The one that would have cost an afternoon: a fill over the search marks
       hides the hits inside the section the reader is actually reading. */
    expect(ringAt, "under the search marks").toBeLessThan(first("spine-matches"));
    expect(ringAt, "under the hit targets").toBeLessThan(first("spine-hit"));
    expect(ringAt, "under the viewport band").toBeLessThan(first("spine-viewport"));
  });

  it("is decorative — the accessible name is already on the button", async () => {
    await mount(nagel());
    await readAt(800);

    /* `aria-current="location"` on the hit already says exactly the fact the
       ring makes visible. A second announcement, or a live region firing on
       every section crossing during a scroll, would be actively worse. */
    expect(ring()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("hands its top to the stylesheet to clamp, rather than setting `top` itself", async () => {
    await mount(nagel());
    await readAt(800);

    /* **The guard on a bug that only appears on the last section of an
       article.** `min-height` grows the ring *downward* from its top, and the
       final L2 begins at very nearly 100%, so those two pixels grow out of
       `.spine { overflow: hidden }` and get clipped: the ring disappears
       exactly where the reader has finished reading. Two of the thirteen trees
       in `data/` end in a section worth 0.12% of the article, against the
       ~0.22% that 2px of a rail costs, so this is a shape the corpus has and
       not a hypothetical. The fix is `top: min(var(--here-top), 100% - 2px)`
       in styles.css, and it holds only while the component keeps handing the
       raw number over instead of setting `top` itself.

       Writing that clamp inline is not merely uglier, it is *untestable here*:
       jsdom's CSSOM parses `calc(min(30%, 100% - 2px))` into
       `calc(min(3000% * , - 2px))`, so every assertion above would be
       comparing one mangled string to another and would stay green through
       almost any change. GPT Sol found the clipping, 2026-09-06. */
    expect(ringTop(), "the number the stylesheet clamps").toBe("30%");
    expect(
      ring()?.style.top,
      "setting `top` here would put the floor back outside the rail",
    ).toBe("");
  });
});
