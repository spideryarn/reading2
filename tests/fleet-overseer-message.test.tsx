// @vitest-environment jsdom
/**
 * **SAYING SOMETHING TO THE OVERSEER**, and the four answers to "who is it".
 *
 * ## What this card is, and what it is not
 *
 * The Overseer is a Claude session in a tmux pane, so a message to it is an
 * ordinary steer. What is not ordinary is the addressing: there is no row to
 * tap, because the person on this tab does not know which of forty sessions
 * holds the claim. So the card resolves it, and **the resolution has four
 * answers and three of them are refusals**:
 *
 *  - `one` — the session to speak to.
 *  - `none` — nobody holds the claim. This is what the box looks like after a
 *    reboot, since the claim lives in the tmux server's memory. It is a real
 *    state, not a rendering gap, and the card must SAY it rather than draw an
 *    input that goes nowhere.
 *  - `contested` — two sessions claim it. **Never pick one**: choosing a
 *    claimant is how both go on believing they are the Overseer.
 *  - `cannot-tell` — we could not read the rows. Not the same as `none`.
 *
 * Those are `overseerClaim`'s arms, and this suite drives all four rather than
 * the happy one, because the three refusals are the whole reason the card is
 * not just a textarea.
 *
 * ## The delivery half
 *
 * The other thing under test is that a send is REPORTED rather than assumed. A
 * dashboard that says "sent" and did nothing is worse than one that says no
 * (steer.ts's header). So there are tests here for a refusal, and for the
 * `partial` delivery in particular — the text landed in that agent's input box
 * and the Enter did not — which must never render as "nothing was sent",
 * because the advice that follows from those two is opposite.
 *
 * Everything goes through the `SteerApi` seam with a fake. **No test in this
 * file may reach tmux**: there are live agent sessions on this box doing real
 * work, and a suite is not a reason to type into one.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { draftKey, draftNoticeSentence, resetDraftPageStateForTests } from "../tools/fleet/web/src/drafts";
import { MessageOverseerCard } from "../tools/fleet/web/src/MessageOverseerCard";
import type { SteerApi, SteerOutcome } from "../tools/fleet/web/src/steer-client";
import type { FleetRow } from "../tools/fleet/web/src/types";
import type { ExecutionReading } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  /* **THE CARD KEEPS DRAFTS NOW**, so one test's typing would otherwise be
     restored into the next test's box. Through `window`: under jsdom the bare
     `sessionStorage` is Node's own. */
  window.sessionStorage.clear();
  resetDraftPageStateForTests();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/**
 * A row with the three identifiers a keystroke needs, because every row in this
 * file is one somebody might actually be spoken to.
 *
 * `rawStatus` agrees with `status` for the same reason the fixture next door
 * does it: the page sends the server's own object, and a fixture whose two
 * halves disagree is testing a payload the page never builds.
 */
function row(over: Partial<FleetRow> & { id: string }): FleetRow {
  const status = over.status ?? { kind: "idle" as const };
  return {
    /* Required and not what this file is about — the shape
       `parseDescription` returns for a payload without one. */
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    paneId: "%2108",
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

/** The one that holds the claim. */
function overseerRow(over: Partial<FleetRow> & { id: string }): FleetRow {
  return row({ role: { kind: "overseer" }, ...over });
}

/**
 * A fake seam that records what it was asked to do.
 *
 * `answer` throws rather than returning a plausible value: nothing on this card
 * answers a dialog, and a fake that quietly succeeds at something the component
 * should never call is how a wrong call goes unnoticed.
 */
function fakeApi(result: SteerOutcome): { api: SteerApi; calls: { row: FleetRow; text: string }[] } {
  const calls: { row: FleetRow; text: string }[] = [];
  return {
    calls,
    api: {
      message: async (target, text) => {
        calls.push({ row: target, text });
        return result;
      },
      answer: () => {
        throw new Error("this card must never answer a dialog");
      },
    },
  };
}

const SENT: SteerOutcome = {
  ok: true,
  op: "message",
  sent: [["tmux", "send-keys", "-t", "%2108", "-l", "--", "hello"]],
  verified: { kind: "verified", paneId: "%2108", sessionId: "$1643", panePid: 4242, claudePid: 5150 },
};

function render(node: Parameters<Root["render"]>[0]): void {
  act(() => root.render(node));
}

function text(): string {
  return container.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(label));
  if (found === undefined) throw new Error(`no button matching ${JSON.stringify(label)} in: ${text()}`);
  return found as HTMLButtonElement;
}

function type(value: string): void {
  const input = container.querySelector("textarea");
  if (input === null) throw new Error(`no textarea on screen; card says: ${text()}`);
  act(() => {
    /* The React-controlled path: setting `.value` alone does not reach the
       component's state, and the test would then send an empty string while
       looking like it typed. */
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("who the card decides to speak to", () => {
  it("names the holder, and sends to that row and no other", async () => {
    const { api, calls } = fakeApi(SENT);
    const rows = [
      row({ id: "$1", name: "some-other-agent" }),
      overseerRow({ id: "$1643", name: "the-overseer" }),
      row({ id: "$2", name: "another-agent" }),
    ];
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);

    expect(text()).toContain("the-overseer");

    type("ease off on the test suites");
    await act(async () => {
      button("Send").click();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.row.id).toBe("$1643");
    expect(calls[0]?.text).toBe("ease off on the test suites");
  });

  it("refuses when no session holds the claim, and says that is a real state", () => {
    const { api, calls } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[row({ id: "$1" }), row({ id: "$2" })]} unreadableRows={0} steer={api} />);

    expect(text()).toContain("no Overseer session");
    // No input, because there is nowhere for the words to go. An input over
    // nothing is the most expensive lie this tool can tell.
    expect(container.querySelector("textarea")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("refuses when two sessions claim it, and names both rather than choosing", () => {
    const { api } = fakeApi(SENT);
    const rows = [overseerRow({ id: "$1", name: "claimant-one" }), overseerRow({ id: "$2", name: "claimant-two" })];
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);

    expect(text()).toContain("claimant-one");
    expect(text()).toContain("claimant-two");
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("refuses when a row could not be read, and does not call that 'none'", () => {
    const { api } = fakeApi(SENT);
    const rows = [
      overseerRow({ id: "$1643", name: "the-overseer" }),
      row({ id: "$2", role: { kind: "cannot-tell", why: "the collector timed out" } }),
    ];
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);

    expect(text()).toContain("the collector timed out");
    expect(text()).not.toContain("no Overseer session");
    /* THE HOLDER STILL TRAVELS on `cannot-tell`, so the card may still name who
       it WAS — what is in doubt is whether anybody else also claims it. What it
       must not do is offer a send off a reading it has just called unreliable. */
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("refuses while any row in the payload could not be read, even with a clear holder", () => {
    /**
     * **A DROPPED ROW IS A REASON TO DISBELIEVE THE CLAIM**, not a gap beside
     * it. `overseerClaim` was handed only the rows that survived, so it cannot
     * know that the missing one was a second claimant — and it answers `one`
     * with complete confidence. Nothing downstream catches this: it is not
     * staleness, and `verifyTarget` checks an address rather than a role.
     *
     * GPT Sol's P1, 2026-09-09. The card sent happily before this.
     */
    const { api, calls } = fakeApi(SENT);
    render(
      <MessageOverseerCard
        rows={[overseerRow({ id: "$1643", name: "the-overseer" })]}
        unreadableRows={2}
        steer={api}
      />,
    );

    expect(text()).toContain("could not be read");
    expect(container.querySelector("textarea")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("refuses before any collection has finished, which is not the same as none being dropped", () => {
    /* Zero unreadable rows is a MEASUREMENT — *we read every row and dropped
       none*. Before the first payload nothing has been read at all, and `?? 0`
       in App.tsx dressed the second up as the first. */
    const { api, calls } = fakeApi(SENT);
    render(
      <MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={null} steer={api} />,
    );

    expect(text()).toContain("No collection has finished yet");
    expect(text()).not.toContain("no Overseer session");
    expect(container.querySelector("textarea")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("does not promise the role was checked at send time", () => {
    /**
     * **THE COPY HALF OF THE ROLE RACE.** The header was corrected and this
     * tooltip was left saying *"a row that has gone stale produces a refusal
     * here rather than a message at the wrong session"* — false when only the
     * role has moved, and it survived an hour into the branch before GPT Sol
     * read the built code. Four surfaces describe this fact and only one of
     * them had been fixed.
     */
    const { api } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);
    const tips = container.querySelectorAll("[aria-describedby], [data-slot]");
    const all = `${text()} ${[...tips].map((t) => t.getAttribute("aria-label") ?? "").join(" ")}`;
    expect(all).not.toContain("rather than a message at the wrong session");
  });

  it("refuses a holder with no pane handle, because that is not an address", () => {
    const { api } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643", paneId: null })]} unreadableRows={0} steer={api} />);

    expect(text()).toContain("no tmux pane handle");
    expect(container.querySelector("textarea")).toBeNull();
  });
});

describe("what it says became of the message", () => {
  it("reports the verified address on success, and does not call it a receipt", async () => {
    const { api } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);

    type("hello");
    await act(async () => {
      button("Send").click();
    });

    expect(text()).toContain("%2108");
    // The distinction the whole steer path is built on: verified BEFORE the
    // keys went, and nothing looked afterwards.
    expect(text()).toContain("not a receipt");
  });

  it("renders a partial delivery as PART sent, never as nothing sent", async () => {
    const { api } = fakeApi({
      ok: false,
      code: "send-partial",
      why: "the text was typed and the Enter did not go",
      status: 409,
      from: "server",
      delivery: { kind: "partial" },
    });
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);

    type("hello");
    await act(async () => {
      button("Send").click();
    });

    expect(text()).toContain("PART of it was sent.");
    expect(text()).not.toContain("Nothing was sent.");
    // The server's own sentence, verbatim.
    expect(text()).toContain("the text was typed and the Enter did not go");
  });

  it("renders a plain refusal as nothing sent, with the server's words and code", async () => {
    const { api } = fakeApi({
      ok: false,
      code: "declared-not-steerable",
      why: "it is a shell, which would EXECUTE the message",
      status: 409,
      from: "server",
      delivery: { kind: "none" },
    });
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);

    type("hello");
    await act(async () => {
      button("Send").click();
    });

    expect(text()).toContain("Nothing was sent.");
    expect(text()).toContain("it is a shell, which would EXECUTE the message");
    expect(text()).toContain("declared-not-steerable");
  });

  it("treats a server that said nothing about delivery as unknown, not as nothing", async () => {
    const { api } = fakeApi({
      ok: false,
      code: "internal",
      why: "the delivery module threw",
      status: 500,
      from: "server",
      delivery: { kind: "not-told" },
    });
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);

    type("hello");
    await act(async () => {
      button("Send").click();
    });

    expect(text()).toContain("It is not known whether anything was sent.");
    expect(text()).not.toContain("Nothing was sent.");
  });

  it("will not send an empty message", async () => {
    const { api, calls } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);

    await act(async () => {
      button("Send").click();
    });
    expect(calls).toHaveLength(0);

    type("   ");
    await act(async () => {
      button("Send").click();
    });
    expect(calls).toHaveLength(0);
  });
});

describe("the daemon and the session are not the same thing", () => {
  /**
   * The card this replaced said *"There is still nothing here to send a message
   * to"*, and it was RIGHT about the daemon: `tools/overseer/` writes a
   * checkpoint and reads no inbox. What it was wrong about was the session —
   * the Overseer is an agent in a pane, and a pane takes keystrokes.
   *
   * Both halves have to survive, or the card teaches somebody that the daemon
   * has an inbox.
   */
  it("says the words go to the session's pane, not to the daemon", () => {
    const { api } = fakeApi(SENT);
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643", name: "the-overseer" })]} unreadableRows={0} steer={api} />);

    expect(text()).toContain("daemon");
    expect(text()).toContain("pane");
  });
});

describe("the unsent line, kept under the Overseer's verified conversation", () => {
  /**
   * **THE STRONGEST CASE OF THE THREE BOXES.** The Overseer is the session
   * relaunched most often, so a half-written line to one Overseer is the
   * likeliest draft on this dashboard to meet a different one. The card resolves
   * the Overseer's row from the claim (`overseerClaim`), and that row's
   * `execution` carries the conversation — so the key is that, and never the
   * pane, the tmux handle or the process.
   *
   * Conversation ids here are not uuids, deliberately: tests/fixture-ids.test.ts
   * fails on a uuid shared between two test files.
   */
  const KEY = (conversation: string): string => draftKey("overseer-message", conversation);

  function running(conversation: string, pid = 6100): ExecutionReading {
    return {
      kind: "verified",
      token: { boot: "overseer-draft-boot", pid, startTicks: 55_000 + pid },
      harness: "claude-code",
      conversation: { kind: "verified", id: conversation },
    };
  }

  /** What iOS does when it reclaims a tab: storage survives, the page's memory does not. */
  function reload(node: Parameters<Root["render"]>[0]): void {
    act(() => root.unmount());
    resetDraftPageStateForTests();
    root = createRoot(container);
    render(node);
  }

  function box(): HTMLTextAreaElement {
    const el = container.querySelector("textarea");
    if (el === null) throw new Error(`no textarea on screen; card says: ${text()}`);
    return el;
  }

  it("brings the line back after a reload, under the Overseer's conversation and nothing else", () => {
    const { api } = fakeApi(SENT);
    const rows = [overseerRow({ id: "$1643", execution: running("conv-overseer-1") })];
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);
    type("half a thought about the queue");
    reload(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);

    expect(box().value).toBe("half a thought about the queue");
    expect(window.sessionStorage.length).toBe(1);
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBe("half a thought about the queue");
  });

  it("restores it for a relaunch of the same conversation — a new process, the same recipient", () => {
    const { api } = fakeApi(SENT);
    render(
      <MessageOverseerCard
        rows={[overseerRow({ id: "$1643", execution: running("conv-overseer-1", 6100) })]}
        unreadableRows={0}
        steer={api}
      />,
    );
    type("carry on from where you were");
    reload(
      <MessageOverseerCard
        rows={[overseerRow({ id: "$1643", execution: running("conv-overseer-1", 6200) })]}
        unreadableRows={0}
        steer={api}
      />,
    );
    expect(box().value).toBe("carry on from where you were");
  });

  it("does not restore one Overseer's line for a different Overseer conversation — and does for its own", () => {
    /* The same row, the same pane, the same CLAUDE_SESSION_ID claim on both
       sides (the fixture's default): only the verified conversation differs.
       So a key built from the handle, the pane or the claim would restore here,
       and only the conversation id tells the two apart. */
    const { api } = fakeApi(SENT);
    const on = (conversation: string, pid: number) => (
      <MessageOverseerCard
        rows={[overseerRow({ id: "$1643", execution: running(conversation, pid) })]}
        unreadableRows={0}
        steer={api}
      />
    );
    render(on("conv-overseer-1", 6100));
    type("meant for the old one");
    reload(on("conv-overseer-2", 6200));
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBe("meant for the old one");
    reload(on("conv-overseer-1", 6300));
    expect(box().value).toBe("meant for the old one");
  });

  it("stores nothing while the Overseer's conversation cannot be told", () => {
    const { api } = fakeApi(SENT);
    // The fixture's default reading: an old producer, nothing verified.
    render(<MessageOverseerCard rows={[overseerRow({ id: "$1643" })]} unreadableRows={0} steer={api} />);
    type("typed while nobody could tell");
    expect(box().value).toBe("typed while nobody could tell");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps the words on screen and files none of them under the new Overseer when the claim moves mid-sentence", () => {
    const { api } = fakeApi(SENT);
    const before = [
      overseerRow({ id: "$1", name: "first-overseer", execution: running("conv-overseer-1", 6100) }),
      row({ id: "$2", name: "second-overseer", execution: running("conv-overseer-2", 6200) }),
    ];
    render(<MessageOverseerCard rows={before} unreadableRows={0} steer={api} />);
    type("to the first");

    const after = [
      row({ id: "$1", name: "first-overseer", execution: running("conv-overseer-1", 6100) }),
      overseerRow({ id: "$2", name: "second-overseer", execution: running("conv-overseer-2", 6200) }),
    ];
    render(<MessageOverseerCard rows={after} unreadableRows={0} steer={api} />);
    expect(text()).toContain("second-overseer");
    // Never destroyed: the words are the person's, and the card names who they now go to.
    expect(box().value).toBe("to the first");
    type("to the first, still");
    expect(window.sessionStorage.getItem(KEY("conv-overseer-2"))).toBeNull();
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBe("to the first");
  });

  it("does not let the new Overseer send words typed for the previous one", async () => {
    const { api, calls } = fakeApi(SENT);
    const before = [
      overseerRow({ id: "$1", name: "first-overseer", execution: running("conv-overseer-1", 6100) }),
      row({ id: "$2", name: "second-overseer", execution: running("conv-overseer-2", 6200) }),
    ];
    render(<MessageOverseerCard rows={before} unreadableRows={0} steer={api} />);
    type("only the first Overseer should receive this");

    const after = [
      row({ id: "$1", name: "first-overseer", execution: running("conv-overseer-1", 6100) }),
      overseerRow({ id: "$2", name: "second-overseer", execution: running("conv-overseer-2", 6200) }),
    ];
    render(<MessageOverseerCard rows={after} unreadableRows={0} steer={api} />);

    expect(box().value).toBe("only the first Overseer should receive this");
    expect(button("Send").disabled).toBe(true);
    await act(async () => button("Send").click());
    expect(calls).toHaveLength(0);
  });

  it("removes the stored line after a send that went, and keeps it after a refusal", async () => {
    const rows = [overseerRow({ id: "$1643", execution: running("conv-overseer-1") })];
    const refusing = fakeApi({
      ok: false,
      code: "declared-not-steerable",
      why: "it is a shell",
      status: 409,
      from: "server",
      delivery: { kind: "none" },
    });
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={refusing.api} />);
    type("try this");
    await act(async () => {
      button("Send").click();
    });
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBe("try this");

    const sending = fakeApi(SENT);
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={sending.api} />);
    await act(async () => {
      button("Send").click();
    });
    expect(sending.calls).toHaveLength(1);
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBeNull();
  });

  it("has a Clear that empties the box and removes the stored line", () => {
    const { api, calls } = fakeApi(SENT);
    const rows = [overseerRow({ id: "$1643", execution: running("conv-overseer-1") })];
    render(<MessageOverseerCard rows={rows} unreadableRows={0} steer={api} />);
    type("on second thoughts");
    act(() => button("Clear").click());
    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(KEY("conv-overseer-1"))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("says in one line that the message will not survive a reload when storage refuses", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    const { api } = fakeApi(SENT);
    render(
      <MessageOverseerCard
        rows={[overseerRow({ id: "$1643", execution: running("conv-overseer-1") })]}
        unreadableRows={0}
        steer={api}
      />,
    );
    expect(text()).not.toContain(draftNoticeSentence("storage-refused"));
    type("private mode");
    expect(box().value).toBe("private mode");
    expect(text()).toContain(draftNoticeSentence("storage-refused"));
  });
});
