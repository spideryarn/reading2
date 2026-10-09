# Peer review: one mode for Citations and Debate, with the works cited beside each claim

Report `spya-c2qmbg` (SPIDERYARN-READING2-BV), question
[q-xf2xvb](../user-feedback/questions/q-xf2xvb.md), queue item qi-m9sk699v. Session
`fbc2qmbg-peer-review-mode`, 2026-10-09.

## What Greg asked

> Do you think this is a good idea? I mean, your suggestions for question one are actually pretty
> good, and I'm inclined to go with B and then C1 to begin with. But I can't tell how much
> complexity there will be, or if you think this is actually a good UI decision. If you do, then
> let's go forward with it.
>
> For question two, I guess let's move this out of experimental, this combined mode. I am
> hesitating what to call it. Debate doesn't feel quite right. Maybe peer review, because that, I
> think, incorporates the idea that it's both internal and external to the article, i.e. what they
> cite and also what other people say about them. And indeed that framing, what this article cites
> and what other people say about it, this article might be a good sort of TLDR somehow for the
> different submodes.
>
> Let's call the sub-mode for citations listed in this article (i.e. the former Citations mode)
> "Bibliography", and this should be the first submode in this new peer review mode.
>
> — Greg, 2026-10-09 (reply `spya-vcvxu5` to q-xf2xvb)

B is one mode with three sub-modes. C1 means that in Claims, each claim lists the works the article
cites in that claim's paragraph. Both are explained in
[261004b § Part 2](261004b-citation-hover-card-offers-dig-deeper.md).

## Is it a good idea? Yes, and it is proportionate

**My view, and Opus's, asked separately: yes.** Citations and Debate answer one question: where
does this piece sit among other people's work? The merge removes a button from the bar and takes
nothing away. C1 is the first real link between the two halves: the article's own evidence for a
claim sits beside the outside view of it, using data we already store.

Two facts the question got wrong or left out, found in the code:

1. **Citations is behind the Experimental switch too**, not only Debate (`MODE_CATALOG`,
   `experimental: true` on both). Taking the merged mode out therefore brings *both* halves to
   every reader.
2. **"Peer review" clashes with Referee.** Referee is the mode for a reader who is *doing* a peer
   review. Its command-bar aliases are "peer review", "peer reviewer", "review" and "referee report",
   and the landing tile "For peer reviewers" opens it. Referee also has a sub-mode called Claims.
   Referee is behind the switch, so most readers will never see both. Greg will. Opus would have
   stopped and asked about the name before building; see § The name, below, for why I build on
   Greg's word anyway.

**Complexity.** B is mostly bookkeeping: the mode catalogue, the URL words, the chip row, help and
tests, plus a wrapper that draws the two existing panels under one chip row. No prompt, schema or
model call changes. C1 is one client-side join and one row element. My estimate is about two days of
agent time for both. A full rename of the stored names
(steps, columns, routes, files, CSS) would add one to two days more; see § Stage 3.

## The name: build on "Peer review", ask about the clash, and hold the deep rename

Greg chose the name tentatively ("Maybe peer review"). He did not know Referee owns the phrase. A
wrong name costs very different amounts at different depths:

- **On screen**, the name is one string in `MODE_LABEL` plus the catalogue's sentences. Changing it
  later is cheap.
- **The mode word** (`?mode=peer-review`, the `Mode` union, the help page, the remembered last view)
  is new in this work and has few stored copies. Changing it later is moderate.
- **The stored names** (the `citations`, `debate` and `debate-claims` steps and columns, routes,
  files, chat origins, CSS prefixes) total about 4,000 hits across 300 files. This is the expensive
  part, and it is the part a later name change would make us pay for twice.

So: build B and C1 now, with "Peer review" on screen and `peer-review` as the mode word, because
that is what he asked for. Hold the deep rename of stored names (Stage 3) until he has confirmed the
name, knowing about the clash. The follow-up question goes in q-xf2xvb itself.

The deferral is a real one. Stage 3 gets its own queue entry before the note may say *shipped*
([feedback-reports.md § Three ways a report ends](../project/feedback-reports.md#three-ways-a-report-ends)).
Until then, the stored names `citations` and `debate` stay as they are, and the docs say why.

**"Peer review" moves from Referee's aliases to the new mode's.** A reader typing "peer review"
into the command bar gets the mode with that name. Referee keeps "referee", "reviewer", "peer
reviewer" and "referee report". The landing tile keeps its words ("For peer reviewers" is about the
person, and it is right for Referee).

## What the reader gets

```
 bar:  … [ Peer review ] …          (was: [Citations] … [Debate], both behind the switch)

 band: ┌ Bibliography 42 │ Reception 3 │ Claims 8 ┐                         (i)
       │ the Citations list, exactly as today     │  ← Bibliography (the default)
       │ Reception list + Cited by, as today      │  ← Reception
       │ claim 1 "…"                              │  ← Claims
       │    Cited in this paragraph: Smith 2019 · Lee 2021     (C1, new)
       │ claim 2 "…"                              │
```

- **One button, "Peer review"**, out from behind the switch, in the same run of the bar as
  Referee.
- **Three chips: Bibliography (the default), Reception, Claims.** This order follows the brief. Opus
  suggested Bibliography, Claims, Reception (inside to outside), but Greg fixed only the first, and
  changing the order later is one array.
- **The TL;DR is the mode's card**, where the house puts a mode's description (`MODE_CATALOG`'s
  `description`, which is the bar button's card and the command bar's inline line). There is no
  description line inside the band
  ([mode.md § The client](../project/mode.md#the-client), Greg 2026-09-30):
  - mode: *"What this piece cites, and what others say about it"*;
  - Bibliography: *"What this piece cites: the works in its bibliography, each with a link"*;
  - Reception: *"What others say about this piece: replies, reviews, and work that cites it"*;
  - Claims: *"What others say about each claim it makes: the claims it rests on, with the works it
    cites beside each"*.

  Each chip's card leads with the same frame, so the mode reads as two halves: what it cites, and
  what others say.
- **The band's (i)** opens with the mode's card, then adds what the shown sub-mode's panel adds
  today: its counts and who made it.
- **Old links keep working.** `?mode=citations` opens Peer review on Bibliography, carrying
  `?citeby=` and `?citebar=`. `?mode=debate` opens it on Reception, and `?mode=debate&debate=claims`
  (and the older `?debateby=claim`) opens it on Claims. `/help/mode-citations` and
  `/help/mode-debate` land on the new help page.
- **Opening the mode** auto-runs only the sub-mode on screen, as each hook already does. A press on
  the Peer review button arms the target for the sub-mode it lands on: Bibliography's `citations`,
  Reception's paid search, or Claims' list.

### On import

Once a mode is out of the switch it is queued on every import (`AUTO_MODE_STEPS`). The press is
per sub-mode, so the steps are named by hand in `DELEGATED_MODE_STEPS`, as Summary's are:

- **`citations` is queued.** It is the default sub-mode, and C1 needs it. This is one model call
  per import that is not paid today.
- **`debate` (Reception) is not queued.** It is the dearest press in the app (a web search, up to
  about $0.14), and it often finds nothing. It runs on the press of its chip.
- **`debate-claims` is not queued.** It is cheap, but it serves a sub-mode many readers will not
  open. It runs on the press of its chip.

**Reception's spend, now that every reader has it.** A Reception search is stored once per article
revision. It is made again only from the stale banner's *Search again*, which `useRewriteHold`
holds. The claim checks have their own allowance (10 an hour, 30 a day). Sol is asked to confirm
nothing lets one reader buy Reception searches in a loop.

### C1: the works cited in each claim's paragraph

Under each listed claim (`ListedClaim`, in the `debate-claims` artefact), a line headed **Cited in
this paragraph**. It lists the works whose `citedAt` includes the claim's `blockId`, in the order
they are first cited in that paragraph, each as its short name ("Smith 2019", or the title when
there is no author and year).

- **Pressing a work opens Bibliography on that work's row.** It reuses the `citeFocus` hand-off
  plan 261004b built for the card's button and 261009k kept for the chat's way back.
- **No line when the paragraph cites nothing.** The heading is never drawn empty.
- **The heading never claims support.** It says the works share a paragraph and nothing more. Two
  claims in one paragraph both get all of its works.
- **No verdicts in the line.** The Bibliography row has the work's reading, one press away.
  Repeating it here would be a second copy of the row.
- **Visitors get it too.** Both lists are already in the public payload (`citations`,
  `debateClaims`), so the same join runs over them.
- **The older searched claim rows** (pre-`debate/7`, *Claims the earlier search chose*) get the
  same line, keyed on their `blockId`. They are rare now; this is one extra call site, and it can be
  dropped if it complicates things.
- **No Bibliography yet** (owner, not generated): no line, and no run started. Opening Claims does
  not buy the citations step. On import it will usually exist already.

`citedAt` lists every body block that cites the work, including footnote expansion (plan 261009e),
so the join is complete for the paragraphs we resolved.

## Stages

### Stage 1: the merged mode (B)

1. **Vocabulary.** `peer-review` joins `MODES`. `citations` and `debate` leave `MODES` for
   `RETIRED_MODES`, both pointing at `peer-review`. A new `PEER_REVIEW_VIEWS = ["bibliography",
   "reception", "claims"]` and `?peer-review=` sub-mode param (default `bibliography`) replace
   `DEBATE_VIEWS` and `?debate=`. The sub-mode param is named after its mode, like `?summary=` and
   `?debate=`.
2. **Lifts in `router.ts`** (`settleAddress`, `liftedLegacyHref`), on the `liftLegacyTweets`
   pattern: `mode=debate` becomes `mode=peer-review&peer-review=reception` (or `claims` when
   `debate=claims`). `mode=citations` becomes `mode=peer-review`. The existing `liftLegacyDebateBy`
   is folded in so the chain still ends right. `?citeby`, `?citebar`, `?debateby`, `?bears` and
   `?debatethread` stay the sub-modes' own params, unchanged until Stage 3.
3. **Catalogue and sub-mode words.** A `peer-review` row in `MODE_CATALOG` (`experimental: false`)
   with the description above, a `how` merged from the two current ones, and the aliases of both
   plus "peer review", "citations" and "debate". `PEER_REVIEW_SUB_MODES` replaces
   `DEBATE_SUB_MODES`, and Bibliography takes the bibliography aliases ("references", "works cited"
   and so on), as Thread took Tweets'.
4. **The band.** A `PeerReviewBand` (`src/web/modes/peer-review/`) reads the view and draws one
   chip row, then either `CitationsPanel` (Bibliography) or `DebatePanel` (Reception or Claims). The
   chip row is today's `DebateViews` widened to three chips, and each panel takes it as a `head`
   node rather than drawing its own. The counts come from the reads the wrapper holds: the owner's
   citations read is already mounted in `ArticlePage`, and the debate hooks mount with their
   auto-run gated on their own view. Each panel's `ModeSurface` takes `mode="peer-review"`, so the
   (i) opens with the merged card. The visitor band is the same, built from the payload.
5. **The total tables** the compiler asks for: `MODE_LABEL` ("Peer review"), `OWNER_MODE_NOTE`,
   `MODES_UI` (one row in the critical run, where Debate was), `MODE_ICON`, `POLICY` (an artefact
   policy that opens for a visitor when `citations`, `debate` or `debateClaims` is present),
   `MODE_TARGET` (delegated by view), `MODE_CONTAINMENT`, `selectPassages`, `subModeViews`,
   `SUB_MODE_PARAMS`, `SUB_MODE_SELECTS_A_BAND_FOR`, plus the tests' `BAND_SAYS`, `SPENDS`, `DRAWS`,
   `GENERATES` and `VOICES_BY_MODE`.
6. **Call sites** that named either mode: Reader's `openOrigin` (the chat's way back to a work, a
   claim or a lens) and `focusModeWas`, `FeaturesPage` tiles, `rerun-commands`, `help-images`, the
   Dock's `debateInSearch` press context, `last-view`'s `REMEMBERED`, and `CHAT_FROM_WORDS`. A
   chat's stored origin keeps `mode: "debate" | "citations"` as data (Stage 3), and the way back
   maps it onto the new mode and view.
7. **Out of the switch**: `BEHIND_THE_SWITCH` loses both, `experimental-features.md` gets the row
   and the reason, and `AUTO_MODE_STEPS` / `DELEGATED_MODE_STEPS` gain `citations`.
8. **Help**: `pages/modes/peer-review.md` (merged from the two pages, with `## In short` built on
   the TL;DR frame), the *Which mode when* row, the retired anchors through `RETIRED_MODES`, and the
   command-pick catalogue regenerated.
9. **Docs**: a new `docs/project/peer-review.md` as the mode's map, owning the merge and pointing
   to `citations.md` (Bibliography) and `debate.md` (Reception and Claims), which keep their depth.
   Plus the reading-view-overview line, `debate.md § Not decided`, which is now decided, and
   `mode.md § Renaming` (this merge as a precedent).

Done when: typecheck, the full suite and doc-links are green, and every old link above lands in the
right place, under a test.

### Stage 2: C1

The join (`worksCitedIn(blockId, works)`, a pure function with its own tests), the line under each
claim in `DebatePanel`'s claims list, owner and visitor, the press opening Bibliography with
`citeFocus`, and the docs. Red first: a claim whose paragraph cites two works shows both, in
paragraph order; one citing none shows no heading; a press focuses the Bibliography row.

### Stage 3 (held for Greg): the stored names

**Not built here.** Held until Greg confirms the name, because this is the part a second name
change would make us pay for twice. If he keeps "Peer review": `citations` becomes `bibliography`,
`debate` becomes `reception`, and `debate-claims` becomes a name prefixed with the mode, not bare
`claims`, which Referee has. That covers steps, columns (with a migration), routes, files,
components, CSS prefixes, chat origins (an `UPDATE` under their CHECK), `RENAMED` in
`cost-categories.ts`, the env var and the eval. It follows the Trajectory→Skim and Remember→Learn
precedents ([mode.md § Renaming a mode](../project/mode.md#renaming-a-mode)). The word "citations"
also names chat's web citations, so the sweep is decided hit by hit. This gets its own queue entry.

### Stage 4: review, browser check, land

GPT Sol code review (write-capable, fixes inside the stage), the gates, a browser pass at desktop,
iPad and phone widths by a Sonnet subagent, then the bookkeeping: the question file, the note,
`feedback-endings.ts`, and a push to `dev`.

## Passed over

- **Keep the two modes and link them (option A).** Greg asked for fewer modes.
- **Leave Bibliography alone with the switch off and keep the rest behind it.** Greg said to bring
  the combined mode out.
- **One rewritten panel holding all three lists.** The two panels are 1,700 and 3,200 lines, each
  with its own tests. A wrapper and a shared chip row get the merge without rewriting either.
- **Queue Reception on import.** That is a paid web search on every import, and it usually finds
  nothing.
- **Do the deep rename now.** Greg's rule says a rename goes all the way down. But the name is
  provisional and has a clash he has not seen. Renaming 4,000 stored names onto a word that may
  change is the expensive way to follow the rule. The rule is followed in Stage 3, on the confirmed
  word.
- **Verdicts in C1's line.** They would be a second copy of the Bibliography row, and a verdict
  beside a claim reads as "supports this claim", which the join cannot say.

## Log

- 2026-10-09: plan written. Opus's product opinion: the merge is good; default to Bibliography;
  queue only Bibliography on import; ask about the name first (overruled above, with the deep rename
  held instead).
