# Review prompt — Stage P of the Debate eval plan, all three commits

You are reviewing built code, not a plan. Weight this higher than a plan-stage review: a plan review
cannot find a `PATCH` that writes one field and then rejects the request, and this stage has a
threshold, a matcher and four reader-facing sentences in it.

## What the feature is

Spideryarn's **Debate mode** searches the open web for pages that respond to the article the reader is
reading. Two separately metered searches run: one for pages that respond to **this piece**, one for
pages that engage **a claim it makes**. Every row must cite a URL the search actually returned, and
every quotation must be located in that page's search extract or the row is dropped and counted.

The problem Stage P fixes: the only proof that a page was about *this* article was that the page
contained the article's **title**. On a 2023 article with a same-named 2026 successor at a different
URL, **six pages about the wrong document** were reported as reception, and one survived every check
into the panel.

## What Stage P did, in three commits

- **`35db7d53`** — `identifies` on `DirectDebateRow` (`linked` | `quoted` | `named`),
  `identificationLevel` as a lookup over a fixed order, and `src/shingles.ts`: an 8-word/40-character
  shingle matcher giving **coverage** (share of the article's windows found in the page's extract) and
  **density** (share of the extract's own windows found in the article). Coverage is the **floor** —
  any hit makes a row `quoted`. Density is the **ceiling** — ≥ 50% over ≥ 5 windows means the page is a
  *copy* of the article, and the row is dropped as a new loss reason `sourceIsCopy`.
- **`f344a207`** — the panel becomes **one list** instead of two headed groups; each row self-labels
  with a chip whose tooltip lists every signal; the empty first section becomes one sentence.
- **`04f7b367`** — a **threshold bar** on the level, `?name=` carrying the word, defaulting to
  `quoted`, over direct rows only.

The plan, with the measurements and the reasoning behind every number, is
`docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md` — read § "2 — a level that
*is* one of the facts", § "The ceiling counts density, not coverage", § "1 — combine them", § "The
bar", and § "Stage P".

## House rules this code is meant to obey

- **`docs/reusable/silent-success.md`** — a list quietly shorter than what the model produced must say
  so on screen. Every loss counter must reach the reader. This is the rule the stage is most at risk
  of breaking, because it *added* a counter.
- **`docs/project/quotes.md`** refuses a composite score dressed as the model's judgment. The level is
  the **name of the strongest fact**, never a weighted sum. A number on screen would be that refusal
  broken.
- **`src/web/threshold.ts`** — the visible list, the `N of M`, the hidden count and the foot line must
  come out of **one** pass. *A count that disagrees with the list under it is this feature's worst
  failure.*
- **`docs/project/block-ids.md`** — text is addressed by stable block id, never by offset.

## What I want you to attack, in order

1. **Can any counter, row or loss go silent?** A row dropped without being counted; a counter that
   reads `undefined` off a stored artefact and vanishes through `NaN`; a sentence whose guard makes it
   unreachable; a number on screen that disagrees with the list under it. One instance of this class
   already shipped in this stage and was caught in a browser, not by a test.
2. **The density ceiling.** Is 50% over ≥ 5 windows right, and is `isCopy` reachable and correctly
   placed — before the row is kept, not after? What kind of genuine page does it refuse? A page that
   quotes the article at length (a fisking) is the case I am most worried about, and I have no example
   of one.
3. **The shingle matcher itself** (`src/shingles.ts`). Correctness of both ratios, the block-boundary
   decision, empty and tiny inputs, and whether `quoteFinder` in `src/quote-match.ts` is truly
   behaviour-identical to the `findQuote` it replaced — that function is shared by comments, marks,
   search and referee.
4. **The bar.** Can a claim row reach it? Can `?name=` produce a state the slider cannot show, or a
   count that disagrees with the rows? Does an unrecognised value fail safe?
5. **Artefact compatibility.** Stored debate JSONB predates both `identifies` and `sourceIsCopy`.
   `identifiesOf` and `lossesOf` in `src/types.ts` are the two places that is handled. Is there a third
   path that is not?

## Severity scale — use exactly these, and put an ID on every finding

- **P0** — data loss, a security hole, or a reader shown something false.
- **P1** — a real defect that will bite: wrong output, a broken invariant, a silent drop.
- **P2** — a genuine improvement that is not a defect.
- **P3** — taste.

Number them `F1`, `F2`, … Say for each: the file and line, what breaks, and the input that breaks it.
**If you cannot name an input that produces the failure, say so and mark it lower.**

## Run something rather than only reading it

Your sandbox has no network and no Postgres, so anything touching a database is mine to run — tell me
what you want and I will run it and hand you the raw output. These three need nothing outside the
tree, and I would rather you ran at least one than reasoned about all of them:

```
npx vitest run tests/shingles.test.ts
npx vitest run tests/debate-bar.test.ts
npx vitest run tests/debate-identification.test.ts
```

## My own suspicions, last, so they do not steer you

Read these only after you have formed your own view; several of my confident claims this week have
been wrong, and two were caught by measurement rather than by review.

- The density ceiling has **no demonstrated positive case**: no mirror has ever been reported as a row,
  so `sourceIsCopy` reads `0` on the entire corpus. I built it anyway. Tell me if that is wrong.
- `identifiesOf` returns a non-empty tuple by falling back to `named`. I think that is right for old
  artefacts and I am not sure it is right for a *new* row that somehow arrives with an empty list.
- The panel now has three counts on one screen — pages returned, pages contributing, responses hidden.
  I believe the nouns disambiguate them. I am not confident.
- `quoteFinder` memoises a reduced haystack. I checked it against the old implementation over 5,548
  comparisons for zero disagreements, but only on three articles' prose.
