/**
 * **No `componentDidCatch` may read `.name` or `.message` off what it caught.**
 *
 * `componentDidCatch(error: Error, …)` is a signature React does not enforce.
 * The handler is handed the thrown value unchanged, so `throw null`,
 * `throw "nope"` and an object whose `name` getter throws all arrive there — and
 * a handler that reads the parameter throws a *second* time, out of itself. That
 * is not one bug in one boundary: it is the shape of every boundary anybody
 * writes from the type signature, and all three in this repo had it on
 * 2026-09-05. Sol, 2026-09-06, F15.
 *
 * The behavioural half is
 * tests/every-boundary-contains-a-throw-that-is-not-an-error.test.tsx, which
 * mounts each of the three and gives it a `throw null`. That half cannot cover
 * the *fourth* boundary, which does not exist yet, so this half reads the source
 * instead: the one safe read is `nameOfThrown` (src/web/log-buffer.ts), and this
 * goes red naming any handler that does its own.
 *
 * **Why a parser and not a regular expression**: tests/helpers/ts-ast.ts makes
 * the argument in full, and the short version is that two thirds of the text in
 * these three handlers is prose *about* `error.name`. A scan would fail on the
 * comments that explain the rule.
 *
 * Only `src/web/` is swept: a boundary is a React component, and the server has
 * no React.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lineOf, parseSource, walkAst, type AstNode } from "./helpers/ts-ast.js";

/** The fields whose read is the bug. Both are `Error`'s, and neither is safe. */
const FORBIDDEN = new Set(["name", "message"]);

/**
 * The three that exist today.
 *
 * Named rather than counted, so that a sweep which quietly stopped finding
 * anything — a Babel option that drifted, a directory that moved — goes red
 * instead of passing over nothing at all. docs/reusable/silent-success.md.
 */
const KNOWN_BOUNDARIES = [
  "src/web/AppBoundary.tsx",
  "src/web/FeatureBoundary.tsx",
  "src/web/LazyPage.tsx",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

interface Handler {
  file: string;
  /** What the handler calls the value it caught — almost always `error`. */
  param: string;
  /** `"file:line — error.name"`, one per forbidden read. */
  reads: string[];
}

/** Is `node` the identifier `param`, read as a value? */
const isParam = (node: unknown, param: string): boolean =>
  !!node &&
  typeof node === "object" &&
  (node as AstNode).type === "Identifier" &&
  (node as AstNode).name === param;

/** The property a member expression names, or `null` if it is computed. */
function staticProperty(node: AstNode): string | null {
  const property = node.property as AstNode | undefined;
  if (!property) return null;
  if (node.computed === true) {
    return property.type === "StringLiteral" ? ((property.value as string) ?? null) : null;
  }
  return property.type === "Identifier" ? ((property.name as string) ?? null) : null;
}

/** `error.name` and `error?.["message"]`, as a complaint or `null`. */
function memberRead(node: AstNode, param: string): string | null {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return null;
  if (!isParam(node.object, param)) return null;
  const property = staticProperty(node);
  return property !== null && FORBIDDEN.has(property) ? `${param}.${property}` : null;
}

/** `const { name } = error`, which reads exactly the same field. */
function destructuredReads(node: AstNode, param: string): { at: AstNode; what: string }[] {
  if (node.type !== "VariableDeclarator") return [];
  const id = node.id as AstNode | undefined;
  if (id?.type !== "ObjectPattern" || !isParam(node.init, param)) return [];
  const out: { at: AstNode; what: string }[] = [];
  for (const property of (id.properties as AstNode[] | undefined) ?? []) {
    const key = property.key as AstNode | undefined;
    if (key?.type === "Identifier" && FORBIDDEN.has(key.name as string)) {
      out.push({ at: property, what: `destructured ${key.name as string}` });
    }
  }
  return out;
}

/** Every `componentDidCatch` under `src/web/`, with the reads it should not make. */
function handlers(): Handler[] {
  const found: Handler[] = [];
  for (const file of sourceFiles("src/web")) {
    const source = readFileSync(file, "utf8");
    /* Cheap gate before the parse, and safe because a false positive here only
       costs a parse — the AST is what decides. */
    if (!source.includes("componentDidCatch")) continue;
    walkAst(parseSource(source), (node) => {
      if (node.type !== "ClassMethod" && node.type !== "ClassProperty") return;
      const key = node.key as AstNode | undefined;
      if (key?.type !== "Identifier" || key.name !== "componentDidCatch") return;
      const first = (node.params as AstNode[] | undefined)?.[0];
      /* No named first parameter means nothing to read it off. A destructured
         one — `componentDidCatch({ name })` — is the bug written differently,
         and is caught by the pattern check below rather than by this. */
      const param = first?.type === "Identifier" ? (first.name as string) : null;
      const reads: string[] = [];
      if (first?.type === "ObjectPattern") {
        reads.push(`${file}:${lineOf(first)} — destructured in the parameter list`);
      }
      if (param !== null) {
        walkAst(node.body, (inner) => {
          const member = memberRead(inner, param);
          if (member !== null) reads.push(`${file}:${lineOf(inner)} — ${member}`);
          for (const { at, what } of destructuredReads(inner, param)) {
            reads.push(`${file}:${lineOf(at)} — ${what}`);
          }
        });
      }
      found.push({ file, param: param ?? "(not an identifier)", reads });
    });
  }
  return found;
}

describe("no error boundary reads the value it caught", () => {
  const found = handlers();

  it("finds every boundary there is", () => {
    /* The positive control. Everything below is an assertion that a list is
       empty, and an empty list is also what a sweep that examined no files
       produces. */
    expect(found.map((handler) => handler.file).sort()).toEqual(
      expect.arrayContaining(KNOWN_BOUNDARIES),
    );
    expect(found.length).toBeGreaterThanOrEqual(KNOWN_BOUNDARIES.length);
  });

  it("goes through nameOfThrown instead", () => {
    /* Named rather than counted, so a red line says which handler to fix and
       what it did — the fix is `nameOfThrown(error)` from
       src/web/log-buffer.ts, and there is no case for a second one. */
    expect(found.flatMap((handler) => handler.reads)).toEqual([]);
  });
});
