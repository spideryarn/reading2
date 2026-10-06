# Why you are reading feeds the command bar, and Debate takes a lens

Owned by [plans.md](../project/plans.md). Queue item `qi-wjb27jre`, part 3 of report `spya-thpsnd`
([the note](../user-feedback/261003_1010-fewer-modes-part-3-why-you-are-reading-feeds-the-bar.md)).
Session `why-reading-feeds-the-bar`. **Status: both stages built, reviewed and on `dev` (`b4500cd96`, 2026-10-05). Not yet seen in full in a browser, and one part is a question for Greg: see the Log's last entries.**

## What Greg asked for, and what he has decided

The idea, 2026-10-03:

> if they fill in the why you're reading this, then somehow that should inform things. So maybe then
> if we did have a natural language command bar, you could imagine feeding that in somehow to it,
> and then it would pop up with an immediate, Hey there, these are the actions I'm going to take on
> your behalf. It sounds like what you're going to need is for me to do a few quick searches for
> those topics, and you might find the review mode, blah, blah, blah, and I've already kicked off
> the debate with a particular kind of search that you might enjoy. Well, you won't say might enjoy,
> but I've kicked off the debate with a particular lens, and so maybe debate then has a search box.
> An input text box. I know that might be overcomplicating it, but it would be cool if the debate
> could be steered, maybe in multiple directions, a bit like the way we can steer the search.
>
> — Greg, 2026-10-03

The question put to him ([Q-bar-4]): *"Should the command bar's model be allowed to read your reader
profile, so your 'Why you're reading this' note can prompt it to propose actions?"*

> Q-bar-4 yes
>
> — Greg, 2026-10-04

And, the same day, on custom digging in general (quoted in full in
[261005i](261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md#what-greg-asked-for)):
custom research *"should just kick off a Chat (perhaps with some metadata so that the chat thread &
mode know that these are particular/special kinds of chats), with a link/tooltip in the relevant mode
to pull up the whole Chat thread … Actually, this is definitely what we want to do."*

## What is there today

- **The bar's model picks one command.** `POST /api/command-pick` sends the sentence and our list of
  rows to `jev-1.13`; the answer is one row, or one argument whose words must be copied out of the
  sentence (`src/command-pick.ts § PickAnswer`, `wordsIn`). It can name up to two alternative rows,
  but it cannot propose several separate actions and it cannot write words that were not typed. It never sees the article or the profile.
- **The reason for reading** is `articles.purpose` (600 chars); *About you* is
  `reader_profiles.profile`. `resolveProfileParts(slug)` in `src/routes.ts` loads both;
  `renderProfile` in `src/profile.ts` makes the two-line text most article prompts carry.
- **Quick search from the bar** landed today (261005i): `executor.quickSearch(words)` writes the
  article's one search draft and opens Search. One draft per article, so two handoffs made at
  once overwrite each other (Search itself stores many runs and can show several together).
- **A chat that remembers where it began** landed today (261005i, the other one):
  `handToChat(question, origin?)` in `Reader.tsx` puts a question in Chat's box, **unsent**, and the
  thread records `ThreadOrigin = { mode: "debate"; blockId; quote }`. Debate's *Check this claim* is
  the one caller. A CHECK on `chat_threads` requires a debate origin to have a block and a quote.
- **Debate cannot be steered.** A run is a job (`steps: ["debate"]`), about 27 cents, two web-search
  calls whose queries the model chooses, and a third call that names the themes. The result is one JSON value per article revision,
  replaced by each run, shown to visitors when the article is shared, and stamped by the article alone (*"who is reading
  does not change what the web said"*, `src/db/schema.ts`).

## The design

Two things, the second built on the first.

### A. Debate takes a lens, and the lens is a chat

```
 Debate panel                                   Chat
 ┌───────────────────────────────────────┐      ┌─────────────────────────────────────┐
 │ Look at the debate from an angle      │      │ What does the rest of the web say   │
 │ [ how it relates to Smith 2019   ] →  │ ───▶ │ about this piece, looked at this    │
 │                                       │      │ way: """how it relates to Smith     │
 │ Your angles                           │      │ 2019"""? Search the web…            │
 │   “replication attempts”        ↗     │ ◀─── │                      [ Send ]       │
 └───────────────────────────────────────┘      └─────────────────────────────────────┘
        the list is the way back             unsent until the reader presses Send
```

- A text box at the top of the Debate panel. Enter (or its button) calls
  `handToChat(askDebateThroughLens(lens), { mode: "debate", lens })`. Nothing is sent and nothing
  is paid until the reader presses Send in Chat, and they can edit the question first.
- The seed is built like `askToCheckClaim` (`src/web/chat-handoff.ts`): the lens inside
  `fencedQuote`, then a fixed question that asks for a web search. Chat already has web search, the
  article, the profile and a back-and-forth.
- **The origin gets a second shape**: `{ mode: "debate"; lens: string }` beside the claim's
  `{ mode: "debate"; blockId; quote }`. Stored in a new nullable column `chat_threads.origin_lens`
  (columns over JSON, [sql.md](../project/sql.md)), with `chat_threads_origin_debate` replaced by:
  a debate origin is *either* block and quote with no lens, *or* a lens with no block and no quote.
  `chat_threads_origin_none` also learns that no mode means no lens, and `origin_item_id` stays
  null for both debate shapes (F7). Drizzle 0.31 does generate a changed CHECK (Sol probed it: drop
  constraint, add column, add constraint), so the SQL is generated and read, not hand-written; the
  schema comment that says it cannot is stale and is corrected. Both shapes say `mode: "debate"`,
  so code that switched on `mode` to reach `blockId` no longer narrows: every such place
  (`Reader.checkClaimInChat`, the server's block-membership check, `thread-source.ts`, the test
  seeder, the mapper) uses an explicit guard, and a claim never equals a lens. `sameOrigin`,
  `originColumns`, `originFromColumns` and `parseOrigin` learn the shape; the lens is capped at
  `MAX_PURPOSE_CHARS` (600) and refused, not cut.
- **The way back**: under the box, *Your angles*, one line per chat thread whose origin is a lens,
  pressing which opens that thread (`?thread=`), the same way a claim's mark does. The box and the
  list are drawn whether or not a Debate run exists yet. With the Experimental switch off Debate is
  hidden and so is this list; Chat's own list is then the way to find a lens chat.
- **One inherited limit, tested and written down rather than fixed here**: a handoff starts a fresh
  conversation, and a never-sent draft in the conversation it displaced can become unreachable
  after a later mode change (the review's answer 2). True of every handoff since 261005i.
- **How I decided the lens is a chat and not a steered Debate run.** A steered run was measured to
  work (261003o: about 20 cents and a minute and a half), but the stored Debate is one value per
  article, shared with visitors and replaced by each run. A lens run would either overwrite the
  plain debate (and show a visitor the owner's angle) or need per-lens storage, a merge, a spend
  rule and the lens in the freshness stamp: 261003o put that at two to three days. A chat is a
  morning, costs nothing until Send, gives a back-and-forth, can be steered *"in multiple
  directions"* by simply starting another, and is where Greg said this kind of digging belongs.
  What it gives up: the answer is prose in a conversation, not rows in Reception or Claims with
  checked quotes, and a visitor never sees it.

### B. The bar proposes a short list from why you are reading

```
 bar opened on an article that has a "why you're reading this", nothing typed
 ┌────────────────────────────────────────────────────────────────┐
 │ ✨ Suggest what to do here, from why you're reading             │ ← one press, one small model call
 └────────────────────────────────────────────────────────────────┘
                 │ press
                 ▼
 │ From why you're reading                                        │
 │ ⚡ Quick search “handling of missing data”                      │ ← press: the quick-search row 261005i built
 │ ⚡ Quick search “imputation method”                             │
 │    Open Skim: a fast route through the paper's own lines       │ ← press: the bar's ordinary row for that mode
 │ 💬 Ask what the web says about: “criticism of the imputation”  │ ← press: A's handoff; Chat's box, unsent
```

- **A new call, not a wider pick.** `POST /api/command-suggest/:slug`, owner only, signed in. The
  server loads the profile itself (`resolveProfileParts`); the browser sends only the row keys it
  could show. **The server keeps only keys whose catalogue entry is a `mode` or `submode`** (F1:
  `knownOptions` alone would let Archive or *Run again* through), and the browser accepts a
  returned key only if it resolves to a `mode` or `submode` command it has now. A purpose that was
  read and is empty, or no usable rows: the answer is `nothing` and no model is called. **A purpose
  that could not be read (`purposeFailed`) is a failure the reader can retry, never `nothing`**
  (F6). Ownership is checked by the route itself, not inferred from the read.
- **Model**: `gpt-5.6-luna` (`QUICK_MODEL_OPENROUTER`) through `openRouterJson`, job
  `command-suggest`, costed as interactive request work like the pick. Jev cannot write words.
- **It sees** the rendered profile (*About you* and the reason, `renderProfile`) and our own words
  for the mode rows. **It does not see the article**, the same line the pick holds. It has its own
  rules, as Quiz does, not `PROFILE_RULES`: build the searches and the lens from the *topic* of the
  reason for reading; leave out anything about the person, from either box. That is an instruction
  to a model and not a guarantee, and no doc or page may say otherwise.
- Explicit output-token and time limits of its own (not the pick's small ones); the spend is
  attributed to the slug; no per-reader rate limit, as for the pick, with the monthly cap behind
  it. One call is a fraction of a cent, and its size is bounded by the profile's 2,100 characters
  and the row list.
- **It returns** (`src/command-suggest.ts`, pure, shared by server, browser and eval):
  up to 3 `searches` (`{ words, why }`), up to 2 `modes` (`{ key, why }`, key must be one of the
  rows sent), at most 1 `lens` (`{ words, why }`). The server re-checks every field, drops anything
  unknown or over length, and the browser re-checks again, as `readPickAnswer` does.
- **Each row is an ordinary bar row**, pressed singly. A search is 261005i's `quickSearchRow`; a mode
  is *the bar's existing command for that mode*, so what a press arms, spends and labels is exactly
  what it is anywhere else in the bar (the *generates* mark included; prices are not shown to
  readers); the lens is A's handoff, shown only when Chat is reachable.
  Nothing runs at once, whatever the model says. `why` is drawn as the row's second line.
- **The list is kept for the visit**, in state of its own, not the pick's (which is cleared on
  every open and close, and is hidden whenever the draft matches a row, as an empty draft does:
  F2). It is drawn above the ordinary rows while the draft is empty, hidden while the reader
  types, and back when they clear it. The server returns a hash of everything the model read (the
  rendered profile); the answer is kept under owner, article and that hash, and the bar drops it
  when *About you* or the reason is saved, including a save made while the request is out (F3).
  The stored answer is words and keys; rows are rebuilt from today's commands at each draw.
- **Never logged**: the profile, the suggestions. Counts, kinds and timings only.
- The row appears only when the draft is empty, the reader owns the article and it has a purpose.

### What changes about the profile's rules

[reader-profile.md](../project/reader-profile.md) and `PROFILE_RULES` say, flatly, that nothing
from the profile goes into a search query, a tool argument or anything else that leaves the
conversation. **This is an exception to that rule, not a reading of it** (F4). The justification is
that the derived words are shown to the reader as a proposal and travel only on the reader's own
press. `PROFILE_RULES` stays word for word as it is for the article and chat prompts; the doc gains
a section naming the exception, where the words can then go, and that keeping personal details out
of them is asked of a model and not enforced.

**Privacy page** (F5): the `gpt-5.6-luna` clause gains that it is shown your profile and your
reason for reading, with our list of commands, when you ask the command bar to suggest what to do.
A sentence beside it says what follows: the searches and the question it suggests are worded from
what you wrote; one you press is sent and kept like any search or chat question you typed
yourself, so a search is seen by visitors if you share the article and a chat question can be
searched for on the web. No promise that personal details are kept out. `LAST_UPDATED` moves;
[privacy.md](../project/privacy.md) gets a dated section; `tests/privacy-page.test.ts` gains an
assertion on the new disclosure, since naming the model alone would not notice it being deleted.

## The simpler options passed over

- **No model: one bar row, *Quick search for why you're reading*, that uses the purpose as the
  search.** One line of code, free of any privacy change. Passed over because a reason for reading
  is an intent (*"how does this relate to my own work on X"*), often not a thing the article says,
  and it yields one search, no mode and no lens. Worth keeping in mind as the fallback if the eval
  shows the model's searches are no better than the purpose itself.
- **Send only the reason, not *About you*.** Less data to a model. Passed over because Greg's yes
  was to the profile, and *About you* is what lets the model tell a first read from an expert's.
  Cheap to reverse: one argument to `renderProfile`.
- **A lens with no origin** (as the Summary and glossary handoffs are today). No migration. Passed
  over because Greg asked for these chats to *"know that these are particular/special kinds of
  chats"* with a link back from the mode, and without the origin Debate has no list to draw.

## Not built here, and why: several proposals confirmed together

The queue item says *"needs several proposals confirmed together"*. This plan builds a list whose
rows are pressed one at a time and that stays put between presses. Ticking three and confirming once
is not built. A mixed batch has real obstacles: the reading view shows one band at a time, so a
search, a mode and a chat confirmed together have nowhere to all appear; and a mode that generates
must not be armed by a batch press. **A smaller honest version does exist** (F8): tick the
suggested *searches* only, confirm once, and Search opens with each as its own saved run, shown
together as saved runs already can be (`useSearch.ask(words, "quick")` makes independent runs). It
needs a handoff and rules for one of three failing, and it brings back a tick that is not yet an
action ([comments.md](../project/comments.md)). Simplest first: not built; it is the recommended
option in `[Q-suggest-together]` for Greg. **The feedback item is not fully answered until he has
decided that.**

**Decided: A for now, one press each.** Greg, 2026-10-06: "Q-suggest-together go with your
recommendation for now". The recommendation was to try one press per suggestion for a week and
build B (tick the searches, press once) only if pressing three rows in turn feels like work.

Also not built: suggestions appearing unprompted on first open (a model call nobody pressed for);
the interface model seeing the article; a Debate run stored per lens.

## Stages

### Stage 0: plan review
- [x] GPT Sol, read-only: [the review](261005k-plan-review-sol.md), *build with changes*, F1 to
      F10, all ten accepted and written into the design above. Each stage also does its own
      browser check before it is called done (answer 7); stage 3 is the combined sweep.

### Stage 1: Debate takes a lens (A)
Opus subagent, tests red first.
- [ ] Migration: `origin_lens`, the replaced CHECK. Read the generated SQL; `db:chain`.
- [ ] `ThreadOrigin` second shape through `src/types.ts`, `src/thread-origin.ts`, `parseOrigin`,
      `sameOrigin`; every `switch`/narrowing on an origin stays exhaustive.
- [ ] `askDebateThroughLens` in `chat-handoff.ts`; the box and *Your angles* in `DebatePanel.tsx`;
      Chat's list draws the Debate icon for a lens thread as it does for a claim's.
- [ ] Database constraint tests: plain chat, a claim, a lens, claim and lens mixed, a lens with no
      mode (F7).
- [ ] Tests: route (lens accepted, lens plus block refused, over-length refused, 409 on a different
      origin), the mapping both ways, the panel (Enter hands off and sends nothing; the list opens
      the thread), the seed's fence.
- [ ] One paid check that the seed makes Chat search the web (a handful of lenses; written up).
- [ ] Docs: debate.md, chat-tools.md if the seed needs a prompt line, help page.
- [ ] GPT Sol code review, fixing; gates; commit.

### Stage 2: the bar suggests from why you are reading (B)
Opus subagent, tests red first.
- [ ] `src/command-suggest.ts` (shapes, prompt, readers), `src/command-suggest-call.ts`, the route,
      the gateway row, the model and wire inventory, reasoning policy, cost category,
      route-contract row. No spend declaration: the call goes through the gateway.
- [ ] Tests named by the review: an Archive key returned under `modes` is dropped (F1); suggest,
      press a search, reopen, press the next; type and clear (F2); *About you* edited, and edited
      mid-request (F3); `purposeFailed` is a retryable failure (F6); another owner is refused.
- [ ] The bar: the row, the waiting state, the list, the per-visit memory, failure copy
      ([copy.md](../project/copy.md)).
- [ ] Eval `evals/command-suggest/`: about 15 profiles and reasons; every answer valid, keys from
      the list, no personal detail from *About you* in a search or lens, and a read-through of
      whether the searches beat the bare purpose (the baseline arm), including reasons that name
      another paper, where a search can sound useful and match nothing. Written up in `docs/investigations/`.
- [ ] Privacy page and privacy.md, reader-profile.md, chat-llm-help-commands-vision.md (the line
      about what the interface model sees), 261003k's *Noted, not built*, help page.
- [ ] GPT Sol code review, fixing; gates; commit.

### Stage 3: seen in a browser, and closed
- [ ] Sonnet subagent: desktop, iPad, phone; both features; screenshots here.
- [ ] The feedback note's ending; the queue item; push to `dev`; `worktree:check`; remove the tree.

## Log

- 2026-10-05: **merged with `dev`, the full suite, and pushed** (`b4500cd96`). Six conflicts with
  two sibling sessions, both sides kept (the merge commit `b600f2830` lists them). The migration
  was regenerated on top of dev's journal as `drizzle/20261005203554_chat_thread_origin_lens.sql`,
  byte-identical to the reviewed one; `20261005185425` no longer exists. A lens chat is now titled
  *Angle: <the words>* (`src/chat-title.ts`), which the merge exposed. **The full suite on the
  merged tree: 36,773 passed, 14 failed in 10 files.** Three files were mine and are fixed (the
  eval's spend listing; two pinned request traces, which now include the bar's one read of why
  you are reading on each owner's reading view, added on purpose). Five were dev's own and were
  fixed on dev in `fada977ff`, merged; two are the fleet tests a fresh worktree reds without
  `npm run build:fleet`. After that merge every previously red file except the fleet pair was
  re-run and is green, with typecheck and `db:chain`. **The full suite was not run a second
  time.**
- 2026-10-05: **what is not done.** (1) The shared local database still refuses `db:migrate` over
  another session's ledger row, so the new column is not there locally: Send from a lens chat,
  *Your angles* with a real thread in it, and the paid check that the seed makes Chat search the
  web are **unverified outside tests**. (2) `[Q-suggest-together]` is unanswered.
- 2026-10-05: **the browser check was tried and could check nothing.** A Sonnet subagent started a
  dev server from this tree and signed in; `GET /api/library` and `GET /api/article/<slug>`
  answered 500 (`sqlstate 42703`, a missing column in `spideryarn.articles`). The cause is wider
  than this plan: the local database is also missing dev's `…184047_article_share_link` and
  `…200628_reading_difficulty`, behind the same refused `db:migrate`, so any dev server on current
  `dev` cannot open an article. **Nothing in either feature has been seen in a browser at any
  width.** No screenshots. The checklist is in this session's brief to that subagent (bar: the
  row, the list, wrapping at phone width, the model's face, hide on typing, survive a reopen,
  arrows, each kind of row pressed, held Enter; Debate: the box with and without a run, the
  handoff, the 16px input and 40px button on a phone; `/privacy` and `/help`), and its Playwright
  helpers are in the session scratchpad, which does not outlive the session. The worktree is left
  standing for that check.

- 2026-10-05: plan written. Both sibling sessions' work (261005i quick search from the bar; 261005i
  chat origins) is on `dev` and merged into this tree before planning; A extends the second, B
  reuses the first.
- 2026-10-05: **stage 1 built** (before its code review). Migration
  `drizzle/20261005185425_chat_thread_origin_lens.sql`, generated and read: one new column, two
  CHECKs replaced, and a third added that the plan did not name (`origin_lens` only under mode
  `debate`). An over-length lens is a 413, to match a claim's quote. The box reuses Glossary's ask
  classes. *Your angles* shows the newest three, then *Show all*. Chat's prompt is unchanged.
  **Not done**: the migration is not applied to the shared local database (`db:migrate` refuses
  there over a ledger row another session left, `1791212777965`), so nothing has been seen in a
  browser; the paid check that the seed makes Chat search is not run; the test for the inherited
  displaced-draft limit is not written (debate.md states the limit). Red first was partial: the
  route and constraint tests were red only for the missing column, and the mapping tests never;
  three mutations (the both-shapes guard, `sameOrigin`, the handoff's origin) each went red.
  **Deploy order: this code selects `origin_lens`, so the migration lands with or before it.**
- 2026-10-05: **GPT Sol's code review of stage 2** ([the review](261005k-stage-2-code-review-sol.md)
  of `cac2fbf9f`): *land with my fixes*, six findings, all fixed by Sol, each behaviour fix red
  first. CR5 (P1): a slow suggestion answer could overwrite a newer profile read and bring back a
  stale list. CR6 (P1): a failed read of the reason silently removed the row; it now says so and
  offers a retry (the F6 half the implementer had dropped). CR7 (P1): an answer of *no reason* left
  the row on offer. CR8 (P1): the row arriving late, or the list leaving after a save, moved which
  row Enter would run. CR9 (P3): the privacy page said a pressed chat question was sent; it waits
  until Send. CR10 (P3): a comment miscounted the hash's bits. Sol wrote postmortem
  [261005p](../postmortems/261005p-a-response-completion-stamp-cannot-prove-its-snapshot-is-newer.md).
  The prompt and its version are unchanged, so the eval's numbers still describe what ships.
  Run by me afterwards: `command-suggest-route` (the database suite Sol could not run) and five
  neighbours, 151 green; typecheck green. One round, no P0 or P1 left open, so no second round.
- 2026-10-05: **stage 2 built** (before its code review). What differs from the design above:
  the prompt lives in `src/command-suggest-call.ts`, not the pure module (it needs `plainWords()`,
  which the browser may not import); the hash the server returns is a plain hash of the two stored
  boxes that the browser can also compute from `GET /api/reader?slug=`, so a profile changed in
  another tab hides the list too; the list is React state in the bar, lost on leaving the reading
  view; the bar learns of saves through `src/web/profile-saved.ts`, which the four save functions
  call, and re-reads the profile on mount, on each open and after each save (one small extra GET);
  `mode` keys are a schema `enum` of the ids offered, after six answers in the first eval run named
  a sub-mode wrongly; caps are 80 characters a search, 140 a why, 200 a lens; the suggest row is
  hidden while a list is kept, so there is no *ask again* until a save.
  **The eval** ([261005b](../investigations/261005b-does-the-command-bar-suggest-useful-searches-from-why-you-are-reading.md)):
  17 made-up readers, 3 answers each, about 3 cents in all. Every answer parsed, every key was one
  offered, no planted personal detail reached a search or the lens (45 of 45); 3 of 45 *why* lines
  spoke of what the reader was doing (*"for your pitch"*), which the prompt now allows since a why
  is shown only to the reader. **Not measured**: whether the searches find more than the bare
  reason would, since no search was run against an article.
  **Red first did not happen for this stage**: tests and code were written together, then 21
  mutations were run and 18 turned a named test red; the three survivors are written in the
  subagent's report (a save alone not dropping the list, because the hash re-read hides it anyway;
  the Chat-reachable guard, always true for an owner today; a client special case since removed).
  Not seen in a browser. Also in this commit: stage 1's box added to the Enter-key table test it
  had left red, and the held Enter cancelled in two more boxes (the narrow check below).
- 2026-10-05: **Sol's narrow check of the CR1 fix** ([the answer](261005k-stage-1-cr1-check-sol.md)):
  *CR1 closed*. It noted that a held Enter now added blank lines in Edit Question and Candidates;
  both cancel it now.
- 2026-10-05: **GPT Sol's code review of stage 1** ([the review](261005k-stage-1-code-review-sol.md)
  of `97179213f`): *do not land*, four findings.
  - **CR1, P1, real, fixed by me after the review**: Enter in the lens box moves the caret into
    Chat's box, already holding the question, and the same key still held then sent it. A paid
    call nobody pressed Send for, and true of every Enter-driven handoff, not only this one.
    `isSendEnter` (`src/web/key-chord.ts`) now refuses a held Enter's repeats in every box that
    sends, and Chat's composer cancels the repeat so it adds no blank lines. Red first in
    `tests/key-chord.test.ts`; the whole-app regression is in `tests/debate-lens-in-chat.test.tsx`
    (Sol saw the same assertion red before the fix). **This fix was not in the review's snapshot,
    so it gets a narrow check of its own.**
  - CR2, P1, inherited and accepted by this plan (the displaced unsent draft): Sol added the
    characterisation test the implementer had skipped.
  - CR3, P2, fixed by Sol: the lens box did not guard Enter during IME composition.
  - CR4, P3, fixed by Sol: the help page and debate.md now say an angle is listed once sent.
  - Sol wrote two postmortems, [261005n](../postmortems/261005n-a-submit-handler-test-cannot-prove-the-key-that-reaches-it.md)
    and [261005o](../postmortems/261005o-a-held-key-becomes-a-new-action-after-focus-moves.md).
  - The database suites Sol asked for, run by me: `chat-origin-route`, `store-chat-pg`,
    `store-roundtrip`, `chat-spoken-route`, 246 tests green with `doc-links` and
    `migration-journal`. Typecheck green. The full suite runs once, at the end of stage 2.
- 2026-10-05: GPT Sol's plan review, *build with changes*. All ten findings accepted (none
  overruled); the design sections above carry them, marked F1 to F10.
