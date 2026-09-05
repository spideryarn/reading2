# A "?" press is recorded as a request for explanation

**[SPIDERYARN-READING2-1R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1R)** · suggestion ·
reported 2026-09-05 08:10 UTC · **shipped**

## What Greg said

> When I use the Question Mark button in the vertical gutter of a block to ask for further
> explanation, add some simple type-metadata to that Comment to indicate it was a
> request-for-explanation

## The one liberty taken with the wording

The "?" does not make a comment. It makes an **anchored chat thread**, so the metadata lands on the
row that exists rather than on an invented one.

## Where it went, and why not the obvious place

Not a fourth `ThreadKind`:
[260904b § no new `ThreadKind`](../plans/260904b-gutter-help-button-and-detached-streaming-chat.md#no-new-kind)
rejected that after a review, because `kind` gates whether a thread may be anchored and an unanchored
thread draws no mark — and a help conversation *is* an anchored chat. That reasoning survives; only
its "nobody asked for countability" premise expired, because this report is somebody asking.

Not on the thread either, which is where this plan first put it. **GPT Sol's P1:** a thread-level flag
has to be refused on retry, so pressing *"Try again"* on an explanation would have been silently
answered with the ordinary prompt. It is a column on the reader's own request row, and the route reads
intent back from storage rather than from the request body — the rule `kind` and `stance` already
follow.

**Deferred:** any UI for it. The conversation list already has a kind-label surface, so adding one
here would be presentation nobody asked for. And the "?" presses already in the database read `false`
rather than *unknown* — backfilling them means a heuristic `UPDATE` matching real readers' stored
words against two historical prompt wordings, which is Greg's to run, not an unattended migration's.
Both are argued in the plan.

**Plan:** [260905c-gutter-comment-chip-explanation-metadata-and-prompt.md](../plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md)
