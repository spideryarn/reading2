/**
 * The whole page: a masthead, one of several panels, and a bar along the bottom.
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
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { AttentionPanel } from "./AttentionPanel";
import { DeploysPanel } from "./DeploysPanel";
import { Dock } from "./Dock";
import { Header, SHELL, freshness } from "./Header";
import { HealthPanel } from "./HealthPanel";
import { OverseerPanel } from "./OverseerPanel";
import { SessionsPanel } from "./SessionsPanel";
import { httpActionsApi, type ActionsApi } from "./actions-client";
import { httpDeploysApi, type DeploysApi } from "./deploys-client";
import { useDockFit } from "./fit";
import { httpHistoryApi, type HistoryApi } from "./health-history-client";
import { httpMessagesApi, withClockSkew, type MessagesApi } from "./messages-client";
import { useHashState } from "./mode";
import { httpNewSessionApi, type NewSessionApi } from "./new-session-client";
import { httpRenameApi, type RenameApi } from "./rename-client";
import { httpSteerApi, type SteerApi } from "./steer-client";
import type { Transport } from "./transport";
import { ANSWERING_NOT_REPORTED, CLOCK_SKEW_UNMEASURED, type ClockSkew } from "./types";
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
  historyApi = httpHistoryApi,
  deploysApi = httpDeploysApi,
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
  /**
   * The day of box health. Injected here as well as defaulted in `HealthPanel`,
   * so a test can drive the chart through the whole page rather than through
   * the panel alone — which is what it takes to hold the join between the skew
   * this page measures and the times that chart prints.
   */
  historyApi?: HistoryApi;
  /**
   * The deploy record. Injected here as well as defaulted in `DeploysPanel`, so
   * that no test in this file can reach `fetch` by accident — a suite that
   * quietly made real requests would pass and tell you nothing about the seam
   * it thought it was exercising.
   */
  deploysApi?: DeploysApi;
  /** Only a test passes this, to keep a poll off a fake clock. */
  actionsPollMs?: number;
}): ReactNode {
  const feed = useFleetState(transport);
  /* **THE ONE CLOCK CORRECTION, HELD FOR THE ONE BOUNDARY THAT HAS NO CLOCK OF
     ITS OWN.** `/api/state` carries `servedAt` and everything it holds is
     converted into this browser's terms at the parse boundary; `/api/messages`
     does not, and its `lastModified` is subtracted from the browser's clock in
     two places. Same process, same box, so the skew measured on one route is
     the truth about the other — messages-client.ts § `withClockSkew` argues
     why that beats a second `servedAt` and a second measurement.

     A ref rather than state: the wrapper below must not be rebuilt on every
     poll (that would restart the read on every session card), and what it wants
     is the freshest skew AT THE MOMENT AN ANSWER ARRIVES rather than the one
     the page had when the wrapper was made. */
  const skew = useRef<ClockSkew>(CLOCK_SKEW_UNMEASURED);
  skew.current = feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED;
  const messages = useMemo(() => withClockSkew(messagesApi, () => skew.current), [messagesApi]);
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
  /* **The dock's Refresh means "the page", not "the feed".** Its tooltip
     presents it as the page's refresh control, and until 2026-09-09 it called
     `feed.refresh()` only — so on a panel with its own route, pressing it did
     nothing at all, which is indistinguishable from a broken button on the one
     page whose job is to say whether things are broken. GPT Sol's P2 finding 9.
     A counter rather than a callback registry: a panel that wants to be told
     puts this in its effect's dependencies and needs to know nothing else. */
  const [refreshNonce, setRefreshNonce] = useState(0);
  const refreshEverything = useCallback(() => {
    feed.refresh();
    setRefreshNonce((n) => n + 1);
  }, [feed]);
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
      <Header state={feed.state} fresh={fresh} onRefresh={refreshEverything} />

      {/* The bottom padding is the bar's resting room plus a card's worth of
          air, so the last session does not finish underneath the dock — which
          does not look like a bug, it looks like the list ends there. */}
      <main className={cx(SHELL, "tw:pt-3 tw:pb-[calc(var(--dock-space)+1rem)]")}>
        {mode === "sessions" ? (
          <>
            {/* **ABOVE THE LIST, because it is the answer and the list is the
                material.** A `needs-you` badge means only that Claude Code says
                a dialog is open, and ten of the fifteen sessions really waiting
                on Greg on 2026-09-08 carried no such badge — they had ended a
                turn handing him a decision in sentences. So the ranked inbox
                goes first and the list stays underneath it, unchanged.

                It takes the SAME `onSelect` the list does: tapping a card picks
                that session and the detail pane answers it. There is no second
                write path here — AttentionPanel.tsx, agreement (a).

                It draws nothing at all when the server did not look, which is
                what every payload from before this field says. */}
            <AttentionPanel
              attention={feed.state?.attention ?? { kind: "not-asked" }}
              now={now}
              /* The panel's ages are anchored to the later of this and `now`,
                 so a tab that iOS froze for a minute does not judge a
                 just-arrived checkpoint against the clock it fell asleep with —
                 AttentionPanel.tsx § `ageMs`. */
              receivedAt={feed.receivedAt}
              onSelect={(id) => setParam("sel", id)}
            />
            {/* **`collected` is not `rows.length > 0`, and that is the point.**
                An empty list is only a claim about the box once a collection has
                finished; before that the server answers `rows: []` with
                `collectedAt: null`, and drawing "No sessions." over it would
                tell Greg the box is idle while thirty-six agents run on it. */}
            <SessionsPanel
              rows={rows}
              now={now}
              collected={feed.state?.collectedAt != null}
              unreadableRows={feed.state?.unreadableRows ?? 0}
              /* **NEITHER DEFAULT IS `false`/`0`.** Before the first payload
                 arrives this page has been told nothing, and inventing `false`
                 here would print "answering is switched off" over a server that
                 has said no such thing — the mirror of the drop this stage
                 repairs. `ANSWERING_NOT_REPORTED` says the true thing instead,
                 and withholds the control while it says it. types.ts §
                 `AnsweringReading`. */
              answeringEnabled={feed.state?.answeringEnabled ?? ANSWERING_NOT_REPORTED}
              tmuxServerPid={feed.state?.tmuxServerPid ?? null}
              order={order}
              onOrder={(next) => setParam("order", next === "status" ? null : next)}
              selectedId={selectedId}
              onSelect={(id) => setParam("sel", id)}
              steer={steer}
              rename={rename}
              actions={actions}
              messages={messages}
              newSession={newSession}
              onRefresh={feed.refresh}
            />
          </>
        ) : null}
        {mode === "health" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <HealthPanel
              health={feed.state?.health ?? null}
              actions={actions}
              historyApi={historyApi}
              /* **THE CHART'S LABELS ARE WALL-CLOCK TIMES**, so they are the
                 reader's to read off their own watch — and the masthead above
                 says the times on this page are corrected. A chart labelled on
                 the box's clock would disagree with both. Only the labels move:
                 the geometry is server-to-server arithmetic and is right as it
                 is (HealthHistory.tsx § `timeLabel`). */
              skew={feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED}
            />
          </div>
        ) : null}
        {mode === "overseer" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <OverseerPanel
              actions={actions}
              rows={rows}
              /* **`null` BEFORE THE FIRST PAYLOAD, and the payload's own arm
                 after it.** Not `?? { kind: "not-asked" }`, which was here for a
                 review round and collapsed two different silences: *nothing has
                 arrived yet* draws nothing, and *a payload arrived from a server
                 that does not report supervision* is worth a line, because
                 otherwise a rollback puts this tab back to its pre-stage
                 appearance with nothing saying why. GPT Sol's P1. */
              overseer={feed.state === null ? null : feed.state.overseer}
              now={now}
              receivedAt={feed.receivedAt}
            />
          </div>
        ) : null}
        {/* **Deploys takes no snapshot props, and that is the shape rather than
            an omission.** The deploy record is read on its own route, on its own
            cadence, and costs nothing until somebody opens the tab — the rule in
            fleet-dashboard-modes.md § Where the panel's data comes from: no read
            inside the collection loop. All it needs from here is the page's
            clock, so every age on screen is anchored to the same tick. */}
        {mode === "deploys" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <DeploysPanel api={deploysApi} now={now} refreshNonce={refreshNonce} />
          </div>
        ) : null}
      </main>

      <Dock
        mode={mode}
        onChoose={chooseMode}
        needsYou={needsYou}
        onRefresh={refreshEverything}
        fitClass={fitClass}
        barRef={dockRef}
      />
    </div>
  );
}
