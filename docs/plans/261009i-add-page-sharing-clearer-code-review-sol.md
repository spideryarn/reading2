## Findings

- **P2 — Test helpers could silently click nothing or the wrong Cancel.** The rewritten `shareBox()` fell back to the whole control and could mistake the confirmation’s Cancel for the public-state action. Fixed both helpers to select only explicit public presses, and added an exhaustive state-to-controller matrix test. [add-page-share.test.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/tests/add-page-share.test.tsx:196), [add-page-sharing-section.test.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/tests/add-page-sharing-section.test.tsx:232), [add-share-view.test.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/tests/add-share-view.test.tsx:57)

- **P2 — Heading hierarchy was inconsistent.** The settled Sharing row lacked its `h2`, while confirmations competed with their controls. Fixed the hierarchy to `h2` row → `h3` controls → `h4` confirmations. [AddSharing.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddSharing.tsx:116), [AddShare.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddShare.tsx:107), [AddShareLink.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddShareLink.tsx:89)

- **P2 — A published sentence became false when the article was also public.** “It is not listed anywhere” could refer to the public article. It now says “The private link is not listed anywhere.” [messages.ts](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/messages.ts:4849)

- **P3 — The plan’s meaning audit was incomplete and partly stale.** It omitted Help and direct-add state changes, misstated the old row, used an obsolete constant name, and blurred `cancel()` versus `untick()`. Corrected the state table and complete published-sentence audit. [261009i-add-page-sharing-clearer.md](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/docs/plans/261009i-add-page-sharing-clearer.md:95)

## What I fixed

- Pinned every `ShareAtAddState` to its visible press and controller method.
- Added tests proving the helpers fail when no real public press exists.
- Tested the Help link, tooltips, headings, copy icon, and icon-only button’s accessible name.
- Made the import-copy tooltip consistently say “address”.
- Updated stale tick-box comments, Help, sharing documentation, and the generated help corpus.
- Saw four intended tests fail before the fixes.
- Verification passed:
  - Focused feature suites: **194 passed, 1 skipped**
  - Adjacent documentation/page suites: **189 passed**
  - Typecheck: all **3,573** source files covered and passing
  - Biome: no errors; three pre-existing complexity notices
  - `git diff --check`: clean

`npm test` could not pass its database preflight under the sandbox, and a broad unit run encountered unrelated process/network sandbox failures; I stopped it. No database or browser was used, and nothing was committed or pushed.

## Wider issues not fixed

- **P1 — The direct-add privacy sentence can still overclaim.** A returned job selects “has been sent to a third-party model provider”, although a queued job does not prove the provider received it. This predates the change and the plan explicitly leaves the privacy wording/product decision to Greg. [AddPage.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer/src/web/AddPage.tsx:1451), [messages.ts](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-sharing-clearer/src/messages.ts:5875)

- **P2 — An `unknown` private link still offers only “Check again”, not a way to turn it off.** This is also pre-existing and explicitly deferred because it requires controller behavior beyond this visual change. [AddShareLink.tsx](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-sharing-clearer/src/web/AddShareLink.tsx:149), [add-share-link.ts](/var/tmp/spideryarn-worktrees/fbnsrkju-add-page-sharing-clearer/src/web/add-share-link.ts:293)

**Verdict: PASS WITH FIXES for plan 261009i; the two documented pre-existing gaps remain open.**