# Review: sixth sweep cluster S2 — false comments, and three tutorial banners

## The candidate

- Your working directory is the cluster's own git worktree. The candidate is the single commit
  `3a8df257a` on this branch: `git show --stat 3a8df257a`, `git diff 3a8df257a~1 3a8df257a`.
  110 files.
- The plan: `docs/plans/261006j-sixth-codebase-sweep-umbrella.md` § S2 and § "What the review
  changed" (U2, U10). The builder's record: `docs/plans/261006j-sixth-sweep-s2-false-comments.md`.

## What it is meant to do

Rewrite comments that state something false about today's tree (the deleted filesystem store, the
removed gist columns, "Hierarchy" as the current name of Structure, `styles.css § …` pointers into
a stylesheet that is now only `@import`s, dead repo paths in config files) so they are true, and
add one dated banner to each of three stale tutorials. **No line of behaviour may change.**

## What you can run, and what you may change

No network, no database. You may run `node --import tsx scripts/typecheck.ts` and database-free
test files. **You may fix what you find inside this commit's files, comments only.** Do not commit.
Report anything wider.

## Attack it

1. **Prove independently that no non-comment line changed.** Do not trust the builder's
   strip-and-compare script; make your own check (e.g. for each changed `.ts`/`.tsx`, compare the
   TypeScript token stream or a comment-stripped transpile of the two versions; for `.css`, compare
   with comments removed; for `.sh`, `.toml`, `.tf`, `.env.example`, `.html`, read every changed
   line). Name every file where something other than a comment changed. One is declared:
   `infra/hetzner/provision.sh` changes a `#` comment line that the script writes into a generated
   ssh config — check nothing greps or parses that line.
2. **Is each new comment TRUE?** A false comment replaced by a differently false one is worse than
   the original, because it now looks checked. Sample at least 30 of the rewritten comments across
   the categories and check each against the code it describes: for a `styles.css §` pointer, that
   the named file under `src/web/styles/` really holds that section or rule; for a store comment,
   that what it now says about Postgres/Supabase is what the code does; for `src/types.ts`, that
   the stated reason a field is optional today is real. List every one that is wrong or
   unverifiable, with the true statement.
3. **Did it destroy history worth keeping?** A comment that recorded *why* something is shaped the
   way it is, now reduced to nothing.
4. The three tutorial banners: accurate, dated, and pointing at a doc that exists?
5. The builder's "Left, for you to place" list in its plan doc names possible dead code
   (`FeedbackDialog.tsx`'s 501 branch and `FEEDBACK_NOT_AVAILABLE`; `writeRawFiles` in
   `src/fetch.ts`; `schema === undefined` in `src/vercel-health.ts`). Do NOT fix these; say for each
   whether the claim holds, with the grep.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Then
findings with ids (C1, …), severity P0–P3, `file:line`, reproduced or reasoned, fixed or reported.
State how many comments you sampled and how many were wrong. Under 900 words.
