# Browser control: which mechanism, which machine

There are two ways to drive a browser here, and **which one you get is decided by the machine you
are running on, not by preference**. Pick the wrong one and you spend an hour on a handshake that
cannot complete. This page is the fork in the road and nothing else; each branch has its own docs.

| | On Greg's laptop | On the remote box (`gjd-remote`) |
|---|---|---|
| Mechanism | the **Claude-in-Chrome extension** | **Playwright** against system Chrome |
| Tools | `mcp__claude-in-chrome__*` | the `playwright` and `chrome-devtools` MCPs, or a script |
| Which of the two | — | **[Playwright unless you are profiling](#two-mcps-on-the-box-and-which-one-to-open)** |
| Chrome | Greg's own, signed in, with his profiles | headless, `--isolated`, signed in to nothing |
| You can see it | yes, it's his screen | only through noVNC, or a screenshot you write to disk |
| The other one | — | **the extension cannot follow you here** |

The extension needs a Chrome that a human has signed into and granted permissions in, so there is no
version of it that works on a headless server. That is the whole reason the second column exists.

## On the laptop

- **[claude-in-chrome.md](../reusable/claude-in-chrome.md)** — getting the extension to talk to Claude Code at
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

### Two MCPs on the box, and which one to open

**Open `playwright`. Open `chrome-devtools` only when the question is about performance.**

They are not a pair you use together, and the tempting summary — *Playwright drives,
chrome-devtools debugs* — is wrong in a way that will cost you an hour. **Each server launches its
own Chrome**, and with `--isolated` each gets its own fresh profile, so there is no handing a page
from one to the other: you cannot drive a flow in Playwright and then ask chrome-devtools what the
network did, because it is looking at a different browser that never saw your flow. Whichever one
you open owns the session from navigation to the end of it.

Playwright is the default because it covers everything ordinary browser work needs — clicking,
typing, forms, screenshots, **console messages and network requests included** — and because its
headless-on-Linux path is the one this box has run longest.

Reach for `chrome-devtools` when, and only when, you need something Playwright has not got at all:

| | |
|---|---|
| Performance traces, Core Web Vitals (LCP/INP/CLS) | `performance_start_trace`, `performance_analyze_insight` |
| A Lighthouse audit | `lighthouse_audit` |
| Heap snapshots | `take_heapsnapshot` |
| CPU and network throttling | `emulate` |

Two traps in that table. `navigate_page` wants a `pageId` — `new_page` is the tool that both creates
and navigates, and it is what you want first. And a performance trace taken on this box measures the
box: several agents launching Chrome at once is most of what you will see, so take a serious
measurement when it is quiet, or record the load beside the number.

**Do not add `--caps devtools` to Playwright to avoid all this.** It sounds like it would close the
gap and it does not: measured on 0.0.80, its 13 extra tools are Playwright's own trace viewer,
video recording and element highlighting — tools for debugging *your automation*, not the page.
There is no page profiler in there, and it costs ~1,800 tokens of schema.

**What chrome-devtools sends, and what it hides.** Its registration on the box carries four flags
beyond `--headless` that its defaults get wrong for us; the reasoning is in
[`provision.sh`](../../infra/hetzner/provision.sh) at `=== mcp servers ===`. Two are worth knowing
here. `--no-performanceCrux`, because a performance trace otherwise sends the URLs it traced to
Google's CrUX API, and agents here drive pages holding real reader content. And
`--redactNetworkHeaders`, because without it a live `authorization: Bearer …` comes straight back
into model context — measured. **That flag is not a boundary**: it redacts by a safe-list, so it
also blanks custom headers you may be debugging with, and it does not touch request or response
*bodies*, so a token in a JSON payload still comes through. Playwright's network tools have no
equivalent flag at all. Prefer a seeded test account over a real one.

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

### The hole that was here, and what closed it

Until 2026-09-08 **nothing drove the MCPs as a check**, and the gap was not academic: it hid a real
misconfiguration for eight days. `claude mcp list` saying **✔ Connected** is the MCP handshake, not a
browser, and on 2026-08-31 both servers said Connected while one was, on the evidence then available,
expected to be unable to launch. Nobody found out either way.

[`scripts/remote-smoke-mcp-browser.mjs`](../../scripts/remote-smoke-mcp-browser.mjs) is the check.
`gjd-remote doctor` runs it as **`browser mcp`**, separately from `browser` — the latter imports
`playwright-core` and launches Chrome itself, so it proves *ad-hoc* Playwright works and says nothing
about the servers an agent actually reaches for. Four things in it are load-bearing, each a way the
check could have passed while the servers were broken; its header comment says which, and the one
worth knowing here is that **it starts two of each server at once**. That is what caught the bug: on
a box built for parallel sessions, `chrome-devtools` was registered without `--isolated`, so the
second agent to reach for it got `The browser is already running for …`. One at a time passes
happily. It also gives the two instances different markers, so two servers that ended up sharing a
browser fail rather than agreeing with each other.

Three checks remain narrower than they look. The `mcp` check covers the three service servers in
[`.mcp.json`](../../.mcp.json) and asserts the handshake only. Provisioning asserts the registration
*text*, which passes even if the package cannot install. And `browser mcp` proves MCP → browser
control with a `data:` URL — it says nothing about the app, auth or local Supabase.

## The trap both halves share

**A browser that renders nothing still produces a perfectly valid screenshot.** Right magic bytes,
right dimensions, every time. So "the screenshot came back" is not evidence, on either machine, and
neither is "no exception was thrown" — which is equally true of a page that never loaded. Assert on
something that *changed*: text before and after a click, two visually different pages whose bytes
differ. The smoke test does all three deliberately, and says so in its header comment.

This is the house failure pattern, not a browser quirk —
[silent-success.md](../reusable/silent-success.md).

## Last verified

2026-09-08, on the box, against `@playwright/mcp@0.0.80` and `chrome-devtools-mcp@1.8.0`. Both
servers were driven over stdio and each opened a page whose marker came back; run two at a time,
`chrome-devtools` failed on the shared profile and passed once `--isolated` was added, so the new
`browser mcp` check has been seen both red and green. Tool surfaces were measured from `tools/list`:
24 tools for Playwright, 29 for chrome-devtools, roughly 4.6K and 6.4K tokens of schema — an estimate
from wire bytes, not a measured prompt charge, and Claude Code defers schemas anyway, so neither is a
standing per-session cost. The widely repeated "17–18K tokens" figure for chrome-devtools did not
reproduce on 1.8.0.

2026-08-31. `gjd-remote doctor` reported 13 of 14 checks passing (`mosh` skipped: no TTY), with
Chrome 152.0.7977.64 driven through `playwright-core`, two distinct PNGs at the requested size, and
the clicked text changing. Separately, a real page was loaded over the network from the box,
screenshotted, copied back to the laptop and looked at. Both browser MCPs reported connected.

---

Up: [code-quality-overview.md](code-quality-overview.md)
