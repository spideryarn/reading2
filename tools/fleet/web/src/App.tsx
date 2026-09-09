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
import { DecisionsPanel } from "./DecisionsPanel";
import { DeploysPanel } from "./DeploysPanel";
import { Dock } from "./Dock";
import { FeedPanel } from "./FeedPanel";
import { Header, SHELL, freshness } from "./Header";
import { HealthPanel } from "./HealthPanel";
import { OverseerPanel } from "./OverseerPanel";
import { QueuePanel } from "./QueuePanel";
import { ReadinessPanel } from "./ReadinessPanel";
import { SessionsPanel } from "./SessionsPanel";
import { UsageCard } from "./UsagePanel";
import { UsageHistory } from "./UsageHistory";
import { httpActionsApi, type ActionsApi } from "./actions-client";
import { httpDecisionsApi, type DecisionsApi } from "./decisions-client";
import {
  FILTER_KEYS,
  filtersFromParams,
  httpFeedApi,
  limitFromParams,
  paramsFromFilters,
  type FeedApi,
} from "./feed-client";
import { httpDeploysApi, type DeploysApi } from "./deploys-client";
import { httpUsageHistoryApi, type UsageHistoryApi } from "./usage-history-client";
import { useDockFit } from "./fit";
import { httpHistoryApi, type HistoryApi } from "./health-history-client";
import { httpMessagesApi, withClockSkew, type MessagesApi } from "./messages-client";
import { useHashState } from "./mode";
import { httpNewSessionApi, type NewSessionApi } from "./new-session-client";
import { httpQueueApi, type QueueApi } from "./queue-client";
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
  feedApi = httpFeedApi,
  decisionsApi = httpDecisionsApi,
  deploysApi = httpDeploysApi,
  usageHistoryApi = httpUsageHistoryApi,
  queueApi = httpQueueApi,
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
   * The cross-agent feed. Injected like the rest, and — like `messagesApi` —
   * deliberately NOT wrapped in a hook here: it is asked for when the tab is
   * open rather than polled, so there is no shared feed for this page to hold.
   * FeedPanel.tsx says why.
   */
  feedApi?: FeedApi;
  /** The decision record, read on demand when its tab is open. */
  decisionsApi?: DecisionsApi;
  /**
   * The deploy record. Injected here as well as defaulted in `DeploysPanel`, so
   * that no test in this file can reach `fetch` by accident — a suite that
   * quietly made real requests would pass and tell you nothing about the seam
   * it thought it was exercising.
   */
  deploysApi?: DeploysApi;
  /** Injected so a test can drive the chart without a network. Same seam as `deploysApi`. */
  usageHistoryApi?: UsageHistoryApi;
  /**
   * The queue of ideas. Injected here as well as defaulted in `QueuePanel`, so
   * that no test in this file can reach `fetch` by accident — a suite that
   * quietly made real requests would pass and tell you nothing about the seam
   * it thought it was exercising.
   */
  queueApi?: QueueApi;
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
  const { mode, params, chooseMode, setParam, setParams, go } = useHashState();
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
  /**
   * Which tmux server the selected handle belongs to, when whoever wrote the URL
   * said — see `onOpenSession` below.
   *
   * **A missing one is not a mismatch.** A hand-typed `#sessions?sel=$1643`, a
   * link from before this existed, or a tap on the list itself all arrive
   * without it, and those must go on resolving exactly as they did. Only a
   * `selpid` that is present AND disagrees is evidence, and only that refuses.
   */
  const selectedPid = ((): number | null => {
    const raw = Number(params["selpid"]);
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
  })();

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
              /* Same as the list below: a card tapped here names a row from the
                 snapshot on screen, so any `selpid` left by an earlier arrival
                 from the feed is cleared rather than left to contradict it. */
              onSelect={(id) => setParams({ sel: id, selpid: null })}
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
              selectedPid={selectedPid}
              /* A tap on the list is a selection made against the snapshot on
                 screen, so there is nothing to carry and nothing to check — the
                 stale `selpid` from an earlier arrival is cleared rather than
                 left to disagree with a handle it no longer describes. */
              onSelect={(id) => setParams({ sel: id, selpid: null })}
              steer={steer}
              rename={rename}
              actions={actions}
              messages={messages}
              newSession={newSession}
              onRefresh={feed.refresh}
            />
          </>
        ) : null}
        {mode === "messages" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            {/* **THE REGISTRATION NOTHING CATCHES.** The four `Record<Mode, …>`
                maps make a half-added mode a compile error; this arm does not,
                because it is a ternary rather than an exhaustive switch. A mode
                registered everywhere but here draws a button, switches the
                hash, and shows an empty page. `tests/fleet-feed-panel.test.tsx`
                asserts this tab renders its panel, which is the only thing that
                would notice. */}
            <FeedPanel
              api={feedApi}
              limit={limitFromParams(params)}
              onLimit={(next) => setParam(FILTER_KEYS.limit, next === 50 ? null : String(next))}
              /* The filters live in the hash for the reason the mode does: this
                 page is reloaded whenever iOS reclaims the tab, and a filter
                 that resets every time is one nobody sets. */
              filters={filtersFromParams(params)}
              onFilters={(next) => {
                /* **ONE WRITE, NOT FOUR.** `setParam` closes over the params it
                   was built with, so four sequential calls all start from the
                   same snapshot and only the last survives — which silently
                   dropped every filter but `hideToolCalls`. mode.ts §
                   `setParams`. */
                setParams(paramsFromFilters(next));
              }}
              /* **THE MODE AND THE SELECTION IN ONE WRITE, for the reason one
                 line up.** `chooseMode("sessions")` followed by
                 `setParam("sel", id)` is the same closed-over-snapshot bug: the
                 second starts from params the first never reached, so one of
                 the two halves is silently thrown away and the reader lands
                 either on an unselected list or on the feed they were already
                 looking at. `go` is the single write — mode.ts § `go`.

                 The feed's own filters ride along untouched, which is what
                 makes the browser's Back button land on the filtered feed
                 rather than on a reset one. */
              /* **THE WORLD TRAVELS WITH THE HANDLE.** `sel` is a tmux session
                 handle and means nothing without the server it belongs to, so
                 `selpid` goes with it and `SessionsPanel` declines to resolve
                 the one against a snapshot of the other. Without this the pid
                 check on the feed row was cosmetic: it proved the join safe and
                 then discarded the proof, leaving the destination to match
                 `$1643` against whatever tmux server it was looking at by the
                 time it rendered. GPT Sol's P0 on the code review.

                 **A feed that named no server sends no `selpid`, and therefore
                 selects nothing** — the reader lands on the Sessions list
                 instead of on a guess. */
              onOpenSession={(id, tmuxServerPid) =>
                tmuxServerPid === null
                  ? go("sessions", { sel: null, selpid: null })
                  : go("sessions", { sel: id, selpid: String(tmuxServerPid) })
              }
              /* **THE SAME ROWS THE SESSIONS TAB DRAWS, so the two tabs cannot
                 say different things about one session.** Not a field on
                 `/api/feed`: a status there would be a second reading of the
                 same tmux output, on a different cadence, kept in step by
                 nothing.

                 **THREE ARMS, AND `rows: []` IS THE LEAST OF THEM.** An empty
                 array is a measurement — *we read the fleet and it holds
                 nobody* — so it may not stand in for the two silences either
                 side of it. `collectedAt === null` is the one that is easy to
                 miss: the server answers a perfectly good payload with no rows
                 for the ten seconds a first collection takes, and reading "not
                 in the session list" off that would call every session on the
                 box absent. It is the same distinction `SessionsPanel` draws
                 between "No sessions." and "Collecting…" a few lines below.
                 GPT Sol's P0 on the plan; feed-client.ts § `SessionListReading`. */
              sessions={
                feed.state === null
                  ? { kind: "not-arrived" }
                  : feed.state.collectedAt === null
                    ? { kind: "not-collected" }
                    : {
                        kind: "collected",
                        rows: feed.state.rows,
                        /* The count that decides whether "not in the list" is a
                           claim or a maybe: a payload that dropped rows it could
                           not parse cannot say a session is absent. */
                        unreadableRows: feed.state.unreadableRows,
                        /* And the one that decides whether the join may happen
                           at all — wire.ts § `FeedPayload.tmuxServerPid`. */
                        tmuxServerPid: feed.state.tmuxServerPid,
                      }
              }
              /* One clock for the page, so this tab's ages tick with every
                 other age on screen — and go on ticking when the poll dies. */
              now={now}
              skew={feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED}
            />
          </div>
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
        {/* **The same `UsageCard` the Overseer tab draws, mounted a second time
            rather than copied.** If this tab and that card could disagree, one
            of them would be a second interpretation of the same bytes — and the
            whole point of the reading rules in tools/overseer/usage.ts is that
            there is one. The history chart lands beneath it in a later stage;
            until then this tab is the card with room around it. */}
        {mode === "usage" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <UsageCard
              usage={feed.state === null ? null : feed.state.usage}
              now={now}
              receivedAt={feed.receivedAt}
              skew={feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED}
            />
            {/* **The history is on its OWN route, not in the snapshot.** It costs
                nothing until somebody opens this tab, and it is written by the
                Overseer daemon rather than by this process — so it cannot ride
                along on the collection loop even if we wanted it to. */}
            <UsageHistory
              api={usageHistoryApi}
              skew={feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED}
              refreshNonce={refreshNonce}
            />
          </div>
        ) : null}
        {mode === "overseer" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <OverseerPanel
              actions={actions}
              rows={rows}
              /* **A PAYLOAD WITH DROPPED ROWS CANNOT SETTLE THE OVERSEER CLAIM,
                 AND CANNOT BACK A CONTROL LABELLED "ALL AGENTS".** Both cards
                 refuse while this is non-zero.

                 **`null` BEFORE A COLLECTION, NOT `0`.** This was `?? 0`, and
                 GPT Sol was right that it is exactly the defect this branch
                 keeps removing: zero is a MEASUREMENT — *we read every row and
                 dropped none* — and before the first payload nothing has been
                 read at all. It prevented a send either way, so nothing was
                 misdelivered; it was still an unmeasured claim wearing a
                 measured claim's clothes. MessageOverseerCard.tsx § the one
                 completeness clause. */
              unreadableRows={feed.state === null ? null : feed.state.unreadableRows}
              /* **`null` BEFORE THE FIRST PAYLOAD, and the payload's own arm
                 after it.** Not `?? { kind: "not-asked" }`, which was here for a
                 review round and collapsed two different silences: *nothing has
                 arrived yet* draws nothing, and *a payload arrived from a server
                 that does not report supervision* is worth a line, because
                 otherwise a rollback puts this tab back to its pre-stage
                 appearance with nothing saying why. GPT Sol's P1. */
              overseer={feed.state === null ? null : feed.state.overseer}
              /* The same distinction one field along, and for the same reason. */
              usage={feed.state === null ? null : feed.state.usage}
              now={now}
              receivedAt={feed.receivedAt}
              skew={feed.state?.clockSkew ?? CLOCK_SKEW_UNMEASURED}
            />
          </div>
        ) : null}
        {/* **Deploys takes no snapshot props, and that is the shape rather than
            an omission.** The deploy record is read on its own route, on its own
            cadence, and costs nothing until somebody opens the tab — the rule in
            fleet-dashboard-modes.md § Where the panel's data comes from: no read
            inside the collection loop. All it needs from here is the page's
            clock, so every age on screen is anchored to the same tick. */}
        {mode === "ideas" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <QueuePanel api={queueApi} refreshNonce={refreshNonce} />
          </div>
        ) : null}
        {mode === "readiness" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <ReadinessPanel nowMs={now} skew={skew.current} refreshNonce={refreshNonce} />
          </div>
        ) : null}

        {mode === "decisions" ? (
          <div className="tw:mx-auto tw:max-w-3xl">
            <DecisionsPanel api={decisionsApi} refreshNonce={refreshNonce} nowMs={now} />
          </div>
        ) : null}

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
