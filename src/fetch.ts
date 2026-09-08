/**
 * Stage 1 — get the bytes, and know what they are.
 *
 * This is the only place in the repo that talks to the open web on a reader's
 * behalf, and it is the stage most exposed to other people's servers: every
 * failure here is somebody else's misconfiguration arriving as a surprise. So
 * it is written to fail *legibly* — a typed code and a sentence a human can act
 * on — rather than to fail rarely. See docs/project/fetching.md, which records
 * the evidence behind every number and rule below.
 *
 * Three things it does that a bare `fetch(url).then(r => r.text())` does not,
 * each of which was a real observed bug rather than a precaution:
 *
 *  1. **It counts bytes as they arrive.** `Content-Length` describes the
 *     *compressed* wire size when the server compresses — google.com reports
 *     86,616 and hands you 285,514 — so a cap read off the header is a cap on
 *     the wrong number, and under chunked encoding there is no header at all.
 *  2. **It decodes with the page's own encoding.** `res.text()` always assumes
 *     UTF-8. A Shift_JIS page that declares itself only in a `<meta>` tag comes
 *     back as mojibake, silently, with every downstream stage none the wiser.
 *  3. **It knows a PDF from an HTML page by looking at the bytes**, because
 *     publishers serve PDFs as `application/octet-stream` and error pages as
 *     `application/pdf`.
 *
 * **Everything it touches from outside is injectable** — the fetch itself, the
 * clock, the sleep between retries, the DNS lookup, the jitter. That is not
 * ceremony: it is the only way the interesting cases (an incomplete certificate
 * chain, a redirect loop, a 4.9 MB PDF, a lying `Content-Length`) become
 * deterministic tests instead of a network flake in CI. See tests/fetch.test.ts.
 *
 * Nothing here is top-level `await`, deliberately — for the reason spelled out
 * at `main()` in src/blocks.ts. With one, this module becomes an async module,
 * and importing it would also *run* it.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import path from "node:path";
import { TextDecoder as SpecTextDecoder } from "@exodus/bytes/encoding.js";
import { Agent } from "undici";
import sniffHTMLEncoding from "html-encoding-sniffer";
import type { DocumentOrigin } from "./document-origin.js";
import { canonicalKey } from "./source.js";
import { uploadContentType } from "./uploads.js";
import { blobStore, storeRawSource, type RawSourceStore } from "./store/blobs.js";

/* ------------------------------------------------------------------ *
 * What comes back
 * ------------------------------------------------------------------ */

/** The two things we can do anything with. Everything else is refused by name. */
export type DocumentKind = "html" | "pdf";

export interface FetchedDocument {
  /** What the caller asked for, verbatim. */
  requestedUrl: string;
  /**
   * Where we ended up after redirects.
   *
   * **This is the URL to keep**, not `requestedUrl`. It is the base relative
   * links resolve against, and a `doi.org` or `t.co` address is not what anyone
   * means by "where this article lives".
   */
  url: string;
  /** Every URL in the chain, requested first, final last. One entry if no redirect. */
  chain: string[];
  status: number;
  kind: DocumentKind;
  /** The `Content-Type` header verbatim, or `null` — some servers send none at all. */
  contentType: string | null;
  bytes: Uint8Array;
  /** HTML only, decoded with `encoding` below. `null` for a PDF. */
  text: string | null;
  /** The WHATWG encoding name actually used. `null` for a PDF. */
  encoding: string | null;
  fetchedAt: string;
}

/**
 * **What stage 1 acquired, and where the bytes of it are.**
 *
 * Stage 1's whole product since 2026-08-31, when `writeRaw` stopped writing
 * files: it is returned as `parts: { raw }` and the store decides where it
 * lands — `raw.json` on the filesystem, columns on `article_revisions` in
 * Postgres. The **bytes** are not in it and never were; they are a
 * content-addressed object named by `storedSha256`, and `readRawBytes` below is
 * how stage 2 gets them back.
 *
 * Stage 2 branches on `kind` here rather than looking to see which raw file
 * exists, and that difference is the whole reason this artefact exists: a
 * re-fetch of a URL that used to serve HTML and now serves a PDF left
 * `raw.html` and `raw.pdf` side by side, and "whichever is there" then made a
 * stale file authoritative by accident — silently, with the article still
 * rendering. Found by a GPT Sol review of the plan before it was built. Content
 * addressing closes that a second way: the bytes are named by what they *are*,
 * so a manifest cannot point at last week's document.
 *
 * It is also where the fields `fetchDocument` already returns and the pipeline
 * used to throw away finally survive: the final URL after redirects, the
 * content type the server claimed, the byte length and the hash. Those are the
 * provenance the Postgres migration needs and could not get
 * (docs/plans/260825f-postgres-migration.md § raw.html is not raw).
 */
export interface RawManifest {
  kind: DocumentKind;
  /**
   * `raw.html` or `raw.pdf` — the name the bytes go by, **not a path to them**.
   *
   * It named a real file beside this manifest until 2026-08-31. Nothing writes
   * that file any more, and the field is kept for three reasons rather than out
   * of sentiment: `SHAPE.raw` in src/store/artifacts.ts is `{ field: "file" }`,
   * so it is what tells a usable manifest from a JSON object; `db:export`
   * writes a directory whose raw file this names (src/store/export.ts); and
   * every manifest already written has it. Read it as a restatement of `kind`,
   * and get the bytes from `readRawBytes`.
   */
  file: string;
  /**
   * How we came by this document. **Absent means `"url"`**, which is what every
   * manifest written before uploads existed is.
   *
   * The two origins are the same artefact from stage 2 onwards, so this field
   * exists for the three things that genuinely have to know: the acquisition
   * step (src/pipeline.ts), `GET /api/source/:slug`, and anything asking "can a
   * refresh re-fetch this?" — for an upload the answer is no, and saying so is
   * better than a refresh that fails.
   *
   * **Named rather than spelled**, since 2026-09-08: this was the third
   * hand-written `"url" | "upload"` in the tree, and the one an assignability
   * check between the other two would not have caught ⟨GPT Sol, F25⟩.
   * src/document-origin.ts holds the fact and imports nothing, which is what
   * lets src/messages.ts read it too.
   */
  origin?: DocumentOrigin;
  /**
   * The two URLs, present **only for a fetched document**.
   *
   * Optional since uploads arrived, and deliberately optional rather than
   * filled with a placeholder: `file://…` or `upload://…` reads as an address
   * to every caller downstream, and not one of them would have complained.
   * Making the typechecker ask instead is the entire benefit.
   */
  requestedUrl?: string;
  url?: string;
  /** Upload only — our id for the attempt, and the reader's own name for the file. */
  uploadId?: string;
  filename?: string;
  contentType: string | null;
  encoding: string | null;
  bytes: number;
  /**
   * SHA-256 of the fetched bytes.
   *
   * `null` only in a **backfilled** manifest — one written for an article
   * fetched before manifests existed, where the bytes are gone and only the
   * decoded string survives. Hashing that instead would produce a real-looking
   * number that answers a different question, which is worse than admitting we
   * do not know.
   */
  sha256: string | null;
  /**
   * SHA-256 of the bytes **we stored**, which is the key of the object in the
   * `sources` bucket — `canonicalKey(storedSha256, kind)`.
   *
   * Not the same question as `sha256` above, and the two names are deliberately
   * not near-identical: that one is what the server sent, this is what is on
   * disk and in the bucket. For a PDF they are equal. For HTML they are equal
   * only when the page was already UTF-8, because `writeRaw` stores the decoded
   * string — src/fetch.ts's own comment has said "raw.html is therefore not
   * raw" for longer than this field has existed.
   *
   * Optional, because every manifest written before 2026-08-27 has no object
   * behind it. Absent means *we have not put this document in the bucket*,
   * which is a fact rather than a gap. docs/plans/260827o-raw-bytes-in-storage.md.
   */
  storedSha256?: string;
  /**
   * How many bytes are at `storedSha256` — the size of the object in the
   * `sources` bucket, which is **not** `bytes` above.
   *
   * `bytes` counts what the network sent. This counts what we kept, and for any
   * page that was not already UTF-8 those differ for exactly the reason the two
   * hashes do: `writeRaw` stores the decoded string. `raw_sources.bytes`
   * describes the object, so it needs this number and cannot use the other one
   * — which the first version of the storage plan assumed it could.
   *
   * Optional, alongside `storedSha256` and for the same reason: every manifest
   * written before 2026-08-27 has no object behind it, and absent is the honest
   * way to say so. GPT Sol, 2026-08-28;
   * docs/plans/260828b-artifacts-pg-has-sol.md.
   */
  storedBytes?: number;
  fetchedAt: string;
  /** Present only on a backfilled manifest, saying so in a sentence. */
  backfilled?: string;
}

/**
 * **A manifest that certainly names an object**, which is what every manifest
 * written from now on is.
 *
 * The two fields are optional on `RawManifest` because manifests written before
 * 2026-08-27 genuinely have no object behind them, and absent is the honest way
 * to say so. But anything `writeRaw` produces has just put the bytes in the
 * bucket, so for *that* value they are facts — and saying so in the type is
 * what lets `npm run fetch` print the key without a non-null assertion, and
 * what makes `NoStoredDocument` in src/store/artifacts-pg.ts a check on
 * manifests read back from somewhere rather than on ones we just made.
 */
export type StoredRawManifest = RawManifest & { storedSha256: string; storedBytes: number };

/**
 * **Did this document come off a reader's disk?** — asked of a manifest that
 * may have been through the store, which is the whole reason this exists.
 *
 * **`origin` is the field you would reach for, and it is the one that does not
 * survive.** `readRaw` in src/store/artifacts-pg.ts rebuilds a manifest from
 * columns, there is no `origin` column, and that adapter deliberately declines
 * to invent one — *"an invented `origin: "url"` would be a false statement every
 * later reader would believe"*. So `origin` is set by `acquireUpload`, read by
 * the step immediately after it if at all, and **absent from every manifest
 * loaded back**. Written on 2026-09-07 after `manifest.origin === "upload"` in
 * the `extract` step failed on the first real end-to-end upload, having passed
 * every unit test — because the tests asserted the manifest the step *returns*
 * and the pipeline reads the one the store *kept*
 * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md;
 * docs/reusable/silent-success.md is the class).
 *
 * `filename` does survive: it is the `raw_filename` column, written from this
 * field and null for everything fetched. It is the same fact `cameOffADisk`
 * (src/web/SourceLink.tsx) asks on the client, for the same reason.
 */
export function cameFromAnUpload(manifest: RawManifest): boolean {
  return manifest.filename !== undefined || manifest.origin === "upload";
}

/**
 * **Stage 1's product: the bytes into the object store, and the manifest that
 * names them.** One function, so the two cannot disagree.
 *
 * **It writes no files, and took a `dir` until 2026-08-31.** It wrote
 * `raw.html`/`raw.pdf` and `raw.json` into `data/<slug>/`, and every one of
 * those three is now somebody else's decision: the manifest is returned as
 * `parts: { raw }` and the store puts it wherever that store keeps artefacts,
 * and the bytes go where they were already going — the content-addressed
 * `sources` bucket, through a store that is itself selected (`blobs-fs.ts`
 * locally, `blobs-supabase.ts` deployed). Nothing was reading the two byte
 * files except stage 2, which now asks `readRawBytes` below.
 * docs/plans/260831b-finish-the-database-move.md § Stage 2c.
 *
 * The name is kept deliberately even though the destination changed. It still
 * writes the raw document; it never promised a directory. Renaming it would
 * touch ten files' worth of prose to say the same thing.
 */
/**
 * **The bytes we keep, which for an HTML page are not the bytes we were sent.**
 *
 * HTML is stored as the decoded string — every later stage wants text, and the
 * encoding sniff in `decodeHtml` is the only place that knows how to produce
 * it. The manifest records the encoding so that stays visible; what sits under
 * `storedSha256` is therefore not raw for a web page, which src/db/schema.ts
 * says out loud.
 *
 * **A function rather than an expression inlined at each site**, and that is
 * the whole reason it exists. `writeRaw` needs these bytes to hash and store;
 * `writeRawFiles` needs the identical bytes to put in `raw.html`/`raw.pdf`, or
 * the file beside a manifest is not the document the manifest's hash describes.
 * Two copies of one expression is precisely how `npm run fetch` and the
 * pipeline produced different files at the same path once before.
 */
export function storedDocumentBytes(
  /* **Only the two fields it reads**, since 2026-09-07 and for the same reason
     the function exists at all. `acquireUpload` (src/pipeline.ts) has to store
     an uploaded web page under exactly this rule or stage 2 reads mojibake —
     it decodes with no encoding branch, on the strength of this line — and it
     has no `FetchedDocument`, because an upload has no URL, no redirect chain
     and no status. Narrowing the parameter is what lets it call this instead of
     writing the rule out a third time. */
  doc: Pick<FetchedDocument, "kind" | "bytes" | "text">,
): Uint8Array {
  return doc.kind === "pdf" ? doc.bytes : new TextEncoder().encode(doc.text ?? "");
}

export async function writeRaw(
  doc: FetchedDocument,
  /* Injectable for the same reason `readRawBytes` below takes one: the value
     that matters here is the one that crosses between them, and a round-trip
     test that cannot name the store is a test of whatever `.env.local` happens
     to say. `storeRawSource` already took the parameter; this only passes it
     on. */
  store?: RawSourceStore,
): Promise<StoredRawManifest> {
  const storedBytes = storedDocumentBytes(doc);
  /* **The object is keyed by the hash of what we actually stored.**

     Not `manifest.sha256`, which hashes the bytes off the *network* — and for
     HTML those are not the bytes above, because this function stores the
     decoded string. Two different questions, and conflating them puts bytes
     under a name that does not describe them, which is the one thing content
     addressing must never do. docs/plans/260827o-raw-bytes-in-storage.md § The backfill
     can put the wrong bytes under a hash is the same mistake found the other
     way round. For a PDF, and for a page that was already UTF-8, the two hashes
     are equal.

     Here rather than at the two call sites, so `npm run fetch` and the pipeline
     cannot drift again — they already did once, and this function is the fix
     for that. Idempotent and outside any transaction, which is safe because the
     key is the contents: writing twice is a no-op, and an object nothing
     references is one we keep on purpose. `storeRawSource` verifies a dedup hit
     rather than trusting it. */
  const stored = await storeRawSource(storedBytes, doc.kind, store ?? blobStore());

  return {
    kind: doc.kind,
    file: doc.kind === "pdf" ? "raw.pdf" : "raw.html",
    requestedUrl: doc.requestedUrl,
    url: doc.url,
    contentType: doc.contentType,
    encoding: doc.encoding,
    bytes: doc.bytes.byteLength,
    sha256: createHash("sha256").update(doc.bytes).digest("hex"),
    storedSha256: stored.sha256,
    /* The length of what was stored above, not of what arrived. `writeRaw`
       computes `storedBytes` and recorded only its hash until now, so
       `raw_sources.bytes` had no source but a second call to the bucket. */
    storedBytes: storedBytes.byteLength,
    fetchedAt: doc.fetchedAt,
  };
}

/**
 * **`raw.json` and the bytes beside it, for the one caller that wants files.**
 *
 * The rule that came out of stage 2a is *the generator stops writing and the
 * caller writes*, and for a command line the caller is `main()`. Every stage
 * that still has a command line leaves the file it always left —
 * `output/<slug>.html`, `tree.json`, `labels.json` — and a `fetch` command that
 * printed a digest instead would be the one that broke the pattern. It would also have
 * broken something people used to do: running `npm run fetch -- <url>` by hand
 * under `SPIDERYARN_STORE=files` satisfied the queue's `fetch` step, because
 * the filesystem artefact store read `raw.json` at exactly this path
 * (`PATHS.fetch.raw` in src/store/artifacts-fs.ts, deleted 2026-09-05) — there
 * is one store now, and that flag is gone too.
 *
 * **It takes the manifest rather than making one**, so the two files cannot
 * describe different documents: the caller has already had `writeRaw` hash and
 * store the bytes, and this puts *those* bytes — from the same
 * `storedDocumentBytes` — under the name the manifest gives them.
 *
 * All of this dies at stage 4 with the filesystem store, which is the right
 * time for it to die. docs/plans/260831b-finish-the-database-move.md § Stage 4.
 */
export async function writeRawFiles(
  dir: string,
  doc: FetchedDocument,
  manifest: RawManifest,
): Promise<{ file: string; manifestFile: string }> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, manifest.file);
  await writeFile(file, storedDocumentBytes(doc));
  const manifestFile = path.join(dir, "raw.json");
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { file, manifestFile };
}

/**
 * A manifest whose bytes cannot be handed over, and **which of the three ways**.
 *
 * Its own class, with the reason as a field, because the three are three
 * different next actions and a caller that cannot tell them apart cannot say
 * anything useful. `no-object` is a manifest from before the bucket existed and
 * the answer is a re-fetch; `missing` and `corrupt` are the object store
 * disagreeing with a reference, and the answer is a person looking — the same
 * rule, and nearly the same sentence, as `readRawDocument` in
 * src/store/export.ts and `readPdf` in src/store/pg-source.ts.
 *
 * **None of the three is ever silently downgraded to "assume HTML".** That
 * fallback existed on `readRaw`, which stage 2 relied on and which was deleted
 * on 2026-09-05 — the note where it stood, below, has the history; it is gone,
 * and this class is what replaced it. Greg's decision 4 of
 * docs/plans/260831b-finish-the-database-move.md makes refetching the right answer for
 * an old article — but only if the state says so out loud, which is what a
 * thrown error does and what a quiet default did not.
 *
 * **Every `message` handed to this constructor must be written here**, and that
 * is a constraint rather than a habit. Stage 2's catch (src/pipeline.ts §
 * `extract`) forwards it to Sentry under `{ authored }` — the claim that we
 * wrote every character of it and none of it came from a provider, a document
 * or a reader. The four call sites below keep that true: fixed prose around a
 * slug, a content-addressed key, byte counts, a local digest, and
 * `credentialsSeen()`, which reports whether two environment variables are set
 * and never their values. A fifth that interpolated a response body, a page, or
 * another library's `err.message` would break the claim silently.
 */
export class RawDocumentUnavailable extends Error {
  constructor(
    readonly reason: "no-object" | "missing" | "corrupt",
    message: string,
  ) {
    super(message);
    this.name = "RawDocumentUnavailable";
  }
}

/**
 * **The bytes a manifest names** — `writeRaw`'s inverse, and stage 2's only way
 * in.
 *
 * Reads the content-addressed object at `canonicalKey(storedSha256, kind)` and
 * checks it hashes to its own name before handing it over.
 *
 * ## Why this is not a method on `SourceStore`
 *
 * `SourceStore.readPdf` looks an article up **by slug**, and its Postgres
 * implementation resolves that through `articles.currentRevisionId` and
 * `ownedSlug` (src/store/pg-source.ts). Stage 2 runs against a *draft* revision
 * inside a job: there is no request owner, and on a fresh ingest there is no
 * current revision at all, so a sibling method there would answer `null` on the
 * ordinary path. That is the shape of the NO-SHIP in
 * docs/plans/260831b-finish-the-database-move.md § *The thing Greg asked for that is not
 * available* — pointing a fresh ingest's read at the published revision breaks
 * the common case to serve the uncommon one. The content-type argument that
 * makes `readPdf` PDF-only is a separate and also true reason; this one is
 * decisive on its own.
 *
 * ## Why `blobStore()`, and not `postgresBlobStore()`
 *
 * Because `writeRaw` above writes through `blobStore()`. Selecting differently
 * here would be a split brain by construction: the process that fetched and the
 * process that extracts would look in two different buckets. If the pipeline
 * should one day fail closed rather than fall back to `data/_blobs/`, that is
 * one change in src/store/blobs.ts affecting both halves, not a divergence
 * introduced here.
 *
 * ## The verification is not ceremony
 *
 * `storeRawSource` proves what was written; this proves what came back, and
 * they are different moments with a network and a filesystem in between. One
 * SHA-256 pass over a buffer already in memory — about 60 ms at the 32 MB
 * ceiling — against a stage that is about to run jsdom over it or spend a
 * vision-model call on it. The same trade `pg-source.ts` makes, for the same
 * reason.
 */
export async function readRawBytes(
  manifest: RawManifest,
  opts: {
    /**
     * The article this manifest belongs to, for the message.
     *
     * Optional because a manifest does not carry one and this function should
     * not invent one — but every pipeline caller has `ctx.slug`, and *which
     * article* is the first thing anybody reading the failure needs.
     */
    slug?: string;
    store?: RawSourceStore;
  } = {},
): Promise<Uint8Array> {
  const store = opts.store ?? blobStore();
  const about = opts.slug === undefined ? "This article" : `"${opts.slug}"`;
  const { storedSha256, kind } = manifest;
  if (!storedSha256) {
    throw new RawDocumentUnavailable(
      "no-object",
      `${about} was fetched before its bytes were kept in the object store, so there is ` +
        "nothing to extract from — its manifest has no storedSha256 (RawManifest in " +
        "src/fetch.ts). Fetch it again; the corpus is expendable and refetching is free " +
        "(docs/plans/260831b-finish-the-database-move.md, decision 4).",
    );
  }
  const key = canonicalKey(storedSha256, kind);
  /* `maxBytes` from the manifest's own count, so an object *longer* than the
     one this manifest describes throws out of `get` rather than coming back as
     a prefix. An over-long object at a content-addressed name is corruption
     too, and a prefix of a PDF is a corrupt PDF that parses far enough to look
     like an article. `storeRawSource` bounds its read-back the same way. */
  let bytes: Uint8Array | null;
  try {
    bytes = await store.get(
      key,
      manifest.storedBytes === undefined ? {} : { maxBytes: manifest.storedBytes },
    );
  } catch (err) {
    /* **The bound throwing is corruption; everything else is a fault.** Both
       adapters raise an ordinary `Error` when `maxBytes` is exceeded, and
       src/pipeline.ts converts only `RawDocumentUnavailable` into a `blocked`
       failure — so until this existed, an over-long object reached the reader
       as a **Retry**, and retry skips the finished `fetch` step, reads the same
       object and fails identically. GPT Sol found it, 2026-08-31.

       The two are told apart by **asking the store how big the object is**,
       never by reading the message: a message match would break the first time
       either adapter reworded its sentence, and it is the same "match on the
       string and learn nothing" that `FetchFailureCode` exists to avoid. A
       catch-all would be worse than either — a Storage 503 classified as
       corruption tells a reader to re-fetch an article that would have loaded
       on the next click, which is exactly the reading of a transient failure
       that `head()` in src/store/blobs.ts refuses to make. */
    throw (await overlongObject(store, key, manifest, about)) ?? err;
  }
  if (!bytes) {
    throw new RawDocumentUnavailable("missing", `${about} ${missingObjectAdvice(key)}`);
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== storedSha256) {
    throw new RawDocumentUnavailable(
      "corrupt",
      `${about} points at the object "${key}", and its bytes hash to ${actual} — so what ` +
        "is there is not the document that name promises. Nothing here will overwrite it " +
        "(see CorruptObject in src/store/blobs.ts for why a repair races every other " +
        "writer), so it needs clearing by hand, or the article refetching.",
    );
  }
  return bytes;
}

/**
 * **Was that failure the size bound, or something else?** — asked of the store,
 * rather than of the error's message.
 *
 * `null` means *not the bound*, and the caller then rethrows what it caught,
 * because a store that is refusing to answer at all is a fault worth retrying
 * and not a document worth re-fetching. Two ways to reach `null` and both are
 * that: `head` says the object is absent or is no bigger than the manifest
 * claims, or `head` itself fails — in which case the store is unreachable and
 * the original error is the honest one to show.
 *
 * A second call to the store, but only on a path that has already failed: the
 * ordinary read stays one round trip, which is why this is not a `head` before
 * every `get`.
 */
async function overlongObject(
  store: RawSourceStore,
  key: string,
  manifest: RawManifest,
  about: string,
): Promise<RawDocumentUnavailable | null> {
  const claimed = manifest.storedBytes;
  if (claimed === undefined) return null;
  const head = await store.head(key).catch(() => null);
  if (head === null || head.bytes <= claimed) return null;
  return new RawDocumentUnavailable(
    "corrupt",
    `${about} points at the object "${key}", and what is there is ${head.bytes} bytes where ` +
      `its manifest says ${claimed} — so what is at that name is not the document the name ` +
      "promises. It is not read: a prefix of a PDF is a corrupt PDF that parses far enough " +
      "to look like an article. Nothing here will overwrite it (see CorruptObject in " +
      "src/store/blobs.ts for why a repair races every other writer), so it needs clearing " +
      "by hand, or the article refetching.",
  );
}

/**
 * **The sentence for the commonest way this fails, which is not corruption.**
 *
 * Measured on 2026-08-31: of the eighteen manifests under `data/`, nine name an
 * object that is only in the local Supabase container's `sources` bucket and
 * nine name one that is only in `data/_blobs/`. Nothing had noticed, because
 * `storeRawSource` had a writer and no reader — [silent
 * success](docs/reusable/silent-success.md) in the shape this repo keeps
 * finding. The cause is that `blobStore()` follows the process's credentials,
 * so a document stored by a process that loaded `.env.local` is invisible to
 * one that did not, and the other way round.
 *
 * So the message says *that*, rather than "not found". A reader who is told
 * only that an object is missing goes looking for something they deleted.
 *
 * **It reports the two credentials as observed rather than announcing which
 * store was chosen**, and the distinction is the point: the selection rule
 * lives in `blobStore()` and restating it here would be a second copy that
 * nothing keeps in step — the exact failure AGENTS.md § One source of truth
 * describes, and the one that let a comment in src/token-budget.ts mislead two
 * agents. Whether an environment variable is set is an observable fact about
 * this process; which adapter that produced is `blobStore()`'s business, and
 * naming the function is how a reader gets the answer that cannot go stale.
 *
 * Only whether they are set, never their values.
 */
function missingObjectAdvice(key: string): string {
  return (
    `points at the object "${key}" and nothing is there. The manifest asserts that ` +
    "object exists, so this is a fault rather than an article without a source document " +
    "— but the likeliest cause is not that anything was deleted. `blobStore()` " +
    "(src/store/blobs.ts) chooses between Supabase Storage and data/_blobs/ from this " +
    "process's credentials, so a document stored by a process configured the other way " +
    `is invisible to this one. Here, ${credentialsSeen()}. Refetch the article rather ` +
    "than hunting for the object: the corpus is expendable and refetching is free " +
    "(docs/plans/260831b-finish-the-database-move.md, decision 4)."
  );
}

/**
 * **The two facts that decide which object store this process is talking to**,
 * as a clause — one function, so the failure message above and `npm run fetch`
 * below cannot describe the same moment differently.
 *
 * **No `.trim()`, and it had one until GPT Sol pointed out what that costs.**
 * `blobStore()`'s own test is `url && key` (src/store/blobs.ts), so a
 * whitespace-only `SUPABASE_URL` selects Supabase Storage — while a trimmed
 * reading here called it "not set" and sent the reader to look in
 * `data/_blobs/`. A sentence that disagrees with the selection it is explaining
 * is worse than either answer on its own. `postgresBlobStore` does trim and
 * refuses, which is a different function with a different rule; this clause is
 * about the one `blobStore()` applies.
 *
 * Only whether they are set, never their values.
 *
 * **The helper is handed the value; it does not go and get it.** A helper that
 * reads `process.env[name]` puts the two names somewhere no inventory of this
 * repo's configuration can see them — the same computed-key door
 * `SPIDERYARN_ENV_PINNED` sat behind, unseen by every inventory from the day it
 * was written until something enumerated every read
 * (docs/plans/260908a-make-every-environment-variable-read-literal-and-inventory-them.md).
 * Read literally at the call sites, both names are visible from the syntax.
 * The test is still truthiness of the same value, with no `.trim()`, for the
 * reason above.
 */
function credentialsSeen(): string {
  const seen = (name: string, value: string | undefined): string =>
    `${name} is ${value ? "set" : "not set"}`;
  return (
    `${seen("SUPABASE_URL", process.env.SUPABASE_URL)} and ` +
    `${seen("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY)}`
  );
}

/* **`readRaw(dir)` was here, and it went on 2026-09-05.** It read a `raw.json`
   out of a `data/<slug>/` and answered `null` for anything it could not parse.
   Its last caller was `loadSource` in src/api.ts, which went with the
   filesystem store
   (docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md § G).
   Its own docstring named `articleMetadata` as what still called it, and that
   had been wrong for some time — the function it named never mentioned it.

   **The thing worth keeping is why its `null` stopped meaning "assume HTML".**
   Until 2026-08-31 every article ingested before manifests existed had a
   `raw.html` and no `raw.json`, and stage 2 fell back to reading that file.
   Nothing writes `raw.html` now, so the fallback had nothing to fall back *to*.
   `RawDocumentUnavailable` above is what replaced it: three named reasons, none
   of them silently downgraded to a guess.

   The read that survived `readRaw`'s deletion was `fsArtifacts.read`, which
   went through the artefact seam rather than opening the file a second way —
   but it went too, with the rest of src/store/artifacts-fs.ts, on 2026-09-05.
   There is one store now, and no manifest read on disk at all. */

/* ------------------------------------------------------------------ *
 * How it fails
 * ------------------------------------------------------------------ */

/**
 * Why a fetch failed, as something to switch on.
 *
 * These exist because **every network and TLS failure in Node arrives as the
 * identical `TypeError: fetch failed`** — DNS, refused connection, expired
 * certificate, self-signed certificate and a missing intermediate are one
 * string at the top level, and the difference lives only in `err.cause.code`.
 * Code that matches on the message learns nothing, which is exactly the trap
 * the previous version fell into (docs/project/original-version/extraction.md).
 */
export type FetchFailureCode =
  | "invalid-url"
  | "unsupported-scheme"
  | "blocked-address"
  | "dns"
  | "connection"
  | "certificate"
  | "timeout"
  | "too-many-redirects"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "server-error"
  | "http-error"
  | "too-large"
  | "unsupported-type"
  | "empty";

export class FetchFailure extends Error {
  readonly code: FetchFailureCode;
  readonly url: string;
  /** The HTTP status, where there was one. `null` for anything that never got a response. */
  readonly status: number | null;
  /** Whether trying the identical request again could plausibly work. */
  readonly retryable: boolean;
  /** What the server asked us to wait, from `Retry-After`, in ms. */
  readonly retryAfterMs: number | null;

  constructor(
    code: FetchFailureCode,
    url: string,
    message: string,
    extra: {
      status?: number | null;
      retryable?: boolean;
      retryAfterMs?: number | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, extra.cause === undefined ? undefined : { cause: extra.cause });
    this.name = "FetchFailure";
    this.code = code;
    this.url = url;
    this.status = extra.status ?? null;
    this.retryable = extra.retryable ?? false;
    this.retryAfterMs = extra.retryAfterMs ?? null;
  }
}

/* ------------------------------------------------------------------ *
 * Knobs
 * ------------------------------------------------------------------ */

/**
 * What we tell the far end we are.
 *
 * A browser string, not an honest one, and that is a deliberate and slightly
 * uncomfortable call — docs/project/fetching.md#the-user-agent-question has the
 * argument. The short version: a reader pasting one URL they want to read is
 * doing what a browser does, and an honest `Spideryarn/1.0` gets a stub or a
 * 403 from a meaningful share of publishers. Override it in one line if you
 * disagree; nothing else depends on the value.
 */
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * The defaults, exported so tests and docs can quote them rather than repeat them.
 *
 * `maxBytes` is 32 MB and the number has a source: the previous version capped
 * at 4 MB, and one of the three articles Greg named as a representative hard
 * case — the Nagel PDF at `sas.upenn.edu` — is 4,930,377 bytes. A cap chosen
 * without a real document in front of you rejects real documents.
 */
export const DEFAULTS = {
  timeoutMs: 30_000,
  maxBytes: 32 * 1024 * 1024,
  attempts: 3,
  maxRedirects: 5,
  userAgent: USER_AGENT,
} as const;

/** Just the part of `fetch` we use, so a test can supply a function instead of a network. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Total tries, not extra tries. 1 disables retrying. */
  attempts?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Cancellation from above — the ingest queue's, in practice. */
  signal?: AbortSignal;
  /* --- seams, for tests --- */
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Hostname → IP addresses. Injected so the address guard can be tested without DNS. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Jitter source. Injected so retry delays are assertable. */
  random?: () => number;
}

interface Resolved {
  timeoutMs: number;
  maxBytes: number;
  attempts: number;
  maxRedirects: number;
  userAgent: string;
  signal: AbortSignal | null;
  fetchImpl: FetchLike;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  resolve: (hostname: string) => Promise<string[]>;
  random: () => number;
}

/**
 * A caller's number, or the default — but never a value that turns a bound into
 * no bound.
 *
 * Each of these numbers is a safety limit that something else compares against,
 * so the ways they can be wrong are not symmetrical. `NaN` is the sharp one:
 * `total > NaN` is false for every total, so a `NaN` byte cap doesn't raise the
 * ceiling, it **removes** it, silently, with the code still reading as though a
 * cap were in force. `Infinity` retries forever. Nonsense falls back to the
 * default; a real number is clamped to a range this module can defend.
 */
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function withDefaults(options: FetchOptions): Resolved {
  return {
    timeoutMs: bounded(options.timeoutMs, DEFAULTS.timeoutMs, 1, 10 * 60_000),
    maxBytes: bounded(options.maxBytes, DEFAULTS.maxBytes, 1, 2 * 1024 * 1024 * 1024),
    attempts: bounded(options.attempts, DEFAULTS.attempts, 1, 5),
    maxRedirects: bounded(options.maxRedirects, DEFAULTS.maxRedirects, 0, 20),
    userAgent: options.userAgent ?? DEFAULTS.userAgent,
    signal: options.signal ?? null,
    fetchImpl: options.fetchImpl ?? ((url, init) => fetch(url, init)),
    sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    now: options.now ?? (() => new Date()),
    resolve: options.resolve ?? defaultResolve,
    random: options.random ?? Math.random,
  };
}

/**
 * A `FetchFailure` for a signal that fired, told apart by what fired it.
 *
 * `AbortSignal.timeout` sets a `TimeoutError` as the reason; a caller's own
 * cancellation sets something else or nothing. One is worth retrying and the
 * other emphatically is not.
 */
function abortFailure(signal: AbortSignal, url: string): FetchFailure {
  const reason: unknown = signal.reason;
  const timedOut = reason instanceof Error ? reason.name === "TimeoutError" : false;
  return timedOut
    ? new FetchFailure("timeout", url, "That site took too long to answer.", { retryable: true })
    : new FetchFailure("timeout", url, "Fetch cancelled.");
}

/**
 * Run a promise under a signal, so work that doesn't take one still stops.
 *
 * `fetch` honours an `AbortSignal`; `dns.lookup` and a `setTimeout` sleep do
 * not. Without this, a deadline of 30 seconds is really "30 seconds, plus
 * however long the resolver feels like taking" — and a hung resolver is a real
 * thing rather than a hypothetical one. The losing promise is left to settle on
 * its own; nothing is waiting on it any more.
 */
function underSignal<T>(work: Promise<T>, signal: AbortSignal, url: string): Promise<T> {
  if (signal.aborted) return Promise.reject(abortFailure(signal, url));
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(abortFailure(signal, url)), { once: true });
    }),
  ]);
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true });
  return found.map((entry) => entry.address);
}

/* ------------------------------------------------------------------ *
 * The URL, before we dial it
 * ------------------------------------------------------------------ */

/**
 * Parse and vet a URL, or say why not.
 *
 * The scheme allow-list is the whole of the cheap half of SSRF defence, and it
 * is worth having even here: `file:///etc/passwd` pasted into the add box
 * should be a sentence, not a read.
 */
export function parseTarget(input: string): URL {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new FetchFailure("invalid-url", trimmed, `That isn't a URL: ${trimmed}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FetchFailure(
      "unsupported-scheme",
      trimmed,
      `Only http and https are fetched, not ${url.protocol.replace(":", "")}.`,
    );
  }
  return url;
}

/**
 * Is this address one we should refuse to dial?
 *
 * Loopback, private, link-local, multicast and the reserved ranges. The point
 * is not a hardened SSRF boundary — this app is one person's, and the URL comes
 * from their own text box — it is that `http://localhost:5273/` and
 * `http://169.254.169.254/` are never articles, and refusing them by name costs
 * one function.
 *
 * **This used to be half a guard, and the other half is now `pinnedAgent`.**
 * The check below runs against a resolver answer, and `fetch` then resolved the
 * name *again* to open the socket — two lookups with nothing requiring them to
 * agree, so a name answering `93.184.216.34` here and `127.0.0.1` there walked
 * through a guard that reported success. That was written down as knowingly
 * open, on the argument that an attacker needed a domain's DNS *and* Greg's
 * clipboard.
 *
 * Fetching an article's own images ended that argument — the URLs come from the
 * page, so a publisher chooses them, and there may be hundreds of them. The
 * connection is now pinned to the address this function approved. GPT Sol,
 * 2026-08-29; docs/plans/260829b-hosting-the-articles-images.md.
 */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return isBlockedIPv4(address);
  if (kind === 6) return isBlockedIPv6(address);
  return false;
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and the cloud metadata address
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  /* 192.0.0.0/24 and 192.0.2.0/24, and note the mask: this said `b === 0` at
     first, which is 192.0.0.0/**16** and blocks 192.0.78.0/24 — Automattic's
     range, so every WordPress.com blog. An over-wide block here refuses real
     articles and says "not a public address", which is both wrong and confusing. */
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/**
 * The 128 bits of an IPv6 address as eight groups, `::` expanded.
 *
 * Written out rather than pattern-matched because the interesting addresses
 * here are the ones wearing a disguise, and there are several disguises: the
 * WHATWG URL parser turns `[::127.0.0.1]` into `[::7f00:1]`, so a check that
 * looks for a dotted quad misses a loopback address that arrived as hex.
 * Returns null for anything malformed, which `isIP` has already ruled out.
 */
function expandIPv6(address: string): number[] | null {
  let text = address;

  /* A trailing dotted quad — ::ffff:127.0.0.1 — is two groups written in
     decimal. Fold it into hex so the rest of this only handles one notation. */
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    const hex = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    text = text.slice(0, dotted.index) + hex;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined): string[] => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const groups = halves.length === 2 ? head.length + tail.length : head.length;
  if (groups > 8 || (halves.length === 1 && groups !== 8)) return null;

  const parse = (group: string): number => Number.parseInt(group, 16);
  const filled = [...head.map(parse), ...new Array<number>(8 - groups).fill(0), ...tail.map(parse)];
  return filled.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff) ? null : filled;
}

function isBlockedIPv6(address: string): boolean {
  const groups = expandIPv6(address.toLowerCase());
  if (!groups) return false;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;

  /* An IPv4 address wearing an IPv6 coat: ::ffff:0:0/96 (mapped) and ::/96
     (the deprecated compatible form). Judge it as the IPv4 address it is. */
  const topIsZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (topIsZero && (g5 === 0xffff || g5 === 0)) {
    const packed = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    /* ::0 and ::1 land here as 0.0.0.0 and 0.0.0.1, and 0.0.0.0/8 is blocked
       anyway — so the unspecified and loopback addresses need no special case. */
    return isBlockedIPv4(packed);
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local, fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local, fe80::/10
  if ((g0 & 0xffc0) === 0xfec0) return true; // site-local, fec0::/10 — deprecated, still routed on some networks
  if ((g0 & 0xff00) === 0xff00) return true; // multicast, ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation, 2001:db8::/32
  return false;
}

/**
 * The addresses this hop may dial, or `null` when the host is already one.
 *
 * **The return value is the load-bearing part**, and it used to be `void`. The
 * caller pins the connection to exactly these, so what this function approves
 * and what the socket does can no longer be two different answers — see
 * `pinnedAgent`. A literal-IP host gives `null` because there is nothing to
 * resolve and so nothing to disagree with.
 */
async function guardAddress(
  url: URL,
  opts: Resolved,
  signal: AbortSignal,
): Promise<string[] | null> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new FetchFailure("blocked-address", url.toString(), `${host} is not a public address.`);
    }
    return null;
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new FetchFailure("blocked-address", url.toString(), "localhost is not an article.");
  }

  let addresses: string[];
  try {
    addresses = await underSignal(opts.resolve(host), signal, url.toString());
  } catch (err) {
    throw classifyNetworkError(err, url.toString());
  }
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked !== undefined) {
    throw new FetchFailure(
      "blocked-address",
      url.toString(),
      `${host} resolves to ${blocked}, which is not a public address.`,
    );
  }
  /* An empty answer is not an approval. `find` on `[]` is `undefined`, which
     reads exactly like "nothing blocked" — so without this, a resolver that
     returned nothing would produce an empty pin list, and the lookup below
     would refuse the connection with a confusing error instead of this one. */
  if (addresses.length === 0) {
    throw new FetchFailure("dns", url.toString(), `${host} has no address.`);
  }
  return addresses;
}

/**
 * A dispatcher that dials **only** addresses `guardAddress` already approved.
 *
 * This is the half of the SSRF guard that closes the gap between checking a
 * name and connecting to it. Node's `fetch` would otherwise resolve the
 * hostname a second time, and a name that answers differently on the second
 * lookup — DNS rebinding — is through.
 *
 * `connect.lookup` is undici's seam for exactly this. The **hostname is left
 * alone**: it still goes into the `Host` header, the TLS SNI and the
 * certificate check, so a pinned request to a virtual host reaches the right
 * site and a forged certificate is still caught. Only the address the socket
 * opens against is ours to decide.
 *
 * **A hostname absent from the map is refused rather than resolved.** Anything
 * reaching the socket without having passed the guard is a bug above this line,
 * and the safe reading of a bug is "do not dial". Defence in depth: nothing
 * should ever get here.
 *
 * `pinned` is attached to the returned agent so a test can assert the real map
 * the lookup closes over, rather than a copy that could drift from it.
 */
export function pinnedAgent(pinned: Map<string, readonly string[]>): Agent & {
  pinned: Map<string, readonly string[]>;
} {
  const agent = new Agent({
    connect: {
      lookup: (
        hostname: string,
        options: { all?: boolean | undefined; family?: number | "IPv4" | "IPv6" | undefined },
        callback,
      ) => {
        const approved = pinned.get(hostname.toLowerCase());
        if (!approved || approved.length === 0) {
          callback(new Error(`${hostname} was not checked by the address guard`), "", 0);
          return;
        }
        /* `family` is a filter, not a preference: undici asks for 4 or 6 when
           it means it, and handing back the other one connects to an address
           the caller has already ruled out. 0 means either.

           **It is not always a number.** Node accepts `"IPv4"` and `"IPv6"`
           here as well, and the obvious `options.family ?? 0` reads either
           string as a truthy non-4, non-6 value — so every address gets
           filtered out and the connection fails with "no approved address" on
           a request that was perfectly fine. */
        const family = options?.family;
        const wanted = family === "IPv4" ? 4 : family === "IPv6" ? 6 : (family ?? 0);
        const entries = approved
          .map((address) => ({ address, family: isIP(address) }))
          .filter((entry) => entry.family !== 0 && (wanted === 0 || entry.family === wanted));
        const first = entries[0];
        if (!first) {
          callback(new Error(`${hostname} has no approved IPv${wanted} address`), "", 0);
          return;
        }
        if (options?.all) callback(null, entries as never);
        else callback(null, first.address as never, first.family as never);
      },
    },
  });
  return Object.assign(agent, { pinned });
}

/* ------------------------------------------------------------------ *
 * Reading the response
 * ------------------------------------------------------------------ */

/**
 * Read a body, counting as we go, and give up the moment it is too big.
 *
 * The counting is the point. By the time bytes reach here they are already
 * decompressed — undici does that for us — so this caps the size that actually
 * matters rather than the size the server advertised. `cancel()` closes the
 * socket rather than politely draining however many gigabytes are still coming.
 */
export async function readCapped(body: ReadableStream<Uint8Array> | null, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new FetchFailure(
          "too-large",
          url,
          `That page is over the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
        );
      }
      chunks.push(value);
    }
  } catch (err) {
    /* Every way out of that loop except a clean finish leaves a socket open —
       going over the cap, and also the read itself failing mid-body, which is
       the one easy to forget. Cancelling twice is harmless; not cancelling
       leaves the server streaming into nothing. */
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    /* Without this the stream stays locked after we are done with it, so
       nothing else can ever read or cancel it. */
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** The MIME type on its own, lower-cased, without the parameters. */
export function mimeType(contentType: string | null): string | null {
  if (!contentType) return null;
  const [type = ""] = contentType.split(";");
  const trimmed = type.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

/**
 * The charset parameter of a `Content-Type`, or `null`.
 *
 * The quote-stripping is not defensive programming: Instagram serves
 * `text/html; charset="utf-8"`, quotes included, and a decoder handed `"utf-8"`
 * with the quotes attached either throws or quietly falls back.
 */
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;

  /* Split on semicolons that are not inside a quoted string. A regex cannot do
     this, and the failure is not theoretical: in
     `text/html; note="x;charset=shift_jis"; charset=utf-8` a regex finds the
     semicolon inside the quotes, reads the decoy, and decodes the whole page as
     Shift_JIS. HTTP explicitly allows semicolons inside quoted values
     (RFC 9110 §5.6.6). */
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < contentType.length; i++) {
    const char = contentType[i];
    if (char === undefined) break;
    if (quoted && char === "\\" && i + 1 < contentType.length) {
      current += contentType[i + 1];
      i++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  for (const part of parts.slice(1)) {
    const at = part.indexOf("=");
    if (at === -1) continue;
    if (part.slice(0, at).trim().toLowerCase() !== "charset") continue;
    /* Double quotes were consumed above, as HTTP says they should be. Single
       quotes are not legal here at all, but they turn up, and stripping them
       costs a line. */
    const value = part.slice(at + 1).trim().replace(/^'(.*)'$/, "$1").trim();
    return value === "" ? null : value;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * What the document starts with
 * ------------------------------------------------------------------ *
 *
 * **One reading of the bytes, two thresholds over it.** Settled 2026-09-08 in
 * docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md,
 * after a substring search over the first 16 KB — which is what lived here
 * until then — was measured accepting JSON, an Atom feed, an RSS feed and an
 * SVG as web pages, and each of them went on to become a publishable article.
 *
 * The two callers are asking **different questions**, which is why they do not
 * share an answer:
 *
 *  - `sniffKind` on a vague content type asks *is there positive evidence this
 *    is HTML?* Nobody has claimed anything, so we need a reason to say yes.
 *  - `uploadedDocumentKind` asks *is there positive evidence this is something
 *    else?* The reader has already told us what the file is, and a false
 *    negative there is a legal file refused with copy that says sending it
 *    again will not help.
 *
 * **They differ in how much evidence they demand and in nothing else.** That
 * sentence is the whole of round 2 ⟨Sol F11–F14⟩: the first cut let the two
 * predicates disagree about *what the bytes said*, in both directions — a
 * browser-closed comment or a long UTF-16 comment made the fetched path say
 * `null` and the upload path say `html`, while a processing instruction or a
 * doctype'd feed did the reverse. Every one of those was the same structural
 * fault. Wherever the walk gave up, the veto read *"nothing proven against it"*
 * and accepted while the positive predicate read *"no evidence for it"* and
 * refused, so the filename decided the meaning of the bytes — which is the
 * body-wins rule, the one thing this module is for, inverted.
 *
 * So there is exactly one place that reads the bytes — `documentEvidence` —
 * producing three facts, and the two public functions are thresholds over those
 * facts and hold no byte logic of their own. `tests/fetch.test.ts` pins the
 * invariant directly: **evidence the fetched path found may never be
 * contradicted by a filename.**
 *
 * **What is the standard's and what is ours.** From the WHATWG MIME Sniffing
 * Standard's pattern-matching algorithm we take the **positional rule**:
 * signatures are matched at the leading position, never searched for later in
 * the resource. That is what makes `{"template":"<p>hello</p>"}` stop being a
 * web page, and it fixes the old `/<\s*html/` defect that let `< html>` through
 * for free, because there is no longer a search that can land mid-string.
 * Skipping BOMs, comments and an XML declaration, and taking a narrower
 * evidence set than the spec's table, are **ours** — the spec treats a leading
 * `<!--` as positive HTML evidence rather than as something to look past, and
 * classifies `<?xml` as XML rather than asking what its root element is.
 * Conflating the two is how the version before this one went wrong: it took the
 * spec's tag *list*, kept our own substring *semantics*, and cited the spec for
 * both. ⟨Sol F7⟩ Where the two standards disagree about a *skippable* thing we
 * follow the **HTML parsing** spec rather than the sniffing one, because what
 * we are really asking is what a browser would build: `--!>` closes a comment
 * and `<?…>` is a bogus comment, and both are cited where they are used.
 */

/**
 * A PDF header, as the format actually defines it: `%PDF-` and a version.
 *
 * Bare `%PDF-` anywhere in the first kilobyte is far looser than the spec, and
 * loose enough to be wrong — an HTML page containing
 * `<script>const h = "%PDF-1.7"</script>` in its head would be classified as a
 * PDF and never rendered.
 */
const PDF_HEADER = /%PDF-\d\.\d/;

/**
 * **A sequence of code units, read one at a time, without copying it.**
 *
 * Two implementations: the bytes themselves, and — for UTF-16, whose markup is
 * `<\0!\0d\0o…` and invisible to any byte scan — a 16-bit view over those same
 * bytes. One walker over an accessor is what stops those being two walkers that
 * drift, and it is what keeps ⟨Sol F6⟩ satisfied: **nothing file-sized is ever
 * materialised** to answer a question about the first tag. Out-of-range reads
 * answer `-1`, which matches nothing, so no caller needs a bounds check.
 *
 * **The view replaced a decoded 16 KB prefix**, which is ⟨Sol F11⟩: decoding
 * gave UTF-16 a horizon nothing else had, and a page whose first tag sat behind
 * a 9,000-character comment fell off it — visible to the upload path, invisible
 * to the fetched one. A view has no horizon, so `MARKUP_WINDOW` is gone rather
 * than enlarged, and the question "how far in do we look for the first tag" now
 * has one answer for every encoding: as far as the file goes.
 */
interface CodeUnits {
  readonly length: number;
  unit(index: number): number;
}

function overBytes(bytes: Uint8Array): CodeUnits {
  return { length: bytes.length, unit: (index) => bytes[index] ?? -1 };
}

/**
 * The same bytes read two at a time, which is all UTF-16 decoding amounts to
 * for the ASCII markup this asks about.
 *
 * `start` steps over the BOM, so index 0 is the first real character and every
 * caller can stay encoding-blind.
 */
function overUtf16(bytes: Uint8Array, littleEndian: boolean, start: number): CodeUnits {
  const length = Math.max(0, (bytes.length - start) >> 1);
  return {
    length,
    unit: (index) => {
      if (index < 0 || index >= length) return -1;
      const at = start + index * 2;
      const low = bytes[littleEndian ? at : at + 1] ?? 0;
      const high = bytes[littleEndian ? at + 1 : at] ?? 0;
      return low | (high << 8);
    },
  };
}

/**
 * **The bytes, read in whatever encoding they are actually in** — and the index
 * of the first character after any BOM.
 *
 * `html-encoding-sniffer` is the spec's own algorithm and jsdom's
 * implementation of it: BOM first, then the transport layer's charset, then a
 * `<meta charset>` prescan. We consult it for one thing only — is this UTF-16,
 * and which way round — because **UTF-16 is the entire set of encodings a byte
 * scan cannot read.** Every other encoding the WHATWG standard admits is
 * ASCII-compatible, so `<` is `0x3C` in all of them and the byte view is right;
 * and a page declaring `<meta charset="utf-16">` is required by the same spec
 * to be treated as UTF-8, so the prescan cannot mislead us here.
 *
 * A prefix is enough: the BOM is three bytes and the prescan is defined over
 * the first kilobyte. Nothing is decoded, which is what lets the walk stay
 * uncapped.
 */
function unitsFor(bytes: Uint8Array, contentType: string | null): { units: CodeUnits; start: number } {
  const label = charsetFromContentType(contentType);
  const encoding = sniffHTMLEncoding(bytes.subarray(0, 1024), {
    defaultEncoding: "windows-1252",
    ...(label === null ? {} : { transportLayerEncodingLabel: label }),
  });
  if (encoding === "UTF-16LE") {
    return { units: overUtf16(bytes, true, bytes[0] === 0xff && bytes[1] === 0xfe ? 2 : 0), start: 0 };
  }
  if (encoding === "UTF-16BE") {
    return { units: overUtf16(bytes, false, bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0), start: 0 };
  }
  const utf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return { units: overBytes(bytes), start: utf8Bom ? 3 : 0 };
}

/** The five bytes the MIME sniffing standard calls whitespace. */
function isSpaceUnit(unit: number): boolean {
  return unit === 0x09 || unit === 0x0a || unit === 0x0c || unit === 0x0d || unit === 0x20;
}

/**
 * What may follow a tag name: whitespace, `>`, or the `/` of a self-closing tag.
 *
 * Wider than the spec's tag-terminating byte, which is space or `>` only, and
 * deliberately so — `<html\n  lang="en">` is an ordinary page and the spec's
 * own table would miss it. The mask arithmetic in `whatwg-mimetype`'s table
 * (`0xE1`) is in fact looser still, matching every even byte in `0x20–0x3E`;
 * that is an artefact of expressing "space or `>`" as a bitmask, not an
 * intention worth copying.
 */
function isTagEnd(unit: number): boolean {
  return isSpaceUnit(unit) || unit === 0x3e || unit === 0x2f;
}

/** ASCII case-insensitive compare of a lowercase literal at `at`. */
function matchesLiteral(units: CodeUnits, at: number, literal: string): boolean {
  for (let i = 0; i < literal.length; i++) {
    const unit = units.unit(at + i);
    const lower = unit >= 0x41 && unit <= 0x5a ? unit + 0x20 : unit;
    if (lower !== literal.charCodeAt(i)) return false;
  }
  return true;
}

/** Exact compare, for the one token whose case the standard actually fixes. */
function matchesExactly(units: CodeUnits, at: number, literal: string): boolean {
  for (let i = 0; i < literal.length; i++) {
    if (units.unit(at + i) !== literal.charCodeAt(i)) return false;
  }
  return true;
}

/** Index of the first unit that is not skippable, and whether XML was declared. */
interface LeadingToken {
  at: number;
  /** An `<?xml … ?>` **declaration** was skipped — not merely a `<?…>` of some kind. */
  xmlProlog: boolean;
}

/**
 * **Where the document really begins**, and whether it announced itself as XML
 * on the way there.
 *
 * Skips, in a loop because they nest in any order: whitespace, comments, and
 * `<?…>`. The comment skipping is not a nicety — the tutorial page that caused
 * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md carries 4102 bytes
 * of quoted request in front of its first tag, and
 * docs/reusable/write-tutorial.md prescribes exactly that shape, so it is the
 * template being followed rather than a one-off.
 *
 * **A comment ends at `-->` or at `--!>`, whichever comes first** ⟨Sol F12⟩.
 * The second is an *incorrectly-closed comment*: the HTML parser raises a parse
 * error and closes the comment anyway, so every browser reads the document
 * behind it and so must we. Taking the earliest of the two matters as much as
 * knowing both — a `--!>` sitting inside a normally-closed comment would
 * otherwise swallow the document after it.
 * https://html.spec.whatwg.org/multipage/parsing.html#parse-error-incorrectly-closed-comment
 *
 * **`<?xml` is a declaration only when it is spelled exactly that way and
 * followed by whitespace** ⟨Sol F13⟩. A case-insensitive prefix match calls
 * `<?xml-stylesheet href="x.css"?>` a declaration, which set the XML flag on a
 * perfectly ordinary styled page and had the two predicates answer oppositely.
 * Any other `<?…>` is a processing instruction, which the HTML parser treats as
 * a bogus comment ending at the first `>` — so it is skipped too, and the
 * document behind it is still the document.
 * https://html.spec.whatwg.org/multipage/parsing.html#parse-error-disallowed-processing-instruction-target
 *
 * **There is no prefix cap here**, which is ⟨Sol F6⟩ answered: a licence header
 * or an unterminated comment pushes the first tag past any window we would pick,
 * and the input is already bounded by the 32 MB fetch cap and the 50 MB upload
 * cap. The walk is linear and stops at the first non-skippable unit, so the
 * common case reads a handful of them.
 *
 * `from` exists so the XML root check can carry on walking from behind a
 * doctype; the BOM is already behind us, because the view chose it.
 */
/**
 * **Where a comment ends** — the index just past its `>`, or `-1` if it never
 * closes. `at` is the index of the opening `<`.
 *
 * **A three-character window, slid one unit at a time, reading every byte of
 * the comment exactly once.** That is deliberately not the obvious thing, and
 * it took three rounds of review to arrive at, so here is the whole argument.
 *
 * `Buffer.indexOf` looks like the right tool and is a trap in two directions,
 * both measured on this box:
 *
 *  - **It costs about 300 ns per call whatever the size of the haystack.** So
 *    any design that makes one call per comment, or per terminator candidate,
 *    loses on a file made of many small comments — 1.8 M of them is 16 MiB of
 *    perfectly ordinary bytes and cost about a second.
 *  - **It degrades to 151 ms per 16 MiB when the haystack repeats the needle's
 *    prefix** — searching for `-->` through a run of `-` is its bad case.
 *
 * Every native-search variant we tried therefore had *some* stuffing character
 * that punished it, and each round found the next one: searching for `-->` and
 * `--!>` separately was quadratic on empty comments ⟨F17⟩; scanning for `>` and
 * looking backwards cost 2.4 s on 16 MiB of `>` ⟨F23⟩; bounding the second
 * search by the first fixed that and cost 689 ms on 16 MiB of `-`.
 *
 * **A `unit()` read is 6.6 ns and does not care what the byte is.** This loop
 * measures 64–145 ms per 16 MiB across dashes, `>`, ordinary text and a million
 * small comments alike — worse than a native scan at its best and better than
 * any of them at their worst, which is the trade a server wants. Its cost is a
 * function of length alone, so **there is no input that makes it slower**, and
 * that is worth more here than the 50× the native scan wins on a benign 16 MiB
 * comment nobody has ever sent us. The ceiling tests in tests/fetch.test.ts
 * hold both shapes.
 *
 * **Which `>` closes a comment is the HTML parser's answer rather than a
 * guess.** `-->` always does, and the window is seeded with the opener's own
 * two dashes so that it may close immediately: that is exactly the spec's
 * *abrupt closing of an empty comment*, which is why `<!-->` and `<!--->` close
 * without either being special-cased ⟨Sol F18⟩. `--!>` — an *incorrectly-closed
 * comment*, a parse error that closes anyway — may not reach back that far: it
 * closes only when its `--` is comment *data*, which is the whole difference
 * between `<!--!>`, which a browser never closes, and `<!-->`, which it does.
 * https://html.spec.whatwg.org/multipage/parsing.html#comment-start-state
 */
function commentEnd(units: CodeUnits, at: number): number {
  const first = at + 4;
  let back3 = -1;
  let back2 = units.unit(at + 2);
  let back1 = units.unit(at + 3);
  for (let i = first; i < units.length; i++) {
    const unit = units.unit(i);
    if (unit === 0x3e) {
      if (back1 === 0x2d && back2 === 0x2d) return i + 1;
      if (back1 === 0x21 && back2 === 0x2d && back3 === 0x2d && i - 3 >= first) return i + 1;
    }
    back3 = back2;
    back2 = back1;
    back1 = unit;
  }
  return -1;
}

/**
 * **Where a `<?…>` ends** — the index just past its `>`, or `-1`.
 *
 * Walked rather than searched, for the reason `commentEnd` argues at length: a
 * file of `<?a?>` is a file of tiny constructs, and a native call each is the
 * cost that keeps coming back.
 *
 * **The first `>` ends it, declaration or not** — which is the HTML parser's
 * rule: everything opening `<?` is a *bogus comment* to it, and that is what
 * skips `<?xml-stylesheet href="x.css"?>` and leaves the document behind it
 * still the document ⟨Sol F13⟩.
 * https://html.spec.whatwg.org/multipage/parsing.html#parse-error-disallowed-processing-instruction-target
 *
 * **XML would end a declaration at `?>` instead, and that branch was written
 * and then removed**, because it cannot be reached by any real file: the only
 * things a declaration may contain are a version, an encoding name and
 * `standalone`, none of which can hold a `>`. It also disagreed with stage 2 —
 * `new JSDOM(html)` runs the HTML parser — which is the same reason the DTD
 * lexer went. A branch with no reachable case is a branch whose behaviour
 * nothing pins, so it is better not written than written and mutated at.
 */
function instructionEnd(units: CodeUnits, at: number): number {
  for (let i = at + 2; i < units.length; i++) if (units.unit(i) === 0x3e) return i + 1;
  return -1;
}

function leadingToken(units: CodeUnits, from: number): LeadingToken {
  let at = from;
  let xmlProlog = false;
  for (;;) {
    while (at < units.length && isSpaceUnit(units.unit(at))) at++;
    if (matchesLiteral(units, at, "<!--")) {
      const end = commentEnd(units, at);
      if (end === -1) return { at: units.length, xmlProlog };
      at = end;
      continue;
    }
    if (units.unit(at) === 0x3c && units.unit(at + 1) === 0x3f) {
      const declaration = matchesExactly(units, at, "<?xml") && isSpaceUnit(units.unit(at + 5));
      if (declaration) xmlProlog = true;
      const end = instructionEnd(units, at);
      if (end === -1) return { at: units.length, xmlProlog };
      at = end;
      continue;
    }
    return { at, xmlProlog };
  }
}

/**
 * **The positive predicate: a document-level tag, at the leading position.**
 *
 * The list is the WHATWG MIME Sniffing Standard's HTML rows — read out of
 * `node_modules/whatwg-mimetype/lib/sniff.js`, which is a faithful
 * implementation of the table and is already in the tree under jsdom — minus
 * its body-level and component-level rows, plus three of ours. The full table
 * is:
 *
 * > `<!DOCTYPE HTML` `<HTML` `<HEAD` `<SCRIPT` `<IFRAME` `<H1` `<DIV` `<FONT`
 * > `<TABLE` `<A` `<STYLE` `<TITLE` `<B` `<BODY` `<BR` `<P` `<!--`
 *
 * **What we drop, and why it is not the old subset's reason.** The old code
 * dropped `<A`, `<B`, `<P`, `<DIV`, `<BR` and friends because they are short
 * enough to turn up inside JSON and templates — an argument about *searching*,
 * which anchoring has now retired. The reason now is different and narrower:
 * `<div>`, `<p>`, `<h1>`, `<table>`, `<a>`, `<b>`, `<br>`, `<font>` and
 * `<iframe>` open a **fragment** just as readily as a document, and this
 * predicate runs where nothing has claimed anything, so a fragment is not a
 * reason to say yes.
 *
 * **`<script>` and `<style>` went the same way in round 2** ⟨Sol F9⟩: they are
 * how a Svelte or Vue component file opens, and Sol put one through
 * `readArticle` and got 7,209 characters with no refusal — a source file
 * published as an article. This is where the two-predicate design earns itself:
 * removing them costs the **upload** path nothing at all, because a component
 * named `.html` is not provably another format and reaches stage 2 through the
 * veto regardless. Narrowing the positive set is free where a claim exists and
 * only binds where there is no claim, which is exactly where it should.
 *
 * **`<!--` is dropped for a third reason**: we look *past* a comment rather
 * than counting it, which is what tells `<!-- generated --><feed>` apart from
 * `<!-- saved from url --><!doctype html>`. ⟨Sol F3⟩
 *
 * **`meta`, `link` and `base` are ours**, on the same argument as the spec's
 * `title`: they are what a document *head* carries, and a page that opens at
 * `<meta charset>` is ordinary. Nothing else on this list belongs to any other
 * vocabulary.
 */
const HTML_LEADING_TAGS = ["html", "head", "body", "title", "meta", "link", "base"];

function startsHtmlDocument(units: CodeUnits, at: number): boolean {
  if (units.unit(at) !== 0x3c) return false;
  if (startsDoctypeHtml(units, at)) return true;
  for (const tag of HTML_LEADING_TAGS) {
    if (matchesLiteral(units, at + 1, tag) && isTagEnd(units.unit(at + 1 + tag.length))) return true;
  }
  return false;
}

/** `<!doctype html`, with the run of whitespace the spec's fixed pattern cannot express. */
function startsDoctypeHtml(units: CodeUnits, at: number): boolean {
  if (!matchesLiteral(units, at + 1, "!doctype")) return false;
  let i = at + 9;
  if (!isSpaceUnit(units.unit(i))) return false;
  while (isSpaceUnit(units.unit(i))) i++;
  return matchesLiteral(units, i, "html") && isTagEnd(units.unit(i + 4));
}

/**
 * **After an XML declaration, does the document declare itself HTML** — by its
 * root element, or by its doctype?
 *
 * **A doctype's name *is* the vocabulary, and that is the whole of it.** This
 * function briefly did more: ⟨Sol F14⟩ pointed out that answering `yes` on a
 * doctype never looked at the root, so `<?xml?><!doctype html><feed>` passed,
 * and the fix skipped the doctype — subset, quoted literals and all — to reach
 * the first element. That went again a day later, and the reasons are worth
 * keeping because they are why this is the last word rather than a stopping
 * point.
 *
 *  1. **The line it defended is not one the design holds.** `<!doctype html>
 *     <feed>` with no prolog is accepted on both paths, and always has been —
 *     `<!doctype html` is sufficient positive evidence by itself. Adding a
 *     prolog is 21 bytes and must not reverse the answer: one document, one
 *     reading, whatever is in front of it.
 *  2. **Skipping a doctype properly means parsing a DTD**, and that is a
 *     treadmill rather than a task. The version that shipped tracked quoted
 *     literals and one level of `[`; a nested bracket defeated it, and so did
 *     an apostrophe in an English comment inside the subset — *can't* opened a
 *     literal that never closed, and a perfectly ordinary hand-written entity
 *     subset was refused outright. Nesting-depth would not have fixed the
 *     second: comments and processing instructions inside a subset are not
 *     declarations, and telling them apart is a DTD parser.
 *  3. **It modelled a grammar nothing downstream applies.** Stage 2 is
 *     `new JSDOM(html)` with no content type, so the **HTML** parser runs, and
 *     its rule for `<!DOCTYPE html [` is to end at the first `>` and let `]>`
 *     fall into the body text. We were being stricter than the thing that
 *     actually reads the file.
 *
 * The neighbours are not the same shape and are not on the same treadmill:
 * `commentEnd` and the processing-instruction skip each find **one delimiter**
 * and cite the HTML parsing spec for it. This one was reading the *inside* of a
 * construct, which is why it alone kept producing findings.
 *
 * So the veto's rule now reads: **an XML prolog whose document does not declare
 * itself HTML, by root or by doctype, is another vocabulary.** `<?xml?><rss>`
 * and `<?xml?><!DOCTYPE svg …>` are still refused, because neither says `html`.
 */
function xmlRootIsHtml(units: CodeUnits, at: number): boolean {
  if (units.unit(at) !== 0x3c) return false;
  if (startsDoctypeHtml(units, at)) return true;
  return matchesLiteral(units, at + 1, "html") && isTagEnd(units.unit(at + 5));
}

/** How much of a resource the MIME sniffing standard looks at: its resource header. */
const RESOURCE_HEADER = 1445;

/**
 * **The standard's own answer to *is this text at all*.**
 *
 * A binary data byte is any of `0x00–0x08`, `0x0B`, `0x0E–0x1A`, `0x1C–0x1F`,
 * as `distinguishTextOrBinary` in `whatwg-mimetype/lib/sniff.js` defines it.
 *
 * **One rule, not a list of formats**, and that is the whole point of choosing
 * it: read as bytes, PNG, JPEG, GIF, ZIP and everything built on ZIP (docx,
 * epub), gzip, MP4, WebM, legacy Office and a renamed video are all caught
 * without anybody enumerating them. An enumeration is the open-ended blocklist
 * this design rejected — the next format nobody thought of needs another entry,
 * and nobody adds it until a reader is refused, which is the shape of the bug
 * being fixed here.
 *
 * **"Read as bytes" is load-bearing in that sentence** ⟨Sol, round 2⟩. Behind a
 * UTF-16 BOM the same file is read two bytes at a time, so `07 41` is the
 * perfectly ordinary character `U+4107` and binary data can pass this rule. It
 * is a narrow hole and a shallow one: such a file has no leading HTML evidence
 * either, so all it buys is a trip to stage 2 and a sentence saying there is no
 * article in it. Widening the rule to catch it would mean guessing which code
 * points are "really" text, which is the open-ended list again.
 *
 * **We skip a BOM rather than stopping at one, which the spec does not**
 * ⟨Sol F16⟩. The standard returns *text* the moment it sees any BOM and looks
 * no further; that is right for a browser choosing how to render, and wrong for
 * the claim in the paragraph above, because three bytes in front of a PNG
 * defeated it. So this runs over the units *after* the BOM — and for UTF-16
 * over decoded code units, which asks the same question in the units that file
 * is made of, rather than exempting the rest of the bytes wholesale. That is
 * also what reads a real BOM'd UTF-16 page, whose every other byte is `0x00`.
 *
 * The other side of it: **BOM-less UTF-16 is refused on the upload path**,
 * decided rather than discovered — nothing names its encoding, so it is read as
 * bytes, and its `0x00`s are indistinguishable from binary. Pinned by a test.
 */
function hasBinaryDataUnit(units: CodeUnits, from: number): boolean {
  const end = Math.min(units.length, from + RESOURCE_HEADER);
  for (let i = from; i < end; i++) {
    const unit = units.unit(i);
    if (unit <= 0x08 || unit === 0x0b || (unit >= 0x0e && unit <= 0x1a) || (unit >= 0x1c && unit <= 0x1f)) {
      return true;
    }
  }
  return false;
}

/**
 * **What the bytes say, read once**, for two callers that demand different
 * amounts of it.
 *
 * Three facts off one walk over one encoding-aware view. Both public functions
 * are thresholds over these and contain no byte logic of their own, which is
 * the structural answer to ⟨Sol F11–F14⟩ rather than four separate patches: the
 * old code let each caller reach its own conclusion about the same file, and
 * four different ways of giving up became four disagreements.
 */
interface DocumentEvidence {
  /** The leading token is a document-level HTML tag, and nothing contradicts it. */
  leadingHtml: boolean;
  /** An XML declaration whose root element is not `<html>`. */
  otherVocabulary: boolean;
  /** The WHATWG binary-data test, over the units the encoding actually implies. */
  binary: boolean;
}

function documentEvidence(bytes: Uint8Array, contentType: string | null): DocumentEvidence {
  const { units, start } = unitsFor(bytes, contentType);
  const token = leadingToken(units, start);
  const otherVocabulary = token.xmlProlog && !xmlRootIsHtml(units, token.at);
  return {
    /* A document that has declared itself another vocabulary has no HTML
       evidence *either*. Without this the two predicates could still answer
       oppositely about one file — `<?xml?><!doctype html><feed>` being exactly
       that — and "they differ in how much evidence they demand, not in what the
       bytes say" would be a comment rather than a property. */
    leadingHtml: !otherVocabulary && startsHtmlDocument(units, token.at),
    otherVocabulary,
    binary: hasBinaryDataUnit(units, start),
  };
}

/**
 * **The whole reading of one file, done once** — the kind, and the evidence
 * behind it.
 *
 * ⟨Sol F21.⟩ `uploadedDocumentKind` used to call `sniffKind` and then compute
 * the evidence over again, so every upload walked its own bytes twice — which
 * is also what doubled the cost of the P0 above it. Sharing one result is the
 * point of this type: the public functions differ in what they *do* with the
 * evidence, never in what they read.
 */
interface Classified {
  kind: DocumentKind | null;
  evidence: DocumentEvidence;
}

function classify(contentType: string | null, bytes: Uint8Array): Classified {
  /* 1030 rather than 1024, so a header starting at byte 1021 isn't cut in half
     by the window it is being looked for in. */
  const head = latin1(bytes.subarray(0, 1030));
  const pdfAt = PDF_HEADER.exec(head)?.index ?? -1;
  const evidence = documentEvidence(bytes, contentType);
  return { kind: kindFrom(mimeType(contentType), pdfAt, evidence), evidence };
}

/**
 * **The order of these four answers is the detector's contract**, and two
 * rounds of review found it wrong in two different places.
 *
 * ⟨Sol F5⟩ `%PDF-` used to be consulted and returned before any HTML evidence,
 * so `sniffKind(null, "<!doctype html>…About %PDF-1.7 files…")` came back
 * `"pdf"` and an ordinary page went to the transcriber. The suite was green
 * over it because the one test that asked passed `"text/html"`, which
 * short-circuits two lines above the branch it meant to check: a test sharing
 * an assumption with the code (docs/reusable/silent-success.md).
 *
 * ⟨Sol F10⟩ Fixing that by putting the HTML claim in front of `pdfAt > 0`
 * inverted the rule this module exists for: `\n%PDF-1.7\n1 0 obj…` named
 * `.html` came back `"html"`, so a claim beat bytes the detector had already
 * recognised. Both mistakes cost money in opposite directions — an empty
 * article, or a transcription bill for a web page.
 *
 * So: **byte zero is unconditional**, because that is where the format puts its
 * header and nothing else legitimately starts there; a `%PDF-` further in is
 * beaten by leading HTML evidence and by nothing else, a claim included.
 */
function kindFrom(mime: string | null, pdfAt: number, evidence: DocumentEvidence): DocumentKind | null {
  if (pdfAt === 0) return "pdf";
  if (pdfAt > 0) return evidence.leadingHtml ? "html" : "pdf";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  /* No usable header, or a server shrugging with octet-stream: believe what the
     document starts with. A feed served honestly as `application/rss+xml` is
     refused here without the bytes being consulted at all, which is the
     narrowing the plan relies on. */
  const mimeIsVague =
    mime === null || mime === "text/plain" || mime === "application/octet-stream" || mime === "application/pdf";
  return mimeIsVague && evidence.leadingHtml ? "html" : null;
}

/**
 * HTML, PDF, or something we can't read.
 *
 * **How much the bytes decide depends on how much the header committed to**,
 * and the shorter slogan this docstring used to carry — *the body wins* — was
 * too broad to be a rule ⟨Sol, round 2⟩. Overstating it is how F14 was reviewed
 * and approved, so what it actually does, in the order `kindFrom` does it:
 *
 *  - **`%PDF-` at byte zero wins over everything.** A PDF served as
 *    `application/octet-stream` is still a PDF.
 *  - **A `%PDF-` further in loses only to leading HTML evidence** — a page that
 *    talks about PDFs — and beats every claim, header and filename alike.
 *  - **An explicit `text/html` or `application/xhtml+xml` is believed.** The
 *    body does *not* win here: a server that committed to HTML is trusted, and
 *    the only thing that overrides it is the PDF header above. This is why a
 *    Cloudflare challenge page served as `application/pdf` is caught (that
 *    header is vague, not a commitment) and an Atom feed served honestly as
 *    `text/html` is not.
 *  - **A vague or absent header is decided by the bytes alone**, which is the
 *    branch everything below this comment exists for.
 */
export function sniffKind(contentType: string | null, bytes: Uint8Array): DocumentKind | null {
  return classify(contentType, bytes).kind;
}

/**
 * **The same two kinds, asked of a file somebody uploaded** — html, pdf, or
 * nothing we can read.
 *
 * Here rather than in src/source.ts, which is otherwise the upload module and
 * where `looksLikePdf` lived: that file imports `canonicalKey`'s neighbours
 * *from* here, so a value import the other way is an import cycle and
 * `npm run cycles` is a gate. Both halves of stage 1 are stage 1, and this is
 * where the byte-level primitives already are.
 *
 * **It is not the same question as `sniffKind`, and that is the change of
 * 2026-09-08.** An upload carries no `Content-Type`; the only claim is a
 * filename the reader chose, and this branch is not a tiebreaker over a rare
 * case — it is the whole decision, on every file, for somebody holding a file
 * with no other way in. Reusing a fall-through heuristic in that position is
 * the class named in
 * docs/postmortems/260907c-a-heuristic-promoted-to-a-gate.md: *a check keeps
 * its old standard of evidence when it is moved to a position that demands a
 * new one*. So the standard changes with the position — look for evidence
 * **for** HTML when the header is missing, and evidence **against** it when the
 * reader has already told you what the file is.
 *
 * **Positive evidence is checked first, and that ordering is load-bearing.**
 * It says a file the fetched path would call a web page is one here too,
 * whatever it is named — the invariant round 2 was refused for breaking. It is
 * also what reads a BOM'd UTF-16 page: half its bytes are `0x00`, so the veto
 * below would refuse it on evidence that is really an artefact of its encoding.
 *
 * **What it deliberately lets through** is far more than the old check did: a
 * `<div>` fragment, a page of prose, a Svelte component, a custom-element root,
 * a prolog-less feed. Stage 2 refuses those with a sentence about the thing
 * that is actually wrong with them, at no cost and with the reader's slot
 * released. Guessing at the article from the bytes is stage 2's job, and
 * pretending otherwise is what refused one of our own tutorial pages in
 * production.
 */
export function uploadedDocumentKind(filename: string, bytes: Uint8Array): DocumentKind | null {
  const claimed = uploadContentType({ name: filename, type: "", size: bytes.byteLength });
  const { kind, evidence } = classify(claimed, bytes);
  /* `null`, or a PDF the bytes carry. Neither wants a second opinion. */
  if (kind !== "html") return kind;
  if (evidence.leadingHtml) return "html";
  return evidence.otherVocabulary || evidence.binary ? null : "html";
}

/**
 * Bytes as characters, one for one. Only ever used to look at markup, never to
 * keep.
 *
 * **`Buffer`, not a `String.fromCharCode` loop.** Measured on the box —
 * `sniffKind`, 2000 calls after a warm-up, over the real 106 KB upload that
 * caused all this: **30 µs** with the loop at 1030 bytes, **509 µs** with the
 * loop at 16 KB, **13 µs** with this. Since 2026-09-08 the only caller is the
 * 1030-byte PDF head — everything else reads the buffer in place and builds no
 * string at all — so the wide case no longer arises, and the measurement is
 * kept because it is what would be re-derived if somebody widened it again.
 *
 * **Node's `latin1` is the one-for-one mapping this needs**, and that is not a
 * given: the WHATWG encoding standard makes the labels `latin1` and
 * `iso-8859-1` aliases for **windows-1252**, so `new TextDecoder("latin1")`
 * would rewrite 0x80–0x9F into typographic characters. `Buffer`'s `latin1` is
 * the older meaning — byte `n` becomes `U+00n`, all 256 of them — which is what
 * keeps `PDF_HEADER.exec(head).index` an offset into the bytes rather than into
 * a decoding of them. Do not swap one for the other.
 */
function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

/**
 * Decode HTML bytes with the encoding the page actually uses.
 *
 * The order — BOM, then the `Content-Type` charset, then a prescan of the first
 * kilobyte for `<meta charset>`, then a default — is the HTML spec's own
 * algorithm, and `html-encoding-sniffer` is the implementation jsdom uses for
 * exactly this. It is already in the tree as jsdom's dependency; declaring it
 * directly is what stops us reaching through jsdom for it.
 *
 * The default is windows-1252 rather than UTF-8 because that is what the spec
 * and every browser do for `text/html` with nothing declared. It costs nothing
 * on an ASCII page, which is what pages that declare nothing almost always are.
 *
 * **The decoder is not Node's**, and the reason has moved since it was written.
 * Originally: `new TextDecoder("windows-1252")` reported its encoding as
 * `windows-1252` and then decoded the C1 range the way ISO-8859-1 does, so byte
 * 0x93 became U+0093, an invisible control character, where every browser gives
 * U+201C. That is the punctuation of ordinary English prose going missing with
 * nothing raised and nothing logged — docs/reusable/silent-success.md in its
 * purest form. **Node fixed the single-byte encodings in 24.13.1**, and this
 * paragraph no longer describes any Node we would run on.
 *
 * What it still describes is the multi-byte legacy encodings. Those go through
 * ICU, and ICU is not the WHATWG index: Shift_JIS 0x1A/0x1C/0x7F come back
 * rotated and 0x80 is refused, Big5 accepts 0x80 and 0xFF that the spec calls
 * errors, EUC-JP and EUC-KR pass the whole C1 range through. Same failure
 * shape, different alphabet. So `@exodus/bytes` stays. It implements the WHATWG
 * indexes properly, is already in the tree as html-encoding-sniffer's own
 * dependency, and is what that package's README tells you to pair it with.
 *
 * docs/project/fetching.md#the-decoder-is-not-nodes has the measurements and
 * the command to re-run them; the postmortem is
 * docs/postmortems/260826b-windows-1252-node-caught-up.md.
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): { text: string; encoding: string } {
  const label = charsetFromContentType(contentType);
  /* XHTML is XML, and XML's rules are not HTML's: no `<meta charset>` prescan,
     and UTF-8 rather than windows-1252 when nothing says otherwise. Handing XML
     to the HTML algorithm turns a perfectly ordinary UTF-8 document into
     `caf├⌐`, because windows-1252 will decode any byte sequence at all and so
     can never fail loudly. */
  const xml = mimeType(contentType) === "application/xhtml+xml";
  const encoding = sniffHTMLEncoding(bytes, {
    xml,
    defaultEncoding: xml ? "UTF-8" : "windows-1252",
    ...(label === null ? {} : { transportLayerEncodingLabel: label }),
  });
  try {
    return { text: new SpecTextDecoder(encoding).decode(bytes), encoding };
  } catch {
    /* An encoding the sniffer named and the decoder doesn't know — which should
       be impossible, since both implement the same WHATWG list. Mojibake beats
       nothing, but record the encoding we actually used so the artefact says
       the text is suspect rather than implying it is fine. */
    return { text: new SpecTextDecoder("UTF-8").decode(bytes), encoding: "UTF-8" };
  }
}

/* ------------------------------------------------------------------ *
 * Classifying what went wrong
 * ------------------------------------------------------------------ */

/** `Retry-After`, as milliseconds. Accepts both the seconds form and the HTTP-date form. */
export function retryAfterMs(header: string | null, now: Date): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  return Math.max(0, when - now.getTime());
}

/**
 * An HTTP status we didn't want, as a failure worth reading.
 *
 * The distinctions that matter to a reader are "the site is blocking software
 * like this", "you need to be logged in", and "it isn't there" — three
 * different next actions. Everything else can share a sentence.
 */
export function classifyStatus(status: number, url: string, retryAfter: number | null): FetchFailure {
  const extra = { status, retryAfterMs: retryAfter };
  if (status === 401) {
    return new FetchFailure("unauthorized", url, "That page wants you logged in.", extra);
  }
  if (status === 403) {
    return new FetchFailure(
      "forbidden",
      url,
      "That site refused the request. Sites that police automated readers usually answer this way.",
      extra,
    );
  }
  if (status === 404 || status === 410) {
    return new FetchFailure("not-found", url, "There's nothing at that address.", extra);
  }
  if (status === 429) {
    return new FetchFailure("rate-limited", url, "That site is asking us to slow down.", {
      ...extra,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new FetchFailure("server-error", url, `That site is having trouble (HTTP ${status}).`, {
      ...extra,
      retryable: status === 502 || status === 503 || status === 504,
    });
  }
  return new FetchFailure("http-error", url, `Couldn't fetch that page (HTTP ${status}).`, extra);
}

/** Node error codes that mean "the same request might work in a moment". */
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET"]);

/**
 * A thrown `fetch` error, as a failure worth reading.
 *
 * This is the function the whole error taxonomy exists for. Every case below
 * arrives as the same `TypeError: fetch failed`, and `cause.code` is the only
 * thing that separates them.
 */
export function classifyNetworkError(err: unknown, url: string): FetchFailure {
  if (err instanceof FetchFailure) return err;

  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") {
    return new FetchFailure("timeout", url, "That site took too long to answer.", {
      retryable: true,
      cause: err,
    });
  }
  if (name === "AbortError") {
    return new FetchFailure("timeout", url, "Fetch cancelled.", { cause: err });
  }

  /* Two shapes, because two different APIs throw here. `fetch` wraps the real
     error and puts the code on `cause`; `dns.lookup`, which the address guard
     calls first, puts it on the error itself. Reading only `cause.code` — the
     obvious spelling, and the one this had at first — turns every DNS failure
     into a generic connection failure, with the giveaway `getaddrinfo` text
     visible in the message and nothing acting on it. */
  const code = errorCode(err instanceof Error ? err.cause : undefined) || errorCode(err);

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return new FetchFailure("dns", url, `Couldn't find the server for ${safeHost(url)}.`, {
      retryable: code === "EAI_AGAIN",
      cause: err,
    });
  }

  /* Certificate-specific codes, deliberately not `/SSL/`: that also matches
     ERR_SSL_WRONG_VERSION_NUMBER, which is a handshake failure with nothing
     wrong with the certificate, and telling someone their certificate is broken
     when it isn't sends them somewhere useless. */
  if (/^(UNABLE_TO_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|ERR_TLS_CERT)/.test(code)) {
    return new FetchFailure("certificate", url, certificateMessage(code), { cause: err });
  }

  if (code !== "") {
    return new FetchFailure("connection", url, `Couldn't reach ${safeHost(url)} (${code}).`, {
      retryable: RETRYABLE_CODES.has(code),
      cause: err,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new FetchFailure("connection", url, `Couldn't reach ${safeHost(url)}: ${message}`, {
    cause: err,
  });
}

/**
 * What to say about a certificate, and why the incomplete-chain case gets its
 * own paragraph.
 *
 * `UNABLE_TO_VERIFY_LEAF_SIGNATURE` means the server sent its own certificate
 * and forgot the intermediate one above it. Browsers and curl repair this
 * silently by fetching the missing certificate from the address written inside
 * the one they were given; **Node does not, and has no plan to**. So the site
 * works perfectly in the browser the reader just checked it in, and fails here,
 * which is the most confusing shape a bug can have. Say so.
 */
function certificateMessage(code: string): string {
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return (
      "That site's certificate is incomplete — it didn't send the intermediate certificate. " +
      "Browsers fetch the missing one automatically and Node doesn't, which is why the page " +
      "opens fine in a browser. Running with NODE_OPTIONS=--use-system-ca sometimes works, " +
      "because the system may already hold the missing certificate."
    );
  }
  if (code === "CERT_HAS_EXPIRED") return "That site's certificate has expired.";
  return `That site's certificate couldn't be verified (${code}).`;
}

/** A Node error's `code`, wherever it was hung. */
function errorCode(value: unknown): string {
  if (typeof value === "object" && value !== null && "code" in value) {
    const code: unknown = (value as { code: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * How long to wait before trying again.
 *
 * `Retry-After` wins where the server sent one — it is the only party that
 * knows. Otherwise exponential backoff with **full** jitter: a delay drawn
 * uniformly from zero to the ceiling, rather than the ceiling nudged a little.
 * Nobody is being thundered here, but it is one multiplication.
 */
export function retryDelayMs(attempt: number, serverAsked: number | null, random: () => number): number {
  if (serverAsked !== null) return Math.min(serverAsked, 10_000);
  const ceiling = Math.min(500 * 2 ** (attempt - 1), 4_000);
  return Math.round(random() * ceiling);
}

/* ------------------------------------------------------------------ *
 * The fetch itself
 * ------------------------------------------------------------------ */

/**
 * Let go of a response we aren't going to read.
 *
 * Every path that throws before reading the body has to do this or the socket
 * stays open with the server still streaming into it. `cancel()` can itself
 * reject on a body already disturbed or errored, and that rejection would
 * escape as an unclassified error on top of the real one — so it is swallowed
 * deliberately: we are discarding this response either way.
 */
async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * What a caller of `fetchBytes` supplies: the headers this kind of request
 * sends, and what to make of the first response that isn't a redirect.
 *
 * Two fields rather than a flag, because the two callers differ in exactly
 * these two ways and in nothing else. Everything security-relevant — the
 * address guard, the pin, the hop cap, the deadline, the byte cap — is below
 * this line and neither caller can reach it.
 */
interface BytesSpec<T> {
  /** A function of the resolved options, so the User-Agent default lives in one place. */
  headers: (opts: Resolved) => Record<string, string>;
  read: (res: Response, finalUrl: string, chain: string[], opts: Resolved) => Promise<T>;
}

/**
 * **The whole of the network path, and private on purpose.**
 *
 * The retry loop, the redirect hops, the address guard and its pin, the
 * deadline and the byte cap — one copy of each, shared by `fetchDocument` and
 * `fetchAsset`. It is deliberately **not** exported and deliberately narrow:
 * the two callers above it are the only shapes it serves, and a third caller
 * wanting "just the bytes of anything" is how a module like this grows a way
 * around its own guards. Add a named caller here instead.
 *
 * Redirects are followed by hand rather than by `redirect: "follow"`, which is
 * a deliberate cost. Following them ourselves is the only way to cap the hops
 * at a number we chose, to check each new address before dialling it, and to
 * keep the chain — and the chain is worth keeping, because "this resolved
 * somewhere else" is most of the explanation when an article turns out to be a
 * paywall notice.
 */
async function fetchBytes<T>(input: string, options: FetchOptions, spec: BytesSpec<T>): Promise<T> {
  const opts = withDefaults(options);
  const target = parseTarget(input);

  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptFetch(target, input.trim(), opts, spec);
    } catch (err) {
      const failure = classifyNetworkError(err, input.trim());
      if (!failure.retryable || attempt >= opts.attempts) throw failure;
      /* Under the caller's signal, not the attempt's: each attempt gets a fresh
         deadline, but a queue that has been cancelled should not sit out a
         four-second backoff first. */
      const waiting = opts.sleep(retryDelayMs(attempt, failure.retryAfterMs, opts.random));
      await (opts.signal ? underSignal(waiting, opts.signal, input.trim()) : waiting);
    }
  }
}

/**
 * The headers a *document* request sends.
 *
 * `Accept` names the two things stage 1 can read, and `Accept-Language` is a
 * browser-shaped courtesy that goes with the browser-shaped User-Agent. Both
 * are on the document path only — an image request has no use for either, and
 * sending an HTML-first `Accept` for a PNG invites a content-negotiating server
 * to hand back a web page.
 */
function documentHeaders(opts: Resolved): Record<string, string> {
  return {
    "User-Agent": opts.userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    /* No Accept-Encoding on purpose. undici sets it and decompresses for
       us; setting it by hand is how you accidentally turn that off. */
  };
}

/**
 * Fetch a URL and say what came back.
 *
 * The document-shaped caller of `fetchBytes`: it adds the headers above, the
 * `sniffKind` refusal and the encoding sniff, and nothing else.
 */
export async function fetchDocument(input: string, options: FetchOptions = {}): Promise<FetchedDocument> {
  return await fetchBytes(input, options, {
    headers: documentHeaders,
    read: (res, finalUrl, chain, opts) => readDocument(res, input.trim(), finalUrl, chain, opts),
  });
}

/** The same fetched thing? The fragment is never sent, so it cannot make it different. */
function sameResource(seen: string, candidate: URL): boolean {
  const bare = new URL(candidate.toString());
  bare.hash = "";
  try {
    const other = new URL(seen);
    other.hash = "";
    return other.toString() === bare.toString();
  } catch {
    return false;
  }
}

/**
 * Where a redirect points, or the failure that says why we won't follow it.
 *
 * Split out of the hop loop below rather than inlined, so that loop stays
 * readable — and because every branch here is a refusal, which makes them
 * easier to find in one place. The caller has already discarded the response:
 * this function never touches the body.
 */
function redirectTarget(
  location: string | null,
  status: number,
  current: URL,
  here: string,
  chain: string[],
): URL {
  if (!location) {
    throw new FetchFailure("http-error", here, `That site redirected without saying where (HTTP ${status}).`, {
      status,
    });
  }
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    // **Not the header.** `location` is written by the remote server, and a
    // `FetchFailure` message is logged — a failed fetch step reaches
    // src/jobs.ts, which keeps a thrown error's `message` and its `stack`,
    // so anything quoted here is written down twice and redaction can reach
    // neither (docs/project/logging.md). A site that redirects to
    // `?token=…`, by malice or by bug, would have put it in the log.
    // The reader loses nothing: they cannot act on an address they never
    // chose to visit, and `code` already says which failure this was.
    throw new FetchFailure("invalid-url", here, "That site redirected somewhere unreadable.");
  }
  if (next.protocol !== "http:" && next.protocol !== "https:") {
    throw new FetchFailure(
      "unsupported-scheme",
      here,
      `That site redirected to ${next.protocol.replace(":", "")}, which we don't follow.`,
    );
  }
  /* Compared without the fragment, because the fragment never reaches the
     server: `/a` → `/a#one` is a second request for the same resource, and
     a site that cycles fragments would otherwise eat the whole hop budget
     instead of being named as the loop it is. The chain keeps the real
     URLs. */
  if (chain.some((seen) => sameResource(seen, next))) {
    throw new FetchFailure("too-many-redirects", here, "That address redirects in a loop.");
  }
  return next;
}

async function attemptFetch<T>(
  target: URL,
  requestedUrl: string,
  opts: Resolved,
  spec: BytesSpec<T>,
): Promise<T> {
  /* One deadline for the whole attempt, redirects included — a chain of five
     hops that are each just under the limit is still a page nobody is waiting
     for. `AbortSignal.any` folds in the queue's cancellation where there is one. */
  const deadline = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([deadline, opts.signal]) : deadline;

  const chain: string[] = [];
  let current = target;

  /* **One agent for the whole attempt, and one map it reads.** Each hop adds
     the addresses its own `guardAddress` approved, so a redirect is pinned to
     what *it* was checked against rather than to the first host's answer. Built
     lazily, because a chain of literal-IP hosts needs no dispatcher at all. */
  const pinned = new Map<string, readonly string[]>();
  let agent: (Agent & { pinned: Map<string, readonly string[]> }) | null = null;

  try {
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const approved = await guardAddress(current, opts, signal);
    if (approved) {
      pinned.set(current.hostname.replace(/^\[|\]$/g, "").toLowerCase(), approved);
      agent ??= pinnedAgent(pinned);
    }
    const here = current.toString();
    chain.push(here);

    /* Classified here, against `here`, rather than in the retry loop above
       against the URL that was typed. After a redirect those are different
       servers, and "couldn't reach example.com" naming the site that answered
       correctly — and redirected us — sends the reader to debug the wrong end. */
    let res: Response;
    try {
      res = await opts.fetchImpl(here, {
        redirect: "manual",
        signal,
        /* The pin. Undefined for a literal-IP host, where there is no name to
           resolve twice — and undefined is also what every injected `fetchImpl`
           in the tests sees, which is why they did not have to change. */
        ...(agent ? { dispatcher: agent } : {}),
        headers: spec.headers(opts),
      });
    } catch (err) {
      throw classifyNetworkError(err, here);
    }

    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      const status = res.status;
      await discard(res);
      current = redirectTarget(location, status, current, here, chain);
      continue;
    }

    try {
      return await spec.read(res, here, chain, opts);
    } catch (err) {
      throw classifyNetworkError(err, here);
    }
  }

  throw new FetchFailure(
    "too-many-redirects",
    chain.at(-1) ?? requestedUrl,
    `That address redirected more than ${opts.maxRedirects} times.`,
  );
  } finally {
    /* **After the body, not after the response.** `readDocument` above reads
       the whole body before returning, so by the time this runs there is
       nothing still streaming through the agent's sockets. Closing it any
       earlier would truncate a document; not closing it at all leaks a
       connection pool per attempt, and this function runs once per retry. */
    if (agent) await agent.close().catch(() => {});
  }
}

/**
 * The bytes of a response that is not a redirect, or the reason there are none.
 *
 * Every refusal that is about the *response* rather than about what the bytes
 * turn out to be lives here, so the document and asset paths cannot drift into
 * two different answers on any of them: a bad status, a partial `206`, a body
 * over the cap, an empty body. What each caller then does with the bytes —
 * sniff a document kind, or hand them back — is the caller's own business.
 */
async function readBody(res: Response, finalUrl: string, opts: Resolved): Promise<Uint8Array> {
  if (!res.ok) {
    const asked = retryAfterMs(res.headers.get("retry-after"), opts.now());
    await discard(res);
    throw classifyStatus(res.status, finalUrl, asked);
  }

  /* 206 is a success, and it is a success at sending part of a document. We
     never ask for a range, so a server sending one is misconfigured or a proxy
     is interfering — either way, storing half an article as though it were the
     whole one is the worst available outcome, because nothing downstream can
     tell. */
  if (res.status === 206) {
    await discard(res);
    throw new FetchFailure("http-error", finalUrl, "That server sent only part of the page.", {
      status: res.status,
    });
  }

  /* The cap is enforced in exactly one place: the bytes that actually arrive.
     There was a cheap refusal here first, reading `Content-Length` and giving
     up before downloading anything, justified as safe in one direction — a
     declared size over the cap means the real thing must be over it too. It
     isn't safe, and the argument for it was quietly at odds with the reason
     this module exists: `Content-Length` is a claim by the same server we have
     already established lies about it. A server that overstates would have had
     a perfectly good article refused with a confident number in the message,
     and no way to tell from the outside. What the check bought was skipping a
     download the cap already bounds at 32 MB — a few seconds, against a class
     of bug nobody could diagnose. */
  const bytes = await readCapped(res.body, opts.maxBytes, finalUrl);
  if (bytes.byteLength === 0) {
    throw new FetchFailure("empty", finalUrl, "That page came back empty.");
  }
  return bytes;
}

async function readDocument(
  res: Response,
  requestedUrl: string,
  finalUrl: string,
  chain: string[],
  opts: Resolved,
): Promise<FetchedDocument> {
  const contentType = res.headers.get("content-type");
  const bytes = await readBody(res, finalUrl, opts);

  const kind = sniffKind(contentType, bytes);
  if (kind === null) {
    throw new FetchFailure(
      "unsupported-type",
      finalUrl,
      `That isn't something we can read${contentType ? ` (${mimeType(contentType)})` : ""} — only web pages and PDFs.`,
    );
  }

  const decoded = kind === "html" ? decodeHtml(bytes, contentType) : null;

  return {
    requestedUrl,
    url: finalUrl,
    chain,
    status: res.status,
    kind,
    contentType,
    bytes,
    text: decoded?.text ?? null,
    encoding: decoded?.encoding ?? null,
    fetchedAt: opts.now().toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * Assets — the article's own images
 * ------------------------------------------------------------------ */

/** What comes back from `fetchAsset`. Bytes, and the two facts about them. */
export interface FetchedAsset {
  bytes: Uint8Array;
  /** The `Content-Type` header verbatim, or `null`. **A claim, not a fact** — see below. */
  contentType: string | null;
  /** Where we ended up after redirects. */
  finalUrl: string;
}

/** What the assets step needs from the network, and all it needs. */
export type AssetFetch = (
  url: string,
  opts: { maxBytes: number; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ bytes: Uint8Array; contentType: string | null; finalUrl: string }>;

/**
 * `fetchAsset`'s own options: the seam's three, plus the injected seams so a
 * test can run it without a network.
 *
 * `maxBytes` and `timeoutMs` are **required** here where `FetchOptions` has
 * them optional. An asset fetch is one of hundreds triggered by an untrusted
 * page rather than one triggered by a person, so its caller states its budget
 * rather than inheriting a document's.
 */
export interface AssetFetchOptions extends FetchOptions {
  maxBytes: number;
  timeoutMs: number;
}

/**
 * The headers an *asset* request sends — and the one it deliberately doesn't.
 *
 * **No `Referer`.** The obvious move is to send the article's own URL, on the
 * reasoning that a request with no referer is the shape of a hotlinker. It is a
 * credential leak: the article's final URL can carry signed query parameters,
 * and five of the thirteen images in our own corpus sit behind imgix `s=`
 * signatures. A public payload carries that URL only after `publicSourceUrl`
 * has refused every query string for this same reason (src/urls.ts) — which is
 * the comparison worth making, because a `Referer` header is the raw column and
 * has no such filter in front of it. Handing it to a third party is worse than
 * the problem it solves, and all 54 measured URLs answer `200` without one. If a
 * real host ever refuses, send the *origin* only — never the path, the query or
 * the userinfo.
 * docs/plans/260829b-hosting-the-articles-images.md#no-referer.
 */
function assetHeaders(opts: Resolved): Record<string, string> {
  return {
    "User-Agent": opts.userAgent,
    Accept: "image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5",
  };
}

async function readAsset(
  res: Response,
  finalUrl: string,
  _chain: string[],
  opts: Resolved,
): Promise<FetchedAsset> {
  /* Read before anything is decided about it. **Nothing here sniffs the
     format** — that is `sniffImage` in src/assets.ts, and it belongs to the
     caller, which is the only party that knows which formats it is prepared to
     store. This function's job is bytes off the wire, guarded. */
  const contentType = res.headers.get("content-type");
  const bytes = await readBody(res, finalUrl, opts);
  return { bytes, contentType, finalUrl };
}

/**
 * Fetch one asset — an image, in practice — and hand back the bytes.
 *
 * The same guarded path `fetchDocument` takes: HTTP(S) only, the address guard
 * and the pin on every hop, a capped and loop-checked redirect chain, one
 * deadline for the whole attempt, and the cap counted on the bytes that arrive
 * rather than the ones a header promised. It fails the same way too — a
 * `FetchFailure` with one of the same typed codes.
 *
 * What it does **not** do is decide what the bytes are. `fetchDocument` refuses
 * an image by name (`sniffKind` → `unsupported-type`), and that refusal is
 * correct for a document; an asset's format question has different answers and
 * a different owner. So this returns the origin's `Content-Type` verbatim,
 * clearly labelled as the claim it is, and the caller sniffs.
 *
 * Satisfies `AssetFetch`, which is the seam the assets step is written
 * against — `tests/fetch-asset.test.ts` calls the real function through that
 * type rather than only assigning it, because the failure would be a runtime
 * shape rather than a compile error.
 */
export async function fetchAsset(url: string, options: AssetFetchOptions): Promise<FetchedAsset> {
  return await fetchBytes(url, options, { headers: assetHeaders, read: readAsset });
}

/**
 * The HTML of a page, or a failure explaining why there isn't any.
 *
 * The convenience wrapper for **`src/extract.ts`'s command line**, which wants
 * a string and runs Readability over it. A PDF is a *successful* fetch that
 * Readability cannot use, so this fails by name rather than returning something
 * empty and letting Readability produce a blank article.
 *
 * **The ingest queue no longer comes through here.** It calls `fetchDocument`,
 * writes the manifest, and stage 2 branches on what arrived — a PDF goes to
 * src/pdf-read.ts instead. So the sentence below is now about one command
 * rather than about the product: `npm run extract -- <a-pdf-url>` is genuinely
 * the wrong command, and pasting that URL into the add box is not.
 */
export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<string> {
  const doc = await fetchDocument(url, options);
  if (doc.kind !== "html" || doc.text === null) {
    throw new FetchFailure(
      "unsupported-type",
      doc.url,
      "That's a PDF, and this command runs Readability. Add it through the app, or run " +
        "`npm run pdf -- <file.pdf>` — see docs/plans/260826c-pdf-ingestion.md.",
      { status: doc.status },
    );
  }
  return doc.text;
}

/* ------------------------------------------------------------------ *
 * Stage 1 as a command — gone, 2026-09-05
 * ------------------------------------------------------------------ *
 *
 * `npm run fetch -- <url> [dir]` wrote `data/<slug>/raw.html` (or `raw.pdf`)
 * and the `raw.json` manifest beside it, by hand, off `process.cwd()` — which
 * satisfied the queue's fetch step only under the filesystem store. Under
 * Postgres it wrote files nothing reads.
 *
 * It is **`npm run ingest -- <url>`** now, and it does the whole ingest rather
 * than stage 1: the queue publishes once, when the job settles, and a
 * fetch-only job either fails at publication or — worse, on an existing
 * article — succeeds and publishes new raw bytes beside stale derived content.
 * The reasoning is in `scripts/stage.ts` § `ingestUrl`.
 *
 * **Renamed rather than aliased**, so `npm run fetch` fails with *"Missing
 * script"* instead of quietly doing something else.
 *
 * The diagnostics that command carried — the redirect chain, the type, the
 * encoding, the stored-vs-network size, the object key and the credentials that
 * chose its store — are the one real loss, and they were what made it useful for
 * *finding out why a URL will not come in*. `fetchDocument` still returns every
 * one of those fields; nothing prints them today. `missingObjectAdvice` and
 * `credentialsSeen` above are what said which blob store a process had chosen,
 * and they still do, from inside the failure that needs them.
 */
