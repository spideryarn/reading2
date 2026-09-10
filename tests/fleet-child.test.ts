import { execFile, type spawn, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

import { limit, probeOwner, type ProbeSpec } from "../tools/fleet/child.js";

const execFileAsync = promisify(execFile);

type FakeChild = EventEmitter & {
  pid: number;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn<(signal?: NodeJS.Signals | number) => boolean>>;
  unref: ReturnType<typeof vi.fn<() => void>>;
};

type SpawnCall = {
  cmd: string;
  args: readonly string[];
  options: SpawnOptions;
};

function child(pid: number): FakeChild {
  return Object.assign(new EventEmitter(), {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
}

function procStat(
  pid: number,
  { state = "S", pgrp = pid, startTime = "123456", comm = "fake" }: {
    state?: string;
    pgrp?: number;
    startTime?: string;
    comm?: string;
  } = {},
): string {
  // Fields after `comm` are 3..22: state, ppid, pgrp, sixteen
  // intervening fields, then the stable kernel start-time tick.
  const afterComm = [state, "1", String(pgrp), ...Array<string>(16).fill("0"), startTime];
  return `${pid} (${comm}) ${afterComm.join(" ")}`;
}

function errno(code: string, message: string): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

function spawner(children: readonly FakeChild[]): {
  spawn: typeof spawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const fake = (cmd: string, args: readonly string[], options: SpawnOptions): FakeChild => {
    calls.push({ cmd, args, options });
    const next = children[calls.length - 1];
    if (next === undefined) throw new Error("the fake spawn was called more times than its fixture permits");
    return next;
  };
  return { spawn: fake as unknown as typeof spawn, calls };
}

function spec(overrides: Partial<ProbeSpec> = {}): ProbeSpec {
  return {
    key: "probe-a",
    cmd: "fake-probe",
    args: [],
    timeoutMs: 20,
    graceMs: 10,
    maxBytes: 1024,
    ...overrides,
  };
}

function close(childProcess: FakeChild, code: number | null, signal: NodeJS.Signals | null): void {
  childProcess.emit("exit", code, signal);
  childProcess.emit("close", code, signal);
}

async function passTimeoutAndGrace(timeoutMs = 20, graceMs = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(timeoutMs + graceMs);
  // The contract deliberately gives an exit from the SIGKILL tick one immediate
  // in which to be observed before the caller is released.
  await vi.runAllTimersAsync();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("owned fleet probe children", () => {
  it("captures a real successful child and reports a measured duration", async () => {
    const owner = probeOwner();
    const outcome = await owner.run({
      key: "real-ok",
      cmd: "sh",
      args: ["-c", "sleep 0.02; printf 'hello'; printf 'warning' >&2"],
      timeoutMs: 2_000,
    });

    expect(outcome).toMatchObject({ kind: "ok", stdout: "hello", stderr: "warning" });
    if (outcome.kind !== "ok") throw new Error(`the real child did not succeed: ${outcome.kind}`);
    expect(outcome.tookMs).toBeGreaterThan(0);
    expect(owner.live()).toEqual([]);
  });

  it("makes a non-zero exit a failed value carrying its exit code and stderr", async () => {
    const owner = probeOwner();
    const outcome = await owner.run({
      key: "real-failure",
      cmd: "sh",
      args: ["-c", "printf 'the probe explains itself' >&2; exit 17"],
      timeoutMs: 2_000,
    });

    expect(outcome).toMatchObject({ kind: "failed", exitCode: 17, signal: null });
    if (outcome.kind !== "failed") throw new Error(`the real child did not fail: ${outcome.kind}`);
    expect(outcome.why).toContain("the probe explains itself");
    expect(owner.live()).toEqual([]);
  });

  it("returns a spawn error such as ENOENT as a failed value instead of throwing", async () => {
    const owner = probeOwner();
    await expect(owner.run({
      key: "missing",
      cmd: "spideryarn-command-that-does-not-exist-260910",
      args: [],
      timeoutMs: 2_000,
    })).resolves.toMatchObject({ kind: "failed", exitCode: null, signal: null });
    expect(owner.live()).toEqual([]);
  });

  it("turns a synchronous exception from an injected spawn into a failed value", async () => {
    const owner = probeOwner({
      spawn: (() => {
        throw new Error("the fake spawn refused before returning a child");
      }) as unknown as typeof spawn,
    });

    await expect(owner.run(spec())).resolves.toMatchObject({
      kind: "failed",
      why: expect.stringContaining("the fake spawn refused"),
      exitCode: null,
      signal: null,
    });
  });

  it("refuses timer values Node would silently clamp to one millisecond", async () => {
    const neverStarted = child(40_001);
    const fake = spawner([neverStarted]);
    const owner = probeOwner({ spawn: fake.spawn });
    const outcome = await owner.run(spec({ timeoutMs: 2_147_483_648 }));

    expect(outcome).toMatchObject({
      kind: "failed",
      why: expect.stringMatching(/timer.*2147483647ms/i),
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("stops waiting at timeout plus one grace when SIGKILL ends a SIGTERM-ignoring child", async () => {
    const owner = probeOwner();
    const timeoutMs = 80;
    const graceMs = 250;
    const started = performance.now();
    const outcome = await owner.run({
      key: "real-timeout",
      cmd: "sh",
      args: ["-c", "trap '' TERM; sleep 30"],
      timeoutMs,
      graceMs,
    });
    const elapsed = performance.now() - started;

    expect(outcome).toMatchObject({ kind: "timed-out" });
    if (outcome.kind !== "timed-out") throw new Error(`the real child did not time out: ${outcome.kind}`);
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs + graceMs - 20);
    // A second post-SIGKILL grace was the F11 bug in subagent-cli.ts. This is
    // deliberately generous about box scheduling while still distinguishing it.
    expect(elapsed).toBeLessThan(timeoutMs + graceMs * 2);
    if (!outcome.exitObserved) {
      expect(owner.live().map(({ pid }) => pid)).toEqual([outcome.pid]);
      // The deadline owns the caller, not the child. Node 26 sometimes reports
      // the real SIGKILL exit just after that immediate; the registry must keep
      // watching and release the key when the event actually arrives.
      await vi.waitFor(() => expect(owner.live()).toEqual([]), { timeout: 2_000 });
    }
    expect(owner.live()).toEqual([]);
  });

  it("stops waiting after exit when an escaped helper still holds the child's pipes", async () => {
    const owner = probeOwner();
    const started = performance.now();
    const outcome = await owner.run({
      key: "escaped-pipe-holder",
      cmd: "sh",
      args: ["-c", "setsid sh -c 'sleep 1' & printf done"],
      timeoutMs: 2_000,
      graceMs: 100,
    });
    const elapsed = performance.now() - started;

    expect(outcome).toMatchObject({ kind: "ok", stdout: "done" });
    // Without destroying the inherited pipes this returns after the helper's
    // one-second sleep, despite the leader having exited immediately.
    expect(elapsed).toBeLessThan(750);
    expect(owner.live()).toEqual([]);
  });

  it("keeps an unkillable fake registered, refuses its key, permits another key, then releases it on observed exit", async () => {
    vi.useFakeTimers();
    const stuck = child(41_001);
    const other = child(41_002);
    const replacement = child(41_003);
    const fake = spawner([stuck, other, replacement]);
    let now = 1_000;
    const owner = probeOwner({
      spawn: fake.spawn,
      now: () => now,
      readProcStat: (pid) => procStat(pid, { pgrp: 999 }),
    });

    // SIGKILL cannot be ignored by a real process. The fake is the seam that
    // makes the otherwise unmanufacturable "we signalled, it never exited" case observable.
    const firstRun = owner.run(spec());
    await passTimeoutAndGrace();
    await expect(firstRun).resolves.toMatchObject({
      kind: "timed-out",
      pid: stuck.pid,
      exitObserved: false,
    });
    expect(owner.live()).toEqual([
      { key: "probe-a", pid: stuck.pid, startedAtMs: 1_000, signalled: ["SIGTERM", "SIGKILL"], exitObserved: false },
    ]);
    expect(stuck.stdout.destroyed).toBe(true);
    expect(stuck.stderr.destroyed).toBe(true);
    expect(stuck.unref).toHaveBeenCalledOnce();

    now = 1_250;
    await expect(owner.run(spec())).resolves.toMatchObject({
      kind: "refused",
      pid: stuck.pid,
      liveForMs: 250,
    });
    expect(fake.calls).toHaveLength(1);

    now = 1_000_000;
    await expect(owner.run(spec())).resolves.toMatchObject({ kind: "refused", pid: stuck.pid });
    expect(fake.calls).toHaveLength(1);

    const otherRun = owner.run(spec({ key: "probe-b" }));
    other.stdout.write("independent");
    close(other, 0, null);
    await expect(otherRun).resolves.toMatchObject({ kind: "ok", stdout: "independent" });
    expect(fake.calls).toHaveLength(2);

    stuck.emit("exit", null, "SIGKILL");
    expect(owner.live()).toEqual([]);
    const retried = owner.run(spec());
    close(replacement, 0, null);
    await expect(retried).resolves.toMatchObject({ kind: "ok" });
    expect(fake.calls).toHaveLength(3);
  });

  it("does not let an old child's later close remove its replacement", async () => {
    const first = child(41_101);
    const replacement = child(41_102);
    const fake = spawner([first, replacement]);
    const owner = probeOwner({ spawn: fake.spawn });

    const firstRun = owner.run(spec({ timeoutMs: 2_000 }));
    first.emit("exit", 0, null);
    const replacementRun = owner.run(spec({ timeoutMs: 2_000 }));
    first.emit("close", 0, null);
    expect(owner.live().map(({ pid }) => pid)).toEqual([replacement.pid]);

    close(replacement, 0, null);
    await expect(firstRun).resolves.toMatchObject({ kind: "ok" });
    await expect(replacementRun).resolves.toMatchObject({ kind: "ok" });
    expect(owner.live()).toEqual([]);
  });

  it("does not let an old child's delayed group sweep signal a reused pid", async () => {
    vi.useFakeTimers();
    const reusedPid = 41_151;
    const first = child(reusedPid);
    const replacement = child(reusedPid);
    const fake = spawner([first, replacement]);
    let currentStartTime = "6001";
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => procStat(pid, { startTime: currentStartTime }),
    });

    const firstRun = owner.run(spec({ timeoutMs: 10_000, graceMs: 25 }));
    first.emit("exit", 0, null);
    expect(groupKill).toHaveBeenCalledTimes(1);
    expect(groupKill).toHaveBeenCalledWith(-reusedPid, "SIGTERM");

    currentStartTime = "6002";
    const replacementRun = owner.run(spec({ timeoutMs: 10_000, graceMs: 25 }));
    await vi.advanceTimersByTimeAsync(25);
    await expect(firstRun).resolves.toMatchObject({ kind: "ok" });
    expect(groupKill).toHaveBeenCalledTimes(1);
    expect(replacement.kill).not.toHaveBeenCalled();

    close(replacement, 0, null);
    await expect(replacementRun).resolves.toMatchObject({ kind: "ok" });
  });

  it("releases the key on exit without waiting for close or mistaking held pipes for a stuck child", async () => {
    vi.useFakeTimers();
    const exited = child(41_201);
    const replacement = child(41_202);
    const fake = spawner([exited, replacement]);
    const owner = probeOwner({ spawn: fake.spawn, readProcStat: (pid) => procStat(pid, { pgrp: 99 }) });

    const firstRun = owner.run(spec({ timeoutMs: 10_000, graceMs: 25 }));
    expect(owner.live().map(({ pid }) => pid)).toEqual([exited.pid]);
    exited.emit("exit", 0, null);

    expect(owner.live()).toEqual([]);
    const replacementRun = owner.run(spec({ timeoutMs: 10_000, graceMs: 25 }));
    expect(fake.calls).toHaveLength(2);
    close(replacement, 0, null);
    await expect(replacementRun).resolves.toMatchObject({ kind: "ok" });

    await vi.advanceTimersByTimeAsync(25);
    await expect(firstRun).resolves.toMatchObject({ kind: "ok" });
    expect(owner.live()).toEqual([]);
  });

  it("uses the process-group proof captured at spawn to sweep descendants after the leader exits", async () => {
    vi.useFakeTimers();
    const leader = child(41_301);
    const fake = spawner([leader]);
    let reads = 0;
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => {
        reads += 1;
        if (reads === 1) return procStat(pid, { startTime: "7001" });
        throw errno("ENOENT", "the leader has been reaped");
      },
    });

    const run = owner.run(spec({ timeoutMs: 10_000, graceMs: 25 }));
    expect(reads).toBe(1);
    leader.emit("exit", 0, null);

    expect(groupKill).toHaveBeenCalledWith(-leader.pid, "SIGTERM");
    await vi.advanceTimersByTimeAsync(25);
    expect(groupKill).toHaveBeenCalledWith(-leader.pid, "SIGKILL");
    await expect(run).resolves.toMatchObject({ kind: "ok" });
    expect(leader.kill).not.toHaveBeenCalled();
  });

  it("signals a child only while its captured start time still matches", async () => {
    vi.useFakeTimers();
    const fakeChild = child(41_401);
    const fake = spawner([fakeChild]);
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => procStat(pid, { startTime: "8001" }),
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(groupKill).toHaveBeenNthCalledWith(1, -fakeChild.pid, "SIGTERM");
    expect(groupKill).toHaveBeenNthCalledWith(2, -fakeChild.pid, "SIGKILL");
    expect(fakeChild.kill).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "timed-out", exitObserved: false });
    fakeChild.emit("exit", null, "SIGKILL");
  });

  it("signals nothing when the pid's start time no longer matches the child captured at spawn", async () => {
    vi.useFakeTimers();
    const original = child(41_501);
    const fake = spawner([original]);
    let reads = 0;
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => {
        reads += 1;
        return procStat(pid, { startTime: reads === 1 ? "9001" : "9002" });
      },
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(groupKill).not.toHaveBeenCalled();
    expect(original.kill).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ kind: "timed-out", exitObserved: true });
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/start time 9001.*now names.*9002.*sent no signal/i);
    expect(owner.live()).toEqual([]);
  });

  it("does not treat EACCES as evidence of exit or permit a second child", async () => {
    vi.useFakeTimers();
    const inaccessible = child(41_601);
    const forbiddenReplacement = child(41_602);
    const fake = spawner([inaccessible, forbiddenReplacement]);
    let reads = 0;
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => {
        reads += 1;
        if (reads === 1) return procStat(pid, { startTime: "9101" });
        throw errno("EACCES", "proc is temporarily inaccessible");
      },
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(outcome).toMatchObject({ kind: "timed-out", exitObserved: false });
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toContain("proc is temporarily inaccessible");
    expect(groupKill).not.toHaveBeenCalled();
    expect(inaccessible.kill).not.toHaveBeenCalled();
    await expect(owner.run(spec())).resolves.toMatchObject({ kind: "refused", pid: inaccessible.pid });
    expect(fake.calls).toHaveLength(1);
    expect(owner.live().map(({ pid }) => pid)).toEqual([inaccessible.pid]);

    inaccessible.emit("exit", null, "SIGKILL");
  });

  it.each(["Z", "X"])("treats matching kernel state %s as positive evidence of death", async (state) => {
    vi.useFakeTimers();
    const dead = child(state === "Z" ? 41_650 : 41_651);
    const fake = spawner([dead]);
    let reads = 0;
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => {
        reads += 1;
        return procStat(pid, { state: reads >= 4 ? state : "S", pgrp: 99, startTime: "9151" });
      },
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();

    await expect(run).resolves.toMatchObject({ kind: "timed-out", exitObserved: true });
    expect(owner.live()).toEqual([]);
  });

  it("re-checks an unaccounted child on retry and releases refusal when ENOENT proves it is gone", async () => {
    vi.useFakeTimers();
    const vanished = child(41_701);
    const replacement = child(41_702);
    const fake = spawner([vanished, replacement]);
    let gone = false;
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => {
        if (gone && pid === vanished.pid) throw errno("ENOENT", "the old child is gone");
        return procStat(pid, { pgrp: 99 });
      },
    });

    const firstRun = owner.run(spec());
    await passTimeoutAndGrace();
    await expect(firstRun).resolves.toMatchObject({ kind: "timed-out", exitObserved: false });

    gone = true;
    const replacementRun = owner.run(spec({ timeoutMs: 10_000 }));
    expect(fake.calls).toHaveLength(2);
    close(replacement, 0, null);
    await expect(replacementRun).resolves.toMatchObject({ kind: "ok" });
    expect(owner.live()).toEqual([]);
  });

  it("bounds a child with no pid at exactly timeout plus grace", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
    const pidless = child(41_801);
    pidless.pid = undefined as unknown as number;
    const fake = spawner([pidless]);
    const owner = probeOwner({ spawn: fake.spawn, now: Date.now });

    const startedAt = Date.now();
    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;
    const elapsed = Date.now() - startedAt;

    // The promised setImmediate observation window is one fake-clock tick; in
    // particular there is no second grace after SIGKILL.
    expect(elapsed).toBeLessThanOrEqual(31);
    expect(outcome).toMatchObject({ kind: "timed-out", pid: null, exitObserved: false, tookMs: elapsed });
    if (outcome.kind !== "timed-out") throw new Error(`the pidless child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/no pid.*SIGTERM.*no pid.*SIGKILL/i);
    expect(owner.live()).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it("forwards a parent termination signal to an owned detached child before re-raising it", async () => {
    vi.useFakeTimers();
    const owned = child(41_901);
    const fake = spawner([owned]);
    const before = new Set(process.listeners("SIGTERM"));
    const selfKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => procStat(pid, { pgrp: 99 }),
    });
    const run = owner.run(spec({ timeoutMs: 10_000 }));
    const installed = process.listeners("SIGTERM").filter((listener) => !before.has(listener));

    expect(installed).toHaveLength(1);
    installed[0]?.("SIGTERM");
    expect(owned.kill).toHaveBeenCalledWith("SIGTERM");
    expect(selfKill).toHaveBeenCalledWith(process.pid, "SIGTERM");

    close(owned, 0, null);
    await expect(run).resolves.toMatchObject({ kind: "ok" });
  });

  it("proves a process group from stat parsed after a comm containing spaces and a closing parenthesis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const fakeChild = child(1_234);
    const fake = spawner([fakeChild]);
    const sent: Array<{ signal: string | number | undefined; atMs: number }> = [];
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      sent.push({ signal, atMs: Date.now() });
      if (signal === "SIGKILL") fakeChild.emit("exit", null, "SIGKILL");
      return true;
    });
    const owner = probeOwner({
      spawn: fake.spawn,
      now: Date.now,
      readProcStat: () => procStat(1_234, { comm: "my ) proc", startTime: "10001" }),
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(kill).toHaveBeenNthCalledWith(1, -1_234, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, -1_234, "SIGKILL");
    expect(sent).toEqual([
      { signal: "SIGTERM", atMs: 1_020 },
      { signal: "SIGKILL", atMs: 1_030 },
    ]);
    expect(outcome).toMatchObject({ kind: "timed-out", exitObserved: true });
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.tookMs).toBeLessThanOrEqual(31);
    expect(fakeChild.kill).not.toHaveBeenCalled();
  });

  it("signals only the pid when stat reports a different process group, and explains the fallback", async () => {
    vi.useFakeTimers();
    const fakeChild = child(2_345);
    const fake = spawner([fakeChild]);
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => procStat(pid, { pgrp: 99 }),
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(groupKill).not.toHaveBeenCalled();
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/process group 99.*not.*2345.*pid.*only/i);
    fakeChild.emit("exit", null, "SIGKILL");
  });

  it("signals nothing when proc stat was unreadable at spawn, and explains why", async () => {
    vi.useFakeTimers();
    const fakeChild = child(3_456);
    const fake = spawner([fakeChild]);
    const groupKill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: () => {
        throw new Error("permission denied");
      },
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(groupKill).not.toHaveBeenCalled();
    expect(fakeChild.kill).not.toHaveBeenCalled();
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/could not read.*permission denied.*at spawn.*sent no SIGTERM/i);
    fakeChild.emit("exit", null, "SIGKILL");
  });

  it("decodes a multibyte codepoint split across stdout chunks", async () => {
    const fakeChild = child(4_567);
    const fake = spawner([fakeChild]);
    const owner = probeOwner({ spawn: fake.spawn, readProcStat: (pid) => procStat(pid, { pgrp: 99 }) });
    const run = owner.run(spec());
    const bytes = Buffer.from("before € after", "utf8");
    const euro = Buffer.from("before ", "utf8").length;
    fakeChild.stdout.write(bytes.subarray(0, euro + 1));
    fakeChild.stdout.write(bytes.subarray(euro + 1));
    close(fakeChild, 0, null);

    await expect(run).resolves.toMatchObject({ kind: "ok", stdout: "before € after" });
  });

  it("kills capture overflow and settles as overflowed without truncating it into success", async () => {
    vi.useFakeTimers();
    const fakeChild = child(5_678);
    const fake = spawner([fakeChild]);
    const owner = probeOwner({
      spawn: fake.spawn,
      readProcStat: (pid) => procStat(pid, { pgrp: 99 }),
    });
    const env = { FLEET_CHILD_TEST: "present" };
    const run = owner.run(spec({ timeoutMs: 10_000, graceMs: 10, maxBytes: 5, cwd: "/tmp", env }));

    fakeChild.stdout.write(Buffer.from("123"));
    fakeChild.stderr.write(Buffer.from("456"));
    await vi.advanceTimersByTimeAsync(10);
    const outcome = await run;

    expect(outcome).toMatchObject({ kind: "overflowed", capturedBytes: 6 });
    if (outcome.kind !== "overflowed") throw new Error(`the fake child did not overflow: ${outcome.kind}`);
    expect(outcome.why).toContain("5-byte");
    expect(fakeChild.kill).toHaveBeenCalledWith("SIGKILL");
    expect(fake.calls[0]?.options).toMatchObject({
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: "/tmp",
      env,
    });
    fakeChild.emit("exit", null, "SIGKILL");
    await vi.advanceTimersByTimeAsync(10);
    expect(fakeChild.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  });
});

describe("limit", () => {
  it("runs all jobs while never allowing more than two at once", async () => {
    const runLimited = limit(2);
    let active = 0;
    let mostActive = 0;
    const releases: Array<() => void> = [];
    const jobs = Array.from({ length: 5 }, (_, index) => runLimited(async () => {
      active += 1;
      mostActive = Math.max(mostActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    }));

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    releases.shift()?.();

    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2, 3, 4]);
    expect(mostActive).toBe(2);
  });

  it("starts queued jobs in order and releases a slot when a job throws", async () => {
    const runLimited = limit(1);
    const started: number[] = [];
    const first = runLimited(async () => {
      started.push(1);
      throw new Error("first job failed");
    });
    // Attach the observer immediately: this is an expected rejection, not an
    // unhandled-rejection probe that can take the Vitest worker down.
    const firstObserved = first.catch((cause: unknown) => cause);
    const second = runLimited(async () => {
      started.push(2);
      return "second completed";
    });
    const third = runLimited(async () => {
      started.push(3);
      return "third completed";
    });

    await expect(firstObserved).resolves.toEqual(expect.objectContaining({ message: "first job failed" }));
    await expect(Promise.all([second, third])).resolves.toEqual(["second completed", "third completed"]);
    expect(started).toEqual([1, 2, 3]);
  });

  it("does not turn an abandoned rejected limited job into an unhandled-rejection process death", async () => {
    const script = [
      'import { limit } from "./tools/fleet/child.ts";',
      "const run = limit(1);",
      'void run(async () => { throw new Error("deliberately abandoned"); });',
      "await new Promise((resolve) => setTimeout(resolve, 20));",
    ].join("\n");

    await expect(execFileAsync(
      process.execPath,
      ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), timeout: 2_000 },
    )).resolves.toMatchObject({ stderr: "" });
  });
});
