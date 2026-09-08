/**
 * **ONE COMMAND THAT ACTIVATES THE OVERSEER UNIT, AND THAT CANNOT REPORT
 * SUCCESS WHILE THE OLD ONE IS STILL RUNNING.**
 *
 *     npx tsx scripts/overseer-activate.ts            # dry run: says what it would do, changes nothing
 *     sudo npx tsx scripts/overseer-activate.ts --apply
 *     sudo npx tsx scripts/overseer-activate.ts --apply --arm     # and set OVERSEER_JOBS_ENABLED=1
 *     sudo npx tsx scripts/overseer-activate.ts --apply --disarm  # and set it to 0
 *
 * ## The failure this exists to make impossible
 *
 * GPT Sol's S8-3, found in a command list I had written into a plan for Greg to
 * paste:
 *
 * > `systemctl daemon-reload` rereads `/etc/systemd/system/overseer.service`; it
 * > does not copy the changed checked-in unit there. The only source-shown
 * > installer is `provision.sh`'s `install_unit()`. Therefore the listed
 * > `daemon-reload`, `enable`, and `restart` sequence can restart the old,
 * > disarmed unit successfully.
 *
 * Every command in that sequence would have printed nothing and exited zero,
 * `systemctl is-active` would have said `active`, and the box would have gone on
 * running a unit with no `EnvironmentFile` line in it. **This is the exact shape
 * of docs/reusable/silent-success.md**: a check that shares an assumption with
 * the thing it is checking.
 *
 * So the last thing this command does is not the restart. It is: read the
 * installed unit back, ask systemd whether it is active, wait for a checkpoint
 * written AFTER the restart, and confirm that both named jobs are genuinely
 * eligible in it. Any of those failing is a non-zero exit and a sentence.
 *
 * ## And the second trap in that sequence
 *
 * A `restart` before the tmux daemon is stopped starts a systemd process that
 * immediately loses the store lock to the one already holding it — and
 * `Restart=always` with `StartLimitBurst=10` means ten of those in fifty seconds
 * leaves the unit `failed`, at which point the box has no Overseer at all and
 * the reason is five layers down. So the tmux holder is stopped FIRST, and the
 * lock is watched until it is actually free.
 *
 * ## Dry run is the default, on purpose
 *
 * The parts that matter need `sudo`, which is Greg's, and a command whose first
 * effect is irreversible is one nobody reads the output of. With no `--apply`
 * this prints the plan, runs every read-only check in it, and touches nothing.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import { isProcessAlive, readLock } from "../tools/overseer/lock.js";
import { ruleJobs } from "../tools/overseer/rule-jobs.js";
import { eligibilityOf, type JobEligibility } from "../tools/overseer/scheduler.js";
import { standingJobs } from "../tools/overseer/standing-jobs.js";
import { CHECKPOINT_FILE, LOCK_FILE, type StoredScheduler } from "../tools/overseer/store.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the unit has to land. `daemon-reload` reads this path and no other, which is the whole of S8-3. */
export const INSTALLED_UNIT = "/etc/systemd/system/overseer.service";
/** The checked-in source of truth, with `@USER@` still in it. */
export const UNIT_SOURCE = "infra/hetzner/systemd/overseer.service";
/** The arming file the unit requires. Created by provisioning, never by this command unless asked. */
export const ARMING_ENV_FILE = "/etc/overseer.env";
/** The systemd unit name. */
export const UNIT_NAME = "overseer";

/**
 * The unit as it must appear on the box.
 *
 * The same one substitution `provision.sh`'s `install_unit()` makes, and pure so
 * a test can assert the two agree without root. **`@USER@` must be gone**: a
 * unit installed with the placeholder still in it parses, installs, and then
 * fails to start with a message about a user that does not exist.
 */
export function substitutedUnit(source: string, user: string): { ok: true; text: string } | { ok: false; why: string } {
  if (user.trim() === "") return { ok: false, why: "no user name to substitute into the unit" };
  const text = source.split("@USER@").join(user);
  if (text.includes("@USER@")) return { ok: false, why: "the unit still contains @USER@ after substitution" };
  if (!text.includes(`EnvironmentFile=${ARMING_ENV_FILE}`)) {
    return { ok: false, why: `the unit does not read ${ARMING_ENV_FILE}, so arming it would have no effect on the daemon` };
  }
  return { ok: true, text };
}

/**
 * **THE VERDICT — the only thing that decides the exit code.**
 *
 * Pure, and separated from every effect above it, because the whole value of
 * this command is in what it refuses to call success. A verdict computed inside
 * the same function that ran the restart would be a verdict nobody could write a
 * test for, and the finding this command answers is precisely a sequence that
 * nobody had tested end to end.
 *
 * Every arm of it is a fact somebody could otherwise assume:
 *
 * - the **installed** unit matches what we meant to install (not the repo file —
 *   the one at `/etc/systemd/system/`, read back after writing it);
 * - systemd says the unit is **active**;
 * - a checkpoint was written **after the restart**, so the daemon answering is
 *   the new one rather than the one that was already there;
 * - and **every named job is eligible**, which is the difference between a
 *   process being up and the thing you asked for being scheduled.
 */
export type ActivationVerdict = { readonly ok: boolean; readonly problems: readonly string[]; readonly notes: readonly string[] };

export function activationVerdict(input: {
  readonly installedUnit: string | null;
  readonly expectedUnit: string;
  readonly systemdActive: boolean;
  readonly systemdDetail: string;
  readonly checkpointWrittenAt: string | null;
  /**
   * **WHAT THE RUNNING DAEMON ITSELF SAYS ABOUT ITS SCHEDULER**, out of the
   * checkpoint it just wrote.
   *
   * This is the only field here that is the *other* process's opinion rather
   * than this one's, and that is why it matters: everything else is this
   * checkout reasoning about what it thinks it installed. `blocked` — GPT Sol's
   * S8-7 arm — is a failure whatever else is true, because it means the daemon
   * came up, read its definitions, and found not one it could run.
   */
  readonly checkpointScheduler: StoredScheduler["kind"] | null;
  readonly restartedAt: string;
  readonly eligibility: readonly JobEligibility[];
  readonly requiredJobIds: readonly string[];
  readonly armed: boolean;
}): ActivationVerdict {
  const problems: string[] = [];
  const notes: string[] = [];

  if (input.installedUnit === null) {
    problems.push(`${INSTALLED_UNIT} does not exist, so systemd has no unit to run`);
  } else if (input.installedUnit !== input.expectedUnit) {
    // THE ONE S8-3 IS ABOUT. `daemon-reload` succeeded, `restart` succeeded, and
    // the bytes on the box are still the old ones.
    problems.push(
      `${INSTALLED_UNIT} is not the unit this checkout would install, so systemd is running something else — ` +
        "a daemon-reload rereads that path and never copies the repo file into it",
    );
  } else {
    notes.push(`${INSTALLED_UNIT} matches this checkout`);
  }

  if (!input.systemdActive) problems.push(`systemd does not report ${UNIT_NAME} as active: ${input.systemdDetail}`);
  else notes.push(`systemd reports ${UNIT_NAME} active`);

  if (input.checkpointWrittenAt === null) {
    problems.push("no checkpoint could be read after the restart, so nothing on the box has said what the new daemon believes");
  } else if (Date.parse(input.checkpointWrittenAt) < Date.parse(input.restartedAt)) {
    // A STALE CHECKPOINT LOOKS EXACTLY LIKE A FRESH ONE. It is a file with a
    // plausible timestamp in it, and reading it without this comparison is
    // reading the OLD daemon's opinion of a unit that no longer exists.
    problems.push(
      `the newest checkpoint was written at ${input.checkpointWrittenAt}, before the restart at ${input.restartedAt} — ` +
        "so it is the previous daemon's, and says nothing about the one just started",
    );
  } else {
    notes.push(`a checkpoint was written at ${input.checkpointWrittenAt}, after the restart`);
  }

  switch (input.checkpointScheduler) {
    case "blocked":
      problems.push("the new daemon's own checkpoint says BLOCKED: it is switched on and not one loaded job can run");
      break;
    case "unknown":
      problems.push("the new daemon's checkpoint makes no readable claim about its scheduler");
      break;
    case "off":
      // Correct when nothing was meant to be armed, and a failure when something
      // was: the file said 1 and the daemon disagrees, which is the S8-3 shape
      // arriving through the environment rather than through the unit.
      if (input.armed) problems.push(`${JOBS_ENABLED_VAR}=1 was written and the new daemon still reports its scheduler OFF`);
      else notes.push("the new daemon reports its scheduler OFF, which is what was asked for");
      break;
    case "armed":
      notes.push("the new daemon reports its scheduler ARMED with at least one runnable job");
      break;
    case null:
      problems.push("the new daemon's checkpoint carries no scheduler block");
      break;
    default: {
      const never: never = input.checkpointScheduler;
      throw new Error(String(never));
    }
  }

  const byId = new Map(input.eligibility.map((one) => [one.jobId, one]));
  for (const jobId of input.requiredJobIds) {
    const one = byId.get(jobId);
    if (one === undefined) problems.push(`${jobId} is not among the loaded job definitions at all`);
    else if (one.kind === "ineligible") problems.push(`${jobId} could not run: ${one.why}`);
    else notes.push(`${jobId} is eligible`);
  }

  // ARMING IS REPORTED, NEVER REQUIRED. This command's job is that the unit is
  // installed, running and honest; whether the box may spend money is Greg's
  // separate decision, and a command that failed unless armed would be one
  // nobody could use to check a deliberately disarmed box.
  notes.push(input.armed ? `${JOBS_ENABLED_VAR}=1: session jobs WILL be dispatched` : `${JOBS_ENABLED_VAR} is not "1": no session job will be dispatched`);

  return { ok: problems.length === 0, problems, notes };
}

/**
 * What is holding the store's lock, and whether it is the systemd unit.
 *
 * The tmux daemon has to be stopped before systemd starts, and identifying it by
 * **the lock** rather than by a tmux session name is deliberate: the lock is the
 * thing that actually collides, it names its holder's pid, and a session name is
 * a convention that has already changed once.
 */
export function lockHolderStanding(input: { storeDir: string; systemdMainPid: number | null }): {
  readonly kind: "free" | "systemd" | "other" | "unreadable";
  readonly pid: number | null;
  readonly why: string;
} {
  const read = readLock(join(input.storeDir, LOCK_FILE));
  if (read.kind === "absent") return { kind: "free", pid: null, why: "no Overseer holds the store lock" };
  if (read.kind === "unreadable") return { kind: "unreadable", pid: null, why: `the store lock could not be read: ${read.detail}` };
  const pid = read.holder.pid;
  if (!isProcessAlive(pid)) return { kind: "free", pid, why: `the lock names pid ${pid}, which is not running` };
  if (input.systemdMainPid !== null && input.systemdMainPid === pid) {
    return { kind: "systemd", pid, why: `the store lock is held by the systemd unit itself (pid ${pid})` };
  }
  return {
    kind: "other",
    pid,
    why: `the store lock is held by pid ${pid} (instance ${read.holder.instanceId}, since ${read.holder.startedAt}), which is NOT the systemd unit`,
  };
}

/** One line of the plan. Printed identically in both modes, so a dry run is a readable description of the real one. */
type PlanStep = { readonly what: string; readonly command?: string };

function main(argv: readonly string[]): number {
  const apply = argv.includes("--apply");
  const arm = argv.includes("--arm");
  const disarm = argv.includes("--disarm");
  if (arm && disarm) {
    console.error("--arm and --disarm cannot both be passed");
    return 2;
  }
  const storeDir = process.env["OVERSEER_STORE_DIR"] ?? join(process.env["HOME"] ?? "", ".overseer");
  const user = process.env["SUDO_USER"] ?? process.env["USER"] ?? "";

  console.log(apply ? "overseer-activate: APPLYING" : "overseer-activate: DRY RUN — nothing will be changed. Pass --apply to do it.");
  console.log("");

  // ── (1) PREFLIGHT. Everything that can be known without touching the box.
  const standing = standingJobs(REPO);
  const rules = ruleJobs(REPO);
  const definitions = [...standing.jobs, ...rules.jobs];
  const problems = [...standing.problems, ...rules.problems];
  // Under a FULL arming, because that is what the unit will be capable of. A
  // preflight that asked about the current process's capabilities would be
  // asking about the wrong process.
  const eligibility = eligibilityOf(definitions, { session: true, rules: true });
  const requiredJobIds = standing.jobs.map((job) => job.definition.behaviour.id);
  console.log("preflight");
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  for (const one of eligibility) {
    console.log(one.kind === "eligible" ? `  ✓ ${one.jobId} would be eligible` : `  ✗ ${one.jobId} would NOT be eligible: ${one.why}`);
  }
  if (problems.length > 0 || eligibility.some((one) => one.kind === "ineligible") || requiredJobIds.length === 0) {
    console.error("\nSTOPPING: the definitions this checkout builds cannot all run, so installing the unit would arm nothing.");
    return 1;
  }

  const source = readFileSync(join(REPO, UNIT_SOURCE), "utf8");
  const substituted = substitutedUnit(source, user);
  if (!substituted.ok) {
    console.error(`\nSTOPPING: ${substituted.why}`);
    return 1;
  }
  const installed = existsSync(INSTALLED_UNIT) ? readFileSync(INSTALLED_UNIT, "utf8") : null;
  console.log(
    installed === substituted.text
      ? `  ✓ ${INSTALLED_UNIT} is already exactly this unit`
      : `  · ${INSTALLED_UNIT} ${installed === null ? "does not exist" : "differs from this checkout"} and would be replaced`,
  );

  const armingFile = existsSync(ARMING_ENV_FILE) ? readFileSync(ARMING_ENV_FILE, "utf8") : null;
  // A MISSING ARMING FILE IS A BLOCKER, NOT AN EARLY RETURN. The unit reads it
  // with no `-`, so applying without one installs a unit systemd refuses to
  // start — but a dry run that stopped here would hide the rest of the plan from
  // the person deciding whether to run it, and the plan is what a dry run is
  // for. So it is recorded, the plan is printed with the fix in it, and `--apply`
  // refuses below.
  const blockers: string[] = [];
  if (armingFile === null && !(arm || disarm)) {
    blockers.push(
      `${ARMING_ENV_FILE} does not exist, and the unit reads it with no leading "-", so systemd would refuse to start. ` +
        "Run infra/hetzner/provision.sh, or add --disarm to have this command create it disarmed.",
    );
  }
  const armedNow = new RegExp(`^${JOBS_ENABLED_VAR}=1\\s*$`, "m").test(armingFile ?? "");
  const armedAfter = arm ? true : disarm ? false : armedNow;
  console.log(`  · ${ARMING_ENV_FILE}: ${armedNow ? "ARMED" : "disarmed"}${armedAfter === armedNow ? "" : ` → ${armedAfter ? "ARMED" : "disarmed"}`}`);

  const mainPid = systemdMainPid();
  const holder = lockHolderStanding({ storeDir, systemdMainPid: mainPid });
  console.log(`  · ${holder.why}`);

  // ── (2) THE PLAN, in the order that matters.
  const steps: PlanStep[] = [];
  if (armedAfter !== armedNow || armingFile === null) steps.push({ what: `write ${ARMING_ENV_FILE} with ${JOBS_ENABLED_VAR}=${armedAfter ? "1" : "0"}` });
  if (installed !== substituted.text) steps.push({ what: `install the substituted unit atomically`, command: `install -o root -g root -m 0644 <tmp> ${INSTALLED_UNIT}` });
  if (holder.kind === "other" && holder.pid !== null) {
    steps.push({ what: `stop the non-systemd Overseer holding the store lock FIRST, so the new one does not lose it`, command: `kill -TERM ${holder.pid}` });
  }
  steps.push({ what: "reload systemd's view of the unit files", command: "systemctl daemon-reload" });
  steps.push({ what: `make ${UNIT_NAME} survive a reboot`, command: `systemctl enable ${UNIT_NAME}` });
  steps.push({ what: `restart ${UNIT_NAME}`, command: `systemctl restart ${UNIT_NAME}` });
  steps.push({ what: "wait for a checkpoint written AFTER the restart, then verify the unit, systemd, the checkpoint and both jobs" });
  console.log("\nplan");
  for (const [index, step] of steps.entries()) console.log(`  ${index + 1}. ${step.what}${step.command === undefined ? "" : `\n       ${step.command}`}`);

  for (const blocker of blockers) console.error(`\n✗ ${blocker}`);
  if (!apply) {
    console.log(
      blockers.length === 0
        ? "\nDry run: nothing was changed. Re-run with --apply (as root) to do the above."
        : "\nDry run: nothing was changed, and the above would refuse to apply until the ✗ is fixed.",
    );
    return blockers.length === 0 ? 0 : 1;
  }
  if (blockers.length > 0) {
    console.error("\nSTOPPING: applying now would install a unit systemd cannot start.");
    return 1;
  }

  // ── (3) THE EFFECTS. Everything below here needs root.
  if (armedAfter !== armedNow || armingFile === null) {
    const body =
      `# Whether the Overseer may dispatch its standing jobs. Exactly "1" arms it.\n` +
      `# Written by scripts/overseer-activate.ts at ${new Date().toISOString()}.\n` +
      `${JOBS_ENABLED_VAR}=${armedAfter ? "1" : "0"}\n`;
    const written = installAtomically(ARMING_ENV_FILE, body);
    if (!written.ok) {
      console.error(`✗ could not write ${ARMING_ENV_FILE}: ${written.why}`);
      return 1;
    }
    console.log(`✓ wrote ${ARMING_ENV_FILE}`);
  }
  if (installed !== substituted.text) {
    const written = installAtomically(INSTALLED_UNIT, substituted.text);
    if (!written.ok) {
      console.error(`✗ could not install the unit: ${written.why}`);
      return 1;
    }
    console.log(`✓ installed ${INSTALLED_UNIT}`);
  }
  if (holder.kind === "other" && holder.pid !== null) {
    // BEFORE THE RESTART, and waited for. A systemd start that loses this lock
    // exits, `Restart=always` starts it again, and ten of those inside 300s
    // leaves the unit `failed` — with the real cause five layers down.
    try {
      process.kill(holder.pid, "SIGTERM");
    } catch (cause) {
      console.error(`✗ could not signal pid ${holder.pid}: ${cause instanceof Error ? cause.message : String(cause)}`);
      return 1;
    }
    const freed = waitFor(() => lockHolderStanding({ storeDir, systemdMainPid: mainPid }).kind === "free", 30_000);
    if (!freed) {
      console.error(`✗ pid ${holder.pid} still holds the store lock 30s after SIGTERM; not restarting systemd into a lock fight`);
      return 1;
    }
    console.log(`✓ the previous Overseer (pid ${holder.pid}) released the store lock`);
  }

  const restartedAt = new Date().toISOString();
  for (const args of [["daemon-reload"], ["enable", UNIT_NAME], ["restart", UNIT_NAME]]) {
    const ran = spawnSync("systemctl", args, { encoding: "utf8" });
    if (ran.status !== 0) {
      console.error(`✗ systemctl ${args.join(" ")} failed: ${(ran.stderr ?? "").trim() || `exit ${String(ran.status)}`}`);
      return 1;
    }
  }
  console.log(`✓ systemctl daemon-reload, enable, restart`);

  // ── (4) THE VERIFICATION, which is the point of the whole file.
  waitFor(() => {
    const at = readCheckpoint(storeDir).writtenAt;
    return at !== null && Date.parse(at) >= Date.parse(restartedAt);
  }, 60_000);
  const checkpoint = readCheckpoint(storeDir);
  const active = spawnSync("systemctl", ["is-active", UNIT_NAME], { encoding: "utf8" });
  const verdict = activationVerdict({
    installedUnit: existsSync(INSTALLED_UNIT) ? readFileSync(INSTALLED_UNIT, "utf8") : null,
    expectedUnit: substituted.text,
    systemdActive: (active.stdout ?? "").trim() === "active",
    systemdDetail: `${(active.stdout ?? "").trim()}${(active.stderr ?? "").trim() === "" ? "" : ` (${(active.stderr ?? "").trim()})`}`,
    checkpointWrittenAt: checkpoint.writtenAt,
    checkpointScheduler: checkpoint.scheduler,
    restartedAt,
    // Read back from the running daemon's own definitions, not recomputed: this
    // process and that one are different checkouts' worth of risk apart.
    eligibility,
    requiredJobIds,
    armed: armedAfter,
  });
  console.log("");
  for (const note of verdict.notes) console.log(`  ✓ ${note}`);
  for (const problem of verdict.problems) console.error(`  ✗ ${problem}`);
  console.log(verdict.ok ? "\noverseer-activate: OK" : "\noverseer-activate: FAILED — the unit is NOT verifiably running what you asked for");
  return verdict.ok ? 0 : 1;
}

/** Root-owned, 0644, and atomic — the same recipe `provision.sh`'s `install_unit()` uses, for the same reason. */
function installAtomically(path: string, text: string): { ok: true } | { ok: false; why: string } {
  try {
    const dir = mkdtempSync(join(tmpdir(), "overseer-activate-"));
    const temporary = join(dir, "unit");
    writeFileSync(temporary, text, "utf8");
    execFileSync("install", ["-o", "root", "-g", "root", "-m", "0644", temporary, path]);
    return { ok: true };
  } catch (cause) {
    return { ok: false, why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** The unit's MainPID, or null. Used only to tell "the lock is held by us" from "the lock is held by the tmux job". */
function systemdMainPid(): number | null {
  const shown = spawnSync("systemctl", ["show", UNIT_NAME, "-p", "MainPID", "--value"], { encoding: "utf8" });
  const pid = Number((shown.stdout ?? "").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * What the newest checkpoint says — when it was written, and what its daemon
 * thinks of its own scheduler.
 *
 * Read off the file rather than through `openStore`, which would take the lock
 * this command has just spent thirty seconds making sure is free.
 */
function readCheckpoint(storeDir: string): { readonly writtenAt: string | null; readonly scheduler: StoredScheduler["kind"] | null } {
  const path = join(storeDir, CHECKPOINT_FILE);
  if (!existsSync(path)) return { writtenAt: null, scheduler: null };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const at = parsed["writtenAt"];
    const scheduler = (parsed["scheduler"] as Record<string, unknown> | undefined)?.["kind"];
    return {
      writtenAt: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? at : null,
      scheduler: scheduler === "armed" || scheduler === "blocked" || scheduler === "off" || scheduler === "unknown" ? scheduler : null,
    };
  } catch {
    return { writtenAt: null, scheduler: null };
  }
}

/** Poll until a condition holds or the budget runs out. Synchronous on purpose: this command has nothing else to do while it waits. */
function waitFor(condition: () => boolean, budgetMs: number): boolean {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    // A busy loop with a real sleep in it. `Atomics.wait` blocks the thread
    // without a timer, which is what this wants: there is no event loop work to
    // let through.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  return condition();
}

// THE ARMING RECORD (`armed.json`, `tools/overseer/arming.ts`) IS DELIBERATELY
// NOT TOUCHED HERE. It is reconciled by the daemon on its own start, and writing
// it from this process would put a root-owned file into a store the daemon owns
// as $USER — which the daemon would then fail to update, quietly, from the next
// restart onwards.
if (process.argv[1]?.endsWith("overseer-activate.ts") === true) {
  process.exitCode = main(process.argv.slice(2));
}
