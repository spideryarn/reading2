# Sources — what this piece cites, and what others say about it

Up: [reading-view-overview.md](reading-view-overview.md)

One mode in the band, with six sub-modes:

- **Bibliography**: the works the piece cites (the Citations mode until 2026-10-09).
- **Not cited**: papers close to it that its bibliography does not list (the owner's, since
  2026-10-11).
- **Links**: every web address its own text links to (since 2026-10-11).
- **Reception**: what others have written about the piece (one of Debate's two).
- **Claims**: the claims it rests on, for the reader to check against the web (Debate's other).
- **Investigate**: questions for Chat about all of that (the owner's, since 2026-10-20).

It has been out of the experimental
switch, in every reader's bar, since the day it was made.

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

It was called **Peer review** for its first day; § The name says why it is Sources now. The plan,
its review and what is left to build are
[261009l](../plans/261009l-peer-review-mode-merges-citations-and-debate.md), and the rename is
[261009w](../plans/261009w-peer-review-becomes-sources-all-the-way-down.md). The depth on each list
stays where it was: **[bibliography.md](bibliography.md)** for Bibliography, **[reception.md](reception.md)**
for Reception and Claims. This page owns the merge.

## In this doc

- [§ The band](#the-band) — one chip row, five panels, one surface
- [§ Not cited](#not-cited) — OpenAlex's search on the owner's press, less the bibliography, and why every row says "not among the works Spideryarn found"
- [§ Links](#links) — the article's own hyperlinks, read in the browser, and why not a fold into Bibliography
- [§ Investigate](#investigate) — suggested questions and your own, each a chat with a web search; why a launcher and why the name
- [§ The address, and old links](#the-address-and-old-links) — `?sources=`, and where `?mode=citations`, `?mode=debate` and `?mode=peer-review` land
- [§ What a press buys](#what-a-press-buys) — each sub-mode's own work, and what is made on import
- [§ Visitors](#visitors) — open on any one of its three artefacts (Links is not one), and no Not cited or Investigate
- [§ Cited in this paragraph](#cited-in-this-paragraph) — the works a claim's paragraph cites, under the claim
- [§ Chats started from it](#chats-started-from-it) — one filter, three tooltips, three ways back
- [§ The name, and what still says Citations and Debate](#the-name-and-what-still-says-citations-and-debate) — Peer review, then Sources
- [§ Where the code is](#where-the-code-is)

## The band

```
 ┌ Bibliography 42 │ Not cited 18 │ Links 61 │ Reception 3 │ Claims 8 │ Investigate ┐   (i)
 │ BibliographyPanel, as the Citations mode drew it   ← Bibliography (the default)
 │ NotCitedPanel                                       ← Not cited (the owner's only)
 │ LinksPanel                                          ← Links
 │ ReceptionAndClaimsPanel, as the Debate mode drew it         ← Reception, Claims
 │ InvestigatePanel                                    ← Investigate (the owner's only)
```

**A wrapper, not a rewrite.** `SourcesBand` reads the sub-mode and hands one chip row to
whichever panel it names, as that panel's `head`, so there is exactly one `ModeSurface` on screen,
the panel's, with `mode="sources"`: the band's (i) opens with this mode's card, then what the
panel adds (its counts and who made it). The chip row is the band's header in every sub-mode, so
switching does not move it; it replaced Debate's globe-and-title head and the Reception | Claims row
under it.

**Each chip's number is its own list's**, worked out by the pure selectors in
[`sources-counts.ts`](../../src/web/sources-counts.ts) that the panels draw their lists
with, so a number and the list under it cannot disagree (GPT Sol's F4): every work cited for
Bibliography (no number while there is no list), Not cited's rows (none until a stored search
has been read), Links' distinct addresses, Reception's rows through its thread, Claims' listed
claims or, once checked, the sources the checks found.

**The description is the frame Greg gave**, *"What this piece cites, and what others say about
it"*, and each chip's card leads with one half of it (sub-modes.ts § `SOURCES_SUB_MODES`).
There is no description line in the band ([mode.md § The client](mode.md#the-client)).

## Not cited

Idea C of the peer-reviewer research
([261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md)),
work on the same question that the piece does not cite, which Greg left to judgment on ease and value:

> 4 all? Use your judgment based on that combination of ease and value.
>
> — Greg, 2026-10-10 (reply spya-dbfeqh to q-fkq30v)

**Papers close to the piece that are not among the works Spideryarn found in its bibliography**,
closest first: OpenAlex's semantic search on the piece's title and opening, less the works in
Bibliography and the piece itself. Each row is the title (a link built by `citerUrl`), authors,
year, venue, cited-by count and the opening of the abstract, so the reader can see why it came up.
Free, one request, no model. The plan, its review and what was passed over (Reception's paid web
search, OpenAlex's `related_works`, bibliographic coupling, a model-written *why* per row) are
[261011ac](../plans/261011ac-sources-not-cited-related-work-it-leaves-out.md).

**Nothing is sent until the owner presses** *Search OpenAlex for related work*, with a line under
it saying it sends the title and the opening of the text: it is the one request of ours that
carries the article's body, and a referee may have uploaded a confidential manuscript (the review's
F1; [privacy.md](privacy.md#crossref-datacite-and-openalex-are-sent-a-doi)). The answer is kept on
a row of the article's own, so every later open draws it with no press; *Search again* re-sends.
The button is held from the press until the answer is read.

**The exclusion is ours, at read time, against the current Bibliography**, never OpenAlex's
`referenced_works` (which misses Sutskever 2014 and ByteNet for the Transformer paper, both cited):
by identifier, by title, then by the article's own reference text; never by the prose, where a work
merely discussed is not cited. [`src/related-work.ts`](../../src/related-work.ts) holds the tiers.
Telling a reviewer the piece omits work it cites is the worst error this view can make, so **no row
says "not cited"**: the framing says once that none is among the works Spideryarn found in the
bibliography, and that whether any belongs is the reader's call. A stale or capped Bibliography
puts a warning above the list; no Bibliography at all is its own sentence, with no button.

**The owner's only**, as *Cited by* is: the route is owner-only, and a visitor pressing would spend
our OpenAlex allowance. The chip arms nothing (`activationForSources` returns `null`); its read is
asked the first time the chip is shown, asked again when Bibliography changes, and otherwise kept
for the chip's number.

## Links

Asked for through the Feedback button, on this mode:

> Maybe sources should have a submode for external links as well, or perhaps include those in the
> bibliography somehow.
>
> — Greg, 2026-10-10 (spya-s5mzkd)

**One row per web address the article's own prose links to**, in the order a reader first meets
it: the author's words for it (others it is linked under, quietly, after), the host and any DOI,
arXiv id or file kind the href carries (`describeLink`, [links.md](links.md)), and the paragraphs
that link it, each a jump. The title opens a new tab. Left out: a link to another part of the
piece, a footnote marker, a link with no words of its own, the article's own address written the
long way round, anything that is not `http(s)`, and an address with a user name or password in it.

**Nothing makes it.** [`outbound-links.ts`](../../src/web/outbound-links.ts) reads the blocks the
prose already draws, in the browser, into an inert `<template>`: no model, no fetch, nothing
stored, no step, and a press on the chip arms nothing (`activationForSources` returns `null`). No
hover card on a row either, because the prose card's async half asks our server
([links.md § What our own server can reach](links.md#what-our-own-server-can-reach)).

**A second parse of the article's links, on purpose.** Chat's `articleLinks`
([chat-tools.md](chat-tools.md#the-links-the-prompt-does-not-carry)) is the first, and it is the
scope check behind `/api/link-preview`, a defence ([security-map.md](security-map.md)); folding the
two into one module would edit it, so they stay apart and
[`tests/outbound-links.test.ts`](../../tests/outbound-links.test.ts) runs the same fixtures through
both. The two differences are deliberate and in the module's header.

**In Bibliography**, on a row, opens the cited work at that address (`openBibliographyWork`), by
the same address or, for a work Bibliography linked by its DOI or arXiv id, the same paper at
another address: Bibliography rewrites a publisher's DOI page to `doi.org` and an arXiv PDF to
`/abs/`, so a plain address comparison would miss the commonest case (GPT Sol's F2,
`workAt`). That is the "include those in the bibliography somehow" half, done as a join.

**Why a sub-mode and not a fold into Bibliography.** Bibliography is a list of works, made by one
model call and holding [one safety property](bibliography.md#the-one-safety-property); most
hyperlinks are not works (a Wikipedia page, a homepage, a news story), so a fold would either give
them the shape of a citation or make Bibliography two kinds of row. A derived "other links" section
under it would need no model, but would be hidden while no Bibliography exists and empty-looking
when one has no works. The plan, its review and what was passed over are
[261011d](../plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md).

**A PDF has no links** (stage 2 renders prose, not hyperlinks), and the owner's empty list says so
from `meta.source`; a visitor gets the neutral sentence, because their meta does not carry
`source` and a missing `url` there may be a refused address, not an upload.

## Investigate

> let's also add a new Chat sub-mode to the Sources mode (pick a name for it) for basically doing
> lots of searching to try and figure out what people think about the article, about the articles
> it has cited, and whether its claims have been supported, i.e. a general Chat mode for Sources.
>
> So maybe the sub-mode would open up a chat with a whole bunch of suggested questions […] - and as
> always, the user could also choose to ignore the suggested questions, and just type into the
> input box.
>
> — Greg, 2026-10-19 (addendum spya-x4xpw4), in [261020n](../plans/261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md)

Since 2026-10-20, for the owner: the sixth chip, `?sources=investigate`. It is **a place to start
chats from**, not a chat drawn in the band. Top to bottom:

- **A question box.** It replaced Reception's *Look at the debate from an angle*.
- **Your questions**: every chat started from the box or a suggested question, newest first, each
  with its gist. This was Reception's *Your angles*. It has been first since 2026-10-21.
- **Five suggested questions**, the same for every article: how it has been received, whether its
  main claims are borne out, who disagrees most and why, whether the studies it leans on have held
  up, and what has been published since.
- **About its claims**: up to four of Claims' listed claims, in article order. These appear only
  when the owner has already made the list; this chip never buys it.
- **About the works it cites**: the three Bibliography rates the piece as leaning on most
  (`relevance`). A work with no rating is left out.

**Arriving takes you back to your conversation.** Since 2026-10-21, coming to Investigate opens the
newest chat under *Your questions* beside Sources, in the floating chat dialog. It happens once per
visit, after the chat list has loaded, and never over anything already open there: a `?thread=`, an
unsent passage chat, a note, or an annotation in progress. It opens a stored conversation and sends
nothing.

> I started an investigate chat about how the piece had been received, and I can see it listed in
> the chat threads, but when I go to investigate, it just shows me an empty thing.
>
> — Greg, 2026-10-20 (spya-nhwy3d), in [261021b](../plans/261021b-investigate-takes-you-back-to-your-conversation.md)

Of the two models he offered, it is **multiple Investigate threads, a subset of Chat's**: every chat
with a lens origin. The single-thread one would need a new thread kind; the plan says why not.

**Each press sends**, as every *Ask in chat* does. It opens Chat on a fresh conversation, and
Chat's *Back to your question in Investigate* returns here, with that conversation still open
beside it.
- **A claim row or a work row** goes through Claims' or Bibliography's own sender. It therefore
  records the same origin as that list's button does, reopens the item's chat if one exists, and
  shows the same mark in the button's place, in both places.
- **The box and the suggested questions** store a lens origin, `{ mode: "reception", lens }`, with
  the question as the lens. The question is sent fenced, followed by *Search the web widely, and say
  plainly if you find little.* (`askInSources`, `chat-handoff.ts`).

**Why it is a launcher, and not a chat inside the band.** The floating chat beside a mode can only
start a chat anchored on a paragraph, and a second `ConversationBand` inside Sources would be a
second way of doing what Chat already does. Opening the conversation beside Sources, so that the
reader never leaves the mode, is the named next step in the plan.

**Why "Investigate".** It was built as *Ask*. But a chip label beginning with *ask* outranks Chat's
own nickname `ask` in the command bar (`tests/command-match-mode-aliases.test.ts`), and *Questions*
collides with Chat's `question`. *Investigate* says what Greg asked for: lots of searching.

**What each press costs**: one ordinary chat turn with web search, through Chat's route and its
limits. There is no new spend mechanism. The chip arms nothing (`activationForSources` returns
`null`), and arriving by a link, Back or a restore sends nothing.

**The stored origin word is still `reception`**, which is the angle box's word. Every lens chat,
including those made from the old angle box, opens its way back here. No reader sees the word, and
renaming it is a migration left for later (the plan's § Deferred).

**Not for visitors.** Their chip row leaves Investigate out, and a shared `?sources=investigate`
draws Bibliography (params.ts § `visitorSourcesView`), as Not cited does.

What the lens is, and what to know before changing it, is still
[reception.md § Look at the debate from an angle](reception.md#look-at-the-debate-from-an-angle).
The panel is [`src/web/InvestigatePanel.tsx`](../../src/web/InvestigatePanel.tsx).
Tests: `tests/reception-lens.test.tsx` covers the panel, and `tests/reception-lens-in-chat.test.tsx`
covers the whole journey with its one POST per press.

## The address, and old links

`?mode=sources`, and `?sources=` names Bibliography, Not cited, Links, Reception, Claims or
Investigate; Bibliography is the default and is left off. Each sub-mode keeps its own parameters,
unchanged: `?citeby=` and `?citebar=` for
Bibliography, `?receptionby=`, `?bears=` and `?receptionthread=` for Reception and Claims.

**Every old address lands on the sub-mode it meant**, through one function,
`liftLegacySources` in [`router.ts`](../../src/web/router.ts), run on boot (`settleAddress`), on
a client navigation and on Back (`liftedLegacyHref`), and on a remembered last view
(`liftedLegacySearch`, asked by [`last-view.ts`](../../src/web/last-view.ts) § `restoredHref`),
which is put on the address after boot and would otherwise have opened Bibliography (GPT Sol's
F1):

| Old address | Lands on |
|---|---|
| `?mode=citations` | Bibliography |
| `?mode=debate` | Reception |
| `?mode=debate&debate=claims`, or the older `?debateby=claim` | Claims |
| `?mode=peer-review`, with `?peer-review=X` if any | the same, as `?mode=sources&sources=X` |
| `?peer-review=X` on any address | `?sources=X` |
| `?chatfrom=citations`, `?chatfrom=debate`, `?chatfrom=peer-review` | `?chatfrom=sources` |

The newest explicit word wins: `?sources=` over `?peer-review=` over Debate's `?debate=`.
`RETIRED_MODES` in [`src/modes.ts`](../../src/modes.ts) maps all three old words to `sources` for
everything that reads only the mode: the tab title, `/help/mode-citations`, `/help/mode-debate` and
`/help/mode-peer-review`, a feedback report. `peer-review` is in last-view's `NEVER_REMEMBERED`
beside `debate`, so a lone old `?peer-review=claims` link wins over a remembered view.
*tests/sources-old-addresses.test.ts*, *tests/last-view.test.ts* and
*tests/reception-navigation.test.tsx*.

**In the command bar the old words find the sub-mode they meant**, as Tweets' did Summary's Thread:
*citations* and the bibliography words (*references*, *works cited*) find Bibliography; *uncited*,
*related work*, *missing citations* and the like find Not cited; *links*,
*hyperlinks*, *external links*, *outbound links*, *web links* and *urls* find Links; *debate* and
Debate's words (*critiques*, *reception*) find Reception; and *debate claims* finds Claims. *peer
review* left Referee's aliases when this mode took the name, and stays this mode's alias now that
the name has gone. Referee keeps *referee report*, and has the person as *for peer reviewers*
rather than *peer reviewer*, which starts with this mode's nickname. While Referee came first in the
bar, that shorter alias would have taken Sources' *peer review* query (mode-catalog.ts § `aliases`,
rule 5). Sources has come first since 2026-10-10 and ranks before Referee for *peer review*; typed,
*peer reviewer* still finds Referee inside its longer alias.

## What a press buys

**Each sub-mode buys its own work and only on a press of its own**: a press on the Sources
button, a chip, or a command-bar row arms the work of the sub-mode it lands on (activation.ts §
`activationForSources`): the `bibliography` list for Bibliography, nothing for Not cited or Links,
the `reception` web search for Reception, the `sources-claims` list for Claims, and nothing for
Investigate, whose every press is a chat ([§ Investigate](#investigate)). Not cited's
search is its panel's own button and nothing else ([§ Not cited](#not-cited)). Every read stays
mounted in all six sub-modes, so
the chips can count, and each auto-run is gated on its own sub-mode, so a press armed for one that
lands on another is retired unspent. A link, Back, popstate or a last-view restore never buys
anything.

**On import, only Bibliography is made** (`AUTO_MODE_STEPS`, `DELEGATED_MODE_STEPS`): it is the
default view, and Claims' line of cited works reads it. Reception's search is the dearest press in
the app and often finds nothing, and Claims' list serves a view many readers will not open, so each
waits for its chip.

**Notes from abstracts follow the list, not a press** (since 2026-10-18): whenever a Bibliography is
published — on import, a re-make, *Find them again* — a `citation-blurbs` job is queued behind it
and writes a sentence or two per cited work from its abstract, for about a cent an article. Nothing
on the band arms it, and the list never waits for it.
[bibliography.md § A note from the abstract](bibliography.md#a-note-from-the-abstract) has what it
is and when a row shows one.

**An owner can buy Reception's search again and again**, as every completed step can be re-run:
Metadata offers each step, and the command bar's *Run again* rows post a forced run. This is
accepted as it stands (plan 261009l § Reception's spend). Those rows are labelled *Bibliography ›
Run again* and *Reception › Run again*, and a bare *rerun sources* (or *rerun peer review*) picks neither (GPT Sol's F8,
[`rerun-commands.ts`](../../src/web/rerun-commands.ts)).

## Visitors

**Any one of the three artefacts opens the mode** for a visitor to a public article
(visitor.ts § `POLICY`, the `any-artefact` policy, GPT Sol's F3). A sub-mode whose own artefact was
not stored says so inside the open band — *Nobody has listed the works this one cites yet*, *Nobody
has asked the web about this one yet* — rather than closing the mode on a visitor who could read the
other two. With none of the three, the band is the usual not-built gap, naming both. The visitor
band, `VisitorSourcesBand`, mounts none of the owner's reads, so it can neither read the owner's
lists nor start anything.

**Links does not open the mode for a visitor.** It needs no artefact and draws the same list for a
visitor as for the owner once the mode is open, but the policy still asks for one of the three
stored lists, so a public article with links and none of them shows the not-built gap. Teaching
the policy about blocks would change what every public article shows, and was left out of
[261011d](../plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md) as wider than
the report.

**Not cited and Investigate are not there at all.** The visitor's chip row leaves both out. A
shared `?sources=not-cited` or `?sources=investigate` draws Bibliography (params.ts §
`visitorSourcesView`), so a visitor never asks `/api/related-work` and never mounts an Investigate
sender (*tests/public-network-trace.test.tsx*).

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

A chat started from a cited work, a claim or an angle keeps its stored origin as data: `bibliography`
for a cited work, `sources-claims` for a claim, and `reception` for an angle. The old spellings were
`citations` for a work and `debate` for both other shapes; old rows are read under the current names.
Chat's list shows all three under Sources' icon and one `sources` filter; the row names the
sub-mode in words (*Bibliography*, *Investigate* or *Claims*), the tooltip gives the fuller origin,
and the way back
opens that sub-mode: a work on Bibliography with its row in view, a question (an angle, before 2026-10-20) on Investigate, a claim on
Claims with its row in view ([`thread-source.ts`](../../src/web/thread-source.ts) § `originBack`,
Reader.tsx § `openOrigin`, GPT Sol's F5).

**A focus belongs to one visit to its list**: Bibliography's focused work is forgotten on leaving
Bibliography, and Claims' focused claim on leaving Claims, even when the mode stays Sources
(item-focus.ts § `focusesLeft`, GPT Sol's F7). One Reader-owned `openBibliographyWork` sets the
focus and moves to Bibliography together. Its callers: a chat's way back, Claims' *Cited in this
paragraph*, and, since 2026-10-10, *Open in Sources* on a citation's card in the prose
([bibliography.md § Marked in the prose](bibliography.md#marked-in-the-prose-in-every-mode)).

## The name, and what still says Citations and Debate

**It was called Peer review** on the day it was made, and that name **shared a phrase with
[Referee](referee-mode.md)**, the mode for somebody *doing* a peer review. Asked whether to keep
it, rename it to a word with no clash, or rename Referee
([q-xf2xvb](../user-feedback/questions/q-xf2xvb.md)), Greg answered:

> B Sources.
>
> Rename comprehensively, eg including docs, code, database etc
>
> — Greg, 2026-10-09 (reply `spya-egmn6r` to q-xf2xvb)

So the mode is Sources all the way down
([261009w](../plans/261009w-peer-review-becomes-sources-all-the-way-down.md)), in stages. The mode's
own word went first: the label, the catalogue, `?mode=sources`, `?sources=`, the help page, the
remembered view, the chat filter and every `Sources…` identifier. Bibliography's stored names
followed in Stage 2 ([bibliography.md](bibliography.md) lists them), and Reception's and Claims' in
Stage 3 ([reception.md](reception.md) lists them): the `debate` step became `reception`,
`debate-claims` became `sources-claims` and `debate-check` became `sources-claim-check`, after the
sub-modes they now are, and a claim's and an angle's chat origin, both `debate` until then, became
`sources-claims` and `reception`.

"Source" already means several other things here (`sourceHash`, the imported article's raw source,
chat's web sources, Reception's key sources, the Storage bucket), so the mode appears only in the
forms that plan lists, and nobody renames by a blanket replace on the word.

## Where the code is

- [`src/web/modes/sources/SourcesMode.tsx`](../../src/web/modes/sources/SourcesMode.tsx)
  — the owner's band, the visitor's, and the chip row (`SourcesViews`).
- [`src/web/sources-counts.ts`](../../src/web/sources-counts.ts) — the chips' numbers and the
  lists behind them, shared with the panels.
- [`src/web/BibliographyPanel.tsx`](../../src/web/BibliographyPanel.tsx),
  [`src/web/NotCitedPanel.tsx`](../../src/web/NotCitedPanel.tsx),
  [`src/web/LinksPanel.tsx`](../../src/web/LinksPanel.tsx),
  [`src/web/ReceptionAndClaimsPanel.tsx`](../../src/web/ReceptionAndClaimsPanel.tsx) and
  [`src/web/InvestigatePanel.tsx`](../../src/web/InvestigatePanel.tsx) — the five panels; each takes the chip row
  as `head`, and ReceptionAndClaimsPanel draws C1's cited works under claims.
- [`src/web/useRelatedWork.ts`](../../src/web/useRelatedWork.ts) — Not cited's read and press;
  [`src/related-work.ts`](../../src/related-work.ts) — the query, the search and the exclusion,
  behind `GET` and `POST /api/related-work/:slug`.
- [`src/web/outbound-links.ts`](../../src/web/outbound-links.ts) — Links' rows and the
  *In Bibliography* join.
- [`src/web/params.ts`](../../src/web/params.ts) § `sourcesParam`; [`src/web/router.ts`](../../src/web/router.ts)
  § `liftLegacySources`; [`src/web/activation.ts`](../../src/web/activation.ts) §
  `activationForSources`.
- The help page, `src/web/help/pages/modes/sources.md`, written for a reader.
