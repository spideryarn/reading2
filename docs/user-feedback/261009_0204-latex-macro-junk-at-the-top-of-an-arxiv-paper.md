---
reports: spya-nhhd0x
ending: shipped
comment: arXiv papers no longer bring in the TeX LaTeXML could not convert, such as "\hohsettheme" and "hohRose". About one paper in nine had some. The article you saw stays as it is.
---
# LaTeX-macro junk at the top of an arXiv paper

Report `spya-nhhd0x`, from Greg (an admin; `scripts/feedback-reporter.ts` exited 0), filed
2026-10-09 02:04 UTC; session `fbnhhd0x-latex-junk`. No Sentry sign-in in this session, so the
next feedback sweep marks the Sentry issue.

> This article seems to have a little bit of import junk at the top. Not that fussed about fixing
> this particular article. I'd just like to improve our import process going forward.
>
> ```
> \hohsettheme
>
> hohRose
> ```

**Ending: Shipped**, on `dev`. Plan
[261009f](../plans/261009f-latex-undefined-macros-leave-the-page.md).

**Why it happened.** The article (`arxiv-2609-01481v1-spya-sjatfv`) came through the HTML path,
not the PDF one. arXiv's HTML is made by LaTeXML, and when LaTeXML meets a macro it has no
definition for (here the paper's own colour-theme command, `\hohsettheme{hohRose}`), it writes the
macro's name into the page as an error marker, `<span class="ltx_ERROR undefined">`. Then it lets
the argument through as ordinary text. Nothing of ours knew that class, so both reached the reader
as prose.

**How common.** 9 of 79 arXiv HTML papers from one day's new listings carried such markers, 135 in
all. In most of them, what follows the marker is the author's real text (a funding statement, a
workshop name). In one paper it was 104 citation keys glued into the sentences
(`phases\ucitedagottoComplexityStronglyCorrelated2005.`).

**What happens now** (src/latexml.ts § `removeUndefinedMacro`, for papers imported from now on):
the marker always goes. The text after it stays, unless it is plainly a name from the TeX source
(`hohRose`, a .bib file's name) or a citation key after a `…cite` macro. Where removing the marker
would join two words, a space is put in, and `\sep` between keywords becomes a semicolon. The
before/after on all ten affected pages is in the plan.

**Not done, on purpose:** the article itself is not re-extracted, as asked. Optional-argument text
such as `[1]` or `[Correspondence]` still shows, because nothing in the markup tells the useful
ones from the useless ones. Those are in front matter, which is folded by default.
