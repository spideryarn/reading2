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

const CALL = new RegExp(`(?<!function )(?<![\\w.])(?:${MODEL_CALLS.join("|")})\\(`);

/** Source with its comments removed, so a call named in a comment is not a call. */
export function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(rel);
    return e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [rel] : [];
  });
}

const carries = (source: string) => /\bplainWords\(/.test(code(source));

describe("the plain-words rule is the default for every prompt", () => {
  const all = [...files("src"), ...files("scripts")].filter((f) => f !== "src/plain-words.ts");
  const calling = all.filter((f) => CALL.test(code(fs.readFileSync(path.join(ROOT, f), "utf-8"))));

  it("finds the model calls it is meant to find", () => {
    /* A scan that finds nothing passes everything. These are known to call a model today. */
    for (const f of ["src/arc.ts", "src/explain.ts", "src/converse.ts", "src/glossary.ts", "src/hierarchy.ts"]) {
      expect(calling, f).toContain(f);
    }
  });

  it("every file that calls a model carries the rule or is exempt with a reason", () => {
    const missing = calling.filter(
      (f) => !PLAIN_WORDS_EXEMPT[f] && !carries(fs.readFileSync(path.join(ROOT, f), "utf-8")),
    );
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
    expect(CALL.test(code("// streamMessage(\"x\")\n/* openRouterJson( */"))).toBe(false);
    expect(carries("/* ${plainWords('explain')} */")).toBe(false);
    expect(carries("const S = `${plainWords('explain')}`;")).toBe(true);
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
