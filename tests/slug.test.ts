/**
 * One definition of a slug.
 *
 * `assertSlug` was copied byte-for-byte into five reader-state modules and was
 * looser than the `isSlug` that mints slugs in the first place — a path-traversal
 * guard with two answers, the weaker one on the filesystem side. See
 * docs/project/security.md and src/slug.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSlug } from "../src/ingest.js";
import { assertSlug } from "../src/slug.js";

describe("assertSlug", () => {
  it("accepts the slugs this app actually mints", () => {
    for (const ok of ["example", "constitution", "writes", "noema-mythology-of-conscious-ai", "a1"]) {
      expect(() => assertSlug(ok)).not.toThrow();
    }
  });

  it("refuses anything that could climb out of data/", () => {
    for (const bad of ["..", ".", "../../etc/passwd", "a/b", "a\\b", "", " ", "a\0b"]) {
      expect(() => assertSlug(bad)).toThrow(/Not a valid slug/);
    }
  });

  it("is deliberately looser than isSlug, which is the rule that mints", () => {
    /* Two rules, on purpose — see src/slug.ts. Minting is lower-case and
       dash-separated; reading also accepts the `_`-prefixed names that mean
       "not an article", which reader-state paths are genuinely asked about.
       Tightening this to match isSlug was tried and reverted; this test is the
       evidence for why, so the next person does not try it again. */
    for (const readableButNotMintable of ["_test-parse-json", "_test-import-convergence", "UPPER", "dot.ted"]) {
      expect(() => assertSlug(readableButNotMintable)).not.toThrow();
      expect(isSlug(readableButNotMintable)).toBe(false);
    }
  });

  it("is no weaker than isSlug about escaping data/", () => {
    // The looseness is about tidiness, never about traversal. Anything that
    // could climb out must fail BOTH.
    for (const bad of ["..", ".", "../../etc/passwd", "a/b", "a\\b", ""]) {
      expect(() => assertSlug(bad)).toThrow(/Not a valid slug/);
      expect(isSlug(bad)).toBe(false);
    }
  });

  it("refuses a name no filesystem would take, with a sentence rather than a 500", () => {
    /* Not a traversal — a long name is still one path segment. The point is that
       it fails here instead of inside mkdir as an unmapped ENAMETOOLONG. */
    expect(() => assertSlug("a".repeat(256))).toThrow(/Not a valid slug/);
    expect(() => assertSlug("a".repeat(255))).not.toThrow();
  });

  it("never lets the jobs directory be reached through a slug", () => {
    /* data/_jobs/ is the ingest queue's directory, and this has to hold in both
       directions. The version of this test written on 2026-08-26 only checked
       one of them — that src/jobs.ts builds its own path from a hardcoded
       JOBS_DIR and never consults a slug — and called the invariant proved.

       It was checking that nothing arrives *from* the queue. The direction that
       mattered was arriving *at* it: `loadComments("_jobs")` joins
       data/<slug>/comments.json, and jobs.ts reads every .json in its directory
       as a queued job, so reader state could be written into the queue and then
       parsed as work. `assertSlug` reserves the name now. Caught by review. */
    expect(() => assertSlug("_jobs")).toThrow(/Not a valid slug/);
    /* And case-folded, because the read rule admits uppercase and this repo
       develops on APFS, where `data/_JOBS/` and `data/_jobs/` are one
       directory. A reservation that only holds in lower case does not hold. */
    for (const spelling of ["_JOBS", "_Jobs", "_jObS"]) {
      expect(() => assertSlug(spelling), spelling).toThrow(/Not a valid slug/);
    }
    // And it could never be minted, which is the half that was always a rule.
    expect(isSlug("_jobs")).toBe(false);

    /* The other direction, still worth pinning: the queue builds its own path.
       It builds it in src/store/jobs-fs.ts since 2026-08-27 — the whole of the
       queue's persistence moved behind `JobStore` — and the rule travelled with
       the code rather than being left pointing at the file it used to be in. */
    const jobs = readFileSync(new URL("../src/store/jobs-fs.ts", import.meta.url), "utf8");
    expect(jobs).toMatch(/const JOBS_DIR = path\.join\(ROOT, "data", "_jobs"\)/);
    expect(jobs).not.toMatch(/assertSlug/);
  });
});
