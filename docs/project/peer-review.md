# Peer review — what this piece cites, and what others say about it

Up: [reading-view-overview.md](reading-view-overview.md)

One mode in the band with three sub-modes: **Bibliography**, the works the piece cites (the
Citations mode until 2026-10-09), then **Reception**, what others have written about the piece, and
**Claims**, the claims it rests on for the reader to check against the web (Debate's two). Out of
the experimental switch, in every reader's bar, since the day it was made.

> I'm inclined to go with B and then C1 to begin with. … For question two, I guess let's move this
> out of experimental, this combined mode. I am hesitating what to call it. Debate doesn't feel
> quite right. Maybe peer review, because that, I think, incorporates the idea that it's both
> internal and external to the article, i.e. what they cite and also what other people say about
> them. And indeed that framing, what this article cites and what other people say about it, this
> article might be a good sort of TLDR somehow for the different submodes.
>
> Let's call the sub-mode for citations listed in this article (i.e. the former Citations mode)
> "Bibliography", and this should be the first submode in this new peer review mode.
>
> — Greg, 2026-10-09 (spya-vcvxu5, to q-xf2xvb)

The plan, its review and what is left to build are
[261009l](../plans/261009l-peer-review-mode-merges-citations-and-debate.md). The depth on each list
stays where it was: **[citations.md](citations.md)** for Bibliography, **[debate.md](debate.md)**
for Reception and Claims. This page owns the merge.

## In this doc

- [§ The band](#the-band) — one chip row, two panels, one surface
- [§ The address, and old links](#the-address-and-old-links) — `?peer-review=`, and where `?mode=citations` and `?mode=debate` land
- [§ What a press buys](#what-a-press-buys) — each sub-mode's own work, and what is made on import
- [§ Visitors](#visitors) — open on any one of its three artefacts
- [§ Cited in this paragraph](#cited-in-this-paragraph) — the works a claim's paragraph cites, under the claim
- [§ Chats started from it](#chats-started-from-it) — one filter, three tooltips, three ways back
- [§ The name, and what still says Citations and Debate](#the-name-and-what-still-says-citations-and-debate)
- [§ Where the code is](#where-the-code-is)

## The band

```
 ┌ Bibliography 42 │ Reception 3 │ Claims 8 ┐                      (i)
 │ CitationsPanel, as the Citations mode drew it   ← Bibliography (the default)
 │ DebatePanel, as the Debate mode drew it         ← Reception, Claims
```

**A wrapper, not a rewrite.** `PeerReviewBand` reads the sub-mode and hands one chip row to
whichever panel it names, as that panel's `head`, so there is exactly one `ModeSurface` on screen,
the panel's, with `mode="peer-review"`: the band's (i) opens with this mode's card, then what the
panel adds (its counts and who made it). The chip row is the band's header in every sub-mode, so
switching does not move it; it replaced Debate's globe-and-title head and the Reception | Claims row
under it.

**Each chip's number is its own list's**, worked out by the pure selectors in
[`peer-review-counts.ts`](../../src/web/peer-review-counts.ts) that the panels draw their lists
with, so a number and the list under it cannot disagree (GPT Sol's F4): every work cited for
Bibliography (no number while there is no list), Reception's rows through its thread, Claims' listed
claims or, once checked, the sources the checks found.

**The description is the frame Greg gave**, *"What this piece cites, and what others say about
it"*, and each chip's card leads with one half of it (sub-modes.ts § `PEER_REVIEW_SUB_MODES`).
There is no description line in the band ([mode.md § The client](mode.md#the-client)).

## The address, and old links

`?mode=peer-review`, and `?peer-review=reception` or `claims`; Bibliography is the default and is
left off. Each sub-mode keeps its own parameters, unchanged: `?citeby=` and `?citebar=` for
Bibliography, `?debateby=`, `?bears=` and `?debatethread=` for Reception and Claims.

**Every old address lands on the sub-mode it meant**, through one function,
`liftLegacyPeerReview` in [`router.ts`](../../src/web/router.ts), run on boot (`settleAddress`), on
a client navigation and on Back (`liftedLegacyHref`), and on a remembered last view
(`liftedLegacySearch`, asked by [`last-view.ts`](../../src/web/last-view.ts) § `restoredHref`),
which is put on the address after boot and would otherwise have opened Bibliography (GPT Sol's
F1):

| Old address | Lands on |
|---|---|
| `?mode=citations` | Bibliography |
| `?mode=debate` | Reception |
| `?mode=debate&debate=claims`, or the older `?debateby=claim` | Claims |
| `?chatfrom=citations`, `?chatfrom=debate` | `?chatfrom=peer-review` |

An explicit `?peer-review=` wins over the old words. `RETIRED_MODES` in
[`src/modes.ts`](../../src/modes.ts) maps both old words to `peer-review` for everything that reads
only the mode: the tab title, `/help/mode-citations` and `/help/mode-debate`, a feedback report.
*tests/peer-review-old-addresses.test.ts* and *tests/debate-navigation.test.tsx*.

**In the command bar the old words find the sub-mode they meant**, as Tweets' did Summary's Thread:
*citations* and the bibliography words (*references*, *works cited*) find Bibliography, *debate* and
Debate's words (*critiques*, *reception*) find Reception, and *debate claims* finds Claims. "Peer review" left Referee's aliases, since it is this
mode's name; Referee keeps *peer reviewer* and *referee report*, and ranks after Peer review for
*peer review*.

## What a press buys

**Each sub-mode buys its own work and only on a press of its own**: a press on the Peer review
button, a chip, or a command-bar row arms the work of the sub-mode it lands on (activation.ts §
`activationForPeerReview`): the `citations` list for Bibliography, the `debate` web search for
Reception, the `debate-claims` list for Claims. Every read stays mounted in all three sub-modes, so
the chips can count, and each auto-run is gated on its own sub-mode, so a press armed for one that
lands on another is retired unspent. A link, Back, popstate or a last-view restore never buys
anything.

**On import, only Bibliography is made** (`AUTO_MODE_STEPS`, `DELEGATED_MODE_STEPS`): it is the
default view, and Claims' line of cited works reads it. Reception's search is the dearest press in
the app and often finds nothing, and Claims' list serves a view many readers will not open, so each
waits for its chip.

**An owner can buy Reception's search again and again**, as every completed step can be re-run:
Metadata offers each step, and the command bar's *Run again* rows post a forced run. This is
accepted as it stands (plan 261009l § Reception's spend). Those rows are labelled *Bibliography ›
Run again* and *Reception › Run again*, and a bare *rerun peer review* picks neither (GPT Sol's F8,
[`rerun-commands.ts`](../../src/web/rerun-commands.ts)).

## Visitors

**Any one of the three artefacts opens the mode** for a visitor to a public article
(visitor.ts § `POLICY`, the `any-artefact` policy, GPT Sol's F3). A sub-mode whose own artefact was
not stored says so inside the open band — *Nobody has listed the works this one cites yet*, *Nobody
has asked the web about this one yet* — rather than closing the mode on a visitor who could read the
other two. With none of the three, the band is the usual not-built gap, naming both. The visitor
band, `VisitorPeerReviewBand`, mounts none of the owner's reads, so it can neither read the owner's
lists nor start anything.

## Cited in this paragraph

**The first link between the two halves** (C1 in
[261004b § Part 2](../plans/261004b-citation-hover-card-offers-dig-deeper.md)): under each claim in
Claims, listed or from an older search, a line naming the works the article cites in that claim's
paragraph, each a press away from its row in Bibliography (`openBibliographyWork`, below).

```
 ☐ "a starter needs cool water"   [jump] [chat]
    Cool water suits a young starter. · In the AI's words
    Cited in this paragraph: Smith et al. 2019 · Starter hydration 2021
```

No model call: a claim stores the paragraph its quote was found in (`blockId`), a cited work every
paragraph that cites it (`citedAt`), and the line is the join
([`cited-in-paragraph.ts`](../../src/web/cited-in-paragraph.ts)). **It proves only that they share a
paragraph**, so it is headed *Cited in this paragraph*, never *supports this claim*, carries no
verdict, and gives two claims in one paragraph the same works. It is **best-effort**: direct
mentions are capped, so a much-cited work can be missing from a late paragraph, and the works keep
Bibliography's order rather than the paragraph's (GPT Sol's F6). No line where the paragraph cites
nothing, or where there is no Bibliography; opening Claims never buys one. A visitor gets the same
line, from the same two lists in the public payload.

## Chats started from it

A chat started from a cited work, a claim or an angle keeps its stored origin, `citations` or
`debate`, as data. Chat's list shows all three under Peer review's icon and one `peer-review` filter;
the tooltip names the sub-mode (*Started from a claim in Peer review › Claims*), and the way back
opens that sub-mode: a work on Bibliography with its row in view, an angle on Reception, a claim on
Claims with its row in view ([`thread-source.ts`](../../src/web/thread-source.ts) § `originBack`,
Reader.tsx § `openOrigin`, GPT Sol's F5).

**A focus belongs to one visit to its list**: Bibliography's focused work is forgotten on leaving
Bibliography, and Claims' focused claim on leaving Claims, even when the mode stays Peer review
(item-focus.ts § `focusesLeft`, GPT Sol's F7). One Reader-owned `openBibliographyWork` sets the
focus and moves to Bibliography together.

## The name, and what still says Citations and Debate

"Peer review" is provisional, and **it shares a phrase with [Referee](referee-mode.md)**, the mode
for somebody *doing* a peer review; the question is in
[q-xf2xvb](../user-feedback/questions/q-xf2xvb.md). So the rename stops at what a reader sees and
the mode's own word: the label, the catalogue, `?mode=peer-review`, `?peer-review=`, the help page,
the remembered view, the chat filter. **The stored names keep the old words** until Greg confirms
the name: the `citations`, `debate` and `debate-claims` steps, columns and routes, a chat's stored
origin, `CitationsPanel` and `DebatePanel`, and the `cite-` and `dbt-` CSS. That is plan 261009l §
Stage 3, held, and an exception to
[rename-or-move.md § A rename on screen is a rename all the way down](../reusable/rename-or-move.md#a-rename-on-screen-is-a-rename-all-the-way-down)
taken because the name may change again. New identifiers are Peer-review-named.

## Where the code is

- [`src/web/modes/peer-review/PeerReviewMode.tsx`](../../src/web/modes/peer-review/PeerReviewMode.tsx)
  — the owner's band, the visitor's, and the chip row (`PeerReviewViews`).
- [`src/web/peer-review-counts.ts`](../../src/web/peer-review-counts.ts) — the chips' numbers and the
  lists behind them, shared with the panels.
- [`src/web/CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) and
  [`src/web/DebatePanel.tsx`](../../src/web/DebatePanel.tsx) — the two panels, unchanged but for
  taking the chip row as `head`.
- [`src/web/params.ts`](../../src/web/params.ts) § `peerReviewParam`; [`src/web/router.ts`](../../src/web/router.ts)
  § `liftLegacyPeerReview`; [`src/web/activation.ts`](../../src/web/activation.ts) §
  `activationForPeerReview`.
- The help page, `src/web/help/pages/modes/peer-review.md`, written for a reader.
