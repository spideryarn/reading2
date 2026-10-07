#!/usr/bin/env node
// box-tidy: the hourly disk tidy on the Hetzner box. Run by box-tidy.timer.
//
// Greg, 2026-10-06: "Perhaps add this and other measures to keep the hard disk
// fullness down to some routine daemon/service". The permissions each step
// rests on are quoted in docs/project/overseer.md, "Keeping /home from
// filling"; the plan is docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md.
//
// ONE FILE, NODE BUILT-INS ONLY, INSTALLED OUTSIDE THE CHECKOUT. provision.sh
// carries this file as a heredoc and installs it to
// /usr/local/lib/spideryarn/box-tidy.mjs. It must run when the checkout is
// mid-merge, red, or has no node_modules, because a full disk is when those
// happen. tests/box-tidy.test.ts holds the two copies equal and runs this one.
//
// WHAT IT DELETES, AND NOTHING ELSE:
//   1. Codex transcripts (~/.codex/sessions/**/rollout-*.jsonl) older than 7 days.
//   2. Captured stdout of finished tmux jobs (<checkout>/logs/tmux-jobs/*.log)
//      older than 14 days. Nothing else under logs/: the rest holds loop ledgers
//      and hand-written judgements that exist nowhere else (scripts/worktree-check.ts).
//   3. /tmp candidates are reported only. A mkdtemp-shaped name and old top-level
//      timestamps cannot prove that nested work is disposable or inactive.
//   4. The npm download cache, only when /home is at least 80% full.
// It never touches Docker (the local database is in Docker volumes), worktrees,
// Claude's transcripts or scratchpads. Those are reported, and a session decides.
//
// SELECTION GUARDS ON TRANSCRIPTS AND JOB LOGS:
//   - Only what this user owns, with symlink entries and ancestors refused.
//   - Paths observed in the /proc cwd/fd snapshot are kept. Unreadable
//     process evidence stops cleanup. This does not cover mappings or races.
//   - Age and inode identity are checked again immediately before unlink.
// These checks are snapshots, not a lock shared with the writers.
//
// It prints to stdout, so the log is the journal (`journalctl -u box-tidy`),
// which is on / and still writable when /home is full.

import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, readlinkSync, rmdirSync, statfsSync, unlinkSync } from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;

export const POLICY = {
  codexDays: 7,
  jobLogDays: 14,
  tmpDirDays: 3,
  /** /home at or above this: clean the npm cache, and say which worktrees could go. */
  tightPercent: 80,
  /** One run stops deleting /tmp directories after this long; the next hour carries on. */
  tmpBudgetMs: 10 * 60 * 1000,
};

/**
 * Whether a name looks like mkdtemp made it: it appends six characters drawn
 * from A-Z, a-z and 0-9 to the prefix it is given.
 *
 * Six lowercase letters are refused, and so are six digits, because a name
 * somebody typed (`screenshots`, `run-202610`) ends that way and a random
 * suffix almost never does: all-lowercase is one mkdtemp name in two hundred.
 * Those few are left for systemd's own 30-day sweep of /tmp.
 */
export function looksLikeMkdtemp(name) {
  const tail = /[A-Za-z0-9]{6}$/.exec(name)?.[0];
  return tail !== undefined && !/^[a-z]{6}$/.test(tail) && !/^[0-9]{6}$/.test(tail);
}
/** Never a candidate, whatever its age: scratchpads, sockets, and other programs' private trees. */
const TMP_KEEP = /^(claude-|tmux-|systemd-|snap|ssh-|\.)/;

function config(env) {
  const home = env.BOX_TIDY_HOME ?? userInfo().homedir;
  return {
    home,
    tmp: env.BOX_TIDY_TMP ?? "/tmp",
    checkout: env.BOX_TIDY_CHECKOUT ?? path.join(home, "code", "spideryarn2"),
    proc: env.BOX_TIDY_PROC ?? "/proc",
    npm: env.BOX_TIDY_NPM ?? "npm",
    homeMount: env.BOX_TIDY_HOME_MOUNT ?? "/home",
    uid: userInfo().uid,
  };
}

const say = (line) => console.log(line);
const gb = (bytes) => `${(bytes / 1e9).toFixed(2)} GB`;

/** Percent used and bytes free, the way `df` counts them, or null with the reason. */
export function diskOf(mount) {
  try {
    const s = statfsSync(mount);
    const used = s.blocks - s.bfree;
    const usable = used + s.bavail;
    return { percent: usable === 0 ? 0 : Math.ceil((used / usable) * 100), freeBytes: s.bavail * s.bsize };
  } catch (err) {
    return { why: err.message };
  }
}

/**
 * A snapshot of cwd and descriptor paths, without mapped files or namespace aliases.
 *
 * `ok: false` when any process could not be read for a reason other than
 * having exited: the caller must then delete nothing, because an unreadable
 * process and a process with nothing open look the same from here.
 *
 * Reading another process's `cwd` and `fd` links needs CAP_SYS_PTRACE, even
 * for some of this user's own (`systemd --user` is not dumpable), so
 * box-tidy.service grants it, and CAP_DAC_READ_SEARCH for root's. Run by hand without them,
 * this returns `ok: false` and the script deletes nothing, which is the
 * intended answer for a caller that cannot see.
 */
export function pathsInUse(procDir) {
  const inUse = new Set();
  let pids;
  try {
    pids = readdirSync(procDir).filter((n) => /^\d+$/.test(n));
  } catch (err) {
    return { ok: false, why: `cannot list ${procDir}: ${err.message}` };
  }
  for (const pid of pids) {
    const dir = path.join(procDir, pid);
    try {
      inUse.add(readlinkSync(path.join(dir, "cwd")));
      for (const fd of readdirSync(path.join(dir, "fd"))) {
        try {
          inUse.add(readlinkSync(path.join(dir, "fd", fd)));
        } catch (err) {
          if (err.code !== "ENOENT") throw err; // the descriptor closed under us
        }
      }
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ESRCH") {
        // A missing cwd/fd tree does not prove exit (zombies and unusual proc
        // layouts can still have a pid directory). Only a vanished pid may pass.
        try {
          lstatSync(dir);
        } catch (checkErr) {
          if (checkErr.code === "ENOENT" || checkErr.code === "ESRCH") continue;
          return { ok: false, why: `cannot confirm process ${pid} exited: ${checkErr.message}` };
        }
        try {
          const stat = readFileSync(path.join(dir, "stat"), "utf8");
          const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
          // A zombie task released its own cwd, descriptors and mappings, but
          // a zombie group leader can still have live sibling threads holding
          // files. /proc lists group leaders only. Skip it only when status
          // proves it is the group's sole remaining thread.
          if (fields[0] === "Z") {
            const threads = readFileSync(path.join(dir, "status"), "utf8")
              .split("\n").filter((line) => line.startsWith("Threads:"));
            if (threads.length === 1 && /^Threads:[ \t]+1[ \t]*$/.test(threads[0])) continue;
            // Live siblings: a multi-threaded process part way through exiting.
            // Each has its own cwd and fd links under task/<tid>; read those. A
            // sibling that is itself a zombie holds nothing. Anything that
            // cannot be read still stops the run.
            if (threads.length === 1 && /^Threads:[ \t]+[0-9]+[ \t]*$/.test(threads[0])) {
              let read = 0;
              for (const tid of readdirSync(path.join(dir, "task"))) {
                const task = path.join(dir, "task", tid);
                const tstat = readFileSync(path.join(task, "stat"), "utf8");
                if (tstat.slice(tstat.lastIndexOf(")") + 1).trim().split(/\s+/)[0] === "Z") continue;
                inUse.add(readlinkSync(path.join(task, "cwd")));
                for (const fd of readdirSync(path.join(task, "fd"))) inUse.add(readlinkSync(path.join(task, "fd", fd)));
                read += 1;
              }
              if (read > 0) continue;
            }
            return { ok: false, why: `cannot confirm zombie process ${pid} has no live threads` };
          }
          // Kernel threads normally have no cwd. Identify them positively via
          // stat field 9 (PF_KTHREAD), and require empty fd and maps readings.
          const flags = Number(fields[6]);
          if (Number.isInteger(flags) && (flags & 0x00200000) !== 0 &&
              readdirSync(path.join(dir, "fd")).length === 0 &&
              readFileSync(path.join(dir, "maps"), "utf8").trim() === "") continue;
        } catch {
          // Missing or unreadable evidence is still uncertainty, not exit.
        }
      }
      return { ok: false, why: `cannot read process ${pid}: ${err.message}` };
    }
  }
  return { ok: true, inUse };
}

/** Refuse symlinked ancestors as well as symlinked directory entries. */
function realDirectoryTree(dir) {
  let current = path.resolve(dir);
  for (;;) {
    try {
      if (!lstatSync(current).isDirectory()) return false;
    } catch {
      return false;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

/** Regular files under `root` (no symlink followed) for which `want(name)` is true. */
function filesUnder(root, want, recursive) {
  const out = [];
  const walk = (dir) => {
    if (!realDirectoryTree(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code !== "ENOENT") say(`  could not read ${dir}: ${err.message}`);
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (recursive) walk(full);
      } else if (e.isFile() && want(e.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Old enough, a regular file, and ours. Called twice: when listing, and again just before the unlink. */
function oldOwnFile(file, cutoffMs, uid) {
  if (!realDirectoryTree(path.dirname(file))) return null;
  try {
    const st = lstatSync(file);
    return st.isFile() && st.uid === uid && st.mtimeMs < cutoffMs ? st : null;
  } catch {
    return null;
  }
}

function deleteOldFiles({ label, files, days, nowMs, uid, inUse, dryRun }) {
  const cutoff = nowMs - days * DAY_MS;
  let count = 0;
  let bytes = 0;
  let kept = 0;
  for (const file of files) {
    const before = oldOwnFile(file, cutoff, uid);
    if (before === null) continue;
    if (inUse.has(file)) {
      kept += 1;
      continue;
    }
    const current = oldOwnFile(file, cutoff, uid); // it may have been appended to or replaced
    if (current === null || current.dev !== before.dev || current.ino !== before.ino) continue;
    try {
      if (!dryRun) unlinkSync(file);
      count += 1;
      bytes += current.size;
    } catch (err) {
      say(`  could not delete ${file}: ${err.message}`);
    }
  }
  say(`${label}: ${dryRun ? "would delete" : "deleted"} ${count} file(s), ${gb(bytes)}${kept ? `; kept ${kept} that a live process has open` : ""}`);
  return bytes;
}

/** Remove directories under `root` that are now empty, deepest first. Never `root` itself. */
function pruneEmptyDirs(root, ctx) {
  if (ctx.dryRun) return;
  const walk = (dir, isRoot) => {
    if (!realDirectoryTree(dir)) return;
    if (lstatSync(dir).uid !== ctx.uid) return;
    if ([...ctx.inUse].some((p) => p === dir || p.startsWith(dir + path.sep))) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), false);
    if (isRoot) return;
    try {
      rmdirSync(dir); // fails, harmlessly, on anything not empty
    } catch {
      /* not empty, or not ours */
    }
  };
  walk(root, true);
}

function stepCodex(cfg, ctx) {
  const root = path.join(cfg.home, ".codex", "sessions");
  const files = filesUnder(root, (n) => /^rollout-.*\.jsonl$/.test(n), true);
  const bytes = deleteOldFiles({ label: "codex transcripts", files, days: POLICY.codexDays, ...ctx });
  pruneEmptyDirs(root, ctx);
  return bytes;
}

function stepJobLogs(cfg, ctx) {
  const root = path.join(cfg.checkout, "logs", "tmux-jobs");
  const files = filesUnder(root, (n) => n.endsWith(".log"), false);
  return deleteOldFiles({ label: "tmux job logs", files, days: POLICY.jobLogDays, ...ctx });
}

function stepTmpDirs(cfg, ctx) {
  const cutoff = ctx.nowMs - POLICY.tmpDirDays * DAY_MS;
  const deadline = Date.now() + POLICY.tmpBudgetMs;
  const busyRoots = [...ctx.inUse].filter((p) => p.startsWith(cfg.tmp + path.sep));
  let names;
  try {
    names = readdirSync(cfg.tmp);
  } catch (err) {
    say(`tmp directories: could not read ${cfg.tmp}: ${err.message}`);
    return 0;
  }
  const stale = (full) => {
    try {
      const st = lstatSync(full);
      // mtime AND ctime: a directory whose entries changed, or that was renamed or chmod'ed, is not idle.
      return st.isDirectory() && st.uid === cfg.uid && st.mtimeMs < cutoff && st.ctimeMs < cutoff;
    } catch {
      return false;
    }
  };
  let count = 0;
  let kept = 0;
  let stoppedEarly = false;
  for (const name of names) {
    if (TMP_KEEP.test(name) || !looksLikeMkdtemp(name)) continue;
    const full = path.join(cfg.tmp, name);
    if (!stale(full)) continue;
    if (busyRoots.some((p) => p === full || p.startsWith(full + path.sep))) {
      kept += 1;
      continue;
    }
    if (Date.now() > deadline) {
      stoppedEarly = true;
      break;
    }
    if (!stale(full)) continue;
    // Report only: even a completely closed tree may be needed on resumption.
    // Recursive rm also crosses mount points, and a /proc snapshot can race.
    count += 1;
  }
  say(
    `tmp directories: report only; ${count} candidate(s) with top-level timestamps older than ${POLICY.tmpDirDays} days` +
      (kept ? `; kept ${kept} that a live process is using` : "") +
      (stoppedEarly ? "; stopped at the time budget, the next run carries on" : ""),
  );
  return 0; // Reporting does not reclaim bytes.
}

function stepNpmCache(cfg, ctx, homePercent) {
  if (homePercent === null || homePercent < ctx.tightPercent) {
    say(`npm cache: left alone (${cfg.homeMount} is ${homePercent ?? "unreadable"}${homePercent === null ? "" : "%"}, under ${ctx.tightPercent}%)`);
    return;
  }
  if (ctx.dryRun) {
    say(`npm cache: would run '${cfg.npm} cache clean --force' (${cfg.homeMount} is ${homePercent}%)`);
    return;
  }
  try {
    execFileSync(cfg.npm, ["cache", "clean", "--force"], { stdio: "ignore", timeout: 5 * 60 * 1000 });
    say(`npm cache: cleaned (${cfg.homeMount} was ${homePercent}%)`);
  } catch (err) {
    say(`npm cache: clean failed: ${err.message}`);
  }
}

function describe(mount) {
  const d = diskOf(mount);
  return "why" in d ? `${mount} unreadable (${d.why})` : `${mount} ${d.percent}% used, ${gb(d.freeBytes)} free`;
}

export function main(argv, env) {
  const dryRun = argv.includes("--dry-run");
  const cfg = config(env);
  // The clock can be set from outside so a test can make a directory's ctime, which nothing can backdate, old.
  const nowMs = env.BOX_TIDY_NOW_MS === undefined ? Date.now() : Number(env.BOX_TIDY_NOW_MS);
  const tightPercent = env.BOX_TIDY_TIGHT_PERCENT === undefined ? POLICY.tightPercent : Number(env.BOX_TIDY_TIGHT_PERCENT);
  say(`box-tidy ${dryRun ? "(dry run, nothing is deleted) " : ""}start: ${describe("/")}; ${describe(cfg.homeMount)}`);

  // Up to three looks. On a box running twenty sessions some process is usually
  // part way through starting or exiting, and one look that lands on it should
  // not cost the whole hour. Something that stays unreadable still stops the run.
  let use = pathsInUse(cfg.proc);
  for (let attempt = 1; !use.ok && attempt < 3; attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    use = pathsInUse(cfg.proc);
  }
  if (!use.ok) {
    say(`NOTHING DELETED: could not establish what live processes have open (${use.why})`);
  } else {
    const ctx = { nowMs, uid: cfg.uid, inUse: use.inUse, dryRun, tightPercent };
    for (const [name, step] of [["codex transcripts", stepCodex], ["tmux job logs", stepJobLogs], ["tmp directories", stepTmpDirs]]) {
      try {
        step(cfg, ctx);
      } catch (err) {
        say(`${name}: FAILED and skipped: ${err.message}`);
      }
    }
    const home = diskOf(cfg.homeMount);
    stepNpmCache(cfg, ctx, "why" in home ? null : home.percent);
  }

  const home = diskOf(cfg.homeMount);
  const root = diskOf("/");
  const tight = [home, root].some((d) => !("why" in d) && d.percent >= tightPercent);
  if (tight) {
    say(
      `A DISK IS AT ${tightPercent}% OR MORE. Not done here, for a session to decide: ` +
        "'npm run worktree:sweep' lists the worktrees that have landed their work and 'npm run worktree:remove' removes one; " +
        "'docker system df' shows unused images; 'npx tsx scripts/prune-old-screenshots.ts' lists week-old screenshots in git.",
    );
  }
  say(`box-tidy end: ${describe("/")}; ${describe(cfg.homeMount)}`);
  return 0;
}

if (process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url)) {
  // The kernel's name for this process, read by scripts/worktree-inuse.ts. Under
  // the unit this process holds capabilities, so its cwd is hidden from the
  // user's other processes, and a worktree removal that cannot place a hidden
  // process refuses. `box-tidy` is on that script's list of ones it knows.
  process.title = "box-tidy";
  process.exitCode = main(process.argv.slice(2), process.env);
}
