/**
 * **ONE LAUNCH RECORD, AS THE CLASSIFIER SEES IT.** Plan
 * 260910f-scheduled-dispatch § D6, Stage B.
 *
 * `observedOf` is the one place that reads the launch protocol's `LaunchRecord`
 * on behalf of the result ladder (`occurrence-result.ts`) and the occurrences
 * projection. **Pure**: the caller reads the attempt's artefacts —
 * `readArtefacts(view.attemptDir(id, attempt), correlationId)` — and hands the
 * `exit` reading in, so nothing here touches a disk or a clock.
 *
 * ## Only schedule origins
 *
 * A job id, a due instant and a behaviour hash exist only on a `schedule`
 * origin. Any other origin is the `not-schedule` arm, with the reason — not a
 * row with blanks in it.
 *
 * ## The journal is the ledger; `exit.json` can only confirm it
 *
 * A `completed` record's exit-record evidence is the protocol's own copy of the
 * attempt's `exit.json`, taken field by field when reconciliation read it
 * (`launch-protocol.ts § evidenceDecision`). So the evidence comes from the
 * journal, and the `exit` reading handed in is a check on it:
 *
 *   present, the same facts      → the journal's facts, as read
 *   present, different facts     → `exit-unconfirmed`: the ladder reads `failed`
 *   unreadable                   → `exit-unconfirmed`, with the reader's reason: `failed`
 *   absent, or not read (null)   → the journal's facts stand
 *
 * **An unreadable `exit.json` is never a success**, and it is not
 * `missing-answer` either: whether there was an answer is exactly what cannot
 * be said. An unconfirmed completion projects NO answer — the answer is what
 * the green claim and the answer link rest on — but keeps the journal's
 * transcript path, which is shown as text only and is what somebody debugging
 * it wants.
 *
 * An absent file leaves the journal standing because absence is a fact, not a
 * failed read (`launch-artefacts.ts`'s header), and the answer route checks the
 * answer file's own size and sha256 before serving a byte.
 *
 * For every state but `completed` the reading is ignored: an `exit.json` the
 * reconciler has not folded yet does not end a running occurrence here. The
 * next reconcile will, and then this reads it as the journal says.
 *
 * ## The run spec is the record's when it has one
 *
 * The record's `run` is what the launcher was actually given, the pool account
 * it ran on included. The caller's is the job's current spec — timeout and
 * access, never an account, which is not the job's to name — used only for a
 * `tmux` launch, which pins none; its account is then null. When the two
 * differ the record's wins without comment: the job's own row in the
 * projection carries the current spec, so both stay visible.
 *
 * ## The tmux session
 *
 * The correlation id, while the state is `launching` or `observed-running`, and
 * only for a `tmux-headless` launch — `launchers.ts § tmuxHeadlessLauncher`
 * names its session `-s <correlationId>` exactly. A `headless` launch has no
 * session, and gjd-remote's `tmux` launch names its own, so for those this is
 * null rather than a name a cancel command would miss.
 */
import type { ScheduledAnswer, ScheduledRunSpec } from "../fleet/wire.js";
import type { JobRunSpec } from "./jobs.js";
import type { ArtefactRead, ExitRecord } from "./launch-artefacts.js";
import type { CompletionEvidence, ExitAnswer, ExitFacts, LaunchRecord, RunSpec } from "./launch-protocol.js";
import type { ObservedCompletion, ObservedDisposition, ObservedLaunch, ObservedState } from "./occurrence-result.js";

export type ObservedOfInput = {
  /** The current attempt's `exit.json`, as `readArtefacts` read it; null when there is no attempt to read. */
  readonly exit: ArtefactRead<ExitRecord> | null;
  /** The job's current run spec — used only when the record pins none, and then with no account. */
  readonly run: JobRunSpec;
  /** The scheduler's own key for this occurrence (`jobs.ts § occurrenceId`). */
  readonly schedulerOccurrenceId: string;
};

export type NotSchedule = { readonly kind: "not-schedule"; readonly why: string };

const ABSENT: ScheduledAnswer = { kind: "absent" };

export function observedOf(record: LaunchRecord, input: ObservedOfInput): ObservedLaunch | NotSchedule {
  const origin = record.origin;
  if (origin.kind !== "schedule") {
    return { kind: "not-schedule", why: `${record.id} came from a ${origin.kind} origin, not the scheduler, so it has no job, due instant or behaviour hash` };
  }
  const seen = stateOf(record, input.exit);
  return {
    launchOccurrenceId: record.id,
    schedulerOccurrenceId: input.schedulerOccurrenceId,
    jobId: origin.jobId,
    scheduledAt: origin.scheduledAt,
    behaviourHash: origin.behaviourHash,
    plannedAt: record.plannedAt,
    updatedAt: record.updatedAt,
    attempts: record.attempts.length,
    run: runOf(record.run, input.run),
    tmuxSession: tmuxSessionOf(record),
    transcriptPath: seen.transcriptPath,
    answer: seen.answer,
    disposition: dispositionOf(record),
    state: seen.state,
  };
}

type Seen = { readonly state: ObservedState; readonly answer: ScheduledAnswer; readonly transcriptPath: string | null };

const bare = (state: ObservedState): Seen => ({ state, answer: ABSENT, transcriptPath: null });

/** The eight states. Exhaustive, so a ninth is a compile error here as well as in the ladder. */
function stateOf(record: LaunchRecord, exit: ArtefactRead<ExitRecord> | null): Seen {
  switch (record.state) {
    case "planned":
      return bare({ kind: "planned" });
    case "waiting-admission":
      return bare({ kind: "waiting-admission", why: record.why });
    case "reserved":
      return bare({ kind: "reserved" });
    case "launching":
      return bare({ kind: "launching", attempt: record.current.attempt });
    case "observed-running":
      return bare({ kind: "observed-running", attempt: record.current.attempt });
    case "outcome-unknown":
      return bare({ kind: "outcome-unknown", attempt: record.current.attempt, why: record.why });
    case "failed-before-launch":
      return bare({ kind: "failed-before-launch", attempt: record.attempt === null ? null : record.attempt.attempt, proof: record.proof, why: record.why, endedAt: record.endedAt });
    case "completed": {
      const attempt = record.current.attempt;
      const completion = completionOf(record.evidence, exit, attempt);
      return { state: { kind: "completed", attempt, evidence: completion.evidence, endedAt: record.endedAt }, answer: completion.answer, transcriptPath: completion.transcriptPath };
    }
    default: {
      const never: never = record;
      throw new Error(`no observed state for launch record ${JSON.stringify(never)}`);
    }
  }
}

function completionOf(
  evidence: CompletionEvidence,
  exit: ArtefactRead<ExitRecord> | null,
  attempt: number,
): { readonly evidence: ObservedCompletion; readonly answer: ScheduledAnswer; readonly transcriptPath: string | null } {
  switch (evidence.kind) {
    case "rebooted":
      return { evidence: { kind: "rebooted" }, answer: ABSENT, transcriptPath: null };
    case "exit-record": {
      const journal = factsOf(evidence);
      const problem = unconfirmed(journal, exit);
      if (problem !== null) return { evidence: { kind: "exit-unconfirmed", why: problem }, answer: ABSENT, transcriptPath: journal.transcript };
      return { evidence: { kind: "exit-record", ...journal }, answer: answerOf(journal.answer, attempt), transcriptPath: journal.transcript };
    }
    default: {
      const never: never = evidence;
      throw new Error(`no completion for evidence ${JSON.stringify(never)}`);
    }
  }
}

/** Why the attempt's `exit.json` does not confirm the journal's copy, or null — the header's table. */
function unconfirmed(journal: ExitFacts, exit: ArtefactRead<ExitRecord> | null): string | null {
  if (exit === null) return null;
  switch (exit.kind) {
    case "absent":
      return null;
    case "unreadable":
      return `the attempt's exit.json could not be read: ${exit.why}`;
    case "present":
      return canonicalFacts(factsOf(exit.record)) === canonicalFacts(journal) ? null : "the attempt's exit.json says something other than the journal's copy of it";
    default: {
      const never: never = exit;
      throw new Error(`no confirmation for reading ${JSON.stringify(never)}`);
    }
  }
}

/** The six exit facts and nothing else — off a journal evidence or an `exit.json` record alike. */
function factsOf(f: ExitFacts): ExitFacts {
  return { ending: f.ending, verdict: f.verdict, usageLimit: f.usageLimit, permissionDenials: f.permissionDenials, answer: f.answer, transcript: f.transcript };
}

/** Every fact in a fixed order, so two copies compare by value and never by key order. */
function canonicalFacts(f: ExitFacts): string {
  const e = f.ending;
  const ending = e.kind === "exited" ? [e.kind, e.code] : e.kind === "signalled" ? [e.kind, e.signal] : [e.kind];
  const v = f.verdict;
  const verdict = v === null ? null : v.kind === "ok" ? [v.kind] : [v.kind, v.cause, v.why];
  const a = f.answer;
  const answer = a === null ? null : [a.path, a.bytes, a.sha256, a.usable];
  return JSON.stringify([ending, verdict, f.usageLimit, f.permissionDenials, answer, f.transcript]);
}

function answerOf(answer: ExitAnswer | null, attempt: number): ScheduledAnswer {
  return answer === null ? ABSENT : { kind: "present", attempt, bytes: answer.bytes, sha256: answer.sha256, usable: answer.usable };
}

/** The record's pinned spec, account and all; or, for a record that pins none, the job's with no account — the header's run spec section. */
function runOf(pinned: RunSpec | null, job: JobRunSpec): ScheduledRunSpec {
  if (pinned !== null) return { timeoutMinutes: pinned.timeoutMinutes, access: pinned.access, account: pinned.account };
  return { timeoutMinutes: job.timeoutMinutes, access: job.access, account: null };
}

function tmuxSessionOf(record: LaunchRecord): string | null {
  if (record.launcherKind !== "tmux-headless") return null;
  return record.state === "launching" || record.state === "observed-running" ? record.current.correlationId : null;
}

function dispositionOf(record: LaunchRecord): ObservedDisposition | null {
  const d = record.disposition;
  return d === null ? null : { decision: d.decision, why: d.why, at: d.at };
}
