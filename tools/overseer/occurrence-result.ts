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
 * The launch protocol's types (`launch-protocol.ts`, `launch-artefacts.ts`) are
 * not on this branch yet, so the classifier is written against `ObservedLaunch`,
 * which restates the parts of `LaunchRecord` and `ExitRecord` it reads, in the
 * same shapes. When the protocol lands, one adapter (`observedOf(record,
 * exitRecord)`, Stage B) is the only code that reads the protocol's own types,
 * and a type test pins the protocol's state list against `ObservedState` so a
 * ninth state is a compile error rather than a row that falls through.
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
 *     launch-failed      failed-before-launch; supervisor-failed; verdict cause spawn
 *     timed-out          timedOut; verdict cause timeout
 *     quota-refused      usageLimit
 *     interrupted        signalled (not a timeout); rebooted; a disposition with no exit record
 *     permission-denied  permissionDenials > 0
 *     missing-answer     exit 0 without a usable answer; verdict cause no-result or empty-answer
 *     failed             everything else that is not the row below
 *     succeeded          exit 0 AND verdict ok AND a usable projected answer AND exactly 0 denials AND no usage limit
 *
 * **A permission denial with a usable answer is still `permission-denied`.** An
 * unattended job that could not do something it tried is the case somebody must
 * look at, and "the model worked round it" is invisible in the answer.
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
 * `verdict`, `usageLimit`, `permissionDenials` and `answerUsable` are null when
 * the exit record carries no such field — an older writer, or a tmux launch,
 * which has no wrapper and no answer file. `succeeded` needs each of them said,
 * and said well. What an unsaid field does instead:
 *
 *  - `answerUsable` null on an exit of 0 is `missing-answer`: nothing says an
 *    answer exists, and a scheduled job's answer is its product.
 *  - `verdict` null on an exit of 0 with a usable answer is **`failed`**, with a
 *    why saying the wrapper gave no verdict. Not `missing-answer`, because the
 *    answer is there; not `succeeded`, because the wrapper's verdict is the one
 *    reading of the run that looked at its whole stream (`run-claude.ts`), and
 *    an exit code alone is what this stage exists to stop trusting.
 *  - `usageLimit` null, or `permissionDenials` null, on an otherwise good run is
 *    `failed` for the same reason, naming the field that was not said.
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
 * yet. For an ending, the record's `updatedAt` — except for a disposition,
 * which is dated by the disposition itself, since the record's `updatedAt`
 * moves again when the release that follows it is written.
 */
import type { ScheduledAnswer, ScheduledLaunchState, ScheduledResult, ScheduledResultKind, ScheduledRunSpec } from "../fleet/wire.js";

/** How the launched side ended — the protocol's `ExitEnding`, restated. */
export type ObservedEnding =
  | { readonly kind: "exited"; readonly code: number }
  | { readonly kind: "signalled"; readonly signal: string }
  /** The supervisor itself failed (a spawn error, a refusal after start) and said so. */
  | { readonly kind: "supervisor-failed"; readonly why: string };

/** The seven ways `run-claude.ts` says a run failed. */
export type WrapperFailureCause = "spawn" | "overflow" | "timeout" | "cli-error" | "no-result" | "nonzero" | "empty-answer";

/** The wrapper's own reading of the whole run. */
export type WrapperVerdict = { readonly kind: "ok" } | { readonly kind: "failed"; readonly cause: WrapperFailureCause; readonly why: string };

/**
 * An attempt's `exit.json`, the fields the ladder reads. Each nullable field is
 * null when the record did not say — see the header: **null is not evidence**.
 */
export type ObservedExitRecord = {
  readonly kind: "exit-record";
  readonly ending: ObservedEnding;
  readonly timedOut: boolean;
  /** `answer.usable`; null when the record has no answer (a tmux launch, or an older writer). */
  readonly answerUsable: boolean | null;
  readonly verdict: WrapperVerdict | null;
  readonly usageLimit: boolean | null;
  readonly permissionDenials: number | null;
};

/** The protocol's `CompletionEvidence`: an exit record, or a reboot. There is no `vanished`. */
export type ObservedCompletion = { readonly kind: "rebooted" } | ObservedExitRecord;

/** Which proof licensed a `failed-before-launch` — the protocol's `FailedProof`, restated. */
export type ObservedFailedProof = "admission-refused" | "restarted-before-launching" | "material-mismatch" | "intent-not-written" | "launcher-refused";

/** The protocol's eight states, each carrying only what it can have. */
export type ObservedState =
  | { readonly kind: "planned" }
  | { readonly kind: "waiting-admission"; readonly why: string }
  | { readonly kind: "reserved" }
  | { readonly kind: "launching"; readonly attempt: number }
  | { readonly kind: "observed-running"; readonly attempt: number }
  | { readonly kind: "completed"; readonly attempt: number; readonly evidence: ObservedCompletion }
  | { readonly kind: "failed-before-launch"; readonly attempt: number | null; readonly proof: ObservedFailedProof; readonly why: string }
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
 * THE STATE LISTS AGREE, BOTH WAYS. `wire.ts` restates the eight states because
 * it imports nothing; this file restates them as a union's arms. A state added
 * to one and not the other fails to compile here.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const STATES_AGREE: Same<ObservedState["kind"], ScheduledLaunchState> = true;
void STATES_AGREE;

/** Which results are failures, which are not endings yet, and the one good ending. The compiler counts them. */
const RESULT_CLASS: Readonly<Record<ScheduledResultKind, "open" | "failed" | "succeeded">> = {
  pending: "open",
  "admission-waiting": "open",
  running: "open",
  unknown: "open",
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
 * among them: it is not an ending, it is an ending nobody can read yet.
 */
export const RESULT_FAILED: ReadonlySet<ScheduledResultKind> = new Set(
  (Object.keys(RESULT_CLASS) as ScheduledResultKind[]).filter((kind) => RESULT_CLASS[kind] === "failed"),
);

const open = (kind: ScheduledResultKind, why: string): ScheduledResult => ({ kind, why, at: null });

/** The ladder. Exhaustive over the eight states, so a ninth is a compile error here. */
export function classifyOccurrence(o: ObservedLaunch): ScheduledResult {
  const state = o.state;
  const ended = (kind: ScheduledResultKind, why: string): ScheduledResult => ({ kind, why, at: o.updatedAt });
  switch (state.kind) {
    case "planned":
    case "waiting-admission":
    case "reserved":
    case "launching":
    case "observed-running":
    case "outcome-unknown": {
      // A DISPOSITION FIRST, on every state that has no ending of its own — the
      // header's second section says why the table's order alone would bury it.
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
      return ended(
        "launch-failed",
        `it failed before launch, with proof that nothing ran (${state.proof}${state.attempt === null ? "" : `, attempt ${state.attempt}`}): ${state.why}`,
      );
    case "completed": {
      const evidence = state.evidence;
      switch (evidence.kind) {
        case "rebooted":
          return ended("interrupted", `the box rebooted while attempt ${state.attempt} ran, so it never wrote an exit record`);
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
  const ending = describeEnding(e.ending);

  if (e.ending.kind === "supervisor-failed") return ["launch-failed", `the supervisor itself failed and said so: ${e.ending.why}`];
  if (cause === "spawn") return ["launch-failed", `the wrapper could not start the session (${ending}): ${wrapperWhy}`];

  if (e.timedOut) return ["timed-out", `the exit record says it ran past its timeout and was stopped (${ending})`];
  if (cause === "timeout") return ["timed-out", `the wrapper says it timed out (${ending}): ${wrapperWhy}`];

  if (e.usageLimit === true) return ["quota-refused", `the exit record says the account's usage limit refused it (${ending})`];

  if (e.ending.kind === "signalled") return ["interrupted", `it was stopped by ${e.ending.signal} before it finished, and not by its timeout`];

  if (e.permissionDenials !== null && e.permissionDenials > 0) {
    return ["permission-denied", `the exit record counts ${e.permissionDenials} permission denial${e.permissionDenials === 1 ? "" : "s"} (${ending}), so it could not do something it tried`];
  }

  const code = e.ending.code;
  const projectedAnswerUsable = answer.kind === "present" && answer.usable && answer.bytes > 0;
  if (code === 0 && (e.answerUsable !== true || !projectedAnswerUsable)) {
    if (e.answerUsable !== true) {
      return ["missing-answer", e.answerUsable === false ? "it exited 0 but its answer was empty or unusable" : "it exited 0 and the exit record says nothing of an answer"];
    }
    return ["missing-answer", "it exited 0 and the exit record calls its answer usable, but the projected answer is absent, unusable or empty"];
  }
  if (cause === "no-result" || cause === "empty-answer") return ["missing-answer", `the wrapper says there was no answer (${cause}, ${ending}): ${wrapperWhy}`];

  if (code !== 0) return ["failed", wrapperWhy === null ? `it exited ${code}` : `it exited ${code}, and the wrapper says ${cause}: ${wrapperWhy}`];
  if (cause !== null) return ["failed", `it exited 0 but the wrapper says ${cause}: ${wrapperWhy}`];

  // EXIT 0, A USABLE ANSWER, NO FAILED VERDICT. Now every unsaid field is a
  // reason not to claim success — the header's null section.
  if (e.verdict === null) return ["failed", "it exited 0 with a usable answer, but the exit record gives no wrapper verdict, so success cannot be claimed"];
  if (e.usageLimit === null) return ["failed", "it exited 0 with a usable answer, but the exit record does not say whether a usage limit was hit"];
  if (e.permissionDenials === null) return ["failed", "it exited 0 with a usable answer, but the exit record does not count permission denials"];
  if (e.permissionDenials !== 0) return ["failed", `it exited 0 with a usable answer, but the exit record's permission denial count (${e.permissionDenials}) is not zero`];

  return ["succeeded", "it exited 0, the wrapper's verdict was ok, its answer is usable, and there were no permission denials and no usage limit"];
}

function describeEnding(ending: ObservedEnding): string {
  switch (ending.kind) {
    case "exited":
      return `exit ${ending.code}`;
    case "signalled":
      return `stopped by ${ending.signal}`;
    case "supervisor-failed":
      return `the supervisor failed: ${ending.why}`;
    default: {
      const never: never = ending;
      throw new Error(`no words for ending ${JSON.stringify(never)}`);
    }
  }
}
