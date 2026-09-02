/**
 * The fingerprint two machines compare without sharing a credential.
 *
 * Every test here is written as a **positive control first**: each one builds a
 * pair of states that a weaker check would call equal, and asserts this one
 * tells them apart. A digest test that only ever feeds it identical inputs
 * proves nothing at all — docs/reusable/silent-success.md.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expectedMigrations } from "../scripts/migration-ledger.js";

import {
  compareMigrations,
  EMPTY_DIGEST,
  migrationDigest,
  type AppliedMigration,
  type ExpectedMigration,
} from "../src/migration-digest.js";

const row = (created_at: number, hash: string): AppliedMigration => ({ created_at, hash });
const want = (created_at: number, hash: string, tag: string): ExpectedMigration => ({
  created_at,
  hash,
  tag,
});

describe("migrationDigest", () => {
  it("does not depend on the order the entries arrive in", () => {
    const forwards = [row(1, "aa"), row(2, "bb"), row(3, "cc")];
    const backwards = [row(3, "cc"), row(1, "aa"), row(2, "bb")];
    expect(migrationDigest(backwards).digest).toBe(migrationDigest(forwards).digest);
  });

  /**
   * The reason this is a digest over the whole list rather than a count plus
   * the newest hash. Both states below have **three rows and the same newest
   * row**, and they are different histories: one is missing `bb` in the middle
   * and holds an unexpected `zz` instead.
   */
  it("separates two histories that a count-plus-newest-hash check calls equal", () => {
    const real = [row(1, "aa"), row(2, "bb"), row(3, "cc")];
    const impostor = [row(1, "aa"), row(2, "zz"), row(3, "cc")];

    // The weaker check agrees they are the same — this is the positive control.
    expect(impostor).toHaveLength(real.length);
    expect(impostor.at(-1)).toEqual(real.at(-1));

    expect(migrationDigest(impostor).digest).not.toBe(migrationDigest(real).digest);
  });

  it("separates entries that share a hash but not a timestamp", () => {
    expect(migrationDigest([row(1, "aa")]).digest).not.toBe(migrationDigest([row(2, "aa")]).digest);
  });

  it("is stable for two migrations stamped in the same millisecond", () => {
    const a = [row(7, "bb"), row(7, "aa")];
    const b = [row(7, "aa"), row(7, "bb")];
    expect(migrationDigest(a).digest).toBe(migrationDigest(b).digest);
  });

  it("reports an empty ledger as the empty digest, and counts", () => {
    expect(migrationDigest([])).toEqual({ count: 0, digest: EMPTY_DIGEST });
    expect(migrationDigest([row(1, "aa")]).count).toBe(1);
    expect(migrationDigest([row(1, "aa")]).digest).not.toBe(EMPTY_DIGEST);
  });
});

describe("compareMigrations", () => {
  it("calls a database that matches the build in step", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    const applied = [row(1, "aa"), row(2, "bb")];
    expect(compareMigrations(expected, applied)).toEqual({ missing: [], ahead: 0 });
  });

  /**
   * The state this whole check exists to catch: the box shipped code whose
   * migration nobody applied.
   */
  it("names the migration the build needs and the database has not got", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    const applied = [row(1, "aa")];

    const { missing, ahead } = compareMigrations(expected, applied);
    expect(missing.map((m) => m.tag)).toEqual(["0002_b"]);
    expect(ahead).toBe(0);
  });

  /**
   * **The deploy window, and the reason `ahead` is not an error.**
   *
   * `npm run deploy` migrates before it pushes, so between the migration
   * landing and the new build going live, the deployment actually serving
   * traffic is one whose code predates the newest row. Report that as a fault
   * and a healthy site 503s on every single deploy.
   */
  it("does not call the old build broken when the database has moved ahead of it", () => {
    const oldBuild = [want(1, "aa", "0001_a")];
    const migratedDb = [row(1, "aa"), row(2, "bb")];

    const { missing, ahead } = compareMigrations(oldBuild, migratedDb);
    expect(missing).toEqual([]);
    expect(ahead).toBe(1);
  });

  it("reports both directions at once when the histories have diverged", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    const applied = [row(1, "aa"), row(9, "zz")];

    const { missing, ahead } = compareMigrations(expected, applied);
    expect(missing.map((m) => m.tag)).toEqual(["0002_b"]);
    expect(ahead).toBe(1);
  });

  /**
   * A migration renumbered locally — same file, different `when` — is one
   * migration in a confusing state, not one missing plus one unexpected.
   * `scripts/migration-ledger.ts` is what diagnoses the renumbering.
   */
  it("treats an identical file stamped differently as present, not as two faults", () => {
    const expected = [want(2, "aa", "0001_a")];
    const applied = [row(1, "aa")];
    expect(compareMigrations(expected, applied)).toEqual({ missing: [], ahead: 0 });
  });

  it("says nothing is missing when the build expects nothing", () => {
    expect(compareMigrations([], [row(1, "aa")])).toEqual({ missing: [], ahead: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* Reading a real checkout                                             */
/* ------------------------------------------------------------------ */

describe("expectedMigrations, against this repo's own drizzle/ folder", () => {
  const folder = path.resolve(import.meta.dirname, "../drizzle");

  it("reads every journal entry and gives each one a hash", () => {
    const expected = expectedMigrations(folder);
    expect(expected.length).toBeGreaterThan(40);
    for (const e of expected) {
      expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.tag).not.toBe("");
      expect(Number.isFinite(e.created_at)).toBe(true);
    }
  });

  it("agrees with itself, so the digest is a property of the commit", () => {
    expect(migrationDigest(expectedMigrations(folder)).digest).toBe(
      migrationDigest(expectedMigrations(folder)).digest,
    );
  });

  /**
   * The lenient version of this — skip the entry, carry on — is what would let
   * an incomplete checkout report itself in step with production.
   */
  it("refuses an incomplete checkout rather than digesting what is left", () => {
    const partial = mkdtempSync(path.join(tmpdir(), "spideryarn-journal-"));
    mkdirSync(path.join(partial, "meta"), { recursive: true });
    writeFileSync(
      path.join(partial, "meta", "_journal.json"),
      JSON.stringify({ entries: [{ idx: 0, tag: "0000_present", when: 1 }, { idx: 1, tag: "0001_absent", when: 2 }] }),
    );
    writeFileSync(path.join(partial, "0000_present.sql"), "create table a (id int);");

    expect(() => expectedMigrations(partial)).toThrow(/0001_absent/);

    // The positive control: add the missing file and the same call succeeds, so
    // the throw above is about the gap and not about the fixture being unreadable.
    writeFileSync(path.join(partial, "0001_absent.sql"), "create table b (id int);");
    expect(expectedMigrations(partial).map((e) => e.tag)).toEqual(["0000_present", "0001_absent"]);

    rmSync(partial, { recursive: true, force: true });
  });
});
