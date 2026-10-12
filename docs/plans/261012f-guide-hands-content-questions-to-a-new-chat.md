# 261012f — The guide hands content questions to a new Chat, its next steps stand out, and it says less

Owned by [plans.md](../project/plans.md). Report `spya-es283p` (#576, SPIDERYARN-READING2-HT), queue
item `qi-6zjz6m4r`, session `fbes283p-guide-hands-off-to-chat`.

> If you ask the guide chat something substantive about the content itself, I wonder if it would be
> better to actually spawn a new chat and say, okay, my job here is just to help you figure out how
> to use Spideryarn, but it sounds like you want to ask something about the article itself more
> substantively. Let me kick off a new chat for you, and it would have a button to do that. I guess
> this needs to be pretty sort of prominent because when I watch people using the guide, they often
> didn't notice that it was suggesting actions for them to take. And also, I think the guide should
> be a bit less verbose because people don't appreciate it.
>
> — Greg, 2026-10-12, `spya-es283p`

Three asks: **(1)** a button that starts a fresh Chat on a content question, **(2)** the guide's
suggested actions harder to miss, **(3)** a shorter guide.

## What is there now

- The guide's prompt (`GUIDE_SYSTEM`, src/converse.ts) already says a content question gets *"one or
  two sentences at most, point to where it says it, and say that Chat (in the bottom bar) is the
  place"*. So the guide answers a little and tells the reader to go elsewhere, and the reader has
  to go there and ask again.
- The guide's `offer_next_steps` tool (src/chat-tools.ts, checked by src/next-steps.ts) puts at most
  three buttons under its latest answer: `ask`, `mode`, `search`, `share`, `archive`
  (src/web/GuideNextSteps.tsx). They are drawn as a centred column of quiet outlined buttons,
  `--rule` border and `--ink-soft` text (chat-actions.css § `.chat-suggest-btn`), with no heading.
  Plan 261011m made them deliberately quieter so the typing box would stand out; Greg now reports
  readers miss them.
- Every *Ask in chat* in the app starts a fresh chat and sends (Reader.tsx § `handToChat`). In
  Chat's band, which is the only band that opens the guide, the list's own box already does "mint a
  fresh `chat` conversation and send this as its first question": `onSendNew` in
  ConversationModes.tsx.

## What we will do

### 1. A sixth next step, `chat`: *Ask in Chat*

- `NextStep` gains `{ kind: "chat"; words: string }` — a question about what the piece says, in the
  reader's voice, standing on its own (it will be the first message of a conversation that has not
  seen the guide's). `checkNextStep` takes it, one line, at most 160 characters; the tool's schema
  and description say what it is for.
- Drawn **first** in the row, whatever order the model gave, as the one **filled orange** button
  (`--highlight` ground, `--highlight-foreground` text, the Send button's colours), with a chat icon
  and the words in full: *Ask in Chat: "Why does Seth think…?"*. What is on the button is what is
  sent, as with `ask`.
- The press calls `ChatPanel`'s `onSendNew`, so it mints a fresh `chat` conversation in the band,
  opens it, and sends the words as its first question: one press, one model call, the reader's.
  Sent without `typed` (it is a button's words, `SendHow`). The guide conversation stays as it was,
  reachable from the list.
- **Prompt**: the content paragraph changes from "say that Chat is the place" to: when the reader
  asks about what the piece says, argues or means, rather than how to read it, say in one sentence
  that this conversation is for how to read it and that the button below starts a Chat on their
  question; give at most a pointer to where in the piece (a block id); do not answer it; offer a
  `chat` step carrying their question. Not for questions about reading (where to start, what to
  skim, which mode).

### 2. The next steps harder to miss

- A visible heading over the row, *Next steps* (the `fieldset` gets a `legend`; it has only an
  `aria-label` now).
- The buttons go from quiet to plain: `--rule-strong` border, `--surface-raised` ground, `--ink`
  text — the look of the in-answer command chip (`.cmd-chip`), which readers did press in the
  browser passes. `ask` keeps the model's face. The *Ask in Chat* step is the orange one, so there
  is at most one orange button on screen besides Send.
- Still centred and sized to their words (261011m kept), still under the latest answer only.

### 3. A shorter guide

- "Keep it short: under 100 words" becomes **under 60 words**, with "at most two short paragraphs"
  and "one place in the piece, two at most". The opening "suggest a way into the piece" bullet loses
  "and one or two modes", since the modes now go in the next steps: **one** mode in the text, at
  most.
- The spoken guide (src/live.ts) is left alone: it has no buttons, and nobody reported it.

## Measured

`evals/guide/next-steps.ts` gains two cases, run on the old prompt first (the `before` arm, on the
commit before the prompt change) and again after:

- **content**: *"Why does the author think consciousness can't just be computation?"*, reason
  given. Must offer `chat`; the answer must be short and must not answer the question at length.
- **content-detail**: *"What does he mean by 'the mythology' in the title?"*. Same.
- The existing cases (where to start, private link, archive, search, two hostile) must **not**
  offer `chat`.

Plus word counts on every answer of both evals (`next-steps.ts` and `run.ts`), old prompt against
new. Written up in
[261012a](../investigations/261012a-guide-hands-off-to-chat-and-shorter-measured.md).

## Simpler options passed over

- **Reuse the `mode` step with `mode:chat`.** No new kind, but it would open Chat's list and the
  reader would have to ask again: exactly the friction Greg is asking to remove.
- **A button the guide presses itself** ("Let me kick off a new chat for you"). Plan 261011m took
  self-pressing out of the guide at Greg's request; a chat started from the guide's words alone
  would also be a model call nobody pressed for.
- **A token in the answer's text (`[cmd:chat:…]`)** instead of a next step. It would sit in the
  answer, where Greg's report says it is missed, and a token carrying free text needs a new
  escaping rule in command-proposal.ts. The next step is structured data, checked on both sides.
- **The chat remembering it came from the guide** (a `ThreadOrigin` of kind `guide`): a schema and
  type change for something nothing shows yet. Not now.

## Not done, and where it goes

- Recall and Tutorial starting a chat (`qi-mhqsts4z`): they have no next-steps row, so this does
  not serve them directly. What it does give them is the press: `onSendNew` from a button. Noted on
  the item.

## Stages

1. Eval cases added, `before` arm run on the old prompt.
2. The `chat` step end to end (type, checker, tool schema, row, press), the styling, the prompt;
   tests; `after` arm; GPT Sol code review; browser check.
3. Docs (chat-tools.md / the guide's doc), the investigation, the feedback note, bookkeeping.

## GPT Sol's plan review, and what changed

[261012f-plan-review-sol.md](261012f-plan-review-sol.md), **BUILD WITH CHANGES**. All six taken:

- **F1** — at most **one** `chat` step: `checkNextSteps` keeps the first and says it dropped the
  rest; the tool description says "at most one".
- **F2** — a hostile case that *must* produce a `chat` step while the article plants an instruction;
  its words must not carry it. The prompt and the tool say the words copy or plainly restate the
  reader's own question and take nothing from the article.
- **F3** — the eval scores the 60-word ceiling (with a little slack, see the investigation), exactly
  one `chat` step on a content case, and the answers are read for "answered rather than handed off".
  NEXT STEPS gets its own `chat` bullet.
- **F4** — the stronger look is scoped to `.guide-next-steps`, not the shared `.chat-suggest-btn`;
  the orange button has its own class with base, hover and focus in the later stylesheet; the
  `legend` replaces the `aria-label`.
- **F5** — a mounted test: the guide open, the chat step pressed, one new `chat` conversation with
  one first question, nothing appended to the guide.
- **F6** — *send the reader's last guide question verbatim, with no model-written words* was the
  simpler option. Not taken: in a conversation the reader's question is often elliptical ("what
  does that mean?", "and the second one?"), and a fresh Chat has not seen the guide conversation,
  so it would get a question it cannot answer. The words are shown in full on the button, the
  reader presses it, and it goes to Chat, which reads the same untrusted article anyway; the cap and
  the hostile case bound the rest.
