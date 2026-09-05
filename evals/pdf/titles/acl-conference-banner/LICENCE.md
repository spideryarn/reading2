# `acl-conference-banner/source.pdf`

**Agam Shah, Suvan Paturi, Sudheer Chava, "Trillion Dollar Words: A New Financial Dataset, Task &
Market Analysis."** Proceedings of the 61st Annual Meeting of the Association for Computational
Linguistics (Volume 1: Long Papers), pages 6664–6679, July 2023. ACL.

<https://aclanthology.org/2023.acl-long.368/>
PDF: <https://aclanthology.org/2023.acl-long.368.pdf>

```
full   sha256  99de41fcef663abeed6a9d12a16a9fc05fa77d8674e8bb9e776d9276314e80da
full   bytes   403,670
full   pages   16
cut    sha256  3f09fe401261ecf5b6641090d91437c4583ab1df435a3b9540a8403367c2e474
cut    bytes   96,289
cut    pages   3 (1–3)
```

**A hash mismatch is a new fixture version, not a hash to update.**

## Licence

ACL Anthology has published all its proceedings under **CC BY 4.0** since 2016 (confirmed at
`aclanthology.org/faq/copyright/`), which is why the page itself still prints a plain
`©2023 Association for Computational Linguistics` line — that copyright notice and the CC BY
licence are not in tension; ACL holds the copyright and licenses it out under CC BY. Not to be
confused with the *dataset's* separate CC BY-NC 4.0 licence, mentioned in the paper's own abstract
footnote — that license covers the authors' Huggingface/GitHub artefacts, not the paper text this
fixture is cut from.

## Why this document

**The conference-proceedings banner sits above the paper's own title**, in the same visual slot the
journal masthead occupies on the Elsevier/Copernicus fixtures in this corpus:

> Proceedings of the 61st Annual Meeting of the Association for Computational Linguistics
> Volume 1: Long Papers, pages 6664–6679
> July 9-14, 2023 ©2023 Association for Computational Linguistics

A naive "biggest/first block on the page" rule could plausibly return the venue line — "Volume 1:
Long Papers" — instead of the paper's title, which is exactly the class of confusion this corpus
exists to catch (a proceedings *volume*'s identity standing in for one *paper*'s title). The paper
is also genuinely two-column, for good measure. `metaTitle` is empty (LaTeX's `pdflatex` build sets
none), and no running header or footer repeats within the 3-page cut or, per `pass0-full.json`, the
full 16-page paper — ACL's template carries only a bare page number in the footer.
