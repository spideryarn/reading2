Verdict: **build with changes**. The underlying idea—one coloured comment appearing in Comments and Quotes—is sound. The plan needs firmer boundaries around the mixed row list, timestamp provenance, and owner-only wiring.

## Findings

### Q1 — P1 — The proposed document-order comparison mixes incompatible offsets

The plan orders both kinds by block and then raw `start` ([plan:71](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md:71)). That is silently wrong within a block:

- `Quote.start` is measured in `block.text` ([types.ts:1056](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/types.ts:1056)).
- `Comment.start` is measured in rendered text ([types.ts:2921](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/types.ts:2921)).
- The documentation explicitly warns that the two strings differ ([comments.md:733](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/project/comments.md:733)).
- `useQuoteMarks` deliberately refuses to pass `Quote.start` to the rendered-text resolver for exactly this reason ([useQuoteMarks.ts:174](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/useQuoteMarks.ts:174)); `resolveQuotes` documents a reproduced wrong-occurrence case ([search-hits.ts:707](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/search-hits.ts:707)).

Concrete plan change: either adopt the simpler grouped design below, or require a shared rendered-text position for AI quotes before mixed sorting. Reuse/extract the same quote-resolution semantics as `resolveQuotes`; never directly compare the two stored `start` values.

### Q2 — P1 — State explicitly that `QuoteBandRow[]` is a panel-only projection

The plan introduces the union but does not draw a hard boundary around it. That boundary is load-bearing because the existing “shown list” is simultaneously described as panel rows and prose marks ([QuotesPanel.tsx:673](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/QuotesPanel.tsx:673)), while `useQuoteMarks` independently derives the same `Quote[]` ([useQuoteMarks.ts:132](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/useQuoteMarks.ts:132)).

The plan must state:

| Seam | Required contract |
|---|---|
| `rankQuotes`, `visibleQuotes`, `markedQuotes`, `effectiveRank` | Remain `Quote[]` functions over AI quotes only. A new wrapper combines their result with reader rows for rendering. |
| `barStops`, `barNote`, `barToReveal` | Remain AI-only. The visual count may append `+ 3 yours`, but `5 of 14`, hidden count, stops and reveal arithmetic must never include reader rows. |
| `?quote=` and selected-row scrolling | Remain AI-only. Only AI rows receive `data-quote-row` and selection styling; the effect currently looks up that attribute by `quoteId` ([QuotesPanel.tsx:691](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/QuotesPanel.tsx:691)). |
| `steppable`, footer ‹ › and ← / → | Remain `Quote[]`; the panel prop and hook explicitly promise this ([QuotesPanel.tsx:117](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/QuotesPanel.tsx:117), [useQuoteMarks.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/useQuoteMarks.ts:72)). The stepper’s position/count also stays AI-only. |
| Prose quote card | Remains AI-only through `quoteCardQuotes`; reader highlights already have the comment dialog. |
| Spine quote strip | Remains derived from resolved quote strokes ([Reader.tsx:1349](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:1349)). Do not turn a reader wash into a green quote stroke. |
| Skim | Continues to consume the stored `Quotes` artefact only; `skimInput` accepts `Quotes`, not band rows ([skim.ts:308](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/skim.ts:308)). |
| Stored/public `Quotes.quotes` | Remains model `Quote[]`; reader rows are never serialized into it. |

A useful naming distinction would be `shownAiQuotes` versus `bandRows`; continuing to call the union `shown` invites exactly this leak.

### Q3 — P1 — “Every row says when” cannot currently work for old public quotes

The public quote projection rebuilds every quote field by field and currently strips `generatedAt` ([dto.ts:388](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/public/dto.ts:388)). Adding optional `Quote.addedAt` will not make the compiler force that mapper to copy it.

More importantly, an old quote has no `addedAt`, and its fallback requires the list’s `generatedAt`; visitors receive neither under the current DTO. This conflicts with “every row” and with adding the same provenance to `ProseHoverCard`, which visitors also use.

Concrete plan change: decide now that public `Quote` rows carry `addedAt`, and `PublicQuotes` carries `generatedAt` as the legacy upper bound. Add projection tests for both. The plan’s current “either carries it or drops it deliberately” ([plan:118](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md:118)) is not compatible with the stated UI contract.

### Q4 — P2 — Keeping `addedAt` across an inherited-id replacement needs new machinery

The plan says a quote “kept by id in a replace” preserves its timestamp and that an old absence remains absent ([plan:112](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md:112)).

Current replacement inheritance retains only a string id:

- `idsByText` returns `Map<string, string>` ([quotes.ts:915](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/quotes.ts:915)).
- `inheritIds` spreads the fresh quote and overwrites only `id` ([quotes.ts:930](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/quotes.ts:930)).

Therefore a naïve implementation stamps the freshly generated replacement time even when it inherits an old id.

Concrete plan change: replace that map with inherited provenance such as `{ id, addedAt? }`, and have inheritance copy both while preserving absence. Test append preservation, replacement preservation, and old-quote absence separately.

### Q5 — P2 — Opening a reader row leaves the previous AI quote selected

`jumpToComment` only writes `?note=` and optionally performs the block jump ([comment-jump.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/comment-jump.ts:86)). It does not clear `?quote=`.

Consequences after selecting an AI quote and then pressing a reader row:

- The old AI row remains selected.
- Its prose ring remains.
- The footer stepper still reports its AI position.
- Escape closes the comment dialog and exposes that stale selection again.

Concrete plan change: at the Quotes-row call site, clear `?quote=` and call `jumpToComment` in the same tick. Do not put Quotes-specific behaviour inside the generic `jumpToComment`. Add a URL test asserting `?note=<comment>` with no `?quote=` after the press.

Otherwise the existing surface rules are suitable: `CommentDialog` owns Escape ([CommentDialog.tsx:187](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/CommentDialog.tsx:187)), and the annotation dialog already disables its Escape handler while a comment is in front ([Reader.tsx:2990](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2990)).

### Q6 — P2 — Owner gating and “highlights without a quote list” need explicit render rules

The plan says the source is `owner.comments`, but `Reader`’s `comments` variable deliberately contains either owner or visitor comments ([Reader.tsx:725](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:725)); the public query already carries colours ([public-reader.ts:569](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/public-reader.ts:569)). A careless `comments={comments}` therefore implements the explicitly deferred visitor feature.

Also, the current list is rendered only when `quotes` exists ([QuotesPanel.tsx:891](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/QuotesPanel.tsx:891)), contrary to the plan’s promise that highlights appear when the quote stage is absent/running/failed.

Concrete plan change:

- Put `readerRows` only on the owner arm of `QuotesAccess`/`QuotesBand`; the visitor arm must have no such prop.
- Derive it from `capability.kind === "owner"` rather than the merged `comments`.
- Render the reader section/list when `readerRows.length > 0` even if `access.quotes === null`, while retaining the existing stage status and autorun UI.

### Q7 — P2 — `createdAt` is not always “when this highlight was applied”

Recolouring intentionally changes only `colour`, not `updatedAt` ([pg-comments.ts:504](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/pg-comments.ts:504)). Therefore an old bookmark recoloured today would say “Your highlight · [old creation date]”. The plan acknowledges the gap ([plan:121](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md:121)) but still presents the date as the highlight’s time.

Concrete plan change: either store `colourChangedAt`/`highlightedAt`, or use honest copy such as “Saved by you · …” and explicitly defer “when this colour was applied.” Do not show `createdAt` under wording that claims it is the recolour time.

### Q8 — P2 — Exclude coloured Referee placements, and state the existing kinds accurately

The proposed type accepts every selection-anchored coloured `Comment`, including a Referee comment with `criterionId`. Those are explicitly not reading notes ([comments.md:95](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/project/comments.md:95)); Marginalia already excludes them ([notes.ts:345](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/marginalia/notes.ts:345)).

Concrete plan change: reader rows require `criterionId === undefined` as well as `quote` and `colour`.

The “one row shows in both” decision is otherwise right, with this wording correction:

- The Comments drawer includes every comment, including a wordless highlight.
- Marginalia excludes wordless highlights and includes a coloured row only when it is a `comment` or `comment-ai` ([notes.ts:348](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/marginalia/notes.ts:348)).
- A coloured row with `body` is labelled **Comment**, not **Highlight**; with AI involvement it is **Comment + AI** ([comment-nav.ts:222](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/comment-nav.ts:222)).

So revise “drawer and margin because it has words” to “drawer because it is the same comment row; Marginalia when it has reader/model words.” The Quotes note glyph should key specifically from the note/body it promises to show.

## `Quote.addedAt` audit

With Q3 and Q4 fixed, adding the optional field is otherwise safe:

- Quote freshness remains based on the article fingerprint, prompt version and model; `existingFor` checks source hash/version, not quote object equality ([quotes.ts:979](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/quotes.ts:979)).
- Dedupe uses block/span overlap ([quotes.ts:727](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/quotes.ts:727)).
- ID inheritance uses block id plus normalized text.
- Skim’s hash enumerates id, path, priority, text and associations explicitly, and already says “Not timestamps” ([skim.ts:403](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/skim.ts:403)).
- Append merging preserves existing quote objects unchanged ([quotes.ts:859](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/quotes.ts:859)).
- Both export paths serialize the stored quote artefact verbatim, so `addedAt` crosses automatically ([export.ts:443](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/export.ts:443), [export-bundle.ts:485](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/export-bundle.ts:485)).

“On or before `generatedAt`” is honest for old stored quotes: the initial run or any later append completed after those quotes were selected. It becomes progressively looser after Find more, but not false. Capture one completion timestamp for the run and use it for new quotes and `generatedAt` to make the ordering self-evident.

## Simpler v1

The simpler version is a **Your highlights** group in document order above the unchanged AI list in every rank:

```text
YOUR HIGHLIGHTS
  yellow  “…”
  pink    “…”

CHOSEN BY THE AI
  existing Quotes list and controls, unchanged
```

It delivers discovery, colour, note opening, and who/when while avoiding mixed offset ordering and leaving `rankQuotes`, the threshold bar, marks, stepping, selection, spine, and Skim untouched. Counts can read `14 quotes · 3 yours`. Interleaving can follow later once a shared rendered-position key exists.

Keep the existing deferrals for combined stepping, visitor highlights, the quote spine strip, colour filtering, and recolour history. Most importantly, do not widen stored `Quote[]` or compare the two raw `start` fields.