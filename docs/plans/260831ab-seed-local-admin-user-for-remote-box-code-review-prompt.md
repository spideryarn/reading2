# Review request: the BUILT code for seeding the local admin sign-in account

You reviewed the plan for this earlier today and returned GO WITH CHANGES. This is the second
review, on the code, and this repo weights it higher than the first — a plan-stage review reads
prose and cannot find a bug that does not exist until somebody writes it.

Working directory is the repo root. Read whatever you need.

## What you asked for, and what was done

Your plan review is at `docs/plans/260831ab-seed-local-admin-user-for-remote-box-review-sol.md`.
The plan, updated with what the review changed, is at
`docs/plans/260831ab-seed-local-admin-user-for-remote-box.md` — read that first.

Built from your findings:

- **Finding 3 (session revocation).** Confirmed by measurement here, not taken on trust: a refresh
  token answered 200 before an unconditional admin password `PUT` and 400 after it. `ensureAccount`
  now signs in first and writes only when the password is actually wrong; a reply that is not a
  verdict on the password aborts without mutating. Re-measured after the fix: 200 before, 200 after.
- **Finding 1a (independent target evidence).** `refuseMismatchedStack` compares `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` against `supabase status -o env` before any write, and the script
  refuses if the CLI cannot be run at all. The hostname guard is now parsed-host rather than regex.
- **Finding 3 (concurrency).** A 409/422 on create re-reads by id and succeeds if the account that
  now exists is the intended one.
- **Finding 1b (issuer+id gating)** and **finding 2 (generated password in a 0600 file)** were NOT
  built. Both are written up in the plan as decisions for Greg. Tell me if you think either is
  wrong to defer, but do not re-argue them at length — I want your attention on the code.
- **Finding 5** corrected the plan: `SPIDERYARN_OWNER_ID` is not on `push-env`'s allowlist.

## The evidence

- `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e276e4dd-ef83-4487-b8a7-bc42d8fa3ba3/scratchpad/scoped.diff` — the diff for changed files.
- `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e276e4dd-ef83-4487-b8a7-bc42d8fa3ba3/scratchpad/new-files.txt` — the three new files in full.
- Or just read them in the tree: `scripts/seed-accounts.ts`, `scripts/db-seed-owner.ts`,
  `tests/seed-accounts.test.ts`, `tests/seed-admin-signin.test.ts`.

## What I want from you

Bugs in the code, most serious first. Specifically:

1. **`ensureAccount`'s new sign-in-first path.** Is the status discrimination right? GoTrue
   v2.195.0: what does the password grant return for a user with **no password at all** (the
   google-only case, which is the state on Greg's laptop before the first seed), for a wrong
   password, and for a rate-limited caller (`sign_in_sign_ups = 30` per 5 min in
   `supabase/config.toml`)? A 429 read as "wrong password" would revoke exactly the sessions this
   is protecting. And can the account get stuck un-seedable if the first branch is wrong?
2. **The order of the two refusals in `ensureAccount`** (by email, then by id), and whether either
   can mutate before the other has had its say. And the race: is refetch-by-id after 409/422 enough,
   or can two runs both take the create path and one leave a half-made account?
3. **`refuseMismatchedStack` and the `execFileSync` around it.** Is `npx supabase status -o env`
   safe and reliable as a gate — what makes it fail or hang, does `stdio: ["ignore","pipe","ignore"]`
   lose anything I need, is the 120s timeout right, and can its output be spoofed by something a
   realistic accident would produce? Is comparing the service-role key actually meaningful, or does
   the CLI derive it from the same place the env var came from?
4. **`tests/seed-admin-signin.test.ts`.** Does it prove what its header claims? Is the anonymous-401
   control sufficient? Does the `SPIDERYARN_STORE=postgres` gate mean the interesting cases never
   run under `npm test` — i.e. have I built a suite that silently checks nothing?
5. Anything in the docs changed here that is now wrong or overclaims.

Verdict (GO / GO WITH CHANGES / STOP) and a numbered list, each with file and line and what to do.
Say which findings you are confident about and which are speculative.
