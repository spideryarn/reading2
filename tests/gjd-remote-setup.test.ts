/**
 * The durable half of `gjd-remote setup`.
 *
 * Two halves here, and the second is the one that matters. The first is the
 * ordinary table: a status file parsed strictly, a verdict for every arm. The
 * second RUNS THE GENERATED JOB SCRIPT, under this laptop's own bash, against a
 * temporary directory — because `bash -n` cannot see inside a heredoc, a shell
 * function that is never called is never checked at all, and every bug this
 * file exists to prevent lives in the ordering of the steps rather than in
 * their syntax. tests/gjd-remote-repo.test.ts runs `inventoryScript` for the
 * same reason.
 *
 * The rule under test throughout: **the verdict is the status file, not the
 * exit code and not the stream.** See docs/reusable/silent-success.md and
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  SETUP_EXIT,
  SETUP_PATH,
  type SetupStatus,
  describeVerdict,
  newSetupAttempt,
  parseSetupStatus,
  setupConfigSha256,
  setupJobScript,
  setupPaths,
  setupSlugFile,
  setupStatusPath,
  setupVerdict,
} from "../scripts/gjd-remote-setup.js";

const SLUG = "spideryarn/reading2";
/** The checkout the fixture status is about. */
const DIR = "/home/greg/code/spideryarn2";
const ATTEMPT = "3f1c0b6e-0a4d-4a1e-9f77-2c8b5a0d1e42";
const OTHER_ATTEMPT = "11111111-2222-3333-4444-555555555555";
const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
/** Piped into the job's stdin, and it must not come out anywhere. */
const STDIN_SENTINEL = "a-line-the-setup-command-must-not-read";

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "gjd-remote-setup-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ------------------------------------------------------------------ the file

/** A well-formed status file, with one thing changed. */
function statusText(over: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    v: 1,
    slug: SLUG,
    dir: DIR,
    attempt: ATTEMPT,
    configSha256: SHA,
    command: "npm ci && npm run setup",
    startedAt: "2026-09-02T10:00:00Z",
    finishedAt: "2026-09-02T10:04:11Z",
    outcome: "success",
    exitCode: 0,
    checkOutcome: "none",
    ...over,
  });
}

function refusal(text: string): string {
  const got = parseSetupStatus(text);
  expect(got.ok, `expected a refusal, got a status:\n${text}`).toBe(false);
  return got.ok ? "" : got.why;
}

describe("parseSetupStatus", () => {
  it("reads a finished, successful attempt", () => {
    const got = parseSetupStatus(statusText());
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable");
    expect(got.status.attempt).toBe(ATTEMPT);
    expect(got.status.outcome).toBe("success");
    expect(got.status.exitCode).toBe(0);
    expect(got.status.checkOutcome).toBe("none");
    expect(got.status.command).toBe("npm ci && npm run setup");
  });

  it("reads a live attempt, which carries none of the finishing fields", () => {
    const live = JSON.stringify({
      v: 1,
      slug: SLUG,
      dir: "/home/greg/code/spideryarn2",
      attempt: ATTEMPT,
      configSha256: SHA,
      command: "npm ci",
      startedAt: "2026-09-02T10:00:00Z",
      outcome: "started",
    });
    const got = parseSetupStatus(live);
    expect(got.ok).toBe(true);
    if (!got.ok) throw new Error("unreachable");
    expect(got.status.outcome).toBe("started");
    expect(got.status.finishedAt).toBeUndefined();
    expect(got.status.exitCode).toBeUndefined();
  });

  it("REFUSES a file cut off halfway through being written", () => {
    // The write is temp-file-then-rename precisely so this cannot happen, and
    // this is the clause that holds if it ever does. Half a JSON object is not
    // half an answer.
    const whole = statusText();
    const why = refusal(whole.slice(0, Math.floor(whole.length / 2)));
    expect(why).toContain("not JSON");
  });

  it("refuses an empty file", () => {
    expect(refusal("")).toContain("empty");
  });

  it("REFUSES a version it was not written against", () => {
    // A newer gjd-remote may mean something different by 'success'. Guessing
    // that the fields it happens to share still mean what they used to is how a
    // format change turns into a wrong verdict rather than an error.
    expect(refusal(statusText({ v: 2 }))).toContain("v=2");
    expect(refusal(JSON.stringify({ slug: SLUG, outcome: "success" }))).toContain("no 'v'");
  });

  it("refuses an outcome that is not one of the three", () => {
    const why = refusal(statusText({ outcome: "done" }));
    expect(why).toContain('"done"');
    expect(why).toContain("'started'");
  });

  it("refuses a field it does not understand", () => {
    expect(refusal(statusText({ ok: true }))).toContain("'ok'");
  });

  it("names the field that is missing", () => {
    expect(refusal(statusText({ dir: undefined }))).toContain("'dir'");
    expect(refusal(statusText({ dir: "   " }))).toContain("'dir'");
    expect(refusal(statusText({ attempt: undefined }))).toContain("'attempt'");
  });

  it("REFUSES a finished outcome with no exit code", () => {
    // The shape that would otherwise read as success: every other field is
    // present and says the setup worked, and the one that says HOW would be
    // read as `undefined`, which nothing compares against zero.
    expect(refusal(statusText({ exitCode: undefined }))).toContain("exitCode");
    expect(refusal(statusText({ finishedAt: undefined }))).toContain("finishedAt");
    expect(refusal(statusText({ checkOutcome: undefined }))).toContain("checkOutcome");
  });

  it("REFUSES a success that contradicts itself", () => {
    // Two fields disagreeing is not a status to pick the friendlier half of.
    expect(refusal(statusText({ exitCode: 3 }))).toContain("cannot both be true");
    expect(refusal(statusText({ checkOutcome: "failed" }))).toContain("cannot both be true");
  });

  it("refuses a live attempt that also claims to have finished", () => {
    const why = refusal(statusText({ outcome: "started" }));
    expect(why).toContain("still running");
  });

  it("refuses a slug that is not a repo, and a configSha256 that is not a hash", () => {
    expect(refusal(statusText({ slug: "unknown" }))).toContain("not an owner/name");
    expect(refusal(statusText({ slug: "../../etc" }))).toContain("not an owner/name");
    expect(refusal(statusText({ configSha256: "deadbeef" }))).toContain("not a sha256");
  });

  it("refuses an exit code that is not one", () => {
    expect(refusal(statusText({ outcome: "failed", exitCode: -1 }))).toContain("exitCode");
    expect(refusal(statusText({ outcome: "failed", exitCode: 1.5 }))).toContain("exitCode");
    expect(refusal(statusText({ outcome: "failed", exitCode: "3" }))).toContain("exitCode");
  });

  it("refuses JSON that is not an object", () => {
    expect(refusal("[1,2,3]")).toContain("not a JSON object");
    expect(refusal("null")).toContain("not a JSON object");
  });
});

// --------------------------------------------------------------- the verdict

/** A parsed status, built through the parser so the fixture cannot be a shape
 *  the real thing could never produce. */
function status(over: Partial<Record<string, unknown>> = {}): SetupStatus {
  const got = parseSetupStatus(statusText(over));
  if (!got.ok) throw new Error(`the fixture is not a valid status: ${got.why}`);
  return got.status;
}

describe("setupVerdict", () => {
  const ready = { attempt: null, configSha256: SHA, slug: SLUG, dir: DIR };

  it("never-run when there is no status file at all", () => {
    const v = setupVerdict(undefined, ready);
    expect(v.kind).toBe("never-run");
    expect(describeVerdict(v)).toContain("gjd-remote setup");
  });

  it("success for this config, whichever attempt made it so", () => {
    const v = setupVerdict(status(), ready);
    expect(v.kind).toBe("success");
    expect(v.remedy).toBeNull();
  });

  it("success when the attempt being watched is the one that wrote the file", () => {
    expect(setupVerdict(status(), { attempt: ATTEMPT, configSha256: SHA, slug: SLUG, dir: DIR }).kind).toBe("success");
  });

  it("STALE-ATTEMPT when the file is a previous run's, however healthy it looks", () => {
    // The whole reason the attempt id exists, and the one clause that can fire
    // on a file saying success. `gjd-remote setup` launched a job and is asking
    // about THAT job; a file from another one is not evidence about it.
    const v = setupVerdict(status(), { attempt: OTHER_ATTEMPT, configSha256: SHA, slug: SLUG, dir: DIR });
    expect(v.kind).toBe("stale-attempt");
    if (v.kind !== "stale-attempt") throw new Error("unreachable");
    expect(v.found).toBe(ATTEMPT);
    expect(v.why).toContain("never got as far as writing one");
  });

  it("in-progress for a live attempt, and points at ls rather than at waiting", () => {
    // A job whose pane was killed leaves `started` for ever, so the remedy
    // cannot be "wait": only tmux can tell a live attempt from a dead one.
    const v = setupVerdict(status({ outcome: "started", finishedAt: undefined, exitCode: undefined, checkOutcome: undefined }), ready);
    expect(v.kind).toBe("in-progress");
    if (v.kind !== "in-progress") throw new Error("unreachable");
    expect(v.attempt).toBe(ATTEMPT);
    expect(v.remedy).toContain("gjd-remote ls");
  });

  it("CONFIG-CHANGED when the repo now asks for something else", () => {
    // A success is a success at whatever it did. The repo changing its setup
    // line does not make the old run wrong; it makes it about a different
    // question. Readiness has to mean "for the config in front of me".
    const v = setupVerdict(status(), { attempt: null, configSha256: OTHER_SHA, slug: SLUG, dir: DIR });
    expect(v.kind).toBe("config-changed");
    expect(v.remedy).toContain("gjd-remote setup");
  });

  it("reports a live attempt before it reports a changed config", () => {
    // Both are "not ready", and the order decides which sentence the person
    // gets. Telling them to re-run setup while a run holds the lock sends them
    // into exit 75; telling them a run is under way lets them wait or look.
    const live = status({ outcome: "started", finishedAt: undefined, exitCode: undefined, checkOutcome: undefined });
    expect(setupVerdict(live, { attempt: null, configSha256: OTHER_SHA, slug: SLUG, dir: DIR }).kind).toBe("in-progress");
  });

  it("reports a stale attempt before anything else", () => {
    const v = setupVerdict(status({ configSha256: OTHER_SHA }), { attempt: OTHER_ATTEMPT, configSha256: SHA, slug: SLUG, dir: DIR });
    expect(v.kind).toBe("stale-attempt");
  });

  it("failed carries the exit code, and says so when it was the check that failed", () => {
    const plain = setupVerdict(status({ outcome: "failed", exitCode: 3, checkOutcome: "none" }), ready);
    expect(plain.kind).toBe("failed");
    if (plain.kind !== "failed") throw new Error("unreachable");
    expect(plain.exitCode).toBe(3);
    expect(plain.checkFailed).toBe(false);

    const checked = setupVerdict(status({ outcome: "failed", exitCode: 0, checkOutcome: "failed" }), ready);
    expect(checked.kind).toBe("failed");
    if (checked.kind !== "failed") throw new Error("unreachable");
    expect(checked.checkFailed).toBe(true);
    expect(checked.why).toContain("check failed");
  });

  // ---------------------------------------------- bound to THIS checkout

  /** The expectation `new-claude` would build for the fixture's own checkout. */
  const here = { attempt: null, configSha256: SHA, slug: SLUG, dir: DIR };

  it("success only when the file is about this repo, in this directory", () => {
    // The base case for the three below: all of slug, dir and inode agree, so
    // the success is evidence about the checkout in front of us.
    const v = setupVerdict(status({ checkoutInode: "12345" }), { ...here, checkoutInode: "12345" });
    expect(v.kind).toBe("success");
  });

  it("WRONG-CHECKOUT when the status is about another repo", () => {
    // Two repos can share a status file only by accident — a slug that was
    // mangled into the same file name, or a file copied about. Either way the
    // success it records was a success at something else.
    const v = setupVerdict(status(), { ...here, slug: "someone/else" });
    expect(v.kind).toBe("wrong-checkout");
    if (v.kind !== "wrong-checkout") throw new Error("unreachable");
    expect(v.field).toBe("slug");
    expect(v.found).toBe(SLUG);
    expect(v.wanted).toBe("someone/else");
  });

  it("WRONG-CHECKOUT when the status is about a different directory", () => {
    // `--dir` can point anywhere, and the status file is per-slug: a success
    // recorded for /home/greg/code/x says nothing about /tmp/y.
    const v = setupVerdict(status(), { ...here, dir: "/home/greg/other/tree" });
    expect(v.kind).toBe("wrong-checkout");
    if (v.kind !== "wrong-checkout") throw new Error("unreachable");
    expect(v.field).toBe("dir");
    expect(v.found).toBe(DIR);
  });

  it("WRONG-CHECKOUT, re-cloned, when the path is the same but the checkout is not", () => {
    // The one GPT Sol's finding 7 is really about: delete the checkout, clone
    // it again at the same path, and every field above still matches while the
    // tree has never had setup run in it. The .git inode is what changed.
    const v = setupVerdict(status({ checkoutInode: "12345" }), { ...here, checkoutInode: "67890" });
    expect(v.kind).toBe("wrong-checkout");
    if (v.kind !== "wrong-checkout") throw new Error("unreachable");
    expect(v.field).toBe("inode");
    expect(v.why).toContain("re-cloned");
    expect(describeVerdict(v)).toContain("gjd-remote setup");
  });

  it("does not invent an inode mismatch when either side never recorded one", () => {
    // A status written before this field existed, or a checkout with no .git to
    // stat, is not evidence of a re-clone. Only two inodes that disagree are.
    expect(setupVerdict(status(), { ...here, checkoutInode: "12345" }).kind).toBe("success");
    expect(setupVerdict(status({ checkoutInode: "12345" }), here).kind).toBe("success");
  });

  it("reports the wrong checkout before it reports a stale attempt", () => {
    // "This file is about another tree" beats every observation you could make
    // about the run that wrote it, including which run it was.
    const v = setupVerdict(status(), { ...here, slug: "someone/else", attempt: OTHER_ATTEMPT });
    expect(v.kind).toBe("wrong-checkout");
  });

  it("a failed attempt for an old config still reports config-changed", () => {
    // Which is right: re-running setup is the answer either way, and the
    // failure it is being asked about was a failure at a different question.
    const v = setupVerdict(status({ outcome: "failed", exitCode: 1, checkOutcome: "none" }), {
      attempt: null,
      configSha256: OTHER_SHA,
      slug: SLUG,
      dir: DIR,
    });
    expect(v.kind).toBe("config-changed");
  });
});

// ----------------------------------------------------------------- the paths

describe("paths and hashes", () => {
  it("puts the slash in a slug beyond reach of the file name", () => {
    expect(setupSlugFile("spideryarn/reading2")).toBe("spideryarn--reading2");
    // '--' rather than '-', because a/b and a-b are both legal slugs and would
    // otherwise share one readiness record.
    expect(setupSlugFile("a/b")).not.toBe(setupSlugFile("a-b/c"));
  });

  it("refuses a repo that is not one, and refuses 'unknown'", () => {
    expect(() => setupSlugFile("unknown")).toThrow(/nothing to set up/);
    expect(() => setupSlugFile("../../etc/passwd")).toThrow(/owner\/name/);
    expect(() => setupSlugFile("nope")).toThrow(/owner\/name/);
  });

  it("keeps the temp file beside the status file, because mv is only atomic within one filesystem", () => {
    const p = setupPaths({ work: "/home/greg/gjd-remote", slug: SLUG, attempt: ATTEMPT });
    expect(p.statusPath).toBe("/home/greg/gjd-remote/setup/spideryarn--reading2.json");
    expect(p.tmpPath.startsWith(`${p.setupDir}/`)).toBe(true);
    expect(p.lockPath).toBe("/home/greg/gjd-remote/locks/setup-spideryarn--reading2.lock");
    expect(p.logPath).toContain(ATTEMPT);
    expect(setupStatusPath("/home/greg/gjd-remote", SLUG)).toBe(p.statusPath);
  });

  it("refuses an attempt id that would climb out of the directory", () => {
    expect(() => setupPaths({ work: "/w", slug: SLUG, attempt: "../../x" })).toThrow(/attempt id/);
    expect(() => setupPaths({ work: "/w", slug: SLUG, attempt: "" })).toThrow(/attempt id/);
  });

  it("mints attempt ids the paths accept", () => {
    expect(() => setupPaths({ work: "/w", slug: SLUG, attempt: newSetupAttempt() })).not.toThrow();
    expect(newSetupAttempt()).not.toBe(newSetupAttempt());
  });

  it("hashes the check as well as the setup command", () => {
    // A repo that changed only its check is a repo whose last success proved
    // something different, so it must not hash the same.
    const a = setupConfigSha256("npm ci", undefined);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(setupConfigSha256("npm ci", "npm run doctor")).not.toBe(a);
    expect(setupConfigSha256("npm ci", undefined)).toBe(a);
  });
});

// -------------------------------------------------- the job script, run for real

/**
 * `flock` is a util-linux program and macOS does not have one. The box does, so
 * the script is written for the real thing; here it is stood in for by six
 * lines of python doing the one call the script makes — `flock(fd, LOCK_EX |
 * LOCK_NB)` on an inherited descriptor, which is exactly what `flock -n 9` is.
 *
 * The shim is only put on PATH when there is no real flock, so on Linux (the
 * box, and CI) these tests exercise the genuine article and the shim is never
 * built. Written down because a lock proved only against a stand-in is a lock
 * with one assumption untested: that the box's flock and this one agree.
 */
const FLOCK_SHIM = `#!/usr/bin/env python3
import fcntl, sys
a = sys.argv[1:]
if a[:1] != ["-n"] or len(a) != 2:
    sys.stderr.write("shim flock: only 'flock -n <fd>' is supported, got %r\\n" % (a,))
    sys.exit(64)
try:
    fcntl.flock(int(a[1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(1)
sys.exit(0)
`;

/** Exit 0 if the lock is free, 1 if somebody holds it. The outside observer for
 *  "the lock's lifetime is the work, not the pane". */
const FLOCK_TRY = `#!/usr/bin/env python3
import fcntl, sys
f = open(sys.argv[1], "a")
try:
    fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    sys.exit(1)
sys.exit(0)
`;

/** Takes the lock and holds it until it is killed, so the job under test meets
 *  a genuinely contended lock rather than a simulated one. */
const FLOCK_HOLDER = `#!/usr/bin/env python3
import fcntl, sys, time
f = open(sys.argv[1], "a")
fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
sys.stdout.write("held\\n")
sys.stdout.flush()
time.sleep(120)
`;

/**
 * `flock -u 9` — releases the lock on an INHERITED descriptor, which is the
 * whole of GPT Sol's finding 6: the lock lives on the open file description, so
 * anything holding a copy of fd 9 can drop it for everybody.
 *
 * Python rather than `flock -u`, and invoked by absolute path, because the
 * setup command's environment is `env -i PATH=SETUP_PATH` — on this Mac there
 * is no flock on that PATH at all, and a `flock -u 9` that failed with
 * "command not found" would leave the lock held and pass this test for exactly
 * the wrong reason.
 */
const FLOCK_UNLOCK = `#!/usr/bin/env python3
import fcntl, sys
fcntl.flock(int(sys.argv[1]), fcntl.LOCK_UN)
sys.stderr.write("unlocked fd %s\\n" % sys.argv[1])
`;

function have(program: string): boolean {
  return spawnSync("sh", ["-c", `command -v ${program} >/dev/null 2>&1`]).status === 0;
}

/** The absolute path to a program, for the commands that run under `env -i`
 *  with only SETUP_PATH and cannot look one up. */
function whichAbs(program: string): string {
  const r = spawnSync("sh", ["-c", `command -v ${program}`], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

const HAVE_REAL_FLOCK = have("flock");
const HAVE_PYTHON = have("python3");
const HAVE_GIT = have("git");
const PYTHON3 = HAVE_PYTHON ? whichAbs("python3") : "";

let jobRoot: string;
let shimDir: string | null = null;
let runPath: string;
/** The python that drops fd 9's lock, written once and named by the setup
 *  commands that try to release the lock out from under the job. */
let unlockPath: string;

beforeAll(() => {
  jobRoot = mkdtempSync(join(root, "jobs-"));
  if (!HAVE_REAL_FLOCK && HAVE_PYTHON) {
    shimDir = join(jobRoot, "shim");
    mkdirSync(shimDir);
    const f = join(shimDir, "flock");
    writeFileSync(f, FLOCK_SHIM);
    chmodSync(f, 0o755);
  }
  runPath = shimDir ? `${shimDir}:${process.env.PATH ?? ""}` : (process.env.PATH ?? "");
  unlockPath = join(jobRoot, "unlock9.py");
  writeFileSync(unlockPath, FLOCK_UNLOCK);
  chmodSync(unlockPath, 0o755);
});

type Job = ReturnType<typeof buildJob>;

/** One attempt's worth of files, and the script that would run on the box. */
function buildJob(o: {
  name: string;
  command: string;
  check?: string;
  dir?: string;
  attempt?: string;
  work?: string;
  /** Stands in for the login shell the box's pane gets. See SETUP_AFTERWARDS. */
  afterwards?: string;
}) {
  const work = o.work ?? mkdtempSync(join(jobRoot, `${o.name}-`));
  const dir = o.dir ?? join(work, "checkout");
  if (o.dir === undefined) mkdirSync(dir, { recursive: true });
  const attempt = o.attempt ?? ATTEMPT;
  const paths = setupPaths({ work, slug: SLUG, attempt });
  const configSha256 = setupConfigSha256(o.command, o.check);
  const script = setupJobScript({
    slug: SLUG,
    dir,
    attempt,
    command: o.command,
    ...(o.check === undefined ? {} : { check: o.check }),
    ...(o.afterwards === undefined ? {} : { afterwards: o.afterwards }),
    configSha256,
    home: work,
    user: "greg",
    ...paths,
  });
  const jobPath = join(work, "job.sh");
  writeFileSync(jobPath, script);
  return { work, dir, attempt, configSha256, paths, jobPath, script };
}

/** Run it the way tmux would, with nothing on stdin — which is also what makes
 *  the script's final `exec bash -l` return rather than sit at a prompt. */
function runJob(job: Job): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bash", [job.jobPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: runPath },
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The status file, through the parser. Never read raw: the parser is the thing
 *  the CLI will use, so a fixture the parser would refuse must fail here too. */
function readStatus(job: Job): SetupStatus {
  const got = parseSetupStatus(readFileSync(job.paths.statusPath, "utf8"));
  if (!got.ok) throw new Error(`the job wrote a status the parser refuses: ${got.why}`);
  return got.status;
}

const holders: ChildProcess[] = [];
afterEach(() => {
  while (holders.length) holders.pop()?.kill("SIGKILL");
});

describe("setupJobScript, run for real", () => {
  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("records a success, with no check defined", () => {
    // The command PRINTS a token it does not contain, because the job echoes
    // the command before running it: a token that is in the command text
    // reaches the log and the pane whether the command ran or not, and an
    // assertion on one proves only that the echo happened.
    const job = buildJob({ name: "ok", command: "printf 'setup-%s\\n' ran-and-printed" });
    const r = runJob(job);
    const s = readStatus(job);

    expect(s.outcome).toBe("success");
    expect(s.exitCode).toBe(0);
    // 'none' is not a pass. The repo defined no check, and the verdict has to
    // be able to say that rather than imply one ran.
    expect(s.checkOutcome).toBe("none");
    expect(s.attempt).toBe(job.attempt);
    expect(s.configSha256).toBe(job.configSha256);
    expect(s.dir).toBe(job.dir);
    expect(readFileSync(job.paths.logPath, "utf8")).toContain("setup-ran-and-printed");
    expect(r.stdout).toContain("setup-ran-and-printed");
    // The verdict the CLI would reach.
    expect(setupVerdict(s, { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir }).kind).toBe("success");
    // And the temp file is gone, not left beside the real one.
    expect(existsSync(job.paths.tmpPath)).toBe(false);
  });

  it.skipIf((!HAVE_REAL_FLOCK && !HAVE_PYTHON) || !HAVE_GIT)(
    "records WHICH checkout it set up, not just where it was",
    () => {
      // GPT Sol's finding 7, the half that lives on the box. Delete the
      // checkout, clone it again at the same path, and the slug, the directory
      // and the config hash all still match a success that was about a tree
      // which no longer exists. The `.git` inode is the one thing a re-clone
      // cannot reproduce, so the job records it while it is standing in the
      // tree it is setting up.
      const job = buildJob({ name: "inode", command: "echo set-up-fine" });
      const init = spawnSync("git", ["init", "-q", job.dir], { encoding: "utf8" });
      expect(init.status, init.stderr).toBe(0);
      runJob(job);
      const s = readStatus(job);
      expect(s.outcome).toBe("success");
      const inode = s.checkoutInode;
      if (inode === undefined) throw new Error("the job recorded no checkoutInode");
      expect(inode).toBe(String(statSync(join(job.dir, ".git")).ino));
      expect(s.checkoutRoot).toBe(realpathSync(job.dir));

      const asked = { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir };
      expect(setupVerdict(s, { ...asked, checkoutInode: inode }).kind).toBe("success");
      // What Stage 3's fresh clone must not be able to skip.
      expect(setupVerdict(s, { ...asked, checkoutInode: "0" }).kind).toBe("wrong-checkout");
    },
  );

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("records the setup command's own exit code", () => {
    const job = buildJob({ name: "exit3", command: "echo starting-anyway; exit 3" });
    runJob(job);
    const s = readStatus(job);
    expect(s.outcome).toBe("failed");
    expect(s.exitCode).toBe(3);
    expect(s.checkOutcome).toBe("none");
    const v = setupVerdict(s, { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir });
    expect(v.kind).toBe("failed");
    if (v.kind !== "failed") throw new Error("unreachable");
    expect(v.exitCode).toBe(3);
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("runs the check, and fails on it even when setup exited 0", () => {
    const job = buildJob({
      name: "checkfail",
      command: "echo set-up-fine",
      check: "printf 'check-%s\\n' ran-and-printed; exit 1",
    });
    runJob(job);
    const s = readStatus(job);
    expect(s.exitCode).toBe(0);
    expect(s.checkOutcome).toBe("failed");
    expect(s.outcome).toBe("failed");
    expect(readFileSync(job.paths.logPath, "utf8")).toContain("check-ran-and-printed");
    const v = setupVerdict(s, { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir });
    if (v.kind !== "failed") throw new Error(`expected failed, got ${v.kind}`);
    expect(v.checkFailed).toBe(true);
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("passes when both the command and the check pass", () => {
    const job = buildJob({ name: "checkok", command: "echo set-up-fine", check: "echo all-well" });
    runJob(job);
    const s = readStatus(job);
    expect(s.outcome).toBe("success");
    expect(s.checkOutcome).toBe("success");
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("does not run the check when setup failed", () => {
    const job = buildJob({ name: "nocheck", command: "exit 4", check: "echo should-not-run" });
    runJob(job);
    const s = readStatus(job);
    expect(s.outcome).toBe("failed");
    expect(s.checkOutcome).toBe("none");
    expect(readFileSync(job.paths.logPath, "utf8")).not.toContain("should-not-run");
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("cannot be talked into a verdict by what the setup command prints", () => {
    // The stream is not the verdict, and this is the sentence that says so.
    // The command prints a whole well-formed status claiming success for
    // another attempt, on stdout, where the pane and the log both see it — and
    // the file on disk still says what actually happened.
    const forged = JSON.stringify({
      v: 1,
      slug: SLUG,
      dir: "/home/greg/code/spideryarn2",
      attempt: OTHER_ATTEMPT,
      configSha256: SHA,
      command: "true",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:01Z",
      outcome: "success",
      exitCode: 0,
      checkOutcome: "success",
    });
    const job = buildJob({ name: "forge", command: `printf '%s\\n' '${forged}'; exit 9` });
    const r = runJob(job);
    expect(r.stdout).toContain('"outcome":"success"');
    const s = readStatus(job);
    expect(s.outcome).toBe("failed");
    expect(s.exitCode).toBe(9);
    expect(s.attempt).toBe(job.attempt);
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("gives the setup command a small explicit environment and no stdin", () => {
    // env -i, so nothing of tmux's environment reaches the repo's setup
    // command and what runs is what the config asked for. And </dev/null,
    // because a setup that stops to ask a question in a pane nobody is watching
    // hangs for ever.
    const job = buildJob({
      name: "env",
      // GJD_SETUP_LEAK is exported into the JOB's environment below; the
      // brackets are there so an empty expansion and an absent one look the
      // same in the output, which under `env -i` they should.
      command:
        "printf 'PATH=%s TERM=%s SEEN=[%s]\\n' \"$PATH\" \"$TERM\" \"$GJD_SETUP_LEAK\"; read x && echo \"READ:$x\" || echo STDIN-IS-EMPTY",
    });
    // Stdin is PIPED WITH SOMETHING IN IT, not left empty, because leaving it
    // empty is how this test passes on a script that forgot `</dev/null`: the
    // harness would have supplied the emptiness the script is supposed to. On
    // the box the job's stdin is a tmux pane, which is worse than a pipe.
    const r = spawnSync("bash", [job.jobPath], {
      encoding: "utf8",
      input: `${STDIN_SENTINEL}\n`,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: runPath, GJD_SETUP_LEAK: "this-must-not-arrive" },
      timeout: 60_000,
    });
    expect(r.stdout).toContain(`PATH=${SETUP_PATH}`);
    expect(r.stdout).toContain("TERM=dumb");
    expect(r.stdout).toContain("SEEN=[]");
    expect(r.stdout).not.toContain("this-must-not-arrive");
    expect(r.stdout).toContain("STDIN-IS-EMPTY");
    // The sentinel, not the word READ: the job echoes the command it is about
    // to run, so any token that is IN the command appears on stdout whether it
    // leaked or not. Only the line we piped in can tell the two apart.
    expect(r.stdout).not.toContain(STDIN_SENTINEL);
    expect(readStatus(job).outcome).toBe("success");
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("carries a command containing quotes through unharmed", () => {
    const job = buildJob({ name: "quotes", command: `echo "it's \\$HOME and 'quoted'"` });
    const r = runJob(job);
    expect(r.stdout).toContain("it's $HOME and 'quoted'");
    const s = readStatus(job);
    expect(s.outcome).toBe("success");
    expect(s.command).toBe(`echo "it's \\$HOME and 'quoted'"`);
  });

  it("REFUSES to run, and writes nothing, when it cannot enter the checkout", () => {
    // chmod 000 rather than a missing directory, because that is the case
    // `test -d` passes and `cd` refuses — the hole cdGuard() in
    // scripts/gjd-remote.ts exists for. No status file, because nothing was set
    // up: `never-run` is the honest verdict, and a `failed` one would send a
    // reader looking for a log that has nothing in it.
    const shut = mkdtempSync(join(jobRoot, "shut-"));
    const inner = join(shut, "checkout");
    mkdirSync(inner);
    chmodSync(inner, 0o000);
    try {
      const job = buildJob({ name: "cd", command: "echo should-never-run", dir: inner });
      const r = runJob(job);
      expect(r.status).toBe(SETUP_EXIT.unusable);
      expect(r.stderr).toContain("no status written");
      expect(r.stderr).toContain("cannot enter");
      expect(existsSync(job.paths.statusPath)).toBe(false);
      expect(setupVerdict(undefined, { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir }).kind).toBe("never-run");
    } finally {
      chmodSync(inner, 0o755);
    }
  });

  it.skipIf(!HAVE_PYTHON)("REFUSES a second setup while another holds the lock, and writes nothing", async () => {
    // Two `npm ci` runs racing in one tree is how a half-installed checkout
    // gets a `success`. Exit 75 rather than queueing: a second person should be
    // told, not left behind a twenty-minute install with no output.
    const job = buildJob({ name: "locked", command: "echo should-never-run" });
    mkdirSync(job.paths.locksDir, { recursive: true });

    const holderPath = join(job.work, "holder.py");
    writeFileSync(holderPath, FLOCK_HOLDER);
    const holder = spawn("python3", [holderPath, job.paths.lockPath], { stdio: ["ignore", "pipe", "pipe"] });
    holders.push(holder);
    await new Promise<void>((resolve, reject) => {
      let seen = "";
      holder.stdout?.on("data", (d: Buffer) => {
        seen += d.toString();
        if (seen.includes("held")) resolve();
      });
      holder.stderr?.on("data", (d: Buffer) => reject(new Error(`the holder could not take the lock: ${d}`)));
      holder.on("exit", (code) => reject(new Error(`the holder exited early (${code})`)));
      setTimeout(() => reject(new Error("the holder never said it had the lock")), 15_000);
    });

    const r = runJob(job);
    expect(r.status).toBe(SETUP_EXIT.locked);
    expect(r.stderr).toContain("already holds");
    expect(r.stderr).toContain("no status written");
    expect(existsSync(job.paths.statusPath)).toBe(false);
    expect(existsSync(job.paths.logPath)).toBe(false);
  });

  it.skipIf(!HAVE_PYTHON)("releases the lock when the work finishes, not when the pane closes", async () => {
    // THE PANE OUTLIVES THE WORK, ON PURPOSE — the job ends by `exec`ing a
    // login shell so the tmux session stays readable. The bug this pins is that
    // the shell used to inherit fd 9 and so the LOCK outlived the work too: a
    // second `gjd-remote setup` for the same repo hit exit 75 half a second in,
    // inside a pane that then vanished, which reached the laptop as "the job
    // did not survive starting". Found against the box on 2026-09-02.
    //
    // `exec sleep` rather than `exec bash -l`, because a login shell handed a
    // closed stdin exits at once — and a pane that is already gone would pass
    // this test for entirely the wrong reason.
    const job = buildJob({
      name: "lock-release",
      command: "echo work-done",
      afterwards: "printf 'pane-alive\\n'; exec sleep 30",
    });
    const pane = spawn("bash", [job.jobPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: runPath },
    });
    holders.push(pane);

    // Waited for on the PANE'S OWN OUTPUT rather than on the status file: the
    // file is written several lines before fd 9 is closed, so polling for it
    // would race the very statement under test. This marker is printed by the
    // process that inherited whatever the job left open.
    await new Promise<void>((resolve, reject) => {
      let seen = "";
      pane.stdout?.on("data", (d: Buffer) => {
        seen += d.toString();
        if (seen.includes("pane-alive")) resolve();
      });
      pane.on("exit", (code) => reject(new Error(`the pane exited before it said it was alive (${code})`)));
      setTimeout(() => reject(new Error("the pane never printed its marker")), 15_000);
    });

    // The work really did finish, and the pane really is still there — without
    // both of these the lock being free would prove nothing.
    expect(readStatus(job).outcome).toBe("success");
    expect(pane.exitCode).toBe(null);

    const tryPath = join(job.work, "trylock.py");
    writeFileSync(tryPath, FLOCK_TRY);
    const second = spawnSync("python3", [tryPath, job.paths.lockPath], { encoding: "utf8" });
    expect(second.stderr).toBe("");
    expect(second.status).toBe(0);
  });

  it.skipIf(!HAVE_PYTHON)("does not let the setup command release the lock it is running under", async () => {
    // GPT Sol's finding 6. The lock is an open file description, so ANY process
    // holding a copy of fd 9 can drop it for everybody — including the repo's
    // own setup command, which the job runs as a child and which therefore
    // inherited the descriptor. One `flock -u 9` in a repo's setup script (or a
    // `tee` that outlives it) and a second `gjd-remote setup --force` runs `npm
    // ci` in the same tree at the same time, which is the half-installed
    // checkout the lock exists to prevent.
    //
    // So the command is given no fd 9 at all, and this test asks the command
    // itself what it can see and then asks an OUTSIDE observer whether the lock
    // is still held — because "the unlock failed" and "the unlock never ran"
    // look identical from inside.
    const job = buildJob({
      name: "unlock",
      // Every marker is SPLIT ACROSS printf's format and its argument, because
      // the job echoes the command before running it: a token that appears in
      // the command text arrives on stdout whether the command ran or not, and
      // this test would then wait for its own echo and assert on it.
      command:
        `if [ -e /dev/fd/9 ]; then printf 'fd9-%s\\n' OPEN; else printf 'fd9-%s\\n' CLOSED; fi; ` +
        `${PYTHON3} ${unlockPath} 9; printf 'unlock-%s\\n' tried; sleep 20`,
    });
    const pane = spawn("bash", [job.jobPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: runPath },
      detached: true,
    });
    holders.push(pane);

    let seen = "";
    try {
      await new Promise<void>((resolve, reject) => {
        pane.stdout?.on("data", (d: Buffer) => {
          seen += d.toString();
          if (seen.includes("unlock-tried")) resolve();
        });
        pane.on("exit", (code) => reject(new Error(`the pane exited before it tried the unlock (${code}): ${seen}`)));
        setTimeout(() => reject(new Error(`the unlock was never tried: ${seen}`)), 20_000);
      });

      // The command could not even see the descriptor, and the unlocker said so
      // out loud. Without this second half the test would also pass on a python
      // that never started.
      expect(seen).toContain("fd9-CLOSED");
      expect(seen).not.toContain("fd9-OPEN");
      expect(seen).toContain("Bad file descriptor");
      expect(seen).not.toContain("unlocked fd 9");

      // And the lock is still held, from outside, while the command runs.
      const tryPath = join(job.work, "trylock.py");
      writeFileSync(tryPath, FLOCK_TRY);
      const observer = spawnSync("python3", [tryPath, job.paths.lockPath], { encoding: "utf8" });
      expect(observer.stderr).toBe("");
      expect(observer.status, "the setup command released the setup lock").toBe(1);
    } finally {
      if (pane.pid !== undefined) {
        try {
          process.kill(-pane.pid, "SIGKILL");
        } catch {
          // Already gone; the assertions above say whether that mattered.
        }
      }
    }
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("records the command's exit code even when the log cannot be written", () => {
    // GPT Sol's finding 8. `pipefail` returns the RIGHTMOST non-zero status, so
    // when the command fails and `tee` fails too, the status file gets tee's
    // exit code and the reader is told the repo's setup exited 1 when it
    // exited 3. Two different failures, and only one of them is the repo's.
    const work = mkdtempSync(join(jobRoot, "teefail-"));
    const paths = setupPaths({ work, slug: SLUG, attempt: ATTEMPT });
    mkdirSync(paths.setupDir, { recursive: true });
    // A directory where the log file should be: `tee -a` cannot open it, and
    // fails on every step for the whole run.
    mkdirSync(paths.logPath);
    const job = buildJob({ name: "teefail", work, command: "exit 3" });
    runJob(job);
    const s = readStatus(job);
    expect(s.exitCode).toBe(3);
    expect(s.toolFailure).toBe("log");
    // A run whose log went nowhere is not a success, whatever the command said.
    expect(s.outcome).toBe("failed");
    const v = setupVerdict(s, { attempt: job.attempt, configSha256: job.configSha256, slug: SLUG, dir: job.dir });
    expect(v.kind).toBe("failed");
    expect(v.why).toContain("log");
  });

  it.skipIf(HAVE_REAL_FLOCK)("says so, distinctly, when the box has no flock at all", () => {
    // Without this clause a missing flock would come out of `flock -n 9` as
    // 'command not found' ⇒ non-zero ⇒ "another setup holds the lock", which is
    // a true-sounding sentence about a box that has no lock at all. Runs only
    // where flock is genuinely absent (this Mac); on the box it skips, because
    // there is no honest way to hide /usr/bin/flock from the script.
    const job = buildJob({ name: "noflock", command: "echo should-never-run" });
    const r = spawnSync("bash", [job.jobPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: process.env.PATH ?? "" },
      timeout: 60_000,
    });
    expect(r.status).toBe(SETUP_EXIT.noFlock);
    expect(r.status).not.toBe(SETUP_EXIT.locked);
    expect(r.stderr).toContain("flock is not on this box");
    expect(existsSync(job.paths.statusPath)).toBe(false);
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("leaves 'started' behind when it is killed mid-run", async () => {
    // The reason the started status is written BEFORE the command rather than
    // rolled into the final one. A box that reboots during `npm ci`, or a pane
    // somebody closes, must not look like a repo nobody ever tried to set up —
    // and it must not look like a repo that is ready. `in-progress` is the
    // honest answer, and only tmux can then say whether it is still true.
    const job = buildJob({ name: "killed", command: "sleep 45" });
    const child = spawn("bash", [job.jobPath], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, PATH: runPath },
      detached: true,
    });
    holders.push(child);
    const deadline = Date.now() + 15_000;
    while (!existsSync(job.paths.statusPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    // The whole process group: killing the job's bash alone leaves its `sleep`
    // and `tee` behind, and the test would then be about a job that is still
    // half-running.
    if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");

    const s = readStatus(job);
    expect(s.outcome).toBe("started");
    expect(s.finishedAt).toBeUndefined();
    const v = setupVerdict(s, { attempt: null, configSha256: job.configSha256, slug: SLUG, dir: job.dir });
    expect(v.kind).toBe("in-progress");
    expect(describeVerdict(v)).toContain("gjd-remote ls");
  });

  it.skipIf(!HAVE_REAL_FLOCK && !HAVE_PYTHON)("says out loud when it could not write the final status", () => {
    // A status file that cannot be written is the one case where the job knows
    // something and has nowhere to put it, so it has to say so on the pane. The
    // setup command here takes the write permission away from the status
    // directory mid-run, which is exactly what the temp-file-then-rename write
    // needs and what a bare `> "$status"` would not — so this also proves the
    // rename is doing the publishing.
    const work = mkdtempSync(join(jobRoot, "unwritable-"));
    const paths = setupPaths({ work, slug: SLUG, attempt: ATTEMPT });
    const job = buildJob({ name: "unwritable", work, command: `chmod 500 ${paths.setupDir}` });
    try {
      const r = runJob(job);
      expect(r.stderr).toContain("no status written because");
      expect(r.stderr).toContain(paths.statusPath);
      // And the earlier verdict survived rather than being half-overwritten.
      const s = readStatus(job);
      expect(s.outcome).toBe("started");
      expect(setupVerdict(s, { attempt: null, configSha256: job.configSha256, slug: SLUG, dir: job.dir }).kind).toBe("in-progress");
    } finally {
      chmodSync(paths.setupDir, 0o755);
    }
  });

  it("refuses to build a script for a command that would become shell syntax", () => {
    const base = {
      slug: SLUG,
      dir: "/home/greg/code/spideryarn2",
      attempt: ATTEMPT,
      configSha256: SHA,
      home: "/home/greg",
      user: "greg",
      ...setupPaths({ work: "/home/greg/gjd-remote", slug: SLUG, attempt: ATTEMPT }),
    };
    expect(() => setupJobScript({ ...base, command: "a\nb" })).toThrow(/one line/);
    expect(() => setupJobScript({ ...base, command: "   " })).toThrow(/empty/);
    // The pane prints the command before running it, so an escape sequence in
    // one could repaint what the reader thinks happened. The error says where
    // and what, and never echoes the string back onto the terminal it is
    // suspected of being able to drive.
    for (const bad of ["a\u0000b", "a\u001b[2Kb", "a\u0007b"]) {
      const err = (() => {
        try {
          setupJobScript({ ...base, command: bad });
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
        throw new Error(`setupJobScript accepted ${JSON.stringify(bad)}`);
      })();
      expect(err).toContain("control character");
      expect(err).not.toContain(bad);
    }
    expect(() => setupJobScript({ ...base, command: "npm ci", check: "a\nb" })).toThrow(/one line/);
    expect(() => setupJobScript({ ...base, command: "npm ci", configSha256: "nope" })).toThrow(/sha256/);
    expect(() => setupJobScript({ ...base, slug: "unknown", command: "npm ci" })).toThrow(/nothing to set up/);
  });

  it("names itself, its repo and its attempt in the script it generates", () => {
    // The pane is read by people. A generated file with no idea what it is for
    // is one nobody can act on when they find it three days later.
    const job = buildJob({ name: "header", command: "true" });
    expect(job.script).toContain(`# gjd-remote setup job for ${SLUG}, attempt ${job.attempt}.`);
    expect(job.script).toContain("scripts/gjd-remote-setup.ts");
    expect(job.script).toContain("exec bash -l");
  });
});
