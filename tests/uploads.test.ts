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
import { MAX_UPLOAD_BYTES, formatBytes, uploadProblem } from "../src/uploads.js";

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
    expect(message).toContain("60.0 MB");
    expect(message).toContain("50.0 MB");
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
});
