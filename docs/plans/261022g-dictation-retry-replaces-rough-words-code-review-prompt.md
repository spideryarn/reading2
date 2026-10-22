# Code review: dictation Try again replaces the rough live words (qi-qxkryezr)

You are reviewing a small fix in the shared dictation code of Spideryarn, an AI-assisted reading
app. You may fix what you find inside the files named below; report anything wider rather than
changing it. Never run git commands that discard work (no checkout/restore/stash/reset/clean).

## Background

On Chromium the browser's SpeechRecognition puts confirmed "rough" phrases into the text box while
the reader talks. On Stop the recording is uploaded, and the real transcript replaces them. The
field tracks what the dictation put in as a `span` (`src/web/useDictationField.ts`). When the
upload fails, `useDictation` (src/web/useDictation.ts) keeps the recording and may offer
**Try again** (`retry`). A retry's transcript arrives after `onEnd`, by which point the field had
already set `span` to null.

Your earlier review (docs/plans/261021e-dictation-code-review-sol.md, item 3) said Retry would
append the transcript beside the rough words. Checked against the real hook, that was only
latent. `useDictation` gated the offer on `s.confirmed === 0`, so with rough words in the box
there was **no Try again at all**, only the audio to save. Lift that gate and the duplication
appears ("the rough words The real words."). The test went red both ways before the fix.

Greg approved fixing it so that Retry replaces the rough words, as a successful first try does.

## The change

- `useDictation.ts`: the `s.confirmed === 0` gate on the failure branch's retry offer is removed;
  the comments that relied on it are updated.
- `useDictationField.ts`: a new `spent` ref, set in `onEnd` to the session's `span` when nothing
  was delivered. `put` with `replaceSpan` and no live span looks for those words: at the old
  offsets if the box is unchanged since the end, else at their single unique occurrence, else not
  at all (the old caret behaviour). Every `put` clears `spent`, and so do a new accepted press and
  the `opening` phase effect.
- New test: tests/dictation-retry-replaces-rough-words.test.tsx (real hooks, fake recogniser).
- docs/project/dictation.md, failure mode 6.

The diff is in docs/plans/261022g-dictation-retry-replaces-rough-words.diff.

## What to look for

Correctness above all:

- Any path where `spent` survives into a transcript that is not the retry of the failed session.
  Consider a device-change restart, a press refused by the hook, a recovered tape from an earlier
  page (`recover`, `[mic-recovered]`), a `[mic-moved]` offer, the moved-then-back flow, and a
  reused box whose `doneKey` changes.
- Whether removing the gate opens any other double-insertion: a partial Chromium recogniser plus
  multi-part tapes, an `elsewhere` box, and commit-on-blur boxes that may already have saved the
  rough words.
- Whether the unique-occurrence fallback can replace text the reader typed themselves, e.g. a
  short rough phrase such as "yes" that also occurs elsewhere. If it is too eager, propose a
  tighter rule.

Run `npx vitest run tests/dictation` and `npm run typecheck` (or
`node --import tsx scripts/typecheck.ts` if the npm wrapper's IPC is blocked). End with a one-line
**Verdict:**.
