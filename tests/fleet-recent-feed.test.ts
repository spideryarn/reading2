/**
 * `GET /api/feed` — tools/fleet/routes-recent-feed.ts.
 *
 * The reader itself is tested in tests/fleet-transcript.test.ts and is not
 * re-tested here. What is here is the three things this module actually decides:
 * **the ordering** (newest first, the opposite of the sibling route), **the
 * completeness accounting** (which is the whole defence against a truncated
 * session reading as a quiet one), and **the arms it must never merge**.
 *
 * Every test below was checked to go red by mutating the line it covers —
 * docs/reusable/silent-success.md, and the notes on the individual tests say
 * which mutation.
 */
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import {
  DEFAULT_FEED_LIMIT,
  GUARD_TURNS,
  MAX_FEED_LIMIT,
  STALE_TRANSCRIPT_MS,
  attributionOf,
  contributedTurns,
  feedPayload,
  limitFrom,
  mergeFeed,
  recentFeedRoute,
  type FeedInput,
} from "../tools/fleet/routes-recent-feed.js";
import type { RecentMessages, TranscriptTurn } from "../tools/fleet/transcript.js";
import type { FeedCoverage } from "../tools/fleet/wire.js";

const NOW = Date.parse("2026-09-09T01:00:00.000Z");

/** A turn, with only the fields a test cares about spelled out. */
function turn(at: string | null, text: string, over: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    speaker: "assistant",
    at,
    text,
    truncated: false,
    fullChars: text.length,
    toolCalls: [],
    uuid: `u-${at ?? "none"}-${text}`,
    ...over,
  };
}

/**
 * A `found` answer. `reachedStartOfFile` defaults TRUE — the ordinary case for
 * a short transcript — so a test that cares about incompleteness has to say so,
 * rather than getting it by accident from a sloppy default.
 */
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

/** The names a coverage answer blames for a byte-budget gap. */
function missingNames(coverage: FeedCoverage): string[] {
  return coverage.kind === "complete"
    ? []
    : coverage.reasons.filter((r) => r.kind === "byte-budget").map((r) => r.name);
}

/** Every reason kind an answer carries, for asserting on the shape of a gap. */
function reasonKinds(coverage: FeedCoverage): string[] {
  return coverage.kind === "complete" ? [] : [...new Set(coverage.reasons.map((r) => r.kind))].sort();
}

function input(sessionId: string, name: string, result: RecentMessages, working = false): FeedInput {
  /* `claudeSessionId` derived from the handle so two fixtures never accidentally
     collide and trip the duplicate-conversation check. A test that means to
     collide says so by passing the same one explicitly. */
  return { sessionId, name, title: null, working, claudeSessionId: `conv-${sessionId}`, declaredNonClaude: false, result };
}

describe("limitFrom", () => {
  it("defaults when there is no limit parameter", () => {
    expect(limitFrom("/api/feed")).toBe(DEFAULT_FEED_LIMIT);
  });

  it("defaults rather than erroring on nonsense, because this is a feed", () => {
    expect(limitFrom("/api/feed?limit=banana")).toBe(DEFAULT_FEED_LIMIT);
    expect(limitFrom("/api/feed?limit=-3")).toBe(DEFAULT_FEED_LIMIT);
    expect(limitFrom("/api/feed?limit=0")).toBe(DEFAULT_FEED_LIMIT);
  });

  it("clamps rather than reading the whole box off disk", () => {
    expect(limitFrom("/api/feed?limit=100000")).toBe(MAX_FEED_LIMIT);
  });

  it("takes a smaller limit as asked, as an integer", () => {
    expect(limitFrom("/api/feed?limit=10")).toBe(10);
    expect(limitFrom("/api/feed?limit=10.7")).toBe(10);
  });
});

describe("the ordering", () => {
  /**
   * **THE INVERSION.** `/api/messages` returns turns newest LAST and this route
   * returns them newest FIRST, so a reader arriving from messages-client.ts
   * will assume the wrong one. Doing it server-side means it has one home; this
   * is that home's test.
   *
   * Goes red if the sort comparator is flipped.
   */
  it("interleaves sessions newest first, across the whole fleet", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", found([turn("2026-09-09T00:00:00.000Z", "a-old"), turn("2026-09-09T00:30:00.000Z", "a-new")])),
        input("$2", "beta", found([turn("2026-09-09T00:15:00.000Z", "b-mid"), turn("2026-09-09T00:45:00.000Z", "b-new")])),
      ],
      10,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["b-new", "a-new", "b-mid", "a-old"]);
  });

  /**
   * Two messages written in the same millisecond must not swap places between
   * refreshes — a list that reshuffles under a thumb on a phone is worse than
   * one that is slightly arbitrary, as long as it is arbitrary the same way
   * every time. Goes red if the `order` tie-break is dropped and the sort
   * becomes unstable across engines.
   */
  it("breaks ties deterministically rather than reshuffling under the reader", () => {
    const same = "2026-09-09T00:20:00.000Z";
    const build = (): FeedInput[] => [
      input("$1", "alpha", found([turn(same, "a")])),
      input("$2", "beta", found([turn(same, "b")])),
      input("$3", "gamma", found([turn(same, "c")])),
    ];
    const first = mergeFeed(build(), 10, NOW).messages.map((m) => m.text);
    const again = mergeFeed(build(), 10, NOW).messages.map((m) => m.text);
    expect(again).toEqual(first);
    expect(first).toEqual(["a", "b", "c"]);
  });
});

describe("the exact merge", () => {
  /**
   * **THE PROPERTY THE PER-SESSION LIMIT BUYS.** One agent that has written all
   * of the last N messages must fill the feed with all N of them — not with six
   * of its own and the rest padded from quieter sessions, which is what asking
   * each session for a small fixed k produces, and which looks entirely normal
   * on screen.
   *
   * Goes red if the fan-out asks for a fixed k instead of `limit`, and this is
   * the test that would have caught that design.
   */
  it("lets one chatty session fill the whole window", () => {
    const chatty = Array.from({ length: 8 }, (_, i) =>
      turn(new Date(Date.parse("2026-09-09T00:40:00.000Z") + i * 1000).toISOString(), `chat-${i}`),
    );
    const merged = mergeFeed(
      [
        input("$1", "chatty", found(chatty)),
        input("$2", "quiet", found([turn("2026-09-08T20:00:00.000Z", "ancient")])),
      ],
      8,
      NOW,
    );
    expect(merged.messages).toHaveLength(8);
    expect(merged.messages.every((m) => m.sessionName === "chatty")).toBe(true);
    expect(merged.messages.map((m) => m.text)).not.toContain("ancient");
  });

  it("trims to the limit and keeps the newest", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", found([turn("2026-09-09T00:00:00.000Z", "old"), turn("2026-09-09T00:30:00.000Z", "new")])),
        input("$2", "beta", found([turn("2026-09-09T00:45:00.000Z", "newest")])),
      ],
      2,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["newest", "new"]);
  });
});

describe("completeness — a truncated session must not read as a quiet one", () => {
  /**
   * A session cut short by the byte budget, whose returned messages are all
   * INSIDE the window on screen, may have had more in that window. It is named.
   *
   * Goes red if `complete` stops being computed, or if `mayBeMissing` is
   * hard-coded to `[]` — and an empty `mayBeMissing` is exactly what a
   * plausible-looking simplification of this file would produce.
   */
  it("names a session whose cut-off point is inside the window", () => {
    const merged = mergeFeed(
      [
        /* Asked for 3, got 2, and did not reach the start of the file — so
           there are older turns it never read. Both of the ones it did read are
           NEWER than the feed's cutoff, so those unread ones could have been in
           this window too. */
        input(
          "$1",
          "truncated",
          found([turn("2026-09-09T00:50:00.000Z", "t-old"), turn("2026-09-09T00:52:00.000Z", "t-new")], {
            reachedStartOfFile: false,
          }),
        ),
        input("$2", "beta", found([turn("2026-09-09T00:45:00.000Z", "b1"), turn("2026-09-09T00:46:00.000Z", "b2")])),
      ],
      3,
      NOW,
    );
    expect(merged.sessions.find((s) => s.name === "truncated")?.read).toMatchObject({ kind: "read", complete: false });
    expect(missingNames(merged.coverage)).toEqual(["truncated"]);
  });

  /**
   * **THE OTHER DIRECTION, AND THE REASON THIS IS ARITHMETIC RATHER THAN A
   * FLAG.** A session cut short whose oldest returned message is already older
   * than everything on screen has had every message it could contribute to this
   * window read. Naming it would be noise, and a warning that is usually wrong
   * is one nobody reads.
   *
   * Goes red if `mayBeMissing` becomes "every incomplete session".
   */
  it("names a cut-off session even when everything it returned is ancient", () => {
    /* **THE EXEMPTION THIS TEST USED TO ASSERT IS DELETED.** It used to stay
       quiet when a truncated session's messages all fell below the feed's
       cutoff, on the reasoning that its unread turns must be older still. That
       reasoning assumes the monotonicity the `out-of-order` check exists
       because we cannot assume — and the check can only see turns that came
       back, so a clock rollback below the read boundary is unknowable.
       `complete` has to mean proven. GPT Sol's P1 on the code review. */
    const merged = mergeFeed(
      [
        input("$1", "truncated", found([turn("2026-09-08T20:00:00.000Z", "t-old")], { reachedStartOfFile: false })),
        input(
          "$2",
          "busy",
          found([
            turn("2026-09-09T00:44:00.000Z", "b0"),
            turn("2026-09-09T00:45:00.000Z", "b1"),
            turn("2026-09-09T00:46:00.000Z", "b2"),
          ]),
        ),
      ],
      2,
      NOW,
    );
    expect(missingNames(merged.coverage)).toEqual(["truncated"]);
  });

  /**
   * Nothing was trimmed, so the window reaches back as far as we read, and any
   * incompleteness at all is inside it. Goes red if the `cutoffMs === null`
   * branch is dropped — which is the easy simplification, and it would silence
   * the warning on exactly the quiet fleets where it is cheapest to be right.
   */
  it("names a cut-off session when nothing was trimmed at all", () => {
    const merged = mergeFeed(
      [input("$1", "truncated", found([turn("2026-09-09T00:40:00.000Z", "t")], { reachedStartOfFile: false }))],
      50,
      NOW,
    );
    expect(missingNames(merged.coverage)).toEqual(["truncated"]);
  });

  /** Reaching byte 0 is a positive claim that there is nothing above. */
  it("calls a session complete when the walk reached the start of the file", () => {
    const merged = mergeFeed([input("$1", "short", found([turn("2026-09-09T00:40:00.000Z", "t")]))], 50, NOW);
    expect(merged.sessions[0]?.read).toMatchObject({ complete: true });
    expect(merged.coverage).toEqual({ kind: "complete" });
  });

  /**
   * Getting as many turns as were asked for is the other way to be complete —
   * and with the guard turn that means `limit + 1` came back, so that `limit`
   * survive the discard. See `GUARD_TURNS`.
   */
  it("calls a session complete when it returned everything that was asked for", () => {
    const merged = mergeFeed(
      [
        input(
          "$1",
          "full",
          found(
            [
              turn("2026-09-09T00:39:00.000Z", "guard"),
              turn("2026-09-09T00:40:00.000Z", "a"),
              turn("2026-09-09T00:41:00.000Z", "b"),
            ],
            { reachedStartOfFile: false },
          ),
        ),
      ],
      2,
      NOW,
    );
    expect(merged.sessions[0]?.read).toMatchObject({ complete: true });
    expect(merged.coverage).toEqual({ kind: "complete" });
  });
});

describe("the arms that must never be merged", () => {
  /**
   * Nine of 21 rows on the box are shells and scheduled sessions still running
   * `sleep`. A feed that listed only the sessions it could read would show a
   * fleet of twelve and look complete doing it.
   *
   * Goes red if unreadable rows are filtered out of the census.
   */
  it("carries a session with no transcript as a row with its reason, not as an absence", () => {
    const merged = mergeFeed(
      [
        input("$1", "a-shell", {
          kind: "not-found",
          reason: "no-claude-session-id",
          why: "this session has no conversation id",
        }),
        input("$2", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
      ],
      10,
      NOW,
    );
    expect(merged.sessions).toHaveLength(2);
    expect(merged.sessions.find((s) => s.name === "a-shell")?.read).toMatchObject({
      kind: "not-found",
      reason: "no-claude-session-id",
    });
    expect(merged.messages).toHaveLength(1);
  });

  it("carries a session whose transcript could not be read, with the server's own sentence", () => {
    const merged = mergeFeed(
      [input("$1", "broken", { kind: "unreadable", path: "/x.jsonl", why: "could not read /x.jsonl: EIO" })],
      10,
      NOW,
    );
    expect(merged.sessions[0]?.read).toMatchObject({ kind: "unreadable", path: "/x.jsonl" });
    expect(merged.messages).toEqual([]);
  });

  /**
   * A turn with no timestamp cannot be placed in a global ordering. It is not
   * dropped — a feed that silently omits messages is the one thing this must
   * not be — and not interleaved at a guessed position either.
   *
   * Goes red if undated turns are filtered away, which is what a naive
   * `.filter(t => t.at !== null)` before the sort would do.
   */
  it("keeps an undated turn out of the ordering without dropping it", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn(null, "no-clock"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
      10,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["dated"]);
    expect(merged.undated.map((m) => m.text)).toEqual(["no-clock"]);
  });

  /** A string that is not a date is as unplaceable as a missing one. */
  it("treats an unparseable timestamp as undated rather than as epoch zero", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn("not a date", "junk"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
      10,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["dated"]);
    expect(merged.undated.map((m) => m.text)).toEqual(["junk"]);
  });
});

describe("coverage — whether 'the last N messages' is a claim this answer can make", () => {
  /**
   * **THE FINDING THIS WHOLE FIELD EXISTS FOR.** GPT Sol, on the plan: an
   * unreadable session *"can contain all of the true newest messages"*, and
   * *"showing these as rows does not stop the main list looking
   * authoritative"*. So one unreadable session makes the whole feed
   * indeterminate, not merely one line in a census.
   *
   * Goes red if the unreadable arm stops contributing a reason.
   */
  it("is indeterminate when even one session could not be read", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
        input("$2", "broken", { kind: "unreadable", path: "/x.jsonl", why: "EIO" }),
      ],
      10,
      NOW,
    );
    expect(merged.coverage.kind).toBe("indeterminate");
    expect(reasonKinds(merged.coverage)).toEqual(["unreadable"]);
    /* And the messages are still served — an indeterminate feed is not a
       useless one, it is one that must not be described as complete. */
    expect(merged.messages).toHaveLength(1);
  });

  /**
   * **THE ONE `not-found` THAT IS NOT A HOLE.** Nine of 21 rows on the box are
   * shells and scheduled sessions still running `sleep`. If those counted,
   * coverage would be permanently indeterminate — and a warning that is always
   * on is one nobody reads.
   */
  it("does not blame a shell for having no conversation", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
        {
          sessionId: "$2",
          name: "a-shell",
          title: null,
          working: false,
          claudeSessionId: null,
          /* The launcher positively says this is a shell — that, and not the
             null id, is what exempts it. */
          declaredNonClaude: true,
          result: {
            kind: "not-found",
            reason: "no-claude-session-id",
            why: "this session has no conversation id",
          },
        },
      ],
      10,
      NOW,
    );
    expect(merged.coverage).toEqual({ kind: "complete" });
  });

  /**
   * **THE OTHER HALF OF THAT EXEMPTION, AND THE REASON IT KEYS OFF THE
   * LAUNCHER RATHER THAN THE REASON CODE.** `claudeSessionId` is null for two
   * different things: a session that is not a Claude, and a legacy Claude that
   * predates the launcher pinning one. Both produce `no-claude-session-id`. If
   * the null itself exempted the row, a real conversation we failed to read
   * would be hidden — and this feed's whole job is to not do that.
   *
   * Goes red if the exemption is widened back to the reason code. GPT Sol's P1.
   */
  it("does blame a row with no conversation id that nothing declares a shell", () => {
    const merged = mergeFeed(
      [
        {
          sessionId: "$1",
          name: "a-legacy-claude",
          title: null,
          working: false,
          claudeSessionId: null,
          /* A legacy session: the launcher never wrote a kind for it. */
          declaredNonClaude: false,
          result: { kind: "not-found", reason: "no-claude-session-id", why: "no conversation id was pinned" },
        },
      ],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["no-transcript"]);
  });

  /**
   * Two fields the wire carried and nothing read — Class A out of
   * docs/postmortems/260908b, found by GPT Sol on the code review. Either could
   * sit beside `coverage: complete` and be invisible.
   */
  it("is indeterminate when a session's transcript had lines that would not parse", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hi")], { recordsUnparseable: 4 }))],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["unreadable"]);
  });

  /** One unparseable line is normal: the last record can be half-written as we read. */
  it("stays complete for the single half-written line a live session always has", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hi")], { recordsUnparseable: 1 }))],
      10,
      NOW,
    );
    expect(merged.coverage).toEqual({ kind: "complete" });
  });

  it("is indeterminate when more than one file matches the conversation id", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hi")], { copies: 2 }))],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["unreadable"]);
  });

  /** But a session that claims a conversation whose transcript is gone IS a hole. */
  it("is indeterminate when a claimed conversation's transcript could not be found", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", {
          kind: "not-found",
          reason: "no-transcript-file",
          why: "looked in every project directory; no such transcript",
        }),
      ],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["no-transcript"]);
  });

  /**
   * Two rows naming one conversation breaks "each message belongs to exactly
   * one session": its turns would be counted twice and pad the newest N with
   * duplicates. Detected rather than de-duplicated — which of the two rows is
   * the real one is not this module's to decide.
   */
  it("detects two sessions claiming the same conversation rather than double-counting it", () => {
    const shared = "the-same-conversation";
    const merged = mergeFeed(
      [
        { sessionId: "$1", name: "first", title: null, working: false, claudeSessionId: shared, declaredNonClaude: false, result: found([turn("2026-09-09T00:40:00.000Z", "hello")]) },
        { sessionId: "$2", name: "second", title: null, working: false, claudeSessionId: shared, declaredNonClaude: false, result: found([turn("2026-09-09T00:40:00.000Z", "hello")]) },
      ],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["duplicate-conversation"]);
    /* Both rows are named, because either could be the wrong one. */
    const named = merged.coverage.kind === "indeterminate" ? merged.coverage.reasons.map((r) => r.sessionId).sort() : [];
    expect(named).toEqual(["$1", "$2"]);
  });

  /**
   * A session whose own timestamps go backwards cannot be ordered against the
   * others, so "newest first" stops being a total order. Zero were observed in
   * 955 sampled turns; a wall-clock adjustment on the box would produce one.
   */
  it("is indeterminate when a session's own timestamps go backwards", () => {
    const merged = mergeFeed(
      [
        input(
          "$1",
          "clock-jumped",
          found([turn("2026-09-09T00:40:00.000Z", "later"), turn("2026-09-09T00:20:00.000Z", "earlier")]),
        ),
      ],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["out-of-order"]);
  });

  /**
   * **AN UNDATED TURN COSTS MORE THAN ITS OWN PLACE** — GPT Sol's P2. It was
   * fetched inside this session's newest N, so it displaced a dated turn that
   * was never fetched at all, and that turn may have belonged in the window.
   * Showing the undated ones in a group below is not enough to keep the dated
   * list exact.
   */
  it("is indeterminate when a session returned an undated turn", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn(null, "no clock"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
      10,
      NOW,
    );
    expect(reasonKinds(merged.coverage)).toEqual(["undated"]);
    /* Still shown, still out of the ordering. */
    expect(merged.undated.map((m) => m.text)).toEqual(["no clock"]);
  });

  it("is complete when every session was read whole and nothing was odd", () => {
    const merged = mergeFeed(
      [
        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "a")])),
        input("$2", "beta", found([turn("2026-09-09T00:41:00.000Z", "b")])),
      ],
      10,
      NOW,
    );
    expect(merged.coverage).toEqual({ kind: "complete" });
  });
});

describe("the guard turn", () => {
  /**
   * **THE PARTIAL TURN A COUNT CANNOT SEE.** One API turn is written as up to
   * four records sharing a `message.id`, and the reader coalesces them. When
   * the byte budget stops the walk inside a shared id, the oldest turn returned
   * is built from only the records above the boundary — a real-looking turn
   * missing some of its text and tool calls. Asking for N and getting N would
   * call that complete.
   *
   * GPT Sol's P1. Goes red if `contributedTurns` stops discarding the oldest.
   */
  it("discards the oldest turn when the walk did not reach the start of the file", () => {
    const merged = mergeFeed(
      [
        input(
          "$1",
          "alpha",
          found(
            [
              turn("2026-09-09T00:38:00.000Z", "possibly-a-fragment"),
              turn("2026-09-09T00:39:00.000Z", "whole"),
              turn("2026-09-09T00:40:00.000Z", "also-whole"),
            ],
            { reachedStartOfFile: false },
          ),
        ),
      ],
      10,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["also-whole", "whole"]);
  });

  /**
   * Nothing was cut, so the oldest turn is whole by construction and discarding
   * it would throw away a real message. Goes red if the guard is applied
   * unconditionally — which would silently drop the oldest message of every
   * short conversation on the box.
   */
  it("keeps every turn when the walk reached the start of the file", () => {
    const merged = mergeFeed(
      [
        input(
          "$1",
          "alpha",
          found([turn("2026-09-09T00:39:00.000Z", "the very first thing"), turn("2026-09-09T00:40:00.000Z", "second")]),
        ),
      ],
      10,
      NOW,
    );
    expect(merged.messages.map((m) => m.text)).toEqual(["second", "the very first thing"]);
  });
});

describe("the guard turn, against the real reader", () => {
  /**
   * **THE TESTS ABOVE START FROM ALREADY-COALESCED TURNS, WHICH IS THE ONE
   * THING THE HAZARD IS NOT.** GPT Sol's P2 on the code review: fabricating
   * `TranscriptTurn`s and slicing them proves the slice, not the claim. The
   * claim is about `readRecentMessages` — that when a byte budget stops the
   * walk inside a group of records sharing one `message.id`, the oldest turn it
   * returns is assembled from only the records above the boundary.
   *
   * So these three drive the real reader over a real file at a real byte
   * budget, and assert on what the feed contributes afterwards.
   */
  const CONV = "b41f7c93-2a08-4d6e-9f51-c7e3a8d05b26";
  const DIR = "/home/greg/code/spideryarn2";

  /** One assistant record. Several sharing an id are one turn. */
  function record(messageId: string, at: string, body: Record<string, unknown>): string {
    return `${JSON.stringify({
      type: "assistant",
      uuid: `${messageId}-${at}`,
      timestamp: at,
      message: { id: messageId, role: "assistant", ...body },
    })}\n`;
  }

  function textRecord(messageId: string, at: string, text: string): string {
    return record(messageId, at, { content: [{ type: "text", text }] });
  }

  /** Stage a transcript and read it back through the real reader. */
  async function readStaged(body: string, limit: number, maxBytes: number): Promise<RecentMessages> {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const path = (await import("node:path")).default;
    const { readRecentMessages } = await import("../tools/fleet/transcript.js");
    const projects = path.join(mkdtempSync(path.join(tmpdir(), "fleet-feed-guard-")), "projects");
    const slug = DIR.replace(/[/.]/g, "-");
    mkdirSync(path.join(projects, slug), { recursive: true });
    writeFileSync(path.join(projects, slug, `${CONV}.jsonl`), body);
    return readRecentMessages({ claudeSessionId: CONV, dir: DIR, limit, maxBytes, projectsDir: projects });
  }

  /**
   * **THE CASE THE GUARD EXISTS FOR.** A multi-record turn straddles the byte
   * boundary, so the reader returns it holding only its later fragment. The
   * feed must not contribute that fragment.
   *
   * Goes red if `contributedTurns` stops discarding the oldest.
   */
  it("does not contribute a turn the reader assembled from half its records", async () => {
    /* One turn written as two records sharing `m-split`, then two whole turns.
       The byte budget is tuned so the walk stops BETWEEN the two `m-split`
       records — measured against the real reader, not guessed: at 1000 bytes of
       this 1201-byte file it returns three turns whose oldest is built from the
       second record alone. */
    const split =
      textRecord("m-split", "2026-09-09T00:10:00.000Z", "FIRST HALF of the split turn") +
      textRecord("m-split", "2026-09-09T00:10:01.000Z", "SECOND HALF of the split turn");
    const later =
      textRecord("m-a", "2026-09-09T00:20:00.000Z", `whole-a ${"x".repeat(200)}`) +
      textRecord("m-b", "2026-09-09T00:30:00.000Z", `whole-b ${"y".repeat(200)}`);
    const result = await readStaged(split + later, 3, 1000);

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    /* The premise: the reader really did stop short of the file's start. */
    expect(result.reachedStartOfFile).toBe(false);

    /* **THE HAZARD ITSELF, ASSERTED RATHER THAN ASSUMED.** The reader hands
       back a turn holding only the second half of what the agent said, and
       nothing about it looks wrong — right speaker, plausible timestamp, real
       prose. This is the assertion that would notice if `readRecentMessages`
       ever stopped producing fragments, at which point the guard below is dead
       weight and should be deleted rather than left as folklore. */
    const raw = result.turns.map((t) => t.text).join("\n");
    expect(raw).toContain("SECOND HALF");
    expect(raw).not.toContain("FIRST HALF");

    /* And the guard drops exactly that turn, keeping the whole ones. */
    const texts = contributedTurns(result).map((t) => t.text).join("\n");
    expect(texts).not.toContain("SECOND HALF");
    expect(texts).toContain("whole-a");
    expect(texts).toContain("whole-b");
  });

  /**
   * When the walk reached byte 0 nothing was cut, so the oldest turn is whole
   * and discarding it would throw away a real message — the first thing the
   * agent ever said.
   */
  it("keeps the oldest turn when the reader reached the start of the file", async () => {
    const body =
      textRecord("m-1", "2026-09-09T00:10:00.000Z", "the very first thing") +
      textRecord("m-2", "2026-09-09T00:20:00.000Z", "the second thing");
    const result = await readStaged(body, 10, 1024 * 1024);

    expect(result.kind).toBe("found");
    if (result.kind !== "found") return;
    expect(result.reachedStartOfFile).toBe(true);
    expect(contributedTurns(result).map((t) => t.text)).toContain("the very first thing");
  });

  /**
   * The whole way through: a staged transcript, the real reader, the real
   * `feedPayload`, and coverage. A session cut short by the budget must come
   * back `indeterminate` rather than quietly short.
   */
  it("reports a byte-budget cut as indeterminate coverage, end to end", async () => {
    const body = Array.from({ length: 12 }, (_, i) =>
      textRecord(`m-${i}`, new Date(Date.parse("2026-09-09T00:00:00.000Z") + i * 60_000).toISOString(), `turn ${i} ${"z".repeat(300)}`),
    ).join("");

    const payload = await feedPayload(
      {
        snapshot: () =>
          ({
            rows: [
              {
                id: "$1",
                name: "cut-short",
                title: null,
                claudeSessionId: CONV,
                meta: { version: 1, kind: "claude", dir: DIR },
                status: { kind: "idle" },
              },
            ],
            collectedAt: "2026-09-09T00:59:30.000Z",
            tookMs: 1,
            tmuxServerPid: 42,
          }) as unknown as FleetSnapshot,
        nowMs: () => NOW,
        read: (_row, limit) => readStaged(body, limit, 512),
      },
      8,
    );

    expect(payload.kind).toBe("feed");
    if (payload.kind !== "feed") return;
    expect(payload.coverage.kind).toBe("indeterminate");
    expect(reasonKinds(payload.coverage)).toContain("byte-budget");
  });
});

describe("attribution", () => {
  const fresh = new Date(NOW - 60_000).toISOString();
  const stale = new Date(NOW - STALE_TRANSCRIPT_MS - 60_000).toISOString();

  /**
   * **THE ARM THAT MUST NOT BE REACHABLE YET.** `verified` needs
   * `FleetRow.execution`, which is not on `dev`. A `verified` that means "we
   * did not check" is worse than no arm at all, and this feed is the one place
   * where a misattributed message has nothing on screen to contradict it.
   *
   * Goes red the moment somebody wires `verified` up to something that is not
   * an actual conversation-id check.
   */
  it("never claims verified, because nothing can verify it yet", () => {
    for (const working of [true, false]) {
      for (const at of [fresh, stale, "not a date"]) {
        expect(attributionOf(working, at, NOW).kind).not.toBe("verified");
      }
    }
  });

  it("calls a working session with a long-untouched transcript suspect", () => {
    const reading = attributionOf(true, stale, NOW);
    expect(reading.kind).toBe("suspect");
    expect(reading.kind === "suspect" ? reading.why : "").toContain("re-used");
  });

  it("calls a working session that is writing claimed-only, not suspect", () => {
    expect(attributionOf(true, fresh, NOW).kind).toBe("claimed-only");
  });

  /**
   * A session parked on a dialog writes nothing until somebody answers it,
   * routinely for hours. Checking those would put the warning on exactly the
   * rows Greg opens this page to look at.
   */
  it("does not call a session that is not working suspect, however old its transcript", () => {
    expect(attributionOf(false, stale, NOW).kind).toBe("claimed-only");
  });

  it("attaches the reading to every message from that session", () => {
    const merged = mergeFeed(
      [input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")], { lastModified: stale }), true)],
      10,
      NOW,
    );
    expect(merged.messages[0]?.attribution.kind).toBe("suspect");
  });
});

describe("feedPayload", () => {
  function snapshotOf(rows: Partial<FleetRow>[]): FleetSnapshot {
    return {
      rows: rows.map((r, i) => ({
        id: `$${i + 1}`,
        name: `s${i + 1}`,
        title: null,
        claudeSessionId: "7c9e4d02-3f61-4a88-b5d7-e0912a4f6b3c",
        meta: { version: 1, dir: "/repo" },
        status: { kind: "idle" },
        ...r,
      })) as FleetRow[],
      collectedAt: "2026-09-09T00:59:30.000Z",
      tookMs: 1200,
      tmuxServerPid: 42,
    } as FleetSnapshot;
  }

  /**
   * **THE ARM THIS ROUTE EXISTS TO PRESERVE.** An empty `messages` says "we
   * looked and the fleet was quiet"; this says "we could not look". Merged,
   * they become one confident claim that thirty-six agents said nothing.
   */
  it("says it could not look, rather than serving an empty feed, before the first collection", async () => {
    const payload = await feedPayload({ snapshot: () => null, nowMs: () => NOW }, 50);
    expect(payload.kind).toBe("unreadable");
  });

  /**
   * The fan-out must ask each session for the SAME number the reader asked for
   * — that is the whole mechanism behind the exact merge. Goes red if a fixed
   * per-session constant creeps back in.
   */
  /**
   * The fan-out asks for the reader's own limit — that is what makes the merge
   * exact — **plus one guard turn**, because the oldest turn a byte-bounded
   * walk returns can be a fragment of a turn whose other records fell below the
   * boundary. `GUARD_TURNS` has the argument. Goes red if either the per-session
   * limit stops tracking the reader's, or the guard is dropped.
   */
  it("asks every session for the reader's own limit plus a guard turn", async () => {
    const asked: number[] = [];
    await feedPayload(
      {
        snapshot: () => snapshotOf([{}, {}, {}]),
        nowMs: () => NOW,
        read: async (_row, limit) => {
          asked.push(limit);
          return found([]);
        },
      },
      37,
    );
    expect(asked).toEqual([37 + GUARD_TURNS, 37 + GUARD_TURNS, 37 + GUARD_TURNS]);
  });

  it("carries both clocks, so a session that started after the snapshot is accountable", async () => {
    const payload = await feedPayload(
      { snapshot: () => snapshotOf([{}]), nowMs: () => NOW, read: async () => found([]) },
      10,
    );
    expect(payload).toMatchObject({
      kind: "feed",
      collectedAt: "2026-09-09T00:59:30.000Z",
      servedAt: new Date(NOW).toISOString(),
    });
  });
});

describe("the route", () => {
  type Recorded = { status: number; headers: Record<string, string>; body: Buffer };

  function fakeRes(): { res: import("node:http").ServerResponse; done: Promise<Recorded> } {
    let settle: (r: Recorded) => void = () => {};
    const done = new Promise<Recorded>((resolve) => {
      settle = resolve;
    });
    let status = 0;
    let headers: Record<string, string> = {};
    const res = {
      writeHead(code: number, h: Record<string, string>) {
        status = code;
        headers = h;
        return this;
      },
      end(body: string | Buffer) {
        settle({ status, headers, body: Buffer.isBuffer(body) ? body : Buffer.from(String(body)) });
      },
    } as unknown as import("node:http").ServerResponse;
    return { res, done };
  }

  function req(url: string, headers: Record<string, string> = {}): import("node:http").IncomingMessage {
    return { url, headers } as unknown as import("node:http").IncomingMessage;
  }

  const deps = {
    snapshot: () =>
      ({
        rows: [
          {
            id: "$1",
            name: "alpha",
            title: null,
            claudeSessionId: "7c9e4d02-3f61-4a88-b5d7-e0912a4f6b3c",
            meta: { version: 1, dir: "/repo" },
            status: { kind: "idle" },
          },
        ],
        collectedAt: "2026-09-09T00:59:30.000Z",
        tookMs: 1,
        tmuxServerPid: 42,
      }) as unknown as FleetSnapshot,
    nowMs: () => NOW,
    read: async () => found([turn("2026-09-09T00:40:00.000Z", "hello")]),
  };

  it("does not answer a request that is not its own", () => {
    const { res } = fakeRes();
    expect(recentFeedRoute(deps).handle(req("/api/state"), res)).toBe(false);
  });

  /**
   * The `startsWith` that mounts it must not quietly widen into a path with
   * segments after it. Same rule the health-history and new-session routes state.
   */
  it("refuses a path underneath itself rather than serving the feed for it", async () => {
    const { res, done } = fakeRes();
    expect(recentFeedRoute(deps).handle(req("/api/feed/../secrets"), res)).toBe(true);
    const out = await done;
    expect(out.status).toBe(404);
  });

  it("serves the feed", async () => {
    const { res, done } = fakeRes();
    recentFeedRoute(deps).handle(req("/api/feed?limit=5"), res);
    const out = await done;
    expect(out.status).toBe(200);
    const payload = JSON.parse(out.body.toString()) as { kind: string; limit: number; messages: { text: string }[] };
    expect(payload.kind).toBe("feed");
    expect(payload.limit).toBe(5);
    expect(payload.messages.map((m) => m.text)).toEqual(["hello"]);
  });

  /**
   * 266 kB of JSON at N=50, read on a phone over Tailscale, is the number that
   * put this here. Goes red if the gzip branch is dropped.
   */
  it("compresses a large answer when the caller accepts it, and says so", async () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      turn(new Date(Date.parse("2026-09-09T00:00:00.000Z") + i * 1000).toISOString(), `message number ${i} `.repeat(20)),
    );
    const { res, done } = fakeRes();
    recentFeedRoute({ ...deps, read: async () => found(many) }).handle(
      req("/api/feed?limit=200", { "accept-encoding": "gzip, deflate" }),
      res,
    );
    const out = await done;
    expect(out.headers["content-encoding"]).toBe("gzip");
    expect(out.headers["vary"]).toBe("accept-encoding");
    const payload = JSON.parse(gunzipSync(out.body).toString()) as { kind: string; messages: unknown[] };
    expect(payload.kind).toBe("feed");
    expect(payload.messages).toHaveLength(200);
  });

  it("sends plain JSON to a caller that did not offer to accept gzip", async () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      turn(new Date(Date.parse("2026-09-09T00:00:00.000Z") + i * 1000).toISOString(), `message number ${i} `.repeat(20)),
    );
    const { res, done } = fakeRes();
    recentFeedRoute({ ...deps, read: async () => found(many) }).handle(req("/api/feed?limit=200"), res);
    const out = await done;
    expect(out.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(out.body.toString()).kind).toBe("feed");
  });

  /**
   * `readRecentMessages` is built not to reject, so this covers the case where
   * that is itself wrong. A hung request is indistinguishable from a dead box
   * on a phone.
   */
  /**
   * A thrown read is one session's problem, not the fleet's: the feed still
   * serves every other session and demotes coverage to say what it lost. A 500
   * would throw away 20 good sessions because one was unreadable.
   */
  it("serves the rest of the fleet when one session's read throws", async () => {
    const { res, done } = fakeRes();
    recentFeedRoute({
      ...deps,
      read: () => Promise.reject(new Error("disk went away")),
    }).handle(req("/api/feed"), res);
    const out = await done;
    expect(out.status).toBe(200);
    const payload = JSON.parse(out.body.toString()) as { kind: string; coverage: { kind: string } };
    expect(payload.kind).toBe("feed");
    expect(payload.coverage.kind).toBe("indeterminate");
  });

  /**
   * **THE FAILURE A REJECTION DOES NOT COVER.** `Promise.all` waits for its
   * slowest member for ever, so a read that never settles — a wedged mount, a
   * bug in a future reader — held the whole route open until the phone gave up,
   * which is indistinguishable from the box being down. A rejection was already
   * handled; a hang was not.
   *
   * GPT Sol's P1 on the code review. Goes red if `readWithin` stops racing the
   * deadline: the test simply never finishes.
   */
  it("gives up on a read that never settles, rather than hanging the whole route", async () => {
    const { res, done } = fakeRes();
    recentFeedRoute({
      ...deps,
      deadlineMs: 20,
      /* Never resolves, never rejects. */
      read: () => new Promise<never>(() => {}),
    }).handle(req("/api/feed"), res);
    const out = await done;
    expect(out.status).toBe(200);
    const payload = JSON.parse(out.body.toString()) as {
      kind: string;
      sessions: { read: { kind: string; why?: string } }[];
      coverage: { kind: string };
    };
    expect(payload.kind).toBe("feed");
    expect(payload.sessions[0]?.read.kind).toBe("unreadable");
    expect(payload.sessions[0]?.read.why).toContain("gave up");
    expect(payload.coverage.kind).toBe("indeterminate");
  });
});
