# Review: making a remote Claude Code box into a real dev environment

You are reviewing a **plan**, before it is built. Be adversarial. The most valuable thing you can
find is a step that will appear to succeed while doing nothing, or a design that we will have to
undo later.

## The situation

We have a Hetzner CX53 (Ubuntu 24.04, 16 vCPU, 30GB RAM, 15GB swap) that runs Claude Code sessions
24/7 inside tmux, driven from a laptop by a CLI called `gjd-remote`. `/home` is a separate Hetzner
volume with delete protection, bind-mounted over `/home`; the root disk is ephemeral and the server
is meant to be re-creatable with `tofu apply -replace=hcloud_server.box`.

It is provisioned by `infra/hetzner/cloud-init.yaml`, which embeds a ~200-line `provision.sh` in
`write_files` and runs it once via `runcmd`. Sessions all run as one user (`greg`) with passwordless
sudo — a deliberate, recorded decision by the owner, not an oversight, and explicitly out of scope
here.

The box currently has: Node 26.8.1, Claude Code 2.1.251 (authenticated), Chrome 152, Playwright
browsers, playwright + chrome-devtools MCPs connected at user scope, tmux, mosh. It does **not**
have: `gh`, Docker, the Supabase CLI, the Vercel CLI, the project repo, `.env.local`, git identity,
or the Vercel/Sentry/Supabase MCPs.

The project is a TypeScript/Vite app with a local Supabase stack (Docker, custom ports 5436x),
Drizzle migrations, and a vitest suite where some suites need Postgres.

## What I want reviewed

The plan is in the attached `remote-box-dev-environment.md`. Please assess:

1. **The stage boundaries.** Is each stage genuinely abandonable — would the tree make sense if we
   stopped there? Is anything in the wrong stage, particularly anything in stage 3+ that stage 1 or
   2 secretly depends on?

2. **The "one principle"** — that everything must live either in `provision.sh` or in a push from
   the laptop, and that a hand-run SSH command is a bug. Is that the right invariant? Where will it
   be inconvenient enough that we will cheat?

3. **The proposed refactor** — extracting `provision.sh` out of the cloud-init heredoc into
   `infra/hetzner/provision.sh`, pulled in with `templatefile()`. Terraform's `${...}`
   interpolation then applies to the whole file, and a previous review of this same codebase caught
   a BLOCKER where an unescaped `${...}` inside a *comment* broke `templatefile()`. Is the refactor
   worth it? If yes, what is the safe way to do it — and is there a way to get the re-runnability
   benefit without exposing the whole script to Terraform's parser?

4. **GitHub auth.** Research recommends a fine-grained PAT scoped to specific repos with
   `Contents: Read and write`, exported as `GH_TOKEN` from a `chmod 600` file, plus
   `gh auth setup-git`, and explicitly *not* `gh auth login` — because on a headless box with no
   Secret Service, `gh` silently falls back to a plaintext, non-expiring, account-wide OAuth token
   in `~/.config/gh/hosts.yml`. Do you agree? Two specific things to check:
   (a) The target repo is `spideryarn/reading2` — an **organisation** repo. Do fine-grained PATs
       require an org setting to be enabled first, and what exactly is the failure mode if it is
       not? Will it fail loudly or look like a 404?
   (b) `gh auth setup-git` writes a credential helper, but the repo's remote is an `ssh://` URL.
       What is the least surprising way to make HTTPS-with-token work — clone over HTTPS,
       `url.insteadOf`, or something else? Which one breaks least when the same repo is also
       checked out on the laptop over SSH?

5. **Secrets.** `.env.local` will be pushed from the laptop over scp. It contains an OpenRouter key,
   an OpenAI key, a Supabase **production** access token, a Hetzner API token that can destroy this
   very box, and Google OAuth client secrets — but its `DATABASE_URL` and `SUPABASE_URL` point at
   the *local* stack. `.env.prod`, which holds production database credentials, will **not** be
   pushed. Is that line in the right place? Is there anything about a shared box running autonomous
   agents that should change which of those keys go over?

6. **The `/home` durability table** — the claim is that nothing irreplaceable lives on the volume,
   provided the env-push mechanism exists. Is that list complete? What have I forgotten that would
   be painful to lose?

7. **Docker's data-root.** Default `/var/lib/docker` is on the ephemeral root disk, so a rebuild
   re-pulls ~2GB of Supabase images. Moving it to the persistent volume costs volume space and
   couples the volume to Docker's on-disk format. Which way, and why?

8. **Parallel sessions and one local Supabase.** Many concurrent Claude sessions on one box, one
   local Postgres. This project has already been bitten by parallel test files colliding on a global
   constraint in one database. Is "one shared stack, serialise the test runs" right, or should each
   session get its own stack on its own ports? What does the Supabase CLI actually support?

9. **Anything missing from the plan entirely.** This is the question I most want answered. What will
   we discover in three weeks that should have been in stage 1?

Rank findings by severity, say for each whether the mechanism is certain or speculative, and give
the smallest fix. Do not rewrite the plan; tell me what is wrong with it.

## The plan

# Making the remote box a real dev environment

The box exists and runs Claude Code ([remote-server-for-claude-code.md](../research/remote-server-for-claude-code.md),
[gjd-remote-cli.md](../research/gjd-remote-cli.md)). It cannot yet *do* anything with this project:
no repo, no GitHub credentials, no secrets, no database. This plan closes that gap.

Greg's list, 2026-08-31:

> - install Claude Code, and figure out how to authenticate (done, I think — requires me to do it
>   manually the first time)
> - get Chrome & Playwright set up, and run a smoke test on controlling & screenshots from Chrome
> - get GitHub auth setup, so that we can pull/push
> - copy over .env.local (we might need a way to do this regularly in future if we update it locally)
> - set up Supabase local, along with Docker/Orbstack/something-else perhaps
> - set up Vercel, Sentry, Supabase MCPs (and authenticate)

## The one principle

**The server is cattle; `/home` is the pet.** Everything below must land in one of two places:

1. **`provision.sh`** — anything with no secret in it. Runs from cloud-init on a fresh box, and is
   re-runnable by hand on a live one. If it is not in there, a rebuild loses it.
2. **A push from the laptop** — anything secret. Terraform state and this repo are both the wrong
   home for a credential.

A step that is only ever done by hand in an SSH session is a step we will have to rediscover. The
test for every stage below is *"survives `tofu apply -replace=hcloud_server.box`"*.

## Where we are (measured 2026-08-31, not assumed)

| | State |
|---|---|
| Ubuntu 24.04.4, 16 vCPU, 30GB RAM, 15GB swap | ✅ |
| `/home` on the 50GB volume, 46GB free; root disk 268GB free | ✅ |
| Node 26.8.1, npm 11.19.0 | ✅ |
| Claude Code 2.1.251, **authenticated** (Greg, once, by hand) | ✅ |
| playwright + chrome-devtools MCPs, `--scope user`, both connected | ✅ |
| Chrome 152.0.7977.64, Playwright chromium-1234 | ✅ |
| tmux 3.4, mosh 1.4.0 | ✅ |
| `gh`, Docker, Supabase CLI, Vercel CLI | ❌ absent |
| Vercel / Sentry / Supabase MCPs | ❌ absent |
| The repo, `.env.local`, git identity | ❌ absent |
| `file`, `jq`, `rg`, `unzip` | ❌ absent (hit `file: command not found` during the smoke test) |

**The browser smoke test already passes.** Playwright drove system Chrome against a Node server on
`127.0.0.1:4321`: navigate → read `#t` (`Localhost app OK`) → click `#b` → re-read `#t` (`CLICKED`)
→ screenshot, PNG magic `89504e470d0a1a0a`, 1280x720, 7106 bytes. Two different pages produced two
different PNGs, so it rendered rather than emitting a fixed blank. Stage 1 turns that into a
committed script instead of a thing I once typed.

**One trap found while doing it.** `~/.cache/ms-playwright/chromium-1234` was downloaded by
`@playwright/mcp@0.0.79`. A project that installs its own `playwright` pins a *different* browser
build number and fails with "Executable doesn't exist" until `npx playwright install chromium` is
run. Either run that per-project, or launch with `executablePath: "/usr/bin/google-chrome-stable"`
as the smoke test does.

## What is genuinely at risk, given "no backups"

Greg chose no backups because the code is all pushed to a remote. That is true of the code. It is
worth being explicit about what else is on `/home` and where each thing comes back from, because
that is what makes the decision safe rather than lucky:

| On `/home`, not in git | Comes back from |
|---|---|
| `.env.local` | the laptop, via `gjd-remote push-env` (stage 2) |
| Claude Code credentials | `claude` `/login`, by hand |
| GitHub credentials | `gh auth login`, by hand |
| tmux sessions and their transcripts | nothing — genuinely lost |
| Supabase local database contents | `npm run db:reset && npm run db:migrate` |

Nothing irreplaceable, provided stage 2 exists. Without stage 2, `.env.local` is a hand-typed file
with no second copy, and the no-backups decision is worse than it looks.

## Stages

Each ends green, committed, and safe to abandon.

### Stage 1 — utilities, the repo, and a scripted smoke test

No credentials. Adds to `provision.sh`: `gh`, `jq`, `file`, `ripgrep`, `unzip`, git identity, and
the Playwright/Chrome smoke test as `scripts/` on the box. Extends `gjd-remote doctor` so every
claim in the table above is *checked* rather than *written down*
([written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md)).

**Done when:** a doctor run asserts Chrome can screenshot and Playwright can click, and it goes red
if either breaks.

### Stage 2 — secrets and GitHub

`gjd-remote push-env` copies `.env.local` from the laptop, `0600`, atomically. It **refuses to copy
`.env.prod`** — that file holds production database credentials and the box is shared by many
autonomous agents with passwordless sudo. Greg has not asked for it and should not get it by
accident.

GitHub auth mechanism pending research (see open decisions). Then clone `spideryarn/reading2` to
`~/code/spideryarn2`, `npm install`, and run the gates.

**Done when:** `npm run typecheck` passes on the box, `npm test` passes except the suites that need
Postgres, and those say so rather than skipping silently.

### Stage 3 — Docker and local Supabase

Container runtime, Supabase CLI, `npm run db:start`, `npm run db:migrate`.

Two things to decide here, both from research: whether Docker's data-root belongs on the persistent
volume (it is on the ephemeral root disk by default, so a rebuild re-pulls ~2GB of images), and
whether many parallel agent sessions share one stack or get one each. This project already has an
opinion about parallel test runs against one database
(parallel test files against one database have already collided on a global constraint here), which argues for one stack and serialised
runs rather than N stacks.

**Done when:** the full `npm test` is green on the box, including the Postgres suites.

### Stage 4 — the three MCPs

Vercel, Sentry, Supabase. The live question is whether their OAuth flows can complete on a machine
with no browser; research is running. If they cannot, the fallback is local `npx` servers with
static tokens, pushed by stage 2's mechanism rather than typed.

**Supabase MCP gets `--read-only`** if it exists, and is pointed at the local stack, not the
production project. `SUPABASE_ACCESS_TOKEN` in `.env.local` is a *production* personal access token.

**Done when:** `claude mcp list` shows all three connected, and one real call to each works.

### Stage 5 — make it survive a rebuild

Fold every stage into `provision.sh`, then prove it by rebuilding the server and running doctor.
This is the only stage that produces evidence rather than assertions, and it is the reason the
others are written the way they are.

**Done when:** `tofu apply -replace=hcloud_server.box`, then `gjd-remote push-env`, then a green
doctor — with no hand-editing on the box in between.

## A refactor this exposes

`provision.sh` currently lives as a 200-line heredoc inside `write_files` in `cloud-init.yaml`, and
`scripts/check-cloud-init.ts` exists to extract and `bash -n` it. Stages 1-4 all add to it.

**Proposal:** move it to `infra/hetzner/provision.sh` as a real file, pulled in with
`templatefile()`. It becomes shellcheck-able, diffable, and — the point — `rsync`-able to a live box
so stage 5's "re-run provisioning" is one command rather than a rebuild. The extraction half of
`check-cloud-init.ts` then goes away.

Against: it is a refactor of infrastructure that currently works, and the escaping rules change
(`${...}` in the file is now Terraform's, not bash's — the exact trap that produced a BLOCKER last
time). Decide with Sol before doing it, not after.

## Open decisions

1. **GitHub auth mechanism** — device flow, PAT, or a box SSH key. Research running. Blast radius
   differs: a classic PAT on a shared box reaches every repo Greg owns.
2. **`.env.prod` on the box** — this plan says no. If Greg wants to run anything against production
   from the box, that is a separate, deliberate decision.
3. **Docker data-root on the volume** — 2GB of images re-pulled per rebuild, versus spending
   persistent disk and coupling the volume to Docker's on-disk format.
4. **`provision.sh` extraction** — the refactor above.

## Not doing

- Splitting the agent account or removing passwordless sudo. Greg's call, 2026-08-30, recorded in
  [`infra/hetzner/README.md`](../../infra/hetzner/README.md). It is the right thing eventually and
  it is not this piece of work.
- Running the pipeline against production data from the box.
- A second Supabase project in the cloud for the box to use.

## Current cloud-init.yaml (the thing stages 1-5 all modify)
```yaml
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
      sleep 1
      # Backgrounding something successfully is not the same as it running.
      for check in "Xvfb :99" "x11vnc .*:99" websockify; do
        pgrep -f "$check" >/dev/null || { echo "FAILED to start: $check" >&2; exit 1; }
      done
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
      echo "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${node_major}.x nodistro main" \
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
        ${node_major}.*) echo "nodejs candidate $CAND" ;;
        *) echo "FATAL: nodejs candidate is '$CAND', wanted ${node_major}.x - the NodeSource repo is not winning" >&2; exit 1 ;;
      esac
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
      run 60 "chrome signing key" bash -o pipefail -c 'curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /usr/share/keyrings/google-chrome.gpg'
      chmod 0644 /usr/share/keyrings/google-chrome.gpg
      echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list
      run 180 "apt update" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any -y update'
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
      fail=0
      check() { if eval "$2" >/dev/null 2>&1; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
      check "/home is the volume"      'test "$(stat -c %d /home)" = "$(stat -c %d /mnt/data/home)"'
      check "swap active"              'swapon --show | grep -q swapfile'
      check "node is the wanted major" 'su - '"$USER_NAME"' -c "node -v" | grep -q "^v${node_major}\."'
      check "npm present"              'su - '"$USER_NAME"' -c "command -v npm"'
      check "claude runs"              'timeout 30 su - '"$USER_NAME"' -c "claude --version"'
      check "chrome runs"              'timeout 30 su - '"$USER_NAME"' -c "google-chrome --version"'
      check "playwright chromium runs" 'timeout 60 su - '"$USER_NAME"' -c "npx --yes playwright@latest cr --version" 2>/dev/null || su - '"$USER_NAME"' -c "ls ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome"'
      check "playwright mcp"           'timeout 30 su - '"$USER_NAME"' -c "claude mcp get playwright" | grep -q max-old-space-size'
      check "devtools mcp"             'timeout 30 su - '"$USER_NAME"' -c "claude mcp get chrome-devtools" | grep -q max-old-space-size'
      check "tmux config parses"       'timeout 20 su - '"$USER_NAME"' -c "tmux -f ~/.tmux.conf -L verify start-server \; kill-server"'
      check "sshd config valid"        'sshd -t'
      check "sshd -T runs"             'sshd -T >/dev/null 2>&1'
      check "password auth off"        'sshd -T 2>/dev/null | grep -qi "^passwordauthentication no"'
      check "root login off"           'sshd -T 2>/dev/null | grep -qi "^permitrootlogin no"'
      if [ "$fail" -ne 0 ]; then
        echo "PROVISION INCOMPLETE — see above" >&2
        exit 1
      fi
      echo "PROVISION OK"

runcmd:
  # `bash -o pipefail -c`, not a bare pipeline. A string runcmd entry is
  # interpreted by sh, so the pipeline's status is TEE's -- always zero. That is
  # exactly why the first build reported `cloud-init: done` after provisioning
  # had already died at line 55. The failure was never hidden in the log; it was
  # hidden from cloud-init.
  - bash -o pipefail -c 'bash /usr/local/sbin/provision.sh 2>&1 | tee /var/log/provision.log'

final_message: |
  Box up after $UPTIME s.
  Check provisioning actually succeeded:  sudo tail -20 /var/log/provision.log
  It must end with PROVISION OK. Then run `claude` and log in with /login.
```
