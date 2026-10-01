Verdict: **not ready**. No P0s; three P1 invariant violations remain.

1. **P1 — unresolved: block-of-k still drops an address-less author.**  
   At [src/pdf-authors.ts:182](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:182):

   ```text
   bylineText:
   Alice Adams Acme University Bob Brown alice@acme.edu

   answer:
   Alice Adams — ["Acme University Bob Brown"]
   ```

   This stores Alice alone. The model-labelled affiliation consumes Bob, while Alice’s one address satisfies the one-author block count. The plan names this limitation, but it contradicts the stated invariant. A safe solution needs independent layout evidence or conservative refusal of affiliation-bearing gaps.

2. **P1 — unresolved: marked trailing affiliations can consume a real author.**  
   The fallback at [src/pdf-authors.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:208) accepts both:

   ```text
   Alice Adams1 1 Bob Brown
   Alice → ["Bob Brown"]
   ```

   ```text
   Alice Adams3 3M Company
   Alice → ["M Company"]
   ```

   Both store Alice and silently drop the trailing author. A marker is not independent proof that following words are an affiliation. The safe local fix is to remove this exception and refuse non-glue trailing text; I did not make that product-level regression during review.

3. **P1 — unresolved: lowercase fused email tails remain silent drops.**  
   [EMAIL at src/pdf-authors.ts:109](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:109) recognizes `alice@acme.edubob` as an address, so:

   ```text
   Alice Adams Acme University alice@acme.edubob
   Alice → ["Acme University"]
   ```

   is accepted despite the fused `bob`. Uppercase fused tails are refused, but lowercase ones are not. This is documented in the plan, but again conflicts with the invariant.

4. **P1 — fixed: an email word could be stored as an author.**  
   Before the fix, `carol` from `carol@beta.edu` could replace Bob Brown, and the two email spans were counted across separate gaps. I added a failing regression first, then made `findName` skip email-contained words while continuing to seek later genuine occurrences: [implementation](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:329), [test](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/tests/pdf-authors.test.ts:209).

5. **P1 — fixed: affiliation failure could turn the address-less-author bug into names-only output.**  
   A later failing affiliation previously returned `names: ["Alice Adams", "Carol Clark"]` while dropping Bob. I added the failing test first, then made names-only refuse whenever author separation depended on affiliation/email gap accounting: [implementation](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/src/pdf-authors.ts:430), [test](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/tests/pdf-authors.test.ts:298).

6. **P2 — fixed: the eval reported zero while finding 4 was live.**  
   Generic deletion never substitutes a mailbox word as an author. I first added a gate that failed at 29 rather than 30 mutations, then added an explicit real Attention-row adversary. The eval now exercises 739 negatives: [scorer](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/evals/pdf/bylines-score.ts:88), [gate](/home/greg/code/spideryarn2/.claude/worktrees/pdf-stacked-bylines/tests/pdf-bylines-eval.test.ts:91). Its zero remains a corpus score, not proof of the invariant.

No separate defect appeared in `blockStart`, shared-affiliation one-use accounting, or newline-split braced addresses. The email regex showed no catastrophic-backtracking issue; its lookbehind, braced count, and spacing rules behaved as intended.

Checks:

- Requested Vitest pair: **57 passed**
- Eval: **26 list, 1 names-only, 12 refused; 0/739 sampled drops**
- Typecheck: **passed**
- `git diff --check`: **passed**
- Targeted lint: no errors; existing complexity advisory for `gapIsNobody`
- Full `npm test`: could not start the database-backed lane because local Postgres/Docker was unavailable
- Exact `npx tsx` wrappers hit sandbox IPC `EPERM`; equivalent `node --import tsx` runs passed

No commit was made. The pre-existing untracked review prompt was untouched.

**not ready**