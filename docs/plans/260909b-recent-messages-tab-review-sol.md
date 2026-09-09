No P0. The fan-out lemma is correct, but the plan currently overstates what it proves. I would revise the contract before continuing Stage 2 and revisit parts of Stage 1.

## P1

1. **“Exact” needs a top-level coverage result, not only a list of byte-truncated sessions.**

   The proof at [the merge design](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/docs/plans/260909b-recent-messages-tab-a-rolling-window-across-all-agents.md:57) is valid if:

   - the session census is fixed;
   - each message belongs to exactly one session;
   - every session supplies its newest N complete turns;
   - local and global “newest” use the same total order.

   The incomplete-session list covers only one violation. An `unreadable` or relevant `not-found` session can contain all of the true newest messages; an invalid timestamp, ordering inversion, duplicate conversation ID, or unsupported transcript shape can also invalidate the result. Showing these as rows does not stop the main list looking authoritative.

   Make coverage a required discriminated field, such as `complete | indeterminate`, with structured reasons and session IDs. `complete` should only be constructible when every contributor satisfies the invariant. Names alone are not identifiers and can collide.

   Tests should prove that:

   - one unreadable Claude session makes global coverage indeterminate;
   - no snapshot produces `unreadable`, never a healthy empty feed;
   - two rows naming the same `claudeSessionId` are detected rather than duplicating every turn;
   - the client cannot discard coverage and still render a normal-looking list.

2. **There is no single fleet or time instant over which the answer is exact.**

   The route uses a snapshot that may be nearly 60 seconds old, then reads live files over roughly 250 ms:

   - a session created after collection is absent;
   - a vanished session remains present and its persistent transcript still reads successfully;
   - an existing session may append after its own read, while another session is read later.

   Therefore the result may not correspond to the fleet at any instant. The honest, simple contract is: “newest turns observed from the roster collected at C, during reads R0–R1,” not “the fleet right now.”

   Capture the snapshot once before fan-out, carry `collectedAt`, `readStartedAt`, and `readFinishedAt`, and render that census boundary. Also preserve any existing snapshot-failure/staleness indication.

   Add tests where the snapshot provider changes during fan-out and where a session appears or vanishes after `collectedAt`.

3. **Coalescing breaks `turns.length >= N` as a completeness proof at the byte boundary.**

   One turn may span several records, and the reader keeps the timestamp/text of the first contributing record it happened to read ([coalescing logic](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:715)). If the low byte boundary lands inside a shared `message.id`, the oldest returned turn can be partial while the route still receives exactly N turns and calls the session complete.

   A cheap repair without another parser is to request N+1 from every session and discard the oldest guard turn. Then completeness is `reachedStartOfFile || returnedTurns.length > N`. If a final record was concurrently half-written, `recordsUnparseable` must still be carried because the newest turn may be incomplete.

   Add a test where two records sharing one message ID straddle the byte boundary and have different timestamps/content.

4. **`at` is usable, but the current evidence does not establish a total order.**

   “Non-null ISO UTC” does not guarantee lexicographically sortable canonical strings. The reader accepts any non-empty timestamp string. Equal timestamps also leave cutoff membership and newest-first order undefined, and a wall-clock adjustment can break monotonicity even on one box.

   Parse to epoch milliseconds, classify invalid values with the undated/unorderable group, and define a deterministic tie-breaker using session ID plus local transcript ordinal. Detect observed within-session inversions and demote coverage if one occurs.

   Also define which timestamp a coalesced turn owns—first contributing record, last contributing record, or text record. Today it is effectively the first contributing record.

   Separately, raw box timestamps are correct for sorting but not directly for displaying “age.” The existing client explicitly warns against subtracting them from the phone clock ([clock contract](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/messages-client.ts:121)). Calculate age against a server-clock `servedAt`, or apply the existing measured clock skew.

   Tests: equal timestamps, malformed timestamps, observed inversion, different valid ISO representations, coalesced records with different timestamps, and a deliberately skewed browser clock.

5. **Transcript mtime cannot produce “verified” attribution.**

   A recent mtime only means the pinned transcript was recently written. It does not prove that the pane currently runs that conversation; a reused pane can still point at a recently active old transcript. Conversely, an old mtime is only suspicious for some statuses and can be a legitimate long tool call.

   Until `FleetRow.execution` lands, the honest arms are effectively:

   - `claimed-only`;
   - `suspect` with a reason.

   `verified` must be unreachable. Do not map “recent” to verified or “quiet” to known-correct. Also carry `copies` and abnormal `recordsUnparseable`; the underlying reader exposes both specifically because either can undermine provenance ([reader diagnostics](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:221)).

   Test a reused pane whose wrong pinned transcript has a recent mtime.

6. **The proof is over recognized `TranscriptTurn`s, not necessarily all messages.**

   The parser deliberately omits tool results and thinking, but it also silently skips unfamiliar record types, unfamiliar blocks, and assistant content in an unexpected valid-JSON shape ([record filtering](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/transcript.ts:728)). `recordsUnparseable` does not count those.

   Either narrow the product claim to “the newest N turns recognized by this transcript reader,” or add an unsupported-record diagnostic. Otherwise a Claude Code schema change can produce a healthy-looking empty or short feed.

   Add a test where valid JSON contains an unfamiliar conversational shape and require an explicit diagnostic.

7. **Manual refresh introduces a stale-response race.**

   Two refreshes can resolve out of order, allowing an older feed to overwrite a newer one while looking entirely healthy. The existing per-session reader already uses a monotonically increasing request token for exactly this class ([existing guard](/home/greg/code/spideryarn2/.claude/worktrees/recent-messages-tab/tools/fleet/web/src/RecentMessages.tsx:403)).

   Require the same guard in Stage 2 and test two deferred requests resolving newest-first, then oldest.

## P2

1. **The cost conclusions use the wrong wire quantity.**

   At N=50 the measurement counted 579 candidate turns and 93 kB of text, but the proposed route serializes only the final 50 messages. Therefore 266 kB cannot be the designed response size unless the candidates are accidentally also being sent.

   Re-measure the actual final payload both plain and gzipped. Polling would also repeat the measured 10.2 MB transcript fan-out, so disk cost does enter the cadence decision. Manual refresh may still be right, but then the tab needs a prominent “read X ago” indication and is not automatically rolling.

2. **Undated turns can consume the per-session N and hide dated candidates.**

   Separating returned undated turns avoids inventing their position, but it does not preserve the top-N dated result. If one session’s returned N are undated, an older dated turn from that session was never fetched and may belong in the dated global window.

   Any undated or invalid timestamp should therefore make ordering indeterminate, not merely add a group below an otherwise “exact” feed. Test N undated local turns followed by an older dated turn.

3. **The filter taxonomy does not match the data model.**

   `tool` is not a speaker; tool calls are attached to assistant turns, including turns that also contain prose. Define “has tool calls” as a separate facet. Specify which concrete speakers fall under person, agent, and machinery.

   Also state that free-text filtering searches only the returned, possibly truncated 2,000-character excerpt—not full messages or omitted tool results. Expand-in-place must retain the existing “cut short” disclosure.

4. **The proposed shared `Turn` is not actually the same component on both surfaces.**

   The detail turn shows full returned text and an absolute timestamp. The feed needs session provenance, attribution confidence, age, collapsed first-line text, filter behavior, and hidden-tool behavior. Extracting the speaker metadata and message body is likely the stable shared seam; extracting the entire current `Turn` risks a conditional-prop component that is harder to understand than two small wrappers.

   Add a mixed prose-plus-tool fixture and verify hiding tools does not render a blank or misleading turn.

5. **The Stage 1/2 test list should explicitly cover the protocol boundaries.**

   Add:

   - gzip and identity branches, decompression, `Vary`, and `no-store`;
   - integer clamping for zero, negative, fractional, non-finite, and over-max limits;
   - an unexpected rejected per-session read;
   - missing/malformed `messages` and `sessions` fields becoming `no-answer`, not empty;
   - malformed individual turns being counted, not silently dropped;
   - unknown speakers remaining unrecognised.

The core architecture—separate on-demand route, server-side fan-out, no collector involvement—is sound. The change needed is to call the output exact only when the payload can prove all of the theorem’s premises; otherwise the uncertainty needs to be a property of the whole feed, not scattered advisory rows.

The working copy changed while I reviewed it: Stage 1 is now marked done and route/wire changes are present. I did not code-review that implementation; the findings above are against the design and contracts requested.