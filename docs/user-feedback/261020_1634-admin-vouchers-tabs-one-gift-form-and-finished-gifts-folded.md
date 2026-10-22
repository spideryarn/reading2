---
reports: spya-vcnmrd, spya-vyddks, spya-vusqvg
ending: shipped
comment: Tabs Give, Drafts, Given; one New gift form whose tick-box makes it an author gift; discarded and sent gifts fold to one line with Restore. Not done: deleting them, or merging the two tables underneath. Say if you want either.
---
# `/admin/vouchers`: three tabs, one form for both kinds of gift, and finished gifts folded

Three admin suggestions from Greg (`feedback-reporter.ts` exit 0 on each, no addenda), filed from
`/admin/vouchers` on build `3fe6c0f1`, batched as Overseer queue item `qi-9nzmky8n` because all three
reshape the one page:

> I discarded the message re Tinbergen & ethology, but it's still hanging around. At the very least
> collapse it, and maybe delete it completely (after some time period, or even immediately).
>
> — Greg, 2026-10-20 16:34 UTC (`spya-vcnmrd`, #663, SPIDERYARN-READING2-MW)

> This page is now quite long and messy. Perhaps add tabs at the top to divide it, e.g. for new
> voucher, table of existing, etc. (Try and give them better names)
>
> — Greg, 2026-10-20 16:35 UTC (`spya-vyddks`, #664, SPIDERYARN-READING2-MX)

> Is there a way to combine starter and author gifts? I realise they're different but they seem
> closely related to me. e.g. is one just a special case of the other (e.g. we could provide a tick
> box and/or extra field), to simplify the UI?
>
> — Greg, 2026-10-20 16:36 UTC (`spya-vusqvg`, #665, SPIDERYARN-READING2-MY)

**Ending: Shipped**, all three, to `dev`, not deployed. Plan, with both GPT Sol reviews:
[261020ab](../plans/261020ab-admin-vouchers-tabs-one-gift-form-and-finished-gifts-folded.md).

- **#663: reproduced, and folded.** Production had one author gift, the Tinbergen one, discarded at
  16:33:50 UTC. The page drew every gift as a full card whatever its status, so it still showed its
  1,515 characters of notes and its lookup. Now a discarded or sent gift is one line, with its title,
  where it got to, *Show*, and (if discarded) *Restore*. Discard folds it at once. **Not deleted:**
  deleting would take away *Restore*, and the lookup's record of what it found and what it cost goes
  with it. Folded, it costs one line. Say if you still want them gone after some time.
- **#664: three tabs.** **Give** (the form, with the explanation of vouchers, starters and author
  gifts), **Drafts** (author gifts, with a count of the ones waiting on you), and **Given** (the
  voucher table). The tab is in the address (`?tab=drafts`), so a reload keeps your place.
- **#665: yes, nearly, and now one form.** Underneath, an author gift is a voucher not yet sent,
  whose starter is the author's article and whose address a lookup finds. Send turns it into an
  ordinary voucher. So *Give* has one *New gift* form. The tick-box you suggested, *For the author of
  one of my articles*, turns it into the draft: pick the article, confirm the sharing rights, and it
  appears under Drafts. The separate *Draft a gift for an author* form is gone. **The two tables
  underneath stay separate**, on purpose: a draft kept out of the vouchers table can never grant
  articles or send an email by mistake. Merging them would mean several days' work in the billing code
  for nothing you would see. Say if you want it anyway.
