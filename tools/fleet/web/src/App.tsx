/**
 * The whole page: a masthead, one of three panels, and a bar along the bottom.
 *
 * **Phone first, and now a desk too.** Greg reads this on a phone over
 * Tailscale, so the layout starts as a single column and the mode switch is at
 * the bottom where a thumb is. What changed on 2026-09-08 is the other end: at
 * 1280px the page used to draw a 740px column with the rest of the window
 * empty, which reads as unfinished rather than as deliberate. The session list
 * now takes the room — measured, not at a breakpoint (fit.ts) — and the two
 * other panels stay at a reading measure, because a definition list stretched
 * across 1600px is worse than one that is not.
 *
 * **Nothing here fetches.** `useFleetState` is the only thing that knows where
 * state comes from, and swapping polling for Server-Sent Events is one default
 * argument in that file (see transport.ts § The seam). The `transport` prop
 * below exists so a test can drive the page without a clock or a network, and
 * it is the same seam.
 */
import type { ReactNode } from "react";

import { Dock } from "./Dock";
import { Header, SHELL, freshness } from "./Header";
import { HealthPanel } from "./HealthPanel";
import { OrchestratorPanel } from "./OrchestratorPanel";
import { SessionsPanel } from "./SessionsPanel";
import { httpActionsApi, type ActionsApi } from "./actions-client";
import { useDockFit } from "./fit";
import { httpMessagesApi, type MessagesApi } from "./messages-client";
import { useHashState } from "./mode";
import { httpNewSessionApi, type NewSessionApi } from "./new-session-client";
import { httpRenameApi, type RenameApi } from "./rename-client";
import { httpSteerApi, type SteerApi } from "./steer-client";
import type { Transport } from "./transport";
import { cx } from "./ui";
import { useActions } from "./useActions";
import { useFleetState } from "./useFleetState";
import { useNow } from "./useNow";
import { parseOrdering, tally } from "./view";

export function App({
  transport,
  steer = httpSteerApi,
  newSession = httpNewSessionApi,
  rename = httpRenameApi,
  actionsApi = httpActionsApi,
  messagesApi = httpMessagesApi,
  actionsPollMs,
}: {
  transport?: Transport;
  /** The write paths, injected for the same reason `transport` is. */
  steer?: SteerApi;
  newSession?: NewSessionApi;
  rename?: RenameApi;
  actionsApi?: ActionsApi;
  /**
   * The transcript reader. Injected like the rest, and deliberately NOT wrapped
   * in a hook here: it is asked once per opened session rather than polled, so
   * there is no shared feed for the page to hold. RecentMessages.tsx says why.
   */
  messagesApi?: MessagesApi;
  /** Only a test passes this, to keep a poll off a fake clock. */
  actionsPollMs?: number;
}): ReactNode {
  const feed = useFleetState(transport);
  /* The second feed: the action vocabulary and the queues. A different
     resource with a different cost and a different clock — see useActions.ts.
     **It never asks /api/state**, which is what keeps the server's guards from
     comparing the box with itself. */
  const actions = useActions(actionsApi, actionsPollMs);
  /* One clock for the whole page, ticking once a second, so that every age on
     screen agrees — and so that "12s ago" keeps counting when the poll has
     died. An age that only moves when data arrives is an age that freezes at
     the exact moment it matters. */
  const now = useNow();
  const { mode, params, chooseMode, setParam } = useHashState();
  /* Both of these live in the URL for the reason the mode does: this page is
     reloaded by the browser whenever iOS reclaims the tab, and a sort order
     that resets every time is one nobody bothers to set. mode.ts § the hash. */
  const order = parseOrdering(params["order"]);
  const selectedId = params["sel"] ?? null;

  const fresh = freshness({
    state: feed.state,
    receivedAt: feed.receivedAt,
    error: feed.error,
    failures: feed.failures,
    cadenceMs: feed.cadenceMs,
    now,
  });

  const rows = feed.state?.rows ?? [];
  const needsYou = tally(rows).needsYou;

  /* The two things that change how wide the bar's row wants to be: which mode
     is on (the active button keeps its label at every rung) and how many digits
     the badge carries. **If a future change widens the row without changing
     this string, this is the line to add it to** — see fit.ts. */
  const { ref: dockRef, fitClass } = useDockFit(`${mode}:${needsYou}`);

  return (
    <div className="tw:min-h-dvh tw:bg-page">
      <Header state={feed.state} fresh={fresh} onRefresh={feed.refresh} />

      {/* The bottom padding is the bar's resting room plus a card's worth of
          air, so the last session does not finish underneath the dock — which
          does not look like a bug, it looks like the list ends there. */}
      <main className={cx(SHELL, "tw:pt-3 tw:pb-[calc(var(--dock-space)+1rem)]")}>
        {mode === "sessions" ? (
          /* **`collected` is not `rows.length > 0`, and that is the point.** An
             empty list is only a claim about the box once a collection has
             finished; before that the server answers `rows: []` with
             `collectedAt: null`, and drawing "No sessions." over it would tell
             Greg the box is idle while thirty-six agents run on it. */
          <SessionsPanel
            rows={rows}
            now={now}
            collected={feed.state?.collectedAt != null}
            unreadableRows={feed.state?.unreadableRows ?? 0}
            order={order}
            onOrder={(next) => setParam("order", next === "status" ? null : next)}
            selectedId={selectedId}
            onSelect={(id) => setParam("sel", id)}
            steer={steer}
            rename={rename}
            actions={actions}
            messages={messagesApi}
            newSession={newSession}
            onRefresh={feed.refresh}
          />
        ) : null}
        {mode === "health" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <HealthPanel health={feed.state?.health ?? null} actions={actions} />
          </div>
        ) : null}
        {mode === "orchestrator" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <OrchestratorPanel actions={actions} rows={rows} />
          </div>
        ) : null}
      </main>

      <Dock
        mode={mode}
        onChoose={chooseMode}
        needsYou={needsYou}
        onRefresh={feed.refresh}
        fitClass={fitClass}
        barRef={dockRef}
      />
    </div>
  );
}
