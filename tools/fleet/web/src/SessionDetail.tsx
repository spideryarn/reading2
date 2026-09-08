/**
 * One session, at length — and the only place on this page that acts.
 *
 * Greg, 2026-09-08: *"if I click on a session, show much more information about
 * it in the right column, e.g. input it requires from me, the recent messages,
 * and anything else that might be useful. Allow me to send steering messages to
 * it, answer its questions, etc"*.
 *
 * ## Six sections, in the order the question is usually asked
 *
 *  1. **What it needs from you**, which is the reason the page exists, so it is
 *     first and it is the only thing here drawn in the loud colour.
 *  2. **Do something to it** — the vocabulary as buttons (ActionButtons.tsx),
 *     with the two classes of action kept apart: a sentence the agent may
 *     ignore, and a command that runs whether or not it cooperates.
 *  3. **Say something to it** — a message, typed at the pane now, or queued to
 *     go in order with everything else pressed.
 *  4. **Waiting to go to it** — the queue, because a queue you cannot see
 *     surprises you an hour later in somebody else's conversation.
 *  5. **Recent messages** — the tail of the session's own transcript, drawn for
 *     every row whatever its status (RecentMessages.tsx). See below.
 *  6. **Where it is**, the identifiers and the directory, last because they are
 *     what you read when two rows look the same rather than what you came for.
 *
 * The session's **name** is editable in place under the title, because it is a
 * property of the session rather than something you do to it — and only here,
 * never on the list cards, where forty text inputs on a phone would be the
 * whole page. `RenameField` below carries the one rule nobody would guess.
 *
 * ## The slot that was empty for a day, and the rule it left behind
 *
 * Section 5 held a dashed box saying *"Recent messages are not wired up yet"*
 * from 2026-09-07 until 2026-09-08, while the reader was built elsewhere. The
 * argument for leaving it empty is the one worth keeping now that it is full:
 * **an empty panel that says so is correct; a panel that shows nothing and
 * looks finished is not** — a mocked conversation would be the most expensive
 * lie this tool can tell, for the same reason the Orchestrator tab refuses to
 * draw a fake decision log.
 *
 * So the section that replaced it is written to the same rule pointed the other
 * way: it shows its failures loudly rather than smoothing them into a blank.
 * `not-found`, `unreadable` and *this page never got an answer* are three
 * different sentences and none of them renders as an empty conversation; a
 * transcript last written hours ago against a `working` row says out loud that
 * it may be the previous occupant of the pane. RecentMessages.tsx carries the
 * reasoning, and messages-client.ts carries the parse.
 *
 * **And the slot's other half is gone deliberately.** It printed `row.meta.dir`
 * and `row.claudeSessionId` to show the material was here and the reader was
 * not; both are still on the page, in *Where it is*, where they belong now that
 * nobody is waiting for them.
 *
 * ## What this file decides, and what it does not
 *
 * **It does not decide REFUSALS.** The two buttons post and show whatever comes
 * back; the server owns `steerableStatus`, and its refusal carries the sentence
 * that explains it, so a second copy of that rule here would be one more thing
 * to keep in step. Nothing below claims the box would turn something away.
 *
 * **It does decide WHAT TO OFFER**, which is a different question and a product
 * one. Two things follow from it, and both look at `status.kind`:
 *
 *  - `Queue` is absent on an idle session unless something deliverable is
 *    already waiting — see `offerQueue`, which has the whole argument.
 *  - **A shell gets one sentence and none of the controls.** This reverses what
 *    this header said until 2026-09-08, and the reason is worth keeping: the
 *    old rule was written to stop the page reimplementing a refusal, and it was
 *    right about that. But the page ALREADY branches on `status.kind` to draw
 *    the SHELL badge, so hiding the composer on the same branch adds no second
 *    source of truth — and offering fifteen buttons and a text box that cannot
 *    work, under a badge saying they cannot, is the more expensive lie. Fable
 *    ruled it, 2026-09-08. If the server one day lets a shell be typed at, this
 *    is one condition to delete, not a rule to unpick.
 *
 * The one thing checked locally beyond that is whether the row has the
 * identifiers at all (`unaddressable`), because that is a fact about the
 * payload on screen rather than a claim about the box.
 *
 * ## The clutter pass, and the rule it left behind
 *
 * 2026-09-08: a needs-you detail view measured **3,398px at 390px wide — four
 * screens, 31 buttons** — much of it permanent inline prose. Fable's rule, and
 * it is the one to apply to the next field rather than re-deriving:
 *
 * > A caveat stays on screen only if it would change what you do on this screen
 * > in the next ten seconds. If it only changes what you would *believe*, it
 * > lives one tap away, attached to the fact it qualifies.
 *
 * With two corollaries that did most of the work: **an honest label replaces a
 * paragraph** (`Queue (~73s)` says what a sentence was saying; `Ask it to…`
 * says these may be declined), and **the tap is on the number, never on a
 * separate help link** — which is what keeps the tool's non-negotiable rule
 * intact. Nothing here renders a bare number: it renders a number wearing its
 * caveat, and `Explain` is how it wears it.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

import { ActionOutcomeCard, SessionActions, SessionQueue } from "./ActionButtons";
import { DictationControl, useFleetDictation } from "./DictationControl";
import { PauseLine } from "./PauseLine";
import { RecentMessages, useRecentMessages } from "./RecentMessages";
import { Handles, Handoff, LaunchMode, QuestionCard, StatusPill, Uptime } from "./SessionParts";
import { Explain } from "./Tooltip";
import { hasDeliverable, queueFor, type ActionOutcome } from "./actions-client";
import { transcriptAge, type MessagesApi, type MessagesView } from "./messages-client";
import { NAME_RULE_TEXT, looksLikeAName, type RenameApi, type RenameOutcome } from "./rename-client";
import {
  checkLanding,
  listFields,
  sentTarget,
  type SentTarget,
  type SteerApi,
  type SteerOutcome,
  type VerifiedReading,
} from "./steer-client";

/** The refusal arm, so the headline table below is keyed by a real union. */
type SteerFailure = Extract<SteerOutcome, { ok: false }>;
import type { AnsweringReading, FleetGate, FleetRow, FleetStatus } from "./types";
import type { ActionsUi } from "./useActions";
import { Button, Card, Mono, cx } from "./ui";
import { formatDuration, statusLabel, whereLine } from "./view";

/** A heading inside the detail. Quieter than the panel headings outside it. */
function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="tw:mt-3">
      <h3 className="tw:px-1 tw:pb-1.5 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * What became of the last send.
 *
 * **The server's sentence, not ours.** `why` knows things this page cannot —
 * *"pane %1646 is in session $1643 now, not $1"* — and the status code decides
 * only what to suggest next: 409 means the world moved under the view, which is
 * the one case where refreshing is the answer.
 */
function Outcome({
  outcome,
  target,
  sessionName,
  onRefresh,
}: {
  outcome: SteerOutcome;
  /**
   * The row's identity AT THE MOMENT THIS SEND WAS REQUESTED, to check
   * `verified` against. Not the row on screen now — see `Landed` and
   * `SentTarget`.
   */
  target: SentTarget;
  sessionName: string;
  onRefresh: () => void;
}): ReactNode {
  if (outcome.ok) {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-work-ink">
          {outcome.op === "answer" ? "Answered." : "Sent."}
        </p>
        <Landed verified={outcome.verified} target={target} />
        {outcome.sent.length > 0 ? (
          <p className="tw:mt-1 tw:text-ink-soft">
            {/* The argv, because "what did you actually press" is the first
                question anybody asks about a session that then did something
                surprising, and reconstructing it from prose is guesswork. */}
            Typed at the pane: <Mono>{outcome.sent.map((call) => call.join(" ")).join("  |  ")}</Mono>
          </p>
        ) : null}
        <p className="tw:mt-1 tw:text-ink-faint">
          The session's own reply lands in its terminal, not here. The list will catch up at the next
          collection.
        </p>
      </div>
    );
  }
  const said = DELIVERY_HEADLINE[outcome.delivery.kind];
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">{said.head}</p>
      {said.body === null ? null : <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">{said.body}</p>}
      {/* Verbatim. Every word of this is the server's. */}
      <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        <Mono>{outcome.code}</Mono>
        {outcome.status === null ? null : (
          <>
            <span className="tw:px-1">·</span>
            <Mono>{`HTTP ${outcome.status}`}</Mono>
          </>
        )}
        <span className="tw:px-1">·</span>
        {outcome.from === "server" ? "said by the dashboard server" : "said by this browser"}
      </p>
      {/* **409 IS NOT ONE PIECE OF ADVICE**, and offering the same button for
          all of them is how a person learns to stop reading the sentence above
          it. Most 409s mean the world moved under the view and looking again is
          the answer. `input-not-empty` does not: the view was right, and there
          is somebody's half-typed sentence in that box. Refreshing changes
          nothing, and pressing it repeatedly is how you find out. GPT Sol,
          2026-09-08. (Two other 409s must never be retried at all —
          `send-partial` and `send-unknown` — but those are the delivery
          receipts' half and are not decided here.) */}
      {outcome.code === "input-not-empty" ? (
        <div className="tw:mt-2 tw:text-[12px] tw:text-ink-soft">
          <p>
            Refreshing will not help — the box is not empty, and only that session can empty it. Wait
            for it to send what it has, or go and look:
          </p>
          <Handoff sessionName={sessionName} />
        </div>
      ) : outcome.status === 409 ? (
        <p className="tw:mt-2">
          <Button onClick={onRefresh}>Refresh and look again</Button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * **WHAT WAS CHECKED IMMEDIATELY BEFORE SENDING, AGAINST WHAT WAS ASKED FOR.**
 *
 * `sent` says what was typed; this says what the target was proved to be a
 * moment earlier. **It is not a receipt, and every word here is chosen so that
 * it cannot be read as one.** `verifyTarget` runs BEFORE the screen capture and
 * before the `send-keys` calls, and nothing re-reads the pane afterwards —
 * steer.ts's KNOWN GAPS says why (tmux has no compare-and-send). This panel
 * said *"Landed in %2108"* and *"the keys were typed at"* until 2026-09-08,
 * which asserted delivery that nothing had measured, on the one surface where
 * being wrong is expensive. GPT Sol's M1.
 *
 * The comparison is against the row **as it was when the send was requested**
 * (`SentTarget`), not the row on screen now. The detail pane is keyed by session
 * id, so an outcome outlives the payload it was made against; comparing with the
 * live row asks a question nobody asked and can answer it wrongly in both
 * directions.
 *
 * **A disagreement should be unreachable** — `verifyTarget` refuses a claim that
 * does not match live tmux, including the respawned-pid case — so reaching it
 * means a guard upstream did not hold, which is exactly the class of thing worth
 * saying out loud rather than trusting silently. It is drawn in the alarm colour
 * inside an otherwise successful card. Instance 12 in the table in
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md:
 * the field was on the wire and the page dropped it, so this comparison had
 * never once been made.
 *
 * `not-told` draws nothing at all. A success with no address is what a server
 * older than this field sends, and a sentence about it would be noise on every
 * send against one — the arm exists so that silence cannot be rendered as an
 * address, not so that it can be announced.
 */
function Landed({ verified, target }: { verified: VerifiedReading; target: SentTarget }): ReactNode {
  const check = checkLanding(verified, target);
  if (check.kind === "not-told") return null;
  /* WHICH FIELDS TOOK PART, in the sentence itself. A comparison that named no
     fields would be indistinguishable from one that compared nothing, and the
     absent-pid case is real: a row with no pid proves the address, not the
     process in it. */
  const gap =
    check.unchecked.length === 0
      ? null
      : ` The ${listFields(check.unchecked)} could not be compared — this row carried none when you tapped.`;
  if (check.kind === "agrees") {
    return (
      <p className="tw:mt-1 tw:text-ink-soft">
        Verified <Mono>{check.verified.paneId}</Mono> in <Mono>{check.verified.sessionId}</Mono>{" "}
        immediately before the keys went — {listFields(check.compared)} all matched the row you
        tapped, resolved against live tmux rather than copied back from the request. Nothing looked
        at the pane afterwards, so this is a check, not a receipt.{gap}
      </p>
    );
  }
  return (
    <p className="tw:mt-1 tw:font-medium tw:break-words tw:text-alarm-ink">
      IT WAS NOT THE SESSION YOU TAPPED. Just before sending, the server resolved the target to{" "}
      <Mono>{check.verified.paneId}</Mono> in <Mono>{check.verified.sessionId}</Mono> (pid{" "}
      <Mono>{check.verified.panePid}</Mono>), and what you tapped was{" "}
      <Mono>{check.target.paneId ?? "no pane"}</Mono> in <Mono>{check.target.sessionId}</Mono> (pid{" "}
      <Mono>{check.target.panePid ?? "unstated"}</Mono>). The {listFields(check.differing)} differ.
      Go and look at both before sending anything else.{gap}
    </p>
  );
}

/**
 * THE HEADLINE ON A REFUSAL, WHICH IS NOT ALWAYS "NOTHING WAS SENT".
 *
 * It was, for every refusal, until 2026-09-08 — and that sentence is false in
 * the most expensive direction available. `steer.ts` distinguishes three
 * outcomes and the route sends them; the browser was dropping the field, so a
 * **partial** delivery — the text landed in that agent's input box and the
 * Enter did not — rendered as *"Nothing was sent."*, which invites exactly the
 * retry that appends to the half-sent text instead of replacing it. There is no
 * way to take the first one back. The server's own comment beside the field had
 * already named the consumer it needed.
 *
 * **The same CLASS as the sixteen in
 * docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md,
 * and not one of them** — this used to cite "Instance 5", which is
 * `SteeringQueue.revive()`. `delivery` is not in that table; the nearest entry
 * is instance 7, `deliverable`, which is a queue COUNT and a different field
 * entirely. Found later on 2026-09-08 while wiring this panel, and corrected
 * here in the evening after an implementer reported the citation rather than
 * copying it. A wrong citation is the same animal as a wrong comment: written to
 * be trusted later, in a place nobody re-derives.
 *
 * A `Record` over the closed union rather than a chain of ifs, so a fifth arm
 * in `DeliveryReading` fails the build here instead of quietly taking the last
 * branch. `not-told` is deliberately the same words as `unknown` minus the
 * cause: both mean *we cannot say what reached the pane*, and the difference —
 * whether the server had an opinion — changes nothing a person would do.
 */
const DELIVERY_HEADLINE: Record<SteerFailure["delivery"]["kind"], { head: string; body: string | null }> = {
  none: { head: "Nothing was sent.", body: null },
  partial: {
    head: "PART of it was sent.",
    body:
      "The text reached that session's input box and the Enter did not, so it is sitting there unsent. Do NOT send it again — a second message would be added to the end of the first. Go and look: the terminal is the only place this can be fixed.",
  },
  unknown: {
    head: "It is not known whether anything was sent.",
    body:
      "The attempt failed in a way that cannot say what reached the pane. Look at the session before trying again — if the text is sitting in its input box, sending again would add to it rather than replace it.",
  },
  "not-told": {
    head: "It is not known whether anything was sent.",
    body:
      "The server refused without saying what became of the keystrokes. Treat that as unknown rather than as nothing: look at the session before sending again.",
  },
};

/**
 * **Why this dialog is not tappable**, said before you tap rather than after.
 *
 * The page used to hold ALL answering back, which was too broad and was Greg's
 * push-back: *"mightn't there be other reasons why it needs to answer with
 * multiple choice to a session etc?"* It does — an agent's own
 * `AskUserQuestion` is a turn in a conversation, not a permission grant, and
 * refusing it bought nothing. So this card now appears for **one dialog at a
 * time**, and for a `conversation` dialog it does not appear at all.
 *
 * Three cases, and they are genuinely three:
 *
 *  - `why` non-null — the server has already refused a tap, and its own words
 *    are shown verbatim. This is sticky, because a control that refuses every
 *    time you press it is worse than one that says why it is not a control.
 *  - `answering.kind === "disabled"` — **the server has said, in the payload,
 *    that `POST /api/steer/answer` will do nothing.** Said BEFORE anybody taps,
 *    which is the entire reason the flag is on the state payload: without it
 *    this page either hedged or let a person discover the hold by tapping and
 *    getting a 503, and *the whole point of the hold is that a person should
 *    not tap* (wire.ts § `answeringEnabled`). The server sent that field for a
 *    day while this client dropped it, so the 503 is what a reader actually
 *    got — instance 13 in the table in
 *    docs/postmortems/260908b-the-parts-were-all-tested-and-none-of-the-joins-were.md.
 *  - `not-reported` / `unreadable` — **availability could not be established**,
 *    which is not the same sentence as *a hold was declared* and is drawn as its
 *    own card. The buttons are withheld all the same, and the reason it now
 *    fails closed rather than open is in types.ts § `AnsweringReading`: the kill
 *    switch predates the field, so silence from an older server is consistent
 *    with answering being off. My earlier argument here — that withholding on
 *    silence would invent a hold nobody declared — mistook *not saying* for
 *    *saying no*, and the fix is to say the third thing rather than to pick one
 *    of the first two.
 *  - `permission` — answering would grant a capability. Not offered.
 *  - `unknown` — we could not tell about the DIALOG, and it is treated exactly
 *    as `permission`. Same discipline in both halves now: "I could not tell"
 *    must not become the way through.
 *
 * The gate is a claim about THIS dialog and is read off the pane; the flag is a
 * claim about the server. Both can be unreadable, and neither unreadability is
 * a yes.
 *
 * Sending a MESSAGE is unaffected in every case, and that distinction is drawn
 * here rather than left to be discovered by tapping.
 */
function HeldBack({
  why,
  gate,
  answering,
}: {
  why: string | null;
  gate: FleetGate;
  /** Four arms; only `enabled` is permission. types.ts § `AnsweringReading`. */
  answering: AnsweringReading;
}): ReactNode {
  if (why !== null) {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-alarm-ink">The server would not answer this.</p>
        {/* Verbatim. It names the hazard and the way round it. */}
        <p className="tw:mt-1 tw:break-words tw:text-ink">{why}</p>
      </div>
    );
  }
  if (answering.kind === "disabled") {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-unknown-ink">Answering is switched off on this server.</p>
        <p className="tw:mt-1 tw:text-ink-soft">
          The dashboard says so in the payload rather than leaving you to find out by pressing one:
          a tap would come back 503 and nothing would reach the session. Answer it in the terminal —{" "}
          <code className="tw:font-mono">gjd-remote resume &lt;name&gt;</code> — or send a message
          below, which is not affected.
        </p>
      </div>
    );
  }
  /* **NOT "SWITCHED OFF", AND THE DIFFERENCE IS THE POINT OF THE ARM.** Nobody
     declared a hold here; we simply cannot establish that answering works, and
     the kill switch is older than the field that would have said so. The two
     causes are kept apart because they are two different things to go and
     check. */
  if (answering.kind !== "enabled") {
    return (
      <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
        <p className="tw:font-medium tw:text-unknown-ink">
          Whether answering works here could not be established.
        </p>
        <p className="tw:mt-1 tw:break-words tw:text-ink-soft">
          {answering.kind === "not-reported"
            ? "This server did not say whether answering is switched on, and the switch is older than the field that reports it — so silence is not evidence that a tap would reach the session."
            : `This server's answer could not be read: ${answering.why}.`}{" "}
          No hold has been declared; the buttons are withheld because nothing here can say a tap would
          land. Answer it in the terminal —{" "}
          <code className="tw:font-mono">gjd-remote resume &lt;name&gt;</code> — or send a message
          below, which is not affected.
        </p>
      </div>
    );
  }
  if (gate.kind === "conversation") return null;
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-unknown-ink">
        {gate.kind === "permission" ? "This one grants a permission, so it is not a button." : "Not offered: I could not tell what this is."}
      </p>
      <p className="tw:mt-1 tw:break-words tw:text-ink-soft">{gate.why}</p>
      <p className="tw:mt-1 tw:text-ink-soft">
        This menu was read off a terminal, and screen text is not proof of what is being asked. Sending
        a digit can be a turn in a conversation; it must never be an approval. Answer it in the
        terminal — <code className="tw:font-mono">gjd-remote resume &lt;name&gt;</code> — or send a
        message below, which is not affected.
      </p>
    </div>
  );
}

/**
 * The session's name, editable in place.
 *
 * ## Save is NOT disabled when the text is unchanged, and that is the design
 *
 * Renaming a session to the name it already has is legal and is not a no-op: it
 * clears the session's *provisional* flag, which is the thing that otherwise
 * lets `gjd-remote ls` rename it back to Claude's own title later. So
 * re-submitting the same name is the gesture for *keep this one*, and a Save
 * greyed out because nothing has been typed would make the useful case the
 * impossible one. The hint under the box says so, because nobody would guess it.
 *
 * **What is deliberately not drawn:** which sessions are provisional. That
 * would be the natural place for a *save to keep this name* nudge, and it would
 * be a guess — the payload carries no such field today. A hint invented from a
 * plausible heuristic is worse than no hint, because it would be right most of
 * the time.
 *
 * ## The local check refuses only what the rule plainly refuses
 *
 * It saves the common typo a round trip and decides nothing else: anything it
 * lets through the server judges, and when the server refuses, **its sentence
 * goes on screen verbatim** — it spells out the rule, and it knows which
 * session already holds a taken name, which this page cannot.
 */
function RenameField({ row, rename }: { row: FleetRow; rename: RenameApi }): ReactNode {
  const [name, setName] = useState(row.name);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RenameOutcome | null>(null);

  const trimmed = name.trim();
  /* Empty is the one thing worth saying before a round trip, separately from
     the shape rule, because "type something" and "that shape is not allowed"
     are different sentences. */
  const localWhy =
    trimmed === "" ? "A session needs a name." : looksLikeAName(trimmed) ? null : NAME_RULE_TEXT;

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    const result = await rename.rename(row, trimmed);
    setOutcome(result);
    // The name the SERVER settled on, so the box shows what is true of the box.
    if (result.ok) setName(result.name);
    setBusy(false);
  }, [rename, row, trimmed]);

  return (
    /* BEHIND A DISCLOSURE, because renaming from a phone is rare and the field
       was the fourth thing on every session page. Fable's ruling, 2026-09-08:
       the name is the heading; a rename is a deliberate act you are willing to
       open something for. The one-name rule came with it — there is no longer
       an italic "no title yet" above a box holding the real name, which showed
       two names for one session and made the placeholder look like the truth. */
    <details className="tw:mt-2">
      <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[12px] tw:text-ink-faint tw:hover:text-ink-soft">
        Rename
      </summary>
      <label className="tw:sr-only" htmlFor="rename-name">
        Name
      </label>
      <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <input
          id="rename-name"
          type="text"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          className="tw:h-7 tw:min-w-0 tw:flex-1 tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:px-2 tw:font-mono tw:text-[13px] tw:text-ink tw:disabled:opacity-50"
        />
        {/* Never disabled on "unchanged". See the header. */}
        <Button onClick={() => void save()} disabled={busy || localWhy !== null}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
        {localWhy ?? "Saving the same name again is not a no-op — it also stops the name being changed back later."}
      </p>
      {outcome === null ? null : outcome.ok ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-work-ink">
          {outcome.was === null ? (
            <>
              Renamed to <Mono>{outcome.name}</Mono>.
            </>
          ) : (
            <>
              Renamed from <Mono>{outcome.was}</Mono> to <Mono>{outcome.name}</Mono>.
            </>
          )}{" "}
          The list catches up at the next collection.
        </p>
      ) : (
        <div className="tw:mt-1 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-2.5 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">Not renamed.</p>
          {/* Verbatim. It spells out the rule, or names who has the name. */}
          <p className="tw:mt-1 tw:break-words tw:text-ink">{outcome.why}</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
            <Mono>{outcome.code}</Mono>
            <span className="tw:px-1">·</span>
            {outcome.from === "server" ? "said by the dashboard server" : "said by this browser"}
          </p>
          {outcome.code === "no-such-session" ? (
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
              The box no longer lists this session under the handle this page is holding. Refresh and look again.
            </p>
          ) : null}
        </div>
      )}
    </details>
  );
}

/**
 * When this session last wrote to its transcript, beside the badge.
 *
 * **The one number that tells a working session from a stuck one**, and until
 * now it was the first line of *Recent messages*, a screen and a half down a
 * four-screen page. Fable named it as the thing missing from the header.
 *
 * It draws in the loud colour when a WORKING session has been silent past the
 * threshold, which is the same judgment `transcriptAge` already makes for the
 * note further down — asked of it rather than recomputed here, so the header
 * and the section cannot disagree about whether a session has gone quiet.
 *
 * Nothing is drawn while the read is in flight, and nothing is drawn when the
 * server did not say. An age invented from silence would be worse than no age.
 */
function LastWrote({ view, status, now }: { view: MessagesView | null; status: FleetStatus; now: number }): ReactNode {
  if (view === null || view.kind !== "found" || view.lastModified === null) return null;
  const age = transcriptAge(view.lastModified, status, now);
  if (age.kind === "unstated") return null;
  const ms = Math.max(0, now - Date.parse(view.lastModified));
  return (
    <Explain
      tip={{
        head: "Last wrote",
        what: `${formatDuration(ms)} ago`,
        how: "When this session last added anything to its own transcript. A session the box calls working that has written nothing for a long time is either on one very long tool call or is not the conversation this row thinks it is.",
      }}
      placement="bottom"
      className={cx("tw:text-[12px]", age.kind === "suspect" ? "tw:text-alarm-ink" : "tw:text-ink-faint")}
    >
      wrote {formatDuration(ms)} ago
    </Explain>
  );
}

export function SessionDetail({
  row,
  now,
  answeringEnabled,
  tmuxServerPid,
  steer,
  rename,
  actions,
  messages,
  onRefresh,
  onBack,
}: {
  row: FleetRow;
  now: number;
  /**
   * **Whether `POST /api/steer/answer` will do anything**, as the four-arm
   * reading of what the server said — types.ts § `AnsweringReading`.
   *
   * A prop rather than a second read of the state: this component is handed
   * everything it draws, and the flag belongs to the payload the row came out
   * of. `HeldBack` says what each of the four answers looks like.
   */
  answeringEnabled: AnsweringReading;
  /**
   * **Which tmux server the handles below belong to**, or null when it could
   * not be read. Drawn in "Where it is", beside the handles it qualifies —
   * see there for why it is on this page at all.
   */
  tmuxServerPid: number | null;
  steer: SteerApi;
  rename: RenameApi;
  /** The vocabulary, the queues, and the four requests that touch them. */
  actions: ActionsUi;
  /**
   * The transcript reader. **A bare api rather than a `…Ui` hook**, because it
   * is asked once per open and once per press rather than polled — there is no
   * shared feed to hold, and putting one here is how it would end up on the
   * refresh loop. RecentMessages.tsx § one session at a time.
   */
  messages: MessagesApi;
  /** Ask the box for a fresh snapshot — offered after a 409, which means stale. */
  onRefresh: () => void;
  /** Non-null only when the list is not on screen beside this, i.e. one pane. */
  onBack: (() => void) | null;
}): ReactNode {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  /** The composer, so the dictation knows where the caret is. */
  const box = useRef<HTMLTextAreaElement>(null);
  /* **Named, so the vocabulary leads with this session's own words.** Somebody
     dictating here is very often about to say the handle on the screen in front
     of them, or the worktree it is working in — and the server promotes the
     named session to the front of the term list for exactly that. */
  const dictate = useFleetDictation({
    value: text,
    onChange: setText,
    box,
    context: { kind: "session", sessionId: row.id },
  });
  /* Read at the moment of sending rather than captured in a closure: a
     `useCallback` listing `dictate` would rebuild on every render, and this hook
     re-renders while somebody is talking. The question is always "is it blocked
     NOW", which is what a ref answers. */
  const blocked = useRef(dictate.sendBlocked);
  blocked.current = dictate.sendBlocked;
  /**
   * **THE LAST SEND, WITH THE TARGET IT WAS MADE AGAINST**, held as one value
   * because they are one fact.
   *
   * The outcome outlives the payload: this component is keyed by session id
   * alone, so the row underneath is replaced at every refresh while the card
   * stays on screen. Keeping only the outcome and comparing it with whatever
   * `row` is by then answers a different question from the one that was asked —
   * see `SentTarget` for both ways that goes wrong. GPT Sol's M1.
   */
  const [outcome, setOutcome] = useState<{ result: SteerOutcome; target: SentTarget } | null>(null);
  /**
   * The server's own sentence, once it has told us answering is switched off.
   *
   * Held rather than shown once and forgotten: after a refusal the options stop
   * being buttons, because a control that refuses every time you press it is
   * worse than one that says why it is not a control.
   */
  const [answeringOff, setAnsweringOff] = useState<string | null>(null);

  const label = statusLabel(row.status);
  const where = whereLine(row);
  const dir = row.meta.version === 1 ? row.meta.dir : null;

  /**
   * **One transcript read, two places on the page.** The section at the bottom
   * draws the turns; the header draws how long ago this session last wrote,
   * which is the number that tells a working session from a stuck one. Held
   * here rather than in each, because two reads of a multi-megabyte file to
   * draw one line would cost more than the clutter it removes — and because a
   * header and a section disagreeing about an age is exactly the sort of drift
   * this module keeps writing postmortems about.
   */
  const reading = useRecentMessages(messages, row);

  /**
   * **The only local refusal.** `paneId` is the address and `claudeSessionId`
   * is the conversation; without either the server has nothing to check the
   * pane against and will refuse. Saying so here costs nothing and is a fact
   * about the payload on screen, not a guess about the box.
   */
  const unaddressable =
    row.paneId === null
      ? "this row has no tmux pane handle, which is the address a keystroke needs"
      : row.claudeSessionId === null
        ? "this row has no Claude session id, so there is no way to tell this conversation from whatever is in that pane now"
        : null;

  const send = useCallback(
    async (run: () => Promise<SteerOutcome>, target: SentTarget, clear: boolean): Promise<void> => {
      setBusy(true);
      /* SNAPSHOTTED BY THE CALLER, BEFORE THE AWAIT. Reading `row` here would
         read the render that resolved the promise, which is the bug. */
      const result = await run();
      setOutcome({ result, target });
      // Both are sticky, and for the same reason: neither will come right by
      // pressing again. `answering-disabled` is the whole server switched off;
      // `grants-permission` is this dialog, and it can only change when the
      // dialog does — at which point the row is replaced and this state with it.
      if (!result.ok && (result.code === "answering-disabled" || result.code === "grants-permission")) {
        setAnsweringOff(result.why);
      }
      if (result.ok && clear) setText("");
      setBusy(false);
    },
    [],
  );

  const onAnswer = useCallback(
    (index: number) => {
      void send(() => steer.answer(row, index), sentTarget(row), false);
    },
    [row, send, steer],
  );

  /* **The submit rule at the action boundary, not only on the button.**
     `disabled` stops a pointer; it does not stop a programmatic call, and it
     does not stop a keyboard path somebody adds later. The invariant is that a
     message never leaves this box while the microphone is on or the transcript
     is still in flight — on Safari and Firefox the box holds nothing that was
     said until the transcript lands. GPT Sol's review of the built code,
     finding 6. */
  const onSend = useCallback(() => {
    if (blocked.current) return;
    void send(() => steer.message(row, text), sentTarget(row), true);
  }, [row, send, steer, text]);

  /**
   * **Two buttons, because they are two different things.**
   *
   * Send types the message at the pane now, which is what you want for a
   * session sitting at a prompt and is useless for one that is working —
   * keystrokes into a busy Claude Code land in whatever the terminal is doing.
   * Queue puts it in the same ordered list the action buttons feed, so that
   * *"actually do X instead"* lands after the button that said do X and before
   * the one that said push. queue.ts: two queues cannot promise that, which is
   * why a queued message and a queued action go to one endpoint.
   *
   * Neither is offered as the automatic one. The server decides whether a send
   * is allowed and says why when it is not, and a page that silently converted
   * one gesture into the other would be answering a question nobody asked.
   */
  const [queueOutcome, setQueueOutcome] = useState<ActionOutcome | null>(null);

  /**
   * **Whether Queue is offered at all**, which on an `idle` session it is not.
   *
   * Greg, 2026-09-08: *"I tried using 'Queue' to send a message to an idle
   * session, and nothing happened [...] if the session is idle, either hide the
   * Queue button and/or auto-send."* Half of that was the queue having no drain
   * (v0.5f, drain.ts). The other half is this: a session at a prompt takes the
   * keystroke immediately, so Queue is the same act about 73 seconds later, and
   * the page was offering the slow one with nothing said in its favour. Hiding
   * it beats auto-sending because auto-send makes one button mean two different
   * acts depending on state you cannot see, and the argument for this whole
   * tool is that a person can tell what a press will do before pressing it.
   *
   * **The condition is the STATUS, not "the queue is empty"** — status is what
   * the person is reasoning about, and what the pill beside the title is
   * already showing them. The exception is a session that already has something
   * waiting: then Queue stays, because ordering is the only thing the queue is
   * for. queue.ts: *"a message must land after the one that says 'do X' and
   * before the one that says 'push'"*, and two buttons that both send NOW would
   * let this one overtake what is already in the line.
   *
   * **AND "WAITING" MEANS DELIVERABLE, NOT PRESENT IN THE LIST** — GPT Sol's D2
   * and D3, 2026-09-08. Two kinds of item sit in the queue and are ahead of
   * nothing: one the tmux generation has killed (`invalidated`, permanent, and
   * `next()` now steps past it), and one past `maxAgeMs` that nothing will send
   * unasked. If the only thing in an idle session's queue is one of those, the
   * ordering guarantee this exception rests on does not exist, so `items.length`
   * would offer the slower button for a reason that is not true. `hasDeliverable`
   * asks the queue's own count rather than deciding here, for the same reason
   * `stale` is asked rather than recomputed (routes-actions.ts's catalogue).
   *
   * **This is not the header's "nothing here decides whether a send will be
   * allowed".** That rule is about REFUSALS: the server owns `steerableStatus`,
   * its refusal carries the sentence that explains it, and a second copy here
   * would be a rule to keep in step. Nothing below claims the box would refuse
   * a queued message on an idle session — it would accept it, and deliver it a
   * pass later. This is a claim about which of two accepted gestures is worth
   * offering, which is a product judgment and belongs on the page.
   */
  const waiting = queueFor(actions.feed, row.id);
  const offerQueue = row.status.kind !== "idle" || hasDeliverable(waiting);

  const onQueue = useCallback(async (): Promise<void> => {
    /* Same guard, same reason. See `onSend`. */
    if (blocked.current) return;
    setBusy(true);
    const result = await actions.api.queueMessage(row, text);
    setQueueOutcome(result);
    if (result.ok) setText("");
    setBusy(false);
    actions.refresh();
  }, [actions, row, text]);

  return (
    <Card
      className={cx(
        "session-detail tw:border-l-4 tw:p-4",
        label.tone === "needs" ? "tw:border-l-needs" : "tw:border-l-rule-strong",
      )}
    >
      {onBack === null ? null : (
        <p className="tw:mb-2">
          <Button onClick={onBack}>← All sessions</Button>
        </p>
      )}

      {/* THE HEADER IS FOUR THINGS ON ONE LINE, and the third of them is new.
          badge · up · last-wrote. "Last wrote" is what distinguishes a working
          session from a stuck one and it used to be buried a screen and a half
          down inside Recent messages. */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1">
        <StatusPill status={row.status} />
        <PauseLine pause={row.pause} status={row.status} now={now} />
        <LastWrote view={reading.view} status={row.status} now={now} />
        <Uptime row={row} now={now} className="tw:ml-auto" />
      </div>

      {/* ONE NAME, NOT TWO. It used to draw an italic "no title yet" here and
          the real tmux name in the rename box underneath, so a session with no
          Claude title showed a placeholder where its name is and its name
          where a placeholder would be. */}
      <h2 className="tw:mt-1.5 tw:text-[17px] tw:leading-snug tw:font-medium tw:break-words">
        {row.title ?? row.name}
      </h2>
      {label.detail === null ? null : (
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:text-unknown-ink">{label.detail}</p>
      )}

      {/* The same strip as the list card, with the recovery spelled out —
          `detail` is what turns on the sentence saying what to press, and what
          lets the honest shrug (`cannot-tell`) show at all. Placed above the
          sections rather than inside "What it needs from you", because a
          session in manual mode is not asking you anything yet; it is about to
          stop asking anybody. */}
      <LaunchMode mode={row.permissionMode} detail />

      {/* Beside the title, because it is a property of this session rather than
          something you do to it — and NOT on the list cards, where forty text
          inputs on a phone would be the whole page. Keyed by the row up in
          SessionsPanel, so switching sessions resets the box. */}
      <RenameField row={row} rename={rename} />

      {/* -------------------------------------------- 1. what it needs -- */}
      {/* THE EMPTY CASE IS GONE, HEADING AND ALL. It used to draw a section
          titled "What it needs from you" containing the sentence "Nothing. It
          is not asking you anything." — a section whose entire content was the
          news that it had no content, on every working, idle and shell page.
          The badge in the header already says which of those this is. What
          survives is the needs-you sentence, which is not an empty state: it
          is the content of that state, and it says where to go instead. */}
      {row.question !== null ? (
        <Section title="What it needs from you">
          <HeldBack why={answeringOff} gate={row.question.gate} answering={answeringEnabled} />
          <QuestionCard
            question={row.question}
            sessionName={row.name}
            /* **A POSITIVE `enabled`, AND NOTHING ELSE, IS PERMISSION.** A
               declared hold withholds the buttons for the same reason
               `grants-permission` does — a control that exists only to return
               503 teaches a reader to stop believing the ones that work — and
               so, since GPT Sol's M3, does a server that did not say or said
               something unreadable: the kill switch is older than the field, so
               silence is consistent with the hold being on. `HeldBack` above
               draws which of the three it was. */
            onAnswer={
              unaddressable === null &&
              answeringOff === null &&
              answeringEnabled.kind === "enabled" &&
              row.question.gate.kind === "conversation"
                ? onAnswer
                : null
            }
            busy={busy}
          />
        </Section>
      ) : row.status.kind === "needs-you" ? (
        <Section title="What it needs from you">
          <p className="tw:text-[13px] tw:text-ink-soft">
            Waiting for a person, and no dialog could be read off the pane. See the last thing it said,
            below — or open the terminal.
          </p>
        </Section>
      ) : null}

      {unaddressable === null ? null : (
        <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">{unaddressable}</p>
      )}

      {/* A SHELL GETS ONE SENTENCE AND NONE OF THE CONTROLS. See the header's
          "what this file decides, and what it does not". */}
      {row.status.kind === "shell" ? (
        <p className="tw:mt-3 tw:text-[13px] tw:text-ink-soft">
          A shell. Nothing can be typed at it: a shell would <em>run</em> the message rather than read it. The
          transcript and the identifiers below are still worth having; there is nothing here to press.
        </p>
      ) : (
        <>
          {/* -------------------------------------------- 2. steering -- */}
          {/* ABOVE THE BUTTONS NOW. The commonest thing a needs-you session
              wants is an answer in prose, and it was the third section down
              behind fifteen buttons. Fable, 2026-09-08: a question in chat is
              answered by typing, and that is what the composer is for. */}
          <Section title="Say something to it">
            <label className="tw:sr-only" htmlFor="steer-text">
              A message to send to this session
            </label>
            <textarea
              id="steer-text"
              ref={box}
              value={text}
              rows={3}
              disabled={busy || unaddressable !== null}
              /* `readOnly`, NOT `disabled`, for the ~2 seconds the transcript is
                 in flight: `disabled` drops the selection, and the selection is
                 the caret the words are about to be spliced at. */
              readOnly={dictate.readOnly}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. pull the latest dev and carry on"
              className="tw:w-full tw:rounded-md tw:border tw:border-rule tw:bg-panel tw:p-2 tw:text-[14px] tw:text-ink tw:disabled:opacity-50"
            />
            <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              {/* THE LABELS CARRY THE DIFFERENCE NOW, so the paragraph that
                  used to explain it is a tap on Queue. "Send" and "Queue it"
                  were two words that did not say which was slower. */}
              {/* **`sendBlocked`, not `readOnly`** — they are not the same
                  thing and the second is the one everybody forgets. `readOnly`
                  is the two seconds AFTER the press to stop; `armed` is the
                  microphone still being on. Guard only the first and Send now
                  types the rough live guesses into a live agent's pane, or on
                  Safari and Firefox types nothing that was said at all. And the
                  button is disabled as well as guarded: a correct guard behind a
                  lit button is a press that does nothing and says nothing, which
                  is the worse half of the pair. */}
              <Button
                variant="loud"
                onClick={onSend}
                disabled={busy || text.trim() === "" || unaddressable !== null || dictate.sendBlocked}
              >
                {busy ? "Sending…" : "Send now"}
              </Button>
              {/* The second gesture, not a fallback for the first — and absent on
                  an idle session, where it would be the first one, slower. See
                  `offerQueue`. */}
              {offerQueue ? (
                <Explain
                  tip={{
                    head: "Queue",
                    what: "Goes when the session is next at a prompt.",
                    how: "It joins the line below with anything else you have pressed, in order. The line is checked about every 73 seconds — a collection takes around 13 and the loop then waits 60 from the end of it — so a queued message is never immediate. Send types it at the pane now instead, which jumps whatever is already waiting.",
                  }}
                  placement="top"
                >
                  <Button
                    onClick={() => void onQueue()}
                    disabled={busy || text.trim() === "" || unaddressable !== null || dictate.sendBlocked}
                  >
                    Queue (~73s)
                  </Button>
                </Explain>
              ) : null}
              {/* The newline rule is the server's and is checked there. It stays
                  VISIBLE, unlike the rest: it changes what a thumb does in the
                  next two seconds. Claude Code's input box submits on Enter, so
                  a two-line message arrives as two, the first half a sentence. */}
              <span className="tw:text-[12px] tw:text-ink-faint">One line — a newline would submit it early.</span>
            </div>
            {/* On its own row rather than in with the send buttons: it grows a
                status line, a level meter and sometimes a failure sentence, and
                a control that changes width should not be pushing Send now
                around under a thumb. */}
            <DictationControl
              dictation={dictate.dictation}
              toggle={dictate.toggle}
              className="tw:mt-1.5"
            />
            {offerQueue ? null : (
              <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
                It is at a prompt, so Send is all there is to do here. Queue comes back when it is working, or when
                something is already waiting in front of you.
              </p>
            )}
          </Section>

          {outcome === null ? null : (
            <Outcome
              outcome={outcome.result}
              target={outcome.target}
              sessionName={row.name}
              onRefresh={onRefresh}
            />
          )}
          {queueOutcome === null ? null : <ActionOutcomeCard outcome={queueOutcome} onRefresh={actions.refresh} />}

          {/* --------------------------------------------- 3. actions -- */}
          {/* "ASK IT TO…", not "Do something to it". The verb says these are
              requests an agent may decline, which is what the deleted
              paragraph said in two sentences. The destructive group keeps its
              own heading inside — "Force" — and stays next to this rather than
              below the queue, so the loud red block is never separated from
              the strip it is the exception to. */}
          <Section title="Ask it to…">
            <SessionActions
              row={row}
              feed={actions.feed}
              api={actions.api}
              asked={actions.asked}
              error={actions.error}
              unaddressable={unaddressable}
              onChanged={actions.refresh}
            />
          </Section>

          {/* --------------------------------------------- 4. the queue -- */}
          <Section title="Waiting to go to it">
            <SessionQueue
              sessionId={row.id}
              feed={actions.feed}
              api={actions.api}
              asked={actions.asked}
              error={actions.error}
              onChanged={actions.refresh}
            />
          </Section>
        </>
      )}

      {/* ------------------------------------- 5. the conversation -- */}
      {/* Drawn for EVERY row, whatever its status. A shell has no transcript
          and the honest answer there is the reader's own sentence, not a
          section that quietly removed itself. See RecentMessages.tsx. */}
      <Section title="Recent messages">
        <RecentMessages row={row} now={now} reading={reading} />
      </Section>

      {/* --------------------------------------------- 6. where it is -- */}
      {/* COLLAPSED. This is what you read when two rows look the same, not what
          you came for — and it was four ids, a path, a repo line and two
          paragraphs of caveat at the bottom of every page. The summary carries
          the repo, which is the part anybody scans for. */}
      <details className="tw:mt-3">
        <summary className="tw:cursor-pointer tw:rounded-md tw:px-1 tw:py-1 tw:text-[11px] tw:font-semibold tw:tracking-widest tw:text-ink-faint tw:uppercase tw:hover:text-ink-soft">
          Where it is{where === null ? "" : ` — ${where}`}
        </summary>
        <div className="tw:mt-1 tw:border-l tw:border-rule tw:pl-3">
          {where === null ? <p className="tw:text-[13px] tw:text-ink-faint">no repo recorded</p> : null}
          {dir === null ? (
            <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint">
              no working directory recorded — this session predates the launcher writing one down
            </p>
          ) : (
            <Explain
              tip={{
                head: "Working directory",
                what: dir,
                how: "The only place the full path exists. The name above is its last segment, and two worktrees can differ by a word — so this is what tells them apart, and what a transcript would be found from.",
              }}
              placement="top"
              className="tw:mt-1 tw:block tw:text-[13px] tw:break-words tw:text-ink-soft"
            >
              <Mono>{dir}</Mono>
            </Explain>
          )}
          <Handles row={row} full />
          <p className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">
            Session handle, pane handle, the pane's pid and the conversation's own id. All four go back
            to the server with anything you send, exactly as they arrived, so it can check the pane is
            still the one you were looking at.
          </p>
          {/* **THE NAMESPACE THE FOUR HANDLES ABOVE LIVE IN**, and the reason
              it is drawn here rather than in the masthead: `$1643` means
              nothing without it, so the place a person can compare it is beside
              the handles it qualifies. Two snapshots with different values
              describe different worlds — one tmux server restart re-issues
              every `$…` and `%…` on the box, and a reader comparing a handle
              they wrote down yesterday with one on screen today has no other
              way to know. The server has sent this since collect.ts was
              written and no client had ever read it (docs/postmortems/260908b).

              `null` is drawn rather than hidden: "we could not read it" and "we
              did not look" are both worth one quiet line here, because the
              alternative is a reader who assumes the handles are comparable. */}
          <Explain
            tip={{
              head: "tmux server",
              what:
                tmuxServerPid === null
                  ? "not read on this snapshot"
                  : `pid ${tmuxServerPid}`,
              how: "Session and pane handles are only meaningful inside one tmux server. If this number is not the one you saw last time, every handle on this page was re-issued — the sessions you are looking at are not the ones you were looking at, however alike the handles look.",
            }}
            placement="top"
            className="tw:mt-1 tw:block tw:text-[11px] tw:text-ink-faint"
          >
            {tmuxServerPid === null ? (
              "tmux server unread"
            ) : (
              <>
                tmux server <Mono>{tmuxServerPid}</Mono>
              </>
            )}
          </Explain>
        </div>
      </details>
    </Card>
  );
}

/**
 * The pane when the selected session is not in the latest snapshot.
 *
 * **A row that disappears is information, not an error.** The session may have
 * exited, or the collector may have failed to see it — and either way the id is
 * still in the URL, so silently falling back to "nothing selected" would erase
 * the fact that something was there a minute ago.
 */
export function MissingSession({ id, onBack }: { id: string; onBack: () => void }): ReactNode {
  return (
    <Card className="tw:border-l-4 tw:border-l-unknown tw:p-4">
      <h2 className="tw:font-medium">That session is not in the latest snapshot.</h2>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        <Mono>{id}</Mono> was selected and the box did not list it this time round. It may have
        exited, or the collection may have missed it — the age and any error in the masthead say
        which is more likely.
      </p>
      <p className="tw:mt-3">
        <Button onClick={onBack}>← All sessions</Button>
      </p>
    </Card>
  );
}
