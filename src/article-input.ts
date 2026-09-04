/**
 * **The three things every article-reading stage reads, read once and handed in.**
 *
 * Seven stages — `arc`, `tweets`, `glossary`, `summary`, `ideas`, `quotes` and
 * `sketch` — each opened `blocks.json`, `tree.json` and `meta.json` out of a
 * directory for themselves. Seven copies of the same three reads, and seven
 * places the move off the filesystem would have had to touch.
 *
 * **Worse than the duplication**: a stage's `stamp` already asked the *store*
 * for exactly this triple, so every one of them hashed what the store held and
 * then generated from what the disk held. On a laptop those are the same bytes.
 * Through a job-scoped `/tmp` on a deployment they are not, and a stage that
 * hashes one article and generates from another is a stale artefact reporting
 * itself current for ever, with nothing about it looking wrong.
 * docs/plans/260831b-finish-the-database-move.md; docs/reusable/silent-success.md.
 *
 * So the stage no longer knows where an article comes from. It is given one.
 *
 * **`meta` is nullable and that is a real state, not a failure.** Every one of
 * these stages tolerates an article with no `meta.json` on purpose; the head of
 * the prompt simply loses its lines (src/article-prompt.ts § `articleText`).
 * The blocks and the tree are not optional: a stage with neither has nothing to
 * be about.
 *
 * `slug` is here because one stage needs it — `sketch` stamps it into the
 * picture it returns — and because `path.basename(opts.dir)` was how it used to
 * get it, which is exactly the kind of thing that keeps a directory alive.
 *
 * **There is no `readArticleFromDir` here any more, and that is the point.**
 * It lived beside these two with a comment saying no request path may call it;
 * a comment is not a mechanism. The eight stage CLIs that used it are gone
 * (the queue re-runs a stage — docs/project/ingest-queue.md), and the function
 * moved to [`tests/helpers/article-from-dir.ts`](../tests/helpers/article-from-dir.ts)
 * where the evals and the suites that still want a folder can reach it and the
 * server cannot. docs/plans/260831b-finish-the-database-move.md § sub-stage I.
 */
import { stageFailure } from "./job-failure.js";
import type { ArtifactReads } from "./store/artifacts.js";
import type { Block, Meta, Tree } from "./types.js";

export interface Article {
  slug: string;
  blocks: Block[];
  tree: Tree;
  /** `null` when the article has no metadata — a legitimate input, not an error. */
  meta: Meta | null;
}

/**
 * Read one from the store, refusing loudly when the article is not there.
 *
 * `"ours"` rather than a model or a fetch failure: nothing was refused by
 * anybody outside, we simply cannot find the artefacts this stage is defined
 * against.
 *
 * The sentence is a diagnostic and `{ generic }` says so: "run the hierarchy
 * step first" is addressed to whoever is running steps by hand, and a reader
 * gets `stepGaveUp`'s `ours` copy, which is the true thing to tell them —
 * src/job-failure.ts § `{ generic }`.
 */
export async function readArticle(slug: string, store: ArtifactReads): Promise<Article> {
  const article = await tryReadArticle(slug, store);
  if (!article) {
    throw stageFailure("ours", {
      generic: `No blocks or tree for "${slug}" — run the hierarchy step first.`,
    });
  }
  return article;
}

/**
 * The same read, answering `null` rather than throwing.
 *
 * **Two functions because there are two questions, and they take different
 * answers.** A stage's `run` cannot proceed without an article, so it gets the
 * one that refuses. A stage's `stamp` asks *what stamp would this step write if
 * it ran right now*, and an unreadable article there means **we cannot tell** —
 * which `stepIsDone` turns into not-current and a re-run. That is not the same
 * thing as a hash that fails to match, and it must not be a failed job: the
 * safe way to be wrong about currency is a model call.
 *
 * **The same three coordinates for both, and that is the point of the shared
 * function** — blocks and tree from `hierarchy`, metadata from `extract`. Read them
 * anywhere else and the fingerprint a stage records stops describing the bytes
 * it generated from.
 */
export async function tryReadArticle(slug: string, store: ArtifactReads): Promise<Article | null> {
  const file = await store.read(slug, "hierarchy", "blocks");
  const tree = await store.read(slug, "hierarchy", "tree");
  if (!file?.blocks || !tree) return null;
  const meta = await store.read(slug, "extract", "meta");
  return { slug, blocks: file.blocks, tree, meta: meta ?? null };
}
