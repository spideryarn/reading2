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
 * the same `drainGate` the send will use, and answers with what it WOULD do to
 * each and the exact line it would say. Press **Send it** and that is what
 * happens.
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
 * completed), `queued` (it is working, so the line is in its queue and arrives
 * at its next prompt), `skipped`, or `not-reached`. Even a submitted row is not
 * a receipt: nothing on this box can establish that an agent read a line, and
 * `verified` is a pre-send identity check. So the headline counts what was
 * measured and the words are `submitted` and `queued`, never *heard*.
 *
 * A `queued` row is the one most easily misread. It may be delivered a long time
 * later, to a session whose situation has moved on — so it says *will arrive
 * when it is next at a prompt*, and nothing on it reads as "sent".
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
import { SteerReceipt } from "./SteerReceipt";
import { Explain } from "./Tooltip";
import type { FleetRow } from "./types";
import { Button, Card, Mono } from "./ui";

/**
 * Which rows are worth sending up at all.
 *
 * **This is not a decision about who may be spoken to** — `drainGate` makes that
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
  if (c.notReached > 0) parts.push(`${c.notReached} never got a turn before the deadline`);
  return `${parts.join(", ")} — of ${c.asked} asked.`;
}

/** One row of the receipts. The arm decides the words; nothing is generic. */
function Receipt({ row, name }: { row: RecipientOutcome; name: string }): ReactNode {
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
        <SteerReceipt outcome={row.outcome} target={{ paneId: row.paneId, sessionId: row.sessionId, panePid: null }} />
      ) : null}
      {row.kind === "queued" ? (
        /* **NOT "SENT", AND NOT "IT WILL BE READ".** It is in that session's
           queue, it goes when the session is next at a prompt, and that may be a
           long time — by which point what it is doing has moved on. */
        <p className="tw:mt-1 tw:text-ink-soft">
          Queued (position {row.position}). It goes when that session is next at a prompt, which may be a while — it is
          working now. Nothing has been typed at it.
        </p>
      ) : null}
      {row.kind === "skipped" ? (
        <p className="tw:mt-1 tw:text-ink-soft">
          Not reached — {row.why} <Mono>{row.code}</Mono>
        </p>
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
  api = httpBroadcastApi,
}: {
  rows: readonly FleetRow[];
  /** The seam. A test drives this card without a network; the browser gets the default. */
  api?: BroadcastApi;
}): ReactNode {
  const [text, setText] = useState("");
  const [includeOverseer, setIncludeOverseer] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * The preview, and **the exact text it was made against**.
   *
   * Held together because they are one fact. A preview of one sentence beside a
   * box now containing another is a confirmation of something nobody is about to
   * send, so editing the text drops the preview rather than leaving it looking
   * current — which is the same class as a stale row: a number on screen that no
   * longer describes what the button will do.
   */
  const [preview, setPreview] = useState<{ result: BroadcastResult; of: string; to: number } | null>(null);
  const [done, setDone] = useState<BroadcastOutcome | null>(null);

  const targets = addressable(rows).filter((r) => includeOverseer || !isOverseer(r));
  const words = text.trim();
  const names = new Map<string, string>();
  for (const row of rows) names.set(row.id, row.title ?? row.name);

  /* The preview is only current if BOTH the words and the recipient set are the
     ones it was made against. Ticking the Overseer box changes who is being
     agreed to, which is exactly as invalidating as retyping the sentence. */
  const current = preview !== null && preview.of === words && preview.to === targets.length;

  const go = useCallback(
    async (dryRun: boolean) => {
      if (words === "" || targets.length === 0) return;
      setBusy(true);
      const outcome = await api.send(targets, words, dryRun);
      if (dryRun) {
        setDone(null);
        setPreview(
          outcome.kind === "ran"
            ? { result: outcome.result, of: words, to: targets.length }
            : /* A refusal is not a preview. Showing the old one under a fresh
                 refusal is how somebody confirms a count the server has just
                 told them is wrong. */
              null,
        );
        if (outcome.kind !== "ran") setDone(outcome);
      } else {
        setPreview(null);
        setDone(outcome);
        if (outcome.kind === "ran") setText("");
      }
      setBusy(false);
    },
    [api, targets, words],
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
          setText(e.target.value);
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

      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-faint">
        {targets.length} addressable session{targets.length === 1 ? "" : "s"} would be considered. How many of those can
        actually be reached is the server's answer, not this page's — press Preview.
      </p>

      <p className="tw:mt-2 tw:flex tw:flex-wrap tw:gap-2">
        <Button disabled={busy || words === "" || targets.length === 0} onClick={() => void go(true)}>
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
      </p>

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
              <Receipt key={r.paneId} row={r} name={names.get(r.sessionId) ?? r.sessionId} />
            ))}
          </ul>
        </div>
      ) : null}

      {done === null ? null : done.kind === "ran" ? (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-work/40 tw:bg-work-wash tw:p-3 tw:text-[13px]">
          <p className="tw:font-medium tw:text-work-ink">{headline(done.result, false)}</p>
          <p className="tw:mt-1 tw:text-ink-faint">
            Submitted means the keystrokes went, not that anybody has read them — there is no receipt for a keystroke.
          </p>
          <ul className="tw:mt-2">
            {done.result.recipients.map((r) => (
              <Receipt key={r.paneId} row={r} name={names.get(r.sessionId) ?? r.sessionId} />
            ))}
          </ul>
        </div>
      ) : (
        <div className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
          {done.kind === "unknown" ? (
            <>
              {/* **NOT "IT FAILED".** The request may have reached the server and
                  the server may have typed at half the fleet before the answer
                  was lost. Saying nothing happened would invite the retry that
                  says everything twice, to everybody. */}
              <p className="tw:font-medium tw:text-alarm-ink">It is not known what reached the fleet.</p>
              <p className="tw:mt-1 tw:text-ink">{done.why}</p>
              <p className="tw:mt-1 tw:text-ink">
                Do NOT simply send it again — the server may have delivered some or all of it before the answer was
                lost. Look at the queue and at a session or two first.
              </p>
            </>
          ) : (
            <>
              <p className="tw:font-medium tw:text-alarm-ink">Nothing was broadcast.</p>
              <p className="tw:mt-1 tw:text-ink">{done.why}</p>
              <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
                <Mono>{done.code}</Mono>
                <span className="tw:px-1">·</span>
                <Mono>{`HTTP ${done.status}`}</Mono>
              </p>
              {/* A refusal that judged the rows still carries WHY for each, which
                  is the only thing that makes it actionable. */}
              {done.result === null || done.result.recipients.length === 0 ? null : (
                <ul className="tw:mt-2">
                  {done.result.recipients.map((r) => (
                    <Receipt key={r.paneId} row={r} name={names.get(r.sessionId) ?? r.sessionId} />
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
