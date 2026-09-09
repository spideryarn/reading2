/**
 * **The three read-only questions this box can answer about production without a
 * Vercel token**, each with an arm for "we could not look".
 *
 * ## Why git at all
 *
 * The deploy record (`src/web/changelog-versions.ndjson`) is written by a job
 * Greg runs by hand, so it lags. Git is the one source on this box that is
 * always current: `main` is written only by `npm run deploy`, so `origin/main`
 * is production's tip as far as this checkout knows, and the distance from the
 * newest recorded deploy to that tip is how far behind the record has fallen.
 *
 * ## THIS NEVER FETCHES, AND THAT IS THE DESIGN
 *
 * A dashboard polled from a phone must not write refs in a checkout that eight
 * other agents are editing, and a fetch is network work on every request. So
 * `origin/main` here is **this checkout's view** of production, which may be
 * behind — in practice minutes, because a dozen agents fetch all night, but "in
 * practice fresh" is not a thing to render as "fresh". `lastFetchAtMs` carries
 * the age of that view so the page can say what it is looking at.
 *
 * ## Every failure is an arm, never a throw and never a zero
 *
 * The house discipline (routes-health-history.ts): *we looked and there is
 * nothing* and *we could not look* must never render the same way. Here the
 * temptation is sharper, because every one of these questions has a plausible
 * wrong answer to fall back to — a missing ref could be `0` commits behind, an
 * ancestry check that failed to run could be "not an ancestor". Both would draw
 * a confident, false, reassuring number. So the readings are unions and the
 * panel has to say which it got.
 *
 * ## Spawning
 *
 * `spawnSync` with an argv array and no shell, a timeout on each call, and the
 * only interpolated value is a sha this module re-checks against
 * `/^[0-9a-f]{40}$/` at the point of use — it comes from a file rather than from
 * a caller, but a validation that lives next to the spawn is the one that
 * survives somebody later passing it something else.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";

import type { AncestryReading, CountReading, MainRef } from "./wire.js";

/**
 * The three readings are declared in `wire.ts` and re-exported here, so a caller
 * that wants "what the probe answers" imports it from the probe. One
 * declaration, two doors — the twin types wire.ts's header is about were two
 * declarations.
 */
export type { AncestryReading, CountReading, MainRef };

/** Long enough for a cold cache on a loaded box, short enough not to hang a poll. */
export const GIT_TIMEOUT_MS = 5_000;

const SHA = /^[0-9a-f]{40}$/;

/** The three questions, so a test can answer them without a repository. */
export type GitProbe = {
  mainRef(): MainRef;
  isAncestor(sha: string): AncestryReading;
  countSince(sha: string): CountReading;
};

/** What `git` said, or why it said nothing. */
type GitResult = { ok: true; stdout: string } | { ok: false; why: string };

/**
 * One git call.
 *
 * Distinguishes the four ways it goes wrong, because they need different
 * sentences: git is missing, the call timed out, it exited non-zero (which for
 * `merge-base --is-ancestor` is an ANSWER rather than a fault — see below), and
 * it threw.
 */
function git(repoRoot: string, args: string[], timeoutMs: number): GitResult & { status: number | null } {
  let out;
  try {
    out = spawnSync("git", args, {
      cwd: repoRoot,
      timeout: timeoutMs,
      encoding: "utf8",
      /* No shell, so nothing here is parsed by one. `env` is inherited: git
         needs PATH, and this is a read-only call in a checkout this process
         already lives in. */
      shell: false,
      maxBuffer: 1024 * 1024,
    });
  } catch (err) {
    return { ok: false, why: `git could not be run: ${err instanceof Error ? err.message : String(err)}`, status: null };
  }
  if (out.error) {
    const why =
      (out.error as NodeJS.ErrnoException).code === "ETIMEDOUT"
        ? `git ${args[0]} took longer than ${timeoutMs}ms`
        : `git could not be run: ${out.error.message}`;
    return { ok: false, why, status: null };
  }
  if (out.status !== 0) {
    const stderr = (out.stderr ?? "").trim().split("\n")[0] ?? "";
    return {
      ok: false,
      why: stderr === "" ? `git ${args[0]} exited ${out.status}` : stderr,
      status: out.status,
    };
  }
  return { ok: true, stdout: (out.stdout ?? "").trim(), status: 0 };
}

/**
 * When this checkout last fetched, from `FETCH_HEAD`'s mtime.
 *
 * `FETCH_HEAD` rather than the ref file, because `refs/remotes/origin/main` may
 * be packed into `packed-refs` and then has no mtime of its own — a stat that
 * silently misses would report "never fetched" on a perfectly healthy
 * repository, which is worse than reporting nothing.
 *
 * Both this worktree's gitdir and the shared common dir are stat-ed and the
 * newer wins: a fetch run in any worktree updates that worktree's `FETCH_HEAD`,
 * and the refs it wrote are shared by all of them.
 */
function lastFetchAtMs(repoRoot: string, timeoutMs: number): number | null {
  const dirs: string[] = [];
  for (const flag of ["--git-dir", "--git-common-dir"]) {
    const read = git(repoRoot, ["rev-parse", flag], timeoutMs);
    if (read.ok && read.stdout !== "") {
      dirs.push(path.resolve(repoRoot, read.stdout));
    }
  }
  let newest: number | null = null;
  for (const dir of dirs) {
    try {
      const at = statSync(path.join(dir, "FETCH_HEAD")).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch {
      /* No FETCH_HEAD in this dir. Not an error — a worktree that has never
         fetched is normal, and the other dir may still have one. */
    }
  }
  return newest;
}

/**
 * The real probe, against a checkout on disk.
 *
 * `ref` is a parameter so a test can drive the whole thing against a throwaway
 * repository with no remote, and because naming the branch once is better than
 * spelling `origin/main` in three argv arrays.
 */
export function gitProbe(options: {
  repoRoot: string;
  /** Default `origin/main`, which is production. Never `main`, which is a local branch. */
  ref?: string;
  timeoutMs?: number;
}): GitProbe {
  const repoRoot = options.repoRoot;
  const ref = options.ref ?? "origin/main";
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;

  return {
    mainRef(): MainRef {
      /* One call for both fields: `%H %cI` off the tip. Two calls could
         disagree with each other if somebody fetched between them, which is a
         race that produces a sha and a date from different commits. */
      const read = git(repoRoot, ["log", "-1", "--format=%H %cI", ref], timeoutMs);
      if (!read.ok) return { kind: "unavailable", why: `${ref}: ${read.why}` };
      const [sha, committedAt] = read.stdout.split(" ");
      if (sha === undefined || !SHA.test(sha) || committedAt === undefined) {
        return { kind: "unavailable", why: `${ref}: git answered something unreadable` };
      }
      return { kind: "ref", sha, committedAt, lastFetchAtMs: lastFetchAtMs(repoRoot, timeoutMs) };
    },

    isAncestor(sha): AncestryReading {
      if (!SHA.test(sha)) return { kind: "unknown", why: "not a 40-character sha" };
      const read = git(repoRoot, ["merge-base", "--is-ancestor", sha, ref], timeoutMs);
      if (read.ok) return { kind: "ancestor" };
      /* **EXIT 1 IS THE ANSWER "no", NOT A FAILURE.** Everything else — 128 for
         an unknown sha, a timeout, a missing git — is a failure, and collapsing
         the two would draw "this deploy is not on main", which reads as a
         rollback nobody performed. */
      if (read.status === 1) return { kind: "not-ancestor" };
      return { kind: "unknown", why: read.why };
    },

    countSince(sha): CountReading {
      if (!SHA.test(sha)) return { kind: "unknown", why: "not a 40-character sha" };
      /* `--no-merges` to match the record's own `commit_count`, which drops
         merge commits — every one of them here is a `Merge remote-tracking
         branch 'origin/dev'` carrying no change of its own. A count taken the
         other way would sit next to the record's numbers looking comparable and
         not be. docs/project/changelog.md § Enumerate. */
      const read = git(repoRoot, ["rev-list", "--count", "--no-merges", `${sha}..${ref}`], timeoutMs);
      if (!read.ok) return { kind: "unknown", why: read.why };
      const commits = Number(read.stdout);
      if (!Number.isInteger(commits) || commits < 0) {
        return { kind: "unknown", why: `git answered ${JSON.stringify(read.stdout.slice(0, 40))}` };
      }
      return { kind: "count", commits };
    },
  };
}
