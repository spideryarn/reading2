# Review: Terraform + cloud-init for a 24/7 Claude Code box

You are reviewing infrastructure code before it is applied for the first time. It provisions a
single Hetzner Cloud server that will run many parallel Claude Code (CLI coding agent) sessions
24 hours a day, reached over public SSH and mosh from the UK.

## What it is meant to do

- CX53 (16 shared vCPU, 32GB, 320GB) in Falkenstein, Ubuntu 24.04.
- A separate Hetzner volume, formatted by Terraform at creation, bind-mounted over `/home` so that
  repos, `~/.claude` and browser profiles survive destroying and recreating the SERVER. The server
  is meant to be disposable; the volume is not. This matters because CX53 is the top of its plan
  line, so the only route to more RAM is to swap the server out from under the volume.
- Public SSH (key only), plus mosh. The user explicitly chose public SSH over Tailscale.
- No backups, by explicit choice: all code is pushed to a remote git repo.
- Playwright MCP and chrome-devtools-mcp installed for browser automation; Xvfb + x11vnc + noVNC
  bound to localhost for occasional human viewing over an SSH tunnel.

## What I most want you to attack

Rank findings by how badly they bite. I am most worried about these, in order:

1. **Lock-out.** Anything that could leave the user unable to SSH in: sshd hardening applied before
   the key is in place, the bind mount hiding the authorized_keys that cloud-init just wrote, an
   fstab entry that makes the box unbootable, firewall rules that omit something needed.
2. **Data loss.** Anything that could destroy the volume's contents. I removed every `mkfs` from
   cloud-init deliberately and let Terraform format once at creation — check I have not left a path
   that reformats, and that `prevent_destroy` actually protects what I think it does.
3. **Terraform templatefile escaping.** `cloud-init.yaml` is rendered through `templatefile()`,
   which consumes `${...}`. Every SHELL brace must be doubled as `$${...}`. I believe I avoided
   braces in shell entirely, but a missed one renders to an empty string and fails silently at
   boot rather than at plan time. Check every `$` in the file.
4. **Idempotency and rebuild correctness.** cloud-init must be safe on a rebuilt server whose
   volume already holds a populated `/home`. Walk the first-boot path and the rebuild path
   separately and tell me where they diverge wrongly.
5. **Ordering.** cloud-init runs users -> write_files -> runcmd. Does anything depend on state that
   does not exist yet? In particular: is the bind mount in place before Playwright installs
   browsers into the user's home, and before the MCP servers write their config?
6. **mosh.** The firewall opens UDP 60000-61000. Is that right and sufficient?
7. **Correctness of the Terraform itself** — will `terraform apply` actually succeed from cold?
   Wrong attribute names, a resource referenced before it exists, `automount = false` semantics,
   whether `depends_on` is needed or redundant, provider version constraints.

Please also flag anything about running an agent with shell access on a publicly-reachable box
that I have not defended against, and say plainly if any of my stated reasoning is wrong.

Do not rewrite the files wholesale. Give me a ranked list of findings, each with the specific line
or block, what actually goes wrong, and the smallest correct fix. Say clearly which findings are
certain and which are speculative.

## The files

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
# See docs/research/260831a-remote-server-for-claude-code.md.

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

resource "hcloud_ssh_key" "me" {
  name       = "${var.name}-key"
  public_key = file(var.ssh_public_key_path)
}

# Formatted once, here, at creation. Deliberately NOT formatted in cloud-init:
# a mkfs that runs on every boot is one bad conditional away from wiping the
# only copy of the work.
resource "hcloud_volume" "data" {
  name     = "${var.name}-data"
  size     = var.volume_size_gb
  location = var.location
  format   = "ext4"

  # The whole point of the volume. Terraform must refuse to destroy it, even
  # when it is destroying the server. To retire it deliberately, delete this
  # block first, in its own commit.
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
    ssh_public_key = trimspace(file(var.ssh_public_key_path))
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  # The server must not be created before the volume exists, because cloud-init
  # mounts it by id on first boot.
  depends_on = [hcloud_volume.data]
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.box.id

  # We write our own fstab entries in cloud-init, with nofail, so a volume that
  # fails to attach leaves a reachable box rather than an unbootable one.
  automount = false
}
```

### `infra/hetzner/variables.tf`

```
variable "name" {
  description = "Name for the server, volume, firewall and SSH key."
  type        = string
  default     = "spideryarn-box"
}

variable "server_type" {
  description = <<-TXT
    CX53 is 16 shared vCPU / 32GB / 320GB, EUR 29.49/mo net (add 20% UK VAT).
    It is the TOP of the CX line — there is nothing above it. The next rung with
    more RAM is CCX43 at EUR 275.99/mo net, a 9x jump, so plan to swap the
    server under the volume rather than expecting a bigger CX.
    Prices verified 2026-08-31; Hetzner repriced on 15 June 2026 and a rescale
    moves a grandfathered server onto current pricing.
  TXT
  type        = string
  default     = "cx53"
}

variable "image" {
  type        = string
  default     = "ubuntu-24.04"
}

variable "location" {
  description = "fsn1 (Falkenstein) is ~22ms from London; hel1 (Helsinki) is ~45ms."
  type        = string
  default     = "fsn1"
}

variable "username" {
  description = "Non-root user that owns the sessions. Claude Code refuses to start as root with --dangerously-skip-permissions."
  type        = string
  default     = "greg"
}

variable "ssh_public_key_path" {
  type    = string
  default = "~/.ssh/id_ed25519.pub"
}

variable "ssh_source_ips" {
  description = <<-TXT
    Who may reach SSH and mosh. Defaults to the whole internet because a home
    IP is usually dynamic. Narrow it to "your.ip/32" whenever you can — it is
    the single biggest reduction in exposure available here, and it costs one
    `terraform apply` to change back.
  TXT
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "volume_size_gb" {
  description = <<-TXT
    Holds /home: repos, node_modules, ~/.claude, browser profiles. EUR 0.044/GB/mo
    net, so 50GB is about EUR 2.20/mo. Volumes grow but never shrink.
  TXT
  type        = number
  default     = 50
}

variable "swap_gb" {
  description = <<-TXT
    Swap is the cheap insurance against the known failure mode: N sessions x M
    MCP servers spawns unbounded Node processes, and the OOM killer takes the
    box out. Swap turns a hard kill into a slowdown you can notice and act on.
  TXT
  type        = number
  default     = 8
}

variable "node_major" {
  type    = number
  default = 22
}

variable "timezone" {
  type    = string
  default = "Europe/London"
}
```

### `infra/hetzner/outputs.tf`

```
output "ipv4" {
  value = hcloud_server.box.ipv4_address
}

output "ipv6" {
  value = hcloud_server.box.ipv6_address
}

output "ssh" {
  value = "ssh ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "mosh" {
  value = "mosh ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "vnc_tunnel" {
  description = "Run this locally, then open http://localhost:6080/vnc.html"
  value       = "ssh -L 6080:localhost:6080 ${var.username}@${hcloud_server.box.ipv4_address}"
}

output "monthly_cost_note" {
  value = "CX53 EUR 29.49 + volume EUR ${format("%.2f", var.volume_size_gb * 0.044)} + IPv4 ~EUR 0.60, all NET. Add 20% UK VAT."
}
```

### `infra/hetzner/cloud-init.yaml`

```
#cloud-config
# Runs once, on first boot. Everything here must be safe to run again on a
# rebuilt server whose volume already holds a populated /home.
#
# NOTE ON ESCAPING: this file is rendered by Terraform's templatefile(), which
# consumes $${...}. Terraform variables are written ${like_this}; every SHELL
# brace must be doubled as $${like_this} or it is silently eaten at render time
# and the box boots subtly wrong.

timezone: ${timezone}
package_update: true
package_upgrade: true

users:
  - name: ${username}
    groups: [sudo]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${ssh_public_key}

packages:
  - build-essential
  - ca-certificates
  - curl
  - fail2ban
  - git
  - htop
  - jq
  - mosh
  - novnc
  - rsync
  - ripgrep
  - tmux
  - unattended-upgrades
  - unzip
  - websockify
  - x11vnc
  - xvfb

write_files:
  # Password auth off, root login off. The key is already on the user by the
  # time this is applied, because cloud-init creates users before runcmd.
  - path: /etc/ssh/sshd_config.d/99-hardening.conf
    content: |
      PermitRootLogin no
      PasswordAuthentication no
      KbdInteractiveAuthentication no
      ChallengeResponseAuthentication no
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

  # Xvfb + x11vnc + noVNC, all bound to localhost. Reached over an SSH tunnel,
  # never over the open internet — there is no firewall hole for these ports.
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
      echo "Tunnel with:  ssh -L 6080:localhost:6080 ${username}@<ip>"
      echo "Then open:    http://localhost:6080/vnc.html"

  - path: /etc/profile.d/display.sh
    content: |
      export DISPLAY=:99

runcmd:
  # --- swap ---------------------------------------------------------------
  # Insurance against the OOM killer, which is the documented way this box
  # falls over: many sessions x many MCP servers spawns unbounded Node procs.
  - |
    if [ ! -f /swapfile ]; then
      fallocate -l ${swap_gb}G /swapfile
      chmod 600 /swapfile
      mkswap /swapfile
      swapon /swapfile
      echo '/swapfile none swap sw 0 0' >> /etc/fstab
      sysctl -w vm.swappiness=10
      echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
    fi

  # --- volume -------------------------------------------------------------
  # The volume was formatted by Terraform at creation. Nothing here formats
  # anything: there is deliberately no mkfs in this file, so no boot can ever
  # destroy the data. If the device is missing we carry on with a working box
  # and an empty /home rather than an unbootable one.
  - |
    DEV=/dev/disk/by-id/scsi-0HC_Volume_${volume_id}
    for i in $(seq 1 30); do [ -e "$DEV" ] && break; sleep 2; done
    if [ ! -e "$DEV" ]; then
      echo "VOLUME MISSING: $DEV never appeared; /home is on the boot disk" | tee /var/log/volume-missing
      exit 0
    fi
    mkdir -p /mnt/data
    grep -q "$DEV" /etc/fstab || echo "$DEV /mnt/data ext4 discard,nofail,defaults 0 0" >> /etc/fstab
    mount /mnt/data

  # Seed the volume from the freshly-created /home on FIRST boot only. On a
  # rebuild /mnt/data/home already exists and is left untouched — including its
  # authorized_keys, which is why changing your SSH key needs a thought: the
  # new key lands on the boot disk and is then hidden by the bind mount below.
  - |
    if [ -d /mnt/data ] && mountpoint -q /mnt/data; then
      if [ ! -d /mnt/data/home ]; then
        mkdir -p /mnt/data/home
        rsync -a /home/ /mnt/data/home/
      else
        # Rebuild: make sure the current key still gets you in, so a rebuild
        # after rotating keys does not lock you out of your own data.
        install -d -m 700 -o ${username} -g ${username} /mnt/data/home/${username}/.ssh
        cat /home/${username}/.ssh/authorized_keys >> /mnt/data/home/${username}/.ssh/authorized_keys 2>/dev/null || true
        sort -u -o /mnt/data/home/${username}/.ssh/authorized_keys /mnt/data/home/${username}/.ssh/authorized_keys
        chown ${username}:${username} /mnt/data/home/${username}/.ssh/authorized_keys
        chmod 600 /mnt/data/home/${username}/.ssh/authorized_keys
      fi
      grep -q "/mnt/data/home /home" /etc/fstab || echo "/mnt/data/home /home none bind,nofail,x-systemd.requires-mounts-for=/mnt/data 0 0" >> /etc/fstab
      mount --bind /mnt/data/home /home
    fi

  # --- node ---------------------------------------------------------------
  - curl -fsSL https://deb.nodesource.com/setup_${node_major}.x | bash -
  - apt-get install -y nodejs
  - npm install -g @anthropic-ai/claude-code

  # --- browser ------------------------------------------------------------
  # Playwright's own Chromium, not Google Chrome: it is the build the MCP server
  # expects, and it is the one that exists on arm64 should the box ever move.
  # System deps as root, the browser itself as the user so it lands on the volume.
  - npx --yes playwright@latest install-deps chromium
  - su - ${username} -c 'npx --yes playwright@latest install chromium'

  # --- MCP servers --------------------------------------------------------
  # Deliberately only two. N sessions x M MCP servers is the thing that breaks
  # at scale, so this list should stay short and be argued over before it grows.
  - su - ${username} -c 'claude mcp add playwright -- npx -y @playwright/mcp@latest --headless --user-data-dir /home/${username}/.pw-profile' || true
  - su - ${username} -c 'claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest' || true

  # --- lock the door ------------------------------------------------------
  - systemctl enable --now fail2ban
  - systemctl restart ssh || systemctl restart sshd

final_message: "Box up after $UPTIME s. SSH in and run `claude` to log in (press c, open the URL on your laptop, paste the code back)."
```

