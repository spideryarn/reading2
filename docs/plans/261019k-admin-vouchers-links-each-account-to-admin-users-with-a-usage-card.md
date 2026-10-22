# /admin/vouchers links each account to /admin/users, with a usage card

Report `spya-qdd2vc` (SPIDERYARN-READING2-K8), a suggestion from Greg (admin, trusted), 2026-10-19,
on `/admin/vouchers`. Overseer queue item `qi-59zhsqzf`.

> create link from each user to /admin/users , with a tooltip summarising their usage
>
> see tooltips.md
>
> — Greg, 2026-10-19

## What "each user" is on that page

The voucher table has one row per voucher. A row is about an **account** in two cases:

1. **Claimed** (or claimed and later revoked): `claimedBy` is the account's id. Its current address
   is already in the row as `claimantEmail`.
2. **Waiting, but an account already holds that address** — e.g. an existing reader given a voucher
   who has not signed in since. No `claimedBy`; matched by address against the user list.

A waiting voucher for an address nobody has signed up with is not a user, and stays plain text.
The *Author gifts* section above the table lists drafts addressed to authors who are not accounts,
so it gets nothing either.

## The design

**Link.** One link per row, to `/admin/users?user=<uuid>`. For a claimed voucher it is the
claimant's *current* address in Status (*Claimed by …*), found by id; for a waiting one it is the
address in the first column, matched (normalised) to exactly one account. A revoked voucher nobody
claimed is never linked. *(Revised after Sol's plan review, findings 1 and 3: the first column is
where the gift was sent, which a claimant may since have left, so a link there would open a card
headed by a different address. The first draft linked the first column in every case.)*

**`/admin/users?user=<uuid>`.** The table is drawn as before, every account and the current sort,
with that account's row marked (a highlight background and `aria-current="true"`) and scrolled into
view once the list has arrived (recorded only once it really scrolled, and forgotten when `?user=`
changes — Sol's finding 4). A line above the table names it (*Marked: <email>*, with a
*Clear* link that drops the parameter). A `?user=` that matches no row says so in that line rather
than doing nothing — an account deleted since the voucher was claimed is the realistic case
(docs/reusable/silent-success.md). `?user=` is the name `/admin/costs` already uses for the same id.

The simpler option passed over: **filter the table to that one row**. Fewer parts (no scroll, no
highlight), but it throws away the context Greg is going there for — how this person compares with
everyone else on the sortable columns. Highlight-and-scroll costs one optional prop on `DataTable`
and one effect.

**Card.** A rich card on the link (tooltips.md: our card, never a native `title`; short lines, not
one block). Its contents come from the same `AdminUser` rows `/admin/users` draws — the vouchers
page calls the existing `GET /api/admin/users` through the existing `useAdminUsers` hook, so no new
endpoint, no new query, and nothing crosses the admin boundary that `/admin/users` does not already
show (admin.md § the one rule). The card:

- head: the account's current address
- *Signed up 3 Oct · last signed in 2 days ago*
- *12 articles on the shelf (2 archived) · 1 PDF uploaded*
- *40 comments · 5 chats · 3 searches* (`AdminUser.questions` counts comments; Sol's finding 5)
- *Opened articles 88 times, last 1 day ago*
- *Plan: free* (and Stripe's status if there is one)
- *Model calls in 2026-10 (UTC): $3, 41 calls* (or *none recorded*), with *· N unpriced* when any are
- the action line: *Open in Users →*

While the list is loading, or if it failed, the link still works (the id is on the voucher for a
claimed row) and the card says *Usage is still loading* / *Could not read usage: <error>*. A waiting
row is only linked once the list has arrived, since its account is found through the list — so a
failed read is said on the page, above the table, and *Refresh* reads the accounts again with the
vouchers (Sol's finding 2). The *Open in Users* line on the card is text, not a second link
(finding 6).

The card is its own component in `src/web/AdminUserCard.tsx` (`AdminUserLink`), taking an id, the
`AdminUser` or why there is none, so `/admin/feedback` and `/admin/articles` can use it later. Not
done here: nobody asked, and each is its own small decision.

Free usage stays in its own column. The card is about the account as a whole; the column is about
the allowance the voucher feeds.

## Stages

1. `DataTable` takes an optional `markedRowId`; `/admin/users` reads `?user=`, marks, scrolls, and
   says so. Tests in `tests/admin-page.test.tsx`: the marked row, the line, the unmatched id.
2. `AdminUserLink` and the card; the vouchers page fetches the user list and links each account.
   Tests: a claimed row links by id; a waiting row whose address matches an account links; one that
   matches none is plain; the card's lines; loading/failure wording.
3. Docs: admin.md (both pages' sections), url-state.md if it lists parameters, tooltips.md's table
   of cards. GPT Sol code review, browser check in a Sonnet subagent, push to `dev`.

## Risks

- The vouchers page now makes a second, heavier request (the user list does per-owner counts and
  spend). Admin-only, one person, read on open; acceptable. If it ever is not, a narrower endpoint is
  the fix, not a cache.
- Another session (`fbnp36qf`) is editing the top of `AdminVouchersPage.tsx` today; my edits are in
  the row and the page body, so a merge should be mechanical.

## Reviews

- Plan: GPT Sol, [261019k-…-plan-review-sol.md](261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card-plan-review-sol.md).
  Six findings, no P0; all six taken, as marked above.
- Code: GPT Sol, [261019k-…-code-review-sol.md](261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card-code-review-sol.md),
  with `--sandbox workspace-write`. It fixed, and I read and kept: waiting rows are not linked from a
  stale account list after a failed refresh (an address may have changed hands), and a claimed row's
  card says its usage is stale (`AccountUsage` kind `stale`); a claimed row with no `claimantEmail`
  uses the id-matched account's address; the scroll effect has explicit dependencies; more tests for
  each of those. Browser check (Sonnet, Playwright, desktop and 390px): pass; the waiting-row link was
  covered by tests only, as the local data had no such voucher.
