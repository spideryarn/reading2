// @vitest-environment jsdom
/**
 * **What the spine's hover card actually says.**
 *
 * A separate file from `tests/spine-hover.test.tsx`, which asks whether a card
 * appears at all. This one asks what is written on it, and it exists because the
 * answer was *nothing* for one of the four things the card promises.
 *
 * ## The bug this file was written around
 *
 * The card lists the band's sub-sections. It rendered `child.node.title`, and
 * the children of a hover card's band are **depth-3 leaves** — `App.tsx` builds
 * the outline three deep and `measure` makes the hit targets the L2s, so a
 * card's children are one node per paragraph. The tree contract gives a section
 * a title and a leaf a `navLabel` (granularity-zoom.md § Node shape). Counted
 * over every article in `data/`:
 *
 * ```
 *   888 depth-3 nodes    0 with a title    0 with a gist    853 with a navLabel
 * ```
 *
 * So every sub-section row in every card was a bullet with no text beside it,
 * and `+ 3 more` was counting rows that said nothing. It had been that way since
 * the spine was written (`e6eb7e0`), and **no test could see it**: every fixture
 * in the suite gives its entries `children: []`, so the list was never rendered
 * once — a corpus that cannot exercise its arm. GPT Sol found the premise false
 * while reviewing a plan that was about to add a second blank line under each
 * row. docs/plans/spine-rail.md § 3.
 *
 * Hence the fixture below: **children shaped like the real ones**, with a
 * `navLabel` and no title, plus one that has neither, because that is what four
 * per cent of them look like.
 *
 * ## Why this one measures and the hover file does not
 *
 * Every rectangle in jsdom is zero, which is fine for "is there a card" and
 * useless for "which band is the reader in" — with zero heights no band contains
 * the reading line, so `you are here` could never appear and a test asserting it
 * does not would pass against any code at all. So the rows are given real
 * geometry (`stubRowGeometry`), and scrolling moves the reading line between
 * them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Spine } from "../src/web/Spine.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AFTER_THE_OPEN_DELAY = 500;

/** Every row is this tall, so a band's extent is a round number of them. */
const ROW_H = 100;
const ROW_IDS = ["b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","b10","b11"];

function node(
  id: string,
  depth: number,
  o: Partial<TreeNode> = {},
): TreeNode {
  return {
    id: id as NodeId,
    depth,
    parent: "root" as NodeId,
    children: [],
    range: [`${id}-a` as BlockId, `${id}-b` as BlockId],
    title: "",
    ...o,
  } as TreeNode;
}

/** A depth-3 leaf: a nav label and no title, which is what they all are. */
function leaf(id: string, navLabel?: string): OutlineEntry {
  return {
    node: node(id, 3, navLabel === undefined ? {} : { navLabel }),
    startRow: 0,
    endRow: 0,
    words: 40,
    children: [],
  };
}

function section(
  id: string,
  title: string,
  startRow: number,
  endRow: number,
  children: OutlineEntry[],
): OutlineEntry {
  return {
    node: node(id, 2, { title, gist: `What ${title} is about.` }),
    startRow,
    endRow,
    words: 640,
    children,
  };
}

/**
 * One part of three sections, and a second part with none.
 *
 * The second is not padding: a part with no children is the case where
 * `measure` makes the *part itself* the hit target, so its card has no crumb
 * and no `n of m` — the degrade path in docs/plans/spine-rail.md § Degrading.
 */
const OUTLINE: OutlineEntry[] = [
  {
    node: node("p1", 1, { title: "What feeling is for", gist: "The part's gist." }),
    startRow: 0,
    endRow: 7,
    words: 1920,
    children: [
      section("s1", "The body as a model", 0, 1, [
        leaf("k1", "the retina sends less than it receives"),
        leaf("k2", "wavelength is not the thing you see"),
        leaf("k3"), // neither a title nor a nav label — must not become a bullet
      ]),
      section("s2", "Why colour is a guess", 2, 3, [
        leaf("k4", "one"),
        leaf("k5", "two"),
        leaf("k6", "three"),
        leaf("k7", "four"),
        leaf("k8", "five"),
        leaf("k9", "six"),
        leaf("k10"), // blank, so `+ n more` must not count it
      ]),
      section("s3", "A third, for the count", 4, 5, []),
      /* **Two untitled sections, because the corpus has two.**
         `revistes-ub-30977` has a pair of childless depth-2 nodes under its
         References — one carrying a navLabel, one carrying nothing. They are
         here so the card and the accessible name have to say something about
         each, and something *different* about each. */
      { ...section("s5", "", 6, 6, []), node: node("s5", 2, { navLabel: "Lyn McCredden teaches Australian Literature" }) },
      { ...section("s6", "", 7, 7, []), node: node("s6", 2, {}) },
    ],
  },
  {
    node: node("p2", 1, { title: "Second part", gist: "Alone." }),
    startRow: 8,
    endRow: 9,
    words: 0, // no word count — the footer must not say "0 words"
    children: [],
  },
  {
    /* A part with exactly one section, which is the case `1 of 1` would be
       noise in. Without this the omit-a-lone-child rule is unexercised — and an
       unexercised rule is the kind that gets deleted by a refactor with every
       test still green. */
    node: node("p3", 1, { title: "Third part", gist: "One section." }),
    startRow: 10,
    endRow: 11,
    words: 300,
    children: [section("s4", "Its only section", 10, 11, [])],
  },
];

let host: HTMLDivElement;
let table: HTMLTableElement;
let root: Root;
let scrollY = 0;

/**
 * Give the table's rows real geometry.
 *
 * `measure` reads `getBoundingClientRect()` per row and adds `window.scrollY`,
 * so a viewport-relative rect plus the scroll offset has to come back out as a
 * stable document position — which is what the subtraction below is for.
 */
function stubRowGeometry() {
  for (const [i, tr] of [...table.querySelectorAll("tr")].entries()) {
    tr.getBoundingClientRect = () => {
      const top = i * ROW_H - scrollY;
      return {
        top,
        bottom: top + ROW_H,
        height: ROW_H,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }
}

function setScroll(y: number) {
  scrollY = y;
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(50);
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();
  scrollY = 0;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  /* **A viewport height that makes `READING_LINE` exact.** jsdom's default is
     768, and `768 * 0.35` is 268.79999999999995 — so a case meaning to put the
     reading line *exactly* on a band boundary lands 0.00000000000006px below
     it, silently testing the ordinary case instead of the edge one. 400 × 0.35
     is 140, and every number below is then an integer. */
  Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });

  table = document.createElement("table");
  table.innerHTML = `<tbody>${ROW_IDS.map(
    (id) => `<tr data-block="${id}"><td>x</td></tr>`,
  ).join("")}</tbody>`;
  document.body.append(table);
  stubRowGeometry();

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  table.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountSpine() {
  act(() => {
    root.render(<Spine outline={OUTLINE} layoutKey="test" onJump={() => {}} />);
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

/**
 * Open band `index`'s card and return it.
 *
 * **It closes whatever was open first, and that is not tidiness.** Written
 * without it, this helper took `document.querySelector(".tooltip")` — the
 * *first* panel in the DOM — while the previous band's card was still running
 * its 80ms exit transition, so a second call returned the card belonging to the
 * band before it. The `you are here` cases caught it because they assert a
 * string is present; the sibling cases would not have, because an assertion
 * that a card does *not* say something passes very comfortably against a
 * different card. Hence also the length check below: exactly one panel, and it
 * is the one just asked for.
 */
function openCard(index: number): HTMLElement {
  closeCards();
  const hits = host.querySelectorAll<HTMLElement>(".spine-hit");
  hits[index]?.dispatchEvent(new MouseEvent("mouseenter"));
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  const open = document.querySelectorAll<HTMLElement>(".tooltip");
  expect(open, `expected exactly one card for band ${index}`).toHaveLength(1);
  return open[0]!;
}

/** Leave every band and let the exit transition finish — see `openCard`. */
function closeCards() {
  for (const h of host.querySelectorAll<HTMLElement>(".spine-hit")) {
    h.dispatchEvent(new MouseEvent("mouseleave"));
  }
  /* Two advances. React schedules the exit transition in an effect that only
     runs when `act` returns, so a single advance ends before the 80ms unmount
     timer has been created — tests/spine-hover.test.tsx has the long version. */
  act(() => {
    vi.advanceTimersByTime(300);
  });
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(document.querySelectorAll(".tooltip")).toHaveLength(0);
}

const kidText = (card: HTMLElement) =>
  [...card.querySelectorAll(".tip-kids li")].map((li) => li.textContent ?? "");

/* Four hits: s1, s2, s3 (children of p1) and p2 (childless, so it stands in for
   its own children). Pinned so that a change to `measure` cannot silently shift
   every index below. */
const S1 = 0;
const S2 = 1;
const S3 = 2;
const S5 = 3; // untitled, has a navLabel
const S6 = 4; // untitled, has nothing
const P2 = 5;
const S4 = 6; // the only child of p3

it("lays the rail out as seven hit targets", () => {
  mountSpine();
  expect(host.querySelectorAll(".spine-hit")).toHaveLength(7);
});

describe("the sub-section list", () => {
  it("says what each sub-section is, rather than showing an empty bullet", () => {
    /* **The assertion the whole file is for.** Against the code as it stood
       until 2026-08-28 every one of these is the empty string. */
    mountSpine();
    expect(kidText(openCard(S1))).toEqual([
      "the retina sends less than it receives",
      "wavelength is not the thing you see",
    ]);
  });

  it("never renders a row with nothing in it", () => {
    mountSpine();
    for (const i of [S1, S2, S3, S5, S6, P2, S4]) {
      for (const text of kidText(openCard(i))) {
        expect(text.trim()).not.toBe("");
      }
    }
  });

  it("counts `+ n more` over the rows a reader would get, not the raw children", () => {
    /* s2 has seven children, one of them blank. Five are shown, so the overflow
       is one — not the two a count taken before the filter would report. */
    mountSpine();
    const rows = kidText(openCard(S2));
    expect(rows.slice(0, 5)).toEqual(["one", "two", "three", "four", "five"]);
    expect(rows[5]).toBe("+ 1 more");
  });

  it("shows no list at all for a section with no sub-sections", () => {
    mountSpine();
    expect(openCard(S3).querySelectorAll(".tip-kids")).toHaveLength(0);
  });
});

describe("the crumb", () => {
  it("names the part and says where in it this section sits", () => {
    mountSpine();
    const crumb = openCard(S2).querySelector(".tip-crumb");
    expect(crumb?.querySelector(".tip-crumb-name")?.textContent).toBe(
      "What feeling is for",
    );
    expect(crumb?.querySelector(".tip-crumb-pos")?.textContent).toBe("2 of 5");
  });

  it("has no crumb at all on a part standing in for its own children", () => {
    mountSpine();
    expect(openCard(P2).querySelectorAll(".tip-crumb")).toHaveLength(0);
  });

  it("names the part but says no position when it is the only section", () => {
    /* `1 of 1` is not orientation, it is a number that has to be read before it
       can be discarded. The part's name still earns its line. */
    mountSpine();
    const card = openCard(S4);
    expect(card.querySelector(".tip-crumb-name")?.textContent).toBe("Third part");
    expect(card.querySelectorAll(".tip-crumb-pos")).toHaveLength(0);
  });
});

describe("you are here", () => {
  /**
   * The reading line is 35% down the viewport (`READING_LINE`). jsdom's
   * `innerHeight` is pinned to 400 and `READING_LINE` is 0.35, so the reading
   * line sits at `scrollY + 140` exactly. Rows are 100px and the bands are:
   * s1 0–200, s2 200–400, s3 400–600, s5 600–700, s6 700–800, p2 800–1000,
   * s4 1000–1200.
   */
  it("marks the section the reader is in", () => {
    mountSpine();
    setScroll(100); // reading line at 240 → s2
    expect(openCard(S2).textContent).toContain("you are here");
  });

  it("does not mark that section's siblings", () => {
    /* **The assertion that would be green against the obvious wrong
       implementation.** Comparing the card's *parent* against the rail's `here`
       — which is an L1 — says "you are here" on every section of the current
       part at once. s1 and s3 share a part with s2 and the reader is in neither. */
    mountSpine();
    setScroll(100);
    expect(openCard(S1).textContent).not.toContain("you are here");
    expect(openCard(S3).textContent).not.toContain("you are here");
    expect(openCard(P2).textContent).not.toContain("you are here");
  });

  it("moves with the reader", () => {
    mountSpine();
    setScroll(100);
    expect(openCard(S2).textContent).toContain("you are here");
    setScroll(700); // reading line at 840 → p2
    expect(openCard(P2).textContent).toContain("you are here");
    expect(openCard(S2).textContent).not.toContain("you are here");
  });

  it("says nothing at all once the reader is past the end of the article", () => {
    /* **The case that makes the other four mean something.** `hereHit` has no
       fallback to the first or last band, deliberately and unlike `here` — which
       does fall back, because it drives `.spine-part.active` and the rail
       highlighting its last part while you read the footer is fine. A *sentence*
       saying "you are here" is not fine when you are not there.

       Written because a mutation run found this the one assertion the file was
       missing: swapping `hits.find(inBand)` for `hits.find(inBand) ?? hits[0]`
       left all thirteen other cases green while the first section claimed to be
       where the reader was, from anywhere in the document. */
    mountSpine();
    setScroll(1100); // reading line at 1240, past the last row's 1200
    for (const i of [S1, S2, S3, S5, S6, P2, S4]) {
      expect(openCard(i).textContent).not.toContain("you are here");
    }
    expect(
      [...host.querySelectorAll(".spine-hit")].map((h) =>
        h.getAttribute("aria-current"),
      ),
    ).toEqual([null, null, null, null, null, null, null]);
  });

  it("holds through the whole of a band, not just its first row", () => {
    /* **The case a mutation run showed the file could not see.** Every other
       positive assertion here puts the reading line in the *first* row of a
       two-row band, so changing `edge(e.endRow + 1)` to `edge(e.endRow)` in
       `measure` — which shortens every band by its last row — left the entire
       suite green while the rail's geometry was wrong throughout. GPT Sol,
       2026-08-28.

       s2 is rows 2–3, i.e. 200–400px. The reading line sits at
       `scrollY + 140`, so scrollY 200 puts it at 340 — inside s2's *second*
       row, which only exists if `endRow` is inclusive. */
    mountSpine();
    setScroll(200);
    expect(openCard(S2).textContent).toContain("you are here");
  });

  it("puts a boundary in the band below it, not the one above", () => {
    /* The interval is half-open — `pos >= top && pos < top + height` — so a
       reading line exactly on the line between two bands belongs to the lower
       one. Pinned because "off by one row" and "off by one pixel" are different
       bugs and only one of them is caught above. scrollY 260 puts the line at
       exactly 400 — s2's last pixel + 1, and s3's first — and one pixel less
       is still s2. */
    mountSpine();
    setScroll(260);
    expect(openCard(S3).textContent).toContain("you are here");
    expect(openCard(S2).textContent).not.toContain("you are here");
  });

  it("and one pixel above that boundary is still the band above", () => {
    /* The other side of the same line, in its own mount rather than appended to
       the case above — re-scrolling and re-hovering the *same* band inside one
       test leaves Floating UI's group mid-handover and the card does not
       reopen, which fails for a reason that has nothing to do with geometry. */
    mountSpine();
    setScroll(259);
    expect(openCard(S2).textContent).toContain("you are here");
    expect(openCard(S3).textContent).not.toContain("you are here");
  });

  it("says the same thing to a screen reader, on the button", () => {
    /* The card is the button's *description*, which a screen reader can be told
       not to read, and it opens on hover, which a keyboard does not have. */
    mountSpine();
    setScroll(100);
    const hits = [...host.querySelectorAll<HTMLElement>(".spine-hit")];
    expect(hits.map((h) => h.getAttribute("aria-current"))).toEqual([
      null,
      "location",
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("a section with no title of its own", () => {
  /* Two of these are in the corpus — `revistes-ub-30977`, under References.
     Before 2026-08-28 the card rendered an empty title and `ariaFor` gave both
     buttons their parent's name, so two adjacent bands were indistinguishable
     both on screen and to a screen reader. */

  it("falls back to its nav label", () => {
    mountSpine();
    const card = openCard(S5);
    expect(card.querySelector(".tip-title")?.textContent).toBe(
      "Lyn McCredden teaches Australian Literature",
    );
  });

  it("does not then repeat that nav label underneath itself", () => {
    mountSpine();
    expect(openCard(S5).querySelectorAll(".tip-navlabel")).toHaveLength(0);
  });

  it("falls back to its position when it has no label either", () => {
    mountSpine();
    expect(openCard(S6).querySelector(".tip-title")?.textContent).toBe(
      "Section 5 of 5",
    );
  });

  it("gives the two of them different accessible names", () => {
    /* The point of the fallback. `aria-label` is what a screen reader reads,
       and two buttons reading "What feeling is for" in a row is a rail you
       cannot navigate. */
    mountSpine();
    const names = [...host.querySelectorAll<HTMLElement>(".spine-hit")].map((h) =>
      h.getAttribute("aria-label"),
    );
    expect(names[S5]).not.toBe(names[S6]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("the footer", () => {
  it("gives a word count when there is one", () => {
    mountSpine();
    expect(openCard(S1).textContent).toContain("640 words");
  });

  it("says nothing rather than `0 words` when there is not", () => {
    mountSpine();
    const text = openCard(P2).textContent ?? "";
    expect(text).not.toContain("words");
    expect(text).toContain("% in"); // the rest of the footer is still there
  });
});
