# Footnotes stage 3: review the code, not the plan

You gave input on eleven decisions before this was written
([prompt](260828o-footnotes-stage345-upfront-prompt.md), [answer](260828o-footnotes-stage345-upfront-sol.md)). It is
now built and committed. This is the obligatory end-of-stage review.

## What to read

Three commits, in order:

    git show 158467c   # 3a-i: role, treatment, noteId on Block, and the persistence
    git show 01b55b2   # 3a-ii: the five predicates and the policy

Plus `docs/plans/260828o-footnotes.md` — the sections "Stage 3's input, measured before building it",
"GPT Sol's input before stages 3-5", "Stage 3a-i, as it actually landed" and "Stage 3a-ii, as it
actually landed", which record what I claim happened.

`drizzle/0027_block_roles.sql` **is applied** to the local database. `npm run typecheck` is clean
except for two errors in a peer's `tests/chat-reduce.test.ts`. The Postgres suites pass.

## What I want from you

**Find what is wrong.** You have found a real blocker in every round of this feature so far, each
time in code whose tests were entirely green. Assume the same is true here.

### 1. The `hashBlocks` legacy branch

`src/source-hash.ts`. Every block nullish on `role` and `treatment` gives the old `id TAB text`
algorithm byte for byte; otherwise a `spya-blocks/2` prefix with U+0000 between fields and U+0001
between blocks.

- Can the two branches ever **collide** - a classified article and an unclassified one hashing the
  same? Can a *legacy* pair of articles that hashed differently now hash the same, or vice versa?
- The branch is chosen by `blocks.some(b => b.role != null || b.treatment != null)`. What happens to
  an article whose classification is *dropped* - every block reverts to nullish - between two runs?
  Is "it went back to the legacy hash" correct, or a silent stale cache?
- Postgres `null` versus filesystem `undefined`: is the normalisation actually identical on both
  paths, or only in the tests written for it? Check the real store round trip.
- Three narrow queries were widened (`pg.ts`, `pg-searches.ts`, `import.ts`). **Is there a fourth
  feed into `hashBlocks` that still selects two columns?** Miss one and a second import creates a
  revision every time, for ever.

### 2. The predicates

`src/block-policy.ts`. Five predicates, two of which deliberately are not `gistable && body`.

- Is each applied at **every** consumer, or is a site still reading `block.gistable` directly that
  should now ask a predicate? Enumerate what is left and say for each whether it is correct.
- `isSearchable` includes supplements. Trace both search paths - `library-search.ts` in TypeScript
  and the SQL in `pg-shelf.ts` - and confirm they genuinely agree. They are supposed to be one rule.
- `countsTowardReadingTime` is body-only regardless of `gistable`. Does that change any number a
  reader sees other than the two intended ones?

### 3. The automatic/asked split

`isBodyEvidence` is applied at the call site in `arc`, `tweets`, `glossary`, `ideas` and inside
`summarise.ts`'s `textOf`, and **not** in `explain`, `search`, `converse`.

- Is that partition right and complete? Name any automatic model call that still sees supplements,
  and any asked one that no longer does.
- `ideas.ts` now passes a filtered array to `articleWithIds` while `explain`/`search`/`converse`
  pass the full one. Does that break a **prompt-cache** assumption? See `src/models.ts` and
  `docs/project/prompt-caching.md`.
- `textOf` filters, but the *root node's range* still ends at the last note. Is there anywhere else
  that slices `blocks` over a node range and would therefore include apparatus?

### 4. The word count

`articleWordCounts`, reached from `library-scalars.ts`, `web/stats.ts`, `tweets.ts`, `ideas.ts`,
`glossary.ts` and `pg.ts`'s `scalarInputsQuery`.

- `scalarInputsQuery` gained a second `array_agg` for `treatment` beside the one for `words`. **Are
  the two guaranteed to be in the same order?** If they can diverge, the shelf pairs one block's
  words with another's treatment, and the wrong number is stable and plausible.
- The plan claims already-published articles' cached `word_count` cannot be recomputed, because
  their stored blocks carry no `treatment` and an unclassified block correctly reads as body. True,
  or is there a cheaper repair I have talked myself out of?
- Is there still a word count or reading time anywhere that does not go through the seam?

### 5. The tests

- Which of the new tests would **still pass** if the thing it names were broken? Be specific.
- `tests/source-hash-roles.test.ts` pins a legacy hash as a hex literal. Is that literal actually
  the pre-change value, or was it captured after the change and therefore proves nothing?
- The three "a footnote is searchable" assertions are the only guard on `isSearchable` differing
  from the other four. Is three enough, and are they in the right places?
- Name a mutation I have not run that would survive the whole suite.

### 6. Anything else

In particular: anything in the two commits that is **worse than what it replaced**, and anything the
plan claims that the code does not do.

Be concrete, quote `file:line`, and say what you would change. Where something is fine, one line.
