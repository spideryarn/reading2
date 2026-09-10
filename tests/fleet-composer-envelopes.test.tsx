// @vitest-environment jsdom
/**
 * **THE THREE COMPOSERS KEEP AN ENVELOPE, AND CARRY THEIR TICKET IN IT** —
 * plan 260910d, Stage 4, and the seam agreed with `session-continuity`.
 *
 * Each composer — the session composer's Send and Queue, the Overseer card and
 * the broadcast — takes a `DraftSubmission` at Send and puts it in the
 * envelope. What this file pins, composer by composer:
 *
 *  - **`not-confirmed` never accepts.** The words stay in the box and in
 *    sessionStorage, the card says it cannot tell, and it offers **Check**
 *    instead of a second Send.
 *  - **Check resends the same envelope with the ORIGINAL ticket.** Typing
 *    after Send and then Check → replay keeps the new typing: a fresh ticket
 *    would have cleared it (docs/postmortems/260910c).
 *  - **A replay accepts.** It is a definitive success.
 *  - **409 and 503 are definitive refusals**: the draft stays, the envelope
 *    goes, nothing resends by itself.
 *  - **A reload loses the envelope**, so the next Send is a new intention with
 *    a new id and a new ticket — never the old ticket.
 *
 * Every seam is a fake. Nothing reaches a network, and nothing reaches tmux.
 * Conversation ids are not uuids, for tests/fixture-ids.test.ts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ActionOutcome, ActionsApi, SessionMessageBody } from "../tools/fleet/web/src/actions-client";
import { BroadcastCard } from "../tools/fleet/web/src/BroadcastCard";
import type { BroadcastApi, BroadcastBody, BroadcastOutcome } from "../tools/fleet/web/src/broadcast-client";
import { draftKey, resetDraftPageStateForTests } from "../tools/fleet/web/src/drafts";
import { MessageOverseerCard } from "../tools/fleet/web/src/MessageOverseerCard";
import type { KeyedOutcome, RequestEnvelope } from "../tools/fleet/web/src/request-envelope";
import { SessionDetail } from "../tools/fleet/web/src/SessionDetail";
import type { SteerApi, SteerMessageBody, SteerOutcome } from "../tools/fleet/web/src/steer-client";
import type { FleetRow } from "../tools/fleet/web/src/types";
import type { ActionsUi } from "../tools/fleet/web/src/useActions";
import type { ExecutionReading, ReceiptSummary } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  window.sessionStorage.clear();
  resetDraftPageStateForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/* ------------------------------------------------------------------ *
 * Fixtures.
 * ------------------------------------------------------------------ */

const NOT_CONFIRMED_PHRASE = "may or may not have acted on it";

function running(conversation: string, pid = 8100): ExecutionReading {
  return {
    kind: "verified",
    token: { boot: "envelope-composer-boot", pid, startTicks: 90_000 + pid },
    harness: "claude-code",
    conversation: { kind: "verified", id: conversation },
  };
}

function row(over: Partial<FleetRow> & { id: string }): FleetRow {
  const status = over.status ?? { kind: "idle" as const };
  return {
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    paneId: `%${over.id.slice(1)}`,
    name: over.id,
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-10T00:00:00Z").toISOString(),
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: 4343,
    claudeSessionId: "conv-envelope-default",
    rawStatus: status,
    rawQuestion: null,
    ...over,
  };
}

function receipt(over: Partial<ReceiptSummary> = {}): ReceiptSummary {
  return {
    receiptId: "e1e1e1e1-r1",
    op: "steer-message",
    origin: "direct-steer",
    pending: false,
    actor: { kind: "client-claimed", id: "greg" },
    speaker: "greg",
    target: { sessionId: "$1643", paneId: "%1643", claudeSessionId: "conv-overseer-9", tmuxGeneration: null },
    parentReceiptId: null,
    stepsCompleted: null,
    what: "message (5 characters)",
    acceptedAt: Date.now() - 3_000,
    state: "keys-submitted",
    reason: "transport-ok",
    attemptedAt: Date.now() - 2_900,
    outcomeAt: Date.now() - 2_800,
    reconciled: false,
    reconciliation: null,
    queueItemId: null,
    materialDeletionPending: false,
    ...over,
  };
}

const NOT_CONFIRMED = { kind: "not-confirmed", why: "this browser could not reach the dashboard: Failed to fetch" } as const;
const REPLAY = { kind: "replay", receipt: receipt(), children: null } as const;
const NOT_SENT_REPLAY = {
  kind: "replay",
  receipt: receipt({ state: "not-sent", reason: "session-held", attemptedAt: null }),
  children: null,
} as const;
const CONFLICT = {
  kind: "request-id-conflict",
  why: "request id rq-x was already used for a different request. Nothing was done.",
  status: 409,
} as const;
const UNAVAILABLE = {
  kind: "receipt-unavailable",
  why: "nothing was done: this action could not be given a receipt first (the disk is full)",
  status: 503,
} as const;
const SENT: KeyedOutcome<SteerOutcome> = {
  kind: "answered",
  outcome: { ok: true, op: "message", sent: [], verified: { kind: "not-told" } },
};

/* ------------------------------------------------------------------ *
 * Seams that record every envelope.
 * ------------------------------------------------------------------ */

function refuse(): never {
  throw new Error("this test does not expect that call");
}

function keyedSteer(answers: KeyedOutcome<SteerOutcome>[]) {
  const envelopes: RequestEnvelope<SteerMessageBody, unknown>[] = [];
  const api: SteerApi = {
    message: () => {
      throw new Error("a composer must send an envelope, not bare text");
    },
    answer: refuse,
    keyed: {
      message: async (envelope) => {
        envelopes.push(envelope);
        const next = answers.shift();
        if (next === undefined) throw new Error("the fake steer ran out of answers");
        return next;
      },
      answer: refuse,
    },
  };
  return { api, envelopes };
}

function keyedActions(answers: KeyedOutcome<ActionOutcome>[]) {
  const envelopes: RequestEnvelope<SessionMessageBody, unknown>[] = [];
  const api: ActionsApi = {
    feed: async () => ({ ok: false, why: "no feed in this test" }),
    run: refuse,
    queueMessage: () => {
      throw new Error("a composer must queue an envelope, not bare text");
    },
    cancel: refuse,
    revive: refuse,
    abandon: refuse,
    clear: refuse,
    releaseHold: refuse,
    boxPreview: refuse,
    boxConfirm: refuse,
    keyed: {
      queueMessage: async (envelope) => {
        envelopes.push(envelope);
        const next = answers.shift();
        if (next === undefined) throw new Error("the fake queue ran out of answers");
        return next;
      },
      run: refuse,
      boxConfirm: refuse,
    },
  };
  return { api, envelopes };
}

/* ------------------------------------------------------------------ *
 * Page helpers.
 * ------------------------------------------------------------------ */

function render(node: Parameters<Root["render"]>[0]): void {
  act(() => root.render(node));
}

/** What iOS does when it reclaims the tab: the page goes, sessionStorage stays. */
function reload(node: Parameters<Root["render"]>[0]): void {
  act(() => root.unmount());
  resetDraftPageStateForTests();
  root = createRoot(container);
  render(node);
}

function text(): string {
  return container.textContent ?? "";
}

/**
 * The button whose own label is this, else the first that starts with it. An
 * exact match first, because Queue sits inside a tooltip trigger that is a
 * button too, and its text starts with the same words — clicking that one
 * presses nothing.
 */
function findButton(label: string): HTMLButtonElement | null {
  const all = [...container.querySelectorAll("button")];
  const exact = all.find((b) => (b.textContent ?? "").trim() === label);
  const prefix = all.find((b) => (b.textContent ?? "").trim().startsWith(label));
  return (exact ?? prefix ?? null) as HTMLButtonElement | null;
}

function button(label: string): HTMLButtonElement {
  const found = findButton(label);
  if (found === null) throw new Error(`no button starting ${JSON.stringify(label)} in: ${text()}`);
  return found;
}

async function press(label: string): Promise<void> {
  const found = button(label);
  await act(async () => {
    found.click();
  });
}

function box(): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  if (el === null) throw new Error(`no textarea on screen; it says: ${text()}`);
  return el;
}

function type(value: string): void {
  const input = box();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/* ------------------------------------------------------------------ *
 * The Overseer card.
 * ------------------------------------------------------------------ */

describe("the Overseer card", () => {
  const CONVERSATION = "conv-overseer-9";
  const KEY = draftKey("overseer-message", CONVERSATION);
  const rows = (): FleetRow[] => [
    row({ id: "$1643", name: "the-overseer", role: { kind: "overseer" }, claudeSessionId: CONVERSATION, execution: running(CONVERSATION) }),
  ];
  const card = (steer: SteerApi) => <MessageOverseerCard rows={rows()} unreadableRows={0} steer={steer} />;

  it("two taps before the first answer still send one intention once", () => {
    const envelopes: RequestEnvelope<SteerMessageBody, unknown>[] = [];
    const api: SteerApi = {
      message: refuse,
      answer: refuse,
      keyed: {
        message: (envelope) => {
          envelopes.push(envelope);
          return new Promise(() => {});
        },
        answer: refuse,
      },
    };
    render(card(api));
    type("hold the queue");
    act(() => {
      button("Send").click();
      button("Send").click();
    });

    expect(envelopes).toHaveLength(1);
  });

  it("keeps the words and offers Check, never a second Send, when a send is not confirmed", async () => {
    const { api, envelopes } = keyedSteer([NOT_CONFIRMED]);
    render(card(api));
    type("hold the queue until noon");
    await press("Send");

    expect(envelopes).toHaveLength(1);
    expect(text()).toContain(NOT_CONFIRMED_PHRASE);
    expect(box().value).toBe("hold the queue until noon");
    expect(window.sessionStorage.getItem(KEY)).toBe("hold the queue until noon");
    expect(findButton("Check")).not.toBeNull();
    expect(button("Send").disabled).toBe(true);
  });

  it("Check resends the same envelope with the original ticket, and a replay keeps what was typed since", async () => {
    const { api, envelopes } = keyedSteer([NOT_CONFIRMED, REPLAY]);
    render(card(api));
    type("hold the queue");
    await press("Send");
    type("hold the queue, and tell me when");
    await press("Check");

    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toBe(envelopes[0]);
    expect(envelopes[1]?.requestId).toBe(envelopes[0]?.requestId);
    expect(envelopes[1]?.json).toBe(envelopes[0]?.json);
    expect((envelopes[1]?.ticket as { text: string }).text).toBe("hold the queue");
    // The edit made while it was unconfirmed survives, on screen and in storage.
    expect(box().value).toBe("hold the queue, and tell me when");
    expect(window.sessionStorage.getItem(KEY)).toBe("hold the queue, and tell me when");
    expect(text()).toContain("Confirmed");
    expect(findButton("Check")).toBeNull();
  });

  it("a replay after Check accepts the original send", async () => {
    const { api } = keyedSteer([NOT_CONFIRMED, REPLAY]);
    render(card(api));
    type("hold the queue");
    await press("Send");
    await press("Check");

    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(button("Send").disabled).toBe(true); // empty box, nothing pending
    expect(findButton("Check")).toBeNull();
  });

  it("a replay whose receipt proves the message was not sent keeps the draft", async () => {
    const { api } = keyedSteer([NOT_CONFIRMED, NOT_SENT_REPLAY]);
    render(card(api));
    type("hold the queue");
    await press("Send");
    await press("Check");

    expect(box().value).toBe("hold the queue");
    expect(window.sessionStorage.getItem(KEY)).toBe("hold the queue");
    expect(text()).toContain("not sent");
    expect(findButton("Check")).toBeNull();
  });

  it("a 409 is definitive: the draft stays, the envelope goes, and the server's sentence is shown", async () => {
    const { api, envelopes } = keyedSteer([CONFLICT, SENT]);
    render(card(api));
    type("hold the queue");
    await press("Send");

    expect(text()).toContain(CONFLICT.why);
    expect(box().value).toBe("hold the queue");
    expect(window.sessionStorage.getItem(KEY)).toBe("hold the queue");
    expect(findButton("Check")).toBeNull();
    expect(button("Send").disabled).toBe(false);

    // The next Send is a deliberate new intention: a new id.
    await press("Send");
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]?.requestId).not.toBe(envelopes[0]?.requestId);
  });

  it("a 503 is definitive, and nothing resends by itself", async () => {
    const { api, envelopes } = keyedSteer([UNAVAILABLE]);
    render(card(api));
    type("hold the queue");
    await press("Send");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(envelopes).toHaveLength(1);
    expect(text()).toContain(UNAVAILABLE.why);
    expect(box().value).toBe("hold the queue");
    expect(findButton("Check")).toBeNull();
  });

  it("a reload loses the envelope, and the next Send is a new intention with a new ticket", async () => {
    const { api, envelopes } = keyedSteer([NOT_CONFIRMED, SENT]);
    render(card(api));
    type("hold the queue");
    await press("Send");
    expect(findButton("Check")).not.toBeNull();

    reload(card(api));
    expect(box().value).toBe("hold the queue");
    expect(findButton("Check")).toBeNull();
    await press("Send");

    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]?.requestId).not.toBe(envelopes[0]?.requestId);
    expect(envelopes[1]?.ticket).not.toBe(envelopes[0]?.ticket);
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The session composer — Send and Queue.
 * ------------------------------------------------------------------ */

describe.each(["send", "queue"] as const)("the session composer's %s", (path) => {
  const KEY = draftKey("session-composer", "conv-A");
  const sessionRow = (): FleetRow =>
    row({ id: "$d", title: "drafting", status: { kind: "working" }, claudeSessionId: "conv-A", execution: running("conv-A") });
  const label = path === "send" ? "Send now" : "Queue (~73s)";

  const QUEUED: KeyedOutcome<ActionOutcome> = { kind: "answered", outcome: { ok: true, kind: "queued", position: 1, why: null } };

  function seams(answers: KeyedOutcome<never>[], ordinary: "sent" | "none" = "none") {
    const steer = keyedSteer(path === "send" ? [...answers, ...(ordinary === "sent" ? [SENT] : [])] : []);
    const actions = keyedActions(path === "queue" ? [...answers, ...(ordinary === "sent" ? [QUEUED] : [])] : []);
    const envelopes = (): RequestEnvelope<object, unknown>[] => (path === "send" ? steer.envelopes : actions.envelopes);
    return { steer: steer.api, actions: actions.api, envelopes };
  }

  function detail(s: ReturnType<typeof seams>) {
    const actions: ActionsUi = {
      api: s.actions,
      feed: null,
      error: null,
      asked: false,
      lastGoodAt: null,
      pollMs: 60_000,
      refresh: () => {},
    };
    return (
      <SessionDetail
        row={sessionRow()}
        draftScope="scope-envelope"
        now={Date.now()}
        answeringEnabled={{ kind: "enabled" }}
        answeringRefusal={null}
        onAnsweringRefused={() => {}}
        tmuxServerPid={null}
        steer={s.steer}
        rename={{ rename: refuse }}
        actions={actions}
        messages={{ recent: () => new Promise(() => {}) }}
        onRefresh={() => {}}
        onBack={null}
      />
    );
  }

  it("keeps the words and offers Check when it is not confirmed, and Check with a replay keeps what was typed since", async () => {
    const s = seams([NOT_CONFIRMED, REPLAY]);
    render(detail(s));
    type("pull dev and carry on");
    await press(label);

    expect(text()).toContain(NOT_CONFIRMED_PHRASE);
    expect(box().value).toBe("pull dev and carry on");
    expect(window.sessionStorage.getItem(KEY)).toBe("pull dev and carry on");
    expect(button("Send now").disabled).toBe(true);

    type("pull dev and carry on, then push");
    await press("Check");
    const [first, second] = s.envelopes();
    expect(second).toBe(first);
    expect((second?.ticket as { text: string }).text).toBe("pull dev and carry on");
    expect(box().value).toBe("pull dev and carry on, then push");
    expect(window.sessionStorage.getItem(KEY)).toBe("pull dev and carry on, then push");
  });

  it("a replay after Check accepts the original send", async () => {
    const s = seams([NOT_CONFIRMED, REPLAY]);
    render(detail(s));
    type("pull dev and carry on");
    await press(label);
    await press("Check");
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("a replay whose receipt proves the action was not sent keeps the draft", async () => {
    const s = seams([NOT_CONFIRMED, NOT_SENT_REPLAY]);
    render(detail(s));
    type("pull dev and carry on");
    await press(label);
    await press("Check");
    expect(box().value).toBe("pull dev and carry on");
    expect(window.sessionStorage.getItem(KEY)).toBe("pull dev and carry on");
    expect(text()).toContain("not sent");
  });

  it("a 409 keeps the draft and drops the envelope", async () => {
    const s = seams([CONFLICT]);
    render(detail(s));
    type("pull dev and carry on");
    await press(label);
    expect(text()).toContain(CONFLICT.why);
    expect(box().value).toBe("pull dev and carry on");
    expect(window.sessionStorage.getItem(KEY)).toBe("pull dev and carry on");
    expect(findButton("Check")).toBeNull();
  });

  it("a reload loses the envelope, and the next press is a new intention with a new ticket", async () => {
    const s = seams([NOT_CONFIRMED], "sent");
    render(detail(s));
    type("pull dev and carry on");
    await press(label);
    reload(detail(s));
    expect(box().value).toBe("pull dev and carry on");
    expect(findButton("Check")).toBeNull();
    await press(label);

    const [first, second] = s.envelopes();
    expect(second?.requestId).not.toBe(first?.requestId);
    expect(second?.ticket).not.toBe(first?.ticket);
    expect(box().value).toBe("");
  });
});

/* ------------------------------------------------------------------ *
 * The broadcast.
 * ------------------------------------------------------------------ */

describe("the broadcast", () => {
  const KEY = draftKey("broadcast");
  const ROWS = [row({ id: "$1" }), row({ id: "$2" })];
  const PREVIEW: BroadcastOutcome = {
    kind: "ran",
    op: "broadcast-preview",
    result: {
      counts: { asked: 2, submitted: 0, queued: 0, skipped: 0, held: 0, notReached: 0 },
      recipients: [
        { sessionId: "$1", paneId: "%1", kind: "would-send" },
        { sessionId: "$2", paneId: "%2", kind: "would-send" },
      ],
      sample: "Greg says: ease off",
    },
  };
  const BROADCAST_REPLAY: KeyedOutcome<BroadcastOutcome> = {
    kind: "replay",
    receipt: receipt({ receiptId: "e1e1e1e1-r5", op: "broadcast", origin: "broadcast", target: null, state: "completed", reason: "fan-out-finished" }),
    children: [
      receipt({ receiptId: "e1e1e1e1-r6", op: "broadcast-recipient", origin: "broadcast", parentReceiptId: "e1e1e1e1-r5" }),
      receipt({ receiptId: "e1e1e1e1-r7", op: "broadcast-recipient", origin: "broadcast", parentReceiptId: "e1e1e1e1-r5" }),
    ],
  };

  function keyedBroadcast(answers: KeyedOutcome<BroadcastOutcome>[]) {
    const envelopes: RequestEnvelope<BroadcastBody, unknown>[] = [];
    const api: BroadcastApi = {
      send: async (_rows, _text, dryRun) => {
        if (!dryRun) throw new Error("a real broadcast must go as an envelope");
        return PREVIEW;
      },
      keyed: {
        run: async (envelope) => {
          envelopes.push(envelope);
          const next = answers.shift();
          if (next === undefined) throw new Error("the fake broadcast ran out of answers");
          return next;
        },
      },
    };
    return { api, envelopes };
  }

  it("keeps the sentence and offers Check when the run is not confirmed; Check with a replay keeps what was typed since", async () => {
    const { api, envelopes } = keyedBroadcast([NOT_CONFIRMED, BROADCAST_REPLAY]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off for ten minutes");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain(NOT_CONFIRMED_PHRASE);
    expect(box().value).toBe("ease off for ten minutes");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off for ten minutes");
    // No second fan-out can be started while this one is unconfirmed.
    expect(button("Preview").disabled).toBe(true);

    type("ease off for ten minutes, please");
    await press("Check");
    expect(envelopes).toHaveLength(2);
    expect(envelopes[1]).toBe(envelopes[0]);
    expect((envelopes[1]?.ticket as { text: string }).text).toBe("ease off for ten minutes");
    expect(box().value).toBe("ease off for ten minutes, please");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off for ten minutes, please");
    expect(text()).toContain("Confirmed");
  });

  it("a replay after Check accepts the original broadcast", async () => {
    const { api } = keyedBroadcast([NOT_CONFIRMED, BROADCAST_REPLAY]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off for ten minutes");
    await press("Preview");
    await press("Send it");
    await press("Check");
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    // Each recipient's own receipt is accounted for.
    expect(text()).toContain("2 recipient");
  });

  it("a replay whose receipt does not show the broadcast happened keeps the draft", async () => {
    const notSent = {
      kind: "replay",
      receipt: receipt({
        receiptId: "e1e1e1e1-r8",
        op: "broadcast",
        origin: "broadcast",
        target: null,
        state: "not-sent",
        reason: "interrupted-before-attempt",
        attemptedAt: null,
      }),
      children: null,
    } as const;
    const { api } = keyedBroadcast([NOT_CONFIRMED, notSent]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off for ten minutes");
    await press("Preview");
    await press("Send it");
    await press("Check");
    expect(box().value).toBe("ease off for ten minutes");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off for ten minutes");
    expect(text()).toContain("not sent");
  });

  it("a 409 keeps the sentence and drops the envelope", async () => {
    const { api } = keyedBroadcast([CONFLICT]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off for ten minutes");
    await press("Preview");
    await press("Send it");
    expect(text()).toContain(CONFLICT.why);
    expect(box().value).toBe("ease off for ten minutes");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off for ten minutes");
    expect(findButton("Check")).toBeNull();
  });
});
