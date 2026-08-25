/**
 * The CA certificate that turns an encrypted connection into a verified one.
 *
 * These guard a failure that is quiet by design. If `certs/supabase-ca.crt`
 * goes missing or expires, [`scripts/db-migrate.ts`](../scripts/db-migrate.ts)
 * does not stop — it falls back to `rejectUnauthorized: false`, which still
 * encrypts but accepts whatever certificate the server offers. The connection
 * keeps working and looks identical from the outside. Only a warning on stderr
 * separates the two, and warnings on stderr are what nobody reads.
 *
 * So: assert the file is there, assert it is what it claims to be, and assert
 * it has not quietly expired. See docs/reusable/silent-success.md.
 *
 * No database needed — these are about a file on disk, so unlike
 * tests/db-schema.test.ts they always run.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CA = path.resolve(import.meta.dirname, "../certs/supabase-ca.crt");

/** Certificate fields, via openssl — present on macOS and Linux alike. */
function inspect(args: string[]): string {
  return execFileSync("openssl", ["x509", "-in", CA, "-noout", ...args], {
    encoding: "utf8",
  }).trim();
}

describe("the Supabase CA certificate", () => {
  it("is present, and named what db-migrate looks for", () => {
    // The filename is the contract: db-migrate resolves this exact path so that
    // dropping the file in is the whole install. Renaming it silently downgrades
    // every remote connection to unverified.
    expect(existsSync(CA)).toBe(true);
  });

  it("is a PEM certificate rather than an HTML error page", () => {
    // A download that failed while looking like it worked is a real outcome —
    // an expired dashboard session returns a login page with a 200, and it
    // lands on disk with the filename you asked for.
    const text = readFileSync(CA, "utf8");
    expect(text.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(text.trimEnd().endsWith("-----END CERTIFICATE-----")).toBe(true);
  });

  it("is Supabase's root CA, and is a CA", () => {
    expect(inspect(["-subject"])).toContain("Supabase Root 2021 CA");
    // Self-signed root: it vouches for the server certificates rather than
    // being one. A leaf certificate here would verify nothing.
    expect(inspect(["-issuer"])).toContain("Supabase Root 2021 CA");
    expect(execFileSync("openssl", ["x509", "-in", CA, "-noout", "-text"], { encoding: "utf8" }))
      .toContain("CA:TRUE");
  });

  it("carries no project identifier, which is why committing it is safe", () => {
    // The decision to commit rather than git-ignore rests on this being the
    // same public file every Supabase customer downloads. If a future
    // certificate is ever project-scoped, this fails and the decision gets
    // revisited instead of inherited.
    const text = readFileSync(CA, "utf8");
    expect(text).not.toMatch(/alschkahzfagtppxspfq/);
  });

  it("has not expired, and is not about to", () => {
    // Valid until 2031-04-26. Far away — which is exactly why nobody will be
    // watching when it stops being far away, and why the check is 90 days
    // rather than zero: an alarm that fires the day it breaks is not an alarm.
    const ninetyDays = 90 * 24 * 60 * 60;
    let stillValid = true;
    try {
      execFileSync("openssl", ["x509", "-in", CA, "-noout", "-checkend", String(ninetyDays)], {
        stdio: "ignore",
      });
    } catch {
      stillValid = false;
    }
    expect(stillValid, `${CA} expires within 90 days — download a fresh one`).toBe(true);
  });
});
