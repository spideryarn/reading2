# Glossary — the terms this piece uses, and where it uses them

Up: [reading-view-overview.md](reading-view-overview.md)

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
 │  ▇▇▇▇▇      │ 🔍 Find more        │ … a broadly nonreductive│
 │  ▇▇▇        │ order [prioritised] │   explanation of what it│
 │  ▇▇▇▇▇▇▇    │   first use hardest │   ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈   │
 │  ▇▇         ├─────────────────────┤   is like to be an      │
 │  ▇▇▇▇       │ threshold 0·10 · 21 of 24 organism …          │
 │             │ ──────●────────────  ← the bar, and the       │
 │             │ 3 terms are hidden     reader's hand on it    │
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
 │             │ │FROM A WEB SEARCH🌐 ││   ← or, before anybody  │
 │             │ │Seth uses it in the││     pressed it:         │
 │             │ │sense Chalmers…    ││   [🌐 Dig deeper]       │
 │             │ │ ↗ plato.stanford  ││                         │
 │             │ └───────────────────┘│                         │
 │             │ ▸ also: nonredu…     │                         │
 │             │ ▸ used in 3 places   │                         │
 │             │   k3m9qt qw82nf      │                         │
 │             │ interoception d·66 c·61                        │
 │             │ …                   │                         │
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

 The web-search answer is the only part of an entry that has been near a source. The batch
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
[`src/store/pg.ts`](../../src/store/pg.ts) § `loadGlossary`, [`src/routes.ts`](../../src/routes.ts),
[`src/web/GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx),
[`src/web/modes/glossary/GlossaryMode.tsx`](../../src/web/modes/glossary/GlossaryMode.tsx)
(`GlossaryBand`, `VisitorGlossaryBand`, `useGlossaryMode`),
[`src/web/useGlossary.ts`](../../src/web/useGlossary.ts),
[`src/web/annotate.ts`](../../src/web/annotate.ts) § `termMarks`, and `§ glossary mode` in
[`src/web/styles/glossary.css`](../../src/web/styles/glossary.css). Tests:
[`tests/glossary.test.ts`](../../tests/glossary.test.ts).

What every band shares rather than the Glossary alone — the waiting and empty states, what a visitor
sees, the checklist for changing a band — is in [mode.md](mode.md) and
[web-client.md § The waiting state](web-client.md#the-waiting-state).

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
whole change there was one line in `App.tsx` (in
[`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) since 2026-09-06) — `chatting` became
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

Stage 5d produces the `glossary` artefact (`data/<slug>/glossary.json` until 2026-09-05). It is in `STEP_ORDER` and **not** in
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

### The run row: Find more, or Write a new list

> There used to be a Find More button in Glossary mode. Add it back, at the top of the column
>
> — Greg, 2026-10-02 (spya-s660yh)

> In glossary, there's a find terms again button. I don't know what that does. I want a find more
> button that finds a bunch more.
>
> — Greg, 2026-10-04 (spya-try2v7)

The owner's one run button is the band's **first row**, above *Look up a term*, on every finished
list. It was the band's foot until 2026-10-03, and hidden there on an outdated list. Its press is
always the forced run, in the list's own profile setting (`more(profiled)`), but the forced run does
not always append: `existingFor` merges only when the article and the profile match and the list's
prompt version is one today's prompt may add to. So the button is labelled by what it will do —
**Find more** when it appends, **Write a new list** when it rewrites — and the glossary read says
which: `panelRun` on `GET /api/glossary/:slug`, from `panelRunKind` in
[src/glossary.ts](../../src/glossary.ts), computed in the route beside `profileChanged` because the
profile half needs the reader's current profile.

**The command bar presses this button too, since 2026-10-04** — *Glossary › Find more*
([reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar)). The row is
drawn only when the read says `panelRun: "append"`, and the band makes the press, through the same
`more(profiled)`, only if a fresh Find more is what the row is offering then: no job — on a job
list asked for after the press, not the one the tab already had — no
*Starting…*, no failure, no forced run waiting for its list
(`glossaryFindMoreOffered` in [find-more.ts](../../src/web/find-more.ts); the run row's own first
branch reads its `freshRunOffered`). It never presses *Write a new list*. **An absent `panelRun` is
where the two part**: for an older cached response the button's label falls back to
`stale || outdated`, which cannot see a changed profile, and may say *Find more*; the command treats
no verdict as no.

**An appendable list an older prompt wrote is added to, since 2026-10-04**
([261004f](../plans/261004f-glossary-find-more-always-adds-across-prompt-versions.md)). Until then
the version had to be the current one, the prompt was bumped five times in eight days, and so on
most of the shelf the one button replaced the list under a label (*Find terms again*) Greg could not
read. `appendableVersion` is the rule, in one place for the run and the label: `glossary/4` up to
the current version. Below 4 the code cannot safely establish both facts: version 1 has another
entry shape, while version 2 and some version 3 lists used the old `sourceHash`; version 3 was not
bumped when that hash changed, so its stamp cannot distinguish the two. Above the current version,
an older build must not add to a newer build's list. The list is stamped with the current version
afterwards, because that stamp is what the store checks a write against and what lets an unforced
run skip, and `oldestVersion` on the artefact records the oldest prompt an entry came from, so the
stamp does not vouch for the older entries.

**What that gives up:** a prompt improvement no longer reaches an appendable old list through this button.
Its older entries stay as they were written, beside new ones, and nothing in the client rewrites an
appendable list whose article and profile have not changed. That was already so for a current list
since *Start again* went ([below](#there-was-a-start-again-beside-it-and-it-went)). *Hide* takes an
entry off the reader's own view.

**The rewrite that is left says why, on screen**: under *Write a new list* is one sentence (the
article, the profile or how we write glossaries has changed, so this replaces the list; terms you
added are kept). A tooltip alone was not enough: a touch screen never shows one. And **a *Find
more* that found nothing says so** (*No more terms worth adding turned up*), from `lastAdded` on
the artefact, as Quotes does.
That includes the case `profileChanged` leaves out on purpose: a list written for a profile the
reader has since **cleared** is run plainly, so it rewrites. A rewrite keeps the terms the reader
added (they are outside the document) and, when the article has not changed, the ids of terms it
finds again under the same name; a
term it does not find again goes, with whatever was attached to it, and the tooltip says so. The
stale banner says the article has moved and leaves the button to this row.
[261003c](../plans/261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md).

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
stopped being true once the band grew a term count and the threshold row grew *n of m*, both of which
move when a pass lands and both of which are the number the reader was actually waiting for. It went
on 2026-09-05 — [above](#there-was-a-start-again-beside-it-and-it-went). It is still on the artefact
and in the export.

**The same day, the same line went from everywhere else it was shown to a reader**, on Greg's *"also
do the same for Quotes (and any other modes as needed)"*: the quotes panel's foot
([`src/web/QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx) § `Foot`) and the dashed chip in the
reading view's controls that held the tree's version
([`src/web/reader/Reader.tsx`](../../src/web/reader/Reader.tsx)). Those were the only three. Two survivors, both
deliberate: [`src/web/Metadata.tsx`](../../src/web/Metadata.tsx) § `StageRow`, which is where an
owner is *meant* to look, and the thread's *"Written by …"*
([`src/web/Tweets.tsx`](../../src/web/Tweets.tsx)), which sat at the foot of the Tweets band (a page of its own until 2026-09-29) and since
2026-10-01 is in the band's (i) with every other mode's ([mode.md](mode.md) § Every band has an (i)); it carries
when and how long as well, and reads as a byline rather than as a build stamp. ⟨Fable⟩

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

Four things in it are not obvious:

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
- **Between two words, a space and a hyphen are the same thing**, since 2026-10-02: each interior
  run of whitespace or hyphens (`-`, U+2010, U+2011) in a form matches any run of either, so
  *delayed win-shift task* finds *delayed-win-shift task*. Greg's report found one block of six for
  that entry (spya-n04d5p). **Not the en dash**, which is the range dash (*1990–2000*), and not a
  hyphen against nothing (*e-mail*/*email*), which would mean matching inside words. The separators
  are made canonical **before** the dedup and the longest-first sort, or `alpha----beta` could sort
  ahead of `alpha beta gamma` and win a match it should lose. The cost: *co-op* matches *co op*.
  [261002c](../plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md) § 1.

**Both reads match again, every time.** `entry.blocks` is worked out when the list is written, so
a matcher fix used to reach a glossary only when somebody pressed *Find more*. Since 2026-10-02
the owner's read (`loadGlossary`) and the public one each recompute every entry's blocks against
the blocks they already hold, through one helper,
[`src/glossary-occurrences.ts`](../../src/glossary-occurrences.ts) — stale or not, because on a
stale list an empty `blocks` already says nothing (`occurrencesFitTheArticle`).

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
  dotted rule alone (`mark.term` in [`styles/annotations.css`](../../src/web/styles/annotations.css)); the wash moved to the
  pressed one. **And then a little louder again** on 2026-10-01 — 2px at 70% rather than 1px at
  45% — because [cross-references](cross-references.md) had arrived as a heavier dotted line and
  Greg could not tell the two apart, and wanted the glossary the more prominent (spya-sxvq2j,
  [261001r](../plans/261001r-reading-time-line-gets-a-rich-card-and-grows-lighter-cross-references-quieter-than-the-glossary.md)).
- **Being selected had to stop meaning "having a mark"**, because everything has one now. It means a
  *different* mark — `mark.term[data-term-open]`, which is exactly what the open comment and the pressed
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
  else to bring it in. (A completion announced by this tab's engine after the reader left the band
  is heard by the read itself — `useStepFinished`, src/web/useCitations.ts § An always-mounted read
  is not an always-fresh read.) So the rule is not "fetch once" — it is that **`status` never goes back to
  `loading` for an article it has already answered for**. Moving to a *different* article does
  reset it, deliberately: that is a list nobody has yet.

### The hover card

Point at an underlined term and its entry appears — name, what the author means by it, what you need
to bring to it, the web answer if somebody has already asked for one, and a way into the band.
[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx).

**It is one card with several sections, not the glossary's card**, and it has been since the
footnote markers joined it: a term, a footnote in full, a link described, and — since 2026-09-16 — a
work the piece cites ([citations.md](citations.md)). A phrase that is two of those draws two
sections, which is why the machinery below is written against `<mark>` elements in general rather
than against `mark.term`.

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
- **The keyboard's road is G, not the card.** A mark takes no focus, so a keyboard reader reaches a
  term's entry by pressing G on its paragraph: the band opens on that term's row, focused and
  expanded, and the prose does not move. It calls the same `onOpenTerm` as the card's foot button
  and is mounted beside the card for that reason. The rules are
  [keyboard.md § G, the one letter](keyboard.md#g-the-one-letter).
- **A mark carrying two terms commits to neither.** Where two entries overlap the same phrase the
  card draws both, because which matched the longer phrase is not something the mark records. A
  second tap there does nothing and leaves the reader the two named buttons.
- **An owner's card has *Dig deeper* and *Hide*** too, since 2026-10-02, in the foot beside *Open glossary* (one row since 2026-10-03; they were a row under it).
  Greg: *"We have a 'Dig deeper' in Glossary mode. Add that to the in-text glossary tooltip."*
  (spya-p09u4s). *Dig deeper* starts the same lookup the band's button does, opens the band on that
  term (through `openTermInGlossary`, which lowers the threshold if it would hide the row) and
  closes the card, so the answer streams into the row where the wait, the draft and a failure are
  already drawn; it is disabled, with the band's sentence, while any dig runs or on an unquoted
  term. That works because the lookup's state lives on `useGlossaryRead`, not the band — closing
  the band no longer disowns a running dig. *Hide* is [below](#hiding-an-entry); the card closes
  only once the write has landed, and says a refusal on a line of its own. A visitor gets neither:
  `termActions` is the owner's read and a visitor has none. Both are plain buttons, so a finger
  reaches them the way it reaches *Open glossary* — a tap inside the card is left alone.

## Hiding an entry

> Give me a way to hide a Glossary entry (e.g. because I know it already, and/or it keeps showing
> up too much). … I can't decide whether it should just hide (for me) or delete (for everyone, e.g.
> for a public article). Let's go with Hide for now.
>
> — Greg, 2026-10-02 (spya-yqfzkm)

**For the owner, on their own article.** A hidden entry has no underline (so no card and no G), no
row in the band, no part in its counts, sorts or threshold, and no chip on Skim's stop cards; a
`?term=` naming one is cleared in every order. It is listed under a collapsed **Hidden (n)** at the
foot of the band, each with *Unhide* — the undo for a mis-tap. The entry itself is untouched: chat
and the glossary export still see it, because a hide is a preference about the screen, not a
judgement that the entry is wrong.

- **One visible list**, defined once — `shownEntries` in
  [`src/web/glossary-shown.ts`](../../src/web/glossary-shown.ts) — and used by Reader's `terms`,
  the band, and [`stop-card.ts`](../../src/web/stop-card.ts). A hidden entry leaking into any one
  of them would be the hide working on one surface and not the next.
- **Stored** in `glossary_hidden_entries` (`article_id`, `entry_id`), keyed on the entry id, which
  *Find more* keeps — so a hide outlives a top-up and a new revision. Owner-only through
  `articleIdForOwned`; `PUT`/`DELETE /api/glossary/:slug/hidden/:entryId`, both idempotent, and a
  `PUT` refuses an id the current glossary does not have. `loadGlossary` attaches `hidden: true` at
  the read seam, as it attaches `lookup`, so the public payload — which never calls it, and copies
  field by field — cannot carry it. Exported beside reading time.
- **Pessimistic on the client**: the button waits, the write is awaited, then the list is read
  again. An optimistic flip could be overwritten by a GET already in flight.
- **The trash button is a sibling of the row's button**, never inside it; *"Hide — only for you"*.
- **Deferred, by name**: delete for everyone; a visitor hiding terms on someone else's public
  article (that needs a reader id that is not the owner); swipe to reveal the trash can.

[261002c](../plans/261002c-glossary-hide-an-entry-dig-deeper-from-the-card-hyphens-match-spaces.md)
§§ 2–3, and GPT Sol's plan review beside it.

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

The only place `kind` shows is a small icon beside the name — a person, a place, an organisation, an
event or a work, each with its meaning as a tooltip
([`GlossaryKindIcon.tsx`](../../src/web/GlossaryKindIcon.tsx)). It was a word until 2026-09-29, when
Greg asked what *work* meant and whether the words were worth their space; `concept` lost its mark
then, because the prompt never says how a concept differs from a term
([260929a](../plans/260929a-compact-glossary-header-and-kind-icons.md)).

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

### Written for somebody outside the field

**Added 2026-09-26** (`glossary/5`), from SPIDERYARN-READING2-44. Greg: *"the glossary as well
especially should explain in simpler language."* An entry that defines one hard word with four more
is accurate and useless — `glossary/4` defined *mutual information* as *"a symmetric, undirected
measure of statistical dependence"*. The WRITING rules now name the reader (curious, well-read, never
studied this field), forbid a second lookup, lead with the plain meaning, allow a one-clause example
— from the article in `senseHere`, the model's own only in `background` — and say plainer means
equally specific. Two new worked BAD/GOOD pairs carry the register and the field boundary, for the
reason the section above gives. The concept-allusion pair was added in round-2 review after
`after-6` still put the ordinary meanings of *Müller-Lyer illusion* and *pareidolia* in `senseHere`;
`after-7` and `after-8` reran it, but ordinary definitions still landed in `senseHere` as often as
under the old prompt. The bump marked every owner's older glossary *outdated*, which at the time
drew the *written by a different version* banner as the migration; since 2026-09-29 that banner is
gone and an outdated glossary is not announced — Greg, SPIDERYARN-READING2-55
([260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md)). It also hid
*Find more* on such a list, because its run would replace rather than append; that hid the button
on most lists, Greg's included, and since 2026-10-03 the button is back, at the top of the band,
labelled for what it will do — [§ The run row](#the-run-row-find-more-or-write-a-new-list).
[260926a](../plans/260926a-plainer-summaries-and-glossary.md).

### Name the thing, not the topic

One guard added after watching the first run: the model came back with **"JFK speechwriting"** and
**"MLK plagiarism controversy"** — the person fused with what the article says about them. That is
not a fussy naming preference. Occurrences are matched on the name and its aliases
([`term-match.ts`](../../src/term-match.ts)), so a composed name is a name that **appears nowhere in
the article**, and those two entries only found their blocks because `JFK` and `MLK` happened to be
aliases. The prompt now names both as examples of what not to do, and the re-run gave
*John F. Kennedy* and *Martin Luther King Jr.*

### A cited work is not a term

> It looks as though there is at least one glossary item in this article that's actually a paper,
> Saha et al. I don't think the glossary should include citations. That's what citations are for.
>
> — Greg, 2026-10-03, spya-zn97q5

The prompt invited it: *"works … named without introduction"* earn entries, and a paper cited as
"Saha et al." is one. Since `glossary/9` the prompt draws the line at **cited against discussed**. A
work the piece only points at as a source, and its authors where they are named only as that
citation, is not meant to get an entry or be an alias; [Citations](citations.md) lists them. The
test the prompt gives is the name's job in the piece: only there to say where a claim came from, or
something the reader needs to know to follow it. A person the piece tells about, and a work it
examines, still get entries, and a person it both tells about and cites keeps theirs. An idea a
cited paper introduced gets an entry only under a name the piece itself uses for it.

The alias half matters as much as the entry half: an alias is what the prose underlines, so
`Turner (2001)` as an alias of a real term put a glossary underline on a citation.

Behind the prompt, `citesByEtAl` in [`src/glossary.ts`](../../src/glossary.ts) drops any model
entry or alias containing a word followed by "et al". That guarantees the reported "Saha et al."
shape; a standalone entry named "et al." survives, but a longer real phrase containing it can be a
false positive. Author-and-year forms are left to the prompt: code cannot tell "Stenhoff (1999)"
from "Blade Runner (1982)".

**What it does and costs**, measured in
[261003g](../investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md): on a
review paper dense with citations, entries named for a cited book went from four runs in five to
none in fifteen, and confirmed citation aliases from six to two. Five author-shaped candidates were not
classified, so two is a lower bound, not the total residual rate. The list is about two entries
shorter there, and now and then much shorter. The small essay samples showed no clear regression,
but were too small to call unchanged.

A term the reader [looks up themselves](#looking-a-term-up) is not filtered: that is their request.
A list written before `glossary/9` keeps its citation entries until its step next runs
([Staleness](#staleness-and-the-force-cascade)); **Hide** removes one meanwhile. Plan:
[261003o](../plans/261003o-glossary-keeps-cited-works-out-citations-are-not-terms.md).

<a id="checking-a-term-on-the-web"></a>

### Digging deeper into a term

`background` is the model's memory. **Nothing in the batch call is checked against anything**, and
the `url` it sometimes offers is a guess at a canonical page rather than a page it visited. So the
open entry carries a **Dig deeper** button (*Check the web* until 2026-10-01), and pressing it adds
a separate answer, from a forced web search, beside the remembered one:

```
POST /api/glossary/:slug/:id/lookup   →  SSE: delta…, then done { entry } | error
                                         (~20–30 s: a forced search, then the answer)
```

**One action in three modes, since 2026-10-01.** The button used to say *Check the web* and leave the
searching to the model, which on anything it thought it knew chose not to. Asked about that:

> - Well, if it says "Check the Web", then it always should.
> - That said, there's an argument for saying something like renaming it to investigate further that
>   would use a bigger model and might not check the web. But I'm inclined to say that, yeah,
>   actually, let's rename it to investigate further or go deeper or something like that and say that
>   it always checks the web and always use a bigger model and maybe even uses the tool that we
>   (should) have, I hope, for searching other documents in the library, and perhaps drawing
>   on/referencing them.
> - And let's consider if there are any other places in other modes that have an equivalent to
>   investigate further or go deeper. And in all of those cases, so if somebody's found something and
>   they're like, yeah, I want to know more about this particular thing, that it should use a bigger
>   model.
>
> — Greg, 2026-10-01

There were three such places, and they are now one action, **Dig deeper**: this button, a comment's
re-ask (*Search the web* until then — [comments.md § pushing back](comments.md#pushing-back)) and
Citations' *Investigate* ([citations.md § Dig deeper](citations.md#dig-deeper-a-closer-look-at-one-work-on-demand)).
Glossary and Citations say *Digging deeper…* while it runs and *Dig deeper again* over a kept
answer; a comment hides the button while it runs and keeps calling the re-ask *Dig deeper*. The
shared half is [`src/dig-deeper.ts`](../../src/dig-deeper.ts) — steps 1 and 2 below and the model;
step 3 is the glossary's and a comment's, and Citations' is
[its own](citations.md#dig-deeper-a-closer-look-at-one-work-on-demand). A press:

1. **Runs a web search, forced by code rather than left to the model.** `searchFirst` makes one
   quick-tier call (the `dig-deeper-search` job) with `tool_choice: "required"` and the Exa engine,
   and keeps the pages it returns. It is a separate call because the answer's model cannot be forced
   to search — the probes are in the plan's § How the search is forced. A search step that reports
   no search, or no count at all, stops the press with `[dig-no-search]` before the answer is asked
   for, because an answer from memory under a *from a web search* label is what this exists to end.
2. **Looks in the reader's other articles.** The same call writes a keyword query, run through
   `librarySearch.searchLibrary` — owner-scoped, free, and literal. Best-effort: nothing found is an
   answer, and a failure there does not fail the press. The answer names such an article by its
   title; it cannot link to the passage yet.
3. **Answers on the high-power model** (glossary and comments; Citations hands the findings to
   `investigatePart` and streams `citation-investigate`), `DIG_DEEPER_MODEL`, whatever the article's
   [High-powered AI](high-powered-ai.md) switch says and whatever `SPIDERYARN_EXPLAIN_MODEL` is set
   to (the `dig-deeper` job). The findings go in the last user part, after the cache breakpoint,
   fenced as untrusted text; the cached prefix is byte-identical to a plain explain's, and the model
   keeps its own search tool and may search again.

The searches the answer reports are the search step's plus its own, and its sources are both sets,
deduped. That is why the tooltip says the sources are what it **found**, not what it cited: a
plain-text answer cannot say which ones it leaned on. A glossary or comment press measured at about 2.4× a first explain
on a cold article and 4× on a warm one; the figures are the plan's § The cost line, and it has an
allowance, [below](#the-allowance-dig-deeper-has-and-look-up-does-not). The probes, the design and
GPT Sol's two reviews are
[261001p](../plans/261001p-dig-deeper-one-action-always-searches-bigger-model.md).

**Why Opus, measured: it stays, decided 2026-10-02.** 261001p chose Opus because Greg asked for a
bigger model; an eval then put eleven others against it on six hard presses, with the search frozen
and three judges from three families. Opus had the highest quality point estimate; GPT-6.1 Sol came
close at about 58% less a press and 7 seconds sooner, but shorter and shallower, and six presses could
not separate the two.
"Luna writes, Opus checks" saved under 1% and added 14 seconds, so it is dropped.

> Q-dig-deeper-model I was tempted to switch to Sol, but let's go with your recommendation and keep
> Opus for now.
>
> — Greg, 2026-10-02

The ~$7 production-shaped Opus-vs-Sol check was not run. The numbers, the models that failed, and
what would reopen it are
[investigation 261002a](../investigations/261002a-dig-deeper-answer-model.md).

**Look up** — the typed box, [below](#looking-a-term-up) — is not Dig deeper and did not change: it is
a first question about a phrase rather than a second look at an answer, so the model still decides
whether to search, on the article's own model. The link hover card stays search-free on purpose
([links.md](links.md)).

**The answer streams, and `done` means stored** — since 2026-09-10
([plan](../plans/260910g-stream-glossary-answers-as-they-arrive.md)), on the same helper and reader as
[the box below](#it-streams-and-only-a-finished-answer-is-an-answer). The refusals are still JSON
before the stream opens; after it, the words arrive drawn as *arriving…*, and only the `done` frame —
written **after** the save succeeds — puts the lookup on the entry. So:

- **A save that fails after the words arrived is an `error`**, never an answer drawn as kept. The
  converse is not promised — a save can succeed and its read-back fail, or the socket die between
  the save and the frame — so **the client reads the list again after any failure**, and if the
  answer was kept after all, the entry shows it.
- **A cut-off answer is not saved.** The endings `explainStream` keeps for a comment — the token
  ceiling (`[gl-cut-off]`), the provider's filter — are refused here, because a truncated answer
  stored once is served as whole to every later visit.
- **Leaving does not cancel it.** Unlike the box, which stops the paid call when the reader goes,
  this finishes and saves: the panel says *"You can carry on reading — the answer is saved against
  this term either way"*, and that has to stay true. The client only stops reading.
- **A term removed while its answer streams is accepted, not refused.** Lookups are keyed by entry id
  with no foreign key to the entry (deliberately — ids survive merges), so the save succeeds and the
  merge does not put a stale entry back. A glossary rebuild can replace the list while the lookup
  runs; the panel then says the answer was saved but its term is no longer shown.

**Its answers live apart from the glossary, keyed by entry id** — one row per `(article, entry)` in
Postgres ([`src/store/pg-lookups.ts`](../../src/store/pg-lookups.ts)) — never inside `glossary.json`.
Until 2026-09-05 there was a second, file-backed half too: `data/<slug>/glossary-lookups.json`,
written and read by `saveLookup` and a serialised queue in
[`src/glossary-lookups.ts`](../../src/glossary-lookups.ts). That sidecar was deleted along with the
rest of the filesystem store; `loadLookups` survives only as a fixture reader for
`tests/helpers/seed-reader-state.ts`. A lookup is *reader state*, which by this repo's own rule lives
beside the artefact rather than in it; sharing a file with the generating stage would have been
unfixable rather than merely racy, because that stage holds its read across a minute-long model call.
Worse, `glossary.json` is written with a bare `writeFile`, and a truncated one reads as `null` — which
the panel reports as *"Nobody has found the terms for this one yet"*, the whole glossary gone and
nothing saying so. `loadGlossary` attaches lookups at read time, so the panel still just sees
`entry.lookup`.

**It is `explain` with a different selection** — the same function comments use
([`src/explain.ts`](../../src/explain.ts)), handed the dig's findings, with the matching glossary form — the name or an alias — as
the quote and, since 2026-09-04, **the first block of the article that uses it** as the anchor, found by
scanning rather than read out of `entry.blocks`. It was `entry.blocks[0]` and nothing else, which
made a term used in five places uncheckable the moment the first of them changed — see
[The two ways it refuses](#the-two-ways-it-refuses-and-why-they-used-to-be-one) below.
That is not opportunism: our review of the previous version argued a
glossary should be *the same mechanism as comments with a different prompt* rather than a second
system, and this is the first half of that. It also means the article prefix is **cached and shared**,
so a lookup on a piece somebody has already asked a question about is a cache hit — on the same
model: a dig's prefix is Opus's, so on an article whose switch is off the first dig writes Opus's
copy and later digs read it.

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
- **`searches: 0` is drawn, not hidden.** It was a real outcome while the model decided per call —
  "it judged it already knew" — so the globe has an off state saying so. Without that, an answer that
  was never checked looks identical to one that was. A dig cannot produce it any more (`searchFirst`
  refuses a press it cannot show a search behind), but it is still drawn on an entry checked before
  2026-10-01, where *Dig deeper again* sits under it, and on a *Look up* answer, where the model
  still decides. The label says it in plain words — *from a web search*, or
  *no web search — from the model's own knowledge* — since 2026-10-01; it said *checked* and *asked,
  not checked*, and Greg could not tell what the second meant (`spya-puyb6d`,
  [261001j](../plans/261001j-five-small-feedback-tooltips-and-labels.md) § 4).

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

**What is still open:** those entries are arguably the ones a dig would help most — the
remembered answer is all there is — and we refuse them, because `explain` wants a selected passage
and inventing one is a false premise handed to a model asked to reason from it. A dig written
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
[`term-lookup.ts`](../../src/term-lookup.ts), which is *Dig deeper without the dig, with a phrase where the
entry was*: the same `anchorIn` walk, the same `explain` call, the same `safeUrl` filter, drawn by the same
`LookupAnswer` component. One anchor rule, which is the whole argument for that file existing.

**"A tiny bit robust" is [the matching rule](#the-matching-rule-and-why-it-is-its-own-module) and
nothing more** — case, plurals and possessives fold; a misspelling does not. There is deliberately
**no "did you mean…"**, considered and rejected on the day: the matcher gives no typo tolerance at
all to build a ranking on, and the word a reader wants is as often a lowercase idea as a proper noun,
so the article's proper-noun list (`vocabulary-sources.ts` § names, which the plan proposed) would
miss the commonest case while looking confident. A guess here is
[the postmortem's fault](../postmortems/260904c-the-glossary-said-the-term-was-not-there.md) in a
friendlier tone.

**The command bar and chat can send a term here** (2026-10-03): *look up X* in the bar, or a
button in a chat answer, opens the entry when the **visible** glossary has the term, and otherwise
moves to this band and hands the box the term, which makes its one ordinary ask. That move must
**never arm generate-on-open** and never ride in the URL — two paid runs for one press, and a link
that spends — so the term waits in a one-shot, in-memory hand-off, and the row exists only once the
glossary read has settled with a glossary in it:
[`glossary-ask-handoff.ts`](../../src/web/glossary-ask-handoff.ts), held by
`tests/glossary-ask-from-the-command-bar.test.tsx` (one ask, no job).
[reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar).

**The article's own words are what the model is told about**, not the reader's — type *attention
head* at a piece that says *Attention Heads* and the quote is the plural, because that is the text
that is there. A side effect worth having: the reader's own string never reaches the model at all.

#### It streams, and only a finished answer is an answer

Since 2026-09-10 the answer arrives a few words at a time, on the same `sse` helper and `readEvents`
reader as comments and quiz marks
([plan](../plans/260910g-stream-glossary-answers-as-they-arrive.md)). Every refusal below is still
decided **before** the stream opens, so each is still an ordinary JSON 409 with its code; what
comes after is frames — a `begin` saying where the term was found (the article's characters, never
the typed term), the words, and exactly one `done` or `error`.

- **The panel draws the words as unfinished** — the found passage and the text so far, with no
  *checked* line and no sources — and only a `done` frame turns them into the answer. If the stream
  breaks, what arrived stays on screen under the failure's sentence, which says it is not all of it.
- **Three endings `explainStream` accepts are refused here**: the reader leaving, the answer hitting
  its token ceiling (`[gl-cut-off]`) and the provider's filter (`[ai-filtered]`). A comment keeps a
  half-answer because it has a row to put it on; a glossary answer drawn as finished would be a
  claim it cannot back. `refuseUnfinished` in [`term-lookup.ts`](../../src/term-lookup.ts).
- **Typing, another article, or closing the band aborts the request**, which is what tells the
  server to stop the paid call rather than only the frames.
- **A provider refusal is now an `error` frame inside a 200**, not the response's own status: the
  headers go before the provider is asked. The sentence the box shows is the same.

#### The three ways it comes back empty

Three, not one, because the sibling refusal above was one sentence over three causes and a reader
reported it. Each says what was established and what the reader can do about it:

| what was checked | code | what the reader gets |
|---|---|---|
| the characters are nowhere in the piece, not even inside a longer word | `[gl-ask-absent]` | **Ask in chat**, the one surface that may answer from outside the article |
| the characters are there, but never with a boundary on both sides — *axiom* against *axiomatic* | `[gl-ask-part-word]` | try the words as the piece writes them; chat is still offered |
| there is no prose to search at all | `[gl-ask-no-prose]` | **not a claim about the term** — the branch exists so an empty scan cannot be reported as an answer |

**Ask in chat carries the question, and spends nothing.** Pressing it opens a **fresh** conversation
in chat mode with an editable question about the term already in the box — *What does "axiom" mean,
and does it have anything to do with what this article is saying?* — and the caret in it. Nothing is
sent until the reader presses Send; the conversation that was open, and the floating panel's own
draft about a passage, are left as they were.

> fresh
>
> — Greg, 2026-09-11, choosing a new conversation over putting the question into the one already open

The same route has a second sender since 2026-10-04: the button on a Summary paragraph
([summaries.md § Ask about a paragraph](summaries.md#ask-about-a-paragraph-since-2026-10-04)).

Four things it has to get right, each with a test:

- **The term is the one the box sent** — trimmed and normalised (`UseGlossary.askTerm`), not
  whatever is in the input when the button is pressed. The sentence treats it as data, quotation
  marks included: `askAboutTerm` in [`chat-handoff.ts`](../../src/web/chat-handoff.ts).
- **It crosses as a prop, owned by `Reader`**, never the module-level cell `chat-handoff.ts` used to
  be, and never the URL — the question is the reader's text. It carries its article, so a band on
  another article drops it, and `Reader` forgets it the moment the chat band has taken it.
  `ChatHandoff` in [`ConversationModes.tsx`](../../src/web/modes/conversation/ConversationModes.tsx).
- **One conversation under StrictMode**, not two: the band remembers which handoff it took. And the
  arrival rule's latch is spent, so closing the handed-over conversation before the list arrives
  does not produce a new empty one — a test caught StrictMode undoing that latch in the first draft.
- **A visitor has neither the box nor the button.** The door is a model call, and chat is owner-only.

[`glossary-ask-in-chat.test.tsx`](../../tests/glossary-ask-in-chat.test.tsx) drives it through the
whole app; [`conversation-band-handoff.test.tsx`](../../tests/conversation-band-handoff.test.tsx)
counts the conversations minted. The plan is
[260908f § C](../plans/260908f-prioritised-spideryarn-codebase-improvements.md#c-keep-the-glossary-question-when-opening-chat).

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

#### A finished answer adds the term, for the owner only

Since 2026-10-02 ([plan 261002f](../plans/261002f-glossary-add-a-looked-up-term.md)), **a
finished answer adds the term to the owner's own glossary**: a new row, labelled *added by you*,
whose explanation is the answer they just read, and whose underlines appear in the prose. The box
selects the new row and empties itself, because the answer now lives in the row. An answer that
stopped part-way adds nothing. If an entry already names the same words, nothing is added and the
answer says *Already in the glossary* with *Show it*, or *Unhide* if the reader hid that entry. An
article with no glossary yet adds nothing and says so. Getting rid of an added term is the row's
ordinary [Hide](#hiding-an-entry).

It was deferred for a month, for three reasons found on 2026-09-04. Each is answered by **where the
term is stored**:

| The 2026-09-04 reason | Why it no longer applies |
|---|---|
| The glossary is one JSON document, generated and deduplicated wholesale (`article_revisions.glossary`) | An added term is **not in the document**. It is a `glossary_lookups` row with `added_name` set: the name the reader typed, beside the answer that is its explanation. |
| [Find more terms](#finding-more) recomputes and merges the document | It cannot touch a row outside the document. If a later *Find more* writes an entry that names the same words, the model's entry is drawn and the added one is not, and the reader's answer moves to it if it has none of its own. |
| A shared article publishes the whole glossary blob ([`public-reader.ts`](../../src/store/public-reader.ts)) | The public read reads only the blob and never `glossary_lookups`. Added terms are attached at the owner's read seam (`loadGlossary`) and **only the owner sees them**, as with hides. The tooltip says so. |

The answer follows a later model entry; a hide does not. The hide is keyed to
the added entry's id, and carrying it onto a different model entry would leave
*Unhide* deleting the wrong row.

The pieces: `addTerm` in [`pg-lookups.ts`](../../src/store/pg-lookups.ts) (one transaction that
locks the article row, so two tabs adding *attention head* and *attention heads* make one entry)
and [`glossary-added.ts`](../../src/glossary-added.ts), which builds the owner's list for both
the write's "already there" check and the read. Chat's glossary tool lists an added term by name
with a note that the reader added it, and not the answer, which can carry web text.

**Every finished look-up adds; there is no separate *Add* button.** The button would have to store
an answer the server had already sent and forgotten — either trusting the client to send it back,
or keeping every answer somewhere pending. If adding everything turns out to be noisy, the cheap
change is a choice made before the call (*Look up* or *Look up and add*), not a pending store.

**Still not built:** publishing an added term with a shared article, which needs a decision about
the public projection; removing one outright rather than hiding it.

<a id="the-allowance-dig-deeper-has-and-look-up-does-not"></a>

**Dig deeper has an allowance; Look up still has none.** Since 2026-10-01 every Dig deeper press —
this panel's and a comment's, which share one — takes the `dig-deeper` allowance
(`DIG_DEEPER_RATE_POLICY` in [`src/dig-deeper.ts`](../../src/dig-deeper.ts): so many an hour and a
day per reader, two at once, and a global fuse across every reader a day). It is taken after every
refusal that costs nothing and before anything that does, so a refused press is an ordinary JSON 429,
or a 503 carrying `[dig-resting]`, and changes nothing. Citations' Dig deeper keeps its own allowance
([citations.md](citations.md#dig-deeper-a-closer-look-at-one-work-on-demand)); a comment's first
answer, the tick-box, spends none.

**This box has no rate limit, no quota and no single-flight guard.** So **an owner with one article
of their own can drive paid `explain` calls as fast as they can post**, each of which may run up to
`MAX_SEARCHES` web searches (`src/explain.ts`). Ownership decides *which* article, not *how many* requests;
`withSpendAttribution` records the spend rather than authorising it; and this request never enters
the job queue, so the queue's concurrency cap is not a limit on it. Raised by GPT Sol's review of the
built code, 2026-09-04, and in
[`260904_1301`](../user-feedback/260904_1301-glossary-search-box-for-a-term.md); Greg's answer, two
days later, was that the account-level monthly cap is enough for now
([ai-gateway.md § What stops a reader spending our money](ai-gateway.md#what-stops-a-reader-spending-our-money-and-what-does-not)).
The stored counter that would bound it now exists — the allowance Dig deeper takes — so giving this
box one is a policy and a bucket, not a new mechanism.

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

**What it does now, for a `glossary/1` list, is refuse and inherit the ids.** The rewrite regenerates
the prose; `idsByTerm` gives a fresh entry the id the old list used for the same
name or alias, so `?term=` links and stored lookups survive a rewrite that the sentences do not. Names
are display; ids are identity.

**That refusal covered every older prompt until 2026-10-04; now it covers only the versions outside
the appendable range.** From `glossary/4` on the entries are the same shape, the "certified rather
than replaced" argument above does not apply: no label on an older entry lies, though its register
and the policy that selected it may differ. The list is added to —
[§ The run row](#the-run-row-find-more-or-write-a-new-list).

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
been shaped to avoid. Its starting value was a guess, `0.30`, which on `data/writes` left two terms
of eleven on screen; since 2026-09-15 it is `0.10`, measured (below).

### The threshold, and whose it is

That guess had no feedback loop, which the plan named as the first of two bets. Later the same day
Greg turned it into a control:

> Add a small threshold-slider to the Glossary UI (set to a sensible default)
>
> — Greg, 2026-08-26

So the number is a **starting position rather than a verdict**, `?gate=` carries wherever the reader
moved it, and the last number this feature decided on the reader's behalf is theirs.

**The starting position is `0.10`, lowered from `0.30` on 2026-09-15** at Greg's request that every
prioritised bar let most entries in by default:

> We have a few different modes that involve a prioritized submode with a kind of thresholding.
> Let's set the threshold lower, i.e. more permissive, so that for all of these different modes,
> most of the entries are coming in by default.
>
> — Greg, 2026-09-12

At `0.30` a typical glossary opened on about a third of its terms; at `0.10` the thirteen local
glossaries show 87% on average and all of them on the median one, while the weakest tail is still
held back. The measurement, and the same change to the other three bars, is
[260915d](../plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere.md).

Four things about the slider are decisions rather than details:

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
  `hiddenNote` in [`src/web/threshold.ts`](../../src/web/threshold.ts) writes it for all five
  numeric sliders — this one, Quotes, Search, Citations and the FAQ — and for Debate's two categorical bars.
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

The [run row](#the-run-row-find-more-or-write-a-new-list) is the one button at the top of the
column. Its forced run appends only when `existingFor` accepts the list; otherwise it rewrites.
Each append pass asks for `suggestedCount(words)` more, at most 20, and every pass records how many
entries it added (`lastAdded`).

### Each entry keeps the time it was added

`GlossaryEntry.addedAt`, since 2026-10-03, and the twin of `Quote.addedAt`
([quotes.md](quotes.md)). The list's `generatedAt` is re-stamped by every pass, so without a time
of its own an entry from the first pass could not be told from one the third pass added. Greg,
2026-10-03: *"Store when it happened."*

- **A pass stamps what it adds, once**, with the same clock read as its `generatedAt`
  (`buildGlossary`).
- **The time belongs to the id, not to the name or the prose.** `merge` keeps the incumbent's
  whichever name wins, and a rewrite that inherits an id inherits its time with it (`idsByTerm`,
  `InheritedEntry`). A rewrite after the article's text moved inherits nothing, so those entries
  are new and say so.
- **Absence is kept, not filled.** An entry stored before the field existed has none and never gets
  one — not from a merge with a timed entry, not from a rewrite. It was already there, and the
  list's `generatedAt` is only an upper bound for it.

**It is shown nowhere yet**, and it is in no hash, no freshness check, no dedupe rule and no prompt.
The public projection does not copy it ([`src/public/dto.ts`](../../src/public/dto.ts)). A term the
reader added themselves is not in the document, so it has no `addedAt`; its time is its
`glossary_lookups` row's. [`tests/glossary-added-at.test.ts`](../../tests/glossary-added-at.test.ts);
plan [261003j](../plans/261003j-store-when-it-happened-timestamp-audit.md) § stage 3.

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
- **Some recovery survives**, because `existingFor` refuses to append when the source hash or the
  profile differs, or when the prompt version is outside the appendable range
  ([§ The run row](#the-run-row-find-more-or-write-a-new-list)). An edit, a changed profile or a
  pre-`glossary/4` list therefore
  rewrites rather than appends — and `idsByTerm` inherits the ids, so the reader's `?term=` links
  survive it. (This listed the *use my profile* checkbox too, until the checkbox was removed on
  2026-09-13 — [reader-profile.md](reader-profile.md#no-control-one-label).)

Against that, a destructive button, an inline confirm and a `danger` style sat in a band meant to
stay quiet, on every visit, for an action used roughly never. ⟨Fable, 2026-09-05⟩

**What we gave up, stated plainly**, because the third bullet reads stronger than it is and a
cross-family review said so. Recovery now needs an *input* to change. A bad glossary under the same
article, the same prompt and the same profile cannot be rewritten at all: *Find more* keeps every
existing entry and is forbidden from returning close replacements, the threshold can hide a noisy
entry but cannot correct a wrong definition, and — since the *use my profile* checkbox went on
2026-09-13 — no reader has a checkbox to flip.
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

**Metadata says which, before the press.** Its Glossary row re-runs with the reader's current
profile, so it can rewrite where the panel's *Find more* (which keeps the list's own setting) would
append. `glossaryRunKind`, built on `existingFor`, gives the page that verdict through
`ArticleMetadata.glossaryRun`, and the row says *Find more terms* or *writes a new list* accordingly —
[261001i](../plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md) § 3.

**There is no Undo for a *Find more*, deliberately.** It was designed (the same plan, § 2): restore
the previous revision's list in a new revision, only when the provenance and pass count show the
current one came from one compatible append pass. It was not built. The pass keeps the list and
usually adds terms; deduplication can also refine an existing entry while keeping its id. The
threshold hides noise, Stop is on screen while it runs, and nobody has asked. The design is there
if a reader does.

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
  reusing its length rule — *"one or two short paragraphs is usually right"* — which was tuned for
  [`CommentDialog`](comments.md). Measured in a browser at 1,158 characters against a `background` of
  265: it does not overflow and it is not cramped, but the checked part becomes the bulk of the entry
  and the entry becomes a footnote to it. The fix is a `SYSTEM` of its own, which means lifting the
  transport out of `src/explain.ts` into something both callers share — worth doing, not done, and
  the reason it is worth doing is that the prompt is the *only* part of that file a lookup wants to
  differ on.
- **A term the reader added is theirs alone** — a visitor to the shared article does not see it
  ([A finished answer adds the term](#a-finished-answer-adds-the-term-for-the-owner-only)).
  Publishing it would be a decision about the public projection, not yet made.
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
