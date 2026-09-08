/**
 * The memory admission check: whether there is room to start a test run.
 *
 * The arithmetic is pure and takes its inputs as arguments, so every case here
 * is a state this machine is not in — which is the point. A test that can only
 * assert what the machine it runs on happens to be doing would be green on the
 * laptop and green on the box and red on neither.
 *
 * docs/plans/260908b-adaptive-test-resource-limits-so-concurrent-suites-cannot-exhaust-the-box.md
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

import {
  ADMISSION_POLICY_VERSION,
  FIXED_RUN_PEAK_BYTES,
  MEMORY_RESERVE_FILE,
  PER_WORKER_PEAK_BYTES,
  decideAdmission,
  readMemorySnapshot,
  readReserveBytes,
  type MemorySnapshot,
} from "../vitest-admission.js";

const GB = 1024 ** 3;

/** A machine with this much free, and swap that is not the story. */
function linux(availableGb: number, swap = { totalGb: 32, freeGb: 32 }): MemorySnapshot {
  return {
    kind: "linux",
    availableBytes: Math.round(availableGb * GB),
    swapTotalBytes: Math.round(swap.totalGb * GB),
    swapFreeBytes: Math.round(swap.freeGb * GB),
  };
}

function fileSaying(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "spya-admission-"));
  const file = join(dir, "vitest-memory-reserve-gb");
  writeFileSync(file, contents);
  return file;
}

const NO_FILE = join(mkdtempSync(join(tmpdir(), "spya-admission-none-")), "absent");

test("a machine with room admits, and says how much room it found", () => {
  // 20 GB available, hold back 4, a run costs 3.84 before workers:
  // (20 - 4 - 3.84) / 0.198 = 61 workers of headroom, so the nominal wins.
  const d = decideAdmission({ nominalWorkers: 8, snapshot: linux(20), reserveBytes: 4 * GB });
  expect(d.kind).toBe("admit");
  if (d.kind !== "admit") throw new Error("unreachable");
  expect(d.workers).toBe(8);
  expect(d.capacity).toBeGreaterThan(8);
});

test("a crowded machine reduces the run rather than refusing it", () => {
  /* Room for exactly five workers, expressed in terms of the constants rather
     than a memorised gigabyte figure: this test asserts the SHAPE — that a
     squeeze reduces rather than refuses — and re-tuning the constants after a
     re-measurement should not send anybody hunting for which literals to edit. */
  const reserveBytes = 4 * GB;
  const availableBytes = reserveBytes + FIXED_RUN_PEAK_BYTES + 5 * PER_WORKER_PEAK_BYTES;
  const d = decideAdmission({
    nominalWorkers: 8,
    snapshot: { kind: "linux", availableBytes, swapTotalBytes: 0, swapFreeBytes: 0 },
    reserveBytes,
  });
  expect(d.kind).toBe("admit");
  if (d.kind !== "admit") throw new Error("unreachable");
  expect(d.capacity).toBe(5);
  expect(d.workers).toBe(5);
});

/**
 * **The case the whole file is for**, and the one 2026-09-08 actually hit:
 * MemAvailable was 1.7 GB, which is less than a run's fixed cost on its own.
 *
 * It refuses. It does NOT come back with one worker — the sum has just said no
 * worker fits, and a floor-to-one would start a 3.84 GB process group on a
 * machine calculated not to have room for it. Invert the `capacity < 1`
 * comparison in vitest-admission.ts and this test goes red, which is the only
 * reason to trust it.
 */
test("a machine at the cliff refuses, and does not floor to one worker", () => {
  const d = decideAdmission({
    nominalWorkers: 3,
    snapshot: linux(1.7, { totalGb: 32, freeGb: 0 }),
    reserveBytes: 4 * GB,
  });
  expect(d.kind).toBe("refuse");
  if (d.kind !== "refuse") throw new Error("unreachable");
  expect(d).not.toHaveProperty("workers");
});

test("the refusal says no tests ran, because that is what it will be mistaken for", () => {
  const d = decideAdmission({ nominalWorkers: 3, snapshot: linux(1.7), reserveBytes: 4 * GB });
  if (d.kind !== "refuse") throw new Error("expected a refusal");
  // A run that stops here produces no verdict. Somebody reading CI has to be
  // told that in words, or "the suite stopped" reads as "the suite failed".
  expect(d.message).toMatch(/NO TESTS RAN/);
  expect(d.message).toMatch(/resource pressure, not a test failure/);
  // And enough numbers to argue with, plus the way to switch it off.
  expect(d.message).toMatch(/MemAvailable/);
  expect(d.message).toMatch(new RegExp(`policy v${ADMISSION_POLICY_VERSION}`));
  expect(d.message).toContain(MEMORY_RESERVE_FILE);
});

test("exactly one worker's worth of room is admitted, not refused", () => {
  // The boundary, from the other side: reserve + fixed + exactly one worker.
  const available = 4 * GB + FIXED_RUN_PEAK_BYTES + PER_WORKER_PEAK_BYTES;
  const d = decideAdmission({
    nominalWorkers: 4,
    snapshot: { kind: "linux", availableBytes: available, swapTotalBytes: 0, swapFreeBytes: 0 },
    reserveBytes: 4 * GB,
  });
  expect(d.kind).toBe("admit");
  if (d.kind !== "admit") throw new Error("unreachable");
  expect(d.workers).toBe(1);
});

test("a hair under one worker's worth refuses", () => {
  const available = 4 * GB + FIXED_RUN_PEAK_BYTES + PER_WORKER_PEAK_BYTES - 1;
  const d = decideAdmission({
    nominalWorkers: 4,
    snapshot: { kind: "linux", availableBytes: available, swapTotalBytes: 0, swapFreeBytes: 0 },
    reserveBytes: 4 * GB,
  });
  expect(d.kind).toBe("refuse");
});

/**
 * **A known limit, pinned rather than papered over.**
 *
 * The check is a valve, not a bound. Runs that arrive one after another each
 * see less memory than the last and are throttled, then refused — that is the
 * 2026-09-08 shape, where eighteen suites arrived across an hour. Runs that
 * read `MemAvailable` in the *same instant* all see the same number and all
 * admit, and the overshoot can be the whole cohort.
 *
 * This test asserts the overshoot, so that the day somebody adds an atomic
 * claim it goes red and has to be rewritten as the bound it would then be.
 * Asserting the bound today would be asserting a property the code does not
 * have. GPT Sol asked for exactly this comparison, 2026-09-08.
 */
test("eighteen simultaneous starters all admit, and together overshoot the machine", () => {
  const reserveBytes = 4 * GB;
  // A machine with room for one run of two workers, and no more than that.
  const availableBytes = reserveBytes + FIXED_RUN_PEAK_BYTES + 2 * PER_WORKER_PEAK_BYTES;
  const snapshot = { kind: "linux" as const, availableBytes, swapTotalBytes: 0, swapFreeBytes: 0 };

  // Every one of them reads the same instant, because none has allocated yet.
  const cohort = Array.from({ length: 18 }, () =>
    decideAdmission({ nominalWorkers: 2, snapshot, reserveBytes }),
  );
  expect(cohort.every((d) => d.kind === "admit")).toBe(true);

  const predictedPeak = cohort.reduce((total, d) => {
    if (d.kind !== "admit") return total;
    return total + FIXED_RUN_PEAK_BYTES + d.workers * PER_WORKER_PEAK_BYTES;
  }, 0);

  // What a bound would guarantee, and what this deliberately does not: the
  // cohort's own arithmetic says it needs eighteen times what fits.
  expect(predictedPeak).toBeGreaterThan(availableBytes - reserveBytes);
  expect(predictedPeak).toBeCloseTo(18 * (availableBytes - reserveBytes), -9);
});

test("but a later arrival, seeing what the earlier ones took, is refused", () => {
  // The half that does work: the same eighteenth run, once the first seventeen
  // have actually allocated, reads a machine with nothing left and is stopped.
  const afterTheOthersAllocated = linux(1.7, { totalGb: 32, freeGb: 0 });
  const d = decideAdmission({ nominalWorkers: 2, snapshot: afterTheOthersAllocated, reserveBytes: 4 * GB });
  expect(d.kind).toBe("refuse");
});

test("a machine that has not opted in is left alone, not refused", () => {
  // The distinction that must never collapse: "no policy here" and "no room
  // here" are both "not admitted", and only one of them may stop the run.
  const d = decideAdmission({ nominalWorkers: 8, snapshot: linux(0.1), reserveBytes: undefined });
  expect(d.kind).toBe("not-applicable");
});

test("a platform without MemAvailable is left alone rather than guessed at", () => {
  const d = decideAdmission({
    nominalWorkers: 8,
    snapshot: { kind: "not-linux", platform: "darwin" },
    reserveBytes: 4 * GB,
  });
  expect(d.kind).toBe("not-applicable");
  if (d.kind !== "not-applicable") throw new Error("unreachable");
  expect(d.why).toMatch(/darwin/);
});

/**
 * The two ways of not knowing, which must not share an outcome. A laptop is
 * left alone; a Linux box that opted in and whose /proc/meminfo will not answer
 * is stopped. A check that switches itself off when its input goes missing
 * protects nothing and looks exactly like a check that ran.
 */
test("an opted-in machine whose memory cannot be read is refused, not waved through", () => {
  const d = decideAdmission({
    nominalWorkers: 8,
    snapshot: { kind: "broken", why: "/proc/meminfo has no MemAvailable line" },
    reserveBytes: 4 * GB,
  });
  expect(d.kind).toBe("refuse");
  if (d.kind !== "refuse") throw new Error("unreachable");
  expect(d.message).toMatch(/NO TESTS RAN/);
  expect(d.message).toMatch(/broken check, not a test failure/);
});

test("an absent reserve file means no policy; an empty one is a truncated write", () => {
  expect(readReserveBytes(NO_FILE)).toBeUndefined();
  // NOT undefined: `>` truncates before it writes, so an interrupted
  // provisioning run leaves exactly this, and reading it as "no policy" would
  // take the check off the one machine that asked for it.
  expect(() => readReserveBytes(fileSaying(""))).toThrow(/empty/);
  expect(() => readReserveBytes(fileSaying("   \n"))).toThrow(/empty/);
  expect(readReserveBytes(fileSaying("4\n"))).toBe(4 * GB);
  // A directory where the file should be is a machine that meant to say
  // something and is not being heard — the same reasoning as the worker file.
  expect(() => readReserveBytes(mkdtempSync(join(tmpdir(), "spya-admission-dir-")))).toThrow();
});

test.each(["0", "-1", "nonsense"])("a reserve of %o is refused rather than guessed at", (bad) => {
  expect(() => readReserveBytes(fileSaying(bad))).toThrow(/positive number of GB/);
});

test("MemAvailable is read from /proc/meminfo, not MemFree", () => {
  // MemFree is near zero on every healthy busy Linux box, because the kernel
  // spends idle RAM on cache. Reading it instead would refuse every run.
  const meminfo = fileSaying(
    ["MemTotal:       30000000 kB", "MemFree:          200000 kB", "MemAvailable:   15000000 kB", "SwapTotal:      32000000 kB", "SwapFree:       31000000 kB", ""].join("\n"),
  );
  const snap = readMemorySnapshot(meminfo);
  if (process.platform !== "linux") {
    // On a laptop the platform gate fires first, and that IS the behaviour.
    expect(snap.kind).toBe("not-linux");
    return;
  }
  if (snap.kind !== "linux") throw new Error("expected a linux snapshot");
  expect(snap.availableBytes).toBe(15000000 * 1024);
  expect(snap.swapFreeBytes).toBe(31000000 * 1024);
});

/**
 * Two files have to agree and neither can see the other, exactly as the worker
 * count already does in tests/vitest-worker-caps.test.ts. Asserting that
 * provisioning *creates* a file would pass on a box configured to a number
 * nobody meant, so read the value out and put it through the real parser.
 */
test("provisioning writes a reserve this parser accepts, and checks the same number", () => {
  expect(MEMORY_RESERVE_FILE).toMatch(/[/\\]\.config[/\\]spideryarn[/\\]vitest-memory-reserve-gb$/);
  const provision = readFileSync(
    fileURLToPath(new URL("../infra/hetzner/provision.sh", import.meta.url)),
    "utf8",
  );
  const relativeToHome = MEMORY_RESERVE_FILE.slice(homedir().length + 1);
  const writes = provision
    .split("\n")
    .find((line) => line.includes(`$HOME/${relativeToHome}`) && line.includes("printf"));
  expect(writes, `provision.sh should write ${relativeToHome}`).toBeDefined();
  const written = /printf '(\d+)\\n'/.exec(writes ?? "")?.[1];
  expect(written, "provision.sh should printf a reserve into it").toBeDefined();

  const verifies = provision
    .split("\n")
    .find((line) => line.includes("check ") && line.includes("vitest-memory-reserve-gb"));
  expect(verifies, "provision.sh should verify the file it wrote").toBeDefined();
  expect(/grep -qx "(\d+)"/.exec(verifies ?? "")?.[1]).toBe(written);

  // The semantic check, not just the string: the number provisioning writes has
  // to be one this parser accepts, and has to leave the box able to run a suite
  // at all when it is otherwise idle.
  const reserve = readReserveBytes(fileSaying(`${written}\n`));
  expect(reserve).toBe(Number(written) * GB);
  const idleBox = decideAdmission({ nominalWorkers: 2, snapshot: linux(24), reserveBytes: reserve });
  expect(idleBox.kind, "an idle box must still be able to run its own tests").toBe("admit");
});
