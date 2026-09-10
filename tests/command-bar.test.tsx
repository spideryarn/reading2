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
import { modeGenerates, pendingActivation, resetActivations } from "../src/web/activation.js";
import { GENERATES_MARKER, NO_MATCH } from "../src/web/CommandBar.js";
import { Dock } from "../src/web/Dock.js";
import { FeedbackHost } from "../src/web/FeedbackButton.js";
import { CHANGELOG_LABEL } from "../src/web/router.js";
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
  /* **Armed activations are module state and outlive a render**, so a Tweets
     row pressed in one test would be found still pending by the next — which
     is how a check that arming *happened* passes for a bar that armed nothing.
     activation.ts § `resetActivations` exists for exactly this. */
  resetActivations();
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

/**
 * **A drawer, of the shape the reading view really passes** (Reader.tsx), so
 * that the bar draws its Comments button and the command bar gets its
 * `openComments`. Empty and loaded, because none of the rows here is about what
 * is in it.
 */
const A_DRAWER = {
  comments: [],
  loaded: true,
  loadFailed: false,
  error: null,
  panel: null,
  onPanel: () => {},
};

/**
 * **The same bar with a `FeedbackHost` above it**, which is what the signed-in
 * app has (App.tsx mounts the host below its signed-in gate).
 *
 * It is a separate helper rather than the default because the *absence* of a
 * host is half of what the Feedback row asserts: `useFeedbackOpen()` answers
 * `null` where there is none, and the row is then not drawn at all rather than
 * drawn dead. Every other test in this file mounts the bare `Dock`, so they are
 * all incidentally the no-host case.
 */
function readingSignedIn(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      createElement(
        FeedbackHost,
        null,
        // biome-ignore lint/suspicious/noExplicitAny: as `reading` above
        createElement(Dock as any, {
          slug: "a-piece",
          view: "article",
          mode: "plain",
          onMode: () => {},
          experimental: EXPERIMENTAL_OFF,
          ...props,
        }),
      ),
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

/**
 * **The two kinds of row, told apart the way the bar itself tells them apart.**
 *
 * By `data-kind`, which `CommandBar` writes off the `Command` union — not by
 * matching a label against `MODE_LABEL`, and not by looking for a leading `/`
 * in the row id. Both of those would infer the kind from something that is
 * *usually* true of it, and would go on passing if a page row started being
 * built as a mode.
 */
type RowKind = "mode" | "page" | "action";

const rowsOfKind = (kind: RowKind): HTMLElement[] =>
  rows().filter((row) => row.dataset.kind === kind);

const listedOfKind = (kind: RowKind): string[] =>
  rowsOfKind(kind).map((row) => row.querySelector(".cmdbar-name")?.textContent ?? "");

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

describe("the bar's mode rows are exactly what the Dock lists", () => {
  /**
   * The one rule, in one place. `visibleModes` in Dock.tsx decides which modes
   * the bar draws, the Dock hands that same array down, and this asserts the
   * two ends of it agree — with the switch in each of its two positions,
   * because the whole risk is a second copy of the rule that is right for one
   * of them.
   *
   * **`listedOfKind("mode")` rather than every row, since 2026-09-07**, when
   * Greg added the changelog to the bar and product call 4 narrowed from *the
   * bar lists exactly what the Dock lists* to this. The narrowing is the point
   * of the extra word: the pages are the bar's own and the Dock has no opinion
   * about them, but the mode rows must still be the Dock's array untouched.
   * CommandBar.tsx § call 4.
   */
  it("draws the same modes, in the same order, with the switch off", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    openBar();
    expect(listedOfKind("mode")).toEqual(dockLists());
    /* The vacuity guard: two empty lists are equal. */
    expect(listedOfKind("mode").length).toBeGreaterThan(5);
  });

  it("draws the same modes, in the same order, with the switch on", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    expect(listedOfKind("mode")).toEqual(dockLists());
    expect(listedOfKind("mode").length).toBe(MODES.length);
  });

  /**
   * **And the two positions really are different**, which is what makes the two
   * assertions above two assertions rather than one written twice. If the
   * switch ever stopped hiding anything, both would still pass.
   */
  it("draws fewer modes with the switch off than with it on", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    openBar();
    const off = listedOfKind("mode").length;
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    expect(off).toBeLessThan(listedOfKind("mode").length);
  });

  /**
   * **The other half of the narrowed call**: the pages exist, and they are
   * beneath the modes rather than mixed in among them.
   *
   * Without this, the three assertions above would all still pass if the page
   * rows had silently stopped being drawn — they filter to mode rows, and a
   * list with nothing else in it filters to itself.
   */
  /**
   * **Every row has an id of its own**, over the list the bar really renders —
   * which is the guard `commandId`'s prefix exists for. Ids share one namespace
   * (the `id` attribute `aria-activedescendant` points at), and a page whose
   * href were spelled like a mode's name would have collided under the scheme
   * this replaced. tests/command-match.test.ts states that as a unit; this
   * states it over the actual `besideTheModes`, which is the list a future entry lands
   * in.
   */
  it("gives every row it draws a distinct id", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    const ids = rows().map((row) => row.id);
    expect(ids.length).toBeGreaterThan(MODES.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * **Every mode comes before everything that is not one** — which is product
   * call 4 as it stands, and it is the claim that survives a third kind of row
   * arriving.
   *
   * It said *"draws its page rows after every mode row"* until 2026-09-08 and
   * asserted that every row from the first page onwards was itself a page. That
   * was true while pages were the only other kind and became false the moment
   * the Feedback row landed at the end as an `action` — GPT Sol predicted the
   * failure from the plan alone, before either was written. The fix is to state
   * the boundary the caller actually maintains (`CommandBar` § `commands`
   * spreads the modes, then `besideTheModes`) rather than the composition of
   * what happens to be on the far side of it.
   */
  it("draws every row that is not a mode after every mode row", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    const kinds = rows().map((row) => row.dataset.kind);
    const firstOther = kinds.findIndex((k) => k !== "mode");
    expect(firstOther, "nothing but modes in the bar at all").toBeGreaterThan(-1);
    /* Said as a slice rather than as a sort, which would have leaned on
       `"mode" < "page"` being alphabetical and would keep passing under a
       rename to `"link"`. */
    expect(kinds.slice(firstOther).some((k) => k === "mode")).toBe(false);
    /* And there is at least one mode above it, so this is not being satisfied
       by a bar with no modes in it. */
    expect(firstOther).toBeGreaterThan(0);
  });

  /**
   * **And the two kinds below the modes are in the order `besideTheModes`
   * builds them**, which is what a reader sees on an empty query: this
   * article's rows, the app's pages, then the one thing to *do*.
   *
   * Separate from the test above deliberately — that one is the product call,
   * this one is the arrangement, and folding them together is how a genuine
   * change to the arrangement comes to look like a broken promise.
   */
  it("draws the Feedback action last, below the pages", () => {
    readingSignedIn({ experimental: EXPERIMENTAL_ON });
    openBar();
    const names = listed();
    const feedback = names.indexOf("Feedback");
    expect(feedback, "no Feedback row — is there a FeedbackHost above the Dock?").toBeGreaterThan(
      -1,
    );
    expect(feedback).toBe(names.length - 1);
    /* The changelog is the last of the pages, so this pins the boundary
       between the two rather than only the far end of the list. */
    expect(names.indexOf(CHANGELOG_LABEL)).toBe(feedback - 1);
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
 * **The backdrop, which is the one way out of the bar that nothing tested.**
 *
 * Five native `<dialog>`s in this app close on a press outside them, all five
 * by the same three lines — an `onClick` on the dialog and
 * `if (e.target === ref.current) onClose()`. Until 2026-09-07 not one test
 * anywhere dispatched a click whose target was the dialog;
 * tests/feedback-dialog.test.tsx § *the backdrop* is the first of the five and
 * carries the measurement of how much of it was really unprotected.
 *
 * **Why the target comparison is the whole mechanism.** A modal `<dialog>`'s
 * `::backdrop` is not a separate element: a press on the dimmed area arrives
 * with the dialog itself as the target, while a press on anything the dialog
 * contains arrives with that child and bubbles up through the same handler. One
 * equality test therefore separates "outside" from "inside", and losing it
 * turns every press in the panel into a dismissal — here that means the reader
 * clicking into the box to place a cursor loses the query they were typing.
 *
 * jsdom has no `showModal` and no `::backdrop`, and neither is needed: the
 * handler compares targets and nothing else. That a real backdrop press does
 * target the dialog is the platform's contract, which is why these assert on
 * the target rather than on a pixel.
 *
 * Mounted through the real `Dock`, like everything else in this file, so `open`
 * is a parent's state and `onClose` genuinely shuts it — with the prop nailed
 * open, a deleted `onClose()` would pass.
 */
describe("the backdrop", () => {
  it("closes on a press whose target is the dialog itself", () => {
    reading();
    openBar();
    expect(dialog().open, "the bar never opened, so nothing below means anything").toBe(true);
    act(() => {
      dialog().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog().open).toBe(false);
  });

  it("stays open when the press lands on something inside it", () => {
    reading();
    openBar();
    type("toc");
    act(() => {
      input().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog().open).toBe(true);
    /* The query is what is being protected: a press in the box that dismissed
       the bar would throw away what the reader had typed, since a reopened bar
       is empty by design. */
    expect(input().value).toBe("toc");
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
  /* Views of one already-built tree, in either of Structure's faces, so
     nothing to fill. */
  structure: false,
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

  it("is on every mode row that would start work, and on no other mode row", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    /* **Mode rows only**, and the `MODES.find` below is why that matters rather
       than being tidiness: a page row's name is in no `MODE_LABEL`, so it used
       to fall out of that lookup as `undefined`, index into `GENERATES` as
       `undefined`, and be reported as a mode that disagreed with itself. The
       page rows get their own assertion underneath. */
    const marked = rowsOfKind("mode").map(
      (row) => row.querySelector(".cmdbar-generates")?.textContent ?? null,
    );
    const wrong = listedOfKind("mode")
      .map((name, at) => ({ name, marker: marked[at] }))
      .filter(({ name, marker }) => {
        const mode = MODES.find((m) => MODE_LABEL[m] === name) as Mode;
        return (marker === GENERATES_MARKER) !== GENERATES[mode];
      });
    expect(wrong).toEqual([]);
  });

  /**
   * **The page rows split, and that is the point of 2026-09-08.**
   *
   * This test said *"is on no page row"* until then, and its own comment said
   * why that was all it could honestly claim: the renderer excluded every page
   * by `kind`, so *"a page that did start work would be unmarked here and this
   * test would stay green while the bar under-warned"* (GPT Sol, 2026-09-07).
   *
   * Tweets is that page — it arms a run over the whole article on its way to
   * the thread — so the claim is now the one that could not be made before:
   * **the marker follows the row's own `generates`, not its kind.** Both halves
   * are named rows rather than counts, because *some page has it and some page
   * does not* would be satisfied by the two being the wrong way round.
   */
  it("is on the page row that spends and not on the ones that only go somewhere", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    const marked = new Map(
      rowsOfKind("page").map((row) => [
        row.querySelector(".cmdbar-name")?.textContent ?? "",
        row.querySelector(".cmdbar-generates") !== null,
      ]),
    );
    expect(marked.get("Tweets"), "the Tweets row is missing").toBe(true);
    expect(marked.get("Metadata"), "the Metadata row is missing").toBe(false);
    expect(marked.get("Library"), "the Library row is missing").toBe(false);
    expect(marked.get(CHANGELOG_LABEL), "the changelog row is missing").toBe(false);
  });

  /**
   * **An action row never carries it either**, which is true of both of today's
   * two and is a fact about them rather than about the arm — an action that
   * spent would say so through the same `generates` field the pages use, since
   * `commandGenerates` reads it off `CommandWords` and not off the kind.
   */
  it("is on no action row", () => {
    /* Both of them, so this is not asserting over a list of one: Comments needs
       a drawer and Feedback needs a host above the bar. */
    readingSignedIn({ experimental: EXPERIMENTAL_ON, drawer: A_DRAWER });
    openBar();
    const actions = rowsOfKind("action");
    expect(actions.length, "both actions should be here").toBe(2);
    expect(actions.length, "no action rows, so this asserts nothing").toBeGreaterThan(0);
    for (const row of actions) expect(row.querySelector(".cmdbar-generates")).toBeNull();
  });

  /**
   * The vacuity guard, and it needs both halves: a bar that marked every row,
   * or none, would satisfy a check that only looked at one of them.
   */
  it("is present on some rows and absent from others", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    openBar();
    /* Counted over the **mode** rows, because the page rows never carry it:
       measured over every row, the "absent from others" half would be satisfied
       by the changelog row alone, and would go on passing if every mode in the
       app started generating. */
    const modeRows = rowsOfKind("mode");
    const marked = modeRows.filter((row) => row.querySelector(".cmdbar-generates") !== null);
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.length).toBeLessThan(modeRows.length);
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

/**
 * **The changelog, which is the bar's one row that is not a mode.**
 *
 * Greg, 2026-09-07: *"add the Changelog to the footer (e.g. of the Homepage,
 * and also as a command from the Command Bar."* That overrode product call 1 —
 * modes only — and narrowed call 4; CommandBar.tsx § the header carries the
 * reasoning and § `besideTheModes` carries the list.
 *
 * **Against the real `besideTheModes`, through the real `Dock`**, like everything else
 * in this file: the words a reader would actually type are the substance of
 * this change, and a hand-made fixture would let all four of these pass while
 * the shipped entry answered to nothing. tests/command-match.test.ts covers the
 * *ranking* of a page with a fixture, which is a different claim.
 */
describe("the changelog command", () => {
  /* `CHANGELOG_LABEL` is imported at the top of this file now, rather than
     spelled out here again. It was a local copy carrying a `’` that had to
     match router.ts's by hand — and the whole reason that constant exists is
     that four places were doing exactly this (router.ts § `CHANGELOG_LABEL`).
     Importing it also means the apostrophe test below is comparing the reader's
     three spellings against the one string the page really uses. */

  /** Where the bar sent the reader, or `null` if it did not. */
  const wentTo = (): string | null =>
    location.pathname === "/read/a-piece" ? null : location.pathname;

  it("is found by the words a reader would type for it", () => {
    reading();
    openBar();
    for (const query of ["changelog", "releases", "updates"]) {
      type(query);
      expect(listed(), `typing ${JSON.stringify(query)} did not offer the changelog`).toContain(
        CHANGELOG_LABEL,
      );
    }
  });

  /**
   * **All three ways of typing the label, and the middle one is why this test
   * exists.** `canonical` does not fold punctuation, so `’`, `'` and no
   * apostrophe at all are three different strings to the matcher.
   *
   * The straight `'` is what a desktop keyboard produces and it matched
   * *nothing* when this shipped — the likeliest spelling of the label, and the
   * one form the alias list left out. GPT Sol found it on 2026-09-07; the
   * loop is written out one query per line so the next person can see all
   * three are covered rather than trusting a comment.
   */
  it("is found however the reader spells the apostrophe", () => {
    reading();
    openBar();
    for (const query of ["what’s new", "what's new", "whats new"]) {
      type(query);
      expect(listed(), `typing ${JSON.stringify(query)} did not offer the changelog`).toEqual([
        CHANGELOG_LABEL,
      ]);
    }
  });

  it("navigates on Enter, and opens no mode", () => {
    const onMode = vi.fn();
    reading({ onMode });
    openBar();
    type("changelog");
    expect(listed()).toEqual([CHANGELOG_LABEL]);
    press("Enter");
    expect(wentTo()).toBe("/changelog");
    /* **The half that is easy to leave out.** A page row that also armed a mode
       would spend on the way out of the article, and nothing the reader could
       see would say so. */
    expect(onMode).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });

  it("navigates on a click, like every other row", () => {
    reading();
    openBar();
    type("changelog");
    act(() => rows()[0]?.click());
    expect(wentTo()).toBe("/changelog");
    expect(dialog().open).toBe(false);
  });

  /**
   * **A mode row still changes no address**, which is the regression the two
   * tests above cannot catch: a page-shaped `navigate` that fired on every
   * Enter would satisfy both of them.
   *
   * It is *not* the vacuity guard for `wentTo()`, which an earlier version of
   * this comment claimed (GPT Sol, 2026-09-07). What guarantees the address did
   * not simply start at `/changelog` is `beforeEach`, which puts every test at
   * `/read/a-piece`.
   */
  it("leaves the address alone when a mode row is taken", () => {
    reading({ onMode: () => {} });
    openBar();
    type("toc");
    press("Enter");
    expect(wentTo()).toBeNull();
  });
});

/**
 * **The seven rows of 2026-09-08**, from Greg's feedback report
 * (SPIDERYARN-READING2-2D, and docs/plans/260908e-…):
 *
 * > Add Library, Feedback, Metadata, Tweets, Homepage, Profile, and a few more
 * > likely/useful commands to Command Bar.
 */
describe("the rows that are not modes", () => {
  /** Where the bar sent the reader, or `null` if it did not. */
  const wentTo = (): string | null =>
    location.pathname === "/read/a-piece" ? null : location.pathname;

  it("offers each of the ones Greg named, by the name he used", () => {
    readingSignedIn({ drawer: A_DRAWER });
    openBar();
    /* By label rather than by count, because a count passes for the wrong seven
       — and each of these is one of his six, with `Homepage` folded into
       Library per the plan's § Library and Homepage are one row. */
    const names = listed();
    for (const label of ["Metadata", "Tweets", "Comments", "Library", "Profile", "Feedback"]) {
      expect(names, `no row called ${label}`).toContain(label);
    }
  });

  /**
   * **Homepage is a way of typing Library, not a second row.** Both of Greg's
   * words reach it, and only one row comes back — which is the whole of the
   * collapse, and the thing that would break silently if somebody later added
   * the second row he literally asked for. Two rows at `href: "/"` would share
   * the id `page:/`, and an id is what `aria-activedescendant` points at.
   */
  it("answers both `library` and `homepage` with the one Library row", () => {
    readingSignedIn();
    openBar();
    for (const query of ["library", "homepage", "home", "add an article"]) {
      type(query);
      const names = listed();
      /* **First, and exactly once.** Not *alone*, which is what this asserted
         first and which `library` fails: `Public shelf` carries the alias
         `public library`, so it is an alias-substring hit and ranks below.
         That is the ranking working — a label prefix beats a substring
         (command-match.ts § `TIERS`) — and demanding a one-row answer would
         have been this test insisting on a worse bar. What matters is that
         Greg's two words reach the same row, and that there is only ever one
         of it. */
      expect(names[0], `typing ${JSON.stringify(query)} did not put Library first`).toBe("Library");
      expect(names.filter((n) => n === "Library")).toHaveLength(1);
    }
  });

  it("navigates to this article's metadata page, carrying the reader's place", () => {
    history.replaceState(null, "", "/read/a-piece?at=spya-k3m9qt");
    readingSignedIn();
    openBar();
    type("metadata");
    press("Enter");
    /* The path *and* the query: `?at=` is how coming back returns you to the
       paragraph you left (Dock.tsx § `search`), and a row that dropped it would
       look right in a path-only assertion and lose the reader's place. */
    expect(wentTo()).toBe("/read/a-piece/metadata");
    expect(location.search).toBe("?at=spya-k3m9qt");
  });

  /**
   * **The Tweets row arms the run *and* says it will**, and both halves are
   * here because either alone is the bug.
   *
   * Arming without the marker is the silent-spending hole GPT Sol refused an
   * optional `generates` over on 2026-09-08. The marker without the arming is
   * the opposite failure and is what the plan's simpler option would have
   * shipped: a row that promises to start something, then lands the reader on
   * the thread page with a button still to press.
   *
   * `pendingActivation` is read rather than a spy on `armActivationForTweets`,
   * so what is asserted is the state the run really consumes — `beforeEach`
   * clears it, which is what makes "it was armed here" mean anything.
   */
  it("arms the thread run on the way to it, and wears the `generates` marker", () => {
    readingSignedIn();
    openBar();
    type("tweets");
    expect(listed()).toEqual(["Tweets"]);
    expect(rows()[0]?.querySelector(".cmdbar-generates")?.textContent).toBe(GENERATES_MARKER);
    expect(pendingActivation("a-piece", "tweets"), "armed before the press").toBeNull();
    press("Enter");
    expect(wentTo()).toBe("/read/a-piece/tweets");
    expect(pendingActivation("a-piece", "tweets"), "the press armed nothing").not.toBeNull();
  });

  /**
   * The vacuity guard for the line above: `pendingActivation` answering
   * non-null has to be something this press did, not something every press
   * does. Metadata is the neighbouring row and arms nothing.
   */
  it("arms nothing when a row that only navigates is taken", () => {
    readingSignedIn();
    openBar();
    type("metadata");
    press("Enter");
    expect(pendingActivation("a-piece", "tweets")).toBeNull();
  });

  /**
   * **Comments opens the drawer rather than going anywhere**, which is the one
   * row here that is neither a mode nor a page and does not leave the page.
   */
  it("opens the comments drawer, without changing the address", () => {
    const onPanel = vi.fn();
    readingSignedIn({
      drawer: { comments: [], loaded: true, loadFailed: false, error: null, panel: null, onPanel },
    });
    openBar();
    type("comments");
    expect(listed()).toEqual(["Comments"]);
    press("Enter");
    expect(onPanel).toHaveBeenCalledWith("questions");
    expect(wentTo()).toBeNull();
    expect(dialog().open).toBe(false);
  });

  it("offers no Comments row where the bar has no drawer", () => {
    /* The other half, and it is why `openComments` is optional: the row is
       built from the callback rather than gated on a boolean beside it, so a
       bar with no drawer has no row instead of a row that does nothing. */
    readingSignedIn();
    openBar();
    type("comments");
    expect(listed()).not.toContain("Comments");
  });

  /**
   * **Feedback opens the dialog**, and it is the only row that neither
   * navigates nor touches the band — the `action` arm's one production caller.
   */
  it("opens the feedback dialog and leaves the address alone", () => {
    readingSignedIn();
    openBar();
    type("feedback");
    expect(listed()).toEqual(["Feedback"]);
    expect(document.querySelector("dialog.fb-dialog")?.hasAttribute("open")).toBe(false);
    press("Enter");
    expect(document.querySelector("dialog.fb-dialog")?.hasAttribute("open")).toBe(true);
    expect(wentTo()).toBeNull();
  });

  /**
   * **No host above, no row** — the rule `FeedbackTrigger` already followed and
   * `useFeedbackOpen` restates in a return type. A row drawn here would be one
   * that pressed nothing, which is worse than an absent row because the reader
   * would have no way to tell.
   */
  it("offers no Feedback row where nothing has mounted the dialog", () => {
    reading();
    openBar();
    type("feedback");
    expect(listed()).not.toContain("Feedback");
    expect(dialog().textContent).toContain(NO_MATCH);
  });
});

/**
 * **Where the button sits in the row**, which is the other half of Greg's
 * report and the half no other test in this file can see: every one of them
 * finds `.dock-commands` by selector, so leaving it at the far end of the bar
 * would keep them all green. GPT Sol asked for this, 2026-09-08.
 *
 * > And move Command bar to the left of the Dock, just after the logo.
 */
describe("the Commands button's place in the bar", () => {
  /** The bar's own children, in the order they are drawn. */
  const barChildren = (): Element[] => {
    const dock = host.querySelector(".dock");
    expect(dock, "no `.dock` in the tree").not.toBeNull();
    return [...(dock as Element).children];
  };

  it("comes after the wordmark and before the modes", () => {
    reading();
    const at = (selector: string) => barChildren().findIndex((el) => el.matches(selector));
    const home = at(".dock-home");
    const commands = at(".dock-commands");
    const modes = at(".dock-modes");
    expect(home, "no wordmark in the bar").toBeGreaterThan(-1);
    expect(commands, "no Commands button in the bar").toBeGreaterThan(-1);
    expect(modes, "no mode segment in the bar").toBeGreaterThan(-1);
    /* **`home + 1`, not merely `> home`**, and GPT Sol is the reason: Greg asked
       for *"just after the logo"*, and two inequalities would go on passing with
       anything at all slipped in between — which is a different bar from the one
       he asked for, and the one assertion that would not have noticed.

       Indices rather than `nextElementSibling` so that an intruder is a legible
       failure (`expected 2 to be 1`) rather than a null dereference. */
    expect(commands, "something is between the wordmark and Commands").toBe(home + 1);
    expect(commands).toBeLessThan(modes);
  });

  /**
   * **And it is still not a fifteenth mode.** The move put it next to the
   * radiogroup, which is the arrangement in which being mistaken for a member
   * is cheapest — `DockCommands` § Three ways it says it is not a fifteenth
   * mode makes the claim and this is the half a screen reader would feel.
   */
  it("stays outside the radiogroup, and claims none of its state", () => {
    reading();
    const button = host.querySelector(".dock-commands") as HTMLElement;
    expect(button.closest('[role="radiogroup"]')).toBeNull();
    for (const attr of ["aria-checked", "aria-current", "aria-pressed"]) {
      expect(button.hasAttribute(attr), `it claims ${attr}`).toBe(false);
    }
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });
});
