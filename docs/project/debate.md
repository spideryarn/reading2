# Debate mode — Sources' Reception and Claims

Up: [reading-view-overview.md](reading-view-overview.md)

**Since 2026-10-09 this is two of [Sources](sources.md)' three sub-modes**, Reception and
Claims, after Bibliography (the Citations mode until then). The mode, its address
(`?mode=sources&sources=reception` or `claims`; an old `?mode=debate` lands there) and its
chip row are [sources.md](sources.md)'s; this page keeps the depth on what the two
sub-modes draw. The stored names — the `debate` and `debate-claims` steps, columns and routes,
`DebatePanel`, the `dbt-` CSS — keep the word until the name is confirmed (plan
[261009l § Stage 3](../plans/261009l-peer-review-mode-merges-citations-and-debate.md#stage-3-held-for-greg-the-stored-names)).

Reception is what the rest of the web says about this piece. Claims starts with claims extracted
from the article, then shows sources from checks the reader asks for and claim sources preserved
from an earlier search. The source rows are outside the article, which is why nearly everything
the panel draws around them is a disclosure.

## What it is for

> Let's add a new mode (perhaps called Critiques or Critical Reception or something along those
> lines) that gathers from the wider web about the article, e.g. reviews, critiques, etc (ideally
> from authoritative sources). Perhaps as a v1 it can reuse the machinery from the Chat (which can
> already spawn multiple search the web tool calls). It should be marked as an Experimental Feature
> for now. … e.g. cluster the points made, and/or enabling ranking by Chronology/Valence/
> Incisiveness, with a Prioritised default sub-mode that combines them with threshold UI, a bit like
> Glossary etc. Provide citation/linking, with rich tooltips (e.g. with excerpts).
>
> — Greg, 2026-09-05, in [260905f](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md)

> If no one (or few people) have written about this piece, let's just say so.
>
> — Greg, 2026-09-05, the same plan

> In Debate mode, I wonder if there's a way to somehow highlight key themes from other people and
> commentary and whatever, and key nodes, i.e. the critical papers that really responded or moved
> things forward or take a different view or whatever.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6M), in [260930j](../plans/260930j-debate-themes-and-key-sources.md)

> So there could be a claims submode. … And then there's a section, a separate submode besides
> claims for reception or critiques or responses or something. Yeah, reception sounds about right,
> which talks about, you know, other people who have—what have they said about this?
>
> — Greg, 2026-10-03 (report `spya-caue42`), in [261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md)

## What the reader sees

Two of Sources' three sub-modes on its segmented control
(`?sources=reception` or `?sources=claims`; Bibliography is the default):

- **Reception**: what others have written about the piece itself, including work that cites it and
  says something about it. Pages that link or quote the piece come first; pages that only name it
  by title follow under a heading that says so. Nothing is hidden by default, and there is no
  identification slider any more: the old default hid the published replies and citing papers the
  search exists to find
  ([postmortem 261003h](../postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md)).
  For the owner it ends with **Cited by**: the papers that cite the piece, from OpenAlex, most cited
  first, ten and then all (see [§ Cited by](#cited-by-the-papers-that-cite-the-piece) below). A
  visitor gets a Google Scholar search for who cites it instead.
- **Claims**: the list of the claims the article rests on, for the reader to pick from
  ([§ The claims list](#the-claims-list)). The Reception search no longer looks into claims. A
  debate from before `debate/7` still draws its saved claim sources under the list, exactly as
  before, headed *Claims the earlier search chose*: one open disclosure per claim, in article
  order, headed by the article's own words; the relevance bar belongs there.

When the article has changed since the search ran, a banner says so and offers *Search again*,
and its × sends it away for this search ([controls.md § Every "older version" notice has an ×](controls.md#every-older-version-notice-has-an-)).
That button is held from the press until the new search has been read, so one press cannot buy two
searches: [reader-profile.md § Regenerate waits for its own result](reader-profile.md#regenerate-waits-for-its-own-result).
Nor can the server: a search whose processing stopped part-way (a deploy, or the job's own
deadline) is not started again by the job's next window, which fails it with *Press Retry to run
it* instead (`oncePerJob`,
[261009l](../plans/261009l-a-requeued-job-does-not-buy-the-debate-search-again.md)).

Threads and key sources narrow whichever sub-mode is on screen. **The stored search cannot be
steered**: its Reception search chooses its own queries, and what it keeps is one result per article,
the same for the owner and for every visitor. What the owner can do, since 2026-10-05, is start a
chat from it: about any one claim ([§ Check a claim in chat](#check-a-claim-in-chat)), or from an
angle of their own typed into the box at the top
([§ Look at the debate from an angle](#look-at-the-debate-from-an-angle)).

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## The claims list

Since 2026-10-08 Claims opens on a list of up to eight claims the article rests on that someone
outside could argue with, in article order
([261008i § 2](../plans/261008i-debate-claims-picked-by-the-reader.md)). It is its own pipeline
step and artefact, `debate-claims` (the `debate_claims` column), made by **one model call over the
article and no web search**: a few cents, where the Reception search is the dearest press in the
app. Each claim is the article's own words, re-found in the paragraph it names and stored as the
article's characters (the Referee rule, `findQuote` in `"spaced"` mode), with a jump to that
paragraph, and under it one short line in the AI's words, labelled so. A claim whose quote is not
in its paragraph is dropped and counted. Each listed claim keeps *Check this claim in chat*, and on
a current list the owner can tick claims and check them on the web
([§ Checking the claims you pick](#checking-the-claims-you-pick)).

**The press rule.** Pressing the Claims chip, the command bar's *Sources › Claims*, or the
Sources button when it lands on Claims makes the list when there is none. A link, Back, a reload or
a last-view restore that lands on Claims only reads, and shows *List its claims*. Sources'
sub-modes arm different targets (`activationForSources`, `src/web/activation.ts`), and
each hook spends only its own while its own sub-mode is showing, so a Claims press can never buy
the Reception search, nor a Reception press the list.

**Its states**: none (*List its claims* for the owner; a sentence for a visitor), running, an empty
list (a sentence: a real answer), a failed run (its sentence and *Retry*), and **stale** — the
article has changed since — when the list is drawn read-only under a banner with *List again*
and an × ([controls.md](controls.md#every-older-version-notice-has-an-)); the list stays read-only
once the banner is gone.

**Who sees it.** The owner, with the controls. A visitor to a shared article sees the list
read-only — each claim's id, paragraph, quote and statement, through the public projection — and
nothing to press; the list alone, with no search stored, is enough to open Sources to them.

The Claims segment's count is the number of listed claims when there is a list and no check has
found anything yet; once checks have put sources on screen, it is those sources (each claim's,
an address once) plus any older search's; with no list, the older search's claim sources, as
before.

## Checking the claims you pick

Since 2026-10-09, for the owner, on a current list
([261008i § 3](../plans/261008i-debate-claims-picked-by-the-reader.md)). Greg chose this over an
automatic claims search: *"C list the claims first, let them pick … and also B allow them to input
their own"* (2026-10-08, q-sn37bt).

**What a press buys.** Tick claims, type one of your own in the box (at most 600 characters,
refused rather than cut), and press **Check**: **one web search**, about 20 cents and a minute and a
half, over every ticked claim and the typed one together, at most four. It is pass B's call from
the old automatic search (`generateClaimCheck`, `src/debate.ts`), handed the claims instead of
picking them, and every row passes the same checks (a URL the search returned, a quotation found
in that page's extract, never the article itself). A listed claim's rows are anchored to the list's
own quote and paragraph, never to anything the model wrote; a typed claim's rows have no anchor.
**Dig further**, on a claim a finished check has looked at, is one more search for that claim
alone, told the addresses it already has so it looks elsewhere; its rows join the claim's, an
address drawn once. Nothing searches by itself: only these two buttons spend.

**What stops a press spending by accident.** The press is the only trigger; the list must still
match the article (a stale list is read-only, and the server answers 409 before anything else);
**one check per article at a time**, held by Postgres (a partial unique index on
`debate_claim_checks`, so two tabs pressing at once get one search and one 409); and the check's
own **allowance** (`DEBATE_CHECK_RATE_POLICY`, `src/debate.ts`: 10 an hour, 30 a day per reader,
two at once, a global fuse of 100 a day), taken after every free refusal and before the model. At
about 20 cents a check that is about $6 a day for one reader at the very worst and about $20 a day
for everybody; the numbers are Greg's to move. It is its own bucket, not Dig deeper's, because
Dig deeper's lease (170 s) is shorter than a check may run, and a check that outlives its lease
stops holding its concurrency slot; the check's lease is its deadline (360 s) plus a minute. The
button is held from the press until the stored answer has been read, and while another tab's check
is out. A closed tab does not cancel a check: its answer is stored and the next read finds it.

**Its limits, accepted** (GPT Sol's review, three rounds, and Opus's arbitration, in the plan). The
deadline starts at the reservation, so the setup, the call and storing the answer all fit inside
the lease. If storing the answer fails, the write is tried three more times over 14 s and then
given up: the answer (about 20 cents) is lost, the failure goes to the log and Sentry, and the row
stays pending until the sweep ends it, so a press on that article is a 409 for up to about eight
minutes. Nothing bounds a single store write that hangs for over a minute (Postgres has no
statement timeout here); then a third check could start while the hourly, daily and global counts
still hold. The gateway no longer resends a web-search request after a dropped connection unless
nothing can have left
([261009e](../plans/261009e-paid-web-search-not-retried-after-it-was-sent.md)).

**Where a check is drawn comes from what it stored**, not only from the current list's ids, so
nothing paid for is hidden. A list made again mints new ids, so a check's claim is drawn under the
listed claim with the same id, or else the same paragraph and quote; a checked claim the new list
does not name is drawn as a group of its own, headed by the quote and statement the check stored,
and can still be dug into (the server finds its words in the stored check). Checks made against an
earlier version of the article go in one read-only group at the end, *Checked against an earlier
version of this article*, grouped the same way, with no Dig further and no box.

**Found nothing is not the same as not answered.** The model answers one group per claim. An
explicit empty group says *This search found nothing it could quote on this claim.* A claim the
answer left out, or answered twice, is *not answered*, and says so in different words: that search
tells you nothing either way about it.

**Visitors** see the list and nothing of the checks: a check may hold the owner's own words, and
the checks are in a table the public reader does not read. Whether a visitor should see the checks
of the article's own listed claims is a question for Greg in the plan.

The table is `debate_claim_checks` (one row per press; [export.md](export.md) carries it). The
routes are `GET` and `POST /api/debate-claims/:slug/checks`; the panel's half is
[`src/web/useDebateChecks.ts`](../../src/web/useDebateChecks.ts) and
[`src/web/debate-checks.ts`](../../src/web/debate-checks.ts).

## Check a claim in chat

Since 2026-10-05, for the owner. Asked whether Debate should let him choose which claim is checked,
Greg answered that this kind of digging should be a chat:

> I'm wondering whether a lot of this more custom behaviour (check a particular claim, dig deeper
> into glossary or citations entry, etc etc) should just kick off a Chat (perhaps with some metadata
> so that the chat thread & mode know that these are particular/special kinds of chats), with a
> link/tooltip in the relevant mode to pull up the whole Chat thread … Actually, this is definitely
> what we want to do.
>
> — Greg, 2026-10-04, in [261005i](../plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md)

What the reader gets:

- **A button on each claim's heading**, *Check this claim in chat*. It goes to Chat and opens a
  fresh conversation with the claim quoted and sends its first question. The press is the Send
  since 2026-10-06 ([261006j](../plans/261006j-ask-in-chat-sends-the-question.md)), and Back returns
  to Sources' Claims. It is the glossary's *Ask in chat* route
  ([glossary.md](glossary.md)), with one thing added: the conversation records the claim it was
  started from.
- **A mark under the claim once a chat exists**: how many questions were asked, and how the chat's
  latest answer begins. No model writes that line; it is the answer's first readable line, in plain
  words (`answerOpening` in `src/answer-opening.ts` removes markdown formatting and prose citations).
  Pressing the mark opens the conversation beside Sources (`?thread=`, the mode unchanged), in the
  floating chat panel, which docks in the right-hand column only when Marginalia is open and the
  window is wide.
- **In Chat's list** the conversation has Sources' icon, with a card that quotes the claim.
- **A visitor has neither** the button nor the mark. Chat is the owner's.

How it works, and what to know before changing it:

- **The conversation remembers the claim; the claim stores nothing.** A thread has an *origin*:
  five nullable columns on `chat_threads` (`origin_mode`, `origin_item_id`, `origin_block_id`,
  `origin_quote`, and `origin_lens` for an angle, below), set on insert and never again, like the
  anchor. `ThreadOrigin` in
  [`src/types.ts`](../../src/types.ts) is the shape, and
  [`src/thread-origin.ts`](../../src/thread-origin.ts) is the one mapping to and from the columns.
  It is not a new kind of thread (a claim check is an ordinary chat, with chat's prompt and web
  search) and it is not the anchor (the thread is not the claim's paragraph's own chat, and the
  gutter chip must not reopen it).
- **The mark is found by matching**, `threadForOrigin` in
  [`useChatAnchors.ts`](../../src/web/useChatAnchors.ts): same block, same words, newest wins. A
  claim has no id, so its words are its name. **When a new search words the claim differently the
  mark goes and the conversation stays**, in Chat's list.
- **The route treats an origin as it treats an anchor**: only on the turn that creates the thread,
  only for a chat, never on a retry or an edit; a different origin for an existing thread is a 409
  and the same one resent is fine. The quote never reaches an error message, because those are
  logged.
- **The reading view's thread summaries are asked for again** when the reader leaves Chat, when a
  mark is pressed, and when a typed answer settles in either chat surface, including after its
  composer has unmounted. See the completion callback in
  [`chat/controller.ts`](../../src/web/chat/controller.ts): a departure refresh alone can run
  before the thread exists. **An answer without a conversation is not a deletion** unless an
  earlier answer had it: a row the reader's own Send put there stays until the server lists it
  or the reader drops it, because the floating dialog is drawn from that row
  ([261005q](../postmortems/261005q-a-refetch-cannot-tell-never-had-from-no-longer-has.md)).
- **Until the first send is confirmed, the origin stays in the tab's draft bookkeeping**
  ([`chat-draft.ts`](../../src/web/chat-draft.ts)), so it survives a mode change and a failed first
  POST. **Live is not offered on that conversation until then**: a spoken first
  turn creates the thread by another route, which would leave it with no origin for good.

**A glossary entry and a cited work are callers too, since 2026-10-06**
([glossary.md § Asking about an entry in chat](glossary.md#asking-about-an-entry-in-chat),
[bibliography.md § Ask in chat](bibliography.md#ask-in-chat-a-conversation-about-one-work)). What they
changed here:

- **`ThreadOrigin` has two more shapes**, `{ mode: "glossary" | "bibliography", itemId, quote }`.
  A row stored with the former `citations` word is read as `bibliography` during the rename window.
  Those have a durable id, so they are matched by the mode and the id alone and the name is only a
  snapshot. A claim is still matched by its block and its exact words.
- **The database says what each is made of**: `chat_threads_origin_item` requires the id and the
  name and forbids a block and a lens on those two modes (`citations` is also admitted during the
  rename window), as `chat_threads_origin_debate` does for
  a claim and an angle. `summary` is still reserved, with no shape.
- **Only a claim's block is checked against the article.** The route never looks an item's id up.
- **The mark is one component**, `OriginChatMark` in
  [`OriginChat.tsx`](../../src/web/OriginChat.tsx), with its own stylesheet
  ([`origin-chat.css`](../../src/web/styles/origin-chat.css)). Debate's sheet sets only where the
  mark sits on a claim's heading.

Not built yet, and in the plan: the same from a Summary paragraph. A claim typed in your own words
is the angle box, in the next section. Chat's list now shows Learn's
conversations, with a filter
([chat-tools.md](chat-tools.md#chats-list-shows-every-conversation-about-the-article)).

Tests: [`chat-origin-route.test.ts`](../../tests/chat-origin-route.test.ts) (the route, the
columns, the export), [`debate-claim-chat.test.tsx`](../../tests/debate-claim-chat.test.tsx) (the
button and the mark, and a visitor's lack of both),
[`conversation-band-origin.test.tsx`](../../tests/conversation-band-origin.test.tsx) (the origin's
lifetime, and Live), [`chat-anchors-refresh.test.tsx`](../../tests/chat-anchors-refresh.test.tsx)
(asking for the summaries again), and
[`debate-check-claim-in-chat.test.tsx`](../../tests/debate-check-claim-in-chat.test.tsx) (the whole
journey, through the app).

## Look at the debate from an angle

Since 2026-10-05, for the owner. Plan
[261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md),
part A. Greg had wondered whether Debate could be steered:

> … and so maybe debate then has a search box. An input text box. I know that might be overcomplicating
> it, but it would be cool if the debate could be steered, maybe in multiple directions, a bit like
> the way we can steer the search.
>
> — Greg, 2026-10-03

What the reader gets:

- **A box at the top of the panel**, *Look at the debate from an angle*, with an **Ask in chat**
  button. Enter or the button goes to Chat, opens a fresh conversation, and **sends** its first
  question: the angle, quoted, and a fixed question after it: *What do others say about the
  article from this angle? Search the web, and say so plainly if you find little.* The press is
  the Send since 2026-10-06 ([261006j](../plans/261006j-ask-in-chat-sends-the-question.md)); until
  then the question waited in the box. Back returns to Sources' Reception.
- **Your angles**, under the box: one line per chat started this way, newest first, three and then
  all. A chat appears once its first question is sent.
  A line opens its conversation beside Sources, as a claim's mark does.
- **Both are there before any search has run**, while one is loading and on a stale one. An angle
  needs no stored debate.
- **In Chat's list** the conversation has Sources' icon, with a card that quotes the angle.
- **A visitor has neither.** Sources is outside the
  [Experimental switch](experimental-features.md), but *Your angles* remains owner-only; the
  conversations are still in Chat's list.

**Why the angle is a chat and not a steered search.** Telling the stored search to check one named
claim was tried and worked, at about 20 cents and a minute and a half a run
([261003o § Q-claims-picker](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md)).
But the stored debate is one result per article, shown to visitors when the article is shared and
replaced by each run. An angled run would either overwrite the plain one, and show a visitor the owner's
angle, or need storage per angle, a merge, a spending rule and the angle in the freshness stamp. A
chat is one answer's cost, can be answered back, and can be pointed in several directions by
starting another. It is also where Greg said this kind of digging belongs (the quote under
[§ Check a claim in chat](#check-a-claim-in-chat)). **What it gives up:** the answer is prose in a
conversation, not rows in Reception or Claims with checked quotations, and a visitor never sees it.

What to know before changing it:

- **An angle is the origin's second shape.** `ThreadOrigin` is a claim
  (`{ mode: "debate", blockId, quote }`) or a lens (`{ mode: "debate", lens }`). Both say
  `mode: "debate"`, so the mode does not tell them apart: ask `isLensOrigin` in
  [`src/types.ts`](../../src/types.ts). A claim never equals a lens, whatever their words
  (`sameOrigin`). In the database a debate origin is one shape or the other, never a mix
  (`chat_threads_origin_debate`).
- **The lens is the reader's own words**: trimmed, not empty, at most 600 characters
  (`MAX_LENS_CHARS`, the cap on *why you're reading this*). The route refuses a longer one and does
  not cut it, and refuses a body that carries a lens and any part of a claim. It never reaches an
  error message or a log.
- **The list is found in the thread summaries**, `lensThreads` in
  [`useChatAnchors.ts`](../../src/web/useChatAnchors.ts), so Debate stores nothing. Two chats from
  the same words are two lines.
- **The question is built by `askDebateThroughLens`** in
  [`chat-handoff.ts`](../../src/web/chat-handoff.ts), with the angle between the same fences as a
  claim. Chat's own prompt is unchanged: it already searches by default for *"what do others
  say?"* ([chat-tools.md](chat-tools.md#asking-whether-a-claim-holds-up-is-a-question-about-the-world)),
  and the question asks for a search in so many words. **Not yet checked with a paid call** that it
  does search.
- **One limit, shared with every handoff to Chat**: the handoff starts a fresh conversation, and if
  the conversation it displaced held words that were never sent, those can become unreachable
  after a later change of mode (the plan's review, answer 2). Not fixed here; the limit is pinned in
  [`conversation-band-origin.test.tsx`](../../tests/conversation-band-origin.test.tsx).

Tests: [`debate-lens.test.tsx`](../../tests/debate-lens.test.tsx) (the box, the list, no stored
debate, a visitor), [`debate-lens-in-chat.test.tsx`](../../tests/debate-lens-in-chat.test.tsx) (the
whole journey, through the app), [`chat-origin-route.test.ts`](../../tests/chat-origin-route.test.ts)
(the route and the columns), [`thread-origin-way-back.test.ts`](../../tests/thread-origin-way-back.test.ts)
(the two shapes, the mapping, the list) and [`chat-handoff.test.ts`](../../tests/chat-handoff.test.ts)
(the question and its fence).

## Cited by: the papers that cite the piece

Since 2026-10-04, in
[261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md). It
answers "has anyone cited this?" for a paper the open web has not written about, where Reception
honestly finds nothing.

- **A list and a count, and no reading of either.** OpenAlex says which papers cite a DOI; it has no
  citing sentence, and no model is asked. The panel says so under the count. What each citer says,
  for or against, is not built.
- **Not part of the stored debate.** It is free, has its own route (`GET /api/citers/<slug>`) and
  its own cache, so it is on screen whenever the owner has Reception open: before the paid search
  has run, and on a debate stored before it existed. Nothing in it can start the search, and it
  does not change Reception's count, which stays the web search's rows.
- **The DOI is checked before it is trusted.** OpenAlex's record for the DOI must carry the
  article's whole title and one of its authors, as imported (never a reader's rename). The check
  runs on a fresh answer, on a cache hit and on a stale fallback alike, so a second article carrying
  the same DOI by mistake gets nothing.
- **Every outcome has its own sentence** (`CitersResult` in `src/types.ts`, the words in
  `src/messages.ts`): no DOI on record, not in OpenAlex, could not be confirmed, could not be
  reached (with Try again), too large to read, no citers yet, and the list. A short list says why
  it is short: the page limit (100, most cited first) and records that could not be shown are two
  different sentences.
- **Cached per DOI for 7 days**, shared by every reader of that paper: public bibliographic facts,
  with no owner and no article on the row (`src/db/schema.ts` § citation index). If OpenAlex cannot be
  reached and an older list exists, that list is shown with its own date.
- **OpenAlex's strings are text.** Titles and names are stripped of markup and bounded; a link is
  built by us from the citing paper's DOI or OpenAlex id, never taken from the answer
  ([security-map.md](security-map.md)). A citer's title is drawn in the app's face, like a source's
  title in the rows above: [fonts.md](fonts.md) leaves third-party text there.
- **What is sent**: the article's DOI and our contact address, from the server. No key.
  [privacy.md](privacy.md) has the page's sentence.

Not built, each named in the plan: a visitor's view of the list; a title search when there is no
DOI (an arXiv preprint has none on record today, so it shows the no-DOI sentence, as does an article
imported before 2026-10-04 until its owner uses Read it again); more than one page; hiding
self-citations; an API key.

## What has changed, and where each change is written up

The plan is the reference:
[260905f](../plans/260905f-debate-mode-what-the-web-says-about-this-piece.md), and for how a row
is laid out, the four orders and the relevance bar,
[260929h](../plans/260929h-debate-mode-clearer-sources-and-orders.md). Behind the switch until 2026-10-09, when it came out as Sources; since 2026-09-29 a visitor to a public article sees a stored one, every row's address
re-judged at the boundary and a refused row withheld and counted — only running a search is the
owner's ([260929c](../plans/260929c-a-visitor-sees-every-stored-mode-on-a-public-article.md)).
Since 2026-09-30 a search also finds the themes its sources share and picks out the key ones,
as filters above the list ([260930j](../plans/260930j-debate-themes-and-key-sources.md)); since
2026-10-01 a visitor sees those and each row's relevance too, unless the boundary withheld a row
([261001b](../plans/261001b-public-article-visitors-see-debate-threads-relevance-citation-entry-and-cross-references.md)).
Since 2026-10-01 a source whose address carries a DOI or arXiv id (`doi.org`, `arxiv.org`, or a
publisher's `/doi/10.…` path) gets Crossref's or DataCite's authors and year, kept only when the
record's title agrees with the page's; the by-line and the date order prefer them and say where
they came from, and a visitor sees them too
([261001a](../plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md) stage 6).
Since 2026-10-02 the search for responses also looks for the work that **cites** the piece, and
every extract the search returned for a page is checked, not just the first — which had been
throwing away correctly copied replies
([261002i](../plans/261002i-debate-leads-with-who-has-cited-this-article.md),
[postmortem 261002g](../postmortems/261002g-debate-refused-quotes-from-a-later-extract-of-the-same-page.md)).
Since 2026-10-03 the panel is two sub-modes, Reception and Claims, and the identification slider
is a headed group ([261003o](../plans/261003o-debate-reception-and-claims-sub-modes-and-a-tidier-panel.md);
what the evals behind it measured is
[investigation 261003g](../investigations/261003g-debate-on-a-thinly-received-paper-what-reception-finds-and-how-claims-spread.md)).
Since 2026-10-04 the owner's Reception ends with **Cited by**, the papers that cite the piece, from
OpenAlex: 261002i's stage 2, built as
[261004h](../plans/261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md). It is
not part of the stored debate, so it is there before a search has run.

How the mode was evaluated, and what that found:
[260906b](../plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md), with the stage-0
spike that showed a web search never comes back empty in
[260905f-debate-mode-stage-0-spike-results.md](../plans/260905f-debate-mode-stage-0-spike-results.md).

## Decided: Citations folded into Debate, as Sources (first called Peer review)

Greg suggested it (spya-c2qmbg): the works a paper cites and what others say about it are two halves
of one question, and from one cited work he would like to see where it sits in the wider debate. On
2026-10-04 he deferred it (*"needs more thought. Write up somewhere, and we'll come back to it"*),
with the options in [261004b § Part 2](../plans/261004b-citation-hover-card-offers-dig-deeper.md).
On 2026-10-09 he chose the second of them, one mode with three sub-modes, then the third, each
claim listing the works cited in its paragraph, and took the merged mode out of the experimental
switch:

> I'm inclined to go with B and then C1 to begin with. … For question two, I guess let's move this
> out of experimental, this combined mode. I am hesitating what to call it. Debate doesn't feel
> quite right. Maybe peer review …
>
> — Greg, 2026-10-09 (spya-vcvxu5, to q-xf2xvb)

What was built is [sources.md](sources.md) and plan
[261009l](../plans/261009l-peer-review-mode-merges-citations-and-debate.md). The mode was called
Peer review that day, and became Sources the same evening, for its clash with Referee
([261009w](../plans/261009w-peer-review-becomes-sources-all-the-way-down.md)). It is part of the
wider wish to declutter the bottom bar
([interface-vision.md](interface-vision.md#decluttering-the-bottom-bar)).

## Where the code is

Each module's header comment says what it owns and why; start with `src/debate.ts`'s.

- [`src/debate.ts`](../../src/debate.ts) — the pipeline step: the searches, and what is kept. Its
  header opens with the one thing to understand first.
- [`src/debate-claims.ts`](../../src/debate-claims.ts) — Claims' list: the `debate-claims` step,
  its prompt and the anchoring of each claim. The panel's half is
  [`src/web/useDebateClaims.ts`](../../src/web/useDebateClaims.ts).
- The reader's checks: `generateClaimCheck` and `readCheckedClaimGroup` at the foot of
  `src/debate.ts`; the store
  [`src/store/pg-debate-claim-checks.ts`](../../src/store/pg-debate-claim-checks.ts); the route
  `runDebateClaimCheck` in `src/routes.ts`, whose docblock lists the refusals in order.
- [`src/debate-themes.ts`](../../src/debate-themes.ts) — the optional search-free synthesis call:
  the themes the Reception sources share, and the key sources.
- [`src/debate-synthesis.ts`](../../src/debate-synthesis.ts) — the rules a synthesis must keep, read
  on both sides of the wire.
- [`src/debate-registry.ts`](../../src/debate-registry.ts) — authors and year from Crossref or
  DataCite, for a source that carries an identifier.
- [`src/debate-journal.ts`](../../src/debate-journal.ts) — the capture journal the evaluation
  replays.
- [`src/web/DebatePanel.tsx`](../../src/web/DebatePanel.tsx) — the panel, and
  [`SourcesMode.tsx`](../../src/web/modes/sources/SourcesMode.tsx) the mode controller
  that mounts it (`DebateMode.tsx` until 2026-10-09).
- [`src/web/debate-levels.ts`](../../src/web/debate-levels.ts) — Reception's two groups, and why the
  slider that used to hide the title-only one is gone.
  [`src/web/debate-order.ts`](../../src/web/debate-order.ts) — Reception's orders, Claims' grouping
  and the relevance bar. [`src/web/debate-threads.ts`](../../src/web/debate-threads.ts) — the
  threads, scoped to a sub-mode.
- [`src/scholar-search.ts`](../../src/scholar-search.ts) — the Scholar search Reception ends with;
  browser-safe, shared with Citations.
- [`src/citation-index.ts`](../../src/citation-index.ts) — Cited by: the two requests to OpenAlex,
  the parsers, the identity check and the fallbacks. Its cache is
  [`src/store/pg-citation-index.ts`](../../src/store/pg-citation-index.ts); its politeness is the
  shared limiter in [`src/bibliographic.ts`](../../src/bibliographic.ts) (`inServiceTurn`).
  [`src/citer-link.ts`](../../src/citer-link.ts) builds a citer's link, and
  [`src/web/useCiters.ts`](../../src/web/useCiters.ts) is the panel's read, which has no job.

Tests: `tests/debate*.test.ts(x)` — [`debate.test.ts`](../../tests/debate.test.ts) for the step,
[`debate-panel.test.tsx`](../../tests/debate-panel.test.tsx) for the panel,
[`debate-order.test.ts`](../../tests/debate-order.test.ts) and
[`debate-threads.test.ts`](../../tests/debate-threads.test.ts) for the orders and threads; the
evaluation's scorer is [`debate-eval-score.test.ts`](../../tests/debate-eval-score.test.ts).

Related: [bibliography.md](bibliography.md) shares the bibliographic lookup
([`src/bibliographic.ts`](../../src/bibliographic.ts)) and names Debate's residual risk;
[experimental-features.md](experimental-features.md) is the switch it sat behind until 2026-10-09; and
[security.md § A third untrusted party](security.md#a-third-untrusted-party-what-the-model-returns)
has the web-search evidence collector Debate added.

---

Up: [reading-view-overview.md](reading-view-overview.md)
