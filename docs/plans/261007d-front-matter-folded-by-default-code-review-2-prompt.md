# Code review, round two (narrow): the fixes made after your round one

Repo: the worktree `/var/tmp/spideryarn-worktrees/fbduh4w3-front-matter-collapse`. You may write:
fix what is inside this commit, narrowly and red-first; report anything wider. Do not commit.
Do not touch `src/public/dto.ts`, anything in `docs/project/security-map.md` § Where the defences
physically live, `.env*`, `infra/`.

## The candidate

One commit, `dd103680f` (`git show dd103680f`; parent `8aee91117`, which holds your round-one
fixes). Everything in it was written after your round one and nobody but its author has read it.
The plan's § "The code review, the browser check, and what followed"
(`docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md`) says what it is
for. Your round one: `docs/plans/261007d-front-matter-folded-by-default-code-review-sol.md`.

**Discovery is closed.** Check only these, each as "is this statement accurate?":

1. **Block 0 in the run** (`src/web/front-matter.ts`, `from = blocks[0]?.tag === "h1" ? 1 : 0`).
   With block 0 hidden and openable, does every consumer of the fold store still behave: the
   reading position never writes a hidden block and a reload never opens the run; ↑ reaches the
   first visible row; Structure focus; the spine; the masthead echo when block 0 *is* an h1?
2. **The StrictMode reopen** (`src/web/fold.ts`, `reopenFor`): only the same mounted table gets
   its open run back, and only on the StrictMode remount; can it reopen a run on a different
   article, or after a real unmount and remount?
3. **C8** (`visibleFrom` mapping a folded-away id to the outermost folded heading over it): is
   that the right value for every caller of `visibleFrom` (keynav `steppableStarts`, the reading
   position's `held` and written value)? Could it make ↑/↓ or `?at=` land somewhere wrong?
4. **`hasNameEvidence`'s overlap fix** and **"only a text block or a heading may be in the run"**:
   correct, and do the tests pin them?

Run the jsdom tests yourself, e.g. `npx vitest run tests/front-matter.test.ts
tests/fold-front-matter.test.ts tests/fold-keynav.test.ts
tests/reading-position-holds-across-a-reflow.test.tsx tests/front-matter-table.test.tsx`.

## Output

Findings `D1`, `D2`, … with severity (P0 data loss/security/charging/unusable; P1 user-visible
wrong behaviour or contract violated; P2 design risk; P3 prose), *established* or *reasoned*,
*fixed* (name the test seen red) or *reported*. End with one line: `VERDICT: ready to push` /
`ready after the reported P0 and P1s` / `not ready`.
