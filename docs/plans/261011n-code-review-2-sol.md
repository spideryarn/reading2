R1 — P2 — Illustration-note-derived checkpoint survives transfer. `resetRevisionReaderState` removes the stored illustration, but `checkpoints` still moves with the article ([pg-article-transfer.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-article-transfer.ts:137)). The `illustrated-brief` checkpoint stores the model’s raw brief ([pipeline.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/pipeline.ts:1848)), which can repeat the reader’s steering note—the same reason given for removing `illustrated` ([pg-article-transfer.ts](/var/tmp/spideryarn-worktrees/fbwqvxjv-gift-url-and-ownership/src/store/pg-article-transfer.ts:403)). It is not currently exposed to the recipient and cannot be reused by a new press because its key includes the old job id, so this is P2 rather than P0/P1. Delete the article’s `illustrated-brief` checkpoint rows during transfer; they are unusable after the move anyway.

Everything else checks out:

- C1: illustration-note detection and `own-words` refusal are appropriate.
- C2: neutral filenames violate no constraint, preserve upload detection, and do not affect blob lookup, which uses source hash and kind. The new owner’s source download still works under the neutral name.
- C3: `publicSourceUrl` is the established stranger-safe provenance boundary. URL nulling violates no constraint; stored source bytes still support re-extraction. An unsafe web URL can no longer be refetched, which is the necessary privacy trade-off.
- Null `illustrated` is handled as the ordinary “not made yet” state.
- The other moved tables contain article content, deterministic derivatives, or internal bookkeeping—not additional reader-authored fields. Profile-shaped artefacts moving is the existing deliberate sharing policy; public DTOs remove their profile hashes.
- C4 correctly refreshes the displayed owner, clears a target that became the owner, and sends the refreshed `expectedFrom`.
- C5/C6 are bounded to one request per slug/reader per mount, do not loop after rereading, and suppress stale completions after reader or slug changes.

Checks: focused jsdom suites passed, 13/13. Database-backed suites could not be rerun because local Postgres was inaccessible; the supplied 108-pass private-lane result covers them. No files were edited.

VERDICT: LAND AFTER FIXES