/**
 * **Stage 1 hands stage 2 a content address, and this is the seam that carries
 * it.** docs/plans/260831b-finish-the-database-move.md § Stage 2c.
 *
 * `writeRaw` stopped writing files on 2026-08-31 and now only puts the bytes in
 * the object store and returns the manifest; `readRawBytes` is how stage 2 gets
 * them back, and `writeRawFiles` is how a caller that wants files puts them on a
 * disk. That caller was `npm run fetch`, and since 2026-09-05 it is **this file
 * and nothing else** — the command went to `npm run ingest` (scripts/stage.ts),
 * which drives the queue and stores nothing on a disk, and `writeRawFiles` dies
 * in stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 * Until then the property below is still worth asserting, because the
 * filesystem artefact store still reads that file. Nothing had ever read one of those
 * objects back before, so **every failure mode of that read was unexercised**,
 * and one of them turned out to be
 * live in the corpus on the day this was written: nine of the eighteen
 * manifests under `data/` name an object that is in the local Supabase bucket
 * and not in `data/_blobs/`, or the other way round, because `blobStore()`
 * follows the credentials and only some of the processes that wrote them had
 * loaded `.env.local`. Under the old design nothing noticed. Under this one it
 * is a thrown error with a sentence, which is the whole point.
 *
 * ## Why the store is injected everywhere below
 *
 * Because the bug the read has to catch is *the object is not where the
 * manifest says*, and a test that lets `blobStore()` choose is a test of
 * whatever `.env.local` happened to say when it ran —
 * [silent-success.md](../docs/reusable/silent-success.md). Every case here
 * names its own `fsBlobs(dir)`, so "absent" is a fact about a directory this
 * test made rather than about the machine.
 *
 * ## What is deliberately NOT here
 *
 * Anything asserting that a *particular* article in `data/` can still be
 * extracted. Greg's decision 4 (docs/plans/260831b-finish-the-database-move.md) is that
 * the corpus is expendable and refetching is free, so the corpus is not a
 * fixture and pinning it would be pinning today's accident.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  decodeHtml,
  readRawBytes,
  writeRaw,
  writeRawFiles,
  RawDocumentUnavailable,
  type FetchedDocument,
  type RawManifest,
} from "../src/fetch.js";
import { PINNED } from "../src/env.js";
import { keepTheOriginal } from "../src/pdf-read.js";
import { STEPS, UNCONVERTED_STEPS } from "../src/pipeline.js";
import { canonicalKey } from "../src/source.js";
import { createFsArtifactStore } from "../src/store/artifacts-fs.js";
import { fsBlobs } from "../src/store/blobs-fs.js";
import type { RawSourceStore } from "../src/store/blobs.js";
import { checkProduct } from "../src/store/session.js";

let root: string;
let store: RawSourceStore;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "spya-raw-bytes-"));
  store = fsBlobs(path.join(root, "blobs"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const sha = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * A real fetched PDF, as `fetchDocument` would return one. The `%PDF-1.7`
 * header matters only in that a PDF is the kind whose stored bytes and network
 * bytes are the same, which is the half of the round trip that is easy.
 */
const pdfDoc = (body: string): FetchedDocument => {
  const bytes = new TextEncoder().encode(`%PDF-1.7\n${body}`);
  return {
    requestedUrl: "https://example.test/paper.pdf",
    url: "https://example.test/paper.pdf",
    chain: ["https://example.test/paper.pdf"],
    status: 200,
    kind: "pdf",
    contentType: "application/pdf",
    bytes,
    text: null,
    encoding: null,
    fetchedAt: "2026-08-31T10:00:00.000Z",
  };
};

/**
 * **A windows-1252 page, which is the interesting half.**
 *
 * `writeRaw` stores the *decoded* string for HTML, so the bytes under
 * `storedSha256` are not the bytes off the network and the two hashes on the
 * manifest differ. Built by running the real `decodeHtml` over real
 * windows-1252 bytes rather than by asserting a difference into existence: byte
 * 0x93 is a left curly quote in that encoding and three bytes in UTF-8, so the
 * lengths differ too, and a seam that quietly used the wrong one of the two
 * hashes would come back with nothing rather than with subtly wrong text.
 */
function latin1Doc(): FetchedDocument {
  const bytes = Uint8Array.from([
    ...new TextEncoder().encode("<html><body><p>He said "),
    0x93,
    ...new TextEncoder().encode("hello"),
    0x94,
    ...new TextEncoder().encode("</p></body></html>"),
  ]);
  const decoded = decodeHtml(bytes, "text/html");
  return {
    requestedUrl: "https://example.test/page",
    url: "https://example.test/page",
    chain: ["https://example.test/page"],
    status: 200,
    kind: "html",
    contentType: "text/html",
    bytes,
    text: decoded.text,
    encoding: decoded.encoding,
    fetchedAt: "2026-08-31T10:00:00.000Z",
  };
}

describe("writeRaw and readRawBytes are inverses", () => {
  it("round-trips a PDF byte for byte", async () => {
    const doc = pdfDoc("one two three");
    const manifest = await writeRaw(doc, store);
    expect(await readRawBytes(manifest, { store })).toEqual(doc.bytes);
  });

  /**
   * **The case where the two hashes on a manifest are different numbers**, and
   * therefore the case a read that grabbed the wrong field would fail.
   *
   * `sha256` is what the server sent; `storedSha256` is what we kept. Reading
   * by `sha256` would ask the bucket for an object that was never put there —
   * so this asserts they differ *first*, because if they ever stopped differing
   * the rest of this test would pass while testing nothing.
   */
  it("round-trips an HTML page as the decoded string, not the network bytes", async () => {
    const doc = latin1Doc();
    const manifest = await writeRaw(doc, store);

    expect(manifest.sha256).not.toBe(manifest.storedSha256);
    expect(manifest.storedBytes).not.toBe(manifest.bytes);
    expect(manifest.sha256).toBe(sha(doc.bytes));

    const back = await readRawBytes(manifest, { store });
    expect(new TextDecoder().decode(back)).toBe(doc.text);
    expect(sha(back)).toBe(manifest.storedSha256);
  });

  it("writes an object the reader can find under the manifest's own key", async () => {
    const manifest = await writeRaw(pdfDoc("addressable"), store);
    const there = await store.get(canonicalKey(manifest.storedSha256, "pdf"));
    expect(there).not.toBeNull();
  });
});

describe("a reference the object store cannot honour", () => {
  /**
   * **The one the lead asked to see red**: a manifest naming a `storedSha256`
   * with nothing behind it.
   *
   * Nothing caught this before, because nothing read the object back. It is not
   * hypothetical either — it is the state nine of eighteen local manifests are
   * in, from having been written by a process pointed at the other blob store.
   * The mutation it guards is `readRawBytes` answering `null`, or falling back
   * to some other source, instead of throwing.
   */
  it("throws rather than answering nothing when the object is absent", async () => {
    const manifest = await writeRaw(pdfDoc("will be orphaned"), store);
    /* Written by one store, read by another that never saw it — which is
       exactly the shape of the real failure, rather than a deleted file. */
    const elsewhere = fsBlobs(path.join(root, "other-blobs"));

    const err = await readRawBytes(manifest, { store: elsewhere }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RawDocumentUnavailable);
    expect((err as RawDocumentUnavailable).reason).toBe("missing");
    /* The key, because it is the only thing anybody can act on. */
    expect((err as Error).message).toContain(manifest.storedSha256);
  });

  /**
   * The other end of the same hole: a manifest from before the bucket existed.
   *
   * This is what replaced *"null means assume HTML"* on `readRaw`. That default
   * had stage 2 open `raw.html` when there was no manifest, and nothing writes
   * `raw.html` any more — so the honest answer is a refusal naming the fix.
   */
  it("refuses a manifest written before the object store existed", async () => {
    const legacy: RawManifest = {
      kind: "html",
      file: "raw.html",
      requestedUrl: "https://example.test/old",
      url: "https://example.test/old",
      contentType: "text/html",
      encoding: "utf-8",
      bytes: 11,
      sha256: sha(new TextEncoder().encode("hello world")),
      fetchedAt: "2026-08-20T10:00:00.000Z",
    };
    const err = await readRawBytes(legacy, { store }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RawDocumentUnavailable);
    expect((err as RawDocumentUnavailable).reason).toBe("no-object");
    expect((err as Error).message).toMatch(/fetch it again/i);
  });

  /**
   * **The verification, made to matter.** `storeRawSource` proves what was
   * written and this proves what came back, and without the second one a
   * corrupt object is handed to Readability or to a vision model as though it
   * were the reader's document.
   *
   * The corruption is manufactured by writing different bytes at a canonical
   * name — which `fsBlobs` permits, since a blob store has no opinion about
   * what a key means. That is the same state a crashed write or a bad backfill
   * leaves behind (src/store/blobs.ts § Why `already-there` is not enough).
   *
   * **The impostor is the same length as the real document**, deliberately. A
   * shorter or longer one is caught by the `maxBytes` bound one line earlier —
   * which is a different guard, and a test that tripped it would report this
   * one as working while never running it. Same length, different bytes, is the
   * case where only the hash can tell.
   */
  it("throws when the object at the key is not the document the key names", async () => {
    const doc = pdfDoc("the real paper");
    const manifest = await writeRaw(doc, store);
    const impostor = fsBlobs(path.join(root, "corrupt-blobs"));
    const wrong = new TextEncoder()
      .encode(`%PDF-1.7\n${"y".repeat(manifest.storedBytes)}`)
      .slice(0, manifest.storedBytes);
    expect(wrong.byteLength).toBe(manifest.storedBytes);
    await impostor.putIfAbsent(
      canonicalKey(manifest.storedSha256, "pdf"),
      wrong,
      "application/pdf",
    );

    const err = await readRawBytes(manifest, { store: impostor }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RawDocumentUnavailable);
    expect((err as RawDocumentUnavailable).reason).toBe("corrupt");
    expect((err as Error).message).toContain(sha(wrong));
  });

  /**
   * **A prefix of a PDF is a corrupt PDF that still parses**, so an over-long
   * object has to throw out of `get` rather than come back truncated.
   *
   * `maxBytes` is the manifest's own `storedBytes`, so this exercises the one
   * line that passes it — delete that argument and the read below succeeds with
   * the wrong document, which is the failure `storeRawSource` bounds its own
   * read-back against for the same reason.
   *
   * **And it has to arrive as `RawDocumentUnavailable("corrupt")`, which is the
   * half this test used to miss.** It asserted `/limit/` and passed, and what
   * it was passing on was the adapters' ordinary `Error` (src/store/blobs-fs.ts
   * throws one when the bound is exceeded). `src/pipeline.ts` converts only
   * `RawDocumentUnavailable` into a `blocked` failure, so an ordinary error
   * reaches the reader as a **Retry** — and retry never re-runs a step that
   * finished, so it skips `fetch`, reads the same over-long object and fails
   * identically. An over-long object at a content-addressed name is corruption
   * like any other and the answer is a re-fetch. GPT Sol, 2026-08-31.
   */
  it("refuses an object longer than the manifest says it is, as corruption", async () => {
    const manifest = await writeRaw(pdfDoc("short"), store);
    const bloated = fsBlobs(path.join(root, "bloated-blobs"));
    await bloated.putIfAbsent(
      canonicalKey(manifest.storedSha256, "pdf"),
      new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(manifest.storedBytes * 4)}`),
      "application/pdf",
    );

    const err = await readRawBytes(manifest, { store: bloated }).catch((e: unknown) => e);
    /* The class is the contract src/pipeline.ts branches on to say `blocked`,
       so this assertion is the one that decides which button the reader gets. */
    expect(err).toBeInstanceOf(RawDocumentUnavailable);
    expect((err as RawDocumentUnavailable).reason).toBe("corrupt");
    /* Both numbers, because "corrupt" without them sends somebody to look at
       the hash, which is not what went wrong here. */
    expect((err as Error).message).toContain(String(manifest.storedBytes));
    expect((err as Error).message).toContain(canonicalKey(manifest.storedSha256, "pdf"));
  });

  /**
   * **The other half of that fix, and the mutation it exists for.**
   *
   * The cheap way to classify the over-long case is to catch everything `get`
   * throws and call it corruption. That is wrong in the direction that costs a
   * reader an article: a Storage 503, a permission error, a socket dying
   * mid-body are all transient, and `blocked` tells the reader to re-fetch
   * something that would have worked on the next click. It is also the same
   * mistake `head()` in src/store/blobs.ts already refuses to make — *"a
   * Storage 503 read as 'absent' turns a transient outage into 'your file never
   * arrived'"*.
   *
   * So the store here throws an ordinary failure that is nothing to do with the
   * bound, and the ordinary failure has to come back out untouched.
   */
  it("does not read a transient store failure as corruption", async () => {
    const manifest = await writeRaw(pdfDoc("fine, but the store is not"), store);
    const outage = new Error("503 Service Unavailable");
    const unreachable: RawSourceStore = {
      get: () => Promise.reject(outage),
      head: () => Promise.reject(outage),
      putIfAbsent: () => Promise.reject(outage),
      remove: () => Promise.reject(outage),
    };

    const err = await readRawBytes(manifest, { store: unreachable }).catch((e: unknown) => e);
    expect(err).toBe(outage);
    expect(err).not.toBeInstanceOf(RawDocumentUnavailable);
  });
});

describe("what `writeRawFiles` leaves behind", () => {
  /**
   * **The documented property, asserted rather than assumed.**
   *
   * Running `npm run fetch -- <url>` by hand under `SPIDERYARN_STORE=files` was
   * meant to satisfy the queue's `fetch` step, so the queue skipped straight to
   * extraction. That only held if the file `writeRawFiles` writes is the file
   * `PATHS.fetch.raw` reads — two constants in two modules that nothing else
   * compares. This reads it back through the real artefact store rather than by
   * checking the filename, so a change to either end fails here.
   *
   * **The command is gone and the pairing is not**, 2026-09-05: `writeRawFiles`
   * has no caller left but this case, and it is still the only thing comparing
   * those two constants for as long as either exists.
   */
  it("writes a raw.json the filesystem artefact store reads back as the manifest", async () => {
    const doc = pdfDoc("what the command wrote");
    const manifest = await writeRaw(doc, store);
    const dir = path.join(root, "cli", "data", "paper");
    await writeRawFiles(dir, doc, manifest);

    const artifacts = createFsArtifactStore(() => ({
      dir,
      htmlFile: path.join(root, "cli", "output", "paper.html"),
    }));
    expect(await artifacts.has("paper", "fetch", ["raw"])).toBe(true);
    const back = await artifacts.read("paper", "fetch", "raw");
    expect(back?.storedSha256).toBe(manifest.storedSha256);
    expect(back?.kind).toBe("pdf");
  });

  /**
   * **The file beside the manifest holds the bytes the manifest's hash names.**
   *
   * This is the invariant that broke once already, when the command wrote
   * `doc.bytes` and the pipeline wrote the decoded string to the same path.
   * `storedDocumentBytes` is the single expression both go through now, and the
   * mutation this guards is `writeRawFiles` reaching for `doc.bytes` instead —
   * which is byte-identical for a PDF, so the case below is the HTML one.
   */
  it("puts the same bytes in the file as it put under the hash", async () => {
    const doc = latin1Doc();
    const manifest = await writeRaw(doc, store);
    const dir = path.join(root, "cli-html");
    const written = await writeRawFiles(dir, doc, manifest);

    const onDisk = new Uint8Array(await readFile(written.file));
    expect(sha(onDisk)).toBe(manifest.storedSha256);
    /* And it is genuinely not what came off the wire, or this proves nothing. */
    expect(sha(onDisk)).not.toBe(manifest.sha256);
    expect(onDisk).toEqual(await readRawBytes(manifest, { store }));
  });
});

describe("the sentence a failure gives a person", () => {
  /**
   * **The lead's requirement, and the reason it is worth a test of its own.**
   *
   * About half the local corpus will hit this on the first run after the
   * change, and which half depends on how the process was started. A bare
   * "not found" would send whoever sees it looking for a deleted file. So the
   * message has to carry four things, and each is asserted separately so a
   * rewrite that drops one goes red on the clause it dropped rather than on a
   * string comparison nobody can read.
   */
  /**
   * **The credentials are set by the test, not read off the machine.**
   *
   * The first version of this asserted
   * `not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "…")`, which is
   * vacuous wherever that variable is unset — a clause no fixture could redden,
   * which is the shape this repo keeps writing up. Both branches are driven
   * from here instead, so "set" / "not set" and the leak check are facts about
   * the code rather than about whoever's `.env.local` ran the suite.
   */
  const withEnv = async <T>(
    vars: Record<string, string | undefined>,
    body: () => Promise<T>,
  ): Promise<T> => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return await body();
    } finally {
      for (const [k, v] of Object.entries(before)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  /** Shaped like the real thing, so a leak would be recognisable in a log. */
  const SECRET = "eyJhbGciOi.this-must-never-reach-a-message";

  it("names the article, the object, the mechanism and the fix", async () => {
    const manifest = await writeRaw(pdfDoc("orphaned"), store);
    const elsewhere = fsBlobs(path.join(root, "message-blobs"));

    const err = await withEnv(
      { SUPABASE_URL: "http://127.0.0.1:54361", SUPABASE_SERVICE_ROLE_KEY: SECRET },
      async () =>
        (await readRawBytes(manifest, { slug: "nagel-bat", store: elsewhere }).catch(
          (e: unknown) => e,
        )) as Error,
    );

    expect(err.message).toContain('"nagel-bat"');
    expect(err.message).toContain(manifest.storedSha256);
    /* The mechanism, which is the part that stops somebody hunting for a file
       nobody deleted. */
    expect(err.message).toContain("blobStore()");
    expect(err.message).toContain("data/_blobs/");
    expect(err.message).toMatch(/refetch/i);
    /* The observed credentials, so the reader does not have to guess which of
       the two stores this process was looking in. */
    expect(err.message).toContain("SUPABASE_URL is set");
    expect(err.message).toContain("SUPABASE_SERVICE_ROLE_KEY is set");
    /* And never the value. This is the assertion the vacuous version could not
       make: the secret is one the test put there, so it is genuinely present to
       be leaked. */
    expect(err.message).not.toContain(SECRET);
  });

  /** The other branch — a laptop with no container running is in it. */
  it("says which credentials are absent when they are", async () => {
    const manifest = await writeRaw(pdfDoc("orphaned too"), store);
    const elsewhere = fsBlobs(path.join(root, "message-blobs-3"));

    const err = await withEnv(
      { SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined },
      async () =>
        (await readRawBytes(manifest, { slug: "greatwork", store: elsewhere }).catch(
          (e: unknown) => e,
        )) as Error,
    );

    expect(err.message).toContain("SUPABASE_URL is not set");
    expect(err.message).toContain("SUPABASE_SERVICE_ROLE_KEY is not set");
  });

  /**
   * **A credential counts here exactly as it counts in `blobStore()`, which is
   * not the same as counting sensibly.**
   *
   * This asserted the `.trim()` rule `postgresBlobStore` applies — an empty or
   * whitespace-only value is not a credential — and that reads better than what
   * is here now. It was wrong for this sentence: `blobStore()` tests `url &&
   * key` (src/store/blobs.ts), so `SUPABASE_URL="  "` **selects Supabase
   * Storage**, and a message that called it "not set" sent the reader to
   * `data/_blobs/` to look for an object that was never going there. The
   * message's whole job is to say which store this process was talking to, so
   * where the two rules differ it has to follow the one that actually chose.
   * GPT Sol, 2026-08-31.
   *
   * So: empty string is "not set" both ways, and whitespace is where they part.
   */
  it("counts a credential the way blobStore() does, whitespace included", async () => {
    const manifest = await writeRaw(pdfDoc("blank creds"), store);
    const elsewhere = fsBlobs(path.join(root, "message-blobs-4"));

    const err = await withEnv(
      { SUPABASE_URL: "  ", SUPABASE_SERVICE_ROLE_KEY: "" },
      async () =>
        (await readRawBytes(manifest, { store: elsewhere }).catch((e: unknown) => e)) as Error,
    );

    /* Whitespace is a value, and `blobStore()` builds a Supabase client from
       it — so the sentence says "set", agreeing with the store that was
       actually chosen rather than with the reading that sounds tidier. */
    expect(err.message).toContain("SUPABASE_URL is set");
    /* And an empty string is falsy to both rules, so there is no disagreement
       left to describe. */
    expect(err.message).toContain("SUPABASE_SERVICE_ROLE_KEY is not set");
  });

  /** Without a slug it still reads as a sentence rather than as a gap. */
  it("says 'This article' when no slug is given", async () => {
    const manifest = await writeRaw(pdfDoc("anonymous"), store);
    const elsewhere = fsBlobs(path.join(root, "message-blobs-2"));
    const err = (await readRawBytes(manifest, { store: elsewhere }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.message).toMatch(/^This article points at the object/);
  });
});

describe("the product guard over stage 1 and stage 2", () => {
  /**
   * **`checkProduct` (src/store/session.ts) is what catches an `extract` that
   * returns `meta` and no `extractedHtml`.**
   *
   * When this file was written `extract` was still on `LEGACY_UNCONVERTED_STEPS`,
   * so the guard returned early on an absent `parts` and only the half-filled
   * case could be tested at all. This block pinned that as a fact about the day
   * — `UNCONVERTED_STEPS.has("extract") === true` — precisely so that it would
   * go red when the name came off. It did, within the hour, and the assertion
   * below is the stronger one that became available: **an absent `parts` is now
   * refused too.**
   *
   * The list is asserted empty rather than "extract is not on it", because that
   * is the fact worth guarding now: a step added to the pipeline is converted by
   * default and this list is the only way out of that (src/pipeline.ts). A name
   * reappearing on it should be a decision somebody made, not something a test
   * shrugged at.
   */
  it("has no steps left on the unconverted exemption", () => {
    expect([...UNCONVERTED_STEPS]).toEqual([]);
  });

  it("refuses an extract product missing extractedHtml, by name", () => {
    expect(STEPS.extract.produces).toContain("extractedHtml");
    expect(STEPS.extract.produces).toContain("meta");
    expect(() =>
      checkProduct(
        STEPS.extract,
        { detail: "x", parts: { meta: { slug: "s", title: "T", fetchedAt: "" } } },
        UNCONVERTED_STEPS,
      ),
    ).toThrow(/missing extractedHtml/);
  });

  /** The case the exemption used to hide: no artefacts at all. */
  it("refuses an extract product with no parts whatsoever", () => {
    expect(() => checkProduct(STEPS.extract, { detail: "x" }, UNCONVERTED_STEPS)).toThrow(
      /returned no artefacts to write/,
    );
  });

  /** And stage 1, whose single artefact is the manifest. */
  it("refuses a fetch product with no raw manifest", () => {
    expect(STEPS.fetch.produces).toEqual(["raw"]);
    expect(() => checkProduct(STEPS.fetch, { detail: "x", parts: {} }, UNCONVERTED_STEPS)).toThrow(
      /missing raw/,
    );
  });

  it("accepts an extract product that has both artefacts", () => {
    expect(() =>
      checkProduct(
        STEPS.extract,
        {
          detail: "x",
          parts: {
            meta: { slug: "s", title: "T", fetchedAt: "" },
            extractedHtml: "<html><body><p>words</p></body></html>",
          },
        },
        UNCONVERTED_STEPS,
      ),
    ).not.toThrow();
  });
});

describe("npm run eval:pdf-read keeps the original where the reader can reach it", () => {
  /**
   * **`keepTheOriginal` never called `storeRawSource`**, so every article made
   * by that command — it was `npm run pdf` until 2026-09-05 — carried a manifest
   * with no `storedSha256` —
   * which `src/store/artifacts-pg.ts` refuses outright (`NoStoredDocument`).
   * The command reported success and the article was un-ingestable into
   * Postgres, with nothing said until the write failed somewhere else.
   *
   * The mutation this guards is dropping the `storeRawSource` call: the
   * manifest still writes, `raw.pdf` still appears, and only the two `stored*`
   * fields and the object go missing.
   */
  it("stores the object as well as writing the files", async () => {
    const dir = path.join(root, "kept");
    const bytes = new TextEncoder().encode("%PDF-1.7\na local paper");
    const keeper = fsBlobs(path.join(root, "kept-blobs"));

    await keepTheOriginal({ bytes, url: "file:///tmp/a.pdf", dataDir: dir }, sha(bytes), keeper);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "raw.json"), "utf8"),
    ) as RawManifest;
    expect(manifest.storedSha256).toBe(sha(bytes));
    expect(manifest.storedBytes).toBe(bytes.byteLength);
    /* And the object is really there — the half that a manifest alone cannot
       prove, and the half that was missing. */
    expect(await readRawBytes(manifest, { store: keeper })).toEqual(bytes);
  });

  /** It leaves a real fetch's provenance alone, which is why the guard exists. */
  it("does not overwrite a manifest stage 1 already wrote", async () => {
    const dir = path.join(root, "already");
    const first = new TextEncoder().encode("%PDF-1.7\nfrom the queue");
    const keeper = fsBlobs(path.join(root, "already-blobs"));
    await keepTheOriginal({ bytes: first, url: "https://example.test/a.pdf", dataDir: dir }, sha(first), keeper);

    const second = new TextEncoder().encode("%PDF-1.7\nfrom the command line");
    await keepTheOriginal({ bytes: second, url: "file:///tmp/b.pdf", dataDir: dir }, sha(second), keeper);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "raw.json"), "utf8"),
    ) as RawManifest;
    expect(manifest.url).toBe("https://example.test/a.pdf");
    expect(manifest.storedSha256).toBe(sha(first));
    /* The skip is a skip all the way down: the second document's bytes never
       reach the bucket either. Without this the "corrupt is absent" cases below
       could be satisfied by a function that had simply stopped skipping. */
    expect(await keeper.head(canonicalKey(sha(second), "pdf"))).toBeNull();
  });

  /**
   * **A half-written `raw.json` is not a record of anything, and was treated as
   * one.** `keepTheOriginal`'s guard read the file with `readFile(…).catch(() => null)`
   * and believed any non-empty bytes — so a process killed between `writeFile`
   * truncating `raw.json` and finishing it left a file that exists, does not
   * parse, and stops the manifest and the object from ever being written. The
   * key never changes, so no later run recovers: `readRaw` in src/fetch.ts
   * answers `null` for the same file, which callers read as "assume HTML", and
   * the PDF's provenance is gone quietly. Named and deliberately left in
   * docs/postmortems/260828e-pdf-chunk-cache-corrupt-entry.md § One more
   * instance, six days before this was fixed.
   *
   * The damage is done by hand rather than by staging a crash — truncate the
   * file to half its length and the state a `SIGKILL` leaves is on disk in one
   * line, which is the reusable move from that postmortem.
   */
  it("treats a half-written raw.json as absent rather than as done", async () => {
    const dir = path.join(root, "half-written");
    const bytes = new TextEncoder().encode("%PDF-1.7\nthe run that was killed");
    const keeper = fsBlobs(path.join(root, "half-written-blobs"));
    await mkdir(dir, { recursive: true });
    const whole = `${JSON.stringify(
      { kind: "pdf", file: "raw.pdf", origin: "upload", contentType: "application/pdf" },
      null,
      2,
    )}\n`;
    await writeFile(path.join(dir, "raw.json"), whole.slice(0, Math.floor(whole.length / 2)), "utf8");

    await keepTheOriginal({ bytes, dataDir: dir }, sha(bytes), keeper);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "raw.json"), "utf8"),
    ) as RawManifest;
    expect(manifest.storedSha256).toBe(sha(bytes));
    /* And the object landed, which is the half a rewritten manifest cannot
       prove — the same control as the first case in this block. */
    expect(await keeper.head(canonicalKey(sha(bytes), "pdf"))).not.toBeNull();
    expect(await readRawBytes(manifest, { store: keeper })).toEqual(bytes);
  });

  /**
   * The other half of the same rule, and the one a `JSON.parse` in a `try`
   * would still get wrong: valid JSON that is not a manifest. `{}` parses, so a
   * parse-only check calls it done and skips — but nothing downstream can use
   * it, which is the shape `whyUnusable("raw", …)` already decides for both
   * artefact stores.
   */
  it("treats a raw.json that parses but is not a manifest as absent", async () => {
    const dir = path.join(root, "not-a-manifest");
    const bytes = new TextEncoder().encode("%PDF-1.7\nwritten by something older");
    const keeper = fsBlobs(path.join(root, "not-a-manifest-blobs"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "raw.json"), '{"kind":"pdf"}\n', "utf8");

    await keepTheOriginal({ bytes, dataDir: dir }, sha(bytes), keeper);

    const manifest = JSON.parse(
      await readFile(path.join(dir, "raw.json"), "utf8"),
    ) as RawManifest;
    expect(manifest.file).toBe("raw.pdf");
    expect(manifest.storedSha256).toBe(sha(bytes));
    expect(await readRawBytes(manifest, { store: keeper })).toEqual(bytes);
  });
});

/**
 * **The one thing the tests above structurally cannot see.**
 *
 * Every case in this file injects one store into both halves of the round trip,
 * which is right for testing the read and useless for testing the *selection*:
 * the failure this whole stage is about is two processes choosing two different
 * stores, and a test that names the store has already decided that question.
 *
 * `blobStore()` (src/store/blobs.ts) chooses from `SUPABASE_URL` and
 * `SUPABASE_SERVICE_ROLE_KEY`, so the selection is made by *how the process was
 * started*. The server gets them from `.env.local` — through `vite.config.ts`
 * and `src/store/live.ts` — and `npm run fetch` did not, so the command wrote
 * `data/_blobs/` and `raw.json`, the queue counted the fetch step done, and
 * extraction then dereferenced the manifest against Supabase and blocked on an
 * object that exists. GPT Sol found it, 2026-08-31; it is the same split as
 * docs/postmortems/260831e-a-write-path-with-no-reader.md, made fresh by the command
 * meant to be safe.
 *
 * **The subject moved on 2026-09-05 and the hazard did not.** `npm run fetch` is
 * `npm run ingest` now — one script, `scripts/stage.ts`, behind four npm names —
 * and it needs `.env.local` for *more* reasons than the old command did, not
 * fewer.
 *
 * **Two things now satisfy this, and it took three mutations to find that out.**
 * `scripts/stage.ts` calls `loadEnvLocal()` above its imports — which are
 * dynamic for exactly that reason, since static ones are hoisted above every
 * statement in a module. But `src/store/live.ts` **also** calls it, at module
 * top level, and the script's graph reaches that file. Measured 2026-09-05, on
 * the no-argument run:
 *
 * - move the script's call below its dynamic imports → **still green**;
 * - move it below the argument check → **still green**;
 * - remove it *and* `src/store/live.ts`'s → **red**, on this file's own
 *   assertion: *"expected '\nUsage:…' to match /\[env\] \.env\.local
 *   overrode …/"*.
 *
 * So what this case actually proves is the **effect** — by the time the command
 * prints anything, the file has been applied — and not which line produced it.
 * That is the right claim for it to make (docs/reusable/silent-success.md:
 * measure the effect, not the cause), but the first two runs above are exactly
 * the shape of a control that lies, and the note is here so nobody cites this
 * test as cover for the script's own ordering. **Nothing checks that ordering
 * today**; it is belt over braces, and the braces are in `live.ts`.
 *
 * So this runs the **real entry point** in a real child process. It cannot
 * assert which adapter came back — that is `blobStore()`'s business and
 * restating the rule here would be the second copy the postmortem argues
 * against — so it asserts the thing that decides it: that by the time the CLI
 * does anything at all, `.env.local` has been applied, and the value the
 * selection sees is the file's rather than the shell's.
 *
 * **The proof is `loadEnvLocal`'s own override warning** (src/env.ts), which
 * names every variable where the file disagreed with what the process
 * inherited. The child is given a deliberately wrong value for one variable the
 * file sets, so the disagreement is manufactured rather than hoped for — and
 * the run is the **no-argument** one, which prints usage and exits 1. That is
 * what makes this a test of the *order* as well — with the caveat measured
 * above: it is the order of *the process*, not of any one line in it.
 */
describe("`npm run ingest` selects its blob store from the same environment the server does", () => {
  const ROOT = new URL("../", import.meta.url);
  const TSX = fileURLToPath(new URL("node_modules/.bin/tsx", ROOT));
  const CLI = fileURLToPath(new URL("scripts/stage.ts", ROOT));

  /**
   * A variable `.env.local` sets, and its value — `SUPABASE_URL` for
   * preference, since it is one of the two that pick the store, but any will
   * do: what is under test is that the file was read at all.
   *
   * `null` when there is no `.env.local` (a fresh checkout, CI), which is the
   * one case this cannot be run at all: the mechanism under test is a file
   * beating the shell, and with no file there is no disagreement to make.
   */
  function shadowable(): { name: string; value: string } | null {
    let text: string;
    try {
      text = readFileSync(fileURLToPath(new URL(".env.local", ROOT)), "utf8");
    } catch {
      return null;
    }
    const found = new Map<string, string>();
    for (const line of text.split("\n")) {
      const at = line.indexOf("=");
      if (at <= 0 || line.trimStart().startsWith("#")) continue;
      const name = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && value !== "") found.set(name, value);
    }
    const preferred = found.get("SUPABASE_URL");
    if (preferred !== undefined) return { name: "SUPABASE_URL", value: preferred };
    const first = [...found.entries()][0];
    return first ? { name: first[0], value: first[1] } : null;
  }

  const target = shadowable();

  it.skipIf(target === null)(
    "reads .env.local before it reads its own arguments",
    () => {
      /* Narrowing for the compiler; `skipIf` has already handled the null. */
      if (target === null) return;

      const env: NodeJS.ProcessEnv = { ...process.env };
      /* `loadEnvLocal` says nothing under NODE_ENV=test, which vitest sets — so
         without this the child prints nothing and every assertion below would
         be satisfied by a command that never loaded anything. */
      env.NODE_ENV = "development";
      /* The manufactured disagreement: the child inherits a value that is not
         the file's, so the file overriding it is an observable event rather
         than a no-op. */
      env[target.name] = `${target.value}.not-what-the-file-says`;
      /**
       * **The one place that has to opt out of the unit lane's pin**, and it is
       * the one whose subject is the thing being pinned.
       *
       * `tests/setup/unit-no-database.ts` sets `SPIDERYARN_ENV_PINNED` to
       * `DATABASE_URL,SUPABASE_URL` so a child cannot have `.env.local` hand
       * back the poisoned values (`PINNED` in src/env.ts). This test's whole
       * claim is that `.env.local` *does* override the shell, and `shadowable()`
       * above picks `SUPABASE_URL` to prove it with — so with the pin inherited
       * there is nothing to observe and the assertion below goes red naming the
       * override that did not happen. That is the right failure: it is loud, and
       * it points here.
       *
       * Narrowed rather than deleted, so the child still cannot reach the shared
       * **database** — `scripts/stage.ts` with no arguments prints usage before
       * anything asks `getDb()` for a pool, and a pin left in place for free is
       * worth more than the argument about it.
       */
      env[PINNED] = "DATABASE_URL";

      const child = spawnSync(TSX, [CLI], { env, encoding: "utf8" });

      /* It got as far as the argument check, which is the second half of the
         claim: the load happened *before* the first thing the command does. */
      expect(child.stderr).toContain("npm run ingest");
      expect(child.status).toBe(1);
      expect(child.stderr).toMatch(
        new RegExp(String.raw`\[env\] \.env\.local overrode [^\n]*\b${target.name}\b`),
      );
      /* Names only, never values — the warning is about credentials. */
      expect(child.stderr).not.toContain(target.value);
    },
    120_000,
  );
});
