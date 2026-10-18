# Modes say what the wider world thinks, labelled

Report `spya-h5mteu` (#604, suggestion, 2026-10-18 00:13Z, Sentry SPIDERYARN-READING2-JV), from
Greg (admin; `feedback-reporter.ts` exit 0). Queue item `qi-q23f2m47`. Filed from Quiz, on Rovelli's
*The Order of Time*.

> Okay, so this is a point that spans multiple modes. There's been a few cases where the modes have
> said, This is what the article says, and restricted their commentary or their responses to what is
> in the article. Well, on the one hand, I really, really appreciate that. That's what we're trying
> to do here. On the other hand, I'm also keen to sort of situate the article in terms of the wider
> world. And if the article is wrong or if there's disagreement, I also want to be aware of that.
> Now, it may be that the AI, from its pre-training, already knows that things aren't so simple, or
> even that the article is incorrect. Or it may be that it needs to do a web search and that it
> kicks that off more often than it currently does. Either way, I do want to distinguish between
> what is in the article versus what's in the pre-training versus what's in the web search. But I
> don't want to restrict it into black and white away to what's in the article.
>
> — Greg, 2026-10-18 (`spya-h5mteu`)

A related report, `spya-w99qsz` (Marginalia enriched with sources and explanations, `qi-djrqnhdm`),
is dispatched after this one. § What is left for w99qsz says what it can build on.

## What is there now

A sweep of every prompt (2026-10-18) found three postures:

1. **Representations of the piece**, closed by design: Summary, Tweets, Illustrated, Relations,
   Glossary's `senseHere`, FAQ, the Quiz questions. Their output says *what the piece says*. Putting
   the world into a summary would be outside knowledge filed under the article's label, which is the
   regression [prompting-guide.md § Measuring](../project/prompting-guide.md#measuring-a-prompt-change)
   names. Glossary already has a separate field for the model's own knowledge (`background`), and
   Ideas has `provenance: "assumed"`.
2. **Already open to the world, with labels**: Explore (`THE WIDER WORLD`, `CLAIM_ORIGINS`), Explain
   (`SAY WHERE IT CAME FROM`, searches by default), Debate, Reception, the citation lookups.
3. **Conversations that answer or mark the reader, and stay in the article unless pushed.** This is
   the posture Greg is reporting on:
   - **Recall** (`LEARN_SYSTEM`, src/converse.ts): *"Do NOT search, unprompted, to check the article
     against the world. This mode is about whether they have read THIS PIECE correctly, not about
     whether the piece is right."* It also rules out raising *"a fact from outside the article"*.
   - **Tutorial** (`TUTORIAL_SYSTEM`): *"Stay in the article … Reach outside it only when they bring
     in something from elsewhere … or ask you to."*
   - **Quiz marking** (`QUIZ_MARK_SYSTEM`, src/quiz-mark.ts): the article is the only authority, and
     the call has no web search.
   - **Chat** (`SYSTEM`): searches readily when the *question* is about the world, but nothing tells
     it to speak up, unasked, when it knows the piece is wrong or disputed.

There is a concrete case in the committed eval article (Seth, *The Mythology of Conscious AI*).
Block `spya-zg9me8` dates the Antikythera mechanism to *"around 2,000 BCE"*. The usual dating is
the 2nd or 1st century BCE, about 2,000 years ago. Under today's prompts, a reader who recalls that
date in Recall or Quiz is told they have it right, and nothing more.

## The change

**One shared section, `widerWorld(…)` in a new `src/wider-world.ts`, interpolated into the four
prompts in posture 3.** It is shared for the same reason `plainWords` is: one rule, written once,
so the four cannot drift, and the next prompt that wants it imports it. What it says:

1. **The piece is not the last word.** When you know that a claim the reader is dealing with *right
   now* is disputed, out of date, oversimplified or wrong, say so, briefly, even if they did not ask.
   Only for a claim that bears on what they are taking from the piece. Not a tangent, not pedantry,
   and not on most turns. Most turns have nothing to add, and that is normal.
2. **Keep the three sources apart, in the sentence itself.** What the article says carries its
   block id. Your own background knowledge is said to be yours and not the article's ("Outside this
   piece, …"). What a search found is linked. Never put outside knowledge in a sentence that carries
   a block id. Where a prompt already has `CLAIM_ORIGINS` (Chat), the section points at it instead
   of restating it.
3. **Say how sure you are.** Settled consensus, a live debate, or your own memory. A specific
   checkable fact (a date, a number, what a study found) that rests on memory alone is said to be
   from memory and unchecked. Where the prompt can search, *search before you tell them the piece
   is wrong, unless you are sure*. Where it cannot (Quiz marking), say Chat can check it.
4. **The world disagreeing with the piece is not the reader being wrong.** Outside knowledge is
   never used to correct the reader's account of the piece. A reader who repeated what the piece
   says has read it right, and the reply says so before it says anything else. The outside note
   comes after the mode's own job, as a separate sentence. This keeps the entitlement rules of
   Recall and Quiz intact. Those rules are the ones learn-mode.md says to leave alone.
5. **It fits inside the mode's length.** No extra room. In Recall it does not count as the turn's
   one correction, and it never becomes a question.

**Per prompt:**

- **Recall**: replace the *"Do NOT search, unprompted"* paragraph with the section (can search).
  Drop *"a fact from outside the article"* from NOT worth raising *as a correction*. It stays not a
  correction, and becomes an outside note instead.
- **Tutorial**: the section (can search), after YOUR TOOLS.
- **Quiz marking**: the section (cannot search). In Quiz the reader is told what the piece says. The
  section adds one sentence when the piece itself is wrong or disputed on the point the question
  asks about.
- **Chat**: the section, pointing at `CLAIM_ORIGINS`. Its only new content for Chat is rule 1,
  speaking up unasked, since rules 2 and 3 are already in `CLAIM_ORIGINS`.
- **Not Explore**: it already has its own, stronger version.

**Labels are words, not a badge.** That is the existing house scheme for prose answers
(`CLAIM_ORIGINS`, Explain) and needs no UI or schema. A typographic mark for "outside the article"
in the answer is queued separately (below).

## The simpler option passed over

**Edit each prompt's own wording, with no shared section.** That would be fewer files. But it is
four copies of a rule that has to say exactly the same thing about labels and about not correcting
the reader. The w99qsz work would make a fifth copy. `plainWords` is the precedent for sharing one.

**A UI badge or a structured `origin` field per sentence.** That would mean a schema for streamed
prose, a parser, and rendering in two panels. In-sentence labels already work in Chat and Explore,
so the badge waits until the words have been seen in use.

## Measuring it

Following [prompting-guide.md § Measuring](../project/prompting-guide.md#measuring-a-prompt-change):
a new `evals/wider-world.ts` calls production's own `converse` (kinds `chat`, `learn`, `tutorial`)
and `markAnswerStream`. It runs on the committed Seth article, with our tools off as in
`evals/learn-recall.ts`.

Cases, about eight, each a way this could go wrong:

- **wrong** (Antikythera, `spya-zg9me8`). The reader repeats the piece's date, in Recall and in Quiz,
  and in Chat a reader asks "how old is it?". Want: the reader is confirmed on what the piece says,
  then one labelled outside sentence. It must not say they misread.
- **disputed** (the neural-replacement argument "fails at its first hurdle", `spya-ahtr6e`). Want: a
  labelled note that this is contested, at most.
- **already situated** (biological naturalism, which the piece itself says *"remains a minority
  view"*, `spya-qu7j89`). Want: point at the piece. An outside note restating it is a fault.
- **plain** (McCulloch and Pitts, Nagel's "what it is like"). Want: no outside note at all. This
  catches tangents.
- **reader wrong about the piece**. Want: the article-based correction, unchanged. Outside knowledge
  must not be used to soften it or replace it.

Arms: `before` twice (the control) on the commit before the change, and `after` once. Each arm is
kept in its own file. Cheap screens: the count of replies with an outside marker, block ids inside
the marked sentences, and the grade-word count for Quiz. Then a blind judge in a fresh subagent,
on shuffled pairs with the key balanced, answers three questions: does either reply tell the
reader something true about the wider world that they would want to know; does either blur what
is the article's with what is not; does either use the outside view against the reader. Fewer
than ten dollars.

## Stages

1. **This plan**, with GPT Sol reviewing it read-only.
2. **The eval and the `before` arms**, run on the commit before any prompt change.
3. **The section, the four prompts and the pinning tests** (`tests/quiz.test.ts` style: the rule
   is pinned by name in each prompt). Then the `after` arm and the judge. Then the docs:
   prompting-guide.md gets a line on `widerWorld`, and learn-mode.md, quiz.md and chat-tools.md get
   a line each where they state the rule. Then a Sol code review that may fix what it finds.
4. **Bookkeeping**: the note, `feedback-endings.ts`, the queue entries, then push to `dev`.

## Deferred, each with its own queue entry

- **Live conversation** (`GPT_LIVE_BACKEND_SYSTEM`, spoken). It is the same posture, but spoken.
  The labels need wording for the ear and an eval of their own.
- **Explain** (a selection explained). It should flag a selected claim the piece gets wrong. Its
  output carries no block ids, so it needs its own wording and an eval.
- **A visible mark for outside-the-article sentences** in Chat, Learn and Quiz answers, if the
  words alone turn out not to be enough.
- **The closed-book modes** (FAQ, Summary, Glossary, Ideas, Relations). They stay closed: their
  output is the piece. If the world belongs beside them, it belongs as a separate, labelled note
  next to the piece, not inside the summary. That is w99qsz's ground, so it is named there and not
  queued twice.

## What is left for w99qsz

`widerWorld()` is exported from its own file and takes `{ search: "can" | "cannot", origins?:
"claim-origins", placement: string }`. `placement` is that prompt's own sentence saying where the
note goes. marginalia.md points to it. A marginalia prompt that adds sources and explanations can interpolate it and
get the same three labels and the same "never against the reader" rule. In-sentence labels are the
scheme it should match until a visible mark exists.

## Revised after GPT Sol's plan review (round 1, REVISE)

The review is [261018h-…-plan-review-sol.md](261018h-modes-say-what-the-wider-world-thinks-labelled-plan-review-sol.md).
Its findings, and what each one changed. **This section overrides the one above where they differ.**

- **F1 (P1), accepted: ordering is per prompt, not shared.** Recall must end on its nudge and
  hint, Tutorial on its task, and Quiz must never open with a judgement of the reader. So a shared
  "after the mode's job" rule can't be obeyed. And "say they read it right" is itself a verdict on
  the reader. What is shared now: the trigger, the three labels, how sure you are, the privacy rule
  for search, and "never against the reader". Each prompt passes a `placement` sentence:
  - Recall: what the article says, then the outside note, then the nudge, then the hint.
  - Tutorial: the teaching, then the outside note, then the task, last.
  - Quiz: the article's claim first, then the outside note. No verdict.
  - Chat: the answer, then the note.

  Recall's ranked entitlement section gets its own bullet as well: outside knowledge never changes
  whether the reader got the piece right.
- **F2 (P1), accepted: a narrower trigger.** Raise something unasked only when (1) a concrete,
  checkable fact in the piece is wrong or out of date, or (2) a settled consensus, or a substantial
  live dispute, would change whether the reader should believe or carry away a *central* claim.
  Excluded: a view merely having opponents, nuance, background, and searching to find out whether
  an objection exists. A search may *check* a discrepancy you already suspect, and may never hunt
  for one. The neural-replacement case moves from "want a note" to "a note is optional".
- **F3 (P1), accepted.** The existing Recall, Tutorial and Quiz-marking evals run before and after,
  so the modes' own contracts are checked: one question, the question last, the hint's shape,
  length. The new eval reuses `checkReply` on Recall replies and screens Tutorial's length and
  question count. Chat's positive case is now an article-internal question ("What does Seth use the
  Antikythera mechanism to show?"), so that speaking up unasked is what gets measured. The judge
  gets a fourth question: did either reply damage the mode's own job, its brevity or its shape?
- **F4 (P1), accepted.** Every variant that can search carries Explore's rule: never put the
  reader's words, notes or profile in a query, and search for the article's claim in neutral words.
  No adversarial eval case for it. With our tools off, the eval cannot see the provider's queries,
  so the rule is pinned by a test instead.
- **F5 (P2), accepted.** The comparisons are `before1` vs `before2` (the control) and `before1` vs
  `after`. Every arm records HEAD, a dirty-`src/` flag and source hashes. `blindCoin` shuffles, and
  each key's balance is checked before judging. The judge gets an arm-neutral sheet of facts for
  each case: the Antikythera dating, the state of the neural-replacement debate, and what the piece
  says itself.
- **F6 (P2), accepted.** The scheme is three labels: a block-id chip, a linked claim under the
  existing "From the web" heading (ChatPanel), and a "from memory, unchecked" sentence. Quiz renders
  no links (QuizPanel), which suits a Quiz that cannot search. Nothing renders differently, because
  the change is only to prompt text, so the browser check is one look at a Recall reply that
  carries an outside note.
- **F7 (P2): Explain is deferred, with its own queue entry.** Its output forbids block ids, so it
  needs a local rule and an eval of its own. Glossary stays out, since its `senseHere` and
  `background` are already separate labelled fields. Live stays deferred.
- **F8 (P2), accepted.** Quiz says only that the outside point is from memory and unchecked. The
  existing *Discuss this in chat* button is the route to checking it.
- **Checked details, accepted.** The new eval gets a line in `evals/README.md` and an
  investigation write-up of its results. Tests pin the right variant in each prompt, and its
  position relative to the nudge, the task, `CLAIM_ORIGINS` and Quiz's article-first rule.
  `tests/web-reach-every-kind.test.ts` currently pins *"Do NOT search, unprompted"*. That decision
  is reversed here on Greg's word, and the test now pins the narrower rule that replaces it.

## Progress

- 2026-10-18: plan written. Sol plan review round 1: REVISE, all eight findings taken (above). The
  `before` arms were restarted after the review changed the cases.
- 2026-10-18, stage 2: committed in 578e00716 (the eval, plus before-runs of the Recall, Tutorial
  and Quiz evals).
- 2026-10-18, stage 3: the section and the four prompts landed in 3a4fbb7ec, followed by three
  wording rounds driven by the eval (80943a93c, 438aa1548, 52fbdee6f). The results are in
  [261018c](../investigations/261018c-modes-say-when-the-piece-is-wrong.md). The wrong date is
  now flagged on all four surfaces, not just Chat's one. No outside note appeared where none was
  wanted, and none was used against the reader. Mode shape cost 4–1 against a 2–1 control.
- Queued: `qi-6rmzd7xs` (Live), `qi-5ehbcza5` (Explain) and `qi-jfwgfa29` (a visible mark).
