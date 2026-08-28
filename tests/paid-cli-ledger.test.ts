/**
 * **Every paid CLI opens the ledger before it spends.**
 *
 * [`src/cli-ledger.ts`](../src/cli-ledger.ts) says what this is for:
 *
 * > **Run a CLI command with the ledger open**, so that `npm run toc` is money
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
 * worse than one that can go red. The question asked is narrow and structural:
 * **in the branch that actually runs when this module is the entry file, is the
 * only thing directly invoked the `withLedger` imported from `cli-ledger.js`,
 * with the `"cli"` scope?** Anything else in that branch — including a bare
 * `main()` beside a correct wrapper — is an offence.
 *
 * Both guard idioms are understood, because the two in this repo differ and
 * harmonising them is a separate piece of work: `import.meta` in the `if` test
 * itself (`labels.ts`), and a top-level `const isMain = …import.meta…` the `if`
 * then names (the other seven).
 *
 * ## What defeats it, said out loud
 *
 * The list of paid CLIs below is explicit, and `names every paid CLI
 * package.json can start` keeps it honest only for the ordinary case: an entry
 * module that **directly** imports one of the two seams. A new CLI that reaches
 * a paid call transitively — through `api.ts`, say — is invisible to that rule,
 * and following it would need real dataflow. This is a tripwire, not a
 * boundary, which is the same thing `tests/no-undeclared-spend.test.ts` says
 * about itself. The ordinary case is somebody copying a stage CLI and leaving
 * one line out, and that is the case that has happened twice.
 */

import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  "src/summarise.ts": "npm run summarise — streamMessage per granularity",
  "src/toc.ts": "npm run toc — streamMessage",
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

/** Every node once, comments skipped — the same walker shape as the spend gate. */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  visit(n);
  for (const [key, value] of Object.entries(n)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(value, visit);
  }
}

/** `import.meta`, however it is spelled downstream — `.url` or `.filename`. */
function mentionsImportMeta(node: unknown): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === "MetaProperty" && (n.meta as { name?: string } | undefined)?.name === "import") {
      found = true;
    }
  });
  return found;
}

function mentionsAnyName(node: unknown, names: ReadonlySet<string>): boolean {
  let found = false;
  walk(node, (n) => {
    if (n.type === "Identifier" && names.has(n.name as string)) found = true;
  });
  return found;
}

/**
 * The local name `withLedger` was imported under, or `null`.
 *
 * **By binding, not by spelling.** A file that defines its own `withLedger` and
 * calls it has satisfied every text matcher and opened no ledger; this is the
 * check that tells the two apart.
 */
function ledgerLocalName(body: Node[]): string | null {
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
    if (!spec.endsWith("/cli-ledger.js")) continue;
    if (stmt.importKind === "type") continue;
    for (const sp of (stmt.specifiers ?? []) as Node[]) {
      if (sp.type !== "ImportSpecifier" || sp.importKind === "type") continue;
      if ((sp.imported as { name?: string } | undefined)?.name === "withLedger") {
        return (sp.local as { name: string }).name;
      }
    }
  }
  return null;
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
function rootCall(call: Node): { name: string; call: Node } {
  const callee = call.callee as Node | undefined;
  if (callee?.type === "Identifier") return { name: callee.name as string, call };
  if (callee?.type === "MemberExpression") {
    const object = callee.object as Node | undefined;
    /* `withLedger("cli", main).catch(…)` — the chain's root is the real call. */
    if (object?.type === "CallExpression") return rootCall(object);
  }
  return { name: "<not a plain call>", call };
}

/** The calls a branch makes *itself*, ignoring anything it merely defines. */
function directCalls(branch: Node): Node[] {
  const statements =
    branch.type === "BlockStatement" ? ((branch.body ?? []) as Node[]) : [branch];
  const calls: Node[] = [];
  for (const s of statements) {
    if (s.type !== "ExpressionStatement") continue;
    let e = s.expression as Node;
    while (
      e?.type === "AwaitExpression" ||
      (e?.type === "UnaryExpression" && e.operator === "void")
    ) {
      e = e.argument as Node;
    }
    if (e?.type === "CallExpression") calls.push(e);
  }
  return calls;
}

/**
 * **The whole verdict for one module**, as a function so it can be handed
 * source text directly — including source that is deliberately broken, which is
 * the only way to watch this go red. Returns `null` when the entrypoint is
 * metered, and a sentence naming the file when it is not.
 */
export function ledgerOffence(file: string, source: string): string | null {
  const { body, errors } = parseSource(source);
  if (errors > 0) {
    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
  }

  const ledger = ledgerLocalName(body);
  if (!ledger) return `${file} — imports no withLedger from ./cli-ledger.js`;

  const guards = entrypointGuards(body);
  if (guards.length === 0) return `${file} — has no top-level entrypoint guard testing import.meta`;

  for (const guard of guards) {
    const calls = directCalls(guard.consequent as Node);
    if (calls.length === 0) {
      return `${file} — the entrypoint branch invokes nothing directly, so nothing proves it opens the ledger`;
    }
    for (const call of calls) {
      const { name, call: opened } = rootCall(call);
      if (name !== ledger) {
        return `${file} — the entrypoint branch calls ${name}() directly rather than ${ledger}("cli", …)`;
      }
      const first = (opened.arguments as Node[])[0];
      if (first?.type !== "StringLiteral" || first.value !== "cli") {
        return `${file} — ${ledger} is not called with the "cli" scope`;
      }
    }
  }
  return null;
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

describe("every paid CLI opens the ledger", () => {
  it("wraps every paid CLI entrypoint in withLedger(\"cli\", …)", () => {
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

  it("names every paid CLI package.json can start", () => {
    /* The list going stale is the failure mode this test has: the two leaks it
       exists for were both a copied stage CLI missing one line, and the next one
       would be a *new* stage CLI missing the same line. Directly importing a
       seam is what a stage CLI does. */
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    const entries = new Set<string>();
    for (const cmd of Object.values(scripts)) {
      const m = /^tsx\s+(src\/\S+\.ts)$/.exec(cmd);
      if (m?.[1]) entries.add(m[1]);
    }
    const paid = [...entries].filter((f) => importsSeam(read(f))).sort();
    expect(
      paid,
      "A package.json entry module imports a provider seam and is not in PAID_CLIS.\n" +
        "Add it — and give its entrypoint withLedger(\"cli\", …) — or, if it really\n" +
        "cannot spend, say so here with the reason.\n",
    ).toEqual(Object.keys(PAID_CLIS).sort());
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
    const GUARD =
      "const isMain =\n" +
      "  process.argv[1] !== undefined &&\n" +
      "  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);\n";

    const bad: [string, string][] = [
      [
        "a bare main() at the entrypoint — the two leaks, exactly",
        `${IMPORT}${GUARD}if (isMain) void main();`,
      ],
      [
        "the labels.ts idiom, where import.meta is in the `if` test itself",
        `${IMPORT}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await main();\n}`,
      ],
      [
        /* A comment is not code. This is the case that made the proximity grep
           unusable, and the one an AST cannot be fooled by. */
        "the wrapper present only in a comment",
        `${IMPORT}${GUARD}/* if (isMain) await withLedger("cli", main); */\nif (isMain) await main();`,
      ],
      [
        "the wrapper in a dead branch beside a bare main()",
        `${IMPORT}${GUARD}if (false) await withLedger("cli", main);\nif (isMain) await main();`,
      ],
      [
        /* Spelled right, bound to nothing. The binding check is the only thing
           between this and a green suite. */
        "a locally-defined withLedger that opens no ledger",
        'const withLedger = async (_k: string, f: () => Promise<void>) => f();\n' +
          `${GUARD}if (isMain) await withLedger("cli", main);`,
      ],
      [
        "the wrapper named in the branch but never called",
        `${IMPORT}${GUARD}if (isMain) {\n  const run = () => withLedger("cli", main);\n  await main();\n}`,
      ],
      [
        /* A correct wrapper does not license a second, unwrapped call beside it. */
        "a correct wrapper with a bare main() alongside",
        `${IMPORT}${GUARD}if (isMain) {\n  await withLedger("cli", main);\n  await main();\n}`,
      ],
      [
        "the wrapper opened with the wrong scope",
        `${IMPORT}${GUARD}if (isMain) await withLedger("eval", main);`,
      ],
      [
        "no entrypoint guard at all",
        `${IMPORT}await main();`,
      ],
      [
        /* Recovery rather than a throw, so a file this cannot read becomes an
           offence instead of an empty program that looks clean. */
        "a file it cannot parse",
        `${IMPORT}${GUARD}if (isMain) await withLedger("cli", main);\nfunction (((`,
      ],
    ];
    for (const [name, source] of bad) {
      it(name, () => {
        expect(ledgerOffence("fixture.ts", source)).not.toBeNull();
      });
    }

    it("accepts both real guard idioms and nothing else", () => {
      expect(ledgerOffence("fixture.ts", `${IMPORT}${GUARD}if (isMain) void withLedger("cli", main);`)).toBeNull();
      expect(
        ledgerOffence(
          "fixture.ts",
          `${IMPORT}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await withLedger("cli", main);\n}`,
        ),
      ).toBeNull();
      /* `withLedger("eval", main).catch(…)` is how evals/prompt-caching.ts ends;
         the chained form has to resolve to the call underneath it. */
      expect(
        ledgerOffence(
          "fixture.ts",
          `${IMPORT}${GUARD}if (isMain) withLedger("cli", main).catch(() => process.exit(1));`,
        ),
      ).toBeNull();
    });

    /**
     * **The same mutation, on the real files, in both guard idioms.**
     *
     * The fixtures above are made up; these are the tree as it stands, passed,
     * and then put back into the exact state the bug was in. `src/toc.ts` is
     * here because it was never broken, so this proves something on the day the
     * other two are fixed *and* on the day one of them regresses — a control
     * that is a no-op when written leaves a green test with nothing behind it.
     *
     * Both idioms, because they differ and harmonising them is a separate piece
     * of work: `import.meta` inside the `if` test (`labels.ts`), and a named
     * `isMain` const (the other seven).
     */
    const realFiles: [string, string, string][] = [
      ["src/toc.ts", 'if (isMain) void withLedger("cli", main);', "if (isMain) void main();"],
      [
        "src/pdf-read.ts",
        'if (isMain) await withLedger("cli", main);',
        "if (isMain) void main();",
      ],
      [
        "src/labels.ts",
        '  await withLedger("cli", main);',
        "  await main();",
      ],
    ];
    for (const [file, wrapper, bare] of realFiles) {
      it(`goes red on ${file} the moment the wrapper is taken out`, () => {
        const wrapped = read(file);
        expect(ledgerOffence(file, wrapped)).toBeNull();

        const unwrapped = wrapped.replace(wrapper, bare);
        expect(
          unwrapped,
          `the mutation matched nothing — ${file} has changed shape, so this control proved nothing`,
        ).not.toBe(wrapped);
        expect(ledgerOffence(file, unwrapped)).not.toBeNull();
      });
    }
  });
});
