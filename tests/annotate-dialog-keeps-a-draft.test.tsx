// @vitest-environment jsdom
/**
 * **No way out of the box a selection opens silently discards a draft**, and
 * Ask AI is a button — src/web/AnnotateDialog.tsx.
 *
 * Greg, 2026-10-03 (spya-pnnamg): he selected a word, ticked *"Also ask the AI
 * about it"*, clicked something else, and the draft was gone. Five exits threw
 * it away without a word — Cancel, the ×, Escape, another selection, leaving —
 * and the tick-box he took for the action did nothing until Save was pressed.
 * docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md.
 *
 * What is asked here, exit by exit:
 *
 * - a draft **the reader did something to** (words, a changed colour, or a
 *   Referee placement) is stored exactly once, with `ask: false`, against the
 *   passage it was written about;
 * - an **untouched** box opens with Yellow picked, and since 2026-10-04 the ×
 *   and Escape store that yellow highlight (Greg, spya-ur8kum: *"default to the
 *   yellow colour, and default to saving it"*). The exits nobody chose — another
 *   selection, an unmount, `pagehide` — still store nothing from it, and nor
 *   does a close after Copy: selecting a sentence to copy it must leave no trace
 *   (docs/project/comments.md § Copying the passage);
 * - **Discard** always throws the draft away;
 * - nothing is sent twice: Ask–Ask, Ask–Save, Save–Save, Save-then-unmount,
 *   pagehide-then-unmount.
 *
 * Every "nothing was saved" has a positive control beside it in the same
 * describe — the same exit with words typed does save — so a harness that had
 * stopped reaching the handler could not pass as a refusal.
 * docs/reusable/silent-success.md.
 */
import { readFileSync } from "node:fs";
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BlockId } from "../src/types.js";

/** What the faked microphone says about itself; each case sets it. */
const mic = { armed: false, readOnly: false };

/* The dictation hook is replaced so a case can pose "the microphone is armed"
   without a MediaRecorder. What is under test is what this box does with those
   two flags, not how they come to be set (tests/dictation-recording.test.ts). */
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: mic.armed },
    readOnly: mic.readOnly,
    busy: mic.readOnly || mic.armed,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));
/* The real section fetches the article's criteria. A button that makes a
   placement is all these cases need of it; `NO_MARK` stays the real one. */
vi.mock("../src/web/PlaceOnCriterion.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/PlaceOnCriterion.js")>(
    "../src/web/PlaceOnCriterion.js",
  );
  return {
    ...real,
    PlaceOnCriterion: (props: { onChange(mark: { criterionId: string; valence: number }): void }) =>
      createElement(
        "button",
        {
          type: "button",
          className: "fake-place",
          onClick: () => props.onChange({ criterionId: "spya-crt7pn", valence: 0 }),
        },
        "place it",
      ),
  };
});

const { AnnotateDialog, annotateKey } = await import("../src/web/AnnotateDialog.js");
type SavedDraft = Parameters<Parameters<typeof AnnotateDialog>[0]["onSave"]>[0];

const BLOCK = "spya-k3m9qt" as BlockId;
const A = { blockId: BLOCK, quote: "entropy", start: 12 };
const B = { blockId: BLOCK, quote: "a measure of disorder", start: 40 };
const WORDS = "what does this mean here?";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let saved: SavedDraft[];
let cancelled: number;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  saved = [];
  cancelled = 0;
  mic.armed = false;
  mic.readOnly = false;
  window.history.replaceState(null, "", "/read/example");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator as object, "clipboard");
});

/** The box alone over passage A, keyed as every caller keys it. */
function mount(opts: { strict?: boolean; placing?: boolean; loaded?: boolean } = {}): void {
  const box = createElement(AnnotateDialog, {
    key: annotateKey(A),
    anchor: A,
    placing: opts.placing ?? false,
    loaded: opts.loaded ?? true,
    onSave: (draft: SavedDraft) => saved.push(draft),
    onCancel: () => {
      cancelled += 1;
    },
  });
  act(() => {
    root.render(opts.strict ? createElement(StrictMode, null, box) : box);
  });
}

function unmount(): void {
  act(() => root.render(null));
}

const textarea = () => host.querySelector("textarea") as HTMLTextAreaElement;

function enter(text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea(), text);
  textarea().dispatchEvent(new Event("input", { bubbles: true }));
}

function type(text: string): void {
  act(() => enter(text));
}

function button(words: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === words || b.getAttribute("aria-label") === words,
  );
  if (!found) {
    const seen = [...host.querySelectorAll("button")].map((b) => b.textContent || b.getAttribute("aria-label"));
    throw new Error(`no button says ${JSON.stringify(words)}; saw ${JSON.stringify(seen)}`);
  }
  return found;
}

function press(words: string): void {
  const el = button(words);
  act(() => el.click());
}

/** The box's Escape: the window listener, not the textarea's own first one. */
function pressEscape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

/** Press one swatch of the colour row: a colour's name, or `none`. */
function swatch(colour: "none" | "yellow" | "green" | "blue" | "pink"): HTMLElement {
  const swatch = host.querySelector<HTMLElement>(`.hl-swatch[data-colour="${colour}"]`);
  if (!swatch) throw new Error(`no ${colour} swatch on screen`);
  return swatch;
}

function pick(colour: "none" | "yellow" | "green" | "blue" | "pink"): void {
  act(() => swatch(colour).click());
}

/** The name of the swatch the row shows as picked. */
const picked = () => host.querySelector('.hl-swatch[aria-checked="true"]')?.getAttribute("aria-label");
const hint = () => host.querySelector(".annotate-hint")?.textContent ?? "";

/** A clipboard whose write never settles, so only the press itself can count. */
function clipboardThatNeverAnswers(): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => new Promise<void>(() => {}) },
  });
}

function pagehide(): void {
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

function pageshow(): void {
  act(() => {
    window.dispatchEvent(new Event("pageshow"));
  });
}

describe("the box ends in Discard, Ask AI and Save", () => {
  it("has no tick-box, and names its three buttons", () => {
    mount();
    expect(host.querySelector('input[type="checkbox"]'), "the tick-box is still here").toBeNull();
    expect(host.textContent).not.toContain("Also ask the AI");
    expect(button("Discard").type).toBe("button");
    /* Ask AI must not be a second submit: Enter in a form presses the first
       submit button, and the free Save is the only thing a key may press. */
    expect(button("Ask AI").type).toBe("button");
    expect(button("Save").type).toBe("submit");
    expect(host.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  });

  it("Save stores the draft against its passage, once, without asking", () => {
    mount();
    type(`  ${WORDS}  `);
    press("Save");
    press("Save");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: false, leaving: false });
    expect(saved[0]!.id).toMatch(/\S/);
  });

  it("Ask AI stores it with ask: true, once, and an unmount does not store it again", () => {
    mount();
    type(WORDS);
    press("Ask AI");
    press("Ask AI");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: true, leaving: false });
    unmount();
    expect(saved).toHaveLength(1);
  });

  it("sends once when Ask AI and Save are pressed in the same frame, either order", () => {
    mount();
    type(WORDS);
    const ask = button("Ask AI");
    const save = button("Save");
    act(() => {
      ask.click();
      save.click();
    });
    expect(saved.map((d) => d.ask)).toEqual([true]);

    unmount();
    saved = [];
    mount();
    type(WORDS);
    const ask2 = button("Ask AI");
    const save2 = button("Save");
    act(() => {
      save2.click();
      ask2.click();
    });
    expect(saved.map((d) => d.ask)).toEqual([false]);
  });

  it("⌘/Ctrl+Enter is the free Save, and plain Enter is not a save at all", () => {
    mount();
    type(WORDS);
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(saved, "plain Enter saved").toHaveLength(0);
    act(() => {
      textarea().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });
    expect(saved.map((d) => d.ask)).toEqual([false]);
  });

  it("Save then unmount stores once", () => {
    mount();
    type(WORDS);
    press("Save");
    unmount();
    expect(saved).toHaveLength(1);
  });

  it("Ask AI waits for the comment list, as Save does", () => {
    mount({ loaded: false });
    type(WORDS);
    expect(button("Ask AI").disabled).toBe(true);
    press("Ask AI");
    press("Save");
    expect(saved).toHaveLength(0);
  });
});

describe("every other way out stores a draft that has something in it", () => {
  it("typing and the × in the same frame stores the words that were typed", () => {
    mount();
    const close = button("Close");
    act(() => {
      enter(WORDS);
      close.click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body).toBe(WORDS);
  });

  it("the ×: words are stored once with ask: false, and the box is closed", () => {
    mount();
    type(WORDS);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: false, leaving: false });
    expect(cancelled).toBe(1);
    unmount();
    expect(saved, "the unmount after the × stored it a second time").toHaveLength(1);
  });

  it("the box's Escape: the same", () => {
    mount();
    type(WORDS);
    pressEscape();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: false });
    expect(cancelled).toBe(1);
  });

  it("the textarea's first Escape still only clears the reader's words", () => {
    mount();
    type(WORDS);
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(textarea().value).toBe("");
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(0);
  });

  it("a changed colour and no words is a draft: an unmount stores a wordless highlight", () => {
    mount();
    pick("pink");
    unmount();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: "", colour: "pink", ask: false });
  });

  it("pink and back to yellow is still the reader's doing: an unmount stores it", () => {
    mount();
    pick("pink");
    pick("yellow");
    unmount();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.colour).toBe("yellow");
  });

  it("a colour change and the × in the same frame stores the colour that was pressed", () => {
    mount();
    const green = swatch("green");
    const close = button("Close");
    act(() => {
      green.click();
      close.click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.colour).toBe("green");
  });

  it("a Referee placement and nothing else is a draft", () => {
    mount({ placing: true });
    press("place it");
    pressEscape();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.mark).toEqual({ criterionId: "spya-crt7pn", valence: 0 });
    expect(saved[0]!.body).toBe("");
  });

  it("a Referee placement and the × in the same frame stores the placement", () => {
    mount({ placing: true });
    const place = button("place it");
    const close = button("Close");
    act(() => {
      place.click();
      close.click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.mark).toEqual({ criterionId: "spya-crt7pn", valence: 0 });
  });

  it("unmounting for any reason stores it once", () => {
    mount();
    type(WORDS);
    unmount();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: false, leaving: false });
  });

  it("stores the field as it stands while the microphone is armed, though Save itself refuses", () => {
    /* D4, arbitrated: Save refuses mid-dictation because better words are about
       to arrive. At a flush the box is going away and nothing better will, so
       the words the reader could see are stored. */
    mount();
    type("rough words the recogniser has so far");
    mic.armed = true;
    type("rough words the recogniser has so far, and more");
    press("Save");
    expect(saved, "Save stored live dictation").toHaveLength(0);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body).toBe("rough words the recogniser has so far, and more");
  });
});

describe("the box opens on Yellow, and closing it saves the highlight (spya-ur8kum)", () => {
  it("opens with Yellow picked; in Referee mode, with no colour", () => {
    mount();
    expect(picked()).toBe("Yellow");
    unmount();
    mount({ placing: true });
    expect(picked()).toBe("No colour");
  });

  it("chooses the default once at mount, rather than recolouring when Referee mode changes", () => {
    mount();
    mount({ placing: true });
    expect(picked()).toBe("Yellow");

    unmount();
    mount({ placing: true });
    mount({ placing: false });
    expect(picked()).toBe("No colour");
  });

  it("the placeholder and hint describe Yellow, No colour, Referee, Copy and loading truthfully", () => {
    mount();
    expect(textarea().placeholder).toContain("save the highlight");
    expect(hint()).toContain("Closing this saves the highlight");

    pick("none");
    expect(textarea().placeholder).toContain("save to bookmark");
    expect(hint()).toContain("Closing this keeps what you wrote");
    expect(hint()).not.toContain("saves the highlight");

    clipboardThatNeverAnswers();
    press("Copy the passage");
    expect(hint()).not.toContain("saves the highlight");

    unmount();
    mount({ placing: true });
    expect(textarea().placeholder).toContain("save to bookmark");
    expect(hint()).toContain("Closing this keeps what you wrote");

    unmount();
    mount({ loaded: false });
    expect(hint()).toContain("Save will be ready in a moment");
    expect(button("Save").disabled).toBe(true);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.colour).toBe("yellow");
  });

  it("untouched, the ×: one wordless yellow highlight, not asked, and the box closes", () => {
    mount();
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: "", colour: "yellow", ask: false, leaving: false });
    expect(cancelled).toBe(1);
    unmount();
    expect(saved, "the unmount after the × stored it again").toHaveLength(1);
  });

  it("untouched, Escape: the same", () => {
    mount();
    pressEscape();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: "", colour: "yellow", ask: false });
    expect(cancelled).toBe(1);
  });

  it("untouched, Save stores yellow, and Ask AI stores yellow with ask: true", () => {
    mount();
    press("Save");
    expect(saved[0]).toMatchObject({ body: "", colour: "yellow", ask: false });
    unmount();
    saved = [];
    mount();
    press("Ask AI");
    expect(saved[0]).toMatchObject({ body: "", colour: "yellow", ask: true });
  });

  it("words typed and cleared by the first Escape: the second Escape stores yellow", () => {
    mount();
    type(WORDS);
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(saved, "the clearing Escape stored something").toHaveLength(0);
    expect(textarea().value).toBe("");
    pressEscape();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: "", colour: "yellow" });
  });

  it("clearing words and closing in the same frame does not put the cleared words back", () => {
    mount();
    type(WORDS);
    act(() => {
      textarea().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: "", colour: "yellow" });
  });

  it("No colour picked and nothing else: neither the × nor an unmount stores anything", () => {
    mount();
    pick("none");
    press("Close");
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(1);
    unmount();
    mount();
    pick("none");
    unmount();
    expect(saved, "an empty uncoloured bookmark was stored by an exit nobody chose").toHaveLength(0);
    /* The control: with words, the same No colour box is stored by the ×. */
    mount();
    pick("none");
    type(WORDS);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: WORDS, colour: null });
  });

  it("Referee mode, untouched: the × stores nothing, as before", () => {
    mount({ placing: true });
    press("Close");
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(1);
  });
});

describe("Copy, then close, leaves no highlight", () => {
  it("Copy and the × in the same frame still leave no highlight", () => {
    clipboardThatNeverAnswers();
    mount();
    const copy = button("Copy the passage");
    const close = button("Close");
    act(() => {
      copy.click();
      close.click();
    });
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(1);
  });

  it("Copy then the ×: nothing, even with the clipboard still to answer; and the hint says so", () => {
    clipboardThatNeverAnswers();
    mount();
    press("Copy the passage");
    expect(host.querySelector(".annotate-hint")?.textContent).toContain("Closing leaves no highlight");
    press("Close");
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(1);
  });

  it("Copy then Escape: nothing", () => {
    mount();
    press("Copy the passage");
    pressEscape();
    expect(saved).toHaveLength(0);
  });

  it("Copy then Save: the yellow highlight", () => {
    mount();
    press("Copy the passage");
    press("Save");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.colour).toBe("yellow");
  });

  it("Copy, then words, then the ×: stored", () => {
    mount();
    press("Copy the passage");
    type(WORDS);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ body: WORDS, colour: "yellow" });
  });

  it("Copy, then another colour, then the ×: stored", () => {
    mount();
    press("Copy the passage");
    pick("green");
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.colour).toBe("green");
  });
});

describe("an untouched box is stored by no exit the reader did not choose, and Discard throws a draft away", () => {
  it("untouched: an unmount stores nothing", () => {
    mount();
    unmount();
    expect(saved).toHaveLength(0);
  });

  it("a press on the Yellow that is already picked is not a change: an unmount stores nothing", () => {
    mount();
    pick("yellow");
    unmount();
    expect(saved).toHaveLength(0);
  });

  it("untouched pagehide, then pageshow: nothing sent, nothing closed, and the × still stores one highlight", () => {
    mount();
    pagehide();
    pageshow();
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(0);
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ colour: "yellow", leaving: false });
  });

  it("untouched, Discard: nothing, then or at the unmount that follows", () => {
    mount();
    press("Discard");
    unmount();
    expect(saved).toHaveLength(0);
    expect(cancelled).toBe(1);
  });

  it("only spaces is untouched", () => {
    mount();
    type("   \n ");
    unmount();
    expect(saved).toHaveLength(0);
  });

  it("untouched at pagehide: nothing", () => {
    mount();
    pagehide();
    expect(saved).toHaveLength(0);
  });

  it("Discard with words typed stores nothing, then or at the unmount that follows", () => {
    mount();
    type(WORDS);
    pick("pink");
    press("Discard");
    expect(cancelled).toBe(1);
    unmount();
    expect(saved).toHaveLength(0);
  });

  it("a StrictMode mount stores nothing, and a StrictMode draft is stored once", () => {
    mount({ strict: true });
    expect(saved, "the development remount stored an empty comment").toHaveLength(0);
    type(WORDS);
    unmount();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body).toBe(WORDS);
  });
});

describe("leaving the page", () => {
  it("pagehide with a draft asks for the keepalive write once, and a later unmount sends nothing more", () => {
    mount();
    type(WORDS);
    pagehide();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ anchor: A, body: WORDS, ask: false, leaving: true });
    pagehide();
    unmount();
    expect(saved).toHaveLength(1);
  });

  it("settles the saved box when a page comes back from bfcache, before its words can change", () => {
    /* A pagehide can be a bfcache suspend. The keepalive write has already used
       this draft id, so leaving the builder live would let changed words be
       POSTed under that id later — which the server correctly refuses as a
       collision. On pageshow the exact snapshot is replayed through ordinary
       create (putting it back in this tab's list) and the box is closed. */
    mount();
    type(WORDS);
    pagehide();

    pageshow();
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ body: WORDS, leaving: false, ask: false });
    expect(saved[1]!.id).toBe(saved[0]!.id);
    expect(cancelled).toBe(1);

    /* This fixture records `onCancel` rather than unmounting as Reader does.
       Even here, the settled instance must not accept a changed second Save. */
    type("changed after returning");
    press("Save");
    expect(saved).toHaveLength(2);
    unmount();
    expect(saved).toHaveLength(2);
  });
});

/* ------------------------------------------------- a new selection, as Reader
   has it: one `annotating` state, the box keyed on the passage. */

interface Stored {
  quote: string;
  body: string;
  ask: boolean;
}
let stored: Stored[];
let select: (anchor: typeof A | null) => void;

/**
 * `Reader.tsx` in miniature — the same key, the same conditional close. The two
 * lines this cannot see (that `Reader` really does both) are read from its
 * source below, the precedent being tests/one-escape-closes-one-surface.test.tsx.
 */
function ReaderShaped() {
  const [annotating, setAnnotating] = useState<typeof A | null>(A);
  select = setAnnotating;
  return annotating
    ? createElement(AnnotateDialog, {
        key: annotateKey(annotating),
        anchor: annotating,
        placing: false,
        loaded: true,
        onCancel: () => setAnnotating(null),
        onSave: (draft: SavedDraft) => {
          setAnnotating((cur) => (cur && annotateKey(cur) === annotateKey(draft.anchor) ? null : cur));
          stored.push({ quote: draft.anchor.quote, body: draft.body, ask: draft.ask });
        },
      })
    : null;
}

describe("another selection while a draft is open", () => {
  beforeEach(() => {
    stored = [];
  });

  it("stores the old draft against the OLD passage, and leaves the new box open and empty", () => {
    act(() => root.render(createElement(ReaderShaped)));
    type(WORDS);
    act(() => select(B));

    expect(stored).toEqual([{ quote: A.quote, body: WORDS, ask: false }]);
    expect(host.querySelector(".annotate-quote")?.textContent, "the new box was closed by the old one's save").toBe(
      B.quote,
    );
    expect(textarea().value, "the old words rode along into the new box").toBe("");

    /* And the new, untouched passage is not stored when it goes unasked. */
    act(() => select(null));
    expect(host.querySelector(".annotate-dialog")).toBeNull();
    expect(stored).toHaveLength(1);
  });

  it("stores nothing when the first box was untouched", () => {
    act(() => root.render(createElement(ReaderShaped)));
    act(() => select(B));
    expect(stored).toEqual([]);
    expect(host.querySelector(".annotate-quote")?.textContent).toBe(B.quote);
    /* The positive control: this box does store when it has words. */
    type(WORDS);
    act(() => select(A));
    expect(stored).toEqual([{ quote: B.quote, body: WORDS, ask: false }]);
  });

  it("a pressed Save closes its own box", () => {
    act(() => root.render(createElement(ReaderShaped)));
    type(WORDS);
    press("Save");
    expect(host.querySelector(".annotate-dialog")).toBeNull();
    expect(stored).toHaveLength(1);
  });
});

describe("Reader.tsx mounts the box the way these cases assume", () => {
  const SOURCE = readFileSync("src/web/reader/Reader.tsx", "utf8");
  const at = SOURCE.indexOf("<AnnotateDialog");
  const element = SOURCE.slice(at, SOURCE.indexOf("\n        />", at))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");

  it("is still where this file looks for it", () => {
    expect(at).toBeGreaterThan(-1);
    expect(element).toContain("anchor={annotating}");
  });

  it("keys the whole box on the passage", () => {
    expect(element).toContain("key={annotateKey(annotating)}");
  });

  it("stores against the anchor the box hands it, and closes only that box", () => {
    expect(element, "onSave reads Reader's own state, which has moved on by a flush").not.toMatch(
      /const anchor = annotating/,
    );
    expect(element.replace(/\s+/g, " ")).toContain(
      "setAnnotating((cur) => (cur && annotateKey(cur) === annotateKey(anchor) ? null : cur))",
    );
  });

  it("sends a leaving draft with the keepalive writer", () => {
    expect(element).toContain("owner.comments.createOnLeave(");
  });
});
