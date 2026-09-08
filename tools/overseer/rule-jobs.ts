/**
 * **The deterministic rule jobs, as data — and the pins that say these are the
 * ones Greg queued.**
 *
 * The sibling of `standing-jobs.ts`, and it works the same way for the same
 * reasons: a definition built from the repo as it stands right now, and a
 * literal `authorisedHash` that changes only in a commit somebody reviewed.
 * Read that file's header for why an authorisation has to come from somewhere
 * the authorised party cannot write.
 *
 * ## What is pinned here that is not pinned there, and why
 *
 * A standing job is a **document**: `what` says *go and follow this file*, so
 * the file's digest is the thing that has to be in the fingerprint. A rule job
 * is **code**, and GPT Sol's SP-1 is that the code has to be in it for exactly
 * the same reason:
 *
 * > Changing a threshold, action, or rule implementation would leave the
 * > authorised pin valid.
 *
 * Two things carry that here. The **whole configuration** — threshold, policy,
 * disposition — is `RuleSpec`, which lives inside the definition and is hashed
 * (`canonicalRuleSpec`). And the **implementation** is in `documents`, digested
 * exactly as a doc is, so editing it stops the job dispatching until somebody
 * re-pins it.
 *
 * ## Which files, and the argument that was got wrong once
 *
 * `rules.ts` (what the rule decides) and `rule-work.ts` (how it looks) are in,
 * because between them they are the whole of what this job does that no other
 * job does. Turning the observer into something that acted would otherwise
 * leave every pin valid, which is SP-1 word for word.
 *
 * **`scheduler.ts` is in too, and it was left out first time round.** The
 * argument for leaving it out was `standing-jobs.ts`'s: it is shared machinery,
 * every job goes through it, and a tripwire that mostly fires falsely teaches
 * whoever meets it to re-pin without reading. GPT Sol's SC-2 is that the
 * argument falls the wrong way *here*, because `scheduler.ts` is the code that
 * **interprets the hashed `disposition`** — so a change that bypassed its
 * dispatch left the rule's authorised hash perfectly current, and the
 * fingerprint guarded the threshold while not guarding the thing that decides
 * whether to act on it. **The protocol that decides whether to act is more
 * load-bearing than the threshold it reads.**
 *
 * The cost is real and is accepted with its eyes open: an edit to the sweep, or
 * to a report's wording, disarms every rule until somebody re-pins. That is the
 * price of the guarantee, and `npx tsx scripts/overseer-pins.ts` prints the
 * number to copy.
 */
import { definitionHash, type AuthorisedRuleJob, type DefinitionHash, type JobDocument, type RuleJobDefinition } from "./jobs.js";
import type { RuleId, RuleSpec } from "./rules.js";
import { digestDocument } from "./standing-jobs.js";

/**
 * **Four hours.** How long a licensed process must have been running before it
 * is worth telling anybody about.
 *
 * Sized from the case we actually have rather than from a principle. The
 * specimen — pid 2282035, `npm exec playwright@1.62.1 install webkit` — was
 * first written down at 5h43m and was still running at 19h the next day, and
 * nothing in between noticed. Four hours is comfortably under the point at
 * which this one became a story and comfortably over anything a legitimate
 * install, build or test run takes on this box.
 *
 * It is a **knob in the hashed spec**, so moving it is an edit that stops the
 * job until a person re-pins it. That is the whole of SP-1 in one constant.
 */
export const WEDGED_WORK_MIN_AGE_SECONDS = 4 * 3600;

/**
 * **Fifteen minutes.** The rule carries its own interval rather than riding the
 * tick.
 *
 * The thing it is looking for is measured in hours, so a shorter interval buys
 * nothing and costs a full process-table read on a box this rule exists to
 * notice the pressure on. It is also the constraint the fleet dashboard's owner
 * attached to rule 3 and it applies here for a weaker version of the same
 * reason: the route will not throttle a caller on the condition that triggers
 * it, so the caller carries the interval.
 */
export const WEDGED_WORK_EVERY_MS = 15 * 60_000;

/**
 * How long a rule run may be unsettled before it is `stuck` and the job is
 * released.
 *
 * Two minutes, against a ten-second look. Unlike a standing job — whose lease is
 * six hours because it dispatches a Claude session that runs for an afternoon —
 * a rule is one HTTP call and some arithmetic, so anything that has not settled
 * in two minutes is not coming back.
 */
export const RULE_LEASE_MS = 2 * 60_000;

/** The sentence in the log that says what this job is. In the fingerprint, like every other job's. */
export const WEDGED_WORK_WHAT =
  "Propose, and never take, kills for work wedged on this box: the dashboard's own safe-kill dry run, filtered by age.";

/** The implementation this job's authority covers. See the header for why `scheduler.ts` is one of them, and why leaving it out was wrong. */
export const RULE_SOURCES = ["tools/overseer/rules.ts", "tools/overseer/rule-work.ts", "tools/overseer/scheduler.ts"] as const;

export type RuleJobId = RuleId;

/**
 * THE AUTHORISED FINGERPRINTS.
 *
 * Re-pinned 2026-09-08 against `rules.ts`, `rule-work.ts` and `scheduler.ts` as
 * they stood after GPT Sol's code review of stage 3a: `210968a360b9` →
 * `6a62bed1e623`. **Nothing the rule decides changed.** Three things moved it,
 * and all three are the mechanism working: `scheduler.ts` joined the pinned
 * documents (SC-2), `rule-work.ts` lost its actor so the shipped process holds
 * no acting capability (SC-2), and `rules.ts` encodes the spec through a mapped
 * type instead of a destructure, which relabelled the first line of the
 * canonical form (SC-4). The standing jobs did NOT move — the definition
 * encoding is byte-identical to the destructured one.
 *
 * Editing any of those files, or any knob in the spec below, moves this again
 * and the job stops dispatching until somebody has read what changed and copied
 * the new hash. `npx tsx scripts/overseer-pins.ts` prints it, and
 * `overseer status` says when it is stale.
 */
export const AUTHORISED_RULE_HASHES: Readonly<Record<RuleJobId, string>> = {
  "wedged-work": "6a62bed1e623",
};

/** The spec, as it is authorised. Every knob, and `disposition: "propose"` is the one gate 3 turns on. */
export const WEDGED_WORK_SPEC: RuleSpec = {
  kind: "wedged-work",
  minAgeSeconds: WEDGED_WORK_MIN_AGE_SECONDS,
  policy: "safe-to-kill",
  // NEVER `"act"`. This arm selects `runProposingRule`, which is handed a
  // capability with no actor on it — and changing the field to `"act"` selects a
  // runner whose capability no shipped wiring supplies, so it would meet a
  // refusal rather than a kill. And because the field is hashed, changing it is
  // not a quiet edit: the job refuses to dispatch until it is re-pinned.
  disposition: "propose",
};

export type RuleJobs = {
  readonly jobs: readonly AuthorisedRuleJob[];
  /** Why a rule is not being scheduled, beside the list rather than logged and forgotten — `standing-jobs.ts` says why. */
  readonly problems: readonly string[];
};

/**
 * Build the rule jobs against a checkout, digesting each implementation file.
 *
 * **The return type is the other half of the deterministic-only arming path.**
 * `AuthorisedRuleJob` requires `work: {kind: "rule", …}`, so a session job
 * cannot be put in this list without changing a declared type — which is a
 * visible edit rather than something a future job falls through, and that is
 * what GPT Sol's SP-4 asked for. The first half is that the path is given no
 * `SpawnJob` at all (`scheduler.ts` § `TickInput.spawn`).
 */
export function ruleJobs(repoRoot: string): RuleJobs {
  const problems: string[] = [];
  const documents: JobDocument[] = [];
  for (const path of RULE_SOURCES) {
    const read = digestDocument(repoRoot, path);
    if (!read.ok) {
      problems.push(`rule wedged-work is not being scheduled: ${read.why}`);
      return { jobs: [], problems };
    }
    documents.push(read.document);
  }
  const definition: RuleJobDefinition = {
    id: "wedged-work",
    everyMs: WEDGED_WORK_EVERY_MS,
    leaseMs: RULE_LEASE_MS,
    what: WEDGED_WORK_WHAT,
    documents,
    work: { kind: "rule", rule: WEDGED_WORK_SPEC },
  };
  return { jobs: [{ definition, authorisedHash: AUTHORISED_RULE_HASHES["wedged-work"] as DefinitionHash }], problems };
}

/**
 * The sentence `overseer status` prints about the rules.
 *
 * The same shape as `describeStandingJobs`, and for the same reason: a rule
 * that is switched off must not read like a rule with nothing to do. The word
 * OFF or ARMED is the caller's; this is the detail.
 */
export function describeRuleJobs(input: { armed: boolean; enableVar: string; jobs: RuleJobs }): string {
  const { jobs, problems } = input.jobs;
  const named = jobs.map((job) => {
    const found = definitionHash(job.definition);
    const disposition = job.definition.work.rule.disposition;
    const label = `${job.definition.id} (${disposition})`;
    return found === job.authorisedHash ? label : `${label} (NOT AUTHORISED: pinned ${job.authorisedHash}, now ${found})`;
  });
  const tail = [named.length === 0 ? "no rule definitions built" : named.join(", "), ...problems].join("; ");
  if (!input.armed) return `${input.enableVar} is not "1", so no deterministic rule will run. The rules that would: ${tail}`;
  return tail;
}
