/**
 * A re-import must replace the WHOLE revision row, and must not leave a step
 * saying "done" for an artefact that has gone.
 *
 * Two bugs, one fixture, because both are the same mistake in two places: the
 * importer writes some of what the files say and keeps the rest of what it
 * wrote last time.
 *
 * ## The revision id is the identity of an EXTRACTION, not of a file tree
 *
 * `revisionId = derivedUuid("revision", slug, hashBlocks(blocks))`, so changing
 * only `meta.json` — a corrected title, a byline that was missing, the final
 * URL after a redirect — hashes to the same revision and takes the
 * `on conflict do update` branch. That branch listed twelve columns out of
 * twenty-five, so the title stayed on the first run's value for ever while the
 * tree beside it updated. GPT Sol found it in review, 2026-08-26.
 *
 * ## And the steps
 *
 * `revision_step_runs` rows are inferred from "the artefact is on disk". A step
 * whose artefact is deleted kept its `done` row, so the metadata page went on
 * reporting an `arc` that no longer exists. The importer now removes the rows
 * it inferred — and only those, so that a real pipeline record is never
 * destroyed by a migration tool.
 *
 * The fixture is `_`-prefixed for the reason
 * tests/store-import-convergence.test.ts explains: `importableSlugs` and
 * tests/store-parity.test.ts both skip `_`, so a fixture they COULD see is a
 * fixture that makes them flaky.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articleRevisions, articles, revisionStepRuns } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { importArticle } from "../src/store/import.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");
const SLUG = "_test-import-revision";
const DIR = path.join(ROOT, "data", SLUG);
const BLOCK_ID = "spya-rev222";

const { reachable } = await pgReady({
  suite: "tests/store-import-revision.test.ts",
  tables: ["spideryarn.article_revisions"],
});

const when = reachable ? describe : describe.skip;

const write = (name: string, value: unknown) =>
  writeFile(path.join(DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");

/** The two artefacts an import refuses to run without, and nothing else. */
async function writeSpine(): Promise<void> {
  await write("blocks.json", {
    blocks: [
      {
        id: BLOCK_ID,
        tag: "p",
        kind: "text",
        text: "a paragraph",
        words: 2,
        html: `<p id="${BLOCK_ID}">a paragraph</p>`,
        gistable: true,
      },
    ],
  });
  await write("tree.json", {
    version: "toc/1",
    generator: "fixture",
    slug: SLUG,
    rootId: "n0001",
    nodes: {
      n0001: {
        id: "n0001",
        depth: 0,
        parent: null,
        children: [],
        range: [BLOCK_ID, BLOCK_ID],
        title: "A fixture",
        gist: "A fixture article that exists only for this test.",
      },
    },
  });
}

async function revisionRow() {
  const db = getDb();
  const rows = await db
    .select({ article: articles, revision: articleRevisions })
    .from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
    .where(eq(articles.slug, SLUG))
    .limit(1);
  return rows[0];
}

when("re-importing an article whose blocks have not changed", () => {
  beforeAll(async () => {
    await mkdir(DIR, { recursive: true });
    await writeSpine();
    await write("meta.json", {
      slug: SLUG,
      title: "The first title",
      byline: "A. Writer",
      siteName: "First Site",
      excerpt: "the first excerpt",
      url: "https://example.com/first",
      fetchedAt: "2026-08-01T00:00:00Z",
    });
    await write("arc.json", { version: "arc/1", generator: "fixture", slug: SLUG, entries: [] });
    /* A manifest, because it is what makes the content type and the encoding
       recoverable at all. src/store/import.ts's own comment said so and the
       insert wrote `null` for both anyway. */
    await write("raw.json", {
      kind: "html",
      file: "raw.html",
      requestedUrl: "https://example.com/first?utm_source=x",
      url: "https://example.com/first",
      contentType: "text/html; charset=iso-8859-1",
      encoding: "iso-8859-1",
      bytes: 11,
      sha256: null,
      fetchedAt: "2026-08-01T00:00:00Z",
    });
    await writeFile(path.join(DIR, "raw.html"), "<p>hello</p>", "utf8");
    await importArticle(SLUG);
  }, 30_000);

  afterAll(async () => {
    const db = getDb();
    const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, SLUG));
    const id = rows[0]?.id;
    if (id) {
      // The pointer has to let go before the revision can cascade away — the
      // same order tests/store-import-convergence.test.ts works out at length.
      await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.id, id));
      await db.delete(articles).where(eq(articles.id, id));
    }
    await closeDb();
    await rm(DIR, { recursive: true, force: true });
  });

  it("replaces the metadata columns, keeping the same revision", async () => {
    const before = await revisionRow();
    expect(before?.revision.title).toBe("The first title");

    await write("meta.json", {
      slug: SLUG,
      title: "The corrected title",
      byline: "B. Editor",
      siteName: "Second Site",
      excerpt: "the corrected excerpt",
      url: "https://example.com/second",
      fetchedAt: "2026-08-01T00:00:00Z",
    });
    await importArticle(SLUG);

    const after = await revisionRow();
    /* The same revision, because the blocks are the same extraction. If this
       ever stops being true the fix went the other way — a new revision per
       metadata edit — and everything below needs rethinking rather than
       renumbering. */
    expect(after?.revision.id).toBe(before?.revision.id);

    // Every column the update branch used to leave behind.
    expect(after?.revision.title).toBe("The corrected title");
    expect(after?.revision.byline).toBe("B. Editor");
    expect(after?.revision.siteName).toBe("Second Site");
    expect(after?.revision.excerpt).toBe("the corrected excerpt");
    expect(after?.revision.finalUrl).toBe("https://example.com/second");
  }, 30_000);

  it("records the content type and encoding the manifest recovered", async () => {
    /* Not a nicety: src/store/import.ts's header says a manifest recovers these
       and reports them as unrecoverable only when there is none — while the
       insert hardcoded `null` for both, so the honest-sounding comment
       described something the code never did. */
    const row = await revisionRow();
    expect(row?.revision.rawContentType).toBe("text/html; charset=iso-8859-1");
    expect(row?.revision.rawEncoding).toBe("iso-8859-1");
    // The requested URL is the manifest's, not `meta.url` — they differ after a
    // redirect, and only the manifest ever knew the difference.
    expect(row?.revision.requestedUrl).toBe("https://example.com/first?utm_source=x");
  }, 30_000);

  it("drops the step row for an artefact that has been deleted", async () => {
    const revision = (await revisionRow())?.revision;
    expect(revision).toBeDefined();
    const db = getDb();
    const steps = async () => {
      const rows = await db
        .select({ step: revisionStepRuns.stepName })
        .from(revisionStepRuns)
        .where(eq(revisionStepRuns.revisionId, revision!.id));
      return rows.map((r) => r.step).sort();
    };

    expect(await steps()).toContain("arc");

    await rm(path.join(DIR, "arc.json"), { force: true });
    await importArticle(SLUG);

    const after = await steps();
    expect(after).not.toContain("arc");
    // Not vacuous: the steps whose artefacts are still there must survive.
    expect(after).toEqual(expect.arrayContaining(["blocks", "toc", "extract", "fetch"]));
    // And the column itself is cleared, not just the step row.
    expect((await revisionRow())?.revision.arc).toBeNull();
  }, 30_000);

  it("leaves a step row it did not infer alone", async () => {
    /* The reconciling delete is scoped to `implementation_version = 'imported'`,
       which is the importer saying "I only clean up after myself". Post-cutover
       the pipeline owns this table and its `done` row for a step whose FILE is
       gone is correct — the file stopped being the truth. A migration tool must
       not be able to delete that. */
    const revision = (await revisionRow())?.revision;
    const db = getDb();
    await db
      .insert(revisionStepRuns)
      .values({
        revisionId: revision!.id,
        stepName: "glossary",
        inputHash: "not-the-fingerprint",
        implementationVersion: "pipeline-1",
        status: "done",
      })
      .onConflictDoNothing();

    // No glossary.json has ever existed here, so the importer would infer nothing.
    await importArticle(SLUG);

    const rows = await db
      .select({ version: revisionStepRuns.implementationVersion })
      .from(revisionStepRuns)
      .where(
        and(
          eq(revisionStepRuns.revisionId, revision!.id),
          eq(revisionStepRuns.stepName, "glossary"),
        ),
      );
    expect(rows.map((r) => r.version)).toEqual(["pipeline-1"]);
  }, 30_000);
});
