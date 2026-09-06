/**
 * One definition of a slug.
 *
 * `assertSlug` was copied byte-for-byte into five reader-state modules and was
 * looser than the `isSlug` that mints slugs in the first place — a path-traversal
 * guard with two answers, the weaker one on the filesystem side. See
 * docs/project/security.md and src/slug.ts.
 */
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

    /* **The outbound half of this invariant went with the directory**, on
       2026-09-05, in stage G of
       docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
       Three lines here used to read src/store/jobs-fs.ts *as source text* and
       assert that it built `data/_jobs/` from a hardcoded `JOBS_DIR` and never
       consulted a slug — the queue building its own path rather than taking one
       from a reader.

       It is not relocated to src/store/pg-jobs.ts, and that is the point rather
       than an omission: `jobs.slug` is a text column there. There is no
       `path.join`, no directory, and so nothing for a slug to escape into — the
       property has ceased to exist rather than moved. The inbound half above is
       the whole of the rule now.

       (This was the one test in the tree that went red purely because a file was
       deleted, and it looked unrelated. Recorded in the plan at § *Stage G*.) */
  });
});
