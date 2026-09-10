import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_RETAINED_REFUSALS,
  pruneRefusals,
  readRefusals,
  recordRefusal,
} from "../admission-journal.js";
import { ADMISSION_POLICY_VERSION } from "../vitest-admission.js";
import { decideTick, type TickDecision, type TickInput } from "../tools/fleet/readiness-loop.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
const GB = 1024 ** 3;
const FINAL_NAME = /^refusal-.*\.json$/;

const input = {
  source: "test-run" as const,
  policyVersion: 1,
  snapshot: {
    kind: "linux" as const,
    availableBytes: 10_000_000,
    swapTotalBytes: 20_000_000,
    swapFreeBytes: 5_000_000,
  },
  reserveBytes: 4_000_000,
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function childWrite(dir: string, count: number): Promise<void> {
  const script = `
    import { recordRefusal } from ${JSON.stringify(join(REPO, "admission-journal.ts"))};
    for (let index = 0; index < ${count}; index += 1) {
      const wrote = recordRefusal({
        source: "test-run",
        policyVersion: 1,
        snapshot: {
          kind: "linux",
          availableBytes: 10_000_000 + index,
          swapTotalBytes: 20_000_000,
          swapFreeBytes: 5_000_000,
        },
        reserveBytes: 4_000_000,
      }, { dir: ${JSON.stringify(dir)} });
      if (!wrote) process.exit(2);
    }
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`journal child exited ${code}: ${stderr}`));
    });
  });
}

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runChild(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function finalNames(dir: string): string[] {
  return readdirSync(dir).filter((name) => FINAL_NAME.test(name)).sort();
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function pausedCollisionWriter(
  dir: string,
  policyVersion: number,
  ready: string,
  release: string,
  result: string,
): { closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; stderr: () => string } {
  const script = `
    import crypto from "node:crypto";
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const original = {
      existsSync: fs.existsSync.bind(fs),
      renameSync: fs.renameSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
    };
    crypto.randomBytes = (size) => Buffer.alloc(size, 0xcd);
    fs.renameSync = (from, to) => {
      if (String(from).includes("/.tmp-")) {
        original.writeFileSync(${JSON.stringify(ready)}, "ready");
        const wait = new Int32Array(new SharedArrayBuffer(4));
        while (!original.existsSync(${JSON.stringify(release)})) Atomics.wait(wait, 0, 0, 10);
      }
      original.renameSync(from, to);
    };
    syncBuiltinESMExports();
    const { recordRefusal } = await import(${JSON.stringify(join(REPO, "admission-journal.ts"))});
    const wrote = recordRefusal({ ...${JSON.stringify(input)}, policyVersion: ${policyVersion} }, {
      dir: ${JSON.stringify(dir)}, pid: 404, now: () => new Date("2026-09-10T05:45:00.000Z"),
    });
    original.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ wrote }));
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childStderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { childStderr += chunk; });
  return {
    closed: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    }),
    stderr: () => childStderr,
  };
}

describe("the admission refusal journal", () => {
  it.runIf(process.platform === "linux" && existsSync("/usr/bin/prlimit"))(
    "a partial write cannot expose a fragment or hide the next successful record",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "admission-journal-partial-"));
      dirs.push(dir);
      const limitedAt = "2026-09-10T00:00:00.000Z";
      const childScript = `
      process.on("SIGXFSZ", () => {});
      const { recordRefusal } = await import(${JSON.stringify(join(REPO, "admission-journal.ts"))});
      const wrote = recordRefusal(${JSON.stringify(input)}, {
        dir: ${JSON.stringify(dir)},
        host: "size-limited-child",
        now: () => new Date(${JSON.stringify(limitedAt)}),
      });
      process.exitCode = wrote ? 42 : 0;
    `;
      const child = await runChild("/usr/bin/prlimit", [
        "--fsize=60:60",
        "--",
        process.execPath,
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        childScript,
      ]);
      expect(child, child.stderr).toMatchObject({ code: 0, signal: null });

      const visibleAt = "2026-09-10T00:00:01.000Z";
      expect(recordRefusal(input, {
        dir,
        host: "unrestricted-parent",
        now: () => new Date(visibleAt),
      })).toBe(true);
      const result = readRefusals({ dir });
      expect(result).toMatchObject({ kind: "read", unparseableLines: 0 });
      expect(result.kind === "read" ? result.entries.map((entry) => entry.at) : []).toEqual([visibleAt]);
    },
  );

  it("a writer paused across two prunes is visible when it reports success", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-paused-writer-"));
    dirs.push(dir);
    const ready = join(dir, "child-ready");
    const release = join(dir, "child-release");
    const childResult = join(dir, "child-result");
    const pausedAt = "2026-09-10T03:00:00.000Z";

    expect(recordRefusal(input, { dir, now: () => new Date("2026-09-10T01:00:00.000Z") })).toBe(true);
    const childScript = `
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const original = {
        appendFileSync: fs.appendFileSync.bind(fs),
        closeSync: fs.closeSync.bind(fs),
        existsSync: fs.existsSync.bind(fs),
        openSync: fs.openSync.bind(fs),
        renameSync: fs.renameSync.bind(fs),
        writeFileSync: fs.writeFileSync.bind(fs),
      };
      const pause = () => {
        original.writeFileSync(${JSON.stringify(ready)}, "ready");
        const wait = new Int32Array(new SharedArrayBuffer(4));
        while (!original.existsSync(${JSON.stringify(release)})) Atomics.wait(wait, 0, 0, 10);
      };
      fs.appendFileSync = (path, data, options) => {
        const fd = original.openSync(path, "a", 0o600);
        pause();
        try { original.writeFileSync(fd, data, options); }
        finally { original.closeSync(fd); }
      };
      fs.renameSync = (from, to) => {
        if (String(from).includes("/.tmp-")) pause();
        original.renameSync(from, to);
      };
      syncBuiltinESMExports();
      const { recordRefusal } = await import(${JSON.stringify(join(REPO, "admission-journal.ts"))});
      const wrote = recordRefusal(${JSON.stringify(input)}, {
        dir: ${JSON.stringify(dir)},
        host: "paused-writer",
        now: () => new Date(${JSON.stringify(pausedAt)}),
      });
      original.writeFileSync(${JSON.stringify(childResult)}, JSON.stringify({ wrote }));
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", childScript], {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const childClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let firstPrune = false;
    let middleWrite = false;
    let secondPrune = false;
    try {
      await waitForFile(ready);
      /* Both keys deliberately make this same source exercise the old byte
         rotation and the replacement count-prune implementation. */
      const tinyCap = { maxFileBytes: 1, maxRecords: 0 } as Parameters<typeof pruneRefusals>[0];
      firstPrune = pruneRefusals({ dir, ...tinyCap });
      middleWrite = recordRefusal(input, { dir, now: () => new Date("2026-09-10T02:00:00.000Z") });
      secondPrune = pruneRefusals({ dir, ...tinyCap });
    } finally {
      writeFileSync(release, "release");
    }
    const closed = await childClosed;
    expect(firstPrune).toBe(true);
    expect(middleWrite).toBe(true);
    expect(secondPrune).toBe(true);
    expect(closed, stderr).toEqual({ code: 0, signal: null });
    const wrote = (JSON.parse(readFileSync(childResult, "utf8")) as { wrote: boolean }).wrote;
    const read = readRefusals({ dir });
    const visible = read.kind === "read" && read.entries.some((entry) => entry.at === pausedAt);
    expect(wrote && !visible, "recordRefusal returned true but its record was absent").toBe(false);
    expect(wrote).toBe(true);
  });

  it("loses no records when separate processes write concurrently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-concurrent-"));
    dirs.push(dir);

    const childCount = 4;
    const linesPerChild = 40;
    await Promise.all(Array.from({ length: childCount }, () => childWrite(dir, linesPerChild)));

    const result = readRefusals({ dir });
    expect(result).toMatchObject({ kind: "read", unparseableLines: 0 });
    expect(result.kind === "read" ? result.entries : []).toHaveLength(childCount * linesPerChild);
  });

  it("refuses an oversized record without disturbing existing record files", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-bounded-"));
    dirs.push(dir);
    expect(recordRefusal(input, { dir, host: "box" })).toBe(true);
    const before = finalNames(dir);
    expect(recordRefusal(input, { dir, host: "x".repeat(2_000) })).toBe(false);
    const after = finalNames(dir);

    expect(after).toEqual(before);
    expect(() => JSON.parse(readFileSync(join(dir, after[0] as string), "utf8"))).not.toThrow();
    expect(readRefusals({ dir })).toMatchObject({ kind: "read", unparseableLines: 0 });
  });

  it("refuses serialisable values that its own reader would reject", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-invalid-values-"));
    dirs.push(dir);
    expect(recordRefusal(input, { dir, host: "box" })).toBe(true);
    const before = finalNames(dir);
    expect(
      recordRefusal({ ...input, policyVersion: Number.POSITIVE_INFINITY }, { dir, host: "box" }),
    ).toBe(false);
    expect(
      recordRefusal(
        { ...input, snapshot: { ...input.snapshot, availableBytes: -1 } },
        { dir, host: "box" },
      ),
    ).toBe(false);
    expect(recordRefusal(input, { dir, host: "   " })).toBe(false);

    expect(finalNames(dir)).toEqual(before);
    expect(readRefusals({ dir })).toMatchObject({
      kind: "read",
      entries: [expect.any(Object)],
      unparseableLines: 0,
    });
  });

  it("swallows a write failure without replacing the caller's refusal", () => {
    const parent = mkdtempSync(join(tmpdir(), "admission-journal-unwritable-"));
    dirs.push(parent);
    const blockingFile = join(parent, "not-a-directory");
    writeFileSync(blockingFile, "blocks mkdir");
    const input = {
      source: "test-run" as const,
      policyVersion: 1,
      snapshot: { kind: "broken" as const, why: "fixture" },
      reserveBytes: 4_000_000,
    };

    expect(() => recordRefusal(input, { dir: join(blockingFile, "journal") })).not.toThrow();
    expect(recordRefusal(input, { dir: join(blockingFile, "journal") })).toBe(false);

    const gateRefusal = new Error("the gate's original refusal");
    const configShapedCaller = (): never => {
      recordRefusal(input, { dir: join(blockingFile, "journal") });
      throw gateRefusal;
    };
    expect(configShapedCaller).toThrow(gateRefusal);
  });

  it("pruning keeps the newest records and cannot lose a write interleaved with deletion", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-prune-"));
    dirs.push(dir);
    const instants = ["01", "02", "03", "04"].map((hour) => `2026-09-10T${hour}:00:00.000Z`);
    for (const at of instants.slice(0, 3)) {
      expect(recordRefusal(input, { dir, now: () => new Date(at) })).toBe(true);
    }
    /* mtime points in the opposite direction. Filename order, not copy- or
       clock-sensitive metadata, still decides which records are oldest. */
    for (const [index, name] of finalNames(dir).entries()) {
      const reversed = new Date(Date.parse("2026-09-11T00:00:00.000Z") - index * 1_000);
      utimesSync(join(dir, name), reversed, reversed);
    }
    let interleaved = false;
    expect(pruneRefusals({
      dir,
      maxRecords: 2,
      unlinkFile: (path) => {
        if (!interleaved) {
          interleaved = true;
          expect(recordRefusal(input, { dir, now: () => new Date(instants[3] as string) })).toBe(true);
        }
        unlinkSync(path);
      },
    })).toBe(true);

    const result = readRefusals({ dir, maxRecords: 3 });
    expect(result.kind === "read" ? result.entries.map((entry) => entry.at) : []).toEqual(instants.slice(1));
    expect(finalNames(dir)).toHaveLength(3);
  });

  it("ignores temporary files, does not count them as unparseable, and removes stale ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-temporary-"));
    dirs.push(dir);
    const stale = join(dir, ".tmp-101-stale");
    const fresh = join(dir, ".tmp-101-fresh");
    writeFileSync(stale, "{partial");
    writeFileSync(fresh, "{partial");
    const nowMs = Date.parse("2026-09-10T04:00:00.000Z");
    utimesSync(stale, new Date(nowMs - 2 * 60 * 60 * 1_000), new Date(nowMs - 2 * 60 * 60 * 1_000));
    utimesSync(fresh, new Date(nowMs - 30 * 60 * 1_000), new Date(nowMs - 30 * 60 * 1_000));

    expect(readRefusals({ dir, nowMs })).toEqual({ kind: "read", entries: [], unparseableLines: 0 });
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  it("counts unparseable record files while retaining the readable entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-unparseable-"));
    dirs.push(dir);
    for (const at of ["01", "02", "03"].map((hour) => `2026-09-10T${hour}:00:00.000Z`)) {
      expect(recordRefusal(input, { dir, now: () => new Date(at) })).toBe(true);
    }
    for (const name of finalNames(dir).slice(0, 2)) writeFileSync(join(dir, name), "{not json}", "utf8");

    const result = readRefusals({ dir });
    expect(result).toMatchObject({ kind: "read", unparseableLines: 2 });
    expect(result.kind === "read" ? result.entries : []).toHaveLength(1);
  });

  it("does not collide when different pids write in the same millisecond", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-same-millisecond-"));
    dirs.push(dir);
    const now = () => new Date("2026-09-10T05:00:00.000Z");
    expect(recordRefusal(input, { dir, now, pid: 101 })).toBe(true);
    expect(recordRefusal(input, { dir, now, pid: 202 })).toBe(true);

    expect(finalNames(dir)).toHaveLength(2);
    const result = readRefusals({ dir });
    expect(result.kind === "read" ? result.entries.map((entry) => entry.pid).sort() : []).toEqual([101, 202]);
  });

  it("reports failure rather than overwriting a record when every name component collides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-forced-collision-"));
    dirs.push(dir);
    const childResult = join(dir, "collision-result");
    const childScript = `
      import crypto from "node:crypto";
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const originalWrite = fs.writeFileSync.bind(fs);
      crypto.randomBytes = (size) => Buffer.alloc(size, 0xab);
      syncBuiltinESMExports();
      const { recordRefusal } = await import(${JSON.stringify(join(REPO, "admission-journal.ts"))});
      const first = recordRefusal(${JSON.stringify(input)}, {
        dir: ${JSON.stringify(dir)}, pid: 303, now: () => new Date("2026-09-10T05:30:00.000Z"),
      });
      const second = recordRefusal({ ...${JSON.stringify(input)}, policyVersion: 2 }, {
        dir: ${JSON.stringify(dir)}, pid: 303, now: () => new Date("2026-09-10T05:30:00.000Z"),
      });
      originalWrite(${JSON.stringify(childResult)}, JSON.stringify({ first, second }));
    `;
    const child = await runChild(process.execPath, [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      childScript,
    ]);
    expect(child, child.stderr).toMatchObject({ code: 0, signal: null });
    const writes = JSON.parse(readFileSync(childResult, "utf8")) as { first: boolean; second: boolean };
    expect(writes).toEqual({ first: true, second: false });
    const read = readRefusals({ dir });
    expect(read.kind === "read" ? read.entries.map((entry) => entry.policyVersion) : []).toEqual([1]);
  });

  it("cannot claim a colliding temp pathname that stale cleanup let another writer reuse", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-stale-collision-"));
    dirs.push(dir);
    const paths = (label: string) => ({
      ready: join(dir, `${label}-ready`),
      release: join(dir, `${label}-release`),
      result: join(dir, `${label}-result`),
    });
    const a = paths("a");
    const b = paths("b");
    const writerA = pausedCollisionWriter(dir, 11, a.ready, a.release, a.result);
    let writerB: ReturnType<typeof pausedCollisionWriter> | null = null;
    try {
      await waitForFile(a.ready);
      expect(readRefusals({ dir, nowMs: Date.now() + 2 * 60 * 60 * 1_000 })).toEqual({
        kind: "read",
        entries: [],
        unparseableLines: 0,
      });
      writerB = pausedCollisionWriter(dir, 22, b.ready, b.release, b.result);
      await waitForFile(b.ready);
      writeFileSync(a.release, "release a");
      expect(await writerA.closed, writerA.stderr()).toEqual({ code: 0, signal: null });
    } finally {
      writeFileSync(a.release, "release a");
      writeFileSync(b.release, "release b");
    }
    expect(writerB).not.toBeNull();
    if (writerB === null) return;
    expect(await writerB.closed, writerB.stderr()).toEqual({ code: 0, signal: null });

    const aWrote = (JSON.parse(readFileSync(a.result, "utf8")) as { wrote: boolean }).wrote;
    const bWrote = (JSON.parse(readFileSync(b.result, "utf8")) as { wrote: boolean }).wrote;
    const read = readRefusals({ dir });
    const policies = read.kind === "read" ? new Set(read.entries.map((entry) => entry.policyVersion)) : new Set();
    expect(aWrote && !policies.has(11), "writer A reported success for writer B's inode").toBe(false);
    expect(bWrote && !policies.has(22), "writer B reported success without its record").toBe(false);
  });

  it("retains and reads no more than the count cap", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-count-cap-"));
    dirs.push(dir);
    for (let index = 0; index < MAX_RETAINED_REFUSALS + 25; index += 1) {
      expect(recordRefusal(input, {
        dir,
        now: () => new Date(Date.parse("2026-09-10T06:00:00.000Z") + index),
      })).toBe(true);
    }
    let filesRead = 0;
    const result = readRefusals({
      dir,
      readFile: (path) => {
        filesRead += 1;
        return readFileSync(path, "utf8");
      },
    });

    expect(result.kind === "read" ? result.entries : []).toHaveLength(MAX_RETAINED_REFUSALS);
    expect(finalNames(dir)).toHaveLength(MAX_RETAINED_REFUSALS);
    expect(filesRead).toBe(MAX_RETAINED_REFUSALS);
  });

  it("keeps an absent directory distinct from a directory that could not be read", () => {
    const parent = mkdtempSync(join(tmpdir(), "admission-journal-read-arms-"));
    dirs.push(parent);
    const absent = join(parent, "absent");
    expect(readRefusals({ dir: absent })).toEqual({ kind: "directory-absent" });

    const present = join(parent, "present");
    expect(recordRefusal({
      source: "test-run",
      policyVersion: 1,
      snapshot: { kind: "broken", why: "fixture" },
      reserveBytes: undefined,
    }, { dir: present })).toBe(true);
    const denied = new Error("permission denied") as NodeJS.ErrnoException;
    denied.code = "EACCES";
    const unreadable = readRefusals({
      dir: present,
      readFile: () => { throw denied; },
    });
    expect(unreadable).toEqual({
      kind: "unreadable",
      why: expect.stringContaining("permission denied"),
    });
    expect(unreadable).not.toHaveProperty("entries");
  });

  it("keeps an uncommented journal call immediately before vitest config throws its refusal", () => {
    const source = readFileSync(join(REPO, "vitest.config.ts"), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    /* The readings by name, not the readers — see § "the writers record the
       decision's own readings" below for why passing `readMemorySnapshot` here
       wrote a later sample under the refusal's name. */
    const call =
      'recordRefusal({ source: "test-run", policyVersion: ADMISSION_POLICY_VERSION, snapshot, reserveBytes });';
    const callAt = code.indexOf(call);
    const throwAt = code.indexOf("throw new Error(markReadinessAdmissionRefusal", callAt);

    expect(callAt).toBeGreaterThan(-1);
    expect(throwAt).toBeGreaterThan(callAt);
    expect(code.slice(callAt + call.length, throwAt).trim()).toBe("");
  });

  it("records only the readiness skip carrying the memory-admission cause", () => {
    const lowMemory = {
      nominalWorkers: 3,
      snapshot: { kind: "linux" as const, availableBytes: 2 * GB, swapTotalBytes: 8 * GB, swapFreeBytes: 0 },
      reserveBytes: 4 * GB,
    };
    const base: TickInput = {
      nowMs: Date.parse("2026-09-10T03:00:00.000Z"),
      fastForwardProblem: null,
      dev: {
        kind: "known",
        devSha: "3".repeat(40),
        primarySha: "3".repeat(40),
        primaryBehind: 0,
        trunkGap: 1,
        observedAt: "2026-09-10T03:00:00.000Z",
        caveat: "fixture",
      },
      runnerTree: { kind: "known", sha: "3".repeat(40), branch: "readiness-checks", dirty: false },
      history: { readings: [], unreadable: [] },
      admission: lowMemory,
      health: {
        load: { kind: "value", load1: 2, load5: 2, load15: 2, cores: 16, ratio1: 0.125 },
        memory: { kind: "value", totalBytes: 32 * GB, availableBytes: 20 * GB, availableFraction: 0.625 },
        swap: { kind: "value", totalBytes: 16 * GB, usedBytes: 2 * GB, usedFraction: 0.125, areas: 1 },
        disk: { kind: "value", totalKiB: 1000, usedKiB: 400, availableKiB: 600, usePercent: 40 },
        swapActivity: { kind: "skipped" },
      },
      databaseProblem: null,
    };
    const admissionSkip = decideTick(base);
    const otherSkip = decideTick({ ...base, fastForwardProblem: "the tree did not advance" });
    expect(admissionSkip).toMatchObject({ kind: "skip", cause: "memory-admission" });
    expect(otherSkip).toMatchObject({ kind: "skip" });
    expect(otherSkip.kind === "skip" ? otherSkip.cause : undefined).toBeUndefined();

    const dir = mkdtempSync(join(tmpdir(), "admission-journal-readiness-"));
    dirs.push(dir);
    const consume = (decision: TickDecision): void => {
      if (decision.kind === "skip" && decision.cause === "memory-admission") {
        recordRefusal({
          source: "readiness-precheck",
          policyVersion: ADMISSION_POLICY_VERSION,
          snapshot: lowMemory.snapshot,
          reserveBytes: lowMemory.reserveBytes,
        }, { dir });
      }
    };
    consume(otherSkip);
    consume(admissionSkip);
    const result = readRefusals({ dir });
    expect(result.kind === "read" ? result.entries.map((entry) => entry.source) : []).toEqual([
      "readiness-precheck",
    ]);

    const source = readFileSync(join(REPO, "scripts", "readiness-loop.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain('decision.kind === "skip" && decision.cause === "memory-admission"');
    expect(code).toContain('source: "readiness-precheck"');
  });
});

/**
 * **Both writers must record what their decision was made on, not a fresh
 * reading taken afterwards.**
 *
 * The first implementation let `RefusalInput` take a reader as well as a value,
 * and both call sites passed `readMemorySnapshot` and `readReserveBytes`
 * themselves — so the journal re-read `/proc/meminfo` at record time and wrote a
 * *later* sample under the refusal's name. The gap between the two is largest
 * under exactly the memory pressure that caused the refusal, which is the one
 * circumstance the record exists for.
 *
 * The type refuses a reader now, so the compiler is the real guard and this is
 * the belt: it pins the two call sites to identifiers rather than calls, which
 * is the shape a future edit would break first.
 */
describe("the writers record the decision's own readings", () => {
  it("hands recordRefusal values, so a later re-read cannot be written under the refusal's name", () => {
    for (const [file, callSite] of [
      [join(REPO, "vitest.config.ts"), 'source: "test-run"'],
      [join(REPO, "scripts", "readiness-loop.ts"), 'source: "readiness-precheck"'],
    ] as const) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const call = code.slice(code.indexOf(callSite));
      const args = call.slice(0, call.indexOf("}"));
      /* The readings, passed by name. A reader would appear as the bare
         identifier `readMemorySnapshot` in these positions instead. */
      expect(args).toContain("snapshot,");
      expect(args).toContain("reserveBytes");
      expect(args).not.toContain("snapshot: readMemorySnapshot");
      expect(args).not.toContain("reserveBytes: readReserveBytes");
    }
  });

  it("writes exactly the snapshot it was given, without consulting the machine", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-values-"));
    dirs.push(dir);
    /* Numbers no real box would report, so a re-read could not coincidentally
       produce them. */
    const snapshot = {
      kind: "linux",
      availableBytes: 123_456_789,
      swapTotalBytes: 987_654_321,
      swapFreeBytes: 111_111_111,
    } as const;

    expect(
      recordRefusal(
        { source: "test-run", policyVersion: ADMISSION_POLICY_VERSION, snapshot, reserveBytes: 42 },
        { dir },
      ),
    ).toBe(true);

    const read = readRefusals({ dir });
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]).toMatchObject({
      availableBytes: 123_456_789,
      swapTotalBytes: 987_654_321,
      swapFreeBytes: 111_111_111,
      reserveBytes: 42,
    });
  });
});
