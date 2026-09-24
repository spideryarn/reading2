# Code review: the PDF transcriber writes maths as TeX

You are reviewing **built code**, with write access, in the spideryarn2 repo. Read `CLAUDE.md` once.

## The candidate (live, pre-commit — nothing is committed)

Base commit `3ddb24dc`. **Other agents are editing OTHER files in this same tree right now; you
must not touch any file not listed here.** See the change with `git diff HEAD -- <file>` for the
modified files; the untracked ones are whole new files.

Modified:
- `src/pdf-score.ts` — `comparisonWords`; `scorePage` and `thinPages` read record text through `mathsAsText`
- `src/pdf-read.ts` — prompt rules 1, 2, 8; the delimiter assertion under `SYSTEM`; `PROMPT_VERSION` `pdf-v4`; `withoutRepeats`/`wordsOf` on `comparisonWords`; `bibliographyPages` word count; `plainMaths` on title and byline
- `src/pdf-integrity.ts` — the presence floor counts `mathsAsText(record.text)`
- `tests/pdf-read.test.ts` — two new tests (search "TeX")
- `docs/project/content-extraction.md`, `docs/project/maths.md`, `docs/plans/260912d-render-latex-equations-in-the-reading-view.md`, `docs/user-feedback/260912_0804-equations-render-as-raw-latex.md`

Untracked (new):
- `src/pdf-tex.ts` — `mathsAsText`, `plainMaths`, the recognition allow-list, `texAsWords`
- `tests/pdf-tex.test.ts`
- `docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md` — the plan, with the plan-review ledger and the measurement
- `docs/plans/260924b-pdf-transcriber-writes-maths-as-tex-plan-review-sol.md` — your colleague's plan review (G1–G8); the plan says what was taken and overruled and why

## The conclusion I want checked

"A maths chunk transcribed as delimited TeX passes the PDF checks on its first attempt, is
checkpointed and reused; TeX that the reading view would not draw as visible maths still counts as
markup; and the measurement on the real paper shows no recall regression against a control run." The
finding I would least like to be wrong about: **a way for a model to hide an omission, an invented
number, or undrawable TeX inside a recognised span that the check now accepts.**

## What to do

Attack independently first: correctness of `texAsWords` and `recognised` on real TeX (nesting,
escapes, `\\`, `\left.`, `\{`, environments, `\text` with braces), any path where record text is
compared without the form (grep for `.text` in `src/pdf-score.ts`, `src/pdf-read.ts`,
`src/pdf-integrity.ts`), the template-literal escaping and the assertion, whether the tests could pass
with the fix absent, and the docs' claims against the code and the measurement.

**Fix what is inside this stage, narrowly and red-first** (write or adjust a failing test, see it
fail, fix, see it pass), and only in the files listed above. **Report, do not fix**, anything wider.
Do not run the full suite; `npx vitest run tests/pdf-tex.test.ts tests/pdf-read.test.ts
tests/pdf-score.test.ts tests/pdf-integrity.test.ts` and `npm run typecheck` are the gates (the
typecheck writes errors to stderr — read its exit code). Do not make paid model calls.

## Severity and IDs

P0 data loss / security / incorrect charging; P1 user-visible wrong behaviour or contract violated;
P2 design risk, nothing wrong today; P3 prose. Mark each **established** or **reasoned**. IDs start at
**H1**. For each: severity, evidence (file:line), and whether you fixed it (with the test) or are
reporting it. End with a one-line verdict.

## My own suspicions (already mine; worth less)

1. `TEXT_PARAGRAPH` counts whitespace-separated runs only inside a `\text{}` with no nested braces.
2. `plainMaths` collapses runs of spaces in a title that has no maths at all.
3. The allow-list may miss common commands and cost retries (`\mathcal` is in; `\lvert` is in; `\sqrt[3]{x}`?).
