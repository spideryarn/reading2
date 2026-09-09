/**
 * "Recent messages" — the last N messages across every session, newest first.
 *
 * **Greg, 2026-09-08:** *"add a 'Recent messages' tab with a rolling window of
 * the last N messages across all agents (making it easy to filter)"*.
 *
 * ## WHAT THIS ANSWERS THAT THE DETAIL PANE DOES NOT
 *
 * `RecentMessages.tsx` answers *is this row telling me the truth?* — one
 * session, chosen by the reader. This answers *what is the fleet saying*,
 * without picking a row first. Eighteen sessions on the box and no other way to
 * read across them but eighteen taps.
 *
 * ## THE THING THIS PANEL MUST NOT DO
 *
 * Show a message under a session's name as though the attribution were settled,
 * or show a short list as though it were a complete one. **The reader was never
 * watching these sessions**, so nothing on screen contradicts a wrong answer —
 * which is the whole reason `attribution` and `coverage` are on the wire.
 * Three rules follow, and each has a test:
 *
 *  1. A session whose transcript could not be read is **a row saying so**, not
 *     an absence. Nine of 21 rows on the box are shells and scheduled sessions;
 *     a feed that omitted them would show a fleet of twelve and look complete.
 *  2. A `suspect` attribution is drawn **on the message**, not tucked into a
 *     footnote — it means these may be somebody else's words.
 *  3. `coverage` is printed as a headline whenever it is `indeterminate`.
 *     "The last 50" that is quietly the last 50 of what fitted in a byte budget
 *     is the failure this feature is most exposed to, and an unreadable session
 *     can hold all of the newest messages — so the qualification belongs to the
 *     whole list, never to a row inside it.
 *
 * ## NOT POLLED
 *
 * A refresh costs the box ~250 ms and about 10 MB of transcript reads; the
 * answer itself is only 40 kB (8 kB gzipped). **The disk is what decides the
 * cadence, not the wire.** Fetched when the tab opens and when the reader asks,
 * never on a timer — routes-recent-feed.ts § cadence.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string drawn here is agent-authored text. React escapes it; nothing
 * here adds markup. `Turn.tsx` draws the turns and carries the same rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { zonedLine } from "../../zones.js";

import { StatusPill } from "./SessionParts";
import { SPEAKERS } from "./Turn";
import { Explain } from "./Tooltip";
import {
  NO_FILTERS,
  applyFilters,
  httpFeedApi,
  sessionStatusOf,
  turnAge,
  type FeedApi,
  type FeedFilters,
  type FeedRow,
  type FeedSessionStatus,
  type FeedView,
  type SessionListReading,
} from "./feed-client";
import type { MessageSpeaker } from "./messages-client";
import type { ClockSkew } from "./types";
import { Button, Card, Mono, SectionHeading, cx, toneClasses } from "./ui";
import { formatDuration, statusLabel } from "./view";

/** The speakers offered as filter chips, in the order a reader thinks of them. */
const FILTERABLE: MessageSpeaker[] = [
  "human",
  "assistant",
  "peer",
  "notification",
  "compact-summary",
  "injected",
  "api-error",
  "system",
  "unrecognised",
];

/* ------------------------------------------------------------------ *
 * The reading.
 * ------------------------------------------------------------------ */

export type FeedReading =
  | { kind: "loading" }
  | { kind: "ready"; view: FeedView };

/**
 * Fetch once on mount, and again when asked.
 *
 * **A ref guards against a late answer overwriting a newer one.** Two refreshes
 * in flight can land out of order, and the older one arriving second would put
 * a stale feed on screen with no way to tell — the same hazard `useRecentMessages`
 * handles, and it matters more here because there is no per-session identity to
 * notice the swap.
 */
export function useFeed(api: FeedApi, limit: number): { reading: FeedReading; refresh: () => void; busy: boolean } {
  const [reading, setReading] = useState<FeedReading>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setBusy(true);
    void api.recent(limit).then((view) => {
      if (mine !== generation.current) return;
      setReading({ kind: "ready", view });
      setBusy(false);
    });
  }, [api, limit]);

  useEffect(() => {
    load();
    /* On unmount, bump the generation so an answer still in flight is ignored
       rather than setting state on a component that is gone. */
    return () => {
      generation.current += 1;
    };
  }, [load]);

  return { reading, refresh: load, busy };
}

/* ------------------------------------------------------------------ *
 * The parts.
 * ------------------------------------------------------------------ */

/** A chip that toggles. The whole filter UI is these, because a thumb wants targets. */
function Chip({
  on,
  onClick,
  children,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cx(
        "tw:inline-flex tw:h-7 tw:shrink-0 tw:items-center tw:rounded-full tw:border tw:px-2.5",
        "tw:text-[12px] tw:whitespace-nowrap tw:transition-colors",
        on ? "tw:border-work-ink tw:bg-work-wash tw:text-work-ink" : "tw:border-rule tw:text-ink-soft",
      )}
    >
      {children}
    </button>
  );
}

/**
 * What the feed could not read, and what it may therefore be missing.
 *
 * **Drawn above the messages**, because it qualifies every one of them. A note
 * about completeness underneath a list is a note most people never scroll to.
 */
function Caveats({ view }: { view: FeedView & { kind: "feed" } }): ReactNode {
  const unread = view.sessions.filter((s) => s.read.kind !== "read");
  const gaps = view.coverage.kind === "indeterminate" ? view.coverage.reasons : [];
  if (gaps.length === 0 && unread.length === 0 && view.unreadableRows === 0) return null;
  return (
    <Card className="tw:mt-2 tw:px-3 tw:py-2">
      {gaps.length > 0 ? (
        <>
          {/* **THE HEADLINE, NOT A FOOTNOTE.** An unreadable session can hold
              all of the newest messages, so the qualification belongs to the
              whole list rather than to a row inside it. */}
          <p className="tw:text-[12px] tw:font-semibold tw:text-alarm-ink">
            This may not be the last {view.limit ?? "N"} messages.
          </p>
          <ul className="tw:mt-1 tw:space-y-0.5">
            {gaps.map((reason, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a coverage reason has no id, and this list is rebuilt whole on every fetch — never reordered or filtered — so the index is a stable identity within one answer.
              <li key={`${reason.sessionId}-${reason.kind}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
                {reason.name === "" ? null : <Mono>{reason.name}</Mono>}
                <span className={reason.name === "" ? "" : "tw:pl-2"}>{reason.why}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {view.unreadableRows > 0 ? (
        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">
          {view.unreadableRows} {view.unreadableRows === 1 ? "message" : "messages"} in this answer could not be read by
          this page and {view.unreadableRows === 1 ? "is" : "are"} not shown.
        </p>
      ) : null}
      {unread.length > 0 ? (
        <details className="tw:mt-1">
          <summary className="tw:cursor-pointer tw:text-[12px] tw:text-ink-faint">
            {unread.length} of {view.sessions.length} sessions had no readable transcript
          </summary>
          <ul className="tw:mt-1 tw:space-y-1">
            {unread.map((s) => (
              <li key={s.sessionId} className="tw:text-[12px] tw:text-ink-soft">
                <Mono>{s.name}</Mono>
                <span className="tw:pl-2 tw:text-ink-faint">
                  {s.read.kind === "not-found" ? s.read.why : s.read.kind === "unreadable" ? s.read.why : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

const ATTRIBUTION_TIP = {
  head: "Whose words are these?",
  what: "Which session the dashboard read this message from, and how sure it is that the session is still that conversation.",
  how: "A pane's conversation id is pinned when the pane is made and never updated, so a re-used pane reads the previous conversation — real messages, correctly attributed, and not this agent's.",
};

/**
 * The first line of a message, and whether there is more.
 *
 * A line rather than a character count: the feed is scanned, and the first line
 * of an agent's turn is almost always the sentence that says what it is doing.
 */
export function firstLine(text: string): { head: string; rest: boolean } {
  const cut = text.indexOf("\n");
  if (cut === -1) return { head: text, rest: false };
  return { head: text.slice(0, cut), rest: text.slice(cut + 1).trim() !== "" };
}

/**
 * What the session this message came from is doing — **the Sessions list's own
 * answer, drawn with the Sessions list's own component.**
 *
 * `StatusPill` rather than a chip of this panel's own: it carries the tone map,
 * the vocabulary and the per-status tooltips, so the two tabs cannot drift into
 * calling the same state two things. feed-client.ts § `FeedSessionStatus` has
 * the argument for reading it out of the live rows rather than off `/api/feed`.
 *
 * **Every arm that is not a status is words, not silence.** The reader was never
 * watching these sessions, so an unlabelled row is one they would read as fine.
 */
function SessionStatus({ status }: { status: FeedSessionStatus }): ReactNode {
  if (status.kind === "listed") return <StatusPill status={status.row.status} />;
  const said = ((): { label: string; what: string; how: string } => {
    switch (status.kind) {
      case "not-arrived":
        return {
          label: "session list has not arrived",
          what: "This page has not received a session list, so it cannot say what this session is doing now.",
          how: "The messages come from /api/feed, which is read when this tab opens; the statuses come from /api/state, which is polled. Until the first of those lands there is nothing to look this session up in.",
        };
      case "not-collected":
        return {
          label: "no session census yet",
          what: "The dashboard has answered, but it has not finished a collection — so it does not yet know which sessions exist.",
          how: "The first collection after a restart takes about ten seconds. This is not an empty fleet; it is a fleet nobody has looked at yet.",
        };
      case "unverifiable":
        return {
          label: "status not checked",
          what: status.why,
          how: "A tmux session handle like $1643 is only meaningful inside one tmux server, so this page will not read a status off a handle it cannot place — it would be some other session's. The link is still here, because the session it opens says its own name and handle.",
        };
      case "different-world":
        return {
          label: "cannot be matched to a session",
          what: status.why,
          how: "A tmux session handle like $1643 is only meaningful inside one tmux server. These two answers name different ones, so every handle in the older of them now belongs to somebody else — which is why there is nothing to click.",
        };
      default: {
        /* **NOT-LISTED IS TWO CLAIMS, and which one it is depends on whether
           the payload was wholly readable.** With rows dropped, "this session
           is not on the box" is more than the page knows: it can only say the
           session is not in the part of the list it could read. */
        const partial = status.unreadableRows > 0;
        return {
          label: partial ? "not in the readable session list" : "not in the current session list",
          what: partial
            ? `This session was not among the rows this page could read, and ${status.unreadableRows} row${status.unreadableRows === 1 ? "" : "s"} in the last session list could not be read at all — so it may be running and merely unreadable.`
            : "The last session list this page received holds no session with this handle. The feed's census of the fleet is taken before the session list's, so a session really can have gone between the two.",
          how: "The message above is still real: it was read from that session's transcript. What cannot be said is what the session is doing now.",
        };
      }
    }
  })();
  return (
    <Explain tip={{ head: "What this session is doing", what: said.what, how: said.how }} placement="bottom">
      <span className="tw:font-semibold tw:tracking-wide tw:uppercase tw:text-unknown-ink">{said.label}</span>
    </Explain>
  );
}

/**
 * How long ago this turn was written — and, on the tooltip, the instant itself
 * in all three zones.
 *
 * **An age is what a reader scans; an ISO string is what they parse.** The row
 * carried `2026-09-09T04:17:22.118Z` before this, which answers *when* only
 * after arithmetic nobody does at a glance. The exact instant does not go away:
 * it moves into the tooltip, where `Explain` also puts it in the accessible
 * name.
 *
 * **The age is shifted onto this device's clock and the instant is not** —
 * feed-client.ts § `turnAge` and GPT Sol's K4 in messages-client.ts. Both
 * come off the same `at`.
 */
function TurnAge({ at, now, skew }: { at: string | null; now: number; skew: ClockSkew }): ReactNode {
  /* **MEMOISED ON THE TIMESTAMP, because the page re-renders every second.**
     `zonedLine` runs three `Intl.DateTimeFormat`s, and at the 200-message limit
     that is 600 of them a second for a string that cannot have changed. The
     Deploys panel measured the same un-memoised work at 110–126 ms per second
     over 200 rows; GPT Sol raised it here before it was written. */
  const zoned = useMemo(() => (at === null ? null : zonedLine(at)), [at]);
  if (at === null) return null;
  const age = turnAge(at, now, skew);
  /* A timestamp this page cannot parse is shown as it came rather than dropped:
     the server said something, and swallowing it would leave the row looking
     like one that carried no time at all — which is a different thing, and has
     its own group at the foot of the panel. */
  if (age.kind === "unplaceable") return <span className="tw:text-ink-faint">{at}</span>;
  /* **AN UNMEASURED SKEW IS LABELLED, NOT HEDGED.** Before the first state
     payload the masthead prints no clock note at all (Header.tsx), and this tab
     has its own route — so it can be on screen with an age nothing else on the
     page qualifies.

     This was the word "about" for a review round, and GPT Sol was right to
     refuse it: an unknown skew is not a small error, it is an error nobody has
     bounded, so "about 2m ago" may be hours out and "about" quietly promises it
     is not. The number still earns its place — it is right whenever the clocks
     agree, which is nearly always — but what it is gets said beside it in
     words. */
  const uncorrected = skew.kind !== "known";
  return (
    <Explain
      tip={{
        head: "When this was written",
        what: zoned ?? at,
        how:
          skew.kind === "known"
            ? "The age is measured against this device's clock; the times above are the box's own, unshifted."
            : "This device's clock has not been checked against the box's, so the age is the box's timestamp subtracted from this device's clock as though they agree. Nothing has bounded how far apart they are. The times above are the box's own.",
      }}
      placement="bottom"
    >
      {age.kind === "ahead" ? (
        /* **A TURN STAMPED IN THE FUTURE IS A FINDING, not a zero.** Clamping it
           to "0s ago" would hide a clock disagreement behind the most reassuring
           answer on the row. */
        <span className="tw:text-unknown-ink">{formatDuration(age.ms)} ahead of this device's clock</span>
      ) : (
        <span className="tw:text-ink-faint">
          {formatDuration(age.ms)} ago
          {uncorrected ? <span className="tw:pl-1 tw:text-unknown-ink">clocks not compared</span> : null}
        </span>
      )}
    </Explain>
  );
}

/**
 * One row: the session it came from, then the message, collapsed to its first
 * line until it is opened.
 *
 * **This does NOT reuse `Turn` from Turn.tsx, and that is deliberate.** The two
 * surfaces want different bodies — the detail pane shows a whole turn at its
 * absolute timestamp, and this shows a first line with provenance and an
 * attribution reading beside it. Passing a `collapsed` prop into one component
 * to serve both would be the conditional-prop component GPT Sol warned about
 * (P2.4), harder to read than two small bodies.
 *
 * **What IS shared is `SPEAKERS`**, which is the part that matters: a nine-arm
 * map in which `compact-summary` and `injected` are machine-written text
 * wearing a person's role. A second copy of *that* is how a fabricated recap
 * ends up on screen as something a person said — the argument
 * `dashboard-titles-descriptions-detail` made when it asked for the extraction,
 * and it is fully satisfied by sharing the map.
 */
function Row({
  row,
  status,
  now,
  skew,
  feedTmuxServerPid,
  onOpenSession,
}: {
  row: FeedRow;
  status: FeedSessionStatus;
  now: number;
  skew: ClockSkew;
  /** Which tmux server this feed read, so the click can carry it. */
  feedTmuxServerPid: number | null;
  onOpenSession: ((id: string, tmuxServerPid: number | null) => void) | null;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const who = SPEAKERS[row.turn.speaker];
  const { head, rest } = firstLine(row.turn.text);
  return (
    /* **THE LEFT EDGE IS THE SESSION'S STATUS TONE**, the same `tone.edge` a
       `SessionCard` carries. It is what turns "which of these are from sessions
       that are still working" from a word on each row into a colour you sweep —
       and every arm that is not a status takes the `unknown` edge rather than none,
       because a row with no edge would read as the calm end of the scale. */
    <li
      className={cx(
        "tw:border-t tw:border-rule tw:border-l-4 tw:py-2 tw:pl-2 tw:first:border-t-0",
        toneClasses(status.kind === "listed" ? statusLabel(status.row.status).tone : "unknown").edge,
      )}
    >
      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:gap-y-1 tw:text-[11px]">
        <SessionStatus status={status} />
        {/* **THE SESSION NAME IS THE WAY IN, AND THE ROW IS NOT.** Greg,
            2026-09-09: *"click to be taken to that session in Sessions"*. A
            row-sized click target would swallow the expand control below and
            any attempt to select the agent's own words, which on this tab is
            most of what a reader does with a row. The name is what somebody
            points at when they mean "that one". */}
        {/* **AND THE WAY IN IS WITHHELD WHEN THE HANDLES ARE PROVABLY NOT THE
            SAME WORLD.** `sel` addresses a session by the same tmux handle, so
            a click here would select whatever now wears it — a different
            conversation, opened confidently. The status beside it says why
            there is nothing to click.

            **`unverifiable` KEEPS ITS LINK, and that asymmetry is the point.**
            Not knowing is not proof, and a server that predates
            `tmuxServerPid` answers that way for every row — so treating the two
            alike would switch the whole feature off against it, permanently and
            for no evidence. feed-client.ts § `FeedSessionStatus`. */}
        {onOpenSession === null || status.kind === "different-world" ? (
          <Mono>{row.sessionName}</Mono>
        ) : (
          <button
            type="button"
            /* **THE HANDLE AND THE WORLD IT BELONGS TO, TOGETHER.** Passing the
               handle alone is what made the pid gate cosmetic: it proved the
               join safe HERE and then threw away the proof, leaving the
               destination to resolve `$1643` against whatever tmux server it
               happens to be looking at by the time it renders. `null` when this
               feed named no server, which is what makes the destination decline
               to select rather than guess. GPT Sol's P0 on the code review. */
            onClick={() => onOpenSession(row.sessionId, feedTmuxServerPid)}
            aria-label={
              feedTmuxServerPid === null
                ? `Show Sessions — ${row.sessionName} cannot be selected from here`
                : `Open the session ${row.sessionName} in Sessions`
            }
            className="tw:rounded tw:underline tw:decoration-dotted tw:underline-offset-2 tw:hover:text-ink"
          >
            <Mono>{row.sessionName}</Mono>
          </button>
        )}
        <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
        <TurnAge at={row.turn.at} now={now} skew={skew} />
        {row.attribution.kind === "suspect" ? (
          <Explain tip={{ ...ATTRIBUTION_TIP, how: row.attribution.why }} placement="bottom">
            <span className="tw:font-semibold tw:text-alarm-ink">may not be this session</span>
          </Explain>
        ) : null}
      </p>
      {who.note === null ? null : <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">{who.note}</p>}

      {row.turn.text === "" ? (
        /* A turn with no words and some tool calls is a REAL state, not a
           missing one. Drawing nothing would look like a row that failed. */
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint tw:italic">
          {row.turn.toolCalls.length > 0
            ? "No words in this turn — it only called tools."
            : "No words and no tool calls in this turn."}
        </p>
      ) : (
        /* Untrusted text. `whitespace-pre-wrap` keeps the agent's own line
           breaks without anything interpreting them. */
        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">
          {open ? row.turn.text : head}
        </p>
      )}

      {rest && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tw:mt-0.5 tw:text-[11px] tw:text-work-ink tw:underline"
        >
          Show the rest of this message
        </button>
      ) : null}
      {open && rest ? (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint tw:underline"
        >
          Collapse
        </button>
      ) : null}

      {/* **THE "CUT SHORT" DISCLOSURE SURVIVES EXPANDING.** Opening a message
          shows everything the SERVER sent, which is not everything the agent
          said — the reader caps a turn at 2,000 characters. Dropping this line
          on expand would turn "here is more" into "here is all of it". */}
      {row.turn.truncated ? (
        <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
          Cut short by the reader
          {row.turn.fullChars === null ? "" : ` — ${row.turn.fullChars.toLocaleString()} characters in full`}, so
          expanding it does not show the whole message.
        </p>
      ) : null}

      {row.turn.toolCalls.length === 0 ? null : (
        <ul className="tw:mt-1 tw:space-y-0.5">
          {row.turn.toolCalls.map((call, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a turn's tool calls have no id of their own, and this list is fixed for the life of the turn — never reordered, appended to or filtered — so the index IS a stable identity here.
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

/* ------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------ */

export function FeedPanel({
  api = httpFeedApi,
  limit,
  onLimit,
  filters,
  onFilters,
  onOpenSession = null,
  sessions = { kind: "not-arrived" },
  now,
  skew,
}: {
  api?: FeedApi;
  limit: number;
  onLimit: (limit: number) => void;
  /** Held in the URL hash by App.tsx, so a filtered view survives a reload. */
  filters: FeedFilters;
  onFilters: (next: FeedFilters) => void;
  /**
   * Take the reader to this session on the Sessions tab.
   *
   * **`null` DRAWS PLAIN TEXT RATHER THAN A DEAD BUTTON.** A control that looks
   * like a way in and does nothing is worse on this page than no control at
   * all — it is the same shape as the Refresh button that refreshed nothing.
   * The default is `null` so a test mounting the panel alone gets a panel that
   * is honest about having nowhere to go.
   */
  onOpenSession?: ((id: string, tmuxServerPid: number | null) => void) | null;
  /**
   * **THE LAST SESSION LIST THIS PAGE RECEIVED — the same rows the Sessions tab
   * renders**, in the shape that can tell "nothing has arrived" from "a
   * collection has not finished" from "we looked and it holds nobody".
   *
   * Defaults to `not-arrived`, which is the honest default: a panel mounted
   * without one has been told nothing. feed-client.ts § `SessionListReading`.
   */
  sessions?: SessionListReading;
  /**
   * The page's one clock, so every age here ticks with every other age on
   * screen — useNow.ts. Required rather than defaulted to `Date.now()`: a
   * component that reads the clock itself is one whose ages can disagree with
   * the rest of the page, and a test could not pin it.
   */
  now: number;
  /**
   * The correction between the box's clock and this device's. `unknown` shifts
   * by zero and the row says so in words — types.ts § `ClockSkew`.
   *
   * **REQUIRED, with no default.** It was `= CLOCK_SKEW_UNMEASURED` for a review
   * round, and GPT Sol was right that a defaulted one is a way for a future
   * caller to sit permanently unmeasured without ever deciding to: the page
   * would go on labelling every age "clocks not compared" and nobody would know
   * whether that was true of the payload or true of the call site. `App` has one
   * to give; anything else has to say what it is holding.
   */
  skew: ClockSkew;
}): ReactNode {
  const { reading, refresh, busy } = useFeed(api, limit);

  const view = reading.kind === "ready" ? reading.view : null;
  const rows = view?.kind === "feed" ? view.messages : [];
  /* **THE UNDATED GROUP IS FILTERED AND COUNTED LIKE EVERY OTHER MESSAGE.**
     It was neither until GPT Sol's P2: filters applied to the dated list only,
     so a speaker filter left the undated rows on screen underneath it, and the
     tally said "0 messages" over a panel visibly showing some. Three claims,
     none of them agreeing with the other two. */
  const undatedRows = view?.kind === "feed" ? view.undated : [];
  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const shownUndated = useMemo(() => applyFilters(undatedRows, filters), [undatedRows, filters]);
  const total = rows.length + undatedRows.length;
  const totalShown = shown.length + shownUndated.length;
  const filtering =
    filters.sessions.length > 0 || filters.speakers.length > 0 || filters.text.trim() !== "" || filters.hideToolCalls;

  /* The sessions offered in the picker are the ones actually PRESENT in this
     window, not every session on the box: a filter chip that can only ever
     produce an empty list is a control that lies about what it does. */
  const present = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) if (!seen.has(row.sessionId)) seen.set(row.sessionId, row.sessionName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  return (
    <div>
      <SectionHeading>
        Recent messages{" "}
        <Explain
          tip={{
            head: "Recent messages",
            what: "The last N messages across every session on the box, newest first.",
            how: "Read on demand rather than on the refresh loop — it reads the tail of every transcript, so it is asked for only when you are looking at it.",
          }}
        >
          <span aria-hidden="true">?</span>
        </Explain>
      </SectionHeading>

      {/* The controls. One row that wraps, because this is read one-handed. */}
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
        <input
          type="search"
          value={filters.text}
          onChange={(e) => onFilters({ ...filters, text: e.target.value })}
          placeholder="Filter by text or session"
          aria-label="Filter messages by text"
          className="tw:h-7 tw:min-w-40 tw:flex-1 tw:rounded-md tw:border tw:border-rule tw:bg-page tw:px-2 tw:text-[12px]"
        />
        <Chip
          on={filters.hideToolCalls}
          onClick={() => onFilters({ ...filters, hideToolCalls: !filters.hideToolCalls })}
          label="Hide turns that only called tools"
        >
          Hide tool calls
        </Chip>
        <Button onClick={refresh} disabled={busy} aria-label="Read the transcripts again">
          {busy ? "Reading…" : "Read again"}
        </Button>
        {/* **A WAY OUT THAT DOES NOT DEPEND ON SEEING THE FILTER.** The session
            chips are drawn only for sessions present in this window, so a
            bookmarked filter — or one whose session has since gone quiet — can
            empty the feed with no lit chip to press. Without this the reader's
            only remedy is editing the URL. GPT Sol's P2. */}
        {filtering ? (
          <Button onClick={() => onFilters(NO_FILTERS)} aria-label="Clear every filter">
            Clear filters
          </Button>
        ) : null}
        <label className="tw:flex tw:items-center tw:gap-1 tw:text-[12px] tw:text-ink-faint">
          Last
          <select
            value={String(limit)}
            onChange={(e) => onLimit(Number(e.target.value))}
            aria-label="How many messages to show"
            className="tw:h-7 tw:rounded-md tw:border tw:border-rule tw:bg-page tw:px-1 tw:text-[12px]"
          >
            {[25, 50, 100, 200].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Speaker chips. */}
      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1.5">
        {FILTERABLE.map((s) => (
          <Chip
            key={s}
            on={filters.speakers.includes(s)}
            onClick={() => onFilters({ ...filters, speakers: toggle(filters.speakers, s) })}
            label={`Show only ${SPEAKERS[s].label}`}
          >
            {SPEAKERS[s].label}
          </Chip>
        ))}
      </div>

      {/* Session chips, from the sessions present in this window. */}
      {present.length > 0 ? (
        <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1.5">
          {present.map((s) => (
            <Chip
              key={s.id}
              on={filters.sessions.includes(s.id)}
              onClick={() => onFilters({ ...filters, sessions: toggle(filters.sessions, s.id) })}
              label={`Show only ${s.name}`}
            >
              {s.name}
            </Chip>
          ))}
        </div>
      ) : null}

      {reading.kind === "loading" ? (
        <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">Reading every session's transcript…</p>
      ) : null}

      {view?.kind === "unreadable" ? (
        <Card className="tw:mt-3 tw:px-3 tw:py-2">
          <p className="tw:text-[13px] tw:text-alarm-ink">The dashboard could not build this feed.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
        </Card>
      ) : null}

      {view?.kind === "no-answer" ? (
        <Card className="tw:mt-3 tw:px-3 tw:py-2">
          <p className="tw:text-[13px] tw:text-alarm-ink">This page did not get an answer it could read.</p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
        </Card>
      ) : null}

      {view?.kind === "feed" ? (
        <>
          <Caveats view={view} />
          {totalShown === 0 ? (
            /* **TWO DIFFERENT EMPTINESSES, AND THEY MUST NOT READ THE SAME.**
               "Your filters match nothing" is the reader's own doing; "no
               session on this box has said anything" is a claim about the
               fleet, and it is nearly always the wrong one to make. */
            <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
              {total === 0
                ? "No session in this window has a readable message. That is a claim about the transcripts, not about whether the agents are working — see the sessions above."
                : `None of the ${total} messages in this window match these filters.`}
            </p>
          ) : (
            <ul className="tw:mt-2">
              {shown.map((row) => (
                <Row key={row.turn.uuid ?? `${row.sessionId}-${row.turn.at}-${row.turn.text.slice(0, 24)}`}
                  row={row}
                  status={sessionStatusOf(sessions, view.tmuxServerPid, row.sessionId)}
                  now={now}
                  skew={skew}
                  feedTmuxServerPid={view.tmuxServerPid}
                  onOpenSession={onOpenSession}
                />
              ))}
            </ul>
          )}

          {shownUndated.length > 0 ? (
            <>
              <SectionHeading>Undated</SectionHeading>
              <p className="tw:px-1 tw:text-[12px] tw:text-ink-faint">
                These carried no timestamp, so they cannot be placed in the ordering above. They are shown rather than
                dropped.
              </p>
              <ul className="tw:mt-2">
                {shownUndated.map((row) => (
                  <Row key={row.turn.uuid ?? `${row.sessionId}-undated-${row.turn.text.slice(0, 24)}`}
                  row={row}
                  status={sessionStatusOf(sessions, view.tmuxServerPid, row.sessionId)}
                  now={now}
                  skew={skew}
                  feedTmuxServerPid={view.tmuxServerPid}
                  onOpenSession={onOpenSession}
                />
                ))}
              </ul>
            </>
          ) : null}

          <p className="tw:mt-3 tw:px-1 tw:text-[11px] tw:text-ink-faint">
            {totalShown === total ? `${total} messages` : `${totalShown} of ${total} messages`}
            {view.sessionsOffered ? ` across ${view.sessions.length} sessions` : ""}
          </p>
          {/* **THE CENSUS BOUNDARY, SAID OUT LOUD.** There is no instant at
              which this describes the fleet: the roster is up to a minute old
              and the transcripts were read over a window after it. A single
              "as of" time would imply a snapshot that never existed. */}
          {view.collectedAt === null && view.readFinishedAt === null ? null : (
            <p className="tw:px-1 tw:text-[11px] tw:text-ink-faint">
              Sessions as listed at {view.collectedAt ?? "an unstated time"}; transcripts read
              {view.readStartedAt === null ? "" : ` from ${view.readStartedAt}`}
              {view.readFinishedAt === null ? "" : ` to ${view.readFinishedAt}`}. A session started after the first of
              those is not in this list at all.
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
