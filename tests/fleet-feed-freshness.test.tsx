// @vitest-environment jsdom
/**
 * **THE RECENT-MESSAGES FEED KNOWS HOW OLD IT IS, AND RE-READS ON EVIDENCE** —
 * Stage 3 of docs/plans/260910c, ledger rows F5 and F6.
 *
 * A feed read costs the box ~250 ms and ~10 MB of transcript reads, so the
 * feed is deliberately not polled. Before this stage `useFeed` had a
 * generation guard and nothing else: a tab left open for an hour showed an
 * hour-old list with nothing saying so, a failed refresh replaced the last good
 * list with the failure, and a read that never answered left "Reading…" on the
 * button for ever.
 *
 * ## Why this is its own file
 *
 * Every test here runs on vitest's fake clock — the 20-second floor and the
 * read deadline are the subject — and the rendering tests in
 * `fleet-feed-panel.test.tsx` run on the real one. One `beforeEach` per file
 * keeps a test from inheriting the other kind of clock by accident.
 *
 * ## The two tests that assert nothing happens
 *
 * "Twenty identical snapshots read once" and "a `why` that changes wording
 * reads nothing" both pass trivially against a page that never re-reads at all.
 * So each ends with a control: a real change, which MUST read. A negative
 * assertion counts only when the positive path is shown working in the same
 * test, against the same mounted panel.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEED_READ_DEADLINE_MS, FEED_REREAD_FLOOR_MS, FeedPanel, useFeed } from "../tools/fleet/web/src/FeedPanel";
import {
  NO_FILTERS,
  feedEvidence,
  type FeedApi,
  type FeedView,
  type SessionListReading,
} from "../tools/fleet/web/src/feed-client";
import { CLOCK_SKEW_UNMEASURED, type FleetRow } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.parse("2026-09-10T09:00:00.000Z");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  setVisibility("visible", false);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setVisibility("visible", false);
});

/* ------------------------------------------------------------------ *
 * Fixtures.
 * ------------------------------------------------------------------ */

/** jsdom's `visibilityState` is a prototype getter with no setter, so it is redefined. */
function setVisibility(state: "visible" | "hidden", announce = true): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  if (announce) document.dispatchEvent(new Event("visibilitychange"));
}

/** Move the fake clock and flush every promise and render it releases. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function feedWith(text: string, tmuxServerPid: number | null = 42): FeedView {
  return {
    kind: "feed",
    limit: 50,
    messages: [
      {
        sessionId: "$1",
        sessionName: "alpha",
        sessionTitle: null,
        attribution: { kind: "claimed-only", why: "w" },
        turn: { speaker: "assistant", at: null, text, truncated: false, fullChars: text.length, toolCalls: [], uuid: text },
      },
    ],
    undated: [],
    sessions: [],
    sessionsOffered: true,
    unreadableRows: 0,
    coverage: { kind: "complete" },
    collectedAt: null,
    readStartedAt: null,
    readFinishedAt: null,
    servedAt: null,
    tmuxServerPid,
  };
}

const VERIFIED: FleetRow["execution"] = {
  kind: "verified",
  token: { boot: "boot-a", pid: 100, startTicks: 5 },
  harness: "claude-code",
  conversation: { kind: "verified", id: "conv-a" },
};

/**
 * One session row of the shape `parseFleetState` produces. Every field named,
 * for the reason `fleet-feed-panel.test.tsx` § `sessionRow` gives.
 */
function row(id: string, over: Partial<FleetRow> = {}): FleetRow {
  const status = over.status ?? { kind: "idle" };
  return {
    id,
    paneId: null,
    name: `session-${id}`,
    title: null,
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    execution: VERIFIED,
    repo: null,
    worktree: null,
    startedAt: "2026-09-10T08:00:00.000Z",
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: null,
    claudeSessionId: "conv-a",
    rawStatus: status,
    rawQuestion: null,
    ...over,
  };
}

/** A finished census. A fresh object every call, which is what App hands down every poll. */
function collected(rows: FleetRow[], tmuxServerPid: number | null = 42): SessionListReading {
  return { kind: "collected", rows, unreadableRows: 0, tmuxServerPid };
}

type Call = { limit: number; signal: AbortSignal | undefined; resolve: (view: FeedView) => void };

/**
 * An api whose every answer the test hands back by hand, and which records the
 * signal it was given. It **ignores** that signal: the hook's deadline and its
 * discarding must hold against a client that does not honour abort, which is
 * what F5 asked for.
 */
function manualApi(): { api: FeedApi; calls: Call[] } {
  const calls: Call[] = [];
  const api: FeedApi = {
    recent: (limit: number, signal?: AbortSignal) =>
      new Promise<FeedView>((resolve) => {
        calls.push({ limit, signal, resolve });
      }),
  };
  return { api, calls };
}

function panel(api: FeedApi, sessions: SessionListReading, limit = 50): ReactNode {
  return (
    <FeedPanel
      api={api}
      limit={limit}
      onLimit={() => {}}
      filters={NO_FILTERS}
      onFilters={() => {}}
      sessions={sessions}
      now={Date.now()}
      skew={CLOCK_SKEW_UNMEASURED}
    />
  );
}

async function render(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

/** Answer read `i`, and flush what that releases. */
async function answer(calls: Call[], i: number, view: FeedView): Promise<void> {
  await act(async () => {
    calls[i]?.resolve(view);
  });
}

/** What a sighted reader sees: the tooltips' screen-reader copies removed. */
function visibleText(): string {
  const clone = host.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll('[class*="sr-only"]')) hidden.remove();
  return clone.textContent ?? "";
}

function readAgainButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Read the transcripts again"]');
  if (button === null) throw new Error("no Read again button");
  return button;
}

/* ------------------------------------------------------------------ *
 * The evidence.
 * ------------------------------------------------------------------ */

describe("re-reading on evidence, never on a timer", () => {
  /**
   * **THE FEED BECOMING A POLL**, which is the risk the plan names first.
   * `App` hands down a fresh `sessions` object on every poll, so a trigger keyed
   * to identity rather than content would read once per snapshot.
   */
  it("reads once across twenty identical snapshots, and still reads on a real change", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1"), row("$2")])));
    await answer(calls, 0, feedWith("first"));
    expect(calls).toHaveLength(1);

    for (let i = 0; i < 20; i += 1) {
      await advance(2_000);
      await render(panel(api, collected([row("$1"), row("$2")])));
    }
    expect(calls).toHaveLength(1);

    // The control: the same panel, one real change, well past the floor.
    await render(panel(api, collected([row("$1"), row("$2", { status: { kind: "working" } })])));
    expect(calls).toHaveLength(2);
  });

  it("re-reads once when a session changes status after the floor has passed", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("before"));

    await advance(FEED_REREAD_FLOOR_MS);
    await render(panel(api, collected([row("$1", { status: { kind: "needs-you" } })])));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("after"));
    expect(visibleText()).toContain("after");
  });

  it("holds a change inside the floor to one trailing read at the earliest permitted time", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("first"));

    // Three changes inside the floor, each different from the last.
    await advance(3_000);
    await render(panel(api, collected([row("$1", { status: { kind: "working" } })])));
    await advance(3_000);
    await render(panel(api, collected([row("$1", { status: { kind: "needs-you" } })])));
    await advance(3_000);
    await render(panel(api, collected([row("$1"), row("$2")])));
    expect(calls).toHaveLength(1);

    // The first read began at T0, so T0 + floor is the earliest the next may.
    await advance(FEED_REREAD_FLOOR_MS - 9_000 - 1);
    expect(calls).toHaveLength(1);
    await advance(1);
    expect(calls).toHaveLength(2);

    await answer(calls, 1, feedWith("second"));
    await advance(FEED_REREAD_FLOOR_MS * 3);
    expect(calls).toHaveLength(2);
  });

  it("waits out a hidden tab, then reads once on becoming visible", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("first"));

    setVisibility("hidden");
    await advance(1_000);
    await render(panel(api, collected([row("$1", { status: { kind: "working" } })])));
    await advance(FEED_REREAD_FLOOR_MS * 3);
    expect(calls).toHaveLength(1);

    await act(async () => setVisibility("visible"));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("second"));

    // Visibility on its own is not evidence.
    await act(async () => setVisibility("hidden"));
    await act(async () => setVisibility("visible"));
    await advance(FEED_REREAD_FLOOR_MS * 2);
    expect(calls).toHaveLength(2);
  });

  /**
   * **IT CANNOT LOOP**, because the digest is built from `/api/state` alone. A
   * feed result, the re-render it causes and the last-read time moving on are
   * not evidence — and the page's clock ticking every second re-renders the
   * panel far more often than any of them.
   */
  it("does not loop: a read it caused is not evidence for another", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("first"));
    await advance(FEED_REREAD_FLOOR_MS);
    const changed = (): SessionListReading => collected([row("$1", { status: { kind: "working" } })]);
    await render(panel(api, changed()));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("second"));

    for (let i = 0; i < 10; i += 1) {
      await advance(FEED_REREAD_FLOOR_MS);
      await render(panel(api, changed()));
    }
    expect(calls).toHaveLength(2);
  });

  /**
   * **THE `why` IS PROSE, AND PROSE CHANGES.** Unverifiable arms reword
   * themselves between collections; a digest that included the sentence would
   * fire on every snapshot on a loaded box, which is the poll this must not be.
   */
  it("ignores an unverifiable arm's wording, and its cause, but not a changed conversation claim", async () => {
    const { api, calls } = manualApi();
    const shaky = (
      why: string,
      cause: "process-table-unreadable" | "uptime-unreadable" = "process-table-unreadable",
      claim = "conv-a",
    ) =>
      collected([
        row("$1", { execution: { kind: "unknown", cause, why: `execution ${why}` }, claudeSessionId: claim }),
        row("$2", {
          execution: {
            kind: "verified",
            token: { boot: "boot-a", pid: 200, startTicks: 9 },
            harness: "claude-code",
            conversation: { kind: "unverifiable", claimed: "conv-b", why: `conversation ${why}` },
          },
          status: { kind: "unknown", why: `status ${why}` },
        }),
      ]);
    await render(panel(api, shaky("took 14.2s")));
    await answer(calls, 0, feedWith("first"));

    await advance(FEED_REREAD_FLOOR_MS);
    await render(panel(api, shaky("took 15.7s")));
    await render(panel(api, shaky("ps exited 1")));
    /* Nor is the cause: *why* the box could not look is still the box not
       looking, and no transcript moved because of it. */
    await render(panel(api, shaky("ps exited 1", "uptime-unreadable")));
    expect(calls).toHaveLength(1);

    // The control: the pane now claims a different conversation — a real fact.
    await render(panel(api, shaky("ps exited 1", "uptime-unreadable", "conv-z")));
    expect(calls).toHaveLength(2);
  });

  /* ------------------------------------------------------------------ *
   * The execution, as the LAST VERIFIED TOKEN — not the reading's kind.
   * ------------------------------------------------------------------ */

  const verifiedAs = (pid: number): FleetRow["execution"] => ({
    kind: "verified",
    token: { boot: "boot-a", pid, startTicks: 5 },
    harness: "claude-code",
    conversation: { kind: "verified", id: "conv-a" },
  });
  const unverified: FleetRow["execution"] = {
    kind: "unknown",
    cause: "process-table-unreadable",
    why: "the collection took 16s and the probe gave up",
  };
  const withExecution = (execution: FleetRow["execution"]): SessionListReading =>
    collected([row("$1", { execution }), row("$2")]);

  /**
   * **A FAILED VERIFICATION IS THE WEATHER, NOT EVIDENCE** — plan § "Withhold,
   * caveat or relabel". On this box a row flips `verified` ↔ `unknown` for a
   * collection or two at a time, routinely, and no transcript moves when it
   * does. A digest that counted the flip re-read about once a collection.
   */
  it("does not re-read when a run flips between verified and unknown and back", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, withExecution(verifiedAs(100))));
    await answer(calls, 0, feedWith("first"));

    for (const execution of [unverified, verifiedAs(100), unverified, unverified, verifiedAs(100)]) {
      await advance(FEED_REREAD_FLOOR_MS * 2);
      await render(panel(api, withExecution(execution)));
    }
    await advance(FEED_REREAD_FLOOR_MS * 2);
    expect(calls).toHaveLength(1);

    // The control: the same panel still hears a real change.
    await render(panel(api, collected([row("$1", { execution: verifiedAs(100), status: { kind: "working" } }), row("$2")])));
    expect(calls).toHaveLength(2);
  });

  it("re-reads once when a run is really replaced", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, withExecution(verifiedAs(100))));
    await answer(calls, 0, feedWith("first"));

    await advance(FEED_REREAD_FLOOR_MS);
    await render(panel(api, withExecution(verifiedAs(101))));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("second"));
    await advance(FEED_REREAD_FLOOR_MS * 3);
    expect(calls).toHaveLength(2);
  });

  /** The replacement is the evidence, and the gap before it seeing it is not. */
  it("re-reads once for a replacement seen across an unverified gap", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, withExecution(verifiedAs(100))));
    await answer(calls, 0, feedWith("first"));

    await advance(FEED_REREAD_FLOOR_MS * 2);
    await render(panel(api, withExecution(unverified)));
    await advance(FEED_REREAD_FLOOR_MS * 2);
    expect(calls).toHaveLength(1);

    await render(panel(api, withExecution(verifiedAs(101))));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("second"));
    await render(panel(api, withExecution(unverified)));
    await advance(FEED_REREAD_FLOOR_MS * 3);
    expect(calls).toHaveLength(2);
  });

  it("builds the digest from content, in id order, and from nothing before a census", () => {
    const a = row("$1");
    const b = row("$2", { status: { kind: "working" } });
    expect(feedEvidence(collected([a, b]))).toEqual(feedEvidence(collected([b, a])));
    expect(feedEvidence(collected([a, b]))).not.toEqual(feedEvidence(collected([a, b], 43)));
    expect(feedEvidence({ kind: "not-arrived" })).toBeNull();
    expect(feedEvidence({ kind: "not-collected" })).toBeNull();
    // A waiting session's countdown ticks every snapshot; only its kind is evidence.
    expect(feedEvidence(collected([row("$1", { status: { kind: "waiting", secondsLeft: 30 } })]))).toEqual(
      feedEvidence(collected([row("$1", { status: { kind: "waiting", secondsLeft: 12 } })])),
    );
  });
});

/* ------------------------------------------------------------------ *
 * One in flight, and a deadline of the hook's own.
 * ------------------------------------------------------------------ */

describe("one read at a time, with a deadline that does not trust the api", () => {
  /** Mounts `useFeed` bare, so a test can press `refresh` while a read is in flight. */
  function harness(api: FeedApi): { current: ReturnType<typeof useFeed> | null } {
    const handle: { current: ReturnType<typeof useFeed> | null } = { current: null };
    function Probe(): ReactNode {
      handle.current = useFeed(api, 50, { kind: "not-arrived" });
      return null;
    }
    root.render(<Probe />);
    return handle;
  }

  it("turns any number of refreshes during a read into exactly one more, never two at once", async () => {
    const { api, calls } = manualApi();
    let handle: { current: ReturnType<typeof useFeed> | null } = { current: null };
    await act(async () => {
      handle = harness(api);
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      handle.current?.refresh();
      handle.current?.refresh();
      handle.current?.refresh();
    });
    expect(calls).toHaveLength(1);

    await answer(calls, 0, feedWith("first"));
    expect(calls).toHaveLength(2);
    await answer(calls, 1, feedWith("second"));
    await advance(FEED_REREAD_FLOOR_MS * 2);
    expect(calls).toHaveLength(2);
    expect(handle.current?.busy).toBe(false);
  });

  it("releases a read that never answers, says so, and lets the next one through", async () => {
    const calls: (AbortSignal | undefined)[] = [];
    const api: FeedApi = {
      recent: (_limit: number, signal?: AbortSignal) => {
        calls.push(signal);
        return new Promise<FeedView>(() => {});
      },
    };
    await render(panel(api, collected([row("$1")])));
    expect(calls).toHaveLength(1);
    expect(readAgainButton().disabled).toBe(true);

    await advance(FEED_READ_DEADLINE_MS);
    expect(calls[0]?.aborted).toBe(true);
    expect(visibleText()).toContain("did not answer");
    expect(readAgainButton().disabled).toBe(false);

    await act(async () => readAgainButton().click());
    expect(calls).toHaveLength(2);
  });

  it("carries a refresh asked for during a hung read through the deadline", async () => {
    const calls: (AbortSignal | undefined)[] = [];
    const api: FeedApi = {
      recent: (_limit: number, signal?: AbortSignal) => {
        calls.push(signal);
        return new Promise<FeedView>(() => {});
      },
    };
    let handle: { current: ReturnType<typeof useFeed> | null } = { current: null };
    await act(async () => {
      handle = harness(api);
    });
    await act(async () => handle.current?.refresh());
    expect(calls).toHaveLength(1);
    await advance(FEED_READ_DEADLINE_MS);
    expect(calls).toHaveLength(2);
    expect(handle.current?.error?.kind).toBe("no-answer");
  });

  it("hands the api a signal, aborts it on unmount, and discards the late answer", async () => {
    const { api, calls } = manualApi();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await render(panel(api, collected([row("$1")])));
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);

    await act(async () => root.unmount());
    expect(calls[0]?.signal?.aborted).toBe(true);
    await answer(calls, 0, feedWith("too late"));
    expect(host.textContent).not.toContain("too late");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
    // afterEach unmounts again; give it a root to unmount.
    root = createRoot(host);
  });

  it("aborts and discards a read superseded by a new limit", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")]), 50));
    await render(panel(api, collected([row("$1")]), 100));
    expect(calls.map((c) => c.limit)).toEqual([50, 100]);
    expect(calls[0]?.signal?.aborted).toBe(true);

    await answer(calls, 1, feedWith("the fresh answer"));
    await answer(calls, 0, feedWith("the stale answer"));
    expect(visibleText()).toContain("the fresh answer");
    expect(visibleText()).not.toContain("the stale answer");
  });

  /**
   * **A TMUX RESTART MAKES EVERY HANDLE IN AN ANSWER SOMEBODY ELSE'S**, so a
   * read begun against the old server is thrown away rather than waited for,
   * and the floor does not hold the new one back.
   */
  it("discards the in-flight read and starts again when the tmux server changes", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")], 42)));
    expect(calls).toHaveLength(1);

    await render(panel(api, collected([row("$1")], 43)));
    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);

    await answer(calls, 1, feedWith("the new world", 43));
    await answer(calls, 0, feedWith("the old world", 42));
    expect(visibleText()).toContain("the new world");
    expect(visibleText()).not.toContain("the old world");
  });
});

/* ------------------------------------------------------------------ *
 * The clock, and the failure that does not empty the list.
 * ------------------------------------------------------------------ */

describe("what the panel says about its own age", () => {
  it("keeps the last good feed under a failure, and says how old it is", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("the good answer"));
    expect(visibleText()).toMatch(/read 0s ago/);

    await advance(125_000);
    await render(panel(api, collected([row("$1")])));
    expect(visibleText()).toMatch(/read 2m 5s ago/);

    await act(async () => readAgainButton().click());
    await answer(calls, 1, { kind: "no-answer", why: "this browser could not reach the dashboard: offline" });
    expect(visibleText()).toContain("the good answer");
    expect(visibleText()).toContain("offline");
    expect(visibleText()).toMatch(/read 2m 5s ago/);

    await act(async () => readAgainButton().click());
    await answer(calls, 2, { kind: "unreadable", why: "the collector has not run" });
    expect(visibleText()).toContain("the good answer");
    expect(visibleText()).toContain("the collector has not run");
    expect(visibleText()).not.toContain("offline");

    // And the next good read clears the error.
    await act(async () => readAgainButton().click());
    await answer(calls, 3, feedWith("the next good answer"));
    expect(visibleText()).toContain("the next good answer");
    expect(visibleText()).not.toContain("the collector has not run");
  });

  it("says on the clock what makes it re-read, and what it cannot notice", async () => {
    const { api, calls } = manualApi();
    await render(panel(api, collected([row("$1")])));
    await answer(calls, 0, feedWith("first"));
    const clock = [...host.querySelectorAll("button.explain")].find((b) => /read 0s ago/.test(b.textContent ?? ""));
    expect(clock?.textContent).toMatch(/without changing status/);
  });
});
