No P0 or P1 findings. I found two meaningful coverage/guard defects and one documentation defect.

### Findings

**F1 — P2 — `tests/store-seams-have-two-implementations.test.ts:207–211, 307–321`**

The narrowed seam guard cannot discover a seam with zero implementations.

`seams()` starts from `implementations()`, then filters that map against the exported contracts. Consequently, a new `FooStore` contract wired through a selector/refusal but lacking `pgFooStore` never enters `SEAMS`; the “has a Postgres implementation for every seam” loop cannot inspect it.

I verified this with an isolated mutation of `86a4ef7c`: added `ReviewMissingStore` plus `reviewMissingStore`, with its only method throwing and no `pgReviewMissingStore`. All five seam tests still passed.

The guard is stronger only for seams it discovers. It would catch the historical Claims shape if an `fsClaimsStore` still existed, but it misses the natural one-store equivalent: contract + selector/refusal + no implementation. Deriving candidates from typed selectors in `src/store/index.ts`, or marking contract interfaces explicitly as seams, would preserve the intended outage guard.

**F2 — P2 — `86a4ef7c^:tests/store-reader-state-parity.test.ts:207, 283, 321`; `86a4ef7c^:tests/store-migration-registry.ts:1319–1325`**

`86a4ef7c` deletes the entire reader-state parity suite without recording the fate of its three scripted assertions:

- Chat through begin, finish, retry, edit and rename.
- Search through success, failure, retry and deletion.
- Glossary lookup replacement while preserving another term.

The registry entry is simply removed, and the G6 “ported”/“dropped” audit never names this suite. This is the unexplained deletion the freeze said must not occur.

The surviving Postgres suites cover most individual operations, and the route suite covers search deletion, so I cannot construct a current user-visible failure and have kept this at P2. What disappeared is the sequential state-transition coverage and its explicit accounting.

**F3 — P3 — `docs/project/architecture.md:125–127`; `docs/project/web-client.md:55–59`; `example/README.md:32–39`**

Several current-facing docs still describe the deleted backend as live:

- Architecture assigns stage 6 to `src/api.ts` and the queue to `data/_jobs/`.
- The web-client map says `src/api.ts` serves article reads and the filesystem `example/` fallback.
- `example/README.md` says `src/api.ts` searches `data/<slug>` before falling back to the fixture.

These now point to a nonexistent file and describe behavior the application cannot perform.

### Checks of the stated suspicions

- No third dynamic import, computed mock, package script, or config reference to a deleted runtime module found.
- `jobs.owner_id` is `NOT NULL` in both `src/db/schema.ts` and `drizzle/0000_initial_schema.sql`.
- The relevant claim transition is an owner/status-fenced conditional `UPDATE`; no process-local fence is needed.
- No job ID is concatenated into a filesystem path anywhere under `src/`.
- The eight reader-state splits retain the domain symbols used by Postgres; I found no removed export with a surviving runtime caller.
- `assertNothingOnDisk` is weaker only against a hypothetical newly invented external root. No surviving setting or path helper can select one today.

### Tests run

Against an extracted, unmodified `86a4ef7c`, I ran 144 non-database tests across nine files: the seam, one-store, public-import, library, library-search, chat, searches, glossary-lookups, and profile suites. All passed.

I also ran the five seam tests against the isolated F1 mutation; all incorrectly remained green. I attempted the migration-registry suite, but its child `tsx` process was blocked by the isolated `/tmp` sandbox with `EPERM`, so I do not count that run as evidence.