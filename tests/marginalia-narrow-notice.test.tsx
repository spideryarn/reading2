// @vitest-environment jsdom
/**
 * **Marginalia's "needs a wider window" line goes by itself, and can be sent
 * away.** Greg, spya-u264yb: *"there's no way to dismiss it, and it doesn't
 * fade after a few seconds."* It comes back when it is mounted afresh — the
 * room returns and is lost — because a mode that silently drew nothing would
 * look broken.
 * docs/plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md
 *
 * Fake timers, tests/toast.test.tsx's reason: the wait is the thing under test.
 * The page-level half (a covering band closed brings it back) is in
 * tests/every-mode-draws-its-surface.test.tsx § the notes beside a band.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarginaliaHead } from "../src/web/marginalia/MarginaliaColumn.js";
import { TOAST_MS } from "../src/web/Toast.js";
import { readerCssNoComments } from "./helpers/stylesheets.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function draw({ room = false, beside = false }: { room?: boolean; beside?: boolean } = {}) {
  act(() => root.render(<MarginaliaHead room={room} beside={beside} path={[]} arc={null} />));
}

const line = () => host.querySelector<HTMLElement>(".marg-narrow");
const gone = () => line()?.classList.contains("is-gone") ?? null;
const close = () => host.querySelector<HTMLButtonElement>(".marg-narrow button");
/** React hears `pointerenter`/`pointerleave` as `pointerover`/`pointerout`. */
const point = (type: "pointerover" | "pointerout", pointerType: string) =>
  act(() => line()?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType })));

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Marginalia's narrow-window line", () => {
  it("says why there are no notes, and is showing at first", () => {
    draw();
    expect(line()?.textContent).toContain("The notes need a wider window");
    expect(gone()).toBe(false);
  });

  it("goes by itself after a few seconds", () => {
    draw();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(gone(), "it went early").toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(gone(), "it never went").toBe(true);
  });

  /* The reading view re-renders on every scroll; a clock that started again
     each time would never run out (GPT Sol's F3 on the plan). */
  it("does not start the clock again when it is drawn again", () => {
    draw();
    act(() => vi.advanceTimersByTime(TOAST_MS - 1000));
    draw();
    act(() => vi.advanceTimersByTime(1000));
    expect(gone()).toBe(true);
  });

  it("waits while a mouse is over it, and only counts the time that is left", () => {
    draw();
    act(() => vi.advanceTimersByTime(2000));
    point("pointerover", "mouse");
    act(() => vi.advanceTimersByTime(60_000));
    expect(gone(), "it went while being read").toBe(false);

    point("pointerout", "mouse");
    act(() => vi.advanceTimersByTime(TOAST_MS - 2000 - 1));
    expect(gone()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(gone()).toBe(true);
  });

  /* A tap fires the hover family and need never say it has left
     (docs/project/touch.md); a finger must not stop the clock for good. */
  it("does not wait for a finger that touched it", () => {
    draw();
    point("pointerover", "touch");
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(gone(), "a tap stopped the clock").toBe(true);
  });

  it("waits while focus is on its button, and only counts the time that is left", () => {
    draw();
    act(() => vi.advanceTimersByTime(2000));
    act(() => close()?.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(gone(), "it went from under the keyboard").toBe(false);

    act(() => close()?.blur());
    act(() => vi.advanceTimersByTime(TOAST_MS - 2000 - 1));
    expect(gone()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(gone()).toBe(true);
  });

  it("goes at once when its close button is pressed", () => {
    draw();
    expect(close()?.getAttribute("aria-label")).toBe("Dismiss");
    act(() => close()?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(gone()).toBe(true);
  });

  /* The element stays: `.reader.band-covers:has(.mode-band, .marg-narrow)`
     keeps the small-screen banner out of the flow while Marginalia is in its
     narrow state (styles/narrow-window.css), and a banner arriving at the top
     of the article five seconds into reading it would move the text.

     **Invisible, not hidden**: the sentence is still there for a screen
     reader, which had it before the line could fade (GPT Sol's F6); only the
     button, an invisible tab stop otherwise, is hidden outright. */
  it("stays in the document once gone: the box invisible, the sentence readable, the button hidden", () => {
    draw();
    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(line()?.textContent).toContain("The notes need a wider window");

    const css = readerCssNoComments();
    const box = /\.marg-narrow\.is-gone\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(box, "no rule fades the line once it has gone").toMatch(/opacity:\s*0/);
    expect(box).toMatch(/pointer-events:\s*none/);
    expect(box, "the sentence was taken from a screen reader").not.toMatch(/visibility|display/);
    const button = /\.marg-narrow\.is-gone \.marg-narrow-close\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(button, "the button is still a tab stop").toMatch(/visibility:\s*hidden/);
  });

  it("comes back when the room returns and is lost again", () => {
    draw();
    act(() => close()?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(gone()).toBe(true);

    draw({ room: true });
    expect(line()).toBeNull();
    draw();
    expect(gone()).toBe(false);
  });

  it("stays gone across an ordinary re-render", () => {
    draw();
    act(() => close()?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    draw();
    expect(gone()).toBe(true);
  });
});
