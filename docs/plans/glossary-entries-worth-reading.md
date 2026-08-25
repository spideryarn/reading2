# Glossary entries that tell you something

**2026-08-26.** The glossary ([glossary.md](../project/glossary.md)) lists the terms an article uses
in a non-obvious way. Greg looked at one of them — Leslie Lamport, in Paul Graham's *Writes and
Write-Nots* — and it was this:

> **Leslie Lamport** *person*  ·  d 0.60  c 0.50
> Computer scientist quoted for the line 'If you're thinking without writing, you only think you're
> thinking,' which the article uses to argue writing and thinking are inseparable.
> also: Lamport
> ⚠ Goes beyond what the article says.
> used in `z7zzwv`

> it's pretty weak! It adds almost nothing to the user's knowledge of Leslie Lamport, nor does it add
> any useful explanatory gloss to help understand the article itself. […] And "Goes beyond what the
> article says" is vague/confusing - either be clearer, or indicate in the glossary entry itself
> clearly (e.g. with tooltips or highlighting) which bits are/not from the article. And provide web
> citations (e.g. clickable links with hover-tooltips for sources) if we're using the web.
>
> — Greg, 2026-08-26

Fable was asked for ideas and tradeoffs before anything was built, and this plan is largely its
design. Where it differs, it says so.

## The entry is not the model being lazy. It is the model obeying the prompt.

This is the finding the whole plan rests on, and it was Fable's:

> The prompt conflates two different jobs — *what the author means by a term* and *what the author
> assumes you already know* — and forces the second into the shape of the first.

`SYSTEM` in [`src/glossary.ts`](../../src/glossary.ts) says *"The gloss says what THIS AUTHOR means,
in this article"*, and warns the model off writing *"an encyclopaedia entry that happens to be
adjacent to it"*. For a term the author **bends** — a coinage, an ordinary word narrowed — that is
exactly right, and it is why the rest of the list is good.

For an **allusion** it is unanswerable. The article does not *mean* anything by Leslie Lamport; it
quotes him. Asked what the author means by the name, the only article-grounded sentence available is
a description of the quotation — so that is what the model wrote. And a description of the
quotation is *a description of a page the reader is looking at*.

Two consequences worth stating separately, because they land in different places:

1. **Search was never the missing piece.** The model knows perfectly well who Lamport is — Turing
   Award, LaTeX, Paxos. The prompt told it not to say. A glossary that searched the web would have
   produced the same entry.
2. **`fromOutside` fired on an entry containing nothing from outside.** The badge is a boolean over
   a blob, so it has no way to say *which two words*. Here it had nothing to point at at all.

## 1. Two fields, and their names are their provenance

`gloss` / `detail` / `fromOutside` become **`senseHere`** and **`background`**. At least one must be
present; **most entries need only one**.

| field | what it holds | where it comes from |
|---|---|---|
| `senseHere` | what *this author* means by the term, where the surrounding sentences do not give it to you | the article, and only the article |
| `background` | what the reader has to bring *to* the piece — who this person is, what this work is, what the term ordinarily means | the model's own knowledge, declared as such |

A coinage of the author's usually needs only `senseHere`. A person named without introduction
usually needs only `background`. A borrowed term the author bends needs both.

**The closed row shows `senseHere` if it is there, and `background` if it is not.** That one line is
what makes the design self-correcting: told to leave out a `senseHere` that would only restate the
page, the model writes background-only for Lamport — so the informative sentence is the one you see
first, without the panel having to know what kind of term it is.

**No branching on `kind`.** Tempting, and rejected: kind is a proxy and it leaks both ways. A concept
can be an allusion (*Paxos*, *the Great Divergence*) and a person can be fully introduced by the
article. The prompt states the principle and uses kinds as examples.

### The prompt

The `DEFINING FROM THE PIECE` section is replaced by `WHAT AN ENTRY SUPPLIES`, whose first paragraph
is the whole fix:

> The reader has the article in front of them. Never spend an entry describing what the article does
> with a term — "quoted for the line…", "the author's example of…", "used to argue that…" are all
> descriptions of a page the reader can already see, and an entry made of them adds nothing. An entry
> exists to supply what is NOT on the page.

with `LEAVE THIS FIELD OUT rather than restate the page. An absent field is a real answer` on
`senseHere`, and *"pick the two or three facts that make THIS article's use of it land … a biography
is padding"* on `background`.

And **one worked example, using this exact failure**, because the failure is a *register* the model
falls into and a negative example is the strongest guard against a register. The bad entry is the
real one, quoted verbatim; the good one says Turing Award, distributed systems, LaTeX, and why the
line is worth borrowing.

The `not an encyclopaedia entry adjacent to it` line **stays**, and this is worth being careful
about, because it is the line that caused the bug. It is a **selection** rule — do not give an entry
to a term the piece does not depend on — and as a selection rule it is right and load-bearing. What
went wrong is that its spirit leaked into the *content* rules. So it stays where it is, under
`WHAT DOES NOT`, and the new "two or three facts that make this article's use land" sentence is what
scopes the content.

### Rejected: keep the fields, just add "for a person, say who they are"

It would fix Lamport. The model knows who he is; knowledge was never missing. But it leaves both
registers blended inside one field with one boolean over the blend — which is precisely what makes
the provenance question below unanswerable. The split buys both with one change.

### How this most plausibly fails

**Models like to fill every field.** A weak `senseHere` ("quoted for the line…") reappears and
retakes the closed row. The all-caps instruction and the worked example are the guard. If it does not
hold, the cheap lever is preferring `background` on the closed row for `person`/`work`/
`organization`/`event` — a UI change, not a regeneration. We are starting without it deliberately, so
that we find out.

## 2. Provenance is structural. `fromOutside` goes.

A flag over prose is the model **reporting about** its own text. A field is the model **writing into
a contract**, and models are far more reliable at putting content into a labelled slot than at
tagging their own sentences afterwards. So the open entry renders two labelled sections, and the
label is the answer to *which bits are and are not from the article*:

- **in this piece** — `senseHere`. Its check is already built and already one click away: it sits
  directly above *used in* and the block links under it.
- **background** — `background`, captioned *"The article doesn't say this — it's the model's own
  knowledge."* The `url`, when there is one, moves **inside this section**, because checking the
  background is what a canonical link is for.

**The ⚠ goes.** Warning styling treats outside knowledge as a hazard, when for an allusion it is the
entire product. The panel already reserves alarm for an actual failed check — *"These exact words do
not appear in the article"* — and that is the right place for it.

**"From outside the article" and "from a web search" are two different axes**, and they stay two. The
first is provenance (article, or model) and the field split carries it. The second is verification
(checked, or remembered) and the presence of citations carries it — §3. An unchecked `background` is
honest about being unchecked by having no sources row.

### Rejected: marking the outside bits inline

Greg's own suggestion, and the one thing here that goes against what he asked for, so the reasons had
better be good. There are three:

1. **Reliability.** A model tagging its own sentences will misattribute some, and a wrong inline tag
   is invisible and uncheckable — there is no action a reader can take on one highlighted clause.
2. **Mechanics.** Inline marks mean markup inside stored strings, which means a restricted renderer.
   [glossary.md](../project/glossary.md) records *"`detail` is plain text, deliberately"* as a
   security stance ([security.md](../project/security.md)), and this would reverse it for a marginal
   gain.
3. **Reading.** Stippled two-colour text in an 18rem band is noise.

And sentence granularity buys little over field granularity, because a well-written entry separates
the two registers into different sentences anyway. The field split *forces* that separation instead
of trying to detect it after the fact. The labelled sections answer "which bits" exactly: all of this
one, none of that one.

### How this most plausibly fails

**Misfiling.** Article material landing in `background` is harmless — it under-claims the article.
The bad direction is an outside fact landing in `senseHere`: a hallucination wearing the "in this
piece" label. It will happen sometimes. The block links under it are the check, one click away.
Fable also floated a server-side heuristic — do `senseHere`'s rarer content words appear anywhere in
the article's blocks? — feeding the same log line as `unmatched`. Untested, written down as a
direction, not built today.

## 3. The web: on demand, per entry, never in the batch

**The batch call stays memory-only.** A "check this on the web" action on an open entry runs a small
separate call that searches, and its citations are stored on the entry.

The case against searching in the batch call is four things, and the first is decisive:

- **Search would not have fixed the entry that started this.** See above. Spending money and minutes
  on a mechanism that was never the missing piece is the wrong first move.
- **Latency, on a call already shaped by an outage.** The glossary is one call over the whole
  article, capped at `BATCH_SIZE` and paginated *because output tokens caused 504s in the previous
  version* ([original-version/glossary.md](../project/original-version/glossary.md) § Bug one).
  Twenty entries with the model choosing per entry could serialise a dozen searches, on a call whose
  only progress signal is a character count.
- **Cost scales with the article, and need is sparse.** Most entries are concepts the author bends,
  where a search adds nothing.
- **The citations would not attach to anything.** `url_citation` annotations attach to spans of the
  response text, and the response is one JSON blob. Mapping citation → entry means trusting the model
  to self-report the mapping, or re-deriving it. Both are fragile.

*(The one counter worth recording: the model could report `sources` per entry and we could keep only
those URLs the search tool actually returned — turning a claimed source into a verified one. That is
a real design and it solves the mapping objection. It does not solve the other three, and it is
written down here in case the on-demand shape turns out to be the wrong grain.)*

**Reader-initiated fits the grain of the product.** The whole stance of this app is that the reader
decides where effort goes — the glossary is generated on demand, the summary ladder's free rung
works before anybody has paid for a model call, and search mode defaults to the free matcher. And it
moves toward the convergence [glossary.md § What is still open](../project/glossary.md#what-is-still-open)
already records — *a glossary should be the same mechanism as comments with a different prompt* —
rather than adding a third system: same transport, same `Citation` type, same badge convention.

The shape:

- `POST /api/glossary/:slug/:id/lookup` runs an [`src/explain.ts`](../../src/explain.ts)-style call
  through OpenRouter with the `openrouter:web_search` server tool. That path's citation parsing and
  its `server_tool_use_details` / `server_tool_use` fallback are already written and already
  battle-tested; the Anthropic SDK's own `web_search_20260209` would mean a second, unshared set of
  parsers for the same job.
- The result is stored as its own object — `lookup: { answer, citations, searches, model, at }` —
  **rather than being merged into `background`**, so the provenance of the original stays clean and
  *checked* stays visibly different from *remembered*.
- Sources render as host-name links (`hostOf`) with the page title in a **Floating UI hover tooltip**
  — [`src/web/Tooltip.tsx`](../../src/web/Tooltip.tsx), already used by ten components — which is
  exactly what Greg asked for, sized for an 18rem band.
- The globe badge follows [comments.md](../project/comments.md)'s convention, but **only on entries
  that have been looked up**. Comments draws the *absence* of a search deliberately, because there
  the model chose per question; here a constant "not searched" on every entry would say nothing.

### Rejected: search in the batch for a subset

Only persons and works, or only high-difficulty entries. Better than blanket search, and still wrong:
it keeps the latency and the citation-mapping problem for exactly the longest entries, and it spends
money on entries nobody will open.

### What it turned out to be, once built

**The lookup is `explain` with a different selection** — not a call *like* it, the same function.
That was not the plan's design (it said "an explain-style call") and it is better than the plan's
design, for three reasons that only became clear with the code in front of us:

- **The prompt already asks the right question.** `SYSTEM` in [`src/explain.ts`](../../src/explain.ts)
  tells the model to supply *"the term of art, the named person, the debate being alluded to"* — which
  is what a glossary reader wants — and its `WEB RESEARCH` section already says to search unless
  genuinely sure.
- **The article prefix is cached, and shared.** A lookup on a piece somebody has already asked a
  comment about is a cache hit rather than a fresh read of the whole article.
- **It is the convergence, rather than a description of it.**
  [glossary.md § What is still open](../project/glossary.md#what-is-still-open) has carried *"a
  glossary should be the same mechanism as comments with a different prompt"* since the feature
  landed. This is the first half of that paid off in code rather than in a note.

The term's **name is the quote**, and that is honest rather than a trick: the entry earned its place
because the article uses those words, `findOccurrences` proved it, and `entry.blocks[0]` is a block
they appear in. "The reader has selected this passage" is literally true.

Run against the entry that started all this, it took **10.5 seconds**, ran **one search**, and came
back with a real cited source and this:

> Leslie Lamport is a computer scientist best known for foundational work in distributed systems (the
> "happens-before" relation, Paxos consensus algorithm) and for creating LaTeX … He won the Turing
> Award — computing's top honor — in 2013 … Graham invokes him here not for the LaTeX or systems work
> but as the source of the aphorism that follows.

### Three things the implementation had to decide that the plan did not

**`searches: 0` is drawn, not hidden.** The model chooses per call whether to look anything up, so an
answer with no searches is a real outcome — *I already knew this* — and it is indistinguishable from
a broken tool unless something says which. The globe has an off state for the same reason
[comments.md](../project/comments.md) gives for its badge.

**Every citation goes through `safeUrl` at the storage boundary**, even though `explain` built them
from the provider's own annotations. This is where a model-supplied URL stops being a value in flight
and becomes a value on disk that the panel puts in an `href` — the same call `converse` makes, and
[glossary.md § Five ways to break this quietly](../project/glossary.md#five-ways-to-break-this-quietly)
item 3 is about exactly this field.

**Two writers, one file, no lock.** The lookup re-reads `glossary.json` after the model call and
re-finds the entry **by id** — a second pass may have merged, renamed or reordered it, and ids are
identity while names are display. That narrows the race to the width of the write rather than the
width of a thirty-second call; it does not close it. Said plainly rather than papered over: this is
last-writer-wins, the loss is one lookup the reader can ask for again, and a term that has *gone*
gets an honest 409 rather than a lookup written back into a list it is no longer in.

### Checked in a browser

All eleven checks pass: the two labelled sections render with the solid and dotted rules that tell
them apart, the (i) caption is reachable by Tab, the sources link shows its page title on hover, the
globe reports *"Searched the web. 1 search on 26/08/2026"*, and **nothing overflows the 18rem band** —
measured with the full 1,158-character answer open, which was the thing most likely to break it.

Two observations worth keeping, neither a failure:

- **The answer is long for the column.** 1,158 characters of checked answer against a 265-character
  `background`. It reads as *long* rather than *cluttered* — the labels and rules keep it legible —
  but the checked half becomes the bulk of the entry. That is `explain`'s length rule, written for a
  dialog, and it is the strongest argument for eventually giving the lookup a `SYSTEM` of its own.
- **No entry in this article has both prose fields at once**, so the busiest possible case — two
  labelled sections *plus* a checked answer — has not actually been seen. Worth looking at on a
  piece with a bent borrowed term in it.

### How this most plausibly fails

**The long tail.** For an obscure person in a niche piece, a memory-only `background` is the
confabulation zone, and the guessed `url` is weakest exactly where it is needed most. The honest
mitigation is the instruction to **leave `background` out when you do not know** — an absent
background is *visible*, unlike a plausible invented one — plus the lookup button being one click
away on precisely those entries. If fabricated backgrounds show up in practice, the next step is
auto-running the lookup where the model omitted `background`, not batch search.

## What happened when it ran

**The fix works, and it works without branching on kind** — which was the part most likely to have
been wishful thinking. Regenerated against the article that started this:

```
writes and write-nots   here: The author's coined split of society into two groups: people
                              who retain the ability to write well and those who lose it
                              entirely, with no middle tier …
Leslie Lamport          bg:   A Turing Award-winning computer scientist known for foundational
                              work in distributed systems and for creating LaTeX. He is often
                              invoked as an authority on rigorous thought, which is why his
                              aphorism about writing and thinking is used here.
```

The coinages came back with `senseHere` and no `background`; the three people came back with
`background` and no `senseHere`. Nothing told the model which kind of term it was looking at — the
`LEAVE THIS FIELD OUT` instruction and the worked example did it. **The fill-every-field risk named
above did not materialise on this article**, which is one article and not evidence that it never
will.

### One thing it broke, and the guard that fixed it

The first run named two entries **"JFK speechwriting"** and **"MLK plagiarism controversy"** — the
person fused with what the article says about them. Almost certainly caused by this rewrite: pushing
the model towards *what the reader needs* pushed it towards topics.

That is not a naming preference. Occurrences are matched on the name and its aliases
([`term-match.ts`](../../src/term-match.ts)), so **a composed name appears nowhere in the article**
and matches nothing — those two only found their blocks because `JFK` and `MLK` happened to be
aliases. A composed name with no lucky alias is an entry with zero occurrences, which is the
`unmatched` failure this stage already counts.

So `NAMES AND ALIASES` gained a paragraph naming both as examples of what not to do, and the re-run
gave *John F. Kennedy* and *Martin Luther King Jr.* Worth recording as a general shape: **a change to
what a field says can move what the model thinks the entry is about**, and the two are further apart
than they look.

## What review caught

Two of the three bullets below were **wrong when this plan was written**, and one of them shipped as
a live data-loss bug before an adversarial review found it. Both are recorded rather than quietly
edited, because the shape of the mistake is the useful part.

### The version bump marked nothing stale

The plan said bumping `PROMPT_VERSION` "makes every existing glossary read as stale, which the panel
already handles". **It does not.** `isStale` compares `sourceHash` and nothing else
([`src/glossary.ts`](../../src/glossary.ts)), and that is the function the read path uses. The
version is checked only in `glossaryIsCurrent`, which is a *pipeline* predicate that never reaches
the panel. So a `glossary/1` list on an unchanged article reported `stale: false`, the banner never
rendered, and the reader was never offered the button that would have rewritten it.

The fix is a **second flag, not a widened first one**: `GlossaryResponse.outdated`, computed at read
time beside `stale`. They are different facts and they need different sentences — *the article moved
underneath these terms* is not *the article is the same and we would write these differently now* —
and folding the second into the first would have made the panel say something untrue.

### "Find more terms" destroyed the list, silently

This is the one that shipped. The plan tightened the append gate to require a version match, so that
a second pass could not hand `dedupe` two vocabularies. Follow what that actually does:

`existing` becomes `null` → `buildGlossary` gets no previous entries → `taken` is empty → **every id
is re-minted**, so every `?term=` link a reader holds goes dead → the file is overwritten wholesale →
`passes` resets to 1, so the log line reads `N terms (N new, pass 1)` and is indistinguishable from a
first run. And because of the bug above, the only button on screen was the one that did it, labelled
**"Find more terms"**.

Textbook [silent success](../reusable/silent-success.md): the operation reported success, and the
check you would naturally run — *did the glossary come back?* — returns yes.

**The gate is gone, replaced by an `upcast`.** The thing it was protecting against was real: `merge`
cannot choose between a `gloss` and a `background`, because they are not the same field. The answer
is to translate the old entries into the new shape *before* they are merged, so there is one
vocabulary rather than a refusal. Nothing is lost, no id moves, and the blend goes to `background`
for the same reason `toEntries` puts it there — `senseHere` is labelled "in this piece", and a blend
under that label would attribute the model's own knowledge to the article.

**What would have caught it:** a test that asserts ids survive a pass. There now is one.

### And what the review got right that this plan had not decided

**The lookup does not go in `glossary.json`.** The plan said "stored on the entry" and that was the
wrong file. `glossary.json` is a pipeline artefact written by one stage with a bare `writeFile` — no
temp-and-rename, no serialisation, because until now it had exactly one writer. A second writer
inherits three failures, and the third is fatal rather than annoying: a crash mid-write leaves JSON
that `readGlossary` swallows into `null`, `loadGlossary` then 404s, and the panel says *"Nobody has
found the terms for this one yet"* and offers a model call. **The reader's whole glossary, gone,
with nothing anywhere saying so.**

The second failure cannot be engineered around at all while the file is shared: the `glossary` step
reads it, spends a minute in a model call, and writes back what it read. No in-process lock helps a
stale read held across a call.

So lookups live in [`src/glossary-lookups.ts`](../../src/glossary-lookups.ts) —
`data/<slug>/glossary-lookups.json`, keyed by entry id, temp-and-rename, serialised, all copied from
[`src/comments.ts`](../../src/comments.ts), which learned each of those the hard way. It also
crosses back over a line the repo had already drawn and this plan had lost: **a lookup is reader
state**, and reader state lives beside the artefact rather than inside it, which is exactly what
`Comment` says about itself.

It buys something too. Ids survive a regeneration by design, so a lookup keyed by id is still
attached to its term after "Find more terms" — where inside `glossary.json` it would have been
discarded by the next run.

## What this costs, and what it breaks

- **`PROMPT_VERSION` goes to `glossary/2`**, and `GlossaryResponse.outdated` is what carries that to
  the reader. See above for why it is not `stale`.
- **The append path upcasts rather than refuses**, so ids and entries survive across the version
  boundary. See above.
- **The panel keeps rendering old-shape entries.** `gloss` / `detail` / `fromOutside` still display
  on artefacts written before today, so nothing blanks while a glossary is stale.
- **`answerTokens` rises** from `600 + count × 260`. A `background` for a person runs longer than the
  glosses it replaces.

## See also

- [glossary.md](../project/glossary.md) — the feature, and the two bugs it is shaped around
- [glossary-prioritised-order.md](glossary-prioritised-order.md) — the other change to this panel
  today, and the scores this one leaves alone
- [original-version/glossary.md](../project/original-version/glossary.md) — the prompt this borrowed
  from, including the outside-knowledge line that became `fromOutside`
- [comments.md](../project/comments.md) — the web-search badge and the citation rendering this reuses
- [vision.md § Principles](../project/vision.md#principles) — principle 4, legible provenance
