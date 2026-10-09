# 261009i — The guide greets you in the chat, takes Live, and has a row in the bar

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-7wcnqdd6`; reports `spya-s6qhzv`
(#500, SPIDERYARN-READING2-FB) and `spya-x38nge` (#501, SPIDERYARN-READING2-FC), both Greg's
(`feedback-reporter.ts` exit 0). Session `fbs6qhzv-guide-greets-and-live`. Follows
[261007j](261007j-the-guide-a-conversation-about-how-to-read-this.md),
[261007p](261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md) and
[261008a](261008a-guide-opens-glossary-and-summary-when-already-made.md).
**Status: built, GPT Sol on the plan and the code, seen in a browser, on `dev`. Not deployed. One question for Greg, `q-w2740x`.**

## What Greg asked for

> The new guide chat UI is a bit confusing. It shows the input box for why you're reading this, and
> so I put in some text in there, and then I was like, well, now what? There didn't seem a button to
> save it, or I guess it says saves as you type, but I definitely didn't notice that. And I think if
> we're in a chat interface, I want to use the chat interface. So, for example, I think what I was
> expecting it to do was, before it loads the chat, check, you know, have I entered a user profile?
> Have I entered why you're reading this? And then depending on that, maybe it would
> deterministically generate an initial message: Hi there, welcome. I see you've imported blah blah
> blah. I noticed from your profile that blah blah. Is that right? More importantly, why are you
> reading this particular article? You can tell me about yourself, or you're perhaps reading it and
> I'll update your profile and reasons accordingly […] So probably it would mean that the model
> would then generate. The first message, the greeting message, so that it's customized […] Maybe
> you can see an 80/20 or a better way of doing this […] if they say they want to read it with their
> journal club, then maybe we'd say, Okay, do you want to create a private link? Or […] Do you want
> to make it shared? Or […] do you want to archive it? Like, all of these should be actions that the
> chat could help them take.
>
> And then it should always be possible to get back to the guide chat. In fact, there should be a
> command in the command bar for opening the guide chat. […] So maybe it gets its own icon in the
> list of chat threads.
>
> — Greg, 2026-10-09, `spya-s6qhzv` (full text in the note)

> Why doesn't the Guide chat have a live conversation option?
>
> — Greg, 2026-10-09, `spya-x38nge`

## What is already there

- **The guide's own icon in Chat's list**: built in 261007j (`GuideRow`, `Compass`, pinned first).
  Nothing to do; the note says so.
- **Suggesting Brief or Fuller from their background, and opening it**: the guide already suggests
  modes, opens free ones by itself, and opens Summary's Brief/Fuller by itself when made (261007p,
  261008a). The prompt's "match the introduction to how much they have used Spideryarn" covers the
  "you don't have a background in this" pitch.
- **The empty guide** (`GuideGreeting.tsx`) is our fixed text, an autosaving *Why you're reading
  this one* box when none is stored, and *Ask the guide where to start* once one is. That box is
  what confused Greg.
- **Live is switched off for the guide on purpose**: `openKind !== "guide"` in
  `ConversationModes.tsx`, `SpokenKind = chat | learn` in `src/chat.ts`. 261007j said only "the
  guide is typed".

## The design (v1)

```
 Chat band, guide
 ┌──────────────────────────────────────────┐
 │ 🧭 guide (our words, drawn as its first   │  ← no model call, no box
 │ bubble, kept above the turns)            │
 │  Hi, I'm your guide to "Attention Is All │
 │  You Need". Your profile says you are     │
 │  "a cognitive neuroscientist…" — is that  │
 │  still right? More importantly: why are   │
 │  you reading this one? Tell me below.     │
 │ ──────────────────────────────────────── │
 │ you: for journal club next week, I don't  │
 │      know much ML                         │
 │      [Keep this as why you're reading]    │  ← the reader's own words; their press
 │ guide: Then start with Summary › Brief…   │
 │ ──────────────────────────────────────── │
 │ [ type…                 ] [Live] [Send]   │  ← Live now offered here too
 └──────────────────────────────────────────┘
```

### 1. The greeting is the guide's first chat bubble, and there is no box

Opus's product call, accepted: a **fixed greeting written by us**, drawn as an assistant-style
bubble, free, not stored, not a model call. The part that sounds personal — *"what makes a
neuroscientist want to learn about LLMs?"* — comes in the guide's first real reply, which already
has the profile, the reason and the whole article; a separate model-written opener would pay a
weaker model (one shown only the abstract) to do what that reply does better, and would spend on
every new article whether or not the reader answers.

What it says, by what we already know (`GET /api/reader?slug=`, as now):

| known | the greeting |
|---|---|
| no reason, no About you | welcome, the title, *why are you reading this one?*, and *tell me a little about yourself too, if you like* |
| no reason, About you | welcome, the title, the first sentence of About you quoted (cut at ~120 characters) with *is that still right?*, then *more importantly, why are you reading this one?* |
| a reason | welcome, the title, *you said you're reading it because "…"*, and the *Ask the guide where to start* button as today |
| the read failed | welcome and the title only; nothing claimed about what they have or have not said |

It stays **above the turns once the conversation has begun**, so the reader's answer is visibly an
answer. The model is told, in `GUIDE_SYSTEM`, that the conversation opens with a fixed greeting of
ours on screen (not in the transcript) asking why they are reading and, when the profile is empty,
who they are, so the first message is likely an answer to it. The sentence about "a box for it" goes.

### 2. The reason is kept from the reader's own words, by their press

Under the reader's **first message in a guide whose reason was definitively none at the read**, one
small button: **Keep this as why you're reading**. A press saves that message (cut to
`MAX_PURPOSE_CHARS`) with the same `savePurpose` the box used, then the button becomes *Saved as why
you're reading this one* with a link to Metadata, where it can be edited. A failed save says so and
the button comes back. Once a reason exists (saved here, or elsewhere) nothing more is offered.

Why this and not the guide saving it: anything a model proposes or does that **writes** the
reader's data is either a new chip id on `CHAT_PROPOSABLE` or a new exception to *"anything that
writes … is still a press"* — both edits to a defence in [security-map.md](../project/security-map.md),
which this run does not make. This needs neither: no model is involved, it is the reader's own words
and the reader's own press, exactly like the box it replaces. The better version — the guide picks
the reason out of the reader's message as an exact quote, the page checks it is a substring, and
saves it with an Undo — is Opus's recommendation and goes to Greg (below).

### 3. Live in the guide

The guide's composer gets the same Live button as Chat. A spoken guide session is **the reading
companion's voice rules plus a guide section**: who you are (their guide to reading this piece with
Spideryarn, not a summariser), start from why they are reading, ask if not known, suggest where to
start and which modes, **naming modes by their names** (a list from the catalogue, without
`[cmd:…]` tokens, which speech cannot press). Its tools are the guide's article tools plus
`show_passage`; no web search, as in the typed guide.

- `src/live.ts`: `liveInstructions` and `liveSession` take `kind`; for `guide` they add
  `SPOKEN_GUIDE` (the section) and `spokenModeWords()` (from `src/guide.ts`, the same rows
  `modeWordsSection` reads), and `liveTools(kind)` offers `SHOW_PASSAGE_TOOL` + `GUIDE_TOOLS`.
- `src/live-gpt.ts` (GPT-Live, behind Experimental): the voice instructions and the backend
  instructions get the same section for a guide thread.
- `src/routes.ts`: both token routes pass the stored thread's kind (GPT-Live's already does for the
  seed).
- `src/chat.ts`: `SpokenKind` gains `guide`; `targetOf` already routes a fresh id to the article's
  one guide, so a guide begun by speaking is still one per article.
- `ConversationModes.tsx`: the `openKind !== "guide"` and `kind === "guide"` refusals go; Live from
  an empty guide begins the guide (not a chat).
- The live tool endpoint is unchanged: it accepts `LIVE_SERVER_TOOLS` names for any session, and
  the guide is offered a subset of them.

Greg has said Live "doesn't work very well at the moment" (the reason Tutorial and
Explore have none); this inherits whatever Live does today, no better and no worse.

### 4. A *Guide* row in the command bar

An action row, **Guide** — *"This article's guide: how to read it, and what Spideryarn can do for
you here."* — on the owner's reading view only, which navigates to `?mode=chat&guide=1` (the door
261007j built). Aliases: `guide`, `tour`, `where to start`, `how to read`, `welcome`. Help keeps
its `guide` alias; an exact label match ranks Guide first. Catalogue regenerated. The bar's
*Ask the guide: "…"* row is unchanged.

## After the plan review (overrides the design above where they differ)

[GPT Sol](261009i-plan-review-sol.md): *build with changes*, three P1s. Each checked here.

- **F1 (P1), Live touches a defence.** Half right. `src/routes.ts`' listed defences are `slugPart`
  and `requireUser`, which this does not touch. But the plan's *"the live tool endpoint is
  unchanged"* was wrong: `/live-tool` called `runTool` with no kind, so a guide's model naming a tool
  the guide is not offered would have run it, and the `chat-tools.ts` row says a conversation's
  tool list is a boundary. **Fixed by using the defence, not editing it**: the page sends the
  session's kind on every tool call (fixed at start), the route checks it is a `SpokenKind` and
  passes `guide` to `runTool`, whose existing `toolsFor` gate refuses the rest. The model chooses
  only the name; the reader's own page says the kind. Tested red-then-green.
- **F2 (P1), a fresh guide's kind.** Built as asked: `LiveOptions.kindOf`, read once at start, on
  both engines' ticket bodies and every tool call; the stored kind wins; a contradiction is a 409
  before anything is minted. A fresh id for an article whose guide is stored is not reachable from
  the band (`openGuide` opens the stored one), so the direct lookup is left.
- **F3 (P1), *Keep this* could overwrite.** Taken without a new atomic store operation: the press
  asks the server what is stored first and never writes over a reason (says so instead), one write
  per press, `madeFor` bound, and a rejected save is checked against the server before it is called
  a failure. The residual race is two tabs of one reader pressing within a fraction of a second, and
  the loser's words are their own. An atomic save-if-empty would be a store contract change for
  that; not worth it in v1, named here.
- **F4**: offered only when the whole message fits as stored (`keepableReason`); otherwise a link to
  Metadata. **F5**: the greeting is not stored and is not rebuilt over old turns — drawn only by a
  mount that saw the guide empty, kept above the turns while that mount lasts. **F6**: the seed takes
  `[cmd:…]` buttons out of every assistant answer (`withoutCommandButtons`); cost jobs unchanged.
  **F7**: the row is gated on `executor.openGuide`, which only the owner's reading view hands over,
  and opens through `?guide=1` and Chat's band (nuqs keeps the other parameters). **F8**: *"In About
  you, you wrote …"*, whitespace collapsed, `clamp`; the title in the author's face, quotes in the
  reader's. **F9**: pinned by tests/command-bar-guide-row.test.ts and the regenerated catalogue
  (owner article, experimental-off, archived).

## The simpler options passed over

- **Keep the box, add a Save button.** Fixes "now what?" but not "if we're in a chat interface, I
  want to use the chat interface".
- **Save the reader's first guide message as their reason automatically.** Their own words, no
  press — but "where do I start?" would become their reason.
- **Live in the guide with the companion's prompt unchanged.** One line of code, but the spoken
  guide would be a content companion, not a guide.

## Deferred, each with its own queue entry before the note may say shipped

Queue entries: `qi-bn7qs2r9` (reason and About you, q-w2740x 1), `qi-rt49dwcd` (share, private link,
archive, q-w2740x 2), `qi-bt4z2zaw` (spoken guide opens modes; profile asked less often; a
model-written greeting).

- **The guide keeps the reason itself** (exact-quote from the reader's message, checked, saved with
  Undo) and **proposes an addition to About you** (a button, full text shown). Writes by a model's
  choice: a defence edit, so Greg's — question file.
- **Actions: private link, make public, archive** from the guide. Sharing and publishing change who
  can read an article ([security-map.md](../project/security-map.md) § the public namespace and the
  private-link key); archive writes the reader's shelf. Written up for Greg in the same question.
- **A model-written greeting** (Greg's "probably the model would generate the first message"):
  revisit if the fixed one reads flat in use; Opus's reasoning above is why not now.
- **A spoken guide that opens modes** (an `open_mode` tool answered in the browser, like
  `show_passage`, through `guide-acts.ts`' rules). v1 names them.
- **Ask about the profile less often** (only when empty or not confirmed lately); v1 quotes it on
  every new article's guide.

## Stages

### Stage 0: plan review
- [x] GPT Sol, read-only: build with changes (§ After the plan review).

### Stage 1: Live in the guide
- [x] Tests red first: `liveInstructions({kind:"guide"})` carries the guide section and spoken mode
      names and no `[cmd:`; `liveTools("guide")` has no web tools; a spoken turn may create and
      append to a guide, still one per article; GPT-Live's voice/backend instructions for a guide.
- [x] Server and client changes above. Docs: live-conversation.md § In the guide, chat-tools.md.

### Stage 2: the greeting in the chat, and keeping the reason
- [x] `guideGreeting(read, title)` pure, tested per row of the table; `GuideGreeting.tsx` draws it as
      a bubble, kept above the turns; the box goes; `GUIDE_SYSTEM`'s box sentence becomes the
      greeting sentence.
- [x] *Keep this as why you're reading* under the first reader message; tests for shown/hidden,
      saved, failed.

### Stage 3: the bar's *Guide* row
- [x] Row, aliases, owner-only, catalogue regenerated; test that `guide` ranks it first.

### Stage 4: docs, browser, review, bookkeeping
- [x] Sonnet subagent: desktop and phone (greeting, keep button, Live button present, bar row).
- [x] GPT Sol code review (workspace-write); gates; push; queue entries; question file; note.

## Code review

[GPT Sol](261009i-code-review-sol.md) on [the diff](261009i-code-review.diff): *land with fixes*.

- **P1, fixed by the reviewer**: a stored Tutorial, Explore or Candidates thread could open a Live
  session, and on GPT-Live be billed, before the spoken append refused its kind. Older than this
  stage (Realtime since `cc2b67d49`, GPT-Live since `b3d4b4c9e`). `liveKind` now refuses any stored
  kind that takes no Live before anything is minted or journalled. Postmortem
  [261009i](../postmortems/261009i-a-late-prerequisite-guards-the-aftermath-not-the-action.md).
- **P2, fixed by the reviewer**: a slow purpose read could draw the greeting above words the reader
  had already sent, and offer to keep them as an answer to a question they never saw. The greeting
  is now snapshotted only while the conversation is still empty.
- **P3, reported and left**: `/live-tool` still takes the kind from the page, so a hand-made request
  that omits it gets Chat's tools. Not a model or article bypass (the model chooses only the name;
  the reader's own page says the kind), and a hand-made request from the owner could open a chat
  session anyway. Binding it on the server would mean storing the kind on the session's journal
  row: a schema change for no reader-visible gain now.
- After the review: its new GPT-Live test opened a Tutorial by the id it asked for, which a
  one-per-article kind need not keep; it now opens the id the store returned (30/30).

## Log

- 2026-10-09: **seen in a browser**, Sonnet subagent, Playwright, 1440 and 390, local articles, one
  paid turn. All six checks passed, no console errors: the greeting bubble with no box; Live present
  in the guide's composer (not connected); the greeting kept above the reader's answer, *Keep this*
  under it, pressed, and Metadata showing the reason; *Guide* first for "guide" in the bar with Help
  second, opening the guide from Structure; no horizontal scroll at 390; and after a reload, the old
  turns with no greeting and no keep button. Shots: [greeting](261009i-shot-1-greeting.png),
  [after sending](261009i-shot-2-after-send.png), [kept](261009i-shot-3-kept.png),
  [Metadata](261009i-shot-3b-metadata.png), [the bar](261009i-shot-4-commandbar.png),
  [phone](261009i-shot-5-phone-greeting.png), [reload](261009i-shot-6-reload.png).
- 2026-10-09: the prompt change to `GUIDE_SYSTEM` (the greeting paragraph in place of the box
  sentence) was not re-measured against the 261007a eval; it removes a sentence about a box that no
  longer exists and tells the model what the reader was asked.
