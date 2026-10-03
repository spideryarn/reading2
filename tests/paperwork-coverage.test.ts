/**
 * **Every prompt handed the whole article carries the paperwork rule, or says why not.**
 *
 * Greg, 2026-10-01: *"The structure, summary, tweet thread, and other such modes don't really need
 * to include summaries of stuff like acknowledgements or conflicts of interest or affiliations"*.
 * `paperwork(kind)` in src/paperwork.ts is the rule; this makes it the default, the way
 * tests/plain-words-coverage.test.ts does for plain words. A new file that renders the whole
 * article for a model (`articleWithIds(` or `articleText(`) is red here until it calls
 * `paperwork(` or is added to `PAPERWORK_EXEMPT` with its reason.
 * docs/plans/261003d-paperwork-in-every-whole-piece-mode.md.
 *
 * **What it cannot see**: it works on files, not prompts, so a file with two prompts passes if
 * either carries the rule (Debate's identity pass rides on its claims pass, which is right); it
 * finds the article by two bare function names, so a renamed import, a wrapper, an article string
 * built elsewhere or a renderer of its own (the structure step numbers its own blocks; Labels) is
 * invisible. **And what it over-sees**: a file that renders the article only to hash it
 * (`crossrefs-fingerprint.ts`) is caught too, and is exempt with that reason. A default, not a
 * proof — GPT Sol's plan review, P2.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAPERWORK_EXEMPT } from "../src/paperwork.js";
import { parseSource, walkAst, type AstNode } from "./helpers/ts-ast.js";

const ROOT = path.join(import.meta.dirname, "..");
const WHOLE_ARTICLE = new Set(["articleWithIds", "articleText"]);

function facts(source: string): { wholeArticle: boolean; paperworkKinds: string[] } {
  let wholeArticle = false;
  const paperworkKinds: string[] = [];
  walkAst(parseSource(source).program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== "Identifier" || typeof callee.name !== "string") return;
    if (WHOLE_ARTICLE.has(callee.name)) wholeArticle = true;
    if (callee.name === "paperwork") {
      const arg = (node.arguments as AstNode[] | undefined)?.[0];
      paperworkKinds.push(arg?.type === "StringLiteral" && typeof arg.value === "string" ? arg.value : "(non-literal)");
    }
  });
  return { wholeArticle, paperworkKinds };
}

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return files(rel);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [rel] : [];
  });
}

function uncovered(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([f, s]) => !PAPERWORK_EXEMPT[f] && facts(s).wholeArticle && facts(s).paperworkKinds.length === 0)
    .map(([f]) => f);
}

const CHANGED_PROMPTS = {
  "src/sketch.ts": "summary",
  "src/illustrated.ts": "summary",
  "src/faq.ts": "pick",
  "src/quiz.ts": "pick",
  "src/ideas.ts": "pick",
  "src/quotes.ts": "pick",
  "src/glossary.ts": "pick",
  "src/timeline.ts": "pick",
  "src/arc.ts": "part",
  "src/debate.ts": "pick",
} as const;

describe("the paperwork rule is the default for every whole-article prompt", () => {
  const all = files("src").filter((f) => f !== "src/article-prompt.ts" && !f.startsWith("src/web/"));
  const sources = new Map(all.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf-8")]));

  it("finds the whole-article prompts it is meant to find", () => {
    /* A scan that finds nothing passes everything. */
    const found = all.filter((f) => facts(sources.get(f)!).wholeArticle);
    for (const f of ["src/sketch.ts", "src/quiz.ts", "src/glossary.ts", "src/citations.ts", "src/arc.ts"]) {
      expect(found, f).toContain(f);
    }
  });

  it("every whole-article prompt carries the rule or is exempt with a reason", () => {
    expect(
      uncovered(sources),
      "add paperwork(kind) to the prompt, or a reason to PAPERWORK_EXEMPT in src/paperwork.ts",
    ).toEqual([]);
  });

  it("each prompt changed here calls the rule exactly once, with its own kind", () => {
    for (const [f, kind] of Object.entries(CHANGED_PROMPTS)) {
      expect(facts(sources.get(f)!).paperworkKinds, f).toEqual([kind]);
    }
  });

  it("every exemption names a file that exists, reads the whole article, and does not carry the rule", () => {
    for (const [f, why] of Object.entries(PAPERWORK_EXEMPT)) {
      const source = sources.get(f);
      expect(source, `${f} does not exist`).toBeDefined();
      expect(facts(source!).wholeArticle, `${f} no longer reads the whole article`).toBe(true);
      expect(facts(source!).paperworkKinds, `${f} carries the rule, so drop its exemption`).toEqual([]);
      expect(why.length, f).toBeGreaterThan(10);
    }
  });

  it("would reject a new whole-article file until that file calls the rule", () => {
    expect(uncovered(new Map([["src/new-mode.ts", "const s = articleWithIds(meta, blocks);"]]))).toEqual([
      "src/new-mode.ts",
    ]);
    expect(uncovered(new Map([["src/new-mode.ts", "// articleWithIds(meta, blocks)"]]))).toEqual([]);
    expect(
      uncovered(new Map([["src/new-mode.ts", ["const s = `$", "{paperwork('pick')}`; articleText(meta, blocks);"].join("")]])),
    ).toEqual([]);
  });
});
