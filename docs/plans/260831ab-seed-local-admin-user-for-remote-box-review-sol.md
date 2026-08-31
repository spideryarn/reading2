# Verdict: GO WITH CHANGES

The product decision is sound: seed the fixed local administrator as part of `db:seed-owner`. The target guard, password storage, and rerun behavior need tightening before this is safe and genuinely idempotent.

1. **HIGH — the hostname guard does not prove this is the local stack. Confident.**

   Seeding `ADMIN_USER_ID_LOCAL` makes the risk documented in [src/admin.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/admin.ts:106) concrete: this routine setup command can now create an account that the server treats as administrator.

   The original regex in [db-seed-owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-seed-owner.ts:49) was weaker still: a URL such as `http://localhost:54361@evil.example/` passed it. The implementation currently appearing in the worktree correctly parses the hostname, but its own comment acknowledges that a loopback proxy or SSH tunnel to a remote project still passes [seed-accounts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/seed-accounts.ts:95).

   That tunnel is plausible, not merely adversarial. A local TLS proxy forwarding `127.0.0.1:54361` to a cloud Supabase project, paired with that project’s service key, satisfies the check.

   Specifically do both:

   - Before mutation, compare `SUPABASE_URL` and the service-role key with the stack independently reported by `supabase status` for project `spideryarn2`. Merely parsing the same environment again is not independent evidence.
   - Close the authorization consequence in [src/admin.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/admin.ts:114): make the server gate compare `(verified JWT issuer, user id)`, so the production issuer plus `ADMIN_USER_ID_LOCAL` is refused. The client may retain id-only checking because its link is cosmetic.

   Add tests for a loopback URL with nonlocal credentials and for a production-issued token whose `sub` is the local admin UUID.

2. **MEDIUM — the password argument is a false choice; generate once and persist locally. Confident about the design, speculative only about future exposure paths.**

   A manually required env variable is indeed worse operationally: it adds a setup step and an unset state. But the alternatives are not limited to “manual env var” or “public constant.”

   The strongest argument against the committed constant is that it creates one permanent, universal credential for Greg’s privileged account across every clone and box. It works through the ordinary password endpoint, so a later reverse proxy that exposes only selected Auth routes—or a copied local database used under a less permissive stack—can make it useful even when the service-role endpoint is unavailable. Secrets scanning and rotation will never help because the credential is intentionally public.

   Under the exact current setup, the incremental risk is small: the local service-role key is already globally known, and exposing port 54361 is already total compromise [supabase-local.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/supabase-local.md:70). The plan’s statement that network reach implies the attacker can “read `.env.local`” is false, but they do not need the file to know the standard local service key.

   The better third option:

   - Generate a strong random password on first seed.
   - Store it in a per-stack, mode-`0600` file under persistent local state, outside the repo and outside `.env.local`.
   - Reuse it after `db:reset`; generate a replacement only if that file was lost.
   - Provide an explicit command that prints or copies it when Greg needs to sign in.

   This has no unset setup state, survives the Hetzner `/home` rebuild model, and avoids a universal committed credential. A wrapper around the existing one-time magic-link machinery is another acceptable option, but is less convenient for isolated browsers.

3. **MEDIUM — “idempotent” must cover session revocation and concurrent runs. Confident.**

   GoTrue’s admin password update revokes all refresh sessions for that user: `UpdatePassword(tx, nil)` calls `Logout` ([GoTrue v2.195.0 source](https://github.com/supabase/auth/blob/v2.195.0/internal/models/user.go#L330-L356)). Therefore setting the same password on every run—as the current worktree implementation does in [db-seed-owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-seed-owner.ts:159)—is not behaviorally idempotent. Existing browsers will work until access-token expiry, then be signed out.

   Require these outcomes:

   | Case | Required result |
   |---|---|
   | Fresh database | Create both fixed IDs, confirm the admin, verify password sign-in |
   | Already seeded | Do not update the password or revoke sessions when the desired credential already works |
   | Email on another ID | Fail before changing either account |
   | After `db:reset` | Recreate the same IDs and reuse the persisted password |
   | Two simultaneous seeds | Treat a create conflict as a race: refetch, validate ID/email, and succeed if the peer created the intended account |

   The simplest existing-account sequence is: try the desired password first; if it returns the correct `sub`, skip the admin update. If it fails specifically as invalid credentials, update once and verify. Other failures should abort without mutation. The token probe creates a disposable session, but does not revoke existing sessions.

4. **MEDIUM — the proposed checks share the target-selection bug. Confident.**

   The clearest “check that agrees with the bug” is:

   > Seed through `SUPABASE_URL`, sign in through the same `SUPABASE_URL`, then have `handleApi` verify against the same `SUPABASE_URL`.

   If that URL is a loopback proxy to production, all three steps agree and the end-to-end test can report 200 on the wrong project.

   The proposed `isAdmin(ADMIN_USER_ID_LOCAL)` check is also largely tautological: the seed imports the constant from the same module whose array makes `isAdmin` return true. It proves internal agreement, not the project boundary.

   Add checks with independent premises:

   - Local stack identity from `supabase status`, compared before any write.
   - Production issuer plus local UUID must get 403.
   - Local issuer plus production UUID must get 403.
   - The seed’s create-conflict recovery must be exercised with two concurrent calls.
   - Confirm the rerun leaves an existing refresh session usable.

   Keep the real password-grant and `/api/admin/users` checks; they are valuable for the separate question of whether the seeded account actually works.

5. **MEDIUM — `SPIDERYARN_OWNER_ID=<ADMIN_USER_ID_LOCAL>` has correct code semantics but is not a correct box setup instruction yet. Confident.**

   [src/owner.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/owner.ts:210) does the right thing: this variable affects CLI/pipeline work outside requests, while a signed-in request always uses its session user. It does not weaken request isolation.

   Two operational problems remain:

   - `gjd-remote push-env` replaces the box’s `.env.local` [gjd-remote.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:846), and its allowlist omits `SPIDERYARN_OWNER_ID` [gjd-remote-env.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:34). A box-local line disappears on the next push.
   - Changing the value does not move existing rows. Because article slugs are globally unique [schema.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/db/schema.ts:131), existing `DEV_OWNER_ID` articles remain invisible to Greg and may prevent re-ingesting the same slugs under the admin ID.

   Decide this before the box’s first real ingest. If Greg wants one shelf, give the box a durable remote-only setting and seed with the admin owner from the start. If data already exists, plan an explicit local ownership migration; setting the variable alone is insufficient. Do not simply push the laptop’s value unless Greg also wants to change laptop CLI ownership.

6. **No blocker — GoTrue v2.195.0 password login works without an `email` identity. Confident.**

   The exact behavior is:

   - Admin update writes the password hash independently of identities ([admin update source](https://github.com/supabase/auth/blob/v2.195.0/internal/api/admin.go#L214-L248)).
   - Password grant finds the user by `auth.users.email`, checks `HasPassword`, and authenticates the hash; it does not look for an email identity ([password grant source](https://github.com/supabase/auth/blob/v2.195.0/internal/api/token.go#L85-L115)).
   - A password-only update can therefore leave `providers: ["google"]` while email/password sign-in works. This behavior is also reproduced in [Supabase Auth issue #2085](https://github.com/supabase/auth/issues/2085).

   Keep the live token measurement because it verifies the installed stack and confirmation state. Do not require an `email` identity unless the admin page is specifically meant to display password capability as a linked provider; that is a separate metadata decision.