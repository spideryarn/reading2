# Review, round two: sixth sweep cluster S2 — the comments round one did not sample

## The candidate

- Your working directory is the cluster's own git worktree. The candidate is everything on this
  branch since `3a8df257a~1`: `git diff 3a8df257a~1 HEAD`. Two commits: the builder's
  (`3a8df257a`) and round one's fixes (the newest commit), **which are unreviewed code by someone
  else** — check those too.
- Round one's prompt and answer: `docs/plans/261006j-sixth-sweep-s2-code-review-prompt.md`,
  `docs/plans/261006j-sixth-sweep-s2-code-review-sol.md`. It sampled 50 rewritten comment blocks
  and found 6 false or stale. It proved by AST comparison that no non-comment code changed; you do
  not need to redo that except for the newest commit.

## What this round is for

A 12% miss rate in a sample of 50 leaves the unsampled rewrites untrusted. **Check every rewritten
comment that round one did not**, in this order of priority:

1. Every changed comment in a `.ts`/`.tsx` file that makes a claim about behaviour (the store, the
   database, types and why a field is optional, layout, modes, scrolling) — as opposed to a bare
   pointer.
2. The `styles.css §` pointer rewrites (82): for each, the named file under `src/web/styles/` must
   really contain the section heading or rule the pointer names. This is mechanical — script it:
   extract each new pointer's target file and section text from the diff and grep the target for
   it; list the ones that do not resolve.
3. The dead-path fixes in `supabase/config.toml`, `.env.example`, `infra/hetzner/*`, tests: each
   new path exists.

For each comment that is false, stale, or claims more than the code shows: fix it (comments only,
inside files this branch already changed), briefly and truthfully, keeping any historical reason
worth keeping. If you cannot establish the truth, make the comment say less rather than guess.

## What you can run, and what you may change

No network, no database. Comments only, in files this branch already touched. Do not commit. After
your edits, confirm with your AST/comment-stripped comparison that no non-comment code differs
between `3a8df257a~1` and the working tree.

## Format

Verdict line first: **ship**, **ship with these fixes (applied)**, or **do not ship**. Then: how
many comment blocks you checked in each of the three groups, how many were wrong, and each wrong
one as a finding (C9, C10, … continuing round one's numbering) with `file:line`, what was false,
and that you fixed it. Then the list of files you changed. Under 900 words. This is the last
discovery round for this cluster.
