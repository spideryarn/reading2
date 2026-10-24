# Every chat started from a sub-mode says so in the list

Feedback `spya-twsm7t` (#690, SPIDERYARN-READING2-NN), Greg (admin, provenance proved by
`feedback-reporter.ts`), filed 2026-10-23 23:07 UTC from Chat on `arxiv-2308-08708-spya-xax6v4`;
overseer queue item `qi-gyhtebmf`. Up: [chat-from-a-mode.md](../project/chat-from-a-mode.md).

> This chat came out from, I think, sources investigate submode chat, and so it should be annotated
> as being that kind of thing, and I should be able to see it again within the investigate submode.
> And if I look at it in the chat list of threads, it should be clear that it came from the
> investigate submode. I think we already do this for, you know, recall and explore submodes, and
> indeed any submodes that trigger chat, we should offer this ability to annotate those kinds of
> chats as coming from that submode and for that submode to list them or whatever.
>
> — Greg, 2026-10-23 (spya-twsm7t)

## What is already true, and what is not

Production (read-only query): thread `spya-xaq7f9` has `origin_mode = 'reception'` and
`origin_lens = 'Are its main claims borne out by later work?'`. That makes it an Investigate chat.
The build Greg was on (`db758ed8`) contains plan
[261021b](261021b-investigate-takes-you-back-to-your-conversation.md). So:

- **It is stored as coming from Investigate.** Yes.
- **Investigate lists it again.** Yes: *Your questions*, at the top, and arriving on Investigate
  opens the newest one.
- **The open chat says where it came from.** Yes: *Back to your question in Investigate* above
  the transcript.
- **The list says so.** **No, not in words.** The row wears Sources' icon, and *Investigate* is
  only in that icon's hover card. Its title is the stored one, *Question: Are its main claims…*.
  A Learn row, by contrast, is titled *Recall* or *Explore*, in plain sight. That is the
  difference Greg saw.

A sub-mode that starts a chat, and what each does today:

| Sub-mode | Origin stored | Listed inside the sub-mode | Named in words in Chat's list |
|---|---|---|---|
| Sources › Claims | yes | the claim's mark | no (icon + hover) |
| Sources › Investigate | yes (lens) | *Your questions* | no (icon + hover) |
| Sources › Bibliography | yes | the row's mark | no (icon + hover) |
| Learn › Recall, Explore | its own kind | it *is* the conversation | yes, as the title |
| Learn › Quiz, *Discuss this in chat* | **no** | **no** | **no** |
| Summary › Brief/Fuller, *Ask about a paragraph* | no | no | no — queued separately, `qi-vj7p4sbh`, waiting on Greg's answer |

Glossary and Ideas are modes without sub-modes, but they get the same words in the list (stage 1),
since the rule is general.

## Stage 1: the list says where a chat came from, in words

One rule for every row with a source: **the meta line under the title starts with the place it
came from**, in the words of the chip you would press to get there: *Investigate*, *Claims*,
*Bibliography*, *Glossary*, *Ideas*, *Quiz*. It sits beside the mode's icon, which is already at the
head of the row, so *Investigate* next to Sources' icon reads as Sources › Investigate. The meta
line reads like this:

```
[Sources icon]  Question: Are its main claims borne out by later work?
                Later work hasn't tested the report's findings…
                Investigate · 2 turns · 9 h ago
```

- **A Learn row** is already titled with its sub-mode, so the meta line does not say it again.
- **A passage chat** keeps its pilcrow icon and no word: it is not a mode.
- **The words come from one place.** A new `originPlace(origin)` in `thread-source.ts` returns
  `{ mode, view? }`: the mode, and the sub-mode when there is one. `threadSource`'s `from` and
  `mode`, `originBack`'s `view` and `modeLabel`, and the new `place` words are all read from it.
  Today `originBack` works out the sub-mode by itself with a nested ternary. A new origin then
  names its place once, in a `switch` with a `never` arm. The label for a place comes from the
  sub-mode tables in `sub-modes.ts`, which is what the chips draw, so a renamed chip renames the
  row.
- **Not changed:** the filter chips stay one per mode (*Sources* covers all three of its
  sub-modes). Each sub-mode already lists its own chats where its items are. A chip per sub-mode
  would make a crowded filter row longer, for little gain.

**The simpler option passed over** was to make the row's title *Investigate* the way a Learn
row's title is *Recall*. A Learn conversation is one per article, so its sub-mode name is a
complete title. There can be many Investigate chats, though, and the question is the only thing
that tells them apart.

## Stage 2: Quiz's *Discuss this in chat* records where it came from

This is the one sub-mode that starts a chat and records nothing
([quiz.md](../project/quiz.md), *a plain chat: no origin is stored*, plan
[261018b](261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat.md)). Greg's *"any submodes
that trigger chat"* covers it.

- **A new `ThreadOrigin` arm, `QuizOrigin`**: `{ mode: "quiz"; itemId: QuizQuestionId; quote }`,
  shaped like `GlossaryOrigin`. The quote is the question's words, cut by `originName`. It follows
  the 12 steps in [chat-from-a-mode.md § Adding it to another mode](../project/chat-from-a-mode.md#adding-it-to-another-mode),
  including a migration that adds `quiz` to the `chat_threads_origin_mode` and
  `chat_threads_origin_item` CHECKs. The migration is additive, so it is safe.
- **A press starts a fresh chat every time, the way an Investigate question does.** It is not one
  chat per item like Glossary. Each press discusses a different mark: you answer again, get marked
  again, and want to talk about that mark. Reopening the old chat would quote the wrong one. The
  chat still waits in the composer, as it does now. Its origin waits beside the draft
  (`pendingOrigin`), as the command bar's suggested lens already does.
- **Quiz lists them**: the step shows the newest chat about this question with `OriginChatMark`
  (the bubbles, the number of turns, and the gist), next to the Discuss button. Both are shown
  together, as in Investigate's suggested questions, so a reader can go back to the chat or start
  a fresh one.
- **The list** says *Quiz* under Learn's icon. The filter word is `learn`, so a Quiz chat appears
  under the *Learn* chip.
- **The way back** opens Learn › Quiz. It does not land on the question: the open question is
  deliberately kept out of the URL ([quiz.md](../project/quiz.md)), and a batch written again has
  new question ids. That is best effort, and the docs say so. The question's own mark is on its
  step.
- **Opened from Chat's list**, a Quiz chat is a `chat`-kind thread, so it opens in Chat's band like
  any other. It is not a Learn row, which would go to Learn.

The question ids are minted per batch. After *Write them again*, an old chat's question no longer
exists, so no step shows its mark. The chat stays in Chat's list, still saying *Quiz*. That is the
same rule as for an idea that has been paraphrased into a new id.

## GPT Sol's plan review, and what changed

[261024i-…-plan-review-sol.md](261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list-plan-review-sol.md):
*revise before build*. It confirmed the Investigate diagnosis: words in Chat's list are the only
missing piece, and a waiting draft does carry its origin into the send.

| Finding | What changed |
|---|---|
| F1 (blocker): a Quiz question id is minted per batch and may repeat, so it cannot name an origin alone | Stage 2 deferred. A Quiz origin needs a batch id column, and the way back can use `QuizArrival` to land on the exact question |
| F2: one mark per question would reopen a chat about an older answer | Made the question for Greg: Chat-only (A), or tied to one answer and shown on it (B) |
| F3: Summary is a second sub-mode with no origin | Already queued, `qi-vj7p4sbh`, waiting on Greg; named in the note and the question |
| F4: reuse `SubMode`, not a loose `{ mode, view? }` | Taken: `OriginPlace` is a mode without sub-modes or an arm of `SubMode`, named through `subModeWords` |
| F5: the mark would not fit Quiz's icon row | Recorded in the queue item for whoever builds stage 2 |

**So this plan ships stage 1 only.** Stage 2 is queue item `qi-g3neq83r`, waiting on question
`q-nvxfwx`.

## Tests (red first)

- Stage 1: `tests/thread-source.test.ts` covers `place` for every origin and Learn kind, and none
  for a passage. `originBack` is unchanged for the existing origins. A rendered list
  (`tests/chat-panel*.test.tsx`, whichever already renders rows with sources) shows *Investigate*
  in a lens row's meta line, and no second *Recall* on a Learn row.
- Stage 2: add `quiz` to the `describe.each` lists in `thread-origin-way-back`,
  `chat-origin-route`, `chat-origin-transaction` and `chat-handoff`. Add a rendered test: Discuss
  puts the origin on the pending draft, so sending saves it. The step then shows the mark, and a
  second press makes a second chat.

## Progress

- [x] Plan reviewed by GPT Sol (revise before build; above)
- [x] Stage 1: `originPlace` in `thread-source.ts`, `place` on `ThreadSource`, the word in the
      row's meta line (`ChatPanel.tsx`), the help page. Red first in
      `tests/chat-list-sources.test.tsx` § *a row's place, in words*
- [ ] ~~Stage 2~~: deferred to `qi-g3neq83r` / `q-nvxfwx`
- [x] Browser pass on the box (Sonnet, Playwright): a real Investigate chat's row reads
      *Investigate · 1 turn · just now* at 1440 and at 390, with no overflow and no console
      errors. Shots: `261024i-shot-1-wide.png`, `261024i-shot-2-narrow.png`
- [x] [GPT Sol's code review](261024i-every-chat-started-from-a-sub-mode-says-so-in-the-list-code-review-sol.md):
      *approve with fixes made*. Its fixes: the time gives way (ellipsis) on a narrow row before
      the place does; tighter tests (the exact markup path, full equality for `originBack`); the
      mode docs and help pages that still said the icon alone marked the row
- [ ] Docs (chat-from-a-mode.md table, quiz.md, chat-tools.md list section, url-state if needed,
      help page), note in docs/user-feedback/, queue item done, pushed to dev
