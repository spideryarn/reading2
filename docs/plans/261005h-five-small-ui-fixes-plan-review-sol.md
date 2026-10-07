Reviewed against **`a9f32ee76`**. Concurrent edits appeared during the review, so I used the base versions for subsequent checks. I changed no files and did not run browser checks.

**A — Diagnosis right; build as proposed.** Both reader-facing strings say “half a minute”: [SearchPanel.tsx:912](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/SearchPanel.tsx:912) and [help-modes.tsx:261](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/help/help-modes.tsx:261). “Usually about ten seconds” is a reasonable rounded estimate from the recorded sample, although that sample measures successful provider calls and includes chat’s meaning searches.

Copy replacement is the simplest change and has no functional breakage risk. Include the comparison table at `docs/project/search.md:120`, which still says **15–40 seconds**, in the planned documentation sweep. The proposed test can go red against the base; assert the new wording in both places as well as rejecting the old wording, so deleting the estimate cannot pass.

**B — Diagnosis plausible; the proposed remedy needs narrowing.**

**F1 — P2 — B — Established:** The `(i)` cannot wrap with the bin. It is absolutely positioned outside the header’s flex flow: [mode-band.css:1220](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/styles/mode-band.css:1220), with space reserved through header padding at line 1250. The chip group deliberately wraps and shrinks: [quiz.css:32](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/styles/quiz.css:32).

**Instead:** Measure the available header width, then try reduced horizontal chip padding or a Remember-specific header arrangement. Moving the `(i)` into flow would be a larger change to shared corner machinery; changing every `.band-head` would affect other modes.

The browser measurement can genuinely go red. Also assert visibility, containment and no overlap: equal chip tops alone can pass while chips are clipped. Exercise all Remember subviews, a settled conversation with its bin, coarse-pointer sizing, and the profile badge where present. Window width alone does not establish the available band width.

**C — Shift diagnosis right; reservation is sensible, but the stated rule is incomplete.**

**F2 — P1 — C — Established state mismatch; resulting shifts are reasoned:** `terms.loading` means **no first answer yet**, not that topics work remains outstanding. Polling continues after answers with `pending > 0` or `refreshing`, while `loading` becomes false: [useShelfTerms.ts:151](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/useShelfTerms.ts:151) and line 185. The proposed rule therefore removes the reservation after an empty partial answer, then reinstates it when topics arrive.

Nor does the client know the distinct-work count before the answer. Existing code explicitly documents that article count is only an upper bound: [ShelfTerms.tsx:131](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/ShelfTerms.tsx:131).

**Instead:** Define “might have topics,” using loaded article count before the answer, and retain the reservation through unsettled empty answers. Collapse it on a settled empty answer or failure. Add an initial wait → empty pending/refreshing answer → populated answer regression. Use an eligible shelf fixture; the existing row-topics fixture has only four works.

A permanently blank slot on a topicless card is an explicit density tradeoff, not inherently a bug. Keeping it while the shelf has topics is simpler than guessing each article’s eventual membership.

**F3 — P2 — C — Established:** The proposed DOM test can fail for a missing element but cannot prove that element reserves height. An empty `<ul>` can exist with zero height. Cards and tables also have different forms: [ShelfRowTopics.tsx:60](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/ShelfRowTopics.tsx:60) uses bordered flex pills for cards and running text for tables.

**Instead:** Reserve each form’s actual single-line height, including its existing spacing. The table should reserve its own text line, not the card’s pill height. Add delayed-response browser measurements of card height and following-row positions before and after arrival. Removing the minimum height should make that check fail. Keep the existing context/slot wiring so admin/design imports and memoised table columns remain unaffected.

**D — Missing-note diagnosis right; renderer changes are unneeded, but placement needs a stronger check.**

A rejected dating has no `at`: [types.ts:4277](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/types.ts:4277). Its occurrences still provide candidate blocks and quotes. The renderer already uses `datingWords` and chooses the author’s voice from its tone: [MarginaliaColumn.tsx:323](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/marginalia/MarginaliaColumn.tsx:323).

**F4 — P1 — D — Reasoned counterexample, grounded in direct code:** Checking that the phrase and quote separately exist anywhere in a block can select the wrong occurrence. The proposed branch copies that check from [notes.ts:330](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/marginalia/notes.ts:330), whereas server-side phrase location requires the phrase to lie **inside the occurrence’s quote**: [timeline.ts:501](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/timeline.ts:501).

For example, an earlier block contains “On July 7, another company launched” and the quoted occurrence “Acme discussed its launch.” A later occurrence actually says “On July 7, Acme launched.” The proposed check incorrectly chooses the earlier block.

**Instead:** Locate the surviving quote using its stored start, then require the phrase within that quote’s span before choosing the earliest occurrence. Add this two-block regression. The positive yearless-note test goes red against the base; the rejection and missing-phrase tests already pass and are controls. Also retain the null-phrase control.

**E — Diagnosis right; proposed change is the simplest fix.** Separators precede subsequent facts inside flex items at [ShelfEntry.tsx:274](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-five-small-ui-fixes/src/web/ShelfEntry.tsx:274). Moving them after preceding facts preserves the unwrapped spacing with the proposed margin change.

The badges and tags already follow the last fact without a separator, so that boundary does not change. The structural test genuinely goes red against the base. Include a narrow-browser check with a long byline, since facts can also wrap internally. No additional finding here.

**Verdict: build with changes.**