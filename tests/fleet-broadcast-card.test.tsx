// @vitest-environment jsdom
/**
 * **THE BROADCAST CARD**, whose whole job is to stop somebody agreeing to
 * something other than what happens.
 *
 * A broadcast is the most expensive control on this dashboard: every line it
 * delivers is a turn of a paid model and costs that agent its context, N times
 * at once. So the failures worth testing are not "the button did not work" —
 * they are the ways a person could press Send having read a number that is not
 * the number:
 *
 *  - **a count this page worked out for itself**, which the fan-out is free to
 *    disagree with. There is none: the count comes back from the server's dry
 *    run, computed by the same `drainGate` the send will use.
 *  - **a preview left standing over an edited sentence**, so what is confirmed
 *    is not what goes.
 *  - **a preview left standing over a changed recipient set**, which ticking
 *    the Overseer box does.
 *  - **"sent" said about a queued row**, which may be delivered a long time
 *    later to a session whose situation has moved on.
 *  - **"nothing happened" said about a lost response**, which invites the retry
 *    that says everything twice, to everybody.
 *
 * Every test drives the `BroadcastApi` seam with a fake. Nothing here reaches
 * the network, and nothing reaches tmux.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BroadcastCard } from "../tools/fleet/web/src/BroadcastCard";
import { makeBroadcastApi } from "../tools/fleet/web/src/broadcast-client";
import type { BroadcastApi, BroadcastOutcome, RecipientOutcome } from "../tools/fleet/web/src/broadcast-client";
import { DRAFT_CAP, draftKey, draftNoticeSentence, resetDraftPageStateForTests } from "../tools/fleet/web/src/drafts";
import type { FleetRow } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* **THE CARD KEEPS ITS DRAFT NOW**, keyed by purpose alone — so without this
     every test would open with the previous test's sentence already typed. */
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

function row(over: Partial<FleetRow> & { id: string }): FleetRow {
  const status = over.status ?? { kind: "idle" as const };
  return {
    /* Required and not what this file is about — the shape
       `parseDescription` returns for a payload without one. */
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    paneId: `%${over.id.slice(1)}`,
    name: over.id,
    // Required on a row and not what this file is about — an old producer's
    // shape, which is what `parseExecution` returns for a payload without one.
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title: null,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-09T00:00:00Z").toISOString(),
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: 4242,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    rawStatus: status,
    rawQuestion: null,
    ...over,
  };
}

type Call = { rows: readonly FleetRow[]; text: string; dryRun: boolean };

function fakeApi(answers: BroadcastOutcome[]): { api: BroadcastApi; calls: Call[] } {
  const calls: Call[] = [];
  let n = 0;
  return {
    calls,
    api: {
      send: async (rows, text, dryRun) => {
        calls.push({ rows, text, dryRun });
        const answer = answers[Math.min(n, answers.length - 1)];
        n += 1;
        if (answer === undefined) throw new Error("the fake was given no answer");
        return answer;
      },
    },
  };
}

function ran(op: "broadcast" | "broadcast-preview", recipients: RecipientOutcome[], counts: Partial<Record<string, number>> = {}): BroadcastOutcome {
  return {
    kind: "ran",
    op,
    result: {
      counts: {
        asked: recipients.length,
        submitted: 0,
        queued: 0,
        skipped: 0,
        held: 0,
        notReached: 0,
        ...counts,
      } as never,
      recipients,
      sample: op === "broadcast-preview" ? "Greg says: ease off" : null,
    },
  };
}

function render(node: Parameters<Root["render"]>[0]): void {
  act(() => root.render(node));
}

function text(): string {
  return container.textContent ?? "";
}

function button(label: string): HTMLButtonElement | null {
  return (
    ([...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label)) as
      | HTMLButtonElement
      | undefined) ?? null
  );
}

function press(label: string): Promise<void> {
  const found = button(label);
  if (found === null) throw new Error(`no button matching ${JSON.stringify(label)} in: ${text()}`);
  return act(async () => {
    found.click();
  });
}

function type(value: string): void {
  const input = container.querySelector("textarea");
  if (input === null) throw new Error(`no textarea; card says: ${text()}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function tickOverseer(): void {
  const box = container.querySelector('input[type="checkbox"]');
  if (box === null) throw new Error("no checkbox on the card");
  act(() => {
    (box as HTMLInputElement).click();
  });
}

const ROWS = [row({ id: "$1" }), row({ id: "$2", status: { kind: "working" } }), row({ id: "$3" })];

describe("the two presses", () => {
  it("offers no Send until a preview has come back", async () => {
    const { api, calls } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);

    type("ease off");
    // **NOT A DISABLED SEND — NO SEND.** A button that exists is one somebody
    // will press, and what makes this safe is the number beside it having come
    // back from the function that will do the sending.
    expect(button("Send it")).toBeNull();

    await press("Preview");
    expect(calls[0]?.dryRun).toBe(true);
    expect(button("Send it")).not.toBeNull();
  });

  it("shows the exact rendered line that each agent would receive", async () => {
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");

    // The prefix included: what is being agreed to is what an agent reads, not
    // what was typed.
    expect(text()).toContain("Greg says: ease off");
  });

  it("sends what the preview was about, and not a dry run", async () => {
    const { api, calls } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      ran("broadcast", [{ sessionId: "$1", paneId: "%1", kind: "queued", position: 1 }], { queued: 1 }),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(calls).toHaveLength(2);
    expect(calls[1]?.dryRun).toBe(false);
    expect(calls[1]?.text).toBe("ease off");
  });
});

describe("a preview must never describe something else", () => {
  it("drops the preview when the sentence is edited", async () => {
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();

    type("actually, stop everything");
    // A preview of the OLD sentence beside a box holding a new one is a
    // confirmation of something nobody is about to send.
    expect(button("Send it")).toBeNull();
  });

  it("drops the preview when the recipient set changes", async () => {
    const rows = [...ROWS, row({ id: "$9", role: { kind: "overseer" } })];
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={rows} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();

    // Ticking the Overseer in changes WHO is being agreed to, which is exactly
    // as invalidating as retyping the sentence.
    tickOverseer();
    expect(button("Send it")).toBeNull();
  });

  it("drops the preview when the FLEET changes underneath it", async () => {
    /**
     * **THE CASE NO USER ACTION CAUSES, AND THE ONLY ONE THE EXPLICIT RESETS
     * CANNOT CATCH.** Typing drops the preview and ticking the box drops the
     * preview, because both are handlers. This page also re-renders about once
     * a minute off the SSE snapshot, and a session appearing or ending between
     * the Preview and the Send changes who the message goes to with nobody
     * touching anything. The `current` comparison exists for this, and a
     * deliberate mutation removing it turned NO other test in this file red —
     * which is how this one came to be written.
     */
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();

    // A new session appears in the next collection. Nobody touched the card.
    render(<BroadcastCard rows={[...ROWS, row({ id: "$7" })]} unreadableRows={0} api={api} />);
    expect(button("Send it")).toBeNull();
  });

  it("drops the preview when one session is swapped for another, not just when the count moves", async () => {
    /**
     * **A COUNT IS NOT A SET**, which is GPT Sol's P1-3 and the reason the guard
     * compares a signature. One session ends and another appears between Preview
     * and Send — the ordinary shape of this box — and the length is identical,
     * so a count-based guard left the preview looking current while describing a
     * different fleet. The test above only ADDS a row, so it exercised length
     * and would have passed either way.
     */
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();

    // $3 ends; $8 starts. Three rows before, three rows after.
    const swapped = [ROWS[0] as FleetRow, ROWS[1] as FleetRow, row({ id: "$8" })];
    render(<BroadcastCard rows={swapped} unreadableRows={0} api={api} />);
    expect(button("Send it")).toBeNull();
  });

  it("drops the preview when a row's status changes underneath it", async () => {
    /* A session that was working when the preview said *would queue* and is idle
       now would be TYPED AT instead — a different thing from what was agreed to,
       with the same count and the same session ids. */
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$2", paneId: "%2", kind: "would-queue" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();

    const woken = [ROWS[0] as FleetRow, row({ id: "$2" }), ROWS[2] as FleetRow];
    render(<BroadcastCard rows={woken} unreadableRows={0} api={api} />);
    expect(button("Send it")).toBeNull();
  });

  it("reads a real broadcast answered to a dry run as unknown, never as a preview", async () => {
    /**
     * GPT Sol's P1-5. The client mapped any successful non-preview `op` onto
     * `broadcast`, and the card drew any `ran` from its dry-run call as a
     * preview — so a version-skewed answer describing a fan-out that had ALREADY
     * GONE OUT would have been shown as a confirmation, with a Send button under
     * it. `unknown` and not `refused`, because the answer is evidence something
     * ran.
     */
    const { api } = fakeApi([ran("broadcast", [{ sessionId: "$1", paneId: "%1", kind: "queued", position: 1 }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");

    expect(button("Send it")).toBeNull();
    expect(text()).toContain("It is not known what reached the fleet.");
    expect(text()).toContain("Do NOT simply send it again");
  });

  it("does not leave an old preview standing under a fresh refusal", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      { kind: "refused", code: "cooldown", why: "the fleet was last broadcast to 2 minutes ago", status: 429, result: null },
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    type("ease off a bit");
    await press("Preview");

    expect(button("Send it")).toBeNull();
    expect(text()).toContain("2 minutes ago");
  });
});

describe("the Overseer's own row", () => {
  it("is left out unless it is ticked in", async () => {
    const rows = [row({ id: "$1" }), row({ id: "$9", role: { kind: "overseer" }, title: "the-overseer" })];
    const { api, calls } = fakeApi([ran("broadcast-preview", [])]);
    render(<BroadcastCard rows={rows} unreadableRows={0} api={api} />);
    type("ease off");

    await press("Preview");
    expect(calls[0]?.rows.map((r) => r.id)).toEqual(["$1"]);

    tickOverseer();
    await press("Preview");
    expect(calls[1]?.rows.map((r) => r.id)).toEqual(["$1", "$9"]);
  });

  it("says the tick-box changes nothing when nobody holds the claim", () => {
    const { api } = fakeApi([ran("broadcast-preview", [])]);
    render(<BroadcastCard rows={[row({ id: "$1" })]} unreadableRows={0} api={api} />);
    expect(text()).toContain("no session holds the claim");
  });
});

describe("what the receipts are allowed to say", () => {
  it("will not broadcast off a payload with rows it could not read", async () => {
    /* A dropped row is a session that silently does not get the message, under
       a control labelled "every live Claude session". Refused rather than sent
       with a caveat — the caveat is the half people stop reading. */
    const { api, calls } = fakeApi([ran("broadcast-preview", [])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={2} api={api} />);
    type("ease off");

    expect(text()).toContain("could not be read");
    expect(button("Preview")?.disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("will not broadcast before any collection has finished, which is not the same as none being dropped", async () => {
    const { api, calls } = fakeApi([ran("broadcast-preview", [])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={null} api={api} />);
    type("ease off");
    expect(button("Preview")?.disabled).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("never says a queued row was sent, delivered, or that it will arrive", async () => {
    /**
     * **THIS TEST USED TO ENFORCE AN OVERCLAIM.** It was named "says when it
     * will arrive" and pinned the words *"It goes when that session is next at a
     * prompt"* — which a queued item cannot promise: it can expire, be
     * cancelled, be orphaned with its session, or sit behind a quarantine hold.
     * GPT Sol's P2. A test name is a claim like any other.
     */
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$2", paneId: "%2", kind: "would-queue" }]),
      ran("broadcast", [{ sessionId: "$2", paneId: "%2", kind: "queued", position: 3 }], { queued: 1 }),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain("Queued (position 3)");
    expect(text()).toContain("will be attempted when that session is next eligible");
    expect(text()).toContain("nothing here can promise it arrives");
    expect(text()).toContain("Nothing has been typed at it");
    expect(text()).toContain("queued for 1");
  });

  it("says queued without a position when the server did not give one", () => {
    /* `0` would render as a place in the queue. `null` is *this build was not
       told where it landed*, which is a different sentence. */
    const { api } = fakeApi([ran("broadcast-preview", [])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    // Rendered directly through the outcome, since the server always sends one.
    expect(text()).not.toContain("position 0");
  });

  it("counts what was submitted, and says submitted is not read", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      ran(
        "broadcast",
        [
          {
            sessionId: "$1",
            paneId: "%1",
            kind: "attempted",
            outcome: { ok: true, op: "message", sent: [["tmux", "send-keys"]], verified: { kind: "not-told" } },
          },
        ],
        { submitted: 1 },
      ),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain("Keys submitted to 1");
    // The ceiling on every claim this dashboard makes about a keystroke.
    expect(text()).toContain("there is no receipt for a keystroke");
    expect(text()).not.toContain("heard");
  });

  it("renders a partial delivery as PART sent, through the same receipt a single steer uses", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      ran("broadcast", [
        {
          sessionId: "$1",
          paneId: "%1",
          kind: "attempted",
          outcome: {
            ok: false,
            code: "send-partial",
            why: "the text went and the Enter did not",
            status: 409,
            from: "server",
            delivery: { kind: "partial" },
          },
        },
      ]),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain("PART of it was sent.");
    expect(text()).not.toContain("Nothing was sent.");
  });

  it("carries the per-session reasons out of a refusal that judged the rows", async () => {
    const { api } = fakeApi([
      {
        kind: "refused",
        code: "not-steerable",
        why: "none of the 2 rows you sent can be reached right now",
        status: 409,
        result: {
          counts: { asked: 2, submitted: 0, queued: 0, skipped: 2, held: 0, notReached: 0 },
          recipients: [
            { sessionId: "$1", paneId: "%1", kind: "skipped", code: "declared-not-steerable", why: "it is a shell, which would EXECUTE the message" },
            { sessionId: "$3", paneId: "%3", kind: "skipped", code: "declared-not-steerable", why: "its Claude has exited" },
          ],
          sample: null,
        },
      },
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");

    // A bare "there is nobody to tell" is a shrug; this is a diagnosis.
    expect(text()).toContain("would EXECUTE");
    expect(text()).toContain("its Claude has exited");
  });
});

describe("a lost answer is not an answer of no", () => {
  it("says what reached the fleet is unknown, and warns against simply retrying", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      { kind: "unknown", why: "this browser could not reach the dashboard: network error" },
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain("It is not known what reached the fleet.");
    /* **THE RETRY IS THE HARM HERE.** The server may have typed at half the
       fleet before the answer was lost, so "nothing happened" would invite
       saying everything twice, to everybody. */
    expect(text()).toContain("Do NOT simply send it again");
    expect(text()).not.toContain("Nothing was broadcast.");
  });
});

describe("a session that was HELD is said so, not folded into something else", () => {
  /**
   * The server never reached the transport for these rows: that session is
   * holding text nobody could account for, and a second line landing behind
   * half a first is read by the agent as one instruction neither person wrote
   * — routes-broadcast.ts § `BroadcastRecipient`.
   *
   * Two ways to get this wrong, and one test each: reading the row as a
   * delivery that failed, and not reading it at all.
   */
  it("renders the hold's own sentence and names the held rows in the headline", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      ran(
        "broadcast",
        [{ sessionId: "$1", paneId: "%1", kind: "held", why: "nothing was sent: this session is held" }],
        { held: 1 },
      ),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");

    expect(text()).toContain("Nothing was typed at it");
    expect(text()).toContain("this session is held");
    /* **IN THE HEADLINE TOO.** A row nothing was typed at, counted nowhere and
       named nowhere, is how a fan-out that reached most of the fleet reads as
       one that reached all of it. */
    expect(text()).toContain("1 held");
  });

  it("reads a held row off the wire rather than calling it unreadable", async () => {
    /* THE PARSE, not the card. An arm this build did not know would come back
       as `unreadable` — "the server sent something this build cannot read" —
       over the top of the one row a person most needs to act on. */
    const body = {
      ok: true,
      op: "broadcast",
      result: {
        counts: { asked: 1, submitted: 0, queued: 0, skipped: 0, held: 1, notReached: 0 },
        recipients: [{ sessionId: "$1", paneId: "%1", kind: "held", why: "nothing was sent: this session is held" }],
      },
    };
    const api = makeBroadcastApi(
      (async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response) as unknown as typeof fetch,
    );
    const outcome = await api.send(ROWS, "ease off", false);
    expect(outcome.kind).toBe("ran");
    const held = outcome.kind === "ran" ? outcome.result.recipients[0] : undefined;
    expect(held?.kind).toBe("held");
    expect(held?.kind === "held" && held.why).toContain("this session is held");
    expect(outcome.kind === "ran" && outcome.result.counts.held).toBe(1);
  });
});

describe("the unsent sentence, kept under the purpose alone", () => {
  /**
   * **NOT KEYED TO A CONVERSATION, AND THAT IS THE POINT.** A broadcast has no
   * single recipient, so there is no execution for a replacement to inherit it
   * from — the key is `sy.draft.v1:broadcast` and nothing else. What it shares
   * with the other two boxes is everything else: sessionStorage only, the cap,
   * Clear, and removal once it has actually gone out.
   */
  const KEY = draftKey("broadcast");

  /** What iOS does when it reclaims a tab: storage survives, the page's memory does not. */
  function reload(node: Parameters<Root["render"]>[0]): void {
    act(() => root.unmount());
    resetDraftPageStateForTests();
    root = createRoot(container);
    render(node);
  }

  function box(): HTMLTextAreaElement {
    const el = container.querySelector("textarea");
    if (el === null) throw new Error(`no textarea; card says: ${text()}`);
    return el;
  }

  it("brings the sentence back after a reload, under the purpose and nothing else", () => {
    const { api } = fakeApi([]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("everybody hold off for ten minutes");
    reload(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);

    expect(box().value).toBe("everybody hold off for ten minutes");
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem(KEY)).toBe("everybody hold off for ten minutes");
  });

  it("keeps it through a preview, and removes it once the broadcast has run", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      ran("broadcast", [{ sessionId: "$1", paneId: "%1", kind: "queued", position: 1 }], { queued: 1 }),
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off");
    await press("Send it");
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("keeps it when the broadcast was refused", async () => {
    const { api } = fakeApi([
      ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }]),
      { kind: "refused", code: "cooldown", why: "the fleet was last broadcast to 2 minutes ago", status: 429, result: null },
    ]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    await press("Send it");
    expect(box().value).toBe("ease off");
    expect(window.sessionStorage.getItem(KEY)).toBe("ease off");
  });

  it("has a Clear that empties the box, removes the draft, and takes the preview with it", async () => {
    const { api } = fakeApi([ran("broadcast-preview", [{ sessionId: "$1", paneId: "%1", kind: "would-send" }])]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("ease off");
    await press("Preview");
    expect(button("Send it")).not.toBeNull();
    await press("Clear");
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(button("Send it")).toBeNull();
  });

  it("says in one line that a sentence over the cap will not survive a reload, and stores none of it", () => {
    const { api } = fakeApi([]);
    render(<BroadcastCard rows={ROWS} unreadableRows={0} api={api} />);
    type("z".repeat(DRAFT_CAP + 1));
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(text()).toContain(draftNoticeSentence("too-long"));
  });
});
