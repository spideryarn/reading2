Reviewed final snapshot `f172b9fd`; the worktree was clean at the final read. No files changed. The focused suite passed after the final merge: 3 files, 31 tests.

I found no P0, but I would fix four P1s before accepting the stage.

## Findings

**UL-01 · P1 · A cleared limit renders “Work can resume in — Unknown.”**  
[UsagePanel.tsx:650](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:650), [UsagePanel.tsx:885](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:885)

When `dueBackAt` has passed, `headline()` correctly says the limit has reset, but `DueBackCard` still renders and maps that same fact to `Unknown`. The answer is not unknown: as far as the attributed limit is concerned, work can resume now. Hide the card once `head.cleared`, or render `Now · reset 30m ago`. The current cleared-limit test does not inspect this card.

**UL-02 · P1 · Neither `cache.unknown → unavailable` nor `window.unknown → withheld` is valid for the whole union.**  
[UsagePanel.tsx:310](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:310), [UsagePanel.tsx:695](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:695), [UsagePanel.tsx:768](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:768)

The producer’s `window.kind === "unknown"` includes:

- a normal cache value lacking `resets_at`;
- a non-object entry;
- an invalid date;
- a missing/non-numeric utilisation;
- an out-of-range utilisation.

Those are a mixture of withheld/invalid and source failures, not one state. Likewise, `cache.kind === "unknown"` includes both “Claude has not cached a reading here” and malformed/unreadable cache data ([usage.ts:193](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/overseer/usage.ts:193), [usage.ts:255](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/overseer/usage.ts:255)).

The renderer cannot recover the correct state from these broad unions. Carry the absence classification from the producer; until then, `Unknown` is the only defensible common rendering.

The other assignments are right:

- cache `unattributed` → `Withheld`;
- `expired` → `Unknown`;
- a formerly-live value whose reset passed → `Unknown`;
- unreadable due-back instant → `Unavailable`.

**UL-03 · P1 · The disclosure predicate hides decision-relevant windows and deletes every reason when all windows are unknown.**  
[UsagePanel.tsx:672](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:672), [UsagePanel.tsx:677](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:677), [UsagePanel.tsx:754](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:754)

The rationale is sound for noisy ancillary codenames, but the code folds every `unknown`, including `five_hour` and `seven_day`. A missing five-hour reading can materially change confidence in the visible headroom and should not be treated like `member_dashboard_available`.

Worse, when every window is unknown, the aggregate card says “No window … carried a usable number,” but the disclosure is suppressed by `!every(...)`. Contrary to the adjacent comment, all window names and producer reasons disappear.

Keep stable/current-window absences on the face, fold only entries the data contract identifies as ancillary, and always retain the detailed reasons in the all-unknown case.

**UL-04 · P1 · Attributed cache values lost their actual freshness.**  
[UsagePanel.tsx:668](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:668), [wire.ts:2700](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/wire.ts:2700)

The old render showed `cache.fetchedAt` as age plus wall-clock time. The new attributed path never renders `fetchedAt`; it shows only `summary.collectedAt`. Those clocks are not interchangeable: a fresh usage pass can republish a cache fetched hours earlier while its reset is still ahead.

That makes a stale-but-valid cached percentage look freshly read, despite the design rule that each independently refreshed group carries its age. Put one visible `cached 6h ago` beside the whole headroom group; the exact instant can remain in the tooltip. `StatValue.stale` need not be repeated per tile.

**UL-05 · P1 · The invented card tones can contradict the producer’s verdict.**  
[UsagePanel.tsx:346](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:346), [usage.ts:931](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/overseer/usage.ts:931)

The producer’s default threshold is 80% used. The renderer independently assigns:

- 75% used → `needs`, while the verdict may still be `ok`;
- 90% used → `alarm`, while the producer says only `approaching`.

That is visibly a second severity interpretation. Drop the per-window thresholds and use a neutral value treatment until the producer carries a per-window status or threshold.

**UL-06 · P2 · Valid wire input can produce floating-point debris.**  
[UsagePanel.tsx:346](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:346), [types.ts:2175](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/types.ts:2175)

Both parsers correctly require a finite value in `[0, 100]`, so `left` cannot be negative, `NaN`, or above 100 through the real wire. It can be ugly: `99.99` becomes `0.010000000000005116% left`. Format the complement through an explicit percentage formatter.

**TEST-01 · P2 · The suite treats hidden text as visible evidence.**  
[fleet-usage-card.test.tsx:81](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:81), [fleet-usage-card.test.tsx:252](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:252), [fleet-usage-card.test.tsx:285](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:285)

`screen()` is `container.textContent`, so it includes closed `<details>` and `sr-only` tooltip prose. Consequently:

- the assertions claiming three-zone clocks are “on screen” now pass solely from hidden tooltip text;
- the disclosure assertions cannot prove the count is on the face;
- moving that count inside the closed disclosure would stay green.

The planned 390px visibility/closed-ancestor test is still needed.

The changed `li` count itself is better: scoping it to `usage-provenance` preserves the one-incident guarantee without coupling unrelated lists. The expired-state assertions are stronger than the deleted prefix assertion, and the passed-window assertions are also stronger. The weakened part is the visibility guarantee around the newly folded content.

**TEST-02 · P3 · The cache-disclosure assertions are duplicated verbatim.**  
[fleet-usage-card.test.tsx:252](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:252)

Lines 252–267 repeat the same three assertions and comment twice. It adds no coverage.

**TYPE-01 · P2 · The scale does not satisfy its own spacing claim.**  
[tailwind.css:227](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/tailwind.css:227), [tailwind.css:254](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/tailwind.css:254), [tailwind.css:276](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/tailwind.css:276)

The ratios are approximately 47%, 15%, 8%, and 9%, not “each at least ~25%.” More importantly, `lead` is 15px—the same as the actual root body size—while the token named `body` is 13px.

Yes, 15px versus 13px is too close to carry a hierarchy by size. The Usage verdict still works because position, weight, and colour help it, but the reusable scale is internally inconsistent.

If 15px is the real body size, I would use roughly `answer 24 / lead 19 / body 15 / note 12 / label 11`, explicitly documenting the small final label step as the low-end legibility exception. If preserving the existing 22px answer matters more, `22 / 18 / 15 / 12 / 11` is the pragmatic version, but the document should stop claiming every step is ~25%.

## What the rewrite lost

| Previous information | Current location |
|---|---|
| Reading’s exact three-zone instant | Tooltip |
| Checkpoint age and exact instant | Tooltip |
| Live window’s exact reset instant | Tooltip; duration remains visible |
| Incident rows, rejection/session counts, first/last hits | Closed provenance disclosure |
| Historical incident count and most-recent reset | Closed provenance disclosure |
| Mixed unknown cache-window names and reasons | Closed cache disclosure |
| Attributed cache fetch age and instant | Gone |
| Unattributed cache exact fetch instant | Gone; age remains |
| All-unknown window names and reasons | Gone entirely |

Account identity, producer reasons, reading age, scan result, and coverage remain visible. The expired percentage survives only inside the producer’s explanatory prose under `Unknown`; that is appropriately distinguishable from a live numeric value.

## Answers to the three judgement calls

- The cache disclosure is defensible for ancillary entries, and “carried no usable number” is a reasonable summary of the typed `unknown` projection. The current implementation is not defensible because it partitions by epistemic state rather than relevance and drops all details in the all-unknown case.
- `Cached headroom` is acceptable over a `Withheld` value: the heading names the question/metric, and the value answers that it cannot be shown. `Cached usage` would be marginally more literal, but I would not block on it.
- The type scale needs correction or a narrower claim. The current Usage screenshot has materially better hierarchy, but that success comes from weight, colour, grouping, and disclosure—not from a perceptible 15px/13px scale step.