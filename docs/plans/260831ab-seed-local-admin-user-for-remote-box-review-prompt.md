# Review request: seeding the local admin sign-in account

You are reviewing a **plan**, before it is built, for the Spideryarn repo (working directory is the
repo root — read whatever you need).

## The ask, from Greg (2026-08-31)

> For the Hetzner remote box, it expects a `greg@gregdetre.com` admin user. I could try and use the
> VNC to sign in via Google on that box. But I'd prefer if there was a more automatic way. Could you
> create a user in that database with that email address (and make that be part of the setup)?

## The plan

Read `docs/plans/260831ab-seed-local-admin-user-for-remote-box.md` in full. It is short.

## Context files worth opening

- `scripts/db-seed-owner.ts` — the script being extended
- `src/admin.ts` — who the administrator is; `ADMIN_USER_ID_LOCAL`, `ADMIN_EMAIL`, `isAdmin`
- `src/owner.ts` — `DEV_OWNER_ID`, and the request/environment split
- `src/auth.ts`, `src/routes.ts` — the gate and the `/api/admin` refusal
- `docs/project/supabase-local.md` — the local stack, its ports, and the "these keys are not secret,
  the firewall is the boundary" paragraph
- `docs/project/auth.md`, `docs/project/admin.md`
- `infra/hetzner/main.tf` — the firewall (22/tcp + mosh UDP only)
- `scripts/gjd-remote-env.ts` — the allowlist of what reaches the box's `.env.local`
- `scripts/seed-local-session.ts` — the magic-link route the plan passes over
- `docs/reusable/silent-success.md` — the house rule about checks that agree with the bug

## What I want from you

Be adversarial and concrete. In particular:

1. **The password-as-committed-constant decision.** The plan argues an env var's unset state is
   worse than a constant. Is that right *here*? What is the strongest argument against, and is there
   a third option that beats both? Note the stack binds `0.0.0.0` and only the Hetzner firewall
   stands in front of it.
2. **The fixed-uuid decision.** Seeding `ADMIN_USER_ID_LOCAL` means a uuid that grants admin is now
   *created by a script* rather than minted by a real sign-in. `src/admin.ts` already anticipates
   this ("a seed or a restore pointed at production could mint that id"). Does this plan make that
   materially worse, and is the local-only guard in `db-seed-owner.ts` actually sufficient? Read the
   guard — it is a regex on `SUPABASE_URL`. Can it be got past by something plausible rather than
   adversarial (an SSH tunnel to a remote project on 127.0.0.1, say)?
3. **Setting a password on an account whose only identity is `google`.** On Greg's laptop that row
   already exists. Will GoTrue's password grant work for it after an admin password update, or does
   it need an `email` identity too? If you know the answer for GoTrue v2.195.0, say so; if you do
   not, say that rather than guessing — the plan says to measure it.
4. **Idempotency and the re-run cases.** Fresh database; already seeded; the address present on a
   *different* id; a `db:reset` in between; two agents running the seed at once.
5. **Anything the plan's "Checks" section would not catch.** What is the check that agrees with the
   bug here?
6. The consequence the plan flags (admin's shelf starts empty because CLI rows belong to
   `DEV_OWNER_ID`) — is the suggested `SPIDERYARN_OWNER_ID` line right, or does it break something?

Give a verdict (GO / GO WITH CHANGES / STOP) and a numbered list of findings, most serious first,
each with the file and what specifically to do. Say plainly which findings you are confident about
and which are speculative.
