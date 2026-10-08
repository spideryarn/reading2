# Code review: the way-back chip moves the position and leaves the modes alone

1. **High — a return superseded by a new jump rebuilt the journey from stale pre-return state**
   (`src/web/jump-history.ts:388`, `src/web/keynav.ts:484`, `src/web/router.ts:1686`). The return moves
   the page before nuqs writes, so `history.state` still contains the journey the reader just undid.
   The old `beginJump` cleared that return arm; the winning jump then put the undone journey back,
   producing `{ origin: B, earlier: [B, A] }` instead of `{ origin: B, earlier: [A] }`. I changed a
   jump that supersedes a queued return to carry the return's `next` stamp as its base, including an
   explicit `null`, and stopped a refused/no-op jump from clearing the queued arm. The real-queue
   regression at `tests/return-chip.test.tsx:671` was observed failing before the fix.

2. **High — a scroll-spy value replacing the queued `at` made the wrapper refuse the transaction**
   (`src/web/jump-history.ts:455`, `src/web/router.ts:1619`). nuqs stores one value per query key and
   keeps `history: "push"` sticky for the batch. On older Safari its 320ms floor lets the 300ms
   position spy replace a jump or return target before the push. Exact target matching therefore
   discarded the arm, carried the old stamp, and could leave the journey unadvanced. This also
   affected a jump armed between the return and the flush. I now allow a changed target only for the
   same nuqs-marked push, from the same complete address and to the same pathname; raw pushes still
   require an exact target. The return, jump, and combined return → jump → spy cases are pinned at
   `tests/jump-history.test.ts:379` and `tests/return-chip.test.tsx:702`. Each relevant assertion was
   observed failing before its fix.

3. **Low — the same-value test could hide a missing push behind the armed-state UI**
   (`tests/return-chip.test.tsx:192`, `tests/return-chip.test.tsx:649`). An outstanding arm hides the
   chip, so “the chip went away” was not proof that a push landed or advanced the stamp. The old wait
   helper could also finish without observing a history write. I made it wait for the wrapper's
   address-change notification with a rejecting timeout, and the test now asserts the new history
   entry, committed stamp, and cleared arm. I also checked nuqs 2.10.0 itself: its update path always
   enqueues at `node_modules/nuqs/dist/index.js:572-615`; the `Object.is` guard at line 544 only skips
   a React state update. A same-value `setAt(..., { history: "push" })` therefore does push.

4. **Info — plan-review F1–F4 are present in the built code.** F1 uses the real nuqs queue and keeps
   another queued key (`mode`) in the same push. F2 moves unconditionally in `beginReturn`, then sets
   `synced.current`; both top and block movers cancel any glide and clear `arrivalAnchor`, while the
   reflow effect only re-anchors on an actual `layoutKey` change. F3 steps aside only when the band
   covers the prose and transfers focus to `BandBackChip`, then to the band's first control on return.
   F4 updates Help and its generated corpus and replaces the spine's depth invariant with successive
   `earlier` origins. The focused tests exercise all four.

5. **Info — compatibility and documentation are internally consistent.** `readStamp` treats v2 and
   legacy entries as one-stop journeys; older v2 and pre-v2 bundles both reject v3 without drawing a
   misleading chip. Remaining mentions of `depth`, `history.go`, and `useJumpStamp` describe history,
   compatibility, Skim depth, or removed behaviour rather than the current mechanism. I corrected
   the one current-rule sentence that said every same-article push carries the stamp: jumps and
   returns write transitions; only ordinary pushes carry it unchanged.

## Checks

- Requested Vitest command: **4 files passed, 151 tests passed**.
- Typecheck: `npm run typecheck` could not create the `tsx` IPC socket in this sandbox (`EPERM`);
  running the same script as `node --import tsx scripts/typecheck.ts` passed all projects and all
  3,515 covered source files.
- Documentation/Help checks: **3 files passed, 92 tests passed, 1 skipped**.
- `git diff --check`: passed.
- A full `npm test` attempt could not start because this sandbox cannot reach the shared local
  Postgres service; the requested unit suites are green.

VERDICT: ship after fixes made
