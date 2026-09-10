import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  pruneRefusals,
  readRefusals,
  recordRefusal,
} from "../admission-journal.js";
import { ADMISSION_POLICY_VERSION } from "../vitest-admission.js";
import { decideTick, type TickDecision, type TickInput } from "../tools/fleet/readiness-loop.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];
const GB = 1024 ** 3;
const REFUSALS_FILE = "refusals.jsonl";
const PREVIOUS_REFUSALS_FILE = "refusals.prev.jsonl";

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function childAppend(dir: string, count: number): Promise<void> {
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
      else reject(new Error(`append child exited ${code}: ${stderr}`));
    });
  });
}

describe("the admission refusal journal", () => {
  it("loses no lines when separate processes append concurrently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-concurrent-"));
    dirs.push(dir);

    const childCount = 4;
    const linesPerChild = 40;
    await Promise.all(Array.from({ length: childCount }, () => childAppend(dir, linesPerChild)));

    const result = readRefusals({ dir });
    expect(result).toMatchObject({ kind: "read", unparseableLines: 0 });
    expect(result.kind === "read" ? result.entries : []).toHaveLength(childCount * linesPerChild);
  });

  it("refuses an oversized line without truncating or corrupting the live file", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-bounded-"));
    dirs.push(dir);
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

    expect(recordRefusal(input, { dir, host: "box" })).toBe(true);
    const before = readFileSync(join(dir, REFUSALS_FILE), "utf8");
    expect(recordRefusal(input, { dir, host: "x".repeat(2_000) })).toBe(false);
    const after = readFileSync(join(dir, REFUSALS_FILE), "utf8");

    expect(after).toBe(before);
    expect(() => JSON.parse(after.trim())).not.toThrow();
    expect(readRefusals({ dir })).toMatchObject({ kind: "read", unparseableLines: 0 });
  });

  it("swallows an append failure without replacing the caller's refusal", () => {
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

  it("loses no line when pruning happens between two appends", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-prune-"));
    dirs.push(dir);
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

    expect(recordRefusal(input, { dir, now: () => new Date("2026-09-10T01:00:00.000Z") })).toBe(true);
    expect(pruneRefusals({ dir, maxFileBytes: 1 })).toBe(true);
    expect(recordRefusal(input, { dir, now: () => new Date("2026-09-10T02:00:00.000Z") })).toBe(true);

    expect(readFileSync(join(dir, PREVIOUS_REFUSALS_FILE), "utf8")).toContain("2026-09-10T01:00:00.000Z");
    const result = readRefusals({ dir });
    expect(result.kind).toBe("read");
    expect(result.kind === "read" ? result.entries.map((entry) => entry.at) : []).toEqual([
      "2026-09-10T01:00:00.000Z",
      "2026-09-10T02:00:00.000Z",
    ]);
  });

  it("counts unparseable lines while retaining the readable entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "admission-journal-unparseable-"));
    dirs.push(dir);
    expect(recordRefusal({
      source: "test-run",
      policyVersion: 1,
      snapshot: { kind: "linux", availableBytes: 10, swapTotalBytes: 20, swapFreeBytes: 5 },
      reserveBytes: 4,
    }, { dir })).toBe(true);
    appendFileSync(join(dir, REFUSALS_FILE), "{not json}\n{}\n", "utf8");

    const result = readRefusals({ dir });
    expect(result).toMatchObject({ kind: "read", unparseableLines: 2 });
    expect(result.kind === "read" ? result.entries : []).toHaveLength(1);
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
