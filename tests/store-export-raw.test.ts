/**
 * `db:export` must produce the raw document from wherever it now lives.
 *
 * ## The hole this exists to catch
 *
 * `writeRawDocument` reads `article_revisions.raw_bytes` and returns `[]` when
 * it is null — no `raw.html`, no `raw.json`, no error. That was right while the
 * payload was a `bytea` column. After docs/plans/delete-the-importer.md § C6 it
 * is a **reference**: `raw_source_sha256` plus `raw_source_kind`, with the bytes
 * in the `sources` bucket, and `raw_bytes` is null for everything the pipeline
 * writes. So the export silently stops exporting source documents, and the
 * signal is indistinguishable from an article that never had one — which is the
 * shape docs/reusable/silent-success.md is about, arriving in the one tool whose
 * whole job is "you can always get your data back out".
 *
 * The demolition drops the column outright, so this is not optional for long.
 *
 * ## Why it is built on the fixture loader rather than hand-built rows
 *
 * The point is that an article written **the way the pipeline writes one** comes
 * back out. A hand-built row with the reference columns filled in would prove
 * the export reads two columns; it would not prove that what the adapter writes
 * and what the export reads are the same thing. So the fixture goes in through
 * `loadArticleIntoPg` — `beginStep`/`write`/`finishStep` per step, then
 * `publishRevision` — exactly as tests/helpers/load-article.ts describes.
 *
 * The article is a **copy under a `test-` slug**, not one of the real fixtures.
 * A slug the database has never seen is the only honest fixture here:
 * `beginDraftIn` carries columns forward from the published revision, so an
 * article a previous `db:import` published can read back correct from columns
 * this path never wrote. That is not hypothetical — it faked a clean parity
 * result for `noema-mythology-of-conscious-ai` on 2026-08-28, and the plan's
 * § What the loader found records it.
 *
 * Skips loudly when there is no database — see tests/db-schema.test.ts.
 */

import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { articles, jobs } from "../src/db/schema.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { loadEnvLocal } from "../src/env.js";
import type { RawManifest } from "../src/fetch.js";
import { loadArticleIntoPg } from "./helpers/load-article.js";

loadEnvLocal();

const ROOT = path.resolve(import.meta.dirname, "..");

/** The source fixture: the smallest article with a real `raw.json` behind it. */
const FROM = "writes";
/** Ours, and `test-`-prefixed so the other suites' `data/` scans skip it. */
const SLUG = "test-export-raw";

let reachable = false;
let why = "";

if (process.env.DATABASE_URL) {
  const { Pool } = await import("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.raw_sources') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
  } catch (err) {
    reachable = false;
    why = `could not reach it: ${(err as Error).message}`;
  }
  await pool.end();
  if (!reachable) {
    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
  }
}

const when = reachable ? describe : describe.skip;

when("exporting an article whose bytes are in the bucket", () => {
  let out: string;
  let files: readonly string[] = [];
  /** `data/writes/raw.json`, the manifest stage 1 actually wrote. */
  let original: RawManifest;
  /** `data/writes/raw.html`, the bytes on disk. */
  let originalBytes: Buffer;

  beforeAll(async () => {
    original = JSON.parse(
      await readFile(path.join(ROOT, "data", FROM, "raw.json"), "utf8"),
    ) as RawManifest;
    originalBytes = await readFile(path.join(ROOT, "data", FROM, original.file));

    await forget();
    await cp(path.join(ROOT, "data", FROM), path.join(ROOT, "data", SLUG), { recursive: true });
    /* The artefacts name their own slug and the readers check it, so a copy
       that kept the old name would fail for a reason unrelated to the subject. */
    for (const name of await readdir(path.join(ROOT, "data", SLUG))) {
      if (!name.endsWith(".json")) continue;
      const at = path.join(ROOT, "data", SLUG, name);
      const value: unknown = JSON.parse(await readFile(at, "utf8"));
      if (value && typeof value === "object" && (value as { slug?: string }).slug === FROM) {
        (value as { slug: string }).slug = SLUG;
        await writeFile(at, JSON.stringify(value, null, 2));
      }
    }
    /* Two files in `output/`, not one. `stampedHtml` is `output/<slug>.html`
       and stage 3's `blocks` is `output/<slug>.blocks.json` — a different file
       from `data/<slug>/blocks.json`, which belongs to `toc`. Copy only the
       first and `copyArtefacts` refuses the whole article, correctly, for
       having some but not all of the `blocks` step's products. */
    await cp(path.join(ROOT, "output", `${FROM}.html`), path.join(ROOT, "output", `${SLUG}.html`));
    await cp(
      path.join(ROOT, "output", `${FROM}.blocks.json`),
      path.join(ROOT, "output", `${SLUG}.blocks.json`),
    );

    await loadArticleIntoPg(SLUG);

    out = await mkdtemp(path.join(tmpdir(), "spideryarn-export-raw-"));
    const { exportArticle } = await import("../src/store/export.js");
    const result = await exportArticle(SLUG, {
      dataRoot: path.join(out, "data"),
      outputRoot: path.join(out, "output"),
    });
    files = result.files;
  }, 120_000);

  /**
   * Files **and rows**, in both directions.
   *
   * The first version cleaned only `data/` and `output/`, and twenty-four
   * revisions of this fixture accumulated in the dev database — each run
   * minting a fresh draft from the last one's published revision. Beyond the
   * litter it makes the suite dishonest: a load whose `basedOn` is a previous
   * run is carrying columns forward, so an assertion about what *this* path
   * wrote could be answered by what the last run left. `beforeAll` clears it too,
   * because an interrupted run never reaches `afterAll`.
   */
  const forget = async () => {
    await rm(path.join(ROOT, "data", SLUG), { recursive: true, force: true });
    await rm(path.join(ROOT, "output", `${SLUG}.html`), { force: true });
    await rm(path.join(ROOT, "output", `${SLUG}.blocks.json`), { force: true });
    const db = getDb();
    await db.delete(jobs).where(eq(jobs.slug, SLUG));
    await db.update(articles).set({ currentRevisionId: null }).where(eq(articles.slug, SLUG));
    await db.delete(articles).where(eq(articles.slug, SLUG));
  };

  afterAll(async () => {
    await forget();
    if (out) await rm(out, { recursive: true, force: true });
    await closeDb();
  });

  it("proves the fixture really has no raw_bytes to fall back on", async () => {
    /* The subject is "the reference path works", and it would be untested if the
       row happened to carry the column as well. Asserted rather than assumed,
       because a fixture that quietly kept `raw_bytes` would make every other
       assertion in this file pass against the old code path. */
    const { getDb } = await import("../src/db/client.js");
    const { articleRevisions, articles } = await import("../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    /* Joined on `current_revision_id`, which is the row `exportArticle` reads —
       not every revision of the article. A load that fails partway leaves its
       draft behind (`openOrBeginJobDraft` commits the revision before the copy
       transaction runs), and an earlier red run of this very file left one, so
       a query over all revisions asserts about a row nothing will ever export. */
    const rows = await getDb()
      .select({
        rawBytes: articleRevisions.rawBytes,
        reference: articleRevisions.rawSourceSha256,
        kind: articleRevisions.rawSourceKind,
      })
      .from(articles)
      .innerJoin(articleRevisions, eq(articleRevisions.id, articles.currentRevisionId))
      .where(eq(articles.slug, SLUG));
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.rawBytes).toBeNull();
    expect(row?.reference).toBe(original.storedSha256);
    expect(row?.kind).toBe(original.kind);
  });

  it("writes the document itself, byte for byte", async () => {
    expect(files).toContain(original.file);
    const written = await readFile(path.join(out, "data", SLUG, original.file));
    expect(written.byteLength).toBe(originalBytes.byteLength);
    expect(createHash("sha256").update(written).digest("hex")).toBe(original.storedSha256);
  });

  it("writes a manifest a re-import can actually use", async () => {
    expect(files).toContain("raw.json");
    const back = JSON.parse(
      await readFile(path.join(out, "data", SLUG, "raw.json"), "utf8"),
    ) as RawManifest;

    /* **The two stored fields, and this is the assertion with teeth.** Without
       them the adapter refuses the manifest outright (`NoStoredDocument`), so an
       export that dropped them would produce a directory `db:import`'s
       replacement cannot load — a round trip that looks complete and is not. */
    expect(back.storedSha256).toBe(original.storedSha256);
    expect(back.storedBytes).toBe(original.storedBytes);

    expect(back.kind).toBe(original.kind);
    expect(back.file).toBe(original.file);
    expect(back.bytes).toBe(original.bytes);
    expect(back.url).toBe(original.url);
    expect(back.requestedUrl).toBe(original.requestedUrl);
  });
  /**
   * **A store that answers wrongly, so the two refusals can be seen to fire.**
   *
   * They guard the case the reference path made possible and the column path
   * never could: a row asserting an object exists when it does not, or when it
   * is not what its key says. Neither can arise from the fixtures — the bucket
   * has the real object — so without an injected store both would be claims in
   * a comment. `exportArticle` takes the store for exactly this reason.
   */
  const storeThat = (get: RawSourceStore["get"]): RawSourceStore => ({
    get,
    head: async () => null,
    putIfAbsent: async () => "already-there",
    remove: async () => {},
  });

  it("refuses when the bucket has no such object, rather than exporting nothing", async () => {
    const { exportArticle, MissingRawObject } = await import("../src/store/export.js");
    const to = await mkdtemp(path.join(tmpdir(), "spideryarn-export-missing-"));
    try {
      await expect(
        exportArticle(
          SLUG,
          { dataRoot: path.join(to, "data"), outputRoot: path.join(to, "output") },
          storeThat(async () => null),
        ),
      ).rejects.toThrow(MissingRawObject);
      /* And it must not have written a manifest first. A `raw.json` beside no
         document is the shape a later import would read as a real fetch. */
      const left = await readdir(path.join(to, "data", SLUG)).catch(() => [] as string[]);
      expect(left).not.toContain("raw.json");
      expect(left).not.toContain(original.file);
    } finally {
      await rm(to, { recursive: true, force: true });
    }
  });

  it("refuses when the object is not what its key says", async () => {
    const { exportArticle, CorruptRawObject } = await import("../src/store/export.js");
    const to = await mkdtemp(path.join(tmpdir(), "spideryarn-export-corrupt-"));
    try {
      await expect(
        exportArticle(
          SLUG,
          { dataRoot: path.join(to, "data"), outputRoot: path.join(to, "output") },
          /* The right *length*, deliberately: a guard that only caught a size
             change would pass this and still be worthless, since the key is a
             digest and the thing it protects against is substitution. */
          storeThat(async () => new Uint8Array(originalBytes.byteLength).fill(0x41)),
        ),
      ).rejects.toThrow(CorruptRawObject);
    } finally {
      await rm(to, { recursive: true, force: true });
    }
  });
});
