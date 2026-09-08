/**
 * The whole page: a masthead, three tabs, and one of three panels.
 *
 * **Phone first.** Greg reads this on a phone over Tailscale, so the layout is
 * a single column that is allowed to grow to a comfortable measure on a desk —
 * `max-w-3xl` and nothing else. There are no breakpoints and no columns to give
 * up; a design that starts narrow and widens cannot be wrong on the device it
 * was designed for, which is the failure mode of doing it the other way round.
 *
 * **Nothing here fetches.** `useFleetState` is the only thing that knows where
 * state comes from, and swapping polling for Server-Sent Events is one default
 * argument in that file (see transport.ts § The seam). The `transport` prop
 * below exists so a test can drive the page without a clock or a network, and
 * it is the same seam.
 */
import type { ReactNode } from "react";

import { Header, freshness } from "./Header";
import { HealthPanel } from "./HealthPanel";
import { OrchestratorPanel } from "./OrchestratorPanel";
import { SessionsPanel } from "./SessionsPanel";
import { useMode } from "./mode";
import type { Transport } from "./transport";
import { useFleetState } from "./useFleetState";
import { useNow } from "./useNow";

export function App({ transport }: { transport?: Transport }): ReactNode {
  const feed = useFleetState(transport);
  /* One clock for the whole page, ticking once a second, so that every age on
     screen agrees — and so that "12s ago" keeps counting when the poll has
     died. An age that only moves when data arrives is an age that freezes at
     the exact moment it matters. */
  const now = useNow();
  const [mode, chooseMode] = useMode();

  const fresh = freshness({
    state: feed.state,
    receivedAt: feed.receivedAt,
    error: feed.error,
    failures: feed.failures,
    now,
  });

  return (
    <div className="tw:min-h-dvh tw:bg-page">
      <Header
        state={feed.state}
        fresh={fresh}
        mode={mode}
        onChoose={chooseMode}
        onRefresh={feed.refresh}
      />
      <main className="tw:mx-auto tw:max-w-3xl tw:px-3 tw:pb-10">
        {mode === "sessions" ? <SessionsPanel rows={feed.state?.rows ?? []} now={now} /> : null}
        {mode === "health" ? <HealthPanel health={feed.state?.health ?? null} /> : null}
        {mode === "orchestrator" ? <OrchestratorPanel /> : null}
      </main>
    </div>
  );
}
