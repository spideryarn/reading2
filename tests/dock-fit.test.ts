// @vitest-environment jsdom
/**
 * **The bottom bar picks its own rung, and `scrollWidth` is a liar if you ask
 * it the wrong question.**
 *
 * `src/web/dock-fit.ts` replaced a pixel breakpoint — `@media (max-width:
 * 1100px)`, measured when there were six modes — with a measurement, because at
 * thirteen modes the spelled-out row wants 1416px and every window between
 * 1101 and 1416 was drawing its last buttons off the right-hand edge of the
 * screen where they could not be pressed. Greg found it at two thirds of a
 * laptop screen, 2026-09-02.
 *
 * jsdom has no layout engine, so what is faked here is the one thing the
 * browser is being asked and **the exact way it answers**:
 *
 *     scrollWidth === max(clientWidth, what the content needs)
 *
 * That clamp is the whole reason this file exists. It means a row with room to
 * spare and a row that fits exactly are indistinguishable — both report
 * `scrollWidth === clientWidth` — so the only sound test is the strict
 * `scrollWidth > clientWidth`, and **any slack term makes the comparison
 * always true**. A `scrollWidth <= clientWidth - 8` was written first and would
 * have stripped every label off every bar at every width; `fits with room to
 * spare` below is the assertion that catches it.
 *
 * The needs are the real ones, measured in Chrome against the dev server at
 * thirteen modes and sixteen buttons (see dock-fit.ts § the rungs). They are
 * illustrative rather than pinned — a new mode moves all three, which is the
 * point of the change these tests cover. Nothing here compares a rendered bar
 * against them; they are the shape of the problem, not a fixture.
 *
 * **The bar for a signed-in reader is one button wider than they describe**
 * since the experimental switch joined it on 2026-09-03, and the ladder was
 * re-measured in Chrome rather than the numbers scaled: rung 0 spells out all
 * seventeen labels down to 1550px and gives way by 1500; rung 1 holds to 1100;
 * rung 2 covers 900 and 700 with no overflow; and at 500px the bar scrolls,
 * which is the floor doing its job rather than a failure. So the first number
 * above is now roughly a hundred pixels light, and a reader on a 1440px laptop
 * sits one rung lower than they used to.
 *
 * ## What this file cannot see, and what stands in for it
 *
 * jsdom is not a browser, so `chooseDockFit` can be tested and the CSS it
 * depends on cannot. GPT Sol, reviewing the built code, listed what would stay
 * green here while the bar was broken on screen: the root losing the ref, a rung
 * losing one of the bar's two DOM shapes, the `.always` exception losing a
 * specificity contest, the scroll floor going back inside a media query. Every
 * one of those had actually happened at some point during the change.
 *
 * The last two describes go after them — reading `styles.css` and rendering
 * `Dock` — for the reason `tests/spine-width.test.ts` gives at length: a check
 * standing where the compiler cannot is worth having even when it is cruder than
 * the real thing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock, visibleModes } from "../src/web/Dock.js";
import { MODES } from "../src/modes.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";
import { chooseDockFit, DOCK_FIT_CLASSES } from "../src/web/dock-fit.js";

/** What the row needs at each rung, in px. Rung 0 spells every label out. */
const NEED = [1425, 814, 557];

/**
 * A `.dock` whose width you set and whose overflow follows the rung it is
 * wearing — answering exactly as a browser does, clamp included.
 */
function fakeDock(need = NEED): { el: HTMLElement; setWidth(px: number): void } {
  const el = document.createElement("div");
  el.className = "dock";
  let width = 0;
  Object.defineProperty(el, "clientWidth", { get: () => width });
  Object.defineProperty(el, "scrollWidth", {
    /* The clamp. A browser never reports a scroll width below the client
       width, however much room is going spare. */
    get: () => Math.max(width, need[wearing(el)] ?? 0),
  });
  return {
    el,
    setWidth(px) {
      width = px;
    },
  };
}

/** The rung a `.dock` is wearing, read back off its class list.
 *
 * Backwards, because rung 0 is the *absence* of a class: a forward scan of
 * `DOCK_FIT_CLASSES` would match its empty first entry every time. */
function wearing(el: HTMLElement): number {
  for (let i = DOCK_FIT_CLASSES.length - 1; i > 0; i--) {
    const c = DOCK_FIT_CLASSES[i];
    if (c && el.classList.contains(c)) return i;
  }
  return 0;
}

describe("the bar chooses the widest rung that fits", () => {
  let dock: ReturnType<typeof fakeDock>;
  beforeEach(() => {
    dock = fakeDock();
  });

  it("spells everything out when there is room", () => {
    dock.setWidth(1600);
    expect(chooseDockFit(dock.el, 0)).toBe(0);
    expect(wearing(dock.el)).toBe(0);
  });

  /**
   * The bug, at the width Greg was actually sitting at. The old rule kept every
   * label down to 1100px, so this window drew a labelled row 264px wider than
   * the screen.
   */
  it("drops the mode labels at two thirds of a laptop screen", () => {
    dock.setWidth(1152);
    expect(chooseDockFit(dock.el, 0)).toBe(1);
    expect(wearing(dock.el)).toBe(1);
  });

  it("drops every label once even the glyphs do not fit", () => {
    dock.setWidth(700);
    expect(chooseDockFit(dock.el, 0)).toBe(2);
    expect(wearing(dock.el)).toBe(2);
  });

  it("stops at the last rung and lets the row overflow — the scroll is the floor", () => {
    dock.setWidth(390);
    expect(chooseDockFit(dock.el, 0)).toBe(DOCK_FIT_CLASSES.length - 1);
  });

  /**
   * **No slack term.** With the clamp, a row that fits with room to spare and a
   * row that fits exactly both report `scrollWidth === clientWidth` — so any
   * `- slack` in the comparison is true at every width and compacts everything.
   * This is also the real behaviour of a coarse-pointer bar, where the buttons
   * `flex-grow` to fill whatever room is going (styles.css § a coarse pointer).
   */
  it("fits with room to spare: a bar whose buttons grow to fill it keeps its labels", () => {
    const grown = fakeDock([0, 0, 0]); // content always fills exactly
    grown.setWidth(1024);
    expect(chooseDockFit(grown.el, 0)).toBe(0);
  });

  /**
   * The rung is decided every time from rung 0 down, so it never depends on the
   * rung it was already wearing. Without that the bar could stick compact after
   * a window was widened again.
   */
  it("goes back up when the window does", () => {
    dock.setWidth(700);
    expect(chooseDockFit(dock.el, 0)).toBe(2);
    dock.setWidth(1600);
    expect(chooseDockFit(dock.el, 2)).toBe(0);
    expect(wearing(dock.el)).toBe(0);
  });

  /**
   * A bar with no layout — detached, `display: none`, or every jsdom test in
   * this repo that renders `Dock`. Measuring a zero-width box would answer
   * "nothing fits" and strip the labels off a bar nobody is looking at.
   */
  it("leaves an unlaid-out bar alone", () => {
    dock.setWidth(0);
    expect(chooseDockFit(dock.el, 1)).toBe(1);
    expect(dock.el.className).toBe("dock");
  });
});


const CSS = readFileSync(path.join(import.meta.dirname, "../src/web/styles.css"), "utf8");

/** Selectors in a stylesheet that set `display: none` on a bar label. */
function labelHiders(css: string): string[] {
  const out: string[] = [];
  /* Rule by rule: a selector list, then a block. Good enough for a stylesheet
     we own and that has no `@supports` around these rules. */
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1] ?? "";
    if (!/display:\s*none/.test(m[2] ?? "")) continue;
    for (const sel of selectors.split(",")) {
      const one = sel.trim();
      if (one.includes("dock-btn-label")) out.push(one);
    }
  }
  return out;
}

/** Selectors that put a `keepLabel` label back. */
function labelShowers(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1] ?? "";
    if (!/display:\s*(inline|flex|inline-flex|block)/.test(m[2] ?? "")) continue;
    for (const sel of selectors.split(",")) {
      const one = sel.trim();
      if (one.includes("dock-btn-label") && one.includes(".always")) out.push(one);
    }
  }
  return out;
}

/** Class-count specificity, which is all these selectors use. */
function classes(sel: string): number {
  return (sel.match(/\.[a-z0-9-]+/gi) ?? []).length;
}

/** Label-hiding selectors that beat the `.always` exception on their own rung. */
function outSpecified(css: string): string[] {
  const always = labelShowers(css);
  return labelHiders(css).filter((hider) => {
    const rung = /dock-fit-\d/.exec(hider)?.[0];
    if (!rung) return false;
    const best = Math.max(...always.filter((a) => a.includes(rung)).map(classes), 0);
    return best < classes(hider);
  });
}

/** Is `.dock`'s `overflow-x: auto` at the top level, or inside a query? */
function floorIsUnconditional(css: string): boolean {
  const floor = /\.dock \{[^}]*overflow-x:\s*auto/.exec(css);
  if (!floor) return false;
  const before = css.slice(0, floor.index);
  /* Media queries in this file are the only thing that indents a rule, so a
     closing brace in column 0 is a query closing. */
  return (before.match(/^\}/gm) ?? []).length >= (before.match(/@media/g) ?? []).length;
}

describe("the stylesheet backs the ladder", () => {
  /**
   * A rung with no rule is a rung that measures as fitting and changes nothing,
   * so the ladder walks straight past it to the next one.
   */
  it("gives every rung at least one rule", () => {
    for (const cls of DOCK_FIT_CLASSES) {
      if (!cls) continue;
      expect(CSS, `no rule for ${cls}`).toContain(`.dock.${cls} `);
    }
  });

  /**
   * The bar has two shapes — one `.dock-modes` segment on the reading view,
   * thirteen loose `.dock-mode` links on the metadata and tweets pages. Rung 1
   * knew only the first until GPT Sol found it, so on those pages it did nothing
   * and the ladder went straight to rung 2, taking every label with it.
   */
  it("rung 1 knows both of the bar's shapes", () => {
    const hiders = labelHiders(CSS).filter((x) => x.includes("dock-fit-1"));
    expect(hiders.some((x) => x.includes(".dock-modes"))).toBe(true);
    expect(hiders.some((x) => x.includes(".dock-mode "))).toBe(true);
  });

  /**
   * **The bug a browser found and the unit tests above could not.**
   * `.dock.dock-fit-1 .dock-btn.dock-mode .dock-btn-label` is five classes; the
   * `.always` exception is four, and lost — so Plain, the way *out* of a mode,
   * gave up its word on the metadata page at rung 1 while keeping it at rung 2.
   * Ties are fine, because the exception is declared last; being out-specified
   * is not.
   */
  it("the keepLabel exception is never out-specified", () => {
    expect(outSpecified(CSS)).toEqual([]);
  });

  /**
   * **The mode you are in keeps its word at rung 1, and the reason is that
   * something else stopped saying it.**
   *
   * Greg, 2026-09-05: *"I think we can rely on the bottom bar to tell us what
   * mode we're in, so for example 'Summary' mode doesn't need to say `Summary`
   * at the top."* Stage 5 of
   * docs/plans/260905d-declutter-the-reading-view-top-bars.md removed the name
   * from every band's title row on the strength of that — and the premise was
   * false at exactly the widths where it mattered, because **a band is 400px of
   * the window and so opening one is itself what puts the bar on rung 1**,
   * where every mode label but Plain's is hidden. Summary at 1440×900 then had
   * no "Summary" anywhere: a highlighted glyph, and a tooltip for anyone who
   * thought to hover.
   *
   * Nothing above could see it. The ladder is correct, the rungs are correct,
   * the bar fits — and the reader cannot tell which of thirteen modes is open.
   * It was found by looking at a screenshot, so what this test pins is the
   * *rule's existence*, which is the part that can silently go.
   *
   * **Rung 1 only, deliberately, and rung 2 was measured before being dropped**:
   * at 390×844 in a band mode the bar already overflows (`scrollWidth` 617
   * against 390) and the word took it to 758 — 141px more of a row the reader
   * must drag sideways, to reveal a word only legible once dragged. A bar that
   * scrolls cannot tell you anything you have not scrolled to. If that rule
   * ever appears for rung 2, this test should be the thing that asks why.
   */
  it("the open mode keeps its label at rung 1, and only there", () => {
    /* **Comments stripped first**, which is not tidiness. `CSS` here is the raw
       file, and this stylesheet quotes its own selectors in prose constantly —
       the rule below has a twenty-line comment above it naming both
       `dock-fit-1` and `dock-fit-2`. Splitting the raw text on braces leaves
       that comment glued to the front of the selector it introduces, so the
       negative assertion would read the *comment's* mention of rung 2 and fail
       against correct CSS. Checked both ways before writing it down.
       `tests/aimed-column.test.ts` strips for the same reason. */
    const shows = CSS.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((block) => block.split("{")[0] ?? "")
      .filter((sel) => sel.includes(".dock-btn.on") && sel.includes(".dock-btn-label"));
    expect(shows.length, "no rule keeps the active mode's label").toBeGreaterThan(0);
    expect(shows.some((sel) => sel.includes("dock-fit-1"))).toBe(true);
    expect(
      shows.some((sel) => sel.includes("dock-fit-2")),
      "rung 2 was measured and rejected — see this test's comment",
    ).toBe(false);
  });

  /**
   * The floor. It lived inside `@media (max-width: 731px)` until 2026-09-02,
   * which left the ladder's last rung free to overflow at any wider width with
   * nothing underneath it — the same silent clip the ladder exists to end.
   */
  it("the bar scrolls at every width, not inside a media query", () => {
    expect(floorIsUnconditional(CSS)).toBe(true);
  });

  /**
   * **And every one of those goes red on the thing it is about.** Each of the
   * three above passed the moment it was written, which is the state
   * docs/reusable/silent-success.md warns about: a check that has never failed
   * may be counting nothing at all. So each is fed the broken stylesheet it
   * exists to catch — two of which this change actually shipped for a while.
   */
  it("...and each check fails on the stylesheet it is about", () => {
    expect(
      outSpecified(`
        .dock.dock-fit-1 .dock-btn.dock-mode .dock-btn-label { display: none; }
        .dock.dock-fit-1 .dock-btn-label.always { display: inline; }
      `),
    ).toHaveLength(1);

    const segmentOnly = ".dock.dock-fit-1 .dock-modes .dock-btn-label { display: none; }";
    expect(labelHiders(segmentOnly).some((x) => x.includes(".dock-mode "))).toBe(false);

    expect(floorIsUnconditional("@media (max-width: 731px) {\n  .dock { overflow-x: auto; }\n}")).toBe(
      false,
    );
  });
});

/**
 * The wiring, in both of the bar's shapes. jsdom has no layout, so the rung is
 * always 0 here — what is checked is that the ladder has something to act on:
 * the root the hook measures, the class that tells rung 1 which buttons are
 * modes, the tail it measures against, and Plain's word.
 */
describe("Dock gives the ladder something to work with", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  /**
   * **`experimental` is passed, and the cast is why that matters.** `Dock as any`
   * means the compiler is not asking for props here, so a bar that read
   * `experimental?.on` would silently draw every mode rather than throwing —
   * which is exactly the mistake the required prop exists to make loud. It reads
   * `experimental.on`, so a call that forgot this line fails here with a
   * `TypeError` instead of passing while showing unfinished modes to strangers.
   * tests/dock-experimental-modes.test.tsx holds that directly.
   */
  function render(props: Record<string, unknown>): void {
    act(() =>
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: the shapes differ by which props are present, which is the thing under test
        createElement(Dock as any, {
          slug: "x",
          view: "article",
          experimental: EXPERIMENTAL_OFF,
          ...props,
        }),
      ),
    );
  }

  it("the reading view: one segment, and Plain keeps its word", () => {
    render({ mode: "plain", onMode: () => {} });
    expect(host.querySelector(".dock")).not.toBeNull();
    expect(host.querySelector(".dock-modes")).not.toBeNull();
    expect(host.querySelector(".dock-tail")).not.toBeNull();
    expect(host.querySelector(".dock-btn-label.always")?.textContent).toBe("Plain");
  });

  /**
   * Off the reading view the modes are loose links. Both of these were missing
   * until GPT Sol's review: without `dock-mode` rung 1 does nothing here, and
   * without the `always` label Plain lost its word on the page you are most
   * likely to be looking for the way back from.
   *
   * **The count is the visible set, not "more than ten".** Five modes went
   * behind the experimental switch on 2026-09-03, so a default reader's bar has
   * eight loose links and the old `> 10` was a statement about a bar nobody
   * sees. Asserted against `visibleModes` rather than against `8`, so the
   * number moves with the rule instead of pinning today's count — the point
   * here is that the ladder has links to act on, and that count is not this
   * file's subject. tests/dock-experimental-modes.test.tsx owns the eight.
   */
  it("the metadata page: loose links that say they are modes", () => {
    render({ view: "metadata" });
    expect(host.querySelector(".dock-modes")).toBeNull();
    expect(host.querySelectorAll(".dock-mode")).toHaveLength(
      visibleModes(false, undefined).length,
    );
    expect(host.querySelectorAll(".dock-mode").length).toBeGreaterThan(1);
    expect(host.querySelector(".dock-tail")).not.toBeNull();
    expect(host.querySelector(".dock-btn-label.always")?.textContent).toBe("Plain");
  });

  /**
   * And the whole thirteen still fit through the same wiring, because that is
   * the row `NEED` above was measured against — a reader with the switch on
   * gets the widest bar this app draws, and it is the one the ladder has to
   * cope with.
   */
  it("the reading view with the switch on: every mode, one segment", () => {
    render({ mode: "plain", onMode: () => {}, experimental: EXPERIMENTAL_ON });
    expect(host.querySelectorAll('.dock-modes [role="radio"]')).toHaveLength(
      visibleModes(true, undefined).length,
    );
  });

  /**
   * **And the loose arm too, which is the half that was left untested.**
   *
   * The metadata assertion above is measured against `visibleModes`, which is
   * the function the component itself calls — so it holds however the filter
   * behaves, and a loose arm that ignored the switch entirely would pass it.
   * GPT Sol's review of stage 2 named the surviving mutation: *"make the loose
   * arm always filter as Experimental off while leaving the radiogroup
   * correct"*.
   *
   * So this one counts against `MODES`, which is the vocabulary rather than the
   * rule — an independent number the filter cannot move. It is the only
   * assertion in this file that would notice the two arms disagreeing.
   */
  it("the metadata page with the switch on: every mode, as loose links", () => {
    render({ view: "metadata", experimental: EXPERIMENTAL_ON });
    expect(host.querySelector(".dock-modes")).toBeNull();
    expect(host.querySelectorAll(".dock-mode")).toHaveLength(MODES.length);
  });
});
