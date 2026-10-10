#!/usr/bin/env -S npx tsx
/**
 * The daily worktree sweep, from `worktree-sweep.timer`. Plan
 * docs/plans/261010d-standing-jobs-survive-a-reboot.md.
 *
 * > it would run deterministically and invisibly unless it hits worktrees that
 * > need LLM input, and then it would notify the overseer, and the overseer
 * > would probably delegate to an agent to figure out what's what with each
 * > worktree that can't be straightforwardly cleaned.
 * >
 * > — Greg, 2026-10-09 (`spya-q2qb7q`)
 *
 * **Exactly `npm run worktree:sweep -- --remove`**, imported rather than shelled
 * to so the outcomes arrive typed: `classifyAll` picks the candidates and
 * `removeAll` removes each one through the single-tree removal, re-checked
 * (scripts/worktree-sweep.ts § removeAll). Greg's permission for removing
 * landed trees is 2026-10-09's, quoted there.
 *
 * ## What reaches the Overseer
 *
 * - `needs-a-look` (unlanded work, untracked or gitignored files, a tree it
 *   could not judge) and `refused` (the removal disagreed with the
 *   classification): every day they are there.
 * - `in-use` with no live Claude session behind it — only processes, which may
 *   be a dev server or a job a finished session left running. Said ONCE, on the
 *   second sweep in a row that finds it, and not again while it lasts. The
 *   readiness loop's tree is one of these, permanently: one message, ever.
 *   This keeps the Overseer renewal's own rule (*"in use or needing a look that
 *   no live session … owns"*, standing-jobs.md), which GPT Sol's plan review
 *   (finding 8) caught the first draft dropping.
 * - `removed`, and `in-use` under a live Claude session: nothing.
 *
 * Nothing to judge, nothing said. The journal gets the full report either way.
 * The state of the once-only rule is ~/.overseer/worktree-sweep.json.
 *
 * Run from the PRIMARY checkout (the unit's WorkingDirectory): a worktree is
 * what this deletes.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import {
  describeBoxNotify,
  postEnvelopeWithRetries,
  prepareEnvelope,
  type BoxEnvelope,
  type BoxNotifyOutcome,
  type NotifyOptions,
} from "./box-notify.js";
import { classifyAll, removeAll, renderRemoval, type SweepOutcome } from "./worktree-sweep.js";
import { GIT_LOCATION_ENV } from "../tools/fleet/readiness-git.js";

/** How many trees the message names before "and N more". The journal has them all. */
export const NAMED_MAX = 8;

/** The prefix `composeInUse` (worktree-inuse.ts) gives the reason a live lock owner produces. */
const LIVE_SESSION_REASON = "its Claude session is still running";

/** An in-use tree whose only reasons are processes: nothing claims it but what is running there. */
export function unowned(o: SweepOutcome): boolean {
  return o.kind === "in-use" && !o.reasons.some((r) => r.startsWith(LIVE_SESSION_REASON));
}

/** Which unowned in-use trees have been seen before, and which have been said. */
export type SweepState = { seen: string[]; said: string[] };
type SweepPending =
  | { phase: "waiting"; text: string; after: SweepState }
  | { phase: "ready"; text: string; after: SweepState; envelope: BoxEnvelope; to: string };
export type StoredSweepState = SweepState & { pending: SweepPending | null };
const EMPTY_SWEEP_STATE: StoredSweepState = { seen: [], said: [], pending: null };

/**
 * The in-use trees to say today, and tomorrow's state. A tree is said on the
 * second sweep in a row that finds it unowned, once. A tree that stops being
 * unowned leaves both lists, so it would be said again if it came back.
 */
export function unownedToSay(outcomes: readonly SweepOutcome[], prev: SweepState): { say: SweepOutcome[]; next: SweepState } {
  const now = outcomes.filter(unowned);
  const names = new Set(now.map((o) => o.name));
  const say = now.filter((o) => prev.seen.includes(o.name) && !prev.said.includes(o.name));
  return {
    say,
    next: {
      seen: [...names].sort(),
      said: [...new Set([...prev.said.filter((n) => names.has(n)), ...say.map((o) => o.name)])].sort(),
    },
  };
}

/** A dry notification must not consume the once-only in-use message. */
export function withoutUndelivered(next: SweepState, say: readonly SweepOutcome[]): SweepState {
  const unsaid = new Set(say.map((o) => o.name));
  return { ...next, said: next.said.filter((name) => !unsaid.has(name)) };
}

function firstLine(o: SweepOutcome): string {
  const first = (o.kind === "refused" || o.kind === "removed" ? o.steps.at(-1) : o.reasons[0]) ?? "";
  return first === "" ? o.kind : `${o.kind}: ${first.slice(0, 120)}`;
}

/** The one line for the Overseer, or null when there is nothing to judge. */
export function sweepMessage(outcomes: readonly SweepOutcome[], unownedSay: readonly SweepOutcome[]): string | null {
  const judge = [...outcomes.filter((o) => o.kind === "needs-a-look" || o.kind === "refused"), ...unownedSay];
  if (judge.length === 0) return null;
  const removed = outcomes.filter((o) => o.kind === "removed").length;
  const named = judge.slice(0, NAMED_MAX).map((o) => `${o.name} (${firstLine(o)})`);
  const more = judge.length > NAMED_MAX ? `, and ${judge.length - NAMED_MAX} more` : "";
  return (
    `daily worktree sweep: removed ${removed}; ${judge.length} for you to judge — ${named.join("; ")}${more}. ` +
    "For each with no live owner (gjd-remote ls; a deploy or readiness job counts): run npm run worktree:check in it, " +
    "then remove it under docs/project/worktrees.md, kill a leftover process under Greg's 2026-10-09 permission, or delegate one agent. " +
    "An in-use tree is named once; full report: journalctl -u worktree-sweep."
  );
}

export function sweepStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return env["WORKTREE_SWEEP_STATE"] ?? path.join(homedir(), ".overseer", "worktree-sweep.json");
}

function readSweepState(file: string): StoredSweepState {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<StoredSweepState>;
    if (Array.isArray(v.seen) && Array.isArray(v.said)) {
      const base = { seen: v.seen.map(String), said: v.said.map(String) };
      if (v.pending === undefined || v.pending === null) return { ...base, pending: null };
      const p = v.pending as Partial<SweepPending>;
      const after = p.after as Partial<SweepState> | undefined;
      if (typeof p.text !== "string" || after === undefined || !Array.isArray(after.seen) || !Array.isArray(after.said)) {
        throw new Error("invalid pending message");
      }
      const cleanAfter = { seen: after.seen.map(String), said: after.said.map(String) };
      if (p.phase === "waiting") return { ...base, pending: { phase: "waiting", text: p.text, after: cleanAfter } };
      if (p.phase === "ready" && typeof p.to === "string" && typeof p.envelope === "object" && p.envelope !== null) {
        return { ...base, pending: { phase: "ready", text: p.text, after: cleanAfter, to: p.to, envelope: p.envelope as BoxEnvelope } };
      }
      throw new Error("invalid pending message phase");
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_SWEEP_STATE;
    throw new Error(`cannot read ${file}; refusing to guess which sweep messages were sent: ${(e as Error).message}`);
  }
  throw new Error(`${file} is not a worktree-sweep state file; refusing to guess which messages were sent`);
}

function writeSweepState(file: string, s: StoredSweepState): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(s)}\n`);
  renameSync(tmp, file);
}

type SweepDelivery = { state: StoredSweepState; outcome: BoxNotifyOutcome };

/** Resume one durable notification intent. No POST happens before its exact envelope is on disk. */
export async function deliverSweepPending(
  file: string,
  state: StoredSweepState,
  notify: NotifyOptions & { tries?: number; gapMs?: number } = {},
  log: (line: string) => void = console.log,
): Promise<SweepDelivery> {
  let pending = state.pending;
  if (pending === null) throw new Error("deliverSweepPending called without a pending message");
  if (pending.phase === "waiting") {
    const prepared = await prepareEnvelope(pending.text, notify);
    if (prepared.kind !== "ready") {
      log(describeBoxNotify(prepared));
      return { state, outcome: prepared };
    }
    pending = { ...pending, phase: "ready", envelope: prepared.envelope, to: prepared.to };
    state = { ...state, pending };
    writeSweepState(file, state);
  }
  const outcome = await postEnvelopeWithRetries(pending.envelope, pending.to, notify);
  log(describeBoxNotify(outcome));
  const next: StoredSweepState =
    outcome.kind === "sent" || outcome.kind === "abandoned"
      ? { ...pending.after, pending: null }
      : outcome.kind === "not-sent"
        ? { ...state, pending: { phase: "waiting", text: pending.text, after: pending.after } }
        : state;
  writeSweepState(file, next);
  return { state: next, outcome };
}

/** Queue a new message durably, then try to deliver it. */
export async function queueSweepMessage(
  file: string,
  current: SweepState,
  text: string,
  after: SweepState,
  notify: NotifyOptions & { tries?: number; gapMs?: number } = {},
  log: (line: string) => void = console.log,
): Promise<SweepDelivery> {
  const state: StoredSweepState = { ...current, pending: { phase: "waiting", text, after } };
  writeSweepState(file, state);
  return deliverSweepPending(file, state, notify, log);
}

async function main(): Promise<number> {
  for (const name of GIT_LOCATION_ENV) delete process.env[name];
  const cwd = process.cwd();
  // --dry-run: remove nothing, tell nobody, write no state — the whole run, said aloud.
  const dryRun = process.argv.includes("--dry-run");
  const quiet = dryRun || process.argv.includes("--no-notify");
  const file = sweepStatePath();
  let stored = readSweepState(file);
  if (stored.pending !== null && !dryRun) {
    if (quiet) {
      console.log("an earlier sweep message is pending and --no-notify was given; not resending");
      return 1;
    }
    const delivery = await deliverSweepPending(file, stored);
    stored = delivery.state;
    if (stored.pending !== null || delivery.outcome.kind !== "sent") return 1;
  }
  const outcomes = removeAll(cwd, classifyAll(cwd), { dryRun });
  console.log(renderRemoval(outcomes, dryRun));

  const current: SweepState = { seen: stored.seen, said: stored.said };
  const { say, next } = unownedToSay(outcomes, current);
  const text = sweepMessage(outcomes, say);
  const refused = outcomes.some((o) => o.kind === "refused");
  if (text === null || quiet) {
    if (text !== null) console.log(`would tell the Overseer, --no-notify given: ${text}`);
    if (!dryRun) writeSweepState(file, { ...withoutUndelivered(next, say), pending: null });
    return refused ? 1 : 0;
  }
  const delivery = await queueSweepMessage(file, current, text, next);
  // Once a day, so a message that did not go waits for tomorrow's — and the
  // non-zero exit puts this run in `systemctl --failed` meanwhile.
  return delivery.outcome.kind !== "sent" || refused ? 1 : 0;
}

function isMain(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry).endsWith(path.join("scripts", "worktree-sweep-daily.ts"));
}

if (isMain()) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`worktree-sweep-daily crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      process.exit(2);
    },
  );
}
