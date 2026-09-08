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
import { STATUS_TIPS } from "../tools/fleet/web/src/SessionsPanel";
import { COLUMN_MIN_PX, chooseColumns, chooseDockFit, spreadIntoColumns } from "../tools/fleet/web/src/fit";
import { readHealthStats } from "../tools/fleet/web/src/health-view";
import { fetchFleetState } from "../tools/fleet/web/src/transport";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { parseFleetState, parseStatus, type FleetState, type FleetStatus } from "../tools/fleet/web/src/types";
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
    meta: { version: "legacy" },
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
    expect(parseFleetState({ rows: [{ id: "$a", meta: { version: 2, path: "/somewhere" } }] })?.rows[0]?.meta).toEqual({
      version: "legacy",
    });
    expect(parseFleetState({ rows: [{ id: "$a" }] })?.rows[0]?.meta).toEqual({ version: "legacy" });
    expect(
      parseFleetState({ rows: [{ id: "$a", meta: { version: 1, kind: "worktree", repo: "r", dir: "/d" } }] })?.rows[0]
        ?.meta,
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
    expect(parseFleetState({ rows: [], refreshMs: 60_000 })?.refreshMs).toBe(60_000);
    expect(parseFleetState({ rows: [] })?.refreshMs).toBeNull();
    // Not a number, or nonsense: the server did not say, so the page measures.
    expect(parseFleetState({ rows: [], refreshMs: "soon" })?.refreshMs).toBeNull();
    expect(parseFleetState({ rows: [], refreshMs: -1 })?.refreshMs).toBeNull();
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
    // cannot promise — docs/project/tooltips.md.
    expect(text).toContain("this page cannot answer for you");
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
