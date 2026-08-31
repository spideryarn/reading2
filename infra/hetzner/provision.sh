#!/usr/bin/env bash
set -euo pipefail

# Extracted from cloud-init.yaml on 2026-08-31 so it can be shellcheck'd, diffed,
# and re-run on a live box. It is injected into cloud-init LITERALLY (filebase64),
# never through templatefile() -- so every ${...} below is bash's, and there is no
# such thing as a Terraform escape in this file. Getting that backwards is what
# broke a previous build: an unescaped ${...} inside a *comment* failed planning.
#
# The four values Terraform knows arrive in this file instead, written by cloud-init.
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
run 420 "playwright system deps" npx --yes playwright@latest install-deps chromium
run 420 "playwright chromium" su - "$USER_NAME" -c 'npx --yes playwright@latest install chromium </dev/null'

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
# Straight from the official terminal-config page. Without allow-passthrough
# the progress bar and desktop notifications never escape tmux; without
# extended-keys, Shift+Enter submits instead of inserting a newline.
# Never clobber an existing config on rebuild.
if [ ! -f /home/"$USER_NAME"/.tmux.conf ]; then
  cat > /home/"$USER_NAME"/.tmux.conf <<'TMUX'
set -g allow-passthrough on
set -s extended-keys on
set -as terminal-features 'xterm*:extkeys'
TMUX
  chown "$USER_NAME":"$USER_NAME" /home/"$USER_NAME"/.tmux.conf
fi

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
add_mcp playwright "npx -y @playwright/mcp@$PW_MCP --headless --isolated"
add_mcp chrome-devtools "npx -y chrome-devtools-mcp@$CDT_MCP --headless"

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
# docs/postmortems/the-match-that-still-failed.md is the whole story. `seq 1
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
check "chrome runs"              'timeout 30 su - '"$USER_NAME"' -c "google-chrome --version"'
check "playwright chromium runs" 'timeout 60 su - '"$USER_NAME"' -c "npx --yes playwright@latest cr --version" 2>/dev/null || su - '"$USER_NAME"' -c "ls ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome"'
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
check "git identity"             'su - '"$GJD_USERNAME"' -c "git config --global user.email" | grep -q "@"'
check "git credential helper"    'su - '"$GJD_USERNAME"' -c "git config --global credential.https://github.com.helper" | grep -q github-owner-credential-helper'
check "git useHttpPath on"       'su - '"$GJD_USERNAME"' -c "git config --global credential.useHttpPath" | grep -qx true'
check "credential helper runs"   'printf "protocol=https\nhost=github.com\npath=nobody-here/x.git\n\n" | /usr/local/bin/github-owner-credential-helper.sh get; [ $? -eq 1 ]'
check "token dir"                'test -d /etc/github-tokens && [ "$(stat -c %a /etc/github-tokens)" = "700" ]'
check "tmux config parses"       'timeout 20 su - '"$USER_NAME"' -c "tmux -f ~/.tmux.conf -L verify start-server \; kill-server"'
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
STATUS=/var/log/gjd-provision-status
{
  echo "ran: $(date -Is)"
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
