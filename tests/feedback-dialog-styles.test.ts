/**
 * The Feedback dialog's two asks of 2026-10-11, in the stylesheet (plan 261011h).
 *
 * - **Bigger still on a large window** (`spya-tfp3zw`): a 1280px step, wider,
 *   and taller on a window tall enough, above the 1024px step 261008i made.
 * - **Green to send, red to defer** in a Needs-a-decision thread
 *   (`spya-zjsqe6`): from the measured tokens, and weighty enough to beat
 *   `.fb-copy`, which comes later in the file at one class.
 *
 * The classes reaching the right buttons is `feedback-dialog.test.tsx`'s job.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mediaBlock, stripComments } from "./helpers/stylesheets.js";

const CSS = stripComments(readFileSync("src/web/styles/feedback.css", "utf8"));

/** Every declaration of `prop` in a rule whose selector list includes `selector`. */
function declared(css: string, selector: string, prop: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const d of m[2]!.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))) out.push(d[1]!.trim());
  }
  return out;
}

describe("the Feedback dialog on a large window", () => {
  it("is 56rem wide from 1280px", () => {
    expect(declared(mediaBlock(CSS, "(min-width: 1280px)", "width: min(90vw, 56rem)"), ".fb-panel", "width")).toEqual([
      "min(90vw, 56rem)",
    ]);
  });

  it("is at least 56rem tall from 1280×900, still capped by the 90% everywhere", () => {
    const tall = mediaBlock(CSS, "(min-width: 1280px) and (min-height: 900px)", ".fb-panel");
    expect(declared(tall, ".fb-panel", "min-height")).toEqual(["min(90%, 56rem)"]);
    expect(declared(CSS, ".fb-panel", "max-height")).toEqual(["90%"]);
  });
});

describe("a Needs-a-decision thread's Send reply and Defer for now", () => {
  it("draws Send reply in --positive and Defer for now in --danger, hover included", () => {
    for (const sel of [".fb-reply-thread .fb-reply-send", ".fb-reply-thread .fb-reply-send:hover"]) {
      expect(declared(CSS, sel, "color"), sel).toEqual(["var(--positive)"]);
    }
    for (const sel of [".fb-reply-thread .fb-defer", ".fb-reply-thread .fb-defer:hover"]) {
      expect(declared(CSS, sel, "color"), sel).toEqual(["var(--danger)"]);
    }
  });

  it("keeps the coloured border on hover, and puts no wash behind the words", () => {
    for (const sel of [
      ".fb-reply-thread .fb-reply-send",
      ".fb-reply-thread .fb-reply-send:hover",
      ".fb-reply-thread .fb-defer",
      ".fb-reply-thread .fb-defer:hover",
    ]) {
      expect(declared(CSS, sel, "border-color"), sel).toEqual(["currentColor"]);
      /* A tint behind takes Light under the 4.5:1 the tokens are held to. */
      expect(declared(CSS, sel, "background"), sel).toEqual([]);
    }
  });

  it("leaves the shared send box and a bare .fb-defer uncoloured", () => {
    expect(declared(CSS, ".fb-reply-send", "color")).toEqual([]);
    expect(declared(CSS, ".fb-defer", "color")).toEqual([]);
  });
});
