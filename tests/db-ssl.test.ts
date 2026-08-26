/**
 * The TLS decision, which is the kind of thing that fails by succeeding.
 *
 * A connection that is encrypted but does not verify the server looks exactly
 * like one that does: same latency, same queries, same everything. The only
 * difference is whether a machine in the middle could be reading it. So the
 * branch worth testing hardest is the one nobody would notice taking — see
 * docs/reusable/silent-success.md.
 *
 * tests/db-tls.test.ts is the companion and asserts a different thing: that the
 * certificate FILE is present and valid. This asserts what the code DOES with
 * it. Neither implies the other, which is why there are two.
 *
 * No database needed.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";

import { isLocalDatabaseUrl, sslDecisionFor } from "../src/db/ssl.js";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54362/postgres";
const REMOTE = "postgresql://postgres.abc:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
const REAL_CA = path.resolve(import.meta.dirname, "../certs/supabase-ca.crt");
const MISSING = path.resolve(import.meta.dirname, "../certs/does-not-exist.crt");

describe("isLocalDatabaseUrl", () => {
  it("recognises the two loopback spellings", () => {
    expect(isLocalDatabaseUrl(LOCAL)).toBe(true);
    expect(isLocalDatabaseUrl("postgresql://postgres:postgres@localhost:54362/postgres")).toBe(
      true,
    );
  });

  it("does not treat the Supabase pooler as local", () => {
    expect(isLocalDatabaseUrl(REMOTE)).toBe(false);
  });

  it("is not fooled by a loopback address in the password or the database name", () => {
    // The `@` anchor is what makes this true, and it is easy to lose in a
    // "simplification" of the regex. A URL that wrongly reads as local skips
    // BOTH guards at once: TLS is turned off, and db-migrate stops asking for
    // DB_MIGRATE_ALLOW_REMOTE before touching the real project.
    expect(isLocalDatabaseUrl("postgresql://user:127.0.0.1@example.com:5432/db")).toBe(false);
    expect(isLocalDatabaseUrl("postgresql://user:pw@example.com:5432/localhost")).toBe(false);
  });
});

describe("sslDecisionFor", () => {
  it("turns TLS off for local, because the container has no certificate", () => {
    const decision = sslDecisionFor(LOCAL);
    expect(decision.mode).toBe("disabled");
    expect(decision.ssl).toBe(false);
  });

  it("verifies against the committed certificate for a remote host", () => {
    const decision = sslDecisionFor(REMOTE, { defaultCaPath: REAL_CA });
    expect(decision.mode).toBe("verified");
    // `rejectUnauthorized: true` is the whole point. If a refactor ever makes
    // this `false` the connection still works, which is why it is asserted
    // rather than left to integration testing.
    expect(decision.ssl).toMatchObject({ rejectUnauthorized: true });
    expect(decision.mode === "verified" && decision.ssl.ca).toContain("BEGIN CERTIFICATE");
  });

  it("falls back to encrypted-but-unverified when there is no certificate at all", () => {
    const decision = sslDecisionFor(REMOTE, { defaultCaPath: MISSING });
    expect(decision.mode).toBe("encrypted-unverified");
    expect(decision.ssl).toMatchObject({ rejectUnauthorized: false });
    // The caller has to be able to say what is wrong, or the warning is noise.
    expect(decision.why).toContain("not verified");
  });

  it("throws rather than degrading when PGSSLROOTCERT names a file that is not there", () => {
    // Asking for verification and silently not getting it is worse than either
    // outcome on its own: you believe you are covered. An explicit path that
    // does not resolve is a typo, and a typo should stop the run.
    expect(() => sslDecisionFor(REMOTE, { configuredCaPath: MISSING })).toThrow(/PGSSLROOTCERT/);
  });

  it("prefers an explicit certificate over the committed one", () => {
    const decision = sslDecisionFor(REMOTE, {
      configuredCaPath: REAL_CA,
      defaultCaPath: MISSING,
    });
    expect(decision.mode).toBe("verified");
  });
});
