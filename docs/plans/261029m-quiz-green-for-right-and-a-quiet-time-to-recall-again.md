# Quiz: a green for answering, a deeper one for right, and a quiet "time to recall it again"

Greg's reply to question [q-cj0fv8](../user-feedback/questions/q-cj0fv8.md) (reply `spya-v2aehw`,
2026-10-29), about report `spya-fytjtf`. Queue item `qi-pc9ekn26`. Follows plan
[261029i](261029i-quiz-answered-in-the-margin-with-voice-and-a-quiet-green.md), whose option A
(green = answered) is on dev.

> Yeah, find a way to give positive feedback for them answering, and even more positive feedback if
> they got it right, and maybe some other indication if it's sort of stale or previous and you think
> that it's time that they reminded themselves. So if you want to build in a kind of basic version of
> the spacing effect somehow, that could be good. So use your judgment on the v1. Have a look at some
> screenshots to make sure that you can sort of evaluate it. This sounds exciting!
>
> — Greg, 2026-10-29 (`spya-v2aehw`)

## What this does, in one paragraph

A Quiz question has four looks instead of two. **Not answered**: as now. **Answered**: the tick and
the pale green of 261029i. **Answered, and the hidden check judged it right this visit**: a deeper
green and a ringed tick. **Answered more than three days ago**: the green drains to a faint wash and
the tick becomes a small "come back" clock; opening it, in the margin or the band, gives an **empty** box, with
one quiet line saying when you last answered and *Show my earlier answer* beside it, so the second
try is from memory. Nothing new is stored, nothing turns red, and there is no count or score.

```
 ┌ margin ──────────────────────────────────┐
 │ Quiz                                     │
 │ ? What does Seth call that view?      🎤 │   not answered
 │ ✓ Why does a faster computer …        🎤 │   answered          (pale green, as now)
 │ ⊙ What is the "beast machine"?        🎤 │   judged right      (deeper green, ringed tick; this visit only)
 │ ↺ Which experiment does he cite?      🎤 │   answered 5 days ago (faint wash, muted clock)
 │   ┌──────────────────────────────────┐   │
 │   │ A line is enough                 │   │   ← opened: empty, for recall
 │   └──────────────────────────────────┘   │
 │   You answered this 5 days ago.          │
 │   Try it from memory first.              │
 │   Show my earlier answer                 │
 └──────────────────────────────────────────┘
```

## Three constraints from q-cj0fv8, and what each does to the design

1. **Right/wrong is not stored, and the privacy record says so** (privacy.md and a source comment on
   the public page; the public page itself lists what is stored and does not list it — Sol's F9). So *right* can only be known for an
   answer marked **this visit**; after a reload it is plain answered green again. Making it persist
   means storing the verdict, which changes [privacy.md § Quiz answers](../project/privacy.md#quiz-answers)
   — not built; asked of Greg as [q-m9zkx3](../user-feedback/questions/q-m9zkx3.md).
2. **The hidden check can fail or decline.** That is why *answered* stays green on its own and
   *right* is only an extra step up: a failed check leaves the ordinary green, never a lesser look.
   There is no "wrong" look at all.
3. **Quiz has never graded you.** Greg has now asked for exactly this ("even more positive feedback
   if they got it right"), so the rule in quiz.md changes, narrowly: the verdict may be drawn as
   **a deeper green and a different tick**, never as visible words, a count, a score, a streak or
   red. A screen reader hears it qualified, "the check thought it looked right" (Sol's F6). The
   mark's own text is untouched (QUIZ_MARK_SYSTEM is not edited).

## The spacing rule, v1

**Due once the last answer is 72 hours old** (`RECALL_AFTER_DAYS = 3`, one constant in
[`src/web/quiz-recall.ts`](../../src/web/quiz-recall.ts)). Answering again resets it. Why this and
not more:

- It needs only what is stored: every kept answer already carries `answeredAt`, the row's time. No
  schema change, no new read, no scheduler (there is none — cron-scheduler.md): it is computed when
  the line renders.
- **Fixed, not expanding.** An expanding schedule needs the history (how many times, and how well);
  the read returns only the latest row per question, and "how well" is the verdict we do not store.
  The literature does not insist on expanding: equal spacing did as well or better than expanding for
  long-term retention in Karpicke & Roediger (2007). The gain is in coming back after a delay at all.
- **Three days is a product heuristic**, not a number the research picks (Sol's F10): retrieval beat
  re-reading at a two-day and a one-week final test in the studies our note cites
  ([01-retrieval-practice.md](../research/261010a-reading-and-learning-evidence/01-retrieval-practice.md)),
  which says a delay matters, not which. Three is short enough that a reader working through an
  article over a week meets it. What would change it: Greg finding it comes back too soon or too
  late in his own reading.
- **The box opens empty because that is the point.** Restoring the old answer turns a recall into a
  re-read. The earlier answer and its mark are one press away.

## Stages

### Stage 1 — the verdict joins the kept answer, in memory

- `KeptAnswer.verdict?: QuizVerdict` — set only by `noteMark`, from the `done` frame's verdict;
  never from the server, which has none. `noteMark`'s mark gains `verdict?`. The merge already takes
  this visit's answer over the server's on a tie, so the verdict survives a revalidation read.
- Both surfaces read it from `kept`: one source, so an answer marked in the band shows right in the
  margin and the other way round (261029i's F1, which said a shared verdict map is the right change
  "if green ever means right").
- `QuizPanel`'s own `verdicts` state (which picks premises and *Where to look again*) is **derived
  from `kept`** and its recording effect deleted (Sol's F1): two records would disagree after a margin
  answer, turning the margin a deeper green while the band showed the next premise as if unjudged.
  `kept` already has every property the old map was built for: the latest mark wins, no verdict
  deletes, a restored answer changes nothing, a new batch is a new `kept`.

### Stage 2 — the four looks, and the empty box for a due question

- `quiz-recall.ts`: `quizLook(kept, now) → "none" | "answered" | "right" | "due"` and
  `daysSince(answeredAt, now)`, pure, tested. Precedence: due over right over answered (a due
  answer is days old, so it cannot carry this visit's verdict anyway).
- quiz.css: `.quiz-answered` as now; `.quiz-right` deeper ground (`--positive` at ~24%) and the
  tick in `--positive`; `.quiz-due` a faint wash (~5%) and the clock in muted ink. Same classes on
  the margin's line and the band's question (controls.md § same job, same look). Reduced motion: no
  transitions, as now.
- Icons: `Check` (answered), `CircleCheck` (right), `History` (due), all lucide.
- Screen readers: the sr-only "(answered)" becomes "(answered)", "(answered, and it looks right)",
  "(answered 5 days ago: worth trying again from memory)".
- **Margin box for a due question**: `show` does not put the kept answer back, and the late-restore
  effect does not either; under the box, *You answered this N days ago. Try it from memory first.*
  and a *Show my earlier answer* button that does what `show` does for an answered question
  (restore and `showKept`). Once the reader answers again it is no longer due.
- **Band: the same behaviour** (Sol's F5 — the first draft had the band show the look only, which
  would let a reader resubmit the restored old words and reset the clock without recalling
  anything, and let the walk skip due questions). Its restore effect leaves a due answer out, the
  same `RecallLine` sits under its box, and "open at the first unanswered" counts due as unanswered.
- ***Show my earlier answer* never overwrites a draft** (Sol's F3): into an empty box as any kept
  answer goes back; beside a draft, with the mark and *Your earlier answer: …*, otherwise.
- ***Right* steps down to answered under other words** (Sol's F4, `quizLookFor`): with the band and
  the margin both open, the one that did not mark can hold a different draft.

### Stage 3 — screenshots, docs, bookkeeping

- Browser check (Sonnet subagent, Playwright on the box) on the local database. **No live model
  calls** — the OpenRouter key on the dev box is over its limit until 2026-11-01. So: *due* is seen by
  back-dating a local `quiz_attempts.created_at`; *answered* by a kept row; *right* through the jsdom
  tests and, for the screenshot, a stubbed mark stream (a Playwright route returning a `done` frame
  with `verdict: "right"`). Light and dark, the margin narrow and comfortable.
- quiz.md (§ Answered in the margin, § Whether the reader got it right — the rule's new edge),
  marginalia.md's Quiz line, learning-vision.md's "Spacing across days" (a v1 now exists).
- q-cj0fv8 answered; the report's note; a new question for Greg on storing the verdict; queue item
  done.

## The question this raises for Greg ([q-m9zkx3](../user-feedback/questions/q-m9zkx3.md), not built)

**Should we store whether an answer was judged right?** It would let the deeper green survive a
reload, and let spacing adapt: a question you got wrong comes back sooner (a day), one you got right
later (a week, then longer). Cost: a column, and the privacy page's promise that right/wrong is not
kept is reversed. Gives up: a stored machine judgement about the reader, which the privacy page and
learn-mode.md have deliberately avoided; and the check is sometimes wrong (it once called an
unanswerable question right). Recommendation: not yet — live with v1 for a week first.

## The plan review

GPT Sol, read-only, [261029m-plan-review-sol.md](261029m-plan-review-sol.md).
Ten findings:

| # | Finding | What we did |
|---|---|---|
| F1 | Two verdict records disagree after a margin answer | Band's verdicts derived from `kept`; effect deleted |
| F2 | Rendering the classifier undoes why it could be cheap and fallible; hold *right* until an eval | **Not done.** Greg asked for "even more positive feedback if they got it right" in so many words. A wrong *right* costs a deeper green on a question that deserved plain green; a missed one costs nothing (plain green). Qualified to screen readers, and named in q-m9zkx3. The 261029i eval measures the verdict's agreement with hand labels when the key resets on 2026-11-01. |
| F3 | *Show my earlier answer* overwrites a recall draft | Beside a draft, never over it; tested red first |
| F4 | *Right* shown over a different draft | `quizLookFor`; tested red first |
| F5 | Band restores the old answer, so due resets without recall; walk skips due | Band behaves as the margin; tested red first |
| F6 | "Never as words" vs the screen-reader text | Rule now "no visible words"; spoken text qualified |
| F7 | 72h contract, clock skew, refresh at the threshold | 72h as instants, future clamped, tested at −1ms and 0; **not done**: a server-clock offset (a clock three days wrong is rare and the cost is one early or late clock icon) and a timer at the threshold (the next render is soon enough for a three-day rule) |
| F8 | The mic test cannot prove the keeper binding | Dictation mock records the keeper box at `toggle`; `flushSync` removed turns it red |
| F9 | Privacy claim imprecise; privacy.md not in Stage 3 | Wording fixed; privacy.md updated |
| F10 | Research does not pick three days | Called a product heuristic, with what would change it |

## The code review

GPT Sol, fixing as it went, [261029m-code-review-sol.md](261029m-code-review-sol.md): eight
findings, seven fixed in the stage and read before commit. The ones that change behaviour: a due
answer that lands after a band/margin collision no longer fills the empty recall box; *Show my
earlier answer* is disabled (not silently inert) during dictation or marking, and hands the focus
back to the box; the band speaks the same answered/right/due suffix as the margin, and an edited
*right* answer steps down to answered green rather than losing it; the "earlier answer, from memory"
wording appears only for a due answer, and an ordinary restored mark keeps "previous answer"; the
"N days ago" is a `<time>` with the exact moment. It also moved two older suites' fixtures off fixed
October dates, which the three-day rule would otherwise have turned due as the calendar moved, and
gave the direct panel tests a `kept` that carries the verdict, as production's does. Not fixed:
Biome's cognitive-complexity advisories on the three large functions, which predate this and need
an extraction of their own.

## Browser check

A Sonnet subagent, Playwright on the box, local database, 2026-10-29. *Right* came from a stubbed
mark stream (`verdict: "right"`); *answered* and *due* from rows inserted into the local
`quiz_attempts`, one hour and five days old, removed afterwards. No console errors; the keyboard
reaches *Show my earlier answer* and Enter works with the draft kept. In light mode all four looks
are distinct. Two defects, both fixed: **in dark mode due was nearly indistinguishable from
unanswered** (the 5% wash vanished against the page; it now also keeps a faint green outline), and
the band's icon sat flush against the question's first word (now a gap). Left as they are: the
band's status line and its list say "answered" for a due question, which is true; the ringed tick is
close to the plain one at 14px, and the deeper green does the work. The margin could not be made
narrower than about 266px in that window, so the 200px floor was not seen.

## Simpler options passed over

- **Due by the calendar day ("answered before today")**: simpler still, but "yesterday" is too soon
  for the effect, and it would fire on the next morning's read of an article half-finished last night.
- **Due restores the old answer, with the look only**: less code, but the reader re-reads rather than
  recalls, which loses the effect the feature is for.
- **Right as a sound or animation burst**: louder than Greg's "subtle", and closer to gamification.

## Tests

- `tests/quiz-recall.test.ts`: `quizLook` for each state and the three-day edge; `daysSince`.
- `tests/marginalia-quiz-answer.test.tsx`: a mark with verdict `right` gives `quiz-right`, `wrong`
  and none give `quiz-answered`; the band shows the margin's right; a kept answer four days old is
  `quiz-due`, opens empty with the line, *Show my earlier answer* restores it with its mark; the
  microphone on a due question starts into an empty box; answering again leaves `due`. Each seen red
  by switching its mechanism off.
