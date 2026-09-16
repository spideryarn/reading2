# Review this plan before it is built

You are reviewing a **plan**, not code. Nothing in it has been built. Please read the plan and the
code it names, and come back with findings. Read-only: do not edit anything.

Repo root is this worktree. The plan is
`docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md`. Read it first,
in full.

## Context you will want

- `AGENTS.md` (= `CLAUDE.md`) — the house rules. In particular "simplest version first", "prefer
  simple over easy", "let the types catch it", and `docs/reusable/silent-success.md`.
- `docs/project/citations.md` — what Citations mode is today, and its deferred list.
- `docs/project/quotes.md` § "Every visible quote is marked, in every mode, and the bar is how many"
  — the nearest precedent.
- `docs/project/glossary.md` § "Finding the term in the prose" and § "The hover card".
- `docs/plans/260911g-citations-mode.md` — the plan this one extends, and your own earlier findings
  on it (F4, F7, F11 are referenced).
- The code the plan names: `src/web/annotate.ts`, `src/web/search-hits.ts`,
  `src/web/ProseHoverCard.tsx`, `src/web/useHoverCard.ts`, `src/web/CitationsPanel.tsx`,
  `src/web/useCitations.ts`, `src/web/useQuotes.ts`, `src/web/reader/useQuoteMarks.ts`,
  `src/web/reader/passages.ts`, `src/web/article/ArticlePage.tsx`, `src/sanitize-policy.ts`,
  `src/citations.ts`, `src/types.ts` (§ citations), `src/web/styles/annotations.css`,
  `src/web/styles/prose.css`, `src/web/Tooltip.tsx`.

## The two reports being answered

Both from Greg, who owns the product, on 2026-09-12.

SPIDERYARN-READING2-3M:
> And (just as we do with quotes and glossary), once generated, we should always visually indicate
> Citations somehow in the main text (with tooltip/clickable, that pops up a panel for the citation
> with various useful information & actions. Use Fable for product input on this.

SPIDERYARN-READING2-3K:
> In Citation mode, there's a "Find it" button - make it clearer what that does (e.g. rich tooltip)
> and the effect of running it

## The conclusions I would least like to be wrong about

Please check these directly and say so if any is false. Each is load-bearing: if one is wrong, a
section of the plan is wrong.

1. **`CitationPlace.start` must NOT be passed to the span resolver.** My argument is that
   `verifyPlace` in `src/citations.ts` calls `findQuote(block.text, quote, undefined, "spaced")`
   with no `near` hint, so the stored place is always the FIRST occurrence in `block.text`, and
   therefore the first occurrence in the RENDERED text is the one that was meant — the same argument
   `resolveQuotes` makes. Is that actually true of `verifyPlace`, including its "relocated to
   exactly one other block" branch? And is the rendered-vs-`block.text` offset hazard as I describe
   it?

2. **Building citation marks on `Found`/`resolveOne` would be a bug, not just a poor fit**, because
   `resolveOne` falls back to `{start: 0, end: text.length}` — the whole block — when the quote
   cannot be located, and a citation that cannot be located must draw nothing. Is that fallback
   really unconditional, and is there any existing caller that already suppresses it that I have
   missed (which would make the `Found` route viable after all)?

3. **`NOT_A_BLOCK_SELECTION` in `TableView.tsx` needs no change**, because `mark.cite` already
   matches its `"mark:not(.hit)"` entry. I read this off the selector list rather than running it.
   Please check it, including the `closest()` semantics — and check whether a `<mark>` carrying BOTH
   `cite` and `hit` classes (a citation inside a quoted sentence) falls the right way.

4. **The sanitiser needs exactly two additions** — `"data-cite"` in `FORBID_ATTR`, and `"cite"` in
   the reserved-class strip loop. Is there a third place an annotation class or attribute has to be
   registered that I have missed? The plan claims this has been forgotten twice before; please
   check whether the version history really says that, and whether the list I need is longer than
   two.

5. **`useCitationsRead` hoisted to `OwnedReader` is safe**, because the job poller (`useStepJob`)
   and the activation owner (`useAutoRun`) stay down in `CitationsBand`. This copies the quotes
   split you reviewed on 2026-09-08. Is there anything in `useCitations` BESIDES those two that must
   not be hoisted — in particular the `find` verb, `findNote`, or anything that can POST?

## The decisions I most want challenged

- **Gating the hoisted `GET` on the experimental switch** (§ Owner-only comes free; the experimental
  switch does not). This means a reader who reaches `?mode=citations` by URL with the switch off
  gets the band but no prose marks — the band and the prose disagree about how much they know. The
  alternative is an unconditional fourth `GET` on every owner's article load. Which is right?
- **Marking ALL works rather than only those above the `?citebar=` threshold**, which departs from
  the quotes rule. My argument is that the bar is unreachable from the modes where the mark is
  visible. Does that hold, and does it create a state that looks broken (a work marked in the prose
  whose row the band is hiding)?
- **The visual channel**: `text-decoration: underline dashed` in a new quiet non-orange tint. I
  rejected the product adviser's "draw it in the link colour" because `.prose a` is already
  `--highlight-ink`. Is `text-decoration` genuinely unused by the existing marks, and will a dashed
  1px rule be distinguishable from the glossary's dotted `border-bottom`? Is the `underline double`
  fallback better as the primary?
- **Scope.** Five stages is a lot for one feedback report. If you think this should be cut, say what
  to cut and what the smallest version that still answers 3M is. The house rule is "simplest version
  first", and I would rather be told now than after building it.

## What I want back

Numbered findings, each with a severity (P0 blocks building / P1 fix in the plan / P2 worth knowing),
the file and line where you checked it, and what you would do instead. Please say explicitly which
of my five conclusions above you verified and which you could not. If the plan is broadly right, say
so — a short review is a fine outcome.
