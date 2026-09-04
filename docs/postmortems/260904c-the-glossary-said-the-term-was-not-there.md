# The glossary said the term was not there

A reader pressed **Check the web** on a glossary entry and was told the term did not appear in the
article, while the entry sat on the screen in front of them.

> I tried to use the glossary check the web option, but it said that the phrase in the glossary when
> I was checking didn't exist even though it clearly did, because there was a glossary entry for it
> and I can see it right there on the page.
>
> — a reader, 2026-09-04, on `xanadu-spya-ueuvaf`

Reported as `[SPIDERYARN-READING2-X]`. Fixed the same day.

## What they actually saw

```
"Neural replacement thought experiment" does not appear in this article,
so there is no passage to check it in. Find the terms again if the article has changed.
```

That sentence reaches the panel verbatim — `look()` in
[`useGlossary.ts`](../../src/web/useGlossary.ts) catches the 409 and renders `err.message` inside
the selected entry's own row. So the reader read *"X does not appear in this article"* under a
heading that said **X**, next to X's definition, and drew the only available conclusion: the app was
denying the entry it had just drawn.

**Reproduced**, not inferred: `lookUpTerm("noema-mythology-of-conscious-ai", "spya-ca30dv")` against
the local Postgres store, on a real article ingested by the real pipeline, produced that sentence
character for character before any model call.

## The root cause

Not the sentence. The sentence is a symptom of a decision recorded in a comment, in
`13246a7` (2026-08-26, *"Rewrite an outdated entry instead of certifying it"*):

> Refused rather than anchored somewhere arbitrary. **Three ways to get here and they are all the
> same fact** — this term is not in this text: the model named words the article does not use, or
> the glossary is stale and its block ids no longer exist, or the block exists but no form of the
> term is in it.

They are not the same fact, and the reader is the proof. They are three:

1. **The article never quotes the term.** `entry.blocks` is empty. The model named a person or a
   debate the piece alludes to and never spells out — *"Conway's Game of Life"*, *"scaling laws /
   scaling curves"*. Permanent, and **ordinary**: 5 of the 141 glossary entries in the local corpus
   on 2026-09-04. Nothing the reader can do, and the panel already said so a few lines further down.
2. **The glossary no longer fits the article.** It names block ids the article no longer has.
   Repairable, by one button — *Start again* — which the sentence never mentioned.
3. **The text moved under the glossary.** The block survived; the sentence naming the term did not.
   Same repair as 2.

Collapsing them cost three separate things:

- the reader was given a sentence that contradicted what was on the screen, in case 1;
- the reader was not told to press *Start again*, in cases 2 and 3;
- and **whoever the reader reports it to cannot tell which fired**, because the sentence carried no
  code. That is not hypothetical — it is what this investigation actually spent its time on.

A second cause sat underneath, and it is why case 2 was reachable at all in a healthy article.
The anchor was `entry.blocks[0]` **and nothing else**, so a term used in five places became
uncheckable the moment the *first* of them was re-extracted or edited — while the other four sat
underlined in the prose beside the panel.

### The class: **collapsed diagnosis**

*Several causes that call for different actions, refused with one sentence — so the sentence cannot
be true of all of them, and nobody downstream can recover which one fired.*

The tell is a comment arguing the cases are "all the same fact". They are the same fact **to the
code** — there is nothing to anchor to, so return — and the code is not who the sentence is for. The
sibling in this repo got it right and says why:
`GlossaryResponse.stale` and `GlossaryResponse.outdated` are two flags rather than one, because
*"the article moved underneath these terms"* is not *"the article is the same and we would write
these differently now"* ([glossary.md](../project/glossary.md)). Same shape, opposite call, three
weeks apart.

**Two lesser classes rode along**, both worth naming:

- **The brittle first match** — deriving something from element zero of a list of equivalent
  candidates, so the whole feature is as fragile as whichever one happened to sort first.
- **A carried fact read as a current one.** `entry.blocks` was measured against one extraction and
  is copied into every revision after it. Asking it a question about *this* article and answering
  with confidence is the mistake, and it is the one the first draft of the fix repeated — see below.
  The repo has the machinery to avoid it and was not using it: `stale` exists precisely to say *this
  artefact was measured against a different article*.
- **A doc that aged into a wrong answer.** [glossary.md](../project/glossary.md) said the lookup was
  *"waiting on the Postgres store seam"*. True in August, about *streaming*, and by September it read
  as *lookups are files-only* — which is what the product review of this report proposed as the
  cause. It was wrong: [`pg-lookups.ts`](../../src/store/pg-lookups.ts) has been wired since the seam
  landed. Half an hour went to refuting the doc. Fixed in the same change.

## The fix

**Server** ([`term-lookup.ts`](../../src/term-lookup.ts)):

- `anchorIn` asks **the article**, not `entry.blocks`: the first block that uses the term, under
  `term-match.ts`'s rule. On a list that fits its article that is `entry.blocks[0]` exactly, since
  `findOccurrences` walks the same blocks in the same order under the same rule.
- When the article uses it nowhere, **staleness chooses the sentence**: `[gl-not-quoted]` when the
  list fits the article, `[gl-stale]` when it does not. Both 409, as before. That staleness is
  computed here with `isStale` over the glossary and the article actually in hand, not read off
  `GlossaryResponse.stale` — which closes the two-read race below rather than working around it.
- **Neither sentence names the term.** The failure renders inside that entry's own row, so the name
  was already on screen — repeating it is what turned a refusal into a denial.

**Copy** ([`messages.ts`](../../src/messages.ts) § glossary): both sentences moved into the one file
that holds reader-facing copy, with codes. That goes **against** copy.md's *a refusal that is an
answer gets no code*, deliberately and on this bug's own evidence — recorded in
[copy.md](../project/copy.md) for Greg to rule on.

**Panel** ([`GlossaryPanel.tsx`](../../src/web/GlossaryPanel.tsx)): *Check the web* is **disabled**
for an entry the article never quotes, where it could only ever have failed, and the `gloss-nowhere`
sentence beneath it gained the clause that says why. Marked, not hidden. Both are gated on
`occurrencesFitTheArticle` — the same question the server asks, phrased so that *not knowing*
withholds the claim instead of licensing it, which is what `stale ?? false` had been doing to
visitors.

Verified in a browser on 2026-09-04, twice: the disabled button and the new sentence on the first
shape, and then — after the freshness gate went in, on an article that turns out to be stale — the
button live and the sentence gone, with the stale banner carrying the honest message instead.

### What the first draft of this fix got wrong

Worth recording, because it is the same class again and a cross-family review caught it rather than a
test. The first version kept `entry.blocks` as the source of truth: empty meant *the article never
quotes this term*, and the anchor was the first **recorded** occurrence that still stood.

**An empty `entry.blocks` is not evidence about the current article.** A glossary is *carried* into
every new revision (`glossary: "carry"`, [`pg-revisions.ts`](../../src/store/pg-revisions.ts)), so a
carried entry says "used nowhere" about whichever extraction the list was written for. Read as a
claim about the article on screen, that is the reported bug one revision along — the words underlined
in the prose, and the app saying they are not there — and the first draft made it in three places at
once: the 409, the disabled button, and the `gloss-nowhere` sentence. Scanning the article and
reading `stale` removes the inference entirely rather than qualifying it.

**The two-read race was almost waived, and did not need to be.** `loadGlossary` and `loadArticle`
are two reads and `articles.current_revision_id` can move between them, so a lookup can hold
revision A's glossary and revision B's blocks. The first answer was to hedge the copy and record the
hole; the second review pointed out that a hedge does not make `[gl-stale]` true of a pair nothing
compared. It did not need a change to the reader contract: `isStale` is a pure function over a
glossary and an article, so computing it here — on the two objects in hand — makes the answer true
of whatever was actually returned. The lesson generalises: **a flag that describes one read is not a
fact about a second read**, and where the rule is a pure function, applying it to what you are
holding beats carrying the answer across the seam. ⟨Sol, twice⟩

**Three drafts of one sentence, all reviewed, all wrong in the same direction** — claiming more than
was checked. *"The passage it points at is no longer there"* (false when the block survived and the
words did not), *"no longer uses this one where the list says it does"* (false when the list says
nowhere, which is the commonest shape this branch meets), and, on the other message, *"it names the
idea rather than quoting it"* (one cause of three — a bad alias set and an invented entry are the
others). The scan establishes exactly one thing: no name the glossary holds appears in the piece.
Copy that diagnoses beyond its evidence is the same fault as the original bug in a friendlier tone.

### The fix that is right for the long term

The one above is right as far as it goes, and there is a further one it does not reach.
**A refusal should be a value, not a sentence.** `lookUpTerm` throws an `Error` with a `status`, and
everything downstream — the route, the client, this postmortem — has to recover the branch by
reading English. A discriminated union (`{ refused: "not-quoted" } | { refused: "stale" }`) resolved
to copy at the edge would make *collapsed diagnosis* a compile error rather than a comment:
you cannot return one member of a union for three reasons without saying which. `src/messages.ts`
already has the shape half-built — `FailureKind` is exactly this idea applied to model calls — and
the reason the code carries the kind at all is that a stored job is a struct with room for a field
and a stored *sentence* is not. This seam has room. Nothing forced the point until now.

## What would have caught it

Ranked by ease × value.

1. **A code on the message** (done, ~10 lines). It would not have prevented the bug, but it converts
   *"it said the phrase didn't exist"* into `[gl-stale]` or `[gl-not-quoted]`, and this whole
   investigation into a grep. Cheapest thing on this list by an order of magnitude, and the only one
   that helps with faults nobody predicted.
2. **A test per branch of a refusal, matched on the code**
   ([`glossary-lookup-refusals.test.ts`](../../tests/glossary-lookup-refusals.test.ts), done). The
   old assertion was `/does not appear in this article/` — it pinned the wording of the very sentence
   the reader could not read, and would have gone red for the *fix*. A refusal with three causes had
   one test. Writing one case per cause is what makes somebody ask whether one sentence can be true
   of all three. Two mutations were watched red before this was believed: `stale` ignored in the
   refusal (kills both stale cases), and the anchor read out of `entry.blocks` again (kills both
   carried-glossary cases).
3. **Read the refusals against real data, not fixtures.** The audit that produced *5 of 141* is
   forty lines over `spideryarn.article_revisions.glossary`, and it turns "can this happen?" into a
   number. Every refusal in the app would benefit from being asked how often it fires; none of them
   is.
4. **A rule about naming the subject back at the reader.** *"X does not appear"* rendered inside X's
   own row is a category of copy fault — the message repeating the thing the reader is looking at,
   so a statement about the article reads as a statement about the entry. Worth a line in copy.md if
   a second instance turns up; not worth a lint rule for one.

## Deliberately left

- **An entry the article never quotes still cannot be web-checked.** Arguably it is the case that
  most *wants* checking — the remembered answer is all there is. `explain` wants a selected passage
  and inventing one is a false premise handed to a model asked to reason from it, so making this
  work is a product decision, not a bug fix. Named in
  [glossary.md](../project/glossary.md#the-two-ways-it-refuses-and-why-they-used-to-be-one) as open.
- **A visitor is now told nothing about an entry with no occurrences**, where before they were told
  the words did not appear. Their payload carries no freshness and deliberately cannot, so `false`
  was licensing an unverifiable claim of exactly the reported kind. Withholding it costs one
  sentence; Greg can reverse it with one boolean.
- **No client test for the disabled button, or for the freshness gate on it.** The owner's panel needs
  `useGlossary` and a fetch double to mount; it was checked in a browser instead, which is a witness
  and not a regression test. The invariant that matters — the server says the right thing — is
  covered. If somebody re-enables the button, the honest 409 is what they get.
- **The two-read revision race** above. Hedged in the copy, not closed.
- **The production article was not read.** `xanadu-spya-ueuvaf` is not in any database this box can
  reach, so which of the three branches that particular reader hit is unknown. Both are fixed, so it
  does not change the work.
