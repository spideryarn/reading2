F1 — **should-fix, fixed** — `startsNote` split note 39 when its continuation began “40 per cent…”. It now overrides `continues` only for explicit labels such as `122.` or superscripts. Added red-then-green coverage in [pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/tests/pdf-footnotes.test.ts:615).

F2 — **should-fix, fixed** — A held bare label survived intervening prose and could steal an unrelated continuation on the same or next page. Substantive records now clear it; publisher furniture remains transparent for genuine page-turn splits. Covered at [pdf-footnotes.test.ts](/var/tmp/spideryarn-worktrees/fbrg5kk6-rovelli-import-inspect/tests/pdf-footnotes.test.ts:652).

Everything else checked out:

- Prior F1–F4 landed correctly after these refinements: Notes-section gating, list-heading closure, symbol reset, ordering after `endnotesTypedAsProse`, and held-label handling.
- `lastNumber` remains correct across joins, held labels, and symbol notes.
- The rebuilt `NOTE_LABEL` matched the old literal across a 120-case matrix, including Unicode letters and superscripts.
- The page-distance state does not improperly resume after a broken chain.
- Rovelli replay: 143 notes, 0 label-only notes, 37 linked markers.
- Focused tests: 56 passed.
- Typecheck: all 3,934 source files covered and passed.
- Biome lint exited successfully with advisory complexity notices only.

The `npx tsx`/`npm run typecheck` launchers themselves hit sandbox IPC `EPERM`; running the same scripts through `node --import tsx` succeeded. No commit made.

SHIP WITH THE FIXES MADE