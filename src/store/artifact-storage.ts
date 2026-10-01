/**
 * **Where every pipeline artefact lives in Postgres** — the `STORAGE` map, on
 * its own.
 *
 * It lived in src/store/artifacts-pg.ts until 2026-09-28, and moved here for a
 * structural reason rather than a tidy one: src/reset.ts has to read it to know
 * which `article_revisions` columns each *extra* step owns, and
 * src/store/pg-revisions.ts has to read src/reset.ts to drop those columns from
 * a reset's draft. artifacts-pg.ts imports pg-revisions.ts, so reading the map
 * from there would have been a cycle (`npm run cycles`). This file imports
 * nothing but types, so anything can reach it; artifacts-pg.ts re-exports the
 * names so none of its callers had to move.
 * docs/plans/260928a-reset-and-regenerate-article.md.
 */

import type { StepName } from "../types.js";
import type { ArtifactKind } from "./artifacts.js";

/** A column of `article_revisions` that holds one whole artefact. */
export type WholeColumn =
  | "extractedHtml"
  | "stampedHtml"
  | "tree"
  | "labels"
  | "assets"
  | "arc"
  | "tweets"
  | "glossary"
  | "ideas"
  | "quotes"
  | "timeline"
  | "quiz"
  | "faq"
  | "skim"
  | "sketch"
  | "illustrated"
  | "debate"
  | "citations"
  | "crossrefs"
  | "simpleSummary";

/**
 * Where one `(step, kind)` lives in Postgres.
 *
 * Three shapes rather than one, because two artefacts are not a column:
 * `blocks` is a table, and `meta` and `raw` are each several columns that have
 * to be reassembled into the object the pipeline knows.
 */
export type Site =
  | { readonly at: "column"; readonly column: WholeColumn }
  | { readonly at: "blocks" }
  | { readonly at: "assembled"; readonly of: "meta" | "raw" };

/**
 * Every place this project puts a pipeline artefact in Postgres. **The one
 * place** — until 2026-09-05 it was also the exact counterpart of `PATHS` in
 * src/store/artifacts-fs.ts; now that file is gone, this is the only such
 * table there is.
 *
 * Keyed by step and then by kind, for the same reason that one is: `blocks`
 * appears under two steps and the HTML appears as two kinds. The keys of the
 * two maps must match exactly, step for step and kind for kind, or one store
 * silently knows about an artefact the other does not —
 * tests/store-artefacts-pg.test.ts compares them, which is a parity oracle
 * that is not the importer.
 */
export const STORAGE: {
  [S in StepName]: Partial<Record<ArtifactKind, Site>>;
} = {
  fetch: {
    /** Six columns and a derived filename — see `readRawManifest`. */
    raw: { at: "assembled", of: "raw" },
  },
  /**
   * **`meta`, the same site `extract` writes** — a minimal paper's title,
   * authors, byline, abstract and DOI, assembled into the revision's meta
   * columns. Two steps over one site, as `blocks`/`hierarchy` share the block
   * rows; each step's own run row keeps their doneness apart.
   */
  metadata: { meta: { at: "assembled", of: "meta" } },
  extract: {
    /**
     * **Its own column, unlike the filesystem**, where stage 3 overwrites this
     * with the stamped HTML and the original is simply gone. `db:import`
     * records that loss by storing null here; the pipeline writing through this
     * store does not have to.
     */
    extractedHtml: { at: "column", column: "extractedHtml" },
    meta: { at: "assembled", of: "meta" },
  },
  blocks: {
    blocks: { at: "blocks" },
    stampedHtml: { at: "column", column: "stampedHtml" },
  },
  hierarchy: {
    tree: { at: "column", column: "tree" },
    labels: { at: "column", column: "labels" },
    /**
     * **The same rows as `blocks`/`blocks` above**, not a second copy.
     *
     * On disk these are two files on purpose: stage 3 checks its own so a
     * `{ steps: ["blocks"] }` job can skip itself, and stage 4 writes a copy so
     * the tree and the blocks it was built from are guaranteed to be a pair.
     * One table cannot express the first and does not need the second — there
     * is one set of rows and it is the article's blocks.
     */
    blocks: { at: "blocks" },
  },
  /**
   * **The same two sites as `hierarchy` above**, in the sense `blocks`/`blocks`
   * and `hierarchy`/`blocks` already are: one column each, written by two steps.
   *
   * Stage 4 writes the tree and a `PendingLabelsFile`; this step writes the tree
   * again with the labels merged into its leaves, and the completed manifest
   * beside it. Sharing a site does not share doneness — `hasArtefacts` asks the
   * asking step's own run row first — and tests/shared-site-run-row-gate.test.ts
   * is what pins that.
   */
  labels: {
    labels: { at: "column", column: "labels" },
    tree: { at: "column", column: "tree" },
  },
  /* One column, like the arc — the manifest is a document, and the objects it
     names live in the `sources` bucket rather than in a table. There is
     deliberately no `raw_sources` row per image: that table exists so
     `article_revisions` can foreign-key to *the document*, and an image is not
     the document. docs/plans/260829b-hosting-the-articles-images.md § Where the bytes go. */
  assets: { assets: { at: "column", column: "assets" } },
  arc: { arc: { at: "column", column: "arc" } },
  tweets: { tweets: { at: "column", column: "tweets" } },
  glossary: { glossary: { at: "column", column: "glossary" } },
  ideas: { ideas: { at: "column", column: "ideas" } },
  quotes: { quotes: { at: "column", column: "quotes" } },
  timeline: { timeline: { at: "column", column: "timeline" } },
  quiz: { quiz: { at: "column", column: "quiz" } },
  faq: { faq: { at: "column", column: "faq" } },
  skim: { skim: { at: "column", column: "skim" } },
  sketch: { sketch: { at: "column", column: "sketch" } },
  illustrated: { illustrated: { at: "column", column: "illustrated" } },
  debate: { debate: { at: "column", column: "debate" } },
  citations: { citations: { at: "column", column: "citations" } },
  crossrefs: { crossrefs: { at: "column", column: "crossrefs" } },
  /* The kind is the step's name, as every other kind here is — it is also the
     URL segment (`/api/simple/`), which tests/cacheable-covers-artefact-routes.test.ts
     derives from the kind. The column is named for what it holds. */
  simple: { simple: { at: "column", column: "simpleSummary" } },
};

/** The site for one `(step, kind)`, or a clear error rather than `undefined`. */
export function siteFor(step: StepName, kind: ArtifactKind): Site {
  const site = STORAGE[step]?.[kind];
  if (!site) throw new Error(`${step} does not produce ${kind}`);
  return site;
}
