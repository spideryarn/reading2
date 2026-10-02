// @vitest-environment jsdom
/**
 * **The two questions every shortcut asks first**, as a unit —
 * src/web/key-chord.ts. The chords that use them are asserted end to end in
 * tests/command-bar.test.tsx (⌘-K) and tests/metadata-chord.test.tsx (⌘-Enter);
 * `isSendEnter` in the boxes that use it, in tests/the-enter-key-really-sends.test.tsx.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isModAltChord, isModChord, isSendEnter, isTyping } from "../src/web/key-chord.js";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("isSendEnter", () => {
  it("sends on a plain Enter, and on ⌘/Ctrl-Enter, which also sends in chat", () => {
    expect(isSendEnter(key({ key: "Enter" }))).toBe(true);
    expect(isSendEnter(key({ key: "Enter", metaKey: true }))).toBe(true);
    expect(isSendEnter(key({ key: "Enter", ctrlKey: true }))).toBe(true);
  });

  it("leaves Shift+Enter to be a newline", () => {
    expect(isSendEnter(key({ key: "Enter", shiftKey: true }))).toBe(false);
  });

  it("is only Enter", () => {
    expect(isSendEnter(key({ key: "a" }))).toBe(false);
  });

  it("refuses IME composition on a DOM event, both spellings", () => {
    expect(isSendEnter(key({ key: "Enter", isComposing: true }))).toBe(false);
    expect(isSendEnter(key({ key: "Enter", keyCode: 229 } as KeyboardEventInit))).toBe(false);
  });

  /* **React's synthetic event has no `isComposing` of its own** — only its
     `nativeEvent` does — so a helper that read `e.isComposing` alone would pass
     every DOM-event case above and miss every real composition in a handler. */
  it("refuses IME composition on a React-shaped event, where the flag is on nativeEvent", () => {
    const composing = key({ key: "Enter", isComposing: true });
    expect(isSendEnter({ key: "Enter", shiftKey: false, keyCode: 13, nativeEvent: composing })).toBe(false);
    const plain = key({ key: "Enter" });
    expect(isSendEnter({ key: "Enter", shiftKey: false, keyCode: 13, nativeEvent: plain })).toBe(true);
  });
});

describe("isModChord", () => {
  it("matches ⌘ and Ctrl", () => {
    expect(isModChord(key({ key: "Enter", metaKey: true }), "Enter")).toBe(true);
    expect(isModChord(key({ key: "Enter", ctrlKey: true }), "Enter")).toBe(true);
  });

  it("needs one of them", () => {
    expect(isModChord(key({ key: "Enter" }), "Enter")).toBe(false);
  });

  it("rejects Shift and Alt, rather than ignoring them", () => {
    expect(isModChord(key({ key: "k", metaKey: true, shiftKey: true }), "k")).toBe(false);
    expect(isModChord(key({ key: "Enter", ctrlKey: true, altKey: true }), "Enter")).toBe(false);
  });

  it("rejects auto-repeat", () => {
    expect(isModChord(key({ key: "k", metaKey: true, repeat: true }), "k")).toBe(false);
  });

  it("rejects IME composition, both spellings", () => {
    expect(isModChord(key({ key: "Enter", metaKey: true, isComposing: true }), "Enter")).toBe(false);
    expect(isModChord(key({ key: "Enter", metaKey: true, keyCode: 229 } as KeyboardEventInit), "Enter")).toBe(false);
  });

  it("matches a letter in either case — Caps Lock is not a modifier", () => {
    expect(isModChord(key({ key: "K", metaKey: true }), "k")).toBe(true);
    expect(isModChord(key({ key: "k", ctrlKey: true }), "K")).toBe(true);
  });

  it("matches a named key exactly", () => {
    expect(isModChord(key({ key: "enter", metaKey: true }), "Enter")).toBe(false);
    expect(isModChord(key({ key: "j", metaKey: true }), "k")).toBe(false);
  });
});

describe("isTyping", () => {
  const made: HTMLElement[] = [];
  const add = <T extends HTMLElement>(el: T): T => {
    document.body.append(el);
    made.push(el);
    return el;
  };
  afterEach(() => {
    for (const el of made.splice(0)) el.remove();
  });

  it("is true for an input, a textarea and a select", () => {
    expect(isTyping(add(document.createElement("input")))).toBe(true);
    expect(isTyping(add(document.createElement("textarea")))).toBe(true);
    expect(isTyping(add(document.createElement("select")))).toBe(true);
  });

  it("is true below a contenteditable host, and false in a non-editable island", () => {
    const editor = add(document.createElement("div"));
    editor.setAttribute("contenteditable", "true");
    const inside = document.createElement("span");
    editor.append(inside);
    expect(isTyping(inside)).toBe(true);
    const island = document.createElement("span");
    island.setAttribute("contenteditable", "false");
    editor.append(island);
    expect(isTyping(island)).toBe(false);
  });

  it("is false for a button, a link, the body and nothing", () => {
    expect(isTyping(add(document.createElement("button")))).toBe(false);
    expect(isTyping(add(document.createElement("a")))).toBe(false);
    expect(isTyping(document.body)).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(window)).toBe(false);
  });
});

describe("isModAltChord", () => {
  it("matches ⌘⌥T and Ctrl+Alt+T by the physical key, whatever character ⌥ made", () => {
    expect(isModAltChord(key({ code: "KeyT", key: "†", metaKey: true, altKey: true }), "KeyT")).toBe(true);
    expect(isModAltChord(key({ code: "KeyT", key: "t", ctrlKey: true, altKey: true }), "KeyT")).toBe(true);
  });

  it("refuses it without Alt, without ⌘/Ctrl, with Shift, on repeat, and on another key", () => {
    expect(isModAltChord(key({ code: "KeyT", metaKey: true }), "KeyT")).toBe(false);
    expect(isModAltChord(key({ code: "KeyT", altKey: true }), "KeyT")).toBe(false);
    expect(
      isModAltChord(key({ code: "KeyT", metaKey: true, altKey: true, shiftKey: true }), "KeyT"),
    ).toBe(false);
    expect(
      isModAltChord(key({ code: "KeyT", metaKey: true, altKey: true, repeat: true }), "KeyT"),
    ).toBe(false);
    expect(isModAltChord(key({ code: "KeyR", metaKey: true, altKey: true }), "KeyT")).toBe(false);
  });

  it("refuses a press in the middle of an IME composition", () => {
    expect(
      isModAltChord(key({ code: "KeyT", metaKey: true, altKey: true, isComposing: true }), "KeyT"),
    ).toBe(false);
  });
});
