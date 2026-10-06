# The reading view

Everything the reader sees in the browser. The page has **three regions**: the **spine** (where you
are in the article), the **prose** (what you are reading), and between them a **band** belonging to
whichever mode is on. The first two are permanent; the band is the surface the modes take turns in —
[the list is below](#the-modes-in-the-band), and naming them here as well only means one of the two
goes stale.

**Two modes open no band at all**, and one of them is the default. `plain` is the article by itself, and it is
what a bare `/read/<slug>` shows since 2026-08-31. (Hierarchy — the gist columns beside the prose,
which the default used to be — was removed on 2026-09-29; `?mode=hierarchy` opens Structure,
[260929d](../plans/260929d-remove-hierarchy-mode-and-heading-numbers.md).) The other is
Marginalia, which draws a column of notes to the right of the prose instead (behind the
experimental switch until 2026-10-05) — and since 2026-10-01 it is a switch of its own, `?margin=1`, that can be on
beside any band ([261001i](../plans/261001i-annotations-column-beside-a-band-mode.md)). So *a mode
is open* and *a band is open* are separate questions
([plain-mode-and-the-way-out.md](../plans/plain-mode-and-the-way-out.md)).

**Above the prose, a reader with Experimental features on also gets a headings breadcrumb** — part ›
section, following the scroll, in the sticky bar a visitor's read-only chip sits in
([experimental-features.md](experimental-features.md#what-is-behind-it-today)).

One of the features the app is for is the article at several levels of compression — the tree in
**[granularity-zoom.md](granularity-zoom.md)**, which [Structure](structure.md) now draws. It is one
of several, not the reason the app exists; [vision.md](vision.md) has the rest.

## True across the whole view

- **Text is addressed by block id, never by pixel offset or CSS selector** — scroll position, deep
  links, marks, citations, search hits. **[block-ids.md](block-ids.md)** has the format and the one
  way to get range checks silently wrong.
- **View state lives in the URL** — not `useState`, and browser storage only sparingly, for a
  stated reason. See [url-state.md](url-state.md).
- **Stream any model call a person is waiting on**; the plumbing is shared, so a streaming endpoint
  is a generator and a route. [comments.md § streaming](comments.md#streaming) has the two
  invariants a stream needs and a single response does not.
- **Never substitute generated text for the prose,** and render model output as text, not HTML.
- **One payload, no network on zoom** — meta, blocks and tree arrive together.
- **Pressing a mode with nothing in it runs it; arriving at one does not.** The artefact-backed
  surfaces are Glossary, Ideas, Quotes, Timeline, Debate, Citations, FAQ, Skim, and the Sketch
  or Illustrated picture inside Diagram —
  and since 2026-09-02 a press on the bar's button starts the job with no second click. A pasted link, a
  Back step and a link in from the metadata page all show the empty state and its button, and spend
  nothing: the press is recorded as data by the control that saw it
  ([`src/web/activation.ts`](../../src/web/activation.ts)), because a mount is not a click. One
  automatic attempt per `(slug, step)` per tab session is what keeps a failure from looping —
  [glossary.md § That decision was reversed](glossary.md#that-decision-was-reversed-on-2026-09-02-and-the-loop-is-still-closed-structurally),
  which is the decision this reverses and the reason it still holds.
  [`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts) is the whole rule, in one place.

## The docs

### The layout

- **[interface-vision.md](interface-vision.md)** — **not decided**: one direction of travel, three
  columns — the decorated text in the middle, block-anchored marginalia on the right, what is about
  the whole piece on the left, and the single-purpose mode bands receding. Open it before redesigning
  the layout, and for the questions still waiting on Greg.
- **[chat-llm-help-commands-vision.md](chat-llm-help-commands-vision.md)** — **not decided**: typing
  or saying what you want and an *interface model* choosing the command — Jev first, a capable model
  when unsure, the bar's own rows as its tools, the Help as what it knows — and the main Chat doing
  the same. Open it before giving any model a way to act for the reader: it proposes the line.
- **[web-client.md](web-client.md)** — where the client code lives, how the middle became a slot,
  what Tailwind and shadcn may touch, dark mode, and the full list of constraints.
- **[mode.md](mode.md)** — the one checklist for adding a mode: the tables the compiler
  checks, then the residue it does not, for the client and for a generated artefact.
- **A band names its mode for three seconds after a press, and at no other time** — the name and
  the catalog's sentence in a card at the band's bottom-left, standing on its pinned foot, since the
  band's own title went and the Dock's words drop on an iPad. No doc of its own;
  [touch.md § A mode says its name](touch.md#a-mode-says-its-name-when-you-press-it),
  [260915e](../plans/260915e-the-mode-names-itself-briefly-when-a-reader-opens-it.md),
  [260928a](../plans/260928a-the-mode-herald-moves-to-the-foot-of-the-band.md) and
  [`ModeHerald.tsx`](../../src/web/ModeHerald.tsx).

### The article itself

- **[granularity-zoom.md](granularity-zoom.md)** — one of the features this app is for. Open it
  before touching the tree, the node shape, how the tree is generated, the spine or the arc, and for
  what would make the idea fail; much of the rest is the gist columns, which went with Hierarchy
  mode on 2026-09-29.
- **[column-context.md](column-context.md)** — history: the fisheye the gist columns had, gone on
  2026-09-29. Open it only to learn why `useColumnContext` is called that — its focus sampling is
  what Structure still uses.
- **[reading-time.md](reading-time.md)** — an area chart down the spine of where you have spent longer, and a
  hairline beside each passage: how a second is shared out, what counts, and why a batch is never
  sent twice. Owner only; for every owner since 2026-10-05, when it came out from behind the
  experimental switch.
- **[maths.md](maths.md)** — TeX in an article drawn as maths: which delimiters count and why a
  price never does, the limits on one formula, and what it costs a comment in that paragraph.
- **Folding a section** — a chevron on each heading hides the paragraphs under it; ⌥-click, ⌘⌥T or
  the masthead's *Fold all* does every section. Not remembered across a reload. Why the cells are
  hidden rather than the row, and why a jump unfolds:
  [261002e](../plans/261002e-collapsible-headings-and-fold-all.md); the chord is in
  [keyboard.md](keyboard.md).

### The modes in the band

**Some of them are behind the experimental-features switch** and are drawn only for a reader who
asked for them; the rest are what everybody sees, a signed-out visitor included. **Which is which
lives in [experimental-features.md](experimental-features.md)**, with the reason for each — not
here, and not counted anywhere, because the membership moves and a copy of it goes stale. Diagram is
gated twice: the mode itself since 2026-09-29, and four of its five pictures inside it
([diagram.md](diagram.md)).

Hidden means hidden from the bar, not unreachable: `?mode=timeline` still works, and the bar retains
whichever mode the URL names so the reader keeps their way back.
[experimental-features.md](experimental-features.md) is the switch, and it gives a reason per mode —
mostly unfinished work, but **Referee is behind it for its audience rather than its readiness**: all
four of its sub-modes are built, and it is for somebody asked to peer-review the piece, which most
readers never are.

- **[structure.md](structure.md)** — the article's tree with two faces, two linked columns or a
  nested list, chosen by the band's width. Open it for which plan decided what, how Outline and
  Hierarchy folded into it, and where the code is.
- **[glossary.md](glossary.md)** — the terms this piece uses, defined from the piece and underlined
  wherever it uses them. Open it for the two bugs from the previous version it is shaped around.
- **[summaries.md](summaries.md)** — the piece in plain words, at two lengths (Brief, Fuller), each
  paragraph linked to its passages and checked against them, or as a thread: one three-way control.
  Its Parts and Sections outline went on 2026-10-01; Structure draws that tree.
- **[ideas.md](ideas.md)** — the propositions the piece needs you to hold, sibling to the glossary:
  a term is a word you look up, an idea is a claim you hold. The first stage that lets the model
  name block ids.
- **[quotes.md](quotes.md)** — the lines worth keeping: the piece's own sentences, chosen, checked
  against it and marked where they sit. The only mode whose list is the article rather than something
  a model wrote about it — open it for the two things verification cannot prove.
- **[timeline.md](timeline.md)** — when the piece *says* these things happened, in the order it says
  they happened. Open it for the four dating states, which are the whole design: ten of twenty-six
  rows on the test article carry no date, and drawing them alike throws away what the article said.
- **[search.md](search.md)** — one box, two matchers, hits marked in the prose, and the shape of a
  search painted into the spine. Long; open it for the confidence unit or the colours.
- **[referee-mode.md](referee-mode.md)** — helping a peer reviewer scan efficiently without handing
  them a verdict: four sub-modes, an evidence base with two numbers in it, and a confidentiality
  notice written in the past tense on purpose. Open it for how much of it is actually built.
- **[diagram.md](diagram.md)** — the article's shape as a picture: the mode, its chips, the three
  computed pictures, the five that were cut, and what a visitor sees. Open it for any picture but
  the two below, or for why nothing was installed to draw them.
  - **[sketch.md](sketch.md)** — the picture a model draws of the argument, and the default one.
    Open it for the scene format, what it costs, and what each shape claims.
  - **[illustrated.md](illustrated.md)** — the Sketch painted by an image model. Open it for the
    lettering, the paper's own figures, and why it is the one picture that cannot be checked.
- **[debate.md](debate.md)** — what the rest of the web says about this piece. **The only mode
  whose content is not in the article at all.** Open it for Greg's ask, which plan holds which
  change, and the `src/debate*.ts` modules.
- **[citations.md](citations.md)** — every work the piece cites, each with a link out, ordered and
  thresholded the way the glossary is. Open it for the one safety property: every address a row
  shows was in the article, and a search says it is one. Behind the switch; a visitor to a public
  article sees the stored list, while making it and using *Find it* remain the owner's.
- **[faq.md](faq.md)** — the questions a careful reader would ask the piece while reading it, each
  answered by passages of the piece itself and never by a written answer. Open it for where the
  promise stops: the words are checked, which passage answers which question is not. Behind the
  switch; a visitor to a public article sees the stored FAQ, while making it remains the owner's.
- **[skim.md](skim.md)** — skim a paper at increasing depth: one route through its
  passages, not in the paper's order, walked with a handful of stops, then a dozen, then more. Open
  it for Greg's dictated brief, verbatim, and the questions still waiting for him.
- **[tweets.md](tweets.md)** — the article as a numbered thread, in a wide band beside the prose,
  each post linked to the passages it came from. Summary's Thread view since 2026-10-03, a mode of
  its own (Tweets) before; `?mode=tweets` lands there. **The one view that writes on arrival**
  rather than on a press. Open it for why, and for the plans and the code.

- **Marginalia** — called Annotations until 2026-10-01, when it was renamed
  ([261001n](../plans/261001n-rename-annotations-mode-to-marginalia-and-the-three-column-interface-vision.md); old `?mode=annotations` links still work). The one mode drawn to the *right* of the prose rather than in the band: a
  column of notes, each level with the block it is about and scrolling with the text — each
  part's Socratic question, a stamp where an idea first occurs (if the ideas have been made), and
  a head pinned at the top saying which part and section you are in and, from the arc, where the
  argument has got to. It opens no band, generates only its own relation words ([marginalia.md](marginalia.md#relation-words)), and hides its notes on a window too
  narrow for the column. **Not one of the radios since 2026-10-01**: its Dock button is a toggle
  at the right-hand end and its address is `?margin=1`, so the column stays open beside whichever
  band you choose; where there is no room for both (under 900px) but room for the column alone
  (612px with the rail, 600 without), whichever you pressed last wins, and below that the notes
  stay hidden — [261001i](../plans/261001i-annotations-column-beside-a-band-mode.md),
  [261001k](../plans/261001k-annotations-head-path-wraps-and-the-notes-swap-in-on-a-narrow-window.md). Greg's layout from SPIDERYARN-READING2-7K: left for what is not anchored
  to the text, the middle for the text, the right for what is. Since 261002b it also carries, shut,
  the FAQ, Debate, Citations and comments other modes have stored.
  **[marginalia.md](marginalia.md)** is its doc: what it shows, and the rule to keep an eye out for
  new kinds of item that belong there. The plans before it:
  [261001d](../plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md), then 261001i,
  261001k and 261001n above.

The last two band-mode identifiers — `chat` and `learn` (shown as Chat and Learn), with Quiz as
one of Learn's parts — are
under the next heading instead, because what they are about is a passage rather than the whole piece.
That is every band mode; `plain` and Marginalia open none — Marginalia draws its column on the
right instead, beside a band or without one.

### Marking a passage, and asking about one

- **[comments.md](comments.md)** — select a sentence and it is yours: a bookmark, a note on it if
  you want one, and an answer from the model only if you tick the box. **Saving costs nothing.**
  Open it for the anchoring, the four store operations and why there are four, and the streaming.
- **[chat-tools.md](chat-tools.md)** — the six tools chat can reach for and the filter they passed:
  *does it send the reader somewhere they could not otherwise get to?* Chat itself is in the plans:
  [260826a-chat-mode.md](../plans/260826a-chat-mode.md), [260826ab-chat-as-gateway.md](../plans/260826ab-chat-as-gateway.md).
- **[learn-mode.md](learn-mode.md)** — the other direction: the reader says what they took from
  the piece and the model shows them where it comes apart, then nudges them to remember more. One
  adaptive voice (four stances until 2026-10-02), a prompt rewritten after a cross-family review said
  not to ship the first one, and the one mode that cannot be used to avoid reading.
- **[quiz.md](quiz.md)** — the other half of Learn, where the questions come the other way: a
  dozen short-answer questions cached per article, easy ones first and central ones within that, and
  a marker told outright that the article outranks its own reference answer.
- **[learning-vision.md](learning-vision.md)** — where Learn is going: Recall, Tutorial and
  Quiz as three directions of one exchange, Explore as the one about the reader's own thinking, what
  they share (brief, block links, hints that make success likely), and the ideas not built yet. Read
  it before adding a fifth.

### Hovering and moving around

- **[links.md](links.md)** — hover one of the article's own hyperlinks and a card says where it
  goes; also the measurement showing Readability-in-the-browser is a wall, not a decision.
- **[cross-references.md](cross-references.md)** — the article linked to itself: a phrase that
  sums up what another passage shows in detail, underlined, previewed on hover, a jump on click.
  Open it for why a forged mark cannot work, and the two defence edits still waiting on Greg.
- **[tooltips.md](tooltips.md)** — the library choice, and why there are two implementations: the
  glossary card's triggers are injected HTML with no React element to wrap.
- **[keyboard.md](keyboard.md)** — every key the reading view answers to. Open it before binding a
  key or adding a focusable surface: the arrows, ⌘-K and the other chords, Tab, and the rules a
  handler has to keep.
- **[touch.md](touch.md)** — reading on an iPad: the prose keeps momentum scrolling (a swipe over a
  gist column stepped, before the columns were removed). Open it for why not `scroll-snap`.
- **[phone-and-touch.md](phone-and-touch.md)** — the map for a phone, an iPad and a finger: what
  Greg has said he wants on each, every policy in a line with its owner, and where the code
  branches on the device. Open it first when a report says "on my iPhone".
- **[url-state.md](url-state.md)** — every parameter, which push history and which replace, and why
  position is a *section* rather than an offset. Also the home of the **↩ Back to …** chip: every
  jump in every mode — a block link, a glossary term, a citation, a Skim row, opening
  Skim — pushes one entry stamped with where you were, and the chip at the foot of the prose
  takes you back there, even on a home-screen app with no Back button. Read
  [§ The pushed entry says where you came from](url-state.md#the-pushed-entry-says-where-you-came-from)
  and the two sections after it before adding a new way to move the reader.

### The command bar

**⌘/Ctrl-K, or the ⌘ button at the left-hand end of the bottom bar, and you type the name of what you
want.** Most of what it offers is a mode. On the reading view, Enter opens one **exactly as pressing
its Dock button does** — same activation, same generate-on-open, same cost; on Metadata it follows
the mode link drawn there and arms nothing, as that link does. It is an *additional door*, never a
replacement: the Dock keeps every button it has, and the bar's
**mode rows** are exactly what the Dock lists, because the Dock hands it the list it just drew rather
than computing a second one. The button sits **just after the wordmark** since 2026-09-08, on Greg's
ask; the chord is bound to the window rather than to it, so it did not move with it.

It has no doc of its own because there is very little to say that is not the decisions Greg made
before it was written ([260906h](../plans/260906h-mode-catalog-and-a-command-bar.md) § The four
product calls) and the two widenings he has made since. **It was modes only until 2026-09-07**, when
he asked for `/changelog` to be reachable from it as well as from the footer; on 2026-09-08 he named
six more — Library, Feedback, Metadata, Tweets, Homepage, Profile — and left *"a few more
likely/useful"* to us ([260908e](../plans/260908e-more-commands-in-the-command-bar-and-the-button-beside-the-logo.md)).
The rows that are not modes are drawn below all of them, and come in two shapes:
**pages**, where Enter goes there, and **actions**, where Enter does the thing — Feedback, which
opens the dialog, Comments, which opens the drawer, and since 2026-10-02 the *Run again* rows below,
the first that can fail: an action now answers *close* or *stay open, saying why*, and one that is
still out shows `Starting…` and refuses a second press.

**One of the rows is about the article you are standing on** — its Metadata (Tweets was the second
until it became a mode on 2026-09-29, and is the sub-mode row *Summary › Thread* since 2026-10-03) — and it exists only because the bar does: it is mounted on the reading view and, since 2026-09-30,
on the article's Metadata page, for the owner, so there is always an article to name. The day it is
offered anywhere else is the day those rows have to answer for themselves, and the answer written
down for that day is *no row at all* rather than a row with nothing to point at. **On the Metadata
page a mode row is that mode's link**: it goes back to the article in that mode and arms nothing,
as the Dock's link beside it does
([260930a](../plans/260930a-cmd-k-on-metadata-page-and-full-wordmark-animations-on-the-shelf.md)).

**What the original call refused is mostly still refused**, and where it is not, that is Greg's doing
rather than a boundary quietly moving. It said a passage jump, a generation row, a chat and a model
call each need **a verb this bar does not have**. Two of those have since arrived: a *generation row*
is what the thread's row is — a mode row from 2026-09-29 and *Summary › Thread* since 2026-10-03,
whose band writes the thread on arrival when there
is none ([260915e](../plans/260915e-tweets-page-starts-writing-when-opened.md) for the rule,
[260929f](../plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md) and
[261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md) for the moves),
and it wears the `generates` marker for it — and Feedback is a genuinely new verb, admitted because it is
what he asked for. A passage jump and an "ask this article" each needed the bar to grow an
**argument** — *which* passage, *which* question — when it has one text box and that box is the
filter. Arguments have since arrived, each behind a verb the reader types (below), and with them the
passage jump; an "ask this article" is still out. A query that matches
nothing says `No command matches.` and, by itself, guesses nothing: no search fallback, an honest
empty state preferred to a helpful guess.

**Since 2026-10-03 a signed-in reader can ask what a sentence meant**
([261003k](../plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md)).
When nothing matches, the empty line adds an **Ask what you meant** button, and it or Enter sends the
sentence to a fast model that picks among the bar's own rows — *what's changed on this site*, *is
consciousness mentioned anywhere*. Nothing is guessed until that press. It is a button, and *Try
again* after a retryable failure, because the reported phone had no on-screen Enter after dictation
([261005f](../plans/261005f-command-bar-ask-button-a-finger-can-press.md)). A pick the model is sure of,
of a row that only moves the reader, runs at once. Everything else — a less sure pick, anything that
writes, spends or generates, and every command that takes words — is drawn as the bar's ordinary
rows under *Did you mean* and waits for a fresh press. Signed out, the empty line is as before and
nothing is sent. The models, the measurement and what is not built:
[chat-llm-help-commands-vision.md § Where we are](chat-llm-help-commands-vision.md#where-we-are).

**Sub-modes have rows of their own since 2026-10-01** — Greg, SPIDERYARN-READING2-77: *"In the
Command bar, include sub-modes, e.g. Quiz mode, Illustrated diagram, etc."* *Learn › Quiz*,
*Diagram › Illustrated*, *Referee › Claims*, *Summary › Thread* and the rest sit after the mode rows
and before the pages, and Enter opens the mode with that chip already pressed: armed as the chip
arms (Quiz writes questions, Illustrated paints), never as the mode does, and with the same
`generates` marker rule. Only a mode the Dock draws offers its sub-modes, and Diagram offers the
pictures its chip row would. A sub-mode here means a control that **replaces the whole band** —
Learn, Diagram, Referee and Summary's plain-words levels; the names live once, in
[`src/web/sub-modes.ts`](../../src/web/sub-modes.ts), and the chips read them from there. Orderings
and matchers inside a mode (Quotes' rank, Search's Words | Meaning) are not offered, by decision
rather than oversight —
[261001d](../plans/261001d-command-bar-lists-sub-modes.md).

**Every mode Metadata can re-run has a *Run again* row since 2026-10-02** — Greg,
SPIDERYARN-READING2-8D: *"Add a lot more Metadata functionality to Commands, e.g. to reprocess (a
particular mode)"*. *Glossary › Run again*, *Thread › Run again* and twelve more, one per step of
`METADATA_RERUN_STEPS`, whatever the experimental switch says, as on the page. They are **shown only
once something is typed** (`typedOnly`), so the list the bar opens on did not grow, and they answer
to whole phrases — `rerun glossary`, `regenerate terms`, `glossary again` — because the ranking
compares the query with one alias at a time and never combines a verb with a name; plain `glossary`
still puts the mode first. Enter posts the same forced run Metadata's row does and **waits for the
answer**: a refusal keeps the bar open with the server's sentence under the box, and an accepted run
takes the reader to Metadata's *AI processing* section (`?section=ai-processing`, opened and
flashed, [url-state.md](url-state.md)), where that step's row shows it — **never to the mode**,
whose generate-on-open would start a second, unforced paid run beside it. The words and labels live
once, in [`src/web/rerun-commands.ts`](../../src/web/rerun-commands.ts), which Metadata reads too.

**The two bands with a *Find more* button have a row for it since 2026-10-04** — *Glossary › Find
more* and *Quotes › Find more*
([261004k](../plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md)):

> There are lots of cases where we have a sort of find more button, for example in the glossary
> mode. Let's make that be part of the command bar as well.
>
> — Greg, 2026-10-04 (spya-rbxrgc)

Typed-only, marked `generates`, and answering to whole phrases as *Run again* does — `find more
terms`, `more quotes`, `add more jargon`, `excerpts find more`, and a bare `find more` for both.
**A row is drawn only while its list can be added to**, which the reading view reads off the
glossary and quotes reads it already holds: a settled read, a list, and for Glossary the server's
word that the run appends (`panelRun`, an absent verdict counting as no); for Quotes not stale, not
outdated and under the ceiling. So there is no row on an article with no list, on one whose run would
write a new list, for a visitor, or on the Metadata page — no row, never a row that opens a band and
does nothing. **Enter posts nothing**: it leaves a one-shot press in memory
([`find-more-handoff.ts`](../../src/web/find-more-handoff.ts), the glossary ask's guards: slug,
nonce, session, ten seconds) and opens the band with the plain mode setter, and the band presses the
function its own button calls, in the list's own profile setting. That is why it is not a word on
*Run again*, which posts with the reader's current profile and lands on Metadata. The band takes the
press once its read has settled and **makes it only if a fresh Find more is what it is offering at
that moment** — no job, no *Starting…*, no failure with its Retry, no forced run waiting for its
list; otherwise the press is used up and dropped, so it cannot fire when a job finishes seconds
later ([`useFindMoreHandOff.ts`](../../src/web/useFindMoreHandOff.ts)). **"No job" is read off a job
list asked for after the press**, not the one the tab already had: leaving the press asks for the
list at once, and the band does not take it until that list — never one already on the wire — has
been applied (`afterFreshList` in [`jobEngine.ts`](../../src/web/jobEngine.ts)). A run started in
another tab, or by Metadata's *Run again* in a different profile, which the server does not collapse
into the band's, is otherwise in no snapshot yet and the press would be a second paid run beside it.
If no such list arrives inside the ten seconds, nothing is pressed
(`tests/find-more-waits-for-a-fresh-job-list.test.tsx`). The words and the two
predicates are [`find-more.ts`](../../src/web/find-more.ts), which the band's own control reads too.
`find more …` is also what the `find` verb below takes: the row comes first and *Find “more …” in
this article* after it, the one declared exception in the collision matrix
(`tests/command-match-arguments.test.ts`). No other band has a button that adds to a list; the rest
have a rewrite, which is *Run again*.

**Five more of Metadata's controls have rows, typed-only like *Run again*** (the empty list keeps
the Metadata row as their stand-in), and none of them spends. Three go to a section —
*High-powered AI* (`opus`, `stronger model`; to *AI processing*, where its switch is first, never
throwing the switch, whose own copy states its price), *AI processing*, and *Share this article*
(`share`, `publish`, `private`; to the *Access & sharing* card, which asks before anything goes public, and above the shared shelf for `share`) — the way an
accepted run lands there: a step to Metadata from the reading view, the section added in place on
Metadata. Not *Export*, which the action below owns, and not *What it cost*, which is an
administrator's. *Archive this article* — *Put this article back* over an archived one, the label
following the state, and **no row at all while the state is unknown** — presses through the same
controller as the masthead mark and the page's buttons, so the four cannot disagree and a press while
another is out sends nothing. *Export this article* downloads the ZIP through the function the
Export button uses ([`src/web/export-download.ts`](../../src/web/export-download.ts)). Either one
that fails keeps the bar open with the sentence, and both are offered only where there is a shelf
row to act on — not on the fixture. Words in
[`src/web/article-commands.ts`](../../src/web/article-commands.ts).

**`find <words>` searches the article** — also `search`, `search for`, `does it mention` and Greg's
own *"do they talk about X?"*. It offers *Find “X” in this article*, which opens Search in
words mode with the words lit up: free, instant, and only when the query starts with one of those
verbs. So it is not the search fallback Greg refused below — the reader typed the verb — and a query
that names nothing still says `No command matches.`
[261002c](../plans/261002c-commands-do-more-and-an-interface-model-vision.md).
**Since 2026-10-05 the owner's reading view draws *Quick search “X”* in front of it**, marked
`generates`, so Enter runs a quick search and the exact words are one arrow-key down —
[search.md § From the command bar](search.md#from-the-command-bar).

**Four more requests take an argument since 2026-10-03, and a command with its argument is now a
value** — Greg, `spya-wh2xys`: *"in an ideal world, it would sort of take parameters … a tool I would
really like would be jump to the first place where X"*. One verb table
([`command-match.ts`](../../src/web/command-match.ts) § `parseArgumentQuery`; `find` is now one entry
of it) turns the typed phrase into a **`CommandProposal`**
([`command-proposal.ts`](../../src/web/command-proposal.ts)): an id, one argument checked by that
command's own rule, and a risk class (`RISK`: navigates, writes, spends) that the `generates` marker
is read off. `runProposal` presses it through the runners the page supplies
([`command-runners.ts`](../../src/web/command-runners.ts)), and **a proposal with no runner where the
reader is standing is no row** — never a row that fails — so the Metadata page offers find and the
tags and nothing else. The rows are typed-only and follow the ranked ones, as find's does.
[261003f](../plans/261003f-commands-take-arguments-tags-dictation-and-chat-tools.md).

- ***Jump to the first “X”*** — `jump to first`, `first mention of`, `where does it first say` and
  two more. The first hit Search's words mode would light up, reached by the deliberate jump, so Back
  and the return chip come home ([url-state.md](url-state.md)). The verbs all say *first*: `take me
  to glossary` names a mode, and must not become a search for the word. No hit keeps the bar open and
  says so. A visitor has it too; it writes nothing.
- ***Glossary: “term”***, or ***Look up “X” in this article*** when the glossary lacks it — `look up`,
  `define`, *what does X mean*. The owner's.
  [glossary.md § Looking a term up](glossary.md#looking-a-term-up) has the one thing that must stay
  true of the second.
- ***Add the tag “x”*** / ***Remove the tag “x”*** — `tag as`, `add a tag of`, `untag` and their
  kin. [library.md § Your own tags](library.md#your-own-tags).
- ***Turn experimental features on*** / ***off*** takes no argument and arrived with them: one row
  whose label follows the state, the rule Archive set.
  [experimental-features.md § The three controls](experimental-features.md#the-three-controls).

**Light, Dark and System are three rows since 2026-10-05** — *Appearance: Dark*, *Appearance:
Light*, *Appearance: System*
([261005d](../plans/261005d-theme-commands-in-the-command-bar.md)):

> Add a command in the command bar to be able to switch between dark and light mode, and I guess
> system mode as well.
>
> — Greg, 2026-10-04 (spya-c5wdn7)

A second door to the setting /profile has, not a second setting: Enter calls the same
`setAppearance` ([web-client.md § Appearance](web-client.md#appearance-light-dark-and-system)), so
the choice is kept on the device and applied at once. Typed-only; `theme`, `appearance` and `colour
scheme` list all three, and `dark mode`, `light mode`, `night mode`, `system` put theirs first.
**All three are always there and the one in force is marked `current`**, which is not the rule
Archive and the experimental switch follow (one row whose label follows the state): those are
toggles, this is a choice among three, and a reader in Dark who types `dark mode` should get a row
rather than `No command matches.` The mark is a field of its own (`marker`) and not part of the
description, because the description is what the sentence-picking model is shown, held once per row
in a checked-in file. A row the model picks waits for Enter, as every row that changes something
does. If the device refuses to keep the choice the colours still change and the bar stays open to
say it will last only until the page is closed. Words in
[`src/web/appearance-commands.ts`](../../src/web/appearance-commands.ts).

**It proposes a short list from why you are reading, since 2026-10-05**
([261005k](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md)).
On the owner's reading view, for an article that has a *why you're reading this*, an empty bar opens
on *Suggest what to do here*. Pressing it makes one small model call; the bar stays open and then
draws, under *From why you're reading*, up to three quick searches, up to two modes and one
question for chat about what the web says, each with a line saying why. **Every one is a row the
bar already had** (the quick-search row, that mode's own row with its own `generates` mark, Debate's
lens handoff), and nothing runs without its own press, whatever the model returned. The list is
kept for the visit in state of its own, hidden while the reader types, and dropped when *About you*
or the reason is saved. The model is shown the reader's profile and our words for the modes, never
the article. That makes this the one place the profile becomes words that can leave the
conversation: [reader-profile.md § The command bar's suggestions](reader-profile.md#the-command-bars-suggestions-the-one-exception).
Shapes in [`src/command-suggest.ts`](../../src/command-suggest.ts), the prompt and the call in
[`src/command-suggest-call.ts`](../../src/command-suggest-call.ts).

**The box takes dictation**, which is Greg's *"type (or even talk)"* from the bar's first day: the
microphone every other box has, and nothing can be pressed while it is listening —
[dictation.md § Adding it to a box](dictation.md#adding-it-to-a-box).

**Chat offers the same proposals as buttons in an answer**, pressed through the same runners; the
model writes a token and never runs anything —
[chat-tools.md § Command buttons](chat-tools.md#command-buttons-chat-proposes-the-reader-presses).

Three pieces of it are worth knowing about:

- **The words it will accept** are the mode's name, its description, and its **aliases** — `toc` for
  Structure, `define and `terms` for Glossary — which live in
  [`src/mode-catalog.ts`](../../src/mode-catalog.ts) beside the sentence each mode is described by.
  Six to twelve a mode since 2026-10-04, when Greg asked for more (*"structure mode could have aliases
  for hierarchy, table of contents, TOC, headings, etc."*, spya-uzkmn3); they were two to four. What
  still limits a word is that the cost of a loose one is not a missed match, it is the *wrong* row
  ranked first for somebody who typed the right thing — the rules are on `aliases` in that file, and
  `tests/command-match-mode-aliases.test.ts` types every one into the whole list. The ranking is five named tiers in
  [`src/web/command-match.ts`](../../src/web/command-match.ts), and ties break in Dock order.
- **The other rows are ranked by the same five tiers**, over words they carry themselves rather than
  out of the catalog — `src/web/CommandBar.tsx` § `besideTheModes` is the whole list, and another one
  is one entry in it. It is deliberately *not* the footer's list (`src/web/SiteFooter.tsx` §
  `LINKS`): the footer is the site's navigation, and Features, Pricing and Privacy are not things a
  reader mid-article reaches for a keyboard to get to. They sit below the modes on a tie because the
  caller hands the modes over first, not because anything says "pages last". *Homepage* is an alias
  on the Library row rather than a row of its own, because `/` **is** the shelf for a signed-in
  reader and two rows at one address would be two rows the keyboard cannot tell apart.
- **A row that would start work says so**, in one muted trailing word: `generates`. No figure and no
  readiness check — readers hold slots rather than paying per call, and a bar with a price on it
  would be *more* disclosed than the button beside it, which reverses a decision Greg made on
  2026-09-06. For a mode it is derived from `MODE_TARGET`
  ([`src/web/activation.ts`](../../src/web/activation.ts) § `modeGenerates`), which is already total,
  so a fifteenth mode cannot arrive unmarked; every other row carries a **required** boolean, so one
  cannot arrive unmarked either. Required rather than optional deliberately: an optional flag moves
  the failure from a check nobody would think to change to a field somebody could forget, which is
  quieter and not safer. It over-warns when the artefact is already there; the Dock under-warns in
  exactly the same case.

The key itself, and the four things the chord refuses to do, are
[keyboard.md § the one chord that is not an arrow](keyboard.md#the-one-chord-that-is-not-an-arrow).

### Getting in and out

- **[library.md](library.md)** — the shelf: `/read/<slug>`, what a card says, what you can do to
  one, and three sorting rules that look right in a browser and are wrong.
- **[shelf-terms.md](shelf-terms.md)** — the Topics row above the shelf: phrases picked by a
  program from the articles' own words, one count formula for every chip, and why the archived list
  now stays up during a search.
- **[public-shelf.md](public-shelf.md)** — the *other* shelf: `/read/public`, every article anybody
  has shared, listed for strangers. Why it is not the owner's shelf narrowed, and what listing it
  changed about what sharing promises.
- **[public-readable-sharing.md](public-readable-sharing.md)** — the page at
  `/features/public-readable-sharing`, written to the author of a republished article: what we do
  with it, which two of five briefed claims turned out to be false, and the three awkward facts we
  name on purpose.
- **[page-titles.md](page-titles.md)** — what the browser tab says. One rule — *what is different
  about this tab goes first* — and why assigning `document.title` announces nothing.
- **[reader-profile.md](reader-profile.md)** — two boxes and one string telling the model who is
  reading, where it rides in a prompt, and the microphone that looked broken twice and was not.
- **[experimental-features.md](experimental-features.md)** — the switch for features that are not
  finished, on this page and at the end of the bottom bar. Off by default, some modes and four Diagram
  pictures behind it, and the rule that hiding a feature never breaks a link to it.
- **[high-powered-ai.md](high-powered-ai.md)** — one article's capable-tier calls on Opus instead of
  Sonnet, for a difficult piece: the switch on `/metadata`, what moves and what does not, and why
  switching it re-runs nothing.
- **[dictation.md](dictation.md)** — talking into a text box: why it transcribes twice, the one
  microphone a page is allowed, and the three lines that give any box a button.
- **[live-conversation.md](live-conversation.md)** — talking to the article out loud, in the middle
  of a chat: why the audio never touches our server, the three orderings that fail silently, and the
  one guard that is also the idempotency.
- **[copy.md](copy.md)** — the words a reader sees when something fails, why they all live in one
  file, and the bracketed code at the end of every message.
- **[website-text.md](website-text.md)** — the pages that are about Spideryarn rather than about an
  article: the landing page, and the one address a reader writes to.
- **[help-page.md](help-page.md)** — `/help`, the page for readers: what it is for, where its words
  live, why its anchors never change, and the deploy step that keeps it true.
- **[privacy.md](privacy.md)** — what we do with a reader's data and the page that says so: the four
  decisions Greg made, what a bug report carries, and which claims are pinned by a test rather than
  by somebody remembering.

## Where the code is

Under [`src/web/`](../../src/web): [`main.tsx`](../../src/web/main.tsx) →
[`App.tsx`](../../src/web/App.tsx) → [`article/ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx)
→ [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) →
[`TableView.tsx`](../../src/web/TableView.tsx), with
[`layout.ts`](../../src/web/layout.ts) deciding what fits, [`tree.ts`](../../src/web/tree.ts) turning
the tree into table geometry, and [`scroll.ts`](../../src/web/scroll.ts) owning every jump. Reader-facing
strings: [`src/messages.ts`](../../src/messages.ts).
[web-client.md § Where the code is](web-client.md#where-the-code-is) has the full table.

---

Up: [AGENTS.md](../../AGENTS.md)
