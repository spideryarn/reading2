// @vitest-environment jsdom
/**
 * **The microphone has a card: why talking is worth it, the fifteen-minute
 * limit, and the double press nobody would guess.** Greg, 2026-10-09
 * (spya-xdvnrg); docs/project/tooltips.md § A shortcut is named on its card.
 *
 * docs/plans/261009e-dictation-stays-with-its-article-and-the-button-says-its-tricks.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseDictation } from "../src/web/useDictation.js";

const { DictationButton, DictationStrip } = await import("../src/web/DictationStrip.js");
const { DELAY } = await import("../src/web/Tooltip.js");

let host: HTMLDivElement;
let root: Root;

const dictation = (over: Partial<UseDictation>): UseDictation =>
  ({ armed: false, transcribing: false, phase: "idle", ...over }) as UseDictation;

function hover(props: {
  d?: Partial<UseDictation>;
  doubleStop?: boolean;
  done?: "send" | "enter" | "save";
  disabled?: boolean;
  again?: () => void;
  sendingAfter?: boolean;
  toggle?: () => void;
}): string[] {
  act(() =>
    root.render(
      createElement(DictationButton, {
        dictation: dictation(props.d ?? {}),
        toggle: props.toggle ?? (() => {}),
        doubleStop: props.doubleStop,
        done: props.done,
        disabled: props.disabled,
        again: props.again,
        sendingAfter: props.sendingAfter,
      }),
    ),
  );
  const el = host.querySelector("button");
  if (!el) throw new Error("no button");
  act(() => {
    el.dispatchEvent(new MouseEvent("mouseenter"));
  });
  act(() => {
    vi.advanceTimersByTime(DELAY.open + 50);
  });
  return [...document.querySelectorAll(".tip-soon")].map((c) => c.textContent ?? "");
}

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

describe("the dictation button's card", () => {
  it("says why to talk and the limit, and leaves the privacy sentence to the description", () => {
    const cards = hover({});
    expect(cards).toHaveLength(1);
    const card = cards[0] ?? "";
    expect(card).toContain("Dictate");
    expect(card).toMatch(/say more/);
    expect(card).toContain("15 minutes");
    /* Already the button's aria-describedby; in the card too it is read twice. */
    expect(card).not.toContain("OpenRouter");
  });

  it("keeps the standing privacy description beside the card's description", () => {
    expect(hover({})).toHaveLength(1);
    const button = host.querySelector("button");
    if (!button) throw new Error("no button");
    const ids = button.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => document.getElementById(id)?.textContent ?? "")).toEqual(
      expect.arrayContaining([
        expect.stringContaining("OpenRouter"),
        expect.stringContaining("Talk instead of typing"),
      ]),
    );
  });

  it("names the double press on a box that takes one, and not on one that does not", () => {
    expect(hover({ doubleStop: true })[0]).toContain("Press Stop twice quickly to send");
    act(() => root.unmount());
    root = createRoot(host);
    expect(hover({ doubleStop: false })[0]).not.toContain("twice");
  });

  it("says Enter in the command bar, and save in the annotate box", () => {
    expect(hover({ doubleStop: true, done: "enter" })[0]).toContain("to press Enter");
    act(() => root.unmount());
    root = createRoot(host);
    expect(hover({ doubleStop: true, done: "save" })[0]).toContain("to save");
  });

  it("has none on a button the box has switched off", () => {
    expect(hover({ disabled: true })).toEqual([]);
  });

  it("stands aside while the microphone is on", () => {
    expect(hover({ d: { armed: true, phase: "listening" } })).toEqual([]);
  });

  it("stands aside during the second-press window and leaves that click to again", () => {
    const again = vi.fn();
    const toggle = vi.fn();
    expect(hover({ d: { transcribing: true }, again, sendingAfter: false, toggle })).toEqual([]);
    const button = host.querySelector("button");
    if (!button) throw new Error("no button");
    act(() => button.click());
    expect(again).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
  });

  it("says saving in Annotate's progress strip", () => {
    act(() => {
      root.render(
        createElement(DictationStrip, {
          dictation: dictation({
            transcribing: true,
            endsAt: null,
            error: null,
            deviceLabel: null,
            interim: "",
            quiet: false,
          }),
          sendingAfter: true,
          done: "save",
        }),
      );
    });
    expect(host.textContent).toContain("Turning that into text, then saving");
    expect(host.textContent).not.toContain("then sending");
  });
});
