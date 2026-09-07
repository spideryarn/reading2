// @vitest-environment jsdom
/**
 * **The "How Referee mode works" card: one bit, on this device, and a band that
 * survives a browser refusing to keep it.**
 *
 * Three things this file is written against, each named with the mutation it
 * catches, because a card is exactly the kind of thing whose failures are
 * invisible — nothing throws, nothing looks broken, and the referee only finds
 * out on the next paper.
 *
 *  - **Shutting it is remembered.** Delete the `rememberHowCard(true)` in
 *    `useHowCard`, or write the bit only into React state, and the card is shut
 *    for the rest of the mount and back on the next article. Caught by
 *    remounting and looking again.
 *  - **Reopening un-remembers it.** Make `show` write `true` unconditionally, or
 *    write nothing on the way back open, and the header button works once and
 *    then the card is gone again on the next paper — which reads as the button
 *    not having worked. Caught by pressing it and remounting.
 *  - **`localStorage` throwing must not take the band down.** Safari's private
 *    mode throws on `getItem` outright, site data can be blocked, and under
 *    vitest `window.localStorage` is plain `undefined`, so an unguarded
 *    `.getItem` is a `TypeError` — thrown inside a `useState` initialiser,
 *    which unmounts the whole band. Remove either `try`/`catch` in
 *    src/web/referee-card.ts and this file goes red. It is the same trap
 *    `install-hint.ts` records, and the reason that module exists separately.
 *
 * ## Why the fake store, rather than jsdom's
 *
 * There isn't one: `window.localStorage` is `undefined` in this suite, measured
 * rather than assumed (the run prints *"localStorage is not available because
 * --localstorage-file was not provided"*). So a persistence test written
 * against the environment would be a test of the `catch` block and nothing
 * else. The fake is installed per test, which also makes the throwing case
 * something this file states rather than inherits.
 *
 * ## And the wiring, which no render can see
 *
 * Mounting `Reader` to reach `RefereeBand` would pull in the whole page. The two
 * facts that live in the mode controller — the card is inside `.ref-panel` and
 * *not* inside `.ref-brief`, and the header carries the button that brings it
 * back — are asserted against the source text, which is
 * tests/referee-band-fits.test.ts's method for exactly this seam and for the
 * same reason: delete the placement and every rendering test still passes.
 *
 * That controller left `App.tsx` for src/web/modes/referee/RefereeMode.tsx on
 * 2026-09-06, and `BAND_FILE` below names it in the guard, so a subject that
 * moves again fails loudly instead of slicing an empty string out of the wrong
 * file — docs/reusable/silent-success.md.
 */
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RefereeHowButton, RefereeHowCard, useHowCard } from "../src/web/RefereeCard.js";
import { howCardDismissed, rememberHowCard } from "../src/web/referee-card.js";

/* ------------------------------------------------------------ the store --- */

/** A `Storage` that keeps its own map, so the test can say what the browser is. */
function fakeStore(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Storage & { map: Map<string, string> };
}

/** A browser that refuses: Safari's private mode, or site data blocked. */
function throwingStore(): Storage {
  const no = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return no();
    },
    clear: no,
    key: no,
    getItem: no,
    setItem: no,
    removeItem: no,
  } as unknown as Storage;
}

function useStore(store: Storage | undefined): void {
  Object.defineProperty(window, "localStorage", { value: store, configurable: true });
}

/* ------------------------------------------------------------ the probe --- */

/**
 * `RefereeBand`'s three lines, and nothing else.
 *
 * The band renders the button in `.band-head` and the card in `.ref-panel`,
 * which is two places in a component this file cannot mount; what is testable
 * about them is that they are driven by one hook, which is what this is.
 */
function Probe() {
  const how = useHowCard();
  return createElement(
    "div",
    null,
    createElement(RefereeHowButton, { open: how.open, onToggle: () => how.show(!how.open) }),
    how.open ? createElement(RefereeHowCard, { onClose: () => how.show(false) }) : null,
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore(undefined);
});

function mount(): void {
  act(() => {
    root.render(createElement(Probe));
  });
}

/** Throw the mount away and make a new one, which is what a new page load is. */
function remount(): void {
  act(() => root.unmount());
  root = createRoot(host);
  mount();
}

function card(): Element | null {
  return host.querySelector(".ref-how-card");
}

function press(selector: string): void {
  const el = host.querySelector(selector);
  if (!el) throw new Error(`nothing matches ${selector}`);
  act(() => {
    (el as HTMLElement).click();
  });
}

/* ------------------------------------------------------------- the tests -- */

describe("the explainer card remembers one bit", () => {
  it("is open on a device that has never seen it", () => {
    useStore(fakeStore());
    mount();
    expect(card(), "a first-time referee is not shown the explanation").not.toBeNull();
  });

  it("stays shut across a remount once it is closed", () => {
    const store = fakeStore();
    useStore(store);
    mount();
    press(".ref-how-close");
    expect(card(), "the close button did not close it").toBeNull();

    /* The mutation: `show` that only calls `setOpen`. Everything above still
       passes; this is the line that goes red. */
    remount();
    expect(card(), "the dismissal did not survive a fresh mount").toBeNull();
  });

  it("comes back for good when the header button is pressed", () => {
    useStore(fakeStore());
    mount();
    press(".ref-how-close");
    expect(card()).toBeNull();

    press(".ref-how-btn");
    expect(card(), "the header button did not reopen it").not.toBeNull();

    /* The mutation: reopening that writes nothing, or writes `"1"` anyway. The
       card would be on screen here and gone on the next paper — a button that
       looks like it worked. */
    remount();
    expect(card(), "reopening it did not clear the dismissal").not.toBeNull();
  });

  it("says whether it is open, for a screen reader as well as a sighted one", () => {
    useStore(fakeStore());
    mount();
    const button = host.querySelector(".ref-how-btn");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    press(".ref-how-close");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives both buttons a real name", () => {
    useStore(fakeStore());
    mount();
    /* Not an icon with nothing on it, which is what a bare × is. */
    expect(host.querySelector(".ref-how-close")?.getAttribute("aria-label")).toBe(
      "Hide this explanation",
    );
    expect(host.querySelector(".ref-how-btn")?.textContent).toBe("How this works");
  });
});

describe("a browser that will not keep the bit", () => {
  it("still draws the card, and closing it still closes it", () => {
    useStore(throwingStore());
    /* Both halves: the read is inside a `useState` initialiser, so an unguarded
       one takes the band down at mount; the write is inside an event handler,
       so an unguarded one takes it down on the press instead. */
    mount();
    expect(card(), "a throwing store blanked the card").not.toBeNull();
    press(".ref-how-close");
    expect(card(), "the press threw before it could close it").toBeNull();
  });

  it("survives there being no localStorage at all", () => {
    useStore(undefined);
    expect(() => howCardDismissed()).not.toThrow();
    expect(howCardDismissed(), "not knowing must mean showing it").toBe(false);
    expect(() => rememberHowCard(true)).not.toThrow();
    expect(() => rememberHowCard(false)).not.toThrow();
  });
});

describe("where the band puts it", () => {
  /* **`RefereeBand`'s own body**, not the whole file: `band-head` is every
     band's title row and there are a dozen of them above this one. */
  const BAND_FILE = "src/web/modes/referee/RefereeMode.tsx";
  const whole = readFileSync(BAND_FILE, "utf8");
  /* **The guard, not a convenience.** `indexOf` returns -1 when the subject has
     moved, `slice(-1)` hands back the file's last character, and every
     assertion below then passes or fails against nothing at all. */
  const start = whole.indexOf("function RefereeBand(");
  if (start === -1) {
    throw new Error(
      `RefereeBand is not in ${BAND_FILE} any more, so the two placement facts ` +
        `below would be checked against nothing. Point BAND_FILE at whatever owns ` +
        `the band now.`,
    );
  }
  const app = whole.slice(start);

  /**
   * **Inside `.ref-panel`, and not inside `.ref-brief`.** The plan is explicit
   * about this and the reason is not cosmetic: `.ref-brief` holds the
   * confidentiality notice and the injection scan, neither of which may ever be
   * dismissed, and a closable card beside a non-closable one invites closing the
   * wrong one. Move the card up two lines in the band and every rendering
   * assertion in this file still passes.
   */
  it("renders the card in the panel, under the chips", () => {
    const brief = app.slice(
      app.indexOf('className="ref-brief"'),
      app.indexOf('className="ref-panel"'),
    );
    expect(brief.includes("RefereeHowCard"), "the card is inside .ref-brief").toBe(false);
    const panel = app.slice(app.indexOf('className="ref-panel"'));
    const cardAt = panel.indexOf("RefereeHowCard");
    const subModeAt = panel.indexOf("RefereeSubMode");
    expect(cardAt, "the card is not in .ref-panel at all").toBeGreaterThan(-1);
    expect(cardAt, "the card is below the sub-mode rather than above it").toBeLessThan(subModeAt);
  });

  it("puts the reopen button in the mode header", () => {
    const head = app.slice(
      app.indexOf('className="band-head"'),
      app.indexOf('className="ref-brief"'),
    );
    expect(head.includes("RefereeHowButton"), "there is no way back to the card").toBe(true);
  });
});
