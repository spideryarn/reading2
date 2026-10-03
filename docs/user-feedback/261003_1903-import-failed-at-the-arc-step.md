---
reports: spya-x4zut6
ending: shipped
---
# An import failed at the arc step, 0.7 seconds after it started

Report `spya-x4zut6` (SPIDERYARN-READING2-BH), a problem, from Greg (admin, production row
proven), 2026-10-03 19:03 UTC, the pre-filled failed-import report from the home page, queue item
`qi-bj949xn6`. He left "What I expected" empty:

> This import failed.
>
> Job: spya-srcm53
> Article: we-must-pace-the-frontier-spya-qhda2b
> Status: error
> Failed at step: arc
> Failure kind: retry
> Added: 2026-10-03T15:09:41.688Z
> Started: 2026-10-03T15:09:59.095Z
> Ended: 2026-10-03T15:09:59.796Z

**Ending: Shipped**, on `dev`, not deployed. Plan:
[261003m](../plans/261003m-a-transport-blip-fails-an-import-one-countable-retry-on-the-messages-wire.md).
Postmortem:
[261003f](../postmortems/261003f-a-removed-retry-whose-replacement-was-a-sentence-in-a-comment.md).

## What it was

The article imported fine. The job that failed was one of ten that write its modes afterwards, the
one for Arc. Its call to the AI service failed 595 ms in, with no HTTP status: the connection
dropped, or the stream opened with an error. Nothing retried it, so the job failed. Nine sibling
calls in the same seconds worked.

The gateway had its automatic retry switched off on 2026-08-28, for a sound accounting reason, with
a comment saying the pipeline retries at the step level. Nothing does, except a person pressing
Retry.

## What changed

- **A call that fails before the answer begins is tried again**, up to three goes, about half a
  second and then a second and a half apart. This covers every pipeline mode, not only Arc. Each go
  is its own row in the cost ledger.
- **The log says what happened.** It used to say "status 503" for a failure that had no status.
  It now says the connection failed, timed out, or the stream carried an error.
- A failure that would come out the same a second time (a refusal, no credit, a bad request) is
  not retried, and nor is a rate limit, which has its own handling.

## What was not done

- **The failed job itself is untouched.** Nothing here writes to production. Pressing Retry on the
  card, or opening Arc on the article, writes it.
- **The other AI wires** (chat, explain, search) were not audited for the same gap: queue item
  `qi-wwhdcejd`, a proposal awaiting Greg.
- **A call that dies part-way through its answer still fails its step.** Retrying that means
  paying twice, which is Greg's decision; it is named in the same queue item.
