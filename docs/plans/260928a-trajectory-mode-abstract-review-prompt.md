# Code review — leave the Abstract out of the Trajectory route (plan 260928a)

Reviewer and fixer, narrowly. Candidate: commit `f42ce55e` on branch
`worktree-trajectory-flash-position-0928` — its Abstract half (`src/trajectory.ts`
`isAbstractTitle` / `inAbstract` and the system-prompt sentence, `src/section-path.ts`
`sectionNodesOf`, `src/store/pg.ts` and `src/types.ts` for `notOnRoute`, the tests). The CSS/token
half (bigger ‹ ›) is out of scope. Greg: "prefer not to include the Abstract as part of a
trajectory, since that's kinda obviously already a good place to get the gist, and it's dense."

Attack:

1. The rule: false positives (a body section called "Abstract algebra", "Summary of results" in the
   middle, a "Summary" that is the paper's conclusion) and misses (an untitled abstract; "Abstract"
   under Front Matter; numbering variants; non-English). Is "summary only in the first top-level
   section" safe for essays/articles where the first section is the introduction called "Summary"?
2. The hash and freshness: excluded quotes leave `trajectoryInputHash`; do write path, stored
   `sourceHash` and read path in `pg.ts` agree in every case? Does a tree re-cut that moves the
   abstract boundary make routes stale (acceptable) or crash?
3. `notOnRoute` excluding abstract quotes: consistent with the band's "N quotes not on the route"
   copy and the coverage note at Most ("every one of the article's N quotes" — does N now include
   abstract quotes it can never reach?).
4. A paper whose only quotes are abstract ones: the refusal message says there are no quotes, which
   is misleading — worth a precise message? Fix if small.
5. The prompt sentence: plain words, and does it risk the model avoiding *other* opening material?

Run `npx vitest run tests/trajectory.test.ts tests/trajectory-panel.test.tsx` and
`node --import tsx scripts/typecheck.ts`. `tests/trajectory-freshness-pg.test.ts` needs Postgres:
reason about it; I will run it. Fix inside this change, red-first; report anything wider. Do not
commit. Severity P0–P3; IDs from **F80**. Verdict: accept / accept after fixes / reject.
