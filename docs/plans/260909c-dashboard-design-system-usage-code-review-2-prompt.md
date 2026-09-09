# Review round two: the five P1 fixes, narrowly

**Discovery is closed.** This is a scoped check of the fixes for the findings you raised in round
one, not a fresh review. If you find something new and genuinely serious, say so — but do not go
looking, and do not re-litigate anything you already accepted.

## The candidate

`/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system`, revision **`20f8c504`**.
Your round-one review is `docs/plans/260909c-dashboard-design-system-usage-code-review-sol-r1.md`,
in the tree.

The fix diff:

```
git diff f172b9fd 20f8c504 -- tools/fleet/web/src/UsagePanel.tsx \
  tools/fleet/web/src/tailwind.css tests/fleet-usage-card.test.tsx
```

**Do not change any file.** Please run
`npx vitest run tests/fleet-usage-card.test.tsx tests/fleet-stat-card.test.tsx tests/fleet-tooltip-copy.test.ts`
yourself rather than taking my word for it.

## What I did with each finding

| Finding | Fix |
|---|---|
| **UL-01** cleared limit renders "Work can resume in — Unknown" | `DueBackCard` is not drawn when `head.cleared`. The cleared-limit test now asserts `not.toContain("Work can resume in")` |
| **UL-02** neither absence mapping is valid for the whole union | `window.unknown` → `Unknown`; `cache.unknown` → `Unknown`. `withheld` now survives only on `cache.unattributed`, and `unavailable` only on an unreadable due-back instant. Both are noted in the plan as wanting a producer-side classification, which I do not own |
| **UL-03** the disclosure hides decision-relevant windows and deletes everything when all are unknown | **The fold is withdrawn entirely.** Every window gets a card again, including the ancillary codenames. The comment says why, and that the way to earn it back is a wire change |
| **UL-04** attributed cache lost its freshness | One `cached {age}` line beside the whole headroom group, using `cache.fetchedAt`, with the exact instant in the tip. Not per tile |
| **UL-05** invented tones contradict the verdict | Thresholds dropped; a live value is always `work`. **New test**: a window at 95% used against a verdict of `ok`, asserting the value carries neither `alarm` nor `needs` ink |
| **UL-06** floating-point debris | `Number((100 - pct).toFixed(1))`. New test on `99.99` → `0% left`, and asserting `99.99% used` still appears |
| **TEST-02** duplicated assertions | Removed |
| **TYPE-01** the scale fails its own claim | `lead` 15px → **17px**. The token block is rewritten as **three levels (22/17/13) plus two density variants (12/11)**, and says the ratios are 29/31/8/9 rather than claiming ~25% throughout. `docs/reusable/design-a-screen.md` now separates "levels" from "density variants" as a rule |

**TEST-01 is accepted and NOT fixed.** `screen()` is still `textContent`, so it still counts closed
`<details>` and `sr-only` prose. The 390px visibility test you specified in the plan review remains
unbuilt and is recorded as outstanding. I did not want to half-build it.

## Mutation evidence, since a test that was never red proves nothing

Each applied, suite run, tree restored:

| Mutation | Result |
|---|---|
| Draw `DueBackCard` when cleared | **caught** (1) |
| Drop the `cached {age}` line | **caught** (1) |
| Un-round the complement | **caught** (1) |
| Re-add the invented thresholds | **not caught by the pre-existing suite** — all 14 tests stayed green, because every other assertion is about words and this one is about colour. Now caught (1) by the new test |

## The questions

1. **Did any fix introduce a new problem?** Particularly UL-01: is there a case where the card
   should still be drawn and now is not — a `limited` verdict with `dueBackAt` in the past but a
   *different* window still in force?
2. **Is withdrawing the fold the right call**, or did I over-correct where a narrower fix existed?
   I could not find one that did not invent a contract.
3. **Is `Unknown` for both broad arms now defensible**, given `withheld` and `unavailable` are each
   left with exactly one call site? A state with one user is a smell; I think it is the right smell.
4. **TYPE-01:** are 22 / 17 / 13 three levels that read as three, and is describing 12 and 11 as
   density variants rather than steps honest, or a rationalisation of not wanting to renumber?
5. **Did the test edits weaken anything?** I changed a stat count 2→3 and restored assertions after
   withdrawing the fold.

Severity as before. If you have no P0 or P1 on the fixes, say so plainly — I will land it.
