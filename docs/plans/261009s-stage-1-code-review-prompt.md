# Code review, Stage 1 of 261009s: Peer review → Sources (the mode word)

You are a reviewer **and fixer**, write-capable in the worktree. Candidate: commit
`68d9ed837` (one commit; `git show --stat 68d9ed837` lists the 132 paths, seven of them renames).
Plan: `docs/plans/261009s-peer-review-becomes-sources-all-the-way-down.md` (§ The names, § "Source"
already means other things, § Old links still land, § Stage 1, and § After GPT Sol's plan review, F7).

## What the stage is

The reading mode "Peer review" (mode word `peer-review`) is renamed "Sources" (`sources`), Greg's
answer to a naming question: *"B Sources. Rename comprehensively, eg including docs, code, database
etc"*. This stage covers the label, the mode word, `?sources=`, `chatfrom=sources`, identifiers,
files, help page, docs. The stored step names `citations` / `debate` / `debate-claims` are **out of
scope** (Stages 2–3) and must be untouched.

## What to do

An independent attack first:

1. **Old links.** `?mode=peer-review` (+`&peer-review=X`), `?mode=citations`, `?mode=debate`
   (+`&debate=claims`, `&debateby=claim`), `chatfrom=peer-review|citations|debate`, a restored last
   view holding any of those, and `/help/mode-peer-review|citations|debate` must all land on the
   right Sources view. Trace `liftLegacySources` (src/web/router.ts) through `settleAddress`,
   `liftedLegacyHref`, `liftedLegacySearch` / last-view `restoredHref`, and the precedence when
   several words are present. Anything else that reads a mode word from outside: the Dock
   (`modeInSearch`), `readMode` (tab titles of shared links), feedback payload normalisation,
   `title-text.ts`, help routing, the command bar.
2. **Anything still named for Peer review** that is the mode (not Referee's "peer reviewer", not
   history, not a retired alias or a lift): `git grep -n -i -E 'peer.?review'` outside
   `docs/plans docs/postmortems docs/user-feedback docs/research docs/investigations docs/tutorials
   evals/results`.
3. **Collateral damage**: a rename that hit something that is not the mode (any "source" meaning;
   Referee's words; a plan file name inside a path); comments made false by the rename; the
   catalogue alias change (Referee `peer reviewer` → `for peer reviewers`, and Sources gaining
   `peer review` — see the comment in src/mode-catalog.ts and tests/command-match-mode-aliases.test.ts).
4. **Docs**: docs/project/sources.md and the signposts (AGENTS.md, reading-view-overview.md,
   mode.md) — accurate against the code?

Fix what is inside this stage, narrowly, red-first where it is behaviour (write the failing test,
see it fail, fix). Report, do not fix, anything wider. Tests you can run: any vitest file that needs
no network or Postgres (`npx vitest run <file>`); `npm run typecheck`. Do not commit; do not run git
commands that discard work (checkout --, restore, stash, reset, clean).

## Severity and output

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

First line: `LAND`, `LAND AFTER FIXES` (you fixed everything blocking), or `DO NOT LAND`. Then
findings C1, C2, … most severe first, each with evidence, and whether you fixed it (list the files
you changed) or are reporting it.

## My suspicions (worth less; spend most of the run elsewhere)

- The builder did the identifier rename as one scripted pass and then reviewed comments by hand;
  a scripted pass is where a comment becomes subtly false ("Sources' Reception, which …" where the
  sentence was about the name).
- `src/web/auto-modes.ts` built a possessive `${label}’s`; it now writes `’` alone for every label?
  Check that it did not change the output for other modes ending in a non-s letter.
