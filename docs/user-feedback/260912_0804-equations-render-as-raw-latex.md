# Equations render as raw LaTeX

**Sentry:** SPIDERYARN-READING2-30 · first seen 2026-09-12 08:04Z · kind `suggestion` · from Greg
(admin, established by `scripts/feedback-reporter.ts`, exit 0) · on an iPad in production, reading the
uploaded PDF `entropy-24-00930` at `?at=spya-d8tgkx`, build `607b57a0`.

> Importing this file worked ok, but all the equations and formulae are being displayed as raw
> latex. Can we somehow render them them to display them nicely within the text?

**Ending: shipped** — on `dev`, not yet deployed. This session ran on a pool account with no Sentry
sign-in, so the next feedback sweep marks the issue `resolved` from this note.

What we did: delimited TeX in an article (`\(…\)`, `\[…\]`, `$$…$$`, and `$…$` with TeX inside) is
now drawn as maths in the reading view, with temml loaded only for articles that have some. A
comment or chat on a selection across a formula saves. Plan, reproduction and both GPT Sol reviews:
[260912d-render-latex-equations-in-the-reading-view.md](../plans/260912d-render-latex-equations-in-the-reading-view.md).

Two things for Greg:

- **Checked in Chromium only.** WebKit would not launch on the box, so the first look on an iPad is
  his.
- **His own copy may still show TeX.** It renders on his next load after deploy if the model used
  one of those delimiters. If it wrote bare TeX with no delimiters, it will not, and the fix is to
  re-import once the deferred half below lands.

The deferred half makes the PDF reader write maths as TeX in the first place. Reproduced with the
same PDF, the reader usually flattens equations into unreadable plain text rather than writing
LaTeX. That half needs the PDF scorer made TeX-aware first, and is in the Overseer's queue as the
proposal `qi-njx3xh37`.
