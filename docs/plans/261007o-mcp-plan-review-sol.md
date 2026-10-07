**F1 — P1: The second GET does not prevent key replacement.**  
Evidence: [plan:37](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/docs/plans/261007o-mcp-private-link-and-admin-user-tools.md:37), [pg-share-link.ts:123](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/store/pg-share-link.ts:123). Another caller can create a link after `run`’s GET but before its POST. The POST then locks the row and unconditionally replaces that caller’s key. Two concurrent MCP calls can therefore invalidate each other’s answers.

**Fix:** Allow a small server change: add an owner-scoped “create if absent” operation that checks and creates under the existing article-row lock, returning the existing link otherwise. Preserve normal POST’s deliberate rotation behavior. Add database tests proving concurrent calls return the same key and write one creation event, while normal POST still rotates.

**F2 — P1: Returning the captured key can bypass post-approval session checks.**  
Evidence: [plan:37](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/docs/plans/261007o-mcp-private-link-and-admin-user-tools.md:37), [server.ts:54](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/mcp/server.ts:54), [session.ts:508](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/mcp/session.ts:508). The server checks identity before showing the dialog. Unlike the voucher retry closure, returning a captured GET response makes no authenticated request afterward. If logout or another login happens during the dialog, that path can still disclose the previous account’s key. A revoked or rotated snapshot also produces an unusable link.

**Fix:** Explicitly require a fresh authenticated GET after approval on the already-on branch. If the approved key has disappeared or changed, return a key-free “link changed; retry” error; never create or silently substitute another key. Test logout, account replacement, revocation, and rotation while approval is pending.

**F3 — P2: Returning the entire `AdminUser` row leaves the disclosure boundary open.**  
Evidence: [plan:63](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/docs/plans/261007o-mcp-private-link-and-admin-user-tools.md:63), [admin.ts:259](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/admin.ts:259). Today’s row respects the intended boundary. Returning it wholesale, however, makes every future field added for the admin webpage automatically enter AI conversations, without another MCP disclosure decision.

**Fix:** Construct `user_activity`’s result with an explicit field allowlist, retaining the spend period, unpriced-call marker, and ingest window/limit. Test exact output keys and inject extra article-title/note sentinel fields into the fake response to prove they stay out.

**F4 — P2: The privacy update needs to distinguish the administrator’s assistant from app AI calls.**  
Evidence: [plan:98](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/docs/plans/261007o-mcp-private-link-and-admin-user-tools.md:98), [mcp.md:5](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/docs/project/mcp.md:5), [PrivacyPage.tsx:320](/var/tmp/spideryarn-worktrees/mcp-admin-tools-oauth/src/web/PrivacyPage.tsx:320). The planned documentation specifies Claude/Anthropic, although the MCP supports any client. The page also says “every AI call but one” goes through OpenRouter; administrator-assistant processing introduces another path outside it.

**Fix:** Qualify that statement as calls made by Spideryarn’s reading features. Describe account details passing to the administrator’s chosen assistant/provider, or explicitly document Claude/Anthropic as an operational restriction. Extend the privacy test to cover that distinction.

The admin authorization approach is sound: the actual gate remains on the server; `ADMIN_ONLY` only improves error wording.

VERDICT: go with changes