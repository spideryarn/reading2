// @vitest-environment jsdom
/**
 * **The gesture seams one level below the bar's mode buttons.**
 *
 * [`tests/modes-that-start-themselves.test.tsx`](./modes-that-start-themselves.test.tsx)
 * holds the rule for the fourteen mode buttons — *a press runs it, arriving does
 * not* — end to end, from a real click to a counted POST. This file holds the
 * same rule for the controls that are **not** mode buttons and that started
 * running what they open on 2026-09-06
 * ([260906b](../docs/plans/260906b-opening-a-mode-starts-it-generating.md)):
 *
 *  - Referee's five sub-mode chips, one of which arms and four of which must not;
 *  - Learn's Recall | Tutorial | Explore | Quiz toggle;
 *  - Summary's Brief | Fuller | Thread control, whose two lengths arm and whose
 *    **Thread** must not: the thread writes itself on arrival
 *    (tests/summary-thread-press.test.tsx), and a press that armed as well
 *    would be a second way to start one run, minting tokens nothing claims.
 *    The thread was a link to a page until 2026-09-29, a mode button until
 *    2026-10-03 (plans 260929f, 261003l); the rule did not change with the
 *    shape.
 *
 * ## Why this file measures tokens rather than requests
 *
 * The other file counts POSTs, which is the stronger measurement and the right
 * one there: the mode, the band and the hook are all in the tree, so a counted
 * request is the whole chain working. Here the question is narrower and the tree
 * would be most of the reading view — `RefereeBand` alone wants comments, a
 * source scan, five panels and a router.
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

const { RefereeViews } = await import("../src/web/modes/referee/RefereeMode.js");
const { LearnSubModeToggle } = await import("../src/web/QuizPanel.js");
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
function mountRefereeChips(view: "criteria" | "claims" | "mirror" | "candidates" | "hidden"): void {
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

  it("arms nothing when Hidden text is pressed", () => {
    mountRefereeChips("criteria");
    click(chip("Hidden text"));
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

/* ---------------------------------------------------- Learn's toggle -- */

function mountLearnToggle(value: "recall" | "tutorial" | "explore" | "quiz"): void {
  act(() => {
    root.render(
      createElement(LearnSubModeToggle, { slug: SLUG, value, experimental: true, onChange: () => {} }),
    );
  });
}

function toggleButton(label: string): string {
  const buttons = [...host.querySelectorAll<HTMLElement>(".learn-submode-btn")];
  const at = buttons.findIndex((b) => b.textContent?.trim() === label);
  if (at < 0) throw new Error(`no ${label} button`);
  return `.learn-submode-btn:nth-of-type(${at + 1})`;
}

describe("Learn's Recall | Tutorial | Explore | Quiz toggle", () => {
  it("arms the quiz when Quiz is pressed", () => {
    mountLearnToggle("recall");
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
    mountLearnToggle("quiz");
    click(toggleButton("Quiz"));
    expect(armed("quiz")).toBe(true);
  });

  it("arms nothing for Recall, Tutorial or Explore, or for merely being in Quiz", () => {
    mountLearnToggle("quiz");
    expect(armed("quiz")).toBe(false);
    mountLearnToggle("recall");
    click(toggleButton("Recall"));
    expect(armed("quiz")).toBe(false);
    mountLearnToggle("tutorial");
    click(toggleButton("Tutorial"));
    expect(armed("quiz")).toBe(false);
    mountLearnToggle("explore");
    click(toggleButton("Explore"));
    expect(armed("quiz")).toBe(false);
  });

  it("draws the four chips in order", () => {
    mountLearnToggle("explore");
    const chips = [...host.querySelectorAll<HTMLElement>(".learn-submode-btn")];
    expect(chips.map((b) => b.textContent?.trim())).toEqual(["Recall", "Tutorial", "Explore", "Quiz"]);
    expect(chips.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
  });
});

/* ------------------------------------ Summary's Brief | Fuller | Thread -- */

const { SummaryControls } = await import("../src/web/modes/summary/SummaryMode.js");

type SummaryView = "brief" | "fuller" | "thread";

/** `slug: null` is the visitor's control, which must arm nothing. */
function mountSummaryControls(value: SummaryView, slug: string | null = SLUG): string[] {
  const changes: string[] = [];
  act(() => {
    root.render(
      createElement(SummaryControls, { slug, value, onChange: (next: string) => void changes.push(next) }),
    );
  });
  return changes;
}

function segments(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.summ-views [role="radio"]')];
}

function pressSegment(label: string): void {
  const found = segments().find((b) => b.textContent === label);
  if (!found) throw new Error(`no ${label} segment`);
  act(() => found.click());
}

/**
 * The slider of 2026-09-30 became this three-way control on 2026-10-03, when
 * the thread became Summary's third view
 * (docs/plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md).
 */
describe("Summary's Brief | Fuller | Thread control", () => {
  it("is a named group of three, in words, each its own tab stop, saying which is chosen", () => {
    mountSummaryControls("brief");
    const group = host.querySelector(".summ-views");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    expect(group?.getAttribute("aria-label")).toBe("Summary view");
    expect(segments().map((b) => b.textContent)).toEqual(["Brief", "Fuller", "Thread"]);
    expect(segments().map((b) => b.tabIndex)).toEqual([0, 0, 0]);
    expect(segments().map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    mountSummaryControls("thread");
    expect(segments().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    /* The slider it replaced is gone, and so is the Simple level's control. */
    expect(host.querySelector("input[type=range]")).toBeNull();
    expect(host.textContent).not.toContain("Simple");
  });

  it("arms the run when a length is pressed, and moves to it", () => {
    const changes = mountSummaryControls("fuller");
    expect(armed("simple")).toBe(false);
    pressSegment("Brief");
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["brief"]);
  });

  it("arms Fuller's press as the one simple step, which writes every level", () => {
    const changes = mountSummaryControls("brief");
    pressSegment("Fuller");
    expect(armed("simple")).toBe(true);
    expect(changes).toEqual(["fuller"]);
  });

  it("arms nothing for Thread, and still moves to it", () => {
    /* The thread's band writes on arrival and claims no token (useTweets.ts §
       `useAutoRunOnArrival`). A `simple` token here would have no `useSimple`
       mounted to claim it, and would wait for Back onto Brief to spend it. The
       positive half is the move: without it, "arms nothing" would pass on a
       button that did nothing. */
    const changes = mountSummaryControls("brief");
    pressSegment("Thread");
    expect(changes).toEqual(["thread"]);
    expect(armed("simple")).toBe(false);
    expect(armed("tweets")).toBe(false);
  });

  it("arms a fresh press when pressed on the length already showing", () => {
    /* The way back from a failed read (useAutoRun.ts § A failed read is not an
       answer): nothing re-fires without a new nonce. No `onChange`, because
       writing the same value would push a history entry that goes nowhere. */
    const changes = mountSummaryControls("fuller");
    pressSegment("Fuller");
    const first = pendingActivation(SLUG, "simple");
    expect(first).not.toBeNull();
    pressSegment("Fuller");
    expect(pendingActivation(SLUG, "simple")).not.toBe(first);
    expect(changes).toEqual([]);
  });

  it("arms nothing, and writes nothing, when Thread is pressed while showing", () => {
    const changes = mountSummaryControls("thread");
    pressSegment("Thread");
    expect(armed("simple")).toBe(false);
    expect(armed("tweets")).toBe(false);
    expect(changes).toEqual([]);
  });

  it("arms nothing for merely being on a view", () => {
    /* A pasted `?summary=fuller`, a Back step, a last-view restore: each
       mounts the control with a view already set, and none is a press. */
    mountSummaryControls("fuller");
    expect(armed("simple")).toBe(false);
  });

  it("arms nothing for a visitor, who still gets to choose", () => {
    const changes = mountSummaryControls("brief", null);
    pressSegment("Fuller");
    pressSegment("Thread");
    pressSegment("Brief");
    expect(armed("simple")).toBe(false);
    expect(armed("tweets")).toBe(false);
    /* `value` is a prop the harness does not move, so Brief is "already there". */
    expect(changes).toEqual(["fuller", "thread"]);
  });
});
