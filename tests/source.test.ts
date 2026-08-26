/**
 * The source model's rules, exercised without a Supabase or a database.
 *
 * These are the invariants the upload flow rests on, and every one of them is
 * pure arithmetic over strings and dates — which is the reason src/source.ts is
 * a separate module rather than logic living inside a storage adapter. A rule
 * you can only test by standing up a container is a rule that gets tested once.
 *
 * See docs/plans/pdf-upload-and-storage.md.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalKey,
  canTransition,
  cleanFilename,
  GRANT_TTL_MS,
  grantExpired,
  isStagingKey,
  looksLikePdf,
  MAX_UPLOAD_BYTES,
  rejectionMessage,
  type RejectReason,
  stagingKey,
  SWEEP_GRACE_MS,
  sweepable,
  type UploadStatus,
} from "../src/source.js";

const UPLOAD_ID = "3f2a1b8c-4d5e-4f60-8a91-2b3c4d5e6f70";
const HASH = "a".repeat(64);

describe("the keys a grant may and may not be minted for", () => {
  it("builds a staging key from our own id", () => {
    expect(stagingKey(UPLOAD_ID)).toBe(`staging/${UPLOAD_ID}`);
  });

  /* The rule the plan calls load-bearing: never accept a client-supplied
     object path. These are the strings a caller would send to get one. */
  it.each([
    ["../../etc/passwd", "climbing out of the prefix"],
    ["3f2a1b8c-4d5e-4f60-8a91-2b3c4d5e6f70/../../elsewhere", "a valid id with a tail"],
    ["not-a-uuid", "not an id at all"],
    ["", "empty"],
    ["3F2A1B8C-4D5E-4F60-8A91-2B3C4D5E6F70", "upper case, which Postgres never emits"],
  ])("refuses %s (%s) rather than building a key from it", (attempt) => {
    expect(() => stagingKey(attempt)).toThrow(/Not an upload id/);
  });

  it("names a canonical object after its own contents", () => {
    expect(canonicalKey(HASH, "pdf")).toBe(`sha256/${HASH}.pdf`);
    expect(canonicalKey(HASH, "html")).toBe(`sha256/${HASH}.html`);
  });

  it("refuses anything that is not a hash, so a key cannot lie about its contents", () => {
    expect(() => canonicalKey("short", "pdf")).toThrow(/Not a SHA-256/);
    expect(() => canonicalKey(`${"a".repeat(63)}Z`, "pdf")).toThrow(/Not a SHA-256/);
    expect(() => canonicalKey(`../${"a".repeat(61)}`, "pdf")).toThrow(/Not a SHA-256/);
  });

  /* The invariant the whole replay story rests on: a canonical key must never
     look like something a grant could be minted against. */
  it("never mistakes a canonical key for a staging key", () => {
    expect(isStagingKey(stagingKey(UPLOAD_ID))).toBe(true);
    expect(isStagingKey(canonicalKey(HASH, "pdf"))).toBe(false);
    expect(isStagingKey("staging/../sha256/x")).toBe(false);
  });
});

describe("an upload moves through its states exactly once", () => {
  it("claims a pending upload, and cannot claim it twice", () => {
    expect(canTransition("pending", "claimed")).toBe(true);
    expect(canTransition("claimed", "claimed")).toBe(false);
  });

  it("will not let an upload skip being claimed", () => {
    /* Straight to verified would mean two finalisations could both pass the
       checks and both enqueue a job that spends money. */
    expect(canTransition("pending", "verified")).toBe(false);
    expect(canTransition("pending", "rejected")).toBe(false);
  });

  it("treats every ending as an ending", () => {
    const terminal: UploadStatus[] = ["verified", "rejected", "expired"];
    const every: UploadStatus[] = ["pending", "claimed", "verified", "rejected", "expired"];
    for (const from of terminal) {
      for (const to of every) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe("a sweep must not race the browser it is cleaning up after", () => {
  /**
   * The load-bearing one. Deleting a staging object re-arms any grant still
   * live over its key — measured against the running stack, not read in a doc.
   * So the grace period has to outlast the grant, and a change that quietly
   * shortened it would reopen exactly that window.
   */
  it("waits strictly longer than a grant lives", () => {
    expect(SWEEP_GRACE_MS).toBeGreaterThan(GRANT_TTL_MS);
  });

  it("calls a grant dead only once its two hours are up", () => {
    const minted = new Date("2026-08-26T12:00:00Z");
    expect(grantExpired(minted, new Date("2026-08-26T13:59:59Z"))).toBe(false);
    expect(grantExpired(minted, new Date("2026-08-26T14:00:00Z"))).toBe(true);
  });

  it("will not sweep an object whose grant has only just expired", () => {
    const minted = new Date("2026-08-26T12:00:00Z");
    /* Expired, but not yet sweepable — the gap between these two is the whole
       point of there being two functions. */
    const justExpired = new Date("2026-08-26T14:00:01Z");
    expect(grantExpired(minted, justExpired)).toBe(true);
    expect(sweepable(minted, justExpired)).toBe(false);
    expect(sweepable(minted, new Date("2026-08-26T15:00:00Z"))).toBe(true);
  });
});

describe("what the bytes actually are", () => {
  it("recognises a PDF by its first five bytes", () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe(true);
  });

  it("is not fooled by a file that merely claims to be one", () => {
    expect(looksLikePdf(new TextEncoder().encode("<html>not a pdf</html>"))).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode("%PDF"))).toBe(false); // truncated
    expect(looksLikePdf(new Uint8Array())).toBe(false);
    /* `%PDF-` further in does not count: pdf.js wants it at the start, and a
       prefix is how you smuggle something else past a naive `includes`. */
    expect(looksLikePdf(new TextEncoder().encode("GIF89a%PDF-"))).toBe(false);
  });
});

describe("a filename is a stranger's string", () => {
  it("keeps the last segment and never the path", () => {
    expect(cleanFilename("papers/2026/thesis.pdf")).toBe("thesis.pdf");
    expect(cleanFilename("..\\..\\windows\\system32\\evil.pdf")).toBe("evil.pdf");
    expect(cleanFilename("../../../etc/passwd")).toBe("passwd");
  });

  it("drops control characters rather than storing or showing them", () => {
    expect(cleanFilename("re\u0000port\u001b[31m.pdf")).toBe("report[31m.pdf");
    expect(cleanFilename("a\tb.pdf")).toBe("ab.pdf");
  });

  it("bounds the length", () => {
    expect(cleanFilename(`${"x".repeat(4000)}.pdf`)).toHaveLength(200);
  });

  it("returns null when there is nothing left worth showing", () => {
    expect(cleanFilename("")).toBeNull();
    expect(cleanFilename("   ")).toBeNull();
    expect(cleanFilename("..")).toBeNull();
    expect(cleanFilename("some/dir/")).toBeNull();
    expect(cleanFilename("\u0000\u001f")).toBeNull();
  });
});

describe("the words a refused upload gets", () => {
  const reasons: RejectReason[] = ["too-big", "not-a-pdf", "checksum-mismatch", "missing"];

  /* docs/project/copy.md: every message ends in a bracketed code, so a reader
     can quote four characters and a test can stop pinning prose. */
  it.each(reasons)("gives %s a code of its own", (reason) => {
    expect(rejectionMessage(reason)).toMatch(/\[[a-z-]+\]$/);
  });

  it("gives every reason a different code", () => {
    const codes = reasons.map((r) => rejectionMessage(r).match(/\[([a-z-]+)\]$/)?.[1]);
    expect(new Set(codes).size).toBe(reasons.length);
  });

  it("says the cap in megabytes rather than in bytes", () => {
    expect(rejectionMessage("too-big")).toContain(`${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  });

  /* copy.md again: say what happened and what to do, and never leave the
     reader wondering whether their file is sitting half-uploaded somewhere. */
  it("tells a reader with too big a file that nothing was uploaded", () => {
    expect(rejectionMessage("too-big")).toContain("Nothing was uploaded");
  });
});
