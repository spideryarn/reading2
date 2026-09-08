/**
 * How many workers a test run should take on this machine, and whether there is
 * room to start it at all.
 *
 * **Separate from vitest.config.ts, and that is a correctness boundary rather
 * than tidiness.** Evaluating that config *runs* the decision, and
 * tests/vitest-worker-caps.test.ts imports these functions; while they lived
 * there, a test importing them could throw a refusal from inside an
 * already-admitted run — producing exactly the misleading partial red the
 * refusal message promises cannot happen. GPT Sol caught it, 2026-09-08.
 *
 * ## Why this exists, when a worker cap already did
 *
 * `resolveParallelWorkers()` below caps workers **per run**, decided in
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
 * This asks the kernel instead. The shared state is the machine's own number,
 * so there is nothing to keep in sync, steal, or leave behind after a crash.
 *
 * ## What this is, and what it is not
 *
 * **It is a valve, not a bound, and the difference matters.** As runs arrive
 * and allocate, later arrivals see less `MemAvailable` and are given fewer
 * workers, then refused. That is the shape of the 2026-09-08 incident, whose
 * eighteen suites arrived over about an hour — the tmux session names timestamp
 * them from 0100 to 0159 — and every one of them would have met a smaller
 * number than the one before.
 *
 * What it does **not** bound is a simultaneous cohort. N runs that read
 * `MemAvailable` in the same instant all see the same figure and all admit, and
 * the overshoot can be the whole cohort. Nor is the fixed 3.84 GB allocated at
 * the moment a run is admitted: it is a *peak*, reached later, so even a
 * staggered arrival can read a machine that is emptier than it is about to be.
 * GPT Sol pressed on both, and both are real.
 *
 * Bounding the cohort needs an atomic claim — a short admission critical
 * section that assigns capacity rather than a suite-lifetime lock. That is a
 * home-grown scheduler, it is not what 2026-09-08 needed, and it is not here.
 * tests/vitest-memory-admission.test.ts pins the limit rather than papering
 * over it.
 */

import { readFileSync } from "node:fs";
import { availableParallelism, homedir, platform } from "node:os";
import { join } from "node:path";

/** Bump when the arithmetic changes, so a log line can be traced to a rule. */
export const ADMISSION_POLICY_VERSION = 1;

const GB = 1024 ** 3;

/**
 * Measured, not guessed: `scripts/spike-vitest-workers.py` against the unit
 * lane, sampling the whole process group. On an 18-core Mac at 1/2/4/8/16
 * workers, least squares over the five points predicts each within 0.2 GB:
 *
 *     peak RSS ≈ 3.84 GB + 0.198 GB per worker
 *
 * Repeated on the Linux box at 1 and 2 workers, peak RSS came back at 3.68 and
 * 4.38 GB against the Mac's 3.88 and 4.33 — close enough that the shape
 * transfers between the two machines.
 *
 * **Peak, not mean.** The mean is less than a quarter of this and would size
 * the machine for the average moment rather than the moment it falls over.
 *
 * **And the fixed figure is deliberately above measured RSS, because RSS is not
 * what this file reads.** The same Linux runs recorded the drop in
 * `MemAvailable` — the number `decideAdmission` actually consumes — at 5.77 GB
 * and 4.10 GB, both *larger* than the summed RSS peak. They measure different
 * things: RSS misses the page cache a run evicts and the kernel memory charged
 * on its behalf, while it double-counts shared pages the other way. Neither
 * bound is clean on a box other agents are using, so the two runs cannot
 * distinguish 3.8 from 5.8.
 *
 * 5.0 GB splits them, on the asymmetry: refusing too eagerly costs a slow test
 * run, and admitting too eagerly costs the box and the postgres every other
 * worktree shares. GPT Sol asked for this calibration and was right that
 * "summed RSS double-counts shared pages" argued for conservatism without
 * establishing it.
 */
export const FIXED_RUN_PEAK_BYTES = Math.round(5.0 * GB);
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

/**
 * What /proc/meminfo said, or why it could not be asked — and the two ways of
 * not being able to ask are **different outcomes**, which is why they are
 * different members rather than one `unsupported`.
 *
 * `not-linux` is the ordinary case on a laptop and means "no policy here".
 * `broken` is a Linux machine that opted in and whose `/proc/meminfo` would not
 * answer, and it must stop the run: a check that quietly switches itself off
 * when its input goes missing protects nothing, and looks exactly like a check
 * that ran. GPT Sol, 2026-09-08.
 */
export type MemorySnapshot =
  | { kind: "linux"; availableBytes: number; swapTotalBytes: number; swapFreeBytes: number }
  | { kind: "not-linux"; platform: string }
  | { kind: "broken"; why: string };

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
  /* **An empty file is an error, not "no policy".** Absent means a machine has
     nothing to say; present-but-empty is what an interrupted or truncated write
     leaves behind, and treating it as no-policy would silently take the
     admission check off the one machine that asked for it. Provisioning now
     writes through a temporary file and renames, so this state should be
     unreachable — which is the reason to make it loud rather than to assume it.
     GPT Sol, 2026-09-08. */
  if (raw.trim() === "") {
    throw new Error(
      `${file} exists but is empty, which is what a truncated write leaves behind. ` +
        "Write a positive number of GB, or delete the file to switch memory admission off.",
    );
  }
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
  if (platform() !== "linux") return { kind: "not-linux", platform: platform() };
  let text: string;
  try {
    text = readFileSync(meminfoPath, "utf8");
  } catch (cause) {
    return { kind: "broken", why: `${meminfoPath} could not be read: ${(cause as Error).message}` };
  }
  const field = (name: string): number | undefined => {
    // kB is the only unit /proc/meminfo uses for these, and it says so per line.
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "m").exec(text);
    return m?.[1] === undefined ? undefined : Number(m[1]) * 1024;
  };
  const availableBytes = field("MemAvailable");
  if (availableBytes === undefined) return { kind: "broken", why: `${meminfoPath} has no MemAvailable line` };
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
  if (snapshot.kind === "not-linux") {
    return { kind: "not-applicable", why: `platform is ${snapshot.platform}, not linux` };
  }
  /* Opted in, on Linux, and the kernel would not say how much memory there is.
     Refusing is the only honest answer: the alternative is to run anyway on the
     machine that asked to be protected, having lost the ability to tell whether
     it needs protecting. */
  if (snapshot.kind === "broken") {
    return {
      kind: "refuse",
      message:
        `REFUSING TO START: this machine opted into memory admission and its memory could not be read.\n` +
        `  ${snapshot.why}\n` +
        `  NO TESTS RAN AND NOTHING WAS VERIFIED — this is a broken check, not a test failure.\n` +
        `  Fix /proc/meminfo, or remove ${MEMORY_RESERVE_FILE} to switch this off.\n` +
        `  (admission policy v${ADMISSION_POLICY_VERSION}, pid ${process.pid})`,
    };
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

/**
 * **How many files run at once: half the machine, not all of it.**
 *
 * Vitest's default is `availableParallelism() - 1`, decided by each run in
 * ignorance of every other. That is right for a machine running one suite and
 * wrong for both of ours, where a dozen worktrees each have an agent that runs
 * `npm test` when it suits them. What it costs when they collide, and what a
 * cap costs when they don't, are measured in
 * docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md.
 *
 * Three layers, narrowest first — one run, one machine, everywhere:
 *
 *     VITEST_MAX_WORKERS                        "this run is alone, go faster"
 *     ~/.config/spideryarn/vitest-max-workers   "this machine is crowded"
 *     half the cores, and at least 2
 *
 * The middle one is a **file** rather than an environment variable because the
 * variable does not arrive: measured on the box, nothing in the `env` block of
 * `~/.claude/settings.json` reaches a Claude Bash tool call, not even the
 * `CLAUDE_CODE_SCROLL_SPEED` that has been in it since the box was built. A
 * file has no propagation to be wrong about. `infra/hetzner/provision.sh`
 * writes 3 into it; a laptop has none and takes the half.
 *
 * **Why the override is read here and then deleted.** Vitest reads
 * `VITEST_MAX_WORKERS` itself, in `resolveConfig`, **after** the line that
 * turns `fileParallelism: false` into `maxWorkers: 1`, and for every project —
 * so leaving it set lets a knob for *using less of the machine* quietly
 * de-serialise the private-postgres lane below, which is serial because its
 * files share a database and a job-queue singleton. That trades a slow suite
 * for a lying one, and it had already been typed in good faith
 * (260906f ran `VITEST_MAX_WORKERS=4 npm run check`). Deleting it is the only
 * lever a config file has, since everything vitest does with it happens later.
 * `tests/vitest-worker-caps.test.ts` pins vitest's behaviour as well as ours,
 * so a release that fixes the ordering upstream turns red here rather than
 * leaving a defence nobody dares delete.
 */
export const MACHINE_WORKERS_FILE = join(homedir(), ".config", "spideryarn", "vitest-max-workers");

/** Both layers say a worker count the same way, so they are read the same way. */
function parseWorkerCount(raw: string, source: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const workers = Number(raw.trim());
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(
      `${source} must be a whole number of workers, 1 or more; got ${JSON.stringify(raw)}. ` +
        "Remove it to take half of this machine's cores.",
    );
  }
  return workers;
}

/**
 * Exported for `tests/vitest-worker-caps.test.ts`, which has to be able to ask
 * what this machine would do *without* the file this machine happens to have —
 * otherwise the test for the default answer is red on the box and green on the
 * laptop, which is worse than having no test.
 */
export function resolveParallelWorkers(machineFile = MACHINE_WORKERS_FILE): number {
  /* **Consumed once, and not remembered.** Vite evaluates this file again on a
     watch restart, by which time the variable is gone, so `npm run test:watch`
     started with an override falls back to the machine's number after the first
     restart. That is a real wart and it was fixed once, by keeping the value on
     `globalThis` — but a config file cannot tell a restart from a second vitest
     in the same process, so the remembered value then leaked into instances
     that never asked for it (both measured by GPT Sol, 2026-09-06). Both
     mistakes are worth the same: a run that is faster or slower than asked.
     Neither can reach the serial lane, which names its own `maxWorkers: 1`. So
     the simpler wrong thing wins over the more complicated wrong thing, and
     `tests/vitest-worker-caps.test.ts` pins the absence of the leak. */
  const fromEnv = process.env.VITEST_MAX_WORKERS;
  delete process.env.VITEST_MAX_WORKERS;
  const chosen = fromEnv === undefined ? undefined : parseWorkerCount(fromEnv, "VITEST_MAX_WORKERS");
  if (chosen !== undefined) return chosen;

  /* **Only "there is no such file" is silent**, because that is the normal
     case: a laptop has nothing to say. A file that exists and cannot be read —
     wrong permissions, a directory where the file should be, a failing disk —
     is a machine that *did* mean to set a policy and whose policy is not being
     applied, and swallowing that would hand the box back a cap of 8 with
     nothing anywhere to say why. GPT Sol, 2026-09-06. */
  let fromFile: string | undefined;
  try {
    fromFile = readFileSync(machineFile, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`${machineFile} exists but could not be read; fix it or remove it.`, { cause });
    }
    fromFile = undefined;
  }
  const machine = fromFile === undefined ? undefined : parseWorkerCount(fromFile, machineFile);
  if (machine !== undefined) return machine;

  return Math.max(2, Math.floor(availableParallelism() / 2));
}
