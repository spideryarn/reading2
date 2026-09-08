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
import { fetchFleetState } from "../tools/fleet/web/src/transport";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { parseFleetState, parseStatus, type FleetState } from "../tools/fleet/web/src/types";
import { triageSort } from "../tools/fleet/web/src/view";

/* React wants this set before anything is rendered inside `act`, and vitest's
   jsdom environment does not set it. Written as a cast rather than a `declare
   global`, which is how the rest of tests/ spells it. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A row, with only the interesting field named at each call site. */
function row(over: Partial<FleetState["rows"][number]> & { id: string }): FleetState["rows"][number] {
  return {
    paneId: null,
    name: over.id,
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    status: { kind: "idle" },
    question: null,
    ...over,
  };
}

function state(over: Partial<FleetState> = {}): FleetState {
  return {
    collectedAt: new Date("2026-09-08T12:00:00Z").toISOString(),
    tookMs: 12_000,
    error: null,
    rows: [],
    health: null,
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
                options: [
                  { label: "Yes", key: { via: "digit", digit: "1" } },
                  { label: "Yes, and don't ask again", key: { via: "digit", digit: "2" } },
                  { label: "No, tell Claude what to do differently", key: { via: "selected" } },
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
    expect(container.querySelectorAll("button")).toHaveLength(
      // Refresh, plus the three tabs. No option is clickable.
      4,
    );
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
    expect(parseFleetState("<html>502 Bad Gateway</html>")).toBeNull();
    expect(parseFleetState(null)).toBeNull();
  });

  it("drops a row with no id but keeps its neighbours", () => {
    const parsed = parseFleetState({ rows: [{ name: "nameless" }, { id: "$b" }] });
    expect(parsed?.rows.map((r) => r.id)).toEqual(["$b"]);
  });

  it("treats pane.ts's own `{ kind: none }` as no question at all", () => {
    const parsed = parseFleetState({ rows: [{ id: "$a", question: { kind: "none" } }] });
    expect(parsed?.rows[0]?.question).toBeNull();
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
              question: { prompt: "<b>bold?</b>", options: [] },
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
