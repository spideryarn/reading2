/**
 * **What a request from a stranger can reach**, as an import graph.
 *
 * GPT Sol asked for this by name, 2026-08-28:
 *
 * > A transitive-import test, modelled on `tests/client-imports.test.ts`,
 * > starting at `src/public/routes.ts`. It must not reach `src/api.ts`,
 * > `src/store/index.ts`, `src/store/pg.ts`, writer modules, or any AI/gateway
 * > root.
 *
 * The first three are about **leaks**: `src/api.ts` runs the meta through
 * `titleFor()`, `pg.ts`'s `blocksQuery` selects per-block `note` and its
 * glossary read joins `glossary_lookups`. Every one of those is correct for the
 * owner and is somebody's private data here. The last two are about **money**:
 * Greg's rule is that no logged-out visitor causes a paid call, and a module
 * that cannot be reached cannot be called by mistake.
 *
 * ## Two things this test is honest about
 *
 * **It follows runtime imports only.** `import type` erases at compile time and
 * cannot call anything, and this matters immediately rather than in theory:
 * `src/db/schema.ts` does `import type { LabelsFile } from "../labels.js"` for
 * one `jsonb().$type<…>()`, and `src/labels.ts` is a model pass that reaches
 * the whole gateway. Counting that would make the check unpassable for every
 * store module in the repo, including `pg.ts`, and would say nothing true about
 * what a request can do. Written down because a walker that ignores `type` is
 * exactly the kind of leniency that should be argued for rather than noticed.
 *
 * **A static graph is not the whole proof, which is why it is not the whole
 * check.** docs/plans/public-read-only-access.md already records the first
 * draft's mistake here — it proposed a static "no public file imports the
 * gateway" test and Sol pointed out `src/api.ts` imports the writers, so the
 * test could not pass. The runtime gateway spy in
 * tests/public-visibility-pg.test.ts is the half that watches what actually
 * happens; this half is what stops somebody adding the import in the first
 * place.
 *
 * ## The positive control is in the test, not in a note
 *
 * The last case walks the same function from `src/routes.ts` and asserts it
 * **does** reach the forbidden modules. So "the public graph is clean" and "the
 * walker can see a dirty graph" are checked in the same run, and a walker
 * broken into always returning nothing fails rather than passing twice. That is
 * docs/reusable/silent-success.md applied to the check itself.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The specifiers one file imports **at run time**.
 *
 * `import type { X } from "y"` and a brace clause whose every specifier is
 * `type X` both erase, so neither is followed. Everything else is — including
 * `export … from`, a bare side-effect `import "…"`, and a dynamic `import("…")`,
 * because all three execute the module.
 */
function runtimeImportsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+([^;'"]*?)from\s*["']([^"']+)["']/g)) {
    const clause = (m[1] ?? "").trim();
    if (clause === "type" || clause.startsWith("type ")) continue;
    const braces = /^\{([\s\S]*)\}$/.exec(clause);
    if (braces) {
      const names = (braces[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    if (m[2]) found.push(m[2]);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) if (m[1]) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) if (m[1]) found.push(m[1]);
  return found;
}

/** Every module reachable from one entry point, repo-relative and sorted. */
function graphFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [path.join(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImportsOf(file)) {
      // A bare specifier is a package; only relative imports are ours.
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(file), spec).replace(/\.js$/, ".ts");
      const tsx = resolved.replace(/\.ts$/, ".tsx");
      if (existsSync(resolved)) queue.push(resolved);
      else if (existsSync(tsx)) queue.push(tsx);
      else throw new Error(`cannot resolve ${spec} from ${path.relative(ROOT, file)}`);
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f)).sort();
}

/**
 * **The owner's read layer.** Each one returns something the public payload must
 * not contain, and each one is correct where it lives.
 */
const OWNER_READS = ["src/api.ts", "src/store/index.ts", "src/store/pg.ts"];

/**
 * **The owner himself.** `currentOwnerId()` is the runtime tripwire — on an
 * ownerless request it throws — but a public module that could reach it is a
 * public module one edit away from `setRequestOwner`. Sol's four reinforcing
 * boundaries, and this is the second.
 */
const THE_OWNER = ["src/owner.ts"];

/** Anything that can spend Greg's money, and the stages that call them. */
const SPENDS = [
  "src/ai-call.ts",
  "src/anthropic-call.ts",
  "src/openrouter-stream.ts",
  "src/messages-stream.ts",
  "src/converse.ts",
  "src/explain.ts",
  "src/embeddings.ts",
  "src/search.ts",
  "src/models.ts",
  "src/term-lookup.ts",
];

/** The pipeline stages, which write as well as spend. */
const WRITERS = [
  "src/arc.ts",
  "src/blocks.ts",
  "src/extract.ts",
  "src/fetch.ts",
  "src/glossary.ts",
  "src/ideas.ts",
  "src/labels.ts",
  "src/pdf-read.ts",
  "src/pipeline.ts",
  "src/summarise.ts",
  "src/toc.ts",
  "src/tweets.ts",
  "src/jobs.ts",
];

const FORBIDDEN = [...OWNER_READS, ...THE_OWNER, ...SPENDS, ...WRITERS];

describe("the public API's import graph", () => {
  const publicGraph = graphFrom("src/public/routes.ts");

  it("cannot reach the owner's reads, the owner, a writer or the gateway", () => {
    expect(publicGraph.filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  /**
   * And the reader itself, checked separately — because somebody adding a
   * public endpoint would edit `public/routes.ts`, and somebody adding a public
   * *query* would edit this one, and the second is where the leak would be.
   */
  it("and neither can the public reader on its own", () => {
    expect(graphFrom("src/store/public-reader.ts").filter((f) => FORBIDDEN.includes(f))).toEqual([]);
  });

  /**
   * **The predicate leaf really is a leaf.**
   *
   * This is the point of `public-slug.ts` being its own file rather than living
   * beside `ownedSlug`: putting the two predicates together would make the
   * public leaf import `currentOwnerId`, which is exactly the dependency public
   * reads should lack. Sol's answer 4.
   */
  it("and publicSlug imports nothing but the schema", () => {
    expect(graphFrom("src/store/public-slug.ts")).toEqual([
      "src/db/schema.ts",
      "src/ids.ts",
      "src/store/public-slug.ts",
    ]);
  });

  /**
   * **The positive control**, and the reason the three cases above are worth
   * believing.
   *
   * The same walker, the same forbidden list, one different entry point. If it
   * ever returns an empty list here, the walker has stopped working and the
   * cases above are passing for the wrong reason — a check nobody has watched
   * fail is not evidence (docs/reusable/silent-success.md).
   */
  it("but the authenticated API reaches all of them, which is how we know the walk works", () => {
    const authenticated = graphFrom("src/routes.ts");
    const reached = authenticated.filter((f) => FORBIDDEN.includes(f));
    for (const named of ["src/api.ts", "src/store/index.ts", "src/owner.ts", "src/ai-call.ts"]) {
      expect(reached, named).toContain(named);
    }
  });
});
