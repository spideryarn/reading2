---
reports: spya-fyj3m4
ending: shipped
---

# Light tidying of an article's title at import

Report `spya-fyj3m4`, from Greg (an admin; the production row, read with
`feedback-unswept.ts --show`, says `admin`), filed 2026-10-04 20:39 UTC from Structure on
`rovelli-order-of-time-7098a4fca8e95ec987b96f1c97-spya-r26sug`; Sentry event
`0fe4943b8d4d4124bfc43a5cd0f8906d`; relayed by the Overseer to session
`fbfyj3m4-import-title-tidying`. A suggestion.

> As part of the import process, could we apply very light editing to the article title (e.g. this
> one is in all caps) to make them more consistent and readable. Ideally follow the author's intent
> and don't change the contents substantively unless they're obviously e.g. broken/missing/not the
> real title/etc.
>
> Use Sonnet for web research on the best practice for title capitalisation, formatting,
> capitalisation, punctuation, etc etc.

**Ending: Shipped**, on `dev`. Plan
[261005g](../plans/261005g-tidy-an-imported-title-and-keep-the-original.md); research
[261005c](../research/261005c-title-capitalisation-and-light-tidying-at-import.md).

A title wholly in capitals becomes title case at import, and trailing footnote markers come off.
There is no model in it. The original is kept beside the tidied title, and the Metadata page shows
it with a button that puts it back.

Not built, and waiting on Greg as two questions in the plan: whether a small model should do the
recasing (`[Q-title-model]`), and whether articles already on shelves should be tidied
(`[Q-title-backfill]`). The second includes the article this report was filed from, which keeps its
capitals until it is renamed or imported again. The Overseer was asked to queue both.

**2026-10-05, both answered.** A small model: yes, built as
[261005j](../plans/261005j-a-small-model-tidies-an-imported-title.md), with the rule as its
fallback. A backfill: no, "just articles going forwards". So the article this report was filed from
keeps its capitals until it is renamed or extracted again.
