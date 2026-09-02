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
 * See docs/plans/260827v-deploy-pipeline.md for what each of these is guarding.
 */

import { sameCommit } from "./build-stamp.js";

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/**
 * **These moved to scripts/migration-ledger.ts on 2026-08-31** and are
 * re-exported here so this file stays the one import `scripts/deploy.ts`
 * reaches for.
 *
 * They moved because `npm run db:migrate` needed the same judgements and was
 * about to grow a third copy of them. There were already two, and the weaker
 * one was wrong: `migrationState` answers "what will drizzle apply", which is
 * not "what is missing", and a migration that has sunk below drizzle's
 * watermark is missing for ever while that function calls it "not pending".
 * `reconcileLedger` is the function that answers the other question, and
 * db-migrate refuses on it before any DDL runs. The whole rule, and why it is
 * a watermark rather than a ledger, is in the header of that file.
 */
export {
  ledgerDivergence,
  migrationState,
  type JournalEntry,
  type LedgerRow,
  type MigrationState,
} from "./migration-ledger.js";

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
/* ------------------------------------------------------------------ */
/* Which branch a deploy may start from                                */
/* ------------------------------------------------------------------ */

/**
 * The branches `npm run deploy` will accept as its source.
 *
 * **This is not the same thing as the production branch.** Vercel's production
 * branch is `main` and stays `main`; the deploy script never deploys the branch
 * you are standing on, it gates one sha and pushes *that sha* into `main`
 * (`git push origin <sha>:refs/heads/main`). So this list is only "where is it
 * legitimate to be standing when you ask for a deploy".
 *
 * **`dev` only, since the trunk flip on 2026-09-02.** Agents commit and push to
 * `dev`; `main` is written by nothing but a gated deploy. `main` was accepted
 * alongside it through the changeover, on the grounds that a deploy which
 * refuses mid-flip is a deploy nobody can ship — and dropping it now is the
 * point of the flip rather than tidying up after it.
 *
 * The reason it cannot stay is that **`main` is the one deploy path with no
 * trunk comparison.** `trunkGap` is scoped to `TRUNK_BRANCH` by design, so a
 * checkout still standing on `main` — the Mac, or a clone made before GitHub's
 * default moved — could promote main-only work and leave `dev` silently behind
 * production. The `origin/main` ancestry check in `deploy.ts` would catch the
 * *next* deploy and demand a merge, which is the divergence being discovered
 * one deploy late.
 *
 * The cost is real and it is the right way round: a checkout on `main` is now
 * refused with `on branch 'main', not dev`, which says what to do. Deploying
 * from `main` would have said nothing at all.
 *
 * A `worktree-*` branch is deliberately **not** here. Worktrees have no
 * `.env.prod`, so a deploy from one cannot work; refusing by name gives a
 * legible reason instead of a missing-credential failure halfway in.
 *
 * See docs/project/worktrees.md and docs/plans/260828r-worktrees.md § Step 0.
 */
export const DEPLOY_SOURCE_BRANCHES = ["dev"] as const;

/**
 * The trunk agents commit and push to. `main` is production, not the trunk.
 *
 * Named separately from `DEPLOY_SOURCE_BRANCHES` because the two answer
 * different questions: one is "where may you be standing", the other is "what
 * must the candidate equal". They held different values through the changeover,
 * and they hold the same one now — which is exactly when conflating them starts
 * to look harmless. Keep them apart: the day a second deploy source is added
 * back, the trunk comparison must not silently widen with it.
 */
export const TRUNK_BRANCH = "dev";

/**
 * `null` when this branch may launch a deploy, otherwise the reason it may not.
 *
 * **Detached HEAD arrives as `""`**, because the caller reads the branch with
 * `git branch --show-current`. It used to use `git rev-parse --abbrev-ref HEAD`,
 * which returns the literal `"HEAD"` when detached — refused either way, but
 * that spelling has a second behaviour worth avoiding: when a tag shares a
 * branch's short name it returns a disambiguated `heads/dev`, which would refuse
 * a legitimate branch. GPT Sol, finding 6. Both spellings are still handled here,
 * `"HEAD"` falling through to the ordinary not-in-the-list refusal.
 */
export function deployBranchProblem(branch: string): string | null {
  if (branch === "") return "HEAD is detached, so there is no branch to deploy from";
  const allowed: readonly string[] = DEPLOY_SOURCE_BRANCHES;
  if (allowed.includes(branch)) return null;
  return `on branch '${branch}', not ${DEPLOY_SOURCE_BRANCHES.join(" or ")}`;
}

/**
 * **Being on the trunk is not the same as being level with it**, and this is the
 * gap that accepting `dev` opened.
 *
 * `preflight` fetches `origin/main` and refuses a sha that is behind it. With
 * `main` as both production and trunk that check did two jobs at once. With
 * `dev` as the trunk it only does the first: it proves the candidate contains
 * current *production*, and says nothing about whether it contains current
 * *trunk*. So:
 *
 * ```text
 *   origin/main:      A
 *   stale local dev:  A-B          <- passes the origin/main check
 *   origin/dev:       A-B-C-D
 * ```
 *
 * Deploying `B` promotes code missing `C` and `D`, reports success, and nobody
 * finds out. Caught by GPT Sol reviewing this slice
 * (`docs/plans/260828r-worktrees-step0-review-sol.md`, finding 1).
 *
 * **Equality rather than ancestry**, deliberately. Ancestry in one direction
 * allows the stale deploy above; ancestry in the other allows a local commit
 * that was never pushed, which is the whole "push to `dev`, then deploy"
 * convention bypassed. The sha is captured once at preflight, so `dev` moving
 * *afterwards* does not invalidate a run already under way.
 *
 * Fails closed when the trunk cannot be read at all: an unreachable remote is
 * indistinguishable from a trunk that agrees with you, and one of those is safe
 * to assume.
 */
export function trunkGap(opts: {
  branch: string;
  sha: string;
  trunkSha: string | null;
}): string | null {
  const { branch, sha, trunkSha } = opts;
  /* Pre-flip, `main` is trunk and production at once, and the origin/main
     ancestry check above already covers it. */
  if (branch !== TRUNK_BRANCH) return null;
  if (!trunkSha) {
    return `could not read origin/${TRUNK_BRANCH} — refusing rather than assuming it agrees`;
  }
  if (sha !== trunkSha) {
    return `${sha.slice(0, 8)} is not origin/${TRUNK_BRANCH} (${trunkSha.slice(0, 8)}) — pull, or push this work to ${TRUNK_BRANCH} first`;
  }
  return null;
}

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
  /** Vercel's own row id — the stable key for de-duplicating across poll attempts. */
  id?: string;
  timestamp?: number;
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

/**
 * Did the log contain the one request we know we caused?
 *
 * **Exact path, not `includes("__deploy-smoke__")`.** The smoke path carries the
 * deployment id precisely so that the line cannot be confused with one from an
 * earlier deploy, and a substring match throws that away — it would accept a
 * smoke line from the *previous* deployment sitting in the same time window and
 * report that this deployment logged, which is the exact false pass the check
 * exists to prevent.
 *
 * The path is read from `requestPath` where Vercel supplies it, and otherwise
 * from the message body, because the two shapes have both been seen.
 */
export function sawSmokeLine(lines: readonly LogLine[], smokePath: string): boolean {
  return lines.some((l) => l.requestPath === smokePath || (l.message ?? "").includes(`"path":"${smokePath}"`));
}

/**
 * What a `vercel logs` invocation actually told us — four outcomes, not two.
 *
 * The version this replaces read only stdout and treated everything that was not
 * a parseable JSON line as absence. So a CLI that failed to authenticate, a
 * network error, and a genuinely quiet deployment all arrived as "returned
 * nothing", and the retry logic built on top of that would have patiently
 * re-run a command that was never going to work. Distinguishing them is what
 * makes a poll honest: `empty` is worth retrying, `commandFailed` is not.
 */
export type LogQuery =
  | { kind: "commandFailed"; detail: string }
  | { kind: "unparsable"; detail: string }
  | { kind: "empty" }
  | { kind: "lines"; lines: LogLine[] };

export function readLogQuery(exitCode: number, stdout: string, deploymentId: string): LogQuery {
  const rows = stdout.split("\n");
  const candidates = rows.filter((l) => l.trimStart().startsWith("{"));

  const lines: LogLine[] = [];
  let unparsed = 0;
  for (const row of candidates) {
    try {
      lines.push(JSON.parse(row) as LogLine);
    } catch {
      unparsed++;
    }
  }

  /* Exit code first: a non-zero CLI has nothing useful to say, and any lines it
     did emit before failing describe an incomplete window. */
  if (exitCode !== 0) {
    const noise = rows
      .filter((l) => l.trim() && !l.trimStart().startsWith("{"))
      .slice(-3)
      .join(" / ");
    return { kind: "commandFailed", detail: `exit ${exitCode}${noise ? `: ${noise}` : ""}` };
  }

  /* Every JSON-looking row failed to parse. Silently dropping these is how a
     changed output format becomes "the app is quiet". */
  if (candidates.length > 0 && lines.length === 0) {
    return { kind: "unparsable", detail: `${unparsed} JSON-shaped line(s) would not parse` };
  }

  const mine = lines.filter((x) => !x.deploymentId || x.deploymentId === deploymentId);
  return mine.length === 0 ? { kind: "empty" } : { kind: "lines", lines: mine };
}

/**
 * The tracked corpus the gate worktree copies `data/` and `output/` out of.
 *
 * The interim coupling to the old store layout is deliberately visible in the
 * path: underneath this directory sit a `data/` and an `output/` shaped exactly
 * like the ones the filesystem store still expects, so the gate can materialise
 * both by copying. docs/plans/260901b-committed-fixture-corpus.md.
 */
export const GATE_FIXTURE_ROOT = "tests/fixtures/data-root";

/**
 * The fixture state the gate worktree needs before the tests can mean anything.
 *
 * **What this check now asks has changed, and it is a better question.** It used
 * to look at the developer's own `data/`+`output/`, which are gitignored, so it
 * really asked *did whoever is deploying happen to have run the pipeline on this
 * laptop* — a question about a person, not about a commit. The gate therefore
 * could not pass in a fresh clone, on the remote box, or in a worktree, and
 * `--force-gate=test` became the routine way to deploy. An override that is
 * required every time is not an override.
 *
 * The corpus below is tracked, so it is present in every checkout by
 * construction and the only way this check can fail is that a commit **deleted
 * or moved committed files**. That is a real regression and worth stopping for;
 * "you have not run the pipeline yet" was not.
 *
 * `data/` and `output/` are two halves of one filesystem artefact store
 * (`src/store/artifacts-fs.ts`), and for a long time the deploy copied only the
 * first. The result was not a clear error but thirteen `ENOENT`s and two hundred
 * cascade-skips, which read like a broken commit and were nothing of the kind.
 * Both halves are named below for that reason.
 *
 * **Named sentinel files, not bare directories.** A bare `"data"` cannot fail:
 * the article-artefact migration (docs/plans/260827aa-delete-the-importer.md) deletes
 * `raw.json`, `blocks.json`, `tree.json` and the rest of an article's own files
 * from `data/<slug>/` while deliberately keeping **reader** state there —
 * `chat.json`, `comments.json`, `searches.json`, `shelf.json`,
 * `glossary-lookups.json` (tests/artefact-copy.test.ts documents the same
 * split). So `data/<slug>/` goes on existing, non-empty, exactly when the gate
 * is supposed to speak up. `"output"` has the identical shape for a different
 * reason: a slug's artefacts are individual files in a shared directory, so
 * removing one leaves the directory there.
 *
 * The files named are the ones tests actually open by path, not a superset:
 * `tests/artefact-copy.test.ts`'s `OWNED` list is the artefact store's own
 * account of what it owns for `data/writes`, and
 * `tests/store-export-raw.test.ts` / `tests/helpers/load-article.ts` read
 * `raw.json` and `raw.html` beside it. `data/constitution/labels.json` is a
 * second, deliberately-legacy fixture — `tests/store-parity.test.ts`'s
 * `LEGACY_SLUG` case, a labels file written before stage 4 stamped a
 * `sourceHash`, kept specifically because it cannot be regenerated by
 * rerunning the pipeline.
 *
 * **This list deliberately does not name the whole corpus, and should not be
 * widened to.** It answers one question — is the deploy worktree viable at all —
 * and it is short enough to go on being read. The corpus is larger, and the
 * slugs it holds beyond `writes` and `constitution` are guarded somewhere
 * better: `requireFixture` at each consumption site, where a suite asserts its
 * own fixture's preconditions before asserting behaviour. Deleting a slug then
 * fails in the suite that wanted it, naming the slug and the file, rather than
 * here as a path with no clue who cared. A sentinel list that names everything
 * becomes noise people stop reading, which is how a gate quietly dies.
 *
 * Written out in full rather than composed from `GATE_FIXTURE_ROOT`, so that a
 * grep for a fixture path finds this list.
 */
export const GATE_FIXTURES = [
  "tests/fixtures/data-root/data/writes/raw.json",
  "tests/fixtures/data-root/data/writes/raw.html",
  "tests/fixtures/data-root/data/writes/meta.json",
  "tests/fixtures/data-root/data/writes/tree.json",
  "tests/fixtures/data-root/data/writes/labels.json",
  "tests/fixtures/data-root/data/writes/blocks.json",
  "tests/fixtures/data-root/data/writes/arc.json",
  "tests/fixtures/data-root/data/writes/tweets.json",
  "tests/fixtures/data-root/data/writes/glossary.json",
  "tests/fixtures/data-root/data/writes/ideas.json",
  "tests/fixtures/data-root/data/constitution/labels.json",
  "tests/fixtures/data-root/output/writes.html",
  "tests/fixtures/data-root/output/writes.blocks.json",
] as const;

export function missingGateFixtures(exists: (relPath: string) => boolean): string[] {
  return GATE_FIXTURES.filter((rel) => !exists(rel));
}

/**
 * The checks that run *after* the deployment is live and already verified.
 *
 * None of them can mean the code failed to ship, so none of them should trigger
 * the `SCHEMA ADVANCED; CODE MAY NOT HAVE` warning or the rollback advice. That
 * exclusion used to be one inline string literal, `"errors in the log"` — and
 * the log-*read* failure is recorded under a different name, so an unreadable
 * log printed the scariest banner in the script over a deployment that had just
 * passed nine liveness checks, and offered a rollback for it.
 *
 * The bug was a list that had to agree with names written a thousand lines away.
 * It is here, tested, because the failure mode is silent: the banner is correct
 * for its own condition and simply asks the wrong question.
 */
export const AFTER_THE_FACT_CHECKS = [
  "errors in the log",
  "read this deployment's logs",
  "the log contains the request this script made",
] as const;

export function codeMayNotHaveShipped(failed: readonly string[]): boolean {
  const afterwards = new Set<string>(AFTER_THE_FACT_CHECKS);
  return failed.some((f) => !afterwards.has(f));
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

/* ------------------------------------------------------------------ */
/* Storage buckets                                                     */
/* ------------------------------------------------------------------ */

/**
 * A bucket as `supabase/config.toml` declares it.
 *
 * `fileSizeLimit` in bytes, because that is what Storage reports and the config
 * writes `"50MiB"` — the parsing belongs to whoever reads the file, not to the
 * comparison.
 */
export interface DeclaredBucket {
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: readonly string[] | null;
}

/** A bucket as `GET /storage/v1/bucket` reports it. */
export interface RunningBucket {
  id: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: readonly string[] | null;
}

/**
 * Where the declaration and the running bucket disagree.
 *
 * ## Why this exists
 *
 * **Editing `supabase/config.toml` does not change a bucket that already
 * exists** — not on the remote, and not on a laptop either. The CLI seeds a
 * *missing* bucket; nothing in this repo ever reconciles one that is there. So
 * the file and the running system are free to drift silently, and on 2026-08-27
 * they did: `text/html` was added to the `sources` allowlist, the bucket kept
 * saying `{application/pdf}`, and every HTML fetch threw a 415 for seven hours
 * with nobody looking, because a comment beside the edit said the allowlist
 * could not matter. Both halves are
 * docs/postmortems/260828a-the-config-file-is-not-the-bucket.md.
 *
 * ## Pure, for the reason everything else in this file is pure
 *
 * It takes two lists and returns sentences. That is what lets it be **seen to
 * say yes** against a fixture rather than only observed to say nothing against
 * a healthy system — which is the difference between a check and a decoration
 * (docs/reusable/silent-success.md). The bug above is precisely a check that
 * had only ever been seen to pass.
 *
 * ## What counts as a difference
 *
 * - **The bucket is missing.** The loudest one, and the only one that is not a
 *   drift: it has never been created.
 * - **`public`**, exactly. There is no benign direction for this to differ in.
 * - **`file_size_limit`**, exactly, and `null` on either side is a real value
 *   meaning *no limit* rather than *unknown*.
 * - **`allowed_mime_types` as a set**, because order is not meaningful and a
 *   reordering is not a change. `null` means *anything goes* and is reported
 *   against a declared list, since that is a bucket enforcing nothing while the
 *   file says it enforces something.
 *
 * A bucket the running system has and the file does not declare is **not**
 * reported: Supabase projects carry buckets this repo has no opinion about.
 */
export function bucketDrift(
  declared: readonly DeclaredBucket[],
  running: readonly RunningBucket[],
): string[] {
  const problems: string[] = [];
  const byId = new Map(running.map((b) => [b.id, b]));

  for (const want of declared) {
    const have = byId.get(want.name);
    if (!have) {
      problems.push(
        `bucket "${want.name}" is declared in supabase/config.toml and does not exist — ` +
          `declaring it does not create it on a project that is already running`,
      );
      continue;
    }
    if (have.public !== want.public) {
      problems.push(
        `bucket "${want.name}" is ${have.public ? "public" : "private"} and the file says ` +
          `${want.public ? "public" : "private"}`,
      );
    }
    if ((have.file_size_limit ?? null) !== want.fileSizeLimit) {
      problems.push(
        `bucket "${want.name}" allows ${have.file_size_limit ?? "any size"} and the file says ` +
          `${want.fileSizeLimit ?? "any size"}`,
      );
    }
    const drift = mimeDrift(want.allowedMimeTypes, have.allowed_mime_types);
    if (drift) problems.push(`bucket "${want.name}" ${drift}`);
  }
  return problems;
}

/** The mime halves compared as sets, or `null` when they agree. */
function mimeDrift(
  want: readonly string[] | null,
  have: readonly string[] | null,
): string | null {
  if (want === null && have === null) return null;
  if (want === null) {
    return `restricts uploads to ${[...have!].sort().join(", ")} and the file restricts nothing`;
  }
  if (have === null) {
    return `accepts any type and the file allows only ${[...want].sort().join(", ")}`;
  }
  const running = new Set(have);
  const missing = want.filter((t) => !running.has(t));
  const wanted = new Set(want);
  const extra = have.filter((t) => !wanted.has(t));
  if (!missing.length && !extra.length) return null;
  const parts: string[] = [];
  /* The missing half first, because it is the one that breaks an upload while
     the file says it should work — which is the shape this check exists for. */
  if (missing.length) parts.push(`does not accept ${missing.sort().join(", ")}`);
  if (extra.length) parts.push(`accepts ${extra.sort().join(", ")}, which the file does not allow`);
  return parts.join(", and ");
}

/**
 * The `[storage.buckets.*]` blocks of `supabase/config.toml`, parsed.
 *
 * **A hand-written parser rather than a TOML library**, and the reason is not
 * laziness: the only TOML parser in `node_modules` is `smol-toml`, which is
 * there transitively through `knip`. Importing a transitive dependency is a
 * build that breaks the day something upstream drops it, and adding a direct
 * one for four scalar keys is a dependency for a comparison.
 *
 * So it reads exactly what those blocks contain and **throws on anything it
 * does not understand** — an unknown size unit, a key it cannot parse. A
 * parser that returns `null` for a line it failed on is a parser that reports
 * "no drift" about a file it could not read, which is the failure this whole
 * check exists to stop.
 *
 * Pure and exported so `tests/deploy-checks.test.ts` can run it against the
 * real file: the fixture is the repository, so a change to the config's shape
 * shows up as a failing test rather than as a check that quietly stops seeing
 * a bucket.
 */
export function declaredBuckets(toml: string): DeclaredBucket[] {
  const buckets: DeclaredBucket[] = [];
  let current: Partial<DeclaredBucket> & { name?: string } = {};
  const flush = () => {
    if (current.name !== undefined) {
      buckets.push({
        name: current.name,
        public: current.public ?? false,
        fileSizeLimit: current.fileSizeLimit ?? null,
        allowedMimeTypes: current.allowedMimeTypes ?? null,
      });
    }
    current = {};
  };

  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || line.length === 0) continue;

    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      flush();
      const bucket = /^storage\.buckets\.(.+)$/.exec(header[1] ?? "");
      if (bucket) current = { name: (bucket[1] ?? "").replace(/^"|"$/g, "") };
      continue;
    }
    if (current.name === undefined) continue;

    const pair = /^([A-Za-z_]+)\s*=\s*(.+?)\s*(?:#.*)?$/.exec(line);
    if (!pair) continue;
    const [, key, value] = pair as unknown as [string, string, string];
    if (key === "public") current.public = value === "true";
    else if (key === "file_size_limit") current.fileSizeLimit = sizeInBytes(value);
    else if (key === "allowed_mime_types") current.allowedMimeTypes = stringList(value);
  }
  flush();
  return buckets;
}

const UNITS: Record<string, number> = {
  "": 1,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
};

/** `"50MiB"` → 52428800. Throws on a unit it does not know. */
function sizeInBytes(value: string): number {
  const text = value.trim().replace(/^"|"$/g, "");
  const parsed = /^(\d+)\s*([A-Za-z]*)$/.exec(text);
  const unit = UNITS[(parsed?.[2] ?? "").toUpperCase()];
  if (!parsed || unit === undefined) {
    throw new Error(
      `supabase/config.toml: cannot read the size "${text}". Add its unit to UNITS in ` +
        `scripts/deploy-checks.ts rather than letting the bucket check skip it.`,
    );
  }
  return Number(parsed[1]) * unit;
}

/** `["a", "b"]` → `["a", "b"]`. Throws rather than returning a partial list. */
function stringList(value: string): string[] {
  const text = value.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) {
    throw new Error(`supabase/config.toml: expected a list and found "${text}"`);
  }
  const inner = text.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((item) => {
    const quoted = /^\s*"([^"]*)"\s*$/.exec(item);
    if (!quoted) throw new Error(`supabase/config.toml: cannot read the list entry "${item}"`);
    return quoted[1] as string;
  });
}
