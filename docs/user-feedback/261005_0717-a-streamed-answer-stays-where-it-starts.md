---
reports: spya-nq847n
ending: shipped
---
# A streamed answer stays where it starts

A suggestion from Greg (an admin's report, proved by `scripts/feedback-reporter.ts`), Sentry
`SPIDERYARN-READING2-DA`, queue entry `qi-asc74kfd`. 2026-10-05 07:17 UTC, sent from
`/changelog#release-129`:

> When I ask a question in a chat or a comment, it starts streaming in the output response from the
> AI. That's great. The problem is that it immediately starts scrolling down so I can't read from the
> beginning of the response. What I would prefer is if it streams in, but stays in position so that I
> can start reading without having to scroll back up to the beginning of the response.

**Ending: shipped.** On `dev`, not deployed. No migration. Nothing deferred.

What we did, in [261005f](../plans/261005f-a-streamed-answer-stays-where-it-starts.md):

- **The transcript no longer follows the arriving text.** When a question is sent it is put at the
  top of the panel once, and the answer fills the panel under it. From the first word to the last,
  and when the answer finishes, the first line stays where it was.
- **It is one fix for both halves of the report.** Chat in the band and the block chat a `?` opens
  ("a comment") are the same component. Remember and Explore get it too.
- **"Latest" appears when the answer runs past the bottom of the panel.** One press goes to the end;
  it does not start following.
- **The selection comment box was measured and already stays put**, so it is unchanged.
- **Unchanged on purpose:** a Live conversation's spoken words still follow, and opening a finished
  conversation still shows its end.

The rule is written down in
[comments.md § And it stays where it starts](../project/comments.md#stays-where-it-starts).
