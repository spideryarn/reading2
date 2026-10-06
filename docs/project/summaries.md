# Summaries — the piece in plain words

Up: [reading-view-overview.md](reading-view-overview.md)

A **mode** in the band between the spine and the prose: a few short paragraphs in everyday words
saying what the piece is about, why it matters, and its key ideas, at one of two lengths —
**Brief** or **Fuller** — or the piece as a numbered **Thread**. Press `Summary` in the bottom bar
and choose with the three-way control at the top. Every paragraph links to the passages it rests
on. The thread is [tweets.md](tweets.md)'s; this doc is the paragraphs and the control.

**Until 2026-10-01 Summary was also an outline** — one sentence on the article, each part and each
section, the tree's gists at a Parts | Sections depth. That went because Structure already draws the
same tree; [§ History](#history-the-outline-2026-08-26-to-2026-10-01) has what it was and where to
find it.

Code: [`SummaryMode.tsx`](../../src/web/modes/summary/SummaryMode.tsx) (the band and the control row),
[`SimplePanel.tsx`](../../src/web/SimplePanel.tsx) (the paragraphs and the empty state),
[`useSimple.ts`](../../src/web/useSimple.ts), and `§ summary mode` in
[`styles/summary.css`](../../src/web/styles/summary.css); the stage is
[`src/simple-summary.ts`](../../src/simple-summary.ts).

```
 ┌── spine ──┬──── SUMMARY (the mode band) ─────┬────── the article ──────┐
 │           │  [ Brief | Fuller | Thread ]  ⓤ  │                         │
 │  ▇▇▇▇▇▇▇  │ ──────────────────────────────── │  Being You opens with   │
 │  ▇▇▇▇     │  This book argues that what you  │  a story about waking   │
 │  ▇▇▇      │  experience is your brain's best │  from anaesthesia, and  │
 │  ▇▇▇▇▇▇   │  guess about the world, not a    │  what that tells us     │
 │  ▇▇       │  copy of it.  [spya-k3m9qt]      │  about the self.        │
 │  ▇▇▇▇     │                                  │                         │
 │  ▇▇▇      │  Why it matters: …               │  Pressing a chip        │
 │  ▇▇▇▇▇    │  [spya-tgnssb] [spya-sge6a2]     │  scrolls the article ┐  │
 │  ▇▇       │                                  │  to that passage.    ▼  │
 └───────────┴──────────────────────────────────┴─────────────────────────┘
   ⓤ — the owner's profile icon, in the band's corner
```

## Brief | Fuller | Thread (since 2026-10-03)

> I was thinking about putting the tweet thread as a submode of summary, because they kind of serve
> related purposes. In the summary, if we did that, maybe we get rid of the slider. Not sure. I was
> thinking that I quite like, of the three versions of the summary length that we have, I quite like
> the shortest and the longest, so what is that, briefer and fuller. So it could just be briefer,
> fuller, and tweet thread as three buttons somehow. Not buttons, like group buttons. Not radio
> buttons exactly, but like, you know, a sense that you can have one of those three. I think I'd
> like to try that. … keep all of the tweet thread. Functionality and UI, just put it within as a
> submode within summary.
>
> — Greg, 2026-10-03 (spya-thpsnd)

A trial, built so that going back is a client-only revert
([261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md)):

- **One control, three choices, in words.** A joined group of three buttons in the band's one row —
  a radiogroup, each its own tab stop, with a card on each. It replaced the slider below. It sits in
  the same place whichever view is showing.
- **Brief and Fuller arm the plain-words run; Thread arms nothing.** The thread writes when its
  owner opens it, however they arrived — Greg's 2026-09-12 rule, kept ([tweets.md](tweets.md)). So
  a press that lands on the thread mints no token, and a last-view restore never opens it.
- **The Simple level is gone** (since 2026-10-04). It was hidden here and still written for a day;
  [§ Two levels](#two-levels-brief-and-fuller-since-2026-10-04) has what replaced that.
  `?summary=simple` reads as Brief.
- **The band is the wide one while the thread shows**, and the roomy one otherwise
  ([§ The band is a touch wider](#the-band-is-a-touch-wider-since-2026-10-01)).
- **A visitor** gets a stored thread off the payload, or a line saying nobody has built one, under
  the same control.

**What follows describes the plain-words levels as they were built**, slider and all three levels;
read *Brief and Fuller* for *the three* wherever it is about what the reader is shown, and since
2026-10-04 wherever it is about what is written.

## Two levels, Brief and Fuller (since 2026-10-04)

> we've removed that middle level of Summary, and we're not going to add it back
>
> — Greg, 2026-10-04 (answering Q-simple-level, relayed by the Overseer)

The `simple` step writes **Brief and Fuller, and nothing else**. From 2026-10-03 to 2026-10-04 it
still wrote the middle level, Simple, which no reader was shown: every write paid for a model call
and a fidelity check nobody read, and because the step stores every level or none, a Simple that
failed took Brief and Fuller with it.

- **One write, two calls.** Fuller is asked first with the article marked for the cache, and Brief
  starts once Fuller's stream has begun, so it reads the cache. All or none, one retry a level, and
  the fidelity guard on each, as before.
- **Brief's and Fuller's prompts did not change by a byte when the level went**
  ([`simple-two-levels.test.ts`](../../tests/simple-two-levels.test.ts) pins them), so the prompt
  version stayed `simple-prompt/7` and nothing stored became outdated. It is `simple-prompt/8`
  since later the same day, for [the longer Fuller](#a-longer-fuller-since-2026-10-04), and
  `simple-prompt/9` since 2026-10-05, when
  [the length began to follow the piece](#length-follows-the-piece-since-2026-10-05), and
  `simple-prompt/10` since later that day, for a Brief of about 100 words for every piece, which
  `simple-prompt/12` took back on 2026-10-06 for
  [every piece, books included](#brief-is-short-the-longer-book-variant-was-rejected-since-2026-10-06).
  Brief's bytes are the pinned ones again in every band.
- **No stored summary was rewritten, and none will be because of this.** Greg, the same day, on
  when Summary is written:

  > we only want to write it once, i.e. when we first open the mode (or perhaps before that if it's
  > part of the import process). the only time we'd rewrite it is if we click Rerun in Metadata.

  That is [the door rule](#three-levels-one-row-shaped-by-the-reader-since-2026-10-01) below,
  unchanged.
- **A row written before then still has the middle level in it**, in `levels.simple` and in the
  guard's `check.levels.simple`. The reader ignores both: the guards in
  [`types.ts`](../../src/types.ts) ask about Brief and Fuller only, so such a row is usable exactly
  when those two are. A visitor is never sent it, the owner's read returns it and draws nothing
  from it, and an export still carries it. The stored shape's version stays `simple/2`: a new one
  would have made every stored summary read as absent and be written again. The historical
  [`simple-check-report.ts`](../../scripts/simple-check-report.ts) still counts valid middle checks.
- **The names stayed.** The step is `simple`, the artefact `SimpleSummary`, the column
  `simple_summary`. Only the level went.
- **What it saved** is in [§ Cost of a write](#cost-of-a-write-since-2026-10-04).

The plan, with the option passed over and what a rollback would do, is
[261004f](../plans/261004f-stop-writing-the-simple-summary-level.md).

### Brief first (since 2026-10-04)

Brief is written and checked well before Fuller. The reader is shown it then, and does not wait
for both.

- **What the reader sees.** On Brief: Brief's paragraphs, with their passages, and the job's
  progress under them while Fuller is written. On Fuller: the progress and one line saying Brief
  is ready and Fuller is still being written. When the write ends the band reads the stored
  summary. Its Brief is the same paragraphs, so nothing on the page moves.
- **Nothing is stored early.** Both levels are stored together when the step ends, or neither is.
  Until then Brief rides on the owner's job row, on the `simple` step, as `preview`
  ([`JobStep.preview`](../../src/types.ts)). It is there only while the step is running: the
  runner takes it off when the step starts, succeeds or fails
  ([`runStep`](../../src/jobs.ts)); interrupted steps lose it through the store's shared
  settlement ([`settledSteps`](../../src/store/pg-jobs.ts)). So no part of a summary is kept on a job, a visitor is never
  sent one, and an export is missing nothing. It is never logged.
- **If Fuller fails**, after any retry it can make, the job fails and nothing is stored. The band keeps
  the Brief it was already showing, beside the failure and **Retry**. It keeps it in the page's
  memory only ([`useSimple`](../../src/web/useSimple.ts) § `keptPreview`), so after a reload the
  failure is shown without Brief. Retry writes both levels again, and the old Brief leaves the
  screen when the new job starts. Banking Brief as a step checkpoint is the follow-up if this
  turns out to happen: the plan's § *Where this departs from the queue item's words*.
- **A rewrite does not use it.** With a summary already stored, the stored one stays on screen
  until both new levels are stored. The preview is drawn only when nothing is.
- **An unforced job never rewrites a stored summary for the prompt's or model's age.** The `simple` step's
  stamp expects the prompt version and model of the summary already stored
  ([`pipeline.ts`](../../src/pipeline.ts) § `simple`), so the add page's *Generate the main modes*
  box, which queues `simple` unforced, skips an article that has a summary however old its prompt.
  It still writes when the article itself has moved, and a forced run always writes. Metadata and
  the owner's read compare against the current version on their own
  ([`pg.ts`](../../src/store/pg.ts)), so *outdated* and Metadata's Rerun work as they did.

**The two waits, measured.** Three local articles of 8.6k to 12.6k words, two cold writes each, on
Opus with the guard on, timed from the start of the write to each level being final
(`evals/simple/probe.ts`; `evals/results/simple/high-none-timed350a|b` and `high-none-timed500a|b`):

| | Fuller asked for 350 | Fuller asked for 500 |
|---|---:|---:|
| wait to Brief, median of six (range) | 15.6 s (12.3 to 26.1) | 14.3 s (12.3 to 26.4) |
| wait to Fuller, median of six (range) | 35.6 s (23.7 to 63.5) | 34.7 s (28.4 to 36.8) |
| Fuller's words, range | 334 to 481 | 438 to 513 |
| a write, mean | $0.220 | $0.217 |

- **Brief was final in about a quarter of a minute at the median.** The job's start-up,
  preview write and polling add to the reader's wait; previously nothing appeared until Fuller was done.
- **The median wait to the longer Fuller was slightly lower in this sample.** That is not what
  261004b saw (55 s for about 500 words, with three levels). The slowest 350 write retried after
  a fidelity flag; none of the 500 writes did. The [plan's ledger](../plans/261004f-stop-writing-the-simple-summary-level.md#stage-2-cost-and-wait-measured)
  explains why this does not isolate length or bound its effect on wait.
- **Through the real job in a browser**, one write on a fourth article: Brief on screen at 26 s,
  Fuller stored at 56 s, 517 words in eight paragraphs. The job adds its own start-up and polling
  to both.
- These timings are the first to say which level a slow write is waiting on: it is Fuller.

The design, the review that changed it and the option passed over are
[261004f § Stage 2](../plans/261004f-stop-writing-the-simple-summary-level.md#stage-2-show-brief-as-soon-as-it-is-written-then-a-longer-fuller).

### When Summary offers a rewrite (since 2026-10-04)

A stored summary is written once. Greg's rule, and the two exceptions he then kept:

> we only want to write it once, i.e. when we first open the mode (or perhaps before that if it's
> part of the import process). the only time we'd rewrite it is if we click Rerun in Metadata.
>
> — Greg, 2026-10-04 (relayed by the Overseer)

> A ok keep them, those are good reasons to want to rewrite it (when article has changed, or
> profile). but only show if they're the case
>
> — Greg, 2026-10-04, answering [Q-summary-write-it-again] (relayed by the Overseer)

So Summary's band has two presses that rewrite, and each is drawn only when its reason holds.

| The stored summary | In the band | In the profile icon's panel |
|---|---|---|
| is current | no press | no press |
| was written with an older prompt (*outdated*) or model only | no press, and no notice | no press |
| was written from an older version of the article (*stale*) | the notice, and *Write it again* | no press |
| was written for a profile the reader has since changed | *Write it again* under the paragraphs | *Regenerate* |
| both | the notice, and one *Write it again* | *Regenerate* |

- **The profile icon is not a press.** It is drawn whenever the summary was written for a profile,
  changed or not, and opens the panel that shows the profile
  ([`WrittenForYou.tsx`](../../src/web/WrittenForYou.tsx)). The panel's *Regenerate* is the press,
  and [`ProfilePanel.tsx`](../../src/web/ProfilePanel.tsx) draws it only when the profile changed.
- **The server decides both reasons; the band only reads them.** *Stale* is the stored
  `sourceHash` against the article as it is now ([`simple-summary.ts`](../../src/simple-summary.ts)
  § `isStale`). The fingerprint covers the rendered article's text and head, the length band
  for prompts since `/9`, and the fixed,
  profile-free user message; prompt-version and model stamps are separate. Changing those stamps
  alone never makes a summary stale. The store also reports stale when the article's tree is
  missing, because it cannot check the fingerprint (`pg.ts` § `loadSimpleSummary`).
  *Profile changed* is the stored `profileHash`
  against the reader's profile now ([`profile.ts`](../../src/profile.ts) § `profileIsStale`).
  One case is deliberately not a change there: the reader cleared their profile. A summary written
  when there was no profile at all is a change once the reader writes one (Greg, 2026-10-05;
  [reader-profile.md § Provenance](reader-profile.md#provenance-what-was-this-written-with-and-is-it-still-true)).
- **A rewrite already asked for is not a new offer.** While a forced run is under way the band
  shows its progress, and if it failed, the failure and **Retry**. That includes a Rerun pressed
  in Metadata while Summary is open. These follow a press the reader has made.
- **Both presses are the same forced run** of the `simple` step, and it replaces both levels.
- **Commands also exposes Metadata's forced run**, as *Simple summary › Run again*, regardless of
  either flag ([`CommandBar.tsx`](../../src/web/CommandBar.tsx) § `rerunRows`). That action is
  outside Summary's band and lands in Metadata's AI processing section.

Pinned by [`summary-rewrite-presses.test.tsx`](../../tests/summary-rewrite-presses.test.tsx),
which mounts the real band on Brief and Fuller for each row of the table, with supplied server
flags. The flag calculations and narrow-screen layout are outside that test.

### Cost of a write (since 2026-10-04)

Measured on three local articles of 8.6k to 12.6k words, on Opus with the guard on, two writes each
from a cold cache, before and after the middle level went (`evals/simple/probe.ts`; the result
files are `evals/results/simple/high-none-fbazc1|c2` and `high-none-nosimple1|3`):

| | three levels | two levels |
|---|---:|---:|
| a write, cold cache, mean of six | $0.256 | $0.216 |
| the same, range | $0.236 to $0.275 | $0.175 to $0.257 |
| the wait, median of six | 30.9 s | 31.3 s |
| the wait, range | 29.3 to 41.2 s | 27.9 to 51.1 s |

- **About 16% cheaper in these six cold writes.** A cold write still pays for the first call putting the
  article in the cache at Opus's price, which both shapes pay once. The removed call was a cache
  read and about a thousand tokens of answer.
- **The median wait barely changed; the tail grew.** Mean wait rose from 33.7 s to 35.8 s,
  and the maximum from 41.2 s to 51.1 s. The files record total reasoning tokens across calls,
  not each level's timing, so they cannot establish which call caused the slow writes or rule
  out a latency effect from this change. Six writes a side are too few to settle that.
- **What it does remove is a way to fail or stall.** In the six writes before, one waited on a
  retry of the middle level; none can now.
- A third pass of two-level writes ran inside the cache's five minutes and cost $0.084 to $0.213.
  It is kept apart because its cache state differs. One of those three waited 87 s,
  on a Fuller the guard flagged and asked for again.

## Simple — a plain-words orientation

**Built 2026-09-30.** Asked for by an admin through the Feedback button (SPIDERYARN-READING2-6E):

> Add a sort of sub mode to the summary mode for something like, explain it to me like I'm 12 or 15.
> … It just helps the reader orient, like, okay, what is this about and why is it important, and
> what are the key ideas or whatever.
>
> — Greg, 2026-09-30

It is the feature closest to [vision.md](vision.md)'s anti-goal, so it is kept an **orientation,
not a digest**: a few paragraphs, capped by code; **every paragraph is a door** (below), and a
paragraph that cites no passage is dropped when it is written. The words are plain text, never
markdown; bold and bullets are [two fields beside them](#bold-and-bullets-since-2026-10-04). What it
is — written by AI, the article says it better — is said in the slider's card, not in a line under
the paragraphs.

### Three levels, one row, shaped by the reader (since 2026-10-01)

> let's provide a UI-slider with 3 level (short & very-simple, just-under-current-length and
> fairly-simple, just-over-current-length and moderately-complex)
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-7J)

> the main thing I'm trying to do is avoid wasting vertical space, and use the UI design to give the
> user a clue about how they work and are related to each other. Also, the Very-Simple and
> Moderately-Complex summaries should take into account User-Profile and Why-are-you-reading-it.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-7A)

- **One row, no labels.** The slider was the whole control: **Brief** (short, very simple, pitched at
  twelve), **Simple** (fairly simple, just under the first version's length, at fifteen; removed
  2026-10-04), **Fuller**
  (moderately complex, at eighteen; just over that length until 2026-10-04, and
  [about half as long again since](#a-longer-fuller-since-2026-10-04)). Since 2026-10-01 there is no level name beside it
  (SPIDERYARN-READING2-7R, *"get rid of the "Simple" text - perhaps replace with an icon"*): a
  short-text icon at the left end and a long-text one at the right, each a press on that end's
  level; the tooltip names the three, and `aria-valuetext` names the current one for a screen
  reader. ⓤ is the owner's profile icon.
- **The reader's profile and goal shape every level**, through the shared `PROFILE_RULES` and
  `profileSection` ([src/profile.ts](../../src/profile.ts)): the goal decides what leads, and in
  Fuller what the reader says they know is not explained
  ([but never a term the piece itself introduces](#written-for-someone-who-has-not-read-it-since-2026-10-05)). **Brief ignores the claimed
  background**: it is for a reader in a hurry from outside the field, with at most two technical
  terms, each explained, and one plain phrase of method. Greg, 2026-10-02 (`spya-rpqqxb`): *"assume
  it's for someone with less expertise or in more of a hurry"* — his own profiled Brief had more
  jargon than the Simple beside it
  ([261002h](../plans/261002h-brief-summary-plainer-for-a-reader-in-a-hurry.md); what a good
  summary is, [261002c](../research/261002c-what-makes-a-good-summary.md)). Recorded as `profileHash`, not in the stamp — a changed
  profile makes nothing stale; the badge shows it and *Write it again* picks up the new one
  ([§ When Summary offers a rewrite](#when-summary-offers-a-rewrite-since-2026-10-04)). A
  visitor reads the owner's paragraphs, and the owner's *make public* dialog says they were written
  for the owner's profile.
- **One press writes every level**, two since 2026-10-04: one model call per level, all or none
  stored; a level whose answer fails validation is asked once more on its own. A `simple/1` row
  reads as absent and the next press replaces it.
- **The levels share one cached copy of the article** (since 2026-10-01): Fuller is asked first with
  the article marked, and Brief starts once its stream has begun, so it reads the cache instead of
  paying for the article again. Measured with three levels: about 37% cheaper a press for about 2 s
  more wait; one call for all three was measured and is far slower. Below the cache floor they run
  together, as before. [261001j](../plans/261001j-simple-press-cost-and-latency.md), which also holds the
  streaming question for Greg.
- **The door rule.** Pressing Summary — the bar button, or any of its command-bar rows — writes the
  plain-words levels when none are stored, and shows the job's progress; with them stored it only
  reads them (since 2026-10-02, Greg's 7T:
  > When I open any of the Summary submodes, if they haven't already been generated, automatically
  > kick off the generation.

  [261002a](../plans/261002a-summary-generates-on-open.md)). Arriving on `?mode=summary` — a link,
  Back, a restored view — spends nothing, as for every mode ([mode.md](mode.md), `useAutoRun`), and
  with nothing stored the owner sees an empty state with **Write it**. That is also what lets
  Summary be where a signed-in reader's first open of an article lands, where there is room
  ([url-state.md § Reopening an article where you left it](url-state.md#reopening-an-article-where-you-left-it)).
  The add page's *Generate the
  main modes* box includes Summary for the same reason (Greg confirmed it on 2026-10-02,
  Q-summary-on-add), and it writes what the press writes: both plain-words levels, Brief and
  Fuller, all or none, through the `simple` step. Like the press it writes only when the article
  has no usable summary for its current text: a stored one from an older prompt is left alone
  ([Brief first](#brief-first-since-2026-10-04)). A visitor on a public article gets the
  stored paragraphs off the payload, or a line saying none has been made.
- **It does not stream**, against CLAUDE.md's rule for a call somebody waits on. Since 2026-10-04
  the first press shows [Brief as soon as Brief is written](#brief-first-since-2026-10-04), whole
  and checked, and waits behind the job progress for Fuller. Why it does not stream is in
  [260930i](../plans/260930i-simple-summaries-eli15-sub-mode.md) § *A departure from CLAUDE.md*.

The design, the measurements and the review are
[261001b](../plans/261001b-summary-controls-in-one-row-and-two-plain-words-levels-shaped-by-profile-and-goal.md).

### A longer Fuller (since 2026-10-04)

> I think we want the most detailed submode of Summary to be longer and more detailed still. (I
> think it's called fuller.)
>
> — Greg, 2026-10-03 (`spya-azft06`, SPIDERYARN-READING2-BC)

Fuller is asked for about 500 words in five to eight paragraphs of two to five sentences, and told
never more than 600 (`simple-prompt/8`). Since 2026-10-05 that is the ask for a piece of ordinary
length, and [a short or long piece is asked for less or more](#length-follows-the-piece-since-2026-10-05).
It went there in two steps on the same day:

- **About 350 words first** (`simple-prompt/7`), in four to seven paragraphs and never more than
  430, where it had been asked for about 220 in three to five. Measured, it came back at 338–412
  words where it had come back at 221–261, and the press took about 31 s where it had taken 26.
  About 500 was tried then and not shipped: the text was good, but the press took 55 s, because
  nothing was shown until the slowest level was written
  ([261004a](../investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md)).
- **About 500 words once [Brief is shown first](#brief-first-since-2026-10-04)**. Greg chose that
  option of 261004a (option C). The longer Fuller now costs a wait for Fuller alone, with Brief to
  read meanwhile. When it was measured in 261004b, asked for 500 it came back at 464–520 words.

Its prompt says what the room is for: how the work was done, the evidence and numbers behind each
main finding, the limits the piece itself names, and how the steps of the argument connect. The
stored limit was 3 to 8 paragraphs and 850 words (`SIMPLE_LIMITS` in
[`types.ts`](../../src/types.ts)), unchanged by either step, and is 3 to 13 and 1,400 since
2026-10-05; the minimum stayed at 3 so every Fuller stored before still reads. Brief is asked for what it was, byte for byte. No stored summary was
rewritten by either step, and an unforced job will not rewrite one for it: a stored summary is
*outdated*, which is silent, and Metadata's Rerun writes the longer one. So does *Write it again*,
on the occasions it is offered
([§ When Summary offers a rewrite](#when-summary-offers-a-rewrite-since-2026-10-04)).
[261004b](../plans/261004b-summary-fuller-longer-and-bold-and-bullets.md) has the measurements.

### Length follows the piece (since 2026-10-05)

> The length of the summaries should somewhat reflect the length of the text. Not linearly. But a
> book will surely need (at least somewhat) longer summaries than a short article. Hopefully we can
> add a tweak to the prompts to this effect.
>
> — Greg, 2026-10-04 (`spya-gttwhn`)

**Fuller's length follows the piece; Brief's does not.** The Fuller above is what a piece of
ordinary length is asked for. A short piece is asked for less and a long one for more, in **four
bands picked from the words of the body the request sends** (`SIMPLE_BANDS`, `bandFor` and
`FULLER_LENGTH` in [`simple-summary.ts`](../../src/simple-summary.ts)):

| band | body words | Fuller: paragraphs · about · never more than |
|---|---|---|
| short | under 2,500 | three to five · 250 · 330 |
| standard | 2,500 to 14,999 | five to eight · 500 · 600 |
| long | 15,000 to 39,999 | six to nine · 700 · 820 |
| book | 40,000 and up | eight to eleven · 900 · 1,050 |

- **The band changes three values in Fuller's LENGTH section and nothing else.** The standard
  band's Fuller prompt is `simple-prompt/8` byte for byte, so an article of ordinary length is
  asked exactly what it was. This introduced `simple-prompt/9`.
- **Before, the length did not follow the piece.** Asked for about 500 words whatever the piece,
  Fuller gave an 879-word essay 402 and 492 words, and a 48,000-word book 489 and 515. With bands
  the essay got 281 and 237, and the book 834 and 846. A blind judge preferred the banded Fuller
  in all eight pairs where its prompt differed
  ([261005a](../investigations/261005a-summary-length-bands-measured.md)).
- **Brief is one length for every piece**: about 80 words, byte for byte as it was. The
  [book-only increase](#brief-is-short-the-longer-book-variant-was-rejected-since-2026-10-06)
  missed its shipping rule on 2026-10-06. It was banded in every band
  in the first build, 60 words for a short piece and up to 140 for a book, and the same judge
  preferred the unbanded Brief in six pairs of eight: the 60-word one left out a point the essay
  turned on every time, and the book's longer one read as padded.
- **The band is counted over the body only**, the blocks the prompt shows, so a long bibliography
  or appendix does not make a piece "a book".
- **Fuller's stored limit rose once, for every band**, to 13 paragraphs and 1,400 words
  (`SIMPLE_LIMITS`); Brief's did not move. It is one cap a level, not one a band, because a reader
  of a stored row has no article to measure. The prompt's "never more than" is what holds a
  shorter piece's summary short.
- **Nothing stored was rewritten.** A stored summary is *outdated*, which is silent; Metadata's
  Rerun writes the new length.
- **A longer Fuller is a longer wait for Fuller**: 47 and 53 s to a book's Fuller in the two
  writes measured, against 34 and 88 s before. Brief is on screen long before either.

The plan, the option passed over and Sol's reviews are
[261005b](../plans/261005b-summary-length-follows-the-length-of-the-piece.md).

### Written for someone who has not read it (since 2026-10-05)

> The brief summary is quite good, but the fuller summary often is hard for me to understand. And I
> think it's because, I mean, it's fine that it uses some jargon from the article, but you have to
> write it as if it's for someone who has not yet read the article. So I guess if you're going to
> use jargon, you have to define it.
>
> Realty though they key principle is to write the fuller summary for someone who hasn't read it yet
> rather than for someone who has.
>
> — Greg, 2026-10-05 (`spya-rntjxu`)

**Fuller is written for a reader who has not read the piece.** Its prompt (`simple-prompt/11`)
gains two bullets, `NOT_READ` in [`simple-summary.ts`](../../src/simple-summary.ts), naming the
two faults:

- **A name the piece introduces is a term like any other**: a term it coins or uses in its own
  sense, an abbreviation, its label for a method, a group or an experiment. It is said in
  everyday words, in the same sentence, the first time it is used.
- **Nothing is referred to before the summary has introduced it**: "the second experiment" only
  after the experiments have been said.

**The reader's stated background does not cover what the piece introduces.** Fuller still leaves
the established terms of a reader's field unexplained, but a paragraph after the shared profile
rules (`AFTER_PROFILE.fuller`) says a term this piece introduces is new unless the reader's own
description names it. The report came from a reader whose profile claims the paper's field; that
alone does not make the paper's own names familiar.

**This did not alter Brief**: Greg finds it good, and its two terms and one phrase of method
leave little to point at. Brief was `/9`'s, byte for byte, while this was measured; its own
change the same day, about 100 words for every piece, is `/10`, and both are in `/11`;
[`/12` took Brief's back](#brief-is-short-the-longer-book-variant-was-rejected-since-2026-10-06) for
every piece, books included.

- **A whole section was built first, measured, and not shipped**: a heading, an opening
  paragraph, eight bullets and a closing check. On five papers, set directly against the two
  bullets, it split 5 pairs to 5 with the same count of places a reader could not follow, so by
  the rule the plan declared beforehand the smaller change shipped. The section also ran past
  its length in four writes of twenty; the two bullets did in none of fifteen.
- **What is measured for the two bullets, for a reader with a profile**: against the old Fuller
  a blind judge found them easier to follow in 6 pairs of 10 and harder in 1, and preferred them
  in 6 of 10. The places a reader could not follow were 0.6 and 0.8 a summary, against 1.3. Every
  main finding they left out, an old summary of the same piece left out too
  ([261005b](../investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md)).
- **Mixed for a reader with no profile; no improvement claimed.** For the two bullets nothing
  moved either way. It is in the Overseer's queue to look at properly (`qi-4meqvjr4`).
- **Nothing stored was rewritten**, and nothing is made stale: a stored summary is *outdated*,
  which is silent, and *Write it again* or Metadata's Rerun writes the new one.

The plan, the section's text and GPT Sol's reviews are
[261005h](../plans/261005h-fuller-summary-written-for-someone-who-has-not-read-the-piece.md);
the research is
[261005c](../research/261005c-what-makes-a-longer-summary-followable-by-someone-who-has-not-read-the-piece.md).

### Brief is short; the longer book variant was rejected (since 2026-10-06)

> Re longer Summary Brief - I wanted it to stay short for most articles, but allow it to go
> slightly larger for really long ones (e.g. books). Is that what's been done?
>
> — Greg, 2026-10-06

It was not what had been done: the day before, Brief had gone to about 100 words for *every*
piece (`simple-prompt/10` and `/11`), on his earlier request:

> maybe Brief could be ever so slightly longer but not much
>
> — Greg, 2026-10-05 (answering [Q-brief-for-a-book], relayed by the Overseer)

**After review, `simple-prompt/12` asks Brief for about 80 words and never more than 130 in
every band**, books included (`BRIEF_LENGTH` in
[`simple-summary.ts`](../../src/simple-summary.ts)). The prompt is `/7` to `/9`'s bytes again.
Greg's intent remains a slightly larger Brief for very long pieces. The book-only variant
measured here did not meet it well enough to ship under the rule set before judging: preference
in at least three of four pairs, and no more padding flags than the old Brief. It won two
pairs and was called padded twice, against zero for the old one. Keeping it because it
"did not lose" would discard that rule after seeing the result.

The sample was two books, two writes each and one judge given headings, not the books. It
cannot establish a general effect by kind of book, or that the variant is no worse. The
measured prompts, word counts, model mistake and verdicts belong in
[261005a § Short, and slightly longer for a book](../investigations/261005a-summary-length-bands-measured.md#short-and-slightly-longer-for-a-book-round-four).
The decision and cost are in
[261005b § Brief by band](../plans/261005b-summary-length-follows-the-length-of-the-piece.md#brief-by-band-2026-10-06).

**Brief's stored limit did not move**: 2 to 3 paragraphs and 240 words (`SIMPLE_LIMITS`).
Nothing stored was rewritten. An older prompt is *outdated*, which is silent; Metadata's
Rerun writes the current Brief. The measurement for `/10` is
[round three](../investigations/261005a-summary-length-bands-measured.md#a-slightly-longer-brief-round-three).

### Bold and bullets (since 2026-10-04)

> Maybe, maybe the summary submodes could make use of Markdown, like bold or bullet points, to make
> it easier to skim the summary. I suppose it's possible they could use headings, but that might be
> overkill. That could be interesting. Experiment with it.
>
> — Greg, 2026-10-03 (`spya-qzsvx4`, SPIDERYARN-READING2-BD)

Built as **two fields beside the text, not Markdown in it**, so `text` stays the plain words the
fidelity guard, the word limits and the public payload read:

- **`key` on a sentence**: a few of that sentence's own words, drawn as `<strong>` at their first
  occurrence, inside the sentence's link. Brief and Fuller, the two levels shown; the prompt asks for at most two in a
  paragraph. Kept only when `simpleKey` ([`types.ts`](../../src/types.ts)) accepts it: found in the
  sentence exactly, at most `SIMPLE_KEY_MAX_WORDS` words, and shorter than the sentence. One it
  refuses is left off and counted, never a failed level.
- **`list` on a paragraph**: the first sentence is a lead-in and each later one a bullet. Only
  Fuller is asked for lists, two at most. `paragraphShape` decides what is drawn, for the owner and
  a visitor alike: a list needs `list: true` and three usable sentences, and anything less is prose.

A bullet is one sentence, so it is still the hover-and-press link above and still lights up while
its passage is on screen. Both fields are stored only when they say something, so a paragraph from
before has neither and draws as it did. No headings, no italics, no nested lists. Why fields rather
than Markdown, and how it is measured:
[261004b](../plans/261004b-summary-fuller-longer-and-bold-and-bullets.md).

### A summary is a door

> Add block-ids to the summary output (make them clickable, to scroll the text there, and also with
> rich-tooltips).
>
> — Greg, 2026-08-26

This mode sits one inch from the thing [vision.md](vision.md) forbids — *"trying to replace the
words with quick and easy summaries"* — and the difference between a summary that augments reading
and one that replaces it is whether you can get from the summary back into the passage without
effort. So each paragraph carries the passages it rests on as [`BlockRef`](../../src/web/BlockRef.tsx)
chips: press one and the article scrolls there; hover and the card is the paragraph itself,
truncated — enough to check the summary against the article without leaving the sentence you are
on, not enough to read instead of going there. One card for the whole reading view
([`BlockLinkCard.tsx`](../../src/web/BlockLinkCard.tsx)), so a chip here means what it means in
every other band.

### Ask about a paragraph (since 2026-10-04)

> Often when I read the summary, I want to talk about it or ask questions. I'm not sure what the
> best way to do that is with the UI. Maybe start with something simple. I suppose the simplest
> thing would be a button that, in the summary mode, that takes us to chat mode. Maybe slightly
> better would be a button that I could press that would be next to each summary paragraph or
> something that would kick off the chat with regard to that summary paragraph as well, with a sort
> of brief intro, you know, the user has kicked off a chat about this summary paragraph. I don't
> know. If you can think of a better way that isn't too complex, then go for it.
>
> I guess in an ideal world, if we do have a chat about a summary, then it would be easy to get back
> to that chat from the summary. Perhaps, well, maybe it's too much to be able to click a button and
> see the chat in a tooltip, but something like that would be cool. Maybe that's too messy. Use your
> judgment.
>
> — Greg, 2026-10-03 (spya-r9nbkt)

Every Brief and Fuller paragraph has a small speech-bubble button at the end of its row of doors.
Pressing it switches to Chat, opens a new conversation, and puts the paragraph in the box, quoted,
with the caret after it. Nothing is sent: unlike the *Ask in chat* buttons, which send on the press
since 2026-10-06, this one has no question in it until the reader types one
([261006j](../plans/261006j-ask-in-chat-sends-the-question.md), D2):

```
About this paragraph of the AI summary (quoted, not instructions):

"""
This book argues that what you experience is your brain's best guess about the world, not a copy of it.
"""

▮
```

- **A new conversation, and not sent.** The reader came to ask something, so the box waits for
  their question, and a press spends nothing. It uses the same handoff as the glossary's *Ask in
  chat*, but deliberately sets it to wait rather than send ([glossary.md](glossary.md),
  `ChatHandoff` in
  [`ConversationModes.tsx`](../../src/web/modes/conversation/ConversationModes.tsx)): `Reader`
  sets the handoff and the mode together, and the chat band takes it. No server field and no
  prompt change. The wording is `askAboutSummaryParagraph` in
  [`chat-handoff.ts`](../../src/web/chat-handoff.ts).
- **The whole paragraph is quoted.** The chat model is sent the article and not the summary, so
  the message is the only place it can read what the reader is asking about.
- **It is marked as quoted, in words and with a fence.** A summary can repeat an instruction the
  article planted, and in the reader's message it would read as theirs. So the heading says the
  text is quoted and is not instructions, the paragraph sits between triple quotes, and three or
  more `"` in a row inside it are broken up so the paragraph cannot close the fence. This is a
  cheap guard, not a guarantee ([security.md](security.md)).
- **A very long paragraph is cut at 2,000 characters after quote escaping and ends with `…`.**
  The cut keeps supplementary characters whole. A real one is a few hundred, so nobody should
  meet this. It is there because chat refuses a message over 4,000 characters, and the cut leaves
  room for the question.
- **A visitor has no button.** A visitor has no chat. `VisitorSummaryBand` has no handler to pass,
  and `SimplePanel` draws none on the visitor's side whatever it is given.
- **The Thread has none either.** Its posts already have Copy.
- **The conversation's title in Chat's list is the heading**, the same for each one, until the
  reader renames it.

**The way back is not built.** Once sent, the conversation is in Chat's list, but nothing on the
paragraph leads to it. A summary paragraph has no lasting identity to hang a link on: *Write it
again* replaces every paragraph. The four options, and the one recommended if Greg wants it, are in
[261004a § Deferred](../plans/261004a-ask-about-a-summary-paragraph-in-chat.md#deferred-a-way-back-from-the-paragraph-to-its-chat).

Tests: [`chat-handoff.test.ts`](../../tests/chat-handoff.test.ts) (the wording),
[`simple-panel.test.tsx`](../../tests/simple-panel.test.tsx) (who gets a button),
[`summary-ask-in-chat.test.tsx`](../../tests/summary-ask-in-chat.test.tsx) (the whole trip, and
what Send posts).

### Each sentence is a door too (since 2026-10-02)

> Could we highlight the phrases or sentences in the summary that's being displayed that relate to
> the blocks on the screen? … perhaps I could hover over the summary-sentence and it would
> highlight, and I'd get a rich tooltip … and I could click on those.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-8V, `spya-ra5fuz`)

The writer answers each paragraph as its sentences, and each sentence names **at most one of its
paragraph's own ids**, or none. That sentence is drawn as a `BlockRef` with the sentence as its words
(`.simple-sentence` makes it read as prose), so it gets three things without code of its own: the
shared card on hover or focus, a press that goes to the passage, and the band's on-screen wash
(8K's rule, `onScreenLinkCss` in [`on-screen.ts`](../../src/web/on-screen.ts)), which lights a sentence
while its passage is on screen. On touch a tap jumps; there is no card, as for every block link.

- **A sentence can only point where its paragraph already does**, so the fidelity guard, which checks
  each paragraph against its cited blocks, still covers it. An id outside the paragraph's is nulled
  and counted, never added.
- **Shown only if the sentences are the text.** The stored paragraph keeps `text` (the sentences
  joined) and `ids`; `sentences` is an optional field beside them, read only through
  `usableSentences` ([`types.ts`](../../src/types.ts)), which answers "none" unless they rejoin to
  exactly the `text` the guard read. A paragraph without usable sentences — every one written before
  `simple-prompt/4` — draws as it always did. Nothing is backfilled: the next rewrite picks it up
  ([§ When Summary offers a rewrite](#when-summary-offers-a-rewrite-since-2026-10-04)).
- Measured before it landed, in
  [261002e](../plans/261002e-summary-sentences-point-at-their-passage.md) § Ledger.

**Not yet** (Greg's own v2, 2026-10-01): several passages per sentence, a colour per pairing, and
lighting the *sentence in the article* a summary sentence came from — which needs an anchor finer
than a block ([block-ids.md](block-ids.md)).

### The fidelity guard (since 2026-10-01)

Plain words pull a model towards the everyday name for a thing, and on the PID paper that name was
the paper's word for a different thing: synergy *"grows with more feedback loops"*, where the paper
finds feedback connections lower it. A prompt rule did not make that rare
([261001h](../plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)). So each
level, once written and valid, is **checked**: one quick-tier call reads every paragraph beside the
text of the blocks it cites and says, per paragraph, whether those passages contradict it.

- **A flag buys the level's one remaining attempt**; the retry is stored whatever its verdict, and if
  the retry itself fails, the flagged first attempt is. The guard can make a press slower (4–5 s,
  more on a retry) but never makes it store nothing.
- **A checker that fails or answers unreadably** leaves the level stored unchecked, and does not
  spend the retry.
- **It cannot catch what the cited passages do not say**: a claim wrong about the article but not
  contradicted by its own passages passes. Measured, it caught 24 of 30 hand-labelled faults and
  alarmed on 1–2% of other paragraphs, for about $0.0027 a press.
- **Each stored summary carries a `check` record** (per level: passed, flagged with the reasons, or
  unchecked, and how many attempts), the owner's and never a visitor's; a summary without one was
  written before the guard or with it off. Every check is also an `ai_calls` row of purpose
  `simple-check`. `npx tsx scripts/simple-check-report.ts` reads both, read-only — what each can and
  cannot see is in its header.
- **Off is one line**: `SIMPLE_CHECK_ENABLED` in [`src/simple-check.ts`](../../src/simple-check.ts),
  then a deploy.

It is Simple's alone; the other summary voices are not checked. The design, the review and the
first real press are in [261001i](../plans/261001i-simple-fidelity-guard-built.md).

**Simple is written on Opus for every article, and the guard stays** (since 2026-10-01,
[261001p](../plans/261001p-simple-on-opus-with-and-without-the-fidelity-guard.md)). The writer was
measured alone, guard off, on the PID paper and on two controls:

| | Sonnet | Opus |
|---|---:|---:|
| "feedback loops" for recurrent, PID paper | 5 / 18 levels | 0 / 36 |
| guard flags: PID · controls | 6 / 18 · 1 / 36 | 2 / 36 · 1 / 36 |
| blind read, 27 levels each: major · minor faults | 3 · 2 | 0 · 1 |
| a press, warm cache · cold | $0.05 · $0.09 | $0.10 · $0.18 |
| a press, three levels, median | 17 s | 20 s |

So the guard rarely fires on Opus and the ~15 s retry mostly goes away. It is kept because Opus
still made a real fault on Gwern that only the guard caught. Opus states the trapped finding in 22
levels of 36, every time correctly, by avoiding the paper's terms rather than naming the contrast,
and it writes nearer the word targets. The switch is `ALWAYS_HIGH_POWER` in
[`src/models.ts`](../../src/models.ts), which the step and `/api/models` both read; taking `simple`
out returns it to the article's High-powered AI setting, and no stored summary goes stale either
way.

## The band is a touch wider (since 2026-10-01)

> Make the Summary mode column ever so slightly wider (if on a wide screen)
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-7Q)

Summary's band is the **roomy** shape while a length is showing, and the thread's **wide** one
while the thread is (since 2026-10-03). Roomy is the standard band, but capped at 28rem (448px at a
16px root) rather than 25rem. It still takes only what the prose leaves above its minimum, so below about 957px
it is the standard band, and it reaches 448px near 1004px; phones are unchanged. One function picks
every mode's shape — `bandShapeFor` and `ROOMY_IDEAL_REM` in [`layout.ts`](../../src/web/layout.ts);
the other shapes are in [narrow-windows.md](narrow-windows.md).

## The URL

| Parameter | Values | History | Why |
|---|---|---|---|
| `mode=summary` | | push | A mode is where you are, not a glance — [url-state.md](url-state.md) |
| `summary` | `brief` (default, absent from the address), `fuller`, `thread` | push | Which of Summary's three views is showing. `simple` was a value until 2026-10-03 and reads as `brief` |

`?deep=` and `?summary=gists` went with the outline on 2026-10-01; an old link carrying either lands
on Summary at `brief`, and `deep` is never remembered, so it cannot be restored over a fresh link.

**Summary opens on Brief** — Greg, 2026-10-01 (8N): *"In summary mode, default to the brief summary
when it opens for the first time."* Fuller and Thread are written into the address; Brief is its
absence. That resulting view is remembered with the article, so a later bare visit opens where the
reader left it. A link that already names article state wins over that memory
([261002c](../plans/261002c-summary-opens-on-brief.md)). Until then the default was `simple`.
**One exception**: a view left on the thread is restored without the mode, so coming back from the
shelf does not open it and start a thread ([url-state.md](url-state.md)).

The thread's two old addresses, `?mode=tweets` and `/read/<slug>/tweets`, land on
`?mode=summary&summary=thread` — on a cold load, an in-app link and Back or Forward.

## What this deliberately does not have

**An outline of the article.** That is [Structure](structure.md)'s, drawn from the same tree.

**The expertise axis.** The previous version crossed three lengths with three reading levels behind
two sliders, and there is no evidence anyone used it
([original-version/summaries.md](original-version/summaries.md)). Brief and Fuller move length
and plainness together.

**Anything generated as you move around.** The one thing here that spends is the press, once per
article, and kept. Their heading tooltips fetched summaries for headings the granularity filter had
already hidden — real money spent generating text nobody could see.

**Markdown.** A paragraph's words are plain text, and no parser runs over them: rendering arbitrary
model output as HTML is what [security.md](security.md) is about. The bold phrase and the bullets
are [two fields](#bold-and-bullets-since-2026-10-04) whose elements the panel makes itself.

## What is still open

- **No evidence it helps.** The same criticism the previous version earned, and repeating their
  mistake would mean never asking. [Q6](open-questions.md) is where "how would we know we are failing
  at this" lives.
- **Simple can collapse two terms that the paper keeps distinct.** On the PID paper it calls the
  recurrent connections, which raise synergy, "feedback loops", borrowing the paper's term for the
  different kind that lowers it. This happened in 6 of 18 outputs across six fresh unchanged-prompt,
  no-profile runs on 2026-10-01 on Sonnet. Neither of two tested prompt wordings made the fault rare
  enough to ship ([261001h](../plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md)).
  Two answers are built: [the fidelity guard](#the-fidelity-guard-since-2026-10-01), and writing
  Simple on Opus, which made it in none of 36 levels. **Still open:** that is one paper; no second
  article with a contrasting-terms trap has been measured, so how general either answer is remains
  unknown.
- **The hover card is wider than the band it opens in** — 26rem against a band of 18–28rem — so a
  card anchored near the band's left edge draws over the spine rail. It is on top (the tooltip layer
  is `z-index: 100`, portalled into `<body>`) and transient, so this is untidy rather than broken.

## History: the outline (2026-08-26 to 2026-10-01)

Built on 2026-08-26 from Greg's ask for *"hierarchical Summary, taking inspiration from
`docs/project/original-version/`"*. It began as the old version's named length ladder (`gist`,
`short`, `long`), cut back on 2026-08-31 to the tree's one-sentence gists alone
([260831s](../plans/260831s-gist-only-summaries.md)), and became a nested, numbered outline of the
article, its parts and its sections, with a **Depth** control (the `?deep=` cut-off), `+N sections`
badges that opened one node past it, a paragraph count on every row, and a panel that followed the
reader down the page. From 2026-09-05 each part showed its Socratic question instead of its gist
([structure-step.md § The question under the claim](structure-step.md#the-question-under-the-claim)). Simple
joined it as a second sub-mode on 2026-09-30, and the two shared one row as Parts | Sections beside
the slider from 2026-10-01 morning.

It went the same afternoon:

> I'm looking at the summary mode, and I think actually getting rid of parts and sections is
> probably the way forward. It was an experiment, and it's just not working that well. We already
> have the structure mode, and so I think that probably overlaps with the summary parts and
> sections, and so let's just get rid of parts and sections.
>
> So that just leaves the slider that ranges from sort of brief to fuller summaries. So we can
> altogether get rid of all of the machinery that does those parts and sections summaries.
>
> — Greg, 2026-10-01 (spya-b3ggv4)

What was removed is the drawing, not the data: the gists, the structure stage, `buildSummaryTree`
and `TreeNode.question` all stay, because Structure, Marginalia, the masthead, the shelf and others
read them. [261001p](../plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md) is the
removal.

**To read the outline's design**, which was long and careful — three ways for a node to be hidden
and why they are three variables, the root's badge as its own twist, focus handed from a vanishing
badge to the twist, the whole entry as a click target, and the follow-the-reader scroll — read this
doc and the component as they were before the removal:

```
git show 9e5cb2ccac385a0615fecbaea22f28b8472d6cdf^:docs/project/summaries.md
git show 9e5cb2ccac385a0615fecbaea22f28b8472d6cdf^:src/web/SummaryPanel.tsx
```

The follow-the-reader scroll itself lives on in [`follow.ts`](../../src/web/follow.ts), which
Skim now uses ([skim.md](skim.md)); its header holds the reasoning (move only when
the target changes, never fight the reader's own scroll, why the slide is ours and not the
browser's).

## See also

- [structure-step.md](structure-step.md) — stage 4, which writes the gists and questions the outline drew
- [structure.md](structure.md) — where the article's outline is drawn now
- [block-ids.md](block-ids.md) — the contract the passage chips rest on
- [reader-profile.md](reader-profile.md) — the profile and goal that shape every level
- [prompting-guide.md](prompting-guide.md) — the plain-words rule the levels share
- [original-version/summaries.md](original-version/summaries.md) — their ladder, their one-call
  batching, and the two failures the first version here was shaped around
- [url-state.md](url-state.md) — `?summary=` among the rest
