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
import { readerCssNoComments } from "./helpers/stylesheets.js";

import { watchReveals } from "../src/web/reveal-once.js";

class FakeObserver {
  static all: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
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
function section(top: number, parent: ParentNode = page): HTMLElement {
  const el = document.createElement("section");
  el.className = "site-reveal";
  el.getBoundingClientRect = () => ({ top, bottom: top + 200 }) as DOMRect;
  parent.append(el);
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
  it("keeps a trigger area for a section at the bottom of a wide, short viewport", () => {
    vi.stubGlobal("innerWidth", 4000);
    vi.stubGlobal("innerHeight", 240);
    const below = section(2000);
    const stop = watchReveals(page);
    const io = FakeObserver.all[0]!;
    /* IntersectionObserver percentages, even vertical ones, resolve against
       width (the platform spec). The old -8% margin erased this whole root.
       At the end of a page a target may enter only the bottom of the window. */
    const margins = (io.options.rootMargin ?? "0px").split(/\s+/);
    const bottom = margins[2] ?? margins[0]!;
    const inset = Number.parseFloat(bottom) * (bottom.endsWith("%") ? innerWidth / 100 : 1);
    const rootBottom = innerHeight + inset;
    below.getBoundingClientRect = () => ({ top: 220, bottom: 240 }) as DOMRect;
    io.fire(below, below.getBoundingClientRect().top < rootBottom);
    expect(waiting(below)).toBe(false);
    expect(shown(below)).toBe(true);
    stop();
  });

  it("leaves a section above the window visible on a restored scroll position", () => {
    const above = section(-1000);
    const stop = watchReveals(page);
    expect(waiting(above)).toBe(false);
    expect(shown(above)).toBe(true);
    expect(FakeObserver.all[0]!.observed.has(above)).toBe(false);
    stop();
  });

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

  it("takes nested late sections, stops watching additions, and can start the next route", async () => {
    const stop = watchReveals(page);
    const old = FakeObserver.all[0]!;
    const container = document.createElement("div");
    const late = section(2000, container);
    page.append(container);
    await new Promise((go) => setTimeout(go, 0));
    expect(old.observed.has(late)).toBe(true);
    stop();
    expect(waiting(late)).toBe(false);
    const next = section(2000);
    await new Promise((go) => setTimeout(go, 0));
    expect(waiting(next)).toBe(false);
    const stopNext = watchReveals(page);
    expect(FakeObserver.all[1]!.observed.has(next)).toBe(true);
    /* An intersection queued by the old route cannot re-hide anything. */
    old.fire(late, true);
    expect(waiting(late)).toBe(false);
    expect(shown(late)).toBe(true);
    stopNext();
    expect(waiting(next)).toBe(false);
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

  it("clears sections already hidden when observing fails partway through startup", () => {
    vi.stubGlobal("IntersectionObserver", class extends FakeObserver {
      override observe(el: Element): void {
        super.observe(el);
        if (this.observed.size === 2) throw new Error("observe failed");
      }
    });
    const first = section(2000);
    const second = section(3000);
    watchReveals(page)();
    expect(waiting(first)).toBe(false);
    expect(waiting(second)).toBe(false);
    expect(FakeObserver.all[0]!.disconnected).toBe(true);
  });
});

describe("the reveal CSS visibility contract", () => {
  const css = readerCssNoComments();
  it("starts visible and hides only a section the observer is watching", () => {
    expect(css.match(/\.site-reveal\s*\{([^}]+)\}/)?.[1]).toContain("opacity: 1");
    expect(css.match(/\.site-reveal\[data-reveal-waiting\]\s*\{([^}]+)\}/)?.[1]).toContain("opacity: 0");
    expect(css).not.toContain("animation: site-rise");
  });

  it.each(["print", "(prefers-reduced-motion: reduce)"])(
    "%s shows a waiting section immediately, including a runtime preference change",
    (media) => {
      /* Bound the media block: slicing to EOF would let reduced motion stand
         in for a missing print override and call that a pass. */
      const escaped = media.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const blocks = css.matchAll(new RegExp(`@media ${escaped}\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, "g"));
      const rules = Array.from(blocks, (block) => block[1]!)
        .map((block) => block.match(/\.site-reveal\s*,[^{}]*\{([^}]+)\}/)?.[1])
        .find((rule) => rule !== undefined);
      expect(rules).toContain("opacity: 1 !important");
      expect(rules).toContain("transform: none !important");
      expect(rules).toContain("transition: none !important");
    },
  );
});
