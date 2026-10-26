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
 * introduces it. `import.meta.glob` is refused below for the same reason, and
 * so is a dynamic `import()` whose specifier is not a literal — that one is
 * GPT Sol's F21, 2026-09-06, and the refusal lives in
 * [`refuseUntraceableImports`](helpers/ts-ast.ts).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  type AstNode,
  parseSource,
  refuseUntraceableImports,
  walkAst,
} from "./helpers/ts-ast.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "src", "web");

/** The two entries, unioned. `boot.tsx` is what the HTML actually loads. */
const ROOTS = [path.join(WEB, "boot.tsx"), path.join(WEB, "main.tsx")];

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
  /* A computed `import()` is an edge with no name, and this walker records
     dynamic edges by name — so it would drop it. F21, and the argument is with
     the helper. */
  refuseUntraceableImports(
    ast.program,
    path.relative(ROOT, file),
    "tests/eager-client-graph.test.ts",
  );
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
  /** Package or local asset -> every walked local file that imports it statically. */
  externalImporters: Map<string, Set<string>>;
  dynamic: Set<string>;
}

function eagerClosure(roots: string[]): Closure {
  const files = new Set<string>();
  const parent = new Map<string, string>();
  const importers = new Map<string, Set<string>>();
  const externalImporters = new Map<string, Set<string>>();
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
    const { staticLocal, dynamic: dyn, external } = edgesOf(file);
    for (const d of dyn) dynamic.add(d);
    for (const spec of external) {
      /* Assets and packages matter to this boundary too: a stylesheet, image
         or chart library can cost the reader bytes without any local admin
         TypeScript module crossing the seam. */
      let set = externalImporters.get(spec);
      if (!set) {
        set = new Set();
        externalImporters.set(spec, set);
      }
      set.add(file);
    }
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
  return { files, parent, importers, externalImporters, dynamic };
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
 * **Every lazy chunk the reader's graph can open that is *not* an
 * administrator-only surface or `/design`, and why.** The far side of the boundary is derived from
 * this, not listed — see `ROUTE_ROOTS` below.
 *
 * Keys are repo-relative for a local file and the bare specifier for a
 * package, which is how `lazyKey` spells them.
 */
const NOT_ROUTE_ROOTS = new Map<string, string>([
  ["src/web/main.tsx", "the reader's own entry, loaded by boot.tsx so Sentry starts first"],
  [
    "src/web/lib/supabase.ts",
    "an ineffective dynamic import: eager importers already hold it in (see the header)",
  ],
  [
    "src/web/ChangelogPage.tsx",
    "lazy for its 210 KB of NDJSON, not because it is administrator-only — a reader's page",
  ],
  ["src/web/help/HelpPage.tsx", "lazy because it is prose read when stuck — a reader's page"],
  ["temml", "maths rendering, fetched when an article has TeX (src/web/maths.ts)"],
  ["temml/dist/Temml-Local.css", "temml's stylesheet, beside it"],
]);

const lazyKey = (d: string) => (path.isAbsolute(d) ? path.relative(ROOT, d) : d);

/**
 * The far side of the boundary: every local module the reader's graph
 * `import()`s that `NOT_ROUTE_ROOTS` does not claim — `/admin`'s pages, the
 * author-gift dialog and `/design`.
 *
 * **Derived, and it used to be two names.** `AdminPage.tsx` and `DesignPage.tsx`
 * were listed by hand, and when `/admin/costs`, `/admin/vouchers` and
 * `/admin/articles` became chunks of their own nobody added them, so a module
 * private to one of them could join the reader's startup with every assertion
 * here green — reproduced 2026-10-22 by importing `useAdminCosts.ts` from
 * `App.tsx` (GPT Sol, 261021i stage 1 review, C4). Reading the `import()` edges
 * the walk already records means a new lazy private surface is on this side the day its
 * loader is written, and the default is the safe one: an unclassified chunk is
 * treated as admin-only, so the seam test below asks about it.
 *
 * Walked as a closure of its own so that the *seam* can be asserted rather
 * than a list of file names. See `SHARED_WITH_READER` below for why that is
 * not the same question.
 */
const ROUTE_ROOTS = [...closure.dynamic]
  .filter((d) => path.isAbsolute(d) && !NOT_ROUTE_ROOTS.has(lazyKey(d)))
  .sort();

/**
 * The seam: everything the lazy administrator-only surfaces reach that the
 * reader reaches too.
 *
 * Walked a second time from the lazy roots, and intersected. `ROUTE_PRIVATE`
 * below names the roots and a representative set outside that intersection.
 *
 * `parseFailures` is appended to by both walks, so a file in the overlap that
 * failed to parse is reported twice. That is untidy and harmless; the assertion
 * on it is `toEqual([])`. The walk does widen that assertion's reach, though —
 * the lazy-private modules are now parsed and checked as well.
 */
const routeClosure = eagerClosure(ROUTE_ROOTS);
const routeShared = [...routeClosure.files].filter((f) => closure.files.has(f)).map(rel).sort();
const externalKey = (spec: string) => (path.isAbsolute(spec) ? rel(spec) : spec);
const routeSharedExternals = [...routeClosure.externalImporters]
  .filter(
    ([spec, importers]) =>
      closure.externalImporters.has(spec) && [...importers].some((f) => !closure.files.has(f)),
  )
  .map(([spec]) => externalKey(spec))
  .sort();

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
 * Every module the lazy administrator-only surfaces and the reader **both**
 * reach.
 *
 * `ROUTE_PRIVATE` below is readable calibration, and a hand-written list was
 * all this file used to have. GPT Sol showed that it is weaker than the claim
 * made for it (code review 2026-09-05, F4, case 2): a new `review-admin-chart.ts`
 * imported statically from `App.tsx` **and** `AdminPage.tsx` left all five
 * assertions green, because a fixed list of six names cannot see a seventh.
 * Reproduced here on 2026-09-06 before this constant was written, which is the
 * only way to know a guard was ever red.
 *
 * So the boundary is asserted as a **seam** instead: intersect the eager
 * closure with the lazy-private closure, and require the result to be this list,
 * exactly, in both directions.
 *
 * **A line added here is a decision that every reader downloads that module
 * before they have asked for anything.** It is not a formality — the whole
 * 1.35 per cent this plan bought was 39 kB of exactly this kind of module.
 * Make the decision, or move the code so the lazy surface owns it.
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
 * Packages and local assets have their own shorter allowlist below. They are
 * not walked, but the seam records which route-private and eager local modules
 * import them, so a route-only dependency cannot enter the reader through a
 * second import while every local-file assertion stays green.
 *
 * One per line, so a diff reads as a decision.
 *
 * **There was a count in this sentence and it is gone** (2026-09-07). It said
 * how many entries the list has, and it was wrong at the base of this merge —
 * 45 written over 46 — so two branches each added entries, each carried the
 * wrong total forward, and the two wrong totals conflicted. A number nobody can
 * be wrong about is the one the test below already asserts, exactly and in both
 * directions: an entry missing from the list fails, and an entry here that is
 * not in both closures fails too. Prose restating a proved fact can go stale;
 * the proof cannot.
 */
const SHARED_WITH_READER = [
  "src/admin.ts",
  /* Arrived 2026-10-24 (plan 261024c, spya-rvj2p7), and not zero-cost: it is
     new to the reader's startup. `job-state.ts` reads `AUTO_MODE_STEPS` to say
     under a failed extras-only job that the article is unchanged, and the add
     card that draws it is eager. Accepted because it is a list of seven step
     names and one small table — a few hundred bytes minified — whose only
     imports, `step-order.ts` and types, the reader already has. */
  "src/auto-mode-steps.ts",
  /* Arrived 2026-09-06 by the second of the two zero-cost routes this list's
     header predicts — a module already here gaining an import of its own, not
     an admin file changing. `messages.ts` now imports `readableDay` from it, so
     that the ingest refusal and the /profile page cannot name a reset date in
     two different formats (docs/plans/260906h-improve-the-codebase-fourth-sweep.md
     § T1.5). Costs the reader nothing: `BillingSection.tsx`, `PricingPage.tsx`
     and `useBilling.ts` already import it, so it was in the reader's closure
     before this edge existed — what is new is only that the admin closure
     reaches it too. It is a leaf with no imports of its own, so nothing follows
     it in. */
  "src/billing-plan.ts",
  "src/block-policy.ts",
  /* Arrived 2026-10-03 with the Light / Dark / System choice (plan 261003e).
     It is eager on purpose: main.tsx starts it before the first render, so the
     page follows the OS and other tabs from the start. /design reaches it for
     `useTheme`, to remeasure its swatches when the theme changes. It imports
     only React, which the reader already has, so the shared edge costs nothing. */
  "src/web/appearance.ts",
  "src/feedback-payload.ts",
  "src/html.ts",
  "src/ids.ts",
  "src/ingest.ts",
  "src/job-failure.ts",
  "src/job-state.ts",
  "src/messages.ts",
  "src/mode-catalog.ts",
  "src/modes.ts",
  "src/monitoring-scrub.ts",
  /* Arrived 2026-10-05 behind src/ingest.ts, which was already here: `urlKey`
     and `slugFromUrl` ask it which paper an address names, so the add box and
     the server cannot disagree about an arXiv link (plan 261005l § Caller 1).
     A leaf with no imports of its own: two regular expressions and a list. */
  "src/paper-sources.ts",
  "src/quote-match.ts",
  "src/read-address.ts",
  "src/referee-criteria.ts",
  /* All three arrived 2026-10-26 with the shelf's how-much-read pie (plan
     261025l, spya-e5477u). They cost the reader nothing new: the shelf and the
     reader are eager and drew them first; what is new is only that a lazy route
     reaches them too. Small leaves: a mark, an SVG pie, and the filter that says
     which words have been read. */
  "src/web/ReadSoFarMark.tsx",
  "src/web/SharePie.tsx",
  "src/web/read-filter.ts",
  "src/title-text.ts",
  "src/types.ts",
  "src/uploads.ts",
  "src/urls.ts",
  /* Both arrived 2026-09-29 as extractions, not as new code for the reader
     (docs/plans/260929c-…). `BackLink` is the arrow-and-tooltip every page's
     way back now uses: the eager pages (Masthead, Tweets, Profile, Contact,
     Privacy, OpenSource, the visitor pages) each typed that link inline before,
     and `/admin` now shares it. (The masthead's went on 2026-10-07, plan
     261007b; `App.tsx` and the visitor pages still import the module.) `LogoGlyphs` is the wordmark's letters and
     spider, lifted out of HomeLogo and Dock — both eager — so `/design`'s
     gallery draws the same markup rather than a copy. The reader downloaded
     all of this already; what is new is only that the lazy routes reach the
     same module. Both import only `Link`, `Tooltip` and lucide, which are
     here already. */
  "src/web/BackLink.tsx",
  /* Nine entries arrived together on 2026-10-02, these two and seven
     elsewhere in the list
     (docs/plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md
     § Stage 3), when `/design` began drawing the band's (i) through the real
     `ModeSurface` and the two reader-facing switches through the real
     `HighPowerSwitch` and `SettingsSection`. Each was already in the reader's
     closure — every mode's band is a `ModeSurface`, and the bar draws the
     experimental switch — so the reader downloads nothing new; what is new is
     only that `/design` reaches them too. The seven: `ModeSurface`,
     `SettingsSection`, `mode-catalog.ts` (the (i)'s words), `useSession.ts`,
     and the experimental store's three files. */
  "src/web/BandAbout.tsx",
  /* Six arrived 2026-10-07 with plan 261007h, when `/design` began drawing
     the shared wait (`BandWaiting`, § F1, and its `useSlow`) and, in § F7's
     Controls across modes, the order chips (`OrderGroup`, which brings
     `useRevealChosen` and through it `fonts.ts`) and the failed read
     (`ReadError`). Each is already in the reader's closure — every band's
     panel draws them — so the reader downloads nothing new; what is new is
     only that `/design` reaches them too, from the real component rather
     than a copy. */
  "src/web/BandWaiting.tsx",
  "src/web/OrderGroup.tsx",
  "src/web/ReadError.tsx",
  "src/web/fonts.ts",
  "src/web/useRevealChosen.ts",
  "src/web/useSlow.ts",
  /* Arrived 2026-10-10 with the stale notice's × (plan 261010a): /design's
     specimen draws the real banner (`DismissibleNotice`) rather than a copy.
     Every reading band's panel already imports it, so the reader downloads
     nothing new; its own imports (Tooltip, lucide) were already shared. */
  "src/web/StaleNotice.tsx",
  "src/web/HighPowerSwitch.tsx",
  "src/web/IconButton.tsx",
  "src/web/JobProgress.tsx",
  "src/web/Link.tsx",
  "src/web/LogoGlyphs.tsx",
  /* Arrived 2026-10-01 (docs/plans/261001q-logo-loading-spinner.md). Eager
     because it *is* the article page's wait: it has to be in the bundle before
     the fetch it stands in for, so a lazy chunk would be a second wait in front
     of the spinner. `/design` draws a live specimen so a reviewer can see it
     without a slow fetch. About 200 lines, importing only `logo-animation.ts`
     and `LogoGlyphs`, which the reader already has. */
  "src/web/LogoLoader.tsx",
  "src/web/ModeSurface.tsx",
  "src/web/SettingsSection.tsx",
  "src/web/ShelfEntry.tsx",
  /* Arrived 2026-10-20 with /admin/users' Columns menu (plan 261020c), by the
     zero-cost route: `Library.tsx` already imports it for the shelf table's
     remembered hidden columns, and /admin/users now reuses the same hook with
     its own storage keys rather than a second copy. Small, and importing only
     React and TanStack Table, which the shelf already loads. */
  "src/web/shelf-hidden-columns.ts",
  /* Arrived 2026-10-03 with the reader's own tags (plan 261003d), by the
     second zero-cost route: `ShelfEntry.tsx` (already here) draws every card's
     tags and their editor, so the editor, its API module and the spelling rules
     are in the reader's shelf closure whatever the admin routes do. Small, and
     importing nothing the reader lacks. */
  "src/web/ShelfTags.tsx",
  "src/web/TagEditor.tsx",
  "src/web/article-tags.ts",
  "src/tags.ts",
  "src/web/TitleEditor.tsx",
  "src/web/Tooltip.tsx",
  /* Split out of Tooltip.tsx on 2026-10-17 (plan 261017g), one constant, so it
     is shared exactly as Tooltip.tsx is. */
  "src/web/tooltip-delay.ts",
  "src/web/build-stamp.ts",
  "src/web/components/ui/button.tsx",
  /* `reception-levels.ts` and `threshold.ts` were here from 2026-09-06 to
     2026-10-03: `params.ts` imported the first for `?name=`'s vocabulary, and
     the second followed it in. `?name=` retired with Debate's identification
     slider (plan 261003o), `params.ts` no longer imports either, and the lazy
     routes stopped reaching them. */
  "src/web/diagram.ts",
  "src/web/experimental-copy.ts",
  "src/web/experimental-store.ts",
  /* Arrived 2026-10-02 by the second predicted route: `ModeSurface`, already
     here, gained an import of it so every band's (i) can end in *More in
     Help →* (plan 261002e). The reader already downloaded it through
     `Dock.tsx`'s Help link; what is new is only that `/design`'s band gallery
     reaches it too. Plain data — ids and `helpHref` — importing only
     `modes.ts` and `router.ts`. */
  "src/web/help/help-anchors.ts",
  "src/web/jump-history.ts",
  /* Arrived 2026-10-07 behind `TitleEditor` and `TagEditor`, both already
     here: each now asks `isImeComposing` whether a key belongs to an input
     method (plan 261007a-ui-sweep-k2). The reader had it already, through the
     Dock; a leaf with no imports of its own, so nothing follows it in. */
  "src/web/key-chord.ts",
  "src/web/lib/DataTable.tsx",
  /* Arrived 2026-10-06 by the second predicted route: `DataTable.tsx`, already
     here, gained an import of it for its `sidewaysCue` prop (plan 261006g
     § Stage 2). Only `/admin/costs` turns the shade on, but since plan 261006h
     the shelf's table runs it too: it is what makes the table's scroll box a
     tab stop while it overflows. Small, most of it comment, importing nothing
     but React. */
  "src/web/lib/SidewaysScrollBox.tsx",
  /* Arrived 2026-09-24 by the first predicted route: the admin pages
     (`useAdminUsers`, `useAdminFeedback`) started using `describeFetchFailure`,
     which the reader's shelf and comments already download — and `sse.ts`
     follows it in for `StreamStalled`. Plan 260924a § Stage 2c. */
  "src/web/lib/describe-failure.ts",
  "src/web/lib/api.ts",
  /* Arrived 2026-10-20 with *View as* (plan 261019n § Part 3). Eager by
     necessity: `apiFetch` and main.tsx ask it on every request and at boot
     whether this tab is viewing as another reader. `/admin` reaches it too,
     for `isViewAsNonce` in ViewAsStart.tsx. It imports nothing at all. */
  "src/web/lib/view-as.ts",
  /* Arrived 2026-10-03 the same way: `lib/api.ts` counts every write it sends
     (the article preload's staleness check, plan 261003d), and the count is
     a forty-line module of its own so that api.ts and the preload do not
     import each other. Nothing in it is admin-only. */
  "src/web/lib/writes.ts",
  "src/web/lib/offline-store.ts",
  /* Arrived 2026-09-24 as the second predicted case: `lib/api.ts`, already
     here, gained an import of it — `HttpError` extends its `ReaderFacingError`.
     A leaf of two dozen lines the reader already downloads through `api.ts`;
     docs/plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md. */
  "src/web/lib/reader-facing.ts",
  /* Arrived 2026-10-06 the same way, with `lib/session.ts` below: `lib/api.ts`,
     already here, imports the tab's one held session, which tells this module
     when the reader changes. A leaf with no imports. Plan 261006f. */
  "src/web/lib/reader-change.ts",
  /* The one subscription to the SDK for identity, which `lib/api.ts` binds
     requests to and `useSession` draws from. It must be eager for the reason
     `api.ts` is: every request needs it. About a hundred lines. Plan 261006f. */
  "src/web/lib/session.ts",
  /* With `describe-failure.ts`, above. */
  "src/web/lib/sse.ts",
  "src/web/lib/supabase.ts",
  /* Arrived 2026-10-01 with password reset (docs/plans/261001i-password-reset.md):
     the listener that tells a recovery link from a sign-in. It must be eager — it
     has to be registered beside `createClient`, before the URL exchange can
     finish — and it is shared only because `supabase.ts` already is. A leaf of
     about sixty lines with no imports. */
  "src/web/lib/url-session-kind.ts",
  "src/web/lib/table-sort.ts",
  "src/web/lib/utils.ts",
  "src/web/library-columns.tsx",
  "src/web/log-buffer.ts",
  /* Arrived 2026-09-07 by the *first* of the two zero-cost routes this list's
     header predicts: a lazy route starting to use something the reader already
     downloads. `HomeLogo` and `Dock` both call `useLogoAnimation`, so the
     wordmark's hover animations and their picker were in every
     reader's startup before `/design` had heard of them — what is new is only
     that `/design` draws the whole set in a gallery, which is the one way
     animations that fire one at a time at random can be compared
     (DesignPage.tsx § LogoAnimations). Costs the reader nothing: it is a leaf
     whose only imports are React's own. */
  "src/web/logo-animation.ts",
  /* Arrived 2026-10-07 at no cost: two class strings and one small hook that
     were inline in `ShelfEntry.tsx` (here already) until the bottom bar's More
     menu became the second user of them (plan 261007c). It imports only
     `react`. */
  "src/web/menu.ts",
  "src/web/monitoring.ts",
  "src/web/offline.ts",
  "src/web/page-title.ts",
  "src/web/params.ts",
  "src/web/referee-views.ts",
  "src/web/relative-time.ts",
  "src/web/router.ts",
  "src/web/useNow.ts",
  /* Arrived 2026-10-04 (plan 261004e) by the second predicted route:
     `ShelfEntry`, here already, copies a link through it instead of writing to
     the clipboard itself. The reader downloaded the same code inline in eight
     components before; it is a leaf whose only import is React. */
  "src/web/useCopy.ts",
  "src/web/useExperimental.ts",
  /* Arrived 2026-10-04 (plan 261004g): `BandAbout`, here already, takes its
     open state from it, and so does Referee's *How to read this*. The reader
     downloaded the same few lines inline in `RefereeMode` before; it is a
     leaf whose only import is React. */
  "src/web/usePressToggle.ts",
  "src/web/useSession.ts",
  /* Arrived 2026-10-02 (plan 261002f) by the second predicted route:
     `TitleEditor`, `ShelfEntry` and `library-columns`, all here already, now
     put a title or a blurb in its writer's face through it. The reader already
     downloads it — the shelf and every mode with a section title import it —
     and it is a leaf of three small functions importing nothing at runtime. */
  "src/web/voice.ts",
  /* Thirteen that were shared before anybody looked, found 2026-10-22 when
     `ROUTE_ROOTS` stopped being two hand-typed names and began to include the
     admin pages with chunks of their own (`/admin/costs`, `/admin/vouchers`,
     `/admin/articles`). All are zero-cost, by the first predicted route: each
     was already in the reader's startup, and the admin page only reaches it.
     `cost-cube.ts` is the article page's cost line (`ArticleCost.tsx`) and
     /admin/costs' whole view. `made-for.ts` is App.tsx's, and the vouchers
     page names a reader through it. The other eleven arrive together behind
     `admin-vouchers-parts.tsx`, which reuses the shelf's own `useShelf` and
     `useJobs` so its pickers can list the administrator's own shelf: the job engine,
     uploads and the shelf cache come with them, all of it App.tsx's and
     Library.tsx's already. */
  "src/cost-cube.ts",
  "src/step-order.ts",
  "src/web/add-sharing-session.ts",
  "src/web/auto-modes-setting.ts",
  "src/web/batchUpload.ts",
  "src/web/jobEngine.ts",
  "src/web/lib/cached-shelf.ts",
  "src/web/lib/made-for.ts",
  "src/web/unload-guard.ts",
  "src/web/upload.ts",
  "src/web/uploadEngine.ts",
  "src/web/useJobs.ts",
  "src/web/useShelf.ts",
  /* Arrived 2026-10-24 (plan 261024n, spya-v88mga) by the first predicted
     path: the command bar's author-gift dialog is a lazy chunk of its own,
     loaded on the administrator's first press, and like every other dialog it
     keeps itself inside the visible viewport through this hook. The reader
     already has it — twelve eager dialogs and panels import it — so the new
     edge costs nothing. */
  "src/web/useVisualViewport.ts",
];

/**
 * Packages or local assets imported by both an actually lazy-private local
 * module and the reader's eager closure. Package specifiers stay exact because
 * subpaths can be different modules; local assets use repo-relative paths.
 * Like `SHARED_WITH_READER`, asserted in both directions.
 */
const SHARED_EXTERNALS_WITH_READER = [
  "@tanstack/react-table",
  "class-variance-authority",
  "lucide-react",
  "nuqs",
  "radix-ui",
  "react",
];

/**
 * Every administrator-only lazy root, plus representative modules those
 * surfaces own and nothing of the reader's uses — readable calibration beside the seam above,
 * which can see a module nobody thought to name.
 *
 * Named individually rather than by directory because there is no directory —
 * they sit beside the reader's files. Each must also be reached by the
 * *derived* route closure (asserted below), which is what makes this list
 * calibration for `ROUTE_ROOTS`. In particular every root itself is here: a
 * root the derivation stops finding goes red rather than shrinking the seam to
 * something that passes. This is not an inventory of every route-private
 * dependency; the seam is what catches an unlisted one becoming eager. Until
 * 2026-10-22 it was six names covering `/admin` and `/design` only; the three
 * admin pages with chunks of their own were added then.
 */
const ROUTE_PRIVATE = [
  "src/web/AuthorGiftDialog.tsx",
  "src/web/AdminPage.tsx",
  "src/web/AdminArticlesPage.tsx",
  "src/web/AdminCostsPage.tsx",
  "src/web/AdminVouchersPage.tsx",
  "src/web/DesignPage.tsx",
  "src/web/admin-articles-columns.tsx",
  "src/web/admin-columns.tsx",
  "src/web/admin-costs-view.ts",
  "src/web/admin-vouchers-columns.tsx",
  "src/web/AdminFeedbackList.tsx",
  "src/web/useAdminArticles.ts",
  "src/web/useAdminCosts.ts",
  "src/web/useAdminFeedback.ts",
  "src/web/useAdminUsers.ts",
  "src/web/useAdminVouchers.ts",
];

/**
 * **The mode controllers, discovered rather than listed — and they are the
 * other side of this file's boundary.**
 *
 * `/admin` and `/design` must stay *out* of the reader's first download; the
 * reading view's own code must stay *in* it, and until 2026-09-06 nothing said
 * so. The positive controls above name generic modules — `main.tsx`,
 * `Library.tsx`, `supabase.ts` — so making `DebateMode.tsx` a `React.lazy`
 * boundary left every assertion in this file green while breaking the
 * documented contract: *cached JSON cannot make an unloaded chunk execute, and
 * in-tab offline navigation depends on that* (docs/project/web-client.md
 * § `LazyPage.tsx`, and 260905i's A4). GPT Sol, 2026-09-06, F19.
 *
 * **Every `.tsx` under `src/web/modes/`, not `*Mode.tsx`.** A naming convention
 * is a second list beside the data and this one already has a hole in it:
 * `ConversationModes.tsx` is plural and would not have matched. The directory
 * is the fact; what a file inside it is called is not.
 */
const MODES = path.join(WEB, "modes");

const MODE_CONTROLLERS = readdirSync(MODES, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(MODES, f))
  .sort();

describe("the reading view's modes are code a reader already has", () => {
  it("found the mode controllers at all", () => {
    /* The walk that finds nothing satisfies both assertions below.
       docs/reusable/silent-success.md. */
    expect(MODE_CONTROLLERS.map(rel), "no mode controllers under src/web/modes/").not.toEqual([]);
    /* `DebateMode.tsx` until 2026-10-09, when Debate and Citations became Sources. */
    expect(MODE_CONTROLLERS.map(rel)).toContain("src/web/modes/sources/SourcesMode.tsx");
  });

  it("has every one of them in the reader's first download", () => {
    const missing = MODE_CONTROLLERS.filter((f) => !closure.files.has(f)).map(rel);
    expect(
      missing,
      `${missing.length} mode controller(s) are not in the reader's eager closure: ` +
        `${missing.join(", ")}. A mode behind a lazy boundary is a mode an offline reader ` +
        `cannot open, because cached JSON cannot make an unloaded chunk execute — ` +
        `docs/project/web-client.md § LazyPage.tsx. If a mode is genuinely meant to be ` +
        `lazy, that is a decision to take with Greg and to write into that doc first.`,
    ).toEqual([]);
  });

  it("is reached by no dynamic import at all", () => {
    /* The half the assertion above cannot see. A mode made lazy while some
       other eager module still imports it stays in the closure and passes —
       and then ships in both the eager bundle and a chunk. Any `import()`
       naming a file under `src/web/modes/` is wrong whichever way the closure
       reads. */
    const dynamic = [...closure.dynamic]
      .filter((d) => d.startsWith(`${MODES}${path.sep}`))
      .map(rel)
      .sort();
    expect(
      dynamic,
      `a dynamic import() reaches ${dynamic.join(", ")}. Mode code is eager on purpose.`,
    ).toEqual([]);
  });
});

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

  it("classifies every lazy chunk the reader's graph opens", () => {
    /* `ROUTE_ROOTS` takes every local `import()` target not in
       `NOT_ROUTE_ROOTS`, so a local one cannot fall through; a package cannot
       be walked, so an unclassified one is named here instead. And a line in
       `NOT_ROUTE_ROOTS` that no longer names an import is a claim about the
       graph that has stopped being true. */
    const unclassified = [...closure.dynamic].filter(
      (d) => !path.isAbsolute(d) && !NOT_ROUTE_ROOTS.has(d),
    );
    expect(unclassified, "a package loaded lazily that NOT_ROUTE_ROOTS does not name").toEqual([]);
    const lazy = new Set([...closure.dynamic].map(lazyKey));
    const stale = [...NOT_ROUTE_ROOTS.keys()].filter((k) => !lazy.has(k));
    expect(stale, "NOT_ROUTE_ROOTS names an import() the reader's graph no longer makes").toEqual(
      [],
    );
  });

  it("names every administrator-only lazy root in the route-private calibration", () => {
    const unnamed = ROUTE_ROOTS.map(rel).filter((root) => !ROUTE_PRIVATE.includes(root));
    expect(
      unnamed,
      "a derived administrator-only lazy root is absent from ROUTE_PRIVATE, so making it eager could remove it from ROUTE_ROOTS and leave the guard green",
    ).toEqual([]);
  });

  it("derived a route closure that reaches every named calibration module", () => {
    /* Calibration for `ROUTE_ROOTS`. Every root is in `ROUTE_PRIVATE`, so a
       derivation that found no roots — or lost one — would shrink the seam to
       something that passes elsewhere but goes red here. */
    const unreached = ROUTE_PRIVATE.filter((p) => !routeClosure.files.has(path.join(ROOT, p)));
    expect(
      unreached,
      `not reached from the derived roots (${ROUTE_ROOTS.map(rel).join(", ")})`,
    ).toEqual([]);
  });

  it("finds no lazy chunk inside the routes that it has not walked", () => {
    /* The route closure's own `import()`s are not followed, so a page an admin
       route opens lazily would sit outside the seam. None does today; when one
       does, it belongs in `ROUTE_ROOTS` (or `NOT_ROUTE_ROOTS`), and this says so. */
    const known = new Set([...ROUTE_ROOTS.map(rel), ...NOT_ROUTE_ROOTS.keys()]);
    const unwalked = [...routeClosure.dynamic].map(lazyKey).filter((k) => !known.has(k));
    expect(unwalked).toEqual([]);
  });

  it("does not reach the administrator's pages or /design", () => {
    const held = ROUTE_PRIVATE.filter((p) => inClosure(p));
    expect(held.map(why).join("\n\n"), held.join(", ")).toBe("");
  });

  it("shares with the reader only what somebody agreed it should share", () => {
    /* The local-file and external seams, in both directions — see the two
       `SHARED_*_WITH_READER` lists. The names in `ROUTE_PRIVATE` are the
       readable calibration; this is the check that can see a module nobody
       named. */
    const allowed = new Set(SHARED_WITH_READER);
    const unexpected = routeShared.filter((p) => !allowed.has(p));
    const stale = SHARED_WITH_READER.filter((p) => !routeShared.includes(p));
    const allowedExternals = new Set(SHARED_EXTERNALS_WITH_READER);
    const unexpectedExternals = routeSharedExternals.filter((p) => !allowedExternals.has(p));
    const staleExternals = SHARED_EXTERNALS_WITH_READER.filter(
      (p) => !routeSharedExternals.includes(p),
    );

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
    if (unexpectedExternals.length > 0) {
      report.push(
        `${unexpectedExternals.length} package(s) or asset(s) are statically imported by ` +
          "BOTH a route-private module and the reader's startup, and are not on " +
          `SHARED_EXTERNALS_WITH_READER: ${unexpectedExternals.join(", ")}`,
        "Adding a line to SHARED_EXTERNALS_WITH_READER is a decision that every reader " +
          "downloads that package or asset before asking for the admin or /design route. " +
          "Make it deliberately, or keep it behind the route.",
      );
    }
    if (staleExternals.length > 0) {
      report.push(
        `SHARED_EXTERNALS_WITH_READER names ${staleExternals.length} package(s) or asset(s) ` +
          "that are no longer imported by both a route-private module and the reader's " +
          `startup. Delete them: ${staleExternals.join(", ")}`,
      );
    }

    expect(
      report.join("\n\n"),
      [
        unexpected.length > 0 ? `+${unexpected.join(", ")}` : "",
        stale.length > 0 ? `-${stale.join(", ")}` : "",
        unexpectedExternals.length > 0 ? `+externals:${unexpectedExternals.join(", ")}` : "",
        staleExternals.length > 0 ? `-externals:${staleExternals.join(", ")}` : "",
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
