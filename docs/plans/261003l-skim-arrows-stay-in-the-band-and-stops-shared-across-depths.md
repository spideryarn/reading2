# Skim: the arrows stay in the band on a phone, and a stop may be walked at more than one depth

Up: [plans.md](../project/plans.md) · the mode: [skim.md](../project/skim.md)

Two reports of Greg's, both filed 2026-10-03 from an iPhone in portrait, on
`we-must-pace-the-frontier-spya-qhda2b` in Skim. Both proven his from the production row
(`feedback-reporter.ts --report-id`, exit 0). Queue item `qi-fqe3q8je`. One plan because both are
Skim; two stages, two commits.

## What Greg said

**spya-kudr63** (SPIDERYARN-READING2-B9), a suggestion:

> We have special behavior for portrait on an iPhone because it's just not possible to show a mode
> and the text at the same time in a sort of meaningful way. So when the mode is visible, it's
> visible, and if you click somewhere, it takes you to the article. And that's okay. It's probably
> the best compromise. There's just one case where I think this doesn't work. So if I'm in skim
> mode, then those left and right arrows at the top, I would like to be able to press those and
> stay in skim mode. Whereas right now, if I click them, they open up the article text. Now, in
> fairness, there is a back to skim button that shows up, so it's not a terrible experience. But I
> think in this special case, the left and right buttons of skim mode should stay in skim mode. Now,
> the extra thing to bear in mind is if I click on the skim mode item, like if it's showing me a
> quote and I click on the quote, I think I do want to be taken to the article. If there's a way to
> do this that isn't horribly complicated and brittle, great, let's make this change so that the
> buttons stay in skim mode. If it's going to make everything horrendous, then I can live with it
> as it is.
>
> — Greg, 2026-10-03

**spya-ms9d69** (SPIDERYARN-READING2-BA):

> In skim mode, I'd given these instructions that we didn't want to reuse the same items between
> the different levels of granularity because it would be annoying to see something you've already
> read multiple times. At the same time, I just went through an experience where it made it sort of
> spread. There were like two points made that were related, and one of them showed up in one in
> the gist, and one of them showed up in the more detailed version. And I guess it was trying to
> avoid having, you know, them show up in multiple levels, but it was very disjointed. So I guess it
> is okay if they show up across multiple levels. It probably is better. But maybe we could indicate
> in the UI that either that I've already read them, you know, because I spent a long time looking
> at them in other mode, or that they show up in the other modes. So maybe there'd be, and again, if
> possible, we want to avoid text labels. So maybe it's some kind of subtle visual indicator that
> indicates which of the three it shows up for. A bit like we have a spark line at the top of skim
> mode to show the trajectory. And then I think it would be reasonable to expect that anything in a
> core—well, okay, it would be reasonable if many of or some of the stuff that showed up in the
> coarser skim levels also shows up in the finer skim levels, because it may be that someone goes
> straight to the finer skim level and they don't want to miss out on something just because it's
> already in a coarser one. At the same time, it may be that something that's a good summary point
> for the coarser actually can be broken up into a few. Different quotes for the more granular. So
> it's not a guarantee, but nor is it excluded that something in a coarser level shows up in a more
> detailed level. And the visual indicator is a way for me to see whether I've probably read it or
> not.
>
> — Greg, 2026-10-03

The second reverses, in part, his own SPIDERYARN-READING2-4P of 2026-09-29 (*"it's a bit annoying
for the more detailed levels of granularity to reuse the same snippets as the coarser levels"*),
which plan [260929e](260929e-trajectory-each-pass-walks-only-its-new-stops.md) built as: each pass
walks only the stops it adds.

## Prior work

Checked 2026-10-03: no plan, no note in `docs/user-feedback/`, no commit and no other session
names either report id. The only matching `gjd-remote` session is this one.

## Stage 1 — on a covering band, the head's controls stay in Skim

**Today.** On a window too narrow for band and prose side by side (`covers`, `fit.modeW === 0`),
the band lies over the prose. Every movement along the route goes through `moveTo` in
[`SkimMode.tsx`](../../src/web/modes/skim/SkimMode.tsx), which scrolls the prose to the stop and
then calls `onAway()`, so the band steps aside. A row press (`onRow`) is a jump and steps aside too.

**The change.** `moveTo` stops calling `onAway()`. Only `onRow` steps the band aside. So:

| what is pressed | band covering the prose |
|---|---|
| ‹ › in the head, ← → keys | stays; the list follows to the new current row |
| a depth button (Gist · More · Most) | stays |
| a row (the quote) | steps aside, to the article — unchanged |
| *Next stop ›* / *More detail ›* in the prose | the band is already aside; unchanged |

The prose still scrolls to the stop underneath, so when the reader does press the quote or close
the band, the article is already there. The arrival flash is already held while a band covers
(`flash.ts` § a flash nobody can see is held), and a row press flashes through `beginJump` as now.

The depth buttons are included although Greg named only the arrows: they sit in the same head, and
"a control in the head stays, a row goes to the article" is one rule a reader can learn, where
"arrows stay, depths leave" is two. Flagged as a question in the debrief.

**The simpler version passed over:** none simpler — this removes one line. The version *not* built
is a phone-portrait-only rule (`matchMedia` for orientation): `covers` is already the app's one
definition of "the band and the prose cannot both be seen", and a second definition is the brittle
thing he asked us to avoid.

**Done when:** a test that renders the band with `covers` shows a step (and a depth change) not
calling `onAway`, and a row press calling it — seen red first; the browser check at phone-portrait
confirms ‹ › keep the band up, the current row moves, and pressing the quote lands on the right
passage in the article. Desktop and iPad widths unchanged.

## Stage 2 — a stop may be walked at more than one depth, and a mark says which

### The data

`SkimStop` gains one optional field:

```ts
/** Deeper passes this stop is walked in again, each > depth, ascending, unique. Absent or empty: none. */
again?: SkimDepth[];
```

`depth` keeps its meaning — the shallowest pass the stop belongs to — so everything the server
checks today is untouched: the caps, `visibleCounts`, the growth rule, one stop per quote and per
block. A stop is **walked in pass *d*** when `depth === d` or `again` includes `d`.

- A route stored before this has no `again`, and walks exactly as it does today. Nothing is
  migrated. The artefact is one JSON document, so there is no schema change.
- `validateRoute` reads `again` defensively: not an array → none; entries that are not 2 or 3, or
  not deeper than `depth`, or repeated, are dropped and counted in a new `SkimDrops.badAgain`
  (optional, as `badCue` is). A bad `again` never drops the stop.
- The public DTO (`publicSkim` in `src/public/dto.ts`) carries `again`, or a visitor would see a
  different walk from the owner.

**The version not built:** replacing `depth` with a `passes` set. It would re-open the caps and the
growth rule (what does "must grow" mean for overlapping sets?) and stale-shape every stored route,
for no behaviour `depth + again` cannot express.

### The prompt (`skim/9`)

Section 2 of `SKIM_SYSTEM` today says the passes nest. The reader has not walked them that way
since 260929e, and the prompt was left alone then because rewording it measured as no gain. Now
the model has a real decision to make, so the section is rewritten to say what the reader meets:

- each pass is walked as its own stops: the ones first placed at that depth, **plus any earlier
  stop you carry into it**;
- `again` lists the deeper passes a stop is also walked in;
- carry a stop when the deeper pass's own stops lean on it (it is one half of a pair, or the claim
  the new stops explain), or when a reader who starts at that pass would miss a main point without
  it;
- do not carry a stop the deeper pass already breaks into finer stops, and do not carry everything:
  a reader who walked the shallower pass first should mostly meet new passages;
- a carried stop keeps its one place in the route order.

The output schema's item gains a required `again` array of integers (`enum: [2, 3]`), required
because OpenAI-strict and the "omit the field" comma trap both prefer always-present
([prompting-guide.md](../project/prompting-guide.md) § What the model writes back). `ANSWER_TOKENS`
grows by a few tokens per stop.

`PROMPT_VERSION` → `skim/9`. An outdated route is not announced (260929c), so stored routes keep
walking the old way until re-planned from Metadata. The cue rules, the coverage rule, the targets
and the input hash are unchanged.

### Measured before it is kept

The method in [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md),
on the local articles that have Quotes and Ideas, two runs per arm, `profile: null`, calling
production's `generateSkim` (the old module from the commit before, as
`scripts/eval/skim-coverage-eval.ts` already does):

1. **Does it carry a sensible amount?** Per pass, the share of the walk that is carried stops.
   260929e measured 43% and 46% under full nesting and Greg found that annoying; 0% is today and
   he found that disjointed. Wanted: well under the nested share, above zero on most articles.
   If the model carries nearly everything or nothing, the wording is changed and re-measured,
   and if wording cannot hold it, a cap in `validateRoute` is added and named here.
2. **Did the rest move?** First-depth allocation (pass sizes) and Idea coverage per pass, new
   against old, compared with old-against-old. Asking for `again` should not change which quotes
   go where beyond run-to-run noise.
3. **Does More read less disjointed, and are the carried stops the right ones?** A blind judge in
   a fresh subagent, pairs file only. For each article the file shows **the Gist walk first**, each
   stop with its whole paragraph (Sol F2 — the judge cannot answer "after Gist" without it, and
   260929b's eval did the same), then the More walk as the old rule draws it and as the new route
   draws it (sides shuffled with `blindCoin`, key in its own file, balance checked), plus an
   old-against-old control. Per pair: which reads as one connected walk to somebody who has just
   read that Gist, and which to somebody starting at More. And per carried stop, unblinded by
   necessity: a useful bridge or main point, a redundant repeat, or superseded by finer stops in
   the same pass. Read against the control's spread.
4. **Validity.** No failed route, `badAgain` counts, no truncation.

Written up in `docs/investigations/` before the stage is called done.

### The walk (client)

All of it is in [`skim-route.ts`](../../src/web/skim-route.ts), which is pure and pinned by
`tests/skim-route.test.ts`:

- `walkedIn(stop, d)` — the one definition. `passRoute`, `passCount` and `firstStopOf` use it.
- **`offeredDepths` does not** (Sol F1): a depth is offered only when some stop is *first placed*
  there, as today. Otherwise a short route — one Gist stop with `again: [2]` — would offer a More
  that is the same one stop again. `walkedIn` therefore also ignores an `again` naming a depth the
  route does not offer, and `validateRoute` drops such an entry (`badAgain`) before it is stored.
- `locate`: a `?stop=` still wins, and draws **the asked depth when the stop is walked there**,
  else the stop's own `depth`. (Today a stop has exactly one pass, so the asked depth never
  mattered once a stop was named.)
- `src/web/params.ts` and [url-state.md](../project/url-state.md) say a stop has one "own pass";
  both are updated, and the tests cover the four cases (Sol F5): asked depth walks the stop, asked
  depth does not, no depth asked, and a depth change that stays on the same stop (one pushed entry,
  restored by Back).
- A depth change still lands on stop 1 of the new pass. That can now be the stop the reader is on;
  `changeDepth` already handles "did not move" by updating the address without scrolling.
- `doorAfter`: unchanged in shape. *More detail ›* can land on the stop you are standing at when it
  is carried and first in the deeper pass; the pass changes and the door becomes *Next stop ›*.
- The stop card's "also at stop k" counts along the pass as drawn, as now.

### The mark

Per row, a small run of pips, one per depth the route offers, shallowest first; a pip is filled
when the stop is walked in that pass. Muted, no text. It sits in the row's number column with the
position line, so it costs no width.

```
 3   Methods › Sampling
 ●●○ “We drew 412 participants from …”
 │
```

- Drawn on every row, so the glyph is one system: a row with one filled pip is in this pass only;
  more than one says "also in Gist" — probably read already, which is the use Greg names.
- Not drawn at all on a route with only one offered depth, or where no stop on the whole route has
  `again` (every old route): three pips that never vary would be noise.
- **Not interactive** (Sol F3): the number column is inside the row's own button, and the "where
  am I" button already lies over the position line, so a third trigger would nest or collide. The
  pips are plain marks inside the row button, above the position line (which, with its overlay,
  moves down by their height). Their words (*"Also in Gist"*, *"In More and Most"*) are `sr-only`
  text in the row, so the row's accessible name carries them; nothing is printed.
- **The legend is in the band's (i)** — one sentence, shown only when the pips are — and on
  `/help`, because hover does not exist on the phone this was asked from.
- The prose's door does not carry it in v1.

### Docs, in the same stage

[skim.md](../project/skim.md): a dated section with Greg's words, the *Each pass walks only its own
stops* section marked as amended, the `skim/9` line; `src/skim.ts`'s `PROMPT_VERSION` history;
[narrow-windows.md](../project/narrow-windows.md) / [touch.md](../project/touch.md) /
[keyboard.md](../project/keyboard.md) wherever they say Skim's band steps aside on a step; the
reader's `/help` page if it describes either behaviour.

**Done when:** `tests/skim.test.ts` and `tests/skim-route.test.ts` pin the validation and the walk
(red first), including F1's one-stop fixture; `tests/public-dto.test.ts` carries `again` on its
route fixture and asserts it crosses while `profileHash` and provenance still do not (Sol F4); a
panel test pins the mark and its absence on an old route, the investigation is
written with its numbers, `npm test` and `npm run typecheck` are green, and the browser check at
desktop, iPad and phone-portrait shows a re-planned route with a carried stop marked.

## Deferred, and named

- **A mark for "I have actually read this"**, from reading time. Greg offered it as the alternative
  (*"either that I've already read them … or that they show up in the other modes"*); the second is
  built. Reading time is recorded per block ([reading-time.md](../project/reading-time.md)), so it
  is possible, but it is a different signal with its own threshold to choose. Asked in the debrief.
- **The mark on the prose's door**, for a phone where the band is aside.
- **Re-planning stored routes.** Old routes walk the old way until re-planned from Metadata;
  no banner, by 260929c.

## Questions for Greg (asked in the debrief; defaults taken)

- **[Q-depth-buttons]** On a phone, should Gist · More · Most also keep the band up, as ‹ › now
  do? Built: yes.
- **[Q-mark-every-row]** The pips are on every row of a route that has any carried stop. The
  alternative is to draw them only on the carried rows, which is quieter but makes the mark appear
  and disappear down the list. Built: every row.
- **[Q-carry-cap]** A pass may carry at most half as many earlier stops as it has new ones (so a
  More of six new stops repeats at most three). Built after Sol's F7. The alternatives are a
  tighter cap, or nothing carried into Most at all, where the repeats that looked redundant sat.
- **[Q-read-mark]** Whether to also build the reading-time version of the mark.

## GPT Sol's plan review (2026-10-03)

[The review](261003l-skim-plan-review-sol.md) of commit `df200c954`: *do not build* unchanged, on
F1. All five accepted, and the sections above now carry them.

| | | what changed |
|---|---|---|
| F1 | P1 | `offeredDepths` stays on first-placed stops; an `again` to an unoffered depth is dropped and ignored |
| F2 | P2 | the judge sees Gist and whole paragraphs, and classifies each carried stop |
| F3 | P2 | pips are not interactive; words in the row's name; legend in the (i) and `/help` |
| F4 | P2 | `public-dto` test pins `again` crossing |
| F5 | P2 | `params.ts`, url-state.md and four URL cases |

No second plan round: the fixes are the reviewer's own, and the stage's code review is asked to
check each by id.

## Progress

- 2026-10-03: stage 1 built and committed (`6236d0957`). The plan missed two things the build
  found: `tests/skim-panel.test.tsx` already pinned the old stepping-aside (rewritten there), and a
  flash can now stay held for a whole walk, so `Reader` drops it on a change to another covering
  mode. The code review found that its passive timing could instead discard the incoming mode's
  landing, moved it to a small layout-effect hook and pinned the parent/child ordering without a
  full Reader harness.

- 2026-10-03: plan written; prior-work check clean.
- 2026-10-03: stage 2 built by two Opus subagents (server; client) and measured by a third —
  [261003e](../investigations/261003e-skim-again-carried-stops-eval.md), two rounds, $1.09.
  Round one's wording carried a quarter of More but put the carried stops at the head of the pass
  in 10 of 11 runs, as a recap: the old prompt already listed Gist stops first, which never showed
  while passes shared nothing. A paragraph was added saying the route is one order with the depths
  mixed; round two has the recap in 4 of 11 runs and 40 of 59 carried stops next to a stop they
  pair with. It also carries more (33% of More, 22% of Most). Kept, with no cap: under the 43% of
  full nesting, and within "many of or some of". **Not shown**: that More reads more connected
  after Gist (8–3, inside the control's 5–0). Shown: that it reads more complete started cold
  (11–1 against a control of 3–1).
- Code review: the raw totals above reproduce, but the investigation concludes “not as it stands”:
  NEW-b needs a limit. Individual More walks ranged from 0% to 50% carried and two runs carried all
  of Gist into More. No cap is implemented; that product choice remains before landing.
- What the build changed from the plan: the mark's hidden words name only the *other* passes
  ("Also in Gist"); the pips are off when no stop is walked in more than one *offered* pass; the
  door's *More detail ›* title no longer says "the stops the passes before it left out".
- 2026-10-03: [GPT Sol's code review](261003l-skim-code-review-sol.md) of `4478eee77`: *do not
  land* on F7, and four fixes of its own (F6 the held-flash drop ran after the incoming band's
  landing, now a layout effect with a test; F8 `scripts/skim-coverage.ts` walked passes the old way;
  F9 the prompt demanded a pass the targets cannot fill; F10 five overclaims in docs). F7 accepted:
  `maxCarried` and the prompt sentence, red first. Round three of the measurement is with both: 26%
  of More, 20% of Most, no run carrying none or all, the code cutting 2 entries in 12 runs. The
  cap cuts the latest in route order, which on round two's routes would have cut 4 useful entries
  of 5 — arbitrary, and left so because it rarely fires and no better rule is testable on 5.
- Browser check (Sonnet, Playwright, 1280 / 820 / 390): all ten points passed on a tree before
  the cap and Sol's fixes; screenshots `261003l-shot-1` to `-5`. Notes: the pips are clear on a
  phone and at the lower limit of legible at desktop 1x; a deep link whose `?depth=` its stop is
  not walked in keeps the stale `depth` in the address until the first step (as before this plan).
