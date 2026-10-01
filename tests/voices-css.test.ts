/**
 * **The per-voice faces stay behind their switch, and every class they name
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
import { parse as babelParse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const CSS = readFileSync("src/web/styles/voices.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule's selector text, one string per rule. */
const selectors = [...CSS.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.trim());

function selectorUsing(token: "--font-author" | "--font-ai" | "--font-reader"): string {
  const rule = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) =>
    m[2]!.includes(`var(${token})`),
  );
  if (!rule) throw new Error(`voices.css has no rule using ${token}`);
  return rule[1]!.trim();
}

/** Every `.class` the file names. */
const classes = [...new Set([...CSS.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]!))];

type AstNode = Record<string, unknown> & { type: string };

function visitAst(value: unknown, visit: (node: AstNode) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) visitAst(child, visit);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (typeof node.type !== "string") return;
  visit(node as AstNode);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "loc" && !key.endsWith("Comments")) visitAst(child, visit);
  }
}

function textLiteralsUnder(value: unknown): string[] {
  const strings: string[] = [];
  visitAst(value, (node) => {
    if (node.type === "StringLiteral" && typeof node.value === "string") {
      strings.push(node.value);
    }
    if (node.type === "TemplateElement") {
      const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
      if (typeof cooked === "string") strings.push(cooked);
    }
  });
  return strings;
}

interface SourceLiterals {
  classNames: string[];
  strings: string[];
}

function sourceLiteralsUnder(dir: string): SourceLiterals {
  const result: SourceLiterals = { classNames: [], strings: [] };
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = sourceLiteralsUnder(p);
      result.classNames.push(...nested.classNames);
      result.strings.push(...nested.strings);
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;

    const tree = babelParse(readFileSync(p, "utf8"), {
      sourceType: "module",
      sourceFilename: p,
      plugins: ["typescript", "jsx"],
    });
    result.strings.push(...textLiteralsUnder(tree.program));
    visitAst(tree.program, (node) => {
      let value: unknown;
      if (node.type === "JSXAttribute") {
        const name = node.name as { name?: unknown } | undefined;
        if (name?.name !== "className") return;
        value = node.value;
      } else if (node.type === "ObjectProperty") {
        const key = node.key as { name?: unknown } | undefined;
        if (key?.name !== "className") return;
        value = node.value;
      } else {
        return;
      }
      // Spaces stand in for expressions: class tokens may be split across
      // quasis (`... ${status}${condition ? " own" : ""}`).
      result.classNames.push(textLiteralsUnder(value).join(" "));
    });
  }
  return result;
}
const SOURCE_LITERALS = sourceLiteralsUnder("src/web");

/**
 * Classes components build from templates rather than writing out:
 * `prose-card-part-${section.key}` in ProseHoverCard's TermCard, whose keys are
 * the glossary's two sections (`GlossaryPanel.tsx`, `key: "senseHere" |
 * "background"`), Timeline's `tl-when-${tone}`, and LiveStatus's
 * `chat-live-line ${line.role}`. Each is checked by the template and its typed
 * key instead of by its whole name.
 */
const TEMPLATED: Record<string, { template: string; key: string }> = {
  "prose-card-part-senseHere": { template: "prose-card-part-", key: "senseHere" },
  "prose-card-part-background": { template: "prose-card-part-", key: "background" },
  "tl-when-words": { template: "tl-when tl-when-", key: "words" },
  companion: { template: "chat-live-line ", key: "companion" },
  reader: { template: "chat-live-line ", key: "reader" },
};

const TEMPLATED_COMPOUNDS: Record<string, { template: string; key: string }> = {
  ".chat-live-line.companion": { template: "chat-live-line ", key: "companion" },
  ".chat-live-line.reader": { template: "chat-live-line ", key: "reader" },
};

/** Split a selector list without splitting commas inside :is(), :not(), or attributes. */
function selectorBranches(selector: string): string[] {
  const branches: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      branches.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  branches.push(selector.slice(start).trim());
  return branches;
}

describe("voices.css", () => {
  it("finds rules to check", () => {
    expect(selectors.length).toBe(3); // author, AI, reader
    expect(classes.length).toBeGreaterThan(40);
  });

  it("guards every rule with :root[data-voices]", () => {
    for (const selector of selectors) {
      for (const branch of selectorBranches(selector)) {
        expect(branch, selector).toMatch(/^:root\[data-voices\]\s/);
      }
    }
  });

  it("names only classes some component still renders", () => {
    const missing = classes.filter((c) => {
      const t = TEMPLATED[c];
      if (t) {
        return !(
          SOURCE_LITERALS.classNames.some((fragment) => fragment.includes(t.template)) &&
          SOURCE_LITERALS.strings.includes(t.key)
        );
      }
      const token = new RegExp(`(^|\\s)${c.replace(/-/g, "\\-")}($|\\s)`);
      return !SOURCE_LITERALS.classNames.some((fragment) => token.test(fragment));
    });
    expect(missing).toEqual([]);
  });

  /* A class can exist and an adjacent-class compound still match nothing:
     `.chat-turn.model`
     needs both on ONE element, and each could survive somewhere else after the
     pair is split. So every compound must be found together in one className
     string or template. GPT Sol, plan review. */
  it("finds every adjacent-class compound together in one component className", () => {
    const compounds = [
      ...new Set([...CSS.matchAll(/(?:\.[A-Za-z][\w-]*){2,}/g)].map((m) => m[0])),
    ];
    expect(compounds).toContain(".chat-turn.model");
    const token = (c: string) => new RegExp(`(^|\\s)${c}($|\\s)`);
    const apart = compounds.filter((compound) => {
      const templated = TEMPLATED_COMPOUNDS[compound];
      if (templated) {
        return !(
          SOURCE_LITERALS.classNames.some((fragment) => fragment.includes(templated.template)) &&
          SOURCE_LITERALS.strings.includes(templated.key)
        );
      }
      const parts = compound.split(".").filter(Boolean);
      return !SOURCE_LITERALS.classNames.some((fragment) =>
        parts.every((c) => token(c).test(fragment)),
      );
    });
    expect(apart).toEqual([]);
  });

  it("uses only the voice tokens, and tokens.css defines them", () => {
    const tokens = readFileSync("styles/tokens.css", "utf8");
    const used = [...new Set([...CSS.matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1]!))];
    expect(used.sort()).toEqual(["--font-ai", "--font-author", "--font-reader"]);
    for (const t of used) expect(tokens, t).toMatch(new RegExp(`${t}:`));
  });

  it("keeps the representative mixed and inheritance-breaking surfaces in the right voice", () => {
    const author = selectorUsing("--font-author");
    const ai = selectorUsing("--font-ai");
    const reader = selectorUsing("--font-reader");

    for (const selector of [
      ".faq-quote",
      ".gloss-ask-found",
      ".tip-cite-text",
      ".skim-words-tip",
      ".dbt-claim-text",
      ".mir-quote:not(.mir-block-id)",
      ".ideas-quote:not(.ideas-quote-moved)",
      ".tl-quote:not(.tl-quote-moved)",
      ".tl-when-words",
    ]) {
      expect(author, selector).toContain(selector);
    }

    for (const selector of [
      ".ideas-name",
      ".cnd-answer",
      ".cnd-answer .fmt-h",
      ".cnd-name",
      ".cnd-affil",
      ".cnd-requirement",
      ".cnd-why",
      ".chat-live-line.companion .chat-live-words",
      ".dbt-thread-name",
      ".clm-list .clm-claim",
      ".clm-why:not(.clm-why-withheld)",
    ]) {
      expect(ai, selector).toContain(selector);
    }
    expect(ai).not.toContain(".ideas-blurb");
    expect(ai).not.toContain(".cite-verdict-text");

    for (const selector of [
      ".crit-text",
      ".crit-poles input",
      ".cnd-asked",
      ".cnd-box",
      ".mir-criterion",
      ".mir-placement-criterion",
      ".chat-live-line.reader .chat-live-words",
      ".chat-rename",
      ".skim-purpose-text",
      ".skim-purpose-tip p",
    ]) {
      expect(reader, selector).toContain(selector);
    }
  });
});
