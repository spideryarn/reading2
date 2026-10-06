#!/usr/bin/env -S npx tsx
/**
 * `prune-old-screenshots` — delete week-old screenshots from the dated doc
 * folders, in one commit.
 *
 * ```
 * npx tsx scripts/prune-old-screenshots.ts            # list them and their size. Changes nothing.
 * npx tsx scripts/prune-old-screenshots.ts --apply    # delete and commit. Does not push.
 * ```
 *
 * Greg, 2026-10-06: *"Yes, old screenshots (>1w) can be deleted - you have
 * permission going forwards."* A plan's screenshots are evidence for a review
 * that happens the same week; after that they are 145 MB in every checkout,
 * and there are about twenty checkouts on the box. They stay in git history.
 * A plan that links one is left with a dead image link, which Greg accepted
 * (docs/project/overseer.md § Keeping `/home` from filling).
 *
 * **Run by the Overseer, not by a timer.** Deleting them is a commit, and
 * nothing unattended commits in the shared checkout.
 *
 * ## Only the dated folders
 *
 * `docs/plans`, `investigations`, `postmortems`, `research`, `user-feedback`.
 * An image under `docs/project`, `docs/tutorials` or `docs/reusable` is part of
 * a page somebody still reads, however old it is.
 *
 * ## What "a week old" means, because the obvious reading is wrong twice
 *
 * A file is old when **no commit anywhere in history has touched its path in
 * the last seven days, by committer date, counting merges**. Not the author
 * date (a rebased or cherry-picked commit keeps an old one), not the date in
 * the filename, and not `git log -1 -- <file>`, whose history simplification
 * skips the merge that brought an old branch in yesterday. So `git log -m`,
 * which diffs a merge against each parent: a screenshot that arrived on `dev`
 * yesterday by merge is one day old here, however long its branch sat. Renames
 * are not followed, so a renamed file is as new as its rename.
 *
 * ## The commit
 *
 * `git commit -F <msg> --pathspec-from-file=<list>`, NUL-separated and literal:
 * the house recipe (AGENTS.md § Commit only your own files), which commits
 * those paths from the working tree and neither reads nor disturbs whatever a
 * peer has staged. Before it: `check:staged-revert`, a refusal during a merge,
 * a refusal if any candidate differs from `HEAD` in the index or on disk, and
 * the candidate list computed a second time. **An empty list never reaches
 * `git commit`**, because a commit with no pathspec is an index commit.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DATED_FOLDERS = ["docs/plans", "docs/investigations", "docs/postmortems", "docs/research", "docs/user-feedback"] as const;
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"] as const;
export const MAX_AGE_DAYS = 7;

const DAY_SECONDS = 24 * 60 * 60;
const GIT_MAX_BUFFER = 512 * 1024 * 1024;

function git(repo: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    env: { ...process.env, ...env },
  });
}

/**
 * The newest committer time, in seconds, of any commit that touched each path
 * under the dated folders. Merges count, against every parent.
 *
 * One `git log` over the folders rather than one per file: there are hundreds
 * of files. The order git prints commits in is not assumed to be date order;
 * the maximum is taken.
 */
export function newestTouch(repo: string): Map<string, number> {
  // \x01 brackets each commit's timestamp, so the pieces alternate: time, names, time, names.
  const out = git(repo, ["log", "-m", "--no-renames", "--name-only", "-z", "--format=%x01%ct%x01", "--", ...DATED_FOLDERS]);
  const newest = new Map<string, number>();
  const pieces = out.split("\x01");
  for (let i = 1; i + 1 < pieces.length; i += 2) {
    const when = Number(pieces[i]);
    if (!Number.isFinite(when)) throw new Error(`git log printed a commit time that is not a number: ${JSON.stringify(pieces[i])}`);
    for (const raw of (pieces[i + 1] ?? "").split("\0")) {
      const name = raw.replace(/^\n+/, "");
      if (name === "") continue;
      if (when > (newest.get(name) ?? 0)) newest.set(name, when);
    }
  }
  return newest;
}

function isImage(file: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(file).toLowerCase());
}

/**
 * Tracked images under the dated folders that nothing has touched for
 * `MAX_AGE_DAYS`, sorted.
 *
 * A tracked image with no commit in the log at all is **kept**. It should not
 * happen, and "we could not find when it was committed" is not "it is old".
 */
export function oldScreenshots(repo: string, nowSeconds: number): string[] {
  const cutoff = nowSeconds - MAX_AGE_DAYS * DAY_SECONDS;
  const newest = newestTouch(repo);
  return git(repo, ["ls-files", "-z", "--", ...DATED_FOLDERS])
    .split("\0")
    .filter((file) => file !== "" && isImage(file))
    .filter((file) => {
      const when = newest.get(file);
      return when !== undefined && when < cutoff;
    })
    .sort();
}

export type ApplyResult =
  | { kind: "nothing-to-do" }
  | { kind: "refused"; why: string }
  | { kind: "committed"; files: number; commit: string };

/**
 * Delete `files` and commit exactly those paths.
 *
 * `guard` is `check:staged-revert` in the real run; it is a parameter so a test
 * against a temporary repository, which has no such script, can still exercise
 * everything else here.
 */
export function applyPrune(repo: string, nowSeconds: number, guard: () => string | null): ApplyResult {
  const files = oldScreenshots(repo, nowSeconds);
  if (files.length === 0) return { kind: "nothing-to-do" };

  if (spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: repo }).status === 0) {
    return { kind: "refused", why: "a merge is in progress in this checkout; finish it first" };
  }
  const guardSays = guard();
  if (guardSays !== null) return { kind: "refused", why: guardSays };

  const scratch = mkdtempSync(path.join(tmpdir(), "prune-old-screenshots-"));
  try {
    const list = path.join(scratch, "paths");
    writeFileSync(list, files.join("\0") + "\0");
    const pathspec = [`--pathspec-from-file=${list}`, "--pathspec-file-nul"];
    const literal = { GIT_LITERAL_PATHSPECS: "1" };

    // Identical to HEAD in the index AND on disk, or we would be committing somebody's edit as a deletion.
    // `git status` takes no --pathspec-from-file, so the folders are asked about and the answer
    // intersected here. Each -z entry is "XY <path>"; a rename adds a second, bare path.
    const wanted = new Set(files);
    const dirty = git(repo, ["status", "--porcelain", "-z", "--", ...DATED_FOLDERS])
      .split("\0")
      .map((entry) => (/^.. /.test(entry) ? entry.slice(3) : entry))
      .filter((name) => wanted.has(name));
    if (dirty.length > 0) {
      return { kind: "refused", why: `some of these files have uncommitted or staged changes: ${dirty.slice(0, 5).join(", ")}` };
    }
    // Computed again: a commit that landed between the listing and now may have made one of them new.
    const again = oldScreenshots(repo, nowSeconds);
    if (again.length !== files.length || again.some((f, i) => f !== files[i])) {
      return { kind: "refused", why: "the list of old screenshots changed while this was running; run it again" };
    }

    for (const file of files) unlinkSync(path.join(repo, file));

    const message = path.join(scratch, "message");
    writeFileSync(
      message,
      `Docs: delete ${files.length} screenshot(s) nothing has touched for ${MAX_AGE_DAYS} days\n\n` +
        "scripts/prune-old-screenshots.ts --apply. Greg, 2026-10-06: \"old screenshots (>1w) can be\n" +
        "deleted - you have permission going forwards\". They stay in history; a plan that links\n" +
        "one now has a dead image link, which he accepted (docs/project/overseer.md).\n",
    );
    try {
      git(repo, ["commit", "-q", "-F", message, ...pathspec], literal);
    } catch (err) {
      // Put back exactly what was deleted a moment ago. Each was checked identical to HEAD above,
      // so this overwrites nothing: without it a failed hook would leave hundreds of deletions lying
      // in a shared working tree for the next `git commit -a` to pick up.
      git(repo, ["restore", "--source=HEAD", "--worktree", ...pathspec], literal);
      return { kind: "refused", why: `git commit failed, and the files were put back: ${(err as Error).message.split("\n")[0]}` };
    }
    return { kind: "committed", files: files.length, commit: git(repo, ["rev-parse", "--short", "HEAD"]).trim() };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function stagedRevertGuard(repo: string): string | null {
  const run = spawnSync("npm", ["run", "--silent", "check:staged-revert"], { cwd: repo, encoding: "utf8" });
  return run.status === 0 ? null : `check:staged-revert refused:\n${run.stdout}${run.stderr}`;
}

function main(): number {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false }, help: { type: "boolean", default: false } } });
  if (values.help) {
    console.log("usage: npx tsx scripts/prune-old-screenshots.ts [--apply]\n  no flag: list week-old screenshots under the dated doc folders, and their size\n  --apply: delete them and commit (does not push)");
    return 0;
  }
  const repo = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const now = Math.floor(Date.now() / 1000);

  if (!values.apply) {
    const files = oldScreenshots(repo, now);
    let bytes = 0;
    for (const file of files) {
      console.log(file);
      try {
        bytes += statSync(path.join(repo, file)).size;
      } catch {
        /* tracked and already gone from disk: still listed, counts for nothing */
      }
    }
    console.log(`${files.length} screenshot(s) untouched for ${MAX_AGE_DAYS}+ days, ${(bytes / 1e6).toFixed(1)} MB. Nothing was changed; --apply deletes and commits them.`);
    return 0;
  }

  const result = applyPrune(repo, now, () => stagedRevertGuard(repo));
  switch (result.kind) {
    case "nothing-to-do":
      console.log("no screenshots old enough to delete; nothing was committed");
      return 0;
    case "refused":
      console.error(`REFUSED, nothing was changed: ${result.why}`);
      return 1;
    case "committed":
      console.log(`deleted ${result.files} screenshot(s) in ${result.commit}. Not pushed: git push origin HEAD:dev`);
      return 0;
    default: {
      const never: never = result;
      throw new Error(`unhandled result ${JSON.stringify(never)}`);
    }
  }
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
