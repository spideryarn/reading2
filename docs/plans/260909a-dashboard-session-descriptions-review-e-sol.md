## Verdict

**Refuse.** F13–F16 are established P1s. F13 is the clearest refusal basis: a permitted `found` state can make the top confidently claim that a session has never spoken when the read did not establish that.

### Findings

#### F13 — P1 — established: an incomplete empty read is presented as a silent session

(a) With `kind: "found"`, `turns: []`, `turnsOffered: true`, and `reachedStartOfFile: false` or `null`, [`Latest`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/RecentMessages.tsx:250) says:

> a session that has not spoken yet

But `reachedStartOfFile: false` explicitly says the reader did not reach the beginning; `null` makes no completeness claim. On a stale working transcript, the early return also skips `StaleNote`, despite computing `age`.

(b) Claim “has not spoken” only when the reading establishes a complete, readable empty transcript. Otherwise say that the read returned no readable turns and did not establish silence. Render the stale warning independently of whether `newest` exists.

#### F14 — P1 — established: an older readable turn can be labelled “Latest message”

(a) [`parseRecentMessages`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/messages-client.ts:279) drops unreadable turn entries while retaining only their count. Given `[validOlderTurn, null]`, `Latest` receives `[validOlderTurn]` and presents it under “Latest message.” The warning that one turn is missing appears only inside the closed disclosure at [`RecentMessages.tsx:437`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/RecentMessages.tsx:437). The missing turn may be newer.

(b) Put an explicit caveat beside the visible turn whenever `unreadableTurns > 0`: this is only the latest turn the page could read and may not be the session’s latest. For zero readable turns, say that no turns could be read rather than that none exist. Preserving unreadable positions in the parsed representation would be stronger but larger.

#### F15 — P1 — established: uncertainty about which transcript is live is hidden as provenance

(a) With a non-empty `found` view and `copies: 2`, the top presents one turn as the session’s latest. The UI’s own warning says it cannot tell which file is live, but that warning is behind the closed disclosure at [`RecentMessages.tsx:398`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/RecentMessages.tsx:398). This changes what the operator should do: steering based on that message may answer the wrong conversation.

(b) Promote the multiple-copy warning alongside the latest turn, as was done for the stale-transcript warning. Byte counts and paths may remain in the disclosure.

#### F16 — P1 — established: the zero-turn disclosure invents an only turn

(a) For every `found` view with `turns: []`, `older` is also empty. Opening “Where this came from” then displays:

> Nothing earlier — the message above is the only turn read.

No turn was read; the message above is an empty-state or unreadable-state sentence. With `turnsOffered: false`, the two sections directly contradict each other.

(b) Branch on total `view.turns.length`. For zero, omit this sentence or say “No turns were read.” Keep the existing sentence only when the total length is exactly one.

#### F17 — P2 — established: the tests do not pin the stale warning outside the disclosure

(a) Move `StaleNote` from [`Latest`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/RecentMessages.tsx:266) back into `Found`. The existing stale tests inspect `container.textContent`, which includes descendants of closed `<details>`, while the new containment assertion covers only `not-found`. The suite would still see the warning and pass, although a reader would not see it without opening the disclosure.

(b) Render a stale working fixture, locate the conversation disclosure, and assert that the warning exists and is not contained by it. Add zero-turn and unreadable-tail cases alongside it.

#### F18 — P2 — reasoned: the split does not make refusal loss unrepresentable

(a) [`EarlierMessages`](/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions/tools/fleet/web/src/RecentMessages.tsx:288) accepts the entire `MessagesView | null` union and silently returns `null` for every refusal state. Today `SessionDetail` correctly pairs it with `LatestMessage`, but the exported API permits a future consumer to render `EarlierMessages` alone and flatten all refusals into nothing.

(b) Prefer one exported conversation component that owns the exhaustive union switch and renders both pieces, or at least make `EarlierMessages` private and accept only the narrowed `found` arm.

## Direct answers

1. **Yes, for the current `SessionDetail` composition.** Both components receive the same `reading.view` reference from the same render. `busy` and `read` do not provide `LatestMessage` with a second reading. A refresh or identity change rerenders both together.

2. **Complete against literal silence, but not against false confidence.** No current state renders a blank top:

   - `not-found`, `unreadable`, and `no-answer` render `Refusal`.
   - `view === null, busy === false` renders “Not read yet.”
   - `view === null, busy === true` renders the loading sentence.
   - A valid empty `found` view renders an empty-state sentence.

   The last three are states with neither a turn nor a `Refusal`. F13–F15 show where the rendered sentence or turn can still be untrue or inadequately qualified.

3. **Yes.** At length 0, the slice is `[]` and newest is `undefined`; at length 1, the slice is `[]` and newest is element 0; at larger lengths they partition the array into its prefix and final element.

The `60vh` panel is not itself a finding: the border provides a visible boundary and the supplied browser evidence covers both target widths. The two `transcriptAge` calls are harmless today because they call the same pure function with identical inputs.

`DELIVERY_HEADLINE` is unchanged, and `tools/fleet/wire.ts` is untouched. `npx vitest run tests/fleet-web.test.tsx` passed: **345/345**. I changed no files.