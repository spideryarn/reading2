# Vision

## Intent

The brief, in Greg's words (2026-08-24):

> I'm interested in trying a new way of reading that's AI assisted, but still — well, **it augments
> human cognition, but it doesn't replace it.** So the idea would be that instead of trying to make
> things too easy, trying to replace the words with quick and easy summaries so much, but rather we
> **help the user get what they need from it, help them read efficiently, but deeply, help them
> internalize and interrogate.**

Everything else in these docs is downstream of that sentence. The principle behind it, and the
tiebreak when a design decision is genuinely close, is in notes Greg dictated before 2026-09-03
([the full notes](../research/260902k-greg-notes-the-edge-between-ease-and-difficulty.md)):

> it's always going to be tempting to move towards automation. And that's always going to be easier
> for the human, easier indeed for the product designer, and tempting. I guess we want to hold some
> kind of line. … The best one I have in my mind is: **what will help the human to best form their
> own rich updated internal representations?**
>
> you can go to the gym or you can buy a forklift truck to lift the weights. But if you buy the
> forklift truck that lifts the weights, then you atrophy. … if I had 1 guiding hunch, it's that we
> want to be at a kind of edge between ease and difficulty where things are difficult enough that
> they have to work, but not so difficult that they give up or fail. … our goal is to make things
> easier where we can, but not too easy.

So the tiebreak is: **which option will best help the reader form their own rich, updated internal
representation** — digest, understand, learn, notice, integrate, critique? The tiebreak used to
read "which option leaves more of the thinking with the reader?", and Greg replaced it on
2026-09-03: the point is not how much work is left to the reader but what the reader comes away
holding.

## The problem with AI reading tools

The default move is compression: paste an article, get bullet points, done. That's genuinely useful
for triage and genuinely corrosive for understanding. It replaces the reading rather than supporting
it — "trying to make things too easy". The reader ends up with a fluent impression of the piece and
none of its texture: no arguments they could reconstruct, no sentences they could quote, no sense of
where the author was strong and where they were hand-waving.

## What we want instead

Tools that make deep reading *cheaper*, not optional.

- **Scan before you commit.** — *"you could sort of scan through things quickly if you just want to
  kind of get a vague sense of the landscape"*
- **Descend on demand.** — *"or you could burrow deeply."* From any point in that overview, go
  straight down into the actual prose.
- **Stay oriented.** The reader should always know where they are in the argument, at whatever
  altitude they're flying.
- **Interrogate.** Ask questions of the text at the point of confusion, in place.
- **Internalise.** Come away with something retained, not just something skimmed.

The first feature built on this is [granularity zoom](granularity-zoom.md).

## Principles

1. **The text is the destination, not the source material.** Summaries exist to route the reader
   into the prose. Every generated line should be a door, not a wall. (Concretely: **the reading
   view never substitutes generated text for prose it could show instead** — leaves carry no `gist`,
   so at the rightmost level you get the real paragraph. Navigation is a separate matter: a Hierarchy
   row *is* a door, so leaves do carry a short `navLabel` that appears only in Hierarchy and the
   spine.
   See [granularity-zoom.md § Node shape](granularity-zoom.md#node-shape).)
2. **Speak the author's language.** Summaries reuse the author's own terms and framing where possible,
   so that when the reader arrives at the passage, they recognise it. Avoid the flattening "the author
   argues that…" voice. Enforced in the prompt rules at
   [granularity-zoom.md § Generation](granularity-zoom.md#generation).
3. **Effort in the right places.** We are not trying to minimise reading time. We're trying to minimise
   time spent on the parts the reader didn't need, so there's more left for the parts they did.
4. **Legible provenance.** Anything the model asserts is anchored to a block id, and the reader can
   always reach the passage it came from in one action. See [block-ids.md](block-ids.md).
5. **No hidden reformulation.** We never silently rewrite the author's prose in the reading view.
   Generated text lives at generated altitudes; the rightmost level is verbatim, always.

## Prefer boring

The principles above are about reading. This one is about building, and it is the tiebreak whenever
a tool or a layer is up for discussion.

**Prefer boring**: filesystem over database, one server process, TypeScript + ESM throughout, `tsx`
to run. *"It can be a simple one at first"* — no framework churn while the ideas are still moving.
Every hour spent on infrastructure is an hour not spent on the reading experience, and a tool
adopted early is a tool you are stuck with once four agents have written against it.

**Two deliberate exceptions, both 2026-08-25, both Greg's call.** They are recorded here rather than
quietly absorbed, because a principle that gets overridden without anybody noticing stops governing
anything.

### One — the database

"Filesystem over database" is being reversed. Storage moves to Supabase Postgres,

> in readiness for deploying this properly to the web
>
> — Greg, 2026-08-25

The principle did not lose an argument; it ran out of runway. A single writable disk is the thing
serverless hosting does not have, so the choice is a database or no deploy. Planned in
[260825f-postgres-migration.md](../plans/260825f-postgres-migration.md); until it lands, the filesystem layout in
[database.md](database.md) is still what is true. "One server process" goes with it. Everything else
in the bullet — TypeScript, ESM, `tsx`, no framework churn — is untouched.

### Two — shadcn

Tailwind v4 and shadcn components went in at Greg's request:

> Let's switch to using Shadcn.
>
> — Greg, 2026-08-25

That is framework churn, and it was weighed against this principle rather than slipped past it:
[260825a-shadcn-migration.md § Honest assessment](../plans/260825a-shadcn-migration.md#honest-assessment) states the
cost in full and recommends only the cheap half of it. The principle was not forgotten; its owner
overrode it.

### Simpler first

The same tiebreak applies to product decisions, not only to tools. When two versions of a feature
would both work, build the simpler one first and let use, not foresight, decide whether the fuller
one is needed. A plan says which simpler option it passed over, and why
([AGENTS.md § Writing code](../../AGENTS.md#writing-code)).

> prefer the simpler product decision first, get a v1 working and then gradually layer in
> complexity/optimisations afterwards as needed, to highlight when a product decision will add
> extra complexity or other tradeoffs
>
> — Greg, 2026-08-31

It still governs how far shadcn is allowed to spread.
[web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components) says what is
deliberately staying hand-written, and
[design-css-overview.md](design-css-overview.md) is the map for anything visual.

## Anti-goals

- A chatbot with the article stuffed in the context window.
  <br>*Greg asked for a chat on 2026-08-25 and it was built. The anti-goal stands as written — it is
  still the thing to avoid — and the argument that what was built is not it, along with the honest
  account of where that argument is weakest, is
  [260826a-chat-mode.md § Say the awkward thing first](../plans/260826a-chat-mode.md#say-the-awkward-thing-first).
  In one line: the article never leaves the screen, and every claim carries a block id you can press
  to go and check it.*
- "Read this in 2 minutes."
- Engagement mechanics, streaks, or anything optimising for time-in-app.
- Auto-generated confident claims with no path back to the source.

How we'd know we're failing at this rather than succeeding is itself unresolved —
[Q6](open-questions.md#q6).

## Where this goes after granularity zoom

> And then we'll add a bunch of other readability — not readability, like **reading assistant
> functionality** as well.

The same block-id spine ([architecture.md § Pipeline](architecture.md#pipeline)) supports a family of
these, each to be judged against the principles above:

- **Ask in place** — a question about the paragraph under the cursor, answered from the surrounding
  context, cited back to block ids. **Built**, as of 2026-08-25: select a passage and the model
  explains it, researching the web when it judges it needs to. See [comments.md](comments.md).
- **Author's glossary** — the terms this piece uses in a non-obvious way, defined from the piece
  itself. **Built**, as of 2026-08-25: a mode in the band beside the prose. Since 2026-08-26 every
  term is underlined wherever the article uses it, in every mode, and pointing at one shows its entry
  without opening the band. See [glossary.md](glossary.md).
- **Ideas** — the propositions a piece needs you to hold: the ones it *assumes* without stating, and
  the ones it *introduces*. **Built**, as of 2026-08-27, and the sibling of the glossary rather than a
  widening of it — a term is a word you look up, an idea is a claim you hold. See
  [ideas.md](ideas.md).
- **Argument view** — claims, the support offered for each, and the moves the author doesn't make.
  <br>*Distinct from Ideas above, and the line is worth keeping: a claim is what the author asserts
  and defends **here**; an idea is a tool you could carry away and use on a different piece.*
- **Confusion signal** — the reader marks a passage as unclear; the highest-value input we can get,
  because it sits exactly on the boundary between what they already know and what they need help
  with. The glossary is the same instrument in passive form — *"the glossary needs to be visible at
  all times … because the user's interactions with it provide us with really valuable information"*
  (Greg, [notes](../research/260902k-greg-notes-the-edge-between-ease-and-difficulty.md)).
- **Notes and highlights** anchored to block ids, surviving re-extraction — which is precisely why
  those ids are random rather than sequential
  ([block-ids.md](block-ids.md#why-random-and-not-sequential)).
- **Recall** — a few durable questions generated from what the reader actually dwelt on.
- **A model of the reader** — where they are and what they know, built passively where possible
  (time on a paragraph, what they select, what they open in the glossary) and only crudely from the
  profile boxes ([reader-profile.md](reader-profile.md)). Every mode above becomes a consumer of it.
- **A difficulty map** — which paragraphs are hard before we know anything about the reader, as a
  data structure other modes read from rather than a mode of its own. Distinct from the original
  app's document-level difficulty badge, which was a verdict with no consumer
  ([borrow-list.md](original-version/borrow-list.md)).
- **And, eventually, not six modes** — *"a rich augmented interface for reading a text that
  dynamically combines across these modes"*: a tutor that says as you scroll, *"I had a feeling you
  might struggle with this."* The band the modes take turns in
  ([reading-view-overview.md](reading-view-overview.md)) is the simpler-first version of this, not
  the end state.

### Further out

Two of Greg's, 2026-09-05, recorded so they aren't lost — neither is on the near list, and
*"for now I just want to make what we have work well"*:

- **A command bar.** Type or talk, and the right mode opens on the right passage — *"a bit like
  Spotlight/Alfred on the Mac"*: *"take me to the bit where the article introduces access
  consciousness"*, *"generate me Quotes and an Illustrated diagram"*, *"explain how access
  consciousness is different from phenomenal consciousness"*. Greg: *"Dunno if a mode registry would
  help with this!"* — one was deliberately rejected for the current shape, and the reasoning is in
  [new-mode.md](new-mode.md); a command bar would be the first argument on the other side.
- **Reader-built modes.** *"a world in which users can build their own new modes (generate UI), or a
  marketplace of modes — though all that is far in the future"*.


## Under this doc

`vision.md` is one of the seven entry points listed in [AGENTS.md](../../AGENTS.md). Three things sit
under it, and then the four folders that hold the project's memory.

- **[positioning.md](positioning.md)** — what the website says, who it says it to first, and what
  the product is called; the decisions, in Greg's words, and the interview that turns them into copy.
- **[open-questions.md](open-questions.md)** — the calls nobody has made yet, each with a
  recommendation so nobody is blocked. It should shrink: when a question gets decided, the answer
  goes into the doc that owns it and the question is deleted.
- **[original-version/](original-version/overview.md)** — the larger app this one is an offshoot of,
  a folder with one doc per feature: what it already solved, what it got wrong, and
  [what to rebuild first](original-version/borrow-list.md). A library to consult, not a backlog to
  import.

The record of how the intent above became decisions is kept in four directories, each with a short
doc of its own saying what goes in it and what to call the file:

- **[plans.md](plans.md)** — `docs/plans/`, one file per piece of work, written before it lands and
  kept afterwards, naming the simpler option it passed over.
- **[research.md](research.md)** — `docs/research/`, the working behind a decision: the options
  weighed, the sources, the dead ends.
- **[postmortems.md](postmortems.md)** — `docs/postmortems/`, one file per bug worth understanding,
  and the class of mistake it belongs to.
- **[tutorials.md](tutorials.md)** — `docs/tutorials/`, self-contained HTML explainers for somebody
  who has never opened the repository.

---

Up: [AGENTS.md](../../AGENTS.md)
