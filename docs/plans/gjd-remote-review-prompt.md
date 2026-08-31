# Review: a cloud-init that failed on first build, its fix, and a CLI

Second-round review. The infrastructure below was reviewed by you before first apply; I fixed
everything you raised, applied it, and **it failed on the real machine**. This round is about the
fix for that failure, plus a new CLI, plus anything the first round missed.

## What actually happened

The server built fine. cloud-init ran, reported `done`, and provisioning died partway with this at
the end of `/var/log/provision.log`:

```
Reading state information...
nodejs is already the newest version (18.19.1+dfsg-6ubuntu5).
nodejs set to manually installed.
0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
/usr/local/sbin/provision.sh: line 55: npm: command not found
```

My reading: Ubuntu 24.04's own `nodejs` 18 was already present, so `apt-get install nodejs` was a
no-op — apt called 18.19.1 "newest", meaning NodeSource's repo was not providing a candidate at
that moment. Ubuntu's `nodejs` package does not ship `npm` (separate package), so the next line
failed and `set -e` ended the run. Nothing after line 55 happened: no Claude Code, no Chrome, no
Playwright, no MCP servers, no verification block.

**I do not know why the NodeSource repo was not in play**, and that bothers me. The previous step
piped `https://deb.nodesource.com/setup_26.x` into bash and did not fail, so it exited 0. I also do
not know what pre-installed Ubuntu's nodejs. I would like your view on both.

I also misdiagnosed it before seeing the log: CPU was flat zero for 35 minutes and I concluded it
had hung, when in fact it had already failed and exited. I had hardened everything against hanging
(timeouts, closed stdin, bounded apt locks) — useful, but not the bug.

## The fix

Add the NodeSource repo explicitly rather than by piping a setup script; pin it above the distro so
apt cannot prefer an already-installed older package; then ASSERT the resulting node major and the
presence of npm and claude, rather than assuming.

## What I want attacked, hardest first

1. **Is the Node fix actually right?** Is `nodistro` the correct suite for the NodeSource apt repo
   today? Is the pin syntax right and will `origin deb.nodesource.com` actually match? Would a
   pre-installed distro nodejs still win, or block the upgrade some other way? Should I be purging
   the distro package instead, and what would that drag out with it? Is there a better approach
   entirely for a machine that must reliably get one specific Node major — fnm, the official
   tarball, something else?
2. **What else in this file has the same shape** — a command that can succeed while doing nothing,
   leaving a later step to fail or, worse, not fail? I want the whole file audited for that class
   specifically. The `check` block at the end is my attempt at a net; tell me where it has holes.
3. **The rebuild path.** cloud-init runs once per instance, so the fix requires destroying and
   recreating the server while keeping the volume. Walk the rebuild: the volume already holds a
   populated `/home` from the failed build. Does the seed-vs-rebuild branch do the right thing? Can
   the bind mount hide the new `authorized_keys` and lock us out?
4. **`scripts/gjd-remote.ts`** — a CLI on a Mac driving tmux over ssh/mosh. Attack the quoting
   across the ssh boundary, the heredoc that writes a job script remotely, the slug validation, and
   anything that could attach to or kill the wrong session. Note that tmux target matching is a
   prefix match, which is why `=name` appears everywhere.
5. Anything you raised last round that I fixed badly.

Ranked findings, smallest correct fix for each, and mark certain vs speculative. Do not rewrite the
files wholesale.

## The files

### `infra/hetzner/cloud-init.yaml`

```
#cloud-config
# Runs once, on first boot. Must be safe to run again on a rebuilt server whose
# volume already holds a populated /home.
#
# ESCAPING: this file is rendered by Terraform's templatefile(), which consumes
# dollar-brace interpolation ANYWHERE in the file, comments included. Terraform
# variables are written unescaped; every SHELL brace must be doubled. A missed
# one is a plan-time error, not a silent substitution — which is the good case.
# The first version of this file got that wrong in this very comment.

locale: en_GB.UTF-8      # mosh refuses to run without a UTF-8 locale.
timezone: ${timezone}
package_update: true
package_upgrade: true
ssh_pwauth: false        # belt to the braces of the sshd drop-in below.

users:
  - name: ${username}
    groups: [sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${ssh_public_key}

packages:
  - bubblewrap
  - build-essential
  - ca-certificates
  - curl
  - fail2ban
  - git
  - gnupg
  - htop
  - jq
  - mosh
  - novnc
  - rsync
  - ripgrep
  - socat
  - tmux
  - unattended-upgrades
  - unzip
  - websockify
  - x11vnc
  - xvfb

write_files:
  # 00-, not 99-. OpenSSH takes the FIRST value it sees for most directives and
  # Ubuntu reads sshd_config.d lexically, so a 99- file loses to the 50-cloud-init
  # one that ships with the image.
  - path: /etc/ssh/sshd_config.d/00-hardening.conf
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      X11Forwarding no
      MaxAuthTries 3

  - path: /etc/fail2ban/jail.d/sshd.local
    content: |
      [sshd]
      enabled = true
      maxretry = 5
      bantime = 1h

  - path: /etc/apt/apt.conf.d/20auto-upgrades
    content: |
      APT::Periodic::Update-Package-Lists "1";
      APT::Periodic::Unattended-Upgrade "1";

  - path: /usr/local/bin/start-vnc
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      export DISPLAY=:99
      pgrep -f "Xvfb :99" >/dev/null || (Xvfb :99 -screen 0 1920x1080x24 >/dev/null 2>&1 &)
      sleep 1
      pgrep -f "x11vnc .*:99" >/dev/null || (x11vnc -display :99 -localhost -nopw -forever -shared -quiet >/dev/null 2>&1 &)
      pgrep -f "websockify" >/dev/null || (websockify --web=/usr/share/novnc 127.0.0.1:6080 localhost:5900 >/dev/null 2>&1 &)
      echo "Tunnel:  ssh -L 6080:localhost:6080 ${username}@<ip>"
      echo "Open:    http://localhost:6080/vnc.html"

  - path: /etc/profile.d/display.sh
    content: |
      export DISPLAY=:99

  # Ubuntu 24.04+ ships an AppArmor policy that stops bubblewrap creating the
  # user namespaces it needs, so Claude Code's sandbox runtime fails to start
  # and says nothing useful about why. Written now so the option is there the
  # day we decide to isolate sessions; harmless until then.
  - path: /etc/apparmor.d/bwrap
    content: |
      abi <abi/4.0>,
      include <tunables/global>
      profile bwrap /usr/bin/bwrap flags=(unconfined) {
        userns,
        include if exists <local/bwrap>
      }

  # One script, fail-fast, verified at the end. The previous version was twelve
  # loose runcmd entries with no `set -e` and several `|| true`, so a failed npm
  # install was followed by a successful sshd restart and cloud-init reported
  # success. That is the failure mode this repo has a doc about.
  - path: /usr/local/sbin/provision.sh
    permissions: "0700"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail

      USER_NAME=${username}
      DEV=/dev/disk/by-id/scsi-0HC_Volume_${volume_id}

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
        echo "--- $what (timeout $${secs}s)"
        if ! timeout --kill-after=30 "$secs" "$@" </dev/null; then
          echo "FATAL: '$what' failed or timed out after $${secs}s" >&2
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
        fallocate -l ${swap_gb}G /swapfile
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
      run 60 "nodesource key" bash -c 'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/nodesource.gpg'
      echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${node_major}.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list
      printf 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n' \
        > /etc/apt/preferences.d/nodesource
      run 180 "apt update (nodesource)" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y update'
      run 300 "install nodejs" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install nodejs'

      # Assert rather than assume. Both of these were true on the failed build:
      # a nodejs existed, and it was the wrong one with no npm beside it.
      NODE_V=$(node -v 2>/dev/null || echo none)
      case "$NODE_V" in
        v${node_major}.*) echo "node $NODE_V" ;;
        *) echo "FATAL: wanted node v${node_major}.x, got $NODE_V - the NodeSource repo did not win" >&2; exit 1 ;;
      esac
      command -v npm >/dev/null || { echo "FATAL: node installed but npm is missing" >&2; exit 1; }

      run 300 "install claude code" npm install -g @anthropic-ai/claude-code
      command -v claude >/dev/null || { echo "FATAL: npm reported success but claude is not on PATH" >&2; exit 1; }

      echo "=== chrome ==="
      # chrome-devtools-mcp needs real Chrome stable, not Playwright's Chromium.
      # amd64 only: this block is wrong on an ARM (CAX) server.
      run 60 "chrome signing key" bash -c 'curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg'
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list
      run 180 "apt update" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y update'
      run 300 "install chrome" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install google-chrome-stable'

      echo "=== playwright ==="
      run 420 "playwright system deps" npx --yes playwright@latest install-deps chromium
      run 420 "playwright chromium" su - "$USER_NAME" -c 'npx --yes playwright@latest install chromium </dev/null'

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
      # Prime suspect for the first build's hang: claude has never run for this
      # user, so any first-run prompt here waits on stdin forever at zero CPU.
      # stdin closed AND a timeout, because either alone would have let it hang.
      add_mcp() {
        name=$1; shift
        if ! timeout 60 su - "$USER_NAME" -c "claude mcp add --env '$CAP' --scope user $name -- $* </dev/null" </dev/null; then
          echo "WARN: capped add failed for $name; retrying uncapped" >&2
          timeout 60 su - "$USER_NAME" -c "claude mcp add --scope user $name -- $* </dev/null" </dev/null
        fi
      }
      add_mcp playwright "npx -y @playwright/mcp@$PW_MCP --headless --isolated"
      add_mcp chrome-devtools "npx -y chrome-devtools-mcp@$CDT_MCP --headless"

      echo "=== ssh ==="
      systemctl start apt-daily.timer apt-daily-upgrade.timer 2>/dev/null || true
      sshd -t
      systemctl enable --now fail2ban
      systemctl restart ssh || systemctl restart sshd

      echo "=== verify ==="
      # Every one of these has a way of silently not happening.
      fail=0
      check() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
      check "/home is the volume"      'mountpoint -q /home'
      check "swap active"              'swapon --show | grep -q swapfile'
      check "claude installed"         'command -v claude'
      check "node is the wanted major" 'node -v | grep -q "^v${node_major}\."'
      check "npm present"              'command -v npm'
      check "chrome installed"         'command -v google-chrome'
      check "playwright chromium"      'su - '"$USER_NAME"' -c "ls ~/.cache/ms-playwright" | grep -q chromium'
      check "playwright mcp"           'su - '"$USER_NAME"' -c "claude mcp list" | grep -q playwright'
      check "devtools mcp"             'su - '"$USER_NAME"' -c "claude mcp list" | grep -q chrome-devtools'
      check "tmux config"              'test -f /home/'"$USER_NAME"'/.tmux.conf'
      check "sshd config valid"        'sshd -t'
      check "password auth off"        'sshd -T | grep -qi "^passwordauthentication no"'
      check "root login off"           'sshd -T | grep -qi "^permitrootlogin no"'
      if [ "$fail" -ne 0 ]; then
        echo "PROVISION INCOMPLETE — see above" >&2
        exit 1
      fi
      echo "PROVISION OK"

runcmd:
  - bash /usr/local/sbin/provision.sh 2>&1 | tee /var/log/provision.log

final_message: |
  Box up after $UPTIME s.
  Check provisioning actually succeeded:  sudo tail -20 /var/log/provision.log
  It must end with PROVISION OK. Then run `claude` and log in with /login.
```

### `infra/hetzner/main.tf`

```
# The 24/7 box that Claude Code sessions run on.
#
# Shape: disposable compute, persistent volume. The server is cattle — destroy
# and recreate it freely. Everything that matters lives on the volume, which is
# bind-mounted over /home, so a rebuilt server comes back up as itself.
#
# Why that shape: CX53 is the top of Hetzner's CX line, so there is no rung
# above 32GB on this plan. Growing means swapping the server out from under the
# volume, which is only cheap if the server was never a pet.
# See docs/research/remote-server-for-claude-code.md.

terraform {
  required_version = ">= 1.5"
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
  }
}

# Token comes from the HCLOUD_TOKEN environment variable, never a file.
# `hcloud context create` stores it in the CLI's own config; export it for
# Terraform with:  export HCLOUD_TOKEN=$(hcloud context active --token)
provider "hcloud" {}

# Every server the token can see. Used only by the guard below, which is the
# one thing standing between a mistyped context and building inside somebody
# else's Hetzner project.
data "hcloud_servers" "existing" {}

resource "hcloud_ssh_key" "me" {
  name       = "${var.name}-key"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

# Formatted once, here, at creation. Deliberately NOT formatted in cloud-init:
# a mkfs that runs on every boot is one bad conditional away from wiping the
# only copy of the work.
resource "hcloud_volume" "data" {
  name     = "${var.name}-data"
  size     = var.volume_size_gb
  location = var.location
  format   = "ext4"

  # Two locks, because they cover different holes. prevent_destroy stops
  # Terraform replacing or destroying it — but only while this block is present,
  # and it makes a whole-module `terraform destroy` fail at plan time rather
  # than sparing the volume. delete_protection is enforced by Hetzner itself, so
  # it also covers someone deleting the volume in the console or via the API.
  # Retiring the data means deliberately removing both, in their own commit.
  delete_protection = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_firewall" "box" {
  name = "${var.name}-fw"

  rule {
    description = "SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.ssh_source_ips
  }

  # mosh picks a UDP port in this range per session. Without it mosh appears to
  # connect and then hangs forever with no error, which reads as a mosh bug.
  rule {
    description = "mosh"
    direction   = "in"
    protocol    = "udp"
    port        = "60000-61000"
    source_ips  = var.ssh_source_ips
  }

  rule {
    description = "ping"
    direction   = "in"
    protocol    = "icmp"
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  # No inbound rule for the web server or noVNC on purpose. Both are reached
  # over an SSH tunnel, so neither needs a hole in the firewall.
}

resource "hcloud_server" "box" {
  name        = var.name
  server_type = var.server_type
  image       = var.image
  location    = var.location

  ssh_keys     = [hcloud_ssh_key.me.id]
  firewall_ids = [hcloud_firewall.box.id]

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    username       = var.username
    volume_id      = hcloud_volume.data.id
    timezone       = var.timezone
    node_major     = var.node_major
    swap_gb        = var.swap_gb
    ssh_public_key = trimspace(file(pathexpand(var.ssh_public_key_path)))
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # A Hetzner API token is scoped to ONE project, and that scope is the blast
  # radius. Greg's machine also holds a token for an unrelated client account
  # (the "droid-vm" context), and the two differ by one word in an env var.
  #
  # So: refuse to build in a project that already contains servers we did not
  # create. A project of our own is empty, which passes. Another project is not,
  # which fails at PLAN time, before anything exists and before anything of
  # theirs is at risk. A precondition is used rather than a `check` block on
  # purpose — checks only warn, and a warning is not a guard.
  #
  # If this box ever legitimately shares a project, delete this block on purpose.
  lifecycle {
    precondition {
      condition = length([
        for s in data.hcloud_servers.existing.servers : s.name if s.name != var.name
      ]) == 0
      error_message = "Refusing to apply: this Hetzner project already contains servers that are not '${var.name}' (${join(", ", [for s in data.hcloud_servers.existing.servers : s.name if s.name != var.name])}). The likeliest cause is that HCLOUD_TOKEN belongs to another account or project - run `hcloud context active` and check it says what you expect."
    }
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.box.id

  # We write our own fstab entries in cloud-init, with nofail, so a volume that
  # fails to attach leaves a reachable box rather than an unbootable one.
  #
  # Note the ordering this forces: the attachment happens AFTER the server is
  # created and has begun booting, so cloud-init genuinely races it. provision.sh
  # waits up to 300s for the device and then fails loudly rather than carrying
  # on without it.
  automount = false
}
```

### `scripts/gjd-remote.ts`

```
#!/usr/bin/env -S npx tsx
/**
 * `gjd-remote` — drive Claude Code sessions running in tmux on the Hetzner server.
 *
 * The design, and the reasons behind each piece, are in
 * docs/research/remote-server-tmux-mosh.md. The short version: one tmux session
 * per Claude session, mosh as transport with ssh as fallback, and tmux is not
 * optional because mosh cannot reattach — a client that dies leaves a session
 * nobody could otherwise get back into.
 *
 * No argument-parsing dependency, deliberately. Commander was the researched
 * recommendation and would be the right call for a bigger surface, but adding it
 * means editing package.json, which a peer had uncommitted work in at the time.
 * node:util's parseArgs covers six subcommands without touching a shared file.
 * Swapping in Commander later is contained to main().
 */
import { execFileSync, spawnSync } from "node:child_process";
import { parseArgs, styleText } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USER = "greg";

/** tmux session names travel through shell commands across an ssh boundary, so
 *  nothing surprising may ever reach a shell. Same slug rule as the fleet. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const red = (s: string) => styleText("red", s);
const green = (s: string) => styleText("green", s);

function die(msg: string): never {
  console.error(red(`✗ ${msg}`));
  process.exit(1);
}

/** Single-quote for /bin/sh. The only safe way to put arbitrary text in a
 *  remote command line — and we still avoid doing it with prompts, which go
 *  through a file instead. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/**
 * The address comes from Terraform state, never a constant: it changes on every
 * rebuild, and a hardcoded IP would be wrong exactly when you most need it.
 */
function host(): string {
  if (process.env.GJD_REMOTE_HOST) return process.env.GJD_REMOTE_HOST;
  try {
    const out = execFileSync("tofu", ["-chdir=" + path.join(REPO, "infra/hetzner"), "output", "-json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ip = JSON.parse(out)?.ipv4?.value;
    if (!ip) throw new Error("no ipv4 output");
    return ip;
  } catch (err) {
    die(
      `could not read the server address from Terraform state (${(err as Error).message}).\n` +
        `  Run this from the repo, or set GJD_REMOTE_HOST=<ip> to override.`,
    );
  }
}

const HOST = () => `${USER}@${host()}`;

/** Run a command on the box over ssh and return stdout. */
function ssh(remote: string, opts: { check?: boolean } = {}): string {
  const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOST(), remote], {
    encoding: "utf8",
  });
  if (opts.check !== false && r.status !== 0) {
    die(`ssh failed (${r.status}): ${(r.stderr || "").trim() || "no output"}`);
  }
  return (r.stdout || "").trim();
}

/**
 * Is mosh actually usable right now? Networks that block UDP exist.
 *
 * The stty is load-bearing and cost someone an afternoon: script(1)'s fake pty
 * is 0x0, and mosh-server aborts on a zero-width client (`assertion s_width > 0`).
 * That failure looks exactly like a blocked firewall — two causes, one symptom.
 */
function moshWorks(): boolean {
  const probe = `stty rows 40 cols 120; exec env LANG=C.UTF-8 mosh ${HOST()} -- true`;
  const r = spawnSync("script", ["-q", "/dev/null", "sh", "-c", probe], {
    encoding: "utf8",
    timeout: 6000,
  });
  return r.status === 0;
}

/**
 * Attach to a tmux session. Three details here are not stylistic:
 *  =name  tmux target matching is a PREFIX match, so `-t fix` also matches
 *         `fix-login`. `=` demands exact. Attaching to the wrong session looks
 *         exactly like attaching to the right one until your work is missing.
 *  -d     detach other clients. mosh-servers orphaned by a laptop reboot linger
 *         as invisible attached clients holding the window at their old size.
 *  sh -c  mosh execs the remote command directly with no shell, so a bare
 *         `a || b` dies with "execvp: a || b: No such file or directory".
 */
function attachCmd(name: string, transport: "mosh" | "ssh"): string {
  const inner = `tmux attach -d -t =${name} || exec bash -l`;
  return transport === "mosh"
    ? `LANG=C.UTF-8 mosh ${HOST()} -- sh -c ${shq(inner)}`
    : `ssh -t ${HOST()} ${shq(inner)}`;
}

function attach(name: string): never {
  const transport = moshWorks() ? "mosh" : "ssh";
  if (transport === "ssh") console.error(dim("mosh unreachable, falling back to ssh"));
  const r = spawnSync("sh", ["-c", attachCmd(name, transport)], { stdio: "inherit" });
  process.exit(r.status ?? 0);
}

type Session = { name: string; created: Date; attached: boolean; windows: number };

function sessions(): Session[] {
  const out = ssh(
    `tmux ls -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}' 2>/dev/null || true`,
  );
  if (!out) return [];
  return out.split("\n").flatMap((line) => {
    const [name, created, attached, windows] = line.split("|");
    // A malformed line would otherwise become a session literally named
    // "undefined", which `resume` would then fail to attach to for reasons
    // that look nothing like the cause.
    if (!name) return [];
    return [
      {
        name,
        created: new Date(Number(created) * 1000),
        attached: attached !== "0",
        windows: Number(windows),
      },
    ];
  });
}

function age(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

// ---------------------------------------------------------------- commands

function cmdLs(): void {
  const list = sessions();
  if (list.length === 0) {
    console.log(dim("no sessions. `gjd-remote new <name>` to start one."));
    return;
  }
  const w = Math.max(4, ...list.map((s) => s.name.length));
  console.log(bold("NAME".padEnd(w) + "  AGE   WINDOWS  ATTACHED"));
  for (const s of list) {
    console.log(
      `${s.name.padEnd(w)}  ${age(s.created).padEnd(4)}  ${String(s.windows).padEnd(7)}  ${
        s.attached ? green("yes") : dim("no")
      }`,
    );
  }
}

/**
 * Create a session and start Claude Code in it.
 *
 * The prompt goes through a FILE, never a command line. It is prose: it will
 * contain quotes, backticks and newlines, and inlining it means escaping across
 * three layers (local shell → ssh → tmux → remote shell). A file means one.
 * Lifted from MindstoneRebel's fleet, whose comment reads "keeps quoting sane
 * when prompts contain prose".
 */
function cmdNew(
  name: string,
  opts: { prompt?: string | undefined; dir?: string | undefined; attach: boolean },
): void {
  if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);
  if (sessions().some((s) => s.name === name)) die(`session '${name}' already exists — 'gjd-remote resume ${name}'`);

  const dir = opts.dir ?? `/home/${USER}`;
  const promptPath = `/home/${USER}/gjd-remote/prompts/${name}.md`;
  const jobPath = `/home/${USER}/gjd-remote/jobs/${name}.sh`;

  ssh(`mkdir -p /home/${USER}/gjd-remote/prompts /home/${USER}/gjd-remote/jobs`);

  if (opts.prompt) {
    const tmp = path.join(mkdtempSync(path.join(tmpdir(), "gjd-remote-")), `${name}.md`);
    writeFileSync(tmp, opts.prompt, "utf8");
    const r = spawnSync("scp", ["-q", tmp, `${HOST()}:${promptPath}`], { encoding: "utf8" });
    if (r.status !== 0) die(`scp of the prompt failed: ${(r.stderr || "").trim()}`);
  }

  // Non-interactive ssh sources NEITHER .bashrc NOR .bash_profile, so the job
  // gets a stock PATH with no ~/.local/bin. Append, never substitute: the bug
  // that bit the fleet twice was `PATH=$PATH || default`, where the fallback
  // only fires when PATH is undefined, never when it is set-but-incomplete.
  const job = [
    `#!/usr/bin/env bash`,
    `export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:$PATH"`,
    `export LANG=C.UTF-8`,
    `cd ${shq(dir)} || cd /home/${USER}`,
    opts.prompt ? `claude ${shq("$(cat " + promptPath + ")")}` : `claude`,
    `echo`,
    `echo "--- claude exited; shell follows, session stays alive ---"`,
    `exec bash -l`,
    ``,
  ].join("\n");

  // Written via a quoted heredoc so nothing in it is expanded on the way.
  ssh(`cat > ${jobPath} <<'REMOTEJOB'\n${job}REMOTEJOB\nchmod +x ${jobPath}`);
  ssh(`tmux new-session -d -s ${name} ${shq(`bash ${jobPath}`)}`);

  console.log(green(`✓ started '${name}'`) + dim(opts.prompt ? " with a prompt" : ""));
  if (opts.attach) attach(name);
  else console.log(dim(`  gjd-remote resume ${name}`));
}

/**
 * Everything that can be checked from here, in one command — because Claude
 * Code's own shell cannot reach port 22, so an agent cannot run any of this
 * itself. Run `gjd-remote doctor` and paste the output.
 */
function cmdDoctor(): void {
  const ip = host();
  console.log(bold(`gjd-remote → ${ip}`));

  const reach = spawnSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", HOST(), "true"]);
  if (reach.status !== 0) {
    console.log(red("✗ ssh: cannot connect"));
    console.log(dim("  the server may still be booting; `hcloud server list` shows its state"));
    return;
  }
  console.log(green("✓ ssh"));

  const localMosh = spawnSync("sh", ["-c", "command -v mosh"], { encoding: "utf8" }).status === 0;
  if (!localMosh) {
    console.log(red("✗ mosh: not installed on THIS Mac") + dim("  (brew install mosh)"));
  } else {
    console.log(moshWorks() ? green("✓ mosh") : red("✗ mosh: installed both ends, but the probe failed (UDP blocked?)"));
  }

  const status = ssh(`cloud-init status 2>/dev/null || echo 'status: unknown'`, { check: false });
  console.log(`  cloud-init: ${status.replace(/^status:\s*/, "")}`);

  for (const tool of ["claude", "tmux", "mosh", "node", "google-chrome"]) {
    const found = ssh(`command -v ${tool} >/dev/null && echo yes || echo no`, { check: false });
    console.log(found === "yes" ? green(`✓ ${tool}`) : red(`✗ ${tool}`));
  }

  const provision = ssh(`sudo grep -E '^(ok|FAIL|PROVISION)' /var/log/provision.log 2>/dev/null || true`, {
    check: false,
  });
  console.log(bold("\nprovisioning:"));
  console.log(provision ? provision : red("  no verification lines — provisioning did not finish"));
  if (!provision) {
    const tail = ssh(`sudo tail -5 /var/log/provision.log 2>/dev/null || echo '(no log)'`, { check: false });
    console.log(dim("  last lines of the log:"));
    console.log(dim(tail.split("\n").map((l) => "    " + l).join("\n")));
  }

  const list = sessions();
  console.log(bold(`\nsessions: ${list.length}`));
}

// ---------------------------------------------------------------- main

const HELP = `${bold("gjd-remote")} — Claude Code sessions on the Hetzner server

  gjd-remote                      list sessions
  gjd-remote new <name>           start a session, and attach to it
       -p, --prompt TEXT          give Claude a first prompt
       -d, --dir DIR              working directory on the box
           --no-attach            create it but stay here
  gjd-remote resume [name]        reattach; no name means the newest
  gjd-remote kill <name>          end a session
  gjd-remote doctor               check the box and print what is wrong
  gjd-remote ssh                  a plain shell, no tmux
  gjd-remote tunnel               forward noVNC to http://localhost:6080/vnc.html

Sessions survive your laptop sleeping, losing wifi, or rebooting — tmux keeps
them, and mosh reconnects. They do not survive the server rebooting.

The address is read from Terraform state, so it is never stale. Override with
GJD_REMOTE_HOST=<ip>.`;

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case undefined:
    case "ls":
    case "list":
      return cmdLs();

    case "new": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          prompt: { type: "string", short: "p" },
          dir: { type: "string", short: "d" },
          "no-attach": { type: "boolean", default: false },
        },
      });
      const name = positionals[0];
      if (!name) die("gjd-remote new <name>");
      return cmdNew(name, { prompt: values.prompt, dir: values.dir, attach: !values["no-attach"] });
    }

    case "resume":
    case "attach": {
      const name = rest[0] ?? sessions().at(-1)?.name;
      if (!name) die("no sessions to attach to");
      if (!SLUG.test(name)) die(`'${name}' is not a valid session name`);
      return attach(name);
    }

    case "kill": {
      const name = rest[0];
      if (!name || !SLUG.test(name)) die("gjd-remote kill <name>");
      ssh(`tmux kill-session -t =${name}`);
      console.log(green(`✓ killed '${name}'`));
      return;
    }

    case "doctor":
      return cmdDoctor();

    case "ssh":
      process.exit(spawnSync("ssh", ["-t", HOST()], { stdio: "inherit" }).status ?? 0);

    case "tunnel":
      console.log(dim("open http://localhost:6080/vnc.html — and run `start-vnc` on the box"));
      process.exit(
        spawnSync("ssh", ["-L", "6080:localhost:6080", HOST()], { stdio: "inherit" }).status ?? 0,
      );

    case "-h":
    case "--help":
      return console.log(HELP);

    default:
      die(`unknown command '${cmd}'\n\n${HELP}`);
  }
}

main();
```

