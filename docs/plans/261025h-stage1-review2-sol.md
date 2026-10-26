Refuse round 2: two P1s remain; no P0s.

### Findings

S1-F7 — P1 — One-to-one matching rejects valid surname-first bylines

[`BYLINE_SEPARATORS`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:524>) treats every comma as an author boundary. Thus:

- Article byline: `Smith, Jane; Jones, John`
- OpenAlex authors: `Jane Smith`, `John Jones`
- Same distinctive title

[`titleMatchOf`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/citation-index.ts:614>) returns `none`. The old matcher accepted both genuine authors by scanning the complete byline. This can remove Cited by from DOI-less articles using a common `surname, given` byline format.

S1-F1’s original false-positive counterexample is closed, but its fix introduced this false-negative. The byline parser needs to distinguish commas within surname-first names from separators between people.

S1-F8 — P1 — S1-F4’s operator class remains open, while ordinary colon titles are damaged

The regexes at [`situate.ts:308`](</var/tmp/spideryarn-worktrees/fbvg2b69-sources-reshape/src/situate.ts:308>) recognise operators only when whitespace-bounded. This query survives unchanged:

```text
response (after:2030) (-critique) (OR) evidence
```

So punctuation-wrapped `word:value`, unary, and boolean operators still reach search. S1-F4 is not closed by its named class.

Conversely, the broad `word:value` rule corrupts ordinary colon compounds. A generated query for:

```text
The Extended Mind:Version Control
```

becomes:

```text
"The Extended Control" Clark
```

because `Mind:Version` is deleted. Operator parsing needs to account for grouping punctuation and quote context while distinguishing actual search operators from title punctuation.

### Round-1 status

- S1-F1: original counterexample/class closed, but fix introduced S1-F7.
- S1-F2: closed.
- S1-F3: closed.
- S1-F4: still open as S1-F8.
- S1-F5: closed.
- S1-F6: closed.

Requested tests passed: 3 files, 187 tests, 13.49s. No files were changed.