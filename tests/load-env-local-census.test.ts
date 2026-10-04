/**
 * Every `loadEnvLocal()` call under `src/`, by file, by enclosing function and
 * by count, against a short list with a reason beside each.
 *
 * ## The rule
 *
 * Loading `.env.local` belongs at the program's edge: a CLI's `main`, or the
 * one module every server process imports first. A **library** function that
 * re-reads the file hands back a key a test deleted on purpose, and a paid call
 * follows. That is not a guess. It is how `messagesClient` came to make a live
 * call from a test (src/messages-stream.ts), and why `apiKey()` in
 * src/ai-call.ts says in capitals that it does not do it.
 *
 * Until 2026-10-04 nine request-path functions did it anyway: the seven
 * streaming runners' key pre-checks, `transcribe` and `apiKeyFromEnv` in
 * src/embeddings.ts. It was harmless only because src/db/client.ts calls it at
 * import and it latches. The nine were deleted (plan 261004c § R3), and this is
 * what keeps a tenth from arriving.
 *
 * ## Why it counts calls and names the function
 *
 * A set of file names would not do it ⟨GPT Sol, reviewing the plan, F2⟩.
 * src/pdf-read.ts is on the list for the call in its CLI `main`, and a second
 * call added inside its request path would leave the set of names unchanged. So
 * each entry is the list of functions the calls sit in, and a second call in
 * the same file, or the same call moved into another function, is a diff.
 *
 * ## Why a parser
 *
 * A dozen comments under `src/` contain the text `loadEnvLocal()`, most of them
 * explaining why it is not called there. tests/helpers/ts-ast.ts says the rest.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSource } from "./helpers/ts-ast.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Where the calls are allowed to be: file, then the function each one sits in. */
const ALLOWED: Record<string, { where: string[]; why: string }> = {
  "src/env.ts": {
    where: ["resolveTargetUrl"],
    why: "The module that defines it. `resolveTargetUrl` answers which of the file and the shell wins for a database script, so it has to have read the file; it is called from scripts, never from a request.",
  },
  "src/db/client.ts": {
    where: ["<module>", "databaseUrl"],
    why: "The edge for every server process: the call at import is the one that latches, before any other module can read the environment. `databaseUrl` repeats it for a caller that reached the pool some other way; it memoises.",
  },
  "src/cli-ledger.ts": {
    where: ["stageCli"],
    why: "The shared entry for the stage CLIs: it runs only when the calling module is the entry file, before the ledger opens.",
  },
  "src/pdf-read.ts": {
    where: ["main"],
    why: "Its own CLI `main`, before the first `await`. Nothing in its request path may call it.",
  },
};

interface Call {
  file: string;
  where: string;
  line: number;
}

type Node = Record<string, unknown>;

const SKIP = new Set(["loc", "range", "leadingComments", "trailingComments", "innerComments", "comments", "extra"]);
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const nameOf = (n: unknown): string | null => {
  const id = n as { type?: string; name?: string } | null | undefined;
  return id?.type === "Identifier" && typeof id.name === "string" ? id.name : null;
};

/**
 * Every executable call of `loadEnvLocal` in one source text, with the nearest
 * enclosing function's name, or `<module>` for a call at the top level.
 *
 * A rename on import or export is reported as a forbidden site, so a caller
 * cannot walk past this using the new name: the scan only knows the one name.
 */
function callsIn(file: string, source: string): Call[] {
  const found: Call[] = [];
  const visit = (node: unknown, enclosing: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, enclosing);
      return;
    }
    const n = node as Node;
    if (typeof n.type !== "string") return;
    const line = (n.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0;

    if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
      const callee = n.callee as Node | undefined;
      const direct = nameOf(callee) === "loadEnvLocal";
      const member =
        (callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression") &&
        nameOf(callee.property) === "loadEnvLocal";
      if (direct || member) found.push({ file, where: enclosing, line });
    }
    if (n.type === "ImportSpecifier" && nameOf(n.imported) === "loadEnvLocal" && nameOf(n.local) !== "loadEnvLocal") {
      found.push({ file, where: "<renamed import>", line });
    }
    if (n.type === "ExportSpecifier" && nameOf(n.local) === "loadEnvLocal" && nameOf(n.exported) !== "loadEnvLocal") {
      found.push({ file, where: "<renamed export>", line });
    }

    let inside = enclosing;
    if (FUNCTIONS.has(n.type)) inside = nameOf(n.id) ?? nameOf(n.key) ?? "<anonymous>";
    for (const [field, value] of Object.entries(n)) {
      if (SKIP.has(field)) continue;
      /* `const f = () => …` and `const f = function () …`: the name is on the
         declarator, one level up from the function. */
      if (n.type === "VariableDeclarator" && field === "init") {
        const init = value as Node | null;
        if (init && typeof init.type === "string" && FUNCTIONS.has(init.type) && !nameOf(init.id)) {
          const named = nameOf(n.id) ?? "<anonymous>";
          for (const [f2, v2] of Object.entries(init)) if (!SKIP.has(f2)) visit(v2, named);
          continue;
        }
      }
      visit(value, inside);
    }
  };
  visit(parseSource(source).program, "<module>");
  return found;
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

describe("the scanner itself", () => {
  it("sees a call and where it is, and does not see a comment, a string or the definition", () => {
    const source = `
      import { loadEnvLocal } from "./env.js";
      // loadEnvLocal() in a comment
      /* and loadEnvLocal() in another */
      const text = "loadEnvLocal()";
      export function loadEnvLocal(): void {}
      loadEnvLocal();
      export async function* runner() { loadEnvLocal(); }
      const arrow = async () => { env.loadEnvLocal(); };
      class K { method() { loadEnvLocal(); } }
      function main() { [1].forEach(() => loadEnvLocal()); }
    `;
    expect(callsIn("x.ts", source).map((c) => c.where)).toEqual([
      "<module>",
      "runner",
      "arrow",
      "method",
      "<anonymous>",
    ]);
  });

  it("reports an import under another name rather than losing it", () => {
    const source = `import { loadEnvLocal as load } from "./env.js"; export function f() { load(); }`;
    expect(callsIn("x.ts", source).map((c) => c.where)).toEqual(["<renamed import>"]);
  });

  it("reports a renamed re-export before a caller can import it under that name", () => {
    const source = `export { loadEnvLocal as bootEnv } from "./env.js";`;
    expect(callsIn("x.ts", source).map((c) => c.where)).toEqual(["<renamed export>"]);
  });
});

describe("where `.env.local` is loaded under src/", () => {
  const files = sourcesUnder("src");
  const calls = files.flatMap((file) => callsIn(file, readFileSync(path.join(ROOT, file), "utf8")));

  it("scanned the tree", () => {
    /* A walk that found nothing would agree with any allowlist that was empty,
       and disagree with this one for a reason that looks like a real finding. */
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("src/ai-call.ts");
    expect(files).toContain("src/db/client.ts");
  });

  it("is exactly the edges on the list, call for call", () => {
    const actual: Record<string, string[]> = {};
    for (const call of calls) actual[call.file] = [...(actual[call.file] ?? []), call.where];
    for (const where of Object.values(actual)) where.sort();
    const expected = Object.fromEntries(
      Object.entries(ALLOWED).map(([file, { where }]) => [file, [...where].sort()]),
    );
    /* If this is red because you added a call: a request path must not load the
       file (the header says why). Load it at the entry point that reaches your
       code instead. If you added a new entry point under src/, add it to
       `ALLOWED` with its function and its reason. */
    expect(actual).toEqual(expected);
  });

  it("gives every entry a reason", () => {
    for (const [file, { why }] of Object.entries(ALLOWED)) expect(why.length, file).toBeGreaterThan(40);
  });
});
