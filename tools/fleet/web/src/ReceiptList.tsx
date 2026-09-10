/**
 * **WHAT THE DASHBOARD DID, RECEIPT BY RECEIPT — WHAT IS PROVEN, AND WHAT IS
 * NOT** — plan 260910d, Stage 4.
 *
 * A person on a phone should be able to see, for recent actions, which were
 * proven, which were withdrawn, which are unknown, and which unknowns somebody
 * has since looked at. The list reads `GET /api/actions/receipts` and draws
 * each receipt **in words built from its fields, never one label**: accepted
 * at, attempted at, what the outcome was and why, how many steps of a plan are
 * known to have finished, who reconciled it. A receipt that says
 * `keys-submitted` is drawn as *keys submitted* — never "delivered" or "read",
 * which nothing on this box can establish.
 *
 * Two things are drawn loudly because they change what you would do next: a
 * journal that is **not durable** (a restart forgets what is listed here), and
 * the sessions with **an unknown outcome and no hold** (nothing stops a second
 * send to them — the hold ledger's fail-open, plan § Restoring).
 *
 * ## Where it lives, and why there
 *
 * On the Overseer tab, beside the two cards that make keyed writes. **Not in
 * the Sessions detail pane**, which remounts on a change of execution identity
 * (`useDetailTargetKey`), and not in Box Health or Usage Limits — agreed with
 * `session-continuity`, 2026-09-10. It is self-contained: it polls through
 * `singleFlightReader` (one read in flight, a deadline, abort on unmount, the
 * last good answer kept when a read fails).
 *
 * ## The reconciliation gesture
 *
 * An enacted plan (a worktree removal, a kill) whose outcome is unknown offers
 * two statements: *I checked the box* and *leave it unknown*. Either is
 * recorded as a person's statement beside the unknown — `client-claimed`, since
 * the dashboard has no authentication — and **never changes the outcome**.
 *
 * This file also holds `EnvelopeNoticeCard`, the card the three composers draw
 * for a keyed write that did not get an ordinary answer (request-envelope.ts):
 * it describes a replayed receipt with the same words the list uses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { ReceiptSummary } from "../../wire.js";
import {
  httpReceiptsApi,
  type OperatorDisposition,
  type ReceiptsApi,
  type ReceiptsFeed,
  type ReceiptsReading,
} from "./actions-client";
import { NOT_CONFIRMED_SENTENCE, type EnvelopeNotice } from "./request-envelope";
import { singleFlightReader, type SingleFlightReader } from "./single-flight-reader";
import { Button, Card, Mono, cx } from "./ui";
import { formatDuration } from "./view";

/** How often the list reads. Receipts change when somebody acts; this is not a live feed. */
export const RECEIPTS_POLL_MS = 15_000;
/** How long one read may take before the page stops waiting for it. */
export const RECEIPTS_DEADLINE_MS = 10_000;

/* ------------------------------------------------------------------ *
 * The words.
 * ------------------------------------------------------------------ */

const OP_WORDS: Record<ReceiptSummary["op"], string> = {
  "queued-message": "A queued message",
  "queued-action": "A queued action",
  "steer-message": "A message typed at a session",
  "steer-answer": "An answer to a dialog",
  "enacted-session": "A plan run on one session",
  "broadcast-recipient": "One recipient of a broadcast",
  "enacted-box": "A box-wide plan",
  broadcast: "A broadcast",
};

/**
 * The receipt journal's reason codes, in words. An unknown code is drawn as
 * itself: a newer server's reason is still a fact, and dropping it would hide
 * the receipt most worth reading.
 */
const REASON_WORDS: Record<string, string> = {
  "transport-ok": "every send-keys call completed",
  "transport-refused-unsent": "the transport refused before typing anything",
  "session-held": "that session is held after an earlier send nobody could account for",
  undeliverable: "it could never have been delivered",
  "lost-at-restart": "its words were lost at a restart",
  "tmux-generation-changed": "the tmux server changed, so the pane it was for is gone",
  "tmux-generation-unproven": "the tmux server could not be proven the same after a restart",
  "attempt-not-recorded": "the attempt could not be written down first, so nothing was typed",
  "interrupted-before-attempt": "the dashboard stopped before attempting it",
  "not-reached": "the broadcast's deadline passed before this recipient",
  "refused-before-attempt": "a check that can only run after acceptance refused it",
  partial: "part of it was typed",
  unknown: "the transport could not say what reached the pane",
  "none-contradicted": "the transport said nothing went, and the evidence disagrees",
  threw: "it threw before it could say",
  interrupted: "the dashboard stopped while it was being attempted",
  "lease-abandoned": "a delivery lease was abandoned",
  "recovery-blocked": "an unreadable journal line could hide what happened",
  cancelled: "somebody cancelled it",
  cleared: "somebody cleared the queue",
  "plan-passed": "every step passed its gate",
  "fan-out-finished": "the fan-out came to an end — each recipient's own receipt says what became of it",
  "gate-refused": "a step's gate said no",
};

function because(reason: string | null): string {
  if (reason === null) return "";
  return ` — ${REASON_WORDS[reason] ?? reason} (${reason})`;
}

const DISPOSITION_WORDS: Record<NonNullable<ReceiptSummary["reconciliation"]>["disposition"], string> = {
  "operator-confirmed": "they checked the box",
  "abandoned-unknown": "they stopped trying to find out",
  "lease-abandoned": "the delivery lease was abandoned",
};

const ACTOR_WORDS: Record<ReceiptSummary["actor"]["kind"], string> = {
  "client-claimed": "as the page claimed",
  "unattributed-http": "nobody named",
  system: "the dashboard itself",
};

function ago(at: number, now: number): string {
  return `${formatDuration(Math.max(0, now - at))} ago`;
}

/**
 * **THE RECEIPT, AS SENTENCES BUILT FROM ITS FIELDS.** Exported so a composer
 * describing a replay says exactly what the list says about the same receipt.
 */
export function receiptSentences(r: ReceiptSummary, now: number): string[] {
  const lines: string[] = [`accepted ${ago(r.acceptedAt, now)}`];
  lines.push(r.attemptedAt === null ? "not attempted" : `attempted ${ago(r.attemptedAt, now)}`);
  switch (r.state) {
    case "accepted":
      lines.push("not yet attempted");
      break;
    case "attempted":
      lines.push("being attempted — no outcome recorded yet");
      break;
    case "returned":
      lines.push(`returned to the queue, nothing typed${because(r.reason)}`);
      break;
    case "withdrawn":
      lines.push(`withdrawn before it was attempted, so proven not sent${because(r.reason)}`);
      break;
    case "keys-submitted":
      lines.push("keys submitted — every send-keys call completed; that is not a claim that anyone has seen it");
      break;
    case "not-sent":
      lines.push(`not sent${because(r.reason)}`);
      break;
    case "outcome-unknown":
      lines.push(`outcome unknown${because(r.reason)}`);
      break;
    case "completed":
      lines.push(`completed${because(r.reason)}`);
      break;
    case "plan-stopped":
      lines.push(`plan stopped${because(r.reason)}`);
      break;
    default: {
      const never: never = r.state;
      lines.push(String(never));
    }
  }
  if (r.stepsCompleted !== null) {
    lines.push(`${r.stepsCompleted} step${r.stepsCompleted === 1 ? "" : "s"} known to have completed`);
  }
  if (r.queueItemId !== null) lines.push(`queue item ${r.queueItemId}`);
  if (r.parentReceiptId !== null) lines.push(`one recipient of broadcast ${r.parentReceiptId}`);
  if (r.reconciliation !== null) {
    const who = r.reconciliation.actor.id ?? ACTOR_WORDS[r.reconciliation.actor.kind];
    lines.push(
      `reconciled by ${who} (${ACTOR_WORDS[r.reconciliation.actor.kind]}) ${ago(r.reconciliation.at, now)}: ` +
        `${DISPOSITION_WORDS[r.reconciliation.disposition]} — a statement, not proof`,
    );
  }
  if (r.materialDeletionPending) lines.push("its words are still on disk: their deletion is pending");
  return lines;
}

function canReconcile(r: ReceiptSummary): boolean {
  return r.state === "outcome-unknown" && (r.op === "enacted-session" || r.op === "enacted-box") && r.reconciliation === null;
}

/* ------------------------------------------------------------------ *
 * The card a composer draws for a keyed write with no ordinary answer.
 * ------------------------------------------------------------------ */

/**
 * `not-confirmed` offers **Check**, which resends the same envelope; the other
 * three arms are definitive and offer nothing. `onCheck` is the composer's,
 * because only it holds the envelope.
 */
export function EnvelopeNoticeCard({
  notice,
  busy,
  onCheck,
  now = Date.now,
}: {
  notice: EnvelopeNotice;
  busy: boolean;
  onCheck: () => void;
  now?: () => number;
}): ReactNode {
  switch (notice.kind) {
    case "not-confirmed":
      return (
        <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">{NOT_CONFIRMED_SENTENCE}</p>
          <p className="tw:mt-1 tw:break-words tw:text-ink">{notice.why}</p>
          <p className="tw:mt-1 tw:text-ink">
            Check asks it again with the same request id and the same words, so it cannot be done twice — the answer
            says what became of the first. Nothing new can be sent from here until you have.
          </p>
          <p className="tw:mt-2">
            <Button variant="loud" disabled={busy} onClick={onCheck}>
              Check
            </Button>
          </p>
        </div>
      );
    case "replay": {
      const at = now();
      const children = notice.children;
      return (
        <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-work-ink">
            Confirmed: the dashboard already had this request, so nothing was done a second time.
          </p>
          <p className="tw:mt-1 tw:text-ink">What became of the first: {receiptSentences(notice.receipt, at).join(" · ")}.</p>
          {children === null ? null : (
            <p className="tw:mt-1 tw:text-ink-soft">
              {children.length} recipient{children.length === 1 ? "'s" : "s'"} own receipt{children.length === 1 ? "" : "s"}:{" "}
              {countStates(children)}. The Overseer tab's receipt list has each one.
            </p>
          )}
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
            Receipt <Mono>{notice.receipt.receiptId}</Mono>
          </p>
        </div>
      );
    }
    case "request-id-conflict":
    case "request-id-expired":
    case "receipt-unavailable":
      return (
        <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">
            {notice.kind === "receipt-unavailable"
              ? "Nothing was done: the dashboard could not write a receipt for it first."
              : "Nothing was done."}
          </p>
          {/* Verbatim. Every word of this is the server's. */}
          <p className="tw:mt-1 tw:break-words tw:text-ink">{notice.why}</p>
          <p className="tw:mt-1 tw:text-ink-soft">
            The words are still in the box. Sending them again is a new request with a new id.
          </p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
            <Mono>{notice.kind}</Mono>
            <span className="tw:px-1">·</span>
            <Mono>{`HTTP ${notice.status}`}</Mono>
            <span className="tw:px-1">·</span>
            said by the dashboard server
          </p>
        </div>
      );
    default: {
      const never: never = notice;
      return <p>{JSON.stringify(never)}</p>;
    }
  }
}

function countStates(receipts: readonly ReceiptSummary[]): string {
  const counts = new Map<string, number>();
  for (const r of receipts) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
  return [...counts].map(([state, n]) => `${n} ${state}`).join(", ");
}

/* ------------------------------------------------------------------ *
 * The list.
 * ------------------------------------------------------------------ */

function JournalStatus({ feed }: { feed: ReceiptsFeed }): ReactNode {
  const s = feed.status;
  const lines: ReactNode[] = [];
  if (!feed.durable) {
    lines.push(
      <div key="durable" className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-alarm-ink">
          Receipts are not being kept on disk, so a dashboard restart forgets what is listed here.
        </p>
        <p className="tw:mt-1 tw:break-words tw:text-ink">
          {s.lockedOutBy !== null
            ? `Another dashboard holds the writer lock (${s.lockedOutBy}).`
            : s.neverOpened
              ? "The receipt journal was never opened: this run keeps receipts in memory only."
              : s.failure !== null
                ? `The last write failed: ${s.failure}.`
                : "The server did not say why."}
        </p>
      </div>,
    );
  }
  if (feed.recovery.blocked) {
    lines.push(
      <p key="recovery" className="tw:mt-2 tw:text-[13px] tw:font-medium tw:text-alarm-ink">
        Recovery at startup was blocked{feed.recovery.reason === null ? "" : `: ${feed.recovery.reason}`}. Queued work
        was concluded rather than restored.
      </p>,
    );
  }
  if (s.unreadableLines > 0) {
    lines.push(
      <p key="unreadable" className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">
        {s.unreadableLines} unreadable line{s.unreadableLines === 1 ? "" : "s"} in the journal, kept aside as evidence.
      </p>,
    );
  }
  return <>{lines}</>;
}

function UnknownWithoutHold({ rows }: { rows: ReceiptsFeed["unknownWithoutHold"] }): ReactNode {
  if (rows.length === 0) return null;
  return (
    <div
      data-unknown-without-hold
      className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]"
    >
      <p className="tw:font-medium tw:text-alarm-ink">
        An outcome is unknown and there is no hold, so nothing stops a second send to these sessions.
      </p>
      <ul className="tw:mt-1">
        {rows.map((row) => (
          <li key={row.sessionId} className="tw:text-ink">
            <Mono>{row.sessionId}</Mono> — {row.receiptIds.length} receipt{row.receiptIds.length === 1 ? "" : "s"} with
            an unknown outcome and no hold
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptItem({
  r,
  now,
  busy,
  refusal,
  onReconcile,
}: {
  r: ReceiptSummary;
  now: number;
  busy: boolean;
  refusal: string | null;
  onReconcile: (receiptId: string, disposition: OperatorDisposition) => void;
}): ReactNode {
  const unknown = r.state === "outcome-unknown";
  return (
    <li data-receipt={r.receiptId} className="tw:border-t tw:border-rule tw:py-2 tw:text-[13px]">
      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
        <span className={cx("tw:font-medium", unknown ? "tw:text-alarm-ink" : "tw:text-ink")}>{OP_WORDS[r.op]}</span>
        <span className="tw:text-ink-soft">{r.what}</span>
        {r.target === null ? null : <Mono>{r.target.sessionId}</Mono>}
      </p>
      <p className="tw:mt-0.5 tw:break-words tw:text-ink-soft">{receiptSentences(r, now).join(" · ")}</p>
      {canReconcile(r) ? (
        <div className="tw:mt-1">
          <p className="tw:text-[12px] tw:text-ink-faint">
            Nothing here can tell what this did. Record what you did about it — your statement goes beside the unknown,
            never in place of it.
          </p>
          <p className="tw:mt-1 tw:flex tw:flex-wrap tw:gap-2">
            <Button data-disposition="operator-confirmed" disabled={busy} onClick={() => onReconcile(r.receiptId, "operator-confirmed")}>
              I checked the box
            </Button>
            <Button data-disposition="abandoned-unknown" disabled={busy} onClick={() => onReconcile(r.receiptId, "abandoned-unknown")}>
              Leave it unknown
            </Button>
          </p>
        </div>
      ) : null}
      {refusal === null ? null : <p className="tw:mt-1 tw:break-words tw:text-alarm-ink">{refusal}</p>}
    </li>
  );
}

export function ReceiptList({
  api = httpReceiptsApi,
  pollMs = RECEIPTS_POLL_MS,
  deadlineMs = RECEIPTS_DEADLINE_MS,
  now = Date.now,
}: {
  /** The seam. A test drives the list without a network; the browser gets the default. */
  api?: ReceiptsApi;
  pollMs?: number;
  deadlineMs?: number;
  /** The clock the ages are drawn against. */
  now?: () => number;
}): ReactNode {
  const [feed, setFeed] = useState<ReceiptsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ receiptId: string; why: string } | null>(null);
  const reader = useRef<SingleFlightReader | null>(null);

  useEffect(() => {
    const r = singleFlightReader<ReceiptsReading>({
      read: (signal) => api.read(signal),
      deadlineMs,
      noAnswer: (why) => ({ ok: false, why }),
      /* THE LAST GOOD LIST STAYS. A failed read says so beside it rather than
         emptying it: an empty list reads as *nothing happened*. */
      onSettle: (reading) => {
        if (reading.ok) {
          setFeed(reading.feed);
          setError(null);
        } else {
          setError(reading.why);
        }
      },
    });
    reader.current = r;
    r.request();
    const timer = setInterval(() => r.request(), pollMs);
    return () => {
      clearInterval(timer);
      r.stop();
      reader.current = null;
    };
  }, [api, pollMs, deadlineMs]);

  const onReconcile = useCallback(
    async (receiptId: string, disposition: OperatorDisposition): Promise<void> => {
      setBusy(receiptId);
      /* Idempotent for the same statement, so a lost response is recovered by
         pressing again — no envelope needed here. */
      const outcome = await api.reconcile(receiptId, disposition);
      setRefusal(outcome.ok ? null : { receiptId, why: outcome.why });
      setBusy(null);
      reader.current?.request();
    },
    [api],
  );

  const at = now();
  return (
    <Card className="tw:mt-3 tw:p-4">
      <h2 className="tw:font-medium">What the dashboard did, and what is known of it</h2>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        One line per action it accepted — typed, queued, broadcast or run. <em>Keys submitted</em> means the keystrokes
        went, not that an agent has seen them; <em>outcome unknown</em> means nothing here can tell.
      </p>
      {feed === null ? null : <JournalStatus feed={feed} />}
      {feed === null ? null : <UnknownWithoutHold rows={feed.unknownWithoutHold} />}
      {error === null ? null : (
        <p className="tw:mt-2 tw:break-words tw:text-[13px] tw:text-alarm-ink">
          The last read failed: {error}.{feed === null ? "" : " What is below is the last list that came back."}
        </p>
      )}
      {feed === null ? (
        error === null ? (
          <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">Asking the dashboard for its receipts…</p>
        ) : null
      ) : feed.receipts.length === 0 ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">It has accepted nothing in the receipts it keeps.</p>
      ) : (
        <ul className="tw:mt-2">
          {feed.receipts.map((r) => (
            <ReceiptItem
              key={r.receiptId}
              r={r}
              now={at}
              busy={busy !== null}
              refusal={refusal !== null && refusal.receiptId === r.receiptId ? refusal.why : null}
              onReconcile={(id, d) => void onReconcile(id, d)}
            />
          ))}
        </ul>
      )}
      {feed !== null && feed.unreadable > 0 ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">
          {feed.unreadable} receipt{feed.unreadable === 1 ? "" : "s"} this build could not read, and so did not draw.
        </p>
      ) : null}
    </Card>
  );
}
