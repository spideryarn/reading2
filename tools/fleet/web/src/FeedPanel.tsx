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
 * ## NOT POLLED — READ ON EVIDENCE, AND SAYS HOW OLD IT IS
 *
 * A refresh costs the box ~250 ms and about 10 MB of transcript reads; the
 * answer itself is only 40 kB (8 kB gzipped). **The disk is what decides the
 * cadence, not the wire.** So there is no timer. It reads when the tab opens,
 * when the reader asks, and when the session list — which *is* polled, and
 * costs this tab nothing extra — shows something that could make the list out
 * of date: a session appearing or going, changing status, getting or losing a
 * dialog, claiming a different conversation, having its run replaced, or the
 * tmux server restarting (feed-client.ts § `feedEvidence`). A row that merely
 * fails to verify its run is not evidence. At most once per
 * `FEED_REREAD_FLOOR_MS`, never from a hidden tab. Docs/plans/260910c Stage 3.
 *
 * **That is not "current", and the page does not say it is.** An agent that
 * writes ten turns without changing status produces no evidence at all. So the
 * last-read clock is the load-bearing half: it is what keeps every other claim
 * on this panel honest when the list is old, and its tooltip says what the
 * re-read can and cannot notice.
 *
 * **A failed read does not empty the list** — the `useFleetState` rule. A feed
 * this page cannot currently read is not an empty feed, so the failure is drawn
 * above the last good answer rather than instead of it.
 *
 * ## UNTRUSTED, ALL OF IT
 *
 * Every string drawn here is agent-authored text. React escapes it; nothing
 * here adds markup. `Turn.tsx` draws the turns and carries the same rule.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { StatusPill } from "./SessionParts";
import { SPEAKERS, SPEAKER_TIPS } from "./Turn";
import { Explain, TipCard, Tooltip, TooltipGroup } from "./Tooltip";
/* **`instantTip` RATHER THAN A SECOND `zonedLine` CALL.** This branch grew its
   own inline three-zone tooltip on the age at the same time `dashboard-tooltips`
   was extracting exactly that into a shared helper, and theirs is the better
   one: same `zonedLine`, one heading across every surface that prints an
   instant, and a `how` that says whose clock the number came off rather than
   how old it is. Two spellings of one card is one to change and one to forget. */
import { instantTip } from "./instant";
import {
  NO_FILTERS,
  applyFilters,
  feedEvidence,
  httpFeedApi,
  rememberVerified,
  sessionStatusOf,
  turnAge,
  type FeedApi,
  type FeedEvidence,
  type FeedFilters,
  type FeedRow,
  type FeedSessionStatus,
  type FeedView,
  type SessionListReading,
} from "./feed-client";
import type { MessageSpeaker } from "./messages-client";
import { describeError } from "./transport";
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

/**
 * **THE LEAST TIME BETWEEN THE START OF ONE READ AND A READ THE PAGE STARTS ON
 * ITS OWN.** Evidence inside it is held to one trailing read at the earliest
 * permitted moment, however much of it arrives.
 *
 * Twenty seconds: the session list's own collections land every 55–60 s
 * (useFleetState.ts § `cadenceMs`), so on a quiet box this is never the
 * binding limit; it binds on a busy one, where several sessions change status
 * inside one collection and each would otherwise cost the box its own ~10 MB
 * read. Person-driven reads — the button, the size control — are not held to
 * it: a person pressing a button is asking for it now.
 */
export const FEED_REREAD_FLOOR_MS = 20_000;

/**
 * **HOW LONG ONE READ MAY TAKE BEFORE THIS PAGE STOPS WAITING FOR IT** — enforced
 * by the hook's own timer, not by trusting the api to honour abort.
 *
 * The server gives up on any one session's transcript after five seconds
 * (routes-recent-feed.ts § `READ_DEADLINE_MS`) and answers with a hole it
 * admits to, so a whole answer that has not come in fifteen is not slow, it is
 * lost. Without this, a read that never settled left "Reading…" on a disabled
 * button for the life of the tab.
 */
export const FEED_READ_DEADLINE_MS = 15_000;

type GoodFeed = Extract<FeedView, { kind: "feed" }>;
/** The two ways a read can fail: the server's own refusal, or this page's lack of an answer. */
export type FeedFailure = Exclude<FeedView, { kind: "feed" }>;

export type FeedReading = {
  /** The last good feed, or null before the first. **Never cleared by a failure.** */
  feed: GoodFeed | null;
  /** When `feed` arrived, by this browser's clock. Null before the first good read. */
  lastReadAt: number | null;
  /** The most recent failure, drawn above `feed`; null once a read works again. */
  error: FeedFailure | null;
  /** A read is in flight. */
  busy: boolean;
  /** A person asking. During a read this becomes exactly one more read, after it. */
  refresh: () => void;
};

type ReaderSink = {
  onFeed: (feed: GoodFeed, at: number) => void;
  onFailure: (failure: FeedFailure) => void;
  onBusy: (busy: boolean) => void;
};

type FeedReader = {
  refresh: () => void;
  /** The session list's latest evidence. Idempotent: the same digest twice is nothing. */
  observe: (evidence: FeedEvidence | null) => void;
  stop: () => void;
};

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * **THE READS, AS ONE SMALL MACHINE OUTSIDE REACT** — transport.ts's shape, and
 * its manners, for a resource that must not be polled.
 *
 * Its rules, each of which has a test in tests/fleet-feed-freshness.test.tsx:
 *
 *  - **One read in flight.** A read asked for during one becomes exactly one
 *    more, after it — neither overlapping nor vanishing, however many times it
 *    is asked for.
 *  - **Its own deadline.** Each read is raced against `FEED_READ_DEADLINE_MS`
 *    on this machine's timer; on expiry the signal is aborted, a `no-answer` is
 *    recorded and the slot is released. Nothing here waits on an api honouring
 *    the abort, so a client (or a test double, or a browser) that ignores it
 *    cannot stop the reads for ever.
 *  - **Every answer is generation-checked.** An answer from a read that was
 *    timed out, superseded or stopped is dropped on arrival.
 *  - **Evidence schedules, and does not read.** A digest different from the one
 *    the last read started under schedules one trailing read at that read's
 *    start plus the floor; more evidence before then joins it. If the tab is
 *    hidden when it comes due, it waits for the tab to be shown and then reads
 *    once. Every read that starts takes the current digest as its own, so a
 *    button press satisfies evidence that arrived before it.
 *  - **A different tmux server discards and reads at once**, floor or no
 *    floor: every handle in a read begun against the old server now names
 *    somebody else's session, so it is not worth waiting for. It is only a
 *    *change* between two named servers; a pid going to or from `null` is the
 *    collector failing to say, which is ordinary evidence under the floor.
 *
 * The first digest seen is the baseline and reads nothing — whether it arrived
 * with the first read or after it. A session list arriving is not news about
 * the transcripts.
 */
function feedReader(
  api: FeedApi,
  limit: number,
  sink: ReaderSink,
  evidenceNow: () => FeedEvidence | null,
): FeedReader {
  let stopped = false;
  let generation = 0;
  let inFlight: { controller: AbortController; deadline: ReturnType<typeof setTimeout> } | null = null;
  let again = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  /* The digest the last read to start was known to reflect. Null until the
     first evidence arrives, which is then the baseline. */
  let readDigest: string | null = null;
  /* The last tmux server a session list named. */
  let world: number | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let dueWhileHidden = false;

  const cancelTrailing = (): void => {
    if (trailing !== null) clearTimeout(trailing);
    trailing = null;
    dueWhileHidden = false;
  };

  /** Drop the read in flight, if any: abort it and make its answer unwelcome. */
  const discard = (): void => {
    generation += 1;
    again = false;
    if (inFlight === null) return;
    clearTimeout(inFlight.deadline);
    inFlight.controller.abort();
    inFlight = null;
  };

  const settle = (mine: number, view: FeedView): void => {
    if (stopped || mine !== generation || inFlight === null) return;
    clearTimeout(inFlight.deadline);
    inFlight = null;
    if (view.kind === "feed") sink.onFeed(view, Date.now());
    else sink.onFailure(view);
    if (again) {
      again = false;
      read();
    } else {
      sink.onBusy(false);
    }
  };

  const read = (): void => {
    if (stopped) return;
    if (inFlight !== null) {
      again = true;
      return;
    }
    cancelTrailing();
    const evidence = evidenceNow();
    if (evidence !== null) {
      readDigest = evidence.digest;
      if (evidence.tmuxServerPid !== null) world = evidence.tmuxServerPid;
    }
    lastStartedAt = Date.now();
    generation += 1;
    const mine = generation;
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      settle(mine, {
        kind: "no-answer",
        why: `the dashboard did not answer within ${Math.round(FEED_READ_DEADLINE_MS / 1000)}s, so this page stopped waiting — the box may be loaded, or the read stuck`,
      });
    }, FEED_READ_DEADLINE_MS);
    inFlight = { controller, deadline };
    sink.onBusy(true);
    api.recent(limit, controller.signal).then(
      (view) => settle(mine, view),
      (cause: unknown) =>
        settle(mine, { kind: "no-answer", why: `the read failed before it answered: ${describeError(cause)}` }),
    );
  };

  const fireTrailing = (): void => {
    trailing = null;
    if (tabHidden()) {
      dueWhileHidden = true;
      return;
    }
    read();
  };

  const scheduleTrailing = (): void => {
    if (trailing !== null || dueWhileHidden) return;
    const wait = lastStartedAt + FEED_REREAD_FLOOR_MS - Date.now();
    if (wait <= 0) fireTrailing();
    else trailing = setTimeout(fireTrailing, wait);
  };

  const onVisibility = (): void => {
    if (!dueWhileHidden || tabHidden()) return;
    dueWhileHidden = false;
    read();
  };

  const observe = (evidence: FeedEvidence | null): void => {
    if (stopped || evidence === null) return;
    const pid = evidence.tmuxServerPid;
    if (world !== null && pid !== null && pid !== world) {
      world = pid;
      discard();
      if (tabHidden()) {
        cancelTrailing();
        dueWhileHidden = true;
        sink.onBusy(false);
      } else {
        read();
      }
      return;
    }
    if (pid !== null) world = pid;
    if (readDigest === null) {
      readDigest = evidence.digest;
      return;
    }
    if (evidence.digest !== readDigest) scheduleTrailing();
  };

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  read();

  return {
    refresh: read,
    observe,
    stop: () => {
      if (stopped) return;
      discard();
      cancelTrailing();
      stopped = true;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/**
 * The feed, read once on mount, again when asked, and again on evidence from
 * the session list — `feedReader` above has the rules.
 *
 * `sessions` defaults to `not-arrived`, which is no evidence of anything: a
 * caller that passes no session list gets a feed that reads on mount and on the
 * button, exactly as before this stage.
 *
 * **Changing `api` or `limit` starts a fresh reader**, and tearing the old one
 * down aborts and discards whatever it had in flight — which is what makes a
 * second limit chosen during a read supersede the first rather than race it.
 * The last good feed survives that, as it survives a failure.
 */
export function useFeed(
  api: FeedApi,
  limit: number,
  sessions: SessionListReading = { kind: "not-arrived" },
): FeedReading {
  const [feed, setFeed] = useState<GoodFeed | null>(null);
  const [lastReadAt, setLastReadAt] = useState<number | null>(null);
  const [error, setError] = useState<FeedFailure | null>(null);
  const [busy, setBusy] = useState(true);

  /* **EACH ROW'S LAST VERIFIED TOKEN, HELD IN A REF AND WRITTEN DURING
     RENDER** — feed-client.ts § `feedEvidence` says why the digest wants the
     last verified token rather than the reading.

     continuity.ts keeps the same memory in state, and has to: its answer is a
     React key, so it changes what is drawn, and a render-time write there
     would be a render that is not a function of its inputs. This one decides
     nothing on screen — only whether to *schedule a read* — and the write is
     idempotent: rendering the same `sessions` twice, as StrictMode does, or
     rendering one React then throws away, stores the same tokens, each of
     which is a real observation. State would cost a second render per
     collection for no gain. */
  const lastVerified = useRef<ReadonlyMap<string, string>>(new Map());
  /* Computed every render rather than memoised: App builds `sessions` afresh on
     every render, so a memo keyed on it would never hit — and what the effects
     below compare is the digest string, which is a value. */
  const evidence = feedEvidence(sessions, lastVerified.current);
  lastVerified.current = rememberVerified(sessions, lastVerified.current);
  const digest = evidence?.digest ?? null;
  const pid = evidence?.tmuxServerPid ?? null;
  /* The latest evidence, for a read to take as its own when it starts. Seeded
     on the first render so the first read has it, and updated by the effect
     below rather than during render. */
  const latest = useRef<FeedEvidence | null>(evidence);
  const reader = useRef<FeedReader | null>(null);

  /* **DECLARED BEFORE THE READER'S EFFECT, ON PURPOSE.** React runs effects in
     order, so when the limit and the evidence change in one render, `latest` is
     already current by the time the new reader starts its first read — which
     then takes the new digest as its own rather than scheduling a second read
     for evidence it has already seen. */
  useEffect(() => {
    const next = digest === null ? null : { digest, tmuxServerPid: pid };
    latest.current = next;
    reader.current?.observe(next);
  }, [digest, pid]);

  useEffect(() => {
    const running = feedReader(
      api,
      limit,
      {
        onFeed: (view, at) => {
          setFeed(view);
          setLastReadAt(at);
          setError(null);
        },
        // The feed is deliberately untouched. See the header.
        onFailure: setError,
        onBusy: setBusy,
      },
      () => latest.current,
    );
    reader.current = running;
    return () => {
      reader.current = null;
      running.stop();
    };
  }, [api, limit]);

  const refresh = useCallback(() => reader.current?.refresh(), []);
  return useMemo(
    () => ({ feed, lastReadAt, error, busy, refresh }),
    [feed, lastReadAt, error, busy, refresh],
  );
}

/**
 * **"READ 2M AGO", AND ON ITS CARD THE LIMITS OF THAT.** The page's own
 * `now` against this browser's own `lastReadAt` — one clock, so no skew.
 *
 * The caveat lives on the clock rather than in a paragraph on the panel: it
 * changes what you would believe about the list, not what you would do in the
 * next ten seconds, and SessionDetail.tsx's rule puts that kind one tap away,
 * attached to the fact it qualifies.
 */
const LAST_READ_TIP = {
  head: "When this list was read",
  what: "How long ago this page last read the transcripts behind this list, by this device's clock. A read that fails does not move it: the list and this age are both from the last read that worked.",
  how: `It reads again by itself when the session list shows a change it can see — a session appearing or going, changing status, getting or losing a dialog, claiming a different conversation, or having its run replaced by a new process — at most once every ${FEED_REREAD_FLOOR_MS / 1000} seconds, and not while this tab is hidden. A tmux server restart reads at once. What it cannot see is an agent that goes on working without changing status: ten new messages from a busy session change nothing here, so the list stays as old as this says until you press Read again.`,
};

function LastRead({ at, now }: { at: number; now: number }): ReactNode {
  return (
    <Explain tip={LAST_READ_TIP} placement="bottom">
      {/* Clamped: `now` ticks once a second and `at` is stamped between ticks,
          so the page clock can trail an answer by up to a second. */}
      <span className="tw:text-[12px] tw:text-ink-faint">read {formatDuration(Math.max(0, now - at))} ago</span>
    </Explain>
  );
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
  ...rest
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  label: string;
  /**
   * **Everything else goes on the `<button>`, and the `ref` is the reason.**
   *
   * A `Tooltip` around a chip clones it and hands it a merged `ref` plus its
   * hover and focus handlers. Tooltip.tsx's header names the failure exactly:
   * *"a trigger that swallows the ref opens nothing at all — with no error, and
   * looking exactly like a page with no tooltips on it."* This component ate
   * both until 2026-09-09, because it declared four props and dropped the rest.
   */
  /* `type`, `aria-pressed` and `className` are this component's invariants, so
     they are not offered: the spread below sits after them and would otherwise
     let a caller override the first two, while `className` was accepted by the
     type and then silently thrown away. GPT Sol's P2. */
} & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "aria-label" | "type" | "aria-pressed" | "className"
>): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      {...rest}
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
  const tip = useMemo(() => (at === null ? null : instantTip(at, "This message was written")), [at]);
  if (at === null || tip === null) return null;
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
    <Explain tip={tip} placement="bottom">
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
        {/* The same card the detail pane's turns carry, from the same map —
            `SPEAKERS` and `SPEAKER_TIPS` are both in Turn.tsx for the reason
            this file's header gives about the map itself. Kept from `dev`'s
            side of the merge; this branch had the label bare. */}
        <Explain tip={SPEAKER_TIPS[row.turn.speaker]} placement="bottom">
          <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
        </Explain>
        {/* **THE AGE REPLACES THE RAW ISO, AND THE CARD BEHIND IT IS `dev`'s.**
            Both sides of this merge solved the same complaint — that
            `2026-09-09T05:51:02.547Z` is *"unreadable as a time of day, in a
            city, by a person"* (instant.ts) — and solved it at opposite ends.
            `dev` kept the ISO visible and put the three zones on a card; this
            branch put a human age in front and the zones behind it. Greg asked
            for *"human-readable timing"*, and instant.ts's own header agrees
            that the relative age *"is the right thing to read at a glance"* —
            so the age wins the row and `instantTip` wins the card, which is
            also the only part `dev` would have had to write twice. */}
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
  const { feed: view, lastReadAt, error, refresh, busy } = useFeed(api, limit, sessions);

  const rows = view?.messages ?? [];
  /* **THE UNDATED GROUP IS FILTERED AND COUNTED LIKE EVERY OTHER MESSAGE.**
     It was neither until GPT Sol's P2: filters applied to the dated list only,
     so a speaker filter left the undated rows on screen underneath it, and the
     tally said "0 messages" over a panel visibly showing some. Three claims,
     none of them agreeing with the other two. */
  const undatedRows = view?.undated ?? [];
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
        {lastReadAt === null ? null : <LastRead at={lastReadAt} now={now} />}
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
        {/* **`mouseOnly`, and this is the one place on the tab that needs it.**
            A tap on a chip toggles the filter, so a card opening at the same
            time would land over the list the tap just changed — the dock's
            argument exactly (Dock.tsx). The cost is that these nine definitions
            are unreachable on a phone, which is why the same map is also on the
            badge over every message, where a tap does nothing and the card
            opens under a finger. */}
        <TooltipGroup delay={{ open: 240, close: 90 }}>
          {FILTERABLE.map((s) => (
            <Tooltip key={s} content={<TipCard tip={SPEAKER_TIPS[s]} />} placement="top" mouseOnly>
              <Chip
                on={filters.speakers.includes(s)}
                onClick={() => onFilters({ ...filters, speakers: toggle(filters.speakers, s) })}
                label={`Show only ${SPEAKERS[s].label}`}
              >
                {SPEAKERS[s].label}
              </Chip>
            </Tooltip>
          ))}
        </TooltipGroup>
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

      {view === null && error === null ? (
        <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">Reading every session's transcript…</p>
      ) : null}

      {/* **THE FAILURE GOES ABOVE THE LAST GOOD LIST, NOT INSTEAD OF IT.** Two
          voices, as before — the server saying it could not look, and this page
          saying it heard nothing it could read — and when there is a list
          underneath, one line saying which read it came from. */}
      {error === null ? null : (
        <Card className="tw:mt-3 tw:px-3 tw:py-2">
          <p className="tw:text-[13px] tw:text-alarm-ink">
            {error.kind === "unreadable"
              ? "The dashboard could not build this feed."
              : "This page did not get an answer it could read."}
          </p>
          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{error.why}</p>
          {view === null ? null : (
            <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">
              The messages below are from the last read that worked.
            </p>
          )}
        </Card>
      )}

      {view !== null ? (
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
