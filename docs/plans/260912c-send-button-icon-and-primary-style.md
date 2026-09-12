# The send button: its missing icon, and making it the primary control in its row

*Status as of 2026-09-12: built, on `dev`, not deployed. Evidence: `.chat-send` in
[`mode-band.css`](../../src/web/styles/mode-band.css) takes its square from `var(--control-h)`, and
[`tests/chat-send-is-the-primary-control.test.tsx`](../../tests/chat-send-is-the-primary-control.test.tsx)
pins it. **Why the icon went missing on Greg's iPad is still not known**: it rests on a check on the
device (below).*

## Goal, context

Greg, from an iPad on production, report
[SPIDERYARN-READING2-3E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3E):

> The send button in chats and comments still seems to be missing its icon, and it sort of should be
> bigger and maybe have some kind of outline to indicate that it's probably the most important button
> in that little area.
>
> — Greg, 2026-09-12

Two things:

1. **A bug: the icon does not render on his iPad.** Find out why, rather than put a second icon
   beside it.
2. **A design change: Send should read as the primary action of its row.** Bigger, with an
   outline or a fill, and taken through the tokens rather than as a one-off
   ([controls.md](../project/controls.md) owns the heights and the radius).

"Chats and comments" is **one component**. A comment that asks the AI opens a conversation in
`ChatDialog`, and `ChatDialog.tsx` renders the same `Composer` (`ChatPanel.tsx`) as the chat band.
The comment dialog's own buttons are text ("Save comment", "Ask in chat"), and so are the quiz's
("Answer") and the referee candidates' (icon plus "Ask"). **`.chat-send` is the only icon-only send
button in the app**, so fixing it covers both places Greg named.

## The diagnosis: not reproduced off the device, and what that rules out

Every environment this box can run draws the icon. Each line below is something measured, not
reasoned:

| Suspect | How it was checked | Result |
|---|---|---|
| Different code in production | `git diff 607b57a0 HEAD` over ChatPanel, the composer CSS, tailwind.css, main.tsx | The markup is identical (`<SendHorizontal size={14} />` in `.chat-send`); one unrelated line in styles.css |
| The production CSS bundle | Fetched `assets/main-BfRifKFa.css` from www.spideryarn.com | The `.chat-send` rule is intact |
| Cascade layers out of order in the build | First appearance of each `@layer` in that bundle | properties, theme, base, app, utilities: the source's intended order, so the base button reset stays beneath `.chat-send` |
| Lucide lacks the icon | `lucide-react` 1.34.0 | `SendHorizontal` is exported, and its path is in the DOM |
| iOS's default button padding eating the 32px box | WebKit's own `Source/WebCore/css/html.css` | iOS sets `padding-block: 0` and keeps `padding-inline: 6px`, which leaves 18px, more than the 14px icon |
| WebKit shrinking the SVG to nothing in a crowded flex row | Real WebKit (Playwright's Docker image) and Chromium as an iPad Pro 11, microphone stubbed in, 12 widths from 320 to 1366px | The icon is 14×14 at every width, in both engines |
| The colour | Production's tokens | `--ink` is built exactly like `--ink-faint`, and the microphone beside it renders |

**What is left is only on iOS itself**: WebKit on iOS draws form controls through UIKit, and its
stylesheet has iOS-only rules, such as `button[type="submit"] { background-color: -apple-system-blue;
color: white }`. Our author rules override those as written. Neither WebKit for iOS nor the iOS
Simulator can run on this Linux box. Installing WebKit's system libraries here would be a change to
the box, and Docker's WebKit is the GTK build, not the iOS one.

**So the restyle below does not claim to be the fix for the missing icon.** It changes every
property the icon's drawing depends on (the size, the fill behind it, the colour of its stroke), so
it may make the symptom go away, but that would be a coincidence we could not explain. The honest
ending for that half is to ask Greg to look on the iPad after the next deploy. If the icon is still
missing, Safari's Web Inspector on his Mac (Develop ▸ his iPad) can read the computed styles of
the `<svg>`, which is the one piece of evidence this box cannot get.

### What GPT Sol added to the diagnosis

Sol agreed that "not reproduced off the device" is fair
([its answer](#appendix-gpt-sols-plan-review)), and said two claims above are too strong: the
microphone does not rule out colour, because it is normally *enabled* while Send is normally
*disabled*; and production's markup is not the live DOM in Greg's tab until someone inspects it.

**Its leading suspect is the disabled path.** Send is disabled whenever the box is empty, so the
button Greg looks at most is disabled, and it is dimmed with `opacity: .45`. That combination goes
through iOS's native button painting, and WebKit has had bugs in this family: disabled-control
painting that `getComputedStyle` does not show
([218798](https://bugs.webkit.org/show_bug.cgi?id=218798)), and a button compositing regression
involving `opacity < 1`, flex layout and a radius
([238088](https://bugs.webkit.org/show_bug.cgi?id=238088)). Neither matches exactly. Its second
suspect is SVG `currentColor` failing to paint: `SendHorizontal` is stroke-only with `fill="none"`,
so a failed stroke leaves a genuinely empty box.

The checks that would settle it on the iPad, in Safari's Web Inspector on the Mac, in order:

1. Type one character. If the icon appears, it is the disabled path.
2. Untick `opacity`. If that restores it, it is compositing.
3. Set `-webkit-appearance: none`. If that alone restores it, it is the native control renderer.
4. Force `stroke: #0f0 !important` on the `<svg>`. If it appears, the geometry is fine and the
   `currentColor` chain is at fault.
5. If the `<button>` has no `<svg>` child at all, it is not CSS: look at the loaded JS and the
   console.

**What this changes in the build:** the new disabled state is said with colour, not `opacity`
(see Key decisions). That removes the leading suspect from the state Greg sees most, which may make
the symptom go away, but it is still not a proven cause.

## References

- [controls.md](../project/controls.md): the control heights (28/32/36px) and the radius. The 36px
  row is "shadcn `size="default"`, and the inputs beside it", which is exactly Send's situation.
- [icons.md](../project/icons.md): Lucide only, `size` overrides allowed, stroke weight overrides not.
  The spinner is `LoaderCircle` coloured `var(--highlight)`.
- [`src/web/ChatPanel.tsx`](../../src/web/ChatPanel.tsx) `Composer`: the send, stop and busy
  states of the button.
- [`src/web/styles/mode-band.css`](../../src/web/styles/mode-band.css) `.chat-send`, and
  [`chat-actions.css`](../../src/web/styles/chat-actions.css) `.chat-send.stop`.
- [`styles/tokens.css`](../../styles/tokens.css): `--primary` (the orange) and `--primary-foreground`
  ("text *on* an orange fill, so now near-black").
- [260905_1802](../user-feedback/260905_1802-spinner-on-the-send-button.md): the earlier
  send-button report, which was about Feedback's button and not this one.

## Key decisions

- **Filled orange when it can be pressed, an orange outline when it cannot.** An empty box, or a
  microphone that is still listening or transcribing, disables Send. A filled orange button that cannot be pressed invites a press that
  does nothing, while a grey one loses the "most important" reading Greg asked for. The outline keeps
  it recognisably *the* control while saying "not yet". The fill uses the same tokens shadcn's
  `default` variant uses (`--primary`, `--primary-foreground`), and controls.md already made **Add**
  on the shelf that variant for the same reason: it is the thing the page exists to let you do.
- **Hover is `brightness(1.1)`, not a colour change**, which is controls.md's own finding about an
  orange fill on a dark ground.
- **36px, through a new `--control-h` token.** controls.md's table has no CSS variable behind it;
  this adds one for the 36px row and uses it for both sides of the square. The icon goes from 14 to
  18 (a `size` override; the stroke stays 1.75).
- **`padding: 0` and `flex: none` on the button.** The box's geometry should be ours and not the
  browser's; the microphone beside it already sets `padding: 0`. Not claimed as the icon fix, per
  the diagnosis above.
- **The fill is `.chat-send[type="submit"]:not(:disabled)`, so it never reaches Stop.** Stop
  replaces Send while an answer is arriving, and it is an *enabled* `type="button"` carrying the same
  class, so a bare `:not(:disabled)` would have filled it orange too (GPT Sol, P1). Stop keeps its
  orange outline, gains an explicit `background: transparent`, and now matches Send's disabled
  shape at the new size.
- **Disabled is said with colour, not `opacity`.** The old state was `opacity: .45`. The new one is
  a transparent ground with an orange border and icon, which already reads as "not yet" without
  dimming. This takes Sol's leading iOS suspect (a disabled button at `opacity < 1`) out of the
  state Greg sees most. It is a design choice that happens to remove a suspect, not a proven fix.
- **The spinner branch is left alone.** `busy` without `onStop` draws a disabled `LoaderCircle`,
  but no caller produces that state in practice: an arriving answer supplies `onStop`, so Stop
  replaces Send (GPT Sol, P2; an earlier draft of this plan said otherwise). It inherits the
  disabled outline, so an orange spinner never sits on an orange fill.
- **Remember's row is measured, not assumed.** Its comment says the row once had 4px to spare and
  stranded Send alone on a second line, and 36px adds exactly 4px (GPT Sol, P1). So its lines are
  measured at eleven widths before and after, in both engines.

**The simpler option passed over: only make the button bigger** (36px, 18px icon, keep the grey).
That is one line, but it answers neither of Greg's words "outline" or "most important": a bigger grey
box is still the same weight as the microphone beside it.

**Deferred:** a height token for the 28px and 32px rows as well, and moving every control in the
app onto it. That is a sweep across forty-odd buttons, and this report is about one.

## Stages

### Stage: diagnose, and the plan reviewed

- [x] Reproduce in Chromium as an iPad and in real WebKit, at 12 widths (the table above)
- [x] Rule out production, the layers, Lucide, the UA padding and the colour
- [x] GPT Sol reviews this plan, and is asked separately for iOS-only causes the table has not ruled
  out
  - 📔 No P0. Two P1s and two P2s, all accepted, in the appendix. The iOS answer is in
    [What GPT Sol added to the diagnosis](#what-gpt-sol-added-to-the-diagnosis).

### Stage: the primary style

- [x] Test first: mount `Composer` and require the send icon at 18px, and require `.chat-send` to
  take its size from `--control-h` (red before)
  - 📔 Red for the right reasons: `expected '14' to be '18'`, and no `--control-h` in the tokens.
    Widened after Sol's review to pin the Send-only fill, Stop's transparent ground, `flex: none`,
    and a disabled state with no `opacity`.
- [x] Remember's row measured at eleven widths before the change
- [x] `--control-h` in `styles/tokens.css`; `.chat-send` restyled; `SendHorizontal size={18}`,
  and Stop's square 12 → 14 to keep its proportion in the bigger box
  - 📔 The disabled icon is `var(--ink-faint)`, not a `color-mix()` of the orange as first drafted.
    Sol's second iOS suspect is an SVG stroke failing through `currentColor`, so the state Greg
    sees most now uses the microphone's colour path, which is known to render on his iPad.
- [x] Screenshots in Chromium and in WebKit: empty, typed, in flight (Stop, held by stalling the
  chat request so no model call is made) and Remember's composer
  - 📔 Every state is 36×36 with its icon (Send 18, Stop 14) and `opacity: 1`. Empty is an orange
    border and a grey icon, typed is the orange fill with a near-black icon, Stop is transparent.
  - 📔 **Remember's rows:** unchanged at all eleven widths in Chromium. In WebKit, unchanged except
    at 744px, where a row that fitted on one line now takes three: talk, live, then send with the
    stance. That is the shape it already had at 834px before the change, and Send is never alone
    on a line where it was not before (it already was at WebKit's 551px, before and after).
- [x] The new test green (4 of 4), `npm run typecheck` exits 0
- [x] Lint on the touched files: the same four `noDescendingSpecificity` warnings as before the
  change, at the same rules (checked by linting the pre-change file), plus the existing complexity
  warning on `ChatPanel.tsx`. None is new.
- [ ] `npm test`, the full suite
- [x] GPT Sol code review, which fixes what it finds
  - 📔 No P0. **P1, fixed by Sol:** a disabled Send showing the spinner kept it orange, because
    `.cmt-spinner` sets its colour on the SVG itself and so beats the grey the button passes down.
    `.chat-send:disabled .cmt-spinner { color: inherit }` makes it the same quiet grey as every
    other reason Send cannot be pressed. That departs from icons.md's orange spinner, and the branch
    has no normal caller, so it is recorded rather than argued over.
  - 📔 **P2, fixed by Sol:** the test read one file and took the first matching rule, so a later
    `.chat-send { background: red }` elsewhere would have left it green over a broken design. It now
    reads the whole reader stylesheet (`readerCssNoComments`), requires each selector exactly once,
    and holds an exact list of every selector that can match `.chat-send`, so a new state cannot
    arrive unreviewed.
  - 📔 Sol confirmed the cascade: only an enabled Send is filled, every disabled Send is outlined
    with a grey icon, Stop is transparent with an orange square, and the base layer's button reset
    loses to the app layer. The focus ring's 2px offset leaves a dark gap around the fill and is
    not clipped, including in the chat dialog. After its changes: the new test 5 of 5, doc-links
    14 of 14, typecheck exit 0.
- [ ] See the hardened test fail: a duplicate `.chat-send` rule must turn it red

### Stage: land

- [x] controls.md gains the token row; icons.md's "Where they're used" gains Send
- [x] Feedback note under `docs/user-feedback/`, ending **Shipped**, and a row in
  awaiting-approval.md's list of shipped reports that still want Greg: the iPad check
- [ ] The queue item done, push to `dev`

## Appendix: GPT Sol's plan review

`gpt-5.6-sol`, effort high, read-only sandbox, 2026-09-12. It exited 0, wrote its answer, and its
log shows no fallback to a self-review. No P0.

| | Finding | What we did |
|---|---|---|
| P1 | The planned `.chat-send:not(:disabled)` fill also matches Stop, which is an enabled `type="button"` with the same class, and `.chat-send.stop` sets no background | The fill selector is `.chat-send[type="submit"]:not(:disabled)`, and Stop gets `background: transparent`. Both are pinned by the test |
| P1 | 36px adds exactly the 4px Remember's row once lacked, when Send was stranded alone on a second line | Remember's lines measured at eleven widths in both engines, before and after |
| P2 | The plan said "an answer in flight disables Send". In practice an arriving answer supplies `onStop`, so Stop replaces Send, and the disabled spinner branch has no normal caller | The plan is corrected; the branch is left as it is |
| P2 | The test was red for the right reasons but checked neither Stop, `flex: none`, nor the disabled state | Widened to cover all three |

Its answer to the iOS question is summarised in
[What GPT Sol added to the diagnosis](#what-gpt-sol-added-to-the-diagnosis), with the WebKit bugs it
cited.
