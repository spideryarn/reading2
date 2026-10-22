---
id: q-xcc7xq
report: spya-shf45w
status: answered
acted: spya-p5ktx3
asked: 2026-10-20
title: Active days misses days spent only reading. Should we record which days each reader used Spideryarn?
refs: SPIDERYARN-READING2-KD · spya-g8bw5j · qi-4mgrdyx7 · docs/plans/261020c-admin-users-engagement-active-days-reading-time-failed-imports-fewer-default-columns.md · docs/user-feedback/261020_0100-admin-users-engagement-columns.md · qi-ajznwhmm
---
The new Active days column on /admin/users counts a day only if the reader did something we already store a time for. A day where they only opened and read articles is usually missed, which is the case you described. Should we start storing one extra fact per reader to fix that?

A. Leave it as built. No new data about readers. The count stays an undercount, and the cell's tooltip says so.
B. Record the date of each day a signed-in reader uses Spideryarn (recommended). The date only, not the time and not what they did: one row per reader per day. Active days then counts every day from the day this ships. Earlier days stay as they are now, because they cannot be recovered. The privacy page gets one new line saying we keep this. About half a day's work, and almost no running cost.

Pick A if you would rather not keep a history of when people used the app. Pick B if the exact count matters more than that.

Greg, 2026-10-20 (reply `spya-p5ktx3`):

> B yes. e.g. store which days (and times?) they've opened an article

Built as
[261020y](../../plans/261020y-record-article-opens-with-a-timestamp-for-active-days.md), on dev:
`article_open_times` keeps the time a reader opens one of their articles, at most once per half
hour and not which article, and Active days counts it. It records article opens rather than any
request, and keeps the time as well as the date, following the reply. `/privacy` says so.

Details

Your report on 19 October asked for the number of unique days each person has used the app. Your example was someone you sit down with once, who opens a couple of articles that day, against someone who opens a couple of articles on several different days. The addendum asked for fewer columns by default, for reading time, and for errors with their when and what on hover.

What is now on dev (not yet deployed). Three new columns. "Active days" shows the number of days, then how many of them were in the last 30 days; its tooltip says when they were last active. "Reading" is their total reading time. "Failed imports" counts failed import attempts; its tooltip lists the latest ten, each with when it happened, which step failed, and what kind of failure it was (our bug, our configuration, a service refusing, or a temporary problem). The tooltip never shows the article's address or the error text, because the admin page does not show what people read. Archived, Uploads, Comments, Chats and Searches are now hidden at first. A Columns button, the same one the shelf's table has, brings them back.

Why Active days undercounts. We store a time for these things: each AI feature the reader uses, each article they add, each comment, and the last time each article was opened. Opening an article only updates that last-opened time, and reading time is kept as running totals with no dates. The privacy page promises "the totals, not a history". So if someone read three articles on Monday and the same three again on Thursday, only Thursday counts.

What B would add. A small table holding a reader id and a date. A row is written the first time a signed-in reader makes a request on a given day (UTC). The privacy page currently says we keep reading totals and not a history, so it would gain a sentence along the lines of "which days you used Spideryarn, by date only". It would start empty rather than being filled in from the old data, so it never claims to know a day it did not see. GPT Sol reviewed the plan and agreed this part needs your decision, not mine.
