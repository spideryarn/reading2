// @vitest-environment jsdom
/**
 * Structure mode's list face — the half that needs a DOM: **which rung it chooses.**
 *
 * ## What this can and cannot prove
 *
 * jsdom does no layout. Every element's `scrollHeight` and `clientHeight` are
 * 0, so the assertion the plan originally promised — "the rendered list fits,
 * `scrollHeight <= clientHeight`" — would read `0 <= 0` here and pass on any
 * code whatsoever, including code that overflows every real browser. That is a
 * check that cannot fail, which docs/reusable/silent-success.md says is not a
 * check at all.
 *
 * So the two halves are split honestly:
 *
 *  - **Here:** the selection logic, with heights stubbed. Given candidates of
 *    known heights and a band of known height, does the panel take the largest
 *    rung that fits, fall back correctly when none fits, and settle rather than
 *    oscillate? That is real logic and it is fully testable.
 *  - **In a browser:** whether the *real* rendered list actually fits, which is
 *    a question about fonts, wrapping and the band's true width. See
 *    docs/project/browser-testing.md, and note the two traps recorded there
 *    that bite exactly this feature: a hidden tab runs no rAF and does not
 *    animate, and a stale parsed stylesheet gives correct CSS text with older
 *    computed styles.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutlinePanel } from "../src/web/OutlinePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import type { Block, NodeId, Tree, TreeNode } from "../src/types.js";

/* A tree big enough that the rungs differ in height: one part, four sections,
   the first with five paragraphs. */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-c${String(n).padStart(4, "0")}`;
  let b = 0;
  const sectionIds: NodeId[] = [];

  for (let s = 0; s < 4; s++) {
    const first = b;
    const leaves: NodeId[] = [];
    const paras = s === 0 ? 5 : 2;
    for (let p = 0; p < paras; p++) {
      blocks.push({
        id: id(b),
        tag: "p",
        kind: "text",
        text: `block ${b}`,
        words: 2,
        html: `<p>block ${b}</p>`,
        gistable: true,
      });
      const leaf = `n-l-${s}-${p}`;
      nodes[leaf] = {
        id: leaf,
        depth: 3,
        parent: `n-s-${s}`,
        children: [],
        range: [id(b), id(b)],
        title: "",
        navLabel: `paragraph ${p} of section ${s}`,
      };
      leaves.push(leaf);
      b++;
    }
    nodes[`n-s-${s}`] = {
      id: `n-s-${s}`,
      depth: 2,
      parent: "n-p",
      children: leaves,
      range: [id(first), id(b - 1)],
      title: `Section ${s}`,
      gist: `What section ${s} establishes.`,
    };
    sectionIds.push(`n-s-${s}`);
  }
  nodes["n-p"] = {
    id: "n-p",
    depth: 1,
    parent: "n-r",
    children: sectionIds,
    range: [id(0), id(b - 1)],
    title: "The only part",
    gist: "the part's gist",
  };
  nodes["n-r"] = {
    id: "n-r",
    depth: 0,
    parent: null,
    children: ["n-p"],
    range: [id(0), id(b - 1)],
    title: "Root",
    gist: "the root's gist",
  };
  return {
    tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes },
    blocks,
  };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const root = buildSummaryTree(tree, blocks, geometry.leafDepth);

/* Without this React does not flush state updates inside `act`, so a keydown
   dispatched below would change nothing and the focus assertions would pass or
   fail for the wrong reason. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Captured ONCE, at module load. Several tests call `render()` twice, and
   `vi.spyOn` on an already-spied `getComputedStyle` would otherwise capture the
   previous spy as its "real" one and recurse a level deeper each time. */
const REAL_COMPUTED = window.getComputedStyle.bind(window);

let host: HTMLDivElement;
let reactRoot: Root;
/** How many times `render`'s panel asked to jump. */
let jumps = 0;

/**
 * Stub the two numbers the fit reads.
 *
 * `clientHeight` is the band. Each measured candidate reports a height
 * proportional to how many rows it drew, which is the honest stand-in for
 * layout: more rows, taller. The panel should then take the tallest candidate
 * that still fits.
 */
function stubHeights(
  bandHeight: number,
  pxPerRow = 10,
  padding = 0,
  bandRight = 300,
  wholeTitleExtraPerRow = 0,
  headHeight = 0,
) {
  /* jsdom applies no stylesheet, so the panel's real `0.75rem` padding is not
     here to be read. Without stubbing it, a mutation deleting the padding
     subtraction from the fit is a no-op and the test stays green — which it
     did, before this existed. */
  vi.spyOn(window, "getComputedStyle").mockImplementation(((el: Element) => {
    const base = REAL_COMPUTED(el as HTMLElement);
    if ((el as HTMLElement).classList?.contains("outln")) {
      return { ...base, paddingTop: `${padding}px`, paddingBottom: "0px" } as CSSStyleDeclaration;
    }
    return base;
  }) as typeof window.getComputedStyle);
  /* The band's RIGHT EDGE is what the cover check reads, so that is what is
     stubbed. Numbers below come from a real browser measurement at the
     breakpoint (2026-08-28): beside → [12, 300] in an 844px window; covering →
     [12, 843] in an 843px window. */
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    /* **The visible list starts below the padding**, which is where the fit
       has measured its room from since 2026-10-01 (OutlinePanel.tsx §
       `measure`): whatever sits above the list — the padding, and now the
       Fisheye / Expanded toggle — is room it cannot use. */
    const visibleList = this.tagName === "OL" && !this.dataset.rung;
    return (
      this.classList.contains("outln")
        ? { left: 12, right: bandRight, width: bandRight - 12, top: 0, bottom: 0, height: 0 }
        : {
            left: 0,
            right: 0,
            width: 0,
            top: visibleList ? padding + headHeight : 0,
            bottom: 0,
            height: 0,
          }
    ) as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("outln") ? bandHeight : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    /* Only the candidate lists in the measuring box are asked.
       **The gist and arc lines are counted, not just the rows.** Counting
       `li` alone made rungs 2, 3 and 4 report identical heights — they draw
       the same rows and differ only by a sentence attached to one of them — so
       the chooser could never tell them apart and a mutation swapping them
       would have stayed green. GPT Sol, 2026-08-28. */
    if (this.tagName === "OL" && this.dataset.rung) {
      const rows = this.querySelectorAll("li").length;
      const sentences = this.querySelectorAll(".outln-gist, .outln-arc").length;
      const wholeTitleCost = this.classList.contains("clamp")
        ? 0
        : rows * wholeTitleExtraPerRow;
      return (rows + sentences * 2) * pxPerRow + wholeTitleCost;
    }
    return 0;
  });
}

function render(
  bandHeight: number,
  focusRow = 0,
  proseBeside = true,
  padding = 0,
  bandRight = 300,
  /* The labels are there unless a case says otherwise, which is what every
     revision says today — src/web/nav-labels.ts. */
  paragraphLabels = true,
  /* Test-only stand-in for titles wrapping onto extra lines. Zero preserves the
     original height model; a positive value makes the whole and clamped copies
     observably different. */
  wholeTitleExtraPerRow = 0,
  /* The real toggle is outside this fixture. This is the distance it puts
     between the band's top and the visible list's top. */
  headHeight = 0,
) {
  stubHeights(bandHeight, 10, padding, bandRight, wholeTitleExtraPerRow, headHeight);
  act(() => {
    reactRoot.render(
      <OutlinePanel
        root={root}
        supplementOf={geometry.supplementOf}
        arcByRow={null}
        focusRow={focusRow}
        proseBeside={proseBeside}
        paragraphLabels={paragraphLabels}
        onJump={() => {
          jumps += 1;
        }}
        head={headHeight > 0 ? <div>Fisheye / Expanded</div> : null}
      />,
    );
  });
  return host.querySelector<HTMLElement>(".mode-band.outln")!;
}

beforeEach(() => {
  jumps = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
  /* jsdom has no ResizeObserver. The panel installs two; a no-op stands in,
     because the effect's first `measure()` call is synchronous and is what
     these tests exercise. */
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("choosing a rung", () => {
  it("takes the tallest rung that fits", () => {
    /* Rung 1 draws 1 row here (one part). Each later rung draws more. With
       plenty of room it should reach the top of the ladder. */
    const panel = render(10_000);
    expect(panel.dataset.outlineRung).toBe("5");
    expect(panel.querySelectorAll(".outln-list:not([data-rung]) .outln-row").length)
      .toBeGreaterThan(1);
  });

  it("falls back to rung 1 when only the parts fit", () => {
    /* 10px a row, and rung 1 is the one-row list. */
    const panel = render(15);
    expect(panel.dataset.outlineRung).toBe("1");
  });

  it("steps down rather than overflowing as the band shrinks", () => {
    const tall = render(10_000).dataset.outlineRung;
    act(() => reactRoot.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    reactRoot = createRoot(host);
    const short = render(60).dataset.outlineRung;
    expect(Number(short)).toBeLessThan(Number(tall));
  });

  it("never shows fewer rows in a taller band — monotonic in height", () => {
    /* The same class as the non-monotonic column fit found by sweeping widths;
       a taller window must never take context away. */
    let last = 0;
    for (const h of [15, 40, 80, 200, 10_000]) {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
      const panel = render(h);
      const n = panel.querySelectorAll(".outln-list:not([data-rung]) .outln-row").length;
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
    }
  });

  it("prefers the best whole-title rung even when a more detailed clamped rung fits", () => {
    /* Whole rung 1 is 40px; whole rung 2 is 200px. At 60px the clamped rung 2
       would fit, but whole titles are the product decision and therefore win
       before the clamped candidates are considered. Codex code review,
       2026-09-10. */
    const panel = render(60, 0, true, 0, 300, true, 30);
    const visible = panel.querySelector<HTMLOListElement>(
      ".outln-list:not([data-rung])",
    )!;
    const measured = panel.querySelector<HTMLOListElement>(
      '.outln-list[data-rung="1"][data-clamp="0"]',
    )!;
    expect(panel.dataset.outlineRung).toBe("1");
    expect(panel.dataset.outlineClamp).toBe("0");
    expect(visible.className).toBe(measured.className);
    expect(visible.classList.contains("clamp")).toBe(false);
  });

  it("uses the clamped copy as the floor when no whole-title rung fits", () => {
    /* Whole rung 1 is 40px and does not fit; clamped rung 1 is 10px and does.
       The diagnostic and visible class must both describe that same choice. */
    const panel = render(30, 0, true, 0, 300, true, 30);
    const visible = panel.querySelector<HTMLOListElement>(
      ".outln-list:not([data-rung])",
    )!;
    const measured = panel.querySelector<HTMLOListElement>(
      '.outln-list[data-rung="1"][data-clamp="1"]',
    )!;
    expect(panel.dataset.outlineRung).toBe("1");
    expect(panel.dataset.outlineClamp).toBe("1");
    expect(visible.className).toBe(measured.className);
    expect(visible.classList.contains("clamp")).toBe(true);
  });
});

describe("what the list says", () => {
  it("draws every part exactly once, at every band height", () => {
    for (const h of [15, 80, 10_000]) {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
      const panel = render(h);
      const parts = panel.querySelectorAll(
        ".outln-list:not([data-rung]) .outln-row.lvl-1",
      );
      expect(parts).toHaveLength(1);
    }
  });

  it("marks exactly one row as the reader's location", () => {
    const panel = render(10_000, 1);
    const now = panel.querySelectorAll(
      '.outln-list:not([data-rung]) [aria-current="location"]',
    );
    expect(now).toHaveLength(1);
  });

  it("is one tab stop, not one per row", () => {
    const panel = render(10_000);
    const list = panel.querySelector('.outln-list:not([data-rung])')!;
    expect(list.getAttribute("tabindex")).toBe("0");
    expect(panel.querySelectorAll('.outln-row[tabindex]')).toHaveLength(0);
    expect(list.getAttribute("role")).toBe("tree");
  });

  it("leaves ↑ / ↓ to the article, and lets go of a held row when they are pressed", () => {
    /**
     * Greg, spya-b2wzjf: "up and down should always do the same thing, i.e.
     * jump to the next block in the text". Until 2026-10-01 they stepped this
     * list's rows — a part or a section a press — and `preventDefault`ed, so
     * the window's handler (keynav.ts), which steps one block, stood down.
     *
     * Two halves. The key is not handled here (not prevented, nothing jumped).
     * And a row held by Home lets go, so the mark follows the reader again as
     * the article moves; otherwise Home's row would keep it for ever.
     * Before 2026-10-01 two tests here pinned ↑ / ↓'s own focus rules (a
     * paragraph row reached by arrowing, kept and then forgotten); nothing can
     * put focus on a paragraph row now, so they went with the behaviour.
     */
    const jumps: string[] = [];
    const draw = (focusRow: number) =>
      act(() => {
        reactRoot.render(
          <OutlinePanel
            root={root}
            supplementOf={geometry.supplementOf}
            arcByRow={null}
            focusRow={focusRow}
            proseBeside
            paragraphLabels
            onJump={(id) => jumps.push(id)}
          />,
        );
      });
    const panel = render(10_000, 0);
    const list = panel.querySelector<HTMLElement>('.outln-list:not([data-rung])')!;
    const press = (key: string) => {
      const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      act(() => {
        list.dispatchEvent(e);
      });
      return e;
    };
    const nowId = () => panel.querySelector('.outln-list:not([data-rung]) .outln-row.now')?.id;

    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
      expect(press(key).defaultPrevented, key).toBe(false);
    }
    expect(jumps).toEqual([]);

    /* Home holds the first row, and it stays held while the article moves. */
    expect(press("Home").defaultPrevented).toBe(true);
    const first = list.getAttribute("aria-activedescendant");
    const lastRow = (geometry.cells[1] ?? []).reduce((n, c) => n + c.rowSpan, 0) - 1;
    draw(lastRow);
    expect(list.getAttribute("aria-activedescendant")).toBe(first);
    expect(nowId(), "fixture: the reader must be somewhere other than the held row").not.toBe(first);

    /* ↓ lets go: the mark is the reader's row again. */
    press("ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe(nowId());
  });


  it("does not count the panel's padding as room the list can use", () => {
    /* `clientHeight` includes padding; the list starts below it. Granting the
       list that padding picks a rung that is then clipped at the foot, which
       is the one thing this mode promises never happens. */
    const fresh = () => {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
    };
    const noPadding = render(60, 0, true, 0).dataset.outlineRung;
    fresh();
    const withPadding = render(60, 0, true, 40).dataset.outlineRung;
    expect(Number(withPadding)).toBeLessThan(Number(noPadding));
  });

  it("does not count the head row as room the list can use", () => {
    /* The old padding subtraction happens to remain correct when there is no
       head. Give the list a second, independent inset so reverting the
       list-top measurement makes this fail rather than re-testing padding. */
    const fresh = () => {
      act(() => reactRoot.unmount());
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      reactRoot = createRoot(host);
    };
    const noHead = render(60).dataset.outlineRung;
    fresh();
    const withHead = render(60, 0, true, 0, 300, true, 0, 40).dataset.outlineRung;
    expect(Number(withHead)).toBeLessThan(Number(noHead));
  });

  it("reports the rung it actually drew, not the highest number that ties", () => {
    /* With paragraphs not permitted, candidate 5 is identical to candidate 4.
       Taking the highest fitting number would print `5` for a list with no
       paragraphs in it, and `data-outline-rung` exists to be read as evidence
       in a browser. */
    const panel = render(10_000, 0, false);
    expect(panel.querySelectorAll(".outln-list:not([data-rung]) .lvl-3")).toHaveLength(0);
    /* **3, not 5 and not 4.** This fixture has no arc entries (`arcByRow` is
       null, as it is for any article that has not had `npm run arc` run), so
       rung 4 adds nothing either — candidates 3, 4 and 5 are the same list.
       The honest report of how far down the ladder the panel got is the lowest
       rung that produces it. My first version of this test expected 4 and was
       wrong for exactly the reason the tie-break exists. */
    expect(panel.dataset.outlineRung).toBe("3");
  });

  it("drops paragraph rows when the band covers the viewport, whatever the prop says", () => {
    /* `proseBeside` is derived from `fit.modeW > 0`, which was exact only while
       the spine was on: the stylesheet's full-screen rule was a literal
       `max-width: 843px` while fitMode subtracts the rail's width, so with
       `?spine=0` the two disagreed from 832px to 843px. In that window the prop
       said "beside" and the article was in fact hidden underneath. GPT Sol,
       2026-08-28; fixed at the source on 2026-09-03, when the stylesheet
       stopped deriving the crossover and read `.band-covers` from App.tsx
       instead.

       The panel still measures the rendered band rather than trusting the prop,
       and this test still holds that: it hands the prop a lie and expects the
       measurement to win, which is what makes the behaviour independent of
       whatever the covering rule is keyed on next. */
    /* The real geometry at the breakpoint: at 843px the band's rect is
       [12, 843] in an 843px window — it covers the article completely. Note
       its WIDTH is only 831, which is why a width-based check silently never
       fired and this test asserts against the right edge. */
    window.innerWidth = 843;
    const covering = render(10_000, 0, /* proseBeside, lying */ true, 0, /* right */ 843);
    expect(covering.querySelectorAll(".outln-list:not([data-rung]) .lvl-3")).toHaveLength(0);

    act(() => reactRoot.unmount());
    host.remove();
    host = document.createElement("div");
    document.body.appendChild(host);
    reactRoot = createRoot(host);

    /* And one pixel wider the band sits beside the prose — [12, 300] in an
       844px window — where paragraph rows are permissible again. */
    window.innerWidth = 844;
    const beside = render(10_000, 0, true, 0, /* right */ 300);
    expect(
      beside.querySelectorAll(".outln-list:not([data-rung]) .lvl-3").length,
    ).toBeGreaterThan(0);
  });

  it("hides the measured candidates from assistive tech", () => {
    const panel = render(10_000);
    expect(panel.querySelector(".outln-measure")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Expanded follow-along", () => {
  /** Give jsdom just enough layout to distinguish an on-screen row from one
   * below the list. Row positions move with `scrollTop`, as they do in a real
   * scroll container. */
  function layout(listHeight: () => number) {
    /* jsdom exposes `CSS` without the browser's `CSS.escape`. Node ids in this
       fixture need no escaping; the stub lets the production lookup run. */
    vi.stubGlobal("CSS", { ...globalThis.CSS, escape: (value: string) => value });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("outln-list") ? listHeight() : 300;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("outln-row") ? 30 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains("outln-list")) {
        return { top: 0, bottom: listHeight(), height: listHeight() } as DOMRect;
      }
      if (this.classList.contains("outln-row")) {
        const list = this.closest<HTMLElement>(".outln-list")!;
        const rows = Array.from(list.querySelectorAll(".outln-row"));
        const top = rows.indexOf(this) * 50 - list.scrollTop;
        return { top, bottom: top + 30, height: 30 } as DOMRect;
      }
      return { top: 0, bottom: 0, height: 0 } as DOMRect;
    });
  }

  const draw = (focusRow: number) => {
    act(() => {
      reactRoot.render(
        <OutlinePanel
          root={root}
          supplementOf={geometry.supplementOf}
          arcByRow={null}
          focusRow={focusRow}
          proseBeside
          paragraphLabels
          onJump={() => {}}
          expanded
          head={<div>Fisheye / Expanded</div>}
        />,
      );
    });
    return host.querySelector<HTMLOListElement>(".outln-list")!;
  };

  it("moves only its own list when `now` changes, and leaves a manual position alone otherwise", () => {
    layout(() => 100);
    const list = draw(0);
    expect(list.scrollTop).toBe(0);

    /* Section 2 starts at row 7 in this fixture and is below the viewport. */
    draw(7);
    expect(list.scrollTop).toBeGreaterThan(0);

    /* A re-render inside the same section is not another follow request. */
    list.scrollTop = 9;
    draw(7);
    expect(list.scrollTop).toBe(9);

    /* Crossing the next section boundary follows again. */
    draw(9);
    expect(list.scrollTop).toBeGreaterThan(9);
  });

  it("re-syncs when a hidden list becomes visible again", () => {
    let height = 0;
    const observers: ResizeObserverCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: ResizeObserverCallback) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    layout(() => height);
    const list = draw(7);
    expect(list.scrollTop).toBe(0);
    expect(observers.length).toBeGreaterThanOrEqual(2);

    height = 100;
    /* The fit observer is first; follow-along's list observer is the last one
       installed by the component. */
    observers.at(-1)!([], {} as ResizeObserver);
    expect(list.scrollTop).toBeGreaterThan(0);
  });
});

/**
 * **A finger's first tap on a row opens its card; the second goes there** —
 * docs/project/touch.md, for the list face as for the two-column one (Greg,
 * spya-a868zs; plan 261003c). The click says `mouse` on iOS 18.2 and later
 * (WebKit bug 282988), so only the `pointerdown` says it was a finger. The
 * touch hover/lift and compatibility mouse events are included because those
 * are the events that have closed touch-opened cards before their click.
 */
describe("a tap on a row", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fire(el: Element, type: string, pointerType: string, detail = 1) {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: type !== "pointerleave",
        cancelable: true,
        detail,
        pointerType,
        pointerId: 1,
      }),
    );
  }
  function tap(el: Element, down: "touch" | "mouse") {
    act(() => {
      if (down === "touch") {
        fire(el, "pointerover", "touch");
        fire(el, "pointerdown", "touch");
        fire(el, "pointerup", "touch");
        fire(el, "pointerout", "touch");
        fire(el, "pointerleave", "touch");
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseenter"));
        el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      } else {
        fire(el, "pointerdown", "mouse");
        fire(el, "pointerup", "mouse");
      }
      fire(el, "click", "mouse");
    });
    act(() => {
      /* Let the group's delayed hover open/close and the exit transition land;
         an immediate assertion would miss a card that closes itself just after
         the click. */
      vi.advanceTimersByTime(1_000);
    });
  }
  const firstRow = (panel: HTMLElement) =>
    panel.querySelector<HTMLElement>(".outln-list:not([data-rung]) .outln-row")!;
  const card = () => document.querySelector('[role="tooltip"]');

  it("on a finger, the first tap opens the card and the second goes there", () => {
    const row = firstRow(render(10_000));
    tap(row, "touch");
    expect(jumps, "the first tap reads the row").toBe(0);
    expect(card()?.textContent).toContain("Tap again to go here");
    tap(row, "touch");
    expect(jumps).toBe(1);
  });

  it("a mouse click goes there at once", () => {
    tap(firstRow(render(10_000)), "mouse");
    expect(jumps).toBe(1);
    expect(card()?.textContent ?? "").not.toContain("Tap again");
  });
});
