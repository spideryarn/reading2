Not safe to publish as written. The ownership and idle guarantees are both breakable.

1. **Blocker — the script does not enforce “only tabs it created.”** `run` and `close` accept any visible session UUID; `ITERM_FORCE=1` even removes the busy check. An agent can list another person’s idle shell and close it successfully.  
   **Correction:** record every UUID returned by `new` in an agent-specific ownership file/token, and require membership for both `run` and `close`. Ownership must never be force-bypassable.

2. **Blocker — `tty_busy` misses background and suspended jobs.** `sleep 60 &` lacks `+`; after `^Z`, the shell regains the foreground and the stopped job normally has `T` without `+`. Both therefore look idle. `+` means only “foreground process group,” not “this tty has no other work.” [The macOS `ps` manual confirms both meanings.](https://keith.github.io/xcode-man-pages/ps.1.html)  
   **Correction:** examine every process attached to the tty. Any process beyond the recorded idle baseline—including background and stopped processes—must mean busy.

3. **Blocker — missing or failed `ps` information fails open.** A nonexistent tty, permission failure, unsupported `ps` invocation, or empty output makes `awk` report no busy foreground process, so closing proceeds.  
   **Correction:** capture `ps` output first; require successful exit, nonempty output, and the expected baseline shell/session processes. Every anomaly returns busy.

4. **Blocker — the shell allow-list is not an idle test.** A foreground `zsh` executing builtins, a sourced script, `zsh script`, or any executable presenting an allowed accounting name is classified idle. Conversely, an unlisted interactive shell is conservatively busy, which is safe. Without shell integration, a shell executing a builtin is indistinguishable from that shell sitting at a prompt using this data alone.  
   **Correction:** combine an exact process-baseline check with a confirmed prompt state or completion handshake. If prompt state cannot be established, refuse automatic close.

5. **Should-fix — the `comm` parser is structurally wrong.** `$2` captures only the first whitespace-delimited piece. Paths or command names containing spaces are truncated; a foreground command whose first displayed word reduces to an allowed name can evade the guard. macOS also warns that displayed command data is mutable and that only `ucomm` is dependable. [See `ps(1)`.](https://keith.github.io/xcode-man-pages/ps.1.html)  
   **Correction:** stop deciding safety by command name. If names remain diagnostic, use `ucomm` and preserve the entire final field.

6. **Blocker — the empty-self bug is real.** With `me=""`, this guard:

   ```bash
   [ "$sid" != "$me" ] || refuse
   ```

   allows every nonempty SID—including the caller’s actual session. `cmd_new` rejects empty self; `cmd_close` does not.  
   **Correction:** every mutating command must first require a nonempty, syntactically valid `prefix:UUID`, resolve that UUID live, and ideally verify that its iTerm tty equals the caller’s controlling tty. Failure must disable mutation.

7. **Should-fix — inherited `ITERM_SESSION_ID` is not reliable identity.**

   - Inside an existing `tmux`, pane environments come from tmux’s stored global/session environment. `ITERM_SESSION_ID` is not in the default `update-environment` list, so it may identify the tab where the tmux server was created, not the current client. [tmux documents this environment model and default list.](https://github.com/tmux/tmux/wiki/Advanced-Use/ae175537241de0f59acbd9a08bba4bb33a3c448baf12f400d9abedb)
   - SSH does not send arbitrary environment variables by default. If explicitly forwarded, the value describes the local originating environment, not the remote iTerm session. [OpenSSH’s default is to send none.](https://keith.github.io/xcode-man-pages/ssh_config.5.html)
   - A launchd job normally has no such inherited variable; explicitly configured values can be stale.
   - Saved arrangements and process-preserving session restoration are different mechanisms. The latter reconnects to long-lived processes, so assumptions about refreshed environment values need direct testing. [iTerm2 restoration documentation.](https://iterm2.com/documentation-restoration.html)

   **Correction:** explicitly fail closed under `TMUX`/`STY`, SSH, no controlling tty, or a live UUID/tty mismatch unless that environment has its own tested identification mechanism.

8. **Should-fix — tmux/screen and SSH are only accidentally conservative.** A foreground regular `tmux`, `screen`, or `ssh` process is not allow-listed, so it refuses. Backgrounded variants are missed. iTerm’s `tmux -CC` integration is more dangerous: closing an iTerm session/tab can kill the corresponding tmux session/window. [iTerm2 documents that behavior.](https://iterm2.com/3.5/documentation-tmux-integration.html)  
   **Correction:** declare all tmux/screen modes unsupported until separately implemented and tested.

9. **Blocker — AppleScript source injection is practical.** A single quote is harmless inside the AppleScript double-quoted literal, but `"` terminates it and permits arbitrary AppleScript injection. Backslashes are interpreted as AppleScript escapes (`\n`, `\t`, `\"`, `\\`) or cause syntax errors. A literal newline survives and can make `write` submit multiple shell lines. `$sid`, `$me`, `$text`, and `ITERM_RUN_DELAY` are all source-interpolated.  
   **Correction:** pass data as arguments:

   ```bash
   osascript - "$sid" "$text" <<'APPLESCRIPT'
   on run argv
     set sid to item 1 of argv
     set commandText to item 2 of argv
     -- static AppleScript only
   end run
   APPLESCRIPT
   ```

   Validate the delay numerically, and explicitly allow or reject multiline commands.

10. **Should-fix — there is a time-of-check/time-of-use hole.** A job may start after `tty_busy` and before the second AppleScript closes the session. Likewise, the owner’s tab count can change between counting and closing. Re-resolving the UUID prevents closing a recycled tty’s new session, but it does not make the idle decision atomic.  
    **Correction:** treat `ps` as a last defence, not proof. Require ownership plus a completion handshake under the agent’s exclusive protocol; document that the last-tab/husk guard remains race-prone.

11. **Should-fix — focus is not fully restored.** `prevTab` restores only the previous tab of `targetWin`; it does not preserve another frontmost iTerm window or the active pane within a split tab. It may also overwrite a human’s selection made during the operation.  
    **Correction:** capture the globally current window, tab, and session. Restore only if selection still points at the newly created tab; otherwise leave the human’s newer choice alone. State that creation and restoration are not atomic.

12. **Should-fix — the prompt hedge is honest, but the timeout mitigation is wrong.** No primary source I found states specifically whether the deprecated AppleScript `close` bypasses confirmation. iTerm’s profile documentation says session closure can prompt, and its Python close API explicitly distinguishes normal close from `force=True`. [Profile setting](https://iterm2.com/documentation-preferences-profiles-session.html), [session API](https://iterm2.com/python-api/session.html?highlight=monitor). More importantly, Apple says an AppleScript timeout does **not cancel the operation**; it only stops the script waiting. The modal may remain. [AppleScript timeout reference.](https://developer.apple.com/library/archive/documentation/AppleScript/Conceptual/AppleScriptLangGuide/reference/ASLR_control_statements.html)  
    **Correction:** say the timeout limits `osascript`’s wait but may leave iTerm blocked. Do not call it a defence against the modal.

13. **Should-fix — Permissions overstates and misattributes behavior.** The first attempt may prompt; it is not guaranteed to do so when previously denied, policy-blocked, sandbox-restricted, or running without an interactive GUI context. Permission is associated with macOS’s responsible requesting application, not simply “whatever spawned” `osascript`. Also, a non-triggering preflight exists: `AEDeterminePermissionToAutomateTarget(..., askUserIfNeeded: false)`. [Apple’s Automation discussion.](https://developer.apple.com/videos/play/wwdc2019/701/)  
    **Correction:** describe the prompt as conditional, identify the app shown under Automation, and say `-1743` means authorization was denied/unavailable—not always merely “ask the human.”

14. **Should-fix — `session_tty` hides permission and AppleScript failures.** Its `2>/dev/null` turns `-1743`, syntax errors, and iTerm failures into “session not found.”  
    **Correction:** preserve exit status and stderr; distinguish lookup-not-found from lookup-failed.

15. **Should-fix — several general claims exceed the evidence.**

    - One mismatch proves `wNtNpN` is not a live coordinate; it does not prove those values are “creation-time labels” or “never updated.”
    - One `-1728` proves `index` failed in that tested case/version, not that it universally never works.
    - A session UUID identifies a session/pane, not a tab when splits exist.
    - “The UUID … is the only thing that is stable” is broader than the evidence.

    **Correction:** qualify all four to iTerm2 3.6.6 and the observed cases; call the UUID the chosen live-session handle, not a universal tab identifier.

16. **Nit — the platform version is inconsistent.** Darwin 25.x corresponds to macOS 26, not macOS 15; Apple lists macOS 26 builds as `25…`. [Apple releases](https://developer.apple.com/news/releases/?id=01262026m).  
    **Correction:** write “macOS 26, Darwin 25.6.0,” or omit the marketing version.