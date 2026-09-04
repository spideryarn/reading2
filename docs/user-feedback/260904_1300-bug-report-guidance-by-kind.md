# Show the bug-report guidance, drop "Not sure what to write?"

**[SPIDERYARN-READING2-16](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-16)** · reported
2026-09-04 13:00 UTC · resolved 2026-09-04 · *shipped*

## What the reader said

> In the feedback dialogue box, we have a little link for not sure what to write. Actually, I think
> if the user clicks on a problem, then we want to show that guidance for bug tracking about you
> know, steps to reproduce and you know, what happened and what do they expect to happen, whatever,
> we want to show that text explicitly and kind of quite prominently, um, because that will help hint
> to them what would make for a better bug report. And then we can get rid of not sure what to write
> because no one will click that.

## What we did

Exactly this. The hint under the label now follows the **Problem / Suggestion** toggle, and the
disclosure is gone:

- **nothing picked** — the general sentence, unchanged. Deliberately: the standing instruction is
  that the dialog asks for the three things *without anybody clicking*, and a test pins it.
- **Problem** — three separate lines, steps to reproduce / what you expected / what you saw instead,
  in the left-ruled stepped-in look the disclosure panel used to have, plus the one reassurance line
  worth rescuing from it: *"Any of the three is better than none, and nobody is going to judge the
  writing."*
- **Suggestion** — *"What you'd like, and what it would let you do. A rough sketch is plenty."*

`FeedbackDialog.tsx` loses `helpOpen`, the toggle button and the panel; `styles.css` loses the two
now-dead rules and gains `.fb-asks` / `.fb-ask` / `.fb-ask-note`.

Four tests: Problem breaks out three lines; Suggestion asks what it is for and does **not** ask for
repro steps; un-picking restores the general sentence; there is no disclosure left to open.

## One judgment worth recording

The hint copy stayed in the component rather than moving to `src/messages.ts`. That file is
specifically for *failures a model call can return* — `dictation.md` says so — and the existing hint
already lived in the TSX. Moving it would have widened what `messages.ts` means for no gain.

## The shape of the thing this repeats

The three questions had spent a day inside that disclosure before being moved out on 2026-09-03,
under the reasoning *"a hint nobody opens is a hint nobody reads"*. This report is the same
observation arriving a second time and going one step further: not just always-visible, but
**shaped to what the reader has just said they are doing**. `feedback.md` § One box now carries both
halves of the story so the next person does not put the panel back.
