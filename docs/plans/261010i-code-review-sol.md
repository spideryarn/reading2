1. **F1 follow-up — High, fixed:** refreshing an open Send confirmation replaced the reviewed fields and submitted the newer values as `expected`. Fixed [AdminAuthorGifts.tsx](/var/tmp/spideryarn-worktrees/agent-a9611895ca950261c/src/web/AdminAuthorGifts.tsx:682) to retain and submit the original snapshot. Confirmation also closes when the gift becomes sent or discarded. Added two regressions in [admin-author-gifts.test.tsx](/var/tmp/spideryarn-worktrees/agent-a9611895ca950261c/tests/admin-author-gifts.test.tsx:263); both were seen failing before their fixes.

2. **F3 — Medium, unchanged:** the previously documented concurrent ensure/link-revocation race remains deferred as agreed in the plan. The new MCP draft path cannot create a link.

No further stage defects found in draft creation, remote tool restrictions, or existing callers.

Validation: **149 unit tests passed** across four requested suites. Typechecking passed using `node --import tsx scripts/typecheck.ts`; the npm wrapper was blocked by sandbox IPC permissions. The two database suites could not run because sandbox access to local Postgres/Docker was blocked.

**Verdict: approve with fixes applied; database gates still need rerunning.** Only the two linked files were changed. No commits or emails sent.