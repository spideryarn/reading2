// @vitest-environment jsdom
/**
 * **THE DETAIL PANE'S TRANSCRIPT READER, AT THE TWO EDGES A PERSON MAKES** —
 * Stage 5 of docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md,
 * roadmap checkbox 4's second half: *"extend [the conversation-claim refresh
 * regressions] for late discovery, component unmount and duplicate tap. Do not
 * redo those earlier fixes."*
 *
 * The earlier fixes stay where they are, in tests/fleet-web.test.tsx § "recent
 * messages, when the pane keeps its handle and changes its agent" and § "…when
 * the execution reading contradicts the row's claim". This file adds what those
 * do not reach:
 *
 *  - **A duplicate tap on Read again.** A transcript read is a multi-megabyte
 *    disk read on a box that has hit load average 391, and `disabled` takes
 *    effect only after the redraw — so two taps inside one frame both reached
 *    `api.recent`. The same class as Stage 5a's double Start.
 *  - **The pane unmounting mid-read** — closed, or another session picked,
 *    which remounts `SessionDetail` (it is keyed by its target, SessionsPanel.tsx).
 *    React 19 no longer warns about a state update on an unmounted component, so
 *    these assert on what is drawn, on how many reads started, and on what is
 *    left scheduled — never on a `console.error` spy.
 *  - **The deadline the shared reader brings with it.** Adopting
 *    single-flight-reader.ts gave this reader a clock it never had: before, a
 *    read that never answered left "Reading…" on a disabled button for the life
 *    of the tab.
 *
 * **Late discovery gets one test, at the hook, and only one.** A server whose
 * row learned the claim before this page did answers under a claim the page did
 * not ask under, and `ofTheClaimAsked` turns that into the `moved` refusal
 * (Stage 1's F10 tests). A conversation id that appears after the pane opened
 * changes the claim half of `identityOf` ("re-reads when the conversation
 * changes under the same handle") — **but every one of those tests goes through
 * the page, where the same change also changes `SessionDetail`'s key and
 * remounts the reader.** So they cannot see what the reader itself does:
 * deleting `stop()` from its cleanup leaves all six green. The test below drives
 * the exported hook with no remount, which is the sequence neither covered.
 *
 * And piece B: the element the page moves focus into on selection is a named
 * region, so a screen reader announces which pane it has landed in.
 *
 * **Its own file** because tests/fleet-web.test.tsx is being edited by another
 * stage at the same time; the fixtures below are cut-down copies of that file's.
 */
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActionsApi } from "../tools/fleet/web/src/actions-client";
import { App } from "../tools/fleet/web/src/App";
import { COLUMN_MIN_PX, DETAIL_MIN_PX, PANE_GAP_PX } from "../tools/fleet/web/src/fit";
import {
  makeMessagesApi,
  parseRecentMessages,
  withClockSkew,
  type MessagesApi,
} from "../tools/fleet/web/src/messages-client";
import type { NewSessionApi } from "../tools/fleet/web/src/new-session-client";
import { Conversation, MESSAGES_READ_DEADLINE_MS, useRecentMessages } from "../tools/fleet/web/src/RecentMessages";
import type { RenameApi } from "../tools/fleet/web/src/rename-client";
import type { SteerApi } from "../tools/fleet/web/src/steer-client";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { CLOCK_SKEW_UNMEASURED, type FleetRow, type FleetState } from "../tools/fleet/web/src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let undoWidth: (() => void) | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  undoWidth?.();
  undoWidth = null;
  window.location.hash = "";
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * Fixtures — cut-down copies of tests/fleet-web.test.tsx's.
 * ------------------------------------------------------------------ */

/** A row, with the fields this file is not about set to what an older server sends. */
function rowOf(id: string, conversation: string | null, title = "a session"): FleetRow {
  return {
    id,
    paneId: "%2108",
    name: id,
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    title,
    repo: null,
    worktree: null,
    startedAt: new Date("2026-09-08T10:00:00Z").toISOString(),
    status: { kind: "idle" },
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: 4242,
    claudeSessionId: conversation,
    rawStatus: { kind: "idle" },
    rawQuestion: null,
  };
}

/** A transcript reply as `/api/messages` sends one, through the real parser. */
function messagesWire(text: string): Record<string, unknown> {
  return {
    kind: "found",
    path: "/home/greg/.claude/projects/-home-greg-code-spideryarn2/abc.jsonl",
    via: "slug-guess",
    turns: [
      {
        speaker: "assistant",
        at: new Date().toISOString(),
        text,
        truncated: false,
        fullChars: text.length,
        toolCalls: [],
        uuid: "u1",
      },
    ],
    reachedStartOfFile: true,
    bytesRead: 4_096,
    fileBytes: 4_096,
    lastModified: new Date().toISOString(),
    copies: 1,
    recordsParsed: 12,
    recordsUnparseable: 0,
    toolResultsSkipped: 0,
  };
}

/**
 * A messages api whose every read is HELD until the test lets it answer — the
 * only way to put a tap, an unmount or a clock *inside* a read. Each answer
 * names the conversation and the read's ordinal, so a test can tell which read
 * a turn on screen came from. Each read also keeps the signal it was handed,
 * so a test can ask whether the page really let go of it.
 */
type HeldRead = { conversation: string | null; signal: AbortSignal | undefined; answer: () => void };
function heldMessages(): { api: MessagesApi; reads: HeldRead[] } {
  const reads: HeldRead[] = [];
  const api: MessagesApi = {
    recent: (row, signal) =>
      new Promise((resolve) => {
        const nth = reads.length + 1;
        reads.push({
          conversation: row.claudeSessionId,
          signal,
          answer: () => resolve(parseRecentMessages(messagesWire(`a turn from ${row.claudeSessionId} read ${nth}`))),
        });
      }),
  };
  return { api, reads };
}

/** The signal read `index` was handed. Throws on a read that never started, or one handed none. */
function signalOf(reads: HeldRead[], index: number): AbortSignal {
  const read = reads[index];
  if (read === undefined) throw new Error(`read ${index + 1} never started; ${reads.length} did`);
  if (read.signal === undefined) throw new Error(`read ${index + 1} was handed no signal`);
  return read.signal;
}

/** Let read `index` answer, and flush what it releases. Throws on a read that never started. */
async function answer(reads: { answer: () => void }[], index: number): Promise<void> {
  const read = reads[index];
  if (read === undefined) throw new Error(`read ${index + 1} never started; ${reads.length} did`);
  await act(async () => {
    read.answer();
  });
}

/** A button anywhere on the page, by its exact visible text. */
function buttonSaying(text: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
}

function readAgain(): HTMLButtonElement {
  const button = buttonSaying("Read again");
  if (button === undefined) throw new Error("there is no Read again button on the page");
  return button;
}

/**
 * The reader and its panel, exactly as `SessionDetail` pairs them: one hook,
 * one `Conversation`. Keyed by the caller the way SessionsPanel keys the
 * detail, so rendering a different key IS the pane unmounting.
 */
function Pane({ api, row }: { api: MessagesApi; row: FleetRow }): ReactNode {
  const reading = useRecentMessages(api, row);
  return <Conversation row={row} now={Date.now()} reading={reading} />;
}

/* ------------------------------------------------------------------ *
 * A. The reader.
 * ------------------------------------------------------------------ */

describe("the detail pane's transcript reader, at a duplicate tap", () => {
  /**
   * **TWO TAPS BEFORE THE REDRAW, ONE READ.** Both clicks land inside one `act`,
   * so React has not re-rendered between them and the button is still enabled
   * for the second — the frame a real double tap on a phone lands in. The guard
   * has to be in the action; `disabled` cannot be it.
   *
   * **And the second tap is DROPPED, not coalesced into a read after this one**
   * — the last assertion before the control. See `read` in RecentMessages.tsx
   * for why.
   */
  it("starts one read for two taps on Read again, and none after it lands", async () => {
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    await answer(messages.reads, 0);
    expect(container.textContent ?? "").toContain("a turn from conv-A read 1");

    const again = readAgain();
    expect(again.disabled).toBe(false);
    act(() => {
      again.click();
      again.click();
    });
    expect(messages.reads).toHaveLength(2);

    await answer(messages.reads, 1);
    expect(container.textContent ?? "").toContain("a turn from conv-A read 2");
    // Dropped, not queued: nothing trails the read the first tap started.
    expect(messages.reads).toHaveLength(2);

    /* THE CONTROL. A guard that refused every tap would pass everything above;
       a tap once the read has landed must still read. */
    act(() => readAgain().click());
    expect(messages.reads).toHaveLength(3);
  });
});

describe("the detail pane's transcript reader, when the pane unmounts mid-read", () => {
  /**
   * **ANOTHER SESSION PICKED WHILE A READ OF THIS ONE IS OUT.** SessionsPanel
   * keys `SessionDetail` by its target, so this is an unmount of A's reader and
   * a mount of B's. A's answer — the opening read and a manual one, with a
   * duplicate tap on top — arrives after B's, which is the order that costs
   * something, and must neither be drawn nor start anything.
   */
  it("draws nothing from the old session's late answers and starts no read for it", async () => {
    const messages = heldMessages();
    act(() => root.render(<Pane key="$a" api={messages.api} row={rowOf("$a", "conv-A", "session A")} />));
    await answer(messages.reads, 0);
    act(() => {
      readAgain().click();
      readAgain().click();
    });
    expect(messages.reads.map((r) => r.conversation)).toEqual(["conv-A", "conv-A"]);

    act(() => root.render(<Pane key="$b" api={messages.api} row={rowOf("$b", "conv-B", "session B")} />));
    expect(messages.reads.map((r) => r.conversation)).toEqual(["conv-A", "conv-A", "conv-B"]);

    await answer(messages.reads, 2);
    await answer(messages.reads, 1);

    const text = container.textContent ?? "";
    expect(text).toContain("a turn from conv-B read 3");
    expect(text).not.toContain("conv-A");
    // Nothing started for A after it was gone — not a trailing read, not anything.
    expect(messages.reads.map((r) => r.conversation)).toEqual(["conv-A", "conv-A", "conv-B"]);
  });

  /**
   * **THE PANE CLOSED, AND NOTHING OF IT LEFT RUNNING.** What is drawn cannot
   * tell a stopped reader from one whose answer lands on an unmounted component
   * — React 19 drops that update silently — so this also asks what is still
   * SCHEDULED: the read's deadline is a timer, and a reader that was not stopped
   * leaves it armed to settle into a component that no longer exists.
   */
  it("leaves nothing scheduled and nothing drawn when the pane is closed during a read", async () => {
    vi.useFakeTimers();
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    await answer(messages.reads, 0);
    act(() => readAgain().click());
    expect(messages.reads).toHaveLength(2);
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the read's deadline, armed — so the next line means something

    act(() => root.render(<p>the session list</p>));
    expect(vi.getTimerCount()).toBe(0);

    await answer(messages.reads, 1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGES_READ_DEADLINE_MS * 2);
    });
    expect(container.textContent).toBe("the session list");
    expect(messages.reads).toHaveLength(2);
  });

  /**
   * **STRICTMODE'S REHEARSAL IS AN UNMOUNT TOO**, and main.tsx turns StrictMode
   * on. It mounts, cleans up and mounts again, so a reader built once per
   * component and stopped in the cleanup would be dead by the real mount: the
   * opening read would answer and Read again would do nothing, for ever, in
   * development only. The reader is built per effect run for this reason.
   */
  it("still reads again after StrictMode's rehearsal unmount", async () => {
    const messages = heldMessages();
    act(() =>
      root.render(
        <StrictMode>
          <Pane api={messages.api} row={rowOf("$a", "conv-A")} />
        </StrictMode>,
      ),
    );
    const opened = messages.reads.length;
    expect(opened).toBeGreaterThan(0);
    for (let i = 0; i < opened; i += 1) await answer(messages.reads, i);
    expect(container.textContent ?? "").toContain(`a turn from conv-A read ${opened}`);

    act(() => readAgain().click());
    expect(messages.reads).toHaveLength(opened + 1);
    await answer(messages.reads, opened);
    expect(container.textContent ?? "").toContain(`a turn from conv-A read ${opened + 1}`);
  });
});

describe("the detail pane's transcript reader, when its identity changes without a remount", () => {
  /**
   * **LATE DISCOVERY, IN PLACE.** A pane opened before its conversation id was
   * known, whose id is discovered while the first read is still out, and whose
   * first read answers last. Same component instance throughout — no key — so
   * nothing but the reader stands between the earlier answer and the screen.
   * `useRecentMessages` is exported and its header says its answer must not
   * rest on a caller happening to remount it; this is the test that holds it
   * to that.
   */
  it("replaces the read in flight when the conversation is discovered, and never draws the earlier answer", async () => {
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", null)} />));
    expect(messages.reads.map((r) => r.conversation)).toEqual([null]);

    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    // Replaced, not queued: the new read starts while the old one is still out.
    expect(messages.reads.map((r) => r.conversation)).toEqual([null, "conv-A"]);

    await answer(messages.reads, 1);
    await answer(messages.reads, 0);

    const text = container.textContent ?? "";
    expect(text).toContain("a turn from conv-A read 2");
    expect(text).not.toContain("a turn from null");
    expect(messages.reads).toHaveLength(2);
  });
});

describe("the detail pane's transcript reader, when a read never answers", () => {
  it("stops waiting at the deadline, says so, drops the late answer, and lets a person read again", async () => {
    vi.useFakeTimers();
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    expect(container.textContent ?? "").toContain("Reading the tail of this session's transcript");
    expect(buttonSaying("Reading…")?.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGES_READ_DEADLINE_MS + 1);
    });
    expect(container.textContent ?? "").toContain("This page could not get an answer it understands.");
    expect(container.textContent ?? "").toContain("stopped waiting");
    expect(readAgain().disabled).toBe(false);

    // The read it gave up on answers after all: too late to be drawn.
    await answer(messages.reads, 0);
    expect(container.textContent ?? "").not.toContain("a turn from conv-A read 1");

    act(() => readAgain().click());
    expect(messages.reads).toHaveLength(2);
    await answer(messages.reads, 1);
    expect(container.textContent ?? "").toContain("a turn from conv-A read 2");
  });
});

/**
 * **AN ABANDONED READ STOPS COSTING THE SERVER.** Everything above proves the
 * page DROPS an answer it has stopped waiting for; none of it can see whether
 * the read itself was cancelled, because a test double that ignores its signal
 * passes them all. Before this, `MessagesApi.recent` took no signal, so the
 * shared reader's abort reached nothing and a multi-megabyte transcript read ran
 * to completion on the box for an answer nobody would draw — plan 260910c's F5
 * class, *an `AbortController` in a hook that does not make the fetch aborts
 * nothing*, fixed here the way feed-client.ts and actions-client.ts fixed it.
 *
 * Each test asks two things: that the signal the read was handed is aborted at
 * the moment the page gives up, and — the control — that it was NOT aborted a
 * moment before, so an always-aborted signal cannot pass.
 */
describe("the detail pane's transcript reader, cancelling what it abandons", () => {
  it("hands the read a live signal", () => {
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    expect(signalOf(messages.reads, 0).aborted).toBe(false);
  });

  it("aborts the read in flight when the pane unmounts", () => {
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    const signal = signalOf(messages.reads, 0);
    expect(signal.aborted).toBe(false);

    act(() => root.render(<p>the session list</p>));
    expect(signal.aborted).toBe(true);
  });

  it("aborts the read at the deadline", async () => {
    vi.useFakeTimers();
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    const signal = signalOf(messages.reads, 0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MESSAGES_READ_DEADLINE_MS - 1);
    });
    expect(signal.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(signal.aborted).toBe(true);
  });

  it("aborts the read in flight when a newer identity replaces it, and not the newer one", () => {
    const messages = heldMessages();
    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", null)} />));
    const earlier = signalOf(messages.reads, 0);
    expect(earlier.aborted).toBe(false);

    act(() => root.render(<Pane api={messages.api} row={rowOf("$a", "conv-A")} />));
    expect(earlier.aborted).toBe(true);
    expect(signalOf(messages.reads, 1).aborted).toBe(false);
  });

  /**
   * **THROUGH THE PAGE, because the page wraps the api.** App.tsx hands the
   * detail `withClockSkew(messagesApi, …)`, not `messagesApi` itself, so a
   * wrapper that dropped the signal would leave every hook-level test above
   * green and the production read uncancellable. This mounts the real App.
   */
  it("reaches the api the App was given, through the clock-skew wrapper", async () => {
    const feed = manualTransport();
    const messages = heldMessages();
    mountApp(feed.transport, messages.api);
    act(() => feed.push(state([rowOf("$a", "conv-A", "the one I picked")])));
    openSession("the one I picked");
    await act(async () => {});
    expect(signalOf(messages.reads, 0).aborted).toBe(false);
  });
});

describe("the messages client, passing the signal on", () => {
  const found = (): Response =>
    new Response(JSON.stringify(messagesWire("hello")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("hands fetch the signal it was given", async () => {
    const seen: (RequestInit | undefined)[] = [];
    const api = makeMessagesApi(async (_url, init) => {
      seen.push(init);
      return found();
    });
    const controller = new AbortController();
    await api.recent(rowOf("$a", "conv-A"), controller.signal);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.signal).toBe(controller.signal);
  });

  /* `exactOptionalPropertyTypes` refuses `signal: undefined`, and a caller with
     no signal should send the request it always sent. */
  it("sends no signal key at all when given none", async () => {
    const seen: (RequestInit | undefined)[] = [];
    const api = makeMessagesApi(async (_url, init) => {
      seen.push(init);
      return found();
    });
    await api.recent(rowOf("$a", "conv-A"));
    expect(seen).toHaveLength(1);
    expect(seen[0] !== undefined && "signal" in seen[0]).toBe(false);
  });

  it("keeps the signal through withClockSkew", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const inner: MessagesApi = {
      recent: async (_row, signal) => {
        seen.push(signal);
        return parseRecentMessages(messagesWire("hello"));
      },
    };
    const controller = new AbortController();
    await withClockSkew(inner, () => CLOCK_SKEW_UNMEASURED).recent(rowOf("$a", "conv-A"), controller.signal);
    expect(seen).toEqual([controller.signal]);
  });
});

/* ------------------------------------------------------------------ *
 * B. The focus target has a name.
 * ------------------------------------------------------------------ */

function state(rows: FleetRow[]): FleetState {
  return {
    collectedAt: new Date().toISOString(),
    tookMs: 12_000,
    error: null,
    rows,
    unreadableRows: 0,
    health: null,
    refreshMs: null,
    attention: { kind: "not-asked" },
    questions: { kind: "not-observed", gaps: [{ kind: "attention-not-asked" }] },
    overseer: { kind: "not-asked" },
    usage: { kind: "not-asked" },
    currentWork: { kind: "not-reported" },
    clockSkew: CLOCK_SKEW_UNMEASURED,
    answeringEnabled: { kind: "not-reported" },
    attemptedAt: { kind: "not-reported", why: "the fixture did not say" },
    tmuxServerPid: 132280,
  };
}

function manualTransport(): { transport: Transport; push: (next: FleetState) => void } {
  let sink: TransportSink | null = null;
  return {
    transport: (s) => {
      sink = s;
      return { refresh: () => {}, stop: () => {} };
    },
    push: (next) => sink?.onState(next),
  };
}

const unused = (what: string) => async (): Promise<never> => {
  throw new Error(`${what} is not part of this test`);
};

/** Every write path faked, so nothing here can reach `fetch`. */
function mountApp(transport: Transport, messagesApi: MessagesApi): void {
  const steer: SteerApi = { message: unused("steer.message"), answer: unused("steer.answer") };
  const newSession: NewSessionApi = {
    start: unused("newSession.start"),
    poll: async () => ({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [] } }),
  };
  const rename: RenameApi = { rename: unused("rename") };
  const actionsApi: ActionsApi = {
    feed: async () => ({ ok: false, why: "the fixture serves no actions" }),
    run: unused("run"),
    queueMessage: unused("queueMessage"),
    cancel: unused("cancel"),
    revive: unused("revive"),
    abandon: unused("abandon"),
    clear: unused("clear"),
    releaseHold: unused("releaseHold"),
    boxPreview: unused("boxPreview"),
    boxConfirm: unused("boxConfirm"),
  };
  act(() =>
    root.render(
      <App
        transport={transport}
        steer={steer}
        newSession={newSession}
        rename={rename}
        actionsApi={actionsApi}
        messagesApi={messagesApi}
        actionsPollMs={3_600_000}
      />,
    ),
  );
}

/** Pin every element's width, so `choosePanes` sees the window a test means. */
function pinWidth(px: number): void {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth");
  Object.defineProperty(Element.prototype, "clientWidth", { configurable: true, get: () => px });
  undoWidth = () => {
    if (original) Object.defineProperty(Element.prototype, "clientWidth", original);
  };
}

function openSession(title: string): void {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button.session-open")].find(
    (b) => b.textContent === title,
  );
  if (!button) throw new Error(`no session card titled ${JSON.stringify(title)} on the page`);
  act(() => button.click());
}

describe("the detail pane's focus target", () => {
  /**
   * **THE PLACE FOCUS LANDS, AND WHAT IT IS CALLED THERE.** Selecting a session
   * moves focus into the detail (the callback ref in SessionsPanel.tsx), and an
   * `aria-label` on a `div` with no role may not be announced at all — so a
   * screen-reader user was moved somewhere with no name. Both layouts carry the
   * target, so both are checked; which layout rendered is proved by whether the
   * list is still on screen beside it.
   */
  for (const layout of ["one pane", "two panes"] as const) {
    it(`exposes the selected session as a named region, and moves focus into it — ${layout}`, async () => {
      if (layout === "two panes") pinWidth(COLUMN_MIN_PX + DETAIL_MIN_PX + PANE_GAP_PX + 40);
      const feed = manualTransport();
      mountApp(feed.transport, heldMessages().api);
      act(() => feed.push(state([rowOf("$a", "conv-A", "the one I picked")])));
      openSession("the one I picked");
      await act(async () => {});

      /* jsdom computes no roles, so this spells out HTML-AAM's rule for the two
         ways to write a region: a `<section>` is one exactly when it has an
         accessible name, and an explicit `role="region"` always is. A `div`
         with only a label is neither, which is the defect. */
      const regions = [...container.querySelectorAll<HTMLElement>('section, [role="region"]')].filter(
        (el) => el.getAttribute("aria-label") === "The selected session",
      );
      expect(regions).toHaveLength(1);
      const region = regions[0] as HTMLElement;
      expect(region.textContent ?? "").toContain("the one I picked");
      expect(document.activeElement).toBe(region);

      const listBeside = container.querySelectorAll("button.session-open").length > 0;
      expect(listBeside).toBe(layout === "two panes");
    });
  }
});
