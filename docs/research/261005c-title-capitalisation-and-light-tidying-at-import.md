# Title capitalisation, and what light tidying is safe at import

Research done 2026-10-05 by a Sonnet subagent on the web, for Greg's report `spya-fyj3m4` (an
all-caps title on the shelf). What we built from it is
[261005g](../plans/261005g-tidy-an-imported-title-and-keep-the-original.md); this doc is the
working behind it: what the style guides say, what breaks when a machine recases a title, and which
other fixes are safe.

**How far to trust it.** Some pages (APA's own site, Zotero's knowledge base) returned nothing to
the fetcher, so a few rows rest on search summaries or secondary sites, and say so. The thresholds
in § 3 and the rule set in § 5 are the researcher's judgement, not a source's.

## 1. What the style guides say

**Title case or sentence case is a convention of the destination, not a property of the title.**
The guides disagree with each other, and several use both.

| Source | Rule |
|---|---|
| APA 7, headings and titles in text | Title case: capitalise nouns, verbs, adjectives, adverbs, pronouns and every word of four letters or more; articles, and conjunctions and prepositions of three letters or fewer, stay lower-case. Capitalise the first word after a colon or dash, and the second part of a hyphenated major word. [apastyle.apa.org](https://apastyle.apa.org/style-grammar-guidelines/capitalization/title-case) (via a search summary) |
| APA 7, reference list | Sentence case for article and book titles. (From the researcher's own knowledge; the page could not be fetched.) |
| Chicago, headline style | Capitalise the first and last words and the major words; lower-case articles, coordinating conjunctions and **all** prepositions whatever their length. [CMOS Q&A](https://www.chicagomanualofstyle.org/qanda/data/faq/topics/CapitalizationTitles/faq0007.html) (secondary summary) |
| MLA | Title case; all prepositions lower-case "regardless of length", except at the start of a title or subtitle. [style.mla.org](https://style.mla.org/capitalization-of-titles/) |
| AP | Headlines are sentence case. Not verified further. |
| Library cataloguing (AACR2, RDA) | Sentence style: capitalise the first word of the title, and other words only as the language's own rules require (proper names). [RDA Toolkit](https://www.rdatoolkit.org/archivedsite/docs/5sec7.pdf), [LC](https://www.loc.gov/aba/rda/mgd/mg-ses-abbreviations-capital-languages.pdf) |
| Crossref | Asks publishers **not** to "supply titles, names, or other metadata in all caps, even if that is how you display and store them - it makes it difficult for others to use your metadata to format citations". Title or sentence case are both acceptable. [crossref.org](https://www.crossref.org/documentation/principles-practices/best-practices/bibliographic/) |

**Reference managers do not normalise.** Zotero stores a title as the publisher gave it and applies
case when it prints a citation. Its developers say automatic sentence-casing cannot be done:
"there's no way for *any* tool to automate conversion to sentence case. It can't be done reliably by
a computer, because a computer can't reliably recognize proper nouns"
([forum](https://forums.zotero.org/discussion/90063/can-i-default-to-sentence-case)). It offers a
naive conversion on a right-click, which the user then corrects. A 2025 comment there concedes that
language models have got better at this. No source was found saying that Crossref, DOAJ or PubMed
recase what they are given.

**So the one thing every source agrees on is that all caps is wrong.** Which case to turn it into
is a choice.

## 2. Turning ALL CAPS into something else

**Title case is the safer target for a machine.** Sentence case lower-cases everything but the
first word and the proper nouns, so every proper noun the machine does not know becomes a visible
mistake ("A history of rome"). Title case capitalises every major word anyway, so the proper-noun
problem mostly disappears, and a small word wrongly capitalised reads as a style choice. It is also
what a reader expects of a book or essay title: "THE ORDER OF TIME" reads naturally as "The Order
of Time".

What breaks:

- **Acronyms** (NASA, DNA, HIV, US). Lower-casing destroys them. The Python `titlecase` library says
  so of itself: it "does not have the contextual awareness to distinguish acronyms from words: us
  (we) versus US (United States)"
  ([README](https://raw.githubusercontent.com/ppannuto/python-titlecase/master/README.rst)).
- **Roman numerals and initials.** "WORLD WAR II", "HENRY VIII", "J. R. R. TOLKIEN" become "Ii" and
  "Viii" under a naive rule.
- **Chemical and gene names** (CO2, BRCA1). A word with a digit in it is a safe sign to leave it.
- **After a colon.** Every guide capitalises the first word of a subtitle.
- **Hyphenated compounds.** The guides differ on the second half.
- **Other languages.** German capitalises every noun; French and Spanish titles are sentence-style,
  so English title case is wrong for them. Turkish has a dotted and a dotless i, which
  `toLowerCase()` gets wrong without a locale.
- **Small words.** John Gruber's list, from the New York Times manual: a, an, and, as, at, but, by,
  en, for, if, in, of, on, or, the, to, v, via, vs. The first and last words are always capitalised.
  ([daringfireball.net](https://daringfireball.net/2008/05/title_case))

Existing tools: Gruber's script assumes a word with a capital after its first letter is already
right, which leaves an all-caps title untouched. Python's `titlecase` does handle it ("THIS IS A
TEST" becomes "This Is a Test"). The npm ports were not verified.

**When to leave an all-caps title alone** (judgement): one word; two or three short words that could
be an acronym or a brand ("BBC NEWS"); anything where only part of the title is in capitals.

## 3. Detecting it

None of this is from a source.

- Count upper-case letters over cased letters, ignoring digits and punctuation. All caps is 1.0, or
  0.9 and over with three or more words. Less than that is a mixed-case title with acronyms in it.
- At least two words and eight cased letters.
- An all-lower-case title is more often deliberate ("e e cummings"), so be more careful with it:
  touch it only if it is four or more words, and then only capitalise the first letter.

## 4. Other light tidying, by risk

| Fix | Risk done automatically |
|---|---|
| Collapse whitespace and line breaks | Very low. We do this already (`plainTitle`). |
| Decode HTML entities, once | Very low. We do this already. |
| Strip a trailing `.pdf` or `.docx` | Low. |
| Strip a "Microsoft Word - " prefix | Low; it is a known artefact of exporting to PDF ([Microsoft](https://learn.microsoft.com/en-us/answers/questions/4463700/online-pdf-displays-as-microsoft-word-x-doc-in-bro)). What is left is often a filename. |
| Underscores for spaces | Low when there are no spaces at all; otherwise it means the title is a filename. |
| Trailing footnote markers on a paper's title (`*`, `†`, `‡`) | Low. Trailing digits are not safe ("Catch-22"). |
| A site-name suffix ("Title \| Site") | Medium. Safe only when the suffix matches the site's own declared name or its hostname; a blanket split on " - " breaks real subtitles. |
| A trailing full stop | Low to medium ("etc.", "Inc."). |
| A spaced hyphen into a dash | Medium. Skip. |
| Spacing round a colon | Low to medium; French puts a space before one. |
| Straight quotes into curly | Low risk, low value. |

## 5. The researcher's recommendation

1. Whitespace and entities.
2. File extensions, the "Microsoft Word - " prefix, trailing footnote markers.
3. A site-name suffix, only when it matches the known site name.
4. An empty title, a filename or "Untitled" is no title: take it from the first heading or a model.
5. All caps, detected as in § 3: recase. All lower-case: the smallest fix.
6. A title already in mixed case is never touched, beyond 1 to 3.
7. Keep the original beside it.

**Rules or a model?** Steps 1 to 4 are plain code. For step 5, code is cheap and predictable but
cannot tell an acronym from a word or apply another language's rules. The researcher would pick a
hybrid: code decides *whether* to act, so most imports cost nothing; a small model recases only the
flagged titles; and code then checks that the model's answer, lower-cased, equals the original
lower-cased, so the model can have changed nothing but case. Which case to aim for is a product
decision, and the model should be told rather than left to choose.

What the plan took from this, and what it passed over, is in
[261005g](../plans/261005g-tidy-an-imported-title-and-keep-the-original.md).
