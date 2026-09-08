/**
 * How the page gets its state — and the ONE thing that changes when this stops
 * polling.
 *
 * ## The seam
 *
 * `Transport` is the whole contract: hand it a sink, get back a handle. It says
 * nothing about HTTP, intervals or events, so an `sseTransport` can replace
 * `pollingTransport` below without `useFleetState` or a single component
 * knowing.
 *
 * **The other half already exists.** tools/fleet/live.ts serves `/api/live` as
 * an event stream with two named events — `snapshot`, carrying the same JSON
 * this file parses, and `ping` as a heartbeat. So the swap is one function here
 * (an `EventSource`, `onmessage` on `snapshot` into `sink.onState`, `onerror`
 * into `sink.onError`, `close()` as `stop`) and one word in the default
 * argument of `useFleetState`. It is not done in this pass because polling is
 * what the plan asked for at this slice and because an `EventSource` written
 * against a stream nobody here has watched reconnect is exactly the kind of
 * change that looks finished — see docs/reusable/silent-success.md.
 *
 * What a replacement must keep, because the UI depends on all four:
 *
 *  - **`onState` means "this is fresh, and here it is"** — the hook stamps the
 *    arrival time from it, so a transport that replays a cached payload must
 *    not call it.
 *  - **`onError` does not clear the last good state.** A poll that fails leaves
 *    the previous rows on screen with STALE over them, because a fleet you
 *    cannot currently reach is not an empty fleet.
 *  - **`refresh()` is a person pressing a button.** It must do the thing
 *    immediately and reset any backoff.
 *  - **`stop()` must be idempotent**, since React calls it on every effect
 *    teardown including the double one in StrictMode.
 *
 * ## Why polling first
 *
 * Because it works with the server exactly as it is, and because five seconds
 * of staleness on a page that says how stale it is costs nothing. The reason to
 * move is not elegance — it is that a phone waking from sleep gets the state
 * that is true now rather than up to five seconds after it looks at it.
 */
import { parseFleetState, type FleetState } from "./types";

/** Where a transport delivers. Both callbacks are safe to call any number of times. */
export type TransportSink = {
  /** A fresh payload. Called only when the state really was just fetched. */
  onState: (state: FleetState) => void;
  /** A refresh failed, in words a person can act on. The last good state stands. */
  onError: (message: string) => void;
};

/** What a running transport gives its caller back. */
export type TransportHandle = {
  /** Ask for state now, and reset any backoff. Safe to call while one is in flight. */
  refresh: () => void;
  /** Stop, permanently. Must be idempotent. */
  stop: () => void;
};

export type Transport = (sink: TransportSink) => TransportHandle;

/** Every five seconds, which is the number in the plan. */
export const DEFAULT_INTERVAL_MS = 5_000;

/**
 * The ceiling on backoff.
 *
 * **A dashboard that has quietly given up is worse than one that is loud about
 * failing**, so this never becomes "stop trying" — it becomes a minute, which
 * is slow enough not to hammer a box that is already unwell and fast enough
 * that a fixed server is noticed without anybody pressing anything.
 */
export const MAX_INTERVAL_MS = 60_000;

/** Where the state comes from. Relative, so the tool works behind any host. */
export const STATE_URL = "api/state";

/**
 * How long to wait before deciding a fetch is not coming.
 *
 * One collection on the box costs ~12 seconds and the server caches it, so a
 * request that has been open for twenty is not slow, it is lost — and a fetch
 * with no timeout is the specific way a polling page stops updating while
 * looking exactly like one that is up to date.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/** A thrown thing, as a sentence. Never "[object Object]". */
export function describeError(cause: unknown): string {
  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
  if (typeof cause === "string" && cause !== "") return cause;
  return "the request failed, and gave no reason";
}

/**
 * One fetch of the state, parsed.
 *
 * Rejects rather than returning a partial state on three separate failures —
 * the request, the status code, and a body that is not this API's shape — and
 * says which, because "STALE" with no reason is a shrug and this page's whole
 * job is not to shrug.
 */
export async function fetchFleetState(
  url: string = STATE_URL,
  init: RequestInit = {},
): Promise<FleetState> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) {
    throw new Error(`the server answered ${response.status} ${response.statusText}`.trimEnd());
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new Error(`the server's answer was not JSON: ${describeError(cause)}`);
  }
  const state = parseFleetState(body);
  if (state === null) throw new Error("the server answered something that is not the fleet API");
  return state;
}

/**
 * Poll `/api/state`, backing off while it is failing.
 *
 * Three things beyond the timer, all of them about a phone:
 *
 *  - **A hidden tab does not poll.** Greg leaves this open; a backgrounded page
 *    asking a loaded box for a 12-second collection every five seconds is rude,
 *    and the answer would be stale by the time anybody looked at it anyway.
 *  - **Becoming visible refreshes immediately**, which is the moment the number
 *    on screen matters most and the moment it is most likely to be wrong.
 *  - **Coming back online refreshes too**, rather than waiting out a backoff
 *    that was earned while the network was gone.
 *
 * The backoff doubles from `intervalMs` to `MAX_INTERVAL_MS` and resets on the
 * first success, so a server that comes back is picked up within a cycle.
 */
export function pollingTransport(options: {
  url?: string;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
} = {}): Transport {
  const url = options.url ?? STATE_URL;
  const baseInterval = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxInterval = options.maxIntervalMs ?? MAX_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return (sink) => {
    let stopped = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (): void => {
      if (stopped) return;
      clear();
      const wait = Math.min(baseInterval * 2 ** Math.max(0, failures - 1), maxInterval);
      timer = setTimeout(() => void tick(), wait);
    };

    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      // A hidden tab is not a broken one: skip the work, keep the rhythm, and
      // let `visibilitychange` below do the catching up.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      inFlight = true;
      const controller = new AbortController();
      const abort = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const state = await fetchFleetState(url, { signal: controller.signal });
        if (stopped) return;
        failures = 0;
        sink.onState(state);
      } catch (cause) {
        if (stopped) return;
        failures += 1;
        sink.onError(
          controller.signal.aborted
            ? `no answer in ${Math.round(timeoutMs / 1000)}s — the server may be collecting, or gone`
            : describeError(cause),
        );
      } finally {
        clearTimeout(abort);
        inFlight = false;
        schedule();
      }
    };

    const refresh = (): void => {
      failures = 0;
      clear();
      void tick();
    };

    const onVisible = (): void => {
      if (document.visibilityState === "visible") refresh();
    };

    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.addEventListener("online", refresh);

    void tick();

    return {
      refresh,
      stop: () => {
        stopped = true;
        clear();
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
        if (typeof window !== "undefined") window.removeEventListener("online", refresh);
      },
    };
  };
}
