#!/bin/sh
# Git credential helper: pick a GitHub token by repository owner.
#
# WHY THIS EXISTS, AND WHY NOT THE TWO OBVIOUS ALTERNATIVES.
#
# A GitHub fine-grained PAT has exactly one resource owner, so the box's repos --
# four under the `spideryarn` org and three under `gregdetre` -- cannot share one
# token. Something has to choose per repository.
#
# Not `GH_TOKEN` in a shell profile: `gjd-remote` starts each agent through a
# non-interactive ssh command, which sources neither .bashrc nor .bash_profile.
# An exported token works when a human tests it in a login shell and is absent
# inside every actual agent session -- a difference that would not show up until
# an unattended push failed at 3am.
#
# Not per-owner `credential.<url>.helper` config sections: they do match on a path
# prefix on git 2.50.0, but gitcredentials(5) says a path in the pattern "must
# match exactly", so that behaviour is undocumented and could change under a git
# upgrade. Worse, matching sections are tried in config-file order rather than
# most-specific-first, so a broader section added above a narrower one silently
# shadows it. This helper uses only the uncontested rule -- a host-only pattern
# always applies -- and does the owner routing itself, where it can be tested.
#
# Install (see infra/hetzner/README.md):
#   git config --global credential.useHttpPath true
#   git config --global credential.https://github.com.helper /usr/local/bin/github-owner-credential-helper.sh
#
# Tokens: one file per owner, named <owner>.token, mode 0600, in $GITHUB_OWNER_TOKEN_DIR
# (default /etc/github-tokens, mode 0700). Adding a repo under an owner that
# already has a token needs no change here at all -- add it to the token's
# repository list on github.com. Adding a new owner is one new file.
set -eu

# REFUSING MUST STOP GIT, NOT JUST STOP US.
#
# A helper that exits non-zero does not end the lookup: git moves on to the next
# configured helper, and then to prompting. Verified 2026-08-31 on git 2.50 -- a
# refused owner was answered by a broader helper configured after this one, which
# is exactly the bypass this file exists to prevent. Emitting `quit=1` is the
# documented way to end the chain (gitcredentials(5)), and it must be paired with
# exit 0, because git ignores the output of a helper that failed.
refuse() {
  echo "github-owner-credential-helper: $1" >&2
  echo "quit=1"
  exit 0
}

TOKEN_DIR="${GITHUB_OWNER_TOKEN_DIR:-/etc/github-tokens}"
ACTION="${1:-}"

# Drain stdin unconditionally and before branching. A helper that exits without
# reading leaves git writing into a closed pipe.
host=""
path=""
protocol=""
while IFS='=' read -r key value; do
  [ -z "$key" ] && continue
  case "$key" in
    host) host="$value" ;;
    path) path="$value" ;;
    protocol) protocol="$value" ;;
    *) ;;
  esac
done

case "$ACTION" in
  # This helper only reads. `store` and `erase` must still exit 0 -- git treats a
  # non-zero status as an error even though it ignores the output.
  store|erase) exit 0 ;;
  get) ;;
  *) refuse "unknown action '$ACTION'" ;;
esac

# Refuse anything but https, even though the git config registers this helper
# only for https://github.com. That registration is git protecting the helper;
# this is the helper protecting itself. Verified 2026-08-31 that without this a
# `protocol=http` request was answered with a real token -- which would put it on
# the wire in clear text -- and the only thing preventing that was a config line
# somewhere else that this file cannot see.
if [ "$protocol" != "https" ]; then
  refuse "refusing protocol '$protocol' -- https only"
fi

if [ "$host" != "github.com" ]; then
  refuse "refusing non-github.com host '$host'"
fi

# `path` arrives as `<owner>/<repo>.git`, and only when credential.useHttpPath is
# on. If it is off, git sends no path at all, owner is empty, and we refuse --
# which is the right answer, because guessing an owner would mean sending one
# repo's token to another repo's host.
# Require exactly `owner/repo` (optionally .git). A raw first segment accepts
# `gregdetre/../spideryarn/repo`, which picks the gregdetre token for a path that
# may normalise somewhere else entirely, and accepts a bare `owner` with no repo.
case "$path" in
  */*/*) refuse "path '$path' has more than owner/repo -- refusing to guess an owner" ;;
  */*)   : ;;
  *)     refuse "path '$path' is not owner/repo" ;;
esac
case "$path" in
  .*|*/.*|*..*) refuse "path '$path' contains a relative segment" ;;
esac

owner="${path%%/*}"
# GitHub treats owner names case-insensitively, but ext4 does not, so a remote
# URL written `SpiderYarn/x.git` would find no token and be refused for a reason
# that has nothing to do with permissions. Fold the case to match the file names.
# (This is invisible on a Mac, whose filesystem folds case for you -- so the
# behaviour differs between where this is tested and where it runs.)
owner=$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')
if [ -z "$owner" ]; then
  refuse "no owner in path '$path' -- is credential.useHttpPath set?"
fi

token_file="$TOKEN_DIR/$owner.token"
if [ ! -f "$token_file" ]; then
  refuse "no token for owner '$owner' (looked for $token_file)"
fi

token=$(tr -d '\n\r \t' < "$token_file")
if [ -z "$token" ]; then
  refuse "$token_file is empty"
fi

# GitHub validates the token, not the username, so any non-empty string works --
# but note that `x-access-token` is only *documented* for GitHub App installation
# tokens, not for fine-grained PATs. It is the conventional choice and is expected
# to work. If a real `git ls-remote` ever comes back 403 while the token itself is
# good, this line is the first thing to try changing (to the owner's GitHub
# username). The first real clone in bootstrap is what proves it either way.
echo "username=x-access-token"
echo "password=$token"
