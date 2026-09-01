/**
 * The fence on `npm run db:reown`, driven with the cases that would get past a
 * weaker one.
 *
 * `db:reown` rewrites `owner_id` on every row in the schema, so "which database
 * is this?" is the highest-consequence question it asks. It used to answer it
 * with `isLocalDatabaseUrl` alone, and GPT Sol showed on 2026-09-01 that a
 * tunnel to a remote Postgres satisfies that exactly as the real container does.
 * The rule now compares against what the Supabase CLI says about this repo's own
 * containers, and these are the cases that separates.
 */
import { describe, expect, it } from "vitest";

import { endpointOf, refuseUnlessOurDatabase } from "../scripts/db-reown-rules.js";
import { parseStatusEnv } from "../scripts/seed-accounts.js";
import { withoutPassword } from "../src/db/ssl.js";

/** What `supabase status -o env` prints for this repo's stack. */
const OURS = parseStatusEnv(
  [
    'API_URL="http://127.0.0.1:54361"',
    'DB_URL="postgresql://postgres:postgres@127.0.0.1:54362/postgres"',
  ].join("\n"),
);

const allow = (url: string) => refuseUnlessOurDatabase(url, OURS, withoutPassword);

describe("endpointOf", () => {
  it("folds the three spellings of loopback together, and keeps the port", () => {
    expect(endpointOf("postgresql://u:p@127.0.0.1:54362/postgres")).toBe("127.0.0.1:54362");
    expect(endpointOf("postgresql://u:p@localhost:54362/postgres")).toBe("127.0.0.1:54362");
    expect(endpointOf("postgresql://u:p@[::1]:54362/postgres")).toBe("127.0.0.1:54362");
  });

  it("is undefined rather than a guess for something that is not a URL", () => {
    expect(endpointOf("not a url")).toBeUndefined();
    expect(endpointOf("")).toBeUndefined();
  });
});

describe("refuseUnlessOurDatabase", () => {
  it("allows this repo's stack, however the loopback address is spelled", () => {
    expect(allow("postgresql://postgres:postgres@127.0.0.1:54362/postgres")).toBeUndefined();
    expect(allow("postgresql://postgres:postgres@localhost:54362/postgres")).toBeUndefined();
  });

  /**
   * **The case a loopback check cannot see.** `ssh -L 5433:remote:5432` puts a
   * production database on 127.0.0.1, and `isLocalDatabaseUrl` says yes. The
   * port is what gives it away, because the CLI reports the port its own
   * container is on.
   */
  it("refuses a remote database forwarded onto loopback", () => {
    const why = allow("postgresql://postgres:postgres@127.0.0.1:5433/postgres");
    expect(why).toContain("forwarded port");
  });

  /** The old app on this laptop runs its own Supabase on 54342. */
  it("refuses another local stack on another port", () => {
    expect(allow("postgresql://postgres:postgres@127.0.0.1:54342/postgres")).toContain(
      "this repo's local stack is at",
    );
  });

  it("refuses a remote host outright", () => {
    expect(allow("postgresql://u:p@db.alschkahzfagtppxspfq.supabase.co:5432/postgres")).toContain(
      "Refusing",
    );
  });

  it("refuses rather than proceeds when the CLI said nothing about a database", () => {
    const why = refuseUnlessOurDatabase(
      "postgresql://postgres:postgres@127.0.0.1:54362/postgres",
      parseStatusEnv('API_URL="http://127.0.0.1:54361"'),
      withoutPassword,
    );
    expect(why).toContain("npm run db:start");
  });

  it("refuses a DATABASE_URL it cannot parse, rather than treating it as ours", () => {
    expect(allow("postgres-but-not-a-url")).toContain("Refusing");
  });

  /**
   * The refusal is printed, and a connection string can carry a password. Both
   * halves of the message go through `withoutPassword`, and this is the test
   * that would notice if one of them stopped.
   */
  it("never prints a password in the refusal", () => {
    const why = allow("postgresql://postgres:hunter2-s3cret@127.0.0.1:5433/postgres");
    expect(why).toBeDefined();
    expect(why).not.toContain("hunter2");
  });
});
