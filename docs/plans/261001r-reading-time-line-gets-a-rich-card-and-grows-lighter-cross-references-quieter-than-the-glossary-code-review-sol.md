No P0–P2 findings.

1. **P3 — stale card position after rapid re-entry** — [BlockLinkCard.tsx:355](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/src/web/BlockLinkCard.tsx:355). Leaving the reading strip for its table cell, then re-entering within the close delay, retained the old pointer height. I refresh the virtual reference on re-entry. A mutation check confirmed the new regression test fails without this fix.

2. **P3 — weak/vacuous card tests** — [reading-time-card.test.tsx:94](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/tests/reading-time-card.test.tsx:94). The original touch test also passed before reading lines were delegated. I changed it to dismiss an already-open card, added the real strip-to-cell `pointerout` case, pinned `tip-soon` rather than `tip-cite`, and covered virtual-reference re-entry.

3. **P3 — incomplete documentation** — [tooltips.md:36](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/docs/project/tooltips.md:36). The new section named only two remaining gutter `title`s; there are five. I corrected the inventory.

4. **P3, wider/pre-existing — false selector in documentation** — [glossary.md:341](/home/greg/code/spideryarn2/.claude/worktrees/fbmn3ruw-sxvq2j-reading-marks/docs/project/glossary.md:341). It says `mark.term[data-open]`; the implementation uses `data-term-open`. This predates `abe1d662c`, so I left it outside the review diff.

The other questioned areas check out: Floating UI supports this virtual-reference shape and `autoUpdate` follows `contextElement`; focus without `clientY` affects only focusable links/xrefs; refreshes preserve correct card content; existing links still use their element reference and `tip-cite`. The reading-time wording matches the recorder. The CSS calculation is valid unitless typed arithmetic and evaluates to zero at level 0. The term+xref, cite+xref, and cmt+term cascades behave as planned.

Gates:

- Requested Vitest command: **5 files, 122 tests passed**
- `npm run typecheck`: wrapper blocked by sandbox Unix-socket permissions (`listen EPERM /tmp/tsx-1000/14.pipe`)
- Equivalent `node --import tsx scripts/typecheck.ts`: **passed all projects; 2,590 source files covered**
- Biome lint on edited code/tests: **passed**
- `git diff --check`: **passed**

No commit made. The pre-existing untracked review-prompt file remains untouched.