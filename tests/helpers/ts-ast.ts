/**
 * Parse TypeScript and walk it — for the tests whose subject is the **source**
 * rather than what it does.
 *
 * There are a handful of rules here that no type and no runtime check can carry:
 * *nothing may spend money without declaring it*
 * (tests/no-undeclared-spend.test.ts), *nothing may call stage 3 without its
 * baseline* (tests/blocks-baseline.test.ts). Each of those has to look at every
 * file in the repo and ask a question about the code as written.
 *
 * **Why a parser and not a regular expression.** Both of those checks began as
 * character scans and both were wrong in both directions: a needle matched
 * inside a comment (a complaint about code that does not exist), and a bracket
 * or a comma inside a string literal desynchronised the scan (a call that
 * quietly stopped being examined). The second is the one that matters — a gate
 * that goes quiet is worse than one that goes red, docs/reusable/silent-success.md.
 *
 * **Why `@babel/parser`.** This repo is on TypeScript 7, whose package no longer
 * exposes `createSourceFile`, so there is no in-process TypeScript AST to use.
 * `@babel/parser` is a **direct** dev dependency for exactly this reason — see
 * the header of tests/no-undeclared-spend.test.ts, which is where that argument
 * was had. That file has its own copy of these two functions, with commentary
 * about its own problem; this is the copy a new caller should take.
 */
import { type ParseResult, parse } from "@babel/parser";
import type { File } from "@babel/types";

/** Babel's options, in one place — TS and TSX both. */
export function parseSource(source: string): ParseResult<File> {
  return parse(source, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    /* Recovery rather than a throw, for two reasons. A file this cannot parse
       must not make a gate *pass* by exploding somewhere the caller catches;
       and the fixtures these checks are exercised on are fragments rather than
       whole modules. Callers that care can read `errors`. */
    errorRecovery: true,
    plugins: ["typescript", "jsx", "decorators-legacy", "explicitResourceManagement"],
  });
}

export type AstNode = Record<string, unknown>;

/**
 * Every node, once, with the parent it hangs off and the field it hangs in.
 *
 * The parent is what tells an identifier that *is* a call from one that is
 * merely the name of a call, and an import specifier from a use. Comments are
 * attached to nodes as `leadingComments` and friends and are skipped, which is
 * the whole reason a caller can stop worrying about them.
 */
export function walkAst(
  node: unknown,
  visit: (n: AstNode, parent: AstNode | null, key: string) => void,
  parent: AstNode | null = null,
  key = "",
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit, parent, key);
    return;
  }
  const n = node as AstNode;
  if (typeof n.type !== "string") return;
  visit(n, parent, key);
  for (const [field, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(field)) continue;
    walkAst(value, visit, n, field);
  }
}

const SKIP_KEYS = new Set([
  "loc",
  "range",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "extra",
]);

/** The 1-based line a node starts on, for a message somebody has to act on. */
export function lineOf(node: AstNode): number {
  return (node.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0;
}

/**
 * **A dynamic `import()` whose specifier is not a string literal**, which every
 * guard that walks an import graph has to refuse rather than skip.
 *
 * `import(expr)` is a real edge — it executes a module — but the walker cannot
 * say *which* module, so a graph built past one is a graph with a hole in it,
 * and the hole is exactly the shape somebody reaches for when the literal will
 * not pass. GPT Sol demonstrated it on 2026-09-06 (F21): two lines in
 * `src/web/modes/ideas/IdeasMode.tsx` —
 *
 * ```ts
 * const target = "../../App.js";
 * void import(target);
 * ```
 *
 * — left all three assertions in `tests/reader-import-direction.test.ts` green,
 * the eager-graph guard green and Vite's build happy, while the acceptance
 * criterion for the whole refactor ("a feature module may not import the
 * composition above it") was being broken on the line above. Every one of those
 * guards collected string-literal specifiers only, so a computed one was
 * invisible rather than rejected.
 *
 * So: **fail closed**. A guard that cannot see where an edge lands must go red,
 * not quiet — docs/reusable/silent-success.md. Resolving one properly is not
 * possible in general (the value can come from anywhere), and pretending
 * otherwise is what the old behaviour did.
 *
 * There is no allowlist and there should not need to be: a repo-wide scan on
 * 2026-09-06 found exactly **one** non-literal dynamic import in 1,369 source
 * files — `tests/store-guarded.test.ts`, iterating a table of store modules,
 * which no import-graph guard scans. If a legitimate one ever appears inside a
 * scanned tree, name it in an explicit allowlist at that guard with the reason
 * beside it, rather than softening this.
 *
 * A template literal with no substitutions (`` import(`./x.js`) ``) *is*
 * statically known and is accepted, with its cooked value; anything else — an
 * identifier, a concatenation, a template with a hole, a conditional — is not.
 */
export interface UntraceableImport {
  /** 1-based, so the message names a line somebody can open. */
  line: number;
  /** The babel node type of the argument, e.g. `Identifier`. */
  argType: string;
}

/**
 * The specifier of a dynamic `import()`, as a static string, or a refusal.
 *
 * `null` when `n` is not a dynamic import at all. Babel gives `import(…)` as an
 * `ImportExpression` on this version and as a `CallExpression` with an `Import`
 * callee on others, so both are read — the same two spellings the graph guards
 * already handle.
 */
export function dynamicImportSpec(
  n: AstNode,
): { spec: string } | { spec: null; argType: string } | null {
  let arg: unknown;
  if (n.type === "ImportExpression") arg = n.source;
  else if (n.type === "CallExpression" && (n.callee as AstNode | undefined)?.type === "Import")
    arg = (n.arguments as unknown[] | undefined)?.[0];
  else return null;
  if (!arg || typeof arg !== "object") return { spec: null, argType: "missing" };
  const node = arg as AstNode;
  if (node.type === "StringLiteral" && typeof node.value === "string") return { spec: node.value };
  if (node.type === "TemplateLiteral") {
    const quasis = (node.quasis ?? []) as AstNode[];
    const expressions = (node.expressions ?? []) as unknown[];
    const cooked = (quasis[0]?.value as { cooked?: unknown } | undefined)?.cooked;
    if (quasis.length === 1 && expressions.length === 0 && typeof cooked === "string") {
      return { spec: cooked };
    }
  }
  return { spec: null, argType: String(node.type) };
}

/** Every dynamic `import()` under `node` whose specifier cannot be named. */
export function untraceableDynamicImports(node: unknown): UntraceableImport[] {
  const found: UntraceableImport[] = [];
  walkAst(node, (n) => {
    const dyn = dynamicImportSpec(n);
    if (dyn && dyn.spec === null) found.push({ line: lineOf(n), argType: dyn.argType });
  });
  return found;
}

/**
 * Throw if any dynamic `import()` under `node` has a specifier this cannot name.
 *
 * `guard` is the file the reader has to go and teach, so the message says where
 * the decision lives rather than only what went wrong.
 */
export function refuseUntraceableImports(node: unknown, relPath: string, guard: string): void {
  const found = untraceableDynamicImports(node);
  if (found.length === 0) return;
  const where = found.map((f) => `${relPath}:${f.line} (import(<${f.argType}>))`).join("\n  ");
  throw new Error(
    `Dynamic import() with a specifier that is not a string literal:\n  ${where}\n` +
      `${guard} builds an import graph from the source, and it cannot see where that ` +
      "edge lands — so it refuses the file rather than reporting a graph nobody read. " +
      "Write the specifier as a literal, or add an explicit, commented allowlist entry " +
      "in that guard saying why this one is safe.",
  );
}

/** The same refusal, for a caller that has the text rather than an AST. */
export function refuseUntraceableImportsInSource(
  source: string,
  relPath: string,
  guard: string,
): void {
  /* A cheap pre-filter: parsing every file in a repo-wide sweep costs more than
     the check is worth, and `import` followed by `(` — across whitespace and
     newlines both — is a superset of every dynamic import there is. It
     over-matches into comments and strings, which only costs a parse. */
  if (!/\bimport\s*\(/.test(source)) return;
  refuseUntraceableImports(parseSource(source).program, relPath, guard);
}
