# Plan review: 261004f, Glossary's Find more adds to a list an older prompt wrote

You are reviewing a **plan**, read-only. Nothing is built yet. Do not change any file.

## The candidate

- Base: commit a4f99dbb8a829beab5c5104089f4ba1dcac456fe (this worktree's HEAD).
- Untracked file, the plan itself: `docs/plans/261004f-glossary-find-more-always-adds-across-prompt-versions.md`.
- It describes changes to: `src/glossary.ts` (`existingFor`, `panelRunKind`, `buildGlossary`),
  `src/web/GlossaryPanel.tsx` (`MoreRow`), `src/web/help/help-modes.tsx`, `docs/project/glossary.md`,
  `docs/project/reader-profile.md`, and tests. That list is where to start, not a limit.

## Context

Greg (the product owner, an admin) filed: "In glossary, there's a find terms again button. I don't
know what that does. I want a find more button that finds a bunch more." The previous plan is
`docs/plans/261003c-glossary-find-more-at-the-top-and-metadata-press-closes.md`. The contract being
changed is documented at length on `existingFor` in `src/glossary.ts` and in
`docs/project/glossary.md` (§ The run row; § What this replaced, and how old glossaries behave;
§ There was a Start again beside it). The precedent is `src/quotes.ts` § `existingFor` and
`buildQuotes` (append across versions under the older stamp, 2026-09-11, reversed 2026-09-24).

## What to do

Independent pass first. Attack the plan: is any claim in it false against the code? What breaks,
for whom, that it does not name? Is there a simpler version that gives Greg what he asked for?
Trace the real code paths rather than trusting the plan's or a comment's account of them.

Grade by consequence: **P0** data loss, security, wrong charging, service unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or
maintainability risk; **P3** prose. Give every finding an ID (F1, F2, …), a file:line, and say
whether it is *established* (direct evidence) or *reasoned*. End with a one-line verdict:
`VERDICT: build as planned` / `VERDICT: build with changes` / `VERDICT: do not build`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

1. The plan claims no client or server path posts an **unforced** glossary job against an existing
   list (so the kept older stamp cannot cause repeated appends). Check `src/web/useGlossary.ts`,
   `src/web/useAutoRun.ts`, `src/rerun-steps.ts`, `src/web/rerun-commands.ts`, `src/web/Metadata.tsx`,
   `src/routes.ts`, `src/jobs.ts`, `src/pipeline.ts`.
2. Does anything else read `glossary.version` or `outdated` and now behave wrongly on a list that
   stays outdated for ever while growing (the read path in `src/store/pg.ts`, export, public read,
   `sameStamp`, rewrite-hold, the offline copy)?
3. `dedupe`/`merge` between a glossary/4 entry and a glossary/9 entry: any field whose meaning
   changed between `glossary/2` and `glossary/9` so that a merged list is wrong, not merely uneven?
4. Is "Write a new list" plus one visible sentence right for the remaining rewrite cases, and is
   the sentence true in each (stale; profile changed; profile cleared; glossary/1)?
