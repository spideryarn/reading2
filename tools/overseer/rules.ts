/**
 * **The deterministic rules, as arithmetic.** What a rule decides, never how it
 * looks or what it then does.
 *
 * **Pure. No I/O, no `Date.now()`, no `process`** — the same discipline as
 * `jobs.ts`, and for the same reason: a rule that decides to propose killing
 * four processes on a shared box is a decision somebody will want to reproduce
 * exactly, from the numbers it saw, months later. The impure halves live in
 * `rule-work.ts` (looking) and `rule-protocol.ts` (the ordering, and the runners).
 *
 * ## Why every knob is in here rather than in the code that runs it
 *
 * GPT Sol's SP-1 blocked the first draft of this stage over it. A dispatcher
 * that picks executable rule code by `definition.id` means **changing a
 * threshold or an action leaves the authorised pin valid** — so a rule could go
 * on running after its behaviour changed, which is precisely what gate 3's
 * *"never act on a job definition that changed after it was authorised"*
 * forbids, and a worse version of it than the document case the gate was
 * written for.
 *
 * So a rule's whole configuration is `RuleSpec`, `RuleSpec` is inside
 * `JobDefinition`, and `definitionHash()` covers it (`canonicalRuleSpec` below
 * is what it hashes). Move the threshold from 4 hours to 4 minutes and the job
 * refuses to dispatch until a person re-pins it. **And the implementation is
 * pinned too**, as `documents` entries: this file, `rule-work.ts` and
 * `rule-protocol.ts`, digested, exactly as a standing job pins the document it
 * is an instruction to follow. See `rule-jobs.ts` for which files and why those
 * — the protocol was left out first time round, and GPT Sol's SC-2 is why that
 * was wrong; 3a then pinned the whole of `scheduler.ts`, which was too broad,
 * and 3b split the protocol into its own file so that the pin covers what
 * decides and not what merely reports.
 *
 * ## `disposition` is the gate, and it is data
 *
 * A rule that may only propose carries `disposition: "propose"`, and that arm
 * selects `runProposingRule`, **which is handed a capability with no actor on
 * it**. So rule 2 cannot kill anything because there is nothing in the process
 * to kill with — not because a branch declines to. Turning it into a rule that
 * could is an edit to a hashed field, which stops the job dead until somebody
 * re-pins it; and the runner it would then select needs a capability no shipped
 * wiring supplies, so it would meet a refusal. That is a stronger statement than
 * a comment saying the actor is careful.
 */
import type { KillPolicy } from "../fleet/actions.js";

/** Which rule this is. */
export type RuleId = "wedged-work" | "launch-mode";

/**
 * What a rule is allowed to do about what it finds.
 *
 * `propose` records the plan and takes nothing — the whole of rule 2 in v1,
 * because *"running it unattended is a different grant from a person clicking
 * confirm"* (the plan, § How the three rules behave). `act` exists so that the
 * protocol has its third step and the ordering can be tested; **nothing in this
 * build ships a spec that carries it**, and nothing in this build holds an actor
 * for it to reach, so the two guards are independent.
 */
export type RuleDisposition = "propose" | "act";

/**
 * **Rule 2's complete configuration — every knob, as data.**
 *
 * Adding a field here without adding it to `WEDGED_WORK_ENCODERS` is the failure
 * this type is exposed to, and the mapped type there is what makes the compiler
 * say so — see `SpecEncoders` for why a destructure did not.
 */
export type WedgedWorkSpec = {
  readonly kind: "wedged-work";
  /**
   * How long a process must have been running before it is worth proposing.
   *
   * **The threshold is age, not cost.** The specimen this rule was written
   * against — pid 2282035, `npm exec playwright@1.62.1 install webkit` — held
   * 2.9 MB and 0.0% of a core for nineteen hours, so a rule that fired on
   * resource consumption would never have fired on the case we actually have.
   */
  readonly minAgeSeconds: number;
  /** Which named kill rules license a candidate. `rule-work.ts` asks the dashboard for exactly this policy's dry run. */
  readonly policy: KillPolicy;
  readonly disposition: RuleDisposition;
};

/** **Rule 1's complete configuration.** Two knobs: how many drifted sessions are worth a sentence, and how stale a collection may be before it is not evidence. */
export type LaunchModeSpec = {
  readonly kind: "launch-mode";
  /**
   * How many agent sessions must be in a mode that is not auto before the rule
   * says anything. **One**, in the shipped spec.
   *
   * It looks like a knob that could only ever be 1, and it is here for the
   * reason SP-1 exists: the firing condition has to be **data inside the
   * fingerprint**, not a literal in code that can be edited while the
   * authorisation stays valid. A rule whose threshold lives in an `if` is a
   * rule whose behaviour can change without a re-pin.
   */
  readonly minSessions: number;
  /**
   * How old a collection may have been **when the dashboard served it** and
   * still be worth believing.
   *
   * Rule 1 reads a cached payload rather than commanding a fresh look, so
   * unlike rule 2 it can be handed a reading from before the thing it is
   * checking. Five minutes, sized off `daemon.ts`'s `STALE_FLOOR_MS` — the same
   * magnitude for a near-enough question — and a separate constant because it
   * is a different question: that one asks how long the Overseer's own stream
   * may be silent, this one how old the dashboard's own last look may be.
   *
   * Measured on 2026-09-08: `/api/state` served a collection 56s old.
   */
  readonly maxCollectionAgeSeconds: number;
  readonly disposition: RuleDisposition;
};

/**
 * One rule's complete configuration.
 *
 * **A discriminated union rather than a bag of optionals**, so a spec cannot
 * carry rule 2's threshold and rule 1's disposition at once, and so
 * `canonicalRuleSpec` below cannot hash a field the rule never reads.
 */
export type RuleSpec = WedgedWorkSpec | LaunchModeSpec;

/**
 * HOW EACH KNOB IS ENCODED — one entry per field, and the compiler counts them.
 *
 * **This looks like ceremony and is not.** It used to be a destructure —
 * `const { kind, minAgeSeconds, policy, disposition } = spec` — and a
 * destructure is **not exhaustive in TypeScript**: a fifth field on a spec
 * compiles perfectly and is silently left out of the fingerprint, which is SP-1
 * — the finding this whole stage exists to answer — reopened by one line. GPT
 * Sol's SC-4, and the test named "every knob" could not have caught it, because
 * it enumerates today's fields by hand.
 *
 * A mapped type over `keyof S` cannot be satisfied by an object literal that is
 * missing a key, so **a new knob is a compile error until somebody says how it
 * is hashed**. That is the guarantee the comment above used to claim.
 *
 * **One table per arm, and that is not a weakening.** `keyof RuleSpec` over a
 * union is only the fields the arms SHARE — `kind` and `disposition` — so a
 * single table would have stopped covering every threshold the moment there
 * were two rules, which is SC-4 reopened by the union instead of by a
 * destructure. Each arm gets its own exhaustive table, and `RULE_SPEC_ENCODERS`
 * below is keyed by `RuleId`, so a new rule is a compile error until it says
 * how its spec is hashed.
 *
 * The declaration order within a table IS that rule's encoding order, so moving
 * a line moves its hash. That is a re-pin rather than a hazard: this file is
 * itself a pinned document (`rule-jobs.ts` § RULE_SOURCES), so any edit to it
 * was moving the pin anyway.
 */
type SpecEncoders<S> = { readonly [K in keyof S]-?: (value: S[K]) => string };

const WEDGED_WORK_ENCODERS: SpecEncoders<WedgedWorkSpec> = {
  kind: (kind) => `kind:${kind.length}:${kind}`,
  minAgeSeconds: (minAgeSeconds) => `minAgeSeconds:${minAgeSeconds}`,
  policy: (policy) => `policy:${policy.length}:${policy}`,
  disposition: (disposition) => `disposition:${disposition.length}:${disposition}`,
};

const LAUNCH_MODE_ENCODERS: SpecEncoders<LaunchModeSpec> = {
  kind: (kind) => `kind:${kind.length}:${kind}`,
  minSessions: (minSessions) => `minSessions:${minSessions}`,
  maxCollectionAgeSeconds: (maxCollectionAgeSeconds) => `maxCollectionAgeSeconds:${maxCollectionAgeSeconds}`,
  disposition: (disposition) => `disposition:${disposition.length}:${disposition}`,
};

/** Every rule's table, keyed by its id — so adding a `RuleId` without an encoder table does not compile. */
const RULE_SPEC_ENCODERS: { readonly [K in RuleId]: SpecEncoders<Extract<RuleSpec, { kind: K }>> } = {
  "wedged-work": WEDGED_WORK_ENCODERS,
  "launch-mode": LAUNCH_MODE_ENCODERS,
};

/**
 * The fields each rule's fingerprint covers, in encoding order.
 *
 * Derived from the tables rather than typed out, and exported so a test can
 * hold each against its own spec's keys — which is what makes reverting to a
 * destructure a red test rather than a silent loss of coverage.
 */
export const RULE_SPEC_HASHED_FIELDS: { readonly [K in RuleId]: readonly (keyof Extract<RuleSpec, { kind: K }>)[] } = {
  "wedged-work": Object.keys(RULE_SPEC_ENCODERS["wedged-work"]) as (keyof WedgedWorkSpec)[],
  "launch-mode": Object.keys(RULE_SPEC_ENCODERS["launch-mode"]) as (keyof LaunchModeSpec)[],
};

/**
 * One spec through its own arm's table.
 *
 * The cast is TypeScript's known limitation rather than a hole: indexing a
 * mapped type with a generic key gives a UNION of encoders, whose parameter
 * types intersect to `never`, so the honest call does not compile. It is sound
 * by construction — the table is keyed by `keyof S` and the value handed over
 * is `spec[field]` — and it buys the thing the whole arrangement is for: each
 * encoder receives exactly its own field's type.
 */
function encodeSpec<S extends object>(spec: S, encoders: SpecEncoders<S>): string {
  return (Object.keys(encoders) as (keyof S)[]).map((field) => (encoders[field] as (value: S[keyof S]) => string)(spec[field])).join("\n");
}

/**
 * The canonical form `definitionHash` hashes.
 *
 * Length-prefixed like `jobs.ts`'s, and for the same reason: without it a spec
 * with `policy: "safe"` and `disposition: "to-killpropose"` could hash the same
 * as the real one. `JSON.stringify` is deliberately not used — its key order is
 * insertion order, so two specs a reader would call identical can hash
 * differently.
 */
export function canonicalRuleSpec(spec: RuleSpec): string {
  switch (spec.kind) {
    case "wedged-work":
      return encodeSpec(spec, RULE_SPEC_ENCODERS["wedged-work"]);
    case "launch-mode":
      return encodeSpec(spec, RULE_SPEC_ENCODERS["launch-mode"]);
    default: {
      const never: never = spec;
      throw new Error(`no canonical form for rule spec ${JSON.stringify(never)}`);
    }
  }
}

/**
 * One process a kill policy would license, as the dashboard's own dry run
 * describes it.
 *
 * **The field names are the dashboard's `KillCandidate`, deliberately**, so the
 * number this rule records and the number the page shows come from one object
 * rather than two hand-written declarations of the same idea. `etimeSeconds` is
 * already there, which is why the age threshold needs no second source and this
 * stage writes no second process scan.
 */
export type WedgedProcess = {
  readonly pid: number;
  /** The named rule that licensed it — `cwd-deleted` for a worktree removed out from under a running process. */
  readonly rule: string;
  readonly why: string;
  readonly comm: string;
  readonly args: string;
  readonly rssKiB: number;
  readonly etimeSeconds: number;
};

/**
 * **WHICH PERMISSION MODE ONE SESSION LAUNCHED IN — our own four arms, parsed
 * off the wire.**
 *
 * The same shape as `PaneAutoMode` in `tools/fleet/pane.ts` and
 * `FleetPermissionMode` in the client's `types.ts`, and declared here rather
 * than imported for the reason that file gives: this is a consumer of a wire
 * payload, and a consumer that adopts the producer's type has no arm left for
 * *"the producer sent something this build has never met"*. `pane.ts` also
 * reaches `node:child_process`.
 *
 * **THE FOUR ARMS ARE FOUR AND COLLAPSING ANY TWO IS THE BUG.** `not-auto` is
 * something to go and fix now. `not-applicable` is a shell, which has no
 * permission mode and must never wear a warning. `cannot-tell` is neither — it
 * must not read as "fine", which hides the defect, and it must not read as
 * "broken", which on twenty rows teaches the reader to ignore the badge and
 * costs more than the defect does. That last one is measured, in `pane.ts`.
 */
export type ObservedLaunchMode =
  | { readonly kind: "auto" }
  | { readonly kind: "not-auto"; readonly mode: string }
  | { readonly kind: "cannot-tell"; readonly why: string }
  | { readonly kind: "not-applicable"; readonly why: string };

/** One session, as rule 1 reads it: enough to name it in a sentence a person acts on, and nothing else. */
export type ObservedSession = {
  /** tmux's session handle, `$1643` — the address, and stable across renames. */
  readonly id: string;
  readonly name: string;
  readonly mode: ObservedLaunchMode;
};

/**
 * How old the collection was **when the dashboard served it** — measured with
 * the dashboard's own clock at both ends, so there is no skew to argue about.
 *
 * **`collected: false` is an arm rather than an age of zero.** `state.ts`'s own
 * rule: an empty `rows` is only a claim about the box when `collectedAt` is
 * non-null, so a freshly restarted dashboard reporting no drift is not the same
 * fact as a box with no drift.
 */
export type ObservedCollection = { readonly collected: false } | { readonly collected: true; readonly ageSeconds: number };

/**
 * What a rule was able to see.
 *
 * **`cannot-see` is an arm rather than an empty list**, because "the fleet API
 * did not answer" and "nothing is wedged" are opposite facts and an empty array
 * would carry both. Off, nothing-to-do and could-not-look must never render the
 * same — the direction doc's own rule, and the thing the mutation check for
 * this stage breaks on purpose.
 *
 * The two sighting arms are named for what they are sightings OF rather than
 * both being `seen`, so an observer wired to the wrong rule is a `cannot-tell`
 * that says so instead of a decision taken on the wrong evidence.
 */
export type RuleObservation =
  | { readonly kind: "wedged"; readonly candidates: readonly WedgedProcess[]; readonly scanned: number }
  | { readonly kind: "launch-modes"; readonly collection: ObservedCollection; readonly sessions: readonly ObservedSession[] }
  | { readonly kind: "cannot-see"; readonly why: string };

/** How many processes a proposal itself carries. A proposal listing five hundred pids is not reviewable, and `matched` still says the true count. */
export const PROPOSAL_MAX_PROCESSES = 20;

/** And how many sessions. Same argument, same number: nineteen rows on this box on 2026-09-08, so twenty is the whole fleet and still readable. */
export const PROPOSAL_MAX_SESSIONS = 20;

/**
 * What rule 2 found, in a form a later reader can check the arithmetic of.
 *
 * Every denominator is here — what the scan looked at, what the policy
 * licensed, what the threshold kept — because a finding that records only its
 * conclusion cannot be argued with afterwards.
 */
export type WedgedWorkFinding = {
  readonly kind: "wedged-work";
  readonly policy: KillPolicy;
  readonly minAgeSeconds: number;
  /** How many processes passed the threshold. The numerator. */
  readonly matched: number;
  /** How many the policy licensed at all, before the threshold. */
  readonly candidates: number;
  /** How many processes the scan read. */
  readonly scanned: number;
  /** The matched processes, bounded by `PROPOSAL_MAX_PROCESSES`. */
  readonly processes: readonly WedgedProcess[];
};

/** One session that did not come up in auto mode, as a person needs to see it to go and relaunch it. */
export type DriftedSession = { readonly id: string; readonly name: string; readonly mode: string };

/**
 * What rule 1 found.
 *
 * **The four arms are four counts and they are never summed here.** A reader
 * checking this afterwards has to be able to see that the eight healthy rows
 * were eight rows we READ, not eight rows we failed to read — which is the
 * whole distinction, and a single `healthy` number would have destroyed it.
 * `notApplicable` is kept out of every ratio: a shell has no permission mode,
 * so it is neither numerator nor denominator (SP-11's *"3 of 15"*).
 */
export type LaunchModeFinding = {
  readonly kind: "launch-mode";
  /** The threshold, as it was applied. */
  readonly minSessions: number;
  readonly maxCollectionAgeSeconds: number;
  /** How old the collection was when it was served — the reading the threshold was applied to. */
  readonly collectionAgeSeconds: number;
  /** Rows that read `auto`. */
  readonly auto: number;
  /** Rows that named a mode we know is not auto. The numerator. */
  readonly notAuto: number;
  /** Rows whose mode could not be read. **Neither of the above**, and that is the point. */
  readonly cannotTell: number;
  /** Rows with no permission mode to read at all — shells. Outside every ratio. */
  readonly notApplicable: number;
  /** Every row the payload carried, including the shells. The outermost denominator. */
  readonly rows: number;
  /** The drifted sessions, bounded by `PROPOSAL_MAX_SESSIONS`. */
  readonly sessions: readonly DriftedSession[];
};

/** What a rule found. One arm per rule, so a finding cannot carry another rule's arithmetic. */
export type RuleFinding = WedgedWorkFinding | LaunchModeFinding;

/**
 * What one run of a rule decided, before anything was written down or done.
 *
 * Three arms, and keeping them three is the point: `nothing` is a rule that ran
 * and had nothing to say, `cannot-tell` is a rule that could not look, and only
 * `propose` carries a plan.
 */
export type RuleDecision =
  | { readonly kind: "propose"; readonly what: string; readonly finding: RuleFinding }
  | { readonly kind: "nothing"; readonly why: string }
  | { readonly kind: "cannot-tell"; readonly why: string };

/**
 * How a rule's run ended, durably.
 *
 * `proposed` and `sent` are different endings and not two words for one:
 * `proposed` means **nothing was taken**, which is rule 2's only ending in v1.
 * `refused` is a fact — a gate, a switch or the far end said no, so the action
 * did not happen. `failed` says nothing can be told about whether it happened,
 * which is the arm a caller must not flatten into `refused`.
 */
export type RuleOutcome =
  | { readonly kind: "nothing-to-do"; readonly why: string }
  | { readonly kind: "proposed"; readonly what: string }
  | { readonly kind: "sent"; readonly what: string }
  | { readonly kind: "refused"; readonly why: string }
  | { readonly kind: "failed"; readonly why: string };

/** Hours, to one decimal, for a sentence a person reads at 8am. */
function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * What one run of a rule decided — the dispatcher, and it is exhaustive.
 *
 * **An observation of the wrong shape is a `cannot-tell`, never a `nothing`.**
 * The observer is a function a caller supplies, so the pairing is a thing a
 * caller can get wrong, and a rule that read an empty wedged-process list as
 * *"no session drifted"* would be a clean bill issued from evidence about
 * something else.
 */
export function decideRule(spec: RuleSpec, observation: RuleObservation): RuleDecision {
  if (observation.kind === "cannot-see") {
    return { kind: "cannot-tell", why: observation.why };
  }
  switch (spec.kind) {
    case "wedged-work":
      if (observation.kind !== "wedged") {
        return { kind: "cannot-tell", why: `the observer answered with a "${observation.kind}" sighting, which the wedged-work rule cannot read` };
      }
      return decideWedgedWork(spec, observation);
    case "launch-mode":
      if (observation.kind !== "launch-modes") {
        return { kind: "cannot-tell", why: `the observer answered with a "${observation.kind}" sighting, which the launch-mode rule cannot read` };
      }
      return decideLaunchMode(spec, observation);
    default: {
      const never: never = spec;
      throw new Error(`no decision for rule spec ${JSON.stringify(never)}`);
    }
  }
}

/**
 * **RULE 1: LAUNCH-MODE DRIFT. It observes and never acts.**
 *
 * A session that did not come up in auto mode stalls at its next unapprovable
 * call — `git fetch`, `git log`, an MCP read, i.e. within the first minute of
 * almost any brief written here — and waits for somebody who is asleep. 34.9
 * agent-hours since 2026-09-06, 20% of launches, longest single stall 7.38
 * hours; nothing else on this box notices, because `gjd-remote log` lists such
 * a session as `running`.
 *
 * **It is a regression alarm rather than a live cost.** The launcher fix landed
 * at 12:20 on 2026-09-08 and every agent row has read `auto` since. The hours
 * are sunk; what this watches is whether they start again.
 *
 * **There is no reversible action, so `disposition` is `propose` and there is
 * nothing for an actor to do even if one existed.** You cannot type
 * `/permission-mode auto` into a running session and may not answer its dialog;
 * the only remedy is kill-and-relaunch, the least reversible thing on the list,
 * and the sentence says so.
 */
function decideLaunchMode(spec: LaunchModeSpec, observation: Extract<RuleObservation, { kind: "launch-modes" }>): RuleDecision {
  const collection = observation.collection;
  if (!collection.collected) {
    // `state.ts`'s rule, on the consumer's side: rows are a claim about the box
    // only once a collection has finished. A dashboard restarted a second ago
    // reports no drift about a box it has never looked at.
    return { kind: "cannot-tell", why: "the dashboard has never finished a collection, so its row list is not yet a claim about the box" };
  }
  if (collection.ageSeconds > spec.maxCollectionAgeSeconds) {
    // A STALE READING IS NOT A CLEAN BILL. Rule 1 reads a cached payload rather
    // than commanding a fresh look, so this is the arm that keeps "we cannot
    // see" apart from "there is nothing to see".
    return {
      kind: "cannot-tell",
      why:
        `the newest collection was ${collection.ageSeconds}s old when the dashboard served it, past the ` +
        `${spec.maxCollectionAgeSeconds}s this rule will believe, so nothing it says about permission modes is current`,
    };
  }
  // THE FOUR ARMS, COUNTED SEPARATELY. Summing any two of them here is the bug
  // this rule exists to avoid making.
  const drifted: DriftedSession[] = [];
  let auto = 0;
  let cannotTell = 0;
  let notApplicable = 0;
  for (const session of observation.sessions) {
    switch (session.mode.kind) {
      case "auto":
        auto += 1;
        break;
      case "not-auto":
        drifted.push({ id: session.id, name: session.name, mode: session.mode.mode });
        break;
      case "cannot-tell":
        cannotTell += 1;
        break;
      case "not-applicable":
        notApplicable += 1;
        break;
      default: {
        const never: never = session.mode;
        throw new Error(`no count for launch mode ${JSON.stringify(never)}`);
      }
    }
  }
  const finding: LaunchModeFinding = {
    kind: spec.kind,
    minSessions: spec.minSessions,
    maxCollectionAgeSeconds: spec.maxCollectionAgeSeconds,
    collectionAgeSeconds: collection.ageSeconds,
    auto,
    notAuto: drifted.length,
    cannotTell,
    notApplicable,
    rows: observation.sessions.length,
    sessions: drifted.slice(0, PROPOSAL_MAX_SESSIONS),
  };
  // THE DENOMINATOR IS AGENT SESSIONS, NOT ROWS. SP-11: "3 of 15" mixed eight
  // agent sessions with seven shells, and a shell has no permission mode to
  // have got wrong.
  const agents = auto + drifted.length + cannotTell;
  const unreadable = `${cannotTell} could not be read`;
  if (drifted.length < spec.minSessions) {
    return {
      kind: "nothing",
      why:
        `${drifted.length} of ${agents} agent session(s) are not in auto mode, under the ${spec.minSessions} this rule reports on; ` +
        `${auto} read auto, ${unreadable}, and ${notApplicable} row(s) have no permission mode to read`,
    };
  }
  const named = finding.sessions.map((session) => `${session.name} (${session.id}, ${session.mode})`).join(", ");
  return {
    kind: "propose",
    // THE SENTENCE, and what it must say is the REMEDY. A running session
    // cannot be switched into auto mode and its dialog may not be answered by
    // anything unattended, so the only fix is a person killing and relaunching
    // it — and a proposal that leaves that out reads like something that
    // happened.
    what:
      `relaunch ${drifted.length} of ${agents} agent session(s) that did not come up in auto mode and will stall at the next ` +
      `unapprovable call — needs a person: a running session cannot be switched into auto mode, so the only remedy is ` +
      `kill-and-relaunch. ${named}. ${cannotTell} more could not be read.`,
    finding,
  };
}

/**
 * **Rule 2: work that is wedged.**
 *
 * A process the box's own safe-kill policy already licenses, that has been
 * running longer than the threshold. It writes no second process scan and
 * invents no second recogniser: `killRoute`'s dry run has already computed the
 * candidates and their ages, and this is the arithmetic on top.
 *
 * The oldest is named in the sentence rather than the first, because the
 * sentence is read by somebody deciding whether to look, and the oldest is the
 * one that says how long this has been going on.
 */
function decideWedgedWork(spec: WedgedWorkSpec, observation: Extract<RuleObservation, { kind: "wedged" }>): RuleDecision {
  const matched = observation.candidates
    .filter((process) => process.etimeSeconds >= spec.minAgeSeconds)
    .sort((a, b) => b.etimeSeconds - a.etimeSeconds);
  const finding: WedgedWorkFinding = {
    kind: spec.kind,
    policy: spec.policy,
    minAgeSeconds: spec.minAgeSeconds,
    matched: matched.length,
    candidates: observation.candidates.length,
    scanned: observation.scanned,
    processes: matched.slice(0, PROPOSAL_MAX_PROCESSES),
  };
  if (matched.length === 0) {
    return {
      kind: "nothing",
      why:
        `nothing is wedged: ${observation.candidates.length} process(es) out of ${observation.scanned} scanned match the ` +
        `${spec.policy} policy, and none has been running for ${hours(spec.minAgeSeconds)} or more`,
    };
  }
  const oldest = matched[0];
  const rules = [...new Set(matched.map((process) => process.rule))].sort().join(", ");
  return {
    kind: "propose",
    // THE SENTENCE, and its shape is the acceptance criterion for this stage:
    // it has to say what would be killed, under which named rule, and that a
    // person still has to confirm it. "needs confirm" is not decoration — it is
    // the difference between this line and one describing something that
    // happened.
    what:
      `kill ${matched.length} of ${observation.candidates.length} candidate process(es) — rule ${rules} — needs confirm; ` +
      `oldest is pid ${oldest?.pid ?? 0} (${oldest?.args ?? oldest?.comm ?? "unknown"}) at ${hours(oldest?.etimeSeconds ?? 0)}`,
    finding,
  };
}

/** One outcome as a line a person reads. The distinctions above survive into the sentence, or they were not distinctions. */
export function describeRuleOutcome(outcome: RuleOutcome): string {
  switch (outcome.kind) {
    case "nothing-to-do":
      return `nothing to do — ${outcome.why}`;
    case "proposed":
      return `proposed: ${outcome.what}`;
    case "sent":
      return `sent: ${outcome.what}`;
    case "refused":
      return `refused: ${outcome.why}`;
    case "failed":
      return `failed: ${outcome.why}`;
    default: {
      const never: never = outcome;
      throw new Error(`no sentence for rule outcome ${JSON.stringify(never)}`);
    }
  }
}
