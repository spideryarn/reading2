/**
 * **Sketch's labels are measured in the face they are drawn in.**
 *
 * The labels are wrapped by counting characters at `CHAR_W` em each
 * (src/sketch-scene.ts § type scale), on the server as well as in the browser,
 * so the width per character is a number in the source rather than something
 * read off the page. This holds each face's number to the face itself: it
 * measures the self-hosted woff2 the app actually serves, and fails if a table
 * entry is too large as well as too small, or if the file it measured is not
 * the face styles/tokens.css names for that voice. And it checks the literal
 * stacks the offline exporter writes are the tokens, so the two cannot drift.
 *
 * docs/plans/261025k-fonts-and-css-code-quality.md § 3; docs/project/fonts.md
 * § How to put an element in its voice, point 4.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  CHAR_W,
  CHAR_W_BY_VOICE,
  CHAR_W_MARGIN,
  FONT_STACK_BY_VOICE,
  SKETCH_LABEL_VOICE,
  type SketchLabelVoice,
} from "../src/sketch-scene.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** How far an entry may sit from measured × margin, in em. A stale or guessed number is further out. */
const TOLERANCE = 0.01;

/**
 * The weights the SVG draws labels at (src/web/styles/diagram-sketch.css: the
 * default 400, `.sk-region-label` 500, `.sk-label-lg` 600), and the file the
 * browser would pick for each. Geist is variable, so each is its own instance;
 * Quattro ships 400 and 700 only, and CSS font matching takes 400 for 500 and
 * 700 for 600.
 */
const WEIGHTS = [400, 500, 600] as const;

interface Face {
  /** The stylesheets src/web/tailwind.css imports to declare the face. */
  css: string[];
  /** For each drawn weight: the woff2 the browser would use, and the variable-axis weight (null for a static file). */
  files: Record<(typeof WEIGHTS)[number], { file: string; wght: number | null }>;
  /** The token in styles/tokens.css whose first family this face must be. */
  token: string;
}

const GEIST = "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2";
const QUATTRO_400 = "@fontsource/ia-writer-quattro/files/ia-writer-quattro-latin-400-normal.woff2";
const QUATTRO_700 = "@fontsource/ia-writer-quattro/files/ia-writer-quattro-latin-700-normal.woff2";

const FACES: Record<SketchLabelVoice, Face> = {
  ui: {
    css: ["@fontsource-variable/geist/wght.css"],
    files: {
      400: { file: GEIST, wght: 400 },
      500: { file: GEIST, wght: 500 },
      600: { file: GEIST, wght: 600 },
    },
    token: "--font-ui",
  },
  ai: {
    css: ["@fontsource/ia-writer-quattro/400.css", "@fontsource/ia-writer-quattro/700.css"],
    files: {
      400: { file: QUATTRO_400, wght: null },
      500: { file: QUATTRO_400, wght: null },
      600: { file: QUATTRO_700, wght: null },
    },
    token: "--font-ai",
  },
};

/**
 * Label-like English: mostly sentence case, with capitals and digits, and an
 * uppercase run because `.sk-label-xs` labels are drawn uppercase.
 */
const SAMPLE =
  "Readers skim 40% faster when the headings carry the argument. " +
  "Working memory holds about 4 items; Chapter 3 tests the Spacing Effect. " +
  "Retrieval practice beats rereading (Roediger, 2006). KEY CLAIM FIG 2 EVIDENCE";

/** A token's value with every `var(--x)` resolved, from styles/tokens.css. */
function token(name: string): string {
  const css = read("styles/tokens.css");
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m?.[1]) throw new Error(`${name} is not in styles/tokens.css`);
  return m[1].trim().replace(/var\((--[\w-]+)\)/g, (_, inner: string) => token(inner));
}

const firstFamily = (stack: string) => (stack.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");

/** The average em per character of `SAMPLE` in `voice`'s face, averaged over the drawn weights. */
function measured(voice: SketchLabelVoice): number {
  const ctx = createCanvas(10, 10).getContext("2d");
  let sum = 0;
  for (const w of WEIGHTS) {
    const { file, wght } = FACES[voice].files[w];
    const family = `measure-${voice}-${w}`;
    GlobalFonts.registerFromPath(path.join(ROOT, "node_modules", file), family);
    ctx.font = `100px "${family}"`;
    ctx.fontVariationSettings = wght === null ? "normal" : `"wght" ${wght}`;
    sum += ctx.measureText(SAMPLE).width / 100 / SAMPLE.length;
  }
  return sum / WEIGHTS.length;
}

const VOICES = Object.keys(CHAR_W_BY_VOICE) as SketchLabelVoice[];

describe("Sketch's label width is the face it is drawn in", () => {
  it("CHAR_W is the drawn voice's entry, and ui is the 0.53 that has always wrapped the labels", () => {
    expect(CHAR_W).toBe(CHAR_W_BY_VOICE[SKETCH_LABEL_VOICE]);
    expect(CHAR_W_BY_VOICE.ui).toBe(0.53);
  });

  for (const voice of VOICES) {
    it(`${voice}: the entry is the measured width times CHAR_W_MARGIN`, () => {
      const m = measured(voice);
      const want = m * CHAR_W_MARGIN;
      expect(
        Math.abs(CHAR_W_BY_VOICE[voice] - want),
        `${voice} measures ${m.toFixed(4)} em a character, so with the margin ${CHAR_W_MARGIN} its entry should be ` +
          `${want.toFixed(3)}, not ${CHAR_W_BY_VOICE[voice]}`,
      ).toBeLessThanOrEqual(TOLERANCE);
    });

    it(`${voice}: the file measured is the face ${FACES[voice].token} names, as the app declares it`, () => {
      const face = FACES[voice];
      const family = firstFamily(token(face.token));
      const app = read("src/web/tailwind.css");
      for (const css of face.css) expect(app, `the app does not import ${css}`).toContain(`@import "${css}";`);
      const rules = face.css.flatMap((css) =>
        readFileSync(path.join(ROOT, "node_modules", css), "utf8").split("@font-face"),
      );
      for (const { file } of Object.values(face.files)) {
        const declared = rules.some(
          (rule) => rule.includes(`font-family: '${family}'`) && rule.includes(`/${path.basename(file)})`),
        );
        expect(declared, `${file} is not an @font-face of '${family}' in ${face.css.join(", ")}`).toBe(true);
      }
    });

    it(`${voice}: the exporter's literal stack is ${FACES[voice].token}`, () => {
      expect(FONT_STACK_BY_VOICE[voice]).toBe(token(FACES[voice].token));
    });
  }
});
