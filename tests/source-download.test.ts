/**
 * **What `GET /api/source/:slug` does when the bytes are not simply there.**
 *
 * The route serves the document an article was made from — the reader's own
 * uploaded PDF, or the one we fetched. It read that document off the local
 * filesystem until 2026-08-31, which meant the feature worked on a laptop and
 * 404d on every production request, because Vercel has no such disk. It goes
 * through the store now — `SourceStore.readPdf`, since two sessions fixed the
 * same bug on 2026-08-31 and that narrower seam is the one the route took
 * (docs/plans/260831b-finish-the-database-move.md § stage 1b).
 *
 * **`readRawDocument` is still the one reading of the source reference**, and
 * that is why it is still tested here. `db:export` calls it,
 * `ArticleReader.loadSource` calls it, and every decision below — whether a
 * dangling reference is an error, whether the bucket handed back the right
 * bytes — is made here once. `pgSourceStore` makes the same decisions the same
 * way for the route; tests/source-store.test.ts is where that is pinned against
 * a real database, and the two must not drift.
 *
 * ## Why the interesting tests are here and not on the route
 *
 * Everything that can go wrong here goes wrong *between* the revision row and
 * the bytes, and `readRawDocument` is where those decisions are made. It takes
 * its blob store as a parameter, so all four outcomes can be produced exactly —
 * no database, no bucket, no mocking of a module.
 *
 * GPT Sol's review of the plan asked for exactly this list, and for the reason
 * to be written down: **the three failures are not the same failure.**
 *
 *  1. no reference → `null` → the route's 404. *This article kept no source
 *     document*, which is an ordinary state. (Until 2026-09-01 there was a
 *     second place to look first — `article_revisions.raw_bytes` — and this
 *     outcome meant "and no legacy column either". The column is dropped;
 *     docs/plans/260831b-finish-the-database-move.md § *Stage 4*.)
 *  2. a reference the bucket cannot answer → `MissingRawObject`, a 500. The row
 *     asserts the object exists, so this is a broken invariant — a deleted
 *     object, or a deployment pointing at the wrong bucket. Answering 404 would
 *     tell an owner their paper never existed because somebody mis-set an
 *     environment variable, and monitoring would see an ordinary not-found.
 *  3. a reference whose object hashes to something else → `CorruptRawObject`,
 *     a 500. The key **is** the digest, so one of the two is wrong and neither
 *     can be trusted. Without this check a bad backfill or anybody with the
 *     service key could put one reader's document under another's key and the
 *     route would hand it over to a caller who is authorised for the wrong
 *     article.
 *  4. the blob store itself throwing → the throw propagates, and routes.ts
 *     turns an error with no `status` into a 500.
 *
 * A test for (1) and (4) alone would have passed against a route that answered
 * 404 for all of 1–3, which is the version that was planned.
 *
 * docs/plans/plain-mode-and-the-way-out.md § 5.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RawSourceStore } from "../src/store/blobs.js";
import { CorruptRawObject, MissingRawObject, readRawDocument } from "../src/store/raw-document.js";
import { contentDisposition } from "../src/routes.js";
import { canonicalKey } from "../src/source.js";

const PDF = new TextEncoder().encode("%PDF-1.7\nnot really a pdf, but bytes are bytes\n");
const SHA = createHash("sha256").update(PDF).digest("hex");

/**
 * A blob store that answers one key and nothing else.
 *
 * The three write methods throw rather than no-op: this is a *read* path, and a
 * test that quietly tolerated a write here would stop noticing the day one
 * appeared.
 */
function bucket(contents: Record<string, Uint8Array>): RawSourceStore {
  const refuse = () => {
    throw new Error("the source route must not write to the blob store");
  };
  return {
    head: async (key) => {
      const bytes = contents[key];
      return bytes ? { bytes: bytes.byteLength, contentType: "application/pdf" } : null;
    },
    get: async (key) => contents[key] ?? null,
    putIfAbsent: refuse,
    remove: refuse,
  };
}

/** A revision row pointing at `SHA`. */
const REFERENCING = {
  rawSourceSha256: SHA,
  rawSourceKind: "pdf",
};

describe("the raw document a source download resolves to", () => {
  it("hands back the object the revision names, verified against its key", async () => {
    const got = await readRawDocument("a-slug", REFERENCING, bucket({ [canonicalKey(SHA, "pdf")]: PDF }));
    expect(got).toEqual({ bytes: PDF, kind: "pdf", storedSha256: SHA });
  });

  /**
   * **Half a reference is not a reference.**
   *
   * `article_revisions_raw_source_both` makes the pair all-or-nothing in the
   * database, so this is belt-and-braces — but the function is handed rows by
   * three callers and a `sha256` with no `kind` must not be followed to a key
   * built from a guess.
   */
  it("says null — not an error — when the article kept no source at all", async () => {
    for (const revision of [
      { rawSourceSha256: null, rawSourceKind: null },
      { rawSourceSha256: SHA, rawSourceKind: null },
      { rawSourceSha256: null, rawSourceKind: "pdf" },
    ]) {
      expect(await readRawDocument("a-slug", revision, bucket({}))).toBeNull();
    }
  });

  it("refuses, rather than 404s, when the bucket cannot answer a reference it holds", async () => {
    await expect(readRawDocument("a-slug", REFERENCING, bucket({}))).rejects.toThrow(MissingRawObject);
    /* The status is the whole point of the distinction — see the header. */
    await expect(readRawDocument("a-slug", REFERENCING, bucket({}))).rejects.toMatchObject({
      status: 500,
    });
  });

  it("refuses an object that is not what its key says it is", async () => {
    const wrong = new TextEncoder().encode("%PDF-1.7\nsomebody else's paper\n");
    await expect(
      readRawDocument("a-slug", REFERENCING, bucket({ [canonicalKey(SHA, "pdf")]: wrong })),
    ).rejects.toThrow(CorruptRawObject);
  });

  it("lets a blob-store failure through, so it cannot be read as an absent document", async () => {
    const broken: RawSourceStore = {
      ...bucket({}),
      get: async () => {
        throw new Error("Storage said 503");
      },
    };
    /* Not `MissingRawObject`: the store failed, it did not answer. An error with
       no `status` becomes a 500 in routes.ts, which is what an outage should
       look like. */
    await expect(readRawDocument("a-slug", REFERENCING, broken)).rejects.toThrow("Storage said 503");
  });
});

/**
 * The header the file arrives under. `raw_filename` is whatever a browser sent
 * when somebody uploaded a PDF, so it is reader-controlled text going into a
 * response header — quotes, backslashes and any of Unicode are all reachable.
 */
describe("the Content-Disposition a downloaded source carries", () => {
  it("keeps an ordinary name in both parameters", () => {
    expect(contentDisposition("paper.pdf", "inline")).toBe(
      `inline; filename="paper.pdf"; filename*=UTF-8''paper.pdf`,
    );
  });

  /**
   * **The disposition is the caller's, and it is required.**
   *
   * The function returned a hard-coded `inline` until 2026-09-01, because its
   * only caller was *view the original* and a browser that can show a PDF
   * should show it. A download route needs `attachment`, so the type is now a
   * parameter — and the type says which two words are legal, so a typo is a
   * compile error rather than a header a browser silently ignores.
   */
  it("says attachment when the caller asks for one, and changes nothing else", () => {
    expect(contentDisposition("paper.pdf", "attachment")).toBe(
      `attachment; filename="paper.pdf"; filename*=UTF-8''paper.pdf`,
    );
  });

  /**
   * The escaping is the disposition's business in neither direction: the same
   * awkward name must come out the same way under both. Asserted rather than
   * assumed, because the obvious refactor of this function is one that builds
   * the two dispositions down two paths.
   */
  it("escapes a name identically whichever disposition it is asked for", () => {
    const awkward = "O'Brien (draft)* бумага\uD800.pdf";
    expect(contentDisposition(awkward, "attachment")).toBe(
      contentDisposition(awkward, "inline").replace(/^inline/, "attachment"),
    );
  });

  it("cannot be made to end the quoted string early", () => {
    const header = contentDisposition('ev"il\\.pdf', "inline");
    /* Exactly two quotes: the ones this function opened and closed. A name that
       could add a third could add a parameter of its own. */
    expect(header.split('"')).toHaveLength(3);
    expect(header).not.toContain("\\");
  });

  it("carries a non-ASCII name in filename* and a legible fallback in filename", () => {
    const header = contentDisposition("бумага 日本.pdf", "inline");
    /* The fallback is ASCII throughout — a client that reads only `filename=`
       must still get something it can write to disk. */
    const fallback = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    expect(fallback).toMatch(/^[\x20-\x7e]*$/);
    /* And the real name survives, decodable, in the parameter that is defined to
       win wherever it is understood. */
    const encoded = header.slice(header.indexOf("UTF-8''") + "UTF-8''".length);
    expect(decodeURIComponent(encoded)).toBe("бумага 日本.pdf");
  });

  /**
   * **`encodeURIComponent` is not RFC 5987 on its own.** `'`, `(`, `)` and `*`
   * survive it untouched, and none of them is in the `attr-char` set an extended
   * parameter is defined over — so a strict client is entitled to ignore the
   * parameter and fall back to the lossy ASCII half for a name that did not need
   * it. GPT Sol, second pass, 2026-08-31.
   */
  it("percent-encodes the four characters encodeURIComponent leaves alone", () => {
    const header = contentDisposition("O'Brien (draft)*.pdf", "inline");
    const encoded = header.slice(header.indexOf("UTF-8''") + "UTF-8''".length);
    expect(encoded).toBe("O%27Brien%20%28draft%29%2A.pdf");
    /* And it still round-trips, so the escaping did not change the name. */
    expect(decodeURIComponent(encoded)).toBe("O'Brien (draft)*.pdf");
  });

  /**
   * **A lone surrogate is a legal JavaScript string and an illegal Unicode
   * scalar**, and `encodeURIComponent` throws `URIError` on one. The name came
   * off a stranger's filesystem through a browser, so it is reachable — and the
   * result would be *view the original* answering 500 for a reason with no
   * visible connection to filenames at all.
   */
  it("does not throw on a malformed filename", () => {
    const header = contentDisposition("bad\uD800name.pdf", "inline");
    expect(header).toContain("filename*=UTF-8''");
    /* The replacement character, not the surrogate. */
    const encoded = header.slice(header.indexOf("UTF-8''") + "UTF-8''".length);
    expect(decodeURIComponent(encoded)).toBe("bad\uFFFDname.pdf");
  });

  it("does not lose a name made entirely of awkward characters", () => {
    /* Replaced rather than stripped, so the fallback is never the empty string —
       which some clients treat as "no name" and others as a literal one. */
    expect(contentDisposition("日本", "inline")).toContain('filename="__"');
  });
});
