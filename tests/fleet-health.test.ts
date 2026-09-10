/**
 * Box health — tools/fleet/health.ts.
 *
 * EVERY `-real.txt` FIXTURE UNDER tests/fixtures/fleet-health/ IS A REAL
 * CAPTURE, taken directly on this box on 2026-09-08 while writing this
 * module (`ps-rss-args-mixed-real.txt` is a curated subset of a real
 * `ps -eo rss,args --no-headers` capture — the full listing was over a
 * thousand lines including two multi-kilobyte codex review prompts, so this
 * keeps the rss numbers and command lines that drive classification and
 * drops the noise, rather than committing a bloated fixture). The
 * `-malformed.txt` and `-critical.txt` fixtures are fabricated, per this
 * project's rule that an edge case that cannot be provoked live still needs a
 * declared-fabricated fixture rather than being skipped.
 *
 * WHAT THIS FILE IS FOR. The parsers and assembly are the testability seam
 * (see the top of health.ts): this exercises each parser against real and
 * deliberately malformed output, then proves the synchronous and owned-child
 * gatherers produce the same report from the same captured bytes.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn<(cmd: string, args: readonly string[]) => string>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: execFileSyncMock };
});

import {
  collectHealth,
  collectHealthAsync,
  computeVerdict,
  parseAttribution,
  parseDisk,
  parseLoad,
  parseMemory,
  parseNproc,
  parseSwap,
  parseSwapActivity,
  type HealthReport,
} from "../tools/fleet/health.js";
import type { OwnedOutcome, ProbeOwner, ProbeSpec } from "../tools/fleet/child.js";
import { statePayload } from "../tools/fleet/state.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-health");
const fx = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");

const commandOutput = (cmd: string): string => {
  const fixtures: Record<string, string> = {
    uptime: fx("uptime-real.txt"),
    nproc: fx("nproc-real.txt"),
    free: fx("free-b-real.txt"),
    swapon: fx("swapon-bytes-real.txt"),
    df: fx("df-k-real.txt"),
    vmstat: fx("vmstat-1-3-real.txt"),
    ps: fx("ps-rss-args-mixed-real.txt"),
  };
  const out = fixtures[cmd];
  if (out === undefined) throw new Error(`no fixture for ${cmd}`);
  return out;
};

function successfulOwner(
  outcomeFor: (spec: ProbeSpec) => OwnedOutcome = (spec) => ({
    kind: "ok",
    stdout: commandOutput(spec.cmd),
    stderr: "",
    tookMs: 1,
  }),
): ProbeOwner {
  return {
    run: async (spec) => outcomeFor(spec),
    live: () => [],
  };
}

function withoutClocks(report: ReturnType<typeof collectHealth>) {
  const { collectedAt: _collectedAt, tookMs: _tookMs, ...readings } = report;
  return readings;
}

describe("health gathering and assembly", () => {
  it("keeps the synchronous and owned-child gatherers equivalent over identical command output", async () => {
    /* The managed test sandbox refuses ad-hoc fixture executables with EPERM.
       This mock is only the sync gatherer's transport: every returned byte is
       still a captured fixture, and the parsers below independently pin what
       those bytes mean. No parser or assembly function is mocked. */
    execFileSyncMock.mockImplementation((cmd) => commandOutput(cmd));
    const asyncSpecs: ProbeSpec[] = [];

    const sync = collectHealth({ includeSwapActivity: true });
    const asyncReport = await collectHealthAsync({
      owner: successfulOwner((spec) => {
        asyncSpecs.push(spec);
        return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
      }),
      includeSwapActivity: true,
      nowMs: () => 1_000,
    });

    expect(withoutClocks(asyncReport)).toEqual(withoutClocks(sync));
    expect(withoutClocks(asyncReport)).toEqual({
      load: { kind: "value", load1: 14.32, load5: 25.29, load15: 66.78, cores: 16, ratio1: 0.895 },
      memory: {
        kind: "value",
        totalBytes: 32_859_295_744,
        availableBytes: 12_811_866_112,
        availableFraction: 12_811_866_112 / 32_859_295_744,
      },
      swap: {
        kind: "value",
        totalBytes: 34_359_730_176,
        usedBytes: 20_546_334_720,
        usedFraction: 20_546_334_720 / 34_359_730_176,
        areas: 2,
      },
      disk: {
        kind: "value",
        totalKiB: 314_660_132,
        usedKiB: 148_893_952,
        availableKiB: 152_949_524,
        usePercent: 50,
      },
      swapActivity: { kind: "value", siKBs: 76, soKBs: 0, waPercent: 0, activelySwapping: true },
      attribution: {
        kind: "value",
        groups: [
          { kind: "vitest", procs: 2, rssKiB: 898_076 },
          { kind: "other", procs: 7, rssKiB: 338_068 },
          { kind: "node", procs: 4, rssKiB: 292_868 },
          { kind: "vite", procs: 6, rssKiB: 134_388 },
          { kind: "chrome", procs: 5, rssKiB: 11_744 },
        ],
      },
      verdict: { level: "strained", reasons: ["actively swapping (si 76, so 0 KB/s)"] },
    });
    expect(execFileSyncMock.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["uptime", []],
      ["nproc", []],
      ["free", ["-b"]],
      ["swapon", ["--show", "--bytes"]],
      ["df", ["-k", "/"]],
      ["vmstat", ["1", "2"]],
      ["ps", ["-eo", "rss,args", "--no-headers"]],
    ]);
    expect(asyncSpecs).toHaveLength(7);
    expect(Object.fromEntries(asyncSpecs.map(({ key, cmd, args }) => [key, [cmd, args]]))).toEqual({
      "health:uptime": ["uptime", []],
      "health:nproc": ["nproc", []],
      "health:free": ["free", ["-b"]],
      "health:vmstat": ["vmstat", ["1", "2"]],
      "health:swapon": ["swapon", ["--show", "--bytes"]],
      "health:df": ["df", ["-k", "/"]],
      "health:ps": ["ps", ["-eo", "rss,args", "--no-headers"]],
    });
  });

  it("makes a refused vmstat visible without preventing the other six readings", async () => {
    const called: string[] = [];
    const owner: ProbeOwner = {
      run: async (spec) => {
        called.push(spec.cmd);
        if (spec.cmd === "vmstat") {
          return {
            kind: "refused",
            why: "the previous vmstat child is still unaccounted for",
            pid: 42_424,
            liveForMs: 12_500,
          };
        }
        return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
      },
      live: () => [{
        key: "health:vmstat",
        pid: 42_424,
        startedAtMs: 37_500,
        signalled: ["SIGTERM", "SIGKILL"],
        exitObserved: false,
      }],
    };

    const report = await collectHealthAsync({ owner, nowMs: () => 50_000 });

    expect(called.sort()).toEqual(["df", "free", "nproc", "ps", "swapon", "uptime", "vmstat"]);
    expect(report.load.kind).toBe("value");
    expect(report.memory.kind).toBe("value");
    expect(report.swap.kind).toBe("value");
    expect(report.disk.kind).toBe("value");
    expect(report.attribution.kind).toBe("value");
    expect(report.swapActivity.kind).toBe("unknown");
    if (report.swapActivity.kind !== "unknown") throw new Error("expected refused vmstat to be unknown");
    expect(report.swapActivity.why).toContain("the previous vmstat child is still unaccounted for");
    expect(report.swapActivity.why).toContain("42424");
    expect(report.swapActivity.why).toContain("12500ms");
  });

  it("makes a timed-out vmstat visible without preventing the other six readings", async () => {
    const called: string[] = [];
    const owner: ProbeOwner = {
      run: async (spec) => {
        called.push(spec.cmd);
        if (spec.cmd === "vmstat") {
          return {
            kind: "timed-out",
            why: 'probe "health:vmstat" reached its 10000ms deadline; child exit has not been observed',
            tookMs: 11_000,
            pid: 42_425,
            exitObserved: false,
          };
        }
        return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
      },
      live: () => [{
        key: "health:vmstat",
        pid: 42_425,
        startedAtMs: 39_000,
        signalled: ["SIGTERM", "SIGKILL"],
        exitObserved: false,
      }],
    };

    const report = await collectHealthAsync({ owner, nowMs: () => 50_000 });

    expect(called.sort()).toEqual(["df", "free", "nproc", "ps", "swapon", "uptime", "vmstat"]);
    expect(report.load.kind).toBe("value");
    expect(report.memory.kind).toBe("value");
    expect(report.swap.kind).toBe("value");
    expect(report.disk.kind).toBe("value");
    expect(report.attribution.kind).toBe("value");
    expect(report.swapActivity.kind).toBe("unknown");
    if (report.swapActivity.kind !== "unknown") throw new Error("expected timed-out vmstat to be unknown");
    expect(report.swapActivity.why).toContain('probe "health:vmstat" reached its 10000ms deadline');
    expect(report.swapActivity.why).toContain("42425");
    expect(report.swapActivity.why).toContain("11000ms");
  });

  it("puts a timed-out probe's pid and live duration into that field's reason", async () => {
    const owner = successfulOwner((spec) =>
      spec.cmd === "free"
        ? {
            kind: "timed-out",
            why: "the free probe reached its deadline",
            tookMs: 5_100,
            pid: 42_525,
            exitObserved: false,
          }
        : { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 },
    );

    const report = await collectHealthAsync({ owner, nowMs: () => 55_000 });

    expect(report.memory.kind).toBe("unknown");
    if (report.memory.kind !== "unknown") throw new Error("expected timed-out free to be unknown");
    expect(report.memory.why).toContain("the free probe reached its deadline");
    expect(report.memory.why).toContain("42525");
    expect(report.memory.why).toContain("5100ms");
  });

  it.each([
    {
      name: "failed",
      outcome: {
        kind: "failed",
        why: "free exited with code 17: allocator unavailable",
        tookMs: 321,
        exitCode: 17,
        signal: null,
      } satisfies OwnedOutcome,
    },
    {
      name: "overflowed",
      outcome: {
        kind: "overflowed",
        why: 'probe "health:free" exceeded its capture cap',
        tookMs: 654,
        capturedBytes: 16 * 1024 * 1024 + 1,
      } satisfies OwnedOutcome,
    },
  ])("keeps a $name probe's words and duration in that field's reason", async ({ outcome }) => {
    const owner = successfulOwner((spec) =>
      spec.cmd === "free"
        ? outcome
        : { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 },
    );

    const report = await collectHealthAsync({ owner, nowMs: () => 55_000 });

    expect(report.memory.kind).toBe("unknown");
    if (report.memory.kind !== "unknown") throw new Error(`expected ${outcome.kind} free to be unknown`);
    expect(report.memory.why).toContain(outcome.why);
    expect(report.memory.why).toContain(`${outcome.tookMs}ms`);
  });

  it("does not claim a timed-out child is still alive when its exit was observed", async () => {
    const owner = successfulOwner((spec) =>
      spec.cmd === "free"
        ? {
            kind: "timed-out",
            why: "the free deadline elapsed; child exit was observed",
            tookMs: 5_100,
            pid: 42_525,
            exitObserved: true,
          }
        : { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 },
    );

    const report = await collectHealthAsync({ owner, nowMs: () => 56_000 });
    if (report.memory.kind !== "unknown") throw new Error("expected timed-out free to be unknown");
    expect(report.memory.why).toContain("42525");
    expect(report.memory.why).toContain("5100ms");
    expect(report.memory.why).not.toContain("was alive");
  });

  it("does not invent pid zero when a timed-out child had no observable pid", async () => {
    const owner = successfulOwner((spec) =>
      spec.cmd === "free"
        ? {
            kind: "timed-out",
            why: "the free deadline elapsed; the child had no pid",
            tookMs: 5_100,
            pid: null,
            exitObserved: false,
          }
        : { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 },
    );

    const report = await collectHealthAsync({ owner, nowMs: () => 57_000 });
    if (report.memory.kind !== "unknown") throw new Error("expected timed-out free to be unknown");
    expect(report.memory.why).toContain("5100ms");
    expect(report.memory.why).toContain("no child pid was observable");
    expect(report.memory.why).not.toContain("pid 0");
  });

  it("skips vmstat by choice without treating that choice as a failure", async () => {
    const called: string[] = [];
    const owner = successfulOwner((spec) => {
      called.push(spec.cmd);
      return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
    });

    const report = await collectHealthAsync({
      owner,
      includeSwapActivity: false,
      nowMs: () => 60_000,
    });

    expect(called).not.toContain("vmstat");
    expect(report.swapActivity).toEqual({ kind: "skipped" });
    expect(report.verdict.reasons.join(" ")).not.toContain("could not measure swap activity");
  });

  it("still excludes vmstat's plausible since-boot first sample after async gathering", async () => {
    const vmstat =
      "procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------\n" +
      " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu\n" +
      "34  0 20608268 6819836 663664 7230244  999 888  5771  3231 19898   13 39  7  1 55  0  0\n" +
      " 1  0 20608268 6819836 663664 7230244    7   6    12    18  100  200  2  1 90  3  0  0\n";
    const owner = successfulOwner((spec) => ({
      kind: "ok",
      stdout: spec.cmd === "vmstat" ? vmstat : commandOutput(spec.cmd),
      stderr: "",
      tookMs: 1,
    }));

    const report = await collectHealthAsync({ owner, nowMs: () => 70_000 });

    expect(report.swapActivity).toEqual({
      kind: "value",
      siKBs: 7,
      soKBs: 6,
      waPercent: 3,
      activelySwapping: true,
    });
  });

  it("leaves cached state rendering open while a fake 30-second vmstat is pending", async () => {
    let finishVmstat: (outcome: OwnedOutcome) => void = () => {};
    const vmstatPending = new Promise<OwnedOutcome>((resolve) => {
      finishVmstat = resolve;
    });
    const owner = successfulOwner();
    // `successfulOwner` is deliberately immediate for most tests. Override
    // this one method so vmstat models a child that has not answered yet.
    owner.run = async (spec) =>
      spec.cmd === "vmstat"
        ? vmstatPending
        : { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };

    let collectionSettled = false;
    const collection = collectHealthAsync({ owner, nowMs: () => 75_000 }).then((report) => {
      collectionSettled = true;
      return report;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(collectionSettled).toBe(false);

    const cached = withoutClocks(await collectHealthAsync({
      owner: successfulOwner(),
      includeSwapActivity: false,
      nowMs: () => 75_000,
    }));
    const payload = JSON.parse(statePayload({
      snapshot: null,
      error: "the new turn is still measuring",
      health: { ...cached, collectedAt: "2026-09-10T07:00:00.000Z", tookMs: 125 },
      refreshMs: 60_000,
      answeringEnabled: true,
      attemptedAt: null,
      producer: { instance: "1a2b3c4d", publication: 1, inventory: null },
      readCheckpoint: () => ({
        attention: { kind: "checkpoint-absent" },
        overseer: { kind: "checkpoint-absent" },
        usage: { kind: "checkpoint-absent" },
        /* Required since plan 260910c: a composition that forgets the
           per-account feed is a compile error, not a page with no sections. */
        accountUsage: { kind: "checkpoint-absent" },
        work: { kind: "checkpoint-absent" },
      }),
    })) as { health: HealthReport | null };
    expect(payload.health?.collectedAt).toBe("2026-09-10T07:00:00.000Z");
    expect(collectionSettled).toBe(false);

    finishVmstat({
      kind: "timed-out",
      why: 'probe "health:vmstat" reached its 10000ms deadline; child exit was observed',
      tookMs: 11_000,
      pid: 42_626,
      exitObserved: true,
    });
    await collection;
  });

  it("runs no more than three cheap commands at once while still taking all seven readings", async () => {
    let cheapInFlight = 0;
    let mostCheapInFlight = 0;
    let totalInFlight = 0;
    let mostTotalInFlight = 0;
    const called: string[] = [];
    const specs: ProbeSpec[] = [];
    const owner: ProbeOwner = {
      run: async (spec) => {
        called.push(spec.cmd);
        specs.push(spec);
        totalInFlight += 1;
        mostTotalInFlight = Math.max(mostTotalInFlight, totalInFlight);
        if (spec.cmd !== "vmstat") {
          cheapInFlight += 1;
          mostCheapInFlight = Math.max(mostCheapInFlight, cheapInFlight);
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (spec.cmd !== "vmstat") cheapInFlight -= 1;
        totalInFlight -= 1;
        return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
      },
      live: () => [],
    };

    const report = await collectHealthAsync({ owner, nowMs: () => 80_000 });

    expect(mostCheapInFlight).toBe(3);
    expect(mostTotalInFlight).toBe(4);
    expect(called.sort()).toEqual(["df", "free", "nproc", "ps", "swapon", "uptime", "vmstat"]);
    expect(new Set(specs.map((spec) => spec.key)).size).toBe(7);
    const vmstatTimeout = specs.find((spec) => spec.cmd === "vmstat")?.timeoutMs;
    const cheapTimeouts = specs.filter((spec) => spec.cmd !== "vmstat").map((spec) => spec.timeoutMs);
    expect(vmstatTimeout).toBe(10_000);
    expect(new Set(cheapTimeouts)).toEqual(new Set([5_000]));
    expect([
      report.load.kind,
      report.memory.kind,
      report.swap.kind,
      report.disk.kind,
      report.swapActivity.kind,
      report.attribution.kind,
    ]).toEqual(["value", "value", "value", "value", "value", "value"]);
  });

  it("never starts a fifth health child beneath timed-out survivors", async () => {
    const liveChildren: Array<ReturnType<ProbeOwner["live"]>[number]> = [];
    const started: ProbeSpec[] = [];
    let nextPid = 50_000;
    let mostLive = 0;
    const owner: ProbeOwner = {
      run: async (spec) => {
        const pid = nextPid++;
        started.push(spec);
        liveChildren.push({
          key: spec.key,
          pid,
          startedAtMs: 1_000,
          signalled: ["SIGTERM", "SIGKILL"],
          exitObserved: false,
        });
        mostLive = Math.max(mostLive, liveChildren.length);
        return {
          kind: "timed-out",
          why: `probe "${spec.key}" reached its deadline; child exit has not been observed`,
          tookMs: spec.timeoutMs + 1_000,
          pid,
          exitObserved: false,
        };
      },
      live: () => liveChildren,
    };

    const report = await collectHealthAsync({ owner, nowMs: () => 90_000 });

    expect(mostLive).toBe(4);
    expect(started).toHaveLength(4);
    expect([
      report.load.kind,
      report.memory.kind,
      report.swap.kind,
      report.disk.kind,
      report.swapActivity.kind,
      report.attribution.kind,
    ]).toEqual(["unknown", "unknown", "unknown", "unknown", "unknown", "unknown"]);
  });

  it("still asks the owner to reap a same-key child when the health cap is full", async () => {
    const liveChildren: Array<ReturnType<ProbeOwner["live"]>[number]> = [
      "health:vmstat",
      "health:uptime",
      "health:nproc",
      "health:free",
    ].map((key, index) => ({
      key,
      pid: 60_000 + index,
      startedAtMs: 1_000,
      signalled: ["SIGTERM", "SIGKILL"],
      exitObserved: false,
    }));
    const checked: string[] = [];
    const owner: ProbeOwner = {
      run: async (spec) => {
        checked.push(spec.key);
        const old = liveChildren.findIndex((child) => child.key === spec.key);
        if (old !== -1) liveChildren.splice(old, 1);
        return { kind: "ok", stdout: commandOutput(spec.cmd), stderr: "", tookMs: 1 };
      },
      live: () => liveChildren,
    };

    const report = await collectHealthAsync({ owner, nowMs: () => 95_000 });

    expect(checked).toEqual(expect.arrayContaining([
      "health:vmstat",
      "health:uptime",
      "health:nproc",
      "health:free",
    ]));
    expect(report.swapActivity.kind).toBe("value");
    expect(report.load.kind).toBe("value");
    expect(report.memory.kind).toBe("value");
  });
});

describe("parseLoad", () => {
  it("reads the real box's load average against its real core count", () => {
    const cores = parseNproc(fx("nproc-real.txt"));
    expect(cores).toBe(16);
    const r = parseLoad(fx("uptime-real.txt"), cores as number);
    expect(r).toEqual({ kind: "value", load1: 14.32, load5: 25.29, load15: 66.78, cores: 16, ratio1: 14.32 / 16 });
  });

  it("says unknown, not a zero, when uptime's output has no load average section", () => {
    const r = parseLoad(fx("uptime-malformed.txt"), 16);
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("load average");
  });

  it("says unknown when nproc did not parse, rather than dividing by a guess", () => {
    const cores = parseNproc(fx("nproc-malformed.txt"));
    expect(cores).toBeNull();
  });

  it("reads the fabricated incident-shaped load: 391 on 16 cores", () => {
    const r = parseLoad(fx("uptime-critical.txt"), 16);
    expect(r).toMatchObject({ kind: "value", load1: 391.02, cores: 16 });
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.ratio1).toBeGreaterThan(24); // roughly the 2026-09-08 incident's own ratio
  });
});

describe("parseMemory", () => {
  it("reads `available`, not `free`, from the real box", () => {
    const r = parseMemory(fx("free-b-real.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    // The real capture: free was 5472649216, available was 12811866112 —
    // available is the bigger number, which is the whole point of reading it
    // instead of free (idle RAM spent on cache, handed back on demand).
    // BYTES, and the field name now says so. It said `availableKiB` until
    // 2026-09-08, and this test passed the whole time — it asserted the number
    // against the wrong name, so the name could not be wrong. The page drew
    // "10298 GiB of 31337 GiB" and a browser found it.
    expect(r.availableBytes).toBe(12811866112);
    expect(r.availableBytes).toBeGreaterThan(5472649216);
    // The unit, pinned as a magnitude: this box has ~32 GB, so `totalBytes`
    // is tens of billions. A field that ever holds KiB would be ~32 million,
    // which is what this bound catches and what the name alone did not.
    expect(r.totalBytes).toBeGreaterThan(1e10);
    expect(r.availableFraction).toBeCloseTo(12811866112 / 32859295744, 6);
  });

  it("says unknown when the available column is missing rather than reading a wrong one", () => {
    const r = parseMemory(fx("free-b-malformed.txt"));
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("6 numeric columns");
  });

  it("reads the fabricated near-zero-available case", () => {
    const r = parseMemory(fx("free-b-critical.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.availableFraction).toBeLessThan(0.01);
  });

  it("says unknown when free fails outright (empty output)", () => {
    const r = parseMemory("");
    expect(r.kind).toBe("unknown");
  });
});

describe("parseSwap", () => {
  it("reads two swap areas from the real box and sums them", () => {
    const r = parseSwap(fx("swapon-bytes-real.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.areas).toBe(2);
    expect(r.totalBytes).toBe(17179865088 * 2);
    expect(r.usedBytes).toBe(12383318016 + 8163016704);
    expect(r.usedFraction).toBeCloseTo((12383318016 + 8163016704) / (17179865088 * 2), 6);
  });

  it("reports `none`, not `unknown`, when no swap is configured — that is a real answer", () => {
    const r = parseSwap(fx("swapon-bytes-none.txt"));
    expect(r).toEqual({ kind: "none" });
  });

  it("says unknown when a SIZE/USED column is not numeric", () => {
    const r = parseSwap("NAME       TYPE        SIZE        USED PRIO\n/swapfile  file not-a-number also-bad   -2\n");
    expect(r.kind).toBe("unknown");
  });

  it("reads the fabricated at-the-cliff case: swap ~99.9% full", () => {
    const r = parseSwap(fx("swapon-bytes-critical.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.usedFraction).toBeGreaterThan(0.98);
  });
});

describe("parseDisk", () => {
  it("reads the real box's / usage", () => {
    const r = parseDisk(fx("df-k-real.txt"));
    expect(r).toEqual({ kind: "value", totalKiB: 314660132, usedKiB: 148893952, availableKiB: 152949524, usePercent: 50 });
  });

  it("says unknown when df has no data line", () => {
    const r = parseDisk(fx("df-k-malformed.txt"));
    expect(r.kind).toBe("unknown");
  });

  it("reads the fabricated near-full case", () => {
    const r = parseDisk(fx("df-k-critical.txt"));
    expect(r).toMatchObject({ kind: "value", usePercent: 98 });
  });
});

describe("parseSwapActivity", () => {
  it("reads the real box's last vmstat sample, discarding the since-boot first line", () => {
    const r = parseSwapActivity(fx("vmstat-1-3-real.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    // The captured file's 3rd (last) data line: si=76 so=0 wa=0.
    expect(r.siKBs).toBe(76);
    expect(r.soKBs).toBe(0);
    expect(r.waPercent).toBe(0);
    expect(r.activelySwapping).toBe(true); // si=76 > 0, even though so=0
  });

  it("says unknown rather than reading the since-boot average when there is only one data line", () => {
    // `vmstat 1 1` — a caller passing the wrong count. Using the only line
    // present would silently report the since-boot average as "now".
    const r = parseSwapActivity(
      "procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------\n" +
        " r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu\n" +
        "34  0 20608268 6819836 663664 7230244  493 1006  5771  3231 19898   13 39  7 53  0  0  0\n",
    );
    expect(r.kind).toBe("unknown");
    if (r.kind !== "unknown") throw new Error("unreachable");
    expect(r.why).toContain("since-boot");
  });

  it("says unknown when vmstat produced only its headers", () => {
    const r = parseSwapActivity(fx("vmstat-malformed.txt"));
    expect(r.kind).toBe("unknown");
  });

  it("reads the fabricated thrashing case: heavy si/so and high wa", () => {
    const r = parseSwapActivity(fx("vmstat-1-3-critical.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    expect(r.activelySwapping).toBe(true);
    expect(r.waPercent).toBeGreaterThanOrEqual(50);
  });
});

describe("parseAttribution", () => {
  it("groups the real mixed capture into vitest/vite/chrome/node/other", () => {
    const r = parseAttribution(fx("ps-rss-args-mixed-real.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    const byKind = Object.fromEntries(r.groups.map((g) => [g.kind, g]));
    expect(byKind.vitest?.procs).toBe(2); // "sh -c vitest run" + the node .bin/vitest line
    expect(byKind.vite?.procs).toBe(6); // 3 "sh -c vite..." + 3 node .bin/vite lines
    expect(byKind.node?.procs).toBe(4); // dist/start/server.js, dist/server/server.js, tools/fleet/server.ts, scripts/run-codex.ts
    // Groups are sorted biggest-rss-first — the whole point of grouping over a process list.
    expect(r.groups[0]?.rssKiB).toBe(Math.max(...r.groups.map((g) => g.rssKiB)));
  });

  it("documents the inherited trap: an MCP server with `--browser chrome` in its args lands in `chrome`", () => {
    // This is the doc's `pgrep -f chrome` overcount, inherited on purpose —
    // see the long comment on parseAttribution. Pinning it here means a
    // change that accidentally "fixes" it (and quietly starts hiding real
    // chrome usage inside `other`) goes red instead of unnoticed.
    const r = parseAttribution(fx("ps-rss-args-mixed-real.txt"));
    if (r.kind !== "value") throw new Error("unreachable");
    const chrome = r.groups.find((g) => g.kind === "chrome");
    expect(chrome).toBeDefined();
    // 3 lines literally running a chrome binary/mcp package + 2 more whose
    // args merely mention --browser chrome.
    expect(chrome?.procs).toBe(5);
  });

  it("skips an unparseable line rather than discarding the whole reading", () => {
    const r = parseAttribution(fx("ps-rss-args-malformed.txt"));
    expect(r.kind).toBe("value");
    if (r.kind !== "value") throw new Error("unreachable");
    // Only the second line ("   12345", no args) had a numeric rss.
    expect(r.groups).toEqual([{ kind: "other", procs: 1, rssKiB: 12345 }]);
  });

  it("says unknown when no line has a numeric rss column at all", () => {
    const r = parseAttribution(fx("ps-rss-args-fully-garbage.txt"));
    expect(r.kind).toBe("unknown");
  });

  it("says unknown for empty output rather than an empty group list", () => {
    // An empty `groups: []` would render as "nothing is using memory", which
    // is never true — it means the command produced nothing to attribute.
    const r = parseAttribution("");
    expect(r.kind).toBe("unknown");
  });
});

describe("computeVerdict", () => {
  // Every case below starts from this and overrides one reading, so a case
  // reads as "everything is fine except X" rather than restating five fields.
  const healthy: Parameters<typeof computeVerdict>[0] = {
    load: { kind: "value", load1: 2, load5: 2, load15: 2, cores: 16, ratio1: 2 / 16 },
    memory: { kind: "value", totalBytes: 100, availableBytes: 60, availableFraction: 0.6 },
    swap: { kind: "value", totalBytes: 100, usedBytes:10, usedFraction: 0.1, areas: 1 },
    disk: { kind: "value", totalKiB: 100, usedKiB: 40, availableKiB: 60, usePercent: 40 },
    swapActivity: { kind: "value", siKBs: 0, soKBs: 0, waPercent: 1, activelySwapping: false },
  };

  it("says ok with a positive reason when every reading is fine", () => {
    const v = computeVerdict(healthy);
    expect(v.level).toBe("ok");
    expect(v.reasons).toEqual(["load, memory and swap all look fine"]);
  });

  it("says critical when swap is at the cliff, even though nothing else is bad", () => {
    const v = computeVerdict({
      ...healthy,
      swap: { kind: "value", totalBytes: 100, usedBytes:99, usedFraction: 0.99, areas: 1 },
    });
    expect(v.level).toBe("critical");
    expect(v.reasons.some((r) => r.includes("cliff"))).toBe(true);
  });

  it("does not raise the level on swap fill alone below the cliff — some swap used is normal", () => {
    const v = computeVerdict({
      ...healthy,
      swap: { kind: "value", totalBytes: 100, usedBytes:50, usedFraction: 0.5, areas: 1 },
    });
    expect(v.level).toBe("ok");
  });

  it("reads the fabricated incident shape (391 load, near-zero available, swap ~99.9% full) as critical", () => {
    const v = computeVerdict({
      load: parseLoadFixture(),
      memory: parseMemoryFixture(),
      swap: parseSwapFixture(),
      disk: { kind: "value", totalKiB: 100, usedKiB: 40, availableKiB: 60, usePercent: 40 },
      swapActivity: { kind: "skipped" },
    });
    expect(v.level).toBe("critical");
    expect(v.reasons.length).toBeGreaterThanOrEqual(2); // load AND memory AND swap each contributed
  });

  it("says unknown, never ok, when load, memory and swap could all not be measured", () => {
    const v = computeVerdict({
      load: { kind: "unknown", why: "uptime failed: not found" },
      memory: { kind: "unknown", why: "free failed: not found" },
      swap: { kind: "unknown", why: "swapon failed: not found" },
      disk: { kind: "unknown", why: "df failed: not found" },
      swapActivity: { kind: "unknown", why: "vmstat failed: not found" },
    });
    expect(v.level).toBe("unknown");
    expect(v.level).not.toBe("ok");
    expect(v.reasons[0]).toContain("not the same as the box being fine");
  });

  it("does not let `unknown` erase a critical it managed to measure — Sol's F12", () => {
    // The disk comes from `df`, a different command from the three that make up
    // the core reading, so it can succeed while all of them fail. This line used
    // to relabel a KNOWN-CRITICAL disk as `unknown` — and the new-session route
    // then read `unknown` as "no reason not to start another agent".
    //
    // The asymmetry is the point: `unknown` is what we say when we found
    // nothing, not a value that outranks something we found. Uncertainty may
    // add doubt; it may never subtract a bad reading.
    const v = computeVerdict({
      load: { kind: "unknown", why: "uptime failed" },
      memory: { kind: "unknown", why: "free failed" },
      swap: { kind: "unknown", why: "swapon failed" },
      disk: { kind: "value", totalKiB: 100, usedKiB: 99, availableKiB: 1, usePercent: 99 },
      swapActivity: { kind: "unknown", why: "vmstat failed" },
    });
    expect(v.level).toBe("critical");
    // And the doubt is still reported rather than swallowed by the critical —
    // both facts are true and the person needs both.
    expect(v.reasons[0]).toContain("not the same as the box being fine");
    expect(v.reasons.some((r) => r.includes("99% full"))).toBe(true);
  });

  it("stays readable from partial data: one core reading known is enough to avoid `unknown`", () => {
    const v = computeVerdict({
      load: { kind: "unknown", why: "uptime failed" },
      memory: { kind: "value", totalBytes: 100, availableBytes: 60, availableFraction: 0.6 },
      swap: { kind: "unknown", why: "swapon failed" },
      disk: { kind: "value", totalKiB: 100, usedKiB: 40, availableKiB: 60, usePercent: 40 },
      swapActivity: { kind: "skipped" },
    });
    expect(v.level).toBe("ok");
    expect(v.reasons.some((r) => r.includes("could not measure load"))).toBe(true);
  });

  it("raises to critical on thrashing (actively swapping + high wa) even with everything else fine", () => {
    const v = computeVerdict({
      ...healthy,
      swapActivity: { kind: "value", siKBs: 5000, soKBs: 6000, waPercent: 65, activelySwapping: true },
    });
    expect(v.level).toBe("critical");
    expect(v.reasons.some((r) => r.includes("thrashing"))).toBe(true);
  });
});

function parseLoadFixture() {
  const r = parseLoad(fx("uptime-critical.txt"), 16);
  if (r.kind !== "value") throw new Error("fixture did not parse");
  return r;
}
function parseMemoryFixture() {
  const r = parseMemory(fx("free-b-critical.txt"));
  if (r.kind !== "value") throw new Error("fixture did not parse");
  return r;
}
function parseSwapFixture() {
  const r = parseSwap(fx("swapon-bytes-critical.txt"));
  if (r.kind !== "value") throw new Error("fixture did not parse");
  return r;
}
