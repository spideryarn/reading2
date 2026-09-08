# Quotes marked in the prose in every mode

Greg, 2026-09-08, in feedback report
[SPIDERYARN-READING2-2P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2P), reading
`temporal-context-reinstatement-spya-dhqkf9`:

> Always show the quotes (highlighted with a border around them), if there are any that have been
> generated. Always show them in the text view, even if we're not in quotes mode.

**Half of this already shipped.** The border is
[260907c](260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md) — *search
fills, quotes outline* — and "every quote the panel is showing is marked, not only the selected one"
is [report 1Z](../user-feedback/260905_1754-quotes-marked-in-the-prose.md). Checked before writing a
line of this: `mark.hit[data-quote]` draws a two-tier stroke and no fill, today, on `dev`.

**The new half is the last five words.** The marks live for exactly as long as quotes mode is on
screen, and vanish the moment the reader presses Plain. This plan makes them a property of the
article view rather than of a mode.

**Status: built and landed on `dev`.** Stage 0's review changed the design twice and added two
findings the request did not mention — a tap dead-zone, and two rendering defects that stopped being
unreachable. § *Stage 0* keeps its verdict; the report note is
[260908_1742](../user-feedback/260908_1742-quotes-marked-in-every-mode.md). The one thing left open
is the **density** question at the end of § *The three product questions*, which is Greg's.

## What is actually in the way

Not the drawing — that is done. Three structural facts, each of which was a deliberate decision when
it was made.

### 1. The quotes are fetched by the band, and the band only exists in quotes mode

`QuotesBand` calls `useQuotes(slug)`, and its docstring says why:

> `useQuotes` fetches on mount, and calling it up in `Reader` would charge every reader of every
> article a request for a list almost none of them will open.

That argument is **retired by this request**, not worked around: if every reader is to see the
quotes, every reader needs the list.

**And this exact problem has already been solved once, for the glossary.** Greg, 2026-08-26:

> Glossary entries should always be underlined in the verbatim text column, even outside Glossary
> mode, and hover should show a rich tooltip.

The answer was **not** to hoist the whole hook. `useGlossary` was split in two
([260827am](260827am-glossary-read-latency.md)):

| | who calls it | what it does |
|---|---|---|
| `useGlossaryRead(slug)` | `OwnedReader`, always | the opening GET, plus `reload`/`refresh` |
| `useGlossary(slug, read)` | `GlossaryBand`, in glossary mode | the job poll, the auto-run, the verbs |

and `Reader` reads `owner?.glossary?.glossary?.entries ?? artefacts?.glossary?.entries ?? NO_TERMS`.
The band still exists, and its docstring says exactly why the split is not *"hoist it all"*:

> subscribing to the job engine puts it on its idle cadence, and a reader who never opens the band
> should not pay for that.

**So this plan follows the glossary, and the first draft of it did not.** I had written "hoist
`useQuotes` into `Reader`", which would have put the job engine on its idle cadence for every reader
of every article — a real cost, and one I had talked myself out of by reading only half of
`jobEngine.ts`'s header (*"a subscriber alone cannot wake it"* is true, and *"a mounted subscriber
still chooses the **cadence**"* is the next sentence). The split costs one `GET /api/quotes/:slug`
per article view and nothing else.

**Neither shape costs a model call.** `useAutoRun` spends money only against an *activation token*,
minted by a press on the Quotes button ([activation.ts](../../src/web/activation.ts) § "a mount is
not a click") — and it stays in the band, where the press is, so nothing about it changes at all.

### 2. `Reader` draws **one** slot, chosen by mode, and that is on purpose

[reader/passages.ts](../../src/web/reader/passages.ts) exists because two ternary chains used to
answer "which passages" and "which one is rung" separately and agreed only by coincidence.
`selectPassages` is total over `Mode` and returns a whole `PassageSlot`, so the marks and the ring
can never come from different bands. Its own comment: *"the modes are mutually exclusive, so this is
a pick rather than a merge."*

This request makes that sentence false for one of the five slots. The fix is **not** to loosen
`selectPassages` — it stays a pick, and it keeps owning the ring — but to add a second, narrower
question beside it: *what is the prose marked with*, which is the pick **plus the quotes**.

### 3. The rail and the paragraph bar must NOT get the quotes

This is the finding that would have been a silent bug, and it is why "merge the two arrays" is the
wrong shape.

`passages` feeds four consumers in `Reader`, not one:

| consumer | what it draws | may quotes join it? |
|---|---|---|
| `buildHitMarks` | the marks under the phrases | **yes** — this is the whole request |
| `blockStrength` | the paragraph's left bar, by confidence | **no** |
| `blockHues` | that bar's colour segments | **no** |
| `blockMatches` | the spine rail's lanes | **no** |

- `blockStrength` reads `f.confidence === null ? 1`, and a quote's confidence *is* `null`. So every
  paragraph holding a quote would take a **full-strength** bar in search mode, on top of whatever
  the search's own hedged confidence had earned. That is the same channel-stomping
  [260907c](260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md) removed
  from the wash, arriving by the other door.
- `blockHues` de-duplicates by **slot**, and `resolveQuotes` gives every quote `slot: 0` — which is
  the *first saved search's* colour. A quote would paint a segment in a search's hue and the two
  would collapse into one segment.

So the merge is scoped to the marks alone, and the other three keep reading `selectPassages`. In
quotes mode nothing changes at all, because there the picked slot *is* the quotes and they keep
their one rail lane exactly as designed.

## The design

**One read of the quotes, shared — the glossary's split, copied.** `useQuotes` becomes
`useQuotesRead(slug)` (the GET, `reload`, `refresh`) plus `useQuotes(slug, read)` (the jobs and the
verbs, unchanged). The read lands on `ReaderCapability`'s owner arm as `quotes: QuotesRead`, beside
`glossary: GlossaryRead`, and a visitor's list keeps coming from `artefacts.quotes`. One source, so
a regenerate cannot leave the panel's list and the prose's marks disagreeing — which is the precise
failure `markedQuotes` was extracted to prevent.

The second observation, and it is the one that makes this small: **everything the quote marks need
is now state `Reader` holds.** The artefact, `?quote=`, `?rank=`, `?bar=`, `blocks`. So `Reader` does
not need the band to *publish* anything — it computes the slot itself, in one memo, and the band
stops being a passage producer.

```
  BEFORE                                  AFTER

  QuotesBand                              OwnedReader
   └ useQuotes(slug)  ─── fetch            └ useQuotesRead(slug) ── fetch, always
   └ useQuotesMode                        Reader
      ├ markedQuotes(all, rank, bar)       ├ owner?.quotes.quotes ?? artefacts?.quotes
      ├ resolveQuotes(blocks, …)           ├ useQuoteMarks(blocks, quotes)
      └ usePassageLifecycle("derived")     │   ├ markedQuotes(all, rank, bar)
           │  onFound / onOpenKey          │   ├ resolveQuotes(blocks, …)
           ▼                               │   └ openKey from ?quote=
  Reader: useState quoteFound              │        │
          useState quoteOpenKey            │        ▼
                                           └ slots.quotes = { found, openKey }
          ↑ cleared on the band's unmount            (a memo, not two useStates)
                                          QuotesBand
                                           └ useQuotes(slug, read)   ← jobs, verbs
                                              ↑ nothing to clear: it never leaves
```

Three things fall out of that rather than being added:

- **Two `useState`s and a publication protocol go away.** `quoteFound`, `quoteOpenKey`, `onFound`,
  `onOpenKey` and the `derived` arm of [passage-lifecycle.ts](../../src/web/passage-lifecycle.ts) —
  which exists *only* for quotes, and only to guarantee the marks and the ring land in one layout
  effect so no paint shows the ring on one quote and the washes of another set. A memo in the
  renderer has that property by construction; there is no second commit to be wrong in.
- **The "a hidden quote cannot stay selected" rule stops being scoped to the band.** It was right to
  scope it while the marks died with the mode; now that `?bar=` hides a mark in Plain too, the rule
  belongs where the marks are.
- **The band shrinks to what it is** — the params, the panel, and the fetch it no longer owns.

### The merge itself

A named function in `passages.ts`, beside `selectPassages`, for the reason that file exists:

```ts
/** What the PROSE is marked with — the active slot's passages, plus the quotes,
 *  which are marked in every mode. The rail and the paragraph bar deliberately
 *  do not call this. */
export function proseFound(active: readonly Found[], quotes: readonly Found[]): readonly Found[]
```

- **It must return a stable identity.** `hitMarks` caches on the array by identity in a `WeakMap`
  (`unpressed`), and `NO_FOUND` is shared by every non-producer *and asserted to be shared by
  identity* in a test. So: if either side is empty, hand back the other side **unchanged** — not a
  copy. Only a genuine two-sided merge allocates, and `Reader` memoises it.
- **In quotes mode the two sides are the same array**, since `slots.quotes.found` is the quote marks.
  The empty-side rule does not cover that, so the identity check does: `active === quotes` returns
  `active`.
- **No de-duplication by `Found.key`**, which the first draft proposed as a belt. GPT Sol: `key` is
  documented unique only *within one result set*, and nothing in the type promises it across two
  independently generated ones — so a collision would become silent data loss or a ring on the wrong
  kind of mark, in exchange for guarding a case `active === quotes` already covers. A belt that can
  drop a passage is not a belt.

## The three product questions, answered the simple way

**Does it need a switch to turn off?** No new one, in v1. There is already a control and it is the
one Greg designed for this: `?bar=` in the prioritised order is the highlight-density slider, it
lives in the URL, and it survives a mode change. **But say plainly what that costs**: the default
rank is `document`, where `rankQuotes` returns *every* quote and the bar does nothing — so a reader
who has never touched the controls gets all of them (up to `MAX_QUOTES` = 32) outlined in Plain, and
the only way to turn them down is to visit quotes mode, choose Prioritised and raise the bar. That is
a real awkwardness and it is Greg's to decide, not mine to pre-empt with a checkbox nobody asked for.
Flagged in the report note.

**What if another mode wants the same passage?** It gets it, and the channels are separate —
[260907c](260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md) made
search fill and quotes outline, `annotateHtml` splits the two lists (`washes` vs `quoted`), and
`data-quote-start` / `data-quote-end` keep an outline spanning several runs drawing as one box.

**But "legible together" was too strong, and 260907c says so in its own words.** Two defects there
are recorded as *unreachable because one mode's marks are on the page at a time*. This change is what
makes them reachable, so they are now mine:

- **The 2px step.** `mark.hit[data-wash]` takes `padding-bottom: 2px` for the hue band
  ([annotations.css](../../src/web/styles/annotations.css) § the wash), so a fragment carrying both
  is 2px taller than its quote-only siblings and the quote's bottom rule **steps down where the
  search hit starts and back up where it ends**. Measured on `/design` at the time: 738.78 against
  736.78. 260907c calls it *"the one real defect"* and *"the second thing to build if they ever
  coexist"* — which is this plan.
- **`box-decoration-break: slice` on a wrapped quote that is also a hit** is a Chrome-only
  observation ([annotations.css](../../src/web/styles/annotations.css) § the caps), kept as an
  observation rather than a theory because the spec says the two modes should differ.

**Neither is fixed here, and that is a decision rather than an omission.** 260907c already weighed
the cheap fixes and found each of them worse: padding every quote levels the rule but eats 2px of a
5px interline gap and fuses adjacent lines' rules; a `box-shadow` offset cannot put a bottom rule
*inside* a taller box without becoming an inset band of the wrong height. The real fix is to stop the
quote's bottom edge riding the padded box, and inventing one from geometry rather than from a
measurement is exactly what that page refused to do. So: **`/design`'s specimen stops saying "not
reachable", the step is measured again in the browser now that it is, and Greg gets a screenshot and
the two named options.** A 2px cosmetic step is not worth holding the feature he asked for.

**Should the ambient set be smaller than the in-mode set** — say, heavy-tier only? No. Greg said
*always show the quotes*, and a prose that marks five in Plain and fourteen in Quotes is a page that
changes under the reader for a reason nothing on screen explains. One set, one rule.

## The simpler option I passed over

**Stop `usePassageLifecycle` clearing `quoteFound` on unmount, and merge the surviving state.** Three
lines, no fetch moved. Rejected: the marks would then appear only after the reader had *visited*
quotes mode this session, so the first paint of the article — which is the whole of "always" — shows
nothing, and the page would gain marks partway through an afternoon for no reason the reader could
see. It also leaves `Reader` holding a stale array pointing into an article a regenerate has changed.

## What I checked before believing this

Read rather than assumed, in the shared checkout at `6b51645b`:

- `useAutoRun` fires only on a claimed activation token, and tokens are minted by a press —
  `activation.ts` § *Why a mount is not a click*. It stays in the band regardless, so this plan does
  not depend on the claim; it is recorded because the first draft did.
- **`jobEngine` — half right, and the half I had was the flattering half.** A subscriber cannot
  *wake* the engine, which is what I read; a mounted subscriber does still choose its **cadence**,
  which is the next sentence and is why `GlossaryBand` was not dissolved into `Reader`. Corrected
  above; it is the reason this plan splits the hook rather than hoisting it.
- No mode in `Reader` is code-split, so importing the quote helpers into `Reader` moves no bytes
  between bundles. (They may still be worth lifting out of `QuotesPanel.tsx` into a plain module so
  the node tests can reach them without React — Stage 1, if it is free.)
- Nothing clicks a `mark.hit`: there is no handler on it in `TableView.tsx`. **True, and the
  conclusion I drew from it was false** — GPT Sol, and it is the finding I am gladdest of.
  `NOT_A_BLOCK_SELECTION` excludes **every** `<mark>` from the tap that selects a paragraph, on the
  stated grounds that *"`mouseup` has already acted on these"* — which is true of a comment, a chat
  anchor and a glossary term, and is **not** true of a quote. So an always-on quote mark is not a
  neutral decoration: it is up to 32 **dead zones** for tap-to-select, which is how a finger reaches
  the gutter and therefore how a reader annotates ([touch.md](../project/touch.md)). Fixed here — see
  Stage 2 — because this change is what creates it.
- The prose hover card is for glossary terms and the article's own links, not for hits — so ambient
  quote marks add no hover behaviour to Plain.
- `rankQuotes("document")` returns the list untouched, so the bar does **not** limit the default set.
  This is the fact that makes the off-switch question real, and I had it backwards until I read it.

## Stages

Each stage ends green on `npm test` + `npm run typecheck`, and is committed.

### Stage 0 — this plan, reviewed by GPT Sol · **gate, passed**

Verdict: *"The core architecture is sound, but I would not build the plan unchanged."* Six findings,
all folded in above and below. The three that changed what gets built:

| | what it found | where it went |
|---|---|---|
| **1, high** | the 2px step and the `slice` observation stop being unreachable | § *What if another mode wants the same passage* |
| **2, med** | ambient quote marks are **tap dead-zones**, because `NOT_A_BLOCK_SELECTION` excludes every `<mark>` | § *What I checked* item 4, and Stage 2 |
| **5, low** | the `Found.key` de-dupe is not a valid contract | § *The merge itself* |

It also confirmed, against the code, the things I most needed confirmed: computing the slot in a
`useMemo` really does preserve the `derived` arm's atomicity (*"a React commit contains both values
from the same render… StrictMode cannot commit half a memo"*); the four-consumer table is right and
there is no fifth; the visitor shape leaks nothing; and hoisting the **whole** hook would have been
unsafe for a reason neither my first draft nor its correction had — an activation token claimed in
`OwnedReader` could *survive the reader leaving quotes mode and be spent when the GET settles*.
Answer file: `qam-review-answer.md`.

### Stage 1 — `Reader` owns the quotes; the band stops producing

- `useQuotes` splits into `useQuotesRead(slug)` + `useQuotes(slug, read)`, exactly as
  `useGlossaryRead` / `useGlossary` are split. `OwnedReader` calls the read; it lands on
  `ReaderCapability`'s owner arm as `quotes: QuotesRead`. `VisitorQuotesBand` is unchanged — its
  list already arrives in the page payload.
- New `src/web/reader/useQuoteMarks.ts`: `(blocks, quotes) → PassageSlot`, holding `markedQuotes` →
  `quoteTier` → `resolveQuotes`, the `?quote=` ring, and the "the bar hid the selected row" clear.
- `useQuotesMode` loses `blocks`, `onFound`, `onOpenKey` and its lifecycle call; `Reader` loses
  `quoteFound` and `quoteOpenKey`.
- The `derived` arm of `PassageLifecycle` goes, with its docs — it had one caller and this was it.
- **`QuotesBand` must keep revalidating on mount.** `useGlossary` calls `read.reload()` when its band
  opens, and the reason is on the record: `useJobs` treats its first poll as a baseline, so a list
  written **in another tab while the band was closed** has nothing else to bring it in. Moving the
  opening effect out of `useQuotes` and stopping there would leave a permanently-mounted read that
  never revalidates. GPT Sol's finding 3, and the plan said "exactly as the glossary" without naming
  the half that is easiest to drop.
- **Not behaviour-preserving, and the first draft claimed it was.** The hidden-selection effect
  becomes always-mounted, so at `?mode=plain&rank=prioritised&bar=…&quote=…` the `?quote=` can now be
  cleared once the read settles — where today a dormant `?bar=` deliberately cannot touch a selection
  in a list nobody is looking at. That is the **right** end state, because the bar now hides a mark in
  Plain too, but it is a decision and it gets a test rather than a sentence. GPT Sol's finding 6.
- Tests, and they are about lifetimes rather than about marks — the read outlives the band, the
  activation token does not: article open with no press ⇒ one GET, zero POSTs; a Quotes press over a
  `none` ⇒ exactly one POST; press then leave the band before it settles ⇒ zero; Back or a pasted
  `?mode=quotes` ⇒ zero; opening the band while the opening GET is in flight ⇒ no second request.

### Stage 2 — the prose marks the quotes in every mode

- `proseFound` in `passages.ts`; `Reader` memoises it and feeds **`buildHitMarks` only**.
- **The touch fix, which this change makes necessary.** `NOT_A_BLOCK_SELECTION` stops excluding a
  `<mark>` that is a quote **and nothing else**. The marks carry their kinds as classes already
  (`cmt`, `chat`, `term`, `hit`, `annotate.ts:393`) and the wash as `data-wash`, so the exclusion
  becomes: every mark except `mark.hit[data-quote]` with no `.cmt`, `.chat`, `.term` or `[data-wash]`.
  A quote that also carries something a tap already means is untouched. A search-only hit stays
  excluded, which is what it is today and is not this change's to alter.
- Tests, red first. **The one that matters is the negative half**: in `plain`, with quotes loaded,
  the prose carries `data-quote` **and the paragraph bar, the rail and the ring carry nothing new**.
  A careless implementation that merges into `passages` wholesale passes the first half.
- `tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx` states the old contract in its
  title and asserts Plain has no marks. Its contract becomes **prose marks = ambient quotes ∪ the
  open mode's; ring, paragraph bar and spine rail = the open mode's alone**, with a quote in the
  fixture and the sweep run across Plain, Search and Glossary.
- `tests/public-network-trace.test.tsx` would pass while visitor marks were simply absent — its
  public fixture has no quotes on purpose. A quotes-bearing variant asserts `mark[data-quote]` in
  Plain **while keeping the exact network trace**, so the rendering is checked without weakening the
  thing that test is for.
- The Quotes arm of `tests/passage-mode-cleanup.test.tsx` asserts that leaving quotes mode clears its
  marks, which is now the opposite of the product. It is rehomed, not deleted: the same fixture
  becomes the proof that the marks *survive*.

### Stage 3 — docs, a real browser, and the code review

- [quotes.md](../project/quotes.md) § *Every visible quote is marked* becomes *in every mode*;
  [reading-view-overview.md](../project/reading-view-overview.md),
  [new-mode.md](../project/new-mode.md) and [touch.md](../project/touch.md) where they describe the
  one-slot rule and what a tap does; `/design`'s overlap specimen stops saying "not reachable".
- Playwright on the box, on a **deliberately dense** article — 260907c's specimens are two-quote
  cases and nobody has ever looked at 32 marks at once ([quotes.md](../project/quotes.md) says so).
  Plain, Search and Glossary; the outline present, the paragraph bar unchanged; and the 2px step
  measured again now that it is reachable, with a screenshot for Greg.
- GPT Sol on the diff, weighted higher than the review of this page.
- The report note and the Sentry write.
