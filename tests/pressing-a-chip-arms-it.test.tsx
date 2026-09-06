// @vitest-environment jsdom
/**
 * **The gesture seams one level below the bar's mode buttons.**
 *
 * [`tests/modes-that-start-themselves.test.tsx`](./modes-that-start-themselves.test.tsx)
 * holds the rule for the fourteen mode buttons — *a press runs it, arriving does
 * not* — end to end, from a real click to a counted POST. This file holds the
 * same rule for the four controls that are **not** mode buttons and that started
 * running what they open on 2026-09-06
 * ([260906a](../docs/plans/260906a-opening-a-mode-starts-it-generating.md)):
 *
 *  - Referee's four sub-mode chips, two of which arm and two of which must not;
 *  - Remember's Recall | Quiz toggle;
 *  - the bar's **Tweets** link, which is a `<a>` rather than a button and is
 *    therefore the only one of the four where the browser can decide not to go.
 *
 * ## Why this file measures tokens rather than requests
 *
 * The other file counts POSTs, which is the stronger measurement and the right
 * one there: the mode, the band and the hook are all in the tree, so a counted
 * request is the whole chain working. Here the question is narrower and the tree
 * would be most of the reading view — `RefereeBand` alone wants comments, a
 * source scan, four panels and a router.
 *
 * So what is asserted is `pendingActivation`, and that is not a weaker claim
 * about a different thing: an activation token **is** the seam. The hooks on the
 * far side of it — `useClaims`, `useQuiz`, the Candidates band — are covered
 * where they live (`tests/referee-candidates-press.test.tsx`,
 * `tests/quiz-panel.test.tsx`), and what has never been covered anywhere is
 * *which gesture mints one*. That is the half where the money is: a press mints,
 * and a query-state write, a Back step and a pasted link do not.
 *
 * **No token is claimed here**, because nothing that would claim one is mounted.
 * `pendingActivation` therefore reads the token for as long as the test wants
 * it, which is what makes the assertion legible.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }),
});

/* The bar draws a build stamp and the modes' tooltips; neither wants a network.
   Everything this file presses is synchronous, so nothing waits on a reply. */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: async () => new Response("{}", { status: 200 }),
    fetchOk: async () => new Response(null, { status: 204 }),
  };
});

const { Dock } = await import("../src/web/Dock.js");
const { RefereeViews } = await import("../src/web/App.js");
const { RememberSubModeToggle } = await import("../src/web/QuizPanel.js");
const { pendingActivation, resetActivations } = await import("../src/web/activation.js");

const SLUG = "a-paper";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  resetActivations();
  window.history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Is there a press waiting to be spent on this target? */
function armed(target: Parameters<typeof pendingActivation>[1]): boolean {
  return pendingActivation(SLUG, target) !== null;
}

function click(selector: string): void {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matching ${selector} is on screen`);
  act(() => {
    found.click();
  });
}

/* ------------------------------------------------------- Referee's chips -- */

/**
 * `RefereeViews` rather than `RefereeBand`, which is the split
 * tests/arrows-belong-to-the-article.test.tsx already relies on: the band owns
 * `?referee=` and would want a router, and the chips are what a referee presses.
 */
function mountRefereeChips(view: "criteria" | "claims" | "mirror" | "candidates"): void {
  act(() => {
    root.render(createElement(RefereeViews, { slug: SLUG, view, onView: () => {} }));
  });
}

/** The chip whose visible label is this word. */
function chip(label: string): string {
  const buttons = [...host.querySelectorAll<HTMLElement>(".ref-view-btn")];
  const at = buttons.findIndex((b) => b.textContent?.trim() === label);
  if (at < 0) throw new Error(`no ${label} chip: ${buttons.map((b) => b.textContent).join(", ")}`);
  return `.ref-view-btn:nth-of-type(${at + 1})`;
}

describe("Referee's sub-mode chips", () => {
  it("arms Claims when the Claims chip is pressed", () => {
    mountRefereeChips("criteria");
    expect(armed("claims")).toBe(false);
    click(chip("Claims"));
    expect(armed("claims")).toBe(true);
  });

  it("arms Candidates when the Candidates chip is pressed", () => {
    /* **The dearest press in the mode, and the only one that reaches a search
       engine.** It sat behind a labelled button until 2026-09-06 precisely
       because it used to fire on *mount*; what makes the chip acceptable is that
       a chip is a person and a mount is not, plus the disclosure that is now
       drawn above the chips whether the notice is open or shut
       (src/messages.ts § REFEREE_CANDIDATES_REACHES_SEARCH). */
    mountRefereeChips("criteria");
    click(chip("Candidates"));
    expect(armed("candidates")).toBe(true);
  });

  it("arms nothing for Criteria or Mirror", () => {
    /* Neither has anything to generate until the referee has written a criterion
       or left a comment, so there is no empty artefact for a press to fill.
       Mirror is the one worth stating out loud: it *can* run without new text,
       and it is left out because it stores nothing — every open would be a fresh
       paid call and the session cap would make the second open behave unlike the
       first. activation.ts § REFEREE_TARGET. */
    mountRefereeChips("claims");
    click(chip("Criteria"));
    click(chip("Mirror"));
    expect(armed("claims")).toBe(false);
    expect(armed("candidates")).toBe(false);
  });

  it("arms again when the chip pressed is the one already showing", () => {
    /* The bar's own mode buttons behave this way, and it is the only way back
       from a read that failed: the failed read keeps the press and re-reads, and
       nothing re-fires without a fresh nonce. */
    mountRefereeChips("claims");
    click(chip("Claims"));
    const first = pendingActivation(SLUG, "claims");
    click(chip("Claims"));
    expect(pendingActivation(SLUG, "claims")).not.toBe(first);
    expect(armed("claims")).toBe(true);
  });

  it("arms nothing when a sub-mode is merely on screen", () => {
    /* A pasted `?referee=claims`, a Back step, or a Diagram press on a URL that
       already said `claims`. All three mount this component with `view` already
       set, and none of them is anybody asking for anything. */
    mountRefereeChips("claims");
    expect(armed("claims")).toBe(false);
    mountRefereeChips("candidates");
    expect(armed("candidates")).toBe(false);
  });
});

/* ---------------------------------------------------- Remember's toggle -- */

function mountRememberToggle(value: "recall" | "quiz"): void {
  act(() => {
    root.render(
      createElement(RememberSubModeToggle, { slug: SLUG, value, onChange: () => {} }),
    );
  });
}

function toggleButton(label: string): string {
  const buttons = [...host.querySelectorAll<HTMLElement>(".remember-submode-btn")];
  const at = buttons.findIndex((b) => b.textContent?.trim() === label);
  if (at < 0) throw new Error(`no ${label} button`);
  return `.remember-submode-btn:nth-of-type(${at + 1})`;
}

describe("Remember's Recall | Quiz toggle", () => {
  it("arms the quiz when Quiz is pressed", () => {
    mountRememberToggle("recall");
    expect(armed("quiz")).toBe(false);
    click(toggleButton("Quiz"));
    expect(armed("quiz")).toBe(true);
  });

  it("arms the quiz when Quiz is pressed and Quiz is already showing", () => {
    /* The chip does not call `onChange` here — the sub-mode is not changing, and
       writing the same value to the URL would push a history entry that goes
       nowhere. It must still mint a press: this is the reader asking again after
       a failed read, and it is the only control they have.
       GPT Sol found this missing in the plan, 2026-09-06. */
    mountRememberToggle("quiz");
    click(toggleButton("Quiz"));
    expect(armed("quiz")).toBe(true);
  });

  it("arms nothing for Recall, or for merely being in Quiz", () => {
    mountRememberToggle("quiz");
    expect(armed("quiz")).toBe(false);
    mountRememberToggle("recall");
    click(toggleButton("Recall"));
    expect(armed("quiz")).toBe(false);
  });
});

/* --------------------------------------------------- the bar's Tweets link -- */

function mountDock(view: "article" | "tweets", visitor = false): void {
  act(() => {
    root.render(
      createElement(Dock, {
        slug: SLUG,
        view,
        mode: "plain" as const,
        onMode: () => {},
        experimental: EXPERIMENTAL_ON,
        ...(visitor ? { visitor: true as const } : {}),
      }),
    );
  });
}

function tweetsLink(): HTMLAnchorElement {
  const found = host.querySelector<HTMLAnchorElement>('a[aria-label="Tweets"]');
  if (!found) throw new Error("no Tweets link in the bar");
  return found;
}

/** A click the browser would let the router take over. */
function plainClick(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

/** ⌘-click: a new tab, and this one stays exactly where it is. */
function metaClick(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }),
    );
  });
}

describe("the bar's Tweets link", () => {
  it("arms the thread when it is pressed", () => {
    mountDock("article");
    expect(armed("tweets")).toBe(false);
    plainClick(tweetsLink());
    expect(armed("tweets")).toBe(true);
  });

  it("arms nothing on a ⌘-click, which opens a tab this one is not in", () => {
    /**
     * **The whole reason the seam is `Link.onNavigate` and not `onClick`.**
     *
     * `Link` runs `onClick` *before* it decides whether to take over — it has to,
     * so a handler above can `preventDefault` — so a ⌘-click, a middle-click and
     * a `target="_blank"` all reach it, and every one of them leaves this tab
     * where it was. A token minted here would sit in the map with no owner until
     * something arrived to spend or retire it, which is the same shape of bug as
     * the Diagram one in tests/modes-that-start-themselves.test.tsx.
     *
     * Move the call from `onNavigate` to `onClick` and this is the only thing in
     * the suite that notices.
     */
    mountDock("article");
    metaClick(tweetsLink());
    expect(armed("tweets")).toBe(false);
  });

  it("arms nothing on the page it already leads to", () => {
    /* No navigation happens, so there is nothing to arm for — `navigate` itself
       returns early on the href it is already at. */
    window.history.replaceState(null, "", `/read/${SLUG}/tweets`);
    mountDock("tweets");
    plainClick(tweetsLink());
    expect(armed("tweets")).toBe(false);
  });

  it("arms nothing for a visitor, who cannot write one", () => {
    /* The capability seam every band uses. A visitor's press would mint a token
       nothing can ever spend — the Tweets page's auto-run is the owner's. */
    mountDock("article", true);
    plainClick(tweetsLink());
    expect(armed("tweets")).toBe(false);
  });
});
