// @vitest-environment jsdom
/**
 * **The gesture seams one level below the bar's mode buttons.**
 *
 * [`tests/modes-that-start-themselves.test.tsx`](./modes-that-start-themselves.test.tsx)
 * holds the rule for the fourteen mode buttons — *a press runs it, arriving does
 * not* — end to end, from a real click to a counted POST. This file holds the
 * same rule for the four controls that are **not** mode buttons and that started
 * running what they open on 2026-09-06
 * ([260906b](../docs/plans/260906b-opening-a-mode-starts-it-generating.md)):
 *
 *  - Referee's four sub-mode chips, two of which arm and two of which must not;
 *  - Remember's Recall | Tutorial | Explore | Quiz toggle;
 *  - and, as a negative since 2026-09-15, the bar's **Tweets** button, which
 *    armed a token from 2026-09-06 and now must not: the thread writes itself on
 *    arrival (tests/tweets-press-starts-it.test.tsx), and a press that armed as
 *    well would be a second way to start one run, minting tokens nothing claims.
 *    A link to a page until 2026-09-29 and a mode button since (plan 260929f);
 *    the rule did not change with the shape.
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
const { RefereeViews } = await import("../src/web/modes/referee/RefereeMode.js");
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

  it("arms nothing when the Candidates chip is pressed", () => {
    /* **The dearest press in the mode, and the only one that reaches a search
       engine**, so it is back behind its own labelled button since 2026-10-03.
       The chip started it from 2026-09-06, and what paid for that was a warning
       drawn above the chips in all four sub-modes — one of the notices Greg
       met as burying the mode (`spya-vbeyse`). With the chip inert the warning
       sits beside the button that causes the thing it warns about
       (CandidatesPanel.tsx § StartBrief), and nowhere else has to carry it. */
    mountRefereeChips("criteria");
    click(chip("Candidates"));
    expect(armed("candidates")).toBe(false);
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

function mountRememberToggle(value: "recall" | "tutorial" | "explore" | "quiz"): void {
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

describe("Remember's Recall | Tutorial | Explore | Quiz toggle", () => {
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

  it("arms nothing for Recall, Tutorial or Explore, or for merely being in Quiz", () => {
    mountRememberToggle("quiz");
    expect(armed("quiz")).toBe(false);
    mountRememberToggle("recall");
    click(toggleButton("Recall"));
    expect(armed("quiz")).toBe(false);
    mountRememberToggle("tutorial");
    click(toggleButton("Tutorial"));
    expect(armed("quiz")).toBe(false);
    mountRememberToggle("explore");
    click(toggleButton("Explore"));
    expect(armed("quiz")).toBe(false);
  });

  it("draws the four chips in order", () => {
    mountRememberToggle("explore");
    const chips = [...host.querySelectorAll<HTMLElement>(".remember-submode-btn")];
    expect(chips.map((b) => b.textContent?.trim())).toEqual(["Recall", "Tutorial", "Explore", "Quiz"]);
    expect(chips.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
  });
});

/* ------------------------------------------ Summary's plain-words slider -- */

const { SummaryControls } = await import("../src/web/modes/summary/SummaryMode.js");

/** `slug: null` is the visitor's slider, which must arm nothing. */
function mountSummaryControls(value: "brief" | "simple" | "fuller", slug: string | null = SLUG): string[] {
  const changes: string[] = [];
  act(() => {
    root.render(
      createElement(SummaryControls, { slug, value, onChange: (next: string) => void changes.push(next) }),
    );
  });
  return changes;
}

function slider(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(".summ-slider input[type=range]");
  if (!found) throw new Error("no plain-words slider");
  return found;
}

/** Move the slider to a stop, as a drag or an arrow key does: React hears `input`. */
function slideTo(stop: number): void {
  const input = slider();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(stop));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Summary's plain-words slider", () => {
  it("is a named range with three stops that says which level it is on", () => {
    mountSummaryControls("simple");
    const group = host.querySelector("fieldset.summ-slider");
    expect(group?.querySelector("legend")?.textContent).toBe("In plain words");
    expect(group?.querySelector("legend")?.className).toBe("sr-only");
    const input = slider();
    expect([input.min, input.max, input.step, input.value]).toEqual(["0", "2", "1", "1"]);
    expect(input.getAttribute("aria-valuetext")).toBe("Simple");
    mountSummaryControls("fuller");
    expect(slider().value).toBe("2");
    expect(slider().getAttribute("aria-valuetext")).toBe("Fuller");
  });

  it("arms the run when moved to a level, and moves to it", () => {
    const changes = mountSummaryControls("simple");
    expect(armed("simple")).toBe(false);
    slideTo(0);
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["brief"]);
  });

  it("arms Fuller's press as the one simple step, which writes every level", () => {
    const changes = mountSummaryControls("simple");
    slideTo(2);
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["fuller"]);
  });

  it("goes to the end an icon names, and arms it", () => {
    const changes = mountSummaryControls("simple");
    const ends = [...host.querySelectorAll<HTMLButtonElement>(".summ-slider-end")];
    expect(ends).toHaveLength(2);
    expect(ends.map((end) => end.getAttribute("aria-label"))).toEqual([
      "Show Brief summary",
      "Show Fuller summary",
    ]);
    expect(ends.map((end) => end.tabIndex)).toEqual([0, 0]);
    expect(ends.some((end) => end.hasAttribute("aria-hidden"))).toBe(false);
    act(() => ends[0]?.click());
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["brief"]);
  });

  it("arms once when a pointer move emits both input and click", () => {
    const changes = mountSummaryControls("simple");
    const input = slider();
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const armedOnce = pendingActivation(SLUG, "simple");
    expect(armedOnce).not.toBeNull();
    act(() => {
      input.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    expect(pendingActivation(SLUG, "simple")).toBe(armedOnce);
    act(() => input.click());
    expect(pendingActivation(SLUG, "simple")).toBe(armedOnce);
    expect(changes).toEqual(["fuller"]);
  });

  it("arms a drag that is cancelled before the pointer comes up (touch)", () => {
    /* GPT Sol's plan review of 261002h, P1: a touch drag the browser takes
       back for scrolling ends in pointercancel, not pointerup. The level has
       already moved, so the press must already be armed, or the band sits on
       Brief with an idle "Write it" — Greg's 9P. */
    const changes = mountSummaryControls("simple");
    const input = slider();
    act(() => {
      input.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    });
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["brief"]);
  });

  it("arms a fresh press when clicked on the level already showing", () => {
    /* The way back from a failed read (useAutoRun.ts § A failed read is not an
       answer): nothing re-fires without a new nonce. No `onChange`, because
       writing the same value would push a history entry that goes nowhere. */
    const changes = mountSummaryControls("simple");
    click(".summ-slider input[type=range]");
    const first = pendingActivation(SLUG, "simple");
    expect(first).not.toBeNull();
    click(".summ-slider input[type=range]");
    expect(pendingActivation(SLUG, "simple")).not.toBe(first);
    expect(changes).toEqual([]);
  });

  it("arms nothing for merely being on a level", () => {
    /* A pasted `?summary=fuller`, a Back step, a last-view restore: each
       mounts the slider with a level already set, and none is a press. */
    mountSummaryControls("fuller");
    expect(armed("simple")).toBe(false);
  });

  it("arms nothing for a visitor, who still gets to move it", () => {
    const changes = mountSummaryControls("brief", null);
    slideTo(2);
    expect(armed("simple")).toBe(false);
    expect(changes).toEqual(["fuller"]);
  });

  it("arms nothing when a visitor uses an end button", () => {
    const changes = mountSummaryControls("simple", null);
    const fuller = host.querySelector<HTMLButtonElement>(
      '.summ-slider-end[aria-label="Show Fuller summary"]',
    );
    act(() => fuller?.click());
    expect(armed("simple")).toBe(false);
    expect(changes).toEqual(["fuller"]);
  });
});

/* ------------------------------------------------- the bar's Tweets button -- */

function mountDock(view: "article", visitor = false, onMode: (next: string) => void = () => {}): void {
  act(() => {
    root.render(
      createElement(Dock, {
        slug: SLUG,
        view,
        mode: "plain" as const,
        onMode,
        experimental: EXPERIMENTAL_ON,
        ...(visitor ? { visitor: true as const } : {}),
      }),
    );
  });
}

function tweetsButton(): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>('button[aria-label="Tweets"]');
  if (!found) throw new Error("no Tweets button in the bar");
  return found;
}

/** A click the browser would let the router take over. */
function plainClick(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}

describe("the bar's Tweets button", () => {
  it("arms nothing, and still opens the mode", () => {
    /* The band starts itself on arrival (useTweets.ts § `useAutoRunOnArrival`),
       so a token here would never be claimed — `useAutoRun` is not mounted
       anywhere that asks for `tweets`. The positive half is the mode opening:
       without it, "arms nothing" would pass on a button that did nothing. */
    const opened: string[] = [];
    mountDock("article", false, (next) => opened.push(next));
    plainClick(tweetsButton());
    expect(opened).toEqual(["tweets"]);
    expect(armed("tweets")).toBe(false);
  });
});
