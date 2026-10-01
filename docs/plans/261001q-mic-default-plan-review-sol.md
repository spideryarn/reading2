No P0 findings. I found two P1 correctness gaps: the plan does not actually make Chrome follow the macOS default, and it leaves the shared live-conversation path inconsistent.

## P1

1. **The “system default” conclusion is not supported, and the proposed change is currently only cosmetic.**

The strongest contrary evidence is already in this repo: before the app had a picker or remembered ID, `getUserMedia({audio:true})` opened the silent Teams virtual device on Greg’s Mac ([260827k](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/docs/plans/260827k-microphone-device-and-recording.md:23), [mic-devices.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/mic-devices.ts:7)). That is exactly the “nothing remembered, non-OS device” path the new plan treats as merely unreproduced.

Chrome has a profile-level default microphone that it describes as applying across sites. Since Chrome 123, its permission prompt can also collect a device choice; current Chrome deliberately gives such a user preference precedence over an `ideal` device constraint. An `exact` constraint is required when the page must select a specific device. [Chrome’s help](https://support.google.com/chrome/answer/2693767?hl=en-GBso), [Chromium’s constraint-change announcement](https://groups.google.com/a/chromium.org/g/blink-dev/c/El5jaGnhVu4/m/JXlbaV4KAwAJ). The media-capture specification also explicitly permits browser/user preference to override non-required constraints. [Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/).

Consequences:

- A stale app selection is plausible, but not demonstrably the strongest diagnosis. Chrome’s own selected/default microphone is at least equally plausible.
- Renaming the null option to “System default” at [plan line 70](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/docs/plans/261001q-mic-follows-the-system-default-and-says-which.md:70) is inaccurate while null still produces `{audio:true}`.
- `{deviceId:{ideal:"default"}}` is not sufficient either: recent Chrome may still prefer the device chosen through its permission UI.
- The claim that Chrome’s label reveals whether an app pick is active is unreliable. Plain capture can return a physical, bare-labelled browser-preferred device. Use `dictation.deviceId` to display provenance instead of inferring it from `track.label`.

Concrete fix: decide which behavior is intended.

- If browser choice is intended, retain `{audio:true}`, call the option “Browser choice” or “Chrome default,” and retitle/rewrite the plan.
- If the macOS default is intended, explicitly select Chromium’s virtual `deviceId: "default"` with `exact` when Chromium/default-device support is known, falling back to `{audio:true}` elsewhere. Safari and Firefox use unconstrained capture as their portable system-default route. WebKit documents that unconstrained capture uses the system microphone; Firefox likewise recommends `{audio:true}` rather than relying on a `"default"` input ID. [WebKit bug 198577](https://bugs.webkit.org/show_bug.cgi?id=198577), [Firefox bug 1850082](https://bugzilla.mozilla.org/show_bug.cgi?id=1850082).

`ideal:"default"` is unlikely to break Safari/iOS or Firefox because it is optional and an unavailable ideal falls back. But `"default"` is not a standardized magic ID for audio input, so it is neither portable nor guaranteed to mean the OS default. Also, the cited iPhone double-prompt plan concerns two API requests—the speech-recognition probe plus `getUserMedia`—not changing the constraints on one `getUserMedia` call; it does not support the claimed constraint risk.

2. **The shared live-conversation surface and fallback paths are omitted.**

Dictation and Live share the same stored selection, so either can create the preference consumed by the other. Yet Live still presents “Browser default” ([LiveStatus.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/live/LiveStatus.tsx:91)), while the proposed dictation picker says “System default.”

Both missing-device fallbacks also bypass `audioConstraint(null)` and literally call `{audio:true}`:

- [useDictation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/useDictation.ts:2172)
- [useLiveConversation.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/live/useLiveConversation.ts:1803)

If null is changed to mean OS default, those fallbacks will retain the old browser-choice behavior.

Concrete fix:

- Put the no-preference/system-default request in one helper and use it for all four capture sites: dictation primary, dictation fallback, Live primary, Live fallback.
- Update Live’s picker and fallback notice to the same terminology.
- Add tests for null selection and missing-device fallback in both dictation and Live, not only a DOM-copy test for `DictationStrip`.

## P2

3. **“Always says which one” can become false on narrow windows.**

`.prof-listening` is a non-wrapping flex row ([profile.css](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/styles/profile.css:118)), while the device label is the only shrinkable item and may shrink to effectively zero ([profile.css](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/styles/profile.css:236)). This is especially likely on Safari/Firefox, where the fixed status text is the long “Listening — the words appear when you stop.” A `title` does not recover the text on touch.

Concrete fix: give microphone identity its own wrapping row or wrap the device name and Change button as a group with a useful minimum width. Check 320px and 390px widths with a long virtual-device name and the non-live-text status. The current jsdom test cannot prove layout.

4. **The always-visible identity is not announced as status, and “Change” is an ambiguous accessible name.**

The mounted live region contains only `dictationWords`; the device identity is outside it ([DictationStrip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/DictationStrip.tsx:298)). A screen-reader user can navigate to the newly inserted device name, but it will not be announced when capture opens. The adjacent button’s accessible name is only “Change” ([DictationStrip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbg8byyd-mic-default/src/web/DictationStrip.tsx:330)).

Concrete fix:

- Give the button an accessible name such as `Change microphone, currently Logitech BRIO`.
- Render an explicit semantic prefix such as “Microphone:” rather than relying on the decorative `·`.
- If “says which one from the moment it opens” is intended to cover screen readers, announce the device once when it arrives, without putting the timer or interim transcript in the live region.

5. **Do not reset everybody’s remembered picks.**

The plan’s decision here is sound. A mass key rename would discard deliberate AirPods/loopback choices, and it might not fix Greg’s case if Chrome’s own preference is responsible. The visible identity plus an accurate default option is the safer migration.

For Greg’s immediate case, ask him to note the displayed device and choose the corrected system-default option once. That observation will distinguish app storage from Chrome selection. Document failure 9 as those two candidate mechanisms, not as a stale app pick established as cause.

No files were changed.