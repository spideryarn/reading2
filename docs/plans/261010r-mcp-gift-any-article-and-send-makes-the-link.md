# MCP: an agent can draft a gift for any article you own, and your *Send* makes the link

**Status as of 2026-10-10: built (D1–D3), on `dev` once pushed; not deployed. No migration. D4 dropped after review.** Up: [mcp.md](../project/mcp.md). Report
`spya-cwb56b` (#548, SPIDERYARN-READING2-GX, queue item `qi-vm6y7nd4`). Builds on
[261010i](261010i-mcp-draft-gift-and-remote-tool-list-without-the-asking-tools.md) (`draft_author_gift`,
the remote list), [261010c](261010c-author-gift-draft-voucher-from-the-add-page.md) (author gifts) and
[261007p](261007p-mcp-remote-sign-in-with-oauth.md) (the remote server).

## What Greg asked for

> Improve the MCP as you see fit.
>
> For example, I want to be able to create draft gift voucher, and I want to be able to trigger this
> new author gift flow that we've been working on and, you know, make sure that it's rich. So I want
> to be able to say, okay, I found this blogger, find their email address and create a draft gift
> voucher for them for whatever you think the best essay is, and draft a, you know, suggested email
> in the private, in the comments field or something like that from ChatGPT app or wherever, like,
> and it should all just work. And think about other stuff I might want to do. So I might want to be
> able to import new articles, make them public, etc.
>
> — Greg, 2026-10-10 (`spya-cwb56b`, from `/changelog`)

## Walking his example through what is on `dev` today

From ChatGPT (the remote server, where nothing can ask him), "I found this blogger, gift them their
best essay":

| Step | Tool | Works today? |
|---|---|---|
| 1. Pick the best essay | the AI app's own web browsing | yes, nothing of ours needed |
| 2. Get it on Greg's shelf | `import_article` (`own_copy: true` if somebody else already made it public), then `get_import_status` | yes |
| 3. Find their address | the app's own browsing, or `look_up_author: true` (our paid Exa lookup) | yes |
| 4. Draft the gift, with a suggested email in the notes | `draft_author_gift { slug, email, recipientName, recipientNote, notes }` | **no: refused (409)** |
| 5. Greg reviews and presses *Send* | `/admin/vouchers` | yes |

**Step 4 is where it breaks, every time, for a freshly imported essay.** `draft_author_gift` drafts
only for an article already readable by link (public, or its private link on), because the gift
email links the article and 261010i (Sol's F2) refused to let a model record Greg's "I have the
right to share this" for him. A new import is private with no link, and the remote server
deliberately has no tool that can make one (`make_article_public`, `create_private_link` ask, so
they are left out there). So the agent stops and tells Greg to go to the article's page, tick the
box and come back. That is not "it should all just work". 261010i named the fix as its follow-up:
*"If that turns out to be friction, Sol's version is the follow-up."* It is friction.

Two smaller gaps: a model connecting to the server is told nothing about how the tools fit
together (no server `instructions`), so it has to discover the import → wait → draft order from
seven descriptions; and an existing draft cannot have its author looked up again from an agent (the
page has *Look up again*; MCP has only `look_up_author` at creation).

## Decisions

### D1. An agent's draft no longer needs the article to be linkable

`POST /api/admin/author-gifts { makeLink: false, … }` (MCP's only form) drafts the gift for a
private article with no link instead of refusing `link-off`. Still refused: not yours (400), nothing
to read yet (409). The add page's form (`rightsConfirmed: true`, makes the link at once) is
unchanged.

The draft holds no key and makes none, so nothing about the article's visibility changes when an
agent drafts: drafting stays a write to one admin-only table.

### D2. Greg's *Send* makes the link, behind the same rights tick the article's page has

- `AdminAuthorGift.starter` gains **`linkable: boolean`**: the article is there and is public or
  has its private link on (`share_token_at is not null`, never the key itself, which only
  `pg-share-link.ts` may select).
- The *Send* confirmation on `/admin/vouchers`, for a gift whose article is not linkable, shows a
  tick-box with the same words the article card uses (`SHARING_RIGHTS_CONFIRM`) and a line saying
  *Send* makes the article's private link. *Send* stays disabled until it is ticked.
- `POST /api/admin/author-gifts/:id/send` takes **`rightsConfirmed: true`** beside `expected`.
  `sendAuthorGift`, after the freeze and the `expected` check pass, asks `createVoucher` first so a
  replay is still answered without touching the live article. On a new create's `link-off`, and only
  with `rightsConfirmed`, the share-link store locks the slug, verifies it still names the gift's
  article and that this attempt still owns an as-yet-unmade voucher, makes the link and records the
  rights event, then Send retries `createVoucher`. With no tick it is the existing
  `starter-refused / link-off` 409, reworded to say tick the box.
- **No MCP tool can reach *Send***, so the tick is only ever Greg's press. That is the boundary
  261010i drew, kept: a model never confirms sharing rights.
- If the voucher create then fails for another reason, the link stays. Greg confirmed the right to
  share it; turning it off again is one click on the article.

**Passed over:**

- **Let `draft_author_gift` make the link** (what the add page does). One line, but it records a
  rights confirmation a model gave. 261010i refused that for good reason.
- **A remote `create_private_link`** that needs no dialog. Same objection, plus it hands the key
  into the AI provider's conversation.
- **Make the link at draft time but only "pending"** (a link row that is off until Send). A second
  state on the share-link machinery for no gain over making it at Send.

### D3. The server tells the model how the tools fit together

`buildServer` passes MCP's `instructions` (both servers use it): a short paragraph on gifting a
writer one of their pieces (import with `import_article` and wait for `get_import_status`, check
`list_author_gifts` and `list_gift_vouchers` so nobody is gifted twice, `draft_author_gift` with
what you found and where in `notes`, a suggested email to them in `notes` and a short
`recipientNote`, then tell the admin to review and press *Send* on `/admin/vouchers`), and one
line that nothing these tools do sends an email. Descriptions of `draft_author_gift` and
`import_article` say the same in their own place. Plain words, per
[prompting-guide.md](../project/prompting-guide.md).

### D4. ~~`look_up_author`: look the author up again on an existing draft~~ — dropped

Proposed: `look_up_author { id }` → the page's *Look up again*. **Dropped after Sol's F3** (below):
the lookup sends the article's title, byline and text ends to OpenRouter and runs Exa web searches,
with no press of Greg's. `draft_author_gift { look_up_author: true }` already does the same at
creation (261010i), and Greg's own words ask for exactly this ("find their email address"), so that
stays; but widening it is not needed for his example, where the AI app's own browsing finds the
address. Deferred with a queue entry, together with the question whether lookups from an agent need
a press at all.

### Bounds (from the brief, and why each holds)

- **Nothing reaches the outside world without Greg's press.** Drafting, editing and looking up
  send nothing; the email goes only from *Send*. The one new outward-facing step, making the private
  link, happens inside *Send*, behind his tick.
- **Public is not touched.** Nothing here makes an article public; the public shelf
  ([public-shelf.md](../project/public-shelf.md)) and what we tell an author whose piece is
  republished ([public-readable-sharing.md](../project/public-readable-sharing.md)) are unaffected.
  A private link is not the public shelf.
- **No defence is edited.** The remote tool filter, the asking tools, the origin gate and the OAuth
  gate are as they were. The admin routes stay behind the `/api/admin/` gate.
- No migration, no deploy, no production write.

## Plan review (GPT Sol, read-only): APPROVE WITH CHANGES

[261010r-plan-review-sol.md](261010r-plan-review-sol.md). How each finding was answered:

- **F1 (high) — making the link before `createVoucher` breaks its replay-first rule**, so a replay
  of a sent gift could turn back on a link Greg switched off afterwards. **Adopted**: Send asks
  `createVoucher` first; only a fresh create's `link-off` may make the link, and then it retries the
  replay-first operation. The link writer rechecks the attempt and voucher absence in its
  transaction, so an older request cannot re-enable a link after a concurrent retry made the
  voucher. Tests cover both the ordinary replay and that interleaving.
- **F2 (high) — accepting `link-off` drops the check that the slug still names the same article.**
  **Adopted**: `StarterResolution`'s `link-off` carries `articleId`; `ensureAuthorGift` compares it
  as it compares a ready starter's; and *Send* passes `createVoucher` a resolver
  (`resolveGiftStarter`) that answers `absent` for any other article. The link writer independently
  checks the expected article id under the same row lock that writes the key. That also closes the
  older case of a gift whose slug was reused by another article after drafting, including a reuse
  between resolution and the link write. Test seen red with the atomic check disabled.
- **F3 (high) — D4 sends article text to the model provider and the web with no press.** **Adopted
  by dropping D4** (above). The existing `look_up_author: true` is unchanged; the instructions
  mention it as the fallback when the app cannot find an address.
- **F4 (medium) — "nothing these tools do sends an email" is false on the Mac.** **Adopted**: the
  text says the draft tools send nothing, and that any tool that sends or publishes asks in a dialog
  on the person's computer and is not offered on the web. A test holds that every tool it names is
  on both lists.
- **F5 (medium) — an import can answer an existing article or somebody else's public copy, not a
  job.** **Adopted** in the instructions: wait only for a job; use an existing article; on a public
  copy, ask the admin before `own_copy: true`.
- **F6 (medium) — the concurrent turn-off race now has a second link-making path.** **Recorded,
  not fixed.** Two Sends cannot both make a link: only one press wins the freeze. What is left is
  Greg pressing *Send* with the tick in one tab and turning the same article's link off in another
  at the same instant, which is 261010i's F3, the same class and as narrow; it needs his own two
  presses, so it is not something an agent can cause. Its fix (a per-article lock) is still named in
  261010i.
- **F7 (low) — `look_up_author` missing from `ADMIN_ONLY`.** Moot with D4 dropped.

## Deferred, each with its own queue entry

Queue items: 1 is `qi-jpw55yrq` (and question `q-pe52f6`), 2 is `qi-qf6g25gq`, 3 is `qi-sxcqvptg`.

1. **Making an article public, or handing over its private link, from ChatGPT or Claude on the
   web.** Today only the Mac's dialog can approve either. Doing it remotely needs some press of
   Greg's that a model cannot make (a "waiting for you" item on the site he approves, or a push to
   his phone). That is a change to the asking tools, which are a defence, so it is written up for
   Greg as a question, not built. Most of his gifting no longer needs it after D2.
2. **Reading one of your articles through MCP** (`get_article`: its text by block, its summary),
   so an agent writes the suggested email from Spideryarn's copy rather than fetching the page
   again, and can answer "which of these three is their best?" from what is on the shelf. A new
   read surface that puts article prose into an AI conversation: Greg's own articles only, but it
   wants its own small plan.
3. **`look_up_author` on an existing draft (D4), and whether an agent's lookup should need a
   press.** Sol's F3: today `look_up_author: true` at draft time sends article text to the model
   provider and runs web searches without one; Greg asked for that ("find their email address"),
   but it is his call whether the same should be reachable again on an existing draft.
4. Already named elsewhere and not repeated: gifts with no article (261010i § D1, passed over), and
   the concurrent-ensure link race (261010i F3), which D2's *Send* shares in the same narrow form.

## Tests (failing first)

1. `tests/author-gifts.test.ts` (database): `makeLink: false` on a private, link-less article now
   drafts the gift (201) and makes **no link and no share-link event**; absent and unpublished are
   still refused.
2. Same file: *Send* on that gift without `rightsConfirmed` is the 409 and makes no voucher, no
   link, and leaves the gift a draft; with it, the link is made, the voucher is made, the email is
   queued, and the gift email's starter address is the private link.
3. `listAuthorGifts` reports `linkable` false then true, and never selects the key.
4. `tests/admin-author-gifts.test.tsx`: the confirmation of a non-linkable gift shows the tick-box,
   *Send* is disabled until ticked, and the request carries `rightsConfirmed: true`; a linkable gift
   shows no tick-box and sends no `rightsConfirmed`.
5. `tests/mcp-tools.test.ts`: every tool the instructions name is on both lists;
   `tests/mcp-remote.test.ts`: a remote `draft_author_gift` of a link-less private article saves
   the draft, makes no link, and the client received the instructions.
6. After review: a replay with the tick never turns a switched-off link back on, including when a
   concurrent retry commits between resolution and the link step (F1); a slug taken by another
   article before or after resolution is neither linked nor given a link (F2).

## Stages

One stage: store and route (D1, D2 server), the page (D2 client), the tools and instructions (D3,
D4), docs (`mcp.md`, `admin.md § Author gifts`, `marketing-author-gifts.md` if it names the link
step). GPT Sol plan review before building; GPT Sol code review (write-capable) after; gates; commit;
push to `dev`; the queue entries; the note.

## Code review (GPT Sol, write-capable): LAND AFTER FIXES, fixes applied by the reviewer

[261010r-code-review-sol.md](261010r-code-review-sol.md), over
[261010r-code-review.diff](261010r-code-review.diff). Each fix was read before landing:

- **C1 (high) — the link step could still hit a reassigned slug** between `resolveGiftStarter`
  approving the article and the share-link store locking the slug. **Fixed** with
  `ensureShareLinkForArticle` in `src/store/pg-share-link.ts`: it locks the owner's slug, checks
  the article id under that lock, writes the key and the rights event, and returns no key (the key
  still has one selecting statement, in that file). The add page's draft uses it too.
- **C2 (medium) — a concurrent replay could make the voucher between this press's refusal and its
  link write**, so an older press could turn back on a link Greg turned off since. **Fixed**: *Send*
  now asks `createVoucher` first (its replay-first rule kept), makes the link only on a fresh
  `link-off` refusal for a fresh freeze with the tick, checks under the gift's lock that the attempt
  is still this one and no voucher has committed, then asks `createVoucher` again. Tested by
  interleaving. Lock order is article then gift; `createVoucher` locks only the gift, so the two
  cannot deadlock.
- **C3 (low) — the 409 after an interrupted, still-linkless Send** pointed at the article page;
  it now says the attempt was released and to press Send again. Route test added.
- **C4 (low) — the tick's state across a poll and a second confirmation**: two page tests added
  (a poll keeps the reviewed snapshot; closing and reopening clears the tick).
- **C5 (medium, reported) — Greg turning the link off in one tab while pressing Send in another**:
  the last of the two wins. Same as F6 above and 261010i's F3; only his own two simultaneous
  presses can cause it, so it stays recorded rather than built.

Gates after the fixes: `npm run typecheck` clean; the eleven author-gift, MCP, voucher-race,
share-token, doc-links and feedback-endings suites, 319 tests, green against the local database.
