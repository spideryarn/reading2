#!/usr/bin/env bash
set -euo pipefail

# Extracted from cloud-init.yaml on 2026-08-31 so it can be shellcheck'd, diffed,
# and re-run on a live box. It does NOT travel in cloud-init any more:
# `user_data` is capped at 32 KiB and this file alone is 67 KiB base64'd, so
# `gjd-remote provision` copies it up and runs it --
# docs/plans/260901d-split-provisioning-out-of-cloud-init-to-fit-the-user-data-cap.md.
# Nothing here is ever parsed by Terraform, so every ${...} below is bash's.
#
# The four values Terraform knows arrive in /etc/gjd-provision.env, written by
# cloud-init. Stamp the status file as INCOMPLETE before anything fallible runs.
#
# It used to be written only at the very end. A run that died in the middle
# therefore left the PREVIOUS run's `PROVISION OK` in place, and `gjd-remote
# doctor` read that as the current state -- a stale success, which is the one
# thing this file exists to make impossible. Now the only way to see
# PROVISION OK is for a run to reach the end and overwrite this.
#
# GJD_ATTEMPT is the caller's id for THIS run, and it is what makes the status
# file evidence rather than decoration. Without it the caller cannot tell a run
# that succeeded from one that never started and left the last run's verdict in
# place -- the same stale-success failure, moved one level out.
STATUS=/var/log/gjd-provision-status
ATTEMPT=${GJD_ATTEMPT:-none}
{
  echo "ran: $(date -Is)"
  echo "attempt: $ATTEMPT"
  echo "script-sha256: $(sha256sum "$0" 2>/dev/null | cut -d" " -f1)"
  echo "PROVISION INCOMPLETE (started, has not finished)"
} > "$STATUS" 2>/dev/null || true
chmod 0644 "$STATUS" 2>/dev/null || true

# The packages this script assumes somebody else installed. They come from
# cloud-init, which is baked into the machine at creation and never runs again --
# so a NEW copy of this script can meet an OLD box that was never given something
# it now needs. That reads as a confusing failure hundreds of lines down, in a
# step that has nothing to do with the missing tool.
#
# The rule this enforces: bootstrap dependencies are FIXED in cloud-init.
# Anything newly needed is installed by this script, or wants a rebuild.
missing=""
for c in rsync curl gpg jq git flock; do
  command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
done
if [ -n "$missing" ]; then
  echo "FATAL: cloud-init did not leave these behind:$missing" >&2
  echo "This box was created by an older cloud-init.yaml than this script expects." >&2
  echo "Install them by hand to carry on, or rebuild the box." >&2
  exit 1
fi

CONF=/etc/gjd-provision.env
if [ ! -r "$CONF" ]; then
  echo "FATAL: $CONF missing -- cloud-init should have written it before running me" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$CONF"
for v in GJD_USERNAME GJD_VOLUME_ID GJD_NODE_MAJOR GJD_SWAP_GB; do
  if [ -z "${!v:-}" ]; then echo "FATAL: $v unset in $CONF" >&2; exit 1; fi
done

USER_NAME=${GJD_USERNAME}
DEV=/dev/disk/by-id/scsi-0HC_Volume_${GJD_VOLUME_ID}

# Everything below is defended against the failure that actually happened
# on the first build: provisioning stopped at zero CPU and waited forever,
# so cloud-init never finished and never said why. A hang is worse than a
# failure, because a failure names its step.
#
# Three defences, applied to every step:
#   1. stdin is /dev/null, so anything that decides to prompt dies instead
#      of waiting for a human who will never come.
#   2. every step has a timeout, so a network stall or a lock ends the run
#      with a message rather than a silence.
#   3. apt is non-interactive and will wait a bounded time for the dpkg
#      lock instead of forever. unattended-upgrades is installed and
#      enabled by this same file, and it takes that lock on first boot.
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

# run <seconds> <description> <command...>
run() {
  local secs=$1 what=$2; shift 2
  echo "--- $what (timeout ${secs}s)"
  if ! timeout --kill-after=30 "$secs" "$@" </dev/null; then
    echo "FATAL: '$what' failed or timed out after ${secs}s" >&2
    return 1
  fi
}
apt_get() {
  apt-get -o DPkg::Lock::Timeout=600 -y "$@" </dev/null
}

# The apt timers fire on first boot and fight us for the dpkg lock. Stop
# them for the duration; they are re-enabled at the end.
systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true

echo "=== swap ==="
if [ ! -f /swapfile ]; then
  fallocate -l ${GJD_SWAP_GB}G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
  sysctl -w vm.swappiness=10
fi

echo "=== volume ==="
# The attachment is a separate Terraform resource applied AFTER the server
# boots, so the device genuinely may not be here yet. Wait generously, then
# fail loudly. Do NOT `exit 0` on absence: every runcmd entry is one shell
# script, so that aborted the whole provision while reporting success.
# There is deliberately no mkfs anywhere in this file — Terraform formats
# the volume once, at creation, so no boot can ever wipe the data.
for _ in $(seq 1 60); do [ -e "$DEV" ] && break; sleep 5; done
if [ ! -e "$DEV" ]; then
  echo "FATAL: $DEV never appeared after 300s" >&2
  exit 1
fi
mkdir -p /mnt/data
grep -q "$DEV" /etc/fstab || echo "$DEV /mnt/data ext4 discard,nofail,defaults 0 0" >> /etc/fstab
mountpoint -q /mnt/data || mount /mnt/data

echo "=== /home onto the volume ==="
if [ ! -d /mnt/data/home ]; then
  mkdir -p /mnt/data/home
  rsync -a /home/ /mnt/data/home/
elif [ /home/"$USER_NAME"/.ssh/authorized_keys -ef /mnt/data/home/"$USER_NAME"/.ssh/authorized_keys ]; then
  # Re-running provision.sh on an already-provisioned box: /home IS the
  # volume by now, so source and destination are literally the same file
  # and `install` refuses ("are the same file"), taking the whole run down
  # with it under set -e. There is nothing to copy in this case.
  echo "/home is already bound to the volume; key already in place"
else
  # Rebuild. The Terraform-managed key is the single source of truth, so
  # REPLACE rather than append: appending would leave a rotated-out key
  # valid forever. If you keep a second key by hand, it lives here and
  # this will remove it — that is the trade, and it is deliberate.
  install -d -m 700 -o "$USER_NAME" -g "$USER_NAME" /mnt/data/home/"$USER_NAME"/.ssh
  install -m 600 -o "$USER_NAME" -g "$USER_NAME" \
    /home/"$USER_NAME"/.ssh/authorized_keys \
    /mnt/data/home/"$USER_NAME"/.ssh/authorized_keys
fi
grep -q "/mnt/data/home /home" /etc/fstab || \
  echo "/mnt/data/home /home none bind,nofail,x-systemd.requires-mounts-for=/mnt/data 0 0" >> /etc/fstab
mountpoint -q /home || mount --bind /mnt/data/home /home

echo "=== node ==="
# The first build died here, and quietly: Ubuntu 24.04 already had its own
# nodejs 18 installed, so `apt-get install nodejs` reported "already the
# newest version" and did nothing. Ubuntu's nodejs package does not ship
# npm -- that is a separate package -- so the next line failed with
# "npm: command not found" and took the whole build with it.
#
# Two changes. The repo is added explicitly rather than by piping
# NodeSource's setup script into a shell, so a failure to add it is
# visible rather than inferred. And it is PINNED above the distro, so apt
# cannot prefer Ubuntu's older package just because it is already there.
run 60 "nodesource key" bash -o pipefail -c 'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg'
chmod 0644 /usr/share/keyrings/nodesource.gpg
echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${GJD_NODE_MAJOR}.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' \
  > /etc/apt/preferences.d/nodesource
# --error-on=any: a plain `apt-get update` tolerates a repository that
# failed to refresh, which is precisely how you end up installing the
# distro's package while believing you added a repo.
run 180 "apt update (nodesource)" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any -y update'

# Assert the CANDIDATE before installing, not just the result afterwards.
# The first build's failure was visible here and nowhere else: apt would
# have said Candidate: 18.19.1 while we believed we had asked for 26.
CAND=$(apt-cache policy nodejs | awk '/Candidate:/{print $2}')
case "$CAND" in
  ${GJD_NODE_MAJOR}.*) echo "nodejs candidate $CAND" ;;
  *) echo "FATAL: nodejs candidate is '$CAND', wanted ${GJD_NODE_MAJOR}.x - the NodeSource repo is not winning" >&2; exit 1 ;;
esac
run 300 "install nodejs" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install nodejs'

# Assert rather than assume. Both of these were true on the failed build:
# a nodejs existed, and it was the wrong one with no npm beside it.
NODE_V=$(node -v 2>/dev/null || echo none)
case "$NODE_V" in
  v${GJD_NODE_MAJOR}.*) echo "node $NODE_V" ;;
  *) echo "FATAL: wanted node v${GJD_NODE_MAJOR}.x, got $NODE_V - the NodeSource repo did not win" >&2; exit 1 ;;
esac
command -v npm >/dev/null || { echo "FATAL: node installed but npm is missing" >&2; exit 1; }

run 300 "install claude code" npm install -g @anthropic-ai/claude-code
command -v claude >/dev/null || { echo "FATAL: npm reported success but claude is not on PATH" >&2; exit 1; }

echo "=== codex cli ==="
# OpenAI's agent CLI, so scripts/run-codex.ts works here as it does on the
# laptop — the cross-family review docs/reusable/codex-cli-as-subagent.md makes
# a standing rule. Unpinned, like claude-code above and unlike the two MCP
# servers below: the wrapper passes model, effort, sandbox and approval policy
# on every invocation, so a floating version steers nothing.
#
# @openai/codex ships a prebuilt platform binary rather than JS, so it is the
# one npm global here that can install "successfully" with nothing runnable for
# this architecture. Hence running it rather than looking for the file.
run 300 "install codex cli" npm install -g @openai/codex
CODEX_V=$(timeout 60 codex --version 2>/dev/null || echo none)
case "$CODEX_V" in
  codex-cli\ *) echo "$CODEX_V" ;;
  *) echo "FATAL: npm reported success but 'codex --version' printed '$CODEX_V'" >&2; exit 1 ;;
esac
# No ~/.codex/config.toml is written on purpose: run-codex.ts passes
# -c approval_policy=never itself precisely BECAUSE a local config file
# silently overrides codex's safe default (the approval-policy trap in that
# doc). A config here would be a second source of truth for what the wrapper
# already owns. Auth is a human step, like claude's /login — see
# infra/hetzner/README.md.

echo "=== chrome ==="
# chrome-devtools-mcp needs real Chrome stable, not Playwright's Chromium.
# amd64 only: this block is wrong on an ARM (CAX) server.
run 60 "chrome signing key" bash -o pipefail -c 'curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg'
chmod 0644 /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
  > /etc/apt/sources.list.d/google-chrome.list
run 180 "apt update" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any -y update'
run 300 "install chrome" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install google-chrome-stable'

echo "=== playwright ==="
# The SYSTEM PACKAGES a browser needs -- shared libraries, and also Playwright's
# `tools` group, which is fonts and Xvfb. Not "libraries and nothing else": that
# wording was wrong, and Xvfb in particular is what start-vnc depends on.
#
# There is one browser on this box and it is the google-chrome-stable installed
# above: @playwright/mcp is given --browser chrome below, chrome-devtools-mcp
# wants real Chrome by design, and scripts/remote-smoke-browser.mjs names
# /usr/bin/google-chrome-stable in executablePath.
#
# `playwright install chromium` used to run here and was removed on 2026-08-31.
# It downloaded 651MB into ~/.cache/ms-playwright and NOTHING ever launched it:
# during a live MCP navigation, /proc/<pid>/exe read /opt/google/chrome/chrome.
# It was also unpinned, so the browser build number floated with the date of the
# provisioning run while the docs named a fixed one.
#
# Measured before removing, not assumed: with PLAYWRIGHT_BROWSERS_PATH pointed
# at an empty directory, `--browser chrome` navigated to a real page, and the
# control -- the same probe forced onto the bundled chromium -- failed with
# "expected executable at /tmp/pw-empty/chromium-1237/...", which is what proves
# the empty cache was genuinely in effect rather than the variable ignored.
#
# If you ever do need Playwright's own chromium here, fetch it on demand with
# the VERSION-MATCHED CLI -- `npx playwright@1.62.1 install chromium`, matching
# whatever client you are about to run. A bare `npx playwright install` pulls
# @latest and downloads the revision *that* wants, which is how the 1234/1237
# mismatch above happened in the first place.
run 420 "playwright system deps" npx --yes playwright@latest install-deps chromium

# A pinned playwright-core FOR THE AGENT USER, with no browsers attached.
#
# Removing `install chromium` above took something with it that was never its
# job: that command ran as $USER_NAME, so it incidentally left a playwright-core
# in ~/.npm/_npx, and scripts/remote-smoke-browser.mjs had been borrowing it.
# `install-deps` runs as root, so it seeds root's cache and not the user's, and
# `claude mcp add` only records a command -- it installs nothing. On a genuinely
# clean /home with no checkout yet, the smoke test would therefore have failed
# at playwright-resolve. A rebuild would NOT have shown this, because /home is
# the volume and both caches survive it; only a new volume would. Found by GPT
# Sol reviewing the removal, not by any check we run.
#
# Global, so it does not depend on a repo being cloned. THIS LINE is the fix,
# not the /usr/lib entry added to the smoke test's search list beside it: with
# this package removed and HOME pointed at an empty directory, the smoke test
# fails at playwright-resolve with or without that entry, and passes with or
# without it once this is installed. Node finds a global package on its own.
#
# playwright-core, not playwright: the client only, no browser download, which
# is the whole point on a box that drives system Chrome.
#
# Pinned, and it should match the playwright-core in this repo's package.json --
# they are separate copies for separate consumers (this one so the BOX can be
# checked with no checkout; that one so REPO scripts resolve), and letting them
# drift means the smoke test stops testing the version repo scripts get.
run 300 "playwright-core (client only, no browsers)" npm install -g playwright-core@1.62.1

echo "=== docker ==="
# Docker's OWN apt repo, deliberately:
#   - not Ubuntu's docker.io, which lags upstream and gets security updates
#     later;
#   - not Podman, because the Supabase CLI shells out to the `docker` CLI and
#     is not tested against Podman's compatibility layer.
#
# Docker's data-root is DELIBERATELY left on the ephemeral root disk. With
# Supabase CLI 2.115.0 the Postgres data directory and the storage objects are
# bind-mounted out of ~/.local/state/supabase/managed/, which is already on the
# persistent /home volume — so all that lives under /var/lib/docker is
# replaceable image layers, a few minutes' re-pull after a rebuild. Moving
# data-root onto the volume would spend pet-volume space to save that, and on
# Docker 29+ can still leave snapshots under /var/lib/containerd anyway. Please
# do not "improve" this.
run 60 "docker signing key" bash -o pipefail -c 'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /usr/share/keyrings/docker.gpg'
chmod 0644 /usr/share/keyrings/docker.gpg
DEB_ARCH=$(dpkg --print-architecture)
# shellcheck source=/dev/null
UBUNTU_CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")
echo "deb [arch=${DEB_ARCH} signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
run 180 "apt update (docker)" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any -y update'

# Assert the CANDIDATE'S ORIGIN before installing, exactly as the node step
# does above, and for the same reason: this repo has already been bitten once
# by apt reporting success while installing a different package entirely
# (novnc had pulled in Ubuntu's nodejs, and `apt-get install nodejs` said
# "already the newest version" and exited 0). Ubuntu ships its own docker.io /
# docker-compose, so "docker is installed" is not evidence of anything.
#
# `apt-cache policy` prints the candidate version and then a table in which
# each version row is followed by the repository line that offers it.
DOCKER_POLICY=$(apt-cache policy docker-ce)
DOCKER_CAND=$(printf '%s\n' "$DOCKER_POLICY" | awk '/^ *Candidate:/{print $2}')
DOCKER_SRC=$(printf '%s\n' "$DOCKER_POLICY" | awk -v v="$DOCKER_CAND" '
  $1 == v || ($1 == "***" && $2 == v) { hit = 1; next }
  hit { print $2; exit }')
case "$DOCKER_SRC" in
  https://download.docker.com/*) echo "docker-ce candidate $DOCKER_CAND from $DOCKER_SRC" ;;
  *) echo "FATAL: docker-ce candidate is '$DOCKER_CAND' from '$DOCKER_SRC', wanted one from download.docker.com - Docker's repo is not winning" >&2; exit 1 ;;
esac
run 600 "install docker" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
systemctl enable --now docker

# Membership in `docker` is root-equivalent. On this box that costs nothing
# extra — the one account already has passwordless sudo, Greg's recorded
# decision in infra/hetzner/README.md — but it is named here rather than
# inherited silently. usermod -aG is idempotent.
usermod -aG docker "$USER_NAME"

# Pull the image now, as a named step with a timeout, so a Docker Hub stall
# fails here with a message instead of inside the verify block. The verify
# check then runs it AS $USER_NAME, which is what proves the group membership
# actually works rather than that the group merely exists. `su -` starts a
# fresh login session, so it picks up the group that usermod just added — an
# already-open shell would not, which is the trap this avoids.
run 180 "docker pull hello-world" docker pull hello-world

echo "=== supabase cli ==="
# Pinned to the version this repo is built against (docs/project/database.md,
# docs/project/supabase-local.md). There is no apt repository for it; the .deb
# from GitHub Releases is upstream's supported route on Debian/Ubuntu.
SUPABASE_VERSION=2.115.0
if [ "$(supabase --version 2>/dev/null || true)" != "$SUPABASE_VERSION" ]; then
  SUPABASE_DEB=/tmp/supabase_${SUPABASE_VERSION}_linux_${DEB_ARCH}.deb
  run 180 "download supabase cli" curl -fsSL --retry 3 -o "$SUPABASE_DEB" \
    "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/supabase_${SUPABASE_VERSION}_linux_${DEB_ARCH}.deb"
  run 120 "install supabase cli" dpkg -i "$SUPABASE_DEB"
  rm -f "$SUPABASE_DEB"
fi
# Assert the version rather than assuming the .deb contained what its filename
# said. An unpinned CLI is a different local stack from the laptop's.
SUPA_V=$(supabase --version 2>/dev/null || echo none)
if [ "$SUPA_V" != "$SUPABASE_VERSION" ]; then
  echo "FATAL: supabase is '$SUPA_V', wanted exactly $SUPABASE_VERSION" >&2
  exit 1
fi
echo "supabase $SUPA_V"

echo "=== git ==="
# Identity, so commits from the box are attributed like commits from the laptop.
run 30 "git identity" su - "$GJD_USERNAME" -c '
  git config --global user.name  "Greg Detre"
  git config --global user.email "greg@gregdetre.com"
  git config --global init.defaultBranch main
'
# Credential routing. useHttpPath is what makes git send the repo path to the
# helper at all -- without it the helper gets only the hostname, cannot tell
# which owner is being asked for, and correctly refuses rather than guessing.
run 30 "git credential helper" su - "$GJD_USERNAME" -c '
  git config --global credential.useHttpPath true
  git config --global credential."https://github.com".helper /usr/local/bin/github-owner-credential-helper.sh
'
# The token directory, owned by the agent user so rotating a token needs no sudo.
# Empty is the correct state after provisioning: the tokens are a human step.
install -d -m 0700 -o "$GJD_USERNAME" -g "$GJD_USERNAME" /etc/github-tokens

echo "=== apparmor ==="
systemctl reload apparmor || true

echo "=== tmux ==="
# tmux is here to keep a session alive when its client dies, and for nothing
# else. Every key binding is removed and there is no prefix, so Ctrl-B -- and
# every other keystroke -- reaches Claude Code untouched.
#
#   I pretty much only want it to keep my sessions alive, and it keeps trapping
#   keyboard shortcuts that I'm used to using in weird, confusing ways.
#
#   -- Greg, 2026-08-31
#
# Measured on this box's own tmux 3.4, typing Ctrl-B H E L L O into `cat -v`
# through a real pty: stock tmux delivers "ELLO", because the prefix eats
# Ctrl-B AND the key after it, and this config delivers "^BHELLO".
#
# A MANAGED BLOCK, rewritten on every run, with anything outside the markers
# left alone. The shape this replaces -- write the whole file only when it is
# absent, then append each later setting behind its own `grep -q` -- meant a
# line added to the `cat >` never reached a box that had ever been provisioned,
# which is every box; and one grep per setting does not scale to nine of them.
TMUX_CONF=/home/"$USER_NAME"/.tmux.conf
touch "$TMUX_CONF"

# Drop the previous copy of the block, and -- once, for boxes provisioned before
# the block existed -- the four bare lines it used to write. Matched exact and
# whole-line, so a hand-edited variant of one survives into the file above the
# block, where whoever wrote it can see that the block below now overrides it.
sed -i '/^# >>> managed by provision.sh/,/^# <<< managed by provision.sh/d' "$TMUX_CONF"
# grep exits 1 when it selects nothing, which here means "the file was only ever
# the managed block" and is fine; 2 is a real error and must not be swallowed,
# because `mv` would then install a truncated config.
set +e
grep -vxF -e 'set -g allow-passthrough on' \
          -e 'set -s extended-keys on' \
          -e "set -as terminal-features 'xterm*:extkeys'" \
          -e 'set -sg escape-time 10' \
          "$TMUX_CONF" > "$TMUX_CONF.provision.$$"
TMUX_GREP=$?
set -e
[ "$TMUX_GREP" -le 1 ] || { echo "could not filter $TMUX_CONF (grep exit $TMUX_GREP)" >&2; exit 1; }
mv "$TMUX_CONF.provision.$$" "$TMUX_CONF"

cat >> "$TMUX_CONF" <<'TMUX'
# >>> managed by provision.sh -- anything between these markers is overwritten

# No prefix and no bindings: every keystroke belongs to whatever runs inside.
set -g prefix None
set -g prefix2 None

# `unbind -a` with no -T clears the PREFIX table only -- it takes the same
# default as bind-key does -- so all four tables have to be named. Four is the
# whole set on a stock tmux. A plugin can add its own, and `tmux list-keys` with
# no -T is how you would find out.
unbind -a -T prefix
unbind -a -T root
unbind -a -T copy-mode
unbind -a -T copy-mode-vi

# The root table is entirely mouse events, so `mouse off` is what actually stops
# a scroll or a click reaching tmux. It is also the default; set it anyway,
# because it is the behaviour being asked for rather than one we inherited.
set -g mouse off

# The green bar was only ever telling you the session name, and the iTerm tab
# title already says it -- gjd-remote turns set-titles on at attach.
set -g status off

# To detach with nothing bound: close the tab, or run
#   tmux detach-client -s NAME
# from any other shell on the box. If you would rather have a key for it, one
# line does it, and F12 is the safe choice because no TUI here sends it:
#   bind -n F12 detach-client

# The rest are not key bindings, and all three are still wanted.

# Or Claude Code's progress bar and its desktop notifications never escape tmux.
set -g allow-passthrough on

# Or Shift+Enter submits instead of inserting a newline. `on` forwards extended
# keys only to an app that asked for them; `always` would push them at one that
# did not, which is how keys start arriving as gibberish.
set -s extended-keys on
set -as terminal-features 'xterm*:extkeys'

# tmux waits escape-time milliseconds after a bare Escape to see whether more
# bytes follow, because Alt+key arrives as ESC+key. tmux 3.4 defaults to 500ms;
# 3.5 cut it to 10ms for exactly this reason. Claude Code uses Escape constantly
# -- interrupt, clear the box, leave a mode -- so 500ms is half a second of dead
# air on the key you press most. 10 rather than 0: at 0 tmux cannot separate
# Alt+key from Escape-then-key at all.
set -sg escape-time 10
# <<< managed by provision.sh
TMUX
chown "$USER_NAME":"$USER_NAME" "$TMUX_CONF"
chmod 0644 "$TMUX_CONF"

# Writing the file is not changing the keyboard. A tmux server reads its config
# ONCE, when it starts, and this box's server outlives provisioning by weeks
# with every session in it -- so re-provisioning a live box would leave the file
# saying one thing and Ctrl-B still being eaten, with this script's own check
# green because it counts a fresh server rather than the running one.
#
# The pane_in_mode guard is not politeness. Sourcing this into a server while a
# pane is IN copy-mode unbinds copy-mode out from under it, and with no prefix
# left to press there is no key that gets that pane back to its shell. Skip and
# say so; the next provision, or one command by hand, picks it up.
cat > /tmp/provision-tmux-reload.sh <<'RELOAD'
set -u
tmux ls >/dev/null 2>&1 || { echo "no tmux server running; the file is enough"; exit 0; }
inmode=$(tmux list-panes -a -F '#{pane_in_mode}' 2>/dev/null | grep -c '^1$')
if [ "$inmode" != 0 ]; then
  echo "WARNING: $inmode pane(s) in copy-mode -- leaving the running server alone."
  echo "         once they are out:  tmux source-file ~/.tmux.conf"
  exit 0
fi
before=$(tmux list-keys 2>/dev/null | grep -c bind-key)
tmux source-file "$HOME/.tmux.conf" || { echo "source-file failed" >&2; exit 1; }
after=$(tmux list-keys 2>/dev/null | grep -c bind-key)
echo "running tmux server reloaded: $before bindings -> $after"
RELOAD
chmod 0644 /tmp/provision-tmux-reload.sh
# NOT fatal, unlike every other `run` in this file, and the asymmetry is the
# point: the durable artefact is the file, and it is already written. Aborting a
# whole provisioning run -- leaving the box half-built -- because one live tmux
# server would not take a reload trades a large failure for a small one.
#
# That leaves the failure uncaught here, because the "tmux binds nothing" check
# below counts a FRESH server started from the file and so cannot see a running
# one that ignored it. `gjd-remote doctor` is what covers it: its `tmux keys`
# check counts both, and it runs daily where this runs almost never.
run 60 "reload running tmux" su - "$USER_NAME" -c "bash /tmp/provision-tmux-reload.sh" \
  || echo "WARNING: could not reload the running tmux server; the file is correct. Check: gjd-remote doctor"
rm -f /tmp/provision-tmux-reload.sh

echo "=== claude settings ==="
# One line per mouse-wheel notch, instead of the three Claude Code picks by
# default on this terminal stack. Three overshoots badly when you are scrolling
# back through a long transcript looking for one line.
#
# The knob is CLAUDE_CODE_SCROLL_SPEED, read from the `env` block of
# ~/.claude/settings.json. That is the same file and the same key that the TUI's
# own /config -> "Scroll speed" control writes, so the two agree instead of
# fighting: turning the dial in the TUI later just overwrites this value.
#
# MERGED with jq, never written whole. On a rebuild the volume already carries
# this file with theme, tui and notification preferences in it, and a `cat >`
# here would silently throw all of them away. Merging is also what makes the
# step idempotent, which re-running provision.sh on a live box depends on.
# jq exits non-zero on a settings.json that is not valid JSON, and the `mv`
# never happens, so a broken file fails the step rather than being replaced.
# The status line under the prompt: model, directory, git branch, and -- the
# reason this is here -- how much of the context window is gone, as a ten-cell
# bar that turns yellow at 70% and red at 90%. Auto-compaction lands around 80%,
# so the bar is the warning that a long session is about to lose its middle.
# Same script Greg runs on the laptop, so the two boxes read alike.
#
# It lives HERE, in provision.sh, rather than in its own file injected through
# cloud-init like the credential helper. That is deliberate: provision.sh is the
# thing you re-run on a live box, and a second copy in cloud-init.yaml would be
# the copy that goes stale. tests/statusline.test.ts extracts this heredoc and
# runs it, so it is covered even though it is not a standalone file.
#
# `context_window.used_percentage` is computed by Claude Code and arrives on
# stdin. Older CLIs do not send it, and neither does a session before its first
# API call -- in both the segment is simply omitted rather than showing a wrong
# zero.
CLAUDE_STATUSLINE_SH=$(mktemp)
cat > "$CLAUDE_STATUSLINE_SH" <<'STATUSLINE'
#!/bin/bash

# Read JSON input from Claude Code
input=$(cat)

# Extract data from JSON input - use default model display behavior
model=""
if command -v jq >/dev/null 2>&1; then
    # Use display_name if available, otherwise fall back to id
    model_display=$(echo "$input" | jq -r '.model.display_name // empty' 2>/dev/null)

    if [ -n "$model_display" ] && [ "$model_display" != "null" ]; then
        model="$model_display"
    else
        # Fallback to model ID if display name is not available
        model_id=$(echo "$input" | jq -r '.model.id // empty' 2>/dev/null)
        if [ -n "$model_id" ] && [ "$model_id" != "null" ]; then
            model="$model_id"
        else
            model="Claude"
        fi
    fi
else
    # Fallback if jq is not available
    model="Claude"
fi

# Extract current directory from JSON
cwd=$(echo "$input" | jq -r '.workspace.current_dir // ""' 2>/dev/null || echo "$(pwd)")

# Get the last 2 directory levels to match %2~ from PS1
if [ -n "$cwd" ]; then
    # Convert full path to last 2 levels like zsh %2~
    if [ "$cwd" = "$HOME" ]; then
        dir_display="~"
    elif [[ "$cwd" == "$HOME"/* ]]; then
        # Replace home with ~ and get last 2 levels
        relative_path="${cwd#$HOME/}"
        IFS='/' read -ra PATH_PARTS <<< "$relative_path"
        num_parts=${#PATH_PARTS[@]}
        if [ $num_parts -le 1 ]; then
            dir_display="~/$relative_path"
        else
            # Take last 2 parts without ~ prefix for deeper paths
            second_last_idx=$((num_parts - 2))
            last_idx=$((num_parts - 1))
            dir_display="${PATH_PARTS[$second_last_idx]}/${PATH_PARTS[$last_idx]}"
        fi
    else
        # Not in home directory, get last 2 levels
        IFS='/' read -ra PATH_PARTS <<< "$cwd"
        num_parts=${#PATH_PARTS[@]}
        if [ $num_parts -le 2 ]; then
            dir_display="$cwd"
        else
            # Take last 2 parts
            second_last_idx=$((num_parts - 2))
            last_idx=$((num_parts - 1))
            dir_display="${PATH_PARTS[$second_last_idx]}/${PATH_PARTS[$last_idx]}"
        fi
    fi
else
    dir_display="$(basename "$(pwd)")"
fi

# Get git information (similar to git_prompt_info)
git_info=""
worktree_info=""
if git rev-parse --git-dir >/dev/null 2>&1; then
    branch=$(git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --short HEAD 2>/dev/null)
    if [ -n "$branch" ]; then
        # Check for uncommitted changes
        if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
            git_info="($branch*)"
        else
            git_info="($branch)"
        fi
    fi
    # Show the worktree name when we're in a linked worktree (not the main checkout).
    # A linked worktree has --git-dir != --git-common-dir; the toplevel basename is
    # the worktree name.
    git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null)
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    if [ -n "$git_dir" ] && [ -n "$common_dir" ] && [ "$git_dir" != "$common_dir" ]; then
        toplevel=$(git rev-parse --show-toplevel 2>/dev/null)
        [ -n "$toplevel" ] && worktree_info="⑂ $(basename "$toplevel")"
    fi
fi

# Get context window usage (% of context used) and render a threshold-colored bar.
# context_window.used_percentage is pre-computed by Claude Code (0-100, input tokens only).
# Absent on older CLI versions / before the first API call -> the segment is simply omitted.
context_info=""
if command -v jq >/dev/null 2>&1; then
    ctx_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)
    if [ -n "$ctx_pct" ] && [ "$ctx_pct" != "null" ]; then
        # Truncate to an integer and harden against non-numeric values
        pct=${ctx_pct%.*}
        case "$pct" in ''|*[!0-9]*) pct=0 ;; esac
        [ "$pct" -gt 100 ] && pct=100
        # Threshold colors aligned with auto-compaction (~80%):
        #   green <70  |  yellow 70-89 (heads-up)  |  red 90+ (compaction imminent)
        if [ "$pct" -ge 90 ]; then ctx_color='\033[1;31m'
        elif [ "$pct" -ge 70 ]; then ctx_color='\033[1;33m'
        else ctx_color='\033[1;32m'; fi
        # Build a 10-char bar: filled (█) + empty (░)
        filled=$((pct / 10))
        [ "$filled" -gt 10 ] && filled=10
        empty=$((10 - filled))
        bar=""
        [ "$filled" -gt 0 ] && printf -v fill "%${filled}s" && bar="${fill// /█}"
        [ "$empty" -gt 0 ] && printf -v pad "%${empty}s" && bar="${bar}${pad// /░}"
        context_info=$(printf " \033[2m·\033[0m ${ctx_color}%s %s%%\033[0m" "$bar" "$pct")
    fi
fi

# Create status line matching PS1 format but with model + context info
# Format: [Model] directory git_info · <context bar> NN%
# Use printf with ANSI colors (will be dimmed by terminal)
line=$(printf "\033[1;32m[%s]\033[0m \033[1;32m%s\033[0m" "$model" "$dir_display")
[ -n "$git_info" ] && line="$line $git_info"
[ -n "$worktree_info" ] && line="$line $(printf "\033[1;36m%s\033[0m" "$worktree_info")"
[ -n "$context_info" ] && line="$line$context_info"
printf "%s" "$line"
STATUSLINE

# MERGED with jq, never written whole. On a rebuild the volume already carries
# this file with theme, tui and notification preferences in it, and a `cat >`
# here would silently throw all of them away. Merging is also what makes the
# step idempotent, which re-running provision.sh on a live box depends on.
# jq exits non-zero on a settings.json that is not valid JSON, and the `mv`
# never happens, so a broken file fails the step rather than being replaced.
CLAUDE_SETTINGS_SH=$(mktemp)
cat > "$CLAUDE_SETTINGS_SH" <<'SETTINGS'
set -eu
f="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$f")"
[ -f "$f" ] || printf '{}\n' > "$f"
# $1 is the status line script, handed over as an argument because this script
# runs as the user and that one was written by root. `install` sets the mode in
# the same step, so there is no window where the file exists and will not run.
sl="$HOME/.claude/statusline-script.sh"
install -m 0755 "$1" "$sl"
tmp="$f.provision.$$"
# Without this, a settings.json that will not parse leaves its half-written
# temp file beside it -- one more on every re-run, all of them looking like
# a settings file to whoever finds them next.
trap 'rm -f "$tmp"' EXIT
# An ABSOLUTE path, resolved here from $HOME, rather than the "~/..." the docs
# use. Claude Code runs the command through a shell, so a tilde would expand
# too -- but it would expand in whatever shell and whatever HOME that process
# gets, and a path that does not resolve fails by printing NOTHING, which looks
# exactly like a status line that is working and has nothing to say.
# `+` onto whatever is already there, not `=`. `statusLine` also carries
# padding, refreshInterval and hideVimModeIndicator, which are Greg's to set and
# not ours to delete on the next provisioning run. We own two keys of it.
jq --arg sl "$sl" '
  .env.CLAUDE_CODE_SCROLL_SPEED = "1"
  | .statusLine = ((.statusLine // {}) + { type: "command", command: $sl })
' "$f" > "$tmp"
mv "$tmp" "$f"
SETTINGS
# 0644: the scripts are written by root in /tmp and read by $USER_NAME's shell.
chmod 0644 "$CLAUDE_SETTINGS_SH" "$CLAUDE_STATUSLINE_SH"
run 30 "claude settings" su - "$USER_NAME" -c "bash $CLAUDE_SETTINGS_SH $CLAUDE_STATUSLINE_SH"
rm -f "$CLAUDE_SETTINGS_SH" "$CLAUDE_STATUSLINE_SH"

echo "=== mcp servers ==="
# Pin at provision time rather than resolving @latest on every session
# launch: that is a supply-chain surface and makes two sessions able to run
# different code. Re-provision to move them.
PW_MCP=$(npm view @playwright/mcp version)
CDT_MCP=$(npm view chrome-devtools-mcp version)
echo "pinning @playwright/mcp@$PW_MCP and chrome-devtools-mcp@$CDT_MCP"

# --scope user, or they register against /home as a "project" and vanish
# the moment you cd into a repository.
# --isolated, because one persistent profile supports exactly one browser
# process and the whole point of this box is parallel sessions.
# --env caps each MCP server's heap: N sessions x M servers spawns node
# processes with no memory cap each, which is the documented way this box
# dies (anthropics/claude-code#45880, closed "not planned").
# The docs warn the server NAME must not directly follow --env or the CLI
# reads it as another KEY=value pair, hence --scope sitting between them.
CAP="NODE_OPTIONS=--max-old-space-size=512"
# No uncapped fallback. The previous version retried without the cap on
# ANY failure, which could quietly remove the exact OOM protection this
# exists for while the verification below still passed.
#
# `remove` first, ignoring "not found": on a REBUILD the user-scoped
# registrations are already on the volume, and `add` refuses a duplicate
# name -- so the second rebuild would die here.
add_mcp() {
  name=$1; shift
  timeout 60 su - "$USER_NAME" -c "claude mcp remove --scope user $name </dev/null" </dev/null 2>/dev/null || true
  timeout 60 su - "$USER_NAME" -c "claude mcp add --env '$CAP' --scope user $name -- $* </dev/null" </dev/null
}
# --browser chrome, explicitly: use the system google-chrome-stable rather than
# Playwright's own chromium download, which this box deliberately does not have.
# It is the current default too, but a default is not a decision -- leaving it
# implicit means a future pin of @playwright/mcp could move it and take the
# browser away with no line of ours changing.
# --executable-path as well as --browser: the channel flag still asks Playwright's
# channel registry to go and FIND Chrome, and naming the binary removes that
# lookup. Both together were measured working on 0.0.79, with
# PLAYWRIGHT_BROWSERS_PATH pointed at an empty directory.
add_mcp playwright "npx -y @playwright/mcp@$PW_MCP --headless --isolated --browser chrome --executable-path /usr/bin/google-chrome-stable"
add_mcp chrome-devtools "npx -y chrome-devtools-mcp@$CDT_MCP --headless"

echo "=== gjd-remote loopback key ==="
# gjd-remote is written to run FROM the laptop, and resolves the box's address
# out of Terraform state. An agent working ON the box has neither: no `tofu`,
# and no private key -- ~/.ssh holds authorized_keys and nothing else. So every
# gjd-remote command from inside a session died at
# "Permission denied (publickey)", and the tool that manages the sessions was
# the one tool a session could not use.
#
# A keypair that only reaches this same machine fixes it and grants nothing:
# anyone who can read the private key already has a shell here, which is all
# the key can get them. It is NOT a route to anywhere else -- the box still has
# no key to GitHub or to the laptop.
#
# All three steps are idempotent, because this file is re-run on live boxes.
run 30 "gjd-remote loopback key" su - "$GJD_USERNAME" -c '
  set -eu
  install -d -m 0700 ~/.ssh
  # No passphrase: gjd-remote uses BatchMode=yes for every non-interactive
  # call, which turns a passphrase prompt into a failure rather than a prompt.
  test -f ~/.ssh/id_ed25519_loopback ||
    ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519_loopback -C "gjd-remote loopback (box to itself)"
  # grep the KEY FIELD, not the whole line: the comment differs between a key
  # made here and one restored with the volume, and matching the whole line
  # would append a second copy on every re-run.
  key=$(cut -d" " -f2 < ~/.ssh/id_ed25519_loopback.pub)
  touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
  grep -qF "$key" ~/.ssh/authorized_keys || cat ~/.ssh/id_ed25519_loopback.pub >> ~/.ssh/authorized_keys
'
# ssh does not offer a non-default key name on its own, and gjd-remote passes
# no -i and no `-F none`, so ~/.ssh/config is both honoured and the only place
# this can be said.
#
# Appended behind a marker, never written whole. /home is the persistent volume,
# so a config Greg adds by hand outlives the server that provisioning rebuilds --
# and `cat >` would eat it on the next re-run, at the one moment nobody is
# looking. The marker is what keeps the append idempotent.
run 30 "gjd-remote loopback ssh config" su - "$GJD_USERNAME" -c '
  set -eu
  install -d -m 0700 ~/.ssh
  touch ~/.ssh/config && chmod 600 ~/.ssh/config
  grep -qF "gjd-remote-loopback" ~/.ssh/config || cat >> ~/.ssh/config <<EOF

# gjd-remote-loopback -- written by provision.sh, see docs/project/remote-box.md.
# Lets a Claude session running ON the box drive gjd-remote against the box
# itself. Reaches nowhere else. Delete this block and the key to undo it.
Host 127.0.0.1 localhost
  User $USER
  IdentityFile ~/.ssh/id_ed25519_loopback
  IdentitiesOnly yes
EOF
'
# ...and the address, so `gjd-remote ls` on the box needs no argument and no
# Terraform. Only ever set on the box: on the laptop the variable stays unset
# and the address still comes out of Terraform state, which is what makes it
# survive a rebuild. A login shell is enough -- tmux sessions get one
# (`exec bash -l` at the end of every job script).
cat > /etc/profile.d/gjd-remote-loopback.sh <<'EOF'
# Written by provision.sh. gjd-remote run ON the box talks to the box.
export GJD_REMOTE_HOST=127.0.0.1
EOF
chmod 0644 /etc/profile.d/gjd-remote-loopback.sh

echo "=== ssh ==="
systemctl start apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
# `sshd -t` refuses to validate without its privilege separation directory,
# which systemd creates as a RuntimeDirectory when ssh.service starts. This
# early in boot it may not exist yet, and the failure -- "Missing privilege
# separation directory: /run/sshd" -- reads as a broken sshd config rather
# than a missing directory.
mkdir -p /run/sshd
sshd -t
systemctl enable --now fail2ban
systemctl restart ssh || systemctl restart sshd

echo "=== verify ==="
# Again, and not redundantly: /run/sshd is a systemd RuntimeDirectory, so
# stopping ssh.service DELETES it -- and we restarted ssh two lines ago.
# Without this, `sshd -T` fails, both sshd assertions below report FAIL,
# and they do so on a box whose config is perfectly correct. That is
# exactly what happened: the config was right and the check was wrong.
mkdir -p /run/sshd

# Every one of these has a way of silently not happening.
#
# The subshell turns pipefail OFF for the duration of a check, and that is
# load-bearing rather than tidiness. Nearly every check below is "run something,
# grep its output". `grep -q` exits the instant it matches, which closes the pipe
# under a producer that is still writing, which kills the producer with SIGPIPE
# (141). With pipefail on, the pipeline then reports failure even though the grep
# matched -- so the check says FAIL about a machine that is correctly configured.
#
# It bit exactly the two sshd checks: `sshd -T` prints 95 lines and the match is
# on line 30, so it was always still writing when grep left. The checks whose
# producers print a handful of lines passed only because the producer happened to
# finish first -- luck, not correctness, and it would have turned into a mystery
# the first time one of those commands got chattier.
fail=0
REPORT=""
say() { echo "$1"; REPORT="$REPORT$1\n"; }
check() { if ( set +o pipefail; eval "$2" ) >/dev/null 2>&1; then say "ok   $1"; else say "FAIL $1"; fail=1; fi; }

# Before any real check: two self-tests of the checking machinery itself.
# docs/postmortems/260831f-the-match-that-still-failed.md is the whole story. `seq 1
# 100000` is not debris — it is a producer big enough that `grep -q` ALWAYS
# leaves while seq is still writing, so it reproduces the exact bug with
# nothing installed and no network.
#
# 1. Must PASS. Under pipefail this pipeline exits 141 (SIGPIPE), which is how
#    two correctly-configured sshd checks reported FAIL for a whole day. A FAIL
#    here means pipefail has leaked back into check(), and every other result
#    in this block is suspect.
check "self-test: a check that must pass, passed" 'seq 1 100000 | grep -q "^5$"'
# 2. Must FAIL. Written out longhand rather than folded into check(), because
#    inverting the flag inside the helper would make the helper the thing under
#    test again. If this ever prints ok, check() has stopped being able to fail
#    and every ok in this block is meaningless.
if ( set +o pipefail; seq 1 100000 | grep -q "^NOPE$" ) >/dev/null 2>&1; then
  say "FAIL self-test: a check that must fail, passed - check() can no longer fail, so every ok below it means nothing"
  fail=1
else
  say "ok   self-test: a check that must fail, failed"
fi

check "/home is the volume"      'test "$(stat -c %d /home)" = "$(stat -c %d /mnt/data/home)"'
check "swap active"              'swapon --show | grep -q swapfile'
check "node is the wanted major" 'su - '"$USER_NAME"' -c "node -v" | grep -q "^v${GJD_NODE_MAJOR}\."'
check "npm present"              'su - '"$USER_NAME"' -c "command -v npm"'
check "claude runs"              'timeout 30 su - '"$USER_NAME"' -c "claude --version"'
# The loopback, end to end and as the user -- not "the key file exists". Three
# separate things have to be true at once (a key, a line in authorized_keys, a
# Host block that makes ssh actually OFFER a non-default key name), each of them
# present-looking while the connection still fails, so the only check worth
# having is the connection. BatchMode is what stops a broken one hanging on a
# password prompt until the run times out.
check "gjd-remote loopback ssh works" 'timeout 20 su - '"$USER_NAME"' -c "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new 127.0.0.1 hostname"'
# ...and the address it will use, which is the other half: the ssh above can
# work perfectly and `gjd-remote ls` still die at "could not read the server
# address from Terraform state", because the box has no tofu. A login shell,
# because that is what a tmux session gets.
check "GJD_REMOTE_HOST is set on the box" 'su - '"$USER_NAME"' -c "echo \$GJD_REMOTE_HOST" | grep -qx "127.0.0.1"'
# Reads the value back out of the JSON rather than grepping the file for the
# key name: a merge that landed the key with the wrong value, or under the wrong
# parent, looks identical to a working one under grep.
check "claude scroll speed is 1" 'jq -er ".env.CLAUDE_CODE_SCROLL_SPEED" /home/'"$USER_NAME"'/.claude/settings.json | grep -qx "1"'
# Two facts, and they come apart: the key can name a path that is absent,
# unreadable, or not executable. So one check reads the path back out of the
# JSON and insists the file at it is runnable BY THE USER -- root's `test -x`
# passes on any execute bit at all, including a file only root can run.
check "claude statusline is wired up" 'jq -er ".statusLine.command" /home/'"$USER_NAME"'/.claude/settings.json | grep -qx "/home/'"$USER_NAME"'/.claude/statusline-script.sh" && su - '"$USER_NAME"' -c "test -x /home/'"$USER_NAME"'/.claude/statusline-script.sh"'
# ...and the other RUNS it, as the user, on the JSON Claude Code would send, and
# demands the number back. A status line that fails prints nothing, and nothing
# is indistinguishable from a status line that is working and quiet -- so the
# only check worth having is one that names a percentage and finds it.
#
# Invoked as a BARE PATH, not `bash <path>`, so the shebang and the execute bit
# are part of what is being tested rather than worked around. And captured
# rather than piped, so a script that prints 42% and then dies still fails:
# through a pipe the status would be grep's, and check() runs without pipefail.
# The path is written out rather than read from settings.json because the check
# above has already insisted the two are the same string.
check "claude statusline shows context %" 'out=$(printf %s "{\"model\":{\"display_name\":\"M\"},\"workspace\":{\"current_dir\":\"/tmp\"},\"context_window\":{\"used_percentage\":42}}" | su - '"$USER_NAME"' -c /home/'"$USER_NAME"'/.claude/statusline-script.sh) && case "$out" in *42%*) true ;; *) false ;; esac'
# Asserts the OUTPUT, not just the exit status. @openai/codex installs a
# prebuilt platform binary, so the interesting failure is one that exists and
# does not run -- and it is the login shell that has to find it, which is where
# a global npm bin directory missing from PATH would show up.
check "codex runs"               'timeout 60 su - '"$USER_NAME"' -c "codex --version" | grep -q "^codex-cli "'
check "chrome runs"              'timeout 30 su - '"$USER_NAME"' -c "google-chrome --version"'
# Was: `playwright cr --version || ls ~/.cache/ms-playwright/.../chrome`. Both
# halves were wrong. The `||` put the WEAK test first -- `cr --version` prints
# the playwright CLIENT version and passes on a box with no browser at all, so
# the strong half only ran once the weak one had already failed. And the strong
# half looked for a chromium download this box no longer has.
#
# What matters now is that the MCP is REGISTERED pointing at system Chrome. Read
# it narrowly: it proves Claude stored that text, and nothing more. It passes if
# the package cannot install, if this pinned version rejects the option, or if
# the server starts and crashes.
#
# Nothing here or in `gjd-remote doctor` yet drives the MCP itself.
# scripts/remote-smoke-browser.mjs imports playwright-core and supplies
# executablePath directly, so it asserts AD-HOC Playwright capability and says
# nothing about the MCPs -- an earlier version of this comment claimed
# otherwise, and GPT Sol was right that it overclaimed. Closing that gap wants
# an MCP-over-stdio navigation check; docs/project/browser-control.md records it
# as the known hole.
check "playwright mcp uses system chrome" 'timeout 30 su - '"$USER_NAME"' -c "claude mcp get playwright" | grep -q -- "--browser chrome"'
check "playwright mcp"           'timeout 30 su - '"$USER_NAME"' -c "claude mcp get playwright" | grep -q max-old-space-size'
check "devtools mcp"             'timeout 30 su - '"$USER_NAME"' -c "claude mcp get chrome-devtools" | grep -q max-old-space-size'
check "docker daemon runs"       'timeout 30 docker info'
# Assert the EFFECT, not the artefact. `id -nG | grep docker` would pass on a
# box where the daemon is dead or the socket unreachable; running a container
# as $USER_NAME proves the daemon, the runtime and the group all work together.
# The image was pulled above, so this needs no network.
check "docker run as $USER_NAME" 'timeout 120 su - '"$USER_NAME"' -c "docker run --rm hello-world" | grep -q "Hello from Docker"'
check "supabase cli pinned"      'timeout 30 su - '"$USER_NAME"' -c "supabase --version" | grep -qx "'"$SUPABASE_VERSION"'"'
# Git plumbing. Deliberately NOT a check that tokens are present: they are a
# human step, and a check that stays red until somebody does it is how a report
# stops being read. The helper refuses loudly at first use if a token is absent.
check "git identity"             'su - '"$USER_NAME"' -c "git config --global user.email" | grep -q "@"'
check "git credential helper"    'su - '"$USER_NAME"' -c "git config --global credential.https://github.com.helper" | grep -q github-owner-credential-helper'
check "git useHttpPath on"       'su - '"$USER_NAME"' -c "git config --global credential.useHttpPath" | grep -qx true'
# Refusal is now "emit quit=1, return no password, exit 0" -- exit 0 because git
# ignores a failed helper's output, and quit=1 because a non-zero exit only stops
# US: git moves on to the next configured helper. So assert the two things that
# matter rather than the exit status, which used to be 1 and deliberately is not.
check "helper refuses unknown"   'out=$(printf "protocol=https\nhost=github.com\npath=nobody-here/x.git\n\n" | /usr/local/bin/github-owner-credential-helper.sh get 2>/dev/null); case "$out" in *password=*) false;; *quit=1*) true;; *) false;; esac'
check "token dir"                'test -d /etc/github-tokens && [ "$(stat -c %a /etc/github-tokens)" = "700" ]'
check "tmux config parses"       'timeout 20 su - '"$USER_NAME"' -c "tmux -f ~/.tmux.conf -L verify start-server \; kill-server"'
# Parsing is not taking effect. `start-server` above leaves no session, so that
# server exits immediately and the NEXT `tmux` command on the socket starts a
# fresh one with tmux's own defaults -- which is how a check on the config could
# read back tmux's answer rather than ours. This one holds a session open while
# it counts, and it can fail: stock tmux 3.4 on this box answers 260.
#
# In a file, not inline, because check() runs `eval` and the $(...) in here
# would otherwise be substituted by the root shell before su ever saw it.
# The path is spelled out rather than held in a variable, because
# check-cloud-init.ts parses every check() argument on its own under `set -u`,
# where a variable this file defines is unbound. It caught exactly that.
cat > /tmp/provision-tmux-keys.sh <<'PROBE'
set -u
sock=verifykeys
tmux -L "$sock" kill-server 2>/dev/null
tmux -f "$HOME/.tmux.conf" -L "$sock" new-session -d 'sleep 30'
# grep -c exits 1 on a count of zero, which is the passing case, so the count is
# read out of the assignment rather than out of the exit status.
n=$(tmux -L "$sock" list-keys | grep -c bind-key)
tmux -L "$sock" kill-server 2>/dev/null
echo "bindings: $n"
[ "$n" = 0 ]
PROBE
chmod 0644 /tmp/provision-tmux-keys.sh
check "tmux binds nothing"       'timeout 40 su - '"$USER_NAME"' -c "bash /tmp/provision-tmux-keys.sh"'
rm -f /tmp/provision-tmux-keys.sh
check "sshd config valid"        'sshd -t'
check "sshd -T runs"             'sshd -T >/dev/null 2>&1'
check "password auth off"        'sshd -T 2>/dev/null | grep -qi "^passwordauthentication no"'
check "root login off"           'sshd -T 2>/dev/null | grep -qi "^permitrootlogin no"'
# Record the verdict somewhere canonical and always-current.
#
# cloud-init tees the first boot to /var/log/provision.log and never touches it
# again, so anything reading that file is reading what was true at build time --
# which was wrong for a day while the sshd checks were lying, and would be wrong
# again after any re-run. This file is overwritten by whoever ran the script
# last, so a reader always gets the latest answer and can see when it was.
{
  echo "ran: $(date -Is)"
  echo "attempt: $ATTEMPT"
  echo "script-sha256: $(sha256sum "$0" 2>/dev/null | cut -d" " -f1)"
  printf '%b' "$REPORT"
  if [ "$fail" -ne 0 ]; then echo "PROVISION INCOMPLETE"; else echo "PROVISION OK"; fi
} > "$STATUS"
chmod 0644 "$STATUS"

if [ "$fail" -ne 0 ]; then
  echo "PROVISION INCOMPLETE — see above" >&2
  exit 1
fi
echo "PROVISION OK"
