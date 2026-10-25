# 261025j — How much of the article you have read, at the top

Up: [plans.md](../project/plans.md) · feedback `spya-e5477u` (#706) · session `fbe5477u-how-much-read`

Greg, 2026-10-25 (`spya-e5477u`), from Learn on `entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`:

> At the top of the article, could you somehow give a quick visual indication of roughly how much of
> it has been read? And I realize that's not going to be exact, and it's complicated because it may
> be I didn't choose to read every single word, but, like, sort of try and broadly estimate: have I
> finished the article? It could be a pie chart or something like that, or something that is a bit
> less like— basically, I don't want to see a whole bunch of indications that I'm 97% finished
> because I read most of the paragraphs but chose to skip some, or because I read basically all of
> it but skipped the final section that's, like, not that interesting for some reason. So, yeah, it
> can be a coarse estimate, basically, is what I'm saying.

## What is already measured, and reused

- **Per block, seconds on screen** while the reader is active ([reading-time.md](../project/reading-time.md)).
- **"Read" for a block** is the quiz's rule: on screen for 70% of its reading time (`isRead`,
  `src/web/read-filter.ts`).
- **The share read** is words in read body blocks over words in body blocks (`shareRead`); body
  leaves out footnotes, endnotes and the bibliography. The quiz draws it as a pie (`SharePie`); the
  chats are told it as a coarse phrase (`shareWords`, `src/reading-so-far.ts`).

Nothing new is measured. This is the same share, drawn at the top, in coarse bands.

## What changes

1. **One set of bands, `readBand(share)`** in `read-filter.ts`, a closed union:

   | share         | band       | pie            | card says           |
   |---------------|------------|----------------|---------------------|
   | under 5%      | `none`     | not drawn      | —                   |
   | 5% – 37.5%    | `started`  | a quarter      | Started             |
   | 37.5% – 62.5% | `half`     | half           | About half read     |
   | 62.5% – 80%   | `most`     | three quarters | Most of it read     |
   | 80% and over  | `finished` | full           | Finished            |

   **80% is the line for Finished** because of Greg's two examples. Skipping a dull last section is
   typically 10–20% of a piece. Skipping a few paragraphs here and there is less than that. Both
   should read as finished, not as "97%". **The pie is snapped to the band**, so the picture is the
   coarse estimate rather than a precise slice. The card never prints a percentage, because a number
   is what brings back the "97%".

   `shareWords` (the chats' phrase) moves onto the same bands, so the pie and what the chat is told
   cannot disagree: `none` → little or none, `started` → a small part (under 15%) or about a quarter,
   `half` → about half, `most` → about three quarters, `finished` → most or all. The only boundary
   that moves is three-quarters/most-or-all, from 87.5% to 80%. That is a one-word prompt change on a
   rough guide, so it is not measured.

2. **What it is a share of: the body, minus what is folded shut on arrival.** That means front
   and back matter (abstract, authors, acknowledgements, the references stretch: `matterStretches`)
   and the masthead's echo of the title, which is never drawn. These are the same blocks
   `TableView`'s `uncounted` already leaves out of the glossary's fade. They are left out entirely,
   not counted only when read. Counting them only when read would let a read abstract move a reader
   from nothing to Started (Opus, consulted while planning). A new pure helper,
   `foldedOnArrival(article)` in `matter-view.ts`, gives the set, and `TableView` uses it too, so
   the two cannot drift.

   **The chats still count matter**, because the server route has the blocks but not the validated
   matter. The difference is the abstract and the byline: a few percent at most, on a phrase that
   is already a rough guide. It is written down under § Deferred.

3. **A pie, `ReadSoFarMark`, in the masthead's facts line, directly after "~12 min"** and in the
   same fact, so it reads as one thing: how long the piece takes, and how much of it you have done.
   It reuses `SharePie` (button, controlled card, `aria-label` from the band's words). Card:
   *"Most of it read"* and then *"A rough guide, from how long each passage has been on your screen.
   Skipping a section or a few paragraphs still counts as finished. The folded front and back matter
   and the notes don't count."*

4. **Owner only, and only once the reading-time read has answered.** It is drawn when `useReadingTime`'s
   status is `loaded`, never while it is loading or after it failed, so a page still loading never
   claims "not started". A visitor has no reading time and sees nothing. It is computed in `Reader`,
   where `bodyWords` and the levels already are, and `Masthead` takes an optional `readBand` prop.
   It updates live, because the levels do.

## Passed over

- **"Finished" when you reach the end** (the last part of the body read). That contradicts Greg's
  own example of skipping a dull final section, and it is a second rule to explain.
- **A looser per-paragraph rule (35%) for this signal only.** A brisk reader is already covered by
  the 80% line. A second rule would let the pie say Finished while the quiz's *Only what I've read*
  leaves out a third of the questions (Opus).
- **An empty circle for "not started".** It looks like a radio button, and fewer marks is better.
- **A progress bar.** It suggests a position (read up to here), and the share is not contiguous.
  The quiz pie's plan, 261003e, made the same call.
- **Taking matter out of `isBody` everywhere** (quiz, clock, chat). That is the right long-run
  answer, but it changes the reading-time clock and the quiz. It is deferred, not built here.

## Deferred

- **The shelf.** "Have I finished this?" is asked there too, maybe mostly there. It needs each
  article's reading totals, blocks and matter in the shelf read, which is a server change. It goes
  to Greg as a question, with a recommendation.
- **The chats leaving matter out** (above). The cost of not doing it: a reader who skipped the
  abstract is told "about three quarters" a little more often than the pie shows Most. It is
  harmless in direction.

## Checks

- `tests/read-band.test.ts`: every boundary of `readBand`; `shareWords`' table updated at 0.8.
- `foldedOnArrival` unit test: echo plus a matter stretch, and no matter (the byline fallback).
- A component test: the owner's masthead draws the pie with the band's label once the levels are
  loaded, draws nothing while loading, nothing for `none`, and nothing for a visitor. Seen red first.
- `npm test`, `npm run typecheck`, lint on touched files; a Sonnet browser look at the masthead.

## After GPT Sol's plan review

[The review](261025j-plan-review-sol.md) found no P0. As built:

- **P1, three answers for one reading.** It was right that leaving matter out of the masthead
  alone would let the masthead say Finished while the quiz said "about 67%". Sol's fix was to count
  matter everywhere. That was not taken, because Sol's own evidence cuts the other way: a folded front summary can be
  1,500 words, enough to stop a reader who has read the whole argument from ever reaching Finished.
  Instead the reading view's one `bodyWords` map leaves the folded stretches out
  (`readSoFarWords`), so **the quiz and the masthead say the same share**. `readBandFor` lost its
  second argument. The chats still count matter, and the code and docs now say so rather than
  claiming agreement: the chat may be told a band lower than the pie, never higher.
- **P1, the card over-promised.** It now says *"You don't need to read every passage for this to say
  finished."*
- **P2, a 5% share drawn as a quarter.** Kept, as a declared exception rather than a silent one. The
  quantity this mark claims is the band, and the label says the band in words. Written into
  `SharePie`'s header, `ReadSoFarMark`'s, and design-css-overview.md § Draw a number.
- **P2, accessible names.** Now *"Read so far: started"* … *"Read so far: finished"*, pinned in
  `tests/masthead-read-so-far.test.tsx`.
- **P2, docs and styles.** reading-time.md, quiz.md and front-and-back-matter.md each have a line.
  The pie's styles moved to their own sheet, `share-pie.css`, as quiz.css asked once a second user
  arrived, and its 40px coarse-pointer size went with them (`touch-targets-261021g` still pins it).
