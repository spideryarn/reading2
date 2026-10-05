# Plan review: Remember becomes Learn, and Explore also covers critiques

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

- The plan: `docs/plans/261005l-remember-becomes-learn-and-explore-covers-critiques.md`, committed
  on this worktree's branch (the commit that adds this prompt file). Nothing else has changed from
  `origin/dev`.
- It answers a report from Greg (the product's owner), quoted at the top of the plan. His words are
  the requirement.

## What to read

Start with the plan. Then, as far as you need, and this does not limit scope:

- `docs/project/remember-mode.md` (§ Explore, the fourth sub-mode; § It is about the author first),
  `docs/project/remembering-vision.md`, `docs/project/mode.md` (§ Retiring a mode),
  `docs/reusable/rename-or-move.md`, `docs/project/prompting-guide.md` (§ Measuring a prompt change)
- `src/modes.ts` (`MODES`, `RETIRED_MODES`, `modeFromParam`), `src/title-text.ts` (`MODE_LABEL`),
  `src/mode-catalog.ts` (`remember`), `src/web/sub-modes.ts`, `src/web/command-match.ts` or
  wherever the command bar ranks labels and aliases, `src/web/help/help-anchors.ts`,
  `src/feedback-payload.ts`
- `src/converse.ts` § `EXPLORE_SYSTEM` (and the shared sections it interpolates),
  `src/web/ChatPanel.tsx` § `EXPLORE_STARTERS`, `ExploreInvitation`
- `evals/remember-explore.ts` (the readers, the judge, T1–T9)
- The earlier rename this one is modelled on and departs from:
  `docs/plans/261001r-trajectory-becomes-skim-and-marginalia-rename-audit.md`

## What I want from you

An independent attack on the plan first. In particular:

1. Does the plan deliver what Greg asked, no more and no less? Is anything he said missed, or
   anything built that he did not ask for?
2. Is "words change, identifiers do not" a sound line for stage 1, and is the deferral of the
   identifier rename justified by what is actually in the tree? Check the counts and the three
   claims (three vocabularies share the word; `?remember=` is remembered by browsers; the thread
   kind is stored data). If the full rename is in fact cheap, say so.
3. Find reader-facing or model-facing places that name the mode and are **not** in § Inventory.
   The sweep that produced it did not read every line of the largest files.
4. Is anything in "Stays, because it is the verb" wrong, i.e. a reader would read it as the
   mode's old name?
5. `learn: "remember"` in `RETIRED_MODES`: what else reads that map, and does a non-retired word
   in it break or mislead any of them (the Help anchors, the feedback payload, `settleAddress`,
   tests that walk the map)? Is it worth having at all?
6. Removing `learn` from the catalogue's aliases and adding `remember`: does the command bar's
   ranking still find the mode for both words, and for "remember quiz"?
7. Stage 2's prompt design: does the fifth move contradict anything already in `EXPLORE_SYSTEM`
   or the sections it interpolates (NO VERDICTS, "never put a conclusion inside a question", the
   origins rule, the plain-words rule's "never make it say more than it does", the length rule)?
   Will a model given these rules produce a fair, cited, one-at-a-time critique, or will it
   hedge, or turn every turn into fault-finding? What rule is missing?
8. The measurement: are C1–C5 decided tightly enough to fail? Is one `critic` reader per article
   enough? Is anything in it a check that cannot go red?
9. Does Explore's wider remit collide with Debate mode or with Tutorial's prompt (which today
   points a reader's own line of thought to Chat)?

## Severity and verdict

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence if the plan were built as written. Give every finding a stable ID (`PR-1`,
`PR-2`, …), the evidence (file and line, or the command you ran), and what you would do instead.
Say for each whether it is **established** (direct evidence) or **reasoned**.

End with one line: `VERDICT: build as planned` or `VERDICT: build with changes` or
`VERDICT: do not build`, and refuse only on an established P0 or P1.

## My own suspicions, last, and worth less

- I am least sure of item 4 (the thread title *Remembering*) and item 5.
- I suspect C4's "at most 1 in 5 unasked" has no instrument: the existing judge has no `critique`
  label.
