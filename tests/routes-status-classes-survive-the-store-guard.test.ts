/**
 * **Every class the API's status chain matches must survive `guardDbStore`.**
 *
 * ## The bug this is the check for
 *
 * `src/routes.ts` ends its request handler with a chain that turns a thrown
 * value into an HTTP status, and part of that chain is `err instanceof X`. That
 * only works if the error reaching the chain is still an `X` — and behind
 * Postgres it need not be. `guardDbStore` (src/store/db-errors.ts) replaces
 * whatever a store throws with a generic scrubbed `StoreFailure`, *unless*
 * `mayPassThrough` lets it by. So a refusal thrown inside a guarded store, whose
 * class is not on that allowlist and which carries no numeric `status`, arrives
 * at the chain as something else entirely and falls through to **500**.
 *
 * That happened on 2026-08-28 to `CommentIdTaken` (a 409) and `NotAnExplanation`
 * (a 404 or a 409), and it was invisible for the reason
 * docs/postmortems/260901d-a-409-and-a-404-arrived-as-500.md gives: **there is
 * no wrong-looking state.** A 500 has a message, a status line and a stack.
 * Nothing anywhere prints "expected 409". The tests that should have caught it
 * were green, because they drove the *other* store adapter, which had no wrapper
 * on it.
 *
 * That postmortem asks for exactly this file, under *What would have caught the
 * whole class*, item 4 — *"a static check that the two lists agree … it is the
 * only one of the three that cannot be forgotten. Not built"*. This is it.
 *
 * ## What "agree" means, precisely
 *
 * For every class the status chain matches, one of:
 *
 * 1. it is named in `mayPassThrough`'s own `err instanceof …` list; or
 * 2. it declares a **numeric, non-nullable** `status`, which is the last line of
 *    `mayPassThrough` (`typeof err?.status === "number"`).
 *
 * **Non-nullable is the whole point of the second clause, and the postmortem's
 * own wording would have got it wrong.** It says "or declare a numeric
 * `status`". `EmbeddingFailure` (src/embeddings.ts) declares
 * `readonly status: number | null` — it has the field, and `null` still fails
 * `typeof … === "number"`. A check written to the loose wording would wave that
 * class through and be blind to precisely the way this bug next recurs.
 *
 * ## Why it looks at the status chain and not at every `instanceof`
 *
 * The first draft of this check swept every `instanceof` in `src/routes.ts` and
 * consequently needed an exemption list, because two of the five are **local
 * translations** that never reach the generic chain: `sendExport` turns an
 * `ArticleNotFound` into a 404 in its own `catch`, and `embeddingHttpError`
 * converts an `EmbeddingFailure` before the handler ever sees it. Neither is
 * part of the class-to-status map, so exempting them was answering a question
 * nobody asked — and an exemption list is a second allowlist with the same
 * failure mode as the first, which is the trap this file exists to close rather
 * than to reproduce. GPT Sol, 2026-09-07, F3.
 *
 * So the subject is "a class mapped to a status **in the chain**": an
 * `instanceof` inside the initialiser of a variable called `status`. Local
 * translations are out of scope by construction, and there is nothing to exempt.
 *
 * ## Why a parser and not a regular expression
 *
 * tests/helpers/ts-ast.ts makes the argument in full. The short version, and it
 * is not hypothetical here: `src/routes.ts` and `src/store/db-errors.ts` both
 * discuss `mayPassThrough` and these class names at length **in prose**, so a
 * text scan would match the commentary and report classes that no code matches.
 */
import { readFileSync } from "node:fs";
import { posix } from "node:path";

import { describe, expect, it } from "vitest";

import { lineOf, parseSource, walkAst, type AstNode } from "./helpers/ts-ast.js";

const ROUTES = "src/routes.ts";
const GUARD = "src/store/db-errors.ts";

/**
 * The three the chain matches today.
 *
 * Named rather than counted, so that a sweep which quietly stopped finding
 * anything — the chain restructured, the variable renamed, a Babel option that
 * drifted — goes red instead of passing over nothing at all. Every assertion
 * below is that a list is *empty*, and an empty list is also what a check that
 * examined nothing produces. docs/reusable/silent-success.md.
 */
const KNOWN_MAPPED = ["ChatConflict", "CommentIdTaken", "NotAnExplanation"];

/**
 * **The helpers below take source text, not paths, and that is deliberate.**
 *
 * A check like this one is green the day it is written — the tree already
 * agrees, which is the point — so "it passes" is worth nothing on its own, and
 * the only evidence that it *discriminates* is watching it go red. Proving that
 * by editing `src/comments.ts` and putting it back is a one-off somebody has to
 * take on trust afterwards; feeding the same functions a crafted disagreement is
 * a control that runs for ever. § *the check itself* at the bottom is that
 * control. docs/reusable/silent-success.md.
 */
/* `unknown` rather than a cast to `AstNode`: `walkAst` takes `unknown` and does
   its own narrowing, so asserting a shape here would be claiming something the
   parser does not promise. */
const parse = (source: string): unknown => parseSource(source);
const read = (file: string): string => readFileSync(file, "utf8");

/** `x instanceof Y` → `"Y"`, for a plain named right-hand side. */
function instanceOfClass(node: AstNode): string | null {
  if (node.type !== "BinaryExpression" || node.operator !== "instanceof") return null;
  const right = node.right as AstNode | undefined;
  return right?.type === "Identifier" ? ((right.name as string) ?? null) : null;
}

/**
 * Every class matched by an `instanceof` inside a `status` initialiser.
 *
 * Deliberately keyed on the *variable name*, because that is what the subject
 * actually is — "the value we answer with". `const status = … ?? (err instanceof
 * X ? 409 : null) ?? …` is the shape, and anything else that computes a status
 * from a class the same way is caught by the same rule without this file having
 * to know where it lives.
 */
function mappedToAStatus(source: string): { klass: string; line: number }[] {
  const found: { klass: string; line: number }[] = [];
  walkAst(parse(source), (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = node.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== "status") return;
    walkAst(node.init, (inner) => {
      const klass = instanceOfClass(inner);
      if (klass !== null) found.push({ klass, line: lineOf(inner) });
    });
  });
  return found;
}

/**
 * The class names `mayPassThrough` lets by — and **only in the form that lets
 * them by**.
 *
 * `if (err instanceof X) return true;` and nothing else. The first version of
 * this collected every `instanceof` anywhere under the function, which reads the
 * allowlist as a list of names that appear near it rather than a list of classes
 * it admits — so all four of these would have wrongly certified `Unsafe`:
 *
 * ```ts
 * if (err instanceof Unsafe) return false;      // refused, not admitted
 * if (!(err instanceof Unsafe)) return true;    // admits everything else
 * const inspect = () => err instanceof Unsafe;  // a nested scope, no return
 * if (err.cause instanceof Unsafe) { … }        // a different left operand
 * ```
 *
 * A false positive here is the whole failure this file exists to prevent, wearing
 * the check's own badge: a class certified as passing the guard that the guard
 * actually scrubs. So the shape is matched exactly — the left operand must be the
 * function's own parameter, the consequent must `return true`, and nested
 * functions are not descended into. GPT Sol, 2026-09-07, F8.
 */
function allowlisted(source: string): string[] {
  const names: string[] = [];
  walkAst(parse(source), (node) => {
    if (node.type !== "FunctionDeclaration") return;
    const id = node.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== "mayPassThrough") return;
    const param = (node.params as AstNode[] | undefined)?.[0];
    const caught = param?.type === "Identifier" ? (param.name as string) : null;
    if (caught === null) return;
    /* The statement list directly, not a walk: a walk would descend into an
       arrow function's body, which is a scope this function never evaluates as
       a decision. */
    for (const statement of ((node.body as AstNode | undefined)?.body as AstNode[] | undefined) ??
      []) {
      if (statement.type !== "IfStatement") continue;
      const test = statement.test as AstNode | undefined;
      if (!test) continue;
      const klass = instanceOfClass(test);
      if (klass === null) continue;
      /* `err instanceof X`, not `err.cause instanceof X` or anything else. */
      const left = test.left as AstNode | undefined;
      if (left?.type !== "Identifier" || left.name !== caught) continue;
      if (returnsTrue(statement.consequent)) names.push(klass);
    }
  });
  return names;
}

/** `return true;`, or a block whose only statement is one. */
function returnsTrue(node: unknown): boolean {
  const n = node as AstNode | null;
  if (!n || typeof n !== "object") return false;
  if (n.type === "BlockStatement") {
    const body = (n.body as AstNode[] | undefined) ?? [];
    return body.length === 1 && returnsTrue(body[0]);
  }
  if (n.type !== "ReturnStatement") return false;
  const argument = n.argument as AstNode | undefined;
  return argument?.type === "BooleanLiteral" && argument.value === true;
}

/**
 * What a local name in a file actually refers to: `{ module, exported }`.
 *
 * **Because a name is not an identity.** `import { Unsafe as ChatConflict }` in
 * `src/routes.ts` would be certified by the guard's genuine `ChatConflict`
 * branch if the two lists were compared as text — the allowlist would be
 * vouching for a class it has never seen. So a match on the allowlist has to
 * agree about the *binding*, not the spelling. GPT Sol, 2026-09-07, F8.
 *
 * `null` for anything not imported from a relative path — a class declared in
 * the file itself, or one from `node_modules` — which the callers treat as
 * unresolvable and therefore red.
 */
function bindingOf(source: string, file: string, local: string): string | null {
  let binding: string | null = null;
  walkAst(parse(source), (node) => {
    if (node.type !== "ImportDeclaration") return;
    const value = (node.source as AstNode | undefined)?.value;
    if (typeof value !== "string" || !value.startsWith(".")) return;
    for (const specifier of (node.specifiers as AstNode[] | undefined) ?? []) {
      if (specifier.type !== "ImportSpecifier") continue;
      const localNode = specifier.local as AstNode | undefined;
      if (localNode?.type !== "Identifier" || localNode.name !== local) continue;
      const imported = specifier.imported as AstNode | undefined;
      const exported =
        imported?.type === "Identifier"
          ? (imported.name as string)
          : imported?.type === "StringLiteral"
            ? (imported.value as string)
            : local;
      /* Resolved against the importing file's own directory, so `./chat.js`
         from src/routes.ts and `../chat.js` from src/store/db-errors.ts are one
         module and compare equal. */
      const dir = file.slice(0, file.lastIndexOf("/"));
      const resolved = posix.normalize(posix.join(dir, value)).replace(/\.js$/, ".ts");
      binding = `${resolved}#${exported}`;
    }
  });
  return binding;
}

/** Where `src/routes.ts` imports a name from, as a repo path, or `null`. */
function declaringFile(routesSource: string, klass: string): string | null {
  let source: string | null = null;
  walkAst(parse(routesSource), (node) => {
    if (node.type !== "ImportDeclaration") return;
    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    const named = specifiers.some((s) => {
      const local = s.local as AstNode | undefined;
      return s.type === "ImportSpecifier" && local?.type === "Identifier" && local.name === klass;
    });
    if (!named) return;
    const value = (node.source as AstNode | undefined)?.value;
    /* ESM specifiers are written `.js` and the file on disk is `.ts` — the
       repo's own convention, and the one translation this needs to do. */
    if (typeof value === "string" && value.startsWith("./")) {
      source = `src/${value.slice(2).replace(/\.js$/, ".ts")}`;
    }
  });
  return source;
}

/**
 * Does `klass`, declared in `file`, carry a `status` the guard will accept?
 *
 * Accepts `readonly status = 409` (a numeric literal) and `readonly status:
 * number`. **Rejects `number | null` and every other union**, which is the
 * `EmbeddingFailure` case in the header.
 */
function declaresNumericStatus(source: string, klass: string): boolean {
  let ok = false;
  walkAst(parse(source), (node) => {
    if (node.type !== "ClassDeclaration") return;
    const id = node.id as AstNode | undefined;
    if (id?.type !== "Identifier" || id.name !== klass) return;
    /* **The class's own members, read directly.** A `walkAst` here descends into
       method bodies, so a class declared *inside* a method of this one could
       certify it — an outer class with no `status` at all passing because
       something nested had one. GPT Sol, 2026-09-07, F7. */
    for (const member of ((node.body as AstNode | undefined)?.body as AstNode[] | undefined) ?? []) {
      if (member.type !== "ClassProperty") continue;
      const key = member.key as AstNode | undefined;
      if (key?.type !== "Identifier" || key.name !== "status") continue;
      /* **Five modifiers that each make the property a lie about an instance.**
         `static` puts it on the constructor, so `new X().status` is `undefined`;
         `declare` and `!` assert a value the emitted JavaScript never assigns;
         `?` and `abstract` permit its absence. Sol compiled the `declare` and
         definite-assignment forms and emitted them: both instances came out with
         `status: undefined` while the first version of this predicate accepted
         them — a class certified as passing a guard that would scrub it. F7. */
      if (
        member.static === true ||
        member.declare === true ||
        member.definite === true ||
        member.optional === true ||
        member.abstract === true
      ) {
        continue;
      }
      const annotation = (member.typeAnnotation as AstNode | undefined)?.typeAnnotation as
        | AstNode
        | undefined;
      if (annotation) {
        /* An annotation is authoritative when there is one: `number` passes,
           `number | null` and anything else does not. */
        if (annotation.type === "TSNumberKeyword") ok = true;
        continue;
      }
      /* No annotation — the type is the initialiser's. Only a plain number
         literal counts; anything computed is not something this can vouch for,
         and vouching wrongly is the failure mode. */
      const value = member.value as AstNode | undefined;
      if (value?.type === "NumericLiteral") ok = true;
    }
  });
  return ok;
}

/**
 * The whole check, over source text, as the list of disagreements it found.
 *
 * One function, used both against the real files and against the fixtures in §
 * *the check itself*, so the control exercises the code that actually runs
 * rather than a paraphrase of it — a re-implementation in the test is a second
 * thing to keep in sync, and it agrees with the first for exactly as long as
 * nobody changes either.
 */
function disagreements(routesSource: string, guardSource: string, read: (f: string) => string) {
  const failures: string[] = [];
  const allowed = allowlisted(guardSource);
  for (const { klass, line } of mappedToAStatus(routesSource)) {
    if (allowed.includes(klass)) {
      /* **The same name is not yet the same class.** Both sides have to agree
         about the binding, or `import { Unsafe as ChatConflict }` in routes.ts
         is certified by the guard's real `ChatConflict`. F8. */
      const here = bindingOf(routesSource, ROUTES, klass);
      const there = bindingOf(guardSource, GUARD, klass);
      if (here !== null && there !== null && here === there) continue;
      failures.push(
        `${ROUTES}:${line} — ${klass}: named in mayPassThrough, but ${
          here === null || there === null
            ? "one of the two does not import it from a relative module, so the bindings cannot be compared"
            : `they are different bindings (${here} here, ${there} in the guard)`
        }`,
      );
      continue;
    }
    const file = declaringFile(routesSource, klass);
    if (file === null) {
      /* **Fail closed.** A class this cannot resolve is a class it cannot vouch
         for, and a guard that cannot see an edge must go red rather than quiet
         — tests/helpers/ts-ast.ts. */
      failures.push(`${ROUTES}:${line} — ${klass}: cannot resolve where it is declared`);
      continue;
    }
    if (!declaresNumericStatus(read(file), klass)) {
      failures.push(
        `${ROUTES}:${line} — ${klass} (${file}): not in mayPassThrough, and no numeric non-nullable \`status\``,
      );
    }
  }
  return failures;
}

describe("every class the API maps to a status survives the store guard", () => {
  const routesSource = read(ROUTES);
  const guardSource = read(GUARD);

  it("finds the status chain, and the classes it matches", () => {
    /* The positive control — see KNOWN_MAPPED. */
    expect([...new Set(mappedToAStatus(routesSource).map((m) => m.klass))].sort()).toEqual(
      expect.arrayContaining(KNOWN_MAPPED),
    );
  });

  it("finds mayPassThrough's allowlist", () => {
    /* The other positive control. If this list came back empty, every class
       below would be judged solely on its `status` and the check would have
       quietly halved. */
    const allowed = allowlisted(guardSource);
    expect(allowed).toContain("ChatConflict");
    expect(allowed.length).toBeGreaterThanOrEqual(5);
  });

  it("passes mayPassThrough, by name or by a numeric status", () => {
    /* Named rather than counted: a red line has to say which class, where it is
       matched, and which of the two doors to put it through. The fix is either a
       `readonly status = <code>` on the class — the established idiom, and the
       one the postmortem chose — or a line in `mayPassThrough`. It is never a
       new list here. */
    expect(disagreements(routesSource, guardSource, read)).toEqual([]);
  });
});

/**
 * **The control: make the two lists disagree, and watch this go red.**
 *
 * Everything above asserts that a list is empty, and the tree already agrees, so
 * without this section the file would be equally green if `mappedToAStatus`
 * returned nothing at all. These four cases are the four ways the agreement can
 * break, and each is a shape that has actually occurred or nearly did.
 */
describe("the check itself", () => {
  /** A minimal `routes.ts`: one import, one status chain. */
  const routesWith = (klass: string, from: string) =>
    `import { ${klass} } from "${from}";
     const status = (err as { status?: number }).status ??
       (err instanceof ${klass} ? 409 : null) ?? 500;`;

  /* The guard fixture carries the import too, because a name on the allowlist
     only counts when both files mean the same class — see `bindingOf`. `../`,
     because the real guard lives in `src/store/`. */
  const GUARD_WITH_CHAT_ONLY = `import { ChatConflict } from "../chat.js";
    function mayPassThrough(err: unknown): boolean {
      if (err instanceof ChatConflict) return true;
      return typeof (err as { status?: unknown })?.status === "number";
    }`;

  it("goes red when a mapped class is on neither list — the 2026-08-28 bug", () => {
    /* `CommentIdTaken` as it was: thrown from a guarded store, matched by the
       chain, absent from the allowlist, and with no `status` of its own. */
    const failures = disagreements(
      routesWith("CommentIdTaken", "./comments.js"),
      GUARD_WITH_CHAT_ONLY,
      () => `export class CommentIdTaken extends Error {
               constructor(readonly id: string) { super("taken"); }
             }`,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("CommentIdTaken");
    expect(failures[0]).toContain("src/comments.ts");
  });

  it("goes red on a `status` the guard would not accept — the EmbeddingFailure shape", () => {
    /* Declaring the field is not declaring a number. `typeof null === "object"`,
       so this fails `mayPassThrough`'s last line while looking, to a reader and
       to the postmortem's own wording, exactly like a class that passes. */
    const failures = disagreements(
      routesWith("Nullable", "./nullable.js"),
      GUARD_WITH_CHAT_ONLY,
      () => `export class Nullable extends Error { readonly status: number | null = null; }`,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Nullable");
  });

  it("goes red when a class cannot be resolved, rather than passing it", () => {
    /* Fail closed. A chain that matches a class this cannot find is a chain it
       knows nothing about, and "found nothing wrong" would be a lie. */
    const failures = disagreements(
      `const status = (err instanceof Mystery ? 409 : null) ?? 500;`,
      GUARD_WITH_CHAT_ONLY,
      () => "",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("cannot resolve");
  });

  it("stays green for a class on the allowlist, and for one with a numeric status", () => {
    /* Both doors, so a red result above means a real disagreement rather than
       this check refusing everything. */
    expect(
      disagreements(routesWith("ChatConflict", "./chat.js"), GUARD_WITH_CHAT_ONLY, () => ""),
    ).toEqual([]);
    expect(
      disagreements(
        routesWith("Fine", "./fine.js"),
        GUARD_WITH_CHAT_ONLY,
        () => `export class Fine extends Error { readonly status = 409; }`,
      ),
    ).toEqual([]);
  });

  it("rejects a `status` that is not on the instance", () => {
    /* Five modifiers, five ways to declare a field the instance does not have.
       Sol emitted the `declare` and `!` forms and got `status: undefined` on the
       instance while the first version of this predicate said they were fine —
       which is a class certified as surviving a guard that would scrub it, the
       exact failure this file is the check for. F7. */
    for (const declaration of [
      `static readonly status = 409;`,
      `declare readonly status: number;`,
      `readonly status!: number;`,
      `readonly status?: number;`,
    ]) {
      const failures = disagreements(
        routesWith("Sneaky", "./sneaky.js"),
        GUARD_WITH_CHAT_ONLY,
        () => `export class Sneaky extends Error { ${declaration} }`,
      );
      expect(failures, declaration).toHaveLength(1);
    }
  });

  it("does not let a nested class certify the one it is nested in", () => {
    /* An outer class with no `status` at all, and an inner one that has it. A
       walk into method bodies vouched for the outer. F7. */
    const failures = disagreements(
      routesWith("Outer", "./outer.js"),
      GUARD_WITH_CHAT_ONLY,
      () => `export class Outer extends Error {
               helper() { class Inner { readonly status = 409; } return Inner; }
             }`,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Outer");
  });

  it("reads the allowlist as classes it admits, not names that appear near it", () => {
    /* Four shapes that mention a class inside `mayPassThrough` without letting
       it through. Each would have put `Unsafe` on the allowlist. F8. */
    for (const guard of [
      `if (err instanceof Unsafe) return false;`,
      `if (!(err instanceof Unsafe)) return true;`,
      `const inspect = () => err instanceof Unsafe;`,
      `if ((err as { cause?: unknown }).cause instanceof Unsafe) { return true; }`,
    ]) {
      const failures = disagreements(
        routesWith("Unsafe", "./unsafe.js"),
        `import { Unsafe } from "../unsafe.js";
         function mayPassThrough(err: unknown): boolean {
           ${guard}
           return typeof (err as { status?: unknown })?.status === "number";
         }`,
        () => `export class Unsafe extends Error {}`,
      );
      expect(failures, guard).toHaveLength(1);
    }
  });

  it("will not let one class borrow another's place on the allowlist", () => {
    /* `import { Unsafe as ChatConflict }` — the same spelling, a different
       class. Compared as text this is certified by the guard's real branch. F8. */
    const failures = disagreements(
      `import { Unsafe as ChatConflict } from "./unsafe.js";
       const status = (err instanceof ChatConflict ? 409 : null) ?? 500;`,
      GUARD_WITH_CHAT_ONLY,
      () => `export class Unsafe extends Error {}`,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("different bindings");
  });

  it("ignores an `instanceof` that is a local translation, not a status mapping", () => {
    /* `sendExport`'s `ArticleNotFound` and `embeddingHttpError`'s
       `EmbeddingFailure` are this shape: they throw or convert in their own
       `catch` and never reach the chain. Sweeping them in is what made the first
       draft of this file need an exemption list. GPT Sol, F3. */
    const local = `import { ArticleNotFound } from "./store/article-rows.js";
      const bundle = await articleBundle(slug).catch((err: unknown) => {
        if (err instanceof ArticleNotFound) throw httpError(404, "No such article.");
        throw err;
      });`;
    expect(mappedToAStatus(local)).toEqual([]);
    expect(disagreements(local, GUARD_WITH_CHAT_ONLY, () => "")).toEqual([]);
  });
});
