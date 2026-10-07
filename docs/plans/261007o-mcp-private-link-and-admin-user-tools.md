# MCP: a private-link tool, and admin tools that list readers

**Status, 2026-10-07: built, reviewed, on `dev` (needs a deploy for the `keepExisting` option and
the privacy sentence; the MCP tools themselves run on Greg's Mac).** Queue item `qi-2a8nh33e`. Follows
[261007j](261007j-mcp-server-for-spideryarn-admins-first.md), whose Questions 2 and 3 Greg has now
answered yes. The remote half (Question 1) is its own plan, 261007p.

## What Greg said

> I can live with it being something simple (e.g. fixed-key), but I'd prefer Google OAuth or
> similar if possible

> re making private links - if the agent is authenticated to the site, can't it just instruct the
> site to do it?

> yes, I want user email addresses and activity to be queryable via MCP
>
> — Greg, 2026-10-07

## What gets built

Three tools in [`src/mcp/tools.ts`](../../src/mcp/tools.ts), each over a route that already exists
and already decides who may call it. **One small server change**, added on Sol's F1: an optional
`keepExisting` on the private link's `POST` (below).

### 1. `create_private_link` — asks the person first

Over the owner's `GET` and `POST /api/article/:slug/share-link`.

- **Read first, make only when there is none.** `POST` makes a *new* key every time and the old one
  stops working (`ShareLinkState.since` in `src/types.ts`). An agent that "made the link" for a
  second person by `POST` would silently break the link everyone else was sent. So: `GET`; if it is
  on, the answer is that link; only if it is off, `POST` with `rightsConfirmed: true`.
- **Always asks**, through the same macOS dialog as `make_article_public`, whether it makes a link
  or returns the one that exists: either way the key leaves Spideryarn for the AI conversation, and
  that is the thing being approved. The dialog says which of the two it is, names the article, and,
  when making one, carries the rights sentence (`SHARING_RIGHTS_CONFIRM`), since `rightsConfirmed`
  is the owner's attestation and not the agent's.
- **One snapshot.** The `GET` happens in `ask`, and the approved action is bound to its answer
  (the `run` closure `retry_gift_voucher_email` already uses): approving "return the existing link"
  can never turn into a `POST` that replaces it, and approving "make one" posts once.
- **Revised after Sol's plan review.** The first draft had `run` re-read and then `POST`, which
  still leaves a gap between the two (F1). Instead the `POST` carries `keepExisting: true`, and
  `pgShareLinkStore.create` checks for a link **under the row lock it already takes**, answering
  that link unchanged and recording nothing. The owner's card never sends it, so its button still
  means "a new key". And on the "hand over the existing link" branch, `run` makes a fresh
  authenticated `GET` after the yes and hands over only the key that was approved: a logout or a
  different sign-in during the dialog, or a link turned off or remade meanwhile, is a key-free
  error, never a substitute (F2).
- Answers `{ link: "https://<site>/read/<slug>?key=<key>", since }`.

**The new place the key travels**, written into
[security-map.md § a second way in, which is a key](../project/security-map.md#and-since-2026-10-05-there-is-a-second-way-in-which-is-a-key):
into the AI app's conversation and whatever that app keeps or does with it, with the person's
approval each time. Greg accepts that (2026-10-07, above). The tool is a *client* of the owner's
route, not a reader of the store, so `tests/share-link-token-stays-home.test.ts` gains a case pinning
**which code outside the browser calls `/share-link`**: today only `src/mcp/tools.ts`. A third caller
is a line somebody has to add there.

### 2. `list_users` — admin only, read-only

Over `GET /api/admin/users`, which the admin namespace gate already refuses to everybody else, so a
non-admin's call gets the server's 403. Each row trimmed to what an agent needs for "who are my
readers": `id`, `email`, `createdAt` (signed up), `lastSignInAt`, `lastReadAt` (last seen reading),
`articles`, `archived`, `plan`. Optional `query` (a substring of the address) and `limit` (default
100, max 1000), so a large list need not all go into the conversation. Sorted most recently active
first.

### 3. `user_activity` — admin only, read-only

The same route, one row, by `email` or `id`: the account's activity as the admin page shows it —
articles, archived, uploads, questions, chats, searches, opens, last read, last sign-in, this
month's model spend and calls (with the month and the unpriced count beside them), plan, ingests
against the limit. **Named field by field, not the whole row** (Sol's F3), so a column the admin page
gains later does not reach an AI conversation without somebody adding it here.

**Not in it, deliberately: which articles they read, or anything they wrote.**
[`AdminUser`](../../src/admin.ts) is built to hold counts and dates and never names an article
(admin.md § What it deliberately does not show), and these tools inherit that line rather than
crossing it. A per-reader timeline would be a new server route and a privacy decision; it is a
question for Greg below, not part of this.

The `ADMIN_ONLY` set in `tools.ts` gets both names, so a 403 says the tool is for admins.

## The privacy page

Greg asked that the page and [privacy.md](../project/privacy.md) say so in plain words. One sentence
added after the existing "we can see what is in the app" sentence, in `src/web/PrivacyPage.tsx`:

**Before:**

> And **we can see what is in the app**: there is an administrator's view across all accounts, and
> we may read your articles and what you have written in order to fix a bug or make the thing
> better. We won't sell it, publish it, or feed it to a model's training.

**After:**

> And **we can see what is in the app**: there is an administrator's view across all accounts, and
> we may read your articles and what you have written in order to fix a bug or make the thing
> better. We won't sell it, publish it, or feed it to a model's training. An administrator may also
> look up account details (your email address, when you joined and were last active, and how much
> you have used Spideryarn, but not what you read or wrote) by asking an AI assistant of their
> choosing, so those details pass through that assistant's provider.

And, on Sol's F4, the OpenRouter entry's *"every AI call but one goes through them"* becomes
*"every AI call our reading features make, bar one, goes through them"*, so the administrator's
assistant is not a contradiction of it.

`LAST_UPDATED` is already 7 October 2026. `tests/privacy-page.test.ts` gets the clause, as every
other disclosure on the page has. privacy.md gets a section, *An administrator's AI assistant can
list accounts*, saying what goes (the `list_users` fields and the `user_activity` row), what does
not (article text, titles, notes), the route it takes (the admin's own Claude, on Anthropic), and
that it is the admin's own tool, not a subprocessor of the app.

## Tests, red first

In `tests/mcp-tools.test.ts`, against the fake `fetch`:

- `create_private_link` when the link is on: asks (the dialog names the article and says it hands
  over the existing link), on yes makes **no `POST`**, answers the existing key's link.
- When it is off: the dialog carries the rights sentence; on yes, one `POST` with exactly
  `{ rightsConfirmed: true }`; answers the new link.
- On no: nothing beyond the `GET`, and no key in the answer.
- A link that appeared between approval and run is returned, not replaced.
- `list_users` trims, filters and limits; `user_activity` finds by email (case-insensitive) or id and
  says "no such account" otherwise; both 403s say admin-only.
- The existing "there is no list_users or private-link tool" case is turned round.

`tests/share-link-token-stays-home.test.ts`: the new case. `tests/privacy-page.test.ts`: the clause.

## Done when

`npm test` and `npm run typecheck` green; Sol's code review in; mcp.md's tool table and its "Not
there yet" line updated; security-map.md and privacy.md updated; a Sonnet browser check of
`/privacy` at three widths (the only thing a reader sees).

## The simpler option passed over

**Always `POST`** for the private link: one call, no dialog wording for two cases. Passed over
because it replaces the key, which breaks every link already sent; that is a silent failure for
people the agent never sees.

## Review

**Plan review (GPT Sol, 2026-10-07):** `VERDICT: go with changes`, four findings,
[261007o-plan-review-sol.md](261007o-plan-review-sol.md). All taken: F1 (a `POST` after a re-read
can still replace a link made in between) → `keepExisting` decided under the row lock, with a
database test of two at once (red when the check is removed); F2 (handing over a captured key skips
the post-approval session check) → a fresh `GET` after the yes, key-free error on any change; F3 →
`user_activity` names its fields, with planted fields that must not come through; F4 → the privacy
wording names "an AI assistant of their choosing" and the OpenRouter line is qualified.

**Code review (GPT Sol, write-capable, 2026-10-07):**
[261007o-code-review-sol.md](261007o-code-review-sol.md). Two P2s, both fixed by Sol with a red test
first: C1, a long title pushed the slug off the end of a truncated dialog line, so the slug is now
its own line; C2, `list_users` ranked a user by an old read over a newer sign-in, so it now takes
the latest of the dates. Sol's postmortems:
[261007t](../postmortems/261007t-fallback-priority-does-not-measure-the-most-recent-event.md),
[261007u](../postmortems/261007u-approval-text-truncation-must-preserve-the-target-identity.md). Its
`not ready` rested only on not being able to reach the database from its sandbox; the four suites
were run here afterwards, 163/163 with the MCP suites.

**Browser check** (Sonnet, Playwright, 2026-10-07): `/privacy` at 1440, 820 and 390 wide, both
sentences present in full, no overflow, no console errors. Screenshots `261007o-shot-privacy-*.png`.

## Question for Greg (not blocking)

Should `user_activity` show *which* articles a reader has, or what they did when? Today the admin
view deliberately shows only counts and dates. Saying yes is a new server route and a line on the
privacy page; until then the tools stay on the same side of that line as `/admin/users`.
