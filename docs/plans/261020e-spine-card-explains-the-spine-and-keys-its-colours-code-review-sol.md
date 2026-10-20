# Code review — GPT Sol

1. **[P2] The visible card footer still calls every mode's lane items “matches”.** The new
   `marksWords` reaches the key and the band button's accessible name, but `BandCard` still renders
   the hard-coded singular/plural `match` / `matches`. In Ideas, Timeline and Referee, the same card
   therefore gives sighted readers generic Search wording while its button gives screen-reader users
   the correct mode-specific wording. The Help page repeats the narrower claim that the footer says
   how many “search matches” the band holds. **Fixed.** Passed the already-stable
   `RailMarks` through to `BandCard`, used its singular/plural copy in the footer, and made Help name
   the open mode's passages rather than Search alone.

2. **[P3] The adaptive key's regression tests cover lanes and quotes, but not the other gates or
   its short-window contract.** A future change could key a zero-height supplement, stale
   reading/quote data, or leave the key visible in a 600px-tall window without making a new test
   fail. The suite also does not pin the theme-token contract or the stable identity of
   `railMarks(mode)`, the part that keeps the new prop from breaking `memo(Spine)`. **Fixed.** Added
   positive and negative integration cases for supplement, reading and quotes; pinned the origin
   boolean at the pure boundary; read the CSS contract for the height cutoff and tokens; and asserted
   that every `railMarks` answer is stable by identity.

3. **[P3] Reader-facing and project docs overstate when the key appears.** Help says every card has
   the key, while the stylesheet deliberately hides it at `max-height: 600px`; the plan's “What
   landed” section and `granularity-zoom.md` say “under 600px”, which is off at the exact boundary.
   **Fixed.** Help now says “when the window is taller than 600px”; the implementation records say
   “600px tall or shorter”.

## Verification

- Mutation checks: deliberately reintroduced a lane keyed from unrendered matches; optional chips
  keyed from stale input or a zero-height supplement; an unhidden key; a hard-coded swatch colour
  and wrong height cutoff; an unstable `railMarks` object; generic accessible counts; missing base,
  lane and quote entries; and the old visible `match` footer. Each targeted test went red. All
  mutations were then removed.
- `npx vitest run tests/spine- tests/help-corpus.test.ts`: **passed** — 11 files, 189 tests passed,
  1 skipped.
- `npm run typecheck`: the `tsx` launcher was blocked before TypeScript ran because this sandbox
  denied its `/tmp/tsx-1000/*.pipe` IPC socket (`listen EPERM`). The documented equivalent,
  `node --import tsx scripts/typecheck.ts`, **passed** all four projects and confirmed all 3,853
  source files are covered.
- `npx biome check --write src/web/Spine.tsx src/web/spine-key.tsx src/web/reader/passages.ts tests/spine-card.test.tsx`:
  **passed**, no fixes needed.
- `git diff --check`: **passed**.
