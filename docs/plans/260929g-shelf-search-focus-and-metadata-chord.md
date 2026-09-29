# The shelf's search box takes the focus, and ⌘-Enter opens Metadata

Two small feedback reports from Greg (admin, so trusted —
[feedback-reports.md](../project/feedback-reports.md)), built together because both are keyboard
work on the reader's first press.

> When I open the logged-in Spideryarn homepage with the shelf, let's put the focus by default on
> the search box.
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-5E (`spya-vz9r0h`)

> In the Reading view, if I hit Command Enter, that should open up the Metadata mode. And then maybe
> whatever the analogous keyboard shortcut should be for Windows, maybe Alt Enter. I don't know if
> that's already used for something in the browser.
>
> And add that as a tooltip to the Metadata mode.
>
> Probably use Sonnet web research and docs/reusable/third-party-library-selection.md to look for a
> nice library for keyboard shortcuts and/or reuse/amalgamate what we already have, e.g. for Cmd-k
> for Commands)
>
> — Greg, 2026-09-29, SPIDERYARN-READING2-5F (`spya-kh58z7`)

Nothing for either was on `origin/dev` when this started (`git log origin/dev`, 2026-09-29).

## Part A — the shelf's search box (5E)

`Library.tsx` focuses its `SearchBox` input once, when the shelf mounts, **unless**:

- **the primary pointer is a finger** — `media("(pointer: coarse)")` (src/web/media.ts, which is
  `false` where `matchMedia` is missing, so an unknown pointer gets the focus). Focusing an input on a
  phone pops the on-screen keyboard over half the shelf the reader came to look at. `pointer` rather
  than `any-pointer`, so a touchscreen laptop with a trackpad still gets the focus.
- **the page arrived with a query already in it** (`?q=` non-empty). The reader is looking at
  results, not about to type; focusing would put the caret at the end of their query and a stray key
  would change it.
- **something else already has the focus** (`document.activeElement` is not `body`). The shelf does
  not take the focus away from anything.

- **the box is not on screen when the shelf mounts** (Sol F1). Scroll restoration is manual
  (main.tsx) and Back is only a `popstate`, so returning from far down an article can mount the
  shelf with a large `scrollY`. Focusing an invisible field would send the reader's typing somewhere
  they cannot see; scrolling to it would yank the page. So: in view, or no focus.

`focus({ preventScroll: true })`, so arriving on the shelf never scrolls it.

Decided once, on mount, not on every render: typing a query and clearing it must not re-grab focus,
and neither must the shelf's data arriving. A client-side return to the shelf (Back from an article)
remounts `Library`, so it focuses again — that is "opening the homepage" too.

**The cost:** a keyboard reader who arrives and presses Tab now starts from the search box rather
than the top of the page, and Space and the arrow keys go to the box rather than scrolling the
shelf until they click elsewhere. That is what a focused search box means and what Greg asked for.

## Part B — ⌘-Enter / Ctrl-Enter opens the Metadata page (5F)

**Metadata is a page, not a mode** (`/read/<slug>/metadata`, a `DockLink` in the Dock since
2026-08-25). "Opens the Metadata mode" therefore means *navigate there*, exactly as clicking the
Dock's Metadata button does — same href, `readHref(slug, search, "metadata")`, same carried query.

### Which key off a Mac

**Ctrl-Enter**, the same pairing ⌘-K / Ctrl-K already uses, and by the same `metaKey || ctrlKey`
test. Alt-Enter was Greg's guess; it is not needed and is worse — Alt is the Mac's character key and
a Windows menu key, and the app has no Alt chord anywhere. The browser-default findings are in
[260929a research](../research/260929a-keyboard-shortcut-libraries.md).

### Where it does not fire

The existing ⌘-K rules, plus one of its own:

- **Only on the reading view** — where the Dock draws the Metadata link and the reader is in an
  article. Not on the metadata page itself (no toggle back — an assumption, below).
- **Not while typing** (input, textarea, select, contenteditable) — and this is not only politeness:
  **⌘/Ctrl-Enter already means "send" in five text boxes** (Feedback, Comment, Annotate, Quiz,
  Profile), all scoped to their own field. Skipping text fields is what keeps those working.
- **Not on a focused link.** ⌘/Ctrl-Enter on a focused link is a modified click — a new tab —
  and stealing that would break a browser feature on every link in the prose. A focused *button*
  is **app policy, not a browser fact**: no button here binds a modified Enter, so the chord wins
  there and still works after the reader has clicked something in the Dock. (Headless Chrome fired
  no click for Ctrl/Meta-Enter on a button, 260929a; other browsers were not measured — Sol F5.)
- Not on auto-repeat, not with Shift or Alt, not over an open native `<dialog>`, not once another
  handler has `preventDefault`ed, not during IME composition; `preventDefault()` only when claimed.

### Consolidating what we have — the library question

Greg asked for a library search *and/or* amalgamating what exists. The research is
[260929a](../research/260929a-keyboard-shortcut-libraries.md). **Adopting a library is a
dependency**, and the plan only takes one if it clearly beats consolidation. The shortcuts here are
four, each with guards particular to this app (dialog check, claimed-only `preventDefault`, the
Dock drawer's Escape collision) that a library would not know about and we would keep writing
around it.

So the default is **consolidate**: one leaf module, `src/web/key-chord.ts`, with no imports from the
reading machinery, holding

- `isTyping(el)` — the three copies (keynav.ts, Dock.tsx, TermJump.tsx) become one, using
  TermJump's stricter version (it honours a `contenteditable` host above the target). Dock.tsx's
  comment says why it copied rather than imported keynav's — the import graph — and a leaf module
  answers that.
- `isModChord(e, key)` — `⌘ or Ctrl` + key, no Shift/Alt, not a repeat, not composing
  (`isComposing` or legacy `keyCode === 229`): the test ⌘-K makes today, written once so ⌘-Enter
  cannot drift from it. **A single-letter key matches case-insensitively** (Caps Lock gives `"K"`;
  the ⌘-K handler accepts both today — Sol F2); a named key like `Enter` matches exactly.

`useCommandBarChord` and the new `useMetadataChord` both use them. keynav.ts and TermJump.tsx only
swap their private `isTyping` for the import.

### The tooltip

The Metadata card's `what` gains the chord, in the Commands card's own format:
*"… — or ⌘Enter / Ctrl-Enter from the article"*. keyboard.md gets a section beside ⌘-K.

## Assumptions (product calls taken the simple way)

1. Metadata "mode" means the Metadata page; the chord navigates, as the Dock button does.
2. Ctrl-Enter, not Alt-Enter, off a Mac.
3. The chord works on the reading view only — no ⌘-Enter back from the metadata page.
4. The shelf focuses only on arrival with an empty query, only with a fine primary pointer, and only
   if nothing else holds focus.
5. No library adopted unless the research shows one clearly beats ~40 lines of our own.

## Stages

1. **Build** (one stage; both parts are small): `key-chord.ts` and its tests; the three `isTyping`
   copies replaced; the Metadata chord in Dock.tsx; the tooltip line; the shelf focus in
   Library.tsx. Red-first tests: `tests/metadata-chord.test.tsx` (fires on the reading view; not in a
   textarea, not on a focused link, not with Shift or Alt, not over a dialog, not on repeat, not
   when already `defaultPrevented`, not while composing incl. `keyCode 229`; ⌘-K still opens with
   `key: "K"`) and `tests/shelf-search-focus.test.tsx` (focused on mount; not with `?q=`; not with a
   coarse pointer; not when another control already has focus; not when the box is off screen).
   Docs: keyboard.md § the chord, library.md one line.
2. **Sol code review** (write-capable), gates, a Playwright browser check in a Sonnet subagent at
   1280px, in a `hasTouch` phone context that asserts `(pointer: coarse)` actually matches, and
   on Back from a scrolled article, the two `docs/user-feedback/` notes, push to `dev`.

## The simpler option passed over

For the chord: a third copy of the ⌘-K effect inline in Dock.tsx, guards and all — fewer files,
but a fourth spelling of `isTyping` and a second hand-written modifier test that will drift. The
consolidation is barely bigger and removes code.

For the focus: `autoFocus` on the input. It cannot express "not on a phone, not with a query", and
React's `autoFocus` scrolls.

## Progress

- 2026-09-29: plan written; research dispatched.
- 2026-09-29: research back — **no library**. None covers the guard set (TanStack Hotkeys is alpha
  and `preventDefault`s by default; react-hotkeys-hook documents no IME or repeat handling; tinykeys
  is closest and is the one to reach for if we ever want sequences or remapping). Consolidate.
  Ctrl-Enter confirmed; Alt-Enter is the *download* modifier on a link.
- 2026-09-29: Sol plan review (F1–F6, verdict "revise for F1 and F2"). All six taken: F1 off-screen
  focus after Back → skip; F2 Caps Lock → case-insensitive letters; F3 guarded `media()` and a real
  touch context in the browser check; F4 research inventory corrected; F5 the button rule reframed
  as policy; F6 the missing test cases added.
