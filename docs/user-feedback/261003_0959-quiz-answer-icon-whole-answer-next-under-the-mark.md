---
reports: spya-fzgcqu, spya-qnrxuw, spya-smev24
ending: shipped
---
# Quiz: Answer as an icon, the whole answer on screen, and Next under the mark

Three suggestions from Greg (admin, each confirmed against its production row by
`scripts/feedback-reporter.ts`), 2026-10-03 09:59–10:01 UTC, relayed by the Overseer, all from Quiz
on `…/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564?…&mode=remember&remember=quiz`.

`spya-fzgcqu`:

> In quiz mode, replace the answer text label with, you know, an icon and a tooltip, just as we do
> with other places in the chat or whatever. And look for anywhere else where we have a button with
> a text label that could be an icon plus tooltip instead. And I think we say something in our, you
> know, design documents that we prefer icons plus tooltips because there's so much text already on
> this page that adding more, well, it means the buttons don't stick out as much and it's just
> overwhelming.

`spya-qnrxuw`:

> Quiz mode. If I provide an answer, show the whole answer and don't put my answer in a scrollable
> box.

`spya-smev24`:

> In quiz mode, so it asked me a question, I gave an answer, it then critiqued my answer. That's all
> great. But then I was expecting there to be a button at the bottom underneath, sort of for, you
> know, next question, and perhaps even previous question, I'm not sure.

**Ending: Shipped**, on `dev`. The plan, GPT Sol's two reviews and the browser check are
[261003i](../plans/261003i-quiz-answer-icon-whole-answer-and-next-after-the-mark.md);
[quiz.md § On screen](../project/quiz.md) is how it works now.

## What changed

- **Answer is an icon.** The same send button chat has, in the same orange box; point at it and a
  card says *Answer* and that Cmd+Enter or Ctrl+Enter does the same.
- **The answer box grows with what you write.** No scrollbar inside it; it re-fits when the window
  changes width or an iPad is rotated. A very long answer makes the band scroll instead.
- **Next is under the critique, and is the orange button once the critique has finished.** A Next
  and a Previous were already there, but as small grey chevrons below *Show a reference answer*,
  which is why they did not read as "the button at the bottom". Now the row sits directly under the
  critique, and the fill moves from Answer to Next when the mark lands. Previous stays a quiet
  icon beside it.

## The second half of the first report: everywhere else

A sweep of the reading view found about forty other text-label buttons that could be an icon and a
tooltip. They are in a dozen files, so they are their own job: queue entry `qi-zkt2mtf9`, with the
grouped list in the plan's *Deferred* section.

## Left as words, and asked of Greg

*Show a reference answer* and the microphone's *Talk* still carry words in Quiz, each for a reason
an earlier decision gave (the indefinite article; talking is what the band wants). **Q-quiz-words-left**
in the session's debrief asks whether to convert them too.
