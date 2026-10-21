# Gift articles on Opus, and with their main modes made

Report `spya-s902kr` (#668), filed by Greg from `/admin/vouchers` on 2026-10-21. Admin, so trusted
input. Note: [docs/user-feedback/](../user-feedback/) (written at the end).

> Provide an option for me to set author-gift/starter articles to be imported with high-powered AI.
>
> Oh, and by default, any articles that we share as part of this should automatically get their
> main modes generated as well.
>
> — Greg, 2026-10-21

Up: [high-powered-ai.md](../project/high-powered-ai.md) ·
[marketing-author-gifts.md](../project/marketing-author-gifts.md) ·
[admin.md § Author gifts](../project/admin.md#author-gifts-a-draft-voucher-for-an-articles-author)

## What this is, in one paragraph

An article becomes a gift in four ways: the add page's *For the author…*, the Give form on
`/admin/vouchers` with its box ticked (an author gift), the same form unticked with a starter article
(a voucher sent now), and MCP's `draft_author_gift`. Only the first switches
High-powered AI on, and none of them makes sure the main modes exist. This plan adds one server
function every path calls, inside the transaction that makes the gift: **queue the main modes for
the gift's article, always**, and **when asked, switch the article to Opus first**, so whatever is
still to be made is made on Opus. It does **not** remake what Sonnet already made. That needs
Glossary and Quotes to learn to replace rather than add, and it is asked of Greg
(§ Asked of Greg). This is revision 2, after GPT Sol's plan review (§ Review).

## What is true today (checked 2026-10-21)

- **The main modes already have one definition**: `AUTO_MODE_STEPS` in
  [`src/auto-mode-steps.ts`](../../src/auto-mode-steps.ts) — `tweets`, `glossary`, `quotes`, `ideas`,
  `simple`, `skim`, `bibliography`, `crossrefs`. It is derived (and test-held) from "every mode not
  behind the experimental switch that makes something". Structure is not on it because the import
  itself builds the tree.
- **The import queues them** at its first full publication (`queueMainModesIn`,
  [`src/store/pg-revisions.ts`](../../src/store/pg-revisions.ts)) unless the owner switched
  *Generate the main modes* off. Greg's switch is on in production (`auto_modes_off_at` null). So an
  article Greg imports now gets its modes — but one imported before a mode existed, one where a mode
  failed, or one imported while the switch was off, does not, and nothing on the gift path notices.
- **High-powered AI** is `articles.high_power_since`; the administrator's switch is
  `highPowerStore.switchOnForAdmin`, uncharged. Switching on re-runs nothing
  ([high-powered-ai.md § What it changes](../project/high-powered-ai.md#what-it-changes-and-what-it-does-not)),
  and the freshness check treats Sonnet and Opus as one generation, so an unforced re-queue skips a
  mode Sonnet made.
- Production: one author gift so far (2026-10-19, sent, not high-powered); no voucher has used a
  starter.

## Decisions

### D1. "Main modes" means `AUTO_MODE_STEPS`, not a gift-specific list

The same jobs the import queues, through the same `autoModePosts()` (which carries Skim's reads in
front of it). It is the established meaning of *Generate the main modes*, and a gift-specific list
would be a second definition. Structure, the gists and the paragraph labels are the import's own.

The Guide's set is wider: it offers non-experimental sub-modes too, Learn's Quiz among them. But
Quiz starts only from its own chip and Learn opens on Recall, so a gift that made it would be paying
for a sub-mode the recipient may never open. FAQ, Sketch and Timeline are experimental and hidden
from a new recipient's bar.

### D2. Every new gift queues them, whatever the owner's import switch says

One function, `prepareGiftArticleIn(tx, articleId, { highPower })`, in a store module of its own,
called **inside** the transaction that makes the gift row (`ensureAuthorGift`, only when the insert
wins) or a voucher with a starter (`createVoucher`, only on a new row — never on a replay). It:

1. **locks the article row `FOR UPDATE` first** and re-checks it is still this owner's, still has a
   current revision and is `full`; otherwise it does nothing (the gift is still made — preparing it
   is a bonus, not a precondition). Article before voucher and job rows is the repository's lock
   order, and the lock is what keeps a concurrent transfer (`src/store/pg-article-transfer.ts`) from
   moving the article between the check and the inserts;
2. with `highPower`, switches the article on through a **transaction-local** admin write: the
   conditional update and `updated_at` stamp `switchOnForAdmin` does, factored so both share it
   (`switchOnForAdmin` itself calls `getDb()` and cannot be used inside another transaction). Never
   the reader's charged path: the administrator is exempt by design;
3. queues the main-mode jobs **unforced**, with the owner's rendered profile, through the loop
   factored out of `queueMainModesIn` so the two cannot drift — but without reading
   `auto_modes_off_at`: Greg's "by default" is about gifts, his import switch about his own reading.
   A mode already current is a skipped step and costs nothing; a job identical to one already waiting
   (the add page's case, whose import has just queued them) collapses onto it.

The *Send* of an author gift goes through `createVoucher` with its starter, so it queues them again —
harmless, for the same two reasons — without `highPower`.

**A `minimal` article cannot reach this**: starter resolution refuses it as unpublished
(`src/store/voucher-starter.ts`), so the re-check in step 1 is a guard, not a feature.

### D3. The high-power option is "Opus from now on", and says so

With the switch committed before the jobs, every job step reads it as it starts (`readStepPower`)
and runs on Opus. So a mode that was missing or stale is made on Opus; a mode Sonnet already made
stays as it is, and so do Structure and the gists. The line under the box says exactly that:
*Uses Opus for what is made from now on. What is already made, Structure included, stays as it is —
to have it all on Opus, tick High-powered AI when you import it.*

### D4. Where the option lives

- **Give form** (`/admin/vouchers`): a *High-powered AI* tick box, shown once an article is chosen,
  **on by default**, for both the author-gift and the send-now case; sent as `highPower` on
  `POST /api/admin/author-gifts` and `POST /api/admin/vouchers`.
- **Draft card**: *High-powered AI: on*, or *off* with a *Switch on* button calling
  `POST /api/admin/author-gifts/:id/high-power` (the same function, `highPower: true`). It covers a
  gift an agent drafted, and is the line 261010c's D10 meant to show and did not. Drafts only.
- **MCP**: `draft_author_gift` takes `high_power` (default **false**): an agent's draft is a
  proposal Greg may discard. The card's button is there when he decides. Not `create_gift_voucher`:
  it takes no starter article, so the flag could do nothing (found while building).

**`highPower` is not part of a voucher's replay identity.** A replay does nothing but answer the
first create; the preparation ran with that create or not at all. Tested.

### D5. A known cost of queuing: a quick claim keeps the article Greg's

The claim moves a starter to the recipient only when nothing is queued or running on it
(`src/store/pg-article-transfer.ts`), and is not retried. Jobs run only while the owner has a
Spideryarn page open (the browser's job engine drives them; nothing on the server does). For an
author gift that is fine: Greg reviews the draft on `/admin/vouchers`, which drives them, before he
presses *Send*. For a send-now voucher, a recipient who claims within the few minutes the modes take
keeps reading Greg's copy, and he moves it on `/admin/articles` as he does today for an article with
his notes on it. Written into admin.md rather than engineered round; a held transfer is a later
change if it is ever seen.

### D6. What it costs (production ledger, last 21 days, medians per article)

| | Sonnet | Opus |
|---|---|---|
| import (`extract`, `structure`, `labels`, `arc`, `assets`) | ≈ $0.36 | ≈ $0.55 |
| main modes (`tweets` .13/.20, `glossary` .10/.21, `quotes` .10/.22, `ideas` .13/.29, `simple` .30/.30, `skim` .04/.08, `bibliography` .16/.28, `crossrefs` .08/.19) | ≈ $1.03 | ≈ $1.77 |

- **One gift before this change**: its import — ≈ $1.40 with the modes made at import (Greg's switch
  is on), ≈ $0.36 if they were not; nothing at gift time.
- **After**, the usual case (Greg imported it, modes made): **unchanged**, every step skips.
- **After**, modes missing: up to ≈ $1.03 more on Sonnet, ≈ $1.77 with the box ticked.
- **Imported with *For the author…*** (all on Opus): ≈ $2.30 in all, nothing at gift time.
- **The remake asked of Greg below** would add ≈ $1.47 to a Sonnet-imported gift (the modes on Opus
  less `simple`, which is on Opus already), ≈ $2.90 in all.

## Asked of Greg

Whether a gift of an article already imported on Sonnet should have its main modes **remade** on
Opus. It is the literal "imported with high-powered AI" for the Give form's case, ≈ $1.50 a gift. It
needs a replacing run for Glossary and Quotes (a forced run of either adds a second batch to the
list today, `src/pipeline.ts`), a forced enqueue on the transaction-local queue, and a per-artefact
check of which model made each. Question file in `docs/user-feedback/questions/` (report
`spya-s902kr`). Nothing built here depends on the answer.

## The simpler options passed over

- **Only part 2, and tell Greg to tick High-powered AI on the add page.** Greg asked for an option
  on `/admin/vouchers`, and agents draft gifts for articles never imported through the add page.
- **Queue after the gift commits, best effort.** Simpler code, but a gift with no jobs and no error
  is the silent failure this repo keeps paying for; one transaction makes it all or nothing.
- **Remaking everything now (revision 1).** Refused by the review: forced Glossary and Quotes append
  rather than replace, a forced job does not collapse onto the import's unforced one, and the
  transaction-local queue cannot force. Asked of Greg instead.

## Stages

1. **Server**: `prepareGiftArticleIn`, the shared enqueue loop and the transaction-local switch;
   `highPower` on the two POST bodies; `POST /api/admin/author-gifts/:id/high-power`; the list's
   `highPower` per gift; MCP's `high_power`. Tests first, watched red: a new gift queues the
   main-mode jobs with the owner's switch off; an existing gift queues nothing; a voucher with a
   starter queues them, a replay does not, whatever its `highPower`; `highPower` switches on in the
   same transaction (a throw after it rolls the switch back); an article already on is left as is;
   a non-admin cannot reach the new route (namespace gate).
2. **Client**: the tick box, the card line and button. Browser check in a Sonnet subagent.
3. **Docs**: admin.md § Author gifts, high-powered-ai.md, marketing-author-gifts.md, mcp.md.

GPT Sol reviews the code before the push.

## Review

**Plan review, GPT Sol, 2026-10-21 — rework.** Accepted in full:

- forced Glossary/Quotes append rather than replace;
- `enqueueSuccessorIn` cannot force;
- forced and unforced jobs do not collapse;
- `switchOnForAdmin` is not transaction-local;
- the gift paths must lock the article;
- queued jobs can block the claim's transfer (D5);
- `highPower` and voucher replay (D4);
- "already on" says nothing about which model made the modes;
- the Guide includes sub-modes (D1);
- the minimal branch is unreachable (D2).

Its simpler design (unforced, switched on in the transaction) is revision 2.
