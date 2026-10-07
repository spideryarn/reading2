/**
 * **Every elevation shadow softens on the light page.**
 *
 * Black at a dark-tuned alpha reads far heavier on white than on the dark
 * page, so plan 261007h § F6 gave the light theme lighter shadows through
 * three tokens (`--shadow-pop`, `--shadow-dialog`, `--shadow-sheet`). Six
 * elevation shadows with silhouettes of their own kept black literals and
 * stayed heavy in light (queue item qi-a5gzv44d). Plan 261007m S4 wrote their
 * alphas against `--shadow-strength` (1 dark, lighter in light), so this scan
 * holds the rule for the next one: an outer black shadow in a stylesheet goes
 * through a token or the factor.
 *
 * Inset shadows are left: they are marks drawn inside a box (a hit's edge, a
 * tab's top line), not elevation, and are tuned per theme where they matter.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WEB = join(ROOT, "src", "web");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

/** Split a `box-shadow` value into its layers, at commas outside brackets. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  out.push(value.slice(start));
  return out.map((l) => l.trim());
}

const BLACK = /\b(?:rgba?|oklch|hsla?)\(\s*0[\s,]+0%?[\s,]+0%?|#000(?:0{3})?\b|\bblack\b/;

/** Each outer black layer that neither a token nor the factor carries. */
function heavyLiterals(): string[] {
  const found: string[] = [];
  for (const file of cssFiles(WEB)) {
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
    for (const m of css.matchAll(/(?<![-\w])box-shadow\s*:([^;}]*)/g)) {
      const value = m[1] ?? "";
      if (/var\(--shadow-(?:pop|dialog|sheet)\)/.test(value)) continue;
      for (const layer of layers(value)) {
        if (/\binset\b/.test(layer) || !BLACK.test(layer)) continue;
        if (layer.includes("var(--shadow-strength)")) continue;
        const line = css.slice(0, m.index).split("\n").length;
        found.push(`${relative(ROOT, file)}:${line}  ${layer}`);
      }
    }
  }
  return found;
}

describe("elevation shadows", () => {
  it("draw every outer black shadow through a shadow token or --shadow-strength", () => {
    expect(heavyLiterals()).toEqual([]);
  });

  it("define --shadow-strength in the dark block at 1 and lighter in the light block", () => {
    const tokens = readFileSync(join(WEB, "styles", "tokens.css"), "utf8");
    const values = [...tokens.matchAll(/--shadow-strength:\s*([\d.]+)\s*;/g)].map((m) => Number(m[1]));
    /* Dark first, pixel-identical to the old literals; light second, and less. */
    expect(values).toHaveLength(2);
    expect(values[0]).toBe(1);
    expect(values[1]).toBeGreaterThan(0);
    expect(values[1]).toBeLessThan(1);
  });
});
