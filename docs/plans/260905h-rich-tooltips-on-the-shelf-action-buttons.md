# Rich tooltips on the shelf's action buttons

> On the Homepage shelf, there are a few icons that show up on hover, e.g. what looks like edit
> title, open original, archive... Add rich tooltips for each (sometimes I see them, sometimes I
> don't). And if some actions are not available, perhaps show them but disabled with a tooltip
> explaining why.
>
> — Greg, 2026-09-05

Two asks, and the second explains the parenthesis in the first. "Sometimes I see them, sometimes I
don't" is not a rendering flake: two of the five buttons are drawn **only when the article has a
usable source URL** ([`ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) § `Actions`), so an uploaded
PDF's row is three buttons wide and a fetched article's is five, and the icons appear to move around
between cards. Each of those absences was a deliberate fix — a re-fetch with nothing to fetch, an
anchor pointed at a `javascript:` URL — and each was made by deleting the control, which leaves the
reader with no way to find out that the button was ever meant to be there.

## What we are doing

1. **A `ControlTip` card on each of the five**, replacing the `title` attributes — the argument is
   [tooltips.md § `ControlTip`](../project/tooltips.md#controltip-which-is-what-most-of-them-are-now)
   and it is unchanged: a `title` waits about a second, cannot be styled, truncates, and does not
   exist at all on a touch device. The whole row goes in one `TooltipGroup`, the
   [`DiagramPanel.tsx`](../../src/web/DiagramPanel.tsx) idiom, so reading along it is a scrub rather
   than five waits.
2. **All five buttons, always.** Where an action cannot be performed the button is drawn unavailable
   and its card says *why*, and what to do instead.

## The one thing that would have made this not work

**A natively `disabled` button is not a reliable tooltip trigger.** It is out of the tab order and
suppresses activation, and engines differ on whether it dispatches pointer events at all — so the
tooltip explaining why the button is unavailable is the one tooltip that might never open, by either
route. So `IconButton`'s `disabled` becomes `aria-disabled`, with the click **stopped** in the
handler (`preventDefault` and `stopPropagation`, not merely an absent handler) — the standard
pattern, and here the feature rather than a workaround, because the *point* of the unavailable button
is the sentence attached to it.

That reaches the existing "Queueing…" state as well, which is right for the same reason.

The cost, and it is real: an unavailable control keeps its tab stop, so a URL-less article is two
dead stops on the way past. The stop is what makes the explanation findable without a mouse, so it is
the trade rather than an oversight.

## The simpler option, and why not

**Leave the two conditional buttons absent and just add cards to the three that are always there.**
Smaller, no `IconButton` change, no `aria-disabled`. Passed over because it answers half the ask and
leaves the half Greg actually noticed — the row changing width between cards — exactly as it was.

## Copy

Nine cards: five controls, four of them with a second version for when the action cannot be
performed. `ControlTip`'s rule holds: the first paragraph is what pressing would have told you, the
second is what it would not.

| Control | Unguessable half |
|---|---|
| Edit title | clearing the box restores the extractor's title |
| Re-fetch and rebuild | five steps of the pipeline, not all of them; it spends model calls; a note survives unless the page rewrote the passage under it |
| — no address recorded | everything built from it is unaffected; the metadata page has what we do know |
| — address we cannot fetch | the job would be accepted and then fail at step one |
| Open the original | no referrer is sent, so the site is not told which of your articles pointed at it |
| — no address recorded | a gap in what we stored, not a judgement about the article |
| — not a web page | no link is drawn for a scheme we have not vetted |
| Copy link | copying changes nothing about who can read it |
| — already shared | anyone you send it to can read it, until you stop sharing |
| Archive | it is the listing it leaves, not the link; the card goes when the server agrees, not before |

### Four of these were wrong in the first draft

Caught by GPT Sol, and each reads fluently enough that no restatement test could have found it:

- *"re-runs the whole pipeline"* — [`DEFAULT_INGEST_STEPS`](../../src/pipeline.ts) is five steps of
  eleven. The arc, glossary, quotes and timeline are not rebuilt.
- *"your comments and notes come through"* — [block-ids.md](../project/block-ids.md) is explicit that
  a rewritten passage can lose its target.
- *"the link opens for you and nobody else"* — said to every reader, over a shelf that carries
  `visibility` precisely so it can tell which articles are shared.
- *"it was uploaded, or it predates our recording an address"* — inferred from a missing URL, which is
  exactly the inference [`Metadata.tsx`](../../src/web/Metadata.tsx) § `uploaded` refuses to make in a
  comment of its own: a revision can be published with no address at all.

**And one behavioural defect of the same shape**: the re-fetch was gated on `entry.url` alone, so a
`javascript:` address got a live button over a job [`src/fetch.ts`](../../src/fetch.ts) always
refuses at step one. That is the dead button the 2026-08-27 fix removed, reached by the other door —
"can we fetch it" and "can we link to it" were never two questions.

## Files

- [`src/web/IconButton.tsx`](../../src/web/IconButton.tsx) — `aria-disabled`, rest props spread so
  `Tooltip` can wire itself up, and `titled={false}` for a button a card already names.
- [`src/web/ShelfEntry.tsx`](../../src/web/ShelfEntry.tsx) § `Actions` — the row. The dense table
  gets it for free ([`library-columns.tsx`](../../src/web/library-columns.tsx) § `RowActions`).
- `tests/shelf-action-tooltips.test.tsx` — new, borrowing `cardFor` from
  [`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx).
- [library.md § What you can do to a card](../project/library.md#what-you-can-do-to-a-card) and
  [tooltips.md](../project/tooltips.md) — the docs.
