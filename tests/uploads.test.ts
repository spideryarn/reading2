/**
 * Which files the picker takes, and how it says no — src/uploads.ts.
 *
 * Worth testing even though the upload path behind it is not built, because
 * this module is the half that will be shared with the server when it is
 * (docs/plans/260826u-pdf-upload-and-storage.md), and a browser and a server
 * disagreeing about what counts as a PDF is a bug nobody sees until a file is
 * accepted in one place and refused in the other.
 *
 * The assertions are about *which* files pass, never about the English — the
 * sentences are copy and copy is allowed to change (docs/project/copy.md).
 * Where a message is checked it is for one number in it, because that number
 * is the thing a reader acts on.
 */
import { describe, expect, it } from "vitest";
import {
  formatBytes,
  MAX_PAGES,
  MAX_UPLOAD_BYTES,
  uploadContentType,
  uploadKind,
  uploadLimits,
  uploadProblem,
} from "../src/uploads.js";

const pdf = (over: Partial<Parameters<typeof uploadProblem>[0]> = {}) => ({
  name: "paper.pdf",
  type: "application/pdf",
  size: 145 * 1024,
  ...over,
});

describe("uploadProblem", () => {
  it("takes an ordinary PDF", () => {
    expect(uploadProblem(pdf())).toBeNull();
  });

  it("takes a PDF the browser had no type for", () => {
    /* `File.type` is empty often enough — a drag out of an archive tool, an
       extension the OS does not know — that requiring it would refuse good
       files. The bytes are what settle it, and that check is the server's. */
    expect(uploadProblem(pdf({ type: "" }))).toBeNull();
    expect(uploadProblem(pdf({ type: "application/octet-stream" }))).toBeNull();
  });

  it("takes a shouted extension", () => {
    expect(uploadProblem(pdf({ name: "PAPER.PDF", type: "" }))).toBeNull();
  });

  it("refuses something that is plainly not a PDF", () => {
    expect(uploadProblem(pdf({ name: "notes.txt", type: "text/plain" }))).not.toBeNull();
    expect(uploadProblem(pdf({ name: "scan.png", type: "image/png" }))).not.toBeNull();
  });

  it("believes a definite type over the extension", () => {
    /* `.pdf` on the end of a name the browser is sure is plain text is a
       contradiction, and the name is the half a reader can rename for free.
       Pinned because the generous branch above is one edit away from making
       the extension enough on its own, which would let anything through by
       renaming it. */
    expect(uploadProblem(pdf({ name: "paper.pdf", type: "text/plain" }))).not.toBeNull();
  });

  it("refuses a typeless file that is not named like a PDF", () => {
    // The generous branch is generous about the *type*, not about everything:
    // with no type and no `.pdf`, there is nothing left suggesting a PDF.
    expect(uploadProblem(pdf({ name: "archive", type: "" }))).not.toBeNull();
  });

  it("refuses an empty file", () => {
    /* Zero bytes passes a size cap and fails everything after it, so it is
       worth its own sentence: the usual cause is a file still syncing, which
       the reader can do something about. */
    expect(uploadProblem(pdf({ size: 0 }))).not.toBeNull();
  });

  it("takes a file exactly on the cap and refuses one byte over", () => {
    expect(uploadProblem(pdf({ size: MAX_UPLOAD_BYTES }))).toBeNull();
    expect(uploadProblem(pdf({ size: MAX_UPLOAD_BYTES + 1 }))).not.toBeNull();
  });

  it("says how big the file was and what the limit is", () => {
    // The one thing about a refusal's wording worth pinning: a size refusal
    // that does not name the limit leaves the reader guessing how much to cut.
    const message = uploadProblem(pdf({ size: 60 * 1024 * 1024 })) ?? "";
    expect(message).toContain("60 MB");
    expect(message).toContain(formatBytes(MAX_UPLOAD_BYTES));
  });
});

describe("the pick- codes", () => {
  /**
   * **Every refusal here carries one, and they are all different.**
   *
   * The point of a code is that somebody can quote four characters instead of
   * paraphrasing — and the report that put these here was a paraphrase,
   * *"couldn't upload PDF"*, which fitted seven different branches. Two branches
   * sharing a code would put that ambiguity straight back.
   *
   * Matched on the shape, not on the exact codes, so renaming one is a copy
   * change rather than a red test — except that it must stay a `pick-` code, so
   * the family that means *the browser refused this before anything was sent*
   * stays distinguishable from `up-`, which means the server did.
   */
  const refusals = [
    uploadProblem(pdf({ name: "notes.txt", type: "text/plain" })),
    uploadProblem(pdf({ size: 0 })),
    uploadProblem(pdf({ size: MAX_UPLOAD_BYTES + 1 })),
  ];

  it("ends every sentence with a distinct pick- code", () => {
    const codes = refusals.map((m) => m?.match(/\[(pick-[a-z0-9-]+)\]$/)?.[1]);
    expect(codes.every((c) => c !== undefined), `not all coded: ${refusals}`).toBe(true);
    expect(new Set(codes).size).toBe(refusals.length);
  });
});

describe("uploadLimits", () => {
  /* The sentence itself is copy and is allowed to change; that it is derived
     from the two constants is the property, because a hint naming a limit the
     server does not enforce is worse than no hint at all. */
  it("names both caps, from the constants that enforce them", () => {
    expect(uploadLimits()).toContain(formatBytes(MAX_UPLOAD_BYTES));
    expect(uploadLimits()).toContain(String(MAX_PAGES));
  });
});

describe("formatBytes", () => {
  it("uses the units a file manager uses", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(145 * 1024)).toBe("145 KB");
    expect(formatBytes(6.1 * 1024 * 1024)).toBe("6.1 MB");
  });

  it("stops pretending to a decimal above 100 MB", () => {
    expect(formatBytes(104.7 * 1024 * 1024)).toBe("105 MB");
  });

  it("does not print a trailing .0", () => {
    /* The round numbers this prints are mostly the *limits* — `uploadLimits()`
       and the size refusal — and "up to 50.0 MB" reads as a measurement of
       something rather than a rule. */
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("50 MB");
  });
});

/**
 * **What a file claims to be, before anybody has looked at a byte.**
 *
 * A second kind became legal on 2026-09-07
 * (docs/plans/260907b-upload-an-html-file-and-a-url-for-a-pdf.md), and this file
 * still had only PDF fixtures — so nothing pinned the new answer at all until a
 * GPT Sol review pointed at the gap. The cases below are the ones where the type
 * and the name **disagree**, because agreeing is not where a guess goes wrong.
 */
describe("uploadKind", () => {
  const file = (name: string, type: string) => ({ name, type, size: 1024 });

  it("takes either the type or the name, and is not fussy about case", () => {
    expect(uploadKind(file("paper.pdf", "application/pdf"))).toBe("pdf");
    expect(uploadKind(file("saved.html", "text/html"))).toBe("html");
    expect(uploadKind(file("SAVED.HTM", ""))).toBe("html");
    expect(uploadKind(file("paper.PDF", ""))).toBe("pdf");
  });

  /* Browsers report an empty type often enough — a drag from an archive tool, an
     extension the OS does not know — that requiring one would refuse good files. */
  it("lets the name decide when the browser volunteered nothing useful", () => {
    expect(uploadKind(file("saved.html", "application/octet-stream"))).toBe("html");
  });

  /**
   * **`text/plain` cuts differently for the two kinds, and that is the point.**
   *
   * A web page *is* text, so an OS that does not know `.html` reporting plain
   * text is saying nothing that contradicts the name. A PDF is binary, so the
   * same string about a `.pdf` is a contradiction — which the case below this
   * one has pinned since before a second kind existed. Treating `text/plain` as
   * simply "vague" would have satisfied the first and broken the second.
   */
  it("reads text/plain as a shrug about a web page and a contradiction about a PDF", () => {
    expect(uploadKind(file("saved.html", "text/plain"))).toBe("html");
    expect(uploadKind(file("paper.pdf", "text/plain"))).toBeNull();
  });

  it("lets a type the browser is sure of overrule the name", () => {
    /* A `.pdf` the browser knows to be an archive is refused here rather than
       after the transfer. */
    expect(uploadKind(file("paper.pdf", "application/zip"))).toBeNull();
    expect(uploadKind(file("saved.html", "image/png"))).toBeNull();
  });

  it("refuses what is neither", () => {
    expect(uploadKind(file("notes.txt", "text/plain"))).toBeNull();
    expect(uploadKind(file("holiday.mp4", "video/mp4"))).toBeNull();
    expect(uploadKind(file("no-extension", ""))).toBeNull();
  });
});

/**
 * **The label on the browser's PUT**, which the bucket's allowlist checks.
 *
 * It was the literal `"application/pdf"` in src/web/upload.ts for every file
 * until 2026-09-07 — the one line that would have made an uploaded web page fail
 * at Storage with a 415 nobody could read.
 */
describe("uploadContentType", () => {
  const file = (name: string, type: string) => ({ name, type, size: 1024 });

  it("labels each kind as the bucket's allowlist spells it", () => {
    expect(uploadContentType(file("saved.html", ""))).toBe("text/html");
    expect(uploadContentType(file("paper.pdf", ""))).toBe("application/pdf");
  });

  /* A file `uploadProblem` has already stopped, so there is no PUT to label and
     the value cannot matter — but it must still be one the bucket would take,
     rather than an empty string or a throw. */
  it("falls back to a type the bucket allows for a file that will never be sent", () => {
    expect(uploadContentType(file("holiday.mp4", "video/mp4"))).toBe("application/pdf");
  });
});
