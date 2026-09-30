/**
 * **Every file that calls a model carries the plain-words rule, or says why not.**
 *
 * Greg, 2026-09-28: *"we want to make this plainer/simpler language rule common across all prompts
 * that generate text of any kind. And ideally also in a way that it will apply to all future
 * prompts."* A guide is advice; this is what makes the rule the default. A new file that sends a
 * prompt is red here until it imports `plainWords` from src/plain-words.ts or is added to
 * `PLAIN_WORDS_EXEMPT` there with its reason. docs/project/prompting-guide.md.
 *
 * **What it cannot see**, said so the green does not claim more: it works on files, not on each
 * prompt, so a file with two prompts passes if either carries the rule; it finds a model call by
 * the name of the function that makes it (`MODEL_CALLS` below), so a call through a new wire
 * function is invisible until that name is added; and it cannot tell whether the prompt that
 * includes the rule is the one actually sent. It is a default, not a proof — GPT Sol's review of
 * the plan (H4) names the stronger shape, a typed policy on every request, as the next step.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLAIN_WORDS_EXEMPT, plainWords } from "../src/plain-words.js";
import { parseSource, walkAst, type AstNode } from "./helpers/ts-ast.js";

const ROOT = path.join(import.meta.dirname, "..");

/** The functions through which this codebase sends a prompt to a model. */
const MODEL_CALLS = [
  "streamMessage",
  "openRouterJson",
  "openRouterStream",
  "openRouterReader",
  "openRouterFrontMatterReader",
  "openRouterTranscription",
  "openRouterImage",
  "openRouterCall",
  "runStream", // src/stream-run.ts: the caller builds the prompt, so the caller must carry the rule
];

/**
 * Prompt files the call scan cannot find, because the call is made elsewhere or by another tool: the
 * prompt text lives here, so this is the file that must carry the rule.
 */
const PROMPT_FILES_WITHOUT_A_CALL = [
  "src/hierarchy-expand.ts", // EXPAND_SYSTEM; the call is in src/hierarchy-deepen.ts
  "src/live.ts", // the realtime session's instructions; the session is opened by the browser
  "src/referee-candidates-prompt.ts", // CANDIDATES_SYSTEM; sent by converse
  "scripts/changelog/changelog.ts", // the public changelog's copy prompt, sent through the claude CLI
];

const MODEL_CALL_SET: ReadonlySet<string> = new Set(MODEL_CALLS);
const FACTS = new Map<string, { modelCall: boolean; plainWordsCall: boolean }>();

/** Calls in executable code, found by syntax rather than by stripping comments with a regex. */
function sourceFacts(source: string): { modelCall: boolean; plainWordsCall: boolean } {
  const cached = FACTS.get(source);
  if (cached) return cached;
  let modelCall = false;
  let plainWordsCall = false;
  walkAst(parseSource(source).program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== "Identifier" || typeof callee.name !== "string") return;
    if (MODEL_CALL_SET.has(callee.name)) modelCall = true;
    if (callee.name === "plainWords") plainWordsCall = true;
  });
  const facts = { modelCall, plainWordsCall };
  FACTS.set(source, facts);
  return facts;
}

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(rel);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [rel] : [];
  });
}

const carries = (source: string) => sourceFacts(source).plainWordsCall;

function uncoveredCallingFiles(sources: ReadonlyMap<string, string>): string[] {
  return [...sources]
    .filter(([f, source]) => sourceFacts(source).modelCall && !PLAIN_WORDS_EXEMPT[f] && !carries(source))
    .map(([f]) => f);
}

describe("the plain-words rule is the default for every prompt", () => {
  const all = [...files("src"), ...files("scripts")].filter((f) => f !== "src/plain-words.ts");
  const sources = new Map(all.map((f) => [f, fs.readFileSync(path.join(ROOT, f), "utf-8")]));
  const calling = all.filter((f) => sourceFacts(sources.get(f)!).modelCall);

  it("finds the model calls it is meant to find", () => {
    /* A scan that finds nothing passes everything. These are known to call a model today. */
    for (const f of ["src/arc.ts", "src/explain.ts", "src/converse.ts", "src/glossary.ts", "src/hierarchy.ts"]) {
      expect(calling, f).toContain(f);
    }
  });

  it("every file that calls a model carries the rule or is exempt with a reason", () => {
    const missing = uncoveredCallingFiles(sources);
    expect(missing, "add plainWords(...) to the prompt, or an entry with a reason to PLAIN_WORDS_EXEMPT in src/plain-words.ts").toEqual([]);
  });

  it("every prompt file whose call is made elsewhere carries the rule", () => {
    const missing = PROMPT_FILES_WITHOUT_A_CALL.filter((f) => !carries(fs.readFileSync(path.join(ROOT, f), "utf-8")));
    expect(missing).toEqual([]);
  });

  it("every exemption names a file that exists and gives a reason", () => {
    for (const [f, why] of Object.entries(PLAIN_WORDS_EXEMPT)) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
      expect(why.length, f).toBeGreaterThan(10);
    }
  });

  it("does not count a call or a rule that only appears in a comment", () => {
    expect(sourceFacts("// streamMessage(\"x\")\n/* openRouterJson( */").modelCall).toBe(false);
    expect(carries(["/* $", "{plainWords('explain')} */"].join(""))).toBe(false);
    expect(carries(["const S = `$", "{plainWords('explain')}`;"].join(""))).toBe(true);
  });

  it("does not mistake URL-like text in a template literal for a comment", () => {
    const source = ["const url = `it is $", "{protocol}//, not https://`; openRouterJson({});"].join("");
    expect(sourceFacts(source).modelCall).toBe(true);
  });

  it("would reject a new model-calling file until it carries the rule", () => {
    expect(uncoveredCallingFiles(new Map([["src/a-new-prompt.ts", "openRouterJson({});"]]))).toEqual([
      "src/a-new-prompt.ts",
    ]);
  });
});

describe("the rule itself", () => {
  it("always carries the core and the anchor, and only the kinds asked for", () => {
    const core = plainWords();
    expect(core).toMatch(/^PLAIN WORDS\n/);
    expect(core).toContain("plainer means equally specific");
    expect(core).toContain("Text you are told to copy exactly stays exactly as written.");
    expect(core).toContain("Plainer than the article, never further from it");
    expect(core).not.toContain("For example, explaining a line");
    const ask = plainWords("ask");
    expect(ask).toContain("never give the\nanswer away");
    expect(ask).not.toContain("For example, explaining a line");
  });

  it("uses no bracketed aside in its own example, which the summary prompt forbids", () => {
    const example = plainWords("explain").split("GOOD:")[1]!.split("\n\n")[0]!;
    expect(example).not.toMatch(/\(/);
  });

  it("does not repeat a kind named twice", () => {
    expect(plainWords("explain", "explain")).toBe(plainWords("explain"));
  });
});
