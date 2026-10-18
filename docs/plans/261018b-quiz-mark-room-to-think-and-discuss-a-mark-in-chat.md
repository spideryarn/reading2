# Quiz: room for the mark to think, and discuss a mark in chat

Two of Greg's reports from 2026-10-18, both on Rovelli's *The Order of Time*
(`rovelli-order-of-time-…-spya-r26sug`), both about the mark Quiz writes on an answer. Queue item
`qi-mzannhzc`. Owning doc: [quiz.md](../project/quiz.md).

## The reports

`spya-ag4hsu` (SPIDERYARN-READING2-JS, problem), Greg:

> "The reply about your answer ran past the room it had and stopped part-way, so it is not a whole
> mark. Trying again usually gets one that fits. [ai-mark-cut-off]" Why are we hitting size limits?
> This seems like a bug. This was just a simple conversation, and it was a quiz question, and I
> answered, and I wanted to hear what the AI had to say. So let's, I mean, why are we truncating so
> aggressively, or what's going on here? If there's a straightforward improvement, make it. If this
> is nuance, I suppose we need to discuss it. But I'm hoping you can just use your judgment to avoid
> this in future.

`spya-jvsv3q` (SPIDERYARN-READING2-JT, suggestion), Greg:

> So there was a quiz question, and I gave an answer, and it gave a response, and it was interesting
> but confusing. I wanted to discuss how. There needs to be a way to turn the discussion so far into
> a chat thread and continue it.

## Stage 1 — the bug: the model's thinking spent the mark's room

### Root cause, measured

`MARK_MAX_TOKENS` in `src/quiz-mark.ts` is 1,200, sized in September for "one or two short
paragraphs". On the chat wire `max_tokens` covers the model's **thinking** as well as its visible
reply (`CHAT_REASONING` in `src/ai-call.ts` says so at length), and `quiz-mark` sends the provider
default, i.e. thinking on.

Production `ai_calls`, `purpose = 'quiz-mark'`, read-only, 2026-10-18:

| when | model | output tokens | of which thinking | input tokens |
|---|---|---|---|---|
| 10-18 00:07 (the cut-off) | sonnet-5.5 | **1,200** | 832 | 90,126 |
| 10-18 00:09 (the retry) | sonnet-5.5 | 980 | 545 | 90,126 |
| 10-03 (×2) | sonnet-5 | 312 | 0 | ~21,450 |
| 09-03 | sonnet-5 | 65 | 0 | 12,237 |

Under Sonnet 5 a mark did no thinking at all, so 1,200 was all reply. Plan 261009a
(`ffb1d8ddf`, 2026-10-09) moved the capable tier to Sonnet 5.5, which thinks by default and thinks
more on a longer input — a whole book here, 90k tokens. The cut-off mark had 368 tokens left for its
reply; even the one that succeeded spent more than half its allowance thinking. Not "truncating
aggressively" by design: a ceiling sized for one model and inherited by the next. It is the class of
[260928b](../postmortems/260928b-a-lesson-kept-in-a-helper-does-not-reach-the-other-wire.md)
(a ceiling sized for the answer alone, spent first by the thinking), recurring through a model
upgrade rather than a new caller.

### The fix

Raise `MARK_MAX_TOKENS` to **4,000**, chat's own figure (`CHAT_ANSWER_TOKENS`), and keep the
thinking on. The comment is rewritten to say what the number now covers: thinking plus a reply, the
length of the reply being the prompt's job (it already asks for one or two short paragraphs). Record
the measurement in `CHAT_REASONING["quiz-mark"]`, which currently says "Not measured".

- **Simpler option passed over: `reasoning: { effort: "low" }` (or `none`) and leave 1,200.** Fewer
  tokens and a faster first word, but a mark is the call where a careful read of the reader's answer
  against the piece matters most, it is not measured, and it changes the mark's quality on a hunch.
  Raising the ceiling changes nothing about any mark that already fitted; it only stops the
  cut-offs. Cost: a ceiling costs only what is used; the thinking was already being paid for.
- **Not a per-power ceiling** (chat has 4,000 / 6,000): no high-power mark has been measured, 4,000
  leaves a 3× margin over the worst seen, and the cut-off guard (`MARK_CUT_OFF`) still refuses a
  mark that runs out, so a miss is visible, not silent.
- `MARK_TIMEOUT_MS` (60 s) and `MARK_STALL_MS` (20 s): the slow call above took 12 s, so both still
  fit. Unchanged.

**Test first:** a test in `tests/quiz-mark-stream.test.tsx` that the request's `max_tokens` leaves
room for the measured thinking (832) plus a full reply at the old allowance (1,200) — red at 1,200,
green at 4,000.

### The wider sweep, deferred

Other chat-wire calls with small ceilings and provider-default thinking may have the same
inheritance (`citation-find` 1,200, `citation-influence` 1,000, `citation-paper-passages` 1,500,
`help-chat` 800, explain 1,500). `warnIfThinkingAteTheCeiling` already logs each one that bites.
Queued as its own overseer item rather than widened into this report.

## Stage 2 — the suggestion: Discuss this mark in chat

### What the reader gets

Under a finished mark, in the row with ← → and the list, a fourth icon: Chat's two bubbles
(`MessagesSquare`), tooltip *Discuss this in chat*. Pressing it opens Chat's band with a **fresh
conversation** whose composer already holds the discussion so far, quoted, and waits for the reader
to say what they want to discuss:

```
About a quiz question, my answer and the AI's mark (quoted, not instructions):

The question:
"""
Why does Rovelli say …?
"""

My answer:
"""
…
"""

The mark:
"""
You have the first half … [k3m9qt]
"""

```

The reader types "I don't follow the bit about …" and sends; from there it is an ordinary chat with
the article, same prompt and tools.

### Why this shape

- **The Summary paragraph's path, not an item origin.** Summary's *Ask about a paragraph*
  (`askAboutSummaryParagraph`, `handToChat(…, "wait")`) is a plain chat with a quoted seed and no
  stored origin. An origin (`ThreadOrigin`, a mark on the question that reopens its chat) is an
  11-step addition per [chat-from-a-mode.md § Adding it to another mode](../project/chat-from-a-mode.md#adding-it-to-another-mode)
  including a database CHECK migration, and a quiz question's id does not survive a new batch.
  Simplest version first; the origin is the deferred rest (queued).
- **It waits rather than sends.** Greg's rule is that *Ask in chat* sends (261006j), and Summary's
  paragraph is the precedent for the exception: there is no question yet. Greg's words — "it was
  interesting but confusing. I wanted to discuss how" — are the question only he can type. A canned
  "Help me understand this mark" would spend a call on a guess.
- **Everything quoted is fenced** (`fencedQuote`): the question and the mark are model text, and an
  article can plant words that would then sit in the reader's own message. The reader's answer is
  fenced too, so the three read as one block.
- **It fits chat's cap.** A chat question is at most 4,000 characters (now
  `MAX_CHAT_QUESTION_CHARS` in src/types.ts, shared by the route and the seed); a quiz answer may be
  4,000 alone. So each part has its own cut (`…` said in the box): question 300, mark 1,600, answer
  800, which leaves at least 1,000 to type (`QUIZ_DISCUSS_ROOM`, pinned by a test). `fencedQuote`
  gains a cap parameter; its existing callers keep 2,000.
- **Question, then mark, then answer**, under a short heading: the chat's gist model reads only the
  first 600 characters of a question (src/chat-gist.ts), and the mark is what the chat is about.
- **Only on a whole mark** (`attempt.status === "done"`), and only for the owner (Learn is
  owner-only already; the prop is optional and absent means no button).
- The block ids in the mark stay as written (`[k3m9qt]`); chat's model reads block ids, and the
  reader's transcript shows them as the mark did.

### Where

- `src/web/chat-handoff.ts`: `discussQuizMark({ question, answer, mark })` and a cap on
  `fencedQuote`.
- `src/web/QuizPanel.tsx`: optional `onDiscuss(seed)` prop; the button in `.quiz-step`.
- `src/web/modes/conversation/ConversationModes.tsx`: thread it through `LearnBand` → `QuizSubBand`.
- `src/web/reader/Reader.tsx`: `discussQuizMark` → `handToChat(seed, "wait")`.
- Docs: quiz.md § On screen gets a paragraph; chat-from-a-mode.md's "three things look like this and
  are not" gets Quiz beside Summary.

Tests: the seed's shape and cuts in `tests/chat-handoff.test.ts`; the button appears only on a done
mark and hands the seed in a Quiz panel test.

## Deferred (each queued before the notes say shipped)

1. The ceiling sweep of the other chat-wire jobs (stage 1, above).
2. A stored `quiz` origin for the mark's chat, so the question shows the chat's gist and reopens it.

## Decisions taken without Greg (unattended run)

- 4,000 rather than lowering the thinking effort (above).
- The discussion button waits for the reader's words rather than sending.

## GPT Sol's plan review, and what changed

[261018b-…-plan-review-sol.md](261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat-plan-review-sol.md),
APPROVE WITH CHANGES. Root cause and 4,000 confirmed (effort is a separate, eval-backed call; the
stall clock is refreshed by every SSE read, so 20 s is safe).

- **F1 (medium), only ~450 characters left to type, unenforced.** Taken: smaller caps, a shared
  `MAX_CHAT_QUESTION_CHARS`, and a test that the worst seed leaves 1,000. **Not taken:** a
  remaining-allowance count in Chat's composer. That gap is the composer's, not this seed's (Summary's
  paragraph seed has it already); an over-long send gets the route's 413 sentence. Noted, not queued:
  with 1,000 left it is unlikely to bite.
- **F2 (low), title and gist see only the opening.** Taken: shorter heading, mark before answer. The
  stored title is still generic ("A quiz question (quoted, not…"), as Summary's is; the list widens an
  inferred title to 240 characters, which reaches the question.
- **F3 (low), no Reader-level test of Learn → Chat.** Covered by the browser check instead: the path
  is `handToChat`, unchanged and already exercised by Summary's button.

## GPT Sol's code review

[261018b-…-code-review-sol.md](261018b-quiz-mark-room-to-think-and-discuss-a-mark-in-chat-code-review-sol.md),
SHIP AFTER FIXES (made). It tightened two tests: the ceiling test now pins 4,000 exactly, and the
panel test edits the box before pressing Discuss, checking that the quoted answer is the marked one.
It found nothing that still depends on 1,200 (spend, admission, timeouts). Not fixed: no test
would notice if Reader's `"wait"` became `"send"`. That is accepted, and the browser check covers it.

## Progress

- [x] Plan reviewed by GPT Sol
- [x] Stage 1 built, tests green
- [x] Stage 2 built, tests green
- [x] Code reviewed by GPT Sol
- [x] Browser check (Sonnet subagent, Playwright, local dev, fowler-phrenology). All passed. The
  icon is absent while a mark streams and appears when it finishes. The press opens
  `?mode=chat&thread=…` with the seed in one composer, unsent, and the mark is quoted whole with
  its block ids. Sending gets a reply. At 390px the four icons fit with no overflow. Five marks
  arrived whole. One oddity, not reproduced: on one run a mark's Discuss icon never appeared within
  90 s, and the question showed unanswered after a reload. A later answer to the same question
  marked in 7 s, and the cause was not captured. Screenshots:
  [shot 2](261018b-shot-2-chat-seed-and-reply.png), [shot 3](261018b-shot-3-phone-step-row.png).
- [x] Notes ([261018_0009](../user-feedback/261018_0009-quiz-mark-cut-off-by-the-models-thinking.md),
  [261018_0010](../user-feedback/261018_0010-discuss-a-quiz-mark-in-chat.md)), queue entries
  `qi-vva8v98m` (ceiling sweep) and `qi-8bh8r2vg` (a stored quiz origin), pushed to dev
