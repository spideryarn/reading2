# Remember mode — say what you took from it, and find out

Up: [reading-view-overview.md](reading-view-overview.md)

**Built 2026-08-27, and named *Remember* since 2026-09-01; Recall, Tutorial and Quiz since 2026-10-02** — the rename and its reasoning are in
[260901d](../plans/260901d-rename-review-mode-to-remember-mode-everywhere.md). The reader talks — or
types — about what they remember of the article, and the model corrects briefly where their account
and the piece come apart, links the passage, and **nudges them to remember a little more** — filling
the gap when they are stuck. One voice since 2026-10-02; until then four **stances** (Balanced,
Respond, Socratic, Signposts) were picked per turn. Where the three sub-modes are going:
[remembering-vision.md](remembering-vision.md).

Greg, 2026-08-27, when it was still called Review:

> I want to add a Review mode where the user types or talks … about what they've taken from the doc,
> and then the agent responds plainly but concisely with any corrections/misunderstandings/
> refinements/gaps. The prompt for this should be delicately written, because we don't want to be
> annoying/patronising/superior, but at the same time the user is earnestly looking to deepen/correct
> their understanding.

Code: [`src/converse.ts`](../../src/converse.ts) § `REMEMBER_SYSTEM`, `systemFor` (the prompt and
where each piece of it lands), [`src/chat.ts`](../../src/chat.ts) (`withTurn`, `withRetry`,
`withEdit`), [`src/routes.ts`](../../src/routes.ts) § `streamChat`
(validation, the 409, `MAX_REMEMBER_CHARS`), [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx)
(one panel, parameterised by kind),
[`src/web/modes/conversation/ConversationModes.tsx`](../../src/web/modes/conversation/ConversationModes.tsx)
§ `ConversationBand`.
Tests: [`remember-prompt.test.ts`](../../tests/remember-prompt.test.ts),
[`remember-store.test.ts`](../../tests/remember-store.test.ts),
[`remember-route.test.ts`](../../tests/remember-route.test.ts),
[`remember-panel.test.tsx`](../../tests/remember-panel.test.tsx).
Eval: [`evals/remember-recall.ts`](../../evals/remember-recall.ts) — **read this before editing
the prompt.**
The plan, the reasoning and the cross-family review:
[260827ah-review-mode.md](../plans/260827ah-review-mode.md).

```
   CHAT                                 REMEMBER
   ────                                 ────────

   reader ──── question ────►           reader ──── what I think ────►
                                                                       model
   reader ◄─── answer + ────── model    reader ◄─── where to look ─────
               block ids                            + block ids

   the article answers the reader       the reader answers, and finds out
                                        where they were off

   can be used to avoid reading         CANNOT be — there is nothing to
                                        say until you have read it
```

## Why this one is not the anti-goal

[vision.md § Anti-goals](vision.md#anti-goals) names *"a chatbot with the article stuffed in the
context window"*, and [260826a-chat-mode.md § Say the awkward thing
first](../plans/260826a-chat-mode.md#say-the-awkward-thing-first) is a long apology for building one anyway.
Recall needs no such apology, and the reason is structural rather than a promise: **the reader has to
have read the piece before they can use it at all.** There is nothing to say otherwise, and the
output is a set of paragraphs to go back to. vision.md's *recall* entry is the nearest thing already
written down; this is that idea with the direction reversed, the reader supplying the answer first.

**Tutorial is the exception, and Greg made it** (§ Tutorial, the third sub-mode): a reader who has
not read the piece may start there. What keeps it on the right side of the anti-goal is a rule
rather than a structure — every piece it teaches is a short quotation or close paraphrase with its
block id, and the reader is sent into that passage rather than told the piece instead of it. That is
a promise the prompt makes and the eval checks, which is weaker than Recall's, and it is the thing to
watch.

## One adaptive voice

Greg, 2026-10-01, three reports in one sitting (`spya-cjquu6`, `spya-kqynj5`, `spya-c8x66d`):

> I think basically I want to get to the point where actually there's really only one recall mode,
> which is fairly brief, simple language makes use of block links and tries to keep nudging me with
> hints and questions so that I'm constantly remembering a bit more and a bit more because the act of
> recollection is what helps learning. … And you know what, if it's clear that they are struggling,
> then don't make them suffer or feel bad or fail. In that case, maybe you do just provide more. So I
> guess you're being a bit adaptive. And that's why we only need one mode.

So the four stances went, and the per-point triage Balanced did became the whole prompt. Each reply:

1. **At most one correction**, only where *what you are entitled to say* (below) allows it, quoted
   and cited. Often none, and that is normal.
2. **Then a nudge**: a cue that names *where* in the piece and *what it was about*, never what it
   said — often offering **two directions**, so a reader with nothing on one has the other (Greg:
   *"so that I've got a choice"*).
3. **Adaptive on evidence**: "I don't remember", "I'm lost", or a nudge that got nothing → the gap
   is **filled**, plainly and cited, and nobody is asked the same thing twice. A direct question or
   "just tell me" is answered first.
4. **Every substantive reply links a passage** (`spya-kqynj5`); a pure clarification may not need
   one, and an id attaches only to what the article says.
5. **Brief** — usually under 120 words, one nudge at the end. A long explanation becomes a pointer to
   the passage and a suggestion that Chat is the place to talk it through. (Greg also asked for a
   tool that starts that chat itself; there is none yet — [remembering-vision.md](remembering-vision.md).)

The ranking that governed the stances survives, with the nudge in their place: **the entitlement
rules, then the reader's own words, then the nudge.** The research behind the nudges and the hint
ladder is [261002c](../research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md).

**What the stances left behind.** Old rows keep their stored `stance` (the column and its CHECK
stay; dropping them is destructive and buys nothing); nothing writes or shows one. The route still
accepts a `stance` on an ordinary Remember send, validated against the old four and then dropped, so
a tab open across the deploy does not 400 — kept indefinitely, because a tab can stay open for weeks.
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md).

## The prompt is the feature

Everything else here is plumbing around a page of instructions about tone, so
[`evals/remember-recall.ts`](../../evals/remember-recall.ts) came **first** and runs again after every
prompt change: thirteen readers against a real article, read by a person (eight readers × four
stances until 2026-10-02, when it was `remember-stances.ts`). Each is a way the prompt has
misbehaved rather than a spread of inputs. The original eight cover a reader who is right, one whose
reading the piece genuinely permits, one who understood it and disagrees, mangled dictation, being
lost, an incomplete account, a genuinely open question and *"just tell me"* after a nudge. The five
added for one voice cover a weak account, remembering almost nothing, a failed nudge, unclear
references and an expert account that needs a harder cue rather than praise.

The three faults that draft had are worth knowing before editing the prompt, because all three are
the obvious thing to write. They are recorded in full on `REMEMBER_SYSTEM` in
[`src/converse.ts`](../../src/converse.ts); in short:

1. **It treated the model's reading as ground truth.** Socratic makes that worse than Respond does —
   a leading question smuggles in a premise the reader cannot argue with. Hence the long
   *what you are and are not entitled to say* section, which is the one to leave alone.
2. **Balanced asked the model to infer a mental state** from one compressed spoken paragraph.
3. **It forbade grading and then listed the ingredients of a grade.**

A second review, of the built code and the eval's real output, found three more — all of them things
the prompt *said* correctly and the model did not do:

4. **A correction can be built out of the model's own inference.** The sharpest case: the article
   lists analogue and neuromorphic computing as things that "might yet be" up to the job, a reader
   said exactly that, and the model reasoned from a *different* argument to tell them they were
   wrong — contradicting the sentence it had just quoted. So the quoted sentence now has to
   contradict them **by itself**; anything reached by reasoning is offered as the model's own view
   or not at all.
5. **"Their words beat the stance" was contradicted** by Socratic's *"ask, do not tell"* and
   Signposts' *"and nothing else"*, both of which read as absolutes — and the model was visibly
   half-obeying both. The ranking survives in the one voice: **the entitlement rules, then the
   reader's own words, then the nudge.**
6. **Confirming and grading were not distinguished.** "Yes, that's his move" points at a claim;
   "that reading holds up well" is a verdict on the reader wearing a friendly face. The first is
   wanted, the second is the sentence to delete.

### What the one-voice runs showed (2026-10-02)

Three runs, Sonnet 5, 13 replies each: `evals/results/remember-recall.261002i-run-1.md`,
`…-run-2.md`, and `remember-recall.md`. The first draft pasted article sentences into its own prose unmarked and uncited (two replies
with no id at all), opened with verdicts ("that tracks", "exactly right") and twice asked two
questions in one reply. The second draft — quotation marks with the id straight after, those openers
banned, one nudge at the end, a word target — cited in every reply and kept all thirteen under 160
words; `lost`, `dontRemember` and `nudgeFailed` were told before anything was asked. It was not yet
the requested voice: six replies ran past the 120-word target, `correct` and `defensible` still opened
with verdicts on the reader, `unclear` was corrected after the model guessed what two vague phrases
referred to, `disagreement` asked two separate questions, and `nudgeFailed` asked for the implication
of the answer it had just supplied. The prompt now names vague references as clarification cases,
forbids a verdict as the opener, tells a failed nudge to move elsewhere, sets 120 as a ceiling and
permits exactly one interrogative sentence.

The third run, after those: every reply cited, ten of thirteen under 120 words (`lost` ran to 173,
explaining the section it had been lost in, which is what it should do), and the stuck readers told
before anything was asked. "That tracks" survived its ban as an opener in two replies, and `unclear`
was still corrected from the quoted sentence rather than asked — both mild. One real fault: `expert`
told the reader the free energy principle "doesn't actually appear anywhere in the piece", when it is
in a footnote the model is not shown. So the entitlement rules now forbid telling a reader the
article does not mention something. (Most of the eval's "actually" hits are inside quotations of the
article, and are not the model's.)

### What the first run showed

`evals/results/remember-stances.md`, 2026-08-27, Sonnet 5, 28 answers. The cases that were meant to be
hard came out right: the reader who disagreed was engaged with as an interlocutor rather than
corrected; the defensible reading was confirmed and then made more precise; the garbled dictation was
read straight through to its meaning with the mangled words never mentioned; and Balanced **told**
the reader who said they were lost rather than questioning them.

One real gap, and it is fixed: seven of the twenty-eight answers quoted the article and bracketed no
block id — the app's central contract, missed in exactly the place it matters most. One line
(*"every quotation carries the id of the block it came from"*) took that to two.

**The second review read the same transcript and found what the counters could not**, which is the
argument for a person reading it: the invented correction in the `defensible` case, the summative
openers, and a Socratic reply still asking a question of somebody who had said they were lost. The
prompt was revised against all three and re-run: the `defensible` reply now reports where the essay's
*weight* falls rather than asserting the reader is wrong, `lost` is explained in plain words before
anything is asked, and a new `justTellMe` case — a second turn saying only that, into a Socratic
conversation — is answered plainly by all four stances.

It also found two faults in the **eval itself**. It discarded `truncated`, so a reply that hit
`max_tokens` mid-word was reported as an ordinary answer and would have been scored for an ending the
model never wrote; that is now surfaced loudly. And the `ambiguous` case was not ambiguous — the
article settles it in the word "necessary" — so it tested the wrong thing and has been replaced.

The banned-phrase counter in the eval is deliberately over-broad and is **a prompt to look, not a
verdict**: the latest run's six hits are all the word *actually* in a quotation or a claim about the
article rather than a verdict on the reader. A green count with a patronising answer under it is the failure
[silent-success.md](../reusable/silent-success.md) is about, so the report prints every answer in
full and the pass condition is a person reading them.

## Tutorial, the third sub-mode

**Built 2026-10-02**, from Greg's report `spya-j0scgz`:

> I guess what I want to do is alternate like you providing a brief summary and then asking me to
> say it back in my own words. … maybe it's more of a tutorial. Let's call it tutorial. … your
> responses should be fairly brief because we want this to be a quick back and forth. … Take into
> account anything from the user profile or the why are you reading this information. … lots of
> small increments is probably better than big, slow increments.

The chips read **Recall · Tutorial · Quiz** (`?remember=tutorial`). Where Recall is closest to
testing — the reader brings what they have — Tutorial is closest to teaching: each turn is a brief
reaction, **one** small cited piece of the article, and **one** task (say it back, explain why, give
an example, apply it, push back), climbing as the reader succeeds and stepping down when they do
not. Every few turns it reaches back to an earlier point. A reader who has not read the piece is
started from zero with a question they can answer without it; an expert with a narrow reason for
reading is taken straight to it. The research is
[261002c](../research/261002c-recall-and-tutorial-pedagogy-for-remember-mode.md); the prompt is
`TUTORIAL_SYSTEM` in [`src/converse.ts`](../../src/converse.ts), sharing Recall's spoken-input and
citing sections by interpolation.

**Why a reader who has not read it is allowed.** § Why this one is not the anti-goal rests on
Remember being unusable without reading, and Tutorial is not. Greg decided the case himself —
*"it may be that the user says nothing. I haven't read it yet"* — so Tutorial is built as **guided
reading**: every piece it teaches is a short quotation or close paraphrase with its block id,
sent back into the article, never a summary standing in for it.

**The machinery is Recall's.** A fourth `ThreadKind`, `tutorial`, one per article
(`chat_threads_one_tutorial`, beside Remember's index; `SINGLE_THREAD_KINDS` in
[`src/types.ts`](../../src/types.ts) is the one list `targetOf` and `ConversationBand` read). Same
band, same panel, same tall dictation box, Start over, Remember's long length cap, chat's job and
model. **No Live yet**: Greg named voice as the ideal home and also said Live *"doesn't work very
well at the moment"*, so the band passes no Live controls and `SpokenKind` stays `chat | remember`.
The empty state asks the opening question, so the reader speaks first and the model never writes an
unprompted turn.

**Eval**: [`evals/remember-tutorial.ts`](../../evals/remember-tutorial.ts) — three scripted readers
(has not read it, remembers some, an expert with a profile and a narrow goal), five turns each,
read in full. Five runs (`evals/results/remember-tutorial.261002i-run-1.md` … `-run-4.md`, then
`remember-tutorial.md`). The substance was right from the first: the reader who had not read it was
started from zero and asked a prediction, a stuck reader got a simpler explanation with a concrete
example, the expert was taken straight to the argument they named and asked where it was weak.
What needed work was length and links — 8 of 15 turns over 120 words at first, one expert turn of
208, and the opening turn of every reader citing nothing. A 100-word target with a 140 ceiling,
"harder questions, not longer turns" for experts, a reach-back by the fourth reply, and a one-line
reminder in the final user message (the recency lever chat's length line uses) brought run 4 to all
fifteen under 140 words and thirteen of fifteen cited. A browser pass then caught the not-read
reader's opening paraphrase with no link, so the start rule now names the opening claim's block id
and the reminder covers paraphrase too: run 5 had every opening turn linked, fourteen of fifteen
cited, and none over 112 words. Still imperfect: "that's exactly" survives as an opener twice, and
one opening turn asked a two-part question.

## A Remember conversation IS a chat thread

Greg's own reading — *"this is effectively a Chat"* — taken literally, which is where nearly all of
the reuse comes from. Same table, same store, same streaming route, same citation contract, same
tools, same stop / retry / edit / recovery. Untouched: `converse`'s loop, the tool loop,
`openRouterStream`, the frame protocol, `useChat`'s optimistic rows and stream recovery,
`citations.ts`, `Turn`, `Answer`, `ToolStrip`, the sweep, `inTurnOrder`.

**But on screen it is its own thing, and there is one per article** — Greg, 2026-10-01, report
`spya-peszam`:

> The Remember mode should be its own single, special conversation thread (not visible from Chat,
> nor should other Chat threads be visible in Remember mode). It's a special kind of conversation
> thread just for helping the user to remember from the article, with its own special UI (e.g. for
> more Socratic responses, etc).

He chose, of two designs, to keep the shared machinery and separate only the screen; rebuilding
Remember on its own storage was the option passed over. So the reuse above stands, and three things
make it one thread:

- **The database says so**: a partial unique index, `chat_threads_one_remember`, on `article_id`
  where `kind = 'remember'`. An article has one owner, so this is one per article per reader.
- **A second one cannot be started by accident.** The client mints thread ids, so a stale tab can
  ask to begin a new Remember thread. `withTurn` appends that typed turn to the existing one instead,
  and the `begin` frame names it; `withSpokenTurn` treats it as the existing one too, so the live
  tail guard refuses it rather than appending under turns it never saw.
- **Older articles' Remember threads were folded into one** by the migration that added the index:
  messages moved whole, conversation by conversation, into the earliest thread.

[261001m](../plans/261001m-remember-is-its-own-single-thread.md) has the reasoning and the review.

Two fields were added, and both are the kind that goes wrong quietly.

### `kind` belongs to the thread

`ChatThread.kind` is **required**, not optional — an optional field means a `?? "chat"` at every read
site and one of them would eventually be missed, which is a Remember turn answered with chat's prompt
and nothing on screen disagreeing. Stored threads that predate the field are normalised to `"chat"` once
on load, in each store (`normaliseKind` in [`src/chat.ts`](../../src/chat.ts), and `threadsFor` in
[`src/store/pg-chat.ts`](../../src/store/pg-chat.ts)). Making it required is what turned this from a
question of discipline into four compiler errors.

- **The prompt is chosen from `begun.thread.kind`**, never from the request body. Those agree only
  when the request was right, and it comes from a tab that may be several navigations out of date.
- **Written on insert only** — absent from `upsertThread`'s `onConflictDoUpdate.set`, beside
  `created_at` and the anchor columns.
- **A contradicting kind is refused**, in two places: the route answers 409 with a sentence a person
  can act on, and `withTurn` refuses it again inside the Postgres transaction, because the route
  reads under `inTurnOrder` and that is only per-process.
- **Retry and edit send no kind at all** — their thread already has one, and the route 400s one that
  arrives. That refusal happens *before* `settleThread`, because a request rejected after it has
  already aborted the answer another tab's reader was watching.
- **A Remember thread cannot be anchored.** No gesture starts one from a selection, so an anchor
  with `kind: "remember"` is a 400. That is worth more than tidiness: it means every mark in the prose
  belongs to a chat, which is what lets the floating `ChatDialog` go on being chat's.
- **A stance on a chat is refused**, because the check constraint can only say "assistant rows
  only" and the invariant is "Remember threads only". An invariant the database cannot express is one
  the route has to.
- **The length cap resolves the thread's kind too.** Reading only the request's was a bug: an edit
  sends no kind, so every edit was measured against chat's 4,000 and a 4,001-character Remember
  message could be created and then never rewritten.

### The stance belonged to the turn, and is legacy now

Until 2026-10-02 `ChatMessage.stance` was written on the **pending** assistant row and carried by
name across a retry and an edit (from the answer being replaced). Nothing writes it now and nothing
carries it; a retry or an edit of an old answer is answered in the one voice. The help flag, which
lives on the **question** row, is a different rule and still crosses both
(`tests/remember-store.test.ts`).

## Where each piece lands in the prompt, and why it costs what it does

```
   ┌────────────────────────────────────────────────────────┐
   │  system:  SYSTEM  or  REMEMBER_SYSTEM                  │  ← the KIND
   ├────────────────────────────────────────────────────────┤
   │  user:    the whole article, with block ids            │
   │           ▒▒▒▒▒ cache_control: ephemeral ▒▒▒▒▒         │  ← THE BREAKPOINT
   ├────────────────────────────────────────────────────────┤
   │  assistant: "I've read it. Tell me what you took…"     │
   │  … the last 20 turns …                                 │
   │  user:    position · profile · anchor                  │
   │           what the reader said                         │
   └────────────────────────────────────────────────────────┘
```

Everything above the breakpoint must stay byte-identical for the life of a conversation or the whole
article is written to the cache again every turn — the bug in
[260826h-chat-cache-automatic-breakpoint.md](../postmortems/260826h-chat-cache-automatic-breakpoint.md). So:

- **anything per-turn** goes below it. The stance did, until it went: switching it mid-conversation
  was the expected use, and in the system prompt that gesture would have cost a cold write of the
  article every time.
- the **kind** goes above it, because one prompt carrying both sets of rules would ask the model to
  hold two contradictory sets of instructions about tone. One more prompt is one more prefix, paid
  on entering the mode rather than per turn.
- the **canned assistant line** differs by kind and is free, because it sits below the breakpoint.
  "What would you like to know?" is the wrong sentence to put in the mouth of a conversation where
  the reader is the one about to talk.

"Two prefixes, paid once" is the normal path rather than an invariant: a cold first use earns nothing
back unless a second request lands inside the TTL, concurrent cold requests can both write, and a
change of model or tool set makes its own entry. `tests/remember-prompt.test.ts` proves the bytes are
identical and **cannot** prove the provider read them; the eval run above reported
`cacheReadTokens: 25226` against a 25k-token article, which is the half that costs money.

## On screen

The mode band, the eighth value in `MODES`, last in the dock — the order runs outward from the
article's own words to the conversation about it, and Remember is one step further out again as the
only mode whose content comes from the reader.

**Remember has no list; it opens its one conversation.** Until 2026-10-01 the list was shared — both
modes showed every thread, a Remember row carried a `remember` tag, and opening one from chat moved
`?mode=` with `?thread=`. Since `spya-peszam` (above) each mode lists only its own kind: chat shows
chats, and Remember shows its single thread directly, with no list, no `+`, no rename and the header
reading *Remember*. The thread is **derived during render** — the stored one if there is one, else
one begun locally — and `?thread=` is only synced to it afterwards, so neither a stale `?thread=`
nor the first frame of a load ever shows a list. Delete stays, as **Start over**. An active Live
conversation finishes writing its last exchange before the DELETE starts, and the fresh thread is
not begun until that DELETE has finished: begun sooner, a spoken or typed turn could be appended to
the old thread a moment before the delete cascaded it away. **Start over is offered only once the
conversation is stored and settled** — it has a message, the server has named it, and nothing this
tab started for it (an answer, a spoken exchange) is still out (`settled` in `useChat.ts`). So its
DELETE always names a thread the server knows and never has to wait for one, and an empty, unnamed
or half-answered conversation simply has no button.

**The box is smaller on a short screen.** Six rows at rest on a desktop; on a viewport under 500px
tall — a landscape phone, where the band is about 338px — it is two rows at rest and grows with
what is said, up to 30% of the screen's height, so the transcript stays in view.

The floating `ChatDialog` opens only for a thread whose summary says it **is** a chat — a positive
test. `!== "remember"` was the first version and had its default backwards: an unknown thread (a
stale id, or summaries not yet fetched) came out as a chat, so a Remember URL flashed the chat dialog
on every load and a missing thread sat on "Starting…" forever.

**One panel, parameterised by kind, not two panels.** The transcript, the scroll-follow, the citation
chips, the tool strip, the retry, the editor and the stream recovery are identical in both; what
differs is an empty state and a box six rows tall instead of one. Likewise one
`ConversationBand` in `modes/conversation/ConversationModes.tsx` with one `useChat`, rather than a
second chat state machine.

**Live works in a Remember conversation too, and is saved as one** — including when it is the
first thing said in the empty conversation Remember opens with. Spoken rows carry no stance.
[live-conversation.md](live-conversation.md) has the rule and the bug that prompted it.

The composer's microphone is **the existing** `useDictationField` ([dictation.md](dictation.md)) —
same hook, same two-pass transcription, same priming with this article's glossary — with a label
beside it and first place in the row. Greg:

> the input box should be much larger for Review mode, and probably emphasise the microphone UI,
> because talking will be much less annoying than typing.

Because talking is the expected input, a Remember turn has **its own length limit**
(`MAX_REMEMBER_CHARS`, 20,000) rather than sharing chat's 4,000: that number is a considered cap on a
typed question and an accident applied to a spoken paragraph, and a reader who talked for four
minutes would have hit it after paying for the transcription. Same mistake `MAX_QUOTE_CHARS` had to
be rescued from.


## What is deliberately not here

- **No no-spoilers rule keyed on `?at=`.** That parameter is where the reader is *now*, not how far
  they have read, and the likeliest reader here has finished the piece and scrolled back to the
  paragraph they want to talk about. Using it as a progress marker would suppress exactly the
  corrections the mode exists for. The prompt honours an *explicit* request instead.
- **No model-written title.** A thread is named from the reader's first 60 characters, which for
  speech will regularly be *"Um, so I suppose what I took from this was…"*. Since 2026-10-01 that
  title is shown nowhere — Remember's header just says *Remember* — so there is nothing to rename.
- **No list of Remember conversations**, and no second one (§ A Remember conversation IS a chat
  thread). Remember's own controls are still to come; Greg's report names more Socratic ones.

## See also

- [quiz.md](quiz.md) — the band's other half, where the questions come the other way. Not a
  conversation, and deliberately: *"it's just a question then answer"*
- [260826a-chat-mode.md](../plans/260826a-chat-mode.md) — the mode band, the citation contract, the panel this reuses
- [chat-tools.md](chat-tools.md) — the tools, and the rule about never claiming one you did not run
- [dictation.md](dictation.md) — the microphone
- [prompt-caching.md](prompt-caching.md) — the breakpoint this is careful about
- [vision.md](vision.md) — *recall*, the nearest thing already written down
