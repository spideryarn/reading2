/**
 * The one judgement in the manifest backfill, checked against the broken state.
 *
 * `scripts/backfill-raw-manifests.ts` puts a document already on disk into the
 * `sources` bucket and writes the two fields that name it. Most of it is
 * filesystem work; `whyNotUsable` is the part that decides whether a manifest
 * may be trusted at all, and it is pure so it can be **seen to say yes**.
 *
 * It exists because the first version cast the parsed JSON to `RawManifest`
 * without checking it. `{ kind: "html", file: "raw.pdf" }` would have gone
 * through, and the PDF bytes beside it would have landed in the bucket under an
 * **HTML** canonical key — bytes at a name that does not describe them, which is
 * the one thing content addressing must never do. GPT Sol, 2026-08-28.
 *
 * The rest of the script was watched failing against the real container: with
 * the object removed from the bucket, the run refuses and exits 1.
 */
import { describe, expect, it } from "vitest";

import { whyNotUsable } from "../scripts/backfill-raw-manifests.js";
import type { RawManifest } from "../src/fetch.js";

const PDF = Buffer.from("%PDF-1.7\nnot really a pdf but it sniffs like one");
const HTML = Buffer.from("<!doctype html><p>a page</p>");

const manifest = (over: Partial<RawManifest>): RawManifest => ({
  kind: "html",
  file: "raw.html",
  contentType: "text/html",
  encoding: "utf-8",
  bytes: HTML.byteLength,
  sha256: null,
  fetchedAt: "2026-08-28T00:00:00.000Z",
  ...over,
});

describe("whether a manifest may be trusted enough to store its bytes", () => {
  it("accepts one that agrees with itself", () => {
    expect(whyNotUsable(manifest({}), HTML)).toBeNull();
    expect(whyNotUsable(manifest({ kind: "pdf", file: "raw.pdf" }), PDF)).toBeNull();
  });

  it("refuses a kind and a filename that disagree", () => {
    /* The exact shape that would have put PDF bytes under an HTML key. */
    expect(whyNotUsable(manifest({ kind: "html", file: "raw.pdf" }), PDF)).toMatch(
      /kind is html and file is "raw\.pdf"/,
    );
  });

  it("refuses a manifest whose kind the bytes contradict", () => {
    /* **The check the other two cannot make.** A manifest can be perfectly
       self-consistent and still describe a different document from the one
       beside it — `raw.html` holding a PDF. `sniffKind` is the authority, for
       the reason src/fetch.ts gives: a PDF served as `application/octet-stream`
       is still a PDF. */
    expect(whyNotUsable(manifest({}), PDF)).toMatch(/kind says html and the bytes look like pdf/);
  });

  it("refuses a kind that is not one of the two", () => {
    expect(whyNotUsable(manifest({ kind: "docx" as RawManifest["kind"] }), HTML)).toMatch(
      /not html or pdf/,
    );
  });

  it("does not take the content type's word over the bytes", () => {
    /* A PDF served as HTML is still a PDF, and a manifest saying `html` about
       it is wrong however confidently the header agrees. */
    expect(whyNotUsable(manifest({ contentType: "text/html" }), PDF)).toMatch(/look like pdf/);
  });
});
