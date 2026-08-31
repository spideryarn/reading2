# Connecting Claude-in-Chrome

Getting the extension to talk to Claude Code at all. Once it does,
[browser-testing.md](browser-testing.md) is what to do with it — this doc stops at the handshake.
On the remote box there is no extension to connect and there cannot be one, so none of this applies
there; [browser-control.md](browser-control.md) is the fork in the road.

> **This is a fluid situation.** The extension, the pairing flow and the transport are all moving,
> and the version numbers below (extension 1.0.85, Claude Code 2.1.251, 2026-08-30) are the ones
> this was true for. Treat the *diagnosis order* as the durable part and the specific file paths as
> a snapshot. If something here doesn't match what you find, believe what you find.

## The one-line diagnostic

```
list_connected_browsers    # [] means nothing is paired. Stop and read on.
```

Run it **first**, before blaming anything else. An empty list is not a broken extension and not
broken plumbing — it almost always means the extension isn't signed in, in the profile you're
looking at. `switch_browser` then reports "No other browsers available to switch to", which reads
like a bug and isn't.

## What actually goes wrong: the wrong Chrome profile

Greg has several Chrome profiles under one running Chrome. The extension's state is **per profile**,
so signing in once does not sign in everywhere, and neither the manifest nor the extension listing
gives any hint which profile is the connected one.

On 2026-08-30 the extension was installed and enabled in three profiles, and only one of them had
ever completed sign-in:

| | Profile 1 "Rehearsable" | Profile 15 "gregdetre.com" |
|---|---|---|
| Extension installed + enabled | yes | yes |
| Extension storage | full state, a paired `deviceId` | `codeVerifier` + `oauthState` and nothing else |
| Meaning | signed in, works | **a sign-in that was started and never came back** |

Greg had moved from the first profile to the second, so nothing connected. The fix was one sign-in
in the profile he was actually working in. Nothing on the machine needed touching.

**The tell is the extension's own storage.** Two keys and no more means an abandoned OAuth round
trip:

```bash
cd ~/Library/Application\ Support/Google/Chrome
strings "Profile 15/Local Extension Settings/fcoeoabgfenejglbffodgkkbkcdhcgfn/"*.log
```

A working profile has `chrome_ext_system_prompt`, `mainTabId`, a `deviceId` and a good deal more.

## What is *not* worth checking first

An hour went into these on 2026-08-30 and every one of them was fine. They're listed so the next
session can skip them, not because they're likely.

- **The native-messaging manifests.** Both live in the Chrome *user-data* directory
  (`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`), which is shared by every
  profile — so they cannot be the reason one profile works and another doesn't.
  `com.anthropic.claude_code_browser_extension.json` points at `~/.claude/chrome/chrome-native-host`,
  a two-line wrapper around `claude --chrome-native-host`.
- **Whether the extension is enabled.** Read `disable_reasons` and `granted_permissions` out of each
  profile's `Secure Preferences`, not `Preferences` — the key is `extensions.settings.<id>`, and
  `nativeMessaging` needs to be in the granted list.
- **Whether the `claude` binary the manifest names still exists.** It's a symlink into
  `~/.local/share/claude/versions/`, so a version bump could in principle strand it. It hadn't.

### The running native host is a red herring

`ps aux | grep chrome-native-host` showed two processes, both
`/Applications/Claude.app/Contents/Helpers/chrome-native-host` — Claude **Desktop's** host, not
Claude Code's. That looks damning and means nothing: the pairing that eventually worked went
through the **cloud relay** (a `deviceId`, an `osPlatform`, a `connectedAt`), and Claude Code's
local native host was never launched at any point, before or after the fix.

The practical consequence is that this path needs the extension signed into the right *Claude*
account and needs network. The Chrome profile's Google account is irrelevant to it.

## Where the pairing is remembered

`~/.claude.json`, at the top level:

```json
"chromeExtension": { "pairedDeviceId": "…", "pairedDeviceName": "Browser 1" }
```

It survives across sessions, so a working setup reconnects on its own. It also **keeps pointing at
a device that no longer exists** — after the 2026-08-30 sign-in the id changed, and the stale one
had sat there since the previous profile. If a browser is connected but you keep being handed a
device that isn't it, that key is the thing to clear.

Every browser here is named `Browser 1`, so the name distinguishes nothing. Compare `deviceId`s.

## The clicks, when it needs a human

An agent cannot do this part: it's an OAuth flow, and there's no browser connection to drive yet
anyway — which is the whole chicken-and-egg of it. Write the clicks down and hand them over
(the habit is [asking-greg-questions](../reusable/README.md), and it applies to any blocked auth):

1. In the window of the profile you want, click the Claude extension icon (puzzle piece → **Claude**).
2. Sign in.
3. Find the connect control and connect it to **Claude Code** — the same extension also serves
   Claude Desktop, and being signed in is not the same as being pointed here.
4. Grant site permission for whatever needs driving; the extension gates automation per site.
5. Back in Claude Code, `list_connected_browsers` → `select_browser` with the `deviceId`.

If step 2 loops or stalls, the abandoned `codeVerifier` in that profile is the suspect: remove and
reinstall the extension in that profile to clear it, then sign in fresh.

## Then hand it to a subagent

Browser work goes to a Sonnet subagent — it's mostly click-look-click and the screenshots are large.
But **do the handshake in the parent first**, or the subagent will stall silently for half an hour:
[browser-testing.md § A browser subagent stalls silently unless the parent does the handshake first](browser-testing.md#a-browser-subagent-stalls-silently-unless-the-parent-does-the-handshake-first).

That section also has the rule that matters more than any of this — a stuck browser agent and a
working one look identical from outside, so read the dev server's log rather than the agent.

---

Up: [code-quality-overview.md](code-quality-overview.md)
