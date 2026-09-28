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

/** A controllable ResizeObserver: jsdom has no layout observer of its own. */
const resizeObservers = new Set<TestResizeObserver>();
class TestResizeObserver {
  readonly observed = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.add(this);
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
  fire(element: Element): void {
    if (this.observed.has(element)) this.callback([], this as unknown as ResizeObserver);
  }
}

const resized = (element: Element) => {
  for (const observer of [...resizeObservers]) observer.fire(element);
};

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
  resizeObservers.clear();
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
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
  vi.unstubAllGlobals();
  resizeObservers.clear();
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
const keyDownOn = (el: Element) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
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

  it("goes when the reader starts typing in a band field", () => {
    press("search");
    const box = band.querySelector(".srch-box") as Element;
    keyDownOn(box);
    expect(shown()).toBe("");
    expect(done).toBe(1);
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

/**
 * **It stands on the band's pinned foot rather than over it** — Greg,
 * 2026-09-28, moved it to the bottom-left of the band, and eleven modes can end
 * in pinned furniture (*Find more*, Chat's composer, Diagram's step row and
 * card). The room it leaves is the band's bottom minus the bottom of the band's
 * last growing child, written onto the slot as `--herald-foot`;
 * tests/mode-herald-in-chrome.test.tsx is what that does to the card on a
 * laid-out page.
 * docs/plans/260928a-the-mode-herald-moves-to-the-foot-of-the-band.md.
 */
describe("the herald's room for the band's foot", () => {
  const rect = (el: Element, top: number, bottom: number) => {
    el.getBoundingClientRect = () =>
      ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top }) as DOMRect;
  };
  const room = (): string =>
    host.querySelector<HTMLElement>(".mode-herald-slot")?.style.getPropertyValue("--herald-foot") ?? "";
  /** Mutation observers report on a microtask, which fake timers do not run. */
  const settle = () => act(async () => {});

  function footRow() {
    const foot = document.createElement("div");
    rect(foot, 740, 800);
    return foot;
  }
  function build(withFoot: boolean) {
    band.innerHTML = "";
    rect(band, 0, 800);
    const head = document.createElement("div");
    rect(head, 0, 40);
    const scroller = document.createElement("div");
    scroller.style.flexGrow = "1";
    rect(scroller, 40, withFoot ? 740 : 800);
    band.append(head, scroller);
    if (withFoot) band.append(footRow());
    return scroller;
  }

  it("leaves the foot's height below the card", () => {
    build(true);
    press("glossary");
    expect(room()).toBe("60px");
  });

  it("leaves none in a band whose scroller runs to the bottom", () => {
    build(false);
    press("summary");
    expect(room()).toBe("0px");
  });

  it("leaves none in a band with nothing that grows, rather than guessing", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const list = document.createElement("div");
    rect(list, 0, 300);
    band.append(list);
    press("search");
    expect(room()).toBe("0px");
  });

  /* Sketch: the band's grower is `.sk`, which does not scroll; its own grower
     `.sk-scroll` does, and the pinned `.sk-card` sits after it, inside `.sk`.
     GPT Sol's plan review, 2026-09-28. */
  it("follows a grower that does not scroll down to the one that does — Sketch's nested card", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const sk = document.createElement("div");
    sk.style.flexGrow = "1";
    rect(sk, 0, 800);
    const scroll = document.createElement("div");
    scroll.style.flexGrow = "1";
    scroll.style.overflowY = "auto";
    rect(scroll, 30, 690);
    const card = document.createElement("div");
    rect(card, 690, 800);
    sk.append(scroll, card);
    band.append(sk);
    press("diagram");
    expect(room()).toBe("110px");
  });

  it("does not look inside a scroller, whose children are content rather than furniture", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const scroller = document.createElement("div");
    scroller.style.flexGrow = "1";
    scroller.style.overflowY = "auto";
    rect(scroller, 40, 740);
    const tallItem = document.createElement("div");
    tallItem.style.flexGrow = "1";
    rect(tallItem, 40, 2000);
    scroller.append(tallItem);
    band.append(scroller, footRow());
    press("glossary");
    expect(room()).toBe("60px");
  });

  it("leaves all furniture after a direct scroller — Diagram's step row and detail card", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const scroll = document.createElement("div");
    scroll.style.flexGrow = "1";
    scroll.style.overflowY = "auto";
    rect(scroll, 40, 620);
    const step = document.createElement("div");
    rect(step, 620, 680);
    const detail = document.createElement("div");
    rect(detail, 680, 800);
    band.append(scroll, step, detail);
    press("diagram");
    expect(room()).toBe("180px");
  });

  it("leaves none for a nested scroller that reaches its wrapper's bottom — Illustrated", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const illustrated = document.createElement("div");
    illustrated.style.flexGrow = "1";
    rect(illustrated, 0, 800);
    const bar = document.createElement("div");
    rect(bar, 0, 60);
    const scroll = document.createElement("div");
    scroll.style.flexGrow = "1";
    scroll.style.overflowY = "auto";
    rect(scroll, 60, 800);
    illustrated.append(bar, scroll);
    band.append(illustrated);
    press("diagram");
    expect(room()).toBe("0px");
  });

  it("makes room for a foot that arrives after the card does — the list loads, then Find more", async () => {
    const scroller = build(false);
    press("glossary");
    expect(room()).toBe("0px");
    rect(scroller, 40, 740);
    band.append(footRow());
    await settle();
    expect(room()).toBe("60px");
  });

  it("makes room when a foot arrives inside a non-scrolling grower — Sketch finishes loading", async () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const sk = document.createElement("div");
    sk.style.flexGrow = "1";
    rect(sk, 0, 800);
    const scroll = document.createElement("div");
    scroll.style.flexGrow = "1";
    scroll.style.overflowY = "auto";
    rect(scroll, 30, 800);
    sk.append(scroll);
    band.append(sk);
    press("diagram");
    expect(room()).toBe("0px");

    rect(scroll, 30, 690);
    const card = document.createElement("div");
    rect(card, 690, 800);
    sk.append(card);
    await settle();
    expect(room()).toBe("110px");
  });

  it("remeasures when the nested grower changes size — Sketch's card changes height", () => {
    band.innerHTML = "";
    rect(band, 0, 800);
    const sk = document.createElement("div");
    sk.style.flexGrow = "1";
    rect(sk, 0, 800);
    const scroll = document.createElement("div");
    scroll.style.flexGrow = "1";
    scroll.style.overflowY = "auto";
    rect(scroll, 30, 690);
    const card = document.createElement("div");
    rect(card, 690, 800);
    sk.append(scroll, card);
    band.append(sk);
    press("diagram");
    expect(room()).toBe("110px");

    rect(scroll, 30, 650);
    rect(card, 650, 800);
    act(() => resized(scroll));
    expect(room()).toBe("150px");
  });

  it("removes its measured custom property when the card goes", () => {
    build(true);
    press("glossary");
    expect(room()).toBe("60px");
    pointerDownOn(band);
    expect(room()).toBe("");
  });

  it("keeps the measured property when React writes the keyboard inset onto the same style", async () => {
    vi.stubGlobal("visualViewport", {
      height: 500,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
    });
    build(true);
    press("search");
    await settle();
    const slot = host.querySelector<HTMLElement>(".mode-herald-slot");
    expect(slot?.style.getPropertyValue("--kb-inset")).not.toBe("");
    expect(room()).toBe("60px");
  });
});
