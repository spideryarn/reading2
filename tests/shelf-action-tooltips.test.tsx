// @vitest-environment jsdom
/**
 * **Every button on a shelf card explains itself, including the ones that
 * cannot do anything.**
 *
 * Greg, 2026-09-05: *"there are a few icons that show up on hover, e.g. what
 * looks like edit title, open original, archive... Add rich tooltips for each
 * (sometimes I see them, sometimes I don't). And if some actions are not
 * available, perhaps show them but disabled with a tooltip explaining why."*
 *
 * The parenthesis is the interesting half and it is what most of this file is
 * about. Two of the five buttons used to be drawn only for an article with a
 * usable source URL, so the row was five icons wide on one card and three on
 * the next — docs/plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md.
 *
 * ## What this pins, and what it deliberately does not
 *
 * **Not the wording**, for the reason tests/referee-tooltips.test.tsx gives at
 * length: it is copy, it will be edited, and a test spelling it out is a second
 * copy to keep in step. What has to hold is structural.
 *
 *  - **The row is always five controls**, whatever the entry looks like. This
 *    is the regression that would be invisible in a screenshot of the one card
 *    the author happened to be looking at.
 *  - **A control that cannot act is `aria-disabled` and not `disabled`.** A
 *    natively disabled button dispatches no mouse events and is out of the tab
 *    order, so the card explaining why it is unavailable would be the one card
 *    in the app that could never be opened. That is not a detail — it is the
 *    entire feature, so it is asserted directly rather than left to the card
 *    check to imply.
 *  - **No `title` attribute has crept back in.** The regression that is
 *    invisible on a laptop, because a `title` still shows *something*.
 *  - **Each card is that control's**, and says more than the label does.
 *
 * The hover mechanics — a native `mouseenter` to open, both leave events and
 * two `act` blocks to close — are lifted wholesale from
 * tests/referee-tooltips.test.tsx, which measured them. docs/project/tooltips.md
 * § Three things about testing a card in jsdom.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryEntry } from "../src/types.js";
import { Actions, type Shelf } from "../src/web/ShelfEntry.js";

/* --------------------------------------------------------------- fixtures -- */

const BASE: LibraryEntry = {
  slug: "a-piece",
  title: "A piece",
  addedAt: "2026-09-01T00:00:00.000Z",
  words: 1200,
  minutes: 6,
  blocks: 40,
  parts: 2,
  sections: 5,
  comments: 0,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false },
};

/** Fetched from the web: everything is available. */
const FETCHED: LibraryEntry = { ...BASE, url: "https://example.com/piece" };

/** No address recorded — for whatever reason; the cards deliberately do not guess. */
const NO_URL: LibraryEntry = { ...BASE };

/** Shared with the world, which changes what Copy link may claim. */
const SHARED: LibraryEntry = { ...FETCHED, visibility: "public" };

/**
 * The rare one the `isWebUrl` gate exists for: imported metadata is written
 * into the row as given, so a non-web scheme is reachable. src/urls.ts.
 */
const NOT_WEB: LibraryEntry = { ...BASE, url: "javascript:alert(1)" };

/**
 * Enough of the shelf hook for a row of buttons.
 *
 * A cast rather than a full stub: `Shelf` is fifteen fields and this component
 * reaches for three of them, so writing the other twelve would be twelve more
 * things to keep in step with a hook this file is not testing.
 */
function stubShelf(): Shelf {
  return {
    archive: vi.fn(async () => {}),
    report: vi.fn(),
    renaming: null,
  } as unknown as Shelf;
}

/* ---------------------------------------------------------------- harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(entry: LibraryEntry, shelf: Shelf = stubShelf()): void {
  act(() => {
    root.render(createElement(Actions, { entry, shelf, onEdit: () => {} }));
  });
}

/** Every control in the row, in the order they are drawn. */
function controls(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("button, a")];
}

/** The one whose accessible name starts with this. */
function control(name: string): HTMLElement {
  const hit = controls().filter((el) => (el.getAttribute("aria-label") ?? "").startsWith(name));
  expect(hit, `no single control named ${name}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

/**
 * **Open one card and read it**, then shut it again — the shape and both of its
 * measured quirks come from tests/referee-tooltips.test.tsx.
 *
 * Exactly one card must be open: the panel is portalled to the end of `<body>`
 * rather than into `host`, so a neighbour's card left up would be read here as
 * this control's, which is precisely how a check like this passes with the card
 * attached to the wrong button.
 */
async function cardFor(el: Element): Promise<{ head: string; what: string; how: string }> {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering this control opened no card, or more than one").toHaveLength(1);
  const card = cards[0];
  const head = flat(card?.querySelector(".tip-soon-head")?.textContent);
  const paras = [...(card?.querySelectorAll("p") ?? [])].map((n) => flat(n.textContent));

  /* Both leave events, because opening and closing do not take the same one: a
     native `mouseleave` alone leaves the card up, and what closes it is React's
     synthetic `onMouseLeave`, synthesised from a *bubbling* `mouseout`. */
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  /* Two waits and not one long one: closing is two timers in series with a
     render between them, and inside a single `act` the queued update is not
     applied until the block exits. */
  for (const _ of [0, 1]) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  expect(
    document.querySelectorAll('[role="tooltip"]'),
    "the card did not close, so the next one read here would be this one",
  ).toHaveLength(0);
  return { head, what: paras[0] ?? "", how: paras[1] ?? "" };
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/* ------------------------------------------- does a card earn its hover ---- */

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can cannot did do does for from get gets go goes had has " +
    "have how i if in into is it its just may more most no not of off on once one only or other " +
    "our out over same so some than that the their them then there these they this those to under " +
    "until up was what when where which while who will with would you your yours"
  ).split(" "),
);

/** The content words of a sentence, in order, with the grammar thrown away. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/**
 * **Is one of these two the other one again?** The shorter's content words
 * appearing in order inside the longer, which fires on a real copy-paste.
 *
 * As in tests/referee-tooltips.test.tsx, this catches copying and not
 * paraphrase — nothing mechanical reads for meaning. Its value is that it makes
 * the cheapest way to fill a second paragraph fail.
 */
function restates(a: string, b: string): boolean {
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  if (short.length === 0) return true;
  let i = 0;
  for (const w of long) if (w === short[i]) i++;
  return i === short.length;
}

/* ------------------------------------------------------------------ tests -- */

describe("the shelf's action row", () => {
  it("draws five controls whatever the article is", () => {
    for (const entry of [FETCHED, NO_URL, NOT_WEB]) {
      render(entry);
      expect(controls(), `five controls for ${entry.url ?? "an article with no url"}`).toHaveLength(
        5,
      );
      act(() => root.render(null));
    }
  });

  it("carries no `title` attribute — the OS box would win the race with our card", () => {
    render(FETCHED);
    const titled = controls().filter((el) => el.hasAttribute("title"));
    expect(titled.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });

  it("names every control, so a screen reader gets what the card gives the pointer", () => {
    render(NO_URL);
    for (const el of controls()) expect(flat(el.getAttribute("aria-label"))).not.toBe("");
  });

  /**
   * **A name is not enough; it has to be the right name.** The first version
   * gave every unavailable Open button "(no address)", including the article
   * that has one of a scheme we will not follow — so the name contradicted the
   * card beside it, and a screen reader, which gets the name and may never
   * reach the description, was told the wrong thing. GPT Sol, 2026-09-05.
   */
  it("says which absence it is in the name, not just that there is one", () => {
    render(NO_URL);
    const missing = control("Open the original").getAttribute("aria-label") ?? "";
    act(() => root.render(null));

    render(NOT_WEB);
    const refused = control("Open the original").getAttribute("aria-label") ?? "";

    expect(refused).not.toBe(missing);
  });

  /**
   * The tooltip is the trigger's *description* (`useRole`), so the wiring has to
   * survive `IconButton` — a component that named its props and dropped the
   * rest would swallow `aria-describedby` and every focus handler, and the card
   * would still open under a mouse. That is the failure this asserts against:
   * it is checked on **focus**, which is the route that breaks silently.
   */
  it("wires the card up as the control's description, by keyboard as well", async () => {
    render(FETCHED);
    const el = control("Edit title");
    await act(async () => {
      el.focus();
      await new Promise((r) => setTimeout(r, 400));
    });
    const described = el.getAttribute("aria-describedby");
    expect(described, "focus did not open the card, or did not describe the button").toBeTruthy();
    expect(document.getElementById(described ?? "")).not.toBeNull();
    await act(async () => {
      el.blur();
      await new Promise((r) => setTimeout(r, 300));
    });
  });
});

describe("a control that cannot act", () => {
  /**
   * The load-bearing one. `disabled` would take the button out of the tab order
   * and stop it dispatching mouse events, so the card saying *why* could not be
   * opened by either route — see IconButton.tsx § `disabled`.
   *
   * **And it has to be asserted on the attribute, not through a card**, which
   * was measured on 2026-09-05 by putting the native `disabled` back: every
   * card check in this file still passed. jsdom does not implement the
   * event-suppression a real browser applies to a disabled control, so
   * `cardFor` opens a card on one quite happily. A test that opened the card and
   * called that proof would be green over exactly the bug this is here to catch
   * — docs/reusable/silent-success.md.
   */
  it("is aria-disabled rather than natively disabled, so its card can still be opened", () => {
    render(NO_URL);
    for (const name of ["Re-fetch", "Open the original"]) {
      const el = control(name);
      expect(el.getAttribute("aria-disabled"), `${name} is aria-disabled`).toBe("true");
      expect(
        el.hasAttribute("disabled"),
        `${name} must not be natively disabled — its tooltip would be unreachable`,
      ).toBe(false);
    }
  });

  /**
   * **And the click is stopped, not merely unhandled.** Dropping the handler
   * leaves the event bubbling, and the shelf card is where that bites: the
   * title's `::after` is stretched over the whole card, so a click that got
   * past an "inert" button would open the article. Nothing listens above these
   * buttons today — which is why this asserts on the event rather than on a
   * consequence, since there is currently no consequence to observe.
   * GPT Sol, 2026-09-05.
   *
   * **The listener goes on `document.body`, not on the React root**, and that is
   * measured rather than chosen: React 19 delegates from the root container, so
   * its handler and a native listener on that same node are siblings, and
   * `stopPropagation` — which stops the event reaching *further* nodes — does
   * not stop a sibling. Written against `host` this failed, correctly. `body` is
   * both the achievable assertion and the real threat model: an ancestor outside
   * the row.
   */
  it("does nothing when pressed, and lets nothing through to an ancestor", () => {
    const shelf = stubShelf();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const heard = vi.fn();
    document.body.addEventListener("click", heard);
    render(NO_URL, shelf);
    act(() => {
      control("Re-fetch").dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(heard, "the click reached an ancestor — a stretched card link would have opened").not
      .toHaveBeenCalled();
    document.body.removeEventListener("click", heard);
    fetchSpy.mockRestore();
  });

  /**
   * **The re-fetch needs the same gate as the link, not a weaker one.** Keyed on
   * `entry.url` alone it offered a live button over a `javascript:` address —
   * and `src/fetch.ts` refuses anything but http(s), so the job was accepted and
   * failed at its first step. That is the dead button the 2026-08-27 fix
   * removed, reached by the other door. GPT Sol, 2026-09-05.
   */
  it("refuses the re-fetch for an address stage 1 would not follow", () => {
    render(NOT_WEB);
    expect(control("Re-fetch").getAttribute("aria-disabled")).toBe("true");
  });

  /**
   * **No anchor whose `href` is a value we would not follow**, disabled or
   * otherwise — the whole point of the `isWebUrl` gate. src/urls.ts,
   * docs/project/security.md.
   */
  it("renders no link at all for a non-web address, and prints it nowhere", async () => {
    render(NOT_WEB);
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.innerHTML).not.toContain("javascript:");
    /* **The cards too, and that is not belt-and-braces.** The panel is portalled
       to the end of `<body>`, so a check that reads only `host` cannot see it —
       and these two cards are the part of this row that is *about* the address,
       so they are the likeliest place a future edit would print it.

       Read from what `cardFor` returns rather than from `document.body` after
       the fact: `cardFor` closes the card on its way out, so a check on the body
       afterwards is a check on markup that is no longer there. */
    for (const name of ["Re-fetch", "Open the original"]) {
      const card = await cardFor(control(name));
      expect(`${card.head} ${card.what} ${card.how}`).not.toContain("javascript:");
    }
  });

  /**
   * **There may be no clipboard object at all**, and the copy handler used to
   * dereference it anyway.
   *
   * `navigator.clipboard` is undefined outside a secure context, so on anything
   * but https or localhost the press threw a `TypeError` straight out of a React
   * event handler — past the handler's own `.catch`, which only ever sees a
   * *rejected promise* — and the reader got a button that did nothing and said
   * nothing. `BlockGutter.tsx` and `AccessSharing.tsx` had both guarded this for
   * weeks, each with a comment about the same trap; this was the odd one out.
   *
   * Found on 2026-09-05 by a new touch case that happened to press Copy: vitest
   * reported an uncaught exception while every assertion in the file passed,
   * which is why the report is asserted here rather than the absence of a throw.
   */
  it("says so when the browser gives the page no clipboard", () => {
    const shelf = stubShelf();
    const had = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    render(FETCHED, shelf);
    act(() => {
      control("Copy link").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(shelf.report, "the press was swallowed with nothing said").toHaveBeenCalledTimes(1);
    expect(vi.mocked(shelf.report).mock.calls[0]?.[0]).toMatch(/copy/i);
    if (had) Object.defineProperty(navigator, "clipboard", had);
  });

  it("still links out where the address is a real one", () => {
    render(FETCHED);
    const a = host.querySelector("a");
    expect(a?.getAttribute("href")).toBe(FETCHED.url);
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("each card", () => {
  /**
   * **Every entry shape, not just the healthy one.** Four of the nine cards are
   * only reachable from an article that is missing something, and it was three
   * of those four that broke `ControlTip`'s rule in the first draft — the
   * unavailable cards are where a second paragraph is hardest to write and
   * easiest to pad. GPT Sol, 2026-09-05.
   */
  it("belongs to the control it was opened from, and says more than the label", async () => {
    for (const entry of [FETCHED, NO_URL, NOT_WEB, SHARED]) {
      render(entry);
      for (const name of ["Edit title", "Re-fetch", "Open the original", "Copy link", "Archive"]) {
        const where = `${name} on ${entry.visibility ?? "a private article"}/${entry.url ?? "no url"}`;
        const card = await cardFor(control(name));
        expect(card.head, `${where}: the card is headed by some other control`).not.toBe("");
        expect(
          card.what.length + card.how.length,
          `${where}: the card is too thin to earn a hover`,
        ).toBeGreaterThan(80);
        expect(restates(card.head, card.what), `${where}: paragraph one restates the head`).toBe(
          false,
        );
        expect(
          restates(card.what, card.how),
          `${where}: paragraph two restates paragraph one — ControlTip's one rule`,
        ).toBe(false);
      }
      act(() => root.render(null));
    }
  });

  /**
   * The point of drawing the button at all: the card has to answer *why is this
   * one greyed out*, and it must not be the same card the working button gets.
   */
  it("says something different when the action is unavailable", async () => {
    render(FETCHED);
    const live = await cardFor(control("Re-fetch"));
    act(() => root.render(null));

    render(NO_URL);
    const dead = await cardFor(control("Re-fetch"));

    expect(dead.head, "both are still the same control").toBe(live.head);
    expect(dead.what, "the unavailable card repeats the working one").not.toBe(live.what);
  });

  /**
   * **Copy link's second paragraph is a claim about who can read the article**,
   * and the first version made it unconditionally: *the link opens for you and
   * nobody else*. The shelf knows better — `visibility` is on the entry for
   * exactly this reason — so on a shared article that sentence was false, on the
   * one card whose whole job is to say what handing the link over means.
   * GPT Sol, 2026-09-05.
   */
  it("does not promise privacy on an article the reader has shared", async () => {
    render(FETCHED);
    const priv = await cardFor(control("Copy link"));
    act(() => root.render(null));

    render(SHARED);
    const shared = await cardFor(control("Copy link"));

    expect(shared.how, "the shared article gets the private article's promise").not.toBe(priv.how);
  });

  it("distinguishes the two reasons Open the original can be unavailable", async () => {
    render(NO_URL);
    const missing = await cardFor(control("Open the original"));
    act(() => root.render(null));

    render(NOT_WEB);
    const refused = await cardFor(control("Open the original"));

    expect(refused.what, "no address and a refused address are not the same fact").not.toBe(
      missing.what,
    );
  });
});
