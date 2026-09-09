# Code review: the cross-agent "Recent messages" feed

This is the **second** review of this work — you reviewed the plan earlier and I have implemented
your findings. This one is weighted higher than the plan review, because a plan-stage review cannot
find a route that writes one field and then rejects the request.

## What this is

`tools/fleet/` is an internal fleet dashboard showing the tmux sessions of Claude agents on one box,
read on a phone over Tailscale. No untrusted callers, but a high bar for honesty: the person reading
it is deciding whether an agent is stuck. This change adds `GET /api/feed` and a "Recent messages"
tab: the last N messages across every session, newest first, with filters.

## What I did with your plan-review findings

- **P1.1 coverage** — implemented as you asked. `FeedCoverage` is now a top-level required
  discriminated field, `complete | indeterminate` with typed reasons keyed by `sessionId` (not name).
  Six reasons demote it: `byte-budget`, `unreadable`, `no-transcript`, `undated`, `out-of-order`,
  `duplicate-conversation`. **One deliberate exclusion**: `not-found` with reason
  `no-claude-session-id` does NOT demote coverage, because that is a shell or a scheduled session
  still running `sleep` — nine of 21 rows on this box — and counting them would make coverage
  permanently indeterminate. Please check that reasoning and whether the exclusion is too broad.
- **P1.2 no single instant** — `collectedAt`, `readStartedAt`, `readFinishedAt` on the payload, and
  the panel prints the census boundary sentence.
- **P1.3 coalescing** — implemented your N+1 guard turn. `contributedTurns` discards the oldest
  whenever `reachedStartOfFile` is false. Completeness is now `reachedStartOfFile || contributed >= N`.
- **P1.4 total order** — timestamps parsed to epoch ms; unparseable and null both go to the undated
  group; deterministic tie-break by arrival order; within-session inversions now demote coverage.
- **P1.5 verified unreachable** — unchanged and tested; `copies` and `recordsUnparseable` now carried.
- **P1.6** — I narrowed the claim in prose but did NOT add an unsupported-record diagnostic, because
  that needs a change to `transcript.ts`, which another session owns tonight. Flagged for the Overseer.
- **P1.7 stale response** — `useFeed` has a monotonic generation ref; tested via the size control,
  because the refresh button disables itself while busy and so cannot produce the race.
- **P2.1 wrong wire quantity** — you were right. Re-measured through `feedPayload` itself: 40 kB at
  N=50, 8 kB gzipped, not 266 kB. The plan is corrected. Cadence is now justified by the disk cost
  (10 MB of transcript reads per refresh), not the wire.
- **P2.2 undated consumes N** — undated turns now demote coverage.
- **P2.4 shared Turn** — I did not put a `collapsed` prop on one component. `Turn.tsx` exports
  `SPEAKERS` and `Turn`; the feed imports only `SPEAKERS` and writes its own body.

## What I want from you now

Rank P0/P1/P2. Specifically:

1. **Is the coverage computation actually correct?** In particular `mergeFeed`'s `byte-budget`
   condition (only when the session's oldest returned message is newer than the cutoff), and whether
   the `no-claude-session-id` exclusion can hide a real hole.
2. **Is the guard turn right?** I claim the turn below a discarded one is whole by construction. Is
   that true given how `readTail`/`recordsToTurns` work? And is there a case where discarding the
   oldest loses a real message?
3. **Honesty failures in the client.** `parseFeed` and `parseCoverage` — can a malformed or
   adversarial payload produce a feed that renders as confident and complete when it is not?
4. **The filters.** `applyFilters` and `isToolCallOnly` — can a filter silently drop an agent's own
   words? Can the URL round-trip produce a state that renders as "no messages" without saying why?
5. **Anything in the route that can hang, leak, or double-answer** — the async handler in particular.
6. **Tests that pass for the wrong reason.** I verified 16 mutations go red across two rounds, but
   tell me which guard has no test, or which test would still pass with the behaviour broken.

Do not review prose style or comment volume. The comments are the house style here.

## The raw test output (421 passing)

```
 ✓ |unit| tests/fleet-web.test.tsx > tmuxServerPid, the namespace the handles live in > reads it off the payload, and null when it is absent or unreadable 1ms
 ✓ |unit| tests/fleet-web.test.tsx > tmuxServerPid, the namespace the handles live in > prints it beside the handles it qualifies, so two snapshots can be compared 60ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > refuses half an address rather than filling the missing half in 1ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > says where the message landed, and shouts when it is not where you were looking 75ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > names the pane on an ordinary send, rather than only saying 'Sent.' 70ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > compares the pane's pid, so a respawn under the same handles is not agreement 1ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > records a field it could not compare rather than counting it as a match 1ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > does not claim delivery, because nothing measured the pane after the send 89ms
 ✓ |unit| tests/fleet-web.test.tsx > verified — what was true of the target in the moment before sending > checks the outcome against the row that was TAPPED, not the row on screen now 121ms
 ✓ |unit| tests/fleet-web.test.tsx > resolution and startedDir — what new-session actually did > reads both, and refuses to guess `repo` for a server that did not say 2ms
 ✓ |unit| tests/fleet-web.test.tsx > resolution and startedDir — what new-session actually did > draws the directory the box CHOSE when it is not the one that was asked for 47ms
 ✓ |unit| tests/fleet-web.test.tsx > resolution and startedDir — what new-session actually did > says out loud when a launch went in through the -d escape hatch 61ms
 ✓ |unit| tests/fleet-web.test.tsx > resolution and startedDir — what new-session actually did > does not say a -d launch STARTED while it is still starting 59ms
 ✓ |unit| tests/fleet-web.test.tsx > resolution and startedDir — what new-session actually did > does not say a -d launch STARTED after it failed 48ms

 Test Files  3 passed (3)
      Tests  421 passed (421)
   Start at  01:34:59
   Duration  27.82s (transform 8.52s, setup 1.16s, import 8.99s, tests 21.43s, environment 3.62s)

```

## The diff

```diff
diff --git a/tests/fleet-feed-panel.test.tsx b/tests/fleet-feed-panel.test.tsx
new file mode 100644
index 00000000..2b469151
--- /dev/null
+++ b/tests/fleet-feed-panel.test.tsx
@@ -0,0 +1,717 @@
+// @vitest-environment jsdom
+/**
+ * **THE "RECENT MESSAGES" TAB**, from the bytes the server composes to the
+ * words on screen.
+ *
+ * ## The join, drawn through the real producer
+ *
+ * The class of bug this area keeps producing is a producer with no consumer:
+ * every part tested, the edge between them missing, nothing red
+ * (docs/postmortems/260908b). Four fields reached the browser and were dropped
+ * by the client on four separate occasions in one night.
+ *
+ * So the first test here builds the payload with `feedPayload` — the function
+ * the route calls — serialises it, parses it with `parseFeed`, which is the
+ * browser's own parser, and asserts on text in the DOM. Four hops, none of them
+ * faked. Everything after that drives the panel directly, because *what does a
+ * suspect attribution look like* is a rendering question and does not need a
+ * server.
+ *
+ * ## What this tab must never do, which is what most of these tests are
+ *
+ * Show a message under a session's name as though the attribution were settled,
+ * or a short list as though it were complete. The reader was never watching
+ * these sessions, so nothing on screen contradicts a wrong answer.
+ */
+import { act } from "react";
+import { createRoot, type Root } from "react-dom/client";
+import { afterEach, beforeEach, describe, expect, it } from "vitest";
+
+import type { FleetSnapshot } from "../tools/fleet/collect.js";
+import { feedPayload } from "../tools/fleet/routes-recent-feed.js";
+import type { RecentMessages, TranscriptTurn } from "../tools/fleet/transcript.js";
+import { App } from "../tools/fleet/web/src/App";
+import { FeedPanel } from "../tools/fleet/web/src/FeedPanel";
+import {
+  NO_FILTERS,
+  applyFilters,
+  filtersFromParams,
+  isToolCallOnly,
+  limitFromParams,
+  paramsFromFilters,
+  parseFeed,
+  type FeedApi,
+  type FeedRow,
+  type FeedView,
+} from "../tools/fleet/web/src/feed-client";
+import type { MessageSpeaker } from "../tools/fleet/web/src/messages-client";
+import { MODES, MODE_LABELS } from "../tools/fleet/web/src/mode";
+
+const NOW = Date.parse("2026-09-09T01:00:00.000Z");
+
+/* React only honours `act` when it is told it is in a test environment.
+   Without it every render warns, and — worse — the warning is the only sign
+   that the flush this file depends on was never guaranteed. */
+(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
+
+let host: HTMLDivElement;
+let root: Root;
+
+beforeEach(() => {
+  host = document.createElement("div");
+  document.body.appendChild(host);
+  root = createRoot(host);
+});
+
+afterEach(() => {
+  act(() => root.unmount());
+  host.remove();
+});
+
+function turn(at: string | null, text: string, over: Partial<TranscriptTurn> = {}): TranscriptTurn {
+  return {
+    speaker: "assistant",
+    at,
+    text,
+    truncated: false,
+    fullChars: text.length,
+    toolCalls: [],
+    uuid: `u-${text}`,
+    ...over,
+  };
+}
+
+function found(turns: TranscriptTurn[], over: Partial<Extract<RecentMessages, { kind: "found" }>> = {}): RecentMessages {
+  return {
+    kind: "found",
+    path: "/fixture.jsonl",
+    via: "slug-guess",
+    turns,
+    reachedStartOfFile: true,
+    bytesRead: 1024,
+    fileBytes: 1024,
+    lastModified: "2026-09-09T00:59:00.000Z",
+    copies: 1,
+    recordsParsed: turns.length,
+    recordsUnparseable: 0,
+    toolResultsSkipped: 0,
+    ...over,
+  };
+}
+
+function snapshotOf(names: string[]): FleetSnapshot {
+  return {
+    rows: names.map((name, i) => ({
+      id: `$${i + 1}`,
+      name,
+      title: null,
+      claudeSessionId: "3d1b8e57-90af-4c26-8e14-6b2075af93d1",
+      meta: { version: 1, dir: "/repo" },
+      status: { kind: "idle" },
+    })),
+    collectedAt: "2026-09-09T00:59:30.000Z",
+    tookMs: 1,
+    tmuxServerPid: 42,
+  } as unknown as FleetSnapshot;
+}
+
+/** An api that answers with a view, for driving the panel directly. */
+function apiOf(view: FeedView): FeedApi {
+  return { recent: () => Promise.resolve(view) };
+}
+
+/** Render, and flush the promise the panel fetches with. */
+async function draw(node: React.ReactElement): Promise<string> {
+  await act(async () => {
+    root.render(node);
+  });
+  return host.textContent ?? "";
+}
+
+function panel(view: FeedView, over: Partial<Parameters<typeof FeedPanel>[0]> = {}): React.ReactElement {
+  return (
+    <FeedPanel
+      api={apiOf(view)}
+      limit={50}
+      onLimit={() => {}}
+      filters={NO_FILTERS}
+      onFilters={() => {}}
+      {...over}
+    />
+  );
+}
+
+describe("the join, server to screen", () => {
+  /**
+   * **THE FOUR HOPS.** `feedPayload` is what the route calls; `JSON` is the
+   * wire; `parseFeed` is the browser's parser; the panel is the screen. A field
+   * the server sends and the client drops cannot survive this test, which is
+   * the only kind of test that catches it.
+   */
+  it("carries a message from the server's own composer to the DOM", async () => {
+    const payload = await feedPayload(
+      {
+        snapshot: () => snapshotOf(["alpha", "beta"]),
+        nowMs: () => NOW,
+        read: async (row) =>
+          found([turn("2026-09-09T00:40:00.000Z", `something ${row.name} said`)]),
+      },
+      50,
+    );
+    const view = parseFeed(JSON.parse(JSON.stringify(payload)));
+    expect(view.kind).toBe("feed");
+    const text = await draw(panel(view));
+    expect(text).toContain("something alpha said");
+    expect(text).toContain("something beta said");
+    expect(text).toContain("alpha");
+  });
+
+  /**
+   * The ordering is the server's and the client must not re-do it. Goes red if
+   * the panel sorts, or if `parseFeed` reverses.
+   */
+  it("keeps the server's newest-first order rather than re-sorting", async () => {
+    const payload = await feedPayload(
+      {
+        snapshot: () => snapshotOf(["alpha", "beta"]),
+        nowMs: () => NOW,
+        read: async (row) =>
+          found([
+            turn(row.name === "alpha" ? "2026-09-09T00:10:00.000Z" : "2026-09-09T00:50:00.000Z", `${row.name}-said`),
+          ]),
+      },
+      50,
+    );
+    const view = parseFeed(JSON.parse(JSON.stringify(payload)));
+    const order = view.kind === "feed" ? view.messages.map((m) => m.turn.text) : [];
+    expect(order).toEqual(["beta-said", "alpha-said"]);
+    const text = await draw(panel(view));
+    expect(text.indexOf("beta-said")).toBeLessThan(text.indexOf("alpha-said"));
+  });
+});
+
+describe("parseFeed", () => {
+  it("says so, in its own voice, when the answer is not this API", () => {
+    expect(parseFeed({ hello: "world" })).toMatchObject({ kind: "no-answer" });
+    expect(parseFeed("nonsense")).toMatchObject({ kind: "no-answer" });
+  });
+
+  it("keeps the server's unreadable arm rather than showing an empty feed", () => {
+    const view = parseFeed({ schema: 1, kind: "unreadable", why: "no collection yet" });
+    expect(view).toMatchObject({ kind: "unreadable", why: "no collection yet" });
+  });
+
+  /**
+   * A message with no session cannot be attributed, and putting it on screen
+   * under a blank name is the misattribution this payload is shaped to prevent.
+   * It is COUNTED, not silently dropped.
+   */
+  it("refuses a message with no session, and counts it rather than hiding it", () => {
+    const view = parseFeed({
+      schema: 1,
+      kind: "feed",
+      limit: 50,
+      messages: [{ text: "orphan", speaker: "assistant" }, { sessionId: "$1", text: "fine", speaker: "assistant" }],
+      undated: [],
+      sessions: [],
+      coverage: { kind: "complete" },
+    });
+    expect(view.kind === "feed" ? view.messages.map((m) => m.turn.text) : []).toEqual(["fine"]);
+    expect(view.kind === "feed" ? view.unreadableRows : -1).toBe(1);
+  });
+
+  /**
+   * **THE UNDER-CLAIM.** `complete` is a positive assertion that a session's
+   * newest turns were all read. A server that did not say has not made it, and
+   * inventing `true` would silence the warning that stops a truncated session
+   * reading as a quiet one.
+   */
+  it("treats an unstated `complete` as not complete", () => {
+    const view = parseFeed({
+      schema: 1,
+      kind: "feed",
+      limit: 50,
+      messages: [],
+      undated: [],
+      sessions: [{ sessionId: "$1", name: "alpha", read: { kind: "read", turns: 3 } }],
+      coverage: { kind: "complete" },
+    });
+    expect(view.kind === "feed" ? view.sessions[0]?.read : null).toMatchObject({ complete: false });
+  });
+
+  /** An empty census and no census at all are opposite claims. */
+  it("distinguishes an empty session list from a server that sent none", () => {
+    const withList = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], sessions: [], coverage: { kind: "complete" } });
+    const without = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], coverage: { kind: "complete" } });
+    expect(withList.kind === "feed" ? withList.sessionsOffered : null).toBe(true);
+    expect(without.kind === "feed" ? without.sessionsOffered : null).toBe(false);
+  });
+
+  /**
+   * Rounding an unfamiliar speaker to `assistant` would misattribute a message.
+   * transcript.ts calls a compaction summary "the single most convincing wrong
+   * answer this module could give".
+   */
+  it("rounds an unknown speaker to unrecognised, never to the agent", () => {
+    const view = parseFeed({
+      schema: 1,
+      kind: "feed",
+      messages: [{ sessionId: "$1", speaker: "something-new", text: "hi" }],
+      undated: [],
+      sessions: [],
+      coverage: { kind: "complete" },
+    });
+    expect(view.kind === "feed" ? view.messages[0]?.turn.speaker : null).toBe("unrecognised");
+  });
+
+  /** An unrecognised attribution must under-claim, never become `verified`. */
+  it("rounds an unknown attribution down to claimed-only", () => {
+    const view = parseFeed({
+      schema: 1,
+      kind: "feed",
+      messages: [{ sessionId: "$1", speaker: "assistant", text: "hi", attribution: { kind: "brand-new" } }],
+      undated: [],
+      sessions: [],
+      coverage: { kind: "complete" },
+    });
+    expect(view.kind === "feed" ? view.messages[0]?.attribution.kind : null).toBe("claimed-only");
+  });
+});
+
+describe("the filters", () => {
+  const rows: FeedRow[] = [
+    {
+      sessionId: "$1",
+      sessionName: "alpha",
+      sessionTitle: null,
+      attribution: { kind: "claimed-only", why: "w" },
+      turn: { speaker: "assistant", at: "t", text: "hello world", truncated: false, fullChars: 11, toolCalls: [], uuid: "a" },
+    },
+    {
+      sessionId: "$2",
+      sessionName: "beta",
+      sessionTitle: null,
+      attribution: { kind: "claimed-only", why: "w" },
+      turn: { speaker: "human", at: "t", text: "goodbye", truncated: false, fullChars: 7, toolCalls: [], uuid: "b" },
+    },
+    {
+      sessionId: "$1",
+      sessionName: "alpha",
+      sessionTitle: null,
+      attribution: { kind: "claimed-only", why: "w" },
+      turn: { speaker: "assistant", at: "t", text: "", truncated: false, fullChars: 0, toolCalls: [{ name: "Bash", detail: "ls" }], uuid: "c" },
+    },
+  ];
+
+  it("keeps everything when nothing is chosen", () => {
+    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(3);
+  });
+
+  it("narrows by session", () => {
+    expect(applyFilters(rows, { ...NO_FILTERS, sessions: ["$2"] }).map((r) => r.turn.text)).toEqual(["goodbye"]);
+  });
+
+  it("narrows by speaker", () => {
+    expect(applyFilters(rows, { ...NO_FILTERS, speakers: ["human"] }).map((r) => r.turn.text)).toEqual(["goodbye"]);
+  });
+
+  it("narrows by text, case-insensitively, and searches the session name too", () => {
+    expect(applyFilters(rows, { ...NO_FILTERS, text: "HELLO" }).map((r) => r.turn.text)).toEqual(["hello world"]);
+    expect(applyFilters(rows, { ...NO_FILTERS, text: "beta" }).map((r) => r.turn.text)).toEqual(["goodbye"]);
+  });
+
+  /** A reader typing `(` into a search box must not get an error. */
+  it("treats the text filter as a substring, never a regex", () => {
+    expect(() => applyFilters(rows, { ...NO_FILTERS, text: "((" })).not.toThrow();
+    expect(applyFilters(rows, { ...NO_FILTERS, text: "((" })).toEqual([]);
+  });
+
+  /**
+   * **A TURN THAT SAYS SOMETHING *AND* CALLS A TOOL IS A MESSAGE.** Hiding it
+   * would drop the agent's own words, which is the failure mode of every "hide
+   * noise" toggle that was ever regretted.
+   */
+  it("hides only the turns that were nothing but tool calls", () => {
+    const speaking: FeedRow = {
+      ...rows[0]!,
+      turn: { ...rows[0]!.turn, text: "I will run this", toolCalls: [{ name: "Bash", detail: "ls" }], uuid: "d" },
+    };
+    expect(isToolCallOnly(speaking)).toBe(false);
+    expect(isToolCallOnly(rows[2]!)).toBe(true);
+    const kept = applyFilters([...rows, speaking], { ...NO_FILTERS, hideToolCalls: true });
+    expect(kept.map((r) => r.turn.uuid)).toEqual(["a", "b", "d"]);
+  });
+});
+
+describe("what the panel must not hide", () => {
+  function feedOf(over: Partial<Extract<FeedView, { kind: "feed" }>>): FeedView {
+    return {
+      kind: "feed",
+      limit: 50,
+      messages: [],
+      undated: [],
+      sessions: [],
+      sessionsOffered: true,
+      unreadableRows: 0,
+      coverage: { kind: "complete" },
+      collectedAt: null,
+      readStartedAt: null,
+      readFinishedAt: null,
+      servedAt: null,
+      ...over,
+    };
+  }
+
+  const message = (over: Partial<FeedRow> = {}): FeedRow => ({
+    sessionId: "$1",
+    sessionName: "alpha",
+    sessionTitle: null,
+    attribution: { kind: "claimed-only", why: "w" },
+    turn: { speaker: "assistant", at: "t", text: "hello", truncated: false, fullChars: 5, toolCalls: [], uuid: "a" },
+    ...over,
+  });
+
+  /**
+   * **THE WARNING THAT STOPS "THE LAST 50" BEING A LIE.** Goes red if `Caveats`
+   * stops rendering the coverage reasons.
+   */
+  it("says out loud when this may not be the last N messages", async () => {
+    const text = await draw(
+      panel(
+        feedOf({
+          messages: [message()],
+          coverage: {
+            kind: "indeterminate",
+            reasons: [
+              { sessionId: "$9", name: "chatty-one", kind: "byte-budget", why: "cut short by the read budget" },
+            ],
+          },
+        }),
+      ),
+    );
+    expect(text).toContain("may not be the last");
+    expect(text).toContain("chatty-one");
+    expect(text).toContain("cut short by the read budget");
+  });
+
+  /**
+   * **THE ONE FIELD WHERE UNDER- AND OVER-CLAIMING ARE NOT SYMMETRIC.** A build
+   * that met a coverage arm it did not understand and rounded it to `complete`
+   * would put a confident "the last 50 messages" over a feed with a hole in it.
+   */
+  it("will not call a feed complete when the server did not say it was", () => {
+    for (const coverage of [undefined, null, {}, { kind: "brand-new" }, { kind: "indeterminate" }]) {
+      const view = parseFeed({ schema: 1, kind: "feed", messages: [], undated: [], sessions: [], coverage });
+      expect(view.kind === "feed" ? view.coverage.kind : null).toBe("indeterminate");
+    }
+  });
+
+  /** An unfamiliar reason is kept, not dropped — dropping the last one reads as complete. */
+  it("keeps a coverage reason it does not recognise rather than emptying the list", () => {
+    const view = parseFeed({
+      schema: 1,
+      kind: "feed",
+      messages: [],
+      undated: [],
+      sessions: [],
+      coverage: {
+        kind: "indeterminate",
+        reasons: [{ sessionId: "$1", name: "alpha", kind: "some-future-reason", why: "something new went wrong" }],
+      },
+    });
+    expect(view.kind === "feed" ? view.coverage.kind : null).toBe("indeterminate");
+    const reasons = view.kind === "feed" && view.coverage.kind === "indeterminate" ? view.coverage.reasons : [];
+    expect(reasons).toHaveLength(1);
+    expect(reasons[0]?.why).toBe("something new went wrong");
+  });
+
+  /**
+   * A session with no readable transcript is a row saying so, not an absence.
+   * Nine of 21 rows on the box are like this.
+   */
+  it("accounts for the sessions it could not read, rather than omitting them", async () => {
+    const text = await draw(
+      panel(
+        feedOf({
+          messages: [message()],
+          sessions: [
+            { sessionId: "$1", name: "alpha", title: null, read: { kind: "read", turns: 1, complete: true, lastModified: "t", bytesRead: 1, fileBytes: 1, toolResultsSkipped: 0, copies: 1, recordsUnparseable: 0 } },
+            { sessionId: "$2", name: "a-shell", title: null, read: { kind: "not-found", reason: "no-claude-session-id", why: "this session has no conversation id" } },
+          ],
+        }),
+      ),
+    );
+    expect(text).toContain("1 of 2 sessions had no readable transcript");
+  });
+
+  /** A suspect attribution goes on the message, not into a footnote. */
+  it("marks a message whose session may have been re-used", async () => {
+    const text = await draw(
+      panel(
+        feedOf({
+          messages: [message({ attribution: { kind: "suspect", why: "the pane may have been re-used" } })],
+        }),
+      ),
+    );
+    expect(text).toContain("may not be this session");
+  });
+
+  /**
+   * **TWO DIFFERENT EMPTINESSES.** "Your filters match nothing" is the reader's
+   * own doing. "No session has said anything" is a claim about the fleet, and
+   * saying the second when the first is true would be a manufactured outage.
+   */
+  it("tells an empty filter result apart from an empty fleet", async () => {
+    const filtered = await draw(
+      panel(feedOf({ messages: [message()] }), { filters: { ...NO_FILTERS, text: "nothing matches this" } }),
+    );
+    expect(filtered).toContain("match these filters");
+    expect(filtered).not.toContain("has a readable message");
+
+    const empty = await draw(panel(feedOf({ messages: [] })));
+    expect(empty).toContain("No session in this window has a readable message");
+  });
+
+  /** Undated messages are shown rather than dropped, and kept out of the ordering. */
+  it("shows an undated message in its own group", async () => {
+    const text = await draw(
+      panel(
+        feedOf({
+          messages: [message()],
+          undated: [message({ turn: { speaker: "assistant", at: null, text: "no clock on this", truncated: false, fullChars: 16, toolCalls: [], uuid: "z" } })],
+        }),
+      ),
+    );
+    expect(text).toContain("Undated");
+    expect(text).toContain("no clock on this");
+  });
+
+  /** The server's failure is the server's sentence, and ours is ours. */
+  it("distinguishes a server that could not look from a page that got no answer", async () => {
+    const server = await draw(panel({ kind: "unreadable", why: "the collector has not run" }));
+    expect(server).toContain("could not build this feed");
+    expect(server).toContain("the collector has not run");
+
+    const wire = await draw(panel({ kind: "no-answer", why: "this browser could not reach the dashboard" }));
+    expect(wire).toContain("did not get an answer it could read");
+  });
+});
+
+describe("expanding a message in place", () => {
+  function longMessage(): FeedView {
+    return {
+      kind: "feed",
+      limit: 50,
+      messages: [
+        {
+          sessionId: "$1",
+          sessionName: "alpha",
+          sessionTitle: null,
+          attribution: { kind: "claimed-only", why: "w" },
+          turn: {
+            speaker: "assistant",
+            at: "t",
+            text: "the first line only\nand the rest of it, which is hidden until asked for",
+            truncated: false,
+            fullChars: 70,
+            toolCalls: [],
+            uuid: "a",
+          },
+        },
+      ],
+      undated: [],
+      sessions: [],
+      sessionsOffered: true,
+      unreadableRows: 0,
+      coverage: { kind: "complete" },
+      collectedAt: null,
+      readStartedAt: null,
+      readFinishedAt: null,
+      servedAt: null,
+    };
+  }
+
+  it("shows the first line, then the rest when asked", async () => {
+    await draw(panel(longMessage()));
+    expect(host.textContent ?? "").toContain("the first line only");
+    expect(host.textContent ?? "").not.toContain("which is hidden until asked for");
+
+    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show the rest"));
+    expect(more).toBeDefined();
+    await act(async () => more?.click());
+    expect(host.textContent ?? "").toContain("which is hidden until asked for");
+  });
+
+  /**
+   * **EXPANDING SHOWS EVERYTHING THE SERVER SENT, WHICH IS NOT EVERYTHING THE
+   * AGENT SAID.** The reader caps a turn at 2,000 characters. Dropping the
+   * disclosure on expand would turn "here is more" into "here is all of it" —
+   * GPT Sol's P2.3.
+   */
+  it("keeps the cut-short disclosure after expanding", async () => {
+    const view = longMessage();
+    if (view.kind === "feed" && view.messages[0]) {
+      view.messages[0].turn.truncated = true;
+      view.messages[0].turn.fullChars = 9000;
+    }
+    await draw(panel(view));
+    const more = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Show the rest"));
+    await act(async () => more?.click());
+    expect(host.textContent ?? "").toContain("Cut short by the reader");
+    expect(host.textContent ?? "").toContain("9,000");
+  });
+});
+
+describe("two refreshes that land out of order", () => {
+  /**
+   * **AN OLDER ANSWER MUST NOT OVERWRITE A NEWER ONE.** Two refreshes can
+   * resolve in either order, and the older arriving second would put a stale
+   * feed on screen looking entirely healthy — there is no per-session identity
+   * here to notice the swap. The per-session reader guards this with a
+   * monotonic request token and so does `useFeed`.
+   *
+   * GPT Sol's P1.7. Goes red if the `generation` ref is removed.
+   */
+  it("ignores the stale answer rather than showing it", async () => {
+    const answers: ((view: FeedView) => void)[] = [];
+    const api: FeedApi = { recent: () => new Promise<FeedView>((resolve) => answers.push(resolve)) };
+    const feedWith = (text: string): FeedView => ({
+      kind: "feed",
+      limit: 50,
+      messages: [
+        {
+          sessionId: "$1",
+          sessionName: "alpha",
+          sessionTitle: null,
+          attribution: { kind: "claimed-only", why: "w" },
+          turn: { speaker: "assistant", at: "t", text, truncated: false, fullChars: text.length, toolCalls: [], uuid: text },
+        },
+      ],
+      undated: [],
+      sessions: [],
+      sessionsOffered: true,
+      unreadableRows: 0,
+      coverage: { kind: "complete" },
+      collectedAt: null,
+      readStartedAt: null,
+      readFinishedAt: null,
+      servedAt: null,
+    });
+
+    await act(async () => {
+      root.render(<FeedPanel api={api} limit={50} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} />);
+    });
+    /* A second read started before the first has answered — through the SIZE
+       control rather than the refresh button, because the button disables
+       itself while a read is in flight and so cannot produce this race. The
+       size control can: changing it restarts the read with a new limit, and
+       nothing stops the reader doing that twice in a second. */
+    await act(async () => {
+      root.render(<FeedPanel api={api} limit={100} onLimit={() => {}} filters={NO_FILTERS} onFilters={() => {}} />);
+    });
+    expect(answers).toHaveLength(2);
+
+    // The NEWER one lands first, then the older one.
+    await act(async () => answers[1]?.(feedWith("the fresh answer")));
+    await act(async () => answers[0]?.(feedWith("the stale answer")));
+
+    expect(host.textContent ?? "").toContain("the fresh answer");
+    expect(host.textContent ?? "").not.toContain("the stale answer");
+  });
+});
+
+describe("the filters in the URL", () => {
+  /**
+   * The page is reloaded whenever iOS reclaims the tab, so a filter that lives
+   * only in memory is one nobody bothers to set. mode.ts § the hash.
+   */
+  it("survives a round trip through the hash", () => {
+    const filters = { sessions: ["$1", "$2"], speakers: ["human"] as MessageSpeaker[], text: "deploy", hideToolCalls: true };
+    const params = paramsFromFilters(filters);
+    const asHash: Record<string, string> = {};
+    for (const [k, v] of Object.entries(params)) if (v !== null) asHash[k] = v;
+    expect(filtersFromParams(asHash)).toEqual(filters);
+  });
+
+  /**
+   * **A DEFAULT LEAVES NO TRACE.** `null` is what mode.ts turns into a removed
+   * key, so "back to showing everything" produces a clean URL rather than a
+   * trail of empty parameters.
+   */
+  it("writes nothing at all for the default filters", () => {
+    expect(Object.values(paramsFromFilters(NO_FILTERS)).every((v) => v === null)).toBe(true);
+  });
+
+  /**
+   * A hash is a thing people bookmark and send each other, and one written by a
+   * later build must degrade to showing MORE than was meant — never to an empty
+   * feed the reader cannot explain.
+   */
+  it("drops a speaker this build does not know rather than filtering by it", () => {
+    expect(filtersFromParams({ mw: "human,a-speaker-from-the-future" }).speakers).toEqual(["human"]);
+  });
+
+  it("falls back to the default size rather than honouring a nonsense one", () => {
+    expect(limitFromParams({ mn: "9999" })).toBe(50);
+    expect(limitFromParams({ mn: "banana" })).toBe(50);
+    expect(limitFromParams({})).toBe(50);
+    expect(limitFromParams({ mn: "100" })).toBe(100);
+  });
+});
+
+describe("the tab is actually registered", () => {
+  /**
+   * **THE ONE REGISTRATION THE COMPILER DOES NOT CHECK.** `MODES`,
+   * `MODE_LABELS`, `MODE_ICONS` and `MODE_TIPS` are all `Record<Mode, …>`, so a
+   * half-added mode is a compile error. The mount in `App.tsx` is a
+   * `mode === "x" ? … : null` ternary rather than an exhaustive switch, so a
+   * mode registered in all four maps and not there draws a button, switches the
+   * hash, and shows an empty page — compiling perfectly.
+   *
+   * Found by session `dashboard-modes-doc` while documenting how to add a tab;
+   * this is the test that would notice.
+   */
+  it("is in the mode list, with a label", () => {
+    expect(MODES).toContain("messages");
+    expect(MODE_LABELS.messages).toBe("Recent messages");
+  });
+
+  it("draws its panel when the hash names it, rather than an empty page", async () => {
+    const feed: FeedView = {
+      kind: "feed",
+      limit: 50,
+      messages: [
+        {
+          sessionId: "$1",
+          sessionName: "alpha",
+          sessionTitle: null,
+          attribution: { kind: "claimed-only", why: "w" },
+          turn: { speaker: "assistant", at: "t", text: "a message from the fleet", truncated: false, fullChars: 24, toolCalls: [], uuid: "a" },
+        },
+      ],
+      undated: [],
+      sessions: [],
+      sessionsOffered: true,
+      unreadableRows: 0,
+      coverage: { kind: "complete" },
+      collectedAt: null,
+      readStartedAt: null,
+      readFinishedAt: null,
+      servedAt: null,
+    };
+    window.location.hash = "#messages";
+    await act(async () => {
+      root.render(
+        <App
+          /* A transport that never delivers anything: this test is about the
+             mode arm, and the session list is irrelevant to it. */
+          transport={() => ({ refresh: () => {}, stop: () => {} })}
+          feedApi={apiOf(feed)}
+          actionsPollMs={0}
+        />,
+      );
+    });
+    expect(host.textContent ?? "").toContain("a message from the fleet");
+    window.location.hash = "";
+  });
+});
diff --git a/tests/fleet-recent-feed.test.ts b/tests/fleet-recent-feed.test.ts
new file mode 100644
index 00000000..3f9d45b9
--- /dev/null
+++ b/tests/fleet-recent-feed.test.ts
@@ -0,0 +1,822 @@
+/**
+ * `GET /api/feed` — tools/fleet/routes-recent-feed.ts.
+ *
+ * The reader itself is tested in tests/fleet-transcript.test.ts and is not
+ * re-tested here. What is here is the three things this module actually decides:
+ * **the ordering** (newest first, the opposite of the sibling route), **the
+ * completeness accounting** (which is the whole defence against a truncated
+ * session reading as a quiet one), and **the arms it must never merge**.
+ *
+ * Every test below was checked to go red by mutating the line it covers —
+ * docs/reusable/silent-success.md, and the notes on the individual tests say
+ * which mutation.
+ */
+import { gunzipSync } from "node:zlib";
+
+import { describe, expect, it } from "vitest";
+
+import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
+import {
+  DEFAULT_FEED_LIMIT,
+  GUARD_TURNS,
+  MAX_FEED_LIMIT,
+  STALE_TRANSCRIPT_MS,
+  attributionOf,
+  feedPayload,
+  limitFrom,
+  mergeFeed,
+  recentFeedRoute,
+  type FeedInput,
+} from "../tools/fleet/routes-recent-feed.js";
+import type { RecentMessages, TranscriptTurn } from "../tools/fleet/transcript.js";
+import type { FeedCoverage } from "../tools/fleet/wire.js";
+
+const NOW = Date.parse("2026-09-09T01:00:00.000Z");
+
+/** A turn, with only the fields a test cares about spelled out. */
+function turn(at: string | null, text: string, over: Partial<TranscriptTurn> = {}): TranscriptTurn {
+  return {
+    speaker: "assistant",
+    at,
+    text,
+    truncated: false,
+    fullChars: text.length,
+    toolCalls: [],
+    uuid: `u-${at ?? "none"}-${text}`,
+    ...over,
+  };
+}
+
+/**
+ * A `found` answer. `reachedStartOfFile` defaults TRUE — the ordinary case for
+ * a short transcript — so a test that cares about incompleteness has to say so,
+ * rather than getting it by accident from a sloppy default.
+ */
+function found(turns: TranscriptTurn[], over: Partial<Extract<RecentMessages, { kind: "found" }>> = {}): RecentMessages {
+  return {
+    kind: "found",
+    path: "/fixture.jsonl",
+    via: "slug-guess",
+    turns,
+    reachedStartOfFile: true,
+    bytesRead: 1024,
+    fileBytes: 1024,
+    lastModified: "2026-09-09T00:59:00.000Z",
+    copies: 1,
+    recordsParsed: turns.length,
+    recordsUnparseable: 0,
+    toolResultsSkipped: 0,
+    ...over,
+  };
+}
+
+/** The names a coverage answer blames for a byte-budget gap. */
+function missingNames(coverage: FeedCoverage): string[] {
+  return coverage.kind === "complete"
+    ? []
+    : coverage.reasons.filter((r) => r.kind === "byte-budget").map((r) => r.name);
+}
+
+/** Every reason kind an answer carries, for asserting on the shape of a gap. */
+function reasonKinds(coverage: FeedCoverage): string[] {
+  return coverage.kind === "complete" ? [] : [...new Set(coverage.reasons.map((r) => r.kind))].sort();
+}
+
+function input(sessionId: string, name: string, result: RecentMessages, working = false): FeedInput {
+  /* `claudeSessionId` derived from the handle so two fixtures never accidentally
+     collide and trip the duplicate-conversation check. A test that means to
+     collide says so by passing the same one explicitly. */
+  return { sessionId, name, title: null, working, claudeSessionId: `conv-${sessionId}`, result };
+}
+
+describe("limitFrom", () => {
+  it("defaults when there is no limit parameter", () => {
+    expect(limitFrom("/api/feed")).toBe(DEFAULT_FEED_LIMIT);
+  });
+
+  it("defaults rather than erroring on nonsense, because this is a feed", () => {
+    expect(limitFrom("/api/feed?limit=banana")).toBe(DEFAULT_FEED_LIMIT);
+    expect(limitFrom("/api/feed?limit=-3")).toBe(DEFAULT_FEED_LIMIT);
+    expect(limitFrom("/api/feed?limit=0")).toBe(DEFAULT_FEED_LIMIT);
+  });
+
+  it("clamps rather than reading the whole box off disk", () => {
+    expect(limitFrom("/api/feed?limit=100000")).toBe(MAX_FEED_LIMIT);
+  });
+
+  it("takes a smaller limit as asked, as an integer", () => {
+    expect(limitFrom("/api/feed?limit=10")).toBe(10);
+    expect(limitFrom("/api/feed?limit=10.7")).toBe(10);
+  });
+});
+
+describe("the ordering", () => {
+  /**
+   * **THE INVERSION.** `/api/messages` returns turns newest LAST and this route
+   * returns them newest FIRST, so a reader arriving from messages-client.ts
+   * will assume the wrong one. Doing it server-side means it has one home; this
+   * is that home's test.
+   *
+   * Goes red if the sort comparator is flipped.
+   */
+  it("interleaves sessions newest first, across the whole fleet", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", found([turn("2026-09-09T00:00:00.000Z", "a-old"), turn("2026-09-09T00:30:00.000Z", "a-new")])),
+        input("$2", "beta", found([turn("2026-09-09T00:15:00.000Z", "b-mid"), turn("2026-09-09T00:45:00.000Z", "b-new")])),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["b-new", "a-new", "b-mid", "a-old"]);
+  });
+
+  /**
+   * Two messages written in the same millisecond must not swap places between
+   * refreshes — a list that reshuffles under a thumb on a phone is worse than
+   * one that is slightly arbitrary, as long as it is arbitrary the same way
+   * every time. Goes red if the `order` tie-break is dropped and the sort
+   * becomes unstable across engines.
+   */
+  it("breaks ties deterministically rather than reshuffling under the reader", () => {
+    const same = "2026-09-09T00:20:00.000Z";
+    const build = (): FeedInput[] => [
+      input("$1", "alpha", found([turn(same, "a")])),
+      input("$2", "beta", found([turn(same, "b")])),
+      input("$3", "gamma", found([turn(same, "c")])),
+    ];
+    const first = mergeFeed(build(), 10, NOW).messages.map((m) => m.text);
+    const again = mergeFeed(build(), 10, NOW).messages.map((m) => m.text);
+    expect(again).toEqual(first);
+    expect(first).toEqual(["a", "b", "c"]);
+  });
+});
+
+describe("the exact merge", () => {
+  /**
+   * **THE PROPERTY THE PER-SESSION LIMIT BUYS.** One agent that has written all
+   * of the last N messages must fill the feed with all N of them — not with six
+   * of its own and the rest padded from quieter sessions, which is what asking
+   * each session for a small fixed k produces, and which looks entirely normal
+   * on screen.
+   *
+   * Goes red if the fan-out asks for a fixed k instead of `limit`, and this is
+   * the test that would have caught that design.
+   */
+  it("lets one chatty session fill the whole window", () => {
+    const chatty = Array.from({ length: 8 }, (_, i) =>
+      turn(new Date(Date.parse("2026-09-09T00:40:00.000Z") + i * 1000).toISOString(), `chat-${i}`),
+    );
+    const merged = mergeFeed(
+      [
+        input("$1", "chatty", found(chatty)),
+        input("$2", "quiet", found([turn("2026-09-08T20:00:00.000Z", "ancient")])),
+      ],
+      8,
+      NOW,
+    );
+    expect(merged.messages).toHaveLength(8);
+    expect(merged.messages.every((m) => m.sessionName === "chatty")).toBe(true);
+    expect(merged.messages.map((m) => m.text)).not.toContain("ancient");
+  });
+
+  it("trims to the limit and keeps the newest", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", found([turn("2026-09-09T00:00:00.000Z", "old"), turn("2026-09-09T00:30:00.000Z", "new")])),
+        input("$2", "beta", found([turn("2026-09-09T00:45:00.000Z", "newest")])),
+      ],
+      2,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["newest", "new"]);
+  });
+});
+
+describe("completeness — a truncated session must not read as a quiet one", () => {
+  /**
+   * A session cut short by the byte budget, whose returned messages are all
+   * INSIDE the window on screen, may have had more in that window. It is named.
+   *
+   * Goes red if `complete` stops being computed, or if `mayBeMissing` is
+   * hard-coded to `[]` — and an empty `mayBeMissing` is exactly what a
+   * plausible-looking simplification of this file would produce.
+   */
+  it("names a session whose cut-off point is inside the window", () => {
+    const merged = mergeFeed(
+      [
+        /* Asked for 3, got 2, and did not reach the start of the file — so
+           there are older turns it never read. Both of the ones it did read are
+           NEWER than the feed's cutoff, so those unread ones could have been in
+           this window too. */
+        input(
+          "$1",
+          "truncated",
+          found([turn("2026-09-09T00:50:00.000Z", "t-old"), turn("2026-09-09T00:52:00.000Z", "t-new")], {
+            reachedStartOfFile: false,
+          }),
+        ),
+        input("$2", "beta", found([turn("2026-09-09T00:45:00.000Z", "b1"), turn("2026-09-09T00:46:00.000Z", "b2")])),
+      ],
+      3,
+      NOW,
+    );
+    expect(merged.sessions.find((s) => s.name === "truncated")?.read).toMatchObject({ kind: "read", complete: false });
+    expect(missingNames(merged.coverage)).toEqual(["truncated"]);
+  });
+
+  /**
+   * **THE OTHER DIRECTION, AND THE REASON THIS IS ARITHMETIC RATHER THAN A
+   * FLAG.** A session cut short whose oldest returned message is already older
+   * than everything on screen has had every message it could contribute to this
+   * window read. Naming it would be noise, and a warning that is usually wrong
+   * is one nobody reads.
+   *
+   * Goes red if `mayBeMissing` becomes "every incomplete session".
+   */
+  it("stays quiet about a cut-off session that falls entirely outside the window", () => {
+    const merged = mergeFeed(
+      [
+        /* Incomplete — asked for 2, got 1, never reached the start of the file
+           — but everything it returned is ancient, so every turn it failed to
+           read is older still and none of them could be in this window. */
+        /* Two ancient turns, cut short. The oldest is discarded as the guard
+           turn, leaving one — fewer than the 2 asked for, so incomplete. */
+        input(
+          "$1",
+          "truncated",
+          found([turn("2026-09-08T20:00:00.000Z", "t-guard"), turn("2026-09-08T20:01:00.000Z", "t-old")], {
+            reachedStartOfFile: false,
+          }),
+        ),
+        input(
+          "$2",
+          "busy",
+          found([
+            turn("2026-09-09T00:44:00.000Z", "b0"),
+            turn("2026-09-09T00:45:00.000Z", "b1"),
+            turn("2026-09-09T00:46:00.000Z", "b2"),
+          ]),
+        ),
+      ],
+      2,
+      NOW,
+    );
+    expect(merged.sessions.find((s) => s.name === "truncated")?.read).toMatchObject({ complete: false });
+    expect(merged.coverage).toEqual({ kind: "complete" });
+  });
+
+  /**
+   * Nothing was trimmed, so the window reaches back as far as we read, and any
+   * incompleteness at all is inside it. Goes red if the `cutoffMs === null`
+   * branch is dropped — which is the easy simplification, and it would silence
+   * the warning on exactly the quiet fleets where it is cheapest to be right.
+   */
+  it("names a cut-off session when nothing was trimmed at all", () => {
+    const merged = mergeFeed(
+      [input("$1", "truncated", found([turn("2026-09-09T00:40:00.000Z", "t")], { reachedStartOfFile: false }))],
+      50,
+      NOW,
+    );
+    expect(missingNames(merged.coverage)).toEqual(["truncated"]);
+  });
+
+  /** Reaching byte 0 is a positive claim that there is nothing above. */
+  it("calls a session complete when the walk reached the start of the file", () => {
+    const merged = mergeFeed([input("$1", "short", found([turn("2026-09-09T00:40:00.000Z", "t")]))], 50, NOW);
+    expect(merged.sessions[0]?.read).toMatchObject({ complete: true });
+    expect(merged.coverage).toEqual({ kind: "complete" });
+  });
+
+  /**
+   * Getting as many turns as were asked for is the other way to be complete —
+   * and with the guard turn that means `limit + 1` came back, so that `limit`
+   * survive the discard. See `GUARD_TURNS`.
+   */
+  it("calls a session complete when it returned everything that was asked for", () => {
+    const merged = mergeFeed(
+      [
+        input(
+          "$1",
+          "full",
+          found(
+            [
+              turn("2026-09-09T00:39:00.000Z", "guard"),
+              turn("2026-09-09T00:40:00.000Z", "a"),
+              turn("2026-09-09T00:41:00.000Z", "b"),
+            ],
+            { reachedStartOfFile: false },
+          ),
+        ),
+      ],
+      2,
+      NOW,
+    );
+    expect(merged.sessions[0]?.read).toMatchObject({ complete: true });
+    expect(merged.coverage).toEqual({ kind: "complete" });
+  });
+});
+
+describe("the arms that must never be merged", () => {
+  /**
+   * Nine of 21 rows on the box are shells and scheduled sessions still running
+   * `sleep`. A feed that listed only the sessions it could read would show a
+   * fleet of twelve and look complete doing it.
+   *
+   * Goes red if unreadable rows are filtered out of the census.
+   */
+  it("carries a session with no transcript as a row with its reason, not as an absence", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "a-shell", {
+          kind: "not-found",
+          reason: "no-claude-session-id",
+          why: "this session has no conversation id",
+        }),
+        input("$2", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.sessions).toHaveLength(2);
+    expect(merged.sessions.find((s) => s.name === "a-shell")?.read).toMatchObject({
+      kind: "not-found",
+      reason: "no-claude-session-id",
+    });
+    expect(merged.messages).toHaveLength(1);
+  });
+
+  it("carries a session whose transcript could not be read, with the server's own sentence", () => {
+    const merged = mergeFeed(
+      [input("$1", "broken", { kind: "unreadable", path: "/x.jsonl", why: "could not read /x.jsonl: EIO" })],
+      10,
+      NOW,
+    );
+    expect(merged.sessions[0]?.read).toMatchObject({ kind: "unreadable", path: "/x.jsonl" });
+    expect(merged.messages).toEqual([]);
+  });
+
+  /**
+   * A turn with no timestamp cannot be placed in a global ordering. It is not
+   * dropped — a feed that silently omits messages is the one thing this must
+   * not be — and not interleaved at a guessed position either.
+   *
+   * Goes red if undated turns are filtered away, which is what a naive
+   * `.filter(t => t.at !== null)` before the sort would do.
+   */
+  it("keeps an undated turn out of the ordering without dropping it", () => {
+    const merged = mergeFeed(
+      [input("$1", "alpha", found([turn(null, "no-clock"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
+      10,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["dated"]);
+    expect(merged.undated.map((m) => m.text)).toEqual(["no-clock"]);
+  });
+
+  /** A string that is not a date is as unplaceable as a missing one. */
+  it("treats an unparseable timestamp as undated rather than as epoch zero", () => {
+    const merged = mergeFeed(
+      [input("$1", "alpha", found([turn("not a date", "junk"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
+      10,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["dated"]);
+    expect(merged.undated.map((m) => m.text)).toEqual(["junk"]);
+  });
+});
+
+describe("coverage — whether 'the last N messages' is a claim this answer can make", () => {
+  /**
+   * **THE FINDING THIS WHOLE FIELD EXISTS FOR.** GPT Sol, on the plan: an
+   * unreadable session *"can contain all of the true newest messages"*, and
+   * *"showing these as rows does not stop the main list looking
+   * authoritative"*. So one unreadable session makes the whole feed
+   * indeterminate, not merely one line in a census.
+   *
+   * Goes red if the unreadable arm stops contributing a reason.
+   */
+  it("is indeterminate when even one session could not be read", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
+        input("$2", "broken", { kind: "unreadable", path: "/x.jsonl", why: "EIO" }),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.coverage.kind).toBe("indeterminate");
+    expect(reasonKinds(merged.coverage)).toEqual(["unreadable"]);
+    /* And the messages are still served — an indeterminate feed is not a
+       useless one, it is one that must not be described as complete. */
+    expect(merged.messages).toHaveLength(1);
+  });
+
+  /**
+   * **THE ONE `not-found` THAT IS NOT A HOLE.** Nine of 21 rows on the box are
+   * shells and scheduled sessions still running `sleep`. If those counted,
+   * coverage would be permanently indeterminate — and a warning that is always
+   * on is one nobody reads.
+   */
+  it("does not blame a shell for having no conversation", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")])),
+        input("$2", "a-shell", {
+          kind: "not-found",
+          reason: "no-claude-session-id",
+          why: "this session has no conversation id",
+        }),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.coverage).toEqual({ kind: "complete" });
+  });
+
+  /** But a session that claims a conversation whose transcript is gone IS a hole. */
+  it("is indeterminate when a claimed conversation's transcript could not be found", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", {
+          kind: "not-found",
+          reason: "no-transcript-file",
+          why: "looked in every project directory; no such transcript",
+        }),
+      ],
+      10,
+      NOW,
+    );
+    expect(reasonKinds(merged.coverage)).toEqual(["no-transcript"]);
+  });
+
+  /**
+   * Two rows naming one conversation breaks "each message belongs to exactly
+   * one session": its turns would be counted twice and pad the newest N with
+   * duplicates. Detected rather than de-duplicated — which of the two rows is
+   * the real one is not this module's to decide.
+   */
+  it("detects two sessions claiming the same conversation rather than double-counting it", () => {
+    const shared = "the-same-conversation";
+    const merged = mergeFeed(
+      [
+        { sessionId: "$1", name: "first", title: null, working: false, claudeSessionId: shared, result: found([turn("2026-09-09T00:40:00.000Z", "hello")]) },
+        { sessionId: "$2", name: "second", title: null, working: false, claudeSessionId: shared, result: found([turn("2026-09-09T00:40:00.000Z", "hello")]) },
+      ],
+      10,
+      NOW,
+    );
+    expect(reasonKinds(merged.coverage)).toEqual(["duplicate-conversation"]);
+    /* Both rows are named, because either could be the wrong one. */
+    const named = merged.coverage.kind === "indeterminate" ? merged.coverage.reasons.map((r) => r.sessionId).sort() : [];
+    expect(named).toEqual(["$1", "$2"]);
+  });
+
+  /**
+   * A session whose own timestamps go backwards cannot be ordered against the
+   * others, so "newest first" stops being a total order. Zero were observed in
+   * 955 sampled turns; a wall-clock adjustment on the box would produce one.
+   */
+  it("is indeterminate when a session's own timestamps go backwards", () => {
+    const merged = mergeFeed(
+      [
+        input(
+          "$1",
+          "clock-jumped",
+          found([turn("2026-09-09T00:40:00.000Z", "later"), turn("2026-09-09T00:20:00.000Z", "earlier")]),
+        ),
+      ],
+      10,
+      NOW,
+    );
+    expect(reasonKinds(merged.coverage)).toEqual(["out-of-order"]);
+  });
+
+  /**
+   * **AN UNDATED TURN COSTS MORE THAN ITS OWN PLACE** — GPT Sol's P2. It was
+   * fetched inside this session's newest N, so it displaced a dated turn that
+   * was never fetched at all, and that turn may have belonged in the window.
+   * Showing the undated ones in a group below is not enough to keep the dated
+   * list exact.
+   */
+  it("is indeterminate when a session returned an undated turn", () => {
+    const merged = mergeFeed(
+      [input("$1", "alpha", found([turn(null, "no clock"), turn("2026-09-09T00:40:00.000Z", "dated")]))],
+      10,
+      NOW,
+    );
+    expect(reasonKinds(merged.coverage)).toEqual(["undated"]);
+    /* Still shown, still out of the ordering. */
+    expect(merged.undated.map((m) => m.text)).toEqual(["no clock"]);
+  });
+
+  it("is complete when every session was read whole and nothing was odd", () => {
+    const merged = mergeFeed(
+      [
+        input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "a")])),
+        input("$2", "beta", found([turn("2026-09-09T00:41:00.000Z", "b")])),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.coverage).toEqual({ kind: "complete" });
+  });
+});
+
+describe("the guard turn", () => {
+  /**
+   * **THE PARTIAL TURN A COUNT CANNOT SEE.** One API turn is written as up to
+   * four records sharing a `message.id`, and the reader coalesces them. When
+   * the byte budget stops the walk inside a shared id, the oldest turn returned
+   * is built from only the records above the boundary — a real-looking turn
+   * missing some of its text and tool calls. Asking for N and getting N would
+   * call that complete.
+   *
+   * GPT Sol's P1. Goes red if `contributedTurns` stops discarding the oldest.
+   */
+  it("discards the oldest turn when the walk did not reach the start of the file", () => {
+    const merged = mergeFeed(
+      [
+        input(
+          "$1",
+          "alpha",
+          found(
+            [
+              turn("2026-09-09T00:38:00.000Z", "possibly-a-fragment"),
+              turn("2026-09-09T00:39:00.000Z", "whole"),
+              turn("2026-09-09T00:40:00.000Z", "also-whole"),
+            ],
+            { reachedStartOfFile: false },
+          ),
+        ),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["also-whole", "whole"]);
+  });
+
+  /**
+   * Nothing was cut, so the oldest turn is whole by construction and discarding
+   * it would throw away a real message. Goes red if the guard is applied
+   * unconditionally — which would silently drop the oldest message of every
+   * short conversation on the box.
+   */
+  it("keeps every turn when the walk reached the start of the file", () => {
+    const merged = mergeFeed(
+      [
+        input(
+          "$1",
+          "alpha",
+          found([turn("2026-09-09T00:39:00.000Z", "the very first thing"), turn("2026-09-09T00:40:00.000Z", "second")]),
+        ),
+      ],
+      10,
+      NOW,
+    );
+    expect(merged.messages.map((m) => m.text)).toEqual(["second", "the very first thing"]);
+  });
+});
+
+describe("attribution", () => {
+  const fresh = new Date(NOW - 60_000).toISOString();
+  const stale = new Date(NOW - STALE_TRANSCRIPT_MS - 60_000).toISOString();
+
+  /**
+   * **THE ARM THAT MUST NOT BE REACHABLE YET.** `verified` needs
+   * `FleetRow.execution`, which is not on `dev`. A `verified` that means "we
+   * did not check" is worse than no arm at all, and this feed is the one place
+   * where a misattributed message has nothing on screen to contradict it.
+   *
+   * Goes red the moment somebody wires `verified` up to something that is not
+   * an actual conversation-id check.
+   */
+  it("never claims verified, because nothing can verify it yet", () => {
+    for (const working of [true, false]) {
+      for (const at of [fresh, stale, "not a date"]) {
+        expect(attributionOf(working, at, NOW).kind).not.toBe("verified");
+      }
+    }
+  });
+
+  it("calls a working session with a long-untouched transcript suspect", () => {
+    const reading = attributionOf(true, stale, NOW);
+    expect(reading.kind).toBe("suspect");
+    expect(reading.kind === "suspect" ? reading.why : "").toContain("re-used");
+  });
+
+  it("calls a working session that is writing claimed-only, not suspect", () => {
+    expect(attributionOf(true, fresh, NOW).kind).toBe("claimed-only");
+  });
+
+  /**
+   * A session parked on a dialog writes nothing until somebody answers it,
+   * routinely for hours. Checking those would put the warning on exactly the
+   * rows Greg opens this page to look at.
+   */
+  it("does not call a session that is not working suspect, however old its transcript", () => {
+    expect(attributionOf(false, stale, NOW).kind).toBe("claimed-only");
+  });
+
+  it("attaches the reading to every message from that session", () => {
+    const merged = mergeFeed(
+      [input("$1", "alpha", found([turn("2026-09-09T00:40:00.000Z", "hello")], { lastModified: stale }), true)],
+      10,
+      NOW,
+    );
+    expect(merged.messages[0]?.attribution.kind).toBe("suspect");
+  });
+});
+
+describe("feedPayload", () => {
+  function snapshotOf(rows: Partial<FleetRow>[]): FleetSnapshot {
+    return {
+      rows: rows.map((r, i) => ({
+        id: `$${i + 1}`,
+        name: `s${i + 1}`,
+        title: null,
+        claudeSessionId: "7c9e4d02-3f61-4a88-b5d7-e0912a4f6b3c",
+        meta: { version: 1, dir: "/repo" },
+        status: { kind: "idle" },
+        ...r,
+      })) as FleetRow[],
+      collectedAt: "2026-09-09T00:59:30.000Z",
+      tookMs: 1200,
+      tmuxServerPid: 42,
+    } as FleetSnapshot;
+  }
+
+  /**
+   * **THE ARM THIS ROUTE EXISTS TO PRESERVE.** An empty `messages` says "we
+   * looked and the fleet was quiet"; this says "we could not look". Merged,
+   * they become one confident claim that thirty-six agents said nothing.
+   */
+  it("says it could not look, rather than serving an empty feed, before the first collection", async () => {
+    const payload = await feedPayload({ snapshot: () => null, nowMs: () => NOW }, 50);
+    expect(payload.kind).toBe("unreadable");
+  });
+
+  /**
+   * The fan-out must ask each session for the SAME number the reader asked for
+   * — that is the whole mechanism behind the exact merge. Goes red if a fixed
+   * per-session constant creeps back in.
+   */
+  /**
+   * The fan-out asks for the reader's own limit — that is what makes the merge
+   * exact — **plus one guard turn**, because the oldest turn a byte-bounded
+   * walk returns can be a fragment of a turn whose other records fell below the
+   * boundary. `GUARD_TURNS` has the argument. Goes red if either the per-session
+   * limit stops tracking the reader's, or the guard is dropped.
+   */
+  it("asks every session for the reader's own limit plus a guard turn", async () => {
+    const asked: number[] = [];
+    await feedPayload(
+      {
+        snapshot: () => snapshotOf([{}, {}, {}]),
+        nowMs: () => NOW,
+        read: async (_row, limit) => {
+          asked.push(limit);
+          return found([]);
+        },
+      },
+      37,
+    );
+    expect(asked).toEqual([37 + GUARD_TURNS, 37 + GUARD_TURNS, 37 + GUARD_TURNS]);
+  });
+
+  it("carries both clocks, so a session that started after the snapshot is accountable", async () => {
+    const payload = await feedPayload(
+      { snapshot: () => snapshotOf([{}]), nowMs: () => NOW, read: async () => found([]) },
+      10,
+    );
+    expect(payload).toMatchObject({
+      kind: "feed",
+      collectedAt: "2026-09-09T00:59:30.000Z",
+      servedAt: new Date(NOW).toISOString(),
+    });
+  });
+});
+
+describe("the route", () => {
+  type Recorded = { status: number; headers: Record<string, string>; body: Buffer };
+
+  function fakeRes(): { res: import("node:http").ServerResponse; done: Promise<Recorded> } {
+    let settle: (r: Recorded) => void = () => {};
+    const done = new Promise<Recorded>((resolve) => {
+      settle = resolve;
+    });
+    let status = 0;
+    let headers: Record<string, string> = {};
+    const res = {
+      writeHead(code: number, h: Record<string, string>) {
+        status = code;
+        headers = h;
+        return this;
+      },
+      end(body: string | Buffer) {
+        settle({ status, headers, body: Buffer.isBuffer(body) ? body : Buffer.from(String(body)) });
+      },
+    } as unknown as import("node:http").ServerResponse;
+    return { res, done };
+  }
+
+  function req(url: string, headers: Record<string, string> = {}): import("node:http").IncomingMessage {
+    return { url, headers } as unknown as import("node:http").IncomingMessage;
+  }
+
+  const deps = {
+    snapshot: () =>
+      ({
+        rows: [
+          {
+            id: "$1",
+            name: "alpha",
+            title: null,
+            claudeSessionId: "7c9e4d02-3f61-4a88-b5d7-e0912a4f6b3c",
+            meta: { version: 1, dir: "/repo" },
+            status: { kind: "idle" },
+          },
+        ],
+        collectedAt: "2026-09-09T00:59:30.000Z",
+        tookMs: 1,
+        tmuxServerPid: 42,
+      }) as unknown as FleetSnapshot,
+    nowMs: () => NOW,
+    read: async () => found([turn("2026-09-09T00:40:00.000Z", "hello")]),
+  };
+
+  it("does not answer a request that is not its own", () => {
+    const { res } = fakeRes();
+    expect(recentFeedRoute(deps).handle(req("/api/state"), res)).toBe(false);
+  });
+
+  /**
+   * The `startsWith` that mounts it must not quietly widen into a path with
+   * segments after it. Same rule the health-history and new-session routes state.
+   */
+  it("refuses a path underneath itself rather than serving the feed for it", async () => {
+    const { res, done } = fakeRes();
+    expect(recentFeedRoute(deps).handle(req("/api/feed/../secrets"), res)).toBe(true);
+    const out = await done;
+    expect(out.status).toBe(404);
+  });
+
+  it("serves the feed", async () => {
+    const { res, done } = fakeRes();
+    recentFeedRoute(deps).handle(req("/api/feed?limit=5"), res);
+    const out = await done;
+    expect(out.status).toBe(200);
+    const payload = JSON.parse(out.body.toString()) as { kind: string; limit: number; messages: { text: string }[] };
+    expect(payload.kind).toBe("feed");
+    expect(payload.limit).toBe(5);
+    expect(payload.messages.map((m) => m.text)).toEqual(["hello"]);
+  });
+
+  /**
+   * 266 kB of JSON at N=50, read on a phone over Tailscale, is the number that
+   * put this here. Goes red if the gzip branch is dropped.
+   */
+  it("compresses a large answer when the caller accepts it, and says so", async () => {
+    const many = Array.from({ length: 400 }, (_, i) =>
+      turn(new Date(Date.parse("2026-09-09T00:00:00.000Z") + i * 1000).toISOString(), `message number ${i} `.repeat(20)),
+    );
+    const { res, done } = fakeRes();
+    recentFeedRoute({ ...deps, read: async () => found(many) }).handle(
+      req("/api/feed?limit=200", { "accept-encoding": "gzip, deflate" }),
+      res,
+    );
+    const out = await done;
+    expect(out.headers["content-encoding"]).toBe("gzip");
+    expect(out.headers["vary"]).toBe("accept-encoding");
+    const payload = JSON.parse(gunzipSync(out.body).toString()) as { kind: string; messages: unknown[] };
+    expect(payload.kind).toBe("feed");
+    expect(payload.messages).toHaveLength(200);
+  });
+
+  it("sends plain JSON to a caller that did not offer to accept gzip", async () => {
+    const many = Array.from({ length: 400 }, (_, i) =>
+      turn(new Date(Date.parse("2026-09-09T00:00:00.000Z") + i * 1000).toISOString(), `message number ${i} `.repeat(20)),
+    );
+    const { res, done } = fakeRes();
+    recentFeedRoute({ ...deps, read: async () => found(many) }).handle(req("/api/feed?limit=200"), res);
+    const out = await done;
+    expect(out.headers["content-encoding"]).toBeUndefined();
+    expect(JSON.parse(out.body.toString()).kind).toBe("feed");
+  });
+
+  /**
+   * `readRecentMessages` is built not to reject, so this covers the case where
+   * that is itself wrong. A hung request is indistinguishable from a dead box
+   * on a phone.
+   */
+  it("answers rather than hanging when the read throws", async () => {
+    const { res, done } = fakeRes();
+    recentFeedRoute({
+      ...deps,
+      read: () => Promise.reject(new Error("disk went away")),
+    }).handle(req("/api/feed"), res);
+    const out = await done;
+    expect(out.status).toBe(500);
+    expect(JSON.parse(out.body.toString())).toMatchObject({ kind: "unreadable" });
+  });
+});
diff --git a/tests/fleet-web.test.tsx b/tests/fleet-web.test.tsx
index a0f7688f..b17b0e0f 100644
--- a/tests/fleet-web.test.tsx
+++ b/tests/fleet-web.test.tsx
@@ -1004,7 +1004,12 @@ describe("the bottom bar", () => {
        just as happily before the change. */
     const feed = manualTransport();
     mount(feed.transport);
-    expect(modeButtons().map((b) => b.textContent)).toEqual(["Sessions", "Box health", "Overseer"]);
+    expect(modeButtons().map((b) => b.textContent)).toEqual([
+      "Sessions",
+      "Recent messages",
+      "Box health",
+      "Overseer",
+    ]);
     expect(container.querySelector("header")?.querySelector(".dock-modes")).toBeNull();
   });
 
@@ -1013,12 +1018,13 @@ describe("the bottom bar", () => {
     mount(feed.transport);
 
     const checked = (): (string | null)[] => modeButtons().map((b) => b.getAttribute("aria-checked"));
-    expect(checked()).toEqual(["true", "false", "false"]);
+    expect(checked()).toEqual(["true", "false", "false", "false"]);
 
     const health = modeButtons().find((b) => b.textContent === "Box health");
     act(() => health?.click());
 
-    expect(checked()).toEqual(["false", "true", "false"]);
+    // Box health is the third button now that Recent messages sits second.
+    expect(checked()).toEqual(["false", "false", "true", "false"]);
     // And the class the stylesheet paints, which is what a sighted reader sees.
     expect(modeButtons().filter((b) => b.classList.contains("on")).map((b) => b.textContent)).toEqual([
       "Box health",
@@ -2089,7 +2095,12 @@ describe("master and detail", () => {
 
     // Before: the list, and no detail.
     expect(container.textContent).toContain("the one I tapped");
-    expect(container.textContent).not.toContain("Recent messages");
+    /* **SCOPED TO `main`, BECAUSE THE DOCK NOW SAYS THESE WORDS TOO.** The
+       cross-agent feed's tab is also called "Recent messages", so a whole-page
+       search for that phrase finds the button at the bottom of the screen and
+       this assertion stops meaning "the detail pane is closed". `main` is the
+       panel area; the dock is a `nav` beside it. */
+    expect(container.querySelector("main")?.textContent).not.toContain("Recent messages");
 
     openSession("the one I tapped");
 
diff --git a/tools/fleet/routes-recent-feed.ts b/tools/fleet/routes-recent-feed.ts
new file mode 100644
index 00000000..33c93216
--- /dev/null
+++ b/tools/fleet/routes-recent-feed.ts
@@ -0,0 +1,559 @@
+/**
+ * `GET /api/feed` — the last N messages across every session, newest first.
+ *
+ * Greg, 2026-09-08:
+ *
+ * > add a "Recent messages" tab with a rolling window of the last N messages
+ * > across all agents (making it easy to filter)
+ *
+ * ## THIS FILE PARSES NOTHING
+ *
+ * `tools/fleet/transcript.ts` locates the transcript, walks it backwards inside
+ * a byte budget, classifies the speakers and writes the sentence for every way
+ * it can fail. It is tested and it is not touched here. **This module is a
+ * fan-out, a merge and a trim** — one `readRecentMessages` per row, and then
+ * arithmetic. A second transcript parser is the thing most worth not building.
+ *
+ * ## WHY IT IS A ROUTE MODULE AND NOT LINES IN `server.ts`
+ *
+ * Importing `server.ts` binds port 8787, so anything living there cannot be
+ * driven by a test. Same reason `routes-health-history.ts` is a module, and the
+ * interesting half here — `mergeFeed` — is pure and takes no clock, no socket
+ * and no filesystem.
+ *
+ * ## THE MERGE IS EXACT, AND THAT IS WHAT THE PER-SESSION LIMIT BUYS
+ *
+ * Each session is asked for **its own newest `limit`**, the same number the
+ * reader asked for. Merge, sort descending, take `limit`. That is exactly "the
+ * last N messages across all agents", and the proof is one line: any message
+ * among the true newest N must be among its own session's newest N.
+ *
+ * The tempting cheaper version — ask each session for a small fixed k and merge
+ * — is **wrong in precisely the case this tab exists for.** If one agent has
+ * just written 40 of the last 50 messages on the box, the k=6 version shows six
+ * of them and pads the rest with older messages from quieter sessions, and it
+ * looks entirely normal doing it. Measured, reading more turns per session is
+ * nearly free (limit 6 and limit 12 both read about one 256 kB chunk each), so
+ * there is no reason to be approximate. The numbers are in the plan.
+ *
+ * ## AND WHERE THAT PROOF STOPS BEING TRUE
+ *
+ * It assumes each session really returned its newest `limit`, and a session
+ * whose turns do not fit the byte budget returns fewer. **A short answer and a
+ * quiet agent are the same thing on screen**, which is this feature's
+ * silent-success failure (docs/reusable/silent-success.md). So `complete` is
+ * computed per session, and `mayBeMissing` says which of the incomplete ones
+ * actually cost the feed anything — see `mergeFeed`, which is where the one
+ * piece of arithmetic worth reading lives.
+ *
+ * ## UNTRUSTED, ALL OF IT
+ *
+ * Every string that comes back is agent-authored text from a process that may
+ * have been handling hostile input. Nothing here interprets it and nothing that
+ * renders it may add markup.
+ */
+import type { IncomingMessage, ServerResponse } from "node:http";
+import { gzipSync } from "node:zlib";
+
+import type { FleetRow, FleetSnapshot } from "./collect.js";
+import { readRecentMessages, type RecentMessages, type TranscriptTurn } from "./transcript.js";
+import type {
+  FeedAttribution,
+  FeedCoverage,
+  FeedCoverageReason,
+  FeedMessage,
+  FeedPayload,
+  FeedSession,
+  FeedSessionRead,
+} from "./wire.js";
+
+export const FEED_PATH = "/api/feed";
+
+/** How many messages the feed shows when nobody says. */
+export const DEFAULT_FEED_LIMIT = 50;
+
+/**
+ * The most it will serve.
+ *
+ * Not a security limit — this server has no untrusted caller — but a limit on
+ * how much gets read off disk and serialised because somebody typed a number
+ * into a URL. At 100 per session the fan-out read 13 MB and produced 453 kB of
+ * JSON; 200 is roughly twice that and is the point past which this stops being
+ * a rolling window.
+ */
+export const MAX_FEED_LIMIT = 200;
+
+/** Compress above this. Below it the header costs more than it saves. */
+const GZIP_ABOVE_BYTES = 8 * 1024;
+
+/**
+ * How long a `working` session may write nothing before its attribution is
+ * called into question.
+ *
+ * **THIS IS THE SAME NUMBER AS `STALE_TRANSCRIPT_MS` IN
+ * `web/src/messages-client.ts`, AND THE DUPLICATE IS STRUCTURALLY FORCED.** That
+ * file is compiled under the browser project (`web/tsconfig.json`, DOM libs, no
+ * node types) and this one reaches `node:zlib`; neither can import the other,
+ * and `wire.ts` — the one file both can see — is types only and may hold no
+ * runtime value. So the choice was a third home nobody would find or a stated
+ * copy, and this is the stated copy.
+ *
+ * The reasoning, which lives there: thirty minutes is a trade rather than a
+ * fact. The false alarm to avoid is a genuine long tool call — the full gate on
+ * this box takes 24 minutes and writes nothing to the transcript while it runs
+ * — and the case it exists to catch is a transcript last written *hours* ago
+ * against a row the collector calls `working`. Hours clear thirty minutes
+ * easily. If one moves, move both.
+ */
+export const STALE_TRANSCRIPT_MS = 30 * 60 * 1000;
+
+/**
+ * How many messages the caller asked for, clamped, never NaN.
+ *
+ * Pure and exported so the clamp is testable without a socket. Nonsense falls
+ * back to the default rather than erroring: this is a feed, and refusing to
+ * draw because a query string was odd helps nobody.
+ */
+export function limitFrom(url: string): number {
+  const value = new URL(url, "http://fleet.invalid").searchParams.get("limit");
+  if (value === null) return DEFAULT_FEED_LIMIT;
+  const limit = Number(value);
+  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_FEED_LIMIT;
+  return Math.min(Math.floor(limit), MAX_FEED_LIMIT);
+}
+
+/**
+ * One session's answer, ready to merge.
+ *
+ * The row's own fields rather than the row, so `mergeFeed` can be driven from a
+ * fixture without building a `FleetRow`.
+ */
+export type FeedInput = {
+  sessionId: string;
+  name: string;
+  title: string | null;
+  /** `true` when the collector calls this row `working` — the only status the staleness check applies to. */
+  working: boolean;
+  /**
+   * The conversation uuid this row claims. **Carried so two rows naming the
+   * same one can be spotted** — that would count one conversation's turns
+   * twice, which breaks "each message belongs to exactly one session" and with
+   * it the exactness of the merge.
+   */
+  claudeSessionId: string | null;
+  result: RecentMessages;
+};
+
+/**
+ * **THE GUARD TURN, AND WHY EVERY SESSION IS ASKED FOR ONE MORE THAN IT NEEDS.**
+ *
+ * One API turn is written as up to four JSONL records sharing a `message.id` —
+ * 1497 of 2806 ids in the measured transcript appeared on more than one line —
+ * and `recordsToTurns` coalesces them. So when the byte budget stops the walk
+ * *inside* a shared id, the oldest turn it returns is built from only the
+ * records that happened to fall above the boundary: a real-looking turn with
+ * some of its text and some of its tool calls missing.
+ *
+ * That is invisible to a count. Asking for N and receiving N would say
+ * "complete" while the oldest of those N is a fragment. **So every session is
+ * asked for N+1 and the oldest is discarded whenever the walk did not reach the
+ * start of the file.** The turn below a discarded one is whole by construction:
+ * its records are contiguous and the boundary is below them.
+ *
+ * GPT Sol's P1 on the plan. The cost is one extra turn per session and no
+ * second parser.
+ */
+export const GUARD_TURNS = 1;
+
+/**
+ * What the feed may claim about who said this, today.
+ *
+ * **`verified` is unreachable from here and that is deliberate.** It needs
+ * `FleetRow.execution` (session 260908f-roadmap-exec-identity), which is not on
+ * `dev`. When it lands, this function reads that field and nothing else in the
+ * file moves. An arm nothing can currently produce is better than a `verified`
+ * that quietly means "we did not check".
+ *
+ * **Only `working` rows are checked for staleness**, following
+ * `transcriptAge` in messages-client.ts and for its reason: a session parked on
+ * a dialog writes nothing until somebody answers it, routinely for hours, so
+ * checking those would put the warning on exactly the rows Greg opens this page
+ * to look at — and a warning that is usually wrong is one nobody reads.
+ */
+export function attributionOf(working: boolean, lastModified: string, nowMs: number): FeedAttribution {
+  const claimed: FeedAttribution = {
+    kind: "claimed-only",
+    why: "the conversation id is the one pinned into this pane when it was created, which nothing has confirmed is still the conversation running in it",
+  };
+  if (!working) return claimed;
+  const at = Date.parse(lastModified);
+  if (!Number.isFinite(at)) return claimed;
+  const ms = nowMs - at;
+  if (ms < STALE_TRANSCRIPT_MS) return claimed;
+  const minutes = Math.round(ms / 60_000);
+  return {
+    kind: "suspect",
+    why: `this session is working, but its transcript has not been written to for ${minutes} minutes — the pane may have been re-used for a different conversation, in which case these are somebody else's messages`,
+  };
+}
+
+/**
+ * The turns this session actually contributes, with the guard turn dropped.
+ *
+ * See `GUARD_TURNS`. When the walk reached the start of the file nothing was
+ * cut, so the oldest turn is whole and all of them are kept.
+ */
+export function contributedTurns(r: Extract<RecentMessages, { kind: "found" }>): TranscriptTurn[] {
+  if (r.reachedStartOfFile || r.turns.length === 0) return r.turns;
+  return r.turns.slice(1);
+}
+
+/** One session's read, as the census reports it. `turns` is post-guard. */
+function readOf(input: FeedInput, limit: number): FeedSessionRead {
+  const r = input.result;
+  if (r.kind === "not-found") return { kind: "not-found", reason: r.reason, why: r.why };
+  if (r.kind === "unreadable") return { kind: "unreadable", path: r.path, why: r.why };
+  const turns = contributedTurns(r);
+  return {
+    kind: "read",
+    turns: turns.length,
+    /* Complete means *we got this session's newest `limit`, and the oldest of
+       them is whole*. Either the walk reached byte 0 — so there is provably
+       nothing above — or, after discarding the guard turn, it still has as many
+       as were asked for. Anything else is the byte budget having stopped us
+       early, and the feed must not present that as a quiet agent. */
+    complete: r.reachedStartOfFile || turns.length >= limit,
+    lastModified: r.lastModified,
+    bytesRead: r.bytesRead,
+    fileBytes: r.fileBytes,
+    toolResultsSkipped: r.toolResultsSkipped,
+    copies: r.copies,
+    recordsUnparseable: r.recordsUnparseable,
+  };
+}
+
+/** Epoch ms, or null when the string is absent or not a date. */
+function msOf(at: string | null): number | null {
+  if (at === null) return null;
+  const ms = Date.parse(at);
+  return Number.isFinite(ms) ? ms : null;
+}
+
+/**
+ * The merge. **Pure**: no clock of its own, no filesystem, no socket.
+ *
+ * `nowMs` is passed in rather than read, so the attribution readings are
+ * reproducible in a test.
+ */
+export function mergeFeed(
+  inputs: FeedInput[],
+  limit: number,
+  nowMs: number,
+): {
+  messages: FeedMessage[];
+  undated: FeedMessage[];
+  sessions: FeedSession[];
+  coverage: FeedCoverage;
+} {
+  const sessions: FeedSession[] = [];
+  /* Carried beside each message only until the sort is done. The oldest dated
+     message per session is what decides whether a truncation matters. */
+  const dated: { message: FeedMessage; ms: number; order: number }[] = [];
+  const undated: FeedMessage[] = [];
+  const oldestBySession = new Map<string, number>();
+  const incomplete: { sessionId: string; name: string }[] = [];
+  const reasons: FeedCoverageReason[] = [];
+
+  /* **TWO ROWS NAMING ONE CONVERSATION.** That breaks "each message belongs to
+     exactly one session", so the same turns would be counted twice and the
+     newest N would be padded with duplicates. Detected rather than
+     de-duplicated: which of the two rows is the real one is not this module's
+     to decide, and guessing would hide the fact that something is wrong. */
+  const byConversation = new Map<string, string[]>();
+  for (const input of inputs) {
+    if (input.claudeSessionId === null || input.claudeSessionId === "") continue;
+    const seen = byConversation.get(input.claudeSessionId) ?? [];
+    seen.push(input.sessionId);
+    byConversation.set(input.claudeSessionId, seen);
+  }
+  for (const [conversation, ids] of byConversation) {
+    if (ids.length < 2) continue;
+    for (const sessionId of ids) {
+      reasons.push({
+        sessionId,
+        name: inputs.find((i) => i.sessionId === sessionId)?.name ?? sessionId,
+        kind: "duplicate-conversation",
+        why: `${ids.length} sessions claim the same conversation (${conversation}), so its messages appear more than once and at most one of these rows can be right`,
+      });
+    }
+  }
+
+  let order = 0;
+  for (const input of inputs) {
+    const read = readOf(input, limit);
+    sessions.push({ sessionId: input.sessionId, name: input.name, title: input.title, read });
+
+    if (read.kind === "unreadable") {
+      /* **A SESSION WE COULD NOT READ MAY HOLD ALL OF THE NEWEST MESSAGES.**
+         Showing it as one more row in the census does nothing to stop the list
+         above looking authoritative, which is why this is coverage rather than
+         an advisory line. GPT Sol's P1. */
+      reasons.push({ sessionId: input.sessionId, name: input.name, kind: "unreadable", why: read.why });
+    }
+    if (read.kind === "not-found" && read.reason !== "no-claude-session-id") {
+      /* `no-claude-session-id` is deliberately NOT a coverage failure: it is a
+         shell or a scheduled session whose pane is still running `sleep`, and
+         nine of 21 rows on this box are that. Counting them would make coverage
+         permanently indeterminate, and a warning that is always on is one
+         nobody reads. Every other reason means a conversation was claimed and
+         its transcript could not be found, which really is a hole. */
+      reasons.push({ sessionId: input.sessionId, name: input.name, kind: "no-transcript", why: read.why });
+    }
+
+    if (input.result.kind !== "found") continue;
+    if (read.kind === "read" && !read.complete) {
+      incomplete.push({ sessionId: input.sessionId, name: input.name });
+    }
+    const attribution = attributionOf(input.working, input.result.lastModified, nowMs);
+    /* **AN INVERSION MEANS "NEWEST" IS NOT A TOTAL ORDER HERE.** Zero were
+       observed in 955 sampled turns, but a wall-clock adjustment on the box
+       would produce one, and the global sort would then place this session's
+       messages wrongly against every other session's. */
+    let previousMs: number | null = null;
+    let inverted = false;
+    let hasUndated = false;
+    for (const turn of contributedTurns(input.result)) {
+      const message: FeedMessage = {
+        sessionId: input.sessionId,
+        sessionName: input.name,
+        sessionTitle: input.title,
+        attribution,
+        /* **THE ASSIGNMENT THAT KEEPS `FeedSpeaker` HONEST.** `turn.speaker` is
+           a `TurnSpeaker`; a speaker added to the reader and not to the wire
+           union stops compiling right here. wire.ts § `FeedSpeaker`. */
+        speaker: turn.speaker,
+        at: turn.at,
+        text: turn.text,
+        truncated: turn.truncated,
+        fullChars: turn.fullChars,
+        toolCalls: turn.toolCalls,
+        uuid: turn.uuid,
+      };
+      const ms = msOf(turn.at);
+      if (ms === null) {
+        undated.push(message);
+        hasUndated = true;
+        continue;
+      }
+      if (previousMs !== null && ms < previousMs) inverted = true;
+      previousMs = ms;
+      dated.push({ message, ms, order: order++ });
+      const seen = oldestBySession.get(input.sessionId);
+      if (seen === undefined || ms < seen) oldestBySession.set(input.sessionId, ms);
+    }
+
+    if (inverted) {
+      reasons.push({
+        sessionId: input.sessionId,
+        name: input.name,
+        kind: "out-of-order",
+        why: "this session's own timestamps go backwards, so its messages cannot be ordered against the other sessions' reliably",
+      });
+    }
+    if (hasUndated) {
+      /* **AN UNDATED TURN COSTS MORE THAN ITS OWN PLACE.** It was fetched
+         inside this session's newest N, so it displaced a dated turn that was
+         never fetched at all — and that turn may have belonged in the window.
+         Showing the undated ones in a group below is therefore not enough to
+         keep the dated list exact. GPT Sol's P2. */
+      reasons.push({
+        sessionId: input.sessionId,
+        name: input.name,
+        kind: "undated",
+        why: "some of this session's newest turns carry no timestamp, so they cannot be placed in the ordering and an older dated turn of its own may be missing from the window",
+      });
+    }
+  }
+
+  /* Newest first — the inversion the sibling route does not do, done once here
+     rather than in every client. `order` breaks ties so that two messages
+     written in the same millisecond keep a stable position across refreshes;
+     an unstable sort here would reshuffle the list under the reader's thumb. */
+  dated.sort((a, b) => (b.ms - a.ms !== 0 ? b.ms - a.ms : a.order - b.order));
+  const kept = dated.slice(0, limit);
+  const messages = kept.map((d) => d.message);
+
+  /* **THE CUTOFF, AND WHY IT IS NOT SIMPLY "EVERY INCOMPLETE SESSION".**
+     A session cut short by the byte budget only costs this feed something if it
+     might have had messages INSIDE the window being shown. If its oldest
+     returned message is already older than the oldest message on screen, then
+     everything of its that belongs in this window was read, and naming it would
+     be noise — and a warning that is usually wrong is one nobody reads.
+
+     `null` means nothing was trimmed, so the window reaches back as far as we
+     read and any incompleteness at all is inside it. */
+  const trimmed = dated.length > limit;
+  const cutoffMs = trimmed ? (kept[kept.length - 1]?.ms ?? null) : null;
+  for (const { sessionId, name } of incomplete) {
+    const oldest = oldestBySession.get(sessionId);
+    /* No dated message at all from a session we know was cut short: we cannot
+       place it relative to the cutoff, so we say so rather than assume it falls
+       outside. */
+    const insideWindow = cutoffMs === null || oldest === undefined || oldest > cutoffMs;
+    if (!insideWindow) continue;
+    reasons.push({
+      sessionId,
+      name,
+      kind: "byte-budget",
+      why: "this session's transcript was cut short by the read budget before its newest messages were all reached, so it may have said more inside this window than is shown",
+    });
+  }
+
+  /* **`complete` IS CONSTRUCTIBLE ONLY WHEN NOTHING ABOVE FIRED.** Every reason
+     breaks one of the four premises the exactness proof rests on, so the answer
+     to "is this the last N messages" is yes exactly when there are none. */
+  const coverage: FeedCoverage = reasons.length === 0 ? { kind: "complete" } : { kind: "indeterminate", reasons };
+
+  return { messages, undated: undated.slice(0, limit), sessions, coverage };
+}
+
+export type FeedRouteDeps = {
+  /**
+   * The current snapshot, as a FUNCTION rather than a value: it is replaced
+   * wholesale by each collection, and a route holding the one it was built with
+   * would serve the fleet as it was at startup for ever.
+   */
+  snapshot(): FleetSnapshot | null;
+  /** The server's clock, so the attribution readings are stamped by the process that read the files. */
+  nowMs(): number;
+  /** Injected so a test can drive the whole payload without a filesystem. */
+  read?: (row: FleetRow, limit: number) => Promise<RecentMessages>;
+};
+
+/** The real reader, and the only place this module names the transcript store. */
+function readRow(row: FleetRow, limit: number): Promise<RecentMessages> {
+  return readRecentMessages({
+    claudeSessionId: row.claudeSessionId,
+    dir: row.meta.version === 1 ? row.meta.dir : null,
+    limit,
+  });
+}
+
+/**
+ * Build the payload. Async because it reads, but otherwise the same shape as
+ * `historyPayload`: everything interesting is in `mergeFeed`, which is pure.
+ */
+export async function feedPayload(deps: FeedRouteDeps, limit: number): Promise<FeedPayload> {
+  const snapshot = deps.snapshot();
+  if (snapshot === null) {
+    return {
+      schema: 1,
+      kind: "unreadable",
+      why: "this dashboard has not finished its first collection, so it does not yet know which sessions exist. That is not the same as the box being quiet.",
+    };
+  }
+  const read = deps.read ?? readRow;
+  const nowMs = deps.nowMs();
+  const readStartedAt = new Date(nowMs).toISOString();
+  /* All at once. Measured at 250 ms and ~10 MB of page cache for 21 rows at
+     limit 50, on a box whose transcripts total 65 MB — the byte-bounded reader
+     is what makes that safe, not restraint here. **This is not on the collection
+     loop** and must never be moved onto it: docs/project/overseer-direction.md
+     and the responsive-collection stage of the roadmap both say the collector
+     may not be held by a slow reader.
+
+     `limit + GUARD_TURNS`, never bare `limit` — see `GUARD_TURNS`. */
+  const inputs: FeedInput[] = await Promise.all(
+    snapshot.rows.map(async (row) => ({
+      sessionId: row.id,
+      name: row.name,
+      title: row.title,
+      working: row.status.kind === "working",
+      claudeSessionId: row.claudeSessionId,
+      result: await read(row, limit + GUARD_TURNS),
+    })),
+  );
+  const merged = mergeFeed(inputs, limit, nowMs);
+  const readFinishedAt = new Date(deps.nowMs()).toISOString();
+  return {
+    schema: 1,
+    kind: "feed",
+    limit,
+    messages: merged.messages,
+    undated: merged.undated,
+    sessions: merged.sessions,
+    coverage: merged.coverage,
+    /* The census boundary rather than one instant — see `FeedPayload`. The
+       snapshot was collected up to a minute ago and the files were read over
+       the window below; there is no moment at which this describes the fleet. */
+    collectedAt: snapshot.collectedAt,
+    readStartedAt,
+    readFinishedAt,
+    servedAt: readFinishedAt,
+  };
+}
+
+/**
+ * Mount it. Returns false when the request is not this route's, the same shape
+ * as `healthHistoryRoute().handle` — so `server.ts` keeps holding nothing but
+ * wiring.
+ */
+export function recentFeedRoute(deps: FeedRouteDeps): {
+  handle(req: IncomingMessage, res: ServerResponse): boolean;
+} {
+  return {
+    handle(req, res): boolean {
+      const url = req.url ?? "/";
+      if (!url.startsWith(FEED_PATH)) return false;
+      /* An exact path, so the `startsWith` that mounts it cannot quietly widen
+         into `/api/feed/../something`. Same rule the health-history and
+         new-session routes state. */
+      const path = url.split("?")[0] ?? "";
+      if (path !== FEED_PATH) {
+        res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
+        res.end(JSON.stringify({ schema: 1, kind: "unreadable", why: `no such route: ${path}` }));
+        return true;
+      }
+
+      void feedPayload(deps, limitFrom(url))
+        .then((payload) => {
+          const body = JSON.stringify(payload);
+          const accepts = String(req.headers["accept-encoding"] ?? "").includes("gzip");
+          if (accepts && body.length > GZIP_ABOVE_BYTES) {
+            const packed = gzipSync(body);
+            res.writeHead(200, {
+              "content-type": "application/json",
+              "content-encoding": "gzip",
+              "cache-control": "no-store",
+              /* Anything that caches by URL must know the answer varies by header. */
+              vary: "accept-encoding",
+              "content-length": String(packed.length),
+            });
+            res.end(packed);
+            return;
+          }
+          res.writeHead(200, {
+            "content-type": "application/json",
+            "cache-control": "no-store",
+            vary: "accept-encoding",
+          });
+          res.end(body);
+        })
+        /* `readRecentMessages` is built not to reject — every failure of it is
+           a `kind` — so this is for the case where that is itself wrong.
+           Without it the request hangs until the phone gives up, which is
+           indistinguishable from the box being down. */
+        .catch((err: unknown) => {
+          res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
+          res.end(
+            JSON.stringify({
+              schema: 1,
+              kind: "unreadable",
+              why: `building the feed threw: ${err instanceof Error ? err.message : String(err)}`,
+            }),
+          );
+        });
+      return true;
+    },
+  };
+}
diff --git a/tools/fleet/server.ts b/tools/fleet/server.ts
index d197edbc..4169b109 100644
--- a/tools/fleet/server.ts
+++ b/tools/fleet/server.ts
@@ -43,6 +43,7 @@ import { readCheckpointFeeds } from "./overseer-status.js";
 import { drainSharedQueues, handleActionRequest } from "./routes-actions.js";
 import { nextWaitMs, refreshOnce, singleFlightCollect } from "./refresh.js";
 import { newSessionRoutes } from "./routes-new.js";
+import { recentFeedRoute } from "./routes-recent-feed.js";
 import { renameRoute } from "./routes-rename.js";
 import { handleSteerRequest } from "./routes-steer.js";
 import { handleTranscribeRequest } from "./routes-transcribe.js";
@@ -151,6 +152,14 @@ const retention = makeHealthRetention({
 for (const line of retention.lines.log) console.log(line);
 for (const line of retention.lines.error) console.error(line);
 
+/**
+ * The cross-agent feed. **The snapshot is passed as a function, not a value** —
+ * it is replaced wholesale by every collection, and a route holding the one it
+ * was built with would serve the fleet as it was at startup for ever. Same
+ * reason the actions routes take it that way below.
+ */
+const feedRoute = recentFeedRoute({ snapshot: () => snapshot, nowMs: () => Date.now() });
+
 /**
  * The wire shape, in one place, so the poll and the stream cannot disagree.
  *
@@ -353,6 +362,13 @@ function handler(req: import("node:http").IncomingMessage, res: import("node:htt
   // reads nothing but this process's own append-only file.
   if (retention.route.handle(req, res)) return;
 
+  // The last N messages across EVERY session, for the Recent messages tab.
+  // Read-only, and deliberately not on the collection loop: it is a fan-out of
+  // byte-bounded tail reads (~250 ms and ~10 MB of page cache for the whole
+  // fleet, measured), asked for only when somebody is looking at that tab.
+  // Everything it decides lives in routes-recent-feed.ts.
+  if (feedRoute.handle(req, res)) return;
+
   // Recent messages for one session, for the detail pane.
   //
   // ADDRESSED THROUGH THE CURRENT SNAPSHOT, NOT THROUGH THE QUERY STRING. The
diff --git a/tools/fleet/web/src/App.tsx b/tools/fleet/web/src/App.tsx
index 054054db..f8e0299d 100644
--- a/tools/fleet/web/src/App.tsx
+++ b/tools/fleet/web/src/App.tsx
@@ -20,11 +20,20 @@ import { useMemo, useRef, type ReactNode } from "react";
 
 import { AttentionPanel } from "./AttentionPanel";
 import { Dock } from "./Dock";
+import { FeedPanel } from "./FeedPanel";
 import { Header, SHELL, freshness } from "./Header";
 import { HealthPanel } from "./HealthPanel";
 import { OverseerPanel } from "./OverseerPanel";
 import { SessionsPanel } from "./SessionsPanel";
 import { httpActionsApi, type ActionsApi } from "./actions-client";
+import {
+  FILTER_KEYS,
+  filtersFromParams,
+  httpFeedApi,
+  limitFromParams,
+  paramsFromFilters,
+  type FeedApi,
+} from "./feed-client";
 import { useDockFit } from "./fit";
 import { httpHistoryApi, type HistoryApi } from "./health-history-client";
 import { httpMessagesApi, withClockSkew, type MessagesApi } from "./messages-client";
@@ -48,6 +57,7 @@ export function App({
   actionsApi = httpActionsApi,
   messagesApi = httpMessagesApi,
   historyApi = httpHistoryApi,
+  feedApi = httpFeedApi,
   actionsPollMs,
 }: {
   transport?: Transport;
@@ -69,6 +79,13 @@ export function App({
    * this page measures and the times that chart prints.
    */
   historyApi?: HistoryApi;
+  /**
+   * The cross-agent feed. Injected like the rest, and — like `messagesApi` —
+   * deliberately NOT wrapped in a hook here: it is asked for when the tab is
+   * open rather than polled, so there is no shared feed for this page to hold.
+   * FeedPanel.tsx says why.
+   */
+  feedApi?: FeedApi;
   /** Only a test passes this, to keep a poll off a fake clock. */
   actionsPollMs?: number;
 }): ReactNode {
@@ -188,6 +205,29 @@ export function App({
             />
           </>
         ) : null}
+        {mode === "messages" ? (
+          <div className="tw:mx-auto tw:max-w-3xl">
+            {/* **THE REGISTRATION NOTHING CATCHES.** The four `Record<Mode, …>`
+                maps make a half-added mode a compile error; this arm does not,
+                because it is a ternary rather than an exhaustive switch. A mode
+                registered everywhere but here draws a button, switches the
+                hash, and shows an empty page. `tests/fleet-feed-panel.test.tsx`
+                asserts this tab renders its panel, which is the only thing that
+                would notice. */}
+            <FeedPanel
+              api={feedApi}
+              limit={limitFromParams(params)}
+              onLimit={(next) => setParam(FILTER_KEYS.limit, next === 50 ? null : String(next))}
+              /* The filters live in the hash for the reason the mode does: this
+                 page is reloaded whenever iOS reclaims the tab, and a filter
+                 that resets every time is one nobody sets. */
+              filters={filtersFromParams(params)}
+              onFilters={(next) => {
+                for (const [key, value] of Object.entries(paramsFromFilters(next))) setParam(key, value);
+              }}
+            />
+          </div>
+        ) : null}
         {mode === "health" ? (
           <div className="tw:mx-auto tw:max-w-3xl">
             <HealthPanel
diff --git a/tools/fleet/web/src/Dock.tsx b/tools/fleet/web/src/Dock.tsx
index 68bde6ad..e66bad9b 100644
--- a/tools/fleet/web/src/Dock.tsx
+++ b/tools/fleet/web/src/Dock.tsx
@@ -20,7 +20,7 @@
  * nothing here needs touching — `MODES` in mode.ts is the list, and the bar
  * measures its own fit (fit.ts).
  */
-import { Gauge, ListChecks, Network, RefreshCw, type LucideIcon } from "lucide-react";
+import { Gauge, ListChecks, MessagesSquare, Network, RefreshCw, type LucideIcon } from "lucide-react";
 import type { ReactNode, RefObject } from "react";
 
 import { Tooltip, TooltipGroup, TipCard, type Tip } from "./Tooltip";
@@ -43,6 +43,7 @@ import { cx } from "./ui";
  */
 const MODE_ICONS: Record<Mode, LucideIcon> = {
   sessions: ListChecks,
+  messages: MessagesSquare,
   health: Gauge,
   overseer: Network,
 };
@@ -53,6 +54,16 @@ const MODE_TIPS: Record<Mode, Tip> = {
     what: "Every tmux session on the box, worst first: who needs an answer, then what is moving, then everything quiet.",
     how: "Read off the box about once a minute. Open one to see what it is asking, answer it, or say something to it — the dashboard types at the pane, and checks first that the pane is still the one you were shown.",
   },
+  messages: {
+    head: "Recent messages",
+    what: "The last N messages across every session at once, newest first, filtered by session, speaker or text.",
+    /* **The artefact, not the gesture** — this copy is read on the button, in
+       the panel and by a screen reader, and "pressing this reads every
+       transcript" is false on the surfaces where nothing is being pressed.
+       What it could not have guessed is that the window is a snapshot rather
+       than a live tail, and that it says what it could not read. */
+    how: "A snapshot of the moment it was fetched, not a live tail — and it names the sessions it could not read, so a short list is never mistaken for a quiet fleet.",
+  },
   health: {
     head: "Box health",
     what: "Load, memory, swap and disk, with a verdict over them.",
diff --git a/tools/fleet/web/src/FeedPanel.tsx b/tools/fleet/web/src/FeedPanel.tsx
new file mode 100644
index 00000000..e7b44a9c
--- /dev/null
+++ b/tools/fleet/web/src/FeedPanel.tsx
@@ -0,0 +1,513 @@
+/**
+ * "Recent messages" — the last N messages across every session, newest first.
+ *
+ * **Greg, 2026-09-08:** *"add a 'Recent messages' tab with a rolling window of
+ * the last N messages across all agents (making it easy to filter)"*.
+ *
+ * ## WHAT THIS ANSWERS THAT THE DETAIL PANE DOES NOT
+ *
+ * `RecentMessages.tsx` answers *is this row telling me the truth?* — one
+ * session, chosen by the reader. This answers *what is the fleet saying*,
+ * without picking a row first. Eighteen sessions on the box and no other way to
+ * read across them but eighteen taps.
+ *
+ * ## THE THING THIS PANEL MUST NOT DO
+ *
+ * Show a message under a session's name as though the attribution were settled,
+ * or show a short list as though it were a complete one. **The reader was never
+ * watching these sessions**, so nothing on screen contradicts a wrong answer —
+ * which is the whole reason `attribution` and `mayBeMissing` are on the wire.
+ * Three rules follow, and each has a test:
+ *
+ *  1. A session whose transcript could not be read is **a row saying so**, not
+ *     an absence. Nine of 21 rows on the box are shells and scheduled sessions;
+ *     a feed that omitted them would show a fleet of twelve and look complete.
+ *  2. A `suspect` attribution is drawn **on the message**, not tucked into a
+ *     footnote — it means these may be somebody else's words.
+ *  3. `mayBeMissing` is printed whenever it is non-empty. "The last 50" that is
+ *     quietly the last 50 of what fitted in a byte budget is the failure this
+ *     feature is most exposed to.
+ *
+ * ## NOT POLLED
+ *
+ * A refresh is ~250 ms on the box and 266 kB on the wire at N=50, read on a
+ * phone over Tailscale. Fetched when the tab opens and when the reader asks,
+ * never on a timer — routes-recent-feed.ts § cadence.
+ *
+ * ## UNTRUSTED, ALL OF IT
+ *
+ * Every string drawn here is agent-authored text. React escapes it; nothing
+ * here adds markup. `Turn.tsx` draws the turns and carries the same rule.
+ */
+import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
+
+import { SPEAKERS } from "./Turn";
+import { Explain } from "./Tooltip";
+import {
+  applyFilters,
+  httpFeedApi,
+  type FeedApi,
+  type FeedFilters,
+  type FeedRow,
+  type FeedView,
+} from "./feed-client";
+import type { MessageSpeaker } from "./messages-client";
+import { Button, Card, Mono, SectionHeading, cx } from "./ui";
+
+/** The speakers offered as filter chips, in the order a reader thinks of them. */
+const FILTERABLE: MessageSpeaker[] = [
+  "human",
+  "assistant",
+  "peer",
+  "notification",
+  "compact-summary",
+  "injected",
+  "api-error",
+  "system",
+  "unrecognised",
+];
+
+/* ------------------------------------------------------------------ *
+ * The reading.
+ * ------------------------------------------------------------------ */
+
+export type FeedReading =
+  | { kind: "loading" }
+  | { kind: "ready"; view: FeedView };
+
+/**
+ * Fetch once on mount, and again when asked.
+ *
+ * **A ref guards against a late answer overwriting a newer one.** Two refreshes
+ * in flight can land out of order, and the older one arriving second would put
+ * a stale feed on screen with no way to tell — the same hazard `useRecentMessages`
+ * handles, and it matters more here because there is no per-session identity to
+ * notice the swap.
+ */
+export function useFeed(api: FeedApi, limit: number): { reading: FeedReading; refresh: () => void; busy: boolean } {
+  const [reading, setReading] = useState<FeedReading>({ kind: "loading" });
+  const [busy, setBusy] = useState(false);
+  const generation = useRef(0);
+
+  const load = useCallback(() => {
+    const mine = ++generation.current;
+    setBusy(true);
+    void api.recent(limit).then((view) => {
+      if (mine !== generation.current) return;
+      setReading({ kind: "ready", view });
+      setBusy(false);
+    });
+  }, [api, limit]);
+
+  useEffect(() => {
+    load();
+    /* On unmount, bump the generation so an answer still in flight is ignored
+       rather than setting state on a component that is gone. */
+    return () => {
+      generation.current += 1;
+    };
+  }, [load]);
+
+  return { reading, refresh: load, busy };
+}
+
+/* ------------------------------------------------------------------ *
+ * The parts.
+ * ------------------------------------------------------------------ */
+
+/** A chip that toggles. The whole filter UI is these, because a thumb wants targets. */
+function Chip({
+  on,
+  onClick,
+  children,
+  label,
+}: {
+  on: boolean;
+  onClick: () => void;
+  children: ReactNode;
+  label: string;
+}): ReactNode {
+  return (
+    <button
+      type="button"
+      aria-pressed={on}
+      aria-label={label}
+      onClick={onClick}
+      className={cx(
+        "tw:inline-flex tw:h-7 tw:shrink-0 tw:items-center tw:rounded-full tw:border tw:px-2.5",
+        "tw:text-[12px] tw:whitespace-nowrap tw:transition-colors",
+        on ? "tw:border-work-ink tw:bg-work-wash tw:text-work-ink" : "tw:border-rule tw:text-ink-soft",
+      )}
+    >
+      {children}
+    </button>
+  );
+}
+
+/**
+ * What the feed could not read, and what it may therefore be missing.
+ *
+ * **Drawn above the messages**, because it qualifies every one of them. A note
+ * about completeness underneath a list is a note most people never scroll to.
+ */
+function Caveats({ view }: { view: FeedView & { kind: "feed" } }): ReactNode {
+  const unread = view.sessions.filter((s) => s.read.kind !== "read");
+  const gaps = view.coverage.kind === "indeterminate" ? view.coverage.reasons : [];
+  if (gaps.length === 0 && unread.length === 0 && view.unreadableRows === 0) return null;
+  return (
+    <Card className="tw:mt-2 tw:px-3 tw:py-2">
+      {gaps.length > 0 ? (
+        <>
+          {/* **THE HEADLINE, NOT A FOOTNOTE.** An unreadable session can hold
+              all of the newest messages, so the qualification belongs to the
+              whole list rather than to a row inside it. */}
+          <p className="tw:text-[12px] tw:font-semibold tw:text-alarm-ink">
+            This may not be the last {view.limit ?? "N"} messages.
+          </p>
+          <ul className="tw:mt-1 tw:space-y-0.5">
+            {gaps.map((reason, i) => (
+              // biome-ignore lint/suspicious/noArrayIndexKey: a coverage reason has no id, and this list is rebuilt whole on every fetch — never reordered or filtered — so the index is a stable identity within one answer.
+              <li key={`${reason.sessionId}-${reason.kind}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
+                {reason.name === "" ? null : <Mono>{reason.name}</Mono>}
+                <span className={reason.name === "" ? "" : "tw:pl-2"}>{reason.why}</span>
+              </li>
+            ))}
+          </ul>
+        </>
+      ) : null}
+      {view.unreadableRows > 0 ? (
+        <p className="tw:mt-1 tw:text-[12px] tw:text-alarm-ink">
+          {view.unreadableRows} {view.unreadableRows === 1 ? "message" : "messages"} in this answer could not be read by
+          this page and {view.unreadableRows === 1 ? "is" : "are"} not shown.
+        </p>
+      ) : null}
+      {unread.length > 0 ? (
+        <details className="tw:mt-1">
+          <summary className="tw:cursor-pointer tw:text-[12px] tw:text-ink-faint">
+            {unread.length} of {view.sessions.length} sessions had no readable transcript
+          </summary>
+          <ul className="tw:mt-1 tw:space-y-1">
+            {unread.map((s) => (
+              <li key={s.sessionId} className="tw:text-[12px] tw:text-ink-soft">
+                <Mono>{s.name}</Mono>
+                <span className="tw:pl-2 tw:text-ink-faint">
+                  {s.read.kind === "not-found" ? s.read.why : s.read.kind === "unreadable" ? s.read.why : ""}
+                </span>
+              </li>
+            ))}
+          </ul>
+        </details>
+      ) : null}
+    </Card>
+  );
+}
+
+const ATTRIBUTION_TIP = {
+  head: "Whose words are these?",
+  what: "Which session the dashboard read this message from, and how sure it is that the session is still that conversation.",
+  how: "A pane's conversation id is pinned when the pane is made and never updated, so a re-used pane reads the previous conversation — real messages, correctly attributed, and not this agent's.",
+};
+
+/**
+ * The first line of a message, and whether there is more.
+ *
+ * A line rather than a character count: the feed is scanned, and the first line
+ * of an agent's turn is almost always the sentence that says what it is doing.
+ */
+export function firstLine(text: string): { head: string; rest: boolean } {
+  const cut = text.indexOf("\n");
+  if (cut === -1) return { head: text, rest: false };
+  return { head: text.slice(0, cut), rest: text.slice(cut + 1).trim() !== "" };
+}
+
+/**
+ * One row: the session it came from, then the message, collapsed to its first
+ * line until it is opened.
+ *
+ * **This does NOT reuse `Turn` from Turn.tsx, and that is deliberate.** The two
+ * surfaces want different bodies — the detail pane shows a whole turn at its
+ * absolute timestamp, and this shows a first line with provenance and an
+ * attribution reading beside it. Passing a `collapsed` prop into one component
+ * to serve both would be the conditional-prop component GPT Sol warned about
+ * (P2.4), harder to read than two small bodies.
+ *
+ * **What IS shared is `SPEAKERS`**, which is the part that matters: a nine-arm
+ * map in which `compact-summary` and `injected` are machine-written text
+ * wearing a person's role. A second copy of *that* is how a fabricated recap
+ * ends up on screen as something a person said — the argument
+ * `dashboard-titles-descriptions-detail` made when it asked for the extraction,
+ * and it is fully satisfied by sharing the map.
+ */
+function Row({ row }: { row: FeedRow }): ReactNode {
+  const [open, setOpen] = useState(false);
+  const who = SPEAKERS[row.turn.speaker];
+  const { head, rest } = firstLine(row.turn.text);
+  return (
+    <li className="tw:border-t tw:border-rule tw:py-2 tw:first:border-t-0">
+      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-[11px]">
+        <Mono>{row.sessionName}</Mono>
+        <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
+        {row.turn.at === null ? null : <span className="tw:text-ink-faint">{row.turn.at}</span>}
+        {row.attribution.kind === "suspect" ? (
+          <Explain tip={{ ...ATTRIBUTION_TIP, how: row.attribution.why }} placement="bottom">
+            <span className="tw:font-semibold tw:text-alarm-ink">may not be this session</span>
+          </Explain>
+        ) : null}
+      </p>
+      {who.note === null ? null : <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">{who.note}</p>}
+
+      {row.turn.text === "" ? (
+        /* A turn with no words and some tool calls is a REAL state, not a
+           missing one. Drawing nothing would look like a row that failed. */
+        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint tw:italic">
+          {row.turn.toolCalls.length > 0
+            ? "No words in this turn — it only called tools."
+            : "No words and no tool calls in this turn."}
+        </p>
+      ) : (
+        /* Untrusted text. `whitespace-pre-wrap` keeps the agent's own line
+           breaks without anything interpreting them. */
+        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">
+          {open ? row.turn.text : head}
+        </p>
+      )}
+
+      {rest && !open ? (
+        <button
+          type="button"
+          onClick={() => setOpen(true)}
+          className="tw:mt-0.5 tw:text-[11px] tw:text-work-ink tw:underline"
+        >
+          Show the rest of this message
+        </button>
+      ) : null}
+      {open && rest ? (
+        <button
+          type="button"
+          onClick={() => setOpen(false)}
+          className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint tw:underline"
+        >
+          Collapse
+        </button>
+      ) : null}
+
+      {/* **THE "CUT SHORT" DISCLOSURE SURVIVES EXPANDING.** Opening a message
+          shows everything the SERVER sent, which is not everything the agent
+          said — the reader caps a turn at 2,000 characters. Dropping this line
+          on expand would turn "here is more" into "here is all of it". */}
+      {row.turn.truncated ? (
+        <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
+          Cut short by the reader
+          {row.turn.fullChars === null ? "" : ` — ${row.turn.fullChars.toLocaleString()} characters in full`}, so
+          expanding it does not show the whole message.
+        </p>
+      ) : null}
+
+      {row.turn.toolCalls.length === 0 ? null : (
+        <ul className="tw:mt-1 tw:space-y-0.5">
+          {row.turn.toolCalls.map((call, i) => (
+            // biome-ignore lint/suspicious/noArrayIndexKey: a turn's tool calls have no id of their own, and this list is fixed for the life of the turn — never reordered, appended to or filtered — so the index IS a stable identity here.
+            <li key={`${call.name}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
+              <Mono>{call.name}</Mono>
+              {call.detail === null ? null : <span className="tw:pl-2 tw:break-all tw:text-ink-faint">{call.detail}</span>}
+            </li>
+          ))}
+        </ul>
+      )}
+    </li>
+  );
+}
+
+/* ------------------------------------------------------------------ *
+ * The panel.
+ * ------------------------------------------------------------------ */
+
+export function FeedPanel({
+  api = httpFeedApi,
+  limit,
+  onLimit,
+  filters,
+  onFilters,
+}: {
+  api?: FeedApi;
+  limit: number;
+  onLimit: (limit: number) => void;
+  /** Held in the URL hash by App.tsx, so a filtered view survives a reload. */
+  filters: FeedFilters;
+  onFilters: (next: FeedFilters) => void;
+}): ReactNode {
+  const { reading, refresh, busy } = useFeed(api, limit);
+
+  const view = reading.kind === "ready" ? reading.view : null;
+  const rows = view?.kind === "feed" ? view.messages : [];
+  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);
+
+  /* The sessions offered in the picker are the ones actually PRESENT in this
+     window, not every session on the box: a filter chip that can only ever
+     produce an empty list is a control that lies about what it does. */
+  const present = useMemo(() => {
+    const seen = new Map<string, string>();
+    for (const row of rows) if (!seen.has(row.sessionId)) seen.set(row.sessionId, row.sessionName);
+    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
+  }, [rows]);
+
+  const toggle = <T,>(list: T[], value: T): T[] =>
+    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
+
+  return (
+    <div>
+      <SectionHeading>
+        Recent messages{" "}
+        <Explain
+          tip={{
+            head: "Recent messages",
+            what: "The last N messages across every session on the box, newest first.",
+            how: "Read on demand rather than on the refresh loop — it reads the tail of every transcript, so it is asked for only when you are looking at it.",
+          }}
+        >
+          <span aria-hidden="true">?</span>
+        </Explain>
+      </SectionHeading>
+
+      {/* The controls. One row that wraps, because this is read one-handed. */}
+      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
+        <input
+          type="search"
+          value={filters.text}
+          onChange={(e) => onFilters({ ...filters, text: e.target.value })}
+          placeholder="Filter by text or session"
+          aria-label="Filter messages by text"
+          className="tw:h-7 tw:min-w-40 tw:flex-1 tw:rounded-md tw:border tw:border-rule tw:bg-page tw:px-2 tw:text-[12px]"
+        />
+        <Chip
+          on={filters.hideToolCalls}
+          onClick={() => onFilters({ ...filters, hideToolCalls: !filters.hideToolCalls })}
+          label="Hide turns that only called tools"
+        >
+          Hide tool calls
+        </Chip>
+        <Button onClick={refresh} disabled={busy} aria-label="Read the transcripts again">
+          {busy ? "Reading…" : "Read again"}
+        </Button>
+        <label className="tw:flex tw:items-center tw:gap-1 tw:text-[12px] tw:text-ink-faint">
+          Last
+          <select
+            value={String(limit)}
+            onChange={(e) => onLimit(Number(e.target.value))}
+            aria-label="How many messages to show"
+            className="tw:h-7 tw:rounded-md tw:border tw:border-rule tw:bg-page tw:px-1 tw:text-[12px]"
+          >
+            {[25, 50, 100, 200].map((n) => (
+              <option key={n} value={n}>
+                {n}
+              </option>
+            ))}
+          </select>
+        </label>
+      </div>
+
+      {/* Speaker chips. */}
+      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1.5">
+        {FILTERABLE.map((s) => (
+          <Chip
+            key={s}
+            on={filters.speakers.includes(s)}
+            onClick={() => onFilters({ ...filters, speakers: toggle(filters.speakers, s) })}
+            label={`Show only ${SPEAKERS[s].label}`}
+          >
+            {SPEAKERS[s].label}
+          </Chip>
+        ))}
+      </div>
+
+      {/* Session chips, from the sessions present in this window. */}
+      {present.length > 0 ? (
+        <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:gap-1.5">
+          {present.map((s) => (
+            <Chip
+              key={s.id}
+              on={filters.sessions.includes(s.id)}
+              onClick={() => onFilters({ ...filters, sessions: toggle(filters.sessions, s.id) })}
+              label={`Show only ${s.name}`}
+            >
+              {s.name}
+            </Chip>
+          ))}
+        </div>
+      ) : null}
+
+      {reading.kind === "loading" ? (
+        <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">Reading every session's transcript…</p>
+      ) : null}
+
+      {view?.kind === "unreadable" ? (
+        <Card className="tw:mt-3 tw:px-3 tw:py-2">
+          <p className="tw:text-[13px] tw:text-alarm-ink">The dashboard could not build this feed.</p>
+          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
+        </Card>
+      ) : null}
+
+      {view?.kind === "no-answer" ? (
+        <Card className="tw:mt-3 tw:px-3 tw:py-2">
+          <p className="tw:text-[13px] tw:text-alarm-ink">This page did not get an answer it could read.</p>
+          <p className="tw:mt-1 tw:text-[12px] tw:text-ink-soft">{view.why}</p>
+        </Card>
+      ) : null}
+
+      {view?.kind === "feed" ? (
+        <>
+          <Caveats view={view} />
+          {shown.length === 0 ? (
+            /* **TWO DIFFERENT EMPTINESSES, AND THEY MUST NOT READ THE SAME.**
+               "Your filters match nothing" is the reader's own doing; "no
+               session on this box has said anything" is a claim about the
+               fleet, and it is nearly always the wrong one to make. */
+            <p className="tw:mt-3 tw:text-[13px] tw:text-ink-faint">
+              {rows.length === 0
+                ? "No session in this window has a readable message. That is a claim about the transcripts, not about whether the agents are working — see the sessions above."
+                : `None of the ${rows.length} messages in this window match these filters.`}
+            </p>
+          ) : (
+            <ul className="tw:mt-2">
+              {shown.map((row) => (
+                <Row key={row.turn.uuid ?? `${row.sessionId}-${row.turn.at}-${row.turn.text.slice(0, 24)}`} row={row} />
+              ))}
+            </ul>
+          )}
+
+          {view.undated.length > 0 ? (
+            <>
+              <SectionHeading>Undated</SectionHeading>
+              <p className="tw:px-1 tw:text-[12px] tw:text-ink-faint">
+                These carried no timestamp, so they cannot be placed in the ordering above. They are shown rather than
+                dropped.
+              </p>
+              <ul className="tw:mt-2">
+                {view.undated.map((row) => (
+                  <Row key={row.turn.uuid ?? `${row.sessionId}-undated-${row.turn.text.slice(0, 24)}`} row={row} />
+                ))}
+              </ul>
+            </>
+          ) : null}
+
+          <p className="tw:mt-3 tw:px-1 tw:text-[11px] tw:text-ink-faint">
+            {shown.length === rows.length ? `${rows.length} messages` : `${shown.length} of ${rows.length} messages`}
+            {view.sessionsOffered ? ` across ${view.sessions.length} sessions` : ""}
+          </p>
+          {/* **THE CENSUS BOUNDARY, SAID OUT LOUD.** There is no instant at
+              which this describes the fleet: the roster is up to a minute old
+              and the transcripts were read over a window after it. A single
+              "as of" time would imply a snapshot that never existed. */}
+          {view.collectedAt === null && view.readFinishedAt === null ? null : (
+            <p className="tw:px-1 tw:text-[11px] tw:text-ink-faint">
+              Sessions as listed at {view.collectedAt ?? "an unstated time"}; transcripts read
+              {view.readStartedAt === null ? "" : ` from ${view.readStartedAt}`}
+              {view.readFinishedAt === null ? "" : ` to ${view.readFinishedAt}`}. A session started after the first of
+              those is not in this list at all.
+            </p>
+          )}
+        </>
+      ) : null}
+    </div>
+  );
+}
diff --git a/tools/fleet/web/src/Turn.tsx b/tools/fleet/web/src/Turn.tsx
new file mode 100644
index 00000000..a28234d2
--- /dev/null
+++ b/tools/fleet/web/src/Turn.tsx
@@ -0,0 +1,120 @@
+/**
+ * One turn of a conversation, and the nine ways of naming who said it.
+ *
+ * ## WHY THIS IS ITS OWN FILE
+ *
+ * It was `Turn` and `SPEAKERS` inside `RecentMessages.tsx`, which draws one
+ * session's tail in the detail pane. The "Recent messages" tab needs the same
+ * thing across every session, and the session that owns `RecentMessages.tsx`
+ * asked for the extraction rather than a second copy — **on a correctness
+ * argument rather than a tidiness one**, which is worth keeping:
+ *
+ * > `Turn` is small but it renders `SPEAKERS`, a nine-arm map over
+ * > `MessageSpeaker`, and two of those arms are traps: `compact-summary` and
+ * > `injected`. […] a second renderer that collapses those into `human`, or
+ * > that quietly falls through on an arm it does not know, shows a fabricated
+ * > recap as something a person said. That is exactly the class of bug your tab
+ * > would be worst placed to notice, because you are showing turns from
+ * > sessions the reader was not watching and has no independent sense of.
+ * >
+ * > — session `dashboard-titles-descriptions-detail`, 2026-09-09
+ *
+ * Duplicating the markup is cheap. Duplicating a nine-arm discrimination and
+ * its two landmines is not.
+ *
+ * ## UNTRUSTED, ALL OF IT
+ *
+ * Every string here is agent-authored text from a process that may have been
+ * handling hostile input. React escapes it and nothing here adds markup: no
+ * raw-HTML escape hatch, no markdown renderer, no linkifier. A test in
+ * tests/fleet-web.test.tsx globs this directory for the raw-HTML prop name, so
+ * the rule is enforced rather than remembered.
+ *
+ * And one thing that is untrusted in a subtler way: **an unfamiliar speaker is
+ * drawn as unfamiliar.** transcript.ts calls a `compact-summary` *"the single
+ * most convincing wrong answer this module could give"* — machine-written text
+ * wearing `role: "user"`. Rounding a speaker this build cannot name to "the
+ * agent" would misattribute a message, so it is labelled as unknown instead.
+ */
+import type { ReactNode } from "react";
+
+import type { MessageSpeaker, MessageTurn } from "./messages-client";
+import { Mono, cx } from "./ui";
+
+/**
+ * How each speaker is named, and which of them need a warning beside the name.
+ *
+ * `note` is non-null only for the ones a reader would otherwise get wrong.
+ * `human` has one because a steer sent from THIS PAGE lands here too and is
+ * indistinguishable from Greg at the keyboard by anything in the transcript —
+ * transcript.ts refuses to guess and so does this.
+ */
+export const SPEAKERS: Record<MessageSpeaker, { label: string; note: string | null; tone: string }> = {
+  human: {
+    label: "typed at the pane",
+    note: "a person, or a steering message sent from this page — the transcript cannot tell them apart",
+    tone: "tw:text-needs-ink",
+  },
+  assistant: { label: "the agent", note: null, tone: "tw:text-work-ink" },
+  peer: { label: "another agent", note: "over the peer socket, not a person", tone: "tw:text-work-ink" },
+  notification: { label: "machinery", note: "a subagent finishing, or an auto-continuation", tone: "tw:text-ink-faint" },
+  "compact-summary": {
+    label: "a compaction summary",
+    note: "written by Claude Code when the conversation ran out of context, and it wears a person's role — nobody said this",
+    tone: "tw:text-unknown-ink",
+  },
+  injected: {
+    label: "an injected reminder",
+    note: "machinery wearing a person's role — nobody typed this",
+    tone: "tw:text-unknown-ink",
+  },
+  "api-error": { label: "an API error", note: null, tone: "tw:text-alarm-ink" },
+  system: { label: "Claude Code itself", note: null, tone: "tw:text-ink-faint" },
+  unrecognised: {
+    label: "an unknown speaker",
+    note: "this build does not know this kind of turn, so it will not say who said it",
+    tone: "tw:text-unknown-ink",
+  },
+};
+
+/** One turn. Text and tool calls, and neither is markup. */
+export function Turn({ turn }: { turn: MessageTurn }): ReactNode {
+  const who = SPEAKERS[turn.speaker];
+  return (
+    <li className="transcript-turn tw:border-t tw:border-rule tw:py-2 tw:first:border-t-0">
+      <p className="tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-2 tw:text-[11px]">
+        <span className={cx("tw:font-semibold tw:tracking-wide tw:uppercase", who.tone)}>{who.label}</span>
+        {turn.at === null ? null : <span className="tw:text-ink-faint">{turn.at}</span>}
+      </p>
+      {who.note === null ? null : <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">{who.note}</p>}
+      {turn.text === "" ? (
+        /* An assistant turn with no words and some tool calls is a REAL state,
+           not a missing one — transcript.ts says so. Drawing nothing here would
+           make it look like a turn that failed to load. */
+        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-faint tw:italic">
+          {turn.toolCalls.length > 0 ? "No words in this turn — it only called tools." : "No words and no tool calls in this turn."}
+        </p>
+      ) : (
+        /* Untrusted text. `whitespace-pre-wrap` keeps the agent's own line
+           breaks without anything interpreting them. */
+        <p className="tw:mt-1 tw:text-[13px] tw:break-words tw:whitespace-pre-wrap tw:text-ink">{turn.text}</p>
+      )}
+      {turn.truncated ? (
+        <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
+          Cut short{turn.fullChars === null ? "" : ` — ${turn.fullChars.toLocaleString()} characters in full`}.
+        </p>
+      ) : null}
+      {turn.toolCalls.length === 0 ? null : (
+        <ul className="tw:mt-1 tw:space-y-0.5">
+          {turn.toolCalls.map((call, i) => (
+            // biome-ignore lint/suspicious/noArrayIndexKey: a turn's tool calls have no id of their own, and this list is fixed for the life of the turn — never reordered, appended to or filtered — so the index IS a stable identity here. Two calls to the same tool with the same detail are otherwise indistinguishable.
+            <li key={`${call.name}-${i}`} className="tw:text-[12px] tw:text-ink-soft">
+              <Mono>{call.name}</Mono>
+              {call.detail === null ? null : <span className="tw:pl-2 tw:break-all tw:text-ink-faint">{call.detail}</span>}
+            </li>
+          ))}
+        </ul>
+      )}
+    </li>
+  );
+}
diff --git a/tools/fleet/web/src/feed-client.ts b/tools/fleet/web/src/feed-client.ts
new file mode 100644
index 00000000..6ef6668c
--- /dev/null
+++ b/tools/fleet/web/src/feed-client.ts
@@ -0,0 +1,555 @@
+/**
+ * The cross-agent feed — `GET /api/feed`.
+ *
+ * ## THE SAME DISCIPLINE AS `messages-client.ts`, AND FOR A SHARPER REASON
+ *
+ * That file's header is the argument and it is not repeated here. The short
+ * version: every scalar off the wire is `X | null` where null means *the server
+ * did not say*, because a `0` invented for a missing count is a positive claim
+ * that nothing was skipped; and the server's three arms come across intact with
+ * a fourth of this client's own, `no-answer`, for *this page never got an answer
+ * it could read* — the browser's own network trouble must not appear on screen
+ * in the server's voice.
+ *
+ * What is sharper here is the consequence of getting it wrong. The detail pane
+ * shows one session, chosen by the reader, who usually knows what it was doing.
+ * **This feed shows sessions the reader was never watching**, so a message that
+ * is misattributed, or a session quietly missing from the list, has nothing on
+ * screen to contradict it. Hence `attribution` on every message and
+ * `mayBeMissing` on the payload, and hence neither of them has a default.
+ *
+ * ## NEWEST FIRST, AND THE SERVER ALREADY DID IT
+ *
+ * `/api/messages` returns turns newest LAST; this route returns them newest
+ * FIRST. The inversion lives in `routes-recent-feed.ts` so it has one home and
+ * one test. **Nothing here re-sorts**, and a client that "helpfully" sorted
+ * again would be a second opinion about ordering with nothing keeping the two
+ * in step.
+ *
+ * ## Untrusted, all of it
+ *
+ * Every string in a message is agent-authored text from a process that may have
+ * been handling hostile input. Nothing here interprets it, and nothing that
+ * renders it may add markup.
+ */
+import type {
+  FeedAttribution,
+  FeedCoverage,
+  FeedCoverageReason,
+  FeedMessage,
+  FeedSessionRead,
+} from "../../wire.js";
+import type { MessageSpeaker, MessageTurn } from "./messages-client";
+
+export const FEED_URL = "api/feed";
+
+/** Where to ask. The only thing the URL carries is a number. */
+export function feedUrl(limit: number): string {
+  return `${FEED_URL}?limit=${encodeURIComponent(String(limit))}`;
+}
+
+/**
+ * The speakers this build knows, for rounding an unfamiliar one.
+ *
+ * Deliberately the same list as `messages-client.ts` holds, because it is the
+ * same question — and `Turn.tsx`'s `SPEAKERS` map is keyed by `MessageSpeaker`,
+ * so a speaker that did not round to one of these could not be drawn at all.
+ */
+const SPEAKERS: readonly string[] = [
+  "human",
+  "assistant",
+  "peer",
+  "notification",
+  "compact-summary",
+  "injected",
+  "api-error",
+  "system",
+];
+
+/**
+ * One message: a turn, plus which session it was read for and how much we may
+ * claim about that.
+ *
+ * `turn` is a `MessageTurn` so that `Turn.tsx` can draw it unchanged — the same
+ * nine-arm speaker discrimination, with its two landmines, in one place.
+ */
+export type FeedRow = {
+  sessionId: string;
+  sessionName: string;
+  sessionTitle: string | null;
+  attribution: FeedAttribution;
+  turn: MessageTurn;
+};
+
+/** One session in the feed's census of the fleet, readable or not. */
+export type FeedSessionView = {
+  sessionId: string;
+  name: string;
+  title: string | null;
+  read: FeedSessionRead;
+};
+
+export type FeedView =
+  | {
+      kind: "feed";
+      /** What the server actually served, after its own clamp — not what we asked for. */
+      limit: number | null;
+      /** **Newest first**, as the server sent them. Never re-sorted here. */
+      messages: FeedRow[];
+      /** Messages with no placeable timestamp. Never dropped, never interleaved. */
+      undated: FeedRow[];
+      sessions: FeedSessionView[];
+      /**
+       * Whether there was a `sessions` array at all. An empty census and a
+       * server that sent no census are opposite claims, and only one of them
+       * means "no sessions on the box".
+       */
+      sessionsOffered: boolean;
+      /** Entries this page could not read. Counted, never silently dropped. */
+      unreadableRows: number;
+      /**
+       * Whether this really is the last N messages. **The panel may not draw
+       * the list without meeting this**, and a server that did not send it is
+       * `indeterminate` with a reason saying so — never `complete`, which is a
+       * claim only the server is in a position to make.
+       */
+      coverage: FeedCoverage;
+      collectedAt: string | null;
+      readStartedAt: string | null;
+      readFinishedAt: string | null;
+      servedAt: string | null;
+    }
+  | { kind: "unreadable"; why: string }
+  /** This page never got an answer it could read. **Our sentence, not the server's.** */
+  | { kind: "no-answer"; why: string };
+
+function isRecord(v: unknown): v is Record<string, unknown> {
+  return typeof v === "object" && v !== null && !Array.isArray(v);
+}
+
+function str(v: unknown): string | null {
+  return typeof v === "string" && v !== "" ? v : null;
+}
+
+function num(v: unknown): number | null {
+  return typeof v === "number" && Number.isFinite(v) ? v : null;
+}
+
+function speakerOf(v: unknown): MessageSpeaker {
+  return typeof v === "string" && SPEAKERS.includes(v) ? (v as MessageSpeaker) : "unrecognised";
+}
+
+function parseToolCalls(v: unknown): { name: string; detail: string | null }[] {
+  if (!Array.isArray(v)) return [];
+  const out: { name: string; detail: string | null }[] = [];
+  for (const call of v) {
+    if (!isRecord(call)) continue;
+    const name = str(call["name"]);
+    if (name === null) continue;
+    out.push({ name, detail: str(call["detail"]) });
+  }
+  return out;
+}
+
+/**
+ * How much the server said it may claim about who said this.
+ *
+ * **An unrecognised arm becomes `claimed-only`, never `verified`.** Same
+ * discipline as rounding an unknown speaker to `unrecognised`: the failure to
+ * avoid is inventing confidence. A build that meets a `verified` it does not
+ * understand should under-claim, not over-claim.
+ */
+function parseAttribution(v: unknown): FeedAttribution {
+  const fallback: FeedAttribution = {
+    kind: "claimed-only",
+    why: "the dashboard did not say how much it could verify about this message's session, so this page will not claim it was checked",
+  };
+  if (!isRecord(v)) return fallback;
+  const kind = v["kind"];
+  if (kind === "verified") return { kind: "verified" };
+  const why = str(v["why"]);
+  if (kind === "suspect") {
+    return { kind: "suspect", why: why ?? "the dashboard flagged this session's transcript and did not say why" };
+  }
+  if (kind === "claimed-only") return { kind: "claimed-only", why: why ?? fallback.why };
+  return fallback;
+}
+
+/**
+ * One row, or null when it is not an object at all.
+ *
+ * `text` defaults to `""`, which is a REAL turn rather than a broken one — an
+ * agent turn that only called tools has exactly that. A row dropped for want of
+ * a string would be an agent that appeared to sit silent.
+ */
+function parseRow(v: unknown): FeedRow | null {
+  if (!isRecord(v)) return null;
+  const sessionId = str(v["sessionId"]);
+  /* **THE ONE FIELD WITH NO HONEST DEFAULT.** Every other gap can be drawn as
+     "the server did not say"; a message with no session is a message this feed
+     cannot attribute at all, and putting it on screen under a blank name is the
+     misattribution the whole payload is shaped to prevent. */
+  if (sessionId === null) return null;
+  const turn: MessageTurn = {
+    speaker: speakerOf(v["speaker"]),
+    /* The server's own string, on the box's clock, NOT shifted — the same rule
+       as `MessageTurn.at` in messages-client.ts, and for the same reason:
+       shifting it would assert an absolute instant nothing happened at. */
+    at: str(v["at"]),
+    text: typeof v["text"] === "string" ? v["text"] : "",
+    truncated: v["truncated"] === true,
+    fullChars: num(v["fullChars"]),
+    toolCalls: parseToolCalls(v["toolCalls"]),
+    uuid: str(v["uuid"]),
+  };
+  return {
+    sessionId,
+    sessionName: str(v["sessionName"]) ?? sessionId,
+    sessionTitle: str(v["sessionTitle"]),
+    attribution: parseAttribution(v["attribution"]),
+    turn,
+  };
+}
+
+function parseRows(v: unknown): { rows: FeedRow[]; unreadable: number } {
+  if (!Array.isArray(v)) return { rows: [], unreadable: 0 };
+  const rows: FeedRow[] = [];
+  let unreadable = 0;
+  for (const item of v) {
+    const row = parseRow(item);
+    if (row === null) unreadable += 1;
+    else rows.push(row);
+  }
+  return { rows, unreadable };
+}
+
+/**
+ * One session's read. An arm this build does not know becomes `unreadable` with
+ * a sentence saying so — **never a `read` with zero turns**, which would claim
+ * we looked and the session was quiet.
+ */
+function parseRead(v: unknown): FeedSessionRead {
+  if (!isRecord(v)) {
+    return { kind: "unreadable", path: null, why: "the dashboard did not say what happened when it read this session" };
+  }
+  const kind = v["kind"];
+  if (kind === "not-found") {
+    return {
+      kind: "not-found",
+      reason: str(v["reason"]) ?? "unstated",
+      why: str(v["why"]) ?? "the dashboard said there is no transcript for this session and did not say why",
+    };
+  }
+  if (kind === "read") {
+    return {
+      kind: "read",
+      turns: num(v["turns"]) ?? 0,
+      /* **DEFAULTS TO FALSE, WHICH IS THE UNDER-CLAIM.** `complete` is a
+         positive assertion that this session's newest turns were all read; a
+         server that did not say has not made it, and inventing `true` would
+         silence the one warning that stops a truncated session reading as a
+         quiet one. */
+      complete: v["complete"] === true,
+      lastModified: str(v["lastModified"]) ?? "",
+      bytesRead: num(v["bytesRead"]) ?? 0,
+      fileBytes: num(v["fileBytes"]) ?? 0,
+      toolResultsSkipped: num(v["toolResultsSkipped"]) ?? 0,
+      /* Both default to the value that raises no alarm, because a server that
+         did not send them has made no claim and this page must not invent one
+         in the alarming direction either. `copies` of 1 and 0 unparseable lines
+         are the ordinary case. */
+      copies: num(v["copies"]) ?? 1,
+      recordsUnparseable: num(v["recordsUnparseable"]) ?? 0,
+    };
+  }
+  if (kind === "unreadable") {
+    return {
+      kind: "unreadable",
+      path: str(v["path"]),
+      why: str(v["why"]) ?? "the dashboard said it could not read this session's transcript and did not say why",
+    };
+  }
+  return {
+    kind: "unreadable",
+    path: null,
+    why: "this build does not understand what the dashboard said about reading this session",
+  };
+}
+
+function parseSessions(v: unknown): FeedSessionView[] {
+  if (!Array.isArray(v)) return [];
+  const out: FeedSessionView[] = [];
+  for (const item of v) {
+    if (!isRecord(item)) continue;
+    const sessionId = str(item["sessionId"]);
+    if (sessionId === null) continue;
+    out.push({
+      sessionId,
+      name: str(item["name"]) ?? sessionId,
+      title: str(item["title"]),
+      read: parseRead(item["read"]),
+    });
+  }
+  return out;
+}
+
+const COVERAGE_KINDS: readonly string[] = [
+  "byte-budget",
+  "unreadable",
+  "no-transcript",
+  "undated",
+  "out-of-order",
+  "duplicate-conversation",
+];
+
+/**
+ * Whether the server was able to claim this really is the last N messages.
+ *
+ * **A MISSING OR UNRECOGNISED ANSWER IS `indeterminate`, NEVER `complete`.**
+ * This is the one field where the under-claim and the over-claim are not
+ * symmetric: `complete` is a positive assertion that four premises held, and a
+ * build that met an arm it did not understand and rounded it to `complete`
+ * would put a confident "the last 50 messages" over a feed with a hole in it.
+ */
+function parseCoverage(v: unknown): FeedCoverage {
+  const unknown: FeedCoverage = {
+    kind: "indeterminate",
+    reasons: [
+      {
+        sessionId: "",
+        name: "",
+        kind: "unreadable",
+        why: "the dashboard did not say whether this is really the last N messages, so this page will not claim that it is",
+      },
+    ],
+  };
+  if (!isRecord(v)) return unknown;
+  if (v["kind"] === "complete") return { kind: "complete" };
+  if (v["kind"] !== "indeterminate") return unknown;
+  const raw = v["reasons"];
+  if (!Array.isArray(raw)) return unknown;
+  const reasons: FeedCoverageReason[] = [];
+  for (const item of raw) {
+    if (!isRecord(item)) continue;
+    const kind = item["kind"];
+    reasons.push({
+      sessionId: str(item["sessionId"]) ?? "",
+      name: str(item["name"]) ?? "",
+      /* An unfamiliar reason is still a reason: it is kept as `unreadable` —
+         the vaguest arm — rather than dropped, because dropping the last one
+         would turn an indeterminate feed into an empty-reasons one, which reads
+         as complete. */
+      kind: typeof kind === "string" && COVERAGE_KINDS.includes(kind) ? (kind as FeedCoverageReason["kind"]) : "unreadable",
+      why: str(item["why"]) ?? "the dashboard did not say why",
+    });
+  }
+  return reasons.length === 0 ? unknown : { kind: "indeterminate", reasons };
+}
+
+/**
+ * The reply, whatever it is. **Never throws and never returns null** — an
+ * answer it cannot classify is `no-answer` with a sentence, because a caller
+ * left holding a null would have to write that sentence itself and there would
+ * then be two of them.
+ */
+export function parseFeed(raw: unknown): FeedView {
+  if (!isRecord(raw)) {
+    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
+  }
+  const kind = raw["kind"];
+  if (kind === "unreadable") {
+    return {
+      kind: "unreadable",
+      why: str(raw["why"]) ?? "the dashboard said it could not build the feed and did not say why",
+    };
+  }
+  if (kind !== "feed") {
+    return { kind: "no-answer", why: "the dashboard server answered something that is not this API" };
+  }
+  const messages = parseRows(raw["messages"]);
+  const undated = parseRows(raw["undated"]);
+  const rawSessions = raw["sessions"];
+  return {
+    kind: "feed",
+    limit: num(raw["limit"]),
+    messages: messages.rows,
+    undated: undated.rows,
+    sessions: parseSessions(rawSessions),
+    sessionsOffered: Array.isArray(rawSessions),
+    unreadableRows: messages.unreadable + undated.unreadable,
+    coverage: parseCoverage(raw["coverage"]),
+    collectedAt: str(raw["collectedAt"]),
+    readStartedAt: str(raw["readStartedAt"]),
+    readFinishedAt: str(raw["readFinishedAt"]),
+    servedAt: str(raw["servedAt"]),
+  };
+}
+
+/* ------------------------------------------------------------------ *
+ * The filters. Pure, so the panel holds no filtering logic of its own.
+ * ------------------------------------------------------------------ */
+
+/**
+ * What the reader has narrowed the feed to.
+ *
+ * All four live in the URL hash (mode.ts § the hash), so a filtered view
+ * survives the reload iOS performs whenever it reclaims the tab.
+ */
+export type FeedFilters = {
+  /** Session handles to keep. Empty means every session — never "no sessions". */
+  sessions: string[];
+  /** Speakers to keep. Empty means every speaker. */
+  speakers: MessageSpeaker[];
+  /** Plain substring, case-insensitive. Never a regex — a reader typing `(` must not get an error. */
+  text: string;
+  /** Hide turns whose only content was tool calls. */
+  hideToolCalls: boolean;
+};
+
+export const NO_FILTERS: FeedFilters = { sessions: [], speakers: [], text: "", hideToolCalls: false };
+
+/**
+ * Is this row a tool call and nothing else?
+ *
+ * **`text === ""` is the test, not `toolCalls.length > 0`.** A turn that says
+ * something AND calls a tool is a message, and hiding it would drop the agent's
+ * own words — which is the failure mode of every "hide noise" toggle that was
+ * ever regretted.
+ */
+export function isToolCallOnly(row: FeedRow): boolean {
+  return row.turn.text === "" && row.turn.toolCalls.length > 0;
+}
+
+/** Apply the filters. Pure, order-preserving, and it never re-sorts. */
+export function applyFilters(rows: FeedRow[], filters: FeedFilters): FeedRow[] {
+  const needle = filters.text.trim().toLowerCase();
+  const sessions = new Set(filters.sessions);
+  const speakers = new Set<string>(filters.speakers);
+  return rows.filter((row) => {
+    if (sessions.size > 0 && !sessions.has(row.sessionId)) return false;
+    if (speakers.size > 0 && !speakers.has(row.turn.speaker)) return false;
+    if (filters.hideToolCalls && isToolCallOnly(row)) return false;
+    if (needle !== "") {
+      /* The session's name is searched as well as the text, so typing a
+         session name is a quick way to narrow without opening the picker. */
+      const hay = `${row.turn.text}\n${row.sessionName}`.toLowerCase();
+      if (!hay.includes(needle)) return false;
+    }
+    return true;
+  });
+}
+
+/* ------------------------------------------------------------------ *
+ * The filters, in the URL.
+ * ------------------------------------------------------------------ */
+
+/**
+ * The hash keys. Prefixed `m` so they cannot collide with `order`, `sel` or
+ * whatever a later tab adds — mode.ts carries unrecognised parameters through
+ * untouched, which only works if two tabs do not pick the same name.
+ */
+export const FILTER_KEYS = {
+  text: "mq",
+  sessions: "ms",
+  speakers: "mw",
+  hideToolCalls: "mt",
+  limit: "mn",
+} as const;
+
+/**
+ * The filters a hash names.
+ *
+ * **Every field falls back to "no filter" rather than to an error.** A hash is
+ * a thing people edit, bookmark and send each other, and one written by a later
+ * build must degrade to showing more than was meant — never to showing nothing,
+ * and never to a blank page.
+ */
+export function filtersFromParams(params: Readonly<Record<string, string>>): FeedFilters {
+  const split = (v: string | undefined): string[] =>
+    v === undefined || v === "" ? [] : v.split(",").filter((s) => s !== "");
+  return {
+    sessions: split(params[FILTER_KEYS.sessions]),
+    /* A speaker this build does not know is dropped from the filter rather than
+       kept: keeping it would narrow the list by a name nothing can match, and
+       the reader would see an empty feed with no way to tell why. */
+    speakers: split(params[FILTER_KEYS.speakers]).filter((s): s is MessageSpeaker =>
+      [...SPEAKERS, "unrecognised"].includes(s),
+    ),
+    text: params[FILTER_KEYS.text] ?? "",
+    hideToolCalls: params[FILTER_KEYS.hideToolCalls] === "1",
+  };
+}
+
+/**
+ * The hash parameters for a set of filters.
+ *
+ * **A default writes `null`, which mode.ts turns into a removed key** — so
+ * "back to showing everything" leaves no trace in the URL rather than a trail
+ * of empty parameters.
+ */
+export function paramsFromFilters(filters: FeedFilters): Record<string, string | null> {
+  return {
+    [FILTER_KEYS.sessions]: filters.sessions.length > 0 ? filters.sessions.join(",") : null,
+    [FILTER_KEYS.speakers]: filters.speakers.length > 0 ? filters.speakers.join(",") : null,
+    [FILTER_KEYS.text]: filters.text.trim() === "" ? null : filters.text,
+    [FILTER_KEYS.hideToolCalls]: filters.hideToolCalls ? "1" : null,
+  };
+}
+
+/** How many messages the hash asks for, clamped to the sizes the picker offers. */
+export const FEED_LIMITS = [25, 50, 100, 200] as const;
+
+export function limitFromParams(params: Readonly<Record<string, string>>): number {
+  const raw = Number(params[FILTER_KEYS.limit]);
+  return (FEED_LIMITS as readonly number[]).includes(raw) ? raw : 50;
+}
+
+/* ------------------------------------------------------------------ *
+ * The seam.
+ * ------------------------------------------------------------------ */
+
+/** The injection point, the same shape as `MessagesApi` and `ActionsApi`. */
+export type FeedApi = { recent: (limit: number) => Promise<FeedView> };
+
+/** A thrown thing, as a sentence. Never "[object Object]". */
+function describe(cause: unknown): string {
+  if (cause instanceof Error) return cause.message === "" ? cause.name : cause.message;
+  if (typeof cause === "string" && cause !== "") return cause;
+  return "the request failed, and gave no reason";
+}
+
+/**
+ * **The HTTP status is not consulted**, for the reason messages-client.ts
+ * gives: the route answers every failure with the same union the 200 carries,
+ * so branching on the code as well as the body would be a second copy of the
+ * server's decision kept in step by nothing. The body decides; the status only
+ * appears in the sentence this file writes when the body was no use.
+ */
+export function makeFeedApi(fetchImpl: typeof fetch = fetch): FeedApi {
+  return {
+    async recent(limit): Promise<FeedView> {
+      let response: Response;
+      try {
+        response = await fetchImpl(feedUrl(limit), { cache: "no-store" });
+      } catch (cause) {
+        return { kind: "no-answer", why: `this browser could not reach the dashboard: ${describe(cause)}` };
+      }
+      let parsed: unknown;
+      try {
+        parsed = await response.json();
+      } catch (cause) {
+        return {
+          kind: "no-answer",
+          why: `the dashboard server answered ${response.status} and the body was not JSON: ${describe(cause)}`,
+        };
+      }
+      return parseFeed(parsed);
+    },
+  };
+}
+
+/** The default instance. Late-bound `fetch`, for the reason steer-client.ts gives. */
+export const httpFeedApi: FeedApi = { recent: (limit) => makeFeedApi().recent(limit) };
+
+/** What `FeedMessage` looks like on the wire, re-exported so a test can build one. */
+export type { FeedMessage };
diff --git a/tools/fleet/web/src/mode.ts b/tools/fleet/web/src/mode.ts
index 2bbf884b..adadc144 100644
--- a/tools/fleet/web/src/mode.ts
+++ b/tools/fleet/web/src/mode.ts
@@ -27,12 +27,13 @@
  */
 import { useCallback, useEffect, useMemo, useState } from "react";
 
-export const MODES = ["sessions", "health", "overseer"] as const;
+export const MODES = ["sessions", "messages", "health", "overseer"] as const;
 
 export type Mode = (typeof MODES)[number];
 
 export const MODE_LABELS: Record<Mode, string> = {
   sessions: "Sessions",
+  messages: "Recent messages",
   health: "Box health",
   overseer: "Overseer",
 };
diff --git a/tools/fleet/wire.ts b/tools/fleet/wire.ts
index 2d0fce48..64760e9b 100644
--- a/tools/fleet/wire.ts
+++ b/tools/fleet/wire.ts
@@ -36,7 +36,32 @@
  * the text says which it is. A model's recommendation must not mint its own
  * approval.
  */
-export type Speaker = "greg" | "overseer";
+export type Speaker = "greg" | "overseer" | "dashboard";
+
+/*
+ * **`dashboard` IS A REPORT, NEVER AN INSTRUCTION, AND THE ARM SPLITS IF THAT
+ * STOPS BEING TRUE.** Added 2026-09-09 for the line the web UI sends when a
+ * person starts a new session, so the receiving agent is told an event happened
+ * rather than asked for anything.
+ *
+ * It is a third arm rather than a reuse of either existing one, and both
+ * alternatives were wrong in the direction this type exists to prevent.
+ * `greg` would mint his authority for something nobody instructed — the exact
+ * failure A12 names. `overseer` would attribute a notification to a coordinator
+ * that did not send it. A person acted and software is reporting it, which is
+ * neither.
+ *
+ * So its prefix says plainly that nothing is being asked, which the other two
+ * do not need to say because both of theirs ARE asking something. The wording
+ * was reviewed by the session that receives it, which is a better test of it
+ * than the judgement of the session that wrote it.
+ *
+ * **If anything ever goes through this arm that IS an instruction, the prefix
+ * becomes a false statement** and this must split into two arms rather than
+ * having its wording softened. Do not reach for `dashboard` as a
+ * general-purpose "not Greg" speaker; that is what `overseer` is, and it says
+ * so.
+ */
 
 /* ------------------------------------------------------------------ *
  * The spoken half of the vocabulary.
@@ -1648,3 +1673,263 @@ export type QuarantineHoldView = {
   why: string;
   outcome: HoldOutcome;
 };
+
+/* ------------------------------------------------------------------ *
+ * The cross-agent feed — `GET /api/feed`.
+ *
+ * Greg, 2026-09-08: *"add a 'Recent messages' tab with a rolling window of the
+ * last N messages across all agents (making it easy to filter)"*.
+ *
+ * The per-session route (`/api/messages?id=`) answers *is this row telling me
+ * the truth?* This one answers *what is the fleet saying* — and the difference
+ * is not only scope. **The reader of this feed was never watching these
+ * sessions**, so a message that is wrong, misattributed or missing has nothing
+ * on screen to contradict it. Every type below that looks like defensive
+ * bookkeeping is there for that reason, and the reasoning is in
+ * docs/plans/260909b-recent-messages-tab-a-rolling-window-across-all-agents.md.
+ * ------------------------------------------------------------------ */
+
+/**
+ * Who said it, on the wire.
+ *
+ * **A structural copy of `TurnSpeaker` in tools/fleet/transcript.ts**, which
+ * this file may not import — the header above says why no import may ever
+ * appear here, and transcript.ts reaches `node:fs`.
+ *
+ * The copy is kept honest in the direction that matters **for free, by an
+ * ordinary assignment**: `routes-recent-feed.ts` assigns a `TurnSpeaker` into
+ * this field, so an arm added to the reader and not to this union is a compile
+ * error at the point of use. No guard, no ceremony, nothing to remember. The
+ * other direction — an arm here the reader never produces — is harmless,
+ * because the browser's parser rounds a speaker it does not know to
+ * `unrecognised` rather than to `assistant`.
+ */
+export type FeedSpeaker =
+  | "human"
+  | "assistant"
+  | "peer"
+  | "notification"
+  | "compact-summary"
+  | "injected"
+  | "api-error"
+  | "system";
+
+/** One tool call, as a label. Structural copy of `ToolCallSummary`, same argument. */
+export type FeedToolCall = { name: string; detail: string | null };
+
+/**
+ * **HOW MUCH THE FEED IS ENTITLED TO CLAIM ABOUT WHO SAID THIS.**
+ *
+ * `CLAUDE_SESSION_ID` is pinned into a tmux session's environment when the pane
+ * is created and is never updated (transcript.ts says so at length). So a pane
+ * that has been re-used — the agent exited and somebody started a fresh
+ * `claude`, or resumed a different conversation — still names the FIRST
+ * conversation, and the reader will faithfully return that conversation's
+ * turns. They are real messages, well formed, correctly attributed, about this
+ * repo, and **not the conversation the row is about**.
+ *
+ * The per-session view can leave that to the reader's own judgement, because
+ * somebody looking at one session usually knows what it was doing. **This feed
+ * cannot**, so the claim is carried explicitly beside every message rather than
+ * asserted by putting a session's name next to some text.
+ *
+ * `verified` REQUIRES `FleetRow.execution` (session
+ * 260908f-roadmap-exec-identity), which is not on `dev` yet — so today this
+ * route never returns it. That is deliberate: an arm nothing can currently
+ * produce is better than a `verified` that means "we did not check".
+ */
+export type FeedAttribution =
+  /** The live pane's conversation id was checked and matches. Needs `FleetRow.execution`. */
+  | { kind: "verified" }
+  /** A pinned id, nothing contradicting it, and nothing confirming it either. The ordinary case. */
+  | { kind: "claimed-only"; why: string }
+  /** Something positively disagrees — e.g. a transcript untouched for hours against a `working` row. */
+  | { kind: "suspect"; why: string };
+
+/** One message in the feed, with the session it was read for attached to it. */
+export type FeedMessage = {
+  /** tmux's SESSION handle, `$1643` — the address, and what the session filter matches on. */
+  sessionId: string;
+  /** For reading. Renames happen, so this is the name at read time, not an identity. */
+  sessionName: string;
+  sessionTitle: string | null;
+  /** See `FeedAttribution`. Never omitted, because its absence would read as confidence. */
+  attribution: FeedAttribution;
+  speaker: FeedSpeaker;
+  /**
+   * ISO, on **the box's clock**, exactly as the transcript wrote it — never
+   * shifted to the browser's. messages-client.ts § `MessageTurn.at` has the
+   * full argument; the short version is that shifting it would assert an
+   * absolute instant nothing happened at.
+   *
+   * Null is in the type and was **not** observed in 955 sampled turns. See
+   * `FeedPayload.undated` for what happens to one if it ever appears.
+   */
+  at: string | null;
+  /** Plain, untrusted, possibly truncated, **never markup**. */
+  text: string;
+  truncated: boolean;
+  fullChars: number;
+  toolCalls: FeedToolCall[];
+  /** The record's own uuid, for a React key that survives a refresh. */
+  uuid: string | null;
+};
+
+/**
+ * What happened when we tried to read one session — carried for **every** row
+ * in the snapshot, including the ones with nothing to read.
+ *
+ * Nine of 21 rows on the box tonight are shells and scheduled sessions still
+ * running `sleep`; they answer `no-claude-session-id`. A feed that listed only
+ * the sessions it could read would show a fleet of twelve and look complete
+ * doing it.
+ */
+export type FeedSessionRead =
+  | {
+      kind: "read";
+      /** How many turns this session contributed to the merge, before the global trim. */
+      turns: number;
+      /**
+       * **WHETHER THIS SESSION'S NEWEST `limit` TURNS WERE ALL ACTUALLY READ.**
+       *
+       * False means the byte budget stopped the walk before the requested
+       * number of turns — so this session may have said more than the feed
+       * shows. A short answer and a quiet agent look identical on screen, which
+       * is the silent-success failure this feature is most exposed to. See
+       * `FeedPayload.mayBeMissing` for when it actually matters.
+       */
+      complete: boolean;
+      /** The transcript's own mtime, ISO, box clock. The one check on the hazard above. */
+      lastModified: string;
+      bytesRead: number;
+      fileBytes: number;
+      /** Tool results the reader skipped, so "silent between two messages" is never implied. */
+      toolResultsSkipped: number;
+      /**
+       * How many transcript files matched this conversation id. Anything but 1
+       * means provenance is ambiguous — the reader exposes it for exactly that,
+       * and a feed that showed the turns without it would be picking one file
+       * silently.
+       */
+      copies: number;
+      /**
+       * Lines that would not parse. **1 is normal** — a live session is being
+       * appended to while we read, so the last line can be half-written.
+       * Anything higher means turns may be missing from this session's answer.
+       */
+      recordsUnparseable: number;
+    }
+  /** No transcript to read. `reason` is the reader's typed code, `why` its sentence. */
+  | { kind: "not-found"; reason: string; why: string }
+  /** There was a file and it could not be read. */
+  | { kind: "unreadable"; path: string | null; why: string };
+
+/** One session in the feed's own census of the fleet. */
+export type FeedSession = {
+  sessionId: string;
+  name: string;
+  title: string | null;
+  read: FeedSessionRead;
+};
+
+/**
+ * **WHY THE FEED MIGHT NOT BE THE LAST N MESSAGES AFTER ALL.**
+ *
+ * Identified by `sessionId`, never by name: names are reassigned when a session
+ * dies and two sessions can wear the same one, so a warning keyed by name can
+ * point at the wrong agent.
+ */
+export type FeedCoverageReason = {
+  sessionId: string;
+  /** The name at read time, for printing beside the id. Not an identifier. */
+  name: string;
+  kind:
+    /** The byte budget stopped the walk before this session's newest N, inside the window shown. */
+    | "byte-budget"
+    /** There was a transcript and it could not be read. */
+    | "unreadable"
+    /** This session claims a conversation whose transcript could not be located. */
+    | "no-transcript"
+    /** Turns came back with no placeable timestamp, so they may have displaced dated ones. */
+    | "undated"
+    /** Timestamps went backwards within one session, so "newest" is not a total order there. */
+    | "out-of-order"
+    /** Two rows name the same conversation, so its turns would be counted twice. */
+    | "duplicate-conversation";
+  why: string;
+};
+
+/**
+ * **WHETHER "THE LAST N MESSAGES" IS A CLAIM THIS PAYLOAD CAN ACTUALLY MAKE.**
+ *
+ * The merge is exact — any message among the true newest N must be among its
+ * own session's newest N — but only while four premises hold: the census is
+ * fixed, each message belongs to exactly one session, every session really
+ * supplied its newest N, and local and global "newest" use the same total
+ * order. Each of the reasons above breaks one of them.
+ *
+ * **THIS IS A PROPERTY OF THE WHOLE FEED, NOT AN ADVISORY ROW BESIDE IT.** An
+ * earlier draft listed only the byte-truncated sessions, and GPT Sol's P1
+ * against that design is the reason this type exists: an unreadable session can
+ * contain *all* of the true newest messages, and showing it as one more row in
+ * a census does nothing to stop the main list looking authoritative. So a
+ * client cannot render this feed without meeting the question, and `complete`
+ * is constructible only when every contributor satisfied the invariant.
+ */
+export type FeedCoverage = { kind: "complete" } | { kind: "indeterminate"; reasons: FeedCoverageReason[] };
+
+export type FeedPayload =
+  | {
+      schema: 1;
+      kind: "feed";
+      /** What was asked for, after clamping — so the page can say it got less than it typed. */
+      limit: number;
+      /**
+       * **NEWEST FIRST**, which is the opposite of `/api/messages`, and the
+       * inversion is done here, once, rather than in every client.
+       *
+       * Stated this loudly because the sibling route returns turns newest LAST
+       * and a reader arriving from messages-client.ts will assume the same here.
+       * Doing it server-side means the ordering has one home and one test.
+       */
+      messages: FeedMessage[];
+      /**
+       * Messages with no timestamp, which cannot be placed in a global ordering.
+       *
+       * **Not dropped** — a feed that silently omits messages is the one thing
+       * this must not be — and **not interleaved at a guessed position**, which
+       * would assert an ordering nothing supports. Zero of 955 sampled turns
+       * needed this. If it is ever non-empty, that is the signal to design
+       * something better rather than evidence that this was enough.
+       */
+      undated: FeedMessage[];
+      /** Every row in the snapshot, readable or not. See `FeedSessionRead`. */
+      sessions: FeedSession[];
+      /**
+       * Whether this really is the last `limit` messages. **Required, and the
+       * client may not render the list without consulting it.** See
+       * `FeedCoverage`.
+       */
+      coverage: FeedCoverage;
+      /**
+       * **THE CENSUS BOUNDARY, WHICH IS THE HONEST CONTRACT.**
+       *
+       * There is no instant at which this answer describes the fleet. The
+       * roster was collected at `collectedAt`, up to a minute before; the
+       * transcripts were read between `readStartedAt` and `readFinishedAt`. So
+       * a session created after `collectedAt` is absent, one that has since died
+       * is still present and its transcript still reads, and a session read
+       * early may have appended while a later one was being read.
+       *
+       * What this payload actually says is *"the newest turns observed from the
+       * roster collected at C, during reads R0–R1"* — not *"the fleet right
+       * now"*, which is what a single timestamp would imply. GPT Sol's P1 on the
+       * plan; the three fields exist so the page can say the true thing.
+       */
+      collectedAt: string | null;
+      readStartedAt: string;
+      readFinishedAt: string;
+      servedAt: string;
+    }
+  /** We could not look. Never merged with an empty `messages`, which would say the fleet was quiet. */
+  | { schema: 1; kind: "unreadable"; why: string };
```
