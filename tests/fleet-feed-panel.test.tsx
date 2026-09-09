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
  type FeedApi,
  type FeedRow,
  type FeedView,
} from "../tools/fleet/web/src/feed-client";
import type { MessageSpeaker } from "../tools/fleet/web/src/messages-client";
import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";

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

function panel(view: FeedView, over: Partial<Parameters<typeof FeedPanel>[0]> = {}): React.ReactElement {
  return (
    <FeedPanel
      api={apiOf(view)}
      limit={50}
      onLimit={() => {}}
      filters={NO_FILTERS}
      onFilters={() => {}}
      {...over}
    />
  );
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

  /** An empty census and no census at all are opposite claims. */
  it("distinguishes an empty session list from a server that sent none", () => {
    const withList = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], sessions: [], coverage: { kind: "complete" } });
    const without = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], coverage: { kind: "complete" } });
    expect(withList.kind === "feed" ? withList.sessionsOffered : null).toBe(true);
    expect(without.kind === "feed" ? without.sessionsOffered : null).toBe(false);
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
    });

    await act(async () => {
      root.render(<FeedPanel api={api} limit={50} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} />);
    });
    /* A second read started before the first has answered — through the SIZE
       control rather than the refresh button, because the button disables
       itself while a read is in flight and so cannot produce this race. The
       size control can: changing it restarts the read with a new limit, and
       nothing stops the reader doing that twice in a second. */
    await act(async () => {
      root.render(<FeedPanel api={api} limit={100} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} />);
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
