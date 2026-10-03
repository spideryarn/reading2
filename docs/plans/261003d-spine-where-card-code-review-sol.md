1. **P2 — [tooltip.css:72](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-i-card/src/web/styles/tooltip.css:72): a long title could ellipsize the “3 of 8” count.** Fixed by making only counted spine rows flex, truncating the title first, and keeping the count fixed-width. Skim’s rows remain unchanged. Added coverage at [spine-card.test.tsx:360](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-i-card/tests/spine-card.test.tsx:360).

2. **P2 — [tooltip.css:211](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-i-card/src/web/styles/tooltip.css:211): the intended spine-gist margin was overridden by the later, equally specific `:first-child` rule.** Moved the spine-specific rules after the shared gist rules. The three-line clamp applies: `.tip-band` is the tooltip panel ancestor of `.where-detail > .tip-gist`.

3. **P2 — [where.test.ts:142](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-I-card/tests/where.test.ts:142): the voice test named both nav labels and positional fallbacks but asserted only the fallback.** Fixed it to require both. Added the missing top-level untitled-band case and exact card/button agreement for nav-label and positional fallbacks at [spine-card.test.tsx:390](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-I-card/tests/spine-card.test.tsx:390).

4. **P2 — [help-topics.tsx:225](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-I-card/src/web/help/help-topics.tsx:225): help promised a one-line gist although the accepted budget permits three.** Changed it to “a short gist.”

5. **P2 — [where.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-I-card/src/web/where.ts:82): the new limit branches pushed `whereRows` over the lint complexity threshold.** Extracted the level-bound calculation without changing behavior.

6. **P2 — [where.test.ts:83](/home/greg/code/spideryarn2/.claude/worktrees/fbd896sz-spine-where-am-I-card/tests/where.test.ts:83): two additional tests are intentionally green against the old behavior.** “Three rows whole” is a boundary control, and “Skim’s limits unchanged” protects the existing default. Neither is vacuous; keep both. The other behavior-bearing tests fail the old implementation for the intended reason.

Files I edited:

- `src/web/where.ts`
- `src/web/WhereCard.tsx`
- `src/web/styles/tooltip.css`
- `src/web/help/help-topics.tsx`
- `tests/where.test.ts`
- `tests/spine-card.test.tsx`

Verdict: **approve after fixes**. The outline is bounded to three rows per level with no spine “more” rows; real hit shapes resolve correctly; labels agree; `whereByBand` is correctly keyed and cheap enough; and the controlled-tooltip identity guard is unchanged.

Verification: 182 focused tests passed; full typecheck passed. The literal `npm run typecheck` command was blocked by the sandbox denying `tsx`’s IPC socket, so I ran the same script via `node --import tsx scripts/typecheck.ts`. Lint reports only the existing intentional reduced-motion `!important` warnings. No commit or git-state mutation performed.