// @vitest-environment jsdom
/**
 * **The picker, actually mounted, actually pressed.**
 *
 * Everything else about this feature is tested as data — the slot assignment,
 * the two stores, the route's validation — and every one of those can be right
 * while the control on the row does nothing. A popover that never opens, a
 * swatch that reports the wrong slot, an "Automatic" that sends `undefined`
 * instead of `null`: none of it shows up anywhere below this file.
 *
 * Written in place of a browser pass rather than as well as one — Claude in
 * Chrome was not connected on the day (`list_connected_browsers` returned an
 * empty list), and a check nobody can run is not a check. There is a throwaway
 * preview page in the plan for when it is: docs/plans/260827l-search-row-colour.md.
 *
 * jsdom lays nothing out, so nothing here asserts about *position*. Floating
 * UI's placement is the one part of this that only a real browser can judge,
 * and it is deliberately not claimed.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "../src/web/SearchPanel.js";
import { assignSlots, PALETTE_BY_HUE, PALETTE_SLOTS } from "../src/web/hit-colours.js";
import type { SavedSearch } from "../src/web/useSearch.js";

let container: HTMLDivElement;
let root: Root;
let recoloured: [string, number | null][] = [];

const RUNS: SavedSearch[] = [
  "arguments against substrate independence",
  "anywhere he gives numbers",
].map((criterion, i) => ({
  id: `spya-aaaa${"bc"[i]}${i}`,
  criterion,
  createdAt: `2026-08-2${i}T00:00:00.000Z`,
  status: "done" as const,
  hits: [],
  stale: false,
}));

async function mount(runs: SavedSearch[] = RUNS): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SearchPanel
        /* The owner's arm: the picker under test is one of the four verbs that
           moved onto `SearchAccess` on 2026-09-04, and a visitor has no such
           control at all — which is what `visitorRuns` below asserts. */
        access={{
          kind: "owner",
          loaded: true,
          loadError: null,
          error: null,
          onAsk: () => {},
          onRetry: () => {},
          onRecolour: (id, colour) => recoloured.push([id, colour]),
          onDelete: () => {},
        }}
        matcher="meaning"
        onMatcher={() => {}}
        find={null}
        onFind={() => {}}
        runs={runs}
        active={[]}
        slots={assignSlots(runs)}
        onToggle={() => {}}
        onSolo={() => {}}
        onToggleAll={() => {}}
        found={[]}
        all={[]}
        order="document"
        onOrder={() => {}}
        gate={0}
        gateMoved={false}
        onGate={() => {}}
        openKey={null}
        onOpen={() => {}}
      />,
    );
  });
}

/** Every "change the colour of…" trigger on screen, in the order the panel drew them. */
function triggers(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Change the colour"]')];
}

/**
 * The trigger belonging to one search, found by its criterion.
 *
 * By name rather than by index, because **the panel lists newest first** and
 * the fixture is oldest first — which the first draft of this file got wrong in
 * six tests at once, all of them reporting the picker as broken when it was the
 * test that had the order backwards. Addressing a row by the words on it is
 * also what a reader does.
 */
function triggerFor(run: SavedSearch): HTMLButtonElement {
  const found = triggers().find((t) => t.getAttribute("aria-label")?.endsWith(run.criterion));
  if (!found) throw new Error(`no colour trigger for: ${run.criterion}`);
  return found;
}

/** The swatches in the open popover — portalled, so they are not in `container`. */
function swatches(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>(".srch-picker .srch-picker-swatch")];
}

function autoCell(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".srch-picker .srch-picker-auto");
}

async function press(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  recoloured = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the colour picker on a saved search", () => {
  it("gives every saved row a trigger, and opens none of them by itself", async () => {
    await mount();
    expect(triggers()).toHaveLength(RUNS.length);
    expect(swatches()).toHaveLength(0);
  });

  it("opens a swatch for every hue in the palette, and no more", async () => {
    /* The count is the palette's, read from the same constant the stylesheet is
       pinned against (tests/hit-colours.test.ts). A grid hard-coded at eight
       would keep passing here on the day a ninth hue is added and simply never
       offer it — which is not hypothetical: the palette went from eight to
       sixteen on 2026-08-27, and `PALETTE_SLOTS` rather than
       `CATEGORICAL_SLOTS` is what makes this line follow it. */
    await mount();
    await press(triggerFor(RUNS[0]!));
    expect(swatches()).toHaveLength(PALETTE_SLOTS);
  });

  it("reports the slot the reader pressed, and closes", async () => {
    await mount();
    await press(triggerFor(RUNS[0]!));
    await press(swatches()[3]!);
    // The fourth swatch, whichever slot the hue order puts there — the grid is
    // laid out by hue and the reader is pressing a position, not a slot.
    expect(recoloured).toEqual([[RUNS[0]!.id, PALETTE_BY_HUE[3]]]);
    expect(swatches()).toHaveLength(0);
  });

  it("reports the first cell's slot, the one an off-by-one would swallow", async () => {
    /* The first swatch and the first hue in the order have to be the same
       thing. An implementation numbering the cells from one — which is what the
       *label* does, deliberately — would send the second hue here, and every
       colour in the app would be one place along, which looks like a palette
       change rather than like a bug. */
    await mount();
    await press(triggerFor(RUNS[0]!));
    await press(swatches()[0]!);
    expect(recoloured).toEqual([[RUNS[0]!.id, PALETTE_BY_HUE[0]]]);
  });

  it("sends null for Automatic, never undefined", async () => {
    /* `null` is a command — *put it back on the hash* — and the route refuses
       `undefined` as a missing field. A picker that sent the second would 400
       every time a reader changed their mind, and the row would keep the colour
       they were trying to remove. */
    await mount();
    await press(triggerFor(RUNS[0]!));
    await press(autoCell()!);
    expect(recoloured).toEqual([[RUNS[0]!.id, null]]);
  });

  it("acts on the row whose trigger was pressed, not the first one", async () => {
    // Four controls to a row and two rows on screen: the popover has to carry
    // its own run id rather than read one off a panel-level piece of state.
    await mount();
    await press(triggerFor(RUNS[1]!));
    await press(swatches()[2]!);
    expect(recoloured).toEqual([[RUNS[1]!.id, PALETTE_BY_HUE[2]]]);
  });

  it("marks the reader's own choice, and says so to a screen reader", async () => {
    const runs = RUNS.map((r, i) => (i === 0 ? { ...r, colour: 6 } : r));
    await mount(runs);
    await press(triggerFor(RUNS[0]!));
    const current = swatches().filter((s) => s.classList.contains("current"));
    expect(current).toHaveLength(1);
    expect(swatches().indexOf(current[0]!)).toBe(PALETTE_BY_HUE.indexOf(6));
    expect(
      swatches()[PALETTE_BY_HUE.indexOf(6)]?.getAttribute("aria-pressed"),
    ).toBe("true");
    // And "Automatic" is not also claiming to be the current one.
    expect(autoCell()?.classList.contains("current")).toBe(false);
    expect(autoCell()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("marks Automatic when the reader has not chosen, even though a hue is drawn", async () => {
    /* The distinction the panel would most plausibly get wrong: a row with no
       stored colour is still *wearing* one, so a picker keyed on "what colour
       is this row" would mark a swatch and leave Automatic looking unset —
       and a reader could never tell whether they had pinned it or not. */
    await mount();
    await press(triggerFor(RUNS[0]!));
    expect(autoCell()?.classList.contains("current")).toBe(true);
    expect(autoCell()?.getAttribute("aria-pressed")).toBe("true");
    // No swatch claims to be the choice…
    expect(swatches().filter((s) => s.classList.contains("current"))).toHaveLength(0);
    expect(swatches().filter((s) => s.getAttribute("aria-pressed") === "true")).toHaveLength(0);
    // …but exactly one says it is what the row is showing today.
    expect(swatches().filter((s) => s.classList.contains("showing"))).toHaveLength(1);
  });

  it("puts both marks on one swatch once the reader has chosen", async () => {
    /* The two facts coincide as soon as there is a choice — the row is showing
       the hue it was pinned to. A `.showing` that went missing here would mean
       the drawn-hue mark was keyed on "has no choice" rather than on what is
       drawn, which is right for one case and wrong the moment anything else
       moves. */
    const runs = RUNS.map((r, i) => (i === 0 ? { ...r, colour: 2 } : r));
    await mount(runs);
    await press(triggerFor(RUNS[0]!));
    const at = PALETTE_BY_HUE.indexOf(2);
    expect(swatches()[at]?.classList.contains("current")).toBe(true);
    expect(swatches()[at]?.classList.contains("showing")).toBe(true);
  });

  it("closes on Escape without recolouring anything", async () => {
    await mount();
    await press(triggerFor(RUNS[0]!));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(swatches()).toHaveLength(0);
    expect(recoloured).toEqual([]);
  });

  /* **And on a press anywhere else, which Escape does not stand in for.**
     `useDismiss(context)` is given no options, so the thing that closes this
     picker for almost every reader is a default: read out of
     node_modules/@floating-ui/react on 2026-09-07, `outsidePress = true` and
     `outsidePressEvent = 'pointerdown'`. Escape was the only dismissal any test
     in this file dispatched, so that default was unpinned — taking `useDismiss`
     out of `useInteractions` left the whole file green.

     `pointerdown` rather than `click`, so the popover is gone before the press
     reaches whatever is under it; a picker floating over the results list would
     otherwise eat the first press on a hit. tests/block-gutter.test.tsx §
     "closes on a press anywhere else" is the same shape for the same reason. */
  it("closes on a press anywhere else on the page, without recolouring anything", async () => {
    await mount();
    await press(triggerFor(RUNS[0]!));
    expect(swatches()).toHaveLength(PALETTE_SLOTS);
    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(swatches()).toHaveLength(0);
    expect(recoloured).toEqual([]);
  });

  /* The other half of that default. A press that lands inside the popover is
     not a dismissal — the reader is on their way to a swatch, and a picker that
     closed under the finger reaching for it would need two presses for every
     colour. The grid rather than a swatch is the target on purpose: a swatch
     closes the picker anyway, by *choosing*, which is a different mechanism and
     would hide this one. */
  it("stays open when the press lands inside the popover", async () => {
    await mount();
    await press(triggerFor(RUNS[0]!));
    const grid = document.querySelector(".srch-picker .srch-picker-grid");
    if (!grid) throw new Error("the popover opened without its grid");
    await act(async () => {
      grid.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(swatches()).toHaveLength(PALETTE_SLOTS);
    expect(recoloured).toEqual([]);
  });

  it("names each swatch, because a colour is the one thing a label cannot be", async () => {
    await mount();
    await press(triggerFor(RUNS[0]!));
    // Numbered from one: the reader is counting swatches, not indexing an array.
    /* Numbered by grid position, so the labels run 1..16 in order however the
       slots underneath are arranged — a label naming the *slot* would say
       "Colour 9" on the second swatch, which describes the database. */
    expect(swatches().map((s) => s.getAttribute("aria-label"))).toEqual(
      Array.from({ length: PALETTE_SLOTS }, (_, i) => `Colour ${i + 1}`),
    );
    // And the trigger says which search it is about, since the row's own name
    // belongs to the button beside it.
    expect(triggerFor(RUNS[0]!).getAttribute("aria-label")).toContain(RUNS[0]!.criterion);
  });

  it("asks for a palette reference rather than a colour", async () => {
    /* The seam the whole feature is built to keep (src/web/hit-colours.ts): a
       hex value anywhere in here would put the palette beyond the reach of the
       stylesheet, and a palette change would then mean editing TypeScript. */
    await mount();
    await press(triggerFor(RUNS[0]!));
    for (const [position, swatch] of swatches().entries()) {
      const slot = PALETTE_BY_HUE[position];
      expect(swatch.getAttribute("style")).toContain(`--cat-rgb: var(--cat-${slot}-rgb)`);
    }
    expect(document.querySelector(".srch-picker")?.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

/**
 * **One empty state, not two** — the owner's side of a bug found on a visitor's
 * screen.
 *
 * A signed-out browser pass on 2026-09-04 met *"Whoever added this article
 * hasn't searched it."* immediately followed by *"Nothing matched. The model
 * found nothing in this article that matches."* — two empty states saying
 * different things about one article, the second an answer to a question nobody
 * had asked.
 *
 * **It was never visitor-specific.** `Results` guarded only on `!loaded`, so an
 * owner with no saved searches fell through every case to the last one and got
 * the same pair; it had been that way since the ticks landed. The comment above
 * that guard had claimed the opposite in as many words — *"with no saved
 * searches at all, `Saved` above is already explaining that, and two empty
 * states stacked is one too many"* — an intention written down and never
 * implemented, with the comment standing in for the check
 * (docs/reusable/silent-success.md).
 *
 * So the case lives here, on the owner's arm, because that is where the bug
 * lived. The visitor's twin is in tests/public-network-trace.test.tsx.
 */
describe("an owner who has not searched this article yet", () => {
  it("is told so once, and not also that nothing matched", async () => {
    await mount([]);

    expect(container.textContent).toContain("Nothing searched for yet");
    expect(container.textContent, "a second empty state").not.toContain("Nothing matched");
    /* The control: with a run on the panel the list is drawing again, so the
       guard above is scoped to the empty case rather than switching the whole
       results area off for good. */
    await mount(RUNS);
    expect(container.textContent, "the list itself").toContain(RUNS[0]!.criterion);
  });
});
