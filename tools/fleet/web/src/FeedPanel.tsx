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
 * which is the whole reason `attribution` and `mayBeMissing` are on the wire.
 * Three rules follow, and each has a test:
 *
 *  1. A session whose transcript could not be read is **a row saying so**, not
 *     an absence. Nine of 21 rows on the box are shells and scheduled sessions;
 *     a feed that omitted them would show a fleet of twelve and look complete.
 *  2. A `suspect` attribution is drawn **on the message**, not tucked into a
 *     footnote — it means these may be somebody else's words.
 *  3. `mayBeMissing` is printed whenever it is non-empty. "The last 50" that is
 *     quietly the last 50 of what fitted in a byte budget is the failure this
 *     feature is most exposed to.
 *
 * ## NOT POLLED
 *
 * A refresh is ~250 ms on the box and 266 kB on the wire at N=50, read on a
 * phone over Tailscale. Fetched when the tab opens and when the reader asks,
 * never on a timer — routes-recent-feed.ts § cadence.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string drawn here is agent-authored text. React escapes it; nothing
 * here adds markup. `Turn.tsx` draws the turns and carries the same rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { SPEAKERS } from "./Turn";
import { Explain } from "./Tooltip";
import {
  applyFilters,
  httpFeedApi,
  type FeedApi,
  type FeedFilters,
  type FeedRow,
  type FeedView,
} from "./feed-client";
import type { MessageSpeaker } from "./messages-client";
import { Button, Card, Mono, SectionHeading, cx } from "./ui";

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
function Row({ row }: { row: FeedRow }): ReactNode {
  const [open, setOpen] = useState(false);
  const who = SPEAKERS[row.turn.speaker];
  const { head, rest } = firstLine(row.turn.text);
  return (
    <li className="tw:border-t tw:border-rule tw:py-2 tw:first:border-t-0">
      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-[11px]">
        <Mono>{row.sessionName}</Mono>
        <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
        {row.turn.at === null ? null : <span className="tw:text-ink-faint">{row.turn.at}</span>}
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
}: {
  api?: FeedApi;
  limit: number;
  onLimit: (limit: number) => void;
  /** Held in the URL hash by App.tsx, so a filtered view survives a reload. */
  filters: FeedFilters;
  onFilters: (next: FeedFilters) => void;
}): ReactNode {
  const { reading, refresh, busy } = useFeed(api, limit);

  const view = reading.kind === "ready" ? reading.view : null;
  const rows = view?.kind === "feed" ? view.messages : [];
  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);

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
          {shown.length === 0 ? (
            /* **TWO DIFFERENT EMPTINESSES, AND THEY MUST NOT READ THE SAME.**
               "Your filters match nothing" is the reader's own doing; "no
               session on this box has said anything" is a claim about the
               fleet, and it is nearly always the wrong one to make. */
            <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
              {rows.length === 0
                ? "No session in this window has a readable message. That is a claim about the transcripts, not about whether the agents are working — see the sessions above."
                : `None of the ${rows.length} messages in this window match these filters.`}
            </p>
          ) : (
            <ul className="tw:mt-2">
              {shown.map((row) => (
                <Row key={row.turn.uuid ?? `${row.sessionId}-${row.turn.at}-${row.turn.text.slice(0, 24)}`} row={row} />
              ))}
            </ul>
          )}

          {view.undated.length > 0 ? (
            <>
              <SectionHeading>Undated</SectionHeading>
              <p className="tw:px-1 tw:text-[12px] tw:text-ink-faint">
                These carried no timestamp, so they cannot be placed in the ordering above. They are shown rather than
                dropped.
              </p>
              <ul className="tw:mt-2">
                {view.undated.map((row) => (
                  <Row key={row.turn.uuid ?? `${row.sessionId}-undated-${row.turn.text.slice(0, 24)}`} row={row} />
                ))}
              </ul>
            </>
          ) : null}

          <p className="tw:mt-3 tw:px-1 tw:text-[11px] tw:text-ink-faint">
            {shown.length === rows.length ? `${rows.length} messages` : `${shown.length} of ${rows.length} messages`}
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
