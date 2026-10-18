/**
 * **No native `title` tooltips in the app.** Greg, 2026-10-17 (spya-q04h98):
 *
 * > Look for anywhere we're using regular tooltips (e.g. when hovering over the
 * > search name), and replace with rich tooltips / see tooltips.md / And how can
 * > we ensure this going forwards?
 *
 * The rule had been written down since 2026-10-01 (docs/project/tooltips.md §
 * Prefer the rich card to a native `title`) and nothing checked it, so on the
 * day of that report there were 168 native `title`s on host elements in
 * `src/web`, two SVG `<title>`s, six more in spreads and about twenty handed to
 * components that put them on the DOM. This is the check. The fix it asks for
 * is almost always `title="…"` → `data-tip="…"`, which the page-wide card
 * (TipCard.tsx) draws as ours — plus an `aria-label` with the same words when
 * the `title` was the element's only name.
 *
 * It parses every `src/web/**\/*.tsx` with Babel — the AST, not a grep, because
 * a `title` prop on a component (a section heading) is not a tooltip and a
 * grep cannot tell `<Section title>` from `<span title>`. Babel rather than
 * TypeScript for tests/fleet-imports.test.ts's reason: TypeScript 7 exposes no
 * AST from its package root.
 *
 * What it fails on:
 * - a JSX `title` attribute on a host (lowercase) element, bar {@link ALLOWED};
 * - a spread onto a host element that visibly carries `title`;
 * - a JSX `<title>` inside an `<svg>` — a native tooltip over every pixel of
 *   the shape (tests/sketch-caption-is-not-a-native-tooltip.test.tsx is the
 *   day that cost), bar {@link SVG_TITLE_ALLOWED};
 * - a `title` handed to one of {@link FORWARDS_TO_DOM}, our components that
 *   spread their props onto an element. Their types refuse `title` as well;
 *   this pins that they still do if somebody widens them.
 *
 * What it cannot see, and the repo has none of on 2026-10-17: a `title` put on
 * with `setAttribute`/`.title =`, a spread of a variable (`{...rest}`) that
 * holds one, and a `<title>` drawn by a component whose `<svg>` is in another
 * file. And an article's own `title`s, which arrive as sanitised HTML and are
 * not code (the plan, 261017g, § Out of scope).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import type { Node } from "@babel/types";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "src/web");

/**
 * Host elements whose `title` is not a tooltip, each with its reason.
 * Keep it short: an entry here is a native grey box somebody has agreed to.
 */
const ALLOWED: Record<string, string> = {
  /* An iframe's `title` is its accessible name (WCAG 4.1.2, technique H64),
     and browsers show no tooltip for it over the embedded page. */
  iframe: "the frame's accessible name, not a tooltip",
};

/** The one condition an allowed `<title>` may sit under: `tips === "native" && <title>…`. */
const NATIVE_BRANCH = 'tips === "native"';

/**
 * Files whose SVG `<title>` is allowed, and only under {@link NATIVE_BRANCH} —
 * not anywhere in the file, so a new one beside it still fails (GPT Sol, code
 * review 1). `cost-charts.tsx` draws the same chart
 * twice: in the app, where its bars carry `data-tip`, and as a static file
 * (`scripts/cost-analysis-chart.ts`) with no React root and no card to draw
 * one, where `<title>` is the only hover there is. Its `tips` prop chooses;
 * tests/cost-charts.test.tsx pins both.
 */
const SVG_TITLE_ALLOWED: Record<string, string> = {
  "src/web/cost-charts.tsx": `the standalone report's only hover label — and only under ${NATIVE_BRANCH}`,
};

/** Our components that put their `title` on the DOM element they render. */
const FORWARDS_TO_DOM = new Set(["Button", "Link", "IconButton", "SourceLink"]);

type Hit = { file: string; line: number; what: string };

/**
 * Whether a spread visibly carries a `title` — `{...{ title }}`,
 * `{...(x ? { title: y } : {})}`, `{...(x && { title })}`. Six of these were
 * native tooltips on 2026-10-17 that a check of attributes alone missed (GPT
 * Sol, plan review). A spread of a variable cannot be seen into; the
 * forwarding components' types are what refuse `title` there.
 */
function spreadsTitle(expr: Node): boolean {
  switch (expr.type) {
    case "ObjectExpression":
      return expr.properties.some(
        (p) =>
          (p.type === "SpreadElement" && spreadsTitle(p.argument)) ||
          (p.type === "ObjectProperty" &&
            ((!p.computed && p.key.type === "Identifier" && p.key.name === "title") ||
              (p.key.type === "StringLiteral" && p.key.value === "title"))),
      );
    case "ConditionalExpression":
      return spreadsTitle(expr.consequent) || spreadsTitle(expr.alternate);
    case "LogicalExpression":
      return spreadsTitle(expr.left) || spreadsTitle(expr.right);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "ParenthesizedExpression":
      return spreadsTitle(expr.expression);
    default:
      return false;
  }
}

function hitsIn(src: string, file: string): Hit[] {
  const ast = parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const hits: Hit[] = [];
  let inSvg = 0;
  let inNativeBranch = 0;
  const visitChildren = (n: Node): void => {
    for (const [key, value] of Object.entries(n)) {
      if (key === "loc" || key === "start" || key === "end" || key === "leadingComments" || key === "trailingComments")
        continue;
      visit(value);
    }
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as Node;
    if (
      n.type === "LogicalExpression" &&
      n.operator === "&&" &&
      src.slice(n.left.start ?? 0, n.left.end ?? 0) === NATIVE_BRANCH
    ) {
      visit(n.left);
      inNativeBranch += 1;
      visit(n.right);
      inNativeBranch -= 1;
      return;
    }
    if (n.type === "JSXElement" && n.openingElement.name.type === "JSXIdentifier" && n.openingElement.name.name === "svg") {
      inSvg += 1;
      visitChildren(n);
      inSvg -= 1;
      return;
    }
    if (n.type === "JSXOpeningElement" && n.name.type === "JSXIdentifier") {
      const tag = n.name.name;
      const line = n.loc?.start.line ?? 0;
      if (tag === "title" && inSvg > 0 && !(file in SVG_TITLE_ALLOWED && inNativeBranch > 0))
        hits.push({ file, line, what: "an SVG <title> element" });
      const host = /^[a-z]/.test(tag);
      if ((host && !(tag in ALLOWED)) || FORWARDS_TO_DOM.has(tag)) {
        for (const attr of n.attributes) {
          if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === "title")
            hits.push({ file, line: attr.loc?.start.line ?? line, what: `title= on <${tag}>` });
          if (attr.type === "JSXSpreadAttribute" && spreadsTitle(attr.argument))
            hits.push({ file, line: attr.loc?.start.line ?? line, what: `a spread title on <${tag}>` });
        }
      }
    }
    visitChildren(n);
  };
  visit(ast.program);
  return hits;
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("native title tooltips", () => {
  it("the scanner finds each shape it is meant to (so a clean run means something)", () => {
    const fixture = `
      export const A = () => <span title="native">x</span>;
      export const B = () => <svg><rect><title>native</title></rect></svg>;
      export const C = () => <Button title="native">x</Button>;
      export const D = () => <span {...(on ? { title: "native" } : {})}>x</span>;
      export const E = () => <a {...{ title }}>x</a>;
      export const F = () => <Section title="a heading, not a tooltip" />;
      export const G = () => <iframe title="a frame's name" />;
      export const H = () => <span data-tip="ours" {...rest}>x</span>;
      export const I = () => <head><title>a document title</title></head>;
      export const J = () => <span {...{ ...{ title: "nested" } }}>x</span>;
      export const K = () => <span {...{ ["title"]: "computed" }}>x</span>;
    `;
    expect(hitsIn(fixture, "fixture.tsx").map((h) => h.what)).toEqual([
      "title= on <span>",
      "an SVG <title> element",
      "title= on <Button>",
      "a spread title on <span>",
      "a spread title on <a>",
      "a spread title on <span>",
      "a spread title on <span>",
    ]);
  });

  it("allows cost-charts.tsx its native <title> only in the native branch", () => {
    const chart = `
      export const A = () => <svg><rect>{tips === "native" && <title>ok</title>}</rect></svg>;
      export const B = () => <svg><rect><title>not ok</title></rect></svg>;
    `;
    expect(hitsIn(chart, "src/web/cost-charts.tsx").map((h) => `${h.line} ${h.what}`)).toEqual([
      "3 an SVG <title> element",
    ]);
  });

  it("src/web has none — use data-tip (TipCard.tsx), and aria-label if the title was the only name", () => {
    const files = tsxFiles(WEB);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => hitsIn(readFileSync(f, "utf8"), path.relative(ROOT, f)));
    expect(hits.map((h) => `${h.file}:${h.line} ${h.what}`)).toEqual([]);
  });
});
