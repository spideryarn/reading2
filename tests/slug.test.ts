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

  it("never lets the jobs directory be reached through a slug", () => {
    /* data/_jobs/ is the ingest queue's directory. The guarantee is not that a
       slug guard refuses the name — under the read rule it does not, and it does
       not need to — but that the path is never *built* from one. src/jobs.ts
       joins a hardcoded JOBS_DIR. Pinned by reading the source, because the
       failure mode if it changed is the queue's files becoming addressable as
       an article's reader state. */
    const jobs = readFileSync(new URL("../src/jobs.ts", import.meta.url), "utf8");
    expect(jobs).toMatch(/const JOBS_DIR = path\.join\(ROOT, "data", "_jobs"\)/);
    expect(jobs).not.toMatch(/assertSlug/);
    // And it could never be minted, which is the half that is a rule.
    expect(isSlug("_jobs")).toBe(false);
  });
});
