---
reports: spya-kan788, spya-skq3fg, spya-a40t70
addenda: spya-jk0cgg
ending: shipped
comment: "Why are you reading this?" is now at the top and grows; About you is offered if empty; a big green tick and Open at top and bottom say it is done; PDFs show a bar of sections read. Time-left is queued.
---
# The add page asks why at the top, says Ready at both ends, and counts a PDF's progress

Three admin reports from Greg (`feedback-reporter.ts` exit 0 on each, re-read before this note),
2026-10-19, all from the add page, and one addendum. Overseer queue item `qi-hrh4vwex`; the third
report was folded in by the Overseer mid-run. Plan
[261020a](../plans/261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md).

`spya-kan788` (#624, `SPIDERYARN-READING2-KJ`), 19:39 UTC:

> When adding a new article, put the "Why are you reading this?" box nearer the top of the add page.
>
> And if they haven't filled out a user profile yet at all, perhaps also add a box for that too, so
> they can potentially fill out both. Make it clear which is which and how they're different.
>
> And when the import process has finished, make that crystal clear, e.g. a button appearing at both
> bottom and top.

Addendum `spya-jk0cgg`, 19:40 UTC:

> And make the "Why are you reading this?" box bigger/auto-expanding.

`spya-skq3fg` (#625, `SPIDERYARN-READING2-KK`), 19:41 UTC:

> When loading a big/slow article, can we provide a loading bar with some kind of estimation of how
> long it will take (especially that extraction step)?

`spya-a40t70` (#659), 21:54 UTC:

> … move the Why are you reading this? nearer the top. And maybe we need two copies of the button to
> open the article at the top and at the bottom when it does eventually, when it is eventually ready
> to open. And it should be really visible somehow that something has changed and that it is now
> ready to open, that it has finished. So whether there was a loading spinner before that's gone, or
> a loading spinner that becomes a big green check mark or something, so it's really clear when
> things have finished importing.

**Ending: Shipped**, on `dev`, with one deferred half queued.

What changed:

- **"Why are you reading this?" is straight under the heading**, four rows tall and growing with
  what is typed, tagged *This article*.
- **About you**, tagged *Every article*, appears under it for a reader whose profile is empty. It
  saves like the box on Profile. While a reader is in it, or has unsaved words, the page does not
  open the article by itself, and *Open the article* waits for the save.
- **When the page is waiting at the finish**, a highlighted *Your article is ready.* with a big
  green tick and *Open the article* appears at the top, and the same button stays at the bottom.
  When neither box was touched, the page still opens the article by itself, as before.
- **A progress bar where there is something real to count.** PDF extraction counts the sections it
  reads, and image collection counts its images. That count used to stay inside the worker, so the
  reader never saw it. It is now saved every few seconds and drawn as a bar under the step: *23 of
  69 sections of the file done*.

**Deferred, and queued as `qi-8w8yv8vk`: the "how long it will take" half of `spya-skq3fg`.** Production holds 11
imports so far. URL extraction took anywhere from 3 to 122 seconds, with no relation to the
article's length, so any time-left figure would be a guess presented as a measurement. The
measurement is in
[261020a-import-durations-measurement.md](../plans/261020a-import-durations-measurement.md). The
queue entry says to measure again once there are enough imports, and to add a *usually N–M minutes*
line where the data supports one.

**Not this note: `spya-wc4vku`** (a microphone beside the purpose box, and the rule for every prose
box). It was handed back to the Overseer's sweep unbuilt. GPT Sol's review of the plan found four
ways a dictation would lose words on this page. The spec for that work is the plan's § C2.

Reviews: GPT Sol on the plan (nine findings, all taken), on the code (four, fixed by the
reviewer), and on Part C's plan and code. Browser-checked at 1000 px and 390 px on the local
stack, including a live PDF upload showing the bar.
