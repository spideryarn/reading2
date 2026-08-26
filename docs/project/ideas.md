# Ideas — the propositions this piece needs you to hold

The **glossary** answers *what does this word mean*. This answers *what do I have to understand* —
the ideas an article leans on without stating, and the ideas it puts forward. A mode in the band
between the spine and the prose, beside [Glossary](glossary.md).

Built 2026-08-27. Greg asked for it on 2026-08-26:

> I'm wondering if we should add a new "Mental models" (or just "Ideas") mode, alongside Glossary.
>
> I'm thinking this could be a way to pull out new ideas that the text introduces and/or key ideas
> that the text requires the user to understand.

The design, the alternatives weighed, and the cross-family review that rewrote half of it before a
line was written are in [ideas-mode.md](../plans/ideas-mode.md). **Read that before changing
anything here** — several things this feature does look like fussiness until you know what they are
answers to.

```
  IDEAS MODE — same spine, same article, the band is a short list

 ┌─────────────┬───────────────────────┬────────────────────────────┬───┐
 │             │  Mode: ideas                                        │   │
 │  ▇▇▇▇▇▇▇▇   ├───────────────────────┼────────────────────────────┤ ▍ │
 │  ▇▇▇▇▇      │ 💡 Ideas       3      │  … the most mundane        │   │
 │  ▇▇▇        ├───────────────────────┤    boilerplate — the sort  │   │
 │  ▇▇▇▇▇▇▇    │ WHAT YOU NEED     2   │    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓    │ ▍ │
 │  ▇▇         │ TO BRING              │  ┃ of thing you'd have to  │   │
 │  ▇▇▇▇       │ The piece leans on    │    be able to write …      │   │
 │  ▇▇▇        │ these and never       │                            │   │
 │  ▇▇▇▇▇      │ states them.          │      ↑ the wash and the    │ ▍ │
 │  ▇▇         ├───────────────────────┤        ┃ border — the SAME │   │
 │  ▇▇▇▇▇▇     │ Failing at trivial    │        marks a search hit  │   │
 │             │ writing proves        │        draws, because it   │   │
 │             │ incapacity, not haste │        IS one              │   │
 │             │ ┌───────────────────┐ │                            │   │
 │             │ │THE IDEA           │ │                            │ ▍ │
 │             │ ││If a person cannot│ │                            │   │
 │             │ ││produce a simple  │ │            ↑ and one lane  │   │
 │             │ ││piece of routine  │ │              down the rail │   │
 │             │ ││writing without   │ │                            │   │
 │             │ ││copying …         │ │                            │   │
 │             │ ├───────────────────┤ │                            │   │
 │             │ │WHY YOU NEED IT    │ │                            │   │
 │             │ ││The inference from│ │                            │   │
 │             │ ││'they plagiarized'│ │                            │   │
 │             │ ││to 'not even half │ │                            │   │
 │             │ ││decent' only holds│ │                            │   │
 │             │ ││if …              │ │                            │   │
 │             │ ├───────────────────┤ │                            │   │
 │             │ │THE MODEL THINKS   │ │                            │   │
 │             │ │THESE PASSAGES     │ │                            │   │
 │             │ │RELY ON IT    ‹1/2›│ │                            │   │
 │             │ │┃"The stuff they   │ │                            │   │
 │             │ │┃ steal is usually…│ │                            │   │
 │             │ │┃ The 'which means'│ │                            │   │
 │             │ │┃ step skips from …│ │                            │   │
 │             │ └───────────────────┘ │                            │   │
 │             ├───────────────────────┤                            │   │
 │             │ WHAT THIS PIECE   1   │                            │   │
 │             │ ADDS                  │                            │   │
 │             │ Ideas you could carry │                            │   │
 │             │ out of it …           │                            │   │
 ├─────────────┴───────────────────────┴────────────────────────────┴───┤
 │ ⊞Contents ▤Summary 📖Glossary 💡Ideas ● 🔍Search ⌸Chat  …              │
 └───────────────────────────────────────────────────────────────────────┘

 The heading over the passages is the whole of "this is a hypothesis". An
 assumed idea is BY DEFINITION not in the article, so "assumed in" would
 claim the passages say something they do not.

 The solid left rule is the article's; the dotted one is the model's. Those
 are the glossary's own two classes, reused rather than re-declared — they
 ARE the provenance treatment, and a second panel drawing that distinction
 differently would teach the reader it means something else.
```

Code: [`src/ideas.ts`](../../src/ideas.ts) (stage 5f — the prompt, the call, the validation),
[`src/web/IdeasPanel.tsx`](../../src/web/IdeasPanel.tsx),
[`src/web/useIdeas.ts`](../../src/web/useIdeas.ts),
[`src/web/BlockNav.tsx`](../../src/web/BlockNav.tsx) (the ‹ › stepper, shared with the glossary),
`resolveIdea` in [`src/web/search-hits.ts`](../../src/web/search-hits.ts), `IdeasBand` in
[`src/web/App.tsx`](../../src/web/App.tsx), and `§ ideas mode` at the end of
[`src/web/styles.css`](../../src/web/styles.css). Tests:
[`tests/ideas.test.ts`](../../tests/ideas.test.ts).

## The unit is what is new, not the provenance

The glossary already splits by provenance: `senseHere` is what the author means, `background` is
what you bring. Both halves of Greg's question were already there — **for terms**. What was missing
is the other axis.

|  | INTRODUCED by the piece | ASSUMED by the piece |
|---|---|---|
| **TERM** — a word you look up | `senseHere` | `background` |
| **IDEA** — a proposition you hold | "what this piece adds" | "what you need to bring" |

**The test that separates the rows: can you say it as a proposition?** A term is a noun phrase and
the answer to it is a definition. An idea has a claim shape, and the answer is a sentence you could
carry to a different article and use. That test is in the prompt, and it is also the answer to *why
not just widen the glossary* — [the plan](../plans/ideas-mode.md#why-this-is-not-a-wider-glossary)
has the three things that break if you do.

## The occurrence is where you NEED it, not where it is said

The one design decision the whole feature turns on.

An **introduced** idea is easy: quote the sentences that state and develop it.

An **assumed** idea is not in the article. That is the definition. So there is nothing to quote — and
a model asked for a quote anyway will either return nothing or invent one. The prompt asks a
different question for it: **quote the passages that would stop making sense without it.** That is a
real, checkable location; the reader presses it, lands on the sentence, and judges for themselves
whether it does lean on the idea.

```
   introduced   →  "where is this said?"        →  quote the statement
   assumed      →  "where would I be stuck?"    →  quote what presupposes it
```

Both come back as the same shape, so nothing downstream branches.

### It is a hypothesis, and the panel says so

**A block id proves the passage exists. It does not prove the author assumed anything.** A confident
sentence with a real anchor beside it reads as though it did — which means an assumed idea can
launder the model's own reading of a piece through the article's own ids. That is worse than a wrong
glossary entry, because the machinery around it looks like evidence.

So the heading is *"the model thinks these passages rely on it"*, not *"assumed in"*. The
[label-not-badge](glossary.md#provenance-is-the-label-not-a-badge) rule, applied to the half of this
feature that needs it most. GPT Sol's finding, reviewing the plan.

The counterfactual also has to be **bounded**, or the model satisfies the wording with *"institutions
shape behaviour"* — true of almost any text, needed by none of it in particular. So each occurrence's
`reasoning` must name the **local inferential move**: what the passage claims, what connection fails
without the idea, and why *this* idea rather than general background knowledge supplies it.

## This is the first stage that lets the model name block ids

Every other artefact that points into the article computes its pointers itself. A glossary entry's
`blocks` come from matching the term's own text, so the model is never shown an id and **cannot**
invent one. An idea has no name to match, so the ids come back from the model — which means this
stage runs the *other* discipline, the one [`src/search.ts`](../../src/search.ts) already had:

| Dropped when | Counted as |
|---|---|
| the `blockId` is not in `blocks.json` | `unknownIds` |
| `findQuote` cannot locate the quote in the block the model named | `unquoted` |
| more than six occurrences on one idea | `truncated` |
| a name, a statement or a usable provenance is missing | `malformed` |
| **every** occurrence of an idea failed | `unanchored` |

`findQuote` and not a string compare, because it is the rule the *browser* will use to draw the
marks. If the server's idea of "is this quote in this block" differed from the client's, the panel
would list a passage and the article would show nothing marked — the failure
[`quote-match.ts`](../../src/quote-match.ts) exists to prevent.

**An idea with no surviving occurrence is dropped, which is the opposite of the glossary's rule.** An
unmatched glossary entry is still a definition you can read, and its emptiness is a signal worth
seeing. An idea with no occurrence is a claim with no evidence and no way back to the page, which
[principle 4](vision.md#principles) refuses. `unanchored` is **the number to watch**: a run that
starts returning several is the model naming topics instead of finding load-bearing propositions, and
nothing else would report it.

## Freshness: the two holes this stage does not inherit

Every other stamped step compares three values — the blocks, the prompt version, the model. This one
compares four, and both differences close gaps the others still have.

**The tree, as well as the blocks.** `StepStamp` in
[`src/store/artifacts.ts`](../../src/store/artifacts.ts) has said since it was written that the late
stages read both, and that `inputHashFor` hashing only the blocks would bite. It bites hardest here:
the prompt shows the model the **skeleton before the article**, precisely so it judges what the
argument rests on rather than what the piece says most often. Re-cut the sections and that judgment
was made against a different question, while every block is byte-identical.
`inputFingerprint` is `hashBlocks` + `structureHash`, and `structureHash` moved into
[`src/source-hash.ts`](../../src/source-hash.ts) to sit beside its sibling — the same move
`hashBlocks` made out of `tweets.ts`, for the same reason.

**The profile, in the stamp rather than merely recorded.** Other artefacts record a `profileHash` and
the read path shows a banner; nothing makes the step re-run. For a glossary that is arguable — a
profile changes which terms are worth an entry. Here it changes what *"assumed" means*: a physicist
reading a physics essay brings everything it assumes, and the same essay for a lay reader is three
ideas deep before its first argument. A list written for another profile is answering a different
question, not an older one. `StepStamp` grew a `profileHash` field for this; **only stages that opt
in are affected**, because `sameStamp` compares the keys the *expected* stamp declares.

## No append, and therefore no pagination

The glossary paginates because an article can hold an encyclopaedia of terms and their **output**
length caused a production outage. A piece has three to ten ideas. So:

- one call, `suggestedIdeas(words)` = one per ~800 words, clamped 3–10 (half the glossary's density —
  asking for more does not produce weak entries a reader can skip, it produces *themes*);
- at most six occurrences per idea;
- **running the step again replaces**, which is why there is no `DELETE /api/ideas/:slug` and one
  button rather than the glossary's three. "Find them again" *is* start-again.

That deletes a whole class of the glossary's complexity: no FORBIDDEN checklist, no `existingFor`, no
`passes`, no "a stale list is not appended to".

**Ids are still inherited across a regeneration, and the promise is weaker than the glossary's.**
`idsByName` matches on the normalised name, which works there because *"United States of America"*
comes back spelled the same way twice. An idea's name is a sentence and a regeneration will
paraphrase it. So a `?idea=` link survives an unchanged name and nothing more — a deliberate stopping
point, because **inheriting an id wrongly is worse than minting a new one**: a link that lands on
nothing is a dead end the reader can see, and one that lands on a *different* idea is a dead end that
looks like it worked.

## Drawing it: the third arm of one pipe

[`search-hits.ts`](../../src/web/search-hits.ts) already described itself as *two matchers, one
downstream* — a literal word search and a meaning search both resolve into one `Found[]`, and
everything after that reads only `Found`. Ideas is the third.

```
   words matcher  ──┐
   meaning search ──┼──►  Found[]  ──►  hitMarks    ──►  the prose
   ideas          ──┘                   blockHues   ──►  the paragraph bar
                                        blockMatches ─►  spineMarks ─► the rail
                                        orderFound  ──►  the list, and ‹ ›
```

So the whole of the highlighting cost **one function**, `resolveIdea`. There is no new `MarkKind`
and no new colour token: `hitMarks` hard-codes `kind: "hit"`, so a fourth kind would have cut ideas
*out* of the pipe it is trying to join.

`resolveOne` was extracted from `resolveHits` rather than copied, because the `whole` fallback rule
has [already been got wrong here once](search.md#what-a-hit-is-anchored-to) in exactly the way a
second copy invites.

Three things to know:

- **`confidence` is `null`.** A search hit's confidence answers *is this what you asked for*, and
  nobody asked the article a question. `null` is what a literal word-match already carries, so the
  threshold, the ordering and the wash all know what to do with it.
- **An idea takes a real palette slot.** Not for the rail — lanes key on the *run id*, so an idea
  gets its own lane whatever its slot — but for the **paragraph bar**, which deliberately drops null
  slots. A null-slot idea would paint the rail and leave the bar blank.
- **Search and Ideas do not share `found`.** See below; this is the bug that would have shipped.

### The two states, and the race that made them two

`SearchBand` pushes results into `Reader` from a **layout** effect and clears them from a **passive**
unmount cleanup. Both are deliberate and both are commented. Point an `IdeasBand` at the same state
and switching search → ideas does this:

```
   commit: SearchBand unmounts, IdeasBand mounts
     ├─ IdeasBand's LAYOUT effect     → passages written   (before paint)
     ├─ ...paint...
     └─ SearchBand's PASSIVE cleanup  → passages wiped     (after paint)
```

Passive cleanups flush after paint; layout effects run before it. The outgoing mode tidies up on top
of the incoming one and **nothing errors**. It does not happen between glossary and search today only
because those two clear different state. So there are two states and one `mode` test —
`const passages = mode === "ideas" ? ideaFound : found` — and everything downstream reads that one
expression. GPT Sol found this in the plan, before it was written.

## Prev / next, in both modes

Greg, 2026-08-26: *"There should also be a way in both Ideas and Glossary modes to jump to prev/next
exemplifying block"*. [`BlockNav.tsx`](../../src/web/BlockNav.tsx) is that, in both.

- **It does not wrap**, because `stepComment` in [`comment-nav.ts`](../../src/web/comment-nav.ts)
  does not, and two steppers three inches apart behaving differently on the same gesture is worse
  than either rule alone.
- **Stepping nudges; selecting jumps.** Pressing an idea, or a result, is *arriving somewhere*, so it
  always moves — *"I pressed it and nothing moved"* is the complaint that makes a list feel broken.
  Stepping ‹ › is moving between neighbours, so it leaves you alone when the next one is already in
  front of you. Those are the comment stepper's rule and the search result's rule respectively, and
  both were already written down.
- **The glossary can key it on block ids and ideas cannot.** `findOccurrences` pushes each block at
  most once, so a term's ids are unique; an idea's occurrences are quoted passages and two can sit in
  one paragraph, so that side keys on `Found.key`.
- **No key bindings yet.** ↑ / ↓ belong to the article ([keyboard.md](keyboard.md)) and the band has
  no focus story — the same gap that has kept the glossary's term list un-navigable.

## Two bugs found by running it rather than by reading it

Both are worth keeping, because both looked exactly like something else.

**The prompt asked for block ids against a renderer that omits them.** `articleText` deliberately
renders bare prose with no ids — *"an id in the prompt is an invitation to put one in the answer"* —
which is right for the arc, the thread, the glossary and the summary. Ideas wants pointers into the
piece, so it needs `articleWithIds`. With the wrong one, every occurrence was dropped as an invented
id and the stage reported *"the model returned no ideas"*. **The model had done nothing wrong.** The
failure message now names its four counts, which is what would have made it a five-minute diagnosis.

**And the fix broke the cache grouping.** `sharesArticleCache` grouped stages by
`STAGE_EFFORT` alone, on the (previously true) assumption that every article-reading stage sent
identical bytes. Ideas sends different ones, so grouping on effort would have marked the article on
an `arc` run because ideas was queued behind it — paying the 1.25× write premium for a read that
cannot happen. `ARTICLE_RENDERER` in [`src/models.ts`](../../src/models.ts) is the second table, and
`sharesArticleCache` now reads both.

## Where the bans relocate to

The glossary's hardest-won lesson is that **a prompt ban relocates a register rather than deleting
it**, so the prompt bans the describes-the-page voice in *both* prose fields explicitly and carries
four negative examples rather than one — a universal truth, a glossary term, a theme, and an
interpretation *compatible* with a passage but not *required* by it.

One relocation was found by running it. The first version handed back **the article's own analogy**
as the model's own: Paul Graham's essay compares writing to preindustrial physical strength, and the
model offered exactly that under *"one way to picture it"*. It read perfectly well and credited the
model with the author's thinking. The prompt now says so in as many words, and the field went empty
on the re-run — which is the right answer.

## What this deliberately does not do

- **No difficulty or centrality scores, and no threshold slider.** The glossary needs triage for
  twenty-four terms; six ideas do not, and a gate over six items invents a ranking that is not in the
  data — the failure `PRIORITY_GATE` was made absolute rather than relative to avoid.
- **No per-idea web check.** The glossary's is for `background`, which is unverified real-world
  memory. An idea's statement is a claim about *this article*, which the occurrences already let the
  reader check.
- **No multi-select in the rail.** One lane, for the selected idea. Every piece needed for several at
  once is there — real slots, packed lanes, per-source keys — so it is one control away.
- **It does not stream.** It goes through the job queue with `JobProgress`, exactly as glossary and
  summary do. Not a new exception; it joins an existing one, tracked in
  [streaming-the-slow-two.md](../plans/streaming-the-slow-two.md).
- **No cross-artefact dedup against the glossary.** Feeding the glossary's terms into this prompt
  would make `ideas.json` depend on `glossary.json`, and **the staleness check cannot see that** —
  a hidden input staleness cannot see is a bug nobody can diagnose. The two are kept apart by the
  prompt's unit rule and nothing else; visible overlap is allowed.

## What is still open

- **Which half is actually earning its place.** `introduced` is the redundant half but the
  **checkable** one — read the idea, read the passage, decide. `assumed` is the distinctive half and
  the **weakly falsifiable** one. On `data/writes` the assumed ideas were genuinely good (it caught
  the essay's undefended leap from *"they plagiarised boilerplate"* to *"they cannot write"*); on the
  8,283-word noema piece the split was 2 assumed to 8 introduced, so the valuable half is scarce on
  longer articles. **That ratio is the thing to watch.**
- **No eval file yet.** The judging so far is two articles read by hand, written up in
  [the plan](../plans/ideas-mode.md). A scored pass under [`evals/`](../../evals/README.md) is what
  would turn that into a number the next prompt change is compared against.
- **Nothing generates ideas for the committed `example/` fixture**, so the panel there offers a
  button that writes into `data/`. The same gap the glossary and the thread page have, and equally
  unsatisfying in all three.
- **`resolveIdea`, `BlockNav` and the two-state fix have no tests.**
  [`tests/ideas.test.ts`](../../tests/ideas.test.ts) covers the stage's deterministic half only.
- **Quote-copy failures are real but rare** — 3 of ~30 occurrences on the noema article. Those fall
  back to washing the whole paragraph and saying so, which is the right behaviour, but the rate is
  worth watching.

## See also

- [glossary.md](glossary.md) — the sibling mode, and where the provenance-as-label treatment, the
  id-inheritance rule and the register traps all come from
- [search.md](search.md) — the marks, the fallback, the rail, and the two rulers
- [reader-profile.md](reader-profile.md) — why "what you need to bring" is the case the profile is
  really for
- [summaries.md](summaries.md) — the other axis on the same material, and the thing this has to stay
  distinct from
- [block-ids.md](block-ids.md) — why an occurrence is a block id and never an offset
- [url-state.md](url-state.md) — `?mode=ideas`, `?idea=`
- [architecture.md](architecture.md#pipeline) — where stage 5f sits
- [ideas-mode.md](../plans/ideas-mode.md) — the plan, the alternatives, and the review
