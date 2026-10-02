---
reports: spya-kqynj5
ending: shipped
---
# Recall always links the passages it is about

Report `spya-kqynj5` (SPIDERYARN-READING2-97), a suggestion, from Greg (admin), filed
2026-10-01T18:43:47Z on production build `43be719`, on
`https://www.spideryarn.com/read/melnikoff-bargh-2018-mythical-number-2-0-spya-bucuzj?at=spya-ecw0kq&mode=remember&summary=brief&thread=spya-m922m6`:

> In Recall mode, it should always include block-links in the response. So maybe we don't need the
> Respond mode, and instead we should tweak the Balanced mode prompt/machinery to include (more)
> block-links.

**Ending: Shipped**, on `dev`. Plan
[261002i](../plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md), stage 2.
Respond went, with the other three stances: Recall is one voice, built on Balanced's rules. Every
reply that says anything about the piece now carries at least one block link (a pure "did you mean
X or Y?" may not), and quotations sit in quotation marks with the id straight after — the first run
showed the model pasting article sentences in unmarked and unlinked, and the second cited in every
reply. `evals/results/remember-recall.md`.
