/**
 * **The eight stage CLIs listed below open the ledger before they spend** — and
 * nothing here claims that is every CLI that spends. What is checked and what
 * is not is spelled out under *The edge of this*, because the first version of
 * this header said "every paid CLI" and one of the npm scripts in this very
 * `package.json` was already a counter-example.
 *
 * [`src/cli-ledger.ts`](../src/cli-ledger.ts) says what this is for:
 *
 * > **Run a CLI command with the ledger open**, so that `npm run hierarchy` is money
 * > that appears in `npm run cost` rather than money that vanishes.
 *
 * Eight npm scripts start a module that spends money — the seven Messages
 * stages, plus `npm run pdf`, which is the other extractor and goes through the
 * chat seam instead. Six had that line and two did not, so `npm run labels` and
 * `npm run pdf` made paid calls that never reached `npm run cost` and that
 * `unscopedCalls()` ([`src/ai-spend.ts`](../src/ai-spend.ts)) counted as fallen
 * on the floor. `tests/no-undeclared-spend.test.ts` structurally could not see
 * it: it asks *"can this file spend money, and is that declared?"*, never *"does
 * this entrypoint open the ledger?"*.
 *
 * ## Why this is not a grep
 *
 * The first design was "does `withLedger` appear near the `isMain` guard". GPT
 * Sol refused it, and the reasons are the ones docs/reusable/silent-success.md
 * is about — every one of these defeats a text match while the money still
 * disappears:
 *
 * - the wrapper sitting in a comment above the guard;
 * - the wrapper in a dead branch (`if (false)`) beside a bare `main()`;
 * - a locally-defined `withLedger` that wraps nothing;
 * - the wrapper named in the branch but never called.
 *
 * So this parses instead, with `@babel/parser` — already a direct dev dependency
 * for `tests/no-undeclared-spend.test.ts`, and for the same reason: a
 * hand-written matcher fails towards *quiet*, and a gate that can go quiet is
 * worse than one that can go red.
 *
 * ## The question it asks
 *
 * **In the branch that runs when this module is the entry file, is `main`
 * reached only by the `withLedger` imported from `cli-ledger.js`, called with
 * the `"cli"` scope?** Four separate things, and the first version of this
 * file checked the middle two — which is how it came to pass this, which GPT
 * Sol found and Greg reproduced:
 *
 * ```ts
 * if (isMain) withLedger("cli", async () => {}).then(main);
 * ```
 *
 * The right wrapper, the right scope, and the whole program running after the
 * ledger has closed. So `ledgerOffence` also checks **what the wrapper is
 * handed** — `main`, or a lambda that calls it — and that `main` is reached
 * nowhere else: not in a nested statement, not in an `else`, not in a variable
 * initialiser, and not through a local `const withLedger` shadowing the import,
 * all of which were green before 2026-08-28.
 *
 * ## Two tails, on purpose, and neither of them loosened
 *
 * Since 2026-08-28 a stage CLI can end in either of two ways, and this file
 * checks both **whole** rather than checking for something they have in common:
 *
 * ```ts
 * const isMain = …import.meta…;              // the old tail, five files
 * if (isMain) void withLedger("cli", main);
 *
 * await stageCli(import.meta.url, main);     // the new one, three files
 * ```
 *
 * The second is docs/plans/260828aj-simplification-wave-2.md §2.5: one line that folds
 * the guard, `.env.local` and the ledger together, so §0.1's leak — a copied
 * tail with a line missing — stops being a thing to remember. The migration is
 * partial because five of the eight files were dirty with other agents' work on
 * the day, and it may stay partial for a while.
 *
 * **The obvious way to accept both is to ask a weaker question of each, and
 * that is exactly the failure this file already had once.** So instead the two
 * are checked separately, and the new tail is checked *harder*: `stageOffence`
 * asks the four questions of one line, and `stageCliOffence` asks the rest —
 * once, of `src/cli-ledger.ts`, because a CLI on the new tail says none of it
 * for itself any more. A gate that checked only that the CLIs call `stageCli`
 * would go silent the day somebody simplified `stageCli`.
 *
 * ## The Tier 2 review, and the two things it changed
 *
 * The first version of the new-tail rules was beaten by GPT Sol on 2026-08-28,
 * and it was beaten *by execution* — it ran these exported functions against
 * adversarial sources rather than reading them, which is why it found things a
 * careful read had not. Every one reproduced. Both faults are the same mistake
 * in two places, and it is the mistake this file's header already warns about:
 *
 * 1. **Presence read as execution.** A guard whose test was the wrong way
 *    round, a guard that exits along one path, a `return` between the guard and
 *    the `.env.local` read, a wrapper in `if (false)`, a wrapper that is not
 *    awaited, a tail that is not awaited, and a helper closure hiding a bare
 *    `main()` — all seven had the right syntax in the right order and did the
 *    wrong thing. The fix is to require the *statement*, not to find the call:
 *    `stageCli`'s body must be exactly its three statements, and a caller's tail
 *    must be a top-level `await stageCli(…);` — nothing nested, voided or
 *    chained. And `main` is now looked for **everywhere** in a caller, function
 *    bodies included, because a closure over `main` is a call waiting for its
 *    caller and the caller is one line away.
 * 2. **A basename read as an identity.** `spec.endsWith("/cli-ledger.js")`
 *    accepted `import { stageCli } from "./fake/cli-ledger.js"` where the fake
 *    ran `main()` bare. Import specifiers are now *resolved* against the
 *    importing file — which is why every fixture below is named
 *    `src/fixture.ts`. That the entrypoint guards this whole item is about were
 *    making the very same mistake at the very same time is not a coincidence:
 *    it is what `src/is-main.ts` is for.
 *
 * The old tail's two guard idioms are both still understood — `import.meta` in
 * the `if` test itself, and a top-level `const isMain = …import.meta…` the `if`
 * then names — because harmonising them is what §2.5 is for and it is not
 * finished.
 *
 * ## The edge of this, said out loud
 *
 * Four tests, and each is narrower than the sentence people will remember:
 *
 * - **`wraps every listed stage CLI entrypoint`** checks the nine modules in
 *   `PAID_CLIS`, and nothing else. It says nothing about evals, which open the
 *   ledger with the `"eval"` scope.
 * - **`names every package.json entry module that imports a provider seam`**
 *   keeps that list from going stale — but only for a module that **directly**
 *   imports one of the two seams. A CLI that reaches a paid call transitively
 *   is invisible to it, and following that would need real dataflow.
 * - **`keeps the unledgered CLIs it cannot see named`** is the patch over that
 *   hole, and it is a register rather than a detector. `npm run
 *   eval:dictation-vocab` spends — `bench-vocabulary-sources.ts` →
 *   `transcribeWith` → `openRouterJson` — with no ledger open, and the two
 *   rules above cannot see it. It is not an undiscovered leak: it is admitted
 *   by name, with a reason, as `dictation-bench-vocabulary-sources`
 *   (`kind: "unscoped"`) in [`src/spend-declarations.ts`](../src/spend-declarations.ts),
 *   and `npm run cost` prints it every run. `ADMITTED` below has to agree with
 *   that list in both directions, so a second one cannot arrive quietly.
 * - **`stageCli itself opens the ledger`** checks one function in one file. It
 *   is what the three migrated CLIs stopped saying for themselves, and it says
 *   nothing about the five that have not moved.
 *
 * This is a tripwire, not a boundary — the same thing
 * `tests/no-undeclared-spend.test.ts` says about itself. The ordinary case is
 * somebody copying a stage CLI and leaving one line out, and that is the case
 * that has happened twice.
 */

import { parse } from "@babel/parser";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DECLARATIONS } from "../src/spend-declarations.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * **The CLIs that spend money, and the npm script that starts each.**
 *
 * Explicit rather than derived, because "which modules can spend" is the
 * question `tests/no-undeclared-spend.test.ts` already answers and this one is
 * about entrypoints. The completeness check below stops the list going stale.
 */
const PAID_CLIS: Readonly<Record<string, string>> = {
  "src/arc.ts": "npm run arc — streamMessage per part",
  "src/glossary.ts": "npm run glossary — streamMessage per batch",
  "src/ideas.ts": "npm run ideas — streamMessage",
  "src/labels.ts": "npm run labels — streamMessage per batch",
  "src/pdf-read.ts": "npm run pdf — openRouterJson per chunk",
  "src/quotes.ts": "npm run quotes — streamMessage",
  "src/timeline.ts": "npm run timeline — streamMessage",
  "src/hierarchy.ts": "npm run hierarchy — streamMessage",
  "src/tweets.ts": "npm run tweets — streamMessage",
};

/** The two modules that can reach a provider. Naming one is spending money. */
const SEAMS = ["/ai-call.js", "/messages-stream.js"];

type Node = Record<string, unknown>;

/**
 * Babel's options, matching `tests/no-undeclared-spend.test.ts`.
 *
 * `errorRecovery` for the same reason it does: a file this cannot parse yields
 * no nodes, and no nodes reads exactly like a clean file. The errors are counted
 * and turned into an offence rather than thrown away.
 */
function parseSource(source: string): { body: Node[]; errors: number } {
  try {
    const ast = parse(source, {
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: ["typescript", "decorators-legacy", "explicitResourceManagement"],
    });
    return { body: ast.program.body as unknown as Node[], errors: ast.errors?.length ?? 0 };
  } catch {
    /* Recovery does not cover everything — some tokens still throw. Either way
       the answer is the same: no nodes, so nothing was checked, so it is an
       offence rather than a clean file. */
    return { body: [], errors: 1 };
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

/** The name every one of these modules gives its entry function. */
const MAIN = "main";

/** The export in src/env.ts that reads `.env.local`, by its name at the source. */
const LOAD_ENV = "loadEnvLocal";

/**
 * **The one-line tail** — `await stageCli(import.meta.url, main)` — and the two
 * exports it is made of. A CLI on `stageCli` names none of these itself, which
 * is the point of it; `stageCliOffence` below is what stands in for the checks
 * the file no longer carries.
 */
const STAGE = "stageCli";
const LEDGER = "withLedger";
const IS_MAIN = "isMain";

/** Nodes whose body is code the surrounding statement *defines* rather than runs. */
const FUNCTIONS = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "ClassDeclaration",
  "ClassExpression",
  "TSDeclareFunction",
  "TSDeclareMethod",
]);

/**
 * **How far a walk reaches.**
 *
 * `deferred: false` is *what this region runs* — nested statements, both halves
 * of an `if`, variable initialisers, call arguments — stopping at any function
 * it merely defines, because that body runs only if something calls it.
 * `deferred: true` is everything under the node.
 *
 * `skip` leaves whole subtrees alone. It holds the arguments a correct
 * `withLedger("cli", …)` call is already holding, which is the one place `main`
 * is allowed to appear.
 */
interface Reach {
  readonly deferred: boolean;
  readonly skip?: ReadonlySet<unknown>;
}

/**
 * An identifier that is a **name** here rather than a value being read:
 * `x.main`, `{ main: … }`, the `main` in `const main = …`. Without this, a
 * module that declares `const main = …` would be reported as reaching `main`
 * outside the ledger by its own declaration.
 */
function namesRatherThanReads(n: Node, key: string): boolean {
  switch (n.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return key === "property" && n.computed !== true;
    case "ObjectProperty":
      return key === "key" && n.computed !== true;
    case "VariableDeclarator":
    case "FunctionDeclaration":
    case "ClassDeclaration":
      return key === "id";
    case "ImportDeclaration":
      return true;
    default:
      return false;
  }
}

/** Every node once, comments skipped — the same walker shape as the spend gate. */
function walk(node: unknown, reach: Reach, visit: (n: Node) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, reach, visit);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  if (reach.skip?.has(n)) return;
  if (!reach.deferred && FUNCTIONS.has(n.type)) return;
  visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(key)) continue;
    if (namesRatherThanReads(n, key)) continue;
    walk(value, reach, visit);
  }
}

const EVERYTHING: Reach = { deferred: true };

/** `import.meta`, however it is spelled downstream — `.url` or `.filename`. */
function mentionsImportMeta(node: unknown): boolean {
  let found = false;
  walk(node, EVERYTHING, (n) => {
    if (n.type === "MetaProperty" && (n.meta as { name?: string } | undefined)?.name === "import") {
      found = true;
    }
  });
  return found;
}

function mentionsAnyName(node: unknown, names: ReadonlySet<string>): boolean {
  let found = false;
  walk(node, EVERYTHING, (n) => {
    if (n.type === "Identifier" && names.has(n.name as string)) found = true;
  });
  return found;
}

/** The three modules the rules below are about, by their path from the repo root. */
const CLI_LEDGER = "src/cli-ledger.ts";
const ENV_MODULE = "src/env.ts";
const IS_MAIN_MODULE = "src/is-main.ts";

/**
 * **Whether an import specifier names a particular module** — resolved, not
 * matched by its tail.
 *
 * This was `spec.endsWith("/cli-ledger.js")` until GPT Sol beat it on
 * 2026-08-28 by *executing* the detector against
 * `import { stageCli } from "./fake/cli-ledger.js"`, where the fake calls
 * `main()` bare. The gate returned `null`. A basename is not an identity, which
 * is the same mistake the entrypoint guards this whole item is about were
 * making at the same time — `src/is-main.ts` has the other half of it.
 *
 * Only a relative specifier can name a file in this repo, so a bare one is
 * refused outright rather than resolved against `node_modules`.
 */
function resolvesTo(file: string, spec: string, module: string): boolean {
  if (!spec.startsWith(".")) return false;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return resolved.replace(/\.js$/, ".ts") === module;
}

/**
 * The local name a given export was imported under, or `null`.
 *
 * **By binding, not by spelling.** A file that defines its own `withLedger` and
 * calls it has satisfied every text matcher and opened no ledger; this is the
 * check that tells the two apart. `envOffence` needs exactly the same question
 * asked about `loadEnvLocal`, which is why this takes the module and the export
 * rather than hard-coding one pair.
 *
 * **And by module, not by basename** — see `resolvesTo`. It needs the importing
 * file's own path to resolve a relative specifier, which is why every caller
 * passes one; the fixtures below are named `src/fixture.ts` for exactly that
 * reason rather than as decoration.
 */
function importedLocalName(
  file: string,
  body: Node[],
  module: string,
  exported: string,
): string | null {
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
    if (!resolvesTo(file, spec, module)) continue;
    if (stmt.importKind === "type") continue;
    for (const sp of (stmt.specifiers ?? []) as Node[]) {
      if (sp.type !== "ImportSpecifier" || sp.importKind === "type") continue;
      if ((sp.imported as { name?: string } | undefined)?.name === exported) {
        return (sp.local as { name: string }).name;
      }
    }
  }
  return null;
}

/** The local name `withLedger` was imported under, or `null`. */
function ledgerLocalName(file: string, body: Node[]): string | null {
  return importedLocalName(file, body, CLI_LEDGER, LEDGER);
}

/** The local name `stageCli` was imported under, or `null`. */
function stageLocalName(file: string, body: Node[]): string | null {
  return importedLocalName(file, body, CLI_LEDGER, STAGE);
}

/**
 * **Whether this region *runs* a declaration of `name`**, shadowing something
 * outer.
 *
 * `shadowsBinding` above asks the same question with `deferred: true`, which is
 * right for a guard branch that is about to hand a lambda somewhere. This one
 * stops at any function it merely defines, which is what the module top level
 * and the body of `stageCli` need: a helper elsewhere in the file that happens
 * to take a parameter called `withLedger` shadows nothing here, and reporting it
 * would make the gate noisy rather than strict. The shadow it does catch is the
 * one that matters — `{ const stageCli = fake; stageCli(import.meta.url, main); }`
 * at the top level, which satisfies every check that reads the callee's spelling
 * and starts nothing.
 */
function shadowsWhereItRuns(node: unknown, name: string): boolean {
  let found = false;
  walk(node, { deferred: false }, (n) => {
    if (n.type === "VariableDeclarator" && bindsName(n.id, name)) found = true;
    const id = n.id as { name?: string } | undefined;
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && id?.name === name) {
      found = true;
    }
  });
  return found;
}

/**
 * The top-level `if`s that run when this module is the entry file.
 *
 * A guard is an `if` whose test either names `import.meta` itself, or names a
 * top-level `const` whose initialiser does. Both idioms are in the tree.
 */
function entrypointGuards(body: Node[]): Node[] {
  const guardVars = new Set<string>();
  for (const stmt of body) {
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of (stmt.declarations ?? []) as Node[]) {
      const id = d.id as { type?: string; name?: string } | undefined;
      if (id?.type === "Identifier" && id.name && mentionsImportMeta(d.init)) guardVars.add(id.name);
    }
  }
  return body.filter(
    (s) =>
      s.type === "IfStatement" &&
      (mentionsImportMeta(s.test) || mentionsAnyName(s.test, guardVars)),
  );
}

/**
 * The call underneath a call, and what it is called.
 *
 * `withLedger(…)`, `void withLedger(…)`, `await withLedger(…)` and
 * `withLedger(…).catch(…)` all come back as `withLedger` **and the node holding
 * its arguments** — returning only the name read the `.catch()` call's empty
 * argument list as a missing `"cli"` scope, which is the sort of near-miss that
 * makes a gate noisy rather than wrong. Anything whose callee is not a plain
 * identifier comes back under a name that can match nothing, which is the safe
 * direction: an offence rather than a silent pass.
 */
const NOT_PLAIN = "<not a plain call>";

function rootCall(call: Node): { name: string; call: Node } {
  const callee = call.callee as Node | undefined;
  if (callee?.type === "Identifier") return { name: callee.name as string, call };
  if (callee?.type === "MemberExpression") {
    const object = callee.object as Node | undefined;
    /* `withLedger("cli", main).catch(…)` — the chain's root is the real call. */
    if (object?.type === "CallExpression") return rootCall(object);
  }
  return { name: NOT_PLAIN, call };
}

/**
 * **Every call the branch runs**, at any depth.
 *
 * The first version of this read only the top-level `ExpressionStatement`s of
 * the branch, which is three bypasses wide and all three are ordinary code:
 * `if (isMain) { const running = main(); … }` (an initialiser), `if (isMain) {
 * if (dry) await main(); … }` (one statement deeper), and anything in an `else`
 * within the branch. Each of those ran `main` outside the ledger and the gate
 * returned `null`.
 */
function executedCalls(branch: Node): Node[] {
  const calls: Node[] = [];
  walk(branch, { deferred: false }, (n) => {
    if (n.type === "CallExpression" || n.type === "OptionalCallExpression") calls.push(n);
  });
  return calls;
}

/**
 * **Whether this region declares its own `name`**, shadowing the import.
 *
 * `const withLedger = async (_scope, fn) => fn()` inside the branch is legal,
 * invisible to every check that reads the *spelling* of the callee, and opens
 * no ledger. `ledgerLocalName` proves the module imports the real wrapper;
 * this is what proves the call in the branch is reaching it.
 */
function shadowsBinding(node: unknown, name: string): boolean {
  let found = false;
  walk(node, EVERYTHING, (n) => {
    if (n.type === "VariableDeclarator" && bindsName(n.id, name)) found = true;
    const id = n.id as { name?: string } | undefined;
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && id?.name === name) {
      found = true;
    }
    if (!FUNCTIONS.has(n.type as string)) return;
    for (const p of (n.params ?? []) as Node[]) {
      if (bindsName(p, name)) found = true;
    }
  });
  return found;
}

/**
 * **Whether this binding target introduces `name`, however it is spelled.**
 *
 * `const loadEnvLocal = …` was the only form the first version looked for, and
 * `const { loadEnvLocal } = helpers` walked straight past it — GPT Sol, on the
 * `.env.local` rule, 2026-08-28. A destructured shadow is no less a shadow, so
 * this recurses through the patterns instead of testing one node type.
 */
function bindsName(target: unknown, name: string): boolean {
  let found = false;
  walk(target, EVERYTHING, (n) => {
    if (n.type !== "Identifier" || n.name !== name) return;
    found = true;
  });
  return found;
}

/**
 * **Whether the wrapper is actually being handed `main`** — as the argument
 * itself, or as a lambda that calls it.
 *
 * This is the check that separates `withLedger("cli", main)` from
 * `withLedger("cli", async () => {}).then(main)`, which calls the right wrapper
 * with the right scope and runs the whole program after the ledger has closed.
 */
function runsMain(arg: Node | undefined): boolean {
  if (!arg) return false;
  if (arg.type === "Identifier") return arg.name === MAIN;
  if (arg.type !== "ArrowFunctionExpression" && arg.type !== "FunctionExpression") return false;
  let calls = false;
  walk(arg, EVERYTHING, (n) => {
    const callee = n.callee as Node | undefined;
    if (n.type === "CallExpression" && callee?.type === "Identifier" && callee.name === MAIN) {
      calls = true;
    }
  });
  return calls;
}

/** Whether `main` is named anywhere in this region, outside `skip`. */
function reachesMain(node: unknown, reach: Reach): boolean {
  let found = false;
  walk(node, reach, (n) => {
    if (n.type === "Identifier" && n.name === MAIN) found = true;
  });
  return found;
}

/** Whether the module declares the entry function at all. */
function declaresMain(body: Node[]): boolean {
  for (const raw of body) {
    const stmt =
      raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
        ? ((raw.declaration as Node | undefined) ?? raw)
        : raw;
    const id = stmt.id as { name?: string } | undefined;
    if (stmt.type === "FunctionDeclaration" && id?.name === MAIN) return true;
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of (stmt.declarations ?? []) as Node[]) {
      const declared = d.id as { type?: string; name?: string } | undefined;
      if (declared?.type === "Identifier" && declared.name === MAIN) return true;
    }
  }
  return false;
}

/**
 * **The top-level function of a given name, if it is a function at all.**
 *
 * `declaresMain` above answers whether the name exists, which is all the ledger
 * rule needs. This one hands back the body, because the `.env.local` rule is
 * about what happens *inside* it — and so is the rule about `stageCli`, which is
 * why this takes the name rather than hard-coding `main`.
 */
function topLevelFunction(body: Node[], name: string): Node | null {
  for (const raw of body) {
    const stmt =
      raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
        ? ((raw.declaration as Node | undefined) ?? raw)
        : raw;
    const id = stmt.id as { name?: string } | undefined;
    if (stmt.type === "FunctionDeclaration" && id?.name === name) return stmt;
    if (stmt.type !== "VariableDeclaration") continue;
    for (const d of (stmt.declarations ?? []) as Node[]) {
      const declared = d.id as { type?: string; name?: string } | undefined;
      if (declared?.type !== "Identifier" || declared.name !== name) continue;
      const init = d.init as Node | undefined;
      if (init && FUNCTIONS.has(init.type as string)) return init;
      return null;
    }
  }
  return null;
}

function mainFunction(body: Node[]): Node | null {
  return topLevelFunction(body, MAIN);
}

/**
 * **Every paid CLI reads `.env.local` before it spends.**
 *
 * The gap this closes is not money, it is a lie about the machine. Seven of the
 * eight call `loadEnvLocal()` at the top of `main`; `src/pdf-read.ts` did not,
 * so `npm run pdf x.pdf` from a shell with no exported key failed with
 * "OPENROUTER_API_KEY is not set" while the key sat in `.env.local` — a missing
 * credential, apparently, rather than an unread file. `src/ideas.ts` carried a
 * comment calling that a real gap across the other stages; by the time this was
 * written the comment was true of one file and named none of them.
 *
 * **In `main`, and it is checked there on purpose.** That same comment says why:
 * doing it inside the generator would be a no-op under the server, which loads
 * `.env.local` through `vite.config.ts` before any stage runs, and would pull
 * `node:fs` into a path that has no use for it.
 *
 * **Three things have to hold, and the first version checked only the third.**
 * GPT Sol beat it three ways on 2026-08-28, and none of the three needed
 * cleverness — they are all ordinary code:
 *
 * 1. the call is a **statement of `main` itself**, not nested in an `if`, a
 *    loop, a `try` or a helper. `if (false) loadEnvLocal();` runs nothing and
 *    satisfied every check that only asked whether the call appears;
 * 2. **nothing before it awaits or returns**, so the file cannot be read after
 *    the money has been spent. `main() { await spend(); loadEnvLocal(); }` was
 *    the sharpest of the three: it is in `main`, it runs, and it is useless.
 *    All eight CLIs read `process.argv`, refuse a missing argument and then call
 *    this, so the shape is already uniform — `src/pdf-read.ts` was moved up one
 *    statement to join them rather than the rule being loosened to fit it;
 * 3. the name is **bound to the `./env.js` import**, including through a
 *    destructured shadow — `const { loadEnvLocal } = helpers` walked past the
 *    first version of the shadow check.
 *
 * What it still cannot see: a spend reached without `await`, and a helper called
 * before it that spends synchronously. Neither exists here, and both would need
 * real dataflow. This is a tripwire, not a boundary.
 */
export function envOffence(file: string, source: string): string | null {
  const { body, errors } = parseSource(source);
  if (errors > 0) {
    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
  }
  const local = importedLocalName(file, body, ENV_MODULE, LOAD_ENV);
  if (!local) return `${file} — imports no ${LOAD_ENV} from ./env.js`;

  const main = mainFunction(body);
  if (!main) return `${file} — declares no top-level ${MAIN}() function to read .env.local in`;

  /* Same trap as the ledger rule: a local of the same spelling satisfies every
     matcher that reads the callee's text and reads no file. */
  if (shadowsBinding(main.body, local)) {
    return `${file} — ${MAIN}() declares its own ${local}, shadowing the import from ./env.js`;
  }

  const statements = ((main.body as Node | undefined)?.body ?? []) as Node[];
  const at = statements.findIndex((stmt) => isCallStatement(stmt, local));
  if (at === -1) {
    return `${file} — ${MAIN}() never calls ${local}() as a statement of its own, so a key in .env.local goes unread`;
  }

  /* **Everything before it must be free of `await` and of `return`.** An `await`
     before it is a spend the file has not been read for; a `return` before it is
     a call that does not happen. Both pass a check that asks only whether the
     call is there. */
  for (const stmt of statements.slice(0, at)) {
    if (defersOrReturns(stmt)) {
      return `${file} — ${MAIN}() awaits or returns before ${local}(), so .env.local is read after the work has started`;
    }
  }
  return null;
}

/** `loadEnvLocal();` as a statement of the enclosing block — nothing nested. */
function isCallStatement(stmt: Node, local: string): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  const expr = stmt.expression as Node | undefined;
  const call = expr?.type === "AwaitExpression" ? (expr.argument as Node | undefined) : expr;
  if (call?.type !== "CallExpression" && call?.type !== "OptionalCallExpression") return false;
  const callee = call.callee as Node | undefined;
  return callee?.type === "Identifier" && callee.name === local;
}

/** Whether this statement can suspend or leave `main` — `await` or `return`, at any depth it runs. */
function defersOrReturns(stmt: Node): boolean {
  let found = false;
  walk(stmt, { deferred: false }, (n) => {
    if (n.type === "AwaitExpression" || n.type === "ReturnStatement") found = true;
  });
  return found;
}

/**
 * **The verdict on one call the entrypoint branch runs.**
 *
 * `null` means it is the wrapper, opened correctly — and the argument it is
 * holding goes into `wrapped`, which is what the reach check afterwards leaves
 * alone when it looks for `main` anywhere else.
 */
function callOffence(
  call: Node,
  file: string,
  ledger: string,
  wrapped: Set<unknown>,
): string | null {
  const { name, call: opened } = rootCall(call);
  if (name === NOT_PLAIN) {
    return `${file} — the entrypoint branch runs a call whose callee is not ${ledger}`;
  }
  if (name !== ledger) {
    return `${file} — the entrypoint branch calls ${name}() directly rather than ${ledger}("cli", …)`;
  }
  const [first, second] = opened.arguments as Node[];
  if (first?.type !== "StringLiteral" || first.value !== "cli") {
    return `${file} — ${ledger} is not called with the "cli" scope`;
  }
  if (!runsMain(second)) {
    return `${file} — ${ledger}("cli", …) is not passed ${MAIN}(), so ${MAIN}() runs outside the ledger`;
  }
  wrapped.add(second);
  return null;
}

/**
 * **The whole verdict for one module**, as a function so it can be handed
 * source text directly — including source that is deliberately broken, which is
 * the only way to watch this go red. Returns `null` when the entrypoint is
 * metered, and a sentence naming the file when it is not.
 *
 * Four things have to hold, and the first version of this checked only the
 * middle two:
 *
 * 1. the name being called is **bound to the import** from `cli-ledger.js`, not
 *    to a local of the same spelling;
 * 2. it is called with the `"cli"` scope;
 * 3. it is handed **`main`** — `withLedger("cli", async () => {}).then(main)`
 *    satisfies 1 and 2 and runs the whole program outside the ledger;
 * 4. and `main` is reached nowhere else, at any depth, in either half of the
 *    guard or beside it at the top level.
 */
export function ledgerOffence(file: string, source: string): string | null {
  const { body, errors } = parseSource(source);
  if (errors > 0) {
    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
  }

  /* **Two forms, during a migration that is deliberately partial.** Five of the
     eight files below are dirty with other agents' work and cannot be touched,
     so both tails have to be accepted at once — and the one thing that must not
     happen is the rule being loosened into "the wrapper is somewhere" to cover
     both. They are checked separately and each is checked whole. The file picks
     its form by what it imports and runs, not by which of the two is easier to
     satisfy. */
  const stage = stageLocalName(file, body);
  if (stage !== null) return stageOffence(file, body, stage);

  const ledger = ledgerLocalName(file, body);
  if (!ledger) return `${file} — imports no withLedger from ./cli-ledger.js`;
  if (!declaresMain(body)) return `${file} — declares no top-level ${MAIN}() for the ledger to wrap`;

  const guards = entrypointGuards(body);
  if (guards.length === 0) return `${file} — has no top-level entrypoint guard testing import.meta`;

  /* The arguments a correct wrapper call is holding: the one place `main` may
     be named, and so the one thing the reach checks below leave alone. */
  const wrapped = new Set<unknown>();

  for (const guard of guards) {
    const branch = guard.consequent as Node;
    if (shadowsBinding(branch, ledger)) {
      return `${file} — the entrypoint branch declares its own ${ledger}, shadowing the import from ./cli-ledger.js`;
    }
    const calls = executedCalls(branch);
    if (calls.length === 0) {
      return `${file} — the entrypoint branch invokes nothing directly, so nothing proves it opens the ledger`;
    }
    for (const call of calls) {
      const offence = callOffence(call, file, ledger, wrapped);
      if (offence) return offence;
    }
  }

  /* **And nothing else reaches main, anywhere in the module.** This used to
     read the top level with `deferred: false`, on the argument that a function
     body is not run. That is true of the body and false of the module: a helper
     closing over `main` is a call waiting for a caller, and
     `async function leak() { await main(); }` beside `await leak();` was green.
     Sol found it on the new tail by execution, 2026-08-28; the same hole was
     here. There is no legitimate second mention of `main` in a stage CLI. */
  const stray = body.some((s) => reachesMain(s, { deferred: true, skip: wrapped }));
  if (stray) {
    return `${file} — ${MAIN}() is reached outside ${ledger}("cli", ${MAIN}), so it can spend outside the ledger`;
  }
  return null;
}

/**
 * **The one-line tail, checked as a whole line rather than as a mention.**
 *
 * A CLI on `stageCli` has no guard and no `withLedger` of its own to inspect —
 * that is the point of docs/plans/260828aj-simplification-wave-2.md §2.5, and it is also
 * the obvious way to make this gate stop meaning anything. The temptation is to
 * relax the rule to "a `stageCli` call appears somewhere". That is the proximity
 * grep GPT Sol already refused once, wearing a different name.
 *
 * So the rule gets **stronger** instead. Where the old form asked four questions
 * of each file, this asks the same four of a single line and then asks the
 * remaining ones **once**, of `src/cli-ledger.ts`, in `stageCliOffence` below:
 *
 * 1. the name is **bound to the import** from `cli-ledger.js`, not to a local of
 *    the same spelling — including a block-scoped one at the top level, which is
 *    ordinary code and starts nothing;
 * 2. it is handed **this module's own `import.meta`**. `stageCli("file:///…", main)`
 *    calls the right function with a hard-coded answer, which is the version of
 *    this bug that would survive a rename;
 * 3. it is handed **`main`**;
 * 4. and `main` is reached nowhere else in the module *at all* — see below.
 *
 * What it does not ask is whether the ledger opens, because that is no longer a
 * fact about this file. `stageCliOffence` asks it once, of the helper.
 *
 * ## What the first version of this got wrong, found by execution
 *
 * GPT Sol beat it on 2026-08-28 by *running* it, and both beats are ordinary
 * code:
 *
 * ```ts
 * async function leak() { await main(); }
 * await leak();
 * if (false) await stageCli(import.meta.url, main);
 * ```
 *
 * `executedCalls` found the `stageCli` call **inside the dead branch** and
 * counted it as the tail, while the reach check walked past `leak`'s body
 * because a function definition is not a call. Right tail, unreachable; wrong
 * call, reached. The gate returned `null`.
 *
 * Two changes, and they are the same idea twice — *stop asking whether the
 * syntax is present and start asking whether it is the statement that runs*:
 *
 * - **the tail must be a top-level `await stageCli(…)` statement**, exactly one
 *   of them, not a call found somewhere under the top level. A call in an `if`,
 *   in a `try`, behind a `void`, or with `.then()` chained onto it is not the
 *   tail. `void` is refused here even though the old form allows it — plan §0.1
 *   is explicit that awaiting is what keeps the ledger flush and any failure
 *   part of the command finishing, and all three files on this tail await;
 * - **`main` may not be named anywhere else in the file**, function bodies
 *   included. The old reading — "a function body is not run" — is true of the
 *   body and false of the module, because something at the top level then calls
 *   it. There is no legitimate second mention of `main` in a stage CLI.
 */
function stageOffence(file: string, body: Node[], stage: string): string | null {
  if (!declaresMain(body)) return `${file} — declares no top-level ${MAIN}() for ${stage}() to run`;
  if (shadowsWhereItRuns(body, stage)) {
    return `${file} — the top level declares its own ${stage}, shadowing the import from ${CLI_LEDGER}`;
  }

  const tails = body.filter((s) => awaitedCallStatement(s, stage) !== null);
  if (tails.length === 0) {
    /* **Near-miss and absent are different reports**, because the fix differs.
       A `void`, a `.then()` chain, or a call nested in an `if` all read as a
       tail and are not one — that is the dead-branch bypass, and saying "there
       is no tail" about a file that visibly contains one would send the reader
       looking for the wrong thing. */
    const loose = executedCalls({ type: "Program", body } as unknown as Node).some(
      (c) => rootCall(c).name === stage,
    );
    if (loose) {
      return `${file} — runs ${stage}() at the top level but not as \`await ${stage}(…);\` — a \`void\`, a \`.then()\` or a call inside an \`if\` each let ${MAIN}() run outside the ledger`;
    }
    return `${file} — has no top-level \`await ${stage}(import.meta.url, ${MAIN})\` statement, so nothing here proves the CLI starts inside the ledger`;
  }
  if (tails.length > 1) {
    return `${file} — runs ${stage}() more than once at the top level, so which one starts the CLI is not known`;
  }

  const opened = awaitedCallStatement(tails[0] as Node, stage) as Node;
  const [first, second] = opened.arguments as Node[];
  if (!mentionsImportMeta(first)) {
    return `${file} — ${stage}() is not passed import.meta.url, so the guard is asking about some other module`;
  }
  if (!runsMain(second)) {
    return `${file} — ${stage}(…) is not passed ${MAIN}(), so ${MAIN}() runs outside the ledger`;
  }

  /* **Everywhere, not just where it runs.** A helper that closes over `main` is
     a call waiting for a caller, and the caller is one line away. */
  const wrapped = new Set<unknown>([second]);
  if (body.some((s) => reachesMain(s, { deferred: true, skip: wrapped }))) {
    return `${file} — ${MAIN}() is reached outside ${stage}(import.meta.url, ${MAIN}), so it can spend outside the ledger`;
  }
  return null;
}

/**
 * **`await f(…);` as a statement of the enclosing block** — the call node, or
 * `null`.
 *
 * Deliberately narrow, and the narrowness is the check. `void f(…)`, `f(…)`,
 * `f(…).then(g)`, and anything nested inside an `if` or a `try` are all *not*
 * this, and each of them is one of the ways an entrypoint can read correct and
 * behave otherwise.
 */
function awaitedCallStatement(stmt: Node, name: string): Node | null {
  if (stmt.type !== "ExpressionStatement") return null;
  const expr = stmt.expression as Node | undefined;
  if (expr?.type !== "AwaitExpression") return null;
  const call = expr.argument as Node | undefined;
  if (call?.type !== "CallExpression") return null;
  const callee = call.callee as Node | undefined;
  return callee?.type === "Identifier" && callee.name === name ? call : null;
}

/**
 * **And the helper itself opens the ledger** — asked once, of one file.
 *
 * This is what the eight files stop saying for themselves when they move onto
 * `stageCli`. Every guarantee the old per-file rule made now rests on four lines
 * in [`src/cli-ledger.ts`](../src/cli-ledger.ts), so those four lines get the
 * same treatment the eight tails used to get, in the order they have to happen:
 *
 * 1. **the guard first** — `stageCli` returns unless `isMain(entry)`, so an
 *    imported stage does not run as a side effect of the import. Without this
 *    the helper is worse than the duplication it replaced: it would start eight
 *    CLIs at once;
 * 2. **`.env.local` before the money** — read as a statement of `stageCli`, with
 *    nothing awaiting before it. The Tier 1 review's finding was a
 *    `loadEnvLocal()` that runs *after* the spending, which is in the right
 *    function, runs, and is useless;
 * 3. **`withLedger("cli", …)`**, bound to this module's own top-level function
 *    rather than a local of the same spelling, holding the entry function it was
 *    handed;
 * 4. and that entry function is **reached nowhere else** in `stageCli`, so there
 *    is no path on which it runs unmetered.
 *
 * Positions, not merely presence: a check that only asked whether the three
 * calls appear would pass `await withLedger("cli", main); if (!isMain(entry)) return;`,
 * which spends on every import.
 */
export function stageCliOffence(file: string, source: string): string | null {
  const { body, errors } = parseSource(source);
  if (errors > 0) {
    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
  }

  const fn = topLevelFunction(body, STAGE);
  if (!fn) return `${file} — declares no top-level ${STAGE}() for the paid CLIs to hand their entrypoint to`;
  if (!topLevelFunction(body, LEDGER)) {
    return `${file} — declares no top-level ${LEDGER}() for ${STAGE}() to reach`;
  }

  const [entry, run] = ((fn.params ?? []) as Node[]).map((p) =>
    p.type === "Identifier" ? (p.name as string) : null,
  );
  if (!entry || !run) {
    return `${file} — ${STAGE}() does not take a plain (entry, main), so there is nothing here to follow`;
  }

  for (const name of [LEDGER, IS_MAIN, run]) {
    if (shadowsWhereItRuns(fn.body, name)) {
      return `${file} — ${STAGE}() declares its own ${name}, shadowing the one this checks`;
    }
  }

  const statements = ((fn.body as Node | undefined)?.body ?? []) as Node[];
  const guardedBy = importedLocalName(file, body, IS_MAIN_MODULE, IS_MAIN);
  if (!guardedBy) return `${file} — imports no ${IS_MAIN} from ${IS_MAIN_MODULE}`;
  const env = importedLocalName(file, body, ENV_MODULE, LOAD_ENV);
  if (!env) return `${file} — imports no ${LOAD_ENV} from ${ENV_MODULE}`;
  if (shadowsWhereItRuns(fn.body, env)) {
    return `${file} — ${STAGE}() declares its own ${env}, shadowing the import from ${ENV_MODULE}`;
  }

  /* **Three statements, in this order, and nothing else.** The index-and-
     predicate version of this was beaten four ways by GPT Sol on 2026-08-28,
     each time by syntax that was present and did not run: `if (isMain(entry))
     return` (the polarity), `if (x) return` inside the guard (a conditional
     exit), a bare `return;` between the guard and the read, and
     `if (false) await withLedger("cli", main)`. Every one of them left the
     positions in the right order.

     So the shape is required outright rather than sampled. This is four lines
     that eight CLIs depend on and say nothing about for themselves; if somebody
     adds a fifth, the right outcome is that this goes red and gets read, not
     that it quietly keeps passing on the strength of what is still there. */
  if (statements.length !== 3) {
    return `${file} — ${STAGE}() is not exactly \`if (!${guardedBy}(${entry})) return; ${env}(); await ${LEDGER}("cli", ${run});\` — it has ${statements.length} statement(s), and every guarantee the CLIs stopped making rests on those three`;
  }
  const [guard, reads, opens] = statements as [Node, Node, Node];

  /* 1. The guard, negated and leaving unconditionally. */
  if (!refusesUnless(guard, guardedBy, entry)) {
    return `${file} — ${STAGE}() does not begin \`if (!${guardedBy}(${entry})) return;\`, so it does not reliably refuse to run on import`;
  }

  /* 2. `.env.local`, as the next thing that happens. */
  if (!isCallStatement(reads, env)) {
    return `${file} — ${STAGE}() does not call ${env}() as the statement after the guard, so a key in .env.local goes unread`;
  }

  /* 3. The wrapper, awaited, holding the entry function. */
  const opened = awaitedCallStatement(opens, LEDGER);
  if (!opened) {
    return `${file} — ${STAGE}() does not end with \`await ${LEDGER}(…)\` as a statement of its own, so a CLI on ${STAGE} can finish before the ledger does`;
  }
  const [scope, wrapped] = opened.arguments as Node[];
  if (scope?.type !== "StringLiteral" || scope.value !== "cli") {
    return `${file} — ${STAGE}() does not open ${LEDGER} with the "cli" scope`;
  }
  if (wrapped?.type !== "Identifier" || wrapped.name !== run) {
    return `${file} — ${STAGE}() does not hand ${run} to ${LEDGER}("cli", …), so a CLI runs outside the ledger`;
  }

  /* 4. And nothing else in the function is holding the entry function. */
  const allowed = new Set<unknown>([wrapped]);
  const stray = statements.some((s) => {
    let found = false;
    walk(s, { deferred: true, skip: allowed }, (n) => {
      if (n.type === "Identifier" && n.name === run) found = true;
    });
    return found;
  });
  if (stray) {
    return `${file} — ${STAGE}() reaches ${run} outside ${LEDGER}("cli", ${run}), so a CLI could run outside the ledger`;
  }
  return null;
}

/**
 * **`if (!f(x)) return;`** — the guard, with its polarity and its exit.
 *
 * The first version asked only whether `f(x)` appeared somewhere in the test and
 * whether a `return` appeared somewhere under the consequent. Both halves were
 * beatable, and neither beat needs cleverness: `if (isMain(entry)) return;` runs
 * the CLI on every import and refuses to run it when started, and
 * `if (!isMain(entry)) { if (x) return; }` exits only sometimes. A guard that is
 * right about *when* and wrong about *whether* is not a guard.
 */
function refusesUnless(stmt: Node, fn: string, arg: string): boolean {
  if (stmt.type !== "IfStatement" || stmt.alternate) return false;
  const test = stmt.test as Node | undefined;
  if (test?.type !== "UnaryExpression" || test.operator !== "!") return false;
  const call = test.argument as Node | undefined;
  if (call?.type !== "CallExpression") return false;
  const callee = call.callee as Node | undefined;
  if (callee?.type !== "Identifier" || callee.name !== fn) return false;
  const args = (call.arguments ?? []) as Node[];
  if (args.length !== 1 || args[0]?.type !== "Identifier" || args[0].name !== arg) return false;

  /* Unconditionally, which means the `return` is the consequent itself or the
     one statement of its block — not something reached along one path. */
  const consequent = stmt.consequent as Node;
  if (consequent.type === "ReturnStatement") return true;
  if (consequent.type !== "BlockStatement") return false;
  const inner = (consequent.body ?? []) as Node[];
  return inner.length === 1 && inner[0]?.type === "ReturnStatement";
}

/** Whether a module reaches a provider seam by importing one for its values. */
function importsSeam(source: string): boolean {
  return parseSource(source).body.some((stmt) => {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") return false;
    const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
    if (!SEAMS.some((s) => spec.endsWith(s))) return false;
    return ((stmt.specifiers ?? []) as Node[]).some((sp) => sp.importKind !== "type");
  });
}

const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");

/**
 * **Every module an npm script starts with `tsx`**, in any directory.
 *
 * Widened from `tsx src/…`: an eval or a script that imported a seam was
 * outside the old pattern and therefore invisible to the completeness check,
 * which is not something the reader of `names every paid CLI package.json can
 * start` would have guessed. Files that are not there are skipped rather than
 * thrown on — a script naming a missing module is a different test's business,
 * and half-written work sits in this tree.
 */
function entryModules(): string[] {
  const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
  const entries = new Set<string>();
  for (const cmd of Object.values(scripts)) {
    const m = /^tsx\s+(\S+\.m?ts)(?:\s|$)/.exec(cmd);
    if (m?.[1] && existsSync(path.join(ROOT, m[1]))) entries.add(m[1]);
  }
  return [...entries].sort();
}

/**
 * **The unledgered spenders this gate cannot see, admitted by id.**
 *
 * Keyed by the `id` of its entry in
 * [`src/spend-declarations.ts`](../src/spend-declarations.ts), because that is
 * where the admission is made and where `npm run cost` reads it from. This map
 * is the pointer, not a second register: the test below fails if the two lists
 * stop matching in either direction, so a new `unscoped` declaration has to be
 * looked at here before the suite goes green again.
 */
const ADMITTED: Readonly<Record<string, string>> = {
  "dictation-bench-vocabulary-sources":
    "npm run eval:dictation-vocab — evals/dictation/bench-vocabulary-sources.ts reaches a " +
    "paid call through transcribeWith (src/transcribe.ts) → openRouterJson, two modules " +
    "from any seam import, so no rule above can see it. It opens no ledger, by decision " +
    "and with a reason on the declaration.",
};

describe("the listed stage CLIs open the ledger", () => {
  it('wraps every listed stage CLI entrypoint in withLedger("cli", main)', () => {
    const offenders = Object.keys(PAID_CLIS)
      .map((file) => ledgerOffence(file, read(file)))
      .filter((o): o is string => o !== null);

    expect(
      offenders,
      "These CLIs make paid model calls without opening the spend ledger, so the\n" +
        "money never reaches `npm run cost` and unscopedCalls() counts it as lost.\n" +
        "Wrap the entrypoint: `await withLedger(\"cli\", main)` — src/cli-ledger.ts.\n",
    ).toEqual([]);
  });

  it("names every package.json entry module that imports a provider seam", () => {
    /* The list going stale is the failure mode this test has: the two leaks it
       exists for were both a copied stage CLI missing one line, and the next one
       would be a *new* stage CLI missing the same line. Directly importing a
       seam is what a stage CLI does — and it is *all* this can see, which is
       what ADMITTED above is for. */
    const seamEntries = entryModules().filter((f) => importsSeam(read(f)));
    const unaccounted = seamEntries.filter(
      (f) => !(f in PAID_CLIS) && !DECLARATIONS.some((d) => d.file === f),
    );
    expect(
      unaccounted,
      "A package.json entry module imports a provider seam and is accounted for nowhere.\n" +
        "If it is a stage CLI, add it to PAID_CLIS and give its entrypoint\n" +
        '`withLedger("cli", main)`. If it is an eval, it wants the "eval" scope instead —\n' +
        "declare it in src/spend-declarations.ts, and name it in ADMITTED if it opens no\n" +
        "ledger at all.\n",
    ).toEqual([]);

    /* The other direction, so the list cannot rot quietly: everything named
       here has to still be a package.json entry that still imports a seam. */
    expect(
      Object.keys(PAID_CLIS).filter((f) => !seamEntries.includes(f)),
      "PAID_CLIS names a module that package.json no longer starts with tsx, or that no\n" +
        "longer imports a provider seam directly. If it still spends, this gate has stopped\n" +
        "being able to tell — say so here rather than deleting the line.\n",
    ).toEqual([]);
  });

  it("keeps the unledgered CLIs it cannot see named, and their admissions current", () => {
    /* **The honest half of the header.** `npm run eval:dictation-vocab` spends
       and opens no ledger, and the two tests above are structurally unable to
       notice: it imports no seam. It is not a leak — it is declared. What this
       checks is that the declaration is still there and still true, and that a
       *second* one cannot appear without somebody writing down what starts it. */
    const unscoped = DECLARATIONS.filter((d) => d.kind === "unscoped")
      .map((d) => d.id)
      .sort();
    expect(
      unscoped,
      "The `unscoped` declarations in src/spend-declarations.ts and the ADMITTED map in\n" +
        "this file have diverged. An `unscoped` declaration is a spender with no ledger\n" +
        "open: if package.json can start it, say here what starts it and how it reaches a\n" +
        "paid call. If it has since been wired up, delete both.\n",
    ).toEqual(Object.keys(ADMITTED).sort());

    for (const id of Object.keys(ADMITTED)) {
      const declared = DECLARATIONS.find((d) => d.id === id);
      if (!declared || !existsSync(path.join(ROOT, declared.file))) continue;
      /* Measured on the file rather than taken from the declaration: an
         admission that has quietly been fixed should be deleted, not left
         standing as permission for the next one. */
      const parsed = parseSource(read(declared.file)).body;
      expect(
        ledgerLocalName(declared.file, parsed) ?? stageLocalName(declared.file, parsed),
        `${id} is admitted here as opening no ledger, and ${declared.file} now imports\n` +
          `withLedger or ${STAGE}. Delete the row and the declaration, and mark the\n` +
          "declaration metered.\n",
      ).toBeNull();
    }
  });

  /**
   * **The detector, proved against the broken state.**
   *
   * A check nobody has watched fail is not evidence — docs/reusable/silent-success.md.
   * Every case below is one of the ways GPT Sol said a text matcher would be
   * beaten while the money still went missing.
   */
  describe("the detector goes red when it should", () => {
    const IMPORT = 'import { withLedger } from "./cli-ledger.js";\n';
    /** The entry function every one of the eight declares, and the thing the
        wrapper has to be handed. A fixture without it is not a CLI. */
    const DECLARES_MAIN = "async function main(): Promise<void> {}\n";
    const GUARD =
      "const isMain =\n" +
      "  process.argv[1] !== undefined &&\n" +
      "  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);\n";

    const BARE = 'src/fixture.ts — the entrypoint branch calls main() directly rather than withLedger("cli", …)';

    const SHADOWED =
      "src/fixture.ts — the entrypoint branch declares its own withLedger, shadowing the import from ./cli-ledger.js";
    const NOT_MAIN =
      'src/fixture.ts — withLedger("cli", …) is not passed main(), so main() runs outside the ledger';
    const OUTSIDE =
      'src/fixture.ts — main() is reached outside withLedger("cli", main), so it can spend outside the ledger';

    const bad: [string, string, string | RegExp][] = [
      [
        "a bare main() at the entrypoint — the two leaks, exactly",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) void main();`,
        BARE,
      ],
      [
        "the labels.ts idiom, where import.meta is in the `if` test itself",
        `${IMPORT}${DECLARES_MAIN}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await main();\n}`,
        BARE,
      ],
      [
        /* A comment is not code. This is the case that made the proximity grep
           unusable, and the one an AST cannot be fooled by. */
        "the wrapper present only in a comment",
        `${IMPORT}${DECLARES_MAIN}${GUARD}/* if (isMain) await withLedger("cli", main); */\nif (isMain) await main();`,
        BARE,
      ],
      [
        "the wrapper in a dead branch beside a bare main()",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (false) await withLedger("cli", main);\nif (isMain) await main();`,
        BARE,
      ],
      [
        /* Spelled right, imported never. This one is about the *name* being
           free: nothing here is bound to the real wrapper. */
        "a locally-defined withLedger, with no import anywhere in the file",
        `${DECLARES_MAIN}const withLedger = async (_k: string, f: () => Promise<void>) => f();\n` +
          `${GUARD}if (isMain) await withLedger("cli", main);`,
        "src/fixture.ts — imports no withLedger from ./cli-ledger.js",
      ],
      [
        /* **The binding case, properly this time.** The import is present and
           correct, and a local `const` shadows it for the length of the branch —
           so every check that reads the *spelling* of the callee is satisfied
           and no ledger is opened. The control above cannot test this: it fails
           on the missing import, which is a fixture defect wearing a green tick. */
        "a local withLedger shadowing the real import, inside the branch",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  const withLedger = async (_scope: string, fn: () => Promise<void>) => fn();\n  await withLedger("cli", main);\n}`,
        SHADOWED,
      ],
      [
        /* **The wrapper runs, and main runs beside it.** Right name, right
           scope, and the second argument is a stand-in that does nothing; `main`
           is handed to `.then`, so it runs after the ledger has closed. */
        "the wrapper handed an empty function, with main chained onto it",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  withLedger("cli", async () => {}).then(main);\n}`,
        NOT_MAIN,
      ],
      [
        "main() one statement deeper, in a nested if",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  if (process.env.DRY_RUN) {\n    await main();\n  } else {\n    await withLedger("cli", main);\n  }\n}`,
        BARE,
      ],
      [
        /* A call in an initialiser is still a call: `main()` starts here and the
           wrapper is handed the promise it already made. */
        "main() started in a variable initialiser",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  const running = main();\n  await withLedger("cli", () => running);\n}`,
        BARE,
      ],
      [
        /* The `else` runs when the module is imported rather than started, which
           is the one case where nothing is watching at all. */
        "a correct wrapper, and main() in the guard's else branch",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  await withLedger("cli", main);\n} else {\n  await main();\n}`,
        OUTSIDE,
      ],
      [
        "the wrapper named in the branch but never called",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  const run = () => withLedger("cli", main);\n  await main();\n}`,
        BARE,
      ],
      [
        /* Defining is not running. Nothing here spends, so nothing here is a
           leak — but nothing proves the ledger opens either, and a branch that
           runs nothing is how the "never called" case looks once the bare
           `main()` beside it is deleted. */
        "a branch that defines the wrapper and runs nothing",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  const run = () => withLedger("cli", main);\n}`,
        "src/fixture.ts — the entrypoint branch invokes nothing directly, so nothing proves it opens the ledger",
      ],
      [
        /* The wrapper is right and there is no `main` for it to be holding, so
           the argument check has nothing to compare against. Red rather than
           quietly green: a CLI whose entry function is called something else has
           to be looked at rather than waved through. */
        "a module with no main() at all",
        `${IMPORT}${GUARD}if (isMain) await withLedger("cli", run);`,
        "src/fixture.ts — declares no top-level main() for the ledger to wrap",
      ],
      [
        /* A correct wrapper does not license a second, unwrapped call beside it. */
        "a correct wrapper with a bare main() alongside",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) {\n  await withLedger("cli", main);\n  await main();\n}`,
        BARE,
      ],
      [
        "the wrapper opened with the wrong scope",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) await withLedger("eval", main);`,
        'src/fixture.ts — withLedger is not called with the "cli" scope',
      ],
      [
        "no entrypoint guard at all",
        `${IMPORT}${DECLARES_MAIN}await main();`,
        "src/fixture.ts — has no top-level entrypoint guard testing import.meta",
      ],
      [
        /* Recovery rather than a throw, so a file this cannot read becomes an
           offence instead of an empty program that looks clean. */
        "a file it cannot parse",
        `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) await withLedger("cli", main);\nfunction (((`,
        /^src\/fixture\.ts — could not be parsed \(\d+ error\(s\)\), so nothing here was checked$/,
      ],
    ];
    for (const [name, source, expected] of bad) {
      it(name, () => {
        const offence = ledgerOffence("src/fixture.ts", source);
        /* **The message, not merely a red.** "It passed" and "it never ran" are
           the same observation from outside, and so are "it caught this" and "it
           caught something else": the locally-defined-withLedger case below used
           to go red on `imports no withLedger`, which is a fixture that forgot
           its import rather than a binding check that works. */
        if (typeof expected === "string") expect(offence).toBe(expected);
        else expect(offence ?? "").toMatch(expected);
      });
    }

    it("accepts both real guard idioms and nothing else", () => {
      expect(
        ledgerOffence("src/fixture.ts", `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) void withLedger("cli", main);`),
      ).toBeNull();
      expect(
        ledgerOffence(
          "src/fixture.ts",
          `${IMPORT}${DECLARES_MAIN}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await withLedger("cli", main);\n}`,
        ),
      ).toBeNull();
      /* `withLedger("eval", main).catch(…)` is how evals/prompt-caching.ts ends;
         the chained form has to resolve to the call underneath it. */
      expect(
        ledgerOffence(
          "src/fixture.ts",
          `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) withLedger("cli", main).catch(() => process.exit(1));`,
        ),
      ).toBeNull();
      /* Wrapping main in a lambda is still wrapping main — the argument has to
         *run* main, not literally be it, or the check would forbid
         `withLedger("cli", () => main(process.argv))` for no reason. */
      expect(
        ledgerOffence(
          "src/fixture.ts",
          `${IMPORT}${DECLARES_MAIN}${GUARD}if (isMain) await withLedger("cli", async () => {\n  await main();\n});`,
        ),
      ).toBeNull();
    });

    /**
     * **The same mutations, on the real files, in both tails.**
     *
     * The fixtures above are made up; these are the tree as it stands, passed,
     * and then put back into the exact state the bug was in. A control that is
     * a no-op the day it is written leaves a green test with nothing behind it,
     * so every mutation below is asserted to match exactly once and to change
     * the file.
     *
     * **Both tails, because the migration is deliberately partial.**
     * `src/hierarchy.ts` still ends with the guard-and-`withLedger` pair; the three
     * files that could be edited on 2026-08-28 end with
     * `await stageCli(import.meta.url, main)`. Five of the eight were dirty with
     * other agents' work, which is why this list is not eight long — and holding
     * both here is what stops the second tail arriving on a loosened rule.
     */
    interface RealControl {
      readonly file: string;
      /** The tail as it stands. Must match exactly once. */
      readonly tail: string;
      /** The tail with the ledger taken out — the leak, exactly. */
      readonly mutations: readonly [string, string][];
    }

    const realFiles: readonly RealControl[] = [
      {
        file: "src/hierarchy.ts",
        tail: 'if (isMain) void withLedger("cli", main);',
        mutations: [
          [
            "if (isMain) void main();",
            'src/hierarchy.ts — the entrypoint branch calls main() directly rather than withLedger("cli", …)',
          ],
          [
            /* **The bypass the first version of this gate passed.** The wrapper
               is called, on the real import, with the right scope — and `main`
               is handed to `.then`, so the whole stage runs after the ledger has
               closed. Greg reproduced this one on this file by hand. */
            'if (isMain) void withLedger("cli", async () => {}).then(main);',
            'src/hierarchy.ts — withLedger("cli", …) is not passed main(), so main() runs outside the ledger',
          ],
        ],
      },
      ...(["src/labels.ts", "src/pdf-read.ts", "src/tweets.ts"] as const).map((file) => ({
        file,
        tail: "await stageCli(import.meta.url, main);",
        mutations: [
          [
            "await main();",
            `${file} — has no top-level \`await stageCli(import.meta.url, main)\` statement, so nothing here proves the CLI starts inside the ledger`,
          ],
          [
            /* The same bypass, in the new tail's spelling: the chain means this
               is not the tail statement at all, which is the first thing wrong
               with it. */
            "await stageCli(import.meta.url, async () => {}).then(main);",
            `${file} — runs stageCli() at the top level but not as \`await stageCli(…);\` — a \`void\`, a \`.then()\` or a call inside an \`if\` each let main() run outside the ledger`,
          ],
          [
            /* **Sol's counterexample, on the real files.** A helper that closes
               over `main`, called at the top level, beside a correct tail. */
            "async function leak() {\n  await main();\n}\nawait leak();\nawait stageCli(import.meta.url, main);",
            `${file} — main() is reached outside stageCli(import.meta.url, main), so it can spend outside the ledger`,
          ],
          [
            /* The tail that does not wait for the ledger to flush. */
            "stageCli(import.meta.url, main);",
            `${file} — runs stageCli() at the top level but not as \`await stageCli(…);\` — a \`void\`, a \`.then()\` or a call inside an \`if\` each let main() run outside the ledger`,
          ],
          [
            /* **The one the new tail adds.** Right function, right entry
               function, and a hard-coded URL that is not this module — so the
               guard inside `stageCli` compares against somebody else's file and
               the CLI either never starts or starts on import. A rename would
               leave this looking perfectly correct. */
            'await stageCli("file:///nowhere.ts", main);',
            `${file} — stageCli() is not passed import.meta.url, so the guard is asking about some other module`,
          ],
        ] as [string, string][],
      })),
    ];

    for (const { file, tail, mutations } of realFiles) {
      it(`goes red on ${file} the moment the ledger is taken out of the tail`, () => {
        const source = read(file);
        expect(ledgerOffence(file, source)).toBeNull();

        /* **Exactly once, not at least once.** The line a control breaks is by
           definition the line somebody has just been editing, and an anchor
           that also matches the docstring above it can mutate the comment and
           leave the code running — green, and proving nothing. */
        expect(
          source.split(tail).length - 1,
          `the anchor for ${file} no longer matches exactly one place, so what this\n` +
            "control mutates is not known. Re-read the file and fix the anchor.\n",
        ).toBe(1);

        for (const [replacement, expected] of mutations) {
          const broken = source.replace(tail, replacement);
          expect(
            broken,
            `the mutation matched nothing — ${file} has changed shape, so this control proved nothing`,
          ).not.toBe(source);
          /* The message, not merely a red: a mutation that broke the syntax
             would also be non-null, and would be reported as evidence for
             something else entirely. */
          expect(ledgerOffence(file, broken)).toBe(expected);
        }
      });
    }

    /**
     * **The one-line tail, and the ways it can be faked.**
     *
     * `await stageCli(import.meta.url, main)` says less than the four lines it
     * replaces, which is the thing to be careful about: a rule that only asked
     * whether the name appears would be the proximity grep GPT Sol refused, in
     * a new costume. Every fixture here is ordinary code that a reader would
     * skim past.
     */
    describe("the stageCli tail", () => {
      const STAGE_IMPORT = 'import { stageCli } from "./cli-ledger.js";\n';
      const NOT_A_STATEMENT =
        "src/fixture.ts — runs stageCli() at the top level but not as `await stageCli(…);` — " +
        "a `void`, a `.then()` or a call inside an `if` each let main() run outside the ledger";
      const NO_TAIL =
        "src/fixture.ts — has no top-level `await stageCli(import.meta.url, main)` statement, " +
        "so nothing here proves the CLI starts inside the ledger";
      const OUTSIDE =
        "src/fixture.ts — main() is reached outside stageCli(import.meta.url, main), so it can spend outside the ledger";

      const bad: [string, string, string][] = [
        [
          "a bare main() beside a correct tail",
          `${STAGE_IMPORT}${DECLARES_MAIN}await stageCli(import.meta.url, main);\nawait main();`,
          OUTSIDE,
        ],
        [
          /* Defining is not running, and the difference is invisible in a diff
             that adds one arrow. */
          "the tail defined and never run",
          `${STAGE_IMPORT}${DECLARES_MAIN}const tail = () => stageCli(import.meta.url, main);`,
          NO_TAIL,
        ],
        [
          "the tail in a comment, with a bare main() below it",
          `${STAGE_IMPORT}${DECLARES_MAIN}/* await stageCli(import.meta.url, main); */\nawait main();`,
          NO_TAIL,
        ],
        [
          /* A block at the top level is legal, and the `const` inside it wins
             for the length of the block. Every check that reads the callee's
             spelling is satisfied, and nothing is started. */
          "a block-scoped stageCli shadowing the real import",
          `${STAGE_IMPORT}${DECLARES_MAIN}{\n  const stageCli = async () => {};\n  await stageCli(import.meta.url, main);\n}`,
          "src/fixture.ts — the top level declares its own stageCli, shadowing the import from src/cli-ledger.ts",
        ],
        [
          /* The guard inside `stageCli` compares against whatever it is handed.
             Hand it a constant and it is comparing against somebody else's file:
             the CLI never starts, or starts on import, and the line reads right. */
          "a hard-coded URL instead of this module's own",
          `${STAGE_IMPORT}${DECLARES_MAIN}await stageCli("file:///nowhere.ts", main);`,
          "src/fixture.ts — stageCli() is not passed import.meta.url, so the guard is asking about some other module",
        ],
        [
          "the tail handed an empty function, with main chained onto it",
          `${STAGE_IMPORT}${DECLARES_MAIN}await stageCli(import.meta.url, async () => {}).then(main);`,
          NOT_A_STATEMENT,
        ],
        [
          "a module with no main() at all",
          `${STAGE_IMPORT}await stageCli(import.meta.url, run);`,
          "src/fixture.ts — declares no top-level main() for stageCli() to run",
        ],
        [
          /* **GPT Sol, by execution, 2026-08-28.** The old check took the call
             in the dead branch for the tail and walked past `leak`'s body
             because a function definition is not a call — right tail,
             unreachable; wrong call, reached. It returned `null`. */
          "a helper closure hiding a bare main(), with the tail in a dead branch",
          `${STAGE_IMPORT}${DECLARES_MAIN}async function leak() {\n  await main();\n}\nawait leak();\nif (false) await stageCli(import.meta.url, main);`,
          NOT_A_STATEMENT,
        ],
        [
          /* The same closure without the dead branch, so the tail is genuinely
             correct and the leak is the only fault left. */
          "a helper closure hiding a bare main(), beside a correct tail",
          `${STAGE_IMPORT}${DECLARES_MAIN}async function leak() {\n  await main();\n}\nawait leak();\nawait stageCli(import.meta.url, main);`,
          OUTSIDE,
        ],
        [
          /* An IIFE is a function body the top level runs immediately, which is
             the shortest version of the same hole. */
          "main() inside an IIFE beside a correct tail",
          `${STAGE_IMPORT}${DECLARES_MAIN}await (async () => {\n  await main();\n})();\nawait stageCli(import.meta.url, main);`,
          OUTSIDE,
        ],
        [
          /* **The tail that does not wait.** §0.1 asks for `await` so the ledger
             flush and any failure are part of the command finishing; a floating
             call can let the process exit first. */
          "the tail not awaited",
          `${STAGE_IMPORT}${DECLARES_MAIN}stageCli(import.meta.url, main);`,
          NOT_A_STATEMENT,
        ],
        [
          "the tail voided rather than awaited",
          `${STAGE_IMPORT}${DECLARES_MAIN}void stageCli(import.meta.url, main);`,
          NOT_A_STATEMENT,
        ],
        [
          /* **A basename is not an identity.** Sol wrote a `fake/cli-ledger.js`
             that calls `main()` bare; the old `spec.endsWith("/cli-ledger.js")`
             accepted it. This falls through to the old form's rule, which is
             the honest answer: nothing here imports the real wrapper. */
          "stageCli imported from a look-alike module",
          `import { stageCli } from "./fake/cli-ledger.js";\n${DECLARES_MAIN}await stageCli(import.meta.url, main);`,
          "src/fixture.ts — imports no withLedger from ./cli-ledger.js",
        ],
        [
          /* **Half-migrated, which is what a mistake during this migration would
             actually look like** — the new tail added and the old one left
             behind, so `main` is started twice and the second ledger nests
             inside the first. Pinned here because the review asserted this was
             rejected and that is worth holding still. */
          "both tails present, the old one left behind",
          `import { stageCli, withLedger } from "./cli-ledger.js";\n${DECLARES_MAIN}${GUARD}if (isMain) void withLedger("cli", main);\nawait stageCli(import.meta.url, main);`,
          OUTSIDE,
        ],
      ];
      for (const [name, source, expected] of bad) {
        it(name, () => {
          expect(ledgerOffence("src/fixture.ts", source)).toBe(expected);
        });
      }

      it("accepts the tail as it is actually written, and the one variant of it", () => {
        for (const tail of [
          "await stageCli(import.meta.url, main);",
          /* Wrapping main in a lambda is still wrapping main, for the same
             reason the old form allows it: `() => main(process.argv)` is not a
             bypass. */
          "await stageCli(import.meta.url, () => main(process.argv));",
        ]) {
          expect(ledgerOffence("src/fixture.ts", `${STAGE_IMPORT}${DECLARES_MAIN}${tail}`), tail).toBeNull();
        }
        /* An alias is a binding, and the binding is what this follows. */
        expect(
          ledgerOffence(
            "src/fixture.ts",
            `import { stageCli as tail } from "./cli-ledger.js";\n${DECLARES_MAIN}await tail(import.meta.url, main);`,
          ),
        ).toBeNull();
      });
    });
  });
});

/**
 * **And the four lines everything above now rests on.**
 *
 * Three of the eight CLIs no longer say any of this for themselves — they say
 * `await stageCli(import.meta.url, main)` and nothing else, which is the point
 * of docs/plans/260828aj-simplification-wave-2.md §2.5. That moves every guarantee into
 * `stageCli`, so `stageCli` gets the treatment the eight tails used to get:
 * checked structurally, and watched failing first.
 *
 * A gate that stopped here — "the CLIs call `stageCli`" — would be a gate that
 * says nothing at all the day somebody simplifies `stageCli`.
 */
describe("stageCli itself opens the ledger", () => {
  const LEDGER_FILE = "src/cli-ledger.ts";

  it("guards, reads .env.local and opens the ledger, in that order", () => {
    expect(
      stageCliOffence(LEDGER_FILE, read(LEDGER_FILE)),
      "Every paid CLI on the one-line tail depends on this function and says none of\n" +
        "it for itself. Whatever changed here changed all of them.\n",
    ).toBeNull();
  });

  /**
   * **Proved against the broken state**, on the real file rather than a fixture,
   * because a fixture of `stageCli` is a second copy of the thing this whole
   * item exists to stop there being two of.
   */
  describe("the detector goes red when it should", () => {
    /** The one sentence three of the seven mutations land on, because the shape
        is required outright rather than sampled — see `stageCliOffence`. */
    const SHAPE = (n: number) =>
      'src/cli-ledger.ts — stageCli() is not exactly `if (!isMain(entry)) return; loadEnvLocal(); ' +
      `await withLedger("cli", main);\` — it has ${n} statement(s), and every guarantee the CLIs ` +
      "stopped making rests on those three";
    const NO_WRAPPER =
      "src/cli-ledger.ts — stageCli() does not end with `await withLedger(…)` as a statement of its " +
      "own, so a CLI on stageCli can finish before the ledger does";
    const NO_GUARD =
      "src/cli-ledger.ts — stageCli() does not begin `if (!isMain(entry)) return;`, so it does not " +
      "reliably refuse to run on import";

    const mutations: [string, string, string, string][] = [
      [
        /* Without the guard it is not a guard helper at all: importing any stage
           would start it. This is the failure the duplication never had. */
        "the entrypoint guard taken out",
        "  if (!isMain(entry)) return;\n",
        "",
        SHAPE(2),
      ],
      [
        /* **GPT Sol, by execution, 2026-08-28.** The guard is present, names the
           right function and the right argument, and returns — with the test the
           wrong way round. Started directly it does nothing; imported, it runs.
           The old check asked whether `isMain(entry)` appeared in the test and
           never looked at the `!`. */
        "the guard reversed, so it runs on import and not when started",
        "  if (!isMain(entry)) return;\n",
        "  if (isMain(entry)) return;\n",
        NO_GUARD,
      ],
      [
        /* Sol's second on the guard: it exits along one path. `leaves` walked
           nested statements, so any `return` anywhere under the consequent
           satisfied it. */
        "the guard's exit made conditional",
        "  if (!isMain(entry)) return;\n",
        "  if (!isMain(entry)) {\n    if (process.env.CI) return;\n  }\n",
        NO_GUARD,
      ],
      [
        "the .env.local read taken out",
        "  loadEnvLocal();\n",
        "",
        SHAPE(2),
      ],
      [
        /* The Tier 1 review's finding, moved into the helper: it is in the right
           function, it runs, and the money has already gone. */
        "the .env.local read moved below the spending",
        '  loadEnvLocal();\n  await withLedger("cli", main);\n',
        '  await withLedger("cli", main);\n  loadEnvLocal();\n',
        "src/cli-ledger.ts — stageCli() does not call loadEnvLocal() as the statement after the guard, so a key in .env.local goes unread",
      ],
      [
        /* Sol's third: a `return` between the guard and the read. Every position
           check the old version made still held, and the function did nothing. */
        "an unconditional return between the guard and the read",
        "  if (!isMain(entry)) return;\n",
        "  if (!isMain(entry)) return;\n  return;\n",
        SHAPE(4),
      ],
      [
        "the wrapper taken out, so the CLI runs bare",
        '  await withLedger("cli", main);\n',
        "  await main();\n",
        NO_WRAPPER,
      ],
      [
        /* Sol's fourth: the wrapper in a dead branch. Present, correct, never
           reached — and the old check found it by walking the whole body. */
        "the wrapper put in a dead branch",
        '  await withLedger("cli", main);\n',
        '  if (false) await withLedger("cli", main);\n',
        NO_WRAPPER,
      ],
      [
        /* And the wrapper not awaited, which is the same fault as a floating
           `void` at a caller: the process can exit before the ledger flushes. */
        "the wrapper not awaited",
        '  await withLedger("cli", main);\n',
        '  withLedger("cli", main);\n',
        NO_WRAPPER,
      ],
      [
        /* `"eval"` is a real scope with a real meaning, which is why this is the
           plausible mistake rather than a typo. It would put every stage's spend
           under the wrong attribution and `npm run cost` would still print. */
        "the wrapper opened with the eval scope",
        '  await withLedger("cli", main);\n',
        '  await withLedger("eval", main);\n',
        'src/cli-ledger.ts — stageCli() does not open withLedger with the "cli" scope',
      ],
      [
        /* The same bypass Greg reproduced by hand on `src/hierarchy.ts`, one level
           down: the ledger opens around nothing and the stage runs after it has
           closed. Here it would do that to every CLI at once. */
        "the wrapper handed an empty function, with main chained onto it",
        '  await withLedger("cli", main);\n',
        '  await withLedger("cli", async () => {}).then(main);\n',
        NO_WRAPPER,
      ],
      [
        "a local withLedger shadowing the module's own",
        "  loadEnvLocal();\n",
        "  loadEnvLocal();\n  const withLedger = async (_k: string, f: () => Promise<void>) => f();\n",
        "src/cli-ledger.ts — stageCli() declares its own withLedger, shadowing the one this checks",
      ],
    ];

    for (const [name, anchor, replacement, expected] of mutations) {
      it(name, () => {
        const source = read(LEDGER_FILE);
        expect(
          source.split(anchor).length - 1,
          `the anchor for "${name}" no longer matches exactly one place in ${LEDGER_FILE},\n` +
            "so what this control mutates is not known. Re-read the file and fix the anchor.\n",
        ).toBe(1);
        const broken = source.replace(anchor, replacement);
        expect(broken, "the mutation matched nothing").not.toBe(source);
        expect(stageCliOffence(LEDGER_FILE, broken)).toBe(expected);
      });
    }
  });
});

/**
 * **The same nine CLIs read `.env.local` before they spend.**
 *
 * A sibling rule rather than part of the one above, because it is about a
 * different failure. The ledger rule is about money going missing; this one is
 * about a working machine reporting itself broken: `npm run pdf x.pdf` from a
 * shell with no exported key answered "OPENROUTER_API_KEY is not set" while the
 * key was sitting in `.env.local`, unread.
 *
 * It shares the list, the parser and the binding check, which is the reason it
 * lives here. `PAID_CLIS` is already the set of modules that spend, and a CLI
 * that spends is exactly a CLI that needs a key.
 *
 * **The edge of this, in the same spirit as the header.** It checks the nine
 * named above and nothing else — `src/embeddings.ts`, `src/converse.ts` and
 * `src/explain.ts` also call `loadEnvLocal()` and are outside the list because
 * they are outside `PAID_CLIS`. And it cannot see a CLI that reads a key some
 * other way.
 */
describe("the listed stage CLIs read .env.local", () => {
  it("calls loadEnvLocal() inside main(), in every one of them", () => {
    const offenders = Object.keys(PAID_CLIS)
      .map((file) => envOffence(file, read(file)))
      .filter((o): o is string => o !== null);

    expect(
      offenders,
      "These CLIs spend money and never read .env.local, so running one from a shell\n" +
        "that has not exported the key fails as though the credential were missing\n" +
        "rather than unread. Call loadEnvLocal() at the top of main() — src/env.ts,\n" +
        "and see the note in src/ideas.ts on why it belongs in main and not deeper.\n",
    ).toEqual([]);
  });

  /**
   * **Proved against the broken state**, the same way the ledger rule is.
   * docs/reusable/silent-success.md — a rule nobody has watched fail is not
   * evidence, and this one had eight green files the moment it was written,
   * which is the most convincing way for a new check to be doing nothing.
   */
  describe("the detector goes red when it should", () => {
    const IMPORT = 'import { loadEnvLocal } from "./env.js";\n';
    const bad: [string, string, string][] = [
      [
        "main() never calls it — src/pdf-read.ts before 2026-08-28",
        `${IMPORT}async function main(): Promise<void> {\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        "the import missing entirely",
        "async function main(): Promise<void> {\n  loadEnvLocal();\n}\n",
        "src/fixture.ts — imports no loadEnvLocal from ./env.js",
      ],
      [
        /* The binding trap again: right spelling, no import behind it. */
        "a local loadEnvLocal shadowing the real import",
        `${IMPORT}async function main(): Promise<void> {\n  const loadEnvLocal = () => {};\n  loadEnvLocal();\n}\n`,
        "src/fixture.ts — main() declares its own loadEnvLocal, shadowing the import from ./env.js",
      ],
      [
        /* Defining is not running. A helper that would have read the file, had
           anything called it, leaves the key just as unread. */
        "the call inside a helper main() declares and never invokes",
        `${IMPORT}async function main(): Promise<void> {\n  const setup = () => loadEnvLocal();\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        "a call in a comment, which is not a call",
        `${IMPORT}async function main(): Promise<void> {\n  /* loadEnvLocal(); */\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        /* Called at module scope instead: it runs, but on *import* as well as on
           start, which is the thing the note in src/ideas.ts refuses. */
        "called at the top level rather than in main()",
        `${IMPORT}loadEnvLocal();\nasync function main(): Promise<void> {\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        "a module with no main() at all",
        `${IMPORT}loadEnvLocal();\n`,
        "src/fixture.ts — declares no top-level main() function to read .env.local in",
      ],
      [
        /* **The sharpest of GPT Sol's three, 2026-08-28.** It is in `main`, it is
           a statement, it runs — and the money has already been spent by the
           time it does. Every check that asks only "is the call there?" passes
           this, which is what made the first version of this rule a false
           guarantee rather than a weak one. */
        "the call after the spending, which is in main and useless",
        `${IMPORT}async function main(): Promise<void> {\n  await spend();\n  loadEnvLocal();\n}\n`,
        "src/fixture.ts — main() awaits or returns before loadEnvLocal(), so .env.local is read after the work has started",
      ],
      [
        /* A `return` before it is the same fault reached the other way: the
           statement is there, in order, and never runs. */
        "the call after an early return",
        `${IMPORT}async function main(): Promise<void> {\n  if (!process.argv[2]) return;\n  loadEnvLocal();\n}\n`,
        "src/fixture.ts — main() awaits or returns before loadEnvLocal(), so .env.local is read after the work has started",
      ],
      [
        /* Nested is not run. `if (false)` is the honest version of every branch
           whose condition happens to be false on the day. */
        "the call inside a dead branch",
        `${IMPORT}async function main(): Promise<void> {\n  if (false) loadEnvLocal();\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        /* Nested in a live branch is still nested, and still not the guarantee:
           the rule is that it happens, not that it happens on some paths. */
        "the call inside a live branch",
        `${IMPORT}async function main(): Promise<void> {\n  if (process.env.X) {\n    loadEnvLocal();\n  }\n  await run();\n}\n`,
        "src/fixture.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      ],
      [
        /* **The destructured shadow**, which the first version of the shadow
           check walked straight past because it only looked for
           `const loadEnvLocal = …`. */
        "a destructured local shadowing the real import",
        `${IMPORT}async function main(): Promise<void> {\n  const { loadEnvLocal } = helpers;\n  loadEnvLocal();\n}\n`,
        "src/fixture.ts — main() declares its own loadEnvLocal, shadowing the import from ./env.js",
      ],
      [
        "a file that will not parse, which checks nothing and must not read as clean",
        `${IMPORT}async function main(): Promise<void> {\n  const ) = ;\n}\n`,
        "",
      ],
    ];

    for (const [name, source, expected] of bad) {
      it(name, () => {
        const offence = envOffence("src/fixture.ts", source);
        expect(offence, "the detector said this fixture was fine").not.toBeNull();
        if (expected === "") {
          expect(offence).toMatch(/could not be parsed/);
        } else {
          expect(offence).toBe(expected);
        }
      });
    }

    /**
     * **And on the real file**, so the rule is anchored to the tree rather than
     * to fixtures. The mutation has to match exactly once, for the same reason
     * the ledger controls insist on it: an anchor that also matched the comment
     * above the line would edit prose and leave the code running.
     */
    it("goes red on src/pdf-read.ts the moment the call is taken out", () => {
      const source = read("src/pdf-read.ts");
      expect(envOffence("src/pdf-read.ts", source)).toBeNull();
      expect(source.split("\n  loadEnvLocal();").length - 1).toBe(1);
      const without = source.replace("\n  loadEnvLocal();", "");
      expect(without, "the mutation matched nothing").not.toBe(source);
      expect(envOffence("src/pdf-read.ts", without)).toBe(
        "src/pdf-read.ts — main() never calls loadEnvLocal() as a statement of its own, so a key in .env.local goes unread",
      );
    });
  });
});
