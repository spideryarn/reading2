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
[admin.md § Author gifts](../project/admin.md#author-gifts--a-draft-voucher-for-an-articles-author)

## What this is, in one paragraph

An article becomes a gift in four ways: the add page's *For the author…*, the Give form on
`/admin/vouchers` with its box ticked (an author gift), the same form unticked with a starter article
(a voucher sent now), and MCP's `draft_author_gift` / `create_gift_voucher`. Only the first switches
High-powered AI on, and none of them makes sure the main modes exist. This plan does both, in one
server function every path calls: **queue the main modes for the gift's article, always**, and **when
asked, switch the article to Opus and remake those modes on it**. The option is a tick box on the
Give form (on by default), a button on each draft card (for a gift an agent drafted), and a
`high_power` flag on the two MCP tools (off by default).

## What is true today (checked 2026-10-21)

- **The main modes already have one definition**: `AUTO_MODE_STEPS` in
  [`src/auto-mode-steps.ts`](../../src/auto-mode-steps.ts) — `tweets`, `glossary`, `quotes`, `ideas`,
  `simple`, `skim`, `bibliography`, `crossrefs`. It is derived (and test-held) from "every mode not
  behind the experimental switch that makes something", which is also the set the Guide offers a
  button for (`guideModeKeys`, [`src/guide.ts`](../../src/guide.ts)). Structure is not on it because
  the import itself builds the tree.
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
front of it). No second list: a gift's recipient sees the main bar, and the main bar is what that
list is derived from. Structure, the gists and the paragraph labels are the import's own.
Experimental modes (FAQ, Sketch, Timeline, Quiz…) are hidden from a new recipient's bar, so making
them would be paying for what they cannot see.

### D2. Every way an article becomes a gift queues them, whatever the owner's switch says

One function, `prepareGiftArticle(tx, article, { highPower })`, called inside the transaction that
makes the gift row (`ensureAuthorGift`, new gifts only) or the voucher with a starter
(`createVoucher`, new vouchers only, not replays). It queues the main-mode jobs with
`enqueueSuccessorIn`, as `queueMainModesIn` does, but without reading `auto_modes_off_at`: Greg's
"by default" is about gifts, and his import switch is about his own reading. Unforced, so a mode
already current is a skipped step and costs nothing; the queue collapses a job onto an identical one
already waiting (the add page's case, whose import has just queued the same jobs).

`queueMainModesIn`'s loop is factored into the shared piece so the two cannot drift. A `minimal`
article (a paper not yet read in full) queues nothing here: its modes need the full read first, and
a gift of one is already odd.

### D3. The high-power option: switch on, then remake the main modes on Opus

`highPower: true` does, in the same transaction:

1. switch the article on (the admin, uncharged path — the column write `switchOnForAdmin` does, in
   the caller's `tx`), unless it is on already;
2. queue the main modes **forced** for each step whose task does not already run on Opus everywhere
   (`ALWAYS_HIGH_POWER`: `simple` is skipped, it would be paid twice for the same model) — **only
   when this call switched it on**. If the article was already on, its modes were made on Opus (or
   will be), so the unforced queue of D2 is enough.

**Structure is not remade.** A forced `structure` strips every paragraph label for the ~11 minutes
the labels pass takes ([`src/rerun-steps.ts`](../../src/rerun-steps.ts) § `structure` is out), and
Metadata deliberately offers no such press. The way to have the tree on Opus is to tick High-powered
AI while importing, which *For the author…* already does. The line under the box says so.

### D4. Where the option lives

- **Give form** (`/admin/vouchers`): a *High-powered AI* tick box, shown once an article is chosen,
  **on by default**, for both the author-gift and the send-now case; sent as `highPower` on
  `POST /api/admin/author-gifts` and `POST /api/admin/vouchers`. Line under it: *Opus remakes the
  main modes; the structure keeps the model it was imported with.* If the article is on already, the
  box shows as on and disabled with *Already on*.
- **Draft card**: a line *High-powered AI: on* or *off · Switch on and remake on Opus*, the button
  calling `POST /api/admin/author-gifts/:id/high-power`. It covers a gift an agent drafted, and is
  the line 261010c's D10 meant to show and did not. Only on a draft.
- **MCP**: `draft_author_gift` and `create_gift_voucher` take `high_power` (default **false**): an
  agent's draft is a proposal Greg may discard, and a remake on Opus spent on a discarded draft is
  ~$1.5 for nothing. Greg presses the card's button when he decides.

Default on in the form because the form is Greg himself deciding to give it, and the add page's
*For the author…* already ticks the box at that moment; the price is in § Cost.

### D5. What it costs (production ledger, last 21 days, medians per article)

| | Sonnet | Opus |
|---|---|---|
| import (`extract`, `structure`, `labels`, `arc`, `assets`) | ≈ $0.36 | ≈ $0.55 |
| main modes (`tweets` .13/.20, `glossary` .10/.21, `quotes` .10/.22, `ideas` .13/.29, `simple` .30/.30, `skim` .04/.08, `bibliography` .16/.28, `crossrefs` .08/.19) | ≈ $1.03 | ≈ $1.77 |

- **One gift before this change**: whatever its import cost — ≈ $1.40 with the modes made at import
  (Greg's switch on), ≈ $0.36 if they were not; nothing at gift time.
- **After, box unticked**: unchanged when the modes are already current (every step skips); up to
  ≈ $1.03 when none were made.
- **After, box ticked, article imported on Sonnet** (the usual case off the Give form): the modes
  remade on Opus, ≈ $1.47 more (the $1.77 less `simple`, which is not re-run), so ≈ $2.90 for the
  gift in all.
- **Imported with *For the author…*** (already on Opus): ≈ $2.30 total, nothing extra at gift time.

At a handful of gifts a week this is a few dollars. All of it is the administrator's own spend and
lands on the ledger under the article, as every job's does.

## The simpler options passed over

- **Only part 2, and tell Greg to tick High-powered AI on the add page.** That already exists, but
  Greg asked from `/admin/vouchers` for an option there, and agents draft gifts for articles that
  were never imported through the add page.
- **High power as a switch only, no remake.** One line; but switching on changes nothing already
  written, so the gift would read exactly as before. It looks like an answer and is not.
- **Remaking Structure too** (a forced `structure`, or *Start again*). The truest "imported with
  high-powered AI", but it strips the labels for minutes and costs a labels pass on Opus; deferred
  unless Greg asks, and the add page covers new imports.

## Stages

1. **Server**: `prepareGiftArticle` and the shared enqueue loop; `highPower` on the two POST bodies;
   the card's `POST …/high-power` route; MCP's `high_power`. Tests first, red, for: a new gift queues
   the main-mode jobs with the owner's switch off; a replayed/existing gift queues nothing; a voucher
   with a starter queues them; `highPower` switches on and queues forced jobs without `simple`; an
   article already on gets unforced jobs; a `minimal` article queues nothing; a non-admin cannot reach
   any of it (namespace gate).
2. **Client**: the tick box, the card line and button. Browser check in a Sonnet subagent.
3. **Docs**: admin.md § Author gifts, high-powered-ai.md, marketing-author-gifts.md, mcp.md lines.

GPT Sol reviews this plan before stage 1 and the code before the push.

## Questions for the plan review

- Is `AUTO_MODE_STEPS` the right "main modes" for a gift, or should a gift add anything (Learn's
  quiz? FAQ?) given the recipient is the author?
- Forced remake only when this call switched the article on — right, or should an already-on article
  whose modes were made before the switch be checked per artefact (`generator`)?
- Inside the gift's transaction, or after it commits?
