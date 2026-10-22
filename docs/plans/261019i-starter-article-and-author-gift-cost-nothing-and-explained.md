# A gift's starter article costs its recipient nothing, and `/admin/vouchers` says how the two kinds differ

Two admin reports from Greg on `/admin/vouchers`, 2026-10-19, batched as Overseer queue item
`qi-wg9a9np8`:

> double-check that starter/gift articles don't come out of their 3 free allotted articles - if
> it's a gift, it shouldn't cost them
>
> — Greg, 2026-10-19 (`spya-np36qf`, #617)

> explain the difference between starter article and author gifts more clearly - I'm confused!
>
> — Greg, 2026-10-19 (`spya-vuw2hy`, #618)

## #617: does a gift's article use one of the recipient's slots?

**No, and it never has.** The check, three ways:

1. **The code.** A slot is a row of `ingest_events` with `owner_id` = the reader; `usageSql`
   ([`pg-billing.ts`](../../src/store/pg-billing.ts)) counts only rows `where e.owner_id = <reader>`.
   The recipient never ingests the starter article: the administrator did, and the row is theirs.
   When the claim moves the article to the recipient (`transferStarterOnClaim` →
   `transferArticle`, [`pg-article-transfer.ts`](../../src/store/pg-article-transfer.ts) step 6),
   the administrator's rows are frozen at their price and unlinked (`article_id = null`), and still
   carry the administrator's `owner_id`. Nothing writes a row for the recipient. When the article
   cannot move (the administrator has notes on it, say), the recipient reads it through its private
   link, which charges nobody.
2. **An author gift is the same voucher.** *Send* calls `createVoucher` with `starterSlug` = the
   gift's article ([`pg-author-gifts.ts`](../../src/store/pg-author-gifts.ts)), so from the claim
   on it is indistinguishable from a voucher with a starter, and the answer above covers it.
3. **Production, read only, 2026-10-19.** Ten vouchers; one claimed with a starter
   (`ff644a94…`). Its article is now the claimant's, they have **0** ingest rows on it, and their
   2 charged ingests are articles they added themselves.

**What was missing is a test that says so.** `tests/article-transfer.test.ts` checks the old
owner's rows are frozen and unlinked, and `tests/claim-starter-article.test.ts` checks the article
moves — but nothing asks the question Greg asked, *what is the recipient's usage afterwards?* A
later change that, say, re-pointed the rows' `owner_id` on a move would pass both. So: one test in
`tests/claim-starter-article.test.ts`, the administrator's charged ingest on the starter, Bob
claims, and `usageFor(BOB, FREE)` reads zero charged while `usageFor(ALICE, FREE)` still reads one.
It must be seen red first: run once with the assertion inverted.

This adds a check and changes no defence: nothing in the slot count, the claim or the transfer is
edited, so nothing needs writing up for Greg.

**Two later charges, recorded not changed** (the second found by GPT Sol's plan review). Receiving
and reading the starter is free; what the recipient then chooses to do with it is charged as
anything else is:

- **Their own copy.** If the starter stayed the creator's (public, or carrying the creator's
  notes, among the refusals in `pg-article-transfer.ts`), pasting its URL, or pressing *own copy*
  on the public-copy offer, is an ordinary new ingest and takes a slot. After a successful move a
  repeat paste is free, because they already own it.
- **High-powered AI** on a moved starter. The move drops the creator's once-per-article charge on
  purpose, so the new owner pays their own if they switch it on.

Making either free would change what a slot is (billing.md § Which requests spend a slot), a
listed defence, so neither is done here. The note says so, in case Greg wants it.

## #618: the difference, on the page

The confusion is that the page presents them as two things, when they are one thing and a
shortcut:

```
 Gift voucher  ── extra free articles for an email address
   └─ optional starter article: one of YOUR articles, linked in their email
                  (reading and receiving it use none of their allowance)

 Author gift   ── a gift voucher, drafted for the AUTHOR of one of your articles
                  that article is its starter; a lookup suggests the author's address;
                  it waits as a draft until you press Send, then it is a voucher above
```

So: replace the page's intro paragraph (`AdminVouchersPage.tsx`, under the *Gift vouchers* title)
with a short explanation in that shape, three short paragraphs: what a voucher is; what a starter
article is and that receiving and reading it cost them nothing; what an author gift is and that a sent one appears in
the voucher list. The author-gift section's own line gains *"Sent, it becomes a voucher in the list
below, with this article as its starter."* No new component, no disclosure widget: three sentences
of copy on an admin page.

**Simpler option passed over:** a tooltip on each heading. Rejected because the confusion is about
how the two relate, which a tooltip on one cannot say, and an admin page has room for prose.

## Plan review

GPT Sol, read-only, 2026-10-19: **BUILD WITH CHANGES.** It confirmed the central claim path by path
(claim, transfer, private-link read, signed-in open, re-runs, repeat paste, the old job's retry,
the public overdraft) and that Send makes an ordinary voucher. Taken:

1. The copy over-claimed. *"Becomes theirs when they sign in"* is false for a public starter, one
   with the creator's notes, and the other refusals; *"costs them nothing"* is false for the two
   later charges above. The copy now says reading and receiving it use none of their allowance,
   that a private starter with none of your notes becomes theirs, and that later choices are
   charged as usual.
2. The test covered only the branch where the article moves. The same zero-usage assertion is now
   on the *leaves it when the creator has a comment* case too.
3. *"Once Send succeeds"* rather than *"Sent"*, because Send can be refused.

## Code review

GPT Sol, `workspace-write`, 2026-10-19: **LAND AFTER FIXES**, all three made by it
([its answer](261019i-starter-article-and-author-gift-cost-nothing-and-explained-code-review-sol.md)).
The copy still promised a move whenever a private starter had no notes, when a starter another
gift names, a busy one or a failed move also stays; and billing.md said every retained starter is
read by a private link, when a public one is read publicly. Afterwards the copy names the usual
reasons a starter stays (public, another gift names it, your notes on it), so Greg can tell why one
did. Full suite green: 2027 files, 46684 tests.

**Not touched:** #616 (a user link and usage tooltip on this page) comes after; this edits only
the intro copy and one sentence, to keep the merge small. `docs/project/admin.md` gets the same
explanation in a line, since it describes the page.
