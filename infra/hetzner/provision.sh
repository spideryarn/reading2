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
  local rc=0
  timeout --kill-after=30 "$secs" "$@" </dev/null || rc=$?
  # Failed and timed out are different bugs, and the message used to say both
  # at once: an installer that printed success and exited 1 after eighteen
  # seconds read as "failed or timed out after 300s", and the timeout was the
  # half everyone looked at (docs/postmortems/260903a-a-logout-hook-decided-the-exit-status.md).
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
      echo "FATAL: '$what' timed out after ${secs}s (exit $rc)" >&2
    else
      echo "FATAL: '$what' failed with exit $rc" >&2
    fi
    return 1
  fi
}

# "${AS_USER[@]}" <script>: run a bash script as $USER_NAME, in a NON-login shell.
#
# Not `su - $USER_NAME -c`, which this replaced on 2026-09-03. `su -` starts a
# LOGIN shell, and a login shell runs ~/.bash_logout on the way out -- Ubuntu's
# stock one calls `clear_console -q`, which fails when there is no console, and
# under the `set -e` inside the command that failure became the shell's exit
# status. So the Claude installer printed "Installation complete", exited 0,
# and the step still reported FATAL; every `su -` step with `set -e` in it did.
# docs/postmortems/260903a-a-logout-hook-decided-the-exit-status.md.
#
# A non-interactive command wants a non-login shell: no profile, no logout
# hook, and an environment that is spelled out here rather than inherited from
# root. HOME is the user's (the installers put their binaries under it and
# refuse to run under sudo, which is why sudo is not the tool either), and
# PATH starts with ~/.local/bin, where claude and codex live.
#
# An array rather than a function so that `run` and `timeout`, which exec a
# command by name, can be handed it: an external command cannot call a shell
# function, and `export -f` is the kind of trick that works until it does not.
AS_USER=(
  runuser -u "$USER_NAME" -- env -i
  HOME="/home/$USER_NAME" USER="$USER_NAME" LOGNAME="$USER_NAME" SHELL=/bin/bash
  PATH="/home/$USER_NAME/.local/bin:/usr/local/bin:/usr/bin:/bin"
  bash -c
)
apt_get() {
  apt-get -o DPkg::Lock::Timeout=600 -y "$@" </dev/null
}

# The apt timers fire on first boot and fight us for the dpkg lock. Stop
# them for the duration; they are re-enabled at the end.
systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true

echo "=== swap ==="
# Creates swap once; it deliberately does NOT resize existing swap. Growing it
# in place needs `swapoff`, which forces every swapped page back into RAM at
# once - on the loaded box that makes you want more swap, that is the OOM you
# were trying to avoid. To add swap to a box that already has some, append a
# second file instead (safe, no swapoff, takes effect immediately):
#   docs/reusable/diagnose-box-resources.md - "Add swap without disrupting anything"
# So raising swap_gb reaches new boxes only. Existing ones need the manual step.
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

# Claude Code, installed AS THE USER with Anthropic's native installer -- not
# `npm install -g` as root, which is what this line used to be.
#
# npm's global prefix on this box is /usr, not /usr/local: NodeSource's
# packaging computes it and no npmrc sets it, so nobody chose it and nothing
# says it out loud. `npm install -g` as root therefore put claude in a
# root-owned /usr/lib/node_modules, and Claude Code's self-updater -- which runs
# as $USER_NAME -- could not write a byte of it. Every session opened with
#   Auto-update failed: no write permission to npm prefix. Run claude doctor
# and the box sat on 2.1.251 while 2.1.258 shipped.
# docs/postmortems/260902c-a-claude-that-could-never-update-itself.md.
#
# The native installer is Anthropic's current recommendation and `claude doctor`
# names it as the fix. It puts a versioned binary under
# ~/.local/share/claude/versions/ and points ~/.local/bin/claude at it, all owned
# by the user, so the updater can swap versions with no sudo at all. It REFUSES
# to run under sudo (it installs into $HOME, which under sudo is root's), hence
# `su -` rather than the plain `run` the npm line used.
#
# Downloaded in full and then run, rather than `curl | bash`. A pipe executes
# the script as it arrives, so a connection that dies mid-transfer runs the
# first half of an installer and stops -- and `set -o pipefail` reports that
# correctly, long after the half-install already happened. This file pins node
# and supabase for adjacent reasons.
run 300 "install claude code" "${AS_USER[@]}" 'set -eu; t=$(mktemp); curl -fsSL https://claude.ai/install.sh -o "$t"; rc=0; bash "$t" || rc=$?; rm -f "$t"; exit $rc'

# Expose the user-owned binary at a path a stock PATH already contains.
#
# Every non-login context on this box gets a stock PATH with no ~/.local/bin in
# it: the tmux job scripts gjd-remote writes (scripts/gjd-remote.ts, which sets
# its own PATH and says why), the `ssh <box> claude mcp list` behind
# `gjd-remote doctor`, cron. ~/.profile adds ~/.local/bin for login shells only,
# and only once the directory exists. So without this line `claude` resolves in
# an ssh login shell and nowhere that actually runs the work -- which is the
# same wrong-tree failure gjd-remote's own guards exist to catch, and it would
# pass the "claude runs" check below.
#
# /usr/local/bin is where FHS puts a local override, and it precedes /usr/bin in
# every PATH on this box. One symlink, so there is exactly one answer to "which
# claude" no matter who is asking.
#
# This is also the half that a rebuild needs. /home is the persistent volume, so
# a new server arrives with ~/.local/bin/claude already on it and the install
# step above is a no-op -- while /usr/local/bin is on the disposable root disk
# and comes back empty. Without this line a rebuilt box would have a perfectly
# good Claude that no job script could find.
#
# -T so that an unexpected real DIRECTORY at /usr/local/bin/claude fails loudly
# rather than quietly becoming /usr/local/bin/claude/claude, which nothing would
# ever find.
ln -sfnT "/home/$USER_NAME/.local/bin/claude" /usr/local/bin/claude

command -v claude >/dev/null || { echo "FATAL: installer reported success but claude is not on PATH" >&2; exit 1; }
# `command -v` could not see the bug this replaced: a claude that runs perfectly
# and can never update itself. So assert the property that was missing rather
# than the one that was always true -- the user can WRITE what the updater has
# to rewrite. Ownership is not that property: owning a symlink does not let you
# repoint it, the parent directory does. Checked again, more fully, at the end
# of the run.
CLAUDE_BIN=$(readlink -f /usr/local/bin/claude)
"${AS_USER[@]}" "test -w '$(dirname "$CLAUDE_BIN")' && test -w '/home/$USER_NAME/.local/bin'" \
  || { echo "FATAL: $USER_NAME cannot write $CLAUDE_BIN or its launcher dir - auto-update would fail exactly as it did before" >&2; exit 1; }

echo "=== codex cli ==="
# OpenAI's agent CLI, so scripts/run-codex.ts works here as it does on the
# laptop — the cross-family review docs/reusable/codex-cli-as-subagent.md makes
# a standing rule. Unpinned, like claude-code above and unlike the two MCP
# servers below: the wrapper passes model, effort, sandbox and approval policy
# on every invocation, so a floating version steers nothing.
#
# @openai/codex ships a prebuilt platform binary rather than JS, so it is the
# one global here that can install "successfully" with nothing runnable for
# this architecture. Hence running it rather than looking for the file.
#
# Installed AS THE USER with OpenAI's own installer, for the reason the claude
# block above spells out at length: `npm install -g` as root lands in a
# root-owned /usr prefix, and `codex update` -- which is a real subcommand, and
# which runs as $USER_NAME -- cannot write there. Codex had exactly the same
# latent bug as Claude Code and was left alone in the first pass because it
# looked less urgent, not because it was well.
#
# It is quieter about it than Claude Code is, which is the reason to fix it
# rather than wait: `claude doctor` said "no write permission to npm prefix" on
# every session start, whereas `codex doctor` reports `install: consistent` and
# prints `npm update target /usr/lib/node_modules/@openai/codex` without ever
# checking whether that target is writable. Nothing would have told us.
#
# CODEX_NON_INTERACTIVE=1 because provisioning has no terminal.
#
# CODEX_HOME and CODEX_INSTALL_DIR are PINNED rather than left to default. They
# would default to exactly these paths, but the checks below hardcode them, and
# a check that is only true while nobody has exported a variable is a check that
# will quietly stop meaning anything. `su -` clears the caller's environment,
# but a login startup file on the persistent /home volume can set either again.
# Provisioning owns this machine's layout, so it says so.
#
# The installer also appends a marker-guarded PATH block to a shell rc file.
# That is intentional and idempotent rather than harmless -- it changes the PATH
# of every shell started afterwards, which is what we want, but it is a real
# observable effect and the only dotfile edit in this whole script. The symlink
# below is what makes codex findable everywhere the rc file is never read.
run 300 "install codex cli" "${AS_USER[@]}" 'set -eu; t=$(mktemp); curl -fsSL https://chatgpt.com/codex/install.sh -o "$t"; rc=0; CODEX_HOME='"/home/$USER_NAME/.codex"' CODEX_INSTALL_DIR='"/home/$USER_NAME/.local/bin"' CODEX_NON_INTERACTIVE=1 sh "$t" || rc=$?; rm -f "$t"; exit $rc'

# Same stock-PATH problem, same one-line answer -- see the claude symlink above
# for the full reasoning.
#
# `codex` is the only binary to LINK. The installer's other one,
# codex-code-mode-host, gets a launcher in BIN_DIR on darwin only and is
# actively removed there on linux -- but the executable itself very much runs
# here: every `codex exec` on this box spawns one out of the release directory,
# which is visible in /proc. It is reached from inside the install, never from
# PATH, so it needs nothing from us. That distinction is the whole reason the
# npm tree cannot simply be deleted underneath a running review.
ln -sfnT "/home/$USER_NAME/.local/bin/codex" /usr/local/bin/codex

CODEX_V=$(timeout 60 codex --version 2>/dev/null || echo none)
case "$CODEX_V" in
  codex-cli\ *) echo "$CODEX_V" ;;
  *) echo "FATAL: installer reported success but 'codex --version' printed '$CODEX_V'" >&2; exit 1 ;;
esac
# And the property `--version` cannot see, the one that was wrong for Claude:
# that the user can actually rewrite what `codex update` has to replace.
#
# THREE directories, not two, and `-x` as well as `-w`: mutating a directory
# needs both. `standalone/` holds the lock and the `current` symlink the updater
# repoints; `releases/` is where the new version is staged; `.local/bin` is the
# launcher. Missing any one of them is an update that fails partway.
for d in "/home/$USER_NAME/.local/bin" "/home/$USER_NAME/.codex/packages/standalone" "/home/$USER_NAME/.codex/packages/standalone/releases"; do
  "${AS_USER[@]}" "test -d '$d' && test -w '$d' && test -x '$d'" \
    || { echo "FATAL: $USER_NAME cannot mutate '$d' - 'codex update' would fail, and codex doctor would not say so" >&2; exit 1; }
done
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

echo "=== tailscale ==="
# Installed by hand on the live box on 2026-09-08
# (curl -fsSL https://tailscale.com/install.sh | sudo sh, version 1.102.3) because the agent
# fleet dashboard needs to be reachable from Greg's phone and binding the tailnet interface is
# the access control -- docs/project/hetzner-remote-server-box.md. AGENTS.md's rule -- a change
# to the box that should still be true next week is also a change to the file that builds the
# next box -- makes doing it there and not here a bug on its own, whether or not the dashboard
# ships.
#
# Tailscale's OWN apt repo, exactly as https://pkgs.tailscale.com/stable/#ubuntu-noble documents
# -- fetched and verified on 2026-09-08, not recalled from memory: both files below were
# downloaded and inspected before this was written. Two things differ from the Docker block just
# above, both because Tailscale's server decides the file's shape and not this script:
#   - the key served at .noarmor.gpg is ALREADY a binary OpenPGP keyring (confirmed with
#     `gpg --show-keys` against the downloaded file: "OpenPGP Public Key Version 4"), not the
#     ASCII-armored key `gpg --dearmor` exists to convert. Piping a file that needs no converting
#     through dearmor is not "following the pattern more closely", it is corrupting the key.
#   - the sources.list.d line is fetched verbatim rather than built from ${DEB_ARCH} and
#     ${UBUNTU_CODENAME} by hand, because pkgs.tailscale.com already renders it for the exact
#     codename in the URL -- so the codename is still derived the way the Docker block derives
#     it (the ${UBUNTU_CODENAME} computed above, from /etc/os-release), it is just spliced into
#     a URL instead of a hand-written `deb` line.
#
# The two URLs are resolved HERE, in this shell, not inside the `bash -o pipefail -c '...'`
# below. That single-quoted string becomes the -c argument of a brand-new bash process (`run`
# execs "$@" directly, it is not `eval`d by this shell), and UBUNTU_CODENAME was never exported
# -- so a ${UBUNTU_CODENAME} written inside those quotes would expand to nothing in that child
# and silently curl a URL with an empty path segment. Every other apt block in this file sidesteps
# this by only ever using ${DEB_ARCH}/${UBUNTU_CODENAME} inline, in this shell (the docker `echo`
# line above, the supabase download below); this is the first one that needed the value inside a
# spawned command, so the substitution has to happen before `run` is called, not after.
TAILSCALE_KEY_URL="https://pkgs.tailscale.com/stable/ubuntu/${UBUNTU_CODENAME}.noarmor.gpg"
TAILSCALE_LIST_URL="https://pkgs.tailscale.com/stable/ubuntu/${UBUNTU_CODENAME}.tailscale-keyring.list"
run 60 "tailscale signing key" bash -o pipefail -c "curl -fsSL '$TAILSCALE_KEY_URL' -o /usr/share/keyrings/tailscale-archive-keyring.gpg"
chmod 0644 /usr/share/keyrings/tailscale-archive-keyring.gpg
run 60 "tailscale apt list" bash -o pipefail -c "curl -fsSL '$TAILSCALE_LIST_URL' -o /etc/apt/sources.list.d/tailscale.list"
run 180 "apt update (tailscale)" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any -y update'

# Assert the CANDIDATE'S ORIGIN before installing, exactly as the Docker and node blocks above
# do, and for the same reason: this repo has already been bitten once by apt reporting success
# while installing a different package entirely (novnc had pulled in Ubuntu's nodejs, and
# `apt-get install nodejs` said "already the newest version" and exited 0). Ubuntu ships no
# tailscale package of its own today, but a stale cache or a mirror could still hand back a
# candidate from somewhere other than pkgs.tailscale.com, and "tailscale is installed" would be
# no evidence of anything by itself.
TAILSCALE_POLICY=$(apt-cache policy tailscale)
TAILSCALE_CAND=$(printf '%s\n' "$TAILSCALE_POLICY" | awk '/^ *Candidate:/{print $2}')
TAILSCALE_SRC=$(printf '%s\n' "$TAILSCALE_POLICY" | awk -v v="$TAILSCALE_CAND" '
  $1 == v || ($1 == "***" && $2 == v) { hit = 1; next }
  hit { print $2; exit }')
case "$TAILSCALE_SRC" in
  https://pkgs.tailscale.com/*) echo "tailscale candidate $TAILSCALE_CAND from $TAILSCALE_SRC" ;;
  *) echo "FATAL: tailscale candidate is '$TAILSCALE_CAND' from '$TAILSCALE_SRC', wanted one from pkgs.tailscale.com - Tailscale's repo is not winning" >&2; exit 1 ;;
esac
run 180 "install tailscale" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install tailscale'

# Enabled and started, but NOT logged in -- `tailscale up` is deliberately never run here.
# It prints a URL a human has to open in a browser, exactly like claude's and codex's own
# /login above, and a provisioning script that blocked on that would hang forever on a box with
# no browser to open it in. `enable --now` only starts tailscaled, the daemon: the box is left
# one `tailscale up` away from joining the tailnet, and nothing here opens a port or connects to
# anything.
systemctl enable --now tailscaled

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

echo "=== editor ==="
# `emacs -nw` is the editor on every gjd-remote box, because it is Greg's
# editor. emacs-nox is the terminal-only build -- no X, no GUI toolkit, which is
# what a headless box wants -- so `-nw` is redundant against it and is written
# anyway, because it is what a person types and it stays correct if a graphical
# emacs ever arrives.
#
# Installed HERE rather than added to cloud-init.yaml's `packages:` list, even
# though it is a plain apt package exactly like tmux. cloud-init runs once, on a
# box's first boot; provision.sh is what gets re-run on the boxes that already
# exist. "Going forwards including this one" is only true of this file. One
# copy, in the file that reaches every box -- a second in cloud-init would be
# the copy that goes stale.
run 600 "install emacs" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install emacs-nox'

# Three things name the editor, because three different callers ask a different
# question and only one of them reads the environment:
#   1. $EDITOR / $VISUAL, for everything that does. A login shell is enough for
#      a human at a prompt, which is who asks this one.
#   2. the `editor` alternative, for sudoedit, visudo, and anything else that
#      runs /usr/bin/editor with no environment to consult. Ubuntu points it at
#      nano and nothing else here would change that.
#   3. git's core.editor, set explicitly rather than left to fall through
#      $VISUAL/$EDITOR: `ssh box git commit` is a non-login shell that sees
#      neither, and git then falls back to its build-time default.
cat > /etc/profile.d/editor.sh <<'EOF'
# Written by provision.sh. See docs/project/hetzner-remote-server-box.md.
export EDITOR='emacs -nw'
export VISUAL='emacs -nw'
EOF
chmod 0644 /etc/profile.d/editor.sh
# --set, not --auto: this is a decision, and auto mode would hand the link back
# to whichever alternative has the highest priority the next time one is
# installed or removed.
update-alternatives --set editor /usr/bin/emacs
run 30 "git editor" su - "$GJD_USERNAME" -c 'git config --global core.editor "emacs -nw"'

echo "=== python ==="
# Ubuntu 24.04 ships python3 3.12 but neither pip nor the venv module, so
# `python3 -m venv .venv` fails on a stock box -- for hellozenno's venv
# (docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md).
# Installed here rather than in cloud-init.yaml for the reason the emacs block
# above spells out: this is the file that reaches boxes that already exist.
run 300 "install python3-venv" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install python3-venv python3-pip'

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
run 60 "reload running tmux" "${AS_USER[@]}" "bash /tmp/provision-tmux-reload.sh" \
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
# `permissions.defaultMode` is the one key here that is not a preference.
#
# Which permission mode a session starts in was a COIN FLIP until 2026-09-08:
# 28 auto, 7 default across the gjd-remote launches since 09-06, and two
# sessions launched 25 seconds apart from identical generated job scripts came
# up in opposite modes. A default-mode session runs normally until its first
# unapprovable call -- in practice `git fetch`, `git log`, `npm run
# worktree:setup` or an MCP read, so within the first minute of almost any
# brief here -- and then waits for a human who is asleep. Measured stalls:
# 7.38h, 6.34h, 5.75h, 5.35h, 5.33h, 4.30h. 34.9 agent-hours since 09-06,
# independently reproducing the 41.6 hours since 09-01 that `c7c44f61`
# measured. The longest stall in ANY always-auto session over three days is
# 21 minutes.
#
# `scripts/gjd-remote.ts` was fixed at 03:16Z on 2026-09-08 to pass
# `--permission-mode auto`, but that covers only the sessions IT launches:
# interactive and EnterWorktree launches went on coin-flipping (measured twice
# on 09-07). This key is what covers the rest, and it is here rather than only
# on the box because a rebuilt machine that reintroduces the coin flip
# reintroduces the thirty-five hours.
#
# Greg's call, 2026-09-08, asked as now / forwards / both and answered "both".
# It makes the auto-mode classifier the fleet's permission gate by default,
# which is a decision about who approves things and not a tuning knob.
#
# `+` onto whatever is already there, like `statusLine` above: `permissions`
# also carries allow/deny rules that are Greg's and not ours to drop.
jq --arg sl "$sl" '
  .env.CLAUDE_CODE_SCROLL_SPEED = "1"
  | .statusLine = ((.statusLine // {}) + { type: "command", command: $sl })
  | .permissions = ((.permissions // {}) + { defaultMode: "auto" })
' "$f" > "$tmp"
mv "$tmp" "$f"
SETTINGS
# 0644: the scripts are written by root in /tmp and read by $USER_NAME's shell.
chmod 0644 "$CLAUDE_SETTINGS_SH" "$CLAUDE_STATUSLINE_SH"
run 30 "claude settings" "${AS_USER[@]}" "bash $CLAUDE_SETTINGS_SH $CLAUDE_STATUSLINE_SH"
rm -f "$CLAUDE_SETTINGS_SH" "$CLAUDE_STATUSLINE_SH"

echo "=== test worker cap ==="
# How many test files ONE vitest run may run at once here. This box is not a
# machine running a suite, it is a machine running ten of them, and vitest's
# default of `cores - 1` is decided by each run in ignorance of the rest -- the
# same shape as the MCP heap cap below, arriving through the test runner.
# docs/plans/260906h-cap-vitest-workers-so-one-box-can-hold-ten-suites.md has
# the incident and the arithmetic.
#
# 2 rather than the repo's own default of half the cores (8 here): that default
# has to be right for a laptop running one suite, and this file is where a
# machine gets to say it is crowded.
#
# It was 3 until 2026-09-08, when eighteen concurrent runs at 3 put this box at
# load 391 with swap 100% full. Do not read the drop to 2 as the fix for that --
# it is not, and measuring why is what 260908b is about. 87% of a run's peak
# memory is spent before its first worker forks, so the worker cap bounds FORKS
# (54 to 36 here) and barely touches gigabytes. The memory half of the answer is
# the reserve file written just below.
#
# A FILE, not the `env` block of ~/.claude/settings.json where this obviously
# belonged: measured on this box, nothing in that block reaches a Claude Bash
# tool call, not even the CLAUDE_CODE_SCROLL_SPEED that has been in it since the
# box was built. A file vitest.config.ts reads has no propagation to be wrong
# about. Written every run, not merged: one number, ours, nobody else's to keep.
#
# Written through a temporary file and renamed, for both files here: `>`opens
# and TRUNCATES before it writes, so an interrupted run leaves a zero-byte file
# rather than the old one. For the reserve below that state used to read as
# "this machine has no policy" -- the check silently absent on the one machine
# that asked for it. rename(2) is atomic within a filesystem, so a reader sees
# the old contents or the new ones and never nothing. GPT Sol, 2026-09-08.
run 30 "test worker cap" "${AS_USER[@]}" \
  "mkdir -p \$HOME/.config/spideryarn && printf '2\n' > \$HOME/.config/spideryarn/.vitest-max-workers.tmp && mv \$HOME/.config/spideryarn/.vitest-max-workers.tmp \$HOME/.config/spideryarn/vitest-max-workers"

# How much RAM to keep back for everything that is not a test run: the agents
# themselves (12.9 GB across 159 processes when this was measured), postgres,
# the dev servers, the browsers, and the page cache.
#
# THE PRESENCE OF THIS FILE IS THE OPT-IN. vitest.config.ts asks
# /proc/meminfo whether there is room for a run's fixed 3.84 GB on top of this
# reserve, and REFUSES TO START when there is not -- which is the only thing
# that actually bounds how many suites run at once, because nothing else does.
# A laptop has no file, keeps the static behaviour, and is never refused:
# MemAvailable is Linux's number and macOS has no honest equivalent.
#
# 4 GB, and the arithmetic is worth keeping: a run's fixed cost is 5 GB, so it
# needs 9 GB available before it may start and is turned away below that. This
# box idles around 14-18 GB available, so ordinary work is admitted and a box
# already carrying several suites starts refusing. On 2026-09-08 it had 1.7 GB,
# and every one of the eighteen runs would have been refused.
#
# Turn this DOWN, not the constant, if the box starts refusing work it should
# have done: the reserve is a policy about this machine, and the 5 GB is a
# measurement about the suite.
run 30 "test memory reserve" "${AS_USER[@]}" \
  "mkdir -p \$HOME/.config/spideryarn && printf '4\n' > \$HOME/.config/spideryarn/.vitest-memory-reserve-gb.tmp && mv \$HOME/.config/spideryarn/.vitest-memory-reserve-gb.tmp \$HOME/.config/spideryarn/vitest-memory-reserve-gb"

echo "=== mcp servers ==="
# Literal versions, reviewed and committed, rather than `npm view … version`.
#
# Resolving @latest on every SESSION launch would be worse still -- a supply-chain
# surface, and two sessions able to run different code -- and avoiding that was
# the original point here. But asking npm at PROVISION time only narrows the
# window: the box still installs whatever was latest the day it was built, no
# diff in this repo records the move, and the evidence someone gathered against
# the version they measured stops describing the box the moment it is rebuilt.
# That happened: these two were measured at length on 2026-09-08 and 1.9.0 had
# shipped that same day, so a rebuild would have silently changed the subject.
#
# Bump these deliberately, and run scripts/remote-smoke-mcp-browser.mjs after --
# it drives both servers concurrently and is the check that a new version still
# works here.
PW_MCP=0.0.80
CDT_MCP=1.8.0
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
  timeout 60 "${AS_USER[@]}" "claude mcp remove --scope user $name </dev/null" </dev/null 2>/dev/null || true
  timeout 60 "${AS_USER[@]}" "claude mcp add --env '$CAP' --scope user $name -- $* </dev/null" </dev/null
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
# chrome-devtools gets the same four decisions as playwright above, plus three
# of its own. Measured on 1.8.0 on the box, 2026-09-08:
#
#   --isolated            the comment above says this is here because one
#                         persistent profile supports exactly one browser and
#                         this box is for parallel sessions -- and that was true
#                         of BOTH servers while only playwright carried the
#                         flag. Reproduced: two chrome-devtools started at once
#                         and the second died with "The browser is already
#                         running for ~/.cache/chrome-devtools-mcp/chrome-profile.
#                         Use --isolated". So the second agent to reach for it
#                         got a hard failure. With the flag, both pass.
#   --executablePath      as with playwright: it finds system Chrome by channel
#                         lookup today, and naming the binary removes the lookup
#                         rather than leaving it to a default that could move.
#   --no-performanceCrux  defaults TRUE, and it sends URLs from performance
#                         traces to Google's CrUX API. Agents here drive pages
#                         holding real reader content; their URLs are not ours
#                         to send anywhere. AGENTS.md, "Real data belongs to the
#                         reader".
#   --no-usageStatistics  defaults TRUE. Data minimisation rather than a
#                         measured leak -- Google documents this as invocation
#                         and environment data, not page content. It also runs a
#                         telemetry watchdog as a separate node process per
#                         session (visible in tests/fixtures/overseer-process-trees/),
#                         and this box dies of process count. NOT verified that
#                         the flag removes the watchdog: 6 were already running
#                         from other sessions and the measurement could not
#                         isolate one.
#   --redactNetworkHeaders  defaults FALSE, and with it false a live
#                         `authorization: Bearer sbp_…` came back into model
#                         context verbatim -- measured, against a local server.
#                         Our tokens ride in that header, so this is the case
#                         that matters here.
#
#                         It is NOT a boundary, and must not be described as
#                         one. Measured, same run: it redacts by a SAFE-LIST,
#                         not a list of sensitive names, so it also blanks
#                         `x-trace-id` and any other custom header you were
#                         debugging with -- and it does not touch request or
#                         response BODIES, so a token in a JSON payload still
#                         comes through. What survives is what debugging
#                         usually needs: URL, status, timing, body, and the
#                         header NAMES. An agent that truly needs a header value
#                         should run a server by hand without the flag.
add_mcp chrome-devtools "npx -y chrome-devtools-mcp@$CDT_MCP --headless --isolated --executablePath /usr/bin/google-chrome-stable --no-performanceCrux --no-usageStatistics --redactNetworkHeaders"

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
# ...and the address, so `gjd-remote` on the box needs no argument and no
# Terraform. Only ever written on a box: on the laptop this file does not exist
# and the address still comes out of Terraform state, which is what makes it
# survive a rebuild. scripts/gjd-remote-host.ts is the reader.
#
# THIS USED TO BE AN EXPORT in /etc/profile.d/, and it was wrong for a year of
# agent-days. The comment beside it said "a login shell is enough -- tmux
# sessions get one (`exec bash -l` at the end of every job script)". They do
# not: that `exec bash -l` is the line AFTER claude exits, so Claude and every
# tool shell under it run from a stock-PATH non-login bash and never saw the
# variable. gjd-remote then fell through to a tofu the box has not got and
# reported a Terraform problem, and two readers concluded the tool could not run
# on the box at all.
#
# The class is the one this file already learned about `claude` on PATH forty
# lines down -- VERIFYING THE CONVENIENT PATH INSTEAD OF THE PATH THE WORK
# TAKES. A file has no such path to be wrong about.
#
# Written to a temporary file and renamed, not `cat >`: `cat >` follows a
# symlink and keeps whatever ownership and mode the destination already had, so
# it cannot establish the root-owned regular file the reader requires. `-T` on
# the mv is load-bearing -- with a directory at the destination the plain form
# puts the file INSIDE it and exits 0.
# Two cleanups, because they catch different things.
#
# FIRST, anything a previous run left staged. A trap cannot help there: a run
# killed outright between the mktemp and the mv leaves its file with nobody to
# tidy it.
#
# The staging name carries `.tmp.` so the sweep can be sure of what it is
# deleting. Without it the glob was `.gjd-remote-host.??????`, which matches any
# six-character suffix -- and `.gjd-remote-host.backup` is exactly six
# characters, so a file somebody had put there on purpose was swept away. Found
# by writing that file in a spike and watching it go.
#
# `test -f` as well, so a DIRECTORY with a matching name is stepped over rather
# than making `rm -f` fail and abort the whole run under `set -e`.
for gjd_host_stale in /etc/.gjd-remote-host.tmp.??????; do
  if test -f "$gjd_host_stale"; then rm -f "$gjd_host_stale"; fi
done
gjd_host_tmp=$(mktemp /etc/.gjd-remote-host.tmp.XXXXXX)
# SECOND, this run's own file, on any failure the shell can see -- including
# `mv -T` REFUSING a directory at the destination rather than putting the file
# inside it, which is the failure this whole form exists for. Measured against a
# fake /etc on 2026-09-05: without it, one stray file per failed run, for ever.
#
# The trap is safe to set here. The one `provision.sh` sets earlier lives inside
# a heredoc and belongs to a child bash, not to this process -- I had that wrong
# in the first version and used it as the reason to avoid a trap entirely.
trap 'rm -f "$gjd_host_tmp"' EXIT
printf '127.0.0.1\n' > "$gjd_host_tmp"
chown root:root "$gjd_host_tmp"
chmod 0644 "$gjd_host_tmp"
mv -f -T "$gjd_host_tmp" /etc/gjd-remote-host
trap - EXIT
# The export it replaces. Left behind it would be a second answer to the same
# question, honoured only in login shells and read through the branch that does
# no validation at all -- so a malformed file would be obeyed in one shell and
# refused in the next.
rm -f /etc/profile.d/gjd-remote-loopback.sh

echo "=== box services ==="
# The two long-running box tools, as SYSTEM units so they come back after a
# reboot: the Overseer (docs/project/overseer-direction.md) and the fleet
# dashboard it reads. Both ran as tmux jobs out of worktrees until 2026-09-08,
# which meant `git worktree remove` or a reboot took them down silently -- and
# the reboot case is the bad one, because the tool you would use to notice is
# the one that is gone.
#
# The unit files are the checked-in ones under infra/hetzner/systemd/, spliced
# in here verbatim because `gjd-remote provision` copies THIS FILE ALONE to the
# box and nothing else from the repo travels with it. tests/systemd-units.test.ts
# compares the two copies byte for byte.
#
# NEITHER IS STARTED HERE. Provisioning does not create the checkout these units
# run from and has no business deciding a live box's running state: on a box
# where the dashboard is already up under some other launcher, starting a second
# copy means a failed bind and a crash loop on the one page you would use to see
# it. What provisioning owns is that a reboot brings them back.
install_unit() {
  # <unit name>, template on stdin. @USER@ is the only substitution, so the file
  # on the box and the file in the repo differ in exactly one way.
  unit_tmp=$(mktemp)
  sed "s|@USER@|$USER_NAME|g" > "$unit_tmp"
  install -o root -g root -m 0644 "$unit_tmp" "/etc/systemd/system/$1"
  rm -f "$unit_tmp"
}

install_unit overseer.service <<'OVERSEER_UNIT'
# The Overseer: it subscribes to the fleet dashboard's stream, folds what it
# sees into ~/.overseer, and is the only thing on this box that remembers what
# the fleet did yesterday. docs/project/overseer-direction.md.
#
# A SYSTEM unit with User=@USER@, not a systemd USER unit, and that is the whole
# reason this file exists. A user unit does not start at boot unless lingering
# is enabled for the account, and nothing in this repo enables it -- so the box
# would reboot while Greg was away and the Overseer would stay down until the
# next login, with Restart= never getting a chance to matter.
#
# @USER@ is substituted at install time by infra/hetzner/provision.sh. The
# checked-in file keeps the placeholder rather than one box's username;
# tests/systemd-units.test.ts compares these bytes against the heredoc in that
# script, because two copies of a unit file is exactly how one of them goes
# stale.
[Unit]
Description=Overseer -- records what the agent fleet did, so there is a yesterday
Documentation=file:///home/@USER@/code/spideryarn2/docs/project/overseer-direction.md
After=network-online.target
Wants=network-online.target

# The rate limit lives in [Unit], not [Service] -- systemd moved it here in v229
# and a StartLimitBurst= under [Service] is silently ignored.
#
# Ten tries five seconds apart, then systemd gives up and the unit sits in
# `failed`. A genuinely broken build therefore crash-loops VISIBLY in the
# journal for about a minute and then stops, rather than restarting for ever on
# a box that has reached load average 391 once already.
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
User=@USER@
Group=@USER@

# The PRIMARY checkout, never a worktree: `git worktree remove` deletes a
# worktree, and an ExecStart pointing into one is a service that disappears when
# somebody tidies up. The cost, stated rather than buried: this runs whatever is
# in the primary checkout at the moment it starts, including a red dev.
WorkingDirectory=/home/@USER@/code/spideryarn2

# HOME explicitly, because the store lives under it and a service that inherited
# a different one would quietly build a second store nobody looks at.
Environment=HOME=/home/@USER@
# Absolute on purpose: tools/overseer/store.ts REFUSES a relative store dir,
# because a relative one resolves differently for systemd and for a person in a
# worktree, which is two daemons that cannot see each other.
Environment=OVERSEER_STORE_DIR=/home/@USER@/.overseer
Environment=OVERSEER_FLEET_URL=http://127.0.0.1:8787

# The checkout's own tsx, not `npx tsx`. npx with no local install goes to the
# network and fetches SOME tsx; this path either exists or fails loudly, which
# is the difference between a service that is wrong and one that says so.
ExecStart=/home/@USER@/code/spideryarn2/node_modules/.bin/tsx scripts/overseer.ts run

# always, not on-failure. On this box the things that send a clean SIGTERM are
# not the service's owner -- a stray pkill, a tidy-up script, an agent killing
# what it thinks is its own process -- and on-failure reads every one of those
# mistakes as a decision. A wrong `always` costs a process you have to stop
# twice; a wrong `on-failure` costs a service that is silently gone at the
# moment nobody is watching, and this one's absence is invisible: there is no
# page to tell you the page is down.
Restart=always
RestartSec=5

# scripts/overseer.ts traps SIGTERM, writes its stopping note and releases the
# lock. Give it room to do that -- a SIGKILL here leaves a lock file the next
# start has to puzzle over.
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
OVERSEER_UNIT

install_unit fleet-dashboard.service <<'FLEET_DASHBOARD_UNIT'
# The fleet dashboard: the page at :8787 that shows what every agent session on
# this box is doing. docs/plans/260907e-agent-fleet-dashboard.md.
#
# Until 2026-09-08 it ran as a tmux job whose entrypoint was inside a WORKTREE,
# so `git worktree remove` took the page down and a reboot took it down with the
# tmux server. Both are why this is a system unit in the primary checkout.
#
# INSTALLED BUT NOT ENABLED, on purpose and only for now. The dashboard is up
# under scripts/tmux-job.ts and its owner asked to read this file before it is
# ever switched on -- two supervisors on one port is a fight where the loser's
# failure looks like a crash. `sudo systemctl enable --now fleet-dashboard` once
# the tmux job is stopped.
#
# @USER@ is substituted at install time by infra/hetzner/provision.sh; see the
# note in overseer.service.
[Unit]
Description=Fleet dashboard -- the page showing what every agent session is doing
Documentation=file:///home/@USER@/code/spideryarn2/docs/project/overseer-direction.md
# tailscaled as well as the network, because on a logged-in box FLEET_BIND names
# a tailnet address as well as loopback, and tools/fleet/server.ts treats a bind
# it cannot take as FATAL rather than carrying on half-bound.
After=network-online.target tailscaled.service
Wants=network-online.target

# Longer and more forgiving than the Overseer's, for one reason: at boot the
# tailnet address may not exist yet, and every attempt before it does is a
# legitimate failure to bind. Thirty tries ten seconds apart is five minutes of
# patience, which is far more than tailscaled needs, and then it gives up
# loudly instead of restarting for ever.
StartLimitIntervalSec=900
StartLimitBurst=30

[Service]
Type=simple
User=@USER@
Group=@USER@
WorkingDirectory=/home/@USER@/code/spideryarn2
Environment=HOME=/home/@USER@

# LOOPBACK ONLY, AND THAT IS THE POINT. 127.0.0.1 is the one address that is
# correct on every box and cannot fail to bind, so this line starts the service
# anywhere. The tailnet address is per-machine, so it arrives from the file
# below and from nowhere else -- an address written here would be a second copy
# of a fact that changes with the box.
#
# THIS LINE USED TO NAME THIS BOX'S TAILNET ADDRESS TOO, under a comment saying
# "a box without the file still starts on what is written here". It started and
# then died, and every step is inside this repo: provision.sh installs Tailscale
# WITHOUT logging in (`tailscale up` wants a browser and a provisioning run has
# none), so `tailscale ip -4` prints nothing, so no env file is written, so the
# `-` below makes that fine and THIS value is what starts -- naming an address
# belonging to another machine. tools/fleet/server.ts treats a bind it cannot
# take as FATAL, deliberately, so the whole server exits, including the loopback
# listener that would have worked. A comment claiming a fallback works, beside a
# fallback that does not, is worse than no comment at all. Found by a
# cross-family review, 2026-09-08.
#
# THE TRADE, AND IT IS THE RIGHT WAY ROUND: on a box nobody has run
# `tailscale up` on, the dashboard answers from the box and not from a phone.
# That is visible, correct and one command from fixed, and it beats a service
# that will not start at all.
#
# That command is a DOCUMENTED step rather than a mechanism, and the reason is
# worth knowing before anybody adds one: EnvironmentFile is read when the
# service STARTS, so an ExecStartPre writing the file would not affect the run
# that wrote it, only the next one. Write the file first, then restart --
# docs/project/hetzner-remote-server-box.md, under "Tailscale".
Environment=FLEET_BIND=127.0.0.1
EnvironmentFile=-/etc/fleet-dashboard.env

# FLEET_ACT_ENABLED IS DELIBERATELY ABSENT, in every form, including set to
# false. Enacted actions -- removing a worktree, killing a session -- are gated
# behind it, and it stays unset until tools/fleet/routes-actions.ts has had a
# GPT Sol review, which has not happened. A unit that named the variable would
# be one edit away from enabling it, and a unit file is exactly the sort of file
# somebody skims and completes.

# BUILD THE CLIENT ON EVERY START. tools/fleet/web/dist is gitignored, so no
# `git pull` can ever supply it and server.ts exits 2 without it -- a
# freshly-cloned checkout would otherwise come up dead after every reboot with
# nobody watching.
#
# UNCONDITIONAL, AND THAT IS A REVERSAL. The first two versions tested for
# dist/index.html first, on the reasoning that Restart=always plus RestartSec=10
# makes an unconditional build a vite build every ten seconds through a crash
# loop, on a box that has reached load average 391. Then somebody timed it:
# `npm run build:fleet` is **1.9 seconds**, and the whole client is one 339 kB
# bundle. The objection was sized against a build nobody had measured.
#
# What the `test` bought was ~2 seconds per start. What it cost is the failure
# with no alarm anywhere: a `dev` that moves tools/fleet/web/ without a rebuild
# leaves the old bundle in place, and this unit serves a STALE page against a
# newer server, silently. A missing build fails loudly; a stale one does not.
# Rebuilding every start makes the bundle a function of the checkout rather than
# of who last remembered to run a command.
#
# And the conditional version did not even prevent the loop it was named for: a
# FAILED build never writes dist/index.html, so `test -f` never short-circuits
# and every retry rebuilds anyway. Found by the fleet dashboard agent,
# 2026-09-08. Bounded by StartLimitBurst in both versions -- at ~2s a build plus
# RestartSec=10, thirty starts fit well inside the 900s window, so systemd stops
# it and says so.
#
# No `-` prefix, deliberately: a client that will not build should fail the
# start loudly rather than quietly serve the previous bundle.
ExecStartPre=/usr/bin/npm run build:fleet
ExecStart=/home/@USER@/code/spideryarn2/node_modules/.bin/tsx tools/fleet/server.ts

# Room for that build on a loaded box. The default 90s is one contended vite
# build away from a start that times out and then starts again, building each
# time.
TimeoutStartSec=600

# always, not on-failure -- the reasoning is in overseer.service and applies
# with more force here, because this page is what you look at to find out that
# something else is wrong.
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
FLEET_DASHBOARD_UNIT

# The dashboard's bind list. The unit falls back to LOOPBACK ALONE -- the one
# address that is right on every box and cannot fail to bind -- and this file is
# the only way the tailnet address, which only this machine has, ever reaches
# it. Written from `tailscale ip -4`, so it exists only once somebody has logged
# Tailscale in, which provisioning deliberately does not do.
#
# BOTH BRANCHES DO WORK, and the second one is the fix to a P1. Written with
# mktemp + mv -T, like /etc/gjd-remote-host above, so a failed run cannot leave
# a half-written env file that the unit would then read -- and REMOVED when
# there is no address, so a re-imaged or re-provisioned box cannot inherit the
# previous machine's.
#
# After `tailscale up`, nothing re-runs this. The step that regenerates the file
# and restarts the service, in that order, is written down in
# docs/project/hetzner-remote-server-box.md under "Tailscale".
fleet_ip=$(tailscale ip -4 2>/dev/null | head -n 1 || true)
case "$fleet_ip" in
  100.*)
    fleet_env_tmp=$(mktemp /etc/.fleet-dashboard.env.tmp.XXXXXX)
    trap 'rm -f "$fleet_env_tmp"' EXIT
    printf 'FLEET_BIND=127.0.0.1,%s\n' "$fleet_ip" > "$fleet_env_tmp"
    chown root:root "$fleet_env_tmp"
    chmod 0644 "$fleet_env_tmp"
    mv -f -T "$fleet_env_tmp" /etc/fleet-dashboard.env
    trap - EXIT
    echo "fleet dashboard binds 127.0.0.1,$fleet_ip"
    ;;
  *)
    # NO LOGIN, SO NO ADDRESS -- and any file from before is REMOVED rather than
    # left alone. Leaving it was the bug with the longer fuse: a re-imaged or
    # re-provisioned box would go on binding the PREVIOUS machine's tailnet
    # address, out of a file nothing here rewrote, and a bind it cannot take
    # kills the whole dashboard rather than one listener.
    #
    # `test -f` first rather than a bare `rm -f`: on a DIRECTORY of that name
    # `rm -f` fails, and under `set -e` that would abort the entire provisioning
    # run over a file that is only ever an optional override.
    if test -f /etc/fleet-dashboard.env; then
      rm -f /etc/fleet-dashboard.env
      echo "no tailnet address yet -- removed a stale /etc/fleet-dashboard.env"
    fi
    echo "no tailnet address yet -- fleet dashboard binds 127.0.0.1 only; after tailscale up, see docs/project/hetzner-remote-server-box.md (Tailscale) for the two commands that add the tailnet address"
    ;;
esac

systemctl daemon-reload
# THE OVERSEER ONLY. The fleet dashboard's unit is installed and deliberately
# left disabled: the page is up under scripts/tmux-job.ts and its owner asked to
# read the unit before it is ever switched on. Enabling it here would mean two
# supervisors racing for :8787 at the next boot, and the loser's failure looks
# exactly like a crash. Enable it by hand once the tmux job is stopped.
systemctl enable overseer.service
echo "overseer enabled; fleet-dashboard installed but NOT enabled (its owner's call)"

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
# The number, not the file: an EMPTY file is what vitest.config.ts treats as
# "this machine has nothing to say", so a check for existence alone would pass
# on the state that silently gives the box back the repo's own default of half
# the cores -- 8 here, and no complaint from anything.
check "test worker cap set"      'su - '"$USER_NAME"' -c "cat ~/.config/spideryarn/vitest-max-workers" | grep -qx "2"'
# Same reasoning one file along, and it matters more here: an absent or empty
# reserve file is not a smaller reserve, it is NO ADMISSION CHECK AT ALL, and
# the box goes back to being the machine that ran eighteen suites into swap.
check "test memory reserve set"  'su - '"$USER_NAME"' -c "cat ~/.config/spideryarn/vitest-memory-reserve-gb" | grep -qx "4"'
check "node is the wanted major" 'su - '"$USER_NAME"' -c "node -v" | grep -q "^v${GJD_NODE_MAJOR}\."'
check "npm present"              'su - '"$USER_NAME"' -c "command -v npm"'
# The check that would have caught the bug. `claude --version` stayed green for
# two days on a box whose updater could not write a byte, because running and
# being able to replace yourself are different facts and only one of them was
# ever asserted.
#
# It asserts WRITABILITY OF THE DIRECTORIES, and as the user. An earlier version
# of this check tested `stat -c %U` on the launcher and the binary, which was
# the same mistake one level in: owning a symlink does not let you repoint it,
# the parent directory does -- and a user-owned binary inside an unwritable
# `versions/` cannot be joined by the next version. GPT Sol caught it, having
# been handed this file's own postmortem about asserting the wrong property.
#
# `test -w` as root is meaningless (root passes on almost anything), hence `su -`.
# `-x` as well as `-w`: mutating a directory needs both, and a directory with
# the execute bit off is writable-but-unusable.
check "claude can auto-update (user can rewrite its install)" 'timeout 30 su - '"$USER_NAME"' -c "for d in /home/'"$USER_NAME"'/.local/bin /home/'"$USER_NAME"'/.local/share/claude/versions; do test -d \"\$d\" && test -w \"\$d\" && test -x \"\$d\" || exit 1; done"'
# ...and that the two links still point where the updater will move them. Both
# were assumed by the check above and neither was tested: a launcher replaced by
# a stray regular file, or a /usr/local/bin symlink left pointing at the old npm
# path, both leave the directories perfectly writable.
check "claude launcher points into the versions dir" 'case "$(readlink -f /home/'"$USER_NAME"'/.local/bin/claude)" in /home/'"$USER_NAME"'/.local/share/claude/versions/*) true ;; *) false ;; esac'
check "/usr/local/bin/claude points at that launcher" 'test "$(readlink /usr/local/bin/claude)" = "/home/'"$USER_NAME"'/.local/bin/claude"'
# And that the npm-global copy has not come back. A re-run of an OLD
# provision.sh would resurrect it, and it would sit there winning nothing while
# /usr/local/bin points at the native one -- two installs, one of them stale,
# which is what `claude doctor` warns about.
#
# `npm root -g` rather than the literal /usr/lib/node_modules: the whole bug was
# that npm's prefix here is computed rather than chosen, so hardcoding today's
# answer would quietly stop checking anything if NodeSource ever changed it.
check "no npm-global claude beside the native one" 'root=$(npm root -g) && test -n "$root" && ! test -e "$root/@anthropic-ai/claude-code"'
# The file gjd-remote reads its address out of, checked as the READER requires
# it and not merely as "a file is there": a regular file (not a symlink, not a
# directory), root-owned, 0644, holding exactly one address and one newline.
# `stat -c` prints all four in one string so a single check covers the lot and a
# FAIL names what it actually found.
check "gjd-remote host file is a root-owned 0644 regular file" \
  'test "$(stat -c "%F %U %a" /etc/gjd-remote-host)" = "regular file root 644"'
# BYTE FOR BYTE, through cmp, and not `test "$(cat …)" = …`. Command
# substitution DISCARDS NUL BYTES: a file holding `127.0.0.1\0\n` gives $(cat)
# `127.0.0.1` and `wc -l` 1, so the string form passed a file the TypeScript
# reader refuses -- established by writing exactly that file. This repo has
# already lost time to NUL bytes that grep could not see.
check "gjd-remote host file holds exactly one address" \
  "printf '127.0.0.1\\n' | cmp -s - /etc/gjd-remote-host"
# ...and the export it replaced is gone, so there is one answer to the question.
#
# `-L` as well as `-e`: `test -e` follows the link, so a DANGLING symlink reads
# as absent while the entry is still sitting there -- and the day its target
# appeared, login shells would have the old answer back without provisioning
# having changed anything.
check "no leftover GJD_REMOTE_HOST export" \
  '! test -e /etc/profile.d/gjd-remote-loopback.sh && ! test -L /etc/profile.d/gjd-remote-loopback.sh'
# The loopback, end to end and as the user -- not "the key file exists". Three
# separate things have to be true at once (a key, a line in authorized_keys, a
# Host block that makes ssh actually OFFER a non-default key name), each of them
# present-looking while the connection still fails, so the only check worth
# having is the connection. BatchMode is what stops a broken one hanging on a
# password prompt until the run times out.
#
# THE ADDRESS COMES OUT OF THE FILE, not out of a second copy of 127.0.0.1
# written here. A hardcoded literal would let the file say one thing and this
# check prove another -- the file could hold a syntactically fine PUBLIC address,
# pass both checks above, and this probe would still be testing the loopback that
# `Host 127.0.0.1` covers. Then the tool would use an address ssh has no identity
# for, and nothing here would have noticed.
#
# THE `case` IS LOAD-BEARING, and `test -n` was not enough. The address is read
# here and then spliced into the string `su -c` hands to ANOTHER shell, which
# parses it again: a file holding `not-a-host; true #` becomes
# `ssh … not-a-host; true # hostname`, and the check reports ok having tested no
# loopback at all -- established by reproducing it with the transport forced to
# fail. So the value is held to the same characters scripts/gjd-remote-host.ts
# allows, in the same order, before anything interpolates it: an alphanumeric
# first, then letters, digits, dot, underscore and dash.
#
# LC_ALL=C, because a bash range expression collates by LOCALE and the box runs
# en_GB.UTF-8, where `A-Za-z` also admits the dotted and dotless Turkish i --
# `Ihost` and `Ihost` passed the guard and would be refused by the reader. It is
# set inside the check, which check() runs in a subshell of its own, so nothing
# else in the run sees it.
check "gjd-remote loopback ssh works, at the address that file names" \
  'LC_ALL=C; addr=$(cat /etc/gjd-remote-host) && case "$addr" in ""|[!A-Za-z0-9]*|*[!A-Za-z0-9._-]*) false ;; *) true ;; esac && timeout 20 su - '"$USER_NAME"' -c "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new $addr hostname"'
# Claude, over that same loopback -- deliberately AFTER it, so a broken ssh is
# reported as a broken ssh rather than as a missing Claude.
#
# `claude runs` used to be a LOGIN shell, and it passed throughout the
# npm-prefix bug. What runs the work is non-interactive: the tmux job scripts,
# and the `ssh <box> claude mcp list` behind `gjd-remote doctor`, source neither
# .profile nor .bashrc and get a stock PATH with no ~/.local/bin in it. So this
# is that path itself rather than an imitation of it. A claude only a login
# shell can find leaves every tmux session with no Claude in it -- the same
# wrong-tree failure gjd-remote's own job guards exist to catch.
#
# `ssh -n`: check() has no `</dev/null` of its own the way run() does, and ssh
# forwards stdin, so without it this swallows the rest of whatever is feeding
# the script and the run dies further down somewhere unrelated. Found by doing
# exactly that to a heredoc while testing these three checks.
# Captured and then matched, never piped into grep: check() runs without
# pipefail, so through a pipe the verdict would be grep's alone and a claude
# that printed its version and then died -- or an ssh that timed out after
# printing it -- would pass. The statusline check below says the same thing for
# the same reason; this file has been bitten by it before.
check "claude runs over non-interactive ssh" 'out=$(timeout 30 su - '"$USER_NAME"' -c "ssh -n -o BatchMode=yes -o StrictHostKeyChecking=accept-new 127.0.0.1 claude --version") && case "$out" in *"(Claude Code)"*) true ;; *) false ;; esac'
# The address it will use is the other half of that, and it is checked further
# up, against /etc/gjd-remote-host. There used to be a check HERE that read
# $GJD_REMOTE_HOST back out of a login shell -- deleted with the export it
# tested, and it would now fail on a correctly configured box. Its comment said
# "a login shell, because that is what a tmux session gets", which was the whole
# mistake: the login shell comes AFTER claude exits.
# Reads the value back out of the JSON rather than grepping the file for the
# key name: a merge that landed the key with the wrong value, or under the wrong
# parent, looks identical to a working one under grep.
check "claude scroll speed is 1" 'jq -er ".env.CLAUDE_CODE_SCROLL_SPEED" /home/'"$USER_NAME"'/.claude/settings.json | grep -qx "1"'
# The one check here whose failure costs hours rather than comfort -- see the
# arithmetic beside the jq that sets it. Read back out of the JSON for the same
# reason as the line above: a merge that landed `defaultMode` under the wrong
# parent looks identical to a working one under grep, and the symptom is a
# session that stalls at 3am rather than an error anybody sees.
check "claude default permission mode is auto" 'jq -er ".permissions.defaultMode" /home/'"$USER_NAME"'/.claude/settings.json | grep -qx "auto"'
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
# Asserts the OUTPUT, not just the exit status. codex ships a prebuilt platform
# binary, so the interesting failure is one that exists and does not run.
#
# Over the loopback rather than a login shell, and captured rather than piped,
# for the two reasons the claude checks above give: what runs codex is
# scripts/run-codex.ts, which spawns bare `codex` and inherits whatever PATH it
# was given -- non-interactive, no ~/.local/bin -- and a pipe would hand the
# verdict to grep alone, passing a codex that printed its version and then died.
check "codex runs over non-interactive ssh" 'out=$(timeout 60 su - '"$USER_NAME"' -c "ssh -n -o BatchMode=yes -o StrictHostKeyChecking=accept-new 127.0.0.1 codex --version") && case "$out" in codex-cli\ *) true ;; *) false ;; esac'
# The same auto-update property as claude, and it matters more here because
# `codex doctor` does not check it: it reports `install: consistent` and names
# an npm update target without ever asking whether that target is writable.
check "codex can auto-update (user can rewrite its install)" 'timeout 30 su - '"$USER_NAME"' -c "for d in /home/'"$USER_NAME"'/.local/bin /home/'"$USER_NAME"'/.codex/packages/standalone /home/'"$USER_NAME"'/.codex/packages/standalone/releases; do test -d \"\$d\" && test -w \"\$d\" && test -x \"\$d\" || exit 1; done"'
# Narrow on purpose. `standalone/*` would also match the install lock, a stray
# file, or a half-staged directory -- anything at all under the store -- so it
# would have gone on passing after the layout it is describing had stopped
# being true. The second arm is the installer's older layout, which it still
# emits when a release has no bin/ subdirectory.
check "codex launcher points at a standalone release binary" 'case "$(readlink -f /home/'"$USER_NAME"'/.local/bin/codex)" in /home/'"$USER_NAME"'/.codex/packages/standalone/releases/*/bin/codex|/home/'"$USER_NAME"'/.codex/packages/standalone/releases/*/codex) true ;; *) false ;; esac'
check "/usr/local/bin/codex points at that launcher" 'test "$(readlink /usr/local/bin/codex)" = "/home/'"$USER_NAME"'/.local/bin/codex"'
# Unlike claude's single self-contained executable, codex resolves ripgrep and
# its resources out of its install tree at RUNTIME, so a leftover npm copy is
# not merely stale -- it is a second tree that a stray PATH could still reach.
check "no npm-global codex beside the native one" 'root=$(npm root -g) && test -n "$root" && ! test -e "$root/@openai/codex"'
# Every repo we run codex in carries a `[permissions]` table in its own
# `.codex/config.toml` -- the review profile scripts/run-codex.ts selects. A
# codex whose permissions schema has moved does not degrade there, it STOPS:
# codex refuses to load *any* config in a directory whose project config it
# cannot accept, so every `codex` and `codex exec` in the checkout exits 1
# before the model is reached, while `codex --version` above goes on passing.
# That is what happened on 2026-09-05 -- a table without `default_permissions`
# became an error, on 0.150.1 and 0.153.4 alike -- and nothing on the box said
# so. This check is what would have caught it here.
#
# BOTH DIRECTIONS, and the negative one is the load-bearing half: without it the
# check would pass just as happily on a codex that had stopped reading project
# configs at all, which is the same silent nothing it is here to detect.
#
# What it does NOT prove, both GPT Sol's, 2026-09-05: the probe's project is
# deliberately trusted, so this is schema compatibility and not the operational
# readiness of any checkout (an untrusted one reads no project config at all --
# scripts/run-codex.ts is where that is caught); and it runs at provisioning
# time only, so a later `codex update` can still break the schema underneath a
# box that passed.
CODEX_CFG_PROBE=$(mktemp)
cat > "$CODEX_CFG_PROBE" <<'PROBE'
set -eu
# `pwd -P` because the trust entry below is matched against the path codex sees:
# on macOS `mktemp -d` hands back a /var symlink to /private/var, the two do not
# compare equal, and an untrusted probe reads no config at all -- which fails the
# negative arm rather than passing quietly, exactly as it should.
d=$(cd "$(mktemp -d)" && pwd -P); h=$(mktemp -d)
trap 'rm -rf "$d" "$h"' EXIT
mkdir -p "$d/.codex"
# Its OWN CODEX_HOME: a project's `.codex/config.toml` is read only when the
# project is trusted, and the real ~/.codex is not a check's to write.
printf '[projects."%s"]\ntrust_level = "trusted"\n' "$d" > "$h/config.toml"
cd "$d"
# The structured verdict rather than the report's prose: `codex doctor` exits 1
# on an unauthenticated box whatever the config says -- and provisioning runs
# before the human logs codex in -- so the exit code cannot be the signal. The
# `select` makes a schema change fail CLOSED: no schemaVersion 1, no verdict, no
# pass. GPT Sol's, 2026-09-05; `--json` measured on 0.152.1 and 0.153.4.
verdict() {
  CODEX_HOME="$h" timeout 60 codex doctor --json 2>/dev/null \
    | jq -er 'select(.schemaVersion == 1) | .checks["config.load"].status'
}
# The shape the repos actually carry, `:workspace_roots` included, so a codex
# that kept `default_permissions` and dropped the relative-path token still
# fails here. It is a COPY of that shape, not the file itself -- provisioning
# has no checkout -- so .codex/config.toml stays the authority on the real one.
printf 'default_permissions = ":workspace"\n[permissions.review.filesystem]\n"/" = "read"\n"/tmp" = "write"\n[permissions.review.filesystem.":workspace_roots"]\n"node_modules/.cache" = "write"\n' > "$d/.codex/config.toml"
test "$(verdict)" = ok
printf '[permissions.review.filesystem]\n"/" = "read"\n' > "$d/.codex/config.toml"
test "$(verdict)" = fail
PROBE
chmod 0644 "$CODEX_CFG_PROBE"
check "codex accepts a repo-shaped [permissions] config" 'timeout 180 su - '"$USER_NAME"' -c "bash '"$CODEX_CFG_PROBE"'"'
rm -f "$CODEX_CFG_PROBE"
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
# Deliberately not a check on `tailscale status` -- its output and exit code differ once a box is
# logged in versus not, and login is a human step this script never takes, so a check that
# assumed either state would be wrong about the other. What provisioning owns is that the daemon
# exists, is enabled to survive a reboot, and is running; whether it has joined the tailnet is
# gjd-remote doctor's to check, once logging in is something an operator can have done.
check "tailscale binary runs"    'timeout 10 su - '"$USER_NAME"' -c "tailscale version"'
check "tailscaled enabled"       'systemctl is-enabled tailscaled | grep -qx enabled'
check "tailscaled running"       'systemctl is-active tailscaled | grep -qx active'
# The box's own services. Deliberately NOT `is-active`: provisioning enables
# them and does not start them (it does not create the checkout they run from),
# so a running check would be red on a correctly-provisioned fresh box and would
# stop being read.
#
# THE SYMLINK IS THE POINT. `is-enabled` alone says `enabled` for a systemd USER
# unit too, and a user unit does not start at boot unless lingering is on --
# which is the whole failure this stage exists to rule out. The presence of
# multi-user.target.wants/<unit> is what says a SYSTEM unit will come up on the
# way to a normal boot, and it is the one thing a user unit could never show.
check "overseer unit installed"  'test -f /etc/systemd/system/overseer.service'
check "overseer enabled"         'systemctl is-enabled overseer.service | grep -qx enabled'
check "overseer starts at boot"  'test -L /etc/systemd/system/multi-user.target.wants/overseer.service'
check "overseer runs as $USER_NAME" 'systemctl show -p User --value overseer.service | grep -qx '"$USER_NAME"''
check "overseer restarts always" 'systemctl show -p Restart --value overseer.service | grep -qx always'
# Ask systemd what it PARSED, not what the file says: a typo in the placeholder
# substitution above would leave a plausible-looking file and an ExecStart
# systemd could not use. And no worktree in it, ever -- `git worktree remove`
# deletes those, which is how the tmux-job predecessors used to vanish.
check "overseer ExecStart is in the primary checkout" 'out=$(systemctl show -p ExecStart --value overseer.service); case "$out" in *"/home/'"$USER_NAME"'/code/spideryarn2/"*worktrees*) false ;; *"/home/'"$USER_NAME"'/code/spideryarn2/"*) true ;; *) false ;; esac'
# The dashboard's unit is installed and NOT enabled -- see the comment where it
# is written. So there is no boot-symlink check here, deliberately: it would be
# red on a correctly-provisioned box, and a red check nobody expects to be green
# is how a report stops being read. What is asserted is that systemd can PARSE
# the file, so the day somebody enables it there is nothing left to discover.
check "fleet dashboard unit installed" 'test -f /etc/systemd/system/fleet-dashboard.service'
check "fleet dashboard unit parses"    'systemd-analyze verify /etc/systemd/system/fleet-dashboard.service'
check "fleet dashboard runs as $USER_NAME" 'systemctl show -p User --value fleet-dashboard.service | grep -qx '"$USER_NAME"''
check "fleet dashboard restarts always" 'systemctl show -p Restart --value fleet-dashboard.service | grep -qx always'
check "fleet dashboard ExecStart is in the primary checkout" 'out=$(systemctl show -p ExecStart --value fleet-dashboard.service); case "$out" in *"/home/'"$USER_NAME"'/code/spideryarn2/"*worktrees*) false ;; *"/home/'"$USER_NAME"'/code/spideryarn2/"*) true ;; *) false ;; esac'
# Never the wildcard, on a box whose firewall is the only other thing in the
# way. `parseBinds` refuses one at startup; this refuses one at provisioning
# time, when a person is still reading the output.
check "fleet dashboard binds no wildcard" '! grep -q "0\.0\.0\.0" /etc/systemd/system/fleet-dashboard.service && { ! test -f /etc/fleet-dashboard.env || ! grep -q "0\.0\.0\.0" /etc/fleet-dashboard.env; }'
# Loopback alone is reachable from the box and not from the phone the tailnet
# address exists for -- so on a logged-in box the pair must be there. On a box
# nobody has logged in yet, the correct state is the OPPOSITE: no file at all,
# and the unit's loopback-only fallback. Both halves are asserted, because a
# leftover file naming another machine's address is one the server cannot bind,
# and a bind it cannot take takes the whole dashboard down.
#
# Asked of `tailscale ip -4`, the same source the file is written from, rather
# than of an address baked in here: this check has to be right on the next box
# too. This version used to be the second half only, and it would now go red on
# every correctly-provisioned box that had not been logged in -- a red check
# nobody expects to be green is how a report stops being read.
check "fleet dashboard binds the tailnet once tailscale is logged in" 'fleet_now=$(tailscale ip -4 2>/dev/null | head -n 1 || true); case "$fleet_now" in 100.*) test "$(cat /etc/fleet-dashboard.env)" = "FLEET_BIND=127.0.0.1,$fleet_now" ;; *) ! test -e /etc/fleet-dashboard.env ;; esac'
# FLEET_ACT_ENABLED gates enacted actions -- removing a worktree, killing a
# session -- and stays unset until routes-actions.ts has had its GPT Sol review.
# A unit that named it, even as false, is one edit away from enabling it, and a
# unit file is exactly the sort of file somebody skims and completes.
check "fleet dashboard does not name FLEET_ACT_ENABLED" '! grep -q FLEET_ACT_ENABLED /etc/systemd/system/fleet-dashboard.service && { ! test -f /etc/fleet-dashboard.env || ! grep -q FLEET_ACT_ENABLED /etc/fleet-dashboard.env; }'
check "supabase cli pinned"      'timeout 30 su - '"$USER_NAME"' -c "supabase --version" | grep -qx "'"$SUPABASE_VERSION"'"'
# The editor, in the three places that name it -- because they come apart. The
# package can be present while $EDITOR still says nothing, and both can be right
# while /usr/bin/editor still opens nano.
#
# Captured rather than piped, for the reason the claude and codex checks give
# above: check() runs without pipefail, so through a pipe an emacs that printed
# its version and then died would still pass on grep's verdict alone.
check "emacs runs"               'out=$(timeout 60 su - '"$USER_NAME"' -c "emacs --version") && case "$out" in "GNU Emacs "*) true ;; *) false ;; esac'
check "EDITOR is emacs -nw"      'su - '"$USER_NAME"' -c "echo \$EDITOR" | grep -qx "emacs -nw"'
# Runs /usr/bin/editor and asks what answered, rather than reading the symlink:
# a link is only evidence about a file, and this is the question sudoedit asks.
check "editor alternative is emacs" 'out=$(/usr/bin/editor --version 2>&1) && case "$out" in "GNU Emacs "*) true ;; *) false ;; esac'
check "git core.editor"          'su - '"$USER_NAME"' -c "git config --global core.editor" | grep -qx "emacs -nw"'
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
# The one human step this run deliberately left undone -- see "=== tailscale ===" above for why
# `tailscale up` is never run by this script. Printed every time, like cloud-init's own
# final_message: harmless to see again once it is already done, and the only way an operator who
# skipped it the first time finds out.
echo "Next (if not already done): sudo tailscale up --hostname=spideryarn-box --operator=$USER_NAME"
