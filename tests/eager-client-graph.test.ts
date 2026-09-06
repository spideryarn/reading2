/**
 * **What a reader downloads before they have asked for anything.**
 *
 * The browser entry is `src/web/boot.tsx`; it reaches `main.tsx` through a
 * dynamic `import()` and everything else follows from there by static import.
 * This test walks that **static** closure and asserts that the administrator's
 * table and the `/design` gallery are not in it — which is the durable half of
 * docs/plans/260905i-lazy-load-admin-and-design-routes.md. Moving them bought
 * 1.35% of what a reader downloads; **this** is what stops the next admin
 * feature — a chart library, a CSV writer — arriving in every reader's startup
 * with no symptom anyone is looking at (docs/reusable/silent-success.md).
 *
 * ## Why an AST and not a scan
 *
 * The argument was had in this repo already and is written down in the header
 * of [`tests/helpers/ts-ast.ts`](helpers/ts-ast.ts): two earlier checks began
 * as character scans and were wrong in **both** directions, and the dangerous
 * direction is the scan that quietly stops. This file's first implementation
 * was 657 lines of hand-rolled character scanning (`scripts/client-eager-graph.ts`,
 * deleted with this test), and it had both faults on the day it was written:
 *
 *  - `src/web/boot.tsx` has the literal text `import(` **inside its doc
 *    comment**, explaining why the real one is dynamic. A textual tool counts
 *    that essay as an edge.
 *  - `src/web/components/ui/*.tsx` are prettier-formatted with **no
 *    semicolons**, so any scan that ends a statement at `;` runs on into the
 *    next one.
 *
 * A parser sees neither problem. `@babel/parser` is already a direct dev
 * dependency, so this adds none.
 *
 * ## Why it also asserts things that *are* there
 *
 * A walker that has stopped walking reports an empty closure, and an empty
 * closure passes every "is X absent" question ever asked of it. So the positive
 * controls below are not decoration: `lib/supabase.ts` in particular is
 * calibration against ground truth, because the build prints
 * `[INEFFECTIVE_DYNAMIC_IMPORT] src/web/lib/supabase.ts …` precisely *because*
 * several eager importers hold it in.
 *
 * ## Fail closed
 *
 * A local specifier this cannot resolve fails the test loudly rather than being
 * dropped. A resolver that silently drops an edge is how a guard stops being a
 * guard, and it would drop the edge that matters on exactly the day somebody
 * introduces it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type AstNode, parseSource, walkAst } from "./helpers/ts-ast.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "src", "web");

/** The two entries, unioned. `boot.tsx` is what the HTML actually loads. */
const ROOTS = [path.join(WEB, "boot.tsx"), path.join(WEB, "main.tsx")];

/**
 * The other two entries — the far side of the boundary.
 *
 * Walked as a closure of their own so that the *seam* can be asserted rather
 * than six file names. See `SHARED_WITH_READER` below for why that is not the
 * same question.
 */
const ROUTE_ROOTS = [path.join(WEB, "AdminPage.tsx"), path.join(WEB, "DesignPage.tsx")];

/**
 * Suffixes we record an edge to and do not walk into.
 *
 * A stylesheet or an image is a real edge in the bundler's graph and worth
 * recording, but there is no TypeScript behind it to follow.
 */
const ASSET_EXT = new Set([".css", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif", ".json"]);

/** One module's outgoing edges, split by the thing this test is about. */
interface Edges {
  /** Followed. Absolute paths inside the repo. */
  staticLocal: string[];
  /** Recorded, never followed — the whole point of the exercise. */
  dynamic: string[];
  /** Recorded, never followed: node_modules and assets. */
  external: string[];
}

/**
 * Is this import or export edge type-only?
 *
 * `import type { X } from "y"` erases, and so does `export type { X } from "y"`.
 * An edge carrying *inline* `type` specifiers — `import { a, type B }` — does
 * **not** erase, and is kept. Over-approximating is the safe direction here: it
 * can name an edge the bundler tree-shakes away, but it cannot miss one the
 * bundler keeps.
 */
function typeOnly(n: AstNode): boolean {
  return n.importKind === "type" || n.exportKind === "type";
}

function sourceValue(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  const v = (n as { value?: unknown }).value;
  return typeof v === "string" ? v : null;
}

/**
 * Resolve a specifier written in `from` to a file on disk.
 *
 * Returns `null` for a bare specifier (node_modules — recorded, not followed).
 * Throws for a local specifier that resolves to nothing, per "fail closed".
 */
function resolveLocal(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    // `@` -> src/web, matching vite.config.ts § resolve.alias and
    // src/web/tsconfig.json § paths.
    base = path.join(WEB, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(from), spec);
  } else {
    return null;
  }

  const ext = path.extname(base);
  if (ASSET_EXT.has(ext)) return existsSync(base) ? base : null;

  const candidates: string[] = [];
  if (ext === ".js" || ext === ".jsx") {
    // TypeScript-with-ESM: the source is written `./foo.js` and lives at
    // `./foo.ts` or `./foo.tsx`.
    const stem = base.slice(0, -ext.length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, base);
  } else {
    candidates.push(base, `${base}.ts`, `${base}.tsx`);
  }
  candidates.push(path.join(base, "index.ts"), path.join(base, "index.tsx"));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    `Unresolved local import ${JSON.stringify(spec)} in ${path.relative(ROOT, from)}. ` +
      "The resolver in tests/eager-client-graph.test.ts needs teaching, and until it is " +
      "this guard is walking a graph with a hole in it.",
  );
}

/**
 * The specifier this node names, and whether it is an edge the bundler keeps.
 *
 * `null` for every node that is not an edge at all, which is nearly all of
 * them. `import("…")`: babel gives this as a `CallExpression` whose callee is
 * `Import`; some versions produce an `ImportExpression` node instead, so both
 * are read. Only a literal specifier is reported — a computed one has no name
 * to record, and it is still not followed either way.
 */
function edgeAt(n: AstNode): { spec: string; kind: "static" | "dynamic" } | null {
  if (n.type === "ImportDeclaration" && !typeOnly(n)) {
    const spec = sourceValue(n.source);
    return spec ? { spec, kind: "static" } : null;
  }
  if ((n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") && !typeOnly(n)) {
    const spec = sourceValue(n.source);
    return spec ? { spec, kind: "static" } : null;
  }
  if (n.type === "ImportExpression") {
    const spec = sourceValue(n.source);
    return spec ? { spec, kind: "dynamic" } : null;
  }
  if (n.type === "CallExpression" && (n.callee as AstNode | undefined)?.type === "Import") {
    const spec = sourceValue((n.arguments as unknown[] | undefined)?.[0]);
    return spec ? { spec, kind: "dynamic" } : null;
  }
  return null;
}

/**
 * `import.meta.glob(…)` — an edge this walker cannot see, so it refuses instead.
 *
 * Vite expands it at build time into a set of imports that are **eager** when
 * `{ eager: true }` is passed, and the pattern is a glob rather than a
 * specifier, so nothing above would resolve it. GPT Sol demonstrated the hole
 * by putting `import.meta.glob("./AdminPage.tsx", { eager: true })` into
 * `App.tsx` and watching all five assertions below stay green (code review
 * 2026-09-05, F4). `tests/client-imports.test.ts` already documents that this
 * construct is used in this repo, so it is not a hypothetical.
 *
 * Teaching the walker to expand globs is the right fix the day somebody needs
 * one in the client's eager graph. Until then it fails loudly, because the
 * alternative is a guard that reports "clean" about a graph it did not read.
 */
function globCallAt(n: AstNode): boolean {
  if (n.type !== "CallExpression") return false;
  const callee = n.callee as AstNode | undefined;
  if (callee?.type !== "MemberExpression") return false;
  const object = callee.object as AstNode | undefined;
  const property = callee.property as AstNode | undefined;
  return object?.type === "MetaProperty" && String(property?.name ?? "").startsWith("glob");
}

/**
 * Every file whose parse was not clean, and it must stay empty.
 *
 * `parseSource` sets `errorRecovery`, deliberately — see its header — so a file
 * this cannot parse yields a **partial** AST rather than a throw. That is the
 * right default for its other callers and exactly the wrong thing to leave
 * unchecked here: a recovered parse drops the statements it could not read, and
 * the edge it drops passes every "is X absent" question below. Collected here
 * and asserted, rather than trusted.
 */
const parseFailures: string[] = [];

function edgesOf(file: string): Edges {
  const ast = parseSource(readFileSync(file, "utf8"));
  /* `?? []` because the field is optional on babel's result type — and a
     `null` there means "not collected", which is not the same as "none", so it
     is read as no-report rather than allowed to throw. A hard syntax error does
     not arrive here at all: `parseSource` throws for those even with
     `errorRecovery`, out of the module-scope walk below, which is loud. */
  const errors = ast.errors ?? [];
  if (errors.length > 0) parseFailures.push(`${path.relative(ROOT, file)}: ${errors[0]}`);
  const out: Edges = { staticLocal: [], dynamic: [], external: [] };

  const record = (spec: string, kind: "static" | "dynamic") => {
    let resolved: string | null;
    if (kind === "dynamic") {
      /* A dynamic specifier is recorded, never walked, and a resolution failure
         here is not the fail-closed case: it cannot hide an eager edge. */
      try {
        resolved = resolveLocal(spec, file);
      } catch {
        resolved = null;
      }
      out.dynamic.push(resolved ?? spec);
      return;
    }
    resolved = resolveLocal(spec, file);
    if (resolved === null) {
      out.external.push(spec);
      return;
    }
    if (ASSET_EXT.has(path.extname(resolved))) {
      out.external.push(resolved);
      return;
    }
    out.staticLocal.push(resolved);
  };

  walkAst(ast.program, (n) => {
    if (globCallAt(n)) {
      throw new Error(
        `${path.relative(ROOT, file)} calls import.meta.glob, and this walker cannot ` +
          "expand it. With `{ eager: true }` that is a static edge to every file the " +
          "pattern matches, so continuing would report a graph nobody read. Teach " +
          "tests/eager-client-graph.test.ts to expand globs, or keep this call out of " +
          "the client's eager graph.",
      );
    }
    const edge = edgeAt(n);
    if (edge) record(edge.spec, edge.kind);
  });

  return out;
}

/** The walk. `parent` is the first module found to import each file. */
interface Closure {
  files: Set<string>;
  /** file -> the module that first reached it, for the shortest chain. */
  parent: Map<string, string>;
  /** file -> every eager importer of it. The half a shortest chain hides. */
  importers: Map<string, Set<string>>;
  dynamic: Set<string>;
}

function eagerClosure(roots: string[]): Closure {
  const files = new Set<string>();
  const parent = new Map<string, string>();
  const importers = new Map<string, Set<string>>();
  const dynamic = new Set<string>();
  /* Breadth-first, so `parent` records the *shortest* chain rather than
     whichever one a depth-first walk happened to take. */
  const queue: string[] = [];
  for (const r of roots) {
    files.add(r);
    queue.push(r);
  }
  while (queue.length) {
    const file = queue.shift() as string;
    const { staticLocal, dynamic: dyn } = edgesOf(file);
    for (const d of dyn) dynamic.add(d);
    for (const next of staticLocal) {
      let set = importers.get(next);
      if (!set) {
        set = new Set();
        importers.set(next, set);
      }
      set.add(file);
      if (files.has(next)) continue;
      files.add(next);
      parent.set(next, file);
      queue.push(next);
    }
  }
  return { files, parent, importers, dynamic };
}

const closure = eagerClosure(ROOTS);
const rel = (f: string) => path.relative(ROOT, f);
const inClosure = (p: string) => closure.files.has(path.join(ROOT, p));

/* The whole closure, dumped so a before/after can be diffed by eye:
   `SPIDERYARN_EAGER_GRAPH_OUTPUT=logs/eager-client-graph.txt npx vitest run …`

   **Opt-in, and it used to be unconditional.** GPT Sol reviews this repo from a
   sandbox with the tree mounted read-only, and the write turned the whole file
   into `EROFS … 0 test` — a guard that cannot run for the one reader most
   likely to attack it. A test earns the right to write to the checkout only if
   somebody asked it to. Code review 2026-09-05, F10. */
const graphOut = process.env.SPIDERYARN_EAGER_GRAPH_OUTPUT;
if (graphOut) {
  const target = path.resolve(ROOT, graphOut);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${[...closure.files].map(rel).sort().join("\n")}\n`);
}

/**
 * The seam: everything the two lazy routes reach that the reader reaches too.
 *
 * Walked a second time from the route roots, and intersected. The two closures
 * overlap in 46 files and are otherwise disjoint — measured 2026-09-06, and the
 * complement is exactly the six modules in `ROUTE_PRIVATE`, which is a pleasant
 * accident rather than something asserted.
 *
 * `parseFailures` is appended to by both walks, so a file in the overlap that
 * failed to parse is reported twice. That is untidy and harmless; the assertion
 * on it is `toEqual([])`. The walk does widen that assertion's reach, though —
 * the six route-private modules are now parsed and checked as well.
 */
const routeClosure = eagerClosure(ROUTE_ROOTS);
const routeShared = [...routeClosure.files].filter((f) => closure.files.has(f)).map(rel).sort();

/**
 * Why the module is still in, said in the two ways that are both needed.
 *
 * The shortest chain alone **actively misleads**, and the previous tool learned
 * it the hard way: `admin-columns.tsx`'s shortest chain used to run through
 * `AdminPage.tsx`, so lazy-loading the page made the chain stop naming it while
 * `params.ts` went on holding it in. That is this plan's own trap, so the list
 * of *every* eager importer is printed beside the chain.
 */
function why(p: string): string {
  const abs = path.join(ROOT, p);
  const chain: string[] = [abs];
  let cur = abs;
  const seen = new Set([abs]);
  for (;;) {
    const up = closure.parent.get(cur);
    if (!up || seen.has(up)) break;
    chain.push(up);
    seen.add(up);
    cur = up;
  }
  const all = [...(closure.importers.get(abs) ?? [])].map(rel).sort();
  return [
    `${p} is still eagerly reachable.`,
    `  shortest chain: ${chain.reverse().map(rel).join(" -> ")}`,
    `  every eager importer (${all.length}): ${all.join(", ") || "(none — it is a root)"}`,
  ].join("\n");
}

/**
 * The six modules the two lazy routes own between them, and nothing else uses.
 * Named individually rather than by directory because there is no directory —
 * they sit beside the reader's files.
 */
const ROUTE_PRIVATE = [
  "src/web/AdminPage.tsx",
  "src/web/DesignPage.tsx",
  "src/web/admin-columns.tsx",
  "src/web/AdminFeedbackList.tsx",
  "src/web/useAdminFeedback.ts",
  "src/web/useAdminUsers.ts",
];

/**
 * Every module the two lazy routes and the reader **both** reach.
 *
 * `ROUTE_PRIVATE` above is a readable positive statement and it is all this
 * file used to have. GPT Sol showed that it is weaker than the claim made for
 * it (code review 2026-09-05, F4, case 2): a new `review-admin-chart.ts`
 * imported statically from `App.tsx` **and** `AdminPage.tsx` left all five
 * assertions green, because a fixed list of six names cannot see a seventh.
 * Reproduced here on 2026-09-06 before this constant was written, which is the
 * only way to know a guard was ever red.
 *
 * So the boundary is asserted as a **seam** instead: intersect the eager
 * closure with the route closure, and require the result to be this list,
 * exactly, in both directions.
 *
 * **A line added here is a decision that every reader downloads that module
 * before they have asked for anything.** It is not a formality — the whole
 * 1.35 per cent this plan bought was 39 kB of exactly this kind of module.
 * Make the decision, or move the code so the route owns it.
 *
 * **A line removed is the other half**, and it is the half a one-directional
 * check would miss: an entry that no longer applies is a claim about the graph
 * that has quietly stopped being true, and a list nobody prunes is a list
 * nobody reads.
 *
 * ## What this will and will not go red for
 *
 * It goes red for the case Sol demonstrated, which is the point. It also goes
 * red for two cases that cost the reader nothing:
 *
 *  - an admin page starting to use something the reader already downloads —
 *    zero extra bytes, one line here;
 *  - a module already on this list gaining an import of its own — say
 *    `router.ts` importing a new helper. The helper lands in both closures at
 *    once, so it arrives here without anybody having touched an admin file.
 *
 * Both of those are a one-line edit and both are worth a glance, so this is
 * deliberately not narrowed to Sol's case alone: narrowing it would mean
 * deciding in advance which new module in a reader's startup is interesting,
 * which is the judgement the list exists to take away from whoever is in a
 * hurry. All three were watched go red on 2026-09-06: Sol's case with his own
 * `review-admin-chart.ts`, the first of these by adding `HomeLogo.js` to
 * `AdminPage`, the second by giving `pill.ts` an import of its own.
 *
 * Bare packages are not here. Only local files are walked, so `react` and
 * `lucide-react` are recorded as external and never enter either closure — this
 * list is about *this repo's* modules, not about node_modules.
 *
 * Sorted, one per line, so a diff reads as a decision. 46 of them on
 * 2026-09-06, against a 264-file eager closure and a 51-file route closure.
 */
const SHARED_WITH_READER = [
  "src/admin.ts",
  "src/block-policy.ts",
  "src/feedback-payload.ts",
  "src/html.ts",
  "src/ids.ts",
  "src/ingest.ts",
  "src/job-failure.ts",
  "src/job-state.ts",
  "src/messages.ts",
  "src/modes.ts",
  "src/monitoring-scrub.ts",
  "src/quote-match.ts",
  "src/read-address.ts",
  "src/referee-criteria.ts",
  "src/title-text.ts",
  "src/types.ts",
  "src/uploads.ts",
  "src/urls.ts",
  "src/web/IconButton.tsx",
  "src/web/JobProgress.tsx",
  "src/web/Link.tsx",
  "src/web/ShelfEntry.tsx",
  "src/web/TitleEditor.tsx",
  "src/web/Tooltip.tsx",
  "src/web/build-stamp.ts",
  "src/web/components/ui/button.tsx",
  "src/web/components/ui/toggle.tsx",
  "src/web/diagram.ts",
  "src/web/jump-history.ts",
  "src/web/lib/DataTable.tsx",
  "src/web/lib/api.ts",
  "src/web/lib/offline-store.ts",
  "src/web/lib/supabase.ts",
  "src/web/lib/table-sort.ts",
  "src/web/lib/utils.ts",
  "src/web/library-columns.tsx",
  "src/web/log-buffer.ts",
  "src/web/monitoring.ts",
  "src/web/offline.ts",
  "src/web/page-title.ts",
  "src/web/params.ts",
  "src/web/pill.ts",
  "src/web/referee-views.ts",
  "src/web/relative-time.ts",
  "src/web/router.ts",
  "src/web/useNow.ts",
];

describe("the eager client graph", () => {
  it("parsed every file it walked", () => {
    /* Three ways the walk can be a hole rather than a graph, and none of them
       shows up in any assertion below.

       An unresolved local specifier and an outright syntax error both throw out
       of `eagerClosure` above, before any test runs, so the suite fails to load
       — checked on 2026-09-05 by appending `const broken = (((;` to a walked
       file: `errorRecovery` does not recover from that, and vitest reports
       `Failed Suites 1`. Ugly, but red.

       A **recovered** parse is the quiet one, and the reason this assertion
       exists: babel reports it in `errors` and hands back an AST with the
       unreadable statements simply missing. A dropped import is
       indistinguishable from an import that was never there. */
    expect(parseFailures, "a recovered parse silently drops the edges it could not read").toEqual(
      [],
    );
    expect(closure.files.size).toBeGreaterThan(0);
  });

  it("still contains the modules a reader genuinely needs", () => {
    /* Positive controls. A walker that has quietly stopped walking goes red
       here instead of green below. `lib/supabase.ts` is the calibration against
       ground truth: the build's INEFFECTIVE_DYNAMIC_IMPORT line names it
       because eager importers hold it in, so if this walk cannot see it, this
       walk cannot see anything. */
    for (const p of [
      "src/web/monitoring.ts",
      "src/web/main.tsx",
      "src/web/App.tsx",
      "src/web/Library.tsx",
      "src/web/lib/supabase.ts",
    ]) {
      expect(inClosure(p), `${p} should be eagerly reachable`).toBe(true);
    }
    /* And a plausible size. It was 268 files from `main.tsx` alone before the
       lazy routes landed; the floor is deliberately far below that, because an
       exact number would churn on every new component. */
    expect(closure.files.size).toBeGreaterThan(200);
  });

  it("reaches main.tsx only dynamically, from boot.tsx", () => {
    /* The one fact `boot.tsx`'s thirty lines of comment exist to protect: if
       `main.js` were ever imported statically there, Sentry would be started
       after the module that throws. */
    expect([...closure.dynamic].map(rel)).toContain("src/web/main.tsx");
  });

  it("does not reach the administrator's pages or /design", () => {
    const held = ROUTE_PRIVATE.filter((p) => inClosure(p));
    expect(held.map(why).join("\n\n"), held.join(", ")).toBe("");
  });

  it("shares with the reader only what somebody agreed it should share", () => {
    /* The seam, in both directions — see `SHARED_WITH_READER`. The six names
       above are the readable statement; this is the one that can see a
       seventh. */
    const allowed = new Set(SHARED_WITH_READER);
    const unexpected = routeShared.filter((p) => !allowed.has(p));
    const stale = SHARED_WITH_READER.filter((p) => !routeShared.includes(p));

    const report: string[] = [];
    if (unexpected.length > 0) {
      report.push(
        `${unexpected.length} module(s) are reachable from BOTH the reader's startup and the ` +
          "lazy /admin and /design routes, and are not on SHARED_WITH_READER:",
        /* `why()` reads the *eager* closure, which is the side that costs a
           reader bytes, and every module here is in it by construction. It
           prints every eager importer as well as the shortest chain, because
           the shortest chain is what hid `admin-columns.tsx` behind
           `params.ts` while this plan was being written. */
        ...unexpected.map(why),
        "Adding a line to SHARED_WITH_READER in tests/eager-client-graph.test.ts is a decision " +
          "that every reader downloads that module before they have asked for anything. Make " +
          "it deliberately, or move the code behind the route so the route owns it.",
      );
    }
    if (stale.length > 0) {
      report.push(
        `SHARED_WITH_READER names ${stale.length} module(s) that the reader's startup and the ` +
          "lazy routes no longer both reach, so those lines no longer describe the graph. " +
          `Delete them: ${stale.join(", ")}`,
      );
    }

    expect(
      report.join("\n\n"),
      [
        unexpected.length > 0 ? `+${unexpected.join(", ")}` : "",
        stale.length > 0 ? `-${stale.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    ).toBe("");
  });

  it("still reaches src/admin.ts, which is not route-private", () => {
    /* `isAdmin` decides what a reader may see — App.tsx and Library.tsx both
       call it — so it is a reader-route decision and stays eager. Asserted so
       that nobody makes the test above pass by moving it. */
    expect(ROUTE_PRIVATE).not.toContain("src/admin.ts");
    expect(inClosure("src/admin.ts"), "src/admin.ts must stay eagerly reachable").toBe(true);
  });
});
