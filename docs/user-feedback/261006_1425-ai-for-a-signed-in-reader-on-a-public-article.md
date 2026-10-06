---
reports: spya-uc0asn
ending: awaiting
---
# AI for a signed-in reader on a public article

Greg's report (admin, proved by `feedback-reporter.ts` exit 0 against the production row; the
Sentry event itself was not matched), `spya-uc0asn`, SPIDERYARN-READING2-DY, filed 2026-10-06
14:25 UTC from a public article:

> I'm wondering if we should allow AI processing (e.g. search) if they are logged-in on a public article?
>
> Would that create extra complexity? If not, and if you think it's a good idea, proceed.

**Ending: Awaiting Greg.** Nothing built. Mark it ignored in Sentry with this reason; the next
feedback sweep does the status write.

The answer to his question is yes, it adds complexity. A signed-in reader spending model calls on
an article they do not own is a third kind of request the server has no place for, and every
version of it edits a listed security defence, which an unattended session does not do.

The plan sets out five options and recommends three in order: two small things first that edit no
defence (an "Add a private copy to your shelf" button for a signed-in visitor, and the free words
search for every visitor), then a quick search in place with a daily limit. Two questions are put
to Greg: which option, and whether a signed-in reader's quick search is free with a daily limit or
draws on their allowance.

Queue entry `qi-qw7tggag`. Plan:
[261006k § Questions for Greg](../plans/261006k-signed-in-reader-ai-on-someone-else-s-public-article.md#questions-for-greg),
reviewed by GPT Sol
([review](../plans/261006k-signed-in-reader-ai-on-someone-else-s-public-article-plan-review-sol.md)).
