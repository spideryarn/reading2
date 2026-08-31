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

    # filebase64, deliberately, not file() and never templatefile(). The script is
    # injected byte-for-byte; Terraform never parses its contents, so shell syntax
    # in it cannot break a plan. Base64 also sidesteps every YAML indentation and
    # special-character question at the same time.
    provision_b64 = filebase64("${path.module}/provision.sh")
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
