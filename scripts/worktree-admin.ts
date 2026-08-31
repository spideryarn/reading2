/**
 * Registering and unregistering git worktrees, done completely.
 *
 * `scripts/deploy.ts` runs its gates in a throwaway worktree of the exact
 * commit, creates it with `--lock` so nobody's `git worktree prune` can pull it
 * out from under the run, and then tore it down with:
 *
 * ```
 * git worktree remove --force <path>
 * ```
 *
 * **Git needs `--force` twice to remove a locked worktree.** Once is refused:
 *
 * ```
 * fatal: cannot remove a locked working tree, lock reason: ...
 * use 'remove -f -f' to override or unlock first
 * ```
 *
 * The exit code was not checked, and the `rmSync` on the next line deleted the
 * directory anyway. So every deploy left a registration behind pointing at a
 * path that no longer existed — sixteen of them, against a repository four days
 * old, found while planning docs/plans/260828r-worktrees.md. `git worktree prune` does
 * not clear them either: it exempts locked entries by design, which is how they
 * reached sixteen.
 *
 * That is the shape in docs/reusable/silent-success.md — a teardown reporting
 * success while doing nothing, with the deploy still passing so nobody looked.
 * Hence this file: the removal reports whether it worked, and the caller has
 * something it can fail on.
 *
 * Also the shared half of `worktree:doctor` and `worktree:rm` in
 * docs/plans/260828r-worktrees.md.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export interface RemovalResult {
  ok: boolean;
  /** Combined stdout+stderr, for a caller that wants to show why. */
  out: string;
  /** `null` when the process was signalled or could not be spawned at all. */
  status: number | null;
  signal: NodeJS.Signals | null;
  /** Set when the spawn itself failed — then `status` is null and `out` empty. */
  error?: Error | undefined;
}

/**
 * Unregister a **throwaway** worktree, discarding anything in it.
 *
 * The long name is the point. Two `--force` flags do two different things: the
 * first overrides git's refusal to remove a worktree with modifications, the
 * second overrides the lock. So this call will silently discard tracked changes
 * and untracked files, and a primitive that does that must not be called
 * something as mild as `removeWorktree` — the plan reuses this module for
 * `worktree:rm`, where the tree holds an agent's only copy of its work.
 *
 * Use it only for a worktree this process created and is about to delete.
 * `worktree:rm` gets a guarded path of its own — see docs/plans/260828r-worktrees.md,
 * failure mode 12.
 *
 * Never throws: teardown runs in a `finally`, and a throw there would replace
 * whatever real failure sent us there.
 */
export function forceRemoveThrowawayWorktree(path: string, cwd?: string): RemovalResult {
  const r = spawnSync("git", ["worktree", "remove", "--force", "--force", path], {
    cwd,
    encoding: "utf8",
  });
  return {
    ok: r.status === 0,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),
    status: r.status,
    signal: r.signal,
    error: r.error,
  };
}

/** One row of `git worktree list --porcelain -z`. */
export interface WorktreeEntry {
  path: string;
  /** Absent for a detached HEAD. */
  branch?: string | undefined;
  head?: string | undefined;
  detached: boolean;
  locked: boolean;
  lockReason?: string | undefined;
  /** Git's own view: the registration is removable by `git worktree prune`. */
  prunable: boolean;
  prunableReason?: string | undefined;
  /** A bare repository entry. Has no working tree, so absence means nothing. */
  bare: boolean;
  /** The first record is the main worktree; it is never a removable ghost. */
  main: boolean;
  /** Does the directory actually exist? A registration can outlive its tree. */
  present: boolean;
}

/**
 * Parse `git worktree list --porcelain -z`.
 *
 * **`-z`, not plain porcelain.** Without it git quotes and escapes any path or
 * lock reason containing a newline, and the parser then hands back the quoted
 * encoding rather than the text. `-z` separates records with NUL and leaves the
 * values alone. For the same reason nothing here trims: a trailing space in a
 * path is part of the path.
 *
 * Split from the running of it so it can be tested against the awkward records
 * — detached, bare, prunable, a lock with no reason — rather than only against
 * whatever this machine happens to have.
 */
export function parseWorktreeList(porcelain: string, exists: (p: string) => boolean = existsSync): WorktreeEntry[] {
  const out: WorktreeEntry[] = [];
  let cur: Partial<WorktreeEntry> | null = null;

  const flush = () => {
    if (cur?.path !== undefined) {
      out.push({
        path: cur.path,
        branch: cur.branch,
        head: cur.head,
        detached: cur.detached ?? false,
        locked: cur.locked ?? false,
        lockReason: cur.lockReason,
        prunable: cur.prunable ?? false,
        prunableReason: cur.prunableReason,
        bare: cur.bare ?? false,
        main: out.length === 0,
        present: exists(cur.path),
      });
    }
    cur = null;
  };

  /* Records are separated by an empty attribute line; with -z that is an empty
     string between two NULs. Splitting on either keeps this usable with both
     forms, which matters because the tests feed it hand-written fixtures. */
  for (const line of porcelain.split(/\0|\n/)) {
    if (line === "") {
      flush();
      continue;
    }
    if (line.startsWith("worktree ")) {
      flush();
      cur = { path: line.slice("worktree ".length) };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length);
    else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length);
    else if (line === "detached") cur.detached = true;
    else if (line === "bare") cur.bare = true;
    else if (line === "locked") cur.locked = true;
    else if (line.startsWith("locked ")) {
      cur.locked = true;
      cur.lockReason = line.slice("locked ".length);
    } else if (line === "prunable") cur.prunable = true;
    else if (line.startsWith("prunable ")) {
      cur.prunable = true;
      cur.prunableReason = line.slice("prunable ".length);
    }
  }
  flush();
  return out;
}

export function listWorktrees(cwd?: string): WorktreeEntry[] {
  const out = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], { cwd, encoding: "utf8" });
  return parseWorktreeList(out);
}

/**
 * Registrations that are no longer backed by a working tree — the litter the
 * bug above produced.
 *
 * Three exclusions, each of which the first version got wrong:
 *
 * - **The main worktree.** If the primary checkout's path is missing you have a
 *   much larger problem than a stale registration, and offering to remove it
 *   would be the wrong answer to it.
 * - **Bare entries.** A bare repository has no working tree, so "the directory
 *   is missing" is not a fault.
 * - Conversely, git's own `prunable` counts even when the path still exists —
 *   `existsSync` alone would miss those.
 */
export function ghosts(entries: readonly WorktreeEntry[]): WorktreeEntry[] {
  return entries.filter((e) => !e.main && !e.bare && (!e.present || e.prunable));
}
