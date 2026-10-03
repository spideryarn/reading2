// @vitest-environment jsdom
/**
 * **A box whose Enter has done its thing lets go of the soft keyboard, and only
 * of a soft keyboard.**
 *
 * Greg, from an iPad, 2026-10-03 (spya-gmtt4b):
 *
 * > what I end up doing is pressing the carriage return button, and then
 * > sometimes I can actually press the sort of keyboard hide button because the
 * > keyboard doesn't disappear.
 *
 * `putKeyboardAway` is the one place that decides. It blurs the box when the
 * visual viewport says a keyboard is covering the page, and does nothing
 * otherwise, so a desk and an iPad with a hardware keyboard keep the caret
 * where it was. The rule is docs/project/touch.md § What the Enter key
 * promises; the boxes that call it are pressed in
 * tests/the-enter-key-really-sends.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { putKeyboardAway, softKeyboardIsUp } from "../src/web/useVisualViewport.js";

/** A visual viewport `covered` px shorter than the layout viewport's 800. */
function viewport(covered: number, scale = 1): void {
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("visualViewport", { height: (800 - covered) / scale, offsetTop: 0, scale });
}

let box: HTMLTextAreaElement;

beforeEach(() => {
  box = document.createElement("textarea");
  document.body.append(box);
  box.focus();
});

afterEach(() => {
  box.remove();
  vi.unstubAllGlobals();
});

describe("putKeyboardAway", () => {
  it("blurs the box when a keyboard covers the page", () => {
    viewport(336);
    expect(softKeyboardIsUp()).toBe(true);
    putKeyboardAway(box);
    expect(document.activeElement).not.toBe(box);
  });

  it("leaves the caret alone on a desk, where nothing is covered", () => {
    viewport(0);
    expect(softKeyboardIsUp()).toBe(false);
    putKeyboardAway(box);
    expect(document.activeElement).toBe(box);
  });

  it("does not take a hardware keyboard's shortcut bar for a keyboard", () => {
    /* An iPad with a keyboard attached still draws a strip of about 55px. */
    viewport(55);
    putKeyboardAway(box);
    expect(document.activeElement).toBe(box);
  });

  it("does not take a pinch-zoom for a keyboard", () => {
    /* Zoomed to 2x the visible box is half as tall in CSS pixels, with no
       keyboard anywhere. */
    viewport(0, 2);
    expect(softKeyboardIsUp()).toBe(false);
    viewport(336, 2);
    expect(softKeyboardIsUp()).toBe(true);
  });

  it("cannot see a keyboard that shrinks the layout viewport too, and so does nothing", () => {
    /* Android Chrome under `interactive-widget=resizes-content` (index.html):
       both viewports are 464 tall with the keyboard up. Conservative, not
       certain: the caret stays, as it did before this existed. */
    vi.stubGlobal("innerHeight", 464);
    vi.stubGlobal("visualViewport", { height: 464, offsetTop: 0, scale: 1 });
    expect(softKeyboardIsUp()).toBe(false);
    putKeyboardAway(box);
    expect(document.activeElement).toBe(box);
  });

  it("does nothing where there is no visual viewport at all", () => {
    vi.stubGlobal("visualViewport", undefined);
    putKeyboardAway(box);
    expect(document.activeElement).toBe(box);
  });

  it("takes a box that is not there", () => {
    viewport(336);
    expect(() => putKeyboardAway(null)).not.toThrow();
  });
});
