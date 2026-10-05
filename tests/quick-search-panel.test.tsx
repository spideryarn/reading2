// @vitest-environment jsdom
/**
 * **Quick search, in the panel** — the client half of
 * docs/plans/261002e-quick-search-v1.md.
 *
 * The panel actually mounted and pressed: the third arm of the toggle asks
 * with its own kind, the draft survives a switch between quick and meaning,
 * a quick row says so and offers *thorough* to its owner only, the
 * "already searching" guard is per kind, and a quick hit's score explains
 * itself as a quick score rather than as the meaning model's confidence.
 *
 * Each case names the GPT Sol plan-review finding it holds (F5, F6, F9).
 */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, SearchKind } from "../src/types.js";
import { SearchPanel, type SearchAccess } from "../src/web/SearchPanel.js";
import { assignSlots } from "../src/web/hit-colours.js";
import type { Matcher } from "../src/web/params.js";
import type { Found } from "../src/web/search-hits.js";
import type { SavedSearch } from "../src/web/useSearch.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

let container: HTMLDivElement;
let root: Root;
let asked: [string, SearchKind][] = [];
let toggled: [string, boolean][] = [];

const QUICK: SavedSearch = {
  id: "spya-quik2a",
  criterion: "statistical evidence",
  kind: "quick",
  createdAt: "2026-10-02T09:00:00.000Z",
  status: "done",
  hits: [],
  stale: false,
};
const MEANING: SavedSearch = {
  ...QUICK,
  id: "spya-mean2b",
  criterion: "arguments against the main claim",
  kind: "meaning",
  createdAt: "2026-10-02T08:00:00.000Z",
};

const HIT: Found = {
  key: `${QUICK.id}:spya-hitaa1:0`,
  blockId: "spya-hitaa1" as BlockId,
  runId: QUICK.id,
  slot: 0,
  index: 3,
  start: 0,
  end: 400,
  confidence: 93,
  valence: null,
  reasoning: "",
  short: "Each of the forty volunteers…",
  long: "Each of the forty volunteers was scanned twice…",
  at: 0.25,
  whole: false,
  quoteStroke: null,
};

function owner(running: ReadonlySet<string> = new Set()): SearchAccess {
  return {
    kind: "owner",
    loaded: true,
    loadError: null,
    error: null,
    running,
    onAsk: (criterion, kind) => asked.push([criterion, kind]),
    onRetry: () => {},
    onRecolour: () => {},
    onDelete: () => {},
  };
}

/** The panel with its matcher held in state, as `useSearchMode` holds it in the URL. */
function Harness({
  access,
  runs,
  start,
  active,
  found = [],
}: {
  access: SearchAccess;
  runs: SavedSearch[];
  start: Matcher;
  active: string[];
  found?: Found[];
}) {
  const [matcher, setMatcher] = useState<Matcher>(start);
  const [find, setFind] = useState<string | null>(null);
  return (
    <SearchPanel
      access={access}
      matcher={matcher}
      onMatcher={setMatcher}
      find={find}
      onFind={setFind}
      runs={runs}
      active={active}
      slots={assignSlots(runs)}
      onToggle={(id, on) => toggled.push([id, on])}
      onSolo={() => {}}
      onToggleAll={() => {}}
      found={found}
      all={found}
      order="document"
      onOrder={() => {}}
      gate={0}
      gateMoved={false}
      onGate={() => {}}
      openKey={null}
      onOpen={() => {}}
    />
  );
}

async function mount(props: Parameters<typeof Harness>[0]): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness {...props} />);
  });
}

function input(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>("input.srch-input");
  if (!el) throw new Error("no search box");
  return el;
}

function type(text: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input(),
      text,
    );
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function radio(name: string): HTMLButtonElement {
  const el = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (b) => b.textContent?.trim() === name,
  );
  if (!el) throw new Error(`no ${name} radio`);
  return el;
}

function findButton(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>("button.srch-go");
  if (!el) throw new Error("no find button");
  return el;
}

function thorough(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>("button.srch-thorough");
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  toggled = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the third arm of the toggle", () => {
  it("is drawn between words and meaning, and checked when the matcher is quick", async () => {
    await mount({ access: owner(), runs: [], start: "quick", active: [] });
    const names = [...container.querySelectorAll('[role="radio"]')].map((b) => b.textContent?.trim());
    expect(names).toEqual(["words", "quick", "meaning"]);
    expect(radio("quick").getAttribute("aria-checked")).toBe("true");
    expect(radio("meaning").getAttribute("aria-checked")).toBe("false");
  });

  it("asks as quick on find, and as meaning once switched", async () => {
    await mount({ access: owner(), runs: [], start: "quick", active: [] });
    type("statistical evidence");
    act(() => findButton().click());
    expect(asked).toEqual([["statistical evidence", "quick"]]);

    act(() => radio("meaning").click());
    act(() => findButton().click());
    expect(asked.at(-1)).toEqual(["statistical evidence", "meaning"]);
  });

  it("asks as quick on Enter", async () => {
    await mount({ access: owner(), runs: [], start: "quick", active: [] });
    type("anywhere he gives numbers");
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(asked).toEqual([["anywhere he gives numbers", "quick"]]);
  });

  it.each(["quick", "meaning"] as const)("puts the soft keyboard away on the %s find button", async (start) => {
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("visualViewport", { height: 464, offsetTop: 0, scale: 1 });
    await mount({ access: owner(), runs: [], start, active: [] });
    type("statistical evidence");
    input().focus();
    act(() => findButton().click());
    expect(asked).toEqual([["statistical evidence", start]]);
    expect(document.activeElement).not.toBe(input());
  });

  it("keeps desktop focus when find sends", async () => {
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("visualViewport", { height: 800, offsetTop: 0, scale: 1 });
    await mount({ access: owner(), runs: [], start: "meaning", active: [] });
    type("statistical evidence");
    input().focus();
    act(() => findButton().click());
    expect(asked).toEqual([["statistical evidence", "meaning"]]);
    expect(document.activeElement).toBe(input());
  });

  /* Sol's D9, 261002h stage 3 review: an Enter that ends an IME composition
     picks a word, it does not ask. Both spellings — the flag and keyCode 229.
     docs/project/keyboard.md § Enter in a text box. */
  it("asks nothing on the Enter that ends an IME composition", async () => {
    await mount({ access: owner(), runs: [], start: "quick", active: [] });
    type("日本語の");
    const flagged = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true });
    const legacy = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      keyCode: 229,
    } as KeyboardEventInit);
    act(() => {
      input().dispatchEvent(flagged);
      input().dispatchEvent(legacy);
    });
    expect(asked).toEqual([]);
    expect(flagged.defaultPrevented).toBe(false);
    expect(legacy.defaultPrevented).toBe(false);
  });

  it("keeps the draft between quick and meaning, and carries it to words and back", async () => {
    await mount({ access: owner(), runs: [], start: "meaning", active: [] });
    type("where the controls are");
    act(() => radio("quick").click());
    expect(input().value).toBe("where the controls are");
    act(() => radio("words").click());
    expect(input().value).toBe("where the controls are");
    act(() => radio("quick").click());
    expect(input().value).toBe("where the controls are");
  });

  it("shows the saved list in quick mode as well as meaning", async () => {
    await mount({ access: owner(), runs: [QUICK, MEANING], start: "quick", active: [] });
    expect(container.querySelectorAll(".srch-saved-row")).toHaveLength(2);
  });
});

/** F5: the same words as a different kind are a different question. */
describe("the already-searching guard", () => {
  const pendingQuick: SavedSearch = { ...QUICK, status: "pending" };

  it("refuses the same words as the same kind while it is out", async () => {
    await mount({
      access: owner(new Set([pendingQuick.id])),
      runs: [pendingQuick],
      start: "quick",
      active: [],
    });
    type(pendingQuick.criterion);
    expect(findButton().disabled).toBe(true);
  });

  it("lets a meaning search for the same words go while the quick one is out", async () => {
    await mount({
      access: owner(new Set([pendingQuick.id])),
      runs: [pendingQuick],
      start: "meaning",
      active: [],
    });
    type(pendingQuick.criterion);
    expect(findButton().disabled).toBe(false);
    act(() => findButton().click());
    expect(asked).toEqual([[pendingQuick.criterion, "meaning"]]);
  });
});

describe("a quick row", () => {
  it("says quick, and a meaning row does not", async () => {
    await mount({ access: owner(), runs: [QUICK, MEANING], start: "meaning", active: [] });
    const rows = [...container.querySelectorAll(".srch-saved-row")];
    expect(rows[0]?.querySelector(".srch-saved-kind")?.textContent?.trim()).toBe("quick");
    expect(rows[1]?.querySelector(".srch-saved-kind")).toBeNull();
  });

  /* What the owner of the rows does with that source id — delete the quick
     row, hand on its colour and its tick — is tests/search-as-you-type.test.tsx
     § thorough replaces the quick row. The panel only says which row. */
  it("offers its owner thorough, which asks the same words as meaning and names the row it replaces", async () => {
    const access = owner();
    const sources: (string | undefined)[] = [];
    if (access.kind === "owner") {
      const ask = access.onAsk;
      access.onAsk = (criterion, kind, sourceId) => {
        sources.push(sourceId);
        ask(criterion, kind);
      };
    }
    await mount({ access, runs: [QUICK, MEANING], start: "meaning", active: [QUICK.id] });
    const buttons = container.querySelectorAll("button.srch-thorough");
    expect(buttons, "only on the quick row").toHaveLength(1);
    expect(thorough()?.textContent).toBe("thorough");
    expect(thorough()?.title).toContain("replaces this quick search");
    expect(container.textContent?.toLowerCase()).not.toContain("flesh");
    act(() => thorough()?.click());
    expect(asked).toEqual([[QUICK.criterion, "meaning"]]);
    expect(sources).toEqual([QUICK.id]);
    expect(toggled, "the tick is the row owner's to move, with the delete").toEqual([]);
  });

  /** Greg's `spya-fwcwun`: the colour key, on a row that is not ticked as much as on one that is. */
  it("shows each row's colour as a swatch beside its words, ticked or not, and not as a control", async () => {
    await mount({ access: owner(), runs: [QUICK, MEANING], start: "meaning", active: [QUICK.id] });
    const slots = assignSlots([QUICK, MEANING]);
    const rows = [...container.querySelectorAll<HTMLElement>(".srch-saved-row")];
    expect(rows).toHaveLength(2);
    for (const [i, run] of [QUICK, MEANING].entries()) {
      const swatches = rows[i]!.querySelectorAll(".srch-saved-swatch");
      expect(swatches).toHaveLength(1);
      const swatch = swatches[0]!;
      expect(swatch.closest("button")?.className).toBe("srch-saved-body");
      expect(swatch.tagName).toBe("SPAN");
      expect(swatch.getAttribute("aria-hidden")).toBe("true");
      // The colour is the row's, which the swatch and the edge both read.
      expect(rows[i]!.getAttribute("style")).toContain(`var(--cat-${slots.get(run.id)}-rgb)`);
      // The box is still its own target, outside the button.
      expect(rows[i]!.querySelector(".srch-saved-tick")?.contains(swatch)).toBe(false);
    }
    const css = readerCssNoComments();
    const rule = (selector: string) =>
      new RegExp(`(?:^|})\\s*${selector.replace(".", "\\.")}\\s*{([^}]*)}`).exec(css)?.[1] ?? "";
    // Full strength, with the neutral fallback, and no rule that waits for the tick.
    expect(rule(".srch-saved-swatch")).toContain("background: rgb(var(--cat-rgb, var(--hit-wash-rgb)))");
    expect(rule(".srch-saved-row")).toContain("border-left: 2px solid rgb(var(--cat-rgb, var(--hit-wash-rgb)))");
    expect(css).not.toMatch(/\.srch-saved-row\.on\s*{[^}]*border/);
  });

  it("offers no thorough while that meaning search is already out", async () => {
    const already: SavedSearch = {
      ...MEANING,
      id: "spya-mean3c",
      criterion: QUICK.criterion,
      status: "pending",
    };
    await mount({
      access: owner(new Set([already.id])),
      runs: [QUICK, already],
      start: "meaning",
      active: [],
    });
    expect(thorough()?.disabled).toBe(true);
    act(() => thorough()?.click());
    expect(asked).toEqual([]);
  });

  it("offers no thorough until it has finished", async () => {
    await mount({
      access: owner(),
      runs: [{ ...QUICK, status: "pending" }],
      start: "quick",
      active: [],
    });
    expect(thorough()).toBeNull();
  });

  /** F6: a visitor sees the tag and the hits, and nothing that asks. */
  it("shows a visitor the tag and no thorough", async () => {
    await mount({ access: { kind: "visitor" }, runs: [QUICK], start: "meaning", active: [QUICK.id], found: [HIT] });
    expect(container.querySelector(".srch-saved-kind")?.textContent?.trim()).toBe("quick");
    expect(thorough()).toBeNull();
    expect(container.querySelectorAll(".srch-hit")).toHaveLength(1);
  });
});

/** F9: a quick score says what it is, on the result itself. */
describe("a quick hit's score", () => {
  it("is named as a quick score, not as the model's confidence", async () => {
    await mount({ access: owner(), runs: [QUICK], start: "quick", active: [QUICK.id], found: [HIT] });
    const gutter = container.querySelector<HTMLButtonElement>(".srch-hit .srch-gutter");
    const label = gutter?.getAttribute("aria-label") ?? "";
    expect(label).toContain("quick score 93 out of 100");
    expect(label).toContain("how sure the fast model is");
    expect(label).not.toContain("the model's confidence");
  });

  it("is explained as a quick score in its card", async () => {
    await mount({ access: owner(), runs: [QUICK], start: "quick", active: [QUICK.id], found: [HIT] });
    const gutter = container.querySelector<HTMLButtonElement>(".srch-hit .srch-gutter");
    await act(async () => {
      gutter?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    const card = document.querySelector(".tooltip.tip-hit")?.textContent ?? "";
    expect(card).toContain("Quick score 93 out of 100");
    expect(card).toContain("fast model");
    expect(card).not.toContain("how strongly the model thinks");
  });
});

/**
 * **The cross that empties the panel's own box** — plan 261005i, Part B. Greg,
 * 2026-10-04: *"Q-panel-box-cross yes"*. Escape's clear on every device, a
 * phone having no Escape, with the cursor left in the box for the next words.
 */
describe("the box's clear cross", () => {
  const cross = () => container.querySelector<HTMLButtonElement>("button.srch-clear");
  const press = (el: HTMLElement): MouseEvent => {
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(down);
      el.click();
    });
    return down;
  };
  /** An owner whose quick box types into a session, as the band's does. */
  function typingOwner(): { access: SearchAccess; edits: string[] } {
    const edits: string[] = [];
    const typing = {
      edit: (text: string) => {
        edits.push(text);
      },
      flush: () => {},
      end: () => {},
      blur: () => {},
      focus: () => {},
    };
    return { access: { ...owner(), typing } as SearchAccess, edits };
  }

  it.each(["words", "quick", "meaning"] as const)("is there only while the %s box has words in it", async (start) => {
    await mount({ access: owner(), runs: [], start, active: [] });
    expect(cross()).toBeNull();
    type("free will");
    expect(cross()?.getAttribute("aria-label")).toBe("Clear the search");
    type("");
    expect(cross()).toBeNull();
  });

  it("empties the quick draft, tells the session, and leaves the cursor in the box", async () => {
    const { access, edits } = typingOwner();
    await mount({ access, runs: [], start: "quick", active: [] });
    type("free will");
    act(() => input().blur());
    const down = press(cross() as HTMLButtonElement);
    expect(down.defaultPrevented, "the press took the focus off the input first").toBe(true);
    expect(input().value).toBe("");
    expect(edits.at(-1)).toBe("");
    expect(document.activeElement).toBe(input());
    expect(cross()).toBeNull();
    expect(asked, "clearing asked something").toEqual([]);
  });

  it("clears the words search", async () => {
    await mount({ access: owner(), runs: [], start: "words", active: [] });
    type("free will");
    act(() => input().blur());
    press(cross() as HTMLButtonElement);
    expect(input().value).toBe("");
    expect(document.activeElement).toBe(input());
    // Nothing was carried across: the other matchers' draft is empty too.
    act(() => radio("meaning").click());
    expect(input().value).toBe("");
  });

  it("is what Escape does", async () => {
    const { access, edits } = typingOwner();
    await mount({ access, runs: [], start: "quick", active: [] });
    type("free will");
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(input().value).toBe("");
    expect(edits.at(-1)).toBe("");
    expect(cross()).toBeNull();
  });

  /* GPT Sol's F5 on the plan: the matcher buttons sit 0.4rem under the field,
     and this field clips nothing, so the finger target is the field's height
     and no taller — wider, not deeper. */
  it("has a finger target no taller than the field, and keeps words and spinner clear of it", () => {
    const css = readerCssNoComments();
    const target = /@media \(any-pointer: coarse\)\s*{\s*\.srch-clear::after\s*{([^}]*)}/.exec(css)?.[1] ?? "";
    expect(target).toMatch(/inset:\s*0 /);
    expect(css).toMatch(/\.srch-field--filled \.srch-input\s*{[^}]*padding-right/);
    expect(css).toMatch(/\.srch-field--filled \.srch-spin\s*{[^}]*right/);
    // The same specificity as the spinner's own place, so it has to come after it to win.
    expect(css.indexOf(".srch-field--filled .srch-spin")).toBeGreaterThan(css.indexOf(".srch-field .srch-spin"));
    // Not the browser's cross beside ours.
    expect(css).toMatch(/\.srch-input::-webkit-search-cancel-button\s*{\s*display: none/);
  });
});
