No additional reader-visible defects found.

- **C1 · P2 · fixed** — [Reader.tsx:2002](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/src/web/reader/Reader.tsx:2002) lacked regression coverage for reopening Chat from the drawer. Added whole-page cases at 390px and 600px using real Chat components. Both fail on `band-away` with the old Remember-only line and pass with the candidate.
- **C2 · P3 · fixed** — [tripwire:8](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/tests/structure-row-cards-may-drop-below.test.ts:8) prematurely claimed completed browser measurements; the plan also described a mocked test instead of the source-reading test built. Corrected both descriptions.
- **C3 · P3 · fixed** — [touch.md:723](/home/greg/code/spideryarn2/.claude/worktrees/q-yeses-cards-bands-notices/docs/project/touch.md:723) said the controls set an already-selected mode, although `showBand` avoids that write. Corrected the wording. The tooltip addition matches the code.

All four fixes and both glyph changes produced the intended mutation failures. Final verification: **163 tests passed across 11 files**, typecheck passed via `node --import tsx scripts/typecheck.ts`, and lint exited successfully with existing advice.

`term` and `gate` both replace history, so the suspected extra Back step needs no fix. The Structure tripwire is worth retaining as a cheap guard; geometry remains for the separate browser check.

All runtime mutations are restored. Nothing committed.

**Verdict:** land it with the fixes above