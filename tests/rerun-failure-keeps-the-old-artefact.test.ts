/**
 * **A re-run that fails leaves the reader on the artefact they already had.**
 *
 * This is the guarantee the "Generate it again" control on the Metadata page
 * sells — docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md
 * § What must not happen. A reader who presses *Choose them again* and watches
 * it fail must still have the quotes they had before they pressed. If that is
 * not true, the button is a way to lose work, and nothing on the page could say
 * so.
 *
 * The mechanism was in place long before this feature and is not in doubt. What
 * was missing is a test: *"a check you have never seen fail is not evidence"*
 * (docs/reusable/silent-success.md), and this is the one guarantee the feature
 * is built on. So it is asserted here rather than assumed in a plan doc.
 *
 * ## Why `quotes` rather than `glossary`
 *
 * Both are ordinary JSONB artefacts on `article_revisions` and either would
 * do. `loadQuotes` reads the published revision and returns it; `loadGlossary`
 * joins per-entry lookups on the way out, and none of that is under test here.
 * The narrower reader is the one that cannot pass for the wrong reason.
 *
 * ## Why the reader's own path, not the column
 *
 * The assertion is `loadQuotes(slug)` — the same function `GET /api/quotes/:slug`
 * calls (src/store/index.ts) — rather than a `select` on the draft's column.
 * What matters is not that the draft row still holds something; it is that the
 * reader is served the old value. Reading the column would pass even if
 * `current_revision_id` had moved to the failed draft, which is the exact
 * failure this exists to catch.
 *
 * ## How to watch these go red
 *
 * Both were watched failing before they were kept, by editing
 * `failRevisionIn` (src/store/pg-revisions.ts) and putting the two edits back
 * afterwards:
 *
 *  - *"a failed re-run leaves the published quotes in place"* — add
 *    `set({ currentRevisionId: opts.revisionId })` on `articles` inside
 *    `failRevisionIn`, i.e. make giving up on a draft publish it. The test then
 *    reports the new quotes.
 *  - *"refuses to fail the revision the article is serving"* — the same edit.
 *    Removing the guard leaves the call resolving where it should reject, and
 *    the article pointing at a revision marked failed. (One sabotage, two red
 *    tests: they are separate assertions because the pointer moving and the
 *    guard not firing are different faults with the same symptom.)
 *  - *"marks the abandoned draft failed, and keeps it"* — change the
 *    `.update(articleRevisions).set({ status: "failed" })` to a `.delete(…)`.
 *    The reader-facing assertions stay green, which is the point of keeping
 *    this one: losing the evidence of what failed is invisible from outside.
 *
 * Skips loudly when there is no database — tests/db-schema.test.ts says why at
 * length: a skipped test protects nothing, so the run must say "skipped" rather
 * than "passed".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, blockIdentities, revisionBlocks } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { hashBlocks } from "../src/source-hash.js";
import { loadQuotes } from "../src/store/index.js";
import { beginRevision, failRevision, publishRevision, recordStepRun } from "../src/store/pg-revisions.js";
import { PIPELINE_RUN } from "../src/store/revisions.js";
import type { Block, Quotes, Tree } from "../src/types.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* Its own slug. The neighbouring publication-guard suite owns
   `test-publish-guards`, and two suites sharing an article would each see the
   other's revisions as their own history. */
const SLUG = "test-rerun-failure";

await pgReady({
  suite: "tests/rerun-failure-keeps-the-old-artefact.test.ts",
  tables: ["spideryarn.article_revisions"],
});

/* ------------------------------------------------------------- the article -- */

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.trim().split(/\s+/).filter(Boolean).length,
    html: `<p id="${id}">${text}</p>`,
    gistable: true,
  };
}

const BLOCKS: Block[] = [
  block("spya-rfaaa2", "The opening paragraph of an article that exists only for this test."),
  block("spya-rfaaa3", "The closing paragraph, which says nothing either."),
];

const HASH = hashBlocks(BLOCKS);

/** One root over one leaf per block — the smallest shape `checkTree` accepts. */
const TREE: Tree = {
  version: "toc/1",
  generator: "fixture",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1", "n2"],
      range: [BLOCKS[0]!.id, BLOCKS[1]!.id],
      title: "A fixture article",
      gist: "A fixture built by tests/rerun-failure-keeps-the-old-artefact.test.ts and nothing else.",
    },
    ...Object.fromEntries(
      BLOCKS.map((b, i) => [
        `n${i + 1}`,
        {
          id: `n${i + 1}`,
          depth: 1,
          parent: "n0",
          children: [],
          range: [b.id, b.id],
          title: "A paragraph",
          navLabel: "One paragraph of a fixture article that exists only for this test",
        },
      ]),
    ),
  },
} as Tree;

/**
 * The two artefacts, distinguishable by one word.
 *
 * `KEPT` is what the reader had before they pressed; `LOST` is what the failed
 * re-run wrote into its draft. The assertion is that the reader is served the
 * first and never the second — so the only thing that has to differ between
 * them is something a test can see.
 */
function quotes(marker: string): Quotes {
  return {
    version: "quotes/3",
    generator: "fixture",
    slug: SLUG,
    sourceHash: HASH,
    quotes: [{ id: `q-${marker}`, blockId: BLOCKS[0]!.id, text: marker, why: marker }],
  } as unknown as Quotes;
}

const KEPT = quotes("kept");
const LOST = quotes("lost");

async function writeBlocks(articleId: string, revisionId: string): Promise<void> {
  const db = getDb();
  await db
    .insert(blockIdentities)
    .values(BLOCKS.map((b) => ({ articleId, blockId: b.id })))
    .onConflictDoNothing();
  await db.delete(revisionBlocks).where(eq(revisionBlocks.revisionId, revisionId));
  await db.insert(revisionBlocks).values(
    BLOCKS.map((b, i) => ({
      articleId,
      revisionId,
      blockId: b.id,
      ordinal: i,
      tag: b.tag,
      kind: b.kind,
      level: b.level ?? null,
      text: b.text,
      words: b.words,
      html: b.html,
      gistable: b.gistable,
      note: b.note ?? null,
    })),
  );
}

/**
 * A draft complete enough to publish, carrying whatever quotes it is given.
 *
 * The quotes go in with a `db.update` rather than through `writeArtefacts`,
 * which would want a live job owning the draft. That machinery is not what is
 * under test: this suite is about what `failRevision` does to a draft that
 * already holds something, and the column is the same column either way.
 */
async function draft(withQuotes: Quotes | null): Promise<string> {
  const { articleId, revisionId } = await beginRevision({ slug: SLUG });
  await writeBlocks(articleId, revisionId);
  await getDb()
    .update(articleRevisions)
    .set({ title: "A fixture article", tree: TREE, ...(withQuotes ? { quotes: withQuotes } : {}) })
    .where(eq(articleRevisions.id, revisionId));
  await recordStepRun({
    revisionId,
    stepName: "hierarchy",
    inputHash: HASH,
    implementationVersion: PIPELINE_RUN,
    status: "done",
    startedAt: new Date(),
    finishedAt: new Date(),
  });
  return revisionId;
}

async function currentRevisionId(): Promise<string | null> {
  const rows = await getDb()
    .select({ current: articles.currentRevisionId })
    .from(articles)
    .where(eq(articles.slug, SLUG));
  return rows[0]?.current ?? null;
}

/* -------------------------------------------------------------------- tests -- */

describe("a re-run that fails", () => {
  /** The revision the reader is on before any of these tests presses anything. */
  let published = "";

  beforeAll(async () => {
    const revisionId = await draft(KEPT);
    await publishRevision({ slug: SLUG, revisionId });
    published = revisionId;
  }, 60_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      // The pointer lets go first, or the revision cannot cascade away.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
  });

  it("leaves the reader on the quotes they already had", async () => {
    /* Belt and braces: if this is already wrong the rest of the test proves
       nothing, and the failure should name the setup rather than the guarantee. */
    expect((await loadQuotes(SLUG)).quotes.quotes[0]?.text).toBe("kept");

    /* The re-run: a new draft, carrying the published quotes forward, into
       which the step writes its new answer — and then the step fails. */
    const attempt = await draft(LOST);
    await failRevision({ slug: SLUG, revisionId: attempt, reason: "the step threw" });

    const after = await loadQuotes(SLUG);
    expect(after.quotes.quotes[0]?.text).toBe("kept");
    /* Said separately, because the reader-path assertion above would also pass
       if the pointer had moved to a draft that happened to hold the old value.
       This is the fact `failRevision`'s docstring promises: it never touches
       `articles.current_revision_id`. */
    expect(await currentRevisionId()).toBe(published);
  });

  it("marks the abandoned draft failed, and keeps it", async () => {
    const attempt = await draft(LOST);
    await failRevision({ slug: SLUG, revisionId: attempt, reason: "the step threw" });

    /* Kept rather than deleted — it is the evidence of what failed, and
       `sweepAbandonedDrafts` is what reclaims it later. A test that only
       asserted the reader's view would pass over a `DELETE`, and then the next
       person to look for why a re-run failed would find nothing. */
    const rows = await getDb()
      .select({ status: articleRevisions.status })
      .from(articleRevisions)
      .where(eq(articleRevisions.id, attempt));
    expect(rows[0]?.status).toBe("failed");
  });

  it("refuses to fail the revision the article is serving", async () => {
    /* The guard that makes the first test's guarantee unconditional rather than
       incidental. Without it, a mis-aimed failure — a stale worker settling a
       job whose draft has since been published — would mark the live revision
       failed, and the article would be serving a revision the store believes
       is broken. */
    await expect(
      failRevision({ slug: SLUG, revisionId: published, reason: "aimed at the wrong revision" }),
    ).rejects.toThrow();

    expect(await currentRevisionId()).toBe(published);
    expect((await loadQuotes(SLUG)).quotes.quotes[0]?.text).toBe("kept");
  });
});
