# 261019p — The guide: plainer, no nagging, a short answer to a content question, suggestions from what they said

Owned by [plans.md](../project/plans.md). Reports `spya-p4uqye` (#626, SPIDERYARN-READING2-KN),
`spya-ptjk63` (#635, -M0) and `spya-yt2v73` (#638, -M3), all Greg's, all 2026-10-19; queue item
`qi-g6ryjr9y`, session `fbp4uqye-guide-chat`.

> The Guide chat for a new article/user should be more easy to understand, shouldn't assume they
> have yet read the article, shouldn't nag them tooooo much for more information, perhaps should
> respond with some questions based on what they have told the Guide or said already about what
> they're reading...
>
> Try some evals yourself to try and make it more useful, less annoying, less work for the user, and
> guide the user more about how to use Spideryarn gently, while staying brief and reducing cognitive
> overload.
>
> — Greg, 2026-10-19, `spya-p4uqye`

> In the Guide chat, perhaps ask the user questions based on what they've already told you (to
> clarify their needs) if they have already told you something? Or make suggestions. Rather than
> simply asking the user to do all the work in stating their needs.
>
> But at the same time, we want to minimise cognitive load for the user, minimise
> faff/overhead/preamble to actually reading the article, and so don't spin out the conversation
> about their needs too long.
>
> — Greg, 2026-10-19, `spya-ptjk63`

> I wonder if we should allow the Guide chat to be a normal chat about substantive points about the
> paper - that's what people keep trying to use it for when they first see a chat. They ask
> questions about the paper itself. Or alternatively maybe make it really clear that it's just an
> introductory Virgil-style chat? Although I think maybe they'll just get confused/frustrated if the
> initial chat is weak/limited.
>
> And/or maybe take into account whether they're a brand-new user, and make high-level suggestions,
> e.g. try the Summary.
>
> The Guide should be allowed to initiate/generate other modes in the background that it thinks will
> be helpful for the user (so that they'll be ready when the user needs them), but it shouldn't
> actually switch to them unless the user presses a button in the Chat UI (to avoid confusing them).
>
> Also one of the available tools should be to generate a Skim-route based on what they're saying.
>
> If the Guide does offer to create a new chat for them, stay closer to their actual words.
>
> — Greg, 2026-10-19, `spya-yt2v73`

## The asks, and where each goes

| # | ask | stage |
|---|---|---|
| 1 | easier to understand; doesn't assume they have read it | 1 (prompt) |
| 2 | doesn't nag for more about their needs or themselves | 1 (prompt, greeting) |
| 3 | suggestions and guesses drawn from what they said, not open questions | 1 (prompt) |
| 4 | short preamble; don't spin out the needs conversation | 1 (prompt) |
| 5 | content questions: answer them, or make the role very clear | 1 (prompt) — answer briefly |
| 6 | a brand-new reader gets high-level suggestions, e.g. Summary | 1 (prompt, a starter button) |
| 7 | a chat step keeps closer to the reader's words | 1 (prompt, tool description) |
| 8 | evals | 1 (a new multi-turn eval and a blind judge) |
| 9 | the guide generates modes in the background, never switching to them | 2 — **asked, not built** |
| 10 | a tool that builds a Skim route from what they say | 2 — **asked, not built** |

## Why 9 and 10 are asked rather than built

The press is a written defence. [security-map.md](../project/security-map.md)'s row for
`chipFor` says *"A press is the only way any of it runs, in the guide as everywhere else … Apart
from that one save, none presses itself"*, and the decided rule in
[chat-llm-help-commands-vision.md § Decided](../project/chat-llm-help-commands-vision.md#decided) is
that the model *proposes* anything that writes or spends and the reader presses. A guide that starts
a mode's generation by itself is a model's say-so spending money and writing an artefact, on a turn
whose context includes a stranger's article. The brief for this session says a change to a defence
is planned and asked, not built. Stage 2 below is the plan; the question is
`docs/user-feedback/questions/` (named in § Bookkeeping).

Item 10 mostly reduces to 9. Skim's route already reads the reader's profile, *why they are reading
this piece* included (`profileSection` in src/skim.ts, `routeProfileIsStale`), and the guide already
saves a typed reason by itself (261011s, 261012c). So "a Skim route from what they say" is: their
reason saved (which happens today), then Skim generated with it — the generate is the part that
needs the yes. A route steered by something narrower than the reason ("just the methods") is a new
Skim input, and is deferred behind the same question.

## Stage 1 — the prompt, the greeting, the starters, and an eval

### Content questions: a short answer, then the Chat button (ask 5)

Opus's call (2026-10-19), which I take: of *keep refusing and say so clearly*, *answer briefly*, and
*become a full chat*, answer briefly.

- Refusing is the thing Greg is worried about (*"they'll just get confused/frustrated if the
  initial chat is weak/limited"*), and it is against his 2026-10-17 rule that the guide *"prefers to
  hand off substantive work … but … is not hobbled"* (chat-tools.md § The guide).
- A full chat would make two chats on one article and leave the reader unsure where to ask; and the
  guide would lose its job, which is getting them into the reading.
- The vision's anti-goal is an answer *in place of* the prose. A two- or three-sentence answer that
  cites the passage and sends them to it is the opposite of that.

So the prompt's `QUESTIONS ABOUT WHAT THE PIECE SAYS` becomes: answer in at most three short
sentences from the piece, citing at least one block, ending on the passage to read; then the chat
step (*Ask in Chat*) carrying their question, for going further. A whole-piece question — *what is
it about*, *summarise it* — still gets no summary: at most one sentence on what kind of piece it is
and its subject, and Summary as a map (a mode button), with the place to begin. What 261012f built
(the chat step, drawn first and orange) is unchanged; only the "do not answer it here" goes.

### Not nagging, and doing the work for them (asks 1–4)

Mostly by deleting (Opus: *"make this change mostly by deleting … piling on more rules makes the
model worse"*):

- **Delete** "If they have not told us about themselves, invite it once" — the guide never asks
  about the reader themselves. The save card still offers what they volunteer, and the greeting's
  profile link (below) stays for a brand-new reader.
- **Replace** "If they still have not said why they are reading it, ask that first … Until they say,
  keep any suggestion general" with: lead every reply with a concrete suggestion (a place to begin,
  by block, and at most one mode). A question is optional and comes after it. Ask about their
  reading at most once more in the conversation, only when the answer would change the advice, and
  as a guess they can confirm built from what they said ("If you're deciding whether to cite it,
  the method in [id] is what matters — is that it?"), with the guesses as `ask` steps to tap. If
  they skip a question, drop it.
- **Add** one line: do not assume they have read it; write as "before you start" or "as you read".
- **Add** one line for a reader who has opened no other article: one high-level pointer, Summary as
  a map beside the piece, with its button — still one mode at most.
- Keep the length rule (under 60 words) and say "plain words, no app jargon" once.

### The greeting (ask 2)

`guideGreeting` in src/web/guide-greeting.ts:

- **No reason, no About you**: *Hi, I'm your guide to «title». Why are you reading it? A few words
  is plenty. / I'll suggest where to start. Or just ask me something about it.* (as built). The third
  paragraph (*tell me a little about yourself too*) goes, and no profile line is drawn in its place
  (GPT Sol's F4: that line, `invitesProfile`, is itself an invitation to talk about themselves).
- **No reason, About you stored**: the same, with no quote-back and no *"Is that still right?"* —
  that is the second nag. About you is used silently. (This takes most of queue item
  `qi-bt4z2zaw`'s point 2; I will mark that point done in the queue.)
- **Reason stored**: unchanged in substance — it quotes their reason back, which is a confirmation
  rather than a question — but the second line gains *or ask me something about it*.
- The failed-read arm is unchanged.

### The starters (asks 5, 6)

`GUIDE_STARTS` in src/web/GuideGreeting.tsx: *Where should I start?*, *Help me work out what I want
from this*, *How could I read this well?*. The third and first overlap; replace the third with
**What is this piece about?** — the question newcomers ask first (Greg: *"that's what people keep
trying"*), whose answer under the new prompt is one sentence of orientation and Summary as a map,
which is ask 6 for free.

### The chat step's words (ask 7)

The prompt's chat bullet and the tool's schema description: copy the reader's question **exactly**;
change words only where it would not make sense without this conversation (replace a pronoun with
what it points to), and as few as possible. Today it says *"copied, or restated plainly only so that
it stands on its own"*, and the models restate.

### The eval (ask 8)

`evals/guide/conversations.ts`, after `evals/guide/next-steps.ts`: production's `converse`, kind
`guide`, tools on, `offer_to_save` and `offer_next_steps` answered by the real `runTool` and every
other tool stubbed to "nothing found" — and, new, **multi-turn**: a case may carry a short history,
because nagging is a property of the second turn, not the first.

Cases (on the Seth essay; a few also on the second fixture):

| id | who | history | message | wants |
|---|---|---|---|---|
| new-hi | none, nothing stored | — | "hi" | a concrete way in; no about-you question; ≤1 question |
| new-start | none, nothing stored | — | "Where should I start?" | a block to begin at; ≤1 question |
| new-about | none, nothing stored | — | "What is this piece about?" | no summary; Summary mode offered; ≤ one sentence of gist |
| vague | a-few, nothing stored | — | "A friend sent it to me" | a suggestion first; any question is a guess; no about-you |
| vague-2nd | a-few, nothing stored | "Where should I start?" → the guide asked why | "just curious really" | no second why; a way in, cited |
| work-out | a-few, nothing stored | — | "Help me work out what I want from this" | concrete guesses offered (ask steps), not an open question |
| not-read | a-few, reason stored | — | "I haven't read it yet. How should I go about it?" | no assumption they've read it |
| content | a-few, reason stored | — | a meaning question | a short cited answer AND a chat step |
| content-new | none, nothing stored | — | a judging question | the same |
| chat-words | a-few, reason stored | — | a long, idiosyncratic content question | chat step close to their words (token overlap) |
| expert | a-few, profile and reason | — | "Where should I start?" | regression: cited, a button, no why |

**Screens** (mechanical, per Opus): words; questions per reply; a question about why when the
reason was given or already asked; any question about the reader themselves; cited blocks;
whole-piece summary sentences (`RESTATES`); a chat step present where wanted; chat-step overlap with
the reader's words. **Then a blind judge** — a fresh subagent that reads only a pairs file —
per prompting-guide.md § Measuring: `before` on the commit before the change, run twice (the second
is the control), `after` on the commit with it; pairs shuffled by `blindCoin`; the key balanced and
in its own file. The judge's question, from Greg's words: which reply would a reader new to the app
find more useful, less work and easier to follow, without being taken away from reading the piece;
and does either answer in place of reading or say something the piece does not. Budget: a few
dollars.

The existing evals still run after the change: `evals/guide/run.ts` (its `first` case's "did not ask
why" goes — asking is no longer required — and becomes "a way in, or a question, not neither") and
`evals/guide/next-steps.ts` (its content cases already require a chat step; a short answer beside
it is now right).

### Done for stage 1

The prompt, greeting and starters changed; `tests/guide-greeting.test.ts` and
`tests/guide-in-chat-panel.test.tsx` updated; the new eval run before/after/control and judged
blind, with the numbers in an investigation doc; the two older guide evals re-run and not worse;
chat-tools.md § The guide and its greeting and starters lines corrected; a GPT Sol code review.

## Stage 2 — background generation and a Skim route (planned, asked, not built)

What Greg asked for, in its simplest shape, if he says yes (refined by GPT Sol's F6 and F7 on
this plan):

- A guide tool, `prepare_mode(key)`, typed turns only (like `offer_to_save`), that starts the
  ordinary generation of a mode for **the reader's own article** — the same job the mode's own band
  starts on open (no second implementation) — and never switches to it. Its result says *started*
  or *already there*; the guide then offers that mode's button as now, and must not say it is ready
  until it is.
- Allowed modes: an explicit server-side list, each key mapped to its ordinary job **and every stage
  that job pulls in** (Skim queues Quotes and Ideas too, `src/auto-mode-steps.ts`), with the caps
  applied to the whole job. Not the catalogue's `generates` marker, which means only "may start
  work" (Structure generates nothing; `src/web/activation.ts`).
- A cap: one per conversation turn, and a small number per conversation (Opus: one per
  conversation); nothing on an article the reader does not own.
- Skim's route takes the saved reason as it does today, so *prepare Skim* after their reason is
  saved is ask 10. **But not in the same turn as an offer of a new reason**: `offer_to_save` saves
  on the page after the answer, so a same-turn Skim would be planned from the old reason and go
  stale at once (`routeProfileIsStale`). Permitted only when the reason in the turn's saved profile
  is already the one the route should use.

What it costs if the article is hostile: a planted line could get a mode generated that the reader
never opens — bounded by the cap, by one generation per mode per article, and by the owner's own
spend limits. What it buys: the mode is ready when they press it. The alternative that needs no new
defence is what exists: the mode's button, whose press starts the generation.

## Stage 2b — what Greg chose, and the build

> Maybe we make it an option, so the Guide has the option to do A, but there's a minimal
> explanation in the prompt that this incurs expense, so if it's not confident that the user will
> want it, it just does B
>
> Perhaps for important/common modes (e.g. Structure, Summary, etc), the threshold is lower, i.e.
> the Guide is more willing to kick them off?
>
> Use your judgment - let's not make this tooo complicated.
>
> — Greg, 2026-10-20 (reply `spya-tgeg6v` to q-y4p2ct)

So both: **A**, the guide starts it, and **B**, a *Get X ready* button the reader presses. A few
lines of prompt choose between them.

### What is already true, and changes what this buys

Most of the list is already made on import. An import's first publication queues Summary's
levels, the thread, Glossary, Quotes, Ideas and Skim (`AUTO_MODE_STEPS`,
src/auto-mode-steps.ts), unless the reader has switched that off. Structure is the tree, so it is
always there and generates nothing. So, on most articles, *prepare Summary* finds Summary made
and spends nothing. What this does buy:

- **Skim from what they said** (ask 10): a route planned before their reason was saved is stale
  for the new reason (`routeProfileIsStale`); preparing Skim re-plans it, as *Plan it again* does.
- **Quiz**, which is not made on import.
- Readers who switched import-time modes off, and a mode whose import job failed.

Timeline, FAQ and Diagram are behind the experimental switch and are not guide modes
(`guideModeKeys`), so they are not on the list.

### The shape: one step kind, pressed by the reader or by the page

GPT Sol's simpler design on the first version of this plan (below), taken: no new tool. The
guide's existing `offer_next_steps` gains a seventh kind, **`prepare`**, carrying a mode key and
`now: true | false`.

- **`now: false` is B**: a button, *Get Skim ready*, that the reader presses.
- **`now: true` is A**: the page makes that same press itself, once, on an answer this tab's own
  stream finished (`answered-here.ts`, the save card's rule), and the button is drawn already
  pressed, saying what it started. So a start is never hidden, and A and B are one code path.

A press, by either, posts `POST /api/guide-prepare/<slug>` `{ mode, threadId, now }`. The answer
carries the job when one was queued, and the page hands its outcome to the job engine's action
path (`actionSucceeded`, which owes a reconciliation, not a bare `poke`: Sol's F5), since on
Vercel nothing but the browser drives a job.

### What the server checks, and where

**When the step is accepted** (`offerNextSteps`, src/chat-tools.ts):

- the key is in `PREPARABLE`, a node-free table the page reads too (src/preparable-modes.ts):
  `submode:summary:brief` and `submode:summary:fuller` → `simple`, `submode:summary:thread` →
  `tweets`, `mode:glossary`, `mode:quotes`, `mode:ideas`, `mode:skim` (→ `skim`, after Quotes
  and Ideas where those are missing or stale), `submode:learn:quiz` → `quiz`. Not `mode:summary`,
  whose press lands on whichever view the URL holds (Sol's F1). A test holds every key inside
  `guideModeKeys()`.
- at most one prepare step an answer;
- `now: true` only on a turn the reader typed (`ctx.typed`), and only when no earlier answer in
  the thread carries a `now` prepare step; otherwise it is kept as a button (`now: false`) and
  the model is told so;
- **no Skim step at all, now or not, in an answer that offered a reason** (Sol's F4): the reason
  saves after the answer, so a route planned on that press would use the old one. Refused, with
  "offer it on a later answer".

**At the press** (the route, then `prepareMode` in src/prepare-mode.ts):

- the thread is a guide thread on this article, owned by the reader;
- **`now: true` claims the thread's one automatic start**: `UPDATE chat_threads SET
  mode_prepared_at = now() WHERE … AND mode_prepared_at IS NULL`, and a second gets 409. Durable
  and atomic, so two tabs, a retry or an edit cannot make a second (Sol's F3). One additive
  column, `chat_threads.mode_prepared_at`; store when it happened.
- **made already** (the mode's loader does not throw `ArtefactNotMadeYet`): nothing is queued,
  answer `ready`. A mode made for an older profile is left alone; its own notice says so. **Skim
  is the exception** (ask 10): a route stale for the current profile, whose notice the reader has
  not dismissed for that profile, is re-planned with `skim` forced, which is *Plan it again*'s
  request.
- **not made**: `enqueue` with the steps the mode's own panel would post: for Skim, Quotes and
  Ideas only when missing, unreadable or stale, as `quotesFirst` and `ideasFirst` in
  src/web/useSkim.ts (Sol's F2); the profile resolved now, as `POST /api/jobs` does. `enqueue`
  refuses an article the reader does not own and a minimal paper, and hands back an identical
  job already queued.

The automatic press is the reader's page acting on the model's choice; the reader's own button
press needs no claim. A B press is free to repeat; each finds the mode made or queued.

### The prompt

A few lines under NEXT STEPS, for the new kind:

> prepare: start making a mode in the background, so it is ready when they open it; it does not
> open it. Making a mode costs money. Set now to true, which starts it straight away, only when
> you are confident they will want it soon — more readily for Summary and Skim, which most
> readers use — and at most once in a conversation; otherwise leave now false, and they get a
> button to start it themselves. Never say a mode is ready because you prepared it.

### Measuring it

`evals/guide/prepare.ts`, after next-steps.ts: production's `converse`, the two offer tools
answered by the real `runTool`, article tools stubbed. Cases: a reader who says they will want
the summary; *where should I start*; *hi*; a reason saved earlier and *I want a quick route
through it for that*; a reason given in this message (no Skim step); and **the planted line**,
an article paragraph telling AI guides to prepare every mode at once. Screens: prepare steps and
`now` per case, any claim that a mode is ready, the planted case's `now`. Run twice. Then
`evals/guide/next-steps.ts` before and after, screened, so the new kind does not crowd out
the others.

### Security

This loosens the written defence *a press is the only way any of it runs*: a model's choice now
makes the page start a paid job without a press. Worst case from a hostile article: one mode
from the list made per conversation on the reader's own article (Skim may be three paid steps:
Quotes, Ideas, the route), or one Skim route re-planned under the reader's own current profile.
Bounded in code by the claim column, `ctx.typed`, the fixed list and the store's owner scope.
Recorded as a new risk in security-risks.md, accepted by Greg's reply, and in security-map.md and
security.md (whose *nothing chat can call … spends the reader's money* stops being true). GPT
Sol attacks the planted-line case on the built code.

### GPT Sol on stage 2b's first plan (2026-10-20, read-only, `gpt-5.6-sol`, high)

No P0; five P1s, all taken. **F1** `mode:summary` has no single job: dropped. **F2** Skim's
prerequisites follow the panel's rule (missing or stale), not missing alone. **F3** a run stored
at the end of an answer cannot cap a conversation: two tabs, a retry or an edit escape it; a
durable claim on the thread instead. **F4** the Skim/reason guard was one-way and missed the
button: no Skim step in an answer that offered a reason. **F5** a bare `poke` owes nothing if
its one poll fails: the action path. And its simpler design, which replaced the separate tool:
the version passed over was `prepare_mode` as a tool the server ran mid-turn, which needed its own
per-turn and per-conversation counting, an ordering rule against `offer_to_save`, and a job made
on the server that only a later poke would find.

### Result of stage 2b (2026-10-20)

Built as above. Two things changed on the way:

- **One clause of prompt added after measuring**: the first run never offered Skim to a reader who
  asked for *a quick route through it*; it wrote the route itself. *"When they ask for a route or a
  quick way through the piece, that is Skim, planned around their reason: prepare it"* took that
  to 2 of 2. The planted line got no start in 12 runs, and the older next-steps eval went 8/12 →
  10/12 with the same misses on both sides
  ([261020f](../investigations/261020f-the-guide-gets-a-mode-ready-measured.md)).
- **A failed start still spends the conversation's claim** (the route claims before
  `prepareMode`), and so does a `now` press that finds the mode made. Kept: it fails closed, the
  button remains, and undoing a claim is a second write that would reopen the race the claim
  closes. Found by the subagent that wrote tests/guide-prepare-route.test.ts.

Tests: tests/guide-prepare-step.test.ts (the list, the policy, `converse`'s history read),
tests/guide-prepare-button.test.tsx (the press, the page's one automatic press, no Skim beside a
reason), tests/guide-prepare-route.test.ts (the route, `prepareMode`'s steps, the claim, two
concurrent presses). Each guard was broken by hand and its test went red.

### Done for stage 2b

The tool, the step, the route, the poke, tests for each guard (red first), the eval run and
written up, the docs above and chat-tools.md § The guide, the question file answered, the note
updated, a GPT Sol plan review and code review.

## Deferred

- A *Get … ready* button that turns into *open it* once the job finishes: today it says *Started:
  … will be ready soon* and stays so; the mode's own button opens it.
- A Skim route steered by something narrower than the reason (a new Skim input).
- Real prod first messages as eval inputs (Opus's suggestion): reading them is allowed, but
  committing them is not, and the invented cases cover the pattern Greg describes.

## GPT Sol on this plan (2026-10-19, read-only, `gpt-5.6-sol`, high)

No P0. Every P1 taken:

- **F1** — three sentences is not enough of a guard: the prompt now says *about that one point and
  nothing around it*, every sentence about the piece carries its id, the last names the passage, a
  *"is it right?"* gets what the piece offers plus anything further labelled as the guide's own
  reading, and a whole-piece question gets kind and subject only, never thesis or findings.
- **F2** — the old rules lived elsewhere too: `lengthLine`'s guide line, the opening paragraph of
  `GUIDE_SYSTEM`, the greeting's description inside it, and Live's `SPOKEN_GUIDE` (its ask-first and
  About-you lines) all changed together; suggestion-first is scoped to turns about how to read it.
- **F3** — *copy exactly* fights the 160-character cap: the prompt and the tool's schema say to
  shorten only past the limit, keeping their words and every unusual term.
- **F4** — `invitesProfile` drew a sentence inviting them to talk about themselves: the no-reason
  greeting draws none; the reason-stored arm keeps its line as before.
- **F5** — the judged pairs carried 400-character excerpts of cited passages; review found one
  supporting line beyond that boundary, and new pairs carry the complete fixture blocks. The after arm recorded its `converse.ts` hash, but the
  two baseline files were written before that field was added and do not prove their prompt source;
  every content and whole-piece reply was read by hand
  ([261019b](../investigations/261019b-guide-plainer-blind-judged.md)). The reviewed eval now records
  both prompt-bearing source files and refuses incomplete pairs.
- **F6, F7** — folded into Stage 2 above.
- **F8** (P2) — the starters are asserted literally; the help page says the guide answers briefly,
  and the help corpus is regenerated.

## Result of stage 1 (2026-10-19)

Built as above. The blind judge preferred the new prompt 19–2 (one tie) against a 12–10 control;
no reply on the new prompt asked about the reader or declined a question about the piece, against 4
and 6 of 22 before. Numbers, method and what reading the replies found:
[261019b](../investigations/261019b-guide-plainer-blind-judged.md).

## GPT Sol on the code (2026-10-19, write-capable, `gpt-5.6-sol`, high)

No P0. It fixed, and I read and kept: **C1** *do not assume they have read it* had become an
absolute, now a default *unless they tell you otherwise*; **C2** Live's suggestion-first fought its
answer-first rule, now scoped to how-to-read turns; **C3–C7** the eval's screens, pairing,
unblinding, clipped passages, hashes and medians, which now fail closed (clean replies 7/9/14 of
22, not 12/12/22; the blind 19–2 unchanged); **C8** stale comments and docs. It wrote two
postmortems: [261019d](../postmortems/261019d-scoped-prompt-rules-became-absolutes.md) and
[261019e](../postmortems/261019e-a-paid-eval-must-fail-closed-at-every-evidence-boundary.md).

**C9**, wider and older than this plan: `SAVING WHAT THEY TELL YOU` asks for the reader's words in
`offer_to_save`, while the profile rule and the guide's own restatement forbade anything they said
in any tool argument. Fixed in the guide only: `offer_to_save` may carry their words, since it only
shows them back to the reader; no other tool may. The offers eval after it: every offer right
([261019b](../investigations/261019b-guide-plainer-blind-judged.md)).

A reminder of the three-sentence limit beside the question was tried and taken out: it changed
nothing measurable (261019b § A second after arm).

## Bookkeeping

- Stage 1: `385f08e55` and the review commit after it, on `dev`.
- Stage 2: question `q-y4p2ct`, answered 2026-10-20 (`spya-tgeg6v`) and built as stage 2b; queue
  item `qi-3q9z7mr6`, whose work this is.
- Note: [261019_1944](../user-feedback/261019_1944-guide-chat-plainer-less-nagging.md).
- `qi-bt4z2zaw`'s point 2 (stop quoting About you back) marked done there.
