## Findings

### P0 — The fallback fabricates a link to the article

[src/debate.ts:868](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:868)

Concrete input:

```text
Article URL:
https://example.org/what-the-tide-clock-cannot-tell-you

Extract:
A piece at https://example.org/what-the-tide-clock-cannot-tell-you-2026 says the opposite...

articleReferenceQuote:
A piece at https://example.org/what-the-tide-clock-cannot-tell-you
```

`locate` accepts that witness as a substring. Parsed alone, its URL matches the article; parsed in the complete extract, the only URL is the different `…-2026` page. Nevertheless:

```text
kept: 1
identifies: [{ kind: "linked", url: articleUrl }]
level: linked
```

The default bar shows it, and the tooltip falsely says it links this article. This is the same successor false-positive class Stage P is meant to contain.

The non-empty invariant is mechanically guaranteed: non-null `naming` always contributes either `named`, the whole-extract link, or the fallback link. But in this path it is guaranteed by inventing evidence. The row should fail directness when the witness’s apparent URL is only a prefix of the URL in its original context.

### P0 — A genuine mirror survives when `sourceQuote` crosses a block boundary

[src/debate.ts:853](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:853), [src/shingles.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/shingles.ts:263)

Concrete input:

```text
Block 1 ends:
...the harbour has a hundred moods.

Block 2 starts:
So the card under the clock is doing something...

Mirror extract:
<title>
<all of block 1>

<all of block 2>

sourceQuote:
a hundred moods. So the card under the clock
```

The spaced validation accepts that quote in the extract across the paragraph break. The copy density was `0.9667`, but `isArticleText` checks each block separately and returns false. Production-path result:

```text
kept: 1
sourceIsCopy: 0
level: quoted
```

The mirror therefore clears the default bar, and its tooltip can say that 97% of the extract is article text while still presenting it as a response.

The same hole exists whenever a mirror has non-article archive chrome and the model chooses that as `sourceQuote`. Consequently, `sourceQuote` is not an independent copy signal, and F2 does not reliably retain the mirror refusal.

### P1 — Keeping headings only on the density side creates a contradictory verdict

[src/shingles.ts:177](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/shingles.ts:177), [src/shingles.ts:215](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/shingles.ts:215), [src/debate.ts:853](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:853)

Use a 14-word H1:

```text
A careful guide to building reliable artificial intelligence systems safely
at planetary scale today
```

With an extract and both reported quotes equal to that title:

```text
coverage: 0
hit: null
density: 1
extractWindows: 7
isCopy: true
isArticleText(title): true
```

The row is dropped as `sourceIsCopy`. The reader is told it “turned out to be a copy,” despite the new quotation rule treating the same text only as naming evidence. This also contradicts the intended outcome that a heading-only match becomes `named`.

The current test title has only eleven words, producing four windows and staying below `COPY_MIN_WINDOWS`, so it does not exercise this inconsistency.

### P2 — The tooltip still does not list every signal in the extract

[src/debate.ts:517](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:517), [src/debate.ts:879](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:879), [src/web/DebatePanel.tsx:582](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/web/DebatePanel.tsx:582)

Concrete input:

```text
Extract:
What the tide clock cannot tell you.
Read the original at https://example.org/what-the-tide-clock-cannot-tell-you.
This conclusion is completely unsupported.

articleReferenceQuote:
Read the original at https://example.org/what-the-tide-clock-cannot-tell-you.
```

The whole extract contains both the exact title and link. Because `namedInText` still examines only the selected witness, the stored list contains only `linked`. The level remains correctly `linked`, so filtering is unaffected, but the tooltip omits the title signal despite promising every signal found.

The focused four suites pass—105 tests—and the three TypeScript projects check clean. I made no edits.