/**
 * Which commit produced this build — resolved once, at build time, by whoever
 * is building.
 *
 * Used by both vite configs: `vite.config.ts` writes it into `dist/build.json`
 * for the client, and `vite.api.config.ts` compiles it into the serverless
 * function, which reports it from `/api/health`. `scripts/deploy.ts` then
 * asserts that both halves say the commit it just pushed.
 *
 * ## Why this exists rather than reading an environment variable at runtime
 *
 * `/api/health` already reports `process.env.VERCEL_GIT_COMMIT_SHA`, and that
 * is not the same fact. It is read **when the request arrives**, and it says
 * what Vercel believes triggered the build — not what compiled. Two ways they
 * come apart, and both are the kind that answer confidently:
 *
 *  - a `vercel deploy` from a working directory has no git ref attached, so the
 *    variable is simply absent while the deployment is perfectly real;
 *  - the variable is a property of the deployment, so it reports the new commit
 *    whatever the build actually did with the code.
 *
 * A stamp compiled *into* the artefact can only be wrong by the artefact being
 * wrong. docs/plans/260827v-deploy-pipeline.md § The build stamp.
 *
 * ## Why the commit is resolved twice rather than passed between the builds
 *
 * The client build and the API build are two processes, and an earlier draft
 * had `vercel.json` compute the stamp once in the shell and export it to both.
 * That is one more thing to get wrong — parameter expansion in whatever shell
 * Vercel uses, and a `git` that may not be on the build image — in exchange for
 * a guarantee we do not need.
 *
 * **The commit is deterministic**, so two processes resolving it independently
 * get the same answer or the build is already broken. `builtAt` is not, and is
 * deliberately never compared: it is there to answer "is this bundle older than
 * the day I changed that environment variable", which is a question about
 * roughly-when, not about exactly-when.
 */

import { execFileSync } from "node:child_process";

export interface BuildStamp {
  /** Full 40-character sha, or `"unknown"`. Never a short sha — see `sameCommit`. */
  commit: string;
  /**
   * The deployment this artefact was built for, or `null` off Vercel.
   *
   * **Stronger than the commit, and it is why this field exists.** A commit can
   * be deployed twice — a redeploy, a retried build — and every commit-based
   * check passes over the wrong one of the two. A deployment id is unique to
   * one build, so it is what proves the bytes answering came from *this* run
   * rather than from a previous one that happened to share a sha. It also makes
   * an edge-cached response detectable, since the cached copy carries the id of
   * the deployment that produced it.
   */
  deploymentId: string | null;
  /** ISO 8601. Informational only; never asserted against anything. */
  builtAt: string;
  /** Where `commit` came from, so a surprising value is diagnosable. */
  source: "SPIDERYARN_BUILD_COMMIT" | "VERCEL_GIT_COMMIT_SHA" | "git" | "unknown";
}

/**
 * The three places a commit can come from, in order of how much they know.
 *
 * `SPIDERYARN_BUILD_COMMIT` first so that a caller who genuinely knows better —
 * `scripts/deploy.ts` building a worktree of a specific sha, where `git
 * rev-parse HEAD` in the *main* tree would answer about a different commit —
 * can say so. It is not set in normal use.
 *
 * `git` last rather than never, because it is the only one that exists on a
 * laptop, and a local `npm run build` that stamped `"unknown"` would make the
 * dev path different from the deployed one for no reason.
 */
export function resolveBuildStamp(env: NodeJS.ProcessEnv = process.env): BuildStamp {
  const builtAt = new Date().toISOString();
  const deploymentId = env.VERCEL_DEPLOYMENT_ID?.trim() || null;
  const base = { builtAt, deploymentId };

  const explicit = env.SPIDERYARN_BUILD_COMMIT?.trim();
  if (explicit) return { ...base, commit: explicit, source: "SPIDERYARN_BUILD_COMMIT" };

  const fromVercel = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromVercel) return { ...base, commit: fromVercel, source: "VERCEL_GIT_COMMIT_SHA" };

  try {
    /* `execFileSync`, not `exec`: no shell, so nothing here can be a quoting
       bug. `stdio` silences git's own stderr — "not a git repository" is an
       expected answer on a build machine that was handed an upload rather than
       a clone, not something to print. */
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha) return { ...base, commit: sha, source: "git" };
  } catch {
    /* Falls through to unknown. */
  }

  return { ...base, commit: "unknown", source: "unknown" };
}

/**
 * Do two stamps name the same commit?
 *
 * **`"unknown"` never matches, including itself.** Two builds that both failed
 * to work out what they were would otherwise compare equal, and the check that
 * exists to prove the deployed artefacts came from the sha you pushed would
 * pass over two artefacts that have no idea. A comparison whose commonest
 * failure mode returns `true` is worse than no comparison.
 *
 * Short shas compare against long ones by prefix, because `git rev-parse
 * --short` and Vercel's dashboard both abbreviate, and a caller holding one of
 * those is asking a reasonable question. Seven characters is the floor: below
 * that a prefix match stops meaning anything.
 */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a?.trim().toLowerCase();
  const y = b?.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === "unknown" || y === "unknown") return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 7) return false;
  return long.startsWith(short);
}

/**
 * The client variables whose absence produces a blank page and no error.
 *
 * `src/web/lib/supabase.ts` throws at module load without them, so a bundle
 * built without them renders nothing and logs nothing — which is what
 * `www.spideryarn.com` was for a few hours on 2026-08-27. They are compiled in
 * at **build** time, so setting them afterwards changes nothing until the next
 * build, and every server-side signal stays green over the blank page because
 * what `/api/health` can see is the current project setting rather than what
 * went into the bundle.
 *
 * A function here, rather than four lines inside the vite plugin that calls it,
 * so that it can be shown to fail without needing a build: the plugin only runs
 * on Vercel, and on a laptop `loadEnvLocal()` repopulates both variables from
 * `.env.local` before any check could see them missing. A guard that cannot be
 * made to fire is not yet a guard — docs/reusable/silent-success.md.
 */
export function missingClientEnv(env: NodeJS.ProcessEnv): string[] {
  return ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"].filter((name) => !env[name]?.trim());
}
