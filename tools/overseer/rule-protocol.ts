/**
 * **THE TWO-PHASE RULE PROTOCOL, AND THE FILE EVERY RULE IS PINNED TO.**
 *
 *     detect  ──▶  append `rule-intended` and fsync it  ──▶  act  ──▶  append `rule-settled`
 *
 * One protocol, one file, and every rule job carries its digest
 * (`rule-jobs.ts` § RULE_SOURCES). That pin is the second half of GPT Sol's
 * SP-1: a rule's threshold and its `disposition` are hashed data, so the code
 * that *interprets* the disposition has to be hashed too, or a change that
 * bypassed the dispatch below would leave every rule's authorised hash
 * perfectly current.
 *
 * ## Why this is not `scheduler.ts`, which is where it used to live
 *
 * Stage 3a answered SC-2 by putting the whole of `scheduler.ts` in
 * `RULE_SOURCES`. Right in principle and far too broad in practice:
 * `scheduler.ts` also carries session dispatch, the sweep, and
 * `describeReport`'s wording, so **every rule's authorisation was hostage to a
 * file that changes for reasons having nothing to do with rules.** It re-pinned
 * twice in one session; with three rules, rewording a log sentence would disarm
 * all three, and a tripwire that mostly fires falsely teaches whoever meets it
 * to re-pin without reading.
 *
 * So the line is drawn at **what decides whether and how to act**. Everything
 * in this file changes the answer to *may this rule act, and was its decision
 * durable before it did* — the disposition switch, the ordering, the
 * fail-closed append. Nothing in it merely reports: no `describeReport`, no
 * sweep, no dispatch. `tests/overseer-rules.test.ts` § "what a rule's pin covers"
 * asserts **both** directions over a real checkout, because a test that only
 * proves the protocol is covered would also pass if `RULE_SOURCES` named the
 * whole repository.
 *
 * The alternative Sol offered — move the disposition interpretation into
 * pinned rule-specific code — was refused, because it hands every rule its own
 * copy of the append-before-act ordering, which is exactly what SP-2 forbade.
 *
 * ## Three things are deliberately NOT symmetrical
 *
 *  - A rule with nothing to say, or one that could not look, appends **one**
 *    terminal event. There was no intent, so there is nothing to fail closed
 *    on, and writing an intent nobody had would put a decision in the log that
 *    was never taken.
 *  - **A proposing rule is a different function with a smaller capability.**
 *    `runProposingRule` is handed an object that has no `act` on it, so there
 *    is no actor for it to decline to call. That is SC-2: the old single runner
 *    separated the two dispositions with a `switch` while holding both halves,
 *    which is a conditional wearing the clothes of a boundary.
 *  - The occurrence's own outcome is `failed` only when the **protocol** broke
 *    (an append lost, an actor that threw). A rule that ran and was refused is
 *    a run that completed; what it decided is in `rule-settled`, which is the
 *    record for that question.
 */
import type { JobEvent, RuleEvent } from "./diff.js";
import type { JobOutcome, JobSpawn, OccurrenceId } from "./jobs.js";
import { decideRule, describeRuleOutcome, type RuleObservation, type RuleOutcome, type RuleSpec } from "./rules.js";
import type { AppendResult } from "./store.js";

/**
 * **LOOKING, AND NOTHING ELSE — the whole capability a proposing rule is given.**
 *
 * There is no `act` on this type, and that absence is the point. The first
 * version of this stage gave every rule run an actor and separated proposing
 * from acting with a runtime `switch (spec.disposition)`, which GPT Sol's SC-2
 * called *"precisely the conditional boundary the claim said had been avoided"*
 * — and he was right: a process that holds an actor is one edit away from
 * reaching it. Now a proposing rule is run by `runProposingRule`, which is
 * handed one of these, so there is no actor **in the process** to reach.
 *
 * The ordering that follows is this module's and is not injectable, which is
 * SP-2: a runner handed `record` and trusted to append before it acts is a
 * runner that can be written the other way round, and *"a rule that acted and
 * then failed to append has taken an action nobody can review"* is the gate-1
 * failure the ordering exists to prevent.
 */
export type ProposingRuleWork = {
  /**
   * The pid an in-process run is recorded under.
   *
   * The daemon's own, because it is the only truthful positive pid under the
   * current schema (GPT Sol's Q1). Injected rather than read from `process`,
   * so this module goes on having no globals.
   */
  readonly selfPid: number;
  /** LOOK. Reads the box and never acts — the dashboard's own dry run for rule 2, its cached state for rule 1. */
  readonly observe: (spec: RuleSpec) => Promise<RuleObservation>;
};

/**
 * **LOOKING AND ACTING — a strictly larger capability, and nothing in this build
 * constructs one.**
 *
 * `scripts/overseer.ts` hands the daemon a `ProposingRuleWork` and `daemon.ts`
 * has no option that could carry this, so the only callers are tests. Stage 3d
 * is what wires it, and it cannot do so by flipping a disposition: an acting
 * rule that dies between its action and its settlement leaves an unpaired
 * `rule-intended` and becomes eligible again, which needs the durable rule-run
 * index named as a precondition on 3d in
 * `docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md`.
 */
export type ActingRuleWork = ProposingRuleWork & {
  /** ACT on a proposal this module has ALREADY recorded and fsynced. */
  readonly act: (spec: RuleSpec, what: string) => Promise<RuleOutcome>;
};

/**
 * The only thing the protocol needs from the store: somewhere to append that
 * fsyncs before it answers.
 *
 * Narrower than the scheduler's `OccurrenceLog`, which the real store also
 * satisfies, so this module does not import the scheduler — which is what keeps
 * the pinned file from depending on the unpinned one.
 */
export type RuleLog = {
  append(events: readonly (JobEvent | RuleEvent)[]): AppendResult;
};

/** Everything a rule run reads from the world: a place to write, and the clock. Nothing here reads a global. */
export type RuleContext = {
  readonly store: RuleLog;
  /** Injected, always. Nothing in this area reads the wall clock for itself. */
  readonly now: () => Date;
};

/**
 * What this process holds — looking, acting, or neither.
 *
 * Two independent optionals rather than one union, because they are two
 * separate grants and a daemon may hold the first without the second. **Absent
 * is a refusal**, and the sentence names the capability that is missing rather
 * than claiming a policy declined.
 */
export type RuleCapabilities = {
  readonly rules?: ProposingRuleWork | undefined;
  readonly acting?: ActingRuleWork | undefined;
};

/**
 * **THE DISPOSITION CHOOSES A RUNNER AND A CAPABILITY**, not a branch inside one
 * runner that holds both.
 *
 * `runProposingRule` is handed an object with no `act` on it; `runActingRule`
 * needs an `acting` capability, which no shipped wiring supplies. So bypassing
 * this switch does not reach an actor — it reaches an absent one. And because
 * this file is pinned, editing the switch at all moves every rule's
 * fingerprint, which is the guarantee SC-2 asked for.
 */
export function startRule(context: RuleContext, spec: RuleSpec, id: OccurrenceId, capabilities: RuleCapabilities): JobSpawn {
  switch (spec.disposition) {
    case "propose": {
      const rules = capabilities.rules;
      if (rules === undefined) {
        return { kind: "refused", why: "this daemon was started with no rule runner, so a deterministic rule cannot be run here" };
      }
      return runProposingRule(context, rules, spec, id);
    }
    case "act": {
      const acting = capabilities.acting;
      if (acting === undefined) {
        return {
          kind: "refused",
          why:
            `this daemon holds no actor, so the ${spec.kind} rule's "act" disposition cannot be carried out here — ` +
            "the capability is absent from the process rather than declined by it",
        };
      }
      return runActingRule(context, acting, spec, id);
    }
    default: {
      const never: never = spec.disposition;
      throw new Error(`no runner for rule disposition ${JSON.stringify(never)}`);
    }
  }
}

/**
 * A rule that may only propose, run by code that **holds no actor**.
 *
 * There is no `switch` here declining to act and no callback being left
 * uncalled: `look` is a `ProposingRuleWork`, whose type has no `act` member, and
 * `scripts/overseer.ts` builds exactly that and nothing more. So the sentence
 * *"rule 2 cannot kill anything"* is a statement about what this process
 * contains rather than about which branch it takes.
 */
function runProposingRule(context: RuleContext, look: ProposingRuleWork, spec: RuleSpec, id: OccurrenceId): JobSpawn {
  const done = (async (): Promise<JobOutcome> => {
    const intent = await intend(context, look, spec, id);
    if (intent.kind === "settled") return intent.outcome;
    return settleRule(context, id, spec, { kind: "proposed", what: intent.what });
  })();
  return { kind: "spawned", pid: look.selfPid, done };
}

/**
 * A rule that may act, run by code that holds the actor — **and nothing outside
 * the tests constructs one of these.**
 *
 * It exists so the protocol has its third step and the ordering can be tested
 * against a real actor, which is what proves the append-before-act sequence. 3d
 * is what wires it, behind the preconditions the plan names.
 */
function runActingRule(context: RuleContext, work: ActingRuleWork, spec: RuleSpec, id: OccurrenceId): JobSpawn {
  const done = (async (): Promise<JobOutcome> => {
    const intent = await intend(context, work, spec, id);
    if (intent.kind === "settled") return intent.outcome;

    // (2) THE ACTION, and it is reached only because the intent is fsynced.
    let outcome: RuleOutcome;
    try {
      outcome = await work.act(spec, intent.what);
    } catch (cause) {
      // A THROW IS NOT A REFUSAL, the same distinction `dispatch` draws about
      // spawning: an actor that broke its contract has told us nothing about
      // whether the action landed.
      outcome = { kind: "failed", why: `the actor threw instead of answering: ${messageOf(cause)}` };
    }

    // (3) THE ENDING.
    return settleRule(context, id, spec, outcome);
  })();
  return { kind: "spawned", pid: work.selfPid, done };
}

/**
 * What one run has decided, once that decision is durable.
 *
 * `intend` is the half both runners share, and it is shared deliberately: it is
 * the half that must be **identical**, because a proposing runner that recorded
 * its decision differently from the acting one would make the log's two
 * families of rule mean two different things.
 */
type Intent =
  /** There is a plan, and it is already on the disk. */
  | { readonly kind: "proposed"; readonly what: string }
  /** There was nothing to do, nothing could be seen, or the intent would not land. Already settled; the caller has nothing left to decide. */
  | { readonly kind: "settled"; readonly outcome: JobOutcome };

async function intend(context: RuleContext, look: ProposingRuleWork, spec: RuleSpec, id: OccurrenceId): Promise<Intent> {
  let observation: RuleObservation;
  try {
    observation = await look.observe(spec);
  } catch (cause) {
    // A THROW FROM THE OBSERVER IS NOT A SIGHTING. It is the same fact as a
    // refusal from the far end — we could not look — and it must not be
    // flattened into an empty candidate list, which would read as "nothing
    // is wedged".
    observation = { kind: "cannot-see", why: `looking at the fleet threw instead of answering: ${messageOf(cause)}` };
  }
  const decision = decideRule(spec, observation);
  if (decision.kind !== "propose") {
    return {
      kind: "settled",
      outcome: settleRule(
        context,
        id,
        spec,
        decision.kind === "nothing" ? { kind: "nothing-to-do", why: decision.why } : { kind: "refused", why: decision.why },
      ),
    };
  }

  // (1) THE INTENT, AND NOTHING IS DONE ABOUT IT UNTIL IT IS ON THE DISK.
  const intended = record(context.store, [
    {
      kind: "rule-intended",
      at: context.now().toISOString(),
      occurrenceId: id,
      ruleId: spec.kind,
      what: decision.what,
      finding: decision.finding,
    },
  ]);
  if (!intended.ok) {
    // FAIL CLOSED. The action is not attempted, and the occurrence ends as a
    // failure so that a run which decided something and did nothing about it
    // is visible rather than looking like a quiet success.
    return {
      kind: "settled",
      outcome: { kind: "failed", why: `the rule's intent could not be recorded, so nothing was done about it: ${intended.why}` },
    };
  }
  return { kind: "proposed", what: decision.what };
}

/** Write down how a rule's run ended, and say so in the occurrence when even that could not be written down. */
function settleRule(context: RuleContext, id: OccurrenceId, spec: RuleSpec, outcome: RuleOutcome): JobOutcome {
  const wrote = record(context.store, [
    { kind: "rule-settled", at: context.now().toISOString(), occurrenceId: id, ruleId: spec.kind, outcome },
  ]);
  if (!wrote.ok) {
    return { kind: "failed", why: `the rule ${describeRuleOutcome(outcome)} and that could not be recorded: ${wrote.why}` };
  }
  return outcome.kind === "failed" ? { kind: "failed", why: outcome.why } : { kind: "exited", code: 0 };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * **EVERY WAY AN APPEND CAN FAIL, AS ONE CLOSED DOOR.** A refusal and a thrown
 * filesystem error mean the same thing to a caller that must not proceed.
 *
 * It lives in the pinned file, and the scheduler imports it rather than keeping
 * a second copy, because **fail-closed is the whole of the append-before-act
 * guarantee**: a version of this that answered `ok` when the write had not
 * landed would let a rule act on an intent nobody can review, and nothing about
 * the disposition switch above would have changed. A helper that load-bearing
 * belongs inside the fingerprint.
 */
export function record(store: RuleLog, events: readonly (JobEvent | RuleEvent)[]): { ok: true } | { ok: false; why: string } {
  try {
    const result = store.append(events);
    if (result.ok) return { ok: true };
    return { ok: false, why: `the store refused the append (${result.reason})` };
  } catch (cause) {
    return { ok: false, why: `the append threw: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}
