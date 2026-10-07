/**
 * The deploy script's judgements, each one shown failing before it is trusted.
 *
 * That ordering is the rule this repo keeps relearning: a checklist whose lines
 * have only ever been seen to pass is not evidence of anything
 * (docs/reusable/silent-success.md). So nearly every `describe` here leads with
 * the broken input and only then asserts the happy one.
 *
 * See scripts/deploy-checks.ts and docs/plans/260827v-deploy-pipeline.md.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseSource, walkAst } from "./helpers/ts-ast.js";

import {
  assetUrlsIn,
  judgeServedRobots,
  bucketDrift,
  codeMayNotHaveShipped,
  declaredBuckets,
  deployBranchProblem,
  DEPLOY_SOURCE_BRANCHES,
  describeRedirect,
  failingTestsFromReport,
  findSecretsInBundle,
  GATE_FIXTURE_ROOT,
  GATE_FIXTURES,
  GATE_TOOLING_BUILDS,
  SUITE_BUILDS,
  judgeClientBuild,
  judgeDeployments,
  stagedTooLong,
  STAGED_GRACE_MS,
  judgeHealth,
  judgeLogs,
  ledgerDivergence,
  migrationState,
  migratorUrlFrom,
  missingGateFixtures,
  parseDeployArgs,
  readLogQuery,
  rollbackAdvice,
  sawSmokeLine,
  scanSql,
  stripSqlNoise,
  TRUNK_BRANCH,
  trunkGap,
  type DeclaredBucket,
  type JournalEntry,
  type RunningBucket,
  type VercelDeployment,
  postApplyProblems,
} from "../scripts/deploy-checks.js";
import { sslDecisionFor } from "../src/db/ssl.js";

describe("what the command line asked for", () => {
  /* What npm 11.19.0 sets on every `npm run`, flag or no flag — measured with a probe package
     (docs/plans/261003g-deploy-refuses-unknown-flags.md). A plain deploy must survive all of it. */
  const NPM_BASELINE = {
    npm_config_allow_scripts: "",
    npm_config_cache: "/home/greg/.npm",
    npm_config_global_prefix: "/usr",
    npm_config_globalconfig: "/usr/etc/npmrc",
    npm_config_init_module: "/home/greg/.npm-init.js",
    npm_config_local_prefix: "/home/greg/code/spideryarn2",
    npm_config_loglevel: "silent",
    npm_config_node_gyp: "/usr/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js",
    npm_config_noproxy: "",
    npm_config_npm_version: "11.19.0",
    npm_config_prefix: "/usr",
    npm_config_user_agent: "npm/11.19.0 node/v26.8.1 linux x64 workspaces/false",
    npm_config_userconfig: "/home/greg/.npmrc",
    npm_lifecycle_event: "deploy",
    PATH: "/usr/bin",
  };
  const problem = (argv: string[], env: Record<string, string> = {}) => {
    const r = parseDeployArgs(argv, { ...NPM_BASELINE, ...env });
    return r.ok ? null : r.problem.join("\n");
  };
  const mode = (argv: string[]) => {
    const r = parseDeployArgs(argv, NPM_BASELINE);
    return r.ok ? r.mode : null;
  };

  /* Each of these was a full production deploy: the investigation's own list. */
  it.each([
    ["--verify-onyl"],
    ["verify-only"],
    ["--dryrun"],
    ["--dry_run"],
    ["--skip-migration"],
    ["--verify-only=true"],
    ["--Verify-Only"],
    ["-n"],
    [""],
  ])("refuses an argument it does not know: %j", (arg) => {
    expect(problem([arg])).toContain(`unknown argument '${arg}'`);
    /* And a good flag beside it does not rescue it. */
    expect(problem(["--verify-only", arg])).toContain(`unknown argument '${arg}'`);
  });

  it("refuses --host unless the run is --verify-only", () => {
    expect(problem(["--host", "https://staging.example"])).toContain("--host only goes with --verify-only");
    expect(problem(["--host=https://staging.example"])).toContain("--host only goes with --verify-only");
    expect(problem(["--dry-run", "--host", "https://staging.example"])).toContain("--host only goes with");
  });

  it("refuses a --host with no origin after it, rather than eating the next flag", () => {
    expect(problem(["--verify-only", "--host"])).toContain("--host needs an origin");
    expect(problem(["--host", "--verify-only"])).toContain("--host needs an origin");
    expect(problem(["--verify-only", "--host=staging.example"])).toContain("--host needs an origin");
    expect(problem(["--verify-only", "--host", "https://x.example/some/path"])).toContain("--host needs an origin");
  });

  it("refuses the space form of --force-gate, which used to be silently ignored", () => {
    expect(problem(["--force-gate", "test"])).toContain("--force-gate=<name>");
    expect(problem(["--force-gate="])).toContain("names no gate");
  });

  it("refuses a deploy flag beside --verify-only instead of ignoring it", () => {
    expect(problem(["--verify-only", "--dry-run"])).toContain("--dry-run means nothing beside it");
    expect(problem(["--verify-only", "--skip-migrations"])).toContain("--skip-migrations");
    expect(problem(["--verify-only", "--force-gate=test"])).toContain("--force-gate");
  });

  /* `npm run deploy --verify-only`: empty argv, and the flag in the environment. */
  it.each([
    ["npm_config_verify_only", "true", "--verify-only"],
    ["npm_config_dry_run", "true", "--dry-run"],
    ["npm_config_skip_migrations", "true", "--skip-migrations"],
    ["npm_config_host", "https://staging.example", "--host"],
    ["npm_config_force_gate", "test", "--force-gate"],
    /* A typo and a dropped `--` at once. */
    ["npm_config_verify_onyl", "true", "--verify-onyl"],
    ["npm_config_dryrun", "true", "--dryrun"],
    /* GPT Sol's three, which a match on fragments of our flag names let through to a deploy. */
    ["npm_config_verfiy_only", "true", "--verfiy-only"],
    ["npm_config_dr_run", "true", "--dr-run"],
    /* npm's own, and exactly what somebody checking would type. */
    ["npm_config_read_only", "true", "--read-only"],
    ["npm_config_only", "true", "--only"],
    ["npm_config_force", "true", "--force"],
    /* `--verify-only=false` leaves the key present and empty. */
    ["npm_config_verify_only", "", "--verify-only"],
    ["NPM_CONFIG_VERIFY_ONLY", "true", "--verify-only"],
  ])("refuses a flag npm swallowed: %s=%j", (key, value, flag) => {
    const said = problem([], { [key]: value });
    expect(said).toContain(key);
    expect(said).toContain(`npm run deploy -- ${flag}`);
    /* Even when the same flag also arrived properly: something was still lost. */
    expect(problem(["--dry-run"], { [key]: value })).toContain(key);
  });

  it("does not mistake ordinary npm configuration for a swallowed flag", () => {
    /* `host` is in the name, and a fragment match refused a plain deploy over it. */
    const env = { ...NPM_BASELINE, npm_config_replace_registry_host: "never", npm_config_registry: "https://r.example/" };
    expect(parseDeployArgs([], env)).toEqual({ ok: true, mode: { op: "deploy", skipMigrations: false, forcedGates: new Set(), ready: false } });
  });

  it.each(["", "false"])("refuses npm's negative answer, npm_config_yes=%j", (value) => {
    /* npm expands `-n`, `--no` and `--no-yes` to yes=false, exported as an
       empty string. A person saying no must never get a production deploy. */
    expect(problem([], { npm_config_yes: value })).toContain("npm_config_yes");
    expect(problem(["--skip-migrations"], { NPM_CONFIG_YES: value })).toContain("NPM_CONFIG_YES");
  });

  it("accepts the positive npm answer inherited from an npx -y wrapper", () => {
    expect(parseDeployArgs([], { ...NPM_BASELINE, npm_config_yes: "true" })).toMatchObject({
      ok: true,
      mode: { op: "deploy" },
    });
  });

  it("accepts the forms the docs name, under npm's ordinary environment", () => {
    expect(mode([])).toEqual({ op: "deploy", skipMigrations: false, forcedGates: new Set(), ready: false });
    expect(mode(["--dry-run"])).toEqual({ op: "dry-run", skipMigrations: false, forcedGates: new Set(), ready: false });
    expect(mode(["--verify-only"])).toEqual({ op: "verify", host: null });
    expect(mode(["--verify-only", "--host", "https://staging.example/"])).toEqual({
      op: "verify",
      host: "https://staging.example",
    });
    expect(mode(["--host=http://localhost:3000", "--verify-only"])).toEqual({
      op: "verify",
      host: "http://localhost:3000",
    });
    expect(mode(["--skip-migrations", "--force-gate=test", "--force-gate=changelog"])).toEqual({
      op: "deploy",
      skipMigrations: true,
      forcedGates: new Set(["test", "changelog"]),
      ready: false,
    });
    expect(mode(["--dry-run", "--force-gate=test"])).toEqual({
      op: "dry-run",
      skipMigrations: false,
      forcedGates: new Set(["test"]),
      ready: false,
    });
  });
});

const SHA = "1f032e20f723883f4eecd218b06701c754d320a5";
const OLD = "d5a9d513a6d298147c81938873096dbad09e6d26";

const journal = (...whens: number[]): JournalEntry[] =>
  whens.map((when, idx) => ({ idx, tag: `${String(idx).padStart(4, "0")}_thing`, when }));

/* ------------------------------------------------------------------ */

describe("deployBranchProblem", () => {
  it("refuses a worktree branch, which has no .env.prod to deploy with", () => {
    expect(deployBranchProblem("worktree-referee-mode")).toBe(
      "on branch 'worktree-referee-mode', not dev",
    );
  });

  it("refuses a detached HEAD rather than reasoning about a branch that is not there", () => {
    // `git branch --show-current` is empty when detached...
    expect(deployBranchProblem("")).toBe("HEAD is detached, so there is no branch to deploy from");
    // ...and the older `rev-parse --abbrev-ref HEAD` spelling said "HEAD",
    // which is still refused rather than mistaken for a branch.
    expect(deployBranchProblem("HEAD")).toBe("on branch 'HEAD', not dev");
  });

  it("accepts dev, the trunk agents commit and push to", () => {
    expect(deployBranchProblem("dev")).toBeNull();
  });

  it("refuses main, which after the flip is the unchecked path rather than a spare one", () => {
    /* `main` was accepted through the changeover, and dropping it is the point of
       the flip rather than tidying after it. `trunkGap` is scoped to
       `TRUNK_BRANCH`, so a checkout still standing on `main` — the Mac, or a
       clone made before GitHub's default moved — is the one deploy path with no
       trunk comparison at all: it would promote main-only work and leave `dev`
       silently behind production. Refusing costs a clear message; accepting
       costs a divergence nobody sees. */
    expect(deployBranchProblem("main")).toBe("on branch 'main', not dev");
  });

  it("names the one branch, so the message cannot drift from the list", () => {
    expect([...DEPLOY_SOURCE_BRANCHES]).toEqual(["dev"]);
  });
});

/**
 * GPT Sol's finding 1 on this slice: accepting `dev` as a deploy source opened a
 * gap, because `preflight` only ever compared against `origin/main`. Each case
 * below is a state that used to pass.
 */
describe("trunkGap", () => {
  it("refuses a stale trunk checkout that would promote code missing landed commits", () => {
    // origin/main: A · local dev: A-B · origin/dev: A-B-C-D. `B` contains
    // production, so the origin/main check is happy, and `C`/`D` vanish.
    expect(trunkGap({ branch: "dev", sha: "b".repeat(40), trunkSha: "d".repeat(40) })).toBe(
      "bbbbbbbb is not origin/dev (dddddddd) — pull, or push this work to dev first",
    );
  });

  it("refuses a local commit that was never pushed to the trunk", () => {
    // The other direction: ancestry would allow this, equality does not, and
    // allowing it is the push-then-deploy convention bypassed.
    expect(trunkGap({ branch: "dev", sha: "e".repeat(40), trunkSha: "a".repeat(40) })).toContain(
      "is not origin/dev",
    );
  });

  it("fails closed when the trunk cannot be read at all", () => {
    expect(trunkGap({ branch: "dev", sha: "a".repeat(40), trunkSha: null })).toBe(
      "could not read origin/dev — refusing rather than assuming it agrees",
    );
  });

  it("says nothing when the candidate is exactly the trunk tip", () => {
    expect(trunkGap({ branch: "dev", sha: "a".repeat(40), trunkSha: "a".repeat(40) })).toBeNull();
  });

  it("stays scoped to the trunk, answering nothing about any other branch", () => {
    /* Kept after the flip, when `deployBranchProblem` refuses `main` before this
       is ever reached, because the scoping is the contract and not a detail of
       who calls it: this function compares a candidate with the trunk, and a
       branch that is not the trunk has no gap to report. Asserting `main`
       specifically is what pins that the two guards are independent — the
       refusal of `main` now lives in exactly one place. */
    expect(trunkGap({ branch: "main", sha: "a".repeat(40), trunkSha: null })).toBeNull();
  });

  it("keeps the trunk name and the deploy-source list as separate facts", () => {
    /* They overlapped only during the changeover, and conflating them is what
       made the gap invisible in the first place. Now that the list is one name
       they coincide, so this asserts the *relationship* rather than the
       coincidence: the trunk must be deployable. It would still hold if a second
       source were ever added back. */
    expect(TRUNK_BRANCH).toBe("dev");
    expect([...DEPLOY_SOURCE_BRANCHES]).toContain(TRUNK_BRANCH);
  });
});

describe("migrationState", () => {
  it("finds nothing pending when the ledger has caught up", () => {
    const j = journal(100, 200, 300);
    expect(migrationState(j, 300, 3).pending).toEqual([]);
  });

  it("names the entries the database has not seen", () => {
    const j = journal(100, 200, 300);
    const { pending } = migrationState(j, 200, 2);
    expect(pending.map((e) => e.tag)).toEqual(["0002_thing"]);
  });

  it("treats an empty ledger as everything pending", () => {
    const j = journal(100, 200);
    expect(migrationState(j, null, 0).pending).toHaveLength(2);
  });

  /**
   * The case that is normal on a laptop and never normal on the remote: an
   * agent generated `0018`, applied it locally, and has not committed it. The
   * journal at HEAD then has FEWER entries than the database has rows.
   *
   * Measured on 2026-08-27: local held 19, HEAD's journal held 18. A count
   * comparison would have called that "nothing pending" and been right by
   * accident, which is the worst kind of right.
   */
  it("reports a database that is ahead of the journal, rather than calling it clean", () => {
    const j = journal(100, 200);
    const state = migrationState(j, 300, 3);
    expect(state.pending).toEqual([]);
    expect(state.ahead).toBe(1);
  });

  /* Two agents generating in parallel is this repo's normal Tuesday, and it is
     exactly the case where counting and timestamping disagree. */
  it("goes by timestamp rather than by position", () => {
    const j = [
      { idx: 0, tag: "0000_a", when: 100 },
      { idx: 1, tag: "0001_b", when: 400 },
      { idx: 2, tag: "0002_c", when: 250 },
    ];
    const { pending } = migrationState(j, 250, 2);
    expect(pending.map((e) => e.tag)).toEqual(["0001_b"]);
  });
});

/* ------------------------------------------------------------------ */

describe("scanSql", () => {
  it("finds the statement that cannot run inside a transaction", () => {
    const found = scanSql("create index concurrently idx_a on t (c);");
    expect(found.nonTransactional).toContain("CREATE INDEX CONCURRENTLY");
  });

  it("finds a dropped column", () => {
    expect(scanSql('alter table "t" drop column "c";').destructive).toContain("DROP COLUMN");
  });

  /* The report has to be able to stay quiet, or nobody reads it. An additive
     migration — which is every migration in this repo so far — says nothing. */
  it("says nothing about an ordinary additive migration", () => {
    const sql = `create table "spideryarn"."raw_sources" (
        "id" uuid primary key,
        "bytes" integer
      );
      alter table "spideryarn"."articles" add column "raw_source_id" uuid;`;
    expect(scanSql(sql)).toEqual({ nonTransactional: [], destructive: [] });
  });

  it("is not fooled by a comment explaining what it is NOT doing", () => {
    const sql = `-- deliberately does not drop column "old_id"; see the plan
      /* nor drop table "articles" */
      alter table "t" add column "x" text;`;
    expect(scanSql(sql)).toEqual({ nonTransactional: [], destructive: [] });
  });

  it("is not fooled by the words appearing inside a string literal", () => {
    const sql = `insert into "notes" ("body") values ('we should drop table articles one day');`;
    expect(scanSql(sql).destructive).toEqual([]);
  });

  it("still finds real SQL sitting next to a comment that mentions it", () => {
    const sql = `-- drop column, at last
      alter table "t" drop column "c";`;
    expect(scanSql(sql).destructive).toContain("DROP COLUMN");
  });

  it("strips comments and strings without eating the statements between them", () => {
    expect(stripSqlNoise("select 'a' /* x */ from t -- y\n where 1=1")).toContain("from t");
  });
});

/* ------------------------------------------------------------------ */

const deployment = (over: Partial<VercelDeployment> = {}): VercelDeployment => ({
  uid: "dpl_1",
  url: "spideryarn-reading2-abc-greg-detre.vercel.app",
  target: "production",
  readyState: "READY",
  readySubstate: "PROMOTED",
  meta: { githubCommitSha: SHA },
  ...over,
});

describe("judgeDeployments", () => {
  it("says absent when nothing matches the sha yet", () => {
    expect(judgeDeployments([deployment({ meta: { githubCommitSha: OLD } })], SHA).kind).toBe("absent");
  });

  it("ignores a preview build of the very same commit", () => {
    expect(judgeDeployments([deployment({ target: "preview" })], SHA).kind).toBe("absent");
  });

  it("reports a build still running", () => {
    expect(judgeDeployments([deployment({ readyState: "BUILDING", readySubstate: null })], SHA).kind).toBe(
      "building",
    );
  });

  it("reports a failed build as failed rather than as still going", () => {
    const v = judgeDeployments([deployment({ readyState: "ERROR" })], SHA);
    expect(v.kind).toBe("failed");
  });

  /**
   * The distinction the whole step exists for. `READY` means the build worked.
   * It does not mean anybody can see it.
   */
  it("refuses to call a built-but-unpromoted deployment live", () => {
    const v = judgeDeployments([deployment({ readySubstate: "STAGED" })], SHA);
    expect(v.kind).toBe("built-not-live");
  });

  it("calls a promoted deployment live", () => {
    expect(judgeDeployments([deployment()], SHA).kind).toBe("live");
  });
});

/**
 * `STAGED` is the ordinary gap between "the build finished" and "Vercel has
 * moved the production aliases onto it", and on 2026-09-10 that gap outlived
 * one poll: the deploy reported `promotion FAIL` for a deploy that was live a
 * minute later. What made it worse than a wrong line is the remedy it prints
 * next to it — `vercel rollback`, the one command that turns off production
 * domain auto-assignment and makes the *following* deploy build and silently
 * go nowhere. So a first sighting must be waited on, not failed on.
 */
describe("stagedTooLong", () => {
  it("does not call a deployment stuck the moment it is first seen staged", () => {
    const seen = 1_000_000;
    expect(stagedTooLong(seen, seen)).toBe(false);
  });

  it("keeps waiting a minute in", () => {
    const seen = 1_000_000;
    expect(stagedTooLong(seen, seen + 60_000)).toBe(false);
  });

  it("calls it stuck once the grace has passed", () => {
    const seen = 1_000_000;
    expect(stagedTooLong(seen, seen + STAGED_GRACE_MS)).toBe(true);
    expect(stagedTooLong(seen, seen + STAGED_GRACE_MS + 1)).toBe(true);
  });

  /* The wait has to fit inside waitForDeployment's own 12-minute deadline,
   * or "gave up waiting" replaces the promotion failure it was meant to spare. */
  it("leaves room inside the 12-minute deadline for the build itself", () => {
    expect(STAGED_GRACE_MS).toBeGreaterThan(60_000);
    expect(STAGED_GRACE_MS).toBeLessThan(6 * 60_000);
  });
});

/* ------------------------------------------------------------------ */

const healthy = {
  ok: true,
  warnings: [] as string[],
  store: { name: "postgres", articles: 5 },
  ssl: { mode: "verified", why: "verified against certs/supabase-ca.crt" },
  build: { commit: SHA, builtAt: "2026-08-27T15:55:59.767Z", source: "git" },
};

describe("judgeHealth", () => {
  it("passes a healthy deployment built from the commit we pushed", () => {
    expect(judgeHealth(healthy, { commit: SHA })).toEqual([]);
  });

  /**
   * The one that matters most, because everything else on the page passes over
   * it: a perfectly healthy deployment that is three commits old.
   */
  it("fails a healthy deployment built from a different commit", () => {
    const problems = judgeHealth({ ...healthy, build: { commit: OLD } }, { commit: SHA });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(OLD);
  });

  it("fails a deployment carrying no stamp at all", () => {
    expect(judgeHealth({ ...healthy, build: null }, { commit: SHA })[0]).toContain("no build stamp");
  });

  it("fails ok:false", () => {
    expect(judgeHealth({ ...healthy, ok: false }, { commit: SHA })).toContain("health says ok:false");
  });

  /* A warning over an ok:true is the shape this endpoint shipped for a day —
     healthy on line one, the fault four lines later, and nothing comparing
     them. See docs/project/deployment.md § The env block was a report. */
  it("fails a warning even when ok is somehow true", () => {
    const problems = judgeHealth({ ...healthy, warnings: ["SUPABASE_SERVICE_ROLE_KEY is unset"] }, { commit: SHA });
    expect(problems.some((p) => p.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
  });

  it("fails the filesystem store, which on this host is an empty shelf and a 200", () => {
    const problems = judgeHealth({ ...healthy, store: { name: "files" } }, { commit: SHA });
    expect(problems.some((p) => p.includes("not postgres"))).toBe(true);
  });

  it("fails a connection that is encrypted but not verified", () => {
    const problems = judgeHealth({ ...healthy, ssl: { mode: "encrypted-unverified" } }, { commit: SHA });
    expect(problems.some((p) => p.includes("not checking who it is talking to"))).toBe(true);
  });

  it("collects every problem rather than stopping at the first", () => {
    expect(judgeHealth({ ok: false, store: { name: "files" }, ssl: { mode: "none" } }, { commit: null }).length).toBe(3);
  });
});

describe("judgeClientBuild", () => {
  it("fails when the page carries no stamp", () => {
    expect(judgeClientBuild(null, { commit: SHA })).toHaveLength(1);
  });

  /* The failure nothing else here would notice: a working page in front of an
     API that has moved. */
  it("fails when the bundle and the commit disagree", () => {
    expect(judgeClientBuild({ commit: OLD }, { commit: SHA })[0]).toContain(OLD);
  });

  it("passes when they agree", () => {
    expect(judgeClientBuild({ commit: SHA }, { commit: SHA })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("findSecretsInBundle", () => {
  it("passes a bundle with nothing secret in it", () => {
    expect(findSecretsInBundle('const url="https://x.supabase.co";const k="sb_publishable_abc";')).toEqual(
      [],
    );
  });

  /* A realistic length: the matcher requires key material after the prefix, so
     a short stub is correctly ignored — see the "against the real thing" block
     at the foot of this file for why. */
  it("catches an sb_secret_ key", () => {
    expect(findSecretsInBundle('const k="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";')).toHaveLength(1);
  });

  /**
   * The important one. A legacy service-role key does not contain the string
   * `service_role` anywhere you can grep — it is inside the base64 payload. A
   * scanner looking for the literal passes over the exact key it exists to find.
   */
  it("catches a legacy service-role JWT, whose role is only visible once decoded", () => {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
    const payload = Buffer.from('{"iss":"supabase","role":"service_role","exp":1983812996}').toString(
      "base64url",
    );
    const jwt = `${header}.${payload}.EGIM96RAZx35lJzdJsyH`;
    expect(findSecretsInBundle(`const k="${jwt}";`)[0]).toContain("service_role");
  });

  it("does not object to an anon JWT, which is supposed to be there", () => {
    const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
    const payload = Buffer.from('{"iss":"supabase","role":"anon","exp":1983812996}').toString("base64url");
    expect(findSecretsInBundle(`const k="${header}.${payload}.CRXP1A7WOeoJeXxjNni4";`)).toEqual([]);
  });
});

describe("assetUrlsIn", () => {
  it("finds the scripts a page asks for, once each", () => {
    const html = '<script src="/assets/index-Bjmsj5fB.js"></script><link href="/assets/index-DrJ5DDTC.css">';
    expect(assetUrlsIn(`${html}${html}`)).toEqual(["/assets/index-Bjmsj5fB.js"]);
  });
});

/* ------------------------------------------------------------------ */

describe("describeRedirect", () => {
  it("says nothing about an ordinary 200", () => {
    expect(describeRedirect(200, null)).toBeNull();
  });

  /**
   * The specific way a smoke test lies: `curl -L` lands on Vercel's login page,
   * reads 200 off it, and reports the site as up.
   */
  it("names a redirect to Vercel's login for what it is", () => {
    const said = describeRedirect(302, "https://vercel.com/sso-api?url=…&nonce=…");
    expect(said).toContain("deployment protection");
    expect(said).toContain("nothing here was tested");
  });

  it("refuses any other redirect too", () => {
    expect(describeRedirect(308, "https://www.spideryarn.com/")).toContain("not a passing check");
  });

  it("copes with a redirect that names no destination", () => {
    expect(describeRedirect(302, null)).toContain("somewhere unnamed");
  });
});

describe("rollbackAdvice", () => {
  /* The half everybody forgets, and the reason this is a function rather than a
     template string at the call site. */
  it("warns that a rollback silently stops the next push going live", () => {
    const lines = rollbackAdvice("https://spideryarn-reading2-old.vercel.app", "greg-detre").join("\n");
    expect(lines).toContain("vercel rollback");
    expect(lines).toContain("will NOT go live");
    expect(lines).toContain("vercel promote");
  });

  it("says so plainly when there is nothing to roll back to", () => {
    expect(rollbackAdvice(null, "greg-detre").join("\n")).toContain("No previous production deployment");
  });
});

/* ------------------------------------------------------------------ */

describe("migratorUrlFrom", () => {
  /* The value that decides which database changes. `.env.prod`'s own
     DATABASE_URL is the app role on the transaction pooler, and that role
     cannot even read the migration ledger — measured 2026-08-27. */
  const APP = "postgresql://spideryarn_app.abcdefghij:apppw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";

  it("swaps the role, keeps the project ref, and moves to the session port", () => {
    const url = new URL(migratorUrlFrom(APP, "s3cret"));
    expect(url.username).toBe("postgres.abcdefghij");
    expect(url.password).toBe("s3cret");
    expect(url.port).toBe("5432");
    expect(url.hostname).toBe("aws-0-eu-west-2.pooler.supabase.com");
  });

  /* Supavisor reads the project out of the part after the dot. A plain
     `postgres` username reaches the pooler and is refused in a way that reads
     like bad credentials. */
  it("refuses a username carrying no project ref", () => {
    expect(() => migratorUrlFrom("postgresql://postgres:pw@host:6543/postgres", "x")).toThrow(
      /project ref/,
    );
  });

  it("refuses to build a URL with no password", () => {
    expect(() => migratorUrlFrom(APP, "")).toThrow(/DATABASE_PASSWORD/);
  });

  /* `pg` DISCARDS an explicit ssl object if the connection string carries any
     of these, so the CA is loaded, reported as verified, and not used. This
     used to strip four of them — silently repairing `sslmode=no-verify` while
     `ssl=no-verify` went through. Since 2026-10-01 they are kept, so that
     `sslDecisionFor` refuses every spelling the same way, before `npm run
     deploy` connects. docs/plans/261001j. */
  it.each(["sslmode=no-verify", "ssl=no-verify", "sslrootcert=/tmp/x"])(
    "keeps %s, so the migration is refused rather than quietly repaired",
    (query) => {
      const url = migratorUrlFrom(`${APP}?${query}`, "pw");
      expect(new URL(url).search).toBe(`?${query}`);
      expect(() => sslDecisionFor(url)).toThrow(/Refusing/);
    },
  );
});

/* ------------------------------------------------------------------ */

describe("judgeHealth, the checks beyond the commit", () => {
  const withStamp = { ...healthy, build: { ...healthy.build, deploymentId: "dpl_new" } };

  /**
   * The commit check cannot see this: a commit can be deployed twice, and both
   * deployments report the same sha. This is also what an edge-cached response
   * looks like.
   */
  it("catches an older deployment of the very same commit", () => {
    const problems = judgeHealth(withStamp, { commit: SHA, deploymentId: "dpl_older" });
    expect(problems.some((p) => p.includes("dpl_older"))).toBe(true);
  });

  it("passes when the deployment ids agree", () => {
    expect(judgeHealth(withStamp, { commit: SHA, deploymentId: "dpl_new" })).toEqual([]);
  });

  /* A function built before the field existed reports null. Failing every
     deployment until the first one that carries it would make the check
     un-landable, so it is asserted only when present. */
  it("does not fail a function built before the field existed", () => {
    expect(judgeHealth(healthy, { commit: SHA, deploymentId: "dpl_new" })).toEqual([]);
  });

  it("catches the platform having rewritten the path", () => {
    const problems = judgeHealth({ ...healthy, sawUrl: "/api/index?__spy_path=health" }, {
      commit: SHA,
      path: "/api/health",
    });
    expect(problems.some((p) => p.includes("routing rewrote the path"))).toBe(true);
  });

  it("catches a function running in the wrong region", () => {
    const problems = judgeHealth({ ...healthy, region: "iad1" }, { commit: SHA, region: "lhr1" });
    expect(problems.some((p) => p.includes("crosses an ocean"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

describe("judgeLogs", () => {
  /**
   * The reason this function exists rather than a filter on `level`.
   *
   * src/log.ts writes through `pino.destination({ sync: true })` — stdout, for
   * `log.error` as much as for `log.info`. Vercel classifies a line by the
   * stream it arrived on, so our errors wear Vercel's `info`. A filter on
   * Vercel's level reports a clean deploy over a function throwing on every
   * request.
   */
  it("finds an application error that Vercel has classified as info", () => {
    const { loud } = judgeLogs([
      {
        level: "info",
        responseStatusCode: 200,
        message: JSON.stringify({ level: "error", msg: "GET /api/library 500" }),
      },
    ]);
    expect(loud).toHaveLength(1);
  });

  /**
   * **The field is `responseStatusCode`.** The first version read `statusCode`,
   * which `vercel logs --json` does not emit — so this reading matched nothing,
   * ever, and every request's status printed as `—` while the check reported
   * itself clean. Found by listing the keys of a real log line after a real
   * deploy, which is the only way this kind of mistake is found.
   */
  it("finds a 5xx under the key the CLI actually emits", () => {
    expect(judgeLogs([{ level: "info", responseStatusCode: 502, message: "" }]).loud).toHaveLength(1);
  });

  it("still reads the older key, in case it comes back", () => {
    expect(judgeLogs([{ level: "info", statusCode: 500, message: "" }]).loud).toHaveLength(1);
  });

  it("counts statuses by the real key, so the summary is not a row of dashes", () => {
    const { byStatus } = judgeLogs([
      { level: "info", responseStatusCode: 200, message: "" },
      { level: "info", responseStatusCode: 401, message: "" },
    ]);
    expect(byStatus.get("200")).toBe(1);
    expect(byStatus.get("401")).toBe(1);
    expect(byStatus.get("—")).toBeUndefined();
  });

  it("finds a line Vercel itself calls an error", () => {
    expect(judgeLogs([{ level: "error", message: "Function invocation failed" }]).loud).toHaveLength(1);
  });

  it("stays quiet over ordinary traffic, including our own 401s", () => {
    const { loud, byStatus } = judgeLogs([
      { level: "info", responseStatusCode: 200, message: JSON.stringify({ level: "info", msg: "GET / 200" }) },
      {
        level: "info",
        responseStatusCode: 401,
        message: JSON.stringify({ level: "warn", msg: "GET /api/library 401" }),
      },
    ]);
    expect(loud).toEqual([]);
    expect(byStatus.get("401")).toBe(1);
  });

  it("is not upset by a message that is not JSON", () => {
    expect(judgeLogs([{ level: "info", responseStatusCode: 200, message: "plain text" }]).loud).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */

describe("ledgerDivergence", () => {
  const j = [
    { idx: 0, tag: "0000_a", when: 100 },
    { idx: 1, tag: "0001_b", when: 200 },
  ];
  const hashes = new Map([
    ["0000_a", "aaa"],
    ["0001_b", "bbb"],
  ]);

  it("is happy when the applied rows are the start of this commit's journal", () => {
    expect(ledgerDivergence(j, hashes, [{ hash: "aaa", created_at: 100 }])).toEqual([]);
  });

  /**
   * The one counting cannot do. drizzle stores a sha256 of each migration file
   * and then never looks at it again, so a database that applied a *different*
   * `0001` is indistinguishable from a healthy one by count alone — and drizzle
   * will cheerfully carry on appending to it.
   */
  it("catches a migration that was edited after it ran", () => {
    const problems = ledgerDivergence(j, hashes, [
      { hash: "aaa", created_at: 100 },
      { hash: "something-else", created_at: 200 },
    ]);
    expect(problems[0]).toContain("different SQL");
  });

  it("catches a database holding migrations this commit has never heard of", () => {
    const problems = ledgerDivergence(j, hashes, [
      { hash: "aaa", created_at: 100 },
      { hash: "bbb", created_at: 200 },
      { hash: "ccc", created_at: 300 },
    ]);
    expect(problems[0]).toContain("beyond the 2");
  });

  it("catches a history that diverged in the middle", () => {
    const problems = ledgerDivergence(j, hashes, [{ hash: "zzz", created_at: 150 }]);
    expect(problems[0]).toContain("stamped 150");
  });

  it("says nothing about a hash it cannot compute", () => {
    expect(ledgerDivergence(j, new Map(), [{ hash: "whatever", created_at: 100 }])).toEqual([]);
  });
});

describe("findSecretsInBundle, against the real thing", () => {
  /**
   * **The exact bytes from the live bundle, 2026-08-27.**
   *
   * The first version of this function reported a secret key in production
   * within a minute of being pointed at it. This is what it matched: supabase-js
   * checking a *prefix*, carrying no key whatever. A security check that cries
   * wolf is worse than none — the second time it fires nobody looks — so the
   * string that caused it is pinned here rather than described.
   */
  const SUPABASE_JS_PREFIX_CHECK =
    "var eg=e=>e.startsWith(`sb_publishable_`)||e.startsWith(`sb_secret_`),tg=`sb_temp_`";

  it("does not call supabase-js's own prefix check a leaked key", () => {
    expect(findSecretsInBundle(SUPABASE_JS_PREFIX_CHECK)).toEqual([]);
  });

  it("still catches a real key sitting next to that very code", () => {
    const withKey = `${SUPABASE_JS_PREFIX_CHECK};const k="sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";`;
    expect(findSecretsInBundle(withKey)).toContain("an sb_secret_… key");
  });

  it("ignores a prefix too short to be key material", () => {
    expect(findSecretsInBundle('"sb_secret_abc"')).toEqual([]);
  });
});

describe("a bucket that has drifted from the file describing it", () => {
  /* **This is the check that would have caught
     docs/postmortems/260828a-the-config-file-is-not-the-bucket.md**, where
     `supabase/config.toml` was edited to add `text/html`, the running bucket
     kept saying `{application/pdf}`, and every HTML fetch threw a 415 for seven
     hours. Nothing reconciles the file with a bucket that already exists — not
     on the remote and not on a laptop.

     Every case below is a *positive*: the function is seen to say yes. That is
     the whole reason `bucketDrift` is pure and lives in this file
     (docs/reusable/silent-success.md), and it is exactly what the bug was
     missing — a check that had only ever been observed to say nothing. */

  const SOURCES: DeclaredBucket = {
    name: "sources",
    public: false,
    fileSizeLimit: 52_428_800,
    allowedMimeTypes: ["application/pdf", "text/html"],
  };
  const running = (over: Partial<RunningBucket> = {}): RunningBucket[] => [
    {
      id: "sources",
      public: false,
      file_size_limit: 52_428_800,
      allowed_mime_types: ["application/pdf", "text/html"],
      ...over,
    },
  ];

  it("says nothing when they agree", () => {
    expect(bucketDrift([SOURCES], running())).toEqual([]);
  });

  it("does not mind the order of the mime list", () => {
    /* A reordering is not a change, and reporting one would make the check cry
       wolf — which is how a check gets deleted. */
    expect(bucketDrift([SOURCES], running({ allowed_mime_types: ["text/html", "application/pdf"] })))
      .toEqual([]);
  });

  it("catches the exact drift that broke every HTML fetch", () => {
    const [problem] = bucketDrift([SOURCES], running({ allowed_mime_types: ["application/pdf"] }));
    expect(problem).toContain("does not accept text/html");
  });

  it("catches a bucket that is wider than the file allows", () => {
    const [problem] = bucketDrift(
      [SOURCES],
      running({ allowed_mime_types: ["application/pdf", "text/html", "image/png"] }),
    );
    expect(problem).toContain("accepts image/png, which the file does not allow");
  });

  it("catches a bucket enforcing nothing while the file says it enforces something", () => {
    /* `null` means *anything goes*, and it is the state a hand-created bucket
       most easily ends up in. */
    const [problem] = bucketDrift([SOURCES], running({ allowed_mime_types: null }));
    expect(problem).toContain("accepts any type");
  });

  it("catches a bucket that has never been created", () => {
    const [problem] = bucketDrift([SOURCES], []);
    expect(problem).toContain("does not exist");
    expect(problem, "and says why declaring it was not enough").toContain(
      "declaring it does not create it",
    );
  });

  it("catches a private bucket that has gone public", () => {
    expect(bucketDrift([SOURCES], running({ public: true }))[0]).toContain(
      "is public and the file says private",
    );
  });

  it("catches a size limit that has moved", () => {
    expect(bucketDrift([SOURCES], running({ file_size_limit: 1024 }))[0]).toContain(
      "allows 1024 and the file says 52428800",
    );
  });

  it("treats a missing size limit as no limit, not as unknown", () => {
    expect(bucketDrift([SOURCES], running({ file_size_limit: null }))[0]).toContain("any size");
  });

  it("ignores a bucket the file has no opinion about", () => {
    /* A Supabase project carries buckets this repo did not put there, and a
       check that complained about them would be a check nobody runs. */
    const other: RunningBucket = {
      id: "avatars",
      public: true,
      file_size_limit: null,
      allowed_mime_types: null,
    };
    expect(bucketDrift([SOURCES], [...running(), other])).toEqual([]);
  });

  it("reports every bucket, not just the first that is wrong", () => {
    const second: DeclaredBucket = { ...SOURCES, name: "elsewhere" };
    expect(bucketDrift([SOURCES, second], running({ public: true }))).toHaveLength(2);
  });
});

describe("reading the bucket blocks out of supabase/config.toml", () => {
  /* **The fixture is the repository.** A parser tested only against strings it
     was written from is a parser that agrees with its author; running it over
     the real file means a change to the config's shape shows up here rather
     than as a bucket check that quietly stops seeing a bucket. */
  const CONFIG = readFileSync(
    path.join(import.meta.dirname, "..", "supabase", "config.toml"),
    "utf8",
  );

  it("finds the sources bucket exactly as the file declares it", () => {
    const buckets = declaredBuckets(CONFIG);
    expect(buckets.find((b) => b.name === "sources")).toEqual({
      name: "sources",
      public: false,
      fileSizeLimit: 52_428_800,
      allowedMimeTypes: [
        "application/pdf",
        "text/html",
        "image/png",
        "image/jpeg",
        "image/gif",
      ],
    });
  });

  it("finds every bucket the file declares, and nothing else", () => {
    /* If this number changes, somebody added a bucket — and the point of the
       check is that a declared bucket is not a created one. */
    const declared = declaredBuckets(CONFIG).map((b) => b.name);
    expect(declared).toEqual([...new Set(declared)]);
    expect(declared).toContain("sources");
  });

  it("ignores the commented-out example the file ships with", () => {
    /* The template section above holds a whole commented bucket:
       `# [storage.buckets.images]` with `# allowed_mime_types = ["image/png",
       "image/jpeg"]`. A parser that read commented lines would declare a bucket
       nobody asked for.

       **This assertion used to be `no declared bucket includes image/jpeg`, and
       that stopped meaning anything on 2026-08-29**, when `sources` legitimately
       started accepting `image/jpeg`. The needle was shared between the thing
       under test and a real declaration, so it could no longer tell a parser
       that ignores comments from one that reads them — it would have passed
       either way, for ever. The name is the part only the comment has. */
    expect(declaredBuckets(CONFIG).map((b) => b.name)).not.toContain("images");
  });

  it("really does skip a commented bucket, on a fixture of exactly one", () => {
    /* Independent of what the real file happens to contain, so this cannot be
       blunted the way the assertion above was. If the parser ever reads
       comments, this is a bucket appearing out of nothing.

       **What actually protects is the anchored header regex, not the `#`
       skip.** Both were probed: deleting `line.startsWith("#")` reddens
       nothing, because `# [storage.buckets.x]` cannot match `/^\[...\]$/`
       either way — that line is an early-out, not a guard. Unanchoring the
       header regex reddens this test and the one above. Worth knowing before
       anyone "tidies up" the anchors on the grounds that comments are already
       filtered. */
    const commented = [
      "# [storage.buckets.ghost]",
      '# public = false',
      '# allowed_mime_types = ["image/png"]',
      "",
      "[storage.buckets.real]",
      "public = false",
    ].join("\n");
    expect(declaredBuckets(commented).map((b) => b.name)).toEqual(["real"]);
  });

  it("reads a size in bytes, and in each unit", () => {
    const of = (v: string) =>
      declaredBuckets(`[storage.buckets.x]\nfile_size_limit = ${v}\n`)[0]?.fileSizeLimit;
    expect(of('"50MiB"')).toBe(52_428_800);
    expect(of('"1KiB"')).toBe(1024);
    expect(of("1024")).toBe(1024);
    expect(of('"1MB"')).toBe(1_000_000);
  });

  it("throws on a unit it does not know, rather than reporting no drift", () => {
    /* The failure this whole check exists to stop is a check that says nothing
       about a thing it could not read. */
    expect(() =>
      declaredBuckets('[storage.buckets.x]\nfile_size_limit = "50 furlongs"\n'),
    ).toThrow(/cannot read the size/);
  });

  it("throws on a mime list it cannot read", () => {
    expect(() => declaredBuckets("[storage.buckets.x]\nallowed_mime_types = [oops]\n")).toThrow(
      /not valid TOML/,
    );
  });

  it("throws on a list holding something that is not a mime type", () => {
    /* Valid TOML, wrong contents — the case a parser gets right and a type
       check has to catch afterwards. */
    expect(() => declaredBuckets("[storage.buckets.x]\nallowed_mime_types = [1, 2]\n")).toThrow(
      /allowed_mime_types/,
    );
  });

  it("throws on an assignment it cannot parse, rather than defaulting it", () => {
    /* **A gate that fails open on a file it could not read.** The hand-written
       parser did `if (!pair) continue` on any line its regex missed, and then
       flush() supplied `public: false`, `fileSizeLimit: null`,
       `allowedMimeTypes: null` — the defaults. So this block parsed as
       private/unlimited/any-MIME, compared equal to a bucket in exactly that
       state, and the deploy gate recorded "no drift" about a config file it had
       not understood a single line of. GPT Sol reproduced it, 2026-09-03; it is
       the same class as the 415, where a check printed a tick about something
       other than the thing it was asked about. */
    const empties = ["[storage.buckets.sources]", "public =", "file_size_limit =", "allowed_mime_types ="].join("\n");
    expect(() => declaredBuckets(empties)).toThrow(/not valid TOML/);
  });

  it("throws on a value of the wrong type rather than reading it as false", () => {
    /* `value === "true"` made every non-`true` spelling of `public` a silent
       `false`, including `"yes"` and `1`. */
    expect(() => declaredBuckets('[storage.buckets.x]\npublic = "yes"\n')).toThrow(/public/);
  });

  it("defaults a bucket that declares nothing to private with no limits", () => {
    expect(declaredBuckets("[storage.buckets.bare]\n")).toEqual([
      { name: "bare", public: false, fileSizeLimit: null, allowedMimeTypes: null },
    ]);
  });

  it("stops reading a bucket at the next section header", () => {
    /* A key belonging to `[storage.s3_protocol]` must not be attributed to the
       bucket above it — which is exactly what the real file has after
       `[storage.buckets.sources]`. */
    const parsed = declaredBuckets(
      '[storage.buckets.a]\npublic = false\n\n[storage.s3_protocol]\npublic = true\n',
    );
    expect(parsed).toEqual([
      { name: "a", public: false, fileSizeLimit: null, allowedMimeTypes: null },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* The gate's own fixtures, and the checks that run after the push     */
/* ------------------------------------------------------------------ */

describe("the fixtures the gate worktree needs before its tests mean anything", () => {
  const has =
    (...present: string[]) =>
    (rel: string) =>
      present.includes(rel);

  /* The bug this list replaced: bare "data" and "output" directory checks
     that could never fail once reader state moved to live inside `data/`
     too. This is that exact broken state — every article artefact gone,
     the reader's own files (chat, comments, searches, shelf,
     glossary-lookups) still there, so `data/writes/` and `data/constitution/`
     go on existing and non-empty. The old `["data", "output", …]` list
     reported `missing: []` against it; named sentinel files do not. */
  it("fails when reader state survives but the article's own files do not", () => {
    const readerStateOnly = has(
      /* **The two bare directory names are in this list on purpose, and they
         are what makes the test able to fail.** They are exactly what survives:
         reader state lives under `data/<slug>/`, and `output/` holds years of
         script scratch besides. Leave them out and the old `["data", "output",
         …]` list reports those two missing, which is indistinguishable from it
         working. GPT Sol, 2026-08-29. */
      "tests/fixtures/data-root/data",
      "tests/fixtures/data-root/output",
      "tests/fixtures/data-root/data/writes/chat.json",
      "tests/fixtures/data-root/data/writes/comments.json",
      "tests/fixtures/data-root/data/writes/searches.json",
      "tests/fixtures/data-root/data/writes/shelf.json",
      "tests/fixtures/data-root/data/writes/glossary-lookups.json",
      "tests/fixtures/data-root/data/constitution/chat.json",
      "tests/fixtures/data-root/output/writes.html",
      "tests/fixtures/data-root/output/writes.blocks.json",
    );
    /* **Spelled out, not derived from `GATE_FIXTURES`.** An expectation
       computed from the list under test agrees with any list, including the one
       this test exists to reject — and including a future list that has quietly
       lost a sentinel. */
    expect(missingGateFixtures(readerStateOnly)).toEqual([
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
    ]);
  });

  /* The historical incident, 2026-08-28: copying only data/ (with its
     artefacts intact) produced 13 ENOENTs and 202 cascade-skips, because
     output/ — the other half of the artefact store — was never copied at
     all, and `--force-gate=test` became the only way anyone deployed. */
  it("names the output artefacts when only data/ was copied", () => {
    const dataOnly = has(...GATE_FIXTURES.filter((f) => f.includes("/data/")));
    expect(missingGateFixtures(dataOnly)).toEqual([
      "tests/fixtures/data-root/output/writes.html",
      "tests/fixtures/data-root/output/writes.blocks.json",
    ]);
  });

  it("passes when every fixture is there", () => {
    expect(missingGateFixtures(has(...GATE_FIXTURES))).toEqual([]);
  });

  /* **The point of the whole exercise, asserted rather than assumed.** These
     sentinels used to be `data/writes/…` — the developer's own gitignored
     scratch store — so the gate really asked "did whoever is deploying happen to
     have run the pipeline on this laptop", and could not pass in a fresh clone.
     A sentinel that drifts back outside the tracked corpus silently restores
     that, and nothing else here would notice: every test above is about which
     files are named, not about where they live.
     docs/plans/260901b-committed-fixture-corpus.md. */
  it("names only tracked files, so the gate asks about the commit and not the laptop", () => {
    expect(GATE_FIXTURES.filter((f) => !f.startsWith(`${GATE_FIXTURE_ROOT}/`))).toEqual([]);
  });

  /* And that the corpus really is tracked, which is the claim the rewrite rests
     on and the one thing no amount of list-shaped testing can see. `.gitignore`
     carries unanchored `data/` and `output/` lines, and those match a directory
     of that name **at any depth** — so `tests/fixtures/data-root/data/` was
     ignored by default, and `git add <dir>` skips ignored files without a word.
     A corpus that was "committed" and is not in the commit leaves every check
     above green and puts the gate straight back to asking about the laptop.

     `git ls-files` rather than `git check-ignore`, because tracked beats ignored
     and tracked is the actual question. */
  it("names files git is actually carrying", () => {
    const listed = spawnSync("git", ["ls-files", "-z", "--", ...GATE_FIXTURES], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    expect(listed.status).toBe(0);
    const tracked = new Set(listed.stdout.split("\0").filter(Boolean));
    expect(GATE_FIXTURES.filter((f) => !tracked.has(f))).toEqual([]);
  });
});

describe("the smoke line the deploy knows it caused", () => {
  const smoke = "/api/__deploy-smoke__/dpl_THIS";

  /* The bug this replaces: `includes("__deploy-smoke__")`. A smoke request from
     the PREVIOUS deployment, sitting in the same time window, satisfied it — so
     the check reported that this deployment had logged when it had not. The
     whole reason the path carries a deployment id is to make that impossible. */
  it("rejects the smoke line of a different deployment", () => {
    const lines = [{ requestPath: "/api/__deploy-smoke__/dpl_OTHER" }];
    expect(sawSmokeLine(lines, smoke)).toBe(false);
  });

  it("finds it on requestPath", () => {
    expect(sawSmokeLine([{ requestPath: smoke }], smoke)).toBe(true);
  });

  /* Vercel has supplied both shapes; the path is inside our own pino line when
     requestPath is absent. */
  it("finds it inside the message body", () => {
    const lines = [{ message: `{"level":"warn","path":"${smoke}","status":401}` }];
    expect(sawSmokeLine(lines, smoke)).toBe(true);
  });

  it("does not mistake a near-miss path for it", () => {
    expect(sawSmokeLine([{ requestPath: "/api/health" }], smoke)).toBe(false);
  });
});

describe("what a vercel logs invocation actually told us", () => {
  const uid = "dpl_THIS";

  /* The four outcomes used to be two. A CLI that failed to authenticate, a
     network error and a genuinely quiet deployment all arrived as "returned
     nothing" — so a poll built on the old reading would have patiently re-run a
     command that could never work, and called the result a quiet app. */
  it("reports a non-zero exit as a broken check, not an empty log", () => {
    const q = readLogQuery(1, "Error: not authenticated\n", uid);
    expect(q.kind).toBe("commandFailed");
    expect(q.kind === "commandFailed" && q.detail).toContain("not authenticated");
  });

  it("does not treat lines emitted before a failure as a successful read", () => {
    const q = readLogQuery(1, `{"id":"a","deploymentId":"${uid}"}\nboom\n`, uid);
    expect(q.kind).toBe("commandFailed");
  });

  it("reports JSON-shaped output that will not parse, rather than dropping it", () => {
    const q = readLogQuery(0, '{"id":"a", TRUNCATED\n{"id":"b", ALSO\n', uid);
    expect(q.kind).toBe("unparsable");
    expect(q.kind === "unparsable" && q.detail).toContain("2");
  });

  it("calls a clean run with no rows empty", () => {
    expect(readLogQuery(0, "Fetching logs...\n", uid).kind).toBe("empty");
  });

  it("keeps only this deployment's rows", () => {
    const out = [
      `{"id":"a","deploymentId":"${uid}","message":"mine"}`,
      '{"id":"b","deploymentId":"dpl_OTHER","message":"theirs"}',
    ].join("\n");
    const q = readLogQuery(0, out, uid);
    expect(q.kind).toBe("lines");
    expect(q.kind === "lines" && q.lines.map((l) => l.message)).toEqual(["mine"]);
  });

  it("is empty, not lines, when every row belongs to another deployment", () => {
    const out = '{"id":"b","deploymentId":"dpl_OTHER"}';
    expect(readLogQuery(0, out, uid).kind).toBe("empty");
  });
});

describe("whether a failure means the code might not be live", () => {
  /* The bug: this exclusion was the single literal "errors in the log", and the
     log-READ failure is recorded as "read this deployment's logs". So an
     unreadable log printed SCHEMA ADVANCED; CODE MAY NOT HAVE over a deployment
     that had just passed nine liveness checks, and offered a rollback for it. */
  it("does not blame the code when only the log could not be read", () => {
    expect(codeMayNotHaveShipped(["read this deployment's logs"])).toBe(false);
  });

  it("does not blame the code when the smoke line was missing from the log", () => {
    expect(codeMayNotHaveShipped(["the log contains the request this script made"])).toBe(false);
  });

  it("does not blame the code for errors found in the log", () => {
    expect(codeMayNotHaveShipped(["errors in the log"])).toBe(false);
  });

  it("does blame the code when a check before the push failed", () => {
    expect(codeMayNotHaveShipped(["read this deployment's logs", "build"])).toBe(true);
  });

  it("is false for a clean run", () => {
    expect(codeMayNotHaveShipped([])).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* After the migrator returns                                          */
/* ------------------------------------------------------------------ */

/**
 * **The bug this replaced.** `applyMigrations` used to verify its own work by
 * counting ledger rows — `moved === plan.pending.length` — and a count cannot
 * tell one migration from another. If a second machine applied the pending
 * migration in the gap, this run applied nothing, watched the count move by
 * exactly the number it expected, and reported success. The same arithmetic
 * passes when a *different* migration lands, which is worse.
 *
 * Every case below is built so the counting version would have been happy.
 */
describe("postApplyProblems", () => {
  const want = (created_at: number, hash: string, tag: string) => ({ created_at, hash, tag });
  const got = (created_at: number, hash: string) => ({ created_at, hash });

  it("is silent when every migration the commit needs is in the ledger", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    expect(postApplyProblems(expected, [got(1, "aa"), got(2, "bb")])).toEqual([]);
  });

  it("catches a different migration landing while the count still adds up", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    const after = [got(1, "aa"), got(2, "zz")];

    /* The counting check's exact arithmetic, so the control is explicit rather
       than asserted in prose: two rows before, two after, one pending applied. */
    expect(after).toHaveLength(expected.length);

    expect(postApplyProblems(expected, after).join(" ")).toContain("0002_b");
  });

  it("catches the migrator returning 0 having applied nothing", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b")];
    expect(postApplyProblems(expected, [got(1, "aa")]).join(" ")).toContain("0002_b");
  });

  it("names every missing migration, not just the first", () => {
    const expected = [want(1, "aa", "0001_a"), want(2, "bb", "0002_b"), want(3, "cc", "0003_c")];
    const problems = postApplyProblems(expected, [got(1, "aa")]).join(" ");
    expect(problems).toContain("0002_b");
    expect(problems).toContain("0003_c");
  });

  /**
   * A row the commit has never heard of is not this check's business — a
   * concurrent deploy of a *newer* commit would leave one, and failing here
   * would turn a race into a false alarm about the migrations that did land.
   * `migrationPlan`'s ledger-ahead refusal is what owns that question.
   */
  it("ignores a ledger row this commit does not know about", () => {
    const expected = [want(1, "aa", "0001_a")];
    expect(postApplyProblems(expected, [got(1, "aa"), got(9, "zz")])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* The test gate's list of failures                                    */
/* ------------------------------------------------------------------ */

describe("failingTestsFromReport", () => {
  /* The shape vitest 4.1.11's own `json` reporter wrote for scratch files: one
     with a nested failing test, a top-level failing test and a passing one; one
     whose import failed, so it has a message and no assertions at all. */
  const TREE = "/tmp/gate/tree";
  const report = JSON.stringify({
    numFailedTests: 2,
    success: false,
    testResults: [
      {
        name: `${TREE}/tests/a.test.ts`,
        status: "failed",
        message: "",
        assertionResults: [
          { ancestorTitles: ["outer", "inner"], title: "fails here", status: "failed" },
          { ancestorTitles: ["outer"], title: "passes", status: "passed" },
          { ancestorTitles: [], title: "top-level fails", status: "failed" },
        ],
      },
      {
        name: `${TREE}/tests/b.test.ts`,
        status: "failed",
        message: `Cannot find module './gone.js' imported from ${TREE}/tests/b.test.ts\nmore detail`,
        assertionResults: [],
      },
      {
        name: `${TREE}/tests/c.test.ts`,
        status: "passed",
        message: "",
        assertionResults: [{ ancestorTitles: [], title: "fine", status: "passed" }],
      },
    ],
  });

  it("lists every failing test, file > describe > test, and a file that failed to load", () => {
    expect(failingTestsFromReport(report, TREE)).toEqual({
      ok: true,
      failing: [
        "tests/a.test.ts > outer > inner > fails here",
        "tests/a.test.ts > top-level fails",
        "tests/b.test.ts > (failed outside a test: Cannot find module './gone.js' imported from tests/b.test.ts)",
      ],
    });
  });

  it("says so when there is no report, rather than listing nothing", () => {
    expect(failingTestsFromReport(null, TREE).ok).toBe(false);
  });

  it("says so when the report is not JSON vitest wrote", () => {
    expect(failingTestsFromReport("{not json", TREE).ok).toBe(false);
    expect(failingTestsFromReport("null", TREE).ok).toBe(false);
    expect(failingTestsFromReport(JSON.stringify({ hello: 1 }), TREE).ok).toBe(false);
    expect(
      failingTestsFromReport(JSON.stringify({ numFailedTests: 0, testResults: [null] }), TREE).ok,
    ).toBe(false);
  });

  it("does not present a partial list when vitest's failure count disagrees", () => {
    const incomplete = JSON.parse(report);
    incomplete.numFailedTests = 3;
    expect(failingTestsFromReport(JSON.stringify(incomplete), TREE)).toEqual({
      ok: false,
      why: "vitest's JSON report says 3 test(s) failed but names 2",
    });
  });

  it("does not mistake a suite-hook failure for a file-load failure", () => {
    const hook = JSON.stringify({
      numFailedTests: 0,
      success: false,
      testResults: [
        {
          name: `${TREE}/tests/hook.test.ts`,
          status: "failed",
          message: "",
          assertionResults: [{ ancestorTitles: ["outer"], title: "never ran", status: "skipped" }],
        },
      ],
    });
    expect(failingTestsFromReport(hook, `${TREE}/`)).toEqual({
      ok: true,
      failing: ["tests/hook.test.ts > (failed outside a test: see full vitest output)"],
    });
  });

  it("an all-green report is an empty list, not an error", () => {
    const green = JSON.stringify({ numFailedTests: 0, success: true, testResults: [] });
    expect(failingTestsFromReport(green, TREE)).toEqual({ ok: true, failing: [] });
  });
});

/* ------------------------------------------------------------------ */
/* What the gate builds before it tests                                */
/* ------------------------------------------------------------------ */

describe("GATE_TOOLING_BUILDS", () => {
  const repo = path.resolve(import.meta.dirname, "..");

  function requestedBuilds(source: string): string[] {
    const ast = parseSource(source);
    const errors = ast.errors ?? [];
    if (errors.length > 0) {
      throw new Error(`could not parse a test while looking for build requirements: ${errors[0]?.message}`);
    }
    const found = new Set<string>();
    walkAst(ast.program, (node) => {
      let value: string | undefined;
      if (node.type === "StringLiteral" && typeof node.value === "string") {
        value = node.value;
      } else if (node.type === "TemplateElement") {
        const cooked = (node.value as { cooked?: unknown } | undefined)?.cooked;
        if (typeof cooked === "string") value = cooked;
      }
      if (value === undefined) return;
      for (const match of value.matchAll(/`npm run (build(?:[:][\w.-]+)*)`/g)) {
        if (match[1] !== undefined) found.add(match[1]);
      }
    });
    return [...found];
  }

  it("reads runtime hints, not comments that merely discuss a build", () => {
    const source = [
      "/* run `npm run build:comment-only` first */",
      'throw new Error("run `npm run build:one:two` first");',
    ].join("\n");
    expect(requestedBuilds(source)).toEqual(["build:one:two"]);
  });

  /* The suite says what it needs built in its own failure messages — "run
     `npm run build:fleet` first" — so read the demand from there rather than
     from a list somebody has to remember. The gate's worktree is a fresh
     checkout: a build the suite asks for that the gate never runs is a set of
     reds no commit can fix. On 2026-09-29 that was three fleet tests, and the
     deploy's test gate could not go green anywhere. */
  it("runs every build the test suite asks for", () => {
    const self = path.join(repo, "tests", "deploy-checks.test.ts");
    const asked = new Set<string>();
    for (const rel of readdirSync(path.join(repo, "tests"), { recursive: true, encoding: "utf8" })) {
      const file = path.join(repo, "tests", rel);
      if (file === self || !/\.(ts|tsx)$/.test(rel)) continue;
      const source = readFileSync(file, "utf8");
      if (!source.includes("npm run build")) continue;
      for (const script of requestedBuilds(source)) asked.add(script);
    }
    /* A control: the scan must find the hints it is known to have, or an empty
       set passes this test by finding nothing. */
    expect(asked).toContain("build");
    expect(asked).toContain("build:fleet");

    const run = new Set<string>(SUITE_BUILDS);
    expect([...asked].filter((s) => !run.has(s))).toEqual([]);
  });

  it("names only scripts package.json has", () => {
    const scripts = JSON.parse(readFileSync(path.join(repo, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(GATE_TOOLING_BUILDS.filter((b) => !Object.hasOwn(scripts, b.script))).toEqual([]);
  });
});

/**
 * **What `scripts/deploy.ts` § `verifyRobots` says about the file a host
 * served.** A crawler reads groups: a bot obeys the one naming it and inherits
 * nothing from `*`. So a `Disallow: /` somewhere in the file says nothing about
 * who it restricts. GPT Sol reproduced the first case on 2026-10-06, against
 * the per-line check this replaced; the comments-only case is the control from
 * docs/postmortems/261005j-keyword-checks-accept-comments-as-restrictions.md.
 */
describe("judgeServedRobots", () => {
  const shipped = readFileSync(path.resolve(import.meta.dirname, "..", "public", "robots.txt"), "utf8");

  /* A stricter gate that rejected the real file would block every deploy. */
  it("passes the file we ship, as Vercel serves it", () => {
    expect(judgeServedRobots(200, "text/plain; charset=utf-8", shipped)).toEqual([]);
  });

  it("accepts CRLF and CR line endings, including comments between groups", () => {
    for (const ending of ["\r\n", "\r"]) {
      expect(judgeServedRobots(200, "text/plain; charset=utf-8", shipped.replaceAll("\n", ending))).toEqual([]);
    }
  });

  it("fails a file that restricts one named bot and leaves every other crawler unrestricted", () => {
    const twitterbotOnly = "User-agent: *\nAllow: /\n\nUser-agent: Twitterbot\nDisallow: /\n";
    expect(judgeServedRobots(200, "text/plain", twitterbotOnly)).not.toEqual([]);
    expect(judgeServedRobots(200, "text/plain", "User-agent: *\n\nUser-agent: Twitterbot\nDisallow: /\n")).not.toEqual([]);
  });

  it("fails the shipped file with the `*` group's own Disallow taken out, and says which group", () => {
    const lines = shipped.split("\n");
    lines.splice(lines.indexOf("Disallow: /"), 1);
    const problems = judgeServedRobots(200, "text/plain", lines.join("\n"));
    expect(problems.join("\n")).toMatch(/User-agent: \*/);
  });

  it("fails the SPA shell answering for it, a non-200, and comments that only mention the rule", () => {
    expect(judgeServedRobots(200, "text/html; charset=utf-8", "<!doctype html><title>Spideryarn</title>")).not.toEqual([]);
    expect(judgeServedRobots(200, "text/plain", "<!doctype html><title>Spideryarn</title>")).not.toEqual([]);
    expect(judgeServedRobots(404, "text/plain", shipped)).toEqual(["answered 404"]);
    const commentsOnly = shipped.split("\n").filter((line) => !/^Disallow:/i.test(line.trim())).join("\n");
    expect(commentsOnly).toMatch(/disallow/i);
    expect(judgeServedRobots(200, "text/plain", commentsOnly)).not.toEqual([]);
  });
});
