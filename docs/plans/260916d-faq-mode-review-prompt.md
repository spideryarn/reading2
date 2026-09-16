# GPT Sol plan review — FAQ mode (260916d)

You are reviewing a PLAN, before any code is written. Read-only: do not change any file.

## The candidate

- Commit `b5539705` in this repository; the file is `docs/plans/260916d-faq-mode.md`.
- Nothing else has changed. Start there; it does not limit what you may read.

## Context

Spideryarn is an AI-assisted reading app whose stance is *augment reading, don't replace it*
(`docs/project/vision.md`). An admin asked, verbatim: "Add FAQ (frequently asked questions) mode as a
new experimental features mode." The plan defines what an FAQ should be here and how it is built.

Reference material the plan leans on:
- `docs/project/new-mode.md` — the checklist for adding a mode (client totals, artefact totals, the
  residue nothing checks).
- `src/ideas.ts` — the closest existing stage: model names block ids + verbatim quotes, verified by
  `findQuote`, drop-and-count, id inheritance, reading order, replace-on-rerun.
- Citations mode, the most recently added artefact mode: commits `85631f9b` (stage 1, server) and
  `abde65f7` (stage 2, client); `docs/project/citations.md`.
- `docs/project/quiz.md`, `docs/project/ideas.md`, `docs/project/experimental-features.md`.

## What to do

An independent pass first. Attack the plan on:

1. **Product**: is this definition of an FAQ right for the vision? Will it degrade into a summary in
   question form, or into Quiz/Ideas/Chat duplicates? Is the verification promise honest?
2. **The one product call** (§ The one product call made here): a collapsed model-written short
   answer, against Fable's recommendation of no written answer at all. Which is right for v1, and
   why? If the answer stays, is "may not say anything the passages do not support" enforceable, or
   only requested — and does that matter?
3. **Engineering**: anything in the stage list that is missing, wrongly ordered, or copies a
   precedent that doesn't fit (e.g. Ideas' `articleWithIds` + model-named ids vs Quotes' `locate`
   over all blocks; the `unsettled` status; id inheritance keyed on question text; the cache group
   and `STEP_ORDER` position; freshness hash inputs; owner-only; `NO_FOUND`).
4. Anything that would make stage 1 or 2 not end in a safe, committable state.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, the evidence (file and line where it applies), and
a concrete recommended change to the plan. End with a one-line verdict: approve / approve with
changes / rework.

## My own suspicions (already mine, worth less — spend most of the run elsewhere)

- Whether `unsettled` anchored to "nearest passages" invites the model to attach irrelevant passages
  just to survive the drop rule.
- Whether 4–12 questions at one per 600 words is the wrong density.
- Whether ids should be inherited at all in v1, given there is no `?faq=` param yet to break.
