---
reports: spya-trg9kz
ending: shipped
---
# Weird line breaks around cited clauses

[SPIDERYARN-READING2-B5](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-B5), a problem
from Greg (admin; the Overseer relayed the row's words), sent from
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564` at block `spya-tgqpmx`.

> Sometimes the formatting gets a bit messed up around footnotes, I think. Like there's weird line
> breaks. Here's an example.

**Ending: Shipped.** On `dev`, not deployed.

It was not the footnotes and not extraction. The stored block is one clean paragraph. The chat
answer's block chips and a citation's mark in the prose both used the class `cite`, and the chips'
`display: inline-flex` reached the mark, so every cited clause too long for its line dropped to
lines of its own. The chips are `cite-chips` now, with a Chrome test on the reported block and a
guard over the sheets. The plan is
[261003l](../plans/261003l-citation-marks-break-the-line-because-a-chat-chip-class-shares-their-name.md)
and the class is
[261003e](../postmortems/261003e-two-components-sharing-one-bare-class-name.md).

**Not done, and asked of Greg in the debrief:** the same article stores its footnote markers as bare
digits (`remarkable28`, `memories29 ,`), because it was imported before a PDF's footnotes were
linked. A re-import is what would run the footnote linking over it; that was not tried.
