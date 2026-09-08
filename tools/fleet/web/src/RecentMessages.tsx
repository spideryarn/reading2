/**
 * The tail of a session's own conversation, in the detail pane.
 *
 * **Greg, 2026-09-08:** *"Show the recent message(s) for each session when I
 * click on it in `Sessions` mode, no matter what status."*
 *
 * ## WHAT THIS SECTION IS FOR, WHICH IS NOT "SHOW THE CHAT"
 *
 * It is twelve turns, newest last, and it exists to answer one question: *is
 * this row telling me the truth?* The list says `working`; this says what it
 * last actually said, and when. Everything drawn here that is not a turn is
 * there to keep that answer honest — see the three notes below, each of which
 * is a requirement written into `tools/fleet/transcript.ts` rather than a
 * decoration chosen here.
 *
 * ## NO MATTER WHAT STATUS, AND THAT IS THE EASY THING TO GET WRONG
 *
 * A `shell` or `no-claude` row has no transcript, and the reader answers
 * `not-found` with a sentence written for a person. **That is a good answer and
 * it is shown.** Nothing here is gated on status: a section that hid itself for
 * the rows without a conversation would be a panel that shows nothing and looks
 * finished, which is the failure this stage exists to end. Three rows on this
 * box are scheduled sessions whose pane is still running `sleep` and has never
 * started Claude; they carry a `claudeSessionId` and no transcript, and the
 * page has to read sensibly for one of those.
 *
 * ## THE THREE NOTES THAT ARE NOT DECORATION
 *
 *  1. **How far back this goes.** `reachedStartOfFile` is, in transcript.ts's
 *     words, *"what stops '3 turns' from being ambiguous"*. Three arms, because
 *     a server that did not send the field has made no claim and this page says
 *     so rather than picking one.
 *  2. **When the transcript was last written**, beside a row the collector
 *     calls `working`. `claudeSessionId` comes from a tmux env var set once at
 *     session creation and never updated, so a re-used pane resolves to the
 *     PREVIOUS conversation — real messages, well formed, correctly attributed,
 *     and not the conversation on screen. The reader cannot detect that from
 *     inside; this comparison is the only thing that can, and it is the single
 *     most valuable line in the section.
 *  3. **What was skipped.** `toolResultsSkipped` is sent *"so the client can say
 *     'and 40 tool results' rather than implying the agent sat silent between
 *     two messages"*.
 *
 * ## ONE SESSION AT A TIME, AND ONLY WHEN ASKED
 *
 * Reading a transcript costs disk, and this box has hit load average 391. So:
 * fetched when the detail pane opens for a row, and again when somebody presses
 * *Read again*. **It is not on the sixty-second refresh loop and it is not
 * fetched for the rows in the list** — the component only exists while one
 * session is open, and `SessionDetail` is keyed by the row, so switching
 * sessions is a fresh mount and exactly one more read.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string below is agent-authored text from a process that may have been
 * handling hostile input. React escapes it and nothing here adds markup: no
 * raw-HTML escape hatch, no markdown renderer, no linkifier. Same rule as the
 * pane capture, and a test in tests/fleet-web.test.tsx globs this directory to
 * keep it.
 *
 * And one thing that is untrusted in a subtler way: **an unfamiliar speaker is
 * drawn as unfamiliar.** A `compact-summary` is machine-written text wearing
 * `role: "user"`, and transcript.ts calls it *"the single most convincing wrong
 * answer this module could give"*. Rounding a speaker this build cannot name to
 * "agent" would misattribute a message, so it is labelled as unknown instead.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  transcriptAge,
  type MessageSpeaker,
  type MessageTurn,
  type MessagesApi,
  type MessagesView,
} from "./messages-client";
import { Explain } from "./Tooltip";
import type { FleetRow } from "./types";
import { Button, Mono, cx } from "./ui";
import { formatDuration } from "./view";

/**
 * How each speaker is named, and which of them need a warning beside the name.
 *
 * `note` is non-null only for the ones a reader would otherwise get wrong.
 * `human` has one because a steer sent from THIS PAGE lands here too and is
 * indistinguishable from Greg at the keyboard by anything in the transcript —
 * transcript.ts refuses to guess and so does this.
 */
const SPEAKERS: Record<MessageSpeaker, { label: string; note: string | null; tone: string }> = {
  human: {
    label: "typed at the pane",
    note: "a person, or a steering message sent from this page — the transcript cannot tell them apart",
    tone: "tw:text-needs-ink",
  },
  assistant: { label: "the agent", note: null, tone: "tw:text-work-ink" },
  peer: { label: "another agent", note: "over the peer socket, not a person", tone: "tw:text-work-ink" },
  notification: { label: "machinery", note: "a subagent finishing, or an auto-continuation", tone: "tw:text-ink-faint" },
  "compact-summary": {
    label: "a compaction summary",
    note: "written by Claude Code when the conversation ran out of context, and it wears a person's role — nobody said this",
    tone: "tw:text-unknown-ink",
  },
  injected: {
    label: "an injected reminder",
    note: "machinery wearing a person's role — nobody typed this",
    tone: "tw:text-unknown-ink",
  },
  "api-error": { label: "an API error", note: null, tone: "tw:text-alarm-ink" },
  system: { label: "Claude Code itself", note: null, tone: "tw:text-ink-faint" },
  unrecognised: {
    label: "an unknown speaker",
    note: "this build does not know this kind of turn, so it will not say who said it",
    tone: "tw:text-unknown-ink",
  },
};

/** Bytes, coarsely. A ratio is the point of this, not a byte count. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** One turn. Text and tool calls, and neither is markup. */
function Turn({ turn }: { turn: MessageTurn }): ReactNode {
  const who = SPEAKERS[turn.speaker];
  return (
    <li className="transcript-turn tw:border-t tw:border-rule tw:py-2 tw:first:border-t-0">
      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-[11px]">
        <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
        {turn.at === null ? null : <span className="tw:text-ink-faint">{turn.at}</span>}
      </p>
      {who.note === null ? null : <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">{who.note}</p>}
      {turn.text === "" ? (
        /* An assistant turn with no words and some tool calls is a REAL state,
           not a missing one — transcript.ts says so. Drawing nothing here would
           make it look like a turn that failed to load. */
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint tw:italic">
          {turn.toolCalls.length > 0 ? "No words in this turn — it only called tools." : "No words and no tool calls in this turn."}
        </p>
      ) : (
        /* Untrusted text. `whitespace-pre-wrap` keeps the agent's own line
           breaks without anything interpreting them. */
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">{turn.text}</p>
      )}
      {turn.truncated ? (
        <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
          Cut short{turn.fullChars === null ? "" : ` — ${turn.fullChars.toLocaleString()} characters in full`}.
        </p>
      ) : null}
      {turn.toolCalls.length === 0 ? null : (
        <ul className="tw:mt-1 tw:space-y-0.5">
          {turn.toolCalls.map((call, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a turn's tool calls have no id of their own, and this list is fixed for the life of the turn — never reordered, appended to or filtered — so the index IS a stable identity here. Two calls to the same tool with the same detail are otherwise indistinguishable.
            <li key={`${call.name}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
              <Mono>{call.name}</Mono>
              {call.detail === null ? null : <span className="tw:pl-2 tw:break-all tw:text-ink-faint">{call.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * How far back this goes — the three arms of `reachedStartOfFile`.
 *
 * The third is the one worth having: *the server did not say* is a different
 * claim from *there is more above*, and a page that rendered them the same
 * would be inventing the more alarming of the two half the time.
 */
function HowFarBack({ reached, turns }: { reached: boolean | null; turns: number }): ReactNode {
  if (reached === true) {
    return (
      <p className="tw:text-[12px] tw:text-ink-soft">
        This is the whole conversation: {turns === 1 ? "one turn" : `${turns} turns`}, and nothing above them.
      </p>
    );
  }
  if (reached === false) {
    return (
      <p className="tw:text-[12px] tw:text-ink-soft">
        There is more above this — these are the last {turns === 1 ? "turn" : `${turns} turns`}, not the whole
        conversation.
      </p>
    );
  }
  return (
    <p className="tw:text-[12px] tw:text-unknown-ink">
      The server did not say whether there is more above these {turns === 1 ? "turn" : "turns"}, so this page
      will not claim either way.
    </p>
  );
}

/**
 * **The one check on the hazard the reader cannot see from inside.**
 *
 * Drawn in the violet this tool reserves for *nobody could tell*, not in the
 * alarm red, because it is a question rather than a verdict: a working session
 * can be silent for half an hour on one long tool call. What it does is make
 * the wrong answer visible, and the wrong answer here is a real conversation
 * that is not this one.
 */
function StaleNote({ ms }: { ms: number }): ReactNode {
  return (
    <div className="tw:mt-2 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-unknown-ink">
        This may not be this session's conversation.
      </p>
      <p className="tw:mt-1 tw:text-ink-soft">
        The box calls this session <em>working</em>, and its transcript was last written{" "}
        {formatDuration(ms)} ago. A session's conversation id comes from{" "}
        <Mono>CLAUDE_SESSION_ID</Mono>, set once when the tmux session was created and never updated —
        so if this pane has been re-used for a second conversation, the turns above are the previous
        one: real, well formed, correctly attributed, and not what is on that screen.
      </p>
      <p className="tw:mt-1 tw:text-ink-faint">
        The other explanation is an agent on one very long tool call, which is common on this box. The
        terminal settles it.
      </p>
    </div>
  );
}

/** A failure, in whoever's words they are, saying whose they are. */
function Refusal({ head, why, detail, said }: { head: string; why: string; detail: ReactNode; said: string }): ReactNode {
  return (
    <div className="tw:rounded-lg tw:border tw:border-rule-strong tw:bg-panel tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-ink">{head}</p>
      {/* Verbatim where it is the server's. It was written for a person on a phone. */}
      <p className="tw:mt-1 tw:break-words tw:text-ink-soft">{why}</p>
      {detail}
      <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">{said}</p>
    </div>
  );
}

function Found({ view, row, now }: { view: MessagesView & { kind: "found" }; row: FleetRow; now: number }): ReactNode {
  const age = transcriptAge(view.lastModified, row.status, now);
  const written =
    view.lastModified === null
      ? null
      : age.kind === "unstated"
        ? view.lastModified
        : `${formatDuration(Math.max(0, now - Date.parse(view.lastModified)))} ago`;

  /* THE PROVENANCE IS A TAP, THE AGE IS NOT. How much of the file we read and
     whether we found it by scanning are things that change what you BELIEVE
     about the turns below; the age is the thing that changes what you DO, and
     it has been promoted to the header where a thumb finds it without
     scrolling. Neither fact is deleted — a number here without its caveat
     would be the failure this whole page is written against. */
  const provenance = [
    view.bytesRead === null || view.fileBytes === null
      ? null
      : `Read ${bytes(view.bytesRead)} of a ${bytes(view.fileBytes)} file.`,
    view.via === "scan"
      ? "Found by scanning — the directory on the row is stale, which is ordinary for a worktree."
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join(" ");

  const headline = written === null ? "The server did not say when this was last written." : `Last written ${written}.`;

  return (
    <div>
      {provenance === "" ? (
        <p className="tw:text-[12px] tw:text-ink-faint">{headline}</p>
      ) : (
        <Explain
          tip={{ head: "Where these turns came from", what: headline, how: provenance }}
          placement="bottom"
          className="tw:block tw:text-[12px] tw:text-ink-faint"
        >
          {headline}
        </Explain>
      )}

      {age.kind === "suspect" ? <StaleNote ms={age.ms} /> : null}

      {view.copies !== null && view.copies !== 1 ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-unknown-ink">
          {view.copies} files carry this conversation id. The one read is named below; which of them is the live
          one is not something this page can tell.
        </p>
      ) : null}

      {view.turns.length === 0 ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          {view.turnsOffered
            ? "The transcript was read and there are no turns in it. That is a file that exists and has nothing to say — a session that has not spoken yet."
            : "The server said it found the transcript and then sent no turns at all. That is not an empty conversation; it is an answer this page cannot read."}
        </p>
      ) : (
        <ul className="tw:mt-2">
          {view.turns.map((turn, i) => (
            <Turn key={turn.uuid ?? `turn-${i}`} turn={turn} />
          ))}
        </ul>
      )}

      <div className="tw:mt-2 tw:space-y-0.5">
        <HowFarBack reached={view.reachedStartOfFile} turns={view.turns.length} />
        {view.toolResultsSkipped !== null && view.toolResultsSkipped > 0 ? (
          /* So a gap between two messages reads as work rather than as silence. */
          <p className="tw:text-[12px] tw:text-ink-faint">
            And {view.toolResultsSkipped} tool results, not shown.
          </p>
        ) : null}
        {/* 0 and 1 are normal: a live file is being appended to while it is
            read, so the last line is often half written. Anything higher is
            worth a look, and only that is said out loud. */}
        {view.recordsUnparseable !== null && view.recordsUnparseable > 1 ? (
          <p className="tw:text-[12px] tw:text-unknown-ink">
            {view.recordsUnparseable} lines of the transcript could not be read. One is normal — a live file with a
            half-written last line — and this is more than one.
          </p>
        ) : null}
        {view.unreadableTurns > 0 ? (
          <p className="tw:text-[12px] tw:text-unknown-ink">
            {view.unreadableTurns} turns came back in a shape this page could not read, so they are missing from the
            list above. It is short by that many.
          </p>
        ) : null}
        {view.path === null ? null : (
          <p className="tw:text-[11px] tw:break-all tw:text-ink-faint">
            <Mono>{view.path}</Mono>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Fetch on open, and again when asked. Nothing else triggers it.
 *
 * `view === null` with `asked === false` is *not read yet*, which is a
 * different thing from *read, and there was nothing* — the same distinction
 * `useActions` keeps, and the reason the panel below never draws a calm blank.
 */
/**
 * The reading, held by whoever needs it in more than one place.
 *
 * **Exported and lifted out of `RecentMessages` deliberately.** The header of
 * the detail view shows *when this session last wrote*, which is the one number
 * that tells a working session from a stuck one — and it came out of this
 * reading, a screen and a half further down the page. Two reads of a
 * multi-megabyte transcript to draw one number would be worse than the clutter
 * it fixes, so the caller holds one reading and passes it to both.
 */
export type MessagesReading = { view: MessagesView | null; busy: boolean; read: () => void };

/**
 * **WHICH AGENT A READING IS ABOUT — the handle AND the conversation.**
 *
 * `row.id` is tmux's `$1643`, and a pane keeps it across a respawn: a
 * `gjd-remote resume`, a relaunch, a second `claude` started in the same
 * window. `types.ts` § `claudeSessionId` says what the other half is for in as
 * many words — *"the only one of the three identifiers that survives a
 * `gjd-remote resume`, so it is what distinguishes this agent from the one that
 * replaced it in the same pane."* A transcript belongs to the conversation, not
 * to the window it happens to be running in, so anything asking *is this
 * reading still the right one?* has to ask about the pair.
 *
 * A string rather than an object because it is compared, not read, and because
 * both consumers below need a value a `useEffect` dependency array can compare
 * with `Object.is`. `\u0000` cannot occur in either half.
 *
 * `null` is a real value here and not a wildcard: a row with no conversation id
 * is a shell or a legacy session, and two of those under one handle are still
 * the same reading — there is nothing to tell them apart with, and inventing a
 * difference would re-read on every snapshot.
 */
function identityOf(row: FleetRow): string {
  return `${row.id}\u0000${row.claudeSessionId ?? ""}`;
}

/**
 * A reading, and **the identity it is a reading OF**, held together.
 *
 * The two cannot be separate pieces of state. `setView(null)` in an effect
 * happens after React has already committed — and possibly painted — the render
 * in which the row is B and the view is still A's. That frame is short and it is
 * exactly the lie this whole section is about: one agent's turns, and its "last
 * wrote" number, under another agent's name. Storing the identity with the view
 * turns the question into one the RENDER can answer, so the wrong pairing never
 * reaches the screen at all rather than being corrected a tick later. GPT Sol's
 * fourth finding, 2026-09-08 — and it is the reason the test that "passed" did
 * so: `act` flushes effects before anything looks at the DOM, so the frame a
 * person would see is the one a test cannot.
 */
type Held = { identity: string; view: MessagesView };

export function useRecentMessages(api: MessagesApi, row: FleetRow): MessagesReading {
  const [held, setHeld] = useState<Held | null>(null);
  const [busy, setBusy] = useState(false);
  const identity = identityOf(row);

  /**
   * WHICH READ IS THE NEWEST ONE ANYBODY STARTED. Only it may write.
   *
   * **A read that lands after the reader has moved on must not be drawn.**
   * `Read again` on session A, then a tap on session B, and A's answer arrives
   * to find B's panel on screen — so the turns of one agent render under the
   * name and status of another. On a page whose entire job is telling you which
   * session needs you, that is the worst thing it can get wrong, and it renders
   * perfectly: real turns, well formed, correctly parsed, attached to the wrong
   * row.
   *
   * `fleet-health-history` flagged the general shape on 2026-09-08 (two
   * overlapping polls of one endpoint resolving out of order); here it is not
   * two polls of one thing but one poll of two different things, which is
   * worse, because the stale answer is not merely old — it is about somebody
   * else.
   *
   * **This was an identity comparison and identity is not an ordering**, which
   * is the shape of the bug twice over. It began as `row.id`, and a pane that
   * changed agent without changing handle compared `"$a"` with `"$a"`, agreed,
   * and let the previous agent's turns through — the failure the guard existed
   * to prevent, arriving down the one door it did not cover (roadmap finding
   * E-session). Widening it to the full identity closes that door and leaves
   * A→B→A open: hold a manual read of A, let the pane become B and then A
   * again, and the held answer's identity equals the current one, so it
   * overwrites a newer reading of the same conversation. Only a number that
   * goes up can order two reads. **GPT Sol's fifth finding, 2026-09-08, and the
   * general lesson is worth more than the fix: a freshness check written as an
   * equality is a check that cannot tell two of the same thing apart.**
   */
  const newest = useRef(0);

  /**
   * Start one read and let only the newest answer land.
   *
   * `identityOf(row)` rather than `identity`: this is called from a closure that
   * may be older than the current render, and the identity that matters is the
   * one the row being ASKED about had.
   */
  const begin = useCallback(
    (asked: FleetRow): void => {
      newest.current += 1;
      const token = newest.current;
      const askedFor = identityOf(asked);
      setBusy(true);
      void api.recent(asked).then((answer) => {
        if (newest.current !== token) return;
        setHeld({ identity: askedFor, view: answer });
        setBusy(false);
      });
    },
    [api],
  );

  /**
   * **THE ROW'S IDENTITY IS THE DEPENDENCY, NOT THE ROW OBJECT, and that is the
   * whole design of this section.** A new snapshot arrives every sixty seconds
   * and replaces every row object on the page; depending on the object would
   * re-run this effect on each one and put a disk read of a multi-megabyte
   * transcript on the refresh loop — the one thing this section must not do.
   * `identity` is a string built from two primitives, so an unchanged snapshot
   * produces an equal value and re-reads nothing.
   *
   * **What changed on 2026-09-08 is which change counts as the session
   * changing.** This read on `row.id` alone, and the sentence here used to say
   * "the handle changing IS the session changing" — which is false in exactly
   * the case `claudeSessionId` exists for. See `identityOf`.
   *
   * There is no `setHeld(null)` here and that is deliberate: the old reading is
   * hidden by the identity check below, during the very render in which the row
   * changed, rather than cleared by this effect one commit later. See `Held`.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above — depending on `row` rather than on `identity` would put the transcript read on the sixty-second refresh loop.
  useEffect(() => {
    begin(row);
  }, [begin, identity]);

  /**
   * **THE PAIRING IS CHECKED HERE, WHERE IT IS DRAWN.** A reading of somebody
   * else is not a reading of this row, whatever state holds it, so it is never
   * handed out. `busy` is not gated the same way: a read really is in flight,
   * and the panel says so.
   */
  const view = held !== null && held.identity === identity ? held.view : null;

  return { view, busy, read: () => begin(row) };
}

export function RecentMessages({
  row,
  now,
  reading,
}: {
  row: FleetRow;
  now: number;
  /** Held by the caller, because the header draws a number out of it too. */
  reading: MessagesReading;
}): ReactNode {
  const { view, busy, read } = reading;

  return (
    <div>
      {view === null ? (
        <p className="tw:text-[13px] tw:text-ink-soft">
          {busy ? "Reading the tail of this session's transcript…" : "Not read yet."}
        </p>
      ) : view.kind === "found" ? (
        <Found view={view} row={row} now={now} />
      ) : view.kind === "not-found" ? (
        <Refusal
          head="There is no transcript to read for this session."
          why={view.why}
          detail={
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-faint">
              <Mono>{view.reason}</Mono>
            </p>
          }
          said="said by the dashboard server"
        />
      ) : view.kind === "unreadable" ? (
        <Refusal
          head="The transcript is there and could not be read."
          why={view.why}
          detail={
            view.path === null ? null : (
              <p className="tw:mt-1 tw:text-[12px] tw:break-all tw:text-ink-faint">
                <Mono>{view.path}</Mono>
              </p>
            )
          }
          said="said by the dashboard server"
        />
      ) : (
        <Refusal
          head="This page could not get an answer it understands."
          why={view.why}
          detail={
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
              That is not the same as the server saying there is nothing to read — it means the reply never
              arrived or was not this API, so nothing here is a claim about the session.
            </p>
          }
          said="said by this browser"
        />
      )}

      <p className="tw:mt-2">
        <Button onClick={read} disabled={busy}>
          {busy ? "Reading…" : "Read again"}
        </Button>
      </p>
    </div>
  );
}
