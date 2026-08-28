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
