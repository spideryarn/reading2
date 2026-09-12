# The send button has no icon, and should be the prominent control in its row

[SPIDERYARN-READING2-3E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3E) (2026-09-12
08:28 UTC, `kind=problem`), from an admin, on an iPad in production, build `607b57a0`, in chat on
`entropy-24-00930-spya-bmvfyb`.

> The send button in chats and comments still seems to be missing its icon, and it sort of should be
> bigger and maybe have some kind of outline to indicate that it's probably the most important button
> in that little area.

**Ending: Shipped** — on `dev`, not deployed. Resolve 3E. One check rests with Greg, and it is in
[awaiting-approval.md](awaiting-approval.md#decisions-resting-with-greg-from-reports-that-did-ship).

What we did: Send is now the primary control in its row, and chat and a comment's conversation get it
together, because they share one composer. It is 36px square through a new `--control-h` token, with
an 18px icon. When there is something to send it is **filled orange**, and when there is not it is
**an orange outline with a grey icon**. Stop, which takes its place while an answer arrives, stays
outlined.

**Why the icon went missing was not found.** Chromium set up as an iPad and real WebKit both draw it,
at every width tried, and six causes were ruled out by measurement. What is left happens only on iOS
itself, which our server cannot run. The new design removes the two leading suspects GPT Sol named
(a disabled button dimmed with `opacity`, and the icon's stroke colour), so the icon may simply be
there after the next deploy, but that is not a proven fix. If it is still missing, five checks in
Safari's Web Inspector on the Mac would settle it; they are listed in the plan.
[260912c-send-button-icon-and-primary-style.md](../plans/260912c-send-button-icon-and-primary-style.md).
