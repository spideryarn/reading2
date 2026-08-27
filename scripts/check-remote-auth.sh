#!/usr/bin/env bash
#
# Which sign-in providers does the REMOTE Supabase project actually have on?
#
# Usage:
#   ./scripts/check-remote-auth.sh
#
# On 2026-08-27 Greg pressed "Continue with Google" on www.spideryarn.com and got
#
#   {"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
#
# which is this endpoint's answer, rendered as a wall. See
# docs/plans/google-sign-in-production.md.
#
# `/auth/v1/settings` is unauthenticated apart from an `apikey` header, and the
# publishable key is not a secret — it ships in the browser bundle by design.
# It is read from .env.prod so that this file names no project and no key.
#
# ## The controls are the point, and they are why this prints five lines
#
# A checker that asks only about `google`, finds `false`, and says OFF cannot
# tell you apart a disabled provider from a typo in the JSON path — both come
# back falsy and both read as "off". So every run also asserts that `email` is
# ON and `github` is OFF. Two verdicts that must disagree with each other, in
# the same response, before the third one means anything.
#
# This repo has already shipped that exact bug once — a redirect checker that
# grepped for a string which lived somewhere else and therefore passed
# everything. See docs/plans/auth-ui-and-production.md § The check, and why it
# is written this way, and docs/reusable/silent-success.md.
#
# Exit status: 0 google is on, 1 google is off, 2 the check itself is broken
# (no key, no answer, or a control that came back the wrong way round).

set -uo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C

env_from_prod() { grep "^$1=" .env.prod 2>/dev/null | cut -d= -f2- | tr -d '"'; }

URL=${SUPABASE_URL:-$(env_from_prod SUPABASE_URL)}
KEY=${SUPABASE_PUBLISHABLE_KEY:-$(env_from_prod SUPABASE_PUBLISHABLE_KEY)}
[ -z "${KEY:-}" ] && KEY=$(env_from_prod SUPABASE_ANON_KEY)

if [ -z "${URL:-}" ] || [ -z "${KEY:-}" ]; then
  echo "Need SUPABASE_URL and a publishable/anon key — from the environment or .env.prod." >&2
  echo "See docs/project/database.md for which credentials exist and where." >&2
  exit 2
fi

case "$URL" in
  *127.0.0.1*|*localhost*)
    echo "SUPABASE_URL is $URL — that is the LOCAL stack, not the remote project." >&2
    echo "This check is about production. Unset SUPABASE_URL and let .env.prod answer." >&2
    exit 2
    ;;
esac

echo "$URL"

body=$(curl -s --max-time 20 -H "apikey: $KEY" "$URL/auth/v1/settings")
if [ -z "$body" ] || ! printf '%s' "$body" | jq -e '.external' >/dev/null 2>&1; then
  echo "No usable answer from /auth/v1/settings:" >&2
  printf '%s\n' "${body:-<empty>}" >&2
  exit 2
fi

state() { printf '%s' "$body" | jq -r --arg p "$1" 'if .external[$p] then "ON" else "OFF" end'; }

google=$(state google)
email=$(state email)
github=$(state github)

echo "--- controls (email must be ON and github must be OFF, or ignore the line below) ---"
printf '  %-8s %s\n' "email" "$email"
printf '  %-8s %s\n' "github" "$github"
echo "--- the one that matters ---"
printf '  %-8s %s\n' "google" "$google"

on=$(printf '%s' "$body" | jq -r '.external | to_entries | map(select(.value)) | map(.key) | join(", ")')
echo "all providers on: ${on:-<none>}"
# Deliberately not "anybody can sign up": this endpoint only knows whether
# signup is disabled. Who can actually reach a signup also depends on which
# providers are on and, for Google, on whether its consent screen is published
# or still in Testing — neither of which is readable from here. Overstating it
# was a GPT Sol finding on 2026-08-27.
printf 'signups %s, email confirmation %s\n' \
  "$(printf '%s' "$body" | jq -r 'if .disable_signup then "disabled" else "enabled" end')" \
  "$(printf '%s' "$body" | jq -r 'if .mailer_autoconfirm then "off (autoconfirm)" else "required" end')"

if [ "$email" != "ON" ] || [ "$github" != "OFF" ]; then
  echo
  echo "The controls came back the wrong way round. This check is not measuring what it claims to." >&2
  exit 2
fi

if [ "$google" != "ON" ]; then
  echo
  echo "Google is off on this project — that is the 'provider is not enabled' error." >&2
  echo "Fix: npx tsx scripts/supabase-auth-config.ts apply" >&2
  echo "See docs/plans/google-sign-in-production.md." >&2
  exit 1
fi
