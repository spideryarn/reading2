// @vitest-environment jsdom
/**
 * The fleet dashboard's React client, actually rendered — tools/fleet/web/.
 *
 * **What this file is for.** The page it replaces was a hand-built HTML string,
 * and its tests could assert on that string. This one asserts on the DOM,
 * because the three things the page must never get wrong are all things you can
 * only see once it is mounted:
 *
 *   1. **a blocked session is above a working one.** That ordering is the whole
 *      product — it is why Greg opens this on a phone — and it is decided in
 *      two places (`triageSort` and the banding in SessionsPanel), so a test on
 *      the sort function alone would not catch a panel that grouped them the
 *      other way round.
 *   2. **a failed poll says STALE and keeps the rows.** A page that has stopped
 *      updating and looks current is the failure mode this whole tool exists to
 *      prevent, and "keeps the rows" is the half that is easy to lose: the
 *      obvious `setState(null)` on error is one character and empties the
 *      fleet.
 *   3. **an `unknown` status shows its reason.** `unknown` sorts into the quiet
 *      band, so the reason is the only thing that distinguishes "nothing is
 *      happening" from "nobody could ask" — see tools/fleet/status.ts, whose
 *      whole design is about that distinction.
 *
 * **The transport is injected, not stubbed at `fetch`.** `App` takes one, so
 * these tests push a state or an error straight in and never touch a timer or a
 * network. That is not merely convenient: it is the same seam an SSE transport
 * will use, so the tests exercise the extension point rather than the current
 * implementation of it. `fetchFleetState` is tested separately against a
 * stubbed `fetch`, because parsing an answer is a different job from delivering
 * one.
 */
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Profiler, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import type { DeploysApi, DeploysView } from "../tools/fleet/web/src/deploys-client";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";
import { freshness } from "../tools/fleet/web/src/Header";
import { POLL_GIVE_UP_MS, POLL_MS } from "../tools/fleet/web/src/NewSessionPanel";
import { BoxActions } from "../tools/fleet/web/src/ActionButtons";
import { STATUS_TIPS } from "../tools/fleet/web/src/SessionParts";
import {
  COLUMN_MIN_PX,
  DETAIL_MIN_PX,
  PANE_GAP_PX,
  chooseColumns,
  chooseDockFit,
  choosePanes,
  spreadIntoColumns,
} from "../tools/fleet/web/src/fit";
import {
  cancelBody,
  makeActionsApi,
  parseAction,
  parseActionsFeed,
  parseBoxEffect,
  parseQueue,
  sessionActions,
  boxActions,
  sessionActionBody,
  sessionMessageBody,
  type ActionsApi,
} from "../tools/fleet/web/src/actions-client";
import {
  MESSAGES_URL,
  STALE_TRANSCRIPT_MS,
  makeMessagesApi,
  messagesUrl,
  parseRecentMessages,
  transcriptAge,
  withClockSkew,
  type MessagesApi,
} from "../tools/fleet/web/src/messages-client";
import { makeNewSessionApi, parseLaunch, type NewSessionApi } from "../tools/fleet/web/src/new-session-client";
import { looksLikeAName, makeRenameApi, renameBody, type RenameApi } from "../tools/fleet/web/src/rename-client";
import {
  checkLanding,
  makeSteerApi,
  parseDelivery,
  parseVerified,
  steerMessageBody,
  type SteerApi,
  type SteerOutcome,
} from "../tools/fleet/web/src/steer-client";
import type { HealthSampleView, HistoryApi, HistoryView } from "../tools/fleet/web/src/health-history-client";
import { readHealthStats } from "../tools/fleet/web/src/health-view";
import { fetchFleetState } from "../tools/fleet/web/src/transport";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import {
  CLOCK_SKEW_UNMEASURED,
  parseAttention,
  parseFleetState,
  parsePause,
  parseStatus,
  readClockSkew,
  shiftToBrowserClock,
  type AttentionItem,
  type ClockSkew,
  type AttentionList,
  type FleetState,
  type FleetStatus,
} from "../tools/fleet/web/src/types";
/* The NODE side, imported into a jsdom test on purpose: the join test below
   walks a checkpoint on a real disk through the real reader and the real
   payload composer before it renders anything. `statePayload` is the function
   `server.ts` calls — it lives in state.ts precisely so a test can drive it,
   because server.ts binds ports at import time and can never be imported. */
import { readCheckpointFeeds } from "../tools/fleet/overseer-status";
import { statePayload } from "../tools/fleet/state";
/* **THE PRODUCER'S OWN TYPE, ON THE FIXTURES THAT CLAIM TO BE ITS OUTPUT.**
   `actionsWire()` in this file once built `{actions: []}` — a flat array the
   route has never sent — and ~196 tests passed over it while every action
   button on the real page was invisible, under a doc comment correctly saying
   the fixture had to be the wire shape. A fixture is a claim about the producer
   that nothing checks against the producer, unless it is annotated with the
   producer's type. `Partial<>`, because most of these fixtures are deliberately
   payloads from an OLDER server; what the annotation buys is that every field
   they do name is a field the server really sends, spelled the way it spells
   it. A fixture that is deliberately malformed says so — see `malformed`. */
import type { FleetState as FleetStateWire } from "../tools/fleet/wire";
import {
  CONSEQUENCE_RANK,
  CONSEQUENCE_TONE,
  ORDERINGS,
  TONE_ALARM,
  clockNote,
  sortRows,
  triageSort,
} from "../tools/fleet/web/src/view";

/* React wants this set before anything is rendered inside `act`, and vitest's
   jsdom environment does not set it. Written as a cast rather than a `declare
   global`, which is how the rest of tests/ spells it. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A row, with only the interesting field named at each call site.
 *
 * `rawStatus` and `rawQuestion` are DERIVED from the parsed fields rather than
 * defaulted, so a test that names a status gets a row whose wire object agrees
 * with it — which is what the page sends. A caller that wants them to disagree,
 * or wants a field this build has never heard of in there, passes them
 * explicitly: they are spread last on purpose.
 */
function row(over: Partial<FleetState["rows"][number]> & { id: string }): FleetState["rows"][number] {
  const question = over.question ?? null;
  return {
    paneId: null,
    name: over.id,
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    status: { kind: "idle" },
    question: null,
    /* The arm `parsePermissionMode` produces for a server that said nothing,
       so a fixture that does not care about the launch mode gets the same row
       the page would build off a payload that omitted the field. Naming `auto`
       here would make every fixture assert a healthy launch by accident. */
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    /* Same argument as `permissionMode` above, and it matters more here.
       `parsePause` returns this arm for a server that sent no `pause` field, so
       a fixture that does not care gets the row the page would really build.
       Defaulting to `{ kind: "none" }` would make every fixture quietly assert
       "we looked everywhere and this session is waiting for nothing", which is
       a positive claim no fixture is in a position to make. */
    pause: {
      kind: "cannot-tell",
      why: "the fixture did not say",
      cause: "rate-limits-not-collected",
    },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: null,
    claudeSessionId: null,
    rawStatus: over.status ?? { kind: "idle" },
    rawQuestion:
      question === null ? null : { kind: "question", prompt: question.prompt, options: question.options },
    ...over,
  };
}

/**
 * A row that can actually be steered, with the three identifiers filled in.
 *
 * Separate from `row` rather than folded into it, so that the tests which do
 * NOT name these still get nulls — a page that quietly worked because every
 * fixture happened to be addressable would say nothing about the real one.
 */
function steerable(over: Partial<FleetState["rows"][number]> & { id: string }): FleetState["rows"][number] {
  return row({
    paneId: "%2108",
    panePid: 4242,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    ...over,
  });
}

function state(over: Partial<FleetState> = {}): FleetState {
  return {
    /* NOW, NOT A DATE. This was `new Date("2026-09-08T12:00:00Z")`, which was
       "now" on the morning it was written and stopped being so at 12:02:30Z
       the same day — the moment the snapshot passed the 2m 30s staleness
       threshold. Three rendering tests then started asserting `not.toContain
       ("STALE")` against a page that had begun, correctly, to say STALE. The
       tests were right about the page and wrong about the clock.
       A fixture that means "fresh" has to be computed from the clock the
       component reads, because freshness is a relation between two times and
       an absolute constant can only ever be one of them. The tests that want
       an OLD snapshot pass both times explicitly — see `freshness` below — and
       are unaffected. */
    collectedAt: new Date().toISOString(),
    tookMs: 12_000,
    error: null,
    rows: [],
    unreadableRows: 0,
    health: null,
    /* The server does not send this yet. `null` is what the parser produces
       when it is absent, and the staleness threshold then falls back to the
       cadence the page has watched happen — see `freshness`. */
    refreshMs: null,
    /* Same argument as `pause` above. `not-asked` is what `parseAttention`
       produces for a payload with no `attention` field, so a fixture that does
       not care about the inbox gets the page the client would really build —
       and the panel draws nothing, which is why every existing assertion about
       what is on screen still means what it meant. Defaulting to
       `no-coordinator` would make every fixture quietly assert that
       `~/.overseer/` was looked at and is empty. */
    attention: { kind: "not-asked" },
    /* And the same for the Overseer's own status: `not-asked` is what
       `parseOverseer` produces for a payload with no `overseer` field, so a
       fixture that does not care gets the page an older server would really
       draw. It is not silent — the card says this server did not report
       supervision — but it is one quiet line on the Overseer tab, which no
       assertion in this file reads. Anything else would have each fixture
       quietly asserting that this server looked at `~/.overseer/`. */
    overseer: { kind: "not-asked" },
    /* And the account's usage, on the same argument: `not-asked` draws one
       quiet line on the Overseer tab, and any other default would have every
       fixture in this file silently claiming a usage pass had run. */
    usage: { kind: "not-asked" },
    /* Same argument again. `readClockSkew` produces this for a payload with no
       `servedAt`, so a fixture that does not care about clocks gets the state
       the page would really build off an older server — and nothing is shifted.
       A fixture that names a skew passes one. */
    clockSkew: CLOCK_SKEW_UNMEASURED,
    /* **BOTH OF THESE ARRIVED HERE AS COMPILE ERRORS**, which is the whole
       point of v0.8b: `FleetState` is now `Omit<>` of the wire type, so a field
       the server sends and this fixture does not mention stops the build.
       Before that, this object was a hand-written twin and the two fields the
       server had been sending for a day were simply absent from it — and from
       the page.

       `not-reported` for `answeringEnabled` rather than `enabled`, for the same
       reason `attention` above is `not-asked`: it is what `parseFleetState`
       produces for a payload that does not carry the field, so a fixture that
       does not care about the flag gets the page a real older server would draw.

       **Since GPT Sol's M3 that arm withholds the answer buttons**, so a test
       about answering has to say `{ kind: "enabled" }` out loud — which is the
       right way round. The buttons are the one control the page fails CLOSED on
       (types.ts § `AnsweringReading`: the kill switch is older than the field,
       so silence is not evidence that a tap would land), and a fixture that
       silently supplied permission would be testing a page nobody runs.
       `tmuxServerPid` is a real-looking pid because the tmux server on this box
       is pid 132280 and the detail pane prints it verbatim. */
    answeringEnabled: { kind: "not-reported" },
    /* Same argument as `pause` and `attention` above: `not-reported` is what
       `readAttemptClock` returns for a payload that has collected but carries no
       attempt clock, so a fixture that does not care gets the reading the page
       would really build off an older server. `never-attempted` would be a
       positive claim — *this collector has not started one* — that no fixture is
       in a position to make, and `attempted` would quietly assert the loop is
       alive in every staleness test. tools/fleet/attempt-clock.ts. */
    attemptedAt: { kind: "not-reported", why: "the fixture did not say" },
    tmuxServerPid: 132280,
    ...over,
  };
}

/**
 * A transport a test drives by hand.
 *
 * `stopped` is counted rather than ignored: React's StrictMode double-invokes
 * effects, and a transport whose teardown did nothing would leave two of these
 * running with nothing on screen to say so.
 */
/**
 * A deploy record that answers whatever the test says.
 *
 * Injected into `<App>` like every other seam here, so no test in this file can
 * reach `fetch` — the panel's default is the real HTTP client, and a suite that
 * quietly made real requests would pass while telling you nothing.
 */
function recordingDeploys(
  replyOf: () => DeploysView = () => deploysView(),
): { api: DeploysApi; asked: number[] } {
  const asked: number[] = [];
  const api: DeploysApi = {
    fetch: async (limit) => {
      asked.push(limit);
      return replyOf();
    },
  };
  return { api, asked };
}

/** A healthy git snapshot. Spread it when overriding one reading, so the other two survive. */
function healthyGit(): Extract<DeploysView, { kind: "deploys" }>["git"] {
  return {
    main: {
      kind: "ref",
      sha: "8985e7b682d197e6eb48c9c5dfd07eb30eccd57c",
      committedAt: "2026-09-09T00:32:12Z",
      lastFetchAtMs: 1_788_912_000_000,
    },
    ancestry: { kind: "ancestor" },
    commitsSince: { kind: "count", commits: 287 },
  };
}

/** A readable record with one deploy in it, and anything the caller overrides. */
function deploysView(over: Partial<Extract<DeploysView, { kind: "deploys" }>> = {}): DeploysView {
  return {
    schema: 1,
    kind: "deploys",
    versions: [
      {
        version: "2026-09-08T05:32:17Z",
        release: 74,
        deploymentId: "dpl_test",
        sha: "8cd2206ae24e16c65f76ea9f954c5b300616cd57",
        previousSha: "3b4d32f0a1b2c3d4e5f60718293a4b5c6d7e8f90",
        commitCount: 137,
        invisible: false,
        changelogReadable: true,
        unreadableEntries: 0,
        generatedAt: "2026-09-08T07:06:51Z",
        entries: [
          {
            section: "headline",
            title: "Hover cards on links",
            body: "See where a link goes before you follow it.",
            where: "/read",
            commits: [],
          },
        ],
      },
    ],
    total: 74,
    limit: 10,
    unreadable: [],
    recordLines: 74,
    lastGeneratedAt: "2026-09-08T07:06:51Z",
    newestRecordedSha: "8cd2206ae24e16c65f76ea9f954c5b300616cd57",
    git: healthyGit(),
    servedAtMs: 1_788_912_000_000,
    ...over,
  };
}

function manualTransport(): {
  transport: Transport;
  push: (next: FleetState) => void;
  fail: (message: string) => void;
  refreshes: () => number;
  stops: () => number;
} {
  let sink: TransportSink | null = null;
  let refreshes = 0;
  let stops = 0;
  const transport: Transport = (s) => {
    sink = s;
    return {
      refresh: () => {
        refreshes += 1;
      },
      stop: () => {
        stops += 1;
        sink = null;
      },
    };
  };
  return {
    transport,
    push: (next) => sink?.onState(next),
    fail: (message) => sink?.onError(message),
    refreshes: () => refreshes,
    stops: () => stops,
  };
}

/**
 * A payload off the wire, parsed.
 *
 * `schema: 1` is supplied because every real payload has it and a fixture
 * without one is now refused outright — which is the point of `parseFleetState`
 * since GPT Sol's F15, and would otherwise turn every parser test into a test
 * of the schema check.
 *
 * It throws rather than returning `undefined`, so a fixture this build cannot
 * read fails as itself instead of as a chain of optional accesses that quietly
 * assert nothing.
 */
/* **BOTH HOLES ARE `unknown` HERE, AND THAT IS THE FIXTURE'S HONEST ANSWER.**
   This used to name neither and inherit two `= unknown` defaults from the wire
   type; those defaults are gone (GPT Sol's M2), because a caller inheriting a
   hole it did not know about is how a hole stops being reviewed. A payload
   fixture is raw JSON on its way into `parseFleetState`, so `unknown` is what
   its rows and its health genuinely are — not a placeholder. */
type WirePayload = {
  [K in keyof FleetStateWire<unknown, unknown>]?: FleetStateWire<unknown, unknown>[K] | undefined;
};

function wire(over: WirePayload): FleetState {
  const read = parseFleetState({ schema: 1, rows: [], ...over }, Date.now());
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

/**
 * **A PAYLOAD THAT IS DELIBERATELY NOT THE WIRE SHAPE**, for the tests that are
 * about the parser refusing one.
 *
 * The escape hatch from `wire()`'s annotation, and it is a separate name rather
 * than a cast so that reaching for it is visible in the diff: every call is a
 * test asserting what this page does with a value the server would never send.
 * `wire()` stays typed, so a fixture that means to be honest cannot be wrong by
 * accident — which is the failure `actionsWire()` shipped.
 */
function malformed(over: Record<string, unknown>): FleetState {
  const read = parseFleetState({ schema: 1, rows: [], ...over }, Date.now());
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.location.hash = "";
  vi.restoreAllMocks();
});

/**
 * The page, with every write path faked.
 *
 * All four seams are injected rather than left to their defaults, so that no
 * test in this file can reach `fetch` by accident — a suite that quietly made
 * real requests would pass and would tell you nothing about the seams it
 * thought it was exercising. The handful of tests that DO want the real wire
 * stub `fetch` and render `<App>` themselves.
 */
function mount(transport: Transport, deploysApi: DeploysApi = recordingDeploys().api): void {
  act(() =>
    root.render(
      <App
        transport={transport}
        rename={fakeRename()}
        actionsApi={recordingActions().api}
        messagesApi={recordingMessages().api}
        deploysApi={deploysApi}
        actionsPollMs={3_600_000}
      />,
    ),
  );
}

/** Every card's heading, in the order they appear on the page. */
function titlesOnScreen(): string[] {
  return [...container.querySelectorAll("h3")].map((h) => h.textContent ?? "");
}

describe("the list", () => {
  it("puts a blocked session above a working one, whatever order they arrive in", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            /* The working row is FIRST in the payload and NEWER, so both the
               array order and the within-band recency tiebreak would put it on
               top if the banding were not doing its job. */
            row({
              id: "$works",
              title: "busy refactoring",
              status: { kind: "working" },
              startedAt: new Date("2026-09-08T11:59:00Z").toISOString(),
            }),
            row({
              id: "$blocked",
              title: "waiting on you",
              status: { kind: "needs-you" },
              startedAt: new Date("2026-09-08T09:00:00Z").toISOString(),
            }),
          ],
        }),
      ),
    );

    expect(titlesOnScreen()).toEqual(["waiting on you", "busy refactoring"]);
    expect(container.textContent).toContain("Needs you");
    expect(container.textContent).toContain("1 need you");
  });

  it("renders a blocked session's question and every option it could read", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$blocked",
              title: "asking about an edit",
              status: { kind: "needs-you" },
              question: {
                prompt: "Do you want to make this edit to server.ts?",
                material: { kind: "read", text: "- const a = 1;\n+ const a = 2;", fingerprint: "sha256:abc" },
                options: [
                  { label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" },
                  { label: "Yes, and don't ask again", key: { via: "digit", digit: "2" }, consequence: "persistent" },
                  { label: "No, tell Claude what to do differently", key: { via: "selected" }, consequence: "decline" },
                ],
                gate: { kind: "permission", why: "one of the options would stop it asking again" },
              },
            }),
          ],
        }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Do you want to make this edit to server.ts?");
    expect(text).toContain("Yes, and don't ask again");
    expect(text).toContain("No, tell Claude what to do differently");
    // The keystroke is a HINT, not a button. This page sends nothing, and a
    // control that looked like it would answer and did not is the failure
    // overseer-direction.md § Read-only until a channel is proven is about.
    expect(text).toContain("press 2");

    /* **No option is clickable.** This used to be spelled as a count of every
       button on the page — 4, being Refresh and the three tabs — which stopped
       meaning anything the moment the page grew controls that are not actions:
       the mode bar, and the status pills that open an explanation. A count
       cannot tell those apart from a button that answers a prompt, so it is
       asserted directly: no button on the page carries an option's words.
       Rewritten 2026-09-08 when the tabs became the dock. */
    const buttonLabels = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    for (const option of ["Yes", "Yes, and don't ask again", "No, tell Claude what to do differently"]) {
      expect(buttonLabels.some((label) => label.includes(option))).toBe(false);
    }
  });

  it("shows an unknown status's reason rather than a shrug", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$mystery",
              title: "nobody could ask",
              status: { kind: "unknown", why: "could not say what Claude is doing: claude: command not found" },
            }),
          ],
        }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("claude: command not found");
    // And it is counted separately in the header, not folded into "quiet": a
    // failed agents call turns every Claude row unknown at once, and "0 need
    // you" over a page of unanswerable rows is the lie status.ts prevents.
    expect(text).toContain("1 unknown");
  });

  it("says so when there is nothing to show, instead of drawing an empty page", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [] })));
    expect(container.textContent).toContain("No sessions.");
  });

  it("does not call an uncollected fleet an empty one", () => {
    /* **The lie this is here to stop.** For the ten seconds after a restart the
       server answers `rows: []` with `collectedAt: null` and no error at all —
       so the obvious rendering tells Greg, on a phone, that the box is idle
       while three dozen agents run on it. An empty list is only a claim about
       the box once something has been collected. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [], collectedAt: null })));

    const text = container.textContent ?? "";
    expect(text).toContain("Collecting…");
    expect(text).toContain("not an empty fleet");
    expect(text).not.toContain("No sessions.");
    // And it is not an alarm either: nothing has aged, so there is nothing yet
    // to disbelieve.
    expect(text).not.toContain("STALE");
  });

  it("shows the full working directory, which is the only thing that tells two worktrees apart", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$a",
              repo: "spideryarn/reading2",
              worktree: "fleet-dashboard-v01",
              meta: {
                version: 1,
                kind: "worktree",
                repo: "spideryarn/reading2",
                dir: "/home/greg/code/spideryarn2/.claude/worktrees/fleet-dashboard-v01",
              },
            }),
          ],
        }),
      ),
    );
    expect(container.textContent).toContain("/home/greg/code/spideryarn2/.claude/worktrees/fleet-dashboard-v01");
  });

  it("shows nothing extra for a session that recorded no directory", () => {
    /* A `legacy` session has nothing to say, and a page that drew an empty
       field or an apology for one would be worse than a page that draws the
       name and stops. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", repo: "spideryarn/reading2" })] })));
    expect(container.textContent).toContain("spideryarn/reading2");
    expect(container.textContent).not.toContain("Where it is running");
  });

  it("parses a meta it does not recognise as legacy rather than half-reading it", () => {
    expect(wire({ rows: [{ id: "$a", meta: { version: 2, path: "/somewhere" } }] }).rows[0]?.meta).toEqual({
      version: "legacy",
    });
    expect(wire({ rows: [{ id: "$a" }] }).rows[0]?.meta).toEqual({ version: "legacy" });
    expect(
      wire({ rows: [{ id: "$a", meta: { version: 1, kind: "worktree", repo: "r", dir: "/d" } }] }).rows[0]?.meta,
    ).toEqual({ version: 1, kind: "worktree", repo: "r", dir: "/d" });
  });
});

describe("staleness", () => {
  it("keeps the last good rows when a refresh fails, and says STALE with the reason", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", title: "still here", status: { kind: "working" } })] })));
    expect(container.textContent).toContain("still here");
    expect(container.textContent).not.toContain("STALE");

    act(() => feed.fail("connect ECONNREFUSED 127.0.0.1:8787"));

    const text = container.textContent ?? "";
    expect(text).toContain("STALE");
    expect(text).toContain("connect ECONNREFUSED 127.0.0.1:8787");
    // THE HALF THAT IS EASY TO LOSE. A fleet you cannot currently reach is not
    // an empty fleet.
    expect(text).toContain("still here");
    expect(titlesOnScreen()).toEqual(["still here"]);
  });

  it("counts repeated failures, and offers a button rather than retrying in silence", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", status: { kind: "idle" } })] })));
    act(() => feed.fail("timed out"));
    act(() => feed.fail("timed out"));
    act(() => feed.fail("timed out"));

    expect(container.textContent).toContain("3 attempts in a row");

    const tryNow = [...container.querySelectorAll("button")].find((b) => b.textContent === "Try now");
    expect(tryNow).toBeDefined();
    act(() => tryNow?.click());
    expect(feed.refreshes()).toBe(1);
  });

  it("recovers: a success after failures clears the banner and the count", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.fail("gone"));
    expect(container.textContent).toContain("STALE");
    act(() => feed.push(state({ rows: [row({ id: "$a", title: "back", status: { kind: "working" } })] })));
    expect(container.textContent).not.toContain("STALE");
    expect(container.textContent).toContain("back");
  });

  /**
   * **THE COUNTERPART TO `recovers`, AND THE HALF THAT CAN FAIL SILENTLY.**
   *
   * The test above proves the banner CLEARS on a success. Nothing proved it
   * does not clear on the wrong success — and an implementation that cleared
   * whenever a 200 arrived would pass it perfectly. A stuck collector is served
   * from the server's own cache, so it answers 200 forever with a snapshot that
   * never moves: the failure being guarded here is a page that says the fleet
   * is fine because the server is answering, which is the one lie this header
   * exists to prevent.
   *
   * The `freshness` unit test below asserts the same rule on the function. This
   * is the rendered pair, because the rule only protects anybody if the value
   * the page computes is the value the page draws — the join is the half that
   * has been wrong here before. Added 2026-09-08, Baseline stage of
   * docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md.
   */
  it("does not clear the banner when the snapshot that arrives is itself old", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.fail("gone"));
    expect(container.textContent).toContain("STALE");

    /* A perfectly happy answer, ten minutes stale. The rows are real and must
       still be drawn — an unreachable fleet is not an empty one, and neither is
       a stale one. */
    act(() =>
      feed.push(
        state({
          collectedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          rows: [row({ id: "$a", title: "back", status: { kind: "working" } })],
        }),
      ),
    );

    const text = container.textContent ?? "";
    expect(text).toContain("back");
    expect(text).toContain("STALE");
    /* And it says WHY in the snapshot's own age rather than in the fetch error,
       which is over: a banner that kept quoting `gone` would be describing a
       failure that is no longer happening. */
    expect(text).toContain("10m old");
    expect(text).not.toContain("gone");
  });

  it("is stale when the server answers happily with an old snapshot", () => {
    /* The server caches: one collection costs ~12s, so a stuck collection looks
       exactly like a working one from outside. Only the snapshot's own age can
       tell you, which is why this case is separate from a failed fetch. */
    const now = Date.parse("2026-09-08T12:10:00Z");
    const fresh = freshness({
      state: state({ collectedAt: "2026-09-08T12:00:00Z" }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(fresh.stale).toBe(true);
    expect(fresh.why).toContain("10m old");
  });

  it("does not cry stale before anything has been collected", () => {
    const now = Date.parse("2026-09-08T12:00:00Z");
    expect(freshness({ state: null, receivedAt: null, error: null, failures: 0, now })).toMatchObject({
      stale: false,
      age: "collecting…",
    });
  });
});

describe("the modes", () => {
  it("starts on Sessions, and an unknown hash falls back to it rather than rendering nothing", () => {
    window.location.hash = "#nonsense-from-an-old-bookmark";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", title: "a session", status: { kind: "idle" } })] })));
    expect(container.textContent).toContain("a session");
  });

  it("puts the chosen mode in the hash, so a refresh comes back to it", () => {
    const feed = manualTransport();
    mount(feed.transport);
    const health = [...container.querySelectorAll("button")].find((b) => b.textContent === "Box health");
    act(() => health?.click());
    expect(window.location.hash).toBe("#health");
    expect(container.textContent).toContain("No box health data.");
  });

  it("opens straight into the mode the hash names", () => {
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mount(feed.transport);
    expect(container.textContent).toContain("Everything queued, across the fleet");
  });
});

/**
 * **The Usage limits tab.**
 *
 * The same three assertions as Deploys below, plus one this tab needs and the
 * others do not: it draws the *same* `UsageCard` the Overseer tab draws, from
 * the same field of the same payload. Mounted twice rather than copied, because
 * two renderings of one reading is exactly the second interpretation the whole
 * of tools/overseer/usage.ts exists to prevent.
 */
describe("the usage limits tab", () => {
  it("is registered at all, which is the one thing the types cannot check", () => {
    /* `Mode` is derived FROM `MODES`, so losing a whole mode and its four map
       entries in a merge type-checks perfectly and the tab is simply gone. Four
       sessions were adding modes on the night of 2026-09-08. */
    expect(MODES).toContain("usage");
    expect(MODE_LABELS.usage).toBe("Usage limits");
  });

  it("opens straight into it from the hash", async () => {
    window.location.hash = "#usage";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state()));
    await act(async () => undefined);

    expect(container.textContent).toContain("This server does not report usage");
  });

  it("draws the panel when the button is pressed — the missing-mount test", async () => {
    /* A mode registered in all four maps with no arm in App.tsx compiles, draws
       a button, switches the hash, and shows an empty page. Nothing type-checks
       that ternary. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state()));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Usage limits");
    expect(button, "no Usage limits button in the bar").toBeDefined();

    act(() => button?.click());
    await act(async () => undefined);

    expect(window.location.hash).toBe("#usage");
    expect(container.textContent).toContain("This server does not report usage");
  });

  it("shows the SAME reading as the Overseer tab's card, from one payload", async () => {
    /* The tab is a second mount of `UsageCard`, not a second renderer. If these
       two ever diverge, one of them is inventing — and the reader has no way to
       tell which. Checked on the text rather than the props, because the props
       being equal is what a copy would also satisfy. */
    const feed = manualTransport();
    window.location.hash = "#usage";
    mount(feed.transport);
    act(() => feed.push(state()));
    await act(async () => undefined);
    const onTab = container.textContent ?? "";

    window.location.hash = "#overseer";
    await act(async () => undefined);
    const onOverseer = container.textContent ?? "";

    const claim = "The payload arrived and carried no usage reading at all.";
    expect(onTab).toContain(claim);
    expect(onOverseer).toContain(claim);
  });
});

/**
 * **The Deploys tab.**
 *
 * The three assertions docs/project/fleet-dashboard-modes.md § The test asks
 * for, and the second of them is the one that earns its place: `MODES`,
 * `MODE_LABELS`, `MODE_ICONS` and `MODE_TIPS` are all `Record<Mode, …>` and the
 * compiler catches a half-registered mode — but **the mount in `App.tsx` is a
 * plain ternary and nothing type-checks it**. A mode registered in all four with
 * no arm there compiles, draws a button, switches the hash, and shows an empty
 * page.
 */
describe("the deploys tab", () => {
  it("is registered at all, which is the one thing the types cannot check", () => {
    /* **`Record<Mode, …>` cannot catch a whole mode being lost.** `Mode` is
       derived FROM `MODES`, so a merge that drops `"deploys"` from the array and
       its entries from the four maps leaves every `Record<Mode, …>` perfectly
       typed and the tab simply gone. Three sessions added a mode on the night of
       2026-09-08 and git merges these additions with no conflict marker, so
       "typecheck and count by eye" was the plan until GPT Sol pointed out that
       the typecheck proves nothing here. This is the assertion instead. */
    expect(MODES).toContain("deploys");
    expect(MODE_LABELS.deploys).toBe("Deploys");
  });

  it("opens straight into it from the hash", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(feed.transport);
    await act(async () => undefined);

    expect(container.textContent).toContain("Release 74");
    expect(container.textContent).toContain("Hover cards on links");
  });

  it("draws the panel when the button is pressed — the missing-mount test", async () => {
    const feed = manualTransport();
    mount(feed.transport);
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Deploys");
    expect(button, "no Deploys button in the bar").toBeDefined();

    act(() => button?.click());
    await act(async () => undefined);

    expect(window.location.hash).toBe("#deploys");
    expect(container.textContent).toContain("Release 74");
  });

  it("says how stale the record is, and does not present the number as undeployed work", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(feed.transport);
    await act(async () => undefined);

    const text = container.textContent ?? "";
    expect(text).toContain("287");
    expect(text).toContain("later non-merge commits");
    expect(text).toContain("cached");
    expect(text).toContain("may already have deployed");
    expect(text).toContain("This view cannot tell which");

    /* **The wording is load-bearing, and the check has to be about the CLAIM
       rather than about a phrase.** "287 commits not yet deployed" would be
       false — main is only ever written by a deploy — and it is the sentence a
       later edit would find punchier. But *"a mix of deploys not yet written up
       and a tip not yet deployed"* is true and says the opposite, and a blunt
       `not.toContain("not yet deployed")` fails on it: the first version of this
       assertion did exactly that, and the thing it caught was correct copy.
       So what is forbidden is the NUMBER being given that reading directly.
       routes-deploys.ts § The claim in the header. */
    for (const lie of [
      /\d+\s+commits?\s+(that are\s+)?(not yet|awaiting|pending|un)deploy/i,
      /\d+\s+commits?\s+behind\s+production/i,
      /\d+\s+undeployed/i,
    ]) {
      expect(text, `the count must not be described as undeployed work: ${lie}`).not.toMatch(lie);
    }
  });

  it.each([
    [
      "the server could not read the record",
      { kind: "unreadable", why: "there is no deploy record at /nope" } as DeploysView,
      ["could not be read", "/nope", "statement about this dashboard"],
    ],
    [
      "this browser got no answer",
      { kind: "no-answer", why: "no answer in 15s" } as DeploysView,
      ["did not get an answer from the box", "no answer in 15s"],
    ],
  ])("says WHICH nothing it is when %s", async (_name, reply, expected) => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(feed.transport, recordingDeploys(() => reply).api);
    await act(async () => undefined);

    for (const phrase of expected) expect(container.textContent).toContain(phrase);
  });

  it("tells an empty record apart from an unreadable one", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(
      feed.transport,
      recordingDeploys(() => deploysView({ versions: [], total: 0, recordLines: 0 })).api,
    );
    await act(async () => undefined);

    /* We READ it and it is empty — which must not draw as either failure, and
       must not draw as a blank panel that reads "nothing has ever shipped". */
    expect(container.textContent).toContain("read and holds no deploys");
    expect(container.textContent).not.toContain("could not be read");
  });

  it("draws a quiet deploy as quiet rather than as an empty card", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    const quiet = deploysView();
    if (quiet.kind !== "deploys") throw new Error("unreachable");
    const only = quiet.versions[0];
    if (only === undefined) throw new Error("unreachable");
    mount(
      feed.transport,
      recordingDeploys(() => deploysView({ versions: [{ ...only, entries: [], invisible: true }] })).api,
    );
    await act(async () => undefined);

    expect(container.textContent).toContain("Nothing a reader would notice");
  });

  it("shows a deploy that is not on main as the alarm it is, not as a shrug", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(feed.transport, recordingDeploys(() => deploysView({ git: { ...healthyGit(), ancestry: { kind: "not-ancestor" } } })).api);
    await act(async () => undefined);

    expect(container.textContent).toContain("is not on main");
    expect(container.textContent).toContain("rollback");
  });

  it("says a git reading failed rather than drawing a zero", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(
      feed.transport,
      recordingDeploys(() =>
        deploysView({
          git: {
            ...healthyGit(),
            commitsSince: { kind: "unknown", why: "git rev-list took longer than 5000ms" },
            ancestry: { kind: "unknown", why: "fatal: bad object" },
          },
        }),
      ).api,
    );
    await act(async () => undefined);

    const text = container.textContent ?? "";
    expect(text).toContain("could not be measured");
    expect(text).toContain("git rev-list took longer than 5000ms");
    expect(text).toContain("could not be checked");
    /* The specific collapse this guards: a failed count rendering as "0
       commits ... behind", which is the most reassuring possible way to say we
       have no idea. */
    expect(text).not.toContain("0 commits on main");
  });

  it("asks for more when there are more, and says how many", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    const deploys = recordingDeploys();
    mount(feed.transport, deploys.api);
    await act(async () => undefined);

    expect(deploys.asked).toEqual([10]);
    const more = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Show more"));
    expect(more?.textContent).toContain("73 older deploys");

    act(() => more?.click());
    await act(async () => undefined);
    expect(deploys.asked).toEqual([10, 60]);
  });

  it("answers the dock's Refresh button, which claims to refresh the page", async () => {
    /* The button's tooltip presents it as the page's refresh control. Until
       2026-09-09 it refreshed the fleet feed only, so on this tab pressing it
       did nothing — indistinguishable from a broken button, on the one page
       whose job is to say whether things are broken. Sol's P2 finding 9. */
    window.location.hash = "#deploys";
    const feed = manualTransport();
    const deploys = recordingDeploys();
    mount(feed.transport, deploys.api);
    await act(async () => undefined);
    expect(deploys.asked).toEqual([10]);

    const refresh = [...container.querySelectorAll("button")].find((b) => b.textContent === "Refresh");
    expect(refresh, "no Refresh button").toBeDefined();
    act(() => refresh?.click());
    await act(async () => undefined);

    expect(deploys.asked).toEqual([10, 10]);
    /* And it still refreshes the feed, which was its original job. */
    expect(feed.refreshes()).toBeGreaterThan(0);
  });

  it("survives an out-of-range fetch time rather than taking the panel down", async () => {
    /* `lastFetchAtMs` is a filesystem mtime. The panel used to render it as
       `ago(new Date(ms).toISOString(), now)`, and `toISOString()` raises
       `RangeError` past ±8.64e15 rather than returning something odd — thrown
       during render, that blanks the WHOLE panel, so one absurd mtime would
       hide the deploy list and say nothing about why. Flagged by session
       `260908f-roadmap-usage`, which hit the same class twice. Note 1e300 is
       perfectly finite: a finiteness check would not have caught it. */
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(
      feed.transport,
      recordingDeploys(() =>
        deploysView({
          git: { ...healthyGit(), main: { ...healthyGit().main, lastFetchAtMs: 1e300 } as never },
        }),
      ).api,
    );
    await act(async () => undefined);

    /* The list is still there, and the unreadable time says so rather than
       being silently omitted. */
    expect(container.textContent).toContain("Release 74");
    expect(container.textContent).toContain("at an unreadable time");
  });

  it("counts the lines it could not read rather than showing a quietly short list", async () => {
    window.location.hash = "#deploys";
    const feed = manualTransport();
    mount(
      feed.transport,
      recordingDeploys(() => deploysView({ unreadable: ["line 12: does not parse"], recordLines: 75 })).api,
    );
    await act(async () => undefined);

    expect(container.textContent).toContain("1 of 75 lines in the record could not be read");
    expect(container.textContent).toContain("line 12: does not parse");
  });
});

describe("box health, whose shape belongs to somebody else", () => {
  it("says absent rather than drawing an empty panel", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ health: null })));
    const text = container.textContent ?? "";
    expect(text).toContain("No box health data.");
    expect(text).toContain("not that the box is well");
  });

  it("draws a shape it has never seen, without a schema", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          health: {
            verdict: { level: "strained", reasons: ["load 24.1 over 4 cores"] },
            somethingNobodyAddedYet: { nested: { deeper: [1, 2, "three"] } },
          },
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("strained");
    expect(text).toContain("load 24.1 over 4 cores");
    expect(text).toContain("somethingNobodyAddedYet");
    expect(text).toContain("three");
  });

  it("survives a verdict that is not the shape it hoped for", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ health: { verdict: "fine, probably" } })));
    expect(container.textContent).toContain("fine, probably");
  });
});

/**
 * **THE MASTHEAD SAYS THE TIMES ARE CORRECTED; THE CHART'S LABELS HAVE TO BE.**
 * GPT Sol's K3, 2026-09-08.
 *
 * The 24-hour chart prints clock times — an axis, the worst point of each
 * series, when a break ended, when the last write worked — and they were
 * formatted straight off the server's instants. On a phone five minutes fast
 * those labels disagree with the watch in the reader's hand AND with the line
 * at the top of the page saying the page is corrected for exactly that.
 *
 * **Only the labels.** The chart's geometry and its gap detection are
 * server-to-server arithmetic and are right untouched; correcting those would
 * move a fault relative to its own window. HealthHistory.tsx § `timeLabel`.
 */
describe("the health chart's own clock", () => {
  const CADENCE = 73_000;
  /** A device five minutes fast: the box's `servedAt` reads five minutes behind ours. */
  const SKEW_MS = 5 * 60_000;

  /** The same wall-clock formatter the chart uses, so this asserts the SHIFT and not the format. */
  const hhmm = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  function reading(atMs: number, ratio1: number): HealthSampleView {
    return {
      kind: "reading",
      atMs,
      nextDueMs: CADENCE,
      report: {
        load: { kind: "value", load1: ratio1 * 16, cores: 16, ratio1 },
        memory: { kind: "value", availableFraction: 0.4 },
        swap: { kind: "value", usedFraction: 0.4 },
        swapActivity: { kind: "value", waPercent: 1, activelySwapping: false },
        verdict: { level: "ok", reasons: [] },
      },
    };
  }

  it("prints the peak's time on the reader's clock rather than on the box's", async () => {
    /* The PEAK's own timestamp rather than the axis: it is a number this
       fixture chooses outright, so the assertion does not depend on where
       `plotHistory` puts the window's edge or on when the render happened. */
    const nowMs = Date.now();
    const peakAtMs = nowMs - 3 * 3_600_000;
    const view: HistoryView = {
      kind: "history",
      windowHours: 24,
      fromMs: nowMs - 24 * 3_600_000,
      toMs: nowMs,
      samples: [reading(peakAtMs - CADENCE, 1), reading(peakAtMs, 9.4), reading(peakAtMs + CADENCE, 1)],
      predecessor: null,
      holes: [],
      earliestAtMs: peakAtMs - CADENCE,
      rotated: false,
      retention: null,
      unreadableLines: 0,
      refreshMs: 60_000,
      unreadableSamples: 0,
    };

    window.location.hash = "#health";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, historyApi: { window: async () => view } });
    const servedAt = new Date(Date.now() - SKEW_MS).toISOString();
    act(() =>
      feed.push(
        wire({
          servedAt,
          collectedAt: servedAt,
          health: { verdict: { level: "ok", reasons: [] } },
        }),
      ),
    );
    await act(async () => {});

    const text = container.textContent ?? "";
    /* The peak is on screen at all — without this the two assertions below are
       both satisfied by a chart that failed to load. */
    expect(text).toContain("peak 9.4");
    expect(text).toContain(hhmm(peakAtMs + SKEW_MS));
    expect(text).not.toContain(hhmm(peakAtMs));
  });
});

describe("what comes off the wire", () => {
  it("turns a status this build has never heard of into an unknown that names itself", () => {
    expect(parseStatus({ kind: "compacting" })).toEqual({
      kind: "unknown",
      why: 'this page does not know the status "compacting"',
    });
  });

  it("refuses a body that is not this API, rather than rendering zero sessions over it", () => {
    expect(parseFleetState("<html>502 Bad Gateway</html>", Date.now()).ok).toBe(false);
    expect(parseFleetState(null, Date.now()).ok).toBe(false);
  });

  it("refuses a schema it does not read, rather than showing a fleet it half-understands", () => {
    /* GPT Sol's F15. `parseFleetState({})` used to SUCCEED: a missing `rows`
       became an empty list, the schema was ignored, and a 200 carrying anything
       at all rendered as a quiet box. Each refusal names itself, so the banner
       can say which of the three it was. */
    const two = parseFleetState({ schema: 2, rows: [] }, Date.now());
    expect(two.ok).toBe(false);
    expect(two.ok === false ? two.why : "").toContain("schema 2");

    const none = parseFleetState({ rows: [] }, Date.now());
    expect(none.ok).toBe(false);
    expect(none.ok === false ? none.why : "").toContain("no schema");

    expect(parseFleetState({}, Date.now()).ok).toBe(false);
  });

  it("refuses a payload with no list of sessions, which is not a payload with none", () => {
    const missing = parseFleetState({ schema: 1 }, Date.now());
    expect(missing.ok).toBe(false);
    expect(missing.ok === false ? missing.why : "").toContain("not the same as having none");
    // And the honest empty fleet still parses, because those are opposite claims.
    expect(wire({ rows: [] }).rows).toEqual([]);
  });

  it("counts the rows it could not read rather than quietly shortening the fleet", () => {
    /* A dropped row shortens authoritative state. The row most likely to be
       malformed is a blocked one carrying a question scraped off a terminal,
       which is exactly the row the page is opened to see. */
    const read = wire({ rows: [{ name: "nameless" }, { id: "$b" }] });
    expect(read.rows.map((r) => r.id)).toEqual(["$b"]);
    expect(read.unreadableRows).toBe(1);
  });

  it("says on the page how many sessions it could not read", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$b", title: "the one that parsed" })], unreadableRows: 3 })));
    const text = container.textContent ?? "";
    expect(text).toContain("3 of 4 sessions could not be read");
    expect(text).toContain("the one that parsed");
  });

  it("treats pane.ts's own `{ kind: none }` as no question at all", () => {
    expect(wire({ rows: [{ id: "$a", question: { kind: "none" } }] }).rows[0]?.question).toBeNull();
  });

  it("says which of the three ways a fetch failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503, statusText: "Service Unavailable" })),
    );
    await expect(fetchFleetState()).rejects.toThrow("503 Service Unavailable");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(fetchFleetState()).rejects.toThrow("not JSON");

    vi.stubGlobal("fetch", vi.fn(async () => Response.json(["an array"])));
    await expect(fetchFleetState()).rejects.toThrow("not the fleet API");
  });
});

describe("the sort, on its own", () => {
  it("puts a row with an unparseable start time last in its band rather than anywhere", () => {
    /* `Date.parse` answers NaN instead of throwing, every comparison with NaN
       is false, and a comparator that subtracts them sorts the row wherever it
       happened to walk — with the page looking fine. tools/fleet/status.ts hit
       exactly this. */
    const sorted = triageSort([
      row({ id: "$broken", startedAt: "not a date", status: { kind: "idle" } }),
      row({ id: "$old", startedAt: "2026-09-01T00:00:00Z", status: { kind: "idle" } }),
      row({ id: "$new", startedAt: "2026-09-08T00:00:00Z", status: { kind: "idle" } }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["$new", "$old", "$broken"]);
  });
});

describe("the escaping this rewrite exists for", () => {
  it("renders agent-authored markup as text, not as markup", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$xss",
              title: "<img src=x onerror=alert(1)>",
              repo: "<script>alert(2)</script>",
              status: { kind: "needs-you" },
              question: {
                prompt: "<b>bold?</b>",
                options: [],
                material: { kind: "no-material" },
                // Hostile text in the gate's own sentence too: it is rendered,
                // so it is a surface, and this file's whole job is that every
                // surface escapes.
                gate: { kind: "unknown", why: "<script>alert(3)</script>" },
              },
            }),
          ],
        }),
      ),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("<script>alert(2)</script>");
  });

  it("has no way back to raw HTML anywhere in the client", () => {
    /* The test above proves ONE field is escaped. This proves the mechanism
       that would un-escape any of them is absent, which is the durable version
       — a future component could pass a title through `dangerouslySetInnerHTML`
       and the assertions above would still be green about the fields they
       happen to name.

       The `filter` on the second half is the guard against a guard that has
       stopped looking: if the scan ever finds no files, this test would pass
       while checking nothing at all (docs/reusable/silent-success.md). */
    const dir = join(process.cwd(), "tools/fleet/web/src");
    const files = globSync("**/*.{ts,tsx}", { cwd: dir });
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.filter((file) =>
      readFileSync(join(dir, file), "utf8").includes("dangerouslySetInnerHTML"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the bottom bar", () => {
  /** The dock's mode buttons, in the order they are drawn. */
  function modeButtons(): HTMLButtonElement[] {
    return [...(container.querySelector(".dock-modes")?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
  }

  it("puts the mode switch in the bar at the bottom rather than in the masthead", () => {
    /* The move is the whole point of the port: on a phone the top of the screen
       is the furthest thing from a thumb. Asserted structurally, because a test
       that only found the buttons somewhere on the page would have passed just
       as happily before the change.

       **Derived from `MODES` rather than written out.** Four sessions added a
       tab on the night of 2026-09-08 and a hand-typed list here goes red for
       each of them, in a file they are all editing — a conflict that teaches
       nobody anything. What is actually being asserted is that the bar draws
       every mode, in order, with its label, and that is what this now says. */
    const feed = manualTransport();
    mount(feed.transport);
    expect(modeButtons().map((b) => b.textContent)).toEqual(MODES.map((m) => MODE_LABELS[m]));
    expect(container.querySelector("header")?.querySelector(".dock-modes")).toBeNull();
  });

  it("marks the mode you are in, and only that one", () => {
    const feed = manualTransport();
    mount(feed.transport);

    /** `aria-checked` down the bar, as the mode at `index` being the live one. */
    const onlyOn = (index: number): string[] => MODES.map((_, i) => (i === index ? "true" : "false"));
    const checked = (): (string | null)[] => modeButtons().map((b) => b.getAttribute("aria-checked"));
    expect(checked()).toEqual(onlyOn(MODES.indexOf("sessions")));

    const health = modeButtons().find((b) => b.textContent === "Box health");
    act(() => health?.click());

    expect(checked()).toEqual(onlyOn(MODES.indexOf("health")));
    // And the class the stylesheet paints, which is what a sighted reader sees.
    expect(modeButtons().filter((b) => b.classList.contains("on")).map((b) => b.textContent)).toEqual([
      "Box health",
    ]);
  });

  it("carries the needs-you tally on Sessions, so it is visible from another mode", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({ id: "$a", status: { kind: "needs-you" } }),
            row({ id: "$b", status: { kind: "needs-you" } }),
            row({ id: "$c", status: { kind: "working" } }),
          ],
        }),
      ),
    );

    const sessions = modeButtons()[0];
    expect(sessions?.querySelector(".dock-count")?.textContent).toBe("2");
    /* The badge is `aria-hidden`, so the count has to be in the button's name
       as well or a screen reader gets a button called "Sessions" beside a
       number it is never told about. */
    expect(sessions?.getAttribute("aria-label")).toBe("Sessions, 2 need you");
  });

  it("has no badge at all when nothing needs you, rather than a zero", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", status: { kind: "idle" } })] })));
    expect(container.querySelector(".dock-count")).toBeNull();
    expect(modeButtons()[0]?.getAttribute("aria-label")).toBe("Sessions");
  });
});

describe("the fit ladder, which is measured rather than guessed", () => {
  /**
   * A bar whose width per rung is known, with **the browser's clamp modelled**:
   * `scrollWidth` is never less than `clientWidth`. That clamp is the reason
   * `chooseDockFit` asks a yes/no question instead of doing arithmetic, and a
   * fake without it would let a wrong implementation pass.
   */
  function fakeBar(clientWidth: number, rungWidths: number[]): HTMLElement {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { get: () => clientWidth });
    Object.defineProperty(el, "scrollWidth", {
      get: () => {
        const level = el.classList.contains("dock-fit-2") ? 2 : el.classList.contains("dock-fit-1") ? 1 : 0;
        return Math.max(clientWidth, rungWidths[level] ?? 0);
      },
    });
    return el;
  }

  it("stays spelled out when the row fits", () => {
    const el = fakeBar(1400, [520, 430, 300]);
    expect(chooseDockFit(el, 2)).toBe(0);
    expect(el.className).toBe("");
  });

  it("steps down only as far as it has to", () => {
    const el = fakeBar(460, [520, 430, 300]);
    expect(chooseDockFit(el, 0)).toBe(1);
    expect(el.classList.contains("dock-fit-1")).toBe(true);
    expect(el.classList.contains("dock-fit-2")).toBe(false);
  });

  it("takes the last rung when nothing fits, and does not invent a further one", () => {
    const el = fakeBar(200, [520, 430, 300]);
    expect(chooseDockFit(el, 0)).toBe(2);
    expect(el.classList.contains("dock-fit-2")).toBe(true);
  });

  it("changes nothing when the bar has no layout at all", () => {
    /* jsdom, `display: none`, a detached node. Measuring a zero-width box would
       answer "nothing fits" and strip every label off a bar nobody is looking
       at — which is then what the reader sees on the first real paint. */
    const el = fakeBar(0, [520, 430, 300]);
    expect(chooseDockFit(el, 1)).toBe(1);
    expect(el.className).toBe("");
  });
});

describe("the columns, given up rather than squeezed", () => {
  it("is one column on a phone and three on a desk", () => {
    expect(chooseColumns(390)).toBe(1);
    expect(chooseColumns(COLUMN_MIN_PX * 2 - 1)).toBe(1);
    expect(chooseColumns(COLUMN_MIN_PX * 2)).toBe(2);
    expect(chooseColumns(1280)).toBe(3);
    expect(chooseColumns(4000)).toBe(3);
  });

  it("answers one column for a box that has not been laid out", () => {
    expect(chooseColumns(0)).toBe(1);
    expect(chooseColumns(Number.NaN)).toBe(1);
  });

  it("front-loads, so the urgent bands are never split across the window", () => {
    const bands = ["needs", "working", "quiet"];
    expect(spreadIntoColumns(bands, 3)).toEqual([["needs"], ["working"], ["quiet"]]);
    expect(spreadIntoColumns(bands, 2)).toEqual([["needs", "working"], ["quiet"]]);
    expect(spreadIntoColumns(bands, 1)).toEqual([bands]);
    // Never more columns than there are bands: an empty first column beside two
    // full ones reads as a rendering fault rather than as good news.
    expect(spreadIntoColumns(["quiet"], 3)).toEqual([["quiet"]]);
  });

  it("draws every band once whatever the column count", () => {
    for (const columns of [1, 2, 3]) {
      expect(spreadIntoColumns(["a", "b", "c"], columns).flat()).toEqual(["a", "b", "c"]);
    }
  });

  it("measures the container that appears LATER, not only the one that was there at mount", () => {
    /* **THE REGRESSION.** The panel's first render is the "No sessions." card,
       because data arrives a beat after the page does — so on a real browser
       the measured container does not exist when the effect first runs. With a
       plain `useRef` the effect read `null`, gave up, and never ran again: the
       list sat at one column for the life of the tab, on a 1280px window, with
       half of it empty. It looked completely deliberate, because one column IS
       the phone layout.

       Note the ORDER below — mount, then push. Pushing first would render the
       grid on the first pass and this test would pass against the broken
       version, which is how the bug survived being written. */
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
    Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => 1280 });
    try {
      const feed = manualTransport();
      mount(feed.transport);
      // The "Collecting…" card — no measured container anywhere on the page yet.
      expect(container.textContent).toContain("Collecting…");

      act(() =>
        feed.push(
          state({
            rows: [
              row({ id: "$a", status: { kind: "needs-you" } }),
              row({ id: "$b", status: { kind: "idle" } }),
            ],
          }),
        ),
      );

      const grid = container.querySelector<HTMLElement>("main [style*='grid-template-columns']");
      expect(grid?.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    } finally {
      if (clientWidth) Object.defineProperty(Element.prototype, "clientWidth", clientWidth);
    }
  });
});

describe("staleness, against the collector's own cadence", () => {
  const at = (iso: string): number => Date.parse(iso);

  it("does not cry stale at a minute, because a minute is how often the box is collected", () => {
    /* THE BUG THIS TEST EXISTS FOR. The threshold was a hardcoded 30s against a
       collector that runs every 55–60s — deliberately, since one collection
       costs the box about ten seconds of work — so the page was red for most of
       every cycle. A banner that is on most of the time is one nobody reads,
       which costs this tool the single signal it is built around. */
    const now = at("2026-09-08T12:01:00Z");
    const fresh = freshness({
      state: state({ collectedAt: "2026-09-08T12:00:00Z" }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(fresh.stale).toBe(false);
  });

  it("still cries stale once a snapshot is older than a couple of cycles", () => {
    const now = at("2026-09-08T12:03:00Z");
    const fresh = freshness({
      state: state({ collectedAt: "2026-09-08T12:00:00Z" }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(fresh.stale).toBe(true);
    expect(fresh.why).toContain("2m 30s");
  });

  it("believes the cadence it has watched over the one it assumed", () => {
    /* A collector slowed to five minutes is not a broken one, and a threshold
       that cannot follow it would paint the page red permanently. */
    const now = at("2026-09-08T12:06:00Z");
    const fresh = freshness({
      state: state({ collectedAt: "2026-09-08T12:00:00Z" }),
      receivedAt: now,
      error: null,
      failures: 0,
      cadenceMs: 5 * 60_000,
      now,
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.tip.what).toContain("measured from the gap");
  });

  it("believes the server over its own measurement, when the server says", () => {
    const now = at("2026-09-08T12:02:00Z");
    const fresh = freshness({
      state: state({ collectedAt: "2026-09-08T12:00:00Z", refreshMs: 15_000 }),
      receivedAt: now,
      error: null,
      failures: 0,
      cadenceMs: 5 * 60_000,
      now,
    });
    // 15s × 2.5 = 37.5s, and this snapshot is two minutes old.
    expect(fresh.stale).toBe(true);
    expect(fresh.tip.what).toContain("which the server tells us");
  });

  it("takes refreshMs off the wire when it is there, and null when it is not", () => {
    expect(wire({ refreshMs: 60_000 }).refreshMs).toBe(60_000);
    expect(wire({}).refreshMs).toBeNull();
    // Not a number, or nonsense: the server did not say, so the page measures.
    // `malformed`, because `"soon"` is not a thing this server can send — the
    // annotation on `wire()` says so, and this test is about what happens when
    // something else does.
    expect(malformed({ refreshMs: "soon" }).refreshMs).toBeNull();
    expect(wire({ refreshMs: -1 }).refreshMs).toBeNull();
  });
});

/**
 * **THE PAGE READS THE BOX'S CLOCK WITH THE PHONE'S** — v0.4j in
 * docs/plans/260907e-agent-fleet-dashboard.md.
 *
 * Every age here was `browserNow − Date.parse(aServerTimestamp)`, and Greg
 * reads this on a phone over Tailscale whose clock is not the box's. The two
 * expensive consequences are both ALARMS A CLOCK CAN MANUFACTURE: a
 * permanently-on STALE banner past 2m 30s of skew, and *"this may not be this
 * session's conversation"* on every working row past thirty minutes. An alarm
 * that is on when nothing is wrong stops being read, which is the same failure
 * as a caveat drawn on 29 of 32 rows.
 *
 * **The first test here is the bug, not the fix.** "No STALE on the page" is
 * also what a blank page says, so the skewed fixture is asserted to produce the
 * alarm when the correction cannot see it — a payload with no `servedAt` is
 * exactly the pre-v0.4j build, byte for byte — and then not to once it can.
 */
describe("the box's clock, read with the phone's", () => {
  /**
   * A device five minutes fast. Twice the 2m 30s staleness threshold, and the
   * skew the plan measured mattering was three.
   */
  const SKEW_MS = 5 * 60_000;

  /** What the server's clock said `ms` ago, by this browser's reckoning. */
  const onTheServersClock = (ms: number = SKEW_MS): string => new Date(Date.now() - ms).toISOString();

  /**
   * A payload the server composed SKEW_MS ago by ITS clock, i.e. just now by
   * ours — which is what a phone five minutes fast sees on every poll.
   *
   * `refreshMs` is named so the threshold is the server's stated 60s cadence
   * rather than one measured off a single fixture.
   */
  function skewed(over: Record<string, unknown> = {}): Record<string, unknown> {
    const at = onTheServersClock();
    return { servedAt: at, collectedAt: at, refreshMs: 60_000, ...over };
  }

  it("cries STALE at a fresh snapshot when the server does not say what time it is", () => {
    /* **THE POSITIVE CONTROL, AND IT IS THE BUG.** This payload is the same
       bytes as the one below minus `servedAt`, which is exactly what a server
       built before this stage sends — so this is the page as it was, red at a
       snapshot the box collected seconds ago. Without this assertion the test
       underneath passes on a page that draws nothing at all.

       **AND ON THE UNKNOWN PATH THAT PRE-STAGE BEHAVIOUR IS WHAT WE KEEP, ON
       PURPOSE.** GPT Sol's K1 asked whether an unmeasured skew should suppress
       this alarm; it should not. Suppressing loses a real staleness signal to
       avoid a possible false one, and that trade is the wrong way round on the
       page whose whole job is to say when it has stopped being told anything.
       So the greenness of this test is NOT a claim that the unknown path is
       right — it is the deliberate decision that an unknown skew changes no
       alarm. What v0.4j's follow-up added is that the page stops being SILENT
       about it: see the clock line asserted two tests below. The branch has
       essentially no real occupancy either way, because the same process serves
       this bundle and answers `/api/state`. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed({ servedAt: undefined }))));
    expect(container.textContent ?? "").toContain("STALE");
  });

  it("does not, once the payload says what time the server answered", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed())));
    expect(container.textContent ?? "").not.toContain("STALE");
  });

  it("says out loud that the device's clock is out, because otherwise a corrected page and a broken one look identical", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed())));
    /* Quiet, and about the DEVICE rather than about the fleet — it is the one
       fact on this page nothing else will ever tell the reader. */
    expect(container.textContent ?? "").toContain("this device's clock is 5m ahead of the box's");
  });

  it("says nothing about the clock when the skew is small enough not to move a printed number", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed({ servedAt: onTheServersClock(5_000), collectedAt: onTheServersClock(5_000) }))));
    expect(container.textContent ?? "").not.toContain("this device's clock");
  });

  it("corrects by ZERO, not by a guess, when the server does not say — and does not throw", () => {
    /* An unknown skew is not a small one. `not-asked`'s rule, at the type: an
       older server made no claim about its clock, so nothing is shifted. What
       it does NOT do is pass silently — see the test below. */
    const collectedAt = "2026-09-08T12:00:00.000Z";
    const read = parseFleetState({ schema: 1, rows: [], collectedAt }, Date.parse("2026-09-08T12:30:00.000Z"));
    if (!read.ok) throw new Error(read.why);
    expect(read.state.collectedAt).toBe(collectedAt);
    expect(read.state.clockSkew.kind).toBe("unknown");
    /* Corrected by zero, and NOT silent about it — the rendered half of this is
       the test below. */
    expect(clockNote(read.state.clockSkew)).not.toBeNull();
  });

  /**
   * **AN UNMEASURED SKEW MUST NOT RENDER AS A MEASURED ZERO.** GPT Sol's K1.
   *
   * A correction of zero and a correction nobody could compute produce a
   * byte-identical page, with every clock-dependent alarm intact and nothing
   * saying the check never happened. The alarms stay — suppressing a real one
   * to avoid a possible false one is the wrong trade here — so the whole of the
   * fix is that the page stops presenting an unmeasured thing as measured.
   *
   * Quiet, in the same furniture as the measured line, because it is a fact
   * about the payload rather than an alarm about the fleet.
   */
  it("says the clock could not be checked, rather than looking exactly like a clock that agrees", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed({ servedAt: undefined }))));
    const text = container.textContent ?? "";
    expect(text).toContain("this device's clock could not be checked against the box's");
    expect(text).toContain("the times here are the server's own");
    /* And it is not the measured sentence wearing a zero. */
    expect(text).not.toContain("the times here are corrected for it");
  });

  it("says nothing of the kind once the skew has actually been measured", () => {
    /* The other half, because "the page says the clock is unchecked" is also
       what a page that says it on every load would say. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed())));
    expect(container.textContent ?? "").not.toContain("could not be checked");
  });

  it("leaves `heardAge` on the browser's clock, which is the measurement a corrected `useNow` would break", () => {
    /* **THE ONE COMPARISON THAT WAS ALREADY RIGHT.** `heardAge = now −
       receivedAt` is two readings of the BROWSER's clock — how long since this
       page heard anything, which is a fact about the connection — so
       subtracting the skew from `useNow()` would corrupt it by exactly the
       skew. This asserts the number a page whose clock had been "fixed" would
       get wrong: five minutes instead of none. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(wire(skewed())));
    const text = container.textContent ?? "";
    expect(text).toContain("last heard from 0s ago");
    expect(text).not.toContain("last heard from 5m ago");
  });

  it("shifts every timestamp the payload carries, not only the one the banner reads", () => {
    /* A stage that corrected `collectedAt` alone would turn the banner off and
       leave the uptime, the pause and the inbox wrong — and each of those is a
       number somebody triages on. */
    const at = onTheServersClock();
    const scannedAt = new Date(Date.parse(at) - 60_000).toISOString();
    const read = parseFleetState(
      {
        schema: 1,
        servedAt: at,
        collectedAt: at,
        rows: [
          {
            id: "$a",
            name: "a",
            startedAt: at,
            status: { kind: "idle" },
            pause: { kind: "scheduled-wakeup", at, overdue: false },
          },
        ],
        attention: {
          kind: "published",
          coordinatorWrittenAt: at,
          list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt },
        },
      },
      Date.now(),
    );
    if (!read.ok) throw new Error(read.why);
    const ms = (iso: string | null | undefined): number => Date.parse(iso ?? "");
    const row0 = read.state.rows[0];
    /* Each one lands within a second of NOW rather than five minutes behind it.
       Asserted as an age rather than as an exact string, because the fixture's
       own `Date.now()` and the parser's are milliseconds apart. */
    expect(Math.abs(Date.now() - ms(read.state.collectedAt))).toBeLessThan(1_000);
    expect(Math.abs(Date.now() - ms(row0?.startedAt))).toBeLessThan(1_000);
    expect(row0?.pause.kind === "scheduled-wakeup" ? Math.abs(Date.now() - ms(row0.pause.at)) : Infinity).toBeLessThan(1_000);
    const attention = read.state.attention;
    if (attention.kind !== "published" || attention.list.kind !== "list") throw new Error("the fixture's inbox did not parse");
    expect(Math.abs(Date.now() - ms(attention.coordinatorWrittenAt))).toBeLessThan(1_000);
    /* And the scan keeps its own minute of age relative to the checkpoint: the
       shift moves both by the same amount rather than collapsing them. */
    expect(Math.abs(Date.now() - 60_000 - ms(attention.list.scannedAt))).toBeLessThan(1_000);
  });

  it("moves a rate limit's reset onto the clock the reader is looking at", () => {
    /* Not a bug: a phone five minutes fast SHOULD show a 06:30 reset as 06:35,
       because 06:35 is when it happens by the clock in their hand. The only
       wrong answer here is a time on the box's clock printed beside times on
       the phone's. */
    const skew: ClockSkew = { kind: "known", ms: -SKEW_MS };
    expect(shiftToBrowserClock("2026-09-08T06:30:00.000Z", skew)).toBe("2026-09-08T06:35:00.000Z");
    /* `overdue` is untouched — it is the server's decision, made on one clock,
       and this page never recomputes it. */
    const pause = parsePause(
      { kind: "rate-limited", window: "five_hour", resetsAt: "2026-09-08T06:30:00Z", overdue: true },
      skew,
    );
    expect(pause.kind === "rate-limited" && pause.resetsAt).toBe("2026-09-08T06:35:00.000Z");
    expect(pause.kind === "rate-limited" && pause.overdue).toBe(true);
  });

  it("is measured against `servedAt` and nothing else, because the other two clocks carry real age", () => {
    /* Neither `collectedAt` nor `attemptedAt` can stand in: the gap between
       either of them and receipt is GENUINE SNAPSHOT AGE, up to a full cadence
       of it, and cannot be told apart from skew. A payload whose collection is
       a minute old, on a device with no skew at all, must measure as no skew. */
    const now = Date.now();
    const skew = readClockSkew(
      { servedAt: new Date(now).toISOString(), collectedAt: new Date(now - 60_000).toISOString() },
      now,
    );
    expect(skew).toEqual({ kind: "known", ms: 0 });
  });

  /**
   * **`Date.parse` IS NOT THE CONTRACT.** GPT Sol's K6, 2026-09-08.
   *
   * It reads `"0"` as the year 2000, accepts date-only strings, and is allowed
   * to accept anything else an implementation fancies — and every one of those
   * would arrive here as a `known` skew and shift every timestamp on the page by
   * years, silently, in the direction of "the box's clock is broken". The
   * producer writes `toISOString()` and nothing else, so this reads exactly that
   * and calls anything else unmeasured — the same predicate, `iso`, that the
   * attention inbox already refuses its timestamps with.
   */
  it("refuses a `servedAt` that is not the one shape a timestamp has here", () => {
    const now = Date.parse("2026-09-08T12:00:00.000Z");
    /* `"0"` first, because it is the one that looks least like a date and
       parses to the most confident wrong answer. */
    for (const servedAt of ["0", "2026-09-08", "2026-09-08T12:00:00Z", "8th Sept", "", "12:00:00"]) {
      expect(readClockSkew({ servedAt }, now), JSON.stringify(servedAt)).toMatchObject({ kind: "unknown" });
    }
    /* And the shape the server actually sends is still read. */
    expect(readClockSkew({ servedAt: "2026-09-08T12:00:00.000Z" }, now)).toEqual({ kind: "known", ms: 0 });
  });

  it("puts the server's clock on the payload production actually composes", () => {
    /* THE JOIN. `statePayload` is the function server.ts calls — a field added
       to the type and never set would leave every client correcting by zero
       while every type checked, which is the class this plan spent the day
       removing. */
    const payload: unknown = JSON.parse(
      statePayload({
        snapshot: null,
        error: null,
        health: null,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: null,
        readCheckpoint: () => ({
          attention: { kind: "not-asked" },
          overseer: { kind: "not-asked" },
          usage: { kind: "not-asked" },
        }),
      }),
    );
    const servedAt = (payload as { servedAt?: unknown }).servedAt;
    expect(typeof servedAt).toBe("string");
    expect(Math.abs(Date.now() - Date.parse(String(servedAt)))).toBeLessThan(5_000);
  });
});

describe("the explanations, which are never hover-only", () => {
  it("puts a status pill's meaning in the DOM without anybody hovering anything", () => {
    /* A card that only exists while the pointer is over its trigger does not
       exist at all on the device this page is mostly read on — and a screen
       reader never fires a hover either. So `Explain` writes the same sentence,
       from the same `Tip`, into the trigger's accessible name. This test is the
       guard on that: it renders, touches nothing, and reads the words. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [row({ id: "$a", status: { kind: "needs-you" } })] })));

    const text = container.textContent ?? "";
    expect(text).toContain("waiting for a person");
    // And the second paragraph, which is the one that admits what the first
    // cannot promise — docs/project/tooltips.md. Here: that "needs you" is a
    // guess read off a terminal, not a fact the box reported.
    expect(text).toContain("a good guess rather than a fact");
  });

  it("says what stale means, and when it last heard anything", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ rows: [] })));
    const text = container.textContent ?? "";
    expect(text).toContain("This line goes red past");
    expect(text).toContain("last heard from");
  });

  it("explains each of the seven statuses, so a new arm cannot ship without words", () => {
    /* A `Record` over `FleetStatus["kind"]` makes the missing case a type error
       rather than a pill that explains nothing — this asserts the runtime half,
       that every arm the page can actually draw produces a card. */
    const kinds: FleetStatus["kind"][] = [
      "needs-you",
      "working",
      "idle",
      "waiting",
      "no-claude",
      "shell",
      "unknown",
    ];
    expect(kinds.every((kind) => STATUS_TIPS[kind]?.what.length > 20)).toBe(true);
  });
});

describe("box health, made readable", () => {
  /** A whole report, in the shape tools/fleet/health.ts produces. */
  function report(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      load: { kind: "value", load1: 8, load5: 8, load15: 8, cores: 16, ratio1: 0.5 },
      memory: { kind: "value", totalBytes: 32_000_000_000, availableBytes: 16_000_000_000, availableFraction: 0.5 },
      swap: { kind: "value", totalBytes: 8_000_000_000, usedBytes: 800_000_000, usedFraction: 0.1, areas: 2 },
      disk: { kind: "value", totalKiB: 100, usedKiB: 50, availableKiB: 50, usePercent: 50 },
      swapActivity: { kind: "value", siKBs: 0, soKBs: 0, waPercent: 2, activelySwapping: false },
      verdict: { level: "ok", reasons: ["load, memory and swap all look fine"] },
      ...over,
    };
  }

  function toneOf(stats: ReturnType<typeof readHealthStats>, key: string): string | undefined {
    return stats.find((s) => s.key === key)?.tone;
  }

  it("draws a healthy box green all the way across", () => {
    const stats = readHealthStats(report());
    expect(stats.map((s) => s.key)).toEqual(["load", "memory", "swap", "disk", "swapActivity"]);
    expect(stats.every((s) => s.tone === "work")).toBe(true);
    expect(stats.find((s) => s.key === "load")?.value).toBe("8.0");
    expect(stats.find((s) => s.key === "disk")?.sub).toBe("50 KiB free on /");
  });

  it("prints memory and swap absolutes in the right order of magnitude", () => {
    /* THE BUG THIS REPLACES. `memory.totalKiB` came back as 32,859,295,744 on
       a 32 GB box and `swap.totalKiB` as 34,359,730,176 for 32 GiB of swap —
       both bytes, whatever the name said — while `disk.availableKiB` really is
       KiB. Formatting them by their name drew "10089 GiB of 31337 GiB", the
       confidently wrong number this tool exists not to print. A browser found
       it; no test could, because every test asserted the number against the
       same wrong name.

       The fields are `totalBytes`/`availableBytes`/`usedBytes` now, and the
       panel picks its formatter by reading the name. So this asserts the
       MAGNITUDE, not just the presence of a unit: a 32 GB fixture must read as
       tens of GiB, and the 1024×-out version reads as tens of thousands. */
    const stats = readHealthStats(report());
    expect(stats.find((s) => s.key === "memory")?.value).toBe("50%");
    expect(stats.find((s) => s.key === "memory")?.sub).toBe("15 GiB of 30 GiB available");
    expect(stats.find((s) => s.key === "swap")?.sub).toBe("763 MiB of 7.5 GiB");
  });

  it("makes the big number on the swap tile the one that earned its colour", () => {
    /* The box was swapping with 0% IO wait, so the tile drew an amber "0%" over
       the words "swapping now" — an alarm about a zero. A tile is read by its
       big text, so when the colour comes from somewhere else the big text has
       to say so instead. */
    const swapping = readHealthStats(
      report({ swapActivity: { kind: "value", siKBs: 16, soKBs: 0, waPercent: 0, activelySwapping: true } }),
    ).find((s) => s.key === "swapActivity");
    expect(swapping?.value).toBe("swapping");
    expect(swapping?.tone).toBe("needs");
    expect(swapping?.sub).toContain("0% IO wait");

    const quiet = readHealthStats(report()).find((s) => s.key === "swapActivity");
    expect(quiet?.value).toBe("2%");
    expect(quiet?.tone).toBe("work");
  });

  /* **The thresholds are health.ts's, copied because this client cannot import
     a node module.** These four cases are what stops the copy drifting: a tile
     that says amber beside a badge that says ok is the failure the duplication
     buys, and it is invisible on screen. If computeVerdict's cutoffs move, this
     is what should go red. */
  it("colours load at 2x the cores and reddens at 4x", () => {
    expect(toneOf(readHealthStats(report({ load: { kind: "value", load1: 32, cores: 16, ratio1: 2 } })), "load")).toBe(
      "work",
    );
    expect(
      toneOf(readHealthStats(report({ load: { kind: "value", load1: 33, cores: 16, ratio1: 2.1 } })), "load"),
    ).toBe("needs");
    expect(
      toneOf(readHealthStats(report({ load: { kind: "value", load1: 70, cores: 16, ratio1: 4.4 } })), "load"),
    ).toBe("alarm");
  });

  it("colours memory the other way round, because less is worse", () => {
    const mem = (fraction: number) => ({
      kind: "value",
      totalKiB: 100,
      availableKiB: 100 * fraction,
      availableFraction: fraction,
    });
    expect(toneOf(readHealthStats(report({ memory: mem(0.15) })), "memory")).toBe("work");
    expect(toneOf(readHealthStats(report({ memory: mem(0.14) })), "memory")).toBe("needs");
    expect(toneOf(readHealthStats(report({ memory: mem(0.04) })), "memory")).toBe("alarm");
  });

  it("treats swap as a cliff rather than a slope", () => {
    const swap = (fraction: number) => ({
      kind: "value",
      totalKiB: 100,
      usedKiB: 100 * fraction,
      usedFraction: fraction,
      areas: 2,
    });
    // Nothing below 90% counts at all — some swap in use is normal.
    expect(toneOf(readHealthStats(report({ swap: swap(0.7) })), "swap")).toBe("work");
    expect(toneOf(readHealthStats(report({ swap: swap(0.9) })), "swap")).toBe("needs");
    expect(toneOf(readHealthStats(report({ swap: swap(0.99) })), "swap")).toBe("alarm");
    // And no swap configured is grey, not green: it is the absence of a reading
    // rather than a good one.
    expect(toneOf(readHealthStats(report({ swap: { kind: "none" } })), "swap")).toBe("idle");
  });

  it("never renders a reading nobody could take as a healthy number", () => {
    /* The thing health.ts was built to refuse. An unreadable stat is violet,
       shows a dash rather than a zero, and prints the tool's own words. */
    const stats = readHealthStats(report({ memory: { kind: "unknown", why: "free: command not found" } }));
    const memory = stats.find((s) => s.key === "memory");
    expect(memory?.tone).toBe("unknown");
    expect(memory?.value).toBe("—");
    expect(memory?.sub).toBe("free: command not found");
    expect(memory?.tip.how).toContain("NOT the same as it being fine");
  });

  it("loses a tile rather than inventing one when a reading is renamed", () => {
    const stats = readHealthStats(report({ disk: undefined }));
    expect(stats.map((s) => s.key)).not.toContain("disk");
    expect(stats.map((s) => s.key)).toContain("load");
  });

  it("shows the numbers first and keeps the raw dump behind a disclosure", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ health: report() })));

    const text = container.textContent ?? "";
    expect(text).toContain("Memory free");
    expect(text).toContain("50 KiB free on /");

    /* It read as a debug view when it was the panel. It stays, because it is
       the honest fallback for a shape nobody here recognises — shut, because it
       is not what a person opens this page to read. */
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.textContent).toContain("Everything the server sent");
  });

  it("opens the dump by itself when it recognised nothing, because then it is all there is", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() => feed.push(state({ health: { somethingNobodyAddedYet: { nested: [1, 2] } } })));
    expect(container.querySelector("details")?.open).toBe(true);
  });

  it("gives critical its own red rather than needs-you's orange", () => {
    window.location.hash = "#health";
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({ health: report({ verdict: { level: "critical", reasons: ["swap is 99% full"] } }) }),
      ),
    );
    const pill = [...container.querySelectorAll('[data-slot="pill"]')].find((p) => p.textContent === "critical");
    expect(pill?.className).toContain("bg-alarm");
  });
});

/* ==========================================================================
   Stage v0.4b — the master–detail view, and the two write paths.
   ========================================================================== */

/** Every session card's own open button, in the order they are drawn. */
function openButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button.session-open")];
}

/** Click the card whose title is `title`. Throws rather than silently doing nothing. */
function openSession(title: string): void {
  const button = openButtons().find((b) => b.textContent === title);
  if (!button) throw new Error(`no session card titled ${JSON.stringify(title)} on the page`);
  act(() => button.click());
}

/**
 * Type into a controlled textarea, the way a person does.
 *
 * **`el.value = "…"` is not typing, and it fails in a way that looks like a
 * dead button.** React tracks the last value it wrote on the node; assigning
 * over it leaves that tracker in step, so the `input` event is dropped as a
 * no-op, `useState` never updates, and the Send button stays disabled because
 * the component still believes the box is empty. Going through the prototype's
 * own setter is what desyncs the tracker, which is what makes React believe the
 * event.
 */
function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("this DOM has no HTMLTextAreaElement value setter");
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A button anywhere on the page, by its exact visible text. */
function buttonSaying(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
}

/** Pin every element's width, the way the columns test does. Returns the undo. */
function pinWidth(px: number): () => void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => px });
  return () => {
    if (original) Object.defineProperty(Element.prototype, "clientWidth", original);
  };
}

type Row = FleetState["rows"][number];

/** A steer api that records what it was asked to do and answers happily. */
function recordingSteer(): {
  api: SteerApi;
  calls: { op: "message" | "answer"; row: Row; arg: string | number }[];
} {
  const calls: { op: "message" | "answer"; row: Row; arg: string | number }[] = [];
  const api: SteerApi = {
    message: async (row, text) => {
      calls.push({ op: "message", row, arg: text });
      return {
        ok: true,
        op: "message",
        sent: [["tmux", "send-keys", "-t", row.paneId ?? "?", "-l", "--", text]],
        /* **THE ADDRESS THE SERVER SAYS IT REACHED, AND IT IS THE ROW'S OWN.**
           A stub that answered `not-told` would draw nothing and quietly stop
           exercising the comparison in `Landed`; one that answered a different
           pane would put every test's page into the mismatch alarm. This is
           what the real server sends on a send that went where it was aimed. */
        verified: {
          kind: "verified",
          paneId: row.paneId ?? "?",
          sessionId: row.id,
          panePid: row.panePid ?? 0,
          claudePid: 4243,
        },
      };
    },
    answer: async (row, index) => {
      calls.push({ op: "answer", row, arg: index });
      return {
        ok: true,
        op: "answer",
        sent: [["tmux", "send-keys", "-t", row.paneId ?? "?", "1"]],
        verified: {
          kind: "verified",
          paneId: row.paneId ?? "?",
          sessionId: row.id,
          panePid: row.panePid ?? 0,
          claudePid: 4243,
        },
      };
    },
  };
  return { api, calls };
}

/** A steer api that refuses the way the server does, with the server's sentence. */
function refusingSteer(outcome: SteerOutcome): SteerApi {
  return { message: async () => outcome, answer: async () => outcome };
}

/** A new-session api that accepts everything and never starts anything. */
function fakeNewSession(over: Partial<NewSessionApi> = {}): NewSessionApi {
  return {
    start: async () => ({ accepted: true, launch: null }),
    poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [] } }),
    ...over,
  };
}

/** A rename api that accepts everything and changes nothing. */
function fakeRename(over: Partial<RenameApi> = {}): RenameApi {
  return { rename: async (_row, name) => ({ ok: true, name, was: null }), ...over };
}

/**
 * A feed as the actions route sends one, with only the interesting part named.
 *
 * Written as the **wire shape** rather than as `ActionsFeed`, so every test that
 * uses it goes through `parseActionsFeed` — which is the thing that has to be
 * right, and the thing a hand-built `ActionsFeed` would skip past.
 *
 * **AND FOR A WHILE IT WAS NOT THE WIRE SHAPE, WHICH IS THE POINT OF THE
 * COMMENT ABOVE MISSED BY EXACTLY ONE FIELD** (2026-09-08). The route sends
 * `actions: {session: [...], box: [...]}` and this built `actions: [...]`, so
 * ~196 tests agreed with each other over a shape the server has never sent, and
 * every action button on the real page was invisible under a sentence blaming
 * the server for being old. `actions` is still given here as ONE flat list —
 * that is what a test wants to say — and split by `scope` the way the route
 * splits it, so the fixture cannot drift from the shape again without this
 * function being edited.
 */
function actionsWire(over: { actions?: unknown[]; queues?: unknown[]; acting?: unknown } = {}): Record<string, unknown> {
  const all = over.actions ?? [];
  const scopeOf = (a: unknown): unknown => (typeof a === "object" && a !== null ? (a as Record<string, unknown>)["scope"] : null);
  return {
    actions: {
      session: all.filter((a) => scopeOf(a) !== "box"),
      box: all.filter((a) => scopeOf(a) === "box"),
    },
    queues: over.queues ?? [],
    // NAMED ONLY WHEN A TEST MEANS IT. The default is a feed with no `acting`
    // field at all, which is the honest fixture for "this server said nothing"
    // — and the arm that must NOT produce a warning. A default of
    // `{enabled: true}` would make every test here assert against a server
    // configured the way production is not.
    ...(over.acting === undefined ? {} : { acting: over.acting }),
  };
}

/**
 * An actions api that records every call and answers as the route does.
 *
 * `feed` is a function rather than a value so a test can change what the server
 * says between calls — which is what makes "the queue is re-read after a
 * mutation" observable rather than assumed.
 */
function recordingActions(
  feedOf: () => Record<string, unknown> = () => actionsWire(),
  over: Partial<ActionsApi> = {},
): {
  api: ActionsApi;
  /**
   * `rows` is only ever set by `box`, and it is there for `clear`'s reason: WHAT
   * THE PAGE SENDS is the whole of what makes a fleet-wide action reach
   * anybody. A recorder that counted the presses would have gone on passing
   * through the day the broadcast could not name a single recipient.
   */
  calls: { op: string; arg: string; second?: string | boolean; rows?: string }[];
  feeds: () => number;
} {
  const calls: { op: string; arg: string; second?: string | boolean; rows?: string }[] = [];
  let feeds = 0;
  const api: ActionsApi = {
    feed: async () => {
      feeds += 1;
      const read = parseActionsFeed(feedOf());
      if (read === null) return { ok: false, why: "the fixture is not this API" };
      return { ok: true, feed: read };
    },
    run: async (row, actionId) => {
      calls.push({ op: "run", arg: actionId, second: row.id });
      return { ok: true, kind: "queued", position: 1, why: null };
    },
    queueMessage: async (row, text) => {
      calls.push({ op: "queueMessage", arg: text, second: row.id });
      return { ok: true, kind: "queued", position: 1, why: null };
    },
    cancel: async (sessionId, itemId) => {
      calls.push({ op: "cancel", arg: sessionId, second: itemId });
      return { ok: true, kind: "accepted" };
    },
    revive: async (sessionId, itemId) => {
      calls.push({ op: "revive", arg: sessionId, second: itemId });
      return { ok: true, kind: "queue-changed", op: "revived" };
    },
    abandon: async (sessionId, itemId) => {
      calls.push({ op: "abandon", arg: sessionId, second: itemId });
      return { ok: true, kind: "queue-changed", op: "abandoned" };
    },
    /* The ids are joined into `second` so the recorder keeps its one shape.
       WHAT THE PAGE SENDS is the whole safety argument for clearing — the server
       refuses a list that is not what the queue holds — so a test that only
       counted the calls would miss the thing worth asserting. */
    clear: async (sessionId, itemIds) => {
      calls.push({ op: "clear", arg: sessionId, second: itemIds.join(",") });
      return { ok: true, kind: "queue-cleared", removed: [], keptInFlight: null, unreadable: 0 };
    },
    /* THE HOLD ID AND THE VERSION ARE THE WHOLE SAFETY ARGUMENT — a release
       built from a reading two incidents old is refused at the far end — so the
       recorder keeps both, `clear`'s reasoning one gesture along. */
    releaseHold: async (holdId, version, gesture) => {
      calls.push({ op: "releaseHold", arg: `${holdId}@${version}`, second: gesture });
      return { ok: true, kind: "hold-released", gesture, repeat: false };
    },
    box: async (actionId, dryRun, rows) => {
      calls.push({ op: "box", arg: actionId, second: dryRun, rows: rows.map((r) => r.id).join(",") });
      /* `effect: null` is *this answer described no per-row effect*, which is
         what an empty `result` means. It is REQUIRED rather than optional for
         `delivery`'s reason: a fixture that could omit it would let the
         renderer pick a default, and picking a default is the defect. */
      return { ok: true, dryRun, dryRunStated: true, result: [], why: null, effect: null };
    },
    ...over,
  };
  return { api, calls, feeds: () => feeds };
}

/**
 * A transcript reply as `/api/messages` sends one, named by its interesting half.
 *
 * The **wire shape**, like `actionsWire`, so every test goes through
 * `parseRecentMessages` rather than past it. `recentMessages` is what the
 * fixture answers with, and it is handed straight to the parser — a test that
 * built a `MessagesView` by hand would prove the renderer works on objects the
 * server never sends.
 */
function messagesWire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "found",
    path: "/home/greg/.claude/projects/-home-greg-code-spideryarn2/abc.jsonl",
    via: "slug-guess",
    turns: [],
    reachedStartOfFile: true,
    bytesRead: 4_096,
    fileBytes: 4_096,
    /* NOW, NOT A DATE — the second instance of this today, in this file.
       This was `new Date("2026-09-08T11:59:30Z")`, which meant "thirty seconds
       ago" on the morning it was written and became "46 minutes ago" by the
       afternoon, crossing `STALE_TRANSCRIPT_MS` (30 min) and turning the test
       that asserts NO stale warning into one asserting a warning the page was
       correctly showing. A fixture that means "fresh" has to be computed from
       the clock the component reads: freshness is a relation between two times
       and an absolute constant can only ever be one of them. See the same
       repair on `collectedAt` in `state()`. */
    lastModified: new Date().toISOString(),
    copies: 1,
    recordsParsed: 12,
    recordsUnparseable: 0,
    toolResultsSkipped: 0,
    ...over,
  };
}

/** One turn on the wire, with only the interesting field named. */
function turnWire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    speaker: "assistant",
    at: new Date("2026-09-08T11:59:00Z").toISOString(),
    text: "I have pushed the branch.",
    truncated: false,
    fullChars: 25,
    toolCalls: [],
    uuid: "u1",
    ...over,
  };
}

/** A messages api that records every ask and answers with a fixed wire object. */
function recordingMessages(
  replyOf: () => Record<string, unknown> = () => messagesWire(),
): { api: MessagesApi; asked: string[] } {
  const asked: string[] = [];
  const api: MessagesApi = {
    recent: async (row) => {
      asked.push(row.id);
      return parseRecentMessages(replyOf());
    },
  };
  return { api, asked };
}

function mountFull(args: {
  transport: Transport;
  steer?: SteerApi;
  newSession?: NewSessionApi;
  rename?: RenameApi;
  actionsApi?: ActionsApi;
  messagesApi?: MessagesApi;
  historyApi?: HistoryApi;
}): void {
  act(() =>
    root.render(
      <App
        transport={args.transport}
        steer={args.steer ?? recordingSteer().api}
        newSession={args.newSession ?? fakeNewSession()}
        rename={args.rename ?? fakeRename()}
        actionsApi={args.actionsApi ?? recordingActions().api}
        messagesApi={args.messagesApi ?? recordingMessages().api}
        {...(args.historyApi === undefined ? {} : { historyApi: args.historyApi })}
        /* An hour, so the poll never fires inside a test. The poll itself is
           tested on its own; leaving it live here would make every other test
           in the file depend on a timer. */
        actionsPollMs={3_600_000}
      />,
    ),
  );
}

/**
 * A dialog with a body to approve, as the server sends one.
 *
 * **Its `gate` defaults to `permission`, and that is on purpose**: what this
 * fixture describes IS a permission prompt — it has a "don't ask again" option
 * and a diff above it. A `conversation` default would have been the convenient
 * one, and every test about tapping would have gone on passing while the
 * discrimination went untested. Tests that want a tappable dialog say so.
 */
function question(over: Partial<FleetState["rows"][number]["question"] & object> = {}): NonNullable<
  FleetState["rows"][number]["question"]
> {
  return {
    prompt: "Do you want to make this edit to server.ts?",
    material: { kind: "read", text: "- const port = 8787;\n+ const port = 9999;", fingerprint: "sha256:1f3a" },
    options: [
      { label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" },
      { label: "Yes, and don't ask again", key: { via: "digit", digit: "2" }, consequence: "persistent" },
      { label: "No", key: { via: "selected" }, consequence: "decline" },
    ],
    gate: { kind: "permission", why: "one of the options would stop it asking again" },
    ...over,
  };
}

describe("master and detail", () => {
  it("opens a session on click, and shows what the list has no room for", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$1643",
              title: "the one I tapped",
              meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
            }),
          ],
        }),
      ),
    );

    // Before: the list, and no detail.
    expect(container.textContent).toContain("the one I tapped");
    expect(container.textContent).not.toContain("Recent messages");

    openSession("the one I tapped");

    const text = container.textContent ?? "";
    // The things the list cannot hold, each asserted positively.
    /* NOT "What it needs from you" — this row is idle, and that section is
       drawn only when there is something to say. It used to appear on every
       page carrying the sentence "Nothing. It is not asking you anything.",
       which is a heading whose only content was the news that it had none.
       The badge in the header already says idle. */
    expect(text).not.toContain("Nothing. It is not asking you anything.");
    expect(text).toContain("Say something to it");
    expect(text).toContain("Where it is");
    expect(text).toContain("/home/greg/code/spideryarn2");
    expect(text).toContain("117e181a-155b-435a-b95b-e74220678d1a");
    expect(container.querySelector("#steer-text")).not.toBeNull();
  });

  it("puts the selected session in the hash, so the pane survives a reload", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "keep me" })] })));
    openSession("keep me");
    expect(window.location.hash).toBe("#sessions?sel=%241643");
  });

  it("opens straight into the session the hash names", () => {
    window.location.hash = "#sessions?sel=%241643";
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "linked to" })] })));
    expect(container.textContent).toContain("Say something to it");
  });

  it("says so when the selected session is not in the latest snapshot", () => {
    window.location.hash = "#sessions?sel=%24gone";
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "still here" })] })));
    const text = container.textContent ?? "";
    /* The id stays in the URL, so the honest page says the row went away rather
       than quietly falling back to "nothing selected" — which would erase the
       fact that something was there a minute ago. */
    expect(text).toContain("not in the latest snapshot");
    expect(text).toContain("$gone");
    expect(text).not.toContain("Say something to it");
  });

  it("is a push at 390px: the detail replaces the list, and a button brings it back", () => {
    const undo = pinWidth(390);
    try {
      const feed = manualTransport();
      mountFull({ transport: feed.transport });
      act(() =>
        feed.push(
          state({
            rows: [
              steerable({ id: "$a", title: "the one I opened" }),
              steerable({ id: "$b", title: "the other one" }),
            ],
          }),
        ),
      );
      expect(openButtons()).toHaveLength(2);

      openSession("the one I opened");

      /* THE PUSH. Not a squeeze: at 390px there is no room for both, so the
         list is gone entirely rather than compressed into a column of two-word
         lines — docs/project/narrow-windows.md. The negative below is paired
         with a positive, because "the list went away" and "the whole page went
         away" look identical to `not.toContain`. */
      expect(openButtons()).toHaveLength(0);
      expect(container.textContent).toContain("Say something to it");

      const back = buttonSaying("← All sessions");
      expect(back).toBeDefined();
      act(() => back?.click());
      expect(openButtons()).toHaveLength(2);
      expect(container.textContent).not.toContain("Say something to it");
    } finally {
      undo();
    }
  });

  it("is two panes at 1280px: the list stays beside the detail, and there is no back button", () => {
    const undo = pinWidth(1280);
    try {
      const feed = manualTransport();
      mountFull({ transport: feed.transport });
      act(() =>
        feed.push(
          state({
            rows: [steerable({ id: "$a", title: "opened" }), steerable({ id: "$b", title: "beside it" })],
          }),
        ),
      );
      openSession("opened");

      expect(openButtons().map((b) => b.textContent)).toEqual(["opened", "beside it"]);
      expect(container.textContent).toContain("Say something to it");
      // The list is right there, so a button back to it would be a button to
      // where you already are.
      expect(buttonSaying("← All sessions")).toBeUndefined();
    } finally {
      undo();
    }
  });
});

/**
 * **A SESSION THAT DID NOT LAUNCH IN AUTO MODE**, on screen.
 *
 * The reading of the pane, the applicability rules and the wire parse live in
 * tests/fleet-launch-mode.test.ts, against real captures. These four are the
 * half that only exists once the page is mounted, and they are here rather than
 * in that file because `mount`, `row` and `openSession` are here: a second copy
 * of this scaffolding is the thing this repo keeps arguing against.
 *
 * The measured defect: a session in default mode stops at its first unapproved
 * command and waits for somebody asleep — 34.9 agent-hours since 2026-09-06,
 * 20% of launches, longest single stall 7.38 hours. `gjd-remote log` says
 * `running`. See `PaneAutoMode` in tools/fleet/pane.ts.
 */
describe("a session that did not launch in auto mode", () => {
  /** The list is where it has to show, because the promise is *within a minute*. */
  it("names the mode on the list card, and says what it will do", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$1",
              title: "the defective launch",
              status: { kind: "working" },
              permissionMode: { kind: "not-auto", mode: "manual mode" },
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("manual mode");
    expect(text).toMatch(/stop at the first command it cannot approve/);
  });

  /**
   * **A HEALTHY SESSION IS SILENT, AND A SHELL IS SILENT.** A badge on every
   * row is a badge nobody reads, and one on a shell is a false alarm about a
   * session that is working perfectly. Asserted as an absence because that is
   * the guarantee — the loud strip is drawn by exactly one arm.
   */
  it("says nothing at all about an auto-mode session or a shell", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({ id: "$1", title: "fine", status: { kind: "working" }, permissionMode: { kind: "auto" } }),
            row({
              id: "$2",
              title: "a shell",
              status: { kind: "shell", busy: null },
              permissionMode: { kind: "not-applicable", why: "this is a shell" },
            }),
          ],
        }),
      ),
    );
    expect(container.textContent).toContain("fine");
    expect(container.textContent).not.toMatch(/not auto/);
    expect(container.querySelector(".launch-mode")).toBeNull();
  });

  /**
   * **`cannot-tell` MUST NOT LOOK LIKE THE DEFECT.** It is the arm every
   * blocked session lands in — Claude Code's modal covers the status bar — so
   * drawing it in the loud colour would put a red strip on the rows Greg opens
   * the page to see, and teach him to ignore the one that is real.
   */
  it("does not raise the alarm about a session whose mode could not be read", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$1",
              title: "unread",
              status: { kind: "needs-you" },
              permissionMode: { kind: "cannot-tell", why: "a dialog is covering the status bar" },
            }),
          ],
        }),
      ),
    );
    expect(container.querySelector(".launch-mode")).toBeNull();
    expect(container.textContent).not.toMatch(/not auto/);
  });

  /** The detail is where the recovery is spelled out — the thing to press. */
  it("gives the detail the fix to press", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$1",
              title: "open me",
              status: { kind: "working" },
              permissionMode: { kind: "not-auto", mode: "manual mode" },
            }),
          ],
        }),
      ),
    );
    openSession("open me");
    expect(container.textContent).toContain("Yes, and switch to auto mode");
  });

  /**
   * And the detail is the ONE place the shrug is drawn: a per-session fact on
   * the screen you opened deliberately, rather than a grey line beside every
   * blocked row on the list.
   */
  it("admits on the detail that it could not tell, without offering a fix", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$2",
              title: "open me too",
              status: { kind: "working" },
              permissionMode: { kind: "cannot-tell", why: "the status bar is not on this screenful" },
            }),
          ],
        }),
      ),
    );
    openSession("open me too");
    expect(container.textContent).toContain("permission mode unread");
    expect(container.textContent).not.toContain("Yes, and switch to auto mode");
  });
});

describe("the orderings", () => {
  const rows = [
    steerable({
      id: "$new",
      title: "started five minutes ago",
      status: { kind: "idle" },
      startedAt: new Date("2026-09-08T11:55:00Z").toISOString(),
    }),
    steerable({
      id: "$old",
      title: "running all night",
      status: { kind: "idle" },
      startedAt: new Date("2026-09-07T20:00:00Z").toISOString(),
    }),
    steerable({
      id: "$blocked",
      title: "asking you something",
      status: { kind: "needs-you" },
      startedAt: new Date("2026-09-08T11:00:00Z").toISOString(),
    }),
  ];

  function orderSelect(): HTMLSelectElement {
    const select = container.querySelector<HTMLSelectElement>("select");
    if (!select) throw new Error("there is no ordering control on the page");
    return select;
  }

  function choose(value: string): void {
    const select = orderSelect();
    act(() => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("offers every ordering the view module knows about", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows })));
    expect([...orderSelect().options].map((o) => o.value)).toEqual([...ORDERINGS]);
  });

  it("is status by default, which puts the blocked one first", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows })));
    expect(titlesOnScreen()[0]).toBe("asking you something");
    // And the bands are drawn, which is the half a sort test cannot see.
    expect(container.textContent).toContain("Needs you · 1");
  });

  it("orders by how long they have been running, and drops the bands when it does", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows })));
    choose("longest");

    expect(titlesOnScreen()).toEqual([
      "running all night",
      "asking you something",
      "started five minutes ago",
    ]);
    /* The headings go, because grouping by status while sorting by uptime would
       put the longest-running session third under a heading naming the thing
       the reader just asked not to sort by. Paired with the positive above, so
       a page that rendered nothing could not pass this. */
    expect(container.textContent).not.toContain("Needs you · 1");
  });

  it("writes the ordering into the hash, and reads it back on the next load", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows })));
    choose("name");
    expect(window.location.hash).toBe("#sessions?order=name");

    // A reload: a fresh mount against the hash that is now in the address bar.
    act(() => root.unmount());
    root = createRoot(container);
    const second = manualTransport();
    mountFull({ transport: second.transport });
    act(() => second.push(state({ rows })));
    expect(titlesOnScreen()).toEqual([
      "asking you something",
      "running all night",
      "started five minutes ago",
    ]);
  });

  it("leaves no trace in the hash for the default, rather than writing it down", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows })));
    choose("newest");
    expect(window.location.hash).toBe("#sessions?order=newest");
    choose("status");
    expect(window.location.hash).toBe("#sessions");
    expect(titlesOnScreen()[0]).toBe("asking you something");
  });

  it("sorts a row with an unreadable start time last, rather than anywhere", () => {
    /* `Date.parse` answers NaN instead of throwing, every comparison with NaN
       is false, and a comparator that subtracts two of them returns NaN — which
       sorts as "equal to everything", so the row lands wherever the sort walked
       and the page looks fine. */
    const broken = [
      steerable({ id: "$b", title: "broken clock", startedAt: "not a date" }),
      steerable({ id: "$a", title: "real clock", startedAt: new Date("2026-09-08T09:00:00Z").toISOString() }),
    ];
    expect(sortRows(broken, "longest").map((r) => r.title)).toEqual(["real clock", "broken clock"]);
    expect(sortRows(broken, "newest").map((r) => r.title)).toEqual(["real clock", "broken clock"]);
  });
});

describe("what an option would actually do", () => {
  it("never draws `unknown` more quietly than `persistent`", () => {
    /* THE INVERSION THIS TEST EXISTS TO PREVENT. `classifyConsequence` is a
       reading of English off a terminal, written to be wrong in one direction
       only: nothing falls through to `once`, and anything unrecognised is
       `unknown`. If the page then drew `persistent` in red and `unknown` in
       neutral grey, the conservative default would be the LEAST alarming badge
       on screen — a new Claude Code label ("Yes, and remember this") would
       classify as `unknown` and render as the safest-looking option there.
       An inequality rather than a comment, because a comment cannot fail. */
    expect(CONSEQUENCE_RANK.unknown).toBeGreaterThanOrEqual(CONSEQUENCE_RANK.persistent);
    expect(TONE_ALARM[CONSEQUENCE_TONE.unknown]).toBeGreaterThanOrEqual(TONE_ALARM[CONSEQUENCE_TONE.persistent]);
    // And both are louder than the two that only reach this one action.
    expect(TONE_ALARM[CONSEQUENCE_TONE.persistent]).toBeGreaterThan(TONE_ALARM[CONSEQUENCE_TONE.once]);
    expect(TONE_ALARM[CONSEQUENCE_TONE.persistent]).toBeGreaterThan(TONE_ALARM[CONSEQUENCE_TONE.decline]);
  });

  it("reads an unrecognised or missing consequence as unknown, never as `once`", () => {
    /* Defaulting a missing field to "this time only" would be the whole failure
       in one line: an old server, or a renamed field, and every option on the
       page silently becomes the mild one. */
    const read = wire({
      rows: [
        {
          id: "$a",
          status: { kind: "needs-you" },
          question: {
            kind: "question",
            prompt: "?",
            material: { kind: "no-material" },
            options: [
              { label: "a", key: { via: "digit", digit: "1" } },
              { label: "b", key: { via: "digit", digit: "2" }, consequence: "remembers-forever" },
              { label: "c", key: { via: "digit", digit: "3" }, consequence: "once" },
            ],
          },
        },
      ],
    });
    expect(read.rows[0]?.question?.options.map((o) => o.consequence)).toEqual(["unknown", "unknown", "once"]);
  });

  it("shows the badge on the page, so it is not only in a data structure", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "asking", status: { kind: "needs-you" }, question: question() })] })),
    );
    openSession("asking");
    const text = container.textContent ?? "";
    expect(text).toContain("and from now on");
    expect(text).toContain("this time only");
    expect(text).toContain("declines");
  });
});

describe("what is actually being approved", () => {
  it("shows the material and its fingerprint in the detail", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "asking", status: { kind: "needs-you" }, question: question() })] })),
    );
    openSession("asking");
    const text = container.textContent ?? "";
    /* The prompt is the headline and this is the evidence. Offering a way to
       say yes without showing this is asking somebody to approve something they
       cannot see — which is what two reviews independently found. */
    expect(text).toContain("What you would be approving");
    expect(text).toContain("+ const port = 9999;");
    expect(text).toContain("sha256:1f3a");
  });

  it("renders the material as text, not as markup", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$a",
              title: "asking",
              status: { kind: "needs-you" },
              question: question({
                material: { kind: "read", text: "<img src=x onerror=alert(1)>", fingerprint: "sha256:0" },
              }),
            }),
          ],
        }),
      ),
    );
    openSession("asking");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("refuses to offer an answer when the material could not be read", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$a",
              title: "asking",
              status: { kind: "needs-you" },
              question: question({
                material: { kind: "unreadable", why: "the capture starts mid-dialog, so what we can see is a fragment" },
              }),
            }),
          ],
        }),
      ),
    );
    openSession("asking");
    const text = container.textContent ?? "";
    expect(text).toContain("could not be read");
    expect(text).toContain("the capture starts mid-dialog");
    // The options are still LISTED — you can read the menu — and none of them
    // is a button, which is the difference between informing and inviting.
    expect(text).toContain("Yes, and don't ask again");
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
  });

  it("treats an absent material as unreadable, never as 'this dialog proposes nothing'", () => {
    /* One line apart and opposite claims. An old server that sends no material
       must not produce an empty box that reads as a menu with nothing attached. */
    const read = wire({
      rows: [{ id: "$a", status: { kind: "needs-you" }, question: { kind: "question", prompt: "?", options: [] } }],
    });
    expect(read.rows[0]?.question?.material).toEqual({
      kind: "unreadable",
      why: "the server sent nothing about what this dialog is asking you to approve",
    });
  });

  it("lets a menu with nothing attached say so, and still be answerable", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          /* SAID OUT LOUD, because the page fails closed on this now: the answer
             buttons are drawn only on a positive `enabled`, so a test about
             whether they appear has to state the permission it assumes rather
             than inherit it. types.ts § `AnsweringReading`. */
          answeringEnabled: { kind: "enabled" },
          rows: [
            steerable({
              id: "$a",
              title: "a loop menu",
              status: { kind: "needs-you" },
              question: question({ material: { kind: "no-material" }, gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("a loop menu");
    expect(container.textContent).toContain("the menu is the whole question");
    expect(container.querySelectorAll("button.answer").length).toBeGreaterThan(0);
  });
});

describe("answering, and the dialogs it is not offered for", () => {
  /**
   * THE DISCRIMINATION, on the page. The same `steerable` row, twice, with only
   * the gate different — so a build that offered buttons unconditionally, or
   * refused unconditionally, fails one half of this whichever way it went.
   */
  it("offers buttons for an agent's own question and not for a permission prompt", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          // The permission this half assumes, stated. See the loop-menu test above.
          answeringEnabled: { kind: "enabled" },
          rows: [
            steerable({
              id: "$a",
              title: "an agent asking",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("an agent asking");
    expect(container.querySelectorAll("button.answer").length).toBeGreaterThan(0);
    // No standing caution above a dialog that is genuinely answerable — the
    // blanket warning was the thing Greg pushed back on.
    expect(container.textContent).not.toContain("not a button");

    act(() =>
      feed.push(
        state({
          /* AND ON THIS HALF TOO, so that the zero below is the GATE's doing
             rather than the flag's. A negative that could be produced by either
             of two causes proves neither. */
          answeringEnabled: { kind: "enabled" },
          rows: [
            steerable({
              id: "$a",
              title: "an agent asking",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "permission", why: "one option would stop it asking again" } }),
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
    expect(text).toContain("grants a permission, so it is not a button");
    expect(text).toContain("one option would stop it asking again");
    expect(text).toContain("gjd-remote resume");
    // The options are still READABLE, which is the positive half: taking the
    // buttons away must not take the information away.
    expect(text).toContain("Yes, and don't ask again");
  });

  /**
   * "I could not tell" is treated exactly as `permission`, and a server too old
   * to send `gate` at all lands there.
   *
   * Asserted through **`parseFleetState`, not through a hand-built row**,
   * because that is the only path an older server's payload actually takes: the
   * component fixtures in this file are typed values that never meet the
   * parser, so a test built from one would be asserting my opinion of the
   * default rather than the default. `parseGate` failing towards `unknown` is
   * the whole safety property — the convenient direction would have been the
   * one that makes the buttons appear.
   */
  it("reads a question with no gate as one it could not classify", () => {
    const parsed = parseFleetState({
      schema: 1,
      collectedAt: new Date().toISOString(),
      rows: [
        {
          id: "$a",
          name: "a",
          title: "asking",
          startedAt: new Date().toISOString(),
          status: { kind: "needs-you" },
          // Exactly what a server built before 2026-09-08 sends: a question
          // with everything except the field that decides tappability.
          question: {
            kind: "question",
            prompt: "Do you want to proceed?",
            material: { kind: "no-material" },
            options: [{ label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" }],
          },
        },
      ],
    }, Date.now());
    if (!parsed.ok) throw new Error(parsed.why);
    const gate = parsed.state.rows[0]?.question?.gate;
    expect(gate?.kind).toBe("unknown");
    expect(gate?.kind === "unknown" ? gate.why : "").toContain("did not say");

    // The paired positive, so this cannot pass by everything parsing to unknown.
    const good = parseFleetState({
      schema: 1,
      collectedAt: new Date().toISOString(),
      rows: [
        {
          id: "$a",
          name: "a",
          title: "asking",
          startedAt: new Date().toISOString(),
          status: { kind: "needs-you" },
          question: {
            kind: "question",
            prompt: "Which colour?",
            material: { kind: "no-material" },
            options: [{ label: "Blue", key: { via: "digit", digit: "1" }, consequence: "unknown" }],
            gate: { kind: "conversation" },
          },
        },
      ],
    }, Date.now());
    if (!good.ok) throw new Error(good.why);
    expect(good.state.rows[0]?.question?.gate.kind).toBe("conversation");
  });

  /**
   * Every arm off the wire, one assertion each.
   *
   * Added after a mutation found the hole: with only "no gate ⇒ unknown" and
   * "conversation ⇒ conversation" above, a `parseGate` that returned
   * `conversation` for EVERYTHING except a missing field left all 155 tests
   * green — and that build offers buttons on every permission dialog on the
   * box. The arm nobody asserted was the one that mattered.
   */
  it("keeps each gate arm distinct, and rounds an unrecognised one down", () => {
    const gateOf = (gate: unknown) => {
      const parsed = parseFleetState({
        schema: 1,
        collectedAt: new Date().toISOString(),
        rows: [
          {
            id: "$a",
            name: "a",
            title: "asking",
            startedAt: new Date().toISOString(),
            status: { kind: "needs-you" },
            question: {
              kind: "question",
              prompt: "Do you want to proceed?",
              material: { kind: "no-material" },
              options: [{ label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" }],
              gate,
            },
          },
        ],
      }, Date.now());
      if (!parsed.ok) throw new Error(parsed.why);
      const out = parsed.state.rows[0]?.question?.gate;
      if (out === undefined) throw new Error("the row parsed without a question");
      return out;
    };

    const permission = gateOf({ kind: "permission", why: "one option would stop it asking again" });
    expect(permission.kind).toBe("permission");
    expect(permission.kind === "permission" ? permission.why : "").toBe("one option would stop it asking again");

    const cannotTell = gateOf({ kind: "unknown", why: "the body did not start with a header" });
    expect(cannotTell.kind).toBe("unknown");
    expect(cannotTell.kind === "unknown" ? cannotTell.why : "").toBe("the body did not start with a header");

    expect(gateOf({ kind: "conversation" }).kind).toBe("conversation");

    // An arm from a NEWER server. Rounded down rather than up, and the sentence
    // names what it did not recognise so the page is not merely mysterious.
    const future = gateOf({ kind: "configuration", why: "changes a harness setting" });
    expect(future.kind).toBe("unknown");
    expect(future.kind === "unknown" ? future.why : "").toContain("configuration");
  });

  it("shows the server's 503 in the server's own words, and stops offering buttons after it", async () => {
    const why =
      "answering a dialog is disabled: the captured question does not include what is being approved, " +
      "so tapping an option could approve something other than what you were shown. " +
      "Use `gjd-remote resume <name>` and answer it in the terminal.";
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      steer: refusingSteer({ ok: false, code: "answering-disabled", why, status: 503, from: "server", delivery: { kind: "none" } }),
    });
    // `conversation` AND `enabled`, so the buttons are there to be taken away.
    // This test is about the server changing its mind at the moment of the tap:
    // it said answering was on, and refused anyway.
    act(() =>
      feed.push(
        state({
          answeringEnabled: { kind: "enabled" },
          rows: [
            steerable({
              id: "$a",
              title: "asking",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("asking");
    expect(container.querySelectorAll("button.answer").length).toBeGreaterThan(0);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.answer")?.click();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("gjd-remote resume");
    expect(text).toContain("The server would not answer this");
    /* A control that refuses every time you press it is worse than one that
       explains itself, so the options go back to being a list — and the list is
       still there, which is the positive half of this pair. */
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
    expect(text).toContain("Yes, and don't ask again");
  });

  it("leaves the message box working while answering is off", async () => {
    const recorder = recordingSteer();
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: recorder.api });
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "asking", status: { kind: "needs-you" }, question: question() })] })),
    );
    openSession("asking");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    expect(box.disabled).toBe(false);
    typeInto(box, "answer it yourself, you have my go-ahead");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
    expect(recorder.calls[0]?.op).toBe("message");
  });
});

describe("the rule about sending the server its own claims back", () => {
  /**
   * The dialog as it arrives on the wire, INCLUDING a field this build has
   * never heard of.
   *
   * `capturedAt` stands in for whatever the server adds next. A client that
   * rebuilt `question` from its own parse would drop it silently — which is
   * exactly how the material fix would have landed and done nothing.
   */
  const wireQuestion = {
    kind: "question",
    prompt: "Do you want to make this edit to server.ts?",
    material: {
      kind: "read",
      text: "- const port = 8787;\n+ const port = 9999;",
      fingerprint: "sha256:1f3a",
    },
    options: [
      { label: "Yes", key: { via: "digit", digit: "1" }, consequence: "once" },
      { label: "No, tell Claude what to do differently", key: { via: "selected" }, consequence: "decline" },
    ],
    // `conversation`, because this pair of tests is about the round trip and
    // needs a button to press. What is on the wire is what goes back, and that
    // is the assertion — the gate decides whether the button exists, and is
    // tested for that above.
    gate: { kind: "conversation" },
    capturedAt: "2026-09-08T12:00:04.113Z",
  };

  const wireRow = {
    id: "$1643",
    name: "some-session",
    title: "asking about an edit",
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    paneId: "%1646",
    panePid: 645023,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    question: wireQuestion,
    status: { kind: "needs-you" },
  };

  /** A `fetch` that records every call and answers as the steer route does. */
  function recordingFetch(answer: { status: number; body: unknown }): {
    impl: typeof fetch;
    calls: { url: string; init: RequestInit | undefined }[];
  } {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        statusText: "",
        json: async () => answer.body,
      } as Response;
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("hands `question` back byte-identical, extra fields and all", async () => {
    /* `answeringEnabled: true` on the RAW PAYLOAD, not on a parsed fixture:
       these two tests drive the real parser and the real steer api, and the
       page draws answer buttons only on a positive reading of this field
       (types.ts § `AnsweringReading`). An honest server sends it; omitting it
       here would be testing the page an older server draws, which has no
       buttons to click. */
    const parsed = wire({ rows: [wireRow], collectedAt: state().collectedAt, answeringEnabled: true });
    expect(parsed.rows).toHaveLength(1);

    const recorded = recordingFetch({ status: 200, body: { ok: true, op: "answer", sent: [["tmux", "send-keys"]] } });
    vi.stubGlobal("fetch", recorded.impl);

    const feed = manualTransport();
    /* The REAL steer api, so this test exercises the bytes on the wire rather
       than a seam that could be right while the wire is wrong. Every OTHER
       path is faked, so the only call this stubbed `fetch` sees is the one
       under test — which is what lets the assertion below count them. That now
       includes `messagesApi`: opening a session reads its transcript, which is
       a GET on a different route and would otherwise land in this count and
       say nothing about the rule under test. */
    act(() =>
      root.render(
        <App
          transport={feed.transport}
          newSession={fakeNewSession()}
          rename={fakeRename()}
          actionsApi={recordingActions().api}
          messagesApi={recordingMessages().api}
          actionsPollMs={3_600_000}
        />,
      ),
    );
    act(() => feed.push(parsed));
    openSession("asking about an edit");

    const yes = container.querySelector<HTMLButtonElement>("button.answer");
    expect(yes?.textContent).toContain("Yes");
    await act(async () => {
      yes?.click();
    });

    expect(recorded.calls).toHaveLength(1);
    const call = recorded.calls[0];
    expect(call?.url).toBe("api/steer/answer");
    const body = JSON.parse(String(call?.init?.body)) as Record<string, unknown>;

    // THE ASSERTION THIS WHOLE DESCRIBE EXISTS FOR.
    expect(body["question"]).toEqual(wireQuestion);
    const sent = body["question"] as Record<string, unknown>;
    expect(sent["capturedAt"]).toBe(wireQuestion.capturedAt);
    expect(sent["material"]).toEqual(wireQuestion.material);

    // And every identifier, verbatim off the row that was tapped.
    expect(body["paneId"]).toBe("%1646");
    expect(body["sessionId"]).toBe("$1643");
    expect(body["claudeSessionId"]).toBe("117e181a-155b-435a-b95b-e74220678d1a");
    expect(body["panePid"]).toBe(645023);
    expect(body["status"]).toEqual({ kind: "needs-you" });
    expect(body["optionIndex"]).toBe(0);
  });

  it("does not ask the server for fresh state before sending", async () => {
    /* If the client refreshed first, every guard in steer.ts would be comparing
       the box against itself and would pass unconditionally — routes-steer.ts
       says so at length. So the only request an answer may make is the answer. */
    /* `answeringEnabled: true` on the RAW PAYLOAD, not on a parsed fixture:
       these two tests drive the real parser and the real steer api, and the
       page draws answer buttons only on a positive reading of this field
       (types.ts § `AnsweringReading`). An honest server sends it; omitting it
       here would be testing the page an older server draws, which has no
       buttons to click. */
    const parsed = wire({ rows: [wireRow], collectedAt: state().collectedAt, answeringEnabled: true });
    const recorded = recordingFetch({ status: 200, body: { ok: true, op: "answer", sent: [] } });
    vi.stubGlobal("fetch", recorded.impl);

    const feed = manualTransport();
    /* Same as above: every seam but the one under test is faked, so the
       transcript read that opening a session does is not in this count. */
    act(() =>
      root.render(
        <App
          transport={feed.transport}
          newSession={fakeNewSession()}
          rename={fakeRename()}
          actionsApi={recordingActions().api}
          messagesApi={recordingMessages().api}
          actionsPollMs={3_600_000}
        />,
      ),
    );
    act(() => feed.push(parsed));
    openSession("asking about an edit");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.answer")?.click();
    });

    expect(recorded.calls.map((c) => c.url)).toEqual(["api/steer/answer"]);
    /* Stated separately, and about the URL that would actually do the damage.
       The assertion above is exact and would catch a refresh today; it would
       stop catching one the moment somebody legitimately added a second call
       to this path, and `api/state` is the one that must never appear whatever
       else does. */
    expect(recorded.calls.map((c) => c.url)).not.toContain("api/state");
    expect(recorded.calls).toHaveLength(1);
  });

  it("sends the status object the server sent, not the one this build parsed it into", () => {
    /* A status arm this build has never heard of renders as `unknown` — which
       is right on the page and wrong on the wire. Declaring `unknown` about a
       row the server called something else is a claim the person never made,
       and a newer server should get its own word back and decide. */
    const strange = { kind: "compacting", detail: "rolling up the context" };
    const one = wire({ rows: [{ ...wireRow, status: strange, question: null }] }).rows[0];
    if (one === undefined) throw new Error("the fixture had no rows");
    expect(one.status).toEqual({ kind: "unknown", why: 'this page does not know the status "compacting"' });
    expect(steerMessageBody(one, "carry on").status).toEqual(strange);
  });

  it("shows the server's refusal in the server's own words", async () => {
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      steer: refusingSteer({
        ok: false,
        code: "wrong-pane",
        why: "pane %1646 is in session $1643 now, not $1",
        status: 409,
        from: "server",
        /* A refusal made BEFORE the delivery module had an opinion, which is
           what most refusals are: the wrong-pane check runs before a keystroke
           is typed, so `none` is a claim the server is entitled to make. */
        delivery: { kind: "none" } as const,
      }),
    });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "moved under me" })] })));
    openSession("moved under me");

    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("pane %1646 is in session $1643 now, not $1");
    expect(text).toContain("wrong-pane");
    expect(text).toContain("Nothing was sent.");
    // 409 means the world moved, which is the one case where refreshing helps.
    expect(buttonSaying("Refresh and look again")).toBeDefined();
  });

  /**
   * **THE JOIN, AND IT IS A STRING COMPARISON NO TYPE PROTECTS.**
   *
   * `input-not-empty` is minted in steer.ts, given a status in routes-steer.ts,
   * carried over the wire, and compared in `Outcome` — where the client models a
   * refusal code as an arbitrary `string`, because it must accept codes from a
   * server newer than itself. So a one-character mismatch there compiles, drops
   * this refusal into the generic 409 branch, and shows *"Refresh and look
   * again"* for the one 409 that refreshing cannot help. GPT Sol's finding: the
   * join was correct and entirely unprotected, and every other test in this file
   * would have stayed green through breaking it.
   *
   * This repo's standing failure is a page and a route that disagree about a
   * field name — the box actions that sent `dryRun` at a route parsing `mode`,
   * every one of them a dry run reported as "Done." So the assertion is on all
   * three halves: the special sentence appears, the generic button does NOT, and
   * the handoff carries the row's own name.
   */
  it("renders input-not-empty as its own refusal, with the handoff and no Refresh button", async () => {
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      steer: refusingSteer({
        ok: false,
        code: "input-not-empty",
        why: "pane %1646 has 1 line of text already in its input box; a message sent now would be added to the end of it and submitted as one",
        status: 409,
        from: "server",
        // `none` because nothing left the box — the guard fires before the
        // transport is touched, which is also what lets the drain put a queued
        // item back rather than destroying it.
        delivery: { kind: "none" },
      }),
    });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "half-typed" })] })));
    openSession("half-typed");

    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("input-not-empty");
    expect(text).toContain("would be added to the end of it");
    // The advice that replaces the generic one.
    expect(text).toContain("Refreshing will not help");
    // The handoff, with the SESSION'S OWN NAME — not its id, which is what
    // `gjd-remote resume` would choke on.
    expect(text).toContain("gjd-remote resume");
    // AND THE ABSENCE, which is the half that catches a broken comparison: if
    // the code fell through to the generic 409 branch both the sentence above
    // and this button would be on screen, and asserting only the sentence would
    // pass.
    expect(buttonSaying("Refresh and look again")).toBeUndefined();
  });

  it("refuses locally only for a row that has no address at all, and says which", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows: [row({ id: "$legacy", title: "a session from before", paneId: null })] })));
    openSession("a session from before");
    const text = container.textContent ?? "";
    expect(text).toContain("no tmux pane handle");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    expect(box?.disabled).toBe(true);
  });

  it("hands the message and the row that was tapped to the typed action", async () => {
    const recorder = recordingSteer();
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: recorder.api });
    act(() =>
      feed.push(
        state({ rows: [steerable({ id: "$a", title: "first" }), steerable({ id: "$b", title: "second" })] }),
      ),
    );
    openSession("second");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "pull the latest dev and carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.op).toBe("message");
    expect(recorder.calls[0]?.row.id).toBe("$b");
    expect(recorder.calls[0]?.arg).toBe("pull the latest dev and carry on");
    expect(container.textContent).toContain("Sent.");
  });
});

/* ==========================================================================
   Stage v0.4f — the transcript, read off the wire and put on the page.
   ========================================================================== */

describe("the transcript reply, as this page reads it", () => {
  it("keeps the three arms apart, and each one's own sentence", () => {
    const found = parseRecentMessages(messagesWire({ turns: [turnWire()] }));
    expect(found.kind).toBe("found");

    const missing = parseRecentMessages({
      kind: "not-found",
      reason: "no-claude-session-id",
      why: "this session has no Claude conversation id, so there is no transcript to read",
    });
    expect(missing.kind).toBe("not-found");
    if (missing.kind !== "not-found") throw new Error("unreachable");
    // Verbatim. The server wrote it for a person on a phone.
    expect(missing.why).toBe("this session has no Claude conversation id, so there is no transcript to read");
    expect(missing.reason).toBe("no-claude-session-id");

    const broken = parseRecentMessages({ kind: "unreadable", path: "/tmp/x.jsonl", why: "EACCES" });
    expect(broken.kind).toBe("unreadable");
    if (broken.kind !== "unreadable") throw new Error("unreachable");
    expect(broken.path).toBe("/tmp/x.jsonl");
    expect(broken.why).toBe("EACCES");
  });

  it("calls an answer that is not this API `no-answer`, which is not `unreadable`", () => {
    /* **The distinction the whole tool is built around**, in actions-client's
       words: an empty catalogue and a server that sent no catalogue are
       opposite claims. Here: *the server could not read the transcript* and
       *this page could not read the server* are different failures, and only
       one of them is the server's fault. */
    for (const junk of [null, 42, "hello", {}, { kind: "sideways" }, []]) {
      const view = parseRecentMessages(junk);
      expect(view.kind).toBe("no-answer");
    }
  });

  it("does not turn a missing `reachedStartOfFile` into `there is more above`", () => {
    /* transcript.ts: this field is "what stops '3 turns' from being
       ambiguous". A server that did not send it has made NO claim, and
       defaulting it either way invents one. */
    const view = parseRecentMessages(messagesWire({ reachedStartOfFile: undefined }));
    if (view.kind !== "found") throw new Error("expected found");
    expect(view.reachedStartOfFile).toBeNull();

    const said = parseRecentMessages(messagesWire({ reachedStartOfFile: false }));
    if (said.kind !== "found") throw new Error("expected found");
    expect(said.reachedStartOfFile).toBe(false);
  });

  it("tells `no turns` apart from `no turns field`", () => {
    const empty = parseRecentMessages(messagesWire({ turns: [] }));
    if (empty.kind !== "found") throw new Error("expected found");
    expect(empty.turnsOffered).toBe(true);
    expect(empty.turns).toHaveLength(0);

    const silent = parseRecentMessages(messagesWire({ turns: undefined }));
    if (silent.kind !== "found") throw new Error("expected found");
    expect(silent.turnsOffered).toBe(false);
  });

  it("counts a turn it cannot read rather than dropping it", () => {
    const view = parseRecentMessages(messagesWire({ turns: [turnWire(), 7, null] }));
    if (view.kind !== "found") throw new Error("expected found");
    expect(view.turns).toHaveLength(1);
    expect(view.unreadableTurns).toBe(2);
  });

  it("does not round an unknown speaker to `assistant`", () => {
    /* A speaker this build has never heard of is `unrecognised` and says so.
       Rounding it to `assistant` would MISATTRIBUTE a message, which is the
       exact hazard `compact-summary` exists to name in transcript.ts. */
    const view = parseRecentMessages(messagesWire({ turns: [turnWire({ speaker: "oracle" })] }));
    if (view.kind !== "found") throw new Error("expected found");
    expect(view.turns[0]?.speaker).toBe("unrecognised");
  });

  it("keeps a turn that only called tools, because that is a real state", () => {
    const view = parseRecentMessages(
      messagesWire({ turns: [turnWire({ text: "", toolCalls: [{ name: "Bash", detail: "npm test" }] })] }),
    );
    if (view.kind !== "found") throw new Error("expected found");
    expect(view.turns).toHaveLength(1);
    expect(view.turns[0]?.toolCalls).toEqual([{ name: "Bash", detail: "npm test" }]);
  });

  it("asks for the row's own handle and nothing rebuilt", () => {
    expect(messagesUrl(steerable({ id: "$1643", name: "a-name" }))).toBe(`${MESSAGES_URL}?id=%241643`);
  });

  it("says the fetch failed in its own voice when the request never landed", async () => {
    const api = makeMessagesApi(async () => {
      throw new Error("connection refused");
    });
    const view = await api.recent(steerable({ id: "$1" }));
    expect(view.kind).toBe("no-answer");
    if (view.kind !== "no-answer") throw new Error("unreachable");
    expect(view.why).toContain("connection refused");
  });

  it("reads the server's 404 body rather than inventing a sentence for it", async () => {
    const api = makeMessagesApi(async () =>
      new Response(JSON.stringify({ kind: "not-found", reason: "no-such-session", why: "no session with that handle in the current snapshot" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );
    const view = await api.recent(steerable({ id: "$1" }));
    expect(view.kind).toBe("not-found");
    if (view.kind !== "not-found") throw new Error("unreachable");
    expect(view.why).toBe("no session with that handle in the current snapshot");
  });
});

describe("the one check on the hazard the transcript reader cannot see from inside", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");

  it("calls a long-silent transcript suspect when the box calls the session working", () => {
    const age = transcriptAge(new Date(now - 4 * 60 * 60 * 1000).toISOString(), { kind: "working" }, now);
    expect(age.kind).toBe("suspect");
  });

  it("does not call it suspect when the session is not working", () => {
    /* `needs-you` is the one that would false-alarm hardest: a session parked
       on a dialog writes nothing until somebody answers it, and that is
       routinely hours. */
    for (const status of [{ kind: "idle" } as const, { kind: "needs-you" } as const, { kind: "no-claude" } as const]) {
      expect(transcriptAge(new Date(now - 4 * 60 * 60 * 1000).toISOString(), status, now).kind).toBe("quiet");
    }
  });

  it("leaves a working session inside the threshold alone", () => {
    const age = transcriptAge(new Date(now - (STALE_TRANSCRIPT_MS - 1_000)).toISOString(), { kind: "working" }, now);
    expect(age.kind).toBe("recent");
  });

  it("says it cannot tell when the server sent no timestamp", () => {
    expect(transcriptAge(null, { kind: "working" }, now).kind).toBe("unstated");
    expect(transcriptAge("not a date", { kind: "working" }, now).kind).toBe("unstated");
  });
});

describe("recent messages, on the page", () => {
  function openWith(reply: Record<string, unknown>, over: Partial<Row> = {}): { asked: string[] } {
    const feed = manualTransport();
    const messages = recordingMessages(() => reply);
    mountFull({ transport: feed.transport, messagesApi: messages.api });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$a",
              title: "a session",
              meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
              ...over,
            }),
          ],
        }),
      ),
    );
    openSession("a session");
    return messages;
  }

  function turns(): Element[] {
    return [...container.querySelectorAll(".transcript-turn")];
  }

  it("draws the turns, newest last, and says the session has said this much and no more", async () => {
    openWith(
      messagesWire({
        turns: [turnWire({ speaker: "human", text: "pull dev and carry on", uuid: "u1" }), turnWire({ text: "Pulled and pushed.", uuid: "u2" })],
        reachedStartOfFile: true,
      }),
    );
    await act(async () => {});

    expect(turns()).toHaveLength(2);
    const text = container.textContent ?? "";
    expect(text).toContain("pull dev and carry on");
    expect(text).toContain("Pulled and pushed.");
    // `reachedStartOfFile` is not decoration: it is what makes "2 turns" mean something.
    expect(text).toContain("This is the whole conversation");
    // And the placeholder is gone.
    expect(text).not.toContain("Recent messages are not wired up yet");
  });

  it("says there is more above when the walk stopped on the limit", async () => {
    openWith(messagesWire({ turns: [turnWire()], reachedStartOfFile: false }));
    await act(async () => {});
    expect(container.textContent ?? "").toContain("There is more above this");
  });

  it("says it does not know when the server did not say", async () => {
    openWith(messagesWire({ turns: [turnWire()], reachedStartOfFile: undefined }));
    await act(async () => {});
    expect(container.textContent ?? "").toContain("did not say whether there is more above");
  });

  it("renders a not-found as the server's sentence, and NOT as an empty conversation", async () => {
    openWith({
      kind: "not-found",
      reason: "no-claude-session-id",
      why: "this session has no Claude conversation id, so there is no transcript to read",
    });
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("this session has no Claude conversation id");
    expect(text).toContain("no-claude-session-id");
    /* The failure this stage exists to avoid: a panel that shows nothing and
       looks finished. No turns, and nothing claiming the conversation was
       read. */
    expect(turns()).toHaveLength(0);
    expect(text).not.toContain("This is the whole conversation");
  });

  it("renders an unreadable as the server's sentence and the path it failed on", async () => {
    openWith({ kind: "unreadable", path: "/home/greg/.claude/projects/x/abc.jsonl", why: "the file could not be opened: EACCES" });
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).toContain("the file could not be opened: EACCES");
    expect(text).toContain("/home/greg/.claude/projects/x/abc.jsonl");
    expect(turns()).toHaveLength(0);
  });

  it("says plainly when the answer was not this API, and says it was this browser talking", async () => {
    openWith({ kind: "sideways" });
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).toContain("said by this browser");
    expect(turns()).toHaveLength(0);
  });

  it("asks no matter what status, which is the whole point of the stage", async () => {
    /* Greg: "no matter what status". A shell has no transcript and the honest
       answer there is the server's sentence, not a suppressed section. */
    const messages = openWith(
      {
        kind: "not-found",
        reason: "no-claude-session-id",
        why: "this session is a shell, so there is no Claude conversation to read",
      },
      { status: { kind: "shell", busy: null }, claudeSessionId: null, rawStatus: { kind: "shell", busy: null } },
    );
    await act(async () => {});
    expect(messages.asked).toEqual(["$a"]);
    expect(container.textContent ?? "").toContain("this session is a shell");
  });

  it("warns when a working session's transcript was last written hours ago", async () => {
    /* transcript.ts, on `lastModified`: "A transcript last written hours ago,
       against a row the collector calls `working`, is that bug rather than a
       quiet agent." */
    openWith(
      messagesWire({
        turns: [turnWire()],
        /* Five hours before NOW, for the same reason as the helper's default:
           this test wants "hours ago" and must go on meaning it whenever it
           runs. Anchored to a fixed instant it happens to keep passing — it
           only ever gets older — but it would be true by accident rather than
           by construction, and the pair of them should say the same thing. */
        lastModified: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      }),
      { status: { kind: "working" }, rawStatus: { kind: "working" } },
    );
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).toContain("may not be this session's conversation");
    expect(text).toContain("CLAUDE_SESSION_ID");
  });

  it("does not warn when the transcript is being written", async () => {
    openWith(messagesWire({ turns: [turnWire()] }), { status: { kind: "working" }, rawStatus: { kind: "working" } });
    await act(async () => {});
    expect(container.textContent ?? "").not.toContain("may not be this session's conversation");
  });

  /**
   * **THE SECOND ALARM A CLOCK CAN MANUFACTURE**, and the more expensive one:
   * it lands on EVERY working row at once, and a caveat drawn on 29 of 32 rows
   * is one nobody reads. v0.4j.
   *
   * `/api/messages` carries no clock of its own, so `lastModified` is corrected
   * with the skew `/api/state` measured — same process, same box
   * (messages-client.ts § `withClockSkew`). Both halves are asserted here,
   * because "no warning" is also what an empty detail pane says.
   */
  function openSkewed(servedAt: string | undefined): void {
    /* Thirty-five minutes, just past `STALE_TRANSCRIPT_MS`. The transcript is
       being written RIGHT NOW on the box's clock — `lastModified` is the
       server's own instant of answering — so the only thing that can make this
       row look silent is the device. */
    const at = new Date(Date.now() - 35 * 60 * 1000).toISOString();
    const feed = manualTransport();
    const messages = recordingMessages(() => messagesWire({ turns: [turnWire()], lastModified: at }));
    mountFull({ transport: feed.transport, messagesApi: messages.api });
    act(() =>
      feed.push(
        wire({
          servedAt,
          collectedAt: at,
          rows: [
            {
              id: "$a",
              name: "a",
              title: "a session",
              startedAt: at,
              status: { kind: "working" },
              paneId: "%2108",
              panePid: 4242,
              claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
              meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
            },
          ],
        }),
      ),
    );
    openSession("a session");
  }

  it("warns on a working row that is writing right now, when the server does not say what time it is", async () => {
    /* The positive control, and it is the bug: the same bytes minus `servedAt`,
       which is what a server built before v0.4j sends. */
    openSkewed(undefined);
    await act(async () => {});
    expect(container.textContent ?? "").toContain("may not be this session's conversation");
  });

  it("does not, once the transcript's clock has been put on the reader's", async () => {
    openSkewed(new Date(Date.now() - 35 * 60 * 1000).toISOString());
    await act(async () => {});
    expect(container.textContent ?? "").not.toContain("may not be this session's conversation");
    /* And the turns are on screen, so this is a rendered pane rather than an
       empty one agreeing with the assertion above. */
    expect(turns().length).toBeGreaterThan(0);
  });

  /**
   * **THE HALF OF v0.4j THAT WAS ITSELF THE BUG.** GPT Sol's K4, 2026-09-08.
   *
   * A turn's `at` goes to the screen as the ISO string it is (RecentMessages
   * § `Turn`), so shifting it did not say *the phone's wall clock* — it
   * asserted a different absolute UTC instant, one that nothing ever happened
   * at, beside prose describing what was happening at the real one. The rule is
   * in types.ts § `shiftToBrowserClock`, and this is the case that established
   * it.
   *
   * Five minutes is chosen so the wrong answer is a DIFFERENT STRING rather
   * than a rounding: 11:59:00Z shifted reads 12:04:00Z.
   */
  it("prints a turn's timestamp as the server wrote it, rather than moving it to an instant nothing happened at", async () => {
    const at = "2026-09-08T11:59:00.000Z";
    const feed = manualTransport();
    const messages = recordingMessages(() => messagesWire({ turns: [turnWire({ at })] }));
    mountFull({ transport: feed.transport, messagesApi: messages.api });
    /* A phone five minutes fast: the server's `servedAt` reads five minutes
       behind this browser's own clock. */
    const servedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    act(() =>
      feed.push(
        wire({
          servedAt,
          collectedAt: servedAt,
          rows: [
            {
              id: "$a",
              name: "a",
              title: "a session",
              startedAt: servedAt,
              status: { kind: "working" },
              paneId: "%2108",
              panePid: 4242,
              claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
              meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
            },
          ],
        }),
      ),
    );
    openSession("a session");
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).toContain(at);
    /* The minute rather than the whole instant: the fixture's `servedAt` and
       the parser's `Date.now()` are a millisecond or two apart, so the wrong
       answer was `12:04:00.001Z` — which an exact-string check would have let
       through. */
    expect(text).not.toContain("2026-09-08T12:04");
  });

  /**
   * **RAW FOR THE SCREEN, CORRECTED FOR THE ARITHMETIC** — and the pair is also
   * the answer to K5.
   *
   * A transcript is fetched once when the pane opens and never re-fetched, so a
   * SHIFTED STRING held in component state would keep whatever correction was
   * live at fetch time for as long as the pane is open, while the rows around it
   * are re-parsed with a newer one on every poll. Two clocks on one screen,
   * drifting apart, with nothing saying so. GPT Sol's K5.
   *
   * **The fix is that nothing moves it**, which is a stronger guarantee than
   * correcting it carefully: a value nothing shifts cannot hold a stale shift. A
   * pre-corrected `atMs` was carried beside it for one commit and then deleted —
   * nothing read it, and a field with a producer, a test and no consumer is
   * Class A out of 260908b, built that time while fixing an instance of Class A.
   * Its warning now lives on `at` itself, where anybody computing an age off a
   * turn will read it before they reach for it.
   */
  it("leaves the turn's own timestamp exactly as the server sent it", async () => {
    const at = "2026-09-08T11:59:00.000Z";
    const api: MessagesApi = {
      recent: async () => parseRecentMessages(messagesWire({ turns: [turnWire({ at })] })),
    };
    const view = await withClockSkew(api, () => ({ kind: "known", ms: -5 * 60_000 })).recent(
      steerable({ id: "$a" }),
    );
    if (view.kind !== "found") throw new Error("the fixture did not parse as found");
    /* A five-minute skew is live and the string is untouched — so what the screen
       prints is still an instant that happened, rather than one moved onto a
       clock it was never on. */
    expect(view.turns[0]?.at).toBe(at);
  });

  it("says how many tool results it skipped rather than implying silence", async () => {
    openWith(messagesWire({ turns: [turnWire()], toolResultsSkipped: 40 }));
    await act(async () => {});
    expect(container.textContent ?? "").toContain("40 tool results");
  });

  it("says nothing about one unparseable record, because one is normal", async () => {
    /* transcript.ts: "Expected to be 0 or 1, and 1 is normal" — a live file is
       being appended to while we read it, so the last line is often half
       written. A warning on the ordinary case is a warning nobody reads. */
    openWith(messagesWire({ turns: [turnWire()], recordsUnparseable: 1 }));
    await act(async () => {});
    expect(container.textContent ?? "").not.toContain("lines of the transcript could not be read");
  });

  it("says so when several records did not parse, because that is worth a look", async () => {
    openWith(messagesWire({ turns: [turnWire()], recordsUnparseable: 5 }));
    await act(async () => {});
    expect(container.textContent ?? "").toContain("lines of the transcript could not be read");
  });

  it("reads one session's transcript, not every row's", async () => {
    const feed = manualTransport();
    const messages = recordingMessages();
    mountFull({ transport: feed.transport, messagesApi: messages.api });
    act(() =>
      feed.push(
        state({
          rows: [steerable({ id: "$a", title: "one" }), steerable({ id: "$b", title: "two" }), steerable({ id: "$c", title: "three" })],
        }),
      ),
    );
    await act(async () => {});
    // Nothing open: nothing read. Reading a transcript costs disk.
    expect(messages.asked).toEqual([]);

    openSession("two");
    await act(async () => {});
    expect(messages.asked).toEqual(["$b"]);
  });

  it("reads again when asked, and only when asked", async () => {
    const messages = openWith(messagesWire({ turns: [turnWire()] }));
    await act(async () => {});
    expect(messages.asked).toEqual(["$a"]);

    const again = buttonSaying("Read again");
    if (!again) throw new Error("no re-read button on the page");
    await act(async () => {
      again.click();
    });
    expect(messages.asked).toEqual(["$a", "$a"]);
  });

  it("escapes a turn that is trying to be markup", async () => {
    /* Every string here is agent-authored text from a process that may have
       been handling hostile input. Same rule as the pane capture. */
    openWith(messagesWire({ turns: [turnWire({ text: "<img src=x onerror=alert(1)><script>alert(2)</script>" })] }));
    await act(async () => {});
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent ?? "").toContain("<img src=x onerror=alert(1)>");
  });
});

/**
 * **WHICH AGENT THIS TRANSCRIPT IS ABOUT, WHEN THE HANDLE DID NOT CHANGE.**
 *
 * `useRecentMessages` keyed its read on `row.id` alone — the tmux handle — and
 * the comment above it explained, correctly, why the row OBJECT must not be the
 * dependency: a snapshot arrives every sixty seconds and replaces every object,
 * and a multi-megabyte transcript read on the refresh loop is the one thing
 * this section must not do. What it got wrong is that `row.id` is not the same
 * thing as the row's identity. `types.ts` says it in as many words about
 * `claudeSessionId`: it is *"the only one of the three identifiers that
 * survives a `gjd-remote resume`, so it is what distinguishes this agent from
 * the one that replaced it in the same pane."*
 *
 * So a pane respawned under the same `$id` — a resume, a relaunch, a `-c` in
 * the same window — left the previous agent's turns on screen under the new
 * agent's name and status, indefinitely, with no way to notice from the page.
 * On a page whose entire job is telling you which session needs you, that is
 * the same failure `wantedFor` was added to prevent, arriving down the door
 * that was left open. Roadmap finding E-session; Baseline stage of
 * docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md.
 */
describe("recent messages, when the pane keeps its handle and changes its agent", () => {
  /** A messages api that records the FULL identity it was asked about. */
  function watching(): {
    api: MessagesApi;
    asked: { id: string; conversation: string | null }[];
  } {
    const asked: { id: string; conversation: string | null }[] = [];
    const api: MessagesApi = {
      recent: async (row) => {
        asked.push({ id: row.id, conversation: row.claudeSessionId });
        return parseRecentMessages(
          messagesWire({ turns: [turnWire({ text: `a turn from ${row.claudeSessionId}`, uuid: row.claudeSessionId ?? "u" })] }),
        );
      },
    };
    return { api, asked };
  }

  function rows(conversation: string): FleetState["rows"] {
    return [
      steerable({
        id: "$a",
        title: "a session",
        claudeSessionId: conversation,
        meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
      }),
    ];
  }

  it("re-reads when the conversation changes under the same handle, and not when nothing changed", async () => {
    const feed = manualTransport();
    const messages = watching();
    mountFull({ transport: feed.transport, messagesApi: messages.api });
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    await act(async () => {});

    expect(messages.asked).toEqual([{ id: "$a", conversation: "conv-A" }]);
    expect(container.textContent ?? "").toContain("a turn from conv-A");

    /* THE HALF THAT MUST NOT REGRESS. A new snapshot every sixty seconds
       replaces every row object on the page, and none of those is news. If this
       count moves, a transcript read has landed on the refresh loop. */
    act(() => feed.push(state({ rows: rows("conv-A") })));
    await act(async () => {});
    expect(messages.asked).toHaveLength(1);

    // And now the pane is holding a different agent.
    act(() => feed.push(state({ rows: rows("conv-B") })));
    await act(async () => {});

    expect(messages.asked).toEqual([
      { id: "$a", conversation: "conv-A" },
      { id: "$a", conversation: "conv-B" },
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("a turn from conv-B");
    expect(text).not.toContain("a turn from conv-A");
  });

  /**
   * **THE ONE THAT ACTUALLY LOOKS AT WHAT WAS COMMITTED.** GPT Sol's round 2,
   * 2026-09-08, and the finding is about the test rather than the code.
   *
   * The test below asserts on the DOM after `act`, which flushes passive
   * effects — so it is satisfied by an implementation that renders A's
   * transcript under B's name and then clears it in a `useEffect`. That is
   * exactly the implementation round 1 found the paint hazard in, and it passed
   * this assertion, which means the assertion was not evidence for the repair
   * it was cited for. React commits the DOM before passive effects run, and the
   * browser may paint that commit.
   *
   * `Profiler`'s `onRender` fires during the commit phase, after the DOM has
   * been mutated and before effects flush, so reading `container.textContent`
   * there is the closest a jsdom test gets to *what a person could have seen*.
   * **Every committed frame is checked, not the final one** — the whole failure
   * is a frame that exists briefly and is then corrected.
   */
  it("never commits a frame with the old agent's turns under the new agent's identity", async () => {
    const held: { label: string; resolve: () => void }[] = [];
    const api: MessagesApi = {
      recent: async (row) => {
        const label = `${row.claudeSessionId}`;
        const view = parseRecentMessages(
          messagesWire({ turns: [turnWire({ text: `a turn from ${label}` })] }),
        );
        return new Promise((resolve) => held.push({ label, resolve: () => resolve(view) }));
      },
    };

    /** Every frame React committed, in order, as it stood at commit time. */
    let frames: string[] = [];
    const feed = manualTransport();
    act(() =>
      root.render(
        <Profiler id="detail" onRender={() => frames.push(container.textContent ?? "")}>
          <App
            transport={feed.transport}
            steer={recordingSteer().api}
            newSession={fakeNewSession()}
            rename={fakeRename()}
            actionsApi={recordingActions().api}
            messagesApi={api}
            actionsPollMs={3_600_000}
          />
        </Profiler>,
      ),
    );
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    await act(async () => {
      held.shift()?.resolve();
    });
    // A is genuinely on screen, so what follows is a real transition.
    expect(container.textContent ?? "").toContain("a turn from conv-A");

    /* From here nothing may commit A's turns again. The identity strip in the
       detail pane prints the conversation id, so a frame carrying both is the
       failure in one string. */
    frames = [];
    act(() => feed.push(state({ rows: rows("conv-B") })));
    await act(async () => {});

    expect(frames.length).toBeGreaterThan(0);
    const bad = frames.filter((f) => f.includes("conv-B") && f.includes("a turn from conv-A"));
    expect(bad).toEqual([]);
  });

  it("clears the old agent's turns while the new read is in flight, rather than showing them under the new name", async () => {
    /* The gap between the identity changing and the answer arriving is the
       whole window in which the page is lying, and it is seconds long on a
       multi-megabyte transcript. "Not read yet" is honest; the previous agent's
       turns are not. */
    const held: (() => void)[] = [];
    const api: MessagesApi = {
      recent: async (row) => {
        const view = parseRecentMessages(
          messagesWire({ turns: [turnWire({ text: `a turn from ${row.claudeSessionId}` })] }),
        );
        return new Promise((resolve) => held.push(() => resolve(view)));
      },
    };

    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    await act(async () => {
      held.shift()?.();
    });
    expect(container.textContent ?? "").toContain("a turn from conv-A");

    act(() => feed.push(state({ rows: rows("conv-B") })));
    await act(async () => {});
    const midFlight = container.textContent ?? "";
    expect(midFlight).not.toContain("a turn from conv-A");
    expect(midFlight).toContain("Reading the tail of this session's transcript");
  });

  it("cannot have the old agent's answer land on the new agent's panel", async () => {
    /* The out-of-order case, which no amount of clearing fixes on its own: A's
       read is still in flight when B's starts, B answers first, and then A
       answers. `wantedFor` guarded exactly this for the manual `Read again`
       button and not for the effect, which had a per-run `alive` flag — and an
       `alive` flag is per RUN, so it says "this effect was cleaned up", which is
       the right question only when the cleanup happened. Here it is: the
       identity changed, so A's run was cleaned up, and this asserts the whole
       join rather than the flag. */
    const held: { conversation: string | null; resolve: () => void }[] = [];
    const api: MessagesApi = {
      recent: async (row) => {
        const view = parseRecentMessages(
          messagesWire({ turns: [turnWire({ text: `a turn from ${row.claudeSessionId}` })] }),
        );
        return new Promise((resolve) => held.push({ conversation: row.claudeSessionId, resolve: () => resolve(view) }));
      },
    };

    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    await act(async () => {});
    expect(held.map((h) => h.conversation)).toEqual(["conv-A"]);

    // B starts before A has answered.
    act(() => feed.push(state({ rows: rows("conv-B") })));
    await act(async () => {});
    expect(held.map((h) => h.conversation)).toEqual(["conv-A", "conv-B"]);

    // B answers, then A does — the order that costs something.
    await act(async () => {
      held[1]?.resolve();
    });
    await act(async () => {
      held[0]?.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("a turn from conv-B");
    expect(text).not.toContain("a turn from conv-A");
  });

  /**
   * **A→B→A, WHICH IDENTITY EQUALITY CANNOT SEE.** GPT Sol's fifth finding,
   * 2026-09-08.
   *
   * The guard widened from `row.id` to the full identity closes the case where
   * the two readings are about different agents. It does nothing about two
   * readings about the SAME agent, because the check it makes is an equality and
   * an equality has no order in it: hold a manual read of A, let the pane become
   * B and then A again, and the held answer's identity is once more the current
   * one — so a reading from before the round trip overwrites one taken after it.
   * On a page whose job is *is this row telling me the truth*, that is a
   * transcript from the wrong minute presented as the current one.
   *
   * A monotonically increasing token is the fix, and the lesson generalises: a
   * freshness check written as an equality cannot tell two of the same thing
   * apart.
   */
  it("does not let a held read of A, taken before a round trip through B, overwrite the one taken after", async () => {
    const held: { label: string; resolve: () => void }[] = [];
    let nth = 0;
    const api: MessagesApi = {
      recent: async (row) => {
        nth += 1;
        const label = `${row.claudeSessionId} read ${nth}`;
        const view = parseRecentMessages(messagesWire({ turns: [turnWire({ text: `a turn from ${label}` })] }));
        return new Promise((resolve) => held.push({ label, resolve: () => resolve(view) }));
      },
    };

    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    // 1: the opening read of A. Let it land so there is something to overwrite.
    await act(async () => {
      held.shift()?.resolve();
    });
    expect(container.textContent ?? "").toContain("conv-A read 1");

    // 2: a manual read of A, held.
    act(() => {
      buttonSaying("Read again")?.click();
    });
    // 3: the pane becomes B, and 4: comes back to A. Neither answers yet.
    act(() => feed.push(state({ rows: rows("conv-B") })));
    act(() => feed.push(state({ rows: rows("conv-A") })));
    expect(held.map((h) => h.label)).toEqual(["conv-A read 2", "conv-B read 3", "conv-A read 4"]);

    // The newest answers, and then the one from before the round trip.
    await act(async () => {
      held[2]?.resolve();
    });
    expect(container.textContent ?? "").toContain("conv-A read 4");
    await act(async () => {
      held[0]?.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("conv-A read 4");
    expect(text).not.toContain("conv-A read 2");
  });

  it("does not let a manual Read again for the old agent replace the new agent's turns", async () => {
    /* The same race down the button rather than the effect. `wantedFor` held
       `row.id`, and `row.id` is the same on both sides of this change — so the
       guard that exists for exactly this compared two equal strings and let the
       answer through. */
    const held: { conversation: string | null; resolve: () => void }[] = [];
    const api: MessagesApi = {
      recent: async (row) => {
        const view = parseRecentMessages(
          messagesWire({ turns: [turnWire({ text: `a turn from ${row.claudeSessionId}` })] }),
        );
        return new Promise((resolve) => held.push({ conversation: row.claudeSessionId, resolve: () => resolve(view) }));
      },
    };

    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: rows("conv-A") })));
    openSession("a session");
    await act(async () => {
      held.shift()?.resolve();
    });
    expect(container.textContent ?? "").toContain("a turn from conv-A");

    // Press Read again for A, and let the pane change agent before it answers.
    act(() => {
      buttonSaying("Read again")?.click();
    });
    expect(held.map((h) => h.conversation)).toEqual(["conv-A"]);
    act(() => feed.push(state({ rows: rows("conv-B") })));
    await act(async () => {});

    await act(async () => {
      for (const h of held) h.resolve();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("a turn from conv-B");
    expect(text).not.toContain("a turn from conv-A");
  });
});

describe("starting a session", () => {
  function openNewSession(): void {
    const button = buttonSaying("New session");
    if (!button) throw new Error("there is no New session button");
    act(() => button.click());
  }

  function type(id: string, value: string): void {
    const box = container.querySelector<HTMLTextAreaElement>(`#${id}`);
    if (!box) throw new Error(`no textarea #${id}`);
    typeInto(box, value);
  }

  it("sends the prompt and nothing else — in particular no name, so Claude titles it", async () => {
    const starting = {
      id: "L1",
      progress: { state: "starting", notification: { kind: "not-attempted" } },
      name: null,
      dir: "/home/greg/code/spideryarn2",
      promptBytes: 12,
      requestedAt: "",
      finishedAt: null,
      error: null,
      maybeStarted: false,
      note: null,
    };
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        /* The POST answers 202 with the record; the GET answers the register.
           They are different shapes and a stub that returned one for both would
           be testing something the server never does — the poll would read no
           `launches` at all and the panel would rightly forget the launch. */
        const body =
          init?.method === "POST"
            ? { ok: true, launch: starting, retryAfterMs: 0 }
            : { ok: true, busy: true, retryAfterMs: 0, launches: [starting] };
        return { ok: true, status: init?.method === "POST" ? 202 : 200, json: async () => body } as Response;
      }) as unknown as typeof fetch,
    );

    const feed = manualTransport();
    act(() => root.render(<App transport={feed.transport} steer={recordingSteer().api} />));
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "do the thing");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toBe("api/sessions/new");
    const body = JSON.parse(String(post?.init?.body)) as Record<string, unknown>;
    // The positive half: the prompt really is what was typed.
    expect(body["prompt"]).toBe("do the thing");
    /* And the negative half it is paired with: no `name` key at all, so
       gjd-remote starts Claude without `--name` and the list adopts the title
       Claude gives the conversation. A name chosen here would freeze a
       placeholder over the top of it forever. */
    expect(Object.keys(body)).toEqual(["prompt"]);
    expect(container.textContent).toContain("Starting…");
  });

  it("treats 200 as a failure, because a launch has three states and 200 claims one early", async () => {
    vi.stubGlobal(
      "fetch",
      (async () =>
        ({ ok: true, status: 200, json: async () => ({ ok: true, launch: null }) }) as Response) as unknown as typeof fetch,
    );
    const api = makeNewSessionApi(fetch);
    const result = await api.start("anything");
    expect(result.accepted).toBe(false);
    expect(result.accepted === false ? result.why : "").toContain("only accepts 202");
  });

  it("shows the server's refusal rather than a sentence of its own", async () => {
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      newSession: fakeNewSession({
        start: async () => ({
          accepted: false,
          why: "the box is critical (load, memory or swap) — starting another Claude now is how the OOM killer gets to choose which agent dies.",
          status: 503,
          from: "server",
        }),
      }),
    });
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "start something");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });
    expect(container.textContent).toContain("how the OOM killer gets to choose which agent dies");
  });

  it("says 'check the list and kill it' for a failure that may have started something", async () => {
    const record = parseLaunch({
      id: "L2",
      progress: { state: "failed", notification: { kind: "not-applicable" } },
      name: null,
      dir: "/home/greg/code/spideryarn2",
      promptBytes: 9,
      requestedAt: "",
      finishedAt: "",
      error: "the launcher timed out after 180s",
      maybeStarted: true,
      note: null,
    });
    if (record === null) throw new Error("the fixture did not parse");

    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      newSession: fakeNewSession({
        start: async () => ({ accepted: true, launch: record }),
        poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [record] } }),
      }),
    });
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "start me");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });

    const text = container.textContent ?? "";
    /* The state a two-state design would have to lie about. "Nothing happened"
       is wrong about exactly the case that costs something: an agent nobody
       knows they started, on a box that runs out of memory. */
    expect(text).toContain("it may have started anyway");
    expect(text).toContain("Check the list, and kill it if it is there");
    expect(text).toContain("the launcher timed out after 180s");
    expect(text).not.toContain("Nothing was started");
  });

  /**
   * **THE DEADLINE APPLIED TO THE POLLS THAT NEVER ANSWERED.**
   *
   * `POLL_GIVE_UP_MS` exists because "a spinner with no end is a lie about
   * there being progress" — and it was only ever reached down the branch where
   * the poll SUCCEEDED. `if (stopped || !result.ok) return;` left the interval
   * running, so the one case the deadline is really for — the server gone, the
   * tab left open — polled a dead endpoint every three seconds forever, and the
   * panel went on saying "Starting…" about a launch it had never heard another
   * word of. Found in the roadmap's own findings table as E-session and fixed
   * here (docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md,
   * Baseline).
   *
   * Three things this test pins besides the stopping, because each of them is a
   * way of "fixing" it that would be worse than the bug: the launch record must
   * still be on screen (it is the only id anybody has for the thing that may be
   * running), the panel must say it could not ASK rather than repeating the
   * four-minutes-starting sentence it has no evidence for, and `start` must
   * have been called exactly once — a page that relaunches because discovery
   * failed is how you get two agents from one press on a box that OOMs.
   */
  it("stops polling when the deadline passes even though every poll failed, and starts nothing a second time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L5",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      let polls = 0;
      let starts = 0;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => {
            starts += 1;
            return { accepted: true, launch: record };
          },
          poll: async () => {
            polls += 1;
            return { ok: false, why: "connect ECONNREFUSED 127.0.0.1:8787" };
          },
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });
      expect(starts).toBe(1);
      expect(polls).toBeGreaterThan(0);

      /* Well past the deadline, in the panel's own steps. */
      const steps = Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 3;
      for (let i = 0; i < steps; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      const settled = polls;

      /* And then a further minute in which NOTHING may be asked. This is the
         assertion the old code fails: the count goes on climbing. */
      for (let i = 0; i < 20; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      expect(polls).toBe(settled);

      const text = container.textContent ?? "";
      expect(text).toContain("stopped asking");
      // What actually happened, in the transport's own words.
      expect(text).toContain("connect ECONNREFUSED 127.0.0.1:8787");
      /* NOT the four-minutes-starting sentence: nothing observed it starting
         for four minutes, only that nobody could ask. */
      expect(text).not.toContain("longer than the server's own timeout");
      // The record is still there, because its id is the only handle anybody has.
      expect(text).toContain("Starting…");
      // And no second agent was started to make up for the silence.
      expect(starts).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The other ending, kept apart from the one above on purpose. Here the polls
   * ANSWERED for four minutes and the launch never settled — so the server's
   * own timeout is the thing to name, and the unreachable sentence would be
   * false. Splitting `gaveUp` into two arms is only worth anything if both are
   * exercised; a union with one tested arm is a boolean with extra steps.
   */
  it("gives up on a launch that answers for four minutes and never settles, in the server's terms", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L6",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      let polls = 0;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => ({ accepted: true, launch: record }),
          poll: async () => {
            polls += 1;
            return { ok: true, feed: { busy: true, retryAfterMs: 0, launches: [record] } };
          },
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });

      const steps = Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 3;
      for (let i = 0; i < steps; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      const settled = polls;
      for (let i = 0; i < 20; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      expect(polls).toBe(settled);

      const text = container.textContent ?? "";
      expect(text).toContain("longer than the server's own timeout");
      expect(text).not.toContain("never got a usable status answer");
      expect(text).toContain("Whether a session exists is a question for the list");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **THE DEADLINE MUST BE THE CLOCK'S, NOT A POLL'S.** GPT Sol's first finding,
   * 2026-09-08, against the first version of this repair — and it is the same
   * bug one level in.
   *
   * The first fix moved the give-up out of the success branch, which covers a
   * poll that FAILS. It does not cover a poll that never answers at all: a
   * connection accepted by a proxy that then goes quiet leaves a promise pending
   * forever, and a deadline evaluated after `await` is never evaluated. The
   * interval went on firing, so requests accumulated at one every three seconds
   * against a route that answers none of them, and the panel said "Starting…"
   * indefinitely — the original bug, reached by a different door.
   *
   * Two things are asserted, and the second is the one that would have been
   * easy to leave out: the page gives up, **and it only ever asked once**,
   * because single-flight is what stops a three-second interval over a
   * longer-than-three-second request from being a queue.
   */
  it("gives up on a poll that never answers at all, and does not stack up requests behind it", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L7",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      let polls = 0;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => ({ accepted: true, launch: record }),
          poll: () => {
            polls += 1;
            // Accepted, and never answered.
            return new Promise(() => {});
          },
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });

      const steps = Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 20;
      for (let i = 0; i < steps; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }

      const text = container.textContent ?? "";
      expect(text).toContain("stopped asking");
      /* Nothing ever answered, so this is the unreachable ending — and it says
         so in words nobody has to guess at, rather than an empty parenthesis
         where a server's sentence would be. */
      expect(text).toContain("never got a usable status answer");
      expect(text).toContain("no answer ever arrived");
      expect(text).not.toContain("longer than the server's own timeout");
      // ONE ask, not eighty. This is the half a give-up alone would not fix.
      expect(polls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **WHICH ARM, AND IT IS DECIDED BY "DID ANYTHING EVER ANSWER".** Sol's second
   * finding, 2026-09-08.
   *
   * Choosing from the final poll alone meant four minutes of healthy `busy:
   * true` followed by a single `ECONNRESET` printed *"for four minutes it could
   * not reach the server at all"* — false about all but the last three seconds
   * of it, and false in the direction that makes a reader distrust a server that
   * was fine. The last failure is still worth saying; it is a footnote.
   */
  it("does not call four good minutes unreachable because the last ask failed", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L8",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      let polls = 0;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => ({ accepted: true, launch: record }),
          poll: async () => {
            polls += 1;
            // Healthy all the way to the deadline, then the connection drops.
            if (polls <= Math.ceil(POLL_GIVE_UP_MS / POLL_MS)) {
              return { ok: true, feed: { busy: true, retryAfterMs: 0, launches: [record] } };
            }
            return { ok: false, why: "connect ECONNRESET 127.0.0.1:8787" };
          },
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });

      const steps = Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 5;
      for (let i = 0; i < steps; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }

      const text = container.textContent ?? "";
      expect(text).toContain("longer than the server's own timeout");
      expect(text).not.toContain("never got a usable status answer");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **AN HTTP 500 IS NOT AN UNREACHABLE SERVER**, and the copy used to say it
   * was. Sol's round 2, 2026-09-08.
   *
   * `PollOutcome.ok` is false for three different things — a dead socket, an
   * HTTP error, and a body that is not this API (`new-session-client.ts`) — so a
   * give-up arm keyed on it could not mean "could not reach the server", and the
   * sentence it printed contradicted itself inside its own parenthesis: *"could
   * not reach the server at all (the server answered 500)"*. The arm is now
   * about getting an answer this page can **use**, which is what it actually
   * knows. The earlier regression used `ECONNREFUSED` and would never have
   * caught this.
   */
  it("does not call a server that answered 500 for four minutes unreachable", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L10",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => ({ accepted: true, launch: record }),
          // What `makeNewSessionApi` produces for a 500: reached, and useless.
          poll: async () => ({ ok: false, why: "the server answered 500" }),
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });
      for (let i = 0; i < Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 3; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }

      const text = container.textContent ?? "";
      expect(text).toContain("never got a usable status answer");
      expect(text).toContain("the server answered 500");
      /* The sentence that would contradict its own parenthesis. Asserted as
         absent by its distinctive words rather than by the whole arm, so that
         rewording the arm cannot quietly retire this check. */
      expect(text).not.toContain("could not reach the server");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **A LATE ANSWER MUST NOT UPDATE A PAGE THAT HAS STOPPED ASKING.** Sol's
   * round 2 P2, and it pins a policy rather than fixing a bug.
   *
   * The deadline abandons a poll still in flight — deliberately: at four minutes
   * the honest statement is *this page has stopped asking*, and the banner says
   * the session list is the authority. But an abandoned request is not a
   * cancelled one, and if its answer were still allowed to land, the launch card
   * would quietly update underneath a banner saying nobody found out. The
   * never-settling test above cannot see this, because its promise never
   * settles at all.
   */
  it("ignores a poll that answers after the page has already given up", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const starting = parseLaunch({
        id: "L11",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      const finished = parseLaunch({
        id: "L11",
        progress: { state: "started", notification: { kind: "pending" } },
        name: "late-arrival",
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: "",
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (starting === null || finished === null) throw new Error("the fixture did not parse");

      let release: (() => void) | null = null;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => ({ accepted: true, launch: starting }),
          poll: () =>
            new Promise((resolve) => {
              release = () => resolve({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [finished] } });
            }),
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });
      for (let i = 0; i < Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 3; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      expect(container.textContent ?? "").toContain("stopped asking");

      // The abandoned request finally answers, with news.
      await act(async () => {
        (release as (() => void) | null)?.();
      });

      const text = container.textContent ?? "";
      // The banner stands, and the card was not quietly rewritten underneath it.
      expect(text).toContain("stopped asking");
      expect(text).toContain("Starting…");
      expect(text).not.toContain("late-arrival");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **THE WARNING BELONGS TO A LAUNCH, SO ONLY A LAUNCH MAY RETIRE IT.** Sol's
   * third finding, 2026-09-08.
   *
   * `setGaveUp(null)` sat at the top of `start`, beside the refusal reset — so
   * pressing Start again cleared the previous launch's warning before anybody
   * knew whether a new launch would replace it. The box refuses when it is
   * critical, which is exactly when somebody presses twice, and the result was a
   * card still saying "Starting…" with the sentence explaining why nobody knows
   * any more silently gone.
   */
  it("keeps the earlier launch's warning when the next Start is refused", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date());
      const record = parseLaunch({
        id: "L9",
        progress: { state: "starting", notification: { kind: "not-attempted" } },
        name: null,
        dir: "/home/greg/code/spideryarn2",
        promptBytes: 7,
        requestedAt: "",
        finishedAt: null,
        error: null,
        maybeStarted: false,
        note: null,
      });
      if (record === null) throw new Error("the fixture did not parse");

      let starts = 0;
      const feed = manualTransport();
      mountFull({
        transport: feed.transport,
        newSession: fakeNewSession({
          start: async () => {
            starts += 1;
            if (starts === 1) return { accepted: true, launch: record };
            return { accepted: false, why: "the box is critical (load, memory or swap)", status: 503, from: "server" };
          },
          poll: async () => ({ ok: false, why: "connect ECONNREFUSED 127.0.0.1:8787" }),
        }),
      });
      act(() => feed.push(state({ rows: [] })));
      openNewSession();
      type("new-session-prompt", "start me");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });
      for (let i = 0; i < Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 3; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(POLL_MS);
        });
      }
      expect(container.textContent ?? "").toContain("stopped asking");

      // Press again; the box refuses.
      type("new-session-prompt", "start another");
      await act(async () => {
        buttonSaying("Start it")?.click();
      });

      const text = container.textContent ?? "";
      expect(text).toContain("the box is critical");
      // The first launch is still on screen, and so is the reason nobody knows.
      expect(text).toContain("Starting…");
      expect(text).toContain("stopped asking");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a launch state it has never heard of rather than rounding it to started", () => {
    expect(parseLaunch({ id: "L3", progress: { state: "reticulating" } })).toBeNull();
    expect(
      parseLaunch({ id: "L3", progress: { state: "started", notification: { kind: "pending" } } })?.progress.state,
    ).toBe("started");
  });

  /**
   * The launch is the news; the notification is a footnote about a message we
   * sent. So an unreadable notification must not sink the record — losing the
   * fact that a session started because we could not parse what became of a
   * line about it would be the tail wagging. It becomes `cannot-tell`, which is
   * a true statement, and the launch still renders.
   */
  it("keeps the launch when it cannot read what became of the notification", () => {
    const rec = parseLaunch({ id: "L20", progress: { state: "started", notification: { kind: "reticulating" } } });
    expect(rec?.progress.state).toBe("started");
    expect(rec?.progress.notification.kind).toBe("cannot-tell");
  });

  /** The whole point of the union: a started launch always carries some state. */
  it("never leaves a started launch with no notification state at all", () => {
    const rec = parseLaunch({ id: "L21", progress: { state: "started" } });
    expect(rec?.progress.state).toBe("started");
    expect(rec?.progress.notification.kind).toBe("cannot-tell");
  });

  it("reads maybeStarted as false only when the server actually said so", () => {
    expect(parseLaunch({ id: "L4", progress: { state: "failed" } })?.maybeStarted).toBe(false);
    expect(parseLaunch({ id: "L4", progress: { state: "failed" }, maybeStarted: true })?.maybeStarted).toBe(true);
  });
});

describe("the identifiers a steer needs, off the wire", () => {
  it("carries the pane pid and the conversation id through the parser", () => {
    const one = wire({
      rows: [
        {
          id: "$1643",
          paneId: "%1646",
          panePid: 645023,
          claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
          status: { kind: "idle" },
        },
      ],
    }).rows[0];
    expect(one?.panePid).toBe(645023);
    expect(one?.claudeSessionId).toBe("117e181a-155b-435a-b95b-e74220678d1a");
  });

  it("refuses a pid that is not one, rather than sending a number the server would reject", () => {
    const parsed = wire({ rows: [{ id: "$1", panePid: -3, status: { kind: "idle" } }] });
    expect(parsed.rows[0]?.panePid).toBeNull();
    expect(parsed.rows[0]?.id).toBe("$1");
  });

  it("puts the panes crossover where the two minimum widths put it, and nowhere else", () => {
    expect(choosePanes(COLUMN_MIN_PX + DETAIL_MIN_PX + PANE_GAP_PX)).toBe(2);
    expect(choosePanes(COLUMN_MIN_PX + DETAIL_MIN_PX + PANE_GAP_PX - 1)).toBe(1);
    expect(choosePanes(390)).toBe(1);
    expect(choosePanes(1280)).toBe(2);
    // Not laid out at all: change nothing, the same answer `chooseColumns` gives.
    expect(choosePanes(0)).toBe(1);
    expect(choosePanes(Number.NaN)).toBe(1);
  });
});

describe("the list card, in the narrow column beside an open detail", () => {
  /** The text inside session cards only, so an assertion cannot read the detail. */
  function listText(): string {
    return [...container.querySelectorAll(".session-card")].map((c) => c.textContent ?? "").join(" ");
  }

  const blocked = steerable({
    id: "$a",
    title: "asking",
    status: { kind: "needs-you" },
    question: question(),
  });

  it("draws the whole dialog while it is the only column", () => {
    /* Seeing what a blocked session is asking WITHOUT tapping anything is why
       this page is opened on a phone, so the full-width list keeps it. */
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ rows: [blocked] })));
    const text = listText();
    expect(text).toContain("Yes, and don't ask again");
    expect(text).toContain("press 1");
  });

  it("drops to the prompt once the same dialog is open beside it", () => {
    const undo = pinWidth(1280);
    try {
      const feed = manualTransport();
      mountFull({ transport: feed.transport });
      act(() => feed.push(state({ rows: [blocked] })));
      openSession("asking");

      const text = listText();
      /* The positive half: the card still says what is being asked and how many
         ways there are to answer, so the list is still scannable. */
      expect(text).toContain("Do you want to make this edit to server.ts?");
      expect(text).toContain("3 options — open it to read them.");
      /* And the negative half: the options themselves are not repeated in a
         340px column two inches from the copy that has buttons on it. */
      expect(text).not.toContain("press 1");
      // Which is not "the page lost them" — the detail has them.
      expect(container.textContent).toContain("Yes, and don't ask again");
    } finally {
      undo();
    }
  });
});

/* ===================================================================== *
 * v0.5 — the action buttons, the queue, and the box.
 * ===================================================================== */

/**
 * The catalogue as `tools/fleet/actions.ts` serialises it.
 *
 * Written out as wire objects rather than built from the client's own types,
 * because the thing under test is the parse — a fixture typed as `ClientAction`
 * would agree with the parser by construction, which is the shape of check
 * docs/reusable/silent-success.md is about.
 */
const CONTINUE_WIRE = {
  effect: "spoken",
  id: "continue",
  scope: "session",
  label: "Continue",
  summary: "Resume, after saying in one sentence what is being resumed.",
  text: "Carry on with the task you were given. Before you do, say in one sentence what you are resuming.",
  form: "prose",
  needsConfirm: false,
};

const COMPACT_WIRE = {
  effect: "spoken",
  id: "compact",
  scope: "session",
  label: "Compact",
  summary: "/compact, told what to keep and what to drop.",
  text: "/compact Keep the original brief, the plan doc and where you are in it.",
  form: "slash-command",
  needsConfirm: true,
};

const REMOVE_WORKTREE_WIRE = {
  effect: "enacted",
  id: "remove-worktree",
  scope: "session",
  label: "Remove worktree",
  summary: "Delete this agent's working tree, after the check that git cannot do.",
  needsConfirm: true,
  gate: "npm run worktree:check must exit 0 inside the tree first. git status is not that check.",
};

const KILL_SUITES_WIRE = {
  effect: "enacted",
  id: "kill-test-suites",
  scope: "box",
  label: "Kill test suites",
  summary: "SIGTERM every vitest runner on the box.",
  needsConfirm: true,
  gate: "Each pid must satisfy the vitest-runner rule and none of the standing refusals.",
};

const BROADCAST_WIRE = {
  effect: "broadcast",
  id: "resource-broadcast",
  scope: "box",
  label: "Broadcast: ease off, staggered",
  summary: "Tell every steerable session the box is loaded, each with its own resume time.",
  needsConfirm: true,
  stagger: { minMinutes: 5, windowMinutes: 60 },
};

/**
 * One queue, as the catalogue route serialises it.
 *
 * `deliverable` is computed from the items by default rather than defaulted to
 * a number, so a fixture cannot quietly disagree with the server about what the
 * count means. Pass `null` for the old-server case, where the field is absent.
 */
function queueWire(
  over: {
    sessionId?: string;
    items?: unknown[];
    warning?: string | null;
    deliverable?: number | null;
    /** A hold, as `holdWire` builds one. Absent by default: most queues have none. */
    quarantine?: unknown;
  } = {},
): Record<string, unknown> {
  const items = over.items ?? [];
  const wire: Record<string, unknown> = {
    sessionId: over.sessionId ?? "$1643",
    items,
    volatile: true,
    since: 1_757_000_000_000,
    /* `null` RATHER THAN ABSENT by default, because that is what the route
       actually sends when nothing is held — `snapshot.quarantine` is
       `holding()`, which is null far more often than not. A fixture that
       omitted the field would be exercising the old-server path in every test. */
    quarantine: over.quarantine ?? null,
  };
  if (over.deliverable !== null) {
    wire["deliverable"] =
      over.deliverable ??
      items.filter((i) => {
        const item = i as { invalidated?: unknown; stale?: unknown };
        return item.invalidated == null && item.stale !== true;
      }).length;
  }
  if (over.warning !== null) {
    wire["warning"] =
      over.warning ?? "Queued items live in the fleet server's memory. Restarting it discards every one of them.";
  }
  return wire;
}

function itemWire(over: {
  id: string;
  payload: unknown;
  leasedAt?: number;
  invalidated?: string;
  /** The QUEUE's two judgments. `null` omits the field, which is a server too old to make one. */
  stale?: boolean | null;
  stuck?: boolean | null;
}): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    id: over.id,
    sessionId: "$1643",
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    payload: over.payload,
    enqueuedAt: 1_757_000_000_500,
    leasedAt: over.leasedAt ?? null,
    invalidated: over.invalidated ?? null,
  };
  if (over.stale !== null) wire["stale"] = over.stale ?? false;
  if (over.stuck !== null) wire["stuck"] = over.stuck ?? false;
  return wire;
}

/**
 * A hold, as `GET /api/actions` sends one — the WIRE shape, so every test goes
 * through `parseHold` rather than past it.
 *
 * The `why` is a real server sentence rather than a placeholder, because two of
 * the assertions below are about what a person actually reads.
 */
function holdWire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "1a2b3c4d-h1",
    version: 1,
    sessionId: "$1643",
    paneId: "%2108",
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    serverInstanceId: "1a2b3c4d",
    tmuxGeneration: 990_001,
    openedAt: 1_757_000_000_900,
    lastSendAt: 1_757_000_000_900,
    incidents: 1,
    reading: "partial",
    origin: "queued-delivery",
    why:
      "Part of a send to this session arrived and the sequence did not finish (message (42 characters)), " +
      "so the text may be sitting in its input box with no Enter behind it.",
    outcome: { kind: "holding" },
    ...over,
  };
}

/** Every button on the page, by its words. */
function buttonLabels(): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].map((b) => b.textContent ?? "");
}

async function clickSaying(text: string): Promise<void> {
  const button = buttonSaying(text);
  if (!button) {
    throw new Error(`no button saying ${JSON.stringify(text)}; the page has ${JSON.stringify(buttonLabels())}`);
  }
  await act(async () => {
    button.click();
  });
}

describe("the action buttons, which are the server's vocabulary", () => {
  const ROW = steerable({ id: "$1643", title: "the one with buttons" });

  function openWith(
    actions: unknown[],
    over: { queues?: unknown[]; api?: ReturnType<typeof recordingActions> } = {},
  ): ReturnType<typeof recordingActions> {
    const rec = over.api ?? recordingActions(() => actionsWire({ actions, queues: over.queues ?? [] }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one with buttons");
    return rec;
  }

  it("draws exactly the actions the server sent, and nothing it invented", async () => {
    openWith([CONTINUE_WIRE, COMPACT_WIRE, REMOVE_WORKTREE_WIRE, KILL_SUITES_WIRE]);
    await act(async () => {});

    // The session-scope ones are here…
    expect(buttonLabels()).toContain("Continue");
    expect(buttonLabels()).toContain("Compact");
    expect(buttonLabels()).toContain("Remove worktree");
    /* …and the BOX one is not, because it is not addressed to a session. The
       negative is paired with the positives above: the list is not empty, it is
       filtered. */
    expect(buttonLabels()).not.toContain("Kill test suites");
  });

  it("still draws an action this build has never heard of, rather than grouping it away", async () => {
    /* THE ESCAPE HATCH ON THE DECLUTTER, AND THE ONLY PART OF IT THAT COULD
       LOSE A FEATURE. `groupSpoken` puts four known ids in the visible row and
       sorts the rest into Work / Pause / Hand off — by id, from a list written
       here rather than sent by the server. The server owns this catalogue and
       can add to it, so a grouping that silently dropped what it did not
       recognise would be a new instance of the exact class the postmortem of
       2026-09-08 is about: a consumer quietly not rendering what a producer
       sent. Anything unrecognised lands in "Other" and is still pressable. */
    const invented = {
      ...CONTINUE_WIRE,
      id: "take-a-photo-of-the-moon",
      label: "Take a photo of the moon",
      text: "Please take a photo of the moon.",
    };
    openWith([CONTINUE_WIRE, invented]);
    await act(async () => {});
    expect(buttonLabels()).toContain("Take a photo of the moon");
    expect(container.textContent).toContain("Other");
  });

  it("has no hand-written list: a server offering nothing offers no buttons", async () => {
    openWith([]);
    await act(async () => {});
    expect(container.textContent).toContain("This server offers no actions for a session.");
    // The words that would have come from a local copy of the catalogue.
    expect(buttonLabels()).not.toContain("Continue");
  });

  it("tells a server that sent no catalogue from one that sent an empty one", async () => {
    const rec = recordingActions(() => ({ queues: [] }));
    openWith([], { api: rec });
    await act(async () => {});
    expect(container.textContent).toContain("This server sent no list of actions at all");
  });

  it("sends a one-tap action straight through, with the row's own identifiers", async () => {
    const rec = openWith([CONTINUE_WIRE]);
    await act(async () => {});
    await clickSaying("Continue");
    expect(rec.calls.filter((c) => c.op === "run")).toEqual([{ op: "run", arg: "continue", second: "$1643" }]);
    expect(container.textContent).toContain("Queued — number 1 in the line.");
  });

  it("shows the exact words before sending anything that asks twice", async () => {
    const rec = openWith([COMPACT_WIRE]);
    await act(async () => {});
    await clickSaying("Compact");

    // Nothing has been sent…
    expect(rec.calls.filter((c) => c.op === "run")).toHaveLength(0);
    // …and the words that WOULD be sent are on the page, verbatim.
    expect(container.textContent).toContain(COMPACT_WIRE.text);
    expect(container.textContent).toContain("Claude Code runs it — the agent cannot decline it.");

    await clickSaying("Yes — compact");
    expect(rec.calls.filter((c) => c.op === "run")).toEqual([{ op: "run", arg: "compact", second: "$1643" }]);
  });

  it("keeps an enacted action apart from a spoken one, in words and not only in colour", async () => {
    openWith([CONTINUE_WIRE, REMOVE_WORKTREE_WIRE]);
    await act(async () => {});
    const text = container.textContent ?? "";
    /* THE WORDS MOVED IN THE DECLUTTER PASS AND THE PROPERTY DID NOT. The two
       groups used to be told apart by two permanent paragraphs above the
       buttons; they are now told apart by their headings and by the buttons'
       own labels, which is the same distinction carried in fewer words. What
       must not happen is the distinction surviving only as a colour. */
    expect(text).toContain("Ask it to…");
    expect(text).toContain("Force");
    expect(text).toContain("Each of these types a sentence into its input box.");
    // The colour is carried too, but it is never the only carrier.
    expect(buttonSaying("Remove worktree")?.className).toContain("alarm");

    /* And the sentence that moved has to be somewhere. It is on the confirm
       step now — the moment it changes what somebody is about to do, rather
       than a standing warning about a button nobody has pressed. A test that
       only checked it had left the strip would pass over its deletion. */
    expect(text).not.toContain("This tool runs a command — a directory deleted, a process signalled");
    await clickSaying("Remove worktree");
    expect(container.textContent).toContain("This tool runs a command — a directory deleted, a process signalled");
  });

  // THIS TEST WENT RED ON PURPOSE ON 2026-09-08 AND THAT IS THE POINT OF IT.
  // It used to pin the sentence "waits its turn in the queue rather than
  // happening now". `queue.ts` then started refusing enacted actions outright
  // (`enacted-not-deliverable`), and the page went on saying the old thing —
  // prose is a second copy of a rule and the compiler does not check it. This
  // assertion is what noticed, so it is kept pointed at whatever the rule
  // currently is rather than softened into a substring that survives both.
  it("says, before you confirm an enacted action, that a working session refuses it rather than queueing it", async () => {
    openWith([REMOVE_WORKTREE_WIRE]);
    await act(async () => {});
    await clickSaying("Remove worktree");
    expect(container.textContent).toContain(REMOVE_WORKTREE_WIRE.gate);
    expect(container.textContent).toContain(
      "this will be refused rather than queued — nothing delivers a queued command",
    );
    // AND NOT THE OLD PROMISE, in any form. The failure this guards against is
    // an edit that adds the new sentence and leaves the old one below it.
    expect(container.textContent).not.toContain("waits its turn in the queue");
  });

  it("lets a confirm be backed out of, without sending anything", async () => {
    const rec = openWith([REMOVE_WORKTREE_WIRE]);
    await act(async () => {});
    await clickSaying("Remove worktree");
    expect(container.textContent).toContain("Confirm: Remove worktree");
    await clickSaying("Cancel");
    expect(container.textContent).not.toContain("Confirm: Remove worktree");
    // The button is still there to press — backing out is not giving up.
    expect(buttonLabels()).toContain("Remove worktree");
    expect(rec.calls.filter((c) => c.op === "run")).toHaveLength(0);
  });

  it("asks twice for an action whose gravity the server did not state", async () => {
    /* `needsConfirm` absent. The mild default would be the wrong one: an
       action nobody described must not be one tap. */
    const undescribed = { ...CONTINUE_WIRE, id: "mystery", label: "Mystery", needsConfirm: undefined };
    const rec = openWith([undescribed]);
    await act(async () => {});
    await clickSaying("Mystery");
    expect(rec.calls.filter((c) => c.op === "run")).toHaveLength(0);
    expect(container.textContent).toContain("Confirm: Mystery");
  });

  it("names an action it cannot classify, and refuses to offer it as a button", async () => {
    const strange = { id: "reboot-the-box", scope: "session", label: "Reboot", effect: "detonate" };
    openWith([CONTINUE_WIRE, strange]);
    await act(async () => {});
    expect(container.textContent).toContain("reboot-the-box");
    expect(container.textContent).toContain('this page does not know the action kind "detonate"');
    // Named, but not pressable — while the one it does understand still is.
    expect(buttonLabels()).not.toContain("Reboot");
    expect(buttonLabels()).toContain("Continue");
  });

  it("shows the server's refusal in the server's own words", async () => {
    const rec = recordingActions(() => actionsWire({ actions: [CONTINUE_WIRE] }), {
      run: async () => ({
        ok: false,
        code: "pane-moved",
        why: "pane %1646 is in session $1643 now, not $1",
        status: 409,
        from: "server",
        /* `none` is the server saying no KEYSTROKES left this box. It is NOT
           a claim about the action as a whole, and since the fix round of
           260908j the card no longer reads it as one. The other three arms are
           next door, in "what became of an ACTION". */
        delivery: { kind: "none" },
        // No plan ran, so there is no run to describe. See `parsePlanRun`.
        run: null,
      }),
    });
    openWith([CONTINUE_WIRE], { api: rec });
    await act(async () => {});
    await clickSaying("Continue");
    expect(container.textContent).toContain("No keystrokes went out.");
    // The whole-action claim is not available to this arm and never was.
    expect(container.textContent).not.toContain("Nothing happened.");
    expect(container.textContent).toContain("pane %1646 is in session $1643 now, not $1");
    expect(container.textContent).toContain("said by the dashboard server");
  });
});

describe("the queue, which is the feature and so is on screen", () => {
  const ROW = steerable({ id: "$1643", title: "the one with a queue" });

  function openQueue(items: unknown[], over: { warning?: string | null } = {}): ReturnType<typeof recordingActions> {
    const rec = recordingActions(() =>
      actionsWire({
        actions: [CONTINUE_WIRE],
        queues: [queueWire({ items, ...(over.warning === undefined ? {} : { warning: over.warning }) })],
      }),
    );
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one with a queue");
    return rec;
  }

  it("shows what is waiting, in order, with what each one would say", async () => {
    openQueue([
      itemWire({ id: "q1", payload: { kind: "action", action: { ...CONTINUE_WIRE } } }),
      itemWire({ id: "q2", payload: { kind: "message", text: "and then look at the eval corpus" } }),
    ]);
    await act(async () => {});
    const text = container.textContent ?? "";
    expect(text).toContain(CONTINUE_WIRE.text);
    expect(text).toContain("and then look at the eval corpus");
    // In order: the action was queued first and is drawn first.
    expect(text.indexOf(CONTINUE_WIRE.text)).toBeLessThan(text.indexOf("and then look at the eval corpus"));
  });

  it("cancels one item, naming the session and the item off the snapshot", async () => {
    const rec = openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })]);
    await act(async () => {});
    await clickSaying("Cancel");
    expect(rec.calls.filter((c) => c.op === "cancel")).toEqual([{ op: "cancel", arg: "$1643", second: "q1" }]);
  });

  it("re-reads the queue after a press, rather than assuming what it did", async () => {
    let items: unknown[] = [];
    const rec = recordingActions(() => actionsWire({ actions: [CONTINUE_WIRE], queues: [queueWire({ items })] }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one with a queue");
    await act(async () => {});

    expect(container.textContent).toContain("Nothing is waiting.");
    const before = rec.feeds();

    /* The server accepts the press AND the queue it hands back afterwards has
       the item in it — which is the only way the page can be right about this.
       If the client did not re-read, the item would never appear. */
    items = [itemWire({ id: "q9", payload: { kind: "message", text: "the newly queued thing" } })];
    await clickSaying("Continue");
    await act(async () => {});

    /* The VISIBLE claim first, deliberately. A mutation that dropped the
       re-read reddens the counter below too, and a test that fails on the
       counter tells you a call was not made; this one tells you the person did
       not see the thing they just queued, which is the claim in the name. */
    expect(container.textContent).toContain("the newly queued thing");
    expect(container.textContent).not.toContain("Nothing is waiting.");
    expect(rec.feeds()).toBeGreaterThan(before);
  });

  it("carries the server's own warning that a restart discards the lot", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })]);
    await act(async () => {});
    expect(container.textContent).toContain(
      "Queued items live in the fleet server's memory. Restarting it discards every one of them.",
    );
  });

  it("says it anyway when the server did not, rather than showing a queue with no note on it", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })], { warning: null });
    await act(async () => {});
    expect(container.textContent).toContain("assume they do not");
  });

  it("says an item on its way out may not be recallable", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, leasedAt: 1_757_000_001_000 })]);
    await act(async () => {});
    expect(container.textContent).toContain("Being delivered now.");
    expect(container.textContent).toContain("there is no receipt for a keystroke");
    /* And Cancel is still offered: whether a lease can be cancelled is the
       server's rule, not this page's. */
    expect(buttonLabels()).toContain("Cancel");
  });

  /* The tmux server restarting under the queue. `queue.ts`'s `noteGeneration`
     writes a sentence onto every waiting item rather than deleting them, so
     these three tests are about the page being the other half of that: an item
     nobody will ever deliver has to look different from one waiting its turn,
     or the sentence was written for nothing. The field shipped on the wire
     before the page read it, which is why the last of the three exists. */
  it("says an item is undeliverable, in the server's own words, when the tmux server has been replaced", async () => {
    openQueue([
      itemWire({
        id: "q1",
        payload: { kind: "message", text: "hello" },
        invalidated: "this was queued against tmux server 1234, and the box is running 5678 now",
      }),
    ]);
    await act(async () => {});
    expect(container.textContent).toContain("This will not be delivered.");
    expect(container.textContent).toContain("the box is running 5678 now");
  });

  it("does not also claim an invalidated item is on its way out", async () => {
    // Both flags at once — leased when the server went, which `noteGeneration`
    // deliberately leaves alone. The page must pick the stronger claim; saying
    // "being delivered now" about something that can never be delivered is the
    // reassuring half of a contradiction, and it is the half a person believes.
    openQueue([
      itemWire({
        id: "q1",
        payload: { kind: "message", text: "hello" },
        leasedAt: 1_757_000_001_000,
        invalidated: "this was queued against tmux server 1234, and the box is running 5678 now",
      }),
    ]);
    await act(async () => {});
    expect(container.textContent).toContain("This will not be delivered.");
    expect(container.textContent).not.toContain("Being delivered now.");
  });

  it("invents no reason when the server is too old to send one", async () => {
    // An absent field is not a claim. A default sentence here would put words
    // in an old server's mouth, and the words would say a person's instruction
    // was lost when it is very likely fine.
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })]);
    await act(async () => {});
    expect(container.textContent).not.toContain("This will not be delivered.");
  });

  /* GPT Sol's D2, 2026-09-08. The server has sent `stale` on every item since
     the catalogue route was written and the page did not read it, so an item
     `next()` will never deliver again was drawn as an ordinary waiting one,
     under copy promising it goes out shortly after the session finishes. It is
     the same defect as `invalidated` above, sitting beside it. */
  it("says an item has waited too long, rather than drawing it as one waiting its turn", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, stale: true })]);
    await act(async () => {});
    expect(container.textContent).toContain("This has waited too long to be sent unasked");
    expect(buttonLabels()).toContain("Send it anyway");
  });

  it("re-arms a stale item, naming the session and the item off the snapshot", async () => {
    const rec = openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, stale: true })]);
    await act(async () => {});
    await clickSaying("Send it anyway");
    expect(rec.calls.filter((c) => c.op === "revive")).toEqual([{ op: "revive", arg: "$1643", second: "q1" }]);
  });

  it("offers no re-arm on an item that is merely waiting", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })]);
    await act(async () => {});
    expect(container.textContent).not.toContain("This has waited too long");
    expect(buttonLabels()).not.toContain("Send it anyway");
  });

  it("makes no staleness claim when the server is too old to send one", async () => {
    // An absent field is not a claim, the same as `invalidated` above.
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, stale: null })]);
    await act(async () => {});
    expect(container.textContent).not.toContain("This has waited too long");
  });

  it("prefers the permanent sentence when an item is both dead and stale", async () => {
    // Ranking, and it matters: `invalidated` can never be undone, and offering
    // "send it anyway" over the top of it would be a button that cannot work.
    openQueue([
      itemWire({
        id: "q1",
        payload: { kind: "message", text: "hello" },
        stale: true,
        invalidated: "this was queued against tmux server 1234, and the box is running 5678 now",
      }),
    ]);
    await act(async () => {});
    expect(container.textContent).toContain("This will not be delivered.");
    expect(container.textContent).not.toContain("This has waited too long");
    expect(buttonLabels()).not.toContain("Send it anyway");
  });

  /* GPT Sol's D4. `drain.ts` leaves the lease open when the delivery module
     throws, on purpose — nothing can tell "died before the keystrokes" from
     "died after", so a person decides. There was no way for a person to
     decide, and the page called it "Being delivered now" for ever. */
  it("tells a lease nobody settled apart from one that is going out now", async () => {
    openQueue([
      itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, leasedAt: 1_757_000_001_000, stuck: true }),
    ]);
    await act(async () => {});
    expect(container.textContent).not.toContain("Being delivered now.");
    expect(container.textContent).toContain("never confirmed");
    expect(buttonLabels()).toContain("Abandon it");
  });

  it("warns that abandoning recalls nothing, and only then abandons", async () => {
    const rec = openQueue([
      itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, leasedAt: 1_757_000_001_000, stuck: true }),
    ]);
    await act(async () => {});
    await clickSaying("Abandon it");

    // The honest warning is the whole of the confirmation: abandoning clears
    // the dashboard's lease and does nothing at all to the pane.
    expect(container.textContent).toContain("does not recall a keystroke");
    expect(container.textContent).toContain("may already be in that agent's input box");
    expect(rec.calls.filter((c) => c.op === "abandon")).toHaveLength(0);

    await clickSaying("Yes, abandon it");
    expect(rec.calls.filter((c) => c.op === "abandon")).toEqual([{ op: "abandon", arg: "$1643", second: "q1" }]);
  });

  it("offers no abandon on a lease that is still going out", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" }, leasedAt: 1_757_000_001_000 })]);
    await act(async () => {});
    expect(container.textContent).toContain("Being delivered now.");
    expect(buttonLabels()).not.toContain("Abandon it");
  });

  it("counts the items it could not read rather than quietly shortening the queue", async () => {
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } }), { id: "q2" }]);
    await act(async () => {});
    expect(container.textContent).toContain("1 more item is in this queue and could not be read");
    // And the one it could read is still there — it is short, not empty.
    expect(container.textContent).toContain("hello");
  });

  /* ---------------------------------------------------------------- *
   * Clearing the whole queue. `SteeringQueue.clear()` had two callers and
   * both were tests — instance 9 of docs/postmortems/260908b — so these are
   * the assertions about the half that was missing: the button, what it says
   * before it acts, and what it says afterwards.
   * ---------------------------------------------------------------- */

  const GOING_OUT = itemWire({
    id: "q3",
    payload: { kind: "message", text: "already on its way out" },
    leasedAt: 1_757_000_001_000,
  });

  it("offers no clear when everything in the queue is already going out", async () => {
    // There would be nothing for it to remove: `clear()` keeps a leased item,
    // so the button's only possible outcome would be a refusal.
    openQueue([GOING_OUT]);
    await act(async () => {});
    expect(buttonLabels()).not.toContain("Clear the queue");
  });

  it("names what would go AND what would stay, before anything is cleared", async () => {
    const rec = openQueue([
      itemWire({ id: "q1", payload: { kind: "message", text: "look at the eval corpus" } }),
      itemWire({ id: "q2", payload: { kind: "action", action: { ...CONTINUE_WIRE } } }),
      GOING_OUT,
    ]);
    await act(async () => {});
    await clickSaying("Clear the queue");

    const text = container.textContent ?? "";
    expect(text).toContain("Take these 2 things out of the queue?");
    expect(text).toContain("look at the eval corpus");
    expect(text).toContain(CONTINUE_WIRE.label);
    /* THE HALF THAT IS EASY TO LEAVE OUT, and the reason this gesture needed a
       design at all: a confirmation listing only the casualties reads as "the
       queue will be empty afterwards", which is false in exactly the case that
       matters. It names the survivor by its words, because every queued message
       draws as "Your message" and three of them would be indistinguishable. */
    expect(text).toContain("This one stays, because it has already been handed over for delivery");
    expect(text).toContain("already on its way out");
    // And nothing has happened yet. A preview that acted would not be one.
    expect(rec.calls.filter((c) => c.op === "clear")).toHaveLength(0);
  });

  it("clears exactly the ids it drew, and never the one in flight", async () => {
    const rec = openQueue([
      itemWire({ id: "q1", payload: { kind: "message", text: "hello" } }),
      itemWire({ id: "q2", payload: { kind: "message", text: "and then this" } }),
      GOING_OUT,
    ]);
    await act(async () => {});
    await clickSaying("Clear the queue");
    await clickSaying("Yes, clear them");

    /* The ids are the request's whole safety argument — the server refuses a
       list that is not what its queue holds — so what is asserted is the list,
       not the fact of a call. `q3` is absent because it is leased. */
    expect(rec.calls.filter((c) => c.op === "clear")).toEqual([{ op: "clear", arg: "$1643", second: "q1,q2" }]);
  });

  it("offers no Confirm when it cannot say what would go", async () => {
    /* The empty-preview rule, which this page already applies in front of a
       kill: a queue holding items this build cannot parse cannot be previewed,
       and a Confirm over a partial list would destroy things that were never on
       screen. The alarm sentence names the gap instead. */
    openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } }), { id: "q2" }]);
    await act(async () => {});
    await clickSaying("Clear the queue");

    expect(container.textContent).toContain("there is no Confirm below");
    expect(buttonLabels()).not.toContain("Yes, clear them");
    // The way out is still offered.
    expect(buttonLabels()).toContain("Keep them");
  });

  it("says afterwards which item stayed behind, in a reply read off the wire", async () => {
    /*
     * **THE `keptInFlight` CASE, AND THE OUTCOME IS PARSED RATHER THAN BUILT.**
     * A hand-made `ActionOutcome` here would be a claim about the route that
     * nothing checks against the route — the fixture mistake this whole
     * postmortem turns on — so the fake `fetch` answers with the wire shape and
     * the page reads it through `makeActionsApi`, exactly as the browser does.
     */
    const wire = {
      ok: true,
      op: "cleared",
      removed: [itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })],
      keptInFlight: GOING_OUT,
    };
    const impl = (async () => ({ ok: true, status: 200, statusText: "", json: async () => wire }) as Response) as unknown as typeof fetch;
    const rec = recordingActions(
      () =>
        actionsWire({
          actions: [CONTINUE_WIRE],
          queues: [queueWire({ items: [itemWire({ id: "q1", payload: { kind: "message", text: "hello" } }), GOING_OUT] })],
        }),
      { clear: makeActionsApi(impl).clear },
    );
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one with a queue");
    await act(async () => {});

    await clickSaying("Clear the queue");
    await clickSaying("Yes, clear them");

    const text = container.textContent ?? "";
    expect(text).toContain("One item taken out of the queue.");
    // The whole point: "cleared" on its own would be an ambiguous negative.
    expect(text).toContain("One was NOT taken out, because it had already been handed over for delivery");
    expect(text).toContain("already on its way out");
    expect(text).toContain("treat it as sent");
  });

  it("says the queue is empty afterwards only when nothing was going out", async () => {
    // The other reading of the same card, and it has to be a different
    // sentence: this one really is a promise that nothing more is coming.
    const rec = openQueue([itemWire({ id: "q1", payload: { kind: "message", text: "hello" } })]);
    await act(async () => {});
    await clickSaying("Clear the queue");
    await clickSaying("Yes, clear them");

    expect(container.textContent).toContain("Nothing was on its way out, so this session's queue is now empty.");
    expect(rec.calls.filter((c) => c.op === "clear")).toHaveLength(1);
  });
});

describe("queueing a message, in one line with the buttons", () => {
  /* WORKING, not idle, and that is now load-bearing: v0.5g stops offering
     Queue on an idle session, so a fixture left at the default status would
     make every test below about a button that is deliberately not there. */
  const ROW = steerable({ id: "$1643", title: "the one being told things", status: { kind: "working" } });

  it("sends the typed text to the same queue the buttons feed", async () => {
    const rec = recordingActions(() => actionsWire({ actions: [CONTINUE_WIRE] }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one being told things");
    await act(async () => {});

    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "actually do the other thing");
    await clickSaying("Queue (~73s)");

    expect(rec.calls.filter((c) => c.op === "queueMessage")).toEqual([
      { op: "queueMessage", arg: "actually do the other thing", second: "$1643" },
    ]);
  });

  it("keeps Send and Queue as two gestures rather than choosing for you", async () => {
    const steer = recordingSteer();
    const rec = recordingActions(() => actionsWire({ actions: [CONTINUE_WIRE] }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: steer.api, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one being told things");
    await act(async () => {});

    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "say this now");
    await clickSaying("Send now");

    // Send still types at the pane, and did NOT quietly become a queue.
    expect(steer.calls).toHaveLength(1);
    expect(steer.calls[0]?.arg).toBe("say this now");
    expect(rec.calls.filter((c) => c.op === "queueMessage")).toHaveLength(0);
  });

  /* -------------------------------------------------------------- *
   * v0.5g. Greg pressed Queue on an idle session and nothing happened.
   * The drain (v0.5f) is why nothing happened; this is the other half —
   * on an idle session the two buttons are the same act, one of them
   * ~73 seconds later, so only the immediate one is offered.
   * -------------------------------------------------------------- */

  /** Open one session, at a named status, with a named set of queues. */
  function openAt(status: FleetState["rows"][number]["status"], queues: unknown[] = []): void {
    const rec = recordingActions(() => actionsWire({ actions: [CONTINUE_WIRE], queues }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "the one being told things", status })] })));
    openSession("the one being told things");
  }

  it("offers no Queue on an idle session, because Send is the same act sooner", async () => {
    openAt({ kind: "idle" });
    await act(async () => {});
    // The paired positive: Send is still there, so this is one button gone
    // rather than the whole section failing to render.
    expect(buttonLabels()).toContain("Send now");
    expect(buttonLabels()).not.toContain("Queue (~73s)");
  });

  it("offers Queue on a working session, which is the state the queue exists for", async () => {
    openAt({ kind: "working" });
    await act(async () => {});
    expect(buttonLabels()).toContain("Queue (~73s)");
  });

  it("offers Queue on an idle session that already has something waiting, because order is the point", async () => {
    openAt({ kind: "idle" }, [queueWire({ items: [itemWire({ id: "q1", payload: { kind: "action", actionId: "push" } })] })]);
    await act(async () => {});
    /* Two buttons that both send NOW would let this message overtake the item
       already in the line — queue.ts: "a message must land after the one that
       says do X and before the one that says push". */
    expect(buttonLabels()).toContain("Queue (~73s)");
  });

  it("offers no Queue on an idle session whose only queued item can never be delivered", async () => {
    // The exception to hiding Queue is that ORDER is the point: something is
    // already in the line and a second Send would overtake it. An item the tmux
    // generation has killed, or one past `maxAgeMs`, is in the list and is
    // ahead of nothing — so offering the slower button there promises an
    // ordering guarantee that does not exist.
    openAt({ kind: "idle" }, [
      queueWire({
        items: [
          itemWire({
            id: "q1",
            payload: { kind: "action", actionId: "push" },
            invalidated: "this was queued against tmux server 1234, and the box is running 5678 now",
          }),
        ],
      }),
    ]);
    await act(async () => {});
    expect(buttonLabels()).toContain("Send now");
    expect(buttonLabels()).not.toContain("Queue (~73s)");
  });

  it("offers no Queue on an idle session whose only queued item is too old to send", async () => {
    openAt({ kind: "idle" }, [
      queueWire({ items: [itemWire({ id: "q1", payload: { kind: "action", actionId: "push" }, stale: true })] }),
    ]);
    await act(async () => {});
    expect(buttonLabels()).not.toContain("Queue (~73s)");
  });

  it("offers Queue against a server too old to say what is deliverable", async () => {
    // The fallback is what the page did before the field existed. Over-offering
    // a button is a smaller failure than hiding one on the strength of a field
    // an older server never sent.
    openAt({ kind: "idle" }, [
      queueWire({
        items: [itemWire({ id: "q1", payload: { kind: "action", actionId: "push" }, stale: null, stuck: null })],
        deliverable: null,
      }),
    ]);
    await act(async () => {});
    expect(buttonLabels()).toContain("Queue (~73s)");
  });

  it("says how long a queued message waits, in seconds rather than 'shortly'", async () => {
    openAt({ kind: "working" });
    await act(async () => {});
    /* Both places that offer the queue, because the vague version was in two
       and fixing one would leave the page disagreeing with itself. */
    /* The number moved behind a tap on the Queue button in the declutter pass,
       and the button's own label now carries it too. Both still say seconds. */
    expect(buttonLabels()).toContain("Queue (~73s)");
    expect(container.textContent).toContain("The line is checked about every 73 seconds");
    expect(container.textContent).toContain("goes out once it is back at a prompt — checked about every 73 seconds");
    // The words that promised a speed and named no number.
    expect(container.textContent).not.toContain("within a minute or so");
    expect(container.textContent).not.toContain("shortly");
  });
});

describe("the box, which says what it would do before it does it", () => {
  function openBox(actions: unknown[], over: Partial<ActionsApi> = {}, acting?: unknown): ReturnType<typeof recordingActions> {
    const rec = recordingActions(() => actionsWire({ actions, ...(acting === undefined ? {} : { acting }) }), over);
    window.location.hash = "#health";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ health: { verdict: { level: "strained", reasons: [] } } })));
    return rec;
  }

  it("warns that this server will refuse, before anybody taps and finds out", async () => {
    /* `FLEET_ACT_ENABLED` is off in production, so on the live page every one of
       these buttons answers 409 on the second tap. The route has always said so
       in the feed, under a comment naming this exact failure — "the alternative
       is a person discovering it by tapping and getting a 503" — and nothing
       read the field. The warning is the SERVER's sentence, not one written in
       the page. */
    openBox([KILL_SUITES_WIRE], {}, { enabled: false, why: "acting is off: start the server with FLEET_ACT_ENABLED=1." });
    await act(async () => {});

    expect(container.textContent).toContain("This server will not act");
    expect(container.textContent).toContain("FLEET_ACT_ENABLED=1");
    // The dry run is not gated by the flag, so the button stays pressable.
    expect(buttonLabels()).toContain("Kill test suites");
  });

  it("says nothing about acting when the server said nothing about it", async () => {
    /* SILENCE IS NOT A WARNING. A page that inferred "off" from an absent field
       would put a red line on every server older than the field, which is the
       mirror of the bug above and just as wrong. */
    openBox([KILL_SUITES_WIRE]);
    await act(async () => {});

    expect(container.textContent).not.toContain("This server will not act");
  });

  it("asks what it would do, and does not do it, on the first press", async () => {
    const rec = openBox([KILL_SUITES_WIRE]);
    await act(async () => {});
    await clickSaying("Kill test suites");

    /* `rows: ""` is the Box Health tab having no fleet list to give — its
       caller has none — and a kill reads `pids` rather than `recipients` in any
       case. Asserted rather than allowed to be absent, so this stays a visible
       fact about the panel instead of a silence. */
    expect(rec.calls.filter((c) => c.op === "box")).toEqual([{ op: "box", arg: "kill-test-suites", second: true, rows: "" }]);
    expect(container.textContent).toContain("What it would do");
    expect(container.textContent).toContain(KILL_SUITES_WIRE.gate);
  });

  it("only then does it, on the second press", async () => {
    const rec = openBox([KILL_SUITES_WIRE]);
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    expect(rec.calls.filter((c) => c.op === "box")).toEqual([
      { op: "box", arg: "kill-test-suites", second: true, rows: "" },
      { op: "box", arg: "kill-test-suites", second: false, rows: "" },
    ]);
    // The stub's answer describes no per-row effect, so "Done." is all there
    // is to say. The two tests below are the answers that do describe one.
    expect(container.textContent).toContain("Done.");
  });

  it("will not say Done over a kill where only one of three signals was accepted", async () => {
    /* **A KILL THAT MOSTLY FAILED READ EXACTLY LIKE ONE THAT WORKED.** The
       heading came off `dryRun` alone, and the pids were in `RawValue`
       underneath, where a list of three objects looks the same whatever the
       `observation` on each says. `parseBoxEffect` is the real one, so the
       counts are read from the answer rather than asserted about a shape
       nothing produces.

       The three observations here are the three a real run produces — the
       fourth arm, `not-attempted`, was cut because nothing could write it. */
    const result = {
      run: { action: "kill-test-suites", steps: [{}, {}, {}], planned: 3, completed: true, stoppedAt: null },
      kill: {
        targeted: [5001, 5002, 5003],
        observed: [
          { pid: 5001, observation: "signal-accepted", why: "it exited 0" },
          { pid: 5002, observation: "signal-refused", why: "it exited 1, which this step is allowed to do" },
          { pid: 5003, observation: "not-established", why: "it was killed for taking too long, which this step is allowed to do" },
        ],
      },
    };
    openBox([KILL_SUITES_WIRE], {
      box: async (_id, dryRun) => ({
        ok: true,
        dryRun,
        dryRunStated: true,
        result,
        why: null,
        effect: parseBoxEffect(result),
      }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    expect(container.textContent).toContain("Signal accepted for 1 of 3 pids.");
    // The ceiling on the strongest arm, on the DOM path a person actually uses.
    expect(container.textContent).toContain("signal accepted — not proof the process is gone");
    expect(container.textContent).toContain("no such process, or not ours to signal");
    /* NOT "the kill could not be run": this row's `kill` was killed for taking
       too long, so it RAN, and the summary would have contradicted the verdict
       printed beside it. */
    expect(container.textContent).toContain("the signal attempt did not settle — it may have gone out and it may not");
    expect(container.textContent).not.toContain("Done.");
    /* SCOPED TO THE SUMMARY LIST, not the whole page: the raw dump underneath
       carries the server's own verdicts, and "it was killed for taking too
       long" is a true sentence about the `kill` COMMAND. The rule is that no
       sentence this page writes is past tense about the target process. */
    const summary = Array.from(container.querySelectorAll("li"))
      .map((li) => li.textContent ?? "")
      // `<count> <state> — <sentence>`, which the raw dump's rows are not.
      .filter((t) => /^\d+ \S+ — /.test(t))
      .join(" ");
    expect(summary).toContain("signal-accepted");
    expect(summary).not.toMatch(/killed|\bdead\b|\bdied\b/i);
  });

  it("shows a half-landed broadcast as half-landed rather than as a refusal", async () => {
    const result = {
      total: 3,
      recipients: [
        { paneId: "%1", sessionId: "$1", minutes: 5, outcome: "keys-submitted", code: null, why: null },
        { paneId: "%2", sessionId: "$2", minutes: null, outcome: "held", code: null, why: "it is working" },
        { paneId: "%3", sessionId: "$3", minutes: 33, outcome: "partial", code: "send-failed", why: "the Enter did not go" },
      ],
    };
    openBox([BROADCAST_WIRE], {
      box: async (_id, dryRun) => ({
        ok: true,
        dryRun,
        dryRunStated: true,
        result,
        why: null,
        effect: parseBoxEffect(result),
      }),
    });
    await act(async () => {});
    await clickSaying("Broadcast: ease off, staggered");
    await clickSaying("Yes — broadcast: ease off, staggered");

    expect(container.textContent).toContain("Keys submitted to 1 of 3 rows.");
    // The row that is holding half a message, said in words rather than left
    // as a state name in a JSON dump.
    expect(container.textContent).toContain("PART of the message went, and the rest is unaccounted for");
    expect(container.textContent).not.toContain("Done.");
  });

  /**
   * **THE JOIN BETWEEN THE PANEL AND THE BODY IT POSTS**, which is the half the
   * route tests cannot see.
   *
   * `tests/fleet-actions-route.test.ts` drives `boxActionBody` into the real
   * `broadcastRoute` and proves a recipient is selected — but it calls the API
   * directly, so it stays green on a panel that has stopped handing the rows
   * over. That is exactly the shape of the defect being closed here: for a day
   * the builder and the route were each right about their own object and had
   * never met, and an evening was spent measuring a selection rule that had
   * never run. So this presses the real button, through the real client, and
   * reads the bytes that left.
   *
   * The values are asserted **against the row itself** rather than against
   * literals: a client that re-derived the status, or re-read the fleet to make
   * its claim true, would not match the snapshot it was handed.
   */
  it("posts the rows it was given, so a broadcast has somebody to go to", async () => {
    const posted: Record<string, unknown>[] = [];
    const spy = (async (_url: string, init?: { body?: string }) => {
      posted.push(JSON.parse(init?.body ?? "null") as Record<string, unknown>);
      return {
        status: 200,
        json: async () => ({
          ok: true,
          op: "broadcast-preview",
          action: "resource-broadcast",
          dryRun: true,
          result: { total: 1, recipients: [], sample: null },
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const feed = parseActionsFeed(actionsWire({ actions: [BROADCAST_WIRE] }));
    if (feed === null) throw new Error("the fixture feed did not parse");
    const onScreen = steerable({ id: "$1643", title: "the one on screen" });
    /* A ROW THAT IS NOT AN ADDRESS — `row` leaves `paneId` and
       `claudeSessionId` null, which is the shell and the too-old session a real
       fleet always has a few of. The route refuses the WHOLE request over one
       of these, so sending the page's rows entirely raw fixed nothing: the live
       server answered 400 to a body carrying all 23 of them. */
    const noAddress = row({ id: "$1644", title: "a shell" });
    act(() =>
      root.render(
        <BoxActions
          feed={feed}
          api={makeActionsApi(spy)}
          asked={true}
          error={null}
          onChanged={() => {}}
          rows={[onScreen, noAddress]}
        />,
      ),
    );
    await clickSaying("Broadcast: ease off, staggered");

    expect(posted).toHaveLength(1);
    expect(posted[0]?.["recipients"]).toEqual([
      {
        paneId: onScreen.paneId,
        sessionId: onScreen.id,
        claudeSessionId: onScreen.claudeSessionId,
        panePid: onScreen.panePid,
        // THE SERVER'S OWN OBJECT, not the parsed `status` this page drew with.
        status: onScreen.rawStatus,
      },
    ]);
    // AND THE NARROWING IS ON SCREEN. A denominator that quietly shrank between
    // the page and the request is this stage's own defect one layer up.
    expect(container.textContent).toContain("1 of the 2 sessions on this page has no pane or no conversation id");
  });

  it("offers no Confirm at all when the dry run could not answer", async () => {
    const rec = openBox([KILL_SUITES_WIRE], {
      box: async () => ({
        ok: false,
        code: "ps-failed",
        why: "ps exited 1 and said nothing",
        status: 500,
        from: "server",
        // The dry run never sends anything, so the route has no delivery to state.
        delivery: { kind: "not-told" },
        // And `ps` failed before any plan was built, so there is no run either.
        run: null,
      }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");

    expect(container.textContent).toContain("It could not tell you.");
    expect(container.textContent).toContain("ps exited 1 and said nothing");
    // The refusal, and the fallback that still works.
    expect(buttonLabels()).not.toContain("Yes — kill test suites");
    expect(buttonLabels()).toContain("Cancel");
    expect(rec.calls.filter((c) => c.op === "box" && c.second === false)).toHaveLength(0);
  });

  it("says so loudly when a dry run comes back saying it was not one", async () => {
    /* The worst thing this panel could get wrong: believing our own request
       instead of the reply, and reporting a kill as a question. */
    openBox([KILL_SUITES_WIRE], {
      box: async () => ({ ok: true, dryRun: false, dryRunStated: true, result: ["killed 4"], why: null, effect: null }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");
    expect(container.textContent).toContain("The server says that was NOT a dry run.");
    expect(container.textContent).toContain("Treat this as already done and check the box.");
  });

  it("refuses to look like a confirmation when the server said nothing about what it would destroy", async () => {
    /* The panel drew the literal grey word "null" here for the life of the
       feature, because it read a field name no route has ever sent (#11 in
       docs/postmortems/260908b-…). A missing preview must read as a missing
       preview — in the alarm colour, with no Confirm under it — because the
       failure this panel exists to prevent is somebody pressing *kill* on the
       strength of an answer that said nothing. */
    const rec = openBox([KILL_SUITES_WIRE], {
      box: async () => ({ ok: true, dryRun: true, dryRunStated: true, result: null, why: null, effect: null }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");

    expect(container.textContent).toContain("did not say what it would destroy");
    expect(container.textContent).not.toContain("null");
    expect(buttonLabels()).not.toContain("Yes — kill test suites");
    expect(rec.calls.filter((c) => c.op === "box" && c.second === false)).toHaveLength(0);
  });

  it("does not say Done over a server that answered the second press with a dry run", async () => {
    /* `mode` is the field the route reads and this page sent `dryRun` until
       2026-09-08, so every press of the second button was answered with a dry
       run and reported as "Done." — the reassuring half of a contradiction, and
       the page could tell, because the answer says which it was. */
    openBox([KILL_SUITES_WIRE], {
      box: async () => ({ ok: true, dryRun: true, dryRunStated: true, result: ["would kill 5001"], why: null, effect: null }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    expect(container.textContent).toContain("Nothing was done.");
    expect(container.textContent).toContain("Nothing on the box has changed.");
    expect(container.textContent).not.toContain("Done.");
  });

  it("will not claim a dry run when the server never said it was one", async () => {
    openBox([KILL_SUITES_WIRE], {
      box: async () => ({ ok: true, dryRun: true, dryRunStated: false, result: [], why: null, effect: null }),
    });
    await act(async () => {});
    await clickSaying("Kill test suites");
    expect(container.textContent).toContain("did not say whether that was a dry run");
  });

  it("tells you how far apart the pauses are spread, before broadcasting", async () => {
    openBox([BROADCAST_WIRE]);
    await act(async () => {});
    await clickSaying("Broadcast: ease off, staggered");
    expect(container.textContent).toContain("between 5 and 60 minutes");
    expect(container.textContent).toContain("Nothing here can prove an agent read it");
  });

  it("keeps the buttons when the health reading itself could not be taken", async () => {
    const rec = recordingActions(() => actionsWire({ actions: [KILL_SUITES_WIRE] }));
    window.location.hash = "#health";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ health: null })));
    await act(async () => {});
    // A box you cannot read is a box you are MORE likely to want to act on.
    expect(container.textContent).toContain("No box health data.");
    expect(buttonLabels()).toContain("Kill test suites");
  });
});

describe("the Overseer tab, which no longer says it is empty", () => {
  it("shows what is queued across the fleet, and against which session", async () => {
    const rec = recordingActions(() =>
      actionsWire({
        actions: [BROADCAST_WIRE],
        queues: [
          queueWire({
            sessionId: "$1643",
            items: [itemWire({ id: "q1", payload: { kind: "message", text: "pull latest first" } })],
          }),
        ],
      }),
    );
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "the busy one" })] })));
    await act(async () => {});

    expect(container.textContent).toContain("1 thing is queued, across 1 session");
    expect(container.textContent).toContain("the busy one");
    expect(container.textContent).toContain("pull latest first");
    /* **"None of it has been sent yet." IS GONE AND MUST NOT COME BACK.** It
       was drawn over every queue, including one whose head had been handed over
       for delivery a second earlier, and — since Stage 4 of 260908j — over a
       session that may be holding half a message in its input box. */
    expect(container.textContent).not.toContain("None of it has been sent yet");
  });

  /* ------------------------------------------------------------------ *
   * A HELD SESSION, AND THE HOLD WITH NOTHING BEHIND IT.
   *
   * docs/plans/260908j § Stage 4. The filter here was `items.length > 0`, and
   * the commonest hold has no items: one message queued, one ambiguous send,
   * the item settled and gone. That hold had no row on the page and therefore
   * no way to press either gesture — a hold nothing can see is a hold nothing
   * can clear.
   * ------------------------------------------------------------------ */

  function heldFleet(over: Record<string, unknown> = {}) {
    return recordingActions(() =>
      actionsWire({ queues: [queueWire({ sessionId: "$1643", items: [], quarantine: holdWire(over) })] }),
    );
  }

  async function mountHeld(rec: ReturnType<typeof recordingActions>): Promise<void> {
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "the held one" })] })));
    await act(async () => {});
  }

  it("draws a hold with NO items behind it, which used to be invisible", async () => {
    const rec = heldFleet();
    await mountHeld(rec);
    expect(container.textContent).toContain("the held one");
    expect(container.textContent).toContain("Nothing is being delivered to this session.");
    // THE SERVER'S OWN SENTENCE, not one rebuilt here from `reading`.
    expect(container.textContent).toContain("may be sitting in its input box");
    // And the header says how many sessions are in this state.
    expect(container.textContent).toContain("held after a send nobody can account for");
  });

  it("never says nothing has been sent over a held session", async () => {
    const rec = heldFleet();
    await mountHeld(rec);
    expect(container.textContent).not.toContain("None of it has been sent yet");
    expect(container.textContent).not.toMatch(/nothing (has been|was) sent/i);
  });

  it("offers exactly the two gestures, in the words that make them safe", async () => {
    const rec = heldFleet();
    await mountHeld(rec);
    const card = container.querySelector<HTMLElement>('[aria-label="Held after a send nobody can account for"]');
    expect(card).not.toBeNull();
    const labels = [...(card?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map((b) => b.textContent ?? "");
    expect(labels).toEqual(["I looked at the terminal and saw it", "Abandon the uncertainty"]);
    /* **SCOPED TO THIS CARD, NOT THE PAGE.** A page-wide assertion would be a
       false guard: other panels legitimately offer to send things, so it would
       go red for the wrong reason and — worse — could be made green by moving a
       button rather than by fixing the copy. */
    for (const label of labels) {
      expect(label).not.toMatch(/send|deliver|retry|try again/i);
    }
    expect(card?.textContent).toContain("Neither button below sends anything");
  });

  it("sends the hold's id AND the version it was reading, so a stale page is refused", async () => {
    const rec = heldFleet({ id: "1a2b3c4d-h7", version: 3 });
    await mountHeld(rec);
    await clickSaying("I looked at the terminal and saw it");
    expect(rec.calls.filter((c) => c.op === "releaseHold")).toEqual([
      { op: "releaseHold", arg: "1a2b3c4d-h7@3", second: "operator-confirmed" },
    ]);
  });

  it("records the operator's claim as a claim, and never as an observation", async () => {
    const rec = heldFleet();
    await mountHeld(rec);
    await clickSaying("I looked at the terminal and saw it");
    expect(container.textContent).toContain("Recorded.");
    expect(container.textContent).toContain("kept as your word");
    expect(container.textContent).toContain("the dashboard observed nothing");
    expect(container.textContent).toContain("Nothing was typed at the session.");
  });

  it("abandoning claims nothing in either direction, and says so", async () => {
    const rec = heldFleet();
    await mountHeld(rec);
    await clickSaying("Abandon the uncertainty");
    expect(rec.calls.filter((c) => c.op === "releaseHold")[0]?.second).toBe("abandoned-unknown");
    expect(container.textContent).toContain("does not claim either way");
    // THE HALF THAT IS EASY TO GET WRONG. It must not read as "it was not
    // delivered" — the same trap the abandon copy one gesture along carries.
    expect(container.textContent).not.toMatch(/was not delivered|did not arrive|never reached/i);
  });

  it("says a repeat was already recorded rather than that it has just been done", async () => {
    const rec = recordingActions(
      () => actionsWire({ queues: [queueWire({ sessionId: "$1643", items: [], quarantine: holdWire() })] }),
      {
        releaseHold: async (_holdId, _version, gesture) => ({ ok: true, kind: "hold-released", gesture, repeat: true }),
      },
    );
    await mountHeld(rec);
    await clickSaying("Abandon the uncertainty");
    expect(container.textContent).toContain("That was already recorded.");
    expect(container.textContent).toContain("changed nothing");
  });

  it("draws a hold that also has items waiting, above them", async () => {
    const rec = recordingActions(() =>
      actionsWire({
        queues: [
          queueWire({
            sessionId: "$1643",
            items: [itemWire({ id: "q1", payload: { kind: "message", text: "pull latest first" } })],
            quarantine: holdWire(),
          }),
        ],
      }),
    );
    await mountHeld(rec);
    expect(container.textContent).toContain("Nothing is being delivered to this session.");
    expect(container.textContent).toContain("pull latest first");
  });

  it("keeps the row when the hold itself is unreadable, rather than losing it silently", async () => {
    // The sharpest version of `itemsUnreadable`'s defect: a `quarantine` this
    // page cannot parse reads as `null`, which is also what "nothing is held"
    // looks like — so on a queue with no items the whole row, and both
    // gestures, would disappear from a session nothing may be sent to.
    const rec = recordingActions(() =>
      actionsWire({ queues: [queueWire({ sessionId: "$1643", items: [], quarantine: { id: 7, version: "one" } })] }),
    );
    await mountHeld(rec);
    expect(container.textContent).toContain("the held one");
    expect(container.textContent).toContain("in a shape this page cannot read");
    expect(container.textContent).not.toContain("Nothing is waiting anywhere on the box.");
    // And it offers no gesture, because a release needs an id and a version.
    expect(buttonLabels()).not.toContain("Abandon the uncertainty");
  });

  it("does not draw a released hold as one that is still holding", async () => {
    // The route never sends one today — `snapshot.quarantine` is `holding()` —
    // but the record exists, and a page that read any hold as a live one would
    // grey out a session nothing is stopping.
    const rec = heldFleet({
      outcome: { kind: "released", gesture: "abandoned-unknown", at: 1_757_000_001_000, what: "…" },
    });
    await mountHeld(rec);
    expect(container.textContent).not.toContain("Nothing is being delivered to this session.");
  });

  it("draws a queue whose session is not in the snapshot rather than dropping it", async () => {
    const rec = recordingActions(() =>
      actionsWire({
        queues: [
          queueWire({
            sessionId: "$9999",
            items: [itemWire({ id: "q1", payload: { kind: "message", text: "still waiting" } })],
          }),
        ],
      }),
    );
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [] })));
    await act(async () => {});

    expect(container.textContent).toContain("a session not in the latest snapshot");
    expect(container.textContent).toContain("still waiting");
  });

  it("offers the broadcast, and refuses to draw a box that would swallow a message", async () => {
    const rec = recordingActions(() => actionsWire({ actions: [BROADCAST_WIRE] }));
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [] })));
    await act(async () => {});

    expect(buttonLabels()).toContain("Broadcast: ease off, staggered");
    // The wording changed on 2026-09-08 with the Overseer status card: the old
    // sentence's premise was that no Overseer process existed, and one does. The
    // refusal is unchanged and is the point — a daemon that publishes a
    // checkpoint is still not an agent that can receive a message.
    expect(container.textContent).toContain("There is still nothing here to send a message to.");
    // A refusal with a way forward, not a shrug.
    expect(container.textContent).toContain("the broadcast above is the real thing");
  });

  it("hands the broadcast the rows the tab is showing, which is what makes it reach anybody", async () => {
    /* **THE LAST HOP, AND IT WAS THE MISSING ONE.** The test above proves the
       button is drawn; for a day that was the whole of what was proven, and the
       button could not deliver to a single session because no list of
       recipients ever left the browser. `broadcastRoute` refuses a request that
       names nobody on purpose — a fleet-wide message must act on the list the
       person was looking at — so this tab, which is the one that HAS that list,
       has to hand it over. Deleting `rows` from the `BoxActionsCard` in
       OverseerPanel.tsx turns this red; the route half is in
       tests/fleet-actions-route.test.ts. */
    const rec = recordingActions(() => actionsWire({ actions: [BROADCAST_WIRE] }));
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    const shown = [steerable({ id: "$1643" }), steerable({ id: "$1644", paneId: "%2109" })];
    act(() => feed.push(state({ rows: shown })));
    await act(async () => {});
    await clickSaying("Broadcast: ease off, staggered");
    await clickSaying("Yes \u2014 broadcast: ease off, staggered");

    /* BOTH PRESSES, AND THE SECOND ONE IS THE ONE THAT MATTERS. A preview that
       named two sessions over a send that reached none would be this stage's own
       defect wearing a receipt, so the confirmed request has to carry exactly
       the list the preview described. A mutation that dropped the rows from the
       commit alone survived every other test here. */
    expect(rec.calls.filter((c) => c.op === "box")).toEqual([
      { op: "box", arg: "resource-broadcast", second: true, rows: "$1643,$1644" },
      { op: "box", arg: "resource-broadcast", second: false, rows: "$1643,$1644" },
    ]);
  });

  it("draws the Overseer's own two clocks on the tab, straight off the payload", async () => {
    /* THE EDGE `App` MAKES AND NOTHING ELSE COVERS: the panel gets `overseer`
       from the state it was handed. tests/fleet-overseer-panel.test.tsx drives
       the card and the payload; this is the one hop between them, and deleting
       the prop in App.tsx turns it red. */
    window.location.hash = "#overseer";
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    const wroteAt = new Date(Date.now() - 30_000).toISOString();
    act(() =>
      feed.push(
        state({
          rows: [],
          overseer: {
            kind: "published",
            status: {
              schema: 2,
              writtenAt: wroteAt,
              lastGoodSnapshotAt: new Date(Date.now() - 45_000).toISOString(),
              sourceStaleAfterMs: 300_000,
              heartbeat: {
                kind: "reading",
                pid: 2_375_511,
                instanceId: "599c3840-4c9c-445f-9308-e34923704fa8",
                startedAt: new Date(Date.now() - 3_600_000).toISOString(),
                lastTickAt: wroteAt,
                ticks: 28,
              },
              scheduler: { kind: "armed", why: "started with the scheduler on", at: wroteAt },
              register: { kind: "read", total: 0, sessions: [] },
            },
          },
        }),
      ),
    );
    await act(async () => {});

    expect(container.textContent).toContain("Supervision is running.");
    expect(container.textContent).toContain("Overseer last wrote");
    expect(container.textContent).toContain("its fleet source last updated");
  });
});

describe("the bodies these buttons post, which are pure functions of the row", () => {
  const ACTION_ROW = steerable({
    id: "$1643",
    paneId: "%1646",
    panePid: 645023,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    status: { kind: "needs-you" },
  });

  it("hands back the server's own status object, not this build's parse of it", () => {
    const odd = row({
      id: "$1643",
      status: { kind: "unknown", why: "x" },
      rawStatus: { kind: "compacting", since: 4 },
    });
    expect(sessionActionBody(odd, "continue")["status"]).toEqual({ kind: "compacting", since: 4 });
  });

  it("carries every identifier verbatim, and an action id beside them", () => {
    expect(sessionActionBody(ACTION_ROW, "remove-worktree")).toEqual({
      paneId: "%1646",
      sessionId: "$1643",
      claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
      panePid: 645023,
      status: { kind: "needs-you" },
      kind: "action",
      actionId: "remove-worktree",
      // SAID, NOT LEFT TO THE DEFAULT. The server prefixes every message with a
      // line naming its sender, and an absent `speaker` means the weaker claim
      // — so a body without this field would have every button a person taps
      // arrive at the agent labelled as an automated coordinator's suggestion.
      speaker: "greg",
    });
  });

  it("puts a queued message and a queued action in the same shape, so one queue can hold both", () => {
    const message = sessionMessageBody(ACTION_ROW, "do the other thing");
    expect(message.sessionId).toBe("$1643");
    expect(message.kind).toBe("message");
    expect(message.text).toBe("do the other thing");
    expect(message.speaker).toBe("greg");
  });

  it("cancels by what was on the snapshot, and asks for nothing else", () => {
    expect(cancelBody("$1643", "q1")).toEqual({ sessionId: "$1643", itemId: "q1" });
  });

  it("does not ask the server for fresh state before pressing a button", async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({ ok: true, queued: true, position: 1 }),
      } as Response;
    }) as unknown as typeof fetch;

    await makeActionsApi(impl).run(ACTION_ROW, "continue");

    expect(calls).toEqual(["api/actions/session"]);
    // The URL that would turn every guard in steer.ts into a tautology.
    expect(calls).not.toContain("api/state");
  });
});

describe("what comes off the actions wire", () => {
  it("refuses an entry with no id, since an id is what a press posts back", () => {
    expect(parseAction({ effect: "spoken", label: "No id" })).toBeNull();
    expect(parseAction(CONTINUE_WIRE)?.id).toBe("continue");
  });

  it("falls back to the id for a missing label rather than losing the button", () => {
    const parsed = parseAction({ ...CONTINUE_WIRE, label: undefined });
    expect(parsed?.label).toBe("continue");
    expect(parsed?.effect).toBe("spoken");
  });

  it("reads a spoken action with no words as one it cannot offer", () => {
    expect(parseAction({ ...CONTINUE_WIRE, text: undefined })?.effect).toBe("unrecognised");
  });

  it("keeps needsConfirm true unless the server said false", () => {
    /* Narrowed rather than read off the union: the `unrecognised` arm has no
       `needsConfirm` at all, which is the type doing its job — an action this
       page cannot classify is not a button, so there is nothing for the field
       to mean. */
    const confirmOf = (v: unknown): boolean | "not-spoken" => {
      const parsed = parseAction(v);
      return parsed !== null && parsed.effect === "spoken" ? parsed.needsConfirm : "not-spoken";
    };
    expect(confirmOf({ ...CONTINUE_WIRE, needsConfirm: undefined })).toBe(true);
    expect(confirmOf({ ...CONTINUE_WIRE, needsConfirm: "no" })).toBe(true);
    expect(confirmOf(CONTINUE_WIRE)).toBe(false);
  });

  it("tells an absent catalogue from an empty one, and both from one it cannot read", () => {
    // THE THIRD ANSWER IS THE ONE THAT WAS MISSING, and its absence is why
    // every action button on the dashboard was invisible: the route sends
    // `actions: {session, box}`, this parser asked `Array.isArray`, and the
    // `false` was rendered as "this server sent no list of actions at all…
    // probably older than this page". A shape it cannot read is a fact about
    // this page, not a claim about the server.
    expect(parseActionsFeed({ queues: [] })?.catalogue).toEqual({ kind: "absent" });
    expect(parseActionsFeed({ actions: { session: [], box: [] }, queues: [] })?.catalogue).toEqual({ kind: "read" });
    // One arm is enough to have sent a catalogue.
    expect(parseActionsFeed({ actions: { session: [] }, queues: [] })?.catalogue).toEqual({ kind: "read" });

    for (const shape of [[], [CONTINUE_WIRE], "actions", 7, { nothing: true }]) {
      const read = parseActionsFeed({ actions: shape, queues: [] });
      expect(read?.catalogue.kind, JSON.stringify(shape)).toBe("unreadable");
      expect(read?.actions).toEqual([]);
    }
  });

  it("reads both arms of the catalogue into one list, keeping each entry's scope", () => {
    // The flattening is what `sessionActions`/`boxActions` filter over, so a
    // box action that arrived in the `box` arm has to still say it is one.
    const read = parseActionsFeed({ actions: { session: [CONTINUE_WIRE], box: [KILL_SUITES_WIRE] }, queues: [] });
    expect(read?.actions.map((a) => a.id)).toEqual(["continue", "kill-test-suites"]);
    expect(sessionActions(read).map((a) => a.id)).toEqual(["continue"]);
    expect(boxActions(read).map((a) => a.id)).toEqual(["kill-test-suites"]);
  });

  it("counts an entry it cannot classify without losing the catalogue around it", () => {
    const read = parseActionsFeed({ actions: { session: [CONTINUE_WIRE, { id: "mystery" }], box: [] }, queues: [] });
    expect(read?.catalogue).toEqual({ kind: "read" });
    expect(read?.actions.map((a) => a.id)).toEqual(["continue", "mystery"]);
  });

  it("reads the queue's two judgments, and makes neither when the server is silent", () => {
    // `?? null` semantics, the same as `invalidated`: a server too old to send
    // the field is not claiming the item is fine, and inventing `false` for it
    // would be this page making the claim on its behalf.
    const said = parseQueue(
      queueWire({ items: [itemWire({ id: "q1", payload: { kind: "message", text: "hi" }, stale: true, stuck: true })] }),
    );
    expect(said?.items[0]?.stale).toBe(true);
    expect(said?.items[0]?.stuck).toBe(true);

    const silent = parseQueue(
      queueWire({
        items: [itemWire({ id: "q1", payload: { kind: "message", text: "hi" }, stale: null, stuck: null })],
        deliverable: null,
      }),
    );
    expect(silent?.items[0]?.stale).toBe(null);
    expect(silent?.items[0]?.stuck).toBe(null);
    expect(silent?.deliverable).toBe(null);
  });

  it("reads how many of a queue's items could still be delivered", () => {
    const read = parseQueue(
      queueWire({
        items: [
          itemWire({ id: "q1", payload: { kind: "message", text: "dead" }, invalidated: "the box is running 5678 now" }),
          itemWire({ id: "q2", payload: { kind: "message", text: "fresh" } }),
        ],
      }),
    );
    expect(read?.items).toHaveLength(2);
    expect(read?.deliverable).toBe(1);
  });

  it("reads a queued action whether the server sent the whole action or only its id", () => {
    const whole = parseQueue(
      queueWire({ items: [itemWire({ id: "q1", payload: { kind: "action", action: CONTINUE_WIRE } })] }),
    );
    const flat = parseQueue(
      queueWire({ items: [itemWire({ id: "q1", payload: { kind: "action", actionId: "continue" } })] }),
    );
    expect(whole?.items[0]?.payload).toEqual({
      kind: "action",
      actionId: "continue",
      label: "Continue",
      text: CONTINUE_WIRE.text,
    });
    expect(flat?.items[0]?.payload).toEqual({ kind: "action", actionId: "continue", label: "continue", text: null });
  });
});

describe("what became of the keystrokes, which is three answers and not two", () => {
  /* THE SERVER HAD THIS RIGHT AND THE BROWSER THREW IT AWAY. `steer.ts`
     distinguishes `none` / `partial` / `unknown` and the route sends it under a
     comment saying "the person who pressed the button is the one who needs it,
     and they are on a phone". `steer-client.ts` did not read the field, so
     every refusal rendered as "Nothing was sent." — false in the most expensive
     direction, because `partial` means the text is SITTING in that agent's
     input box and a retry appends to it rather than replacing it. Instance 5 of
     docs/postmortems/260908b. */

  function refusalSaying(delivery: unknown): void {
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      steer: {
        message: async () => parseSteerRefusal(delivery),
        answer: async () => parseSteerRefusal(delivery),
      },
    });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "the one being told things" })] })));
    openSession("the one being told things");
  }

  /** Build the outcome the way the real client would, from a server body. */
  function parseSteerRefusal(delivery: unknown): SteerOutcome {
    return {
      ok: false,
      code: "enter-not-sent",
      why: "the text was typed and the Enter could not be sent",
      status: 502,
      from: "server",
      delivery: parseDelivery(delivery),
    };
  }

  async function send(): Promise<void> {
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (box === null) throw new Error("there is no message box");
    /* `typeInto`, not `box.value = …`. React's controlled input reads through
       the native value setter, so assigning the property directly leaves its
       state at "" and the Send button disabled — the send silently does not
       happen, and the assertion below then fails for the wrong reason. */
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
  }

  it("does NOT say nothing was sent when the text landed and the Enter did not", async () => {
    refusalSaying("partial");
    await send();
    const text = container.textContent ?? "";
    /* The sentence that was there before, and the one that matters most: a
       person who reads "Nothing was sent" retries, and the retry is appended to
       the half-sent text. There is no way to take the first one back. */
    expect(text).not.toContain("Nothing was sent.");
    expect(text).toContain("PART of it was sent.");
    expect(text).toContain("Do NOT send it again");
  });

  it("does not claim nothing was sent when the server did not say", async () => {
    /* A refusal that carries no `delivery` at all. Absence is not `none`:
       `none` is a claim that nothing left this box, and it is exactly the claim
       the page has least basis for when it has been told nothing. */
    refusalSaying(undefined);
    await send();
    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing was sent.");
    expect(text).toContain("It is not known whether anything was sent.");
  });

  it("does not claim nothing was sent for a value it does not recognise", async () => {
    refusalSaying("half-ish");
    await send();
    expect(container.textContent ?? "").not.toContain("Nothing was sent.");
  });

  it("still says nothing was sent when the server says exactly that", async () => {
    /* The negative half. A guard that never lets the plain case through would
       be one that had simply stopped saying the true thing. */
    refusalSaying("none");
    await send();
    const text = container.textContent ?? "";
    expect(text).toContain("Nothing was sent.");
    expect(text).not.toContain("PART of it was sent.");
  });

  /* AND THE JOIN, WHICH THE FIRST VERSION OF THIS BLOCK DID NOT TEST.
     Everything above builds its `SteerOutcome` by hand and hands it to the
     page, so it exercises the RENDERER. `parseDelivery` below exercises the
     PARSER. Neither touches the line that reads `parsed["delivery"]` out of the
     response — the one line that was missing, and the reason the field never
     reached the browser. Measured: deleting that line again left every test in
     this describe block green.

     `makeSteerApi` had no test caller anywhere in the repo, which is the same
     shape as `renderSpoken` having six test callers and no product ones. This
     drives the real `post` over a fake `fetch`, so the wire, the parse and the
     outcome are one assertion. */
  it("carries the server's `delivery` from the HTTP body into the outcome", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(init?.body);
      return {
        status: 502,
        json: async () => ({
          ok: false,
          code: "enter-not-sent",
          why: "the text was typed and the Enter could not be sent",
          delivery: "partial",
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const api = makeSteerApi(fakeFetch);
    const outcome = await api.message(row({ id: "$a", paneId: "%1", claudeSessionId: "abc" }), "carry on");

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.delivery).toEqual({ kind: "partial" });
    // The sentence is still the server's, verbatim.
    expect(outcome.ok === false && outcome.why).toContain("the Enter could not be sent");
    // And a request was actually made, so a stubbed-out fetch cannot pass this.
    expect(bodies).toHaveLength(1);
  });

  it("says `not-told` when the body carries no delivery at all", async () => {
    const fakeFetch = (async () =>
      ({ status: 409, json: async () => ({ ok: false, code: "wrong-pane", why: "the pane moved" }) }) as unknown as Response) as unknown as typeof fetch;
    const outcome = await makeSteerApi(fakeFetch).message(row({ id: "$a" }), "carry on");
    expect(outcome.ok === false && outcome.delivery).toEqual({ kind: "not-told" });
  });

  it("reads the server's own word off the wire rather than inventing one", () => {
    expect(parseDelivery("none")).toEqual({ kind: "none" });
    expect(parseDelivery("partial")).toEqual({ kind: "partial" });
    expect(parseDelivery("unknown")).toEqual({ kind: "unknown" });
    // Everything else, including absence, is the arm that admits it.
    for (const odd of [undefined, null, "", "NONE", 0, {}, ["partial"]]) {
      expect(parseDelivery(odd)).toEqual({ kind: "not-told" });
    }
  });
});

describe("what became of an ACTION, which is also not two answers", () => {
  /* THE SAME DEFECT, ONE FILE ALONG, AND WITH MORE AT STAKE. The steer path
     carries a `DeliveryReading` and `SessionDetail` renders all four arms of
     it. `ActionOutcome`'s failure arm carried no delivery at all, and
     `ActionButtons` printed "Nothing happened." over every failure — including
     `from: "client"`, where the REPLY NEVER ARRIVED. That is the one case where
     the page has no basis for the claim whatsoever, and the request it is
     making the claim about may have removed a worktree or killed thirty
     processes. A person who reads "Nothing happened." presses it again.

     Everything here drives the REAL client over a fake `fetch`, never a
     hand-built `ActionOutcome`: the line that was missing is the one that reads
     `delivery` off the body, and a fixture of an outcome cannot fail when that
     line is deleted. Same argument as `browserFetch` in
     tests/fleet-actions-route.test.ts. */

  const ROW = steerable({ id: "$1643", title: "the one being acted on" });

  /** A `fetch` that never answers — the phone off Tailscale, mid-request. */
  const nothingCameBack = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;

  /** A `fetch` that answers one refusal body, verbatim. */
  function refusing(body: Record<string, unknown>, status = 409): typeof fetch {
    return (async () => ({ status, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
  }

  /** Answers the dry run, then vanishes on the press that would do it. */
  function answersThenVanishes(first: Record<string, unknown>): typeof fetch {
    let calls = 0;
    return (async () => {
      calls += 1;
      if (calls === 1) return { status: 200, json: async () => first } as unknown as Response;
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
  }

  /**
   * A `fetch` that answers, and whose body will not parse.
   *
   * **The mutation this exists to catch.** `postJson`'s invalid-JSON branch can
   * be changed from `unknown` back to `none` and the suite stayed green,
   * because nothing drove the real client through a response whose `json()`
   * REJECTS — only through a `fetch` that throws. A status arrived, so the
   * request certainly reached the server; what did not arrive is any account of
   * what it did with it.
   */
  function unreadableBody(status = 500): typeof fetch {
    return (async () =>
      ({
        status,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      }) as unknown as Response) as unknown as typeof fetch;
  }

  /** Answers the dry run, then answers the real press with a body that will not parse. */
  function answersThenGarbles(first: Record<string, unknown>): typeof fetch {
    let calls = 0;
    return (async () => {
      calls += 1;
      if (calls === 1) return { status: 200, json: async () => first } as unknown as Response;
      return {
        status: 500,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  /**
   * The sentence a server-stated `none` may say, and the ONLY thing it may say.
   *
   * `Delivery` is about keystrokes. Nothing on this path licenses a claim about
   * a queue, a worktree or a process, so this string must never appear over any
   * other reading — that is what the `not.toContain` uses of it are for.
   */
  const KEYSTROKE_SENTENCE = "No keystrokes went out.";
  /** One heading for both readings that cannot tell, because the action is the same. */
  const CANNOT_TELL_HEAD = "This page cannot tell whether the action took effect.";

  /** The session page, with the real client wired to `fetchImpl`. */
  function openActing(fetchImpl: typeof fetch, actions: unknown[]): void {
    const client = makeActionsApi(fetchImpl);
    const rec = recordingActions(() => actionsWire({ actions }), {
      run: (r, actionId) => client.run(r, actionId),
      queueMessage: (r, text) => client.queueMessage(r, text),
    });
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [ROW] })));
    openSession("the one being acted on");
  }

  /** The box panel, same wiring. */
  function openActingBox(fetchImpl: typeof fetch, actions: unknown[]): void {
    const client = makeActionsApi(fetchImpl);
    const rec = recordingActions(() => actionsWire({ actions }), { box: (actionId, dryRun, rows) => client.box(actionId, dryRun, rows) });
    window.location.hash = "#health";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ health: { verdict: { level: "strained", reasons: [] } } })));
  }

  it("does not say nothing happened when the reply never arrived", async () => {
    /* THE HEADLINE BUG. `remove-worktree` deletes a directory. The request went
       out; the answer did not come back. Whether the tree is still there is
       exactly what this page cannot say, and it said the opposite. */
    openActing(nothingCameBack, [REMOVE_WORKTREE_WIRE]);
    await act(async () => {});
    await clickSaying("Remove worktree");
    await clickSaying("Yes — remove worktree");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    /* THE LOAD-BEARING CLAUSES, pinned rather than the whole paragraph. Each of
       these is a sentence that would be FALSE if it went the other way: the
       first because the action may have run, the second because a repeat of a
       kill or a worktree removal is a fresh act and not an addition to the
       first one. Copy edits around them stay cheap. */
    expect(text).toContain("may have taken effect and it may not");
    expect(text).toContain("a second press is a NEW action");
    // The local sentence is still there, and still owned by whoever wrote it.
    expect(text).toContain("this browser could not reach the dashboard");
    expect(text).toContain("said by this browser");
  });

  it("does not claim the rest did NOT happen when the server says partial", async () => {
    /* `fire()` in steer.ts reaches `partial` down two roads, and only one of
       them knows the remainder failed: its own words are "Part of the sequence
       arrived and the rest cannot be accounted for" when `mayHaveLanded(e)`,
       and "and the rest did not" when it does not. The card sits directly above
       that verbatim sentence and used to contradict half of it. */
    openActing(
      refusing(
        { ok: false, code: "enter-not-sent", why: "the text was typed and the Enter could not be sent", delivery: "partial" },
        502,
      ),
      [CONTINUE_WIRE],
    );
    await act(async () => {});
    await clickSaying("Continue");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain("PART of it took effect.");
    // The clause that was false, and must not come back in any form.
    expect(text).not.toContain("the rest did not");
    // The three clauses that carry the whole meaning.
    expect(text).toContain("Some of it definitely happened");
    expect(text).toContain("may or may not have happened");
    expect(text).toContain("a second press is a NEW action");
    // Still verbatim, still the server's.
    expect(text).toContain("the text was typed and the Enter could not be sent");
  });

  it("says the server did not say, when the body carries no delivery at all", async () => {
    /* The ordinary production refusal: nothing was sent, but the route never
       claimed that, and a page that filled it in would be inventing the one
       fact it is here to carry. */
    openActing(refusing({ ok: false, code: "confirm-required", why: "'remove-worktree' needs confirming" }), [CONTINUE_WIRE]);
    await act(async () => {});
    await clickSaying("Continue");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    expect(text).toContain("the words below are all there is to go on");
  });

  it("does not read a delivery word it has never heard of as nothing", async () => {
    openActing(refusing({ ok: false, code: "odd", why: "something else went wrong", delivery: "half-ish" }), [CONTINUE_WIRE]);
    await act(async () => {});
    await clickSaying("Continue");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    /* AND IT DOES NOT SAY THE SERVER WAS SILENT, because the server was not:
       it said "half-ish" and this build could not read it. `parseDelivery`
       folds an absent field and an unrecognised one onto the same arm, so any
       heading that claimed silence would be false on half its traffic. That is
       the whole reason the two headings collapsed into this one. */
    expect(text).not.toContain("did not say whether this took effect");
    expect(text).not.toContain("did not say whether this happened");
    expect(text).toContain("the words below are all there is to go on");
  });

  it("reads a server-stated `none` as being about keystrokes and nothing wider", async () => {
    /* The negative half, narrowed. `none` is still allowed to say its own true
       thing — a guard that never lets the plain case through has simply stopped
       saying it — but the true thing is about KEYSTROKES. It does not license
       "Nothing happened.", which is a claim about a queue, a worktree or a
       process that no `Delivery` value can support. */
    openActing(refusing({ ok: false, code: "not-steerable", why: "that session is not at a prompt", delivery: "none" }), [CONTINUE_WIRE]);
    await act(async () => {});
    await clickSaying("Continue");

    const text = container.textContent ?? "";
    expect(text).toContain(KEYSTROKE_SENTENCE);
    // The clause that keeps the heading narrow.
    expect(text).toContain("only about keystrokes");
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain("PART of it took effect.");
    expect(text).not.toContain(CANNOT_TELL_HEAD);
  });

  it("does not say nothing happened on the box when the kill's reply never arrived", async () => {
    /* The worst version of it. The dry run answered, the person read what it
       would kill, pressed yes — and then nothing came back. Thirty processes
       may be gone. "Nothing happened." is the sentence that sends them to press
       it again. */
    openActingBox(answersThenVanishes({ ok: true, op: "dry-run", dryRun: true, result: { candidates: [{ pid: 5001 }] } }), [
      KILL_SUITES_WIRE,
    ]);
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    expect(text).toContain("a second press is a NEW action");
    expect(text).toContain("said by this browser");
  });

  it("reads an answer whose body will not parse as unknown, in the client itself", async () => {
    /* DRIVEN THROUGH THE REAL CLIENT, and asserting the field rather than the
       words, because this is the branch a renderer test cannot pin: change
       `postJson`'s invalid-JSON arm to `none` and every rendering test above
       still passes, since none of them ever reaches it. */
    const outcome = await makeActionsApi(unreadableBody()).run(ROW, "continue");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.delivery.kind).toBe("unknown");
    expect(outcome.code).toBe("not-json");
    expect(outcome.from).toBe("client");
  });

  it("does not say nothing happened when the answer came back and would not parse", async () => {
    /* The same branch, on screen. A 500 with an HTML error page in it is the
       ordinary shape of this: the request unquestionably reached the server. */
    openActing(unreadableBody(), [REMOVE_WORKTREE_WIRE]);
    await act(async () => {});
    await clickSaying("Remove worktree");
    await clickSaying("Yes — remove worktree");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    expect(text).toContain("the body was not JSON");
  });

  it("does not say nothing happened on the box when the kill's answer would not parse", async () => {
    /* The second consumer of the same arm, so the box path is constrained too
       rather than inheriting the session page's guarantee. */
    openActingBox(answersThenGarbles({ ok: true, op: "dry-run", dryRun: true, result: { candidates: [{ pid: 5001 }] } }), [
      KILL_SUITES_WIRE,
    ]);
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    const text = container.textContent ?? "";
    expect(text).not.toContain("Nothing happened.");
    expect(text).not.toContain(KEYSTROKE_SENTENCE);
    expect(text).toContain(CANNOT_TELL_HEAD);
    expect(text).toContain("may have taken effect and it may not");
    /* The footer is what tells the two collapsed readings apart, so it has to
       carry the status. An answer arrived here — it just could not be read. */
    expect(text).toContain("HTTP 500");
  });

  it("reads a box answer whose body will not parse as unknown, in the client itself", async () => {
    const outcome = await makeActionsApi(unreadableBody()).box("kill-suites", false, []);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.delivery.kind).toBe("unknown");
    expect(outcome.code).toBe("not-json");
  });
});

describe("absent is not empty, on the two payloads that say what is waiting", () => {
  /* A HAND-WRITTEN PARSE OF AN `unknown` IS WHERE wire.ts CANNOT REACH. The
     compiler holds the shape on both sides of the boundary; it has no opinion
     about what a parser does with a key that is not there. So the rule has to
     be kept by hand at exactly this point, and the direction is always the
     same: a payload this page cannot read must not become a confident claim
     about the box.

     Flagged by `fleet-health-history` on 2026-09-08, who hit it in their own
     parser — a renamed `samples` key produced a perfectly valid EMPTY DAY. This
     file had the identical defect one field along from a long comment about the
     identical defect. */

  it("does not say 'Nothing is waiting' about a queue whose items it could not read", () => {
    const parsed = parseQueue({ sessionId: "$a", warning: "volatile", deliverable: 0 });
    expect(parsed).not.toBeNull();
    expect(parsed?.itemsUnreadable).toBe(true);
    /* The list is empty because there was nothing readable to put in it — which
       is exactly why `items.length === 0` must not be what the page reasons
       from. */
    expect(parsed?.items).toEqual([]);
  });

  it("reads a real queue as readable, so the flag is not simply always on", () => {
    const parsed = parseQueue({ sessionId: "$a", items: [], warning: "volatile", deliverable: 0 });
    expect(parsed?.itemsUnreadable).toBe(false);
    // And a genuinely empty queue is still genuinely empty.
    expect(parsed?.items).toEqual([]);
  });

  it("tells the reader it cannot say, rather than that nothing is waiting", async () => {
    const feed = manualTransport();
    const rec = recordingActions(() => ({
      actions: { session: [], box: [] },
      // A queue with no `items` key at all — the shape a rename produces.
      queues: [{ sessionId: "$1", warning: "volatile", deliverable: 0 }],
    }));
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "the one with an unreadable queue" })] })));
    openSession("the one with an unreadable queue");
    await act(async () => {});

    const text = container.textContent ?? "";
    expect(text).toContain("no list of items this page can read");
    expect(text).not.toContain("Nothing is waiting.");
  });
});

describe("the fixtures' own clock", () => {
  /* THIS EXISTS BECAUSE THE SAME BUG SHIPPED TWICE IN ONE DAY, IN THIS FILE,
     AND THREE SEPARATE SESSIONS TRIPPED OVER THE SECOND ONE.

     `state()` pinned `collectedAt` to the literal 2026-09-08T12:00:00Z and
     `messagesWire()` pinned `lastModified` to 11:59:30Z. Both meant "just now"
     on the morning they were written. At 12:02:30Z the first crossed the
     snapshot staleness threshold and three rendering tests began asserting that
     the page would not say STALE about a page correctly saying STALE; a few
     hours later the second crossed STALE_TRANSCRIPT_MS and did the same to the
     transcript warning. Neither is a flake — they are timers, and they only
     ever get worse.

     A fixture that means "fresh" has to be computed from the clock the
     component reads, because freshness is a relation between two times and an
     absolute constant can only ever be one of them. This test pins that
     property directly, so the next person who types a readable date into a
     default gets a red suite in seconds rather than a puzzling failure hours
     later in somebody else's branch.

     It deliberately does NOT police every date in the file. `startedAt` and a
     turn's `at` are compared against each other or rendered verbatim; they have
     no threshold to cross and pinning them is fine. Only the two that feed a
     staleness comparison are the hazard. */
  it("means NOW where a fixture means 'fresh', so the suite does not rot", () => {
    const minute = 60_000;

    const collectedAt = Date.parse(state().collectedAt ?? "");
    expect(Number.isFinite(collectedAt)).toBe(true);
    expect(Math.abs(Date.now() - collectedAt)).toBeLessThan(minute);

    const lastModified = Date.parse(String(messagesWire()["lastModified"]));
    expect(Number.isFinite(lastModified)).toBe(true);
    expect(Math.abs(Date.now() - lastModified)).toBeLessThan(minute);
  });
});

describe("why a session is paused, off the wire and on the page", () => {
  /* THE ONE THAT MATTERS. `none` is a positive claim — we looked everywhere we
     can look and this session is waiting for nothing — and a server that never
     sent the field has made no such claim. Reading silence as calm is instance
     16 of docs/postmortems/260908b, and on this page it would be the most
     reassuring possible lie: a rate-limited session does not resume by itself,
     so a row that looks calm and is actually blocked costs an hour of nothing.
     Measured: 111 minutes, on the morning of 2026-09-08. */
  it("reads an absent pause as 'could not tell', never as 'nothing is waiting'", () => {
    for (const absent of [undefined, null]) {
      const pause = parsePause(absent, CLOCK_SKEW_UNMEASURED);
      expect(pause.kind).toBe("cannot-tell");
      expect(pause.kind === "cannot-tell" && pause.why).toContain("did not say");
    }
  });

  it("refuses a rate limit with no reset time rather than drawing a badge over a gap", () => {
    /* An arm missing the field that makes it actionable is not that arm. The
       page can say "we could not tell"; it cannot say "back at undefined". */
    const pause = parsePause({ kind: "rate-limited", window: "five_hour" }, CLOCK_SKEW_UNMEASURED);
    expect(pause.kind).toBe("cannot-tell");
    const wakeup = parsePause({ kind: "scheduled-wakeup", overdue: true }, CLOCK_SKEW_UNMEASURED);
    expect(wakeup.kind).toBe("cannot-tell");
  });

  it("never computes `overdue` itself — it is the server's or it is false", () => {
    /* `overdue` may be set only when the reset time was actually READ, and this
       page cannot check that. A truthy-looking value that is not `true` is not
       the server saying so. */
    const yes = parsePause({ kind: "rate-limited", window: "five_hour", resetsAt: "2026-09-08T06:30:00Z", overdue: true }, CLOCK_SKEW_UNMEASURED);
    expect(yes.kind === "rate-limited" && yes.overdue).toBe(true);
    for (const fuzzy of ["true", 1, {}, undefined]) {
      const no = parsePause({ kind: "rate-limited", window: "five_hour", resetsAt: "2026-09-08T06:30:00Z", overdue: fuzzy }, CLOCK_SKEW_UNMEASURED);
      expect(no.kind === "rate-limited" && no.overdue).toBe(false);
    }
  });

  it("keeps an unfamiliar window name rather than dropping the state", () => {
    /* The usage cache carries rotating per-model codenames that appear and
       vanish without notice. A closed union here would compile an exhaustive
       switch that silently drops a real window. */
    const pause = parsePause({ kind: "rate-limited", window: "iguana_necktie", resetsAt: "2026-09-08T06:30:00Z" }, CLOCK_SKEW_UNMEASURED);
    expect(pause.kind === "rate-limited" && pause.window).toBe("iguana_necktie");
  });

  it("falls back rather than throwing on a pause kind this build has never heard of", () => {
    const pause = parsePause({ kind: "hibernating" }, CLOCK_SKEW_UNMEASURED);
    expect(pause.kind).toBe("cannot-tell");
    expect(pause.kind === "cannot-tell" && pause.why).toContain("hibernating");
  });

  it("draws nothing for `none`, and something for `cannot-tell`", () => {
    /* Backwards for about a second, and it is the whole design: `none` needs no
       line because the status pill already says what the session is doing;
       `cannot-tell` needs one because the calm on that row is not evidence. */
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            row({ id: "$quiet", title: "nothing waiting", pause: { kind: "none" } }),
            row({
              id: "$dunno",
              title: "could not look",
              pause: { kind: "cannot-tell", why: "the transcript tail ran out of window", cause: "tail-window-exhausted" },
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("waiting? unknown");
    expect(text).toContain("the transcript tail ran out of window");
  });

  it("does not say 'waiting? unknown' on a row that is visibly busy", () => {
    /* MEASURED ON THE LIVE BOX, 2026-09-08: 29 of 32 rows came back
       `cannot-tell`, most of them working sessions whose transcript tail ran out
       of window. A phrase on 29 of 32 cards is not a caveat, it is wallpaper —
       and the rate-limit collector reports `unknown` until 2026-09-12 while some
       unattributable rejections expire, so this is the common case this week
       rather than a rare one.

       The rule is the question itself: `Pause` answers "why is this session not
       doing anything", and on a row that IS doing something the question does
       not arise. But the POSITIVE states must still draw on a busy row — a
       session blocked in a shell call while the board says Working is the whole
       reason this stage exists. */
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    const dunno = {
      kind: "cannot-tell",
      why: "the transcript tail ran out of window",
      cause: "tail-window-exhausted",
    } as const;
    act(() =>
      feed.push(
        state({
          rows: [
            row({ id: "$busy", title: "busy and unexamined", status: { kind: "working" }, pause: dunno }),
            row({ id: "$sh", title: "a shell", status: { kind: "shell", busy: true }, pause: dunno }),
            row({ id: "$quiet", title: "quiet and unexamined", status: { kind: "idle" }, pause: dunno }),
            row({
              id: "$blocked",
              title: "working, and actually stuck",
              status: { kind: "working" },
              pause: { kind: "background-work", sinceMs: 21 * 60_000 },
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    // Once, for the quiet row — not three times.
    expect(text.split("waiting? unknown").length - 1).toBe(1);
    // And the positive state is drawn on a WORKING row, which is the point.
    expect(text).toContain("background work, 21m");
  });

  it("puts an overdue session in the loud colour and says how long it has been waiting", () => {
    /* Fable, 2026-09-08: a rate-limited session never resumes by itself, so
       overdue is deterministic rather than a guess — and it is the single most
       actionable thing this board can say. It is the only pause drawn loud. */
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            row({
              id: "$stuck",
              title: "blocked and nobody noticed",
              pause: {
                kind: "rate-limited",
                window: "five_hour",
                resetsAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
                overdue: true,
              },
            }),
            row({
              id: "$soon",
              title: "waiting, as intended",
              pause: { kind: "scheduled-wakeup", at: new Date(Date.now() + 40 * 60 * 1000).toISOString(), overdue: false, source: "cron" },
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("rate limited — overdue 1h 30m");
    expect(text).toContain("waking");

    /* The colour carries it too, and only for the overdue one — a session
       waiting until its wake-up time is working as intended and must not
       compete with the one that needs a person. */
    const loud = [...container.querySelectorAll(".tw\\:text-alarm-ink")].map((e) => e.textContent ?? "");
    expect(loud.some((t) => t.includes("overdue"))).toBe(true);
    expect(loud.some((t) => t.includes("waking"))).toBe(false);
  });
});

describe("renaming a session", () => {
  const NAMED = steerable({ id: "$1643", name: "worktree-fb1v", title: "the one with a bad name" });

  function openRename(rename: RenameApi): void {
    const feed = manualTransport();
    mountFull({ transport: feed.transport, rename });
    act(() => feed.push(state({ rows: [NAMED] })));
    openSession("the one with a bad name");
  }

  function nameBox(): HTMLInputElement {
    const el = container.querySelector<HTMLInputElement>("#rename-name");
    if (!el) throw new Error("no rename box on the page");
    return el;
  }

  function typeName(value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("this DOM has no HTMLInputElement value setter");
    const el = nameBox();
    act(() => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("starts from the name the session has", () => {
    openRename(fakeRename());
    expect(nameBox().value).toBe("worktree-fb1v");
  });

  it("sends the tmux handle, never the name — a name is not an address", async () => {
    /* **The REAL rename api, over a stubbed `fetch`.** A fake `RenameApi` here
       would be handed the row and could read `id` off it itself, so the test
       would pass over a `renameBody` that sent `row.name` — the seam would be
       right while the wire was wrong, which is the one thing this test's name
       claims to rule out. */
    const bodies: unknown[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({ ok: true, sessionId: "$1643", name: "socratic-eval", was: "worktree-fb1v" }),
      } as Response;
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", impl);

    openRename(makeRenameApi());
    typeName("socratic-eval");
    await clickSaying("Save");

    expect(bodies).toEqual([
      { url: "api/sessions/rename", body: { sessionId: "$1643", name: "socratic-eval" } },
    ]);
    expect(container.textContent).toContain("Renamed from");
  });

  it("builds the body off the row rather than off anything typed beside it", () => {
    expect(renameBody(NAMED, "socratic-eval")).toEqual({ sessionId: "$1643", name: "socratic-eval" });
  });

  it("keeps Save live when nothing has been edited, because re-saving is not a no-op", async () => {
    const calls: string[] = [];
    openRename({
      rename: async (_r, name) => {
        calls.push(name);
        return { ok: true, name, was: name };
      },
    });
    expect(buttonSaying("Save")?.disabled).toBe(false);
    await clickSaying("Save");
    expect(calls).toEqual(["worktree-fb1v"]);
    expect(container.textContent).toContain("it also stops the name being changed back later");
  });

  it("refuses a shape the rule plainly refuses, without a round trip", async () => {
    const calls: string[] = [];
    openRename({
      rename: async (_r, name) => {
        calls.push(name);
        return { ok: true, name, was: null };
      },
    });
    typeName("Worktree FB1V");
    expect(buttonSaying("Save")?.disabled).toBe(true);
    expect(container.textContent).toContain("Lower-case letters, digits and hyphens");
    // And it lets a legal one through again, rather than staying stuck.
    typeName("worktree-fb1v-2");
    expect(buttonSaying("Save")?.disabled).toBe(false);
    await clickSaying("Save");
    expect(calls).toEqual(["worktree-fb1v-2"]);
  });

  it("shows the server's refusal in the server's own words", async () => {
    openRename({
      rename: async () => ({
        ok: false,
        code: "name-taken",
        why: "the name socratic-eval already belongs to session $1701",
        status: 409,
        from: "server",
      }),
    });
    typeName("socratic-eval");
    await clickSaying("Save");
    expect(container.textContent).toContain("Not renamed.");
    expect(container.textContent).toContain("the name socratic-eval already belongs to session $1701");
  });

  it("suggests a refresh when the row turns out to be stale", async () => {
    openRename({
      rename: async () => ({
        ok: false,
        code: "no-such-session",
        why: "there is no session $1643 on this tmux server",
        status: 409,
        from: "server",
      }),
    });
    typeName("something-else");
    await clickSaying("Save");
    expect(container.textContent).toContain("Refresh and look again");
  });

  it("shows the name the server settled on, not the one that was typed", async () => {
    openRename({ rename: async () => ({ ok: true, name: "socratic-eval-2", was: "worktree-fb1v" }) });
    typeName("socratic-eval");
    await clickSaying("Save");
    expect(nameBox().value).toBe("socratic-eval-2");
  });

  it("knows the shape rule on its own", () => {
    expect(looksLikeAName("worktree-fb1v")).toBe(true);
    expect(looksLikeAName("9-lives")).toBe(true);
    expect(looksLikeAName("-leading-hyphen")).toBe(false);
    expect(looksLikeAName("Upper")).toBe(false);
    expect(looksLikeAName("has space")).toBe(false);
    expect(looksLikeAName("")).toBe(false);
    expect(looksLikeAName("a".repeat(41))).toBe(true);
    expect(looksLikeAName("a".repeat(42))).toBe(false);
  });

  it("posts to the rename route and nowhere else", async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({ ok: true, name: "x", was: "y" }),
      } as Response;
    }) as unknown as typeof fetch;
    await makeRenameApi(impl).rename(NAMED, "x");
    expect(calls).toEqual(["api/sessions/rename"]);
    expect(calls).not.toContain("api/state");
  });
});

/* ------------------------------------------------------------------ *
 * The attention inbox: the producer's ranked list, on the page.
 * ------------------------------------------------------------------ */

/** An item, with only the interesting field named at each call site. */
function attentionItem(over: Partial<AttentionItem> & { id: string }): AttentionItem {
  return {
    sessionId: `$${over.id}`,
    sessionName: over.id,
    waitingSince: new Date(Date.now() - 4 * 60_000).toISOString(),
    kind: "technical",
    evidence: { kind: "prose", excerpt: "Say the word and I'll drop it.", why: "it named an action and stopped" },
    answerability: { kind: "phone" },
    duplicates: [],
    ...over,
  };
}

function attentionList(over: Partial<Extract<AttentionList, { kind: "list" }>> = {}): AttentionList {
  return {
    kind: "list",
    items: [],
    sessionsScanned: 32,
    sessionsUnreadable: 0,
    scannedAt: new Date(Date.now() - 90_000).toISOString(),
    ...over,
  };
}

/** Mount the page with one attention feed on it, and hand back what it says. */
function showing(attention: FleetState["attention"]): string {
  const feed = manualTransport();
  mount(feed.transport);
  act(() => feed.push(state({ attention })));
  return container.textContent ?? "";
}

/** A published feed, with the checkpoint's own clock — a different one from the list's. */
function published(list: AttentionList, writtenAt: string = new Date().toISOString()): FleetState["attention"] {
  return { kind: "published", list, coordinatorWrittenAt: writtenAt };
}

/** How long ago, as an ISO string, for the two clocks this panel reads. */
function agoIso(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("the attention inbox, off the wire", () => {
  it("reads an ABSENT field as `not-asked` and a PRESENT broken one as unreadable", () => {
    /* The distinction the fifth arm exists for. The field was added without a
       schema bump, so a server built before it sends no `attention` at all and
       *did not look* is the truth about it. A field that IS there and will not
       parse is a server that did look and a page that cannot read the answer —
       calling that "nobody asked" would be false, and it draws nothing, which
       is worse than a line. GPT Sol's finding 4. */
    expect(parseAttention(undefined, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "not-asked" });
    expect(parseAttention({ kind: "not-asked" }, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "not-asked" });

    for (const raw of [null, "the coordinator is fine", 7, [], {}, { kind: "an-arm-from-2027" }]) {
      expect(parseAttention(raw, CLOCK_SKEW_UNMEASURED), JSON.stringify(raw)).toMatchObject({ kind: "feed-unreadable" });
    }
  });

  it("reads the two no-list arms as themselves, which are different facts", () => {
    expect(parseAttention({ kind: "checkpoint-absent" }, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "checkpoint-absent" });
    expect(parseAttention({ kind: "checkpoint-unreadable", why: "it is empty" }, CLOCK_SKEW_UNMEASURED)).toEqual({
      kind: "checkpoint-unreadable",
      why: "it is empty",
    });
    /* An unreadable with no reason is still an unreadable. The arm is the fact;
       the sentence is the courtesy. */
    expect(parseAttention({ kind: "checkpoint-unreadable" }, CLOCK_SKEW_UNMEASURED)).toMatchObject({ kind: "checkpoint-unreadable" });
  });

  it("reads a published list whole, in the producer's order", () => {
    const list = attentionList({
      items: [attentionItem({ id: "second-oldest" }), attentionItem({ id: "oldest" })],
    });
    const feed = parseAttention(published(list), CLOCK_SKEW_UNMEASURED);
    expect(feed.kind).toBe("published");
    if (feed.kind !== "published" || feed.list.kind !== "list") throw new Error("expected a published list");
    expect(feed.list.items.map((i) => i.sessionName)).toEqual(["second-oldest", "oldest"]);
  });

  it("refuses a published feed with no readable clock rather than inventing one", () => {
    /* Without it there is no age on the reading, and an inbox with no age is
       the failure this panel is about: a list that stopped being produced looks
       exactly like a calm fleet. `feed-unreadable` rather than `not-asked` —
       the server did look. */
    expect(parseAttention({ kind: "published", list: attentionList(), coordinatorWrittenAt: "8th Sept" }, CLOCK_SKEW_UNMEASURED)).toMatchObject(
      { kind: "feed-unreadable" },
    );
  });

  it("degrades a malformed list to `unknown` rather than to an empty one", () => {
    /* The same call the server-side reader makes, for the same reason: absent,
       malformed and *nothing needs you* are three different facts and only the
       third is a claim. The reason travels with it. */
    const writtenAt = new Date().toISOString();
    for (const list of [
      "not an object",
      { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0 },
      { kind: "list", items: {}, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: writtenAt },
      { kind: "list", items: [], sessionsScanned: -1, sessionsUnreadable: 0, scannedAt: writtenAt },
      { kind: "unknown", scannedAt: writtenAt },
      { kind: "brand-new-arm", scannedAt: writtenAt },
    ]) {
      const feed = parseAttention({ kind: "published", coordinatorWrittenAt: writtenAt, list }, CLOCK_SKEW_UNMEASURED);
      expect(feed, JSON.stringify(list)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    }
  });

  it("refuses a list with no `sessionsUnreadable`, because zero is a claim", () => {
    /* Zero says every judgement the pass attempted succeeded, which is the
       strongest claim the field can make — and a producer that never had the
       field made none at all. Reading the absence as zero is the very mistake
       the field exists to prevent, wearing the fix's name. Self-clearing: the
       pass runs every two minutes. Same refusal as tools/fleet/attention.ts. */
    const writtenAt = new Date().toISOString();
    const scannedAt = agoIso(90_000);
    const feed = parseAttention({
      kind: "published",
      coordinatorWrittenAt: writtenAt,
      list: { kind: "list", items: [], sessionsScanned: 32, scannedAt },
    }, CLOCK_SKEW_UNMEASURED);
    expect(feed).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    if (feed.kind !== "published" || feed.list.kind !== "unknown") return;
    expect(feed.list.why).toContain("completeness");
    expect(feed.list.scannedAt).toBe(scannedAt);
  });

  it("refuses a list that could not judge more sessions than it scanned", () => {
    /* Corruption rather than a reading: `sessionsUnreadable` counts sessions the
       pass TRIED to judge, so it is a subset of `sessionsScanned`. Refused
       rather than clamped because the panel subtracts one from the other to say
       how many WERE judged, and a negative there would be printed. The server's
       reader makes the same refusal, and both are needed — this page may be
       older or newer than the server it is reading. GPT Sol's C1. */
    const feed = parseAttention(
      published(attentionList({ items: [], sessionsScanned: 3, sessionsUnreadable: 4 })),
      CLOCK_SKEW_UNMEASURED,
    );
    expect(feed).toMatchObject({ kind: "published", list: { kind: "unknown" } });
    if (feed.kind !== "published" || feed.list.kind !== "unknown") return;
    expect(feed.list.why).toContain("more than it scanned");
  });

  it("refuses a BLANK string wherever a card would draw one, not just a missing one", () => {
    /* `""` passed a `typeof` check, so `{kind: "dialog", question: "",
       options: []}` reached the renderer under the mechanical, observed heading
       with nothing in it — the exact value wire.ts names as the one that must
       not cross. Whitespace counts: on screen it is the same thing. The other
       parsers cover missing fields; these are the present-and-empty ones.
       GPT Sol's C4. */
    for (const item of [
      { id: "" },
      { id: "x", sessionId: "   " },
      { id: "x", sessionName: "" },
      { id: "x", evidence: { kind: "dialog", question: "", options: [] } },
      { id: "x", evidence: { kind: "dialog", question: "Drop it?", options: ["Yes", " "] } },
      { id: "x", evidence: { kind: "prose", excerpt: "", why: "it stopped" } },
      { id: "x", evidence: { kind: "prose", excerpt: "…and stopped", why: "" } },
      { id: "x", duplicates: [{ sessionId: "", sessionName: "n", waitingSince: agoIso(60_000) }] },
      { id: "x", duplicates: [{ sessionId: "$9", sessionName: "", waitingSince: agoIso(60_000) }] },
    ] as Partial<AttentionItem>[]) {
      const list = attentionList({ items: [attentionItem({ id: "x" })] });
      const wire = JSON.parse(JSON.stringify(published(list))) as { list: { items: Record<string, unknown>[] } };
      const first = wire.list.items[0];
      if (first === undefined) throw new Error("the fixture lost its item");
      Object.assign(first, item);
      expect(parseAttention(wire, CLOCK_SKEW_UNMEASURED), JSON.stringify(item)).toMatchObject({
        kind: "published",
        list: { kind: "unknown" },
      });
    }
  });

  it("degrades the WHOLE list when one item will not parse", () => {
    /* Not "drop it and count", which is what `rows` gets. An inbox of 4 out of 5
       says *these are the ones that need you* and is then wrong about the fifth
       — a short inbox is a negative claim about everything not in it. */
    const list = attentionList({ items: [attentionItem({ id: "fine" })] });
    const wire = JSON.parse(JSON.stringify(published(list))) as { list: { items: unknown[] } };
    wire.list.items.push({ id: "half-a-card", sessionId: "$9" });
    expect(parseAttention(wire, CLOCK_SKEW_UNMEASURED)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
  });

  it("refuses a dialog with no question, so it cannot arrive wearing the observed arm", () => {
    /* The one boundary the whole inbox is built to hold. `dialog` means the
       harness SAW a dialog and enumerated it; a half-built one crossing here
       would be drawn as something observed. GPT Sol's finding against the
       store's first parser, on this side of the wire. */
    const list = attentionList({
      items: [attentionItem({ id: "x", evidence: { kind: "dialog", question: "Drop it?", options: ["Yes"] } })],
    });
    const wire = JSON.parse(JSON.stringify(published(list))) as { list: { items: { evidence: unknown }[] } };
    const first = wire.list.items[0];
    if (first === undefined) throw new Error("the fixture lost its item");
    first.evidence = { kind: "dialog" };
    expect(parseAttention(wire, CLOCK_SKEW_UNMEASURED)).toMatchObject({ kind: "published", list: { kind: "unknown" } });
  });

  it("never fails the whole payload over a bad inbox", () => {
    /* The session list is the more important half. A page that went blank on a
       malformed field would have stopped saying what is running on the box. */
    const read = parseFleetState({ schema: 1, rows: [], attention: { kind: "published", list: 7 } }, Date.now());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.state.attention).toMatchObject({ kind: "feed-unreadable" });
  });
});

describe("the attention inbox, on the page", () => {
  it("draws nothing at all when the server did not look", () => {
    const text = showing({ kind: "not-asked" });
    expect(text).not.toContain("waiting on you");
    expect(text).not.toContain("checkpoint");
    expect(text).not.toContain("no ranked list");
  });

  it("says no checkpoint was published, without claiming the coordinator is down", () => {
    const text = showing({ kind: "checkpoint-absent" });
    expect(text).toContain("no Overseer checkpoint has been published here");
    /* NOT "the coordinator is not running": an absent file proves only that
       nothing was published at the path we looked at. */
    expect(text).not.toContain("is not running");
    /* THE DISTINCTION THE ARM EXISTS FOR. It must never read as a calm fleet. */
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("says the published inbox could not be read, with the reason one tap away", () => {
    const text = showing({ kind: "checkpoint-unreadable", why: "current.json is not JSON: unexpected token" });
    expect(text).toContain("could not be read");
    /* `Explain` writes the same sentence into an sr-only span, so the reason is
       on the page for a screen reader and for this test without a pointer. It is
       a component's fault rather than an agent's, so it changes what you would
       BELIEVE rather than what you would do — one tap away is where it belongs. */
    expect(text).toContain("unexpected token");
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("says when the page itself could not read what the server sent", () => {
    /* The fifth state, and it is about this build rather than about the box —
       so it says reload rather than saying anything about the fleet. */
    const text = showing({ kind: "feed-unreadable", why: "this page does not know the inbox \"v2\"" });
    expect(text).toContain("this page could not read the inbox");
    expect(text).toContain("reload");
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("puts an `unknown` list's own reason ON SCREEN, because the three cases differ in what you do", () => {
    /* `unknown` arrives from three places — no pass has run yet, a pass ran and
       failed, a stored list was unreadable — and the producer keeps them as one
       arm on purpose, because what it means is *nobody can tell you*. But "no
       pass has run yet" means wait and "the gateway returned 429" means go and
       look, and that is a difference in what you do in the next ten seconds. So
       the producer's sentence is the line, not a label with the sentence behind
       a disclosure. */
    const noPassYet = showing(
      published({
        kind: "unknown",
        why: "no attention pass has run in this Overseer yet, so nothing has been looked at.",
        scannedAt: new Date().toISOString(),
      }),
    );
    expect(noPassYet).toContain("no ranked list");
    expect(noPassYet).toContain("no attention pass has run in this Overseer yet");
    expect(noPassYet).not.toContain("nothing is waiting on you");

    const itFailed = showing(
      published({
        kind: "unknown",
        why: "the gateway returned 429 before anything was judged",
        scannedAt: new Date().toISOString(),
      }),
    );
    expect(itFailed).toContain("the gateway returned 429 before anything was judged");
  });

  it("says nothing is waiting only with both counts and both clocks behind it", () => {
    const text = showing(published(attentionList({ items: [], sessionsScanned: 32 })));
    expect(text).toContain("nothing is waiting on you");
    /* **HOW MANY AND WHEN, always.** "Nothing needs you" out of 32 sessions and
       out of 2 are different facts, and the scan's age is the one this panel
       must never hide: the pass costs model calls and runs every two minutes, so
       a list that stopped being produced looks exactly like a calm fleet. */
    expect(text).toContain("32 sessions");
    expect(text).toContain("scanned 1m 30s ago");
  });

  it("lets a stale scan REPLACE the reassurance rather than qualify it", () => {
    /* GPT Sol's finding 8. `published` means published at some time, not
       currently, and "nothing is waiting on you" with a caveat under it is read
       as "nothing is waiting on you" — the caveat is the half a reader skips. */
    const text = showing(
      published(attentionList({ items: [], sessionsScanned: 32, scannedAt: agoIso(20 * 60_000) })),
    );
    expect(text).toContain("the attention pass last ran");
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("treats a badly future timestamp as unreadable rather than as freshly scanned", () => {
    /* **A FUTURE `scannedAt` USED TO READ AS "0s ago" FOREVER.** `ageMs` clamped
       with `Math.max(0, …)`, so a clock that ran ahead suppressed the staleness
       branch for exactly as long as the fault lasted, and an empty list looked
       permanently calm — the failure this panel exists to prevent, arriving
       through the one number it trusts. GPT Sol's C2.

       Ten minutes ahead is past any plausible phone skew, so the page cannot use
       the timestamp and must say so rather than treat it as fresh. */
    const text = showing(
      published(attentionList({ items: [], sessionsScanned: 32, scannedAt: agoIso(-10 * 60_000) })),
    );
    expect(text).not.toContain("nothing is waiting on you");
    expect(text).toContain("at a time this page could not read");
  });

  it("refuses a timestamp half a minute ahead, now that the clocks have been reconciled", () => {
    /* **THIS TEST USED TO ASSERT THE OPPOSITE, AND THE CHANGE IS v0.4j.** It
       read *lets a SMALL future timestamp pass, because the phone's clock is
       not the box's*, and it was right while the two clocks were genuinely
       different: the panel carried a flat `CLOCK_SKEW_MS = 2 * 60_000` so that
       an ordinary fast phone did not manufacture an alarm. Every server
       timestamp now arrives already converted into this browser's terms
       (types.ts § `ClockSkew`), so thirty seconds of remaining future is not a
       phone — it is a clock that is actually wrong, and tolerating it would
       swallow the fault the panel exists to show. */
    const text = showing(
      published(attentionList({ items: [], sessionsScanned: 32, scannedAt: agoIso(-30_000) })),
    );
    expect(text).not.toContain("nothing is waiting on you");
    expect(text).toContain("at a time this page could not read");
  });

  it("does not call a fresh checkpoint unreadable because the page's own clock was asleep", () => {
    /* **THE SLACK CONSTANT IS GONE, AND THIS IS THE CASE NO VALUE OF IT COULD
       HAVE COVERED.** It was five seconds, justified by `useNow` ticking once a
       second — but a phone in a pocket has its timers throttled and then
       suspended, and iOS hands the tab back by starting a refresh immediately.
       So the payload below is judged against a `now` a minute old, and a
       blocked main thread does the same thing without any tab switching. The
       old constant turned that into *"at a time this page could not read"* on a
       checkpoint written the instant it was served: the alarm-a-clock-
       manufactures failure, one clock further in.

       What replaces it is an anchor rather than a tolerance —
       `Math.max(now, receivedAt)`, a browser-clock reading that cannot be older
       than the payload it is judging. GPT Sol's K2, 2026-09-08. */
    const feed = manualTransport();
    mount(feed.transport);
    /* A minute asleep. `Date.now` is mocked AFTER the mount, so `useNow`'s
       state keeps the old reading — which is exactly what a throttled timer
       does — while `receivedAt` is stamped at the moment the answer arrives. */
    const wokeAt = Date.now() + 60_000;
    vi.spyOn(Date, "now").mockReturnValue(wokeAt);
    const justNow = new Date(wokeAt).toISOString();
    act(() => feed.push(state({ attention: published(attentionList({ scannedAt: justNow }), justNow) })));
    const text = container.textContent ?? "";
    expect(text).toContain("nothing is waiting on you");
    expect(text).not.toContain("at a time this page could not read");
  });

  it("tells a stopped daemon apart from a stopped pass, because they are different faults", () => {
    /* The two clocks fail independently: `coordinatorWrittenAt` moves every ~30s
       whether or not the pass ran, `scannedAt` only when the paid pass runs. A
       panel reading one of them would call the other one calm. */
    const text = showing(
      published(attentionList({ items: [], sessionsScanned: 32, scannedAt: agoIso(20 * 60_000) }), agoIso(20 * 60_000)),
    );
    expect(text).toContain("the Overseer stopped checkpointing");
    expect(text).not.toContain("the attention pass last ran");
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("will not call an INCOMPLETE empty pass a calm fleet", () => {
    /* **THE WORST OF the C7 review's findings, GPT Sol 2026-09-08.** Agreement
       (c) was implemented for the items-present branch only, and this branch
       never looked at `sessionsUnreadable` at all — so a pass that judged 31
       sessions, failed on 1, and found nothing drew "nothing is waiting on you ·
       32 sessions", which is the one claim the floor caveat exists to withhold.

       The state is NOT rejected — *we judged 31, none of them needs you, and 1
       we could not read* is true and useful — it is rendered honestly, and it
       REPLACES the reassurance rather than qualifying it, because a sentence
       with a caveat under it is read as the sentence. */
    const text = showing(
      published(attentionList({ items: [], sessionsScanned: 32, sessionsUnreadable: 1 })),
    );
    expect(text).not.toContain("nothing is waiting on you");
    expect(text).toContain("nothing among the 31 we could judge is waiting on you");
    expect(text).toContain("1 of 32 could not be judged");
    /* The scan's age survives into this arm too: an incomplete pass that is also
       twenty minutes old is two facts, not one. */
    expect(text).toContain("scanned 1m 30s ago");
  });

  it("calls zero sessions scanned a broken probe rather than a quiet fleet", () => {
    const text = showing(published(attentionList({ items: [], sessionsScanned: 0 })));
    expect(text).toContain("broken probe");
    expect(text).not.toContain("nothing is waiting on you");
  });

  it("draws a card each, in the producer's order, and does not re-sort", () => {
    /* Agreement (b). The producer ranks by consequence and then by how long it
       has waited; this fixture is deliberately in the order NEITHER of those
       local rules would produce — the technical one is first and it is also the
       newest — so a renderer that sorted by anything at all would flip it. */
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          attention: published(
            attentionList({
              items: [
                attentionItem({
                  id: "newest-and-technical",
                  kind: "technical",
                  waitingSince: agoIso(60_000),
                }),
                attentionItem({
                  id: "oldest-and-irreversible",
                  kind: "irreversible",
                  waitingSince: agoIso(3 * 3600_000),
                }),
              ],
            }),
          ),
        }),
      ),
    );
    expect(titlesOnScreen()).toEqual(["newest-and-technical", "oldest-and-irreversible"]);
    expect(container.textContent).toContain("2 waiting on you");
    expect(container.textContent).toContain("waiting 1m");
    expect(container.textContent).toContain("waiting 3h");
  });

  it("renders a dialog's question and options as text, with no way to answer them here", () => {
    /* Agreement (a): no answer control on any card in v1. A `prose` item is
       inferred from a pane tail, and the producer's own `readTurnTail` bug
       proved a card could quote Greg's last message back as an agent's
       question — so a button beside one would have acted on his own sentence.
       The same rule covers `dialog`, because the detail pane is where a dialog
       is answered with the material it would approve drawn beside it. */
    const text = showing(
      published(
        attentionList({
          items: [
            attentionItem({
              id: "schema-move",
              evidence: { kind: "dialog", question: "Drop the sessions table?", options: ["Yes, drop it", "No"] },
            }),
          ],
        }),
      ),
    );
    expect(text).toContain("Drop the sessions table?");
    expect(text).toContain("Yes, drop it");
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.some((b) => b.includes("Yes, drop it"))).toBe(false);
  });

  it("leads a prose item with the `why` and puts the excerpt behind a disclosure", () => {
    /* **THE CARD IS INVERTED FROM HOW IT WAS FIRST BUILT, and live data decided
       it.** On 2026-09-08 the real list carried two `prose` items whose excerpts
       were 1,116 and 1,736 characters — 17 and 21 lines, one of them a table of
       process states. Rendered in the flow, one card is 21 lines tall on a 390px
       phone and the second item is off the bottom of the screen.

       The `why` is one human-written sentence and is what a person acts on; the
       excerpt is what they check the inference against, which changes what they
       would BELIEVE rather than what they would do in the next ten seconds.
       This fixture is the real one, whitespace and all. */
    const excerpt = [
      "               my stuff                state        RSS",
      "    Supabase stack (12 containers)   up           ~382 MB",
      "    Flask :3000                      listening    —",
      "",
      "  Say the word and I'll shut it down.",
    ].join("\n");
    const text = showing(
      published(
        attentionList({
          items: [
            attentionItem({
              id: "gjd-remote",
              evidence: {
                kind: "prose",
                excerpt,
                why: "The agent says the stack is idle and explicitly waits for the person to say whether it should shut down.",
              },
            }),
          ],
        }),
      ),
    );
    expect(text).toContain("The agent says the stack is idle and explicitly waits");
    expect(text).toContain("inferred from its last turn");
    expect(text).toContain("show the last 5 lines of its screen");

    /* **NOT PRESENTED AS A QUOTATION.** The producer picks the excerpt by
       POSITION in the pane rather than by whether it contains the sentence the
       `why` is about — which is why the live item this fixture is copied from
       has a table of process states under a claim about what its agent said,
       with a correct `why`. An unlabelled excerpt that does not contain the
       relevant sentence teaches a reader to distrust a `why` that was right, so
       the disclosure says what the text actually is. The hedge is on the
       excerpt and never on the `why`. */
    expect(text).toContain("taken by position rather than by search");
    expect(text).not.toContain("may not be true");

    /* Behind the disclosure, in a `<pre>` — not merely present somewhere. A
       test that only asserted on `textContent` would pass just as happily with
       21 lines of terminal output in the flow, which is the layout this
       inversion exists to prevent. */
    const pre = container.querySelector("details pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("Supabase stack (12 containers)");
    /* And the whitespace survives, because it is a table. */
    expect(pre?.textContent).toContain("               my stuff");
  });

  it("reads the count as a floor when something could not be judged, and is silent when nothing was", () => {
    /* Agreement (c). The count is a floor and the retraction is its own quiet
       line — a sentence and its retraction in the same block is worse than
       either — and it renders ONLY when non-zero, or it becomes the wallpaper
       PauseLine.tsx measured 29 of 32 rows carrying. */
    const withUnreadable = showing(
      published(attentionList({ items: [attentionItem({ id: "one" })], sessionsScanned: 32, sessionsUnreadable: 1 })),
    );
    expect(withUnreadable).toContain("at least 1 waiting on you");
    expect(withUnreadable).toContain("1 of 32 could not be judged, so there may be more");

    const clean = showing(
      published(attentionList({ items: [attentionItem({ id: "one" })], sessionsScanned: 32, sessionsUnreadable: 0 })),
    );
    expect(clean).toContain("1 waiting on you");
    expect(clean).not.toContain("at least");
    expect(clean).not.toContain("could not be judged");
  });

  it("selects the session when a card is tapped, rather than adding a second write path", () => {
    const feed = manualTransport();
    mount(feed.transport);
    act(() =>
      feed.push(
        state({
          attention: published(attentionList({ items: [attentionItem({ id: "worktree-x", sessionId: "$1643" })] })),
        }),
      ),
    );
    openSession("worktree-x");
    /* The SAME hash parameter the list writes, so the existing SessionDetail
       machinery does the answering. Nothing new writes to the box. */
    expect(window.location.hash).toBe("#sessions?sel=%241643");
  });
});

describe("the composer production uses turns a checkpoint on disk into a question on screen", () => {
  /**
   * **THE DETECTOR FOR THE CLASS OF BUG THIS STAGE FIXED**, and it is one test
   * on purpose.
   *
   * Both halves of this were built, reviewed and tested on 2026-09-08, and
   * nothing joined them: the attention pass had been publishing a ranked list
   * for hours and `grep -rln "Checkpoint" tools/fleet/` found nothing. That is
   * Class A of docs/postmortems/260908b — *the edge does not exist, and no type
   * can express "somebody must call this"* — so the check has to be a question
   * about the graph rather than about either end: **who reads this?**
   *
   * **It drives `statePayload`, which is the whole reason that function was
   * moved out of server.ts.** An earlier version of this test called
   * `readCheckpointFeeds` and `fleetState` itself, and that is green-by-construction:
   * it had rebuilt the missing edge inside the test, so it would have stayed
   * green after production stopped making it. GPT Sol's sharpest finding on this
   * stage. `server.ts` binds ports at import time and can never be imported, so
   * the composition had to come out of it for anything to be able to check it —
   * the same move `health-wiring.ts` made, for the same reason.
   *
   * Nothing below is faked. A real checkpoint is written to a real directory,
   * `statePayload` composes the bytes production composes, `parseFleetState` is
   * the browser, and the assertion is on text in the DOM. Four separate
   * mutations — the server-side read, the payload field, the client parse, the
   * panel render — each turned THIS assertion red, and each file was restored
   * byte-identical afterwards.
   *
   * ## THE ONE EDGE IT DOES NOT COVER, and what does cover it
   *
   * **This test supplies `readCheckpointFeeds` itself**, so `server.ts`'s own binding
   * of it into `PayloadDeps` is outside the boundary — the test would stay green
   * if that line were deleted. It used to be named as though it were not, which
   * is why the name is now the composer rather than "the join". Renaming it was
   * the fix rather than chasing the edge, and deliberately (GPT Sol's C5,
   * answered 2026-09-08):
   *
   * `server.ts` binds ports at import time, which is the whole reason `state.ts`
   * exists. Extracting its deps construction only MOVES the seam — there is
   * always a last edge at the composition root that no test reaches without
   * starting a server. What closes the missing-join risk there is not a test but
   * the **type**: `readCheckpoint` is a required field of `PayloadDeps`, so
   * omitting it is a typecheck failure rather than a page that quietly draws
   * nothing. A deliberate stub would still compile — but *somebody wired the
   * wrong thing on purpose* is a different and far smaller class than *nobody
   * remembered to wire it at all*, which is the class this stage was about.
   *
   * **And `textContent` survives CSS**, so what is asserted below is that the
   * text is in the DOM and not that a person can see it — a rule that hid the
   * panel would leave this green. That is structural on purpose; whether it is
   * legible on a 390px phone is the browser pass, which is where the evidence
   * disclosure's own pointer bug was found and where no unit test could have.
   */
  it("turns a real checkpoint into a question on screen, through `statePayload`", () => {
    const root = mkdtempSync(join(tmpdir(), "fleet-web-attention-join-"));
    try {
      writeFileSync(
        join(root, "current.json"),
        `${JSON.stringify({
          schema: 2,
          writtenAt: new Date().toISOString(),
          lastGoodSnapshotAt: null,
          cursor: { events: 1, bytes: 2 },
          heartbeat: { pid: 1, instanceId: "i", startedAt: new Date().toISOString(), lastTickAt: null, ticks: 1 },
          register: [],
          attention: {
            kind: "list",
            items: [
              {
                id: "join-1",
                sessionId: "$1643",
                sessionName: "worktree-schema-move",
                waitingSince: agoIso(7 * 60_000),
                kind: "irreversible",
                evidence: {
                  kind: "dialog",
                  question: "Shall I drop the sessions table and re-run the migration?",
                  options: ["Yes", "No, stop"],
                },
                answerability: { kind: "phone" },
                duplicates: [],
              },
            ],
            sessionsScanned: 32,
            sessionsUnreadable: 0,
            scannedAt: agoIso(30_000),
          },
          usage: { kind: "none", why: "none", at: new Date().toISOString() },
        })}\n`,
        "utf8",
      );

      /* THE FUNCTION PRODUCTION GOES THROUGH. `statePayload()` in server.ts is
         one call to this with the same shape of deps; the only difference is
         which directory the reader is pointed at. */
      const payload = JSON.parse(
        statePayload({
          snapshot: null,
          error: null,
          health: null,
          refreshMs: 60_000,
          answeringEnabled: true,
          attemptedAt: null,
          readCheckpoint: () => readCheckpointFeeds(root),
        }),
      ) as unknown;

      const read = parseFleetState(payload, Date.now());
      expect(read.ok, read.ok ? "" : read.why).toBe(true);
      if (!read.ok) return;

      const feed = manualTransport();
      mount(feed.transport);
      act(() => feed.push(read.state));

      /* THE ASSERTION THAT MUST BE THE ONE THAT BREAKS. Everything above it is
         setup that succeeds under all four mutations; this is the sentence a
         person reads off the page, and it exists nowhere between here and the
         bytes on disk except by the edges being joined. */
      expect(container.textContent).toContain("Shall I drop the sessions table and re-run the migration?");
      expect(container.textContent).toContain("worktree-schema-move");
      expect(container.textContent).toContain("1 waiting on you");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ==========================================================================
   Stage v0.8b — the four fields the server sent and this page dropped.

   Each of these is a LOSSY JOIN: the edge existed, the consumer dropped the
   value, and both ends were internally consistent so nothing could go red.
   `FleetState` deriving from `wire.ts` makes the drop un-writable; it cannot
   make the value get READ, which is what this block is for. Every assertion
   below is on a sentence a person reads off the page.
   docs/postmortems/260908b, and § Stage v0.8a of the plan.
   ========================================================================== */

describe("answeringEnabled, told rather than discovered by tapping", () => {
  it("keeps four answers apart, and rounds none of them up to a yes", () => {
    expect(wire({ answeringEnabled: true }).answeringEnabled).toEqual({ kind: "enabled" });
    expect(wire({ answeringEnabled: false }).answeringEnabled).toEqual({ kind: "disabled" });
    /* THE TWO THAT ARE NEITHER, and the reason this is not a boolean. A server
       built before the flag sends nothing; a server sending nonsense has said
       something this build cannot read. They are different things to go and
       check, so they stay apart — and NEITHER is permission (GPT Sol's M3: the
       kill switch predates the field, so silence is consistent with the hold
       being on). */
    expect(wire({}).answeringEnabled).toEqual({ kind: "not-reported" });
    const unreadable = malformed({ answeringEnabled: "yes" }).answeringEnabled;
    expect(unreadable.kind).toBe("unreadable");
    /* A malformed value USED to become `null` and therefore permission to draw
       the control — the fail-open path, arriving through the arm meant for an
       older server. */
    expect(malformed({ answeringEnabled: null }).answeringEnabled.kind).toBe("unreadable");
    expect(malformed({ answeringEnabled: 1 }).answeringEnabled.kind).toBe("unreadable");
  });

  it("says answering is off BEFORE anybody taps, and withholds the buttons", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    /* The positive control first, and it is the half that matters: with the
       flag ON the same row is answerable, so a build that simply stopped
       offering answers would fail here rather than passing the test below. */
    act(() =>
      feed.push(
        state({
          answeringEnabled: { kind: "enabled" },
          rows: [
            steerable({
              id: "$a",
              title: "an agent asking",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("an agent asking");
    expect(container.querySelectorAll("button.answer").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("Answering is switched off");

    act(() =>
      feed.push(
        state({
          answeringEnabled: { kind: "disabled" },
          rows: [
            steerable({
              id: "$a",
              title: "an agent asking",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    const text = container.textContent ?? "";
    /* The whole point of the hold is that a person should not tap: the page was
       being told this and dropping it, so a reader tapped and got a 503. */
    expect(text).toContain("Answering is switched off on this server");
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
    /* And the composer is untouched — sending a message is unaffected by the
       hold, which is a distinction the page draws rather than leaving to be
       discovered. */
    expect(container.querySelector<HTMLTextAreaElement>("#steer-text")?.disabled).toBe(false);
  });

  /**
   * **THE ARM THAT REVERSED, AND WHY.**
   *
   * This test used to be called *"still offers the buttons when the server never
   * said, rather than inventing a hold"*, and it asserted the opposite of what
   * it asserts now. My reasoning was that refusing on silence would invent a
   * hold nobody declared. GPT Sol's M3 corrected it on a fact rather than a
   * preference: **the kill switch predates the state field in history**, so a
   * server old enough not to send this is a server that can have answering
   * switched off with no way to say so. Silence is therefore not evidence that
   * answering works, and this is the one control where acting on that costs a
   * person a 503 and costs the hold its whole purpose.
   *
   * The page says the third thing rather than picking one of the first two: the
   * sentence must not read as *a hold was declared*, because none was.
   */
  it("withholds the buttons when the server never said, without claiming a hold", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          answeringEnabled: { kind: "not-reported" },
          rows: [
            steerable({
              id: "$a",
              title: "an old server's row",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("an old server's row");
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
    const text = container.textContent ?? "";
    expect(text).toContain("could not be established");
    /* NOT the declared-hold sentence: nobody switched anything off, and saying
       they did would be a claim about the box made off an absence. */
    expect(text).not.toContain("Answering is switched off");
    /* And the composer is untouched, exactly as under a declared hold. */
    expect(container.querySelector<HTMLTextAreaElement>("#steer-text")?.disabled).toBe(false);
  });

  it("keeps 'never said' apart from 'said something unreadable' on the page", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          answeringEnabled: { kind: "unreadable", why: 'the server sent "yes" where this page reads true or false' },
          rows: [
            steerable({
              id: "$a",
              title: "a garbled row",
              status: { kind: "needs-you" },
              question: question({ gate: { kind: "conversation" } }),
            }),
          ],
        }),
      ),
    );
    openSession("a garbled row");
    const text = container.textContent ?? "";
    expect(container.querySelectorAll("button.answer")).toHaveLength(0);
    /* The server's own unreadable value, quoted, because "we could not read it"
       and "it did not say" send a reader to two different places. */
    expect(text).toContain("could not be read");
    expect(text).toContain('"yes"');
    expect(text).not.toContain("did not say whether answering is switched on");
  });
});

describe("attemptedAt — a loop that stopped, apart from a run that hung", () => {
  /**
   * **THE LOSSY JOIN THAT WAS DECLINED, AND THE DIAGNOSTIC IT COST.**
   *
   * The client named `attemptedAt` in its `Omit<>` and read nothing, on the
   * reasoning that `readAttemptClock` is a runtime value and so could not be
   * shared with a browser project. It is not: what that project cannot tolerate
   * is a NODE dependency. So the helper moved to `tools/fleet/attempt-clock.ts`,
   * a leaf with no imports, and both sides import the one implementation rather
   * than growing a second hand-written three-arm parse. GPT Sol's M5.
   *
   * The fault it restores is the one v0.4j leaned on: a collection that never
   * settles throws nothing, so `error` stays null and the masthead reads calm
   * while `collectedAt` goes thirty minutes stale.
   */
  it("reads the three arms off a real payload, not off a hand-built fixture", () => {
    /* THROUGH `parseFleetState`, because that is the path a payload takes and
       the shape of the reading is decided there. */
    const collectedAt = "2026-09-08T12:00:00Z";
    expect(wire({ collectedAt, attemptedAt: "2026-09-08T12:09:00Z" }).attemptedAt).toEqual({
      kind: "attempted",
      /* Verbatim: `wire()` supplies no `servedAt`, so the skew is unmeasured and
         the correction is zero rather than a guess. See `ClockSkew`. */
      at: "2026-09-08T12:09:00Z",
    });
    /* A server too old to report it, which must NEVER read as "never attempted"
       — that would print "wedged" over every older server. `collectedAt` is what
       separates the two, and it is the whole inference. */
    expect(wire({ collectedAt }).attemptedAt.kind).toBe("not-reported");
    /* Neither: nothing has ever arrived and nothing has ever been started, and a
       consumer does the same thing about both. */
    expect(wire({ collectedAt: null }).attemptedAt).toEqual({ kind: "never-attempted" });
  });

  it("shifts the attempt clock onto this browser's clock, like every other timestamp", () => {
    /* A phone whose clock is three minutes behind the box's. The reading has to
       arrive already corrected, because what it is compared against downstream
       is `useNow()` — mixing the two clocks is what held the STALE banner on
       permanently before v0.4j. */
    const receivedAt = Date.parse("2026-09-08T12:00:00Z");
    const read = parseFleetState(
      {
        schema: 1,
        rows: [],
        /* `toISOString()` form exactly: `readClockSkew` refuses anything else
           rather than letting a loose parse shift the whole page by years. */
        servedAt: "2026-09-08T12:03:00.000Z",
        collectedAt: "2026-09-08T11:50:00Z",
        attemptedAt: "2026-09-08T12:02:00Z",
      },
      receivedAt,
    );
    if (!read.ok) throw new Error(read.why);
    const clock = read.state.attemptedAt;
    expect(clock.kind).toBe("attempted");
    if (clock.kind !== "attempted") throw new Error("unreachable");
    expect(Date.parse(clock.at)).toBe(Date.parse("2026-09-08T11:59:00Z"));
  });

  it("says WHICH kind of stale a stale snapshot is", () => {
    const now = Date.parse("2026-09-08T12:10:00Z");
    const stale = { collectedAt: "2026-09-08T12:00:00Z" };

    /* A run that began after the last success and has not come back. This is the
       silent stall: `error` is null and every other line on the masthead is
       calm, so without this sentence a wedged collector reads as a quiet box. */
    const hung = freshness({
      state: state({ ...stale, attemptedAt: { kind: "attempted", at: "2026-09-08T12:08:00Z" } }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(hung.stale).toBe(true);
    expect(hung.why).toContain("has not finished");

    /* Nothing has been started since the last success: the loop itself is gone,
       which is a different thing to go and look at. */
    const stopped = freshness({
      state: state({ ...stale, attemptedAt: { kind: "attempted", at: "2026-09-08T11:59:00Z" } }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(stopped.why).toContain("the loop itself has stopped");
    expect(stopped.why).not.toContain("has not finished");

    /* And a server that does not report it says so, rather than being reported
       as permanently wedged. */
    const silent = freshness({
      state: state({ ...stale, attemptedAt: { kind: "not-reported", why: "this server does not report it" } }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(silent.why).toContain("cannot be told");
    expect(silent.why).not.toContain("has not finished");
    expect(silent.why).not.toContain("the loop itself has stopped");
  });

  it("says nothing about attempts on a snapshot that is not stale", () => {
    /* Fable's rule: a caveat stays on screen only if it would change what you do
       in the next ten seconds. On a fresh snapshot there is nothing to diagnose. */
    const now = Date.now();
    const fresh = freshness({
      state: state({ attemptedAt: { kind: "attempted", at: new Date(now).toISOString() } }),
      receivedAt: now,
      error: null,
      failures: 0,
      now,
    });
    expect(fresh.stale).toBe(false);
    expect(fresh.why).toBeNull();
  });
});

describe("tmuxServerPid, the namespace the handles live in", () => {
  it("reads it off the payload, and null when it is absent or unreadable", () => {
    expect(wire({ tmuxServerPid: 132280 }).tmuxServerPid).toBe(132280);
    expect(wire({ tmuxServerPid: null }).tmuxServerPid).toBeNull();
    expect(wire({}).tmuxServerPid).toBeNull();
    expect(malformed({ tmuxServerPid: "132280" }).tmuxServerPid).toBeNull();
  });

  it("prints it beside the handles it qualifies, so two snapshots can be compared", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() => feed.push(state({ tmuxServerPid: 132280, rows: [steerable({ id: "$a", title: "a session" })] })));
    openSession("a session");
    expect(container.textContent).toContain("132280");

    /* Absent says so rather than drawing nothing: a reader who cannot see this
       number would otherwise assume the handles above it are comparable with
       the ones they wrote down yesterday. */
    act(() => feed.push(state({ tmuxServerPid: null, rows: [steerable({ id: "$a", title: "a session" })] })));
    expect(container.textContent).toContain("tmux server unread");
  });
});

describe("verified — what was true of the target in the moment before sending", () => {
  it("refuses half an address rather than filling the missing half in", () => {
    const whole = { paneId: "%2108", sessionId: "$1643", panePid: 4242, claudePid: 4243 };
    expect(parseVerified(whole)).toEqual({ kind: "verified", ...whole });
    expect(parseVerified({ ...whole, paneId: "" })).toEqual({ kind: "not-told" });
    expect(parseVerified({ ...whole, claudePid: "4243" })).toEqual({ kind: "not-told" });
    /* A success with no address at all — what a server older than the field
       sends. `not-told` and never an address with holes in it. */
    expect(parseVerified(undefined)).toEqual({ kind: "not-told" });
  });

  it("says where the message landed, and shouts when it is not where you were looking", async () => {
    const feed = manualTransport();
    /* A server that says the keys went somewhere else. It should be
       impossible — `verifyTarget` refuses a claim that does not match live
       tmux — so reaching this branch means a guard did not hold, which is
       precisely the thing a green tick must not hide. */
    const elsewhere: SteerApi = {
      message: async () => ({
        ok: true,
        op: "message",
        sent: [],
        verified: { kind: "verified", paneId: "%9999", sessionId: "$9999", panePid: 1, claudePid: 2 },
      }),
      answer: async () => ({ ok: true, op: "answer", sent: [], verified: { kind: "not-told" } }),
    };
    mountFull({ transport: feed.transport, steer: elsewhere });
    act(() => feed.push(state({ rows: [steerable({ id: "$a", title: "a session" })] })));
    openSession("a session");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("IT WAS NOT THE SESSION YOU TAPPED");
    expect(text).toContain("%9999");
  });

  it("names the pane on an ordinary send, rather than only saying 'Sent.'", async () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: recordingSteer().api });
    act(() => feed.push(state({ rows: [steerable({ id: "$a", title: "a session", paneId: "%2108" })] })));
    openSession("a session");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Sent.");
    expect(text).toContain("%2108");
    expect(text).not.toContain("IT WAS NOT THE SESSION YOU TAPPED");
  });

  /* --- M1: it is a PRE-SEND check, and the page must not call it delivery --- */

  it("compares the pane's pid, so a respawn under the same handles is not agreement", () => {
    const target = { paneId: "%2108", sessionId: "$1643", panePid: 4242 };
    const verified = { kind: "verified", paneId: "%2108", sessionId: "$1643", claudePid: 5 } as const;

    /* THE CASE THE FIRST VERSION MISSED. `tmux respawn-pane` and a resume both
       keep the pane and session handles and replace the process underneath, so
       comparing only those two says "same address" and calls it "same program". */
    const respawned = checkLanding({ ...verified, panePid: 9999 }, target);
    expect(respawned.kind).toBe("disagrees");
    if (respawned.kind !== "disagrees") throw new Error("unreachable");
    expect(respawned.differing).toEqual(["pane pid"]);

    const same = checkLanding({ ...verified, panePid: 4242 }, target);
    expect(same.kind).toBe("agrees");
    if (same.kind !== "agrees") throw new Error("unreachable");
    /* And it SAYS which fields it used, because a comparison that named none
       reads identically to one that compared nothing. */
    expect(same.compared).toEqual(["session", "pane", "pane pid"]);
    expect(same.unchecked).toEqual([]);
  });

  it("records a field it could not compare rather than counting it as a match", () => {
    /* A row with no pid never claimed one, and the server treats that as "no
       respawn check" — so the honest reading is that the process was not
       compared, not that it agreed. */
    const check = checkLanding(
      { kind: "verified", paneId: "%2108", sessionId: "$1643", panePid: 4242, claudePid: 5 },
      { paneId: "%2108", sessionId: "$1643", panePid: null },
    );
    expect(check.kind).toBe("agrees");
    if (check.kind !== "agrees") throw new Error("unreachable");
    expect(check.unchecked).toEqual(["pane pid"]);
    expect(check.compared).toEqual(["session", "pane"]);
  });

  it("does not claim delivery, because nothing measured the pane after the send", async () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: recordingSteer().api });
    act(() => feed.push(state({ rows: [steerable({ id: "$a", title: "a session", paneId: "%2108" })] })));
    openSession("a session");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
    const text = container.textContent ?? "";
    /* `verifyTarget` runs BEFORE the capture and before the send-keys calls and
       is never recomputed, so both of these are assertions the page cannot
       support. They were on screen until 2026-09-08. */
    expect(text).not.toContain("Landed in");
    expect(text).not.toContain("keys were typed at");
    expect(text).toContain("immediately before the keys went");
    expect(text).toContain("not a receipt");
    /* And it names what it used, so "checked" cannot be read as "checked
       everything". */
    expect(text).toContain("session, pane and pane pid");
  });

  it("checks the outcome against the row that was TAPPED, not the row on screen now", async () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport, steer: recordingSteer().api });
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "a session", paneId: "%2108", panePid: 4242 })] })),
    );
    openSession("a session");
    const box = container.querySelector<HTMLTextAreaElement>("#steer-text");
    if (!box) throw new Error("no message box");
    typeInto(box, "carry on");
    await act(async () => {
      buttonSaying("Send now")?.click();
    });
    expect(container.textContent ?? "").not.toContain("IT WAS NOT THE SESSION YOU TAPPED");

    /* THE ROW MOVES UNDER THE CARD. The detail pane is keyed by session id, so
       this outcome survives — and a comparison against the LIVE row would now
       shout that a perfectly-aimed send went somewhere else, on the strength of
       a pane handle that changed after the keys had already gone. */
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "a session", paneId: "%3000", panePid: 7777 })] })),
    );
    const text = container.textContent ?? "";
    expect(text).not.toContain("IT WAS NOT THE SESSION YOU TAPPED");
    /* It still names the address the send was actually aimed at, not the new one. */
    expect(text).toContain("%2108");
  });
});

describe("resolution and startedDir — what new-session actually did", () => {
  /* The same two gestures the "starting a session" block above uses, and local
     for the same reason its own are: they are the whole of how this panel is
     reached, and a helper shared across two describes that both mount the page
     is a helper that hides which one built the DOM being asserted on. */
  function openNewSession(): void {
    const button = buttonSaying("New session");
    if (!button) throw new Error("there is no New session button");
    act(() => button.click());
  }

  function type(id: string, value: string): void {
    const box = container.querySelector<HTMLTextAreaElement>(`#${id}`);
    if (!box) throw new Error(`no textarea #${id}`);
    typeInto(box, value);
  }

  it("reads both, and refuses to guess `repo` for a server that did not say", () => {
    const base = {
      id: "L9",
      progress: { state: "started", notification: { kind: "pending" } },
      dir: "/home/greg/code/spideryarn2",
    };
    expect(parseLaunch({ ...base, resolution: "repo", startedDir: "/home/greg/code/other" })).toMatchObject({
      resolution: "repo",
      startedDir: "/home/greg/code/other",
    });
    expect(parseLaunch({ ...base, resolution: "dir" })?.resolution).toBe("dir");
    /* The safe-looking word is the one that must not be invented: `repo`
       promises the setup lock was held, and an older server promised nothing. */
    expect(parseLaunch(base)?.resolution).toBeNull();
    expect(parseLaunch({ ...base, resolution: "repository" })?.resolution).toBeNull();
    expect(parseLaunch(base)?.startedDir).toBeNull();
  });

  it("draws the directory the box CHOSE when it is not the one that was asked for", async () => {
    const record = parseLaunch({
      id: "L10",
      progress: { state: "started", notification: { kind: "pending" } },
      name: "w2-something",
      dir: "/home/greg/code/spideryarn2/.claude/worktrees/w2",
      resolution: "repo",
      startedDir: "/home/greg/code/spideryarn2",
      promptBytes: 9,
      requestedAt: "",
      finishedAt: "",
      error: null,
      maybeStarted: false,
      note: null,
    });
    if (record === null) throw new Error("the fixture did not parse");

    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      newSession: fakeNewSession({
        start: async () => ({ accepted: true, launch: record }),
        poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [record] } }),
      }),
    });
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "start me");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });
    const text = container.textContent ?? "";
    /* The panel's own header promises the record says which directory was USED.
       It was parsing `dir` — what was asked for — and dropping this. */
    expect(text).toContain("Started in");
    expect(text).toContain("/home/greg/code/spideryarn2/.claude/worktrees/w2");
    expect(text).toContain("not the directory that was asked for");
  });

  it("says out loud when a launch went in through the -d escape hatch", async () => {
    const record = parseLaunch({
      id: "L11",
      progress: { state: "started", notification: { kind: "pending" } },
      name: "loose",
      dir: "/tmp/somewhere",
      resolution: "dir",
      startedDir: "/tmp/somewhere",
      promptBytes: 9,
      requestedAt: "",
      finishedAt: "",
      error: null,
      maybeStarted: false,
      note: null,
    });
    if (record === null) throw new Error("the fixture did not parse");

    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      newSession: fakeNewSession({
        start: async () => ({ accepted: true, launch: record }),
        poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [record] } }),
      }),
    });
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "start me");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });
    const text = container.textContent ?? "";
    /* `-d` skips the repo's setup status and starts the session outside the
       setup lock — the thing that once let this dashboard start an agent in a
       checkout a setup run was rewriting. It is not a plumbing detail. */
    expect(text).toContain("outside the repo's setup lock");
    expect(text).toContain("Started with");
    /* And the ordinary path gets no such line, because a caveat drawn on every
       row is one nobody reads. */
    expect(text).not.toContain("Started in /home");
  });

  /**
   * **ONE CARD MUST NOT BE IN TWO TENSES ABOUT WHETHER ANYTHING RAN.**
   *
   * The server assigns `resolution` when the record is minted, while it is still
   * `starting`, and keeps it on a failure (routes-new.ts) — so the `-d` line
   * said *"Started with `-d`"* underneath *"Starting…"* and underneath
   * *"Failed. Nothing was started."* The second of those is the expensive one:
   * the headline says nothing ran and the line below it says it started. GPT
   * Sol's M4.
   */
  /** One `-d` launch in whichever state, taken all the way to text on the page. */
  async function renderDashD(over: Record<string, unknown>): Promise<string> {
    const record = parseLaunch({
      id: "L12",
      progress: { state: "starting", notification: { kind: "not-attempted" } },
      name: "loose",
      dir: "/tmp/somewhere",
      resolution: "dir",
      startedDir: null,
      promptBytes: 9,
      requestedAt: "",
      finishedAt: null,
      error: null,
      maybeStarted: false,
      note: null,
      ...over,
    });
    if (record === null) throw new Error("the fixture did not parse");
    const feed = manualTransport();
    mountFull({
      transport: feed.transport,
      newSession: fakeNewSession({
        start: async () => ({ accepted: true, launch: record }),
        poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [record] } }),
      }),
    });
    act(() => feed.push(state({ rows: [] })));
    openNewSession();
    type("new-session-prompt", "start me");
    await act(async () => {
      buttonSaying("Start it")?.click();
    });
    return container.textContent ?? "";
  }

  it("does not say a -d launch STARTED while it is still starting", async () => {
    const text = await renderDashD({});
    expect(text).toContain("Starting…");
    /* The caveat is still drawn — which door was used is known from the moment
       the record is minted, and it is the tense that was wrong, not the fact. */
    expect(text).toContain("outside the repo's setup lock");
    expect(text).not.toContain("Started with");
  });

  it("does not say a -d launch STARTED after it failed", async () => {
    /* The one that cost the most to read: "Failed. Nothing was started." with
       "Started with -d" directly beneath it, on one card. */
    const text = await renderDashD({
      progress: { state: "failed", notification: { kind: "not-applicable" } },
      error: "gjd-remote refused",
      finishedAt: "",
    });
    expect(text).toContain("Failed. Nothing was started.");
    expect(text).toContain("outside the repo's setup lock");
    expect(text).not.toContain("Started with");
  });
});

/**
 * THE CONVERSATION MOVED TO THE TOP, AND THE ORDER IS THE FEATURE.
 *
 * Greg, 2026-09-09: *"show the most recent message (perhaps with a summary if
 * idle) prominently near the top, with the input-box and command-lists
 * underneath, with a button to click to open up the previous messages"*.
 *
 * **Every one of these passed before the change, which is why they are here.**
 * The existing "recent messages, on the page" block asserts what is rendered
 * and never where, so the section could have been anywhere on the page — or
 * back at the bottom — without a single test noticing. Order is the whole of
 * what Greg asked for, so order is what is pinned.
 */
describe("the newest message first, and the rest behind a disclosure", async () => {
  /** The headings this page draws, in the order the DOM has them. */
  function headings(): string[] {
    return [...container.querySelectorAll("h3")].map((h) => (h.textContent ?? "").trim());
  }

  /**
   * The conversation's own disclosure, found by what its summary SAYS.
   *
   * Not `querySelector("details")`: Rename and Where it is are `<details>` too
   * and share the class, so the first match is whichever happens to be highest
   * on the page. A test that asserted "not inside the disclosure" against the
   * Rename block would pass for a reason that has nothing to do with the claim.
   */
  function disclosure(): HTMLDetailsElement | null {
    return (
      [...container.querySelectorAll("details")].find((d) => {
        const summary = d.querySelector("summary")?.textContent ?? "";
        return summary.includes("earlier message") || summary.includes("Where this came from");
      }) ?? null
    );
  }

  async function openWithTurns(turns: Record<string, unknown>[]): Promise<void> {
    const { api } = recordingMessages(() => messagesWire({ turns }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "one" })] })));
    openSession("one");
    await act(async () => {});
  }

  it("puts the latest message above the composer and the buttons", async () => {
    await openWithTurns([turnWire({ uuid: "a", text: "first thing" }), turnWire({ uuid: "b", text: "last thing" })]);
    const order = headings();
    const latest = order.indexOf("Latest message");
    const say = order.indexOf("Say something to it");
    const ask = order.findIndex((h) => h.startsWith("Ask it to"));
    expect(latest).toBeGreaterThanOrEqual(0);
    expect(say).toBeGreaterThan(latest);
    expect(ask).toBeGreaterThan(latest);
  });

  /** The loud band is the reason the page exists and outranks what was said. */
  it("keeps what it needs from you above the latest message", async () => {
    const { api } = recordingMessages(() => messagesWire({ turns: [turnWire()] }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() =>
      feed.push(
        state({ rows: [steerable({ id: "$1", title: "one", status: { kind: "needs-you" }, question: question() })] }),
      ),
    );
    openSession("one");
    await act(async () => {});
    const order = headings();
    expect(order.indexOf("What it needs from you")).toBeLessThan(order.indexOf("Latest message"));
  });

  it("shows only the newest turn outside the disclosure", async () => {
    await openWithTurns([turnWire({ uuid: "a", text: "an older thing" }), turnWire({ uuid: "b", text: "the newest thing" })]);
    const details = disclosure();
    const outside = [...container.querySelectorAll(".transcript-turn")].filter((t) => !details?.contains(t));
    expect(outside).toHaveLength(1);
    expect(outside[0]?.textContent).toContain("the newest thing");
    expect(outside[0]?.textContent).not.toContain("an older thing");
  });

  it("puts the earlier turns inside a disclosure that says how many", async () => {
    await openWithTurns([
      turnWire({ uuid: "a", text: "older one" }),
      turnWire({ uuid: "b", text: "older two" }),
      turnWire({ uuid: "c", text: "newest" }),
    ]);
    const summaries = [...container.querySelectorAll("summary")].map((s) => s.textContent ?? "");
    const mine = summaries.find((s) => s.includes("earlier message"));
    expect(mine).toContain("2 earlier messages");
  });

  it("says so rather than counting to one when the newest turn is the only one", async () => {
    await openWithTurns([turnWire({ uuid: "a", text: "the only thing said" })]);
    const summaries = [...container.querySelectorAll("summary")].map((s) => s.textContent ?? "");
    expect(summaries.some((s) => s.includes("Where this came from"))).toBe(true);
    expect(summaries.some((s) => s.includes("earlier message"))).toBe(false);
  });

  /**
   * THE HALF THAT WOULD HAVE BEEN A SILENT REGRESSION.
   *
   * A transcript we could not read has no newest turn. If the refusal had
   * stayed downstairs with the provenance, the top of the page would render
   * NOTHING and read as a session that has said nothing — which is the failure
   * this whole page is written against, arriving through a layout change.
   */
  it("renders a refusal at the top, not inside the disclosure", async () => {
    const { api } = recordingMessages(() => ({
      kind: "not-found",
      reason: "no-transcript",
      why: "nothing on disk names this conversation",
    }));
    const feed = manualTransport();
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "one" })] })));
    openSession("one");
    await act(async () => {});
    const details = disclosure();
    const text = container.textContent ?? "";
    expect(text).toContain("There is no transcript to read for this session.");
    expect(details?.textContent ?? "").not.toContain("There is no transcript to read");
  });
});

/**
 * WHAT THE TOP OF THE PAGE MAY AND MAY NOT CLAIM.
 *
 * Six findings from a cross-family review of the first version of the split
 * (F13-F18), and they are one mistake with six faces: the conversation moved to
 * the top of the page, where a sentence reads as the session's current state,
 * and it went on saying things that had only ever been true of a footnote.
 *
 * **`container.textContent` cannot answer any of these, which is the point.**
 * jsdom includes the descendants of a CLOSED `<details>` in `textContent`, so
 * every "is the warning on the page" assertion passes whether the reader can
 * see the warning or not. These use containment against the disclosure element
 * instead — the F17 finding, and the reason the earlier stale tests could not
 * have caught a regression that pushed the warning back inside.
 */
describe("the caveats that have to be readable without opening anything", () => {
  function disclosure(): HTMLDetailsElement | null {
    return (
      [...container.querySelectorAll("details")].find((d) => {
        const summary = d.querySelector("summary")?.textContent ?? "";
        return summary.includes("earlier message") || summary.includes("Where this came from");
      }) ?? null
    );
  }

  /** Text the reader can see without opening the conversation's disclosure. */
  function visibleText(): string {
    const hidden = disclosure();
    return [...container.querySelectorAll("p, li, div")]
      .filter((el) => (hidden === null || !hidden.contains(el)) && el.children.length === 0)
      .map((el) => el.textContent ?? "")
      .join(" ");
  }

  async function open(reply: Record<string, unknown>, over: Partial<Row> = {}): Promise<void> {
    const feed = manualTransport();
    const { api } = recordingMessages(() => reply);
    mountFull({ transport: feed.transport, messagesApi: api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1", title: "one", ...over })] })));
    openSession("one");
    await act(async () => {});
  }

  /** F17: the stale warning must be outside the disclosure, not merely present. */
  it("shows the stale-transcript warning without the reader opening anything", async () => {
    await open(
      messagesWire({
        turns: [turnWire({ uuid: "a", text: "something" })],
        lastModified: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
      { status: { kind: "working" } },
    );

    const warning = [...container.querySelectorAll("p")].find((p) =>
      (p.textContent ?? "").includes("This may not be this session's conversation."),
    );
    expect(warning, "the stale warning should be on the page").toBeTruthy();
    expect(disclosure()?.contains(warning as Node) ?? false).toBe(false);
  });

  /**
   * F13. `reachedStartOfFile: false` says outright that the read did not reach
   * the beginning, so an empty turn list is not evidence of silence — and the
   * first version said "a session that has not spoken yet" anyway.
   */
  it("does not claim silence from an empty read that never reached the start of the file", async () => {
    await open(messagesWire({ turns: [], reachedStartOfFile: false }));

    const text = visibleText();
    expect(text).not.toContain("has not spoken yet");
    expect(text).toContain("did not reach the beginning");
  });

  it("does claim silence when the read DID reach the start and found nothing", async () => {
    await open(messagesWire({ turns: [], reachedStartOfFile: true }));
    expect(visibleText()).toContain("has not spoken yet");
  });

  /**
   * F14. `parseRecentMessages` drops a turn it cannot read and keeps only a
   * COUNT — the position is lost — so the last readable turn may not be the
   * last turn, and the page must not present it as one without saying so.
   */
  it("warns beside the turn that a newer one may be missing", async () => {
    await open(
      messagesWire({
        turns: [turnWire({ uuid: "a", text: "the last readable thing" }), null],
      }),
    );

    const text = visibleText();
    expect(text).toContain("could not read");
    expect(text).toContain("may be newer");
  });

  it("says no turns COULD be read, rather than that there are none, when every turn was unreadable", async () => {
    await open(messagesWire({ turns: [null, null], reachedStartOfFile: true }));

    const text = visibleText();
    expect(text).toContain("No turns could be read");
    expect(text).not.toContain("has not spoken yet");
  });

  /**
   * F15. Which file is live changes what you DO — steering on this message may
   * answer a different conversation — so it cannot live behind a disclosure.
   */
  it("warns beside the turn when more than one file carries this conversation id", async () => {
    await open(messagesWire({ turns: [turnWire({ uuid: "a" })], copies: 2 }));

    const text = visibleText();
    expect(text).toContain("2 files carry this conversation id");
    expect(text).toContain("may reach a different conversation");
  });

  /** F16: an empty slice has two causes that mean opposite things. */
  it("does not tell the disclosure there is a message above when nothing was read", async () => {
    await open(messagesWire({ turns: [], reachedStartOfFile: true }));

    const inside = disclosure()?.textContent ?? "";
    expect(inside).toContain("No turns were read");
    expect(inside).not.toContain("the message above is the only turn read");
  });

  it("still says the message above is the only one when exactly one turn was read", async () => {
    await open(messagesWire({ turns: [turnWire({ uuid: "a" })] }));

    const inside = disclosure()?.textContent ?? "";
    expect(inside).toContain("the message above is the only turn read");
  });
});
