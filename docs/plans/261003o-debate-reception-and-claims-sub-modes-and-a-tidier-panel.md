# Debate: Reception and Claims sub-modes, and a tidier panel

Up: [debate.md](../project/debate.md)

**Status:** built and on `dev` (2026-10-04). The claims picker and the citation index wait on Greg. Report `spya-caue42`, Greg (admin), 2026-10-03, on Levin 2024,
*Self-Improvising Memory* (Entropy 26(6), 481).

## What Greg asked for

> I don't quite understand what debate mode is doing. The UI is confusing. Like, in this case, it
> seems to have found some interesting stuff about the RNA and C. elegans study, and like, oh, it
> turns out that's more controversial. All right, cool. But A, that's very specific. It's one claim.
> And B, it doesn't tell me anything about how the paper has been received more generally. I mean,
> this came out a little while ago, so I was hoping, you know, have other people reviewed it or
> critiqued it or discussed it? So maybe I'm asking for a few things. It may be that you could, as a
> first pass, say, which of these claims do you want me to check? So there could be a claims
> submode. So one claim might be, you know, about the RNA and C. elegans, and then there could be
> effectively a thread or something a bit like with the search mode for each claim, and then papers
> that have sort of evaluated the claim since then. Okay. And then there's a section, a separate
> submode besides claims for reception or critiques or responses or something. Yeah, reception
> sounds about right, which talks about, you know, other people who have—what have they said about
> this? I don't know if we need a separate submode for has it been cited, who has cited it. Is that
> the same thing as reception or is that different? Well, use your judgment. Maybe some quick evals,
> and also tidy up the UI.
>
> — Greg, 2026-10-03

His fewer-modes report the same day (`spya-thpsnd`) adds, as an aside: *"maybe debate then has a
search box … it would be cool if the debate could be steered, maybe in multiple directions, a bit
like the way we can steer the search."*

## What is there today, and what the quick evals found

Debate already runs the two searches Greg describes: **pass A** looks for work about the piece
itself (reception, and since 2026-10-02 the papers that cite it), **pass B** picks a few of the
piece's claims and looks for what has been written about each. The panel then draws both in **one
list**, under up to four controls at once (an order bar, an "identification" slider, a "relevance"
slider, thread buttons), each with its own count and note.

The measurements are written up in
[investigation 261003g](../investigations/261003g-debate-on-a-thinly-received-paper-what-reception-finds-and-how-claims-spread.md).
In short:

1. **On Greg's paper the reception search keeps nothing, and that is close to the truth of the open
   web.** A manual check found no review, reply, blog or forum thread about it. What exists is 39
   papers that cite it (OpenAlex), and a web search does not surface those. Two runs each offered
   one LinkedIn post, refused because its quotation was not in the extract.
2. **The claims search already spreads over 3–4 claims** (3–6 rows a run). Greg saw one claim
   because his address carried `debatethread=key`: the list was narrowed to the two or three "key
   sources", which were all on the RNA claim. The claims are never listed as claims, so nothing told
   him there were others.
3. **A bug: the default filter hides the citing papers and the published replies.** The identification slider defaults to
   *quotes it*, which hides a source that only *names* the piece. On *Attention is not
   Explanation* both runs kept one reception row, the published reply *Attention is not not
   Explanation*, and both times it was hidden by the default. A citing paper names the piece (a
   reference-list entry, which is what 261002i told the search to look for) and almost never quotes
   it. So the rows 261002i added are stored and then hidden by default, under a note saying "N
   responses are hidden". [Postmortem 261003h](../postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md).
4. **Asking the claims search about one chosen claim reports more on that claim and keeps about as
   many** (6 and 7 rows reported, 4 and 3 kept, against 3 reported and 3 kept in the one broad run
   that completed), and brings in different sources. It works with no other change to the search. That is the evidence for Greg's claims picker; see
   § Questions for Greg.

## What we build (v1): one stage, client only

No prompt changes, no change to what is stored, no migration, no new service. `PROMPT_VERSION`
stays. Every stored debate, old ones included, draws in the new panel. Revised after GPT Sol's plan
review (§ Review ledger).

```
 before                                     after
 Debate                        (i)          Debate                              (i)
 Order the sources by                       [ Reception 2 | Claims 5 ]
 [prioritised][by claim][date][stance]      Order  [as found][date][stance]     (only if they differ)
 identification  ●──○──○  quotes it 1 of 3  Threads: ★ Key sources · theme
 relevance       ●──○──○  loosely  5 of 5   row   (quotes or links the piece)
 Threads: ★ Key · theme · theme             Names this piece by its title only
 row (about the piece)                      row
 row (a claim)  On "…"                      Who cites it: search Google Scholar ↗
 row (a claim)  On "…"
                                            [ Reception 2 | Claims 5 ]
                                            relevance  ●──○──○  loosely  5 of 5
                                            Threads: ★ Key sources · theme
                                             ▾ "memories … across metamorphosis"  [jump]   2
                                                 row
                                                 row
                                             ▾ "RNA from trained animals …"      [jump]   3
                                                 row …
```

1. **Two sub-modes, Reception and Claims**, on a two-way segmented control built the way
   Summary's Brief | Fuller | Thread is. `?debate=claims`; Reception is the default and absent from
   the address; an unknown value reads as Reception. Each segment shows its count of rows on
   screen. **No sentence under the control** ([mode.md](../project/mode.md) bans description lines,
   F8): what each sub-mode is goes in the segment's `ControlTip` and in the (i). Reception: "What
   others have written about this piece itself: replies, reviews, and work that cites it and says
   something about it." Claims: "What has been written about the claims it makes, by people who
   may never have read it."
   - **Reception** draws pass A's rows only.
   - **Claims** draws pass B's rows only, **always grouped by claim, in article order**: each claim
     is a native `details`, open, headed by the article's own words, a jump to the passage and the
     number of rows under it; within a claim, rows the AI judged to bear most directly come first,
     unjudged last. No for/against tally (F9: it would promote the model's judgment into a
     headline). This is Greg's "thread per claim", from data we already store.
2. **"Is cited-by a third sub-mode?" No: it is Reception.** A paper that cites the piece and says
   something about it is reception, and pass A already looks for those. A complete list of citers
   needs a citation index: a new outside service, and the open question from 261002i, re-asked
   below with this paper's numbers. Until then Reception ends with one outside link, **"Who cites
   it: search Google Scholar"**, a title search, `rel="noreferrer noopener"` like the panel's other
   outside links. A search, never a guessed address (the rule 261003f set for author links).
   `scholarUrl` and `firstAuthor` move out of `src/citations.ts`, which pulls server machinery, into
   a small browser-safe module that both callers import (F4).
3. **The identification slider goes; title-only rows are shown, under their own heading.** This is
   the bug fix (postmortem 261003h), and it replaces a control with layout.
   - Reception lists the rows that **link or quote** the piece first. Rows that only **name** it
     follow under a heading, **"Names this piece by its title only"**. Nothing is hidden.
   - Why not simply move the default to `named` (the first draft): F5. The decoy that set the old
     default, a page about a different document with the same title and the same byline
     (260906b, the constitution), would then be the first row of Reception, looking like reception.
     Under its own heading it is on screen and flagged; the genuine reply measured here
     (*Attention is not not Explanation*, `named` in both runs) is on screen too.
   - `?name=` is retired: a link carrying it shows every row. The chip on each row ("Names /
     Quotes / Links this piece") stays. `debate-levels.ts` keeps only what the grouping needs.
   - Greg asked for that threshold on 2026-09-06 ("the user can threshold by that"). The grouping
     gives the same information without a control; it is in the debrief as a decision he can
     reverse.
4. **The relevance bar belongs to Claims** and shows there by today's rule (some claim row carries
   `bears`), for owners and visitors alike (F3: a visitor's rows carry `bears` and `identifies`
   too). It keeps its reset; no new rule for hiding a bar (F2). `?bears=` now applies whenever
   Claims is on screen.
5. **Orders shrink, and the legacy value is lifted, not interpreted** (F7).
   - Reception: *as found* (default), *date*, *stance*, offered only when they would draw
     different lists (the existing rule), each within the two identification groups. The address
     keeps `?debateby=date|stance`; `prioritised` stays the absent default.
   - Claims has no order control and ignores `debateby`.
   - `?debateby=claim` is rewritten once, in `router.ts` beside the other `lift…` rewrites, to
     `?debate=claims` with `debateby` removed. So nothing downstream reads a legacy value, pressing
     Reception cannot be bounced back, and an explicit `debate=` always wins. An old by-claim link
     opens Claims and no longer shows the reception group above it; that is the intended change.
6. **Threads stay, scoped to the sub-mode.** A theme or the Key sources button is offered in a
   sub-mode only when it has a **stored** row there. One whose rows there are all hidden by the bar
   keeps today's disabled button and explanation. A thread named in the address with no stored row
   in the sub-mode on screen narrows nothing and is not drawn as selected, so an old
   `debatethread=key` link cannot empty Reception. The "Showing N … show all" line stays: a
   narrowed list that does not say so is what misled Greg.
7. **Empty states keep every distinction they make today, per sub-mode** (F1): nothing returned,
   pages returned but none could be checked, rows withheld from a visitor, and a list emptied by a
   bar or a thread are four different sentences, and stay so. Added: when Reception has no stored
   row and Claims has some, a button under the sentence, "See the N sources on what it claims",
   which switches sub-mode. The lead sentences that only made sense over a mixed list ("What
   follows takes up what it argues.") go.
8. **Fewer notices.** The per-order "frame" sentence goes. "Nothing is hidden by this threshold."
   goes; a bar speaks only when it hides something. The extracts-only sentence stays in the (i)
   and leaves every row's "more". The (i) keeps the counts, losses and provenance.
9. **The pre-search screen says what the two searches are**, in the new words: "Two searches of the
   open web. Reception: what others have written about this piece. Claims: what has been written
   about the claims it makes. It takes about a minute and costs real money. Many pieces have no
   reception at all. Searched once and kept."
10. **The machinery that owns a sub-mode hears about it** (F6): `debate` joins `REMEMBERED` in
    `src/web/last-view.ts`; Debate's vocabulary, parameter and command words go into
    `src/web/sub-modes.ts` so the command bar offers "Debate: Claims"; the generated command
    catalogue is rebuilt. Entering either sub-mode arms the one search exactly as opening Debate
    does today, never a second one. Marginalia's Debate items and chat tools are swept for `name`,
    `debateby` and the retired lead sentences.
11. **Docs:** debate.md, url-state.md (`debate`; `debateby` narrowed; `name` retired), the help
    page's Debate entry, the investigation, the postmortem.

### The simpler option passed over

Keep one list and only relabel the two groups with headings. Less code, but it keeps four controls
over a mixed list, and Greg asked for the two to be separate. The split is also what lets each
control apply to everything on screen.

### Not built, named

- **A claims picker and a steering box** (Q-claims-picker). It needs the search to take a reader's
  input, per-claim runs merged into a stored debate, and a spend rule: a product call and real
  complexity.
- **Listing every citer** (Q-citation-index).
- **Claims with no sources, and a for/against tally per claim.** Pass B reports only claims it
  found something on. Both belong with the picker.
- **An unclosed fence on an otherwise complete answer fails the run** (one of the four baseline
  runs, $0.19 for nothing). Found by the eval, outside this change; queued.

## Tests (red first)

- **The bug:** a reception row that only names the piece is on screen when the reader has touched
  nothing, under the title-only heading; and the decoy shape (title-only, no stronger row) is
  never drawn above or without that heading. Red on today's panel.
- Reception shows no claim rows and Claims no reception rows; segment counts match the lists.
- Claims groups by claim in article order, most direct first within a claim; legacy rows without
  `bears` and with the old `valence` vocabulary still draw.
- `?debateby=claim` lifts to `?debate=claims`; `debate=claims&debateby=date` is Claims; pressing
  Reception from a lifted link stays on Reception; reload and Back.
- Threads: no stored row in the sub-mode means not offered and not selected; rows hidden by the
  bar means disabled with today's explanation.
- Every empty-state sentence, per sub-mode, owner and visitor, with a real public payload that
  carries `bears` and `identifies`; the handoff button appears only when Claims has rows, and
  switches.
- The relevance bar: homogeneous `partly` rows with `?bears=directly` still show the bar and its
  reset.
- The Scholar link carries the title and the `rel`; the client build passes (F4).
- `last-view` restores Claims; the command bar lists both sub-modes.
- Mutation check at the end: draw title-only rows without the heading; swap the two row sets; drop
  `debate` from `REMEMBERED`. The suite must notice each.

Browser check (Sonnet subagent, Playwright on the box): desktop, iPad and phone widths, both
sub-modes, a debate with reception rows and one without, a visitor's view.

## Review ledger

Plan review, GPT Sol, 2026-10-03:
[261003o-debate-reception-and-claims-plan-review-sol.md](261003o-debate-reception-and-claims-plan-review-sol.md).
Verdict: build with the P1 fixes. All nine findings accepted, each checked against the code:

| | Finding | What changed |
|---|---|---|
| F1 | one "no rows" sentence would flatten four different outcomes | step 7 |
| F2 | "hide a bar that can hide nothing" strands a reader with a restrictive link | rule dropped; step 4 |
| F3 | visitors do carry `bears` and `identifies` | step 4, tests |
| F4 | `src/citations.ts` is server code | helper moves; step 2 |
| F5 | default `named` puts the known decoy first | slider replaced by a headed group; step 3 |
| F6 | `last-view.ts` and `sub-modes.ts` own sub-modes | step 10 |
| F7 | legacy `debateby=claim` precedence | lifted in the router; step 5 |
| F8 | description line under the control is banned by mode.md | tooltips and (i); step 1 |
| F9 | tallies promote AI judgment; legacy `valence` | tallies cut; step 1 |

## Questions for Greg (not waited on)

### [Q-claims-picker] Should you be able to choose which claim Debate checks?

**Background.** Debate's Claims search reads the article, picks three or four claims by itself,
and looks for what has been written about each. As built, Claims now *shows* you those claims, each
with its sources under it. You cannot yet say "check this one". You asked for that ("which of these
claims do you want me to check?"), and in your fewer-modes report for a box to steer Debate.

**What the eval found.** Telling the search to check one named claim (the RNA memory-transfer
one) worked with nothing else changed. It reported about twice as many sources on that claim (6
and 7, against 3), kept about the same number after our quote checks (4 and 3, against 3), and the
sources were different ones: a bioRxiv preprint and a Scientific American piece disputing the
result. Each such search costs about 20 cents and takes about a minute and a half.

**The options.**

- **A. Leave it as built.** The search chooses the claims; you see them listed. Costs nothing
  more. You cannot direct it.

- **B. A box in Claims: "Check a claim…" (recommended, after a few days of using A).**

  ```
  [ Reception 0 | Claims 7 ]
  Check a claim…  [ RNA can carry a memory between animals      ] [Search]
   ▾ "memories … across metamorphosis"            2
   ▾ "RNA from trained animals …"                  3
   ▾ (you asked) "RNA can carry a memory …"        4     ← added by your search
  ```

  You type a claim in your own words, or press a button on a claim already listed to dig further
  into it. One more search runs, and its sources are added as another claim. This is also the
  "steer the debate" box. What it costs us: the search has to accept your words (today it takes
  none), each extra search has to be stored alongside the first, and each one spends about 20
  cents, so it needs the same care as the first search (a press, never automatic). Roughly two to
  three days of work.

- **C. List the claims first, search nothing until you pick.**

  ```
  Which claims should I check?
   ☐ Memories survive metamorphosis
   ☐ RNA can carry a memory between animals
   ☐ The self is rebuilt, not stored
   [ Check the ticked claims ]
  ```

  A cheap first step lists the article's main claims; you tick some; only then does it search.
  Nothing is spent on claims you do not care about, and you see claims the search would not have
  chosen. What it costs: opening Debate no longer gives you anything until you have chosen, which
  is a slower start; and it is the most work (a new claims-listing step, plus everything in B).

**What would decide it.** If the claims the search picks by itself are usually the ones you care
about, A or B. If you often find it has picked the wrong ones, C. B is the smaller step and does
not rule C out later.

### [Q-citation-index] Should Reception list the papers that cite the piece?

**Background.** You asked whether "who has cited it" is the same thing as reception. I have treated
it as the same: a paper that cites the piece and says something about it is reception, and Reception
looks for those. But a web search finds only the handful of pages that discuss a paper by name. On
the paper you were reading, there is no review, reply or blog post to find at all, and **39 papers
cite it**. The web search found none of them. Reception therefore honestly says it found nothing,
and offers a Google Scholar link instead.

The only thing that knows who cited a paper is a citation index. This is the question already
waiting for you from 2026-10-02
([261002i § The question for Greg](261002i-debate-leads-with-who-has-cited-this-article.md#the-question-for-greg)),
with the same four options. This paper is the case for its option 1: **OpenAlex** (free, open
licence). Reception would then show "39 papers cite this", listed with title, authors, year and
journal, most-cited first. It would not say what each one says about the piece; for that we would
still rely on the web search, or on Semantic Scholar's citing sentences, whose licence needs
asking for. It is your call because it sends the article's DOI (not its text, not who is reading)
to an outside service.

### [Q-identification-slider] The "identification" slider is gone. Is that all right?

**Background.** On 2026-09-06 you asked for a way to threshold reception by how sure we are that a
page is about *this* article, and Debate got a three-stop slider (names it / quotes it / links
it), resting on "quotes it". That default was hiding the published replies and citing papers, which
usually only name the piece. I replaced the slider with layout: pages that quote or link the piece
come first, and pages that only name it by title follow under a heading saying so. Nothing is
hidden and there is one control fewer.

- **Keep it as built (recommended).**
- **Bring the slider back**, resting on "names it" so nothing is hidden by default. About half a
  day. Worth it only if you find yourself wanting to hide the title-only rows.

## What landed (2026-10-04)

Built as planned by an Opus subagent (commit `4b502174a`), then reviewed and fixed by GPT Sol:
[261003o-debate-reception-and-claims-code-review-sol.md](261003o-debate-reception-and-claims-code-review-sol.md).
Verdict: land with the fixes it made. I read each fix and ran the gates; all five accepted.

| | Finding | Fix |
|---|---|---|
| F10 | the handoff button promised N sources that Claims' bar or thread could then hide | the press clears both |
| F11 | Reception offered an order that changed nothing once a thread narrowed the list | orders are asked of the rows on screen |
| F12 | a claim row the AI did not judge no longer said so | "Not judged for relevance by the AI" is back, on the row |
| F13 | a link carrying only the retired `?name=` could have a remembered view restored over it | `name` joins `NEVER_REMEMBERED` |
| F14 | the new browser-safe Scholar module was not in the client import manifest | registered |

Sol also wrote two short postmortems for F10 and F13/F14 (261003i, 261003j). One review round: the
fixes are small, each came with a test seen red, and nothing was overruled, so no second round.

Departures from the plan, kept: the Scholar link searches the title only (a byline is not
surname-first, which `firstAuthor` expects); the control reuses Summary's classes.

Browser check (Sonnet, Playwright, on real stored debates for two papers): every numbered check
passed at 1440, 820 and 390 wide. Screenshots: `261003o-shot-<width>-<reception|claims>.png` beside
this file. Minor roughness left as is: a segment's tooltip card stays open after a mouse press
until the pointer moves; the jump link's label is the block id, as elsewhere.

**Questions for Greg are below the build section; the fuller versions are in the session's
debrief to the Overseer.**
