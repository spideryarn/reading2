# MCP: draft a gift without sending it, and a remote tool list without the tools that refuse there

**Status as of 2026-10-10: built, on `dev` once pushed; not deployed. No migration.** Up: [mcp.md](../project/mcp.md). Builds on the author gift
([261010c](261010c-author-gift-draft-voucher-from-the-add-page.md)) and the remote server
([261007p](261007p-mcp-remote-sign-in-with-oauth.md)).

## What Greg asked for

> MCP suggestions after Greg's first ChatGPT run: (1) Gift vouchers have no draft step.
> create_gift_voucher always sends a real email, so ChatGPT refused to draft one. Add an unsent draft
> (or a preview tool that returns the email text without sending) that Greg reviews and sends from
> /admin/vouchers. That's also the only way gifting can work remotely, where the tools that need
> approval refuse. (2) On the remote server, leave those tools out of the tool list, or say "not
> available here" in their descriptions, so models stop planning around tools that will refuse. Plan
> and Sol review as usual; docs/project/mcp.md is the map.
>
> — Greg, 2026-10-10

## What is there today

- **`create_gift_voucher`** (`src/mcp/tools.ts`) posts to `POST /api/admin/vouchers`, which creates
  the voucher and queues the gift email in one go. It has an `ask`: on the Mac a dialog, on the
  remote server `REMOTE_APPROVER` throws `CannotAsk`, so it always refuses there.
- **A draft already exists, for one case**: the *author gift* (`spideryarn.author_gifts`, plan
  261010c) is a voucher that is saved but not sent, for one of the administrator's own articles,
  with Greg's **notes** field (the "comments field" he asked for on 2026-10-09), a draft editor and a
  **Send** button on `/admin/vouchers`. It is made only by `POST /api/admin/author-gifts { slug,
  rightsConfirmed: true }`, which makes the article's private link if it has none and always starts a
  paid web-search lookup for the author's address. MCP can list and edit these
  (`list_author_gifts`, `update_author_gift`), but **cannot make one**.
- **The remote server** (`src/mcp/remote.ts`) serves the very same `TOOLS` list as the Mac, so
  `tools/list` offers five tools that ask: `make_article_public`, `create_private_link`,
  `create_gift_voucher`, `retry_gift_voucher_email` always ask; `update_gift_voucher` asks only when
  the address changes. Each refuses there only when called. The server builds its tool list per
  request, so it knows it is remote when it lists.

## Decisions

### D1. The draft is an author gift, made by a new tool: `draft_author_gift`

Greg wants review-then-send from `/admin/vouchers`. That is exactly what an author gift is, and
the page, the notes, the editor, *Send* (frozen, idempotent, one email) and their tests already
exist. So the new tool makes one, already filled in:

```
draft_author_gift { slug, email?, recipientName?, recipientNote?, articles?, notes?, look_up_author? }
   └─ POST /api/admin/author-gifts { slug, makeLink: false, lookup, draft: { …fields } }
        new gift  → 201 (no lookup) or 202 (lookup started), fields written in the same insert
        existing  → 200, nothing touched (as today), and the tool says so: use update_author_gift
```

- **The fields go into the insert**, not a second `PATCH` call, so one tool call is one finished
  draft: no window where a draft exists half-filled, and a retry after a lost answer finds the gift
  and reports it rather than half-applying. Validation is `parseAuthorGiftPatch`'s rules, reused, not
  a second copy. An address given here is typed, so it has no lookup provenance.
- **`lookup: false` skips the web search.** The add page and the *Draft a gift* button keep the
  default (`true`, unchanged); the tool defaults to `false`, since an agent drafting a gift usually
  knows the address already, and a search costs money. `look_up_author: true` asks for it.
  A draft with no lookup answers `201 { created: true, lookupId: null }`; the existing `202` shape
  is unchanged, so the add page's check does not move.
- **The private link: the tool never makes one** (revised after review, F2 below). The route's body
  takes `makeLink: false` in place of `rightsConfirmed: true`: the gift is drafted only if the article
  is already readable by link (public, or its private link on), and a private article with no link is
  a `409` that says to turn the link on from the article's page, where Greg confirms the right to
  share it himself. So no sharing-rights confirmation is ever recorded on Greg's behalf by a model.
  The key is never in the tool's answer (`trimAuthorGift` has none).
- **No migration.** Every column already exists; the route takes two optional keys.
- `create_gift_voucher`'s description points at `draft_author_gift` for a gift to review first.

**Passed over:**

- **A preview tool** that returns the email's text and sends nothing. Simpler (no write at all), but
  it is not what Greg described — review *and send* from `/admin/vouchers` — and on the remote server
  it would leave nothing to send: the preview is in the AI app's conversation, and Greg would have to
  type the gift in again on the page.
- **A draft status on `billing_vouchers`.** 261010c's D1 rejected exactly this: four billing paths
  would treat a draft as live. Still true.
- **Drafts with no article** (a plain gift of free articles, no starter). Would need `article_id`
  and `starter_slug` nullable on `author_gifts` (not purely additive), and the send, list, page and
  MCP shapes to handle a gift with no article. Greg's first experiment (five contacts, their own
  papers) is all article gifts, so this waits until he asks; until then a gift with no article is
  `create_gift_voucher` on the Mac, or `/admin/vouchers` by hand. Named here so it is decided, not
  inherited.

### D2. The remote server leaves out the tools that can only refuse there

`remoteTools(TOOLS)` in `src/mcp/tools.ts`, used by `remote.ts`:

- **A tool with an `ask` is left out** of the remote list, unless it declares a `remote` variant.
  That is the default for every future asking tool too, so a new one cannot appear remotely by
  forgetting.
- **`update_gift_voucher` declares one**: the same tool without `email` in its input (the strict
  object refuses it) and a description that says the address cannot be changed from here. Its other
  edits (count, notes, name, revoke) never asked and keep working.
- `REMOTE_APPROVER` stays as the backstop, its sentence updated to point at `draft_author_gift`.

**Passed over: keep them listed and say "not available here" in each description.** Models plan
around what is listed, and do so even when told not to; a tool that is not there cannot be planned
around, and leaving out is less text, not more. Listing time is per request and already knows it is
remote, so there is nothing to work out.

## Plan review (GPT Sol, read-only): APPROVE WITH CHANGES

[261010g-plan-review-sol.md](261010g-plan-review-sol.md). How each finding was answered:

- **F1 (high) — *Send* posts only the gift's id**, so an agent's edit landing between Greg reading the
  confirmation and pressing the button sends the link to an address he never saw. Older than this
  plan, but this plan makes agent edits ordinary. **Adopted**: *Send* carries what the confirmation
  showed (`expected: { email, recipientName, recipientNote, articles }`), and `sendAuthorGift`
  freezes only a row that still matches, comparing a row already frozen too; a mismatch is a `409`
  (*it changed since you opened it*) and nothing is made. The page always sends it; the field is
  optional on the wire so that older callers (tests) still work.
- **F2 (medium) — the tool would record a rights confirmation nobody gave**:
  `pgShareLinkStore.create` writes `rightsConfirmed: true` into `article_share_link_events`. A
  sentence on the later *Send* dialog does not make that row true. **Adopted, more simply than
  proposed**: Sol suggested drafting without a link and making it at *Send*, behind a new rights
  tick there. That changes *Send*, its states and its page for a step Greg can do in one click on
  the article's page; instead the tool sends `makeLink: false` and a link-less private article is
  refused with that instruction. If that turns out to be friction, Sol's version is the follow-up.
- **F3 (medium) — two concurrent ensures, with Greg turning the link off between them, can turn it
  back on.** Older than this plan, and the new tool cannot cause it (it never makes a link). It
  needs two presses within the same moment as a turn-off; **not fixed here**, recorded so it is not
  lost: the fix is a per-article lock taken before the link step, with a recheck for an existing gift.
- **F4 (medium) — positive controls.** Adopted: a remote-list tool that asks is filtered by default
  (a made-up asking tool, not just today's list); the remote `update_gift_voucher` still reaches its
  route for a change that does not ask; a lookup that finishes on a filled-in draft leaves the typed
  address and name alone and still fills what was empty.
- **F5 (low) — contract details.** Already so in the build: a strict subset of the PATCH's field
  rules, an empty `draft` allowed, the notes stamp set on insert, `lookupId: string | null`, and the
  filter applied only in `remote.ts` (the stdio server keeps `TOOLS`). The tool's description says
  it is for one of your own articles.

## Tests (failing first)

1. `tests/mcp-remote*.test.ts`: the remote `tools/list` has none of the four always-asking tools,
   has `update_gift_voucher` without `email`, and has `draft_author_gift`; an `update_gift_voucher`
   with `email` is refused by the schema and reaches no route.
2. `tests/author-gifts.test.ts` (database): a draft with fields and `lookup: false` writes the fields,
   makes **no lookup row and queues no voucher email**; an existing gift is not changed by a second
   draft with different fields; bad fields are a 400 before anything is written.
3. `tests/mcp-tools.test.ts`: `draft_author_gift` posts the body above and sends nothing else; its
   answer has no key; it does not ask.
4. *Send* with an `expected` that no longer matches makes no voucher and queues no email; the page
   sends what it showed (`tests/admin-author-gifts.test.tsx`).
5. `makeLink: false` on a private article with its link off is a 409 that makes no link and no
   gift, and records no share-link event.

## Stages

One stage: route and store, the tool and the remote list, the confirmation line, docs
(`mcp.md`'s table and remote section, `admin.md § Author gifts`). Then GPT Sol's code review,
gates, commit, push.
