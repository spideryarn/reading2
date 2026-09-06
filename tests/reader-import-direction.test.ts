/**
 * **Which way the reading view's imports are allowed to point.**
 *
 * `App.tsx` was 5,920 lines holding five unrelated jobs. Stages 1 to 3 of
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md
 * took four of them out — ten mode controllers into `src/web/modes/<feature>/`,
 * the reading view into `src/web/reader/`, who-may-read-this into
 * `src/web/article/` — and left route choice, the session and the persistent
 * services behind. None of that is worth anything if a feature module can
 * simply import its way back, so the acceptance criterion for the whole piece
 * of work is a direction rather than a line count. This is that criterion,
 * executable.
 *
 * Two rules, and the contract needs **both**: a feature module may import
 * neither the composition above it nor another feature beside it.
 *
 *  1. Nothing under `src/web/modes/`, `src/web/reader/` or `src/web/article/`
 *     may import `src/web/App.tsx`, statically **or** dynamically.
 *  2. Nothing under `src/web/modes/<feature>/` may import anything under a
 *     **different** `src/web/modes/<other>/`.
 *
 * **Rule 2 is what stops the next occurrence of the thing stage 2 avoided by
 * hand.** `RememberBand` renders `ConversationBand`, so `modes/chat/` beside
 * `modes/remember/` would have been one feature importing another; the two were
 * put in a single `modes/conversation/ConversationModes.tsx` instead, because
 * somebody read the code and noticed. That is exactly the check a guard should
 * be doing — GPT Sol's findings F2 and F11 on the plan. A shared piece belongs
 * one level up, in `src/web/`, not in a sibling's directory.
 *
 * ## Why an AST and not a text scan
 *
 * The argument is written out at length in the headers of
 * [`tests/helpers/ts-ast.ts`](helpers/ts-ast.ts) and
 * [`tests/eager-client-graph.test.ts`](eager-client-graph.test.ts), and it is
 * not hypothetical here: several of these files carry doc comments that name
 * `App.tsx` and quote `import(` in prose — every one of them says which file it
 * was lifted out of. A character scan would report those essays as edges, and,
 * worse, a scan desynchronised by a bracket in a string literal would quietly
 * stop examining the rest of a file. A gate that goes quiet is worse than one
 * that goes red.
 *
 * ## Fail closed, and prove the walk happened
 *
 * A local specifier that resolves to nothing fails this test loudly rather than
 * being dropped: a resolver that silently drops an edge is how a guard stops
 * being a guard, and it would drop the edge that matters on the day somebody
 * introduces it. And because "is X absent" is a question a walker that has
 * stopped walking answers correctly every time, the positive controls below
 * assert that files were found, that imports were found in them, and that a
 * known-present edge is among them.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type AstNode, lineOf, parseSource, walkAst } from "./helpers/ts-ast.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "src", "web");
const APP = path.join(WEB, "App.tsx");
const MODES = path.join(WEB, "modes");

/** The three directories the rules are about, in the order the plan moved them. */
const GOVERNED = ["modes", "reader", "article"].map((d) => path.join(WEB, d));

/** Recorded as an edge, never resolved to a module — there is no TS behind it. */
const ASSET_EXT = new Set([".css", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".gif", ".json"]);

/** Every `.ts`/`.tsx` under `dir`, recursively. Empty if the directory is absent. */
function sourcesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .map((f) => path.join(dir, f));
}

/**
 * Resolve a specifier written in `from` to a file on disk.
 *
 * `null` for a bare specifier (node_modules — not our business) and for an
 * asset. Throws for a local specifier that resolves to nothing, per *fail
 * closed*: the same resolver shape as `tests/eager-client-graph.test.ts`, and
 * the same reason.
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
  if (ASSET_EXT.has(ext)) return null;

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
      "The resolver in tests/reader-import-direction.test.ts needs teaching, and until it is " +
      "this guard is reading a graph with a hole in it.",
  );
}

function sourceValue(n: unknown): string | null {
  if (!n || typeof n !== "object") return null;
  const v = (n as { value?: unknown }).value;
  return typeof v === "string" ? v : null;
}

/**
 * The specifier this node names, or `null` for the great majority of nodes.
 *
 * **Type-only edges count here**, unlike in the eager-graph test. That file is
 * about bytes a reader downloads, and `import type` erases; this one is about
 * whether a feature module knows what is above it, and a type import is knowing
 * it. `import("…")` arrives as `ImportExpression` on this babel and as a
 * `CallExpression` with an `Import` callee on others, so both are read.
 */
function edgeAt(n: AstNode): { spec: string; kind: "static" | "dynamic" } | null {
  if (n.type === "ImportDeclaration") {
    const spec = sourceValue(n.source);
    return spec ? { spec, kind: "static" } : null;
  }
  if (n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") {
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

interface Edge {
  /** The importing file, absolute. */
  from: string;
  /** As written. */
  spec: string;
  /** Absolute, or `null` for a bare package specifier or an asset. */
  to: string | null;
  kind: "static" | "dynamic";
  line: number;
}

/**
 * Every file whose parse was not clean, and it must stay empty.
 *
 * `parseSource` sets `errorRecovery` deliberately, so a file it cannot read
 * yields a **partial** AST rather than a throw — and a dropped import is
 * indistinguishable from an import that was never written. Collected and
 * asserted rather than trusted, exactly as in `eager-client-graph`.
 */
const parseFailures: string[] = [];

const files = GOVERNED.flatMap(sourcesUnder).sort();
const edges: Edge[] = [];
for (const file of files) {
  const ast = parseSource(readFileSync(file, "utf8"));
  const errors = ast.errors ?? [];
  if (errors.length > 0) parseFailures.push(`${path.relative(ROOT, file)}: ${errors[0]}`);
  walkAst(ast.program, (n) => {
    const edge = edgeAt(n);
    if (!edge) return;
    edges.push({
      from: file,
      spec: edge.spec,
      to: resolveLocal(edge.spec, file),
      kind: edge.kind,
      line: lineOf(n),
    });
  });
}

const rel = (f: string) => path.relative(ROOT, f);

/** The feature directory a file belongs to, or `null` if it is not under modes/. */
function featureOf(file: string): string | null {
  const inside = path.relative(MODES, file);
  if (inside.startsWith("..") || path.isAbsolute(inside)) return null;
  const [feature] = inside.split(path.sep);
  return feature ?? null;
}

describe("which way the reading view's imports point", () => {
  it("read the files and their imports at all", () => {
    /* The positive controls, and they are not decoration: every assertion below
       is of the form "no edge does X", which is answered perfectly by a walk
       that found nothing. Three separate ways for this to have gone quiet — no
       files, no edges, or a parse that recovered by dropping statements — so
       three separate checks. */
    expect(parseFailures, "a recovered parse silently drops the edges it could not read").toEqual(
      [],
    );
    expect(files.length, "found no files under modes/, reader/ or article/").toBeGreaterThan(10);
    expect(edges.length, "found no imports in any of them").toBeGreaterThan(50);
    /* And calibration against ground truth: `Reader` composes the mode bands,
       so this specific edge is there by construction. If the walk cannot see
       it, the walk cannot see anything. */
    const known = edges.some(
      (e) => e.from === path.join(WEB, "reader", "Reader.tsx") && e.to === path.join(MODES, "ideas", "IdeasMode.tsx"),
    );
    expect(known, "Reader.tsx must import modes/ideas/IdeasMode.tsx").toBe(true);
  });

  it("never reaches up into App.tsx", () => {
    /* Rule 1. Statically or dynamically: a lazy import of the composition is
       the same coupling arriving a frame later, and it is the form somebody
       reaches for precisely when the static one will not compile. */
    const offenders = edges
      .filter((e) => e.to === APP)
      .map((e) => `${rel(e.from)}:${e.line} imports App.tsx (${e.kind}, as ${JSON.stringify(e.spec)})`);
    expect(
      offenders.join("\n"),
      "a feature module may not know what composes it — move the shared piece into src/web/ instead",
    ).toBe("");
  });

  it("never reaches sideways into another feature", () => {
    /* Rule 2, and the reason it exists is one directory over: `RememberBand`
       renders `ConversationBand`, and the two live in one file rather than in
       `modes/remember/` and `modes/chat/` because somebody read the code and
       noticed. This is the version that does not need somebody to notice. */
    const offenders: string[] = [];
    for (const e of edges) {
      if (e.to === null) continue;
      const from = featureOf(e.from);
      const to = featureOf(e.to);
      if (from === null || to === null || from === to) continue;
      offenders.push(
        `${rel(e.from)}:${e.line} imports ${rel(e.to)} — modes/${from} may not import modes/${to}`,
      );
    }
    expect(
      offenders.join("\n"),
      "two features that need the same code are one feature, or the shared piece belongs in src/web/",
    ).toBe("");
  });
});
