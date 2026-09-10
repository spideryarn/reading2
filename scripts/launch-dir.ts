/**
 * `--launch-dir` for the subagent wrappers — the headless half of plan 260910f
 * § D6, shared by `run-claude.ts` and `run-codex.ts` so there is one copy.
 *
 * A wrapper given `--launch-dir` is a launched side: it finds the correlation id
 * in that directory's `intent.json`, refuses the directory unless it is a
 * private, unused attempt of a wrapper launch, writes `start.json` (its own
 * pid, start tick and boot) BEFORE it spawns anything, hands the id to its
 * children, and writes ONE `exit.json` when it ends — however it ends, short of
 * being killed itself.
 *
 * ## The whole invocation, not one child (F6)
 *
 * `run-codex`'s read-only fallback can run codex twice; its write-capable runs
 * never fall back. Neither rule moves: the wrapper notes its LAST run and its
 * final classification, and `finish` is called once, from `process.on('exit')`
 * — which `fail()`'s `process.exit` reaches too — after everything the wrapper
 * has decided. It is synchronous, because an 'exit' listener may not wait.
 *
 * ## One shape for how it ended ({@link ExitFacts})
 *
 * `ending` is the child as the kernel reported it; `verdict` is the wrapper's
 * existing classification, carried across as-is — the cause is passed to
 * `fail()` at each branch that already existed, nothing new is classified. A
 * failure before any child ran (`not-run`) can only be the wrapper's own or
 * the spawn's.
 *
 * ## What it cannot do
 *
 * A wrapper killed with SIGKILL, or by a signal it re-raises, never reaches
 * 'exit' and writes no `exit.json`. Its children may outlive it. The protocol
 * reads that as `outcome-unknown`, and holds the reservation (F1).
 *
 * Imported dynamically, only under `--launch-dir`, so a run without the flag
 * loads nothing new. This imports the artefact module and nothing else of the
 * launch protocol.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  LAUNCH_ID_VAR,
  NOT_RUN_CAUSES,
  answerFacts,
  checkLaunchDir,
  selfStartRecord,
  writeExitFile,
  writeStartFile,
  type CorrelationId,
  type ExitAnswer,
  type ExitFacts,
  type ExitRecord,
  type FailureCause,
  type LaunchIntent,
  type WrapperVerdict,
} from "../tools/overseer/launch-artefacts.js";
import { answerIsUsable, type RunResult } from "./subagent-cli.js";

/** Where the answer and the transcript go under `--launch-dir` when no flag says otherwise. */
export const LAUNCH_ANSWER_FILE = "answer.md";
export const LAUNCH_TRANSCRIPT_FILE = "transcript.ndjson";

export type WrapperFailure = { readonly cause: FailureCause; readonly why: string };

/** What the wrapper saw, as it goes. Pure input to {@link exitFactsOf}. */
export type WrapperObservations = {
  readonly run: Pick<RunResult, "status" | "signal" | "spawnError"> | undefined;
  readonly failure: WrapperFailure | undefined;
  readonly readings: { readonly usageLimit: boolean | null; readonly permissionDenials: number | null };
  readonly answer: ExitAnswer | null;
  readonly transcript: string | null;
};

/** The exit facts from what was observed and the code the process is exiting with. Always coherent: what the reader would refuse is never produced. */
export function exitFactsOf(seen: WrapperObservations, code: number): ExitFacts {
  const run = seen.run;
  const ending: ExitFacts["ending"] =
    run === undefined || run.spawnError !== undefined
      ? { kind: "not-run" }
      : run.signal !== null
        ? { kind: "signalled", signal: run.signal }
        : run.status !== null
          ? { kind: "exited", code: run.status }
          : { kind: "unobserved" };
  let verdict: WrapperVerdict;
  if (seen.failure !== undefined) verdict = { kind: "failed", cause: seen.failure.cause, why: seen.failure.why };
  else if (code !== 0) verdict = { kind: "failed", cause: "wrapper", why: `the wrapper exited ${code} without saying why` };
  else if (ending.kind !== "exited" || ending.code !== 0) verdict = { kind: "failed", cause: "wrapper", why: "the wrapper exited 0 over a child that did not exit 0" };
  else verdict = { kind: "ok" };
  // A child that never ran is only ever the wrapper's, the prompt check's, the spawn's or a hangup's failure.
  if (ending.kind === "not-run" && verdict.kind === "failed" && !NOT_RUN_CAUSES.includes(verdict.cause)) verdict = { kind: "failed", cause: "wrapper", why: verdict.why };
  const readings = ending.kind === "not-run" ? { usageLimit: null, permissionDenials: null } : seen.readings;
  return { ending, verdict, usageLimit: readings.usageLimit, permissionDenials: readings.permissionDenials, answer: seen.answer, transcript: seen.transcript };
}

export type WrapperLaunch = {
  readonly correlationId: CorrelationId;
  readonly dir: string;
  readonly intent: LaunchIntent;
  readonly defaults: { readonly answer: string; readonly transcript: string };
  /** The child's environment: the already-sanitised one, with the id added and nothing else moved. */
  childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** Why these are not the bytes `intent.json` pinned, or null. */
  promptProblem(bytes: Buffer): string | null;
  noteRun(run: RunResult): void;
  noteReadings(readings: { readonly usageLimit: boolean; readonly permissionDenials: number | null }): void;
  notePaths(paths: { readonly answer?: string | undefined; readonly transcript?: string | undefined }): void;
  noteFailure(failure: WrapperFailure): void;
  /** Synchronous and once: `exit.json` from what was noted. */
  finish(code: number): { readonly wrote: true } | { readonly wrote: false; readonly why: string };
  /**
   * `runChild`'s `onHangup`: the wrapper was hung up, the hangup went to the child's group and the
   * child was waited for within the kill grace. Called synchronously BEFORE the signal is re-raised
   * — a process that dies of a signal never reaches 'exit', so this is the last chance to record it.
   */
  hangup(result: RunResult): void;
  /**
   * {@link hangup}'s twin for a hangup BEFORE the CLI ran — during run-claude's auth probe (F20).
   * The probe's own ending is not the run's, so nothing is noted as the run: `not-run`, `hangup`.
   */
  hangupBeforeRun(): void;
};

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

/**
 * Check the directory and write `start.json`. A refusal here comes before
 * anything is spawned, and writes nothing: a directory that failed its check
 * is not one to leave evidence in.
 */
export function beginWrapperLaunch(dir: string, options: { readonly now?: () => Date; readonly uid?: number } = {}): { readonly ok: true; readonly launch: WrapperLaunch } | { readonly ok: false; readonly why: string } {
  const uid = options.uid ?? process.getuid?.() ?? -1;
  const checked = checkLaunchDir(dir, { uid, launcherKinds: ["headless", "tmux-headless"] });
  if (!checked.ok) return checked;
  const intent = checked.intent;
  const now = options.now ?? (() => new Date());
  const start = selfStartRecord(intent.correlationId, now());
  if (!start.ok) return { ok: false, why: `this process cannot say who it is, so no start.json can be written: ${start.why}` };
  try {
    writeStartFile(dir, start.value);
  } catch (cause) {
    return { ok: false, why: `start.json could not be written: ${messageOf(cause)}` };
  }

  let run: RunResult | undefined;
  let failure: WrapperFailure | undefined;
  let readings: WrapperObservations["readings"] = { usageLimit: null, permissionDenials: null };
  let answerPath: string | undefined;
  let transcriptPath: string | undefined;
  let finished: ReturnType<WrapperLaunch["finish"]> | undefined;

  const launch: WrapperLaunch = {
    correlationId: intent.correlationId,
    dir,
    intent,
    defaults: { answer: join(dir, LAUNCH_ANSWER_FILE), transcript: join(dir, LAUNCH_TRANSCRIPT_FILE) },
    childEnv: (env) => ({ ...env, [LAUNCH_ID_VAR]: intent.correlationId }),
    promptProblem(bytes) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (sha256 === intent.material.sha256 && bytes.byteLength === intent.material.bytes) return null;
      return `the prompt is ${bytes.byteLength} bytes / ${sha256.slice(0, 12)}, not the ${intent.material.bytes} / ${intent.material.sha256.slice(0, 12)} the launch pinned in intent.json`;
    },
    noteRun(result) {
      run = result;
    },
    noteReadings(next) {
      readings = next;
    },
    notePaths(paths) {
      if (paths.answer !== undefined) answerPath = paths.answer;
      if (paths.transcript !== undefined) transcriptPath = paths.transcript;
    },
    noteFailure(next) {
      failure ??= next;
    },
    finish(code) {
      if (finished !== undefined) return finished;
      const facts = answerPath === undefined ? null : answerFacts(answerPath);
      const answer: ExitAnswer | null = facts === null || answerPath === undefined ? null : { ...facts, usable: answerIsUsable(answerPath) };
      const transcript = transcriptPath !== undefined && existsSync(transcriptPath) ? transcriptPath : null;
      const record: ExitRecord = { v: 1, kind: "exit", correlationId: intent.correlationId, at: now().toISOString(), ...exitFactsOf({ run, failure, readings, answer, transcript }, code) };
      try {
        writeExitFile(dir, record);
        finished = { wrote: true };
      } catch (cause) {
        finished = { wrote: false, why: `exit.json could not be written: ${messageOf(cause)}` };
      }
      return finished;
    },
    hangup(result) {
      run = result;
      failure ??= {
        cause: "hangup",
        why: "the wrapper was hung up (its tmux pane or terminal closed); the hangup was forwarded to the child's group and the child waited for within the kill grace",
      };
      // 128 + SIGHUP's 1: the code a shell would report for the death that follows.
      const wrote = launch.finish(129);
      if (!wrote.wrote) process.stderr.write(`WARNING: ${wrote.why}\n`);
    },
    hangupBeforeRun() {
      failure ??= {
        cause: "hangup",
        why: "the wrapper was hung up (its tmux pane or terminal closed) during its auth probe, before the CLI ran; the hangup was forwarded to the probe and the probe waited for within the kill grace",
      };
      const wrote = launch.finish(129);
      if (!wrote.wrote) process.stderr.write(`WARNING: ${wrote.why}\n`);
    },
  };
  return { ok: true, launch };
}
