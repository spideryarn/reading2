No P0s. I found six P1s and three P2s.

## P1

1. **Most filter controls do not persist their update.**  
   [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/App.tsx:247) calls `setParam` four times, but every call copies the same closed-over `state.params` in [mode.ts](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/mode.ts:134). The final `mt` write overwrites the session, speaker, or text write made earlier. In practice, “Hide tool calls” works because it is last; the other controls revert. The URL round-trip test exercises only the pure converters, not this composition. Update the hash atomically with a multi-parameter setter.

2. **A malformed payload can render as confidently complete.**  
   [parseRows](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/feed-client.ts:214) treats an absent/non-array field as a successfully parsed empty array, [parseFeed](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/feed-client.ts:355) ignores `schema`, and [parseCoverage](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/feed-client.ts:326) accepts `complete` without validating the rest of the payload. Concretely:

   ```ts
   parseFeed({ kind: "feed", coverage: { kind: "complete" } })
   ```

   returns a complete feed with zero messages, zero sessions, and no caveat. Missing `text` is also converted into a real empty turn at [feed-client.ts:199](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/feed-client.ts:199), which can subsequently be hidden as tool-only. Require schema 1 and the required arrays; malformed required fields should produce `no-answer` or locally demote coverage.

3. **The byte-budget cutoff can falsely return `complete`.**  
   The strict `oldest > cutoffMs` comparison at [routes-recent-feed.ts:402](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/routes-recent-feed.ts:402) misses equality. An unread turn with the same millisecond as the cutoff can precede the retained cutoff under the tie order and belong in the window. I reproduced an incomplete session whose oldest retained timestamp equalled the cutoff; coverage returned `complete`. At minimum this must be `>=`.

   More fundamentally, the optimization assumes unread file-earlier turns have no newer timestamp. The out-of-order check examines only returned turns at [routes-recent-feed.ts:325](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/routes-recent-feed.ts:325), so a clock rollback below the read boundary is unknowable. If `complete` means proven, every incomplete session must demote coverage; otherwise the monotonic-clock assumption needs to be explicit.

4. **`no-claude-session-id` is too broad to exclude categorically.**  
   The existing contract says `claudeSessionId` is null both for a non-Claude shell and for a legacy Claude that never pinned the variable ([collect.ts:106](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/collect.ts:106)); the reader’s own sentence says the same ([transcript.ts:899](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:899)). Therefore [routes-recent-feed.ts:303](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/routes-recent-feed.ts:303) can hide a real conversation hole.

   The launcher metadata already distinguishes version-1 `claude | shell | setup` sessions. Exclude only explicit version-1 shell/setup rows; treat legacy and inconsistent version-1 Claude rows as indeterminate. Status alone is insufficient because a null ID is currently classified as `shell` before process identity is considered.

5. **`copies` and `recordsUnparseable` are carried but have no observable effect.**  
   The wire contract says multiple copies make provenance ambiguous and more than one unparseable line may mean missing turns ([wire.ts:1808](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/wire.ts:1808)). The merge copies both fields but never adds a coverage reason, and `Caveats` only displays sessions whose `read.kind !== "read"` ([FeedPanel.tsx:153](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/FeedPanel.tsx:153)). Thus either condition can coexist with `coverage: complete` and is invisible. `recordsUnparseable > 1` should demote coverage; multiple copies should at least visibly demote provenance, and probably coverage.

6. **One pending read can hang the whole route indefinitely.**  
   The fan-out is an unbounded `Promise.all` with no elapsed-time deadline at [routes-recent-feed.ts:466](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/routes-recent-feed.ts:466). The route catch handles rejection, not a promise or filesystem operation that never settles. The test named “rather than hanging” only supplies `Promise.reject` at [fleet-recent-feed.test.ts:812](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tests/fleet-recent-feed.test.ts:812). Add a bounded route/read deadline and return an indeterminate partial result or an unreadable response. I found no ordinary double-answer path.

## P2

1. **Session filters can become active but impossible to see or clear.**  
   Arbitrary IDs are retained at [feed-client.ts:471](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/feed-client.ts:471), while chips are offered only for sessions in the current dated window ([FeedPanel.tsx:345](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/FeedPanel.tsx:345)). A bookmarked session, or one that disappears on refresh, can empty the feed with no active chip visible. Keep an orphan chip/“Clear filters” control, or ignore unavailable IDs explicitly.

2. **Undated messages bypass the filtering and counting model.**  
   Only `view.messages` passes through `applyFilters` at [FeedPanel.tsx:341](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/FeedPanel.tsx:341); every undated row renders unfiltered at [FeedPanel.tsx:478](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/FeedPanel.tsx:478). With only undated rows, the panel simultaneously says no readable message exists, displays those messages, and reports `0 messages`. The server also silently truncates the undated group with `slice(0, limit)` at [routes-recent-feed.ts:417](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/routes-recent-feed.ts:417), despite the UI saying they are shown rather than dropped.

3. **The guard is plausible, but the claimed construction is not tested or fully enforced.**  
   `readTail` returns complete JSONL lines, so—provided every logical message’s contributing records are contiguous—only the first coalesced turn can straddle the lower boundary. Discarding it is conservative. It can discard a whole real turn when the boundary falls between turns or when `reachedStartOfFile` is false because of exact trimming, but that does not lose a required newest-N turn when N survive; otherwise coverage should warn.

   The contiguity premise is not enforced: [recordsToTurns](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:717) coalesces only adjacent drafts, and [openDraft](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:823) permits the same message ID to reappear later as another draft. The guard test starts from fabricated, already-coalesced turns ([fleet-recent-feed.test.ts:540](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tests/fleet-recent-feed.test.ts:540)); it never drives a multi-record turn across the byte boundary. Add an end-to-end reader fixture for boundary-inside-turn, boundary-between-turns, and non-contiguous ID recurrence.

The focused 72 feed tests passed, and all four TypeScript projects passed when invoked directly. The highest-priority fixes are the atomic hash update, strict payload validation, and the three coverage holes above.