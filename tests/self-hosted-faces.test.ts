/**
 * **Every face token names a family that a self-hosted file declares.**
 * docs/project/fonts.md; src/web/tailwind.css; styles/tokens.css.
 *
 * A token's first family is matched against the `@font-face` rules of the
 * Fontsource packages tailwind.css imports. Misspell it, or swap the package
 * without the token, and the browser silently falls through to the next family
 * in the stack — Courier New for the model's words — which looks close enough
 * to pass a screenshot. Nothing on screen says so, and the computed style still
 * names the family you meant. Written when the model's face became iA Writer
 * Quattro (261021f).
 *
 * The model's and reader's faces also need all the styles they are drawn in: a missing
 * italic or 700 is synthesised by the browser, which on these faces looks like
 * a bug, not a choice.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ENTRY = "src/web/tailwind.css";
const TOKENS = readFileSync("styles/tokens.css", "utf8");

type Face = { family: string; style: string; weight: string };

/** Every `@font-face` declared by the packages `tailwind.css` imports. */
function declaredFaces(entryCss: string): Face[] {
  const code = entryCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = [...code.matchAll(/@import\s+"(@fontsource[^"]+)"/g)].map((m) => m[1]!);
  const faces: Face[] = [];
  for (const id of imports) {
    const css = readFileSync(resolve("node_modules", id), "utf8");
    for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      const prop = (name: string) =>
        block[1]!.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
      faces.push({
        family: prop("font-family").replace(/^['"]|['"]$/g, ""),
        style: prop("font-style"),
        weight: prop("font-weight"),
      });
    }
  }
  return faces;
}

/** The first family a token in tokens.css names. */
function primaryFamily(css: string, token: string): string {
  const value = css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];
  if (!value) throw new Error(`tokens.css defines no ${token}`);
  return value.split(",")[0]!.trim().replace(/^['"]|['"]$/g, "");
}

/** Weights a face covers: "400", or a variable range like "200 900". */
function covers(face: Face, weight: number): boolean {
  const [lo, hi = lo] = face.weight.split(/\s+/).map(Number);
  return lo !== undefined && hi !== undefined && weight >= lo && weight <= hi;
}

const FACES = declaredFaces(readFileSync(ENTRY, "utf8"));

describe("self-hosted faces", () => {
  it("finds the packages' @font-face rules at all", () => {
    expect(FACES.length).toBeGreaterThan(10);
  });

  it.each([
    "--font-ui",
    "--font-mono",
    "--font-author",
    "--font-ai",
    "--font-reader",
  ])("%s names a family an imported file declares", (token) => {
    const family = primaryFamily(TOKENS, token);
    expect(FACES.map((f) => f.family)).toContain(family);
  });

  it.each([
    ["--font-ai", ["normal", "italic"], [400, 700]],
    ["--font-reader", ["normal", "italic"], [400, 500, 600, 700]],
  ] as const)("%s has every style it is drawn in", (token, styles, weights) => {
    const family = primaryFamily(TOKENS, token);
    for (const style of styles) {
      for (const weight of weights) {
        const found = FACES.some(
          (f) => f.family === family && f.style === style && covers(f, weight),
        );
        expect(found, `${family} ${style} ${weight}`).toBe(true);
      }
    }
  });

  it.each([
    ["--font-ai", "iA Writer Quattro", "iA Writer Quatro"],
    ["--font-reader", "Shantell Sans Variable", "Shantell Sans"],
  ])("would catch a wrong family for %s", (token, family, wrong) => {
    const misspelt = TOKENS.replace(`'${family}'`, `'${wrong}'`);
    expect(misspelt).not.toBe(TOKENS);
    expect(FACES.map((f) => f.family)).not.toContain(primaryFamily(misspelt, token));
  });
});
