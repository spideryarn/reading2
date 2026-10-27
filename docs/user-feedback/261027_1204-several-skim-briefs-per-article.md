---
reports: spya-xyje0z
ending: shipped
comment: Skim now holds several briefs per article. The "Reading for" line has a ▾ that switches between the default and briefs you add, and lets you edit, delete or add one. Each brief gets its own route. Real routes for added briefs can be planned from 1 November, once the model key resets (qi-wthdvazd).
---
# Several Skim briefs per article

> Could we allow for multiple Skim briefs, i.e. a default one (perhaps based on user profile + why
> you're reading), with the option to add one or more new briefs, and then select between them
> (kinda like how you can choose between Chat threads).
>
> — Greg, 2026-10-27 (`spya-xyje0z`, admin, suggestion, on Skim)

**Ending: shipped**, on `dev`. The plan is
[261027d](../plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md).

- **The default brief is today's route, unchanged**: the reader profile plus the article's *why
  you're reading*. Visitors see only that one.
- **Added briefs** are one sentence each, up to 12 per article. Each is planned for the profile plus
  that sentence, **in place of** the purpose, which was answer 2A in
  [q-gu0dw6](questions/q-gu0dw6.md). Greg answered only question 1, so 2A stands as recommended.
  Planning goes through the same job queue as the default. The address shows the brief as
  `?brief=`, and Skim remembers it, along with your place on its route. Briefs are the owner's own
  words: they are in the export and are deleted if the article changes hands.
- **The picker is 1A, Greg's choice** (reply `spya-hugkak`): a ▾ on the *Reading for* line. Its list
  holds the default (with *Edit*), each added brief (*Edit*, and Chat's two-press bin) and *New
  brief…*.
- **Waits for 1 November:** the box's model key is over its monthly limit, so no real route for an
  added brief has been planned yet. Every test used a stand-in model, and the browser check saw the
  planning job fail on the key. One real end-to-end check is queued as `qi-wthdvazd`.
