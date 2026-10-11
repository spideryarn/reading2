# Code review: Marginalia off the first open, and notes of its own

No P0 or P1 findings. I found three defects and fixed them; one entry-point-doc correction remains
for Greg's approval under `docs/reusable/edit-important-docs.md`.

1. **P2 — fixed — `src/relations.ts:341`, `tests/relations.test.ts:445`.** A note whose `to` and
   `toQuote` did not agree on null could survive. In particular, an `explain` row with `to: null`
   and a non-null `toQuote` was accepted, then silently stored with `toQuote: null`. That violates
   the answer contract and lets contradictory model output look checked. `toNotes` now rejects
   missing, wrongly typed, empty, or null-mismatched target fields before quote validation and
   before the cap. The regression test failed on the built code before the fix.

2. **P2 — fixed — `src/web/marginalia/MarginaliaColumn.tsx:237`,
   `src/web/reader/Reader.tsx:2556`, `tests/marginalia-note-cards.test.tsx:137`.** The UI discarded
   every verified `toQuote`: `AsideNote` gave `BlockRef` only the target id and did not connect it
   to the Reader's jump handler. A Recall or Tension link therefore moved only to the passage,
   rather than flashing the exact words the model named and validation checked. The jump handler
   and target quote now reach `BlockRef`; the regression test failed on the built code before the
   fix.

3. **P2 — fixed — `src/command-pick-catalogue.generated.json:1640`, `src/mode-catalog.ts:648`,
   `src/web/help/pages/modes/marginalia.md:8`, `docs/project/marginalia.md:158`,
   `docs/project/experimental-features.md:427`.** The generated command catalogue still exposed
   **Relation words › Run again**, and the baseline catalogue test failed. Reader help and project
   docs also still said Marginalia wrote no prose, hid outdated output, or queued the work on
   import. I corrected the sources, regenerated the command catalogue and help corpus, and updated
   the stale project docs and source comments. The row is now **Marginalia notes › Run again** and
   the docs distinguish stale (hidden) from outdated (kept while rewritten).

4. **P3 — reported, not changed — `docs/project/reading-view-overview.md:218`,
   `docs/project/interface-vision.md:156`.** Two load-bearing overview passages remain stale.
   `reading-view-overview.md` says Marginalia “generates only its own relation words”; it should say
   “its one call generates relation words and may add a few short notes.” `interface-vision.md`
   says opening Marginalia spends nothing except for the relation words; the exception is now the
   one call that writes both words and notes. These are factual corrections, but the repository
   requires before/after approval before editing an entry-point doc or a rule about cost and
   consent, so I have left both for that approval rather than bypassing the process.

Reviewed without another finding: `type: ["string", "null"]` is supported by Anthropic's Messages
[structured-output API](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits)
(its current limits explicitly count both `anyOf` and type arrays as union types), is accepted by
`validateAnthropicJsonSchema`, and is already used by other source schemas.
`answerTokens`, `budgetFor("relations", answer)` and `finishedText(..., answer)` use the same
note-inclusive estimate. Added coverage also establishes stable `relations` and `notes` identities,
no feed loop, stale hiding both lists, and outdated keeping both lists visible. The first-open
default no longer enables Marginalia; pasted, reloaded and restored `?margin=1` views still do.

Validation:

- Focused review set: **9 files, 272 passed, 3 skipped**.
- The final changed note-card suite: **48 passed**.
- Typecheck: all four projects passed; **3,701 source files covered**. `npm run typecheck` itself
  hit the sandbox's `tsx` IPC `EPERM`, so I ran the equivalent
  `node --import tsx scripts/typecheck.ts`.
- Scoped Biome check passed with only pre-existing complexity advisories and unrelated
  optional-chain suggestions. `git diff --check` passed.
- Full `npm test` was attempted but its global setup stopped before collecting tests because this
  worktree has no local Postgres and the sandbox cannot query Docker. I did not start or alter a
  database, as requested.
- No paid call or eval ran. No commit made.

**Verdict: SHIP WITH THE FIXES MADE.**
