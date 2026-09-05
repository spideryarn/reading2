#!/usr/bin/env -S npx tsx
/**
 * **Run one long command on this box in tmux, and have the session go away
 * afterwards.**
 *
 *     npx tsx scripts/tmux-job.ts npm test -- --reporter=dot
 *     npx tsx scripts/tmux-job.ts --name evals npx tsx evals/extraction/score.mts
 *
 * ## Why this exists
 *
 * A backgrounded `npm test` on the remote box is killed under load and reported
 * as a success — measured 2026-09-03 at load ~100, and again the same day by a
 * subagent whose run never started and was announced as exit 0. So the standing
 * instruction is to run long commands in tmux and judge them by the suite's own
 * output: docs/project/testing.md § "Run the suite in tmux".
 *
 * That instruction was a hand-typed `tmux new-session`, and it drifted, in two
 * directions that were both reasonable:
 *
 *  - **The name was hard-coded.** The recipe said `-s gate`, so the second
 *    agent to run it got `duplicate session` and improvised — `gateA`,
 *    `stage2base`, `dfs-mtest2`, `g2d-check`. This mints a unique one instead,
 *    and it starts with the worktree's name so a person can tell whose it is.
 *  - **A one-shot session vanishes when the command dies**, including when the
 *    quoting is wrong and it dies immediately, leaving nothing to attach to and
 *    nothing to read. So agents made a bare session and typed into it — and a
 *    bare `bash -l` session never exits. Eight of those husks were on the box
 *    on 2026-09-05, one of them fifteen hours old. Here the command IS the
 *    pane's process, so the session ends with it, and the log is opened before
 *    the command runs and outlives it either way — so there is always something
 *    to read, which is the half the one-shot recipe was missing.
 *
 * `EXIT=<n>` is appended as the log's last line, so "it never started" and "it
 * passed" are not the same silence — docs/reusable/silent-success.md.
 *
 * Nothing here talks to the network: it is tmux on whatever machine you are on.
 * `gjd-remote` is the laptop-to-box tool and this is deliberately not a
 * subcommand of it — a job runner needs none of its host resolution, session
 * uuids or env pushing, and that file is 5,800 lines already.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_UNKNOWN, localRepo } from "./gjd-remote-repo.js";
import { META, METADATA_VERSION } from "./gjd-remote-tmux.js";

/**
 * Where the logs go: `logs/tmux-jobs/`, gitignored at `/logs/`.
 *
 * **NOT under `data/`.** That is the article store, and every file beside an
 * article there has to have a home in Postgres — `tests/store-artefact-manifest.test.ts`
 * walks it and goes red for anything it cannot account for, which is exactly
 * what it did to the first version of this file. A job log is not an artefact.
 */
export const LOG_DIR = "logs/tmux-jobs";

/** Single-quote for `sh`, the same recipe as scripts/gjd-remote.ts. */
const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * A session name nothing else on this box already has.
 *
 * The worktree's own basename leads, because that is what a person reading
 * `gjd-remote ls` wants to know: `deepen-fat-sections-1423-9871` says whose job
 * it is where `gateA` says nothing at all. `HHmm` plus the pid after it — two
 * agents starting in the same minute is not an edge case on a box that holds a
 * dozen, and that collision is exactly what made the old recipe drift.
 */
export function jobName(cwd: string, now: Date, pid: number, given?: string): string {
  const stem = given ?? path.basename(cwd);
  const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  // tmux refuses `.` and `:` in a session name, and a shell would rather not
  // meet the rest. Trimmed so the whole thing stays inside the NAME column.
  const safe =
    stem
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "job";
  return `${safe}-${hhmm}-${pid}`;
}

/**
 * What the pane runs: the command, its output redirected, and its status
 * recorded.
 *
 * **A SUBSHELL, NOT A BRACE GROUP**, and that is the whole correctness of this
 * function. `{ …; }` runs in the wrapper shell, so a command that is a shell
 * builtin — `exit`, or an `exec` — takes the wrapper with it and the `printf`
 * below never runs: the log ends with no `EXIT=` line while the session exits
 * perfectly cleanly, which is precisely the silent success this file exists to
 * prevent. GPT Sol reproduced it with `jobScript(["exit", "0"], log)`, which
 * left an empty log and exited 0. `( … )` forks first, so `exit` ends the
 * subshell and its status arrives here like any other command's.
 *
 * The redirection is on the subshell rather than the command, so it covers a
 * command that is itself a list. The `printf` is outside it, so the status line
 * reaches the log instead of being swallowed by the redirection it reports on.
 *
 * No `exec` on the wrapper, deliberately: it has to outlive the command by one
 * statement in order to write that line. A pane process that exits one
 * statement later is still a pane that exits, which is all the session needs.
 */
export function jobScript(command: readonly string[], logPath: string): string {
  const cmd = command.map(shq).join(" ");
  const log = shq(logPath);
  return `( ${cmd} ) > ${log} 2>&1; printf 'EXIT=%s\\n' "$?" >> ${log}`;
}

/**
 * The four variables `gjd-remote ls` reads back, so a job says which repo and
 * directory it belongs to instead of `(unknown)`.
 *
 * Reusing that seam rather than inventing a second one — scripts/gjd-remote-tmux.ts
 * § `META`. No quoting: these become `execve` arguments, not shell words.
 */
export function metaArgs(cwd: string, slug: string): string[] {
  return [
    "-e",
    `${META.version}=${METADATA_VERSION}`,
    "-e",
    `${META.kind}=shell`,
    "-e",
    `${META.repo}=${slug}`,
    "-e",
    `${META.dir}=${cwd}`,
    // A job has no Claude conversation, so it will never have a title to adopt.
    // Marking it settled stops `ls` looking every time.
    "-e",
    "GJD_PROVISIONAL=0",
  ];
}

const HELP = [
  "tmux-job — run one long command in tmux, with a log, and let the session end",
  "",
  "  npx tsx scripts/tmux-job.ts [--name STEM] <command> [args…]",
  "",
  "  npx tsx scripts/tmux-job.ts npm test -- --reporter=dot",
  "  npx tsx scripts/tmux-job.ts npm run typecheck",
  "",
  "Prints the session name and the log path, then returns. Watch it with",
  "`tail -f <log>`; the last line is EXIT=<n>. The session disappears when the",
  "command finishes, so nothing accumulates on the box.",
].join("\n");

function main(): void {
  const argv = process.argv.slice(2);
  let given: string | undefined;
  if (argv[0] === "--name") {
    given = argv[1];
    argv.splice(0, 2);
    if (given === undefined || given === "") {
      console.error("--name needs a value");
      process.exit(1);
    }
  }
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const cwd = process.cwd();
  const session = jobName(cwd, new Date(), process.pid, given);
  mkdirSync(path.join(cwd, LOG_DIR), { recursive: true });
  const logPath = path.join(cwd, LOG_DIR, `${session}.log`);

  const repo = localRepo(cwd);
  const r = spawnSync(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      session,
      "-c",
      cwd,
      ...metaArgs(cwd, repo.kind === "repo" ? repo.slug : REPO_UNKNOWN),
      "sh",
      "-c",
      jobScript(argv, logPath),
    ],
    { stdio: "inherit" },
  );
  if (r.error || r.status !== 0) {
    console.error(`tmux would not start '${session}': ${r.error?.message ?? `exit ${r.status}`}`);
    process.exit(1);
  }

  console.log(`✓ ${session}`);
  console.log(`  ${logPath}`);
  console.log(`  tail -f ${logPath}      # the last line is EXIT=<n>`);
  console.log(`  tmux attach -t ${shq(`=${session}`)}   # to watch it directly`);
}

/**
 * Is this file the thing that was run, as opposed to imported by a test?
 *
 * `gjd-remote.ts` calls `main()` at import time and as a result nothing in it
 * can be unit-tested at all; this file is not repeating that.
 *
 * `fileURLToPath` rather than `.pathname`, which leaves a percent-encoded path
 * encoded, and `realpathSync` on both sides because `path.resolve` does not
 * follow symlinks — so invoking this through a symlink used to run nothing at
 * all and exit 0. Sol reproduced both. `realpathSync` throws if a path is gone,
 * which is not a reason to fail: fall back to comparing what we have.
 */
function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const canonical = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return canonical(invoked) === canonical(fileURLToPath(import.meta.url));
}

if (isMain()) main();
