## Recommendation

Ship **P1, with T3 as the natural Trajectory behaviour**: show compact question stems in the prose, grouped after each question’s final evidence block; pressing one opens the existing Quiz band at that question. Add nothing else to Trajectory yet.

This best matches Greg’s clearest instruction—questions should “always show … in situ”—while preserving one implementation of answering, marking, premises, dictation, and reference answers.

## Options

### P1 — prose marker linking to Quiz

**Value:** High. It prompts retrieval at the relevant moment without turning the article into a form, and the full Quiz remains available for a deliberate walk.

**Code:** Moderate, not tiny.

- Split a read-only `useQuizRead` from `useQuiz`, following `useFaqRead`; currently Quiz’s fetch and job controller mount only inside `QuizSubBand` ([ConversationModes.tsx:160](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/modes/conversation/ConversationModes.tsx:160)).
- Add a pure `quiz-anchors.ts`: map each question to the latest evidence block in document order. Evidence already has stable block ids ([types.ts:4197](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/types.ts:4197)).
- Do **not** overload `afterBlock`, which deliberately accepts one mode-owned element ([TableView.tsx:647](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/TableView.tsx:647)). Add a separate, memoised map of persistent prose tails.
- Add an in-memory `QuizArrival` handoff from `Reader` to `QuizPanel`. The current index is local state ([QuizPanel.tsx:224](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/QuizPanel.tsx:224)); keep it out of the URL, as explicitly decided ([params.ts:1206](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/params.ts:1206)). An external arrival behaves like a list jump, so its premise is shown.

**Policies:** If evidence spans sections, anchor after the last evidence passage: only then has the reader encountered the whole basis. Group questions sharing an anchor into one compact cluster, retaining quiz path order. Show stems only—never premises. Hide stale quizzes because their evidence may no longer describe the prose.

Do not apply “Only what I’ve read” to marker visibility: coupling reading-time updates into the tail map would repeatedly invalidate `memo(TableView)`, whose whole purpose is avoiding article-wide reconciliation during scrolling ([TableView.tsx:663](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/TableView.tsx:663)). A marker press should visibly turn that Quiz filter off if necessary; otherwise the requested question can be filtered away ([QuizPanel.tsx:289](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/QuizPanel.tsx:289)).

On touch, make the quiet line a full-width button with a proper tap target, not tiny linked text.

### P2 — inline answering and marking

**Value:** Potentially highest: no context switch.

**Cost/risk:** High. It requires extracting most of `QuizPanel`’s answer surface—dictation, draft binding, stale/batch handling, streamed mark, citations, reference answer, and retry—from [QuizPanel.tsx:746](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/QuizPanel.tsx:746). `useQuiz` supports one live attempt and aborts it on movement ([useQuiz.ts:344](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/useQuiz.ts:344)); inline boxes would need one shared controller and an explicit one-open-at-a-time rule.

If streamed text is passed through `TableView` props, every token defeats its shallow memo. Avoiding that requires a context or independently stateful child architecture. Narrow screens gain a usable prose-width box, but the software keyboard, long streamed feedback, focus restoration, and layout jumps become new work.

Highest risk of accidentally diverging from the hard rules: completed-only ticks, batch binding, no grading language, hidden verdicts, and premises never appearing alongside stems.

### P3 — section-end gates

**Value:** Medium for reflection, low for the existing Quiz path.

**Code:** Build top-level-section lookup from the hierarchy, group questions, and add multiple section tails. Cross-section questions still need an arbitrary policy—latest section is least misleading—and sections may receive several questions.

More importantly, this reorders a deliberately model-ordered path into document sections. Premise adaptation then becomes meaningless unless each gate merely links into Quiz. Large gates are easy to tap but visually heavy.

### T1 — questions on the current Trajectory card

**Value:** Medium. It makes the relationship explicit.

Add Quiz to the read-only card sources ([stop-card.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/stop-card.ts:54)) and gather questions whose evidence matches the **exact stop block**. Section matching is fuzzier and can flood every stop in a long section. Render stems only and use P1’s handoff to open Quiz. Inline answering inherits P2’s cost; opening a reference answer in place would spoil recall.

The band is already dense on narrow screens, and FAQ questions already occupy the above-row question position ([TrajectoryPanel.tsx:700](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/web/TrajectoryPanel.tsx:700)).

### T2 — questions as route steps

**Value:** Unclear; cost very high. Trajectory steps currently identify Quotes and therefore prose blocks ([types.ts:1224](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/src/types.ts:1224)). Question steps would require a union route model, new navigation/address semantics, depth allocation, a non-prose current step, and replacement rules for the prose door. It also braids two independently ordered paths together.

### T3 — no Trajectory-specific UI

After P1, this costs nothing: markers remain visible while Trajectory is active, including when the band steps aside on narrow windows. It does **not** guarantee a marker beside every stop, so it should be described as coexistence, not stop-level integration.

## Ranking by ease × value

1. **P1 + T3 — v1**
2. **T1 exact-block links**
3. **P3 section grouping**
4. **P2 inline marking**
5. **T2 interleaved route steps**

Deferred by name: **Trajectory quiz cards**, **inline marking**, **section gates**, **question route steps**, **read-aware marker visibility**, and **section-level Trajectory matching**.

## What the options misread

Greg’s remembered decorated gate was **not Quiz**. It asked one generic free-recall question per top-level section, nobody marked it, and revealing showed the section summary ([build.mjs:653](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/experiments/decorated/build.mjs:653), [build.mjs:791](/home/greg/code/spideryarn2/.claude/worktrees/fb-6v-quiz-in-situ/experiments/decorated/build.mjs:791)). P3 therefore recreates the visual memory, not the requested Quiz artefact.

His strongest decision is the later one: generated questions should always appear in the text. The Trajectory ideas are exploratory—“some or all,” “somehow,” “I’m not sure.” That argues for shipping the global prose affordance first and learning whether Trajectory needs anything more.