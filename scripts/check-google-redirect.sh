#!/usr/bin/env bash
#
# Does Google accept a given redirect URI for our OAuth client?
#
# Usage:
#   ./scripts/check-google-redirect.sh                       # the three we care about
#   ./scripts/check-google-redirect.sh https://some/other/cb  # or name your own
#
# Why this exists, and why it is written this way, is in
# docs/plans/auth-ui-and-production.md § The one thing that blocks production.
# Short version, because it is the trap this repo already paid for once:
#
#   * `-L` is not optional. Without it curl fetches the body of a 302 — a stub —
#     and any grep over it finds nothing whatever is true.
#   * The verdict is the page you LAND on, not a string in the body. Google puts
#     the reason in a base64 `authError` parameter on the final URL. An earlier
#     version of this check grepped the body for "redirect_uri_mismatch" and
#     reported PASS for a URI that a real browser refused.
#   * A known-bad URI is checked on every run. A column of ACCEPTEDs proves
#     nothing unless something in the same run says REJECTED.
#
# See docs/reusable/silent-success.md.

set -uo pipefail
cd "$(dirname "$0")/.."
export LC_ALL=C

CID=$(grep '^SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"')
if [ -z "${CID:-}" ]; then
  echo "No SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID in .env.local — see docs/plans/auth-supabase.md" >&2
  exit 2
fi

# The control. Never registered, and never will be: if this line does not say
# REJECTED, the check is broken and every other line is meaningless.
CONTROL="https://not-registered.example/cb"

if [ "$#" -gt 0 ]; then
  URIS=("$@")
else
  URIS=(
    "http://127.0.0.1:54361/auth/v1/callback"                       # local stack
    "https://alschkahzfagtppxspfq.supabase.co/auth/v1/callback"     # this project, remote
  )
fi

probe () {
  local uri="$1" final reason
  final=$(curl -s -L -o /dev/null -w "%{url_effective}" \
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=${CID}&redirect_uri=${uri}&response_type=code&scope=email")
  case "$final" in
    */signin/oauth/error*)
      reason=$(printf '%s' "$final" \
        | sed -n 's/.*authError=\([^&]*\).*/\1/p' \
        | tr '_-' '/+' | base64 -d 2>/dev/null | tr -cd '[:print:]' \
        | sed -n 's/^[^a-z]*\([a-z_]\{4,\}\).*/\1/p')
      printf 'REJECTED  %-60s (%s)\n' "$uri" "${reason:-unknown}" ;;
    */signin/identifier*|*/signin/v2/*|*/signin/oauth/consent*)
      printf 'ACCEPTED  %-60s\n' "$uri" ;;
    *)
      printf 'UNKNOWN   %-60s -> %s\n' "$uri" "$final" ;;
  esac
}

echo "--- control (must say REJECTED, or ignore everything below) ---"
control_line=$(probe "$CONTROL")
echo "$control_line"
echo "--- the ones you asked about ---"
for u in "${URIS[@]}"; do probe "$u"; done

case "$control_line" in
  REJECTED*) exit 0 ;;
  *) echo; echo "The control was not rejected. This check is not working; do not trust it." >&2; exit 1 ;;
esac
