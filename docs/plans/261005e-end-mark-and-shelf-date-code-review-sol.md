**Ship.** No P0, P1 or P2 defects found. I added three test cases; no implementation fixes were needed.

1. **Footer consumers are safe.**

   | Consumer | Evidence and effect |
   |---|---|
   | Scroll and flashes | `scroll.ts:995`, `flash.ts:262` use `blockRow`, which selects `tr[data-block]`. The footer increases document scroll height, as intended, without becoming a jump target. |
   | Selection and touch chip | `selection.ts:49,152`, `TouchSelectionChip.tsx:165` require block rows or `td.text .prose`; the footer is excluded. |
   | Spine | `Spine.tsx:190–203` measures block rows, ending at the last block’s bottom rather than the table’s bottom. |
   | Reading position and time | `useReadingPosition.ts:154` resolves section IDs; `on-screen.ts:17,34` selects `tbody tr[data-block]`. The footer receives neither a position nor reading credit. |
   | Keyboard and term movement | `keynav.ts:184,195`, `TermJump.tsx:87,195` select body block rows. |
   | Layout and folding | `layout.ts` calculates widths without counting DOM rows. `fold.ts:150` hides cells only beneath `tr[data-block]`; the mark survives folding. |
   | Marginalia and table observers | `MarginaliaColumn.tsx:742` measures actual notes. Its bare `closest("tr")` starts from a note, so it cannot reach the footer. Other table observers simply trigger fresh block measurements. |
   | Selectors and print | Body-cell rules remain scoped to `tbody`; no relevant `tr:last-child` rule is broken. `prose.css:903` makes the footer a plain row group, avoiding repeated print footers. |

2. **Styles are sound.** Shared padding centres the ornament on the main prose axis in Plain, band and phone layouts, including narrowed callouts. Footnotes deliberately retain their existing left alignment (`footnotes.css:97`); the ornament follows the main column. No unwanted cell borders, sticky positioning, stacking or background inheritance appeared. Both themes supply the ornament’s colour tokens. This was a stylesheet review, without browser or print-preview verification.

3. **Shelf and docs are correct.** The date preserves existing facts, handles minimal papers and missing metadata, and uses unique keys for equal-valued facts. Wrapping remains enabled. Published-sort duplication is intentional and documented. Public cards and Table view are unchanged. The added Greg quotations match the plan’s two reports.

4. **Tests detect removal or misplacement.** Footer tests check its count, final position and exclusion from blocks; Shelf tests check the date’s position within the facts line. Restoring `key={f}` made the new collision test fail with duplicate-key warnings.

Exactly what I changed:

- [article-end-mark.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-zgf8p2-cqjhbn-end-mark-shelf-date/tests/article-end-mark.test.tsx:133): added the final-section folding case.
- [shelf-card-published.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-zgf8p2-cqjhbn-end-mark-shelf-date/tests/shelf-card-published.test.tsx:116): added equal-author/site/year and date-only metadata cases.

All **18 tests passed** across the two requested files and `fold-keynav.test.ts`. Lint and typecheck passed; typecheck used `node --import tsx scripts/typecheck.ts` because the normal launcher hit a sandbox restriction. Changes remain uncommitted.