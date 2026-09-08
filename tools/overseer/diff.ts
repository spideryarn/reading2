/**
 * What changed between two snapshots — the events the Overseer's history is
 * made of.
 *
 * Pure. Nothing here does I/O, and nothing at module scope does anything.
 *
 * ## The two rules that matter, and both are about NOT recording things
 *
 * Every bug this module can have has the same shape: the wrong answer is not an
 * error, it is a **plausible history**. Nothing looks broken afterwards, and
 * there is nothing to grep for. So both of the load-bearing rules here are
 * refusals.
 *
 * **1. Identity is the PAIR (tmux handle, claimed conversation), never the
 * handle alone.** The handle is immutable and is the right address for a live
 * view, which is why `gjd-remote` uses it. For a history it is wrong: a tmux
 * session can be resumed into a different conversation and keep its handle, its
 * name and its pane, so a timeline keyed on the handle splices two
 * conversations into one and shows one agent apparently working continuously.
 * Reached independently by the dashboard agent (from resumption) and by GPT Sol
 * (from handle reuse), 2026-09-08.
 *
 * **The second half of that pair is a claim, and it decays in one direction
 * only.** The uuid comes out of the tmux environment, is pinned there before
 * Claude ever runs, and is never updated afterwards — so a uuid that CHANGES
 * means the pane's conversation changed, and a uuid that DOES NOT change means
 * nothing at all. The pair is still the best key available and is still used;
 * what it cannot do is prove continuity. `ObservedRow.claimedConversationId`
 * has the measurements and `session-replaced` below has the consequence.
 *
 * **2. The diff refuses to run across a tmux generation boundary.**
 * `tmuxServerPid` is the generation. When the tmux server dies its handles
 * start again at `$0`, so a stored `$1643` and a live `$1643` are different
 * sessions wearing one name and nothing inside the row can tell them apart.
 * Diffing across that boundary produces a burst of `session-replaced` that
 * never happened — and a reboot is precisely the event this whole system exists
 * to survive. So a generation change closes out every session from the old
 * world and starts the new one fresh. It is not a variant of "replaced"; it is
 * a rule about when not to compare.
 *
 * ## The canonical key, and why status objects are never compared structurally
 *
 * Measured over the real capture in `tests/fixtures/overseer-snapshots/`: **51
 * status comparisons differed in some field, 2 differed in anything
 * meaningful.** `waiting.secondsLeft` counts down on every collection, so a
 * structural comparison writes fifty-one events a quarter of an hour, of which
 * forty-nine say nothing and the two that matter are buried. An earlier capture
 * measured 36:1 the same way.
 *
 * So the key is `kind`, plus `shell.busy`, plus `unknown.cause`, plus
 * `unknown.reportedStatus`. Countdowns and prose are excluded — see
 * `SessionUnknownCause` in scripts/gjd-remote-tmux.ts, which is where the rule
 * is written down, and `reportedStatus`, which is the one exception and carries
 * its own argument for being one.
 */
import type { SessionState } from "../../scripts/gjd-remote-tmux.js";
import type { ClaimedConversationId, FreshSnapshot, ObservedRow } from "./observation.js";

/** Which session, in the best terms available — one of which is not a fact. */
export type SessionIdentity = {
  /** tmux's own session handle, `$1991`. Unique within one tmux server and meaningless across two. */
  tmuxId: string;
  /**
   * What the tmux environment claims is running in the pane. Null for a shell,
   * a `setup`, and a legacy session that never pinned one — and stale for any
   * pane whose Claude has been replaced since launch. Not an identity; see
   * `ObservedRow.claimedConversationId`.
   */
  claimedConversationId: ClaimedConversationId | null;
};

/**
 * The identity as one comparable string.
 *
 * Branded so it cannot be passed where a name or a handle is wanted: the three
 * ids in this system are all strings and two of them start with `$`, and the
 * cost of mixing them up is a history rather than a crash.
 */
export type SessionKey = string & { readonly __brand: "overseer-session-key" };

/**
 * A space separates the halves and the second half is TAGGED, and the tag is
 * the part doing the work: without it, "no conversation" and "a conversation
 * whose id happens to be the empty string" are one key. `claudeId` comes out of
 * a tmux environment variable that anybody can set by hand, so "that cannot
 * happen" is not available here — `sessionState` already carries an arm for
 * somebody having set it to something that is not a session id.
 *
 * A space is unambiguous because the left half is `$` and digits and nothing
 * else, which the parser checks.
 */
export function sessionKey(identity: SessionIdentity): SessionKey {
  const conversation =
    identity.claimedConversationId === null ? "none" : `claims:${identity.claimedConversationId}`;
  return `${identity.tmuxId} ${conversation}` as SessionKey;
}

export function identityOf(row: ObservedRow): SessionIdentity {
  return { tmuxId: row.id, claimedConversationId: row.claimedConversationId };
}

/**
 * A status reduced to what a change in it would MEAN.
 *
 * Branded for the same reason as `SessionKey`: it is a string that looks like a
 * status name and is not one, and comparing it to `status.kind` by accident
 * would be true often enough to look right.
 */
export type StatusKey = string & { readonly __brand: "overseer-status-key" };

/**
 * The canonical transition key.
 *
 * A SWITCH WITH A `never` DEFAULT rather than a lookup table, because the
 * `never` is what breaks the build the day `SessionState` grows an arm — and
 * the failure mode of a missed arm here is that two genuinely different states
 * share a key and the transition between them is never recorded. That is
 * invisible in every test that does not already know about the new arm.
 */
export function statusKey(status: SessionState): StatusKey {
  switch (status.kind) {
    case "needs-you":
    case "working":
    case "idle":
    case "no-claude":
      return status.kind as StatusKey;
    // `secondsLeft` IS DELIBERATELY ABSENT. It counts down on every collection,
    // and including it is the single mistake that would make this log useless
    // — see the module comment for the measurement.
    case "waiting":
      return "waiting" as StatusKey;
    // `busy` is in, because it is the difference between a shell grinding
    // through `npm test` and one sitting at a prompt, and null is a third
    // answer ("could not ask") rather than a missing one.
    case "shell":
      return `shell:${String(status.busy)}` as StatusKey;
    // `cause` is in and `why` is out: `why` is OUR sentence, reworded freely and
    // interpolating the box's error text, so two calls a minute apart can
    // describe one unchanging situation. `reportedStatus` is in despite looking
    // like the same kind of thing, because it is the BOX'S observation and
    // changes only when the box says something different — without it, a Claude
    // Code that reports `compacting` and then `waiting-for-input` produces one
    // key and the intermediate state is lost. GPT Sol's S1-1.
    case "unknown":
      return `unknown:${status.cause}${status.reportedStatus === undefined ? "" : `:${status.reportedStatus}`}` as StatusKey;
    default: {
      const never: never = status;
      throw new Error(`no transition key for status ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Why a session stopped being in the snapshot.
 *
 * Two arms rather than one, because they are two different facts and only one
 * of them is about that session. `absent-from-snapshot` means this session went
 * away while the world carried on; `tmux-server-changed` means the world went
 * away and took every session with it, so the timestamp on the event is when we
 * NOTICED rather than when it happened.
 */
export type GoneReason = "absent-from-snapshot" | "tmux-server-changed";

/**
 * What the differ writes down.
 *
 * Every arm carries the identity and the key, so a reader of the log never has
 * to recompute one, and the `at`/`tmuxServerPid` pair so an event can be placed
 * in a world as well as in time. `tmuxServerPid` is the generation the EVENT'S
 * session belonged to — the old one for a gone event across a boundary — since
 * an address is meaningless without it.
 *
 * `session-replaced` is not accompanied by a `tmux-session-gone` and a
 * `session-seen`. Emitting those two would be false twice over: the tmux
 * session did not go anywhere, and the new conversation is not something that
 * merely appeared. One event, carrying both identities, is the thing that
 * actually happened.
 *
 * ## `session-replaced` FIRING IS EVIDENCE; ITS SILENCE IS NOT
 *
 * Read this before trusting the absence of one. The uuid is pinned into the
 * tmux environment at `tmux new-session -e …` and is never written again, so
 * when a pane's Claude exits and another starts in that pane, the row goes on
 * naming the first conversation and **this event does not fire in exactly the
 * case it was invented for.** Measured on the live box, 2026-09-08.
 *
 * The consequence is worth spelling out because it is not a failure anyone will
 * notice: a consumer keyed on a stale claim does not error and does not return
 * nothing. It returns real, well-formed, correctly-attributed content — from a
 * conversation that is not on the screen. That is the most convincing wrong
 * answer available, and it is the same class as every other hazard on this
 * page: a plausible history rather than a broken one.
 *
 * **What would resolve it, when a stage exists that may do I/O:** the
 * transcript's `lastModified`. A transcript TAIL is ~4.5 ms and under 1% of the
 * bytes of a 33 MB file, so liveness evidence is affordable — it is not
 * affordable HERE, because this stage is pure. Whatever supplies it should
 * arrive as an extra argument to `diff()` rather than as a reshaping of these
 * events; no seam is built for it yet, because a speculative one would be
 * structure bought against a signal nobody has measured through.
 *
 * Note also that `meta.dir` will not find that transcript: `EnterWorktree`
 * moves the file to the worktree's slug while `dir` names the primary.
 */
export type OverseerEvent =
  | {
      kind: "session-seen";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      /** The whole row: this is the event the register is built from, and `meta.dir` is not recoverable later. */
      row: ObservedRow;
    }
  | {
      kind: "session-status";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      from: StatusKey;
      to: StatusKey;
      /** The status itself as well as the key, so the log says `waiting` with its countdown and orders by the key. */
      status: SessionState;
    }
  | {
      kind: "tmux-session-gone";
      at: string;
      tmuxServerPid: number | null;
      key: SessionKey;
      identity: SessionIdentity;
      /** Carried for legibility: a grep of the log should name the agent, not only its handle. */
      name: string;
      why: GoneReason;
    }
  | {
      kind: "session-replaced";
      at: string;
      tmuxServerPid: number | null;
      /** The NEW pair. The old one is `previous`. */
      key: SessionKey;
      identity: SessionIdentity;
      previous: SessionIdentity;
      previousKey: SessionKey;
      row: ObservedRow;
    };

/**
 * How two snapshots' tmux generations relate.
 *
 * THREE ARMS, NOT A BOOLEAN, and `unverifiable` is why. A null generation means
 * the box could not be asked — a tmux busy enough to time out a listing is
 * exactly the box this tooling is for — and treating "I could not tell" as "it
 * changed" would close out the entire fleet every time the box was under load,
 * which is when it is least true and most alarming. `generationDrift()` in
 * tools/fleet/collect.ts makes the same call for the same reason, one layer
 * down.
 */
export type GenerationRelation = "same" | "changed" | "unverifiable";

export function generationRelation(before: number | null, after: number | null): GenerationRelation {
  if (before === null || after === null) return "unverifiable";
  return before === after ? "same" : "changed";
}

/**
 * The events between two accepted snapshots.
 *
 * `previous` is null for the first snapshot after a cold start, which yields a
 * `session-seen` per row — correct, and the reason S3 needs a checkpoint: a
 * daemon that restarts without one re-announces sessions it already knew about.
 *
 * Order is deterministic and is part of the contract, because these events are
 * appended to a log and read back in order: closures first, in the previous
 * snapshot's row order, then everything else in the next snapshot's row order.
 * A `session-seen` for a handle that a `tmux-session-gone` in the same batch
 * refers to is therefore always the later of the two.
 */
export function diff(previous: FreshSnapshot | null, next: FreshSnapshot): OverseerEvent[] {
  const at = next.clock.at;

  if (previous === null) {
    return next.rows.map((row) => seen(row, at, next.tmuxServerPid));
  }

  const relation = generationRelation(previous.tmuxServerPid, next.tmuxServerPid);
  switch (relation) {
    case "changed":
      // A DIFFERENT WORLD, so nothing is compared across it. Every handle in
      // `previous` belonged to a tmux server that no longer exists, and every
      // handle in `next` is a fresh allocation that may reuse the same number.
      // The alternative — matching them up — produces a burst of replacements
      // that reads as a plausible afternoon and describes a reboot.
      return [
        ...previous.rows.map((row) => gone(row, at, previous.tmuxServerPid, "tmux-server-changed")),
        ...next.rows.map((row) => seen(row, at, next.tmuxServerPid)),
      ];
    case "same":
    case "unverifiable":
      break;
    default: {
      const never: never = relation;
      throw new Error(`unhandled generation relation ${String(never)}`);
    }
  }

  // Keyed by HANDLE, not by identity, because that is the question being asked
  // here: is this tmux session still there, and if so is it still the same
  // conversation? Identity keys the register; the handle keys the comparison.
  const before = new Map(previous.rows.map((row) => [row.id, row]));
  const after = new Map(next.rows.map((row) => [row.id, row]));

  const events: OverseerEvent[] = [];

  for (const row of previous.rows) {
    // Only the tmux session going removes a row. Claude exiting does NOT — the
    // row stays and becomes `no-claude` — which is why this event has the word
    // `tmux` in it and why a consumer must not read it as "the agent finished".
    if (!after.has(row.id)) events.push(gone(row, at, previous.tmuxServerPid, "absent-from-snapshot"));
  }

  for (const row of next.rows) {
    const was = before.get(row.id);
    if (was === undefined) {
      events.push(seen(row, at, next.tmuxServerPid));
      continue;
    }
    // ONE-WAY EVIDENCE. A changed claim means the conversation changed; an
    // unchanged one means nothing, because the tmux environment is written once
    // — see `session-replaced` above for what that costs a consumer.
    if (was.claimedConversationId !== row.claimedConversationId) {
      events.push({
        kind: "session-replaced",
        at,
        tmuxServerPid: next.tmuxServerPid,
        key: sessionKey(identityOf(row)),
        identity: identityOf(row),
        previous: identityOf(was),
        previousKey: sessionKey(identityOf(was)),
        row,
      });
      continue;
    }
    const from = statusKey(was.status);
    const to = statusKey(row.status);
    // THE ONE LINE THE MEASUREMENT IS ABOUT. `from === to` on two structurally
    // different statuses is the normal case, not a near miss.
    if (from === to) continue;
    events.push({
      kind: "session-status",
      at,
      tmuxServerPid: next.tmuxServerPid,
      key: sessionKey(identityOf(row)),
      identity: identityOf(row),
      from,
      to,
      status: row.status,
    });
  }

  return events;
}

function seen(row: ObservedRow, at: string, tmuxServerPid: number | null): OverseerEvent {
  return {
    kind: "session-seen",
    at,
    tmuxServerPid,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    row,
  };
}

function gone(row: ObservedRow, at: string, tmuxServerPid: number | null, why: GoneReason): OverseerEvent {
  return {
    kind: "tmux-session-gone",
    at,
    tmuxServerPid,
    key: sessionKey(identityOf(row)),
    identity: identityOf(row),
    name: row.name,
    why,
  };
}
