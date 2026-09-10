/**
 * The vocabulary and the queues, kept in one place and refreshed after anything
 * that could have changed them.
 *
 * ## Why this is a second feed rather than a field on the fleet state
 *
 * Different resource, different cost, different clock. `/api/state` is a
 * ~12-second collection off tmux that the server caches and hands out on a
 * 60-second chain; `/api/actions` is memory — a catalogue that never changes
 * and a few queues that change the instant somebody presses something. Folding
 * them together would either make the queue as stale as the collection (a
 * queue you cannot see is the failure the queue exists to prevent) or make
 * every reader pay for a collection to find out whether a button worked.
 *
 * ## What it does after a mutation, and what it does not
 *
 * **It refreshes the queues; it does not refresh the row.** That distinction is
 * the whole safety model. A row's identifiers are stale-but-honest claims the
 * server checks against live tmux, so a client that quietly re-read them before
 * sending would make every guard compare the box with itself — routes-steer.ts
 * says so at length, and steer-client.ts is written around it. Nothing here
 * touches `/api/state`; `refresh()` asks `/api/actions` and only that.
 * tests/fleet-actions-freshness.test.tsx records every request the hook and a
 * confirmed action make, and fails if one names `/api/state`.
 *
 * ## The poll, and its manners
 *
 * Ten seconds, and skipped entirely while the tab is hidden — the same rule
 * transport.ts follows, for the same reason: Greg leaves this open on a phone.
 * It polls whether or not a queue has anything in it, because the coordinator
 * agent can enqueue things this browser did not press, and a page that only
 * watched queues it already knew about would never show one of those arriving.
 * A failure leaves the last good feed on screen with the error beside it: a
 * queue you cannot currently read is not an empty queue.
 *
 * Since plan 260910c Stage 4 it also has transport.ts's manners, in the shape
 * FeedPanel.tsx's `feedReader` gave the recent-messages feed. The one-in-flight,
 * deadline and generation rules below are single-flight-reader.ts, which both
 * readers delegate to; the poll and the hidden-tab rule are this file's own:
 *
 *  - **Becoming visible reads at once, and so does coming back online** — the
 *    two moments the queue on screen is most likely to be wrong.
 *  - **One read in flight.** A refresh asked for during one becomes exactly one
 *    more read after it, however many times it is asked for. It used to be
 *    dropped, so the refresh after a mutation could vanish into a poll that
 *    had started a moment before the press, and the queue drawn afterwards was
 *    the one from before it. A poll tick during a read is skipped rather than
 *    queued: the next tick is only an interval away.
 *  - **Its own deadline.** Each read is raced against `ACTIONS_READ_DEADLINE_MS`
 *    on this hook's timer; on expiry the signal is aborted, the failure is
 *    recorded and the slot is released, whether or not the api honours the
 *    abort. Before this, one read that never settled stopped the poll for the
 *    life of the tab while the last queue it read stayed on screen, unmarked.
 *  - **Every answer is generation-checked**, so one that arrives after its
 *    deadline, or after unmount, is dropped rather than drawn over a newer one.
 *  - **`lastGoodAt`** is this browser's clock when the last good feed arrived,
 *    so a page can say how old the queue it is showing is.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { httpActionsApi, type ActionsApi, type ActionsFeed, type FeedOutcome } from "./actions-client";
import { singleFlightReader } from "./single-flight-reader";

/** How often to ask. Cheap — this is the server's own memory, not a collection. */
export const ACTIONS_POLL_MS = 10_000;

/**
 * **HOW LONG ONE READ MAY TAKE BEFORE THIS PAGE STOPS WAITING FOR IT** —
 * enforced by the hook's own timer, not by trusting the api to honour abort.
 *
 * The route answers from memory (routes-actions.ts § `catalogue`: a snapshot of
 * the queues and a fixed catalogue, no tmux and no disk), so an answer that has
 * not come in eight seconds is not slow, it is lost. Eight rather than
 * transport.ts's twenty because it sits BELOW the ten-second poll: a lost read
 * is released before the next tick comes due, so it costs that one tick and
 * never the one after it.
 */
export const ACTIONS_READ_DEADLINE_MS = 8_000;

export type ActionsUi = {
  api: ActionsApi;
  /** The last good feed, or null before the first one arrived. **Never cleared by a failure.** */
  feed: ActionsFeed | null;
  /**
   * The most recent failure to read the feed, in the server's words where it
   * gave any, or this page's when no answer came. Null once a read works again.
   */
  error: string | null;
  /** Whether anything has ever come back — an answer or a deadline. `feed === null` with this false is "not asked yet". */
  asked: boolean;
  /**
   * When `feed` arrived, by this browser's clock (`Date.now()`), or null before
   * the first good read. A failure does not move it, so `now − lastGoodAt` is
   * the age of the feed on screen whatever `error` says. One clock, so no skew.
   */
  lastGoodAt: number | null;
  /**
   * The interval this hook is actually polling at — App's `actionsPollMs`
   * where one was given, else `ACTIONS_POLL_MS` — so whatever decides when
   * `lastGoodAt` is no longer fresh reads the real cadence rather than the
   * default.
   */
  pollMs: number;
  /**
   * Ask now. Called after every mutation, and by the buttons that offer a
   * retry. During a read it becomes exactly one more read, after that one.
   */
  refresh: () => void;
};

type ReaderSink = {
  onFeed: (feed: ActionsFeed, at: number) => void;
  onFailure: (why: string) => void;
};

type ActionsReader = {
  refresh: () => void;
  stop: () => void;
};

function tabHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * **THE READS, AS ONE SMALL MACHINE OUTSIDE REACT** — the rules are in the
 * header, and each has a test in tests/fleet-actions-freshness.test.tsx.
 */
function actionsReader(api: ActionsApi, intervalMs: number, sink: ReaderSink): ActionsReader {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /* One read in flight, one pending, the deadline and the generation check —
     single-flight-reader.ts. No `admit`: it reads whether or not the tab is
     hidden, as `refresh()` always has. Somebody asked — a person, a mutation,
     the tab coming back — and a hidden tab only excuses the reads the page
     starts itself, which `tick` gates below. */
  const core = singleFlightReader<FeedOutcome>({
    read: (signal) => api.feed(signal),
    deadlineMs: ACTIONS_READ_DEADLINE_MS,
    noAnswer: (why) => ({ ok: false, why }),
    onSettle: (outcome) => {
      // The feed is deliberately untouched by a failure, as in useFleetState.
      if (outcome.ok) sink.onFeed(outcome.feed, Date.now());
      else sink.onFailure(outcome.why);
    },
  });
  const read = (): void => core.request();

  const tick = (): void => {
    if (stopped) return;
    if (!tabHidden() && !core.reading()) read();
    timer = setTimeout(tick, intervalMs);
  };

  const onVisibility = (): void => {
    if (!tabHidden()) read();
  };

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  if (typeof window !== "undefined") window.addEventListener("online", read);
  tick();

  return {
    refresh: read,
    stop: () => {
      if (stopped) return;
      stopped = true;
      core.stop();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      if (typeof window !== "undefined") window.removeEventListener("online", read);
    },
  };
}

export function useActions(api: ActionsApi = httpActionsApi, intervalMs: number = ACTIONS_POLL_MS): ActionsUi {
  const [feed, setFeed] = useState<ActionsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const [lastGoodAt, setLastGoodAt] = useState<number | null>(null);
  /* The running reader, in a ref so `refresh` is stable and the effect does
     not restart on every state change. Changing `api` or the interval starts a
     fresh reader, and stopping the old one aborts and discards its read. */
  const reader = useRef<ActionsReader | null>(null);

  useEffect(() => {
    const running = actionsReader(api, intervalMs, {
      onFeed: (next, at) => {
        setAsked(true);
        setFeed(next);
        setLastGoodAt(at);
        setError(null);
      },
      onFailure: (why) => {
        setAsked(true);
        setError(why);
      },
    });
    reader.current = running;
    return () => {
      reader.current = null;
      running.stop();
    };
  }, [api, intervalMs]);

  const refresh = useCallback(() => reader.current?.refresh(), []);

  return useMemo(
    () => ({ api, feed, error, asked, lastGoodAt, pollMs: intervalMs, refresh }),
    [api, feed, error, asked, lastGoodAt, intervalMs, refresh],
  );
}
