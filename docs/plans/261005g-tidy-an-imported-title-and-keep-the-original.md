# Tidy an imported title, and keep the original

**Status:** built, 2026-10-05, on `dev`. Report `spya-fyj3m4`, from Greg (an admin), relayed by the
Overseer. Two questions are open for Greg, at the end.

> As part of the import process, could we apply very light editing to the article title (e.g. this
> one is in all caps) to make them more consistent and readable. Ideally follow the author's intent
> and don't change the contents substantively unless they're obviously e.g. broken/missing/not the
> real title/etc.
>
> — Greg, 2026-10-04, report `spya-fyj3m4`

The Overseer's relay added: keep the original title stored beside the tidied one, so nothing is
lost and it can be undone. The article he was reading is a PDF whose title is `THE ORDER OF TIME`.

The research is
[261005c](../research/261005c-title-capitalisation-and-light-tidying-at-import.md). In short: every
source agrees an all-caps title is wrong, none agrees what the right case is, title case is the
target a machine gets wrong least, and what a machine cannot know is which words are acronyms.

## What v1 does

**One pure function, `tidyTitle(title, context)`, in `src/title-tidy.ts`**, called wherever an
imported title is made: `runExtract` (src/extract.ts), `runPdfExtract` (src/pdf-read.ts) and, for a
paper added with only its title and authors, `paperMeta` (src/paper-metadata.ts). No model, no
network, no new dependency.

It makes two changes and no others:

1. **A title wholly in capitals becomes title case.** "Wholly" means: at least two words, at least
   eight cased letters, every cased letter upper-case, and at least one word of five letters or
   more that is not a small word. So one word is left alone (`UNESCO`), a title that is mostly
   acronyms is left alone (`BBC NEWS`, `DNA AND RNA`), and a mixed-case title with capitals in it
   (`Why NASA Failed`) is never touched.
   - Each word becomes a capital and lower-case letters.
   - The small words (John Gruber's list: a, an, and, as, at, but, by, en, for, if, in, of, on, or,
     the, to, v, via, vs) are lower-case, except as the first word, the last word, or the first
     word after a colon, a dash, a question mark or an exclamation mark.
   - Kept as written: a word with a digit in it (`CO2`); a roman numeral made of two or more of I,
     V and X (`II`, `VIII`; no English word is spelt that way, where `MIX` and `CIVIL` are words);
     initials, joined or spaced (`J.R.R.`, `J. A. Smith`), and dotted abbreviations
     (`U.S.`, `A.I.`, `PH.D.`). Their existing capitals are preserved.
   - Apostrophes: `ROVELLI'S` gives `Rovelli's`, `DON'T` gives `Don't`, `O'BRIEN` gives `O'Brien`,
     straight or curly.
   - Each half of a hyphenated word is recased (`SELF-ESTEEM` gives `Self-Esteem`,
     `STATE-OF-THE-ART` gives `State-of-the-Art`).
   - **An acronym is recognised from the article's own body.** A title word stays in capitals when
     the body writes it in capitals at least twice and never any other way. So `THE FUTURE OF NASA`
     over a body that says "NASA" gives `The Future of NASA`. Three things are not evidence: the
     title's own appearances in the body (a heading, a running head), a small word, and a body
     printed mostly in capitals. For a PDF the body is its paragraphs, not its headings. With no
     body (a minimal paper), no word is taken for an acronym.
   - **English only.** A page that declares a language other than English is not recased. With no
     language declared, which is every PDF, a title with an accented capital is not recased either,
     as the cheapest sign of another language.
   - Literal entity syntax left by a doubly encoded import is not recased: an entity's name is
     case-sensitive, so `&AMP;` becoming `&Amp;` would change more than the display case.
2. **Trailing footnote markers come off**: `*`, `†`, `‡` after a word of three letters or more.
   `Attention Is All You Need*` becomes `Attention Is All You Need`; `A*` and `C*` stay.

**The original is kept** in a new nullable column `article_revisions.title_original` and
`Meta.titleOriginal`, set only when tidying changed the title, and null otherwise. It is in the
owner's article read and in the export, in no prompt's fingerprint, and a visitor is not sent it. It
is carried forward with the revision as `title` is. The column passes the original through the same
`plainTitle` as the title, so the two cannot differ in anything but the tidying.

**Undo is on the Metadata page.** Under the title, when there is an original and the title showing
is not it:

```
The Order of Time                                  [rename]
Imported as “THE ORDER OF TIME”.  [Use that title]
```

The button writes the original as the reader's own title through the rename the page already has
(`useArticleRename`, `articles.title_override`). That is one existing request, and it survives
re-extraction, which is what an undo should do. Renaming back afterwards is the existing rename.

**The body is not changed.** An HTML page's title is also its `<h1>`, which becomes a block of the
prose. That block keeps the author's capitals: the prose is the author's and the shelf is ours. The
extracted page's `<title>` is left as it came too, so the extracted bytes do not depend on these
rules.

## Known misses

- `THE MCDONALD PAPERS` gives `The Mcdonald Papers`. A name's inner capital is not recoverable.
- An acronym the body uses once or never (`Nasa`).
- An unaccented title in another language from a PDF (`EL ORDEN DEL TIEMPO` gets English capitals).
- A title of more than 300 characters is tidied and its original kept, but "Use that title" is
  refused by the rename's length limit, and the page says so.
- A title that is only short words (`LIFE OF PI`) is left in capitals.
- Capitals used for emphasis, or shortened running heads whose words never occur in ordinary
  case in the prose, can look like acronyms (`FUTURE` repeated above unrelated paragraphs).
- A quoted subtitle can have a lower-case final small word (`THE SCIENCE OF “WHAT FOR” AND WHY`
  becomes `The Science of “What for” and Why`).

Each is a case for the rename, and the first three are the case for a model, below.

## What it leaves out, and why

- **A model.** The research recommends a hybrid: code detects, a small model recases, code checks
  the model changed nothing but case. It would get names, acronyms and other languages right. It is
  a new prompt, a paid call and a failure path on every flagged import. Simpler first; it is the
  first open question.
- **Sentence case.** Needs proper nouns, which only a model knows.
- **All-lower-case titles.** More often deliberate, and rarer. Not seen in a report yet.
- **Site-name suffixes, "Microsoft Word - ", file extensions.** Readability and `titleFrom`'s
  `looksLikeAFilename` already handle the common forms; the rest is medium risk per the research.
- **Dashes, quotes, colon spacing, trailing full stops, superscript digits.** Medium risk or low
  value. `L²` is a title's meaning, not a footnote.
- **Existing articles.** `title` is in the fingerprint of about fifteen stages
  (`REVISION_READ_POLICY`, src/store/pg.ts; `src/source-hash.ts`), so rewriting it in place would
  mark every one of them stale on every affected article. v1 applies to new imports and to a
  re-extraction. Greg's own article can be renamed by hand today. A backfill is the second open
  question.

The simpler option passed over: recase with no acronym rule. It is a few lines shorter and turns
`NASA` into `Nasa` every time, which is the visible mistake the research warns about, and the body
is already in hand at both extractors.

## What the reviews changed

GPT Sol's plan review
([prompt](261005g-tidy-an-imported-title-plan-review-prompt.md),
[answer](261005g-tidy-an-imported-title-plan-review-sol.md)) kept the design and tightened it. Taken:
superscript digits, `§` and `¶` are no longer stripped (F1); an acronym must never appear in
another case, small words and a capitals body are not evidence, and a PDF's headings are left out
(F2); an accented title with no declared language is left alone (F3); apostrophes, spaced initials
and the narrower roman numeral are specified and tested (F4); the original is exported, and tested
through the owner's read, the carry, the export and the visitor's read (F5); the column makes both
strings plain (F6); the minimal-paper path is covered (F8). Not taken: giving the PDF's `<title>`
the tidied string (F9), for the reason under "The body is not changed". F7, the 300-character limit,
is a known miss rather than a new path.

## Open questions for Greg

- **[Q-title-model]** Should a small model do the recasing instead of the rule? See above.
  Recommendation: not yet; look at what the rule gets wrong on real imports first.
  **Decided: yes, a small model** — Greg, 2026-10-05: "yes, a small model (e.g. GPT Luna or DeepSeek).
  ideally piggybacking on an existing call we're already doing as part of the import process".
  Built as [261005j](261005j-a-small-model-tidies-an-imported-title.md): a small model tidies the
  title at import, and the rule here is its fallback.
  **It is its own call, not a piggyback.** No one existing import call covers every import: a web
  page's `extract`, the commonest, makes no model call at all; `pdf-frontmatter` is PDFs only and
  answers in block ids; `paper-metadata` is batch-added papers only and is scored on copying the
  title "exactly as printed"; `structure` and the new `reading-difficulty` run after the title is
  stored, and `title` is in every generated mode's fingerprint. Riding on two of them and adding a
  third for web pages would be three prompts and three checks for one job, so it is one cheap job,
  `title-tidy` (about 1 second and 0.007 cents an import). The table is in
  [261005j § Where the call goes](261005j-a-small-model-tidies-an-imported-title.md).
- **[Q-title-backfill]** Should the articles already on shelves be tidied? It needs a script run
  against production, and it marks those articles' generated modes stale. Recommendation: a
  report-only script first, to count them.
  **Decided: no backfill** — Greg, 2026-10-05: "no, just articles going forwards".
