// @vitest-environment jsdom
/**
 * **THE "RECENT MESSAGES" TAB**, from the bytes the server composes to the
 * words on screen.
 *
 * ## The join, drawn through the real producer
 *
 * The class of bug this area keeps producing is a producer with no consumer:
 * every part tested, the edge between them missing, nothing red
 * (docs/postmortems/260908b). Four fields reached the browser and were dropped
 * by the client on four separate occasions in one night.
 *
 * So the first test here builds the payload with `feedPayload` — the function
 * the route calls — serialises it, parses it with `parseFeed`, which is the
 * browser's own parser, and asserts on text in the DOM. Four hops, none of them
 * faked. Everything after that drives the panel directly, because *what does a
 * suspect attribution look like* is a rendering question and does not need a
 * server.
 *
 * ## What this tab must never do, which is what most of these tests are
 *
 * Show a message under a session's name as though the attribution were settled,
 * or a short list as though it were complete. The reader was never watching
 * these sessions, so nothing on screen contradicts a wrong answer.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FleetSnapshot } from "../tools/fleet/collect.js";
import { feedPayload } from "../tools/fleet/routes-recent-feed.js";
import type { RecentMessages, TranscriptTurn } from "../tools/fleet/transcript.js";
import { App } from "../tools/fleet/web/src/App";
import { FeedPanel } from "../tools/fleet/web/src/FeedPanel";
import {
  NO_FILTERS,
  applyFilters,
  filtersFromParams,
  isToolCallOnly,
  limitFromParams,
  paramsFromFilters,
  parseFeed,
  sessionStatusOf,
  TURN_AHEAD_TOLERANCE_MS,
  turnAge,
  type FeedApi,
  type FeedRow,
  type FeedView,
  type SessionListReading,
} from "../tools/fleet/web/src/feed-client";
import type { MessageSpeaker } from "../tools/fleet/web/src/messages-client";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";
import type { Transport, TransportSink } from "../tools/fleet/web/src/transport";
import { CLOCK_SKEW_UNMEASURED, parseFleetState, type FleetRow, type FleetState } from "../tools/fleet/web/src/types";

const NOW = Date.parse("2026-09-09T01:00:00.000Z");

/* React only honours `act` when it is told it is in a test environment.
   Without it every render warns, and — worse — the warning is the only sign
   that the flush this file depends on was never guaranteed. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function turn(at: string | null, text: string, over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    speaker: "assistant",
    at,
    text,
    truncated: false,
    fullChars: text.length,
    toolCalls: [],
    uuid: `u-${text}`,
    ...over,
  };
}

function found(turns: TranscriptTurn[], over: Partial<Extract<RecentMessages, { kind: "found" }>> = {}): RecentMessages {
  return {
    kind: "found",
    path: "/fixture.jsonl",
    via: "slug-guess",
    turns,
    reachedStartOfFile: true,
    bytesRead: 1024,
    fileBytes: 1024,
    lastModified: "2026-09-09T00:59:00.000Z",
    copies: 1,
    recordsParsed: turns.length,
    recordsUnparseable: 0,
    toolResultsSkipped: 0,
    ...over,
  };
}

function snapshotOf(names: string[]): FleetSnapshot {
  return {
    rows: names.map((name, i) => ({
      id: `$${i + 1}`,
      name,
      title: null,
      claudeSessionId: "3d1b8e57-90af-4c26-8e14-6b2075af93d1",
      meta: { version: 1, dir: "/repo" },
      status: { kind: "idle" },
    })),
    collectedAt: "2026-09-09T00:59:30.000Z",
    tookMs: 1,
    tmuxServerPid: 42,
  } as unknown as FleetSnapshot;
}

/**
 * One session row of the shape `parseFleetState` produces.
 *
 * Every field is named rather than inherited from a default, which is the rule
 * `tests/fleet-web.test.tsx` states at length: a fixture that quietly says
 * "we looked and this session is waiting for nothing" is making a claim no
 * fixture is in a position to make. All the vague arms here are the ones the
 * parser produces for a payload that carried no such field.
 */
function sessionRow(id: string, name: string, status: FleetRow["status"] = { kind: "idle" }): FleetRow {
  return {
    id,
    paneId: null,
    name,
    title: null,
    description: { kind: "not-yet-described", why: "no describe pass in this fixture" },
    execution: { kind: "unknown", cause: "not-reported", why: "the fixture carried no execution reading" },
    repo: null,
    worktree: null,
    startedAt: "2026-09-08T10:00:00.000Z",
    status,
    question: null,
    permissionMode: { kind: "cannot-tell", why: "the fixture did not say" },
    pause: { kind: "cannot-tell", why: "the fixture did not say", cause: "rate-limits-not-collected" },
    meta: { version: "legacy" },
    role: { kind: "none" },
    panePid: null,
    claudeSessionId: null,
    rawStatus: status,
    rawQuestion: null,
  };
}

/** An api that answers with a view, for driving the panel directly. */
function apiOf(view: FeedView): FeedApi {
  return { recent: () => Promise.resolve(view) };
}

/** Render, and flush the promise the panel fetches with. */
async function draw(node: React.ReactElement): Promise<string> {
  await act(async () => {
    root.render(node);
  });
  return host.textContent ?? "";
}

/**
 * `now` is destructured out of the overrides rather than spread through it,
 * because it is REQUIRED on the panel and `exactOptionalPropertyTypes` will not
 * let a `Partial<>` spread satisfy a required prop. The panel takes no clock of
 * its own on purpose — a component that calls `Date.now()` is one whose ages can
 * disagree with the rest of the page, and one a test cannot pin.
 */
function panel(view: FeedView, over: Partial<Parameters<typeof FeedPanel>[0]> = {}): React.ReactElement {
  const { now, skew, ...rest } = over;
  return (
    <FeedPanel
      api={apiOf(view)}
      limit={50}
      onLimit={() => {}}
      filters={NO_FILTERS}
      onFilters={() => {}}
      now={now ?? NOW}
      skew={skew ?? CLOCK_SKEW_UNMEASURED}
      {...rest}
    />
  );
}

/**
 * What the row actually SHOWS, with the screen-reader-only text removed.
 *
 * **`host.textContent` is not what a sighted reader sees.** `Explain` puts the
 * whole tooltip — including the three-zone absolute timestamp — into an
 * `sr-only` span inside the control, so a test asserting "the ISO string is
 * gone" against the raw text is asserting nothing at all: it is reading the
 * tooltip it just put there. GPT Sol's P2 on the code review.
 */
function visibleText(): string {
  const clone = host.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll('[class*="sr-only"]')) hidden.remove();
  return clone.textContent ?? "";
}

describe("the join, server to screen", () => {
  /**
   * **THE FOUR HOPS.** `feedPayload` is what the route calls; `JSON` is the
   * wire; `parseFeed` is the browser's parser; the panel is the screen. A field
   * the server sends and the client drops cannot survive this test, which is
   * the only kind of test that catches it.
   */
  it("carries a message from the server's own composer to the DOM", async () => {
    const payload = await feedPayload(
      {
        snapshot: () => snapshotOf(["alpha", "beta"]),
        nowMs: () => NOW,
        read: async (row) =>
          found([turn("2026-09-09T00:40:00.000Z", `something ${row.name} said`)]),
      },
      50,
    );
    const view = parseFeed(JSON.parse(JSON.stringify(payload)));
    expect(view.kind).toBe("feed");
    const text = await draw(panel(view));
    expect(text).toContain("something alpha said");
    expect(text).toContain("something beta said");
    expect(text).toContain("alpha");
  });

  /**
   * The ordering is the server's and the client must not re-do it. Goes red if
   * the panel sorts, or if `parseFeed` reverses.
   */
  it("keeps the server's newest-first order rather than re-sorting", async () => {
    const payload = await feedPayload(
      {
        snapshot: () => snapshotOf(["alpha", "beta"]),
        nowMs: () => NOW,
        read: async (row) =>
          found([
            turn(row.name === "alpha" ? "2026-09-09T00:10:00.000Z" : "2026-09-09T00:50:00.000Z", `${row.name}-said`),
          ]),
      },
      50,
    );
    const view = parseFeed(JSON.parse(JSON.stringify(payload)));
    const order = view.kind === "feed" ? view.messages.map((m) => m.turn.text) : [];
    expect(order).toEqual(["beta-said", "alpha-said"]);
    const text = await draw(panel(view));
    expect(text.indexOf("beta-said")).toBeLessThan(text.indexOf("alpha-said"));
  });
});

describe("parseFeed", () => {
  it("says so, in its own voice, when the answer is not this API", () => {
    expect(parseFeed({ hello: "world" })).toMatchObject({ kind: "no-answer" });
    expect(parseFeed("nonsense")).toMatchObject({ kind: "no-answer" });
  });

  it("keeps the server's unreadable arm rather than showing an empty feed", () => {
    const view = parseFeed({ schema: 1, kind: "unreadable", why: "no collection yet" });
    expect(view).toMatchObject({ kind: "unreadable", why: "no collection yet" });
  });

  /**
   * A message with no session cannot be attributed, and putting it on screen
   * under a blank name is the misattribution this payload is shaped to prevent.
   * It is COUNTED, not silently dropped.
   */
  it("refuses a message with no session, and counts it rather than hiding it", () => {
    const view = parseFeed({
      schema: 1,
      kind: "feed",
      limit: 50,
      messages: [{ text: "orphan", speaker: "assistant" }, { sessionId: "$1", text: "fine", speaker: "assistant" }],
      undated: [],
      sessions: [],
      coverage: { kind: "complete" },
    });
    expect(view.kind === "feed" ? view.messages.map((m) => m.turn.text) : []).toEqual(["fine"]);
    expect(view.kind === "feed" ? view.unreadableRows : -1).toBe(1);
  });

  /**
   * **THE UNDER-CLAIM.** `complete` is a positive assertion that a session's
   * newest turns were all read. A server that did not say has not made it, and
   * inventing `true` would silence the warning that stops a truncated session
   * reading as a quiet one.
   */
  it("treats an unstated `complete` as not complete", () => {
    const view = parseFeed({
      schema: 1,
      kind: "feed",
      limit: 50,
      messages: [],
      undated: [],
      sessions: [{ sessionId: "$1", name: "alpha", read: { kind: "read", turns: 3 } }],
      coverage: { kind: "complete" },
    });
    expect(view.kind === "feed" ? view.sessions[0]?.read : null).toMatchObject({ complete: false });
  });

  /**
   * **A PAYLOAD MISSING A REQUIRED LIST IS NOT AN EMPTY FEED.**
   *
   * Until GPT Sol's P1 on the code review, an absent array parsed as a
   * successfully empty one — so `{ kind: "feed", coverage: { kind: "complete" } }`
   * rendered as a *confidently complete* feed with no messages, no sessions and
   * no caveat: exactly the "we looked and the fleet was silent" claim this
   * payload exists to prevent, produced by a body that said almost nothing.
   *
   * Goes red if any of the three required arrays stops being required.
   */
  it("refuses a feed that is missing a required list, rather than drawing it as empty", () => {
    expect(parseFeed({ schema: 1, kind: "feed", coverage: { kind: "complete" } })).toMatchObject({
      kind: "no-answer",
    });
    for (const missing of ["messages", "undated", "sessions"]) {
      const body: Record<string, unknown> = {
        schema: 1,
        kind: "feed",
        messages: [],
        undated: [],
        sessions: [],
        coverage: { kind: "complete" },
      };
      delete body[missing];
      expect(parseFeed(body), `missing ${missing}`).toMatchObject({ kind: "no-answer" });
    }
    /* And the complete one is still a feed. */
    expect(
      parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], sessions: [], coverage: { kind: "complete" } })
        .kind,
    ).toBe("feed");
  });

  /**
   * A later build's payload is not this one. Guessing at it would render some
   * fields and drop the rest silently; saying so plainly is the honest answer.
   */
  it("refuses a schema it was not written for", () => {
    expect(
      parseFeed({ schema: 2, kind: "feed", messages: [], undated: [], sessions: [], coverage: { kind: "complete" } }),
    ).toMatchObject({ kind: "no-answer" });
    expect(
      parseFeed({ kind: "feed", messages: [], undated: [], sessions: [], coverage: { kind: "complete" } }),
    ).toMatchObject({ kind: "no-answer" });
  });

  /**
   * Rounding an unfamiliar speaker to `assistant` would misattribute a message.
   * transcript.ts calls a compaction summary "the single most convincing wrong
   * answer this module could give".
   */
  it("rounds an unknown speaker to unrecognised, never to the agent", () => {
    const view = parseFeed({
      schema: 1,
      kind: "feed",
      messages: [{ sessionId: "$1", speaker: "something-new", text: "hi" }],
      undated: [],
      sessions: [],
      coverage: { kind: "complete" },
    });
    expect(view.kind === "feed" ? view.messages[0]?.turn.speaker : null).toBe("unrecognised");
  });

  /** An unrecognised attribution must under-claim, never become `verified`. */
  it("rounds an unknown attribution down to claimed-only", () => {
    const view = parseFeed({
      schema: 1,
      kind: "feed",
      messages: [{ sessionId: "$1", speaker: "assistant", text: "hi", attribution: { kind: "brand-new" } }],
      undated: [],
      sessions: [],
      coverage: { kind: "complete" },
    });
    expect(view.kind === "feed" ? view.messages[0]?.attribution.kind : null).toBe("claimed-only");
  });
});

describe("the filters", () => {
  const rows: FeedRow[] = [
    {
      sessionId: "$1",
      sessionName: "alpha",
      sessionTitle: null,
      attribution: { kind: "claimed-only", why: "w" },
      turn: { speaker: "assistant", at: "t", text: "hello world", truncated: false, fullChars: 11, toolCalls: [], uuid: "a" },
    },
    {
      sessionId: "$2",
      sessionName: "beta",
      sessionTitle: null,
      attribution: { kind: "claimed-only", why: "w" },
      turn: { speaker: "human", at: "t", text: "goodbye", truncated: false, fullChars: 7, toolCalls: [], uuid: "b" },
    },
    {
      sessionId: "$1",
      sessionName: "alpha",
      sessionTitle: null,
      attribution: { kind: "claimed-only", why: "w" },
      turn: { speaker: "assistant", at: "t", text: "", truncated: false, fullChars: 0, toolCalls: [{ name: "Bash", detail: "ls" }], uuid: "c" },
    },
  ];

  it("keeps everything when nothing is chosen", () => {
    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(3);
  });

  it("narrows by session", () => {
    expect(applyFilters(rows, { ...NO_FILTERS, sessions: ["$2"] }).map((r) => r.turn.text)).toEqual(["goodbye"]);
  });

  it("narrows by speaker", () => {
    expect(applyFilters(rows, { ...NO_FILTERS, speakers: ["human"] }).map((r) => r.turn.text)).toEqual(["goodbye"]);
  });

  it("narrows by text, case-insensitively, and searches the session name too", () => {
    expect(applyFilters(rows, { ...NO_FILTERS, text: "HELLO" }).map((r) => r.turn.text)).toEqual(["hello world"]);
    expect(applyFilters(rows, { ...NO_FILTERS, text: "beta" }).map((r) => r.turn.text)).toEqual(["goodbye"]);
  });

  /** A reader typing `(` into a search box must not get an error. */
  it("treats the text filter as a substring, never a regex", () => {
    expect(() => applyFilters(rows, { ...NO_FILTERS, text: "((" })).not.toThrow();
    expect(applyFilters(rows, { ...NO_FILTERS, text: "((" })).toEqual([]);
  });

  /**
   * **A TURN THAT SAYS SOMETHING *AND* CALLS A TOOL IS A MESSAGE.** Hiding it
   * would drop the agent's own words, which is the failure mode of every "hide
   * noise" toggle that was ever regretted.
   */
  it("hides only the turns that were nothing but tool calls", () => {
    const speaking: FeedRow = {
      ...rows[0]!,
      turn: { ...rows[0]!.turn, text: "I will run this", toolCalls: [{ name: "Bash", detail: "ls" }], uuid: "d" },
    };
    expect(isToolCallOnly(speaking)).toBe(false);
    expect(isToolCallOnly(rows[2]!)).toBe(true);
    const kept = applyFilters([...rows, speaking], { ...NO_FILTERS, hideToolCalls: true });
    expect(kept.map((r) => r.turn.uuid)).toEqual(["a", "b", "d"]);
  });
});

describe("what the panel must not hide", () => {
  function feedOf(over: Partial<Extract<FeedView, { kind: "feed" }>>): FeedView {
    return {
      kind: "feed",
      limit: 50,
      messages: [],
      undated: [],
      sessions: [],
      sessionsOffered: true,
      unreadableRows: 0,
      coverage: { kind: "complete" },
      collectedAt: null,
      readStartedAt: null,
      readFinishedAt: null,
      servedAt: null,
      tmuxServerPid: 132280,
      ...over,
    };
  }

  const message = (over: Partial<FeedRow> = {}): FeedRow => ({
    sessionId: "$1",
    sessionName: "alpha",
    sessionTitle: null,
    attribution: { kind: "claimed-only", why: "w" },
    turn: { speaker: "assistant", at: "t", text: "hello", truncated: false, fullChars: 5, toolCalls: [], uuid: "a" },
    ...over,
  });

  /**
   * **THE WARNING THAT STOPS "THE LAST 50" BEING A LIE.** Goes red if `Caveats`
   * stops rendering the coverage reasons.
   */
  it("says out loud when this may not be the last N messages", async () => {
    const text = await draw(
      panel(
        feedOf({
          messages: [message()],
          coverage: {
            kind: "indeterminate",
            reasons: [
              { sessionId: "$9", name: "chatty-one", kind: "byte-budget", why: "cut short by the read budget" },
            ],
          },
        }),
      ),
    );
    expect(text).toContain("may not be the last");
    expect(text).toContain("chatty-one");
    expect(text).toContain("cut short by the read budget");
  });

  /**
   * **THE ONE FIELD WHERE UNDER- AND OVER-CLAIMING ARE NOT SYMMETRIC.** A build
   * that met a coverage arm it did not understand and rounded it to `complete`
   * would put a confident "the last 50 messages" over a feed with a hole in it.
   */
  it("will not call a feed complete when the server did not say it was", () => {
    for (const coverage of [undefined, null, {}, { kind: "brand-new" }, { kind: "indeterminate" }]) {
      const view = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], sessions: [], coverage });
      expect(view.kind === "feed" ? view.coverage.kind : null).toBe("indeterminate");
    }
  });

  /** An unfamiliar reason is kept, not dropped — dropping the last one reads as complete. */
  it("keeps a coverage reason it does not recognise rather than emptying the list", () => {
    const view = parseFeed({
      schema: 1,
      kind: "feed",
      messages: [],
      undated: [],
      sessions: [],
      coverage: {
        kind: "indeterminate",
        reasons: [{ sessionId: "$1", name: "alpha", kind: "some-future-reason", why: "something new went wrong" }],
      },
    });
    expect(view.kind === "feed" ? view.coverage.kind : null).toBe("indeterminate");
    const reasons = view.kind === "feed" && view.coverage.kind === "indeterminate" ? view.coverage.reasons : [];
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.why).toBe("something new went wrong");
  });

  /**
   * A session with no readable transcript is a row saying so, not an absence.
   * Nine of 21 rows on the box are like this.
   */
  it("accounts for the sessions it could not read, rather than omitting them", async () => {
    const text = await draw(
      panel(
        feedOf({
          messages: [message()],
          sessions: [
            { sessionId: "$1", name: "alpha", title: null, read: { kind: "read", turns: 1, complete: true, lastModified: "t", bytesRead: 1, fileBytes: 1, toolResultsSkipped: 0, copies: 1, recordsUnparseable: 0 } },
            { sessionId: "$2", name: "a-shell", title: null, read: { kind: "not-found", reason: "no-claude-session-id", why: "this session has no conversation id" } },
          ],
        }),
      ),
    );
    expect(text).toContain("1 of 2 sessions had no readable transcript");
  });

  /** A suspect attribution goes on the message, not into a footnote. */
  it("marks a message whose session may have been re-used", async () => {
    const text = await draw(
      panel(
        feedOf({
          messages: [message({ attribution: { kind: "suspect", why: "the pane may have been re-used" } })],
        }),
      ),
    );
    expect(text).toContain("may not be this session");
  });

  /**
   * **TWO DIFFERENT EMPTINESSES.** "Your filters match nothing" is the reader's
   * own doing. "No session has said anything" is a claim about the fleet, and
   * saying the second when the first is true would be a manufactured outage.
   */
  it("tells an empty filter result apart from an empty fleet", async () => {
    const filtered = await draw(
      panel(feedOf({ messages: [message()] }), { filters: { ...NO_FILTERS, text: "nothing matches this" } }),
    );
    expect(filtered).toContain("match these filters");
    expect(filtered).not.toContain("has a readable message");

    const empty = await draw(panel(feedOf({ messages: [] })));
    expect(empty).toContain("No session in this window has a readable message");
  });

  /**
   * **THE UNDATED GROUP IS NOT A LOOPHOLE IN THE FILTERS.**
   *
   * It bypassed `applyFilters` entirely until GPT Sol's P2, so a speaker or
   * text filter left the undated rows sitting on screen underneath a list that
   * had excluded them — and the tally, counting only the dated rows, could say
   * "0 messages" over a panel visibly showing some. Three statements, no two of
   * them agreeing.
   *
   * Goes red if `shownUndated` stops being filtered.
   */
  it("applies the filters to the undated group too, and counts it", async () => {
    const undatedRow = message({
      turn: { speaker: "assistant", at: null, text: "undated and unwanted", truncated: false, fullChars: 20, toolCalls: [], uuid: "z" },
    });
    const text = await draw(
      panel(feedOf({ messages: [message()], undated: [undatedRow] }), {
        filters: { ...NO_FILTERS, text: "hello" },
      }),
    );
    /* The dated row matches "hello"; the undated one does not, and must go. */
    expect(text).toContain("hello");
    expect(text).not.toContain("undated and unwanted");
    /* And the tally counts both groups, so it cannot disagree with the screen. */
    expect(text).toContain("1 of 2 messages");
  });

  /** Undated messages are shown rather than dropped, and kept out of the ordering. */
  it("shows an undated message in its own group", async () => {
    const text = await draw(
      panel(
        feedOf({
          messages: [message()],
          undated: [message({ turn: { speaker: "assistant", at: null, text: "no clock on this", truncated: false, fullChars: 16, toolCalls: [], uuid: "z" } })],
        }),
      ),
    );
    expect(text).toContain("Undated");
    expect(text).toContain("no clock on this");
  });

  /** The server's failure is the server's sentence, and ours is ours. */
  it("distinguishes a server that could not look from a page that got no answer", async () => {
    const server = await draw(panel({ kind: "unreadable", why: "the collector has not run" }));
    expect(server).toContain("could not build this feed");
    expect(server).toContain("the collector has not run");

    const wire = await draw(panel({ kind: "no-answer", why: "this browser could not reach the dashboard" }));
    expect(wire).toContain("did not get an answer it could read");
  });
});

describe("expanding a message in place", () => {
  function longMessage(): FeedView {
    return {
      kind: "feed",
      limit: 50,
      messages: [
        {
          sessionId: "$1",
          sessionName: "alpha",
          sessionTitle: null,
          attribution: { kind: "claimed-only", why: "w" },
          turn: {
            speaker: "assistant",
            at: "t",
            text: "the first line only\nand the rest of it, which is hidden until asked for",
            truncated: false,
            fullChars: 70,
            toolCalls: [],
            uuid: "a",
          },
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
      tmuxServerPid: 132280,
    };
  }

  it("shows the first line, then the rest when asked", async () => {
    await draw(panel(longMessage()));
    expect(host.textContent ?? "").toContain("the first line only");
    expect(host.textContent ?? "").not.toContain("which is hidden until asked for");

    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show the rest"));
    expect(more).toBeDefined();
    await act(async () => more?.click());
    expect(host.textContent ?? "").toContain("which is hidden until asked for");
  });

  /**
   * **EXPANDING SHOWS EVERYTHING THE SERVER SENT, WHICH IS NOT EVERYTHING THE
   * AGENT SAID.** The reader caps a turn at 2,000 characters. Dropping the
   * disclosure on expand would turn "here is more" into "here is all of it" —
   * GPT Sol's P2.3.
   */
  it("keeps the cut-short disclosure after expanding", async () => {
    const view = longMessage();
    if (view.kind === "feed" && view.messages[0]) {
      view.messages[0].turn.truncated = true;
      view.messages[0].turn.fullChars = 9000;
    }
    await draw(panel(view));
    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show the rest"));
    await act(async () => more?.click());
    expect(host.textContent ?? "").toContain("Cut short by the reader");
    expect(host.textContent ?? "").toContain("9,000");
  });
});

describe("two refreshes that land out of order", () => {
  /**
   * **AN OLDER ANSWER MUST NOT OVERWRITE A NEWER ONE.** Two refreshes can
   * resolve in either order, and the older arriving second would put a stale
   * feed on screen looking entirely healthy — there is no per-session identity
   * here to notice the swap. The per-session reader guards this with a
   * monotonic request token and so does `useFeed`.
   *
   * GPT Sol's P1.7. Goes red if the `generation` ref is removed.
   */
  it("ignores the stale answer rather than showing it", async () => {
    const answers: ((view: FeedView) => void)[] = [];
    const api: FeedApi = { recent: () => new Promise<FeedView>((resolve) => answers.push(resolve)) };
    const feedWith = (text: string): FeedView => ({
      kind: "feed",
      limit: 50,
      messages: [
        {
          sessionId: "$1",
          sessionName: "alpha",
          sessionTitle: null,
          attribution: { kind: "claimed-only", why: "w" },
          turn: { speaker: "assistant", at: "t", text, truncated: false, fullChars: text.length, toolCalls: [], uuid: text },
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
      tmuxServerPid: 132280,
    });

    await act(async () => {
      root.render(
        <FeedPanel api={api} limit={50} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} now={NOW} skew={CLOCK_SKEW_UNMEASURED} />,
      );
    });
    /* A second read started before the first has answered — through the SIZE
       control rather than the refresh button, because the button disables
       itself while a read is in flight and so cannot produce this race. The
       size control can: changing it restarts the read with a new limit, and
       nothing stops the reader doing that twice in a second. */
    await act(async () => {
      root.render(
        <FeedPanel api={api} limit={100} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} now={NOW} skew={CLOCK_SKEW_UNMEASURED} />,
      );
    });
    expect(answers).toHaveLength(2);

    // The NEWER one lands first, then the older one.
    await act(async () => answers[1]?.(feedWith("the fresh answer")));
    await act(async () => answers[0]?.(feedWith("the stale answer")));

    expect(host.textContent ?? "").toContain("the fresh answer");
    expect(host.textContent ?? "").not.toContain("the stale answer");
  });
});

describe("the filters in the URL", () => {
  /**
   * The page is reloaded whenever iOS reclaims the tab, so a filter that lives
   * only in memory is one nobody bothers to set. mode.ts § the hash.
   */
  it("survives a round trip through the hash", () => {
    const filters = { sessions: ["$1", "$2"], speakers: ["human"] as MessageSpeaker[], text: "deploy", hideToolCalls: true };
    const params = paramsFromFilters(filters);
    const asHash: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) if (v !== null) asHash[k] = v;
    expect(filtersFromParams(asHash)).toEqual(filters);
  });

  /**
   * **A DEFAULT LEAVES NO TRACE.** `null` is what mode.ts turns into a removed
   * key, so "back to showing everything" produces a clean URL rather than a
   * trail of empty parameters.
   */
  it("writes nothing at all for the default filters", () => {
    expect(Object.values(paramsFromFilters(NO_FILTERS)).every((v) => v === null)).toBe(true);
  });

  /**
   * A hash is a thing people bookmark and send each other, and one written by a
   * later build must degrade to showing MORE than was meant — never to an empty
   * feed the reader cannot explain.
   */
  it("drops a speaker this build does not know rather than filtering by it", () => {
    expect(filtersFromParams({ mw: "human,a-speaker-from-the-future" }).speakers).toEqual(["human"]);
  });

  it("falls back to the default size rather than honouring a nonsense one", () => {
    expect(limitFromParams({ mn: "9999" })).toBe(50);
    expect(limitFromParams({ mn: "banana" })).toBe(50);
    expect(limitFromParams({})).toBe(50);
    expect(limitFromParams({ mn: "100" })).toBe(100);
  });
});

describe("a filter survives being set", () => {
  /**
   * **THE BUG THE PURE-CONVERTER TESTS COULD NOT SEE.**
   *
   * `paramsFromFilters` and `filtersFromParams` were both correct, and both
   * tested. The fault was in the composition: `App` wrote the four filter keys
   * with four `setParam` calls, and `setParam` closes over the params it was
   * built with — so each call started from the same stale snapshot and only the
   * last survived. In practice "Hide tool calls" persisted, because it was
   * last, and session, speaker and text silently reverted.
   *
   * GPT Sol's P1 on the code review, and its point about the tests was the
   * sharper half: *"The URL round-trip test exercises only the pure converters,
   * not this composition."* This test drives the real control through the real
   * page and reads the real hash.
   *
   * Goes red if `setParams` stops being atomic — verified by mutating it to
   * write only its last key, which is precisely the original bug.
   */
  it("keeps a session filter in the URL, not just the last key written", async () => {
    const feed: FeedView = {
      kind: "feed",
      limit: 50,
      messages: [
        {
          sessionId: "$1643",
          sessionName: "alpha",
          sessionTitle: null,
          attribution: { kind: "claimed-only", why: "w" },
          turn: { speaker: "assistant", at: "t", text: "hello", truncated: false, fullChars: 5, toolCalls: [], uuid: "a" },
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
      tmuxServerPid: 132280,
    };
    window.location.hash = "#messages";
    await act(async () => {
      root.render(
        <App transport={() => ({ refresh: () => {}, stop: () => {} })} feedApi={apiOf(feed)} actionsPollMs={0} />,
      );
    });

    const chip = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Show only alpha");
    expect(chip, "the session chip should be offered").toBeDefined();
    await act(async () => chip?.click());

    /* The session key must actually be in the URL. Under the old four-call
       version it was written and then overwritten before the render settled. */
    expect(decodeURIComponent(window.location.hash)).toContain("ms=$1643");
    window.location.hash = "";
  });

  /** And the whole set survives when several are written at once. */
  it("writes every filter key in one go", async () => {
    window.location.hash = "#messages";
    const filters = {
      sessions: ["$1643"],
      speakers: ["human"] as MessageSpeaker[],
      text: "deploy",
      hideToolCalls: true,
    };
    /* Straight through the hook's own composition, which is what App uses. */
    const params = paramsFromFilters(filters);
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null) search.set(k, v);
    window.location.hash = `#messages?${search.toString()}`;
    const roundTripped = filtersFromParams(Object.fromEntries(search));
    expect(roundTripped).toEqual(filters);
    window.location.hash = "";
  });
});

describe("the tab is actually registered", () => {
  /**
   * **THE ONE REGISTRATION THE COMPILER DOES NOT CHECK.** `MODES`,
   * `MODE_LABELS`, `MODE_ICONS` and `MODE_TIPS` are all `Record<Mode, …>`, so a
   * half-added mode is a compile error. The mount in `App.tsx` is a
   * `mode === "x" ? … : null` ternary rather than an exhaustive switch, so a
   * mode registered in all four maps and not there draws a button, switches the
   * hash, and shows an empty page — compiling perfectly.
   *
   * Found by session `dashboard-modes-doc` while documenting how to add a tab;
   * this is the test that would notice.
   */
  it("is in the mode list, with a label", () => {
    expect(MODES).toContain("messages");
    expect(MODE_LABELS.messages).toBe("Recent messages");
  });

  it("draws its panel when the hash names it, rather than an empty page", async () => {
    const feed: FeedView = {
      kind: "feed",
      limit: 50,
      messages: [
        {
          sessionId: "$1",
          sessionName: "alpha",
          sessionTitle: null,
          attribution: { kind: "claimed-only", why: "w" },
          turn: { speaker: "assistant", at: "t", text: "a message from the fleet", truncated: false, fullChars: 24, toolCalls: [], uuid: "a" },
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
      tmuxServerPid: 132280,
    };
    window.location.hash = "#messages";
    await act(async () => {
      root.render(
        <App
          /* A transport that never delivers anything: this test is about the
             mode arm, and the session list is irrelevant to it. */
          transport={() => ({ refresh: () => {}, stop: () => {} })}
          feedApi={apiOf(feed)}
          actionsPollMs={0}
        />,
      );
    });
    expect(host.textContent ?? "").toContain("a message from the fleet");
    window.location.hash = "";
  });
});

/**
 * **THE ROW HAS TO LEAD SOMEWHERE.**
 *
 * > can we make "Recent messages" much more clickable (e.g. click to be taken
 * > to that session in Sessions)
 * >
 * > — Greg, 2026-09-09
 *
 * The hazard is not *does a button exist*. It is that this navigation writes a
 * MODE and a PARAMETER in one go, and mode.ts already carries the scar of doing
 * that in two calls: `chooseMode` and `setParam` each close over the same
 * captured snapshot, so the second silently discards the first. A version built
 * from those two would either switch the tab and land on an unselected list, or
 * select a session and stay on the feed. Neither looks broken; both are.
 *
 * So these drive the real page and read the real hash, which is the only place
 * that composition is visible.
 */
describe("clicking through to the session", () => {
  function feedOf(sessionId: string, sessionName: string): FeedView {
    return {
      kind: "feed",
      limit: 50,
      messages: [
        {
          sessionId,
          sessionName,
          sessionTitle: null,
          attribution: { kind: "claimed-only", why: "w" },
          turn: {
            speaker: "assistant",
            at: "2026-09-09T00:58:00.000Z",
            text: "merging dev before the push",
            truncated: false,
            fullChars: 27,
            toolCalls: [],
            uuid: "a",
          },
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
      tmuxServerPid: 132280,
    };
  }

  async function mountFeed(hash: string, view: FeedView): Promise<void> {
    window.location.hash = hash;
    await act(async () => {
      root.render(
        <App transport={() => ({ refresh: () => {}, stop: () => {} })} feedApi={apiOf(view)} actionsPollMs={0} />,
      );
    });
  }

  /**
   * A transport a test pushes one payload into, and the payload itself — built
   * through `parseFleetState`, which is the page's own parser, so a fixture this
   * build could not read fails as itself.
   *
   * **These exist because a hash assertion is not the feature.** The tests above
   * prove the URL changes; only a page holding real fleet state can show that
   * the URL change actually opens the session. GPT Sol's P2 on the plan, and it
   * is the composition-root rule: an injected fake cannot tell you whether the
   * real things are wired to each other.
   */
  function stateWith(row: FleetRow, tmuxServerPid = 132280): FleetState {
    const read = parseFleetState(
      {
        schema: 1,
        rows: [row],
        collectedAt: "2026-09-09T00:59:30.000Z",
        tmuxServerPid,
        servedAt: "2026-09-09T01:00:00.000Z",
      },
      Date.parse("2026-09-09T01:00:00.000Z"),
    );
    if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
    return read.state;
  }

  function pushableTransport(): { transport: Transport; push: (next: FleetState) => void } {
    let sink: TransportSink | null = null;
    return {
      transport: (s) => {
        sink = s;
        return { refresh: () => {}, stop: () => { sink = null; } };
      },
      push: (next) => sink?.onState(next),
    };
  }

  /**
   * **IT THROWS RATHER THAN RETURNING `undefined`**, and that is not fussiness.
   * Written as an optional find, `opener("alpha")?.click()` on a missing button
   * is a no-op — so a test that asserts "the hash still holds the filters"
   * would PASS on a page with no button at all, having navigated nowhere. Two
   * of the four tests below did exactly that on the first red run.
   */
  function opener(name: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === `Open the session ${name} in Sessions`,
    );
    if (found === undefined) throw new Error(`no way in to the session ${name} was drawn on the feed`);
    return found;
  }

  /**
   * The way in on a row whose tmux server this page could not check.
   *
   * **A DIFFERENT ACCESSIBLE NAME, because it does a different thing** — it
   * reaches the Sessions tab without selecting anything. A screen reader that
   * announced both as "Open the session alpha" would be describing an action one
   * of them does not perform, so the tests have to know the difference too.
   */
  function weakOpener(name: string): HTMLButtonElement {
    const found = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === `Show Sessions — ${name} cannot be selected from here`,
    );
    if (found === undefined) throw new Error(`no unverified way in to ${name} was drawn on the feed`);
    return found;
  }

  /**
   * **BOTH HALVES OF THE HASH, IN ONE ASSERTION.** A `chooseMode`-then-`setParam`
   * implementation passes the mode half and fails the `sel` half, which is
   * exactly the bug this is written to catch.
   */
  it("switches to Sessions AND selects the session, in one write", async () => {
    await mountFeed("#messages", feedOf("$1643", "alpha"));
    const button = opener("alpha");
    await act(async () => button.click());

    const hash = decodeURIComponent(window.location.hash);
    expect(hash.startsWith("#sessions")).toBe(true);
    expect(hash).toContain("sel=$1643");
    window.location.hash = "";
  });

  /**
   * **THE FILTERS RIDE ALONG, so that Back is worth pressing.** They are what
   * makes the return trip useful, and dropping them is the quiet way to turn a
   * click-through into a one-way door.
   */
  it("carries the feed's filters through the trip", async () => {
    await mountFeed("#messages?mq=merging&mt=1&mn=100", feedOf("$1643", "alpha"));
    await act(async () => opener("alpha").click());

    const hash = decodeURIComponent(window.location.hash);
    expect(hash).toContain("mq=merging");
    expect(hash).toContain("mt=1");
    expect(hash).toContain("mn=100");
    window.location.hash = "";
  });

  /**
   * **AND BACK IS THE BROWSER'S OWN BUTTON, not a control we drew.** That is
   * only true if the navigation is a PUSH; a `location.replace` would look
   * identical on screen and silently swallow the return trip. jsdom traverses
   * history in a queued task, hence the flush.
   */
  it("returns to the feed, filters intact, when the browser goes back", async () => {
    await mountFeed("#messages?mq=merging&mt=1", feedOf("$1643", "alpha"));
    await act(async () => opener("alpha").click());
    expect(decodeURIComponent(window.location.hash)).toContain("sel=$1643");

    await act(async () => {
      window.history.back();
      /* jsdom queues the traversal as a task of its own, so a zero-delay flush
         can be scheduled AHEAD of it and observe nothing having happened. */
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const hash = decodeURIComponent(window.location.hash);
    expect(hash.startsWith("#messages"), `expected to be back on the feed, got ${hash}`).toBe(true);
    expect(hash).toContain("mq=merging");
    expect(hash).toContain("mt=1");
    window.location.hash = "";
  });

  /**
   * **THE ROW'S OTHER CONTROLS STILL WORK**, which is why the button is the
   * session name rather than the whole row. A row-sized click target swallows
   * "Show the rest of this message" and any attempt to select the agent's own
   * text.
   */
  it("leaves the expand control working", async () => {
    const view = feedOf("$1643", "alpha");
    if (view.kind === "feed") {
      const first = view.messages[0];
      if (first !== undefined) first.turn.text = "first line\nsecond line";
    }
    await mountFeed("#messages", view);
    const expand = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Show the rest of this message",
    );
    expect(expand, "the expand control should still be there").toBeDefined();
    await act(async () => expand?.click());
    expect(host.textContent ?? "").toContain("second line");
    expect(window.location.hash).toBe("#messages");
    window.location.hash = "";
  });

  /**
   * **AND THE SESSION ACTUALLY OPENS — the assertion the hash tests cannot
   * make.** Everything above proves the URL changed; a page that wrote a
   * perfect `#sessions?sel=$1643` and then drew a list with nothing selected
   * would pass every one of them. This one holds real fleet state, so the whole
   * chain has to work: the hash, `SessionsPanel`'s `selectedId`, and the detail.
   *
   * **Focus goes with it.** The button that was activated is on a tab that has
   * just been swapped out, so leaving focus on it strands a keyboard or
   * screen-reader user somewhere that no longer exists. GPT Sol's P1.
   */
  it("opens that session's detail, and moves focus to it", async () => {
    const { transport, push } = pushableTransport();
    window.location.hash = "#messages";
    await act(async () => {
      root.render(<App transport={transport} feedApi={apiOf(feedOf("$1643", "alpha"))} actionsPollMs={0} />);
    });
    await act(async () => push(stateWith(sessionRow("$1643", "alpha"))));
    await act(async () => opener("alpha").click());

    const detail = host.querySelector('[aria-label="The selected session"]');
    expect(detail, "the detail pane should be on screen after the click").not.toBeNull();
    expect(detail?.textContent ?? "").toContain("$1643");
    /* **THE REAL PANE, NOT THE APOLOGY FOR ITS ABSENCE.** `MissingSession`
       renders inside the same wrapper and repeats the same handle, so the two
       assertions above pass on an implementation that always drew it — GPT
       Sol's P2. `Rename` is a control only the live detail has. */
    expect(detail?.textContent ?? "").toContain("Rename");
    expect(detail?.textContent ?? "").not.toContain("not in the latest snapshot");
    expect(document.activeElement, "focus should follow the reader to the detail").toBe(detail);
    window.location.hash = "";
  });

  /**
   * **THE PID HAS TO SURVIVE THE NAVIGATION, or the check on the row was
   * theatre.**
   *
   * `sessionStatusOf` proves the handle and the session list name one tmux
   * server — and then the click used to hand over the handle alone, leaving the
   * destination to match `$1643` against whatever world it was looking at by the
   * time it rendered. The pane it opened would print a handle that agreed with
   * the one clicked, so nothing on screen would contradict it. GPT Sol's P0 on
   * the code review, and it is his suggested test: click in world A, serve world
   * B holding the same handle, and prove B's detail is never drawn.
   */
  it("does not open a same-handle session belonging to another tmux server", async () => {
    const { transport, push } = pushableTransport();
    window.location.hash = "#messages";
    await act(async () => {
      root.render(<App transport={transport} feedApi={apiOf(feedOf("$1643", "alpha"))} actionsPollMs={0} />);
    });
    /* World A: the feed's fixture says tmux server 132280, and so does this. */
    await act(async () => push(stateWith(sessionRow("$1643", "alpha"), 132280)));
    await act(async () => opener("alpha").click());
    expect(host.querySelector('[aria-label="The selected session"]')?.textContent ?? "").toContain("Rename");

    /* World B arrives on the next poll: the tmux server has restarted, and
       `$1643` is now somebody else's — with the same handle, and a name that
       looks just as plausible. */
    await act(async () => push(stateWith(sessionRow("$1643", "a-stranger"), 999_999)));

    const after = host.textContent ?? "";
    expect(after, "the wrong session's detail must not be drawn").not.toContain("Rename");
    expect(after).toContain("That link is for a different tmux server");
    window.location.hash = "";
  });

  /**
   * **A FEED THAT NAMED NO TMUX SERVER SELECTS NOTHING**, rather than selecting
   * on trust. The reader still gets to the Sessions tab — the link is not taken
   * away, because a server predating the field answers this way for every row —
   * but the handle it could not vouch for is not acted on.
   */
  it("takes an unverifiable row to the session list without selecting anything", async () => {
    const view = { ...feedOf("$1643", "alpha"), tmuxServerPid: null } as FeedView;
    await mountFeed("#messages", view);
    await act(async () => weakOpener("alpha").click());

    const hash = decodeURIComponent(window.location.hash);
    expect(hash.startsWith("#sessions")).toBe(true);
    expect(hash).not.toContain("sel=");
    window.location.hash = "";
  });
});

/**
 * **A ROW YOU CAN READ WITHOUT OPENING ANYTHING.**
 *
 * > can we make "Recent messages" … much more … scannable (e.g. to see at a
 * > glance the status and human-readable timing of each)
 * >
 * > — Greg, 2026-09-09
 *
 * Two claims per row, and both of them are the kind this page gets wrong by
 * being helpful: a status that is a SECOND reading of what the Sessions tab
 * already says, and an absence drawn as a calm state. So the status comes from
 * the live session list by id and nothing else, and the two ways of having no
 * status are two different sentences.
 */
describe("what a row says at a glance", () => {
  const AT = "2026-09-09T00:58:00.000Z";
  const NOW_MS = Date.parse("2026-09-09T01:00:00.000Z");

  function rowOf(sessionId: string, over: Partial<FeedRow["turn"]> = {}): FeedRow {
    return {
      sessionId,
      sessionName: "alpha",
      sessionTitle: null,
      attribution: { kind: "claimed-only", why: "w" },
      turn: {
        speaker: "assistant",
        at: AT,
        text: "merging dev before the push",
        truncated: false,
        fullChars: 27,
        toolCalls: [],
        uuid: "a",
        ...over,
      },
    };
  }

  function viewOf(rows: FeedRow[]): FeedView {
    return {
      kind: "feed",
      limit: 50,
      messages: rows,
      undated: [],
      sessions: [],
      sessionsOffered: true,
      unreadableRows: 0,
      coverage: { kind: "complete" },
      collectedAt: null,
      readStartedAt: null,
      readFinishedAt: null,
      servedAt: null,
      tmuxServerPid: 132280,
    };
  }

  /** The shared row fixture, under the name every message in this block carries. */
  const session = (id: string, status: FleetRow["status"]): FleetRow => sessionRow(id, "alpha", status);

  /** A collected list, from the rows a test cares about. `PID` is the box's world. */
  const PID = 132280;
  function collected(rows: FleetRow[], over: Partial<Extract<SessionListReading, { kind: "collected" }>> = {}) {
    return { kind: "collected" as const, rows, unreadableRows: 0, tmuxServerPid: PID, ...over };
  }

  /* --- the status join, as a pure decision --- */

  /**
   * **FIVE ARMS, BECAUSE THERE ARE FIVE DIFFERENT THINGS TO SAY.** The plan had
   * three and GPT Sol was right that they are neither complete nor safe: a
   * payload can arrive before any census has finished, and a payload's handles
   * can belong to a tmux server that no longer exists.
   */
  it("says nothing at all before a payload has arrived", () => {
    expect(sessionStatusOf({ kind: "not-arrived" }, PID, "$1643")).toEqual({ kind: "not-arrived" });
  });

  /**
   * **A PAYLOAD WITH NO FINISHED CENSUS LISTS NOBODY, and reading "absent" off
   * that would call every session on the box gone.** The server answers exactly
   * this for the ten seconds a first collection takes.
   */
  it("does not read an unfinished census as a session that is gone", () => {
    expect(sessionStatusOf({ kind: "not-collected" }, PID, "$1643")).toEqual({ kind: "not-collected" });
  });

  /**
   * **THE HANDLES MUST BELONG TO ONE WORLD BEFORE THEY MAY BE COMPARED.**
   *
   * `$1643` means nothing outside one tmux server, so a feed read before a tmux
   * restart holds handles that now name different sessions. The lookup would
   * succeed, and it would find somebody else. GPT Sol's P0.
   */
  it("refuses the join when the two answers came from different tmux servers", () => {
    const row = session("$1643", { kind: "working" });
    const across = sessionStatusOf(collected([row]), 999_999, "$1643");
    expect(across.kind).toBe("different-world");
    /* And it does NOT quietly hand back the row it found. */
    expect(across).not.toMatchObject({ kind: "listed" });
  });

  /**
   * **NOT KNOWING IS A DIFFERENT ARM FROM KNOWING OTHERWISE**, and the split is
   * load-bearing rather than pedantic: a server that predates `tmuxServerPid`
   * answers this way for **every** row, so collapsing the two would switch the
   * whole feature off against it on no evidence at all — the "warning that never
   * clears" this tab's doc already names as its characteristic failure. Found by
   * a browser check, when a fixture server that had not been given the new field
   * turned every row on the page into a refusal.
   */
  it("says it could not check, rather than that it disagrees, when either side was silent", () => {
    const row = session("$1643", { kind: "working" });
    expect(sessionStatusOf(collected([row]), null, "$1643").kind).toBe("unverifiable");
    expect(sessionStatusOf(collected([row], { tmuxServerPid: null }), PID, "$1643").kind).toBe("unverifiable");
  });

  /** And an unverified row keeps its way in, where a contradicted one loses it. */
  it("keeps the way in when the check could not be made, and removes it when it failed", async () => {
    const unverified = { ...viewOf([rowOf("$1643")]), tmuxServerPid: null } as FeedView;
    await draw(
      panel(unverified, {
        sessions: collected([session("$1643", { kind: "working" })]),
        now: NOW_MS,
        onOpenSession: () => {},
      }),
    );
    /* **A WAY IN, BUT NOT THE SAME ONE.** It reaches the Sessions tab without
       selecting a handle this page could not vouch for, and its accessible name
       says so — a screen reader announcing "open the session alpha" would be
       describing something this control deliberately does not do. */
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.getAttribute("aria-label") === "Show Sessions — alpha cannot be selected from here",
      ),
      "an unverified row must still be a way in",
    ).toBe(true);
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.getAttribute("aria-label") === "Open the session alpha in Sessions",
      ),
      "but it must not claim it opens the session",
    ).toBe(false);
    expect(host.textContent ?? "").toContain("status not checked");
  });

  /**
   * **AN ABSENCE FROM A PAYLOAD IS NOT AN ABSENCE FROM THE BOX, and the
   * difference is whether that payload was wholly readable.** A page that
   * dropped rows it could not parse is in no position to say a session is gone
   * — it can only say the session is not in the part it could read.
   */
  it("distinguishes a session that is absent from one that may only be unreadable", () => {
    expect(sessionStatusOf(collected([]), PID, "$1643")).toEqual({ kind: "not-listed", unreadableRows: 0 });
    expect(sessionStatusOf(collected([], { unreadableRows: 3 }), PID, "$1643")).toEqual({
      kind: "not-listed",
      unreadableRows: 3,
    });
  });

  it("hands back the live row when the session is listed", () => {
    const row = session("$1643", { kind: "working" });
    expect(sessionStatusOf(collected([row]), PID, "$1643")).toEqual({ kind: "listed", row });
  });

  /* --- the clock --- */

  /**
   * **THE AGE IS SHIFTED; THE INSTANT IS NOT.** Both come off one `at`, and
   * getting the split backwards is GPT Sol's K4 in messages-client.ts: a shifted
   * wall-clock string asserts an instant nothing happened at, and an unshifted
   * age is measured against the wrong clock.
   *
   * A device two minutes behind the box's clock: a turn written at 00:58 on the
   * box lands at 00:56 in this browser's terms, so against a browser `now` of
   * 01:00 it is 4 minutes old rather than 2.
   */
  it("shifts the age onto this browser's clock", () => {
    const known = { kind: "known", ms: 120_000 } as const;
    expect(turnAge(AT, NOW_MS, known)).toEqual({ kind: "aged", ms: 4 * 60_000 });
    expect(turnAge(AT, NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "aged", ms: 2 * 60_000 });
  });

  it("refuses to place a turn with no timestamp, or one it cannot parse", () => {
    expect(turnAge(null, NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "unplaceable" });
    expect(turnAge("not a time", NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "unplaceable" });
  });

  /**
   * **A TURN STAMPED IN THE FUTURE IS ITS OWN ANSWER, not a zero.** These are
   * two clocks, so a real minute of disagreement is a fact — and "0s ago" would
   * bury it under the most reassuring words available. Noise inside the page's
   * own noticing threshold still rounds to now, because the skew this corrects
   * by is itself understated by one-way latency.
   */
  it("says when a turn is stamped ahead of this device's clock, and shrugs off noise", () => {
    const inTenMinutes = new Date(NOW_MS + 10 * 60_000).toISOString();
    expect(turnAge(inTenMinutes, NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "ahead", ms: 10 * 60_000 });
    const inThreeSeconds = new Date(NOW_MS + 3_000).toISOString();
    expect(turnAge(inThreeSeconds, NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "aged", ms: 0 });
  });

  /* --- and what all of that looks like on the row --- */

  it("draws the live status word, in the Sessions list's own vocabulary", async () => {
    const text = await draw(
      panel(viewOf([rowOf("$1643")]), {
        sessions: collected([session("$1643", { kind: "working" })]),
        now: NOW_MS,
      }),
    );
    expect(text).toContain("working");
  });

  /**
   * **FOUR SILENCES, AND NONE OF THEM READS AS A QUIET SESSION.** The word this
   * checks for the absence of is `idle`, because that is the specific wrong
   * answer: it is the calm end of the vocabulary and it is what a reader would
   * take from a row that said nothing.
   */
  it("says which kind of not-knowing it is", async () => {
    const notArrived = await draw(panel(viewOf([rowOf("$1643")]), { sessions: { kind: "not-arrived" }, now: NOW_MS }));
    expect(notArrived).toContain("session list has not arrived");
    expect(notArrived).not.toContain("idle");

    const notCollected = await draw(
      panel(viewOf([rowOf("$1643")]), { sessions: { kind: "not-collected" }, now: NOW_MS }),
    );
    expect(notCollected).toContain("no session census yet");
    expect(notCollected).not.toContain("idle");

    const notListed = await draw(panel(viewOf([rowOf("$1643")]), { sessions: collected([]), now: NOW_MS }));
    expect(notListed).toContain("not in the current session list");
    expect(notListed).not.toContain("idle");

    const partial = await draw(
      panel(viewOf([rowOf("$1643")]), { sessions: collected([], { unreadableRows: 2 }), now: NOW_MS }),
    );
    expect(partial).toContain("not in the readable session list");
  });

  /**
   * **AND AN UNJOINABLE ROW LOSES ITS WAY IN.** `sel` addresses a session by the
   * same handle the join could not place, so a click would open whatever now
   * wears it — confidently, and wrongly.
   */
  it("withholds the way in when the handles are provably a different world", async () => {
    const view = { ...viewOf([rowOf("$1643")]), tmuxServerPid: 999_999 } as FeedView;
    await draw(
      panel(view, {
        sessions: collected([session("$1643", { kind: "working" })]),
        now: NOW_MS,
        onOpenSession: () => {},
      }),
    );
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Open the session alpha in Sessions",
    );
    expect(button, "an unplaceable row must not offer a way in").toBeUndefined();
    expect(host.textContent ?? "").toContain("cannot be matched to a session");
  });

  /**
   * A human age on the row, and the exact instant kept for whoever wants it.
   * The ISO string was what the row carried before, and it is a thing you parse
   * rather than a thing you scan.
   */
  it("prints an age rather than an ISO timestamp", async () => {
    const text = await draw(
      panel(viewOf([rowOf("$1643")]), {
        sessions: collected([session("$1643", { kind: "idle" })]),
        now: NOW_MS,
        skew: { kind: "known", ms: 0 },
      }),
    );
    expect(text).toContain("2m ago");
    /* The absolute instant is still REACHABLE — `Explain` carries it in the
       accessible name and the tooltip — but it is no longer VISIBLE, and those
       are two different claims. Asserting the second against `host.textContent`
       would be reading back the tooltip this very test put on screen. */
    expect(text, "the instant is still reachable").toContain("2026-09-09");
    expect(visibleText(), "but it is not what the eye lands on").not.toContain("2026-09-09");
    expect(visibleText()).toContain("2m ago");
  });

  /**
   * **AN AGE ACROSS TWO CLOCKS THAT WERE NEVER COMPARED IS NOT A MEASUREMENT.**
   *
   * This tab has its own route and can be on screen before any state payload —
   * and the masthead prints its clock note only once one has arrived
   * (Header.tsx), so nothing else on the page would qualify this number. The
   * hedge is one word and it is the difference between a reading and a guess.
   * GPT Sol's P0.
   */
  it("labels the age while the clocks have not been compared", async () => {
    await draw(panel(viewOf([rowOf("$1643")]), { sessions: { kind: "not-arrived" }, now: NOW_MS }));
    expect(visibleText()).toContain("2m ago");
    expect(visibleText()).toContain("clocks not compared");

    await draw(
      panel(viewOf([rowOf("$1643")]), {
        sessions: collected([session("$1643", { kind: "idle" })]),
        now: NOW_MS,
        skew: { kind: "known", ms: 0 },
      }),
    );
    expect(visibleText()).toContain("2m ago");
    expect(visibleText()).not.toContain("clocks not compared");
  });

  /**
   * **THE TOLERANCE IS SMALL, AND ITS BOUNDARY IS TESTED FROM BOTH SIDES.**
   *
   * It was `CLOCK_SKEW_NOTICE_MS` — a minute — which made a turn 59 seconds in
   * the future read "0s ago" on a row whose own formatter prints seconds under
   * five minutes. GPT Sol's P1. The number this wants is the latency in the
   * measurement, not the threshold at which a masthead mentions a clock.
   */
  it("clamps only the noise, at a boundary worth naming", () => {
    const ahead = (ms: number): string =>
      new Date(NOW_MS + ms).toISOString();
    expect(turnAge(ahead(TURN_AHEAD_TOLERANCE_MS - 1), NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({
      kind: "aged",
      ms: 0,
    });
    expect(turnAge(ahead(TURN_AHEAD_TOLERANCE_MS), NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "aged", ms: 0 });
    expect(turnAge(ahead(TURN_AHEAD_TOLERANCE_MS + 1), NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({
      kind: "ahead",
      ms: TURN_AHEAD_TOLERANCE_MS + 1,
    });
    /* And it is small enough that a minute in the future is still a finding. */
    expect(turnAge(ahead(60_000), NOW_MS, CLOCK_SKEW_UNMEASURED).kind).toBe("ahead");
  });

  /**
   * **`Date.parse` IS NOT A VALIDATOR.** `Date.parse("0")` is January 2000, so a
   * junk timestamp would be drawn as a confident age twenty-six years old rather
   * than as the unreadable thing it is. types.ts documents the same trap for
   * `servedAt`; GPT Sol's P2 pointed out this client had not borrowed it.
   */
  it("refuses a timestamp that is not canonical ISO, however willingly Date.parse takes it", () => {
    expect(Number.isNaN(Date.parse("0")), "Date.parse really does accept this").toBe(false);
    expect(turnAge("0", NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "unplaceable" });
    expect(turnAge("2026-09-09", NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "unplaceable" });
    expect(turnAge("2026-09-09T00:58:00Z", NOW_MS, CLOCK_SKEW_UNMEASURED)).toEqual({ kind: "unplaceable" });
    /* What the transcripts actually carry, which is `toISOString()` output. */
    expect(turnAge(AT, NOW_MS, CLOCK_SKEW_UNMEASURED).kind).toBe("aged");
  });
});
