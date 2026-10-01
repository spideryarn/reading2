The architecture is basically sound, but the plan needs two material changes before implementation.

## Findings

### P0

None.

### P1 — Bound and test the real Auth lookup

The promise that a failed lookup never prevents the email is incomplete. [`notifyUpgrade`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/billing/sync.ts:360) runs in the after-response queue, which waits for every task to settle ([`after-response.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/after-response.ts:45)). The existing GoTrue fetch has no timeout ([`admin-accounts.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/store/admin-accounts.ts:315)); copying that pattern means a stalled lookup can suppress the email until the invocation is killed.

Specify that the one-user reader:

- Uses a bounded timeout.
- Catches missing configuration, project mismatch, rejection, non-2xx, malformed JSON, missing email, and an ID that does not match the requested account.
- Never includes the response body or email in errors/logs.
- Returns an unavailable result so `notifyUpgrade` still calls `notifyAdmin`.

The endpoint and credential are right: `GET /auth/v1/admin/users/{id}`, with the service-role key in both `apikey` and `Authorization`. Supabase documents the corresponding server-only `getUserById`, and GoTrue defines that exact route. [Supabase documentation](https://supabase.com/docs/reference/javascript/auth-admin-getuserbyid), [GoTrue route source](https://github.com/supabase/auth/blob/master/internal/api/api.go).

The test list at [plan lines 56–61](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/docs/plans/261001b-admin-sign-up-email-carries-the-address.md:56) only exercises an injected lookup. That can remain green while the real endpoint, headers, response shape, or timeout is wrong. Extend [`admin-accounts.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/tests/admin-accounts.test.ts:452) to test the actual request builder, then separately test `notifyUpgrade`’s found and unavailable outcomes.

### P1 — The privacy change describes only part of the data path

The plan acknowledges that the address is copied into Resend, the forwarder, and an inbox ([plan lines 12–14](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/docs/plans/261001b-admin-sign-up-email-carries-the-address.md:12)), but proposes changing only the Resend entry. `hello@` is explicitly forwarded through Namecheap ([`email.md`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/docs/project/email.md:22)), so “we email ourselves your address through Resend” leaves out two places the plan itself says receive it.

Update the public wording to describe the complete route, including the actual mailbox provider if known. It should also state everything the notices carry: address, account ID, and—for upgrades—the plan names. “When you sign up” is slightly inaccurate because the notice fires on the first successfully answered authenticated request; “when you first use Spideryarn after signing up” is accurate. “Move to a paid plan” also misses paid-to-higher-paid upgrades.

Update [`docs/project/privacy.md`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/docs/project/privacy.md:437) as well as `email.md`; it owns the public policy’s data-flow reasoning and current subprocessor inventory.

### P2 — Make the module boundary explicit

Do not make billing import [`pg-admin.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/store/pg-admin.ts:573). That is the large assembled admin store and already imports billing modules.

Move the shared environment/project check into [`src/store/admin-accounts.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/store/admin-accounts.ts:1), or a small adjacent Auth-admin leaf. Put the single-user lookup there too. `src/billing/sync.ts` may import that server-only leaf; this does not violate [`client-imports.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/tests/client-imports.test.ts:1), because no `src/web` module imports it.

Likewise, `ADMIN_USERS_HREF` currently belongs to the web router. Put the relative path in the already shared, import-free [`src/urls.ts`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/urls.ts:46), have the router import/re-export it, and derive the absolute email URL from `PUBLIC_ORIGIN`. That keeps one spelling without making server code import `src/web/router.ts`.

### P2 — Tighten the sanitisation specification

Plain text plus body-only placement is sufficient against HTML and email-header injection. The JWT address should nevertheless be flattened defensively.

Specify replacement—not merely “stripping”—of Unicode category `Cc` plus `U+2028` and `U+2029`, and test CR, LF, both Unicode separators, and a long non-BMP string. “254 characters, the SMTP limit” is imprecise: SMTP’s limit is octets and this value is message text, not an envelope address. Treat 254 as a display bound and truncate by Unicode code point, keeping any ellipsis inside the bound.

The verified JWT is trustworthy enough here: [`requireUser`](/home/greg/code/spideryarn2/.claude/worktrees/fb6t2-signup-email-address/src/auth.ts:325) verifies the token and checks the authenticated role, non-anonymous status, UUID subject, and email claim. That makes it an Auth-issued account identifier, which is sufficient for an admin notice. It should not be described as proof that the mailbox is currently verified, but no extra lookup is warranted on the sign-up path.

### P2 — Plan hygiene

Add the required status line and explicit final checks: focused tests, `npm test`, `npm run typecheck`, and lint on touched files. A small privacy-page assertion for the new admin-notice disclosure would also keep this factual promise from silently disappearing.

**Verdict: proceed with changes.**