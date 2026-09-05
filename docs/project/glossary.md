# Glossary — the terms this piece uses, and where it uses them

The terms an article uses in a non-obvious way, defined **from the article itself**, in the band
between the spine and the prose. Every one of them is underlined in the prose, in every mode, and
pointing at one shows its entry without opening the band at all.

[vision.md](vision.md#where-this-goes-after-granularity-zoom) has listed an *author's glossary* since
the beginning:

> **Author's glossary** — the terms this piece uses in a non-obvious way, defined from the piece
> itself.

Built 2026-08-25. The version this project is an offshoot of built one too, and
[original-version/glossary.md](original-version/glossary.md) is an account of what it got right and
the two bugs worth knowing about. **Read that before changing anything here** — several things this
feature does are answers to specific things that went wrong over there, and they look like fussiness
until you know what they are for.

```
  GLOSSARY MODE — same spine, same article, the band is a list of terms

 ┌─────────────┬─────────────────────┬─────────────────────────┐
 │             │  Mode: glossary   back to contents              │
 │  ▇▇▇▇▇▇▇▇   ├─────────────────────┼─────────────────────────┤
 │  ▇▇▇▇▇      │ Glossary    24 terms│ … a broadly nonreductive│
 │  ▇▇▇        │ order [prioritised] │   explanation of what it│
 │  ▇▇▇▇▇▇▇    │   first use hardest │   ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈   │
 │  ▇▇         ├─────────────────────┤   is like to be an      │
 │  ▇▇▇▇       │ threshold 0·30 · 6 of 24  organism …          │
 │             │ ──────●────────────  ← the bar, and the       │
 │             │ 18 terms are hidden    reader's hand on it    │
 │             │ by this threshold.  │                         │
 │             │ Drag the slider left│                         │
 │             │ to show them.       │                         │
 │             ├─────────────────────┤                         │
 │             │ nonreductive  d·72   │ … the nonreductive case│
 │             │ explanation   c·85   │   ┈┈┈┈┈┈┈┈┈┈┈┈          │
 │             │ │IN THIS PIECE       │   does not collapse …  │
 │             │ │Seth's term for an  │                         │
 │             │ │account that…       │      ↑ every term is   │
 │             │ ┊BACKGROUND      (i) │        underlined; this│
 │             │ ┊The ordinary use in │        one is pressed  │
 │             │ ┊philosophy of mind… │                         │
 │             │ ┊ ↗ en.wikipedia.org │                         │
 │             │ ┌───────────────────┐│                         │
 │             │ │CHECKED         🌐 ││   ← or, before anybody  │
 │             │ │Seth uses it in the││     pressed it:         │
 │             │ │sense Chalmers…    ││   [🌐 Check the web]    │
 │             │ │ ↗ plato.stanford  ││                         │
 │             │ └───────────────────┘│                         │
 │             │ ▸ also: nonredu…     │                         │
 │             │ ▸ used in 3 places   │                         │
 │             │   k3m9qt qw82nf      │                         │
 │             │ interoception d·66 c·61                        │
 │             │ …                   │                         │
 │             ├─────────────────────┤                         │
 │             │ ☐ use my profile    │                         │
 │             │ 🔍 Find more        │                         │
 ├─────────────┴─────────────────────┴─────────────────────────┤
 │ ⊞Hierarchy ▤Summary 📖Glossary ● 🔍Search ⌸Chat  …            │
 └─────────────────────────────────────────────────────────────┘

 The bar's five modes, with Glossary lit. Questions, Tweets and Metadata sit
 off the right of this box and are elided — see ../plans/260825c-bottom-bar.md.

 The bar is the whole of "prioritised": difficulty × centrality decides
 whether a term is on screen at all, and NOTHING else. The order is first
 use — the reader's own order through the piece — so of the list itself the
 model has chosen nothing. Both numbers are on every row; the product they
 were gated on never is.

 The two labelled sections under an open term are the provenance, and they
 are the whole answer to "which bits are and are not from the article": all
 of the solid-ruled one, none of the dotted one. IN THIS PIECE is from the
 article; BACKGROUND is what the model knows, and the link to check it sits
 inside that section because checking it is all the link is for. A closed
 row shows whichever of the two exists — for a person quoted once there is
 no "in this piece" worth writing, and saying so is the entry's whole job.

 CHECKED is the only part of an entry that has been near a source. The batch
 call does not search — background is memory, and the ↗ under it is a guess
 at a canonical page — so until somebody presses the button there is a button
 rather than a badge claiming a check nobody ran. The globe has an off state,
 because "the model judged it already knew" is a real answer and otherwise
 looks identical to a broken tool.

 The threshold row is where that product's one free number lives. Drag it
 left and the whole list comes back; drag it right and it narrows to the
 single costliest term. It reads out what it is set to and how many terms
 that shows, because the second is what you are aiming at — and under the
 track, always, how many it is holding back and the way to get them.
```

Code: [`src/glossary.ts`](../../src/glossary.ts) (stage 5d — the model call, the dedup, the
occurrence pass), [`src/term-match.ts`](../../src/term-match.ts) (the matching rule, shared),
[`src/api.ts`](../../src/api.ts) § `loadGlossary`, [`src/routes.ts`](../../src/routes.ts),
[`src/web/GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx),
[`src/web/useGlossary.ts`](../../src/web/useGlossary.ts),
[`src/web/annotate.ts`](../../src/web/annotate.ts) § `termMarks`, and `§ glossary mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css). Tests:
[`tests/glossary.test.ts`](../../tests/glossary.test.ts).

## Where it lives, and why that cost nothing

Greg, 2026-08-25, when this was asked for:

> When active, it should replace the middle sections of the UI (i.e. right of the spine, left of the
> doc).

> Use a button in the bottom-bar to activate it.

Which is exactly what a **mode** already is, because he had described this feature by name when chat
was built:

> I'm thinking that this might be a common pattern, that when we switch into a mode (e.g. Chat,
> Glossary, etc) we'll want to keep the spine and article, but reuse the middle sections. In fact,
> the current "Table of Contents" middle sections are just such a mode that can be chosen from the
> bottom-bar (the default).

So the glossary is the third implementation of the slot described in
[260826a-chat-mode.md](../plans/260826a-chat-mode.md), and it needed **no new layout arithmetic at all**. `fitView`
in [`layout.ts`](../../src/web/layout.ts) already knew about the slot rather than about chat; the
whole change there was one line in [`App.tsx`](../../src/web/App.tsx) — `chatting` became
`mode !== "hierarchy"` (`toc` until the mode was renamed on 2026-08-29). That is the evidence that the reframing was right, and it is worth recording
because the reframing looked at the time like extra ceremony for one feature.

Two consequences worth knowing:

- The CSS class for the band shell was `.chat` and is now **`.mode-band`**. Renaming it rather than
  writing `.chat, .gloss { … }` is the difference between a slot and two features that happen to
  agree. Each panel keeps a class of its own for whatever only it needs.
- The Dock's `DockMode` docstring said it should become a `role="radiogroup"` once there were three
  modes. There are three, and **it stayed a toggle** — see [Dock.tsx](../../src/web/Dock.tsx) for
  why the count was the wrong trigger. The bar shows two of the three modes, because `hierarchy`
  (then called `toc`) had no
  button, and a radiogroup naming two options is a worse lie than `aria-pressed`.

## What is generated, and when

Stage 5d writes `data/<slug>/glossary.json`. It is in `STEP_ORDER` and **not** in
`DEFAULT_INGEST_STEPS` — the same split `tweets` introduced, and the pair of them is what turned that
from an exception into the shape of the list: everything up to `arc` makes the article readable, and
everything after it is a thing somebody asks for.

Greg's call, 2026-08-25, choosing a button over generating on every ingest and over generating on
first view: **a button, on demand**. The third option — generate automatically when the mode is
opened — is the one the original version took, and its effect re-fired on every failure: generating,
failing, generating again, for as long as the tab stayed open. A button removes that bug
structurally rather than by remembering to set a flag on every error path.

### That decision was reversed on 2026-09-02, and the loop is still closed structurally

Greg asked for the third option after all:

> And let's have a rule that if the user clicks a mode that hasn't been run yet, automatically run it
> (rather than requiring them to click a button to start it running).
>
> — Greg, 2026-08-31

So **pressing Glossary in the bar on an article with no glossary starts the job**. The word that
carries the money is *clicks*: a pasted `?mode=glossary` link, a Back step, and a link in from the
metadata page all show the empty state and its button, and spend nothing. A press is real data —
[`src/web/activation.ts`](../../src/web/activation.ts) — rather than something inferred from the
state a mount happens to be in, because a mount is not a click.

The 2026-08-25 reasoning is still true, so the loop it was avoiding is answered by the shape of the
code rather than by a flag on every error path: **one automatic attempt per `(slug, step)` per tab
session**, claimed synchronously before the request goes out, in
[`jobEngine.beginAutoAttempt`](../../src/web/jobEngine.ts). A failure cannot loop because a loop
needs a second attempt and there is not one. The button stays and is the only retry — a person
pressing it is not a loop — and a reload is deliberately one more attempt, because a reader who
reloads after a failure is asking again.

The same four also apply to Ideas, Quotes, Timeline and the Sketch picture inside Diagram;
[`src/web/useAutoRun.ts`](../../src/web/useAutoRun.ts) is the one place the rule lives.
docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md § 2.

```
POST /api/jobs { "slug": "…", "steps": ["glossary"] }                          # once for a list
POST /api/jobs { "slug": "…", "steps": ["glossary"], "force": ["glossary"] }   # again, to add more
```

The first is what the panel's button does **and what the automatic run does** — they have to be the
same bytes, because `work_key` is computed from the request and two keys are two paid jobs. The
glossary is the one of the five that already had this right: forcing this step *appends*, so its
`find` was never allowed to force. The second is "Find more". There is no command line: the stage's
own one was deleted on 2026-09-01 as a second way to do this
([setup-dev.md § The pipeline stages](setup-dev.md#the-pipeline-stages)).

## The two bugs this feature is shaped around

Both are theirs, both are in
[original-version/glossary.md](original-version/glossary.md), and both are answered in code here
rather than in a prompt.

### One — the answer is what times out, not the question

Their extraction hit 504s in production. The cause was not the size of the article going in; it was
the number of **output** tokens coming back, because every entry carries two explanations. The fix
was a cap per call plus a "Load More" that feeds the already-extracted entries back so the model does
not repeat itself.

So: `BATCH_SIZE = 20`, `suggestedCount(words)` scales the ask and clamps to it, and **running the
step again appends**. `passes` on the artefact counts the calls. The panel used to print it under the
list, on the argument that it was the only way to see that *Find more* had done anything; that
stopped being true once the head grew a term count and the threshold row grew *n of m*, both of which
move when a pass lands and both of which are the number the reader was actually waiting for. It went
on 2026-09-05 — [above](#there-was-a-start-again-beside-it-and-it-went). It is still on the artefact
and in the export.

The second pass is given their FORBIDDEN checklist almost verbatim, because a plain "don't repeat
these" is not enough: the model's idea of a repeat is looser than ours, and it will happily return
the synonym, the plural and the subcategory of something already on the list.

### Two — their dedup deleted the more specific term

The model would emit both `nonreductive` and `nonreductive explanation`. Their dedup kept whichever
appeared **first in the document** and discarded the other — which was not a coin toss between two
equals. A general term is nearly always introduced before the specific phrase built on it, so
first-wins reliably deletes the better phrase, and the matcher then hunts the article for the
shorter, wronger one.

Their own plan proposed a richness-scored normaliser. **It was never built.** `dedupe` in
[`src/glossary.ts`](../../src/glossary.ts) is that normaliser, and its rule is stated by what it
keeps:

1. Two entries collide when their names normalise the same, or when one's **name** matches the
   other's **alias**.
2. Two entries that merely **share an alias** do not collide. That was their first attempt, and it
   was too aggressive — legitimate entries that happened to share a synonym were discarded, quietly.
   **Both directions of this bug fail silently**, which is why both have a test.
3. When they do collide, the **richer name wins** — more words, then more characters — and the poorer
   becomes an alias of it, carrying its own aliases across. Nothing is thrown away.

Rules 1 and 2 are the narrower fix they actually shipped, and they are right. Rule 3 is the half that
matters: without it, 1 and 2 still systematically destroy the more specific phrase, just less often.

**The merged entry keeps the incumbent's `id`**, even when the challenger's name wins. A `?term=`
link addresses an entry by id, so an id that changed when a later pass found a better name for the
same thing would break the reader's link in order to say the word slightly differently. Names are
display; ids are identity.

## Finding the term in the prose

**`blocks` on an entry is computed by us, never asked of the model.** The model is never shown a
block id and never returns one, so it cannot invent one. Matching the text can only be wrong about
*where* a term is, which a reader sees the moment they press it; a hallucinated id would be invisible
and would scroll them somewhere arbitrary. This is the same instinct as
[`validate-tree.ts`](../../src/validate-tree.ts) — check the invariant rather than trusting the
prompt to have honoured it.

It also turns the best line in their prompt into something **measurable**:

> Try to make the aliases distinctive, so that a regex using the aliases finds all and only
> references to the entity (if possible).

An entry that matches **no** block is either a term the piece does not use in those words or an alias
set too narrow to find it. Both are worth seeing, so the empty list is stored rather than smoothed
over, the panel says so in as many words, and the pipeline logs `unmatched` on every run. It is the
one quality signal this feature gives about what the model returned.

### The matching rule, and why it is its own module

[`src/term-match.ts`](../../src/term-match.ts) imports nothing from node, which is what lets it reach
the browser bundle. The server uses it to record which blocks a term is in; the reading view uses it
to underline the occurrences. **Those two must agree**, or the panel says a term is in a block and
the block shows nothing underlined — the feature looks like it is working and is quietly lying about
where the words are.

Three things in it are not obvious:

- **The word boundary is not `\b`.** `\b` is defined against `[A-Za-z0-9_]` even under the `u` flag,
  so an accented letter is a non-word character to it — and that breaks in both directions at once.
  `/\bcafé\b/` does not find "a café here"; `/\bco\b/` matches inside "coöperate". Unicode property
  lookarounds ask the question we actually mean. Both directions have a test.
- **The alternation is ordered longest-first**, because JavaScript takes the first branch that
  matches rather than the longest. That ordering is the whole of "`nonreductive explanation` beats
  `nonreductive`", and it is one sort call away from being wrong.
- **A trailing plural or possessive is allowed.** No prompt reliably lists the plural of every noun,
  and without this "attention head" silently misses the sentence about "attention heads" — which is
  usually the sentence you wanted. The honest cost: `bus` matches the text `buss`. Rare, and wrong in
  the harmless direction.

### Where the underlines are drawn

`termMarks` in [`annotate.ts`](../../src/web/annotate.ts) turns **the whole list** into `Mark`s —
one entry of it until 2026-08-26, see [The underline is always there](#the-underline-is-always-there)
— which is the same machinery a comment uses. Two things follow:

- Offsets are in the **rendered-text space of `block.html`**, not `block.text`. The two strings are
  different lengths and mixing them lands a mark somewhere plausible and silently wrong — the header
  of `annotate.ts` is entirely about this.
- A comment and a term over the same words become **one `<mark>` with both classes**, not two nested
  ones. Two underlines stacked on the same words read as a rendering bug, and the comment keeps
  `cmt` so it stays clickable — a question you asked does not stop being openable because a glossary
  term happens to sit inside it.

`termMarks` only searches the blocks the server named. That is an optimisation — six blocks rather
than four hundred, on every render — but it is chosen for the other reason: it makes a disagreement
between the two halves surface as a **missing** underline rather than as an underline in a block the
panel claims has none.

### The underline is always there

**Reversed on 2026-08-26, and the thing it reversed is written up two sections below.** Greg:

> Glossary entries should always be underlined in the verbatim text column, even outside Glossary
> mode, and hover should show a rich tooltip.

So the prose now carries the **whole list**, in every mode, whether or not the band has ever been
opened. Four things follow, and three of them are the interesting part:

- **The line got quieter.** A wash behind one pressed term is a highlight; the same wash behind every
  term in the piece is a mottled paragraph the reader cannot turn off. The standing mark is the
  dotted rule alone (`mark.term` in [`styles.css`](../../src/web/styles.css)); the wash moved to the
  pressed one.
- **Being selected had to stop meaning "having a mark"**, because everything has one now. It means a
  *different* mark — `mark.term[data-open]`, which is exactly what the open comment and the pressed
  search hit already do. `open` on `TermSelection` carries it.
- **The principle moved rather than lost.** What the section below objects to is the *article
  acquiring explanation* on the model's initiative. The underline is now a standing property of the
  page, like a heading; the explanation still arrives only when the reader points at something, and
  the thing that arrives is [the hover card](#the-hover-card).
- **The list has to be fetched for every reader**, which is the cost `GlossaryBand` was built to
  avoid. Half of it is avoided anyway: `useGlossaryRead` in
  [`useGlossary.ts`](../../src/web/useGlossary.ts) is **one opening GET** and no job poller, and the
  band still owns everything with a job in it — which was always the expensive half.

  For a day there were **two** GETs: this one, and the band fetching the same URL again from
  `status: "loading"` when it opened. So the panel said *"Looking for a glossary…"* over a list
  that was already on screen, underlined, in the prose behind it — and on the Postgres store that
  second request read most of the article out of the database to compute one boolean. Since
  2026-08-27 `Reader` owns the read and the band takes it as a prop.
  [260827am-glossary-read-latency.md](../plans/260827am-glossary-read-latency.md) has the measurements.

  The band still **revalidates** when it opens, behind the list already showing, and that is not
  optional: `useJobs` treats its first poll as a baseline and does not announce a job that had
  already finished, so a glossary written in another tab while the band was closed has nothing
  else to bring it in. So the rule is not "fetch once" — it is that **`status` never goes back to
  `loading` for an article it has already answered for**. Moving to a *different* article does
  reset it, deliberately: that is a list nobody has yet.

### The hover card

Point at an underlined term and its entry appears — name, what the author means by it, what you need
to bring to it, the web answer if somebody has already asked for one, and a way into the band.
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx).

**It is not [`Tooltip.tsx`](../../src/web/Tooltip.tsx)**, and the reason is the same one that shapes
`annotateHtml`: the marks are injected HTML, not React elements, so there is nothing to clone a ref
onto — and there are hundreds of them on a long article, so one Floating UI instance per occurrence
would be hundreds of them for the one being pointed at. It is **one** panel for the page, positioned
against whichever `<mark>` the pointer is on, with the hover intent as delegated listeners and
timers. Floating UI still does flip, shift and follow-the-scroll.

Three details worth knowing before changing it:

- **It takes pointer events, and nothing else here does.** `.tooltip-anchor` is `pointer-events:
  none` so a spine tooltip can never land under the pointer and keep itself open. This card carries a
  link and a button, so it has `interactive` — and therefore a close delay long enough to cross the
  gap between the words and the card.
- **Touch has its own path, and it is not hover.** A tap fires the hover events — `pointerover` on
  the way in, and `pointerout`/`pointerleave` the instant the finger lifts, because a touch pointer
  cannot hover and the spec destroys it there. Letting the hover machine see a finger would therefore
  open a card and immediately take it away again. So since 2026-08-27 a finger gets the spine's rule
  instead: **the first tap opens the card and the second goes to glossary mode**, decided from
  `pointerdown`/`pointerup` rather than from a click, with the compatibility events that follow
  swallowed so a term inside a link does not navigate. A card a finger opened closes on a scroll; one
  a pointer opened follows the words as it always did. [touch.md](touch.md) and
  [260827ak-touch-glossary-card.md](../plans/260827ak-touch-glossary-card.md).

  **This paragraph said the opposite until 2026-09-03** — *"a tap … never fires the leaving event"* —
  and so did the comment on the handler. It is the false belief itself, written down in two places,
  and it is what made a second document-level listener look safe to leave unguarded: `pointerleave`
  closed the card 220ms after every tap, for a week, on every touch device.
  [260903g](../postmortems/260903g-the-touch-card-closed-itself-on-every-tap.md).
- **The mouse click stays inert.** Pressing a mark with a pointer does what pressing prose has
  always done, which is select it. The way to the full entry is the button in the card's foot, which
  opens the band on that term — and on a finger, tapping the words again.
- **A mark carrying two terms commits to neither.** Where two entries overlap the same phrase the
  card draws both, because which matched the longer phrase is not something the mark records. A
  second tap there does nothing and leaves the reader the two named buttons.

## What we deliberately do not do

**Mark up the prose on the model's initiative.** Theirs put a dotted underline and a small book icon
on every term, inline, in every article, always. That is the prose acquiring marks the author did not
write, at the model's suggestion rather than the reader's — a small violation of
[principle 5](vision.md#principles), and the thing our own review of their feature said to drop.

What happened instead was Greg's call, 2026-08-25, chosen over a jump-only alternative: **selecting a
term underlines its occurrences, and only while it is selected.** Reader-initiated, so the principle
holds — and it answers the question the list otherwise raises on every entry, which is *where does
this piece actually use that*.

**That half was reversed on 2026-08-26** — see [The underline is always there](#the-underline-is-always-there)
above, which says what survived of it and what did not. What is still true is the rest of this
section: the icon never came back, the click is still inert, and the *explanation* is still something
the reader asks for rather than something the page pushes at them.

## What an entry says, and which half came from where

**Rewritten 2026-08-26.** Greg looked at the entry for a person the article quotes once:

> **Leslie Lamport** *person* — Computer scientist quoted for the line 'If you're thinking without
> writing, you only think you're thinking,' which the article uses to argue writing and thinking are
> inseparable. ⚠ Goes beyond what the article says.

> it's pretty weak! It adds almost nothing to the user's knowledge of Leslie Lamport, nor does it add
> any useful explanatory gloss to help understand the article itself. […] And "Goes beyond what the
> article says" is vague/confusing - either be clearer, or indicate in the glossary entry itself
> clearly (e.g. with tooltips or highlighting) which bits are/not from the article.
>
> — Greg, 2026-08-26

**That entry was the model obeying the prompt.** `SYSTEM` said the gloss says *what THIS AUTHOR
means, in this article*, which is exactly right for a term the author **bends** and unanswerable for
one they merely **borrow**. The article does not *mean* anything by Leslie Lamport; it quotes him.
Asked what the author means by the name, the only article-grounded sentence available is a
description of the quotation — and a description of the quotation is a description of a page the
reader is looking at.

Two things follow, and they land in different places:

- **Searching the web would not have helped.** The model knows who Lamport is. The prompt told it not
  to say.
- **`fromOutside` fired on an entry containing nothing from outside.** A boolean over a blob has no
  dose and no location; even when it is right it cannot say *which two words*.

### The two fields

| field | what it holds | where it comes from |
|---|---|---|
| `senseHere` | what *this author* means, where the surrounding sentences do not give it to you | the article, and only the article |
| `background` | who this person is, what this work is, what the term ordinarily means | the model's own knowledge, labelled as such |

**At least one, and usually only one.** A coinage of the author's needs only `senseHere`; a person
named without introduction needs only `background`; a borrowed term the author bends needs both. The
prompt says `LEAVE THIS FIELD OUT rather than restate the page. An absent field is a real answer` —
and carries the bad Lamport entry verbatim as a worked example, because the failure is a *register*
the model falls into, and a negative example is the strongest guard against a register.

**The closed row shows `senseHere` if there is one and `background` if there is not**
(`entryProse`, [`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx)). That one line is what makes
the design self-correcting: the panel never has to know what kind of term it is looking at. Nothing
branches on `kind`, deliberately — kind is a proxy and it leaks both ways. A concept can be an
allusion (*Paxos*), and a person can be fully introduced by the article.

Run against the article that started this, the split does the work with no branching at all:

```
writes and write-nots   here: The author's coined split of society into two groups …
Leslie Lamport          bg:   A Turing Award-winning computer scientist known for
                              foundational work in distributed systems and for creating
                              LaTeX. He is often invoked as an authority on rigorous
                              thought, which is why his aphorism … is used here.
```

### Provenance is the label, not a badge

The open entry is two labelled sections, **in this piece** and **background**, and the label is the
whole answer to *which bits are and are not from the article*: all of this one, none of that one.
`background` carries a hover caption saying the article doesn't say it, and the canonical `url` —
which is the model's guess at a page, not a source it visited — sits **inside** that section, because
checking the background is the only thing it is for.

**The ⚠ is gone.** Warning styling treats outside knowledge as a hazard, when for an allusion it is
the entire product. The panel still reserves alarm for an actual failed check — *"These exact words
do not appear in the article"* — which is where it belongs.

**Inline marking was rejected**, and it was Greg's own suggestion, so the reasons are written out in
full in [the plan](../plans/260826d-glossary-entries-worth-reading.md#rejected-marking-the-outside-bits-inline):
a model tagging its own sentences will misattribute some and a wrong inline tag is uncheckable;
markup inside a stored string would reverse the plain-text stance below; and stippled two-colour text
in an 18rem band is noise. Field granularity *forces* the separation that sentence granularity would
have to detect.

### A prompt ban relocates a register, it does not delete one

Worth knowing before touching `SYSTEM`, because it cost a round trip to find. The prompt bans
describing what the article does with a term — and its own GOOD example ended *"which is what his
line is being borrowed for"*, so every entry ended the same way: *"making him the article's example
of ..."*. Removing that clause from the example worked, and the register **moved into `senseHere`**,
which is worse: that field leads the closed row, so the original complaint came back through a change
meant to prevent it.

Both fields now carry the ban explicitly, and `senseHere` carries the list of openers that give it
away — *"Cited as", "Quoted for", "Referenced as", "Used as an example of", "Invoked to", "The
article's"*. The distinction that makes it coherent is the same one the selection rules use: **which
facts you choose is governed by this article; the sentence you write is about the term.**

### Name the thing, not the topic

One guard added after watching the first run: the model came back with **"JFK speechwriting"** and
**"MLK plagiarism controversy"** — the person fused with what the article says about them. That is
not a fussy naming preference. Occurrences are matched on the name and its aliases
([`term-match.ts`](../../src/term-match.ts)), so a composed name is a name that **appears nowhere in
the article**, and those two entries only found their blocks because `JFK` and `MLK` happened to be
aliases. The prompt now names both as examples of what not to do, and the re-run gave
*John F. Kennedy* and *Martin Luther King Jr.*

### Checking a term on the web

`background` is the model's memory. **Nothing in the batch call is checked against anything**, and
the `url` it sometimes offers is a guess at a canonical page rather than a page it visited. So the
open entry carries a **"Check the web"** button, and pressing it is what turns a remembered answer
into a checked one:

```
POST /api/glossary/:slug/:id/lookup   →  { entry }   (~10s, one model call)
```

**The answer does not stream, and that is not because it cannot.** The lookup drains `explain()` and
appears whole, behind a spinner that says so. What it would take, and why it is waiting on the
Postgres store seam rather than on the streaming, is in
[260826o-streaming-the-slow-two.md](../plans/260826o-streaming-the-slow-two.md) — **whoever finishes the glossary
store should do it then**, which is why this note is here rather than only in the plan.

**Its answers live apart from the glossary, keyed by entry id** — one row per `(article, entry)` in
Postgres ([`src/store/pg-lookups.ts`](../../src/store/pg-lookups.ts)), and
`data/<slug>/glossary-lookups.json` on the filesystem store
([`src/glossary-lookups.ts`](../../src/glossary-lookups.ts)) — never inside `glossary.json`. **Both
halves exist and both are wired**; the sentence above about the Postgres seam is about *streaming*
and nothing else. It has been read as saying lookups are files-only, which they have not been since
the seam landed — checked against the code and against the deployed store, 2026-09-04. A lookup
is *reader state*, which by this repo's own rule lives beside the artefact rather than in it; and
sharing a file with the generating stage is unfixable rather than merely racy, because that stage
holds its read across a minute-long model call. Worse, `glossary.json` is written with a bare
`writeFile`, and a truncated one reads as `null` — which the panel reports as *"Nobody has found the
terms for this one yet"*, the whole glossary gone and nothing saying so. The sidecar is
temp-and-rename and serialised, both copied from [`src/comments.ts`](../../src/comments.ts).
`loadGlossary` attaches them at read time, so the panel still just sees `entry.lookup`.

**It is `explain` with a different selection** — the same function comments use
([`src/explain.ts`](../../src/explain.ts)), with the form of the term the article really uses as the
quote and, since 2026-09-04, **the first block of the article that uses it** as the anchor, found by
scanning rather than read out of `entry.blocks`. It was `entry.blocks[0]` and nothing else, which
made a term used in five places uncheckable the moment the first of them changed — see
[The two ways it refuses](#the-two-ways-it-refuses-and-why-they-used-to-be-one) below.
That is not opportunism: our review of the previous version argued a
glossary should be *the same mechanism as comments with a different prompt* rather than a second
system, and this is the first half of that. It also means the article prefix is **cached and shared**,
so a lookup on a piece somebody has already asked a question about is a cache hit.

Three decisions inside it:

- **Per entry, on demand — never in the batch call.** One call over a whole article with the model
  choosing per entry could serialise a dozen searches, on a call that is already capped and
  paginated *because output tokens caused 504s in the previous version*, and its citations would not
  map onto entries anyway: annotations attach to spans of the response, and the response is one JSON
  blob. [The plan](../plans/260826d-glossary-entries-worth-reading.md#3-the-web-on-demand-per-entry-never-in-the-batch)
  has the full argument, including the one that decided it — searching would not have fixed the entry
  that prompted all this.
- **The answer sits beside `background`, never merged into it.** A reader who cannot tell the checked
  answer from the recalled one has lost the thing the labels above exist to give them.
- **`searches: 0` is drawn, not hidden.** The model decides per call, so "it judged it already knew"
  is a real outcome and the globe has an off state saying so. Without that, an answer that was never
  checked looks identical to one that was.

Sources render as **host names with the page title in a hover tooltip** — Greg's own suggestion, and
the shape an 18rem band can take: the title is the useful thing to read and the wrong thing to lay
out. `Tooltip.tsx` rather than a `title=` attribute, so it works on focus too.

#### The two ways it refuses, and why they used to be one

A lookup needs a **passage** to anchor the question to, and there are two quite different reasons it
may not find one. They shared a sentence until 2026-09-04, and that sentence named the term and said
it *"does not appear in this article"* — so a reader met it under a row headed with that term, beside
the entry's own definition, and reported it:

> I tried to use the glossary check the web option, but it said that the phrase in the glossary when
> I was checking didn't exist even though it clearly did, because there was a glossary entry for it
> and I can see it right there on the page.
>
> — a reader, 2026-09-04

**The question is asked of the article, never of `entry.blocks`.** `anchorIn`
([`term-lookup.ts`](../../src/term-lookup.ts)) scans the blocks as they are now for the first one
that uses the term, under `term-match.ts`'s rule — which on a list that fits its article is exactly
`entry.blocks[0]`, and on one that does not is the only honest answer available. The stored
occurrences describe whichever extraction the list was written against, and a glossary is **carried**
into every new revision (`glossary: "carry"`,
[`pg-revisions.ts`](../../src/store/pg-revisions.ts)) — so an empty `entry.blocks` can sit beside an
article that quotes the term in every paragraph.

Only when the article uses none of the term's names is there a refusal, and then staleness decides
which:

| the list | what it means | what the reader gets |
|---|---|---|
| fits this article | none of the term's names is in the piece — the model named it rather than the article quoting it, or the aliases are too narrow, or the entry was invented | `[gl-not-quoted]`, and the button is **disabled** rather than left to fail |
| was written for another version | it says nothing reliable about this article, in either direction | `[gl-stale]` — *find the terms again*, which is the banner already on screen |

**That staleness is computed from the two objects in hand**, with `isStale`
([`glossary.ts`](../../src/glossary.ts)) over the glossary and the article `lookUpTerm` is holding —
not taken off `GlossaryResponse.stale`. `loadGlossary` and `loadArticle` are two reads through
`articles.current_revision_id`, and a publish landing between them pairs one revision's glossary with
another's blocks; comparing the pair the refusal is actually about is true of whatever it was
given. ⟨Sol⟩

Both sentences are in [`src/messages.ts`](../../src/messages.ts) § glossary, and **neither names the
term**: the failure is rendered inside that entry's own row, so repeating the name bought nothing and
cost the reader their confidence in the list.

The first row is not damage and not rare — **5 of 141 entries** in the local corpus on 2026-09-04
(`npx tsx` over `spideryarn.article_revisions.glossary` against every article that has one). It is
`findOccurrences` doing its job on names like *"scaling laws / scaling curves"* and *"Conway's Game
of Life"*, which the piece alludes to and never spells out. The panel has always said so
(`gloss-nowhere`); what it did not do was stop offering a button that could only fail — and it now
says it **only when we know the list was written against this article**, for the same reason the
server does.

**A visitor is told neither**, and that is a change rather than an oversight. A shared link carries
no freshness and deliberately cannot — the public graph may not reach `isStale`
(`tests/public-imports.test.ts`) and a visitor could not act on the answer — so
`occurrencesFitTheArticle` is `false` for them and the sentence is withheld. It costs a visitor one
explanatory line on rows that have no occurrences; what it buys is that they are never told the
words in front of them are absent. The button is not drawn for a visitor at all, so nothing else
changes. Reversing this is one boolean if Greg would rather have the sentence.

**What is still open:** those entries are arguably the ones a web check would help most — the
remembered answer is all there is — and we refuse them, because `explain` wants a selected passage
and inventing one is a false premise handed to a model asked to reason from it. A web check written
for an unquoted term — its own prompt, saying honestly that the glossary named something the article
alludes to — is a real option and nobody has decided it.
[The postmortem](../postmortems/260904c-the-glossary-said-the-term-was-not-there.md) has the rest.

### Looking a term up

A reader asked for one, the day after the bug above:

> I would like to be able to type into a search box in the glossary for a particular term and for it
> to look for that term and add it to the glossary. And maybe it should be a tiny bit robust in the
> spelling or something if I type it wrong.
>
> — a reader, 2026-09-04, `[SPIDERYARN-READING2-Y]`

Built the same day, and **cut down**: it finds the term in the piece and explains that passage.
`AskATerm` in [`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx) →
`POST /api/glossary/:slug/ask` → `makeAskAboutTerm` in
[`term-lookup.ts`](../../src/term-lookup.ts), which is *"Check the web" with a phrase where the entry
was*: the same `anchorIn` walk, the same `explain` call, the same `safeUrl` filter, drawn by the same
`LookupAnswer` component. One anchor rule, which is the whole argument for that file existing.

**"A tiny bit robust" is [the matching rule](#the-matching-rule-and-why-it-is-its-own-module) and
nothing more** — case, plurals and possessives fold; a misspelling does not. There is deliberately
**no "did you mean…"**, considered and rejected on the day: the matcher gives no typo tolerance at
all to build a ranking on, and the word a reader wants is as often a lowercase idea as a proper noun,
so the article's proper-noun list (`vocabulary-sources.ts` § names, which the plan proposed) would
miss the commonest case while looking confident. A guess here is
[the postmortem's fault](../postmortems/260904c-the-glossary-said-the-term-was-not-there.md) in a
friendlier tone.

**The article's own words are what the model is told about**, not the reader's — type *attention
head* at a piece that says *Attention Heads* and the quote is the plural, because that is the text
that is there. A side effect worth having: the reader's own string never reaches the model at all.

#### The three ways it comes back empty

Three, not one, because the sibling refusal above was one sentence over three causes and a reader
reported it. Each says what was established and what the reader can do about it:

| what was checked | code | what the reader gets |
|---|---|---|
| the characters are nowhere in the piece, not even inside a longer word | `[gl-ask-absent]` | **Ask in chat**, the one surface that may answer from outside the article |
| the characters are there, but never with a boundary on both sides — *axiom* against *axiomatic* | `[gl-ask-part-word]` | try the words as the piece writes them; chat is still offered |
| there is no prose to search at all | `[gl-ask-no-prose]` | **not a claim about the term** — the branch exists so an empty scan cannot be reported as an answer |

The third has never fired: **0 of 52** revisions in the local corpus have no text-bearing block
(`bool_or(text <> '')` over `spideryarn.revision_blocks`, run 2026-09-04). It is reachable by
construction rather than defensive — `assertSomethingWasProduced`
([`blocks.ts`](../../src/blocks.ts)) requires *a* block and not a block with words in it, and
figures, images and embeds carry no `text` — and it is kept for the reason the whole split exists:
the alternative is a confident sentence about the term over a scan that read nothing.

The second scan is the same escaping and the same whitespace rule as `termPattern` **minus the
boundary lookarounds**, so the only thing the two answers can disagree about is the boundary. It does
not claim a typo, because a substring hit is not evidence of one — and its sentence **does not say
"word"**, which a draft did. A term whose own edge is punctuation is the counterexample: `-bar`
against a piece that says `foo-bar` fails the bounded scan and passes the loose one, yet `-bar` is
right there. What is true every time is the thing the lookarounds tested, so that is what the
sentence claims: *a letter or a digit runs straight into them*. ⟨Sol⟩ All three refusals are `409`,
before any model call, and none of them names the term back at the reader — it is in the box a line
above. [`messages.ts`](../../src/messages.ts) § glossary has the sentences;
[`tests/glossary-asked-term.test.ts`](../../tests/glossary-asked-term.test.ts) has a case per cause,
matched on the code and never on the wording.

#### Nothing is stored, and that is deferred rather than forgotten

**No entry is created. The answer lives in the panel until the reader leaves the article.** The
reader asked for it to be added to the list, and that half is not implementable as it stands — three
reasons, in the order they were found:

1. **The glossary is one JSON document**, deliberately: entries are generated wholesale and
   deduplicated wholesale, so `article_revisions.glossary` holds the lot
   ([`schema.ts`](../../src/db/schema.ts) § `glossary`). That comment already names the condition —
   *"if a reader ever edits or annotates one, that is the day this becomes a table"*.
2. **[Find more terms](#finding-more) recomputes and merges**, so a reader's entry
   could be merged away by a button two lines further down the same panel.
3. **A shared article publishes the whole glossary blob**
   ([`public-reader.ts`](../../src/store/public-reader.ts)), and the public DTO strips only
   `entry.lookup` and the provenance ([`public-types.ts`](../../src/public-types.ts)) — so **a term
   the reader added would go out with an already-shared link.** All three verified in the code on
   2026-09-04; the third is why v1 stores nothing rather than storing carefully.

Persistence is its own piece of work: an additive `reader_glossary_entries` table keyed by owner,
article and revision, merged into the owner's response only, and a decision recorded about the public
projection. Until then the hint under the box says *"Not added to the list"*, so the answer's
disappearance reads as the design rather than as a failure.

**No rate limit, no quota and no single-flight guard — and there is none to reuse.** The sibling
`lookup` POST has none either; the only limiter in [`routes.ts`](../../src/routes.ts) is the feedback
form's hourly cap. So **an owner with one article of their own can drive paid `explain` calls as fast
as they can post**, each of which may run up to eight web searches. Ownership decides *which* article,
not *how many* requests; `withSpendAttribution` records the spend rather than authorising it; and this
request never enters the job queue, so the concurrency limit of three is not a limit on it. Written
down rather than fixed, because it is the shape of every paid request in this file and a scheme
invented for one endpoint would be the wrong place to start. **A decision for Greg**, raised by GPT
Sol's review of the built code, 2026-09-04, and in
[`260904_1301`](../user-feedback/260904_1301-glossary-search-box-for-a-term.md).

The cheapest thing that already exists is `inTurnOrder` ([`routes.ts`](../../src/routes.ts)), the
per-key serialiser chat writes go through — one ask at a time per article. **It is per *process***,
so it would slow a script on one box and bound nothing on a fleet; a real cap is a stored counter,
which is [billing.md](billing.md)'s territory rather than this feature's.

The endpoint takes **a term and nothing else**: no block id, no offset, no definition, no aliases, no
owner. That does not mean the caller has no say in the passage — a long enough term picks out one
paragraph of their own article — but there is no spelling of the request that gets a paid model to
read text of the caller's own composition, or anybody else's article. ⟨Sol⟩

### What this replaced, and how old glossaries behave

`glossary/1`'s `gloss`, `detail` and `fromOutside` are **still read and still rendered**, unlabelled
and with their badge, exactly as before. There is no honest label for a blend: putting the old
`gloss` under "in this piece" would attribute the model's own knowledge to the article, which is the
one direction of error this change exists to prevent.

They do not linger, and **the first attempt at making sure of that was a data-loss bug** worth
knowing about, because both halves of it were invisible.

`PROMPT_VERSION` went to `glossary/2`, and the plan claimed that made every existing glossary read as
stale. It did not: `isStale` compares `sourceHash` and nothing else, so an old list on an unchanged
article showed no banner and the reader was never offered the button that would rewrite it. That is
what `GlossaryResponse.outdated` is for — a **second** flag beside `stale`, because they are
different facts needing different sentences: *the article moved underneath these terms* is not *the
article is the same and we would write these differently now*.

The append path then briefly **refused** to append across the version boundary, to avoid handing
[`dedupe`](#two-their-dedup-deleted-the-more-specific-term) two vocabularies. Follow it through:
`existing` becomes null, `buildGlossary` gets no previous entries, so `taken` is empty and **every id
is re-minted** — every `?term=` link dead — the file is overwritten, and `passes` resets to 1 so the
log reads like a first run. All behind a button labelled *Find more terms*, which was the only one on
screen because of the bug above.

The first fix for *that* was also wrong, and a second review caught it: it translated the old entries
into the new shape and appended as normal, which preserves ids and **defeats the feature**. Appending
hands the model a FORBIDDEN list naming every term already present, so it never rewrites them — the
result is stamped `glossary/2`, the banner disappears, and the original weak entry survives wearing a
"background" label whose tooltip says the article did not say it. Certified rather than replaced.

**What it does now is refuse, and inherit the ids.** A version change regenerates the prose, which is
what *Find them again* promises; `idsByTerm` gives a fresh entry the id the old list used for the same
name or alias, so `?term=` links and stored lookups survive a rewrite that the sentences do not. Names
are display; ids are identity.

### Where the previous list comes from, and the four answers it can give

**From the `ArtifactStore`, not from a path** — `previousGlossaryFrom` in
[`src/glossary.ts`](../../src/glossary.ts), since 2026-08-28. Both jobs above depend on it: whether
to *append* (`existingFor`) and whose ids to *inherit* (`idsByTerm`). Until then it was
`readGlossary(dir)` inside the stage, whose every failure is one `null` — and the moment the
pipeline's artefacts leave the filesystem that read fails on every run while looking exactly like a
first pass, so *Find more terms* silently becomes *replace the glossary*, `passes` resets to 1, and
every `?term=` link goes dead ([260827aa-delete-the-importer.md](../plans/260827aa-delete-the-importer.md)).

| | what it means | what happens |
|---|---|---|
| no previous glossary | a first run | mint, quietly |
| one whose `sourceHash` differs | the article's text moved | mint, quietly — **correct, not an error** |
| one the store cannot read | we cannot tell which of the two it was | **the stage fails** |
| the store read throws | an infrastructure fault | **propagates; the stage fails** |

The third row is the one worth the table. A `glossary.json` that will not parse still holds every id
the reader's links name, so somebody with a backup can put it back — and minting over it takes that
possibility away while reporting success. Whether the ids are recoverable is a different question
from whether to proceed; the same argument, and the same mistake made first, is in
[block-ids.md](block-ids.md#where-the-previous-run-comes-from-and-the-three-answers-it-can-give).

## The scores, and the condition attached to keeping them

Every entry may carry `difficulty` and `centrality`, 0–1, the model's own judgment. Our review of
their version recommended **dropping both**, on the grounds that "here are the important terms,
ranked by how important we think they are" is the model doing the reader's prioritising, which
[vision.md](vision.md) is against.

Greg overrode that on 2026-08-25, and the override came with its own condition: **keep both, and
never sort by them silently.** So:

- the sort is a control you press, and it only offers a score the model actually returned;
- **the number you sorted by is shown on every row**, because an order the reader chose but cannot
  see the basis of is what was actually being objected to;
- an unscored entry sorts **last**, not as zero. An entry the model declined to score is not one it
  scored as trivial, and treating the two the same is the small lie that makes a sort untrustworthy.

`?sort=` is in the URL like everything else ([url-state.md](url-state.md)), and it pushes history
because reordering a list is a deliberate act on the view.

### The scores the prompt required, and did not get

The prompt **requires** both scores on every entry, so a missing one is the model disobeying rather
than taking an offer — unlike quotes, where omitting one is allowed. Until 2026-09-03 nothing
counted either that or a score `score()` refused for being the wrong type or out of range, so a model
that started answering `"high"` for `0.8` would have quietly stopped the panel offering *prioritised*
order with no log line moving ([silent-success.md](../reusable/silent-success.md)).

`GlossaryScoreDrops` in [glossary.ts](../../src/glossary.ts) counts four things —
`difficultyAbsent`, `difficultyRejected`, `centralityAbsent`, `centralityRejected` — per field, in
`toEntries`, over the entries it kept and before `dedupe` can borrow a missing score off a duplicate.
It does **not** ride the artefact and is shown to no reader: it is a fact about our prompt, not about
their article. Logged at the end of the stage in [pipeline.ts](../../src/pipeline.ts). The quotes'
twin is [quotes.md § The scores are counted too](quotes.md#the-scores-are-counted-too-and-nobody-is-told).

### Prioritised, which is now the default

The first clause of that condition — *the list arrives in document order* — lasted a day. On
2026-08-26 Greg asked for a fourth order and for it to arrive without being asked for:

> for the Glossary, let's add a "Prioritised" order (that should be the default) that somehow takes
> into account importance, centrality, and order. Perhaps it's a combination of important and
> centrality and first-order appearance? Or combination of importance and centrality, thresholded
> somehow, then ordered by first-appearance?
>
> — Greg, 2026-08-26

It is the second of those two sketches, with one substitution. The whole argument, the four designs
it was chosen from and the two things it is a bet on are in
[260826b-glossary-prioritised-order.md](../plans/260826b-glossary-prioritised-order.md); the three things to know
here:

**The two scores multiply. They do not add.** What is worth ordering by is the cost of *not* knowing
a term — how likely it is to stop you, times how much of the argument stops with it. A sum gets both
ends wrong at once: a very central, very easy word (*"attention"*, in a piece about attention) scores
high and needs no flagging, and a very hard, very peripheral one scores high too and is exactly the
distraction a priority list exists to keep off the top. A product sends both to the bottom.

**The product gates, it does not rank.** Two noisy 0–1 model scores multiplied together separate the
clear top from the rest and say nothing trustworthy about the middle, so it decides one thing —
`difficulty × centrality` against `PRIORITY_GATE`, in or out — and produces **one list of what is
in**, with the rest hidden and counted ([below](#it-hides-what-is-below-it-since-2026-09-03)).
The order is **first use**, which is where the third thing Greg asked for lives, and
which means the model has chosen nothing there. Both raw numbers are on every row; the product never
is, because that is our arithmetic dressed as the model's judgment and a number the reader can
neither interpret nor check.

**It cancels itself when it cannot help**, and the question it asks is *does the top of the track
hide anything* — `canPrioritise` in [`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx), which
answers yes when some score sits **strictly below the top stop**. Not *are there two distinct
scores*: that was the first spelling and it is wrong about the slider's own grid, because the bar
only stops on hundredths and the track ends at the top score floored to one of them, so `0.501` and
`0.509` differ while every position the reader can reach shows both (GPT Sol, 2026-09-03). Where
nothing is offered the order falls back to first use and the control is not drawn — the same rule
the score sorts already followed, one step on: *do not offer an order that would visibly do nothing.*

**There are no old glossaries with no scores**, and this doc said for a week that there were.
`difficulty` and `centrality` arrived in `bf5a91e3`, the commit that created the glossary, and have
been optional every day since — so an unscored entry is not a legacy era but
[the model disobeying a prompt that requires it](#the-scores-the-prompt-required-and-did-not-get),
and none was found in any data we could inspect. The fallback stays because the model can still
disobey.

`PRIORITY_GATE` is an **absolute** threshold rather than a relative "top third", and the reason is
what each does when it is wrong. An absolute gate that misfires degenerates to plain first-use order.
A relative one would keep exactly a third on screen whatever the scores said — inventing a ranking that is
not in the data and putting a confident label over it, which is the failure this whole feature has
been shaped to avoid. Its starting value is a guess; on `data/writes` it leaves two terms of eleven
on screen.

### The threshold, and whose it is

That guess had no feedback loop, which the plan named as the first of two bets. Later the same day
Greg turned it into a control:

> Add a small threshold-slider to the Glossary UI (set to a sensible default)
>
> — Greg, 2026-08-26

So `0.30` is now a **starting position rather than a verdict**, `?gate=` carries wherever the reader
moved it, and the last number this feature decided on the reader's behalf is theirs. Four things
about it are decisions rather than details:

- **The track ends where the data does**, not at 1.00. Real products cluster low — two scores of 0.7
  make 0.49 — so a fixed 0–1 track would be two thirds dead and every glossary would be adjusted in
  the same narrow strip at the left. Ending it at the top term's own score makes both ends mean
  something: hard left shows everything, hard right shows exactly the costliest term (plus any the
  model did not score, which survive everywhere).
- **It says how many it is holding back.** A line under the track, in every state including none and
  all: *"18 terms are hidden by this threshold. Drag the slider left to show them."* Present
  wherever the slider is and absent wherever it is not, because a line that goes missing for a
  *different* reason teaches the reader nothing, and an empty list under a bar is otherwise
  ambiguous between *there is nothing here* and *you have hidden it all* —
  [silent-success](../reusable/silent-success.md), which this codebase keeps catching itself in.
  `hiddenNote` in [`src/web/threshold.ts`](../../src/web/threshold.ts) writes it for all three
  sliders.
- **The order no longer cancels itself just because the bar hides nothing.** It used to. The slider
  reverses that argument twice over: cancelling would take the slider away with it and strand the
  reader mid-adjustment, and a list with nothing hidden here is not silent — the bar is on screen
  with its number and its count, and the foot line says so in words. What still falls back is a
  glossary nothing on the track can divide, which is the `canPrioritise` question above.
- **The default stays absent from the URL.** `?gate=` has no default of its own, so "absent" keeps
  meaning *nobody has touched this* — which matters, because the whole condition on these scores is
  about the difference between a number the reader chose and one that simply arrived.

This is an **override of the condition above, not an exception it allows for** — a default ranking is
in the letter the model's prioritising arriving unasked. What survives is the half that was actually
being objected to: the order is named in a control that shows as selected, the foot line says how
many the bar is holding back, the numbers are on every row, and *first use* is one tap away.

#### It hides what is below it, since 2026-09-03

> In Glossary / Prioritised mode, we have a threshold slider. Right now, if I set the threshold
> high, it shows the highest-priority first, and then all the rest just below. I think it would be
> clearer if it only showed the stuff above threshold (with an indication below perhaps that "N
> hidden because they're below the X threshold" (or something along those lines).
>
> And there are other modes with thresholds - they should work the same way.
>
> — Greg, 2026-09-03

So the second group headed *"the rest"* is gone, and the *"worth knowing first"* heading over what
remained went with it: a heading with nothing to contrast is not a heading. [quotes.md](quotes.md)
and [search.md](search.md) now do the same thing in the same words, and the rule they share lives
once, in [`src/web/threshold.ts`](../../src/web/threshold.ts) — including **an unscored entry
surviving every position of the bar**, which is Greg's *"in the interim, always show them"*.

That reverses an argument this repo had written down and defended, in
[search.md § Prioritised](search.md#prioritised-place-order-with-a-bar-under-it): *a glossary is a
reference list, and a term you cannot find is a term you have lost.* It did not survive contact.
The bar is on screen with its number, the foot line says how many it is holding back, and dragging
it left is one gesture — a term is not lost when the control that hid it is the control in your
hand. [260903c](../plans/260903c-threshold-sliders-hide-below-threshold-items.md).

## Finding more

One button in the foot, and one thing it does:

| | What it does | How |
|---|---|---|
| **Find more** | another pass, told what it already has, appended to the list | `force: ["glossary"]` on the job — the step is current, so nothing else would run it |

### There was a *Start again* beside it, and it went

Greg, 2026-09-05:

> we can probably get rid of Start again button and the "claude-sonnet-5 · glossary/3 · one pass" at
> the bottom, those are all confusing and unnecessary.

It threw the list away — `DELETE /api/glossary/:slug`, then an ordinary run — and it existed
**because** running the step again appends: without it there was no way at all to say "this list is
wrong". Three things had made that argument weaker than it reads.

- **The glossary was the only mode carrying a reset.** Ideas, quotes and the timeline all *replace*
  on re-run, so re-running one already is starting again, and nobody has asked for a way back there
  ([`src/routes.ts`](../../src/routes.ts), the comment beside the `ideas` route).
- **"Too long, too noisy" is the threshold's job now**, and has been since it started hiding rather
  than grouping — one gesture, no model call
  ([260903c](../plans/260903c-threshold-sliders-hide-below-threshold-items.md)).
- **Some recovery survives**, because `existingFor` refuses to append when the source hash, the
  prompt version or the profile differs. An edit, a prompt bump or the *use my profile* checkbox
  therefore rewrites rather than appends — and `idsByTerm` inherits the ids, so the reader's
  `?term=` links survive it.

Against that, a destructive button, an inline confirm and a `danger` style sat in a band meant to
stay quiet, on every visit, for an action used roughly never. ⟨Fable, 2026-09-05⟩

**What we gave up, stated plainly**, because the third bullet reads stronger than it is and a
cross-family review said so. Recovery now needs an *input* to change. A bad glossary under the same
article, the same prompt and the same profile cannot be rewritten at all: *Find more* keeps every
existing entry and is forbidden from returning close replacements, the threshold can hide a noisy
entry but cannot correct a wrong definition, and a reader with no profile has no checkbox to flip.
Editing the article or waiting for a prompt bump is not an affordance. This is an **accepted loss**,
not an equivalent path — the judgment is that the case is rare enough not to be worth permanent
destructive chrome in the reading band, and the route below is what a future Metadata action would
call. ⟨Sol, 2026-09-05⟩

**`DELETE /api/glossary/:slug` stays, with no caller in the client**, and so do its two suites —
[`tests/store-glossary-delete-pg.test.ts`](../../tests/store-glossary-delete-pg.test.ts) and
[`tests/glossary-delete-then-rebuild.test.ts`](../../tests/glossary-delete-then-rebuild.test.ts). It
is the Postgres-safe half and it costs nothing to keep; if the capability is ever missed, the
Metadata page is where it belongs, as an owner's article-management action rather than a button in
the reading band.

It is an **API-only capability**, not a dormant one: the route is still owner-authenticated and a
`curl` reaches it, which is why its 409 sentence says *try again* and names no button. The two
suites exercise the store and the coordinator rather than the route's *transport*, so that much is
uncovered while nothing drives it — named here rather than papered over with a test written for a
caller that does not exist. The case for deleting the route outright is real (attack surface, a
contract to maintain, tests for something no reader can reach, and git keeps the implementation);
it was weighed and lost to Fable's, and this paragraph is what the next person needs to reopen it.
⟨Sol, 2026-09-05⟩

`deleteGlossary` still refuses to touch the committed `example/` fixture. That guard was load-bearing
while `articleDir` fell through to `example/` for any slug with no output of its own, including one
that does not exist — the one committed directory in the repo was a `DELETE` away from any unknown
article. Since stage 1a, `candidateDirs` resolves `example/` for the fixture's own slug and no other,
so what the guard now stops is a `DELETE` addressed to `example` itself, which is nobody's to write
to.

**In Postgres the delete can also answer 409**, if a queued or running job already holds a draft for
the article — deleting the published glossary underneath a job in flight would otherwise be
overwritten right back when that job publishes.
[260903e-glossary-delete-in-postgres.md](../plans/260903e-glossary-delete-in-postgres.md). Its
reader-facing sentence still says to press *Start again*, and nothing can reach it from the client
now; it is left as it is rather than rewritten for a caller that does not exist.

**A stale glossary is not appended to.** The article underneath it moved, so the old entries describe
a piece that no longer exists and folding new ones in would produce a list half-describing each. That
decision is one line in `generateGlossary` and it is the line to read if the behaviour ever looks
wrong.

## Staleness, and the force cascade

The step's freshness check is its `stamp` in [`src/pipeline.ts`](../../src/pipeline.ts), compared
by `sameStamp`. It checks the three things
[architecture.md § Storage](architecture.md#storage) has always specified for a cached artefact: what
it was written from (`sourceHash`), the prompt version, and the model id. Change any one and
it regenerates by itself, with no `force` and nobody having to remember. Anything unreadable answers
**false**, which is the safe way round: the cost is one model call, where the other way is a stale
glossary served for ever.

**`sourceHash` is the blocks, the tree and the metadata head, since 2026-08-31** —
`articleFingerprint` in [`src/source-hash.ts`](../../src/source-hash.ts). It was the blocks alone,
which is a third of what this prompt reads: `renderPrompt` builds the skeleton out of
`partsOf(tree)`, and `articleText` writes `TITLE:`, `BY:` and `PUBLISHED IN:` above the prose. The
sharp edge is not the wasted model call — it is that this same hash decides, through `existingFor`,
whether the next run **appends** to the list or starts it again, so a fingerprint that missed a
re-cut tree would go on adding terms to a glossary written about a differently-shaped article.
[260831b-finish-the-database-move.md](../plans/260831b-finish-the-database-move.md) § stage 1.

Until 2026-08-28 this was a hand-written `glossaryIsCurrent` in `src/glossary.ts` doing the same
three comparisons. `stamp` replaced it, the function kept only its own tests alive, and a comment in
`pipeline.ts` wrongly said the CLI still needed it — so it was deleted. `isStale` stays: it is the
pure half, and the API response uses it to tell the panel the list is out of date.

`hashBlocks` moved out of `src/tweets.ts` into [`src/source-hash.ts`](../../src/source-hash.ts) for
this, and that is not tidying: two stages computing "the same" fingerprint two ways can only ever
disagree, and the day they do, one artefact reports itself current against a different definition of
current. The article fingerprints are beside it now, for exactly the same reason and across six
stages rather than two — two functions, because `articleText` and `articleWithIds` do not print the
same head.

`glossary` is in `FORCE_ONLY_WHEN_NAMED` for two reasons, and the second is not shared with `tweets`.
It reads the blocks and the tree and nothing reads what it writes, so the positional cascade would
buy a model call for nothing — **and** forcing this step appends, so being swept in would silently
lengthen the reader's glossary as a side effect of re-fetching the article.

## Six ways to break this quietly

1. **Change the matching rule on one side.** `src/term-match.ts` is imported by the stage and by the
   reading view. Inlining a "quick" regex in either half makes the occurrence list and the underlines
   disagree, and neither will error.
2. **Sort the entries in the artefact.** `glossary.json` stores document order. Sorting on write
   would make `?sort=document` mean whatever the last writer felt like, and the panel's default order
   would silently become a ranking.
3. **Trust `url`.** It came out of a language model and the panel renders it as an `href`.
   `safeUrl` allows `http:` and `https:` and nothing else. Zod's `.url()`, which is what theirs
   validated with, accepts `javascript:`.
4. **Let the cascade force it.** See above. The symptom is a glossary that grows every time somebody
   refreshes an article, with nothing anywhere saying why.
5. **Take the winner's prose outright in `merge`.** It used to do exactly that with `gloss`, and it
   was safe only because every entry had one. With two optional fields it deletes the loser's
   `senseHere` whenever the winner has none — which is precisely the case where it is the only one
   in the pair. Every field goes `winner.x ?? loser.x`, and the dedup's whole promise is that nothing
   is thrown away.
6. **Append a reader's own entry to the glossary document.** It is one line and it would work on a
   laptop. `article_revisions.glossary` is published whole to everyone a shared link is shared with
   ([`public-reader.ts`](../../src/store/public-reader.ts)) and the public DTO strips only
   `entry.lookup` — so the entry leaves with the article, and *Find more terms* may merge it away on
   the way. This is why the [Look up a term](#looking-a-term-up) box stores
   nothing. It needs its own owner-scoped table before it needs a UI.

## What is still open

- **The hover card has no keyboard route at all**, and that is the one open question here with a
  real cost attached. The marks are injected HTML, so they are not focusable and cannot take
  `aria-describedby`; the card is reachable by pointer and by nothing else. Making every run a tab
  stop is not the answer — a long article has several hundred of them, and tabbing through the
  article's prose to reach a definition is worse than the gap. A GPT Sol review, 2026-08-26,
  suggested the two least-bad shapes: **one focusable control per paragraph** ("the terms used here")
  opening a list, or **one roving tab stop** across a paragraph's occurrences with `focusin` handled
  by the same delegated listener, Enter to open and Escape to close. Neither is built. What *was*
  done is honest labelling: the card is `role="dialog"` rather than `role="tooltip"`, because WAI's
  tooltip pattern says outright that a tooltip does not take focus and should not contain focusable
  controls, and this one holds a link and a button.
- **The hover state machine has no test**, and it is the part of this feature most likely to be
  wrong: it is timers, a delegated listener and two pieces of mutable closure state, and the one real
  bug in it so far — a pointer that crossed a term and moved on within the open delay cancelled
  nothing, so the card opened at a word nobody was pointing at — was found by *reading* it, not by
  running it. Testing it needs a component harness this repo does not have
  ([testing.md](testing.md) is about pure functions), so adding one is a dependency decision rather
  than a chore. Until then the marks and the merge are covered by `tests/annotate.test.ts` and the
  interaction is covered by a person.
- **Nothing generates a glossary for the fixture.** `example/` has no `glossary.json`, so the panel
  there always offers the button and the button writes into `data/`, which the fixture is not. That
  is consistent with the thread page and equally unsatisfying on both.
- **No keyboard traversal of the term list.** ↑ / ↓ belong to the article
  ([keyboard.md](keyboard.md)) and taking them inside the band needs a focus story the band does not
  have yet. Same gap chat has — and the same gap is why the ‹ › stepper added to the occurrence line
  on 2026-08-27 ([`BlockNav.tsx`](../../src/web/BlockNav.tsx)) is buttons only. Greg asked for
  prev/next in this mode and in [ideas.md](ideas.md) at once, so it is one component in both; it does
  not wrap, matching `stepComment`, and it nudges rather than jumps, matching `goToComment`.
- **The prose fields are plain text, deliberately.** The model is told no Markdown, and nothing
  renders any — rendering arbitrary model output as HTML is what [security.md](security.md) is
  about. If entries ever want emphasis, the answer is a restricted renderer, not
  `dangerouslySetInnerHTML`. This is also the second reason inline provenance marking was rejected
  on 2026-08-26: marks inside the prose mean markup inside a stored string, and that reverses this.
- **Nothing is checked against a source until somebody asks.** `background` is the model's memory
  and `url` is a guess at a canonical page. The per-entry lookup above is the answer, and it is
  reader-initiated by design — but it means an entry nobody has pressed the button on is entirely
  unverified, and the only thing saying so is the absence of a "checked" block.
- **A term nobody has pressed the button on is entirely unchecked**, and the only thing saying so is
  the absence of a "checked" block. That is the cost of making the web reader-initiated, and it is
  the right cost, but it is a cost.
- **A checked answer is written for a dialog, not for an 18rem column.** Reusing `explain` means
  reusing its length rule — *"two or three short paragraphs is usually right"* — which was tuned for
  [`CommentDialog`](comments.md). Measured in a browser at 1,158 characters against a `background` of
  265: it does not overflow and it is not cramped, but the checked part becomes the bulk of the entry
  and the entry becomes a footnote to it. The fix is a `SYSTEM` of its own, which means lifting the
  transport out of `src/explain.ts` into something both callers share — worth doing, not done, and
  the reason it is worth doing is that the prompt is the *only* part of that file a lookup wants to
  differ on.
- **A term the reader looked up cannot be kept**, which is half of what they asked for —
  [Looking a term up](#nothing-is-stored-and-that-is-deferred-rather-than-forgotten) has the three
  reasons and the shape of the table it needs. The sharpest is that the glossary blob is published
  with a shared article, so this is a projection decision before it is a schema one.
- **The Chat handoff is a mode switch and nothing more.** The composer is not pre-filled with the
  term, because a draft has to cross a component boundary only chat mode's own dialog has a prop for
  ([`chat-handoff.ts`](../../src/web/chat-handoff.ts)). One prop's worth of work, not done.
- **Nothing ties a term to a question.** [comments.md](comments.md) already answers "what does this
  mean" for a selected passage, and our review of their version argued a glossary should be *the same
  mechanism with a different prompt* rather than a second system. It is currently a second system —
  a cheap one, with its own artefact and its own anchor model, but a second one. Worth revisiting
  before either grows.

## See also

- [ideas.md](ideas.md) — **the sibling mode, and the other axis on this one's grid.** A term is a
  word you look up; an idea is a proposition you hold. It also shares this panel's ‹ › stepper and,
  more consequentially, this panel's two provenance classes: the solid left rule for what came from
  the article and the dotted one for what came from the model. Those are reused rather than
  re-declared, because they *are* the distinction and a second panel drawing it differently would
  teach the reader it means something else
- [search.md](search.md) — the other mode that marks up the prose, and the rule both follow
  about when the article may acquire marks. It is also where the third `MarkKind` came from, and
  where the account of why `annotateHtml` did not need replacing now lives

- [original-version/glossary.md](original-version/glossary.md) — theirs: the prompt, the two bugs,
  and what we said we would do differently
- [260826a-chat-mode.md](../plans/260826a-chat-mode.md) — the mode band this reuses, and the reframing that made it a
  slot
- [comments.md](comments.md) — the other way to ask what something means, rooted in a selection
- [block-ids.md](block-ids.md) — why an occurrence is a block id and never an offset
- [url-state.md](url-state.md) — `?mode=glossary`, `?term=`, `?sort=`, `?gate=`
- [security.md](security.md) — the sanitiser, and the two forged-mark classes it strips
- [architecture.md](architecture.md#pipeline) — where stage 5d sits
