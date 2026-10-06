/**
 * Where a worktree may be: the one list, and the two questions asked of it.
 *
 * There are two places.
 *
 *   in-repo    <primary>/.claude/worktrees/<name>      every tree before 2026-10-05, and the Mac
 *   external   /var/tmp/spideryarn-worktrees/<name>    new trees on the box
 *
 * The second arrived with `.claude/hooks/worktree-create.sh` (docs/project/worktrees.md
 * § Where a worktree's bytes live), and four functions that each recognised the
 * first in their own way went on refusing the second: the fleet dashboard could
 * not remove a new tree, the recovery view called its directory "not recorded",
 * and its row showed no worktree name. They all ask here now. **A third place is
 * one edit, in this file** — and in the hook, which is bash and cannot import it;
 * tests/worktree-roots.test.ts reads the hook's text to keep the two level.
 *
 * Everything here is about the *shape of a path*. Nothing touches the disk, so
 * nothing here knows whether the directory exists, is a git worktree, or belongs
 * to this repository — an external tree of some other repository has the same
 * shape. Callers that go on to act (tools/fleet/actions.ts § planRemoveWorktree)
 * ask git for that separately, and must keep doing so.
 */

/** The hook's variable, and its default when unset. */
export const EXTERNAL_WORKTREE_ROOT_ENV = "SPIDERYARN_WORKTREE_ROOT";
export const DEFAULT_EXTERNAL_WORKTREE_ROOT = "/var/tmp/spideryarn-worktrees";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The segments of a plain absolute path, or null.
 *
 * "Plain" is the guard: no `.` or `..`, no empty segment, no NUL. A path is only
 * compared here, never resolved, so `<root>/x/../../..` would otherwise pass every
 * prefix test while naming the directory above the root. Trailing slashes are
 * forgiven, since two spellings of one directory should compare equal.
 */
function plainSegments(dir: string): string[] | null {
  if (!dir.startsWith("/") || dir.includes("\0")) return null;
  const trimmed = dir.replace(/\/+$/, "");
  if (trimmed === "") return [];
  const parts = trimmed.slice(1).split("/");
  return parts.some((p) => p === "" || p === "." || p === "..") ? null : parts;
}

/** The same path guard for a caller's primary checkout, which has no worktree name. */
export function isPlainAbsolutePath(dir: string): boolean {
  return plainSegments(dir) !== null;
}

/**
 * The external root: `$SPIDERYARN_WORKTREE_ROOT`, else the default. A value that
 * is empty, relative, `/` or not a plain path is ignored rather than trusted —
 * the hook would have refused or misbehaved on it too, and this must never widen
 * "is a worktree" to the whole disk.
 */
export function externalWorktreeRoot(env: Env = process.env): string {
  const given = env[EXTERNAL_WORKTREE_ROOT_ENV];
  if (given === undefined) return DEFAULT_EXTERNAL_WORKTREE_ROOT;
  const parts = plainSegments(given);
  return parts === null || parts.length === 0 ? DEFAULT_EXTERNAL_WORKTREE_ROOT : `/${parts.join("/")}`;
}

export type WorktreePlace = {
  /** The tree's directory name — what `EnterWorktree({name})` was given. */
  name: string;
  /** The tree's own root directory, whichever directory inside it was asked about. */
  root: string;
  where: "in-repo" | "external";
};

/**
 * Which worktree is this directory in — its root or anything beneath it? Null
 * for a plain checkout, for either root itself, and for a path that is not plain.
 *
 * External is asked first, because the repository has a `.claude/` of its own:
 * `<external>/<name>/.claude/worktrees/…` is inside the tree `<name>`.
 */
export function worktreePlace(dir: string, env: Env = process.env): WorktreePlace | null {
  const parts = plainSegments(dir);
  if (parts === null) return null;

  const external = externalWorktreeRoot(env).slice(1).split("/");
  const name = parts[external.length];
  if (name !== undefined && external.every((p, i) => parts[i] === p)) {
    return { name, root: `/${parts.slice(0, external.length + 1).join("/")}`, where: "external" };
  }

  for (let i = 0; i + 2 < parts.length; i++) {
    const inRepo = parts[i + 2];
    if (parts[i] === ".claude" && parts[i + 1] === "worktrees" && inRepo !== undefined) {
      return { name: inRepo, root: `/${parts.slice(0, i + 3).join("/")}`, where: "in-repo" };
    }
  }
  return null;
}

/**
 * Is this directory in a worktree that could be one of THIS checkout's? An
 * in-repo tree must be under this primary. An external tree passes on shape
 * alone, which is all a path can say — see the note at the top.
 */
export function isWorktreeOfCheckout(dir: string, primaryDir: string, env: Env = process.env): boolean {
  const place = worktreePlace(dir, env);
  if (place === null) return false;
  if (place.where === "external") return true;
  const primary = plainSegments(primaryDir);
  return primary !== null && place.root === `/${[...primary, ".claude", "worktrees", place.name].join("/")}`;
}
