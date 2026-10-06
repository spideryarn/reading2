/**
 * The hourly disk tidy on the box, `infra/hetzner/box-tidy.mjs`.
 *
 * It deletes files with nobody watching, so every test here runs the real
 * script against a temporary home and asks what is left on disk afterwards.
 * Three things it must never do are each a test: delete a file a live process
 * has open, delete anything when it cannot tell what is open, and delete
 * outside the four kinds of file Greg permitted.
 *
 * `provision.sh` carries a second copy of the script as a heredoc, because
 * `gjd-remote provision` sends that one file to the box and nothing else. The
 * first test holds the two equal.
 *
 * docs/plans/261006m-box-disk-hygiene-timer-and-a-rebuildable-box.md.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = `${REPO}infra/hetzner/box-tidy.mjs`;
const DAY = 24 * 60 * 60;
/** The script's clock, ten days from now: a directory made a moment ago then has an old ctime. */
const LATER = { BOX_TIDY_NOW_MS: String(Date.now() + 10 * DAY * 1000) };

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fake box: a home, a /tmp and a checkout, all under one temporary directory. */
function box() {
  const root = mkdtempSync(path.join(tmpdir(), "box-tidy-test-"));
  made.push(root);
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  const checkout = path.join(home, "code", "spideryarn2");
  const proc = path.join(root, "proc");
  for (const dir of [home, tmp, checkout, proc]) mkdirSync(dir, { recursive: true });
  return { root, home, tmp, checkout, proc };
}

/**
 * One process in the fake `/proc`: where it is standing, and what it has open.
 *
 * A fake rather than the real one because the real one cannot be read without
 * CAP_SYS_PTRACE (which the unit has and a test run does not), and because
 * "nothing is deleted when a process cannot be read" needs a process that
 * cannot be read.
 */
function fakeProcess(b: ReturnType<typeof box>, pid: number, cwd: string, open: string[] = []) {
  const dir = path.join(b.proc, String(pid));
  mkdirSync(path.join(dir, "fd"), { recursive: true });
  symlinkSync(cwd, path.join(dir, "cwd"));
  open.forEach((target, i) => symlinkSync(target, path.join(dir, "fd", String(i + 3))));
}

/** Write a file, or make a directory, and set its age in days. */
function aged(file: string, days: number, kind: "file" | "dir" = "file"): string {
  mkdirSync(kind === "dir" ? file : path.dirname(file), { recursive: true });
  if (kind === "file") writeFileSync(file, "x".repeat(100));
  const when = Date.now() / 1000 - days * DAY;
  utimesSync(file, when, when);
  return file;
}

function run(b: ReturnType<typeof box>, args: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "",
      BOX_TIDY_HOME: b.home,
      BOX_TIDY_TMP: b.tmp,
      BOX_TIDY_CHECKOUT: b.checkout,
      BOX_TIDY_HOME_MOUNT: b.home,
      BOX_TIDY_PROC: b.proc,
      BOX_TIDY_NPM: path.join(b.root, "no-such-npm"),
      ...env,
    },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

describe("the copy that reaches the box", () => {
  it("is the same bytes as the heredoc in provision.sh", () => {
    const provision = readFileSync(`${REPO}infra/hetzner/provision.sh`, "utf8");
    const open = "<<'BOX_TIDY_MJS'\n";
    const at = provision.indexOf(open);
    expect(at, "provision.sh has no <<'BOX_TIDY_MJS' heredoc").toBeGreaterThan(-1);
    const end = provision.indexOf("\nBOX_TIDY_MJS\n", at);
    expect(end, "the heredoc is never terminated at column zero").toBeGreaterThan(-1);
    expect(provision.slice(at + open.length, end + 1)).toBe(readFileSync(SCRIPT, "utf8"));
  });
});

describe("codex transcripts", () => {
  it("deletes rollouts older than a week, keeps newer ones and other files, and removes emptied directories", () => {
    const b = box();
    const sessions = path.join(b.home, ".codex", "sessions");
    const old = aged(path.join(sessions, "2026", "09", "20", "rollout-old.jsonl"), 8);
    const recent = aged(path.join(sessions, "2026", "10", "05", "rollout-new.jsonl"), 6);
    const other = aged(path.join(sessions, "2026", "10", "05", "notes.txt"), 30);
    const history = aged(path.join(b.home, ".codex", "thread_history_1.sqlite"), 30);

    const { status, out } = run(b);

    expect(status).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(path.join(sessions, "2026", "09"))).toBe(false);
    expect(existsSync(sessions)).toBe(true);
    for (const kept of [recent, other, history]) expect(existsSync(kept), kept).toBe(true);
    expect(out).toContain("codex transcripts: deleted 1 file(s)");
  });

  it("keeps an old rollout that a live process still has open", () => {
    const b = box();
    const held = aged(path.join(b.home, ".codex", "sessions", "rollout-held.jsonl"), 30);
    const free = aged(path.join(b.home, ".codex", "sessions", "rollout-free.jsonl"), 30);
    fakeProcess(b, 4242, "/", [held]);

    const { out } = run(b);

    expect(existsSync(held)).toBe(true);
    expect(existsSync(free)).toBe(false);
    expect(out).toContain("kept 1 that a live process has open");
  });

  it("does not follow a symlink out of the sessions directory", () => {
    const b = box();
    const outside = aged(path.join(b.root, "elsewhere", "rollout-precious.jsonl"), 30);
    mkdirSync(path.join(b.home, ".codex", "sessions"), { recursive: true });
    symlinkSync(path.dirname(outside), path.join(b.home, ".codex", "sessions", "link"));
    symlinkSync(outside, path.join(b.home, ".codex", "sessions", "rollout-link.jsonl"));

    run(b);

    expect(existsSync(outside)).toBe(true);
  });

  it("deletes nothing at all when it cannot tell what live processes have open", () => {
    const b = box();
    const old = aged(path.join(b.home, ".codex", "sessions", "rollout-old.jsonl"), 30);
    const dir = aged(path.join(b.tmp, "fake-codex-Ab3xQz"), 30, "dir");

    // A process whose descriptors cannot be listed: what `systemd --user` looks
    // like to a caller without CAP_SYS_PTRACE.
    fakeProcess(b, 4242, "/");
    chmodSync(path.join(b.proc, "4242", "fd"), 0o000);
    try {
      const { status, out } = run(b, [], LATER);
      expect(status).toBe(0);
      expect(existsSync(old)).toBe(true);
      expect(existsSync(dir)).toBe(true);
      expect(out).toContain("NOTHING DELETED");
      expect(out).toContain("cannot read process 4242");
    } finally {
      chmodSync(path.join(b.proc, "4242", "fd"), 0o755);
    }
  });

  it("deletes nothing when there is no /proc to ask", () => {
    const b = box();
    const old = aged(path.join(b.home, ".codex", "sessions", "rollout-old.jsonl"), 30);
    const { out } = run(b, [], { BOX_TIDY_PROC: path.join(b.root, "no-proc-here") });
    expect(existsSync(old)).toBe(true);
    expect(out).toContain("NOTHING DELETED");
  });

  it("deletes nothing on a dry run, and says what it would have", () => {
    const b = box();
    const old = aged(path.join(b.home, ".codex", "sessions", "rollout-old.jsonl"), 30);
    const { out } = run(b, ["--dry-run"]);
    expect(existsSync(old)).toBe(true);
    expect(out).toContain("codex transcripts: would delete 1 file(s)");
  });
});

describe("logs in the checkout", () => {
  it("deletes only old tmux job logs, and leaves every other record under logs/", () => {
    const b = box();
    const logs = path.join(b.checkout, "logs");
    const oldJob = aged(path.join(logs, "tmux-jobs", "gate-1.log"), 15);
    const newJob = aged(path.join(logs, "tmux-jobs", "gate-2.log"), 13);
    // The two kinds of record scripts/worktree-check.ts refuses to wave through:
    // a hand-edited judgement and a loop's dated ledger. Old, and not ours to delete.
    const verified = aged(path.join(logs, "changelog", "verified", "2026-09-01.json"), 40);
    const ledger = aged(path.join(logs, "loops", "get-ready-to-deploy", "2026-09-01.md"), 40);
    const nested = aged(path.join(logs, "tmux-jobs", "kept-dir", "something.log"), 40);
    const notLog = aged(path.join(logs, "tmux-jobs", "answer.md"), 40);

    run(b);

    expect(existsSync(oldJob)).toBe(false);
    for (const kept of [newJob, verified, ledger, nested, notLog]) expect(existsSync(kept), kept).toBe(true);
  });
});

describe("directories under /tmp", () => {
  it("removes an idle mkdtemp directory after three days, and nothing that is not one", () => {
    const b = box();
    // ctime cannot be backdated, so the script's clock is put ten days ahead
    // instead, and every age below is counted back from there (`LATER`).
    const stale = aged(path.join(b.tmp, "fake-codex-Ab3xQz"), 4 - 10, "dir");
    writeFileSync(path.join(stale, "inside.txt"), "x");
    utimesSync(stale, Date.now() / 1000 + 6 * DAY, Date.now() / 1000 + 6 * DAY);
    const fresh = aged(path.join(b.tmp, "run-codex-Zk9PqR"), 2 - 10, "dir");
    const typed = aged(path.join(b.tmp, "screenshots"), 20, "dir");
    const dated = aged(path.join(b.tmp, "run-202610"), 20, "dir");
    const scratch = aged(path.join(b.tmp, "claude-1000"), 20, "dir");
    const sockets = aged(path.join(b.tmp, "tmux-1000"), 20, "dir");
    const file = aged(path.join(b.tmp, "notes-Ab3xQz"), 20);

    const { out } = run(b, [], LATER);

    expect(existsSync(stale)).toBe(false);
    for (const kept of [fresh, typed, dated, scratch, sockets, file]) expect(existsSync(kept), kept).toBe(true);
    expect(out).toContain("tmp directories: removed 1 idle");
  });

  it("keeps a directory whose ctime is recent, whatever its mtime says", () => {
    const b = box();
    const touched = aged(path.join(b.tmp, "fake-codex-Ab3xQz"), 30, "dir");
    run(b);
    expect(existsSync(touched)).toBe(true);
  });

  it("keeps an old directory that a live process is standing in", () => {
    const b = box();
    const busy = aged(path.join(b.tmp, "launch-repo-Qw8ErT"), 30, "dir");
    const open = aged(path.join(b.tmp, "run-claude-Yu7IoP"), 30, "dir");
    const idle = aged(path.join(b.tmp, "fake-claude-Mn4BvC"), 30, "dir");
    fakeProcess(b, 4242, busy, [path.join(open, "deep", "output.log")]);

    const { out } = run(b, [], LATER);

    expect(existsSync(busy)).toBe(true);
    expect(existsSync(open)).toBe(true);
    expect(existsSync(idle)).toBe(false);
    expect(out).toContain("kept 2 that a live process is using");
  });
});

describe("the npm cache", () => {
  it("is left alone while /home has room", () => {
    const b = box();
    const marker = path.join(b.root, "npm-was-run");
    const fake = path.join(b.root, "fake-npm");
    writeFileSync(fake, `#!/bin/sh\necho "$@" > '${marker}'\n`, { mode: 0o755 });

    const { out } = run(b, [], { BOX_TIDY_NPM: fake, BOX_TIDY_TIGHT_PERCENT: "101" });

    expect(existsSync(marker)).toBe(false);
    expect(out).toContain("npm cache: left alone");
  });

  it("is cleaned with exactly `cache clean --force` when /home is tight, and a session is told what else could go", () => {
    const b = box();
    const marker = path.join(b.root, "npm-was-run");
    const fake = path.join(b.root, "fake-npm");
    writeFileSync(fake, `#!/bin/sh\necho "$@" > '${marker}'\n`, { mode: 0o755 });

    const { out } = run(b, [], { BOX_TIDY_NPM: fake, BOX_TIDY_TIGHT_PERCENT: "0" });

    expect(readFileSync(marker, "utf8").trim()).toBe("cache clean --force");
    expect(out).toContain("npm run worktree:sweep");
  });
});
