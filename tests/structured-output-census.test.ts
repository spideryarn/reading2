/**
 * Every file under `src/` with a directly named `parseJsonAnswer` call must
 * also put a schema on a request, or be on a short list with a reason beside it.
 *
 * ## The rule
 *
 * docs/project/prompting-guide.md § What the model writes back: a model that
 * answers in JSON is given a JSON Schema on the request, so the provider holds
 * it to the shape, and *"every exception is named"*. Until 2026-10-04 nothing
 * held that list. A new stage could call `parseJsonAnswer` on a free-text
 * answer and no check would say so (docs/plans/261004d § A4).
 *
 * ## What it checks
 *
 * It is a **file-level** census. A file that directly *calls* `parseJsonAnswer` must
 * also *call* one of the two functions that attach a schema to a request,
 * `withMessagesJsonSchema` or `withChatJsonSchema`, or be named in `EXCEPTIONS`.
 *
 * Only those two count. The same module's validators
 * (`validateAnthropicJsonSchema` and friends) check a schema and attach nothing,
 * so a file that calls only a validator is still red ⟨GPT Sol, plan review, S3⟩.
 *
 * An exception that is no longer one fails too: a named file that has stopped
 * calling the parser, or has started attaching a schema.
 *
 * On 2026-10-04: 21 files call the parser. 16 call `withMessagesJsonSchema`,
 * 2 call `withChatJsonSchema`, and 3 are the exceptions below.
 *
 * ## What it cannot see
 *
 * - **A second request in a compliant file.** One decorated call makes the
 *   whole file pass, so a second, undecorated request beside it is not seen.
 * - **A plain `JSON.parse`** of a model's answer. Only `parseJsonAnswer` is
 *   looked for.
 * - **A parser reused from another file.** A file that hands its answer to
 *   another module's parsing function calls nothing this scan knows.
 * - **Local aliases or dynamic method names.** It follows directly named
 *   calls (including TypeScript wrappers and static string properties), not
 *   dataflow through `const read = parseJsonAnswer; read(text)` or `json[key]`.
 * - **A decorator whose result is not the body sent.** The scan sees the call,
 *   not where its return value goes.
 *
 * ## Why a parser
 *
 * Comments under `src/` mention `parseJsonAnswer(` while explaining why a file
 * does not call it: src/search.ts and src/json-repair-log.ts both do, and a
 * grep counted them as callers. tests/helpers/ts-ast.ts says the rest.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const PARSER = "parseJsonAnswer";
const DECORATORS = ["withMessagesJsonSchema", "withChatJsonSchema"] as const;

/**
 * Files that call the parser with no schema on the request, and why. The
 * reasons are the ones recorded when each was deferred:
 * docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md § Deferred.
 */
const EXCEPTIONS: Record<string, string> = {
  "src/citation-find.ts":
    "Web search runs on the same call. Nobody has measured that with a schema, and the search annotations are a security witness.",
  "src/author-lookup.ts":
    "Web search runs on the same call, as in citation-find.ts, and the server checks every URL and address in the answer against the search annotations itself (plan 261009u D4).",
  "src/labels.ts":
    "Its answer is tuples, which the provider's supported schema subset cannot express. It needs a change of answer shape and a quality check first; it already re-asks on a malformed pair.",
  "src/structure-expand.ts":
    "The deepening wave is off by default, so this request is not made in an ordinary run.",
};

interface Source {
  path: string;
  text: string;
}

interface Use {
  /** The file calls `parseJsonAnswer`. */
  parses: boolean;
  /** Which of the two decorators the file calls. */
  decorators: string[];
  /** A watched name imported or exported under another name, with its line. */
  renamed: string[];
}

const nameOf = (n: unknown): string | null => {
  const id = n as { type?: string; name?: string } | null | undefined;
  return id?.type === "Identifier" && typeof id.name === "string" ? id.name : null;
};

const WATCHED = new Set<string>([PARSER, ...DECORATORS]);

/** TypeScript wrappers change a value's type, not which function is called. */
function unwrapped(n: AstNode | undefined): AstNode | undefined {
  while (n && ["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSSatisfiesExpression"].includes(String(n.type))) {
    n = n.expression as AstNode | undefined;
  }
  return n;
}

/** The directly named function or static member a call invokes; `null` otherwise. */
function calledName(n: AstNode): string | null {
  if (n.type !== "CallExpression" && n.type !== "OptionalCallExpression") return null;
  const callee = unwrapped(n.callee as AstNode | undefined);
  const member = callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression";
  if (!member) return nameOf(callee);
  if (!callee?.computed) return nameOf(callee?.property);
  const property = unwrapped(callee.property as AstNode | undefined);
  return property?.type === "StringLiteral" && typeof property.value === "string" ? property.value : null;
}

/**
 * A watched name brought in or sent out under another name, or `null`. A rename
 * would let a caller walk past the scan, which knows three names.
 */
function renamedName(n: AstNode): string | null {
  const [from, to] =
    n.type === "ImportSpecifier"
      ? [nameOf(n.imported), nameOf(n.local)]
      : n.type === "ExportSpecifier"
        ? [nameOf(n.local), nameOf(n.exported)]
        : [null, null];
  return from && WATCHED.has(from) && to !== from ? from : null;
}

/** What one source text calls. Comments and strings are not calls. */
function scanSource(text: string): Use {
  const use: Use = { parses: false, decorators: [], renamed: [] };
  /* Parsing every file under src/ costs seconds; a file that never spells one
     of the three names has no directly named call for this scan to find. */
  if (![...WATCHED].some((name) => text.includes(name))) return use;

  walkAst(parseSource(text).program, (n: AstNode) => {
    const called = calledName(n);
    if (called === PARSER) use.parses = true;
    else if (called && WATCHED.has(called) && !use.decorators.includes(called)) use.decorators.push(called);

    const renamed = renamedName(n);
    if (renamed) use.renamed.push(`${renamed} (line ${lineOf(n)})`);
  });
  return use;
}

interface Census {
  /** Every file that calls the parser, with the decorators it calls. */
  callers: Record<string, string[]>;
  /** One line per thing that is wrong. Empty is a pass. */
  problems: string[];
}

/**
 * The whole check, over `(path, text)` pairs, so the tests below can hand it a
 * source that is not in `src/`.
 */
function census(sources: Source[], exceptions: Record<string, string>): Census {
  const callers: Record<string, string[]> = {};
  const problems: string[] = [];
  const seen = new Map<string, Use>();

  for (const { path: file, text } of sources) {
    const use = scanSource(text);
    seen.set(file, use);
    for (const name of use.renamed) {
      problems.push(`${file} imports or exports ${name} under another name, which this scan cannot follow`);
    }
    if (!use.parses) continue;
    callers[file] = use.decorators;
    if (use.decorators.length === 0 && !(file in exceptions)) {
      problems.push(
        `${file} calls ${PARSER} and attaches no schema to a request (${DECORATORS.join(" or ")})`,
      );
    }
  }

  for (const file of Object.keys(exceptions)) {
    const use = seen.get(file);
    if (!use?.parses) problems.push(`${file} is a named exception but does not call ${PARSER}`);
    else if (use.decorators.length > 0) {
      problems.push(`${file} is a named exception but now calls ${use.decorators.join(", ")}`);
    }
  }
  return { callers, problems };
}

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...sourcesUnder(rel));
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out;
}

describe("the scan itself", () => {
  const decorated = `
    import { parseJsonAnswer } from "./parse-json.js";
    import { withMessagesJsonSchema } from "./messages-structured-output.js";
    export const body = withMessagesJsonSchema({}, schema);
    export const read = (text: string) => parseJsonAnswer(text);
  `;

  it("passes a file that parses and attaches a schema", () => {
    const { callers, problems } = census([{ path: "src/a.ts", text: decorated }], {});
    expect(problems).toEqual([]);
    expect(callers).toEqual({ "src/a.ts": ["withMessagesJsonSchema"] });
  });

  it("fails a file that parses with no schema", () => {
    const bare = `
      import { parseJsonAnswer } from "./parse-json.js";
      export const read = (text: string) => parseJsonAnswer(text);
    `;
    const { problems } = census([{ path: "src/bare.ts", text: bare }], {});
    expect(problems).toEqual([
      "src/bare.ts calls parseJsonAnswer and attaches no schema to a request (withMessagesJsonSchema or withChatJsonSchema)",
    ]);
  });

  it.each([
    '(parseJsonAnswer as typeof parseJsonAnswer)(text)',
    'parseJsonAnswer!(text)',
    '(parseJsonAnswer satisfies typeof parseJsonAnswer)(text)',
    'json["parseJsonAnswer"](text)',
    'json?.["parseJsonAnswer"]?.(text)',
  ])("fails a bare parser call through %s", (call) => {
    const { callers, problems } = census([
      { path: "src/wrapped.ts", text: `export const read = (text: string) => ${call};` },
    ], {});
    expect(callers).toEqual({ "src/wrapped.ts": [] });
    expect(problems).toEqual([
      "src/wrapped.ts calls parseJsonAnswer and attaches no schema to a request (withMessagesJsonSchema or withChatJsonSchema)",
    ]);
  });

  it("does not treat a computed variable's name as the method it selects", () => {
    const text = `
      const parseJsonAnswer = "otherMethod";
      const json = { otherMethod: (text: string) => text };
      export const read = (text: string) => json[parseJsonAnswer](text);
    `;
    expect(census([{ path: "src/computed.ts", text }], {})).toEqual({ callers: {}, problems: [] });
  });

  it("fails a file that only validates a schema, which attaches nothing", () => {
    const validatorOnly = `
      import { parseJsonAnswer } from "./parse-json.js";
      import { validateAnthropicJsonSchema } from "./messages-structured-output.js";
      validateAnthropicJsonSchema(schema);
      export const read = (text: string) => parseJsonAnswer(text);
    `;
    const { problems } = census([{ path: "src/validator.ts", text: validatorOnly }], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("src/validator.ts calls parseJsonAnswer and attaches no schema");
  });

  it("does not count a mention in a comment, a string or an import as a call", () => {
    const mentions = `
      import { parseJsonAnswer } from "./parse-json.js";
      import { withChatJsonSchema } from "./messages-structured-output.js";
      // parseJsonAnswer(text) is what the caller does, not this file
      /* and withChatJsonSchema(body, schema) is in the caller too */
      export const note = "parseJsonAnswer(text)";
    `;
    expect(census([{ path: "src/m.ts", text: mentions }], {})).toEqual({ callers: {}, problems: [] });
    /* And a comment naming the decorator does not make a bare caller pass. */
    const commented = `
      // withChatJsonSchema(body, schema) would go here
      export const read = (text: string) => parseJsonAnswer(text);
    `;
    expect(census([{ path: "src/c.ts", text: commented }], {}).problems).toHaveLength(1);
  });

  it("fails an exception that has stopped calling the parser", () => {
    const { problems } = census([{ path: "src/gone.ts", text: "export const x = 1;" }], {
      "src/gone.ts": "a reason",
    });
    expect(problems).toEqual(["src/gone.ts is a named exception but does not call parseJsonAnswer"]);
  });

  it("fails an exception whose file is not there at all", () => {
    expect(census([], { "src/deleted.ts": "a reason" }).problems).toEqual([
      "src/deleted.ts is a named exception but does not call parseJsonAnswer",
    ]);
  });

  it("fails an exception that now attaches a schema", () => {
    const { problems } = census([{ path: "src/a.ts", text: decorated }], { "src/a.ts": "a reason" });
    expect(problems).toEqual(["src/a.ts is a named exception but now calls withMessagesJsonSchema"]);
  });

  it("reports a watched name imported under another name rather than losing it", () => {
    const renamed = `
      import { parseJsonAnswer as read } from "./parse-json.js";
      export const answer = (text: string) => read(text);
    `;
    const { problems } = census([{ path: "src/r.ts", text: renamed }], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("src/r.ts imports or exports parseJsonAnswer (line 2) under another name");
  });
});

describe("who parses a model's JSON answer under src/", () => {
  const files = sourcesUnder("src");
  const sources = files.map((file) => ({ path: file, text: readFileSync(path.join(ROOT, file), "utf8") }));
  const { callers, problems } = census(sources, EXCEPTIONS);

  it("scanned the tree and found the callers", () => {
    /* A walk that found no callers would have no problems to report either. */
    expect(files.length).toBeGreaterThan(200);
    expect(Object.keys(callers).length).toBeGreaterThanOrEqual(15);
    expect(callers["src/glossary.ts"]).toEqual(["withMessagesJsonSchema"]);
    const used = new Set(Object.values(callers).flat());
    for (const decorator of DECORATORS) expect(used, decorator).toContain(decorator);
  });

  it("puts a schema on the request in every one of them, bar the named exceptions", () => {
    /* If this is red because you added a stage: attach its schema with
       `withMessagesJsonSchema` (or `withChatJsonSchema` on the chat route), as
       docs/project/prompting-guide.md § What the model writes back describes.
       If the request really cannot carry one, add the file to `EXCEPTIONS`
       with the reason, and to the guide's list. */
    expect(problems).toEqual([]);
  });

  it("gives every exception a reason", () => {
    for (const [file, why] of Object.entries(EXCEPTIONS)) expect(why.length, file).toBeGreaterThan(40);
  });
});
