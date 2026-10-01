# Metadata: *What it cost* shut with its total showing, and Export further down

Two layout changes to the metadata page, from one session of Greg's on 2026-10-01
(SPIDERYARN-READING2-7G and -7H):

> In Metadata, when we show the Costs (for admins), default to collapsed (to save vertical space),
> showing only the total figure/summary.

> In Metadata, move "Export" section further down.

The note is [docs/user-feedback/261001_0215-metadata-cost-shut-and-export-further-down.md](../user-feedback/261001_0215-metadata-cost-shut-and-export-further-down.md).

## 1. *What it cost*, shut, with the total on the heading

The page already has the shape Greg is describing: a collapsible `Section` with an `aside` — one
line on the heading row that stays when the section is shut. *Technical details* does exactly this
(`N of M stages · last wrote …`). So the cost section becomes
`<Section label="What it cost" collapsible aside={…}>`, the aside being the total:
`$0.42 · 37 calls`, `At least $0.42 · 37 calls` when some calls were unpriced (the same "floor"
word the body uses), `none recorded` when the ledger is empty.

**The fetch has to move up a level.** `ArticleCostBody` fetches inside itself, and a shut section
without `keepMounted` does not mount its children — so the total would never load until the section
was opened, and the heading would have nothing to say. The load becomes a hook,
`useArticleCost(slug)`, in `ArticleCost.tsx`; a small `CostSection` in `Metadata.tsx` calls it once
and hands the result to both the aside and the body. The body becomes a pure render of a load.

**An error is not shut away.** If the ledger read fails, the section is not collapsible and the
alert shows — the rule *Technical details* already follows (`collapsible={!error}`), and the
postmortem behind it,
[260903d](../postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md).
While loading, the aside says `…`.

**Still admin-only, unchanged.** `CostSection` is mounted only under `isAdmin(user?.id)`, so the
hook — and its request to `/api/admin/articles/:slug/cost` — never runs for anybody else; the server
gate remains the real protection. The source-shape pin in `tests/article-cost-section.test.tsx` is
updated to the new element, and a browser pass checks both an admin and a non-admin.

Simpler option passed over: `keepMounted` on the existing body, with no aside. It saves the vertical
space but loses the half of the request that says "showing only the total figure", since the total
would be inside the hidden part.

## 2. Export further down

Today: … *Your reading*, **Export**, *Technical details*, *What it cost* (admin), *Re-run AI
processing*, *Archive*, *Delete*.

After: … *Your reading*, *Technical details*, *What it cost*, **Export**, *Re-run AI processing*,
*Archive*, *Delete*.

That is as far down as it can go without undoing an earlier ruling of Greg's: *Re-run* sits directly
above *Archive* because he asked for it there (4Z), and *Archive* then *Delete* end the page (19,
260906h), both pinned in `tests/metadata-page-order.test.tsx`. Export near the foot also puts it
beside *Delete*, whose "Export it first" link scrolls to it. The page-order test gains a pin on the
new place.

Passed over: Export between *Archive* and *Delete* — closer still to "Export it first", but it would
split the two endings Greg placed together.

## What the plan review changed

GPT Sol, read-only, 2026-10-01 ([its answer](261001c-metadata-cost-shut-with-its-total-and-export-further-down-plan-review-sol.md)):
build with changes. Both taken.

- **P1: a silent live conversation makes the heading's figure a floor too.** The body says so on a
  line of its own, but a shut section shows only the heading, so `$0.0100 · 3 calls` would read as
  the whole bill. The heading now says `At least …` then, and `none priced · N live conversations
  unreported` when there are no ledger rows at all.
- **P2: the hook's state is tagged with the slug it answers**, so a new slug can never render the
  previous article's total for a frame. The page is keyed by slug and remounts today, so this was
  not live; the hook no longer relies on that. Its test was seen red with the guard removed.
