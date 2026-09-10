/**
 * **WHAT CAME OF A SCHEDULED LAUNCH, READ FROM THE EVIDENCE — never a spawn
 * read as a completion.** Plan 260910f-scheduled-dispatch § D6.
 *
 * **Pure. No I/O, no clock.** One function from what the launch journal and the
 * attempt's `exit.json` say to a `ScheduledResult`. It is computed when read and
 * never stored, because it is a reading of evidence the journal already holds —
 * a stored copy would be a second ledger that could disagree with the first.
 *
 * ## Why the input is a type of its own
 *
 * `ObservedLaunch` is the parts of a schedule-origin `LaunchRecord` the ladder
 * and the projection read, flattened. `observed-launch.ts § observedOf` is the
 * one adapter from the protocol's record to it. The exit record is NOT
 * restated: it is the protocol's own `ExitFacts` (`launch-protocol.ts`), the
 * shape `exit.json` and the journal's `completed` evidence share, so a field
 * the protocol adds or respells is a compile error here. Two type pins below
 * hold `ObservedState`'s eight arms equal to the protocol's `LaunchState` and to
 * `wire.ts`'s restated list, so a ninth state is a compile error rather than a
 * row that falls through.
 *
 * ## The ladder, and its precedence
 *
 * Table order in the plan, top to bottom; the first row whose evidence is
 * present wins:
 *
 *     pending            planned, reserved
 *     admission-waiting  waiting-admission
 *     running            launching, observed-running
 *     unknown            outcome-unknown
 *     superseded         failed-before-launch with proof superseded — abandoned on purpose,
 *                        and nothing ran; NOT a failure (M13)
 *     launch-failed      failed-before-launch (any other proof); ending not-run;
 *                        verdict cause spawn or prompt-unverified
 *     timed-out          verdict cause timeout
 *     quota-refused      usageLimit true
 *     interrupted        verdict cause hangup (a cancellation, whatever the child's ending);
 *                        ending signalled (not a timeout); ending unobserved; rebooted;
 *                        a disposition with no ending
 *     permission-denied  permissionDenials > 0
 *     missing-answer     exit 0 without a usable answer; verdict cause no-result or empty-answer
 *     failed             everything else that is not the row below — a non-zero exit, cli-error,
 *                        overflow, nonzero, a wrapper failure over a child that ran, and an exit
 *                        record its exit.json could not confirm
 *     succeeded          exit 0 AND verdict ok AND a usable projected answer AND exactly 0 denials
 *                        AND usageLimit false
 *
 * **`superseded` is its own kind, not a `launch-failed`** (the plan's M13). The
 * scheduler abandons a waiting occurrence deliberately — a newer authorised
 * revision replaced it, or the pool account it was pinned to is gone (M12) —
 * and the protocol records that as `failed-before-launch` with proof
 * `superseded`. Nothing ran and nothing went wrong, so a red pill would be an
 * alarm about a decision. Its `why` is the abandon's own reason, verbatim, and
 * it is not in `RESULT_FAILED`.
 *
 * **A permission denial with a usable answer is still `permission-denied`.** An
 * unattended job that could not do something it tried is the case somebody must
 * look at, and "the model worked round it" is invisible in the answer.
 *
 * ### Three readings of the protocol's final shape, decided here
 *
 *  - **`wrapper` is `launch-failed` only when no child ran.** The wrapper names
 *    that cause over a child that did run too — `scripts/launch-dir.ts §
 *    exitFactsOf` writes it for "the wrapper exited 0 over a child that did not
 *    exit 0". Reading that as "nothing ran" would be false, so with a child
 *    ending the child's ending decides: `failed`, `interrupted` and so on, with
 *    the wrapper's why. With the `not-run` ending it is `launch-failed`, which
 *    the not-run row already says. `prompt-unverified` is `launch-failed`
 *    whatever the ending, since the prompt check precedes any child.
 *  - **`hangup` is `interrupted` whatever the ending.** The wrapper forwards the
 *    hangup and waits for the child, so a child that handled it and exited is
 *    recorded as `exited` (`launch-dir.ts § hangup`). It was still cancelled.
 *  - **An `unobserved` ending is `interrupted`**: a child ran and the wrapper
 *    stopped waiting before the kernel reported how it ended (the forced settle
 *    after a SIGKILL). How it ended is unknown, so it is never `succeeded`, and
 *    not a plain `failed` either, which would claim a failure the child may not
 *    have had. A timeout verdict over it is still `timed-out`, by table order.
 *
 * ## A disposition outranks the four rows that are not endings
 *
 * The protocol's `disposed` event does NOT change a record's state: a disposed
 * record stays `launching`, `observed-running` or `outcome-unknown` for ever,
 * with its `disposition` set, and only a release may follow it
 * (`launch-protocol.ts` § the fold's `disposed` arm). So if `running` and
 * `unknown` were read before the disposition, as the table's order alone would
 * have it, a disposed occurrence would read as running or unknown for ever and
 * the `interrupted` row for a disposition could never fire. **Greg's decision
 * is an ending, and the first four rows are for records nobody has ended.** A
 * disposition on a record that DID end (`completed`, `failed-before-launch`)
 * cannot happen under the protocol; if one arrives, that record's own evidence
 * is read instead, because an exit record or a proof is stronger than a
 * person's word about it.
 *
 * ## NULL MEANS "THIS EXIT RECORD DID NOT SAY", AND IT IS NEVER EVIDENCE OF SUCCESS
 *
 * A job shell writes the ending and nothing else: `verdict`, `usageLimit`,
 * `permissionDenials`, `answer` and `transcript` all null. `run-codex` gives a
 * verdict but may leave `usageLimit` and `permissionDenials` null. `succeeded`
 * needs each of them said, and said well. What an unsaid field does instead:
 *
 *  - `answer` null on an exit of 0 is `missing-answer`: nothing says an answer
 *    exists, and a scheduled job's answer is its product.
 *  - `verdict` null on an exit of 0 with a usable answer is **`failed`**, with a
 *    why saying the wrapper gave no verdict. Not `missing-answer`, because the
 *    answer is there; not `succeeded`, because the wrapper's verdict is the one
 *    reading of the run that looked at its whole stream (`run-claude.ts`), and
 *    an exit code alone is what this stage exists to stop trusting.
 *  - `usageLimit` null, or `permissionDenials` null, on an otherwise good run is
 *    `failed` for the same reason, naming the field that was not said.
 *
 * ## An exit record its exit.json could not confirm is `failed`
 *
 * `observedOf` checks the journal's copy of the exit facts against the
 * attempt's `exit.json`. If the file is unreadable, or says something else, the
 * completion arrives here as `exit-unconfirmed` with the reason, and reads as
 * `failed` — not `missing-answer`, because whether there was an answer is
 * exactly what cannot be said, and never `succeeded`.
 *
 * So a row can only be `succeeded` from the `completed` arm, from an exit
 * record that said all five things, and when the answer projected beside it is
 * present, usable and non-empty. **Nothing maps `launching`, a live tmux
 * session or a started launcher to `succeeded`**, and the tests loop over all
 * eight states to hold that.
 *
 * ## `at`
 *
 * Null for `pending`, `admission-waiting` and `running`, which have no ending
 * yet. For `completed` and `failed-before-launch` (so `superseded` too), the record's **`endedAt`** —
 * the `at` of the line that entered the state, which a later release never
 * moves (Sol's plan F4). For `unknown`, the record's `updatedAt`, since it is
 * dated by when the uncertainty was recorded. A disposition is dated by the
 * disposition itself, since the record's `updatedAt` moves again when the
 * release that follows it is written.
 */
import type { ScheduledAnswer, ScheduledLaunchState, ScheduledResult, ScheduledResultKind, ScheduledRunSpec } from "../fleet/wire.js";
import type { ExitEnding, ExitFacts, FailedProof, LaunchState } from "./launch-protocol.js";

/** An attempt's exit facts — `exit.json`'s, as the journal's `completed` evidence copies them. */
export type ObservedExitRecord = { readonly kind: "exit-record" } & ExitFacts;

/**
 * How a `completed` launch ended: an exit record, a reboot (there is no
 * `vanished`), or an exit record the attempt's `exit.json` could not confirm —
 * see the header.
 */
export type ObservedCompletion = { readonly kind: "rebooted" } | ObservedExitRecord | { readonly kind: "exit-unconfirmed"; readonly why: string };

/** The protocol's eight states, each carrying only what it can have. */
export type ObservedState =
  | { readonly kind: "planned" }
  | { readonly kind: "waiting-admission"; readonly why: string }
  | { readonly kind: "reserved" }
  | { readonly kind: "launching"; readonly attempt: number }
  | { readonly kind: "observed-running"; readonly attempt: number }
  | { readonly kind: "completed"; readonly attempt: number; readonly evidence: ObservedCompletion; readonly endedAt: string }
  | { readonly kind: "failed-before-launch"; readonly attempt: number | null; readonly proof: FailedProof; readonly why: string; readonly endedAt: string }
  | { readonly kind: "outcome-unknown"; readonly attempt: number; readonly why: string };

/** Greg's decision on an unsettled launch — the protocol's `Disposition`, less who and which request. */
export type ObservedDisposition = { readonly decision: "not-running" | "ended"; readonly why: string; readonly at: string };

/** One schedule-origin launch, as the classifier and the projection see it. */
export type ObservedLaunch = {
  /** `lo-<20 hex>`. */
  readonly launchOccurrenceId: string;
  readonly schedulerOccurrenceId: string;
  readonly jobId: string;
  readonly scheduledAt: string;
  readonly behaviourHash: string;
  readonly plannedAt: string;
  readonly updatedAt: string;
  /** How many times the launcher was invoked, or may have been. */
  readonly attempts: number;
  readonly run: ScheduledRunSpec;
  readonly tmuxSession: string | null;
  readonly transcriptPath: string | null;
  readonly answer: ScheduledAnswer;
  readonly disposition: ObservedDisposition | null;
  readonly state: ObservedState;
};

/*
 * THE STATE LISTS AGREE, BOTH WAYS, WITH BOTH NEIGHBOURS. `wire.ts` restates
 * the eight states because it imports nothing; the protocol owns them. A state
 * added to either and not here fails to compile.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const STATES_AGREE_WITH_WIRE: Same<ObservedState["kind"], ScheduledLaunchState> = true;
const STATES_AGREE_WITH_PROTOCOL: Same<ObservedState["kind"], LaunchState["state"]> = true;
void STATES_AGREE_WITH_WIRE;
void STATES_AGREE_WITH_PROTOCOL;

/** Which results are failures, which are not endings yet, the one set aside on purpose, and the one good ending. The compiler counts them. */
const RESULT_CLASS: Readonly<Record<ScheduledResultKind, "open" | "set-aside" | "failed" | "succeeded">> = {
  pending: "open",
  "admission-waiting": "open",
  running: "open",
  unknown: "open",
  superseded: "set-aside",
  "launch-failed": "failed",
  "timed-out": "failed",
  "quota-refused": "failed",
  interrupted: "failed",
  "permission-denied": "failed",
  "missing-answer": "failed",
  failed: "failed",
  succeeded: "succeeded",
};

/**
 * The failure kinds, for the page's red pill and the CLI. `unknown` is not
 * among them: it is not an ending, it is an ending nobody can read yet. Nor is
 * `superseded`: it is an ending, and a deliberate one.
 */
export const RESULT_FAILED: ReadonlySet<ScheduledResultKind> = new Set(
  (Object.keys(RESULT_CLASS) as ScheduledResultKind[]).filter((kind) => RESULT_CLASS[kind] === "failed"),
);

const open = (kind: ScheduledResultKind, why: string): ScheduledResult => ({ kind, why, at: null });

/** The ladder. Exhaustive over the eight states, so a ninth is a compile error here. */
export function classifyOccurrence(o: ObservedLaunch): ScheduledResult {
  const state = o.state;
  switch (state.kind) {
    case "planned":
    case "waiting-admission":
    case "reserved":
    case "launching":
    case "observed-running":
    case "outcome-unknown": {
      // A DISPOSITION FIRST, on every state that has no ending of its own — the
      // header's disposition section says why the table's order alone would bury it.
      if (o.disposition !== null) {
        const said = o.disposition.decision === "not-running" ? "it was not running" : "it had ended";
        return {
          kind: "interrupted",
          why: `it was ${state.kind} with no exit record, and Greg disposed of it as ${o.disposition.decision} (${said}): ${o.disposition.why}`,
          at: o.disposition.at,
        };
      }
      return notEnded(state, o.updatedAt);
    }
    case "failed-before-launch":
      // SUPERSEDED BEFORE LAUNCH-FAILED: the scheduler set it aside on purpose
      // and nothing ran, so it is not a failure — the header's M13 section.
      if (state.proof === "superseded") return { kind: "superseded", why: state.why, at: state.endedAt };
      return {
        kind: "launch-failed",
        why: `it failed before launch, with proof that nothing ran (${state.proof}${state.attempt === null ? "" : `, attempt ${state.attempt}`}): ${state.why}`,
        at: state.endedAt,
      };
    case "completed": {
      const ended = (kind: ScheduledResultKind, why: string): ScheduledResult => ({ kind, why, at: state.endedAt });
      const evidence = state.evidence;
      switch (evidence.kind) {
        case "rebooted":
          return ended("interrupted", `the box rebooted while attempt ${state.attempt} ran, so it never wrote an exit record`);
        case "exit-unconfirmed":
          return ended(
            "failed",
            `the journal records attempt ${state.attempt}'s exit record, but the attempt's exit.json could not confirm it, so nothing about how it ended can be claimed: ${evidence.why}`,
          );
        case "exit-record": {
          const [kind, why] = exitLadder(evidence, o.answer);
          return ended(kind, why);
        }
        default: {
          const never: never = evidence;
          throw new Error(`no result for completion evidence ${JSON.stringify(never)}`);
        }
      }
    }
    default: {
      const never: never = state;
      throw new Error(`no result for launch state ${JSON.stringify(never)}`);
    }
  }
}

/** The first four rows, for a record nobody has disposed of. */
function notEnded(state: Exclude<ObservedState, { kind: "completed" | "failed-before-launch" }>, updatedAt: string): ScheduledResult {
  switch (state.kind) {
    case "planned":
      return open("pending", "it is planned and has not yet been given a slot");
    case "reserved":
      return open("pending", "it holds a slot and the launcher has not been invoked yet");
    case "waiting-admission":
      return open("admission-waiting", `it is waiting for a slot: ${state.why}`);
    case "launching":
      return open("running", `attempt ${state.attempt}'s launcher was invoked, and nothing has yet said it started or ended`);
    case "observed-running":
      return open("running", `attempt ${state.attempt} was seen running, and no exit record has been written`);
    case "outcome-unknown":
      return { kind: "unknown", why: `nothing on the box can say what became of attempt ${state.attempt}, so only Greg can: ${state.why}`, at: updatedAt };
    default: {
      const never: never = state;
      throw new Error(`no open result for launch state ${JSON.stringify(never)}`);
    }
  }
}

/** One exit record, down the ending rows in table order. The first whose evidence is present wins. */
function exitLadder(e: ObservedExitRecord, answer: ScheduledAnswer): [ScheduledResultKind, string] {
  const cause = e.verdict?.kind === "failed" ? e.verdict.cause : null;
  const wrapperWhy = e.verdict?.kind === "failed" ? e.verdict.why : null;
  const wrapperSays = cause === null ? "" : `; the wrapper says ${cause}: ${wrapperWhy}`;
  const ending = e.ending;
  const how = describeEnding(ending);

  // LAUNCH-FAILED: nothing ran, or not the prompt that was pinned.
  if (ending.kind === "not-run") return ["launch-failed", `no child ran${cause === null ? ", and the wrapper gave no verdict" : `: the wrapper says ${cause}: ${wrapperWhy}`}`];
  if (cause === "spawn" || cause === "prompt-unverified") return ["launch-failed", `the wrapper says ${cause} (${how}), so the pinned session never started: ${wrapperWhy}`];

  if (cause === "timeout") return ["timed-out", `the wrapper says it ran past its timeout and was stopped (${how}): ${wrapperWhy}`];

  if (e.usageLimit === true) return ["quota-refused", `the exit record says the account's usage limit refused it (${how})`];

  // INTERRUPTED: cancelled, stopped by a signal, or ended where nobody could see.
  if (cause === "hangup") return ["interrupted", `it was cancelled: the wrapper was hung up (hangup, ${how}): ${wrapperWhy}`];
  if (ending.kind === "signalled") return ["interrupted", `it was stopped by ${ending.signal} before it finished, and not by its timeout${wrapperSays}`];
  if (ending.kind === "unobserved") return ["interrupted", `the wrapper could not observe how its child ended — it stopped waiting before the kernel reported it${wrapperSays}`];

  if (e.permissionDenials !== null && e.permissionDenials > 0) {
    return ["permission-denied", `the exit record counts ${e.permissionDenials} permission denial${e.permissionDenials === 1 ? "" : "s"} (${how}), so it could not do something it tried`];
  }

  const code = ending.code;
  const recordUsable = e.answer === null ? null : e.answer.usable;
  const projectedAnswerUsable = answer.kind === "present" && answer.usable && answer.bytes > 0;
  if (code === 0 && (recordUsable !== true || !projectedAnswerUsable)) {
    if (recordUsable !== true) {
      return ["missing-answer", recordUsable === false ? "it exited 0 but its answer was empty or unusable" : "it exited 0 and the exit record names no answer"];
    }
    return ["missing-answer", "it exited 0 and the exit record calls its answer usable, but the projected answer is absent, unusable or empty"];
  }
  if (cause === "no-result" || cause === "empty-answer") return ["missing-answer", `the wrapper says there was no answer (${cause}, ${how}): ${wrapperWhy}`];

  if (code !== 0) return ["failed", cause === null ? `it exited ${code}` : `it exited ${code}, and the wrapper says ${cause}: ${wrapperWhy}`];
  if (cause !== null) return ["failed", `it exited 0 but the wrapper says ${cause}: ${wrapperWhy}`];

  // EXIT 0, A USABLE ANSWER, NO FAILED VERDICT. Now every unsaid field is a
  // reason not to claim success — the header's null section.
  if (e.verdict === null) return ["failed", "it exited 0 with a usable answer, but the exit record gives no wrapper verdict, so success cannot be claimed"];
  if (e.usageLimit === null) return ["failed", "it exited 0 with a usable answer, but the exit record does not say whether a usage limit was hit"];
  if (e.permissionDenials === null) return ["failed", "it exited 0 with a usable answer, but the exit record does not count permission denials"];
  if (e.permissionDenials !== 0) return ["failed", `it exited 0 with a usable answer, but the exit record's permission denial count (${e.permissionDenials}) is not zero`];

  return ["succeeded", "it exited 0, the wrapper's verdict was ok, its answer is usable, and there were no permission denials and no usage limit"];
}

function describeEnding(ending: ExitEnding): string {
  switch (ending.kind) {
    case "exited":
      return `exit ${ending.code}`;
    case "signalled":
      return `stopped by ${ending.signal}`;
    case "not-run":
      return "no child ran";
    case "unobserved":
      return "how the child ended was not observed";
    default: {
      const never: never = ending;
      throw new Error(`no words for ending ${JSON.stringify(never)}`);
    }
  }
}
