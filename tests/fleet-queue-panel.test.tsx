// @vitest-environment jsdom
/**
 * The Queued ideas panel — tools/fleet/web/src/QueuePanel.tsx and its client.
 *
 * **WHAT THIS FILE IS REALLY DEFENDING.** Not that a list renders. Two things:
 *
 *  1. **Every kind of nothing draws differently.** Five of them reach this
 *     panel, and collapsing any two produces an empty list — which reads as
 *     *nothing is queued* over the record of what Greg has actually asked for.
 *     The loud one is `unreadable`: the Overseer's own store may cold-start
 *     because losing it costs only history, and this file is not like that.
 *  2. **The four reasons an item is stuck stay apart.** *Waiting on you*,
 *     *never approved*, *approved then edited* and *next in line* send a reader
 *     to four different actions, and only the first is Greg's to clear. A single
 *     "blocked" badge would delete the tab's whole value.
 *
 * Driven with an injected `QueueApi` — no `fetch`, no clock, no server.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QueuePanel } from "../tools/fleet/web/src/QueuePanel";
import { badgeFor, depthClauses, readPayload, shortId, type QueueApi, type QueueView } from "../tools/fleet/web/src/queue-client";
import type { QueueDepth, QueueRow } from "../tools/fleet/wire";

/** What `act` looks for. Without it React warns on every render — `fleet-web.test.tsx` sets the same flag. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const ROW: QueueRow = {
  id: "qi-aaaaaaaa",
  title: "an idea Greg approved",
  text: "the whole text of the idea",
  lifecycle: "queued",
  authority: "authorized",
  authorizedRevision: 0,
  revision: 0,
  needsGreg: false,
  ready: true,
  why: null,
  wait: { kind: "ahead", ahead: 0, why: "next in line — nothing authorised and unblocked is ahead of it" },
  waitingOn: "a lull",
  size: "M",
  source: "docs/plans/260908f-something.md",
  runs: "docs/reusable/engineering-manager.md",
  areas: ["tools/fleet/"],
  addedBy: "greg",
  addedAt: "2026-09-09T00:00:00.000Z",
  lastTouchedAt: null,
  dispatchedTo: null,
  dispatchedAt: null,
  plan: null,
  droppedWhy: null,
  history: [{ kind: "added", at: "2026-09-09T00:00:00.000Z", by: "greg", what: "added" }],
  priority: 0.7,
  priorityBy: "overseer",
  priorityAt: "2026-09-09T08:30:00.000Z",
};

/**
 * What a sighted reader actually sees, with the screen-reader spans removed.
 *
 * **Written because an assertion that used the raw `textContent` could not
 * fail.** Every tooltip in a row carries its sentence in a `tw:sr-only` span
 * that begins " — ", so `toContain("—")` was satisfied by the badge's tooltip
 * no matter what the priority rendered: the guard for *"an unstated priority is
 * visibly marked"* passed with the marker deleted. Mutation-checked both ways
 * after this landed. [silent-success.md](../docs/reusable/silent-success.md).
 */
function visibleText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[class~="tw:sr-only"]')) hidden.remove();
  return copy.textContent ?? "";
}

/** A phrase only the priority tooltip says, so the cell can be found by it. */
const PRIORITY_HINT = "an unranked item sorts below every ranked one";

/**
 * What the priority reads as on one row, and nothing else on that row.
 *
 * **The row as a whole is the wrong thing to assert against**, and both obvious
 * ways of doing it are guards that cannot fail: every tooltip's `sr-only` span
 * begins " — ", and the wait sentence *"next in line — nothing authorised…"* is
 * visible. So a test asking whether the row contains an em dash is answered
 * *yes* by two other elements, with the priority marker deleted.
 */
function priorityCell(button: Element): string {
  const cell = [...button.querySelectorAll("span")].find(
    (span) =>
      !span.matches('[class~="tw:sr-only"]') &&
      span.querySelector('[class~="tw:sr-only"]')?.textContent?.includes(PRIORITY_HINT) === true,
  );
  if (cell === undefined) throw new Error("no priority cell on that row");
  return visibleText(cell).trim();
}

const DEPTH: QueueDepth = { dispatchable: 1, needsGreg: 0, unauthorized: 0, queueHeld: 0, dispatched: 0, done: 0, dropped: 0 };

function queueView(over: Partial<Extract<QueueView, { kind: "queue" }>> = {}): QueueView {
  return {
    schema: 1,
    kind: "queue",
    version: "1.ev-1",
    rows: [ROW],
    settled: [],
    settledWithheld: 0,
    depth: DEPTH,
    throughput: {
      windows: [
        { days: 7, dispatched: 0, done: 0 },
        { days: 30, dispatched: 0, done: 0 },
      ],
      dispatchesEver: 0,
      completionsEver: 0,
      duration: { kind: "not-enough", why: "nothing has been through this queue yet, so there is nothing to time" },
    },
    problems: [],
    path: "/tmp/fake/queue.jsonl",
    ...over,
  };
}

async function render(view: QueueView): Promise<void> {
  const api: QueueApi = { fetch: () => Promise.resolve(view) };
  await act(async () => {
    root.render(<QueuePanel api={api} />);
  });
}

describe("every kind of nothing draws differently", () => {
  it("never-written says nobody has used the queue", async () => {
    await render({ schema: 1, kind: "never-written", why: "no queue file has been written yet" });
    expect(container.textContent).toContain("Nothing has been queued here yet");
    expect(container.textContent).toContain("no queue file has been written yet");
  });

  it("an empty but readable queue says something DIFFERENT from never-written", async () => {
    await render(queueView({ rows: [], depth: { ...DEPTH, dispatchable: 0 } }));
    expect(container.textContent).toContain("Nothing is waiting");
    /* The distinction, spelled out on the page rather than left to the reader. */
    expect(container.textContent).toContain("not the\n            same as nothing ever having been queued".replace(/\s+/g, " "));
  });

  it("unreadable is LOUD and says it is not an empty queue", async () => {
    /* The one that matters most: a lost authorisation record must never be
       drawn as a healthy empty one. */
    await render({ schema: 1, kind: "unreadable", why: "line 4 is not an event this build understands" });
    expect(container.textContent).toContain("The queue file could not be read");
    expect(container.textContent).toContain("line 4");
    expect(container.textContent).toContain("This is not an empty queue");
    /* And it tells the reader the consequence. */
    expect(container.textContent).toContain("nothing in it should be dispatched");
  });

  it("no-answer speaks in the BROWSER's voice, not the server's", async () => {
    await render({ kind: "no-answer", why: "this browser could not reach the dashboard" });
    /* "This tab could not read it" rather than "the queue is broken" — a
       phone's own network trouble must not become a claim about the box. */
    expect(container.textContent).toContain("This tab could not read the queue");
  });

  it("says it is loading rather than drawing an empty queue first", async () => {
    /* A panel that rendered "nothing is waiting" for a frame before its answer
       arrived would flash a false claim on every visit. */
    const api: QueueApi = { fetch: () => new Promise(() => {}) };
    await act(async () => {
      root.render(<QueuePanel api={api} />);
    });
    expect(container.textContent).toContain("Reading the queue");
    expect(container.textContent).not.toContain("Nothing is waiting");
  });
});

describe("the badge keeps the four reasons apart", () => {
  const cases: [string, Partial<QueueRow>, string][] = [
    ["ready", {}, "ready"],
    ["waiting on Greg", { needsGreg: true, ready: false, why: "it is waiting on Greg, not on a slot" }, "needs you"],
    ["never approved", { authority: "proposed", authorizedRevision: null, ready: false, why: "nobody has authorised this yet" }, "proposal"],
    ["approved then edited", { revision: 2, authorizedRevision: 0, ready: false, why: "the approval no longer names what this says" }, "approval lapsed"],
    ["running", { lifecycle: "dispatched", ready: false, dispatchedTo: "some-session" }, "running"],
    ["done", { lifecycle: "done", ready: false }, "done"],
    ["dropped", { lifecycle: "dropped", ready: false }, "dropped"],
  ];

  for (const [name, over, label] of cases) {
    it(`labels ${name} as "${label}"`, () => {
      expect(badgeFor({ ...ROW, ...over }, false).label).toBe(label);
    });
  }

  it("labels a row held only by the file as `on hold`", () => {
    expect(badgeFor({ ...ROW, wait: { kind: "queue-held", why: "x" } }, true).label).toBe("on hold");
  });

  it("a queue-wide problem outranks every per-item verdict", () => {
    /* While the file has a hole in it nothing is dispatchable, so a green
       "ready" badge on a perfectly good row would be a lie about the queue. */
    expect(badgeFor(ROW, true).label).toBe("on hold");
    expect(badgeFor({ ...ROW, needsGreg: true }, true).label).toBe("on hold");
  });

  it("renders the badge and the server's own reason on the row", async () => {
    await render(
      queueView({
        rows: [{ ...ROW, needsGreg: true, ready: false, why: "it is waiting on Greg, not on a slot" }],
      }),
    );
    expect(container.textContent).toContain("needs you");
    /* The server's sentence, verbatim — this panel never paraphrases a verdict. */
    expect(container.textContent).toContain("it is waiting on Greg, not on a slot");
  });
});

describe("problems", () => {
  it("puts them above everything, and says nothing is dispatchable", async () => {
    await render(
      queueView({ problems: [{ kind: "unreadable-line", why: "line 3 is not an event this build understands" }] }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("One problem");
    expect(text).toContain("nothing here is dispatchable");
    expect(text).toContain("line 3");
    /* Above the rows, not after them. */
    expect(text.indexOf("One problem")).toBeLessThan(text.indexOf("an idea Greg approved"));
  });

  it("does NOT also say those rows are unapproved, or promise them a place in line", async () => {
    /* **GPT Sol's P2-2: the panel used to contradict itself in one view.**
       `isDispatchable` is false for everything while the file has a problem, so
       the header said `12 not approved` — of twelve perfectly approved rows —
       and each row still said "next in line", directly under the alarm
       explaining that the file was the trouble. */
    await render(
      queueView({
        problems: [{ kind: "unknown-item", why: "an event names an id that was never added" }],
        depth: { ...DEPTH, dispatchable: 0, queueHeld: 1 },
        rows: [
          {
            ...ROW,
            ready: false,
            why: "the queue has 1 unresolved problem(s), so nothing in it is dispatchable",
            wait: { kind: "queue-held", why: "waiting for somebody to fix the record" },
          },
        ],
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("held by a broken queue file");
    expect(text).toContain("waiting for somebody to fix the record");
    expect(text).not.toContain("not approved");
    expect(text).not.toContain("next in line");
  });

  it("pluralises honestly", async () => {
    await render(
      queueView({
        problems: [
          { kind: "unknown-item", why: "one" },
          { kind: "duplicate-item", why: "two" },
        ],
      }),
    );
    expect(container.textContent).toContain("2 problems");
  });
});

describe("the header", () => {
  it("shows only the non-zero clauses", () => {
    expect(depthClauses({ dispatchable: 12, needsGreg: 4, unauthorized: 0, queueHeld: 0, dispatched: 0, done: 9, dropped: 1 })).toEqual([
      "12 ready",
      "4 need you",
    ]);
    expect(depthClauses({ dispatchable: 0, needsGreg: 0, unauthorized: 0, queueHeld: 0, dispatched: 0, done: 0, dropped: 0 })).toEqual([]);
  });

  it("says the queue is empty rather than printing a row of zeroes", async () => {
    await render(queueView({ rows: [], depth: { ...DEPTH, dispatchable: 0 } }));
    expect(container.textContent).toContain("The queue is empty");
    expect(container.textContent).not.toContain("0 ready");
  });

  it("prints throughput and the reason there is no ETA", async () => {
    await render(queueView());
    expect(container.textContent).toContain("0 dispatched in 7d");
    expect(container.textContent).toContain("0 dispatched in 30d");
    expect(container.textContent).toContain("nothing has been through this queue yet");
  });

  it("NEVER prints a duration, and does say why not", async () => {
    /* Greg asked for one; idea-queue-wait.ts says why he is not getting one.
       This assertion is what would notice somebody adding it back.

       **It forbids a FIGURE, not the word "ETA"** — the first version banned
       `/ETA/` and went red on the panel's own tooltip, which is headed *Why
       there is no ETA*. A guard that fires on the explanation as well as the
       thing being explained is a guard nobody can leave in place. */
    await render(queueView());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/about \d+ (day|hour|minute|week)/i);
    expect(text).not.toMatch(/\bin (about|roughly|~)/i);
    expect(text).not.toMatch(/\d+\s*(–|-|to)\s*\d+\s*(day|hour|week)/i);
    /* And the absence is explained rather than left as a gap. */
    expect(text).toContain("Why there is no ETA");
  });

  it("says where to write, and names the file and version", async () => {
    /* A reader who taps a row and finds nothing happens must not be left
       guessing why. */
    await render(queueView());
    expect(container.textContent).toContain("Read-only here");
    expect(container.textContent).toContain("scripts/overseer-queue.ts");
    expect(container.textContent).toContain("/tmp/fake/queue.jsonl");
    expect(container.textContent).toContain("1.ev-1");
  });
});

describe("rows", () => {
  it("keeps the order supplied by the server, even when priority would sort it differently", async () => {
    await render(
      queueView({
        rows: [
          { ...ROW, id: "qi-aaaaaaaa", title: "first from server", priority: 0.1 },
          { ...ROW, id: "qi-bbbbbbbb", title: "second from server", priority: 0.9 },
        ],
      }),
    );
    const text = container.textContent ?? "";
    const first = text.indexOf("first from server");
    const second = text.indexOf("second from server");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it("shows a stated priority and makes an unstated one visibly unstated", async () => {
    await render(
      queueView({
        rows: [ROW, { ...ROW, id: "qi-bbbbbbbb", title: "an unranked idea", priority: null }],
      }),
    );
    const buttons = [...container.querySelectorAll("button")];
    const ranked = buttons.find((button) => button.textContent?.includes("an idea Greg approved"));
    const unranked = buttons.find((button) => button.textContent?.includes("an unranked idea"));
    if (ranked === undefined || unranked === undefined) throw new Error("both rows should have rendered");
    /* Exact equality on the cell itself, not `toContain` on the row: the point
       of the assertion is that something is *there*, and a substring check
       against a whole row is satisfied by the em dashes in its tooltips and its
       wait sentence. */
    expect(priorityCell(ranked)).toBe("0.7");
    expect(priorityCell(unranked)).toBe("—");
    /* The explanation still has to reach a screen reader, so this one is
       deliberately asked of the full text rather than the visible half. */
    expect(unranked.textContent).toContain(PRIORITY_HINT);

    await act(async () => {
      unranked?.click();
    });
    expect(container.textContent).toContain("priority");
    expect(container.textContent).toContain("unstated — below every ranked item");
  });

  it("opens one to show its facts and its history", async () => {
    await render(queueView());
    /* Collapsed: the history is not on screen. */
    expect(container.textContent).not.toContain("History");
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("an idea Greg approved"));
    await act(async () => {
      button?.click();
    });
    expect(container.textContent).toContain("History");
    expect(container.textContent).toContain("the whole text of the idea");
    expect(container.textContent).toContain("docs/reusable/engineering-manager.md");
    expect(container.textContent).toContain("priority set");
    expect(container.textContent).toContain("set by overseer, 2026-09-09");
    expect(container.textContent).toContain("granted for revision 0");
  });

  it("explains a lapsed approval in the open row", async () => {
    await render(queueView({ rows: [{ ...ROW, revision: 2, authorizedRevision: 0, ready: false, why: "edited since" }] }));
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("an idea"));
    await act(async () => {
      button?.click();
    });
    expect(container.textContent).toContain("granted for revision 0, now at 2");
  });

  it("lists settled items separately and says how many are not shown", async () => {
    await render(
      queueView({
        settled: [{ ...ROW, id: "qi-bbbbbbbb", title: "a finished one", lifecycle: "done", ready: false }],
        settledWithheld: 7,
      }),
    );
    expect(container.textContent).toContain("Recently settled");
    expect(container.textContent).toContain("7 older not shown");
    expect(container.textContent).toContain("a finished one");
  });
});

describe("readPayload", () => {
  it("takes the three server arms", () => {
    expect(readPayload(queueView())?.kind).toBe("queue");
    expect(readPayload({ schema: 1, kind: "never-written", why: "x" })?.kind).toBe("never-written");
    expect(readPayload({ schema: 1, kind: "unreadable", why: "x" })?.kind).toBe("unreadable");
  });

  it("refuses anything it does not recognise rather than coercing it", () => {
    /* A proxy error page, a 405 from a stricter build and a later schema all
       arrive as valid JSON. Coercing any of them would draw an empty queue. */
    expect(readPayload(null)).toBeNull();
    expect(readPayload("a string")).toBeNull();
    expect(readPayload({ schema: 2, kind: "queue" })).toBeNull();
    expect(readPayload({ schema: 1, kind: "something-newer" })).toBeNull();
    expect(readPayload({ schema: 1, kind: "unreadable" })).toBeNull(); // no `why`
    expect(readPayload({ schema: 1, kind: "queue", rows: [] })).toBeNull(); // no settled, no version
    expect(readPayload({ schema: 1, kind: "queue", rows: [], settled: [] })).toBeNull(); // no version
  });

  it("normalises absent and non-numeric row priorities to honestly unstated", () => {
    const queued = { ...ROW } as Record<string, unknown>;
    delete queued["priority"];
    const settled = { ...ROW, priority: "urgent" } as Record<string, unknown>;
    const parsed = readPayload({ ...queueView(), rows: [queued], settled: [settled] });
    expect(parsed?.kind).toBe("queue");
    if (parsed?.kind !== "queue") return;
    expect(parsed.rows[0]?.priority).toBeNull();
    expect(parsed.settled[0]?.priority).toBeNull();
  });
});

describe("shortId", () => {
  it("drops the prefix every row shares, and leaves anything else alone", () => {
    expect(shortId("qi-a3k9mq2p")).toBe("a3k9mq2p");
    expect(shortId("something-else")).toBe("something-else");
  });
});
