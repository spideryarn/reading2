# `/admin/vouchers`: three tabs, one form for both kinds of gift, and finished gifts folded

Three admin reports from Greg on `/admin/vouchers`, 2026-10-20 (build `3fe6c0f1`), Overseer queue
item `qi-9nzmky8n`, batched because all three reshape the one page:

> I discarded the message re Tinbergen & ethology, but it's still hanging around. At the very least
> collapse it, and maybe delete it completely (after some time period, or even immediately).
>
> — Greg, 2026-10-20 16:34 UTC (`spya-vcnmrd`, #663)

> This page is now quite long and messy. Perhaps add tabs at the top to divide it, e.g. for new
> voucher, table of existing, etc. (Try and give them better names)
>
> — Greg, 2026-10-20 16:35 UTC (`spya-vyddks`, #664)

> Is there a way to combine starter and author gifts? I realise they're different but they seem
> closely related to me. e.g. is one just a special case of the other (e.g. we could provide a tick
> box and/or extra field), to simplify the UI?
>
> — Greg, 2026-10-20 16:36 UTC (`spya-vusqvg`, #665)

Prior work: [261019i](261019i-starter-article-and-author-gift-cost-nothing-and-explained.md) (the
three paragraphs that open the page), [261019k](261019k-admin-vouchers-links-each-account-to-admin-users-with-a-usage-card.md)
(the table's account links), [261010c](261010c-author-gift-draft-voucher-from-the-add-page.md) (author
gifts), [261010r](261010r-mcp-gift-any-article-and-send-makes-the-link.md) (Send makes the link).

## What is there now

The page is one long column: three explanatory paragraphs; the **New voucher** form; the **Author
gifts** section (its own *Draft a gift for an author* form, then every gift as a full card — fields,
notes in full, every lookup); then the voucher table.

## #663: reproduced — a discarded gift is drawn in full, by design

Production, read-only, 2026-10-20: one author gift, starter `tinbergen1963onethology-spya-ks84se`,
`discarded_at` 16:33:50 UTC, no send started, no voucher, 1,515 characters of notes and one lookup.
`AuthorGifts` draws every gift as the same full card whatever its status, so a discarded one keeps its
whole height and only its status line and a *Restore* button differ. Not a bug in the code; a bug in
the design.

**Fix: a gift that is finished — discarded or sent — is one line, shut**, opened on a click: a
`<details>` whose summary is the article's title and the status words (*Discarded on …* / *Sent — its
voucher is under Given*), the full card inside. Restore stays inside it. Drafts and half-sent gifts
(`sending`) stay open, since they are the ones waiting on Greg. Folding sent ones too is the same
reasoning: once sent, the voucher is the live record and the gift is history.

**Delete: not built.** Collapsed, a finished gift costs one line. Deleting it would take away
*Restore*, and its lookup rows (what was found, where, and what it cost) cascade with it; nothing is
gained that the fold does not give. If one line each is still too many later, a timed purge is a
small follow-up. Named here so it is a decision, not a gap.

## #664: three tabs

```
Gift vouchers                                         ← Back to Admin
[ Give ]  [ Drafts 1 ]  [ Given 12 ]
──────────────────────────────────────────────────────────────────
(the chosen tab's panel)
```

- **Give** — the one form (below), with the explanation of what a voucher, a starter and an author
  gift are above it. That explanation is about giving, so it lives there rather than above the tabs.
- **Drafts** — the author gifts: drafts and half-sent ones open, finished ones folded at the bottom.
  The count is the gifts still waiting on Greg (`draft` + `sending`); none → no number.
- **Given** — the voucher table, with its Refresh and the account-read warnings. Count = vouchers.

Names: *Give / Drafts / Given* are short, parallel, and say what you do there rather than what the
widget is. *Drafts* rather than *Author gifts* because since #665 an author gift is just a draft of a
gift.

Mechanics: a `role="tablist"` row of buttons, roving `tabIndex` and arrow keys, as the Feedback
dialog's tabs (`FeedbackDialog.tsx`). **All three panels stay mounted, the hidden ones `hidden`**, so a
half-typed form survives a switch and the gift list's lookup poll keeps running. The tab is in the
address as `?tab=drafts|given` (absent = Give) via `history.replaceState`, so a reload keeps your
place; `?gift=<id>` (MCP's `draft_author_gift` answer) opens Drafts. After *Draft a gift* the page
switches to Drafts with the new (or existing) card highlighted; a gift's *Sent* message says its
voucher is under *Given* instead of "in the table below".

## #665: one form, and the tick-box Greg suggested

Opus read the model and agrees with the reading below. **In the data an author gift is very nearly
"a voucher draft that has a starter, plus a lookup of the author's address"**: Send hands its email,
articles, name and note to them to `createVoucher` unchanged, with that article as the starter. What it adds
is a draft lifecycle (draft → sending → sent, or discarded), at most one per article, a nullable
address while the lookup runs, the lookups themselves, and the right to make the article's private
link at Send. The draft is kept out of `billing_vouchers` on purpose, so the claim, the allowance sums
and the email queue never see an unsent gift.

**Built now (UI only, no schema or API change): one *New gift* form on Give**, with Greg's tick-box at
its top:

```
New gift
[ ] For the author of one of my articles — look up their address, and send it later

 unticked (as today)                     ticked
 ─────────────────────────────────       ─────────────────────────────────
 Email address   Articles                Article  [Choose one…        ▾]
 Their name                              [ ] I have the rights to share… (the
 Note to them     (email sketch)             private link, which Send makes)
 Starter article (optional)              [Draft a gift]
 Private note    [Create voucher]        Nothing is emailed. The draft appears
                                         under Drafts, where you review it and
                                         press Send.
```

Ticked, the fields the draft does not take are hidden, not cleared (untick and they are still
there): `POST /api/admin/author-gifts` takes only the article, and the address, name, note and
articles are edited on the draft card once the lookup has filled what it can. The submit's words
differ (*Create voucher* sends an email at once; *Draft a gift* sends nothing), so there is no doubt
which happened. A starter chosen before ticking carries over as the article, and back. The separate
*Draft a gift for an author* form in the Author gifts section goes.

The rights tick stays as it is in `DraftForm` today (always asked, since drafting makes the link if there is none), not
made conditional on whether the article already has one: that is a separate change to a defence-adjacent
confirmation, and not what was asked.

**Not built: merging the tables.** Drafts as `billing_vouchers` rows with a status, lookups attached to
vouchers, one partial unique index. Every reader of vouchers — the claim, the allowance sum, the email
queue, readdress, the admin list, the user cards — would need a `status = 'live'` filter, and one
missed is a draft quietly granting articles: exactly the silent success the separate table exists to
prevent. Several days, a data migration and billing code, for a gain Greg would not see, since the
form above already gives him one place to give from. Recommended against; the note says so in its
comment so he can say otherwise, without a question file, since nothing waits on it.

## Stages

1. **Code.** `AdminAuthorGifts.tsx`: finished gifts folded; `DraftForm` removed, its body moved into
   the shared form; count of waiting drafts exported. `AdminVouchersPage.tsx`: tabs, the one form, the
   explanation moved under Give, the table under Given. `admin-vouchers-parts.tsx` if shared bits move.
   Tests in `tests/admin-vouchers-page.test.tsx` and `tests/admin-author-gifts.test.tsx`, red first for
   the fold and the tick. Docs: `admin.md § /admin/vouchers` updated.
2. **Review.** GPT Sol code review (write-capable), gates, a browser look at 390 and desktop widths.
3. **Land.** Push to `dev`; note in `docs/user-feedback/`; queue item done.

Done: the three tabs work by mouse and keyboard; the Tinbergen-shaped gift is one line until opened;
ticking the box gives the draft form and a draft appears under Drafts; `npm test`, `npm run typecheck`
green.

## Simpler options passed over

- **Tabs only, leave two forms** — the second form is what makes the page read as two products, and
  Greg asked for the merge.
- **Hide discarded gifts entirely** — then *Restore* has nowhere to live, and "where did it go?" is the
  next report.
- **Unmount hidden tabs** — simpler markup, but loses a half-typed voucher on a tab switch.

## GPT Sol's plan review (2026-10-20, read-only, exit 0) and what changed

No P0. Taken:

- **P1-01 — one `useAdminAuthorGifts` instance**, hoisted to the page and passed to both the form and
  the Drafts panel. Two instances would each read and poll, and the form's reload after drafting would
  not reach the list. It also gives the tab its count and the highlight after drafting.
- **P1-02 — the link is made when drafting, not at Send.** `ensureAuthorGift` makes a missing private
  link at once (`pg-author-gifts.ts` ~196; the hook posts `rightsConfirmed: true`). So the two
  starter rules stay separate: **unticked** (voucher) keeps `starterReady` (a starter must already be
  linkable; no link is made); **ticked** (draft) accepts any article on the shelf once the rights box
  is ticked, as `DraftForm` does today. The ticked state must not reuse `starterOk`. The rights
  sentence in the sketch above should read "drafting makes it", not "Send makes".
- **P1-03 — a just-sent card is not folded under its own "Sent" message.** Folding is decided as
  *open = the person opened it, or it is highlighted, or it is a draft or half-sent*; and the card's
  `said`/`refusal` lines and the Restore button sit **outside** the fold, in its one-line row, so they
  are seen whether it is open or shut. A Discard folds the card at once (that is the point of #663),
  with Restore right there on its line.
- **P1-04 — `?tab=` through nuqs `useQueryState`** (`parseAsStringLiteral(["drafts","given"])`,
  absent = Give, `history: "replace"`), as `/admin/users` keeps its sort. **Choosing a tab by hand
  clears `?gift=`**, so a reload never has to decide between them; `?gift=<id>` with no `tab` opens
  Drafts. Tests check that the hidden panels are `hidden`, not merely present, and that an invalid
  `tab` falls back to Give.
- **P2-01** — corrected: the gift's *note to them*, address, name and count go to the voucher; its
  private notes do not (the voucher's private note is the constant `"Author gift"`).
- **P2-02** — taken, inside P1-03: a highlighted gift is open even when finished, so MCP's review link
  to a sent gift still lands on it.

Not taken: **P2-03** (call the tab *Author gifts*, since it holds finished ones too). The finished ones
are folded lines below the waiting ones; what the tab is *for* is the drafts, and the shorter name
reads with *Give* and *Given*.

## What landed

**Stage 1** (`6309d50d5`, built by an Opus subagent): as planned, plus the draft's *created* /
*already has a gift* messages shown at the top of Drafts (where the page takes you) rather than in the
form, and `?gift=` read through nuqs so a tab click can clear it. Full `npm test` run once: the only
two reds were this stage's (`last-view.test.ts` needed `tab` and `gift` listed as non-article params;
a broken link in this plan), both fixed. Browser check (Sonnet, Playwright, 1280 and 390): tabs, the
address, arrow keys, the tick-box hiding and restoring the fields, no sideways scroll, no console
errors.

**GPT Sol's code review** (write-capable, exit 0, answer file present), no P0, three P1s, all fixed by
it with a regression test each, read and kept: a Hide chosen earlier overrode a fresh highlight; the
scroll-to-card ran while Drafts was hidden and used up the arrival; a `?gift=` arriving after mount
(query-only navigation) did not point. Gates after: the eight touched or neighbouring suites 308/308,
typecheck green.
