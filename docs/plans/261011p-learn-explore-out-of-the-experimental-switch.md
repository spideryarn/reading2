# Learn's Explore out of the experimental switch

Up: [plans.md](../project/plans.md)

Report `spya-jm0nfg` (#556, Sentry SPIDERYARN-READING2-H5, queue item `qi-z68b5swt`), from an
admin, so trusted input:

> The explore submode in learn should be a main mode, i.e. not an experimental feature anymore,
> because it's useful.
>
> — Greg, 2026-10-11 (spya-jm0nfg)

## Which reading of "main mode"

**Explore stays a sub-mode of Learn and is no longer behind the switch**: a fourth chip that every
owner sees, as Recall, Tutorial and Quiz have been since 2026-10-05. Not a top-level mode of its
own. The report's own words are "not an experimental feature anymore, because it's useful" — the
point is who can see it, not where it sits — and Explore shares Learn's band, its (i), its
conversation machinery and its owners-only rule. Making it a mode would mean a new `MODE_CATALOG`
row, a new Dock button, a URL value and every place [mode.md](../project/mode.md) lists, for no gain
the report asks for. If Greg meant a top-level mode, that is a separate piece of work and this one
is still its first step.

This undoes the second half of
[261005b](../plans/261005b-remember-out-of-the-experimental-switch-explore-stays-behind-it.md),
which kept Explore behind the switch because it was two days old.

## What changes for a reader

- **Switch off**: Learn's chips read **Recall · Tutorial · Explore · Quiz**, the band's (i) lists
  four parts, and the command bar has a *Learn › Explore* row. With the switch on, nothing changes.
- **Visitors**: nothing. Learn is owners-only (`POLICY.learn`), and that rule is not the switch's.
- **Tutorial points at Explore.** When the reader sets off on a line of their own, Tutorial's
  prompt says *"Say once that Chat is the place to take it further."* It names Chat rather than
  Explore on purpose, because Explore was hidden from most readers, and
  [learn-mode.md](../project/learn-mode.md) says *"When Explore leaves the switch, that sentence of
  the prompt should name it."* So it now names Explore.
- **Nothing new is generated when an article is added, and an Explore turn costs what it did.**
  Explore is a conversation: a model is called only when the reader sends a message, as in
  Tutorial. What changes is that every owner can now choose those paid turns and their web
  searches. Changing Tutorial's system prompt and Guide's mode list (below) each cost one cold
  cache write on the next turn, then the stable prefix is reused (GPT Sol's plan review, F4).
- **Guide may now offer Explore**: its mode list drops the *(experimental)* tag and
  offers its button (it said *Opens at once* until the guide stopped opening modes itself, the same day).

## The build

One stage; it is small.

1. `LEARN_SUB_MODES.explore.experimental` to `false` (`src/web/sub-modes.ts`), and its comment.
   The chips, the (i) and the command bar all read that flag, so nothing else in the client changes.
2. **`visibleLearnViews` and the `experimental` prop on `LearnSubModeToggle` stay.** With no Learn
   part flagged, the helper returns all four, but it is the one place a future Learn part would be
   gated, and the field it reads is required on every sub-mode so that each new one is decided.
   *The simpler-looking option passed over*: delete the helper and the prop. It touches more files
   now and has to be rebuilt the next time a Learn part is new.
3. Tests: `tests/learn-header-cards.test.tsx`'s policy block becomes "every Learn part is shown,
   on or off" (no Learn sub-mode flagged; four chips, four (i) lines, four bar rows in every state).
   `tests/command-bar-sub-modes.test.tsx`'s two Explore cases become "offered from every address".
   `tests/guide-kind.test.ts` takes `Diagram › Force` as its experimental sub-mode and requires
   Explore ordinary, with its button. `tests/chat-commands.test.ts` used `learn:explore` as its
   example of an experimental sub-mode; it switches to `diagram:force`.
   `tests/tutorial-kind.test.ts` gains a deterministic check that the section names Explore and not
   Chat. Regenerated: `src/command-pick-catalogue.generated.json` (the server's copy of the
   command bar, which Guide reads) and `src/help-corpus.generated.json` (the help chatbot's).
   The last four were GPT Sol's plan review, F1 to F4; F5 was the stale comments, fixed in
   `mode-catalog.ts`, `LearnAbout.tsx`, `QuizPanel.tsx`, `CommandBar.tsx`, `ConversationModes.tsx`,
   `quiz.css` and two tests.
4. The Tutorial prompt (`src/converse.ts`, § WHEN THEY GO EXPLORING): *"Say once that Explore, beside
   Tutorial in Learn, is the place to take it further."* The eval's watch line in
   `evals/learn-tutorial.ts` follows. There is no version stamp; the eval records a prompt hash.
5. `/help`: `src/web/help/pages/modes/learn.md` loses the sentence that says Explore is
   experimental.
6. Docs: [experimental-features.md](../project/experimental-features.md) (Explore leaves § What is
   behind it and § The two things gated below mode level, with Greg's words and the date),
   [learn-mode.md](../project/learn-mode.md) (§ Who sees which chip, and the Tutorial paragraph about
   pointing to Chat), and the comment in `sub-modes.ts`.

## Measuring the prompt change

A one-noun swap in a branch the model reaches rarely, in a pointer
[261003c](../investigations/261003c-tutorial-prompt-leans-to-retention.md) already found unreliable
(it appeared in two runs of four). The full blind before/after of
[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change)
is out of proportion. Instead: run `npm run eval:tutorial` on one article once after the change and
read the `richRecall` reader's search-request turn — does it name Explore when it points anywhere,
stay brief, and come back to the piece? That is a smoke test, not a reliability measure; the test
in step 3 is what holds the wording. Recorded in this plan's results section.

## Checked, and not changing

- **The add page's list and the first-open default** read whole modes, not sub-modes; Learn is
  already outside the switch.
- **Chat's command chips** check a sub-mode against the same flag, so Chat may now offer
  *Learn › Explore*; that is the point.
- **Old `?learn=explore` links** already worked with the switch off.

## Results

**The Tutorial pointer, one run after the change** (`npm run eval:tutorial -- --out=261011p-tutorial-after`,
prompt `5b923b1b2eab`, Noema, four readers × five turns): `richRecall`'s third turn, the one where
the reader asks for a web search, answered in 99 words with two linked critiques, then *"Explore,
beside Tutorial in Learn, is the place to go further"*, then a question about the article's own
four arguments. No turn named Chat. Over the 140-word ceiling: 0 of 20; own-view tasks flagged: 0
of 20. The model lifted the prompt's phrase word for word, which is fine here, since it tells the
reader where Explore is. One run, read rather than judged blind:
[`evals/results/261011p-tutorial-after.md`](../../evals/results/261011p-tutorial-after.md).
