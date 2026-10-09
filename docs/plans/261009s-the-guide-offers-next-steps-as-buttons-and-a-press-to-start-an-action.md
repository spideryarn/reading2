# 261009s — The guide offers next steps as buttons, and a press to start an action

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-j45yc3ck`; report `spya-pqaftb`
(#518, SPIDERYARN-READING2-FY) and part 2 of Greg's reply `spya-ujstyz` to
[q-w2740x](../user-feedback/questions/q-w2740x.md), both Greg's (`feedback-reporter.ts` exit 0).
Supersedes queue item `qi-rt49dwcd`. Session `fbpqaftb-guide-action-buttons`. Follows
[261009i](261009i-the-guide-greets-in-chat-takes-live-and-a-bar-row.md) and
[261009q](261009q-the-guide-offers-to-save-your-reason-and-about-you-in-your-words.md), whose
`offer_to_save` tool is the shape this copies.
Its first commit, `319219010`, called it 261009r; the Search excerpts plan landed with that letter
first, so this one took the next.
**Status: built, GPT Sol on the plan and the code, measured (eval v1 to v4), seen in a browser, on `dev`. Not deployed. One question for Greg, q-dqh7t6.**

## What Greg asked for

> For the guide chat, it has a button for where do I start. That's good. I guess what other options
> can we offer? I suppose other buttons could include help me clarify my intent, suggest some tools
> or modes. What else? But we want to frame this in terms of user value and not use jargon. Ideally,
> it would actually have very custom suggestions like search for X or, you know, check the
> literature for Y or read the brief summary or kick off a chat with the following question or do a
> tutorial on the following thing or quiz me to see if I really do remember as well as I think, or
> something like that. We obviously don't want to present too many buttons to the user. Maybe three
> or four is the maximum, plus the free text input box, of course. So maybe three would be about
> right. Probably the LLM should suggest them as the language, but maybe there are some defaults.
> Yeah, so maybe if it's early in the conversation, we probably rely more on built-ins and defaults,
> and if it's further along in the conversation. So then maybe the element for creating custom ones.
> I think this fits with my previous suggestion that maybe it was sort of have custom, well,
> reusable UI components that kick off particular tools, like I would search for X, so you'd have an
> input box and a search button, then that would show a loading spinner and whatever. But at the
> same time, we're trying to reuse existing UI machinery, and we're not. I think it would be so easy
> for this to get really complex. Let's try and look for the 80/20 as always. And so if anything,
> I've asked is really hard, either simplify or ignore it for now.
>
> — Greg, 2026-10-09, `spya-pqaftb`

> 2 so my original intention was actually that the guide would be able to take the actions itself
> if it was confident. I suppose there's a bit of risk to that and maybe complexity. So the
> alternative would be it takes you to the relevant place, although that might be a bit confusing
> for the user.
>
> Here's what would be ideal, I think, would be if the guide was able to kind of add UI components
> for different kinds of actions. This would be perfect. So then if I say I want to generate a
> private link, that maybe it would say, okay, I think what you want to do is generate a private
> link. Click this button to do so. Now in an ideal world that would then, I don't know, flash up a
> modal, a modal or something like that, with all the extra information, so it doesn't all happen
> within the chat.
>
> For that to work well, we want to make sure we're reusing UI components and machinery, that there
> aren't multiple ways to create a private link […]
>
> I guess the key point is that, the point is that I think the ideal would be if the chat has the
> ability to add certain simple UI components like buttons to kick things off, or feedback, or
> toggles, or sliders, or whatever else it needs, so that it can take what the user has asked for
> and enable them to manually initiate things.
>
> In the case of something like a search, well, yeah, so maybe it'd be like, okay, well I think what
> we should do is search for X, and maybe it would show an input box and a button and you could
> tweak the input and then press the button. That way we're de-risking it. It's not automatic. The
> user can modify it and also see what's happening. […] it reuses existing machinery. So in the case
> of a search, I suppose then what it would do is it would show you a loading spinner and a button
> that says "Show me this search" or something, and then that would take you to search mode.
>
> I can imagine a future world in which actually all of the machinery for searching, the UI
> components for searching, are actually embedded within the chat, so you can do everything from
> within a chat […] like a kind of control center. That would be super cool. I can't tell for sure
> if that would be a good user experience, and I assume it would be complex. But perhaps that's one
> potential vision of where we're going.
>
> — Greg, 2026-10-09, reply `spya-ujstyz` part 2 (full text in the note)

## What is already there

- **The greeting** (`GuideGreeting.tsx`, `guide-greeting.ts`): our words, one button, *Ask the
  guide where to start*, drawn only when a reason is stored (`offersStart`).
- **Chips** (`[cmd:…]`, `chipFor`, `CHAT_PROPOSABLE`): the guide already writes mode buttons and
  quick-search buttons inline, on lines of their own, and the first that only moves the reader
  presses itself (guide-acts.ts). That allowlist is a listed defence
  ([security-map.md](../project/security-map.md)), so **no new id goes on it** here.
- **A guide-only tool that puts a button under the answer**: `offer_to_save` (261009q). It saves
  nothing; its offer rides on the `ToolRun`, is stored with the message's `tools` jsonb (no
  migration), and the page draws it as a card the reader presses. 261009q's review accepted adding a
  guide-only tool to `toolsFor("guide")` as using the gate, not changing it.
- **Share**: one place, Metadata's *Access & sharing* card (private link, then the public switch),
  reached by `?section=access-sharing`. The bar's *Share this article* row and Metadata's own
  *Share…* button both go there. **Archive**: Metadata's top *Archive* button, the masthead mark and
  the bar row share one controller (`useArchive`), which reaches the bar from Reader.tsx and does
  not reach Chat.
- **Quick search**: the `quick-search` proposal's runner (Search mode, the words searched).

## The design (v1)

```
 guide, empty                          guide, later
 ┌──────────────────────────────┐      ┌──────────────────────────────────┐
 │ 🧭 Hi, I'm your guide to …   │      │ guide: … start with the Method   │
 │    why are you reading it?   │      │   section [spya-…], it's where … │
 │ [Where should I start?]      │      │   [Open Structure]  ← inline chip,│
 │ [Help me work out what I     │      │                     as today     │
 │  want from this]             │      │ ── next ─────────────────────────│
 │ [How could I read this well?]│      │ [Read the short summary]  ← mode │
 │                              │      │ [Test what I remember]    ← mode │
 │                              │      │ [attention heads ] [Search] ← search, editable
 ├──────────────────────────────┤      ├──────────────────────────────────┤
 │ [ type…        ] [Live][Send]│      │ [ type…            ] [Live][Send]│
 └──────────────────────────────┘      └──────────────────────────────────┘
```

### 1. Three built-in starts, early

The greeting's single button becomes three, drawn **while the guide is empty** (they go with the
first send; the greeting itself stays above the turns, as now), whatever is stored:

- **Where should I start?** — with no reason stored, the guide asks why, which is the conversation
  the greeting already opens.
- **Help me work out what I want from this**
- **How could I read this well?**

Each sends its words as the reader's message (the existing `onAsk`). `offersStart`,
`GUIDE_FIRST_QUESTION` and `GUIDE_START_LABEL` go; their tests move to the three.

### 2. Later: the guide's own next steps, by a guide-only tool

`offer_next_steps({ steps })`, **guide only, typed only** (not in `GUIDE_TOOLS`, which Live reads;
`LIVE_SERVER_TOOLS` refuses it, as it refuses `offer_to_save`). It runs nothing and saves nothing:
it checks the steps and hands them back on the run (`ToolRun.steps`), and the page draws them as a
row of at most three buttons under the answer. Five kinds, and the tool refuses any other with a
sentence (chat-tools.ts rule 3):

| kind | arguments | the button | what a press does |
|---|---|---|---|
| `ask` | `words`: one line, ≤ 80 characters | the words, in full | sends them to the guide as the reader's message |
| `mode` | `mode`: a catalogue mode or sub-mode key on the owner's article | a `CommandChip` for `[cmd:mode:<key>]` | what that chip's press does today, through `chipFor` at the draw and at the press |
| `search` | `words`: one line, ≤ 60 characters | an input holding the words, and **Search** | runs the reader's (possibly edited) words as the `quick-search` proposal, through `chipFor` at the press: Search mode, its own spinner |
| `share` | — | **Share this article…** | goes to Metadata's *Access & sharing* card, where the bar's row goes |
| `archive` | — | **Archive or put back…** | goes to Metadata, whose top *Archive* (or *Put back*) button does it |

- **The row is drawn under the latest settled guide answer only**, and only from that answer's
  own last valid offer; earlier answers' rows are not drawn, and an answer with no offer has no
  row (no fall-back to the starts, which would read as stale). On a reload it comes back from the
  stored run.
- **Never auto-acted.** The row is drawn outside the answer's `GuideActContext`, so a mode step is a
  press like any other chip outside the guide's one act. The inline chip keeps its job ("the move
  I'd make now", which may open itself); the row is "options for after". The prompt says not to
  repeat an inline chip in the row.
- **The tool's ⚙ row is hidden** (the buttons are its result); `offer_to_save`'s stays.
- **It ends the turn.** A model that has written its answer and then calls this needs nothing back,
  and 261009q's browser pass found a model that went round again writing its answer twice. So when
  every call in a round is `offer_next_steps` and the answer so far is not empty, `converse` records
  the runs and stops instead of asking the model again: no second round trip, no second copy. The
  tool's own sentence says the same for the case where it is called alongside another tool.
- **Words**: steps are worded as what the reader gets, in the reader's voice, no mode names unless
  the button is that mode's ("Read the short summary", "Test what I remember", not "Open Summary ›
  Brief"). For `mode` the chip's own label is drawn (our words, the catalogue's); for `ask` the
  model's words, in the model's face (fonts.md), since the model wrote them.
- **Validation twice**, as 261009q does: the tool checks shape, caps and that a `mode` key is a
  mode or sub-mode row of the catalogue on the owner's article; the page re-checks the stored JSON
  (`stepsOf`) and draws nothing it does not recognise; `chipFor` still decides at draw and press
  whether a mode is offered here now (experimental, unknown, not openable: no button).

### 3. Actions the reader asks for: a press, through the existing control

"I want a private link for my journal club" → the guide says what it will do and offers a `share`
step; "search for X" → a `search` step with X in the box; "archive this" → an `archive` step. The
prompt tells it these are the only actions it can offer, that it never does them, and that it says
so plainly ("press Share this article… and choose Private link there").

**Nothing here shares, publishes or archives.** Share and Archive move the reader to the one place
that does each, where the reader's own press does it (the private link and public switch already
ask for confirmation of rights there). A planted instruction in the article can at worst put a
button on screen that takes the reader to their own Metadata page, or send-on-press words they can
read first.

### Not built, and why (Greg: "simplify or ignore")

- **Sharing in a modal over the reading view.** Greg's ideal. Pulling Metadata's `SharingCard` out
  into a dialog openable anywhere (its fetch of `sharing`, the masthead's public mark it reports to,
  its confirmation panel) is real work in the one card that changes who can read an article; v1
  goes to the card, the place the bar and Metadata's *Share…* already go, so there is still one way
  to make a private link. Its own queue entry.
- **Archive on the press, with Undo, from the guide.** Needs the archive controller threaded from
  Reader.tsx into Chat; v1 goes to Metadata, where one press does it. Folded into the modal entry.
- **"Kick off a chat with question Q" as a new Chat thread**, and **"a tutorial on X" / "check the
  literature for Y" with a topic**: an `ask` step to the guide, or the mode without an argument,
  covers them in v1.
- **Toggles, sliders, feedback widgets; the "control centre"** (Search's whole UI inside the chat):
  Greg's own *"I can't tell for sure if that would be a good user experience, and I assume it would
  be complex"*. Named, not queued: it is a direction, not a piece of work.
- **Next steps in Live**: a voice has nowhere to put a button (the same gap as `offer_to_save`).

## After the plan review (overrides the design above where they differ)

[GPT Sol](261009s-plan-review-sol.md): *build with changes*. It reviewed the plan with a first cut
of the code already in the tree. Each finding checked here.

- **F1 (P1), ending the turn on "the answer has words".** Right: the check read the turn's text,
  so a round one of "let me check…" plus a search, then a round two of only the steps, would have
  ended on the preamble. **Fixed, not removed**: the shortcut now needs *this round's own prose*.
  Its recommendation was to drop the shortcut and rely on the tool's sentence, as 261009q did; not
  taken, because the eval shows the model writing its reply and then the steps in one round on 32
  of 35 measured turns, and each of those would otherwise pay a second full request. That the prose may be
  only "Here are some options:" is fine: the options are the buttons under it. Tested red-green.
- **F2 (P1), a refused offer, and the mixed batch.** Taken: the turn ends only when every call was
  `offer_next_steps` **and every one came back with steps**, so a refused or failed offer goes back
  to the model, which is told no button is shown. The tool's sentence no longer says "write nothing
  more" (wrong beside `offer_to_save`'s card); it says what `offer_to_save`'s does: never repeat
  what is on screen, stop if complete. The prompt says to call it after any other tool has
  answered. Tested: refused offer, earlier-round prose, and both tools in one round with both runs
  surviving.
- **F3 (P2), experimental modes.** Taken: `guideModeKeys` is only the rows with a printed button
  token; the page filters steps it cannot draw before drawing any (`drawable`), so a row of refused
  modes is no row. The tool says the steps were *accepted*, not that the reader sees them.
- **F4 (P2), an `ask` press is model words in the reader's mouth.** Partly taken. The press is the
  reader's approval of exactly the words on the button, which are drawn in full and capped at 80
  characters, and the eval has a planted-ask article (`hostile-ask`, 0 planted steps in 5). A first
  prompt rule, "an ask is never a statement about why they are reading", was **dropped after
  measuring**: in the *Help me work out what I want from this* case the model offered reasons to
  pick from ("I want to use this as a source for a paper"), which is exactly Greg's *"help me
  clarify my intent"*. A pressed reason still reaches About you or the reason only through
  `offer_to_save`'s card and a second press. Not taken: an "Ask:" prefix on the button (the words
  are already the whole button) and pre-filling the composer instead of sending (Greg's *"kick off
  a chat with the following question"* is a send).
- **F5 (P2), a fixed *Archive* label lies on an archived article.** Taken: *Archive or put
  back…*, true either way, without threading the archive controller into Chat.
- **F6, F7 (tests and acceptance criteria).** Taken where they test this change: the turn-ending
  cases above; the row never presses a mode even inside an unspent act (`GuideActContext` set to
  `null` around the row, red without it); no group when nothing is drawable; latest answer only;
  none while a turn is out; no ⚙ line; edited search words reaching the quick-search runner. Usage,
  truncation, stop and history were audited by the reviewer as structurally unaffected
  ("§ End-turn audit" in its answer) and are covered by converse's existing suites.

## The simpler options passed over

- **Prompt only: end every answer with up to three existing `[cmd:]` chips** and let the page group
  trailing chips. No new tool, but no `ask` step, share or archive without new ids on
  `CHAT_PROPOSABLE`, which is a defence edit this run may not make; and it would put every one of
  them inside the guide's act.
- **A new token family, `[ask:…]`**: free in-line, but a new shape for the renderer, `citableText`
  and the seed's token stripping to agree on, and a sentence percent-encoded or bracket-fragile.
  The tool takes JSON.
- **Fixed defaults always, no model steps**: half the request.

## Security

No new write path, no new server route, no change to `chipFor`, `CHAT_PROPOSABLE`, `runTool`'s
gate or the guide's act. A guide-only tool is added to `toolsFor("guide")` exactly as
`offer_to_save` was. The row is a new place where model output becomes a button, beside the chips
and the save card: its buttons send words the reader sees, open a mode through `chipFor`, run a
quick search through `chipFor`, or navigate to the reader's own Metadata page. The security-map row
for chips would gain a mention; that is a rule doc, so the proposed wording goes to Greg in
q-w2740x, as 261009q's did.

## Measured

[`evals/guide/next-steps.ts`](../../evals/guide/next-steps.ts), production's `converse`, kind
`guide`, Sonnet 5.5, the two offer tools answered by the real `runTool`, the article tools by
"nothing found"; results under `evals/guide/results/next-steps-v*.json`. Scored: required step
kinds present, forbidden ones absent, at most three, no claim that an action was done, not written
twice, not a planted step.

| version | change | result |
|---|---|---|
| v1 | as first written | 12/12 |
| v2 | after the plan review (tool sentence, after-other-tools, planted-ask case added) | 20/21; the miss is the eval's own: its stubbed article search finds nothing, so the model did not offer a search for words it could not find |
| v3 | the ask rule replaced (see F4) | 8/8 |
| v4 | the share/archive sentence names the buttons' own words | 6/6; before it, one answer said "press the Share button, then press Share this article…", one button described as two |

About $1.04 in all. 32 of the 35 v2-v4 turns took one model request; the rest searched the article
first and went round as they should.

## Stages

### Stage 0: plan review
- [x] GPT Sol, read-only: build with changes (§ After the plan review).

### Stage 1: the tool, the turn's end, the prompt
- [x] Tests: the tool's checks (each kind, caps, unknown kind, bad mode key, more than
      three, none valid); `toolsFor("guide")` has it, `GUIDE_TOOLS` and `LIVE_SERVER_TOOLS` do not;
      `converse` stops after a round of only `offer_next_steps` with text, and goes round again when
      the answer is empty or another tool was called; the steps stored on the run.
- [x] `GUIDE_SYSTEM` § NEXT STEPS; measured (§ Measured).

### Stage 2: the page
- [x] The three starts in the greeting; `GuideNextSteps.tsx` (`stepsIn`, the row, the search box);
      hidden tool row; tests for each kind, the latest-answer rule, no act, invalid JSON.

### Stage 3: docs, browser, review, bookkeeping
- [x] Docs: chat-tools.md, live-conversation.md, the Help page's Chat entry (corpus regenerated).
- [x] Sonnet subagent in a browser, 1440 and 390 (§ Log).
- [x] GPT Sol code review (§ Code review); gates; push; queue entry `qi-ddvxcsdv` for the dialog; note; q-w2740x answered, its follow-ups in q-dqh7t6.

## Code review

[GPT Sol](261009s-code-review-sol.md) on [the diff](261009s-code-review.diff), workspace-write:
*land with fixes*, no P1.

- **P2, fixed by the reviewer**: a search box the reader had edited kept its words when a later
  answer offered the same search (the row's key was the step alone). The key now includes the
  answer's id; regression test.
- **P2, fixed by the reviewer**: the eval recorded requests but never failed on an extra one after
  an accepted steps-only round; it now scores that. Not re-run (paid).
- **P2, fixed by the reviewer**: tests that usage and truncation survive the shortcut, that a
  thrown offer goes round, and that a late empty offer reaches the last, tool-less round.
- **P3, fixed by the reviewer**: stale comments on the turn-ending conditions and the archive
  wording.
- **P3, left**: security-map.md's chip row does not name the new row (a rule doc and a listed
  defence): proposed to Greg in q-dqh7t6.
- After the review: its change of two test `createElement` calls to pass children positionally (a
  lint suggestion) failed `npm run typecheck`, which its sandbox could not run; put back.

## Log

- 2026-10-09: **seen in a browser**, Sonnet subagent, Playwright, 1440 and 390, the local
  *Attention Is All You Need*, four paid turns. All seven checks passed, no console errors from the
  change: the empty guide's three starts, gone after the first send; a row of three under the
  answer (*I want to understand why this paper mattered historically*, *Open Structure*, *I just
  want the idea in plain terms, no maths*), nothing pressed by itself, no ⚙ line; *Can you make me
  a private link…* answered "I can't make the link from chat. Press *Share this article…* below",
  which landed on Metadata's *Access & sharing* card (nothing turned on); a search step whose box,
  edited to *attention heads*, relabelled its button and opened Search with 15 passages; after a
  reload the latest answer's row only; no horizontal scroll at 390. Shots:
  [empty](261009s-shot-1-empty-guide-1440.png), [empty, phone](261009s-shot-2-empty-guide-390.png),
  [a row](261009s-shot-3-answer-next-steps-1440.png), [share](261009s-shot-4-share-offer-1440.png),
  [reload](261009s-shot-5-after-reload-1440.png),
  [the card](261009s-shot-6-metadata-access-sharing-1440.png),
  [search](261009s-shot-7-search-offer-1440.png), [edited](261009s-shot-8-search-edited-1440.png),
  [Search mode](261009s-shot-9-search-mode-1440.png), [phone](261009s-shot-10-next-steps-390.png).
- 2026-10-09: **the full suite** found two guards this change had to answer: `src/next-steps.ts` is
  now on the client's allowlist of pure shared modules (tests/client-imports.test.ts), and the
  search step's box says what Enter does: it presses the quick-search chip beside it, as the
  Dock's own quick search runs on Enter (tests/what-the-enter-key-promises.test.tsx; a test here
  too). The suite's third red, doc-links on `agents.md` in q-rstqvz's quoted reply, was already on
  `dev` and is not this change's.
