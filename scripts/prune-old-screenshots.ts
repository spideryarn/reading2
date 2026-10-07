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
 * **Run by the Overseer, not by a timer, and `--apply` only in a worktree of
 * its own.** Deleting them is a commit, and nothing unattended commits in the
 * shared checkout; `--apply` refuses there (`isPrimaryCheckout`).
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
 * These checks are snapshots: --apply still requires exclusive use of the
 * checkout. A concurrent edit between validation and unlink/commit is unsafe.
 */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
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
  const head = spawnSync("git", ["rev-parse", "-q", "--verify", "HEAD"], { cwd: repo });
  if (head.status === 1) return new Map(); // unborn branch: staged files have no touch date
  if (head.status !== 0 || head.error) throw new Error("cannot resolve HEAD");
  if (git(repo, ["rev-parse", "--is-shallow-repository"]).trim() !== "false") {
    throw new Error("cannot establish screenshot ages from a shallow repository; fetch the full history first");
  }
  const out = git(repo, ["log", "-m", "--no-renames", "--name-only", "-z", "--format=%ct", "--", ...DATED_FOLDERS]);
  const newest = new Map<string, number>();
  let when: number | undefined;
  // NUL cannot occur in a git path. Timestamp records are bare integers;
  // every pathname here starts with docs/, including names containing SOH/newlines.
  for (const token of out.split("\0")) {
    const record = token.replace(/^\n/, ""); // git's separator before the first name
    if (record === "") continue;
    if (/^-?\d+$/.test(record)) {
      when = Number(record);
      if (!Number.isSafeInteger(when)) throw new Error("invalid git commit time");
    } else {
      if (when === undefined || !DATED_FOLDERS.some((folder) => record.startsWith(`${folder}/`))) {
        throw new Error(`unexpected git log record: ${JSON.stringify(record)}`);
      }
      if (when > (newest.get(record) ?? -Infinity)) newest.set(record, when);
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
  const shown = namesShownElsewhere(repo);
  return git(repo, ["ls-files", "-z", "--", ...DATED_FOLDERS])
    .split("\0")
    .filter((file) => file !== "" && isImage(file))
    .filter((file) => {
      const when = newest.get(file);
      return when !== undefined && when < cutoff;
    })
    .filter((file) => !shown.has(path.basename(file).toLowerCase()))
    .sort();
}

/**
 * The base names of every image file name that appears in a tracked text file
 * OUTSIDE the dated folders.
 *
 * A plan's link to its own screenshot may go dead; that is the accepted cost.
 * A living page's may not: `docs/project/skim.md` shows three images that live
 * under `docs/plans`, and the first real run of this script deleted them
 * (2026-10-07; put back before it was pushed). So an image whose name is
 * written anywhere else in the repo is kept, however old.
 *
 * By base name, which keeps too much rather than too little: two files called
 * `shot.png` in different folders protect each other. Any other way of matching
 * has to resolve relative links from markdown, HTML and source alike.
 */
export function namesShownElsewhere(repo: string): Set<string> {
  const extensions = IMAGE_EXTENSIONS.map((e) => e.slice(1)).join("|");
  const run = spawnSync(
    "git",
    [
      "grep", "-I", "-h", "-o", "-i", "-E", `[A-Za-z0-9._~%+-]+\\.(${extensions})`,
      "--", ".", ...DATED_FOLDERS.map((folder) => `:(exclude)${folder}`),
    ],
    { cwd: repo, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER },
  );
  // 1 is "no match", which is an empty set. Anything else is a failure, and a failure must not read as "nothing is shown".
  if (run.status !== 0 && run.status !== 1) throw new Error(`git grep failed (${run.status}): ${run.stderr}`);
  return new Set(run.stdout.split("\n").filter(Boolean).map((name) => decodeURIComponentSafe(name).toLowerCase()));
}

function decodeURIComponentSafe(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
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
/**
 * Whether `repo` is the checkout that owns `.git`, as opposed to a linked
 * worktree: the test AGENTS.md gives (`--git-dir` equals `--git-common-dir`).
 *
 * `--apply` refuses there. The checks below cannot close the window between
 * the last of them and the commit: a peer who edits or recreates a candidate
 * in that moment has the edit lost, or committed under this script's message.
 * In the primary, a dozen agents share the files. In a worktree of the
 * caller's own, nobody else is in the tree.
 */
export function isPrimaryCheckout(repo: string): boolean {
  const resolve = (flag: string) => path.resolve(repo, git(repo, ["rev-parse", flag]).trim());
  return resolve("--git-dir") === resolve("--git-common-dir");
}

export function applyPrune(repo: string, nowSeconds: number, guard: () => string | null): ApplyResult {
  const files = oldScreenshots(repo, nowSeconds);
  if (files.length === 0) return { kind: "nothing-to-do" };
  const head = git(repo, ["rev-parse", "--verify", "HEAD"]).trim();

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

    // Status can hide assume-unchanged/skip-worktree paths. Compare actual bytes
    // with the pinned HEAD, and retain those bytes for exclusive-create recovery.
    const format = git(repo, ["rev-parse", "--show-object-format"]).trim();
    const tree = new Map(git(repo, ["ls-tree", "-r", "-z", head, "--", ...DATED_FOLDERS])
      .split("\0").filter(Boolean).map((entry) => {
        const tab = entry.indexOf("\t");
        return [entry.slice(tab + 1), entry.slice(0, tab)];
      }));
    const saved = files.map((file) => {
      const full = path.join(repo, file);
      if (realpathSync(full) !== path.join(realpathSync(repo), file) || !lstatSync(full).isFile()) {
        throw new Error(`candidate is not a regular file at its tracked path: ${file}`);
      }
      const body = readFileSync(full);
      const hash = createHash(format).update(`blob ${body.length}\0`).update(body).digest("hex");
      return { file, full, body, hash, stat: lstatSync(full) };
    });
    if (saved.some(({ file, hash }) => tree.get(file)?.split(" ")[2] !== hash)) {
      return { kind: "refused", why: "a screenshot's on-disk bytes differ from HEAD" };
    }
    const skipped = git(repo, ["ls-files", "-v", "-z", "--", ...DATED_FOLDERS])
      .split("\0").some((entry) => /^[Ss] /.test(entry) && wanted.has(entry.slice(2)));
    if (skipped) return { kind: "refused", why: "a screenshot has skip-worktree set; git would omit its deletion" };
    const index = new Map(git(repo, ["ls-files", "--stage", "-z", "--", ...DATED_FOLDERS])
      .split("\0").filter(Boolean).map((entry) => {
        const tab = entry.indexOf("\t");
        const [mode, hash, stage] = entry.slice(0, tab).split(" ");
        return [entry.slice(tab + 1), stage === "0" ? `${mode} blob ${hash}` : "unmerged"];
      }));
    if (files.some((file) => index.get(file) !== tree.get(file))) {
      return { kind: "refused", why: "a screenshot's staged version differs from HEAD" };
    }
    const unchangedHead = () => git(repo, ["rev-parse", "HEAD"]).trim() === head &&
      spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: repo }).status === 1;
    const deleted: typeof saved = [];
    try {
      for (const item of saved) {
        const current = lstatSync(item.full);
        if (!unchangedHead() || current.dev !== item.stat.dev || current.ino !== item.stat.ino ||
            current.ctimeMs !== item.stat.ctimeMs || current.mtimeMs !== item.stat.mtimeMs ||
            !readFileSync(item.full).equals(item.body)) {
          throw new Error(`checkout changed before deleting ${item.file}`);
        }
        unlinkSync(item.full);
        deleted.push(item);
      }
      if (!unchangedHead()) throw new Error("HEAD or merge state changed before committing");
      for (const item of deleted) {
        try { lstatSync(item.full); } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw err;
        }
        throw new Error(`a screenshot was recreated before committing: ${item.file}`);
      }

      const message = path.join(scratch, "message");
      writeFileSync(message, `Docs: delete ${files.length} screenshot(s) nothing has touched for ${MAX_AGE_DAYS} days\n\n` +
        "scripts/prune-old-screenshots.ts --apply. Deleted images remain in git history.\n");
      git(repo, ["commit", "-q", "-F", message, ...pathspec], literal);
    } catch (err) {
      const unrestored: string[] = [];
      for (const item of deleted) {
        try {
          // Never replace a peer's new file, and never read a moving HEAD.
          if (realpathSync(path.dirname(item.full)) !== path.join(realpathSync(repo), path.dirname(item.file))) {
            throw new Error("candidate's parent changed");
          }
          writeFileSync(item.full, item.body, { flag: "wx", mode: item.stat.mode & 0o777 });
        } catch {
          unrestored.push(item.file);
        }
      }
      return { kind: "refused", why: `prune failed; restored ${deleted.length - unrestored.length} deletion(s) without overwriting existing files` +
        (unrestored.length ? `; left for inspection: ${unrestored.join(", ")}` : "") +
        `: ${(err as Error).message.split("\n")[0]}` };
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

  if (isPrimaryCheckout(repo)) {
    console.error(
      "REFUSED, nothing was changed: --apply does not run in the shared primary checkout, where another agent's edit\n" +
        "could land between its last check and its commit. Run it in a worktree of your own, then push:\n" +
        "  git worktree add -b prune-screenshots /var/tmp/spideryarn-worktrees/prune-screenshots origin/dev",
    );
    return 1;
  }
  const result = applyPrune(repo, now, () => stagedRevertGuard(repo));
  switch (result.kind) {
    case "nothing-to-do":
      console.log("no screenshots old enough to delete; nothing was committed");
      return 0;
    case "refused":
      console.error(`REFUSED: ${result.why}`);
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
