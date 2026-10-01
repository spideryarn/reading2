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

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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

  it("is not fooled by an unescaped @ in the password", () => {
    /* Everything before the LAST `@` is userinfo, so this URL points at
       example.com. A regex looking for `@localhost:` anywhere in the string
       finds one in the PASSWORD and calls a remote database local — which
       turns TLS off and lets db-migrate run without DB_MIGRATE_ALLOW_REMOTE.
       GPT Sol found this in review, 2026-08-26.

       An unescaped `@` in a password is a mistake rather than a rarity: it is
       what you get by pasting a generated password into a connection string
       without percent-encoding it, which is how most of these are written. */
    expect(isLocalDatabaseUrl("postgresql://user:p@localhost:5432@example.com:5432/db")).toBe(
      false,
    );
    expect(isLocalDatabaseUrl("postgresql://user:pw@127.0.0.1@example.com:5432/db")).toBe(false);
  });

  it("says no rather than throwing when the URL will not parse", () => {
    // Fail closed. "I cannot tell" must not read as "yes, local", because the
    // answer authorises a destructive command against whatever this is.
    expect(isLocalDatabaseUrl("not a url at all")).toBe(false);
    expect(isLocalDatabaseUrl("")).toBe(false);
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

/**
 * A connection string can name one host in its authority and connect to another.
 *
 * `pg` parses with `pg-connection-string`, which honours a `?host=` query
 * parameter and lets it OVERRIDE the authority host — libpq's `host` keyword,
 * reachable from a URL. So
 *
 *     postgres://u:p@127.0.0.1:54362/db?host=remote.example.com
 *
 * parses to `{ host: "remote.example.com" }` while `new URL(...).hostname` says
 * `127.0.0.1`. Every caller of `isLocalDatabaseUrl` asked the URL and got the
 * wrong answer: `scripts/db-migrate.ts` would let it past the guard that exists
 * to stop a migration reaching production, print a `Target:` line naming the
 * loopback address, and apply the migrations to the remote host — with TLS
 * turned off, because this same function decides that too.
 *
 * The rule is the one the docstring above already states: the question is "is
 * this the throwaway container", not "where do the packets probably go". A URL
 * that carries a host override is not answering that question, so it fails
 * closed like anything else this cannot read. Found by GPT Sol, 2026-08-31.
 */
describe("a host override in the query string", () => {
  it.each([
    ["host", "postgres://u:p@127.0.0.1:54362/db?host=remote.example.com"],
    ["hostaddr", "postgres://u:p@127.0.0.1:54362/db?hostaddr=203.0.113.4"],
    ["host, among other params", "postgres://u:p@localhost:54362/db?sslmode=disable&host=remote.example.com"],
  ])("is not local, however loopback the authority looks (%s)", (_label, url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });

  it("still accepts an ordinary local URL with harmless parameters", () => {
    expect(isLocalDatabaseUrl("postgres://u:p@127.0.0.1:54362/db?sslmode=disable")).toBe(true);
    expect(isLocalDatabaseUrl("postgres://u:p@127.0.0.1:54362/db")).toBe(true);
  });
});

/**
 * **What `pg` actually does with the decision**, asked of `pg` itself rather
 * than of our reading of it. `pg` merges the parsed connection string OVER the
 * config it is handed, and pg-connection-string replaces the whole `ssl` object
 * when the URL carries any TLS setting — so `?sslmode=no-verify` or
 * `?ssl=no-verify` turns verification off while this module reports
 * "verified". These measure the socket's options, not the decision's label.
 * docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md.
 */
const require = createRequire(import.meta.url);
const ConnectionParameters = require("pg/lib/connection-parameters") as new (config: object) => {
  ssl: unknown;
};

/** The `ssl` option the socket would get, given a URL and our decision for it. */
function effectiveSsl(url: string, ssl: unknown): unknown {
  return new ConnectionParameters({ connectionString: url, ssl }).ssl;
}

describe("the remote is verified or refused, never quietly unverified", () => {
  it("hands pg our CA with verification on, for a plain remote URL", () => {
    const decision = sslDecisionFor(REMOTE, { defaultCaPath: REAL_CA });
    const used = effectiveSsl(REMOTE, decision.ssl) as { rejectUnauthorized?: boolean; ca?: string };
    expect(used.rejectUnauthorized).toBe(true);
    expect(used.ca).toContain("BEGIN CERTIFICATE");
  });

  /* The paths, established against pg: each of these, left in the URL, takes
     the socket's TLS settings out of our hands. Some turn verification off
     outright (no-verify, prefer, libpq-compat require); the rest drop our CA
     and fall back to Node's public roots, which Supabase's private root is not
     in. Refused as a class rather than sorted into safe and unsafe, because the
     sorting is pg-connection-string's to change between versions. */
  it.each([
    ["sslmode=no-verify"],
    ["sslmode=disable"],
    ["sslmode=prefer"],
    ["sslmode=require"],
    ["uselibpqcompat=true&sslmode=require"],
    ["ssl=no-verify"],
    ["ssl=0"],
    ["ssl=true"],
    [`sslrootcert=${REAL_CA}`],
    [`sslcert=${REAL_CA}`],
    [`sslkey=${REAL_CA}`],
    ["sslnegotiation=direct"],
  ])("refuses a remote URL carrying %s", (query) => {
    const url = `${REMOTE}?${query}`;
    // The path is real: pg would not use the CA we decided on.
    const used = effectiveSsl(url, { rejectUnauthorized: true, ca: "OUR-CA" });
    expect(typeof used === "object" && (used as { ca?: string } | null)?.ca === "OUR-CA").toBe(false);
    // And it is refused, naming the setting and what to do about it.
    const key = query.split("=")[0] ?? "";
    expect(() => sslDecisionFor(url, { defaultCaPath: REAL_CA })).toThrow(
      new RegExp(`${key}[\\s\\S]*remove`, "i"),
    );
  });

  it("is not fooled by a percent-encoded key or the other scheme", () => {
    // URLSearchParams decodes key names, and so does pg-connection-string, so
    // `%73slmode` is `sslmode` to both. GPT Sol, plan review.
    expect(() => sslDecisionFor(`${REMOTE}?%73slmode=no-verify`, { defaultCaPath: REAL_CA })).toThrow(
      /sslmode/,
    );
    const otherScheme = REMOTE.replace(/^postgresql:/, "postgres:");
    expect(sslDecisionFor(otherScheme, { defaultCaPath: REAL_CA }).mode).toBe("verified");
    expect(() => sslDecisionFor(`${otherScheme}?ssl=no-verify`, { defaultCaPath: REAL_CA })).toThrow(/ssl/);
  });

  /* The refusal only guards connections that ask it. A Pool or Client built
     without an `ssl` option takes pg's defaults instead — PGSSLMODE and the
     URL's own TLS keys — so every constructor in the shipped code and scripts
     must pass one. Three did not, found by GPT Sol in plan review. */
  it("is asked by every pg connection in src/ and scripts/", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files = execFileSync("git", ["ls-files", "src", "scripts"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx|js|mjs)$/.test(f));
    const unguarded: string[] = [];
    let seen = 0;
    for (const file of files) {
      const text = readFileSync(path.join(root, file), "utf8");
      for (const m of text.matchAll(/new (?:pg\.)?(?:Pool|Client)\(/g)) {
        seen += 1;
        // The constructor's argument, to its closing parenthesis at depth 0.
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < text.length; end++) {
          if (text[end] === "(") depth++;
          else if (text[end] === ")" && --depth === 0) break;
        }
        const args = text.slice(m.index, end);
        // feedback-reporter.ts hands over a config whose `ssl` it sets last, from the decision.
        if (/\bssl\s*:/.test(args) || /connection\.config/.test(args)) continue;
        unguarded.push(`${file}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(seen).toBeGreaterThan(10); // positive control: the scan finds constructors at all
    expect(unguarded).toEqual([]);
  });

  it("refuses the remote when there is no certificate, rather than encrypting unverified", () => {
    expect(() => sslDecisionFor(REMOTE, { defaultCaPath: MISSING })).toThrow(
      /refusing[\s\S]*supabase-ca\.crt/i,
    );
  });

  it("leaves local alone, TLS settings in the URL included", () => {
    // Local development stays exactly as it was: the container has no
    // certificate, and what a local URL says about TLS is its own business.
    expect(sslDecisionFor(LOCAL, { defaultCaPath: MISSING }).mode).toBe("disabled");
    expect(sslDecisionFor(`${LOCAL}?sslmode=disable`, { defaultCaPath: MISSING }).mode).toBe("disabled");
  });
});
