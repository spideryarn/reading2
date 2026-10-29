/**
 * **Structure's band uses its width, and keeps its height while the bottom
 * bar slides.** Two of Greg's reports from a portrait iPad on 2026-10-25,
 * docs/plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md.
 *
 * jsdom lays nothing out, so the rules themselves are what a test can hold;
 * the browser half is `scripts/structure-scroll-trace.ts`. A rule this cannot
 * find is a failure here, never a pass.
 */
import { describe, expect, it } from "vitest";
import { readerCss } from "./helpers/stylesheets.js";

const BARE = readerCss().replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block whose selector list is exactly `selector`. */
function blocks(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
  return [...BARE.matchAll(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1] ?? "");
}
const decl = (block: string, prop: string) =>
  new RegExp(`(?:^|;)\\s*${prop.replace(/-/g, "\\-")}\\s*:\\s*([^;]+)`).exec(block)?.[1]?.trim();

describe("Structure's list face", () => {
  /* spya-tj0vqa: the (i) sits in the head row, which keeps clear of it on its
     own; widening every row's inset for it left ~55px blank down the list on
     a touch screen. */
  it("does not give the rows of the list the corner button's room", () => {
    const widened = [...BARE.matchAll(/--outln-pad-r\s*:\s*([^;}]+)/g)].map((m) => m[1] ?? "");
    expect(widened.length).toBeGreaterThan(0);
    for (const value of widened) expect(value).not.toContain("--band-about-room");
  });
});

describe("Structure's band while the bottom bar slides (spya-m5gxk9)", () => {
  it("names the bar's travel once, from the same terms the band's bottom edge reads", () => {
    const band = blocks(".mode-band").find((b) => decl(b, "bottom") !== undefined);
    expect(band, "the .mode-band rule with its bottom edge").toBeDefined();
    expect(decl(band!, "bottom")).toBe("calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-now))");
    expect(decl(band!, "--band-bar-travel")).toBe(
      "calc(max(var(--dock-space), var(--safe-bottom)) + var(--hint-h) - max(var(--dock-bottom), var(--safe-bottom)) - var(--hint-now))",
    );
  });

  it.each([".mode-band.outln", ".mode-band.struct"])(
    "%s pads its foot by that travel, so its content box does not change",
    (selector) => {
      const padded = blocks(selector).map((b) => decl(b, "padding")).filter((v) => v !== undefined);
      expect(padded.length, `${selector} has a padding shorthand`).toBe(1);
      expect(padded[0]).toContain("var(--band-bar-travel)");
      /* Nothing later sets the foot alone and undoes it. */
      for (const b of blocks(selector)) expect(decl(b, "padding-bottom")).toBeUndefined();
    },
  );
});

describe("Structure's band while the top bar would slide (GPT Sol, plan review F1)", () => {
  /* The band's top is `--bar-bottom`; a present bar sliding away grows the
     band. The guard that holds the bar home names Structure's band. */
  it("holds a present top bar home while Structure's band is open", () => {
    /* `data-band-fitted` is held by the band itself while it is Outline's or
       Structure's (src/web/band-root-flags.ts); it was
       `:where(.reader) .mode-band:is(.outln, .struct)` in a `:has()` until
       2026-10-29 (plan 261029k). */
    const guard = /:root\[data-bar-drawn\]\[data-bar-drawn\]:is\(([^{]*)\)\s*\{([^}]*)\}/.exec(BARE);
    expect(guard, "the top bar's guard").not.toBeNull();
    expect(guard![1]).toContain("[data-band-fitted]");
    expect(decl(guard![2]!, "--bar-bottom")).toBe("calc(var(--bar-h) + var(--safe-top))");
  });

  it("brings that held bar home without animating it over the band", () => {
    const arrival = /:root:is\(([^{}]*)\)\s*\.controls\s*\{([^}]*)\}/g;
    const rules = [...BARE.matchAll(arrival)];
    const rule = rules.find((m) => m[1]?.includes("[data-band-covers]"));
    expect(rule, "the mode-opening transition guard").toBeDefined();
    expect(rule![1]).toContain("[data-band-fitted]");
    expect(decl(rule![2]!, "transition")).toBe("none");
  });
});
