**Verdict: CHANGES**

1. The immediate diagnosis and ordering are correct; no definite fourth production blocker is visible. Register Google’s Supabase callback first, then enable/configure Google and redirect settings in Supabase.

   On Greg’s first successful production sign-in:

   1. The browser stores the PKCE verifier and return path on `www`.
   2. Google returns to Supabase’s callback.
   3. Supabase should automatically link the verified Google email to the existing confirmed `greg@gregdetre.com` user rather than create another UUID. [Supabase documents this behavior](https://supabase.com/docs/guides/auth/auth-identity-linking).
   4. Supabase returns a one-time code to `/auth/callback`.
   5. The singleton client exchanges it using the stored verifier ([supabase.ts:48](../../src/web/lib/supabase.ts)); the callback handles success/failure correctly ([AuthCallback.tsx:121](../../src/web/AuthCallback.tsx)).
   6. The API gate uses the token’s `sub` as the request owner ([routes.ts:2605](../../src/routes.ts)).
   7. If linking preserved the existing UUID `001bb7a0-…`, Greg sees the imported shelf; otherwise he sees an empty shelf because every query is owner-filtered.

   The plan’s final check must therefore assert Greg’s existing articles appear—or directly assert `session.user.id === 001bb7a0-…`—not merely that sign-in succeeded. The pre-created confirmed user is documented at [database.md:450](../../docs/project/database.md). This is likely to work, but it is the consequential first-use behavior the plan has not proved.

2. The Management API names are exact, but the plan’s `/ _secret` shorthand is unsafe. The documented minimal enablement body is:

   ```json
   {
     "external_google_enabled": true,
     "external_google_client_id": "…apps.googleusercontent.com",
     "external_google_secret": "…"
   }
   ```

   That exact body appears in Supabase’s [Google provider documentation](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/social-login/auth-google.mdx). `site_url` is a string, and `uri_allow_list` is also a **comma-separated string, not an array**, in the [Management API schema](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

   A combined PATCH therefore has five properties, not “four settings”:

   ```json
   {
     "external_google_enabled": true,
     "external_google_client_id": "…",
     "external_google_secret": "…",
     "site_url": "https://www.spideryarn.com",
     "uri_allow_list": "url1,url2,url3"
   }
   ```

3. The endpoint is documented as a genuine field-level PATCH: every request property is optional, so omitted unrelated auth settings should remain unchanged. I could not live-test that without the token, but that is the current API contract.

   One important exception in effect: setting `uri_allow_list` replaces that entire field. Because its current contents are unknown, `show` should precede `apply`, and the script should either merge intentional existing entries or explicitly report which entries it will remove. Never round-trip a masked secret from GET; use the real secret from `.env.local`.

4. The proposed redirect list should be narrowed and corrected.

   - `https://www.spideryarn.com/**` is redundant once that is the Site URL: Supabase accepts the same scheme/host/port as Site URL directly.
   - The apex entry is currently redundant because its 308 happens before app code.
   - `spideryarn-reading2-*-greg-detre…` is already matched by `spideryarn-*-greg-detre…`; `*` includes hyphens.
   - `http://localhost:5173/**` is both irrelevant to the remote project and the wrong local port—the repo uses `5273` ([config.toml:195](../../supabase/config.toml)).
   - `/**` permits every path. This app always requests `/auth/callback`, so exact callback paths are safer.

   A sufficient explicit list is:

   ```text
   https://www.spideryarn.com/auth/callback
   https://spideryarn-greg-detre.vercel.app/auth/callback
   https://spideryarn-*-greg-detre.vercel.app/auth/callback
   ```

   Supabase still validates the complete supplied `redirect_to`: it must share the Site URL origin or match a configured glob. If it fails validation, Supabase silently substitutes Site URL, so Site URL still matters even when `redirect_to` was supplied. See the [redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls) and [validation source](https://github.com/supabase/auth/blob/master/internal/utilities/request.go).

5. I agree that ordinary `try/catch` cannot catch this remote 400; navigation has already left the app. I disagree that the only preflight design is a first-paint request that hides the button.

   A cheap third option is an **on-click** `/auth/v1/settings` check. Keep the button visible; when pressed, verify `external.google`, show fixed local copy if disabled or unreachable, and only then call `signInWithOAuth`. It costs nothing on first paint and prevents this configuration error from becoming raw Supabase JSON. It has a small check/navigation race, but that is acceptable for configuration drift.

6. The missing Vercel `SUPABASE_PUBLISHABLE_KEY` is not a production blocker. Server code deliberately falls back to `SUPABASE_ANON_KEY` ([auth.ts:110](../../src/auth.ts)). The browser has the required `VITE_*` values—the observed authorize URL proves the built bundle successfully initialized the remote client.

7. Several claims should be softened or corrected:

   - “No app code is wrong” and “all proved in a browser” are overclaims: a real production Google callback, automatic identity link, owner UUID preservation, and shelf read have not yet been proved ([plan:164](../../docs/plans/260827i-google-sign-in-production.md)).
   - The plan says the local Site URL is `http://127.0.0.1:3000`; it is `http://localhost:5273`.
   - It says “five globs” but lists six.
   - `scripts/supabase-auth-config.ts` does not currently exist, so the document is not yet a runnable runbook.
   - The older auth plan claims `aud` and `iss` are checked ([260826w-auth-supabase.md:494](../../docs/plans/260826w-auth-supabase.md)); current `requireUser` checks neither ([auth.ts:262](../../src/auth.ts)). That will not break this sign-in, but the security claim is false.
   - “Anybody with a Google account” is unmeasured unless the Google OAuth consent screen’s audience/publishing status is known. The app admits everyone Google authenticates; Google itself may still restrict test users.

No files were changed.