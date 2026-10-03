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
 * - a draft **with something in it** (words, a colour, or a Referee placement)
 *   is stored exactly once, with `ask: false`, against the passage it was
 *   written about;
 * - an **untouched** box stores nothing, by any exit — selecting a sentence to
 *   copy it must leave no trace (docs/project/comments.md § Copying the passage);
 * - **Discard** is the only thing that throws a draft away;
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

function type(text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(textarea(), text);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
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

function pickAColour(): void {
  const swatch = host.querySelector<HTMLElement>(".hl-swatch:not(.on)");
  if (!swatch) throw new Error("no highlight swatch on screen");
  act(() => swatch.click());
}

function pagehide(): void {
  act(() => {
    window.dispatchEvent(new Event("pagehide"));
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

  it("a colour and no words is a draft: the × stores a wordless highlight", () => {
    mount();
    pickAColour();
    press("Close");
    expect(saved).toHaveLength(1);
    expect(saved[0]!.body).toBe("");
    expect(saved[0]!.colour).not.toBeNull();
    expect(saved[0]!.ask).toBe(false);
  });

  it("a Referee placement and nothing else is a draft", () => {
    mount({ placing: true });
    press("place it");
    pressEscape();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.mark).toEqual({ criterionId: "spya-crt7pn", valence: 0 });
    expect(saved[0]!.body).toBe("");
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

describe("an untouched box stores nothing, and Discard is the one thing that throws a draft away", () => {
  it("untouched: the ×, Escape and an unmount all store nothing", () => {
    mount();
    press("Close");
    pressEscape();
    unmount();
    expect(saved).toHaveLength(0);
    expect(cancelled, "the exits stopped closing the box").toBe(2);
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
    pickAColour();
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

  it("uses the same draft id for a Save pressed after the page came back", () => {
    /* A pagehide can be a bfcache suspend: the page, the box and the words may
       all still be here afterwards. Save must not be a dead button then — it
       sends again under the same id, which the server treats as the same
       comment. */
    mount();
    type(WORDS);
    pagehide();
    press("Save");
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ leaving: false, ask: false });
    expect(saved[1]!.id).toBe(saved[0]!.id);
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
let select: (anchor: typeof A) => void;

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

    /* And the new, untouched passage is not stored when it goes. */
    press("Close");
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
