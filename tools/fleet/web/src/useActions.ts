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
 *
 * ## The poll
 *
 * Ten seconds, and skipped entirely while the tab is hidden — the same rule
 * transport.ts follows, for the same reason: Greg leaves this open on a phone.
 * It polls whether or not a queue has anything in it, because the coordinator
 * agent can enqueue things this browser did not press, and a page that only
 * watched queues it already knew about would never show one of those arriving.
 * A failure leaves the last good feed on screen with the error beside it: a
 * queue you cannot currently read is not an empty queue.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { httpActionsApi, type ActionsApi, type ActionsFeed } from "./actions-client";

/** How often to ask. Cheap — this is the server's own memory, not a collection. */
export const ACTIONS_POLL_MS = 10_000;

export type ActionsUi = {
  api: ActionsApi;
  /** The last good feed, or null before the first one arrived. */
  feed: ActionsFeed | null;
  /** The most recent failure to read the feed, in the server's words where it gave any. */
  error: string | null;
  /** Whether anything has ever come back. `feed === null` with this false is "not asked yet". */
  asked: boolean;
  /** Ask now. Called after every mutation, and by the buttons that offer a retry. */
  refresh: () => void;
};

export function useActions(api: ActionsApi = httpActionsApi, intervalMs: number = ACTIONS_POLL_MS): ActionsUi {
  const [feed, setFeed] = useState<ActionsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  /* The live-ness flag and the timer, in refs so `refresh` is stable and the
     effect does not restart on every state change. */
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const outcome = await api.feed();
      if (!alive.current) return;
      setAsked(true);
      if (outcome.ok) {
        setFeed(outcome.feed);
        setError(null);
      } else {
        // The feed is deliberately untouched, as in useFleetState.
        setError(outcome.why);
      }
    } finally {
      inFlight.current = false;
    }
  }, [api]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    alive.current = true;
    const tick = (): void => {
      if (!alive.current) return;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") void load();
      timer.current = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      alive.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load, intervalMs]);

  return useMemo(() => ({ api, feed, error, asked, refresh }), [api, feed, error, asked, refresh]);
}
