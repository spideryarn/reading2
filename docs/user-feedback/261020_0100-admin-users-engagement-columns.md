---
reports: spya-shf45w
addenda: spya-g8bw5j
ending: shipped
comment: On dev: Active days, Reading time and Failed imports columns, and five counts hidden behind Columns. Since your answer, Active days also counts each article opened, from now on.
---
# /admin/users: active days, reading time, failed imports, and fewer columns by default

Report `spya-shf45w` (#620, SPIDERYARN-READING2-KD), a suggestion from Greg (`feedback-reporter.ts`
exit 0 and admin; re-read before this note, and its one addendum, `spya-g8bw5j`, is the only one).
Queue item `qi-4mgrdyx7`, session `fbshf45w-admin-users-engagement`.

> So I'm trying to get a kind of overall measure of engagement. I suppose the best one would be number
> of unique days on which they have used the app […] So can we have a column for, I don't know, unique
> days or something that they've used the app?

> And maybe we can get rid of some of the columns that are not really that useful, like archived,
> uploads, searches, chats, comments, or make it easy to sort of have them default hidden or
> something. Really what I most care about is number of articles, total time spent reading, number
> of unique days on which they've used it. […] I want a tooltip that will give me some indication of
> what they are and how severe and when.

**Shipped to dev** (not deployed), plan
[261020c](../plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md),
with both GPT Sol reviews beside it. No new data about readers is stored.

- **Active days**: distinct UTC days with recorded activity, the number of them in the last 30, and
  when they were last active.
- **Reading**: total reading time.
- **Failed imports**: failed import attempts. The card shows when, which step, and what kind of
  failure (a kind rather than a severity, which the plan explains); the count is red when one was
  ours to fix.
- **Archived, Uploads, Comments, Chats and Searches start hidden** behind the shelf's Columns menu.
- *"Anything else standard"*: recency (last active), frequency (active days, last 30) and depth
  (reading time) are all covered by the three columns above. A whole-userbase chart such as
  retention was not added.

**The part put to Greg is answered**: question [q-xcc7xq](questions/q-xcc7xq.md). Active days
missed a day spent only reading, his own example. He chose to record it (*"B yes. e.g. store which
days (and times?) they've opened an article"*), so since plan
[261020y](../plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md) the time of each
article open is kept, at most once per half hour and not which article, with a line on `/privacy`.
Days before it shipped still undercount, and the cell says so. Queue item `qi-ajznwhmm`.

Deferred and named in the plan: failed model calls while a reader waited, and Sentry issues per
account.
