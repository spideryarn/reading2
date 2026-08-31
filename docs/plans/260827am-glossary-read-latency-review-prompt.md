# Review this plan before it is built

You are reviewing a plan for the Spideryarn repo (an AI-assisted reading app: TypeScript + ESM,
React client, Node server on Vercel, Postgres via Drizzle on Supabase). Read-only review — do not
edit files. Be concrete, rank findings by how much damage they would do, and mark each
must-fix / should-fix / note. End with a one-line verdict: ready to build, or not.

## The plan

Read `docs/plans/260827am-glossary-read-latency.md` in full. That is the thing under review.

The ask, from the product owner, was a question rather than a feature: *"Why does 'Looking for a
glossary' take so long (when one already exists)?"* The plan is the diagnosis and the fix.

## Context you will need

- `src/store/pg.ts` — `currentRevision` (line ~238), `blocksFor` (~258), and the four artefact
  reads `loadTweets` / `loadGlossary` / `loadSummaries` / `loadIdeas` (~739–851). Note that all
  four fetch every block row and reduce it to one hash, and that `blocksFor` re-runs
  `sanitizeStoredBlocks` unconditionally because there is no stamp column.
- `src/db/schema.ts` — `articleRevisions` (~226) and `revisionBlocks` (~494). Note
  `extracted_html` / `stamped_html` on the revision, and the generated `fts` tsvector whose own
  comment says it is "never selected".
- `tests/store-revision-columns.test.ts` — the existing guard, its header explaining why it
  asserts "and nothing else is missing", and why the plan proposes to change its shape.
- `src/web/useGlossary.ts` — the two hooks. `useGlossaryTerms` (the prose underlines, one GET, no
  poller) and `useGlossary` (the band: same GET again, plus `useJobs`, plus the three verbs).
  Read both docstrings; they argue for the split the plan is partly undoing.
- `src/web/App.tsx` — `Reader`'s `useGlossaryTerms` call (~727), the `term` state and why it is
  held there (~730–750), and `GlossaryBand` (~1832) with its `onEntries` / `onSelected` push-up
  seam and the `status`-keyed effect at ~1885 that a previous review of yours fixed.
- `src/web/GlossaryPanel.tsx` — what the panel renders from each field, including the three
  "this list no longer describes the article / the reader" sentences.
- `src/routes.ts` § `withProfileChanged` (~2224) and the glossary GET (~2933).
- `src/source-hash.ts` § `hashBlocks` — `id` and `text` only.
- `src/api.ts` § `loadGlossary` (~305) — the filesystem half, which the parity tests hold the
  Postgres half against.
- `docs/reusable/silent-success.md` — the failure pattern this codebase cares most about.

## What I most want you to attack

1. **Is the diagnosis right, and is it complete?** The plan claims the wait is one GET, made
   twice, each pulling ~1 MB to return 10 KB. Check that against the code. Is there a *sixth*
   cost I have missed — connection setup per invocation, `resolveProfile`'s own queries, the
   `guardDbStore` wrapper, Drizzle's row decoding, a cold-start import of jsdom? Which of the five
   I list actually dominates on Vercel→Supabase, as opposed to on a laptop? If my ordering is
   wrong, say so: I would rather build the one that matters.
2. **Narrowing `currentRevision`.** I claim `extracted_html` and `stamped_html` are never read
   through it. Verify that independently — including `pg-revisions.ts` carry-forward,
   `store/export.ts`, `store/import.ts`, `pg-admin.ts`, and anything reached via
   `articleMetadata`. What breaks if I am wrong, and would it break *loudly*? Should the other
   big JSONB columns (`tree`, `labels`, `ideas`, `summary`, `tweets`) be per-read too, or is that
   a worse trade than one shared narrow set?
3. **Skipping the sanitiser on the hash-only read.** My argument is "no HTML on this path, so
   nothing to clean". Is that actually safe? Does anything downstream of `hashBlocks` in those
   four reads touch a field the narrow select would not have? And — the one that worries me —
   does `sanitizeStoredBlocks` ever mutate `text`, such that a hash over unsanitised `text`
   differs from the hash the filesystem store computes over sanitised blocks? If those two hashes
   can diverge, the two stores start disagreeing about `stale`, which is precisely what the parity
   tests exist to catch and precisely the kind of thing that looks fine until it doesn't. Check
   `src/sanitize.ts`.
4. **The client refactor.** Merging the two hooks moves the fetch up to `Reader` permanently.
   Walk the state transitions and tell me where it breaks: a `reset()` (DELETE then regenerate)
   while the prose is underlined from the old list; a job finishing in another tab; switching
   articles while a request is in flight; the band unmounting mid-request; two `?term=` setters on
   one parameter. The `pushed` ref and the `live` flag both exist because of specific ordering
   bugs found in review — does removing the second copy genuinely remove the need for them, or am
   I removing the guard and keeping the hazard?
5. **Is one-fetch-in-`Reader` the right shape at all?** The alternative is to keep the split and
   add a proper read cache (SWR-style, or just a module-level promise map keyed by URL), which
   would also fix the summaries and ideas panels, which presumably have the same duplication. Say
   which you would build. I have talked myself into the refactor because it deletes a seam rather
   than adding a layer, but I am not confident.
6. **The test changes.** Part 3 rewrites `store-revision-columns.test.ts` from "everything except
   rawBytes" to "selected ∪ omitted = all". Is that still a real guard, or have I weakened it into
   a tautology that any future change can satisfy by adding a name to a list? If weakened, what
   would hold the line better?
7. **The checking plan (§ How each part is checked).** Each item is supposed to be run against the
   broken state first. Which of the six could pass while the thing it claims to check is broken?
   In particular #1 and #2, which stub `fetch` — a counted request is not the same as a request
   that mattered.
8. **Scope.** I have deliberately excluded the sanitiser-stamp column and `listArticles`, and said
   why. Is `listArticles` in fact so much bigger a win that this change is the wrong one to make
   first? And is there anything I have excluded that is actually load-bearing for the fix?
9. **What the plan does not mention at all.**

Quote file and line where you can. Where you think a number in the plan is wrong, say what you
would measure instead.
