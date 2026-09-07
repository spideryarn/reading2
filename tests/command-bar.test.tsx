// @vitest-environment jsdom
/**
 * **The command bar, drawn out of the real `Dock`.**
 *
 * Everything here mounts the actual bottom bar and reaches the command bar the
 * way a reader does — the button in the row, or ⌘/Ctrl-K — rather than
 * rendering `CommandBar` on hand-made props. That is deliberate and it is the
 * only way one of these assertions means anything: *the bar lists exactly what
 * the Dock lists* (Greg's answer 4, docs/plans/260906h-mode-catalog-and-a-command-bar.md)
 * is a claim about two lists agreeing, and a test that hands the same array to
 * both of them proves nothing at all.
 *
 * **What is NOT here is the money**, and that absence is the point of the
 * biggest finding on this plan. Whether a command-bar Enter spends what a Dock
 * press spends cannot be answered by this file or by any comparison of
 * activation tokens: GPT Sol's F4 established that a token is not a post, and
 * Diagram's Force, Drift and Trail spend through **mount-time POSTs that leave
 * no token at all**. So cost parity is asserted in
 * tests/every-mode-draws-its-surface.test.tsx, in the real harness, against
 * what the network actually saw. See its § phase A, and `TRIGGERS`.
 *
 * `showModal`/`close` are stubbed below, for the reason
 * tests/feedback-dialog.test.tsx gives: jsdom implements neither.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { modeGenerates } from "../src/web/activation.js";
import { GENERATES_MARKER, NO_MATCH } from "../src/web/CommandBar.js";
import { Dock } from "../src/web/Dock.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/a-piece");
  /* jsdom implements neither method and `open` is a real attribute, so the
     smallest honest stand-in is the pair of them setting it — the same one
     tests/feedback-dialog.test.tsx and tests/visual-viewport-dialogs.test.tsx
     use. */
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The bar on the reading view, which is the only arrangement that has a band. */
function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the mount sites differ by which optional props are present, and one of these tests is about the arm with no `onMode`
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

const trigger = (): HTMLButtonElement => {
  const button = host.querySelector<HTMLButtonElement>(".dock-commands");
  expect(button, "the bar draws no command-bar button").not.toBeNull();
  return button as HTMLButtonElement;
};

function openBar(): void {
  act(() => trigger().click());
}

const dialog = (): HTMLDialogElement => {
  const el = host.querySelector<HTMLDialogElement>("dialog.cmdbar");
  expect(el, "no command bar in the tree").not.toBeNull();
  return el as HTMLDialogElement;
};

const input = (): HTMLInputElement => dialog().querySelector("input.cmdbar-input") as HTMLInputElement;

const rows = (): HTMLElement[] => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];

/** The mode each row is about, read off the row's own id — which is what `aria-activedescendant` points at. */
const listed = (): string[] =>
  rows().map((row) => row.querySelector(".cmdbar-name")?.textContent ?? "");

/** The mode buttons the Dock itself drew, in the order it drew them. */
const dockLists = (): string[] =>
  [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"]')].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );

/**
 * **Typing, the way React hears it.** Setting `.value` alone is invisible to
 * React's own value tracker, so the native setter is called first and the
 * `input` event dispatched after — the standard workaround, and the reason it
 * is a helper rather than three lines repeated eight times.
 */
function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Which row Enter would take, by the `aria-activedescendant` the input advertises. */
function selected(): string {
  const id = input().getAttribute("aria-activedescendant");
  const row = rows().find((r) => r.id === id);
  expect(row, `aria-activedescendant names ${id}, which is not a row`).toBeDefined();
  return (row as HTMLElement).querySelector(".cmdbar-name")?.textContent ?? "";
}

describe("the bar lists exactly what the Dock lists", () => {
  /**
   * The one rule, in one place. `visibleModes` in Dock.tsx decides which modes
   * the bar draws, the Dock hands that same array down, and this asserts the
   * two ends of it agree — with the switch in each of its two positions,
   * because the whole risk is a second copy of the rule that is right for one
   * of them.
   */
  it("draws the same modes, in the same order, with the switch off", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    openBar();
    expect(listed()).toEqual(dockLists());
    /* The vacuity guard: two empty lists are equal. */
    expect(listed().length).toBeGreaterThan(5);
  });

  it("draws the same modes, in the same order, with the switch on", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    expect(listed()).toEqual(dockLists());
    expect(listed().length).toBe(MODES.length);
  });

  /**
   * **And the two positions really are different**, which is what makes the two
   * assertions above two assertions rather than one written twice. If the
   * switch ever stopped hiding anything, both would still pass.
   */
  it("draws fewer modes with the switch off than with it on", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    openBar();
    const off = listed().length;
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    expect(off).toBeLessThan(listed().length);
  });

  /**
   * Off the reading view there is no band a command could change, so there is
   * no bar and no button — the same condition the mode segment itself is under.
   */
  it("is not drawn at all where the bar has no `onMode`", () => {
    history.replaceState(null, "", "/read/a-piece/metadata");
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: the point of this test is the arm with props missing
        createElement(Dock as any, {
          slug: "a-piece",
          view: "metadata",
          experimental: EXPERIMENTAL_OFF,
        }),
      );
    });
    expect(host.querySelector(".dock-commands")).toBeNull();
    expect(host.querySelector("dialog.cmdbar")).toBeNull();
  });
});

describe("a query that matches nothing", () => {
  /**
   * **Exactly this sentence and nothing beside it**, which is Greg's answer 3
   * — taken over the recommendation put to him, which was to offer the article
   * search as a fallback row. An honest empty state was preferred to a helpful
   * guess, so a later "did you mean" or "search the article instead" has to
   * come back through him.
   */
  it("says `No command matches.` and draws no rows", () => {
    reading();
    openBar();
    type("zzzq");
    expect(rows()).toEqual([]);
    const empty = dialog().querySelector(".cmdbar-empty");
    expect(empty?.textContent).toBe(NO_MATCH);
    expect(NO_MATCH).toBe("No command matches.");
    /* Nothing else in the panel below the box: no list, no fallback row, no
       "everything" list quietly restored. */
    expect(dialog().querySelector('[role="listbox"]')).toBeNull();
  });

  it("does nothing on Enter", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("zzzq");
    press("Enter");
    expect(onMode).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });
});

describe("the keyboard contract", () => {
  it("selects the first row when the bar opens", () => {
    reading();
    openBar();
    expect(selected()).toBe(listed()[0]);
  });

  it("moves down and clamps at the last row", () => {
    reading();
    openBar();
    type("s");
    const all = listed();
    expect(all.length).toBeGreaterThan(2);
    for (let i = 0; i < all.length + 3; i++) press("ArrowDown");
    expect(selected()).toBe(all[all.length - 1]);
  });

  it("moves up and clamps at the first row", () => {
    reading();
    openBar();
    press("ArrowDown");
    press("ArrowDown");
    for (let i = 0; i < 5; i++) press("ArrowUp");
    expect(selected()).toBe(listed()[0]);
  });

  /**
   * **The reset is the one a reader notices going wrong**: arrow down to the
   * fourth row, type one more letter, and Enter would otherwise point at
   * whatever happens to be fourth in a list they have not looked at — which,
   * for five of the fourteen, spends money.
   */
  it("goes back to the first row whenever the filter changes", () => {
    reading();
    openBar();
    press("ArrowDown");
    press("ArrowDown");
    expect(selected()).not.toBe(listed()[0]);
    type("s");
    expect(selected()).toBe(listed()[0]);
  });

  it("opens the selected mode on Enter, then closes and clears", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("toc");
    expect(listed()).toEqual([MODE_LABEL.hierarchy]);
    press("Enter");
    expect(onMode).toHaveBeenCalledWith("hierarchy");
    expect(dialog().open).toBe(false);
    /* The draft does not survive a close — 260906h § Deliberately deferred. */
    openBar();
    expect(input().value).toBe("");
  });

  it("opens the mode a row is clicked on", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("toc");
    act(() => rows()[0]?.click());
    expect(onMode).toHaveBeenCalledWith("hierarchy");
    expect(dialog().open).toBe(false);
  });
});

/**
 * **Which modes would start work if you opened them** — written out by hand, as
 * a total record, and NOT derived from `modeGenerates`.
 *
 * The property this file is really asserting is that **mode fifteen cannot
 * arrive unmarked**. `modeGenerates` reads `MODE_TARGET`, which is already
 * total, so the accessor cannot forget a mode — but an accessor that answered
 * `false` for everything would also satisfy "no mode is forgotten", and the bar
 * would quietly stop disclosing anything. `Record<Mode, boolean>` here makes a
 * fifteenth word in `MODES` a **compile error in this file**, so somebody has
 * to decide, and the decision is checked against a table written for a
 * different purpose. Same shape and same reason as `BEHIND_THE_SWITCH` in
 * tests/dock-experimental-modes.test.tsx and `SPENDS` in
 * tests/every-mode-draws-its-surface.test.tsx.
 *
 * The rule it is written from is the product one: *opening a mode with nothing
 * behind it generates it*. Five artefact modes and Diagram; the other eight
 * have nothing to fill until the reader has typed, written or pressed something
 * one level down.
 */
const GENERATES: Record<Mode, boolean> = {
  plain: false,
  hierarchy: false,
  outline: false,
  summary: false,
  search: false,
  chat: false,
  referee: false,
  remember: false,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  debate: true,
  diagram: true,
};

/**
 * **A visitor gets no command bar at all**, and this is a capability gate
 * rather than a tidiness one.
 *
 * A visitor reading somebody else's shared document may press the mode buttons
 * they are given, and what stops those buying anything is `POLICY` in
 * visitor.ts plus each band's own guards — a seam reasoned about one control at
 * a time. A second, faster door into the same activations is not a thing to add
 * to that seam on the way past.
 *
 * It is asserted here as well as in tests/public-network-trace.test.tsx because
 * that file is a trace of one signed-out session and this is the rule; the
 * first would still pass if the bar were merely hidden rather than absent.
 */
describe("a visitor", () => {
  it("is given no command-bar button and no bar", () => {
    reading({ visitor: true });
    expect(host.querySelector(".dock-commands")).toBeNull();
    expect(host.querySelector("dialog.cmdbar")).toBeNull();
  });

  it("cannot open one with the chord either", () => {
    reading({ visitor: true });
    expect(chord()).toBe(false);
    expect(host.querySelector("dialog.cmdbar")).toBeNull();
  });

  /** And the owner on the same page still gets both, so the gate is the visitor flag and not a mistake. */
  it("is the only reader who does not — an owner still gets it", () => {
    reading();
    expect(host.querySelector(".dock-commands")).not.toBeNull();
    expect(host.querySelector("dialog.cmdbar")).not.toBeNull();
  });
});

/**
 * **The two ways in must obey the same policy**, which is GPT Sol's F1 and F2
 * on stage 2. Both were fixed by moving something into the one place both doors
 * pass through — the opening policy into `show`, the draft reset into the
 * layout effect that calls `showModal()`.
 */
describe("opening is one policy, whichever door", () => {
  /**
   * The drawer is deliberately non-modal, so the Dock stays clickable
   * underneath it. That is why the button could open the bar over an open
   * drawer while the chord could not: the policy was in the keydown handler and
   * the button called a bare setter beside it.
   */
  it("closes the Dock drawer when the button is the door, not only the chord", () => {
    const onPanel = vi.fn();
    reading({
      drawer: {
        panel: "questions",
        onPanel,
        comments: [],
        onOpenComment: () => {},
        loaded: true,
        loadFailed: false,
      },
    });
    openBar();
    expect(onPanel).toHaveBeenCalledWith(null);
    expect(dialog().open).toBe(true);
  });

  /**
   * **The invariant, and honestly not the timing.** Escape and a backdrop click
   * shut the dialog without clearing, so the draft survived to the next open —
   * and, before GPT Sol's F1, was reset by a *passive* effect, one painted
   * frame after `showModal()`. The fix moved the reset into the layout effect.
   *
   * **This test would pass either way**, and it was checked by putting the bug
   * back: in jsdom a layout effect and a passive effect both run inside `act`,
   * so there is no frame between them to observe. Said out loud because a test
   * that cannot fail for the reason you think is worse than no test —
   * docs/reusable/silent-success.md — and because CommandBar.tsx's own
   * `useLayoutEffect` docblock makes the same admission about FeedbackDialog,
   * which is the precedent it follows.
   *
   * What it does hold is the invariant underneath: **a reopened bar is empty**,
   * whatever mechanism gets it there. That is worth a test on its own; the
   * frame is worth a pair of eyes, and it got them in the browser pass.
   */
  it("opens empty after a shutdown that left a query behind", () => {
    reading();
    openBar();
    type("zzzz");
    expect(dialog().textContent).toContain(NO_MATCH);
    act(() => dialog().dispatchEvent(new Event("close")));
    openBar();
    expect(input().value).toBe("");
    expect(dialog().textContent).not.toContain(NO_MATCH);
    expect(rows().length).toBeGreaterThan(0);
  });
});

describe("the `generates` marker", () => {
  it("is what `modeGenerates` says, for every one of the fourteen", () => {
    const disagree = MODES.filter((m) => modeGenerates(m) !== GENERATES[m]);
    expect(
      disagree,
      "MODE_TARGET and this file's hand-written list disagree about which modes start work. " +
        "One of them is wrong; decide which, and do not fix it by deriving this list.",
    ).toEqual([]);
  });

  it("is on every row that would start work, and on no other row", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    const marked = rows().map((row) => row.querySelector(".cmdbar-generates")?.textContent ?? null);
    const names = listed();
    const wrong = names
      .map((name, at) => ({ name, marker: marked[at] }))
      .filter(({ name, marker }) => {
        const mode = MODES.find((m) => MODE_LABEL[m] === name) as Mode;
        return (marker === GENERATES_MARKER) !== GENERATES[mode];
      });
    expect(wrong).toEqual([]);
  });

  /**
   * The vacuity guard, and it needs both halves: a bar that marked every row,
   * or none, would satisfy a check that only looked at one of them.
   */
  it("is present on some rows and absent from others", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    const marked = rows().filter((row) => row.querySelector(".cmdbar-generates") !== null);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(rows().length);
    expect(marked[0]?.textContent).toContain(GENERATES_MARKER);
  });
});

/** ⌘-K on a Mac, Ctrl-K everywhere else — one listener, on `window`. */
function chord(over: KeyboardEventInit = {}): boolean {
  const e = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...over,
  });
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

describe("⌘/Ctrl-K", () => {
  it("opens the bar, and claims the press", () => {
    reading();
    expect(dialog().open).toBe(false);
    expect(chord()).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it("opens on Ctrl as well as on ⌘", () => {
    reading();
    expect(chord({ metaKey: false, ctrlKey: true })).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it("ignores a key repeat", () => {
    reading();
    expect(chord({ repeat: true })).toBe(false);
    expect(dialog().open).toBe(false);
  });

  it("leaves a bare k alone", () => {
    reading();
    expect(chord({ metaKey: false })).toBe(false);
    expect(dialog().open).toBe(false);
  });

  /**
   * **Not while somebody is writing.** The chat box, the comment box, the
   * search field and the referee's criteria are all places a reader is typing,
   * and ⌘-K is a text-editing chord in several editors.
   */
  it("does not fire while a text field has focus", () => {
    reading();
    const box = document.createElement("textarea");
    document.body.append(box);
    box.focus();
    expect(chord()).toBe(false);
    expect(dialog().open).toBe(false);
    box.remove();
  });

  /**
   * **Not over another native modal.** Two `showModal()` dialogs stack in the
   * top layer and trap focus in the newer one; the Feedback dialog, the
   * Lightbox and the comment dialogs are all `<dialog>`s, so one query answers
   * for all of them.
   */
  it("does not open over another open dialog", () => {
    reading();
    const other = document.createElement("dialog");
    other.open = true;
    document.body.append(other);
    expect(chord()).toBe(false);
    expect(dialog().open).toBe(false);
    other.remove();
  });

  /**
   * **The drawer is shut first**, and this is GPT Sol's F6. The drawer's own
   * Escape handler is on `window` in the **capture** phase and calls
   * `stopImmediatePropagation`, so with both open one Escape would close the
   * drawer the reader cannot see and the bar in front of them would never hear
   * the key at all.
   */
  it("closes the Dock drawer before opening", () => {
    const onPanel = vi.fn();
    reading({
      drawer: { panel: "questions", onPanel, comments: [], onOpenComment: () => {}, loaded: true, loadFailed: false },
    });
    expect(chord()).toBe(true);
    expect(onPanel).toHaveBeenCalledWith(null);
    expect(dialog().open).toBe(true);
  });

  /**
   * **Shift is rejected rather than ignored**, and this is GPT Sol's F3 on
   * stage 2. Ctrl-Shift-K is Firefox's Web Console; a handler that matched it
   * would steal a browser feature *and* `preventDefault()` it, which is the
   * worst of both — the console does not open and neither does anything else.
   */
  it("leaves Ctrl/Cmd-Shift-K to the browser", () => {
    reading();
    expect(chord({ shiftKey: true })).toBe(false);
    expect(dialog().open).toBe(false);
  });

  it("leaves Ctrl/Cmd-Alt-K to the browser", () => {
    reading();
    expect(chord({ altKey: true })).toBe(false);
    expect(dialog().open).toBe(false);
  });

  it("is not listened for where the bar has no `onMode`", () => {
    history.replaceState(null, "", "/read/a-piece/metadata");
    act(() => {
      root.render(
        // biome-ignore lint/suspicious/noExplicitAny: as above — this arm is missing props on purpose
        createElement(Dock as any, {
          slug: "a-piece",
          view: "metadata",
          experimental: EXPERIMENTAL_OFF,
        }),
      );
    });
    expect(chord()).toBe(false);
  });
});
