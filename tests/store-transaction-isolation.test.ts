/**
 * **Every store transaction names the isolation level it runs at.**
 *
 * `read committed` is PostgreSQL's default, so a transaction that says nothing
 * usually gets it. "Usually" is the problem: `default_transaction_isolation` is
 * a role or database setting, it can be changed by somebody who is not looking
 * at this code, and when it changes nothing errors. The store's two
 * conflict-tolerant upserts — `writeRawSource` and `lockOrCreateArticle` — stop
 * working at `repeatable read`, raising `40001` at the *insert*, and nothing in
 * `src/` retries `40001`. docs/postmortems/260901f-a-for-update-that-locks-nothing.md,
 * and [`src/store/isolation.ts`](../src/store/isolation.ts) has the measurement.
 *
 * On 2026-09-03 four of twenty-four transactions pinned and the rest inherited.
 * Pinning the other seventeen is the small half of that work. **This file is the
 * other half**, and the reason it exists is that the eighteenth transaction is
 * coming: a new `pg-*.ts` file, written by copying its nearest sibling, is
 * exactly how the seventeen got there. docs/plans/260903a-improve-the-codebase-sweep.md
 * § T1.3.
 *
 * ## Three checks, and why the first two are not enough on their own
 *
 * 1. **The constant really reaches Postgres** — asked of a transaction opened
 *    with `READ_COMMITTED` down a connection whose own default is `repeatable
 *    read`. A test that asserted `read committed` against an ordinary laptop
 *    database would agree with the bug, because the laptop's default is already
 *    right; docs/reusable/silent-success.md. The rig assertion above it proves
 *    the connection really is wrong-by-default, so a green tick cannot mean the
 *    rig quietly did nothing. (The same rig, driving the real `commit`, is
 *    tests/store-session-isolation.test.ts.)
 *
 * 2. **Every `.transaction(` in `src/store/` and `src/billing/` names a level**,
 *    read off the source with a parser rather than a regular expression —
 *    tests/helpers/ts-ast.ts says why that distinction has already cost this
 *    repo two checks that went quiet.
 *
 * 3. **The level comes from the shared constant**, with a named allow-list of
 *    the three files that spell the object out inline and predate it. A new
 *    inline literal fails, and is told where the constant is. Seventeen copies
 *    of one object are seventeen places the next change has to reach all of,
 *    which is how `articleIdFor` lost its slug check in one file of six.
 *
 * ## What the second check refuses to do
 *
 * It does **not** accept any spelling containing `isolationLevel`. That is the
 * tautology this sweep found in `tests/admin-queries.test.ts`, where three
 * assertions about vocabulary all passed against a join that attributed every
 * comment to every owner. So this resolves the option object to the level it
 * actually names — following an identifier back through the file that declares
 * it, including across the import — and compares that level against what the
 * file is allowed to run at. A `READ_COMMITTED` quietly redefined as
 * `serializable` fails here, in every file that imports it.
 *
 * ## Watched red, 2026-09-03
 *
 * A deliberately unpinned transaction added to `src/store/pg-visibility.ts`:
 *
 * ```
 *   × every store transaction names its isolation level
 *     → src/store/pg-visibility.ts:131 — .transaction(...) names no isolation
 *       level, so it inherits default_transaction_isolation
 * ```
 *
 * and, with `READ_COMMITTED` changed to `{ isolationLevel: "serializable" }`:
 *
 * ```
 *   × the shared constant survives a connection whose default is wrong
 *     → expected 'serializable' to be 'read committed'
 *   × every store transaction names its isolation level
 *     → src/store/pg-chat.ts:325 — runs at "serializable", expected "read committed"
 * ```
 *
 * The third went red on its own first draft, which had `article-rows.ts` in the
 * allow-list: its `SNAPSHOT` is a named const rather than an inline object, so
 * the check said so and the list is shorter than the author expected.
 *
 * The first check skips loudly without a database; the other two need none and
 * always run.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import * as schema from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { READ_COMMITTED } from "../src/store/isolation.js";
import { type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------------------------ the rules -- */

interface Options {
  isolationLevel?: string;
  accessMode?: string;
}

/** The level a transaction runs at unless its file says otherwise. */
const DEFAULT_LEVEL: Options = { isolationLevel: "read committed" };

/**
 * **The deliberate exceptions, one line each, with the reason attached.**
 *
 * Keyed by file, because an exception is a property of what that file's
 * transactions are *for* rather than of one line number that moves. Adding a
 * file here is a decision somebody has to write down; forgetting to add one is
 * a red test rather than a silent inheritance, which is the whole point.
 */
const EXCEPTIONS: Record<string, Options> = {
  /* One consistent picture of a whole article for an export, which is what
     `repeatable read` is actually for — and read-only, because a walk that
     could write is a walk that could deadlock with the pipeline. See
     src/store/article-rows.ts § SNAPSHOT. */
  "src/store/article-rows.ts": { isolationLevel: "repeatable read", accessMode: "read only" },
};

/** Where transactions are opened. Both directories, not just the store. */
const DIRS = ["src/store", "src/billing"];

/* --------------------------------------------------- reading the source -- */

function sourceFiles(): string[] {
  const found: string[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".ts") && !name.endsWith(".d.ts")) found.push(join(dir, name));
    }
  }
  return found.sort();
}

/** A `{ … }`, possibly wrapped in `as const`, as a plain object of strings. */
function objectOf(node: AstNode | undefined): Options | undefined {
  if (!node) return undefined;
  const inner = node.type === "TSAsExpression" ? (node.expression as AstNode) : node;
  if (inner.type !== "ObjectExpression") return undefined;
  const out: Options = {};
  for (const raw of inner.properties as AstNode[]) {
    if (raw.type !== "ObjectProperty") return undefined;
    const key = raw.key as AstNode;
    const value = raw.value as AstNode;
    if (key.type !== "Identifier" || value.type !== "StringLiteral") return undefined;
    out[key.name as keyof Options] = value.value as string;
  }
  return out;
}

/** Every `const NAME = { … }` in one parsed file, by name. */
function constantsOf(ast: ReturnType<typeof parseSource>): Map<string, Options> {
  const consts = new Map<string, Options>();
  walkAst(ast, (node) => {
    if (node.type !== "VariableDeclarator") return;
    const id = node.id as AstNode;
    if (id.type !== "Identifier") return;
    const value = objectOf(node.init as AstNode | undefined);
    if (value) consts.set(id.name as string, value);
  });
  return consts;
}

/** `"./isolation.js"` seen from `src/store/pg-chat.ts` → `src/store/isolation.ts`. */
function importedFrom(ast: ReturnType<typeof parseSource>, local: string, file: string): string | undefined {
  let source: string | undefined;
  walkAst(ast, (node) => {
    if (node.type !== "ImportDeclaration") return;
    for (const spec of node.specifiers as AstNode[]) {
      const bound = spec.local as AstNode;
      if (bound?.type === "Identifier" && bound.name === local) {
        source = ((node.source as AstNode).value as string) ?? undefined;
      }
    }
  });
  if (!source?.startsWith(".")) return undefined;
  const dir = file.slice(0, file.lastIndexOf("/"));
  return join(dir, source.replace(/\.js$/, ".ts"));
}

const parsed = new Map<string, ReturnType<typeof parseSource>>();
function astOf(file: string): ReturnType<typeof parseSource> {
  const already = parsed.get(file);
  if (already) return already;
  const ast = parseSource(readFileSync(file, "utf8"));
  parsed.set(file, ast);
  return ast;
}

/** What one call site's second argument actually says, or why it cannot be read. */
type Resolved =
  | { options: Options; spelling: "identifier" | "literal" }
  | { problem: string };

function resolveOptions(arg: AstNode | undefined, file: string): Resolved {
  if (!arg) {
    return {
      problem: "names no isolation level, so it inherits default_transaction_isolation",
    };
  }
  const literal = objectOf(arg);
  if (literal) return { options: literal, spelling: "literal" };
  if (arg.type === "Identifier") {
    const name = arg.name as string;
    const here = constantsOf(astOf(file)).get(name);
    if (here) return { options: here, spelling: "identifier" };
    const from = importedFrom(astOf(file), name, file);
    /* Fail closed. An option object this cannot follow is not evidence that the
       transaction is pinned correctly, so it is a red test and not a pass. */
    if (!from) return { problem: `passes \`${name}\`, which this test cannot follow to its value` };
    const there = constantsOf(astOf(from)).get(name);
    if (!there) return { problem: `passes \`${name}\`, not found in ${from}` };
    return { options: there, spelling: "identifier" };
  }
  return { problem: `passes a ${arg.type} this test cannot read` };
}

interface Site {
  file: string;
  line: number;
  resolved: Resolved;
}

function transactionSites(): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles()) {
    walkAst(astOf(file), (node) => {
      if (node.type !== "CallExpression") return;
      const callee = node.callee as AstNode;
      if (callee?.type !== "MemberExpression") return;
      const property = callee.property as AstNode;
      if (property?.type !== "Identifier" || property.name !== "transaction") return;
      const args = node.arguments as AstNode[];
      sites.push({ file, line: lineOf(node), resolved: resolveOptions(args[1], file) });
    });
  }
  return sites;
}

/* --------------------------------------------------------------- tests -- */

describe("the isolation level every store transaction runs at", () => {
  it("finds the transactions at all", () => {
    /* The rig assertion for the check below: a walk that matched nothing would
       pass every assertion about what it found. Twenty-four on 2026-09-03; the
       floor is deliberately loose, because this file's subject is what each call
       says and not how many there are. */
    expect(transactionSites().length).toBeGreaterThanOrEqual(20);
  });

  it("is named by every one of them", () => {
    const wrong: string[] = [];
    for (const site of transactionSites()) {
      const expected = EXCEPTIONS[site.file] ?? DEFAULT_LEVEL;
      if ("problem" in site.resolved) {
        wrong.push(`${site.file}:${site.line} — .transaction(...) ${site.resolved.problem}`);
        continue;
      }
      const got = site.resolved.options;
      if (got.isolationLevel !== expected.isolationLevel || got.accessMode !== expected.accessMode) {
        wrong.push(
          `${site.file}:${site.line} — runs at ${JSON.stringify(got)}, expected ` +
            `${JSON.stringify(expected)}. Pass READ_COMMITTED from src/store/isolation.ts, ` +
            `or add this file to EXCEPTIONS here with the reason.`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("comes from the shared constant everywhere but four known files", () => {
    /* Not a style rule. Call sites spelling out the same object are places the
       next change has to reach all of, which is how `articleIdFor` lost its slug
       check in five files out of six — T1.2 in the same sweep.

       So: an inline literal is allowed only where it is already, and a NEW one
       fails here with a pointer at the constant. These three predate the
       constant and are one line each. `article-rows.ts` is not among them
       because its deliberate exception is a named `SNAPSHOT` const, which is
       the shape a file wanting something different should reach for. */
    const spelledOut = transactionSites()
      .filter((site) => "spelling" in site.resolved && site.resolved.spelling === "literal")
      .map((site) => site.file);
    expect([...new Set(spelledOut)].sort()).toEqual([
      "src/billing/sync.ts",
      "src/store/pg-billing.ts",
      "src/store/pg-feedback.ts",
    ]);
  });
});

/* ------------------------------------------ and that it reaches Postgres -- */

await pgReady({
  suite: "tests/store-transaction-isolation.test.ts",
  tables: ["spideryarn.articles"],
});
/**
 * A pool whose connections default to `repeatable read`.
 *
 * Verbatim in shape from tests/store-session-isolation.test.ts, which explains
 * why the space has to be backslash-escaped and why this is asked for on the
 * connection rather than with `alter role` — the local database is shared by
 * every agent's test run.
 */
function repeatableReadPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set, and pgReady said the database was reachable");
  const parsed = new URL(url);
  parsed.searchParams.set("options", "-c default_transaction_isolation=repeatable\\ read");
  return new Pool({ connectionString: parsed.toString(), max: 2 });
}

let pool: Pool | undefined;
pool = repeatableReadPool();

afterAll(async () => {
  await pool?.end();
});

describe("READ_COMMITTED, down a connection whose default is wrong", () => {
  /** What the transaction says about itself, which is the only honest answer. */
  async function levelInside(options?: typeof READ_COMMITTED): Promise<string> {
    const db = drizzle(pool as Pool, { schema });
    const run = async (tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }) => {
      const rows = (await tx.execute(
        sql`select current_setting('transaction_isolation') as level`,
      )) as { rows?: { level: string }[] } & { level?: string }[];
      return (rows.rows?.[0]?.level ?? rows[0]?.level) as string;
    };
    return options ? db.transaction(run, options) : db.transaction(run);
  }

  it("really is a connection whose default is wrong", async () => {
    /* The rig assertion. Without it the case below could be green because the
       `options` parameter never arrived and everything defaulted to the right
       answer by accident. */
    expect(await levelInside()).toBe("repeatable read");
  });

  it("gets read committed anyway", async () => {
    expect(await levelInside(READ_COMMITTED)).toBe("read committed");
  });
});
