#!/usr/bin/env bash
#
# Is the deployed site actually behind the auth gate?
#
#   ./scripts/check-production-gate.sh                    # both live hostnames
#   ./scripts/check-production-gate.sh https://some-host  # or name your own
#
# RUN THIS BEFORE THE GATE EXISTS TOO. It should fail, loudly, on the REFUSED
# lines — that is what tells you the check can fail at all. A checklist whose
# lines have only ever been seen to pass is not evidence of anything; see
# docs/reusable/silent-success.md and docs/plans/auth-ui-and-production.md.
#
# Every line asserts a status or a body. `curl -s host/api/library` printing a
# JSON blob tells you nothing: 200-with-a-shelf and 401-with-a-refusal look the
# same at a glance, which is how a fail-open ships.

set -uo pipefail
export LC_ALL=C

HOSTS=("$@")
if [ "${#HOSTS[@]}" -eq 0 ]; then
  HOSTS=(
    "https://spideryarn-greg-detre.vercel.app"
    "https://spideryarn-reading2-git-main-greg-detre.vercel.app"
  )
fi

fails=0
ok   () { printf '  \033[32mok  \033[0m %s\n' "$1"; }
bad  () { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }

# status_of METHOD URL [data]
status_of () {
  local m="$1" u="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X "$m" \
      -H 'content-type: application/json' -d "$d" "$u" || echo "000"
  else
    curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X "$m" "$u" || echo "000"
  fi
}

expect () {                       # expect <label> <wanted> <got>
  [ "$3" = "$2" ] && ok "$1 → $3" || bad "$1 → got $3, wanted $2"
}

for H in "${HOSTS[@]}"; do
  echo
  echo "=== $H ==="

  # The app still loads — and is not Vercel's "Deployment has failed" page,
  # which is also a 200 and is what the branch alias served on 2026-08-26.
  body=$(curl -s --max-time 20 "$H/" || true)
  code=$(status_of GET "$H/")
  if [ "$code" = "200" ] && ! grep -q "Deployment has failed" <<<"$body"; then
    ok "GET / → 200, and it is the app"
  else
    bad "GET / → $code $(grep -q 'Deployment has failed' <<<"$body" && echo '(deployment-failed page)')"
  fi

  # The two that matter. A stranger must not read the shelf or spend the key.
  expect "GET  /api/library  refused" 401 "$(status_of GET "$H/api/library")"
  expect "POST /api/jobs     refused" 401 \
    "$(status_of POST "$H/api/jobs" '{"url":"https://example.com"}')"

  # Health stays public, and stays honest: `ok` must be true, not merely present.
  hbody=$(curl -s --max-time 20 "$H/api/health" || true)
  if grep -q '"ok":true' <<<"$hbody"; then ok "GET /api/health → ok:true"
  else bad "GET /api/health → $(head -c 120 <<<"$hbody")"; fi

  # ...and stops reading unbounded bodies from strangers.
  expect "DELETE /api/health rejected" 405 "$(status_of DELETE "$H/api/health")"

  # No secret-shaped key in what was actually SERVED — not in the local dist/.
  # A legacy service-role key does not contain the string "service_role" in the
  # clear; it is inside the JWT payload, so decode anything JWT-shaped.
  echo "  scanning served JS for secret-shaped keys…"
  leaked=0
  for asset in $(grep -o '/assets/[A-Za-z0-9._-]*\.js' <<<"$body" | sort -u); do
    js=$(curl -s --max-time 30 "$H$asset" || true)
    grep -q "sb_secret_" <<<"$js" && leaked=1
    while read -r tok; do
      payload=$(cut -d. -f2 <<<"$tok" | tr '_-' '/+')
      case "$(base64 -d 2>/dev/null <<<"${payload}==" | tr -cd '[:print:]')" in
        *service_role*) leaked=1 ;;
      esac
    done < <(grep -oE 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}' <<<"$js" | sort -u)
  done
  [ "$leaked" = "0" ] && ok "no secret-shaped key in the served bundle" \
                       || bad "A SECRET-SHAPED KEY IS IN THE SERVED BUNDLE"
done

echo
if [ "$fails" -eq 0 ]; then echo "All checks passed."; exit 0; fi
echo "$fails check(s) failed."; exit 1
