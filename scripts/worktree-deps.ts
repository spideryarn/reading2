/**
 * Has this worktree's `node_modules` already been installed from the lockfile
 * that is here now?
 *
 * `npm run worktree:setup` starts in `scripts/worktree-setup-bootstrap.mjs`,
 * which is plain Node so that it runs in a tree with nothing installed. When it
 * finds no `tsx` it runs `npm ci` itself and then hands over to
 * `scripts/worktree-setup.ts`, which merges `origin/dev` and would install
 * again. This is how the second install is skipped when it would change nothing:
 * the bootstrap passes the sha256 of the `package-lock.json` it installed from,
 * and setup compares it with the lockfile *after* the merge.
 *
 * Wrong in the safe direction: anything it cannot confirm is "not installed",
 * which costs one more `npm ci`.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Set by the bootstrap, and only when it ran `npm ci` itself. The same name is spelled out there. */
export const INSTALLED_LOCK_ENV = "SPIDERYARN_SETUP_INSTALLED_LOCK";

/** sha256 of `package-lock.json`, or null when it cannot be read. */
export function lockDigest(root: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path.join(root, "package-lock.json"))).digest("hex");
  } catch {
    return null;
  }
}

export function alreadyInstalled(root: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const claimed = env[INSTALLED_LOCK_ENV];
  if (claimed === undefined || claimed === "") return false;
  // npm writes this file last, so it is what says an install finished rather than began.
  if (!existsSync(path.join(root, "node_modules", ".package-lock.json"))) return false;
  return lockDigest(root) === claimed;
}
