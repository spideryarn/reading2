# Review requested: Cluster E, the shelf's Shared badge

**Date:** 2026-09-02. **Asked of:** GPT Sol. **Mode:** read-only — do not edit files, do not run
state-changing git commands.

This is a small, self-contained stage of
[260902j-public-read-only-access-audit-and-improvements.md](260902j-public-read-only-access-audit-and-improvements.md)
— **Cluster E**, Tier 2. Read that section of the plan and its Progress entry for this stage. It is
independent of the C3 work you reviewed in
[-stage1b-review-sol.md](260902j-public-read-only-stage1b-review-sol.md); your two blockers there are
being fixed separately and are not in this diff.

## What to read

Worktree `.claude/worktrees/public-read-improvements`, branch
`worktree-public-read-improvements`. One commit:

    git show e742081
    git show e742081 --stat

## What it is

An owner looking at their shelf can now see which of their articles are world-readable: a globe and
the word *Shared* on the card's meta line and in the table's title cell, from one `SharedBadge`
component used in both. A private article gets **nothing** — no "Private" badge. **A badge, not a
filter**: no sorting, no narrowing, no count, deliberately, until there is enough shared material
for it to be worth anything. That last part is Greg's decision and is not up for review; everything
else is.

## Attack, specifically

1. **`LibraryEntry.visibility` is present only when it is `"public"`, absent otherwise**
   (`src/types.ts:1313`, `src/api.ts:1199`). The argument is that absence is the only answer *both*
   stores can give — the filesystem store has no visibility column and `visibilityStore.set` refuses
   there with a 501 — and `tests/store-parity.test.ts` compares whole entries, so a `"private"` from
   one store and an absence from the other would be a parity failure about nothing.

   Two things to attack. Is the argument sound, or is there a case where an absence and a private
   article need to be told apart on the shelf? And **should the type be `visibility?: "public"`
   rather than `visibility?: Visibility`** — the house rule is *let the types catch it*, and the
   narrower type would make the invariant a compile error at the projection rather than a convention
   the comment states. I left it as `Visibility` and I am not sure that was right. Say which, and why.

2. **The `store-parity` exclusion** (`tests/store-parity.test.ts:752`). The field is dropped from the
   comparison, with a comment saying this exclusion is *weaker* than the four already there — those
   are two clocks and a live writer, this is a column one store cannot hold. Is dropping it right,
   or does it hide something? Is there a version of that test that keeps the coverage — comparing
   the field only where both stores could answer, say — that would be worth the complication?

3. **The cast** at `src/store/pg.ts:1998`: `row.article.visibility as Visibility`, on the argument
   that a `text` column with a CHECK constraint (`articles_visibility`, `drizzle/0024`) is a
   two-member union TypeScript cannot see. `articleMetadata` in the same file already does this.
   Is the cast honest, and is there a cheaper way to make it unnecessary?

4. **Is anything else on the shelf now wrong?** The badge is drawn in two renderers
   (`src/web/ShelfEntry.tsx:170` and `src/web/library-columns.tsx:289`). In the table it is placed
   **first** on the sub-line because that line truncates. Check both for layout or truncation
   consequences, and check that nothing else reads `LibraryEntry` in a way the new optional key
   disturbs — a `Required<LibraryEntry>` fixture, a whole-entry comparison, a serialiser.

5. **What would still pass if the feature were broken?** Four mutations were run and killed: a
   `"private"` in the pg projection; `describeArticle` always emitting; and both renderers' guards
   flipped in each direction, one of which proves the *private-row* assertion is load-bearing rather
   than decorative. Name one that survives.

6. **The doc**, `docs/project/library.md` § The Shared badge. Does it claim anything the code does
   not do?

## Evidence

- `npx vitest run tests/shelf-shared-badge.test.tsx tests/store-shelf-pg.test.ts tests/library.test.ts`
  — 41 passed. A wider shelf/library set was green in the building agent's own run.
- `npx tsc -p tsconfig.json --noEmit` clean; `npx biome check` clean on every touched file.
- A browser pass on this box (Playwright, system Chrome, this worktree's own dev server) shared a
  real local article **through the sharing card rather than through SQL**, saw the badge on the card
  and in the table with nothing on the neighbours, and unshared it again; two rows were appended to
  the local `article_visibility_changes`, which is append-only by design.
- `tests/store-parity.test.ts` itself was **not** run (slow, and it depends on `data/` matching the
  database). Say if that matters more than I think.

`file:line`, how you know, ranked. Under ~900 words — this is a small stage and I do not want it
padded. End with a verdict: BLOCKED with the blockers named, or landed-and-fine with the changes you
want.
