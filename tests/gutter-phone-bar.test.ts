/**
 * **On a no-hover touch screen the gutter's column gives its room to the prose,
 * and a tap brings the icons up in a bar above the paragraph** — gutter.css §
 * a no-hover screen, narrow-window.css's matching pad tokens. On a phone since
 * docs/plans/261018g-phone-portrait-gutter-icons-above-the-paragraph.md, and
 * on every no-hover screen, the iPad included, since
 * docs/plans/261019d-touch-screens-get-the-gutter-bar-and-narrower-prose-margins-ipad-included.md.
 *
 * The browser check is the real evidence (a desktop Chrome harness never
 * matches `(hover: none)`); this pins the declarations it depends on, so a
 * later edit that quietly drops one is caught here rather than on a phone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { enclosing, mediaBlock, readerCssNoComments } from "./helpers/stylesheets.js";

const css = readerCssNoComments();
const component = readFileSync(new URL("../src/web/BlockGutter.tsx", import.meta.url), "utf8");
const NO_HOVER = "(hover: none)";
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

describe("a no-hover screen: the gutter as a bar above the paragraph", () => {
  const BAR = "tr.row-active td.text .blk-gutter";
  const block = mediaBlock(css, NO_HOVER, `${BAR} >`);
  const pads = mediaBlock(css, NO_HOVER, "--text-pad-r");

  it("applies at every width, not only a phone's", () => {
    for (const marker of [`${BAR} >`, "--text-pad-r: max("]) {
      const at = css.indexOf(marker, css.indexOf(`@media ${NO_HOVER}`));
      const preludes = enclosing(css, at).slice(1);
      expect(preludes.some((p) => p.includes("max-width")), `${marker} sits under a width query`).toBe(false);
    }
  });

  it("narrows both pads, and only under a finger", () => {
    const touch = pads;
    expect(touch).toMatch(/--text-pad-l:\s*0\.6rem/);
    expect(touch).toMatch(/--text-pad-r:\s*max\(1\.25rem,\s*19px\)/);
    expect(touch).toMatch(/--blk-gutter-x:\s*0px/);
  });

  it.each(ROOTS)("keeps the mark glyph inside the right pad at a %ipx root", (root) => {
    const touch = pads;
    const pad = /--text-pad-r:\s*max\(\s*([\d.]+)rem\s*,\s*([\d.]+)px\s*\)/.exec(touch);
    const glyph = /const GLYPH\s*=\s*([\d.]+);/.exec(component);
    const inset = /padding-inline-end:\s*([\d.]+)px/.exec(rule(block, ".blk-gutter > *"));
    expect(pad, "the touch pad has no px floor for the fixed-pixel glyph").not.toBeNull();
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
