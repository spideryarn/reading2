# The reading-time line waits on the Experimental switch, not on a timer

**Nothing is built here. No timer or drawing delay matches what production recorded: by far the
best reading of the trace is that Experimental features was off when the article loaded, and the
line appeared the instant the switch went on, two minutes later. That is a strong inference, not a
proof (below). What Greg asked for — the line there at once, every time — is a product decision,
and it is his: take reading time out from behind the switch.** Report `spya-dxufdw`
(SPIDERYARN-READING2-DB), queue entry `qi-73z36z3g`. The feature is
[reading-time.md](../project/reading-time.md); why it sits behind the switch is
[260916c § Who, and behind what](260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md#who-and-behind-what).

> For some reason, it didn't show the reading level line in the spine until about a minute after I
> loaded the article. It would be useful to see it immediately after I've loaded the article,
> because when I first load it, I want to be able to jump to where I haven't read.
>
> — Greg, 2026-10-05 07:29 UTC (spya-dxufdw)

"Reading level line" is taken to mean the reading-time chart down the spine. Nothing in the
investigation suggested otherwise: it is the only thing on the spine that shows what has been read.

## What happened, from production's request log

The report was filed from the home page with no slug. The Vercel runtime log for Greg's session
names the article and gives the order of events. Times are UTC, 2026-10-05, deployment
`dpl_GXT8uNwhdti3mwjK8AzPtRkTT6Zh`.

| Time | Request | What it means |
|---|---|---|
| 07:24:48 | `GET /api/reader` 200, `GET /api/article/entropy-…-spya-naz564` 200, then comments, quotes, glossary, quiz, chat, citations | The article loads. **No `GET /api/reading-time`.** |
| 07:25:46 → 07:26:44 | `POST /api/jobs` (glossary, forced), done 58 s later | Greg regenerates the glossary. |
| 07:26:46.98 | `PATCH /api/reader` 200 | A settings write. |
| 07:26:47.00 | `GET /api/reading-time/…` 200 | The first reading-time request of the session, started within about 25 ms of the write. |
| 07:27:46 | `POST /api/reading-time/…` 204 | The ordinary one-minute flush. |
| 07:29:38 | the feedback report | |
| 07:37:26 | `PATCH /api/reader` 200 | A second settings write. No reading-time request follows it. |

Between 07:00 and 07:26:46 there is no reading-time request for any article.

And the production row, read inside `begin read only` at 10:41 UTC: Greg's `reader_profiles` row has
`experimental_since = null` — **the switch is off now** — and `updated_at = 07:37:26.946`, the second
write to the millisecond.

## What that supports, and what is inferred

`useReadingTime` runs only while the switch is on (`ArticlePage.tsx`:
`useReadingTime(slug, words, experimental.on)`), and its first act is the `GET`. The reading that
fits every line:

- **At 07:24:48 the page took the switch to be off.** Had it been on, the `GET` would have gone
  out with the others. `GET /api/reader` answered 200 in 11 ms, and a valid answer maps a non-null
  date straight to `on`, so this was most likely the server's own answer.
- **At 07:26:46 the switch went on**, and the chart drew from the stored totals at once. The store
  sets `on` optimistically at the press and sends the `PATCH` in the same breath, which is the
  25 ms between the two requests.
- **At 07:37:26 it went off again**, which is why the row is null now.

**None of the three is read off the wire: the log does not record a `PATCH` body**, and the null
row proves only that the switch was off after the second write. What carries the inference:

- The route takes three fields (the switch, the *about you* text, the auto-modes setting). The
  other two clients read only their own field from the answer, so neither can start reading time;
  only the switch's setter changes `on`, which re-runs the effect.
- The reading-time `GET` started within 25 ms of the write, and there was none before it.
- Every caller of the setter is a press: the bar's switch (`Dock.tsx`), `/profile`
  (`SettingsSection.tsx`) and the command bar's row (`CommandBar.tsx` § `experimentalRows`).

**What is not excluded.** An enabled mount holds its opening `GET` back while an earlier write for
the same article is still in flight, with no timeout (`waitForReadingTimeWrites`). If the switch
had been on at load and that wait had lasted two minutes, the `GET` at 07:26:47 would be a
coincidence with an unrelated `PATCH`. The trace gives it nothing to stand on (no reading-time
`POST` precedes the load, so there was no write to wait for), but it is a path in the code and the
log cannot rule it out by itself. A client that disagrees with the server is the other general
possibility (the store starts off, stays off on a failed read, and does not re-read on a repeated
sign-in event), and it fits worse: the read answered 200, and a setting that failed to load cannot
be pressed.

**And a real way the line can be late with the switch on**, which is not this report: after the
`GET` answers, nothing is drawn for a block until its total reaches 0.35 of its reading time. An
article whose stored totals are all under that draws nothing until this page's own seconds add up.
The missing `GET` at load rules it out here.

So "about a minute after I loaded" is, on this reading, the time until the press. Greg loaded at
07:24:48 and the write is at 07:26:46; the glossary run sat in between.

## The delay could not be reproduced, and that agrees

A Sonnet subagent drove a local dev server with Playwright, switch on, on a 93-block article with
120 s of stored reading time, polling the DOM every 250 ms for 100 s on each path:

| Path | `GET` answered | Chart first drawn |
|---|---|---|
| Cold load | 6.22 s | 6.48 s |
| From `/`, clicking the article | 2.21 s | 2.56 s |
| Back from `/profile` | 4.04 s | 4.16 s |
| In-app forward | 3.90 s | 4.17 s |
| Cold load with `?at=` | 3.85 s | 4.14 s |

Never later than 1.5 s after the answer; every `POST` a 204. Two induced delays were the useful
controls: holding `/api/reader` back 15 s held the chart back exactly 15 s (it waits on the switch
and on nothing else), and holding the reading-time `GET` back 20 s did not (the chart drew from the
page's own credit at 13 s). The scratch scripts were not kept.

## What it costs Greg while it stays as it is

Two things, and the second is the one that defeats what he wants it for:

1. **The line is missing on any load with the switch off**, and he turns the switch off and on —
   twice in the thirteen minutes above.
2. **Nothing is recorded while it is off.** Not hidden: not sampled. So the two minutes he read
   before the press are not in the chart, and a stretch read with the switch off looks unread
   for ever. "Jump to where I haven't read" is only as true as the switch has been on.

## Questions for Greg

One question. The background: reading time went behind the Experimental switch on 2026-09-16
because it was new code running once a second on every owner's article and a new kind of data
about a person. Fable argued then for recording for everyone, because reading time cannot be
backfilled. Since then you have tuned the chart five times and are using it to navigate.

One fact bears on every option that records more: **there is no control to turn reading time off
or to erase it.** It is kept with the article, it is in both exports, and today the only ways to
remove it are deleting the article or asking by email. A switch of its own, or a "forget my reading
time" button, is on the 260916c deferred list and could be built with A or B.

**Should reading time come out from behind the switch?** "Every owner" below means everyone with
an article of their own, paying or not.

- **A. Yes, all of it: every owner gets it, switch or no switch.** (Recommended.) The line is there
  on every load of your own articles and the record has no holes. Every owner gets the cyan chart
  on the spine, the hairline in the gutter, and their seconds per passage stored. `/privacy`
  already lists it; one clause ("with experimental features on") comes out and its date moves. The
  quiz's *Only what I've read* starts working for everyone. Small: one argument in
  `ArticlePage.tsx`, the docs, the tests that pin "switch off, no request". What it gives up: the
  chart is still young (the scale changed yesterday), readers who never asked for unfinished things
  will see it, and they get it with no way to turn it off.
- **B. Record for everyone, draw only with the switch on.** The record never has holes, so whenever
  you turn the switch on the chart is complete. What it gives up: you still get no line on a load
  with the switch off, which is this report; we would be keeping data about readers that we do not
  show them, which `/privacy` would have to say plainly; and it is more work than A, because the
  quiz's *Only what I've read* reads the same data and would need its own gate to stay hidden.
- **C. Show what is stored to everyone, record only with the switch on.** The line is there on
  every load, which is the report's own words, and nothing new is collected from anybody. What it
  gives up: the holes stay. Anything read with the switch off is never counted, so the line goes
  on under-reporting, and for a reader who has never had the switch on it changes nothing.
- **D. Leave it.** Reading time stays an Experimental feature, and the answer to this report is
  "keep the switch on". Costs nothing. Gives up both things in the section above.

What would make you pick: **A** if you think the chart is good enough for a stranger to see;
**B** if you do not, but want every record whole for the day it is; **C** if you want the line
back without collecting anything new; **D** if it should stay unfinished-and-hidden for now.

**Decided: A** — Greg, 2026-10-05. His whole answer to `Q-reading-time-switch` was "A". The
trade-off was named to him with the question: readers cannot yet switch it off or erase it. Built
the same day; § What landed, at the end.

## The simpler thing passed over

Building **A** without asking. It is small and it is what the report's words ask for. Passed over
because it is not a bug fix: it turns on per-second sampling and stored data about a person for
every paying reader, and the reason it is behind the switch was a decision, written down, that only
Greg reverses.

## Review

GPT Sol, read-only, 2026-10-05: approve with changes, four findings, all taken
([prompt](261005g-reading-time-line-plan-review-prompt.md),
[answer](261005g-reading-time-line-plan-review-sol.md)). "No delay in the code" was too broad and
now names the two paths that can delay it; on-then-off is stated as an inference with what it does
not exclude; the options gained C and the missing off-and-erase control; and the setter has three
callers, not two (the command bar was missed).

## Not a postmortem

No defect was found, so there is no class to name. The nearest lesson is the investigation's own:
five load paths on a dev server could not show a delay the trace does not contain, and the request
log answered in one read. A report with no slug still has a session in the log.
