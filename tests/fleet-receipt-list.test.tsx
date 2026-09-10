// @vitest-environment jsdom
/**
 * **WHAT IS PROVEN AND WHAT IS UNKNOWN, IN WORDS BUILT FROM THE FIELDS** —
 * `ReceiptList.tsx`, plan 260910d Stage 4.
 *
 * The list on the Overseer tab reads `GET /api/actions/receipts`. The failures
 * worth testing are the ones that look like working:
 *
 *  - **one label standing in for several facts** — "done" over a receipt that
 *    was only keys-submitted, or over one a person merely looked at;
 *  - **"delivered" or "read"**, which nothing on this box can establish;
 *  - **a journal that is not writing**, drawn like one that is;
 *  - **a session with an unknown outcome and no hold**, drawn as a quiet row.
 *
 * Every seam is a fake. Nothing reaches a network.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ReceiptsApi, ReceiptsFeed, ReceiptsReading, ReconcileOutcome } from "../tools/fleet/web/src/actions-client";
import { ReceiptList } from "../tools/fleet/web/src/ReceiptList";
import type { ReceiptSummary } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_800_700_000_000;

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
});

function receipt(over: Partial<ReceiptSummary> & { receiptId: string }): ReceiptSummary {
  return {
    op: "steer-message",
    origin: "direct-steer",
    pending: false,
    actor: { kind: "client-claimed", id: "greg" },
    speaker: "greg",
    target: { sessionId: "$71", paneId: "%71", claudeSessionId: "conv-list-1", tmuxGeneration: null },
    parentReceiptId: null,
    stepsCompleted: null,
    what: "message (12 characters)",
    acceptedAt: NOW - 120_000,
    state: "keys-submitted",
    reason: "transport-ok",
    attemptedAt: NOW - 119_000,
    outcomeAt: NOW - 118_000,
    reconciled: false,
    reconciliation: null,
    queueItemId: null,
    materialDeletionPending: false,
    ...over,
  };
}

const KEYS = receipt({ receiptId: "a1-r1" });
const WITHDRAWN = receipt({
  receiptId: "a1-r2",
  op: "queued-message",
  origin: "enqueue",
  state: "withdrawn",
  reason: "cancelled",
  attemptedAt: null,
  outcomeAt: null,
  queueItemId: "a1-q2",
});
const NOT_SENT = receipt({ receiptId: "a1-r3", state: "not-sent", reason: "session-held" });
const UNKNOWN_PLAN = receipt({
  receiptId: "a1-r4",
  op: "enacted-session",
  origin: "enacted",
  what: "remove-worktree",
  state: "outcome-unknown",
  reason: "interrupted",
  stepsCompleted: 1,
});
const LOOKED_AT = receipt({
  receiptId: "a1-r5",
  op: "enacted-box",
  origin: "enacted",
  target: null,
  what: "kill-test-suites",
  state: "outcome-unknown",
  reason: "threw",
  stepsCompleted: 0,
  reconciled: true,
  reconciliation: { disposition: "operator-confirmed", actor: { kind: "client-claimed", id: "greg" }, at: NOW - 60_000 },
});
const QUEUED = receipt({
  receiptId: "a1-r6",
  op: "queued-message",
  origin: "enqueue",
  pending: true,
  state: "accepted",
  reason: null,
  attemptedAt: null,
  outcomeAt: null,
  queueItemId: "a1-q6",
});
const UNKNOWN_MESSAGE = receipt({ receiptId: "a1-r7", state: "outcome-unknown", reason: "partial" });

function feed(over: Partial<ReceiptsFeed> = {}): ReceiptsFeed {
  return {
    durable: true,
    status: { neverOpened: false, lockedOutBy: null, failure: null, unreadableLines: 0, illegalTransitions: 0, materialDeletionPending: 0 },
    recovery: { blocked: false, reason: null },
    receipts: [KEYS, WITHDRAWN, NOT_SENT, UNKNOWN_PLAN, LOOKED_AT, QUEUED, UNKNOWN_MESSAGE],
    unreadable: 0,
    unknownWithoutHold: [],
    ...over,
  };
}

function fakeApi(readings: ReceiptsReading[], reconcile: ReconcileOutcome = { ok: true, repeat: false, receipt: UNKNOWN_PLAN }) {
  const calls = { reads: 0, reconciles: [] as Array<[string, string]>, signals: [] as AbortSignal[] };
  const api: ReceiptsApi = {
    read: async (signal) => {
      calls.reads += 1;
      if (signal !== undefined) calls.signals.push(signal);
      const next = readings[Math.min(calls.reads - 1, readings.length - 1)];
      if (next === undefined) throw new Error("the fake was given no readings");
      return next;
    },
    reconcile: async (receiptId, disposition) => {
      calls.reconciles.push([receiptId, disposition]);
      return reconcile;
    },
  };
  return { api, calls };
}

async function show(api: ReceiptsApi, pollMs = 60_000): Promise<void> {
  act(() => root.render(<ReceiptList api={api} pollMs={pollMs} now={() => NOW} />));
  await act(async () => {});
}

function text(): string {
  return container.textContent ?? "";
}

function item(receiptId: string): string {
  const el = container.querySelector(`[data-receipt="${receiptId}"]`);
  if (el === null) throw new Error(`no receipt ${receiptId} on screen: ${text()}`);
  return el.textContent ?? "";
}

async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

describe("the words for each receipt", () => {
  it("says keys submitted, never delivered or read", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(item("a1-r1")).toContain("keys submitted");
    expect(item("a1-r1")).toContain("accepted 2m ago");
    expect(item("a1-r1")).toContain("attempted");
    for (const overclaim of ["delivered", "was read", "received"]) expect(text()).not.toContain(overclaim);
  });

  it("says withdrawn and why, which is proof nothing was sent", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(item("a1-r2")).toContain("withdrawn");
    expect(item("a1-r2")).toContain("cancelled");
    expect(item("a1-r2")).toContain("not attempted");
  });

  it("says not sent and why", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(item("a1-r3")).toContain("not sent");
    expect(item("a1-r3")).toContain("held");
  });

  it("says outcome unknown and why, and how far a plan is known to have got", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(item("a1-r4")).toContain("outcome unknown");
    expect(item("a1-r4")).toContain("interrupted");
    expect(item("a1-r4")).toContain("1 step known to have completed");
    expect(item("a1-r7")).toContain("outcome unknown");
  });

  it("says who reconciled an unknown, as a person's statement and not as proof — and it is still unknown", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    const words = item("a1-r5");
    expect(words).toContain("outcome unknown");
    expect(words).toContain("greg");
    expect(words).toContain("not proof");
  });

  it("says a queued receipt is accepted and not yet attempted", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(item("a1-r6")).toContain("not yet attempted");
    expect(item("a1-r6")).toContain("a1-q6");
  });
});

describe("the journal, and the sessions nothing is holding", () => {
  it("says, loudly, when receipts are not being kept on disk", async () => {
    await show(
      fakeApi([
        {
          ok: true,
          feed: feed({
            durable: false,
            status: {
              neverOpened: false,
              lockedOutBy: null,
              failure: "disk full while writing receipts",
              unreadableLines: 2,
              illegalTransitions: 0,
              materialDeletionPending: 0,
            },
          }),
        },
      ]).api,
    );
    expect(text()).toContain("not being kept on disk");
    expect(text()).toContain("disk full while writing receipts");
    expect(text()).toContain("2 unreadable lines");
  });

  it("draws nothing about the journal when it is durable", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    expect(text()).not.toContain("not being kept on disk");
  });

  it("names every session with an unknown outcome and no hold", async () => {
    await show(fakeApi([{ ok: true, feed: feed({ unknownWithoutHold: [{ sessionId: "$77", receiptIds: ["a1-r9", "a1-r10"] }] }) }]).api);
    const loud = container.querySelector("[data-unknown-without-hold]");
    expect(loud?.textContent ?? "").toContain("$77");
    expect(loud?.textContent ?? "").toContain("no hold");
    expect(loud?.textContent ?? "").toContain("2");
  });
});

describe("reconciling", () => {
  it("offers the two statements only on an unknown enacted plan nobody has reconciled", async () => {
    await show(fakeApi([{ ok: true, feed: feed() }]).api);
    const offered = [...container.querySelectorAll("button[data-disposition]")].map(
      (b) => `${b.closest("[data-receipt]")?.getAttribute("data-receipt")}:${b.getAttribute("data-disposition")}`,
    );
    expect(offered.sort()).toEqual(["a1-r4:abandoned-unknown", "a1-r4:operator-confirmed"]);
  });

  it("records the one pressed, and reads the list again", async () => {
    const { api, calls } = fakeApi([{ ok: true, feed: feed() }]);
    await show(api);
    const readsBefore = calls.reads;
    const pressed = container.querySelector<HTMLButtonElement>('[data-receipt="a1-r4"] button[data-disposition="operator-confirmed"]');
    await act(async () => {
      pressed?.click();
    });
    await act(async () => {});
    expect(calls.reconciles).toEqual([["a1-r4", "operator-confirmed"]]);
    expect(calls.reads).toBeGreaterThan(readsBefore);
  });

  it("shows the server's sentence when a statement is refused", async () => {
    const { api } = fakeApi([{ ok: true, feed: feed() }], {
      ok: false,
      code: "reconciled-otherwise",
      why: "somebody already recorded a different statement",
      from: "server",
    });
    await show(api);
    const pressed = container.querySelector<HTMLButtonElement>('[data-receipt="a1-r4"] button[data-disposition="abandoned-unknown"]');
    await act(async () => {
      pressed?.click();
    });
    expect(text()).toContain("somebody already recorded a different statement");
  });
});

describe("reading", () => {
  it("keeps the last good list when a read fails, and says why", async () => {
    const { api } = fakeApi([{ ok: true, feed: feed() }, { ok: false, why: "the dashboard did not answer" }]);
    await show(api, 15);
    await wait(60);
    expect(text()).toContain("the dashboard did not answer");
    expect(item("a1-r1")).toContain("keys submitted");
  });

  it("stops reading, and aborts the read, when it is unmounted", async () => {
    const { api, calls } = fakeApi([{ ok: true, feed: feed() }]);
    await show(api, 15);
    act(() => root.unmount());
    const after = calls.reads;
    await wait(60);
    expect(calls.reads).toBe(after);
    root = createRoot(container);
  });
});
