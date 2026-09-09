/**
 * **WHEN each standing job runs — the one file to edit, and editing it re-pins
 * nothing.**
 *
 * > Yes, I'm thinking get-ready-to-deploy every 6h, and feedback-sweep every 3h
 * > (perhaps offset so they don't bump into each other). Ideally these would be
 * > written in some config somewhere that would be easy to edit, with an
 * > idempotent script to update them.
 * >
 * > — Greg, 2026-09-08
 *
 * ## Why editing a number here costs nothing, and why that took a review
 *
 * Until 2026-09-09 the cadence was a hashed field of the job definition, so
 * changing it moved the job's fingerprint and the scheduler refused the job
 * until somebody re-pinned it. The plan's answer was a script that recomputed
 * the pins — and GPT Sol's S8-1 blocked it by quoting `scripts/overseer-pins.ts`
 * back at its own author: *"an authorisation the authorised party can write is
 * not one, and a script that edited the literal would be exactly that."* A
 * schedule edit riding beside a prompt or document edit would have blessed both.
 *
 * So the fingerprint was split instead. **`JobBehaviour` — the instruction, the
 * work kind and the authoritative documents — is what gate 3 is about, and it
 * stays hashed and hand-pinned.** This file is the other half: cadence, lease
 * and first-run delay change *when* a job runs, not *what* it does, so they are
 * outside the fingerprint entirely. `tools/overseer/jobs.ts` § JobBehaviour has
 * the full argument.
 *
 * **What still guards an abusive number is this file's own validation** (Sol's
 * instruction, verbatim: *"Protect abusive schedule values through validation
 * and Gate 4, rather than turning a convenience script into an authority-
 * granting tool"*). `validateSchedules` below is not advisory: a config that
 * fails it produces no jobs at all, so a typo disarms rather than dispatches.
 *
 * ## A TypeScript module rather than JSON
 *
 * Sol's call, and it is the right one: comments survive, `hours(6)` reads at 3am
 * where `21600000` does not, and the two job ids come from this object's own
 * keys — so a third entry here is a compile error in `standing-jobs.ts` until
 * somebody writes the job and pins it. No dependency, no parser, no second
 * schema.
 */

/** Milliseconds in `n` hours. Exported because a test and a doc should read the same way this file does. */
export function hours(n: number): number {
  return n * 3_600_000;
}

/** Milliseconds in `n` minutes. */
export function minutes(n: number): number {
  return n * 60_000;
}

/**
 * WHEN one job runs. Not hashed, not pinned, and a person may edit it freely.
 *
 * Every field is a duration in milliseconds, and every one of them is about the
 * clock. There is deliberately nothing here about what the job does: if a field
 * would change the work rather than its timing, it belongs in `JobBehaviour`
 * where the fingerprint can see it.
 */
export type ScheduleConfig = {
  /**
   * The cadence, measured from the END of the last run rather than from a
   * wall-clock boundary — `jobs.ts` § `due` says why, and what drift that
   * accepts.
   */
  readonly everyMs: number;
  /**
   * How long a run may be unsettled before the scheduler stops believing it is
   * coming back and releases the job.
   *
   * **It is in the schedule rather than in the behaviour, and it costs nothing
   * to put it there** — which is not what this comment used to say. It claimed
   * "a shortened lease lets a second session start while the first is still
   * running". **That is false, and the arithmetic is two functions away:**
   * `lastRunOf` turns a stuck occurrence into `{kind: "unresolved", at:
   * reservedAt}`, and `due` then measures `everyMs` from that `at` exactly as it
   * does for a settled run. So a stuck job's next launch is at
   * `reservedAt + max(leaseMs, everyMs)`. **Shortening the lease below the
   * cadence is a no-op on launch timing**; all it does is surface the `stuck`
   * report sooner, which is the direction you want.
   *
   * The lease is therefore a knob about the **launcher**, not about the job: it
   * catches a hung `gjd-remote` (see `dispatch.ts` on the open-stdin case). In
   * the ordinary path it is never consulted at all, because the launcher exits
   * within seconds and the occurrence settles then — the six-hour Claude session
   * that follows is invisible to the ledger.
   *
   * **What actually decides whether two sessions coexist is `everyMs` against
   * how long a session really runs**, and that knob is outside the fingerprint
   * too, on GPT Sol's explicit instruction (S8-1). Hashing the lease would put a
   * ceremony on a knob that guards nothing while the one carrying the real
   * exposure stayed free — a guard describing coverage it does not provide,
   * which is the shape gate 4's own NOT BUILT note exists to warn about.
   *
   * The real duplicate-session guard is already in the right place and is
   * pinned: `FEEDBACK_SWEEP_PROMPT` tells the session to check `gjd-remote ls`
   * for its own claim prefix before doing anything. `GET_READY_TO_DEPLOY_PROMPT`
   * has no such self-check — if a seven-hour deploy sweep beside a fresh one
   * matters, that is the one-line change worth making, and it correctly costs a
   * re-pin.
   *
   * Settled by Fable on 2026-09-09, against my own instinct, and the arithmetic
   * above was verified in `jobs.ts` rather than taken on trust.
   */
  readonly leaseMs: number;
  /**
   * How long after ARMING — not after process start — this job's first run may
   * happen.
   *
   * Zero is legitimate and means *as soon as the daemon is armed*. The anchor is
   * the durable `armedAt` in `arming.ts`; anchoring to process start would
   * postpone the first run on every restart, for ever, which is GPT Sol's S8-6.
   */
  readonly initialDelayMs: number;
};

/**
 * **THE SCHEDULES. This is the object to edit.**
 *
 * `satisfies` rather than a type annotation so the keys stay literal, which is
 * what lets `StandingJobId` below be derived from them rather than written out a
 * second time. Adding a key here is a compile error in `standing-jobs.ts`'s
 * behaviour table and in its `AUTHORISED_HASHES`, so a new schedule cannot
 * arrive without a job and a pin.
 */
export const STANDING_JOB_SCHEDULES = {
  /**
   * Every 6 hours, per Greg above. `docs/reusable/get-ready-to-deploy.md`
   * § Running it on a timer says "every three hours or so"; Greg asked for six
   * when he asked for the scheduler, and the person who wants the deploys wins.
   */
  "get-ready-to-deploy": {
    everyMs: hours(6),
    leaseMs: hours(6),
    // Half an hour after arming, so the first thing an armed box does is nothing
    // for long enough that somebody can watch it and change their mind.
    initialDelayMs: minutes(30),
  },
  /**
   * Every 3 hours, per Greg above — up from the 12 hours that
   * `docs/project/overseer.md`'s "a couple of times a day" produced.
   */
  "feedback-sweep": {
    everyMs: hours(3),
    leaseMs: hours(6),
    // An hour after the other one, so the FIRST pair of runs is separated by
    // more than the launch-spacing gate would have to enforce. The gate below is
    // what actually keeps them apart afterwards; this only makes the opening
    // move tidy.
    initialDelayMs: minutes(90),
  },
} satisfies Record<string, ScheduleConfig>;

/**
 * The standing jobs there are, **derived from the config's own keys**.
 *
 * Sol asked for exactly this: one home for the fact. A hand-written union beside
 * the object would be a second copy that can disagree with it, and the thing it
 * would be enforcing — "these two ids and no others" — is already enforced by
 * every `Record<StandingJobId, …>` downstream.
 */
export type StandingJobId = keyof typeof STANDING_JOB_SCHEDULES;

/**
 * **THE MINIMUM GAP BETWEEN TWO SESSION LAUNCHES, and it is not a phase offset.**
 *
 * The plan said "once separated they stay separated" and GPT Sol's S8-5 showed
 * that is false: after downtime both jobs are overdue in the same tick, a stuck
 * occurrence reschedules from its reservation rather than its phase, and the
 * outcome the ledger records is the short-lived `gjd-remote` launcher exiting
 * rather than the detached session finishing. A one-shot offset survives none of
 * that.
 *
 * The invariant that does survive is this one: **no two session launches inside
 * half an hour**, enforced against the durable ledger on every tick, so it holds
 * across restarts and across catch-up. The second job is left `waiting for
 * spacing` — a state a reader can see in the log — rather than silently skipped.
 *
 * Rules are not gated by it: they run in-process, cost nothing, and the thing
 * being rationed here is a Claude session on a shared box.
 */
export const LAUNCH_SEPARATION_MS = minutes(30);

/**
 * The bounds a schedule has to be inside. **The replacement for the re-pin**, and
 * therefore not decoration.
 *
 * Each is a floor or a ceiling on a number a person types at 3am, and the
 * direction of each is the direction that costs money or hides a fault: too
 * short a cadence spends, too long a lease wedges a job for a day, too short a
 * lease permits overlap.
 */

/**
 * **AN HOUR, AND THE FLOOR IS DOING THE WORK GATE 4 IS NOT DOING YET.**
 *
 * It was fifteen minutes for about an hour of this stage, which is what you pick
 * when you are writing bounds rather than thinking about what they cost. Two
 * jobs at fifteen minutes is 192 Claude sessions a day; the schedules Greg
 * actually asked for are twelve. Sol's S8-2 is explicit that a per-component
 * "locally sensible number" is not a budget, and gate 4's shared reservation is
 * unbuilt — so until it exists this number is the only thing between a mistyped
 * `hours(6)` and a day's subscription. An hour makes the worst case 48, which is
 * still bad and is at least the same order as the intended twelve.
 *
 * **It is not a budget and must not be mistaken for one.** Raise it, or lower it
 * once gate 4 exists and the real ceiling lives there.
 */
export const MINIMUM_EVERY_MS = hours(1);
export const MAXIMUM_EVERY_MS = hours(24 * 7);
/**
 * **THE FLOOR HERE GUARDS ALMOST NOTHING, AND THE CEILING IS THE ONE THAT MATTERS.**
 *
 * This comment used to say the floor guarded overlap. It does not: the effective
 * floor on when a stuck job is released is `MINIMUM_EVERY_MS`, because `due`
 * measures `everyMs` from the unresolved occurrence's `reservedAt` — see
 * `ScheduleConfig.leaseMs` for the walk-through, and `jobs.ts` for the two lines
 * that decide it. A lease shorter than the cadence changes no launch time.
 *
 * So this floor's only honest job is refusing `0` and typos. Anything from a few
 * minutes upward is fine, and **lower is arguably better**, because a hung
 * launcher then shows up in the `stuck` report sooner.
 *
 * **`MAXIMUM_LEASE_MS` is the bound worth caring about.** A 24-hour lease on a
 * 3-hour job hides a hung `gjd-remote` for a day — the failure this lease exists
 * to catch, defeated by its own configuration.
 */
export const MINIMUM_LEASE_MS = hours(1);
export const MAXIMUM_LEASE_MS = hours(24);
export const MAXIMUM_INITIAL_DELAY_MS = hours(24);

/**
 * Check a schedule table against the ids that are supposed to be in it.
 *
 * **Fatal rather than advisory**, and the caller enforces that: `standingJobs`
 * builds no jobs at all when this returns anything, so a malformed number
 * disarms the scheduler instead of arming it with a wrong one. Every arm Sol
 * named is here — missing, malformed, non-finite, non-positive, unknown — plus
 * the bounds above.
 *
 * Duplicate keys are not checkable at runtime and do not need to be: a
 * TypeScript object literal with a repeated key does not compile, which is a
 * stronger guarantee than a check here could give.
 *
 * `Readonly<Record<string, unknown>>` rather than the config's own type on
 * purpose: a validator typed as its own input can only ever prove things the
 * compiler already proved, and this one has to be able to say `everyMs is not a
 * number` about a value that reached it anyway.
 */
export function validateSchedules(
  schedules: Readonly<Record<string, unknown>>,
  expectedIds: readonly string[],
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const id of Object.keys(schedules)) {
    seen.add(id);
    if (!expectedIds.includes(id)) {
      problems.push(`the schedule config names ${id}, which is not a job this build knows about`);
      continue;
    }
    const schedule = schedules[id];
    if (schedule === null || typeof schedule !== "object") {
      problems.push(`the schedule for ${id} is not an object`);
      continue;
    }
    const record = schedule as Readonly<Record<string, unknown>>;
    problems.push(...duration(id, "everyMs", record["everyMs"], MINIMUM_EVERY_MS, MAXIMUM_EVERY_MS));
    problems.push(...duration(id, "leaseMs", record["leaseMs"], MINIMUM_LEASE_MS, MAXIMUM_LEASE_MS));
    // ZERO IS ALLOWED HERE AND NOWHERE ELSE. "Run as soon as we are armed" is a
    // legitimate thing to ask for; "run every 0ms" and "give up on a run after
    // 0ms" are not, and folding the three into one rule would have permitted
    // both of the latter.
    problems.push(...duration(id, "initialDelayMs", record["initialDelayMs"], 0, MAXIMUM_INITIAL_DELAY_MS));
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) problems.push(`the schedule config has no entry for ${id}, so that job cannot be scheduled`);
  }
  return problems;
}

/**
 * The launch-spacing gap, checked against the schedules it has to coexist with.
 *
 * A separation longer than the shortest cadence is not a slow scheduler, it is a
 * **starved** one: the job that loses the tie would never reach its own interval
 * before the other launched again. So it is refused rather than clamped —
 * clamping would silently run a schedule nobody chose.
 */
export function validateLaunchSeparation(separationMs: number, schedules: Readonly<Record<string, ScheduleConfig>>): readonly string[] {
  const problems = [...duration("launch spacing", "separationMs", separationMs, 0, hours(6))];
  if (problems.length > 0) return problems;
  const shortest = Math.min(...Object.values(schedules).map((schedule) => schedule.everyMs));
  if (Number.isFinite(shortest) && separationMs >= shortest) {
    problems.push(
      `the launch spacing (${separationMs}ms) is at least as long as the shortest cadence (${shortest}ms), ` +
        "so one job would be starved by the other rather than merely delayed",
    );
  }
  return problems;
}

/** One duration field, against its bounds. The three failure sentences say which of the three it was, because they lead to different edits. */
function duration(id: string, field: string, value: unknown, min: number, max: number): readonly string[] {
  if (value === undefined) return [`${id} has no ${field}`];
  if (typeof value !== "number") return [`${id}'s ${field} is ${JSON.stringify(value)}, which is not a number`];
  if (!Number.isFinite(value)) return [`${id}'s ${field} is ${String(value)}, which is not a finite number`];
  if (value < min) return [`${id}'s ${field} is ${value}ms, below the ${min}ms floor this build will schedule`];
  if (value > max) return [`${id}'s ${field} is ${value}ms, above the ${max}ms ceiling this build will schedule`];
  return [];
}
