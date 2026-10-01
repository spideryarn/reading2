/**
 * **The per-voice faces stay behind their switch, and every element they name
 * still exists.** src/web/styles/voices.css; docs/plans/261001d-typeface-per-voice.md.
 *
 * Two ways that file can go wrong with nothing on screen to say so:
 *
 *  1. **A rule without the `:root[data-voices]` guard** restyles every reader,
 *     switch or no switch — Courier summaries for the people who did not ask
 *     for experiments.
 *  2. **A class it names is renamed in a component.** The selector then matches
 *     nothing, that element quietly drops back to Geist, and the v1 Greg is
 *     judging is a smaller v1 than the one he was told about.
 *
 * A hand scan rather than a CSS parser, as in styles-entry-is-imports-only:
 * the file is three lists of selectors and a parser to check that is the wrong
 * trade.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync("src/web/styles/voices.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule's selector text, one string per rule. */
const selectors = [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.trim());

/** Every `.class` the file names. */
const classes = [...new Set([...CSS.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!))];

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(p);
    return /\.tsx?$/.test(e.name) ? [readFileSync(p, "utf8")] : [];
  });
}
const SOURCE = sourcesUnder("src/web").join("\n");

/**
 * Classes a component builds from a template rather than writing out:
 * `prose-card-part-${section.key}` in ProseHoverCard's TermCard, whose keys are
 * the glossary's two sections (`GlossaryPanel.tsx`, `key: "senseHere" |
 * "background"`). Each is checked by its key instead of by its whole name.
 */
const TEMPLATED: Record<string, { template: string; key: string }> = {
  "prose-card-part-senseHere": { template: "prose-card-part-${", key: '"senseHere"' },
  "prose-card-part-background": { template: "prose-card-part-${", key: '"background"' },
};

describe("voices.css", () => {
  it("finds rules to check", () => {
    expect(selectors.length).toBe(3); // author, AI, reader
    expect(classes.length).toBeGreaterThan(40);
  });

  it("guards every rule with :root[data-voices]", () => {
    for (const s of selectors) expect(s, s).toMatch(/^:root\[data-voices\]\s/);
  });

  it("names only classes some component still renders", () => {
    const missing = classes.filter((c) => {
      const t = TEMPLATED[c];
      if (t) return !(SOURCE.includes(t.template) && SOURCE.includes(t.key));
      // A class token inside a string: bounded by a quote, a space or a backtick.
      return !new RegExp(`["'\`\\s]${c.replace(/-/g, "\\-")}["'\`\\s$]`).test(SOURCE);
    });
    expect(missing).toEqual([]);
  });

  /* A class can exist and the rule still match nothing: `.chat-turn.model`
     needs both on ONE element, and each could survive somewhere else after the
     pair is split. So every compound must be found together on one line of
     some component — a className string or template. GPT Sol, plan review. */
  it("finds every compound of classes together on one line of some component", () => {
    const lines = SOURCE.split("\n");
    const compounds = [
      ...new Set([...CSS.matchAll(/(?:\.[A-Za-z][\w-]*){2,}/g)].map((m) => m[0])),
    ];
    expect(compounds).toContain(".chat-turn.model");
    const token = (c: string) => new RegExp(`(^|[\\s"'\`])${c}($|[\\s"'\`$])`);
    const apart = compounds.filter((compound) => {
      const parts = compound.split(".").filter(Boolean);
      return !lines.some((line) => parts.every((c) => token(c).test(line)));
    });
    expect(apart).toEqual([]);
  });

  it("uses only the voice tokens, and tokens.css defines them", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    const used = [...new Set([...CSS.matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1]!))];
    expect(used.sort()).toEqual(["--font-ai", "--font-author", "--font-reader"]);
    for (const t of used) expect(tokens, t).toMatch(new RegExp(`${t}:`));
  });
});
