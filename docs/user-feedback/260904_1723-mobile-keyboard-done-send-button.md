# The mobile keyboard should have a Done/Send button

**[SPIDERYARN-READING2-1A](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1A)** · reported
2026-09-04 17:23 UTC · resolved 2026-09-04 · *shipped, but not the way it was asked for*

> **This note was rewritten on 2026-09-04 after its first fix turned out not to work on the phone the
> report came from.** The issue was reopened and is resolved again; § The first fix was wrong says
> what changed and what is still unchecked.

## What the reader said

> The keyboard on mobile devices should have a Done/Send button where appropriate, including this
> Feedback dialog box.

## Why it happened, which is more specific than "mobile"

`public/site.webmanifest` is `display: standalone`. **In an installed iOS PWA the keyboard accessory
bar — the one carrying "Done" — does not exist**, and the app's only send chord is ⌘/Ctrl+Enter,
which has no phone equivalent. So a reader typing into the Feedback box had the Send button behind
the keyboard and no keyboard-side way to reach it or dismiss.

No `enterKeyHint` was set anywhere in `src/`.

## The correction: the Feedback box does not get a Send key

The literal request was "including this Feedback dialog box", and for its textarea the answer is no.
**iOS inserts a newline whatever the key is labelled**, so a key marked Send that inserts a newline is
a key that lies — and `AnnotateDialog.tsx` already records rebinding Enter in a multi-line box as "a
trap" the app fell into once and reversed.

So the fix for this dialog is **the button's position, not the key's label**: `.fb-panel` follows
`.cmt-dialog`'s shape — header and actions pinned, one scrolling region between them — and the panel
places itself inside the part of the screen the reader can actually see. § The first fix was wrong is
how that ended up being measured.

That reversed a deliberate deferral recorded on `.cmt-dialog`; the note there now says why it landed.

## Every text box, decided

Twenty-one boxes surveyed, and the decision is a table **inside a test**, so a new box fails until
somebody says which kind it is. That is the part worth keeping: the rule outlives the sweep.

| kind | boxes |
|---|---|
| `search` | article search, glossary look-up, shelf search |
| `go` | add-article URL, both criterion poles, sign-in password |
| `next` | sign-in email, when empty — it moves to the password |
| `done` | title rename, chat thread rename |
| `send` | chat composer, chat "ask again", candidates composer, comment follow-up |
| **nothing at all** | Feedback body, quiz answer, profile box, comment note, annotate body, criterion text |

The last row carries no attribute rather than `enterKeyHint="enter"`: Return is already the default,
iOS ignores the label, so an explicit value would be noise. Two boxes were decided against the brief
and both are right — the comment follow-up is `send` because it posts into chat, not `done`.

Also added: the `dictation.armed` guard — which `dictation.md` calls "the guard everybody forgets" —
to the comment follow-up's submit, now that its Enter key promises Send.

## The dialog, finally looked at

This closes the job [the last batch could not do](260904_1300-bug-report-guidance-by-kind.md): six
agents were thrashing the shared dev server and two attempts came back saying so.

**There is no light theme** — the app is dark only, no `prefers-color-scheme` — so "light and dark"
was one shot, not two.

The verdict: **the three Problem lines read as three distinct asks, not a wall.** The hint is
subordinate to the box (0.76rem, soft ink, against the largest element on screen). No clipping,
overflow or contrast trouble at 390px.

One CSS fix made and re-shot: a hairline above the actions, because at keyboard height the buttons
sat hard against a sentence cut mid-block and read as the end of the dialog. The first attempt used
`--rule`, which is **invisible** on `--surface-raised` — 0.27 against 0.26 — and `--rule-strong` is
what shows. `.cmt-sources` has the same invisible divider, pre-existing.

## Two things left for Greg

1. **On desktop the dialog is vertically centred, so switching Problem ↔ Suggestion moves the kind
   buttons 29–38px** — the button you just pressed shifts under the pointer. The fix is growing
   downward only (`align-items: flex-start` and a top pad), which repositions the dialog for
   everybody, so it was left rather than decided. On mobile nothing moves at all.
2. **On a phone the chat composer's Enter always sends and there is no Shift+Enter**, so a reader
   cannot type a newline in it. Found while surveying; not part of this report.

## The first fix was wrong

The first attempt put `interactive-widget=resizes-content` on the viewport meta, which asks the
browser to shrink the **layout** viewport so `dvh` and `position: fixed` come out right for free.
Chromium does that. **WebKit does not** — the implementation bug is open
([259770](https://bugs.webkit.org/show_bug.cgi?id=259770)) — and what iOS does instead is pan a
smaller *visual* viewport over a layout viewport that stays full height. So the fix would have done
nothing on the device the report came from, and this note claimed otherwise: it said an installed
standalone app "resizes on its own", which was never checked and is not true. GPT Sol found it after
the issue had already been resolved, and the issue was reopened for it.

The 390×340 browser check that seemed to prove the fix could not have: it was the layout viewport a
phone *becomes* when the meta is honoured, so it tested Chromium's behaviour and called it iOS's.

What ships now is [`src/web/useVisualViewport.ts`](../../src/web/useVisualViewport.ts), which reads
`window.visualViewport` — the one thing both engines agree on — on **both** `resize` and `scroll`,
because `resize` is the keyboard arriving and `scroll` is iOS panning, and listening to only the
first leaves the dialog the right height in the wrong place. Four dialogs use it: Feedback takes a
`top` and a `height`, and the three panels pinned to the bottom corner (`.cmt-dialog`,
`.chat-dialog`, `.annotate-dialog`) take a `--kb-inset` that lifts and shortens them together.

`null` means do not interfere, and that is the whole fallback — no `visualViewport` and the
stylesheet stands exactly as it did.

## Honest limit

**Nobody has raised a real keyboard on a real phone.** No automation available here can: the
on-screen keyboard is not something a headless browser has.

[`tests/visual-viewport-dialogs.test.tsx`](../../tests/visual-viewport-dialogs.test.tsx) holds the
part a test can hold — eight cases, and the no-`visualViewport` fallback is asserted *first*, because
a suite that only ever ran with the fake installed would not notice the day the hook started writing
`NaNpx` into every dialog in the app. Listeners are counted rather than recorded, so a leak shows up
as a number that never returns to zero.

That is evidence the numbers reach the elements, keep up with the events and are let go of
afterwards. It is not evidence that iOS sends the numbers. The difference is exactly what went wrong
the first time, so it is written down rather than assumed: **open the Feedback box on a phone with
the keyboard up and check Send is reachable.** If it is not, this report deserves a new one.
