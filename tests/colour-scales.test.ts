/**
 * The colour scales — `styles/colourscales.css`, documented in
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
 *
 * **Two palettes, since 2026-10-03.** The stylesheet holds a dark `:root` block
 * and a `:root[data-theme="light"]` block with the same names. Every property
 * below is measured in each block separately, against *that* block's page —
 * reading the file as one list would either count every token twice or let
 * the light value silently replace the dark one, and then assert dark-ground
 * rules of a colour drawn for paper. The shape of "right" is the same in both
 * themes and only the direction differs: quiet is near the page, loud is far
 * from it, so most checks below are written as *distance from the page*.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HUE_STOPS } from "../src/web/topic-colour.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(path.join(root, "styles/colourscales.css"), "utf8");
const tokenCss = readFileSync(path.join(root, "styles/tokens.css"), "utf8");

type Theme = "dark" | "light";
const THEMES: readonly Theme[] = ["dark", "light"];

/** The selector each palette is declared under, at the top level of the file. */
const SELECTOR: Record<Theme, string> = {
  dark: ":root",
  light: ':root[data-theme="light"]',
};

/** Every top-level `<selector> { … }` body in the file with exactly this selector. */
function blocksFor(selector: string, source = css): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`^${escaped}\\s*\\{([\\s\\S]*?)^\\}`, "gm"))].map(
    (m) => m[1] ?? "",
  );
}

/** The real page token in each theme, as OKLab L. */
const PAGE_L = Object.fromEntries(
  THEMES.map((theme) => {
    const body = blocksFor(SELECTOR[theme], tokenCss)[0] ?? "";
    const match = /--background\s*:\s*oklch\(\s*([\d.]+)\s+0\s+0\s*\)/.exec(body);
    if (!match?.[1]) throw new Error(`no neutral --background in the ${theme} token block`);
    return [theme, Number(match[1])];
  }),
) as Record<Theme, number>;

const BLOCK: Record<Theme, string> = {
  dark: blocksFor(SELECTOR.dark)[0] ?? "",
  light: blocksFor(SELECTOR.light)[0] ?? "",
};

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
  return oklab(hex)[0];
}

function toLinear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function channels(hex: string): [number, number, number] {
  return [
    toLinear(Number.parseInt(hex.slice(1, 3), 16)),
    toLinear(Number.parseInt(hex.slice(3, 5), 16)),
    toLinear(Number.parseInt(hex.slice(5, 7), 16)),
  ];
}

function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab's a and b as chroma and hue angle in degrees. */
function chromaHue(hex: string): { c: number; h: number } {
  const [, A, B] = oklab(hex);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

/** Euclidean distance in OKLab — "how different do these two look". */
function separation(a: string, b: string): number {
  const [la, aa, ba] = oklab(a);
  const [lb, ab, bb] = oklab(b);
  return Math.hypot(la - lb, aa - ab, ba - bb);
}

/**
 * WCAG 2 contrast ratio of a colour against the theme's page. The page is a
 * neutral, and for a neutral OKLab L is exactly the cube root of relative
 * luminance (the matrices' rows sum to one), so its Y is L³ — no hex needed.
 */
function contrastOnPage(hex: string, theme: Theme): number {
  const [r, g, b] = channels(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const page = PAGE_L[theme] ** 3;
  return (Math.max(y, page) + 0.05) / (Math.min(y, page) + 0.05);
}

/** How far a colour sits from the theme's page, in OKLab L. */
function fromPage(hex: string, theme: Theme): number {
  return Math.abs(lightness(hex) - PAGE_L[theme]);
}

const toHex = (r: string, g: string, b: string) =>
  `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * Every `--<prefix>-<n>-rgb` triple in one block, as hex, in index order.
 *
 * The diverging ramps, `--vir-*`, `--cat-*` and `--hue-*` are written as
 * triples rather than hex, because a component sets a custom property to one
 * of them inline and the stylesheet interpolates it into `rgb(…)` —
 * `annotate.ts` does that with `--h0` … `--h5` when a for/against criterion
 * paints its marks by direction. Their plain spellings are *derived* from
 * these, so reading the triple reads the one value there is; reading the hex
 * would read a `rgb(var(…))` expression and prove nothing about the colour.
 */
function triples(theme: Theme, prefix: string): string[] {
  return indexed(
    [...BLOCK[theme].matchAll(new RegExp(`--${prefix}-(\\d+)-rgb\\s*:\\s*(\\d+) (\\d+) (\\d+);`, "g"))].map(
      (m) => [Number(m[1]), toHex(m[2] ?? "", m[3] ?? "", m[4] ?? "")] as const,
    ),
  );
}

/** Every `--<prefix>-<n>` hex in one block, in index order. */
function scale(theme: Theme, prefix: string): string[] {
  return indexed(
    [...BLOCK[theme].matchAll(new RegExp(`--${prefix}-(\\d+)\\s*:\\s*(#[0-9a-f]{6})\\s*;`, "gi"))].map(
      (m) => [Number(m[1]), (m[2] ?? "").toLowerCase()] as const,
    ),
  );
}

/** Sort by index. Duplicates are kept, so a second declaration shows up as a wrong length. */
function indexed(entries: (readonly [number, string])[]): string[] {
  return [...entries].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** The scale families, each as the regex that finds one declaration's name. */
const FAMILIES = {
  "--cat-N-rgb": /--cat-\d+-rgb(?=\s*:)/g,
  "--heat-N": /--heat-\d+(?=\s*:)/g,
  "--vir-N-rgb": /--vir-\d+-rgb(?=\s*:)/g,
  "--div-N-rgb": /--div-\d+-rgb(?=\s*:)/g,
  "--div-rg-N-rgb": /--div-rg-\d+-rgb(?=\s*:)/g,
  "--hue-N-rgb": /--hue-\d+-rgb(?=\s*:)/g,
} as const;

function names(text: string, family: RegExp): string[] {
  return [...text.matchAll(family)].map((m) => m[0]);
}

describe("the two palettes", () => {
  it("are one dark block and one light block, and nothing else declares a scale", () => {
    /* A third block — a media query, a second `:root` — would be a palette
       none of the measurements below can see. So every scale declaration in
       the file has to be inside one of the two blocks they read. */
    expect(blocksFor(SELECTOR.dark)).toHaveLength(1);
    expect(blocksFor(SELECTOR.light)).toHaveLength(1);
    for (const [family, re] of Object.entries(FAMILIES)) {
      expect(
        names(BLOCK.dark, re).length + names(BLOCK.light, re).length,
        `a ${family} declaration outside the two blocks`,
      ).toBe(names(css, re).length);
    }
  });

  it.each(Object.entries(FAMILIES))(
    "declare the same %s names, each exactly once per block",
    (_family, re) => {
      /* The light block is the dark one redefined, so a name only in one of
         them is a colour that does not change with the theme, and a name twice
         in one block is two values of which only the last counts. */
      const dark = names(BLOCK.dark, re);
      const light = names(BLOCK.light, re);
      expect(new Set(dark).size, "a name declared twice in the dark block").toBe(dark.length);
      expect(new Set(light).size, "a name declared twice in the light block").toBe(light.length);
      expect([...light].sort()).toEqual([...dark].sort());
    },
  );

  it("redefines only the triplets in light, never the aliases derived from them", () => {
    /* `--cat-3: rgb(var(--cat-3-rgb))` in the dark block already follows the
       light triplet. A copy of it here would be harmless today and the first
       thing to drift the day somebody writes a hex into one of them. */
    expect(BLOCK.light).not.toMatch(/rgb\(var\(/);
  });
});

describe.each(THEMES)("the sequential ramp (--heat-*), %s", (theme) => {
  const heat = scale(theme, "heat");
  /* The direction a sequential ramp has to move in: up on the dark page, down
     on the light one. Signed rather than a distance from the page, because
     inferno's published first stop is *below* the dark page — on the far side
     of it — and a distance would read that as a step backwards. */
  const away = (hex: string) => (theme === "dark" ? lightness(hex) : -lightness(hex));

  it("has nine stops", () => {
    expect(heat).toHaveLength(9);
  });

  it("moves away from the page at every single step", () => {
    /* The one property that makes a sequential ramp work, and the one `jet` and
       every other rainbow lacks. It is what lets the ramp survive greyscale
       printing and every common dichromacy for free, because both of those
       preserve lightness ordering and scramble hue. In light this is the
       reason the stops run the other way up: the quiet end is the end nearest
       the page, and on paper that is the pale one. */
    for (let i = 1; i < heat.length; i++) {
      expect(away(heat[i]!), `--heat-${i} (${heat[i]}) is not further from the page than --heat-${i - 1}`)
        .toBeGreaterThan(away(heat[i - 1]!));
    }
  });

  it("moves at a roughly even rate rather than bunching", () => {
    /* Monotonic is necessary and not sufficient: a ramp that spends six steps
       between L 0.9 and 0.95 and then jumps is still monotonic, and its top
       third is still six colours nobody can tell apart. That is the specific
       complaint against the naive blackbody `hot` ramp, which inferno exists to
       fix, so it is worth pinning that inferno has actually fixed it here. */
    const Ls = heat.map(lightness);
    const steps = Ls.slice(1).map((v, i) => Math.abs(v - Ls[i]!));
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(3);
  });

  it("spans nearly the whole lightness range", () => {
    const ends = [lightness(heat[0]!), lightness(heat[8]!)].sort((a, b) => a - b);
    expect(ends[0]!).toBeLessThan(0.1);
    expect(ends[1]!).toBeGreaterThan(0.9);
  });

  it("starting at --heat-2, as the stylesheet advises, is clear of the page", () => {
    /* The guidance names one first usable stop for both themes, so following
       the advice cannot land you on the page in either. */
    expect(fromPage(heat[2]!, theme)).toBeGreaterThan(0.15);
  });
});

describe("the heat ramp's ends, theme by theme", () => {
  it("keeps the published dark end on dark, and says which stops the page swallows", () => {
    /* Not a fault — it is the published ramp, kept whole so it can be sampled
       correctly when it is drawn on white. But it IS a trap, so the boundary
       is pinned rather than described.

       The numbers are worth stating because the first version of the stylesheet
       comment got them wrong in the safe direction. Exactly ONE stop is
       literally darker than `--page`: `--heat-0`, at L 0.048 against the page's
       0.145. `--heat-1` is above it — but by 0.07, which is close enough that
       it reads as a smudge rather than as a value, so the advice to start at
       `--heat-2` stands on legibility rather than on arithmetic. Two different
       claims, and only the first one is a fact about the page. */
    const heat = scale("dark", "heat");
    expect(lightness(heat[0]!)).toBeLessThan(PAGE_L.dark);
    expect(lightness(heat[1]!)).toBeGreaterThan(PAGE_L.dark);
    expect(lightness(heat[1]!) - PAGE_L.dark).toBeLessThan(0.12);
  });

  it("is the same nine published stops on light, in the other order", () => {
    /* matplotlib's own `inferno_r` — not a new ramp, and this is what stops it
       quietly becoming one. Its pale end is the page here: `--heat-0` is a
       hole on paper the way it is on the dark page, which is why the advice to
       start at step 2 holds in both. */
    const dark = scale("dark", "heat");
    const light = scale("light", "heat");
    expect(light).toEqual([...dark].reverse());
    expect(fromPage(light[0]!, "light")).toBeLessThan(0.02);
    expect(fromPage(light[1]!, "light")).toBeGreaterThan(0.12);
  });
});

/* The pivot's distance from the page. Lower on light because the arms need the
   room: the page is at 0.985 and a darkest end much below 0.42 stops reading as
   a hue. */
const PIVOT_CLEARANCE: Record<Theme, number> = { dark: 0.1, light: 0.08 };

describe.each(
  THEMES.flatMap((theme) => [
    [`--div-*, blue to red, ${theme}`, "div", theme],
    [`--div-rg-*, red to green, ${theme}`, "div-rg", theme],
  ] as const),
)("the diverging scale %s", (_name, prefix, theme) => {
  const steps = triples(theme, prefix);
  const away = (hex: string) => fromPage(hex, theme);

  it("has nine stops with the pivot in the middle", () => {
    expect(steps).toHaveLength(9);
  });

  it("spells every stop as a plain colour too, derived rather than typed twice", () => {
    /* Both spellings are real customers — the triple is what `annotate.ts`
       interpolates into `rgb(var(--h0))` for a mark, the plain colour is what
       `valenceToken` hands a panel swatch as a `background`. What must never
       happen is nine colours written out twice and kept in step by hand, which
       is the failure this file exists for one level up. So the plain form is
       generated from the triple in the stylesheet itself — once, in the dark
       block, which the light triplets then flow through. */
    for (let i = 0; i < 9; i++) {
      expect(BLOCK.dark, `--${prefix}-${i} is not derived from --${prefix}-${i}-rgb`).toContain(
        `--${prefix}-${i}: rgb(var(--${prefix}-${i}-rgb));`,
      );
    }
  });

  it("puts its quietest step in the middle, nearest the page, not at the ends", () => {
    /* **The one change from every published diverging scale on dark**, and the
       reason none of them could be copied there. RdBu, coolwarm, PiYG and the
       rest pivot on white because they were drawn for paper, where the neutral
       value should be the quietest thing on the page. On a near-black ground a
       white pivot makes the *middle* the loudest thing there — so a scale that
       means "this value is neither" would be shouting it. On light the
       published shape is right again, and the same check says so. */
    const pivot = away(steps[4]!);
    for (const [i, hex] of steps.entries()) {
      if (i === 4) continue;
      expect(away(hex), `--${prefix}-${i} (${hex}) is not further from the page than the pivot`)
        .toBeGreaterThan(pivot);
    }
  });

  it("moves strictly away from the page from the pivot to both ends", () => {
    /* The regression this file was written for. `--div-3` used to be darker
       than the pivot, so the blue arm dipped and came back — invisible in a
       list of hex codes, and exactly the fault that makes a rainbow ramp invent
       boundaries the data does not have. */
    for (let i = 0; i < 4; i++) {
      expect(away(steps[i]!), `--${prefix}-${i} should be further out than --${prefix}-${i + 1}`)
        .toBeGreaterThan(away(steps[i + 1]!));
    }
    for (let i = 5; i < 9; i++) {
      expect(away(steps[i]!), `--${prefix}-${i} should be further out than --${prefix}-${i - 1}`)
        .toBeGreaterThan(away(steps[i - 1]!));
    }
  });

  it("is symmetric in lightness about the pivot", () => {
    /* The property that makes Crameri's `vik` colour-blind-safe **by
       construction**, and the reason these are generated rather than
       transcribed: a dichromat who cannot separate the two hues can still read
       distance-from-neutral off the lightness, and only gets that if the two
       arms are mirror images. Orientation-free, so it holds about a dark pivot
       and a light one alike. */
    const Ls = steps.map(lightness);
    for (let i = 0; i < 4; i++) {
      expect(Ls[i]!).toBeCloseTo(Ls[8 - i]!, 2);
    }
  });

  it("keeps even its pivot visible against the page", () => {
    /* A pivot that matched `--background` would make "neither" indistinguishable
       from "no data here at all", which are different claims. */
    expect(away(steps[4]!)).toBeGreaterThan(PIVOT_CLEARANCE[theme]);
  });
});

describe.each(THEMES)("the lean words Debate paints in --div-rg-1 and --div-rg-7, %s", (theme) => {
  /* reception.css § `.rcp-lean-for` / `-against` use two diverging steps as the
     colour of a *word*, so for those two the bar is WCAG's 4.5:1 for text
     rather than "visible". A scale retuned for swatches could drop below it
     without any swatch looking wrong. */
  const rg = triples(theme, "div-rg");
  it.each([1, 7])("--div-rg-%i is readable as text on the page", (i) => {
    expect(contrastOnPage(rg[i]!, theme)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(THEMES)("the other sequential ramp (--vir-*), for quantities with no heat in them, %s", (theme) => {
  /* Written as `-rgb` triplets rather than hex, like the categorical set and
     unlike `--heat-*`, because a component sets `--cat-rgb` to one of these
     inline and the stylesheet paints it at an alpha (DiagramPanel.tsx §
     rampStyle). */
  const vir = triples(theme, "vir");
  const away = (hex: string) => fromPage(hex, theme);

  it("has nine stops", () => {
    expect(vir).toHaveLength(9);
  });

  it("moves away from the page at every single step", () => {
    /* The one property that makes a sequential ramp work at all, and the reason
       this is viridis rather than a hue rotation: lightness is the channel
       greyscale and every dichromacy preserve, so a ramp that is monotonic in
       it survives all of them without any of them being thought about. */
    for (let i = 1; i < vir.length; i++) {
      expect(away(vir[i]!), `--vir-${i} (${vir[i]}) is not further from the page than --vir-${i - 1}`)
        .toBeGreaterThan(away(vir[i - 1]!));
    }
  });

  it("moves at a roughly even rate rather than bunching", () => {
    const Ls = vir.map(lightness);
    const steps = Ls.slice(1).map((v, i) => Math.abs(v - Ls[i]!));
    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(3);
  });

  it("has NO stop the page swallows, unlike the heat ramp", () => {
    /* This is the reason it can be used without the "start at step 2" caveat
       that `--heat-*` carries — and that caveat is exactly the kind of thing
       that gets forgotten, so the difference is pinned rather than described.
       Every stop is clear of `--page`, so the first paragraph's dot is drawn
       as a value rather than as a hole. On light this is why the ramp stops
       short of its published yellow, which is 1.2:1 on paper. */
    for (const [i, hex] of vir.entries()) {
      expect(away(hex), `--vir-${i} (${hex}) is not clear of the page`).toBeGreaterThan(0.1);
    }
  });
});

/* The bars each palette is held to. The lightness spread is narrower on light
   because 3:1 against near-white caps how light any hue can be; the stylesheet
   says what that costs. */
const CAT_SPREAD: Record<Theme, number> = { dark: 0.15, light: 0.12 };

describe.each(THEMES)("the categorical palette (--cat-*), %s", (theme) => {
  /* The slot-count and triplet-form checks live in tests/hit-colours.test.ts,
     beside the code that assigns the slots. What belongs here is the thing that
     is about the palette as a *palette* rather than about the indexing. */
  const cats = triples(theme, "cat");

  it("has every hue at 3:1 or better against the page", () => {
    /* Three of Okabe–Ito's eight sit below L 0.65 and vanish into a near-black
       ground, and four of them are under 3:1 on near-white; each block lifts or
       darkens the ones its page needs, and this is the check that says so. A
       hue that fell back to a value its page swallows would still render — as
       a rule the reader cannot see, which is indistinguishable from a search
       that found nothing. 3:1 is WCAG's floor for a mark that is not text. */
    for (const [slot, hex] of cats.entries()) {
      expect(contrastOnPage(hex, theme), `--cat-${slot}-rgb (${hex}) is too faint on the ${theme} page`)
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("spreads its lightness rather than sitting at one level", () => {
    /* Okabe–Ito varies lightness as well as hue precisely so a dichromat has a
       second channel to read. A palette generated by rotating hue at a fixed
       lightness — which is what most "give me N distinct colours" recipes do —
       collapses to N identical greys for somebody who cannot see the hue
       difference. This is the check that we have not accidentally done that. */
    const Ls = cats.map(lightness);
    expect(Math.max(...Ls) - Math.min(...Ls)).toBeGreaterThan(CAT_SPREAD[theme]);
  });

  it("keeps every pair of the sixteen visibly apart", () => {
    /* 0.059 in OKLab on dark and 0.057 on light, measured when the light block
       was written; the stylesheet's comments quote both. A retune that put two
       slots on top of each other would still be sixteen valid colours. */
    let closest = Number.POSITIVE_INFINITY;
    let pair = "";
    for (let a = 0; a < cats.length; a++) {
      for (let b = a + 1; b < cats.length; b++) {
        const d = separation(cats[a]!, cats[b]!);
        if (d < closest) [closest, pair] = [d, `--cat-${a} and --cat-${b}`];
      }
    }
    expect(closest, pair).toBeGreaterThan(0.05);
  });
});

describe("the categorical palette's light block, against its published source", () => {
  it("keeps every Okabe–Ito original that already reaches 3:1 on paper, unchanged", () => {
    /* The light block's one rule is "the published colour wherever it works".
       These three work, so a retune that drifted them would be departing from
       the source for nothing. */
    const cats = triples("light", "cat");
    expect(cats[1]).toBe("#d55e00");
    expect(cats[2]).toBe("#009e73");
    expect(cats[4]).toBe("#0072b2");
  });
});

/* The ring's one lightness in each theme — `scripts/generate-hue-ring.ts`'s `L`. */
const RING_L: Record<Theme, number> = { dark: 0.76, light: 0.62 };
/* The faintest chroma the generator lands on: sRGB holds less teal at L 0.62. */
const RING_MIN_CHROMA: Record<Theme, number> = { dark: 0.11, light: 0.1 };

describe.each(THEMES)("the hue ring (--hue-*), for topics that are near each other, %s", (theme) => {
  /* The ring is produced by scripts/generate-hue-ring.ts, and its whole content
     is two relationships: one lightness, and hue climbing evenly from red to
     violet without wrapping. A hand edit that breaks either still renders fine,
     so both are measured here. */
  const ring = triples(theme, "hue");

  it("has one stop per HUE_STOPS, each also spelled as a colour", () => {
    expect(ring).toHaveLength(HUE_STOPS);
    for (let i = 0; i < HUE_STOPS; i++) {
      expect(BLOCK.dark, `--hue-${i}`).toContain(`--hue-${i}: rgb(var(--hue-${i}-rgb));`);
    }
  });

  it("sits at one lightness", () => {
    const Ls = ring.map(lightness);
    expect(Math.max(...Ls) - Math.min(...Ls)).toBeLessThan(0.01);
    for (const [i, L] of Ls.entries()) {
      expect(Math.abs(L - RING_L[theme]), `--hue-${i} lightness`).toBeLessThan(0.005);
    }
  });

  it("is 3:1 or better against the page at every stop", () => {
    /* A topic's dot is a few pixels wide and carries no text, so this is the
       non-text floor. At the dark ring's lightness the light page gets about
       2:1, which is why the light ring is darker. */
    for (const [i, hex] of ring.entries()) {
      expect(contrastOnPage(hex, theme), `--hue-${i} (${hex})`).toBeGreaterThanOrEqual(3);
    }
  });

  it("is vivid at every stop without exceeding the generator's chroma cap", () => {
    for (const [i, hex] of ring.entries()) {
      expect(chromaHue(hex).c, `--hue-${i} (${hex})`).toBeGreaterThan(RING_MIN_CHROMA[theme]);
      // Encoding to integer sRGB can lift the measured value just above 0.16.
      expect(chromaHue(hex).c, `--hue-${i} (${hex})`).toBeLessThan(0.162);
    }
  });

  it("runs in even hue steps from 25° to 290°", () => {
    const hs = ring.map((hex) => chromaHue(hex).h);
    expect(Math.abs(hs[0]! - 25)).toBeLessThan(1);
    expect(Math.abs(hs[hs.length - 1]! - 290)).toBeLessThan(1);
    const expectedStep = (290 - 25) / (HUE_STOPS - 1);
    for (let i = 1; i < hs.length; i++) {
      const step = hs[i]! - hs[i - 1]!;
      expect(Math.abs(step - expectedStep), `--hue-${i} step`).toBeLessThan(1);
    }
  });
});
