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
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../tools/fleet/web/src/App";
import { freshness } from "../tools/fleet/web/src/Header";
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
  type MessagesApi,
} from "../tools/fleet/web/src/messages-client";
import { makeNewSessionApi, parseLaunch, type NewSessionApi } from "../tools/fleet/web/src/new-session-client";
import { looksLikeAName, makeRenameApi, renameBody, type RenameApi } from "../tools/fleet/web/src/rename-client";
import { steerMessageBody, type SteerApi, type SteerOutcome } from "../tools/fleet/web/src/steer-client";
import { readHealthStats } from "../tools/fleet/web/src/health-view";
import { fetchFleetState } from "../tools/fleet/web/src/transport";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import {
  parseFleetState,
  parsePause,
  parseStatus,
  type FleetState,
  type FleetStatus,
} from "../tools/fleet/web/src/types";
import {
  CONSEQUENCE_RANK,
  CONSEQUENCE_TONE,
  ORDERINGS,
  TONE_ALARM,
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
function wire(over: Record<string, unknown>): FleetState {
  const read = parseFleetState({ schema: 1, rows: [], ...over });
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
function mount(transport: Transport): void {
  act(() =>
    root.render(
      <App
        transport={transport}
        rename={fakeRename()}
        actionsApi={recordingActions().api}
        messagesApi={recordingMessages().api}
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
    // orchestrator-direction.md § Read-only until a channel is proven is about.
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
    window.location.hash = "#orchestrator";
    const feed = manualTransport();
    mount(feed.transport);
    expect(container.textContent).toContain("Everything queued, across the fleet");
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

describe("what comes off the wire", () => {
  it("turns a status this build has never heard of into an unknown that names itself", () => {
    expect(parseStatus({ kind: "compacting" })).toEqual({
      kind: "unknown",
      why: 'this page does not know the status "compacting"',
    });
  });

  it("refuses a body that is not this API, rather than rendering zero sessions over it", () => {
    expect(parseFleetState("<html>502 Bad Gateway</html>").ok).toBe(false);
    expect(parseFleetState(null).ok).toBe(false);
  });

  it("refuses a schema it does not read, rather than showing a fleet it half-understands", () => {
    /* GPT Sol's F15. `parseFleetState({})` used to SUCCEED: a missing `rows`
       became an empty list, the schema was ignored, and a 200 carrying anything
       at all rendered as a quiet box. Each refusal names itself, so the banner
       can say which of the three it was. */
    const two = parseFleetState({ schema: 2, rows: [] });
    expect(two.ok).toBe(false);
    expect(two.ok === false ? two.why : "").toContain("schema 2");

    const none = parseFleetState({ rows: [] });
    expect(none.ok).toBe(false);
    expect(none.ok === false ? none.why : "").toContain("no schema");

    expect(parseFleetState({}).ok).toBe(false);
  });

  it("refuses a payload with no list of sessions, which is not a payload with none", () => {
    const missing = parseFleetState({ schema: 1 });
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
       that only found the three buttons somewhere on the page would have passed
       just as happily before the change. */
    const feed = manualTransport();
    mount(feed.transport);
    expect(modeButtons().map((b) => b.textContent)).toEqual(["Sessions", "Box health", "Orchestrator"]);
    expect(container.querySelector("header")?.querySelector(".dock-modes")).toBeNull();
  });

  it("marks the mode you are in, and only that one", () => {
    const feed = manualTransport();
    mount(feed.transport);

    const checked = (): (string | null)[] => modeButtons().map((b) => b.getAttribute("aria-checked"));
    expect(checked()).toEqual(["true", "false", "false"]);

    const health = modeButtons().find((b) => b.textContent === "Box health");
    act(() => health?.click());

    expect(checked()).toEqual(["false", "true", "false"]);
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
    expect(wire({ refreshMs: "soon" }).refreshMs).toBeNull();
    expect(wire({ refreshMs: -1 }).refreshMs).toBeNull();
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
      return { ok: true, op: "message", sent: [["tmux", "send-keys", "-t", row.paneId ?? "?", "-l", "--", text]] };
    },
    answer: async (row, index) => {
      calls.push({ op: "answer", row, arg: index });
      return { ok: true, op: "answer", sent: [["tmux", "send-keys", "-t", row.paneId ?? "?", "1"]] };
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
  calls: { op: string; arg: string; second?: string | boolean }[];
  feeds: () => number;
} {
  const calls: { op: string; arg: string; second?: string | boolean }[] = [];
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
    box: async (actionId, dryRun) => {
      calls.push({ op: "box", arg: actionId, second: dryRun });
      return { ok: true, dryRun, dryRunStated: true, result: [], why: null };
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
    });
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
    });
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
      });
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
      steer: refusingSteer({ ok: false, code: "answering-disabled", why, status: 503, from: "server" }),
    });
    // `conversation`, so the buttons are there to be taken away. The whole
    // server being switched off is a fact the page cannot know until it asks.
    act(() =>
      feed.push(
        state({
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
    const parsed = wire({ rows: [wireRow], collectedAt: state().collectedAt });
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
    const parsed = wire({ rows: [wireRow], collectedAt: state().collectedAt });
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
      state: "starting",
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
      state: "failed",
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

  it("refuses a launch state it has never heard of rather than rounding it to started", () => {
    expect(parseLaunch({ id: "L3", state: "reticulating" })).toBeNull();
    expect(parseLaunch({ id: "L3", state: "started" })?.state).toBe("started");
  });

  it("reads maybeStarted as false only when the server actually said so", () => {
    expect(parseLaunch({ id: "L4", state: "failed" })?.maybeStarted).toBe(false);
    expect(parseLaunch({ id: "L4", state: "failed", maybeStarted: true })?.maybeStarted).toBe(true);
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
  over: { sessionId?: string; items?: unknown[]; warning?: string | null; deliverable?: number | null } = {},
): Record<string, unknown> {
  const items = over.items ?? [];
  const wire: Record<string, unknown> = {
    sessionId: over.sessionId ?? "$1643",
    items,
    volatile: true,
    since: 1_757_000_000_000,
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
      }),
    });
    openWith([CONTINUE_WIRE], { api: rec });
    await act(async () => {});
    await clickSaying("Continue");
    expect(container.textContent).toContain("Nothing happened.");
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

    expect(rec.calls.filter((c) => c.op === "box")).toEqual([{ op: "box", arg: "kill-test-suites", second: true }]);
    expect(container.textContent).toContain("What it would do");
    expect(container.textContent).toContain(KILL_SUITES_WIRE.gate);
  });

  it("only then does it, on the second press", async () => {
    const rec = openBox([KILL_SUITES_WIRE]);
    await act(async () => {});
    await clickSaying("Kill test suites");
    await clickSaying("Yes — kill test suites");

    expect(rec.calls.filter((c) => c.op === "box")).toEqual([
      { op: "box", arg: "kill-test-suites", second: true },
      { op: "box", arg: "kill-test-suites", second: false },
    ]);
    expect(container.textContent).toContain("Done.");
  });

  it("offers no Confirm at all when the dry run could not answer", async () => {
    const rec = openBox([KILL_SUITES_WIRE], {
      box: async () => ({
        ok: false,
        code: "ps-failed",
        why: "ps exited 1 and said nothing",
        status: 500,
        from: "server",
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
      box: async () => ({ ok: true, dryRun: false, dryRunStated: true, result: ["killed 4"], why: null }),
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
      box: async () => ({ ok: true, dryRun: true, dryRunStated: true, result: null, why: null }),
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
      box: async () => ({ ok: true, dryRun: true, dryRunStated: true, result: ["would kill 5001"], why: null }),
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
      box: async () => ({ ok: true, dryRun: true, dryRunStated: false, result: [], why: null }),
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
    window.location.hash = "#orchestrator";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [steerable({ id: "$1643", title: "the busy one" })] })));
    await act(async () => {});

    expect(container.textContent).toContain("1 thing is waiting, across 1 session");
    expect(container.textContent).toContain("the busy one");
    expect(container.textContent).toContain("pull latest first");
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
    window.location.hash = "#orchestrator";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [] })));
    await act(async () => {});

    expect(container.textContent).toContain("a session not in the latest snapshot");
    expect(container.textContent).toContain("still waiting");
  });

  it("offers the broadcast, and refuses to draw a box that would swallow a message", async () => {
    const rec = recordingActions(() => actionsWire({ actions: [BROADCAST_WIRE] }));
    window.location.hash = "#orchestrator";
    const feed = manualTransport();
    mountFull({ transport: feed.transport, actionsApi: rec.api });
    act(() => feed.push(state({ rows: [] })));
    await act(async () => {});

    expect(buttonLabels()).toContain("Broadcast: ease off, staggered");
    expect(container.textContent).toContain("There is nothing yet to send a message to.");
    // A refusal with a way forward, not a shrug.
    expect(container.textContent).toContain("the broadcast above is the real thing");
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
      const pause = parsePause(absent);
      expect(pause.kind).toBe("cannot-tell");
      expect(pause.kind === "cannot-tell" && pause.why).toContain("did not say");
    }
  });

  it("refuses a rate limit with no reset time rather than drawing a badge over a gap", () => {
    /* An arm missing the field that makes it actionable is not that arm. The
       page can say "we could not tell"; it cannot say "back at undefined". */
    const pause = parsePause({ kind: "rate-limited", window: "five_hour" });
    expect(pause.kind).toBe("cannot-tell");
    const wakeup = parsePause({ kind: "scheduled-wakeup", overdue: true });
    expect(wakeup.kind).toBe("cannot-tell");
  });

  it("never computes `overdue` itself — it is the server's or it is false", () => {
    /* `overdue` may be set only when the reset time was actually READ, and this
       page cannot check that. A truthy-looking value that is not `true` is not
       the server saying so. */
    const yes = parsePause({ kind: "rate-limited", window: "five_hour", resetsAt: "2026-09-08T06:30:00Z", overdue: true });
    expect(yes.kind === "rate-limited" && yes.overdue).toBe(true);
    for (const fuzzy of ["true", 1, {}, undefined]) {
      const no = parsePause({ kind: "rate-limited", window: "five_hour", resetsAt: "2026-09-08T06:30:00Z", overdue: fuzzy });
      expect(no.kind === "rate-limited" && no.overdue).toBe(false);
    }
  });

  it("keeps an unfamiliar window name rather than dropping the state", () => {
    /* The usage cache carries rotating per-model codenames that appear and
       vanish without notice. A closed union here would compile an exhaustive
       switch that silently drops a real window. */
    const pause = parsePause({ kind: "rate-limited", window: "iguana_necktie", resetsAt: "2026-09-08T06:30:00Z" });
    expect(pause.kind === "rate-limited" && pause.window).toBe("iguana_necktie");
  });

  it("falls back rather than throwing on a pause kind this build has never heard of", () => {
    const pause = parsePause({ kind: "hibernating" });
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
