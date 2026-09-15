// @vitest-environment jsdom
/**
 * **A search result's card opens from its score, and pressing the result goes
 * to the passage.**
 *
 * Greg, 2026-09-12 (SPIDERYARN-READING2-3T): *"I think it should only show that
 * rich tooltip (that explains what the bar and the score is) if I click on the
 * bar and the score, not on the entry itself, because I want to be able to click
 * on the entry to be taken to that place in the text."*
 *
 * Until then the card was on the whole row button, and a click opened it twice
 * over — the pointer entering the row, and the button taking focus — right over
 * the prose the jump had just scrolled to. docs/plans/260915c-….
 *
 * The events are sent the way docs/project/tooltips.md § Three things about
 * testing a card in jsdom says they have to be: a native `mouseenter` opens, and
 * every wait is its own `act` block.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BlockId } from "../src/types.js";
import { ScoreBars } from "../src/web/ScoreBars.js";
import { SearchPanel } from "../src/web/SearchPanel.js";
import type { Found } from "../src/web/search-hits.js";
import { assignSlots } from "../src/web/hit-colours.js";
import type { SavedSearch } from "../src/web/useSearch.js";

let container: HTMLDivElement;
let root: Root;
let jumps: string[] = [];

/** One saved search, switched on: the list is drawn only when one is. */
const RUN: SavedSearch = {
  id: "spya-runcc3",
  criterion: "where the context is reinstated",
  createdAt: "2026-09-12T00:00:00.000Z",
  status: "done",
  hits: [],
  stale: false,
};

const OTHER_RUN: SavedSearch = {
  ...RUN,
  id: "spya-runzz9",
  criterion: "where recall fails despite reinstatement",
};

const HIT: Found = {
  key: "spya-hitaa1:0",
  blockId: "spya-hitaa1" as BlockId,
  runId: RUN.id,
  slot: 0,
  index: 3,
  start: 0,
  end: 20,
  confidence: 72,
  valence: null,
  reasoning: "Says outright that the context is reinstated.",
  short: "the context at encoding is reinstated",
  long: "At retrieval, the context at encoding is reinstated, and that is what brings the item back.",
  at: 0.4,
  whole: false,
  quoteStroke: null,
};

async function render(node: ReactNode): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
}

async function mountPanel({
  openKey = null,
  runs = [RUN],
}: {
  openKey?: string | null;
  runs?: SavedSearch[];
} = {}): Promise<void> {
  await render(
    <SearchPanel
      access={{
        kind: "owner",
        loaded: true,
        loadError: null,
        error: null,
        onAsk: () => {},
        onRetry: () => {},
        onRecolour: () => {},
        onDelete: () => {},
      }}
      matcher="meaning"
      onMatcher={() => {}}
      find={null}
      onFind={() => {}}
      runs={runs}
      active={runs.map((run) => run.id)}
      slots={assignSlots(runs)}
      onToggle={() => {}}
      onSolo={() => {}}
      onToggleAll={() => {}}
      found={[HIT]}
      all={[HIT]}
      order="document"
      onOrder={() => {}}
      gate={0}
      gateMoved={false}
      onGate={() => {}}
      openKey={openKey}
      onOpen={(key) => jumps.push(key)}
    />,
  );
}

/** Longer than the results list's group delay (350ms open), in its own block. */
async function wait(ms = 500): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** The search result's card, portalled to <body>, so not inside `container`. */
function hitCards(): Element[] {
  return [...document.querySelectorAll(".tooltip.tip-hit")];
}

function row(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(".srch-hit-btn");
  if (!el) throw new Error("no result row drawn");
  return el;
}

function gutter(): HTMLElement {
  const el = container.querySelector<HTMLElement>(".srch-hit .srch-gutter");
  if (!el) throw new Error("no gutter drawn");
  return el;
}

/**
 * A mouse pressing `target`, which sits inside `button`: the pointer enters the
 * button and then the target (mouseenter does not bubble, so each element
 * entered gets its own), the button takes focus on mousedown, and the click
 * bubbles.
 */
async function pointerPress(button: HTMLElement, target: HTMLElement): Promise<void> {
  button.dispatchEvent(new MouseEvent("mouseenter"));
  if (target !== button) target.dispatchEvent(new MouseEvent("mouseenter"));
  target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await wait();
  await act(async () => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.focus();
    target.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await wait();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jumps = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("a search result's card", () => {
  it("does not open when the reader presses the words, and the press still jumps", async () => {
    await mountPanel();
    const words = container.querySelector<HTMLElement>(".srch-hit-quote");
    if (!words) throw new Error("no quote drawn");
    await pointerPress(row(), words);
    expect(jumps).toEqual([HIT.key]);
    expect(hitCards()).toHaveLength(0);
  });

  it("does not open when the row takes keyboard focus", async () => {
    await mountPanel();
    await act(async () => row().focus());
    await wait();
    expect(hitCards()).toHaveLength(0);
  });

  it("opens when the pointer rests on the score, and explains it", async () => {
    await mountPanel();
    gutter().dispatchEvent(new MouseEvent("mouseenter"));
    await wait();
    const cards = hitCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("72 out of 100");
    expect(cards[0]?.textContent).toContain("not as a probability");
  });

  /* Hover first and then the click, as a mouse does — which is also what
     catches a toggle: the hover has opened the card by the time the click
     lands, and a toggle would shut it on the press that asked for it. */
  it("opens when the reader presses the score, and that press does not jump", async () => {
    await mountPanel();
    await pointerPress(gutter(), gutter());
    expect(hitCards()).toHaveLength(1);
    expect(jumps).toEqual([]);
  });

  it("opens when the score takes keyboard focus — the card's keyboard route", async () => {
    await mountPanel();
    await act(async () => gutter().focus());
    await wait();
    expect(hitCards()).toHaveLength(1);
  });

  it("has a name that says the numbers, for a reader who never opens the card", async () => {
    await mountPanel({ openKey: HIT.key, runs: [RUN, OTHER_RUN] });
    const hit = container.querySelector<HTMLElement>(".srch-hit");
    if (!hit) throw new Error("no result row drawn");
    const buttons = [...hit.querySelectorAll<HTMLButtonElement>(":scope > button")];

    /* The source order is the tab order: first the left-hand score, then the
       words. Both are native buttons and neither needs a tabindex override. */
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.className)).toEqual(["srch-gutter", "srch-hit-btn"]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, 0]);

    const score = buttons[0]!;
    expect(score.getAttribute("aria-label")).toBe(
      "About this match: found by where the context is reinstated, " +
        "the model's confidence 72 out of 100, 40% of the way through the article",
    );
    expect(score.getAttribute("aria-expanded")).toBe("false");
    const marks = [...score.querySelectorAll(".srch-hit-dot, .srch-conf, .srch-place")];
    expect(marks).toHaveLength(3);
    expect(marks.map((mark) => mark.getAttribute("aria-hidden"))).toEqual([
      "true",
      "true",
      "true",
    ]);

    const words = buttons[1]!;
    expect(words.getAttribute("aria-current")).toBe("true");
    expect(words.getAttribute("aria-label")).toBeNull();
    expect(words.textContent).toContain(HIT.short);
    expect(words.textContent).not.toContain("72");
    expect(words.textContent).not.toContain("40%");

    await act(async () => score.click());
    await wait();
    expect(score.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens from a tap on the score with no hover before it — the touch route", async () => {
    await mountPanel();
    await act(async () => {
      gutter().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await wait();
    expect(hitCards()).toHaveLength(1);
    expect(jumps).toEqual([]);
  });
});

/**
 * **And it goes away.** "Doesn't seem to go away" was half the report, so each
 * way out is its own case. Closing takes two `act` blocks — the close delay,
 * then the render that unmounts (docs/project/tooltips.md § Three things).
 */
describe("a search result's card closes", () => {
  async function openByPress(): Promise<void> {
    await mountPanel();
    await act(async () => {
      gutter().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await wait();
    expect(hitCards(), "the card should be open to begin with").toHaveLength(1);
  }

  it("when the pointer leaves the score after pressing it", async () => {
    await mountPanel();
    await pointerPress(gutter(), gutter());
    expect(hitCards()).toHaveLength(1);
    gutter().dispatchEvent(new MouseEvent("mouseleave"));
    gutter().dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    await wait();
    await wait();
    expect(hitCards()).toHaveLength(0);
  });

  it("on Escape", async () => {
    await openByPress();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await wait();
    await wait();
    expect(hitCards()).toHaveLength(0);
  });

  it("on a press somewhere else", async () => {
    await openByPress();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    await wait();
    await wait();
    expect(hitCards()).toHaveLength(0);
  });

  it("when the reader then presses the words — and that press still jumps", async () => {
    await openByPress();
    const words = container.querySelector<HTMLElement>(".srch-hit-quote");
    if (!words) throw new Error("no quote drawn");
    await pointerPress(row(), words);
    await wait();
    expect(jumps).toEqual([HIT.key]);
    expect(hitCards()).toHaveLength(0);
  });
});

/**
 * The glossary, quotes and citations rows draw their scores through
 * `ScoreBars`, whose card is on the bars' own span rather than on the row — so
 * those rows already do what Greg asked for. A pin rather than a reproduction:
 * green before this change, and here so that nobody later moves that card up
 * onto the row.
 */
describe("ScoreBars inside a row button", () => {
  let pressed = 0;

  async function mountRow(): Promise<void> {
    pressed = 0;
    await render(
      <button type="button" className="row" onClick={() => pressed++}>
        <span className="row-words">a term</span>
        <ScoreBars scores={[{ key: "difficulty", label: "Difficulty", value: 0.7 }]} />
      </button>,
    );
  }

  function barCards(): Element[] {
    return [...document.querySelectorAll(".tooltip.score-bars-card")];
  }

  it("opens no card when the row is pressed", async () => {
    await mountRow();
    const button = container.querySelector<HTMLElement>(".row");
    const words = container.querySelector<HTMLElement>(".row-words");
    if (!button || !words) throw new Error("row not drawn");
    await pointerPress(button, words);
    expect(pressed).toBe(1);
    expect(barCards()).toHaveLength(0);
  });

  it("opens its card when the pointer rests on the bars", async () => {
    await mountRow();
    container.querySelector(".score-bars")?.dispatchEvent(new MouseEvent("mouseenter"));
    await wait();
    expect(barCards()).toHaveLength(1);
  });
});
