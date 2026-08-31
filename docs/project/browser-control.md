# Browser control: which mechanism, which machine

There are two ways to drive a browser here, and **which one you get is decided by the machine you
are running on, not by preference**. Pick the wrong one and you spend an hour on a handshake that
cannot complete. This page is the fork in the road and nothing else; each branch has its own docs.

| | On Greg's laptop | On the remote box (`gjd-remote`) |
|---|---|---|
| Mechanism | the **Claude-in-Chrome extension** | **Playwright** against system Chrome |
| Tools | `mcp__claude-in-chrome__*` | the `playwright` and `chrome-devtools` MCPs, or a script |
| Chrome | Greg's own, signed in, with his profiles | headless, `--isolated`, signed in to nothing |
| You can see it | yes, it's his screen | only through noVNC, or a screenshot you write to disk |
| The other one | — | **the extension cannot follow you here** |

The extension needs a Chrome that a human has signed into and granted permissions in, so there is no
version of it that works on a headless server. That is the whole reason the second column exists.

## On the laptop

- **[claude-in-chrome.md](claude-in-chrome.md)** — getting the extension to talk to Claude Code at
  all. `list_connected_browsers` returning `[]` is almost always the wrong Chrome profile. Start
  here when nothing is connected; it stops at the handshake.
- **[browser-testing.md](browser-testing.md)** — everything after the handshake: what to look at in
  the reading view, and the many ways a browser lies to you about what it just showed. Open it
  before any UI check.

Do the handshake in the parent session, then hand the clicking to a Sonnet subagent — the
screenshots are large and the reasoning is small.

## On the remote box

- **[playwright-browser-control.md](../reusable/playwright-browser-control.md)** — the cheatsheet:
  locators, auto-waiting, screenshots, console and network capture, and the traps (the action
  timeout is 0, not 30 seconds). Written for an agent that cannot see the screen.
- **[`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs)** — the committed
  proof that the stack works. `npx tsx scripts/gjd-remote.ts doctor` copies it to the box and runs
  it on every invocation, so it is never a stale copy; the `browser` line is this test.
- **[infra/hetzner/README.md](../../infra/hetzner/README.md)** — the box itself: `gjd-remote tunnel`
  plus `start-vnc` to watch the browser over noVNC, why Playwright runs `--isolated`, and why the
  MCP list is deliberately short.

Two things about that box will catch you out:

- **There is one browser on that box, and it is system Chrome.** Both MCPs launch
  `/opt/google/chrome/chrome` — the Playwright one is given
  `--browser chrome --executable-path /usr/bin/google-chrome-stable` explicitly — and the
  smoke test names it in `executablePath`. Set it yourself in any script you write. A bare
  `chromium.launch()` asks for Playwright's *bundled* chromium, which provisioning no longer
  downloads, and dies with "Executable doesn't exist". The old 651MB is still in
  `~/.cache/ms-playwright` on the live box and **a rebuild will not clear it** — that path is under
  `/home`, which is the persistent volume — so it sits there until someone deletes it. If you do
  need Playwright's own browser, install it **version-matched** to the client you are about to run
  (`npx playwright@1.62.1 install chromium`); a bare `npx playwright install` fetches `@latest` and
  reproduces the revision mismatch.
- **`playwright-core` is a pinned devDependency of this repo**, so a checkout that has run `npm ci`
  has the version our lockfile names. On a box with no checkout the smoke test falls back to
  borrowing a copy from the npx cache, at whatever version the MCPs bundled; it prints which root it
  used, so a run on the fallback tells you so. See `PLAYWRIGHT_ROOTS` in the script.

### The known hole, on the box

**Nothing yet drives the MCPs as a check.** `gjd-remote doctor` imports `playwright-core` and
launches Chrome itself, so it proves *ad-hoc* Playwright works and says nothing about the two MCP
servers — which is what an agent there actually reaches for. Provisioning only asserts that the
registration text is right, which passes even if the package cannot install or the server starts and
crashes. `claude mcp list` saying **✔ Connected** is the MCP handshake, not a browser: on 2026-08-31
both said Connected while one of them was, on the evidence available at the time, expected to be
unable to launch. Driving them over stdio is the check that would close it. Until it exists, if you
depend on an MCP there, open one page with it before you trust it.

`gjd-remote doctor` has had an `mcp` check since 2026-08-31 and it does **not** close this hole. It
covers the three service servers in [`.mcp.json`](../../.mcp.json), not `playwright` and
`chrome-devtools`, and what it asserts is the handshake, not a browser. Everything above still
stands for both browser MCPs.

## The trap both halves share

**A browser that renders nothing still produces a perfectly valid screenshot.** Right magic bytes,
right dimensions, every time. So "the screenshot came back" is not evidence, on either machine, and
neither is "no exception was thrown" — which is equally true of a page that never loaded. Assert on
something that *changed*: text before and after a click, two visually different pages whose bytes
differ. The smoke test does all three deliberately, and says so in its header comment.

This is the house failure pattern, not a browser quirk —
[silent-success.md](../reusable/silent-success.md).

## Last verified

2026-08-31. `gjd-remote doctor` reported 13 of 14 checks passing (`mosh` skipped: no TTY), with
Chrome 152.0.7977.64 driven through `playwright-core`, two distinct PNGs at the requested size, and
the clicked text changing. Separately, a real page was loaded over the network from the box,
screenshotted, copied back to the laptop and looked at. Both browser MCPs reported connected.

---

Up: [code-quality-overview.md](code-quality-overview.md)
