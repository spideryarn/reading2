---
reports: spya-rvbmss
ending: shipped
---
# Two readers import the same article

`spya-rvbmss`, filed as a suggestion by Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-06 21:35 UTC, from `/changelog` (where the dialog was opened; the subject
is importing). Sentry `SPIDERYARN-READING2-E4`. Overseer queue item `qi-z93rkwjm`. This session
has no Sentry sign-in and did not write the Sentry status; the next feedback sweep does.

> I was trying to think what should happen if two people try and import the same article. Well, I
> feel like that seems straightforward enough. They should both have their own copy with their own
> AI processing. Okay, what if one of them imports a public article? Well, I think that's also
> fine. One of them has a public article and one of them has their own copy with their own
> processing. What about if they both get made public? Well, maybe then we have two versions of the
> same article public. I mean, it seems sort of wasteful and weird, but I couldn't see a better way
> of dealing with things because the two public articles might have slightly different AI
> processing, especially if, you know, one or both of these has had a profile. I mean, if you can
> see a better cleaner way forward, then let's discuss it. Otherwise, I just want to make sure that
> this will all function correctly. and consider other related edge cases too.

**Ending: Shipped.** On `dev`, not deployed. The design questions are a deferred half with their
own queue entry (`qi-a8wyhr67`) and a question file, `docs/user-feedback/questions/q-bmt755.md`
(moved there from `awaiting-approval.md` on 2026-10-07), which Greg sees and answers in the
Feedback dialog
([feedback-reports.md § Asking Greg a question](../project/feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer)).

What we did, in
[261007f](../plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md):

- **It already worked as you describe.** Each import is its own article with its own address, AI
  output, sharing setting and charge; both copies may be public; one reader deleting or unsharing
  leaves the other's copy, pictures and link intact. Production today: one article held by two
  accounts, none public twice.
- **Now there are tests that would go red if it stopped**: two files that run all of it with two
  accounts against Postgres, each guard removed in turn and watched failing. The facts are in
  [library.md § Two readers, one article](../project/library.md#two-readers-one-article).
- **Two things fixed beside it.** A new article's random id could equal an existing one's, and
  the import then failed with Retry failing again; it is now checked first. Pasting somebody's
  Spideryarn link into Add is refused before a slot, with a sentence saying to open it or paste the
  original address.
- **Two questions for you**, neither urgent: whether two public copies of one article should still
  show as two identical cards, and whether Citations should prefer your own copy over a stranger's
  surer match. Recommended: leave both as they are for now.
- **Queued, found on the way**: a stuck-looking import when a rare refusal happens as a job starts
  (`qi-d6r5xamd`), and the Add page saying the text "has been sent" to a model provider when the
  paste was refused (`qi-9x3akt5n`).
