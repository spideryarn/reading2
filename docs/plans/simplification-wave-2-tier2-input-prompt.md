# Tier 2: should we build 2.2, 2.3 and 2.6, and in what form?

You are reviewing a simplification plan mid-flight, in the repository you can read.
This is **not** a code review — nothing here is built yet. It is a design question.

Read [`docs/plans/simplification-wave-2.md`](simplification-wave-2.md), especially
`## Tier 2` and `## What not to do`. Tiers 0 and 1 are built, committed and already
reviewed by you (see `simplification-wave-2-review-sol.md` and
`simplification-wave-2-tier1-review-sol.md` — you were right about the `.env.local`
gate and it has been fixed).

Greg's instruction was: **do at least the safe ones from Tier 2, and get input from
GPT Sol about the others.** I classified them by the plan's own risk lines:

| | | |
|---|---|---|
| 2.1 `useStepJob` | risk **low** | building now |
| 2.4 `stamp` for tweets + summary | risk **low** | building now |
| 2.5 `stageCli` | risk **low with tests, high without** | building now, tests first |
| **2.2 `stage-call.ts`** | risk **medium** | **asking you** |
| **2.3 `roundClock` / `endOfStream`** | risk **real** | **asking you** |
| **2.6 `useArtefactRead`** | risk **medium**, "wants its own review before it is built" | **asking you** |

Answer for each of 2.2, 2.3 and 2.6: **build it, build a narrowed version (say which
part), or leave it** — and say what would have to be true for you to change that answer.

---

## 2.2 — `src/stage-call.ts`, the article-reading model call

The claim is that five stages hand-roll the same request/response handling, and that
the real prize is not line count but this: four copies of *"the article block goes
first, and carries `cache_control` only when asked"* is a `cache_read_input_tokens: 0`
waiting to happen.

Read: `src/article-prompt.ts` (its header is a postmortem about exactly that failure
being invisible), `src/models.ts` around `ARTICLE_RENDERER`, `tests/article-cache-group.test.ts`,
and the generate functions in `src/arc.ts`, `src/glossary.ts`, `src/ideas.ts`,
`src/summarise.ts`, `src/labels.ts`, `src/toc.ts`.

Questions:

1. **Is the duplication real and is it the shape the plan says?** Count it yourself.
   Rule 1 of this plan is *"grep the genre, not this list"*, and it has caught the
   plan's own numbers low four times, including mine.
2. **Is `ARTICLE_RENDERER` actually unenforced?** The plan asserts nothing checks that
   `ideas.ts` calls `articleWithIds` rather than the text renderer. If that is true,
   is a shared helper the right enforcement, or is a test against the existing code
   the cheaper 90%? A test costs nothing and cannot break the pipeline.
3. **`summarise.ts` is called out as able to use only the response half.** Does a
   helper that five callers each use a different subset of still pay for itself, or is
   that the shape that turns into a parameter-bag nobody can read?
4. **What is the smallest version worth building?** Is it `articleSystem(...)` alone —
   the part where the cache bug lives — leaving each stage its own call?

## 2.3 — `roundClock()` and `endOfStream()` in `src/openrouter-stream.ts`

These are the highest-stakes paths in the app: `src/explain.ts`, `src/converse.ts`,
`src/search.ts`. The plan says do **0.4 first** (three unexercised guards need tests),
and 0.4 is **not done**.

Read those three files' post-loop guards and two-clock setups, plus `src/ai-call.ts`
and `src/openrouter-stream.ts`.

Questions:

1. **Is 0.4 genuinely a precondition, or an excuse?** If we wrote `endOfStream` with
   its own tests, would that cover the same ground 0.4 would have, making 0.4
   redundant — or does 0.4 test something the extraction cannot?
2. **The plan says `endOfStream` is "the one worth doing"** (22 lines x 3, and where
   the bug actually happened) and that `roundClock` is subtler because `converse`
   splits its clocks on purpose. Do you agree with that split? Is `endOfStream`
   separable from `roundClock` without a helper that needs the other's state?
3. **`collectCitation()`** — `explain.ts` and `converse.ts` are said to be
   character-for-character identical and the largest single clone in the repo. Check
   that. If true, is it independently safe to extract *today*, ahead of everything
   else in 2.3?
4. A prior wave declined *"one parameterised `converseOrExplain()`"* because the three
   verbs make three different promises about the stop button. Does 2.3 stay on the
   right side of that line?

## 2.6 — `useArtefactRead`, the read half

This one **changes behaviour**: `useIdeas`, `useSummaries` and `Tweets.tsx` would gain
dedupe, trailing fetches and generation guards they have never had. `useGlossary` is
the only one that handles the same-slug race today (`useGlossary.ts` around
`generation`/`inFlight`/`trailing`).

Two findings from the earlier code review feed this and are **not** fixed:

- **The reload tests serialize away the same-slug race.** Every test settles the
  opening request before firing the job, so no test in the repo can see the bug.
- **`queue.error` is not durable** — shared polling state; a successful poll clears
  the failed POST's reason. Folded into 2.1.

Questions:

1. **Is the race real, and is it reachable by a reader** — not merely constructible?
   Name the sequence. "Reachability is not handling": whether code handles a state and
   whether a user can get there are two questions.
2. **If it is real, is 2.6 the fix, or is the fix three small guards in three hooks?**
   The extraction's other claim is that collapsing six `useState`s to one `data` makes
   `useSummaries`' 404 branch forgetting two fields structurally impossible. Is that
   worth the behaviour change on its own?
3. **How do you test a race whose existing tests serialize it away?** Give the shape
   of the test, and say what its control is — the thing that must go red against the
   current code. Note `docs/reusable/silent-success.md` and the repo's rule that a
   test which was never red proves nothing.
4. Should 2.6 wait until 2.1 has lived in the tree, as the plan says, or does doing
   them together avoid touching four hooks twice?

---

## Constraints you should hold me to

- **Rule 2 of the plan: put the shared piece where the invariant already lives.** Not
  a new module when an existing one owns the rule. `parse-json.ts` and
  `openrouter-stream.ts` were chosen that way; `stage-call.ts` would be a new module,
  which is worth challenging.
- **Every fix goes red first**, with the control checked against the broken state.
- The tree is shared with ~6 other agent sessions. `src/pipeline.ts`, `src/summarise.ts`,
  `src/arc.ts`, `src/toc.ts`, `src/glossary.ts`, `src/ideas.ts` and `src/web/Tweets.tsx`
  all have uncommitted peer work in them right now. If your answer depends on editing
  one of those, say so, because the sequencing matters.
- Say plainly when you think an item should simply be **left**. "What not to do" in
  that plan is a list I want to be longer, not shorter.

Do not edit any file. Answer in prose, per item, with the verdict first.
