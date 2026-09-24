# Plan review: the PDF transcriber writes maths as TeX

You are reviewing a **plan**, read-only, before it is built. Repo: spideryarn2 (the product is
Spideryarn). Read `CLAUDE.md` once for the house rules.

## The candidate (live, pre-commit)

- Base commit: `3ddb24dc` (HEAD of branch `worktree-feedback-suggestions-0924`).
- The plan: `docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md` (untracked — the only file
  under review). Other agents are editing other files in this tree; ignore them.
- Its parent, which holds the requirements:
  `docs/plans/260912d-render-latex-equations-in-the-reading-view.md` § "What the reproduction found"
  and § "Stage 2, deferred", and the parent's plan review `docs/plans/260912d-plan-review-sol.md`
  findings F1, F7, F9 — read those first.
- The code the plan changes: `src/pdf-score.ts` (the check: `fold`, `tokens`, `protect`,
  `protectedOf`, `MARKUP`, `scorePage`, `thinPages`, `check`), `src/pdf-read.ts` (`SYSTEM`,
  `PROMPT_VERSION`, `promptFingerprint`, the phase-1 attempt loop and `keepChunk` around the
  `for (let attempt = 1; ; attempt++)` loop, phase 2's fold, `withoutRepeats`, `wordsOf`,
  `isContextPage`), `src/pdf-integrity.ts` (`structuralIssues`, `lexicalWords`), and the stage-1
  renderer's span rules in `src/maths-tex.ts` (`findMathSpans`), which will draw what this produces.
- Existing tests: `tests/pdf-score.test.ts`, `tests/pdf-read.test.ts`.

## What to do

Attack the plan independently first. In particular: can a TeX maths chunk still fail its content
check or escape checkpointing by some path the plan does not cover? Does the comparison form open a
hole in the check — a way for a model to hide an omission, an invented number, or markup inside
`\(…\)` that the current check would have caught? Is anything in F1/F7/F9 unmet? Does anything
downstream of the records (rendering to HTML, dedup, integrity, title, front matter) break on TeX?
Is the measurement plan sufficient to decide "materially below baseline"?

## Severity scale and refusals

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1 (direct evidence, no unresolved material inference);
otherwise label the finding **reasoned**. Give each finding a stable ID starting at **G1** (the F
series belongs to the parent). For each: severity, established/reasoned, the evidence (file:line),
and the change you would make to the plan. End with a one-line verdict.

## My own suspicions (already mine; worth less — spend most of the run elsewhere)

1. Hiding content inside a span: a model could put a sentence of prose in `\text{…}` inside `\(…\)`;
   the comparison form keeps it, so recall still sees it — but does keeping `\text{}` open any
   precision or invention hole?
2. `protect` on the comparison form: `x_{1}` → `x1`; is `x1` reliably in `protectedOf(page)` when
   pdf.js splits `x` and `1`? And `10^{-3}`?
3. `lexicalWords` in `pdf-integrity.ts` counts `frac`/`sum` as words on raw text; a page whose only
   output is TeX commands could pass the three-word presence floor. Apply the form there too?
4. The phase-2 fold and `bibliographyPages` read raw text.
