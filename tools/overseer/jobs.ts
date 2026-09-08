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
 * run gets a **key** — `(job id, scheduled instant, authorised-definition hash)`
 * — recorded durably before anything is spawned, and every later fact about that
 * run is addressed by it.
 *
 * The **definition hash** is the third of those three for one reason: a job
 * definition edited after it was authorised must be *detectable*. An occurrence
 * whose hash does not match the definition in front of us is not the run we
 * authorised, so it cannot vouch for it, and an edited definition therefore
 * inherits no history.
 *
 * ## History separation is NOT authorisation, and reading it as one was a bug
 *
 * That property used to be the whole of the answer, and GPT Sol's C2 showed it
 * pointed the wrong way: a definition with no history reads as `never`, `due()`
 * calls `never` immediately due, and so **editing a job dispatched the edited
 * version at once** — the exact opposite of the runbook's *never act on a job
 * definition that changed after it was authorised*. "Being in the key is not
 * equivalent to comparing against an authorisation."
 *
 * So the authorisation is a **separate, pinned fingerprint** carried beside the
 * definition (`AuthorisedJob`), and a mismatch is its own state
 * (`Authorisation`) that the scheduler refuses on, loudly. The key keeps the
 * hash as well, because the two answer different questions: the key asks *which
 * run is this*, and the pin asks *may this run at all*.
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
import { canonicalRuleSpec, type RuleSpec } from "./rules.js";

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
 * is data, `definitionHash` hashes it, and a moved knob refuses the job.
 */
export type JobWork =
  /** A Claude session, started by `SpawnJob`. What the standing jobs are. */
  | { readonly kind: "session" }
  /** A deterministic rule, run in process by the scheduler's two-phase protocol. No model calls, no session. */
  | { readonly kind: "rule"; readonly rule: RuleSpec };

/**
 * A job definition narrowed to the rule arm, at the type level.
 *
 * This is half of what makes the deterministic-only arming path structural
 * rather than a filter (SP-4): `ruleJobs()` returns these, so a session job
 * cannot be handed to that path without changing a declared type, which is a
 * visible edit rather than something a future job falls through. The other half
 * is that the path supplies no `SpawnJob` at all — see `scheduler.ts`.
 */
export type RuleJobDefinition = JobDefinition & { readonly work: Extract<JobWork, { kind: "rule" }> };

/** An authorised job whose work is a rule, by construction. */
export type AuthorisedRuleJob = { readonly definition: RuleJobDefinition; readonly authorisedHash: DefinitionHash };

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
      return "work:session";
    case "rule":
      return `work:rule\n${canonicalRuleSpec(work.rule)}`;
    default: {
      const never: never = work;
      throw new Error(`no canonical form for job work ${JSON.stringify(never)}`);
    }
  }
}

/**
 * One scheduled job, as data.
 *
 * `what` is **the authorised instruction** — the prompt or command that will
 * actually be run — and it is in the hash for that reason: changing it changes
 * what the box does, so it must change the identity of the runs that follow.
 * A job whose `what` was edited between authorisation and dispatch is a
 * different job, and the runbook's rule ("nothing dispatched that Greg did not
 * queue") has no meaning otherwise.
 *
 * `everyMs` is measured **from the end of the last run, not from a wall-clock
 * boundary** — the drift that buys is named as an accepted trade-off in
 * docs/project/overseer-direction.md § The scheduler, and it is what makes a job
 * due while the box was down simply run on the next tick.
 */
export type JobDefinition = {
  readonly id: string;
  /** Interval from the last run's OUTCOME, not from its start. See `due`. */
  readonly everyMs: number;
  /** How long a run may be unsettled before it is `stuck`. The author's "if it takes longer than this, it is not coming back". */
  readonly leaseMs: number;
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

/** A definition's fingerprint. Branded so a `jobId` cannot be passed where this belongs. */
export type DefinitionHash = string & { readonly __brand: "overseer-definition-hash" };

/** An occurrence's address. Branded for the same reason, and readable on purpose: it is greppable in `events.jsonl`. */
export type OccurrenceId = string & { readonly __brand: "overseer-occurrence-id" };

/** How much of the sha256 is kept. Twelve hex characters is 48 bits — collision-proof at this scale, and short enough to read in a log line. */
export const DEFINITION_HASH_LENGTH = 12;

/**
 * A stable fingerprint of the WHOLE definition.
 *
 * Every field, named, in a fixed order, with lengths in front of the strings —
 * so `{id: "ab", what: "c"}` and `{id: "a", what: "bc"}` cannot hash the same,
 * which a naive concatenation permits. `JSON.stringify` is deliberately not used
 * as the canonical form: its key order follows insertion order, so two objects
 * a reader would call identical can produce two hashes.
 *
 * Adding a field to `JobDefinition` without adding it to `DEFINITION_ENCODERS`
 * is the failure this is exposed to, and the mapped type there is what makes the
 * compiler say so.
 */
export function definitionHash(definition: JobDefinition): DefinitionHash {
  const canonical = JOB_DEFINITION_HASHED_FIELDS.map((field) => encodeDefinitionField(definition, field)).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, DEFINITION_HASH_LENGTH) as DefinitionHash;
}

/**
 * HOW EACH FIELD IS ENCODED — one entry per field, and the compiler counts them.
 *
 * **A destructure would not.** This was `const { id, everyMs, … } = definition`,
 * and destructuring is not exhaustive in TypeScript: a seventh field on
 * `JobDefinition` compiles perfectly and never reaches the fingerprint that
 * authorises the job — GPT Sol's SC-4, and SP-1 by another route. A mapped type
 * over `keyof JobDefinition` cannot be satisfied by an object literal missing a
 * key, so **a new field is a compile error until somebody says how it is
 * hashed**.
 *
 * The declaration order is the encoding order and the bytes are unchanged from
 * the destructured version, deliberately: this refactor re-pinned nothing.
 */
const DEFINITION_ENCODERS: { readonly [K in keyof JobDefinition]-?: (value: JobDefinition[K]) => string } = {
  id: (id) => `id:${id.length}:${id}`,
  everyMs: (everyMs) => `everyMs:${everyMs}`,
  leaseMs: (leaseMs) => `leaseMs:${leaseMs}`,
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
};

/**
 * The fields the fingerprint covers, in encoding order.
 *
 * Derived from the table rather than typed out, and exported so a test can hold
 * it against a `JobDefinition`'s own keys — which is what makes reverting to a
 * destructure a red test rather than a silent loss of coverage.
 */
export const JOB_DEFINITION_HASHED_FIELDS = Object.keys(DEFINITION_ENCODERS) as readonly (keyof JobDefinition)[];

/** One field, through its own encoder. The cast is the same known limitation `rules.ts` § encodeRuleField explains, and is sound for the same reason. */
function encodeDefinitionField<K extends keyof JobDefinition>(definition: JobDefinition, field: K): string {
  const encode = DEFINITION_ENCODERS[field] as (value: JobDefinition[K]) => string;
  return encode(definition[field]);
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
  /** What `definitionHash(definition)` must equal for this job to be dispatched at all. */
  readonly authorisedHash: DefinitionHash;
};

/**
 * Whether a definition still matches the fingerprint it was authorised under.
 *
 * A union rather than a boolean, because the unauthorised arm has to carry both
 * hashes: the sentence a person needs is *"it was authorised as a1b2 and it is
 * now c3d4"*, and re-authorising means copying the second of those into the pin.
 */
export type Authorisation =
  | { readonly kind: "authorised"; readonly hash: DefinitionHash }
  | {
      readonly kind: "unauthorised";
      readonly authorised: DefinitionHash;
      readonly found: DefinitionHash;
      readonly why: string;
    };

export function authorisationOf(job: AuthorisedJob): Authorisation {
  const found = definitionHash(job.definition);
  if (found === job.authorisedHash) return { kind: "authorised", hash: found };
  return {
    kind: "unauthorised",
    authorised: job.authorisedHash,
    found,
    why:
      `this definition was authorised as ${job.authorisedHash} and now fingerprints as ${found}` +
      (job.definition.documents.length === 0
        ? ""
        : ` (its documents are ${job.definition.documents.map((document) => document.path).join(", ")})`) +
      ", so it is not the job that was queued and it will not be dispatched until somebody re-pins it",
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
  readonly jobId: string;
  readonly scheduledAt: string;
  readonly definitionHash: DefinitionHash;
};

/** The key as one greppable string. `job@instant#hash`, in that order, so `grep '^job-id@'` works. */
export function occurrenceId(key: OccurrenceKey): OccurrenceId {
  return `${key.jobId}@${key.scheduledAt}#${key.definitionHash}` as OccurrenceId;
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
  | { readonly kind: "unresolved"; readonly why: string };

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
export function standingOf(occurrence: Occurrence, nowMs: number): OccurrenceStanding {
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
    default: {
      const never: never = occurrence;
      throw new Error(`no standing for occurrence ${JSON.stringify(never)}`);
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
  | { readonly kind: "unresolved"; readonly at: string; readonly why: string };

/**
 * Whether a job may run now.
 *
 * A union rather than a boolean, because a scheduler that skips a job should be
 * able to say which of the three reasons it was — and because `held` is the one
 * a person needs to see in a log when a job has gone quiet.
 */
export type Due =
  | { readonly kind: "due"; readonly sinceMs: number }
  | { readonly kind: "not-due"; readonly remainingMs: number }
  | { readonly kind: "held"; readonly why: string };

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
 */
export function due(definition: JobDefinition, last: LastRun, nowMs: number): Due {
  switch (last.kind) {
    case "never":
      return { kind: "due", sinceMs: 0 };
    case "in-flight":
      return { kind: "held", why: `a run reserved at ${last.since} is still in flight (lease until ${last.leaseUntil})` };
    case "settled":
    case "unresolved": {
      const sinceMs = nowMs - Date.parse(last.at);
      if (sinceMs >= definition.everyMs) return { kind: "due", sinceMs };
      return { kind: "not-due", remainingMs: definition.everyMs - sinceMs };
    }
    default: {
      const never: never = last;
      throw new Error(`no due reading for ${JSON.stringify(never)}`);
    }
  }
}

/**
 * The job's most recent run, read out of the index against a clock.
 *
 * "Most recent" is by `scheduledAt` — the key's own instant — rather than by the
 * order the events landed, so a log written by two instances across a restart
 * still orders correctly.
 *
 * **A stuck occurrence is not `in-flight`.** That single line is the whole of
 * the S6 fix: the guard releases when the lease runs out, so the job's next
 * occurrence may be scheduled while the stuck one stays visible and unretried.
 */
export function lastRunOf(index: OccurrenceIndex, definition: JobDefinition, nowMs: number): LastRun {
  const hash = definitionHash(definition);
  let newest: Occurrence | null = null;
  for (const occurrence of index.values()) {
    if (occurrence.key.jobId !== definition.id) continue;
    // AN EDITED DEFINITION IS A DIFFERENT JOB. Its old occurrences are still in
    // the log and still visible; they just do not vouch for this one, so a job
    // whose `what` was rewritten reads as never having run rather than as
    // recently satisfied by a run of something else.
    //
    // **AND `never` HERE IS NOT A LICENCE TO RUN.** It used to be read as one,
    // which is how an edit became an immediate unauthorised dispatch (C2). The
    // scheduler asks `authorisationOf` BEFORE it asks this function anything,
    // so an edited definition never reaches `due` at all.
    if (occurrence.key.definitionHash !== hash) continue;
    if (newest === null || Date.parse(occurrence.key.scheduledAt) > Date.parse(newest.key.scheduledAt)) newest = occurrence;
  }
  if (newest === null) return { kind: "never" };
  const standing = standingOf(newest, nowMs);
  switch (standing.kind) {
    case "in-flight":
      return { kind: "in-flight", since: newest.reservedAt, leaseUntil: standing.leaseUntil };
    case "stuck":
      return {
        kind: "unresolved",
        at: newest.reservedAt,
        why: `its lease ran out ${Math.round(standing.overdueMs / 1000)}s ago and nothing said how it ended`,
      };
    case "settled":
      return { kind: "settled", at: standing.at };
    case "unresolved":
      return { kind: "unresolved", at: newest.reservedAt, why: standing.why };
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
          definitionHash: event.definitionHash,
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
      // AND THE RULE ARMS. A rule event is addressed BY an occurrence id and
      // says nothing about that occurrence's lifecycle — the reservation, the
      // start and the finish around it are the job events above. Folding one
      // here would let a finding move a run's state, which is a different
      // record silently editing this one.
      case "rule-intended":
      case "rule-settled":
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
