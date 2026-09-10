/**
 * Job occurrences: the identity, the states, and the two clocks that decide
 * whether one may run.
 *
 * **Pure. No I/O, no `Date.now()`, no `process`.** Everything here is a function
 * of its arguments, so a test can produce any interleaving of crash, restart and
 * hung child without a filesystem or a timer. The side effects live in
 * `scheduler.ts`; the durability lives in `store.ts`; this file is only the
 * arithmetic and the vocabulary.
 *
 * ## Why an occurrence has an identity at all
 *
 * The plan claimed the store's three-write ordering already gave scheduled jobs
 * an identity, and GPT Sol's S5 showed it does not: those writes protect
 * *snapshot differencing*, and have no relationship with process creation. So a
 * run gets a **key** — `(job id, scheduled instant, authorised-behaviour hash)`
 * — recorded durably before anything is spawned, and every later fact about that
 * run is addressed by it.
 *
 * ## Two things a hash was doing, and only one of them was its job
 *
 * The behaviour hash used to do double duty: it identified which version of a
 * job a run belonged to, AND `lastRunOf` used it to decide which runs counted
 * toward the next one's cadence. Three findings, in order, are why it now does
 * only the first.
 *
 * **C2 — history separation is not authorisation.** A definition with no history
 * reads as `never`, `due()` called `never` immediately due, and so **editing a
 * job dispatched the edited version at once** — the exact opposite of the
 * runbook's *never act on a job definition that changed after it was
 * authorised*. "Being in the key is not equivalent to comparing against an
 * authorisation." So the authorisation became a **separate, pinned fingerprint**
 * carried beside the definition (`AuthorisedJob`), and a mismatch is its own
 * state (`Authorisation`) that the scheduler refuses on, loudly, BEFORE it asks
 * anything about the clock.
 *
 * **S8-4 — and then the filter had nothing left to protect and one thing left to
 * break.** With the gate in front of it, skipping old-hash occurrences bought no
 * safety at all and cost this: a re-pin made every prior run vanish from the
 * cadence calculation, so the job read as `never` and dispatched at once — over
 * the top of a session the previous pin had launched minutes earlier, because an
 * unsettled occurrence was hidden by the same filter. **Lineage is the job id
 * now**, and the hash stays on the key for audit.
 *
 * **S8-1 — and the hash covers less than it used to.** Cadence, lease and
 * first-run delay are `ScheduleConfig`'s, not `JobBehaviour`'s, so editing a
 * schedule moves no pin. See `JobBehaviour` below and `schedules.ts`.
 *
 * ## The five states, and the one that matters
 *
 * `reserved` → `started` → `finished`, with `refused` for a dispatch that never
 * happened and **`unknown` for the one the ordering cannot rescue.**
 *
 * Sol's crash-window table is explicit that writing the reservation first does
 * not make the spawn window rarer — it makes the pre-spawn record durable. So
 * after a crash there is a shape on disk, `reserved` and nothing after it, that
 * means *either* "we never got as far as spawning" *or* "we spawned and died
 * before we could say so", and **nothing on the box can tell those apart.**
 * That shape is `unknown`, it is never retried automatically, and the honest
 * thing this module does is refuse to let a consumer flatten it: it is an arm of
 * a union, not a `null` in a slot that also holds a timestamp.
 *
 * ## `stuck` is not a sixth state; it is a state read against a clock
 *
 * S6: the daemon's existing overlap guard is an in-memory promise, so a job
 * whose work never settles leaves that field non-null for ever. Every later tick
 * then *correctly* declines to overlap, the heartbeat stays green, and the job
 * never runs again — a dead job wearing a green light. The lease is the fix: an
 * occurrence carries a `leaseUntil` written down at reservation, and one still
 * unsettled past it is `stuck`. `stuck` is loud (`standingOf` gives it its own
 * arm, and the scheduler reports it) and it is **releasing** — the job is free to
 * have its next occurrence — because a guard that can only ever tighten is the
 * bug this replaces.
 *
 * The lease deadline is stored on the occurrence rather than recomputed from
 * `leaseMs`, so editing a definition cannot retroactively move a lease that is
 * already running.
 */
import { createHash } from "node:crypto";

import type { OverseerEvent } from "./diff.js";
import type { LaunchOccurrenceId, RunSpec } from "./launch-protocol.js";
import { canonicalRuleSpec, type RuleSpec } from "./rules.js";
import type { ScheduleConfig } from "./schedules.js";

/**
 * **A SESSION JOB'S RUN SPEC: its timeout and its access profile, and nothing
 * else.** It is the launch protocol's `RunSpec` less its `account` (the plan's
 * M11). Which pool account runs an occurrence is chosen by the scheduler at plan
 * time and pinned in the launch record, not authorised per job, so it is not
 * here and not in `behaviourHash`. The scheduler adds it when it plans
 * (`scheduler.ts` § `planSession`).
 *
 * Its own name, so a job's spec cannot be mistaken for the protocol's, which a
 * launch needs whole. A `Pick` rather than an `Omit`, so a field the protocol
 * adds later stays out of the job's authority until somebody decides it belongs.
 */
export type JobRunSpec = Pick<RunSpec, "timeoutMinutes" | "access">;

/**
 * WHAT A JOB ACTUALLY IS, and it is in the fingerprint.
 *
 * Two arms, because two things wear the word "job": one starts a Claude session
 * on the box and one runs a deterministic rule inside the daemon. They differ
 * in what they cost, in what they may do, and in who dispatches them, so they
 * are a discriminated union rather than a flag beside a nullable spec.
 *
 * **`rule` carries its whole configuration**, which is GPT Sol's SP-1: a
 * dispatcher that selected executable code by `definition.id` would leave the
 * authorised pin valid across a changed threshold or a changed action. The spec
 * is data, `behaviourHash` hashes it, and a moved knob refuses the job.
 */
export type JobWork =
  /**
   * A Claude session, started through the launch protocol. What the standing
   * jobs are.
   *
   * **`run` is part of the authorised behaviour** (plan 260910f scheduled
   * dispatch, § D4): the timeout and the access profile an unattended session
   * gets are things Greg authorised, so moving either one re-pins. Which POOL
   * ACCOUNT it runs on is deliberately not here: that is a runtime choice the
   * scheduler makes at plan time, not authority — see `JobRunSpec`.
   */
  | { readonly kind: "session"; readonly run: JobRunSpec }
  /** A deterministic rule, run in process by the scheduler's two-phase protocol. No model calls, no session. */
  | { readonly kind: "rule"; readonly rule: RuleSpec };

/**
 * **WHETHER A DUE JOB MAY ACTUALLY START ANYTHING — and it is in the
 * fingerprint.**
 *
 * `live` is every job that shipped before 2026-09-10. `dry-run` goes through
 * every gate the scheduler has — the history, the pin, the clock — and where a
 * live job would reserve, it reports *due now; dry-run, so nothing is reserved
 * or launched* instead, and **writes nothing to the ledger**: a last attempt
 * that never happened would corrupt the one record whose value is that it can
 * be believed. It never counts against the launch-spacing gate, and
 * `eligibilityOf` does not let it earn `ARMED`.
 *
 * **Hashed, not scheduled**, and that is GPT Sol's P1-3 on plan 260910e: the
 * clock fields are outside the fingerprint because they change only *when* a
 * job runs, and dry-run → live changes *whether an unattended Claude session
 * may start at all*. That is gate 3's question, not S8-1's, so moving this
 * field is a re-pin like moving a prompt.
 *
 * The `why` is hashed as well as the kind. It is prose, so that costs a re-pin
 * on a reworded reason; the alternative was a field of a hashed type that the
 * hash quietly does not read, which is the SC-4 shape this module refuses
 * everywhere else.
 */
export type JobDispatch = { readonly kind: "live" } | { readonly kind: "dry-run"; readonly why: string };

/** The canonical form of the dispatch mode. Exhaustive for the reason `canonicalWork` is. */
function canonicalDispatch(dispatch: JobDispatch): string {
  switch (dispatch.kind) {
    case "live":
      return "dispatch:live";
    case "dry-run":
      return `dispatch:dry-run:${dispatch.why.length}:${dispatch.why}`;
    default: {
      const never: never = dispatch;
      throw new Error(`no canonical form for job dispatch ${JSON.stringify(never)}`);
    }
  }
}

/**
 * A job definition narrowed to the rule arm, at the type level.
 *
 * This is half of what makes the deterministic-only arming path structural
 * rather than a filter (SP-4): `ruleJobs()` returns these, so a session job
 * cannot be handed to that path without changing a declared type, which is a
 * visible edit rather than something a future job falls through. The other half
 * is that the path supplies no launch protocol at all — see `scheduler.ts` §
 * `TickInput.launch`.
 */
export type RuleJobDefinition = JobDefinition & { readonly behaviour: { readonly work: Extract<JobWork, { kind: "rule" }> } };

/** An authorised job whose work is a rule, by construction. `authorisedDocuments` as on `AuthorisedJob`. */
export type AuthorisedRuleJob = {
  readonly definition: RuleJobDefinition;
  readonly authorisedHash: BehaviourHash;
  readonly authorisedDocuments: readonly JobDocument[];
};

/**
 * The canonical form of a job's work.
 *
 * Exhaustive on purpose: a third arm stops this compiling, which is the only
 * thing that stops a new kind of job being invisible to the fingerprint that
 * authorises it.
 */
function canonicalWork(work: JobWork): string {
  switch (work.kind) {
    case "session":
      return `work:session\n${canonicalRun(work.run)}`;
    case "rule":
      return `work:rule\n${canonicalRuleSpec(work.rule)}`;
    default: {
      const never: never = work;
      throw new Error(`no canonical form for job work ${JSON.stringify(never)}`);
    }
  }
}

/**
 * HOW EACH FIELD OF A JOB'S RUN SPEC IS ENCODED — the compiler counts them, for
 * the reason `BEHAVIOUR_ENCODERS` gives: a field added to `JobRunSpec` is a
 * compile error here until somebody writes its encoder. What is authority at
 * all is decided once, by `JobRunSpec`'s `Pick` — which is why the protocol's
 * `account` is not here.
 */
const RUN_ENCODERS: { readonly [K in keyof JobRunSpec]-?: (value: JobRunSpec[K]) => string } = {
  timeoutMinutes: (minutes) => `timeoutMinutes:${minutes}`,
  access: (access) => `access:${access.length}:${access}`,
};

function canonicalRun(run: JobRunSpec): string {
  return ["run", RUN_ENCODERS.timeoutMinutes(run.timeoutMinutes), RUN_ENCODERS.access(run.access)].join("\n");
}

/**
 * **WHAT A JOB DOES. This, and only this, is what gate 3 authorises.**
 *
 * The split from `ScheduleConfig` is GPT Sol's S8-1, and it is the reason
 * `tools/overseer/schedules.ts` can be edited by hand without disarming
 * anything. What lives here changes what the box does: the instruction it runs,
 * the kind of work it is, the documents that instruction leans on, and whether
 * a due run may start anything at all (`dispatch`, since 2026-09-10). What
 * lives in the schedule changes only *when* — and when is not a thing an
 * authorisation should be spent on.
 *
 * The old shape hashed cadence and lease as well, so editing a number refused
 * the job until somebody re-pinned it; the plan's answer was a script that
 * recomputed the pin from the WHOLE definition, which would have blessed a
 * prompt edit riding beside a schedule edit. `scripts/overseer-pins.ts` forbids
 * exactly that in its own header. Splitting is the better fix rather than merely
 * the safer one: the fingerprint now identifies one thing instead of two.
 *
 * `what` is **the authorised instruction** — the prompt or command that will
 * actually be run — and it is in the hash for that reason: changing it changes
 * what the box does, so it must change the identity of the runs that follow.
 * A job whose `what` was edited between authorisation and dispatch is a
 * different job, and the runbook's rule ("nothing dispatched that Greg did not
 * queue") has no meaning otherwise.
 */
export type JobBehaviour = {
  readonly id: string;
  /** The authorised instruction. In the hash, because editing it is what the hash exists to detect. */
  readonly what: string;
  /**
   * THE DOCUMENTS THIS JOB'S AUTHORITY ACTUALLY COMES FROM, by digest.
   *
   * The standing jobs *are* documents — `what` is a sentence telling a session
   * to go and follow one — so without this the fingerprint covers the pointer
   * and not the thing pointed at, and the runbook's own warning applies word for
   * word: *"The jobs here are documents, so editing a doc could otherwise
   * enlarge what you may do unattended."*
   * (docs/project/overseer.md § gate 3.)
   *
   * Empty is a legitimate answer — a job whose instruction is self-contained —
   * and it is required rather than optional so that a new job has to say so.
   */
  readonly documents: readonly JobDocument[];
  /**
   * WHAT THIS JOB IS — a session to start, or a rule to run — with every knob
   * the rule has.
   *
   * Required rather than optional, and hashed: an optional field defaulting to
   * `session` would make "somebody has not decided yet" and "this starts a
   * Claude session" the same value, which is the bag-of-optionals shape the
   * rest of this module refuses.
   */
  readonly work: JobWork;
  /**
   * WHETHER A DUE RUN STARTS ANYTHING — `live`, or `dry-run` with the reason.
   * Required for the reason `work` is, and hashed: see `JobDispatch`.
   */
  readonly dispatch: JobDispatch;
};

/**
 * One scheduled job: what it does, and when.
 *
 * **Two fields rather than seven in a row, because the two halves have different
 * owners.** `behaviour` is pinned by a person and refused when it moves;
 * `schedule` is config a person edits freely. Flattening them would make that
 * distinction a convention rather than a shape, and a convention is exactly what
 * a hashing function forgets — GPT Sol's SC-4 one level up.
 *
 * `schedule.everyMs` is measured **from the end of the last run, not from a
 * wall-clock boundary** — the drift that buys is named as an accepted trade-off
 * in docs/project/overseer-direction.md § The scheduler, and it is what makes a
 * job due while the box was down simply run on the next tick.
 */
export type JobDefinition = {
  readonly behaviour: JobBehaviour;
  /** WHEN it runs. Deliberately NOT hashed. `tools/overseer/schedules.ts` is where a person edits it. */
  readonly schedule: ScheduleConfig;
};

/**
 * One document a job's instruction leans on, and the digest of its bytes at the
 * moment the definition was built.
 *
 * The path is here for the person reading a refusal; the digest is what the
 * hash actually depends on.
 */
export type JobDocument = {
  /** Repo-relative, so the sentence a refusal prints means something to a reader. */
  readonly path: string;
  /** Hex sha256 of the file's bytes. */
  readonly sha256: string;
};

/** A BEHAVIOUR's fingerprint — never a schedule's. Branded so a `jobId` cannot be passed where this belongs. */
export type BehaviourHash = string & { readonly __brand: "overseer-behaviour-hash" };

/** An occurrence's address. Branded for the same reason, and readable on purpose: it is greppable in `events.jsonl`. */
export type OccurrenceId = string & { readonly __brand: "overseer-occurrence-id" };

/** How much of the sha256 is kept. Twelve hex characters is 48 bits — collision-proof at this scale, and short enough to read in a log line. */
export const BEHAVIOUR_HASH_LENGTH = 12;

/**
 * A stable fingerprint of a job's BEHAVIOUR — and of nothing else.
 *
 * Every field, named, in a fixed order, with lengths in front of the strings —
 * so `{id: "ab", what: "c"}` and `{id: "a", what: "bc"}` cannot hash the same,
 * which a naive concatenation permits. `JSON.stringify` is deliberately not used
 * as the canonical form: its key order follows insertion order, so two objects
 * a reader would call identical can produce two hashes.
 *
 * **It takes a `JobBehaviour`, not a `JobDefinition`, and that is the S8-1 fix
 * expressed as a type.** A schedule cannot leak back into the fingerprint by an
 * absent-minded edit, because there is no schedule in scope here to leak.
 *
 * Adding a field to `JobBehaviour` without adding it to `BEHAVIOUR_ENCODERS` is
 * the failure this is exposed to, and the mapped type there is what makes the
 * compiler say so.
 */
export function behaviourHash(behaviour: JobBehaviour): BehaviourHash {
  const canonical = JOB_BEHAVIOUR_HASHED_FIELDS.map((field) => encodeBehaviourField(behaviour, field)).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, BEHAVIOUR_HASH_LENGTH) as BehaviourHash;
}

/**
 * HOW EACH FIELD IS ENCODED — one entry per field, and the compiler counts them.
 *
 * **A destructure would not.** This was `const { id, everyMs, … } = definition`,
 * and destructuring is not exhaustive in TypeScript: a new field on the hashed
 * type compiles perfectly and never reaches the fingerprint that authorises the
 * job — GPT Sol's SC-4, and SP-1 by another route. A mapped type over
 * `keyof JobBehaviour` cannot be satisfied by an object literal missing a key,
 * so **a new field is a compile error until somebody says how it is hashed**.
 *
 * **`everyMs` and `leaseMs` used to be here and are gone on purpose** (S8-1).
 * They are `ScheduleConfig`'s now, they are not reachable from this function's
 * argument, and `tests/overseer-jobs.test.ts` asserts that the hashed field set
 * is exactly `keyof JobBehaviour` — so putting a clock knob back would take a
 * type change and a red test rather than one line.
 */
const BEHAVIOUR_ENCODERS: { readonly [K in keyof JobBehaviour]-?: (value: JobBehaviour[K]) => string } = {
  id: (id) => `id:${id.length}:${id}`,
  what: (what) => `what:${what.length}:${what}`,
  // THE WORK, INCLUDING EVERY KNOB OF A RULE. GPT Sol's SP-1: without this a
  // rule's threshold or its chosen action could move while the pin that
  // authorised it stayed valid, which is gate 3's prohibition wearing the
  // clothes of an implementation detail.
  work: (work) => canonicalWork(work),
  // THE COUNT FIRST, then each entry length-prefixed like the strings above:
  // without the count, a job with one document could hash the same as a job
  // with two whose paths concatenate to the same bytes.
  documents: (documents) =>
    [
      `documents:${documents.length}`,
      ...documents.map((document) => `document:${document.path.length}:${document.path}:${document.sha256.length}:${document.sha256}`),
    ].join("\n"),
  // WHETHER IT MAY START ANYTHING. Added 2026-09-10 (plan 260910e § D5), which
  // re-pinned every shipped job once: see `JobDispatch` for why this is gate 3's
  // and not the schedule's.
  dispatch: (dispatch) => canonicalDispatch(dispatch),
};

/**
 * The fields the fingerprint covers, in encoding order.
 *
 * Derived from the table rather than typed out, and exported so a test can hold
 * it against a `JobBehaviour`'s own keys — which is what makes reverting to a
 * destructure a red test rather than a silent loss of coverage.
 */
export const JOB_BEHAVIOUR_HASHED_FIELDS = Object.keys(BEHAVIOUR_ENCODERS) as readonly (keyof JobBehaviour)[];

/** One field, through its own encoder. The cast is the same known limitation `rules.ts` § encodeRuleField explains, and is sound for the same reason. */
function encodeBehaviourField<K extends keyof JobBehaviour>(behaviour: JobBehaviour, field: K): string {
  const encode = BEHAVIOUR_ENCODERS[field] as (value: JobBehaviour[K]) => string;
  return encode(behaviour[field]);
}

/**
 * A definition together with the fingerprint somebody authorised.
 *
 * **The pin is the separate artefact, and that is the whole point.** A hash
 * computed from the definition in front of us can only say "this is
 * self-consistent"; the authorisation has to come from somewhere the job cannot
 * edit on its own account. Here that is a literal in
 * `tools/overseer/standing-jobs.ts`, which changes only in a reviewed commit —
 * so a job whose prompt or whose *document* moved stops dispatching until a
 * person re-pins it, which is exactly Greg's "nothing dispatched that Greg did
 * not queue".
 *
 * A pin is deliberately NOT stored in `~/.overseer`: the store is written by the
 * daemon, and an authorisation the authorised party can write is not one.
 */
export type AuthorisedJob = {
  readonly definition: JobDefinition;
  /** What `behaviourHash(definition.behaviour)` must equal for this job to be dispatched at all. NOT a claim about the schedule. */
  readonly authorisedHash: BehaviourHash;
  /**
   * **EACH DOCUMENT'S FULL DIGEST AT THE MOMENT IT WAS PINNED — a diagnosis, not
   * a gate.** Plan 260910e § D4.
   *
   * The behaviour hash stays the only thing a dispatch is refused on. This
   * exists so the refusal can say *which* document moved — *"feedback-reports.md:
   * pinned 1a2b…, now 9f8e… — edited since it was authorised"* — rather than
   * only that a composite fingerprint did, which for a rule leaning on three
   * shared files is a puzzle.
   *
   * Required rather than optional: a pin with no documents to name would make
   * "nothing moved" and "nobody said" the same empty list. Standing jobs pin it
   * as a literal beside their hash; rule jobs take their load-time digests.
   * `tests/overseer-standing-jobs.test.ts` holds the two literals to one
   * another — rebuild the hash from these and it must equal `authorisedHash`.
   */
  readonly authorisedDocuments: readonly JobDocument[];
};

/**
 * Which documents differ from the ones that were pinned, as sentences.
 *
 * Eight hex characters each side: enough to tell two digests apart in a log
 * line, and the full ones are a `sha256sum` away. A document present on only
 * one side says so rather than printing a digest it does not have.
 */
export function documentDrift(authorised: readonly JobDocument[], found: readonly JobDocument[]): readonly string[] {
  const pinned = new Map(authorised.map((document) => [document.path, document.sha256]));
  const now = new Map(found.map((document) => [document.path, document.sha256]));
  const short = (sha: string): string => `${sha.slice(0, 8)}…`;
  const drift: string[] = [];
  for (const [path, sha] of now) {
    const was = pinned.get(path);
    if (was === undefined) drift.push(`${path}: not among the documents it was pinned with`);
    else if (was !== sha) drift.push(`${path}: pinned ${short(was)}, now ${short(sha)} — edited since it was authorised`);
  }
  for (const path of pinned.keys()) {
    if (!now.has(path)) drift.push(`${path}: pinned, and no longer among its documents`);
  }
  return drift;
}

/**
 * Whether a definition still matches the fingerprint it was authorised under.
 *
 * A union rather than a boolean, because the unauthorised arm has to carry both
 * hashes: the sentence a person needs is *"it was authorised as a1b2 and it is
 * now c3d4"*, and re-authorising means copying the second of those into the pin.
 */
export type Authorisation =
  | { readonly kind: "authorised"; readonly hash: BehaviourHash }
  | {
      readonly kind: "unauthorised";
      readonly authorised: BehaviourHash;
      readonly found: BehaviourHash;
      readonly why: string;
    };

export function authorisationOf(job: AuthorisedJob): Authorisation {
  const behaviour = job.definition.behaviour;
  const found = behaviourHash(behaviour);
  if (found === job.authorisedHash) return { kind: "authorised", hash: found };
  const drift = documentDrift(job.authorisedDocuments, behaviour.documents);
  return {
    kind: "unauthorised",
    authorised: job.authorisedHash,
    found,
    why:
      `this job's behaviour was authorised as ${job.authorisedHash} and now fingerprints as ${found}` +
      (behaviour.documents.length === 0 ? "" : ` (its documents are ${behaviour.documents.map((document) => document.path).join(", ")})`) +
      (drift.length === 0 ? "" : ` — ${drift.join("; ")}`) +
      ", so it is not the job that was queued and it will not be dispatched until somebody re-pins it. " +
      "A schedule edit cannot cause this: cadence, lease and first-run delay are not in the fingerprint",
  };
}

/**
 * Whether the occurrence ledger in front of us is the whole of it.
 *
 * **A cold start is not permission.** `openStore` deliberately comes up with an
 * empty occurrence map when the log has a hole in it or is too large to replay,
 * which is right for the session register — the next snapshot repairs it — and
 * wrong for a ledger whose entire purpose is stopping uncertain work being
 * repeated. An empty map read as "this job has never run" is the same mistake
 * C2 was, arriving through a different door.
 */
export type OccurrenceHistory =
  | { readonly kind: "intact" }
  | { readonly kind: "lost"; readonly why: string };

/**
 * What identifies one run.
 *
 * `scheduledAt` is the instant the scheduler decided to run it, not the instant
 * the child started: two ticks that both decide to run the same job produce two
 * keys only if they decided at different instants, and a tick that decides twice
 * at one instant is one occurrence, which is the right answer.
 */
export type OccurrenceKey = {
  /**
   * **THE LINEAGE, and it is the job id.**
   *
   * `lastRunOf` finds a job's previous run by this and by nothing else. It used
   * to filter on the behaviour hash as well, and GPT Sol's S8-4 is what that
   * cost: a re-pin made every prior occurrence vanish from the cadence
   * calculation, `due()` read the result as `never`, and the job dispatched
   * immediately — over the top of a session the old pin had launched minutes
   * earlier.
   *
   * A synthetic lineage id was the obvious alternative and is a second copy of
   * this fact. The job id already is the stable identity: it is what `prune`
   * groups by, what the log is grepped by, and what a person calls the job.
   *
   * **What that gives up, named:** repurposing an id — same name, wholly new
   * instruction — inherits the old job's cadence, so the new behaviour's first
   * run can be up to one interval later than it would otherwise be. That is the
   * safe direction, and the authorisation gate is what stops the new behaviour
   * running at all before somebody pins it.
   */
  readonly jobId: string;
  readonly scheduledAt: string;
  /**
   * The behaviour this run was authorised under, **for audit and for nothing
   * else**. It is in the key so a reader can tell which version of a job a run
   * belongs to; it is not consulted when deciding whether a job may run again.
   */
  readonly behaviourHash: BehaviourHash;
};

/** The key as one greppable string. `job@instant#hash`, in that order, so `grep '^job-id@'` works. */
export function occurrenceId(key: OccurrenceKey): OccurrenceId {
  return `${key.jobId}@${key.scheduledAt}#${key.behaviourHash}` as OccurrenceId;
}

/**
 * How a `finished` run ended.
 *
 * Two arms rather than `exitCode: number | null`, because "exited with a code we
 * read" and "the runner told us it broke" are two facts and a null in one slot
 * is where they get confused. A run that we could not observe the end of is not
 * here at all: that is `unknown`.
 */
export type JobOutcome = { readonly kind: "exited"; readonly code: number } | { readonly kind: "failed"; readonly why: string };

/**
 * What the runner says when it is asked to start a job.
 *
 * **It returns a result and does not throw**, and the two arms are different
 * facts: `refused` means *this did not start and I know it* (a precondition
 * failed, the binary is missing), which is a settled outcome. A throw is not in
 * the contract, and when one happens anyway the scheduler records `unknown`
 * rather than `refused` — because a function that broke its own contract is not
 * evidence about whether a process exists.
 *
 * `done` settles when the work does. A promise that never settles is not an
 * error here; it is the case the lease exists for.
 *
 * **It lives here rather than in `scheduler.ts` because the rule protocol
 * answers in it**, and the rule protocol is a pinned file that must not import
 * the scheduler. A session job used to answer in it too, through a `SpawnJob`;
 * since plan 260910f (scheduled dispatch) a session starts only through the
 * launch protocol, and that second starter is gone rather than left beside it.
 */
export type JobSpawn =
  | { readonly kind: "spawned"; readonly pid: number; readonly done: Promise<JobOutcome> }
  | { readonly kind: "refused"; readonly why: string };

/**
 * Why an `unknown` occurrence is unknown, and whether anybody wrote that down.
 *
 * `derived` is the fold's own reading of a `reserved` left behind by an instance
 * that is no longer running — nothing in the log says "unknown", the shape does.
 * `recorded` means a later instance noticed and appended a durable
 * `job-occurrence-unknown`. The scheduler appends exactly once, on the first
 * tick that sees a `derived` one, and this arm is how it knows not to do it
 * again every tick for ever.
 */
export type UnknownSource =
  | { readonly kind: "derived" }
  | { readonly kind: "recorded"; readonly noticedAt: string };

/**
 * One run, as the fold holds it.
 *
 * A discriminated union rather than a state string beside a bag of optionals:
 * a `finished` occurrence with no outcome, or a `started` one with no pid, must
 * not be representable. Every arm carries the key, the id and `reservedAt`,
 * because the reservation is the one fact every arm is downstream of.
 */
export type Occurrence =
  | {
      readonly kind: "reserved";
      readonly id: OccurrenceId;
      readonly key: OccurrenceKey;
      readonly reservedAt: string;
      /** The instance that reserved it. What separates "in flight here" from "left behind by a daemon that died". */
      readonly instanceId: string;
      readonly leaseUntil: string;
      readonly what: string;
    }
  | {
      readonly kind: "started";
      readonly id: OccurrenceId;
      readonly key: OccurrenceKey;
      readonly reservedAt: string;
      readonly instanceId: string;
      readonly leaseUntil: string;
      readonly what: string;
      readonly startedAt: string;
      readonly pid: number;
    }
  | {
      readonly kind: "finished";
      readonly id: OccurrenceId;
      readonly key: OccurrenceKey;
      readonly reservedAt: string;
      readonly instanceId: string;
      readonly what: string;
      readonly finishedAt: string;
      readonly outcome: JobOutcome;
    }
  | {
      readonly kind: "refused";
      readonly id: OccurrenceId;
      readonly key: OccurrenceKey;
      readonly reservedAt: string;
      readonly instanceId: string;
      readonly what: string;
      readonly refusedAt: string;
      /** Never dispatched, and this says why. A refusal is a fact; `unknown` is the absence of one. */
      readonly why: string;
    }
  | {
      readonly kind: "unknown";
      readonly id: OccurrenceId;
      readonly key: OccurrenceKey;
      readonly reservedAt: string;
      readonly instanceId: string;
      readonly what: string;
      readonly why: string;
      readonly source: UnknownSource;
    };

/** The fold's shape: every occurrence it still holds, by id. */
export type OccurrenceIndex = ReadonlyMap<OccurrenceId, Occurrence>;

/**
 * **A SESSION JOB'S OCCURRENCE, AS THE LAUNCH JOURNAL HOLDS IT** — plan 260910f
 * (scheduled dispatch) § D2.
 *
 * A live session job writes nothing to `events.jsonl`: the launch protocol's
 * journal is its one ledger. `launch-occurrences.ts` projects each
 * schedule-origin `LaunchRecord` into this arm so the planner's clocks read it
 * beside the rules' occurrences. **It is never stored**: the store's
 * `OccurrenceIndex` stays the five ledger arms above, and a `ScheduleIndex` is
 * the two merged for one planning pass.
 *
 * `reservedAt` is the record's `plannedAt`, because the one comparator every
 * "newest" uses reads `reservedAt` and then index order (Fable's P3).
 */
export type LaunchOccurrence = {
  readonly kind: "launch";
  readonly id: OccurrenceId;
  readonly key: OccurrenceKey;
  readonly reservedAt: string;
  /** The protocol's id: the hash of `scheduleOrigin(key)`. Recomputed from the key, never stored beside it (D1), so the join cannot drift. */
  readonly launchId: LaunchOccurrenceId;
  readonly standing: LaunchStanding;
};

/**
 * What a launch record means for its job's clock — four answers to *may this
 * job have another occurrence?*, and none of them a boolean.
 */
export type LaunchStanding =
  /**
   * `planned` or `waiting-admission`: **not a run**. The planner resumes it
   * rather than planning a sibling (F1). `account` is the pool account it was
   * planned on, read from the record's pinned run spec; null only for a record
   * that pins none, a `tmux` launch (`launch-occurrences.ts` § `accountOf`).
   */
  | { readonly kind: "resumable"; readonly state: "planned" | "waiting-admission"; readonly account: string | null; readonly why: string }
  /**
   * **Holds its job**: a launch in flight, one nobody can account for, or one
   * carried over a history reset. There is no lease — only evidence or Greg's
   * disposition moves it ("timeout alone is not proof"). `launchedAt` is the
   * first attempt's `launchingAt`, the launch-spacing gate's instant (F3).
   */
  | {
      readonly kind: "open";
      readonly state: "reserved" | "launching" | "observed-running" | "outcome-unknown" | "carried";
      readonly launchedAt: string | null;
      readonly why: string;
    }
  /** Ended, at the instant the journal says it ended — never the later release (F4). `disposed` is Greg's decision about a launch nobody could account for. */
  | {
      readonly kind: "settled";
      readonly state: "completed" | "failed-before-launch" | "disposed";
      readonly endedAt: string;
      readonly launchedAt: string | null;
      readonly why: string;
    }
  /**
   * **Abandoned before it ever launched**, because a later revision or a new
   * account replaced it (`failed-before-launch`, proof `superseded`). It
   * releases its due instant: the replacement is due at once, keyed at this
   * `endedAt`, so it gets a new id and the old one is never asked for again.
   */
  | { readonly kind: "replaced"; readonly endedAt: string; readonly why: string };

/** Any occurrence the planner reads: one of the ledger's five arms, or a launch. */
export type ScheduledOccurrence = Occurrence | LaunchOccurrence;

/** The merged index one planning pass reads. `launch-occurrences.ts` § `scheduleIndexOf` builds it; nothing stores it. */
export type ScheduleIndex = ReadonlyMap<OccurrenceId, ScheduledOccurrence>;

/**
 * An occurrence read against a clock.
 *
 * The state says what was written down; the standing says what a scheduler may
 * do about it now. They are separate because `stuck` is not a fact anybody
 * appended — it is `started` plus a deadline that has passed, and the same bytes
 * on disk are `in-flight` a minute earlier.
 */
export type OccurrenceStanding =
  | { readonly kind: "in-flight"; readonly leaseUntil: string; readonly remainingMs: number }
  | { readonly kind: "stuck"; readonly leaseUntil: string; readonly overdueMs: number }
  | { readonly kind: "settled"; readonly at: string }
  /** `unknown`: it holds nothing up, and it is never retried. Both halves matter. */
  | { readonly kind: "unresolved"; readonly why: string }
  /** A launch that holds its job. No lease: only evidence or Greg moves it. */
  | { readonly kind: "launch-open"; readonly since: string; readonly why: string }
  /** A launch not yet made, waiting to be resumed. Not a run. */
  | { readonly kind: "launch-resumable"; readonly since: string }
  /** A launch replaced before it ever ran. Its due instant is released. */
  | { readonly kind: "replaced"; readonly at: string };

/** Whether an occurrence's lease has run out. False for anything already settled — a finished run has no deadline left to miss. */
export function leaseExpired(occurrence: Occurrence, nowMs: number): boolean {
  switch (occurrence.kind) {
    case "reserved":
    case "started":
      return Date.parse(occurrence.leaseUntil) <= nowMs;
    case "finished":
    case "refused":
    case "unknown":
      return false;
    default: {
      const never: never = occurrence;
      throw new Error(`no lease for occurrence ${JSON.stringify(never)}`);
    }
  }
}

/**
 * The `stuck` classification, and the rest of the standings beside it.
 *
 * A `reserved` occurrence gets a lease as well as a `started` one, deliberately.
 * The window between the two appends is microseconds wide, so a `reserved` that
 * is still `reserved` an hour later is a daemon that died in it — and without a
 * deadline there it would hold its job for ever, which is precisely S6 wearing a
 * different hat.
 */
export function standingOf(occurrence: ScheduledOccurrence, nowMs: number): OccurrenceStanding {
  switch (occurrence.kind) {
    case "reserved":
    case "started": {
      const leaseMs = Date.parse(occurrence.leaseUntil);
      if (leaseMs <= nowMs) return { kind: "stuck", leaseUntil: occurrence.leaseUntil, overdueMs: nowMs - leaseMs };
      return { kind: "in-flight", leaseUntil: occurrence.leaseUntil, remainingMs: leaseMs - nowMs };
    }
    case "finished":
      return { kind: "settled", at: occurrence.finishedAt };
    case "refused":
      return { kind: "settled", at: occurrence.refusedAt };
    case "unknown":
      return { kind: "unresolved", why: occurrence.why };
    case "launch":
      return launchStandingOf(occurrence);
    default: {
      const never: never = occurrence;
      throw new Error(`no standing for occurrence ${JSON.stringify(never)}`);
    }
  }
}

/** A launch occurrence against the clock — which it does not read: a launch has no lease, and its standing is the journal's. */
function launchStandingOf(occurrence: LaunchOccurrence): OccurrenceStanding {
  const standing = occurrence.standing;
  switch (standing.kind) {
    case "resumable":
      return { kind: "launch-resumable", since: occurrence.reservedAt };
    case "open":
      return { kind: "launch-open", since: occurrence.reservedAt, why: standing.why };
    case "settled":
      return { kind: "settled", at: standing.endedAt };
    case "replaced":
      return { kind: "replaced", at: standing.endedAt };
    default: {
      const never: never = standing;
      throw new Error(`no standing for launch ${JSON.stringify(never)}`);
    }
  }
}

/**
 * What a job's history says about when it last ran — the input to `due`.
 *
 * **A union rather than `lastOutcomeAt: string | null`**, which is the shape the
 * brief for this stage named and the shape this codebase has been bitten by:
 * "never run", "ran and we know when it ended" and "ran and we cannot say what
 * happened" are three facts, and two of them would share the `null`. A consumer
 * cannot flatten this without walking past the `kind`.
 *
 * `unresolved` anchors on the RESERVATION rather than refusing to schedule. It
 * is a lower bound — the run happened at or after that instant, if it happened —
 * so measuring the interval from it can only make the next run later than it
 * should be, never sooner. Refusing instead would turn one crash into a job that
 * never runs again.
 */
export type LastRun =
  | { readonly kind: "never" }
  | { readonly kind: "settled"; readonly at: string }
  | { readonly kind: "in-flight"; readonly since: string; readonly leaseUntil: string }
  | { readonly kind: "unresolved"; readonly at: string; readonly why: string }
  /** A launch in flight or unaccounted for (`LaunchStanding`'s `open`). **The no-overlap guard for a session job**, and it has no lease (D2). */
  | { readonly kind: "launch-open"; readonly since: string; readonly why: string }
  /** The newest occurrence was abandoned before it launched. The replacement is due at once, keyed at `at` — the abandonment's `endedAt`. */
  | { readonly kind: "replaced"; readonly at: string }
  /**
   * **THE NEWEST OCCURRENCE IS A LAUNCH WAITING TO BE RESUMED — not a run**
   * (F1). `prior` is the job's last actual run, which `due()` answers from, so
   * a superseded sibling never delays its replacement. The planner decides a
   * resume BEFORE asking `due()` at all (Fable's P2).
   */
  | { readonly kind: "launch-resumable"; readonly occurrence: LaunchOccurrence; readonly prior: PriorRun };

/** Every `LastRun` but `launch-resumable`: what a job's last actual run can be. */
export type PriorRun = Exclude<LastRun, { readonly kind: "launch-resumable" }>;

/**
 * Whether a job may run now.
 *
 * A union rather than a boolean, because a scheduler that skips a job should be
 * able to say which of the three reasons it was — and because `held` is the one
 * a person needs to see in a log when a job has gone quiet.
 */
export type Due =
  /**
   * `dueAt` is the job's **nominal** due instant, deterministic from its state
   * (plan 260910f scheduled dispatch, M2): never run, the arming instant plus
   * the first-run delay; replaced, the abandonment's `endedAt`; otherwise the
   * last run plus the cadence. A session job's occurrence key is made of it, so
   * the key is the same on every tick and across a restart inside one due
   * window — which is what lets a `waiting` occurrence be found again (D5).
   */
  | { readonly kind: "due"; readonly sinceMs: number; readonly dueAt: string }
  | { readonly kind: "not-due"; readonly remainingMs: number }
  | { readonly kind: "held"; readonly why: string }
  /**
   * **NEVER RUN, and not yet allowed to.** The job's whole history is still
   * empty — `lastRunOf` says `never` and will go on saying it — and what defers
   * it is the arming instant plus its own `initialDelayMs`.
   *
   * Its own arm rather than a `not-due`, because the sentence a reader needs is
   * *"never run; first eligible at …"*, which a remaining-milliseconds count
   * cannot say. See `arming.ts` for why the anchor is on disk.
   */
  | { readonly kind: "not-yet-eligible"; readonly firstEligibleAt: string; readonly remainingMs: number };

/**
 * **WHEN THIS SCHEDULER WAS ARMED — a scheduler-control fact, not an occurrence.**
 *
 * GPT Sol's S8-6. It is what `initialDelayMs` is measured from, and it is
 * deliberately not a fabricated `finished` occurrence: the ledger's whole value
 * is that a person can read it and believe it. `arming.ts` owns the durability;
 * this type is the vocabulary, and it lives here because `due` is the only thing
 * that consumes it.
 *
 * `unknown` fails closed: `due` holds every job on it rather than guessing an
 * instant in either direction.
 */
export type Arming = { readonly kind: "armed"; readonly at: string } | { readonly kind: "unknown"; readonly why: string };

/**
 * Has `everyMs` elapsed since the last run finished?
 *
 * **State-based, on purpose.** It asks "how long since the last outcome", not
 * "which wall-clock boundary are we past", so a job due while the daemon was
 * down runs on the next tick rather than being skipped (cron) or catching up
 * once (`systemd Persistent=true`). The cost is drift across restarts, named in
 * the direction doc as accepted.
 *
 * A run in flight holds the job whatever the interval says — that is the overlap
 * guard, and it is durable rather than in-memory. It cannot hold for ever
 * because a lease that has run out is `stuck` rather than `in-flight`, and
 * `lastRunOf` never reports a stuck occurrence as in flight.
 *
 * **It takes a `ScheduleConfig` rather than a whole definition**, which is the
 * split saying something useful: whether a job is due is a question about the
 * clock, and nothing about what the job does is in scope to influence it.
 */
export function due(schedule: ScheduleConfig, last: LastRun, nowMs: number, arming: Arming): Due {
  switch (last.kind) {
    case "never": {
      // NEVER RUN IS NOT AUTOMATICALLY DUE ANY MORE. Both standing jobs read
      // `never` for ever until the first one lands, so arming used to mean two
      // Claude sessions about thirty seconds later — as the first act of a
      // mechanism nobody had watched work.
      if (arming.kind === "unknown") {
        return { kind: "held", why: `this job has never run and nothing can say when the scheduler was armed, so its first run cannot be dated: ${arming.why}` };
      }
      const firstEligibleMs = Date.parse(arming.at) + schedule.initialDelayMs;
      if (Number.isNaN(firstEligibleMs)) {
        return { kind: "held", why: `this job has never run and the recorded arming instant ${arming.at} is not readable, so its first run cannot be dated` };
      }
      if (nowMs >= firstEligibleMs) return { kind: "due", sinceMs: 0, dueAt: new Date(firstEligibleMs).toISOString() };
      return { kind: "not-yet-eligible", firstEligibleAt: new Date(firstEligibleMs).toISOString(), remainingMs: firstEligibleMs - nowMs };
    }
    case "in-flight":
      return { kind: "held", why: `a run reserved at ${last.since} is still in flight (lease until ${last.leaseUntil})` };
    case "launch-open":
      return { kind: "held", why: `its launch planned at ${last.since} is ${last.why}` };
    case "replaced": {
      // THE REPLACEMENT IS DUE AT ONCE, at the abandonment's own instant — a
      // new key, so a new id, and no interval lost to a supersession or a
      // rollback.
      const atMs = Date.parse(last.at);
      if (Number.isNaN(atMs)) return { kind: "held", why: `its last occurrence was replaced at ${last.at}, an instant this build cannot read` };
      return { kind: "due", sinceMs: nowMs - atMs, dueAt: new Date(atMs).toISOString() };
    }
    case "settled":
    case "unresolved": {
      const lastMs = Date.parse(last.at);
      const sinceMs = nowMs - lastMs;
      if (sinceMs >= schedule.everyMs) return { kind: "due", sinceMs, dueAt: new Date(lastMs + schedule.everyMs).toISOString() };
      return { kind: "not-due", remainingMs: schedule.everyMs - sinceMs };
    }
    case "launch-resumable":
      // A WAITING LAUNCH IS NOT A RUN: the clock reads the one before it. The
      // planner only gets here for a waiting launch it is NOT resuming (a moved
      // revision, or its account gone); a resume never asks the clock (P2).
      return due(schedule, last.prior, nowMs, arming);
    default: {
      const never: never = last;
      throw new Error(`no due reading for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **THE ONE COMPARATOR FOR EVERY "NEWEST"** — Fable's P3 on plan 260910f
 * (scheduled dispatch). Newer by `reservedAt` (a launch occurrence's
 * `plannedAt`), and on a tie, later in index order: this is asked while walking
 * the index in order, so `>=` lets the later of two equal instants win. Index
 * order is the fold's insertion order — the order of the `planned` lines —
 * which is what separates two siblings that share one `scheduledAt`.
 *
 * `lastRunOf`, `newestAttemptOf` and the planner's resume candidate all use
 * it, through `newestOccurrenceOf`, so they cannot pick different occurrences.
 * It used to be the key's `scheduledAt`; for a ledger occurrence that is the
 * same instant as its reservation, and for a launch it is not — siblings share
 * a due instant, which is exactly why P3 named the plan time.
 */
function atLeastAsNew(candidate: ScheduledOccurrence, held: ScheduledOccurrence): boolean {
  return Date.parse(candidate.reservedAt) >= Date.parse(held.reservedAt);
}

/** The job's newest occurrence by the one comparator, among those `include` admits, or null. */
export function newestOccurrenceOf(
  index: ScheduleIndex,
  jobId: string,
  include: (occurrence: ScheduledOccurrence) => boolean = () => true,
): ScheduledOccurrence | null {
  let newest: ScheduledOccurrence | null = null;
  for (const occurrence of index.values()) {
    // **BY LINEAGE — THE JOB ID — AND NOT BY THE BEHAVIOUR HASH.** It used to
    // skip any occurrence whose hash differed from the definition in front of
    // it, on the reasoning that an edited definition should inherit no history.
    // GPT Sol's S8-4 is what that actually bought: a re-pin made every prior run
    // invisible, `due()` read the emptiness as `never`, and the job dispatched
    // at once — including over the top of a session still in flight under the
    // old pin, because an unsettled occurrence was hidden by the same filter.
    //
    // The property the filter was protecting is now held by the authorisation
    // gate, which `planJobs` asks BEFORE it asks this function anything: an
    // edited behaviour does not reach the arithmetic at all (C2). The hash stays
    // on the key for audit; it is not a lineage.
    if (occurrence.key.jobId !== jobId || !include(occurrence)) continue;
    if (newest === null || atLeastAsNew(occurrence, newest)) newest = occurrence;
  }
  return newest;
}

/** A launch waiting to be resumed — the one kind of occurrence that is not a run. */
function isResumable(occurrence: ScheduledOccurrence): boolean {
  return occurrence.kind === "launch" && occurrence.standing.kind === "resumable";
}

/**
 * The job's most recent run, read out of the index against a clock.
 *
 * **A stuck occurrence is not `in-flight`.** That single line is the whole of
 * the S6 fix: the guard releases when the lease runs out, so the job's next
 * occurrence may be scheduled while the stuck one stays visible and unretried.
 *
 * **A launch waiting to be resumed is not a run either** (F1): when it is the
 * newest, the answer is `launch-resumable`, carrying it and the job's last
 * actual run beneath it.
 */
export function lastRunOf(index: ScheduleIndex, jobId: string, nowMs: number): LastRun {
  const newest = newestOccurrenceOf(index, jobId);
  const newestRun = newestOccurrenceOf(index, jobId, (occurrence) => !isResumable(occurrence));
  const prior: PriorRun = newestRun === null ? { kind: "never" } : priorRunOf(newestRun, nowMs);
  if (newest !== null && newest.kind === "launch" && newest.standing.kind === "resumable") return { kind: "launch-resumable", occurrence: newest, prior };
  return prior;
}

/** One occurrence that is a run, as the clock reads it. `lastRunOf` never hands it a resumable launch. */
function priorRunOf(occurrence: ScheduledOccurrence, nowMs: number): PriorRun {
  const standing = standingOf(occurrence, nowMs);
  switch (standing.kind) {
    case "in-flight":
      return { kind: "in-flight", since: occurrence.reservedAt, leaseUntil: standing.leaseUntil };
    case "stuck":
      return {
        kind: "unresolved",
        at: occurrence.reservedAt,
        why: `its lease ran out ${Math.round(standing.overdueMs / 1000)}s ago and nothing said how it ended`,
      };
    case "settled":
      return { kind: "settled", at: standing.at };
    case "unresolved":
      return { kind: "unresolved", at: occurrence.reservedAt, why: standing.why };
    case "launch-open":
      return { kind: "launch-open", since: standing.since, why: standing.why };
    case "replaced":
      return { kind: "replaced", at: standing.at };
    case "launch-resumable":
      throw new Error(`${occurrence.id} is a launch waiting to be resumed, which is not a run; lastRunOf filters it out before reading one`);
    default: {
      const never: never = standing;
      throw new Error(`no last run for ${JSON.stringify(never)}`);
    }
  }
}

/** Every occurrence whose lease has run out — what the scheduler reports and what a reader of the checkpoint should see first. */
export function stuckOccurrences(index: OccurrenceIndex, nowMs: number): readonly Occurrence[] {
  return [...index.values()].filter((occurrence) => leaseExpired(occurrence, nowMs));
}

/**
 * **THE LAST TIME A CLAUDE SESSION WAS LAUNCHED ON THIS BOX, out of the durable
 * ledger.**
 *
 * The input to the launch-spacing gate (GPT Sol's S8-5). Durable rather than
 * in-memory for the reason the whole finding is about: a phase offset does not
 * survive downtime, a restart, or a stuck occurrence rescheduling from its
 * reservation, and an in-memory "last launch" would not survive the restart
 * either. The ledger does.
 *
 * **`reservedAt`, not `startedAt` or `finishedAt`.** The reservation is the
 * instant we committed to launching, it is written before anything is spawned,
 * and every arm carries it. `finishedAt` would be wrong twice over: a run that
 * never settles has none, and the outcome the ledger records for a session job is
 * the short-lived `gjd-remote` launcher exiting, not the detached session ending
 * (the dispatcher that did that is deleted; a session now starts through the
 * launch protocol).
 *
 * **A `refused` occurrence does not count**, because nothing started — and
 * `unknown` does, because something may have. Spacing is a rationing decision,
 * so the uncertain case rations.
 *
 * **THE LIMITATION, NAMED: an occurrence does not record whether its job was a
 * session**, so `sessionJobIds` has to come from the definitions this daemon
 * currently holds. A session job REMOVED from the definitions between its launch
 * and the next tick therefore stops rationing — its occurrence is still in the
 * ledger and no longer recognised as a launch.
 *
 * That is accepted rather than overlooked, and **it is closed for every launch
 * occurrence**: the launch journal only ever holds Claude sessions, so a
 * launch counts whatever the definitions say. What remains is the legacy
 * ledger's session occurrences, which nothing writes any more.
 *
 * **A launch occurrence is timed at its first attempt's `launchingAt`** — the
 * moment the launcher could first have been invoked — never at its plan (F3):
 * an occurrence that waited two hours for admission and then launched a minute
 * ago was launched a minute ago. One with no attempt does not count, the same
 * way a `refused` does not: nothing was started. A carried entry, whose
 * attempts its reset could not see, does not count either — it holds its own
 * job, and rationing others against an instant nobody knows would be inventing
 * one.
 */
export function lastSessionLaunchOf(index: ScheduleIndex, sessionJobIds: ReadonlySet<string>): { readonly kind: "none" } | { readonly kind: "at"; readonly at: string; readonly jobId: string } {
  let newest: { readonly at: string; readonly ms: number; readonly jobId: string } | null = null;
  for (const occurrence of index.values()) {
    const at = launchInstantOf(occurrence, sessionJobIds);
    if (at === null) continue;
    const ms = Date.parse(at);
    if (newest === null || ms > newest.ms) newest = { at, ms, jobId: occurrence.key.jobId };
  }
  if (newest === null) return { kind: "none" };
  return { kind: "at", at: newest.at, jobId: newest.jobId };
}

/** When this occurrence launched, or may have: the spacing gate's reading of it, or null when it launched nothing. */
function launchInstantOf(occurrence: ScheduledOccurrence, sessionJobIds: ReadonlySet<string>): string | null {
  if (occurrence.kind === "launch") {
    const standing = occurrence.standing;
    switch (standing.kind) {
      case "open":
      case "settled":
        return standing.launchedAt;
      case "resumable":
      case "replaced":
        return null;
      default: {
        const never: never = standing;
        throw new Error(`no launch instant for ${JSON.stringify(never)}`);
      }
    }
  }
  if (!sessionJobIds.has(occurrence.key.jobId)) return null;
  if (occurrence.kind === "refused") return null;
  return occurrence.reservedAt;
}

/**
 * How many `unknown` occurrences the fold keeps.
 *
 * The LOG keeps every one for ever; this bounds only what is carried forward in
 * memory and written into `current.json`. One is produced per crash per job, so
 * fifty is a long history of a rare event — and without a bound the checkpoint
 * would grow by one entry every time the daemon died, which is exactly the kind
 * of slow leak nobody notices until the file is unreadable.
 */
export const UNKNOWN_RETENTION = 50;

/**
 * The sentence a reservation left behind by a dead daemon gets.
 *
 * ONE COPY, because it is written from two places — the fold and the checkpoint
 * restore — and because it is the sentence a person reads at 8am when a job did
 * not run. It says *we cannot tell*, not *it failed*, and that distinction is
 * the whole of Sol's S5.
 */
function abandonedReservation(instanceId: string): string {
  return (
    `instance ${instanceId} reserved this and never said whether it spawned; ` +
    "the spawn either did not happen or happened and was not acknowledged, and nothing here can tell which"
  );
}

/**
 * An occurrence read back out of a checkpoint, re-judged against the instance
 * reading it.
 *
 * **The checkpoint stores the FOLD, so it stores a derivation** — and a
 * `reserved` occurrence was called `reserved` because the instance that folded
 * it was the one that wrote it. Restoring that verbatim into a new daemon would
 * carry "in flight" across the very restart that proves it is not, and hold the
 * job for as long as the lease lasted while nothing was running. So the same
 * rule is applied again on the way in, which is why it is a function rather
 * than three lines inside `foldOccurrences`.
 *
 * `started` is deliberately left alone: a spawned child can outlive the daemon
 * that started it, so "started by an instance that is gone" is not a
 * contradiction. Its lease is what ends it.
 */
export function adoptOccurrence(occurrence: Occurrence, ownInstanceId: string): Occurrence {
  if (occurrence.kind !== "reserved" || occurrence.instanceId === ownInstanceId) return occurrence;
  return {
    kind: "unknown",
    id: occurrence.id,
    key: occurrence.key,
    reservedAt: occurrence.reservedAt,
    instanceId: occurrence.instanceId,
    what: occurrence.what,
    why: abandonedReservation(occurrence.instanceId),
    source: { kind: "derived" },
  };
}

/**
 * Fold job-occurrence events into an index.
 *
 * **`ownInstanceId` is what makes `unknown` derivable**, and it is the only
 * impure-looking argument here: a `reserved` written by THIS instance is a run
 * in flight right now, and the identical bytes written by an instance that is no
 * longer running mean a daemon died in the spawn window. Nothing else on the box
 * separates those two, and the difference is the whole crash-window story.
 *
 * A `started`/`finished`/`refused` for an occurrence the index has never seen is
 * **dropped**, the same rule `foldEvents` applies to a status for an unknown
 * session and for the same reason: half a record is not an occurrence, and the
 * key material is only on the reservation.
 */
export function foldOccurrences(
  events: readonly OverseerEvent[],
  into: Map<OccurrenceId, Occurrence>,
  ownInstanceId: string,
): Map<OccurrenceId, Occurrence> {
  for (const event of events) {
    switch (event.kind) {
      case "job-occurrence-reserved": {
        const key: OccurrenceKey = {
          jobId: event.jobId,
          scheduledAt: event.scheduledAt,
          behaviourHash: event.behaviourHash,
        };
        // THE DERIVATION, IN ONE PLACE. A reservation from another instance with
        // nothing after it is the shape Sol's table calls indistinguishable, so
        // it becomes `unknown` here rather than staying `reserved` and being
        // mistaken for something in flight.
        into.set(
          event.occurrenceId,
          event.instanceId === ownInstanceId
            ? {
                kind: "reserved",
                id: event.occurrenceId,
                key,
                reservedAt: event.at,
                instanceId: event.instanceId,
                leaseUntil: event.leaseUntil,
                what: event.what,
              }
            : {
                kind: "unknown",
                id: event.occurrenceId,
                key,
                reservedAt: event.at,
                instanceId: event.instanceId,
                what: event.what,
                why: abandonedReservation(event.instanceId),
                source: { kind: "derived" },
              },
        );
        break;
      }
      case "job-occurrence-started": {
        const was = into.get(event.occurrenceId);
        // ONLY FROM A RESERVATION. A `started` landing on an occurrence already
        // read as `unknown` (a reservation from a dead instance, whose `started`
        // arrived in the same log) still promotes it, because the acknowledgement
        // IS the missing fact — that case is a restart mid-batch, not a crash.
        if (was === undefined || (was.kind !== "reserved" && was.kind !== "unknown")) break;
        into.set(event.occurrenceId, {
          kind: "started",
          id: was.id,
          key: was.key,
          reservedAt: was.reservedAt,
          instanceId: was.instanceId,
          leaseUntil: event.leaseUntil,
          what: was.what,
          startedAt: event.at,
          pid: event.pid,
        });
        break;
      }
      case "job-occurrence-finished": {
        const was = into.get(event.occurrenceId);
        if (was === undefined) break;
        into.set(event.occurrenceId, {
          kind: "finished",
          id: was.id,
          key: was.key,
          reservedAt: was.reservedAt,
          instanceId: was.instanceId,
          what: was.what,
          finishedAt: event.at,
          outcome: event.outcome,
        });
        break;
      }
      case "job-occurrence-refused": {
        const was = into.get(event.occurrenceId);
        if (was === undefined) break;
        into.set(event.occurrenceId, {
          kind: "refused",
          id: was.id,
          key: was.key,
          reservedAt: was.reservedAt,
          instanceId: was.instanceId,
          what: was.what,
          refusedAt: event.at,
          why: event.why,
        });
        break;
      }
      case "job-occurrence-unknown": {
        const was = into.get(event.occurrenceId);
        if (was === undefined) break;
        into.set(event.occurrenceId, {
          kind: "unknown",
          id: was.id,
          key: was.key,
          reservedAt: was.reservedAt,
          instanceId: was.instanceId,
          what: was.what,
          why: event.why,
          source: { kind: "recorded", noticedAt: event.at },
        });
        break;
      }
      // THE SESSION ARMS, NAMED RATHER THAN DEFAULTED. A `default:` here would
      // silently absorb a new arm of `OverseerEvent`, and the compiler saying
      // "you have not decided about this one" is the reason these two folds can
      // share a union at all.
      case "session-seen":
      case "session-status":
      case "tmux-session-gone":
      case "session-replaced":
      case "session-wait-restarted":
      case "session-row-changed":
      case "session-pane-replaced":
      case "session-execution-changed":
      // AND THE RULE ARMS. A rule event is addressed BY an occurrence id and
      // says nothing about that occurrence's lifecycle — the reservation, the
      // start and the finish around it are the job events above. Folding one
      // here would let a finding move a run's state, which is a different
      // record silently editing this one.
      case "rule-intended":
      case "rule-settled":
      // AND THE RECOVERY JOURNAL'S. A candidate or a disposition is about a
      // session that went away, never about a run of a job.
      case "recovery-candidate":
      case "recovery-disposition":
        break;
      default: {
        const never: never = event;
        throw new Error(`no occurrence fold for event ${JSON.stringify(never)}`);
      }
    }
  }
  return prune(into);
}

/**
 * Keep the index bounded without losing anything a scheduler needs.
 *
 * What it needs is: every unsettled occurrence (so nothing in flight or stuck is
 * forgotten), the newest settled one per job (so `due` has an anchor), and a
 * bounded tail of `unknown`s (so a crash stays visible). Everything else is
 * history, and history is the log's job.
 */
function prune(index: Map<OccurrenceId, Occurrence>): Map<OccurrenceId, Occurrence> {
  const newestSettled = new Map<string, Occurrence>();
  const unknowns: Occurrence[] = [];
  for (const occurrence of index.values()) {
    if (occurrence.kind === "unknown") {
      unknowns.push(occurrence);
      continue;
    }
    if (occurrence.kind !== "finished" && occurrence.kind !== "refused") continue;
    const held = newestSettled.get(occurrence.key.jobId);
    if (held === undefined || Date.parse(occurrence.key.scheduledAt) > Date.parse(held.key.scheduledAt)) {
      newestSettled.set(occurrence.key.jobId, occurrence);
    }
  }
  const keptUnknown = new Set(
    unknowns
      .sort((a, b) => Date.parse(b.key.scheduledAt) - Date.parse(a.key.scheduledAt))
      .slice(0, UNKNOWN_RETENTION)
      .map((occurrence) => occurrence.id),
  );
  const keptSettled = new Set([...newestSettled.values()].map((occurrence) => occurrence.id));
  for (const [id, occurrence] of [...index.entries()]) {
    if (occurrence.kind === "reserved" || occurrence.kind === "started") continue;
    if (occurrence.kind === "unknown" ? keptUnknown.has(id) : keptSettled.has(id)) continue;
    index.delete(id);
  }
  return index;
}
