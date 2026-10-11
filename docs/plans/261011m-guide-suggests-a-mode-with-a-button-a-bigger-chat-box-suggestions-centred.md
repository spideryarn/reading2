# 261011m — The guide suggests a mode with a button, a bigger chat box, suggestions centred

Owned by [plans.md](../project/plans.md). Overseer queue item `qi-gr52s8dn`; reports `spya-gae0zv`
(#555, SPIDERYARN-READING2-H4) and `spya-srg5fa` (#558, SPIDERYARN-READING2-H7), both Greg's
(`feedback-reporter.ts` exit 0). Session `fbgae0zv-guide-suggests-not-jumps`.
Reverses item 1 of [261007p](261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md)
and with it [261008a](261008a-guide-opens-glossary-and-summary-when-already-made.md).
**Status: built; GPT Sol on the plan ([review](261011m-plan-review-sol.md)) and the code ([review](261011m-code-review-sol.md), "ship after my fixes"); measured ([261011a](../investigations/261011a-the-guide-offers-buttons-only-measured.md)); seen in a browser; on `dev`, not deployed.**

## What Greg asked for

> I was showing the guide chat to a new user, and they asked it for suggestions, and it opened a
> different mode directly, and they were surprised and didn't know what to make of it. I think
> instead it should suggest things, with a UI button for them to press that would take them to that
> mode, so that they're aware of what's happening.
>
> — Greg, 2026-10-11, `spya-gae0zv`

> In all the various chat modes (including Guide etc), can you make the input box larger and a tiny
> bit more prominent? I don't think people initially noticed it, especially when we offer them UI
> suggestions in little boxes. Perhaps we could actually move those into the center as well, so
> they're a bit less prominent underneath the last agent response.
>
> — Greg, 2026-10-11, `spya-srg5fa`

## Stage 1 — the guide never presses a button itself

Since 261007p the first chip in a guide answer that "only moves the reader" pressed itself when the
answer finished (`src/web/guide-acts.ts`, rule in `src/acts-alone.ts`), and since 261008a so did
Glossary and Summary's Brief/Fuller when already made (`opensFree` on the `done` frame, the
`ALREADY MADE FOR THIS ARTICLE` line in the prompt). That is exactly what surprised the new reader.

**Decision: delete the act, not switch it off.** Every model-written `[cmd:…]` token becomes, in the
guide as everywhere else, a button the reader presses. What goes:

- `src/web/guide-acts.ts` (`useGuideAct`, `GuideActContext`, `actsAlone`, `isShown`) and the act
  effect in `src/web/CommandChip.tsx`, plus `CommandExecutor.openModeUnarmed` if nothing else uses
  it; the plumbing in `ChatPanel.tsx`, `GuideNextSteps.tsx` (its null provider), and the
  controller's `Answered` event / `onAnswered` if the act was its only listener.
- The `opensFree` field on the chat `done` frame and in the client model/reducer; the server's
  `guideMade` read and `MADE_READS` in `src/routes.ts`; `madeLine` and its sentence in
  `src/guide.ts`; `src/acts-alone.ts` entirely if nothing else then imports it (the referee
  behind-the-switch rule only existed to keep those modes out of the act).
- The guide prompt (`src/guide.ts` § `modeWordsSection`): every mode gets the same ` Button:` token;
  the "In this conversation, unlike the rule above, some actions you may take yourself" paragraph is
  replaced by one sentence: *you never open anything yourself; offer it with its button and say
  what pressing it will do* — so the model stops writing "I've opened Structure for you".
- Tests that exist only for the act are deleted (`tests/guide-acts-*.test.*`); tests that assert
  other things through it are trimmed. One new test pins the reversal: a guide answer with a
  movement-only chip, finished on screen, leaves the mode where it was and draws a pressable button.
- Docs: chat-tools.md, security-map.md (the defence row's "one exception" sentence goes: a press is
  now the only way, without exception), chat-llm-help-commands-vision.md, url-state.md,
  referee-mode.md, and a status line at the top of 261007p/261008a pointing here.

**Security bound.** security-map.md lists `chipFor`'s files as a defence and names `guide-acts.ts`
as its one exception. This stage removes the exception and touches nothing in `chat-commands.ts` or
`command-proposal.ts`' checks: it narrows what a model's words can do to the rule that already holds
everywhere else. Greg's report asks for this very change. So it is built, not sent as a question.

**Simpler option passed over:** keep the machinery and stop the prompt marking anything *Opens at
once*. Cheaper today, but leaves a whole mechanism (server read, frame field, client effect,
StrictMode guards) live and untested-in-use, ready to fire on any token. Deleting is the simple
thing.

**Queue item `qi-bt4z2zaw`** part (1), "a spoken guide opens modes itself", contradicts this; its
note is amended to say so (parts 2 and 3 stand).

## Stage 2 — a bigger, more noticeable box; suggestions centred

One `Composer` (`src/web/ChatPanel.tsx`) serves Chat, the guide, the chat list's new-conversation
box and the block chat dialog (`ChatDialog.tsx`); Learn already has its tall box. So:

- **Larger:** Chat-kind boxes rest at **2 rows** instead of 1 and may grow to **200px** instead of
  160 (`boxSize`); `.chat-input` `max-height` follows. Font 0.94rem → 1rem.
- **A tiny bit more prominent:** the box already has the shared band-field look (`--rule-strong`
  border, page ground, `--highlight-text` focus ring — GPT Sol's F6: raw `--highlight` fails
  contrast), and tests/run-buttons-and-text-boxes-agree.test.ts keeps every band field alike. So the
  new prominence is around it: the composer strip gets the raised surface, so the page-coloured box
  stands out from the transcript. No animation — "a tiny bit".
- **Suggestions in the centre:** the `.chat-suggest` lists (the guide's greeting starts, its next
  steps, Chat's empty-state suggestions) become a centred column of buttons sized to their words
  (`width: auto`, `max-width: 100%`, text centred), so they sit apart from the left-aligned answer
  they follow instead of reading as its last paragraph. Inline `[cmd:…]` chips inside an answer stay
  where the answer put them.
- **Short viewports** (`(max-height: 500px)`, a landscape phone) keep one row, as Learn drops to two
  there. Check a 390px portrait at two rows and a ≤500px-high landscape at one (F8). The search next
  step keeps its full width inside the centred column (F7).

**Not done:** other single-purpose boxes that are not chats (Candidates, comments, quiz).

## What GPT Sol's plan review added to stage 1

F1: remove the unarmed opener in `src/web/command-runners.ts` and its duplicate in
`src/web/reader/Reader.tsx`, but keep the armed `ModeDoor`, the guide executor and `arms` (Dock,
Metadata, visitors), and keep `offeredBehindTheSwitch`: it still decides which hidden modes get a
pressable button. F2: the `made` chain runs through `src/converse.ts` (`ConverseRequest`, the final
user message) and the route, and goes with it. F3: `Answered` also lives in `useChat.ts` and
`ConversationModes.tsx`. F4: tests beyond `guide-acts-*` need editing (behind-the-switch door,
command-runners, client-imports, guide-kind, guide-route); the prompt assertions in
`guide-acts-rules.test.ts` are replaced by: every token says `Button:`, none says `Opens at once`,
and the prompt forbids opening anything. F5: the reader's help page
`src/web/help/pages/modes/chat.md` says the guide opens modes itself (regenerate the help corpus),
and live-conversation.md contrasts the spoken guide with a typed one that acts.

## Checks

`npm test` for the touched suites as I go, `npm run typecheck`, the full suite once at the end; a
browser pass (Sonnet subagent, Playwright on the box) of the guide at 1440 and 390: a guide answer
that names Structure leaves the band where it was and shows a button; the composer and centred
suggestions in Chat, guide, block chat. GPT Sol on this plan (read-only) before building, and on the
code before pushing.

## What landed

- **Stage 1** (`7c2cff9f5`), as planned with the review's additions. The guide prompt measured on
  the eval: no answer claimed to have opened anything (the old prompt: 3 of 12) —
  [261011a](../investigations/261011a-the-guide-offers-buttons-only-measured.md).
- **Stage 2** (`bf6e968f5`), as planned.
- **GPT Sol's code review** fixed three things: the prompt's "never run anything" contradicted the
  guide's article-reading tools, so it now names app actions; the raised strip was invisible inside
  the block-chat card, which is itself raised, so the strip there takes `--panel`; and stale act
  wording in Reader.tsx and the vision doc.
- **Browser check** (Playwright, 1440, 390 portrait, 844×390, dark, block chat; shots
  `261011m-shot-*.png`): a guide answer naming Structure left the band on Chat and drew *Open
  Structure*, which opened it on a press. It found one bug of ours: an empty box grew to fit its
  placeholder, because an empty textarea's `scrollHeight` counts a wrapped placeholder, so the
  guide's long placeholder made the landscape one-row box three lines tall. Fixed: an empty box rests
  at its rows (test in tests/learn-panel.test.tsx, red first).
- **Seen and left alone:** in an 844×390 landscape guide the Live button wraps under the box, as it
  did before this change. The light theme could not be emulated in that run, so it was checked only
  through the tokens.
