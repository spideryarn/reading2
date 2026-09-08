/**
 * **The deterministic rules, as arithmetic.** What a rule decides, never how it
 * looks or what it then does.
 *
 * **Pure. No I/O, no `Date.now()`, no `process`** — the same discipline as
 * `jobs.ts`, and for the same reason: a rule that decides to propose killing
 * four processes on a shared box is a decision somebody will want to reproduce
 * exactly, from the numbers it saw, months later. The impure halves live in
 * `rule-work.ts` (looking, and acting) and `scheduler.ts` (the ordering).
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
 * pinned too**, as `documents` entries: this file and `rule-work.ts`, digested,
 * exactly as a standing job pins the document it is an instruction to follow.
 * See `rule-jobs.ts` for which files and why those.
 *
 * ## `disposition` is the gate, and it is data
 *
 * A rule that may only propose carries `disposition: "propose"`, and
 * `scheduler.ts` has **no path from that arm to the actor** — the outcome is
 * written directly. So rule 2 cannot kill anything, and turning it into a rule
 * that could is an edit to a hashed field, which stops the job dead until
 * somebody re-pins it. That is a stronger statement than a comment saying the
 * actor is careful.
 */
import type { KillPolicy } from "../fleet/actions.js";

/** Which rule this is. One arm today; a union the day there are two. */
export type RuleId = "wedged-work";

/**
 * What a rule is allowed to do about what it finds.
 *
 * `propose` records the plan and takes nothing — the whole of rule 2 in v1,
 * because *"running it unattended is a different grant from a person clicking
 * confirm"* (the plan, § How the three rules behave). `act` exists so that the
 * protocol has its third step and the ordering can be tested; **nothing in this
 * build ships a spec that carries it**, and `rule-work.ts`'s actor refuses
 * anyway, so the two guards are independent.
 */
export type RuleDisposition = "propose" | "act";

/**
 * One rule's complete configuration — every knob, as data.
 *
 * Adding a field here without adding it to `canonicalRuleSpec` is the failure
 * this type is exposed to, and the exhaustive destructure there is what makes
 * the compiler say so.
 */
export type RuleSpec = {
  readonly kind: RuleId;
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
  const { kind, minAgeSeconds, policy, disposition } = spec;
  return [
    `rule:${kind.length}:${kind}`,
    `minAgeSeconds:${minAgeSeconds}`,
    `policy:${policy.length}:${policy}`,
    `disposition:${disposition.length}:${disposition}`,
  ].join("\n");
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
 * What the rule was able to see.
 *
 * **`cannot-see` is an arm rather than an empty list**, because "the fleet API
 * did not answer" and "nothing is wedged" are opposite facts and an empty array
 * would carry both. Off, nothing-to-do and could-not-look must never render the
 * same — the direction doc's own rule, and the thing the mutation check for
 * this stage breaks on purpose.
 */
export type RuleObservation =
  | { readonly kind: "seen"; readonly candidates: readonly WedgedProcess[]; readonly scanned: number }
  | { readonly kind: "cannot-see"; readonly why: string };

/** How many processes a proposal itself carries. A proposal listing five hundred pids is not reviewable, and `matched` still says the true count. */
export const PROPOSAL_MAX_PROCESSES = 20;

/**
 * What the rule found, in a form a later reader can check the arithmetic of.
 *
 * Every denominator is here — what the scan looked at, what the policy
 * licensed, what the threshold kept — because a finding that records only its
 * conclusion cannot be argued with afterwards.
 */
export type RuleFinding = {
  readonly kind: RuleId;
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
export function decideRule(spec: RuleSpec, observation: RuleObservation): RuleDecision {
  if (observation.kind === "cannot-see") {
    return { kind: "cannot-tell", why: observation.why };
  }
  const matched = observation.candidates
    .filter((process) => process.etimeSeconds >= spec.minAgeSeconds)
    .sort((a, b) => b.etimeSeconds - a.etimeSeconds);
  const finding: RuleFinding = {
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
