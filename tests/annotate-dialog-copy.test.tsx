// @vitest-environment jsdom
/**
 * The Copy button in the box a selection opens — src/web/AnnotateDialog.tsx.
 *
 * Selecting prose opens that box and takes the focus, so a reader who only
 * wanted the sentence on their clipboard has lost their selection and has to
 * re-select the quote inside the dialog. The button is the one press that
 * replaces that (Greg, 2026-09-05).
 *
 * What is tested here is the same list `block-gutter.test.tsx` was written
 * against, and for the same reason: an implementation that copied the wrong
 * text, ticked optimistically before the promise settled, threw where there is
 * no Clipboard API, or announced nothing to a screen reader would all *look*
 * right on screen. Each is a test below.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotateDialog } from "../src/web/AnnotateDialog.js";
import { readerCss } from "./helpers/stylesheets.js";
import type { BlockId } from "../src/types.js";

const QUOTE = "The map is not the territory.";

let host: HTMLDivElement;
let root: Root;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "/read/example");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
  vi.useRealTimers();
});

/**
 * Render the dialog over a passage — **into the same root every time**, which
 * is the whole point of the second passage below.
 *
 * `App` keeps one `AnnotateDialog` mounted and swaps its `anchor` as the reader
 * selects, so a test that unmounted between passages would be testing a
 * component this app does not have, and would agree with a stale tick.
 */
function paint(
  opts: {
    quote?: string;
    start?: number;
    onSave?: (id: string) => void;
    onCancel?: () => void;
  } = {},
): void {
  act(() => {
    root.render(
      <AnnotateDialog
        anchor={{
          blockId: "spya-k3m9qt" as BlockId,
          quote: opts.quote ?? QUOTE,
          start: opts.start ?? 0,
        }}
        placing={false}
        onSave={opts.onSave ?? (() => {})}
        onCancel={opts.onCancel ?? (() => {})}
      />,
    );
  });
}

/** A writable clipboard whose promise this test controls. */
function clipboard(writeText: (t: string) => Promise<void>): string[] {
  const wrote: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (t: string) => {
        wrote.push(t);
        return writeText(t);
      },
    },
  });
  return wrote;
}

const copy = () => host.querySelector("button.annotate-copy") as HTMLButtonElement;
/** Which lucide glyph the button is currently drawing. */
const icon = () => copy().querySelector("svg")?.getAttribute("class") ?? "";
/**
 * What the live region would say out loud.
 *
 * Looked up in the *header*, not inside the button, and the test below that it
 * really is a sibling is the point: `button` is an ARIA role whose children are
 * presentational, so a live region nested in one is announced at the screen
 * reader's discretion. This selector would still find it there, which is why
 * the placement gets a test of its own rather than being left to this line.
 */
const region = () =>
  host.querySelector('.annotate-head-actions > .sr-only[role="status"]') as HTMLElement | null;
const said = () => region()?.textContent ?? "";

function click(el: HTMLElement): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Let a resolved/rejected clipboard promise settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("copying the selected passage", () => {
  it("puts the reader's own words on the clipboard, and nothing else", async () => {
    const wrote = clipboard(() => Promise.resolve());
    paint();
    click(copy());
    await settle();
    // Exactly the quote: no block id, no attribution, no quotation marks. The
    // citable address is the gutter's own button and a different thing.
    expect(wrote).toEqual([QUOTE]);
  });

  it("keeps the live region OUTSIDE the button, and mounted from the start", () => {
    paint();
    // Two ways this announcement can be silently lost, neither of which shows
    // up in a screenshot: nested in a button, whose children are presentational
    // to ARIA, or rendered only once it has something to say — a live region
    // that arrives already holding its message is announced by nobody.
    expect(copy().querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(region()).not.toBeNull();
    expect(region()?.getAttribute("aria-atomic")).toBe("true");
    expect(said()).toBe("");
    // And the name stays put. A control renaming itself to its own outcome is a
    // different control to anything scripted or spoken.
    expect(copy().getAttribute("aria-label")).toBe("Copy the passage");
  });

  it("is type=button, so it can never submit anything", () => {
    paint();
    // Asserted directly rather than inferred from "no comment was saved": this
    // button sits in the <header>, outside the <form>, so dropping type would
    // leave that inference green while the attribute was gone. GPT Sol,
    // 2026-09-05, on the test that used to claim it caught this.
    expect(copy().type).toBe("button");
  });

  it("shows the tick only AFTER the promise resolves", async () => {
    let release!: () => void;
    clipboard(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    paint();
    click(copy());
    // The whole point: mid-flight the icon must not be claiming success.
    expect(icon()).toContain("copy");
    expect(icon()).not.toContain("clipboard-check");
    expect(said()).toBe("");
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(icon()).toContain("clipboard-check");
    expect(said()).toBe("Passage copied.");
  });

  it("says so when the write is refused, with a glyph that is not the Close X", async () => {
    clipboard(() => Promise.reject(new Error("denied")));
    paint();
    click(copy());
    await settle();
    expect(said()).toBe("Copy refused by the browser.");
    expect(icon()).not.toContain("clipboard-check");
    // A failure drawn as an X put a second X beside the Close button, told
    // apart only by a `title` no touch device ever shows.
    expect(icon()).toContain("triangle-alert");
    expect(icon()).not.toContain("lucide-x");
  });

  it("does not throw, or claim success, where there is no clipboard object", async () => {
    // Undefined in every insecure context — http://192.168.1.x:5273 from a
    // phone, which is one of the ways this app gets read on a phone.
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    paint();
    expect(() => click(copy())).not.toThrow();
    await settle();
    expect(said()).toBe("Copy refused by the browser.");
  });

  it("neither saves the comment nor closes the box", async () => {
    const saved: string[] = [];
    const cancelled: string[] = [];
    clipboard(() => Promise.resolve());
    paint({ onSave: (id) => saved.push(id), onCancel: () => cancelled.push("x") });
    // A button that defaulted to type="submit" would store a comment on every
    // copy; one wired to the header's Close would throw the box away.
    click(copy());
    await settle();
    expect(saved).toEqual([]);
    expect(cancelled).toEqual([]);
    expect(host.querySelector("aside.annotate-dialog")).not.toBeNull();
  });
});

/**
 * **Every one of these was red before GPT Sol's review of the built code**, and
 * every one of them is the same failure wearing a different hat: the button
 * saying something true about a copy that is no longer the copy in front of the
 * reader. None of them is visible in a screenshot, and the first four tests
 * above all passed throughout.
 */
describe("what it says is about the copy in front of you", () => {
  const OTHER = "Territory is not the map either.";

  it("drops a tick when the reader selects a DIFFERENT passage", async () => {
    clipboard(() => Promise.resolve());
    paint();
    click(copy());
    await settle();
    expect(icon()).toContain("clipboard-check");

    // Inside the 1.6s window, and into the same mounted dialog — which is what
    // App does. An unkeyed button sat here still showing the tick, over B's
    // words, with A on the clipboard.
    paint({ quote: OTHER, start: 40 });
    expect(icon()).toContain("lucide-copy");
    expect(icon()).not.toContain("clipboard-check");
    expect(said()).toBe("");
  });

  it("does not let a copy of the OLD passage report success over the new one", async () => {
    let release!: () => void;
    clipboard(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    paint();
    click(copy());
    // The reader moves on while the write is still in flight.
    paint({ quote: OTHER, start: 40 });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    // The clipboard now holds the OLD passage, so a tick here would be a lie
    // about the words on screen.
    expect(icon()).not.toContain("clipboard-check");
    expect(said()).toBe("");
  });

  it("lets the LATEST press win when two are in flight", async () => {
    const settlers: Array<{ ok: () => void; no: () => void }> = [];
    clipboard(
      () =>
        new Promise<void>((ok, no) => {
          settlers.push({ ok, no: () => no(new Error("denied")) });
        }),
    );
    paint();
    click(copy());
    click(copy());
    expect(settlers).toHaveLength(2);
    // The second press succeeds; the first rejects afterwards. Without a press
    // token the stale rejection lands last and the button reports failure over
    // a clipboard holding exactly what was asked for.
    await act(async () => {
      settlers[1]?.ok();
      await Promise.resolve();
    });
    await act(async () => {
      settlers[0]?.no();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(icon()).toContain("clipboard-check");
    expect(said()).toBe("Passage copied.");
  });

  it("gives a second success its own full 1.6 seconds", async () => {
    vi.useFakeTimers();
    clipboard(() => Promise.resolve());
    paint();
    click(copy());
    await settle();
    expect(icon()).toContain("clipboard-check");

    // Almost the whole first window gone, then press again. `setState` to the
    // value already held is a no-op React bails out of, so the effect never
    // re-ran and the second tick inherited 100ms of the first one's timer.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    click(copy());
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(icon()).toContain("clipboard-check");
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(icon()).toContain("lucide-copy");
  });
});

/**
 * **The size of the two header targets, read out of the stylesheet.**
 *
 * jsdom computes no layout, so every test above stays green with the size floor
 * deleted — and the pair measured 19.8×19.8 with 2.4px between them until
 * 2026-09-05, under WCAG 2.5.8's 24×24 and too close for its spacing exception
 * either. A browser pass measured the fix once; this is the part that is
 * deterministic, runs in milliseconds and needs no Chrome. Same technique and
 * same reasoning as `tests/gutter-target-size.test.ts`, which arrived the same
 * day for the same rule on the prose gutter.
 *
 * **In `px`, deliberately, and that is the half worth knowing.** `1.5rem` is 24
 * CSS pixels only at a 16px root, and this app supports a 12px one — the trap
 * that made GPT Sol's review of the gutter work commit-blocking. So this also
 * asserts the declaration is *not* expressed in `rem`.
 */
describe("the header's targets", () => {
  /* The reading-view sheets as a set, resolved from the `@import` graph — the
     rule read below lives in one of thirty-seven files since 2026-09-06, and
     naming any one of them is how this test would go quietly green on a rule
     that had simply moved. tests/helpers/stylesheets.ts. */
  const css = readerCss();

  it("gives Copy and Close 24px in each direction, at every root size", () => {
    const rule = /\.annotate-close,\s*\.annotate-copy\s*\{([^}]*)\}/.exec(css)?.[1];
    expect(rule, "the shared .annotate-close/.annotate-copy rule").toBeTruthy();
    for (const prop of ["min-width", "min-height"]) {
      const value = new RegExp(`${prop}:\\s*([^;]+);`).exec(rule ?? "")?.[1]?.trim();
      expect(value, `${prop} on the header buttons`).toBeTruthy();
      expect(value).not.toMatch(/rem/);
      expect(Number.parseFloat(value ?? "0")).toBeGreaterThanOrEqual(24);
    }
  });
});
