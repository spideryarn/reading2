/**
 * **The sha questions**, answered locally, bounded, and never over the network.
 *
 * Two callers with opposite needs:
 *
 *  - `scripts/readiness-run.ts` stamps the tree it is about to test, twice —
 *    once before the child and once after. That is a short-lived process and
 *    two `spawnSync`s are nothing to it.
 *  - the dashboard needs "is this sha `origin/dev`?" on every poll, and it is a
 *    **single-threaded server**. So the snapshot is computed on a timer and
 *    cached, never inside a request. Under the load this box actually reaches —
 *    load average 391, measured 2026-09-08 — a `git rev-list` blocked on object
 *    IO inside a handler makes the whole diagnostic dashboard unresponsive at
 *    exactly the moment somebody needs it. GPT Sol's P1.8.
 *
 * ## What "on dev" is allowed to claim, which is less than it looks
 *
 * The first draft of the plan proposed reporting the mtime of
 * `refs/remotes/origin/dev` as "last fetched N minutes ago". **That is false in
 * both directions**, and the page must not say it:
 *
 * > `git pack-refs` rewrites `packed-refs` because of an unrelated ref →
 * > another machine pushes a new `dev` → the box's old `origin/dev` value
 * > remains, but `packed-refs` has a recent mtime → an old recorded SHA is
 * > reported as "on dev" against an apparently fresh ref.
 * >
 * > — GPT Sol, 2026-09-09
 *
 * And a fetch in which `dev` did not move touches no mtime at all. A ref file's
 * mtime means *this containing file changed*, never *remote truth was checked*.
 * So {@link DEV_FRESHNESS_CAVEAT} is what the page says instead, and there is no
 * number in it.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

import type { TreeStamp } from "./readiness.js";

/** No git call may hold anything up for longer than this. */
export const GIT_TIMEOUT_MS = 5_000;

/**
 * The sentence the page shows beside "on dev", instead of a freshness it cannot
 * measure. See the header for the two ways ref mtime lies.
 */
export const DEV_FRESHNESS_CAVEAT =
  "matches this box's cached origin/dev — when that was last checked against the remote is not " +
  "knowable from the ref, so a green verdict here is not a claim about what is on the remote now";

type GitRun = { ok: true; out: string } | { ok: false; why: string };

/**
 * One git command, bounded, never throwing.
 *
 * `spawnSync` with a timeout and a small `maxBuffer`: everything here prints one
 * line, and a command that decides to print a megabyte is a command that has
 * misunderstood the question.
 */
function git(cwd: string, args: string[]): GitRun {
  const run = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    /* No pager, no prompts, no credential helper reaching for the network.
       This module is read-only and must stay that way even if someone points
       it at a repository whose config disagrees. */
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  if (run.error) return { ok: false, why: `git ${args[0]}: ${run.error.message}` };
  if (run.status !== 0) {
    const stderr = (run.stderr ?? "").trim().split("\n")[0] ?? "";
    return { ok: false, why: `git ${args[0]} exited ${run.status ?? "on a signal"}${stderr === "" ? "" : `: ${stderr}`}` };
  }
  return { ok: true, out: (run.stdout ?? "").trim() };
}

/**
 * The tree as it is right now, in one directory.
 *
 * ## `dirty` INCLUDES UNTRACKED FILES, and that is not fussiness
 *
 * This used `--untracked-files=no`, on the grounds that a big untracked `data/`
 * makes a full status slow. GPT Sol produced the scenario that kills it:
 *
 * > dev accidentally contains an import of `src/reserved.ts`, but that file was
 * > omitted from the commit. The executing checkout still has `src/reserved.ts`
 * > untracked. `npm run typecheck` passes by reading it. Both stamps say
 * > `dirty: false`. The committed dev tree does not compile, but readiness can
 * > become green.
 *
 * That is not a hypothetical class — it is why `npm run typecheck:committed`
 * exists in this repo at all (`scripts/check.ts` § committed). A stamp used for
 * *voting* has to mean "what is on disk is exactly this commit", and an
 * untracked file that the build reads is a difference from the commit however
 * git chooses to categorise it. `data/` and `logs/` are gitignored, so they do
 * not appear here; a genuinely untracked source file does, which is the point.
 */
export function stampTree(cwd: string): TreeStamp {
  const sha = git(cwd, ["rev-parse", "HEAD"]);
  if (!sha.ok) return { kind: "unknown", why: sha.why };
  if (!/^[0-9a-f]{40}$/.test(sha.out)) {
    return { kind: "unknown", why: `git rev-parse HEAD returned something that is not a sha: ${sha.out.slice(0, 60)}` };
  }
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(cwd, ["status", "--porcelain", "--untracked-files=normal"]);
  return {
    kind: "known",
    sha: sha.out,
    /* `HEAD` is what --abbrev-ref prints on a detached head, which is not a
       branch name and must not be stored as one. */
    branch: branch.ok && branch.out !== "" && branch.out !== "HEAD" ? branch.out : null,
    /* A status we could not take is treated as DIRTY, not clean. An unknown
       tree state must never be the one that lets a run count towards green. */
    dirty: status.ok ? status.out !== "" : true,
  };
}

/**
 * The primary checkout, resolved deliberately.
 *
 * The dashboard runs in whichever directory it was started from, and that may
 * be a worktree whose `HEAD` is somebody's branch. `--git-common-dir` points at
 * the shared `.git`, whose parent is the primary — and remote-tracking refs live
 * there, shared by every worktree, which is why `origin/dev` is the same answer
 * wherever you ask from. GPT Sol's P1.8.
 */
export function primaryCheckout(cwd: string): { path: string } | { why: string } {
  const common = git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) return { why: common.why };
  if (common.out === "") return { why: "git printed no common directory" };
  return { path: dirname(common.out) };
}

/* ------------------------------------------------------------------ *
 * The snapshot the dashboard reads.
 * ------------------------------------------------------------------ */

export type DevSnapshot =
  | {
      kind: "known";
      /** `origin/dev` as this box's git has it. */
      devSha: string;
      /** The primary checkout's own HEAD, and whether it is behind. */
      primarySha: string | null;
      primaryBehind: number | null;
      /** Commits on `dev` that `main` does not have — the trunk gap. */
      trunkGap: number | null;
      /** When this snapshot was taken. NOT when anything was fetched. */
      observedAt: string;
      caveat: string;
    }
  | { kind: "unknown"; why: string; observedAt: string };

export function snapshotDev(cwd: string, nowIso: string): DevSnapshot {
  const primary = primaryCheckout(cwd);
  if ("why" in primary) return { kind: "unknown", why: primary.why, observedAt: nowIso };

  const dev = git(primary.path, ["rev-parse", "origin/dev"]);
  if (!dev.ok) {
    return {
      kind: "unknown",
      why: `${dev.why} — without origin/dev there is nothing to compare a reading against`,
      observedAt: nowIso,
    };
  }

  const head = git(primary.path, ["rev-parse", "HEAD"]);
  const behind = head.ok ? git(primary.path, ["rev-list", "--count", `HEAD..${dev.out}`]) : { ok: false as const, why: "" };
  const gap = git(primary.path, ["rev-list", "--count", "origin/main..origin/dev"]);

  const count = (r: GitRun): number | null => {
    if (!r.ok) return null;
    const n = Number(r.out);
    return Number.isFinite(n) ? n : null;
  };

  return {
    kind: "known",
    devSha: dev.out,
    primarySha: head.ok ? head.out : null,
    primaryBehind: count(behind),
    trunkGap: count(gap),
    observedAt: nowIso,
    caveat: DEV_FRESHNESS_CAVEAT,
  };
}

/* ------------------------------------------------------------------ *
 * Ancestry, cached the one way that does not go stale.
 * ------------------------------------------------------------------ */

export type ShaRelation =
  | { kind: "dev-head" }
  /** An ancestor of dev: it WAS dev's head, and dev has moved on by `behind` commits. */
  | { kind: "behind-dev"; behind: number }
  /** In the repo, but not on dev. A branch, usually somebody else's worktree. */
  | { kind: "not-on-dev" }
  | { kind: "unknown"; why: string };

/**
 * How a recorded sha relates to the dev we can see.
 *
 * **Keyed on BOTH shas.** Caching by the reading's sha alone freezes the answer:
 *
 * > reading SHA A is cached as `dev-head` → `origin/dev` advances to B → lookup
 * > for A hits the cache → it remains "on dev" indefinitely.
 * >
 * > — GPT Sol, 2026-09-09
 *
 * With `devSha` in the key, dev moving invalidates every entry that mentioned
 * the old one, for free, without anybody having to remember to clear anything.
 */
export function makeRelationCache(cwd: string): {
  relate(readingSha: string, devSha: string): ShaRelation;
  size(): number;
} {
  const cache = new Map<string, ShaRelation>();
  const primary = primaryCheckout(cwd);
  const root = "why" in primary ? cwd : primary.path;

  return {
    size: () => cache.size,
    relate(readingSha, devSha) {
      if (readingSha === devSha) return { kind: "dev-head" };
      const key = `${readingSha}\0${devSha}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;

      let answer: ShaRelation;
      const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", readingSha, devSha], {
        cwd: root,
        encoding: "utf8",
        timeout: GIT_TIMEOUT_MS,
      });
      if (ancestor.error) {
        answer = { kind: "unknown", why: `git merge-base: ${ancestor.error.message}` };
      } else if (ancestor.status === 0) {
        const behind = git(root, ["rev-list", "--count", `${readingSha}..${devSha}`]);
        const n = behind.ok ? Number(behind.out) : Number.NaN;
        answer = Number.isFinite(n) ? { kind: "behind-dev", behind: n } : { kind: "behind-dev", behind: 0 };
      } else if (ancestor.status === 1) {
        answer = { kind: "not-on-dev" };
      } else {
        /* Exit 128 is "no such commit" — a sha from a worktree whose branch was
           deleted, or from a repo this is not. Not the same as "not on dev",
           and saying so is the difference between a fact and a guess. */
        answer = { kind: "unknown", why: `this commit is not in the primary checkout (git exited ${ancestor.status})` };
      }

      /* Bounded, because a busy night mints a sha per commit and this map lives
         as long as the server. Oldest out first; Map preserves insertion order. */
      if (cache.size > 500) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(key, answer);
      return answer;
    },
  };
}
