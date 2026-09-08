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
import { makeNewSessionApi, parseLaunch, type NewSessionApi } from "../tools/fleet/web/src/new-session-client";
import { steerMessageBody, type SteerApi, type SteerOutcome } from "../tools/fleet/web/src/steer-client";
import { readHealthStats } from "../tools/fleet/web/src/health-view";
import { fetchFleetState } from "../tools/fleet/web/src/transport";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import {
  parseFleetState,
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
    collectedAt: new Date("2026-09-08T12:00:00Z").toISOString(),
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

function mount(transport: Transport): void {
  act(() => root.render(<App transport={transport} />));
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
    expect(container.textContent).toContain("There is no orchestrator yet.");
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
              question: { prompt: "<b>bold?</b>", options: [], material: { kind: "no-material" } },
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

function mountFull(args: { transport: Transport; steer?: SteerApi; newSession?: NewSessionApi }): void {
  act(() =>
    root.render(
      <App
        transport={args.transport}
        steer={args.steer ?? recordingSteer().api}
        newSession={args.newSession ?? fakeNewSession()}
      />,
    ),
  );
}

/** A dialog with a body to approve, as the server sends one. */
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
    expect(text).toContain("What it needs from you");
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
              question: question({ material: { kind: "no-material" } }),
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

describe("answering, which is held back at the server", () => {
  it("says so before anybody taps, and says a message is different", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "asking", status: { kind: "needs-you" }, question: question() })] })),
    );
    openSession("asking");
    const text = container.textContent ?? "";
    /* Not discovered by tapping. Screen text is not provenance — an agent given
       hostile input can print a plausible menu — and whether to ship answering
       anyway is Greg's call. */
    expect(text).toContain("Answering is held back");
    expect(text).toContain("screen text is not proof");
    expect(text).toContain("Sending a message, further down, is not affected");
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
    act(() =>
      feed.push(state({ rows: [steerable({ id: "$a", title: "asking", status: { kind: "needs-you" }, question: question() })] })),
    );
    openSession("asking");
    expect(container.querySelectorAll("button.answer").length).toBeGreaterThan(0);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.answer")?.click();
    });

    const text = container.textContent ?? "";
    expect(text).toContain("gjd-remote resume");
    expect(text).toContain("Answering is switched off on this server");
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
      buttonSaying("Send")?.click();
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
    // The REAL steer api, so this test exercises the bytes on the wire rather
    // than a seam that could be right while the wire is wrong.
    act(() => root.render(<App transport={feed.transport} newSession={fakeNewSession()} />));
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
    act(() => root.render(<App transport={feed.transport} newSession={fakeNewSession()} />));
    act(() => feed.push(parsed));
    openSession("asking about an edit");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button.answer")?.click();
    });

    expect(recorded.calls.map((c) => c.url)).toEqual(["api/steer/answer"]);
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
      buttonSaying("Send")?.click();
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
      buttonSaying("Send")?.click();
    });

    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.op).toBe("message");
    expect(recorder.calls[0]?.row.id).toBe("$b");
    expect(recorder.calls[0]?.arg).toBe("pull the latest dev and carry on");
    expect(container.textContent).toContain("Sent.");
  });
});

describe("the recent-messages slot, which is empty on purpose", () => {
  it("says the messages are not wired up, and shows what they will be found from", () => {
    const feed = manualTransport();
    mountFull({ transport: feed.transport });
    act(() =>
      feed.push(
        state({
          rows: [
            steerable({
              id: "$a",
              title: "a session",
              meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
            }),
          ],
        }),
      ),
    );
    openSession("a session");
    const text = container.textContent ?? "";
    /* An empty panel that says so is correct; a panel that shows nothing and
       looks finished is not, and a mocked conversation would be worse than
       either. */
    expect(text).toContain("Recent messages are not wired up yet");
    expect(text).toContain("/home/greg/code/spideryarn2");
    expect(text).toContain("117e181a-155b-435a-b95b-e74220678d1a");
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
