# A note-scoped comment can describe the wrong report

Stage 1 of the administrator's Earlier tab derived one comment per report from the headers of
feedback notes. One note named two unrelated reports, while its comment described only the first.
The generated map therefore showed an imports question under the already-shipped “Why are you
reading this?” report. A second shipped note kept showing a question after Greg had answered it.
Both were caught in review of commit `16963ad41`; nothing reached a reader.

## What happened

The compiler quite correctly copied a note's one `comment:` value to every id in its `reports:`
field. Its structural checks passed: every report had one combined ending, and every declined or
awaiting report had a selected comment. Neither check could establish that the prose applied to
each report or was still current.

The real root cause was a mismatch of scope. A note may collect several reports, but `comment:` is
unstructured prose with note-wide scope while the product presents it as report-specific data.
The same freedom let resolved prose remain in a shipped note after the separate approval register
had been updated. This is **note-scoped prose promoted to report-scoped state**.

Commit `16963ad41c0b503d0919d5ac9a235ec459f3e4d7` introduced the comments and their compiler. The
underlying combined notes predated it, but did not become wrong product data until that commit read
their headers into the application.

## Why nothing went red

The tests checked syntax, selection order, coverage, and generated-file freshness. Those are all
mechanical properties. The bad rows satisfied every one. The review had to compare each of the 21
new comments with both its note and the approval register to reveal the semantic mismatch.

## What would have caught it, ranked by ease against value

1. **Pin each discovered mismatch in the generated map** — done. The test now requires no comment
   for the resolved report or the unrelated report, while preserving the imports question.
2. **Give a comment its own report scope** — done for this combined note by splitting its report
   headers into two notes. This is cheap whenever the prose does not apply to the whole note.
3. **Replace `comment: string` with a per-report mapping** — rejected for now. It makes the invalid
   scope unrepresentable, but adds a second header shape and migration work for a corpus with only
   one bad combined note. If mixed-scope comments recur, that evidence changes the trade-off.
4. **Attempt to prove prose relevance automatically** — rejected. A string comparison or model
   judgement would be less trustworthy than the source-note audit it claims to replace.

## The long-term fix

For the present corpus, separate note headers are the right representation: one report-specific
comment has one report-specific source. The targeted regression test prevents these two known bad
associations from returning. If mixed-scope comments become common, the right long-term change is
a typed per-report comment mapping, not more selection heuristics in `chooseComment`.

## The thing I would tell myself

I treated “the note says this” as evidence that every report named by the note says it. Before
promoting prose into product data, I must compare the scope of the prose with the scope of the key
that will address it.

