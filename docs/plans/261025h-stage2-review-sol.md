No P0s. I found two issues and fixed both.

## Findings

### S2-F1 — P1 — “search the literature” opened article search, not Where it sits

Evidence: Stage 2 explicitly requires this command-bar alias, but the generic `search …` parser won. The red test returned `Find “the literature” in this article` instead of `Sources › Where it sits`.

Fixed in [sub-modes.ts](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/sub-modes.ts:280) and [command-match.ts](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/web/command-match.ts:638). The exact named command now wins without also showing a contradictory generic Find row; the generated command catalogue was refreshed.

Red-first proof: [command-bar-sub-modes.test.tsx](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/command-bar-sub-modes.test.tsx:608). The collision-matrix test also initially failed after the first fix and now guards the parser exception.

### S2-F2 — P2 — The spending regression harness still modeled the old Bibliography default

Evidence: the test’s Sources probe defaulted to Bibliography and did not mount `useSituate`, so its green “Sources starts nothing unexpected” result could not detect an automatically started dossier.

Fixed in [modes-that-start-themselves.test.tsx](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/modes-that-start-themselves.test.tsx:256). It now models Where it sits’ Bibliography, citer and dossier reads, with explicit tests for:

- A genuine Sources press starting only Bibliography.
- Bare `?mode=sources` starting no job.
- Back/Forward among Reception, Claims and Where starting no job.

The red-first assertion failed because `/api/situate/…` had never been requested; the corrected coverage is at [lines 1027–1053](/var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/tests/modes-that-start-themselves.test.tsx:1027).

## Audit result

- Spending boundaries hold. Reception and Claims arm nothing; the dossier has no automatic run. Their first-run and forced-rerun buttons still call `ensure`/`regenerate`. A real Sources/Where press may start Bibliography, as designed.
- Every legal Sources address selects exactly one chip. Legacy Citations lands explicitly on Bibliography; bare Sources and bare Peer review land on Where; visitors still degrade owner-only views to Bibliography.
- Bibliography entry paths explicitly write `sources=bibliography`; finding paths deliberately clear `sources` to select Where. Chat, marginalia and item-focus destinations agree.
- The dossier is available to every owner, remains unavailable to visitors, and literature marginalia remains switch-gated. The 4/hour, 12/day per-owner and 100/day global limits remain intact.
- The origin migration only widens both CHECK constraints; every previously valid row remains valid. New finding origins reopen by ID, while old lens-origin chats are still found through the fallback.
- I also corrected stale current-tense comments and Marginalia naming left behind by the promotion.

## Verification

- Stage 2 matrix: **16 files, 695 passed, 2 skipped**.
- First-run/rerun and allowance matrix: **5 files, 704 passed, 18 skipped**.
- Documentation links: **18 passed**.
- Typecheck: all **4,030** source files covered and passing.
- Scoped lint: no errors; only existing complexity/optional-chain advisories.
- `npm test` could not start its database lanes because this sandbox cannot connect to `127.0.0.1:54362` (`EPERM`). Consequently, the Postgres migration and chat-origin route integration tests were not runnable here.