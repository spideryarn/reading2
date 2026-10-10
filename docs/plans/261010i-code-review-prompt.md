You are the code reviewer for one stage in the Spideryarn repo (this working directory). Read CLAUDE.md, then the plan
docs/plans/261010i-mcp-draft-gift-and-remote-tool-list-without-the-asking-tools.md (including its "Plan review" section,
which says how your earlier plan-review findings were answered), then the diff: docs/plans/261010i-code-review.diff
(it is `git diff HEAD`; the plan files themselves are new and untracked).

What was built:
- POST /api/admin/author-gifts accepts `makeLink: false` (in place of rightsConfirmed; never makes a private link),
  `lookup: false` (no lookup row, 201 with lookupId null) and `draft: {...}` fields written by the insert only.
- POST /api/admin/author-gifts/:id/send accepts `{ expected }`; sendAuthorGift freezes only when the row matches and
  returns `changed` otherwise (also for an already-frozen row). The page sends it.
- MCP: new `draft_author_gift` tool; `remoteTools()` omits tools with `ask` unless they declare `remote`;
  update_gift_voucher's remote form drops `email`; remote.ts serves remoteTools().

Review for correctness, races, security (a model must never cause an email to be sent or a rights confirmation to
be recorded without the person), contract breaks with existing callers (AddPage.tsx, useAdminAuthorGifts.ts, the
Draft-a-gift button, tests), and missing tests. You may and should FIX what you find, within this stage's files,
and add tests. Do not commit, do not run git commands that change the index or discard work, do not touch any
database other than the local test one, never send email. Gates you can run: `npm run typecheck`, and
`npx vitest run tests/mcp-tools.test.ts tests/mcp-remote.test.ts tests/author-gifts.test.ts tests/admin-author-gifts.test.tsx tests/add-page-author-gift.test.tsx tests/add-author-gift.test.ts`.
Report: numbered findings with severity, what you changed for each (file and why), anything wider you did not fix,
and a verdict.
