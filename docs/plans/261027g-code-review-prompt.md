# Code review: the partial-renames sweep (261027g)

You are reviewing two commits in the Spideryarn repo (this worktree), both on top of `c3fb6d130`:

- `cb02b1eae` — Rename sweep, stage 1
- `a85a3a42e` — Rename sweep, stage 2

Read them with `git show --stat <sha>` and `git show <sha> -- <path>`. The list of changed paths is
`git diff --name-only c3fb6d130 a85a3a42e` (about 270 files). Start with the plan,
`docs/plans/261027g-partial-renames-swept-and-the-rename-policy.md` (uncommitted, in the tree): it
says what the sweep was for and lists every rename. The candidate is the two commits; that file is
context, and also a candidate for its claims.

## What the change is

Almost entirely comments, Markdown prose and test titles: old product names (Debate, Citations,
Investigate for Bibliography's Dig deeper, Tweets, Hierarchy/gist columns, Outline mode, the
tutorial, steer) replaced by today's (Reception / Claims, Bibliography, *Dig deeper*, Summary's
Thread view, Structure, Plain, Recall, profile). Plus a few strings: one CLI error message in
`src/fetch.ts`, `usedBy` labels on the internal /design page, two test Error messages, a test
fixture id `job-citations` → `job-bibliography`, fixture tree versions `hierarchy/4` → `toc/4`, one
test's not-contain label "Hierarchy" → "Structure", and ~19 comment paths to moved test files.
Several subagents made the edits; I verified samples, not every line.

## What I want from you, in order

1. **Wrong substitutions.** The commonest failure is a context error: "Debate" swapped for
   Reception where the comment is about Claims (or both), "Citations" swapped where it meant the
   citations themselves rather than the mode, "Investigate" swapped where it meant the current
   Sources › Investigate sub-mode (`InvestigatePanel`), a dated history sentence ("was X until …")
   rewritten so it is now false, or a quote of Greg altered. Read the code each changed comment
   describes for a sample across files — weight src/types.ts, src/routes.ts, src/messages.ts,
   src/store/pg.ts, src/public/dto.ts, src/web/reader/Reader.tsx, src/web/layout.ts and
   docs/project/reception.md, glossary.md, interface-vision.md.
2. **Anything that is not a comment and changed behaviour**: a string a test or the UI reads, an
   identifier, a fixture value an assertion depends on. `git diff c3fb6d130 a85a3a42e --word-diff`
   helps; look for changes outside `//`, `/* */`, JSDoc and Markdown.
3. **Repointed paths that point at the wrong file**: the ~19 "moved test file" comments — check
   the new target actually tests what the comment says.
4. **The plan doc's claims**: is the table right about which renames were complete in code? Is
   anything in § Follow-ups wrong about what is stored where?

**You may fix what you find**, inside these files and this scope — edit the working tree, do not
commit, do not run any git command that discards work (no checkout, restore, stash, reset). Do
not touch `src/pipeline.ts`, `src/db/schema.ts`, `src/profile.ts`, `src/store/pg-chat.ts`, any
`skim` path, AGENTS.md/CLAUDE.md, or docs/reusable/. Run `npm run typecheck` and the test files you
touch with `npx vitest run <file>`.

Severity: **S1** wrong behaviour or a false statement a future agent would act on; **S2** misleading
but harmless; **S3** style. Give every finding an ID (R1, R2 …), file:line, severity, what you did
(fixed / not fixed and why).

## My own suspicions (worth less; spend most of the run above)

- Stage 2's src/web + tests agent made ~300 edits; I read the fewest of its lines.
- `docs/project/interface-vision.md` ~:81 now reads "Claims' disputed claims".
- The sentence I'd least like to be wrong: the plan's claim that the code and database of every
  listed rename were complete apart from the named exceptions (Tweets, Investigate, Outline files).

End with a verdict line: `VERDICT: LAND`, `LAND AFTER FIXES` (you made them), or `DO NOT LAND`.
