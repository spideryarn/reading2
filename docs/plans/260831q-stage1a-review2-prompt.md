# Review 2: stage 1a as rebuilt after your NO-SHIP

Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`. Built code, nothing committed. Your
previous review is `docs/plans/260831f-stage1a-review-sol.md` and all four findings were accepted — none
disputed.

**The scoped diff — 34 files, 2380 insertions, 368 deletions:**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e9d59148-0422-4f78-824d-44c35b090da5/scratchpad/stage1a-r2.diff`

Other agents share this tree. `src/auth.ts`, `src/vercel-health.ts`, `src/spend-declarations.ts`,
`evals/*`, `.env.example`, `docs/project/auth.md`, `docs/project/security.md`,
`tests/health.test.ts` and `tests/no-undeclared-spend.test.ts` are **theirs and excluded**.

## What was done to your four findings

**1. The guard.** `blocksMatchTheirHtml` keeps id-membership, then runs
`splitIntoBlocks(extracted, file.blocks)` and compares `blockIdentityFree` of each candidate against
each stored block, length first. Reads stage 2's HTML through a named `BLOCKS_INPUT_HTML`. Claimed
proof of the over-fire being gone: a fixture
`<article><style>p{color:red}</style><p>Alpha, the first.</p></article>`, asserting the blocks really
are `["Alpha, the first."]` and the stamped HTML no longer contains `color:red`, *then* that the
guard returns `true`; restoring the old text comparison reddens it. Same revert reddens three
under-fires (merged paragraphs, `h2 → p`, repointed `href`).

The agent also reversed its own earlier reasoning: it had omitted the `previous` argument claiming
`carryOverIds` could manufacture agreement, then found that wrong because `blockIdentityFree` drops
ids — and `tests/blocks-baseline.test.ts` forbids a one-argument `splitIntoBlocks` in `src/` anyway.

**2. The importer.** `onConflictDoUpdate` with `setWhere: eq(implementationVersion, IMPORTED)`.
Claims red-first, and that widening `setWhere` to a tautology reddens a test asserting a real
pipeline row is not restamped.

**3. Two heads, two fingerprints.** New `articleWithIdsFingerprint` covering the `URL:` line and the
synthetic `TITLE: <tree.slug>`, resolved through a shared `fallbackHeadTitle`. Deliberately did *not*
widen the single function, on the grounds that `articleText` never prints a URL and doing so would
invalidate four stages over a line their model never saw.

**4. `metaFingerprintOf`.** Returns `null` when `title === null`, matching `readMeta`. New
`citedMetaFingerprintOf` and `CITED_FINGERPRINT_COLUMNS`; `final_url` added to the `ideas`, `sketch`
and `metadata` projections.

Plus: every `useArticleRename` claim removed from `src/` and `tests/`, per your correction.

## What I want from you

1. **Did the four fixes actually land, and are they right?** Especially the guard: does comparing
   `blockIdentityFree` sequences close *both* directions you found, and is there a third direction
   neither of us has considered? Does reading stage 2's HTML via `BLOCKS_INPUT_HTML` bind the right
   document in **both** storage shapes?

2. **A load-bearing assumption I want challenged.** The guard rests on `splitIntoBlocks` being
   **idempotent** — on the filesystem it derives candidates from stage 3's own output, so
   `split(split(x))` must equal `split(x)`. The agent measured that on ten real articles in
   `output/` (94–669 blocks) and found it identical every time. Ten articles is evidence, not proof.
   Is there an input class where the splitter is *not* idempotent — footnote stamping, nested lists,
   `retargetAnchors`, sanitiser normalisation on a second pass? If so the guard reddens for ever on
   exactly the articles that hit it.

3. **A real cost regression, and I want your judgement on whether it is acceptable.** The guard now
   costs **16 ms at 19 KB, 169 ms at 77 KB, and 687 ms for the 676 KB `consciousness`**, and it is
   **not** short-circuited on the filesystem, where it runs once per `stepIsDone` for the `blocks`
   step on every job. The previous implementation was one regex pass. Is that the right trade for
   correctness here, or is there a cheap exact pre-check (a length or digest comparison) that would
   let the expensive path run only when it can change the answer?

4. **Something found and deliberately not fixed** — tell me whether leaving it is right.
   `isCurrent` in `src/store/pg.ts` has **no `case "sketch"`**, so it falls through to
   `default: true` and the metadata page calls every sketch current while the filesystem asks
   `STEPS.sketch.stamp`. Pre-existing, dating from when sketch got its stamp, but it is the
   two-stores-disagree class you have now flagged twice and this work widens the disagreement. The
   agent left it because fixing it needs the same `profileHash` judgement `ideasAreCurrent` had to
   make. Should it be in this stage or its own?

5. **Anything factually wrong in the account above**, anything in the diff that is not stage 1a's
   business, and anything that will still break at stage 3.

Be specific: file, line, the concrete state that fails. Say plainly where you are uncertain.
