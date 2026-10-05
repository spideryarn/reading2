# Five small UI fixes from the Overseer's queue

Up: [plans.md](../project/plans.md)

**Status: plan, 2026-10-05.** Not built yet.

> If you're confident, address all of the Q-queue-yeses
>
> — Greg, 2026-10-04, on the Overseer's list of small queued fixes

Five independent items, each its own commit. None adds a model call, a dependency or a schema
change. Each is a bug or a free improvement under Greg's 2026-10-04 rule.

## A. `qi-2ezdkjjy`: "about half a minute" for a thorough search is wrong

The reader is told a thorough (meaning) search takes *"about half a minute"*. Over 30 days in
production the median was 9 s and the 90th centile about 20 s (`ai_calls`; the figures come from
search-auto-thorough's debrief, commit `9969c9259`, and are not re-measured here because the
classifier refuses production reads in an unattended session).

**Change.** Two reader-facing places:

- `src/web/SearchPanel.tsx`, the *thorough* button's tooltip.
- `src/web/help/help-modes.tsx`, the Search section of `/help`.

New words: **"usually about ten seconds"**. "Usually" because one in ten takes twenty or more, and
a round "ten" because the median is a measurement that will drift.

Also the comments and docs that state the same figure about a meaning search as a fact
(`src/searches.ts`, `src/web/SearchPanel.tsx` head, `src/web/useSearch.ts`, `docs/project/search.md`
line ~851): corrected to "about ten seconds, sometimes twenty or more", where the sentence is about
how long a search takes today. A sentence that is history ("it used to show thirty to sixty
seconds of spinner") stays.

**Test, red first.** A small test that renders the tooltip text and the help section (or reads the
two strings) and fails on "half a minute". Passed over: no test at all, since it is copy. A test is
cheap and the two strings have to agree.

## B. `qi-g8pnn2hb`: Remember's chips wrap on an iPad with the experimental switch on

With the switch on, Remember's band head holds four chips (Recall, Tutorial, Quiz, Explore), the
bin and the (i). At iPad width they do not fit, and one chip drops to a second line by itself.

**Change.** First reproduce it in a browser at iPad portrait width (768 and 820) and find which
element wraps. Then the smallest change that follows
[narrow-windows.md](../project/narrow-windows.md): the chip group stays whole on one line and the
row's *other* items (bin, (i)) wrap or the chips tighten their gap/padding. A horizontal scroll is
not acceptable; nor is hiding a chip.

**Test, red first.** Layout cannot go red in jsdom. The red is the browser measurement before the
change (the chips' `offsetTop` differ), and green is the same measurement after, at 768, 820, 1024,
390 and desktop, switch on and off. If the fix is a class change, a unit test pins the class so it
cannot be dropped silently, and says in a comment that the browser check is the real evidence.

## C. `qi-7vjf55me`: shelf cards shift when the topic pills arrive

Plan [261005a](261005a-topic-pills-on-each-shelf-card-and-table-row.md) put a line of topic pills
on each shelf card. The pills come from a second request, so they land after the cards and every
card with topics grows by one line (about 24 px). 261005a accepted that and named it as a cost.

**Change.** Reserve the line's height before the pills arrive:

- The page already knows whether topics are *expected*: the topics request is loading, or it has
  answered with at least one topic. A shelf too small to have topics (under eight works), or one
  whose request failed, expects none.
- While topics are expected, every card (and table row) draws the topics line at its one-line
  height, empty and `aria-hidden` when the article has no topics (or none yet). No skeleton, no
  shimmer, no grey pills: a blank line claims nothing, so it is not a placeholder that lies.
- **An article in no topic keeps the blank line while the shelf has topics.** Collapsing it when
  the answer settles would be a second shift, and the answer can change several times (partial
  answers, a re-think). The cost: a topicless card on a shelf with topics is one line taller than
  it needs to be. Most articles on such a shelf have topics, and a new arrival gets its pills
  without the card moving.
- When topics stop being expected (the request fails, or the answer has none), the line goes.
  That is one shift, on a rare path.

What this does not fix: a card whose pills wrap to two lines on a narrow phone still grows by the
second line. Reserving two lines everywhere would cost more than it saves.

**The simpler option passed over:** leave it, as 261005a did. Passed over because the shift is on
the first screen a signed-in reader sees, on every visit.

**The other option passed over:** hold the cards back until topics answer. Slower first paint for a
cosmetic gain.

**Test, red first.** In `tests/shelf-topics.test.tsx`: before the answer, with the request in
flight, each card has an empty reserved topics line; after the answer, an article in no topic still
has it and an article with topics has pills in the same element; with no topics expected (a failed
request, an empty answer) there is no line. The existing controls "no line for an article in no
topic" and "none before the answer" change meaning and are rewritten, not deleted.

## D. `qi-b3b3qv9b`: Marginalia has no note for a Timeline date with no year

Plan [261005d](261005d-timeline-dates-without-a-publication-date.md) made the Timeline panel show a
date whose year is unknown in the article's own words (*"On July 7"*). Its `dating.kind` is
`rejected` with `reason: "noYearFrame"` and a `phrase`. Marginalia (`src/web/marginalia/notes.ts`)
shows `dated` and `words` events and leaves out every `rejected` one, so those rows have no margin
note.

**Change.** In `notes.ts`, a `rejected` event with `reason === "noYearFrame"` and a non-null
`phrase` is placed the way a `words` event is: beside the earliest mention whose block still holds
the phrase and the quote. The note's text comes from the same `datingWords` the panel uses, so the
two cannot disagree. The other two rejections stay out, as they do in the panel's short label. The
comment above the loop, and marginalia.md / timeline.md where they say rejected rows stay in the
band, are corrected.

**Test, red first.** In Marginalia's notes test: a yearless event gets a timeline note beside the
block that says its phrase; a rejected event of another reason gets none; a yearless event whose
phrase is no longer in any block gets none.

## E. `qi-gtftnpre`: a wrapped shelf facts line starts with "·"

A shelf card's line under the title (`Michael Levin · aeon.co · 12 Mar 2024 · ~41 min`) draws the
"·" inside each fact after the first, in front of it. Each fact is one flex item, so when the line
wraps on a phone the continuation starts with a dot.

**Change.** In `src/web/ShelfEntry.tsx`, draw the dot *after* every fact but the last, inside that
fact's span. A wrapped line then starts with a fact and the line above ends with a dot, which is
how a wrapped list of this kind reads in print. The gap arithmetic changes with it (`mr-2` becomes
`ml-2`) so an unwrapped line looks the same as today.

Passed over: hiding a separator only where the line wraps. CSS cannot know where a flex line broke
without a container query per item or JavaScript measurement.

**Test, red first.** In the shelf card's test: no fact span begins with the separator, every fact
but the last ends with one, and the last has none.

## Stages

One stage of five commits, built in parallel by subagents whose files do not overlap (C and E
share the shelf and go to one). Then a browser check at desktop, iPad and phone widths, GPT Sol's
code review, `/help` and the docs in the same commits, and a push to `dev`.
