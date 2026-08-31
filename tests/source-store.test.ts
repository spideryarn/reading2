/**
 * **`GET /api/source/:slug` had to join the store selection**, and this is the
 * evidence that it has.
 *
 * Until 2026-08-31 `sendSource` in src/routes.ts authorised through the store
 * and then read the bytes off the disk itself — `fsLocations(slug)`,
 * `readRaw(dir)`, `readFile(...)` — whatever `SPIDERYARN_STORE` said. It was the
 * one unconditional filesystem read left in that file, found twice
 * independently: by GPT Sol reviewing docs/plans/finish-the-database-move.md,
 * and by the code inventory in that plan (§ *What the inventory found*).
 *
 * Two things were wrong with it, and only one of them is tidiness:
 *
 * 1. Under `SPIDERYARN_STORE=postgres` the article's rows are in Postgres and
 *    its source document is an object in the `sources` bucket. Reading
 *    `data/<slug>/raw.pdf` finds nothing and answers **404 for a PDF that
 *    exists** — an article reported as sourceless, which is what
 *    docs/reusable/silent-success.md is about.
 * 2. Deployed, it is a **jobless caller of `dataRoot()`**, which
 *    src/store/data-root.ts § *Deployed with no job is an error, deliberately*
 *    names by file and route. That function has two wrong answers available in
 *    that state and deliberately throws instead, so the route 500s.
 *
 * ## The three sections, and why the first one is a grep
 *
 * 1. **The route reaches the seam** — read out of src/routes.ts's own text.
 *    There is no type that can say "this function does not touch the disk", and
 *    the failure guarded against is somebody writing a perfectly well-typed
 *    `readFile`. It is the same instrument, for the same reason, as the ordering
 *    guard in tests/owner-isolation.test.ts, which this pairs with.
 * 2. **The filesystem adapter** does exactly what the route used to do, against
 *    a scratch `SPIDERYARN_DATA_ROOT`. "Behaves exactly as it does now" is half
 *    the brief, and this is the half that says so.
 * 3. **The Postgres adapter** serves the reference-backed source, refuses a
 *    dangling one rather than reporting the article sourceless, and answers a
 *    stranger with nothing.
 */

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { loadEnvLocal } from "../src/env.js";
import { currentOwnerId, type OwnerId, runInRequest, setRequestOwner } from "../src/owner.js";
import { canonicalKey } from "../src/source.js";
import { fsSourceStore } from "../src/store/artifacts-fs.js";
import { storeRawSource } from "../src/store/blobs.js";
import type { BlobHead, RawSourceStore } from "../src/store/blobs.js";
import { DATA_ROOT_ENV } from "../src/store/data-root.js";
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
   * `fsLocations` is the filesystem store's path function and `readFile` is
   * `node:fs/promises`. Either one inside this function means the route serves
   * files whatever the store selection says.
   */
  it("does not read the filesystem itself", () => {
    expect(body).not.toContain("fsLocations(");
    expect(body).not.toContain("readRaw(");
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

  /** Nothing else in routes.ts picked the import back up. */
  it("and routes.ts no longer imports the filesystem store's paths", () => {
    expect(code).not.toContain("fsLocations");
    /* Nor `node:fs` / `node:path` at all: the one filesystem read in this file
       was this route, so an import of either is now a route that ignores
       SPIDERYARN_STORE. */
    expect(code).not.toContain('from "node:fs/promises"');
    expect(code).not.toContain('from "node:path"');
  });
});

/* --------------------------------------------- 2. the filesystem adapter -- */

describe("the filesystem source store", () => {
  let root = "";
  let saved: string | undefined;

  beforeAll(async () => {
    saved = process.env[DATA_ROOT_ENV];
    root = await mkdtemp(path.join(tmpdir(), "spya-source-"));
    process.env[DATA_ROOT_ENV] = root;
  });

  afterAll(async () => {
    if (saved === undefined) delete process.env[DATA_ROOT_ENV];
    else process.env[DATA_ROOT_ENV] = saved;
    await rm(root, { recursive: true, force: true });
  });

  /**
   * One article's `data/<slug>/`, with whatever stage 1 would have left.
   *
   * **And what stage 1 leaves changed on 2026-08-31.** It used to write the
   * document beside its manifest; it now puts it in the content-addressed
   * `sources` bucket and the manifest names it by hash
   * (docs/plans/finish-the-database-move.md § Stage 2c). So `bytes` goes
   * through `storeRawSource`, exactly as the stage does, and the manifest gets
   * the `storedSha256` that read-back is addressed by. A fixture that went on
   * writing `raw.pdf` would be describing a state stage 1 can no longer
   * produce — and would have gone on passing while the real route 404'd for
   * every newly-fetched PDF.
   */
  async function fixture(
    slug: string,
    manifest: Record<string, unknown> | null,
    bytes?: Uint8Array,
  ): Promise<void> {
    const dir = path.join(root, "data", slug);
    await mkdir(dir, { recursive: true });
    let stored: Record<string, unknown> = {};
    if (bytes && manifest) {
      const kind = manifest.kind === "pdf" ? "pdf" : "html";
      const put = await storeRawSource(bytes, kind);
      stored = { storedSha256: put.sha256, storedBytes: bytes.byteLength };
    }
    if (manifest) {
      await writeFile(
        path.join(dir, "raw.json"),
        JSON.stringify({ ...manifest, ...stored }),
        "utf8",
      );
    }
  }

  const PDF = new TextEncoder().encode("%PDF-1.7\nnot really a pdf\n");

  it("hands back the bytes the manifest names", async () => {
    await fixture("fs-pdf", { kind: "pdf", file: "raw.pdf" }, PDF);
    expect(await fsSourceStore.readPdf("fs-pdf")).toEqual(PDF);
  });

  it("answers null for an article that came from a web page", async () => {
    await fixture("fs-html", { kind: "html", file: "raw.html" }, PDF);
    expect(await fsSourceStore.readPdf("fs-html")).toBeNull();
  });

  it("answers null when there is no manifest at all", async () => {
    await fixture("fs-bare", null);
    expect(await fsSourceStore.readPdf("fs-bare")).toBeNull();
  });

  it("answers null for a slug with no directory", async () => {
    expect(await fsSourceStore.readPdf("fs-missing")).toBeNull();
  });

  /**
   * **A manifest that names a file which is not there is not "no PDF".**
   *
   * The old route let this throw ENOENT out of `readFile`, which routes.ts
   * turns into a 404 by its `err.code === "ENOENT"` rule. Keeping it a throw
   * rather than a `null` is deliberate: the manifest is the store asserting the
   * bytes exist, and an assertion that turns out false is a fault, not an
   * answer.
   */
  it("throws when the manifest names a file that has gone", async () => {
    await fixture("fs-gone", { kind: "pdf", file: "raw.pdf" });
    await expect(fsSourceStore.readPdf("fs-gone")).rejects.toThrow();
  });
});

/* ----------------------------------------------- 3. the Postgres adapter -- */

const SLUG = "test-source-store";
const ARTICLE_ID = "00000000-0000-4000-8000-0000000000c4";
const REVISION_ID = "00000000-0000-4000-8000-0000000000c5";
const LEGACY_SLUG = "test-source-store-legacy";
const LEGACY_ARTICLE_ID = "00000000-0000-4000-8000-0000000000c6";
const LEGACY_REVISION_ID = "00000000-0000-4000-8000-0000000000c7";
/** Nobody. Never inserted under — only ever asked with. */
const OUTSIDER = "00000000-0000-4000-8000-0000000000c8" as OwnerId;

/**
 * **The two web pages, which are the negative controls.**
 *
 * GPT Sol's third review, 2026-08-31: every fixture here was a PDF, so an
 * implementation that returned referenced **or** legacy HTML bytes would have
 * passed the whole suite. That is the one assertion this file cannot do without
 * — the content type is the security boundary the `readPdf`-not-`readSource`
 * decision rests on (src/store/contracts.ts § SourceStore), and an HTML source
 * served from our own origin is stored XSS. A guard nothing can redden is not a
 * guard.
 *
 * Two of them, because there are two kind checks and they read different
 * columns: `raw_source_kind` on the reference path, `source` on the legacy one.
 * One fixture would leave whichever guard it did not reach free to be deleted.
 */
const HTML_SLUG = "test-source-store-webpage";
const HTML_ARTICLE_ID = "00000000-0000-4000-8000-0000000000c9";
const HTML_REVISION_ID = "00000000-0000-4000-8000-0000000000ca";
const LEGACY_HTML_SLUG = "test-source-store-webpage-legacy";
const LEGACY_HTML_ARTICLE_ID = "00000000-0000-4000-8000-0000000000cb";
const LEGACY_HTML_REVISION_ID = "00000000-0000-4000-8000-0000000000cc";

const REFERENCED = new TextEncoder().encode("%PDF-1.7\nthe object in the bucket\n");
const LEGACY = new TextEncoder().encode("%PDF-1.7\nthe column, from before the bucket\n");
const SHA = createHash("sha256").update(REFERENCED).digest("hex");
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
const { reachable, pool } = await pgReady({
  suite: "tests/source-store.test.ts",
  columns: [{ table: "spideryarn.article_revisions", column: "raw_source_sha256" }],
  keepPool: true,
});
const when = reachable ? describe : describe.skip;

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

when("the Postgres source store", { timeout: 20_000 }, () => {
  beforeAll(async () => {
    await clean();
    const owner = currentOwnerId();
    for (const [id, slug] of [
      [ARTICLE_ID, SLUG],
      [LEGACY_ARTICLE_ID, LEGACY_SLUG],
      [HTML_ARTICLE_ID, HTML_SLUG],
      [LEGACY_HTML_ARTICLE_ID, LEGACY_HTML_SLUG],
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
         (id, article_id, status, title, source, raw_source_sha256, raw_source_kind)
       values ($1, $2, 'published', 'A scanned paper', 'pdf', $3, 'pdf')`,
      [REVISION_ID, ARTICLE_ID, SHA],
    );
    /* The era before the reference: `raw_bytes` and nothing pointing out of the
       row. Every article the importer has ever written is one of these
       (src/store/import.ts writes no `raw_source_sha256`), so a reader that only
       understood references would 404 the whole local corpus. */
    await sql(
      `insert into spideryarn.article_revisions
         (id, article_id, status, title, source, raw_bytes)
       values ($1, $2, 'published', 'A scan from before the bucket', 'pdf', $3)`,
      [LEGACY_REVISION_ID, LEGACY_ARTICLE_ID, Buffer.from(LEGACY)],
    );
    /* The two web pages — the negative controls. See the note on `HTML_SLUG`.
       The referenced one needs its own `raw_sources` row, because
       `article_revisions_raw_source_fk` points at that table on both columns and
       `kind` is half the key. */
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
    /* And the same page in the legacy shape: bytes in the column, `source` left
       null the way every fetched web page leaves it (only src/pdf-read.ts sets
       it). This is the row the `source !== "pdf"` guard exists for. */
    await sql(
      `insert into spideryarn.article_revisions
         (id, article_id, status, title, raw_bytes)
       values ($1, $2, 'published', 'A web page from before the bucket', $3)`,
      [LEGACY_HTML_REVISION_ID, LEGACY_HTML_ARTICLE_ID, Buffer.from(WEBPAGE)],
    );
    for (const [article, revision] of [
      [ARTICLE_ID, REVISION_ID],
      [LEGACY_ARTICLE_ID, LEGACY_REVISION_ID],
      [HTML_ARTICLE_ID, HTML_REVISION_ID],
      [LEGACY_HTML_ARTICLE_ID, LEGACY_HTML_REVISION_ID],
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

  it("serves the object the revision points at", async () => {
    expect(await withObject().readPdf(SLUG)).toEqual(REFERENCED);
  });

  /**
   * **The reference is an assertion, so a dangling one is a fault.**
   *
   * `null` here would report an article with a PDF as an article with none, and
   * the reader would be told "that article did not come from a PDF" about the
   * scan they are looking at. src/store/export.ts's `readRawDocument` refuses
   * for the same reason.
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

  /** The rows written before the `sources` bucket existed still have a source. */
  it("still serves a revision that only has raw_bytes", async () => {
    expect(await withObject().readPdf(LEGACY_SLUG)).toEqual(LEGACY);
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
   * **And the same control for the legacy path's kind guard**, which reads a
   * different column — `source`, not `raw_source_kind`.
   *
   * One fixture cannot cover both: this row has no reference at all, so it never
   * reaches the check above. `source` is null here because that is what a
   * fetched web page leaves it as; only src/pdf-read.ts ever writes `'pdf'`.
   */
  it("refuses a legacy raw_bytes source that is a web page", async () => {
    expect(await withObject().readPdf(LEGACY_HTML_SLUG)).toBeNull();
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
   * **And it does not select `raw_bytes`** — the whole point of the reference.
   *
   * `raw_bytes` is up to 32 MiB of somebody's scan, and this query runs for
   * every request to `/api/source/:slug` including the ones that answer 404.
   * Putting the column back into the projection is a one-word edit that changes
   * no answer anywhere — every behavioural test in this file would stay green
   * while the route dragged the entire document across the wire twice. GPT Sol,
   * 2026-08-31: nothing asserted it.
   *
   * The second, `source = 'pdf'`-guarded query is where those bytes are allowed
   * to be read, and only for the pre-bucket rows that have nowhere else to keep
   * them. src/store/pg-source.ts § *Two eras, and both are served*.
   */
  it("and it does not drag the 32 MiB column along for the ride", () => {
    const { sql: text } = sourceReferenceQuery(getDb(), SLUG).toSQL();
    expect(text).not.toContain("raw_bytes");
    /* The reference, which is what it selects instead — so this test fails if
       the projection is emptied rather than merely trimmed. */
    expect(text).toContain("raw_source_sha256");
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
  for (const id of [ARTICLE_ID, LEGACY_ARTICLE_ID, HTML_ARTICLE_ID, LEGACY_HTML_ARTICLE_ID]) {
    await sql("update spideryarn.articles set current_revision_id = null where id = $1", [id]);
    await sql("delete from spideryarn.article_revisions where article_id = $1", [id]);
    await sql("delete from spideryarn.articles where id = $1", [id]);
  }
}
