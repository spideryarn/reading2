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
  /**
   * **How the handler declares what it caught**, as the annotation's own
   * spelling — `"unknown"`, `"Error"`, or `null` for no annotation at all.
   *
   * React's own types say `componentDidCatch(error: Error, …)` and the runtime
   * does not enforce a word of it, so the parameter's type is a claim nothing
   * checks. Written as `Error` it makes `error.name` **compile**, and the only
   * thing standing between that and a `TypeError` thrown out of the handler is
   * the sweep below — a check that has to be kept in sync, and that a fourth
   * boundary written tomorrow joins only if somebody remembers this file.
   *
   * Written as `unknown` the compiler refuses the read outright, which is the
   * same guarantee held one layer lower and by a mechanism that cannot be
   * forgotten. So this is the belt to the sweep's braces, and it is the half
   * that scales.
   */
  declared: string | null;
}

/** The annotation's spelling, for the assertion and for the message. */
function declaredType(param: AstNode | undefined): string | null {
  const annotation = (param?.typeAnnotation as AstNode | undefined)?.typeAnnotation as
    | AstNode
    | undefined;
  if (!annotation) return null;
  if (annotation.type === "TSUnknownKeyword") return "unknown";
  if (annotation.type === "TSTypeReference") {
    const name = annotation.typeName as AstNode | undefined;
    return name?.type === "Identifier" ? ((name.name as string) ?? "?") : "?";
  }
  /* Anything else — `any`, a union, an intersection — is neither the safe
     spelling nor the known-bad one, so it is reported as itself rather than
     quietly passed. */
  return typeof annotation.type === "string" ? annotation.type : "?";
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

/**
 * The expression under any wrapper that does not change what is being read.
 *
 * **`(error as Error).name` is the bypass this closes**, and it is the one a
 * reader reaches for the moment the parameter becomes `unknown` — the cast is
 * how you make the compiler stop complaining, and it puts the hazard back
 * exactly as it was. A parenthesised expression and a `!` are the same move
 * spelled differently. GPT Sol, 2026-09-07, F7.
 */
function unwrap(node: unknown): unknown {
  let current = node;
  for (;;) {
    const n = current as AstNode | null;
    if (!n || typeof n !== "object") return current;
    if (
      n.type === "TSAsExpression" ||
      n.type === "TSTypeAssertion" ||
      n.type === "TSNonNullExpression" ||
      n.type === "ParenthesizedExpression"
    ) {
      current = n.expression;
      continue;
    }
    return current;
  }
}

/** `error.name` and `error?.["message"]`, as a complaint or `null`. */
function memberRead(node: AstNode, params: readonly string[]): string | null {
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return null;
  const object = unwrap(node.object);
  const param = params.find((name) => isParam(object, name));
  if (param === undefined) return null;
  const property = staticProperty(node);
  return property !== null && FORBIDDEN.has(property) ? `${param}.${property}` : null;
}

/**
 * The names that are the caught value: the parameter, and anything simply
 * assigned from it.
 *
 * **One level, and deliberately no further.** `const caught = error;` then
 * `caught.name` is the other bypass Sol demonstrated, and it costs ten lines to
 * close. Following the value through calls, properties or reassignment is
 * data-flow analysis, which is a different and much larger thing; this test is
 * the belt to `strict`'s braces and does not need to be a compiler. What it
 * must not do is *claim* more than it checks — see the assertion's own note.
 */
function aliasesOf(body: unknown, param: string): string[] {
  const names = [param];
  walkAst(body, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = node.id as AstNode | undefined;
    if (id?.type !== "Identifier") return;
    if (names.some((name) => isParam(unwrap(node.init), name))) names.push(id.name as string);
  });
  return names;
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
      /* **A quoted or computed key is the same method.** `"componentDidCatch"(…)`
         and `["componentDidCatch"](…)` are both legal and both were invisible
         here until 2026-09-07 — a handler that the sweep does not find is a
         handler the sweep says nothing about, which looks exactly like a clean
         one. GPT Sol, F7. */
      const named =
        (key?.type === "Identifier" && key.name === "componentDidCatch") ||
        (key?.type === "StringLiteral" && key.value === "componentDidCatch");
      if (!named) return;
      /* A class *property* holding an arrow function keeps its parameters on the
         value, not on the node. Reading both means an arrow-spelled handler is
         examined rather than silently reported as having no parameter. */
      const value = node.value as AstNode | undefined;
      const params =
        (node.params as AstNode[] | undefined) ??
        (value?.type === "ArrowFunctionExpression" || value?.type === "FunctionExpression"
          ? (value.params as AstNode[] | undefined)
          : undefined);
      const first = params?.[0];
      /* No named first parameter means nothing to read it off. A destructured
         one — `componentDidCatch({ name })` — is the bug written differently,
         and is caught by the pattern check below rather than by this. */
      const param = first?.type === "Identifier" ? (first.name as string) : null;
      const reads: string[] = [];
      if (first?.type === "ObjectPattern") {
        reads.push(`${file}:${lineOf(first)} — destructured in the parameter list`);
      }
      if (param !== null) {
        /* The body is the method's, or the arrow's when the handler is written
           as a class property. */
        const body =
          node.body ??
          (value?.type === "ArrowFunctionExpression" || value?.type === "FunctionExpression"
            ? value.body
            : undefined);
        const names = aliasesOf(body, param);
        walkAst(body, (inner) => {
          const member = memberRead(inner, names);
          if (member !== null) reads.push(`${file}:${lineOf(inner)} — ${member}`);
          for (const name of names) {
            for (const { at, what } of destructuredReads(inner, name)) {
              reads.push(`${file}:${lineOf(at)} — ${what}`);
            }
          }
        });
      }
      found.push({
        file,
        param: param ?? "(not an identifier)",
        reads,
        declared: declaredType(first),
      });
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

  it("declares what it caught as `unknown`, so the compiler refuses the read", () => {
    /* **What this buys, said exactly, because the tempting phrasing is wrong.**
       It is *not* that the typechecker replaces the sweep: this assertion runs
       off the same `handlers()` walk as the one above, so a boundary the walk
       cannot see is a boundary neither of them says anything about. The
       sequence is — the sweep finds a conventional handler, this forces its
       parameter to be literally `unknown`, and only then does `strict` refuse an
       un-narrowed `.name` anywhere inside it, including in code no assertion
       here inspects. The last step is the one that scales; the first two are
       still this file's job. GPT Sol, 2026-09-07, F8.

       And this checks a **spelling**, not a resolved type. `error: Thrown` where
       `type Thrown = unknown` is rejected though it is sound, which is the safe
       direction. A cast (`(error as Error).name`) and a one-step alias are
       handled in `memberRead` and `aliasesOf`; a value carried further than that
       is not, and `strict` is what catches it.

       Named rather than counted, and reported with the spelling that was found,
       because "expected 3 to be 0" sends somebody to the wrong question. The fix
       is one word: `error: unknown`. Nothing else in the handler changes —
       `nameOfThrown` and `captureClientFailure` both already take `unknown`. */
    expect(
      found
        .filter((handler) => handler.declared !== "unknown")
        .map((handler) => `${handler.file} — ${handler.param}: ${handler.declared ?? "(none)"}`),
    ).toEqual([]);
  });
});
