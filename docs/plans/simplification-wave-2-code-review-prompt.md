# Review request: the built code from wave 2's Tier 0

You reviewed this plan before it was built and returned "revise before building". This is the
second review — of the code, which the project weights higher than the plan review, because a
plan-stage review cannot catch a fix that is wrong in the code.

Be adversarial. I want the things that are wrong, not reassurance.

## What you found last time, and what I did with it

All three of your material corrections were right and I verified each one myself:

1. **`npm run pdf` leaks spend too.** Confirmed: `pdf-read.ts:377` calls `openRouterJson`, the
   entrypoint was a bare `void main()`. Both are fixed in this diff.
2. **My "four unexercised guards" was false** — `tests/search-stream.test.ts:411` does exercise the
   clean-abort branch. Corrected in the plan to three. **0.4 is NOT in this diff**; it is still to
   do.
3. **2.4's ToC/arc stamps re-introduce a reverted change.** Confirmed at `pipeline.ts:1083`
   ("No `stamp`, and it is not an oversight — one was written and withdrawn on 2026-08-27"). Moved
   to "do not do". Not in this diff.

I also confirmed your count corrections: readiness probes are 34, not my 29 (I greped one spelling
of the genre); `writeAtomic` has three copies, not two, so the justification wave 1 declined it on
is stale.

## What is in this diff — four commits

- `a1d397a` — 0.1. `await withLedger("cli", main)` in `labels.ts` and `pdf-read.ts`, plus a new
  AST-based gate `tests/paid-cli-ledger.test.ts` built to your specification (explicit list of paid
  CLI entry modules; parse rather than grep; check the executed branch directly invokes the wrapper;
  prove the detector can go red).
- `47a3959` — 0.2 and 0.3. The revalidation guard added to `useIdeas`, `useSummaries` and
  `Tweets.tsx`; `useIdeas`'s false "did not reach the server" replaced with `queue.error`. New
  `tests/background-reload-keeps-the-list.test.tsx`.
- `ca1bf40` — 0.5 and 0.6. `glossaryIsCurrent` deleted with its three tests and six references
  corrected; the `store/revisions.ts` header rewritten to say nothing is wired.
- `3806b25` — the plan and your first review.

## What I most want you to attack

1. **The gate in `tests/paid-cli-ledger.test.ts`.** This is the piece you specified and the piece I
   am least sure of. Does it actually do what its header claims? Specifically:
   - Is `PAID_CLIS` the right list, and is `names every paid CLI package.json can start` a real
     check or a tautology that will pass whatever the list says?
   - `importsSeam` only catches an entry module that **directly** imports `ai-call.js` or
     `messages-stream.js`. Is there a CLI in `package.json` today that spends money transitively and
     is therefore missing from the list? I would rather know now.
   - Are the four "detector goes red" cases really the four that defeat a grep, and does each one
     fail for the reason it claims rather than incidentally?
   - `entrypointGuards` understands two idioms. Is there a third in the repo it would silently skip
     — and if a guard is skipped, does the file pass or fail? It must fail.
2. **`Tweets.tsx`.** It could not take the one-line fix because its state is a discriminated union.
   I added a separate `reloadError` and a new muted line. Is the retain correct in every branch, and
   is that new reader-facing string acceptable against `docs/project/copy.md`? Has a reader who hits
   an opening-read failure now got two messages?
3. **`useIdeas` / `useSummaries`.** Is `setStatus((was) => (was === "loading" ? "error" : was))`
   right given that neither has the `generation` ref `useGlossary` has? Is there a sequence where
   the status is not `loading` but the artefact is nonetheless absent, so the reader gets neither a
   list nor an error?
4. **The deletion in `ca1bf40`.** Did I remove anything that was load-bearing? Is `isStale` still
   correctly described now that the function that wrapped it is gone? Are the six corrected
   references now accurate, or did I trade one false statement for another?
5. **`store/revisions.ts`.** I rewrote a header rather than fixing the wiring, on your advice. Is
   the new text now true, and does it say enough for the step 11 owner to act on the
   begin/sweep/artefact atomicity condition?

## Evidence

Attached: the full diff of the four commits. Some things I verified, so you can attack the method
rather than repeat the work:

- **The ledger gate goes red against the real bug.** I put both bugs back; it failed and named both
  files: *"src/labels.ts — the entrypoint branch calls main() directly rather than withLedger("cli",
  …)"*. Restored, 16/16 green.
- **The hook test goes red against the real bug.** Reverting the one `useIdeas` line reddens exactly
  one test and leaves the other seven green. Restored, 8/8 green.
- `npm run typecheck` clean except `scripts/db-export.ts`, which is a peer's uncommitted work.
- 211 tests across every suite touching these files pass.
- The full suite shows failures only in `store-jobs-parity` (a peer's uncommitted red-first work)
  and `db-schema`, which **passes 23/23 in isolation** — the shared local Postgres is contended by
  six other active sessions, and the failure count varies run to run.

If any of my verification is weaker than I think it is, say so — that is the most useful thing you
can tell me. Name files and lines. If a finding is wrong, say it plainly.



---
# ATTACHMENT — the four commits (a peer's aab3888 deliberately excluded)
---

commit a1d397a7caf282d9b35373f86e3a0b4d18ddd7df
Author: Greg Detre <greg@gregdetre.com>
Date:   Fri Aug 28 15:29:22 2026 +0300

    Two commands spent real money into the total that says it has seen everything
    
    `npm run labels` and `npm run pdf` called `main()` directly. The other six stage
    CLIs wrap it in `withLedger("cli", …)`, so their calls land in `npm run cost`;
    these two did not, and `unscopedCalls()` counted them as fallen on the floor.
    labels makes one paid call per batch, pdf one per chunk.
    
    `tests/no-undeclared-spend.test.ts` could not have caught it. It asks whether a
    file *can* spend money and whether that is declared — never whether the
    entrypoint opens the ledger. Both files pass it and always did.
    
    The new gate parses rather than greps, and the reason is in its header: the
    first design was "does `withLedger` appear near the guard", and GPT Sol refused
    it, because a wrapper in a comment, a wrapper in a dead branch, a locally
    shadowed `withLedger` and a wrapper named but never called all defeat a text
    match while the money still disappears. It asks instead whether the branch that
    actually runs when the module is the entry file directly invokes the
    `withLedger` imported from cli-ledger.js. Its own `the detector goes red when it
    should` block feeds it each of those four defeats, and two more tests strip the
    wrapper back out of the real files and require it to redden.
    
    Checked by putting both bugs back: the gate names both files and fails. It is a
    tripwire and says so — a CLI reaching a paid call transitively is still
    invisible to it. The case it covers is somebody copying a stage CLI and leaving
    one line out, which is the case that has now happened twice.
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01M5tbuz57fs7M3nJAf6hzkR

```diff
diff --git a/src/labels.ts b/src/labels.ts
index 4edbd77..c038e49 100644
--- a/src/labels.ts
+++ b/src/labels.ts
@@ -34,6 +34,7 @@ import { createHash, randomUUID } from "node:crypto";
 import { readFile, rename, rm, writeFile } from "node:fs/promises";
 import path from "node:path";
 import { CACHE_FLOOR_TOKENS, estimateTokens } from "./article-prompt.js";
+import { withLedger } from "./cli-ledger.js";
 import { streamMessage, wasRefused } from "./messages-stream.js";
 import { CAPABLE_MODEL } from "./models.js";
 import { loadEnvLocal } from "./env.js";
@@ -1640,6 +1641,13 @@ async function main(): Promise<void> {
   console.log(`\nEval:      npm run eval:toc -- ${dir}`);
 }
 
+/* **`withLedger`, not a bare `main()`.** Every batch here is a paid call, and
+   without the collector open they land nowhere: not in `npm run cost`, and
+   counted as unscoped by `unscopedCalls()` in src/ai-spend.ts. This was the only
+   thing separating `npm run labels` from the six stages that already had it —
+   tests/paid-cli-ledger.test.ts is what stops it happening again. Awaited rather
+   than `void`ed, so flushing the ledger and any failure in it stay part of the
+   command finishing. */
 if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {
-  await main();
+  await withLedger("cli", main);
 }
diff --git a/src/pdf-read.ts b/src/pdf-read.ts
index 7cd4157..4c38f81 100644
--- a/src/pdf-read.ts
+++ b/src/pdf-read.ts
@@ -52,6 +52,7 @@ import { mkdir, readFile, writeFile } from "node:fs/promises";
 import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { PDFDocument } from "pdf-lib";
+import { withLedger } from "./cli-ledger.js";
 import { stageFailure } from "./job-failure.js";
 import { PDF_READER_MODEL } from "./models.js";
 import {
@@ -1274,4 +1275,11 @@ async function main() {
 const isMain =
   process.argv[1] !== undefined &&
   fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
-if (isMain) void main();
+/* **`withLedger`, not a bare `main()`.** Every chunk here is a paid
+   `openRouterJson` call, and without the collector open the money lands nowhere:
+   not in `npm run cost`, and counted as unscoped by `unscopedCalls()` in
+   src/ai-spend.ts. `npm run pdf` and `npm run labels` were the two stage CLIs
+   missing this; tests/paid-cli-ledger.test.ts is what stops a third appearing.
+   Awaited rather than `void`ed, so flushing the ledger and any failure in it stay
+   part of the command finishing. */
+if (isMain) await withLedger("cli", main);
diff --git a/tests/paid-cli-ledger.test.ts b/tests/paid-cli-ledger.test.ts
new file mode 100644
index 0000000..fa8a761
--- /dev/null
+++ b/tests/paid-cli-ledger.test.ts
@@ -0,0 +1,453 @@
+/**
+ * **Every paid CLI opens the ledger before it spends.**
+ *
+ * [`src/cli-ledger.ts`](../src/cli-ledger.ts) says what this is for:
+ *
+ * > **Run a CLI command with the ledger open**, so that `npm run toc` is money
+ * > that appears in `npm run cost` rather than money that vanishes.
+ *
+ * Eight npm scripts start a module that spends money — the seven Messages
+ * stages, plus `npm run pdf`, which is the other extractor and goes through the
+ * chat seam instead. Six had that line and two did not, so `npm run labels` and
+ * `npm run pdf` made paid calls that never reached `npm run cost` and that
+ * `unscopedCalls()` ([`src/ai-spend.ts`](../src/ai-spend.ts)) counted as fallen
+ * on the floor. `tests/no-undeclared-spend.test.ts` structurally could not see
+ * it: it asks *"can this file spend money, and is that declared?"*, never *"does
+ * this entrypoint open the ledger?"*.
+ *
+ * ## Why this is not a grep
+ *
+ * The first design was "does `withLedger` appear near the `isMain` guard". GPT
+ * Sol refused it, and the reasons are the ones docs/reusable/silent-success.md
+ * is about — every one of these defeats a text match while the money still
+ * disappears:
+ *
+ * - the wrapper sitting in a comment above the guard;
+ * - the wrapper in a dead branch (`if (false)`) beside a bare `main()`;
+ * - a locally-defined `withLedger` that wraps nothing;
+ * - the wrapper named in the branch but never called.
+ *
+ * So this parses instead, with `@babel/parser` — already a direct dev dependency
+ * for `tests/no-undeclared-spend.test.ts`, and for the same reason: a
+ * hand-written matcher fails towards *quiet*, and a gate that can go quiet is
+ * worse than one that can go red. The question asked is narrow and structural:
+ * **in the branch that actually runs when this module is the entry file, is the
+ * only thing directly invoked the `withLedger` imported from `cli-ledger.js`,
+ * with the `"cli"` scope?** Anything else in that branch — including a bare
+ * `main()` beside a correct wrapper — is an offence.
+ *
+ * Both guard idioms are understood, because the two in this repo differ and
+ * harmonising them is a separate piece of work: `import.meta` in the `if` test
+ * itself (`labels.ts`), and a top-level `const isMain = …import.meta…` the `if`
+ * then names (the other seven).
+ *
+ * ## What defeats it, said out loud
+ *
+ * The list of paid CLIs below is explicit, and `names every paid CLI
+ * package.json can start` keeps it honest only for the ordinary case: an entry
+ * module that **directly** imports one of the two seams. A new CLI that reaches
+ * a paid call transitively — through `api.ts`, say — is invisible to that rule,
+ * and following it would need real dataflow. This is a tripwire, not a
+ * boundary, which is the same thing `tests/no-undeclared-spend.test.ts` says
+ * about itself. The ordinary case is somebody copying a stage CLI and leaving
+ * one line out, and that is the case that has happened twice.
+ */
+
+import { parse } from "@babel/parser";
+import { readFileSync } from "node:fs";
+import path from "node:path";
+import { describe, expect, it } from "vitest";
+
+const ROOT = path.resolve(import.meta.dirname, "..");
+
+/**
+ * **The CLIs that spend money, and the npm script that starts each.**
+ *
+ * Explicit rather than derived, because "which modules can spend" is the
+ * question `tests/no-undeclared-spend.test.ts` already answers and this one is
+ * about entrypoints. The completeness check below stops the list going stale.
+ */
+const PAID_CLIS: Readonly<Record<string, string>> = {
+  "src/arc.ts": "npm run arc — streamMessage per part",
+  "src/glossary.ts": "npm run glossary — streamMessage per batch",
+  "src/ideas.ts": "npm run ideas — streamMessage",
+  "src/labels.ts": "npm run labels — streamMessage per batch",
+  "src/pdf-read.ts": "npm run pdf — openRouterJson per chunk",
+  "src/summarise.ts": "npm run summarise — streamMessage per granularity",
+  "src/toc.ts": "npm run toc — streamMessage",
+  "src/tweets.ts": "npm run tweets — streamMessage",
+};
+
+/** The two modules that can reach a provider. Naming one is spending money. */
+const SEAMS = ["/ai-call.js", "/messages-stream.js"];
+
+type Node = Record<string, unknown>;
+
+/**
+ * Babel's options, matching `tests/no-undeclared-spend.test.ts`.
+ *
+ * `errorRecovery` for the same reason it does: a file this cannot parse yields
+ * no nodes, and no nodes reads exactly like a clean file. The errors are counted
+ * and turned into an offence rather than thrown away.
+ */
+function parseSource(source: string): { body: Node[]; errors: number } {
+  try {
+    const ast = parse(source, {
+      sourceType: "module",
+      allowAwaitOutsideFunction: true,
+      allowReturnOutsideFunction: true,
+      errorRecovery: true,
+      plugins: ["typescript", "decorators-legacy", "explicitResourceManagement"],
+    });
+    return { body: ast.program.body as unknown as Node[], errors: ast.errors?.length ?? 0 };
+  } catch {
+    /* Recovery does not cover everything — some tokens still throw. Either way
+       the answer is the same: no nodes, so nothing was checked, so it is an
+       offence rather than a clean file. */
+    return { body: [], errors: 1 };
+  }
+}
+
+const SKIP_KEYS = new Set([
+  "loc",
+  "range",
+  "leadingComments",
+  "trailingComments",
+  "innerComments",
+  "comments",
+  "extra",
+]);
+
+/** Every node once, comments skipped — the same walker shape as the spend gate. */
+function walk(node: unknown, visit: (n: Node) => void): void {
+  if (!node || typeof node !== "object") return;
+  if (Array.isArray(node)) {
+    for (const child of node) walk(child, visit);
+    return;
+  }
+  const n = node as Node;
+  if (typeof n.type !== "string") return;
+  visit(n);
+  for (const [key, value] of Object.entries(n)) {
+    if (SKIP_KEYS.has(key)) continue;
+    walk(value, visit);
+  }
+}
+
+/** `import.meta`, however it is spelled downstream — `.url` or `.filename`. */
+function mentionsImportMeta(node: unknown): boolean {
+  let found = false;
+  walk(node, (n) => {
+    if (n.type === "MetaProperty" && (n.meta as { name?: string } | undefined)?.name === "import") {
+      found = true;
+    }
+  });
+  return found;
+}
+
+function mentionsAnyName(node: unknown, names: ReadonlySet<string>): boolean {
+  let found = false;
+  walk(node, (n) => {
+    if (n.type === "Identifier" && names.has(n.name as string)) found = true;
+  });
+  return found;
+}
+
+/**
+ * The local name `withLedger` was imported under, or `null`.
+ *
+ * **By binding, not by spelling.** A file that defines its own `withLedger` and
+ * calls it has satisfied every text matcher and opened no ledger; this is the
+ * check that tells the two apart.
+ */
+function ledgerLocalName(body: Node[]): string | null {
+  for (const stmt of body) {
+    if (stmt.type !== "ImportDeclaration") continue;
+    const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
+    if (!spec.endsWith("/cli-ledger.js")) continue;
+    if (stmt.importKind === "type") continue;
+    for (const sp of (stmt.specifiers ?? []) as Node[]) {
+      if (sp.type !== "ImportSpecifier" || sp.importKind === "type") continue;
+      if ((sp.imported as { name?: string } | undefined)?.name === "withLedger") {
+        return (sp.local as { name: string }).name;
+      }
+    }
+  }
+  return null;
+}
+
+/**
+ * The top-level `if`s that run when this module is the entry file.
+ *
+ * A guard is an `if` whose test either names `import.meta` itself, or names a
+ * top-level `const` whose initialiser does. Both idioms are in the tree.
+ */
+function entrypointGuards(body: Node[]): Node[] {
+  const guardVars = new Set<string>();
+  for (const stmt of body) {
+    if (stmt.type !== "VariableDeclaration") continue;
+    for (const d of (stmt.declarations ?? []) as Node[]) {
+      const id = d.id as { type?: string; name?: string } | undefined;
+      if (id?.type === "Identifier" && id.name && mentionsImportMeta(d.init)) guardVars.add(id.name);
+    }
+  }
+  return body.filter(
+    (s) =>
+      s.type === "IfStatement" &&
+      (mentionsImportMeta(s.test) || mentionsAnyName(s.test, guardVars)),
+  );
+}
+
+/**
+ * The call underneath a call, and what it is called.
+ *
+ * `withLedger(…)`, `void withLedger(…)`, `await withLedger(…)` and
+ * `withLedger(…).catch(…)` all come back as `withLedger` **and the node holding
+ * its arguments** — returning only the name read the `.catch()` call's empty
+ * argument list as a missing `"cli"` scope, which is the sort of near-miss that
+ * makes a gate noisy rather than wrong. Anything whose callee is not a plain
+ * identifier comes back under a name that can match nothing, which is the safe
+ * direction: an offence rather than a silent pass.
+ */
+function rootCall(call: Node): { name: string; call: Node } {
+  const callee = call.callee as Node | undefined;
+  if (callee?.type === "Identifier") return { name: callee.name as string, call };
+  if (callee?.type === "MemberExpression") {
+    const object = callee.object as Node | undefined;
+    /* `withLedger("cli", main).catch(…)` — the chain's root is the real call. */
+    if (object?.type === "CallExpression") return rootCall(object);
+  }
+  return { name: "<not a plain call>", call };
+}
+
+/** The calls a branch makes *itself*, ignoring anything it merely defines. */
+function directCalls(branch: Node): Node[] {
+  const statements =
+    branch.type === "BlockStatement" ? ((branch.body ?? []) as Node[]) : [branch];
+  const calls: Node[] = [];
+  for (const s of statements) {
+    if (s.type !== "ExpressionStatement") continue;
+    let e = s.expression as Node;
+    while (
+      e?.type === "AwaitExpression" ||
+      (e?.type === "UnaryExpression" && e.operator === "void")
+    ) {
+      e = e.argument as Node;
+    }
+    if (e?.type === "CallExpression") calls.push(e);
+  }
+  return calls;
+}
+
+/**
+ * **The whole verdict for one module**, as a function so it can be handed
+ * source text directly — including source that is deliberately broken, which is
+ * the only way to watch this go red. Returns `null` when the entrypoint is
+ * metered, and a sentence naming the file when it is not.
+ */
+export function ledgerOffence(file: string, source: string): string | null {
+  const { body, errors } = parseSource(source);
+  if (errors > 0) {
+    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
+  }
+
+  const ledger = ledgerLocalName(body);
+  if (!ledger) return `${file} — imports no withLedger from ./cli-ledger.js`;
+
+  const guards = entrypointGuards(body);
+  if (guards.length === 0) return `${file} — has no top-level entrypoint guard testing import.meta`;
+
+  for (const guard of guards) {
+    const calls = directCalls(guard.consequent as Node);
+    if (calls.length === 0) {
+      return `${file} — the entrypoint branch invokes nothing directly, so nothing proves it opens the ledger`;
+    }
+    for (const call of calls) {
+      const { name, call: opened } = rootCall(call);
+      if (name !== ledger) {
+        return `${file} — the entrypoint branch calls ${name}() directly rather than ${ledger}("cli", …)`;
+      }
+      const first = (opened.arguments as Node[])[0];
+      if (first?.type !== "StringLiteral" || first.value !== "cli") {
+        return `${file} — ${ledger} is not called with the "cli" scope`;
+      }
+    }
+  }
+  return null;
+}
+
+/** Whether a module reaches a provider seam by importing one for its values. */
+function importsSeam(source: string): boolean {
+  return parseSource(source).body.some((stmt) => {
+    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") return false;
+    const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
+    if (!SEAMS.some((s) => spec.endsWith(s))) return false;
+    return ((stmt.specifiers ?? []) as Node[]).some((sp) => sp.importKind !== "type");
+  });
+}
+
+const read = (file: string): string => readFileSync(path.join(ROOT, file), "utf8");
+
+describe("every paid CLI opens the ledger", () => {
+  it("wraps every paid CLI entrypoint in withLedger(\"cli\", …)", () => {
+    const offenders = Object.keys(PAID_CLIS)
+      .map((file) => ledgerOffence(file, read(file)))
+      .filter((o): o is string => o !== null);
+
+    expect(
+      offenders,
+      "These CLIs make paid model calls without opening the spend ledger, so the\n" +
+        "money never reaches `npm run cost` and unscopedCalls() counts it as lost.\n" +
+        "Wrap the entrypoint: `await withLedger(\"cli\", main)` — src/cli-ledger.ts.\n",
+    ).toEqual([]);
+  });
+
+  it("names every paid CLI package.json can start", () => {
+    /* The list going stale is the failure mode this test has: the two leaks it
+       exists for were both a copied stage CLI missing one line, and the next one
+       would be a *new* stage CLI missing the same line. Directly importing a
+       seam is what a stage CLI does. */
+    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
+    const entries = new Set<string>();
+    for (const cmd of Object.values(scripts)) {
+      const m = /^tsx\s+(src\/\S+\.ts)$/.exec(cmd);
+      if (m?.[1]) entries.add(m[1]);
+    }
+    const paid = [...entries].filter((f) => importsSeam(read(f))).sort();
+    expect(
+      paid,
+      "A package.json entry module imports a provider seam and is not in PAID_CLIS.\n" +
+        "Add it — and give its entrypoint withLedger(\"cli\", …) — or, if it really\n" +
+        "cannot spend, say so here with the reason.\n",
+    ).toEqual(Object.keys(PAID_CLIS).sort());
+  });
+
+  /**
+   * **The detector, proved against the broken state.**
+   *
+   * A check nobody has watched fail is not evidence — docs/reusable/silent-success.md.
+   * Every case below is one of the ways GPT Sol said a text matcher would be
+   * beaten while the money still went missing.
+   */
+  describe("the detector goes red when it should", () => {
+    const IMPORT = 'import { withLedger } from "./cli-ledger.js";\n';
+    const GUARD =
+      "const isMain =\n" +
+      "  process.argv[1] !== undefined &&\n" +
+      "  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);\n";
+
+    const bad: [string, string][] = [
+      [
+        "a bare main() at the entrypoint — the two leaks, exactly",
+        `${IMPORT}${GUARD}if (isMain) void main();`,
+      ],
+      [
+        "the labels.ts idiom, where import.meta is in the `if` test itself",
+        `${IMPORT}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await main();\n}`,
+      ],
+      [
+        /* A comment is not code. This is the case that made the proximity grep
+           unusable, and the one an AST cannot be fooled by. */
+        "the wrapper present only in a comment",
+        `${IMPORT}${GUARD}/* if (isMain) await withLedger("cli", main); */\nif (isMain) await main();`,
+      ],
+      [
+        "the wrapper in a dead branch beside a bare main()",
+        `${IMPORT}${GUARD}if (false) await withLedger("cli", main);\nif (isMain) await main();`,
+      ],
+      [
+        /* Spelled right, bound to nothing. The binding check is the only thing
+           between this and a green suite. */
+        "a locally-defined withLedger that opens no ledger",
+        'const withLedger = async (_k: string, f: () => Promise<void>) => f();\n' +
+          `${GUARD}if (isMain) await withLedger("cli", main);`,
+      ],
+      [
+        "the wrapper named in the branch but never called",
+        `${IMPORT}${GUARD}if (isMain) {\n  const run = () => withLedger("cli", main);\n  await main();\n}`,
+      ],
+      [
+        /* A correct wrapper does not license a second, unwrapped call beside it. */
+        "a correct wrapper with a bare main() alongside",
+        `${IMPORT}${GUARD}if (isMain) {\n  await withLedger("cli", main);\n  await main();\n}`,
+      ],
+      [
+        "the wrapper opened with the wrong scope",
+        `${IMPORT}${GUARD}if (isMain) await withLedger("eval", main);`,
+      ],
+      [
+        "no entrypoint guard at all",
+        `${IMPORT}await main();`,
+      ],
+      [
+        /* Recovery rather than a throw, so a file this cannot read becomes an
+           offence instead of an empty program that looks clean. */
+        "a file it cannot parse",
+        `${IMPORT}${GUARD}if (isMain) await withLedger("cli", main);\nfunction (((`,
+      ],
+    ];
+    for (const [name, source] of bad) {
+      it(name, () => {
+        expect(ledgerOffence("fixture.ts", source)).not.toBeNull();
+      });
+    }
+
+    it("accepts both real guard idioms and nothing else", () => {
+      expect(ledgerOffence("fixture.ts", `${IMPORT}${GUARD}if (isMain) void withLedger("cli", main);`)).toBeNull();
+      expect(
+        ledgerOffence(
+          "fixture.ts",
+          `${IMPORT}if (path.resolve(process.argv[1] ?? "") === path.resolve(import.meta.filename)) {\n  await withLedger("cli", main);\n}`,
+        ),
+      ).toBeNull();
+      /* `withLedger("eval", main).catch(…)` is how evals/prompt-caching.ts ends;
+         the chained form has to resolve to the call underneath it. */
+      expect(
+        ledgerOffence(
+          "fixture.ts",
+          `${IMPORT}${GUARD}if (isMain) withLedger("cli", main).catch(() => process.exit(1));`,
+        ),
+      ).toBeNull();
+    });
+
+    /**
+     * **The same mutation, on the real files, in both guard idioms.**
+     *
+     * The fixtures above are made up; these are the tree as it stands, passed,
+     * and then put back into the exact state the bug was in. `src/toc.ts` is
+     * here because it was never broken, so this proves something on the day the
+     * other two are fixed *and* on the day one of them regresses — a control
+     * that is a no-op when written leaves a green test with nothing behind it.
+     *
+     * Both idioms, because they differ and harmonising them is a separate piece
+     * of work: `import.meta` inside the `if` test (`labels.ts`), and a named
+     * `isMain` const (the other seven).
+     */
+    const realFiles: [string, string, string][] = [
+      ["src/toc.ts", 'if (isMain) void withLedger("cli", main);', "if (isMain) void main();"],
+      [
+        "src/pdf-read.ts",
+        'if (isMain) await withLedger("cli", main);',
+        "if (isMain) void main();",
+      ],
+      [
+        "src/labels.ts",
+        '  await withLedger("cli", main);',
+        "  await main();",
+      ],
+    ];
+    for (const [file, wrapper, bare] of realFiles) {
+      it(`goes red on ${file} the moment the wrapper is taken out`, () => {
+        const wrapped = read(file);
+        expect(ledgerOffence(file, wrapped)).toBeNull();
+
+        const unwrapped = wrapped.replace(wrapper, bare);
+        expect(
+          unwrapped,
+          `the mutation matched nothing — ${file} has changed shape, so this control proved nothing`,
+        ).not.toBe(wrapped);
+        expect(ledgerOffence(file, unwrapped)).not.toBeNull();
+      });
+    }
+  });
+});
```

commit 47a3959c734308dd36f1c23efcee545539283f3e
Author: Greg Detre <greg@gregdetre.com>
Date:   Fri Aug 28 15:29:40 2026 +0300

    A reload that failed took away the list the reader was already reading
    
    `useGlossary` carries a guard and a paragraph explaining it: a failed
    revalidation must not take the list away, because only the opening read has
    nothing to fall back on. `useIdeas`, `useSummaries` and `Tweets.tsx` were copied
    from it and none of them has it — they set `status` to `error` unconditionally.
    
    `load` is not only the opening read. Each of them calls it again from
    `onFinished` every time a job that writes its artefact completes, with the
    reader sitting there watching. `IdeasPanel` renders the list only under
    `status === "ready"`, so a flaky connection behind an open band blanked a list
    that was still perfectly good, and left the reader a message about a request
    they never made. The thread page did the same.
    
    The dates are the point. useSummaries was written on the 26th, useIdeas on the
    27th, and the guard landed in the glossary on the 28th — the fix reached the
    original *after* both copies were taken, and nothing propagated it or could have
    noticed. That is the argument for 2.1 in the plan, not a coincidence.
    
    useSummaries was latent rather than live: SummaryPanel keys visibility on
    `summaries !== null`, deliberately and with a comment. Fixed anyway; the hook's
    contract should not depend on which of its two facts the panel happened to read.
    
    Tweets could not take the one-line version — its state is a discriminated union
    and cannot hold both a thread and a failure — so the thread is retained and the
    failure gets its own muted line. That is new reader-facing copy and wants a
    browser pass.
    
    Also here: useIdeas told the reader "The request did not reach the server" for
    every failure to start a job. `useJobs.run` returns null for any throw,
    including a 4xx or 5xx the server sent back, so a job the server received and
    refused was reported as a dead network and the server's own reason was thrown
    away. The other three hooks read `queue.error` at render time and document why;
    this one never learned it.
    
    Eight tests, and the guard was checked against the broken state: putting the
    `useIdeas` line back reddens exactly one of them.
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01M5tbuz57fs7M3nJAf6hzkR

```diff
diff --git a/docs/project/web-client.md b/docs/project/web-client.md
index dc2befc..73ac2b9 100644
--- a/docs/project/web-client.md
+++ b/docs/project/web-client.md
@@ -450,6 +450,59 @@ closed over by the effect's cleanup is per-run by construction; all three hooks
 use it. `tests/load-failed-flags.test.ts` mounts under a real `StrictMode` and
 asserts the double-run happened before relying on it.
 
+### A failed *reload* must not take the answer away
+
+There is a fourth state, and it is the one the rule above does not cover: **we
+asked again, over an answer we already had, and this time it failed.** The list
+on screen is still true — it is just no longer known to be the newest truth — so
+a hook that drops into `error` has taken something correct off the reader's
+screen to tell them about a request they never made.
+
+It is not a rare path. Every artefact hook reloads from `onFinished` whenever a
+job that writes its artefact completes, and the reader is sitting there watching
+when it happens.
+
+The guard is one line, and the state it protects is the one the panel renders on:
+
+```ts
+setStatus((was) => (was === "loading" ? "error" : was));
+```
+
+Only the opening read has nothing to fall back on. **The error is still
+reported** — `error` is a separate field from `status`, and the panels put it
+above the list — so this is not a swallowed failure, it is a failure said beside
+the thing it failed to replace. [`Tweets.tsx`](../../src/web/Tweets.tsx) has to
+say it in a second state (`reloadError`) because its `Loaded` union cannot hold a
+thread and a message at once.
+
+[`useGlossary`](../../src/web/useGlossary.ts) learned this from a GPT Sol review
+of the built code on 2026-08-28. **Three hooks had been copied from it before
+that** — `useSummaries` (26 Aug), `useIdeas` (27 Aug) and `Tweets.tsx` — and
+none of them inherited the fix, because a fix that lands in the original after
+the copies were taken has nothing to propagate it. Two of the three were live:
+`IdeasPanel` and the thread page both render only in their ready branch.
+[`useShelf`](../../src/web/useShelf.ts) is the one that had it right all along —
+it never nulls `articles` on a failed reload, and `Library` draws the shelf and
+the message together.
+
+`tests/background-reload-keeps-the-list.test.tsx` is the pattern, and the shape
+matters: the reload is driven through the **job-completion callback**, not by
+calling the loader directly, because calling it directly passes on a hook whose
+`onFinished` is wired to nothing. Each surface keeps a sibling test for the
+opening read, so "keeps the list" cannot pass by never reporting a failure at
+all.
+
+**And `postFailed` does not mean the request never landed.** `queue.run` returns
+`null` for *any* throw, including `readJson` on a 4xx or 5xx
+([`useJobs.ts`](../../src/web/useJobs.ts) § `act`) — so a job the server received
+and refused is one of these. Every surface says
+`postFailed ? (queue.error ?? "Couldn't start the job.") : stopped`, read at
+render rather than inside the click handler; reading it inside gives you the
+value from the render that created the closure, which is the previous error or
+none at all. `useIdeas` claimed *"The request did not reach the server."* until
+2026-08-28, which threw the server's own reason away and replaced it with a
+false one.
+
 ### The waiting state
 
 **Behind [`useSlow`](../../src/web/useSlow.ts)**, wherever the indicator *stands
diff --git a/src/web/Tweets.tsx b/src/web/Tweets.tsx
index c6229fa..db32da2 100644
--- a/src/web/Tweets.tsx
+++ b/src/web/Tweets.tsx
@@ -98,6 +98,15 @@ type Loaded =
 
 export function Tweets({ slug, article }: { slug: string; article: Article }) {
   const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
+  /**
+   * A read that failed **while a thread was already on screen**.
+   *
+   * Separate from `loaded`, because the union cannot hold both a thread and a
+   * failure and the reader needs both: the posts are still the truth about the
+   * article, and the fact that we could not check for a newer set is worth a
+   * line rather than a silence. See the catch in `load`.
+   */
+  const [reloadError, setReloadError] = useState<string | null>(null);
   const slow = useSlow(loaded.status === "loading");
 
   /* The tab: the article first, then which of its pages this is — and `Tweets`
@@ -116,12 +125,24 @@ export function Tweets({ slug, article }: { slug: string; article: Article }) {
       const res = await apiFetch(`/api/tweets/${encodeURIComponent(slug)}`);
       if (res.status === 404) {
         setLoaded({ status: "none" });
+        setReloadError(null);
         return;
       }
       const { thread, stale, profileChanged } = await readJson<ThreadResponse>(res);
       setLoaded({ status: "ready", thread, stale, profileChanged });
+      setReloadError(null);
     } catch (err) {
-      setLoaded({ status: "error", message: (err as Error).message });
+      const message = (err as Error).message;
+      /* **A failed reload must not take the thread away.** `load` is not only
+         the opening read — `onFinished` below calls it again when a job
+         finishes — and the posts render only in the `ready` branch, so
+         replacing the whole union with `{status:"error"}` left a reader who was
+         mid-thread with a message where the thread had been. Only the opening
+         read has nothing to fall back on; the rest keep what they have and say
+         so in `reloadError`. Same guard, same reason, as useGlossary.ts §
+         `fetchNow`. */
+      setLoaded((was) => (was.status === "loading" ? { status: "error", message } : was));
+      setReloadError(message);
     }
   }, [slug]);
 
@@ -261,6 +282,17 @@ export function Tweets({ slug, article }: { slug: string; article: Article }) {
           <p className="tw:mt-6 tw:text-sm tw:text-destructive">{loaded.message}</p>
         )}
 
+        {/* A reload failed behind something that is still on screen. Muted
+            rather than destructive, and below the title rather than over the
+            thread: nothing the reader is looking at is wrong, we just could not
+            check whether there is a newer one. Not shown in the `error` branch
+            above, which is the same failure said once already. */}
+        {loaded.status !== "error" && reloadError && (
+          <p className="tw:mt-6 tw:mb-0 tw:text-xs tw:text-muted-foreground">
+            Couldn't check for a newer thread — {reloadError}
+          </p>
+        )}
+
         {loaded.status === "none" && (
           <Empty job={job} failed={failed} onWrite={write} onCancel={queue.cancel} />
         )}
diff --git a/src/web/useIdeas.ts b/src/web/useIdeas.ts
index 6151105..c04f584 100644
--- a/src/web/useIdeas.ts
+++ b/src/web/useIdeas.ts
@@ -107,7 +107,14 @@ export function useIdeas(slug: string): UseIdeas {
       setStatus("ready");
     } catch (err) {
       setError((err as Error).message);
-      setStatus("error");
+      /* **A failed revalidation must not take the list away.** `load` is not
+         only the opening read — `onFinished` below calls it again every time a
+         job finishes — and `IdeasPanel` renders the list only under
+         `status === "ready"`, so an unconditional `error` here made a flaky
+         connection blank a list that was still perfectly good. Only the opening
+         read has nothing to fall back on. The message is shown either way. Same
+         guard, same reason, as useGlossary.ts § `fetchNow`. */
+      setStatus((was) => (was === "loading" ? "error" : was));
     }
   }, [slug]);
 
@@ -175,6 +182,25 @@ export function useIdeas(slug: string): UseIdeas {
     [queue, slug],
   );
 
+  /* Two quite different silences, one sentence. `postFailed` is having no job —
+     nothing will arrive in the list to explain it. `stopped` is a job that
+     started and died, which matters because a failed job leaves the running set
+     and the button would otherwise simply reappear as though nothing had
+     happened.
+
+     **`postFailed` does not mean the request never landed.** `queue.run`
+     returns null for any throw, and `readJson` throws on a 4xx or a 5xx
+     (src/web/useJobs.ts § `act`) — so a job the server received and refused
+     was being reported as a dead network, which is false, and the server's own
+     reason was thrown away. `queue.error` is what it said.
+
+     Read here at render and not inside `find`, where it would be the value from
+     the render that created the closure — `useJobs` sets it during the same
+     `await`, so reading it there gives you the *previous* error, or null, which
+     is how a failed request ends up reported as nothing at all. Learned on the
+     thread page, met again in the glossary, and the same trap is here. */
+  const failed = postFailed ? (queue.error ?? "Couldn't start the job.") : stopped;
+
   return {
     status,
     ideas,
@@ -185,12 +211,7 @@ export function useIdeas(slug: string): UseIdeas {
     hasProfile,
     error,
     job,
-    /* Two quite different silences, one sentence. `postFailed` is the request
-       never landing — no job exists, so nothing will arrive in the list to
-       explain it. `stopped` is a job that started and died, which matters
-       because a failed job leaves the running set and the button would
-       otherwise simply reappear as though nothing had happened. */
-    failed: postFailed ? "The request did not reach the server." : stopped,
+    failed,
     find,
     cancel: queue.cancel,
   };
diff --git a/src/web/useSummaries.ts b/src/web/useSummaries.ts
index 3ff66ef..a220b6e 100644
--- a/src/web/useSummaries.ts
+++ b/src/web/useSummaries.ts
@@ -110,7 +110,18 @@ export function useSummaries(slug: string): UseSummaries {
       setStatus("ready");
     } catch (err) {
       setError((err as Error).message);
-      setStatus("error");
+      /* **A failed revalidation must not take the artefact away.** `load` is
+         not only the opening read — `onFinished` below calls it again whenever
+         a job finishes — so an unconditional `error` here throws away an
+         artefact that is still on screen. Only the opening read has nothing to
+         fall back on. Same guard, same reason, as useGlossary.ts § `fetchNow`.
+
+         `SummaryPanel` happens to key its visibility on `summaries !== null`
+         rather than on this, deliberately and with a comment, so today the
+         reader would not have seen the panel empty. That is one edit away from
+         being untrue, and the hook's contract should not depend on which of its
+         two facts the panel chose to read. */
+      setStatus((was) => (was === "loading" ? "error" : was));
     }
   }, [slug]);
 
diff --git a/tests/background-reload-keeps-the-list.test.tsx b/tests/background-reload-keeps-the-list.test.tsx
new file mode 100644
index 0000000..b47a599
--- /dev/null
+++ b/tests/background-reload-keeps-the-list.test.tsx
@@ -0,0 +1,405 @@
+// @vitest-environment jsdom
+/**
+ * **A failed background reload must not take the artefact off the screen.**
+ *
+ * `useGlossary` learned this on 2026-08-28 (commit 43a8285, after a GPT Sol
+ * review of the built code): the panel renders its entries only when `status`
+ * is `ready`, so an unconditional `setStatus("error")` in the catch meant a
+ * reader on a flaky connection watched a perfectly good list vanish and be
+ * replaced by a message. The guard it grew is
+ * `setStatus((was) => (was === "loading" ? "error" : was))` — only the opening
+ * read has nothing to fall back on.
+ *
+ * Three hooks were copied from that one **before** the guard landed, and none
+ * of them had it: `useSummaries` (26 Aug), `useIdeas` (27 Aug) and the thread
+ * page's own loader in `Tweets.tsx`. Two of the three were live bugs, because
+ * `load()` is not only the opening read — every one of them calls it again from
+ * `onFinished` whenever a job that writes their artefact completes.
+ *
+ * ## Why the tests are shaped the way they are
+ *
+ * **The replies are held**, exactly as `tests/glossary-one-fetch.test.tsx`
+ * holds them. A mock that resolves the moment it is called cannot tell "did not
+ * blank the list" from "blanked it and refilled it inside the same `act`" —
+ * docs/reusable/silent-success.md.
+ *
+ * **The reload is driven through `onFinished`, not by calling `load()`.** A
+ * GPT Sol review asked for the real sequence: a list arrives, a matching job
+ * finishes, the background GET fails, and the list is still there. Calling the
+ * loader directly would pass with the job-completion callback unwired, which is
+ * the only thing that makes this reachable by a reader at all.
+ *
+ * **Each surface keeps a sibling test for the opening read**, so the first
+ * cannot pass by simply never reporting a failure.
+ *
+ * The other half of the file is `useIdeas.failed`, which told the reader
+ * something false: any throw out of `queue.run` — including a 4xx or 5xx that
+ * the server sent back with a reason — was reported as *"The request did not
+ * reach the server."*, and the server's own message was dropped. Its three
+ * siblings all say `queue.error ?? "Couldn't start the job."`.
+ *
+ * Written against the hooks rather than the reading view, for the reason
+ * `tests/glossary-one-fetch.test.tsx` gives: mounting `Reader` drags in nuqs,
+ * Supabase and the layout. `Tweets` is a page and is mounted whole, with only
+ * the Dock stubbed.
+ */
+import { act, createElement, type ReactElement } from "react";
+import { createRoot, type Root } from "react-dom/client";
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+import type { Article, Ideas, Summaries, TweetThread } from "../src/types.js";
+
+/* React only permits `act` when the environment says it is a test one. Without
+   this every render below still runs, and warns, and the effects it is meant to
+   flush may not have — a green test over work that never happened. */
+(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
+
+/** Every `/api/` request the renders below made, in order. */
+const asked: string[] = [];
+/** Whether the next reply is a dead network rather than an answer. */
+let fails = false;
+/** Replies, held until a test lets them go. See the header. */
+const held: Array<() => void> = [];
+
+/** What each artefact endpoint would return **right now**. Tests mutate these. */
+let ideaNames = ["ideas are cheap"];
+let summaryShorts = ["the short of it"];
+let tweetTexts = ["the first post"];
+
+function ideasArtefact(slug: string): Ideas {
+  return {
+    version: "ideas/1",
+    generator: "test",
+    slug,
+    sourceHash: "abc",
+    profileHash: null,
+    ideas: ideaNames.map((name, i) => ({
+      id: `spya-idea${i}`,
+      name,
+      provenance: "assumed",
+      statement: name,
+      blocks: [],
+    })),
+    generatedAt: "2026-08-28T00:00:00.000Z",
+    elapsedMs: 1,
+  } as unknown as Ideas;
+}
+
+function summariesArtefact(slug: string): Summaries {
+  return {
+    version: "summary/1",
+    generator: "test",
+    slug,
+    sourceHash: "abc",
+    profileHash: null,
+    entries: summaryShorts.map((short) => ({
+      range: ["spya-a", "spya-b"],
+      depth: 0,
+      short,
+    })),
+    generatedAt: "2026-08-28T00:00:00.000Z",
+    elapsedMs: 1,
+  } as unknown as Summaries;
+}
+
+function threadArtefact(slug: string): TweetThread {
+  return {
+    version: "tweets/1",
+    generator: "test",
+    slug,
+    sourceHash: "abc",
+    profileHash: null,
+    limit: 280,
+    tweets: tweetTexts.map((text) => ({ text, chars: [...text].length })),
+    generatedAt: "2026-08-28T00:00:00.000Z",
+    elapsedMs: 1,
+  } as unknown as TweetThread;
+}
+
+/**
+ * The body is decided when the request **arrives**, not when it is answered —
+ * which is what a server does, and what makes a held reply describe the world
+ * as it was at the moment of asking rather than the world after the test moved
+ * it. Copied from `tests/glossary-one-fetch.test.tsx`, where getting it the
+ * other way round made two tests tautologies.
+ */
+function bodyFor(url: string): string {
+  const slug = url.split("/").pop() ?? "";
+  if (url.startsWith("/api/ideas/")) {
+    return JSON.stringify({
+      ideas: ideasArtefact(slug),
+      stale: false,
+      outdated: false,
+      profileChanged: false,
+    });
+  }
+  if (url.startsWith("/api/summary/")) {
+    return JSON.stringify({ summaries: summariesArtefact(slug), stale: false, profileChanged: false });
+  }
+  if (url.startsWith("/api/tweets/")) {
+    return JSON.stringify({ thread: threadArtefact(slug), stale: false, profileChanged: false });
+  }
+  throw new Error(`the test made an unexpected request: ${url}`);
+}
+
+vi.mock("../src/web/lib/api.js", () => ({
+  apiFetch: async (input: string) => {
+    asked.push(input);
+    const body = bodyFor(input);
+    const dead = fails;
+    await new Promise<void>((go) => held.push(go));
+    if (dead) throw new TypeError("Failed to fetch");
+    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
+  },
+  leavingFetch: async () => undefined,
+  readJson: async (res: Response) => res.json(),
+  failure: async (res: Response) => new Error(String(res.status)),
+}));
+
+/**
+ * The job poller, posed by the test rather than polling.
+ *
+ * `finishJob` below is what a completed run looks like arriving — the seam the
+ * background reload hangs off, and the one a test that called `load()` directly
+ * would leave unexercised.
+ */
+let onFinished: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null =
+  null;
+/** What `queue.run` hands back, and what `queue.error` says. Set by the tests that care. */
+let runResult: { id: string } | null = { id: "job1" };
+let queueError: string | null = null;
+vi.mock("../src/web/useJobs.js", () => ({
+  useJobs: (cb?: (job: never) => void) => {
+    onFinished = (cb ?? null) as typeof onFinished;
+    return {
+      jobs: [],
+      loaded: true,
+      error: queueError,
+      run: async () => runResult,
+      cancel: async () => {},
+    };
+  },
+}));
+
+/* Needs a session and a slug; the answer changes nothing under test here. */
+vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));
+
+/* The thread page's bottom bar reaches Supabase and the whole visitor layer,
+   and none of it is what this file is about. */
+vi.mock("../src/web/Dock.js", () => ({ Dock: () => null }));
+
+const { useIdeas } = await import("../src/web/useIdeas.js");
+const { useSummaries } = await import("../src/web/useSummaries.js");
+const { Tweets } = await import("../src/web/Tweets.js");
+
+/** A job for this article, landing in the hook's poll as finished. */
+function finishJob(step: string, slug = "constitution"): void {
+  onFinished?.({ slug, status: "done", steps: [{ name: step }] });
+}
+
+let ideasHook: ReturnType<typeof useIdeas> | null = null;
+
+/**
+ * What `IdeasPanel` does: the list is on screen **only** in the ready branch
+ * (src/web/IdeasPanel.tsx § `status === "ready" && ideas`). That gate is what
+ * turns an unconditional `error` into a list disappearing.
+ */
+function IdeasHarness({ slug }: { slug: string }): ReactElement {
+  const all = useIdeas(slug);
+  ideasHook = all;
+  const names = all.ideas?.ideas.map((i) => i.name).join(",") ?? "";
+  return createElement("aside", null, all.status === "ready" && all.ideas ? names : all.status);
+}
+
+let summariesHook: ReturnType<typeof useSummaries> | null = null;
+
+/**
+ * Keyed on `status`, which is **not** what `SummaryPanel` does — it keys on
+ * `summaries !== null` on purpose, and says so in a comment, which is why this
+ * hook's copy of the bug is latent rather than live. The invariant being tested
+ * is the hook's, and it is the one its three siblings hold: a failed
+ * revalidation does not move `status` off `ready`. One edit in the panel would
+ * otherwise make this live with nothing red to say so.
+ */
+function SummariesHarness({ slug }: { slug: string }): ReactElement {
+  const all = useSummaries(slug);
+  summariesHook = all;
+  const shorts = all.summaries?.entries.map((e) => e.short).join(",") ?? "";
+  return createElement("aside", null, all.status === "ready" && all.summaries ? shorts : all.status);
+}
+
+const ARTICLE = {
+  meta: { slug: "constitution", title: "A Constitution", url: "https://example.com/c" },
+  blocks: [{ id: "spya-a", kind: "p", text: "some words here" }],
+  tree: { rootId: "spya-root", nodes: {} },
+} as unknown as Article;
+
+let host: HTMLDivElement;
+let root: Root;
+
+function asks(prefix: string): number {
+  return asked.filter((u) => u.startsWith(prefix)).length;
+}
+
+beforeEach(() => {
+  asked.length = 0;
+  held.length = 0;
+  onFinished = null;
+  ideasHook = null;
+  summariesHook = null;
+  fails = false;
+  runResult = { id: "job1" };
+  queueError = null;
+  ideaNames = ["ideas are cheap"];
+  summaryShorts = ["the short of it"];
+  tweetTexts = ["the first post"];
+  host = document.createElement("div");
+  document.body.appendChild(host);
+  root = createRoot(host);
+});
+
+afterEach(() => {
+  act(() => root.unmount());
+  host.remove();
+});
+
+/** Render, and let the effects run — but do not answer anything yet. */
+async function render(el: ReactElement): Promise<void> {
+  await act(async () => {
+    root.render(el);
+  });
+}
+
+/** Answer every request now in flight, and let the renders it causes finish. */
+async function settle(): Promise<void> {
+  await act(async () => {
+    for (const go of held.splice(0).reverse()) go();
+    await Promise.resolve();
+  });
+  await act(async () => {
+    await Promise.resolve();
+  });
+}
+
+describe("the ideas panel", () => {
+  it("keeps the list when the reload after a job fails", async () => {
+    await render(createElement(IdeasHarness, { slug: "constitution" }));
+    await settle();
+    expect(host.querySelector("aside")?.textContent).toBe("ideas are cheap");
+
+    /* The real sequence: a job that writes ideas finishes, `onFinished` fires,
+       and the GET it starts dies on the way out. The list on screen is still
+       the truth about the article — it just may no longer be the newest truth. */
+    fails = true;
+    await act(async () => {
+      finishJob("ideas");
+    });
+    /* The reload really happened; without this the test would pass on a hook
+       whose `onFinished` was never wired to anything. */
+    expect(asks("/api/ideas/")).toBe(2);
+    await settle();
+
+    expect(ideasHook?.status).toBe("ready");
+    expect(ideasHook?.error).toContain("Failed to fetch");
+    expect(host.querySelector("aside")?.textContent).toBe("ideas are cheap");
+  });
+
+  it("still reports a failure that leaves us with nothing", async () => {
+    /* The other half, so the test above cannot pass by never reporting an error
+       at all: the opening read has no list to fall back on. */
+    fails = true;
+    await render(createElement(IdeasHarness, { slug: "constitution" }));
+    await settle();
+    expect(ideasHook?.status).toBe("error");
+  });
+});
+
+describe("the summary panel", () => {
+  it("keeps the artefact when the reload after a job fails", async () => {
+    await render(createElement(SummariesHarness, { slug: "constitution" }));
+    await settle();
+    expect(host.querySelector("aside")?.textContent).toBe("the short of it");
+
+    fails = true;
+    await act(async () => {
+      finishJob("summary");
+    });
+    expect(asks("/api/summary/")).toBe(2);
+    await settle();
+
+    expect(summariesHook?.status).toBe("ready");
+    expect(summariesHook?.error).toContain("Failed to fetch");
+    expect(host.querySelector("aside")?.textContent).toBe("the short of it");
+  });
+
+  it("still reports a failure that leaves us with nothing", async () => {
+    fails = true;
+    await render(createElement(SummariesHarness, { slug: "constitution" }));
+    await settle();
+    expect(summariesHook?.status).toBe("error");
+  });
+});
+
+describe("the thread page", () => {
+  it("keeps the thread when the reload after a job fails", async () => {
+    await render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
+    await settle();
+    expect(host.textContent).toContain("the first post");
+
+    fails = true;
+    await act(async () => {
+      finishJob("tweets");
+    });
+    expect(asks("/api/tweets/")).toBe(2);
+    await settle();
+
+    /* The thread renders only in the `ready` branch of a discriminated union,
+       so replacing the whole union with `{status:"error"}` took the posts off
+       the page — and the reader was left with a message where the thread was. */
+    expect(host.textContent).toContain("the first post");
+    /* ...and the failure is still said out loud. It has to be said somewhere:
+       the job finished, so `JobProgress` has gone quiet, and a reader who saw a
+       run complete and the page not change would have nothing to go on. */
+    expect(host.textContent).toContain("Failed to fetch");
+  });
+
+  it("still reports a failure that leaves us with nothing", async () => {
+    fails = true;
+    await render(createElement(Tweets, { slug: "constitution", article: ARTICLE }));
+    await settle();
+    expect(host.textContent).toContain("Failed to fetch");
+    expect(host.textContent).not.toContain("the first post");
+  });
+});
+
+describe("a job the server received and refused", () => {
+  /* `queue.run` returns null for **any** throw out of the POST, including
+     `readJson` throwing on a 4xx or 5xx (src/web/useJobs.ts § `act`). So
+     `postFailed` does not mean "the request never landed" — it means "we have
+     no job", and the two have different sentences. The other three surfaces
+     read `queue.error`, which carries what the server actually said. */
+  it("says what the server said, not that the request never landed", async () => {
+    await render(createElement(IdeasHarness, { slug: "constitution" }));
+    await settle();
+
+    runResult = null;
+    queueError = "You are out of credit for today.";
+    await act(async () => {
+      await ideasHook?.find();
+    });
+
+    expect(ideasHook?.failed).toBe("You are out of credit for today.");
+  });
+
+  it("falls back to a sentence of its own when the queue has no message", async () => {
+    await render(createElement(IdeasHarness, { slug: "constitution" }));
+    await settle();
+
+    runResult = null;
+    queueError = null;
+    await act(async () => {
+      await ideasHook?.find();
+    });
+
+    expect(ideasHook?.failed).toBe("Couldn't start the job.");
+  });
+});
```

commit ca1bf40d646cdc5df303371d3be07954a3c2f7ce
Author: Greg Detre <greg@gregdetre.com>
Date:   Fri Aug 28 15:30:49 2026 +0300

    The comment said its CLI still used it, and the CLI never had
    
    `glossaryIsCurrent` was the glossary step's freshness check until `stamp`
    replaced it. `pipeline.ts` then said it was "still exported from
    src/glossary.ts because its CLI uses it" — glossary's `main()` never called it.
    Its only callers were its own three tests, which is why knip could not see it:
    knip counts tests as consumers.
    
    So the sentence was not stale documentation, it was the thing keeping the
    function alive. Deleted, with its three test cases. `isStale` stays — it is the
    pure half and the API response uses it to tell the panel the list is out of
    date. The conditions those tests covered are asserted against the live path in
    tests/pipeline-artifact-store.test.ts.
    
    Deleting twelve lines meant correcting six other places that named it, two of
    them project docs asserting it was the live mechanism: glossary.md said
    "`glossaryIsCurrent` is the step's `isDone`". A deletion is never one edit, and
    `npm run typecheck` is what found the four imports the test file no longer used.
    
    And in store/revisions.ts, a heading that said "What is wired, and what is still
    only half-connected", under which "Wired: a job opens a draft, records each step
    it runs against it, and publishes or fails it."
    
    Nothing opens a draft. `revisionLifecycle` is referenced by one test and by
    nothing in src/; jobs.ts says "draft" once, in a comment about something else.
    So the paragraphs describing what an ingest does under SPIDERYARN_STORE=postgres
    — the empty draft, the refused publish, the one warn line — describe a sequence
    that cannot occur. They are now in the future tense, where they belong.
    
    The commit that created that seam is 457fa74, "Give the revision adapter a seam,
    because nothing was calling it", and its message says: "That is the worst state
    in this migration: the work looks finished from the outside and the running code
    has never once gone through it." It is one file, 259 insertions, no change to
    jobs.ts. The seam repeated the failure it was written to end, one level up.
    
    Not fixing the wiring — that is step 11 and somebody else is in those files.
    Recorded instead that `sweep()` has no caller either, and that abandoned drafts
    each carry a full copy of the article's blocks, so the first production
    `begin()`, the artefact wiring, a scheduled `sweep()` and a test proving drafts
    are removed have to land together.
    
    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01M5tbuz57fs7M3nJAf6hzkR

```diff
diff --git a/docs/project/glossary.md b/docs/project/glossary.md
index 9e3d519..015491a 100644
--- a/docs/project/glossary.md
+++ b/docs/project/glossary.md
@@ -665,13 +665,19 @@ wrong.
 
 ## Staleness, and the force cascade
 
-`glossaryIsCurrent` is the step's `isDone`, and it checks the three things
+The step's freshness check is its `stamp` in [`src/pipeline.ts`](../../src/pipeline.ts), compared
+by `sameStamp`. It checks the three things
 [architecture.md § Storage](architecture.md#storage) has always specified for a cached artefact: the
 blocks it was written from (`sourceHash`), the prompt version, and the model id. Change any one and
 it regenerates by itself, with no `force` and nobody having to remember. Anything unreadable answers
 **false**, which is the safe way round: the cost is one model call, where the other way is a stale
 glossary served for ever.
 
+Until 2026-08-28 this was a hand-written `glossaryIsCurrent` in `src/glossary.ts` doing the same
+three comparisons. `stamp` replaced it, the function kept only its own tests alive, and a comment in
+`pipeline.ts` wrongly said the CLI still needed it — so it was deleted. `isStale` stays: it is the
+pure half, and the API response uses it to tell the panel the list is out of date.
+
 `hashBlocks` moved out of `src/tweets.ts` into [`src/source-hash.ts`](../../src/source-hash.ts) for
 this, and that is not tidying: two stages computing "the same" fingerprint two ways can only ever
 disagree, and the day they do, one artefact reports itself current against a different definition of
diff --git a/docs/project/testing.md b/docs/project/testing.md
index 43dd955..b1b008d 100644
--- a/docs/project/testing.md
+++ b/docs/project/testing.md
@@ -63,7 +63,7 @@ Everything here is **deterministic**: no network, no LLM calls, no clock, no uns
 | [`tests/comment-nav.test.ts`](../../tests/comment-nav.test.ts) | comments in reading order and stepping between them — including that the order comes from the block **index**, never the id string |
 | [`tests/jobs.test.ts`](../../tests/jobs.test.ts) | the ingest queue's decisions — step ordering, the restart sweep, and the request parsing that stands between a POST body and `path.join("data", slug)` ([ingest-queue.md](ingest-queue.md)). **Nothing here runs a job**: queuing one fetches somebody's website and spends money at two model endpoints |
 | [`tests/ingest.test.ts`](../../tests/ingest.test.ts) | what an article gets called, and whether that name is safe to make a path out of |
-| [`tests/glossary.test.ts`](../../tests/glossary.test.ts) | stage 5d's deterministic halves — the matching rule (including both directions in which `\b` is wrong about an accented letter), the **richness-scored dedup** that keeps the more specific phrase, the `javascript:` URL check, the occurrence pass, and `glossaryIsCurrent` ([glossary.md](glossary.md)) |
+| [`tests/glossary.test.ts`](../../tests/glossary.test.ts) | stage 5d's deterministic halves — the matching rule (including both directions in which `\b` is wrong about an accented letter), the **richness-scored dedup** that keeps the more specific phrase, the `javascript:` URL check, the occurrence pass, and `isStale` ([glossary.md](glossary.md)) |
 | [`tests/tweets.test.ts`](../../tests/tweets.test.ts) | stage 5c's deterministic halves — counting a post's characters, the artefact shape, how many posts to ask for, and **`threadIsCurrent`**, the first step freshness check in the repo ([tweet-thread-page.md](../plans/tweet-thread-page.md)) |
 | [`tests/chat.test.ts`](../../tests/chat.test.ts) | chat's checkable arithmetic — what a conversation gets called, which whole turns go back to the model, which cited block ids are real, and what a **retry** and an **edit** are allowed to do to a stored conversation ([chat-mode.md](../plans/chat-mode.md)) |
 | [`tests/converse-stop.test.ts`](../../tests/converse-stop.test.ts) | that pressing **stop** ends in a `done` and never in a throw — through `converse` with a stubbed `fetch`, on all three ways the stream can end. It goes through `converse` rather than building the message row by hand because [a test that built the row by hand](../plans/chat-mode.md#the-second-review-and-what-it-found) passed while the code did the opposite |
diff --git a/src/glossary.ts b/src/glossary.ts
index 9423a95..c727723 100644
--- a/src/glossary.ts
+++ b/src/glossary.ts
@@ -700,8 +700,8 @@ export function buildGlossary(
  *
  * Pure, and used at both ends, exactly as the thread's is: `GET
  * /api/glossary/:slug` puts the answer in the response so the panel can say the
- * list is out of date, and `glossaryIsCurrent` below wraps it so the pipeline
- * will not skip a step whose artefact has gone stale.
+ * list is out of date, and the pipeline's `stamp` (src/pipeline.ts) compares the
+ * same `sourceHash` so it will not skip a step whose artefact has gone stale.
  */
 export function isStale(glossary: Glossary, blocks: BlockFingerprint[]): boolean {
   return glossary.sourceHash !== hashBlocks(blocks);
@@ -720,28 +720,6 @@ export async function readGlossary(dir: string): Promise<Glossary | null> {
   return readJson<Glossary>(path.join(dir, "glossary.json"));
 }
 
-/**
- * Is the glossary on disk one we would write again today?
- *
- * The step's `isDone`, and the same three conditions the thread checks: the
- * blocks it was written from, the prompt that wrote it, and the model that ran.
- * Change any one and it regenerates by itself, with no `force` and nobody
- * having to remember.
- *
- * Anything unreadable answers **false**, which is the safe way to be wrong: the
- * cost is one model call, where the other way round is a stale glossary served
- * for ever.
- */
-export async function glossaryIsCurrent(dir: string): Promise<boolean> {
-  const glossary = await readGlossary(dir);
-  if (!glossary) return false;
-  if (glossary.version !== PROMPT_VERSION) return false;
-  if (glossary.generator !== CAPABLE_MODEL) return false;
-  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
-  if (!blocksFile?.blocks) return false;
-  return !isStale(glossary, blocksFile.blocks);
-}
-
 /* ------------------------------------------------------------- the prompt --
    Four lines of this are theirs almost verbatim, and they are the four best
    lines in the file — see docs/project/original-version/glossary.md § The
diff --git a/src/pipeline.ts b/src/pipeline.ts
index c90529c..9534f60 100644
--- a/src/pipeline.ts
+++ b/src/pipeline.ts
@@ -1254,9 +1254,10 @@ export const STEPS: Record<StepName, PipelineStep> = {
     /* The first step through the new seam, and the shape the other two follow.
        Three values — the blocks it would be written from, the prompt that would
        write it, the model that would run — where `glossaryIsCurrent` was a
-       function doing the same three comparisons by hand. That function is still
-       exported from src/glossary.ts because its CLI uses it; nothing in the
-       pipeline calls it any more.
+       function doing the same three comparisons by hand. That function was
+       deleted on 2026-08-28. This comment used to say it survived "because its
+       CLI uses it"; glossary's `main()` never called it, and only its own tests
+       did, so the sentence was keeping dead code alive. docs/plans/simplification-wave-2.md § 0.5.
 
        `stamp` rather than `isDone` because the *comparison* belongs in one
        place (`sameStamp`) and only the four values belong to the stage. It is
diff --git a/src/store/artifacts.ts b/src/store/artifacts.ts
index ce0ccca..73b2586 100644
--- a/src/store/artifacts.ts
+++ b/src/store/artifacts.ts
@@ -18,8 +18,10 @@
  * 2. **Current** — was it made from this article, by this prompt, by this
  *    model? A comparison of the recorded `StepStamp` against the stamp the step
  *    would produce now. That comparison is `sameStamp`, once, rather than
- *    `threadIsCurrent` / `glossaryIsCurrent` / `summariesAreCurrent` — the same
- *    three lines written three times.
+ *    `threadIsCurrent` / `summariesAreCurrent` and the `glossaryIsCurrent` that
+ *    used to sit beside them — the same three lines written three times.
+ *    `glossaryIsCurrent` was deleted on 2026-08-28 once `stamp` had replaced it;
+ *    the other two are still their steps' `isDone` and are next.
  *
  * This file is types and one pure function. The file-backed adapter is
  * src/store/artifacts-fs.ts; the Postgres one is not written yet.
diff --git a/src/store/revisions.ts b/src/store/revisions.ts
index 2d3d8a8..843de2e 100644
--- a/src/store/revisions.ts
+++ b/src/store/revisions.ts
@@ -21,16 +21,45 @@
  * and every other method takes `null` and returns immediately. The handle being
  * nullable is what keeps the branch out of the caller.
  *
- * ## What is wired, and what is still only half-connected
+ * ## Nothing is wired. Checked 2026-08-28.
  *
- * Wired: a job opens a draft, records each step it runs against it, and
- * publishes or fails it. Real rows, real carry-forward, real publication guard.
+ * **This section used to open "Wired: a job opens a draft…". That was false, and
+ * the paragraphs under it described an ingest that cannot happen.** No
+ * production file imports this module. `revisionLifecycle` below is referenced
+ * by exactly one thing in the repo, `tests/store-guarded.test.ts`, and
+ * [`src/jobs.ts`](../jobs.ts) contains the word "draft" once, in a comment about
+ * something else. So no job opens a draft, and none of the outcomes described
+ * below — the empty draft, the refused publish, the one `warn` line — has ever
+ * occurred.
  *
- * **Not wired: the artefacts.** The pipeline stages still write
+ * The sting is that this file was *written* to fix precisely that
+ * (`457fa74`, "Give the revision adapter a seam, because nothing was calling
+ * it"), and its own commit message names the failure exactly: *"That is the
+ * worst state in this migration: the work looks finished from the outside and
+ * the running code has never once gone through it."* The commit is one file, 259
+ * insertions, and no change to `jobs.ts` — so the seam repeated, one level up,
+ * the thing it was written to end. **Do not write "wired" here again until
+ * `git grep` shows a caller outside `tests/`.**
+ *
+ * `sweepAbandonedDrafts` is in the same position, and it is the one with teeth:
+ * `ABANDONED_DRAFT_MS` below explains that each abandoned draft carries a full
+ * copy of the article's `revision_blocks`. Nothing calls `sweep()`. That is not
+ * a leak today, because nothing creates drafts — **it becomes one the moment
+ * `begin()` becomes reachable, so the first production `begin()`, the artefact
+ * wiring, a scheduled `sweep()` and a test proving drafts are removed have to
+ * land together.** Recorded as an acceptance condition on step 11, not as a
+ * separate fix. See docs/plans/simplification-wave-2.md § 0.6.
+ *
+ * ## What the artefact half would still need
+ *
+ * **Also not wired: the artefacts.** The pipeline stages still write
  * `data/<slug>/blocks.json` and the rest with their own `writeFile` calls
- * (step 11 half B stage 5 is what moves them), so nothing fills the draft the
- * job just opened. The consequence is deliberate and visible rather than
- * papered over:
+ * (step 11 half B stage 5 is what moves them), and
+ * [`src/jobs.ts`](../jobs.ts) binds them to `fsArtifacts` unconditionally — with
+ * no `SPIDERYARN_STORE` switch, though the *job* store two lines away does
+ * switch on it. So even once a draft is opened, nothing would fill it. The
+ * consequences below are what the guards are designed to produce when that day
+ * comes, and are written in the future tense on purpose:
  *
  * - A **fresh article** gets an empty draft, and `publishRevision` refuses it —
  *   *"it has no blocks; it has no tree"*. Correct: the pipeline did not produce
@@ -42,12 +71,16 @@
  *   is refused — *"the tree was built from different blocks"*. Also correct,
  *   and it is the guard catching exactly the divergence it was written for.
  *
- * So under `SPIDERYARN_STORE=postgres` an ingest today ends with one `warn`
- * line and a failed draft, and the reader stays on the revision they had. That
- * is the honest state of a half-finished seam, and it is preferable to the
- * alternative, which is a republished copy of the old revision under a green
- * tick. When stage 5 lands and the artefacts arrive as values, publication
- * starts succeeding here with no change to this file.
+ * So once `begin()` is reached, an ingest under `SPIDERYARN_STORE=postgres`
+ * will end with one `warn` line and a failed draft, and the reader will stay on
+ * the revision they had. That is the honest state of a half-finished seam, and
+ * it is preferable to the alternative, which is a republished copy of the old
+ * revision under a green tick. When stage 5 lands and the artefacts arrive as
+ * values, publication starts succeeding here with no change to this file.
+ *
+ * **Today none of that runs**, because nothing calls `begin()` — see the top of
+ * this comment. An ingest under `SPIDERYARN_STORE=postgres` writes files and
+ * says nothing about revisions at all.
  *
  * ## What this file may log
  *
diff --git a/tests/glossary.test.ts b/tests/glossary.test.ts
index a076831..271b775 100644
--- a/tests/glossary.test.ts
+++ b/tests/glossary.test.ts
@@ -15,16 +15,12 @@
  * nondeterministic part is one function call, and everything around it has a
  * right answer. See docs/project/testing.md.
  */
-import { afterAll, describe, expect, it } from "vitest";
-import { mkdtemp, rm, writeFile } from "node:fs/promises";
-import { tmpdir } from "node:os";
-import path from "node:path";
+import { describe, expect, it } from "vitest";
 import {
   BATCH_SIZE,
   buildGlossary,
   dedupe,
   findOccurrences,
-  glossaryIsCurrent,
   PROMPT_VERSION,
   inDocumentOrder,
   isStale,
@@ -381,18 +377,7 @@ describe("suggestedCount", () => {
   });
 });
 
-describe("isStale / glossaryIsCurrent", () => {
-  const dirs: string[] = [];
-  afterAll(async () => {
-    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
-  });
-
-  async function scratch(): Promise<string> {
-    const dir = await mkdtemp(path.join(tmpdir(), "spya-gloss-"));
-    dirs.push(dir);
-    return dir;
-  }
-
+describe("isStale", () => {
   function glossary(over: Partial<Glossary> = {}): Glossary {
     return {
       version: PROMPT_VERSION,
@@ -411,39 +396,15 @@ describe("isStale / glossaryIsCurrent", () => {
     expect(isStale(glossary(), BLOCKS)).toBe(false);
     expect(isStale(glossary(), [...BLOCKS, block("spya-dddddd", "A new paragraph.")])).toBe(true);
   });
-
-  it("is current when the blocks, the prompt and the model all still hold", async () => {
-    const dir = await scratch();
-    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }));
-    await writeFile(path.join(dir, "glossary.json"), JSON.stringify(glossary()));
-    expect(await glossaryIsCurrent(dir)).toBe(true);
-  });
-
-  it("is not current when the prompt version or the model changed", async () => {
-    const dir = await scratch();
-    await writeFile(path.join(dir, "blocks.json"), JSON.stringify({ blocks: BLOCKS }));
-    await writeFile(
-      path.join(dir, "glossary.json"),
-      JSON.stringify(glossary({ version: "glossary/0" })),
-    );
-    expect(await glossaryIsCurrent(dir)).toBe(false);
-    await writeFile(
-      path.join(dir, "glossary.json"),
-      JSON.stringify(glossary({ generator: "some-other-model" })),
-    );
-    expect(await glossaryIsCurrent(dir)).toBe(false);
-  });
-
-  it("answers false for anything it cannot read", async () => {
-    // Not-current is the safe way to be wrong: the cost is one model call,
-    // where the other way round is a stale glossary served for ever.
-    const dir = await scratch();
-    expect(await glossaryIsCurrent(dir)).toBe(false);
-    await writeFile(path.join(dir, "glossary.json"), "{ not json");
-    expect(await glossaryIsCurrent(dir)).toBe(false);
-  });
 });
 
+/* The three `glossaryIsCurrent` cases that stood here were deleted with the
+   function on 2026-08-28. It had no caller outside this file: the pipeline
+   moved to `stamp` and src/pipeline.ts kept a comment saying the CLI still used
+   it, which was not true. The conditions those tests covered — blocks, prompt
+   version, model — are asserted against the live path in
+   tests/pipeline-artifact-store.test.ts. See docs/plans/simplification-wave-2.md § 0.5. */
+
 describe("sortEntries", () => {
   const list = [
     entry({ name: "first", difficulty: 0.2, centrality: 0.9 }),
diff --git a/tests/pipeline-artifact-store.test.ts b/tests/pipeline-artifact-store.test.ts
index e237734..3be6dc1 100644
--- a/tests/pipeline-artifact-store.test.ts
+++ b/tests/pipeline-artifact-store.test.ts
@@ -588,10 +588,10 @@ describe("sameStamp", () => {
 /**
  * `glossary` is the first step whose freshness goes through `stamp` +
  * `sameStamp` rather than through a `…IsCurrent` function of its own, so these
- * are `glossaryIsCurrent`'s own conditions asserted against the new path.
+ * were `glossaryIsCurrent`'s own conditions, and since that function was deleted
+ * on 2026-08-28 this is now the only place they are asserted at all.
  *
- * Worth writing out rather than trusting: the mechanism is new, the old
- * function is still there and still passing its own tests, and a `stamp` that
+ * Worth writing out rather than trusting: the mechanism is new, and a `stamp` that
  * answered "current" too readily would show up as a stale glossary served for
  * ever — while one that answered too rarely would show up only on the bill.
  */
```


===== 3806b25 The plan, and the review that found three things wrong with it before it was built
Wave 2 of the simplification audit: four agents over four areas against knip,
jscpd and biome's complexity rule, every claim re-checked by hand, then GPT Sol
on the plan before any of it was built.

Its through-line is narrower than wave 1's and less comfortable: a fix applied
to one copy does not reach the others, and nothing notices. Four of the six Tier
0 items are that same event. In two of them the copy was taken days before the
fix landed in the original, so the drift was created by the act of fixing.

Sol returned "revise before building" and was right on every point checked:

- 0.1 was under-scoped. `npm run pdf` leaks spend the same way `npm run labels`
  does, and fixing only labels would have shipped a gate memorialising a second
  false "all paid CLIs" claim.
- 0.4's headline was false. search-stream.test.ts does exercise the clean-abort
  guard. Three are unexercised, not four. The check was too weak: greping for
  the setup symbols, finding none, and inferring all four guards. Absence of the
  setup you expected is not absence of coverage.
- 2.4 proposed re-introducing a reverted change. pipeline.ts is headed "No
  `stamp`, and it is not an oversight — one was written and withdrawn on
  2026-08-27. Read this before adding one", because a re-run toc silently drops
  range-attached arc and summary entries. That half is now in "do not do".

And wave 1's own Rule 1 — grep the genre, not this list — landed a fourth time,
on this document, which had just finished pointing out that it kept landing on
wave 1. The readiness probe is 34 files, not the 29 recorded here: one spelling
of the genre was greped and five files that probe differently were missed.
Recorded rather than quietly corrected, because the shape of the mistake is the
useful part.

Two numbers settled by experiment rather than by reading. The eight
fence-strippers agree on eight awkward inputs, so unifying them is a pure dedup.
The library box and chat disagree on all seven cases tried, in a file whose own
comment says they must not — and it feeds ranking, not just a count.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01M5tbuz57fs7M3nJAf6hzkR

