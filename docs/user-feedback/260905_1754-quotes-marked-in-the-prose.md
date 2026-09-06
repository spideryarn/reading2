# Quotes, marked in the prose

**[SPIDERYARN-READING2-1Z](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1Z)** · reported
2026-09-05 17:54 UTC · *shipped, and most of it already existed*

## What Greg said

He dictated a long think-aloud that starts by asking for a new "highlights" mode and then talks
itself out of it:

> The goal of highlights would be to highlight the text so that I could skim through it just reading
> the stuff that is marked as, like, really good. … quotes is related but not exactly the same. …
> So maybe highlights and quotes are the same thing. So why don't we start by expanding the quotes
> mode and not create a new one? … a bit like the glossary, we have some notion of … importance. …
> ordering, you know, by placement in the text or by importance or prioritized, which should be the
> default ordering. And prioritized has a UI slider. … And then the key thing is that we highlight
> the quotes in the text, perhaps. Um I was thinking bold, but actually, maybe better would be like
> a yellow highlighter pen.

## Almost all of it shipped a week ago, and he never found it

`Quote.importance` and `Quote.striking`, `?rank=` with four orders including `prioritised`, and the
`?bar=` threshold slider modelled on the glossary — all live since 2026-08-31 and 2026-09-03. And *"the
highlights should be a span rather than a block"* was already true: a quote is `blockId` + verbatim
text + `start`, drawn through the same mark machinery a search hit uses.

**One line was missing, and it was the one that made the whole mode look inert.** The prose marked
only the *selected* quote, so nothing was highlighted until you clicked a row, and moving the slider
changed the list without changing the page. Hence "let's add highlights": the highlighter was there
and was drawing one line at a time.

## What changed

`useQuotesMode` resolves the **whole list the panel is showing**, through a `markedQuotes()` that the
panel and the band both call — so the rows and the washes are one set, and **`?bar=` is now the
highlight-density control**, which is what he described.

Two details that were load-bearing rather than incidental:

- **Every quote shares one `runId`**, not one each. The paragraph rail packs one lane per run id into
  a 10px gutter, so a run id per quote would have been sixteen overlapping 1.5px lanes ordered by an
  arbitrary string. Per-quote identity moved into `Found.key`.
- **The pressed quote now gets the `[data-hit-open]` ring.** It needed no such thing when it was the
  only mark on the page; it needs one as one of thirty-two.

More quotes, since he asked for "many more": `MAX_QUOTES` 16 → **32**, and the suggestion goes from
one per 600 words (4–16) to one per 300 (8–32) — a 4,000-word piece asks for 14 rather than 7. Not
higher, because every row still claims a line is worth carrying out of the article, and the slider
can hide an excess but cannot make a padded line good. `PROMPT_VERSION` → `quotes/3`, so existing
lists show the quiet *"chosen by an earlier version of the prompt"* banner rather than the alarming
`stale` one.

## The decision left for Greg: the yellow highlighter

Not made, deliberately. `mark.hit` is a low-chroma slate because **the wash channel carries
confidence and the hue channel carries which search found it** — Greg's own call, 2026-08-26 — and a
quote mark *is* a search hit by design. Yellow costs one of two things:

- **borrow the hue channel** — cheap, but it puts a colour with a fixed meaning into a palette whose
  meanings are assigned per run;
- **add a quotes-specific wash** — honest, but it is a second way of drawing a marked passage, which
  is the thing this band exists not to have.

Worth two minutes now that the page actually looks highlighted.

## Evidence

`tests/quote-marks.test.ts` (new, 8 cases) was red before the code existed, and the assertion that
carries it is `expect(found).toHaveLength(3)` **with nothing selected** — a test asserting "the
selected quote is marked" passes against the bug. Two wiring tests in
`tests/glossary-band-wiring.test.ts` were red against the real old `App.tsx`, printing the old
`if (!selected) return []` memo verbatim.

Looked at in a real browser rather than only in jsdom: all quotes washed with nothing pressed, the
pressed one heavier with a hairline ring while its neighbour stays plain, rail at `--lanes: 1`. The
honest impression from that pass: *"reads comfortably… a few sentences someone marked, not a wall of
highlighter."*

**Not built:** a separate highlights mode. He talked himself out of it mid-dictation, and taking him
at his word is the simpler product.
