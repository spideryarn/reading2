/**
 * Stage 2 of plan 260910f: the launched side of D6, and the adapters the
 * protocol invokes.
 *
 * Three claims, and each is one a no-op would pass if it were only read:
 *
 *  - **The writers round-trip through Stage 1's reader.** The reader rejects a
 *    field it does not know and an `at` that is not exactly `toISOString()`, so
 *    every record written here — by TypeScript and by the generated shell — is
 *    read back through `readArtefacts`, not compared as text.
 *  - **The shell writer is durable and fails closed (F3).** Write, sync and
 *    rename failures are injected by shadowing `sync`/`mv` on PATH and by
 *    making the directory unwritable; the command after the start line must not
 *    run, and no `start.json` may be left claiming a start.
 *  - **The correlation id is in the first external effect.** Against a real tmux
 *    on a disposable socket — never the default server — the session's first
 *    process sees the id, the probe finds the session by it, and a session whose
 *    command exits at once still leaves both files.
 */
import { execFileSync, spawnSync, type SpawnOptions } from "node:child_process";
import { chmodSync, existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, readSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseProcStat, readBootIdentity } from "../tools/fleet/execution-identity.js";
import type { ChildSpawner } from "../tools/overseer/dispatch.js";
import {
  EXIT_FILE,
  INTENT_FILE,
  START_FILE,
  checkLaunchDir,
  exitArtefactLine,
  identityOf,
  machineIdentity,
  parseExit,
  readArtefacts,
  selfStartRecord,
  shellQuote,
  startArtefactLine,
  writeExitFile,
  writeStartFile,
  type ExitRecord,
} from "../tools/overseer/launch-artefacts.js";
import { pinOf, type LaunchInput } from "../tools/overseer/launch-protocol.js";
import {
  GJD_REMOTE_MAX_PROMPT_BYTES,
  SESSION_UNSET_VARIABLES,
  gjdRemoteLauncher,
  headlessLauncher,
  socketTmuxLauncher,
  tmuxEvidence,
  tmuxHeadlessLauncher,
  type TmuxRun,
} from "../tools/overseer/launchers.js";
import { ACCOUNT_ROUTING_VARIABLES } from "./helpers/account-neutral-env.js";
import { resolveAsWrapper, wrapperEnv } from "./helpers/wrapper-env.js";
import { hostileParent, makeLaunchDir, type LaunchFixture } from "./helpers/launch-fixture.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linux = process.platform === "linux";

function inputOf(fixture: LaunchFixture, material?: string): LaunchInput {
  const bytes = material === undefined ? readFileSync(fixture.materialPath) : Buffer.from(material, "utf8");
  return {
    occurrenceId: fixture.intent.occurrenceId,
    attempt: fixture.intent.attempt,
    correlationId: fixture.correlationId,
    artefactDir: fixture.dir,
    material: { bytes, pin: pinOf(bytes) },
    run: fixture.intent.run,
  };
}

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((settle) => setTimeout(settle, 50));
  }
}

const NOW = () => new Date().toISOString();

/* ------------------------------------------------------------------ *
 * The exit record's one shape.
 * ------------------------------------------------------------------ */

describe("the exit record has one shape: how the child ended, and the supervisor's verdict on it", () => {
  const f = makeLaunchDir();
  const cid = f.correlationId;
  const wrapper = {
    v: 1,
    kind: "exit",
    correlationId: cid,
    ending: { kind: "exited", code: 0 },
    verdict: { kind: "ok" },
    usageLimit: false,
    permissionDenials: 0,
    answer: { path: "/a/answer.md", bytes: 1, sha256: "a".repeat(64), usable: true },
    transcript: "/a/transcript.ndjson",
    at: NOW(),
  };
  const shell = { v: 1, kind: "exit", correlationId: cid, ending: { kind: "exited", code: 5 }, verdict: null, usageLimit: null, permissionDenials: null, answer: null, transcript: null, at: NOW() };

  it.each([
    ["a wrapper's success", wrapper],
    ["a job shell's ending, which makes no judgement", shell],
    ["a child that never ran", { ...wrapper, ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "spawn", why: "spawn claude ENOENT" }, usageLimit: null, permissionDenials: null, answer: null }],
    ["a wrapper that refused on its own account", { ...wrapper, ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "wrapper", why: "same file" }, usageLimit: null, permissionDenials: null, answer: null, transcript: null }],
    ["a timeout", { ...wrapper, ending: { kind: "signalled", signal: "SIGTERM" }, verdict: { kind: "failed", cause: "timeout", why: "killed after 3.1s" }, permissionDenials: null }],
    [
      "a prompt the launch did not pin",
      { ...wrapper, ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "prompt-unverified", why: "x" }, usageLimit: null, permissionDenials: null, answer: null },
    ],
    ["a wrapper hung up with its child", { ...wrapper, ending: { kind: "signalled", signal: "SIGHUP" }, verdict: { kind: "failed", cause: "hangup", why: "x" }, permissionDenials: null }],
  ] as const)("accepts %s", (_name, record) => {
    expect(parseExit(record, cid)).toMatchObject({ ok: true });
  });

  it.each([
    ["Stage 1's timedOut field", { ...wrapper, timedOut: false }],
    ["Stage 1's supervisor-failed ending", { ...wrapper, ending: { kind: "supervisor-failed", why: "x" }, verdict: { kind: "failed", cause: "spawn", why: "x" } }],
    ["an ok with no child", { ...wrapper, ending: { kind: "not-run" } }],
    ["an ok over a non-zero exit", { ...wrapper, ending: { kind: "exited", code: 1 } }],
    ["an ok over a signal", { ...wrapper, ending: { kind: "signalled", signal: "SIGKILL" } }],
    ["a not-run blamed on the child", { ...wrapper, ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "timeout", why: "x" } }],
    ["a cause nobody classifies", { ...wrapper, verdict: { kind: "failed", cause: "gremlins", why: "x" } }],
    ["a failure with no reason", { ...wrapper, verdict: { kind: "failed", cause: "nonzero", why: "" } }],
    ["a reading with no judgement", { ...shell, usageLimit: false }],
    ["a negative denial count", { ...wrapper, permissionDenials: -1 }],
    ["a missing transcript field", Object.fromEntries(Object.entries(wrapper).filter(([key]) => key !== "transcript"))],
  ] as const)("refuses %s", (_name, record) => {
    expect(parseExit(record, cid)).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * The TypeScript writers.
 * ------------------------------------------------------------------ */

describe("the TypeScript writers round-trip through the reader", () => {
  it("writes this process's own start record, and the reader parses it back as this process", () => {
    const f = makeLaunchDir();
    const start = selfStartRecord(f.correlationId, new Date());
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    writeStartFile(f.dir, start.value);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start).toEqual({ kind: "present", record: start.value });
    expect(start.value.pid).toBe(process.pid);
    expect(start.value.tmuxPane).toBeNull();
    if (linux) {
      const boot = readBootIdentity();
      expect(boot.read && boot.id).toBe(start.value.bootId);
      // And the identity check agrees it is this very process.
      expect(identityOf(start.value, machineIdentity)).toEqual({ kind: "alive" });
    }
  });

  it("writes every shape the reader knows", () => {
    const shapes: Omit<ExitRecord, "v" | "kind" | "correlationId" | "at">[] = [
      { ending: { kind: "exited", code: 0 }, verdict: { kind: "ok" }, usageLimit: false, permissionDenials: 2, answer: { path: "/x/answer.md", bytes: 5, sha256: "b".repeat(64), usable: true }, transcript: "/x/t" },
      { ending: { kind: "exited", code: 3 }, verdict: null, usageLimit: null, permissionDenials: null, answer: null, transcript: null },
      { ending: { kind: "signalled", signal: "SIGKILL" }, verdict: { kind: "failed", cause: "overflow", why: "64 MiB" }, usageLimit: false, permissionDenials: null, answer: null, transcript: "/x/t" },
      { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "spawn", why: "spawn claude ENOENT" }, usageLimit: null, permissionDenials: null, answer: null, transcript: null },
    ];
    for (const shape of shapes) {
      const f = makeLaunchDir();
      const record: ExitRecord = { v: 1, kind: "exit", correlationId: f.correlationId, ...shape, at: NOW() };
      writeExitFile(f.dir, record);
      expect(readArtefacts(f.dir, f.correlationId).exit).toEqual({ kind: "present", record });
    }
  });

  it("refuses to write a record its own reader would reject, and leaves no file", () => {
    const f = makeLaunchDir();
    const bad = { v: 1, kind: "exit", correlationId: f.correlationId, ending: { kind: "exited", code: 0 }, verdict: null, usageLimit: null, permissionDenials: null, answer: null, transcript: null, at: "yesterday" } as unknown as ExitRecord;
    expect(() => writeExitFile(f.dir, bad)).toThrow(/at/);
    expect(existsSync(join(f.dir, EXIT_FILE))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The generated shell.
 * ------------------------------------------------------------------ */

/** Run a bash script with extra directories in front of PATH, in `cwd`. `TMUX_PANE` is only what the test says. */
function bash(script: string, options: { cwd: string; path?: string[]; pane?: string }) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env["TMUX_PANE"];
  if (options.pane !== undefined) env["TMUX_PANE"] = options.pane;
  env["PATH"] = [...(options.path ?? []), process.env["PATH"] ?? ""].join(":");
  return spawnSync("bash", ["-c", script], { cwd: options.cwd, encoding: "utf8", env });
}

/** A directory of stand-ins that shadow real commands. `sync-dir` fails only on directories. */
function shadow(which: "sync" | "mv" | "sync-dir"): string {
  const dir = mkdtempSync(join(tmpdir(), `launch-shadow-${which}-`));
  const name = which === "mv" ? "mv" : "sync";
  const body =
    which === "sync-dir"
      ? `#!/usr/bin/env bash\nfor a in "$@"; do if [ -d "$a" ]; then echo "injected: cannot sync $a" >&2; exit 1; fi; done\nexec /usr/bin/sync "$@"\n`
      : `#!/usr/bin/env bash\necho "injected: ${name} fails" >&2\nexit 1\n`;
  writeFileSync(join(dir, name), body);
  chmodSync(join(dir, name), 0o755);
  return dir;
}

describe.runIf(linux)("the shell writers round-trip through the reader", () => {
  it("start.json names the job shell's own pid and start tick, and the reader parses it", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const line = startArtefactLine({ correlationId: f.correlationId, dir: f.dir, onFailure: "exit 9" });
    const r = bash(`${line}\ncat /proc/$$/stat > stat.txt\necho "$$" > pid.txt`, { cwd: f.root });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    if (read.start.kind !== "present") return;
    expect(read.start.record.pid).toBe(Number(readFileSync(join(f.root, "pid.txt"), "utf8").trim()));
    const stat = parseProcStat(readFileSync(join(f.root, "stat.txt"), "utf8"));
    expect(stat.ok && stat.startTicks).toBe(read.start.record.startTicks);
    const boot = readBootIdentity();
    expect(boot.read && boot.id).toBe(read.start.record.bootId);
    expect(read.start.record.tmuxPane).toBeNull();
  });

  it("records a real-looking pane and nothing that is not one", () => {
    const good = makeLaunchDir({ launcherKind: "tmux" });
    bash(startArtefactLine({ correlationId: good.correlationId, dir: good.dir, onFailure: "exit 9" }), { cwd: good.root, pane: "%17" });
    const read = readArtefacts(good.dir, good.correlationId).start;
    expect(read.kind === "present" && read.record.tmuxPane).toBe("%17");

    const odd = makeLaunchDir({ launcherKind: "tmux" });
    bash(startArtefactLine({ correlationId: odd.correlationId, dir: odd.dir, onFailure: "exit 9" }), { cwd: odd.root, pane: '%1"}' });
    const oddRead = readArtefacts(odd.dir, odd.correlationId).start;
    expect(oddRead.kind === "present" && oddRead.record.tmuxPane).toBeNull();
  });

  it("exit.json carries the saved status, makes no judgement, and the reader parses it", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const line = exitArtefactLine({ correlationId: f.correlationId, dir: f.dir, statusVar: "_status", onFailure: "exit 9" });
    const r = bash(`sh -c 'exit 3'\n_status=$?\n${line}\necho after`, { cwd: f.root });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("after");
    const read = readArtefacts(f.dir, f.correlationId).exit;
    expect(read.kind).toBe("present");
    if (read.kind !== "present") return;
    expect(read.record).toMatchObject({ ending: { kind: "exited", code: 3 }, verdict: null, usageLimit: null, permissionDenials: null, answer: null, transcript: null });
  });

  it("puts nothing a hostile directory name could run, at any layer", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const start = startArtefactLine({ correlationId: f.correlationId, dir: f.dir, onFailure: "exit 9" });
    const exit = exitArtefactLine({ correlationId: f.correlationId, dir: f.dir, statusVar: "s", onFailure: "exit 8" });
    const r = bash(`${start}\ntrue\ns=$?\n${exit}`, { cwd: f.root });
    expect(r.status).toBe(0);
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit.kind).toBe("present");
    // The `$(touch pwned)` in the name was never executed, from any working directory it could have used.
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
    expect(existsSync(join(dirname(f.root), "pwned"))).toBe(false);
  });

  it("refuses to generate a line for anything it cannot quote safely", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    expect(() => startArtefactLine({ correlationId: f.correlationId, dir: "relative/dir", onFailure: "exit 1" })).toThrow(/absolute/);
    expect(() => startArtefactLine({ correlationId: f.correlationId, dir: `${f.dir}\nrm -rf /`, onFailure: "exit 1" })).toThrow(/control/);
    expect(() => startArtefactLine({ correlationId: "lo-bad" as LaunchFixture["correlationId"], dir: f.dir, onFailure: "exit 1" })).toThrow(/correlation/);
    expect(() => exitArtefactLine({ correlationId: f.correlationId, dir: f.dir, statusVar: "x; rm", onFailure: "exit 1" })).toThrow(/variable/);
  });
});

describe.runIf(linux)("F3: the shell writer fails closed, so nothing starts without a durable start.json", () => {
  /** The start line, then a stand-in for Claude that leaves a mark if it ran. */
  function job(f: LaunchFixture): string {
    const failed = shellQuote(join(f.root, "failed"));
    const ran = shellQuote(join(f.root, "claude-ran"));
    return `${startArtefactLine({ correlationId: f.correlationId, dir: f.dir, onFailure: `{ echo failed > ${failed}; exit 1; }` })}\ntouch ${ran}`;
  }

  for (const which of ["sync", "mv", "sync-dir"] as const) {
    it(`a ${which === "sync-dir" ? "directory sync" : which} failure stops the job before Claude`, () => {
      const f = makeLaunchDir({ launcherKind: "tmux" });
      const r = bash(job(f), { cwd: f.root, path: [shadow(which)] });
      expect(r.status).toBe(1);
      expect(existsSync(join(f.root, "failed"))).toBe(true);
      expect(existsSync(join(f.root, "claude-ran"))).toBe(false);
      if (which !== "sync-dir") expect(existsSync(join(f.dir, START_FILE))).toBe(false);
    });
  }

  it.runIf(process.getuid?.() !== 0)("a write failure stops the job before Claude", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    chmodSync(f.dir, 0o500);
    try {
      const r = bash(job(f), { cwd: f.root });
      expect(r.status).toBe(1);
      expect(existsSync(join(f.root, "failed"))).toBe(true);
      expect(existsSync(join(f.root, "claude-ran"))).toBe(false);
      expect(existsSync(join(f.dir, START_FILE))).toBe(false);
    } finally {
      chmodSync(f.dir, 0o700);
    }
  });

  it("an exit.json that cannot be written leaves a note, claims nothing, and lets the job carry on", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const note = shellQuote(join(f.root, "note"));
    const exit = exitArtefactLine({ correlationId: f.correlationId, dir: f.dir, statusVar: "s", onFailure: `echo could-not-write > ${note}` });
    const r = bash(`s=0\n${exit}\necho carried-on`, { cwd: f.root, path: [shadow("mv")] });
    expect(r.stdout).toContain("carried-on");
    expect(existsSync(join(f.root, "note"))).toBe(true);
    expect(readArtefacts(f.dir, f.correlationId).exit).toEqual({ kind: "absent" });
  });
});

/* ------------------------------------------------------------------ *
 * The wrapper's directory check.
 * ------------------------------------------------------------------ */

describe("checkLaunchDir", () => {
  const uid = process.getuid?.() ?? 0;
  const kinds = ["headless", "tmux-headless"] as const;

  it("accepts the directory the protocol leaves, for either wrapper launcher, and hands back its intent", () => {
    const f = makeLaunchDir();
    expect(checkLaunchDir(f.dir, { uid, launcherKinds: kinds })).toEqual({ ok: true, intent: f.intent });
    const t = makeLaunchDir({ launcherKind: "tmux-headless" });
    expect(checkLaunchDir(t.dir, { uid, launcherKinds: kinds })).toEqual({ ok: true, intent: t.intent });
  });

  it("refuses a missing directory, a relative one and a symlink", () => {
    const f = makeLaunchDir();
    expect(checkLaunchDir(join(f.root, "nope"), { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/does not exist/) });
    expect(checkLaunchDir("launches/o/x/a1", { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/absolute/) });
    const link = join(f.root, "link");
    symlinkSync(f.dir, link);
    expect(checkLaunchDir(link, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/symlink|not a directory/) });
  });

  it("refuses a directory that is not 0700, or not ours", () => {
    const f = makeLaunchDir();
    chmodSync(f.dir, 0o755);
    expect(checkLaunchDir(f.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/0700/) });
    chmodSync(f.dir, 0o700);
    expect(checkLaunchDir(f.dir, { uid: uid + 1, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/owned/) });
  });

  it("refuses a directory with no valid intent, or an intent for another launcher", () => {
    const empty = makeLaunchDir();
    rmSync(join(empty.dir, INTENT_FILE));
    expect(checkLaunchDir(empty.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/intent/) });

    const garbled = makeLaunchDir();
    writeFileSync(join(garbled.dir, INTENT_FILE), '{"v":1,"kind":"intent","correlationId":"lo-0123456789abcdef0123-a1","surprise":true}');
    expect(checkLaunchDir(garbled.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/intent/) });

    const tmux = makeLaunchDir({ launcherKind: "tmux" });
    expect(checkLaunchDir(tmux.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/tmux/) });
  });

  it("refuses an intent that is not this directory's, and a directory that has already been used", () => {
    const f = makeLaunchDir();
    const other = makeLaunchDir();
    writeFileSync(join(f.dir, INTENT_FILE), readFileSync(join(other.dir, INTENT_FILE)));
    expect(checkLaunchDir(f.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/not this directory|belongs/) });

    const used = makeLaunchDir();
    writeFileSync(join(used.dir, START_FILE), "{}");
    expect(checkLaunchDir(used.dir, { uid, launcherKinds: kinds })).toMatchObject({ ok: false, why: expect.stringMatching(/already/) });
  });
});

/* ------------------------------------------------------------------ *
 * The adapters, with a stand-in spawner or tmux.
 * ------------------------------------------------------------------ */

type Spawned = { command: string; args: readonly string[]; options: SpawnOptions; stdin: string | null };

function fakeSpawner(into: Spawned[], answer: { pid?: number | undefined; throws?: Error } = {}): ChildSpawner {
  return (command, args, options) => {
    if (answer.throws) throw answer.throws;
    const stdio = options.stdio;
    const zero = Array.isArray(stdio) ? stdio[0] : undefined;
    let stdin: string | null = null;
    if (typeof zero === "number") {
      const size = fstatSync(zero).size;
      const buffer = Buffer.alloc(size);
      readSync(zero, buffer, 0, size, 0);
      stdin = buffer.toString("utf8");
    }
    into.push({ command, args, options, stdin });
    return { pid: "pid" in answer ? answer.pid : 4242, stdin: null, stderr: null, on: () => {} };
  };
}

function repoWithTsx(): string {
  const repo = mkdtempSync(join(tmpdir(), "launch-repo-"));
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", ".bin", "tsx"), "#!/bin/sh\n");
  return repo;
}

describe("the gjd-remote tmux adapter", () => {
  it("hands gjd-remote the id and the directory before an unchanged -p -, and the material plus a newline on a file stdin", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux" });
    const calls: Spawned[] = [];
    const repo = repoWithTsx();
    const launcher = gjdRemoteLauncher({ repoRoot: repo, spawnProcess: fakeSpawner(calls) });
    expect(launcher.kind).toBe("tmux");
    const answer = launcher.launch(inputOf(f, "prompt with 'quotes' and $(no)"));
    expect(answer.kind).toBe("started");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.command).toBe(join(repo, "node_modules", ".bin", "tsx"));
    expect(call.args).toEqual([
      "scripts/gjd-remote.ts",
      "new-claude",
      f.correlationId,
      "--account",
      "auto",
      "--no-attach",
      "--launch-id",
      f.correlationId,
      "--launch-dir",
      f.dir,
      "-p",
      "-",
    ]);
    // A regular file, never a pipe: EOF because the file ends, not because a writer remembered.
    expect(call.stdin).toBe("prompt with 'quotes' and $(no)\n");
    expect(call.options.cwd).toBe(repo);
  });

  it("refuses before any effect when it cannot run gjd-remote at all", () => {
    const calls: Spawned[] = [];
    const noTsx = mkdtempSync(join(tmpdir(), "launch-repo-bare-"));
    expect(gjdRemoteLauncher({ repoRoot: noTsx, spawnProcess: fakeSpawner(calls) }).launch(inputOf(makeLaunchDir({ launcherKind: "tmux" }))).kind).toBe("refused-before-effect");
    expect(gjdRemoteLauncher({ repoRoot: repoWithTsx(), spawnProcess: fakeSpawner(calls, { throws: new Error("EACCES") }) }).launch(inputOf(makeLaunchDir({ launcherKind: "tmux" }))).kind).toBe(
      "refused-before-effect",
    );
    expect(gjdRemoteLauncher({ repoRoot: repoWithTsx(), spawnProcess: fakeSpawner(calls, { pid: undefined }) }).launch(inputOf(makeLaunchDir({ launcherKind: "tmux" }))).kind).toBe(
      "refused-before-effect",
    );
    expect(calls).toHaveLength(1); // only the pid-less one reached the spawner, and it never started
  });

  it("refuses a prompt gjd-remote would refuse, before spawning it", () => {
    const f = makeLaunchDir({ launcherKind: "tmux" });
    const calls: Spawned[] = [];
    const answer = gjdRemoteLauncher({ repoRoot: repoWithTsx(), spawnProcess: fakeSpawner(calls) }).launch(inputOf(f, "x".repeat(GJD_REMOTE_MAX_PROMPT_BYTES)));
    expect(answer).toMatchObject({ kind: "refused-before-effect", why: expect.stringMatching(/KB|bytes/) });
    expect(calls).toHaveLength(0);
  });
});

describe("the headless adapter", () => {
  it("runs run-claude on an attempt-private copy of the verified bytes, with the run spec's timeout and access and nothing else", () => {
    const f = makeLaunchDir({ parent: hostileParent(), run: { timeoutMinutes: 45, access: "write", account: "pool-d" } });
    const calls: Spawned[] = [];
    const repo = repoWithTsx();
    const launcher = headlessLauncher({ repoRoot: repo, wrapper: "run-claude", spawnProcess: fakeSpawner(calls) });
    expect(launcher.kind).toBe("headless");
    expect(launcher.launch(inputOf(f)).kind).toBe("started");
    const call = calls[0]!;
    // The run spec's pool account, as run-claude's own --account: without it the run bills the daemon's account.
    expect(call.args).toEqual(["scripts/run-claude.ts", "--prompt-file", join(f.dir, "prompt.md"), "--launch-dir", f.dir, "--timeout-minutes", "45", "--access", "write", "--account", "pool-d"]);
    expect(Array.isArray(call.options.stdio) && call.options.stdio[0]).toBe("ignore");
  });

  it("maps access onto run-codex's own sandbox word", () => {
    const f = makeLaunchDir({ run: { timeoutMinutes: 5, access: "write", account: "pool-d" } });
    const calls: Spawned[] = [];
    expect(headlessLauncher({ repoRoot: repoWithTsx(), wrapper: "run-codex", spawnProcess: fakeSpawner(calls) }).launch(inputOf(f)).kind).toBe("started");
    // No --account: run-codex has no account flag, and the handle names a Claude pool account.
    expect(calls[0]!.args).toEqual(["scripts/run-codex.ts", "--prompt-file", join(f.dir, "prompt.md"), "--launch-dir", f.dir, "--timeout-minutes", "5", "--sandbox", "workspace-write"]);
  });

  it("writes the VERIFIED bytes, 0600, whatever the shared material.txt says by now (F5, scheduled-dispatch's F9)", () => {
    const f = makeLaunchDir({ material: "the verified bytes" });
    writeFileSync(f.materialPath, "changed after the protocol verified it");
    const calls: Spawned[] = [];
    expect(headlessLauncher({ repoRoot: repoWithTsx(), wrapper: "run-claude", spawnProcess: fakeSpawner(calls) }).launch(inputOf(f, "the verified bytes")).kind).toBe("started");
    expect(readFileSync(join(f.dir, "prompt.md"), "utf8")).toBe("the verified bytes");
    expect(statSync(join(f.dir, "prompt.md")).mode & 0o777).toBe(0o600);
  });

  it("refuses before any effect when there is no run spec, or a prompt.md is already there", () => {
    const f = makeLaunchDir();
    const calls: Spawned[] = [];
    const launcher = headlessLauncher({ repoRoot: repoWithTsx(), wrapper: "run-claude", spawnProcess: fakeSpawner(calls) });
    expect(launcher.launch({ ...inputOf(f), run: null }).kind).toBe("refused-before-effect");
    writeFileSync(join(f.dir, "prompt.md"), "somebody else's");
    expect(launcher.launch(inputOf(f)).kind).toBe("refused-before-effect");
    expect(readFileSync(join(f.dir, "prompt.md"), "utf8")).toBe("somebody else's");
    expect(calls).toHaveLength(0);
  });
});

describe("the tmux-headless adapter, with a stand-in tmux", () => {
  type Call = readonly string[];
  const stand = (calls: Call[], serverUp: boolean): TmuxRun => (args) => {
    calls.push(args);
    if (args[0] === "list-sessions") return serverUp ? { status: 0, stdout: "$0\n", stderr: "" } : { status: 1, stdout: "", stderr: "no server running on /tmp/tmux-1000/default" };
    if (args[0] === "new-session") return { status: 0, stdout: "", stderr: "" };
    return { status: 1, stdout: "", stderr: "unexpected call" };
  };

  it("refuses before any effect when no tmux server is running, rather than fork one inside the daemon's cgroup", () => {
    const f = makeLaunchDir({ launcherKind: "tmux-headless" });
    const calls: Call[] = [];
    const answer = tmuxHeadlessLauncher({ repoRoot: repoWithTsx(), run: stand(calls, false) }).launch(inputOf(f));
    expect(answer).toMatchObject({ kind: "refused-before-effect", why: expect.stringMatching(/no tmux server/) });
    expect(calls.map((call) => call[0])).toEqual(["list-sessions"]);
  });

  it("puts the id and the directory in the session at creation, and runs run-claude on the pinned material with the run spec", () => {
    const f = makeLaunchDir({ parent: hostileParent(), launcherKind: "tmux-headless", run: { timeoutMinutes: 20, access: "read-only", account: "pool-c" } });
    const calls: Call[] = [];
    const repo = repoWithTsx();
    // A stand-in node that writes down the argv it was given, so the shell command is checked by running it.
    const argvFile = join(repo, "argv");
    const node = join(repo, "node");
    writeFileSync(node, `#!/usr/bin/env bash\nprintf '%s\\0' "$@" > ${shellQuote(argvFile)}\n`);
    chmodSync(node, 0o755);
    const answer = tmuxHeadlessLauncher({ repoRoot: repo, node, run: stand(calls, true) }).launch(inputOf(f));
    expect(answer.kind).toBe("started");
    const created = calls.find((call) => call[0] === "new-session");
    expect(created?.slice(0, -1)).toEqual(["new-session", "-d", "-s", f.correlationId, "-e", `SPIDERYARN_LAUNCH_ID=${f.correlationId}`, "-e", `SPIDERYARN_LAUNCH_DIR=${f.dir}`]);
    const r = spawnSync("bash", ["-c", created!.at(-1)!], { encoding: "utf8", cwd: f.root });
    expect(r.status).toBe(0);
    expect(readFileSync(argvFile, "utf8").split("\0").slice(0, -1)).toEqual([
      join(repo, "node_modules", ".bin", "tsx"),
      join(repo, "scripts", "run-claude.ts"),
      "--prompt-file",
      join(f.dir, "prompt.md"),
      "--launch-dir",
      f.dir,
      "--timeout-minutes",
      "20",
      "--access",
      "read-only",
      "--account",
      "pool-c",
    ]);
    // The prompt is the verified bytes, in a file only this attempt writes — not the shared material.txt.
    expect(readFileSync(join(f.dir, "prompt.md"))).toEqual(inputOf(f).material.bytes);
    // Nothing that would let `gjd-remote ls` rename the session, which the scheduler finds by its name.
    expect(created!.join(" ")).not.toContain("GJD_");
    expect(existsSync(join(f.root, "pwned"))).toBe(false);
  });

  it("drops at least every variable the suite treats as account routing", () => {
    for (const name of ACCOUNT_ROUTING_VARIABLES) expect(SESSION_UNSET_VARIABLES).toContain(name);
  });

  it("a duplicate session name is not a refusal: a session with this id exists, so it throws and reconciliation looks", () => {
    const f = makeLaunchDir({ launcherKind: "tmux-headless" });
    const duplicate: TmuxRun = (args) =>
      args[0] === "list-sessions" ? { status: 0, stdout: "$0\n", stderr: "" } : { status: 1, stdout: "", stderr: `duplicate session: ${f.correlationId}` };
    expect(() => tmuxHeadlessLauncher({ repoRoot: repoWithTsx(), run: duplicate }).launch(inputOf(f))).toThrow(/duplicate session/);
  });
});

/* ------------------------------------------------------------------ *
 * The tmux probe, with a stand-in tmux.
 * ------------------------------------------------------------------ */

describe("the tmux evidence port, against answers tmux could give", () => {
  const cid = makeLaunchDir({ launcherKind: "tmux" }).correlationId;
  type Reply = ReturnType<TmuxRun>;
  const scripted = (replies: Record<string, Reply>): TmuxRun => (args) => replies[args.join(" ")] ?? { status: 1, stdout: "", stderr: "unexpected call" };

  it("finds a session by the id in its environment, and not by anything global", () => {
    const run = scripted({
      "list-sessions -F #{session_id}": { status: 0, stdout: "$1\n$2\n", stderr: "" },
      "show-environment -t $1 SPIDERYARN_LAUNCH_ID": { status: 1, stdout: "", stderr: "unknown variable: SPIDERYARN_LAUNCH_ID" },
      "show-environment -t $2 SPIDERYARN_LAUNCH_ID": { status: 0, stdout: `SPIDERYARN_LAUNCH_ID=${cid}\n`, stderr: "" },
    });
    expect(tmuxEvidence({ run })(cid)).toEqual({ kind: "found", sessionId: "$2" });
  });

  it("answers absent when no server is running, and when no session carries the id", () => {
    expect(tmuxEvidence({ run: scripted({ "list-sessions -F #{session_id}": { status: 1, stdout: "", stderr: "no server running on /tmp/x" } }) })(cid)).toEqual({ kind: "absent" });
    const run = scripted({
      "list-sessions -F #{session_id}": { status: 0, stdout: "$1\n", stderr: "" },
      "show-environment -t $1 SPIDERYARN_LAUNCH_ID": { status: 0, stdout: "SPIDERYARN_LAUNCH_ID=lo-00000000000000000000-a1\n", stderr: "" },
    });
    expect(tmuxEvidence({ run })(cid)).toEqual({ kind: "absent" });
  });

  it("a session that vanished between the list and the look is not a failure to look", () => {
    const run = scripted({
      "list-sessions -F #{session_id}": { status: 0, stdout: "$4\n", stderr: "" },
      "show-environment -t $4 SPIDERYARN_LAUNCH_ID": { status: 1, stdout: "", stderr: "can't find session: $4" },
    });
    expect(tmuxEvidence({ run })(cid)).toEqual({ kind: "absent" });
  });

  it("cannot tell when tmux cannot be run, answers something else, or will not say", () => {
    expect(tmuxEvidence({ run: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn tmux ENOENT") }) })(cid).kind).toBe("cannot-tell");
    expect(tmuxEvidence({ run: scripted({ "list-sessions -F #{session_id}": { status: 1, stdout: "", stderr: "error connecting to /tmp/x (Permission denied)" } }) })(cid).kind).toBe("cannot-tell");
    expect(tmuxEvidence({ run: scripted({ "list-sessions -F #{session_id}": { status: 0, stdout: "not-an-id\n", stderr: "" } }) })(cid).kind).toBe("cannot-tell");
    const run = scripted({
      "list-sessions -F #{session_id}": { status: 0, stdout: "$1\n", stderr: "" },
      "show-environment -t $1 SPIDERYARN_LAUNCH_ID": { status: 1, stdout: "", stderr: "server exited unexpectedly" },
    });
    expect(tmuxEvidence({ run })(cid).kind).toBe("cannot-tell");
  });
});

/* ------------------------------------------------------------------ *
 * Against a real tmux, on a socket nothing else can reach.
 * ------------------------------------------------------------------ */

function tmuxUsable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return linux;
  } catch {
    return false;
  }
}

describe.runIf(tmuxUsable())("against a real tmux on a disposable socket", () => {
  let base = "";
  let sock = "";
  const sockets: string[] = [];

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), "launch-tmux-"));
    sock = join(base, "s");
    sockets.push(sock);
  });

  afterAll(() => {
    for (const one of sockets) {
      try {
        execFileSync("tmux", ["-S", one, "kill-server"], { stdio: "ignore" });
      } catch {
        /* already gone, or never started */
      }
    }
    rmSync(base, { recursive: true, force: true });
  });

  it("creates a session whose first process sees the id, and the probe finds it by that id", async () => {
    const f = makeLaunchDir({ parent: base, launcherKind: "tmux", material: "the material" });
    const seen = join(base, "seen");
    const got = join(base, "got");
    const launcher = socketTmuxLauncher({ socket: sock, command: `printf '%s' "$SPIDERYARN_LAUNCH_ID" > ${shellQuote(seen)}; cat > ${shellQuote(got)}; sleep 60` });
    expect(launcher.launch(inputOf(f)).kind).toBe("started");
    await until(() => existsSync(seen) && existsSync(got));
    expect(readFileSync(seen, "utf8")).toBe(f.correlationId);
    await until(() => readFileSync(got, "utf8") === "the material\n");

    const found = tmuxEvidence({ socket: sock })(f.correlationId);
    expect(found.kind).toBe("found");
    const listed = execFileSync("tmux", ["-S", sock, "list-sessions", "-F", "#{session_id}"], { encoding: "utf8" }).split("\n");
    expect(listed).toContain(found.kind === "found" ? found.sessionId : "none");
    // An id nobody launched is not found.
    expect(tmuxEvidence({ socket: sock })(makeLaunchDir({ launcherKind: "tmux" }).correlationId)).toEqual({ kind: "absent" });

    const start = readArtefacts(f.dir, f.correlationId).start;
    expect(start.kind).toBe("present");
    if (start.kind !== "present") return;
    expect(start.record.tmuxPane).toMatch(/^%\d+$/);
    expect(identityOf(start.record, machineIdentity)).toEqual({ kind: "alive" });
    expect(readArtefacts(f.dir, f.correlationId).exit).toEqual({ kind: "absent" });
  });

  it("a session whose command exits at once still leaves start.json and exit.json, and the reader parses both", async () => {
    const f = makeLaunchDir({ parent: base, launcherKind: "tmux" });
    expect(socketTmuxLauncher({ socket: sock, command: "true" }).launch(inputOf(f)).kind).toBe("started");
    await until(() => existsSync(join(f.dir, EXIT_FILE)));
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 0 }, verdict: null, answer: null } });
    // tmux has forgotten it; the files are the only evidence left, which is the point.
    await until(() => tmuxEvidence({ socket: sock })(f.correlationId).kind === "absent");
  });

  it("a command that fails leaves its status", async () => {
    const f = makeLaunchDir({ parent: base, launcherKind: "tmux" });
    expect(socketTmuxLauncher({ socket: sock, command: "sh -c 'exit 7'" }).launch(inputOf(f)).kind).toBe("started");
    await until(() => existsSync(join(f.dir, EXIT_FILE)));
    expect(readArtefacts(f.dir, f.correlationId).exit).toMatchObject({ kind: "present", record: { ending: { kind: "exited", code: 7 } } });
  });

  it("answers absent on a socket with no server behind it", () => {
    expect(tmuxEvidence({ socket: join(base, "nobody-here") })(makeLaunchDir({ launcherKind: "tmux" }).correlationId)).toEqual({ kind: "absent" });
  });

  it("tmux-headless refuses on a socket with no server, and does not start one", () => {
    const lonely = join(base, "lonely");
    sockets.push(lonely);
    const f = makeLaunchDir({ parent: base, launcherKind: "tmux-headless" });
    const answer = tmuxHeadlessLauncher({ repoRoot: REPO, socket: lonely }).launch(inputOf(f));
    expect(answer).toMatchObject({ kind: "refused-before-effect", why: expect.stringMatching(/no tmux server/) });
    expect(existsSync(lonely)).toBe(false);
  });

  it("tmux-headless runs the real run-claude in a session on the running server, on the run's pool account — one it cannot route is refused before any CLI, and exit.json says so", async () => {
    const serverSock = join(base, "h");
    sockets.push(serverSock);
    /* A stand-in claude — given to the adapter's OWN tmux client, because a session takes the
       creating client's PATH, not the server's (measured, tmux 3.4). The first version of this
       test put it only on the server's PATH, and the wrapper found the real claude: a paid run.
       It leaves a mark on ANY call, the auth probe included, and succeeds at none. */
    const bin = mkdtempSync(join(tmpdir(), "launch-tmux-claude-"));
    const seen = join(bin, "seen");
    writeFileSync(join(bin, "claude"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> ${shellQuote(seen)}\nexit 1\n`);
    chmodSync(join(bin, "claude"), 0o755);
    /* A HOME with no account registry in it. The adapter now always passes `--account` (a registry
       handle), and a routed run checks the account's live profile over the network before it
       spends, which no test may do — so the far end this test can reach offline is run-claude's
       own refusal. Until the account arrived it ran a stand-in claude to an `ok` exit.json; that
       path is still exercised, unrouted, by tests/run-claude.test.ts's --launch-dir tests. */
    const home = mkdtempSync(join(tmpdir(), "launch-tmux-home-"));
    // PATH pinned, so the wrapper's own .env.local load cannot put another claude first (F22).
    const env = wrapperEnv({ PATH: `${bin}:${process.env["PATH"] ?? ""}`, HOME: home });
    execFileSync("tmux", ["-S", serverSock, "-f", "/dev/null", "new-session", "-d", "-s", "keeper", "sleep 300"], { env });
    // Before anything can spend: `claude` resolves to the stand-in AFTER the wrapper's environment load…
    expect(resolveAsWrapper("claude", env)).toBe(join(bin, "claude"));
    // …and the pin is in the server's environment, which a session's variables other than PATH come from.
    expect(execFileSync("tmux", ["-S", serverSock, "show-environment", "-g", "SPIDERYARN_ENV_PINNED"], { encoding: "utf8" })).toMatch(/[=,]PATH(,|\n)/);

    const f = makeLaunchDir({ parent: base, launcherKind: "tmux-headless", run: { timeoutMinutes: 2, access: "read-only", account: "pool-nowhere" } });
    expect(tmuxHeadlessLauncher({ repoRoot: REPO, socket: serverSock, env }).launch(inputOf(f)).kind).toBe("started");
    const log = join(f.dir, "launcher.log");
    // If the wrapper never gets as far as exit.json, say why: its console is in the attempt's launcher.log.
    await until(() => existsSync(join(f.dir, EXIT_FILE)), 60_000).catch((cause: unknown) => {
      throw new Error(`${String(cause)}; launcher.log: ${existsSync(log) ? readFileSync(log, "utf8").slice(-2000) : "(none)"}`);
    });
    const read = readArtefacts(f.dir, f.correlationId);
    expect(read.start.kind).toBe("present");
    expect(read.exit).toMatchObject({ kind: "present", record: { ending: { kind: "not-run" }, verdict: { kind: "failed", cause: "wrapper" }, answer: null } });
    // The refusal is run-claude's, about the account the session handed it — and no claude ran, not even the probe.
    expect(readFileSync(log, "utf8")).toContain('run-claude: account "pool-nowhere" is not registered');
    expect(existsSync(seen)).toBe(false);
  }, 90_000);

  it("a tmux-headless session carries no account-routing variable into the wrapper — not from the creating client, and not from the server", async () => {
    const serverSock = join(base, "r");
    sockets.push(serverSock);
    const repo = repoWithTsx();
    const envFile = join(repo, "env");
    // A stand-in node where the wrapper would run: it writes down the environment it was given. No wrapper, no CLI.
    const node = join(repo, "node");
    writeFileSync(node, `#!/usr/bin/env bash\nenv > ${shellQuote(join(repo, "env.tmp"))} && mv ${shellQuote(join(repo, "env.tmp"))} ${shellQuote(envFile)}\n`);
    chmodSync(node, 0o755);
    const routed = { CLAUDE_CONFIG_DIR: "/somewhere", CLAUDE_CODE_OAUTH_TOKEN: "sentinel-oauth", ANTHROPIC_API_KEY: "sentinel-anthropic", CODEX_HOME: "/somewhere-codex" };
    const env = { ...wrapperEnv({ PATH: process.env["PATH"] ?? "" }), ...routed };
    // The server has them too, as a long-running server started by a routed daemon would: only the session's own command can drop them.
    execFileSync("tmux", ["-S", serverSock, "-f", "/dev/null", "new-session", "-d", "-s", "keeper", "sleep 300"], { env });
    expect(execFileSync("tmux", ["-S", serverSock, "show-environment", "-g", "CLAUDE_CONFIG_DIR"], { encoding: "utf8" }).trim()).toBe("CLAUDE_CONFIG_DIR=/somewhere");
    const f = makeLaunchDir({ parent: base, launcherKind: "tmux-headless" });
    expect(tmuxHeadlessLauncher({ repoRoot: repo, node, socket: serverSock, env }).launch(inputOf(f)).kind).toBe("started");
    await until(() => existsSync(envFile), 30_000);
    const seen = readFileSync(envFile, "utf8");
    /* Compared as NAMES, never as the dump: a failure message holding the environment would print
       every secret the worker loaded from .env.local — which the first red run of this test did. */
    const present = (name: string): boolean => new RegExp(`^${name}=`, "m").test(seen);
    // It is the session's own environment: the id is there…
    expect(present("SPIDERYARN_LAUNCH_ID") && seen.includes(`SPIDERYARN_LAUNCH_ID=${f.correlationId}\n`)).toBe(true);
    // …and not one of the routing variables is.
    expect(Object.keys(routed).filter(present)).toEqual([]);
  });
});
