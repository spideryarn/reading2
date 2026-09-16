# Citations marked in the prose, and a *Find it* button that says what it does

**Status as of 2026-09-16: built, reviewed twice by GPT Sol, and looked at in a browser** — evidence:
`MarkKind` in [`src/web/annotate.ts`](../../src/web/annotate.ts) has `"cite"`, and
`CitationsPanel.tsx` imports `ControlTip`.

**One bug got through every test and was found in a browser**, and it is worth reading before
anything else here: the `proseHtml` memo read the citation marks and did not depend on them, so a
list arriving after the first render — which is always, since it is a separate `GET` — drew nothing,
intermittently, depending on whether anything else happened to invalidate the memo afterwards.
[260916a](../postmortems/260916a-a-memo-that-read-a-map-it-did-not-depend-on.md) is the write-up; the
short version is that `npm run lint` had been naming it the whole time and no test could have caught
it, because every test rendered the blocks and the list together, which is the one sequence the app
never performs.

The review is
[260916b-…-review-sol.md](260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button-review-sol.md),
against the prompt beside it. It found no P0 and six P1s, **and two of its findings are corrections
to conclusions this plan had stated as verified** — the tap-selection list and the sanitiser version
bump. Every section it touched says so in place rather than being quietly rewritten, because the
reasoning that was wrong is the useful part.

Two feedback reports, both from Greg, both about Citations mode
([citations.md](../project/citations.md)). Both are admin reports, so the question is *how*, not
*whether* — [feedback-reports.md § Who sent it](../project/feedback-reports.md).

**SPIDERYARN-READING2-3M**, 2026-09-12:

> And (just as we do with quotes and glossary), once generated, we should always visually indicate
> Citations somehow in the main text (with tooltip/clickable, that pops up a panel for the citation
> with various useful information & actions. Use Fable for product input on this.

**SPIDERYARN-READING2-3K**, 2026-09-12:

> In Citation mode, there's a "Find it" button - make it clearer what that does (e.g. rich tooltip)
> and the effect of running it

They are one plan because 3K is half an hour and shares a file with 3M's panel work, not because
they are one idea.

---

## What Fable said, and the one thing it changed

Fable's product read (2026-09-16, consulted because Greg asked for it by name) agreed the feature
should exist and moved one thing, which is worth stating first because the rest of this plan is
downstream of it:

> "a panel for the citation" is not a new hover machine; it is a **third section in the card that
> exists** … Building a second card would be the mistake the glossary/link merge was made to avoid.

[`ProseHoverCard.tsx`](../../src/web/ProseHoverCard.tsx) already composes several sections off one
`Hit` struct — 0..n glossary `TermCard`s, a `NoteCard` for a footnote marker, a `LinkCard` for a
hyperlink. A citation is a fourth section, added the way `note` was. So this plan builds **no new
hover component**, which is most of the engineering gone.

Fable's other calls, all taken:

- **All works get marked, not just the ones above the threshold bar.** The quotes rule ("mark
  exactly what the panel is showing, and the bar doubles as the density control") is wrong here. A
  citation is a standing fact about the text, like a glossary term, not a selection somebody made;
  and the prose mark is visible in *every* mode while `?citebar=` is only reachable in Citations
  mode. Fable: *"A bar you can't see is a bug wearing a setting."*
- **Do not wash the `citedAt`-only paragraphs.** We have precise spans for at most three mentions
  per work; beyond that we know only which paragraph. Marking a whole paragraph to mean "something
  in here cites something" is the vague version of the question. The card closes that gap **with
  words** — *cited in 7 paragraphs*, counted from `citedAt.length` — rather than with a mark.
- **The card's one job is *what is this, and can I get it*.** Title, authors · year, the link with
  its honest provenance, then `why` — the one line that is ours rather than the author's.
- **Scores and *Find it* stay in the band.** *Find it* is a billed, rate-limited press; a surface
  that opens by accident on hover is the wrong place for it, and that is a decision, not an
  oversight.

Where this plan departs from Fable: **the visual channel** (§ The mark), for a reason Fable could
not have known without reading `prose.css`.

---

## The mark

### What gets marked

Every work's verified places: its `mentions` (at most 3) and its `reference`, if the article has a
bibliography entry for it. Both are `CitationPlace` — `{ blockId, quote, start }` where `quote` is
**the article's own characters sliced out of the block**, not the model's typing
([`verifyPlace`](../../src/citations.ts)). That is the same provenance `Quote.text` has, which is
what makes quotes the right precedent and not merely the nearest one.

A place whose words cannot be re-found in the rendered text draws **no mark**. See § The whole-block
fallback is wrong here, which is the one place this must not copy quotes.

### `start` is not passed on, and a repeat draws nothing

`CitationPlace.start` is an offset into `block.text`, and every mark in
[`annotate.ts`](../../src/web/annotate.ts) lives in the rendered-text space of `block.html`. The two
strings are different lengths — `extractText` collapses whitespace and inserts a space at every
nested block boundary — so passing the stored offset as a disambiguating hint does not disambiguate,
it misdirects. GPT Sol reproduced exactly this for quotes: `block.text` put the first occurrence at
120 while the rendered occurrences were at 60 and 126, so the hint chose the second sentence
([`resolveQuotes`](../../src/web/search-hits.ts)).

**The first draft of this plan then argued that the first *rendered* occurrence must therefore be
the one that was meant, because `verifyPlace` takes the first occurrence in `block.text`. That is
too strong, and GPT Sol was right to refuse it** (review finding 1). `verifyPlace` does omit `near`
on both of its branches — the named block and the relocated-to-exactly-one-other block — but the
relocation check establishes uniqueness *across* blocks, not within the one it settles on. And
because the two strings undergo different whitespace transformations, "first in `block.text`" does
not prove "first in the rendered text" names the same characters. The quotes version of this
argument survives only because `locate` in `src/quotes.ts` has a property `verifyPlace` does not.

So this does not take the first occurrence. **It takes the only occurrence, or none:**
[`findOnlyQuote`](../../src/quote-match.ts) — *"one match is safe, two matches are no answer"* — which
is the existing answer to exactly this situation, already used where an offset from another string
space cannot disambiguate repeats.

`"forgiving"` passes, the default, and not `verifyPlace`'s `"spaced"`. The two are asking different
questions: `verifyPlace` asks *did the model copy this*, where a whitespace-insensitive match would
be too generous; this asks *where are these article characters in the rendered text*, and the
rendered text genuinely lacks whitespace `extractText` invented. Same call, and the same sentence,
as `resolveQuotes`.

**Not `resolveMark`**, which the first draft named: it requires an `Anchor` carrying a `start` and
matches with an exact `indexOf`, so it would fail on precisely the whitespace difference this has to
absorb. The plan said *"do not pass `start`"* and *"use `resolveMark`"* in the same section, which
was a straight contradiction. `quoteFinder(text, passes)` is the shape to build on where a block is
asked about several works, because it prepares the haystack once.

The cost, named: a work cited twice in one paragraph **in identical words** draws no mark in that
paragraph. That is the safe direction — a mark on the wrong one of two repeats is a feature quietly
lying about where the words are — and marking every occurrence is on the deferred list.

### A fifth `MarkKind`, not a sixth `Found`

The obvious route is to mint `resolveCitations` beside `resolveQuotes` and get `baseMarks`,
`hitMarks`, the caching and the ring for free. **Rejected**, on two counts:

- **`Found`'s payload is wrong for a citation.** `runId`, `slot`, `confidence`, `valence`,
  `reasoning`, `short`, `long`, `at`, `whole` — a citation has none of them, so nine fields would be
  written `null` to satisfy a shape, and `resolveOne`'s comment is explicit that a seventh source
  must *decide* rather than inherit the answer of whichever resolver it copied.
- **The whole-block fallback is wrong here, and silently so.** `resolveOne` sets
  `whole = located === null` and falls back to `{ start: 0, end: text.length }` — the entire
  paragraph. That is right for a passage, whose model-supplied locator may have drifted. It is
  catastrophic for a citation: failing to find `(Tulving 1983)` would tint an entire paragraph, and
  nothing downstream distinguishes that from a deliberate mark. A citation that cannot be located
  must draw nothing.

So: `citeMarks(blocks, works)` in `annotate.ts`, beside `termMarks`, returning
`Map<BlockId, Mark[]>` with `kind: "cite"`. It uses `resolveMark`, which **returns `null` on a
miss** — the honest primitive, at the right level, already in the right file. `renderedText` is
computed once per block however many works want it, as `termMarks` does.

`MarkKind` becomes `"cmt" | "chat" | "term" | "hit" | "cite"`. `annotate.ts`'s own header names the
condition for reconsidering that shape — *"a kind needing per-mark styling that classes cannot
express"* — and a citation does not need one: a class and one attribute is all of it.

### The visual channel

Taken, on a run of prose: solid `border-bottom` = comment; **dotted** `border-bottom` = glossary
term; `box-shadow` outline = quote (weight and alpha carry priority); `background` wash = search
confidence; stacked coloured rules beneath = which saved search; `::after` glyph = comment ✳ or
valence sign; `::before` glyph = chat.

And — the fact that overturns Fable's recommendation — **`.prose a` is already `--highlight-ink`,
the orange.** Fable proposed drawing a bare mention *in the link colour family* so that
"Tulving (1983)" looks like the quiet link it conceptually is. In this app that would make a
citation mark indistinguishable from one of the article's own hyperlinks, which go somewhere when
pressed. A mark that looks like a link and does nothing is the quiet lie the app refuses.

**So: `text-decoration: underline dashed` with its own `text-decoration-color`, plus `cursor: help`
as the glossary term has — and `color: inherit`, always.** `text-decoration` is a channel nothing
currently uses (the underlines above are all `border-bottom`), which means a citation and a glossary
term over the same phrase can each keep their own line without either being redrawn.

**The ink itself is not ours to touch**, and that is a house rule rather than a preference:
`mark.cmt` sets `color: inherit` and the comment above it says why — *"The words themselves must not
change colour — this is the verbatim column, and recolouring the author's prose to advertise our
annotation is the small version of the thing vision.md § Principles refuses."* So the tint lives
entirely in `text-decoration-color`. This is what finally settles the disagreement with Fable, which
proposed tinting the words: the objection is not only that `.prose a` is already the orange, it is
that recolouring the author's prose is something this column does not do. GPT Sol, review finding 8.

**The risk, named: at 1px, dashed and dotted may not be tellable apart**, and the reader has already
learnt that a dotted rule means glossary. The fallback was `underline double` — two hairlines, plainly
distinct at a glance, and it reads as a reference rule. **This was decided at `/design`, not in
prose:** three citation specimens joined `SPECIMEN_MARKS` in
[`DesignPage.tsx`](../../src/web/DesignPage.tsx) for exactly this question.

**Answered 2026-09-16: keep dashed.** Looked at in a browser, zoomed, with pixel crops rather than by
eye — the second specimen is the one that decided it. The two strokes separate on three channels at
once, not one: the citation's dashed decoration sits on the text baseline in grey, and the glossary's
dotted rule sits several pixels lower in the warm highlight tint. Different colour, different
vertical position, different pattern. They read as two annotations rather than as one line drawn
twice.

Two further findings from the same pass, both about the case the specimens could not show:

- **On a real link-dense article the dash is not swamped by the anchor's own underline.** The worry
  was that a citation whose words are also one of the article's hyperlinks would lose its mark under
  the link's solid rule. Cropped side by side — a cited link against an uncited one — the dashed
  decoration draws over it and is what the eye picks up.
- **The density worry did not materialise.** The heaviest paragraph in *The Scaling Hypothesis*
  carries 38 mark fragments in ~3,800 characters and reads as a page, not a ransom note, because the
  line is thin and low-contrast on prose that was already hyperlink-dense. `underline double` would
  have been the wrong call here: heavier than a plain link's own underline, in exactly the paragraphs
  where there is most of it.

Overlap rules, written explicitly rather than left to cascade. Whether a dotted `border-bottom` and
a dashed `text-decoration` can both be drawn on one phrase without reading as a rendering bug is a
question for the specimen, not for this document — so the table says what to look at, and the answer
is written in after looking:

| overlap | what is drawn |
|---|---|
| `mark.term.cite` | both lines, if the specimen says they read as two things; else the term's rule wins and the citation keeps only its `cursor` and its card |
| `mark.cmt.cite` | as above, against the comment's solid rule |
| `mark.hit.cite` | both — the wash and the stroke are backgrounds and a `text-decoration` does not compete with either |

### The press is inert, as a term's is — and touch is in v1, because leaving it out breaks the page

Pressing a citation mark with a mouse does what pressing prose has always done: selects it. The way
into the work is the card, which opens on hover. That is the glossary's rule and there is no reason
for a second one.

**The first draft of this plan said `NOT_A_BLOCK_SELECTION` needs no change, and that touch could be
deferred. Both were wrong, and they were wrong together.** Found by tracing the code, and confirmed
independently by GPT Sol (review finding 2).

`NOT_A_BLOCK_SELECTION` in [`TableView.tsx`](../../src/web/TableView.tsx) is a comma-joined list that
`closest` reads as alternatives. So:

- **a bare `mark.cite` matches** its `"mark:not(.hit)"` entry and is excluded from the
  block-selection tap — which is what the first draft saw and stopped at;
- **a `mark.hit.cite`** — a citation inside a quoted sentence — **does not match anything**, because
  the list names `mark.hit.cmt`, `mark.hit.chat` and `mark.hit.term` one by one and has no entry for
  a citation. So it falls through to block selection, while the identical case for a glossary term
  does not.

And the first of those is only correct **if something acts on the tap**. The exclusion list's own
comment says so in as many words: every other mark is excluded *because a tap on it already means
something*, and a quote is carved out precisely because nothing acts on it. Defer touch and a
citation mark becomes the one thing the list was written to prevent — a small dead hole in the
paragraph where a tap opens no card *and* selects no row. A densely-cited paragraph would be
peppered with them. Traced through [`useHoverCard.ts`](../../src/web/useHoverCard.ts): `swallowed`
only fires when `handled` is set, and `handled` is only set for a `tapSelector` match, so a kind
outside `tapSelector` is acted on by nothing at all.

**So touch lands with the rest of it**, and it turns out to be cheap:

- `mark.cite` joins `tapSelector`, so the first tap opens the card — `reveal()`, the spine's rule,
  the same one a glossary term gets;
- `"mark.hit.cite"` joins `NOT_A_BLOCK_SELECTION`, so a citation inside a quote behaves like a term
  inside a quote;
- **A bare citation adds no `onCommit` branch.** The precedence problem the first draft called a blocker — one
  `<mark>` carrying both `term` and `cite`, with `closest` matching both and the if-chain silently
  picking whichever was written first — simply does not arise, because a citation's card needs no
  commit: its action is the outbound link, and the card takes pointer events, so the reader taps the
  link *in the card*. A second tap falls through every branch and leaves the card up, which is the
  right thing for it to do. **Code review found one exception:** if the cited words are also the
  author's internal link, adding `mark.cite` makes the mark the intercepted tap target. That
  resolved anchor commits through `onJump` on the second tap, preserving the link's existing
  behaviour; note and glossary precedence remain above it.

That last point is what makes cutting the foot button (§ Stages) cost nothing on touch.

### The sanitiser

Every `data-*` attribute `annotateHtml` can write must be in `FORBID_ATTR`, and every class it
writes must be in the reserved-class strip — or an article ships its own and draws a mark nobody
made. This has been forgotten before, which is why it is a numbered step here and has its own test:
[`sanitize-policy.ts`](../../src/sanitize-policy.ts) calls the quote attributes the **third** such
omission, and [`tests/sanitize.test.ts`](../../tests/sanitize.test.ts) enumerates three attribute
episodes, with a reserved-class omission separately. *(The first draft of this plan said "twice",
from reading one comment rather than the list. GPT Sol, review finding 3.)*

**Three changes, not two:**

- `FORBID_ATTR` gains `"data-cite"`.
- The reserved-class loop gains `"cite"`.
- **`SANITIZER_VERSION` goes 6 → 7.** This is the one the first draft missed, and it is the one that
  matters: the file's own instruction is to bump *whenever a change here means an already-stored
  artefact could now be wrong*, and a new forbidden attribute is exactly that. Without the bump,
  every block already stored under version 6 is never re-sanitised, so an article ingested before
  today could keep a `data-cite` it shipped itself — which is the whole hole this step exists to
  close, left open by the step that was supposed to close it.

A forged `data-cite` would be a stranger's document putting *we found the work this phrase cites*
onto a phrase they chose, and pointing our hover card at a work id of their choosing. It is the same
class of hole as the forged `data-chat` that shipped for a day in August.

---

## The card

A `CiteCard` section in `ProseHoverCard`, added the way `NoteCard` was. Reading order:

1. **Title**, and the link — through the panel's own `sourceOf`, so a `search` row is drawn as a
   search with the title *unlinked* and the one link saying *search Scholar*. One function, not two
   spellings: the panel's promise that a reader can always tell an address the article gave from one
   we built is worth nothing if the card quietly makes a different one.
2. **authors · year**, as the article gives them.
3. **`why`** — the one plain sentence on what the piece uses the work for. Fable: *"That is the
   augmentation; the citation itself is the author's."*
4. **Where else it is cited** — *cited in 7 paragraphs*, from `citedAt.length`, or *only in the
   references* when `citedInBody` is false. Words, not marks: the honest answer to the
   mentions-past-three gap without calling a bibliography-only work “cited in 0 paragraphs.”
Not in the card, and each is a decision: the two score bars (glossary parity — the card says
meaning, the band says numbers); *Find it* (billed; § above).

### No foot button, and therefore no `?cite=`

The first draft gave the card an *In Citations* foot button, matching the glossary's. That needs a
URL parameter the mode reads, and Citations has none — `?cite=` is on
[260911g](260911g-citations-mode.md)'s deferred list. It also needs the glossary's *other* half: a
work the threshold bar is hiding cannot be opened, or pressing the button lands the reader in a band
with no such row in it, which is the panel asked to select something it is not drawing
(`gateToReveal` is the glossary's answer, and `barToReveal` would be its mirror).

**Cut**, on GPT Sol's scope finding: it is a separate interaction feature and is not needed to answer
3M. The smallest complete version is the marks, a card holding the work and what the piece uses it
for, and an outbound action.

**The card is not left without an action** — the link out *is* the action, and it is the one Fable
says a hovering reader actually wants. It is also what makes cutting this free on touch (§ The press
is inert): with no foot button a **bare citation** has nothing for a second tap to commit to, so the
term/citation precedence question never arises. An author's internal link around those words keeps
its pre-existing second-tap jump, as § The press is inert now records.

---

## Where the list comes from

`useCitations` is mounted by `CitationsBand` alone, and its own docstring says why — *"nothing
outside the band reads the list (no marks in the prose in v1)"*. That sentence is what this plan
changes.

The split is `useQuotesRead` / `useQuotes`, which is itself `useGlossaryRead`'s split one feature
later, and both are in this repo already:

| | mounted by | what it is |
|---|---|---|
| `useCitationsRead` | `OwnedReader`, once | one `GET /api/citations/:slug` |
| `useCitations` | `CitationsBand`, in citations mode | the job poll, the auto-run, `find`, `regenerate` |

**The job poller and the auto-run stay in the band, deliberately.** Hoisting the whole hook would be
two bugs, both already found once: `useStepJob` subscribes through `useJobs`, and a subscriber holds
the job engine to its eight-second idle cadence for every reader of every article; and
`useAutoRun`'s owner lives for the hook's mount, so an owner mounted up in `OwnedReader` could claim
a Citations press, watch the reader leave the band, and spend the token when the GET finally settled.
GPT Sol, 2026-09-08, on the quotes version of this exact move.

**An always-mounted read is not an always-fresh read**, and this inherits the gap its two siblings
have: a list written while the band was closed does not reach the prose until the band is opened
again or the page is reloaded. Named rather than fixed, because the honest fix belongs to all three
at once.

### `find` still belongs to the band, and needs a seam

`find` POSTs, so it stays in `CitationsBand` with the poller and the auto-run — but today it patches
the list itself, through the `setCitations` that is about to move into the read hook. And that patch
is not incidental: it carries the F14 guard, *only a row that is still a search*, so that a re-run
landing inside a find cannot have a stale row merged back over a link the article gave
([`tests/citations-find-late-reply.test.tsx`](../../tests/citations-find-late-reply.test.tsx) pins
it).

**So `CitationsRead` exposes a narrow `applyFound(id, { url, linkFrom, found })`**, and `find` calls
it. Not `refresh()`, which Sol offered as the simpler option: a whole extra `GET` after every paid
find, and the F14 condition would then live nowhere. Not hoisting `find`, which would put a POST in
`OwnedReader`. GPT Sol, review finding 4 — the hook split is safe *once this seam is named*, and the
first draft had not named it.

### Owner-only comes free, and the GET is unconditional

`OwnedReader` is the mount, so a visitor has no `works`, hence no marks and no card section. That is
[citations.md § Who sees it](../project/citations.md#who-sees-it) satisfied by construction rather
than by a check, and it is what Fable asked for: a visitor must not get a half-working card, because
the public projection these URLs would pass through is not built.

**The first draft gated the read on the experimental switch, to save a `GET` for readers who cannot
see the mode. Dropped**, on GPT Sol's finding 5, and the decisive argument is not the one about
consistency:

- the gate does not actually work. `CitationsBand` has to read the list somehow. If it keeps a read
  of its own there are two states and two requests; if it refreshes the shared one, the prose marks
  appear anyway — so the switch-off case either costs more than it saves or does not hold.
- and it reads the experimental contract backwards.
  [experimental-features.md](../project/experimental-features.md) says the switch **hides controls**;
  it does not make an existing `?mode=citations` URL half-work.

It is a cheap read and not a model call, and *"once generated, we should always visually indicate"*
is what the report asked for. A fourth owner-only `GET` is the price.

---

## 3K: the *Find it* button

Today it is a native `title=`:

> Searches the web for this work, and keeps a page only if a search result is plainly its own. A few
> seconds; kept afterwards.

[tooltips.md](../project/tooltips.md) argues at length that a `title` is not a small `ControlTip`:
it waits about a second, cannot be styled, truncates at the OS's idea of a line, and **does not
exist at all on a touch device**. `CitationsPanel.tsx` imports no `Tooltip` today, so this is the
first one in the file.

`ControlTip`'s contract is `head` / `state?` / `what` / `how`, and the house rule is that `what` is
what a reader could have guessed by pressing and **`how` is what they could not** — where the answer
comes from, what it costs, what the control does *not* promise. A `how` that restates `what` is the
documented failure.

**Three things the copy may not say**, and the first draft of this plan said all three. GPT Sol,
review finding 6:

- **not "one model call"**, and not any call count. There is already a regression test forbidding
  exactly this, in the file this change touches:
  [`tests/citations-panel.test.tsx`](../../tests/citations-panel.test.tsx) asserts the button's copy
  does **not** match `/one web search|model call/i`, because nothing bounds how many searches the
  provider runs inside the one call ([citations.md § It is one call, not one
  search](../project/citations.md)) — and because *"a reader should not meet 'model call'"*. The
  draft copy would have gone red on a test written to prevent precisely it.
- **not "at the same price"**, for the same reason: the attached search is variable work.
- **not "its own page"**, which is stronger than the validator. `namesTitle` / `pageNamesTitle`
  accept a result whose *title or excerpt* carries the work's title — so a review of the paper, or a
  discussion of it, can pass. The row already says *found on the web* rather than claiming more.

Draft copy, within those bounds:

- **head:** `Find it on the web`
- **what:** `Searches the web for a page about this work, and puts a link on this row in place of the
  Scholar search when a result clearly matches the title.`
- **how:** `A web search on a paid service, so it takes a few seconds and costs something. Nothing is
  kept unless code can match a result to this work's title — otherwise the Scholar search stays, and
  trying again spends again. Only rows the article gave no link for have this button.`

What that `how` adds to the `title` it replaces, which is 3K's actual question:

- **it costs money and it reaches a third party** ([ai-gateway.md](../project/ai-gateway.md));
- **what running it changes** — on a match the row's link is replaced and the find is stored in
  `citation_finds`, so it survives a reload and a re-run of the list;
- **what it does not promise** — a no-match stores nothing, so pressing repeatedly is not a way of
  making progress. This is the honest half, and the `title` omitted it.

**And the existing test has to move with the button**, which is the part that is easy to miss: it
reads `button?.title`, and a `ControlTip` leaves that attribute empty. So the assertion has to be
re-pointed at the card's text, not deleted — a copy rule that stops being checked because the copy
moved is worse than one that was never written. The same test also checks
`MODE_CATALOG.citations.how`, which is not changing.

`placement="bottom"` and `keepSide`, as every control in a row uses, since this button sits in the
`cite-meta` line hard against its neighbours.

**The disabled case.** The button is `disabled` while any row's find runs. A disabled button does not
reliably raise a native tooltip — which is part of the argument for `ControlTip` — but Floating UI's
hover on a `disabled` child has the same problem. `CriteriaPanel.tsx` solves this with
`aria-disabled` rather than `disabled` so the cost card stays readable; **follow that**, and keep the
press guarded in the handler rather than by the attribute.

---

## Stages

Each stage is a commit, and each ends with a GPT Sol code review before the next starts, per
[AGENTS.md](../../AGENTS.md).

1. **3K — the *Find it* tooltip.** `ControlTip` on the button, `aria-disabled` rather than
   `disabled` so the card stays readable, the press guard moved into the handler. Tests: the card's
   parts exist and `how` is not a restatement of `what` or of the label
   (`tests/referee-tooltips.test.tsx` is the idiom), and **the existing no-call-count assertion
   re-pointed from `button.title` to the card**. Independent of everything below, so it lands first.
2. **The marks.** `MarkKind` gains `"cite"`; `citeMarks` in `annotate.ts` over `findOnlyQuote`;
   `annotateHtml`'s partition, class and `data-cite`; the **three** sanitiser changes;
   `annotations.css`; the `/design` specimen. Tests, in the shape of `tests/quote-marks.test.ts`
   (jsdom, because these spans live in the browser's offset space) — and the two assertions that
   earn their keep are **that a place which cannot be re-found draws nothing rather than the whole
   block**, and **that a quote occurring twice in one block draws nothing rather than the first**.
   Plus a sanitiser test that a forged `data-cite` and a forged `class="cite"` are both stripped, and
   that the version bump re-cleans a block stored under 6.
3. **The list reaches the prose.** `useCitationsRead` split out with `applyFound`, mounted
   unconditionally in `OwnedReader`, threaded to `TableView` and `ProseHoverCard`. Tests: a visitor
   issues no citations `GET` (`tests/public-network-trace.test.tsx` is the idiom); the band still
   works when the prose has no list; and **the F14 late-reply guard still holds through the new
   seam**, which is `tests/citations-find-late-reply.test.tsx` and is the test most likely to be
   quietly broken by this stage.
4. **The card, and touch.** `Hit.citeIds`, `read`, the selector, `CiteCard`, the `aria-label`, both
   "nothing to say" guards; `mark.cite` into `tapSelector`; `"mark.hit.cite"` into
   `NOT_A_BLOCK_SELECTION`. Tests: the card draws a `search` row as a search and never as the work's
   address — the one property `tests/citations-panel.test.tsx` already holds for the band, held again
   here because two surfaces drawing provenance differently is the failure worth pinning; and a
   block-selection test that a tap on a citation is not a dead zone
   (`tests/block-selection-by-tap.test.tsx` is the idiom).

Four stages, not five. Stage 1 answers 3K on its own; stages 2–4 are 3M.

---

## Deferred, with reasons

- **`?cite=`, the *In Citations* foot button, and `barToReveal`** — § No foot button, and therefore
  no `?cite=`. The natural next thing to build, and the whole of what the card gives up.
- **Marking every occurrence of a mention in its block**, rather than only an unambiguous one. Needs
  a multiplicity-aware span walk in `quote-match.ts` that does not exist; the cost of not having it
  is one paragraph's marks where a work is cited twice in identical words — § `start` is not passed
  on.
- **Joining the citation section to the *link* and *note* cards.** Fable's strongest structural
  idea: where a hovered hyperlink or footnote marker resolves to a cited work, the same `CiteCard`
  should join the card already opening there, so a Wikipedia-shaped article gets the feature
  everywhere rather than mostly in its reference list. It needs a work → `reference.blockId` →
  `noteId` → markers derivation that has to be verified client-side before it can be promised, and
  it is additive to everything above. Second afternoon.
- **`?cite=` marking every passage that cites the selected work**, and the spine rail — the other
  half of the parameter, as 260911g deferred it.
- **Scores in the card**, *Find more* past the cap, a visitor's marks, real influence — all
  unchanged from 260911g's list.

---

## The simpler option passed over

**Mark nothing in the prose; put a *jump to this passage* control on each row in the band instead.**
It is a tenth of the work and the row already has one (`first cited`, through `BlockRef`). It was
passed over because it answers a different question: the row-to-prose direction already exists, and
what 3M asks for is the prose-to-row direction — the reader who is *reading*, meets a name, and wants
to know what it is without leaving the sentence. That is the whole of why this feature is in the
prose and not in the band, and it is the same argument that put the glossary's underlines there.

---

Up: [citations.md](../project/citations.md) · [plans.md](../project/plans.md)
