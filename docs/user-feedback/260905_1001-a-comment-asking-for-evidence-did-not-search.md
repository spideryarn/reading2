# A comment asking for evidence did not search the web

**[SPIDERYARN-READING2-1X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1X)** · problem ·
reported 2026-09-05 10:01 UTC · **shipped**

## What Greg said

> I added a Comment, asking about evidence for a claim, hoping that it would automatically know to
> and be able to automatically search the web. It didn't seem to do that :(

## Nothing was broken. The model was offered the search and declined it

This report was handed over as a bug in [`explain.ts`](../../src/explain.ts), whose header records
Greg asking for model-invoked search on 2026-08-25. **`explain.ts` is not on this path.** Since
2026-08-28 a comment's *"Also ask the AI"* opens a **chat**; `explain.ts` now serves only the legacy
*Try again* route and glossary lookups.

And the tool does reach the wire — checked three ways rather than read once: `require_parameters:
true` guards against a provider fallback dropping it, `tests/chat-tools.test.ts` asserts on the
serialised `fetch` body, and a chat turn on another article the same morning logged **one** web
search.

**Greg's actual turn is in the production logs**: 10:00:23Z, `rounds:2, tools:2, searches:0`. The
model ran two of our own tools and no web search.

The cause is the instruction. Chat's system prompt gives search one bullet — and the *next* bullet
says *"DO NOT reach for a tool to do something the article in front of you already answers."*
`explain.ts` gives it a titled section headed **LEAN TOWARDS SEARCHING**. *"What is the evidence for
this claim?"* is exactly the question that looks answerable from the article, so the chat prompt
talked the model out of the search the explain prompt would have talked it into.

## What shipped

The evidence case named as a search trigger, in `explain.ts`'s own words, and the counter-pressure
bullet narrowed to *what a paragraph plainly says* rather than anything the article touches.

Two things found on the way, both fixed:

- **An alarm that could never sound.** `explain.ts` can never log `searchesFrom: "neither"` — the
  tripwire its own comment says exists to catch OpenRouter renaming the usage field. Production
  prints `"no-usage"` today *beside populated token counts read from the same object*. Textbook
  [silent-success](../reusable/silent-success.md): a check nobody has seen fail.
- **A button that always failed.** `CommentDialog` offered *"Search the web"* on free comments, which
  the server refuses with *"was never a question, so there is nothing to answer"*. A reader who
  comments asking for evidence and presses it was told their comment was never a question.

**Deferred:** a search tick-box on the comment box, auto-sending the pre-filled chat question, and
routing comments back through `explain.ts`. All three reopen decisions Greg made deliberately on
2026-08-26/28 — nothing is bought without a press — and none is needed if the wording works.

## Honest limit

Production Postgres is unreachable from this box, so the event above is read from runtime logs rather
than from `ai_calls`; the logs carry the same `searches` number. **And nobody has watched the new
wording actually produce a search on Greg's article.** A prompt change is a change in odds, not a
guarantee, so if it still does not search, this deserves a new report.

**Plan:** [260905c-gutter-comment-chip-explanation-metadata-and-prompt.md](../plans/260905c-gutter-comment-chip-explanation-metadata-and-prompt.md)
