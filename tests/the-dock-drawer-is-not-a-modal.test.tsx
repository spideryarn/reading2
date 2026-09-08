// @vitest-environment jsdom
/**
 * **The Comments drawer is not a modal, and now it says so and behaves like one
 * thing rather than two.**
 *
 * What a browser found on 2026-09-06 (Playwright against system Chrome; the
 * transcript is in
 * docs/plans/260905h-a-mode-failure-should-leave-the-article-readable.md
 * § Stage 2 — the Dock's real focus contract, reproduced): with the drawer
 * open, the **bar** is fully operable — `.dock` sits at `z-index: 96` above the
 * scrim's 92, and clicking a mode radio changed the mode with the drawer still
 * up — while the **prose** is not, the scrim eating every pointer event over
 * it. Nothing was `inert`, nothing outside carried `aria-hidden`, focus never
 * entered the drawer at all, and no close path put it back.
 *
 * So `aria-modal="true"` was a false statement: it tells assistive technology
 * that everything outside the dialog does not exist, over a bar that is
 * visible, clickable and Tab-reachable. It is gone. The labelled
 * `role="dialog"` stays — the drawer *is* a dialog, just a modeless one.
 *
 * The other half is what makes the first half testable (GPT Sol, F5 on the
 * plan): *does Tab leave the drawer* cannot be asked of a drawer focus never
 * enters. So opening now moves focus to the drawer's close button, every close
 * path returns it to the control that opened it, and Tab is deliberately
 * **not** trapped, because the bar behind is meant to stay reachable.
 *
 * **What jsdom cannot do, and what stands in for it.** There is no Tab
 * traversal and no default action for Enter on a button, so a keyboard press is
 * spelled out as the two things a browser does — the `keydown`, then the
 * activating click. And "not trapped" is tested as the two mechanisms a trap
 * would actually need: a swallowed Tab, and a handler that yanks focus back.
 * Whether the bar is *visibly* above the scrim is a browser's answer, and that
 * is the reproduction above rather than this file.
 */
import { act, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dock } from "../src/web/Dock.js";
import type { Panel } from "../src/web/params.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

let host: HTMLDivElement;
let root: Root;

/**
 * The bar with a real drawer behind real state, because every claim in this
 * file is about what happens *between* two renders — the drawer opening and
 * closing — rather than about either of them on its own.
 */
function DrawerHarness() {
  const [panel, setPanel] = useState<Panel | null>(null);
  return (
    <Dock
      slug="a-piece"
      view="article"
      experimental={EXPERIMENTAL_OFF}
      drawer={{
        comments: [],
        loaded: true,
        loadFailed: false,
        error: null, // nothing has failed to save; this file is about focus
        panel,
        onPanel: setPanel,
        onOpenComment: () => {},
      }}
    />
  );
}

function paint(): void {
  act(() => {
    root.render(
      <StrictMode>
        <DrawerHarness />
      </StrictMode>,
    );
  });
}

const tab = () => host.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]');
const drawer = () => host.querySelector<HTMLElement>(".dock-drawer");
const closeButton = () => host.querySelector<HTMLButtonElement>(".dock-close");
const scrim = () => host.querySelector<HTMLButtonElement>(".dock-scrim");
/** A control in the bar *behind* the drawer, which must stay reachable. */
const tweets = () => host.querySelector<HTMLElement>('.dock [aria-label="Tweets"]');

function must<T>(el: T | null | undefined, what: string): T {
  expect(el, `no ${what}`).toBeTruthy();
  return el as T;
}

/**
 * Open the drawer the way a keyboard does: focus the tab, press Enter, and let
 * the button's default action fire the click. jsdom performs no default action
 * for Enter, so both halves are spelled out — and `.click()` carries
 * `detail: 0`, which is exactly how the bar tells a keyboard activation from a
 * pointer one.
 */
function openWithEnter(): HTMLButtonElement {
  const opener = must(tab(), "Comments tab");
  opener.focus();
  act(() => {
    opener.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  act(() => opener.click());
  return opener;
}

/**
 * A pointer click, which in a browser **focuses the button it lands on** —
 * jsdom's `.click()` does not, so the focus half is spelled out. Without it
 * three of the four close paths would pass over a drawer focus never entered,
 * which is exactly the vacuous green
 * docs/reusable/silent-success.md is about.
 */
function clickLikeAPointer(el: HTMLElement): void {
  el.focus();
  act(() => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("what the drawer declares itself to be", () => {
  it("is a dialog with a name", () => {
    paint();
    openWithEnter();
    const d = must(drawer(), "drawer");
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.getAttribute("aria-label")).toBe("Your comments");
  });

  /* The bar behind is operable and Tab-reachable, so a claim that it does not
     exist is false. The browser reproduction is in the plan. */
  it("does not claim the rest of the page away", () => {
    paint();
    openWithEnter();
    expect(must(drawer(), "drawer").hasAttribute("aria-modal")).toBe(false);
  });
});

describe("where focus goes", () => {
  it("moves into the drawer when it opens with Enter", () => {
    paint();
    openWithEnter();
    const d = must(drawer(), "drawer");
    expect(d.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeButton());
  });

  /* Two mechanisms, because those are the two a trap would need. Neither is
     Tab traversal itself, which jsdom does not have. */
  it("does not trap Tab inside the drawer", () => {
    paint();
    openWithEnter();
    let reachedWindow = false;
    const spy = () => {
      reachedWindow = true;
    };
    window.addEventListener("keydown", spy);
    const key = new window.KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      must(closeButton(), "close button").dispatchEvent(key);
    });
    window.removeEventListener("keydown", spy);
    expect(reachedWindow, "Tab was swallowed inside the drawer").toBe(true);
    expect(key.defaultPrevented, "Tab's default action was cancelled").toBe(false);

    /* And where Tab would land, focus is allowed to stay. */
    const behind = must(tweets(), "Tweets control");
    act(() => behind.focus());
    expect(document.activeElement, "focus was pulled back into the drawer").toBe(behind);
    expect(drawer(), "the drawer closed itself when focus left").not.toBeNull();
    expect(host.querySelector(".dock")?.hasAttribute("inert")).toBe(false);
    expect(host.querySelector(".dock")?.getAttribute("aria-hidden")).toBeNull();
  });
});

/**
 * Each of the four, and each one first asserts that focus is **inside** the
 * drawer. That line is not ceremony: without it three of these would pass
 * against a drawer that never took focus, because the opener would still be
 * holding it.
 */
describe("focus comes back to whoever opened it", () => {
  it("on Escape", () => {
    paint();
    const opener = openWithEnter();
    expect(document.activeElement).toBe(closeButton());
    act(() => {
      must(closeButton(), "close button").dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("on the close button", () => {
    paint();
    const opener = openWithEnter();
    expect(document.activeElement).toBe(closeButton());
    clickLikeAPointer(must(closeButton(), "close button"));
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("on the scrim", () => {
    paint();
    const opener = openWithEnter();
    expect(document.activeElement).toBe(closeButton());
    clickLikeAPointer(must(scrim(), "scrim"));
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  /* Pressing the same tab again is a close too, and the one path where focus is
     already on the opener — so it is the one that would pass by accident if the
     drawer had never taken focus at all. The second assertion is what stops
     that: focus must have been *inside* the drawer a moment earlier. */
  it("on the same dock tab, pressed again", () => {
    paint();
    const opener = openWithEnter();
    expect(document.activeElement).toBe(closeButton());
    act(() => opener.click());
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
