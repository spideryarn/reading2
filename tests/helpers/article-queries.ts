/**
 * **Every way a file can name the `articles` table, found by parsing rather than
 * by matching one spelling of one of them.**
 *
 * Written 2026-09-04, after GPT Sol's review of stage 3a
 * (docs/plans/260904b-stage3a-code-review-sol.md, finding 2). The guard in
 * `tests/owner-isolation.test.ts` § *ownerless enumeration* recognised the
 * literal Drizzle shape `.from(articles)` and nothing else, so **a table alias,
 * a relational query, or raw SQL walked straight past it** — and noticing a
 * second ownerless query appearing on the public surface is the guard's whole
 * job.
 *
 * That is the same mistake, in the same week, that
 * [fixture-ids.test.ts](../fixture-ids.test.ts) records in its own header: its
 * first version matched `const <NAME>_ID = "…"`, a Sol review found a **live**
 * collision written as an object property instead, and the conclusion there is
 * the conclusion here — *parse them all*. A guard that sees only the shape it
 * was written from is a guard whose green is worth nothing on the day somebody
 * writes the query a different way, which is exactly the day it matters.
 *
 * `@babel/parser` rather than `typescript`, following
 * [no-undeclared-spend.test.ts](../no-undeclared-spend.test.ts) and
 * [paid-cli-ledger.test.ts](../paid-cli-ledger.test.ts), which is the repo's
 * existing way of asking a syntactic question of every file. (The `typescript`
 * dependency here is 7.x — the Go port — and its `createSourceFile` is not
 * reachable from ESM at all, so this is the working option as well as the
 * house one.)
 *
 * ## What counts as naming the table
 *
 * Not "a query", which nothing static can decide, but **a table-level use of
 * `articles`** — every construct that could put its rows into an answer:
 *
 * | shape | example |
 * |---|---|
 * | a bare reference to the binding | `.from(articles)`, `.innerJoin(articles, …)`, `.insert(articles)`, `` sql`… from ${articles}` `` |
 * | an alias of it | `const a = alias(articles, "a")`, then `.from(a)` |
 * | Drizzle's relational API | `db.query.articles.findMany(…)` |
 * | raw SQL naming it | `` sql`select … from spideryarn.articles` `` |
 *
 * **`articles.slug` is deliberately not one of them.** A column reference is how
 * a projection and a `where` are written, and counting those would make the
 * "exactly one per file" rule meaningless. The distinction is syntactic and the
 * parser makes it for free: a bare identifier, versus the object half of a
 * member expression.
 *
 * ## And a second question, from the same finding
 *
 * A stranger's request does not start in `src/public/`. It starts in the
 * transport, which runs a **pre-auth region** — everything before the gate — and
 * a query added *there* would be publicly reachable and invisible to a graph
 * rooted at the closed modules. So this file also cuts that region out of a
 * transport (`preAuthRegion`) and says which imported modules it reaches for
 * (`modulesUsedIn`), which is what lets the guard state the rule directly
 * instead of keeping a second list of roots.
 */

import { type ParseResult, parse as babelParse } from "@babel/parser";
import type { File } from "@babel/types";

/** A node, as this file handles them: a bag with a `type` and a source span. */
type Node = Record<string, unknown> & { type: string; start?: number; end?: number };

/** One place a file names the `articles` table, and how. */
export interface TableUse {
  /** 1-based, for a failure message somebody can act on. */
  line: number;
  /** The nearest enclosing named function, or `null` at module scope. */
  fn: string | null;
  /** Which of the shapes above this is. */
  how: "table reference" | "alias" | "relational query" | "raw sql";
  /** Enough of the offending source to recognise it. */
  text: string;
}

/** A parsed file plus its text, so callers that ask two questions parse once. */
export interface Parsed {
  file: string;
  source: string;
  ast: ParseResult<File>;
}

/** Babel's options, the same set [no-undeclared-spend.test.ts](../no-undeclared-spend.test.ts) uses. */
export function parse(file: string, source: string): Parsed {
  return {
    file,
    source,
    ast: babelParse(source, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      /* Recovery rather than a throw: a file this cannot parse must not make the
         guard *pass* by vanishing from the inventory. */
      errorRecovery: true,
      plugins: ["typescript", "jsx", "decorators-legacy", "explicitResourceManagement"],
    }),
  };
}

const SKIP_KEYS = new Set(["loc", "range", "leadingComments", "trailingComments", "innerComments"]);

/**
 * Every node, once, **with the chain of parents that reached it**.
 *
 * The parents are not decoration: `articles` inside `articles.slug` and
 * `articles` inside `.from(articles)` are the same token, and only the parent
 * tells them apart. Babel does not thread `parent` through, and `@babel/traverse`
 * is not a dependency here, so the walker carries the stack.
 */
function walk(node: unknown, visit: (n: Node, parents: Node[]) => void, parents: Node[] = []): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parents);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  visit(n, parents);
  const next = [...parents, n];
  for (const [key, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(value, visit, next);
  }
}

/**
 * The local names under which a file knows the `articles` table.
 *
 * Usually just `articles` — but `import { articles as rows }` renames it and
 * `const a = alias(articles, "a")` makes a second one, and neither was visible
 * to the regex this replaces. Aliases are resolved to a fixed point, so an alias
 * of an alias is still an alias.
 */
function bindingsFor(parsed: Parsed): Map<string, "table reference" | "alias"> {
  const names = new Map<string, "table reference" | "alias">();

  walk(parsed.ast.program, (n) => {
    if (n.type !== "ImportDeclaration" || n.importKind === "type") return;
    for (const raw of (n.specifiers ?? []) as Node[]) {
      if (raw.type !== "ImportSpecifier" || raw.importKind === "type") continue;
      const imported = (raw.imported as { name?: string } | undefined)?.name;
      const local = (raw.local as { name?: string } | undefined)?.name;
      if (imported === "articles" && local) names.set(local, "table reference");
    }
  });

  /* `alias(articles, "a")` and `aliasedTable(articles)` are Drizzle's two
     spellings, and following them matters because the *aliased* identifier is
     what turns up in `.from(…)` — the shape the old detector was blind to. A
     fixed point rather than one pass, because `const b = alias(a, "b")` is legal
     and its second hop is exactly as reachable as its first. */
  const ALIASING = new Set(["alias", "aliasedTable"]);
  for (let pass = 0; pass < 5; pass += 1) {
    const before = names.size;
    walk(parsed.ast.program, (n) => {
      if (n.type !== "VariableDeclarator") return;
      const id = n.id as { type?: string; name?: string } | undefined;
      const init = n.init as Node | undefined;
      if (id?.type !== "Identifier" || !id.name || init?.type !== "CallExpression") return;
      const callee = init.callee as { type?: string; name?: string } | undefined;
      if (callee?.type !== "Identifier" || !ALIASING.has(callee.name ?? "")) return;
      const args = (init.arguments ?? []) as Node[];
      if (args.some((a) => a.type === "Identifier" && names.has((a as { name?: string }).name ?? ""))) {
        names.set(id.name, "alias");
      }
    });
    if (names.size === before) break;
  }

  return names;
}

/** The nearest enclosing thing with a name, so a failure locates the hit. */
function enclosingFunction(parents: Node[]): string | null {
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const at = parents[i];
    if (at === undefined) continue;
    if (at.type === "FunctionDeclaration" || at.type === "ClassMethod" || at.type === "ObjectMethod") {
      return (at.id as { name?: string } | undefined)?.name ?? (at.key as { name?: string } | undefined)?.name ?? null;
    }
    if (at.type === "ArrowFunctionExpression" || at.type === "FunctionExpression") {
      const owner = parents[i - 1];
      if (owner?.type === "VariableDeclarator") {
        return (owner.id as { name?: string } | undefined)?.name ?? null;
      }
      if (owner?.type === "ObjectProperty") {
        return (owner.key as { name?: string } | undefined)?.name ?? null;
      }
    }
  }
  return null;
}

/**
 * **Raw SQL that names the table**, which no amount of AST work can see into —
 * so the string is read.
 *
 * Anchored on the clause rather than on the word, because `articles` turns up in
 * plenty of prose and in plenty of column names. `from articles`,
 * `join spideryarn.articles`, `update "articles"` are the shapes that put rows
 * into an answer.
 */
const RAW_SQL_TABLE = /\b(from|join|into|update)\s+(?:"?spideryarn"?\s*\.\s*)?"?articles"?\b/i;

/**
 * A character range of the source, for asking about part of a file — with an
 * optional hole in it.
 *
 * The hole is what makes "the part a stranger executes" expressible. A
 * transport's anonymous region is not a *prefix* of its dispatcher: the `catch`
 * and `finally` at the bottom run for an anonymous request too, and the only
 * part that does not is the sub-tree of the one call that hands off to the
 * authenticated half. So the region is the whole function with that call cut
 * out, rather than everything above it — which would have quietly excused
 * anything written in the error path.
 */
export interface Range {
  start: number;
  end: number;
  /** The delegation to the authenticated half, which is not a stranger's code. */
  exclude?: { start: number; end: number };
}

const inRange = (start: number, end: number, range: Range | undefined): boolean => {
  if (range === undefined) return true;
  if (!(start >= range.start && end <= range.end)) return false;
  const hole = range.exclude;
  if (hole && start >= hole.start && end <= hole.end) return false;
  return true;
};

/**
 * **Is this identifier the table, or a column of it?**
 *
 * The one distinction the old regex could not make and the one everything here
 * rests on. `articles` in `.from(articles)` is the table; `articles` in
 * `articles.slug` is the object half of a member expression and is a column
 * reference, which every legitimate projection and `where` in this repo is made
 * of. Also excluded: the import that binds the name, and a key or property that
 * merely spells it.
 */
function isTableLevel(node: Node, parent: Node | undefined): boolean {
  if (parent === undefined) return true;
  const member = parent.type === "MemberExpression" || parent.type === "OptionalMemberExpression";
  if (member && parent.object === node) return false;
  if ((member || parent.type === "ObjectProperty") && parent.property === node) return false;
  if (parent.type === "ObjectProperty" && parent.key === node) return false;
  if (parent.type === "TSPropertySignature") return false;
  if (parent.type.startsWith("Import")) return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  return true;
}

/** `db.query.articles.…`, Drizzle's relational API, which names no table object. */
function isRelationalArticles(node: Node): boolean {
  const property = node.property as { name?: string } | undefined;
  const object = node.object as Node | undefined;
  return (
    property?.name === "articles" &&
    object?.type === "MemberExpression" &&
    (object.property as { name?: string } | undefined)?.name === "query"
  );
}

/** A string or template chunk that puts the table into a `from`/`join`/`update`/`into`. */
function namesTableInRawSql(node: Node): boolean {
  if (node.type === "StringLiteral") {
    return RAW_SQL_TABLE.test((node as { value?: string }).value ?? "");
  }
  if (node.type !== "TemplateElement") return false;
  const chunk = (node.value as { cooked?: string; raw?: string } | undefined) ?? {};
  return RAW_SQL_TABLE.test(chunk.cooked ?? chunk.raw ?? "");
}

/**
 * Every table-level use of `articles` in a file, optionally narrowed to a range
 * — which is how the transports' pre-auth regions are checked.
 */
export function articleTableUses(parsed: Parsed, range?: Range): TableUse[] {
  const names = bindingsFor(parsed);
  const found: TableUse[] = [];
  const lineOf = (at: number): number => parsed.source.slice(0, at).split("\n").length;

  const record = (n: Node, parents: Node[], how: TableUse["how"]): void => {
    const start = n.start ?? 0;
    const end = n.end ?? 0;
    if (!inRange(start, end, range)) return;
    found.push({
      line: lineOf(start),
      fn: enclosingFunction(parents),
      how,
      text: parsed.source.slice(start, end).replace(/\s+/g, " ").slice(0, 90),
    });
  };

  walk(parsed.ast.program, (n, parents) => {
    const parent = parents[parents.length - 1];
    /* A bare reference to the table, which is every Drizzle shape that takes the
       table itself: `from`, the four joins, `insert`, `update`, `delete`, and an
       interpolation into a `sql` template. Excluded: the object half of
       `articles.slug`, which is a column, and is how every legitimate projection
       and predicate in this repo is written. */
    if (n.type === "Identifier" && names.has((n as { name?: string }).name ?? "")) {
      if (isTableLevel(n, parent)) {
        record(n, parents, names.get((n as { name?: string }).name ?? "") ?? "table reference");
      }
      return;
    }
    /* Drizzle's relational API — `db.query.articles.findMany(…)` — which names
       no table object at all and so cannot be caught above. */
    if (n.type === "MemberExpression") {
      if (isRelationalArticles(n)) record(n, parents, "relational query");
      return;
    }
    if (namesTableInRawSql(n)) record(n, parents, "raw sql");
  });

  return found;
}

/**
 * **The part of a transport a stranger executes**: the named dispatcher, minus
 * the one call that hands off to the authenticated half.
 *
 * `src/routes.ts` hands off at `serveAuthenticatedApi`, a function whose one
 * parameter is a type only the gate can produce; `src/vercel.ts` hands off at
 * `handleApi`, whose own anonymous region is the first one. Everything else in
 * those two functions runs for somebody with no session — **including the
 * `catch` and the `finally`**, which is why this cuts a hole rather than taking
 * a prefix. A prefix would have excused an ownerless query written into the
 * error path, and an error path is a perfectly ordinary place to put a lookup.
 *
 * Throws rather than returning empty when it cannot find either end. A region
 * finder that silently returned nothing would make the guard green precisely
 * when the code it guards had been restructured — docs/reusable/silent-success.md,
 * and the failure shape this whole review pass kept turning up.
 */
export function preAuthRegion(parsed: Parsed, fnName: string, gateCallee: string): Range {
  let fn: Node | undefined;
  walk(parsed.ast.program, (n) => {
    if (n.type !== "FunctionDeclaration") return;
    if ((n.id as { name?: string } | undefined)?.name === fnName) fn = n;
  });
  if (!fn) throw new Error(`${parsed.file}: no function ${fnName} to take a region from`);

  const gates: Node[] = [];
  walk(fn.body, (n) => {
    if (n.type !== "CallExpression") return;
    const callee = n.callee as Node | undefined;
    const name =
      callee?.type === "Identifier"
        ? ((callee as { name?: string }).name ?? "")
        : callee?.type === "MemberExpression"
          ? ((callee.property as { name?: string } | undefined)?.name ?? "")
          : "";
    if (name === gateCallee) gates.push(n);
  });

  /* Exactly one, and that is load-bearing. Two hand-offs mean two holes and this
     would silently cut one; none means the hand-off has been renamed and the
     hole is nowhere. Both are somebody's decision to make, not this file's to
     guess at. */
  if (gates.length !== 1) {
    throw new Error(
      `${parsed.file}: expected exactly one call to ${gateCallee} in ${fnName}, found ${gates.length}`,
    );
  }
  const gate = gates[0];
  if (gate === undefined) throw new Error("unreachable");
  return {
    start: fn.start ?? 0,
    end: fn.end ?? 0,
    exclude: { start: gate.start ?? 0, end: gate.end ?? 0 },
  };
}

/**
 * **Which imported modules a range of code actually reaches for.**
 *
 * The other half of the pre-auth question. A query added to the transport
 * *directly* is caught by `articleTableUses`; one added as a **call into a store
 * module** — `pgAdminReader.counts()`, say — names no table here at all. It does
 * need an import, and an import used inside the region is something this can
 * see. So the guard pins the set, and widening what an anonymous request may
 * touch becomes an edit somebody makes on purpose.
 *
 * Bare specifiers (packages) are included: `node:http` is as much a fact about
 * the region as `./public/routes.js` is.
 */
export function modulesUsedIn(parsed: Parsed, range: Range): string[] {
  const from = new Map<string, string>();
  walk(parsed.ast.program, (n) => {
    if (n.type !== "ImportDeclaration" || n.importKind === "type") return;
    const specifier = (n.source as { value?: string } | undefined)?.value;
    if (!specifier) return;
    for (const raw of (n.specifiers ?? []) as Node[]) {
      if (raw.type === "ImportSpecifier" && raw.importKind === "type") continue;
      const local = (raw.local as { name?: string } | undefined)?.name;
      if (local) from.set(local, specifier);
    }
  });

  const used = new Set<string>();
  walk(parsed.ast.program, (n, parents) => {
    if (n.type !== "Identifier") return;
    const name = (n as { name?: string }).name ?? "";
    if (!from.has(name)) return;
    const start = n.start ?? 0;
    const end = n.end ?? 0;
    if (!inRange(start, end, range)) return;
    const parent = parents[parents.length - 1];
    const isName =
      (parent?.type === "MemberExpression" || parent?.type === "ObjectProperty") &&
      parent.property === n;
    if (!isName) used.add(from.get(name) ?? "");
  });
  return [...used].sort();
}
