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
      refresh: () => handle.current?.refresh(),
    }),
    [state, receivedAt, error, failures],
  );
}
