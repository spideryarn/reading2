# Sources — what this piece cites, and what others say about it

Up: [reading-view-overview.md](reading-view-overview.md)

One mode in the band, with nine sub-mode addresses: seven established views and two experiments.
Since 2026-10-25 the owner sees three of the established views as chips,
and the other four as tools inside the first
([261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md)):

- **Where it sits**: what came after the piece, what it leans on, and the literature search (the
  owner's default, since 2026-10-25). Its four tools:
  - **Reception**: what others have written about the piece (one of Debate's two).
  - **Claims**: the claims it rests on, for the reader to check against the web (Debate's other).
  - **Not cited**: papers close to it that its bibliography does not list (the owner's, since
    2026-10-11).
  - **Investigate**: questions for Chat about all of that (the owner's, since 2026-10-20).

  And, behind the experimental switch, two experiments after the tools (since 2026-10-26,
  [§ The experiments](#the-experiments)): **Guess first** and **Evidence first**.
- **Bibliography**: the works the piece cites (the Citations mode until 2026-10-09; a visitor's
  default).
- **Links**: every web address its own text links to (since 2026-10-11).

A visitor's chips are unchanged: Bibliography, Links, Reception and Claims ([§ Visitors](#visitors)).

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

- [§ The band](#the-band) — three chips for the owner, four tools inside the first, one surface
- [§ Where it sits](#where-it-sits) — the default: After it (and its *About "keyword"* view), Before it, the literature search, and the tools row
- [§ The experiments](#the-experiments) — Guess first and Evidence first, behind the switch: the dossier met before its verdicts
- [§ Not cited](#not-cited) — OpenAlex's search on the owner's press, less the bibliography, and why every row says "not among the works Spideryarn found"
- [§ Links](#links) — the article's own hyperlinks, read in the browser, and why not a fold into Bibliography
- [§ Investigate](#investigate) — suggested questions and your own, each a chat with a web search; why a launcher and why the name
- [§ Where this piece sits](#where-this-piece-sits) — the literature search's dossier: one press, a planned search, findings anchored to passages
- [§ The address, and old links](#the-address-and-old-links) — `?sources=`, and where `?mode=citations`, `?mode=debate` and `?mode=peer-review` land
- [§ What a press buys](#what-a-press-buys) — the *Where it sits* composite, Bibliography, each tool's own button, and what is made on import
- [§ Visitors](#visitors) — open on any one of its three artefacts (Links is not one), and no Not cited or Investigate
- [§ Cited in this paragraph](#cited-in-this-paragraph) — the works a claim's paragraph cites, under the claim
- [§ Chats started from it](#chats-started-from-it) — one filter, three tooltips, three ways back
- [§ The name, and what still says Citations and Debate](#the-name-and-what-still-says-citations-and-debate) — Peer review, then Sources
- [§ Where the code is](#where-the-code-is)

## The band

```
 ┌ Where it sits │ Bibliography 42 │ Links 61 ┐                                   (i)
 │ WhereItSitsPanel                          ← Where it sits (the owner's default)
 │   the search's summary box, its groups, then Go further:
 │   [Pages about it 3] [Check a claim 8] [Close to it, not cited 18] [Ask your own question]
 │ BibliographyPanel, as the Citations mode drew it   ← Bibliography (a visitor's default)
 │ LinksPanel                                          ← Links
 │
 │ ┌ Where it sits │ Bibliography │ Links ┐  Where it sits › Pages about it        (a tool's head)
 │ ReceptionAndClaimsPanel, as the Debate mode drew it  ← Reception, Claims
 │ NotCitedPanel                                        ← Not cited
 │ InvestigatePanel                                     ← Investigate
```

**Three chips, four tools, seven addresses** (nine with the two experiments, [§ The experiments](#the-experiments)) (since 2026-10-25, [261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md), decision 7).
Greg asked for fewer sub-modes where they could be unified:

> be proactive if you think things can be unified into one submode. Great, let's do that.
>
> — Greg, 2026-10-25 (answer to q-vg2b69)

Reception, Claims, Not cited and Investigate stayed the panels they were, at the addresses they
had, and left the chip row: *Where it sits* ends with a row of plain links to them, and each of
them carries *Where it sits › its own name* after the chip row, the first words the way back (`ToolBack`). Folding them into
one page was passed over for now (the plan's § The simpler option). **`SOURCES_VIEWS` is the list of
addresses and `SOURCES_CHIPS` the owner's chips** ([`params.ts`](../../src/web/params.ts)), and one
exhaustive `chipOf` says which chip each address lights — the four tools light *Where it sits* —
so exactly one radio is checked for every legal `?sources=` (GPT Sol's F2;
`tests/sources-chips.test.tsx`).

**A wrapper, not a rewrite.** `SourcesBand` reads the sub-mode and hands one chip row to
whichever panel it names, as that panel's `head`, so there is exactly one `ModeSurface` on screen,
the panel's, with `mode="sources"`: the band's (i) opens with this mode's card, then what the
panel adds (its counts and who made it). The chip row is the band's header in every sub-mode, so
switching does not move it; it replaced Debate's globe-and-title head and the Reception | Claims row
under it.

**Each chip's and tool's number is its own list's**, worked out by the pure selectors in
[`sources-counts.ts`](../../src/web/sources-counts.ts) that the panels draw their lists
with, so a number and the list under it cannot disagree (GPT Sol's F4): every work cited for
Bibliography (no number while there is no list), Links' distinct addresses, and on *Where it sits*'
tools row Reception's rows through its thread, Claims' listed claims or, once checked, the sources
the checks found, and Not cited's rows (none until a stored search has been read). *Where it sits*
itself has no number: it is several lists.

**The description is the frame Greg gave**, *"What this piece cites, and what others say about
it"*, and each chip's card leads with one half of it (sub-modes.ts § `SOURCES_SUB_MODES`); *Where
it sits*' leads with both. There is no description line in the band
([mode.md § The client](mode.md#the-client)).

## Where it sits

The owner's default since 2026-10-25, acting on Greg's answer about cost:

> if there's something we can do for free, great, let's do that proactively. If there's something
> that's going to cost money, only do that when we open the sources mode. If it's going to cost a
> lot of money, like per citation or something, then maybe we only do that when the user requests
> something for that citation rather than proactively.
>
> — Greg, 2026-10-25 (answer to q-vg2b69)

Top to bottom:

- **A head line** from the piece's year (`meta.publishedAt`, else the dossier's): *A piece from 1998:
  what has been said since*, or for a piece two years old or less *…: where it sits now*; with no
  year, a neutral line. Once the dossier exists its own head line (the planner's kind and year)
  takes this one's place, so there are never two.
- **The literature search** ([§ Where this piece sits](#where-this-piece-sits)): the dossier when one
  is stored, else *Search the literature* with its line on what leaves — and, since 2026-10-26, the
  search itself started by the press that opened *Where it sits* ([§ Opening it is the
  request](#opening-it-is-the-request)).
- **Go further** (since 2026-10-26, [261026g](../plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md)
  § Stage 3; *Tools* at the foot until then): *Pages about it* (Reception), *Check a claim*
  (Claims), *Close to it, not cited* (Not cited), *Ask your own question* (Investigate), each a
  button with its number where it has one and a line under it saying what it opens and where its
  spending is (`SOURCES_TOOL_WHAT`). A press moves `?sources=` and arms nothing ([§ What a press
  buys](#what-a-press-buys)).
- **After it**: OpenAlex's papers that cite the piece, most cited first, five then *Show all* — the
  same read and the same sentence for every outcome as Reception's *Cited by* (`useCiters`,
  `CitersAnswer`), never a copy of them.
- **Before it**: the five works Bibliography rates the piece as leaning on most (`relevance`, the
  ranking Investigate's *About the works it cites* uses), each a press that opens its row in
  Bibliography, then the way to the whole list. A work with no rating is left out; a list with none
  rated, or no list yet, says so.
- **After it and Before it are ordered by the piece's age** when its year is known: older than two
  years, After it first (it has had time to be answered); otherwise Before it first. With no year,
  side by side (`whereOrder`).

### Opening it is the request

> when I open that submode, I want it to automatically start running rather than requiring me to
> open the submode and then click.
>
> — Greg, 2026-10-26 (spya-mfuz6g)

**A press that lands on *Where it sits* starts what it is missing** — the Sources button when it is
the view, its chip, its command-bar row — through one composite activation target,
`sources-where` (src/web/useWhereAutoRun.ts): the search of the literature, with Bibliography
before it in the same job when the works cited are missing too, or Bibliography alone. A stored
dossier, stale or outdated included, is never re-run by it; the step's allowance still applies.
**Arriving starts nothing**: a pasted link, a reload, Back and Forward, a last-view restore, a
margin's *Open in Sources*, a chat's way back and a tool's *Where it sits* crumb are not presses
(activation.ts § Why a mount is not a click). Until 2026-10-26 the press armed Bibliography
alone and the search was its button's.

Greg's cost rule puts the ~$0.30 search *"upon user request"* (q-vg2b69, above). The press that
opens the sub-mode is taken as that request, and only the press; said so in the report's note.
*After it* is a free OpenAlex read, asked whenever Sources opens on it
([privacy.md](privacy.md#crossref-datacite-and-openalex-are-sent-a-doi)). The plan's cost ladder
has the rest. **Owner only**: a visitor reads the bare address as Bibliography,
because the citers have no public projection yet (GPT Sol's F3).

**After it starts unfiltered** (decision 10, GPT Sol's F15): every citer, most cited first. For a
much-cited piece — more than `TOPIC_MIN_CITERS` (1,000) citers, and a top keyword from OpenAlex —
a second view sits beside *Most cited*: ***About "extended mind"***, the citers whose title or
abstract mentions OpenAlex's own keyword for the work (src/citation-index.ts § The topic view). It
is the reader's switch, never an automatic filter:

- **Nothing is fetched for it on open.** The plain answer carries `topic: { keyword }`; the press
  asks `GET /api/citers/:slug?about=topic` (`useCiters` § `askTopic`), once per band, and keeps the
  answer (GPT Sol's S1-F5 on the stage).
- **The label is the keyword, with a count only when OpenAlex's keyword list has been fetched
  before** (`topic.count`, which the server adds once its `#topic` row is cached, or this press's
  own answer).
- **The keyword list says what it is a list of**: its first sentence is *1,234 papers that cite
  this piece mention "extended mind" in their title or abstract* (`citersLines`, given
  `filteredBy`), never the piece's whole count. When the server could not read the keyword list it
  answers the plain one with no `filteredBy`, and the band says so above it.
- **Which view is on is the panel's state, not the address** — a deliberate exception to
  [url-state.md](url-state.md)'s rule that how you look at an article is in the URL. An address
  carrying it would have to either fetch the keyword list on arrival, which the rule above forbids,
  or name a view it is not showing. It is *Show all*'s kind of choice, a fold within one list, and
  that is component state too; leaving *Where it sits* puts the list back to *Most cited*.
- The two buttons are the order chips (`OrderGroup`, `.gloss-sort-btn`;
  [controls.md](controls.md)), because they choose how one list is drawn.

The panel is [`src/web/WhereItSitsPanel.tsx`](../../src/web/WhereItSitsPanel.tsx); its tests are
`tests/where-it-sits.test.tsx`.

## The experiments

Since 2026-10-26, behind the [experimental switch](experimental-features.md): two ways of meeting
the literature search's findings *before* reading the model's verdict on them, so the reader does
the central step and the model is the second opinion
([261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md), Stage 4,
GPT Sol's F12 and F13). They are left-field ideas for Greg to play with, kept small, not finished
features.

- **Guess first** (`?sources=guess-first`): every finding's passage, in the dossier's stored order
  and never grouped (grouping would give the kinds away), with its kind, note and sources left out
  of the page, under *What do you think critics, supporters and later work said about each of
  these passages?* A pause to predict in your head — nothing is typed. One *Reveal what the search
  found* shows them all; *Hide it again* takes them away.
- **Evidence first** (`?sources=evidence-first`): each finding as the article's passage beside the
  checked quote of each source it rests on, the kind and note hidden. The reader may press
  *Supports*, *Challenges* or *Updates*, then that finding's *Reveal the search's reading* shows the
  kind, what it means and the note, and locks the choice. **No answer is marked**: the search has
  six kinds (Challenged, Citation?, Since, Not cited?, Reception, Supported), which do not map onto
  three words, and a tick would claim more than the model knows. *Hostile referee*, which this
  replaced, was dropped as Referee's ground (F13); *Lineage* was dropped as a redraw of the two
  lists that overclaims influence (F18).

**Offered only on *Where it sits*' tools row**, after the tools under *Experiments*, and only with
the switch on: no chip (each lights *Where it sits*, `chipOf`), no command-bar row (`subModesOf`
leaves them out), and each carries the *Where it sits ›* crumb back.

**Free, and they start nothing.** Each reads the stored dossier through `useSituateRead`, the read
half with no press to call; neither arms anything (`activationForSources` returns `null`). With no
dossier stored, each says so and offers *Go to Search the literature*, a plain move to *Where it
sits* that starts nothing either. A dossier that found nothing says that.

**Nothing the reader does leaves the component** (F12): the choice and every *Reveal* are
`useState`, never the address, storage or a request, and are forgotten on leaving. Each band says
so in a line under its head. *tests/sources-experiments.test.tsx* holds the fetch double and the
browser's storage to nothing through a whole session of presses.

**Hidden from the controls, not unreachable**, as the switch's rule says
([experimental-features.md](experimental-features.md#the-four-rules)) and Structure's Hover does:
with the switch off the tools row does not offer them, but a pasted address still draws the
experiment, and its *Where it sits ›* crumb leads back.

**Whose words** ([fonts.md](fonts.md)): the passage is the article's, in the author's face; a
source's quote is a stranger's page's characters, left in the UI face as the dossier draws it; the
note is the model's, in the model's face.

The panel is [`src/web/SourcesExperiments.tsx`](../../src/web/SourcesExperiments.tsx); the band in
the whole app, switch on and off, is *tests/reception-lens-in-chat.test.tsx* § the experiments.

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

**The piece's own editions, and its authors' other work, are two groups under the list, never
hidden** (plan [261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md),
decision 3): four of *The Extended Mind*'s nineteen rows were the piece in another form. A row
carrying the piece's authors (two of them, or a sole author's one, by surname and initial) goes
under *Other editions of this piece* only when its title says so — an explicit marker (*reprint*,
*translation*, *traducción*, *edition*, *version*…) beside the piece's own title — and otherwise
under *By the same authors*, a label that claims nothing more. A subtitle, a bracketed aside or a
DOI that begins with the piece's proves no lineage (GPT Sol's review of the stage, S1-F3), so the
trial's Czech *The extended mind [Rozren mysel]* and Spanish *La mente extendida* are both *By the
same authors*. An anthology that lists no
authors stays an ordinary row. The groups are not in the list's count or on the tool's number,
which count only the ordinary rows. `notInBibliography` in `src/related-work.ts` sorts them.

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

Since 2026-10-20, for the owner, at `?sources=investigate`: a chip until 2026-10-25, and since then
*Ask your own question* on *Where it sits*' tools row. It is **a place to start chats from**, not a
chat drawn in the band. Top to bottom:

- **A question box.** It replaced Reception's *Look at the debate from an angle*.
- **Your questions**: every chat started from the box or a suggested question, newest first, each
  with its gist. This was Reception's *Your angles*. It has been first since 2026-10-21.
- **Suggested for this piece**: the literature search's own questions, once it has run
  ([§ Where this piece sits](#where-this-piece-sits)), which stayed here when its dossier moved.
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
limits. There is no new spend mechanism. Arriving arms nothing (`activationForSources` returns
`null`), and arriving by a link, Back or a restore sends nothing.

**The stored origin word is still `reception`**, which is the angle box's word. Every lens chat,
including those made from the old angle box, opens its way back here. No reader sees the word, and
renaming it is a migration left for later (the plan's § Deferred).

**Not for visitors.** Their chip row has no Investigate, and a shared `?sources=investigate`
draws Bibliography (params.ts § `visitorSourcesView`), as Not cited does.

What the lens is, and what to know before changing it, is still
[reception.md § Look at the debate from an angle](reception.md#look-at-the-debate-from-an-angle).
The panel is [`src/web/InvestigatePanel.tsx`](../../src/web/InvestigatePanel.tsx).
Tests: `tests/reception-lens.test.tsx` covers the panel, and `tests/reception-lens-in-chat.test.tsx`
covers the whole journey with its one POST per press.

## Where this piece sits

**The literature search**, in *Where it sits* for every owner since 2026-10-25; from 2026-10-24
until then a dossier at the top of Investigate, behind the experimental switch. It left the switch
as the heart of the new default, accepting its measured cost before the eval reports
([261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md), decision 5). One press, *Search the literature*, and the rest is automatic: a model plans
a dozen or so web searches from the piece, they run, OpenAlex lists the later papers that cite it,
and one read of all of it beside the whole article writes findings anchored to the passages they
concern, every quote checked in code against the article and against the source it came from. The
intent is Greg's direction for Sources, one place for "where does this piece sit" rather than
another chip, and the deeper dive on any one finding is its *Ask in chat*.

- **Before it has run**: the heading, one sentence of what it does, the button, and a line saying
  what leaves — the piece to the AI through OpenRouter, the searches it writes to Exa through
  OpenRouter, the DOI or title to OpenAlex, and the reader's profile or purpose only to the final AI read
  ([privacy.md § Search the literature](privacy.md#search-the-literature)).
  It is the dearest press in Sources ($0.26–0.48 in the six-article trial, mean $0.33; four an hour
  and twelve a day per reader, and 100 a day across everyone: `SITUATE_RATE_POLICY`), so arriving
  never starts it; a press that opens *Where it sits* does, since 2026-10-26 ([§ Opening it is the
  request](#opening-it-is-the-request)). `useSituate` itself has no automatic run, because
  Investigate mounts it too.
- **Done** (laid out since 2026-10-26 from four persona reviews,
  [261026g](../plans/261026g-where-it-sits-made-clear-runs-itself-and-reaches-the-margin.md) §
  Stage 2): **a summary box** — the head line (*A review from 2023: what has happened since*), the
  model's overview with its own *Ask in chat*, and a **count strip**, one press per kind that opens
  and scrolls to its group. Then **the groups, folded** (Reception's `<details>` sections): each
  heading its name, count and what the kind means; **the first in the reader's order open**, the
  rest shut, which is component state, not the address. The reader's order is what most changes
  how far to trust the piece — Challenged, Since, Citation?, Not cited?, Reception, Supported
  (`SITUATE_DISPLAY_ORDER`; the stored kinds and the margin's order are unchanged). Each passage is
  a card: its quoted words, themselves the jump to the passage, and its id; then each finding about
  it — two findings on the same words share one quote (`passageClusters`) — the model's note, its
  *Ask in chat*, its sources as links with *What it says* one press away. A finding asked for (the
  margin's *Open in Sources*, a chat's way back) opens its group first, and waits through a failed
  read rather than being dropped. The model's five questions are Investigate's *Suggested for this
  piece*.
- **The overview's chat** (spya-mfuz6g): a `situate` origin whose item is the overview,
  `so-` and the digits of the dossier's `generatedAt` (`situateOverviewId`), so each search's
  overview has its own chat, Chat's list says *Started from the overview in Sources › Where it
  sits*, and its way back opens *Where it sits* and lands on the summary box. The question carries
  the overview whole, because no chat tool reads the dossier. Not a `reception` lens, which would have been filed under
  Investigate (GPT Sol's F3 on the plan).
- **A finding's chat has its own origin** since 2026-10-25, `{ mode: "situate", itemId }`, the
  finding's stable id with its passage as a snapshot (decision 9; queue item `qi-mmtsxdhg`). Its
  mark is found by the id, so a *Search again* that rewords the note keeps it; Chat's list says
  *Started from a finding in Sources › Where it sits*; and its way back opens *Where it sits* on the
  finding. Until then it sent a lens question, listed under Investigate's *Your questions* and found
  by its words; such a chat is still found by them (`findingLensOrigin`) and still listed there.
  The question it asks is unchanged ([chat-from-a-mode.md](chat-from-a-mode.md#which-modes-have-it)).
- **Found nothing** says so in those words, never as "all clear"; *What was searched*, folded at the
  foot, lists each query and what came of it, and says that nothing found is not nothing there.
- **Stale** gets the banner with *Search again*; its × lasts the page view only, because
  `situate` is not yet in `STALE_NOTICE_MODES` (whose database check would need widening).
  **Outdated** gets no banner, like every other Sources artefact. **Written for an older
  profile** gets the usual `WrittenForYou` badge.

Owner only, by construction: `WhereBand` and `InvestigateBand` in `SourcesMode.tsx` mount
`useSituate`, for every owner whatever the switch says, and a visitor's band has neither. The
margin's *literature* notes draw the same findings (for every owner since 2026-10-26: [marginalia.md](marginalia.md)), and their *Open in Sources* lands on the finding
in *Where it sits* (`openFindingInSources`). The plan, with its research and review, is
[261024o](../plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md);
the tests are `tests/situate-dossier.test.tsx`, and an owner with the switch off in
`tests/reception-lens-in-chat.test.tsx`.

**Tried on six articles beside Reception, Cited by and Not cited** (2026-10-25):
[261025a](../investigations/261025a-sources-trial-situate-reception-cited-by-on-six-articles.md).
What Sources might become as a result, folded to three chips, was proposed for Greg in
[261025c](../plans/261025c-sources-proposals-what-it-shows-first-and-fewer-sub-modes.md)
(question q-vg2b69), and his answer is being built as [261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md).

## The address, and old links

`?mode=sources`, and `?sources=` names Where it sits, Bibliography, Not cited, Links, Reception,
Claims or Investigate, or one of the two experiments, `guess-first` and `evidence-first`
([§ The experiments](#the-experiments)). **Where it sits is the default since 2026-10-25** and is left off, so a bare
`?mode=sources` opens it for the owner; Bibliography was the default until then, and is still what a
visitor's band draws for a bare address (`visitorSourcesView`). Each sub-mode keeps its own parameters,
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
| `?mode=citations` | Bibliography, written `sources=bibliography` since 2026-10-25, when a bare Sources address stopped meaning it |
| `?mode=debate` | Reception |
| `?mode=debate&debate=claims`, or the older `?debateby=claim` | Claims |
| `?mode=peer-review`, with `?peer-review=X` if any | the same, as `?mode=sources&sources=X`; a bare one gets today's default, Where it sits, as a bare `?mode=sources` does (on purpose: it meant "the mode's default") |
| `?mode=sources` with no `sources=`, a bookmark from before 2026-10-25 | Where it sits for the owner (it was Bibliography); Bibliography for a visitor |
| `?peer-review=X` on any address | `?sources=X` |
| `?chatfrom=citations`, `?chatfrom=debate`, `?chatfrom=peer-review` | `?chatfrom=sources` |

The newest explicit word wins: `?sources=` over `?peer-review=` over Debate's `?debate=`. A
remembered last view stores `sources` verbatim, so one saved on Bibliography before 2026-10-25,
which stored nothing, restores to Where it sits; one saved on any other sub-mode restores to it.
`RETIRED_MODES` in [`src/modes.ts`](../../src/modes.ts) maps all three old words to `sources` for
everything that reads only the mode: the tab title, `/help/mode-citations`, `/help/mode-debate` and
`/help/mode-peer-review`, a feedback report. `peer-review` is in last-view's `NEVER_REMEMBERED`
beside `debate`, so a lone old `?peer-review=claims` link wins over a remembered view.
*tests/sources-old-addresses.test.ts*, *tests/last-view.test.ts* and
*tests/reception-navigation.test.tsx*.

**In the command bar** all seven are rows (the two experiments are not), *Where it sits* first: the four tools keep their own
rows and aliases, and *Where it sits* is also *situate*, *the literature*, *where this piece
sits*, *literature search*, *what came after* and *papers citing it*
(`SOURCES_SUB_MODES`); not *search the literature*, which as a phrase starting *search* is the bar's find-in-article command. **The old words find the sub-mode they meant**, as Tweets' did Summary's Thread:
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

**Only Bibliography is ever armed by a press that moves you**: a press on the Sources button, a
chip, or a command-bar row arms the work of the sub-mode it lands on (activation.ts §
`activationForSources`), and since 2026-10-25 that is the `bibliography` list for *Where it sits*
and for Bibliography, and nothing for any other. *Where it sits* arms it because *Before it* is
drawn from it and an article can arrive without one (Rebuild, Start again, a re-add): the mode
contract's "opening an unmade sub-mode starts it" ([261025h](../plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md), decision 8, GPT Sol's F4).

**Each tool's work is its own panel's button.** Until 2026-10-25 a press on Reception's chip armed
its web search and a press on Claims' armed their list. The chips went, and the tools row's links
arm nothing, because a link that spends is the bug this file keeps guarding against. So each
starts from inside: Reception's *Search the web*, under *Nobody has asked the web about this one
yet*, and Claims' *List its claims* (both checked in `ReceptionAndClaimsPanel.tsx` before the arm
went); Not cited's *Search OpenAlex for related work* ([§ Not cited](#not-cited)); Investigate's
every press is a chat ([§ Investigate](#investigate)); and the literature search is *Search the
literature* ([§ Where this piece sits](#where-this-piece-sits)). The two experiments arm nothing
and have no button that spends ([§ The experiments](#the-experiments)). Their command-bar rows open the
tool, as the links do. Reception's search is retired as a chip, not as a search (decision 6, GPT
Sol's F5): its stored rows, its stale banner's *Search again*, and Metadata's and the command bar's
*Run again* all stay.

Every read stays mounted in every sub-mode, so the chips and tools can count, and each auto-run is
gated on its own sub-mode, so a press armed for one that lands on another is retired unspent. A
link, Back, popstate or a last-view restore never buys anything.

**On import, only Bibliography is made** (`AUTO_MODE_STEPS`, `DELEGATED_MODE_STEPS`): *Where it
sits* and Claims' line of cited works read it. Reception's search often finds nothing, and Claims'
list serves a view many readers will not open, so each waits for its button.

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

**Where it sits, Not cited, Investigate and the two experiments are not there at all**, and plan 261025h left a
visitor's band as it was (GPT Sol's F3): their chips are Bibliography, Links, Reception and Claims.
A bare Sources address (the owner's *Where it sits*), a shared `?sources=where`,
`?sources=not-cited`, `?sources=investigate`, `?sources=guess-first` or `?sources=evidence-first`
draws Bibliography (params.ts §
`visitorSourcesView`), so a visitor never asks `/api/citers`, `/api/situate` or `/api/related-work`
and never mounts an Investigate sender (*tests/public-network-trace.test.tsx*). A visitor's *Where
it sits* would need a public projection of the citers; it is left for later.

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

A chat started from a cited work, a claim, an angle or a literature-search finding keeps its stored
origin as data: `bibliography` for a cited work, `sources-claims` for a claim, `reception` for an
angle, and `situate` for a finding (since 2026-10-25). The old spellings were `citations` for a work
and `debate` for a claim or an angle; old rows are read under the current names.
Chat's list shows all four under Sources' icon and one `sources` filter; the row names the
sub-mode in words (*Bibliography*, *Investigate*, *Claims* or *Where it sits*), the tooltip gives
the fuller origin, and the way back
opens that sub-mode: a work on Bibliography with its row in view, a question (an angle, before 2026-10-20) on Investigate, a claim on
Claims with its row in view, a finding on *Where it sits* with its row in view
([`thread-source.ts`](../../src/web/thread-source.ts) § `originBack`,
Reader.tsx § `openOrigin`, GPT Sol's F5 on 261009l and F6 on 261025h).

**A focus belongs to one visit to its list**: Bibliography's focused work is forgotten on leaving
Bibliography, Claims' focused claim on leaving Claims, and a finding on leaving *Where it sits*,
even when the mode stays Sources (item-focus.ts § `focusesLeft`, GPT Sol's F7). One Reader-owned `openBibliographyWork` sets the
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
- [`src/web/WhereItSitsPanel.tsx`](../../src/web/WhereItSitsPanel.tsx) — *Where it sits*, its
  tools row, and a tool's *Where it sits ›* crumb (`ToolBack`).
- [`src/web/SourcesExperiments.tsx`](../../src/web/SourcesExperiments.tsx) — Guess first and
  Evidence first.
- [`src/web/sources-counts.ts`](../../src/web/sources-counts.ts) — the chips' numbers and the
  lists behind them, shared with the panels.
- [`src/web/BibliographyPanel.tsx`](../../src/web/BibliographyPanel.tsx),
  [`src/web/NotCitedPanel.tsx`](../../src/web/NotCitedPanel.tsx),
  [`src/web/LinksPanel.tsx`](../../src/web/LinksPanel.tsx),
  [`src/web/ReceptionAndClaimsPanel.tsx`](../../src/web/ReceptionAndClaimsPanel.tsx) and
  [`src/web/InvestigatePanel.tsx`](../../src/web/InvestigatePanel.tsx) — the other five panels; each takes the chip row
  as `head`, ReceptionAndClaimsPanel draws C1's cited works under claims, and its `CitersAnswer`
  is *Cited by*'s and *After it*'s.
- [`src/web/useRelatedWork.ts`](../../src/web/useRelatedWork.ts) — Not cited's read and press;
  [`src/related-work.ts`](../../src/related-work.ts) — the query, the search and the exclusion,
  behind `GET` and `POST /api/related-work/:slug`.
- [`src/web/outbound-links.ts`](../../src/web/outbound-links.ts) — Links' rows and the
  *In Bibliography* join.
- [`src/web/SituateDossier.tsx`](../../src/web/SituateDossier.tsx),
  [`src/web/situate-dossier.ts`](../../src/web/situate-dossier.ts) and
  [`src/web/useSituate.ts`](../../src/web/useSituate.ts) — *Where this piece sits*, its words and
  order, and its read and press; [`src/situate.ts`](../../src/situate.ts) — the step behind
  `GET /api/situate/:slug` and the `situate` job.
- [`src/web/params.ts`](../../src/web/params.ts) § `sourcesParam`, `SOURCES_CHIPS`, `chipOf`,
  `SOURCES_EXPERIMENTS`; [`src/web/router.ts`](../../src/web/router.ts)
  § `liftLegacySources`; [`src/web/activation.ts`](../../src/web/activation.ts) §
  `activationForSources`.
- The help page, `src/web/help/pages/modes/sources.md`, written for a reader.
