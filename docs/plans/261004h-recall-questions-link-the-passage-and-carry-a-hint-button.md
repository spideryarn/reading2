# Recall: a question links its passage, and carries a Hint button

Up: [plans.md](../project/plans.md) · the mode: [remember-mode.md](../project/remember-mode.md)

**Status: planned 2026-10-04; reworked the same day after GPT Sol's plan review (§ What the plan
review changed).** Report `spya-fryxrf` (an admin's, so trusted input), queue item `qi-e5qjsmbq`.

Greg, 2026-10-04, in Remember's Recall sub-mode on *The Bitter Lesson*:

> The new recall submode is really good. I think the one thing that would improve it, it often asks
> me questions: Do you remember the blah blah blah? or Do you remember what comes next? And I feel a
> kind of momentary anxiety. I wonder if it could include a block link. So, hey, if you want to try
> and answer this for yourself or you don't quite remember, here's the bit of the article, because
> that's really what we want to do. We want to say, okay, either generate the recollection, or if
> you don't have it, go back to the article, or give the option of going back to the article to find
> out more. And I guess the other thing that might help would be a little hint. So after a question,
> it could have a little hint button, which if clicked would expand to reveal something that will
> make it much easier for me to kind of perhaps fill in the gaps.

## What the job is

Two things, both about the question Recall ends a reply with (the "nudge"):

1. **The question always links the passage that answers it.** The prompt already says a nudge's id
   "points at the passage" (`REMEMBER_SYSTEM` § EVERY REPLY POINTS INTO THE ARTICLE), but it is one
   sentence among many and a reply can satisfy "at least one block id" with the correction's id and
   leave the question bare. "Do you remember what comes next?" is that. So the rule becomes its own
   hard limit on the nudge: the question itself carries the id of the passage where the answer is.
2. **A Hint button under the question.** Pressed, it opens a line that makes the answer much easier
   to reach without being the answer.

## The design

```
   the model writes                         the reader sees (Recall only)
   ────────────────                         ─────────────────────────────
   The piece turns on search and            The piece turns on search and
   learning [spya-aaaaaa]. Do you           learning ▢. Do you remember what
   remember what he says researchers        he says researchers kept doing
   kept doing instead [spya-bbbbbb]?        instead ▢?

   Hint: He names two games where           [ Hint ]      ← pressed:
   the hand-built approach lost             ┌──────────────────────────────┐
   [spya-cccccc].                           │ He names two games where the │
                                            │ hand-built approach lost ▢.  │
                                            └──────────────────────────────┘
```

- **The model writes the hint in the same reply**, as a last paragraph that starts `Hint:`. No
  second model call, so the button opens at once and costs nothing extra.
- **The stored text is what the model wrote, hint and all.** One pure function, `splitHint(text)`
  in `src/recall-hint.ts` (shared by server, client and eval), splits it into `{ body, hint }`.
  It splits only when all of these hold, and otherwise returns the text whole, so every deviation
  **shows the hint in the open** and nothing the model wrote is ever lost:
  the *final* paragraph begins exactly `Hint:` after a blank line; the hint is not empty; and the
  body before it contains a question (a `?`). `**Hint:**`, `Hint -`, a hint in the middle and a
  direct answer that ends "Hint: …" with nothing asked are all left as written. The eval counts how
  often the model deviates.
- **Only in a Recall conversation** (`kind === "remember"`). `Turn` in `ChatPanel.tsx` does the
  split (it is passed the conversation's kind), so drawing and copying share one `{ body, hint }`;
  `Answer` and `CitedMarkdown` stay unaware.
- **The button** is a small disclosure under the answer: closed by default, `aria-expanded`, the
  hint drawn through the same `CitedMarkdown` as the answer so its block ids are chips.
- **The press is recorded**: `chat_messages.hint_opened_at`, set once by the first press
  (`coalesce(hint_opened_at, now())`), through a small owner-checked route. The house rule is
  *"Anything a reader does … gets a timestamp column, even if nothing shows it yet"*, and Sol's
  review held the plan to it (F1). It is used for two things now: a hint you opened is still open
  after a reload, and the two server readers below. A retry reuses the answer's row, so it clears
  the column; the disclosure's state is keyed to the attempt (`id` + `createdAt`, which a retry
  moves), so a replacement hint is closed.
- **Copy** copies the body, and the hint as well only when it is open — what is on screen.
- **While the answer is arriving** the hint goes behind the button as soon as the whole
  blank-line-plus-`Hint:` marker has arrived. Nothing holds back a partial `H`, `Hin`: a flash of
  three letters is accepted unless the browser check shows it (F8).

### Who else reads an answer's text

One server helper beside `splitHint`, `answerAsSeen(message, kind)`: the body, plus the hint only
if `hintOpenedAt` is set.

| Reader | Gets | Why |
|---|---|---|
| Storage, export | raw text, and `hintOpenedAt` as a named field | lossless |
| Recall's own later turns | raw text | the model sees what it wrote; the prompt says never assume the hint was opened |
| Live's seed (`liveSeedItems`) | `answerAsSeen` | the voice prompt knows nothing of hints, and an unopened one is not something the reader was told |
| `reader_notes` transcript (Explore, Chat) | `answerAsSeen` | same |
| `unknownIds`, cited-block logging | raw text | a broken chip in a hint is still a broken citation |
| Titles, `lastLine`, search, public pages | unaffected | none reads a trailing paragraph |

### What the prompt says

Added to `REMEMBER_SYSTEM`, in its own style (read
[prompting-guide.md](../project/prompting-guide.md) first). Straight after the nudge's two hard
limits, Sol's wording (F6) put through the plain-words rule:

- **THE NUDGE'S QUESTION CARRIES ITS OWN PASSAGE.** The id of the passage that holds the answer
  goes inside the question or straight after its question mark, so a reader who would rather look
  than remember can. An id elsewhere in the reply does not count. "What comes next?" names no place.
- **A HINT, HIDDEN UNTIL THEY ASK FOR IT.** When, and only when, the reply ends with a nudge, one
  last paragraph beginning exactly `Hint:`. One statement, 25 words at most, never a question. It
  may go one step past "never what it said" — the example the author uses, what the point is set
  against, the first few words of the sentence, the sentence with its key word left out — and
  still does not state the answer. Whatever it says about the article carries the block id. The
  reader sees it only if they press Hint: never assume they did.
- **LENGTH is revised, not added to**: 120 words is the ceiling for the reply *before* the hint;
  the question is the last sentence before the hint, not the last of the reply.

## The simpler option passed over, and the ones not taken

- **Passed over: prompt only, the hint in plain sight.** No client work. But a hint on show under
  every question removes the attempt Greg wants first — "either generate the recollection, or if
  you don't have it, go back" — and he asked for a button.
- **Not taken: the button asks the model for a hint** (a canned "Give me a hint" turn). A reader
  row the reader did not write, a wait of seconds where he asked for something that "expands", and a
  second call per hint.
- **Not taken: storing the hint in its own column**, with the text holding only the body. Every
  reader above would then be right without a helper, but the browser still has to split a reply
  that is arriving, so there would be two representations of one answer.

## Open question for Greg (not waited on)

**Should Recall behave differently after you have opened a hint?**

Background: pressing Hint is now written down (the time, against that answer), but the model is not
told. Its next reply is written the same whether or not you looked.

- **A. Leave it (built).** Recall treats every answer alike.
- **B. Tell the model.** The next turn carries a line, "the reader opened the hint on your last
  question". Recall could then go easier, or note the point as one to come back to. *Costs:* a
  prompt change with its own eval run, and a risk it reads as being watched ("since you needed the
  hint…"), which is the tone this mode works hardest to avoid.

What would decide it: whether you would want an opened hint to change the next question.
**Recommendation: A now**; B belongs with the "come back to what you struggled with" work in
[remembering-vision.md](../project/remembering-vision.md), which is the first thing that needs it.

## Deferred, with its own queue entry

- **Tutorial gets the same Hint button.** Its turns end with a task too. Not here: the report is
  about Recall, Tutorial's prompt has its own eval, and its tasks are mostly "say it back", where a
  hint means something else.
- **Recall uses the recorded press** (option B above).

## One stage

1. `src/recall-hint.ts` § `splitHint`, `answerAsSeen`; `tests/recall-hint.test.ts` red first: no
   hint; a final hint; bold and dash spellings, CRLF, leading whitespace; a middle hint; a later
   paragraph after the hint; an empty hint; no question in the body; opened and unopened
   `answerAsSeen`.
2. Migration: `chat_messages.hint_opened_at timestamptz null` (additive). Types, the Postgres
   store (read, set-once, cleared on retry and edit), export's named fields, a route
   (`POST …/hint-opened`, owner-checked like the other chat writes; refuses a message that is not
   an assistant row in a Remember thread). Store and route tests, with the event time asserted.
3. `REMEMBER_SYSTEM` edits; `tests/remember-prompt.test.ts` pins the two new sections **and that
   the old unconditional ceiling and "question last" wording are gone**.
4. `ChatPanel.tsx`: `Conversation` passes `kind` to `Turn`; the Hint button; copy.
   `tests/remember-panel.test.tsx`: hint absent until pressed; a chip in the hint jumps; copy closed
   and open; a retry with the same message id shows the new hint closed; a chat answer and a
   no-question Recall answer ending `Hint: …` show it as written; opened-at-load is open.
5. `liveSeedItems` and `reader_notes` use `answerAsSeen`, each with a test.
6. `evals/remember-recall.ts`: split first; the question-last and 120-word checks on the body; the
   hint's 25 words and no question mark; the id checked **next to the question itself** and against
   the article's known ids; replies with a nudge and no hint, or a hint in a wrong spelling. The
   heuristic gets unit tests (correction id only, hint id only, unknown id, id inside the question,
   id after `?`, a clarification). A hint goes into the `justTellMe` and `nudgeFailed` histories.
   Run on the Noema article, read all thirteen, write up in `docs/investigations/`.
7. Docs: [remember-mode.md](../project/remember-mode.md), [database.md](../project/database.md) or
   wherever columns are listed, `/help` (`src/web/help/help-modes.tsx`) if it describes Recall's
   replies.
8. Browser check by a Sonnet subagent at desktop, iPad and phone widths.

**Done is:** `npm test`, `npm run typecheck` green; the eval read and written up; GPT Sol's code
review answered; the browser check's screenshots in this folder.

## What the plan review changed

GPT Sol, 2026-10-04, [261004h-recall-hint-plan-review-sol.md](261004h-recall-hint-plan-review-sol.md):
**rework**, eight findings, all taken except part of one.

- **F1 (P1) the press must be recorded now** — taken; it was the plan's open question, and the
  house rule already answers it. The question left for Greg is whether the model should *use* it.
- **F2 (P1) a retry reuses the row, so open state would survive** — taken: keyed to the attempt,
  column cleared.
- **F3 (P1) Copy would copy a hint nobody had seen** — taken: split in `Turn`.
- **F4 (P1) Live's seed and `reader_notes` would pass on an unseen hint** — taken: `answerAsSeen`.
- **F5 (P1) the split's false positives and negatives** — taken in part. The body must contain a
  question; every other spelling fails open and is counted. Not taken: requiring a *valid id next
  to the question* before splitting. That would put the hint on show exactly when the model forgot
  the link, which punishes the reader for the model's slip; the eval watches for the missing id
  instead.
- **F6 (P1) the prompt additions contradicted the ceiling and "never what it said"** — taken, with
  Sol's wording as the starting point.
- **F7 (P2) the eval would misreport every hinted reply** — taken.
- **F8 (P2) holding back `H`, `Hin`** — taken: dropped.

### Round 2

[261004h-recall-hint-plan-review-2-sol.md](261004h-recall-hint-plan-review-2-sol.md): **rework**
again, on how it is built and not on what. F1, F3, F6, F7, F8 resolved; Sol agreed with the part of
F5 not taken. Two rounds is the limit, so these are settled here and the build follows them; the
code review checks the result. **Where this section and the text above disagree, this section wins.**

- **F2, a late press landing on a retried answer.** A retry reuses the row, so a POST still in
  flight could stamp the replacement. Sol proposed sending the answer's server `created_at` as a
  generation, which the browser does not have for an answer it has just watched arrive. **Settled
  more simply: the request carries the hint's own text, and the store stamps only when the stored
  answer, split, has that same hint**, checked in the same transaction as the write. A retried row
  is empty or says something else, so the late press is refused. It also means the record says what
  it claims: the reader opened *this* hint.
- **F5, "contains a `?`" is too loose.** The body must **end** with a question: its last sentence
  ends in `?`, allowing a closing quotation mark or bracket and block-id brackets after it. An id
  there is allowed and not required.
- **F4, both voice engines.** `liveSeedItems` is called for Realtime (`routes.ts`) and through
  `gptLiveSeedInput` (`live-gpt.ts`); both get the thread's kind and use `answerAsSeen`, each with a
  test for an opened and an unopened hint. `reader_notes` passes `thread.kind`.
- **F9, the browser's side of the write.** The hint opens at once from local state whatever the
  write does. The write goes through the checked client command the other "must stick" writes use
  (`src/web/chat/effects.ts`), so a non-2xx is a failure and not a quiet success; on success the
  returned time is patched into the conversation's message, so leaving and coming back keeps it
  open. Open is `pressed here || message.hintOpenedAt`, read on every render and not only at
  mount, because stream recovery can patch the message later. Tests: the route failing (hint still
  opens, nothing claims to have saved), away and back, and a recovery that arrives after mount.
- **F10, the migration is part of done.** Generate it, `npm run db:migrate` against the local
  database with its `Target:` line read, `npm run db:check`.
- **F11, the column's invariants.** A CHECK that only an assistant row carries `hint_opened_at`,
  beside the stance and help checks; both directions of the store's named mapping; export; the
  fixture restore in `tests/helpers/seed-reader-state.ts`, with a round-trip case; stamped with
  `clock_timestamp()` as the store's other event times are; added to `tests/event-times.test.ts`.
  Postgres retry sets it null explicitly; edit inserts a fresh answer, so that is an assertion.
