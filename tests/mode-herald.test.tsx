// @vitest-environment jsdom
/**
 * **A mode the reader has just pressed says what it is, for a moment.**
 *
 * Greg, 2026-09-12, on an iPad (SPIDERYARN-READING2-3Q): *"if I'm on an iPad
 * and I click on a mode, there's no tooltip, there's no heading, there's no
 * explanation."* The band's title went on 2026-09-05, the Dock's labels drop
 * when the row does not fit, and what they leave is a hover card a finger never
 * sees. docs/plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md.
 *
 * This file is the component on its own, under `StrictMode` as `main.tsx`
 * mounts it, driven by a stand-in for `Reader` that holds the press and clears
 * it when told to. Whether `Reader` actually hands it a press — for a Dock
 * press, and not for a pasted `?mode=` — is the other half, and it is in
 * tests/mode-herald-wiring.test.tsx, because a unit with its props supplied
 * cannot see whether anything supplies them.
 *
 * **Not the wording**: the name is `MODE_LABEL` and the sentence is the
 * catalog's `description`, both read from their homes here rather than copied.
 */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";
import type { Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import { HERALD_MS, type HeraldPress, ModeHerald } from "../src/web/ModeHerald.js";

let host: HTMLDivElement;
let root: Root;
/** A stand-in band, so a press can land inside one. */
let band: HTMLElement;
/** Set by the stand-in, so a case can press a mode from outside React. */
let pressMode: (mode: Mode) => void = () => {};
let done = 0;

function StandIn() {
  const [press, setPress] = useState<HeraldPress | null>(null);
  pressMode = (mode) => setPress((prev) => ({ mode, nonce: (prev?.nonce ?? 0) + 1 }));
  return createElement(ModeHerald, {
    press,
    onDone: () => {
      done++;
      setPress(null);
    },
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  done = 0;
  band = document.createElement("aside");
  band.className = "mode-band";
  band.innerHTML = '<input class="srch-box" />';
  document.body.append(band);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(StrictMode, null, createElement(StandIn))));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  band.remove();
  vi.useRealTimers();
});

/** What a sighted reader sees: the card's text. */
const shown = (): string => host.querySelector(".mode-herald")?.textContent ?? "";
/** What a screen reader is told. */
const announced = (): string => {
  const found = host.querySelector<HTMLElement>('[role="status"]');
  expect(found, "the live region is always mounted").not.toBeNull();
  return found?.textContent ?? "";
};
const press = (mode: Mode) => act(() => pressMode(mode));
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const pointerDownOn = (el: Element) =>
  act(() => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });

describe("the herald", () => {
  it("says nothing when nothing was pressed — and the region is there to be filled", () => {
    expect(shown()).toBe("");
    expect(announced()).toBe("");
  });

  it("shows the pressed mode's name and what it is for", () => {
    press("glossary");
    expect(shown()).toContain(MODE_LABEL.glossary);
    expect(shown()).toContain(MODE_CATALOG.glossary.description);
  });

  it("tells a screen reader the sentence, not the name the Dock's radio has just said", () => {
    press("glossary");
    expect(announced()).toBe(MODE_CATALOG.glossary.description);
    expect(host.querySelector(".mode-herald-slot")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("goes by itself once its time is up, and not before", () => {
    press("quotes");
    wait(HERALD_MS - 50);
    expect(shown(), "still showing just before the deadline").toContain(MODE_LABEL.quotes);
    wait(100);
    expect(shown()).toBe("");
    expect(done).toBe(1);
  });

  it("goes the moment the reader presses anything in the band — and the press is not spent on it", () => {
    press("search");
    const box = band.querySelector(".srch-box") as Element;
    pointerDownOn(box);
    expect(shown()).toBe("");
    expect(done).toBe(1);
    // And the timer it had does not fire a second `onDone` later.
    wait(HERALD_MS * 2);
    expect(done).toBe(1);
  });

  it("stays for a press outside the band, which is about something else", () => {
    press("search");
    pointerDownOn(document.body);
    expect(shown()).toContain(MODE_LABEL.search);
    expect(done).toBe(0);
  });

  it("a second press starts its own three seconds rather than inheriting the first's", () => {
    press("glossary");
    wait(HERALD_MS - 500);
    press("ideas");
    expect(shown()).toContain(MODE_LABEL.ideas);
    expect(shown()).not.toContain(MODE_LABEL.glossary);
    wait(1000);
    expect(shown(), "the first press's deadline has passed; the second's has not").toContain(
      MODE_LABEL.ideas,
    );
    wait(HERALD_MS);
    expect(shown()).toBe("");
    expect(done).toBe(1);
  });
});
