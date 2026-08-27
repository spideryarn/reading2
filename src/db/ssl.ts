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

/**
 * Supabase's CA certificate, downloaded from the dashboard
 * (Settings → Database → SSL Configuration) and committed. Deliberately NOT
 * under `supabase/`, which `supabase init --force` rewrites — see
 * docs/project/supabase-local.md. certs/README.md says why committing a
 * certificate is right here.
 */
const DEFAULT_CA_PATH = path.resolve(import.meta.dirname, "../../certs/supabase-ca.crt");

/** What `pg` wants in its `ssl` option, in the three shapes we ever produce. */
export type SslDecision =
  | {
      /** Local container: no certificate exists, so requiring TLS fails. */
      readonly mode: "disabled";
      readonly ssl: false;
      readonly why: string;
    }
  | {
      /** Encrypted *and* we know who we are talking to. The goal. */
      readonly mode: "verified";
      readonly ssl: { readonly rejectUnauthorized: true; readonly ca: string };
      readonly why: string;
    }
  | {
      /**
       * Encrypted, but any certificate is accepted. Defeats machine-in-the-
       * middle protection **while looking exactly like a secure connection**,
       * which is why this is a distinct mode rather than a flag — a caller has
       * to handle the case by name to end up here.
       */
      readonly mode: "encrypted-unverified";
      readonly ssl: { readonly rejectUnauthorized: false };
      readonly why: string;
    };

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
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
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
 * Injection points, and they exist for one reason: the **unverified** branch is
 * the dangerous one, and it can only be reached when the committed certificate
 * is absent. A test cannot delete a committed file, so without these the one
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
 * Throws when `PGSSLROOTCERT` names a file that is not there: an explicitly
 * configured certificate that silently degrades to unverified is the worst of
 * both worlds — you asked for verification and got a warning you will not read.
 */
export function sslDecisionFor(url: string, options: SslOptions = {}): SslDecision {
  if (isLocalDatabaseUrl(url)) {
    return {
      mode: "disabled",
      ssl: false,
      why: "local Postgres is a container with no certificate",
    };
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

  return {
    mode: "encrypted-unverified",
    ssl: { rejectUnauthorized: false },
    why:
      `no CA certificate at ${DEFAULT_CA_PATH} — the connection is encrypted ` +
      "but the server is not verified. Download it from the Supabase dashboard " +
      "(Settings → Database → SSL Configuration).",
  };
}
