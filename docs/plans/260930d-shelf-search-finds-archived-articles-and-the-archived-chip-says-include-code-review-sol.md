## Findings

- P0: None.

- P1, fixed — stale failed requests were not scope-checked. The success path rejected results from the previous chip state, but the rejection path could still replace newer archived results with an old active-only error. I added query/archive guards at [useLibrarySearch.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/web/useLibrarySearch.ts:127) and a regression test at [shelf-archived-in-the-list.test.tsx:568](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/tests/shelf-archived-in-the-list.test.tsx:568). The test failed with the guard removed and passed after restoration.

- P2, fixed — several absolute or stale reader-facing claims contradicted the new scope. These included “every article,” unconditional “out of library search,” and references to turning “Archived” on/off. Copy now describes passages and the default-hidden archive rule accurately at [Library.tsx:983](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/web/Library.tsx:983), [Metadata.tsx:2621](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/web/Metadata.tsx:2621), [PrivacyPage.tsx:529](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/web/PrivacyPage.tsx:529), and [ShelfEntry.tsx:480](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/web/ShelfEntry.tsx:480).

- P2, not fixed — the documented Unread limitation remains: while the archived listing is loading or has failed, its slugs are absent from the client-side Unread set; filtering also happens after the server cap. This predates the stage and is explicitly deferred in the plan. Fixing it properly requires coordinating listing readiness or moving the filter server-side, rather than another local copy tweak.

Ownership remains enforced before the archive predicate at [pg-shelf.ts:609](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/store/pg-shelf.ts:609). Chat still passes only `excludeSlug`, never `includeArchived`, at [chat-tools.ts:1121](/home/greg/code/spideryarn2/.claude/worktrees/fb72-shelf-archived-search/src/chat-tools.ts:1121).

## Files touched

- `src/store/contracts.ts`
- `src/web/Library.tsx`
- `src/web/Metadata.tsx`
- `src/web/PrivacyPage.tsx`
- `src/web/ShelfEntry.tsx`
- `src/web/useLibrarySearch.ts`
- `tests/shelf-archived-in-the-list.test.tsx`

No commit or push was made.

## Checks

- Client/doc scoped run: 5 files, 79 tests passed.
- Metadata/shelf-copy run: 12 files, 206 tests passed.
- Final privacy/metadata run: 2 files, 23 tests passed.
- Final archive no-result/race run: 2 tests passed.
- Red proof: stale-failure test failed with the guard removed, then passed after restoration.
- Typecheck: `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 2,401 source files. `npm run typecheck` itself was blocked by sandbox denial of `tsx`’s IPC socket.
- Biome check passed with only two existing complexity advisories.
- `git diff --check` passed.
- I attempted the database/ownership/route tests, but this sandbox denied access to local Postgres with `EPERM`; the supplied evidence records those suites passing.

I agree the intended claim holds after these review fixes: archived passage search is included and marked, the control is unambiguous, stale success and failure responses from the other chip state are dropped, chat is unchanged, and ownership is retained. The only caveat is the already-documented Unread loading/failure and post-cap behavior above.