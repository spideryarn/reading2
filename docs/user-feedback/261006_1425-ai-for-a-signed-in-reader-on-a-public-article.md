---
reports: spya-uc0asn
ending: shipped
comment: You chose B: a signed-in visitor can add a private copy of a public article to their own shelf and use AI there. AI in place on someone else's article (C, D, E) is not for now, as you said on 2026-10-07.
---
# AI for a signed-in reader on a public article

Greg's report (admin, proved by `feedback-reporter.ts` exit 0 against the production row; the
Sentry event itself was not matched), `spya-uc0asn`, SPIDERYARN-READING2-DY, filed 2026-10-06
14:25 UTC from a public article:

> I'm wondering if we should allow AI processing (e.g. search) if they are logged-in on a public article?
>
> Would that create extra complexity? If not, and if you think it's a good idea, proceed.

**Ending: Shipped** (since 2026-10-08; it was Awaiting Greg until he answered). Greg chose option
B, built as [261007m](../plans/261007m-a-private-copy-of-a-public-article-on-your-own-shelf.md)
(`47212c640`, queue item `qi-jp2r4be8`), and on 2026-10-07 said no to the rest for now:

> it's fine if signed-in visitors reading someone else's public articles can't use AI modes for now

Recorded in [261006k](../plans/261006k-signed-in-reader-ai-on-someone-else-s-public-article.md)
and `q-re2u3r`. Resolved in Sentry by the feedback sweep, 2026-10-08.

What follows is the note as it stood while the report awaited Greg.

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

**The question for Greg is now a file**, `docs/user-feedback/questions/q-re2u3r.md`, moved there from
`awaiting-approval.md` on 2026-10-07. He sees it in the Feedback dialog and replies there
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).
