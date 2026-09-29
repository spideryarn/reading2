// @vitest-environment jsdom
/**
 * **The two questions every shortcut asks first**, as a unit —
 * src/web/key-chord.ts. The chords that use them are asserted end to end in
 * tests/command-bar.test.tsx (⌘-K) and tests/metadata-chord.test.tsx (⌘-Enter).
 */
import { afterEach, describe, expect, it } from "vitest";
import { isModChord, isTyping } from "../src/web/key-chord.js";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

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
