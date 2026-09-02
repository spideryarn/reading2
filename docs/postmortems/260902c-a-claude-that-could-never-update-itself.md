# A claude that could never update itself

**Found 2026-09-02**, from a line Greg saw at the top of a session on the Hetzner box:

```
Auto-update failed: no write permission to npm prefix. Run claude doctor
```

The box had been on 2.1.251 since it was built on 2026-08-31 and 2.1.258 had shipped. Ten agent
sessions were running at the time, every one of them on a binary that could never replace itself.

## What broke

[`infra/hetzner/provision.sh`](../../infra/hetzner/provision.sh) installed Claude Code as root:

```
run 300 "install claude code" npm install -g @anthropic-ai/claude-code
```

**npm's global prefix on this box is `/usr`, not `/usr/local`.** There is no `~/.npmrc` and no
`/usr/etc/npmrc`; NodeSource's packaging computes it. So that line put Claude Code in
`/usr/lib/node_modules/@anthropic-ai/claude-code`, owned by `root:root`, mode 755.

Claude Code's self-updater runs as `greg`. It has to rewrite the directory it lives in. It cannot,
so it gives up and says so, once per session start, forever.

## Why nobody saw it for two days

Nothing is broken. `claude` starts, runs, and does the work. The one thing it cannot do is the thing
nobody watches.

The provisioning check was:

```
check "claude runs"  'timeout 30 su - '"$USER_NAME"' -c "claude --version"'
```

That was green the entire time, and it was green *truthfully* — claude did run. **Running and being
able to replace yourself are different facts, and only one of them was ever asserted.** This is the
[silent-success](../reusable/silent-success.md) shape in its purest form: the check shares an
assumption with the code, namely that a binary which executes is a binary that is installed
correctly.

The second-order reason is that **nobody chose `/usr`**. Had someone written `npm config set prefix
/usr` there would be a line to find and question. It is a computed default, so it appears in no file,
and the `sudo` in front of `npm install -g` looks like ordinary care rather than the cause.

## The class

**A check that asserts the happy path of a capability while the capability itself is untested.**
Here: "does it run" standing in for "is it installed such that it can maintain itself". The same
class covers a migration check that reads a row back through the same cache that served it, and a
credential check that proves a file exists rather than that the API accepts it.

The tell is that the property that failed — writability — was never named anywhere, in the script or
the checks. Only its consequence was, and only at runtime, to a human reading a startup banner.

## The fix that is right for the long term

Install as the user, with Anthropic's native installer, which is now their recommendation and what
`claude doctor` itself prints as the remedy. It puts a versioned binary under
`~/.local/share/claude/versions/` with `~/.local/bin/claude` pointing at it, all user-owned, so the
updater needs no sudo.

There is a second half, and it is the part that is easy to get wrong. **Every context on this box
that actually runs work gets a stock PATH with no `~/.local/bin` in it** — the tmux job scripts
[`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) writes, the `ssh <box> claude mcp list` behind
`gjd-remote doctor`, cron. `~/.profile` adds `~/.local/bin` for *login* shells only, and only once
the directory exists. So a native install alone would have produced a `claude` that resolves in an
interactive ssh session and nowhere that matters, while `claude doctor`'s suggested
`npm -g uninstall @anthropic-ai/claude-code` would have taken the only copy those contexts could see.

So provisioning also links the user-owned binary where a stock PATH already looks:

```
ln -sfn "/home/$USER_NAME/.local/bin/claude" /usr/local/bin/claude
```

`/usr/local/bin` is FHS's place for a local override and precedes `/usr/bin` everywhere on this box.
One symlink, one answer to "which claude", and `scripts/gjd-remote.ts` needs no change — its
hardcoded job PATH already starts with `/usr/local/bin`.

## What would have caught it

Ranked by value for the effort.

1. **Assert the property, not the symptom.** Provisioning now checks, *as `greg`*, that the two
   directories the updater has to rewrite are writable — plus that the launcher and the
   `/usr/local/bin` symlink still point where it will move them:

   ```
   check "claude can auto-update (user can rewrite its install)" ...
   ```

   Each was verified by watching it go red — the writability check against the old root-owned
   `/usr/lib/node_modules/@anthropic-ai`, the target checks against `/usr/bin/claude` — rather than
   by trusting that it would.

   **The first version of this check made the same mistake it was written to catch.** It asserted
   that `greg` *owned* the launcher and the binary. But owning a symlink does not let you repoint
   it — the parent directory does — and a user-owned binary inside an unwritable `versions/` cannot
   be joined by the next version. It would have passed on installs that could not update. GPT Sol
   caught it while reviewing the fix, having been handed this postmortem's own argument. Being able
   to name the class is not the same as being immune to it.

2. **Check the path that runs the work, not a friendlier one.** The `claude runs` check now goes over
   the loopback ssh — literally what `gjd-remote doctor` does — instead of a login shell that flatters
   the install. A login shell would have passed a native-only install that leaves every tmux session
   with no Claude in it.

3. **Read the startup banner as a check.** The message was correct, specific, actionable, and printed
   at the top of every session for two days. No tooling would have been needed to act on it. Worth
   remembering the next time a warning is scrolling past.

A general form of (1): when provisioning installs something that maintains itself, the thing worth
asserting is that it can perform its own maintenance — not that it starts.

## Not fixed, deliberately

The npm copy at `/usr/lib/node_modules/@anthropic-ai/claude-code` was **left in place** on the live
box, dormant and shadowed by the symlink, because ten agent sessions were running and Greg asked that
they not be disturbed. Removing it is safe for them — the package's own `install.cjs` says the
executable is standalone with "no Node.js process stays resident", and `/proc/<pid>/exe` showed each
session holding only that one inode, which survives unlink — but there was no reason to take even a
residual risk for no gain.

Until somebody runs `sudo npm -g uninstall @anthropic-ai/claude-code`, the new
`no npm-global claude beside the native one` check reports FAIL on this box. That is the check
working: the migration is genuinely unfinished. A freshly built box passes it.

**`@openai/codex` had the identical problem** — same `npm install -g` as root, same root-owned `/usr`
prefix — and was left alone in the first pass, on the stated grounds that it "does not self-update,
so it fails loudly at install time rather than quietly forever".

**That was wrong, and it was wrong in the direction that matters.** Codex has a real `codex update`
subcommand, so it self-updates exactly as Claude Code does. What it does *not* have is Claude's
complaint: `claude doctor` printed "no write permission to npm prefix" at every session start, which
is the only reason anyone noticed. `codex doctor` reports `install: consistent` and prints
`npm update target /usr/lib/node_modules/@openai/codex` **without ever checking whether that target
is writable**. It had already fallen a version behind (0.151.0 against 0.152.1) and nothing on the
box would ever have said so.

So the quieter tool was the more urgent one, and "it fails loudly" was an assumption, not something
checked. Provisioning now installs codex the same way — OpenAI's own standalone installer, as the
user, into `~/.codex/packages/standalone/` with `~/.local/bin/codex` pointing at it, linked from
`/usr/local/bin` — and asserts the writability that `codex doctor` does not.

One thing is genuinely different, and it changes the migration rather than the install. Claude's
binary is self-contained; **codex resolves its bundled ripgrep and its `codex-resources` out of the
install tree at runtime**. So deleting the old npm tree is safe for a running Claude and is *not*
safe for a running codex, which can carry on until its next tool call and then fail. The cutover
order matters: link the new one first so nothing new starts from the old tree, and only remove the
npm copy once no process is still running out of it.

## Migrating a box that already exists

Provisioning builds new boxes correctly, but **it never removes the old npm packages** — deliberately,
because doing so under a running Codex review breaks it. A box built before 2026-09-02 therefore needs
this once, and reports FAIL on the two `no npm-global …` checks until it gets it.

Cut over first, remove afterwards. As `greg`:

```bash
# 1. Codex, the standalone installer, into the user's own home
t=$(mktemp) && curl -fsSL https://chatgpt.com/codex/install.sh -o "$t" && \
  CODEX_HOME="$HOME/.codex" CODEX_INSTALL_DIR="$HOME/.local/bin" CODEX_NON_INTERACTIVE=1 sh "$t"; rm -f "$t"

# 2. Point the stock PATH at it, so nothing new starts from the npm tree
sudo ln -sfnT "$HOME/.local/bin/codex" /usr/local/bin/codex

# 3. Prove the cutover before removing anything
env PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin sh -c 'command -v codex; codex --version'
```

Claude's npm copy can go at any point after its own cutover — running sessions hold the executable's
inode and need nothing else from the tree:

```bash
sudo npm -g uninstall @anthropic-ai/claude-code && /usr/local/bin/claude --version
```

Codex's must wait until nothing is still executing out of the old tree. This prints the offenders, or
nothing when it is safe:

```bash
old="$(npm root -g)/@openai/codex"
for p in /proc/[0-9]*; do
  case "$(readlink "$p/exe" 2>/dev/null)" in "$old"/*) echo "still running: ${p##*/}";; esac
done
```

When that is silent: `sudo npm -g uninstall @openai/codex`.

You do **not** need every Claude session stopped for any of this. Only Codex processes actually
running out of the old tree matter, and only for the last command.
