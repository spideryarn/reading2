/**
 * Ship what is committed, and prove it arrived.
 *
 *     npm run deploy
 *     npm run deploy -- --dry-run          # every local gate, nothing external
 *     npm run deploy -- --verify-only      # check what is live, deploy nothing
 *     npm run deploy -- --force-gate=test  # named, loud, printed in the summary
 *
 * The plan, the measurements behind each step and the decisions Greg made are in
 * docs/plans/260827v-deploy-pipeline.md. The judgements live in scripts/deploy-checks.ts
 * so that each of them can be tested against the broken state rather than only
 * the working one.
 *
 * ## The three things this file is built around
 *
 * **What ships is the commit, not the disk.** A push builds on Vercel's machine
 * from a clone, so another agent's uncommitted edits — of which there are always
 * some in this tree — cannot reach production. The corollary is the one that
 * keeps biting: a green build *here* says nothing about whether `main` builds,
 * because your working tree may contain the file your commit imports. That has
 * broken `main` three times. So the gates run against a worktree of the exact
 * sha, never against the working tree.
 *
 * **One sha, from the first gate to the last check.** Several agents commit into
 * this tree, and HEAD's green/red status has a half-life of minutes — it moved
 * three times while this script was being written. So the sha is captured once
 * and *pushed by name* (`<sha>:refs/heads/main`), rather than pushing whatever
 * `main` has become since the tests ran. A plain `git push origin main` would
 * gate one commit and ship another, and everything downstream would still be
 * describing the first.
 *
 * **Liveness is not the question.** Nearly every check that could be written
 * here passes over a perfectly healthy deployment three commits old. So every
 * post-deploy check is anchored to the sha *and* to the deployment id, and both
 * artefacts carry a stamp saying what built them (scripts/build-stamp.ts).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Pool } from "pg";

import { sslDecisionFor } from "../src/db/ssl.js";
import { readEnvProd } from "../src/env.js";
import { describeMaterialise, materialiseCorpus } from "./corpus-materialise.js";
import { LockHeldError, takeLockFile } from "./lockfile.js";
import { forceRemoveThrowawayWorktree } from "./worktree-admin.js";
import {
  assetUrlsIn,
  codeMayNotHaveShipped,
  deployBranchProblem,
  describeRedirect,
  findSecretsInBundle,
  GATE_FIXTURE_ROOT,
  judgeClientBuild,
  judgeDeployments,
  judgeHealth,
  judgeLogs,
  ledgerDivergence,
  migratorUrlFrom,
  migrationState,
  postApplyProblems,
  missingGateFixtures,
  readLogQuery,
  rollbackAdvice,
  sawSmokeLine,
  scanSql,
  TRUNK_BRANCH,
  trunkGap,
  type Expected,
  type JournalEntry,
  type LogLine,
  type LogQuery,
  type VercelDeployment,
} from "./deploy-checks.js";
import { storageBucketProblems } from "./storage-buckets.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "greg-detre";
const PROJECT_ID = "prj_I739wqovZ54zt2oTBbZjPIke4IEY";
const TEAM_ID = "team_Xu0cDrurD3h6PIeMZblXJEIL";
const HOST = "https://www.spideryarn.com";
const REGION = "lhr1";

/**
 * **Pinned, and not `@latest`.** The globally installed CLI (48.6.0) cannot read
 * log history at all — its `logs` is a live tail "from now and for 5 minutes at
 * most", and tailing it captures nothing, which looks exactly like an app with
 * no errors. 59.x has `--since` and `--deployment`.
 *
 * A pin rather than `@latest` because this runs in a release path: `@latest`
 * changes the tool that judges a deploy without anything changing in the repo,
 * and the day it changes its output format this script starts reporting a clean
 * log for every deployment. Bump it deliberately, with the version in the diff.
 */
const LOGS_CLI = "vercel@59.7.0";

/* ------------------------------------------------------------------ */
/* Saying things                                                       */
/* ------------------------------------------------------------------ */

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const OFF = "[0m";

/** A CLI, so `console.log`, deliberately. docs/project/logging.md. */
const say = (s = "") => console.log(s);
const step = (n: string) => say(`\n${DIM}──${OFF} ${n}`);
const ok = (s: string) => say(`  ${GREEN}ok  ${OFF} ${s}`);
const bad = (s: string) => say(`  ${RED}FAIL${OFF} ${s}`);
const info = (s: string) => say(`  ${DIM}·${OFF}    ${s}`);

const failures: string[] = [];
const forced: string[] = [];
/** Set once migrations have run, so a later failure can say the dangerous thing. */
let schemaAdvanced = 0;
/** Set once the push has happened, so the summary cannot claim a deploy that did not occur. */
let didDeploy = false;

function record(name: string, problems: string[]): boolean {
  if (problems.length === 0) {
    ok(name);
    return true;
  }
  bad(name);
  for (const p of problems) say(`         ${p}`);
  failures.push(name);
  return false;
}

/**
 * A gate, and its one escape hatch.
 *
 * `--force-gate=<name>` is named rather than blanket, and is printed in the
 * final summary, because an override nobody can see afterwards is the same as
 * never having had a gate.
 */
function gate(name: string, passed: boolean, why: () => string): void {
  if (passed) {
    ok(name);
    return;
  }
  if (FORCED_GATES.has(name)) {
    bad(`${name} — FORCED past with --force-gate=${name}`);
    say(`${DIM}${why()}${OFF}`);
    forced.push(name);
    return;
  }
  bad(name);
  say(`${DIM}${why()}${OFF}`);
  say(`         ${DIM}override with --force-gate=${name} if you have decided this is not yours${OFF}`);
  failures.push(name);
}

/* ------------------------------------------------------------------ */
/* Flags                                                               */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const flagValue = (f: string) => {
  const inline = argv.find((a) => a.startsWith(`${f}=`));
  if (inline) return inline.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const DRY_RUN = has("--dry-run");
const VERIFY_ONLY = has("--verify-only");
const SKIP_MIGRATIONS = has("--skip-migrations");
const TARGET_HOST = flagValue("--host") ?? HOST;
const FORCED_GATES = new Set(
  argv.filter((a) => a.startsWith("--force-gate=")).map((a) => a.slice("--force-gate=".length)),
);

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
}

/**
 * `opts.env` may set a variable **or unset one**, by giving it `undefined`.
 *
 * Unsetting matters as much as setting: the preflight has to run in an
 * environment it fully describes, or the gate's answer depends on whose terminal
 * it ran in. **Nothing passes `undefined` today** — `BUILD_ENV` did, to keep a
 * stray `DATABASE_URL` away from the import-time guards, and no longer needs to
 * (see `BUILD_ENV` below). Kept because the capability is two lines and the next
 * import-time guard will want it.
 */
function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env };
  for (const [key, value] of Object.entries(opts.env ?? {})) if (value === undefined) delete env[key];
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const tail = (s: string, n = 25) => s.trimEnd().split("\n").slice(-n).join("\n");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Try once more after a pause, for the things that fail for a second.
 *
 * Used only for the shared Supabase pooler, which refused a connection with
 * `(EAUTHTIMEOUT) timeout while waiting for message` on the first real run of
 * this script — a connection that had worked a minute earlier and worked again
 * a minute later. Deliberately one retry and not a loop: the point is to survive
 * a blip, not to sit patiently through a real outage while somebody waits.
 */
async function withOneRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    info(`retrying after: ${(err as Error).message}`);
    await sleep(3000);
    return attempt();
  }
}

function envFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1]) out[m[1]] = (m[2] ?? "").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Safe to print: parsed, so a `@` inside the password cannot fool it. */
function withoutPassword(connection: string): string {
  try {
    const u = new URL(connection);
    u.password = "";
    u.searchParams.delete("password");
    return u.toString();
  } catch {
    return "(a connection string that is not a parsable URL)";
  }
}

/**
 * A Vercel API token: `VERCEL_TOKEN`, else the one the CLI already holds from
 * `vercel login`. Read, never printed.
 */
function vercelToken(): string {
  const fromEnv = process.env.VERCEL_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  for (const file of [
    path.join(homedir(), "Library/Application Support/com.vercel.cli/auth.json"),
    path.join(homedir(), ".local/share/com.vercel.cli/auth.json"),
  ]) {
    if (!existsSync(file)) continue;
    const token = (JSON.parse(readFileSync(file, "utf8")) as { token?: string }).token;
    if (token) return token;
  }
  throw new Error("No Vercel token. Set VERCEL_TOKEN, or run `vercel login`.");
}

async function vercelApi<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`https://api.vercel.com${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${vercelToken()}` },
  });
  if (!res.ok) throw new Error(`Vercel API answered ${res.status} for ${pathAndQuery.split("?")[0]}`);
  return (await res.json()) as T;
}

/* ------------------------------------------------------------------ */
/* Only one deploy at a time                                           */
/* ------------------------------------------------------------------ */

/**
 * **Two deploys at once is not hypothetical here.** Several agents work this
 * tree, and two overlapping runs would each capture a different sha, both find
 * the same pending migrations, and both try to apply them — drizzle takes no
 * lock of any kind (read from the installed 0.45.2 source), so the second one
 * arrives at a `CREATE TABLE` that now exists and reads like a broken migration.
 *
 * A file, not a database lock, because it has to cover the push and the polling
 * too, not only the migration.
 */
function takeLock(): () => void {
  const file = path.join(ROOT, ".git", "spideryarn-deploy.lock");

  /* **The claim is atomic** — see scripts/lockfile.ts. This used to be
     `if (!existsSync(file)) return claim()` followed by an `openSync(file, "w")`
     that never fails, so two deploys starting together both saw no file and
     both proceeded. That is the one thing this lock exists to prevent. */
  try {
    const held = takeLockFile(file);
    return () => held.release();
  } catch (err) {
    if (err instanceof LockHeldError) {
      /* Two situations, and the remedy differs. A live holder means wait; a
         leftover from something that was SIGKILLed means delete the file. The
         lock deliberately does not clear a leftover itself — two processes
         finding the same one would both take it. scripts/lockfile.ts. */
      throw new Error(
        err.holderAlive
          ? `Another deploy is running: pid ${err.holder.pid}, started ${err.holder.since || "?"}.\n` +
            "  Wait for it, or stop it. Two deploys at once would each capture a different\n" +
            "  commit and both try to apply the same pending migrations."
          : err.message,
      );
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 1. Preflight                                                        */
/* ------------------------------------------------------------------ */

async function preflight(): Promise<string> {
  step("Preflight");

  /* `--show-current` rather than `rev-parse --abbrev-ref HEAD`: the latter
     returns a disambiguated `heads/dev` when a tag shares the branch's short
     name, which would refuse a legitimate branch. Detached HEAD is `""` here
     rather than `"HEAD"`, and deployBranchProblem names both. */
  const branch = git("branch", "--show-current");
  const branchProblem = deployBranchProblem(branch);
  if (branchProblem) {
    bad(branchProblem);
    failures.push("branch");
  } else {
    ok(`on ${branch}`);
  }

  const sha = git("rev-parse", "HEAD");
  info(`deploying ${sha.slice(0, 8)}  ${git("log", "-1", "--format=%s")}`);

  /* Read-only: `git fetch` of one branch moves no local ref and touches
     nobody's work. */
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const behind = Number(git("rev-list", "--count", `${sha}..origin/main`) || "0");
  const ahead = Number(git("rev-list", "--count", `origin/main..${sha}`) || "0");
  if (behind > 0) {
    bad(`${behind} commit(s) on origin/main that this one is not built on — merge first`);
    failures.push("behind origin");
  } else {
    ok(`origin/main is an ancestor${ahead ? `, ${ahead} commit(s) to push` : ", nothing to push"}`);
  }

  /* The check above proves the candidate contains current *production*, and that
     is all it proves: it says nothing about whether the candidate contains
     current *trunk* — see `trunkGap`, which is where the whole reasoning lives.

     Since the trunk flip on 2026-09-02, `dev` is the only accepted source, so
     this branch is always taken and the guard looks redundant. It stays because
     it is the honest shape of the question rather than a leftover: `trunkGap`
     compares a candidate with the trunk, and asking it about a branch that is
     not the trunk is meaningless. Deleting the guard would make the two
     independent gates one gate by accident. */
  if (branch === TRUNK_BRANCH) {
    const fetched = run("git", ["fetch", "origin", TRUNK_BRANCH, "--quiet"]);
    let trunkSha: string | null = null;
    if (fetched.code === 0) {
      try {
        trunkSha = git("rev-parse", `origin/${TRUNK_BRANCH}`);
      } catch {
        trunkSha = null;
      }
    }
    const problem = trunkGap({ branch, sha, trunkSha });
    gate(`level with origin/${TRUNK_BRANCH}`, problem === null, () => problem ?? "");
  }

  /* Information, not a gate. A push ships commits, so somebody else's edits are
     harmless — but naming them is how you notice that the change you meant to
     deploy is one of them. */
  const dirty = git("status", "--short").split("\n").filter(Boolean);
  if (dirty.length) {
    info(`${dirty.length} uncommitted file(s) in this tree — none of them will ship:`);
    for (const line of dirty.slice(0, 6)) say(`         ${DIM}${line}${OFF}`);
    if (dirty.length > 6) say(`         ${DIM}… and ${dirty.length - 6} more${OFF}`);
  }

  /**
   * **Has somebody rolled back?** A `vercel rollback` turns off auto-assignment
   * of production domains, and Vercel does not turn it back on until a
   * deployment is promoted. Until then every push builds and goes live nowhere,
   * silently. Checked *here*, before the database is touched, because
   * discovering it after a migration means having advanced the schema for code
   * that will never serve.
   */
  try {
    const project = await vercelApi<{ autoAssignCustomDomains?: boolean }>(
      `/v9/projects/${PROJECT_ID}?teamId=${TEAM_ID}`,
    );
    if (project.autoAssignCustomDomains === false) {
      bad("Vercel is not auto-assigning production domains");
      say("         Somebody rolled back. Until a deployment is promoted, a push builds and");
      say("         goes live nowhere. Promote the one you want first:");
      say(`         vercel promote <deployment-url> --scope ${SCOPE} --yes`);
      failures.push("auto-assign is off");
    } else {
      ok("Vercel will assign the production domains to a new deployment");
    }
  } catch (err) {
    record("read the Vercel project", [(err as Error).message]);
  }

  /**
   * **Is the local database up?** Roughly a dozen suites turn themselves into
   * `describe.skip` when `DATABASE_URL` is unreachable — deliberately, so that a
   * laptop with no container can still run the rest. As a *deploy gate* that is
   * a hole: every Postgres test silently absent, and the run still green.
   *
   * Checked directly rather than by counting skips, because a threshold on a
   * skip count is a number that rots.
   */
  const local = envFile(path.join(ROOT, ".env.local")).DATABASE_URL;
  let reachable = false;
  if (local) {
    const pool = new Pool({ connectionString: local, max: 1, connectionTimeoutMillis: 5000 });
    try {
      await pool.query("select 1");
      reachable = true;
    } catch {
      /* reported below */
    } finally {
      await pool.end().catch(() => {});
    }
  }
  gate("local database is up", reachable, () =>
    "         Without it about a dozen store/Postgres suites turn themselves into describe.skip,\n" +
    "         so the test gate below would go green having run none of them. `npm run db:start`.",
  );

  /* Migration history consistency — two agents generating from a diverged
     snapshot. A second, and green today. */
  const check = run("npx", ["drizzle-kit", "check"]);
  record("drizzle-kit check", check.code === 0 ? [] : [tail(check.out, 10)]);

  return sha;
}

/* ------------------------------------------------------------------ */
/* 2. The gates, at the commit about to be pushed                      */
/* ------------------------------------------------------------------ */

/**
 * The smallest environment in which this repo will build, spelled out.
 *
 * **Both values are placeholders and neither is reachable.** They are compiled
 * into the client bundle by `import.meta.env`, and `src/web/lib/supabase.ts`
 * throws at module load without them — so a build that lacks them emits a bundle
 * that is broken in a way no exit code reports. The preflight builds a
 * working-shaped bundle instead. Nothing in a build ever connects to either.
 *
 * Named here rather than inherited from `.env.local` on purpose: what
 * production-parity needs should be a list somebody can read, not whatever
 * happens to be in one person's file. The cost is that the list can fall behind
 * the guards — it did, within hours, when a guard was added requiring the
 * Supabase Storage pair — so `explainBuildFailure` below turns that into a
 * pointer at this constant rather than an accusation against the commit.
 *
 * ## What used to be here, so nobody puts it back
 *
 * This list also carried `SPIDERYARN_STORE: "postgres"`, a `SUPABASE_URL` /
 * `SUPABASE_SERVICE_ROLE_KEY` pair, and `DATABASE_URL: undefined`. **None of
 * them was about the build.** `vite.config.ts` imported `src/routes.ts` at the
 * top level, which reaches `src/store/index.ts`, which throws at import when the
 * store is the filesystem one and `NODE_ENV=production` — and `vite build` sets
 * that whatever you are doing. So the store name was here to dodge that import;
 * the Supabase pair was here because naming a Postgres store demands it; and
 * `DATABASE_URL` had to be *deleted* because an inherited real one would not
 * match the placeholder `SUPABASE_URL` and `projectMismatch` would refuse the
 * pair. Four variables, one root cause, none of it the commit's business.
 *
 * That import is now lazy and server-only, so a build never boots a store.
 * Verified with the store name absent: both `npm run build` and the API build
 * exit 0. A build proves the client resolves, bundles and parses — it is not,
 * and never was, a check that production is configured. That assurance lives in
 * the deployed server's own boot guard, the API smoke checks, and `db:check`.
 */
const BUILD_ENV: NodeJS.ProcessEnv = {
  VITE_SUPABASE_URL: "https://deploy-preflight.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder_for_the_preflight_build",
  /* **`undefined` is back, and this is what it is for.**
   *
   * The preflight builds the same two bundles the deploy will, and with a
   * Sentry token in scope those builds would upload source maps — from *this*
   * laptop, over whatever connection it has, for a build that is thrown away.
   * The real upload belongs to the real build, which runs on Vercel's machines
   * and its network.
   *
   * Named here rather than left to chance, for the reason the header of `run`
   * gives: the token is not exported by anything today, so the preflight
   * happens not to upload — and "happens not to" is precisely the state this
   * constant exists to replace. Whoever next puts `SENTRY_AUTH_TOKEN` in their
   * shell would otherwise find the gate slower on their terminal than on
   * anybody else's, and no line anywhere would say why.
   *
   * `sentryUploadEnabled()` in scripts/sentry-build.ts needs all three, so
   * removing one is enough — and the token is the right one to remove, because
   * it is the only one of the three that is a secret. */
  SENTRY_AUTH_TOKEN: undefined,
};

/**
 * Was that the commit's fault, or this script's?
 *
 * A build that dies loading `vite.config.ts` has not compiled a line of the
 * commit. It is almost always one of the import-time guards finding `BUILD_ENV`
 * short of something — and reporting that as "the build failed" sends whoever
 * reads it to look for a bug that is not there, which is worse than saying
 * nothing. So the two cases are told apart, and named.
 */
function explainBuildFailure(output: string): string {
  const configLoad = /failed to load config from/.test(output);
  const ourGuard = /src\/store\/index\.ts|src\/env\.ts|src\/web\/lib\/supabase\.ts/.test(output);
  if (configLoad && ourGuard) {
    return (
      `${tail(output, 12)}\n\n` +
      "         ^ this is BUILD_ENV in scripts/deploy.ts being short of a variable, not a\n" +
      "           broken commit — an import-time guard refused before any code was compiled.\n" +
      "           Add the variable it names to BUILD_ENV (a placeholder value is fine; nothing\n" +
      "           in a build connects to any of them) and run this again."
    );
  }
  return tail(output);
}

/**
 * Build, typecheck and test a worktree of `sha`, not the working tree.
 *
 * `git worktree add --detach` shares the object database rather than cloning —
 * 0.3s, measured — and has its own HEAD and index, so it alters neither the main
 * checkout nor anybody's staged work. It is the only non-destructive way to ask
 * "does the *commit* work?", which matters because `git stash`, `git checkout --`
 * and `git clean` are forbidden here: other agents' only copy of their work is
 * in this tree. `--lock` closes the one race there is, which is somebody else's
 * `git worktree prune` running while this one exists.
 *
 * ## The environment, and why the gates get different amounts of it
 *
 * The build gets **two named variables**, not an inherited `.env.local`: what
 * production-parity needs should be a documented list, not whatever happens to
 * be in one person's file. It used to need four more, all of them about a store
 * a build never boots — see `BUILD_ENV` above for why they went.
 *
 * Note the order: the build runs **before** `.env.local` is linked in below, so
 * `loadEnvLocal` finds no file and `BUILD_ENV` is the whole story. That is what
 * makes the list above honest rather than decorative, and it is why the link
 * happens where it does.
 *
 * The tests cannot have that today, and this says so rather than being quiet:
 * the suite is **not hermetic**. In a clean worktree 26 files fail — the client
 * ones cannot be collected without `VITE_SUPABASE_URL`, and the pipeline ones
 * `ENOENT` on `data/`, which is gitignored. So `.env.local` is still linked from
 * the laptop, and `data/`+`output/` are **copied out of the tracked fixture
 * corpus in the worktree itself** (`GATE_FIXTURE_ROOT`). Only the env file is
 * personal state now; the artefacts the tests read come from the commit, so this
 * gate is reproducible on a fresh clone and on the remote box rather than only
 * on the machine that happens to have run the pipeline.
 */
function gatesAt(sha: string): void {
  step(`Gates, at ${sha.slice(0, 8)} — in a worktree, not in this tree`);

  const dir = mkdtempSync(path.join(tmpdir(), "spideryarn-deploy-"));
  const wt = path.join(dir, "tree");
  /* Whether `git worktree add` got far enough for there to be anything to
     unregister. Without it, an add that failed produced a second, invented
     failure from the teardown below. */
  let registered = false;

  try {
    const added = run("git", [
      "worktree",
      "add",
      "--detach",
      "--lock",
      "--reason",
      "npm run deploy is checking this commit",
      "--quiet",
      wt,
      sha,
    ]);
    if (added.code !== 0) {
      record("worktree", [tail(added.out, 8)]);
      return;
    }
    registered = true;

    /**
     * Dependencies. Sharing the main tree's `node_modules` is what makes this
     * gate cost two seconds instead of twenty-four — but it is only honest while
     * the lockfile has not moved, because a shared `node_modules` describes
     * *this laptop*, not the commit. When the lockfile is part of what is
     * shipping, the cheap version cannot see a dependency that was added, so it
     * escalates rather than warning: a warning about a gate that cannot see the
     * thing it is gating is not a gate.
     */
    const lockChanged = git("diff", "--name-only", "origin/main", sha).split("\n").includes("package-lock.json");
    if (lockChanged) {
      info("package-lock.json is part of this deploy — installing properly rather than sharing node_modules");
      const ci = run("npm", ["ci", "--silent", "--no-audit", "--no-fund"], { cwd: wt });
      if (ci.code !== 0) {
        record("npm ci at this commit", [tail(ci.out, 15)]);
        return;
      }
    } else {
      symlinkSync(path.join(ROOT, "node_modules"), path.join(wt, "node_modules"));
    }

    /* One command, because `npm run build` **is** both passes as of 2026-09-03
       — `build:client` then `build:api`, the same order and the same recipe
       Vercel's `buildCommand` runs. This used to spell the API build out a
       second time here, which was the only place a developer could see the
       whole recipe; now there is one of it and this reads it rather than
       repeating it. */
    const built = run("npm", ["run", "--silent", "build"], { cwd: wt, env: BUILD_ENV });
    gate("build", built.code === 0, () => explainBuildFailure(built.out));

    /* Only the tests need the personal state, so only they get it. */
    const envLocal = path.join(ROOT, ".env.local");
    if (existsSync(envLocal)) symlinkSync(envLocal, path.join(wt, ".env.local"));

    /**
     * **Both halves of the store, or say so.** `data/` and `output/` are one
     * filesystem artefact store split across two directories, and copying only
     * the first made the `test` gate structurally incapable of passing: 13
     * failures and 202 cascade-skips at every commit, so `--force-gate=test`
     * became the only way anyone deployed. An override that is required every
     * time is not an override.
     *
     * Named as its own gate rather than left to surface as `ENOENT`s, because a
     * missing fixture and a broken commit are opposite diagnoses that produced
     * identical output.
     */
    /* **Checked in the worktree, not in this tree.** The corpus is tracked, so
       the question is whether *the commit* still has it — a commit that deleted
       a fixture must not pass on the strength of the laptop still having one. */
    const missing = missingGateFixtures((rel) => existsSync(path.join(wt, rel)));
    gate("fixtures", missing.length === 0, () =>
      [
        `         missing from the commit: ${missing.join(", ")}`,
        `         These are tracked files under ${GATE_FIXTURE_ROOT}/, present in every checkout by`,
        "         construction, so this can only mean the commit deleted or moved them. Restore",
        "         them, or update GATE_FIXTURES in scripts/deploy-checks.ts if the move was meant.",
        "         Without them the tests do not fail honestly — they ENOENT and cascade-skip,",
        "         which reads exactly like a broken commit.",
      ].join("\n"),
    );

    /* **Materialised from the tracked corpus, not from the laptop.** These used
       to be copied out of the developer's own gitignored `data/`+`output/`,
       which is why the `test` gate was structurally incapable of passing in a
       fresh clone and `--force-gate=test` became the only way anyone deployed.
       docs/plans/260901b-committed-fixture-corpus.md.

       Still copied rather than linked, for the original reason: the tests create
       and delete directories underneath these, and a link would point that at
       the real one — here, at the committed fixtures.

       A missing source is left to the gate above to diagnose rather than
       reported twice; retried once because several agents share this tree, and a
       peer's test run deleting a fixture directory mid-copy crashed a whole
       deploy on 2026-08-28 with an uncatchable-looking `directory_iterator`
       abort. */
    /* Extracted to scripts/corpus-materialise.ts on 2026-09-01, because
       `worktree:setup` needs the same copy and a second implementation would
       have lost the two lessons this one carries — both halves or neither, and
       retry once. Its header has them. */
    const materialised = materialiseCorpus(wt, { note: info });
    info(
      materialised.copied.length === 0
        ? describeMaterialise(materialised)
        : `tests run with .env.local linked and ${describeMaterialise(materialised)}`,
    );

    const tc = run("npm", ["run", "--silent", "typecheck"], { cwd: wt, env: BUILD_ENV });
    gate("typecheck", tc.code === 0, () => tail(tc.out, 20));

    const t = run("npm", ["run", "--silent", "test"], { cwd: wt });
    gate("test", t.code === 0, () => tail(t.out, 30));
  } finally {
    /* Both, in this order: unregister, then take the temp directory. A worktree
       left registered makes the next run fail on a path that has gone.

       **Both `--force` flags.** One is refused for a locked worktree — which
       this one deliberately is — and that refusal was neither checked nor
       visible, so every deploy left a registration pointing at the directory
       the next line deletes. Sixteen had accumulated against a four-day-old
       repo. scripts/worktree-admin.ts.

       `ROOT` explicitly, because unlike the `run()` helper this replaced,
       spawnSync inherits the caller's directory. And only when the add
       succeeded, or the failure reported below is one we invented. */
    const removed = registered ? forceRemoveThrowawayWorktree(wt, ROOT) : { ok: true, out: "" };
    if (!removed.ok) {
      record("worktree teardown", [
        "The gate worktree could not be unregistered, so a stale entry is left behind.",
        `Clear it with: git worktree remove --force --force ${wt}`,
        removed.out,
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------------ */
/* 3. Migrations                                                       */
/* ------------------------------------------------------------------ */

interface MigrationPlan {
  url: string;
  /** The role the deployed app connects as, checked after new tables appear. */
  appRole: string;
  pending: JournalEntry[];
  appliedBefore: number;
  /**
   * Every migration this commit contains, with the sha256 of its file **as it
   * is at the sha being deployed** — not as it is on disk, which several agents
   * are editing.
   *
   * Carried on the plan so the post-apply check can verify by hash rather than
   * by counting rows; see `postApplyProblems`.
   */
  expected: { tag: string; hash: string; created_at: number }[];
}

/**
 * Read a file **as it is at the commit being deployed**, not as it is on disk.
 *
 * The disk is being edited by several agents, and a migration that appears
 * between the gate and the apply would be applied without ever having been
 * built or tested against. `git show` costs nothing and removes the window.
 */
function fileAt(sha: string, repoPath: string): string | null {
  try {
    return execFileSync("git", ["show", `${sha}:${repoPath}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * **Do production's Storage buckets still match the file that describes them?**
 *
 * The prevention docs/postmortems/260828a-the-config-file-is-not-the-bucket.md
 * asked for and nobody wired up. `bucketDrift` was written the day after that
 * incident and then ran only when somebody remembered — so when the same drift
 * happened again, on production, nothing said a word until a reader watched an
 * image upload throw a 415 (2026-09-03).
 *
 * Before the migrations rather than after, for the reason the rollback check
 * gives above: a refusal that arrives after the schema has advanced has cost
 * something, and this one costs one GET.
 *
 * The config comes from the **commit**, like every other gate here — see
 * `fileAt`. The credentials come from `.env.prod` through the shared
 * `readEnvProd` rather than this file's own `envFile`: it is the same reader
 * `scripts/check-buckets.ts --prod` uses, so the gate and the repair command
 * cannot come to disagree about which project production is.
 */
async function storageBuckets(sha: string): Promise<void> {
  step("Storage");
  const { target, problems } = await storageBucketProblems({
    configToml: fileAt(sha, "supabase/config.toml"),
    found: readEnvProd(),
  });
  if (target) info(target);
  record("storage buckets match supabase/config.toml", problems);
}

/**
 * Say which database is about to change, and what is about to change in it,
 * **before** anything changes.
 *
 * `inet_server_addr()` is the line that would have caught the incident
 * scripts/db-migrate.ts is written around: `.env.local` overrode the shell,
 * migrations went to the laptop, and the command printed `✓ migrations applied`.
 * A local Postgres answers `127.0.0.1`; the real host answers its own address.
 * Evidence, rather than an assumption about what a URL ought to mean.
 */
async function migrationPlan(sha: string): Promise<MigrationPlan | null> {
  step("Migrations");

  const prod = envFile(path.join(ROOT, ".env.prod"));
  if (!prod.DATABASE_URL) {
    record("read .env.prod", ["no DATABASE_URL in .env.prod — cannot reach the remote"]);
    return null;
  }

  let url: string;
  try {
    url = migratorUrlFrom(prod.DATABASE_URL, prod.DATABASE_PASSWORD ?? "");
  } catch (err) {
    record("migration credential", [(err as Error).message]);
    return null;
  }
  info(`target ${withoutPassword(url)}`);

  /* Derived rather than hardcoded: it is the role .env.prod hands to Vercel, and
     two copies of one fact is how they come to disagree. */
  const appRole = new URL(prod.DATABASE_URL).username.split(".")[0] ?? "spideryarn_app";

  const ssl = sslDecisionFor(url);
  if (ssl.mode !== "verified") {
    record("migration TLS", [`TLS mode is ${ssl.mode}: ${ssl.why}`]);
    return null;
  }

  const pool = new Pool({ connectionString: url, max: 1, ssl: ssl.ssl });
  try {
    /**
     * **One retry, because the shared pooler times out.** Measured on the first
     * real run: `(EAUTHTIMEOUT) timeout while waiting for message`, from
     * Supavisor rather than from us, on a connection that worked a minute
     * earlier and a minute later. A transient refusal from a shared pooler is
     * not a reason to abandon a deploy, and it is not a reason to *continue*
     * one either — hence a retry rather than a shrug.
     */
    const who = await withOneRetry(() =>
      pool.query("select current_database() db, current_user usr, inet_server_addr()::text addr, version() v"),
    );
    const r = who.rows[0] as { db: string; usr: string; addr: string; v: string };
    info(`answering: ${r.db} as ${r.usr} at ${r.addr} — ${r.v.slice(0, 24)}`);

    const journalText = fileAt(sha, "drizzle/meta/_journal.json");
    if (!journalText) {
      record("read the journal at this commit", ["drizzle/meta/_journal.json is not in this commit"]);
      return null;
    }
    const journal = (JSON.parse(journalText) as { entries: JournalEntry[] }).entries;

    const ledger = await pool.query(
      "select hash, created_at from spideryarn_migrations.__drizzle_migrations order by created_at desc",
    );
    const rows = ledger.rows as { hash: string; created_at: number }[];
    const appliedBefore = ledger.rowCount ?? 0;
    const newest = rows[0];
    const last = newest ? Number(newest.created_at) : null;

    /* The stronger check, and the one counting cannot do: drizzle stores a
       sha256 of each migration file and then never looks at it again, so a
       database that applied a *different* 0016 is indistinguishable from a
       healthy one by counting. */
    const hashes = new Map<string, string>();
    for (const e of journal) {
      const sql = fileAt(sha, `drizzle/${e.tag}.sql`);
      if (sql !== null) hashes.set(e.tag, createHash("sha256").update(sql).digest("hex"));
    }
    if (!record("the applied history matches this commit", ledgerDivergence(journal, hashes, rows))) return null;

    /* Built from the journal AND the hashes taken at this sha, so the
       post-apply check can ask "did these exact files land" rather than "did
       the row count move by the right amount". A journal entry whose file is
       not in the commit is already reported by `ledgerDivergence` above, so
       skipping it here cannot hide anything. */
    const expected = journal.flatMap((e) => {
      const hash = hashes.get(e.tag);
      return hash ? [{ tag: e.tag, hash, created_at: e.when }] : [];
    });

    const state = migrationState(journal, last, appliedBefore);
    if (state.ahead > 0) {
      record("migration ledger", [
        `the database has ${state.ahead} migration(s) this commit does not contain`,
      ]);
      return null;
    }

    await checkAppPrivileges(pool, appRole);

    if (state.pending.length === 0) {
      ok("nothing pending — the remote is in step with this commit");
      return { url, appRole, pending: [], appliedBefore, expected };
    }

    info(`${state.pending.length} pending:`);
    for (const e of state.pending) say(`         ${e.tag}`);

    /* A report, not a gate — Greg's call. Two of these cannot work at all
       though, so naming them turns a baffling error into an obvious one. */
    for (const e of state.pending) {
      const sql = fileAt(sha, `drizzle/${e.tag}.sql`);
      if (!sql) continue;
      const found = scanSql(sql);
      for (const s of found.nonTransactional)
        say(`         ${RED}${e.tag}: ${s} will fail — the migrator wraps every file in one transaction${OFF}`);
      for (const s of found.destructive)
        say(`         ${DIM}${e.tag}: ${s} — the old code keeps serving until the new build is promoted${OFF}`);
    }

    return { url, appRole, pending: state.pending, appliedBefore, expected };
  } catch (err) {
    /* A throw here would take the whole run down with a raw stack and no
       verdict — which is what happened on the first real run. The deploy has
       not started; saying so is more useful than a `pg` error object. */
    record("reach the remote database", [
      (err as Error).message,
      "Nothing has been pushed and no migration has been applied.",
    ]);
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

/**
 * Can the role the app actually runs as still read every table?
 *
 * **A migration that adds a table can leave one the app cannot see, silently.**
 * New objects are owned by whoever ran the migration, and `spideryarn_app` gets
 * its access from an `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA
 * spideryarn` set up once at bootstrap — a rule scoped to **`postgres`
 * specifically**. Migrations run as `postgres` today, so it holds; the day one
 * runs as anything else, the tables it creates fall outside the rule and the app
 * gets `permission denied for table X` on the next request that touches it.
 * Nothing at boot checks, and nothing in this deploy would otherwise notice.
 * docs/project/database.md § Roles.
 *
 * Asked as one query over **every** table in the schema rather than by parsing
 * `create table` out of the pending SQL. Parsing would answer only for the
 * migrations this run applied, and the failure is just as real when it arrives
 * from a hand-run statement in the dashboard — which is how the roles were
 * bootstrapped in the first place.
 */
async function checkAppPrivileges(pool: Pool, appRole: string): Promise<void> {
  const unreadable = await pool.query(
    `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'spideryarn'
        and c.relkind = 'r'
        and not has_table_privilege($1, c.oid, 'select')
      order by c.relname`,
    [appRole],
  );
  const names = (unreadable.rows as { relname: string }[]).map((r) => r.relname);
  record(
    `${appRole} can read every table in the schema`,
    names.length === 0
      ? []
      : [
          `${names.length} table(s) the running app cannot select from: ${names.join(", ")}`,
          "New objects are owned by whoever migrated, and the default-privilege grant is scoped",
          "FOR ROLE postgres. See docs/project/database.md § Roles.",
        ],
  );
}

/**
 * Apply, then prove the ledger moved by exactly what was pending.
 *
 * The assertion is the point. A run that applies nothing while something was
 * pending is the failure this whole script exists to make loud — it is what
 * `✓ migrations applied` said on the day it migrated the laptop.
 */
async function applyMigrations(plan: MigrationPlan): Promise<void> {
  const r = run("npm", ["run", "--silent", "db:migrate"], {
    env: { DATABASE_URL: plan.url, DB_MIGRATE_ALLOW_REMOTE: "yes" },
  });
  schemaAdvanced = plan.pending.length;
  if (r.code !== 0) {
    record("apply migrations", [tail(r.out, 20)]);
    return;
  }

  const ssl = sslDecisionFor(plan.url);
  const pool = new Pool({ connectionString: plan.url, max: 1, ssl: ssl.ssl });
  try {
    /* The rows, not a count. `postApplyProblems` says why at length: a count
       accepts a run that applied nothing while another machine applied the same
       migration, and accepts a DIFFERENT migration landing, which is the same
       arithmetic and worse. */
    const after = await pool.query(
      "select hash, created_at from spideryarn_migrations.__drizzle_migrations",
    );
    const applied = (after.rows as { hash: string; created_at: number }[]).map((r) => ({
      hash: String(r.hash),
      created_at: Number(r.created_at),
    }));
    record(`apply ${plan.pending.length} migration(s)`, postApplyProblems(plan.expected, applied));
    /* Again, because this is the moment a new table exists. */
    await checkAppPrivileges(pool, plan.appRole);
  } finally {
    await pool.end();
  }
}

/* ------------------------------------------------------------------ */
/* 4-5. Push, and wait for the deployment that is ours                 */
/* ------------------------------------------------------------------ */

async function listDeployments(query: string): Promise<VercelDeployment[]> {
  const res = await vercelApi<{ deployments?: (VercelDeployment & { createdAt?: number })[] }>(
    `/v7/deployments?projectId=${PROJECT_ID}&teamId=${TEAM_ID}&target=production&${query}`,
  );
  return res.deployments ?? [];
}

/** The production deployment a rollback would go to. Captured before we change anything. */
async function currentlyServing(): Promise<VercelDeployment | null> {
  const list = await listDeployments("state=READY&limit=10");
  return list.find((d) => d.readySubstate === "PROMOTED") ?? list[0] ?? null;
}

/**
 * Wait until the deployment for this sha is *serving*, not merely built.
 *
 * Two things beyond the obvious. `READY` means the build succeeded; a build can
 * succeed and be aliased to nothing, so `readySubstate: "PROMOTED"` is what says
 * it is answering. And the deployment must have been **created after our push**
 * — otherwise a redeploy of the same sha from an hour ago satisfies the sha
 * filter, and every check downstream then describes the wrong build in
 * convincing detail.
 */
async function waitForDeployment(sha: string, after: number): Promise<VercelDeployment | null> {
  step("Waiting for Vercel");
  const deadline = Date.now() + 12 * 60_000;
  let said = "";

  while (Date.now() < deadline) {
    const all = (await listDeployments(`sha=${sha}&limit=10`)) as (VercelDeployment & {
      createdAt?: number;
    })[];
    const fresh = all.filter((d) => (d.createdAt ?? 0) >= after);
    const verdict = judgeDeployments(fresh, sha);

    if (verdict.kind === "failed") {
      bad(`the build ${verdict.state}`);
      const logs = run("vercel", [
        "inspect",
        `https://${verdict.deployment.url}`,
        "--logs",
        "--scope",
        SCOPE,
      ]);
      say(`${DIM}${tail(logs.out, 30)}${OFF}`);
      failures.push("build on Vercel");
      return null;
    }
    if (verdict.kind === "built-not-live") {
      bad(`built, but not promoted (readySubstate: ${verdict.deployment.readySubstate})`);
      say(`         vercel promote https://${verdict.deployment.url} --scope ${SCOPE} --yes`);
      failures.push("promotion");
      return null;
    }
    if (verdict.kind === "live") {
      ok(`live: https://${verdict.deployment.url}  (${verdict.deployment.uid})`);
      return verdict.deployment;
    }

    const now =
      verdict.kind === "absent"
        ? all.length
          ? "Vercel has the commit but has not started a new deployment yet"
          : "waiting for Vercel to notice the push"
        : "building";
    if (now !== said) {
      info(now);
      said = now;
    }
    await sleep(5000);
  }

  bad("gave up waiting after 12 minutes");
  failures.push("deployment timed out");
  return null;
}

/* ------------------------------------------------------------------ */
/* 6. Verify                                                           */
/* ------------------------------------------------------------------ */

/**
 * One request, never following redirects.
 *
 * `redirect: "manual"` is load-bearing: a protected URL answers 302 to Vercel's
 * login page, and a client that follows it reads 200 off the login page and
 * calls the site up. That is the specific way a smoke test lies, and this
 * project has shipped a check with exactly that shape.
 */
async function get(url: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    redirect: "manual",
    ...init,
    headers: { "cache-control": "no-cache", ...(init.headers ?? {}) },
  });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

/** A path nothing routes to, so its only possible answer is the gate's 401. */
const smokePath = (id: string) => `/api/__deploy-smoke__/${encodeURIComponent(id)}`;

/** `/api/health`, and the two stamps that say which build is answering. */
async function verifyHealth(expected: Expected): Promise<void> {
  /* One retry on the first request only, for a cold start. Latency is never a
     gate — a slow answer is a working deployment. */
  let health = await get(`${TARGET_HOST}/api/health`);
  if (health.status >= 500 || health.status === 0) {
    await sleep(4000);
    health = await get(`${TARGET_HOST}/api/health`);
  }

  const redirected = describeRedirect(health.status, health.headers.get("location"));
  if (redirected) {
    record("GET /api/health", [redirected]);
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(health.body) as Record<string, unknown>;
  } catch {
    record("GET /api/health", [`not JSON (${health.status}): ${health.body.slice(0, 140)}`]);
    return;
  }
  record("GET /api/health", judgeHealth(body, { ...expected, path: "/api/health", region: REGION }));

  /* The client half of the stamp. A working page in front of an API that has
     moved is the failure nothing else here would notice. */
  const stamp = await get(`${TARGET_HOST}/build.json`);
  let clientBuild: { commit?: string; deploymentId?: string } | null = null;
  try {
    clientBuild = stamp.status === 200 ? (JSON.parse(stamp.body) as typeof clientBuild) : null;
  } catch {
    clientBuild = null;
  }
  record("GET /build.json — the page's own stamp", judgeClientBuild(clientBuild, expected));
}

/**
 * `NODEJS_HELPERS=0` still holds. Every field is asserted, not just `bytes`: a
 * truncated read, a body that did not parse, and the helpers being back on are
 * three different faults, and only one of them makes `bytes` zero.
 */
async function verifyRequestBody(): Promise<void> {
  const sent = JSON.stringify({ hello: "world", from: "npm run deploy" });
  const probe = await get(`${TARGET_HOST}/api/health`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: sent,
  });

  const problems: string[] = [];
  if (probe.status !== 200) problems.push(`answered ${probe.status}`);
  else {
    try {
      const p = JSON.parse(probe.body) as Record<string, unknown>;
      if (p.ok !== true) problems.push("ok is not true");
      if (p.bytes !== sent.length)
        problems.push(
          `${p.bytes} of ${sent.length} bytes arrived — something read the stream before our handler did`,
        );
      if (p.contentLength !== sent.length) problems.push(`content-length arrived as ${p.contentLength}`);
      if (p.parsedAsJson !== true) problems.push("the body did not survive as JSON");
      if (p.truncated !== false) problems.push("the probe truncated the body");
      if (p.helpersDisabled !== true) problems.push("NODEJS_HELPERS is not '0' on the project");
    } catch {
      problems.push("the probe's own answer was not JSON");
    }
  }
  record("POST /api/health — a request body survives the platform", problems);
}

/**
 * The gate holds — and, in the first of these, three other things at once.
 *
 * **Three segments, unauthenticated.** That one request proves what nothing
 * else here does: that Vercel's catch-all rewrite carries a multi-segment path
 * (`/api/article/writes` used to 404 at the *platform*, before any of our code
 * ran, and so appeared in no log we write); that the auth gate covers a route
 * nothing matches, rather than falling through; and — since it reaches
 * `handleApi` — that the logging path works, which is what makes the log step
 * below mean anything at all.
 */
async function verifyGate(smoke: string): Promise<void> {
  const smokeRes = await get(`${TARGET_HOST}${smoke}`);
  const problems: string[] = [];
  if (smokeRes.status !== 401) problems.push(`answered ${smokeRes.status}, not 401`);
  if (!smokeRes.body.includes("auth-none"))
    problems.push(
      `answered '${smokeRes.body.slice(0, 80)}' — that is not our gate, so the platform answered instead of the function`,
    );
  record("a three-segment API path is refused by our gate, not by Vercel", problems);

  for (const [method, route] of [
    ["GET", "/api/library"],
    ["POST", "/api/jobs"],
  ] as const) {
    const r = await get(`${TARGET_HOST}${route}`, {
      method,
      ...(method === "POST"
        ? { headers: { "content-type": "application/json" }, body: '{"url":"https://example.com"}' }
        : {}),
    });
    record(
      `${method} ${route} refused`,
      r.status === 401 ? [] : [`answered ${r.status}, not 401 — anyone with the address can do this`],
    );
  }
}

/** The page, the JavaScript it asks for, and what is inside that JavaScript. */
async function verifyPage(): Promise<void> {
  const home = await get(`${TARGET_HOST}/`);
  const assets = assetUrlsIn(home.body);

  const problems: string[] = [];
  if (home.status !== 200) problems.push(`GET / answered ${home.status}`);
  if (!(home.headers.get("content-type") ?? "").includes("text/html"))
    problems.push(`served as ${home.headers.get("content-type")}, not HTML`);
  /* Vercel's "Deployment has failed" page is also a 200, and is what the branch
     alias served on 2026-08-26. */
  if (home.body.includes("Deployment has failed"))
    problems.push("this is Vercel's deployment-failed page, served as a 200");
  if (!home.body.includes('id="root"')) problems.push("no #root — this is not our index.html");
  /* A page with no scripts would make the scan below vacuously clean. */
  if (assets.length === 0) problems.push("the page loads no JavaScript at all");
  record("GET / is the app", problems);

  /* In what was actually SERVED, not in the local dist/. */
  const leaks: string[] = [];
  for (const asset of assets) {
    const js = await get(`${TARGET_HOST}${asset}`);
    if (js.status !== 200) {
      leaks.push(`${asset} answered ${js.status} — the page asks for an asset that is not there`);
      continue;
    }
    for (const found of findSecretsInBundle(js.body)) leaks.push(`${asset} contains ${found}`);
  }
  record(`${assets.length} served asset(s) exist and carry no secret`, leaks);
}

/**
 * A path returning 200 is the worst way to be missing: the SPA catch-all
 * answered `/robots.txt` with `200 text/html`, which a crawler reads as *no
 * such file* rather than as a rule. The body is checked too — a `text/plain`
 * 200 holding our index.html would satisfy a content-type check.
 */
async function verifyRobots(): Promise<void> {
  const robots = await get(`${TARGET_HOST}/robots.txt`);
  const type = robots.headers.get("content-type") ?? "";
  const problems: string[] = [];
  if (robots.status !== 200) problems.push(`answered ${robots.status}`);
  if (!type.includes("text/plain")) problems.push(`served as ${type} — the SPA catch-all has eaten it`);
  if (!/disallow/i.test(robots.body)) problems.push("has no Disallow rule in it");
  record("GET /robots.txt is a real file with a rule in it", problems);
}

async function verify(expected: Expected, smoke: string): Promise<void> {
  step(`Verifying ${TARGET_HOST}`);
  await verifyHealth(expected);
  await verifyRequestBody();
  await verifyGate(smoke);
  await verifyPage();
  await verifyRobots();
}

/* ------------------------------------------------------------------ */
/* 7. Logs                                                             */
/* ------------------------------------------------------------------ */

/**
 * What the deployment actually said about the requests we just made.
 *
 * **An empty result is a failed check here, not a quiet pass**, and that is the
 * whole design of this step. Two separate reasons an empty log means nothing:
 *
 *  - `/api/health` is answered in src/vercel.ts *before* the logging middleware,
 *    so it writes no line at all. Measured: tailing the log while curling both
 *    endpoints caught the `/api/library` 401 and nothing whatever for the 200.
 *  - the globally installed CLI cannot read history, so the wrong `vercel` on
 *    the PATH produces the same empty output as a healthy quiet app.
 *
 * So the check is not "are there no errors" but "**is the line I know I caused
 * here**" — the three-segment smoke request, which goes through `handleApi` and
 * therefore logs. Once that line is found, the absence of errors beside it is
 * worth something.
 */
/**
 * How long to keep asking, and at what spacing.
 *
 * **This is an operator-wait budget, not a measured p95.** One deploy showed the
 * smoke line absent at ~0s and present at ~90min, which bounds the lag to
 * somewhere in a 90-minute interval and supports no percentile whatever.
 * Measuring it properly needs dozens of samples across deployments and times of
 * day, with timeouts recorded as censored observations — worth doing, not done.
 * Until then this says what it is.
 */
const LOG_POLL_SECONDS = [0, 2, 5, 10, 20, 40, 70, 100, 120] as const;

async function readLogs(deployment: VercelDeployment, since: Date, smoke: string): Promise<void> {
  step("Logs");

  const queryOnce = (): LogQuery => {
    const r = run("npx", [
      "-y",
      LOGS_CLI,
      "logs",
      "--scope",
      SCOPE,
      "--deployment",
      deployment.uid,
      "--json",
      "--since",
      since.toISOString(),
      "--limit",
      "100",
    ]);
    return readLogQuery(r.code, r.out, deployment.uid);
  };

  /**
   * Poll until the line we know we caused shows up.
   *
   * **Rows accumulate across attempts rather than being replaced.** Vercel does
   * not promise ingestion order, so an error visible on attempt two must not
   * vanish because attempt five happened to return a narrower window — which
   * would let a retry manufacture the clean result it was hoping for.
   */
  const seen = new Map<string, LogLine>();
  let waited = 0;

  for (const at of LOG_POLL_SECONDS) {
    if (at > waited) {
      await sleep((at - waited) * 1000);
      waited = at;
    }
    const q = queryOnce();

    if (q.kind === "commandFailed" || q.kind === "unparsable") {
      /* Not worth retrying: the command is broken, not the timing. Saying which
         matters — the version this replaces reported all of it as "returned
         nothing", so a CLI that could never have worked looked like a quiet app. */
      record("read this deployment's logs", [
        `${LOGS_CLI} ${q.kind === "commandFailed" ? "failed" : "returned output we cannot parse"}: ${q.detail}`,
        "That is not evidence of health — it is the check itself being broken.",
      ]);
      return;
    }

    if (q.kind === "lines") {
      for (const l of q.lines) seen.set(l.id ?? `${l.timestamp ?? ""}|${l.message ?? ""}`, l);
    }

    if (sawSmokeLine([...seen.values()], smoke)) break;
  }

  const lines = [...seen.values()];

  if (lines.length === 0) {
    record("read this deployment's logs", [
      `${LOGS_CLI} returned nothing for ${deployment.uid} over ${waited}s of polling.`,
      "That is not evidence of health: an empty log looks identical to a quiet app.",
      "The deployment itself was verified live by the checks above — this check is inconclusive,",
      "not a reason to roll back.",
    ]);
    return;
  }

  const { loud, byStatus } = judgeLogs(lines);
  info(`${lines.length} line(s) after ${waited}s: ${[...byStatus].map(([s, n]) => `${n}×${s}`).join(", ")}`);

  /* The line we know we caused. Without it, "no errors" is an empty set we made
     ourselves. */
  record("the log contains the request this script made", sawSmokeLine(lines, smoke) ? [] : [
    `nothing in the log is a request for ${smoke}, though it was made and answered 401.`,
    `Ingestion may still be lagging after ${waited}s. Re-run the query by hand before trusting the line below:`,
    `  npx -y ${LOGS_CLI} logs --scope ${SCOPE} --deployment ${deployment.uid} --json --since ${since.toISOString()}`,
  ]);

  if (loud.length === 0) {
    ok("nothing at error level, on any of the three readings of it");
  } else {
    bad(`${loud.length} line(s) look like a real failure`);
    for (const l of loud.slice(0, 5)) say(`         ${String(l.message ?? "").slice(0, 300)}`);
    failures.push("errors in the log");
  }
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (VERIFY_ONLY) {
    await verify({ commit: null }, smokePath("verify-only"));
    return summarise(null);
  }

  const release = takeLock();
  try {
    const sha = await preflight();
    gatesAt(sha);
    if (failures.length) return summarise(null);

    await storageBuckets(sha);
    if (failures.length) return summarise(null);

    /**
     * **The plan is computed even under `--skip-migrations`.**
     *
     * The flag used to skip `migrationPlan()` itself — the *check*, not just
     * the apply — so a deploy could ship code that needs a column nobody had
     * created, and nothing anywhere said so. That is the exact hole the box
     * would fall into, since a bare `git push` deploys with no migration step
     * at all.
     *
     * So the flag now means what its name says: **do not apply**. If something
     * is pending it refuses to ship, because shipping code ahead of its schema
     * is the failure, not applying the migration.
     */
    const plan = await migrationPlan(sha);
    if (failures.length) return summarise(null);

    if (SKIP_MIGRATIONS && plan && plan.pending.length > 0) {
      record("--skip-migrations, with migrations pending", [
        `${plan.pending.length} migration(s) are pending: ${plan.pending.map((e) => e.tag).join(", ")}`,
        "--skip-migrations means do not APPLY them; it cannot mean ship code that needs them.",
        "Apply them (drop the flag), or deploy a commit that does not need them.",
      ]);
      return summarise(null);
    }

    if (DRY_RUN) {
      step("Dry run");
      info("stopping here. Nothing pushed, no migration applied, nothing on Vercel touched.");
      info(`next would be: apply ${plan?.pending.length ?? 0} migration(s), then push ${sha.slice(0, 8)}`);
      return summarise(null);
    }

    /* Captured before anything changes, so the rollback advice names the build
       that was serving when this run started rather than whatever is there now. */
    const wasServing = await currentlyServing();

    if (!SKIP_MIGRATIONS && plan && plan.pending.length > 0) await applyMigrations(plan);
    if (failures.length) return summarise(wasServing ? `https://${wasServing.url}` : null);

    step("Push");
    const pushedAt = Date.now();
    /* By name, not `origin main`: the sha that was gated is the sha that ships,
       whatever anybody has committed in the meantime. A non-fast-forward here is
       the right answer — somebody else pushed, and this run is now describing a
       commit that is not the tip. */
    const pushed = run("git", ["push", "origin", `${sha}:refs/heads/main`]);
    if (pushed.code !== 0) {
      record(`git push ${sha.slice(0, 8)}:refs/heads/main`, [tail(pushed.out, 10)]);
      return summarise(wasServing ? `https://${wasServing.url}` : null);
    }
    didDeploy = true;
    ok(`pushed ${sha.slice(0, 8)} to origin/main`);

    const deployment = await waitForDeployment(sha, pushedAt);
    if (!deployment) return summarise(wasServing ? `https://${wasServing.url}` : null);

    const smoke = smokePath(deployment.uid);
    await verify({ commit: sha, deploymentId: deployment.uid }, smoke);
    await readLogs(deployment, new Date(pushedAt), smoke);

    /* Rollback is offered only when the code may not be live. An unreadable log
       is not a reason to undo a verified deployment — and doing so silently
       turns off production-domain auto-assignment, which is the trap the advice
       itself warns about. */
    return summarise(codeMayNotHaveShipped(failures) && wasServing ? `https://${wasServing.url}` : null);
  } finally {
    release();
  }
}

function summarise(previous: string | null): void {
  say();
  if (forced.length) {
    /* "DEPLOYED WITH …" would be a lie on a dry run, and the whole value of this
       banner is that it can be believed when it appears in a real one. */
    const what = didDeploy ? "DEPLOYED" : "CHECKED";
    say(`${RED}${what} WITH ${forced.join(", ").toUpperCase()} GATE(S) FORCED${OFF}`);
    say(`${DIM}An override is a debt entry, not a workflow. docs/plans/260827v-deploy-pipeline.md${OFF}`);
    say();
  }

  if (failures.length === 0) {
    say(didDeploy ? `${GREEN}Deployed and verified.${OFF}` : `${GREEN}All checks passed. Nothing was deployed.${OFF}`);
    return;
  }

  say(`${RED}${failures.length} check(s) failed:${OFF} ${failures.join(", ")}`);

  /**
   * **The dangerous state, said out loud.** A migration ran and the code did
   * not ship, so production is serving the previous build against the new
   * schema. That is survivable precisely because migrations here are additive —
   * and it is the moment somebody reaches for a schema rollback, which is the
   * one thing that would turn a recoverable half-deploy into an outage.
   */
  /* Live and verified, and only the after-the-fact checks failed. Say that
     plainly: the banner and the rollback advice below are both about code that
     may not have shipped, and this is not that. */
  if (didDeploy && !codeMayNotHaveShipped(failures)) {
    say(`${GREEN}Deployed, and the functional checks passed.${OFF} Log verification was inconclusive —`);
    say("the deployment is live; this is a gap in what we can see, not a reason to roll back.");
  }

  if (schemaAdvanced > 0 && codeMayNotHaveShipped(failures)) {
    say();
    say(`${RED}SCHEMA ADVANCED; CODE MAY NOT HAVE.${OFF}`);
    say(`${schemaAdvanced} migration(s) were applied to the remote before this failed.`);
    say("Do NOT roll the schema back — there are no down-migrations, and the old code");
    say("is serving happily against the new schema because the migration was additive.");
    say("Fix forward: correct the problem and run `npm run deploy` again.");
  }

  if (previous) {
    say();
    for (const line of rollbackAdvice(previous, SCOPE)) say(line);
  }
  process.exitCode = 1;
}

/**
 * **Nothing gets to end this run with a stack trace.**
 *
 * A deploy script that dies mid-way has to say where it got to, because the
 * question a human has at that moment is not what threw — it is whether
 * anything was pushed and whether the schema moved. `summarise` answers both,
 * and an unhandled rejection answers neither. Learned on the first real run,
 * from a pooler timeout that printed twenty lines of `pg` internals and no
 * verdict.
 */
try {
  await main();
} catch (err) {
  say();
  bad((err as Error).message);
  failures.push("the deploy script itself");
  summarise(null);
}
