// @vitest-environment jsdom
/**
 * **Where there is a finger, the shelf's five actions are a menu of words
 * behind one "⋯".**
 *
 * Greg, 2026-09-12, on an iPad (SPIDERYARN-READING2-40): *"On an iPad or other
 * touch device, there didn't seem to be a way to access them … add a drop-down
 * button to display them."* docs/plans/260915b-shelf-actions-reachable-on-touch.md.
 *
 * ## What this checks, and what it cannot
 *
 * Which of the two presentations a device is shown is a media query
 * (`any-pointer: coarse`), and jsdom evaluates none — so here both are in the
 * DOM at once, and that is checked in Chrome instead
 * (tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx). What is checked
 * here is the menu's behaviour: when it opens, and what each item does.
 *
 * **Every item query is scoped to `[role="menu"]`**, because the icon row is
 * also rendered and names four of the same five things. A query over the whole
 * host would find the row's button and pass over a menu that had lost its item.
 * GPT Sol's plan review, 2026-09-15.
 *
 * ## The trigger's one rule of our own
 *
 * Radix's trigger toggles on `pointerdown`, for every pointer type. For a finger
 * that is wrong — the start of a scroll across the shelf would open it, and a tap
 * would draw the list under the finger before it lifts — so a finger's press is
 * taken at the click, decided at `pointerdown` (iOS reports a finger's *click*
 * as `mouse`: WebKit bug 282988). Faked the way tests/shelf-action-touch.test.tsx
 * fakes a finger: jsdom has no `PointerEvent`, so a `MouseEvent` of the pointer
 * event's type with `pointerType` defined on it, which is all React and Radix
 * read.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

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

const FETCHED: LibraryEntry = { ...BASE, url: "https://example.com/piece" };
/** No address, so re-fetch and open are unavailable. */
const NO_URL: LibraryEntry = { ...BASE };
/** An address we will neither fetch nor link to — imported metadata can carry one. */
const NOT_WEB: LibraryEntry = { ...BASE, url: "javascript:alert(1)" };

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
let onEdit: Mock<() => void>;
let shelf: Shelf;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onEdit = vi.fn<() => void>();
  shelf = stubShelf();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function render(entry: LibraryEntry): void {
  act(() => {
    root.render(createElement(Actions, { entry, shelf, onEdit }));
  });
}

function trigger(): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>("button")].filter((el) =>
    (el.getAttribute("aria-label") ?? "").startsWith("Actions for"),
  );
  expect(hit, "no single ⋯ trigger").toHaveLength(1);
  return hit[0] as HTMLElement;
}

/** A pointer event of `type`, from a pointer of `pointerType`. */
function pointer(el: Element, type: "pointerdown" | "pointercancel", pointerType: string): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  act(() => {
    el.dispatchEvent(ev);
  });
}

/** `detail: 1` is a pointer's click; `detail: 0` is the one a keyboard generates. */
function click(el: Element, detail = 1): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  });
}

function key(el: Element, k: string): void {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
}

/** A whole tap: what a finger's gesture delivers to the trigger, in order. */
function tap(el: Element): void {
  pointer(el, "pointerdown", "touch");
  click(el);
}

/** The open menu, which Radix portals to the end of `<body>`, or null. */
function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

/** The one item in the open menu whose visible text starts with `name`. */
function item(name: string): HTMLElement {
  const open = menu();
  expect(open, "the menu is not open").not.toBeNull();
  const hit = [...(open as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
    (el) => (el.textContent ?? "").trim().startsWith(name),
  );
  expect(hit, `no single menu item reading ${name}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

/** Open the menu the way a finger does, and hand back the item. */
function tapOpen(entry: LibraryEntry, name: string): HTMLElement {
  render(entry);
  tap(trigger());
  return item(name);
}

/* ------------------------------------------------------ opening the menu -- */

describe("the ⋯ trigger", () => {
  it("is named for its article, since the menu it opens is portalled away from the card", () => {
    render(FETCHED);
    expect(trigger().getAttribute("aria-label")).toBe("Actions for A piece");
  });

  /**
   * **The rule this component exists to add.** Radix would open here; a finger
   * that lands on ⋯ at the start of a scroll must not get a menu.
   */
  it("does not open when a finger lands on it", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "touch");
    expect(menu(), "a finger's pointerdown opened the menu").toBeNull();
  });

  it("opens on the click that finishes a finger's tap", () => {
    render(FETCHED);
    tap(trigger());
    expect(menu(), "a finger's tap did not open the menu").not.toBeNull();
  });

  it("treats a pen as a finger", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "pen");
    expect(menu(), "a Pencil's pointerdown opened the menu").toBeNull();
    click(trigger());
    expect(menu()).not.toBeNull();
  });

  /** Radix's own path, untouched: a mouse opens at the press. */
  it("opens at a mouse's press, as Radix does", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "mouse");
    expect(menu(), "a mouse's pointerdown did not open the menu").not.toBeNull();
    click(trigger());
    expect(menu(), "the click after a mouse's press shut the menu again").not.toBeNull();
  });

  it("opens on Enter", () => {
    render(FETCHED);
    key(trigger(), "Enter");
    expect(menu()).not.toBeNull();
  });

  /**
   * **The finger record lives one gesture** — GPT Sol's plan review. A scroll
   * that began on ⋯ is a `pointerdown` the browser then takes back with a
   * `pointercancel`, and a "finger" left over from it must not open the menu on
   * some later click that no finger made.
   */
  it("forgets a finger whose press became a scroll", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "touch");
    pointer(trigger(), "pointercancel", "touch");
    click(trigger());
    expect(menu(), "a cancelled finger press opened the menu at a later click").toBeNull();
  });

  /**
   * And a keyboard's click is never a finger's. Enter has already opened the
   * menu through Radix's key handler; the click a keyboard generates
   * (`detail === 0`) must not read a stale finger and toggle it shut.
   */
  it("stays open after Enter, whatever a finger left behind", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "touch");
    pointer(trigger(), "pointercancel", "touch");
    key(trigger(), "Enter");
    click(trigger(), 0);
    expect(menu(), "Enter's own click shut the menu Enter opened").not.toBeNull();
  });

  it("stays open after Enter even if no cancel cleared the finger", () => {
    render(FETCHED);
    pointer(trigger(), "pointerdown", "touch");
    key(trigger(), "Enter");
    click(trigger(), 0);
    expect(menu(), "a keyboard's click was read as a finger's").not.toBeNull();
  });

  it("lists the five in the row's order", () => {
    render(FETCHED);
    tap(trigger());
    const names = [...(menu() as HTMLElement).querySelectorAll('[role="menuitem"]')].map((el) =>
      (el.textContent ?? "").trim(),
    );
    expect(names).toEqual([
      "Edit title",
      "Re-fetch and rebuild",
      "Open the original page",
      "Copy link",
      "Archive",
    ]);
  });
});

/* ---------------------------------------------------------- the items ------ */

describe("each item", () => {
  it("Archive archives this article, once", () => {
    click(tapOpen(FETCHED, "Archive"));
    expect(shelf.archive).toHaveBeenCalledTimes(1);
    expect(shelf.archive).toHaveBeenCalledWith("a-piece");
    expect(menu(), "the menu outstayed the archive").toBeNull();
  });

  it("Edit title begins the rename, once", () => {
    click(tapOpen(FETCHED, "Edit title"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("Re-fetch and rebuild queues the job, once", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    click(tapOpen(FETCHED, "Re-fetch and rebuild"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/jobs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ slug: "a-piece", force: ["fetch"] });
    expect(shelf.report, "the queued job was reported as a failure").not.toHaveBeenCalled();
  });

  /**
   * **Copy keeps the menu open**, because Radix closes it on select and the
   * confirmation is in the item itself — a menu that shut at once would take
   * "Copied" with it. GPT Sol's plan review.
   */
  it("Copy link copies the reading view's address, and says so in the open menu", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    click(tapOpen(FETCHED, "Copy link"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toMatch(/\/read\/a-piece$/);
    expect(menu(), "the menu closed and took the confirmation with it").not.toBeNull();
    expect(item("Copied")).toBeTruthy();
  });

  it("Open the original is a link to the publisher's page, off in a new tab", () => {
    const open = tapOpen(FETCHED, "Open the original");
    expect(open.tagName).toBe("A");
    expect(open.getAttribute("href")).toBe("https://example.com/piece");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

/* ----------------------------------------------------- unavailable items -- */

describe("an unavailable item", () => {
  it("says why in its own words, and does nothing", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const rerun = tapOpen(NO_URL, "Re-fetch and rebuild");
    expect(rerun.textContent?.trim()).toBe("Re-fetch and rebuild (no address recorded)");
    expect(rerun.getAttribute("aria-disabled")).toBe("true");
    click(rerun);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch, "an unavailable re-fetch queued a job").not.toHaveBeenCalled();

    const open = item("Open the original");
    expect(open.textContent?.trim()).toBe("Open the original page (no address recorded)");
    expect(open.tagName, "an unavailable open was drawn as a link").not.toBe("A");
  });

  /**
   * **There must be no anchor whose href is a value we would not follow** —
   * library.md § When a button cannot do its job, and the same rule as the row.
   * Imported metadata can carry a `javascript:` address.
   */
  it("draws no link at all for an address that is not a web page", () => {
    const open = tapOpen(NOT_WEB, "Open the original");
    expect(open.tagName).not.toBe("A");
    expect(open.textContent?.trim()).toBe(
      "Open the original page (the recorded address is not a web page)",
    );
    expect(
      (menu() as HTMLElement).querySelector("a"),
      "the menu drew an anchor for a javascript: address",
    ).toBeNull();
    expect(item("Re-fetch").textContent?.trim()).toBe(
      "Re-fetch and rebuild (the recorded address cannot be fetched)",
    );
  });
});
