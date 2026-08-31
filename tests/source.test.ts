/**
 * The source model's rules, exercised without a Supabase or a database.
 *
 * These are the invariants the upload flow rests on, and every one of them is
 * pure arithmetic over strings and dates — which is the reason src/source.ts is
 * a separate module rather than logic living inside a storage adapter. A rule
 * you can only test by standing up a container is a rule that gets tested once.
 *
 * See docs/plans/260826u-pdf-upload-and-storage.md.
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
  rejectionFailure,
  type UploadStatus,
} from "../src/source.js";
import { canRetry, kindOfMessage } from "../src/messages.js";

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

  /**
   * Staging-*shaped* and still not a staging key.
   *
   * The first version of `isStagingKey` tested `[0-9a-f-]{36}` and every one of
   * these passed it — right length, right alphabet, not an id. The review found
   * it, and this is the test that would have. Without these rows the assertion
   * above is satisfied by a regex that has stopped meaning anything.
   */
  it.each([
    ["-".repeat(36), "thirty-six hyphens"],
    ["a".repeat(36), "hex with no hyphens at all"],
    ["3f2a1b8c4d5e4f608a912b3c4d5e6f70aaaa", "the right characters, wrong shape"],
    ["3f2a1b8c-4d5e-4f60-8a91-2b3c4d5e6f7", "one character short, padded elsewhere"],
    ["3f2a1b8c-4d5e-4f60-8a91-2b3c4d5e6f70/x", "an id with something after it"],
  ])("refuses staging/%s (%s)", (tail) => {
    expect(isStagingKey(`staging/${tail}`)).toBe(false);
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

  /**
   * A crashed worker must not strand the row for ever.
   *
   * Only the worker that claimed an upload was going to verify it, so without
   * this edge a `claimed` row can never move again. The recovery is deliberately
   * a *new* upload rather than a resumed one — re-reading staging after a crash
   * is the one sequence content addressing does not protect, because the grant
   * is still live and the bytes may no longer be the ones we hashed.
   */
  it("lets a claimed upload expire when its worker never came back", () => {
    expect(canTransition("claimed", "expired")).toBe(true);
  });

  /**
   * **The whole matrix, spelled out.**
   *
   * The three tests above each check one edge, and between them they would all
   * still pass if `claimed → pending` were added by accident — which is exactly
   * the edge that would let a claimed upload be handed out a second time. So
   * the legal set is written down here in full, and anything not in it is
   * asserted illegal rather than left unexamined. The review named this as the
   * gap; this is the version that closes it.
   */
  it("allows exactly these transitions and no others", () => {
    const every: UploadStatus[] = ["pending", "claimed", "verified", "rejected", "expired"];
    const legal = new Set([
      "pending>claimed",
      "pending>expired",
      "claimed>verified",
      "claimed>rejected",
      "claimed>expired",
    ]);
    for (const from of every) {
      for (const to of every) {
        expect({ edge: `${from}>${to}`, allowed: canTransition(from, to) }).toEqual({
          edge: `${from}>${to}`,
          allowed: legal.has(`${from}>${to}`),
        });
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
    /* And by a margin worth having. `TTL + 1ms` satisfies the line above and
       would be worthless against any clock skew between us and Supabase, which
       is the thing the margin is actually for. The review made that point. */
    expect(SWEEP_GRACE_MS - GRANT_TTL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  /**
   * The TTL is Supabase's, not ours, and it was measured rather than read: a
   * minted token's payload decodes to `exp - iat === 7200`. Pinning the number
   * here means a future edit that "tidies" it to something rounder has to
   * explain itself, because nothing else in this repo can tell you it is wrong.
   */
  it("matches the token lifetime that was actually measured", () => {
    expect(GRANT_TTL_MS).toBe(7200 * 1000);
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

  /**
   * **The one that matters, and the one that was missing.**
   *
   * `kindOfMessage` returns null for a code it does not know, and null means
   * *offer another go*. So before these codes were registered, "that file isn't
   * a PDF" carried a Retry button that could not work. The earlier tests here
   * checked the shape of the code and its uniqueness, and every one of them
   * stayed green through exactly that bug — which is what the review meant by
   * calling them decorative.
   */
  it.each(reasons)("reads %s back to the kind it was declared with", (reason) => {
    const failure = rejectionFailure(reason);
    expect(kindOfMessage(failure.message)).toBe(failure.kind);
  });

  it("does not offer another go at a file that will fail the same way twice", () => {
    expect(canRetry(rejectionFailure("too-big").kind)).toBe(false);
    expect(canRetry(rejectionFailure("not-a-pdf").kind)).toBe(false);
  });

  /**
   * **This asserted `true` until 2026-08-27, and the change is deliberate.**
   *
   * The instinct was right and the subject was wrong. Trying again *is* the
   * cure for a damaged transfer or an object that never arrived — but `kind`
   * does not answer "should the reader try again", it answers "will the **Retry
   * button on this job card** help". It will not: Retry re-runs the steps that
   * did not finish, and the acquisition step would read the same damaged object
   * out of the same staging key, for ever.
   *
   * That only became visible when the step was built, because until then
   * nothing could press the button. So the kind is `blocked` and both sentences
   * now name the thing that does work — choosing the file again, which mints a
   * fresh grant at a fresh key. docs/postmortems/260826a-toc-max-tokens.md is the same
   * shape.
   */
  it("does not offer a Retry that would read the same bad bytes again", () => {
    expect(canRetry(rejectionFailure("checksum-mismatch").kind)).toBe(false);
    expect(canRetry(rejectionFailure("missing").kind)).toBe(false);
  });

  /** …and still tells the reader the one thing that *would* work. */
  it("points a transfer failure at a fresh upload rather than at nothing", () => {
    for (const reason of ["checksum-mismatch", "missing"] as const) {
      expect(rejectionMessage(reason), reason).toMatch(/choos(e|ing) (it|the file) again/i);
    }
  });

  it("says the cap in megabytes rather than in bytes", () => {
    expect(rejectionMessage("too-big")).toContain(`${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
  });

  /**
   * One cap, one home. src/uploads.ts owns it because the browser's file picker
   * imports that module; a second copy here would let the picker accept a file
   * the server had started refusing, with both suites green.
   */
  it("shares one cap with the file picker", async () => {
    const picker = await import("../src/uploads.js");
    expect(MAX_UPLOAD_BYTES).toBe(picker.MAX_UPLOAD_BYTES);
  });
});
