/**
 * **What a module can reach at run time**, as a set of files.
 *
 * Lifted out of [public-imports.test.ts](../public-imports.test.ts) on
 * 2026-09-04, unchanged, when a second guard came to need the same walk:
 * `tests/owner-isolation.test.ts` § ownerless enumeration inventories every
 * `.from(articles)` query in the public graph, and a second copy of the walker
 * would be a second set of rules about what counts as an import — which is
 * exactly the drift both guards exist to catch, one level up.
 *
 * The reasoning about *why* the walk is shaped like this lives with the test
 * that states the rule; what is here is the mechanism.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { refuseUntraceableImportsInSource } from "./ts-ast.js";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

/**
 * The specifiers one file imports **at run time**.
 *
 * `import type { X } from "y"` and a brace clause whose every specifier is
 * `type X` both erase, so neither is followed. Everything else is — including
 * `export … from`, a bare side-effect `import "…"`, and a dynamic `import("…")`,
 * because all three execute the module.
 *
 * A dynamic `import()` whose specifier is **not** a literal is refused rather
 * than dropped: the walks built on this ask "is anything server-only reachable
 * from the public door", and an edge with no name answers that question `no`
 * every time. GPT Sol found the same hole in three other graph guards on
 * 2026-09-06 (F21) — the argument, and the repo-wide scan saying nothing
 * legitimate is in the way, are in [`ts-ast.ts`](ts-ast.ts).
 */
export function runtimeImportsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  refuseUntraceableImportsInSource(text, path.relative(ROOT, file), "tests/helpers/import-graph.ts");
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
export function graphFrom(entry: string): string[] {
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
 * **Every door a stranger can come through**, and there are two of them.
 *
 * `src/public/routes.ts` is the JSON namespace. `src/public/page.ts` is the HTML
 * one — the serverless function that serves `/read/:slug` off the same hardwired
 * reader, to somebody who has not signed in and never will. It is the same
 * closed room with a second door, so it gets the same guards rather than new
 * ones: a walk that started only at `routes.ts` would have said nothing at all
 * about the page, and the page is the surface we invite strangers to.
 *
 * Listed rather than globbed over `src/public/`, so adding a third entry point
 * is a decision somebody makes here on purpose. `dto.ts` and `route-names.ts`
 * are leaves reached from these two, not doors of their own.
 */
export const PUBLIC_ENTRIES = ["src/public/routes.ts", "src/public/page.ts"];

/** Everything reachable from either door, deduplicated. */
export function publicFiles(): string[] {
  return [...new Set(PUBLIC_ENTRIES.flatMap((entry) => graphFrom(entry)))].sort();
}

/** Every `.ts`/`.tsx` under `src/`, repo-relative and sorted. */
export function srcFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, "src"));
  return found.sort();
}

/**
 * **Who opens the doors** — every module outside `src/public/` that imports one
 * of the entry points at run time.
 *
 * Derived rather than listed, and that is the whole point of the function. A
 * guard that keeps its own hand-written roster of transports is a guard that
 * goes quietly out of date the day a third one appears — which is the shape of
 * the finding this exists to answer (GPT Sol on stage 3a, 2026-09-04: the graph
 * rooted at the closed modules said nothing about the wrappers that call them).
 * Asking the repo instead means a new caller *fails* the guard rather than
 * escaping it.
 *
 * Only direct importers. A module that reaches the public entries through two
 * hops is not a transport; it is a caller of one, and the transport it goes
 * through is already checked.
 */
export function publicEntryImporters(): string[] {
  const entries = new Set(PUBLIC_ENTRIES.map((entry) => path.join(ROOT, entry)));
  const found: string[] = [];
  for (const file of srcFiles()) {
    if (file.startsWith("src/public/")) continue;
    const full = path.join(ROOT, file);
    for (const spec of runtimeImportsOf(full)) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(full), spec).replace(/\.js$/, ".ts");
      if (entries.has(resolved)) {
        found.push(file);
        break;
      }
    }
  }
  return found.sort();
}
