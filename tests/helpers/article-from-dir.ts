/**
 * **The three files an article is, read straight off a directory** — for the
 * evals and the suites that have a folder and no store.
 *
 * This used to live in [`src/article-input.ts`](../../src/article-input.ts)
 * beside `readArticle`, with a comment saying *"nothing in a request path or a
 * queued job may call it"*. A comment is not a mechanism. Stage 4 sub-stage I
 * deleted the eight stage CLIs that were its production callers, and moving
 * what is left out of `src/` makes that rule **structural**: a request handler
 * cannot reach `tests/` without somebody noticing.
 *
 * ## Why the callers that remain want a directory rather than a slug
 *
 * They are all measurements, and a measurement needs **pinned inputs**. A slug
 * in a local Postgres is whatever the last ingest left there, so last week's
 * number and this week's would not be about the same article. The committed
 * corpus under `tests/fixtures/data-root/data/<slug>/` carries exactly the
 * triple this function reads and it is tracked in git, so the bytes are the
 * same on every machine and in every week — `./require-fixture.ts` for the
 * corpus seam, and docs/plans/260901b-committed-fixture-corpus.md for why it
 * exists at all.
 *
 * `evals/reorder-quality.ts` needs the folder for a second reason: its whole
 * workflow is `cp -r <dir> /tmp/before` and then `--against /tmp/before`, which
 * only works because an article on disk is a thing you can copy and hand-edit.
 *
 * ## `meta` is nullable and that is a real state, not a failure
 *
 * Every stage that takes an `Article` tolerates one with no `meta.json` on
 * purpose; the head of the prompt simply loses its lines
 * ([`src/article-prompt.ts`](../../src/article-prompt.ts) § `articleText`).
 * The blocks and the tree are not optional: an article with neither is nothing
 * to be about. `data/constitution` in the corpus has no `raw.json` and is still
 * a legitimate fixture, for the same reason.
 *
 * `slug` comes from the directory's own name, which is what the pipeline calls
 * the article too — `sketch` stamps it into the picture it returns.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseJsonFrom } from "../../src/parse-json.js";
import type { Article } from "../../src/article-input.js";
import type { Block, Meta, Tree } from "../../src/types.js";

/** Read `blocks.json`, `tree.json` and (if it is there) `meta.json` from `dir`. */
export async function readArticleFromDir(dir: string): Promise<Article> {
  const { blocks } = parseJsonFrom<{ blocks: Block[] }>(
    await readFile(path.join(dir, "blocks.json"), "utf-8"),
    "blocks.json",
  );
  const tree = parseJsonFrom<Tree>(
    await readFile(path.join(dir, "tree.json"), "utf-8"),
    "tree.json",
  );
  const meta: Meta | null = await readFile(path.join(dir, "meta.json"), "utf-8")
    .then((raw) => JSON.parse(raw) as Meta)
    .catch(() => null);
  return { slug: path.basename(dir), blocks, tree, meta };
}
