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
 * **`rule-protocol.ts` is in too, and getting to it took two goes.** The
 * argument for leaving the protocol out was `standing-jobs.ts`'s: it is shared
 * machinery, every job goes through it, and a tripwire that mostly fires
 * falsely teaches whoever meets it to re-pin without reading. GPT Sol's SC-2 is
 * that the argument falls the wrong way *here*, because the protocol is the
 * code that **interprets the hashed `disposition`** — so a change that bypassed
 * its dispatch left the rule's authorised hash perfectly current, and the
 * fingerprint guarded the threshold while not guarding the thing that decides
 * whether to act on it. **The protocol that decides whether to act is more
 * load-bearing than the threshold it reads.**
 *
 * Stage 3a answered that by pinning the whole of `scheduler.ts`, which was
 * right in principle and far too broad in practice: that file also carries
 * session dispatch, the sweep and `describeReport`'s wording, so **every rule's
 * authorisation was hostage to a file that changes for reasons having nothing
 * to do with rules.** It re-pinned twice in one session. 3b moved the protocol
 * into `rule-protocol.ts` and pins that instead — same guarantee, far fewer
 * false trips — and `tests/overseer-rules.test.ts` § "what a rule's pin covers"
 * asserts both directions over a real checkout, because a test proving only
 * that the protocol is covered would also pass if this list named the whole
 * repository.
 *
 * **The residual cost, said out loud rather than left to be discovered.** These
 * three files are shared by every rule, so adding rule 1 re-pinned rule 2 —
 * `rules.ts` holds both rules' arithmetic and `rule-work.ts` both observers. It
 * is a far smaller version of what 3b fixed (rules change rarely; log sentences
 * change constantly), and splitting the per-rule halves into per-rule files is
 * the next move if a third rule makes it bite. `npx tsx scripts/overseer-pins.ts`
 * prints the number to copy.
 *
 * ## WHAT THE FINGERPRINT DOES NOT COVER, and it is not nothing
 *
 * **A self-verifying pin cannot protect its own verifier**, so the boundary has
 * to be stated rather than implied. GPT Sol's finding 3 on 3b: two claims made
 * here and in `rule-protocol.ts` were stronger than the mechanism.
 *
 * What is inside: **what a rule decides, how it looks, and whether it may
 * act** — the thresholds, the disposition, the observers, and the ordering that
 * puts a decision on the disk before anything is done about it.
 *
 * What is outside, deliberately, as a reviewed execution base:
 *
 *  - **`store.ts`'s durability.** The protocol trusts `append` and does not
 *    fsync itself. Deleting `fsyncSync` leaves every pin current, and the test
 *    that reads the intent back through a second file descriptor proves
 *    process-visible bytes rather than crash durability.
 *  - **`scheduler.ts`'s lifecycle.** The authorisation gate, the lease, the
 *    sweep that releases an expired one, and the reservation decide WHETHER a
 *    rule runs and HOW OFTEN — an edit there can permit repeats without moving
 *    a rule's fingerprint.
 *  - **What `"safe-to-kill"` MEANS.** It is a hashed word whose meaning lives in
 *    `tools/fleet/actions.ts`, which no pin covers, so changing what the policy
 *    selects changes what rule 2 proposes without changing its hash. Already
 *    named as a precondition on 3d in the plan, and it belongs on this list.
 *
 * Closing any of them means extracting a small stable module and pinning that,
 * which is a change worth making the day something acts — not one to make while
 * both rules can only propose.
 */
import { behaviourHash, type AuthorisedRuleJob, type BehaviourHash, type JobDocument, type RuleJobDefinition } from "./jobs.js";
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

/**
 * The implementation every rule's authority covers: what it decides
 * (`rules.ts`), how it looks (`rule-work.ts`), and the protocol that reads its
 * hashed `disposition` (`rule-protocol.ts`).
 *
 * **`scheduler.ts` is deliberately NOT here**, and that is 3b's whole first
 * half — see the header, and `rule-protocol.ts` for where the line is drawn.
 */
export const RULE_SOURCES = ["tools/overseer/rules.ts", "tools/overseer/rule-work.ts", "tools/overseer/rule-protocol.ts"] as const;

/**
 * **One session in a mode that is not auto is worth a sentence.**
 *
 * There is no volume argument for a higher number: one stalled agent is one
 * brief that will not finish tonight, and the longest single stall measured was
 * 7.38 hours. It is a hashed knob rather than a literal in an `if` because SP-1
 * is about the firing condition being inside the fingerprint — see
 * `LaunchModeSpec.minSessions`.
 */
export const LAUNCH_MODE_MIN_SESSIONS = 1;

/** **Five minutes.** How old the dashboard's own last collection may have been when it served it. See `LaunchModeSpec.maxCollectionAgeSeconds`. */
export const LAUNCH_MODE_MAX_COLLECTION_AGE_SECONDS = 300;

/**
 * **Fifteen minutes**, the same as rule 2's, and for a related reason rather
 * than by copying.
 *
 * The thing this watches is a property of a session's LAUNCH, so it does not
 * change while a session runs: a stalled session is stalled from its first
 * minute and stays stalled until somebody relaunches it. Checking more often
 * buys minutes on something whose measured stalls ran to hours, and every check
 * is a request to a dashboard on a box this fleet keeps overloading.
 */
export const LAUNCH_MODE_EVERY_MS = 15 * 60_000;

/** The sentence in the log that says what this job is. In the fingerprint, like every other job's. */
export const LAUNCH_MODE_WHAT =
  "Watch for sessions that did not come up in auto mode and will stall at their next unapprovable call. Observe only: a running session cannot be switched into auto mode.";

export type RuleJobId = RuleId;

/**
 * THE AUTHORISED FINGERPRINTS.
 *
 * Re-pinned 2026-09-08 for GPT Sol's code review of 3b: `a3dcfd98b110` →
 * `bebaeb2561c0` for `wedged-work`, `a648c4bfbe4c` → `898a5c1ab3f1` for
 * `launch-mode`. **Rule 1's decision changed and rule 2's did not.** Rule 1 now
 * answers `cannot-tell` when enough sessions were unreadable to have hidden the
 * threshold, rather than folding that into `nothing-to-do` (finding 1); its
 * observer refuses a payload whose own collection failed, which `/api/state`
 * serves with the PREVIOUS rows attached (finding 2); and both rules' pins moved
 * again for the prose corrections above, which are a narrowing of what this
 * fingerprint was claimed to cover (finding 3).
 *
 * Before that, 3b part 2 pinned `launch-mode` at `a648c4bfbe4c` and moved
 * `wedged-work` `95485a7dbe6f` → `a3dcfd98b110` — no rule's behaviour changed;
 * `rules.ts` and `rule-work.ts` grew a second rule, and both are shared.
 *
 * Before that, 3b part 1: `6a62bed1e623` → `95485a7dbe6f`.
 * **Nothing the rule decides changed, and nothing about the spec changed** —
 * one document in the list was swapped for another. `scheduler.ts` left
 * `RULE_SOURCES` and `rule-protocol.ts` took its place, which is the whole of
 * the split: the protocol that interprets the hashed `disposition` is still
 * inside the fingerprint, and the sweep, the session dispatch and
 * `describeReport`'s wording are no longer.
 *
 * The pin before that was `210968a360b9` → `6a62bed1e623`, on 3a's code review:
 * `scheduler.ts` joined the pinned documents (SC-2), `rule-work.ts` lost its
 * actor (SC-2), and `rules.ts` moved to a mapped-type spec encoding (SC-4).
 *
 * Editing any pinned file, or any knob in a spec below, moves these again and
 * the job stops dispatching until somebody has read what changed and copied the
 * new hash. `npx tsx scripts/overseer-pins.ts` prints it, and `overseer status`
 * says when it is stale.
 */
export const AUTHORISED_RULE_HASHES: Readonly<Record<RuleJobId, string>> = {
  // BOTH RE-PINNED 2026-09-09, for two reasons and neither is a change to a
  // rule. First, cadence and lease left the fingerprint (GPT Sol's S8-1), so the
  // bytes hashed changed while every spec, threshold and disposition stayed as
  // it was. Second, `rules.ts` is one of `RULE_SOURCES`, so renaming
  // `definitionHash` to `behaviourHash` in TWO OF ITS COMMENTS moved its digest
  // and therefore both pins.
  //
  // **That second one is the tripwire working, and it is worth reading twice.**
  // A comment edit disarming two rules is exactly the alarm-fatigue risk
  // `standing-jobs.ts` names — the difference is that these documents are
  // implementation files rather than prose, and a rule's implementation is the
  // thing a person is authorising. Re-pinned after reading the diff: two words
  // in two comments, both of them the new name of a function this file calls.
  //
  // BOTH RE-PINNED 2026-09-10 (plan 260910e § D5), for one thing only:
  // `JobBehaviour` gained the hashed `dispatch` field and both rules are
  // `{ kind: "live" }`, which is what they already were. No spec, threshold,
  // disposition or source file moved — `RULE_SOURCES` are byte-for-byte what
  // they were. Was `17abcb1814de` and `f130e228aa85`.
  "wedged-work": "28d1f83b8a42",
  "launch-mode": "4de4439f7848",
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

/**
 * Rule 1's spec, as it is authorised.
 *
 * `disposition: "propose"` is not a placeholder for an action that is coming
 * later: **there is no reversible act for this rule.** You cannot type
 * `/permission-mode auto` into a running session, and answering its dialog
 * unattended is the authority grant SP-7 is about, so the only remedy is
 * kill-and-relaunch — the least reversible thing on the list. Rule 1 tells a
 * person; a person decides.
 */
export const LAUNCH_MODE_SPEC: RuleSpec = {
  kind: "launch-mode",
  minSessions: LAUNCH_MODE_MIN_SESSIONS,
  maxCollectionAgeSeconds: LAUNCH_MODE_MAX_COLLECTION_AGE_SECONDS,
  // NEVER `"act"`, and here more firmly than for rule 2: there is nothing an
  // actor could do about this that a person has not asked for.
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
      // ONE UNREADABLE SOURCE HOLDS EVERY RULE, because the three files are
      // shared: a fingerprint computed over a document we could not read is not
      // a fingerprint, and scheduling the rules whose digests happened to
      // succeed would be authorising them against a partial reading.
      problems.push(`no deterministic rule is being scheduled: ${read.why}`);
      return { jobs: [], problems };
    }
    documents.push(read.document);
  }
  // THE ORDER HERE IS THE ORDER `overseer status` PRINTS AND NOTHING ELSE. Each
  // job carries its own interval and its own lease, so neither waits on the
  // other; `schedulerTick` refuses a duplicate id, which is the only ordering
  // question there is.
  const defined: readonly RuleJobDefinition[] = [
    {
      // `dispatch: live` — a rule that only proposes has no dry-run worth the
      // name, and it is hashed like every other job's (`jobs.ts` § JobDispatch).
      behaviour: { id: "wedged-work", what: WEDGED_WORK_WHAT, documents, work: { kind: "rule", rule: WEDGED_WORK_SPEC }, dispatch: { kind: "live" } },
      // THE RULES' SCHEDULES ARE NOT IN `schedules.ts`, deliberately. That file
      // is Greg's — the two standing jobs, the ones that cost money, the ones he
      // asked to be able to retune at 3am. A rule ticks in-process and costs
      // nothing, and its cadence is a property of the rule rather than a
      // preference; putting it in the same file would invite editing it for the
      // same reasons, which are not the same reasons at all.
      schedule: { everyMs: WEDGED_WORK_EVERY_MS, leaseMs: RULE_LEASE_MS, initialDelayMs: 0 },
    },
    {
      behaviour: { id: "launch-mode", what: LAUNCH_MODE_WHAT, documents, work: { kind: "rule", rule: LAUNCH_MODE_SPEC }, dispatch: { kind: "live" } },
      schedule: { everyMs: LAUNCH_MODE_EVERY_MS, leaseMs: RULE_LEASE_MS, initialDelayMs: 0 },
    },
  ];
  return {
    jobs: defined.map((definition) => ({
      definition,
      authorisedHash: AUTHORISED_RULE_HASHES[definition.behaviour.id as RuleJobId] as BehaviourHash,
      // THE LOAD-TIME DIGESTS, not literals (plan 260910e § D4). A rule's
      // documents are the code this process has already loaded, and the tick
      // never re-reads them, so the digest the definition was built with IS the
      // one it is judged by — a literal beside the hash would be a second copy
      // of `RULE_SOURCES`' bytes to keep in step for no diagnosis it could add.
      authorisedDocuments: documents,
    })),
    problems,
  };
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
    const found = behaviourHash(job.definition.behaviour);
    const disposition = job.definition.behaviour.work.rule.disposition;
    const label = `${job.definition.behaviour.id} (${disposition})`;
    return found === job.authorisedHash ? label : `${label} (NOT AUTHORISED: pinned ${job.authorisedHash}, now ${found})`;
  });
  const tail = [named.length === 0 ? "no rule definitions built" : named.join(", "), ...problems].join("; ");
  if (!input.armed) return `${input.enableVar} is not "1", so no deterministic rule will run. The rules that would: ${tail}`;
  return tail;
}
