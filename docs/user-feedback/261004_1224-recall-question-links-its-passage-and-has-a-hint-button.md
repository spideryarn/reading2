---
reports: spya-fryxrf
ending: shipped
---

# Recall: a question links its passage, and has a Hint button

A suggestion from Greg (admin; `feedback-reporter.ts` exited 0 on the report's production row),
2026-10-04 12:24 UTC, on `bitterlesson-spya-pbag4p`, `?mode=remember`. Queue item `qi-e5qjsmbq`.

`spya-fryxrf` ([SPIDERYARN-READING2-CQ](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-CQ)):

> The new recall submode is really good. I think the one thing that would improve it, it often asks me questions: Do you remember the blah blah blah? or Do you remember what comes next? And I feel a kind of momentary anxiety. I wonder if it could include a block link. So, hey, if you want to try and answer this for yourself or you don't quite remember, here's the bit of the article, because that's really what we want to do. We want to say, okay, either generate the recollection, or if you don't have it, go back to the article, or give the option of going back to the article to find out more. And I guess the other thing that might help would be a little hint. So after a question, it could have a little hint button, which if clicked would expand to reveal something that will make it much easier for me to kind of perhaps fill in the gaps.

**Shipped**, both halves, as
[261004h](../plans/261004h-recall-questions-link-the-passage-and-carry-a-hint-button.md):

- **The block link.** Recall's prompt now says the question itself carries the link to the passage
  that answers it. In the eval 12 of 13 questions did.
- **The Hint button.** It sits under the answer, closed. Pressed, it opens one line the model wrote
  with the question. The first press is recorded, so a hint you opened is still open after a reload.

What the eval found and what is still off (some hints nearly give the answer; replies are a little
longer) is in [261004c](../investigations/261004c-recall-hint-and-question-link-eval.md).

**One question for Greg**, in the plan, not waited on: should Recall behave differently after you
have opened a hint?

**Deferred, with its own queue entry (`qi-56se7v85`, source `spya-fryxrf`):** the same button in
Tutorial, and telling the model that a hint was opened.
