/**
 * **On a narrow touch screen the gutter's column gives its room to the prose,
 * and a tap brings the icons up in a bar above the paragraph** — gutter.css
 * § a narrow screen and a finger, narrow-window.css's matching pad tokens.
 * docs/plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md.
 *
 * The browser check is the real evidence (a desktop Chrome harness never
 * matches `(hover: none)`); this pins the declarations it depends on, so a
 * later edit that quietly drops one is caught here rather than on a phone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mediaBlock, readerCssNoComments } from "./helpers/stylesheets.js";

const css = readerCssNoComments();
const component = readFileSync(new URL("../src/web/BlockGutter.tsx", import.meta.url), "utf8");
const PHONE = "(max-width: 731px) and (hover: none)";
const ROOTS = [9, 12, 16, 20, 24];

/** The declarations of one rule inside `block`, whitespace flattened. */
function rule(block: string, selector: string): string {
  for (const m of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const whole = (m[1] ?? "").replace(/\s+/g, " ").trim();
    // Split at top-level commas only, so an `:is(a, b)` stays one selector.
    const parts = whole.split(/,(?![^()]*\))/).map((p) => p.trim());
    if (whole === selector || parts.includes(selector)) return (m[2] ?? "").replace(/\s+/g, " ").trim();
  }
  throw new Error(`no rule for \`${selector}\``);
}

describe("a narrow touch screen: the gutter as a bar above the paragraph", () => {
  const block = mediaBlock(css, PHONE, ".blk-permalink");
  const BAR = "tr.row-active td.text .blk-gutter";

  it("narrows both pads, and only under a finger", () => {
    const narrow = mediaBlock(css, "(max-width: 731px)", "--text-pad-l: 0.9rem");
    const touch = mediaBlock(narrow, "(hover: none)", "--text-pad-r");
    expect(touch).toMatch(/--text-pad-l:\s*0\.6rem/);
    expect(touch).toMatch(/--text-pad-r:\s*max\(1\.25rem,\s*19px\)/);
    expect(touch).toMatch(/--blk-gutter-x:\s*0px/);
  });

  it.each(ROOTS)("keeps the mark glyph inside the right pad at a %ipx root", (root) => {
    const narrow = mediaBlock(css, "(max-width: 731px)", "--text-pad-l: 0.9rem");
    const touch = mediaBlock(narrow, "(hover: none)", "--text-pad-r");
    const pad = /--text-pad-r:\s*max\(\s*([\d.]+)rem\s*,\s*([\d.]+)px\s*\)/.exec(touch);
    const glyph = /const GLYPH\s*=\s*([\d.]+);/.exec(component);
    const inset = /padding-inline-end:\s*([\d.]+)px/.exec(rule(block, ".blk-gutter > *"));
    expect(pad, "the phone pad has no px floor for the fixed-pixel glyph").not.toBeNull();
    expect(glyph, "BlockGutter's glyph size is no longer a numeric constant").not.toBeNull();
    expect(inset, "the at-rest glyph has no numeric end inset").not.toBeNull();
    const padPx = Math.max(Number(pad?.[1]) * root, Number(pad?.[2]));
    expect(padPx).toBeGreaterThanOrEqual(Number(glyph?.[1]) + Number(inset?.[1]));
  });

  it("keeps the reading-time strip's coarse-pointer target one full slot wide", () => {
    expect(rule(block, ".blk-gutter > span.blk-read::before")).toContain(
      "width: calc(min(var(--read, 0), 1) * var(--blk-slot))",
    );
  });

  it("makes the selected row's gutter one horizontal row that takes its own taps", () => {
    const bar = rule(block, BAR);
    expect(bar).toContain("grid-auto-flow: column");
    expect(bar).toContain("container-type: normal");
    expect(bar).toContain("pointer-events: auto");
    expect(bar).toContain("top: auto");
    expect(bar).toMatch(/bottom: calc\(100% - var\(--blk-top\)/);
    expect(bar).toContain("z-index: 3");
  });

  it("shows every control by name, because the container queries no longer apply", () => {
    const shown = rule(
      block,
      `${BAR} > :is(.blk-cmt, .blk-permalink, .block-chat, .blk-bookmark, .blk-help)`,
    );
    expect(shown).toContain("display: inline-flex");
    expect(rule(block, `${BAR} > .blk-more`)).toContain("display: none");
    const mark = rule(block, `${BAR} > .blk-cmt`);
    expect(mark).toContain("opacity: 1");
    expect(mark).toContain("pointer-events: auto");
  });

  it("hides the counts at rest and gives them back in the bar", () => {
    for (const count of [".blk-n", ".block-chat-n"]) {
      expect(rule(block, `.blk-gutter ${count}`)).toContain("display: none");
      expect(rule(block, `${BAR} ${count}`)).toContain("display: inline");
    }
  });
});
