**Verdict: CHANGES**

1. **High — the owner-identity check cannot fail reliably.** [check-owner-identity.ts:158](../../scripts/check-owner-identity.ts) merely prints missing owner, duplicate account, unconfirmed email, or missing Google identity and then exits 0. The same command is used before and after sign-in, so a failed post-sign-in link is indistinguishable by status from the intended pre-sign-in state. Add explicit before/after modes and nonzero exits. It also reads only the first 200 users, so it cannot substantiate “no second row” beyond that page.

2. **High — `apply` can falsely report that all six settings landed.** [supabase-auth-config.ts:313](../../scripts/supabase-auth-config.ts) skips the secret unconditionally, including when GET returns it unset. Thus a silently ignored `external_google_secret` still reaches “All six settings read back as written.” The official GET schema includes that field; even if production masks its value, presence must be checked and the exact secret ultimately proved by an OAuth exchange. [Supabase GET config schema](https://supabase.com/docs/reference/api/v1-get-auth-service-config)

   The other comparisons are mostly sound:

   - Booleans returned as booleans compare correctly. `null` versus explicit `false` alarms, appropriately, because the plan specifically requires an explicit write.
   - `uri_allow_list` is compared as raw text, so harmless reordering or whitespace normalization can produce a false alarm. Compare trimmed entry sets.
   - `--dry-run` makes no PATCH, but it does send the initial GET, so “nothing was sent” is inaccurate.
   - The `npx tsx` entrypoint guard is correct for this path, and importing the module does not run `main`.

3. **Medium — the exact allow-list is safe for current flows, but its security rationale is overstated.** Supabase accepts every URL sharing the Site URL’s scheme, host and port before consulting `uri_allow_list`. Consequently, the exact `www.spideryarn.com/auth/callback` entry does not prevent redirects to other `www` paths as claimed at [260827i-google-sign-in-production.md:153](../../docs/plans/260827i-google-sign-in-production.md). It only narrows the apex and Vercel hosts. [Supabase validation source](https://github.com/supabase/auth/blob/master/internal/utilities/request.go#L89-L119)

   Current Google and `signUp` flows are safe: both supply the bare callback, PKCE flow-ID query appending is opt-in and disabled, and Supabase appends `?code=` after validating the supplied redirect. Magic-link and recovery flows are not implemented. Exact production paths are also Supabase’s recommendation. [Redirect documentation](https://supabase.com/docs/guides/auth/redirect-urls)

   If validation does fall back to `site_url`, `/` still exchanges a PKCE code because the singleton initializes before [main.tsx:140](../../src/web/main.tsx). But `AuthCallback` never runs: the remembered deep link is lost, and exchange/provider errors become silent landing-page failures. The plan should say that explicitly.

4. **Medium — `withGoogle` can leave the controls permanently busy.** [SignInControls.tsx:73](../../src/web/SignInControls.tsx) handles a returned `error` but not a rejected `signInWithOAuth` promise. The installed SDK can reject while writing the PKCE verifier or assigning `location`. That becomes an unhandled rejection with `busy=true`. Wrap the call in `try/catch`, preserving the intentional busy state only after navigation begins.

   Otherwise the new state transitions are sound: the form values survive, prior errors clear, the disabled button prevents ordinary double-clicks, and the false-preflight branch restores `busy`.

5. **Medium — email confirmation failures are described as Google failures.** `signUp` sends confirmation links to the same callback, but [AuthCallback.tsx:68](../../src/web/AuthCallback.tsx) hardcodes Google in both error branches. An expired or rejected email-confirmation link therefore says “Google refused the sign-in.” Make callback errors provider-neutral.

6. **Low — the new message violates the repository’s copy contract.** Its wording satisfies the four prose rules, but [copy.md:8](../../docs/project/copy.md) requires failure messages to live in `src/messages.ts` and register their kind. `[auth-provider]` is inline at [SignInControls.tsx:67](../../src/web/SignInControls.tsx), so it escapes the message invariants.

7. **Low — `check-remote-auth.sh` overclaims signup availability.** [check-remote-auth.sh:82](../../scripts/check-remote-auth.sh) prints “anybody with a Google account can make one” solely from `disable_signup=false`, even when Google is off or its consent screen is in Testing. Report only “signups enabled.”

8. **Low — the corrected documentation still contains substantial stale claims.** Examples:

   - [auth.md:322](../../docs/project/auth.md) says auth is `getUser` plus an email comparison.
   - [auth.md:328](../../docs/project/auth.md) still requires wrong-email rejection despite there being no allow-list.
   - [auth.md:142](../../docs/project/auth.md) says the preflight “now” protects production, while the revised plan says it still needs deployment.
   - [260826w-auth-supabase.md:3](../../docs/plans/260826w-auth-supabase.md), its allow-list tests, production globs, and Appendix C still describe the pre-implementation architecture and ownership model.

No defect found in `googleSignInAvailable`: missing `AbortSignal.timeout`, rejected fetch, JSON failure, empty body, arrays, primitives, missing `external`, and non-200 responses all fail open inside the catch. With conforming browser `fetch`, the abort signal also bounds body reading. Its location beside the singleton and auth configuration is reasonable.