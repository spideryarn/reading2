# A narrow follow-up on F1: is the amended ownership rule sound?

Read-only. One question, not a re-review.

You reviewed the first draft of `docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md`
(commit `ad65edb2`) and your answer is `docs/plans/260912a-figure-2-vector-figures-from-a-pdf-plan-review-sol.md`.
The revised plan is commit **`5f35ac2e`** — read its § "Which pages are eligible", § "Finding the
rectangle, and proving it belongs to the caption", and the F1 row of § "The review, and what it
changed".

Your F1 change was "one exclusive drawing component immediately above [the caption]". I did not take
that literally, because the figure this report is about — Figure 2 on page 8 of
`tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf` — is **two disconnected lattices** side by
side under one caption, roughly 100 pt apart, so a one-connected-component rule refuses it. The
amended rule is: exactly one figure marker on the page, no image of any kind, and **refuse unless all
the painted ink in the band between the caption and the prose line above it (minus thin header/footer
rules) is the one region** — any other ink in that band, beside the region or in another column,
refuses the page; a page-sized path refuses the page.

The question: **does the amended rule refuse every adversarial layout in your F1** — side-by-side
figures over stacked captions, a watermark / border / boxed equation / sidebar / ornament in the same
band, a narrow caption under a wider multi-panel figure, a full-width caption under one column of a
two-column page — and is there a layout it admits that is the wrong picture under the caption?
Construct any counterexample concretely. If the rule is unsound, give the smallest change that makes
it sound **and still admits Figure 2's two lattices**.

Answer with findings `F11`, `F12`, … (P0–P3 by consequence; established vs reasoned), and a one-line
verdict: **sound**, **sound with changes** (IDs), or **unsound**.
