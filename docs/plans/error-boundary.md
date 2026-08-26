# One shape for a failure, and a test that proves it

**2026-08-26.** Written after a fourth round of the same bug. Not built yet;
this is the argument and the design, for Greg to weigh.

## The thing that keeps happening

Text this app did not write — a provider's error body, a model's output, the
article's own prose — keeps finding its way into a log line or onto a reader's
screen. It has been found and fixed four times:

| Round | What was closed | Sites |
|---|---|---|
| 1 | OpenRouter HTTP error bodies (`providerRefused` and friends) | 7 |
| 2 | Anthropic `stop_reason: "refusal"` payloads (`MODEL_REFUSED`) | 6 |
| 3 | The Anthropic SDK's **request** failing (`anthropicCallFailed`), plus `labels.ts` throwing model output and `vercel.ts` publishing whatever escaped | 8 |
| 4 | **Two dependencies printing for us**: JSDOM's default console quoting the page, and the Anthropic SDK's own `ANTHROPIC_LOG` logger printing whole articles | 2 |

Each round closed every site it was looking for. Each was followed by another.
And the habit written down to prevent it —
[simplification-audit.md](simplification-audit.md) Rule 1, *grep the genre, not
the list* — was itself written after an undercount, by the person who then
swept by list twice more. **Writing a rule down is not the same as applying
it**, and a rule that depends on remembering will be forgotten at exactly the
moment it matters.

So this is about replacing the habit with something mechanical.

## The one still open, and it is the worst of them

**Drizzle puts every bound parameter into `Error.message`.**
`node_modules/drizzle-orm/errors.js` builds a failed query's error as:

```
Failed query: <the SQL>
params: <every bound value>
```

In `postgres` mode the comments store is live
([`store/index.ts`](../../src/store/index.ts)), and it binds **the reader's
selected quote** on create and **the model's whole answer** on completion. So a
failed insert produces an error whose message contains the article; the route's
ordinary catch returns `err.message` to the reader and logs the same error.

The completion path is worse than that. When the update fails, the route copies
the message into `patch.error` and tries to persist *that* — so the second
query binds an error string that already contains the model's answer, and
Drizzle flattens it into a second message. The article ends up nested two deep
in an error that is then stored, streamed in the `done` frame, rendered in the
dialog, and logged.

Pino's `params` redaction cannot help: by then the values are flattened into
`message` and `stack`, and redaction matches key paths, never text.

**This is latent rather than live** — the checked environment defaults to
filesystem storage — but the Postgres migration is what this repo is currently
building, so it becomes live on the day that switch flips. `pg-chat.ts` and
`pg-searches.ts` have the same shape and are not yet wired.

## The rule worth adopting

GPT Sol's proposal, which is better than anything the four rounds produced:

> No arbitrary `Error`, and no arbitrary string, may cross an HTTP, SSE, log, or
> persisted-error boundary.

Concretely, a closed type at every egress:

```ts
type PublicFailure = { code: FailureCode; retryable: boolean };
```

- HTTP and SSE accept `PublicFailure`, never `Error`.
- Stores persist an `errorCode`, not a message.
- The reader's sentence is looked up from that code — which is
  [`src/messages.ts`](../../src/messages.ts) already, arrived at from the other
  direction. `kindOfMessage` exists because the kind was thrown away and had to
  be recovered *from* the sentence; with a code on the wire it would not need to
  exist.
- Legacy stored strings map to `unexpected` on read and on import.
- Logging keeps the error's class and allowlisted codes, and drops the message,
  the cause text and the stack's first line.
- Every third-party error — Drizzle, `pg`, `undici`, the SDKs — is translated
  once, at its own adapter boundary.

**Note what this costs**, because it is not free and it is the reason to think
rather than just agree: a stored code cannot say anything a code does not
already cover, so the fifteen sentences in `messages.ts` become the whole
vocabulary of failure, and adding a new one becomes a code change rather than a
string change. That is the trade — expressiveness for a boundary that a person
cannot forget.

## The test that would actually settle it

The part worth doing first, and worth doing even if the type never happens: a
**sentinel non-interference test**. Put one unmistakable string into every
untrusted input at once —

- article HTML, and a malformed `@import` in it
- the reader's selected quote
- an OpenRouter error body, a malformed frame, the `model` field, a tool call
- an Anthropic prompt and an API error, with `ANTHROPIC_LOG=debug` set
- a Drizzle bound parameter and a driver failure
- a stored `error` field from a legacy record

— then capture stdout, stderr, Pino's output, every HTTP body, every SSE frame,
every persisted file and row, and the browser console. **Assert the sentinel
appears only in the channels that exist to carry it**: the rendered article, and
a model's answer.

That is one test that replaces a habit. It would have caught all four rounds,
including both dependency leaks, neither of which any amount of grepping our own
code would have found.

## What to do next

1. **Build the sentinel test first.** It is the cheap half and it is the half
   that keeps working when nobody is thinking about this.
2. **Translate at the Drizzle boundary** before the Postgres switch flips —
   before it matters, rather than after.
3. Consider `PublicFailure` once the test exists and can prove a migration to it
   is not a regression.

## See also

- [logging.md](../project/logging.md) — the four rounds, and what each one was
  looking for
- [security.md](../project/security.md) — the two untrusted parties this is about
- [copy.md](../project/copy.md) — the sentences a code would look up
- [postgres-storage-implementation.md](postgres-storage-implementation.md) — the
  migration that makes the Drizzle leak live
