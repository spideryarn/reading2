/**
 * The judgements `scripts/deploy.ts` makes, separated from the doing of things
 * so they can be tested against the broken state rather than only the working
 * one.
 *
 * That separation is the point rather than tidiness. Every function here
 * answers "is this wrong?", and a function that answers that question can only
 * be trusted if it has been *seen* to say yes — which needs a fixture, which
 * needs the judgement to be reachable without a deployment.
 * docs/reusable/silent-success.md, and tests/deploy-checks.test.ts.
 *
 * See docs/plans/deploy-pipeline.md for what each of these is guarding.
 */

import { sameCommit } from "./build-stamp.js";

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/** One row of `drizzle/meta/_journal.json`. */
export interface JournalEntry {
  idx: number;
  tag: string;
  /** Milliseconds. Drizzle compares this against the ledger's `created_at`. */
  when: number;
}

export interface MigrationState {
  /** Migrations in the journal that the database has not applied, in order. */
  pending: JournalEntry[];
  /**
   * The database has applied more than the journal knows about.
   *
   * Normal on a laptop — an agent generates `0018`, applies it, and has not
   * committed it yet — and **never** normal on the remote. Reported separately
   * from `pending` because the two are opposite problems and the arithmetic
   * that finds one would quietly report the other as zero.
   */
  ahead: number;
}

/**
 * What is pending, decided the same way drizzle decides it.
 *
 * **By timestamp, not by count and not by tag.** `migrate()` finds the most
 * recent row in `__drizzle_migrations` and applies every journal entry whose
 * `when` is greater than that row's `created_at`. Comparing counts instead
 * would agree with it almost always and disagree exactly when two agents
 * generated migrations in parallel — which is this repo's normal Tuesday.
 *
 * `lastAppliedMillis` is `null` for a database with no ledger at all, where
 * everything is pending.
 */
export function migrationState(
  journal: readonly JournalEntry[],
  lastAppliedMillis: number | null,
  appliedCount: number,
): MigrationState {
  const pending = journal
    .filter((e) => lastAppliedMillis === null || e.when > lastAppliedMillis)
    .slice()
    .sort((a, b) => a.when - b.when);
  return { pending, ahead: Math.max(0, appliedCount - (journal.length - pending.length)) };
}

/** One row of `spideryarn_migrations.__drizzle_migrations`. */
export interface LedgerRow {
  /** sha256 of the whole `.sql` file, which is how drizzle computes it. */
  hash: string;
  /** The journal entry's `when`, stored as `created_at`. */
  created_at: number;
}

/**
 * Is what the database has applied the beginning of what this commit contains?
 *
 * **The count moving by the right amount is not enough**, and this is the check
 * that says why. `migrate()` looks at the **single most recent** `created_at`
 * and applies every journal entry newer than it — it never compares the hashes
 * it has stored against the files in front of it. So a database that applied a
 * *different* `0016` (a migration that was edited after being applied, or a
 * history from another branch) is indistinguishable from a healthy one by
 * counting, and drizzle will happily carry on appending to it.
 *
 * Since the hash is `sha256` of the file's whole contents, an edited migration
 * changes it. Comparing the applied rows against the committed files is
 * therefore cheap and catches the whole class.
 *
 * `hashes` maps a journal tag to the sha256 of its `.sql` file **at the commit
 * being deployed** — not at whatever is on disk, which several agents are
 * editing.
 */
export function ledgerDivergence(
  journal: readonly JournalEntry[],
  hashes: ReadonlyMap<string, string>,
  rows: readonly LedgerRow[],
): string[] {
  const applied = [...rows].sort((a, b) => Number(a.created_at) - Number(b.created_at));
  const expected = [...journal].sort((a, b) => a.when - b.when);
  const problems: string[] = [];

  for (const [i, row] of applied.entries()) {
    const entry = expected[i];
    if (!entry) {
      problems.push(
        `the database has applied ${applied.length - i} migration(s) beyond the ${expected.length} this commit contains`,
      );
      break;
    }
    if (Number(row.created_at) !== entry.when) {
      problems.push(
        `applied migration #${i + 1} is stamped ${row.created_at}, but this commit's ${entry.tag} is stamped ${entry.when}`,
      );
      break;
    }
    const want = hashes.get(entry.tag);
    if (want && row.hash !== want) {
      problems.push(
        `${entry.tag} was applied from different SQL than this commit contains — ` +
          "a migration file was edited after it ran, and drizzle will never notice",
      );
      break;
    }
  }

  return problems;
}

/**
 * Statements worth naming before they run.
 *
 * Not a gate — Greg's call, 2026-08-27, and the plan says why. But two of these
 * cannot work here at all rather than merely deserving thought, so a line that
 * names them turns a baffling error into an obvious one:
 *
 *  - drizzle 0.45.2 wraps **every pending migration in one transaction** (read
 *    from the installed source, not from the docs), so `CREATE INDEX
 *    CONCURRENTLY` fails with "cannot run inside a transaction block", and
 *    `ALTER TYPE … ADD VALUE` cannot be used in the same run that adds it.
 *  - the destructive ones are safe only if no currently-live code touches what
 *    they change. Vercel keeps the old function serving until the new one is
 *    promoted, so during a migration the old code meets the new schema.
 */
export interface SqlFindings {
  /** Will fail outright, because the migrator runs everything in a transaction. */
  nonTransactional: string[];
  /** May break the code that is live right now. */
  destructive: string[];
}

/**
 * Comments and string literals are removed first, so that a migration whose
 * *comment* explains why it is not dropping a column does not get reported as
 * dropping one. A scanner that cannot tell code from prose cries wolf, and a
 * report that cries wolf is skimmed, which is how the next real line gets
 * skimmed too.
 */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, " ");
}

const NON_TRANSACTIONAL: [RegExp, string][] = [
  [/\bcreate\s+(unique\s+)?index\s+concurrently\b/i, "CREATE INDEX CONCURRENTLY"],
  [/\bdrop\s+index\s+concurrently\b/i, "DROP INDEX CONCURRENTLY"],
  [/\balter\s+type\b[\s\S]{0,120}?\badd\s+value\b/i, "ALTER TYPE … ADD VALUE"],
  [/\bvacuum\b/i, "VACUUM"],
  [/\bcreate\s+database\b/i, "CREATE DATABASE"],
];

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bdrop\s+table\b/i, "DROP TABLE"],
  [/\bdrop\s+column\b/i, "DROP COLUMN"],
  [/\bdrop\s+schema\b/i, "DROP SCHEMA"],
  [/\brename\s+(column|to)\b/i, "RENAME"],
  [/\bset\s+not\s+null\b/i, "SET NOT NULL"],
  [/\balter\s+column\b[\s\S]{0,80}?\b(type|using)\b/i, "ALTER COLUMN … TYPE"],
  [/\btruncate\b/i, "TRUNCATE"],
];

export function scanSql(sql: string): SqlFindings {
  const clean = stripSqlNoise(sql);
  const find = (table: [RegExp, string][]) =>
    table.filter(([re]) => re.test(clean)).map(([, label]) => label);
  return { nonTransactional: find(NON_TRANSACTIONAL), destructive: find(DESTRUCTIVE) };
}

/**
 * The connection string migrations run over, built from the one in `.env.prod`.
 *
 * **`.env.prod`'s `DATABASE_URL` is the wrong credential for this**, and it is
 * wrong in a way that looks like a broken connection rather than a wrong one:
 * it is `spideryarn_app` on the **transaction** pooler, port 6543, and that
 * role cannot read the migration ledger at all. Asking it gives `permission
 * denied for schema spideryarn_migrations`, which is the correct answer to the
 * wrong question. Measured 2026-08-27.
 *
 * Migrations run as `postgres` over the **session** pooler on 5432 — DDL and
 * the migrator's own bookkeeping both need a real session, and session
 * advisory locks and `SET` outside a transaction silently stop working on the
 * transaction pooler. docs/project/database.md § Connecting to the remote.
 *
 * Supavisor reads the project ref out of the part of the username after the
 * dot, so the user is `postgres.<ref>` rather than plain `postgres` — and the
 * ref is taken from the app URL rather than configured separately, because two
 * copies of one fact is how they come to disagree.
 *
 * A function rather than four lines at the call site because this is the value
 * that decides which database changes, and the one thing this repo has already
 * got wrong once (docs/reusable/silent-success.md, and the header of
 * scripts/db-migrate.ts).
 */
export function migratorUrlFrom(appUrl: string, password: string): string {
  const app = new URL(appUrl);
  const ref = app.username.includes(".") ? app.username.split(".").slice(1).join(".") : null;
  if (!ref) {
    throw new Error(
      `DATABASE_URL's user is '${app.username}', which carries no project ref. ` +
        "A Supabase pooler username looks like 'role.<project-ref>' — see docs/project/database.md.",
    );
  }
  if (!password) throw new Error("DATABASE_PASSWORD is not set in .env.prod");

  const url = new URL(appUrl);
  url.username = `postgres.${ref}`;
  url.password = password;
  url.port = "5432";
  /* Any of these in the connection string makes `pg` discard the explicit ssl
     object, so the CA gets loaded, reported as verified, and not used. GPT Sol
     found that in review; it is worth refusing here rather than inheriting it. */
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey"]) url.searchParams.delete(k);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Finding the deployment                                              */
/* ------------------------------------------------------------------ */

/** The fields of Vercel's deployment object this script actually reads. */
export interface VercelDeployment {
  uid: string;
  url: string;
  target?: string | null;
  state?: string;
  readyState?: string;
  readySubstate?: string | null;
  meta?: { githubCommitSha?: string } | null;
}

export type DeploymentVerdict =
  | { kind: "absent" }
  | { kind: "building"; deployment: VercelDeployment }
  | { kind: "failed"; deployment: VercelDeployment; state: string }
  | { kind: "built-not-live"; deployment: VercelDeployment }
  | { kind: "live"; deployment: VercelDeployment };

/**
 * Which of these deployments is the one we asked for, and where has it got to?
 *
 * **`READY` is not the question.** `READY` means the build succeeded; a build
 * can succeed and sit there aliased to nothing. `readySubstate: "PROMOTED"` is
 * what says it is serving production traffic, and a check that stopped at
 * `READY` would be checking that a build worked — which nobody asked.
 *
 * Preview deployments are filtered out even when they carry the same sha,
 * because a branch build of the same commit is a different deployment and
 * passing its URL to the smoke tests would test the wrong thing.
 */
export function judgeDeployments(
  deployments: readonly VercelDeployment[],
  sha: string,
): DeploymentVerdict {
  const mine = deployments.filter(
    (d) => d.target === "production" && sameCommit(d.meta?.githubCommitSha, sha),
  );
  const d = mine[0];
  if (!d) return { kind: "absent" };

  const state = d.readyState ?? d.state ?? "UNKNOWN";
  if (state === "ERROR" || state === "CANCELED") return { kind: "failed", deployment: d, state };
  if (state !== "READY") return { kind: "building", deployment: d };
  if (d.readySubstate === "PROMOTED") return { kind: "live", deployment: d };
  return { kind: "built-not-live", deployment: d };
}

/* ------------------------------------------------------------------ */
/* Judging what the live site says                                     */
/* ------------------------------------------------------------------ */

export interface HealthBody {
  ok?: boolean;
  warnings?: string[];
  store?: { name?: string; articles?: number } | { error?: string };
  ssl?: { mode?: string; why?: string } | { error?: string };
  build?: {
    commit?: string | null;
    builtAt?: string | null;
    source?: string | null;
    deploymentId?: string | null;
  } | null;
  commit?: string | null;
  sawUrl?: string | null;
  region?: string | null;
}

/** What we believe we just deployed. Every field is optional to assert. */
export interface Expected {
  commit: string | null;
  /** The unique id of the deployment we watched go live. Stronger than the commit. */
  deploymentId?: string | null;
  /** `lhr1` — the function should be running next to the database. */
  region?: string | null;
  /** The path we asked for, echoed back, to prove routing did not rewrite it. */
  path?: string;
}

/**
 * Every way `/api/health` can be wrong, listed rather than reduced to a
 * boolean, because "the deployment is unhealthy" sends you nowhere and "the
 * store is `files`" sends you to one environment variable.
 *
 * `expectedCommit` is the sha we pushed. Asserting it is what turns this from
 * "something is answering and it is well" into "**the thing I just built** is
 * answering". Without it every check on this page passes over a deployment
 * three commits old.
 */
export function judgeHealth(body: HealthBody, expected: Expected): string[] {
  const problems: string[] = [];
  const expectedCommit = expected.commit;

  if (body.ok !== true) problems.push("health says ok:false");
  for (const w of body.warnings ?? []) problems.push(`health warning: ${w}`);

  const store = body.store as { name?: string; articles?: number; error?: string } | undefined;
  if (!store) problems.push("health reported no store at all");
  else if (store.error) problems.push(`store error: ${store.error}`);
  else if (store.name !== "postgres")
    problems.push(`store is '${store.name}', not postgres — reads come off a disk this host has none of`);

  const ssl = body.ssl as { mode?: string; why?: string; error?: string } | undefined;
  if (!ssl) problems.push("health reported nothing about TLS");
  else if (ssl.error) problems.push(`TLS error: ${ssl.error}`);
  else if (ssl.mode !== "verified")
    problems.push(`TLS mode is '${ssl.mode}' — encrypted, but not checking who it is talking to`);

  if (expectedCommit) {
    const got = body.build?.commit ?? null;
    if (!got) {
      problems.push(
        "the function carries no build stamp — it was built before scripts/build-stamp.ts existed, or by something that could not identify the commit",
      );
    } else if (!sameCommit(got, expectedCommit)) {
      problems.push(`the function was built from ${got}, not ${expectedCommit}`);
    }
  }

  /**
   * **The stronger half of the same question.** A commit can be deployed twice
   * — a redeploy, a retried build — and the commit check passes over the wrong
   * one of the two. The deployment id is unique to one build.
   *
   * Asserted only when the function actually carries one, because a function
   * built before this field existed reports `null`, and failing every
   * deployment until the first one that carries it would make the check
   * un-landable. Once it is there it is the tighter of the two.
   */
  if (expected.deploymentId && body.build?.deploymentId) {
    if (body.build.deploymentId !== expected.deploymentId) {
      problems.push(
        `the function answering was built for ${body.build.deploymentId}, not ${expected.deploymentId} — ` +
          "an older deployment of the same commit is serving, or this response came out of a cache",
      );
    }
  }

  /* Did the path survive Vercel's routing? Every route in src/routes.ts is
     matched against `req.url`, so a platform rewrite 404s all of them at once
     and the cause appears in no log we write. */
  if (expected.path && body.sawUrl !== expected.path) {
    problems.push(`the function saw '${body.sawUrl}' rather than '${expected.path}' — routing rewrote the path`);
  }

  /* The edge answers from wherever you are; the function should be running in
     London, next to the database. A function in the wrong region works and is
     slow in a way nothing else here would report. */
  if (expected.region && body.region && body.region !== expected.region) {
    problems.push(`running in ${body.region}, not ${expected.region} — every query now crosses an ocean`);
  }

  return problems;
}

/**
 * Does the *client bundle* come from the same commit as the function?
 *
 * The failure this exists for is a working page in front of a moved API: every
 * other check passes, the site loads, and the first request the reader makes
 * goes somewhere the bundle does not expect.
 */
export function judgeClientBuild(
  clientBuild: { commit?: string | null; deploymentId?: string | null } | null,
  expected: Expected,
): string[] {
  if (!clientBuild) return ["/build.json is missing — the client bundle carries no stamp"];
  const problems: string[] = [];
  if (expected.commit && !sameCommit(clientBuild.commit, expected.commit))
    problems.push(`the client bundle was built from ${clientBuild.commit ?? "nothing"}, not ${expected.commit}`);
  /* Same reasoning as the function's: unique per build, so it catches the
     redeploy and the cached copy that the commit cannot. */
  if (expected.deploymentId && clientBuild.deploymentId && clientBuild.deploymentId !== expected.deploymentId)
    problems.push(
      `the page being served was built for ${clientBuild.deploymentId}, not ${expected.deploymentId} — ` +
        "an edge cache is probably still holding the old one",
    );
  return problems;
}

/* ------------------------------------------------------------------ */
/* Logs                                                                */
/* ------------------------------------------------------------------ */

/**
 * One line as `vercel logs --json` emits it.
 *
 * **The status field is `responseStatusCode`.** The first version of this read
 * `statusCode`, which is not a key the CLI emits — so the "a 5xx is loud"
 * reading matched nothing, ever, and the summary printed every request's status
 * as `—`. It went green over a deployment because it had nothing to be red
 * about. Found by reading the keys of a real line rather than by reasoning about
 * them, which is the only way this kind of mistake is ever found:
 * docs/reusable/silent-success.md.
 *
 * `statusCode` is kept as a fallback rather than deleted, because a CLI that
 * renames a field is exactly the event this pin exists to survive, and reading
 * both costs nothing.
 */
export interface LogLine {
  deploymentId?: string;
  /** Vercel's own classification, which is **not** our pino level — see below. */
  level?: string;
  message?: string;
  responseStatusCode?: number;
  /** Not emitted by vercel@59; read anyway, in case it comes back. */
  statusCode?: number;
  requestPath?: string;
  requestMethod?: string;
}

export interface LogVerdict {
  /** Lines that are genuinely bad: a 5xx, or an error our own logger wrote. */
  loud: LogLine[];
  /** Counts by HTTP status, for the one-line summary. */
  byStatus: Map<string, number>;
}

/**
 * What actually went wrong, read three ways rather than one.
 *
 * **Vercel's `level` is not our level, and reading only it misses every error
 * this application writes.** `src/log.ts` uses `pino.destination({ sync: true })`,
 * which is **stdout** — for `log.error` as much as for `log.info`. Vercel
 * classifies a runtime log line by the stream it arrived on, so our errors are
 * classified `info`, and a filter on Vercel's level would report a clean deploy
 * over a function throwing on every request. Confirmed by measurement: a pino
 * `"level":"warn"` line came back wearing Vercel's info marker.
 *
 * So: Vercel's level, the HTTP status, and the pino level *inside* the message.
 */
export function judgeLogs(lines: readonly LogLine[]): LogVerdict {
  const byStatus = new Map<string, number>();
  const loud: LogLine[] = [];

  for (const line of lines) {
    const status = line.responseStatusCode ?? line.statusCode;
    byStatus.set(String(status ?? "—"), (byStatus.get(String(status ?? "—")) ?? 0) + 1);

    const vercelSaysBad = line.level === "error" || line.level === "fatal";
    const serverError = typeof status === "number" && status >= 500;

    let pinoSaysBad = false;
    const message = line.message ?? "";
    if (message.trimStart().startsWith("{")) {
      try {
        const inner = JSON.parse(message) as { level?: string };
        pinoSaysBad = inner.level === "error" || inner.level === "fatal";
      } catch {
        /* Not JSON is not a finding; plenty of lines are plain text. */
      }
    }

    if (vercelSaysBad || serverError || pinoSaysBad) loud.push(line);
  }

  return { loud, byStatus };
}

/* ------------------------------------------------------------------ */
/* The bundle                                                          */
/* ------------------------------------------------------------------ */

/**
 * A secret key, **with key material after the prefix**.
 *
 * `text.includes("sb_secret_")` is the obvious version and it is wrong, and
 * this repo has now learned that twice. `tests/no-secrets-in-bundle.test.ts`
 * learned it against a local `dist/`; the first version of *this* function
 * learned it against **production**, on 2026-08-27, reporting a secret key in
 * the live bundle within a minute of being pointed at it. The match was
 * supabase-js's own
 *
 *     key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")
 *
 * — the library checking a prefix, carrying no key at all. So the twenty-odd
 * characters that make it an actual credential are required. A detector that
 * cries wolf on every build is a detector that gets deleted, and one that cried
 * wolf about a *security* finding is worse than that: the second time it fires
 * nobody looks.
 *
 * Exported and shared rather than copied, because there were two copies of this
 * rule and one of them had the bug the other one had already fixed and written
 * up. tests/no-secrets-in-bundle.test.ts imports it.
 */
const SECRET_KEY = /sb_secret_[A-Za-z0-9_-]{16,}/;

/**
 * Anything in what was served that grants more than the publishable key does.
 *
 * The JWT half matters as much as the prefix half: a legacy service-role key
 * does not contain the string `service_role` anywhere you can grep — it is
 * inside the base64 payload — so anything JWT-shaped is decoded rather than
 * searched. Scanning for the literal passes over the exact key it is hunting.
 */
export function findSecretsInBundle(js: string): string[] {
  const found: string[] = [];
  if (SECRET_KEY.test(js)) found.push("an sb_secret_… key");

  const jwts = js.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? [];
  for (const token of new Set(jwts)) {
    const payload = token.split(".")[1];
    if (!payload) continue;
    try {
      const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      if (json.includes("service_role")) found.push("a JWT whose payload claims service_role");
    } catch {
      /* Not decodable is not a finding. Plenty of base64-ish strings are not JWTs. */
    }
  }
  return found;
}

/** The `/assets/*.js` files an `index.html` asks the browser to load. */
export function assetUrlsIn(html: string): string[] {
  return [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+\.js/g) ?? [])];
}

/* ------------------------------------------------------------------ */
/* Responses                                                           */
/* ------------------------------------------------------------------ */

/**
 * A redirect is never a pass, and this is the specific way a smoke test lies.
 *
 * A protected `*.vercel.app` URL answers 302 to a Vercel login page, and `curl
 * -L` then reads 200 off the login page and reports the site as up. The check
 * that vouched for this project's auth gate had this shape; see
 * docs/project/deployment.md § Who can reach it.
 */
export function describeRedirect(status: number, location: string | null): string | null {
  if (status < 300 || status >= 400) return null;
  const where = location ?? "somewhere unnamed";
  if (/vercel\.com\/sso-api|\/sso-api\?/.test(where))
    return `redirected to Vercel's login (${status}) — this URL is behind deployment protection, so nothing here was tested`;
  return `redirected (${status}) to ${where} — a redirect is not a passing check`;
}

/* ------------------------------------------------------------------ */
/* What to tell the human when it goes wrong                           */
/* ------------------------------------------------------------------ */

/**
 * The rollback instructions, including the part everybody forgets.
 *
 * **After a rollback Vercel turns off auto-assignment of production domains**,
 * so the next push to `main` builds and does not go live, and nothing says so.
 * Printing the second command beside the first is the whole point of this
 * function existing rather than a template string at the call site.
 */
export function rollbackAdvice(previous: string | null, scope: string): string[] {
  if (!previous) {
    return [
      "No previous production deployment was found to roll back to.",
      `Look at what there is:  vercel list --scope ${scope}`,
    ];
  }
  return [
    `Roll back:   vercel rollback ${previous} --scope ${scope} --yes`,
    "",
    "Then read this before your next deploy: a rollback turns OFF auto-assignment of",
    "production domains. The next push to main will build and will NOT go live, and",
    "nothing will tell you. Turn it back on by promoting the deployment you want:",
    `             vercel promote <deployment-url> --scope ${scope} --yes`,
  ];
}
