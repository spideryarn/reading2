The plan needs rework before implementation. The core product shape fits Greg’s request, but it currently violates the timestamp rule and mishandles hidden hint text in retries, copying, Live, and `reader_notes`.

### F1 — P1 — Opening a hint must be recorded now

**Evidence: established.** The plan recommends leaving the press browser-only and deferring persistence ([plan:95](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md:95>)), but the repository’s authoritative rule says anything a reader does gets a timestamp even if nothing reads it yet ([AGENTS.md:456](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/AGENTS.md:456>)).

**Suggested change:** Store the first press as something like `chat_messages.hint_opened_at`, using a background request and `coalesce(existing, now())`. Using that fact to adapt Recall can remain deferred; recording it cannot. Reframe the open question as “When should Recall use the recorded press?” Include migration, route, ownership checks, type/store/export coverage, event-time tests, and clearing the timestamp when retry reuses the answer row.

### F2 — P1 — Retry will not reset an open hint

**Evidence: established.** The plan says open state resets because it is keyed to the message ([plan:154](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md:154>)). In fact, retry deliberately reuses the same assistant message id ([chat.ts:608](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/chat.ts:608>)), and `Turn` is keyed only by that id ([ChatPanel.tsx:1224](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1224>)). React state would survive, revealing the replacement hint automatically.

**Suggested change:** Key the disclosure state by attempt identity, such as `message.id + message.createdAt`, or explicitly close it when a new attempt begins. Add a test that opens a hint, retries the same message id, and observes the replacement hint closed. Also null `hint_opened_at` during retry.

### F3 — P1 — Copy would include a hint the reader has not seen

**Evidence: established.** The copy action receives the raw `message.text` ([ChatPanel.tsx:1657](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/ChatPanel.tsx:1657>)). Thus a closed disclosure would copy the hidden `Hint:` paragraph.

**Suggested change:** Split in `Turn`, not inside `Answer` or `CitedMarkdown`, so rendering and copying share `{ body, hint }`. Pass `kind` from `Conversation` into `Turn`; currently `Conversation` knows it but does not pass it at the call site. Copy the body while closed; explicitly decide and test whether an opened hint is also copied. `CitedMarkdown` should remain unaware because it is shared by unrelated modes ([Cited.tsx:73](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/Cited.tsx:73>)).

### F4 — P1 — Other consumers treat an unseen hint as ordinary conversation

**Evidence: reasoned from established data paths.**

| Consumer | Current result | Assessment |
|---|---|---|
| Typed Recall history | Raw hint is sent back at [converse.ts:1885](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/converse.ts:1885>) | Acceptable only with the proposed “do not assume it was read” rule pinned by a test. The 20-turn trimming remains correct; hints merely add at most about 500 words. |
| Live seed | Removes block ids but keeps `Hint:` and its body at [live.ts:507](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/live.ts:507>) | Wrong. `LIVE_SYSTEM` knows nothing about hidden hints, so voice receives unseen text as normal prior conversation. |
| `reader_notes` transcript | Flattens raw answer text at [reader-notes.ts:429](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/reader-notes.ts:429>) | Wrong. Explore can describe a clue as something the reader was given even when they never opened it. |
| Explore’s automatic digest | Contains only the conversation index, not transcript text ([reader-notes.ts:337](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/reader-notes.ts:337>)) | Unaffected. The problem begins only when Explore calls `reader_notes` for the thread. |
| Export | Preserves raw text at [export.ts:630](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/store/export.ts:630>) | Correct: this is lossless stored data, not a claim about visibility. Add `hintOpenedAt` to the named-field projection. |
| Titles and summaries | Title comes from the reader; `lastLine` takes the answer’s first line ([routes.ts:4322](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/routes.ts:4322>)) | Unaffected by a trailing paragraph. |
| Search/public surfaces | There is no conversation full-text search; public reads exclude `chat_messages` ([public-reader.ts:545](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/store/public-reader.ts:545>)) | Unaffected. |
| Citation counters | `unknownIds` and cited-block logging inspect the whole raw answer ([converse.ts:3167](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/converse.ts:3167>)) | Correct: a revealed hint’s broken chip is still a broken citation. |

**Suggested change:** Define projections deliberately: raw text for storage/export; body plus explicit “hint opened” state for Recall history; omit an unopened hint from Live and `reader_notes`, or label it as hidden and not known to have been opened. Add tests for both downstream paths.

### F5 — P1 — `splitHint` has both false positives and predictable false negatives

**Evidence: reasoned.** The proposed test is merely “final paragraph begins `Hint:` and body is non-empty” ([plan:51](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md:51>)).

That means:

- A direct answer, historical Recall answer, or spoken transcript legitimately ending in `Hint:` is silently hidden even when there is no nudge.
- Spoken and typed messages are not reliably distinguishable: spoken-only fields are optional ([chat.ts:450](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/chat.ts:450>)).
- `**Hint:**`, `Hint -`, indentation, or a marker in the middle fails open and shows the hint before the attempt.
- A recognized hint followed by another paragraph will first hide and then reappear during streaming.
- A stream that stops at `Hin` must release those characters once it becomes done/error; the planned test does not state that.

**Suggested change:** Only split when the body itself has the complete nudge contract: a final interrogative sentence and its adjacent valid article id. Keep exact `Hint:` as the reserved spelling and make all deviations intentionally fail open; measure how often the model deviates. Tests should cover bold/dash variants, CRLF, whitespace, no-question direct answers, spoken-looking answers, a middle hint, later paragraphs, empty hint bodies, and partial prefixes becoming done/error.

### F6 — P1 — The proposed prompt additions conflict with existing absolute rules

**Evidence: established.**

- Existing length is an unconditional 120-word ceiling and “one short paragraph, sometimes two” ([converse.ts:912](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/converse.ts:912>)); the plan puts 25 more words outside it ([plan:72](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md:72>)).
- The nudge may name where and what, “never what it said” ([converse.ts:852](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/converse.ts:852>)); the hint deliberately reveals more.
- Every statement about what the article says must carry an id ([converse.ts:635](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/converse.ts:635>)); “the hint may carry a block id” is too weak.
- The one-question-mark rule is compatible because the hint is a statement.

**Suggested change:** Put this immediately after the nudge’s hard limits, where it can expressly override only the relevant rule:

> THE NUDGE’S QUESTION CARRIES ITS OWN PASSAGE. Put the id of the passage containing the answer inside the interrogative sentence or immediately after its question mark. An id elsewhere in the correction or hint does not count.

Then:

> A HINT, HIDDEN UNTIL OPENED. When and only when the reply contains a nudge, follow its question with one final paragraph beginning exactly `Hint:`. The hint is one statement, at most 25 words, and is outside the reply-body ceiling. It may go one rung beyond the nudge’s “never what it said” rule, but must not state the answer. Any claim about the article carries its block id. Never assume the reader opened it.

Revise `LENGTH` to call 120 words the **body** ceiling and allow the one final hint paragraph. This creates no conflict with `ASK ONLY WHERE YOU COULD HAVE TOLD`. Nor is there an inherent conflict with quotation flash: a quoted hint with its citation will narrow the flash as intended; a question id placed after `?` will still jump to the paragraph, though the question mark prevents an earlier quotation from becoming the narrow flash target ([citations.ts:204](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/src/web/citations.ts:204>)).

### F7 — P2 — The proposed eval would misreport valid replies and can silently count the wrong link

**Evidence: established.** The existing eval defines a nudge as a question at the absolute end of the reply ([remember-recall.ts:299](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/evals/remember-recall.ts:299>)) and counts every word against 120 ([remember-recall.ts:362](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/evals/remember-recall.ts:362>)). Every correct hinted response would therefore be reported as not ending in a question, and hint words would create false length warnings.

A naive “question plus an id somewhere” heuristic would also pass when only the correction or hint is cited—the failure this feature exists to catch—or when the adjacent id is invented and therefore not clickable.

**Suggested change:**

- Split first; measure question-ending and 120-word ceiling on `body`, and the 25-word/no-question constraints on `hint`.
- Check the id adjacent to the actual interrogative sentence against the article’s known-id set.
- Unit-test the heuristic with: correction id only; hint id only; unknown question id; id inside question; id immediately after `?`; and clarification with no nudge.
- Put a hint into the `justTellMe` and `nudgeFailed` history fixtures, otherwise “do not assume it was opened” is never exercised.
- Add panel tests for citation click/navigation, copy, retry with the same message id, a spoken/direct false positive, and prefix release after stop/error.
- Make prompt tests assert that the old unconditional ceiling and “question last” wording were revised, not merely that new headings coexist with them.

### F8 — P2 — Holding back `H`, `Hi`, and `Hin` is premature complexity

**Evidence: reasoned.** The plan adds special streaming-prefix behavior solely to prevent a momentary marker flash ([plan:59](</home/greg/code/spideryarn2/.claude/worktrees/fbfryxrf-recall-block-link-and-hint/docs/plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md:59>)). It creates extra transient states and failure tests before there is evidence the model/provider ever streams the label as visibly separate chunks.

**Suggested change:** For v1, switch to the disclosure only once the complete blank-line-plus-`Hint:` marker arrives. Accept a possible brief `H` unless the browser pass demonstrates it. If buffering remains, specify and test release on mismatch, stop, error, and completion.

The underlying product choice—pre-generate one tailored hint in the same call, hidden behind Greg’s requested button—is otherwise the simplest shape that satisfies both parts of his report. The alternative of revealing the cited passage itself is simpler technically but often gives away the answer, while a second call adds latency, cost, and a synthetic turn.

VERDICT: rework