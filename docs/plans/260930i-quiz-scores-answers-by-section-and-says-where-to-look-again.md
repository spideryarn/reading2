# Quiz scores answers by section, and says where to look again

**Status:** built · 2026-09-30 · from [SPIDERYARN-READING2-6R](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6R),
an admin report (Greg's own account, checked with `scripts/feedback-reporter.ts`).

## After GPT Sol's plan review — read this first

[The review](260930i-quiz-scores-answers-by-section-and-says-where-to-look-again-review-sol.md) found
no P0 and seven things, all taken. **Where the design below and this list disagree, this list is
what was built.**

1. **Sections are the reading view's Sections, not the root's children.** `sectionNodesOf(...)[0]`
   is a *Part* (depth 1, often nine across a piece), and in a flat tree it is a paragraph leaf with no
   title. Built on `buildSections` (src/web/position.ts) — the level one above the leaves, notes
   collapsed — and `sectionIndexContaining`, so the names match the spine. A section with no title
   is skipped. Evidence is body-only (`isBodyEvidence`), so the notes never arise.
2. **"Its questions" goes through `pick`, not raw `move`,** and only offers a question the reading
   filter lets the reader land on; no button when there is none, or when it is the one open.
3. **The prop chain includes `QuizSubBand`.**
4. **The "More questions once you have read" line is dropped from v1** — a fourth feature, awkward
   when the filter leaves no question on screen, and a new purpose for reading-time data. Deferred.
5. **"Never rendered, logged or stored" stays, reworded**: the verdict word is never rendered; it may
   select scaffolding and navigation. No exception documented.
6. The banned-words test reads the whole page, so a real section title with "hard" in it would trip
   it; fixture titles avoid those words, and the new block's own chrome carries none.
7. **Weakest is a share, not a count**: the largest share of judged answers wrong, then most wrong,
   then article order.

## GPT Sol's code review

[The review](260930i-quiz-scores-answers-by-section-and-says-where-to-look-again-code-review-sol.md):
no P0 or P1; three P2s, which it fixed — a block before the first section was clamped into it,
supplements were not refused at the join (`Section.supplement` is new, set by `buildSections`), and
the tests did not earn the batch-reset and prop-chain claims (the `sections` prop is now required
down the chain). **One of its fixes was moved, not kept as written**: it changed
`sectionIndexContaining` to return null above the first section, but `?at=` and the return chip
call that too and want the clamp, so the check lives in `sectionsOfQuestion` instead. Its regression
test was confirmed to go red without the check.

## What Greg asked for

> (A follow-up idea about how to improve the quiz. This might be overcomplicating it, but if there's a
> way to do a v1 of this simply, that would be great. Some version of it anyway.)
>
> Score each quiz answer against the article's blocks, giving a rough per-section picture of what the
> reader has got. That could steer your adaptive quiz (spya-jc2ub9) towards the sections they're
> weakest on, not just adjust its difficulty. And somehow indicate to the reader which sections to
> (re-)read next.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-6R)

"spya-jc2ub9" is the adaptive quiz of 5W —
[260930c](260930c-quiz-questions-that-build-up-to-the-takeaways.md) — and this builds on 61's
reading filter, [260930e](260930e-quiz-only-asks-about-what-you-have-read.md).

## What already exists, and is enough

Every piece of data this needs is already in the browser, per visit:

- **Each answer is already judged against the article.** Since 5W a small classifier reads each
  finished mark and returns `right` or `wrong` (`src/quiz-verdict.ts`); `QuizPanel` keeps the latest
  verdict per question in React state (`verdicts`). The mark itself is written against the
  article's blocks, with citations.
- **Each question already names its blocks.** One to three `QuizEvidence`, each a checked block id.
- **Each block already has a section.** `sectionNodesOf` (`src/section-path.ts`, pure, already
  allowed in client code) walks the hierarchy tree from a block id to its ancestors; the first is
  the top-level section.
- **What the reader has read** is `ReadSoFar` from 61.

So "score each answer against the article's blocks" is a join, not a new model call: question →
evidence blocks → top-level sections, counted with the verdicts the panel already holds.

## Design (v1)

### The per-section picture — `src/web/quiz-sections.ts`, pure

```
sectionTally(questions, verdicts, tree, index) → SectionTally[]
  one row per top-level section any question's evidence lands in, in article order:
  { node, questionIds (path order), right, wrong }
```

- A question counts toward **every distinct top-level section** its evidence lands in (usually one).
- **The top-level section** is `sectionNodesOf(block)[0]`: the depth-1 ancestor, or the leaf itself
  in a flat tree. A block the tree does not cover, and a `treatment: "supplement"` node, count
  nowhere.
- The verdict is the latest this visit — the map the premise rule already reads. **No verdict counts
  as neither**: unanswered, skipped, a failed mark or a failed classifier are not evidence, so they
  cannot put a section on the list.

`weakSections(tally)` → sections with at least one `wrong`, most `wrong` first, then fewest `right`,
then article order; at most three. That is the "weakest" Greg asked to steer by.

### What the reader sees: "Where to look again"

Below the step row, once at least one answer this visit has been judged wrong:

```
Where to look again
  How minds model bodies        [↗ passage]  [↻ its questions]
  The hard problem              [↗ passage]  [↻ its questions]
```

- **The section's name jumps the prose to its first block** (`onJump(node.range[0])`) — the
  (re-)read half. Same as every citation chip in the band.
- **"Its questions" (an icon, `RotateCcw`, words in the tooltip) goes back to the first question in
  that section whose latest verdict is `wrong`**, in path order — the steer. It is a jump, so the step
  shows its premise, exactly as a pick from the list does (`showPremise` does not change). Answer it
  right and the verdict flips; the section leaves the list when none of its answers is still wrong.
- **With 61's filter on and questions hidden**, a second line names the sections those questions are
  in: *"More questions once you have read:"* and the section names, each jumping the prose. That is
  the "read next" half — the reading-time data already says which they are.

**No counts, no score, no fraction, no "you got".** It names places, like a mark's "where to look",
and says nothing about the reader. The words `easy`, `medium`, `hard`, `harder`, `easier`,
`difficulty` and `level` still never reach the page, and the test that asserts that covers the new
block.

### The one rule this changes, named

quiz.md and `QuizPanel` say the verdict is **"never rendered, logged or stored"**, because it is the
grade the marking prompt refuses to give. This block **renders something derived from it**: a section
appears because an answer in it was judged wrong, and "its questions" lands on that answer's question.
That is exactly what Greg asked for ("indicate to the reader which sections to (re-)read next"), and
it is softened rather than dodged: aggregated to a section, phrased as a place, never a count, and
only ever reached after the reader's own mark already said what was missing. Still **never logged
and never stored**. The docs and the comments are changed to say "not rendered except as the
sections list, which names places and never counts".

### Steering: why not reorder Next

The path is the model's order and **nothing sorts it** (quiz.md § A path) — step 6 leans on step 5.
So v1 steers by offering the way back to a weak section's questions, not by moving Next. Next still
walks the path.

## Privacy

Nothing new is stored or sent: the tally is computed in the browser from the verdicts and levels the
panel already holds, and dies with the visit. privacy.md's "quiz answers are not stored at all" and
its reading-time paragraph (the quiz reads the levels in the browser) both stay true, so **no change
to the privacy page**.

**If the deferred stored version is built**, it is a new field about a reader and needs a sentence.
Draft for Greg, then:

> If you answer quiz questions, we keep, per article, which of its sections your answers suggested
> revisiting, so the quiz can pick up where you left off. Only you see it, and it is deleted with the
> article or your account.

## Deferred

- **A stored per-section picture** across visits — needs stored attempts (quiz.md § What is
  deliberately not here), and the sentence above.
- **New questions aimed at the weak sections** — a per-reader batch, which wants the reader in the
  stamp; the same deferral as "the questions do not know what you said in Recall".
- **Reordering the walk** towards weak sections — contradicts the path; would need the model to say
  which steps can stand alone.
- **"More questions once you have read: …"** — naming the sections the reading filter is holding
  questions back in (Sol's F4).
- **Showing the picture on the spine** (a per-section mark beside reading time's) — a second surface
  for the same fact; wait to see whether the band's list is used.

## The simpler option passed over

**Only the re-read list, no "its questions" button.** Simpler by one button, but then nothing steers
the quiz at all, which is half of what Greg asked. The button reuses `move`, so it costs one function.

## Stages

1. `quiz-sections.ts` + unit tests (red first).
2. `QuizPanel` block, Reader → `RememberBand` → `QuizPanel` gets `tree` and the block index; panel
   tests; docs (quiz.md, the comment on `verdicts`).
3. GPT Sol code review, gates, a browser check, push.
