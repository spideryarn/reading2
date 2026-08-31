# Review: removing the Playwright chromium download from the remote box

You are reviewing a change to **provisioning for a single-operator dev server** (Hetzner, Ubuntu
24.04, Terraform + cloud-init). It runs Claude Code sessions. Only the operator (Greg) uses it.

**The thing that makes this worth your time: this change cannot be tested without rebuilding the
box, and we are not rebuilding it.** `provision.sh` runs at first boot. Everything below was checked
against a *live, already-provisioned* box and a static preflight. So the question I most want
answered is: **what breaks on the next rebuild that nothing here would have caught?**

## What the box's browser stack is for

Agents on the box drive a browser two ways: two MCP servers (`@playwright/mcp`,
`chrome-devtools-mcp`), and ad-hoc scripts using `playwright-core`. The Chrome extension used on the
laptop cannot work on a headless server, so this is the only mechanism there.

## What I found

1. `provision.sh` ran `npx --yes playwright@latest install chromium`, downloading 651MB into
   `~/.cache/ms-playwright` (chromium-1234 + headless shell).
2. **Nothing launches it.** During a live MCP navigation I read `/proc/<pid>/exe` and got
   `/opt/google/chrome/chrome` — the apt-installed system Chrome. Both MCPs default to the system
   Chrome channel; our own smoke script passes `executablePath: /usr/bin/google-chrome-stable`.
3. The download was **unpinned** (`@latest`), so the browser revision floated with the date of the
   provisioning run, while docs named a fixed revision.
4. A verification check was backwards (details in the diff).

### The measurement that justifies removal, including its control

With `PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-empty` (an empty directory), driving the real MCP over stdio:

- `--browser chrome` → navigated to a real page, returned title and URL. **OK**
- control, `--browser chromium` → failed: `expected executable at /tmp/pw-empty/chromium-1237/...`

The control is there to prove the empty cache was genuinely in effect rather than the env var being
ignored. Without it, "it worked" would be worthless.

Also measured: `@playwright/mcp@0.0.79` bundles `playwright-core@1.63.0-alpha`, which wants chromium
revision **1237**. The cache held **1234** (what `playwright@1.62.1` wants). So the revision the MCP
would have needed was never present, and the MCP worked anyway — which is the evidence that it was
never using the cache.

## What I changed

Three edits to `provision.sh`, plus docs. Diff below.

## What I checked, and what I could not

Checked: `scripts/check-cloud-init.ts` preflight passes (it parses the file and asserts every
verification check is runnable shell); `shellcheck -S warning` clean; `npm test` 383 files green;
mutation-tested the preflight by introducing a real syntax error into my new check and confirming it
goes red and names the check.

**Could not check:** an actual provisioning run. No rebuild.

## Questions

1. **What breaks on the next rebuild?** Especially: is `playwright install-deps chromium` (kept)
   still sufficient for system Chrome's shared libraries once `install chromium` (removed) is gone —
   or was the removed step pulling in something the kept step does not?
2. Is `--browser chrome` the right flag for `@playwright/mcp@0.0.79`, or should it be
   `--executable-path /usr/bin/google-chrome-stable`? Which is more robust across MCP version pins?
3. My replacement check asserts **configuration** (`claude mcp get playwright` contains
   `--browser chrome`) rather than capability. The neighbouring checks do the same. Is that the
   right call inside provisioning, given a real browser launch is asserted separately by
   `gjd-remote doctor`? Or is a config check here self-fulfilling and worthless?
4. Anything else in the diff that is wrong, risky, or would fail on a fresh box.

Be blunt and concrete. If a claim above is unsupported by the evidence, say so.

## The diff

```diff
diff --git a/docs/project/browser-control.md b/docs/project/browser-control.md
index cbb67cc..825f15b 100644
--- a/docs/project/browser-control.md
+++ b/docs/project/browser-control.md
@@ -42,10 +42,11 @@ screenshots are large and the reasoning is small.
 Two things about that box will catch you out:
 
 - **There is one browser on that box, and it is system Chrome.** Both MCPs launch
-  `/opt/google/chrome/chrome`, and the smoke test names it in `executablePath`. Set it yourself in
-  any script you write. A bare `chromium.launch()` asks for Playwright's *bundled* chromium at
-  whatever revision your client version wants, and dies with "Executable doesn't exist" — measured
-  on 2026-08-31, when `~/.cache/ms-playwright` held revision 1234 and the MCP's client wanted 1237.
+  `/opt/google/chrome/chrome` — the Playwright one is given `--browser chrome` explicitly — and the
+  smoke test names it in `executablePath`. Set it yourself in any script you write. A bare
+  `chromium.launch()` asks for Playwright's *bundled* chromium, which provisioning no longer
+  downloads, and dies with "Executable doesn't exist". Until a re-provision the old 651MB download
+  is still sitting in `~/.cache/ms-playwright` on the live box, at a revision nothing launches.
 - **`playwright-core` is a pinned devDependency of this repo**, so a checkout that has run `npm ci`
   has the version our lockfile names. On a box with no checkout the smoke test falls back to
   borrowing a copy from the npx cache, at whatever version the MCPs bundled; it prints which root it
diff --git a/infra/hetzner/README.md b/infra/hetzner/README.md
index 4d8d827..1f3cca4 100644
--- a/infra/hetzner/README.md
+++ b/infra/hetzner/README.md
@@ -290,6 +290,13 @@ x11vnc and websockify are all bound to localhost and reached through the tunnel.
 - **Playwright runs `--isolated`.** One persistent browser profile supports exactly one browser
   process, and this box exists to run sessions in parallel. The cost is that the browser does not
   stay signed in to anything.
+- **There is one browser here, and it is `google-chrome-stable`.** Both MCPs launch it — the
+  Playwright one is given `--browser chrome` explicitly — and
+  [`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs) names it in
+  `executablePath`. Playwright's own chromium download was removed from provisioning on 2026-08-31
+  after 651MB of it turned out to be launched by nothing. So **a bare `chromium.launch()` fails
+  here** with "Executable doesn't exist"; pass the path. `npx playwright install chromium` fetches
+  one on demand if you genuinely need it.
 - **The MCP list is deliberately two.** N sessions × M MCP servers spawns unbounded Node processes;
   that, not RAM, is what falls over first. Argue before adding a third.
 - **There is no backup.** By choice — the code lives in remote git. Anything on this box that is
diff --git a/infra/hetzner/provision.sh b/infra/hetzner/provision.sh
index 611b8b0..4fade28 100755
--- a/infra/hetzner/provision.sh
+++ b/infra/hetzner/provision.sh
@@ -199,8 +199,27 @@ run 180 "apt update" bash -c 'apt-get -o DPkg::Lock::Timeout=600 --error-on=any
 run 300 "install chrome" bash -c 'apt-get -o DPkg::Lock::Timeout=600 -y install google-chrome-stable'
 
 echo "=== playwright ==="
+# The SHARED LIBRARIES headless Chrome needs, and nothing else. There is one
+# browser on this box and it is the google-chrome-stable installed above:
+# @playwright/mcp is given --browser chrome below, chrome-devtools-mcp wants
+# real Chrome by design, and scripts/remote-smoke-browser.mjs names
+# /usr/bin/google-chrome-stable in executablePath.
+#
+# `playwright install chromium` used to run here and was removed on 2026-08-31.
+# It downloaded 651MB into ~/.cache/ms-playwright and NOTHING ever launched it:
+# during a live MCP navigation, /proc/<pid>/exe read /opt/google/chrome/chrome.
+# It was also unpinned, so the browser build number floated with the date of the
+# provisioning run while the docs named a fixed one.
+#
+# Measured before removing, not assumed: with PLAYWRIGHT_BROWSERS_PATH pointed
+# at an empty directory, `--browser chrome` navigated to a real page, and the
+# control -- the same probe forced onto the bundled chromium -- failed with
+# "expected executable at /tmp/pw-empty/chromium-1237/...", which is what proves
+# the empty cache was genuinely in effect rather than the variable ignored.
+#
+# If you ever do need Playwright's own chromium here, `npx playwright install
+# chromium` fetches it on demand; it does not need to be a provisioning step.
 run 420 "playwright system deps" npx --yes playwright@latest install-deps chromium
-run 420 "playwright chromium" su - "$USER_NAME" -c 'npx --yes playwright@latest install chromium </dev/null'
 
 echo "=== docker ==="
 # Docker's OWN apt repo, deliberately:
@@ -347,7 +366,12 @@ add_mcp() {
   timeout 60 su - "$USER_NAME" -c "claude mcp remove --scope user $name </dev/null" </dev/null 2>/dev/null || true
   timeout 60 su - "$USER_NAME" -c "claude mcp add --env '$CAP' --scope user $name -- $* </dev/null" </dev/null
 }
-add_mcp playwright "npx -y @playwright/mcp@$PW_MCP --headless --isolated"
+# --browser chrome, explicitly: use the system google-chrome-stable rather than
+# Playwright's own chromium download, which this box deliberately does not have.
+# It is the current default too, but a default is not a decision -- leaving it
+# implicit means a future pin of @playwright/mcp could move it and take the
+# browser away with no line of ours changing.
+add_mcp playwright "npx -y @playwright/mcp@$PW_MCP --headless --isolated --browser chrome"
 add_mcp chrome-devtools "npx -y chrome-devtools-mcp@$CDT_MCP --headless"
 
 echo "=== ssh ==="
@@ -422,7 +446,17 @@ check "claude runs"              'timeout 30 su - '"$USER_NAME"' -c "claude --ve
 # a global npm bin directory missing from PATH would show up.
 check "codex runs"               'timeout 60 su - '"$USER_NAME"' -c "codex --version" | grep -q "^codex-cli "'
 check "chrome runs"              'timeout 30 su - '"$USER_NAME"' -c "google-chrome --version"'
-check "playwright chromium runs" 'timeout 60 su - '"$USER_NAME"' -c "npx --yes playwright@latest cr --version" 2>/dev/null || su - '"$USER_NAME"' -c "ls ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome"'
+# Was: `playwright cr --version || ls ~/.cache/ms-playwright/.../chrome`. Both
+# halves were wrong. The `||` put the WEAK test first -- `cr --version` prints
+# the playwright CLIENT version and passes on a box with no browser at all, so
+# the strong half only ran once the weak one had already failed. And the strong
+# half looked for a chromium download this box no longer has.
+#
+# What matters now is that the MCP is pointed at the system Chrome that check
+# above just proved runs. This asserts CONFIGURATION; capability is asserted by
+# scripts/remote-smoke-browser.mjs, which `gjd-remote doctor` runs on the box and
+# which drives a real browser. Two different questions, deliberately.
+check "playwright mcp uses system chrome" 'timeout 30 su - '"$USER_NAME"' -c "claude mcp get playwright" | grep -q -- "--browser chrome"'
 check "playwright mcp"           'timeout 30 su - '"$USER_NAME"' -c "claude mcp get playwright" | grep -q max-old-space-size'
 check "devtools mcp"             'timeout 30 su - '"$USER_NAME"' -c "claude mcp get chrome-devtools" | grep -q max-old-space-size'
 check "docker daemon runs"       'timeout 30 docker info'
```
