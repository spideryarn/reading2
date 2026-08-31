# Verdict: NO-SHIP

The server-side architecture is mostly sound. The prompt behavior, client stance handling, overlay gate, long-review editing, and typecheck gate are not.

## Findings, ranked by damage

### 1. High — the eval shows the prompt still inventing corrections

The prompt text accepts finding 1, but the behavior does not.

The clearest failure is the `defensible` case. The response narrows Seth’s open door to living substrates and says analogue or neuromorphic machines have the same problem ([review-stances.md](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/review-stances.md:57)). The article explicitly lists analogue and neuromorphic computation as possibilities and says its arguments may stand independently ([blocks.json](/Users/greg/Dropbox/dev/experim/spideryarn2/data/noema-mythology-of-conscious-ai/blocks.json:1014)). That is the invented correction the first review warned about.

The `correct` case is mixed:

- Correctly refining “consciousness isn’t computation” into the article’s hedged claim is legitimate.
- Adding that the reader omitted three other arguments is not. They never claimed completeness, and the omission does not reverse their account ([review-stances.md](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/review-stances.md:13)). That directly violates the omission rule.

The eval also misses obvious prompt violations:

- Several replies open with overall assessments such as “That’s the core of it” or “That reading holds up well,” despite `NO OVERALL ASSESSMENT`.
- The lost reader’s Socratic reply still ends with a question, despite `THEIR WORDS BEAT THE STANCE` saying that someone who says they are stuck must be answered ([review-stances.md](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/results/review-stances.md:184)).
- Signposts replies repeatedly explain and challenge the reading rather than only identifying passages.
- The correct Balanced reply quotes the article without citing those quotations, despite `EVERY QUOTATION CARRIES THE ID`.
- The disagreement/Balanced output ends mid-word at “simulation from instant,” but the eval discards the `truncated` result field and reports it as an ordinary answer ([review-stances.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/review-stances.ts:155)).

The supposedly `ambiguous` fixture is not genuinely ambiguous: the article explicitly says properties of life are “necessary.” It tests whether the model distinguishes a claim from weak support, not whether it preserves unresolved ambiguity.

`NO INVENTORY` and the ranked list are not inherently contradictory—the latter can be an internal priority rule. The real contradiction is `THEIR WORDS BEAT THE STANCE` versus the later absolute instructions “ask, do not tell” and “Signposts—and nothing else.” The outputs show the model following both halfway.

This needs a prompt revision and a new human-read eval. Changing the default away from Balanced would not be enough; Respond and Signposts also fail.

### 2. High — retry/edit preserve stance in storage but lose it in the client

The server implementation of finding 4 is correct. The client is not.

Optimistic retry rebuilds the pending row without `stance` ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1397)); edit does the same ([useChat.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useChat.ts:1430)). The `done` frame does not restore it.

After a fresh load, retrying a Socratic answer can therefore make:

```text
picked = null
lastStance = undefined
stance = balanced
```

The next new turn may silently use Balanced until reload, even though storage correctly retained Socratic.

The plan also explicitly says every answer shows its stance tag ([review-mode.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260827ah-review-mode.md:631)). No such rendering exists.

So finding 4 only appears fixed end-to-end.

### 3. High — the overlay gate has its default backwards

This condition:

```ts
summary?.kind !== "review"
```

treats `undefined` as Chat ([App.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/App.tsx:729)).

Therefore, before summaries load—or when the thread is stale—a Review URL opens the floating Chat dialog. That dialog hardcodes Chat UI and has no stance picker ([ChatDialog.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatDialog.tsx:271)). Because the server now trusts stored kind, it will not corrupt the thread into Chat, but a new turn is sent without stance and becomes Balanced.

A missing thread also sits on “Starting…” forever because `loaded && !thread` is interpreted as a newly minted conversation ([ChatDialog.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ChatDialog.tsx:140)).

The safe test is positive: open the overlay only when the summary kind is known to equal `"chat"`.

This means finding 7’s shared component is fixed, but its overlay half is not.

### 4. High — the required `kind` change leaves the typecheck gate red

Direct no-emit checks passed for root and web, but the test project has four errors caused by Review making `ChatThread.kind` required:

- [chat-client.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-client.test.ts:26)
- [chat-edit-guard.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat-edit-guard.test.ts:49)
- [chat.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/chat.test.ts:597)
- [use-chat-recovery.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/use-chat-recovery.test.ts:90)

There are additional errors from other in-flight work, which I excluded from this finding. These four belong to this change.

### 5. Medium — reviews over 4,000 characters cannot be edited

Retry/edit correctly forbid sending `kind` ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:960)). But the length cap reads request kind ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:978)). Consequently every edit is treated as Chat and capped at 4,000 characters.

A 4,001-character Review may be created but cannot be edited.

The 20,000-character Chat-smuggling example does not create a hole: an existing Chat sent with `kind: "review"` reaches the 409 before storage or model execution. It does incur article/store reads.

Resolve the authoritative thread kind before applying the semantic cap, while retaining the existing 64 KiB body ceiling.

### 6. Medium — import/export code is fixed, but the claimed regression test is not real

The mappings in import and export look correct. The test claim is false.

No eligible round-trip fixture contains a Review thread or stance. `data/test-review-route-fixture` is excluded because test-prefixed directories are skipped. Therefore removing Review’s `kind` and `stance` mappings would not make the round-trip test fail.

The `canonical()` normalization is semantically honest for legacy threads, and it will still catch a Review becoming Chat. But it would hide an exporter dropping `kind` from an ordinary Chat thread. Keep the normalization, and add a positive Review-with-mixed-stances fixture/assertion.

### 7. Low — the route permits stance on Chat rows

A request with `stance: "socratic"` and no Review kind creates a Chat whose assistant row carries that stance. The prompt ignores it, but it violates the declared “review threads only” invariant. The database constraint enforces assistant-only, not Review-thread-only.

Validate that stance is absent when the authoritative kind is Chat.

## The seven-finding audit

| Earlier finding | Result |
|---|---|
| 1. Model treats its reading as truth | Prompt text fixed; actual behavior still fails |
| 2. Balanced infers mental state | Mostly fixed; lost/Balanced tells directly |
| 3. No grading versus inventory | Not fixed in outputs |
| 4. Retry/edit stance ownership | Server fixed; client and stance tags not fixed |
| 5. Thread-authoritative kind and race | Core server path fixed |
| 6. Import/export | Code fixed; regression coverage missing |
| 7. Shared band and overlay | Shared band fixed; overlay still broken |

## Specific questions

`stanceOf(existing.messages[index + 1])` is correct for a well-formed alternating transcript, including the last question. Calling it twice is harmless. A missing answer yields Balanced as intended.

Malformed threads are not handled defensively: a leading assistant is retained as orphan history, consecutive users are accepted, and any immediately following assistant is treated as the answer being replaced. I would reject malformed ordering rather than manufacture a plausible transcript from it.

The 409 mapping is correct: `ChatConflict` becomes 409 in the outer route catch ([routes.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/routes.ts:3466)). In one process, the ordering prevents rejected Review requests from aborting a live answer. Retry/edit validation and pure preflight happen before `settleThread`; a normal-send kind conflict never settles anything. The implemented ordering is right, but [review-route.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/review-route.test.ts:11) does not actually prove “without aborting a live answer”; it checks only the returned status.

Cross-kind navigation is batched correctly by the installed nuqs queue: the two same-tick updates become one URL update and `push` wins. Back should restore the previous paired mode/thread. Rapid clicks should be last-click-wins. The unknown-summary overlay remains the bad case.

The component parameterization is not Dock-style flag soup. `kind` selects minor copy/layout differences while transcript semantics and ARIA roles remain the same. Keep the shared component. Split out mode-specific composer chrome only if the two modes acquire materially different behavior.

## What is missing entirely

- Per-answer stance tags.
- The planned `review-panel.test.tsx`.
- A true Review import/export round-trip fixture.
- A genuinely ambiguous eval case.
- A “just tell me” second-turn eval.
- Client tests for optimistic retry/edit stance, unloaded summaries, stale IDs, Back, and cross-kind navigation.
- A real live-stream assertion that rejected requests do not stop another tab’s answer.

I would not revert the schema, authoritative-kind design, canonical normalization, or shared conversation component. I would withhold Review from shipping until findings 1–5 are fixed.