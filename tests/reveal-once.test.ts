// @vitest-environment jsdom
/**
 * **The marketing pages' fade-ins reveal once and stay** — plan 261007h, F5c.
 *
 * Until 2026-10-07 `.site-reveal` was a CSS scroll-driven animation, reversible
 * by nature, so a section you had already read faded out again when you
 * scrolled back up past it. Now `watchReveals` marks each one shown the first
 * time it enters and stops watching it.
 *
 * The escapes are the half that matters (GPT Sol, plan review R16): the CSS
 * hides only what this script has marked as waiting, so with no
 * `IntersectionObserver`, a reader who asked for less motion, or a start that
 * throws, nothing is ever hidden. jsdom has no `IntersectionObserver`, so a
 * fake one stands in and the test fires its entries by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { watchReveals } from "../src/web/reveal-once.js";

class FakeObserver {
  static all: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this);
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
  /** Tell the page `el` has crossed into (or out of) the viewport. */
  fire(el: Element, isIntersecting: boolean): void {
    this.callback(
      [{ target: el, isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let reduced = false;
let page: HTMLDivElement;

/** A `.site-reveal` whose top is `top` px down the window (jsdom lays nothing out). */
function section(top: number): HTMLElement {
  const el = document.createElement("section");
  el.className = "site-reveal";
  el.getBoundingClientRect = () => ({ top, bottom: top + 200 }) as DOMRect;
  page.append(el);
  return el;
}

const waiting = (el: Element) => el.hasAttribute("data-reveal-waiting");
const shown = (el: Element) => el.hasAttribute("data-shown");

beforeEach(() => {
  FakeObserver.all = [];
  reduced = false;
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduce") && reduced,
    media: query,
  }));
  page = document.createElement("div");
  document.body.append(page);
});

afterEach(() => {
  page.remove();
  vi.unstubAllGlobals();
});

describe("watchReveals", () => {
  it("hides only what is below the window, and shows it once it enters", () => {
    const above = section(100);
    const below = section(2000);
    const stop = watchReveals(page);
    const io = FakeObserver.all[0]!;

    /* Already on screen: never hidden, so nothing the reader is looking at blinks. */
    expect(waiting(above)).toBe(false);
    expect(shown(above)).toBe(true);
    expect(io.observed.has(above)).toBe(false);

    expect(waiting(below)).toBe(true);
    expect(io.observed.has(below)).toBe(true);

    io.fire(below, true);
    expect(waiting(below)).toBe(false);
    expect(shown(below)).toBe(true);
    /* Unobserved, so scrolling back past it cannot hide it again. */
    expect(io.observed.has(below)).toBe(false);
    io.fire(below, false);
    expect(waiting(below)).toBe(false);
    stop();
  });

  it("ignores an entry that has not crossed in", () => {
    const below = section(2000);
    const stop = watchReveals(page);
    FakeObserver.all[0]!.fire(below, false);
    expect(waiting(below)).toBe(true);
    stop();
  });

  it("watches a section that arrives after it started", async () => {
    const stop = watchReveals(page);
    const late = section(2000);
    await new Promise((go) => setTimeout(go, 0));
    expect(waiting(late)).toBe(true);
    expect(FakeObserver.all[0]!.observed.has(late)).toBe(true);
    stop();
  });

  it("stopping shows everything it had hidden and lets go", () => {
    const below = section(2000);
    const stop = watchReveals(page);
    stop();
    expect(waiting(below)).toBe(false);
    expect(FakeObserver.all[0]!.disconnected).toBe(true);
  });

  it("with no IntersectionObserver, hides nothing", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const below = section(2000);
    watchReveals(page)();
    const again = watchReveals(page);
    expect(waiting(below)).toBe(false);
    again();
  });

  it("for a reader who asked for less motion, hides nothing", () => {
    reduced = true;
    const below = section(2000);
    const stop = watchReveals(page);
    expect(waiting(below)).toBe(false);
    expect(FakeObserver.all).toHaveLength(0);
    stop();
  });

  it("when the start throws, hides nothing", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          throw new Error("no");
        }
      },
    );
    const below = section(2000);
    const stop = watchReveals(page);
    expect(waiting(below)).toBe(false);
    stop();
  });
});
