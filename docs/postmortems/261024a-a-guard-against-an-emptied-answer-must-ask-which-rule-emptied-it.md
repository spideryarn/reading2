# A guard against an emptied answer must ask which rule emptied it

Up: [postmortems.md](../project/postmortems.md)

Report `spya-rvj2p7` (#684, Greg, 2026-10-23). The fix is
[261024c](../plans/261024c-a-failed-optional-step-after-import-reads-as-optional-and-crossrefs-keeps-an-all-nearby-answer-as-empty.md).

## What happened

`effective-expressiveness-spya-z8dehh` imported and published: 9 blocks, 486 words. Publication
queued the main modes, and the `crossrefs` job (`spya-dqbje9`) failed five seconds later. Vercel's
runtime log for `POST /api/jobs/spya-dqbje9/advance` at 2026-10-23T22:07:11Z:

> The model named 3 links and none of them could be kept, so there is nothing to write. Dropped: 0
> naming a block id that is not in this article's body, 3 to their own block or the one beside it,
> …

The cap on a nine-block article is 3. The model offered 3, each to the paragraph beside it; the
`nearby` rule dropped all three; `buildCrossrefs` threw because a non-empty answer had been
emptied. The job card on the home page then said *"Linking the article to itself did not finish …
trying again is worth a go"*, and *Report this* opened on *"This import failed."* Greg, who could
read the article fine:

> I have no idea what that error means, and the article seemed to work, so it's just a very
> confusing message.

## The root cause

The guard "a non-empty answer that validation empties throws" protects against two real dangers:
publishing an empty list over a good one because the model returned something unusable, and a
validator bug (say, our rendered text and the model's disagreeing) passing silently as "no links".

But it counted every drop alike, and drops mean different things. An unknown id or a phrase that
is not in its block is the answer not fitting the article. A phrase of the wrong length or one that
occurs twice is a good relation on an unusable anchor, which a second attempt can repair. A link
to the block next door is neither: the model read the article right, and what it found is not worth
a link. An answer made only of those *is* "nothing worth linking", the `{ "links": [] }` the guard
already accepted. On a short piece the adjacent-block rule covers most of the pairs there are, so
the guard failed exactly the articles with least to cross-reference.

The wording has its own cause: a failed step's message (`STEP_GAVE_UP`, `src/messages.ts`) knows the
step and nothing else, and the card's sentences were written for imports, where a failure may mean
there is no article. A failed automatic-extra job cannot touch the published article (a job publishes
only on `done`), and nothing said so.

## The class

**A guard that treats every reason for an empty result as the same failure.** "Validation removed
everything" is several different facts depending on *which* rule removed it, and a guard that
counts drops without asking what each means will either fail a legitimate empty answer — loudly,
with a Retry that cannot help — or, written carelessly the other way, publish empty over a
misreading. The first draft of this fix did the second: it exempted `length` too, and `length` is
checked before `unquoted`, so a one-word phrase that is not in the block at all would have passed as
"too short" (GPT Sol, plan review). **The order the rules run in is part of what a counter means.**

Its twin on the display side: **a failure message that can say what broke but not what is still
fine**, read by somebody who assumes the worst.

## Which commit introduced it

`97c5c3c0a` (2026-09-30, *Cross-references stage 1: the crossrefs step*), following plan
[260930f](../plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md):
*"Only an explicit `{ "links": [] }` is a valid empty answer … and so does an answer that
validation empties entirely. Nothing is published over a good artefact."* The intent was the safe
one; it did not distinguish between drops. The label *Linking the article to itself* dates from the
same commit.

## The fix

Shipped: `buildCrossrefs` keeps an emptied answer as `links: []` when **every** row was `nearby`, and
throws otherwise. It asks what this call added to the supplied counter, not its lifetime total, so
an earlier call cannot make a new malformed row look all-`nearby`. Right for the long term too, as
long as the rule order stays: `nearby` is checked after `unknownIds` and before everything else, so
an all-`nearby` answer has had its ids checked and its phrases never mattered. The label became
*Adding cross-references*; a failed automatic-extra job's card now says *"The article itself is
unchanged. Only this extra did not finish."*
(`ARTICLE_UNAFFECTED`, `src/job-state.ts`); its report opens *This job failed.*

## What would have caught the class, ranked by ease against value

1. **For each drop counter, write down what an answer emptied by it means — and read it against
   the order the rules run in.** Costs a comment; would have caught both the original and the
   first draft's over-correction. Done, in `buildCrossrefs`'s doc comment.
2. **Test the guard on a short article.** A few-block fixture, where the adjacent rule covers most
   pairs, would have hit this the day it shipped. Done in `tests/crossrefs.test.ts`.
3. **The siblings have the same guard**: `src/faq.ts`, `src/sources-claims.ts` and `src/skim.ts`
   each throw on an answer validation empties. None has failed this way and their rules differ, so
   they are not changed here; the next "none of them could be kept" in the log belongs to this class.
   Not done: changing three working steps on a hunch is the wrong side of *simplest first*.
4. A total `Record<counter, meaning>` map that makes a new counter a red compile — tried in the first
   draft, then dropped with the over-broad exemption: with one exempt rule it is more machinery than
   the one comparison it guards. Worth it if a second rule ever joins `nearby`.
5. A shared "all dropped" helper for every step — rejected. Each step's rules and their order are
   its own, and the meaning of each drop is the decision; a helper would hide it.
