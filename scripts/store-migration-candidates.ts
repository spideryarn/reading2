/**
 * Which test files can reach the filesystem store, **transitively**.
 *
 * Written for docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md,
 * stage A, which needs two independent witnesses to its candidate manifest.
 * This is the static one. The manifest is policed by a direct-import grep; a
 * grep cannot see a test that reaches `src/store/fs.ts` three modules deep, so
 * this walks the real import graph instead and prints the **shortest path** from
 * each test to each condemned module.
 *
 * The path is the point. "162 files reach `fs.ts`" is true and useless; a path
 * that reads `tests/x.test.ts → src/routes.ts → src/store/index.ts → src/store/fs.ts`
 * says *this test imports the app*, and a one-hop path says *this test's subject
 * is the adapter*. So each test is bucketed by **why** it reaches. The deciding
 * cut is the graph with every **flag-reading module** removed — a module that
 * imports `src/store/live.ts` is doing store *selection*, and that reach dies
 * with the flag; a reach that survives the cut is a real dependency:
 *
 *   - `subject`              the test imports a condemned module itself.
 *   - `fixture`              it survives the cut through a `tests/helpers/…`
 *                            module — the test's own fixture machinery.
 *   - `app-survives-flag`    it survives the cut through `src/…` only.
 *   - `flag-selection-only`  every path runs through a flag reader; incidental,
 *                            and it disappears at the hinge.
 *   - `type-only`            reachable only across erased `import type` edges,
 *                            so nothing executes. Listed, never counted as a reach.
 *
 * `src/store/index.ts` alone is **not** the wiring hub — that hypothesis was
 * tested against this data and fails. Only 23 of 192 reaching tests go
 * exclusively through it; `src/store/ai-calls.ts`, `src/upload-records.ts` and
 * `src/jobs.ts` each select an adapter of their own, deliberately, to avoid an
 * import cycle. `pathsWithoutWiringHub` is kept in the JSON so that claim can
 * be re-checked rather than believed.
 *
 * **This witness does not subsume a text grep and must not replace one.** A test
 * that reads a condemned file's *source* has no import edge and is invisible
 * here. The one live example was `tests/slug.test.ts`, which `readFileSync`d
 * `jobs-fs.ts` to check the `data/_jobs/` path it built; both the case and the
 * module went in stage G, 2026-09-05. **The claim is not retired with it** —
 * there is nothing stopping the next one, and it would be just as invisible.
 *
 * Not a grep, and deliberately a different route to the answer than the
 * manifest's own predicate — docs/reusable/silent-success.md: a guard that
 * shares its discovery mechanism with the thing it guards agrees with the bug.
 *
 *   npx tsx scripts/store-migration-candidates.ts [--out FILE]
 *
 * Unresolved specifiers are counted and reported rather than swallowed: each one
 * is a hole in the graph and therefore a hole in the answer.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type AstNode, parseSource, walkAst } from "../tests/helpers/ts-ast.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The modules this walk reports reach for. NOT `blobs-fs.ts`, which is
 *  selected by credentials rather than by `SPIDERYARN_STORE`.
 *
 *  **`artifacts-fs.ts` and `data-root.ts` went on 2026-09-05** with stage G's
 *  last adapter group, and `copy-artefacts.ts` survives stage D's
 *  store-agnostic `ArtifactSource`. One name left, and it names a module
 *  nothing is deleting — see `CONDEMNED` in vitest.witness.config.ts. */
const TARGETS = [
  "src/store/copy-artefacts.ts",
];

/** Reported apart: the leaf everything reads the flag through, so lumping it in
 *  with the adapters would drown the signal. */
const FLAG_LEAF = "src/store/live.ts";

/** Removing this node is how "incidental app wiring" is told from "this test
 *  wants the adapter" — it is the module that wires up every store. */
const WIRING_HUB = "src/store/index.ts";

/** Directories holding first-party code that a test can reach. */
const SOURCE_DIRS = ["src", "tests", "scripts", "api", "evals"];

type Edge = { readonly to: string; readonly typeOnly: boolean; readonly dynamic: boolean };
type Unresolved = { readonly from: string; readonly specifier: string };

// ---------------------------------------------------------------- file walking

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

// ------------------------------------------------------------------ resolution

/** A relative specifier that resolves to something that is not code. */
const ASSET = "\0asset";

/** The repo is node-ESM TypeScript: `import "./foo.js"` is `./foo.ts` on disk.
 *  Returns a repo-relative path, `ASSET`, or null for "not first-party code". */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(REPO, "src/web", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(join(REPO, fromFile)), spec);
  else return null; // a package, or a node: builtin

  // Assets and data are not code; they end no path and hide nothing. Returned
  // distinctly so they do not inflate the unresolved count, which must mean
  // "a hole in the graph" and nothing else.
  if (/\.(json|png|jpg|jpeg|svg|css|txt|md|html)$/.test(base)) return ASSET;

  const candidates: string[] = [];
  const swap = (from: string, to: readonly string[]) =>
    base.endsWith(from) && candidates.push(...to.map((e) => `${base.slice(0, -from.length)}${e}`));
  swap(".js", [".ts", ".tsx", ".js"]);
  swap(".jsx", [".tsx", ".jsx"]);
  swap(".mjs", [".mts", ".mjs"]);
  swap(".cjs", [".cts", ".cjs"]);
  if (candidates.length === 0) {
    candidates.push(base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"));
  }
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return relative(REPO, c);
  }
  return null;
}

// ----------------------------------------------------------------- graph build

/** What one node says about a module reference, or null if it says nothing.
 *  `spec` is null for a specifier this cannot follow — an `import(variable)`. */
function referenceIn(node: AstNode): { spec: string | null; typeOnly: boolean; dynamic: boolean } | null {
  const type = node.type as string;
  if (type === "ImportDeclaration" || type === "ExportNamedDeclaration" || type === "ExportAllDeclaration") {
    const source = node.source as { value?: unknown } | null | undefined;
    if (typeof source?.value !== "string") return null;
    // `import type … from`, or every named specifier written `type X` — a
    // type-only edge is erased at build time and can execute nothing.
    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    const declared = node.importKind === "type" || node.exportKind === "type";
    const allSpecifiers =
      specifiers.length > 0 && specifiers.every((s) => s.importKind === "type" || s.exportKind === "type");
    return { spec: source.value, typeOnly: declared || allSpecifiers, dynamic: false };
  }
  // `typeof import("…")` in a type position — erased, so a type-only edge.
  if (type === "TSImportType") {
    const arg = node.argument as { value?: unknown } | null | undefined;
    return typeof arg?.value === "string" ? { spec: arg.value, typeOnly: true, dynamic: true } : null;
  }
  /* `await import("…")`. **This repo's @babel/parser emits a CallExpression
     with an `Import` callee, not an `ImportExpression`** — the first version of
     this script handled only the latter and quietly lost every dynamic edge,
     which is 490-odd of them, and the answer just came back smaller and
     plausible. docs/reusable/silent-success.md. Both shapes are handled, and
     `dynamicEdges` below refuses to let the loss happen silently again. */
  const source =
    type === "ImportExpression"
      ? (node.source as AstNode | null | undefined)
      : type === "CallExpression" && (node.callee as AstNode | undefined)?.type === "Import"
        ? ((node.arguments as AstNode[] | undefined)?.[0] as AstNode | undefined)
        : undefined;
  if (source === undefined || source === null) return null;
  return { spec: typeof source.value === "string" ? source.value : null, typeOnly: false, dynamic: true };
}

function edgesOf(file: string, unresolved: Unresolved[], unfollowable: Unresolved[]): Edge[] {
  const ast = parseSource(readFileSync(join(REPO, file), "utf8"));
  const found: Edge[] = [];
  walkAst(ast, (node: AstNode) => {
    const ref = referenceIn(node);
    if (ref === null) return;
    if (ref.spec === null) {
      // A specifier held in a variable cannot be followed; say so rather than lose it.
      unfollowable.push({ from: file, specifier: "import(<non-literal>)" });
      return;
    }
    if (ref.spec.startsWith("node:")) return;
    const to = resolveSpecifier(file, ref.spec);
    if (to === ASSET) return;
    if (to === null) {
      if (ref.spec.startsWith(".") || ref.spec.startsWith("@/")) {
        unresolved.push({ from: file, specifier: ref.spec });
      }
      return;
    }
    found.push({ to, typeOnly: ref.typeOnly, dynamic: ref.dynamic });
  });
  return found;
}

// -------------------------------------------------------------------- searching

/** Breadth-first, so the first path found to a node is a shortest one. */
function shortestPaths(
  start: string,
  graph: ReadonlyMap<string, readonly Edge[]>,
  wanted: ReadonlySet<string>,
  banned: ReadonlySet<string>,
  includeTypeOnly: boolean,
): Map<string, string[]> {
  const parent = new Map<string, string | null>([[start, null]]);
  const hits = new Map<string, string[]>();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const here = queue[i] as string;
    for (const edge of graph.get(here) ?? []) {
      if (edge.typeOnly && !includeTypeOnly) continue;
      if (parent.has(edge.to) || banned.has(edge.to)) continue;
      parent.set(edge.to, here);
      if (wanted.has(edge.to)) {
        const path: string[] = [];
        for (let n: string | null = edge.to; n !== null; n = parent.get(n) ?? null) path.unshift(n);
        hits.set(edge.to, path);
      }
      queue.push(edge.to);
    }
  }
  return hits;
}

// ------------------------------------------------------------------------ main

const outFlag = process.argv.indexOf("--out");
const outPath =
  outFlag >= 0 && process.argv[outFlag + 1] !== undefined
    ? (process.argv[outFlag + 1] as string)
    : "/tmp/claude-1000/-home-greg-code-spideryarn2/225d6eb2-0057-42cc-8a0a-ae321540a3b5/scratchpad/fs-witness-static.json";

const allFiles = SOURCE_DIRS.filter((d) => existsSync(join(REPO, d)))
  .flatMap((d) => listFiles(join(REPO, d)))
  .map((f) => relative(REPO, f))
  .concat(["vite.config.ts", "vitest.config.ts", "drizzle.config.ts"].filter((f) => existsSync(join(REPO, f))))
  .sort();

const unresolved: Unresolved[] = [];
const graph = new Map<string, readonly Edge[]>();
const unfollowable: Unresolved[] = [];
for (const file of allFiles) graph.set(file, edgesOf(file, unresolved, unfollowable));

/* A self-check, because losing a whole *kind* of edge is invisible from the
   output: the answer just gets smaller and stays plausible. This repo is full
   of `await import("…")` after `vi.resetModules()`, so zero dynamic edges means
   the parser has stopped recognising the shape, not that the repo changed. */
const dynamicEdges = [...graph.values()].flat().filter((e) => e.dynamic).length;
if (dynamicEdges < 100) {
  throw new Error(`only ${dynamicEdges} dynamic import edges found — the AST shape for import() has changed and the graph is incomplete`);
}

const testFiles = allFiles.filter((f) => /^tests\/.*\.test\.tsx?$/.test(f));
const targets = new Set(TARGETS.filter((t) => existsSync(join(REPO, t))));
const missingTargets = TARGETS.filter((t) => !targets.has(t));
const leaf = new Set([FLAG_LEAF]);
const none: ReadonlySet<string> = new Set();
const hub: ReadonlySet<string> = new Set([WIRING_HUB]);

/** A module that imports `src/store/live.ts` reads the flag, so the condemned
 *  import it makes is store *selection* — the thing this migration deletes. */
const flagReaders = new Set(
  allFiles.filter((f) => (graph.get(f) ?? []).some((e) => e.to === FLAG_LEAF)),
);

const BUCKETS = ["subject", "fixture", "app-survives-flag", "flag-selection-only", "type-only"] as const;
type Bucket = (typeof BUCKETS)[number];

type Report = {
  file: string;
  bucket: Bucket;
  /** Shortest path to each target, and the module that pulls it in. */
  paths: Record<string, { path: string[]; puller: string }>;
  /** Shortest path with every flag-reading module cut out of the graph. A
   *  target still reachable here is reached for a reason that outlives the
   *  flag; a target that disappears was pure store selection. */
  pathsWithoutFlagReaders: Record<string, string[]>;
  /** Shortest path with `src/store/index.ts` alone cut, so the
   *  "everything reaches it through the wiring hub" claim stays checkable. */
  pathsWithoutWiringHub: Record<string, string[]>;
  livePath: string[] | null;
};

const reports: Report[] = [];
for (const file of testFiles) {
  const hits = shortestPaths(file, graph, targets, none, false);
  const live = shortestPaths(file, graph, leaf, none, false).get(FLAG_LEAF) ?? null;
  if (hits.size === 0) {
    const typeOnly = shortestPaths(file, graph, targets, none, true);
    if (typeOnly.size === 0) continue;
    reports.push({
      file,
      bucket: "type-only",
      paths: Object.fromEntries([...typeOnly].map(([t, p]) => [t, { path: p, puller: p[p.length - 2] as string }])),
      pathsWithoutFlagReaders: {},
      pathsWithoutWiringHub: {},
      livePath: live,
    });
    continue;
  }
  const unflagged = shortestPaths(file, graph, targets, flagReaders, false);
  const bucket: Bucket =
    [...hits.values()].some((p) => p.length === 2)
      ? "subject"
      : unflagged.size === 0
        ? "flag-selection-only"
        : [...unflagged.values()].some((p) => p.slice(1, -1).some((n) => n.startsWith("tests/")))
          ? "fixture"
          : "app-survives-flag";
  reports.push({
    file,
    bucket,
    paths: Object.fromEntries([...hits].map(([t, p]) => [t, { path: p, puller: p[p.length - 2] as string }])),
    pathsWithoutFlagReaders: Object.fromEntries(unflagged),
    pathsWithoutWiringHub: Object.fromEntries(shortestPaths(file, graph, targets, hub, false)),
    livePath: live,
  });
}

const bucketOf = (b: Bucket) => reports.filter((r) => r.bucket === b).map((r) => r.file);
const reaching = reports.filter((r) => r.bucket !== "type-only");
const perTarget = Object.fromEntries(
  [...targets].map((t) => [
    t,
    {
      value: reaching.filter((r) => r.paths[t] !== undefined).length,
      typeOnly: reports.filter((r) => r.bucket === "type-only" && r.paths[t] !== undefined).length,
    },
  ]),
);
/** Which module pulls each target in, and how often — the evidence behind the
 *  buckets, so nobody has to take the bucketing on faith. */
const pullers: Record<string, number> = {};
for (const r of reaching) {
  for (const [t, { path }] of Object.entries(r.paths)) {
    const key = `${path[path.length - 2]} → ${t}`;
    pullers[key] = (pullers[key] ?? 0) + 1;
  }
}
const onlyViaWiringHub = reaching.filter((r) => Object.keys(r.pathsWithoutWiringHub).length === 0);

const payload = {
  generatedAt: new Date().toISOString(),
  method: "transitive import-graph walk (static + dynamic import(), @/ alias, .js→.ts specifiers)",
  targets: [...targets],
  missingTargets,
  flagLeaf: FLAG_LEAF,
  wiringHub: WIRING_HUB,
  flagReaders: [...flagReaders].sort(),
  counts: {
    filesParsed: allFiles.length,
    testFiles: testFiles.length,
    reaching: reaching.length,
    ...Object.fromEntries(BUCKETS.map((b) => [b, bucketOf(b).length])),
    reachingFlagLeaf: reports.filter((r) => r.livePath !== null).length,
    onlyViaWiringHub: onlyViaWiringHub.length,
    unresolvedSpecifiers: unresolved.length,
    unfollowableDynamicImports: unfollowable.length,
    dynamicEdges,
  },
  perTarget,
  pullers: Object.fromEntries(Object.entries(pullers).sort((a, b) => b[1] - a[1])),
  onlyViaWiringHub: onlyViaWiringHub.map((r) => r.file),
  buckets: Object.fromEntries(BUCKETS.map((b) => [b, bucketOf(b)])),
  reports,
  unresolved,
  unfollowable,
};

writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);

console.log(`parsed ${allFiles.length} first-party files, ${testFiles.length} test files`);
if (missingTargets.length > 0) console.log(`WARNING target(s) not on disk: ${missingTargets.join(", ")}`);
console.log("\ntest files reaching a condemned filesystem module:");
for (const b of BUCKETS) console.log(`  ${b.padEnd(20)} ${String(bucketOf(b).length).padStart(4)}`);
console.log(`  ${"total (executable)".padEnd(20)} ${String(reaching.length).padStart(4)} of ${testFiles.length}`);
console.log(`\ntest files reaching ${FLAG_LEAF}: ${payload.counts.reachingFlagLeaf}`);
console.log(`reaching ONLY through ${WIRING_HUB}: ${onlyViaWiringHub.length}`);
console.log("\nper target (executable / type-only):");
for (const [t, n] of Object.entries(perTarget)) console.log(`  ${String(n.value).padStart(4)} / ${n.typeOnly}  ${t}`);
console.log("\nwho pulls the target in (shortest paths, all tests):");
for (const [k, n] of Object.entries(payload.pullers).slice(0, 14)) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nunresolved first-party specifiers: ${unresolved.length}`);
for (const u of unresolved) console.log(`  ${u.from} → ${u.specifier}`);
console.log(`\ndynamic import() edges followed: ${dynamicEdges}`);
console.log(`dynamic import() with a non-literal specifier (cannot be followed): ${unfollowable.length}`);
for (const u of unfollowable) console.log(`  ${u.from} → ${u.specifier}`);
console.log(`\nwritten: ${outPath}`);
