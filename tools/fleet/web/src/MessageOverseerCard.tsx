/**
 * **A LINE TO THE OVERSEER**, on the tab that is about it.
 *
 * > there should be a way to send messages directly to the Overseer in the
 * > Overseer tab, and also to broadcast to all agents
 * >
 * > — Greg, 2026-09-08
 *
 * ## The card this replaced was right about one thing and wrong about the other
 *
 * Until 2026-09-09 this tab carried a card headed *"There is still nothing here
 * to send a message to."* It was **right about the daemon**: `tools/overseer/`
 * writes a checkpoint and reads no inbox, and a textarea over that would have
 * been a page quietly swallowing instructions into nothing.
 *
 * It was **wrong about the session**. The Overseer is a Claude agent in a tmux
 * pane like the forty others, and a pane takes keystrokes through the same
 * steer path everything else on this dashboard uses. Nothing new was needed to
 * reach it — only the addressing.
 *
 * Both halves survive in the copy below, deliberately. A card that blurred them
 * would teach somebody that the daemon has an inbox.
 *
 * ## The addressing is the whole of this file
 *
 * Everywhere else on this dashboard you tap a row, so you know who you are
 * speaking to. Here you do not: the person on this tab knows *the Overseer* and
 * not which of forty sessions currently holds that claim. So the card resolves
 * it — and **three of the four answers are refusals**, because getting this
 * wrong means a line of direction arriving at a session that is not supervising
 * anything.
 *
 *  - `one` — draw the box.
 *  - `none` — nobody holds it. That is what the box looks like after a reboot,
 *    since the claim lives in the tmux server's memory and dies with it. A real
 *    state, said out loud, never a blank.
 *  - `contested` — two claimants. **Never pick one.** Choosing between them is
 *    exactly how both go on believing they are the Overseer.
 *  - `cannot-tell` — the rows could not be read. Not the same as `none`, and
 *    collapsing the two is how *I could not look* becomes a confident
 *    *there is nobody*.
 *
 * ## THE ADDRESS IS VERIFIED AT SEND TIME. THE ROLE IS NOT.
 *
 * This comment said, until GPT Sol read it, that a stale row here *"cannot
 * deliver to the wrong session — it can only produce a refusal"*, on the
 * grounds that `steer.ts` re-checks pane, session, Claude uuid and pane pid
 * against live tmux immediately before sending. **That is a verification of the
 * ADDRESS, not of the ROLE**, and `verifyTarget` never reads the role. The path
 * it misses:
 *
 *   1. the snapshot says session A holds the claim;
 *   2. A releases it, or B takes it, without A's Claude restarting;
 *   3. this page has not collected since;
 *   4. A still has the same pane, session, pid and uuid, and an empty input;
 *   5. every check passes and the words go to A, which is no longer the
 *      Overseer.
 *
 * So it is stated rather than claimed away. What the address check rules out is
 * *right words, wrong pane*; what nothing here rules out is *right pane, wrong
 * occupant of a role*. Two things narrow it and neither closes it: the claim is
 * recomputed from live props on every render, so the row is the freshest the
 * page has at the moment of the click rather than one from when the panel
 * mounted; and the card names the session it is about to speak to, above the
 * box and again in the receipt. The remaining harm is a line of direction
 * reaching an agent that has stopped supervising — not a keystroke in a
 * stranger's pane.
 *
 * **THE WINDOW IS NOT "ONE COLLECTION INTERVAL", which is what this said
 * first.** `useFleetState` deliberately keeps its last good state when a
 * refresh fails, so the displayed rows can be arbitrarily old while the header
 * shows STALE — and this card would go on offering a Send against them. The
 * honest bound is **as old as the snapshot on screen**, and that is what the
 * tooltip says.
 *
 * **The fix, if it ever matters, is a route that re-reads the live claim off
 * tmux and then delegates to `sendMessage`** — another caller, not another
 * transport. Out of scope for a text box; written down so it is a decision
 * rather than an omission.
 *
 * ## The one completeness clause this card does apply
 *
 * `Header.tsx` resolves the same claim through `ReadingCompleteness`, because
 * the header **reports** who the Overseer is. `overseerClaim(rows)` here
 * defaults to `COMPLETE`, so a payload that dropped rows could hide a second
 * claimant and this card would happily send to the one it could see. Nothing
 * downstream catches that — it is not staleness, and the address check has no
 * opinion about it — so `unreadableRows` comes off the snapshot and a non-zero
 * count refuses.
 *
 * That is **one clause of the header's rule, not a copy of it**: the staleness
 * clause is already carried by the page-wide STALE banner and by the send-time
 * address check, and this clause is carried by nothing else. Threading the
 * whole `ReadingCompleteness` through would be better and needs an export from
 * a file this session does not own. docs/plans/260909b-… § D2.
 *
 * ## The unsent line is kept under the Overseer's conversation
 *
 * A half-written line survives the reload iOS forces (drafts.ts), keyed by
 * **the conversation of the row the claim resolves to** — never the pane, and
 * never the role. Of the three boxes that keep drafts this is the strongest
 * case, because the Overseer is the session relaunched most often: a line begun
 * to one Overseer is the likeliest draft on the page to meet another. So it
 * comes back only when that same conversation is verified in front of it.
 * docs/plans/260910c-… § Stage 2.
 */
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import { useExecutionEpoch } from "./continuity";
import {
  DRAFT_RECIPIENT_CHANGED_SENTENCE,
  draftAddressOf,
  draftNoticeSentence,
  useDraft,
  type DraftAddress,
  type DraftSubmission,
} from "./drafts";
import { EnvelopeNoticeCard } from "./ReceiptList";
import type { EnvelopeNotice, RequestEnvelope } from "./request-envelope";
import {
  httpSteerApi,
  messageEnvelope,
  sendMessageEnvelope,
  sentTarget,
  type SentTarget,
  type SteerApi,
  type SteerMessageBody,
  type SteerOutcome,
} from "./steer-client";
import { SteerReceipt } from "./SteerReceipt";
import { Explain } from "./Tooltip";
import { overseerClaim, type FleetRow, type OverseerClaim } from "./types";
import { Button, Card, Mono } from "./ui";

/**
 * Who to speak to, or why there is nobody to speak to — one value, so a
 * renderer cannot draw an input box next to a reason it should not.
 *
 * A discriminated union rather than `{row, why}` with one of them null: the
 * whole point is that the two states are mutually exclusive, and the compiler
 * should be the thing that knows it.
 */
type Addressee =
  | { kind: "found"; row: FleetRow }
  | { kind: "nobody"; why: string; detail: string };

/**
 * **A SEND THAT HAS NOT HEARD A DEFINITE ANSWER** — request-envelope.ts. Held
 * only after `not-confirmed`, for Check, which resends this envelope with the
 * ticket it was built with. The row travels with it, so a Check after the
 * claim has moved still goes to the session the words were sent to — it is the
 * same request, not a new one.
 *
 * **Memory-only.** A reload keeps the words (drafts.ts) and loses this, so the
 * next Send is a new request with a new id and a new ticket. 260910c's F31 is
 * the same limit for a card unmounted while a request is open.
 */
type PendingMessage = { envelope: RequestEnvelope<SteerMessageBody, DraftSubmission>; row: FleetRow; target: SentTarget };

/**
 * The claim, plus the one local check the claim cannot make.
 *
 * **`unaddressable` is not a second opinion about the claim.** It is a fact
 * about the payload on screen: a row with no pane handle carries no address for
 * a keystroke, and a row with no Claude session id gives the server nothing to
 * tell this conversation from whatever is in that pane now. The server refuses
 * both, so saying it here costs nothing and saves a round trip — and, unlike
 * everything else this card could be tempted to decide, it is checkable from
 * the row itself.
 */
function addressee(claim: OverseerClaim, rows: readonly FleetRow[], unreadableRows: number | null): Addressee {
  /* **CHECKED BEFORE THE CLAIM, because it is a reason to disbelieve the
     claim.** A row this payload could not read is as likely as any to be the
     one holding the claim, or to be a second claimant — and `overseerClaim`
     cannot know, since it was handed only the rows that survived. See the
     header for why this one clause is here and the rest of the header's rule is
     not.

     `null` — no collection has finished — refuses too, and is a DIFFERENT
     sentence: *nothing has been read* is not *nothing was dropped*. */
  if (unreadableRows === null) {
    return {
      kind: "nobody",
      why: "No collection has finished yet.",
      detail:
        "Nothing has been read off the box, so there is no list of sessions to find the Overseer in. This is what the page looks like for the first few seconds after it loads, and it comes right on its own.",
    };
  }
  if (unreadableRows > 0) {
    return {
      kind: "nobody",
      why: `${unreadableRows} session row(s) in this payload could not be read.`,
      detail:
        "So the claim cannot be settled from it: a row nobody could read is as likely as any to be the Overseer's, or a second claimant's. Nothing is sent until the next collection comes back whole.",
    };
  }
  switch (claim.kind) {
    case "none":
      return {
        kind: "nobody",
        why: "There is no Overseer session.",
        detail:
          "No session on this box holds the claim. That is a real state rather than a gap: the claim lives in the tmux server's memory and dies with it, so this is what the box looks like after a reboot. Start one, or hand it the claim, and this box comes back.",
      };
    case "contested":
      return {
        kind: "nobody",
        why: `${claim.names.length} sessions claim to be the Overseer: ${claim.names.join(", ")}.`,
        detail:
          "Nothing is sent while that is true, and this card will not choose between them — picking one claimant is how two sessions both go on believing they are the Overseer. Settle it first; the Sessions tab can reach either of them by name.",
      };
    case "cannot-tell":
      return {
        kind: "nobody",
        why: `The Overseer cannot be identified — ${claim.why}.`,
        detail:
          claim.holder === undefined
            ? "That is not the same as there being none. Something in this payload could not be read, so the claim cannot be resolved from it."
            : `${claim.holder.name} was holding it. What is in doubt is not who had the claim but whether anybody else also claims it now, and a message sent off a reading this page has just called unreliable is exactly the wrong risk to take.`,
      };
    case "one": {
      const row = rows.find((r) => r.id === claim.id);
      if (row === undefined) {
        /* Unreachable: the claim was computed from these same rows. Written out
           rather than asserted away, because the readable failure for an
           unreachable case is a refusal, not a send at whatever `find` returned. */
        return {
          kind: "nobody",
          why: `The claim names ${claim.name}, and no row in this payload has that id.`,
          detail: "That should be impossible — the claim is computed from these rows. Refresh, and say so if it persists.",
        };
      }
      if (row.paneId === null) {
        return {
          kind: "nobody",
          why: `${row.name} holds the claim, and this row has no tmux pane handle.`,
          detail: "The pane handle is the address a keystroke needs. Without it there is nowhere for the words to go.",
        };
      }
      if (row.claudeSessionId === null) {
        return {
          kind: "nobody",
          why: `${row.name} holds the claim, and this row has no Claude session id.`,
          detail:
            "That id is what tells this conversation from whatever is in that pane now, and the server refuses a send without it.",
        };
      }
      return { kind: "found", row };
    }
    default: {
      const never: never = claim;
      return { kind: "nobody", why: JSON.stringify(never), detail: "" };
    }
  }
}

/**
 * Where this card's draft may be kept: the resolved Overseer row's
 * conversation, by the same mapping the session composer uses — with one
 * difference, stated rather than hidden.
 *
 * **Under `conflicting` this card restores nothing.** The session composer
 * puts the claimed conversation's draft back because its Send is disabled in
 * that state; this card's Send is not, so restoring would put a draft written
 * for one conversation in front of a live button aimed at a pane running
 * another. The draft stays in storage under its own key and comes back when
 * that conversation does.
 */
function overseerDraftAddress(row: FleetRow | null): DraftAddress {
  if (row === null) return { kind: "cannot-tell" };
  const address = draftAddressOf(row.execution);
  return address.kind === "hold" ? { kind: "hold", restoreFrom: null } : address;
}

export function MessageOverseerCard({
  rows,
  unreadableRows,
  steer = httpSteerApi,
}: {
  rows: readonly FleetRow[];
  /**
   * How many rows in this payload the page could not read. See `addressee` and
   * the header: a dropped row can hide a second claimant, and this card refuses
   * rather than sending off a list it knows is short.
   */
  unreadableRows: number | null;
  /** The seam. A test drives this card without a network; the browser gets the default. */
  steer?: SteerApi;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  /**
   * **The outcome and the target it was made against, as one value.**
   *
   * The rows underneath are replaced at every collection while this card stays
   * on screen, so keeping only the outcome and comparing it with whatever the
   * Overseer row is by then answers a different question from the one that was
   * asked. Same reasoning as `SessionDetail.tsx`'s, and the same bug if it is
   * not done.
   */
  const [outcome, setOutcome] = useState<{ result: SteerOutcome; target: SentTarget } | null>(null);

  const to = addressee(overseerClaim(rows), rows, unreadableRows);

  /* **THE DRAFT'S SCOPE IS THE OVERSEER'S ROW AND PROCESS.** This card is not
     remounted when the claim moves to another row or the Overseer is
     relaunched, unlike the session composer, so it tells the hook itself:
     `useExecutionEpoch`'s key changes exactly then. Words begun for one
     Overseer stay on screen when another appears, and are never filed under
     the new one's conversation. `null` while nobody can be spoken to — an
     unreadable collection is weather, not a new recipient. */
  const holder = to.kind === "found" ? to.row : null;
  const epoch = useExecutionEpoch(holder);
  const draft = useDraft({
    purpose: "overseer-message",
    address: overseerDraftAddress(holder),
    scope: holder === null ? null : epoch,
    /* One card owns this slot for the life of the page. It gives unverifiable
       typing a page-only identity until a conversation can safely file it. */
    pageSlot: "overseer",
  });
  const text = draft.text;

  const [pending, setPending] = useState<PendingMessage | null>(null);
  /** What the card shows for a keyed answer that is not the route's own. */
  const [notice, setNotice] = useState<EnvelopeNotice | null>(null);

  /**
   * One keyed send, first or Check, and what each answer does — the seam
   * agreed with `session-continuity` (plan 260910d § Stage 4). Only a
   * definitive success accepts, and always with the ticket in the envelope,
   * taken at Send: a ticket taken now would clear whatever was typed since.
   */
  const deliver = useCallback(
    async (sent: PendingMessage): Promise<void> => {
      setBusy(true);
      const result = await sendMessageEnvelope(steer, sent.row, sent.envelope);
      switch (result.kind) {
        case "answered":
          setOutcome({ result: result.outcome, target: sent.target });
          setNotice(null);
          setPending(null);
          /* Only a send the server accepted takes the draft with it. A refusal
             leaves both the box and the stored copy, so the words are there to
             try again or to take elsewhere. */
          if (result.outcome.ok) draft.accept(sent.envelope.ticket);
          break;
        case "replay":
          setOutcome(null);
          setNotice(result);
          setPending(null);
          draft.accept(sent.envelope.ticket);
          break;
        case "not-confirmed":
          /* NEVER ACCEPTED: the words stay in the box and in storage, and the
             envelope stays for Check. */
          setOutcome(null);
          setNotice(result);
          setPending(sent);
          break;
        case "request-id-conflict":
        case "request-id-expired":
        case "receipt-unavailable":
          setOutcome(null);
          setNotice(result);
          setPending(null);
          break;
        default: {
          const never: never = result;
          void never;
        }
      }
      setBusy(false);
    },
    [draft, steer],
  );

  const onSend = useCallback(async () => {
    if (to.kind !== "found" || !draft.canSubmit || pending !== null) return;
    const submission = draft.submission();
    if (submission === null) return;
    const words = submission.text.trim();
    /* **Checked here, not only on the button's `disabled`.** `disabled` stops a
       pointer; it does not stop a keyboard path somebody adds later, and an
       empty line typed at an agent is a turn of a paid model spent on nothing. */
    if (words === "") return;
    /* Snapshotted BEFORE the await. Reading the row after it would read the
       render that resolved the promise, which is the bug `SentTarget` exists
       for. The ticket is taken here too, and travels in the envelope. */
    await deliver({ envelope: messageEnvelope(to.row, words, submission), row: to.row, target: sentTarget(to.row) });
  }, [deliver, draft, pending, to]);

  /** The same envelope again: the same id, the same bytes, the original ticket. */
  const onCheck = useCallback(() => {
    if (pending !== null) void deliver(pending);
  }, [deliver, pending]);

  return (
    <Card className="tw:mt-3 tw:p-4">
      <h2 className="tw:font-medium">Message the Overseer</h2>
      {/* **THE DAEMON IS NOT THE RECIPIENT**, and this sentence is the whole
          reason the card it replaced existed. The checkpoint-writing daemon
          reads no inbox; the Overseer's Claude session is an agent in a pane,
          and that is what these keystrokes reach. */}
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        This types the line at the Overseer session's pane, the same way the Sessions tab does. It does not reach the
        daemon — that publishes a checkpoint and reads nothing — so what you say here is read by the agent, on its next
        turn, and costs it that turn.
      </p>

      {to.kind === "nobody" ? (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">{to.why}</p>
          <p className="tw:mt-1 tw:text-ink">{to.detail}</p>
        </div>
      ) : (
        <>
          <p className="tw:mt-3 tw:text-[13px] tw:text-ink-soft">
            <Explain
              /* **THIS TOOLTIP SAID THE THING THE HEADER HAD JUST STOPPED
                 SAYING**, and it survived an hour into the branch: *"a row that
                 has gone stale produces a refusal here rather than a message at
                 the wrong session"*, which is exactly false when only the role
                 has moved. GPT Sol found it in the built code after finding the
                 same claim in the plan. A comment fixed and a tooltip left
                 behind is the copy half of the defect this whole area is about
                 — four surfaces read the same fact and only one of them was
                 corrected. */
              tip={{
                head: "Who holds the claim",
                what: "The one session whose row says it is the Overseer, as old as the snapshot on screen — which is older than a minute whenever the page is showing STALE.",
                how: "The ADDRESS is checked against live tmux just before the keys go out, so this cannot type into a stranger's pane. The ROLE is not checked: if this session has handed the claim on since the snapshot, the words still reach it. Look at the header's Overseer line if that would matter.",
              }}
            >
              To <span className="tw:font-medium tw:text-ink">{to.row.name}</span>
            </Explain>{" "}
            <Mono>{to.row.paneId}</Mono> <Mono>{to.row.id}</Mono>
          </p>
          <textarea
            className="tw:mt-2 tw:w-full tw:rounded-md tw:border tw:border-rule tw:bg-page tw:p-2 tw:text-[13px] tw:text-ink"
            rows={2}
            value={text}
            placeholder="one line to the Overseer"
            onChange={(e) => draft.setText(e.target.value)}
            aria-label="Message the Overseer"
          />
          <p className="tw:mt-2 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
            <Button
              variant="loud"
              disabled={busy || text.trim() === "" || !draft.canSubmit || pending !== null}
              onClick={() => void onSend()}
            >
              {busy ? "Sending…" : "Send"}
            </Button>
            <Button disabled={busy || text === ""} onClick={draft.clear}>
              Clear
            </Button>
          </p>
          {draft.notice === null ? null : (
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">{draftNoticeSentence(draft.notice)}</p>
          )}
          {draft.canSubmit ? null : (
            <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">Send is off: {DRAFT_RECIPIENT_CHANGED_SENTENCE}</p>
          )}
          {pending === null ? null : (
            <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">
              Send is off until you Check the last one — it may already have arrived.
            </p>
          )}
        </>
      )}

      {outcome === null ? null : <SteerReceipt outcome={outcome.result} target={outcome.target} />}
      {notice === null ? null : <EnvelopeNoticeCard notice={notice} busy={busy} onCheck={onCheck} />}
    </Card>
  );
}
