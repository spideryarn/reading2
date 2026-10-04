# shellcheck shell=bash
#
# One reader of an env file, for the shell checks. Sourced, not run:
#
#   . scripts/env-value.sh
#   URL=$(env_value .env.prod SUPABASE_URL)
#
# It replaces four copies of `grep "^X=" file | cut -d= -f2- | tr -d '"'` in
# scripts/check-remote-auth.sh and scripts/check-google-redirect.sh. That
# spelling was wrong three ways, all quiet (2026-10-03, X13d in
# docs/investigations/261003b-fifth-sweep-deploy-scripts-and-cross-zone-leads.md):
#
#   * `export X=…` and `X = …` do not start with `X=`, so the line is not found
#     and the caller reports the variable missing;
#   * single quotes stay on the value, so `X='https://…'` becomes a URL that
#     begins with a quote;
#   * `tr -d '"'` deletes every double quote, including one inside the value,
#     and two lines for one name come back as two lines.
#
# Both files are written by hand, so any of those spellings can turn up in one
# tomorrow. The rules here are the ones src/env.ts § parseEnvFile has, on
# purpose — the shell checks and the TypeScript ones read the same two files and
# should not disagree about what they say:
#
#   * a line starting with `#` is skipped;
#   * leading space and an `export ` prefix are allowed, and so is space either
#     side of the `=`;
#   * the value is trimmed, and ONE pair of matching quotes around the whole of
#     it is removed — `'…'` or `"…"`, nothing else, so `ab'` keeps its quote;
#   * a later line wins, as it does when a shell sources the file.
#
# tests/check-scripts-shell.test.ts runs this against parseEnvFile itself, one
# key per spelling, so the two cannot drift without that going red.
#
# A file that is missing or unreadable prints nothing and returns 0, as the
# pipeline it replaces did: every caller already treats an empty answer as
# "not set" and says so in its own words.
#
# Pure bash — no grep, sed or awk — so a key is compared as text and never
# interpreted as a pattern.

env_value() {
  local file="$1" key="$2" line rest value="" found=0
  [ -r "$file" ] || return 0
  # `|| [ -n "$line" ]` keeps a last line that has no newline after it.
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in
      '#'*) continue ;;
      export[[:space:]]*)
        line="${line#export}"
        line="${line#"${line%%[![:space:]]*}"}"
        ;;
    esac
    case "$line" in
      "$key"*) rest="${line#"$key"}" ;;
      *) continue ;;
    esac
    # What follows the name must be the `=`, give or take space. This is what
    # stops PREFIX matching a PREFIX_LONGER line.
    rest="${rest#"${rest%%[![:space:]]*}"}"
    case "$rest" in
      =*) value="${rest#=}" ;;
      *) continue ;;
    esac
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [ "${#value}" -ge 2 ]; then
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
      esac
    fi
    found=1
  done < "$file"
  [ "$found" -eq 1 ] && printf '%s\n' "$value"
  return 0
}
