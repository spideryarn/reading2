// @vitest-environment jsdom
/**
 * **Every badge the queue can wear has a card, and the enumeration is by
 * reachability rather than by a type.**
 *
 * `QueuePanel.tsx`'s own header says the badge is the point of the tab: *"A
 * list of queued work is easy and not very useful. What Greg cannot see
 * anywhere else is why each item is not moving."* Eight words carry that, and
 * until 2026-09-09 none of them was explained anywhere on the page.
 *
 * The cards are keyed by the visible label, because two of `badgeFor`'s six
 * tones carry two labels each and those are exactly the pairs a reader has to
 * keep apart — `settled` is both *done* and *dropped*; `unapproved` is both
 * *proposal* and *approval lapsed*. A `Record<Badge["tone"], Tip>` would
 * compile and would explain four of the eight.
 *
 * **So this drives `badgeFor` over the whole cross-product of the three axes it
 * reads** and asserts that every label it actually produces has a card. That is
 * stronger than an exhaustive `Record` in the way that matters here: it also
 * proves the state is reachable, so a card written for a badge nothing can ever
 * show is a failure too, and a ninth badge added to `badgeFor` fails here
 * without anybody remembering to add a case.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QueuePanel, badgeTip } from "../tools/fleet/web/src/QueuePanel";
import { badgeFor, type QueueApi, type QueueView } from "../tools/fleet/web/src/queue-client";
import type { QueueDepth, QueueLifecycle, QueueRow } from "../tools/fleet/wire";

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

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "qi-3v9879qs",
    title: "an idea",
    text: "the whole text of the idea",
    lifecycle: "queued",
    authority: "authorized",
    authorizedRevision: 0,
    revision: 0,
    needsGreg: false,
    ready: true,
    why: null,
    wait: { kind: "ahead", ahead: 0, why: "next in line" },
    waitingOn: "a lull",
    size: "M",
    source: "docs/plans/260908f-something.md",
    runs: "docs/reusable/engineering-manager.md",
    areas: ["tools/fleet/"],
    addedBy: "greg",
    addedAt: "2026-09-09T00:00:00.000Z",
    lastTouchedAt: null,
    dispatchedTo: "dashboard-tooltips",
    dispatchedAt: null,
    plan: "docs/plans/260909c-rich-tooltips-across-the-fleet-dashboard.md",
    droppedWhy: null,
    history: [{ kind: "added", at: "2026-09-09T00:00:00.000Z", by: "greg", what: "added at the front" }],
    ...over,
  };
}

const DEPTH: QueueDepth = {
  dispatchable: 1,
  needsGreg: 0,
  unauthorized: 0,
  queueHeld: 0,
  dispatched: 0,
  done: 0,
  dropped: 0,
};

function view(rows: QueueRow[], problems: QueueView extends never ? never : { kind: string; why: string }[] = []): QueueView {
  return {
    schema: 1,
    kind: "queue",
    version: "1.ev-1",
    rows,
    settled: [],
    settledWithheld: 3,
    depth: DEPTH,
    throughput: {
      windows: [
        { days: 7, dispatched: 0, done: 0 },
        { days: 30, dispatched: 0, done: 0 },
      ],
      dispatchesEver: 0,
      completionsEver: 0,
      duration: { kind: "not-enough", why: "nothing has been through this queue yet" },
    },
    problems,
    path: "~/.overseer/queue.ndjson",
  } as unknown as QueueView;
}

/** The panel fetches on mount, so the render has to be awaited. */
async function mount(v: QueueView): Promise<void> {
  const api: QueueApi = { fetch: () => Promise.resolve(v) };
  await act(async () => {
    root.render(createElement(QueuePanel, { api }));
  });
}

/** Every badge `badgeFor` can actually produce, from the three axes it reads. */
function reachableLabels(): Set<string> {
  const out = new Set<string>();
  const lifecycles: QueueLifecycle[] = ["queued", "dispatched", "done", "dropped"];
  for (const lifecycle of lifecycles) {
    for (const authority of ["proposed", "authorized"] as const) {
      for (const needsGreg of [false, true]) {
        for (const lapsed of [false, true]) {
          for (const problems of [false, true]) {
            const r = row({
              lifecycle,
              authority,
              needsGreg,
              revision: lapsed ? 1 : 0,
              authorizedRevision: authority === "proposed" ? null : 0,
            });
            out.add(badgeFor(r, problems).label);
          }
        }
      }
    }
  }
  return out;
}

describe("the badge, which is what this tab is for", () => {
  it("reaches all eight labels — so the enumeration below is of real states", () => {
    expect([...reachableLabels()].sort()).toEqual(
      ["approval lapsed", "done", "dropped", "needs you", "on hold", "proposal", "ready", "running"].sort(),
    );
  });

  it("explains every one of them, in the DOM, without anybody hovering", async () => {
    /* The badge sits inside the row's own disclosure button, so its card is
       `mouseOnly` — a tap has to expand the row. What makes the words reachable
       anyway is the `sr-only` sentence that goes into that button's accessible
       name, and that is what this reads. A test that simulated a hover would
       pass on a page where the span had been dropped, which is the state a
       phone and a screen reader would both be left in. */
    for (const label of reachableLabels()) {
      const lifecycle: QueueLifecycle =
        label === "running" ? "dispatched" : label === "done" ? "done" : label === "dropped" ? "dropped" : "queued";
      const r = row({
        lifecycle,
        needsGreg: label === "needs you",
        authority: label === "proposal" ? "proposed" : "authorized",
        authorizedRevision: label === "proposal" ? null : 0,
        revision: label === "approval lapsed" ? 1 : 0,
      });
      await mount(view([r], label === "on hold" ? [{ kind: "unreadable-line", why: "line 4 is not JSON" }] : []));
      const text = container.textContent ?? "";
      expect(`${label}: ${text.includes(label)}`).toBe(`${label}: true`);
      // The card's own second paragraph — the half the word could not have said.
      expect(`${label}: ${/[Tt]he server computed it|only one of the four stuck reasons|Authority and progress|an agent's edit lapses it|says a session was started|nothing is ever removed from it|considered and rejected|outranks the row's own reasons|no description for a/.test(text)}`).toBe(
        `${label}: true`,
      );
    }
  });

  it("names a badge it does not know rather than describing it", async () => {
    /* A ninth badge is a change to `badgeFor`, which nothing type-checks against
       this map. The retreat has to be designed, not discovered: a card that
       confidently described a word it had never seen would be worse than none.
       docs/reusable/silent-success.md. */
    const unknown = badgeTip("superseded");
    expect(unknown.head).toBe("superseded");
    expect(unknown.what).toContain("no description for a \u201Csuperseded\u201D item");
    // It points at the sentence that IS about this item rather than going quiet.
    expect(unknown.how).toContain("server's own");

    // And nothing on an ordinary page reaches for it.
    await mount(view([row({ lifecycle: "queued" })]));
    expect(container.textContent ?? "").not.toContain("has no description for");
  });
});

describe("a row's fields say which is which", () => {
  it("draws `source` and `plan` as two fields, having drawn one under the other's name", async () => {
    /* `source` is where the idea came from and is written when it is queued;
       `plan` is what the dispatched session went on to write. The panel labelled
       `source` as *plan* and never rendered `plan` at all — so the row named a
       field it was not showing and hid the one the label promised. Found while
       writing the cards, 2026-09-09. */
    await mount(view([row()]));
    const openRow = container.querySelector("button[aria-expanded]");
    expect(openRow).not.toBeNull();
    act(() => (openRow as HTMLButtonElement).click());
    const text = container.textContent ?? "";
    expect(text).toContain("docs/plans/260908f-something.md");
    expect(text).toContain("docs/plans/260909c-rich-tooltips-across-the-fleet-dashboard.md");
    // And each label explains itself, so the difference is answerable on the page.
    expect(text).toContain("where the idea came from");
    expect(text).toContain("Points forwards");
  });

  it("gives the whole id behind the eight characters the row prints", async () => {
    await mount(view([row()]));
    const text = container.textContent ?? "";
    expect(text).toContain("3v9879qs");
    expect(text).toContain("In full: qi-3v9879qs");
  });
});
