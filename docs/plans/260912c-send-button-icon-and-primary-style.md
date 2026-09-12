# The send button: its missing icon, and making it the primary control in its row

*Status as of 2026-09-12: decided, not built. Evidence: `.chat-send` in
[`mode-band.css`](../../src/web/styles/mode-band.css) is still the 32px grey box described below.*

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

- **Filled orange when it can be pressed, an orange outline when it cannot.** An empty box or an
  answer in flight disables Send. A filled orange button that cannot be pressed invites a press that
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
- **Stop keeps the outline.** Stop replaces Send while an answer is arriving; it is not the primary
  action at that moment, and the orange outline it already has now matches Send's disabled shape at
  the new size.
- **The spinner stays orange on a transparent ground**: busy is a disabled state, so it gets the
  outline and not the fill, and an orange spinner on an orange fill would vanish.

**The simpler option passed over: only make the button bigger** (36px, 18px icon, keep the grey).
That is one line, but it answers neither of Greg's words "outline" or "most important": a bigger grey
box is still the same weight as the microphone beside it.

**Deferred:** a height token for the 28px and 32px rows as well, and moving every control in the
app onto it. That is a sweep across forty-odd buttons, and this report is about one.

## Stages

### Stage: diagnose, and the plan reviewed

- [x] Reproduce in Chromium as an iPad and in real WebKit, at 12 widths (the table above)
- [x] Rule out production, the layers, Lucide, the UA padding and the colour
- [ ] GPT Sol reviews this plan, and is asked separately for iOS-only causes the table has not ruled
  out

### Stage: the primary style

- [ ] Test first: mount `Composer` and require the send icon at 18px, and require `.chat-send` to
  take its size from `--control-h` (red before)
- [ ] `--control-h` in `styles/tokens.css`; `.chat-send` restyled; `SendHorizontal size={18}`
- [ ] Screenshots in Chromium and in WebKit, idle, typed, busy and stop, and in Remember's composer
- [ ] `npm test`, `npm run typecheck`, lint on the touched files
- [ ] GPT Sol code review, which fixes what it finds

### Stage: land

- [ ] controls.md gains the token row; icons.md's "Where they're used" gains Send
- [ ] Feedback note under `docs/user-feedback/`, the queue item done, push to `dev`
