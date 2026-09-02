# Review: renaming the local dev sign-in account away from Greg's real address

You are reviewing built code in the Spideryarn repo (`/home/greg/code/spideryarn2`), on the `dev`
branch. Read the files themselves; the diff below is the scope, not the whole context.

## What Greg asked for

Yesterday's work (commits `f0174ca`, `c88f9c7`) made `npm run setup` end with a usable local
account: experimental features on, three fixture articles on the shelf, a per-machine generated
password, no Google and no human. That account was `greg@gregdetre.com` at `ADMIN_USER_ID_LOCAL`.

Then Greg said:

> I think I worry about confusion, because greg@gregdetre.com is my real user on production with
> Google login. So I'd like the dev-dummy user to be called something distinct and different, and
> that highlights it's a dummy.

## What was built

1. `src/admin.ts` gains `ADMIN_EMAIL_LOCAL = "dev-admin@spideryarn.local"`. `ADMIN_EMAIL`
   (`greg@gregdetre.com`) is unchanged and is now documented as production-only — it is still what
   `describeAdminMiss` compares and what `FeedbackDialog.tsx` builds a `mailto:` from.
2. `scripts/seed-accounts.ts`: the seeded sign-in account's email becomes `ADMIN_EMAIL_LOCAL`;
   `readAdminCredentials` returns it; `SeededAccount` gains `renamableFrom: readonly string[]`; and
   a new pure `planAccountEmail(row, account) => "create" | "keep" | "rename" | "refuse"`.
3. `scripts/db-seed-owner.ts`: `ensureAccount` acts on that plan. On `"rename"` it `PUT`s the new
   email onto the existing row **before** the password block, then carries on.
4. `tests/helpers/authed.ts`: `TEST_EMAIL` was the string `"greg@gregdetre.com"` written longhand;
   it now imports `ADMIN_EMAIL_LOCAL`. Consequent updates in `tests/admin.test.ts`,
   `tests/auth.test.ts`, `tests/public-dispatch.test.ts`.
5. Docs: `supabase-local.md`, `auth.md`, `browser-testing-playwright.md`.

## Evidence — actually run, not asserted

**Measured before designing the rename** (throwaway user, own id, deleted afterwards), because the
existing password write is known to revoke sessions and I would not guess about this one:

```
create: 200
sign in: 200 refresh token: yes
email change: 200
refresh AFTER email change: 200 STILL VALID — sessions survive
sign in at NEW address with SAME password: 200
```

**The new unit tests go red without the change.** Backed out `renamableFrom: [ADMIN_EMAIL]` and the
new email, re-ran: `4 failed | 30 passed`, failing exactly `gives no seeded account a real person's
address`, `leaves an account that is already called the right thing alone`, `renames the
pre-2026-09-02 row…`, `does not mistake a case difference for somebody else`. Restored: `34 passed`.

**The live rename, on this box, which was in the pre-rename state:**

```
✓ already present: dev@spideryarn.local (00000000-0000-4000-8000-000000000001)
✓ renamed greg@gregdetre.com to dev-admin@spideryarn.local (f4d08b58-...) — same account, same password
✓ already present, password already correct: dev-admin@spideryarn.local (f4d08b58-...)
✓ signed in as dev-admin@spideryarn.local, token sub is f4d08b58-...
```

Second run (idempotency): no rename line, `already present, password already correct`.

**End to end, with no human:**

```
npx tsx scripts/browser-sign-in.ts --at /read/writes
ok  signed in as dev-admin@spideryarn.local (f4d08b58-...) in 4257ms, GET /api/library → 200 with 11 article(s)
    http://localhost:5273/read/writes → "Writes and Write-Nots · Spideryarn"

npx tsx scripts/browser-sign-in.ts --at /admin/users
    http://localhost:5273/admin/users → "Users · Admin · Spideryarn"
    3 api call(s): 200 /api/jobs, 200 /api/admin/users, 200 /api/admin/users
```

`SPIDERYARN_STORE=postgres npm run db:seed-dev` → `3 of 3 seeded articles open cleanly`,
`11 article(s) on dev-admin@spideryarn.local's shelf in total`.

## What I most want you to attack

1. **The unasked rename.** `db:seed-owner` now writes an email address onto an account it did not
   create in this run. I claim four things fence it: `refuseNonLocalSeed` (parsed hostname) plus
   `refuseMismatchedStack` (asks the Supabase CLI which containers these are) mean it cannot reach
   production; only `ADMIN_USER_ID_LOCAL` has a non-empty `renamableFrom`; that list holds one
   literal address, not a pattern; and nothing is destroyed. **Is that argument complete?** In
   particular: is there a state where `renamableFrom` lets the seed capture a row that is genuinely
   somebody else's, on a stack that really is local but shared? Is a `local-shared-with-a-peer`
   stack a case I have not thought about?
2. **Ordering inside `ensureAccount`.** The rename happens after `findByEmail(want)` and
   `findById(id)`, before the password logic. Is there a sequence — a concurrent peer run, a partly
   applied previous run, a Google sign-in that created a row — where this leaves the database in a
   state that is worse than before, or where a subsequent step reports success over a bad state?
3. **Did I miss a reader of the old address?** I swept `gregdetre` across `src/`, `scripts/`,
   `tests/`, `docs/`. Remaining hits are (a) `ADMIN_EMAIL` itself and its production consumers,
   (b) deliberate historical prose. Is there an indirect reader — a fixture, a stored session, a
   snapshot, a `.env`, Supabase Studio state, a committed test expectation — that names the address
   without spelling it?
4. **`TEST_EMAIL`.** Changing it changes the `email` claim in every test JWT. `feedback-route.test.ts`
   asserts a submitted report's `reporterEmail` is it. Is there a test anywhere that depended on the
   old value being *Greg's* address specifically — for instance a redaction test whose needle is now
   unreachable? I found and fixed one (`auth.test.ts` searched for the literal `"gregdetre"`, which
   would have become a check that could never fail). Are there others?
5. **Anything that is now a claim nothing enforces**, in the docs or the comments.

Be specific and cite `file:line`. If a finding is speculative, say so.

## The diff

```diff
diff --git a/docs/project/auth.md b/docs/project/auth.md
index ea13432..0458638 100644
--- a/docs/project/auth.md
+++ b/docs/project/auth.md
@@ -61,8 +61,8 @@ network call and no extra crypto library; and `flowType` in `createClient` **def
 
 ## Locally, signing in needs no Google at all
 
-`npm run db:seed-owner` creates `greg@gregdetre.com` at the id `src/admin.ts` recognises, with a
-password generated for that machine, so the email form on the landing page is the whole of it — no
+`npm run db:seed-owner` creates `dev-admin@spideryarn.local` at the id `src/admin.ts` recognises,
+with a password generated for that machine, so the email form on the landing page is the whole of it — no
 OAuth, no dashboard, and no browser on a machine you cannot reach. That last part is why it exists:
 a fresh Hetzner box had no way in that did not go through the noVNC tunnel.
 `npm run db:admin-password` prints the credentials.
diff --git a/docs/project/browser-testing-playwright.md b/docs/project/browser-testing-playwright.md
index 8ead937..b18306c 100644
--- a/docs/project/browser-testing-playwright.md
+++ b/docs/project/browser-testing-playwright.md
@@ -46,7 +46,7 @@ landing page and very little else. This is the rest of it, and it needs no human
 import { signedInBrowser } from "./scripts/browser-sign-in.ts";   // tsx, from the repo root
 
 const { browser, page, who } = await signedInBrowser();
-//   → signed in as greg@gregdetre.com in 1728ms, GET /api/library → 200
+//   → signed in as dev-admin@spideryarn.local in 1728ms, GET /api/library → 200
 await page.goto("http://localhost:5273/read/fowler-phrenology", { waitUntil: "domcontentloaded" });
 ```
 
@@ -57,7 +57,7 @@ npx tsx scripts/browser-sign-in.ts --at /read/fowler-phrenology --shot /tmp/x.pn
 ```
 
 **The credential is already on the machine.** `npm run db:seed-owner` writes
-`greg@gregdetre.com` with a password generated per machine into
+`dev-admin@spideryarn.local` with a password generated per machine into
 `~/.config/spideryarn/local-admin-password`, and `npm run db:admin-password` prints it — no Google,
 no dashboard —
 [supabase-local.md § Signing in](supabase-local.md#signing-in-with-no-google-and-no-browser-you-cannot-reach).
diff --git a/docs/project/supabase-local.md b/docs/project/supabase-local.md
index b5b6575..4ac45bb 100644
--- a/docs/project/supabase-local.md
+++ b/docs/project/supabase-local.md
@@ -57,13 +57,33 @@ sqlstate `23503`, a foreign key such as `uploads_owner_fk` with no owner row. Fo
 | | | |
 |---|---|---|
 | `dev@spideryarn.local` | `DEV_OWNER_ID` | what rows written *outside* a request belong to — the CLI and the pipeline. [`src/owner.ts`](../../src/owner.ts) |
-| `greg@gregdetre.com` | `ADMIN_USER_ID_LOCAL` | the account you sign in as, and the one `/api/admin/*` recognises. [`src/admin.ts`](../../src/admin.ts) |
+| `dev-admin@spideryarn.local` | `ADMIN_USER_ID_LOCAL` | the account you sign in as, and the one `/api/admin/*` recognises. [`src/admin.ts`](../../src/admin.ts) |
 
 The second has a password, so signing in is the email form on the landing page — no Google, nothing
 to click on a dashboard, and no browser on a machine you cannot reach. **That is what makes a fresh
 Hetzner box usable**, where the alternative was the noVNC tunnel
 ([260831ab](../plans/260831ab-seed-local-admin-user-for-remote-box.md)).
 
+**Neither address is a real person's, and that is the point.** The sign-in account was
+`greg@gregdetre.com` until 2026-09-02 — the same address as Greg's *production* account, which is a
+different account on a different project reached by a different sign-in. Greg:
+
+> I worry about confusion, because greg@gregdetre.com is my real user on production with Google
+> login. So I'd like the dev-dummy user to be called something distinct and different, and that
+> highlights it's a dummy.
+>
+> — Greg, 2026-09-02
+
+Nothing in code read the address — `/api/admin/*` compares uuids and `SPIDERYARN_OWNER_ID` is a uuid
+— so the rename changed what a person sees and nothing that code decides.
+[`src/admin.ts` § `ADMIN_EMAIL_LOCAL`](../../src/admin.ts) has the reasoning.
+
+**A machine seeded before then catches up on its own.** `db:seed-owner` renames the row rather than
+refusing, and says so; the password and every open session survive it. It is the one rename this
+repo performs unasked, and `planAccountEmail` in
+[`scripts/seed-accounts.ts`](../../scripts/seed-accounts.ts) is the four-part fence that makes it
+safe: local stack, one fixed id, one fixed old address, nothing destroyed.
+
 ```
 npm run db:admin-password
 ```
diff --git a/scripts/browser-sign-in.ts b/scripts/browser-sign-in.ts
index 19c227a..16387d3 100644
--- a/scripts/browser-sign-in.ts
+++ b/scripts/browser-sign-in.ts
@@ -13,7 +13,7 @@
  * check.
  *
  * The credential was already there. `npm run db:seed-owner` has written a
- * password-holding `greg@gregdetre.com` since 2026-08-31, generated per machine
+ * password-holding `dev-admin@spideryarn.local` since 2026-08-31, generated per machine
  * into `~/.config/spideryarn/local-admin-password`
  * (docs/plans/260831ab-seed-local-admin-user-for-remote-box.md). No Google, no
  * dashboard, no human. Nothing knew how to hand it to a browser; this does.
@@ -48,7 +48,7 @@
  * token. docs/reusable/silent-success.md.
  *
  * **And a 200 does not say whose session it is**, which is the half the first
- * version of this file got wrong: it printed "signed in as greg@gregdetre.com"
+ * version of this file got wrong: it printed "signed in as" the seeded account
  * while having observed only that *some* accepted token reached the library
  * route. `/api/library` answers 200 for any authenticated user. GPT Sol, on the
  * built code, 2026-09-01.
diff --git a/scripts/db-seed-dev.ts b/scripts/db-seed-dev.ts
index 79218e7..5b8be9b 100644
--- a/scripts/db-seed-dev.ts
+++ b/scripts/db-seed-dev.ts
@@ -15,7 +15,7 @@
  *
  * It is **not** a third account either. The account is the one
  * [`scripts/seed-accounts.ts`](seed-accounts.ts) already writes —
- * `greg@gregdetre.com` at `ADMIN_USER_ID_LOCAL`, with a password generated per
+ * `dev-admin@spideryarn.local` at `ADMIN_USER_ID_LOCAL`, with a password generated per
  * machine into `~/.config/spideryarn/local-admin-password`. There is no Google
  * step on a local stack and there never was; `npm run db:admin-password` prints
  * the credentials and [`scripts/browser-sign-in.ts`](browser-sign-in.ts) types
@@ -79,7 +79,7 @@ import { styleText } from "node:util";
 
 import { eq, sql } from "drizzle-orm";
 
-import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
+import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
 import { closeDb, getDb } from "../src/db/client.js";
 import { articles } from "../src/db/schema.js";
 import { isLocalDatabaseUrl, withoutPassword } from "../src/db/ssl.js";
@@ -194,7 +194,7 @@ try {
   const account = await db.execute(sql`select email from auth.users where id = ${owner}`);
   if (account.rows.length === 0) {
     die(
-      `no auth.users row for ${owner} (${ADMIN_EMAIL}).\n` +
+      `no auth.users row for ${owner} (${ADMIN_EMAIL_LOCAL}).\n` +
         "  Run: npm run db:seed-owner — it makes the account and this puts articles on its shelf.\n" +
         "  Or npm run setup, which runs both in order.",
     );
@@ -370,7 +370,7 @@ try {
     /* The shelf total is context for a person, and nothing depends on it. The
        claim that matters is the one above, which asked the reading route. */
     const shelf = await runAsOwner(owner, () => pgArticleReader.listArticles());
-    console.log(dim(`  ${shelf.length} article(s) on ${ADMIN_EMAIL}'s shelf in total`));
+    console.log(dim(`  ${shelf.length} article(s) on ${ADMIN_EMAIL_LOCAL}'s shelf in total`));
   } finally {
     await releaseCorpusLock();
   }
diff --git a/scripts/db-seed-owner.ts b/scripts/db-seed-owner.ts
index 2b44483..2d76680 100644
--- a/scripts/db-seed-owner.ts
+++ b/scripts/db-seed-owner.ts
@@ -14,8 +14,8 @@
  * `insert into articles` fails on the foreign key.
  *
  * **And why the second row.** A fresh stack — a `db:reset`, a new clone, the
- * Hetzner box — has no `greg@gregdetre.com`, so there is no session and no way
- * to get one that does not go through Google in a browser on that machine.
+ * Hetzner box — has nobody to sign in as, so there is no session and no way to
+ * get one that does not go through Google in a browser on that machine.
  * docs/plans/260831ab-seed-local-admin-user-for-remote-box.md is the whole of it.
  * The account is seeded with a password, so signing in is the email form that is
  * already on the landing page.
@@ -42,13 +42,14 @@ import { execFileSync } from "node:child_process";
 import { homedir } from "node:os";
 import path from "node:path";
 
-import { ADMIN_EMAIL } from "../src/admin.js";
+import { ADMIN_EMAIL_LOCAL } from "../src/admin.js";
 import { loadEnvLocal } from "../src/env.js";
 import {
   type PasswordVerdict,
   type SeededAccount,
   SEEDED_ACCOUNTS,
   parseStatusEnv,
+  planAccountEmail,
   readOrCreateAdminPassword,
   readPasswordVerdict,
   refuseMismatchedStack,
@@ -252,13 +253,45 @@ async function ensureAccount(account: SeededAccount): Promise<void> {
   }
 
   const byId = await findById(id);
-  if (byId && byId.email?.trim().toLowerCase() !== email.trim().toLowerCase()) {
+  const plan = planAccountEmail(byId, account);
+  if (plan === "refuse") {
     throw new Error(
-      `the id ${id} is already held by ${byId.email ?? "an account with no address"},\n` +
-        `  not by ${email}. Refusing to touch it.`,
+      `the id ${id} is already held by ${byId?.email ?? "an account with no address"},\n` +
+        `  not by ${email}. Refusing to touch it.` +
+        (account.renamableFrom.length
+          ? `\n  (It would have been renamed from ${account.renamableFrom.join(" or ")} without asking.)`
+          : ""),
     );
   }
 
+  /**
+   * **Catch up a machine seeded before the address changed.**
+   *
+   * Done here, before the password block below, because everything after this
+   * point signs in *at the new address* — so a rename left until later would
+   * make its own precondition false and the run would report a wrong password
+   * on an account whose password is fine.
+   *
+   * Safe to do unasked for the four reasons in `planAccountEmail`, and cheap:
+   * the password and every open session survive it (measured, 2026-09-02).
+   */
+  if (plan === "rename") {
+    const response = await fetch(`${url}/auth/v1/admin/users/${id}`, {
+      method: "PUT",
+      headers,
+      body: JSON.stringify({ email, email_confirm: true }),
+    });
+    if (!response.ok) {
+      throw new Error(
+        `renaming ${byId?.email ?? id} to ${email} failed: ${response.status} ${await response.text()}`,
+      );
+    }
+    /* Said out loud rather than done quietly. Somebody who has been signing in
+       as the old address for two days needs to read one line about why it has
+       stopped existing, and this is the only place that line can appear. */
+    console.log(`✓ renamed ${byId?.email} to ${email} (${id}) — same account, same password`);
+  }
+
   if (!byId) {
     const response = await fetch(`${url}/auth/v1/admin/users`, {
       method: "POST",
@@ -398,10 +431,10 @@ try {
      terminal scrollback, CI logs and tmux history on a box several agents
      share; never printing it would leave somebody with no way to sign in. */
   if (admin.created) {
-    console.log(`\n  A password was generated for ${ADMIN_EMAIL}. It is shown once:\n`);
+    console.log(`\n  A password was generated for ${ADMIN_EMAIL_LOCAL}. It is shown once:\n`);
     console.log(`      ${admin.password}\n`);
   }
-  console.log(`  Sign in as ${ADMIN_EMAIL}. The password is in ${admin.path}`);
+  console.log(`  Sign in as ${ADMIN_EMAIL_LOCAL}. The password is in ${admin.path}`);
   console.log("  and `npm run db:admin-password` prints it again.");
 } catch (err) {
   console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
diff --git a/scripts/seed-accounts.ts b/scripts/seed-accounts.ts
index 0e965c7..eff764d 100644
--- a/scripts/seed-accounts.ts
+++ b/scripts/seed-accounts.ts
@@ -17,7 +17,7 @@ import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "n
 import path from "node:path";
 import { randomBytes } from "node:crypto";
 
-import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
+import { ADMIN_EMAIL, ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
 import { DEV_OWNER_EMAIL, DEV_OWNER_ID } from "../src/owner.js";
 
 /**
@@ -158,7 +158,7 @@ export function readAdminCredentials(home: string): AdminCredentials {
         "  set it on the account. Every open session for that account ends.",
     };
   }
-  return { ok: true, email: ADMIN_EMAIL, password: contents.trim(), path: file };
+  return { ok: true, email: ADMIN_EMAIL_LOCAL, password: contents.trim(), path: file };
 }
 
 /** One row `db:seed-owner` guarantees, and what it is for. */
@@ -180,10 +180,21 @@ export interface SeededAccount {
    *
    * Per account, because the two answers are genuinely different and a shared
    * sentence gets one of them wrong. That is not hypothetical: the Hetzner box
-   * already holds `greg@gregdetre.com` on an id nothing recognises, so this is
-   * the first message somebody reads there.
+   * already holds an admin address on an id nothing recognises, so this is the
+   * first message somebody reads there.
    */
   mismatchAdvice: string;
+  /**
+   * Addresses this account **used to** be called, newest first.
+   *
+   * Our id holding one of these is a machine seeded before the rename, not a
+   * collision — so the seed writes the new address on and carries on, rather
+   * than refusing and waiting for a human. Empty means the account has never
+   * been called anything else, and any other address at our id is a refusal.
+   *
+   * See `planAccountEmail` for why this is safe to act on unasked.
+   */
+  renamableFrom: readonly string[];
 }
 
 /**
@@ -213,12 +224,19 @@ export const SEEDED_ACCOUNTS: readonly SeededAccount[] = [
     mismatchAdvice:
       "Rows already written point at one id or the other, so do not just delete it.\n" +
       "  Set SPIDERYARN_OWNER_ID to the id above and leave the account alone.",
+    renamableFrom: [],
   },
   {
     id: ADMIN_USER_ID_LOCAL,
-    email: ADMIN_EMAIL,
+    email: ADMIN_EMAIL_LOCAL,
     signsIn: true,
     why: "the account Greg signs in as, and the one /api/admin/* recognises",
+    /* **The one rename this repo performs unasked**, and only here. Every
+       machine seeded between 2026-08-31 and 2026-09-02 has Greg's real
+       production address on this local row, which is the confusion the rename
+       exists to end — so it has to happen without him running anything.
+       `planAccountEmail` is the fence. */
+    renamableFrom: [ADMIN_EMAIL],
     mismatchAdvice:
       "This is the SIGN-IN account, so SPIDERYARN_OWNER_ID has nothing to do with it —\n" +
       "  /api/admin/* recognises the ids in src/admin.ts and no others, so the account\n" +
@@ -228,6 +246,58 @@ export const SEEDED_ACCOUNTS: readonly SeededAccount[] = [
   },
 ];
 
+/**
+ * What to do about the address on our id. Pure, so tests/seed-accounts.test.ts
+ * can exercise every branch with no GoTrue running.
+ *
+ * - `create` — nothing at that id yet.
+ * - `keep` — it is already called what we want.
+ * - `rename` — it holds an address this account used to be called
+ *   (`renamableFrom`), so a machine seeded before the rename catches up on its
+ *   next `npm run db:seed-owner` and nobody has to be told.
+ * - `refuse` — anything else, which is somebody else's account at our id.
+ *
+ * ## Why renaming unasked is safe here and would not be anywhere else
+ *
+ * Writing an address onto an account you did not create is, in general, account
+ * takeover. Four things make this the narrow exception rather than the rule,
+ * and all four have to hold:
+ *
+ * - **The stack is local, twice over.** `refuseNonLocalSeed` checks the parsed
+ *   hostname and `refuseMismatchedStack` asks the Supabase CLI which containers
+ *   these actually are — so this cannot run against production, where Greg's
+ *   real `greg@gregdetre.com` lives.
+ * - **It is one id, fixed in git.** Only `ADMIN_USER_ID_LOCAL` has anything in
+ *   `renamableFrom`. No row we did not seed is reachable.
+ * - **It is one *from* address, also fixed in git.** Not "any address", not a
+ *   pattern — the literal previous value, listed.
+ * - **It destroys nothing.** Measured on GoTrue v2.195.0, 2026-09-02: an admin
+ *   email change leaves the password alone, leaves open sessions valid, and the
+ *   new address signs in immediately. Unlike the password write above it, which
+ *   revokes every session and is therefore done only when it must be.
+ *
+ * Compared **case-insensitively and trimmed**, because an address is not
+ * case-sensitive in the part that matters and GoTrue stores what it was given.
+ * A case difference read as "somebody else" would refuse for ever.
+ */
+export type EmailPlan = "create" | "keep" | "rename" | "refuse";
+
+export function planAccountEmail(
+  /** The row at our id, or `undefined` if there is none. */
+  row: { email?: string } | undefined,
+  account: Pick<SeededAccount, "email" | "renamableFrom">,
+): EmailPlan {
+  if (!row) return "create";
+  const norm = (value: string) => value.trim().toLowerCase();
+  /* An account with no address at all is not one of ours and not renamable —
+     it is a row somebody made by hand, and guessing is how this goes wrong. */
+  const held = row.email === undefined ? undefined : norm(row.email);
+  if (held === undefined) return "refuse";
+  if (held === norm(account.email)) return "keep";
+  if (account.renamableFrom.some((was) => norm(was) === held)) return "rename";
+  return "refuse";
+}
+
 /**
  * Refuse to seed anything but a local stack. Returns the refusal, or `undefined`
  * to proceed.
diff --git a/src/admin.ts b/src/admin.ts
index 54887a5..bb8d6e9 100644
--- a/src/admin.ts
+++ b/src/admin.ts
@@ -136,9 +136,46 @@ export const ADMIN_USER_IDS: readonly string[] = [ADMIN_USER_ID_LOCAL, ADMIN_USE
  * **Not what the gate compares** — see the header. It is here so that the
  * constant above is legible, and so `describeAdminMiss` can tell "somebody
  * else" from "the right person on a new account" without a second lookup.
+ *
+ * **Greg's real address, and only ever production's.** The local stack uses
+ * `ADMIN_EMAIL_LOCAL` below; do not reach for this one when seeding.
  */
 export const ADMIN_EMAIL = "greg@gregdetre.com";
 
+/**
+ * What `ADMIN_USER_ID_LOCAL` is called on a local stack — **a dummy, and it
+ * says so.**
+ *
+ * ## Why it is not Greg's address
+ *
+ * It was, until 2026-09-02, and that was a confusion waiting to happen. Greg:
+ *
+ * > I worry about confusion, because greg@gregdetre.com is my real user on
+ * > production with Google login. So I'd like the dev-dummy user to be called
+ * > something distinct and different, and that highlights it's a dummy.
+ *
+ * The two accounts had the same address and nothing else in common: different
+ * projects, different ids, one signed in with Google by a human and one holding
+ * a generated password so that no human is needed. A screenshot, a Studio user
+ * table or an admin page therefore could not be read for which stack it came
+ * from — and the single worst mistake available in this repo is doing something
+ * to production while believing you are local.
+ *
+ * **Renaming it costs nothing, because the gate never read it.** `/api/admin/*`
+ * compares uuids (see the header at length), `SPIDERYARN_OWNER_ID` is a uuid,
+ * and `tests/helpers/authed.ts` signs with a uuid. The address is a label on a
+ * row, so this changes what a person sees and nothing that code decides.
+ *
+ * `.local` is not a deliverable TLD (RFC 6762), so nothing can send to it by
+ * accident, and it matches `DEV_OWNER_EMAIL` in src/owner.ts — the pair reads as
+ * a matched set of local fixtures rather than as one real person and one not.
+ *
+ * `scripts/seed-accounts.ts` renames an existing row from `ADMIN_EMAIL` to this
+ * without being asked, so a machine seeded before 2026-09-02 needs nothing run
+ * by hand.
+ */
+export const ADMIN_EMAIL_LOCAL = "dev-admin@spideryarn.local";
+
 /**
  * Is this the administrator?
  *
diff --git a/tests/admin.test.ts b/tests/admin.test.ts
index 4e5ef9e..a1dcdc8 100644
--- a/tests/admin.test.ts
+++ b/tests/admin.test.ts
@@ -18,6 +18,7 @@ import { describe, expect, it } from "vitest";
 
 import {
   ADMIN_EMAIL,
+  ADMIN_EMAIL_LOCAL,
   ADMIN_USER_ID_LOCAL,
   ADMIN_USER_ID_PROD,
   ADMIN_USER_IDS,
@@ -38,7 +39,14 @@ describe("the administrator", () => {
        suite actually depends on: whatever the helper signs with, `isAdmin` says
        yes to it. That breaks if somebody points `TEST_SUB` somewhere else. */
     expect(isAdmin(TEST_SUB)).toBe(true);
-    expect(ADMIN_EMAIL).toBe(TEST_EMAIL);
+    /* **And the suite is not pretending to be Greg's real address.** It was,
+       until 2026-09-02, and `expect(ADMIN_EMAIL).toBe(TEST_EMAIL)` is what
+       pinned it there. The local account is a fixture with a generated password
+       (src/admin.ts § ADMIN_EMAIL_LOCAL); the production one is a person with a
+       Google sign-in, and the two sharing an address is how a screenshot of one
+       gets read as the other. */
+    expect(TEST_EMAIL).toBe(ADMIN_EMAIL_LOCAL);
+    expect(TEST_EMAIL).not.toBe(ADMIN_EMAIL);
   });
 
   it("is the same id however it was typed", () => {
@@ -118,9 +126,12 @@ describe("which refusals are worth a line in the log", () => {
 /**
  * **The id was read off a laptop and never checked against production.**
  *
- * `greg@gregdetre.com` is an account on the local Supabase stack *and* an
- * account on the production project, and they are two different accounts with
- * two different `auth.users(id)`s. The constant was the local one, so the Admin
+ * `greg@gregdetre.com` was an account on the local Supabase stack *and* an
+ * account on the production project, and they were two different accounts with
+ * two different `auth.users(id)`s. (Only production's is that address now — the
+ * local one was renamed to `ADMIN_EMAIL_LOCAL` on 2026-09-02 so that a
+ * screenshot of one could not be read as the other. The bug below is why the
+ * ids were never interchangeable either.) The constant was the local one, so the Admin
  * link never drew on spideryarn.com and `/api/admin/*` answered 403 to the
  * administrator — for a day, silently, exactly the lockout `describeAdminMiss`
  * was written to explain (it did fire; nobody was reading the log).
diff --git a/tests/auth.test.ts b/tests/auth.test.ts
index 39d9aa0..7f68924 100644
--- a/tests/auth.test.ts
+++ b/tests/auth.test.ts
@@ -15,7 +15,7 @@
 import { describe, expect, it } from "vitest";
 import type { IncomingMessage } from "node:http";
 
-import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
+import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../src/admin.js";
 import { requireUser, type VerifyResult } from "../src/auth.js";
 
 /**
@@ -40,7 +40,7 @@ function req(authorization?: string): IncomingMessage {
 const says = (claims: Record<string, unknown>) => async (): Promise<VerifyResult> =>
   ({ ok: true, claims } as VerifyResult);
 
-const good = { sub: SUB, email: "greg@gregdetre.com", role: "authenticated", is_anonymous: false };
+const good = { sub: SUB, email: ADMIN_EMAIL_LOCAL, role: "authenticated", is_anonymous: false };
 
 /** What the thrown error says its HTTP status is. `httpError` in src/routes.ts. */
 async function statusOf(p: Promise<unknown>): Promise<number> {
@@ -104,7 +104,7 @@ describe("requireUser", () => {
 
   it("returns the user for a good token", async () => {
     const user = await requireUser(req("Bearer t"), says(good));
-    expect(user).toEqual({ id: SUB, email: "greg@gregdetre.com" });
+    expect(user).toEqual({ id: SUB, email: ADMIN_EMAIL_LOCAL });
   });
 
   /**
@@ -129,7 +129,11 @@ describe("requireUser", () => {
       );
       expect(message).not.toContain("SECRET");
       expect(message).not.toContain(SUB);
-      expect(message).not.toContain("gregdetre");
+      /* The address itself, not a fragment of it. `"gregdetre"` was the needle
+         until 2026-09-02, and once the fixture stopped using that address it
+         would have been a check that could no longer fail —
+         docs/reusable/silent-success.md. */
+      expect(message).not.toContain(good.email);
     }
   });
 });
diff --git a/tests/helpers/authed.ts b/tests/helpers/authed.ts
index 7e2ad48..2630f19 100644
--- a/tests/helpers/authed.ts
+++ b/tests/helpers/authed.ts
@@ -14,7 +14,7 @@
  * makes a production build permissive is exactly the fail-open this whole area
  * is about. The real verifier is the default there; this is passed in.
  */
-import { ADMIN_USER_ID_LOCAL } from "../../src/admin.js";
+import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL } from "../../src/admin.js";
 import type { Verifier, VerifyResult } from "../../src/auth.js";
 import { type OwnerId, runAsOwner } from "../../src/owner.js";
 
@@ -30,7 +30,18 @@ import { type OwnerId, runAsOwner } from "../../src/owner.js";
  * caught the other three.
  */
 export const TEST_SUB = ADMIN_USER_ID_LOCAL;
-export const TEST_EMAIL = "greg@gregdetre.com";
+
+/**
+ * The address that id is called **on a local stack** — a fixture, not a person.
+ *
+ * Written out longhand as Greg's real `greg@gregdetre.com` until 2026-09-02,
+ * which is the very thing the comment above is about, one constant later. It
+ * mattered more here than it looks: `tests/feedback-route.test.ts` asserts a
+ * submitted report carries this as its `reporterEmail`, so the suite was
+ * manufacturing bug reports from Greg's real address and checking they came out
+ * intact.
+ */
+export const TEST_EMAIL = ADMIN_EMAIL_LOCAL;
 
 /**
  * The same identity, as the store's `OwnerId`.
diff --git a/tests/public-dispatch.test.ts b/tests/public-dispatch.test.ts
index 3064979..f07b8c1 100644
--- a/tests/public-dispatch.test.ts
+++ b/tests/public-dispatch.test.ts
@@ -38,7 +38,7 @@ import { runInRequest } from "../src/owner.js";
 import { PUBLIC_ROUTES } from "../src/public/routes.js";
 import { handleApi, serveAuthenticatedApi } from "../src/routes.js";
 import { originalUrl } from "../src/vercel.js";
-import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";
+import { acceptAny, AUTHED_HEADERS, TEST_EMAIL } from "./helpers/authed.js";
 
 /** Drive `handleApi` with a fake request/response pair, remembering the headers. */
 async function call(
@@ -266,7 +266,11 @@ describe("the authenticated dispatcher's one parameter", () => {
       headers: AUTHED_HEADERS,
     }) as unknown as IncomingMessage;
     const user = await requireUser(req, acceptAny);
-    expect(user.email).toBe("greg@gregdetre.com");
+    /* `TEST_EMAIL`, not the address longhand: this is asserting who
+       `AUTHED_HEADERS` authenticates as, and a copied string stops tracking
+       that the moment the fixture identity changes — which it did on
+       2026-09-02. */
+    expect(user.email).toBe(TEST_EMAIL);
 
     let status = 0;
     let text = "";
diff --git a/tests/routes.test.ts b/tests/routes.test.ts
index b9588fe..fbbd79d 100644
--- a/tests/routes.test.ts
+++ b/tests/routes.test.ts
@@ -1413,9 +1413,9 @@ describe("the gate", () => {
 /**
  * The second gate: `/api/admin/` is the administrator's, and nobody else's.
  *
- * `tests/helpers/authed.ts` signs every other test in this file in as
- * `greg@gregdetre.com`, who *is* the administrator — so the interesting case
- * needs a verifier of its own. See src/admin.ts and docs/project/admin.md.
+ * `tests/helpers/authed.ts` signs every other test in this file in as the local
+ * administrator (`TEST_SUB`, which `isAdmin` says yes to) — so the interesting
+ * case needs a verifier of its own. See src/admin.ts and docs/project/admin.md.
  */
 describe("the admin gate", () => {
   /** Somebody else entirely, signed in perfectly properly. */
diff --git a/tests/seed-accounts.test.ts b/tests/seed-accounts.test.ts
index 3c614f1..79f48a1 100644
--- a/tests/seed-accounts.test.ts
+++ b/tests/seed-accounts.test.ts
@@ -12,7 +12,7 @@
  */
 import { describe, expect, it } from "vitest";
 
-import { ADMIN_EMAIL, ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
+import { ADMIN_EMAIL, ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL, isAdmin } from "../src/admin.js";
 import { DEV_OWNER_ID } from "../src/owner.js";
 import { mkdtempSync, chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
 import { tmpdir } from "node:os";
@@ -21,6 +21,7 @@ import path from "node:path";
 import {
   SEEDED_ACCOUNTS,
   adminPasswordPath,
+  planAccountEmail,
   newAdminPassword,
   passwordFileIsUsable,
   readAdminCredentials,
@@ -35,7 +36,7 @@ const NOTHING_SET = {} as Record<string, string | undefined>;
 
 describe("what gets seeded", () => {
   it("seeds an account the admin gate actually recognises", () => {
-    const admin = SEEDED_ACCOUNTS.find((a) => a.email === ADMIN_EMAIL);
+    const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL);
     expect(admin).toBeDefined();
     expect(admin?.id).toBe(ADMIN_USER_ID_LOCAL);
     /* The claim that matters: not "the constant equals itself" but "the gate
@@ -44,7 +45,7 @@ describe("what gets seeded", () => {
   });
 
   it("expects a sign-in for the administrator and none for the row-owner", () => {
-    const admin = SEEDED_ACCOUNTS.find((a) => a.email === ADMIN_EMAIL);
+    const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL);
     const owner = SEEDED_ACCOUNTS.find((a) => a.id === DEV_OWNER_ID);
     expect(admin?.signsIn).toBe(true);
     /* Nothing signs in as the row-owner, so a credential on it would be one that
@@ -57,6 +58,23 @@ describe("what gets seeded", () => {
     expect(new Set(SEEDED_ACCOUNTS.map((a) => a.email)).size).toBe(SEEDED_ACCOUNTS.length);
   });
 
+  /**
+   * **Greg's real address is not what a local stack is called**, which is the
+   * whole of the 2026-09-02 rename. Written as a property rather than as
+   * `toBe("dev-admin@…")` so that changing the fixture address again does not
+   * need this test edited — the claim is "not a real person's", not "this
+   * string".
+   */
+  it("gives no seeded account a real person's address", () => {
+    for (const account of SEEDED_ACCOUNTS) {
+      expect(account.email).not.toBe(ADMIN_EMAIL);
+      /* `.local` is reserved and undeliverable (RFC 6762), so an address there
+         cannot be somebody's, cannot receive a confirmation mail by accident,
+         and reads as a fixture at a glance. */
+      expect(account.email.endsWith("@spideryarn.local")).toBe(true);
+    }
+  });
+
 });
 
 describe("the administrator's password file", () => {
@@ -112,6 +130,60 @@ describe("the administrator's password file", () => {
   });
 });
 
+/**
+ * Catching up a machine that was seeded before the address changed.
+ *
+ * The interesting property is not that a rename happens but that it is the ONLY
+ * thing that happens: every address other than the one listed in
+ * `renamableFrom` is still a refusal, and the owner row — which lists none — can
+ * never be renamed at all.
+ */
+describe("planAccountEmail", () => {
+  const admin = SEEDED_ACCOUNTS.find((a) => a.id === ADMIN_USER_ID_LOCAL)!;
+  const owner = SEEDED_ACCOUNTS.find((a) => a.id === DEV_OWNER_ID)!;
+
+  it("creates when nothing is at the id", () => {
+    expect(planAccountEmail(undefined, admin)).toBe("create");
+  });
+
+  it("leaves an account that is already called the right thing alone", () => {
+    expect(planAccountEmail({ email: ADMIN_EMAIL_LOCAL }, admin)).toBe("keep");
+  });
+
+  it("renames the pre-2026-09-02 row rather than refusing and waiting for a human", () => {
+    /* The case every existing laptop and box is in. Without this the seed dies
+       on `the id … is already held by …`, and setup stops at step 3 on every
+       machine that already worked. */
+    expect(planAccountEmail({ email: ADMIN_EMAIL }, admin)).toBe("rename");
+  });
+
+  it("does not mistake a case difference for somebody else", () => {
+    expect(planAccountEmail({ email: ADMIN_EMAIL.toUpperCase() }, admin)).toBe("rename");
+    expect(planAccountEmail({ email: ` ${ADMIN_EMAIL_LOCAL.toUpperCase()} ` }, admin)).toBe("keep");
+  });
+
+  it("refuses an address that is neither ours nor one we used to have", () => {
+    expect(planAccountEmail({ email: "someone@example.com" }, admin)).toBe("refuse");
+  });
+
+  it("refuses a row with no address rather than guessing it is ours", () => {
+    expect(planAccountEmail({}, admin)).toBe("refuse");
+  });
+
+  it("will not rename the row-owner, which has never been called anything else", () => {
+    expect(owner.renamableFrom).toEqual([]);
+    expect(planAccountEmail({ email: ADMIN_EMAIL }, owner)).toBe("refuse");
+  });
+
+  it("only ever renames FROM an address, never onto a live one", () => {
+    /* The dangerous inversion: if `renamableFrom` ever contained the address we
+       are moving TO, the plan would be circular. Cheap to pin. */
+    for (const account of SEEDED_ACCOUNTS) {
+      expect(account.renamableFrom).not.toContain(account.email);
+    }
+  });
+});
+
 /**
  * The half of the password file that must NEVER write.
  *
@@ -133,7 +205,7 @@ describe("readAdminCredentials", () => {
     expect(found.ok).toBe(true);
     if (!found.ok) return;
     expect(found.password).toBe(made.password);
-    expect(found.email).toBe(ADMIN_EMAIL);
+    expect(found.email).toBe(ADMIN_EMAIL_LOCAL);
     expect(found.path).toBe(adminPasswordPath(dir));
   });
 
```
