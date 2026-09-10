/**
 * `gjd-remote new-claude --launch-id <correlationId> --launch-dir <dir>` — the
 * pieces `cmdNewClaude` splices in (plan 260910f § D6, Stage 2).
 *
 * `cmdNewClaude` needs a box, so everything testable lives here, as pure
 * functions of the parsed flags. Each is EMPTY without them — `""` or `[]` — so
 * a session started without the flags gets byte-for-byte the job text and the
 * tmux command it always did.
 *
 *  - {@link parseLaunchFlags}: both flags or neither; the id is a correlation
 *    id; the directory absolute with no control byte. Called in `main`, before
 *    anything touches the network.
 *  - {@link launchBoxCheck}: on the box, before the session exists, the
 *    directory is there and its `intent.json` names this id. Folded into the
 *    ssh step that already runs, so it costs no round trip.
 *  - {@link launchTmuxFlags}: `-e SPIDERYARN_LAUNCH_ID=… -e
 *    SPIDERYARN_LAUNCH_DIR=…` beside `metaFlags`, so the id is in the session
 *    at creation.
 *  - {@link launchStartLines} / {@link launchExitLines}: `start.json` as the
 *    job's first command, before the directory guard, failing through
 *    gjd-remote's own `failTo` (F3); `exit.json` from the status the job has
 *    already saved, before `exec bash -l`.
 *
 * Every value that reaches a shell goes through the caller's `shq` — the
 * validation in {@link parseLaunchFlags} is a refusal of what cannot be
 * quoted into a one-line command, not a substitute for quoting (F13).
 *
 * This imports the artefact module and nothing else of the launch protocol.
 */
import {
  INTENT_FILE,
  LAUNCH_DIR_VAR,
  LAUNCH_ID_VAR,
  exitArtefactLine,
  isCorrelationId,
  launchDirProblem,
  startArtefactLine,
  type CorrelationId,
} from "../tools/overseer/launch-artefacts.js";

/** gjd-remote's job saves Claude's status here, and the exit line reads it from here. */
export const GJD_CLAUDE_STATUS_VAR = "_gjd_claude_status";

export type LaunchFlags = { readonly correlationId: CorrelationId; readonly dir: string };

export type Quote = (text: string) => string;

export function parseLaunchFlags(id: string | undefined, dir: string | undefined): { readonly ok: true; readonly launch: LaunchFlags | undefined } | { readonly ok: false; readonly why: string } {
  if (id === undefined && dir === undefined) return { ok: true, launch: undefined };
  if (id === undefined) return { ok: false, why: "--launch-dir needs --launch-id beside it" };
  if (dir === undefined) return { ok: false, why: "--launch-id needs --launch-dir beside it" };
  if (!isCorrelationId(id)) return { ok: false, why: `--launch-id ${JSON.stringify(id)} is not a launch correlation id (lo-<20 hex>-a<n>)` };
  const problem = launchDirProblem(dir);
  if (problem !== null) return { ok: false, why: `--launch-dir ${problem}` };
  return { ok: true, launch: { correlationId: id, dir } };
}

/** The two `-e` flags, with the trailing space `accountTmuxPrefix` also leaves, or nothing. */
export function launchTmuxFlags(launch: LaunchFlags | undefined, quote: Quote): string {
  if (launch === undefined) return "";
  return `-e ${LAUNCH_ID_VAR}=${quote(launch.correlationId)} -e ${LAUNCH_DIR_VAR}=${quote(launch.dir)} `;
}

/**
 * ` && { … }` to append to an existing `&&` chain on the box, or nothing.
 *
 * `grep -F` for `"correlationId":"<id>"` — the exact bytes `JSON.stringify`
 * writes, closing quote included, so `-a1` cannot match `-a12`. A light check
 * on purpose: the wrapper-side reader is the strict one, and this only has to
 * refuse a directory that is not this launch's before a session exists.
 */
export function launchBoxCheck(launch: LaunchFlags | undefined, quote: Quote): string {
  if (launch === undefined) return "";
  const intent = `${launch.dir}/${INTENT_FILE}`;
  const needle = `"correlationId":"${launch.correlationId}"`;
  const refusal = `refusing to start: ${launch.dir} does not hold an ${INTENT_FILE} for ${launch.correlationId}`;
  return ` && { { test -d ${quote(launch.dir)} && grep -qF -- ${quote(needle)} ${quote(intent)}; } || { printf '%s\\n' ${quote(refusal)} >&2; exit 1; }; }`;
}

/** The job's first command: `start.json`, or `onFailure` (gjd-remote's `failTo`) and no Claude. */
export function launchStartLines(launch: LaunchFlags | undefined, onFailure: string, quote: Quote): string[] {
  if (launch === undefined) return [];
  return [startArtefactLine({ correlationId: launch.correlationId, dir: launch.dir, onFailure, quote })];
}

/**
 * `exit.json` from `$_gjd_claude_status`. Its failure is a sentence on the pane
 * — which `exec bash -l` keeps — and no evidence: the protocol then holds the
 * launch as `outcome-unknown` rather than guess how it ended.
 */
export function launchExitLines(launch: LaunchFlags | undefined, quote: Quote): string[] {
  if (launch === undefined) return [];
  const note = `WARNING: could not write ${launch.dir}/exit.json — the launch protocol will hold ${launch.correlationId} as unknown until Greg disposes of it`;
  return [exitArtefactLine({ correlationId: launch.correlationId, dir: launch.dir, statusVar: GJD_CLAUDE_STATUS_VAR, onFailure: `printf '%s\\n' ${quote(note)} >&2`, quote })];
}
