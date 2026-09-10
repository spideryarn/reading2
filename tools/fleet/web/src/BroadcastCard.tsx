/**
 * **ONE LINE TO EVERY AGENT ON THE BOX**, and the two presses it takes.
 *
 * > there should be a way to send messages directly to the Overseer in the
 * > Overseer tab, and also to broadcast to all agents
 * >
 * > — Greg, 2026-09-08
 *
 * ## The confirmation IS the dry run, and that is the whole design
 *
 * A confirmation dialog that says *"this will go to 34 sessions"* is a number
 * the page worked out for itself, and the fan-out is free to disagree with it —
 * they use different rules and they diverge exactly when the box is changing
 * fastest, which is when somebody reaches for this button. So there is no
 * client-side count. Press **Preview** and the server classifies the rows with
 * the same `deliveryGate` the send will use, and answers with what it WOULD do
 * to each and the exact line it would say. Press **Send it** and that is what
 * happens.
 *
 * A preview stops being current when the words change, when the **recipient
 * set** changes — a set, not a count, because a one-for-one replacement keeps
 * the length identical — or when the server answers a dry run with something
 * other than a preview, which is read as *the fleet may already have it*.
 *
 * The cost of a broadcast is the reason it is two presses rather than one:
 *
 * > steering costs the target its context, so batch it and time it for idle
 * >
 * > — docs/project/overseer-direction.md
 *
 * Every line delivered is a turn of a paid model, and a broadcast spends N of
 * them at once. The preview says how many before anybody commits.
 *
 * ## What the receipts may and may not say
 *
 * **Never "sent to everybody".** A row was `submitted` (the tmux calls
 * completed), `queued` (it is working, so the line is in its queue and is attempted
 * when it is next eligible), `skipped`, `held` (that session is holding text
 * nobody could account for, so the server did not reach the transport at all),
 * or `not-reached`. Even a submitted row is not
 * a receipt: nothing on this box can establish that an agent read a line, and
 * `verified` is a pre-send identity check. So the headline counts what was
 * measured and the words are `submitted` and `queued`, never *heard*.
 *
 * A `queued` row is the one most easily misread. It may be delivered a long time
 * later, to a session whose situation has moved on — and it may never be
 * delivered at all, because a queued item can expire, be cancelled, be orphaned
 * with its session, or sit behind a quarantine hold. So it says it will be
 * **attempted when that session is next eligible**, which is the strongest true
 * statement available, and nothing on it reads as "sent" or as "it will arrive".
 *
 * ## The Overseer's own row
 *
 * Left out by default and opted in with a tick-box. A broadcast is for the
 * fleet; the session supervising it should not be interrupted by the fleet's own
 * mechanism unless somebody means it. The count moves when the box is ticked, so
 * what is being agreed to is always what is on screen.
 */
import { useCallback, useState } from "react";
import type { ReactNode } from "react";

import {
  httpBroadcastApi,
  type BroadcastApi,
  type BroadcastOutcome,
  type BroadcastResult,
  type RecipientOutcome,
} from "./broadcast-client";
import { draftNoticeSentence, useDraft } from "./drafts";
import { sentTarget, type SentTarget } from "./steer-client";
import { SteerReceipt } from "./SteerReceipt";
import { Explain } from "./Tooltip";
import type { FleetRow } from "./types";
import { Button, Card, Mono } from "./ui";

/**
 * Which rows are worth sending up at all.
 *
 * **This is not a decision about who may be spoken to** — `deliveryGate` makes that
 * cut on the server, and duplicating it here is how the count in front of a
 * person stops matching the fan-out. This only drops rows that carry no address:
 * without a pane handle there is nowhere for keystrokes to go, and without a
 * Claude session id there is no way to tell this conversation from whatever is
 * in that pane now. Both are facts about the payload rather than guesses about
 * the box, and the server refuses both anyway.
 */
function addressable(rows: readonly FleetRow[]): FleetRow[] {
  return rows.filter((r) => r.paneId !== null && r.claudeSessionId !== null);
}

function isOverseer(row: FleetRow): boolean {
  return row.role.kind === "overseer";
}

/**
 * **WHAT A PREVIEW WAS ABOUT, AS A STRING THAT CHANGES WHEN ANYTHING DOES.**
 *
 * This was a recipient COUNT, and GPT Sol's P1-3 is why it is not: a one-for-one
 * replacement — one session ends and another appears between Preview and Send —
 * keeps the length identical, so the preview stayed "current" while describing a
 * different fleet. A pane, uuid or pid changing under a live row did the same.
 *
 * So the signature is every field the request actually carries, in order,
 * including the status each row was in — because a session that was working
 * when the preview said *would queue* and is idle now would be typed at
 * instead, which is a different thing from what was agreed to.
 */
function signature(rows: readonly FleetRow[]): string {
  return rows.map((r) => `${r.id}|${r.paneId}|${r.claudeSessionId}|${r.panePid}|${r.status.kind}`).join("\n");
}

/** The line under the counts. Every number here was measured, not assumed. */
function headline(result: BroadcastResult, preview: boolean): string {
  const c = result.counts;
  if (preview) {
    const would = result.recipients.filter((r) => r.kind === "would-send").length;
    const later = result.recipients.filter((r) => r.kind === "would-queue").length;
    return `Of ${c.asked} sessions: ${would} would be typed at now, ${later} would have it queued, ${c.skipped} cannot be reached.`;
  }
  const parts = [`Keys submitted to ${c.submitted}`, `queued for ${c.queued}`];
  if (c.skipped > 0) parts.push(`${c.skipped} could not be reached`);
  /* **A HELD ROW IS NAMED, NOT ABSORBED.** Nothing was typed at it and nothing
     was queued for it, so leaving it out of this line is how a fan-out that
     reached most of the fleet reads as one that reached all of it. */
  if (c.held > 0) parts.push(`${c.held} held after an earlier send nobody could account for`);
  if (c.notReached > 0) parts.push(`${c.notReached} never got a turn before the deadline`);
  return `${parts.join(", ")} — of ${c.asked} asked.`;
}

/** One row of the receipts. The arm decides the words; nothing is generic. */
function Receipt({ row, name, sent }: { row: RecipientOutcome; name: string; sent: SentTarget | undefined }): ReactNode {
  const head = (
    <span className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2">
      <span className="tw:font-medium tw:text-ink">{name}</span>
      <Mono>{row.sessionId}</Mono>
    </span>
  );
  return (
    <li className="tw:border-t tw:border-rule tw:py-2 tw:text-[13px]">
      {head}
      {row.kind === "attempted" ? (
        /* **THE TARGET AS IT WAS POSTED**, so `checkLanding` compares against
           what was actually addressed. Synthesising one here with `panePid:
           null` made every receipt report the pid as uncomparable when it had
           been sent — the comparison this component exists for, quietly not
           made. */
        <SteerReceipt
          outcome={row.outcome}
          target={sent ?? { paneId: row.paneId, sessionId: row.sessionId, panePid: null }}
        />
      ) : null}
      {row.kind === "queued" ? (
        /* **NOT "SENT", AND NOT "IT WILL BE READ", AND NOT EVEN "IT WILL GO".**
           A queued item can expire, be cancelled, be orphaned when its session
           ends, or sit behind a quarantine hold — so the only true statement is
           that it will be ATTEMPTED when the session is next eligible. GPT Sol's
           P2, and the test that pinned the old wording was enforcing the
           overclaim. */
        <p className="tw:mt-1 tw:text-ink-soft">
          Queued{row.position === null ? "" : ` (position ${row.position})`}. It will be attempted when that session is
          next eligible, which may be a while — it is working now. Nothing has been typed at it, and nothing here can
          promise it arrives.
        </p>
      ) : null}
      {row.kind === "skipped" ? (
        <p className="tw:mt-1 tw:text-ink-soft">
          Not reached — {row.why} <Mono>{row.code}</Mono>
        </p>
      ) : null}
      {row.kind === "held" ? (
        /* **NOT "REFUSED", AND NOT "SENT".** The transport was never reached:
           this session is already holding text nobody could account for, and a
           second line landing behind half a first would be read as one
           instruction neither person wrote. The sentence is the server's. */
        <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">Nothing was typed at it — {row.why}</p>
      ) : null}
      {row.kind === "not-reached" ? <p className="tw:mt-1 tw:text-ink-soft">{row.why}</p> : null}
      {row.kind === "would-send" ? <p className="tw:mt-1 tw:text-ink-soft">Would be typed at now.</p> : null}
      {row.kind === "would-queue" ? (
        <p className="tw:mt-1 tw:text-ink-soft">Would go in its queue — it is working.</p>
      ) : null}
      {row.kind === "unreadable" ? (
        <p className="tw:mt-1 tw:font-medium tw:text-alarm-ink">{row.why}</p>
      ) : null}
    </li>
  );
}

export function BroadcastCard({
  rows,
  unreadableRows,
  api = httpBroadcastApi,
}: {
  rows: readonly FleetRow[];
  /**
   * How many rows in this payload the page could not read.
   *
   * **A control that says "every live Claude session" must not run off a list
   * it knows is short.** The Overseer card had this from the start and this one
   * did not, which GPT Sol found: a dropped row here is a session that silently
   * does not get the message, under a label promising all of them.
   */
  unreadableRows: number | null;
  /** The seam. A test drives this card without a network; the browser gets the default. */
  api?: BroadcastApi;
}): ReactNode {
  /**
   * **THE ONE DRAFT NOT KEYED TO A CONVERSATION.** The other two boxes are
   * addressed to one conversation and keep their words under its verified id,
   * so a replacement running a different conversation never finds them. A
   * broadcast has no single recipient — it goes to whoever is on the box when
   * it is sent — so there is no execution for a replacement to inherit it
   * from, and nothing that could make it the wrong recipient's. Keyed by
   * purpose alone (drafts.ts), with the same storage guards, cap and Clear.
   */
  const draft = useDraft({ purpose: "broadcast" });
  const text = draft.text;
  const [includeOverseer, setIncludeOverseer] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * The preview, and **exactly what it was a preview of** — the words, the
   * recipient signature, and the addresses that were posted.
   *
   * Held together because they are one fact. A preview beside a box now
   * containing another sentence, or beside a fleet that has changed underneath
   * it, is a confirmation of something nobody is about to send.
   */
  const [preview, setPreview] = useState<{
    result: BroadcastResult;
    of: string;
    to: string;
    sent: Map<string, SentTarget>;
  } | null>(null);
  const [done, setDone] = useState<{ outcome: BroadcastOutcome; sent: Map<string, SentTarget> } | null>(null);

  const targets = addressable(rows).filter((r) => includeOverseer || !isOverseer(r));
  const words = text.trim();
  const names = new Map<string, string>();
  for (const row of rows) names.set(row.id, row.title ?? row.name);

  /* The preview is current only if the words AND the exact recipient set are the
     ones it was made against — see `signature`, which is a set rather than a
     count for a reason. Ticking the Overseer box changes who is being agreed to,
     which is exactly as invalidating as retyping the sentence. */
  const now = signature(targets);
  const current = preview !== null && preview.of === words && preview.to === now;
  const incomplete = unreadableRows === null || unreadableRows > 0;

  const go = useCallback(
    async (dryRun: boolean) => {
      if (words === "" || targets.length === 0 || incomplete) return;
      const submission = dryRun ? null : draft.submission();
      if (!dryRun && submission === null) return;
      const submittedWords = submission === null ? words : submission.text.trim();
      setBusy(true);
      /* SNAPSHOTTED BEFORE THE AWAIT, and kept: `SteerReceipt` compares what
         the server verified against what was addressed, and the rows underneath
         are replaced at every collection while the receipts stay on screen.
         Passing `panePid: null` — which this did until GPT Sol's P2 — made every
         receipt say the pid "could not be compared" when it had been sent. */
      const sent = new Map<string, SentTarget>(targets.map((r) => [r.id, sentTarget(r)]));
      const answer = await api.send(targets, submittedWords, dryRun);
      /**
       * **THE ANSWER'S OPERATION IS CHECKED HERE TOO, AND THAT IS NOT
       * BELT-AND-BRACES.**
       *
       * `makeBroadcastApi` refuses a mismatch on the wire, but `api` is an
       * injected seam — a test's fake, or a later implementation, hands this
       * card whatever it likes. A card that read `kind: "ran"` and never looked
       * at `op` would draw a fan-out that HAD ALREADY GONE OUT as a preview,
       * with a Send button under it. GPT Sol's P1-5, whose second half this is;
       * the first version of this fix changed only the client and a test caught
       * that the card was still wrong.
       *
       * `unknown` rather than a refusal, for the same reason as on the wire: an
       * answer describing a broadcast is evidence that one happened.
       */
      const wanted = dryRun ? "broadcast-preview" : "broadcast";
      const outcome: BroadcastOutcome =
        answer.kind === "ran" && answer.op !== wanted
          ? {
              kind: "unknown",
              why: `this was a ${dryRun ? "dry run" : "real broadcast"} and the answer describes a ${answer.op}. The two do not match, so what reached the fleet cannot be read off it.`,
            }
          : answer;
      if (dryRun) {
        setDone(null);
        setPreview(
          outcome.kind === "ran"
            ? { result: outcome.result, of: words, to: signature(targets), sent }
            : /* A refusal is not a preview. Showing the old one under a fresh
                 refusal is how somebody confirms a count the server has just
                 told them is wrong. */
              null,
        );
        if (outcome.kind !== "ran") setDone({ outcome, sent });
      } else {
        setPreview(null);
        setDone({ outcome, sent });
        /* Only a broadcast that RAN takes the draft with it — a refusal or an
           unknown answer leaves the sentence, and its stored copy, where it is. */
        if (outcome.kind === "ran" && submission !== null) draft.accept(submission);
      }
      setBusy(false);
    },
    [api, draft, incomplete, targets, words],
  );

  const overseerRow = rows.find(isOverseer);

  return (
    <Card className="tw:mt-3 tw:p-4">
      <h2 className="tw:font-medium">Broadcast to all agents</h2>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        One line to every live Claude session on the box. Sessions at a prompt are typed at now; sessions that are
        working get it in their queue and read it when they next come up for air.{" "}
        <Explain
          tip={{
            head: "What a broadcast costs",
            what: "Every line delivered is a turn of a paid model, and this spends one per session at once.",
            how: "It also costs each agent its context at whatever point it interrupts — so it is worth batching what you have to say and sending it once. The preview tells you how many sessions before anything goes.",
          }}
        >
          <span className="tw:underline tw:decoration-dotted">This is not a cheap button.</span>
        </Explain>
      </p>

      <textarea
        className="tw:mt-3 tw:w-full tw:rounded-md tw:border tw:border-rule tw:bg-page tw:p-2 tw:text-[13px] tw:text-ink"
        rows={3}
        value={text}
        placeholder="one line to every agent"
        aria-label="Broadcast to all agents"
        onChange={(e) => {
          draft.setText(e.target.value);
          /* The preview described the OLD sentence. Kept on screen it would be
             a confirmation of something nobody is about to send. */
          setPreview(null);
        }}
      />

      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
        <label className="tw:inline-flex tw:items-center tw:gap-2">
          <input
            type="checkbox"
            checked={includeOverseer}
            onChange={(e) => {
              setIncludeOverseer(e.target.checked);
              setPreview(null);
            }}
          />
          Include the Overseer{overseerRow === undefined ? "" : ` (${overseerRow.title ?? overseerRow.name})`}
        </label>
        {overseerRow === undefined ? (
          <span className="tw:pl-2 tw:text-ink-faint">— no session holds the claim, so this changes nothing</span>
        ) : null}
      </p>

      {incomplete ? (
        /* **A LIST KNOWN TO BE SHORT CANNOT BACK A CONTROL LABELLED "ALL
           AGENTS".** A dropped row is a session that silently does not get the
           message, and this card would have promised it did. Refused rather
           than sent with a caveat: the caveat is the part people stop reading.
           GPT Sol's P1-3, second half. */
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-alarm-ink">
            {unreadableRows} session row{unreadableRows === 1 ? "" : "s"} in this payload could not be read.
          </p>
          <p className="tw:mt-1 tw:text-ink">
            So this page cannot say who "every agent" is, and will not broadcast to a list it knows is short. It comes
            back when the next collection arrives whole.
          </p>
        </div>
      ) : (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
          {targets.length} addressable session{targets.length === 1 ? "" : "s"} would be considered. How many of those
          can actually be reached is the server's answer, not this page's — press Preview.
        </p>
      )}

      <p className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
        <Button disabled={busy || words === "" || targets.length === 0 || incomplete} onClick={() => void go(true)}>
          {busy && !current ? "Checking…" : "Preview"}
        </Button>
        {/* **THE SEND IS ONLY OFFERED BEHIND A CURRENT PREVIEW.** Not disabled-
            but-present: a button that exists is a button somebody will press, and
            what makes this safe is that the number beside it came back from the
            same function that is about to do the sending. */}
        {current && preview !== null ? (
          <Button variant="danger" disabled={busy} onClick={() => void go(false)}>
            {busy ? "Sending…" : `Send it to ${preview.result.counts.asked} sessions`}
          </Button>
        ) : null}
        <Button
          disabled={busy || text === ""}
          onClick={() => {
            draft.clear();
            /* Same reason as the textarea's: a preview of a sentence that is no
               longer in the box is a confirmation of nothing. */
            setPreview(null);
          }}
        >
          Clear
        </Button>
      </p>
      {draft.notice === null ? null : (
        <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">{draftNoticeSentence(draft.notice)}</p>
      )}

      {current && preview !== null ? (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-rule tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-ink">{headline(preview.result, true)}</p>
          {preview.result.sample === null ? null : (
            <p className="tw:mt-2 tw:text-ink-soft">
              {/* The RENDERED line — what an agent will actually read, prefix and
                  all — because that is the thing being agreed to. */}
              Each one would receive: <span className="tw:text-ink">{preview.result.sample}</span>
            </p>
          )}
          <ul className="tw:mt-2">
            {preview.result.recipients.map((r) => (
              <Receipt key={r.paneId} row={r} name={names.get(r.sessionId) ?? r.sessionId} sent={preview.sent.get(r.sessionId)} />
            ))}
          </ul>
        </div>
      ) : null}

      {done === null ? null : done.outcome.kind === "ran" ? (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-work-ink">{headline(done.outcome.result, false)}</p>
          <p className="tw:mt-1 tw:text-ink-faint">
            Submitted means the keystrokes went, not that anybody has read them — there is no receipt for a keystroke.
          </p>
          <ul className="tw:mt-2">
            {done.outcome.result.recipients.map((r) => (
              <Receipt key={r.paneId} row={r} name={names.get(r.sessionId) ?? r.sessionId} sent={done.sent.get(r.sessionId)} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          {done.outcome.kind === "unknown" ? (
            <>
              {/* **NOT "IT FAILED".** The request may have reached the server and
                  the server may have typed at half the fleet before the answer
                  was lost. Saying nothing happened would invite the retry that
                  says everything twice, to everybody. */}
              <p className="tw:font-medium tw:text-alarm-ink">It is not known what reached the fleet.</p>
              <p className="tw:mt-1 tw:text-ink">{done.outcome.why}</p>
              <p className="tw:mt-1 tw:text-ink">
                Do NOT simply send it again — the server may have delivered some or all of it before the answer was
                lost. Look at the queue and at a session or two first.
              </p>
            </>
          ) : (
            <>
              <p className="tw:font-medium tw:text-alarm-ink">Nothing was broadcast.</p>
              <p className="tw:mt-1 tw:text-ink">{done.outcome.why}</p>
              <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
                <Mono>{done.outcome.code}</Mono>
                <span className="tw:px-1">·</span>
                <Mono>{`HTTP ${done.outcome.status}`}</Mono>
              </p>
              {/* A refusal that judged the rows still carries WHY for each, which
                  is the only thing that makes it actionable. */}
              {done.outcome.result === null || done.outcome.result.recipients.length === 0 ? null : (
                <ul className="tw:mt-2">
                  {done.outcome.result.recipients.map((r) => (
                    <Receipt
                      key={r.paneId}
                      row={r}
                      name={names.get(r.sessionId) ?? r.sessionId}
                      sent={done.sent.get(r.sessionId)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
