## Findings

- **P2 — regression coverage gap** in [faq-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/tests/faq-panel.test.tsx:378). The legacy unscored behavior was pinned only for owners, not visitors. Fixed by testing both paths: reading order, no order row, slider, or score bars.
- **P2 — edge-case coverage gap** in [faq-order.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/tests/faq-order.test.ts:84) and [faq-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/faq-priority/tests/faq-panel.test.tsx:398). Partly scored questions and an above-data `?faqbar=` were not pinned end-to-end. Fixed with tests proving the visible list, count, foot line, track maximum, and pressed order agree.

No P0/P1 behavior defects found.

The legacy guarantee holds: owner and visitor use the same panel; absent scores survive the public DTO unchanged; `effectiveOrder` falls back to document order; and neither controls nor score bars render.

The Glossary/Citations wrappers preserve their prior arithmetic, including `.501/.509`, `.005/.009`, `.57/.58`, and off-range current values. Validation, answer budget, prompt boundaries, public DTO, and URL-state wiring also look correct.

The plan’s evaluation conclusion is fair. D/E support a 7–1 ordering effect, while B/C are within the old-vs-old control’s variation. I also verified that the default threshold did not change the judged first five versus prioritised order at bar zero in any of the 12 new runs, so the result is genuinely attributable to ordering. `0.20` is a sound default: highest tested calibration stop above the predeclared 80% average, 91% held-out retention, and at least five questions retained in every evaluated list.

Checks:

- Focused Vitest command: **5 files, 200 tests passed**.
- Reviewed-file Biome lint: passed.
- `npm run typecheck`: the `tsx` launcher was blocked by sandbox Unix-socket creation (`listen EPERM`) before the script ran.
- Same typecheck script via `node --import tsx scripts/typecheck.ts`: **all four projects passed; all 2,346 source files covered**.
- No commit made.

**Verdict: approve — no user-visible correctness defect found; two P2 regression-test gaps fixed.**