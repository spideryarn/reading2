# Keyboard shortcut libraries, and what Ctrl/Cmd-Enter does by default

Researched 2026-09-29, for the fourth shortcut (⌘-Enter / Ctrl-Enter opens Metadata). **Conclusion:
adopt no library; consolidate our own guards into one small helper module (about 40 lines).** Every
library either skips fewer of our guards than we already apply (IME, auto-repeat, `dialog[open]`,
claimed-only `preventDefault`) or defaults to the opposite of what we want (`preventDefault` on by
default in TanStack). The one problem we really have is three copies of `isTyping` and five copies
of the same guard list; a module fixes that without a dependency. For the Windows/Linux key, use
**Ctrl-Enter**: it is the natural twin of ⌘-Enter, and the browsers do nothing with it on a page
except turn it into a new-tab click on a focused link (which we would be claiming anyway).

## What we have and what we need

Five hand-rolled `window` keydown listeners (↑/↓, ←/→ in Trajectory, ⌘-K, G, and soon ⌘-Enter), which
between them use the guards in [keyboard.md](../project/keyboard.md) — but **not the same set each**
(GPT Sol, plan review F4): `keynav` has no dialog or composition check, ⌘-K has no
`defaultPrevented` or composition check, and G has the fullest list. The union is: no auto-repeat, not while typing (input,
textarea, select, contenteditable), not during IME composition, honour `e.defaultPrevented`, not over
an open native `<dialog>`, `preventDefault` only when claimed, reject extra modifiers.

## Candidates (npm data read 2026-09-29)

| | Last release | Weekly downloads | Size (unpacked) | React 19 | `mod` | Skips form fields | IME / repeat | Our custom guards |
|---|---|---|---|---|---|---|---|---|
| [react-hotkeys-hook](https://github.com/JohannesKlauss/react-hotkeys-hook) 5.3.3 | 2026-06 | 5.1M | 31 kB | peer `>=16.8`, yes | `mod` | yes (`enableOnFormTags: false`, `enableOnContentEditable: false`; docs list no select option) | not documented | `ignoreEventWhen` hook exists; `preventDefault` is opt-in per binding, not "only if claimed" |
| [tinykeys](https://github.com/jamiebuilds/tinykeys) 4.0.1 | 2026-09 | 402k | 77 kB unpacked (docs say ~650 B min) | framework-free | `$mod` | yes, incl. contenteditable and select, unless it is the target | ignores both (source: "Always ignore repeated keyboard events", "…during composition input") | never calls `preventDefault` itself; you add it, so claimed-only is natural; the ignore function is replaceable |
| [hotkeys-js](https://github.com/jaywcjlove/hotkeys) 4.0.8 | 2026-09 | 1.7M | 4.9 MB unpacked (misleading: bundles docs) | framework-free | no `mod` (you pick `command`/`ctrl`) | input/select/textarea only by default, filter is overridable | not documented | filter function only |
| [@tanstack/react-hotkeys](https://tanstack.com/hotkeys/latest) 0.12.1 | 2026-09-27 | 1.2M | 56 kB | peer `>=16.8` | `Mod` | ignores single keys in text fields, allows Ctrl/Meta chords everywhere (`ignoreInputs`) | `requireReset` for once-per-press; IME not documented | `preventDefault` and `stopPropagation` default **true**, the reverse of our rule. **Alpha**, and 0.x means API churn |
| [mousetrap](https://github.com/ccampbell/mousetrap) 1.6.5 | 2025-02 | 1.1M | 196 kB unpacked | framework-free, no types shipped | `mod` | yes (input/select/textarea only, not contenteditable) | no | old; effectively finished, not maintained |
| [@github/hotkey](https://github.com/github/hotkey) 3.1.4 | 2026-08 | 30k | 33 kB | attribute-driven, not hooks | `Mod` | yes | not documented | small community, built around `data-hotkey` attributes |
| react-hotkeys (greena13) | v2.0.0, years ago | n/a | n/a | unmaintained | | | | ruled out |

Downloads are a proxy for community size only. react-hotkeys-hook is the clear leader for React and
has the most pretraining data, which is the selection doc's headline criterion
([third-party-library-selection.md](../reusable/third-party-library-selection.md)). TanStack Hotkeys
has the best types (logical and physical bindings, `formatForDisplay`, sequences, a registry for help
screens) but says itself it is alpha.

## Does a library solve a problem we have?

- **Cross-platform `mod`:** yes in all, but it is one line here (`e.metaKey` on Mac, `e.ctrlKey`
  otherwise), and `useCommandBarChord` already has it.
- **Guards:** none of them does all of ours. We would keep a wrapper around the library that
  re-implements `dialog[open]`, IME, repeat and claimed-only `preventDefault`, so we would own the
  guards *and* the dependency.
- **Sequences, key recording, a shortcut help screen:** genuinely valuable in TanStack and
  react-hotkeys-hook, but we have one letter, one chord and arrows, and no help screen planned.
- **Type safety:** ours is a plain `KeyboardEvent`, so no gain worth a dependency.
- **The real problem** is duplication: three `isTyping` copies and every listener re-listing the same
  eight guards, so a fix to one (say, IME in Safari) has to be made five times. That is a module, not
  a library.

## Browser defaults for Enter with a modifier (focus on the page, not the address bar)

Measured 2026-09-29 in headless Chrome 152 on Linux (synthetic key presses via Playwright, logging
`click` events); other rows are from the vendor pages linked.

- **Nothing focused:** Ctrl/Alt/Meta/Shift-Enter do nothing, no click and no navigation.
- **Focused link:** Enter makes the browser fire a synthetic `click`, and it carries the modifier:
  Ctrl-Enter gave `ctrlKey: true`, Alt-Enter `altKey: true`, Meta-Enter `metaKey: true`, Shift-Enter
  none. So Ctrl-Enter (Windows/Linux) and ⌘-Enter (Mac) act as ctrl/cmd-click, **open in a new tab**;
  Alt-Enter acts as alt-click, which **downloads** in Chrome and Firefox
  ([Mozilla thread](https://support.mozilla.org/en-US/questions/1320409) reports "holding Alt can
  trigger a download action"). Safari documents ⌘-Return on a focused link as "open in a new tab"
  ([AppleVis](https://applevis.com/forum/macos-mac-apps/safari-short-cut-key-open-link-new-tab),
  [Apple](https://support.apple.com/guide/safari/keyboard-shortcuts-and-gestures-cpsh003/mac)). Calling
  `preventDefault()` on the keydown suppresses that click.
- **Focused button:** Ctrl/Alt/Meta-Enter fired **no click** in Chrome 152; plain and Shift-Enter did.
  So the chord does not accidentally press a button.
- **Address bar (not ours, listed so nobody is surprised):** Ctrl-Enter adds `www.` and `.com`;
  Alt-Enter opens the search in a new tab; Ctrl-Shift-Enter does the same in a new window
  ([Chrome help](https://support.google.com/chrome/answer/157179),
  [Edge](https://support.microsoft.com/en-us/microsoft-edge/keyboard-shortcuts-in-microsoft-edge-50d3edab-30d9-c7e4-21ce-37fe2713cfad),
  [Firefox address bar](https://support.mozilla.org/en-US/kb/keyboard-shortcuts-perform-firefox-tasks-quickly)
  and Safari ⌘-Return in Smart Search). These fire in the browser chrome and never reach the page.
- **Not verified here:** Firefox, Safari and Edge behaviour on a page was not run; it rests on the
  vendor pages above and on the shared HTML rule that Enter on a link synthesises a click.

**Picking the Windows/Linux key.** Ctrl-Enter: mirrors ⌘-Enter exactly, and the only page-level
default (new-tab on a focused link) is one we override on purpose when we claim the press. **Avoid
Alt-Enter:** it is the download modifier on links and Alt is the menu key on Windows.

Two rules for the new chord: claim it only when the press is ours (so a focused link keeps Ctrl-Enter
where we do not act), and add Enter to the same guards, including `isComposing`, because Enter is the
key IMEs use to commit text.

## Recommendation: (b), one small helper module

Sketch of the module, name and location to be chosen when it is built:

- `isTypingTarget(el)`, `overOpenModal()`, and a `shouldIgnore(e)` combining repeat, IME, typing and
  `defaultPrevented`.
- `hasMod(e)` (meta on Mac, ctrl elsewhere) plus `noExtraModifiers(e, allowed)`.
- One `useKeyChord` wrapper that runs the guards, calls the handler, and `preventDefault`s only when
  the handler returns `true` (claimed).

Then migrate ⌘-K, G, ↑/↓ and the new chord onto it.

**What was built is narrower than this sketch, on purpose**
([260929g](../plans/260929g-shelf-search-focus-and-metadata-chord.md)): the listeners claim keys by
different policies, so only `isTyping` and the modifier-chord test were shared, and no wrapper hook. About 40 lines plus a test file per guard, and no
dependency. **Revisit and adopt TanStack Hotkeys or react-hotkeys-hook** only if we later want
sequences, user-remappable keys or an in-app shortcut list. If we do, `tinykeys` is the closest fit to
our conventions: it already skips repeat, IME and every form field, and leaves `preventDefault` to us.

Up: [../project/keyboard.md](../project/keyboard.md)
