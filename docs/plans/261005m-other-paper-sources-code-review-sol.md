## Findings

H1 — P1 — established, fixed. A citation previously stored under `url:huggingface.co/…` could lose its `CitedWork.id` when regenerated if its model-written title, author, or year also changed. That orphaned Find/Investigate state keyed by the old id.

I added `a mirror citation stored under its old URL key keeps its id when its metadata changes`; it failed red with two different ids, then passed after `idsByKey` began recording a unique migration alias from the old `url:` key to the new `arxiv:` key. Ambiguous aliases are still refused.

G11 is now closed:

- Hugging Face and alphaXiv citations receive the arXiv work key.
- `matchOf` matches them against stored arXiv PDF addresses.
- Old rows retain their ids even when metadata changes during migration.
- Dependent state is keyed by that retained id.

G12 and G13 are closed:

- `[fetch-paper-missing]` is blocked and appears only when the last candidate was absent.
- A 404 followed by a wrong-kind document remains `[fetch-incomplete]`.
- Logs contain source, candidate count, and failure code, with no address.
- An ordinary address’s 404 remains byte-for-byte unchanged.

The registry invariants, hostile-input tests, candidate round-trips, source overlap, case behavior, and eager client graph all passed. The pre-existing landing-page stub remains until refresh, as suspected; part 1 explicitly documents that as a deliberate passed-over migration rather than an accidental stage-A behavior.

Checks:

- Requested focused suite: 7 files, 546 tests passed.
- Eager-client graph: 9 tests passed.
- Full typecheck: all four projects passed; all 3,246 source files covered.
- `npm run typecheck` itself could not start because this sandbox denied `tsx`’s IPC socket; invoking the same script directly with Node passed.
- Focused lint: no new diagnostics; one pre-existing complexity advisory remains.
- `git diff --check`: passed.
- No commit made.

Files changed:

- [src/citations.ts](/var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/src/citations.ts)
- [tests/citations.test.ts](/var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/tests/citations.test.ts)

VERDICT: ship with the fixes I made