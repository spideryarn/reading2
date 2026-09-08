/**
 * Whether there is room on this machine to start a test run at all, and with
 * how many workers.
 *
 * Separate from vitest.config.ts so it can be tested: that file is evaluated by
 * vitest itself, and a config cannot import its own conclusions back.
 *
 * ## Why this exists, when a worker cap already did
 *
 * `resolveParallelWorkers()` next door caps workers **per run**, decided in
 * ignorance of every other run. On 2026-09-08 eighteen runs at a cap of three
 * put the shared box at load 391 with **swap 100% full**, and postgres had
 * invoked the OOM killer two days earlier.
 *
 * The measurement that plan was missing is in
 * docs/plans/260908b-adaptive-test-resource-limits-so-concurrent-suites-cannot-exhaust-the-box.md:
 *
 *     peak RSS ≈ 3.84 GB fixed + 0.198 GB per worker
 *
 * **87% of a run's peak memory is spent before the first worker forks.** So the
 * worker cap is a CPU lever and very nearly not a memory lever at all: eighteen
 * runs cost 79.7 GB of peak at a cap of 3 and 72.6 GB at a cap of 1, on a box
 * with 62 GiB of RAM and swap together. What was unbounded is the number of
 * concurrent RUNS, and nothing in this repo bounded it.
 *
 * ## Why there is no registry, no lock and no coordination
 *
 * There was going to be a lease file per run. GPT Sol refused it, twice over,
 * and was right both times: it is write-after-read, so in the thundering herd
 * it exists to handle every starter reads zero leases and every starter takes
 * the maximum; and `--maxWorkers` on the command line overrides the config by
 * design, so a config-time lease can record 1 while the run really uses 8.
 *
 * This asks the kernel instead. A run that has started is already inside the
 * next run's `MemAvailable`, so the shared state is the machine's own number
 * and there is nothing to keep in sync, steal, or leave behind after a crash.
 */

import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** Bump when the arithmetic changes, so a log line can be traced to a rule. */
export const ADMISSION_POLICY_VERSION = 1;

const GB = 1024 ** 3;

/**
 * Measured, not guessed: `scripts/spike-vitest-workers.py` against the unit
 * lane at 1/2/4/8/16 workers, sampling the whole process group. Least squares
 * over those five points predicts each of them to within 0.2 GB.
 *
 * **Peak, not mean.** The mean is less than a quarter of this and would size
 * the machine for the average moment rather than the moment it falls over.
 */
export const FIXED_RUN_PEAK_BYTES = Math.round(3.84 * GB);
export const PER_WORKER_PEAK_BYTES = Math.round(0.198 * GB);

/**
 * The file that opts a machine in, and says what to keep back for everything
 * that is not this test run — agents, postgres, dev servers, the page cache.
 *
 * **Presence is the opt-in.** A laptop has no file and keeps today's static
 * behaviour, because `MemAvailable` is Linux's number and macOS has no honest
 * equivalent; guessing one would make the quietest machine the least
 * predictable. Same directory as the worker count, written and self-checked by
 * infra/hetzner/provision.sh.
 */
export const MEMORY_RESERVE_FILE = join(homedir(), ".config", "spideryarn", "vitest-memory-reserve-gb");

/** What /proc/meminfo said, or why it could not be asked. */
export type MemorySnapshot =
  | { kind: "linux"; availableBytes: number; swapTotalBytes: number; swapFreeBytes: number }
  | { kind: "unsupported"; why: string };

/**
 * A discriminated union rather than a number-or-null, so that "no policy on
 * this machine" cannot be confused with "no room on this machine" — they are
 * the two outcomes it would be worst to mix up, and one of them must stop the
 * run.
 */
export type AdmissionDecision =
  | { kind: "not-applicable"; why: string }
  | { kind: "admit"; workers: number; capacity: number; availableBytes: number; reserveBytes: number }
  | { kind: "refuse"; message: string };

/** Parse the reserve file. Only ENOENT is silent — see resolveParallelWorkers. */
export function readReserveBytes(file = MEMORY_RESERVE_FILE): number | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`${file} exists but could not be read; fix it or remove it.`, { cause });
  }
  if (raw.trim() === "") return undefined;
  const gb = Number(raw.trim());
  if (!Number.isFinite(gb) || gb <= 0) {
    throw new Error(
      `${file} must be a positive number of GB to hold back; got ${JSON.stringify(raw)}. ` +
        "Remove it to switch memory admission off on this machine.",
    );
  }
  return Math.round(gb * GB);
}

/**
 * Read `MemAvailable` rather than `MemFree`: Linux spends idle RAM on cache and
 * hands it back on demand, so free is near zero on every healthy busy machine
 * and would refuse every run.
 */
export function readMemorySnapshot(meminfoPath = "/proc/meminfo"): MemorySnapshot {
  if (platform() !== "linux") return { kind: "unsupported", why: `platform is ${platform()}, not linux` };
  let text: string;
  try {
    text = readFileSync(meminfoPath, "utf8");
  } catch (cause) {
    return { kind: "unsupported", why: `${meminfoPath} could not be read: ${(cause as Error).message}` };
  }
  const field = (name: string): number | undefined => {
    // kB is the only unit /proc/meminfo uses for these, and it says so per line.
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "m").exec(text);
    return m?.[1] === undefined ? undefined : Number(m[1]) * 1024;
  };
  const availableBytes = field("MemAvailable");
  if (availableBytes === undefined) return { kind: "unsupported", why: `${meminfoPath} has no MemAvailable line` };
  return {
    kind: "linux",
    availableBytes,
    swapTotalBytes: field("SwapTotal") ?? 0,
    swapFreeBytes: field("SwapFree") ?? 0,
  };
}

/**
 * The whole decision, as arithmetic over values a test can hand in.
 *
 * **A capacity below one refuses; it does not floor to one.** The sum has just
 * said that not even a single worker's memory is there on top of this run's
 * fixed 3.84 GB, and starting anyway would add a process group the machine has
 * been calculated not to have room for — which is how postgres got OOM-killed.
 * GPT Sol's correction, and the sharpest point in its review.
 */
export function decideAdmission(args: {
  nominalWorkers: number;
  snapshot: MemorySnapshot;
  reserveBytes: number | undefined;
}): AdmissionDecision {
  const { nominalWorkers, snapshot, reserveBytes } = args;
  if (reserveBytes === undefined) {
    return { kind: "not-applicable", why: `no ${MEMORY_RESERVE_FILE}, so this machine has not opted in` };
  }
  if (snapshot.kind === "unsupported") {
    return { kind: "not-applicable", why: snapshot.why };
  }
  const spare = snapshot.availableBytes - reserveBytes - FIXED_RUN_PEAK_BYTES;
  const capacity = Math.floor(spare / PER_WORKER_PEAK_BYTES);
  if (capacity < 1) {
    const gb = (n: number) => `${(n / GB).toFixed(2)} GB`;
    const swap =
      snapshot.swapTotalBytes === 0
        ? "no swap"
        : `swap ${gb(snapshot.swapTotalBytes - snapshot.swapFreeBytes)} of ${gb(snapshot.swapTotalBytes)} used`;
    return {
      kind: "refuse",
      message:
        `REFUSING TO START: not enough memory on this machine for a test run.\n` +
        `  MemAvailable ${gb(snapshot.availableBytes)}, and ${swap}.\n` +
        `  A run needs ${gb(FIXED_RUN_PEAK_BYTES)} before its first worker, ` +
        `plus ${gb(PER_WORKER_PEAK_BYTES)} per worker,\n` +
        `  and this machine holds back ${gb(reserveBytes)} for everything that is not a test run.\n` +
        `  NO TESTS RAN AND NOTHING WAS VERIFIED — this is resource pressure, not a test failure.\n` +
        `  Wait for the machine to clear, or remove ${MEMORY_RESERVE_FILE} to switch this off.\n` +
        `  (admission policy v${ADMISSION_POLICY_VERSION}, pid ${process.pid})`,
    };
  }
  return {
    kind: "admit",
    workers: Math.min(nominalWorkers, capacity),
    capacity,
    availableBytes: snapshot.availableBytes,
    reserveBytes,
  };
}
