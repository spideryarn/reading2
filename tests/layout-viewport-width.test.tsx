// @vitest-environment jsdom
/**
 * **The reading view lays out for the layout viewport, not the visual one.**
 *
 * On iPad Safari `window.innerWidth` is the *visual* viewport — it shrinks
 * when the page is zoomed in — while every media query and the root's
 * `clientWidth` are the *layout* viewport, which zoom does not touch. A zoom
 * survives a rotation and a later zoom change fires no window `resize`, so a
 * rotation taken zoomed in used to store a width two-thirds of the real one,
 * and Structure drew its narrow face on a landscape iPad until something else
 * resized the window. SPIDERYARN-READING2-33/-34;
 * docs/plans/260912b-a-rotation-lays-the-reading-view-out-for-the-new-width.md.
 *
 * jsdom lays nothing out, so both widths are stubbed: `innerWidth` on the
 * window and `clientWidth` on `<html>`. What this proves is which number the
 * hook believes when the two disagree, not what an iPad reports — that is the
 * `?probe=1` trace's job.
 */
import { globSync, readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWindowWidth } from "../src/web/reader/measure.js";

/**
 * **The files that may read `innerWidth` raw, and why each wants the browser's
 * own answer rather than the layout width.** Anything else in `src/web` that
 * reads it is a layout decision taken in the wrong viewport on an iPad.
 *
 * Width only: the `innerHeight` reads in the client want the *visible* height —
 * the browser chrome, the focus line, the scroll position — and are right to.
 * GPT Sol, reviewing the plan, F1.
 */
const RAW_INNER_WIDTH_ALLOWED: Record<string, string> = {
  "src/web/reader/measure.ts": "the one definition, `layoutViewportWidth`",
  "src/web/ViewportProbe.tsx": "an instrument recording what the browser says",
  "src/web/feedback-diagnostics.ts": "a report recording what the browser says",
  "src/web/SmallScreenHint.tsx":
    "a ratio of innerWidth to innerHeight, which zoom scales together (Sol F3)",
  "src/web/OutlinePanel.tsx":
    "paired with getBoundingClientRect, whose coordinate space under iOS zoom is itself a WebKit bug (Sol F2)",
};

/** Code only: a comment that *mentions* `innerWidth` is not a read of it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("raw innerWidth in the client", () => {
  it("is read only where the browser's own answer is wanted", () => {
    const files = globSync("src/web/**/*.{ts,tsx}").filter((f) => !f.endsWith(".d.ts"));
    // A glob that found nothing would pass this for ever.
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter(
      (file) =>
        !(file in RAW_INNER_WIDTH_ALLOWED) &&
        /\binnerWidth\b/.test(stripComments(readFileSync(file, "utf8"))),
    );
    expect(offenders, "use layoutViewportWidth() from src/web/reader/measure.ts").toEqual([]);
  });

  it("lists no file that has stopped reading it", () => {
    const stale = Object.keys(RAW_INNER_WIDTH_ALLOWED).filter(
      (file) => !/\binnerWidth\b/.test(stripComments(readFileSync(file, "utf8"))),
    );
    expect(stale).toEqual([]);
  });
});

function setWidths(inner: number, client: number): void {
  Object.defineProperty(window, "innerWidth", { value: inner, configurable: true });
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: client,
    configurable: true,
  });
}

let seen: number[] = [];
function Probe() {
  seen.push(useWindowWidth());
  return null;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  seen = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  /* Put jsdom's own answers back: `innerWidth` 1024, `clientWidth` 0. */
  setWidths(1024, 0);
});

describe("useWindowWidth under zoom", () => {
  it("lays out for the layout width when a zoomed-in rotation shrinks innerWidth", () => {
    // Portrait iPad at scale 1: the two agree.
    setWidths(820, 820);
    act(() => root.render(<Probe />));
    expect(seen.at(-1)).toBe(820);

    // Rotated to landscape while zoomed ×1.5: the visual viewport is 1180 / 1.5.
    setWidths(787, 1180);
    act(() => {
      window.dispatchEvent(new Event("orientationchange"));
      window.dispatchEvent(new Event("resize"));
    });
    expect(seen.at(-1)).toBe(1180);
  });

  it("keeps innerWidth where it is the wider one — a desktop's classic scrollbar", () => {
    // `@media (max-width)` includes the scrollbar, and so does innerWidth.
    setWidths(1280, 1265);
    act(() => root.render(<Probe />));
    expect(seen.at(-1)).toBe(1280);
  });
});
