Found and fixed one P1 behavior bug plus two P2 test-evidence gaps. No P0s and no wider decision needed.

### Findings

- **S4-F1 — P1 — topic toggle could remain stuck after A → B → A navigation. Fixed.**  
  A pending topic request was invalidated correctly, but its separate “already asked” marker survived. Returning to article A suppressed the replacement request, leaving “Asking OpenAlex” forever. Fixed by resetting the marker with request invalidation while retaining settled answers. Evidence: [useCiters.ts](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/useCiters.ts:173).  
  Red-first regression: [use-citers.test.tsx](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/use-citers.test.tsx:237). Before the fix it expected a replacement topic GET but received none. It also proves the stale first response cannot overwrite the replacement. Root-cause write-up: [postmortem](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/docs/postmortems/261026a-an-ask-once-marker-must-share-the-request-generation-it-represents.md:1).

- **S4-F2 — P2 — “nothing stored or sent” test allowed persistence through unobserved browser APIs. Fixed.**  
  The original test watched `fetch` and `Storage.setItem`, but an injected cookie write passed. It also checked only the final URL, so a write followed by removal could escape. The harness now catches fetches, browser storage, cookie writes, and both history-writing APIs through every experiment press. Evidence: [sources-experiments.test.tsx](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/sources-experiments.test.tsx:43), assertion at [line 231](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/sources-experiments.test.tsx:231).  
  Red-first proof: an injected cookie write passed the old test and failed the strengthened test six times.

- **S4-F3 — P2 — whole-app no-start test could miss accidental OpenAlex GETs. Fixed.**  
  It asserted only job-starting POSTs, so mounting `useCiters` from an experiment would still pass. The test now records all `/api/citers/:slug` reads and covers a pasted Evidence-first address, Guess/Evidence Back and Forward, and a real unmount/remount. Evidence: [reception-lens-in-chat.test.tsx](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/reception-lens-in-chat.test.tsx:1140).  
  Red-first proof: temporarily enabling `useCiters` for the experiment views made the strengthened test fail on `GET /api/citers/a-piece-with-angles`.

The remaining requested contracts held: address/chip behavior, switch-off reachability, visitor fallback, command-bar exclusion, experiment honesty, fallback wording/counts, fonts, and shared order controls. I also corrected stale “seven sub-modes” documentation to nine.

Verification:

- Focused Vitest: **8 files, 192 tests passed**
- Direct TypeScript check: **4,032 source files covered, passed**
- Biome lint on touched code: passed
- `git diff --check`: passed
- Full `npm test` could not start because this sandbox cannot connect to the private local Postgres lane (`EPERM 127.0.0.1:54362`).
- The two pre-existing untracked Stage 4 plan/review files were left untouched.