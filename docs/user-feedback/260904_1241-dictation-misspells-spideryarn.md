# The microphone spells "Spideryarn" wrong

**[SPIDERYARN-READING2-11](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-11)** · reported
2026-09-04 12:41 UTC · resolved 2026-09-04 · *one word added; no bug found in the path*

## What the reader said

> I am using the microphone button on the feedback dialogue box itself, and often when I mention
> Spideryarn, it spells it wrong. Which seems weird because I thought we had added a bunch of stuff
> to the vocabulary. Is Spideryarn itself in the list of vocabulary things we send? If not, it
> definitely should be, along with my name, the author of Spideryarn, Greg Detre.

## What we did

**Added `Greg Detre` to `SITE_TERMS`**, second in the list. That is the whole of the code change.

The rest of the work was a diagnosis that came back negative, and the negative result is the useful
part.

## The hypothesis, and why it was wrong

`Spideryarn` was **already first in `SITE_TERMS`**. That made the report evidence for something
worse than a missing word — the class `dictation.md` § failure 3 names, where the vocabulary quietly
stops being assembled — and the Feedback dialog was the plausible suspect, because it is the one
caller that derives its dictation context from a `where` prop rather than from the router.

So the chain was traced *and tested*, end to end: dialog → `useDictationField` → `useDictation`
(`{kind:"article", slug}` on an article, `{kind:"profile"}` elsewhere) → the POST body → `parseWhere`
→ `transcribe` → the `<vocabulary>` block of the actual OpenRouter request. It is intact. Run live
outside vitest, `vocabularyFor({kind:"article", slug:"xanadu-spya-ueuvaf"})` returns
`Spideryarn, granularity zoom, …` **even with no store at all** — every recipe begins with the `site`
source, which is a constant and has nothing to fail.

The new test `tests/feedback-dictation-vocabulary.test.tsx` walks that whole chain. It went red on
**exactly one thing — `Greg Detre` missing** — and its four structural assertions were green on the
first run. That is the diagnosis in one sentence: *the report's premise was right, the inferred cause
was not.*

A cross-family review had independently flagged this, and it was right to: "the vocabulary stopped
assembling" was a poor first hypothesis, not a good one.

## So what did cause the misspelling?

Model error on real speech, and we did not invent a fix for it. The shipped request measures 90–92%
hard-term recall on the synthetic corpus — about one hard term in twelve — and `dictation.md`'s own
open questions record that **nobody has ever measured this on human speech**: a person, an iPad, a
room. That is the open thread this report leaves behind, and it is a measurement rather than a code
change. See [-15](260904_1259-something-better-than-whisper.md), which is the same subject from the
other end.

## What was added so this cannot hide next time

`transcribe.ts` already logged `vocabularyChars`, but only on success and only *after* the model
call — so a failure would have taken the evidence with it. There is now a warning logged right after
assembly, which fires whether or not the call that follows succeeds. It should be unreachable while
every recipe names `site`; that is precisely what makes it a tripwire
([silent-success.md](../reusable/silent-success.md)).

A vocabulary *length* would not have been enough, incidentally — a non-empty vocabulary can still
omit the site terms. The words themselves are never logged.
