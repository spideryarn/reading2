/**
 * **What the fleet dashboard depends on from `src/`, pinned so it cannot grow
 * quietly.**
 *
 * docs/project/overseer-direction.md § Principles: this tool *"runs on the
 * box, spans repos, and must not depend on the product database or on anything
 * under `src/`. If it ever earns its own repo, that should be a move, not a
 * rewrite."*
 *
 * On 2026-09-08 that was narrowed rather than dropped, because Greg asked for
 * the product's dictation to be **reused** rather than copied and there are
 * ~3,000 lines of browser audio machinery behind it that took a day of debugging
 * to make believable. The rule now reads:
 *
 * > Only LEAF, BROWSER-ONLY, PRODUCT-AGNOSTIC modules may be imported from
 * > `src/`. Nothing that reaches the database, an auth session, a slug, an
 * > article, or a route under `src/routes.ts`. If a module is nearly leaf but
 * > for one product coupling, extract the coupling behind a parameter rather
 * > than importing the coupling.
 *
 * **A rule in a document is a rule until somebody adds one import.** So this
 * file walks the fleet's whole transitive import graph and asserts that the set
 * of `src/` files it reaches is exactly {@link ALLOWED}. Adding one is a diff
 * somebody reviews; the failure message says what to think about.
 *
 * The number in that list is the cost of the move. If it ever grows past what a
 * person would move by hand, the answer is to say so in the plan doc rather than
 * to keep extending the array.
 *
 * ## Why a walker rather than a grep
 *
 * A grep over `tools/` finds the imports somebody *wrote*, and the expensive
 * ones are the imports somebody inherited: `useDictation.ts` looked leaf and
 * reached `@supabase/supabase-js` through two hops. So this follows every edge.
 *
 * And the walker itself is checked, because **a closure walker that sees nothing
 * looks exactly like one that found a leaf**. The first version of it matched
 * `import … from` on a single line, so every multi-line braced import was
 * invisible and `mic-devices.ts` vanished out of a closure that imports it. The
 * self-check below asks it a question whose answer is known.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type ParseResult, parse as babelParse } from "@babel/parser";
import type { File, Node } from "@babel/types";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * **All of `tools/`, not just `tools/fleet/`.**
 *
 * The principle is about the box utilities as a family — overseer-direction.md
 * says *"it runs on the box, spans repos, and must not depend on the product
 * database or on anything under `src/`"* — and `tools/overseer/` arrived on
 * 2026-09-08 under exactly that sentence. A rule scoped to one directory is one
 * that a sibling directory silently escapes, which is the shape of the gap that
 * left 15,000 lines of `tools/` linted by nothing until somebody looked.
 */
const TOOLS = path.join(ROOT, "tools");

/**
 * **Every file under `src/` the fleet dashboard reaches, and why it is allowed.**
 *
 * All of them import nothing but `react` and each other — that is what "leaf"
 * means here, and it is the property that makes them movable.
 */
const ALLOWED: Record<string, string> = {
  /* The microphone itself: four phases, one owned track, the recorder, the
     upload. The prize, and the reason this rule was narrowed at all. */
  "src/web/useDictation.ts": "the microphone",
  /* Wiring it to a text box: the caret, the one span, the closed box. */
  "src/web/useDictationField.ts": "the text box",
  /* The seam that made the two above importable: where the words come from, as
     a parameter rather than an import of the product's authenticated fetch. */
  "src/web/transcriber.ts": "the transcriber contract",
  /* One microphone per page, however many boxes have a button. */
  "src/web/mic-lock.ts": "the page's one microphone",
  "src/web/mic-recording.ts": "the tape, its container fallback and its caps",
  "src/web/mic-devices.ts": "which microphone, and why the constraint is exact",
  "src/web/dictation-errors.ts": "every recogniser error code to a sentence",
  "src/web/useAudioLevel.ts": "the meter, reading the track being recorded",
  "src/web/audio-level.ts": "the RMS itself",
  /* The two ends of one arithmetic problem. The browser checks the cap before a
     megabyte goes over the wire and the server checks it again; two copies of
     the number is how they come to disagree, which is what this file exists to
     stop. It imports nothing at all, by construction. */
  "src/dictation-limits.ts": "the size caps and the container list, shared by both ends",
  /* The ums, deleted — and its whole design is that it can only ever DELETE. */
  "src/dictation-fillers.ts": "the hesitation sounds",
  /* `packTerms` and `MAX_TERM`: the cap, the de-duplicate, and the angle-bracket
     strip that a session title needs for the same reason an article title does. */
  "src/vocabulary.ts": "packing a term list, and fencing it",
};

/**
 * **Every module specifier in a file, read from the syntax tree.**
 *
 * This was a regex twice, and it was bypassable twice. The first version missed
 * multi-line braced imports, which lost `mic-devices.ts` out of a closure that
 * imports it. The second banned the shapes it could not follow — and GPT Sol
 * showed the ban was itself a regex with holes: `import ("x")` with a space,
 * `import("../../src/" + "x")`, and `import /* c *\/ ("x")` were all neither
 * followed nor refused.
 *
 * **Two rounds of that is where "one more pattern" stops being the cheaper
 * option.** The rule this file enforces is architectural, and a rule that can be
 * got round by adding a space was conventional rather than real. So it parses.
 *
 * `@babel/parser` rather than `typescript`: TypeScript 7 exposes no AST from its
 * package root — `import ts from "typescript"` resolves to a version stub, and
 * the tree is behind `typescript/unstable/*`, which is unstable by its own name.
 * Babel's parser is already a direct dependency of this repo and its AST is
 * stable. `oxc-parser`, `acorn` and `es-module-lexer` are all present too and
 * all transitive, which makes them a dependency nobody declared.
 */
function parse(src: string, file: string): ParseResult<File> {
  return babelParse(src, {
    sourceType: "module",
    sourceFilename: file,
    /* `decorators-legacy` because a file in this graph has one and Babel refuses
       to guess which proposal it means. `errorRecovery` so a syntax Babel does
       not know yields a tree with errors attached rather than throwing — and
       {@link parseOrFail} then makes the failure loud, because a walker that
       silently skips a file it cannot read reports the same clean result as one
       with nothing to report. */
    plugins: ["typescript", "jsx", "decorators-legacy"],
    errorRecovery: true,
  });
}

/** Every literal specifier: static imports and exports, bare imports, `import()`, `require()`. */
/** Files this walker could not read at all. Empty, and a test says so. */
const unreadable: string[] = [];

/**
 * Extensions this walker can read. Anything else reached by an import is a real
 * edge and not a parseable one — `main.tsx` imports `./tailwind.css`, and Babel
 * read its `@layer` as a decorator on nothing.
 *
 * A stylesheet cannot import a TypeScript module, so skipping it costs the rule
 * nothing. It is skipped **by extension rather than by swallowing the error**,
 * so a `.ts` file that genuinely will not parse still lands in `unreadable`.
 */
const CODE = /\.(?:[cm]?[jt]sx?)$/;

function parseOrFail(src: string, file: string): ParseResult<File> | null {
  if (!CODE.test(file)) return null;
  try {
    return parse(src, file);
  } catch (err) {
    unreadable.push(`${file}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
    return null;
  }
}

function specifiers(src: string, file = "unknown.ts"): string[] {
  const out: string[] = [];
  const tree = parseOrFail(src, file);
  if (tree === null) return out;
  walk(tree.program as unknown as Node, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const source = (node as { source?: { type: string; value?: string } }).source;
      if (source?.type === "StringLiteral" && typeof source.value === "string") out.push(source.value);
    }
    if (node.type === "CallExpression" || node.type === "ImportExpression") {
      const spec = callSpecifier(node);
      if (spec !== null) out.push(spec);
    }
  });
  return out;
}

/**
 * **Specifiers a static walk cannot follow, refused rather than missed.**
 *
 * A dynamic import built from a variable or a concatenation has nothing for a
 * static walk to follow, and its absence from {@link specifiers} looks exactly
 * like a file that has no such import — which is the failure this whole file
 * exists to stop. So they are found here and refused by their own test.
 *
 * They have no legitimate use in this tree: it is ESM throughout and every
 * import is static. If one ever arrives, this is the line to revisit
 * deliberately, not the pattern to widen.
 */
function unfollowableImports(src: string, file: string): string[] {
  const bad: string[] = [];
  const tree = parseOrFail(src, file);
  if (tree === null) return bad;
  walk(tree.program as unknown as Node, (node) => {
    if (node.type !== "CallExpression" && node.type !== "ImportExpression") return;
    const kind = dynamicKind(node);
    if (kind === null) return;
    if (callSpecifier(node) !== null) return;
    const line = (node as { loc?: { start: { line: number } } }).loc?.start.line ?? 0;
    bad.push(`${file}:${line}: ${kind} whose specifier is not a string literal`);
  });
  return bad;
}

/** `"a dynamic import"`, `"require"`, or null if this call is neither. */
function dynamicKind(node: Node): string | null {
  if (node.type === "ImportExpression") return "a dynamic import";
  const callee = (node as { callee?: { type: string; name?: string } }).callee;
  if (callee?.type === "Import") return "a dynamic import";
  if (callee?.type === "Identifier" && callee.name === "require") return "require";
  return null;
}

/** The literal specifier of an `import()`/`require()`, or null if it is not one. */
function callSpecifier(node: Node): string | null {
  if (dynamicKind(node) === null) return null;
  const args = (node as { arguments?: { type: string; value?: unknown }[]; source?: { type: string; value?: unknown } })
    .arguments;
  /* Babel models `import(x)` as an `ImportExpression` with `source`, and
     `require(x)` as a `CallExpression` with `arguments`. Both shapes handled,
     because which one appears depends on the plugin set. */
  const first = args?.[0] ?? (node as { source?: { type: string; value?: unknown } }).source;
  if (first?.type === "StringLiteral" && typeof first.value === "string") return first.value;
  return null;
}

/** Depth-first over every node with a `type`, which is enough for what is asked here. */
function walk(node: unknown, visit: (n: Node) => void): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string") visit(node as Node);
  for (const key of Object.keys(record)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") continue;
    walk(record[key], visit);
  }
}

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  let p = path.resolve(path.dirname(from), spec);
  if (p.endsWith(".js")) p = p.slice(0, -3);
  for (const ext of [".ts", ".tsx", ".js", "/index.ts"]) if (existsSync(p + ext)) return p + ext;
  return existsSync(p) ? p : null;
}

/** Every `.ts`/`.tsx` under a directory, recursively, skipping build output. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Why one top-level statement makes the shared browser wire unsafe. */
function wireViolations(src: string, file = "tools/fleet/wire.ts"): string[] {
  const tree = parseOrFail(src, file);
  if (tree === null) return [`${file}: could not parse`];
  const violations: string[] = [];
  for (const statement of tree.program.body) {
    if (statement.type === "TSTypeAliasDeclaration" || statement.type === "TSInterfaceDeclaration") continue;
    if (statement.type === "ExportNamedDeclaration") {
      if (statement.source !== null) {
        violations.push(`${file}: a type export may not import from another module`);
        continue;
      }
      if (statement.declaration?.type === "TSTypeAliasDeclaration" || statement.declaration?.type === "TSInterfaceDeclaration") {
        continue;
      }
      if (
        statement.declaration === null &&
        statement.exportKind === "type" &&
        statement.specifiers.every((specifier) => specifier.type === "ExportSpecifier" && specifier.exportKind === "type")
      ) {
        continue;
      }
    }
    violations.push(`${file}: ${statement.type} is a runtime declaration, import, or value export`);
  }
  return violations;
}

describe("the shared fleet wire is a types-only, import-free leaf", () => {
  it("allows only types and type-only exports", () => {
    expect(wireViolations(readFileSync(path.join(TOOLS, "fleet/wire.ts"), "utf8"))).toEqual([]);
  });

  it("rejects a runtime constant, a plain import, and an enum", () => {
    expect(wireViolations("export type Good = string; const runtime = 1;", "const.ts")).toHaveLength(1);
    expect(wireViolations('import { thing } from "./thing.js"; export type Good = string;', "import.ts")).toHaveLength(1);
    expect(wireViolations("export enum Bad { Value }", "enum.ts")).toHaveLength(1);
  });
});

/** Every file the box utilities reach, transitively, as repo-relative paths. */
function fleetClosure(): Set<string> {
  const seen = new Set<string>();
  const queue = filesUnder(TOOLS);
  while (queue.length > 0) {
    const f = queue.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of specifiers(readFileSync(f, "utf8"), path.relative(ROOT, f))) {
      const r = resolve(f, spec);
      if (r !== null) queue.push(r);
    }
  }
  return new Set([...seen].map((f) => path.relative(ROOT, f).split(path.sep).join("/")));
}

describe("what the fleet dashboard imports from src/", () => {
  it("has a walker that can see a multi-line braced import", () => {
    /* THE SELF-CHECK, and it is the first test on purpose. Every assertion below
       is of the form "the walker found nothing it should not have", which is
       exactly what a broken walker reports. `useDictation.ts` imports
       `mic-devices.js` in a braced list spread over five lines — the shape the
       first version of this missed. */
    const found = specifiers(readFileSync(path.join(ROOT, "src/web/useDictation.ts"), "utf8"));
    expect(found).toContain("./mic-devices.js");
    expect(found).toContain("react");
  });

  it("sees through the whitespace and comments a regex could not", () => {
    /* **GPT Sol's four bypasses, verbatim**, from round 2 of its review. Each of
       these is a real import of a real product module, and each was invisible to
       the regex that replaced the regex before it — neither followed, so not in
       the closure, nor refused, so not reported. That is the exact shape of a
       check that passes because it is broken.

       The first two are FOLLOWED (the specifier is a literal, whatever the
       spacing or comments). The second two cannot be followed by anything
       static, so they are REFUSED below. */
    expect(specifiers(`import ("../../src/routes.js")`)).toEqual(["../../src/routes.js"]);
    expect(specifiers(`import /* c */ ("../../src/routes.js")`)).toEqual(["../../src/routes.js"]);
    expect(specifiers(`require /* c */ ("../../src/routes.js")`)).toEqual(["../../src/routes.js"]);
    /* And the ordinary shapes still work, so the parser has not been swapped in
       for one that sees nothing — which is what a green suite would look like. */
    expect(specifiers(`import {\n  a,\n  b,\n} from "./x.js";`)).toEqual(["./x.js"]);
    expect(specifiers(`export type { T } from "./y.js";`)).toEqual(["./y.js"]);
    expect(specifiers(`import "./side-effect.js";`)).toEqual(["./side-effect.js"]);
  });

  it("refuses a specifier no static walk could resolve", () => {
    /* Concatenation and a variable: there is nothing to follow, and silence
       about them is indistinguishable from a file that has no such import. */
    expect(unfollowableImports(`import("../../src/" + "routes.js")`, "x.ts")).toHaveLength(1);
    expect(unfollowableImports(`const p = "./a.js"; void import(p);`, "x.ts")).toHaveLength(1);
    expect(unfollowableImports(`require(name)`, "x.ts")).toHaveLength(1);
    /* A literal one is fine — it is followed, not refused. */
    expect(unfollowableImports(`import("./a.js")`, "x.ts")).toEqual([]);
  });

  it("refuses the import shapes it cannot follow, rather than missing them", () => {
    /* A walker that silently skips a shape reports the same clean result as one
       that found nothing to report. So the shapes it cannot read are banned. */
    const offenders: string[] = [];
    for (const f of filesUnder(TOOLS)) {
      offenders.push(...unfollowableImports(readFileSync(f, "utf8"), path.relative(ROOT, f)));
    }
    expect(offenders).toEqual([]);
  });

  it("reports a file it could not read, rather than treating it as importing nothing", () => {
    /* **The failure mode this whole file is built against.** A walker that
       cannot parse a file and says nothing produces the same clean result as one
       with nothing to report — and this walker has now been replaced twice for
       exactly that reason. So a parse failure is recorded, and the closure walk
       below asserts the record is empty.

       Exercised rather than assumed: something unparseable goes in, and the
       walker must both return nothing and SAY it returned nothing because it
       could not read the file. */
    unreadable.length = 0;
    expect(specifiers("this ( is not ) === typescript {{{", "broken.ts")).toEqual([]);
    expect(unreadable).toHaveLength(1);
    expect(unreadable[0]).toContain("broken.ts");
  });

  it("reads every file under tools/, with nothing skipped", () => {
    unreadable.length = 0;
    fleetClosure();
    expect(unreadable).toEqual([]);
  });

  it("reaches exactly the leaf modules the rule allows, and no others", () => {
    const reached = [...fleetClosure()].filter((f) => f.startsWith("src/")).sort();
    const allowed = Object.keys(ALLOWED).sort();
    /* Exact, not a subset, in BOTH directions. A file that stops being reached
       is as much a change to "the cost of the move" as one that starts being
       reached, and both should be a line in a diff somebody reads. */
    expect(reached).toEqual(allowed);
  });

  it("reaches nothing that touches the database, an auth session or an article", () => {
    /* The rule stated as its consequences rather than as a list, so that a NEW
       module added to ALLOWED without thinking still fails here. These are the
       three doors the principle is actually about. */
    const forbidden = [
      "src/db.ts",
      "src/store/index.ts",
      "src/routes.ts",
      "src/web/lib/api.ts",
      "src/web/lib/supabase.ts",
      "src/transcribe.ts",
      "src/ai-call.ts",
      "src/article.ts",
      "src/env.ts",
    ];
    const reached = fleetClosure();
    for (const f of forbidden) expect([...reached]).not.toContain(f);
  });

  it("reaches no external package the product's server needs", () => {
    /* The bundle is the other witness — `npm run build:fleet` then grepping it
       for `supabase` — and this is the one that runs in CI. `react` and
       `lucide-react` are the browser's; nothing here may reach `pg`,
       `drizzle-orm`, `stripe`, `jsdom` or `@supabase/supabase-js`. */
    const heavy = ["pg", "drizzle-orm", "stripe", "jsdom", "@supabase/supabase-js", "@sentry/core", "pino"];
    const externals = new Set<string>();
    for (const f of fleetClosure()) {
      for (const spec of specifiers(readFileSync(path.join(ROOT, f), "utf8"), f)) {
        if (!spec.startsWith(".") && !spec.startsWith("node:")) externals.add(spec.split("/")[0] as string);
      }
    }
    for (const pkg of heavy) expect([...externals]).not.toContain(pkg.split("/")[0]);
  });

  it("says what each allowed import is for, so the list stays reviewable", () => {
    for (const [file, why] of Object.entries(ALLOWED)) {
      expect(why.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });
});

/**
 * **Who may hold the thing that types into a pane.**
 *
 * `send-coordinator.ts` exists so that the quarantine check and the transport
 * call are one line apart and nobody can get between them: it takes
 * `sendMessage` and `answerQuestion` as its own dependencies, asks the book
 * whether the session is held, and only then fires. Every producer takes a
 * `SendCoordinator` instead of a transport, and
 * `tests/fleet-compile-guards.test.ts` fails if one ever grows a transport field
 * back.
 *
 * **THAT LEAVES ONE DOOR, AND THIS SHUTS IT.** A new producer could take no
 * transport in its dependencies and simply import `sendMessage` from
 * `./steer.js` outright. It would compile, it would pass every existing test,
 * and it would type into held sessions — the review's U2 all over again, with
 * the evidence one import line further away. So the rule is architectural, and
 * this asserts it over the whole tree rather than over the files somebody
 * remembered.
 *
 * A TYPE IMPORT IS FINE and is not counted: `typeof realSendMessage` costs
 * nothing at runtime and cannot be called. It is the VALUE import that matters,
 * and the walker reads `importKind` on both the declaration and the specifier,
 * so an inline `type` modifier is allowed in either spelling.
 */
const TRANSPORT = ["sendMessage", "answerQuestion"];

/** Files allowed to import the transport as a value, and why. */
const MAY_HOLD_THE_TRANSPORT: Record<string, string> = {
  "tools/fleet/steer.ts": "it is the transport",
  "tools/fleet/send-coordinator.ts": "the one place the hold is checked before it fires",
};

/** Value imports of the transport in one file, by name. */
function transportValueImports(src: string, file: string): string[] {
  const tree = parseOrFail(src, file);
  if (tree === null) return [];
  const found: string[] = [];
  walk(tree.program as unknown as Node, (node) => {
    if (node.type !== "ImportDeclaration") return;
    const decl = node as {
      importKind?: string;
      specifiers?: { type: string; importKind?: string; imported?: { type: string; name?: string } }[];
    };
    // A whole-declaration type import is free.
    if (decl.importKind === "type") return;
    for (const spec of decl.specifiers ?? []) {
      if (spec.type !== "ImportSpecifier") continue;
      // …and so is a per-specifier one.
      if (spec.importKind === "type") continue;
      const name = spec.imported?.type === "Identifier" ? spec.imported.name : undefined;
      if (name !== undefined && TRANSPORT.includes(name)) found.push(name);
    }
  });
  return found;
}

describe("only the send coordinator may hold the transport", () => {
  it("finds a value import and ignores a type-only one — the walker, checked first", () => {
    /* THE SELF-CHECK, for this file's own reason: the assertion below is of the
       form "nothing was found", which is what a broken walker reports. */
    const from = ' from "./steer.js";';
    expect(transportValueImports(`import { sendMessage }${from}`, "x.ts")).toEqual(["sendMessage"]);
    expect(transportValueImports(`import { answerQuestion as go }${from}`, "x.ts")).toEqual(["answerQuestion"]);
    expect(transportValueImports(`import type { sendMessage }${from}`, "x.ts")).toEqual([]);
    expect(transportValueImports(`import { type sendMessage }${from}`, "x.ts")).toEqual([]);
  });

  it("is the only file under tools/ that imports one as a value", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(TOOLS)) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (rel in MAY_HOLD_THE_TRANSPORT) continue;
      const found = transportValueImports(readFileSync(file, "utf8"), rel);
      if (found.length > 0) offenders.push(`${rel} imports ${found.join(", ")}`);
    }
    expect(
      offenders,
      "a producer that imports the transport can type into a session the page is showing as HELD. " +
        "Take a `SendCoordinator` in your dependencies instead — tools/fleet/send-coordinator.ts — " +
        "which checks the quarantine book on the line above the send.",
    ).toEqual([]);
  });
});
