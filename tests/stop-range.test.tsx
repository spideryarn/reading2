// @vitest-environment jsdom
/**
 * **The range input that moves only to the values that change the list** —
 * src/web/StopRange.tsx. The arithmetic is tests/threshold-stops.test.ts; this
 * is the input: which events snap, which step, which are ignored, and the ticks.
 *
 * docs/plans/261017f-threshold-sliders-jump-between-the-values-that-change-the-count.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StopRange } from "../src/web/StopRange.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function draw(value: number, stops: number[], onChange = vi.fn()) {
  await act(async () =>
    root.render(
      createElement(StopRange, {
        id: "r",
        min: 0,
        max: 1,
        step: 0.01,
        value,
        stops,
        tip: "t",
        valueText: "v",
        onChange,
      }),
    ),
  );
  return onChange;
}

const input = () => host.querySelector<HTMLInputElement>("#r")!;

/** A key press, and whether the browser's own step was stopped. */
async function press(key: string): Promise<boolean> {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => {
    input().dispatchEvent(e);
  });
  return e.defaultPrevented;
}

async function change(value: number, { pointer }: { pointer: boolean }) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    if (pointer) input().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    setter.call(input(), String(value));
    input().dispatchEvent(new Event("input", { bubbles: true }));
    if (pointer) input().dispatchEvent(new Event("pointerup", { bubbles: true }));
  });
}

describe("StopRange", () => {
  const STOPS = [0.2, 0.5, 0.9];

  it("an arrow from between two stops goes past the one that would change nothing", async () => {
    const onChange = await draw(0.3, STOPS);
    expect(await press("ArrowRight")).toBe(true);
    expect(onChange.mock.calls).toEqual([[0.9]]);
  });

  it("every stepping key goes one stop that way, and Home and End to the ends", async () => {
    for (const [key, want] of [
      ["ArrowLeft", 0.2],
      ["ArrowDown", 0.2],
      ["PageDown", 0.2],
      ["ArrowUp", 0.9],
      ["PageUp", 0.9],
      ["Home", 0.2],
      ["End", 0.9],
    ] as const) {
      const onChange = await draw(0.5, STOPS);
      await press(key);
      expect(onChange.mock.calls, key).toEqual([[want]]);
    }
  });

  it("at the end, the key does nothing — and still stops the browser stepping between stops", async () => {
    const onChange = await draw(0.9, STOPS);
    expect(await press("ArrowRight")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves other keys alone", async () => {
    await draw(0.5, STOPS);
    expect(await press("Tab")).toBe(false);
  });

  it("a press that moves nothing is not a change (Firefox fires one)", async () => {
    const onChange = await draw(0.3, STOPS);
    await change(0.3, { pointer: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a drag lands on the nearest stop; a change with no pointer steps one stop", async () => {
    const onDrag = await draw(0.5, STOPS);
    await change(0.8, { pointer: true });
    expect(onDrag.mock.calls).toEqual([[0.9]]);
    const onStep = await draw(0.5, STOPS);
    /* One native step down, as TalkBack's swipe makes it: the nearest stop
       would be 0.50 again, and the swipe would do nothing. */
    await change(0.49, { pointer: false });
    expect(onStep.mock.calls).toEqual([[0.2]]);
  });

  it("stops treating changes as pointer drags when the pointer is released outside", async () => {
    const onChange = await draw(0.5, STOPS);
    await act(async () => {
      input().dispatchEvent(new Event("pointerdown", { bubbles: true }));
      document.dispatchEvent(new Event("pointerup", { bubbles: true }));
    });
    await change(0.51, { pointer: false });
    /* A non-pointer increment moves to the next useful stop. If the pointer
       flag is stuck, nearest-stop snapping returns to 0.50 and does nothing. */
    expect(onChange.mock.calls).toEqual([[0.9]]);
  });

  it("treats a touch drag as a pointer drag even when Pointer Events are unavailable", async () => {
    const onChange = await draw(0.5, STOPS);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      input().dispatchEvent(new Event("touchstart", { bubbles: true }));
      setter.call(input(), "0.6");
      input().dispatchEvent(new Event("input", { bubbles: true }));
      input().dispatchEvent(new Event("touchend", { bubbles: true }));
    });
    /* 0.60 is nearer 0.50 than 0.90. React must also restore the controlled
       DOM value when snapping produces the value already in props. */
    expect(onChange).not.toHaveBeenCalled();
    expect(input().value).toBe("0.5");
  });

  it("a genuine zero score is a stop, so the reader can get back to it", async () => {
    const onChange = await draw(0.4, [0, 0.4, 0.8]);
    await press("Home");
    expect(onChange.mock.calls).toEqual([[0]]);
  });

  it("with no stops it is the plain input: no ticks, keys and changes as the browser has them", async () => {
    const onChange = await draw(0.3, []);
    expect(await press("ArrowRight")).toBe(false);
    await change(0.37, { pointer: true });
    expect(onChange.mock.calls).toEqual([[0.37]]);
    expect(host.querySelector(".gloss-gate-ticks")).toBeNull();
  });

  it("draws one tick per stop at its place on the track, hidden from the screen reader", async () => {
    await draw(0.5, STOPS);
    const ticks = host.querySelector(".gloss-gate-ticks")!;
    expect(ticks.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...ticks.querySelectorAll<HTMLElement>(".gloss-gate-tick")].map((t) => t.style.getPropertyValue("--at")),
    ).toEqual(["0.2", "0.5", "0.9"]);
  });
});
