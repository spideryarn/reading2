# The blue chip opens what it is counting, the "?" says so, and the answer teaches

**Status:** building, 2026-09-05. Three reports from the morning of 2026-09-05, all from Greg, all
about the same strip of pixels: the gutter's chips, the conversation one of them makes, and the
answer that comes back. Wave 1 of
[260905b-feedback-reports-batch-three.md](260905b-feedback-reports-batch-three.md).

Sits directly on top of
[260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md](260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md),
which landed this morning, and finishes
[260904b-gutter-help-button-and-detached-streaming-chat.md](260904b-gutter-help-button-and-detached-streaming-chat.md)'s
**stage 4**, which was never built.

## The three reports

**[1Q](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Q)** — problem:

> I tried to click on a blue Comment box in the vertical gutter next to the Text to see previous
> comment and model response, but it showed me the panel for a new Comment. I think it should have
> shown the previous Comment with a way for me to add new comments to the same block if I want to
> somehow. Get product input from Fable, and use GPT Sol for adversarial review with a bias towards
> simplicity/cleanness.

**[1R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1R)** — suggestion:

> When I use the Question Mark button in the vertical gutter of a block to ask for further
> explanation, add some simple type-metadata to that Comment to indicate it was a
> request-for-explanation

**[1S](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1S)** — suggestion:

> When I click the question-mark-comment in vertical gutter, it should explain in easy-to-understand
> language, starting with brief summary, and drawing on pedagogical techniques, e.g. worked example,
> analogy, etc

## 1Q: the report names the wrong chip, and that is the diagnosis

A symptom is a lead. Traced in code before anything was designed, and the trace changes the job.

**The gutter has two marks that carry a count**, and only one of them is blue:

| chip | class | colour | what a click does today |
|---|---|---|---|
| the bookmark | `.blk-cmt` | `--highlight`, **orange** | `onOpenComment(first.id)` → `?note=` → `CommentDialog` **on the existing comment**, with its n-of-m stepper |
| the chat | `.block-chat.has` | `--chat-mark`, `oklch(0.72 0.12 235)`, **blue** | `chatAboutBlock` → a **fresh draft**, every time |

So the orange one already does what 1Q asks for; the blue one does not. And "previous comment **and
model response**" settles it independently: since 2026-08-28 a comment carries no model answer —
[comments.md § What a comment is now](../project/comments.md) — so the only place a reader's words
and a model's reply sit together is a conversation. **The chip Greg pressed is `.block-chat`.**

The bug, stated as an asymmetry rather than as a missing feature, which is why it is a bug and not a
suggestion: `helpAboutBlock` ([`App.tsx`](../../src/web/App.tsx)) already reopens an existing
conversation rather than repeating it, and documents at length why. `chatAboutBlock`, twenty lines
above it, never does — while the button it feeds renders `has` and a count badge saying
*"Chat about this paragraph (3 already)"*. **The chip advertises state it will not show you.**

### Measured in a browser, not inferred

Playwright against system Chrome on the box, signed in as the owner of `/read/fowler-phrenology`,
2026-09-05. Both halves confirmed, and one thing found that the report did not say:

| | |
|---|---|
| `.block-chat.has` at rest | `oklch(0.72 0.12 235)` — `--chat-mark`, blue. **This is the chip Greg pressed.** |
| `.block-chat` on hover | `#DB8A45` — `--highlight`, orange. Blue at rest, orange under the pointer. |
| `.blk-cmt`, rest and hover | `#DB8A45` — orange either way. Never blue. |

On block `spya-dfqq59`, which already had three conversations and a visible `3` badge, clicking the
chip opened a dialog reading **"ASK ABOUT DFQQ59"** and *"Nothing is asked until you send"* — a blank
composer, with none of the three transcripts. Clicking `.blk-cmt` on a commented block opened that
comment, its body and its actions, exactly as the report says it should have.

**And the count went 1 → 2 → 3 across three presses.** So this is not only the wrong panel: every
press of a chip that says "3 already" *creates a fourth conversation*. The reader is not just
prevented from reaching what they have — they are quietly accumulating duplicates of it, and the
badge they pressed to escape gets bigger each time. That raises the report from a misrouted click to
something that degrades the data the gutter is drawing from.

Screenshots: `chipbrowser-06`…`-10` (scratchpad, 2026-09-05).

### Fable's call, 2026-09-05

Asked for, by name, in the report. Quoted rather than paraphrased where the reasoning is load-bearing:

> `.block-chat.has` opens the existing conversation, in the existing `ChatDialog`, at `?thread=`.
> Exactly what clicking a blue `mark.chat` in the prose does today, so the mark and the gutter chip
> agree.

and on the one control it adds:

> One `Plus` button in the `ChatDialog` header … once the chip reopens, whole-block "new
> conversation" has no other door — selection only reaches phrase-anchored chats. A header button on
> a panel that exists is the boring option; a menu on the chip, a long-press, or a modifier-click are
> all invisible.

Taken as written. Three consequences worth naming here so they are decisions rather than discoveries:

- **The composer at the foot of `ChatDialog` is the "add another comment to the same block"** the
  report asks for. It already exists; reopening is what makes it reachable.
- **Several conversations: the newest wins, and there is no stepper.** Deferred, below.
- **The "?" is untouched.** Its rule must stay *tighter* than the chat button's, because a press
  spends money — it admits only whole-block anchors, and only mints when none exists. Greg ruled two
  doors over Fable's one on 2026-09-04 ([260904b § the trade](260904b-gutter-help-button-and-detached-streaming-chat.md));
  this plan does not relitigate it.

## 1R and 1S are one mechanism, and 260904b already designed half of it

The "?" does not make a comment. It makes an **anchored chat thread** — so 1R's "type-metadata to
that Comment" lands on the thread, which is the row that exists. That is the only liberty this plan
takes with the reports' wording, and it is taken because the alternative is inventing a comment row
nothing else would ever read.

[260904b § no new `ThreadKind`](260904b-gutter-help-button-and-detached-streaming-chat.md#no-new-kind)
settled the shape after a GPT Sol review, and it stands:

- A fourth value of `chat_threads.kind` is **refused**, and the refusal is load-bearing rather than
  fastidious. `kind` gates whether a thread may be anchored (`routes.ts`, written as `!== "chat"`
  *"so that a fourth kind is anchor-less by default and has to argue its way in"*), and an
  unanchored thread draws no mark — *"which is what lets the reading view go on treating every mark
  it draws as a chat"*. **A help conversation is an anchored chat.** It stays `kind: "chat"`.
- The prompt difference travels as a **per-turn `help: true` on the POST body**, and lands in the
  **final user message**, below the `cache_control` breakpoint, so `systemFor` does not branch and
  the article prefix stays byte-identical — [prompt-caching.md](../project/prompt-caching.md).

**What 1R changes is the one thing 260904b gave up.** Its own words:

> **Countability is what is given up**; nobody asked for it, and a `help: true` in the request log is
> still countable server-side if it turns out to matter.

Somebody has now asked for it. So this plan builds the per-turn flag *and* persists it — but as a
**narrow column of its own, not as a `kind`**, which keeps every reason above intact.

### The column — and GPT Sol moved it to the other table

The first draft of this plan put `from_help` on **`chat_threads`**, written on insert only. Sol's
review (F-01, P1) moved it to **`chat_messages.help`**, and it is right, for a reason the thread
design could not answer:

> Retrying the first help answer would therefore lose the pedagogical instruction and become an
> ordinary chat answer. That is user-visible wrong behaviour.

The thread design had to *refuse* `help` on retry and edit — those turns do not create a thread — and
a refused flag means the retried answer is answered with the ordinary prompt. The reader presses
"Try again" and silently gets a different kind of answer.

So: **`chat_messages.help boolean`, on the reader's own request row.** Then

- `withTurn` marks the user message it creates;
- `withRetry` and `withEdit` already carry that stored row forward, so the route reads `help` off
  **storage**, never off the request body — the rule `kind` and `stance` already follow;
- follow-up questions carry nothing, because they are ordinary questions;
- "how many explanations were asked for" is a query over message rows;
- and "this conversation began with a help press" stays derivable from its first message, without a
  second copy of the fact on the thread.

The wire stays `help?: true`, validated as **absent or literal `true`** and accepted only on a new
question.

**The backfill is deferred, and that is a partial overrule of Sol's F-02.** He is right that the "?"
already shipped (2026-09-04) and that existing help requests will read `false`, which is not the same
as *no*. But the repair he proposes is a heuristic `UPDATE` — matching stored question text against
two historical `HELP_QUESTION` wordings — over **real readers' stored words**, and
[CLAUDE.md](../../CLAUDE.md) says an ordinary additive migration may be applied unattended while
anything that overwrites data we did not create is asked about first. A text-matching rewrite is the
second kind. So the migration ships **additive only**, and the preflight `SELECT` plus the exact
`UPDATE` is handed to Greg to run or refuse. The window is one day wide and the rows are his own.

## What ships, by stage

Two stages, not the four the first draft had — Sol's F-06, and he is right that a flag with no
consumer is a bad commit to land on its own. Each ends green, committable, and with its own docs.

### Stage 1 — the blue chip reopens (1Q)

- `threadFor(summaries, blockId)` beside `helpThreadFor` in
  [`useChatAnchors.ts`](../../src/web/useChatAnchors.ts), with **Sol's ordering, not Fable's flat
  "newest"** (F-04):

  1. the newest **whole-block** chat on this block;
  2. otherwise the newest **selection** chat on it;
  3. otherwise no match, and `chatAboutBlock` mints today's draft.

  Fable had the chip open whatever was newest, on the ground that the count already includes
  selections. Sol's objection is the better one: the count justifies opening a selection thread when
  there is no paragraph conversation, and does **not** justify letting a newer three-word selection
  displace the paragraph conversation the reader is pointing at. `kind === "chat"` is filtered
  **positively**, so the reading-view mark invariant is stated here rather than borrowed from the
  route's correctness.
- `chatAboutBlock` ([`App.tsx`](../../src/web/App.tsx)): existing → `setThread(existing.id)`; none →
  today's draft. `?note=` and the draft are cleared either way, exactly as `helpAboutBlock` does, so
  [url-state.md](../project/url-state.md)'s mutual exclusion holds.
- **Copy, made truthful** (F-05). The first draft's *"Your conversations about this paragraph (3)"*
  promises the set and delivers one, and its singular `aria-label` hid the count from a screen
  reader. Both strings become the same sentence: **"Open a conversation about this paragraph (3
  total)"**. Without `.has`, unchanged. Pinned by exact-string test, as the gutter's others are.
- **The door to a new conversation stays**, as one more `linky` in `ChatDialog`'s existing
  `.chat-dialog-actions` row — see § Sol wanted this cut.

**Red first**: a click-level test on the real App — a block with a stored thread, click the gutter
chat chip, assert the panel shows that thread and not an empty composer. It must fail before the fix.
Plus pure-helper cases for `threadFor` (F-08): newest whole-block; whole-block preferred over a newer
selection; selection as fallback; non-chat kinds ignored; no match.

**The trap Fable named, and it is real**: `threadFor` has to run against `chatSummaries` *after*
`foldInLocalWrites`, or the first press after starting a chat mints a second one. The same
before-the-list-has-loaded tolerance `helpAboutBlock` documents applies here and is accepted, not
fixed.

Docs: [web-client.md](../project/web-client.md) in this stage, not deferred (F-06).

### Stage 2 — the press is recorded, and the answer teaches (1R + 1S)

One vertical mechanism: wire flag → stored request metadata → prompt chosen from storage.

- `help?: true` on the POST body, validated as absent-or-literal-`true`, accepted only on a new
  question. `ChatMessage.help`, `chat_messages.help`, and the route reads it back off the **stored
  user row** so a retry or an edit of a help question is still answered as one.
- The files, named rather than left conditional (F-07): `src/types.ts`, `src/store/contracts.ts`,
  `src/chat.ts` (`withTurn`, retry/edit preservation), `src/db/schema.ts`, `src/store/pg-chat.ts`
  (`toMessage`, `messageRow`), `src/routes.ts`, `src/web/useChat.ts`, `src/web/ChatDialog.tsx`,
  `src/store/export.ts`, `tests/helpers/seed-reader-state.ts`, and the migration SQL, snapshot and
  journal. `drizzle-kit generate` needs a TTY on this box — [database.md](../project/database.md).
- `helpSection()` in [`converse.ts`](../../src/converse.ts), joined into the final user message
  between `about` and `how`. **Nothing above the breakpoint moves**; the regression assertion Sol
  named is `cachedText(helpMessages) === cachedText(ordinaryMessages)`.
- **No UI.** F-11: the conversation list already has a kind-label surface
  ([`ChatPanel.tsx`](../../src/web/ChatPanel.tsx)), so "add a label if one exists" would definitely
  add a visible tag. 1R asks for metadata. Metadata ships; presentation is deferred.

#### What `helpSection()` says, decided here rather than in the implementation

Sol's F-09, and he is right that this belongs in the plan. It is **not** written from scratch:
[`explain.ts`](../../src/explain.ts) already holds a pedagogical prompt built for exactly this
reader, and reusing its principles beats inventing a second vocabulary for the same job.

From `explain.ts`, kept: *what the reader has to bring to it* is usually the real question; do not
describe the page they are looking at; keep the author's distinctive words and use ordinary ones for
everything else; do not summarise the article.

From Greg's 1S, added: **open with a brief plain-language orientation to what this passage is
doing** — one or two sentences, not a summary of the piece — and **reach for one analogy or small
worked example where it does more than another restatement**.

From [vision.md](../project/vision.md), the constraint on both: the answer sends the reader back into
the passage better equipped. It does not stand in for it. `SYSTEM` already says this
(*"make deep reading cheaper, not optional"*) and the addendum must not quietly undo it by asking for
something the reader can read instead of the paragraph.

**A byte test proves placement, not pedagogy** (F-09). So the wording also gets a small live check —
one dense argumentative block, one unfamiliar term, one block whose prerequisite is earlier in the
piece — read by a person, not asserted.

### Stage 3 — the model was offered a search and declined it (1X)

**[1X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1X)**, arrived mid-build, kind
*problem*:

> I added a Comment, asking about evidence for a claim, hoping that it would automatically know to
> and be able to automatically search the web. It didn't seem to do that :(

#### The brief's premise was wrong, and that is the finding

The report was handed to me as a bug in [`explain.ts`](../../src/explain.ts), whose header records
Greg asking for model-invoked search on 2026-08-25. **`explain.ts` is not on this path at all.** Since
2026-08-28 a comment's *"Also ask the AI"* opens a **chat**: `AnnotateDialog` → `App.tsx` sets a
`chatDraft` → `ChatDialog` → `POST /api/chat/:slug` → `converse.ts`. `explain.ts` is reached only by
the legacy *Try again* / *Search the web* answer route and by glossary lookups.

**And nothing is dropped.** Verified three ways rather than read once:

- `ai-call.ts` spreads the caller's body verbatim and the chat route sets `require_parameters: true`,
  which is the guard against a provider fallback silently discarding tools;
- `tests/chat-tools.test.ts` asserts on the **serialised `fetch` body** — 89 passing;
- and production logs a chat turn on the Kuhn article at 07:46:40Z with **`searches: 1`**. A search
  cannot happen if the tool never went out.

**The actual turn Greg is describing** is in the Vercel logs: 10:00:06Z a chat turn starts on the
bigger-brains article; 10:00:23Z it finishes `rounds:2, tools:2, roundCalls:[2,0], searches:0`. The
model ran two of *our* tools and no web search. **It was offered the search and chose not to take
it.** So this is not plumbing — it is the instruction.

#### Why it declined, which is the fixable part

`SYSTEM` in `converse.ts` gives search **one bullet** in a list of four, and the very next bullet
pushes the other way:

> DO NOT reach for a tool to do something the article in front of you already answers. It is all
> here.

`NO_UNRUN_TOOL_CLAIMS` then adds *"If you have not searched and do not need to, say what you know
without dressing it up as a lookup."* Meanwhile `explain.ts` — the path Greg is **not** on — gives it
a whole titled section, **WEB RESEARCH: LEAN TOWARDS SEARCHING**, with *"Reach for it BY DEFAULT"*.

*"What is the evidence for this claim?"* is exactly the question that looks answerable from the
article. So the chat prompt talked the model out of the search that the explain prompt would have
talked it into. **That asymmetry is the bug**, and it is a prompt change, not a feature.

#### What ships for 1X

1. **Name the evidence case as a search trigger** in `converse.ts`'s tool section, borrowing
   `explain.ts`'s wording rather than inventing a second one, and **narrow the anti-search bullet**
   from *anything the article answers* to *what a paragraph plainly says*. A reader asking whether a
   claim holds up is asking about the world, not about paragraph four.
2. **Repair a tripwire that cannot fire.** `explain.ts` initialises `from = "no-usage"` and only
   assigns it when a count was found, so the value `"neither"` — the alarm its own comment says
   exists to catch OpenRouter renaming the usage field — **can never be logged**. Production is
   printing `searchesFrom: "no-usage"` today *beside populated token counts from the same `usage`
   object*, which is the alarm already lying. Two lines, and it is precisely
   [silent-success.md](../reusable/silent-success.md)'s shape: a check nobody has seen fail. Also log
   `searchesFrom` on the chat path, which today reports a bare `0` an operator cannot audit.
3. **Hide "Search the web" on a free comment.** `CommentDialog` renders it whenever `status !==
   "pending"`, which includes `status: "none"` — every free comment — and the server refuses exactly
   that with a 409, *"was never a question, so there is nothing to answer"*. Confirmed by rendering
   the component at three statuses. Not what bit Greg today, but a reader who writes a comment asking
   for evidence and presses a button labelled *Search the web* gets told their comment was never a
   question.

**Deferred, and all three re-open decisions Greg made deliberately:** a search tick-box of its own on
the comment box; auto-sending the pre-filled chat question; routing comments back through
`explain.ts`. None is needed if the wording fixes the behaviour.

**Honest limit:** production Postgres is unreachable from this box, so the event above is read from
runtime logs rather than from `ai_calls`. The logs carry the same `searches` number. And nobody has
watched the strengthened wording actually produce a search on Greg's article — that is a live check,
named in § What is left for Greg.

#### The one place 1S and 1X pull against each other

[1X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1X) arrived while this was being built:
a comment asking for evidence did not search the web. `SYSTEM` in `converse.ts` currently says
**"USE web search unless you are genuinely sure"**, and that sentence is the encouragement 1X is
about.

`helpSection()` must not weaken it, and the risk is specific rather than theoretical: *"open with
one or two plain sentences"*, *"use an analogy"* and *"do not summarise"* all pull towards answering
**from the article alone**, which is the opposite of reaching for the web. A reader who presses "?"
on a claim they doubt wants both — the plain orientation *and* the check.

So the addendum stays about **how to explain**, and says nothing about *where the answer comes from*.
Adding "and search if you are unsure" would be a second, weaker copy of a rule the system prompt
already owns, in a place that only fires on help turns — and two encouragements that can drift apart
is how the first one stops meaning anything.

**Ordering note:** the 1X diagnosis is running as this lands. If 1X turns out to need `SYSTEM`
rewritten, this addendum is deliberately separable from it — it is a distinct string in a distinct
message — and neither change has to wait on the other.

## Sol wanted this cut, and it is staying: the new-conversation door

F-10, P2 — cut the "start another conversation" control, because the reopened thread's composer
already satisfies *"a way for me to add new comments to the same block"*.

**Overruled, with Fable on the other side** — which is what makes this a decision rather than my
preference ([engineering-manager.md](../reusable/engineering-manager.md): an overrule wants somebody
other than the author). Two reasons:

1. **It is a removal, not a missing feature.** Today the chat chip always starts a new whole-block
   conversation. After stage 1 it never does. Without a door somewhere, this change deletes the only
   gesture that starts a *second* conversation about a paragraph — the "?" reopens too, and a prose
   selection only ever reaches phrase-anchored chats. Fable: *"once the chip reopens, whole-block
   'new conversation' has no other door."*
2. **It costs less than Sol priced it.** He assumed new header UI and callback plumbing, which was
   fair against the first draft's `Plus` icon. It is instead one more `linky` in the
   `.chat-dialog-actions` row that already holds *"Open in full chat"* and *"Delete"* — a flex row of
   text buttons, so **no new CSS and no new component**, and `chatAboutBlock`'s draft branch is
   already the callback.

Sol's other cut, F-11 (no help label in the list), is **accepted** — that one really is presentation
nobody asked for.

## Decisions and assumptions, taken without asking

This is an unattended run, so these are recorded rather than raised.

1. **1Q is the chat chip, not the bookmark.** Argued above from colour and from "model response". If
   this is wrong, the bookmark chip already behaves as the report asks and the answer is "it already
   does" — which is why the browser pass in stage 4 checks both chips, not just the one being changed.
2. **1R's "Comment" means the thread.** The "?" creates no comment row.
3. **A column, not a fourth `ThreadKind`.** 260904b's reasoning survives 1R intact; only its
   "nobody asked for countability" premise has expired.
4. **1S is wording, not a mode.** "Drawing on pedagogical techniques" could be a whole explain-mode
   with its own band. It is not being built.
5. **The pedagogical instruction is per-turn.** Explained in stage 3.

## Deferred, named rather than dropped

- **A per-block stepper in `ChatDialog`** ("2 / 3"), for a paragraph with several conversations.
  Earn it when somebody has three.
- **A single "everything on this paragraph" panel** merging comments and chats. That is the fourth
  gutter column [comments.md](../project/comments.md) rejected, under another name.
- **Making `helpThreadFor` prefer a *help* thread** now that origin is persisted. 260904b accepted
  the looser rule explicitly ("Sol's finding 4"); the column makes tightening it possible, and
  tightening it is a separate product call about what the "?" promises.
- **Any change to `CommentDialog`.**
- **A conversation-list label for help threads.** Sol's F-11, accepted.
- **Backfilling `help` onto the "?" presses already in the database.** Sol's F-02, partially
  overruled above: the preflight count is reported, the `UPDATE` is Greg's to run. It is a heuristic
  rewrite of real readers' stored rows, and the migration stays additive.

## Built, and what changed on the way

**Stage 1 — `77e045a6`.** `threadFor`, `chatAboutBlock` reopening, the truthful copy, the
`New conversation` link, six pure cases and a click-level regression test.

Red first, and reddened twice more deliberately, which is the part worth keeping: flipping
`block ?? selection` to `selection ?? block` failed *exactly* the whole-block-beats-selection case
and nothing else, and wiring the new-conversation door to `chatAboutBlock` failed by reopening the
thread the reader was standing in. A test that only ever passes is a test that proves nothing.

Two places the plan was wrong about the code:

- **There were no exact-string tests on the chat button's copy** — only on the "?". Two were added
  rather than any weakened.
- **Every `ChatAnchor` carries a `blockId`, selection anchors included**, so the New-conversation
  link also lights on a selection-anchored thread. Kept deliberately: the chip now reopens the
  selection thread there, so this is the only remaining way to start a whole-block one. Only an
  unanchored Chat-band thread gets no button, and there is a test for it.

**Stage 2 — `078bf436`.** 1R, 1S and 1X together, with a migration that
`Target: postgresql://postgres@127.0.0.1:54362/postgres` confirms went to the local database.

The column gained a **`chat_messages_help_user_only` CHECK** that this plan did not ask for and
should have: `help` may only be true on a `user` row, so an assistant message cannot claim to have
been a question.

### The `send` refactor earned itself on the way in

`useChat.send` took nine positional arguments and its call sites read
`send(…, undefined, undefined, sourceCommentId)`. Adding a tenth is the shape that lets a field land
in the wrong slot, and this repo has already lost `kind` that way
(`tests/chat-kind-reaches-the-server.test.tsx` is the write-up). It is an options object now.

It fought harder than predicted — 21 call sites rather than 5 — but the compiler found every one,
**except the one that mattered**: `tests/help-sends-once.test.tsx` fakes `useChat` inside a
`vi.mock` factory, so nothing type-checks it, and it went on destructuring the old positions. It
went red in the full suite and is fixed. **A mock is a place the compiler cannot see**, which is
worth knowing next time a signature moves.

### Found and left alone — then fixed, one review later

`converse` never passed an `anchor` to `buildConverseMessages` — `ConverseRequest` had no such
field — so `anchorSection`'s docblock claim that the passage is *"sent on every turn"* was not true
on the chat path. Noticed here, left alone on the ground that a prompt change nobody asked for does
not belong in a feedback batch. **GPT Sol's review of the built code confirmed it (F-02, P1) and it
is now fixed** — see § Stage 4.

### Stage 4 — GPT Sol's review of the built code

Three findings, all taken. [The review](260905c-gutter-comment-chip-code-review-sol.md); the verdict
was *land it with these changes*. Each one got a failing test first, and the two mutation runs under
F-03 are the part worth keeping.

**F-01, P1 — `help: true` was shape-validated and not meaning-checked.** The route refused a
non-`true` value and refused one on a retry or an edit, and then handed `help` to every ordinary
`begin`. So it was accepted on a later turn of an existing thread, on an unanchored thread, on a
selection-anchored chat, and on a Remember or Candidates thread — each of which stores a press nobody
made *and* answers the request with the teaching prompt, with nothing on screen disagreeing.

The contract is one sentence (`ChatMessage.help`): the paragraph "?" created this thread. `streamChat`
now requires all three of it — the turn **creates** the thread, the anchor is **whole-block**
(`{ blockId }`, no quote), the effective kind is **`chat`** — each its own 400 with its own sentence,
**refused rather than dropped**, which is the posture the anchor rule beside it already takes. Checked
before `loadArticle` and before anything is written, so a bad body is an ordinary JSON 400 rather than
an `error` frame inside a 200 stream.

Two of the three are shapes of the request body and are settled there. The third is a fact about
stored state, so it is **stated twice**: once early, off the load the character cap already takes, for
the sentence and for not loading an article the request was never going to use; and once under
`inTurnOrder`, where the read is safe from a thread appearing between the look and the write — the
division `kind` already follows, whose store-side twin lives inside `withTurn`'s transaction. Both
were watched refuse on their own; deleting the early one leaves the test green through the second.

Four refusal tests in `tests/chat-help-route.test.ts`, each pinned to its own sentence rather than to
"a 400 came back" — four rules producing one message would be one rule with three tests agreeing with
it. And a fifth, *still lets through the thing the real client sends*, so tightening this further goes
red rather than quiet: `helpAboutBlock` mints a whole-block draft with no kind, which is exactly what
the rules allow.

**F-02, P1 — the stored anchor never reached `converse`.** Fixed here rather than deferred again: it
is confirmed, small, and sits directly under the `helpSection()` this work added, whose first line
says *"the reader pressed the '?' beside this passage"* — only reliably true if the passage is in
front of the model. `ConverseRequest` gained an `anchor`, `converse` passes it through, and the route
passes `thread.anchor ?? null` — **from the thread, never from the request body**, the rule `kind`,
`stance` and `help` already follow.

Nothing moved above the `cache_control` breakpoint: the anchor line lands in the final user message
beside the profile and the position, and `tests/help-prompt.test.ts` and `tests/article-prompt.test.ts`
are both still green. `anchorSection` still fences the quote — the article is untrusted
([security.md](../project/security.md)) — and that was not touched.

Asserted **at the route**, on the request that goes out, because Sol's point was that the existing
builder-level test hands `buildConverseMessages` an anchor itself and therefore cannot see whether
anybody passes one. The test that matters is the follow-up turn, which names no anchor: red before
the fix with the final user message reading `and what follows from that?` and nothing else.

**F-03, P2 — no positive `help: true` export test.** `src/store/export.ts` and
`tests/helpers/seed-reader-state.ts` both hand-build a message projection and both name `help`
correctly, but nothing carried one, so a future edit could drop it in silence — the exact seam those
files' own comments warn about, and the way `tools` went missing once already.

The fixture in `tests/chat-anchor.test.ts`'s round trip (`chat.json` → `seedChatFromFiles` → Postgres
→ `exportArticle` → `chat.json`) now carries `help: true` on its user row, which covers **both**
projections in one pass. Reddened twice to prove it can be: delete the export's line and it fails;
restore that, delete the seeder's, and it fails again. Both mutations are recorded in the file's own
header beside the two that were already there.

## Questions for Greg, if he wants them answered

Neither blocks this work.

- The gutter now has three doors onto one paragraph's conversations (chat chip, "?", and a prose
  mark). 260905b already put one re-ask in front of you about folding the chat button into the "?";
  this plan makes the chat chip *more* useful, which cuts the other way. Worth deciding once.
- Should a help conversation look different in the list — a tag, an icon — or is the metadata enough?
