## Findings

1. **Low — fixed: the shared counts tooltip named an owner-only section to visitors.**
   `CountsButton` said the counts were in “Metadata's At a glance”, but the visitor's Metadata
   page calls that section “The piece” (`PublicPages.tsx:188`). I changed the sentence to “The
   Metadata page has them too,” which is true on both paths, and added a keyboard-opened tooltip
   assertion in `masthead-published-and-counts.test.tsx`. I watched that test fail on the old copy
   before changing it.

2. **Low — fixed: two regression tests covered only subsets of the promised moves.** The masthead
   order test omitted a byline while claiming to pin `byline → journal → site → date → read time`,
   so it could not catch a byline moved into the wrong position. The Metadata order test proved
   that the purpose box moved but not that the read-only *About you* half moved with it. The tests
   now pin the full fact prefix and require *About you* inside *Why you're reading* and outside
   *Your reading*.

3. **Low — not fixed: the new small text button does not meet the repo's coarse-pointer target
   rule.** `.counts-toggle` has zero padding and no `.tap-target`, so its hit area is roughly the
   0.82rem line height rather than the 40px target required by `docs/project/controls.md`. The two
   adjacent older controls have the same omission. A correct repair should treat all three as one
   wrapping group: adding three independent invisible targets without reserving room can make them
   overlap and hand a tap to the later control. That repair requires changing the peer controls in
   `FoldToggle.tsx`, outside the listed implementation files, so I did not make a partial fix here.

4. **Low — partly fixed: comments still described the old fact positions.** I corrected the two
   stale comments in `Masthead.tsx` (“after the site” despite journal preceding site, and Fold all
   being beside a section count that is now hidden behind another button). The exported
   `FoldAllButton` comment at `FoldToggle.tsx:68` still says it is beside the section count; I left
   that reference file unchanged for the same scope reason as finding 3.

The owner/visitor boundary is otherwise correct. `PublicMetadataPage` narrows the cast payload to
`PublicMeta` and passes `publishedLabel` a fresh object containing only `published` and
`publishedYear`; `metadata-origin.test.tsx` positively proves that a stray `publishedAt` on a
visitor payload is ignored. The shared masthead correctly accepts either spelling. Moving the
purpose markup did not move its autosave hook, change `#article-purpose`, or bypass the
DOM-derived contents/search list, so autosave, search, native deep links and the narrow-window
contents placement keep their existing paths. The button otherwise matches its peers: native
`type="button"`, visible changing name, `aria-expanded`, focus-opened `ControlTip`, and the shared
visual rules. The plan's decision not to add `aria-controls` is consistent with the revealed facts
remaining individual inline items rather than one controlled region.

Verification:

- `npx vitest run` on the six non-browser affected test files: **157 passed**.
- `tests/masthead-facts-wrap-in-chrome.test.tsx` was attempted separately in the original focused
  run, but Chrome exited with `SIGTRAP` after sandbox `setsockopt: Operation not permitted`; no
  layout assertion ran.
- `npm run typecheck` could not create tsx's IPC pipe in this sandbox (`listen EPERM` at
  `/tmp/tsx-1000/14.pipe`). Running the same checked script without the tsx CLI IPC layer,
  `node --import tsx scripts/typecheck.ts`, passed all four projects and confirmed all 3,752
  TypeScript source files are covered.

APPROVE WITH CHANGES
