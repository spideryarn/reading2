import { describe, expect, it } from "vitest";

import { isBrowserProgram } from "../tools/fleet/actions.js";
import {
  foldCensus,
  readProcRows,
  recogniseCensusClass,
  startCensusTask,
  type CensusProcIo,
  type CensusProcRow,
} from "../tools/fleet/admission-census.js";

function row(
  pid: number,
  ppid: number,
  args: string,
  over: Partial<Extract<CensusProcRow, { kind: "read" }>> = {},
): Extract<CensusProcRow, { kind: "read" }> {
  return {
    kind: "read",
    pid,
    ppid,
    comm: "node",
    args,
    startTicks: pid * 10,
    changedUnderRead: false,
    ...over,
  };
}

function stat(pid: number, ppid: number, startTicks: number, comm = "node"): string {
  const fields = ["S", String(ppid), ...Array.from({ length: 17 }, () => "0"), String(startTicks)];
  return `${pid} (${comm}) ${fields.join(" ")}\n`;
}

function error(code: string, message = code): NodeJS.ErrnoException {
  const cause = new Error(message) as NodeJS.ErrnoException;
  cause.code = code;
  return cause;
}

function procIo(files: Record<string, Array<string | Buffer | Error>>, entries = ["101"]): CensusProcIo {
  return {
    readdir: async () => entries,
    readFile: async (path) => {
      const values = files[path];
      const value = values?.shift();
      if (value === undefined) throw error("ENOENT", `${path} was not in the fixture`);
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(cause: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("the admission census recognisers and fold", () => {
  it("pins the extracted browser-program rule to its exact, normalised comm names", () => {
    expect(isBrowserProgram({ comm: "chrome" })).toBe(true);
    expect(isBrowserProgram({ comm: "chromium" })).toBe(true);
    expect(isBrowserProgram({ comm: "google-chrome" })).toBe(true);
    expect(isBrowserProgram({ comm: "  Chrome  " })).toBe(true);
    expect(isBrowserProgram({ comm: "chrome_crashpad" })).toBe(false);
    expect(isBrowserProgram({ comm: "node" })).toBe(false);
  });

  it("does not count a Chrome helper, while counting its browser parent as the root", () => {
    const browser = row(10, 1, "/opt/google/chrome/chrome --remote-debugging-pipe", { comm: "chrome" });
    const helper = row(11, 10, "/opt/google/chrome/chrome --type=renderer", { comm: "chrome" });
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });

    expect(recogniseCensusClass(browser)).toBe("browser");
    expect(recogniseCensusClass(helper)).toBe("browser");
    expect(foldCensus([browser, helper, init]).byClass.browser).toEqual({ roots: 1, uncertain: 0 });
  });

  it("folds a real Vitest fork worker into its runner root", () => {
    const worktree = "/home/greg/code/spideryarn2/.claude/worktrees/admission-census";
    const runner = row(20, 1, `node ${worktree}/node_modules/.bin/vitest run`);
    const worker = row(
      21,
      20,
      `/usr/bin/node --experimental-import-meta-resolve --require ${worktree}/node_modules/vitest/suppress-warnings.cjs --conditions node --conditions development ${worktree}/node_modules/vitest/dist/workers/forks.js`,
    );
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });

    expect(recogniseCensusClass(runner)).toBe("test");
    expect(recogniseCensusClass(worker)).toBe("test");
    expect(foldCensus([runner, worker, init]).byClass.test).toEqual({ roots: 1, uncertain: 0 });
  });

  it("does not promote an orphaned Vitest worker to a runner root", () => {
    const worker = row(
      21,
      1,
      "/usr/bin/node --require /repo/node_modules/vitest/suppress-warnings.cjs /repo/node_modules/vitest/dist/workers/forks.js",
    );
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });

    expect(recogniseCensusClass(worker)).toBe("test");
    expect(foldCensus([worker, init]).byClass.test).toEqual({ roots: 0, uncertain: 0 });
  });

  it("does not mistake a runner's later workers-path argument for its executable", () => {
    const runner = row(
      20,
      1,
      "node /repo/node_modules/vitest/dist/cli.js run /repo/node_modules/vitest/dist/workers/example.test.js",
    );
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });

    expect(recogniseCensusClass(runner)).toBe("test");
    expect(foldCensus([runner, init]).byClass.test).toEqual({ roots: 1, uncertain: 0 });
  });

  it("does not count vim with a vitest-path argument as a test root", () => {
    const editor = row(20, 1, "vim /repo/node_modules/.bin/vitest", { comm: "vim" });
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });

    expect(foldCensus([editor, init]).byClass.test).toEqual({ roots: 0, uncertain: 0 });
  });

  it("reuses executable recognisers without matching prose, fake tools, MCP arguments or crashpad", () => {
    expect(recogniseCensusClass(row(30, 1, "vim vitest.config.ts", { comm: "vim" }))).toBeNull();
    expect(recogniseCensusClass(row(31, 1, "grep -r vitest", { comm: "grep" }))).toBeNull();
    expect(
      recogniseCensusClass(row(32, 1, "node /opt/chrome-devtools-mcp/index.js --browser chrome", { comm: "node" })),
    ).toBeNull();
    expect(recogniseCensusClass(row(33, 1, "bash /tmp/fake-codex-x/codex -o out", { comm: "bash" }))).toBeNull();
    expect(recogniseCensusClass(row(34, 1, "codex exec --model x do␣the␣thing", { comm: "codex" }))).toBe(
      "codex-batch",
    );
    expect(recogniseCensusClass(row(35, 1, "codex", { comm: "codex" }))).toBeNull();
    expect(recogniseCensusClass(row(36, 1, "codex review␣this␣diff", { comm: "codex" }))).toBeNull();
    expect(recogniseCensusClass(row(37, 1, "/opt/chrome_crashpad", { comm: "chrome_crashpad" }))).toBeNull();
  });

  it("keeps changed and unreadable rows out of classes and marks every unsettled ancestry", () => {
    const changedCandidate = row(10, 1, "codex exec work", { comm: "codex", changedUnderRead: true });
    const changedParent = row(21, 1, "bash", { comm: "bash", changedUnderRead: true });
    const underChanged = row(20, 21, "codex exec work", { comm: "codex" });
    const unreadableParent: CensusProcRow = { kind: "unreadable", pid: 31, why: "permission denied" };
    const underUnreadable = row(30, 31, "node /repo/node_modules/.bin/vitest run");
    const underMissing = row(40, 999, "/opt/chrome", { comm: "chrome" });
    const laterParent = row(51, 1, "bash", { comm: "bash", startTicks: 501 });
    const underLaterParent = row(50, 51, "codex exec work", { comm: "codex", startTicks: 500 });
    const cycleA = row(61, 62, "bash", { comm: "bash" });
    const cycleB = row(62, 61, "bash", { comm: "bash" });
    const underCycle = row(60, 61, "node /repo/node_modules/.bin/vitest run");
    const kernelRoot = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });
    const certain = row(70, 1, "/opt/chrome", { comm: "chrome", startTicks: 700 });

    const census = foldCensus([
      changedCandidate,
      changedParent,
      underChanged,
      unreadableParent,
      underUnreadable,
      underMissing,
      laterParent,
      underLaterParent,
      cycleA,
      cycleB,
      underCycle,
      kernelRoot,
      certain,
    ]);

    expect(census.byClass).toEqual({
      test: { roots: 0, uncertain: 2 },
      "codex-batch": { roots: 0, uncertain: 2 },
      browser: { roots: 1, uncertain: 1 },
    });
    expect(census.changedUnderRead).toBe(2);
    expect(census.unreadable).toBe(1);
    expect(census.processesSeen).toBe(13);
  });

  it("uses strict later-than for stale parent links, so equal start ticks remain a valid ancestry", () => {
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });
    const parent = row(80, 1, "bash", { comm: "bash", startTicks: 800 });
    const child = row(81, 80, "codex exec work", { comm: "codex", startTicks: 800 });

    expect(foldCensus([init, parent, child]).byClass["codex-batch"]).toEqual({ roots: 1, uncertain: 0 });
  });

  it("treats a missing pid 1 like every other missing positive parent", () => {
    const candidate = row(90, 1, "codex exec work", { comm: "codex" });

    expect(foldCensus([candidate]).byClass["codex-batch"]).toEqual({ roots: 0, uncertain: 1 });
  });

  it("walks through a readable pid 1 rather than hiding a same-class ancestor", () => {
    const init = row(1, 0, "codex exec init-work", { comm: "codex", startTicks: 1 });
    const child = row(90, 1, "codex exec child-work", { comm: "codex" });

    expect(foldCensus([init, child]).byClass["codex-batch"]).toEqual({ roots: 1, uncertain: 0 });
  });

  it("keeps ancestry through an empty-argv parent uncertain", () => {
    const init = row(1, 0, "/sbin/init", { comm: "systemd", startTicks: 1 });
    const zombieParent = row(80, 1, "", { comm: "codex", startTicks: 800 });
    const childObservedEarlier = row(81, 80, "codex exec work", { comm: "codex", startTicks: 810 });

    expect(foldCensus([init, zombieParent, childObservedEarlier]).byClass["codex-batch"]).toEqual({
      roots: 0,
      uncertain: 1,
    });
  });
});

describe("readProcRows", () => {
  it("retains argv boundaries for Codex while preserving Vitest and Chrome-helper recognition", async () => {
    const files: Record<string, Array<string | Buffer | Error>> = {};
    const add = (pid: number, comm: string, argv: string[]) => {
      files[`/proc/${pid}/stat`] = [stat(pid, 1, pid * 10, comm), stat(pid, 1, pid * 10, comm)];
      files[`/proc/${pid}/cmdline`] = [Buffer.from(`${argv.join("\0")}\0`)];
    };
    add(101, "codex", ["codex", "review this diff"]);
    add(102, "codex", ["codex", "exec", "--model", "x", "do the thing"]);
    add(103, "node", ["node", "/repo/node_modules/vitest/dist/workers/forks.js"]);
    add(104, "chrome", ["/opt/chrome", "--type=renderer", "two words"]);
    add(105, "codex", ["codex", "", "exec"]);

    const rows = await readProcRows(procIo(files, ["self", "101", "net", "102", "103", "104", "105", "1x"]));
    const readable = rows.filter((candidate): candidate is Extract<CensusProcRow, { kind: "read" }> => candidate.kind === "read");

    expect(readable.map((candidate) => candidate.args)).toEqual([
      "codex review␣this␣diff",
      "codex exec --model x do␣the␣thing",
      "node /repo/node_modules/vitest/dist/workers/forks.js",
      "/opt/chrome --type=renderer two␣words",
      "codex ␀ exec",
    ]);
    expect(readable.map(recogniseCensusClass)).toEqual([null, "codex-batch", "test", "browser", null]);
    expect(foldCensus(readable).byClass.browser).toEqual({ roots: 0, uncertain: 0 });
  });

  it.each([
    ["between stat and cmdline", [stat(101, 1, 1)], [error("ENOENT", "gone before cmdline")]],
    ["between cmdline and the second stat", [stat(101, 1, 1), error("ESRCH", "gone before second stat")], ["node\0script.js\0"]],
  ])("keeps a pid that vanished %s as unreadable", async (_name, stats, cmdline) => {
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [...stats],
        "/proc/101/cmdline": [...cmdline],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "unreadable", pid: 101 });
  });

  it.each([
    ["kernel thread", 2, "kworker/0:0", "S"],
    ["zombie Chrome", 1, "chrome", "Z"],
  ])("keeps an empty-argv %s readable and unrecognised", async (_name, ppid, comm, state) => {
    const before = stat(101, ppid, 900, comm).replace(") S ", `) ${state} `);
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [before, before],
        "/proc/101/cmdline": [Buffer.alloc(0)],
      }),
    );

    expect(rows).toEqual([
      {
        kind: "read",
        pid: 101,
        ppid,
        comm,
        args: "",
        startTicks: 900,
        changedUnderRead: false,
      },
    ]);
    expect(recogniseCensusClass(rows[0] as Extract<CensusProcRow, { kind: "read" }>)).toBeNull();
    expect(foldCensus(rows)).toMatchObject({
      unreadable: 0,
      byClass: {
        test: { roots: 0, uncertain: 0 },
        "codex-batch": { roots: 0, uncertain: 0 },
        browser: { roots: 0, uncertain: 0 },
      },
    });
  });

  it.each([
    ["first stat", [""], []],
    ["second stat", [stat(101, 1, 1), ""], ["node\0script.js\0"]],
  ] as const)("keeps an empty %s read as unreadable", async (_name, stats, cmdline) => {
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [...stats],
        "/proc/101/cmdline": [...cmdline],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "unreadable", pid: 101 });
  });

  it("marks a ppid change with equal start ticks as changed-under-read", async () => {
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [stat(101, 7, 900), stat(101, 1, 900)],
        "/proc/101/cmdline": ["codex\0exec\0work\0"],
      }),
    );

    expect(rows[0]).toMatchObject({ kind: "read", pid: 101, changedUnderRead: true });
    expect(foldCensus(rows)).toMatchObject({ changedUnderRead: 1, byClass: { "codex-batch": { roots: 0, uncertain: 0 } } });
  });

  it("marks a reused pid whose start tick changes as changed-under-read", async () => {
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [stat(101, 1, 900), stat(101, 1, 901)],
        "/proc/101/cmdline": ["codex\0exec\0work\0"],
      }),
    );

    expect(rows[0]).toMatchObject({ kind: "read", pid: 101, changedUnderRead: true });
    expect(foldCensus(rows)).toMatchObject({ changedUnderRead: 1, byClass: { "codex-batch": { roots: 0, uncertain: 0 } } });
  });

  it("marks a comm change as changed-under-read before comm and cmdline can form a false browser", async () => {
    const rows = await readProcRows(
      procIo({
        "/proc/101/stat": [stat(101, 1, 900, "chrome"), stat(101, 1, 900, "node")],
        "/proc/101/cmdline": ["node\0script.js\0"],
      }),
    );

    expect(rows[0]).toMatchObject({ kind: "read", pid: 101, changedUnderRead: true });
    expect(foldCensus(rows)).toMatchObject({
      changedUnderRead: 1,
      byClass: { browser: { roots: 0, uncertain: 0 } },
    });
  });

  it("throws when /proc itself cannot be enumerated", async () => {
    await expect(
      readProcRows({
        readdir: async () => {
          throw error("EACCES", "proc denied");
        },
        readFile: async () => "",
      }),
    ).rejects.toThrow("proc denied");
  });
});

describe("startCensusTask", () => {
  it("turns an unenumerable /proc into a failed state carrying its cause", async () => {
    const task = startCensusTask({
      readRows: () =>
        readProcRows({
          readdir: async () => {
            throw error("EACCES", "proc denied");
          },
          readFile: async () => "",
        }),
      cadenceMs: 30_000,
      nowMs: () => 123,
      setTimer: () => ({ unref() {} }),
    });
    expect(task.read()).toEqual({ kind: "not-yet-computed", label: "observed", startedAtMs: 123 });

    await turn();

    expect(task.read()).toEqual({
      kind: "failed",
      label: "observed",
      why: "proc denied",
      failedAtMs: 123,
      cadenceMs: 30_000,
      lastGood: null,
    });
    task.stop();
  });

  it("keeps the last good result stale after a throw and never leaks a rejection", async () => {
    const timers: Array<() => void> = [];
    let call = 0;
    let clock = 1_000;
    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => unhandled.push(cause);
    process.on("unhandledRejection", onUnhandled);
    const task = startCensusTask({
      readRows: async () => {
        call += 1;
        if (call === 1) return [row(10, 0, "codex exec work", { comm: "codex" })];
        throw new Error("second pass broke");
      },
      cadenceMs: 50,
      nowMs: () => clock++,
      setTimer: (callback) => {
        timers.push(callback);
        return { unref() {} };
      },
    });

    try {
      await turn();
      const good = task.read();
      expect(good).toMatchObject({ kind: "value", label: "observed", startedAtMs: 1_001, completedAtMs: 1_002, durationMs: 1 });
      expect(timers).toHaveLength(1);

      timers.shift()?.();
      await turn();

      expect(task.read()).toEqual({
        kind: "failed",
        label: "observed",
        why: "second pass broke",
        failedAtMs: 1_004,
        cadenceMs: 50,
        lastGood: {
          census: good.kind === "value" ? good.census : null,
          startedAtMs: 1_001,
          completedAtMs: 1_002,
        },
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      task.stop();
    }
  });

  it("end-chains passes, unreferences timers, and stop prevents another pass", async () => {
    const first = deferred<CensusProcRow[]>();
    const timers: Array<{ callback: () => void; delayMs: number; unrefCalls: number }> = [];
    let calls = 0;
    const task = startCensusTask({
      readRows: () => {
        calls += 1;
        return calls === 1 ? first.promise : Promise.resolve([]);
      },
      cadenceMs: 77,
      nowMs: () => 100,
      setTimer: (callback, delayMs) => {
        const timer = { callback, delayMs, unrefCalls: 0 };
        timers.push(timer);
        return {
          unref() {
            timer.unrefCalls += 1;
          },
        };
      },
    });

    expect(calls).toBe(1);
    expect(timers).toEqual([]);
    first.resolve([]);
    await turn();
    expect(timers).toMatchObject([{ delayMs: 77, unrefCalls: 1 }]);

    task.stop();
    timers[0]?.callback();
    await turn();
    expect(calls).toBe(1);
  });

  it("does not fold or publish an in-flight read after stop", async () => {
    const pending = deferred<CensusProcRow[]>();
    let folds = 0;
    const task = startCensusTask({
      readRows: () => pending.promise,
      fold: () => {
        folds += 1;
        return foldCensus([]);
      },
      cadenceMs: 30_000,
      nowMs: () => 100,
      setTimer: () => ({ unref() {} }),
    });

    task.stop();
    pending.resolve([]);
    await turn();

    expect(folds).toBe(0);
    expect(task.read()).toEqual({ kind: "not-yet-computed", label: "observed", startedAtMs: 100 });
  });

  it("does not publish or report an in-flight read failure after stop", async () => {
    const pending = deferred<CensusProcRow[]>();
    const logs: string[] = [];
    const task = startCensusTask({
      readRows: () => pending.promise,
      cadenceMs: 30_000,
      nowMs: () => 100,
      setTimer: () => ({ unref() {} }),
      log: (message) => logs.push(message),
    });

    task.stop();
    pending.reject(new Error("late failure"));
    await turn();

    expect(task.read()).toEqual({ kind: "not-yet-computed", label: "observed", startedAtMs: 100 });
    expect(logs).toEqual([]);
  });

  it("does not throw when its clock or a failure cause cannot be read", async () => {
    const hostileCause = {
      toString() {
        throw new Error("cause renderer exploded");
      },
    };
    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => unhandled.push(cause);
    let clockCalls = 0;
    process.on("unhandledRejection", onUnhandled);
    const task = startCensusTask({
      readRows: async () => {
        throw hostileCause;
      },
      cadenceMs: 30_000,
      nowMs: () => {
        clockCalls += 1;
        if (clockCalls === 1) throw new Error("");
        return 123;
      },
      setTimer: () => ({ unref() {} }),
    });

    try {
      await turn();
      expect(task.read()).toMatchObject({
        kind: "failed",
        why: "the census pass failed with a cause that could not be rendered",
      });
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      task.stop();
    }
  });

  it("does not publish counts under a pass whose wall clock moved backwards", async () => {
    const times = [100, 200, 150, 160];
    const task = startCensusTask({
      readRows: async () => [],
      cadenceMs: 30_000,
      nowMs: () => times.shift() ?? 160,
      setTimer: () => ({ unref() {} }),
    });

    await turn();

    expect(task.read()).toMatchObject({
      kind: "failed",
      why: "the census clock moved backwards during the pass (200 to 150)",
      failedAtMs: 160,
      lastGood: null,
    });
    task.stop();
  });
});
