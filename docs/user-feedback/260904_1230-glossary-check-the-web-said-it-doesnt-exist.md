# "Check the web" said the phrase doesn't exist, and it plainly did

**[SPIDERYARN-READING2-X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-X)** · reported
2026-09-04 12:30 UTC · resolved 2026-09-04 · *fixed, with a postmortem*

## What the reader said

> I tried to use the glossary check the web option, but it said that the phrase in the glossary when
> I was checking didn't exist even though it clearly did, because there was a glossary entry for it
> and I can see it right there on the page.

## The hypothesis was wrong, and reproducing is how we know

Going in, the leading theory — from a product review, and repeated in this plan — was that glossary
lookups lived in a **files-only sidecar** while production runs on Postgres, so the lookup took a
store branch that found nothing.

**Refuted.** `src/store/pg-lookups.ts` is a real upsert store, wired into `src/store/index.ts`, and
`lookUpTerm` was already keying on the entry id. The line in `glossary.md` that suggested otherwise —
*"waiting on the Postgres store seam"* — is about **streaming**, and had aged into a wrong answer to a
question nobody had asked it. Now fixed, because a stale doc that reads as a live diagnosis costs
more than no doc.

That is the whole argument for reproducing before fixing: a confident, plausible, well-sourced
hypothesis, and the code said no.

## What was actually wrong

`src/term-lookup.ts`, from commit `13246a7`, whose own comment says the quiet part out loud:

> Refused rather than anchored somewhere arbitrary. **Three ways to get here and they are all the
> same fact**…

They are not the same fact. Three different situations were refused with one sentence — `"X" does not
appear in this article` — and `useGlossary.ts` renders that verbatim **inside the entry's own row**.
So the reader was shown a flat denial of the thing he was looking at.

Reproduced against the real local Postgres store on a real pipeline-ingested article:
`lookUpTerm("noema-mythology-of-conscious-ai", "spya-ca30dv")` returns that sentence, character for
character, before any model call is made.

A second and worse contributor: the anchor was `entry.blocks[0]` **and nothing else**, so a term used
in five places became uncheckable the moment the first of them changed.

An audit over every glossary in the local database: **5 of 141 entries** have no recorded occurrence.
Ordinary, not damage — which is exactly why refusing them with a lie was going to happen regularly.

## What shipped

- **`anchorIn` scans the article** rather than reading `entry.blocks` — the first block using any form
  of the term. For a healthy glossary that is `entry.blocks[0]` anyway.
- **Two refusals, not one**, chosen by staleness computed **locally** from the glossary and article
  actually in hand — which closes a two-read revision race rather than hedging it. `[gl-not-quoted]`
  and `[gl-stale]`, and **neither names the term**.
- The panel disables *Check the web* and explains only when we **know** the occurrence list was
  written against this article.

## Believed only after the tests were made to fail on purpose

Five cases watched red before the fix, nine green after — and then **three mutations watched red**:
staleness ignored, the anchor read back out of `entry.blocks`, and `stale` trusted off the response
instead of computed. The old assertion in `tests/term-lookup.test.ts` had been pinning the very prose
the reader could not read.

## Two GPT Sol rounds, and the first one stopped a bad fix shipping

Round one came back *not safe to ship*, correctly: the first draft read an empty `entry.blocks` as
"the article never quotes this" — and the one article it had reproduced on is **stale**, so that
draft would have made exactly the reported wrong claim about exactly that article. Round two found
three more, including a visitor path that defaulted unknown freshness to "fresh".

## The postmortem, and the class

[260904c-the-glossary-said-the-term-was-not-there.md](../postmortems/260904c-the-glossary-said-the-term-was-not-there.md).
Named class: **collapsed diagnosis** — *several causes that call for different actions, refused with
one sentence, so the sentence cannot be true of all of them and nobody downstream can recover which
one fired.*

## Left for Greg to rule on

- **A term the article never quotes still cannot be web-checked**, and that is arguably the case that
  most wants it. It needs its own prompt rather than `explain` with an invented passage.
- **These two messages carry codes, against `copy.md`'s rule** that "a refusal that is an answer gets
  no code". Done deliberately — this bug is the evidence — and recorded in `copy.md` for a ruling.
- **A visitor now sees no explanation** on entries with no occurrences, because their payload carries
  no freshness. One boolean to reverse.
