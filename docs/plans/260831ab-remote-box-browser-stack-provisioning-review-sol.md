## Verdict

Do not merge as written. Removing the Chromium binaries is sound, but the change creates a clean-home bootstrap failure and still never proves that the registered MCP can launch.

## Findings

1. **Blocker — `gjd-remote doctor` can fail on a genuinely fresh home.**

The removed command ran as Greg and incidentally populated `~/.npm/_npx` with `playwright-core`. The retained `install-deps` runs as root, so it only populates root’s npm cache. `claude mcp add` records a command; it does not install or start it.

The smoke test only searches the checkout, its current directory, and Greg’s npx cache: [remote-smoke-browser.mjs](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/remote-smoke-browser.mjs:44). With an empty `/home`, no checkout, and no MCP invocation yet, it fails at `playwright-resolve`.

The next ordinary rebuild will hide this because `/home`, including both caches, survives: [README.md](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:11). A new volume or clean bootstrap exposes it.

Provision a small pinned `playwright-core` installation without browsers, or make doctor exercise the MCP itself and stop borrowing dependencies from an incidental cache.

2. **Blocker — neither verification path exercises the Playwright MCP.**

The new check proves that Claude stored the text `--browser chrome`. It passes even if:

- the MCP package cannot install;
- the pinned version rejects the option;
- the MCP starts and crashes;
- channel resolution stops finding Chrome.

Doctor bypasses the MCP completely: it imports `playwright-core` and supplies `executablePath` itself: [remote-smoke-browser.mjs](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/remote-smoke-browser.mjs:159). Therefore the comment claiming that capability is asserted separately is too broad. Ad-hoc Playwright capability is asserted; MCP capability is not.

The configuration check is not worthless—keep it as a registration check—but add an MCP-over-stdio navigation against a localhost page. Your empty-cache measurement harness is almost exactly the required test.

This is more important because [provision.sh](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/provision.sh:378) does not reproducibly pin `0.0.79`; it resolves whatever npm calls latest during each rebuild.

3. **Medium — `install chromium` downloaded more than the two browser binaries.**

Playwright 1.62.1 resolves `install chromium` to Chromium, headless shell, **and bundled ffmpeg**. [The official source adds ffmpeg for every browser target](https://github.com/microsoft/playwright/blob/v1.62.1/packages/playwright-core/src/server/registry/index.ts#L1377-L1405).

That matters because the repo’s browser-control guide advertises `recordVideo`: [playwright-browser-control.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/reusable/playwright-browser-control.md:318). Video recording with system Chrome still requires Playwright’s ffmpeg executable. No committed script currently records video, so this is a documented-capability regression rather than a proven current workload failure.

Consequently, `/proc/<pid>/exe` proves that the observed browser process did not use downloaded Chromium. It does not prove that every downloaded asset was unused or that every ad-hoc script is unaffected.

4. **Medium — two documentation claims are wrong.**

- “Until a re-provision” is false. `~/.cache/ms-playwright` is under persistent `/home`, so a rebuild preserves the 651 MB: [browser-control.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/browser-control.md:48). It remains until explicitly deleted or garbage-collected.
- Bare `npx playwright install chromium` can recreate the same revision mismatch you just diagnosed. Playwright requires the browser matching the calling client version. Use the exact matching version, such as `npx playwright@1.62.1 install chromium`, or that client’s own CLI. [Playwright documents that every client version needs its corresponding browser binaries](https://playwright.dev/docs/browsers).

## Direct answers

1. **Shared libraries:** yes, the removal itself is safe. `install chromium` does not install apt libraries; `install-deps chromium` is the separate operation that does that. System Chrome’s Debian package also declares its own runtime dependencies. [Playwright explicitly separates browser installation from system-dependency installation](https://playwright.dev/docs/browsers#install-system-dependencies).

   The comment “shared libraries … and nothing else” is inaccurate: `install-deps` also installs its `tools` group, including fonts and Xvfb. [Playwright’s Ubuntu 24.04 dependency list shows both groups](https://github.com/microsoft/playwright/blob/v1.62.1/packages/playwright-core/src/server/registry/nativeDeps.ts#L452-L489).

2. **Flag:** `--browser chrome` is correct for `@playwright/mcp@0.0.79`; that exact release documents both `--browser chrome` and `--executable-path`. [Official v0.0.79 options](https://github.com/microsoft/playwright-mcp/blob/v0.0.79/README.md#configuration).

   For your invariant—this exact system executable—I would use both:

   ```text
   --browser chrome --executable-path /usr/bin/google-chrome-stable
   ```

   `--browser chrome` selects Chromium/Chrome channel behavior; `--executable-path` removes dependence on Playwright’s channel-location registry. More importantly, hardcode the reviewed MCP version and test it. No flag is robust against unreviewed future `latest`.

3. **Configuration check:** useful but self-fulfilling. Keep it, describe it narrowly, and add a real MCP smoke test. The neighbouring checks do not make it stronger.

4. **Other fresh-box risks:** the clean-home `playwright-core` failure, untested MCP startup, floating rebuild version, lost ffmpeg capability, persistent cache wording, and version-mismatched recovery command are the concrete ones I found.

I independently confirmed the shell still parses and ShellCheck remains clean. I could not rerun the TypeScript preflight in this read-only sandbox because `tsx` could not create its IPC socket; your mutation evidence is stronger than a second ordinary green run anyway.