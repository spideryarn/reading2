/**
 * The three colour scales — `styles/colourscales.css`, documented in
 * docs/project/colour-scales.md.
 *
 * **This file exists because a broken colour scale looks fine.** Every other
 * kind of failure in this repo shows up as a crash, a wrong number, or a blank
 * panel. A ramp whose lightness stops climbing halfway renders perfectly: nine
 * coloured chips, no error, nothing to screenshot. What is wrong with it is a
 * *relationship* between two of the values, and the eye is bad at relationships
 * between colours it is looking at one at a time.
 *
 * That is not hypothetical here. The first version of the diverging scales was
 * hand-picked hex that looked entirely plausible, and `--div-3` was **darker
 * than the pivot** — so the blue arm dipped below the middle and came back up,
 * which is the exact non-monotonic-lightness fault that makes rainbow ramps
 * invent boundaries the data does not have. It was found by measuring, after
 * the doc claiming the opposite had already been written.
 *
 * So the properties are measured from the stylesheet rather than asserted in a
 * comment beside the values. Reading the CSS rather than a TypeScript copy of
 * it is the point: a copy is a second source of truth that can agree with the
 * test and disagree with the app.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "styles/colourscales.css"), "utf8");

/**
 * OKLab's L for an sRGB colour — perceived lightness, 0 to 1.
 *
 * Written out rather than taken from a dependency because it is fifteen lines
 * and the alternative is a package whose whole job is this. The constants are
 * Björn Ottosson's published OKLab matrices; the `srgbToLinear` step is the
 * sRGB transfer function, and leaving it out (treating the byte as linear
 * light) is the classic mistake — it would make every dark colour test as far
 * lighter than it is, which would let exactly the fault above through.
 */
function lightness(hex: string): number {
  const toLinear = (byte: number) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(Number.parseInt(hex.slice(1, 3), 16));
  const g = toLinear(Number.parseInt(hex.slice(3, 5), 16));
  const b = toLinear(Number.parseInt(hex.slice(5, 7), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** Every `--<prefix>-<n>` hex in the stylesheet, in index order. */
function scale(prefix: string): string[] {
  const found = new Map<number, string>();
  for (const m of css.matchAll(new RegExp(`--${prefix}-(\\d+)\\s*:\\s*(#[0-9a-f]{6})\\s*;`, "gi"))) {
    found.set(Number(m[1]), (m[2] as string).toLowerCase());
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, hex]) => hex);
}

/** `--background`, so "is this visible on the page" is a real question. */
const PAGE_L = 0.145;

describe("the sequential ramp (--heat-*)", () => {
  const heat = scale("heat");

  it("has nine stops", () => {
    expect(heat).toHaveLength(9);
  });

  it("climbs in lightness at every single step", () => {
    /* The one property that makes a sequential ramp work, and the one `jet` and
       every other rainbow lacks. It is what lets the ramp survive greyscale
       printing and every common dichromacy for free, because both of those
       preserve lightness ordering and scramble hue. */
    const Ls = heat.map(lightness);
    for (let i = 1; i < Ls.length; i++) {
      expect(Ls[i]!, `--heat-${i} (${heat[i]}) is not lighter than --heat-${i - 1}`).toBeGreaterThan(
        Ls[i - 1]!,
      );
    }
  });

  it("climbs at a roughly even rate rather than bunching", () => {
    /* Monotonic is necessary and not sufficient: a ramp that spends six steps
       between L 0.9 and 0.95 and then jumps is still monotonic, and its top
       third is still six colours nobody can tell apart. That is the specific
       complaint against the naive blackbody `hot` ramp, which inferno exists to
       fix, so it is worth pinning that inferno has actually fixed it here. */
    const Ls = heat.map(lightness);
    const steps = Ls.slice(1).map((v, i) => v - Ls[i]!);
    const biggest = Math.max(...steps);
    const smallest = Math.min(...steps);
    expect(biggest / smallest).toBeLessThan(3);
  });

  it("spans nearly the whole lightness range", () => {
    expect(lightness(heat[0]!)).toBeLessThan(0.1);
    expect(lightness(heat[8]!)).toBeGreaterThan(0.9);
  });

  it("keeps the published dark end, and says which stops the page swallows", () => {
    /* Not a fault — it is the published ramp, kept whole so it can be sampled
       correctly if it is ever drawn on white. But it IS a trap, so the boundary
       is pinned rather than described.

       The numbers are worth stating because the first version of the stylesheet
       comment got them wrong in the safe direction. Exactly ONE stop is
       literally darker than `--page`: `--heat-0`, at L 0.048 against the page's
       0.145. `--heat-1` is above it — but by 0.07, which is close enough that
       it reads as a smudge rather than as a value, so the advice to start at
       `--heat-2` stands on legibility rather than on arithmetic. Two different
       claims, and only the first one is a fact about the page. */
    expect(lightness(heat[0]!)).toBeLessThan(PAGE_L);
    expect(lightness(heat[1]!)).toBeGreaterThan(PAGE_L);
    expect(lightness(heat[1]!) - PAGE_L).toBeLessThan(0.12);
    /* And the one the guidance names as the first usable stop really is clear
       of the page, so following the advice cannot land you in the same place. */
    expect(lightness(heat[2]!) - PAGE_L).toBeGreaterThan(0.15);
  });
});

describe.each([
  ["--div-*, blue to red", "div"],
  ["--div-rg-*, red to green", "div-rg"],
])("the diverging scale %s", (_name, prefix) => {
  const steps = scale(prefix);

  it("has nine stops with the pivot in the middle", () => {
    expect(steps).toHaveLength(9);
  });

  it("puts its quietest step in the middle, not at the ends", () => {
    /* **The one change from every published diverging scale**, and the reason
       none of them could be copied. RdBu, coolwarm, PiYG and the rest pivot on
       white because they were drawn for paper, where the neutral value should
       be the quietest thing on the page. On a near-black ground a white pivot
       makes the *middle* the loudest thing there — so a scale that means "this
       value is neither" would be shouting it. */
    const Ls = steps.map(lightness);
    const pivot = Ls[4]!;
    for (const [i, L] of Ls.entries()) {
      if (i === 4) continue;
      expect(L, `--${prefix}-${i} (${steps[i]}) is not lighter than the pivot`).toBeGreaterThan(
        pivot,
      );
    }
  });

  it("climbs strictly from the pivot to both ends", () => {
    /* The regression this file was written for. `--div-3` used to be darker
       than the pivot, so the blue arm dipped and came back — invisible in a
       list of hex codes, and exactly the fault that makes a rainbow ramp invent
       boundaries the data does not have. */
    const Ls = steps.map(lightness);
    for (let i = 0; i < 4; i++) {
      expect(Ls[i]!, `--${prefix}-${i} should be lighter than --${prefix}-${i + 1}`).toBeGreaterThan(
        Ls[i + 1]!,
      );
    }
    for (let i = 5; i < 9; i++) {
      expect(Ls[i]!, `--${prefix}-${i} should be lighter than --${prefix}-${i - 1}`).toBeGreaterThan(
        Ls[i - 1]!,
      );
    }
  });

  it("is symmetric in lightness about the pivot", () => {
    /* The property that makes Crameri's `vik` colour-blind-safe **by
       construction**, and the reason these are generated rather than
       transcribed: a dichromat who cannot separate the two hues can still read
       distance-from-neutral off the lightness, and only gets that if the two
       arms are mirror images. Orientation-free, so mirroring it about a dark
       pivot keeps it — which is the whole trick, since there is no canonical
       dark-ground diverging scale to copy. */
    const Ls = steps.map(lightness);
    for (let i = 0; i < 4; i++) {
      expect(Ls[i]!).toBeCloseTo(Ls[8 - i]!, 2);
    }
  });

  it("keeps even its pivot visible against the page", () => {
    /* A pivot that matched `--background` would make "neither" indistinguishable
       from "no data here at all", which are different claims. */
    expect(lightness(steps[4]!)).toBeGreaterThan(PAGE_L + 0.1);
  });
});

describe("the categorical palette (--cat-*)", () => {
  /* The slot-count and triplet-form checks live in tests/hit-colours.test.ts,
     beside the code that assigns the slots. What belongs here is the thing that
     is about the palette as a *palette* rather than about the indexing. */
  const rgbs = [...css.matchAll(/--cat-(\d+)-rgb\s*:\s*(\d+) (\d+) (\d+);/g)].map((m) => ({
    slot: Number(m[1]),
    hex: `#${[m[2], m[3], m[4]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`,
  }));

  it("has every hue comfortably visible on the page", () => {
    /* Three of Okabe–Ito's eight sit below L 0.65 and vanish into a near-black
       ground; they are lifted here, and this is the check that says so. A hue
       that fell back to its published value would still render — as a rule the
       reader cannot see, which is indistinguishable from a search that found
       nothing. */
    for (const { slot, hex } of rgbs) {
      expect(lightness(hex), `--cat-${slot}-rgb (${hex}) is too dark for the page`).toBeGreaterThan(
        0.55,
      );
    }
  });

  it("spreads its lightness rather than sitting at one level", () => {
    /* Okabe–Ito varies lightness as well as hue precisely so a dichromat has a
       second channel to read. A palette generated by rotating hue at a fixed
       lightness — which is what most "give me N distinct colours" recipes do —
       collapses to N identical greys for somebody who cannot see the hue
       difference. This is the check that we have not accidentally done that. */
    const Ls = rgbs.map((r) => lightness(r.hex));
    expect(Math.max(...Ls) - Math.min(...Ls)).toBeGreaterThan(0.15);
  });
});
