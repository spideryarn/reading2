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
 *     inside, and until 2026-09-09 this age comparison was the only thing that
 *     could: a question in violet, and the single most valuable line in the
 *     section. **The execution reading can now answer it outright**, so
 *     `StaleNote` reports rather than guesses — it withdraws on a verified
 *     conversation, and a `conflicting` one is drawn as the settled fact it is
 *     by `PreviousConversation`. The age comparison stands wherever the box
 *     could not tell, which on a loaded box is most of the time.
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
 * session is open, and `SessionDetail` is keyed by the session and its
 * execution (continuity.ts), so switching sessions is a fresh mount and exactly
 * one more read.
 *
 * **THE READER DOES NOT RELY ON THAT, and `identityOf` below is why.** This
 * hook is exported, and its identity is *the* answer to "which agent is this a
 * reading about". Leaving that answer wrong because one caller happens to
 * remount would be a correct page resting on a caller's good manners — the
 * shape § F18 further down already refused once.
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
  type MessageTurn,
  type MessagesApi,
  type MessagesView,
} from "./messages-client";
import { Explain } from "./Tooltip";
import { Turn } from "./Turn";
import { useExecutionEpoch } from "./continuity";
import type { FleetRow } from "./types";
import type { ExecutionReading } from "../../wire.js";
import { Button, Mono } from "./ui";
import { formatDuration } from "./view";

/** Bytes, coarsely. A ratio is the point of this, not a byte count. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
 * **The one check on the hazard the reader cannot see from inside — and it now
 * REPORTS rather than guesses.**
 *
 * Drawn in the violet this tool reserves for *nobody could tell*, not in the
 * alarm red, because it is a question rather than a verdict: a working session
 * can be silent for half an hour on one long tool call. What it does is make
 * the wrong answer visible, and the wrong answer here is a real conversation
 * that is not this one.
 *
 * **IT WITHDRAWS ON A VERIFIED CONVERSATION, because its hazard has then been
 * disproved rather than merely not observed.** The question it asks in violet —
 * *is this pane still running the conversation the row names?* — is exactly the
 * question the execution pass answers, and when the answer is `verified` the
 * live harness's own `--session-id` matched the claim. Everything the note goes
 * on to say about `CLAUDE_SESSION_ID` being written once and never rewritten is
 * still true and no longer bears on this pane, so saying it would be crying
 * wolf on the rows we can actually vouch for. Anything short of `verified`
 * leaves it standing exactly as it was written: on this box *nobody could tell*
 * is the weather, not evidence, and a note that only appeared when we had proof
 * of trouble would never appear at all. Fable's ruling, docs/plans/260910c §
 * Withhold, caveat or relabel.
 *
 * **The `conflicting` arm does NOT come out here.** That is not this note's
 * hazard being confirmed; it is a different, established fact, and it is drawn
 * once at the top of the panel by `PreviousConversation` rather than as a
 * caveat beside one turn.
 */
function StaleNote({ ms, execution }: { ms: number; execution: ExecutionReading }): ReactNode {
  if (execution.kind === "verified" && execution.conversation.kind === "verified") return null;
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

/**
 * **THE TURNS BELOW ARE THE PREVIOUS CONVERSATION IN THIS PANE — relabelled,
 * not hidden.**
 *
 * `conflicting` is the arm the execution stage was built for: the tmux
 * environment claims one uuid and the live process's argv carries another, so a
 * fresh Claude has been started under an unchanged pane. The transcript route
 * resolves the row from its handle and hands the reader that row's
 * `claudeSessionId` (server.ts), so it reads the CLAIMED conversation's file:
 * the turns are real, well formed and correctly attributed — to the agent that
 * has gone. That is also why the reading's identity names the claim; see
 * `identityOf`.
 *
 * **So what is withheld is the implication, not the content.** A cross-family
 * review wanted the whole panel blanked on any reading that was not verified;
 * Fable arbitrated and set the rule this follows: *withhold what you would be
 * inventing, caveat what you have but cannot place, relabel what you have and
 * can place somewhere else.* These turns can be placed exactly — we know whose
 * they are and we know they are not the pane's current state — and *"what did
 * the old one say before it died"* is a question people ask. Hiding them would
 * destroy the only surviving account of it to avoid a misunderstanding a
 * heading fixes. docs/plans/260910c § Withhold, caveat or relabel.
 *
 * Alarm tone rather than the violet, and that is the whole difference from
 * `StaleNote`: this is not *nobody could tell*, it is a fact that arrived.
 */
function PreviousConversation({
  claimed,
  observed,
  current,
}: {
  claimed: string;
  observed: string;
  /** Whether this payload re-established the conflict, rather than merely failing to refute it. */
  current: boolean;
}): ReactNode {
  return (
    <div className="tw:mb-2 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px]">
      <p className="tw:font-medium tw:text-alarm-ink">
        {current
          ? "These are the previous conversation in this pane, not what is running now."
          : "These are the previous conversation in this pane; the latest pass could not re-check what is running now."}
      </p>
      <p className="tw:mt-1 tw:break-words tw:text-ink-soft">
        Every address on this row still names <Mono>{claimed}</Mono>, and {current ? "the box can see" : "the last verified reading found"} that the pane is
        running <Mono>{observed}</Mono> — a different Claude was started here since this session was launched.
        The turns below come from {claimed === "" ? "that conversation" : <Mono>{claimed}</Mono>}: real, well
        formed and correctly attributed
        {current
          ? ", and not what is on that screen."
          : ". The latest pass did not establish whether that is still what is on screen."}
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

/**
 * The newest turn on its own, with the one caveat that qualifies it.
 *
 * **The stale note comes up here and the provenance does not**, which is the
 * same cut `Found` already argued for one level down: how much of the file we
 * read changes what you BELIEVE about the turns, and the age changes what you
 * DO. A turn shown at the top of the page as the current state of a session is
 * exactly where "this may be much older than it looks" has to be readable
 * without opening anything.
 */
/**
 * The newest turn we could read, and every caveat that changes what you would
 * DO about it.
 *
 * **Four of the five things here were found by a cross-family review of the
 * first version (F13–F16), and they are all the same mistake**: this section
 * moved to the top of the page, where a sentence is read as the session's
 * current state, and it went on saying things that were only ever true of a
 * footnote. Each is now qualified where it is read rather than where it was
 * written.
 */
function Latest({ view, row, now }: { view: MessagesView & { kind: "found" }; row: FleetRow; now: number }): ReactNode {
  const age = transcriptAge(view.lastModified, row.status, now);
  const newest = view.turns[view.turns.length - 1];

  /* THE CAVEATS COME FIRST AND ARE DRAWN WHETHER OR NOT THERE IS A TURN. The
     first version returned early on an empty read and skipped the stale
     warning it had already computed (F13) — so the emptiest, least certain
     reading was the one shown with the fewest qualifications. */
  const caveats = (
    <>
      {age.kind === "suspect" ? <StaleNote ms={age.ms} execution={row.execution} /> : null}


      {/* PROMOTED OUT OF THE PROVENANCE (F15). Which file is live changes what
          you DO — steering on this message may answer a different conversation
          — and by this file's own rule that puts it beside the turn rather than
          inside a closed disclosure. The byte counts and the path stay down
          there, because they only change what you believe. */}
      {view.copies !== null && view.copies !== 1 ? (
        <p className="tw:mt-1 tw:text-[13px] tw:text-unknown-ink">
          {view.copies} files carry this conversation id, and which of them is the live one is not something this
          page can tell. Anything you send from here may reach a different conversation.
        </p>
      ) : null}

      {/* PROMOTED FOR THE SAME REASON (F14), and this one is sharper than it
          looks. `parseRecentMessages` drops a turn it cannot read and keeps
          only a COUNT — the position is lost — so the last readable turn is not
          necessarily the last turn, and the one below may not be the newest
          thing this session said. */}
      {view.unreadableTurns > 0 ? (
        <p className="tw:mt-1 tw:text-[13px] tw:text-unknown-ink">
          {view.unreadableTurns} {view.unreadableTurns === 1 ? "turn came" : "turns came"} back in a shape this page
          could not read. This is the latest turn it COULD read, and one of the missing ones may be newer.
        </p>
      ) : null}
    </>
  );

  if (newest === undefined) {
    return (
      <div>
        {caveats}
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">
          {!view.turnsOffered
            ? "The server said it found the transcript and then sent no turns at all. That is not an empty conversation; it is an answer this page cannot read."
            : view.unreadableTurns > 0
              ? "No turns could be read. That is not the same as a session that has said nothing — every turn the server sent came back in a shape this page could not read."
              : view.reachedStartOfFile === true
                ? "The transcript was read from its beginning and there are no turns in it. That is a file that exists and has nothing to say — a session that has not spoken yet."
                : /* F13: `false` says outright that the read did not reach the
                     start, and `null` makes no claim at all. Neither
                     establishes silence, and this used to say it had. */
                  "No turns were found in the part of the transcript that was read, and the read did not reach the beginning of the file — so this is not evidence that the session has said nothing."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {caveats}
      <ul className="tw:mt-1">
        <Turn turn={newest} />
      </ul>
    </div>
  );
}

/**
 * EVERYTHING OLDER, AND EVERYTHING ABOUT WHERE THE TURNS CAME FROM.
 *
 * A native `<details>`, which is the pattern this client already uses five
 * times for "hide the bulky thing behind a control" — Rename and Where it is in
 * SessionDetail, `TheWords` in ActionButtons, and the attention evidence.
 * Greg asked for "a popup panel or something"; a disclosure is the cheaper end
 * of that and there is no dialog component in this client to reach for. If it
 * reads badly on a phone the answer is a screenshot, not an argument.
 *
 * **Closed by default and therefore not read**, so nothing that changes what
 * you believe about the turn *above* may live only in here — that is why the
 * stale note is upstairs and only the provenance is down here.
 */
function EarlierMessages({
  view,
  row,
  now,
}: {
  /** ONLY the `found` arm (F18). See `Conversation` for why this is narrowed. */
  view: MessagesView & { kind: "found" };
  row: FleetRow;
  now: number;
}): ReactNode {
  const older = view.turns.slice(0, -1);

  return (
    <details className="tw:mt-3">
      {/* DRESSED AS A CONTROL, NOT AS A HEADING — and the first version of this
          was the heading, which is why the note is here. It copied *Where it
          is*'s summary styling (11px, uppercase, tracking-widest, ink-faint),
          which is right for a section label and wrong for the one thing on this
          page Greg explicitly asked to be a button. A browser check at 390px
          reported it sitting between LATEST MESSAGE and SAY SOMETHING TO IT
          looking like a third section label, with nothing but the native 8px
          triangle to say otherwise — and `cursor: pointer` says nothing at all
          on a phone. Sentence case, a border and a panel fill, at reading size. */}
      <summary className="tw:cursor-pointer tw:rounded-md tw:border tw:border-rule-strong tw:bg-panel tw:px-2 tw:py-1.5 tw:text-[13px] tw:text-ink-soft tw:hover:text-ink">
        {older.length === 0
          ? "Where this came from"
          : `${older.length} earlier message${older.length === 1 ? "" : "s"}, and where they came from`}
      </summary>
      {/* CAPPED, WITH ITS OWN SCROLL. Opening this inline pushed the composer
          ~2,600px down the page at 390px — measured, y=1576 to y=2841 — so
          reading back through the conversation and then replying was a long
          scroll each way. A capped panel is also closer to the "popup panel"
          Greg asked for than an unbounded expansion is, so this costs nothing
          in fidelity to the request. Measured after: +548px at 1280 and +515px
          at 390, against +1265px uncapped.

          THE BORDER IS THE POINT, NOT THE DECORATION. The first version of the
          cap had none, and a browser check found what that caused: this box
          scrolls under overlay scrollbars, so `offsetWidth - clientWidth` is 0
          — no gutter, no persistent bar, and nothing else marking the bottom
          edge. The last visible turn simply stopped and the next section
          began, and at 390px the cut landed mid-turn, so a panel with six more
          messages inside it read as A CONVERSATION THAT ENDS HERE. That is
          this tool's own failure mode wearing a new hat: an absence rendering
          as a fact. A boundary the same shape as the control that opened it
          makes the cut legible as a cap rather than as an ending. */}
      <div className="tw:mt-2 tw:max-h-[60vh] tw:overflow-y-auto tw:rounded-md tw:border tw:border-rule tw:px-2">
        <Found view={view} row={row} now={now} turns={older} />
      </div>
    </details>
  );
}

function Found({
  view,
  row,
  now,
  turns,
}: {
  view: MessagesView & { kind: "found" };
  row: FleetRow;
  now: number;
  /** The turns this block draws — the newest one is drawn by `Latest` instead. */
  turns: MessageTurn[];
}): ReactNode {
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

      {/* The stale note is NOT here — it is drawn beside the newest turn by
          `Latest`, because this block is closed by default and a caveat nobody
          opens is a caveat nobody has. */}

      {view.copies !== null && view.copies !== 1 ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-unknown-ink">
          {view.copies} files carry this conversation id. The one read is named below; which of them is the live
          one is not something this page can tell.
        </p>
      ) : null}

      {/* THE SENTENCE HERE BRANCHES ON THE TOTAL, NOT ON THE SLICE (F16). An
          empty slice has two causes that mean opposite things: one turn was
          read and it is above, or NOTHING was read and the thing above is an
          empty-state sentence. The first version said "the message above is the
          only turn read" for both, which on a zero-turn view directly
          contradicted the sentence it was pointing at. */}
      {turns.length === 0 ? (
        <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">
          {view.turns.length === 0
            ? "No turns were read, so there is nothing earlier to show."
            : "Nothing earlier — the message above is the only turn read."}
        </p>
      ) : (
        <ul className="tw:mt-2">
          {turns.map((turn, i) => (
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
 * **WHICH READING THIS IS — the run it was fetched for, and the file it is
 * actually of.**
 *
 * Two halves, and each answers a question the other cannot:
 *
 *  - **The run** — `useExecutionEpoch`'s key, which carries `row.id` and
 *    advances only when the process in the pane is *verifiably replaced*. A pane
 *    keeps its handle across a `gjd-remote resume`, a relaunch, a second
 *    `claude` in the same window, and the handle alone agreed with itself
 *    through all of them (roadmap finding E-session). The same machinery that
 *    keys the detail pane, deliberately rather than a second definition of
 *    "the same run" — and held here as well as there because this hook is
 *    exported, so its answer must not rest on a caller happening to remount it.
 *  - **The file** — `row.claudeSessionId`, the launch CLAIM. Not because the
 *    claim is the truth about the pane (it often is not) but because it is
 *    **what is fetched**: `/api/messages` resolves the row from its handle and
 *    hands `readRecentMessages` the row's `claudeSessionId` (server.ts). An
 *    identity naming anything else would be a label on a file it is not of.
 *
 * **THE FIRST VERSION OF THIS NAMED THE OBSERVED CONVERSATION, and it was
 * wrong in exactly the arm it was written for.** On a `conflicting` reading it
 * returned the observed id D while the server went on returning the claimed
 * conversation C's file, so it held *C's turns under D's name*. Then the claim
 * caught up — claim D, verified D, same run — the identity did not move,
 * nothing was re-read, and C's turns sat on screen with neither the relabel
 * (nothing conflicting any more) nor the stale note (now verified): the
 * previous conversation shown as the current one, uncaveated. The coordinator's
 * review of Stage 1, 2026-09-10; a test in fleet-web.test.tsx walks that exact
 * sequence.
 *
 * **THE READING'S KIND IS NOT IN THE VALUE, and that is the design rather than
 * an omission.** Folding it in would make `verified → unknown → verified` three
 * identities, and on a loaded box that flicker is a collection or two apart —
 * so a disk read of a multi-megabyte transcript would land on the sixty-second
 * refresh loop, the one thing this section must not do. The epoch already
 * survives the flicker; what the kind changes is how the turns are LABELLED,
 * and that is decided where they are drawn, from the current reading
 * (`PreviousConversation`, `StaleNote`).
 *
 * A string rather than an object because it is compared, not read, and because
 * both consumers below need a value a `useEffect` dependency array can compare
 * with `Object.is`. `\u0000` cannot occur in either half.
 *
 * An empty second half is a real value here and not a wildcard: a row with no
 * conversation id is a shell or a legacy session, and two of those in one run
 * are still the same reading — there is nothing to tell them apart with, and
 * inventing a difference would re-read on every snapshot.
 */
function identityOf(epochKey: string, row: FleetRow): string {
  return `${epochKey}\u0000${row.claudeSessionId ?? ""}`;
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
  /* Called unconditionally, before anything else can return — it is a hook. */
  const epochKey = useExecutionEpoch(row);
  const identity = identityOf(epochKey, row);

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
   * **The identity is passed in, not recomputed from `asked`.** The run half
   * comes out of a hook, which cannot be called from a closure, and the value
   * that matters is the one the render that ASKED had — a closure may be older
   * than the current render, and recomputing from a newer row would label an
   * old read with a new name.
   */
  const begin = useCallback(
    (asked: FleetRow, askedFor: string): void => {
      newest.current += 1;
      const token = newest.current;
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
   * `identity` is a string built from the run's epoch and the claim, so an
   * unchanged snapshot — and an execution reading that flickers unverifiable
   * and back — produces an equal value and re-reads nothing.
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
    begin(row, identity);
  }, [begin, identity]);

  /**
   * **THE PAIRING IS CHECKED HERE, WHERE IT IS DRAWN.** A reading of somebody
   * else is not a reading of this row, whatever state holds it, so it is never
   * handed out. `busy` is not gated the same way: a read really is in flight,
   * and the panel says so.
   */
  const view = held !== null && held.identity === identity ? held.view : null;

  return { view, busy, read: () => begin(row, identity) };
}

/**
 * THE CONVERSATION: the newest turn we could read, then everything older.
 *
 * **ONE exported component owning the exhaustive switch, not two (F18).** The
 * first version exported the two halves separately, and although the only
 * caller paired them correctly, the *API* let a future consumer render the
 * earlier-messages half alone — which returns `null` for every refusal state
 * and would have flattened all four of them into a blank. The pairing is now a
 * property of the module rather than of the caller's good manners, and
 * `EarlierMessages` takes only the `found` arm, so "render the history without
 * the refusals" is not expressible.
 *
 * Greg, 2026-09-09: *"show the most recent message (perhaps with a summary if
 * idle) prominently near the top, with the input-box and command-lists
 * underneath"*. So the conversation moved from the bottom of the page to the
 * second section, and split in two: the last thing the agent said is what you
 * came to read, and the eleven turns before it are what you open when that is
 * not enough.
 *
 * **THE REFUSALS COME UP HERE WITH IT, and that is the load-bearing half of the
 * split.** `not-found`, `unreadable`, `no-answer` and *not read yet* are the
 * states in which there is no latest message, and if they had stayed downstairs
 * with the provenance the top of the page would render **nothing** — which reads
 * as a session that has said nothing rather than as a transcript we could not
 * read. A reading that could not be taken must not render as silence any more
 * than it may render as a reading
 * (docs/project/overseer-direction.md § A higher bar for robustness).
 */
export function Conversation({
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
  /* **ABOVE EVERY ARM, INCLUDING THE REFUSALS.** It is a statement about the
     pane rather than about the turns, so it is as true of "there is no
     transcript to read" as it is of twelve messages — and on a refusal it is
     the only thing on screen that explains why. `conflicting` is reachable from
     the `verified` arm and from nowhere else; wire.ts § `ExecutionReading` says
     so, and a check on the `claimed-only` arm would be dead code. */
  const observedConflict =
    row.execution.kind === "verified" && row.execution.conversation.kind === "conflicting"
      ? row.execution.conversation
      : null;
  /* A failed collection is not evidence that a previously established conflict
     ended. Hold that fact through unverifiable weather, but clear it in the
     render where a verified conversation positively re-establishes coherence.
     The guarded render-phase updates keep the relabel and its evidence in the
     same committed frame. */
  const [lastConflict, setLastConflict] = useState(observedConflict);
  let changedHands = observedConflict;
  let conflictIsCurrent = observedConflict !== null;
  if (observedConflict !== null) {
    if (
      lastConflict === null ||
      lastConflict.claimed !== observedConflict.claimed ||
      lastConflict.observed !== observedConflict.observed
    ) {
      setLastConflict(observedConflict);
    }
  } else if (row.execution.kind === "verified" && row.execution.conversation.kind === "verified") {
    if (lastConflict !== null) setLastConflict(null);
  } else {
    changedHands = lastConflict;
    conflictIsCurrent = false;
  }

  return (
    <div>
      {changedHands === null ? null : (
        <PreviousConversation
          claimed={changedHands.claimed}
          observed={changedHands.observed}
          current={conflictIsCurrent}
        />
      )}
      {view === null ? (
        <p className="tw:text-[13px] tw:text-ink-soft">
          {busy ? "Reading the tail of this session's transcript…" : "Not read yet."}
        </p>
      ) : view.kind === "found" ? (
        <>
          <Latest view={view} row={row} now={now} />
          <EarlierMessages view={view} row={row} now={now} />
        </>
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
