/**
 * **WHICH RUN THE PAGE'S STATE BELONGS TO — one number per session, which only
 * ever goes up.**
 *
 * A tmux pane is furniture. The `claude` inside it can exit and be replaced any
 * number of times, and across that replacement the pane's handle, the pane's pid
 * and `CLAUDE_SESSION_ID` are all unchanged — so every address the dashboard
 * holds goes on resolving, and every piece of state it holds *about* that
 * session goes on being drawn under the new run's name. The half-typed message
 * you were about to send to the agent that was reasoning about your worktree is
 * still in the box; the last action's outcome card still says what happened, as
 * though it happened to this one.
 *
 * `FleetRow.execution` is the one field on the row that can tell the two runs
 * apart (types.ts says so in as many words), and this file turns it into the
 * only thing React needs to throw that state away: a **key**. Mount the detail
 * pane with it and a replacement discards the whole component — draft, outcome
 * cards, refusals — with no per-field plumbing at all.
 *
 * ## Why the key is an EPOCH and not the token itself
 *
 * The obvious version is `key={executionTokenText(token)}`, and it is wrong for
 * a reason that is the box's normal weather rather than an edge case. The token
 * is absent whenever the reading is not `verified`, which on a loaded box
 * happens for a collection or two at a time — the probe's own tolerance was
 * widened from 5 s to 15 s in September because slow collections were turning
 * every row `unknown`. A key built naively from the token would read
 * `T → "" → T` and remount twice, wiping whatever was being typed for a reason
 * that is **not** a replacement.
 *
 * So the key is built from *the last token that was verified*, and it advances
 * only when `continuityOf` says `replaced`. `unverifiable` preserves the
 * baseline and never updates it: as `execution-token.ts` puts it, unverifiable
 * is not a soft `same` — but here the arm that must not act is the arm that must
 * not *destroy*, and holding the last verified token is what stops an absence of
 * evidence from reading as evidence of a change.
 *
 * ## Why the baseline is per session id, and why the id is in the key
 *
 * One hook instance serves whichever row is selected, and the selection moves.
 * A single baseline would compare session B's token against session A's and
 * report a replacement that never happened. So the memory is a map keyed by
 * `row.id`, and the returned key carries **both** the id and that session's
 * epoch — which is what makes switching between two rows whose executions are
 * both unverifiable still change the key. GPT Sol's F4, 2026-09-10, verbatim in
 * docs/plans/260910c.
 */
import { useState } from "react";

import { continuityOf, executionTokenText } from "../../execution-token.js";
import type { ExecutionReading } from "../../wire.js";

/**
 * The last verified token seen for one session, and how many replacements have
 * been counted under its handle.
 *
 * `epoch` starts at 0 and is only ever incremented, so it can be compared for
 * equality and never has to be interpreted. It is deliberately NOT the token:
 * a key that carried the token would leak a pid into a React key for no gain,
 * and — more to the point — an epoch is what lets *"we cannot see it"* leave the
 * key alone.
 */
type Baseline = { token: string; epoch: number };

/**
 * The minimum of a row this hook reads. Written as a structural type rather
 * than importing `FleetRow` so that this file stays a leaf: it imports `react`,
 * `execution-token` and two wire types, and nothing that can reach `node:`.
 * `tools/fleet/web/` is compiled a second time by a DOM-only project, and one
 * transitive `node:child_process` here is ~33 errors on sight (wire.ts says
 * why, at length).
 */
export type ExecutionRow = { id: string; execution: ExecutionReading };

/** The key for "no row is selected" — still a pair, so it cannot collide. */
const NOTHING_SELECTED = JSON.stringify([null, 0]);

/**
 * **THE MOUNT KEY FOR EVERYTHING THIS PAGE HOLDS ABOUT ONE SESSION.**
 *
 * Call it unconditionally, once per component, with whichever row is selected —
 * `null` included. What comes back changes when, and only when, **the selection
 * changes or that session's process is verifiably replaced**.
 *
 * Four rules, and the middle two are the ones a naive version gets wrong:
 *
 *  - a **first** verified token establishes that session's baseline *without*
 *    reporting a replacement — there was nothing to be replaced;
 *  - the **same** verified token holds the epoch where it is;
 *  - a **different** verified token increments it;
 *  - an **unverifiable** reading, or no row at all, **preserves but never
 *    updates** the baseline.
 *
 * ## Where the memory lives, and why it is state rather than a ref
 *
 * A ref mutated during render is the usual trap here and it is genuinely wrong:
 * render must be a pure function of props and state, and React may render a
 * component whose output it then discards. This uses `useState` and **adjusts
 * that state during render** — React's own sanctioned pattern for deriving from
 * a changed input — computing the epoch for *this* render at the same time, so
 * the caller gets the new key in the very first committed frame.
 *
 * That last clause is the reason an effect was not used. An effect runs after
 * React has committed, and possibly after the browser has painted, so a version
 * that updated the baseline in one would commit exactly one frame with the
 * previous run's draft and outcome cards under the new run's name — which is
 * the misattribution this whole file exists to end. Same argument, and the same
 * bug, as `Held` in RecentMessages.tsx.
 *
 * The map grows by one entry per session the reader opens, and holds two
 * primitives per entry. That is bounded by how many sessions a person clicks in
 * one page-load, and the page is reloaded whenever iOS reclaims the tab; there
 * is nothing here worth evicting.
 */
export function useExecutionEpoch(row: ExecutionRow | null): string {
  const [baselines, setBaselines] = useState<ReadonlyMap<string, Baseline>>(() => new Map());

  if (row === null) return NOTHING_SELECTED;

  const held = baselines.get(row.id) ?? null;
  /**
   * **`continuityOf` DECIDES, NOT A HAND-WRITTEN COMPARISON.** It is the one
   * place that knows `unverifiable` is not a soft `same`, and a second copy of
   * that rule in a component is how the two drift apart.
   */
  const verdict = continuityOf(held?.token ?? null, row.execution);
  /* The token as text, for storing. Read from the reading rather than taken
     apart from `verdict.why`, which is prose written for a person. */
  const token = row.execution.kind === "verified" ? executionTokenText(row.execution.token) : null;

  let epoch = held?.epoch ?? 0;
  let next: Baseline | null = null;
  if (verdict.kind === "replaced") {
    /* The one arm that moves the key. `verdict.current` is the token that
       replaced the stored one; using it rather than `token` keeps the stored
       value and the verdict from being two readings of the same thing. */
    epoch = epoch + 1;
    next = { token: verdict.current, epoch };
  } else if (verdict.kind === "unverifiable" && token !== null) {
    /* A verified reading with nothing to compare it against: `continuityOf`
       answers `unverifiable` with `previous: null`, and that is the FIRST
       BASELINE rather than a change. The epoch stays where it is — a session
       whose identity we have only just learned has not been replaced. */
    next = { token, epoch };
  }
  /* Everything else — `same`, and an unverifiable reading with no token — leaves
     the map exactly as it is. That is the flicker case, and it is the one this
     hook exists for. */

  if (next !== null) {
    const settled = next;
    setBaselines((prev) => {
      const already = prev.get(row.id);
      if (already !== undefined && already.token === settled.token && already.epoch === settled.epoch) return prev;
      const copy = new Map(prev);
      copy.set(row.id, settled);
      return copy;
    });
  }

  /* **BOTH HALVES, ALWAYS.** The epoch alone would be equal for two different
     sessions that have each been replaced the same number of times — which on a
     page whose default state is "nobody could verify anything" means equal for
     every session at 0, and one row's half-typed message would appear under
     another row's name. */
  return JSON.stringify([row.id, epoch]);
}

/**
 * The last KNOWN value of one fact about one session, and how many times it has
 * changed to a different known value. The same shape as `Baseline`, for a fact
 * that has no verified/unverifiable arms — only "read" and "could not be read".
 */
type KnownBaseline = { value: string; epoch: number };

/**
 * **THE EPOCH'S RULE, FOR A FACT THAT IS EITHER KNOWN OR NOT.**
 *
 * `null` here means *this snapshot could not read it*, never *it changed to
 * nothing*: `collect.ts` answers `tmuxServerPid: null` whenever `list-panes`
 * fails — a timeout on a loaded box, while the rows can still arrive — and a
 * collection that cannot read a row's tmux environment leaves its claim null
 * the same way. So, exactly as `useExecutionEpoch` treats an unverifiable
 * reading:
 *
 *  - a **first** known value establishes the baseline without counting a change;
 *  - the **same** known value holds the epoch;
 *  - a **different** known value increments it — however many unreadable
 *    snapshots came between the two, since an unknown in the middle cannot
 *    launder a change;
 *  - **null preserves but never updates** the baseline.
 *
 * Per session id, and as render-phase state, for the reasons given at
 * `useExecutionEpoch`.
 */
function useKnownEpoch(id: string | null, value: string | null): number {
  const [baselines, setBaselines] = useState<ReadonlyMap<string, KnownBaseline>>(() => new Map());
  if (id === null) return 0;
  const held = baselines.get(id) ?? null;
  if (value === null) return held?.epoch ?? 0;
  if (held !== null && held.value === value) return held.epoch;

  const settled: KnownBaseline = { value, epoch: held === null ? 0 : held.epoch + 1 };
  setBaselines((prev) => {
    const already = prev.get(id);
    if (already !== undefined && already.value === settled.value && already.epoch === settled.epoch) return prev;
    const copy = new Map(prev);
    copy.set(id, settled);
    return copy;
  });
  return settled.epoch;
}

/** The minimum of a row the detail key reads: `ExecutionRow`, plus the claim. */
export type TargetRow = ExecutionRow & { claudeSessionId: string | null };

/**
 * **THE MOUNT KEY FOR THE DETAIL PANE: WHICH TARGET ITS STATE WAS CREATED
 * AGAINST.**
 *
 * Three facts name that target, and a change in any of them must discard the
 * draft and the outcome cards: the **run** (`useExecutionEpoch`), the **tmux
 * server** the handle lives in — `$1643` names a session only inside one — and
 * the **conversation claim**, which is what every transcript read and write is
 * resolved against. GPT Sol's F11 put the last two into the key raw, and on
 * this box that made the key flicker: `123 → null → 123` is two remounts and an
 * eaten draft for a reason that is not a change of anything.
 *
 * So all three follow one rule — *a change is two readings that were both
 * taken and disagree* — and it lives here rather than as a second hand-written
 * version at the call site. Call it unconditionally, once, `null` included.
 */
export function useDetailTargetKey(row: TargetRow | null, tmuxServerPid: number | null): string {
  const executionKey = useExecutionEpoch(row);
  const id = row?.id ?? null;
  const world = useKnownEpoch(id, tmuxServerPid === null ? null : String(tmuxServerPid));
  /* `""` is not a conversation: the transcript reader treats it as no id at all. */
  const claim = useKnownEpoch(id, row === null || row.claudeSessionId === "" ? null : row.claudeSessionId);
  if (row === null) return NOTHING_SELECTED;
  /* `executionKey` already carries `row.id`, which is what separates two
     sessions whose three epochs are equal. */
  return JSON.stringify([executionKey, world, claim]);
}
