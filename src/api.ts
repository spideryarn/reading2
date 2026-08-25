/**
 * Stage 6 (server side) — load an article's artefacts off disk.
 *
 * Deliberately transport-free: this is a plain async function, mounted at
 * `GET /api/article/:slug` by the Vite dev middleware in vite.config.ts. When a
 * standalone Node server arrives (architecture.md § Server and client) it wraps
 * this same function rather than reimplementing the reads.
 *
 * Lookup order: data/<slug>/ (the real pipeline output) then example/ (the
 * hand-authored placeholder). So the moment stages 3–5 write data/<slug>/, the
 * client picks it up with no changes here or in the UI.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Arc, Article, Block, Meta, Tree } from "./types.js";

const ROOT = path.resolve(import.meta.dirname, "..");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Directories to try, in order, for a given slug. */
function candidateDirs(slug: string): string[] {
  return [path.join(ROOT, "data", slug), path.join(ROOT, "example")];
}

export async function loadArticle(slug: string): Promise<Article> {
  for (const dir of candidateDirs(slug)) {
    const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
    const tree = await readJson<Tree>(path.join(dir, "tree.json"));
    if (!blocksFile || !tree) continue;

    // meta.json is optional — stages 3-5 don't all write one yet. Falling back
    // to the slug puts "noema-mythology-of-conscious-ai" at the top of the
    // reading view, so derive a real title from the article's own first heading
    // instead, and keep the slug only as the last resort.
    const meta =
      (await readJson<Meta>(path.join(dir, "meta.json"))) ??
      ({
        slug,
        title:
          blocksFile.blocks.find((b) => b.kind === "heading" && b.level === 1)?.text ??
          slug,
      } satisfies Meta);

    // Optional, and stays optional: the arc (stage 5b, src/arc.ts) is a
    // second model pass, so an article can be perfectly readable without one.
    // Absent means the L0 column falls back to the root gist.
    const arc = await readJson<Arc>(path.join(dir, "arc.json"));

    return { meta, blocks: blocksFile.blocks, tree, ...(arc ? { arc } : {}) };
  }
  // Tagged 404 rather than left for routes.ts to infer. Inferring it meant
  // every unclassified fault — a corrupt tree.json, a permissions problem —
  // also came back "no such article", which is the wrong thing to investigate.
  throw Object.assign(
    new Error(
      `No article artefacts for "${slug}". Looked in:\n  ${candidateDirs(slug).join("\n  ")}\n` +
        `Each needs blocks.json + tree.json.`,
    ),
    { status: 404 },
  );
}
