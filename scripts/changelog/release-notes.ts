#!/usr/bin/env -S npx tsx
/**
 * **The release notes, written before the deploy so they go out in it.**
 *
 *     npm run changelog:prepare     # before `npm run deploy`
 *     npm run changelog:promote     # after it is verified (prepare also does this first)
 *
 * The Overseer's sequence, and why it is this one, is docs/project/overseer.md
 * § Deploying; the design and the reviews behind it are docs/plans/261001q.
 * Until 2026-10-01 this was two shell scripts in one session's scratchpad, and
 * the notes for each deploy were written after it and shipped with the next.
 *
 * - **`promote`** reads production's `/build.json`, appends the release it is
 *   serving to the history (`changelog.ts promote`), and commits and pushes
 *   that line. Deterministic and seconds long.
 * - **`prepare`** promotes first — planning on top of an unpromoted serving
 *   release would fold it into the next one — then plans the release from the
 *   history's last line to `dev`'s tip, runs the model stages through
 *   `run-claude.ts` (trawl, GPT Sol, copy; `prepare-prompt.md`), and commits
 *   and pushes the pending file. One round: whatever lands on `dev` during the
 *   model run rides along and rolls to the next release's notes (261002h). It
 *   checks its own result with `notesAt`, the same function the deploy gate
 *   calls, and exits non-zero if the gate would refuse it.
 *
 * Both hold the deploy's own lock (deploy-checks.ts § RELEASE_LOCK_FILE): notes
 * planned while a deploy is finishing would be planned against a history that
 * is about to move.
 *
 * **It never runs an ordinary merge.** It runs in the primary checkout, where
 * other agents' uncommitted edits live, and a refused merge on a dirty tree has
 * reset tracked files here before. When `dev` moves under it, it fast-forwards
 * (`--ff-only`, which refuses cleanly) or stops and says what to do.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { parseChangelog, parsePending, type PendingRelease } from "../../src/changelog.js";
import { isMain } from "../../src/is-main.js";
import { RELEASE_LOCK_FILE } from "../deploy-checks.js";
import { LockHeldError, takeLockFile } from "../lockfile.js";
import { main as changelog, Refused } from "./changelog.js";
import { CHANGELOG_FILE, PENDING_FILE, notesAt, releaseCommits } from "./release-paths.js";

const HOST = "https://www.spideryarn.com";
const TRUNK = "dev";
const LOG = "logs/changelog-loop.log";

export class Stop extends Error {}

function root(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitRun(args: string[], cwd: string): { code: number; out: string } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function log(cwd: string, line: string): void {
  const text = `${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")} ${line}`;
  console.log(text);
  mkdirSync(path.join(cwd, "logs"), { recursive: true });
  writeFileSync(path.join(cwd, LOG), `${text}\n`, { flag: "a" });
}

function lock(cwd: string): () => void {
  const common = path.resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd));
  try {
    const held = takeLockFile(path.join(common, RELEASE_LOCK_FILE));
    return () => held.release();
  } catch (err) {
    if (err instanceof LockHeldError) {
      throw new Stop(
        err.holderAlive
          ? `a deploy or another changelog run holds the release lock (pid ${err.holder.pid}, since ${err.holder.since || "?"}) — wait for it`
          : err.message,
      );
    }
    throw err;
  }
}

/**
 * On `dev`, and level with `origin/dev` after a fetch — the same footing
 * `deploy.ts` insists on. **Merely behind is fast-forwarded** (`--ff-only`,
 * which refuses cleanly rather than touching anybody's edits): on a busy `dev`
 * "pull first" was a stop nearly every time (261002h). Ahead or diverged still
 * stops, because only a merge would settle it.
 */
function levelWithTrunk(cwd: string): string {
  const branch = git(["branch", "--show-current"], cwd);
  if (branch !== TRUNK) throw new Stop(`on '${branch || "a detached HEAD"}', not ${TRUNK} — run this where you deploy from`);
  const fetched = gitRun(["fetch", "origin", TRUNK, "main", "--quiet"], cwd);
  if (fetched.code !== 0) throw new Stop(`could not fetch origin: ${fetched.out}`);
  const trunk = git(["rev-parse", `origin/${TRUNK}`], cwd);
  fastForwardTo(trunk, cwd);
  return trunk;
}

/**
 * **Bring HEAD to exactly `target`, or stop with HEAD and the tree untouched.**
 *
 * `merge --ff-only` alone is not that: from a HEAD *ahead* of the target it
 * succeeds with "Already up to date" and leaves HEAD where it was (GPT Sol on
 * 261002h). So ancestry is asked first and the result checked after. The
 * target is a sha captured once, not `origin/dev`, which another fetch could
 * move between the question and the merge. A merge refused for an uncommitted
 * edit in a file it would change leaves that edit alone — the reason this is
 * `--ff-only` and never a merge (see the header).
 */
export function fastForwardTo(target: string, cwd: string): void {
  const head = git(["rev-parse", "HEAD"], cwd);
  if (head === target) return;
  const behind = gitRun(["merge-base", "--is-ancestor", head, target], cwd).code === 0;
  if (!behind) {
    throw new Stop(
      `HEAD ${head.slice(0, 8)} is not behind origin/${TRUNK} ${target.slice(0, 8)} — it is ahead or has diverged; ` +
        "push or merge it by hand first",
    );
  }
  const ff = gitRun(["merge", "--ff-only", "--quiet", target], cwd);
  if (ff.code !== 0) throw new Stop(`could not fast-forward to origin/${TRUNK} ${target.slice(0, 8)}: ${ff.out}`);
  const now = git(["rev-parse", "HEAD"], cwd);
  if (now !== target) throw new Stop(`fast-forwarded, but HEAD is ${now.slice(0, 8)}, not ${target.slice(0, 8)}`);
}

/**
 * Commit exactly these files, by pathspec, and push. A rejected push is not
 * retried with a merge (see the header): the commit stays local, and the
 * Overseer's own pull carries it.
 */
function commitAndPush(cwd: string, files: string[], message: string): void {
  if (gitRun(["diff", "--quiet", "HEAD", "--", ...files], cwd).code === 0) return;
  const guard = spawnSync("npm", ["run", "--silent", "check:staged-revert"], { cwd, encoding: "utf8" });
  if (guard.status !== 0) throw new Stop(`check:staged-revert refused:\n${guard.stdout}${guard.stderr}`);
  const msgFile = path.join(cwd, "logs", `release-notes-commit-${stamp()}.txt`);
  writeFileSync(msgFile, `${message}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`);
  const committed = gitRun(["commit", "-F", msgFile, "--", ...files], cwd);
  if (committed.code !== 0) throw new Stop(`commit failed: ${committed.out}`);
  const pushed = gitRun(["push", "origin", `HEAD:${TRUNK}`], cwd);
  if (pushed.code !== 0) {
    throw new Stop(
      `committed ${git(["rev-parse", "--short", "HEAD"], cwd)} but the push was refused — ${TRUNK} moved. ` +
        "Pull, push, then run npm run deploy: its changelog gate says whether prepare must run again.",
    );
  }
}

async function readServing(cwd: string): Promise<string> {
  const res = await fetch(`${HOST}/build.json`, { cache: "no-store" });
  if (!res.ok) throw new Stop(`${HOST}/build.json answered ${res.status} — cannot tell what production is serving`);
  const file = path.join(cwd, "logs", "changelog", `serving-${stamp()}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, await res.text());
  return file;
}

/** `changelog.ts` in-process, its refusals turned into a stop that says which command. */
function run(args: string[]): void {
  try {
    changelog(args);
  } catch (err) {
    if (err instanceof Refused) throw new Stop(`changelog.ts ${args[0]}: ${err.message}`);
    throw err;
  }
}

async function promote(cwd: string): Promise<void> {
  const serving = await readServing(cwd);
  run(["promote", "--serving", serving]);
  const v = JSON.parse(readFileSync(serving, "utf8")) as { deploymentId?: string; commit?: string };
  commitAndPush(
    cwd,
    [CHANGELOG_FILE, PENDING_FILE],
    `Changelog: record the production deploy ${v.deploymentId ?? "?"} (${String(v.commit).slice(0, 8)})`,
  );
}

function pendingNow(cwd: string): string {
  const file = path.join(cwd, PENDING_FILE);
  return existsSync(file) ? readFileSync(file, "utf8") : "null\n";
}

/** The pending release on disk, read against the history on disk; null when there is none or it does not fit. */
function pendingRelease(cwd: string): PendingRelease | null {
  const history = parseChangelog(readFileSync(path.join(cwd, CHANGELOG_FILE), "utf8"));
  const parsed = parsePending(pendingNow(cwd), history.versions);
  return parsed.problems.length === 0 ? parsed.pending : null;
}

async function prepare(cwd: string): Promise<void> {
  levelWithTrunk(cwd);
  log(cwd, "changelog:prepare — promoting what production serves");
  await promote(cwd);

  const tip = levelWithTrunk(cwd);
  const work = path.join(cwd, "logs", "changelog", `prepare-${stamp()}`);
  run(["plan", "--upcoming", tip, "--work", work]);
  const upcoming = JSON.parse(readFileSync(path.join(work, "upcoming.json"), "utf8")) as {
    release_commits: number;
  };

  if (upcoming.release_commits === 0) {
    log(cwd, `nothing a reader would see up to ${tip.slice(0, 8)} — pending is null`);
    if (pendingNow(cwd).trim() !== "null") writeFileSync(path.join(cwd, PENDING_FILE), "null\n");
  } else {
    log(cwd, `${upcoming.release_commits} release commits up to ${tip.slice(0, 8)} — model stages, work ${work}`);
    const before = pendingNow(cwd);
    const prompt = readFileSync(path.join(cwd, "scripts/changelog/prepare-prompt.md"), "utf8")
      .replaceAll("{{SHA}}", tip)
      .replaceAll("{{WORK}}", path.relative(cwd, work));
    const promptFile = path.join(work, "prompt.md");
    writeFileSync(promptFile, prompt);
    const env = { ...process.env };
    /* The box's default login, the one the changelog job has always run under. */
    delete env.CLAUDE_CONFIG_DIR;
    const agent = spawnSync(
      "npx",
      [
        "tsx", "scripts/run-claude.ts", "--model", "opus", "--effort", "high", "--access", "write",
        "--tools", "Read,Grep,Glob,Bash,Edit,Write,TodoWrite,Agent",
        "--timeout-minutes", "240", "--prompt-file", promptFile,
        "--output", path.join(work, "debrief.md"), "--activity-log", path.join(work, "activity.jsonl"),
      ],
      { cwd, env, stdio: "inherit" },
    );
    log(cwd, `model stages exit=${agent.status} debrief=${path.join(work, "debrief.md")}`);
    if (agent.status !== 0) throw new Stop(`the model stages exited ${agent.status} — read ${path.join(work, "debrief.md")}`);
    if (pendingNow(cwd) === before || pendingRelease(cwd)?.sha !== tip) {
      throw new Stop(`the model stages exited 0 but ${PENDING_FILE} does not describe ${tip.slice(0, 8)} — read the debrief`);
    }
  }

  /* `dev` has usually moved during the model run. Fast-forward so the push is
     one, and let what landed meanwhile ride along: commits a reader can see
     roll to the next release's notes, because `promote` stops this release's
     line at `tip` and the next `prepare` plans from there (261002h). Until
     2026-10-02 they sent this round again, up to three times. */
  gitRun(["fetch", "origin", TRUNK, "--quiet"], cwd);
  const trunk = git(["rev-parse", `origin/${TRUNK}`], cwd);
  if (trunk !== tip) {
    fastForwardTo(trunk, cwd);
    const late = releaseCommits(`${tip}..${trunk}`, cwd);
    if (late.length > 0) log(cwd, `${late.length} release commits landed meanwhile — the next release's notes describe them`);
  }

  const pending = pendingRelease(cwd);
  commitAndPush(
    cwd,
    [PENDING_FILE],
    pending
      ? `Changelog: release notes for the next deploy, up to ${tip.slice(0, 8)}, ${pending.entries.length} entries`
      : "Changelog: nothing pending — no change a reader would see since the last release",
  );
  const head = git(["rev-parse", "HEAD"], cwd);
  const notes = notesAt(head, cwd);
  if (notes.gap !== null) throw new Stop(`pushed ${head.slice(0, 8)}, but the deploy gate would refuse it: ${notes.gap}`);
  log(
    cwd,
    `ready: ${head.slice(0, 8)} carries its release notes` +
      (notes.late.length > 0 ? `, and ${notes.late.length} later release commit(s) roll to the next release's` : "") +
      " — npm run deploy",
  );
}

export async function main(argv: string[]): Promise<number> {
  const command = argv[0];
  if (command !== "prepare" && command !== "promote") {
    console.log("usage: release-notes.ts prepare | promote   — docs/project/changelog.md § Running it");
    return command === undefined ? 0 : 1;
  }
  const cwd = root();
  let release: (() => void) | null = null;
  try {
    release = lock(cwd);
    if (command === "prepare") await prepare(cwd);
    else {
      levelWithTrunk(cwd);
      await promote(cwd);
    }
    return 0;
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    log(cwd, `changelog:${command} stopped — ${err.message}`);
    return 1;
  } finally {
    release?.();
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
