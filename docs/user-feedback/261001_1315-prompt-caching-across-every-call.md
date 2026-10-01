---
reports: none
ending: shipped
---
# Prompt caching across every call: measured, mostly left alone, and now checked on both wires

Not from a reader. The Overseer dispatched it from Greg, 2026-10-01: *"look for ways we could
restructure prompts and/or improve the way we're calling the AI to make much more effective use of
prompt caching across the board."* There is no Sentry id. The time in the file name is when this
session received the brief.

**Ending: Shipped**, as documentation, an eval and a test. The commits are listed in
[261001l](../plans/261001l-prompt-caching-across-every-call.md), the plan. Nothing a reader sees
changes. Not deployed: the Overseer deploys, and the change needs no deploy.

What was found, in plain words:

- **The money is small.** Production spent $72 in thirty days. The best any caching change could
  have saved was a few dollars of that.
- **The article-reading modes have never cached anything in production.** Each mode is its own job,
  and a mode marks the article for caching only when a sibling runs in the same job. That rule exists
  so that we never pay extra to store something nobody reads, and on these numbers it is roughly
  right.
- **Only the import burst could gain, and it is worth very little.** The add page starts every main
  mode at once, but only two pairs can share a cached article: tweets with ideas, and glossary with
  quotes. Together they are worth about 2.6¢ an import. Collecting it would need coordination between
  jobs, and there is no reliable signal for when the cache becomes readable. So it was dropped, on
  GPT Sol's review and Greg's "sparingly, and for good reason".

What landed:

- **prompt-caching.md**:
  - the groups table is corrected;
  - a new section says what production actually does;
  - the one-hour cache is worked out against not caching at all, and it does not pay here;
  - Simple's stagger is named as the pattern for a mode that makes several calls over one article.
- **new-mode.md** has an "Its cache group" item.
- **`npm run eval:caching`** reads articles from the database again. It also gained a pipeline-wire
  check with a negative control, and that check has passed twice on a real article.
- **A test** proves that a real job marks both members of a cached pair and leaves a lone mode
  unmarked. It was seen to fail when the wiring was broken.

Spend: $0.77 of a $15 budget.

**Awaiting nobody.** If the import pairs are to be cached anyway, the cheapest version is to post each
pair as one job. That makes Quotes wait for Glossary, and Ideas wait for Tweets, on every import, to
save about a dollar a month at today's volume. It is written up in the plan as declined, to be
revisited when real post-2026-09-30 data says otherwise.
