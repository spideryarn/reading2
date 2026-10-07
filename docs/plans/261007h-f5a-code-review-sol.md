# F5a review of `f868ce9d9`

Findings recorded before fixes, 2026-10-07. Other builder's uncommitted switcher files are excluded.

- **H1 — P1, wrapped passage ids can take each other's taps.** The global 1.3rem target is taller than chip-only flex rows in `.gloss-where`, `.tweets-from`, `.chat-pointed li`, `.simple-refs` and `.quiz-evidence`. At root16, Glossary chip rows can be 16.7px apart against a 20.8px target; Tweets can be only 9.28px apart. Spoken references with no `why` also collide across adjacent list items. Reserve the vertical overhang at container edges and increase wrapped row gaps under the coarse query, in candidate `tap-target.css` without editing the other builder's sheets.
- **H2 — P1, neighbouring short Quotes rows overlap.** The 18px gap protects the two controls inside one row, but the info target extends above the row and the id target below it. For a side-column-height-driven row, the preceding id and next info target intersect by about 6px at root16, about 7px at root12. The first info target is also clipped at the list's top. Coarse row padding must contain both overhangs.
- **H3 — P2, section clearance assumes a 16px root.** At the supported 12px root, `mb-4` is 12px while the fixed 13px chevron's centred 40px target reaches 13.5px below the heading. `/profile`'s first Recently read link follows only a 1px card border: about 0.5px remains under the heading target. Give the coarse margin a physical floor. Keep the conditional on collapsible headings; the shared Section is used only by Profile and Metadata.
- **H4 — P2, guards miss layout edges.** Existing assertions pin intrarow stacking and the generic target but never require room for wrapped flex rows, adjacent Quotes rows, or the coarse heading margin. Add guards before the fixes and see them fail. Check the original positive guards by removing each declaration in a temporary CSS fixture, without mutating production files.
- **H5 — P3, obsolete measurements in comments.** `BlockRef.tsx` and `quotes.css` still call the bounded id target 24px; the implementation is 1.3rem. Correct these and update the touch documentation for the new row clearance.

No conflicting absolute/sticky positioning found on candidate callers; later component rules and the utilities layer retain precedence. Phrase links and missing-id spans remain excluded. `BlockRange` is dead production UI code: no current imports or renders; an unrelated evaluation type has the same name. Report only, no removal.

Initial requested test run: 202 passed, one stylesheet-import guard blocked by `spawnSync git EPERM`. System Chrome launch also failed (`setsockopt: Operation not permitted`). Hit ownership and RTL appearance cannot be certified by a browser here; the overlap findings above are derived from committed geometry and independently checked in a read-only subagent.

- **H6 — P1, wider: the committed wait still lacks its hiding stylesheet.** Both the candidate and its parent omit `.band-waiting-ghost` CSS. The parent `5fb8b4783` explicitly says those rules will be committed with F2, which owns `mode-band.css`. Thus the candidate's 13px SVG is visible before 600ms despite lacking the spinner class; removing that class changes an animated glyph into a static glyph, not into an invisible footprint. The current uncommitted stylesheet hides it, so testing that working tree masks this missing dependency. Report only: do not touch the other builder's file. The standalone candidate cannot be declared ready until that dependency lands.

H1–H5 are fixed in the working tree, without committing. The invisible targets retain their sizes;
coarse-pointer spacing grows around wrapped id rows and at container edges. Quotes' logical row
padding contains both controls; section margins use `max(1rem, 14px)`. The obsolete 24px comments
and the touch reference are corrected. `controls.md` remains accurate and is unchanged.

Validation:

- Seven new regression cases were seen red before their fixes (six initially, Quiz evidence
  separately), then green. The tap-target suite now has 15 passing tests.
- Requested eight-file run: **209 passed, one failed**. The sole failure is the existing import
  guard's `spawnSync git EPERM`, an environment restriction. Close-cross tests pass; neither
  `close.css` nor `.close-x` was edited. Log: `/tmp/f5a-requested-final.log`.
  Its exact import scan was also run manually with Git enumeration in the shell: two CSS imports,
  no offenders, and the nonempty-scan assertion passed.
- The actual stylesheet guard callbacks reject **17 removal/move mutations**, including target
  positioning and dimensions, id bounds, Quotes stacking and edge padding, wrapped-row spacing,
  and positioning moved outside the coarse query. Evidence: `/tmp/f5a-mutation-check.mjs` and
  `/tmp/f5a-mutations.log`. The heading's arbitrary Tailwind utility was separately compiled and
  emits the correct coarse media query and `margin-bottom: max(1rem, 14px)`.
- All four TypeScript projects and source-ownership checks passed via
  `node --import tsx scripts/typecheck.ts` (the equivalent runner without tsx CLI's blocked IPC
  socket). Scoped Biome lint and `git diff --check` passed.
- `npm test` cannot initialise its database lane here: Docker database discovery is unavailable.
  Log: `/tmp/f5a-full-test.log`. Browser launch failed on Chrome's socket permission; the Sonnet
  browser delegation also could not reach its API (`EAI_AGAIN`). No browser hit-test, long-text or
  RTL appearance claim is made by this review.

The remaining BlockRef callers were independently scanned. FAQ's passage margins, Ideas/Timeline
quote rows and Citations' provenance rows have sufficient space; phrase callers stay excluded.
Quotes' side column has a minimum width rather than a fixed width, so longer ids can enlarge it;
valid current ids display six characters. Both the model's and reader's Quotes rows share the fix,
and the reader's note icon only adds top clearance. No candidate positioning conflict was found.
Profile and Metadata are the only production callers of this shared Section.

Root-cause record: [261007l](../postmortems/261007l-an-invisible-target-needs-space-at-every-layout-boundary.md).

**H6 is reported, not fixed:** the standalone commit still depends on F2's missing waiting-footprint
CSS. The other builder owns that stylesheet. Once the dependency lands, the spinner-class removal
is appropriate; it presently masks a visible SVG from class-counting tests. No dead-code removal
or changes to the other builder's files were made.

Files changed:

- `src/web/styles/tap-target.css`
- `src/web/styles/quotes.css`
- `src/web/BlockRef.tsx`
- `src/web/PageSection.tsx`
- `tests/tap-target.test.tsx`
- `docs/project/touch.md`
- `docs/plans/261007h-f5a-code-review-sol.md`
- `docs/postmortems/261007l-an-invisible-target-needs-space-at-every-layout-boundary.md`

VERDICT: not ready
