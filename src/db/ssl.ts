/**
 * Whether a Postgres connection uses TLS, and whether it *verifies* the server.
 *
 * This began as a function inside scripts/db-migrate.ts. It moved here the
 * moment the runtime needed to connect too, for the reason src/source-hash.ts
 * gives about `hashBlocks`: two callers computing "the same" answer two ways
 * can only ever disagree, and the disagreement here would be that migrations
 * verify the server and the app does not — which nothing would report.
 *
 * The decision is returned as a value rather than applied, so the caller
 * chooses how to complain. A CLI can print a warning and carry on; a server
 * ought to be louder. Making that a `SslDecision` also makes it testable
 * without a database — tests/db-ssl.test.ts.
 *
 * See docs/project/database.md § Connecting to the remote.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseConnectionString } from "pg-connection-string";

/**
 * Supabase's CA certificate, downloaded from the dashboard
 * (Settings → Database → SSL Configuration) and committed. Deliberately NOT
 * under `supabase/`, which `supabase init --force` rewrites — see
 * docs/project/supabase-local.md. certs/README.md says why committing a
 * certificate is right here.
 */
const DEFAULT_CA_PATH = path.resolve(import.meta.dirname, "../../certs/supabase-ca.crt");

/**
 * What `pg` wants in its `ssl` option, in the two shapes we ever produce.
 *
 * There used to be a third, `encrypted-unverified` — encrypted, but any
 * certificate accepted — returned against the remote when the CA file was
 * missing. It defeats machine-in-the-middle protection **while looking exactly
 * like a secure connection**, and the runtime only logged a warning. Since
 * 2026-10-01 the remote is verified or refused, so the shape is gone and the
 * compiler holds every caller to that —
 * docs/plans/261001j-refuse-unverified-tls-to-the-remote-database.md.
 */
export type SslDecision =
  | {
      /** Local container: no certificate exists, so requiring TLS fails. */
      readonly mode: "disabled";
      readonly ssl: false;
      readonly why: string;
    }
  | {
      /** Encrypted *and* we know who we are talking to. The only remote answer. */
      readonly mode: "verified";
      readonly ssl: { readonly rejectUnauthorized: true; readonly ca: string };
      readonly why: string;
    };

/**
 * Query-string keys that take TLS out of `sslDecisionFor`'s hands.
 *
 * `pg` merges the parsed connection string **over** the config it is given,
 * and `pg-connection-string` builds a fresh `ssl` object whenever the URL
 * carries `sslmode`, `sslrootcert`, `sslcert` or `sslkey` (`ssl=` and
 * `sslnegotiation=` set it too). So the CA decided here is dropped while the
 * decision still says "verified" — and `?sslmode=no-verify` or
 * `?ssl=no-verify` turns verification off outright. `uselibpqcompat` changes
 * what the others mean. Measured against the installed pg, not argued:
 * tests/db-ssl.test.ts.
 *
 * Refused as a class rather than sorted into safe and unsafe, because which of
 * them is safe is pg-connection-string's to change between versions. The list
 * is complete for 2.14.0; a spelling a later version adds is caught by asking
 * that parser directly, in `sslDecisionFor`.
 */
export const TLS_URL_KEYS = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslnegotiation",
  "uselibpqcompat",
] as const;

/**
 * Is this URL pointing at the Docker stack on this laptop?
 *
 * Used for two separate decisions — whether to use TLS, and whether a
 * destructive command is allowed to run — and they are keyed off the same test
 * on purpose, so "local" cannot mean one thing to the migrator and another to
 * the guard in front of it.
 *
 * Deliberately strict: only the two loopback spellings count. A hostname that
 * resolves to a loopback address is not local for this purpose, because the
 * question being asked is "is this the throwaway container", not "where do the
 * packets go".
 */
export function isLocalDatabaseUrl(url: string): boolean {
  /* Parse it, do not pattern-match it. The first version was
     `/@(127\.0\.0\.1|localhost)[:/]/` and it read the wrong `@`: userinfo runs
     to the LAST one, so `postgres://user:p@localhost:5432@remote.example.com/db`
     has its host at remote.example.com and a loopback address sitting in the
     password. The regex found that one and called the remote database local,
     which turns TLS off AND lets db-migrate past its guard. GPT Sol found it in
     review, 2026-08-26. An unescaped `@` in a password is an ordinary mistake,
     not a contrived one.

     Fail closed on anything that will not parse: "I cannot tell what this is"
     must never come out as "yes, it is the throwaway container". */
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  /* A connection string can name one host in its authority and connect to
     another. `pg` parses with `pg-connection-string`, which honours libpq's
     `host` and `hostaddr` keywords as QUERY PARAMETERS and lets them override
     the authority — so

         postgres://u:p@127.0.0.1:54362/db?host=remote.example.com

     parses to { host: "remote.example.com" } while `new URL(...).hostname`
     says 127.0.0.1. Reading only the hostname made this function answer "yes,
     the throwaway container" about a remote database, which let it past
     db-migrate's guard AND turned TLS off for the trip. Verified against the
     installed pg-connection-string, not argued about. GPT Sol, 2026-08-31.

     Refused rather than resolved: we could read the override and test THAT,
     but then two spellings of the host would both have to stay right forever.
     Nothing we run needs a host override, so a URL carrying one is not
     answering the question this function asks, and fails closed like anything
     else it cannot read. */
  if (parsed.searchParams.has("host") || parsed.searchParams.has("hostaddr")) return false;

  const host = parsed.hostname;
  return host === "127.0.0.1" || host === "localhost";
}

/**
 * A connection string with the password removed, or nothing at all.
 *
 * **Parsed, not pattern-matched, and it took two goes.** The first version lived
 * in scripts/db-migrate.ts as
 * `url.replace(/:\/\/([^:@\/]*)(:[^@]*)?@/, "://$1@")`, which stops at the first
 * literal `@` — and `pg` accepts one inside a password. Given
 * `postgres://u:p@ss@host/db` it printed `postgres://u@ss@host/db`, putting half
 * the password on the terminal of a line whose entire job is to be safe to read
 * out. It also ignored `?password=` in the query string, which `pg` also
 * accepts. Both found by GPT Sol's review, 2026-08-27, and both verified against
 * `pg-connection-string` rather than argued about.
 *
 * WHATWG `URL` splits on the **last** `@` in the authority, which is the same
 * rule `pg` follows and the same rule {@link isLocalDatabaseUrl} above relies
 * on, so it gets `p@ss` right where a regex cannot.
 *
 * **Fails closed.** An unparsable URL returns `undefined` and the caller prints
 * a placeholder rather than the string. A redactor that falls back to showing
 * the original is not a redactor.
 *
 * Lives here, beside the other function that has to parse a connection string
 * correctly, so that the migrator and the schema check cannot disagree about
 * what is safe to print.
 */
export function withoutPassword(connection: string): string | undefined {
  try {
    const parsed = new URL(connection);
    parsed.password = "";
    /* `pg` reads the password from the query string too, so stripping only the
       userinfo half leaves it in plain sight. */
    parsed.searchParams.delete("password");
    return parsed.toString();
  } catch {
    return undefined;
  }
}

/**
 * Injection points, and they exist for one reason: the **refusal** for a
 * missing certificate can only be reached when the committed certificate is
 * absent. A test cannot delete a committed file, so without these the one
 * branch worth guarding is the one branch nothing covers.
 *
 * Production passes neither.
 */
export interface SslOptions {
  /** Stands in for `PGSSLROOTCERT`. */
  readonly configuredCaPath?: string;
  /** Stands in for the committed `certs/supabase-ca.crt`. */
  readonly defaultCaPath?: string;
}

/**
 * `pg` does **not** use TLS by default, and the remote project has "Enforce SSL
 * on incoming connections" turned on — so a plain connection there is refused
 * with an error that reads like a credentials problem. Hence this is keyed off
 * `isLocalDatabaseUrl` rather than off a flag someone has to remember.
 *
 * **Against the remote it verifies or it throws** — Greg approved that on
 * 2026-10-01, "as long as the cure isn't worse than the disease". Three
 * refusals, each saying what to do: the URL carries a key from
 * {@link TLS_URL_KEYS}; `PGSSLROOTCERT` names a file that is not there; there
 * is no certificate at all. An encrypted-but-unverified connection is the one
 * outcome nobody would notice, so it is never returned. Local is untouched.
 */
export function sslDecisionFor(url: string, options: SslOptions = {}): SslDecision {
  if (isLocalDatabaseUrl(url)) {
    return {
      mode: "disabled",
      ssl: false,
      why: "local Postgres is a container with no certificate",
    };
  }

  /* `isLocalDatabaseUrl` has already said no to anything unparsable, so a
     throw here would be a URL that parsed a moment ago; fail closed anyway. */
  let query: URLSearchParams;
  try {
    query = new URL(url).searchParams;
  } catch {
    throw new Error("Refusing to connect: DATABASE_URL does not parse as a URL, so its TLS settings cannot be read.");
  }
  const overrides = TLS_URL_KEYS.filter((key) => query.has(key));
  if (overrides.length > 0) {
    throw new Error(
      `Refusing to connect to the remote database: DATABASE_URL carries ${overrides.join(", ")}, ` +
        "which pg lets override the verified TLS settings — and some values turn certificate " +
        `checking off while looking secure. Remove ${overrides.length === 1 ? "it" : "them"} from the URL; ` +
        "certs/supabase-ca.crt is what verifies the server. See docs/project/database.md.",
    );
  }

  /* The list above is complete for pg-connection-string 2.14.0, and only for
     that. So ask the parser `pg` itself uses as well: if it produces an `ssl`
     value from this URL, that value would replace ours, whatever the key was
     called. Second, because the list gives the better message, and because
     parsing a URL that names a certificate file reads the file. */
  let parsedSsl: unknown;
  try {
    parsedSsl = parseConnectionString(url).ssl;
  } catch {
    throw new Error("Refusing to connect: pg cannot parse DATABASE_URL, so its TLS settings cannot be read.");
  }
  if (parsedSsl !== undefined) {
    throw new Error(
      "Refusing to connect to the remote database: DATABASE_URL carries a setting that pg turns into " +
        "TLS options, which would override the verified ones. Remove it from the URL's query string; " +
        "certs/supabase-ca.crt is what verifies the server. See docs/project/database.md.",
    );
  }

  const configured = options.configuredCaPath ?? process.env.PGSSLROOTCERT;
  const caPath = configured ?? options.defaultCaPath ?? DEFAULT_CA_PATH;

  if (existsSync(caPath)) {
    return {
      mode: "verified",
      ssl: { rejectUnauthorized: true, ca: readFileSync(caPath, "utf8") },
      why: `verified against ${caPath}`,
    };
  }

  if (configured) {
    throw new Error(`PGSSLROOTCERT is set but there is no file at ${caPath}`);
  }

  throw new Error(
    `Refusing to connect to the remote database without verifying it: there is no CA certificate at ${caPath}. ` +
      "It is committed as certs/supabase-ca.crt — restore it from git, or download it from the Supabase " +
      "dashboard (Settings → Database → SSL Configuration), or point PGSSLROOTCERT at a copy. " +
      "On Vercel, vercel.json's includeFiles must ship certs/**. See certs/README.md.",
  );
}
