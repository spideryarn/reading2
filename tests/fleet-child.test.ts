import type { spawn, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { limit, probeOwner, type ProbeSpec } from "../tools/fleet/child.js";

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
      readProcStat: (pid) => `${pid} (fake) S 1 999 0 0`,
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
      readProcStat: () => "1234 (my ) proc) S 1 1234 7 8 9",
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
      readProcStat: () => "2345 (not ours) S 1 99 7 8 9",
    });

    const run = owner.run(spec());
    await passTimeoutAndGrace();
    const outcome = await run;

    expect(groupKill).not.toHaveBeenCalled();
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/process group 99.*not.*2345.*pid.*only/i);
  });

  it("signals only the pid when proc stat is unreadable, and explains the fallback", async () => {
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
    expect(fakeChild.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(fakeChild.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    if (outcome.kind !== "timed-out") throw new Error(`the fake child did not time out: ${outcome.kind}`);
    expect(outcome.why).toMatch(/could not read.*permission denied.*pid.*only/i);
  });

  it("decodes a multibyte codepoint split across stdout chunks", async () => {
    const fakeChild = child(4_567);
    const fake = spawner([fakeChild]);
    const owner = probeOwner({ spawn: fake.spawn, readProcStat: () => "4567 (fake) S 1 4567" });
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
      readProcStat: () => "5678 (fake) S 1 99 0 0",
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
});
