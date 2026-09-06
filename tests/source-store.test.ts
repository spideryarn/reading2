/**
 * **`GET /api/source/:slug` had to join the store selection**, and this is the
 * evidence that it has.
 *
 * Until 2026-08-31 `sendSource` in src/routes.ts authorised through the store
 * and then read the bytes off the disk itself — `fsLocations(slug)`,
 * `readRaw(dir)`, `readFile(...)` — whatever `SPIDERYARN_STORE` said. It was the
 * one unconditional filesystem read left in that file, found twice
 * independently: by GPT Sol reviewing docs/plans/260831b-finish-the-database-move.md,
 * and by the code inventory in that plan (§ *What the inventory found*).
 *
 * Two things were wrong with it, and only one of them is tidiness:
 *
 * 1. Under `SPIDERYARN_STORE=postgres` the article's rows are in Postgres and
 *    its source document is an object in the `sources` bucket. Reading
 *    `data/<slug>/raw.pdf` finds nothing and answers **404 for a PDF that
 *    exists** — an article reported as sourceless, which is what
 *    docs/reusable/silent-success.md is about.
 * 2. Deployed, it was a **jobless caller of `dataRoot()`**, which had two wrong
 *    answers available in that state and deliberately threw instead, so the
 *    route 500'd.
 *
 * ## The two sections, and why the first one is a grep
 *
 * 1. **The route reaches the seam** — read out of src/routes.ts's own text.
 *    There is no type that can say "this function does not touch the disk", and
 *    the failure guarded against is somebody writing a perfectly well-typed
 *    `readFile`. It is the same instrument, for the same reason, as the ordering
 *    guard in tests/owner-isolation.test.ts, which this pairs with.
 * 2. **The Postgres adapter** serves the reference-backed source, refuses a
 *    dangling one rather than reporting the article sourceless, and answers a
 *    stranger with nothing.
 *
 * ## The section that stood between them until 2026-09-05
 *
 * **The filesystem adapter**, doing exactly what the route used to do against a
 * scratch `SPIDERYARN_DATA_ROOT`: six cases over `fsSourceStore.readPdf`. It was
 * the parity arm of a two-store suite, and it went with `src/store/artifacts-fs.ts`
 * when Postgres became the only store
 * (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
 * Every claim it made has a counterpart in section 2 below, asked of the store
 * that is left: the bytes come back, the uploaded filename comes back with them,
 * a web page answers `null`, an article with no source answers `null`, a slug
 * nobody has answers `null`, and a reference that names a document which is not
 * there is a **fault** rather than an answer.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { canonicalKey } from "../src/source.js";
import type { BlobHead, RawSourceStore } from "../src/store/blobs.js";
import { createPgSourceStore, sourceReferenceQuery } from "../src/store/pg-source.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/* ------------------------------------------ 1. the route reaches the seam -- */

const routes = await readFile(
  fileURLToPath(new URL("../src/routes.ts", import.meta.url)),
  "utf8",
);

/**
 * **Comments stripped first**, the same way tests/owner-isolation.test.ts's
 * store sweep does it and for the same reason it says: this function's own
 * comment explains what it used to do and names `fsLocations` while doing it. A
 * guard that fires on its own documentation teaches the next person to delete
 * the documentation.
 */
const code = routes.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sendSource = /async function sendSource\([\s\S]*?\n}/.exec(code)?.[0] ?? "";

describe("the source route", () => {
  const body = sendSource;

  it("has a body this test can actually read", () => {
    /* A regex that stopped matching would make every assertion below pass
       against an empty string — the guard reporting success for having checked
       nothing. */
    expect(body).toContain("res.statusCode = 200");
  });

  it("asks the store for the document rather than the disk", () => {
    expect(body).toContain("sourceStore.readPdf(slug)");
  });

  /**
   * **The whole point of the change**, and the assertion that was red.
   *
   * `readFile` is `node:fs/promises`, and a call to it inside this function
   * means the route serves files rather than asking the store.
   *
   * It also named `fsLocations(` and `readRaw(` — the filesystem store's path
   * function and its manifest reader, which are what this route actually called
   * until 2026-08-31. Both were deleted with `src/store/artifacts-fs.ts` on
   * 2026-09-05, and an assertion that a function which no longer exists is not
   * called is one nothing can ever redden. `readFile` is the one of the three
   * that is still reachable, so it is the one that stayed.
   */
  it("does not read the filesystem itself", () => {
    expect(body).not.toContain("readFile(");
  });

  /**
   * And the ordering that tests/owner-isolation.test.ts pins, restated at the
   * new seam: **authorise, then move bytes.**
   */
  it("authorises before it asks for a byte", () => {
    expect(body.indexOf("shelfStore.read(slug)")).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("shelfStore.read(slug)")).toBeLessThan(
      body.indexOf("sourceStore.readPdf(slug)"),
    );
  });

  /**
   * Nothing else in routes.ts reaches for the disk.
   *
   * This named `fsLocations` too, and stopped being able to on 2026-09-05 for
   * the reason above. What is left is the wider and still-falsifiable claim:
   * **no `node:fs` or `node:path` at all**. The one filesystem read this file
   * ever had was this route, so an import of either is a route going round the
   * store again.
   */
  it("and routes.ts does not reach for the filesystem at all", () => {
    expect(code).not.toContain('from "node:fs/promises"');
    expect(code).not.toContain('from "node:path"');
  });
});

/* ----------------------------------------------- 2. the Postgres adapter -- */

const SLUG = "test-source-store";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c4";
const REVISION_ID = "00000000-0000-4000-8000-0000000000c5";
/** Nobody. Never inserted under — only ever asked with. */
const OUTSIDER = "00000000-0000-4000-8000-0000000000c8" as OwnerId;

/**
 * **The web page, which is the negative control.**
 *
 * GPT Sol's third review, 2026-08-31: every fixture here was a PDF, so an
 * implementation that returned referenced HTML bytes would have passed the whole
 * suite. That is the one assertion this file cannot do without — the content
 * type is the security boundary the `readPdf`-not-`readSource` decision rests on
 * (src/store/contracts.ts § SourceStore), and an HTML source served from our own
 * origin is stored XSS. A guard nothing can redden is not a guard.
 *
 * There were two of these until 2026-09-01, because there were two kind checks
 * reading different columns: `raw_source_kind` on the reference path, `source`
 * on the legacy `raw_bytes` one. The column is gone and so is its guard.
 */
const HTML_SLUG = "test-source-store-webpage";
const HTML_ARTICLE_ID = "00000000-0000-4000-8000-0000000000c9";
const HTML_REVISION_ID = "00000000-0000-4000-8000-0000000000ca";

/** An article whose revision names no object. Inserted by the test that uses it. */
const SOURCELESS_SLUG = "test-source-store-sourceless";
const SOURCELESS_ARTICLE_ID = "00000000-0000-4000-8000-0000000000cd";
const SOURCELESS_REVISION_ID = "00000000-0000-4000-8000-0000000000ce";

const REFERENCED = new TextEncoder().encode("%PDF-1.7\nthe object in the bucket\n");
const SHA = createHash("sha256").update(REFERENCED).digest("hex");
/* What the browser sent when somebody uploaded it. The route puts this in the
   `Content-Disposition` rather than `<slug>.pdf`, so the download is called what
   the reader calls it — and it is reader-controlled text on its way into a
   response header, which is why `contentDisposition` in src/routes.ts escapes
   it. `null` on every other fixture here, which is what a fetch leaves. */
const UPLOADED_AS = "the reader's own paper.pdf";
const KEY = canonicalKey(SHA, "pdf");

/**
 * A page, and it is deliberately **script**, not prose.
 *
 * If either kind guard were removed these bytes would leave this store, get
 * `Content-Type: application/pdf` from the route and be handed to a browser
 * from our own origin. Writing the payload out is what makes the failure
 * message say what the failure *is* rather than "expected null".
 */
const WEBPAGE = new TextEncoder().encode("<html><script>alert(origin)</script></html>");
const HTML_SHA = createHash("sha256").update(WEBPAGE).digest("hex");
const HTML_KEY = canonicalKey(HTML_SHA, "html");

/**
 * A bucket with exactly what the test put in it — and **nothing else**.
 *
 * A real `postgresBlobStore()` would need local Supabase Storage up, which is a
 * second daemon this suite has no reason to depend on; and the two cases that
 * matter most here are *the object is missing* and *the object is the wrong
 * bytes*, which are much easier to make than to find.
 */
function bucket(contents: Map<string, Uint8Array>): RawSourceStore {
  return {
    async head(key: string): Promise<BlobHead | null> {
      const bytes = contents.get(key);
      return bytes ? { bytes: bytes.byteLength, contentType: "application/pdf" } : null;
    },
    async get(key: string): Promise<Uint8Array | null> {
      return contents.get(key) ?? null;
    },
    async putIfAbsent(): Promise<"stored"> {
      throw new Error("this store is read-only in this test");
    },
    async remove(): Promise<void> {
      throw new Error("this store is read-only in this test");
    },
  };
}

/**
 * **The fixture is raw SQL through a kept pool, not drizzle**, and that is not a
 * preference.
 *
 * Drizzle spells out **every column of the table** in an `INSERT`, whether or
 * not the object names it — measured here on 2026-08-31, where the statement
 * carried `quotes` because src/db/schema.ts has it and the local database did
 * not yet. In a tree several agents are editing, a database one migration
 * behind the schema module is the ordinary state, and a suite that dies of a
 * column it never mentions is reporting somebody else's work in progress as a
 * failure of this one. Naming the seven columns this fixture actually needs
 * makes it immune to every column it does not.
 *
 * The **reads** stay on drizzle, because `sourceReferenceQuery` is the thing
 * under test and a `SELECT` names only its projection.
 */
const { pool } = await pgReady({
  suite: "tests/source-store.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "raw_source_sha256" }],
  keepPool: true,
});
/**
 * **Top-level, not inside the `describe`**, like tests/db-schema.test.ts.
 *
 * `pgReady` opens the probe pool before anything knows whether the suite will
 * run, so a hook inside a `describe.skip` never fires and the connections stay
 * held — on a machine where several agents share one local Postgres, a suite
 * that opts out and keeps its connections is worse than one that fails.
 */
afterAll(async () => {
  await pool?.end();
});

describe("the Postgres source store", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const owner = currentOwnerId();
    for (const [id, slug] of [
      [ARTICLE_ID, SLUG],
      [HTML_ARTICLE_ID, HTML_SLUG],
    ]) {
      await sql("insert into spideryarn.articles (id, owner_id, slug) values ($1, $2, $3)", [
        id,
        owner,
        slug,
      ]);
    }
    await sql(
      `insert into spideryarn.raw_sources (sha256, kind, bytes, content_type, verified_at)
       values ($1, 'pdf', $2, 'application/pdf', now()) on conflict do nothing`,
      [SHA, REFERENCED.byteLength],
    );
    await sql(
      `insert into spideryarn.article_revisions
         (id, article_id, status, title, source, raw_source_sha256, raw_source_kind,
          raw_filename)
       values ($1, $2, 'published', 'A scanned paper', 'pdf', $3, 'pdf', $4)`,
      [REVISION_ID, ARTICLE_ID, SHA, UPLOADED_AS],
    );
    /* The web page — the negative control. See the note on `HTML_SLUG`. It needs
       its own `raw_sources` row, because `article_revisions_raw_source_fk`
       points at that table on both columns and `kind` is half the key. */
    await sql(
      `insert into spideryarn.raw_sources (sha256, kind, bytes, content_type, verified_at)
       values ($1, 'html', $2, 'text/html', now()) on conflict do nothing`,
      [HTML_SHA, WEBPAGE.byteLength],
    );
    await sql(
      `insert into spideryarn.article_revisions
         (id, article_id, status, title, raw_source_sha256, raw_source_kind)
       values ($1, $2, 'published', 'An ordinary web page', $3, 'html')`,
      [HTML_REVISION_ID, HTML_ARTICLE_ID, HTML_SHA],
    );
    for (const [article, revision] of [
      [ARTICLE_ID, REVISION_ID],
      [HTML_ARTICLE_ID, HTML_REVISION_ID],
    ]) {
      await sql("update spideryarn.articles set current_revision_id = $2 where id = $1", [
        article,
        revision,
      ]);
    }
  });

  afterAll(async () => {
    await clean();
    /* The drizzle pool the store itself opened, which is not the probe's. */
    await closeDb();
  });

  const withObject = () => createPgSourceStore(() => bucket(new Map([[KEY, REFERENCED]])));

  it("serves the object the revision points at, under the name it was given", async () => {
    expect(await withObject().readPdf(SLUG)).toEqual({
      bytes: REFERENCED,
      filename: UPLOADED_AS,
    });
  });

  /**
   * **The reference is an assertion, so a dangling one is a fault.**
   *
   * `null` here would report an article with a PDF as an article with none, and
   * the reader would be told "that article did not come from a PDF" about the
   * scan they are looking at. `readRawDocument` in src/store/raw-document.ts
   * refuses for the same reason.
   */
  it("refuses a dangling reference rather than calling the article sourceless", async () => {
    const empty = createPgSourceStore(() => bucket(new Map()));
    await expect(empty.readPdf(SLUG)).rejects.toMatchObject({ status: 500 });
  });

  /** The key IS the hash, so bytes that do not hash to it are not the document. */
  it("refuses an object whose bytes do not hash to its own name", async () => {
    const wrong = createPgSourceStore(() =>
      bucket(new Map([[KEY, new TextEncoder().encode("somebody else's paper")]])),
    );
    await expect(wrong.readPdf(SLUG)).rejects.toMatchObject({ status: 500 });
  });

  /**
   * **A revision that names no object has no source document**, and that is the
   * whole of the answer now.
   *
   * Until 2026-09-01 there was a second place to look — `article_revisions.raw_bytes`,
   * which every article the importer ever wrote used — and this file carried two
   * fixtures for it. The corpus was refetched through the reference and the
   * column was dropped, so the fallback is gone; what is left to assert is that
   * its absence answers `null` rather than throwing, which is what the route
   * turns into *"that article did not come from a PDF"*.
   */
  it("answers null for a revision that names no object at all", async () => {
    await sql(
      `insert into spideryarn.articles (id, owner_id, slug) values ($1, $2, $3)`,
      [SOURCELESS_ARTICLE_ID, currentOwnerId(), SOURCELESS_SLUG],
    );
    await sql(
      `insert into spideryarn.article_revisions (id, article_id, status, title, source)
       values ($1, $2, 'published', 'A paper with no document behind it', 'pdf')`,
      [SOURCELESS_REVISION_ID, SOURCELESS_ARTICLE_ID],
    );
    await sql("update spideryarn.articles set current_revision_id = $2 where id = $1", [
      SOURCELESS_ARTICLE_ID,
      SOURCELESS_REVISION_ID,
    ]);
    /* **The row has to be found for the `null` to mean anything.** A fixture
       that failed to insert, or a slug the owner filter rejects, answers `null`
       for a completely different reason and this test would pass while proving
       nothing — docs/reusable/silent-success.md. */
    expect(await sourceReferenceQuery(getDb(), SOURCELESS_SLUG)).toEqual([
      { rawSourceSha256: null, rawSourceKind: null, rawFilename: null },
    ]);
    expect(await withObject().readPdf(SOURCELESS_SLUG)).toBeNull();
  });

  /**
   * **The negative control for the reference path's kind guard.**
   *
   * The bucket below really does hold the object this revision points at, so
   * the only thing standing between those bytes and the reader is
   * `rawSourceKind !== "pdf"`. Every other fixture in this file is a PDF, which
   * is what GPT Sol found on 2026-08-31: an implementation that returned
   * referenced HTML would have passed the whole suite. The route would then set
   * `Content-Type: application/pdf` on a page carrying a `<script>` and serve it
   * from our own origin — docs/project/security.md.
   */
  it("refuses a referenced source that is a web page, object present and all", async () => {
    const store = createPgSourceStore(() => bucket(new Map([[HTML_KEY, WEBPAGE]])));
    expect(await store.readPdf(HTML_SLUG)).toBeNull();
  });

  /**
   * **Owner-filtered at the query**, like every other slug lookup in this
   * directory — `ownedSlug`, and tests/owner-isolation.test.ts is the guard that
   * says nothing here may resolve a slug any other way.
   */
  it("answers a stranger with nothing", async () => {
    const store = withObject();
    const seen = await runInRequest(async () => {
      setRequestOwner(OUTSIDER);
      return store.readPdf(SLUG);
    });
    expect(seen).toBeNull();
  });

  it("answers null for a slug nobody has", async () => {
    expect(await withObject().readPdf("no-such-article-anywhere")).toBeNull();
  });

  /**
   * **The owner filter is in the SQL, not merely in the source.**
   *
   * The test above proves the outsider sees nothing, and that is the property.
   * This is the reason `sourceReferenceQuery` takes its builder, and it is the
   * lesson src/store/pg.ts records against `currentRevisionQuery`: a test that
   * reads the *code* proves nothing about the statement that goes out. Reading
   * the statement is the only place the two facts meet — and it fires whether or
   * not the fixture happens to be in a state where a leak would show.
   */
  it("and the statement it sends really carries the owner filter", () => {
    const { sql: text } = sourceReferenceQuery(getDb(), SLUG).toSQL();
    expect(text).toContain("owner_id");
    expect(text).toContain("current_revision_id");
  });

  /**
   * **And it stays a reference lookup rather than a document read.**
   *
   * This asserted `not.toContain("raw_bytes")` until 2026-09-01 — the column was
   * up to 32 MiB of somebody's scan and this query runs for every request to
   * `/api/source/:slug`, including the ones that answer 404, so putting it back
   * in the projection was a one-word edit that changed no answer anywhere and
   * every behavioural test here would have stayed green. GPT Sol, 2026-08-31:
   * nothing asserted it. The column is gone, so that assertion is now a
   * tautology and this is the property that survives it: three narrow scalars
   * and nothing else off the revision.
   *
   * Named columns rather than a count, so widening the projection to `select()`
   * — which takes the whole row, artefacts and extracted HTML included — fails
   * here.
   */
  it("and it stays three narrow scalars, not the revision row", () => {
    const { sql: text } = sourceReferenceQuery(getDb(), SLUG).toSQL();
    /* The reference, which is what it is for — so this fails if the projection
       is emptied rather than merely trimmed. */
    expect(text).toContain("raw_source_sha256");
    expect(text).toContain("raw_source_kind");
    expect(text).toContain("raw_filename");
    for (const column of ["extracted_html", "stamped_html", "tree", "glossary", "labels"]) {
      expect({ column, taken: text.includes(column) }).toEqual({ column, taken: false });
    }
  });
});

/** One statement through the kept pool. See the note above `pgReady`. */
async function sql(text: string, values: unknown[] = []): Promise<void> {
  await pool?.query(text, values);
}

/**
 * The two articles, gone.
 *
 * The `raw_sources` row is deliberately left: it is content-addressed and
 * shared, nothing in this repo ever deletes one (src/db/schema.ts), and
 * `article_revisions_raw_source_fk` points at it.
 */
async function clean() {
  for (const id of [ARTICLE_ID, HTML_ARTICLE_ID, SOURCELESS_ARTICLE_ID]) {
    await sql("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
    await sql("delete from spideryarn.article_revisions where article_id = $1", [id]);
    await sql("delete from spideryarn.articles where id = $1", [id]);
  }
}
