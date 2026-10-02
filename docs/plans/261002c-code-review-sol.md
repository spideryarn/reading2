I found one medium-severity product defect, fixed it, and found no unresolved issues requiring a wider decision. After that repair, all eight revised plan points are implemented.

## Findings

1. **Medium — FIXED:** a pending hide could corrupt the next article’s glossary state.

   `setHidden()` captured the originating slug’s `refresh()` closure. If a PUT for article A finished after navigation to B, it could refresh A and replace B’s glossary. The pending-entry set also leaked into B. A quick A → B → A sequence had the inverse problem: the returning GET could beat the old write and never reconcile it.

   The fix gives hide operations an article generation, clears pending state synchronously on slug changes, refuses stale completions, and uses the current refresh only when the reader has returned to the originating article: [useGlossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:299), [useGlossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:592).

   Proven by two regressions at [glossary-hide-owner-band.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/tests/glossary-hide-owner-band.test.tsx:309) and [glossary-hide-owner-band.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/tests/glossary-hide-owner-band.test.tsx:335). Both were observed red before their fixes:

   - A → B: 1 failed / 9 total.
   - A → B → A: 1 failed / 10 total.
   - Final focused result: 10/10 passed.

2. **Low — coverage hardened, no production defect:** the public DTO was correctly omitting `hidden`, but its deliberately over-full privacy fixture did not actually contain that field.

   I added a `hidden: true` sentinel and an explicit negative assertion at [public-dto.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/tests/public-dto.test.ts:823) and [public-dto.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/tests/public-dto.test.ts:1348). The allowlist projection itself was already correct: [dto.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-from-the-card-hyphens-match-spaces/src/public/dto.ts:360).

No other product defects found; nothing is being reported for a wider decision.

## Eight-point audit

All eight revised points are now present:

1. Lookup admission, streaming state, failure reconciliation and slug-change abort live in the always-mounted read controller: [useGlossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:490). Closing the band does not disown the request. `look()` returns `false` only when admission fails.

2. `shownEntries()` is the canonical visible projection: [glossary-shown.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/glossary-shown.ts:27). Reader uses it for prose marks, cards and G; the band uses it for rows/counts/sorting/gating; Skim filters defensively; hidden `?term=` values are cleared regardless of ordering: [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/reader/Reader.tsx:909), [GlossaryMode.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/modes/glossary/GlossaryMode.tsx:189).

3. Hide preferences are included in both export forms, while `glossary.json` still uses the stored artefact: [export.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/export.ts:439), [export.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/export.ts:872), [export-bundle.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/export-bundle.ts:491).

4. Both owner and public reads always re-match: [pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/pg.ts:3492), [public-reader.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/public-reader.ts:817).

5. Hide/unhide is pessimistic and serialized; the card waits, closes only after success, and retains a local failure line: [useGlossary.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/useGlossary.ts:595), [ProseHoverCard.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/ProseHoverCard.tsx:1894).

6. Ownership and current-glossary validation live in the store. PUT uses a single data-modifying CTE, DELETE is idempotent, malformed IDs are 400s and inaccessible/absent entries are 404s: [pg-glossary-hidden.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/store/pg-glossary-hidden.ts:31), [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/routes.ts:8807).

7. Separator runs are canonicalized before deduplication and length sorting: [term-match.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/term-match.ts:69), [term-match.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/term-match.ts:94). Spaces, ASCII hyphens, U+2010 and U+2011 work in arbitrary runs; en dashes and “hyphen versus nothing” remain deliberately excluded. I found no mishandled specified form.

8. The shared occurrence helper accepts only `{ id, text }` and returns copied entries: [glossary-occurrences.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary-occurrences.ts:27), [glossary-occurrences.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/glossary-occurrences.ts:87).

The trash button is a focus-visible sibling with a 1.8rem target, not nested inside the row button, and Hidden is a collapsed `<details>` section: [glossary.css](/home/greg/code/spideryarn2/.claude/worktrees/fbyqfzkm-glossary-hide-dig-deeper-links/src/web/styles/glossary.css:350).

## Always re-match

**Yes: “always re-match on both reads” is the right conclusion.**

It derives current occurrences and ordering into a new returned copy without modifying the stored artefact. Staleness remains meaningful: an empty re-match is treated as “unquoted” only when the artefact fits the article, while server-side Dig deeper independently anchors against current article blocks and preserves the `[gl-stale]`/`[gl-not-quoted]` distinction.

Chat intentionally receives the current re-matched ordering. Exports intentionally receive the stored glossary plus the separate hide-preference export. Public reads receive current occurrences, but neither lookups nor hide preferences.

Server and client can still differ if stored `block.text` and text extracted from rendered HTML differ; that pre-existing source-text distinction remains. The separator change creates no new disagreement because both paths use the same matcher and apply it symmetrically.

## Gates

- Requested non-Postgres/unit selection: **22/22 files passed, 318/318 tests passed**.
- Focused repaired suite: **1/1 file passed, 10/10 tests passed**.
- Public DTO/import plus hide suite intermediate run: **3/3 files passed, 77/77 tests passed**.
- `npm run typecheck`: wrapper exited before checking because the sandbox denied its `/tmp/tsx-1000/14.pipe` IPC socket.
- Direct invocation of the same checker passed:
  - web: 442 files
  - tests: 2,580 files
  - fleet web: 104 files
  - root: 824 files
  - **all 2,698 source files covered**
- PostgreSQL selection: **0 tests ran** because global setup was denied access to `127.0.0.1:54362` with `EPERM`.
- Required isolated retry of `tests/glossary-hidden-route.test.ts`: same infrastructure refusal, **0 tests ran**.
- Biome: **5/5 touched files passed**.
- `git diff --check`: passed.

No commit was made.