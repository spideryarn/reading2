-- The site account: the owner the public shelf's topic pills are stored under
-- and billed to. Plan docs/plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md;
-- approved by Greg as "q-p5h2a7 A", 2026-10-09.
--
-- It has to be a real auth.users row, because ai_calls, shelf_topic_sets and
-- rate_limit_events all have a foreign key to one, and keeping those keys is
-- better than weakening them. The id is SITE_OWNER_ID in src/site-account.ts;
-- tests/site-account-pg.test.ts checks the two agree and that the row cannot
-- sign in.
--
-- How it is kept from signing in, each on its own enough:
--   - no password: encrypted_password is '', which no bcrypt comparison matches;
--   - no auth.identities row, so no OAuth or OTP identity to sign in through;
--   - an address at .invalid, a domain that by RFC 2606 never receives mail;
--   - banned until the year 2999. Not 'infinity': GoTrue scans this column into
--     a Go time, and one unreadable row breaks the admin user listing for the
--     whole database (the same class as the four token columns below).
--
-- The four token columns are set to '' for the reason tests/helpers/seed-auth-user.ts
-- gives: left NULL, GoTrue's GET /auth/v1/admin/users answers 500 for everyone.
--
-- Additive and idempotent: on conflict it does nothing, so it is safe on a
-- database that already has the row. It owns no articles.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  created_at, updated_at, banned_until,
  confirmation_token, recovery_token, email_change, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data
) values (
  '5173e000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'site@spideryarn.invalid', '',
  now(), now(), '2999-01-01 00:00:00+00',
  '', '', '', '',
  '{"spideryarn":"site"}'::jsonb, '{}'::jsonb
)
on conflict (id) do nothing;
