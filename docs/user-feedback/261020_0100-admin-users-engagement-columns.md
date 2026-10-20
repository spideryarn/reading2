---
reports: spya-shf45w
addenda: spya-g8bw5j
ending: shipped
comment: On dev: Active days, Reading time and Failed imports columns, and five counts hidden behind Columns. Active days misses days spent only reading; whether to record those is a question for you.
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

**One part is awaiting Greg**: question [q-xcc7xq](questions/q-xcc7xq.md). Active days misses a day
spent only reading, which is his own example, because nothing stores the dates of reading. Making it
exact means storing the date of each day a reader used the app, plus a line on `/privacy`. That half
is queued as `qi-ajznwhmm`, needs-greg.

Deferred and named in the plan: failed model calls while a reader waited, and Sentry issues per
account.
