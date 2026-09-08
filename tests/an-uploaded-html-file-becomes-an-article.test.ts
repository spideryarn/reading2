/**
 * **Stage 1 for an uploaded *web page*** — the half of `acquireUpload` that did
 * not exist until 2026-09-07, when Greg asked for it
 * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md).
 *
 * `tests/upload-acquire.test.ts` is the PDF half and owns the refusals, the
 * promotion and the state machine; none of that is repeated here. What this file
 * pins is the three things that are **different about HTML and silent when they
 * are wrong**:
 *
 *  - **The kind is decided by the bytes**, through the same `sniffKind` the URL
 *    half uses, so a `.html` full of `%PDF-` and a `.pdf` full of markup both
 *    end up as what they are rather than as what they are called.
 *  - **The stored bytes are the *decoded* string**, not the bytes that arrived.
 *    That is `writeRaw`'s invariant and stage 2 depends on it — it does
 *    `new TextDecoder().decode(bytes)` with no encoding branch, so an upload path
 *    that stored the raw bytes of a windows-1252 page would publish mojibake with
 *    nothing raised anywhere. The test uses a byte that decodes differently under
 *    the two encodings, which is the only way this can fail honestly.
 *  - **The page cap does not apply.** `MAX_PAGES` is about what transcribing a
 *    PDF costs; an HTML file has no pages, and counting them would refuse a long
 *    web page for a reason that is not about it.
 */
import { createHash } from "node:crypto";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { closeDb, getDb } from "../src/db/client.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { cameFromAnUpload, type RawManifest, readRawBytes } from "../src/fetch.js";
import { STEPS } from "../src/pipeline.js";
import { canonicalKey, stagingKey } from "../src/source.js";
import { blobStore, CONTENT_TYPE } from "../src/store/blobs.js";
import { claimUpload, forgetUpload, mintUpload, readUpload } from "../src/upload-records.js";

const blobs = blobStore();
const artefacts = memoryArtefacts();

/** Its own uuid — tests/fixture-ids.test.ts refuses two files sharing one. */
const OWNER = "33333333-3333-4333-8333-333333333344";

await pgReady({
  suite: "tests/an-uploaded-html-file-becomes-an-article.test.ts",
  tables: ["spideryarn.uploads", "auth.users"],
});

beforeAll(async () => {
  await seedAuthUser(getDb(), {
    id: OWNER,
    email: "uploaded-html@example.invalid",
    onConflictDoNothing: true,
  });
});

const rubbish: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const undo of rubbish.splice(0)) await undo();
});

afterAll(async () => {
  await getDb().execute(sql`delete from auth.users where id = ${OWNER}::uuid`);
  await closeDb();
});

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * An upload minted, claimed, and its bytes in the store — the state
 * `POST /api/jobs { uploadId }` leaves behind.
 *
 * The staging object's content type is the one the *browser* would have claimed,
 * which is the point: it is a claim, and the step below is where we look.
 */
async function readyToVerify(
  bytes: Uint8Array,
  filename: string,
  claimedType: "pdf" | "html" = "html",
) {
  const minted = await mintUpload(
    { filename, bytes: bytes.byteLength, sha256: shaOf(bytes), owner: OWNER },
    async (key) => ({
      url: `https://x.test/${key}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    stagingKey,
  );
  const id = minted.record.id;
  rubbish.push(() => forgetUpload(id));
  rubbish.push(() => blobs.remove(stagingKey(id)));
  await claimUpload(id);
  await blobs.putIfAbsent(stagingKey(id), bytes, CONTENT_TYPE[claimedType]);

  const ctx = {
    slug: `test-html-upload-${id.slice(0, 8)}`,
    upload: { id, filename },
    report: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
  };
  return { id, ctx };
}

/** A document-level marker, which is what `sniffKind` needs to believe markup. */
const A_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Saved</title></head>' +
  "<body><article><h1>Saved</h1><p>Some prose.</p></article></body></html>";

describe("acquiring an uploaded web page", () => {
  it("writes an html manifest, with no URL and none invented", async () => {
    const bytes = new TextEncoder().encode(A_PAGE);
    const { id, ctx } = await readyToVerify(bytes, "saved-page.html");
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "html")));

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    const manifest = product.parts?.raw;

    expect(manifest?.kind).toBe("html");
    expect(manifest?.file).toBe("raw.html");
    expect(manifest?.origin).toBe("upload");
    expect(manifest?.uploadId).toBe(id);
    expect(manifest?.filename).toBe("saved-page.html");
    /* The same refusal to invent one the PDF half makes. A `file://` here would
       read as an address to everything downstream and nothing would complain. */
    expect(manifest?.url).toBeUndefined();
    expect(manifest?.requestedUrl).toBeUndefined();

    /* **Reachable the way stage 2 reaches it**, not merely present somewhere. */
    if (!manifest) throw new Error("the step returned no manifest");
    expect(new TextDecoder().decode(await readRawBytes(manifest))).toContain("Some prose.");

    /* The record reaches its terminal good state, or a retry re-runs for ever. */
    expect((await readUpload(id))?.status).toBe("verified");
  });

  /**
   * **The invariant that fails silently.** `writeRaw` stores the decoded string
   * for HTML, and stage 2 decodes what it reads as UTF-8 with no encoding
   * branch. Byte `0x93` is U+201C — a left curly quote — in windows-1252, and is
   * not valid UTF-8 at all, so storing the arrived bytes puts a replacement
   * character in the reader's prose and nothing anywhere says so.
   */
  it("stores the decoded string for a page that is not UTF-8", async () => {
    const page =
      "<!doctype html><html><head><title>Legacy</title></head>" +
      "<body><article><h1>Legacy</h1><p>\x93quoted\x94, at length, so Readability has something.</p>" +
      "</article></body></html>";
    /* latin1, so `\x93` reaches the store as one byte and not as UTF-8's three. */
    const bytes = Uint8Array.from(page, (c) => c.charCodeAt(0));
    const { ctx } = await readyToVerify(bytes, "legacy.html");

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    const manifest = product.parts?.raw;
    if (!manifest) throw new Error("the step returned no manifest");
    rubbish.push(() => blobs.remove(canonicalKey(manifest.storedSha256 ?? "", "html")));

    const stored = new TextDecoder().decode(await readRawBytes(manifest));
    expect(stored).toContain("“quoted”");
    expect(stored).not.toContain("�");

    /* **The two hashes are different questions, and here they differ.** `sha256`
       is what arrived; `storedSha256` names the object in the bucket. A path
       that set one from the other would pass every assertion above. */
    expect(manifest.sha256).toBe(shaOf(bytes));
    expect(manifest.storedSha256).not.toBe(manifest.sha256);
    expect(manifest.encoding).toBe("windows-1252");
  });

  /**
   * **The name is a claim; the bytes are the fact.** Both directions, because a
   * check that only ran one way would pass while the other silently trusted the
   * extension.
   */
  it("believes the bytes over the name, in both directions", async () => {
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\nnot markup\n%%EOF\n");
    const asHtml = await readyToVerify(pdfBytes, "mislabelled.html", "pdf");
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(pdfBytes), "pdf")));
    const pdfProduct = await STEPS.fetch.run(asHtml.ctx, artefacts, nullCheckpointStore());
    expect(pdfProduct.parts?.raw?.kind).toBe("pdf");

    const htmlBytes = new TextEncoder().encode(A_PAGE);
    const asPdf = await readyToVerify(htmlBytes, "mislabelled.pdf", "html");
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(htmlBytes), "html")));
    const htmlProduct = await STEPS.fetch.run(asPdf.ctx, artefacts, nullCheckpointStore());
    expect(htmlProduct.parts?.raw?.kind).toBe("html");
  });

  /**
   * **The manifest stage 2 actually reads is the one the store kept, not the
   * one the step returned** — and those are different objects.
   *
   * This case exists because every other assertion in this file passed while the
   * feature was broken end to end. The `extract` step asked
   * `manifest.origin === "upload"`, which is true of what `acquireUpload`
   * returns and **false of everything loaded back**: `readRaw`
   * (src/store/artifacts-pg.ts) rebuilds a manifest from columns, there is no
   * `origin` column, and that adapter deliberately declines to invent one. So a
   * real upload died at `requireUrl` three stages later with *"No source URL"*.
   * Found by running one, not by a test. docs/reusable/silent-success.md.
   *
   * `cameFromAnUpload` is what closed it, and this pins the property that makes
   * it work: **the fact it reads survives the round trip**. The manifest below
   * is the step's own, with `origin` deleted — which is exactly what the store
   * hands back — so a predicate that went back to reading `origin` fails here
   * rather than in production.
   */
  it("can still tell an upload after the store has dropped `origin`", async () => {
    const bytes = new TextEncoder().encode(A_PAGE);
    const { ctx } = await readyToVerify(bytes, "round-trip.html");
    rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "html")));

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    const manifest = product.parts?.raw;
    if (!manifest) throw new Error("the step returned no manifest");
    expect(cameFromAnUpload(manifest)).toBe(true);

    /* `delete` rather than a rest-destructure, and rather than `filename:
       undefined`: `exactOptionalPropertyTypes` is on, so an absent key and a key
       holding `undefined` are different types here — and the store produces the
       first. A test that built the second would be testing a shape nothing can
       hand us. */
    const asStored: RawManifest = { ...manifest };
    delete asStored.origin;
    expect(asStored.origin).toBeUndefined();
    expect(cameFromAnUpload(asStored)).toBe(true);

    /* And the other direction, so this cannot pass by always answering yes: a
       fetched document has no filename and never had one. */
    const asFetched: RawManifest = { ...asStored };
    delete asFetched.filename;
    expect(cameFromAnUpload(asFetched)).toBe(false);
  });

  /**
   * **Something provably not a document is still refused**, and terminally —
   * the check the whole upload path exists to make. A `.html` name and a
   * plausible size, so nothing else could be doing the refusing.
   *
   * **The fixture changed on 2026-09-08 and the change is the point.** It used
   * to be `"not a document at all, xxxx…"` — plain prose — and that is now
   * *accepted*, because the upload predicate stopped asking "is this a
   * document" and started asking "is this provably something else"
   * (docs/plans/260908a-match-the-documents-leading-tokens-instead-of-searching-for-markup.md).
   * Prose named `.html` is not provably anything else, so it goes to stage 2,
   * which is the one place that can say whether there is an article in it.
   *
   * So the fixture is now bytes no text file contains — the WHATWG
   * binary-data-byte test's own evidence — and the sibling below pins the half
   * that reversed. Between them the rejection *record* stays covered, which is
   * what this test is really for: a refusal that never reaches `uploads.reason`
   * loses the only account of why a reader's file was turned away.
   */
  it("refuses a file that is provably not text, and records why", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Uint8Array(400).fill(0x03)]);
    const { id, ctx } = await readyToVerify(bytes, "notes.html");

    await expect(STEPS.fetch.run(ctx, artefacts, nullCheckpointStore())).rejects.toThrow();
    const record = await readUpload(id);
    expect(record?.status).toBe("rejected");
    expect(record?.reason).toBe("not-a-pdf");
  });

  /**
   * **The reversal, end to end.** The unit test in tests/fetch.test.ts pins that
   * `uploadedDocumentKind` now answers `"html"` for prose; this pins that the
   * step built on it actually lets such a file through stage 1 rather than
   * refusing it somewhere else on the way. Two objects, one name, is how the
   * last bug on this path hid — see this file's own § the manifest the store
   * keeps.
   *
   * **It asserts the kind rather than merely that something resolved** ⟨Sol
   * F15⟩. `resolves.toBeDefined()` and `status === "verified"` are both
   * satisfied by a mutation that files this prose as a **PDF** and books it in
   * to the transcriber — a green test over the most expensive way to get this
   * wrong. The manifest is the artefact that carries the answer, so the
   * assertion reads it.
   */
  it("lets prose named .html through stage 1, for stage 2 to judge", async () => {
    const bytes = new TextEncoder().encode(`not a document at all, ${"x".repeat(400)}`);
    const { id, ctx } = await readyToVerify(bytes, "notes.html");

    const product = await STEPS.fetch.run(ctx, artefacts, nullCheckpointStore());
    const manifest = product.parts?.raw;
    if (!manifest) throw new Error("the step returned no manifest");
    /* By the stored hash, like its neighbours: for HTML the canonical object is
       the *decoded* string, so `shaOf(bytes)` is the wrong key here and this
       test would leave a blob behind on every run. */
    rubbish.push(() => blobs.remove(canonicalKey(manifest.storedSha256 ?? shaOf(bytes), "html")));

    expect(manifest.kind).toBe("html");
    expect(manifest.file).toBe("raw.html");
    expect((await readUpload(id))?.status).toBe("verified");
  });
});
