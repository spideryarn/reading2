# A shelf link sends the hit's own spelling, and `foldWithMap`'s offsets are made right first

Cluster 4 of the fifth codebase sweep —
[261003f-fifth-codebase-sweep-umbrella.md](261003f-fifth-codebase-sweep-umbrella.md) § The clusters.
Items WC-W11 = DF-F1, the two `foldWithMap` offset bugs Sol found, and DF-M7's fold-twin parity test.
Evidence: [web-client § W11](../investigations/261003b-fifth-sweep-web-client.md),
[Sol on server and web](../investigations/261003b-fifth-sweep-review-sol-on-server-and-web.md) § What
the client doc missed, [Opus on defences § M7](../investigations/261003b-fifth-sweep-review-opus-on-defences.md).

## What is wrong

Press a passage in the shelf's search results and you land on the right paragraph with the word
highlighted. For `café`, `don’t` or `eﬃcient` you land with an empty search panel instead.

`libraryHitHref` (`src/web/library-hits.ts`) puts the **folded** term in `?find=` — `cafe`, `don't`,
`effi`. The reading view's find-on-page (`findLiteral`, `src/web/search-hits.ts`) folds **case only**,
on purpose, so it finds none of them. `tests/library-hits.test.ts` pins `find=cafe`.

The fix is to send the article's own spelling: the slice of `hit.text` under the folded match.
`foldWithMap` is the function that maps a folded offset back, and it is wrong three ways, all
re-run against today's tree (`d65cef3c0`):

1. **Code points against code units.** It pushes one map entry per folded *code point*; its callers
   index by `indexOf`, which counts UTF-16 units. An emoji earlier in the paragraph shifts every
   later offset by one: `"😀 café"` + `cafe` slices `afé`.
2. **A character that folds to nothing loses its width.** The next source offset is read from the
   last *pushed* entry, and a combining mark pushes none. Decomposed `"á café"` + `cafe` slices
   `" caf"`.
3. **(Found while reading.)** A match that ends on a base letter leaves its combining mark outside
   the slice: decomposed `café` + `cafe` slices `cafe` without the accent.

`marked` in `Library.tsx` cuts the bold word of the snippet with the same map, so 1 and 2 are live
in the snippet today, without the link.

And the twins disagree: the browser folds one character at a time, the server
(`src/library-search.ts` § `fold`) the whole string. Two inputs differ — a word-final Greek `Σ`
(`ς` against `σ`), and combining marks NFKD reorders across code points (pointed Hebrew typed in
the usual order).

## The change

All in `src/web/library-hits.ts`; `Library.tsx` should need no edit, because `marked`'s arithmetic
is right once the map is.

**`foldWithMap`, by cluster.** Walk the text in clusters — one non-mark code point and the marks
that follow it (`/\P{M}\p{M}*|\p{M}+/gu`, with U+FF9E and U+FF9F counted as marks — see Measured, below). Fold each cluster; give **every UTF-16 unit** of its
output the cluster's whole source span. That is all three offset bugs at once: units not code
points; the source position is the regex's own index, so nothing is lost when a cluster folds to
nothing; and a base letter's span includes its marks.

It also makes the fold the server's twin by construction rather than by resemblance. NFKD never
reorders across a starter, so per-cluster NFKD concatenates to whole-string NFKD. Lowercasing is
then done **once over the whole folded string**, as the server does, which is what gets the final
sigma right; it is used only if it has the length the per-cluster lowercasing had (after NFKD and
mark stripping nothing lengthens — `İ` is already `I` — but an unchecked length is exactly the
drift this function is for, so the fallback is per-cluster lowercase, never a wrong map).

**Measured, not argued (2026-10-03).** A scratch fuzz ran the browser's `fold` against the server's
over every code point (alone, between letters, after `Σ`, and wrapped round two combining marks)
and 300,000 random strings — 4,748,256 inputs. The first cluster regex left **two** disagreements,
both the same shape: `ﾞ` and `ﾟ` (U+FF9E/F, halfwidth katakana's voicing marks) are letters by
category and combining marks after NFKD. They are named in the regex now, and the fuzz reports 0
disagreements, 0 maps of the wrong length and 0 non-monotonic maps. The fuzz is not checked in (it
takes a minute and reads the whole of Unicode); the parity test carries the cases it found.

**`libraryHitHref`.** For each query term in order, find it in the folded text and take
`hit.text.slice(starts[i], ends[i + term.length - 1])`. If that is shorter than find-on-page's
`MIN_FIND_CHARS` once trimmed — the query `ffi` against `eﬃcient` gives the single character
`ﬃ` — widen by one code point to the right, else to the left; if it is still too short, try the
next term; with none, degrade to `?at=` alone as it does today. `MIN_FIND_CHARS` is imported from
`search-hits.ts` rather than restated.

**Simpler option passed over:** make `findLiteral` fold accents too. One line there instead of a
map here — and it changes what find-on-page means everywhere, which that function's own comment
argues against. Not this cluster's call.

**Also passed over:** folding `ς` to `σ` in both twins. Arguably the better fold, but the server's
is outside this cluster's files and used by chat.

## Tests, red first

In `tests/library-hits.test.ts` (moved to jsdom, because `findLiteral` renders html):

- **Round trip**, the one that matters: `libraryHitHref` → `find` → the real `findLiteral` over the
  same text is non-empty, for `café`, `Gödel`, `don’t` (typed `don't`), `eﬃcient` (typed
  `efficient`), `ffi` against `eﬃcient`, an emoji before the word, a decomposed accent before the
  word, a decomposed accent on the word. Plus a plain control, so the test is known to be able to pass.
- The pinned `find=cafe` becomes `café`.
- `foldWithMap`: `folded.length === starts.length === ends.length` for strings with astral
  characters and marks; the two slices in bugs 1 and 2.
- **Parity:** the browser's `fold` and the server's over one list of strings, including `ΟΔΟΣ`,
  pointed Hebrew, `İ`, ligatures, `½`, curly punctuation, an emoji; and `foldWithMap(s).folded`
  equals `fold(s)`.

## Done

The above green, `npm test` and `npm run typecheck` green, Sol's code review answered, the
umbrella's row updated, pushed to `dev`. Stale pointers fixed on the way: `library-hits.ts`'s
header says there is no React test runner; `search-hits.ts` says `foldWithMap` lives in
`src/library-search.ts`.

## GPT Sol's plan review

[261003h-shelf-link-plan-review-sol.md](261003h-shelf-link-plan-review-sol.md) — REVISE, one P1 and
three P2s, all taken except one half of one:

- **P1, the regex as first written does not give parity** (`ﾞ`, `ﾟ`). The fuzz had found the same
  two while the review ran; the plan now states the regex that was built.
- **P2, the hit's spelling is `block.text`'s, and the reading view searches the rendered html.** For
  one term these agree except where rendering changes the letters: a hit on `alpha` inside
  `\(\alpha\)` links to a paragraph that shows `α`. Not fixable from the shelf, which has only
  the text; written on `ownSpelling` as a known limit. The outcome is today's — right paragraph,
  empty panel.
- **P2, widening.** Tests added for a space to the right and for falling through to the next term.
  **Not taken:** trying a *later occurrence* of the same term before the next term (`ﬃ ffi`). A
  one-character ligature that is its own word, with the same letters spelled out later in the same
  paragraph, is not worth a loop.
- **P2, a non-empty round trip cannot see a dropped accent.** True of the decomposed row; the exact
  slices are asserted in the `folding` tests, and U+FF9F is in the parity list.

## Not done here

The snippet bolds the *earliest* term in the paragraph and the link highlights the *first query
term* that occurs, so for a two-word query they can be different words. Left alone: it is
`Library.tsx`'s snippet arithmetic, which W13 owns.

## What landed (2026-10-03)

As planned, in `src/web/library-hits.ts` and its test; `Library.tsx` needed no edit, and
`search-hits.ts` got one corrected pointer in a comment.

- Red first: 17 of the new tests failed against the old code, for the reasons above.
- GPT Sol's code review — [261003h-shelf-link-code-review-sol.md](261003h-shelf-link-code-review-sol.md)
  — **SHIP**, no P0 or P1. One P2, which it fixed: the test that compared `foldWithMap(s).folded`
  with `fold(s)` compared the function with its own wrapper. It now compares with the server's fold
  and asserts the map's invariants. Sol also added exact-span, astral-neighbour, lone-surrogate and
  rendered-text cases, ran its own probe (5,770,560 inputs, no failures), and measured the cluster
  walk at 18–23% slower than the old loop: about 0.1 ms a paragraph, 5–6 ms over a full page of
  thirty hits. Accepted.
- Gates: `npm run typecheck` green. `npm test`: 30,698 passed; the 5 red files are the ones a
  fresh worktree reds for want of `api-dist/` and the fleet client build, none in this cluster.
