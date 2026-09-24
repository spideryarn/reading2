# A "?" answer that arrived in a burst was replaced by React error #185

**SPIDERYARN-READING2-3X** (2026-09-12 11:20Z), Greg, in production (`build_commit d358f773`), on
`temporal-context-reinstatement-spya-dhqkf9` with Summary open and a glossary term selected. Overseer
queue item `qi-tcxxvsvm`.

**Ending: shipped** — on `dev`, 2026-09-15.

> In a question mark comment response. Minified React error #185; visit
> https://react.dev/errors/185 for the full message or use the non-minified dev environment for full
> errors and additional helpful warnings.
>
> — Greg, 2026-09-12

## What we did

Not a render loop, which is why nobody could find one. The chat store behind the "?" told React
about every streamed word synchronously, and when an answer arrived **already buffered** — a busy
iPad, a provider flushing a batch — fifty-odd words became fifty-odd back-to-back commits, which
React 19 counts as nested and refuses past fifty. The throw came out of the store inside the stream
loop, so the chat printed React's sentence as the answer's failure. The server had finished the
answer; the client lost it.

Reproduced red in jsdom and in a real browser. The fix is at the store: it tells React at most once
per browser task, while its own state stays synchronous. The plan, the evidence and the design
are in [260915a-question-press-answer-does-not-loop.md](../plans/260915a-question-press-answer-does-not-loop.md);
the class is written up in
[260915a](../postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md).

Two things it turned up, recorded in the plan and not built here: the reader being shown a foreign
exception's text as a failure message (`describeFetchFailure`), and a render-phase update warning
under `SignedIn` on every page load in development.

The Sentry status write is the next sweep's — this session ran on a pool account.

2026-09-24: the first of those two is built — a foreign exception's text no longer reaches a reader
through `describeFetchFailure`; it gets the page's own `[web-unexpected]` sentence instead, and goes
to Sentry with its message withheld.
[260924a](../plans/260924a-only-a-sentence-the-server-wrote-reaches-the-reader.md).
