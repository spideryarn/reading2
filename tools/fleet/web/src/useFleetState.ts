/**
 * The one hook that knows where the state comes from.
 *
 * EXACTLY ONE THING CHANGES when polling becomes Server-Sent Events: the
 * default value of `transport` below. Everything about failure, staleness and
 * what the page draws is decided here and in transport.ts, and no component
 * fetches anything.
 *
 * ## What it holds onto, and why
 *
 * `state` is the LAST GOOD STATE and is never cleared by a failure. A fleet you
 * cannot currently reach is not an empty fleet, and a page that empties itself
 * when the server hiccups is a page that tells you nothing is running at the
 * exact moment something is.
 *
 * `receivedAt` is stamped by this hook from its own clock rather than read out
 * of the payload, because the two answer different questions: `collectedAt`
 * says when the box was asked, `receivedAt` says when we last heard anything at
 * all. Both are shown — one age is about the data, the other is about the
 * connection, and it is entirely possible for the second to be fine while the
 * first is hours old.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { pollingTransport, type Transport } from "./transport";
import type { FleetState } from "./types";

export type FleetFeed = {
  /** The last state we successfully received, or null before the first one. */
  state: FleetState | null;
  /** When that arrived, by this browser's clock. Null before the first one. */
  receivedAt: number | null;
  /** The most recent failure, or null while things are working. */
  error: string | null;
  /** How many refreshes have failed in a row. Zero after any success. */
  failures: number;
  /**
   * **How long the server actually leaves between collections**, learnt by
   * watching, or null until two distinct snapshots have arrived.
   *
   * The staleness threshold is derived from this rather than written down (see
   * `freshness` in Header.tsx). It is measured rather than assumed because the
   * cadence is not ours: the collector runs every 55–60s today because a
   * collection costs the box ten seconds of work, and that number will move the
   * next time the box's load does. A threshold that does not move with it is a
   * banner that cries wolf, which is what a 30-second constant was doing.
   *
   * `state.refreshMs` beats this when the server ever starts sending it: being
   * told is better than inferring, and the inference needs two payloads.
   */
  cadenceMs: number | null;
  /** Ask now. Wired to the button the stale banner shows. */
  refresh: () => void;
};

/**
 * The transport this app uses in the browser — **and the one line an SSE swap
 * touches.**
 *
 * Module-scope so that `useFleetState()` with no argument is stable: a new
 * `pollingTransport()` per render would tear down and restart the poll on every
 * state change, which is a page that fetches in a loop and looks fine.
 */
const DEFAULT_TRANSPORT: Transport = pollingTransport();

/**
 * Subscribe to the fleet.
 *
 * The transport is started ONCE and torn down on unmount. Passing a different
 * `transport` restarts it, which is what the tests do and what an SSE swap
 * would do; passing a freshly-constructed one every render would restart it
 * every render, so callers construct theirs outside the component or with
 * `useMemo` — App.tsx does the latter.
 */
export function useFleetState(transport: Transport = DEFAULT_TRANSPORT): FleetFeed {
  const [state, setState] = useState<FleetState | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const [cadenceMs, setCadenceMs] = useState<number | null>(null);
  /* When the box was last collected, as of the previous payload — the other
     half of the subtraction above. A ref, because it is read inside the
     transport's callback and must not re-run the effect. */
  const lastCollected = useRef<number | null>(null);
  /* The handle, kept in a ref so `refresh` is stable across renders and so the
     button does not have to be re-bound every five seconds. */
  const handle = useRef<{ refresh: () => void } | null>(null);

  useEffect(() => {
    const running = transport({
      onState: (next) => {
        setState(next);
        setReceivedAt(Date.now());
        setError(null);
        setFailures(0);
        /* The gap between two DISTINCT collections, which is not the gap
           between two polls: the server caches, so several polls in a row hand
           back the same snapshot and `at > previous` is what tells them apart.
           The last gap rather than an average, so a cadence that changes is
           followed rather than smoothed away; the bounds throw out a clock jump
           and a first payload whose `collectedAt` predates this tab. */
        const at = next.collectedAt === null ? Number.NaN : Date.parse(next.collectedAt);
        if (Number.isFinite(at)) {
          const previous = lastCollected.current;
          if (previous !== null && at > previous) {
            const gap = at - previous;
            if (gap >= 5_000 && gap <= 30 * 60_000) setCadenceMs(gap);
          }
          lastCollected.current = at;
        }
      },
      onError: (message) => {
        // The state is deliberately untouched. See the header.
        setError(message);
        setFailures((n) => n + 1);
      },
    });
    handle.current = running;
    return () => {
      handle.current = null;
      running.stop();
    };
  }, [transport]);

  return useMemo(
    () => ({
      state,
      receivedAt,
      error,
      failures,
      cadenceMs,
      refresh: () => handle.current?.refresh(),
    }),
    [state, receivedAt, error, failures, cadenceMs],
  );
}
