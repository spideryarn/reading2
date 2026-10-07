# A post-write read can belong to a new attempt

Caught during the write-capable review of [seventh sweep C4](../plans/261007b-seventh-sweep-chat-and-comment-invariants.md),
before this stage was shipped. No reader incident was established. Commit `d3a25af1d` fixed stale
reader fields in explanation frames by using the row returned after the answer UPDATE. It also
made a successful stream able to end on a pending row, leaving a spinner with no watcher.

## The class: a later read mistaken for the result of a particular write

`pgCommentStore.patch` writes the terminal answer and clears its attempt token, then separately
reads the article's comments. Another tab can claim the same comment between those statements.
That claim clears the answer and sets `pending`; the returned list now describes the replacement,
even though the first write succeeded. `settle` framed it as `done`, and `useComments` accepted its
pending status and returned. This tab watches only its own response, so the replacement finishing
in another tab cannot stop its spinner.

The root cause was treating a current row as evidence of the operation that produced it. The
row identity survived; the attempt identity did not. The existing refused-write branch has the
same watcher limitation, but successful writes previously always framed their own terminal state.

## Why the original checks agreed

The new server regressions edited reader columns during one attempt. Each ended with that same
attempt still owning the terminal answer. Their current-row oracle could not distinguish a row
reclaimed by another attempt. They also created only one comment, so selecting the first list
entry instead of the matching id would pass.

The review's real-route unit test supplied a pending matching row after a successful write. Both
success and failure cases failed on status; sibling, newer-terminal and deleted-row controls
passed. The route and client suites now pass. The Postgres twins could not run in the review's sandbox; run afterwards, they were red without
the fix (2 failed, 8 passed) and pass with it.

## Fix and countermeasures, ranked by ease against value

1. **Exercise a generation change between write and read.** Done in
   `tests/comment-answer-terminal-frame.test.ts`; two Postgres twins exercise real claim/write
   contracts in `tests/comment-answer-stream-lifetime.test.ts`. Also include a sibling row to
   distinguish id matching from list position. Small, no new infrastructure.
2. **Separate current reader fields from this operation's terminal answer.** Done in `settle`:
   a successful write followed by a pending read frames current reader fields with its own
   committed terminal answer. A newer terminal result remains unchanged. This preserves the
   prior successful-stream behavior while keeping the reader-field correction.
3. **Return the write's row atomically.** A useful long-term store contract if more callers need
   operation-specific results; rejected for this review because it changes the store interface
   and would require deciding how to obtain concurrent reader edits.
4. **Adopt replacement attempts with a watcher.** Rejected for this stage: it adds a separate
   recovery protocol and expands the fix into the existing refused-write behavior. That wider
   limitation is reported to the orchestrator.

The distinction to preserve is whether a response describes this write or a later observation.
An unchanged id does not establish an unchanged operation.
