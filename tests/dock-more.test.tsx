// @vitest-environment jsdom
/**
 * **The More button: five lesser modes leave the bar for a menu** — Quotes,
 * Glossary, FAQ, Ideas and Timeline (Greg, 2026-10-06, spya-dest8x).
 * docs/plans/261007c-bottom-bar-rises-in-on-first-load-and-a-more-button-gathers-the-lesser-modes.md.
 *
 * Three things are held here, and each has a way to go quietly wrong:
 *
 * - **the split** — which reachable rows the bar draws and which the menu
 *   holds. The menu's contents must not shuffle when a gathered mode opens, and
 *   the open one must still be drawn, or the radiogroup has nothing checked;
 * - **the two arms** — a pick opens a mode on the reading view and is a link
 *   off it, as the bar's own buttons are;
 * - **the overlays** — the menu is portalled out of `.dock`, so the drawer's
 *   Escape, the button's tooltip and the phone's hide-on-scroll guard each have
 *   to be told about it (GPT Sol's PR-2, PR-3 and PR-4).
 */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_CATALOG } from "../src/mode-catalog.js";
import type { Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { PublicArtefacts } from "../src/types.js";
import { Dock, fitSignature, MORE_OPEN, modeLinkHref, splitForMore, visibleModes } from "../src/web/Dock.js";
import type { Panel } from "../src/web/params.js";
import { DELAY } from "../src/web/Tooltip.js";
import { markedModes } from "../src/web/visitor.js";
import {
  closeMore,
  itemLabel,
  moreItems,
  moreMenu,
  moreTrigger,
  openMore,
  pressModeByLabel,
  reachableModeLabels,
} from "./helpers/dock-more.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON, EXPERIMENTAL_SIGNED_OUT } from "./helpers/experimental-fixtures.js";

/** The five, by name and in the bar's order: an independent copy of D2. */
const GATHERED: readonly Mode[] = ["quotes", "glossary", "faq", "ideas", "timeline"];

const names = (rows: readonly { mode: Mode }[]) => rows.map((m) => m.mode);

describe("splitForMore: what the bar draws and what the menu holds", () => {
  it("with the switch off, gathers Quotes, Glossary and Ideas", () => {
    const bar = splitForMore(visibleModes(false, "plain"), "plain");
    expect(names(bar.drawn)).toEqual([
      "plain",
      "structure",
      "summary",
      "skim",
      "sources",
      "search",
      "chat",
      "learn",
      "marginalia",
    ]);
    expect(names(bar.menu)).toEqual(["quotes", "glossary", "ideas"]);
  });

  it("with the switch on, gathers all five in the bar's order", () => {
    const bar = splitForMore(visibleModes(true, "plain"), "plain");
    expect(names(bar.drawn)).toEqual([
      "plain",
      "structure",
      "summary",
      "diagram",
      "skim",
      "referee",
      "sources",
      "search",
      "chat",
      "learn",
      "marginalia",
    ]);
    expect(names(bar.menu)).toEqual(GATHERED);
  });

  it("draws a gathered mode while it is open, and leaves the menu as it was", () => {
    const closed = splitForMore(visibleModes(false, "plain"), "plain");
    const open = splitForMore(visibleModes(false, "glossary"), "glossary");
    expect(names(open.drawn)).toEqual([
      "plain",
      "structure",
      "summary",
      "skim",
      "glossary",
      "sources",
      "search",
      "chat",
      "learn",
      "marginalia",
    ]);
    expect(names(open.menu)).toEqual(names(closed.menu));
  });

  it("a gathered experimental mode reached by URL joins the menu and is drawn", () => {
    /* `visibleModes` rule 2 keeps Timeline for a reader in it with the switch
       off; it is `more`, so it is in the menu, and current, so it is drawn. */
    const bar = splitForMore(visibleModes(false, "timeline"), "timeline");
    expect(names(bar.menu)).toEqual(["quotes", "glossary", "ideas", "timeline"]);
    expect(names(bar.drawn)).toContain("timeline");
    expect(names(bar.drawn)).not.toContain("quotes");
  });

  it("is unmoved by Marginalia's column being on", () => {
    const off = splitForMore(visibleModes(false, "plain", false), "plain");
    const on = splitForMore(visibleModes(false, "plain", true), "plain");
    expect(names(on.drawn)).toEqual(names(off.drawn));
    expect(names(on.menu)).toEqual(names(off.menu));
  });

  it("loses nothing: drawn and menu together are exactly the reachable set", () => {
    for (const on of [false, true]) {
      for (const current of ["plain", "glossary", "timeline", "referee"] as const) {
        const reachable = visibleModes(on, current);
        const bar = splitForMore(reachable, current);
        expect(new Set([...names(bar.drawn), ...names(bar.menu)])).toEqual(new Set(names(reachable)));
      }
    }
  });

  it("holds an empty menu when nothing reachable is gathered", () => {
    const none = visibleModes(false, "plain").filter((m) => !GATHERED.includes(m.mode));
    expect(splitForMore(none, "plain").menu).toEqual([]);
  });
});

/* ---------------------------------------------------------------- harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the two arms of the bar differ by which props are present, the same cast tests/dock-experimental-modes.test.tsx makes
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

function loose(search = "", props: Record<string, unknown> = {}): void {
  history.replaceState(null, "", `/read/a-piece/metadata${search}`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, {
        slug: "a-piece",
        view: "metadata",
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

const radioLabels = () =>
  [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"]')].map((b) => b.getAttribute("aria-label"));

const labelsOf = (modes: readonly Mode[]) => modes.map((m) => MODE_LABEL[m]);

describe("the More button on the reading view", () => {
  it("replaces the gathered modes' radios", () => {
    reading();
    expect(moreTrigger(host), "no More button").not.toBeNull();
    for (const mode of ["quotes", "glossary", "ideas"] as const) {
      expect(radioLabels()).not.toContain(MODE_LABEL[mode]);
    }
    expect(radioLabels()).toEqual(labelsOf(["plain", "structure", "summary", "skim", "sources", "search", "chat", "learn"]));
  });

  it("is a menu button named More, with the word and an icon", () => {
    reading();
    const more = moreTrigger(host) as HTMLButtonElement;
    expect(more.tagName).toBe("BUTTON");
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-label")).toBe("More");
    expect(more.querySelector(".dock-btn-label")?.textContent).toBe("More");
    expect(more.querySelector("svg")).not.toBeNull();
    /* A `.dock-btn`, so every rung of the fit ladder and the coarse-pointer
       floor treat it as they treat its neighbours. */
    expect(more.classList.contains("dock-btn")).toBe(true);
    expect(more.hasAttribute("title")).toBe(false);
  });

  /* Its own frame, between the radiogroup and Marginalia's, from 2026-10-07;
     straight after Skim inside the bands' frame since 2026-10-08, Greg:
     *"just after the skim mode … as part of that group, rather than out on
     their own"* (plan 261008d; tests/dock-groups.test.tsx has the frames). */
  it("is not a radio, and stands in the bands' frame straight after Skim", () => {
    reading();
    const more = moreTrigger(host) as HTMLButtonElement;
    expect(more.getAttribute("role")).toBeNull();
    expect(more.hasAttribute("aria-checked")).toBe(false);
    expect(more.hasAttribute("data-mode")).toBe(false);
    const frame = more.closest(".dock-frame") as HTMLElement;
    const buttons = [...frame.querySelectorAll<HTMLElement>(".dock-btn")];
    const at = buttons.indexOf(more);
    expect(buttons[at - 1]?.getAttribute("aria-label")).toBe(MODE_LABEL.skim);
    expect(buttons[at + 1]?.getAttribute("aria-label")).toBe(MODE_LABEL.sources);
  });

  it("opens a menu of exactly the gathered modes this reader has, in order", () => {
    reading();
    openMore(host);
    expect(moreItems().map(itemLabel)).toEqual(labelsOf(["quotes", "glossary", "ideas"]));
    closeMore();
    reading({ experimental: EXPERIMENTAL_ON });
    openMore(host);
    expect(moreItems().map(itemLabel)).toEqual(labelsOf(GATHERED));
  });

  it("portals the menu out of the bar, which clips, and opens it upwards", () => {
    reading();
    const menu = openMore(host);
    expect(host.contains(menu)).toBe(false);
    expect(menu.getAttribute("data-side")).toBe("top");
  });

  it("a pick opens the mode through the command bar's door: it never toggles", () => {
    const onMode = vi.fn();
    reading({ onMode });
    expect(pressModeByLabel(host, MODE_LABEL.glossary)).toBe("more");
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode).toHaveBeenCalledWith("glossary", undefined, false);
    expect(moreMenu(), "a pick shuts the menu").toBeNull();
  });

  it("picking the gathered mode you are in leaves you in it", () => {
    const onMode = vi.fn();
    reading({ onMode, mode: "glossary" });
    openMore(host);
    const item = moreItems().find((el) => itemLabel(el) === MODE_LABEL.glossary) as HTMLElement;
    act(() => item.click());
    /* `toggle` false: Reader's `modePress` closes a band only for a toggling
       press, which is the bar button's, not this. */
    expect(onMode).toHaveBeenCalledWith("glossary", undefined, false);
  });

  it("draws the open gathered mode in the bar, checked, and marks it in an unshuffled menu", () => {
    reading({ mode: "glossary" });
    expect(radioLabels()).toEqual(
      labelsOf(["plain", "structure", "summary", "skim", "glossary", "sources", "search", "chat", "learn"]),
    );
    const checked = [...host.querySelectorAll('.dock-modes [aria-checked="true"]')];
    expect(checked.map((b) => b.getAttribute("aria-label"))).toEqual([MODE_LABEL.glossary]);
    openMore(host);
    expect(moreItems().map(itemLabel)).toEqual(labelsOf(["quotes", "glossary", "ideas"]));
    expect(moreItems().filter((el) => el.getAttribute("aria-current") === "true").map(itemLabel)).toEqual([
      MODE_LABEL.glossary,
    ]);
  });

  it("the open gathered mode's bar button still closes on a second press", () => {
    const onMode = vi.fn();
    reading({ onMode, mode: "glossary" });
    expect(pressModeByLabel(host, MODE_LABEL.glossary)).toBe("bar");
    expect(onMode).toHaveBeenCalledWith("glossary", undefined, true);
  });

  it("offers every mode it offered before, directly or under More", () => {
    for (const experimental of [EXPERIMENTAL_OFF, EXPERIMENTAL_ON]) {
      reading({ experimental });
      expect(new Set(reachableModeLabels(host))).toEqual(
        new Set(visibleModes(experimental.on, "plain").map((m) => MODE_LABEL[m.mode])),
      );
    }
  });

  it("counts More as a button in the shares a coarse pointer spreads the row by", () => {
    reading();
    const modes = host.querySelector<HTMLElement>(".dock-modes") as HTMLElement;
    /* 8 radios (Sources since 2026-10-09) + More + Marginalia + Comments (in Marginalia's frame since
       2026-10-08). It was the reachable count, 11, before 2026-10-07. */
    expect(modes.style.getPropertyValue("--dock-mode-count")).toBe("11");
    /* More is inside the radiogroup and the bands' frame since 2026-10-08. */
    expect(
      (host.querySelector(".dock-modes-radios") as HTMLElement).style.getPropertyValue("--dock-radio-count"),
    ).toBe("9");
    const frame = (moreTrigger(host) as HTMLElement).closest(".dock-frame") as HTMLElement;
    /* Structure, Summary, Skim, More, Sources, Search, Chat, Learn. */
    expect(frame.style.getPropertyValue("--dock-frame-count")).toBe("8");
  });
});

describe("fitSignature reads the drawn list", () => {
  const sig = (current: "plain" | "glossary", bar = splitForMore(visibleModes(false, current), current)) =>
    fitSignature(bar, current, () => {}, undefined, null, null, false);

  it("names the drawn modes and More, not the gathered ones", () => {
    const modes = sig("plain").split("|")[0];
    expect(modes).toBe("plain,structure,summary,skim,sources,search,chat,learn,marginalia,+more");
  });

  it("moves when a gathered mode opens and takes a place in the bar", () => {
    expect(sig("glossary")).not.toBe(sig("plain"));
    expect(sig("glossary").split("|")[0]).toContain("glossary");
  });

  it("moves when the More button itself comes or goes", () => {
    const withMore = splitForMore(visibleModes(false, "plain"), "plain");
    expect(sig("plain", { drawn: withMore.drawn, menu: [] })).not.toBe(sig("plain", withMore));
  });
});

/* -------------------------------------------------------- the links arm -- */

describe("the More button off the reading view", () => {
  it("is drawn in the same place, with no gathered link beside it", () => {
    loose();
    const more = moreTrigger(host) as HTMLButtonElement;
    expect(more).not.toBeNull();
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    const links = [...host.querySelectorAll(".dock-modes a[data-mode]")].map((a) => a.getAttribute("aria-label"));
    expect(links).toEqual(
      labelsOf(["plain", "structure", "summary", "skim", "sources", "search", "chat", "learn", "marginalia"]),
    );
    /* In the bands' frame, straight after Skim, as on the reading view. */
    const frame = more.closest(".dock-frame") as HTMLElement;
    const inFrame = [...frame.querySelectorAll<HTMLElement>(".dock-btn")];
    expect(inFrame[inFrame.indexOf(more) - 1]?.getAttribute("aria-label")).toBe(MODE_LABEL.skim);
  });

  it("its items are the links the bar used to draw", () => {
    loose("?at=spya-abc123");
    openMore(host);
    const items = moreItems();
    expect(items.map(itemLabel)).toEqual(labelsOf(["quotes", "glossary", "ideas"]));
    for (const [i, mode] of (["quotes", "glossary", "ideas"] as const).entries()) {
      const item = items[i] as HTMLElement;
      expect(item.tagName, `${mode} is not a real anchor`).toBe("A");
      expect(item.getAttribute("href")).toBe(modeLinkHref("a-piece", "at=spya-abc123", mode));
      expect(item.getAttribute("href")).toContain(`mode=${mode}`);
    }
  });

  it("draws the gathered mode the reader came from as a link, and says nothing is selected", () => {
    loose("?mode=ideas");
    const links = [...host.querySelectorAll(".dock-modes a[data-mode]")].map((a) => a.getAttribute("aria-label"));
    expect(links).toContain(MODE_LABEL.ideas);
    openMore(host);
    /* No mode is open on this page, so no item may claim to be the current one. */
    expect(moreItems().filter((el) => el.hasAttribute("aria-current"))).toEqual([]);
  });
});

/* ------------------------------------------------- a visitor's marked modes -- */

const NOTHING_SHARED: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
  timeline: false,
  sketch: false,
  skim: false,
  faq: false,
  simpleSummary: false,
  citations: false,
  debate: false,
};

describe("what an item under More says", () => {
  /* An item has no hover card, and these five had one as bar buttons. What
     the mode is goes in the item instead; tests/dock-mode-tooltips.test.tsx
     holds that each still has its full card as the open mode's bar button. */
  it("names the mode and says what it is, in the catalog's own words", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openMore(host);
    const items = moreItems();
    expect(items).toHaveLength(GATHERED.length);
    for (const [i, mode] of GATHERED.entries()) {
      expect(items[i]?.textContent).toBe(`${MODE_LABEL[mode]}${MODE_CATALOG[mode].description}`);
      expect(items[i]?.querySelector("svg"), `${mode} has its icon`).not.toBeNull();
      expect(items[i]?.hasAttribute("title")).toBe(false);
    }
  });

  it("keeps every described item reachable when the viewport is shorter than the menu", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    const menu = openMore(host);
    /* Five descriptions can make the list taller than a landscape phone. Radix
       publishes the collision-aware room on this variable; the content must
       consume it and scroll rather than placing an item outside the viewport. */
    expect(menu.classList.contains("tw:max-h-[var(--radix-dropdown-menu-content-available-height)]")).toBe(true);
    expect(menu.classList.contains("tw:overflow-y-auto")).toBe(true);
  });
});

describe("a mode a visitor cannot use, under More", () => {
  const marked = markedModes(NOTHING_SHARED);

  for (const arm of ["reading", "links"] as const) {
    it(`keeps its dimming and its sentence in the menu (${arm} arm)`, () => {
      const props = { experimental: EXPERIMENTAL_SIGNED_OUT, visitor: true, marked };
      if (arm === "reading") reading(props);
      else loose("", props);
      openMore(host);
      const glossary = moreItems().find((el) => itemLabel(el) === MODE_LABEL.glossary) as HTMLElement;
      expect(marked.get("glossary"), "the fixture marks Glossary").toBeTruthy();
      expect(glossary.classList.contains("tw:opacity-55")).toBe(true);
      expect(glossary.textContent).toContain(marked.get("glossary"));
      /* The sentence first, then what the mode is — the order a bar button's
         card gives them. */
      expect(glossary.textContent).toBe(
        `${MODE_LABEL.glossary}${marked.get("glossary")}${MODE_CATALOG.glossary.description}`,
      );
      /* Not disabled: it still opens the band that explains itself (`MARKED`). */
      expect(glossary.hasAttribute("data-disabled")).toBe(false);
    });
  }

  it("an unmarked item is not dimmed and carries no sentence", () => {
    reading();
    openMore(host);
    const glossary = moreItems().find((el) => itemLabel(el) === MODE_LABEL.glossary) as HTMLElement;
    expect(glossary.classList.contains("tw:opacity-55")).toBe(false);
    expect(glossary.textContent).toBe(`${MODE_LABEL.glossary}${MODE_CATALOG.glossary.description}`);
  });
});

/* ------------------------------------------------ PR-2: Escape and the drawer -- */

function DrawerHarness() {
  const [panel, setPanel] = useState<Panel | null>("questions");
  return (
    <Dock
      slug="a-piece"
      view="article"
      mode="plain"
      onMode={() => {}}
      experimental={EXPERIMENTAL_OFF}
      drawer={{
        comments: [],
        paragraphs: new Map(),
        loaded: true,
        loadError: null,
        error: null,
        panel,
        onPanel: setPanel,
        onOpenComment: () => {},
      }}
    />
  );
}

/** A real key press: it targets the focused element and travels through `window`. */
function pressEscape(): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
}

describe("More over an open Comments drawer", () => {
  it("the first Escape closes the menu and returns focus to More; the second closes the drawer", async () => {
    act(() => {
      root.render(
        <StrictMode>
          <DrawerHarness />
        </StrictMode>,
      );
    });
    expect(host.querySelector(".dock-drawer"), "the drawer opens").not.toBeNull();
    const menu = openMore(host);
    expect(menu.contains(document.activeElement), "focus moved into the menu").toBe(true);

    pressEscape();
    expect(moreMenu(), "the first Escape closes the menu").toBeNull();
    expect(host.querySelector(".dock-drawer"), "and leaves the drawer open").not.toBeNull();
    /* Radix hands focus back from a zero-delay timer as its focus scope
       unmounts, so the trigger has it one task later. */
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(moreTrigger(host));

    pressEscape();
    expect(host.querySelector(".dock-drawer"), "the second Escape closes the drawer").toBeNull();
  });
});

/* --------------------------------------------- where focus goes after a pick -- */

describe("after a pick from More", () => {
  const tick = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const glossaryItem = () => moreItems().find((el) => itemLabel(el) === MODE_LABEL.glossary) as HTMLElement;

  /* Every mode button blurs itself after a real click so the arrows go back to
     the article (Greg, 2026-08-26). A menu hands focus to its trigger when it
     closes, and a focused More takes ↓ to open the menu again — so a mouse
     pick must not leave focus there. */
  it("a mouse pick leaves the keyboard to the article, not on More", async () => {
    reading();
    openMore(host);
    act(() => {
      glossaryItem().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    await tick();
    expect(moreMenu()).toBeNull();
    expect(document.activeElement).not.toBe(moreTrigger(host));
    expect(host.contains(document.activeElement)).toBe(false);
  });

  it("a keyboard pick returns focus to More, where the reader put it", async () => {
    reading();
    openMore(host);
    act(() => {
      /* Enter and Space reach an item as a click with `detail` 0. */
      glossaryItem().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    });
    await tick();
    expect(moreMenu()).toBeNull();
    expect(document.activeElement).toBe(moreTrigger(host));
  });
});

describe("the menu does not make the bar modal", () => {
  it("leaves the rest of the page pressable while it is open", () => {
    reading();
    openMore(host);
    /* A modal Radix menu sets `pointer-events: none` on `body` and hides its
       siblings from assistive technology. */
    expect(document.body.style.pointerEvents).not.toBe("none");
    expect(host.getAttribute("aria-hidden")).toBeNull();
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
  });

  it("a second press on More closes it", () => {
    reading();
    openMore(host);
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(down, "pointerType", { value: "mouse" });
    act(() => {
      (moreTrigger(host) as HTMLElement).dispatchEvent(down);
    });
    expect(moreMenu()).toBeNull();
  });

  it("a finger opens it at the click, not at the press that might be a scroll of the bar", () => {
    reading();
    const trigger = moreTrigger(host) as HTMLElement;
    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    act(() => {
      trigger.dispatchEvent(down);
    });
    expect(moreMenu(), "the press alone opened it").toBeNull();
    act(() => {
      trigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(moreMenu(), "the tap did not open it").not.toBeNull();
  });
});

/* -------------------------------------------- PR-3: the tooltip and the menu -- */

describe("More's tooltip card", () => {
  async function hover(el: Element): Promise<void> {
    vi.useFakeTimers();
    el.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      vi.advanceTimersByTime(Math.max(DELAY.open, 300));
    });
  }

  it("says what is under it", async () => {
    reading();
    await hover(moreTrigger(host) as HTMLElement);
    const card = document.querySelector('[role="tooltip"]');
    expect(card, "hovering More opened no card").not.toBeNull();
    expect(card?.querySelector(".tip-soon-head")?.textContent).toBe("More");
    for (const mode of ["quotes", "glossary", "ideas"] as const) {
      expect(card?.textContent).toContain(MODE_LABEL[mode]);
    }
    expect(card?.textContent).not.toContain(MODE_LABEL.timeline);
  });

  it("is shut while the menu is open, with the pointer still on the button", async () => {
    reading();
    await hover(moreTrigger(host) as HTMLElement);
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    openMore(host);
    expect(moreMenu()).not.toBeNull();
    /* The pointer has not left the button: nothing below is a `mouseleave`.
       What is left of the card is its 80ms closing fade. */
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(document.querySelector('[role="tooltip"]'), "the card sits over the open menu").toBeNull();
  });
});

/* ------------------------------------------------- PR-4: the phone's guard -- */

describe("an open More menu holds the bar home on a phone", () => {
  it("the trigger carries the state the stylesheet's guard reads", () => {
    reading();
    expect(moreTrigger(host)?.getAttribute("data-state")).toBe("closed");
    expect(document.querySelector(MORE_OPEN)).toBeNull();
    openMore(host);
    expect(moreTrigger(host)?.getAttribute("data-state")).toBe("open");
    expect(document.querySelector(MORE_OPEN)).toBe(moreTrigger(host));
    /* **One spelling in three places**: the constant the drawer's Escape
       handler asks, this literal, and the guard in narrow-window.css — where
       tests/the-dock-hides-in-a-mode-beside-the-article.test.ts checks it is
       an argument of the right rule rather than merely present in the file. */
    expect(MORE_OPEN).toBe('.dock-more-trigger[data-state="open"]');
    const css = readFileSync("src/web/styles/narrow-window.css", "utf8");
    expect(css).toContain(`    ${MORE_OPEN},\n`);
  });
});
