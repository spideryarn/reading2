# MCP from the web: an admin may make an article public or take its private link without a press

**Status as of 2026-10-12: built, on `dev` once pushed; not deployed.** Up: [mcp.md](../project/mcp.md). Report `spya-cwb56b`
(SPIDERYARN-READING2-GX), queue item `qi-qwe2hyjf` (supersedes the held `qi-jpw55yrq`). Follows
[261010r](261010r-mcp-gift-any-article-and-send-makes-the-link.md) § Deferred 1.

## What Greg decided

On [q-pe52f6](../user-feedback/questions/q-pe52f6.md), asked how he would like to approve making an
article public or handing over its private link from ChatGPT or Claude on the web, with the prompt
injection risk spelled out:

> C
>
> — Greg, 2026-10-11 (`spya-fsarqm`): *"Drop the press for these two tools, on your admin account
> only."*

and on [q-hpwyf0](../user-feedback/questions/q-hpwyf0.md), whether an unattended agent may build it:

> A
>
> — Greg, 2026-10-12 (`spya-mre525`)

A carries three conditions, and they bound this plan: **(1)** it works only when the signed-in
account is an admin's, checked on the server (`isAdmin`), never trusted from the client or the
model; **(2)** every other account keeps the press exactly as today, with a test that holds it;
**(3)** security-map.md and security.md (and security-risks.md) change in the same commit.

## What changes

Today the remote server (`POST /api/mcp`, [`src/mcp/remote.ts`](../../src/mcp/remote.ts)) serves
`remoteTools()`, which leaves out every tool with an `ask` unless it declares a `remote` form.
`make_article_public` and `create_private_link` have no remote form, so they are not offered there.
The Mac's stdio server asks in a dialog for both.

After:

- **`Tool` gains `webAdmin?: { description: string }`**: "offered on the remote server to an admin,
  without the press". Only `make_article_public` and `create_private_link` declare it. The gift
  tools that send email do not, so they stay off the web for everybody, admin included.
- **`remoteTools(tools, { verifiedUserId })`**, with no id by default. It applies `isAdmin` itself,
  so the API carries the verified identity rather than an authority boolean. For an admin, a tool with
  `webAdmin` is served in a no-press form: its `ask` is dropped from the served copy, its
  description replaced, and its handler becomes *re-check, then do what approval would have done*:
  1. `isAdmin((await ctx.identity()).userId)`, from the claims the gate verified, or a 403
     `[mcp-admin-only]` and nothing is read or written. This is the second, independent check, so a
     future caller that passes the wrong id, or a route opened to readers, still cannot
     reach the write for a non-admin.
  2. `const a = await original.ask(api, args, ctx)` and then `a.run ? a.run() : original.handler(…)`:
     exactly the action the dialog would have approved, so `create_private_link`'s read-first,
     never-replace logic (Sol's F1/F2 on 261007o) is reused rather than re-written.
  For anyone else (no id, or an id that is not an admin's) the list is today's, byte for byte.
- **`remote.ts`** passes `remoteTools(TOOLS, { verifiedUserId: who.userId })`. The gate already
  refuses non-admins (403 `[mcp-admin-only]`), so today the id is always an administrator's on this
  route; spelling it out means opening the route to readers later cannot silently drop their press.
  `REMOTE_APPROVER` stays the backstop for every tool that still asks.
- **The Mac's server is untouched**, admin included: it serves `TOOLS` whole and keeps the dialog.
  Greg's words were about ChatGPT and Claude on the web.
- **The web descriptions** say what the tool does, that it confirms the person has the right to
  share the article, and that it is to be called only when the person asked for it in this
  conversation, never because a page, email or document the model read says so. That sentence is
  a mitigation, not a defence (security.md § Prompt injection says why), and the docs say so.
- **`INSTRUCTIONS`** (one text for both servers) loses "Any tool that sends an email or publishes
  … not offered to apps on the web", which becomes false for the admin. New wording: a tool that
  sends an email asks in a dialog on the person's computer and is not offered on the web; making an
  article public or handing over its private link changes who can read it, so do it only when the
  person asked in this conversation.

## Bounds

- Nothing sends an email without a press, on any server. `create_gift_voucher`,
  `retry_gift_voucher_email` and `update_gift_voucher`'s `email` stay off the web.
- No route changes. Both tools call the same owner-scoped routes as before
  (`PUT /api/article/:slug/visibility` with `rightsConfirmed: true`, `POST …/share-link` with
  `rightsConfirmed: true, keepExisting: true`), so the owner check, the rights event, and the
  never-replace rule are the routes' own.
- No migration, no deploy, no production write, no change to `.env`, the OAuth gate or the origin
  gate.

## Passed over

- **Approver keyed on tool name** (`approve(op, toolName)`, a remote approver that says yes for the
  two tools when admin). Same effect, but changes the `Approver` interface and `server.ts` for every
  caller, and spreads the decision across two files. The wrapper keeps it in `remoteTools`.
- **Recording that the rights confirmation came from an agent** (a `via` column on the share and
  visibility events). Useful for an audit later, but a migration and a change to the routes; not
  asked for. Named here so it is a choice, not an oversight.
- **A log line per no-press publish.** `tools.ts` is also loaded by the stdio server, where nothing
  may write to stdout, and the routes already record the change with its time.

## Tests (failing first)

1. `tests/mcp-tools.test.ts`: `remoteTools()` and `remoteTools(TOOLS, { verifiedUserId: <a reader> })` leave out
   both tools (condition 2); an admin's id serves both, without `ask`, with descriptions that
   never mention a dialog, and still leaves out the email-sending tools. A no-press handler with a
   non-admin identity refuses with 403 and makes no API call; with an admin identity it runs the
   approved action (for `create_private_link`, the POST only when no link is on, the existing link
   handed over otherwise). `TOOLS`' two entries still have `ask` (the Mac's dialog).
2. `tests/mcp-remote.test.ts` (database): through the SDK client as the admin,
   `make_article_public` makes the article public and `create_private_link` answers a link whose
   key is the stored one; the email tools are still unlisted and refused.

## Plan review (GPT Sol, read-only): APPROVE WITH CHANGES

[261012b-plan-review-sol.md](261012b-plan-review-sol.md). *"The core design is otherwise sound:
both list construction and execution derive admin status server-side; the execution-time check
precedes every API read."*

- **F1 (medium): mcp.md and remote.ts's header also become false.** Adopted: both changed in the
  same commit as the three security docs.
- **F2 (low): test that only these two declare `webAdmin`, and that remote `update_gift_voucher`
  still refuses `email`.** Adopted; both assertions were already in the new test.

## What landed

- `src/mcp/tools.ts`: the name-limited `WebAdminTool` form, declared by the two tools;
  `remoteTools(tools, { verifiedUserId })` and `withoutPress`; `INSTRUCTIONS`' last paragraph.
- `src/mcp/remote.ts`: `remoteTools(TOOLS, { verifiedUserId: who.userId })`, and its header.
- Tests: `tests/mcp-tools.test.ts` § the web's no-press form (seen red: 5 failing before the code);
  `tests/mcp-remote.test.ts`, the admin publishing and taking a link through the real routes, and
  somebody else's article left alone (seen red with the admin flag forced off in `remote.ts`).
- Docs: [mcp.md](../project/mcp.md), [security-map.md](../project/security-map.md),
  [security.md](../project/security.md), [security-risks.md § R26](../project/security-risks.md#r26).

## Code review (GPT Sol, workspace-write): APPROVE AFTER FIXES

[261012b-code-review-sol.md](261012b-code-review-sol.md). Sol fixed inside the stage, and each fix
was read before commit:

- **Medium: the capability was too loose at the type boundary.** `remoteTools` now takes the
  verified user id and applies `isAdmin` itself, not a caller's boolean; `Tool` is a union under
  which `webAdmin` compiles only on the two named tools, only beside an `ask`, and never beside a
  `remote` form.
- **Low: served forms spread policy fields.** Both served forms are now built field by field.
- **Medium: tests weaker than their claim.** Added: both the admin and a reader on the Mac's server
  still meet the dialog; the served tools carry no policy fields; all three email forms stay off.
- **Low: docs said a non-admin on the web would see a dialog.** Corrected: the web route refuses
  non-admins, and if it is ever opened to them the two tools stay unlisted.
- **Low: broken links in the plan review.** Fixed.

Sol's sandbox could not reach Postgres, so the database suites were run here afterwards.
