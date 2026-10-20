# Feedback's buttons coloured by what they do: green to send, red to back out

Report `spya-as0et6` (#621, `SPIDERYARN-READING2-KE`), a suggestion from Greg (an admin;
`feedback-reporter.ts` exit 0), queue item `qi-d9zvk6y2`.

> In the send addendum interface within feedback, you know, color the buttons red and green, and
> for close as well, just so it's easier to see what's, you know, going to effectively a cancel and
> what's a submit. We've done that elsewhere. Let's try and do that throughout the feedback dialogue
> and perhaps elsewhere as well. And maybe, you know, update our design system and/or docs so that
> going forwards, we make it more visible which buttons are kind of positive versus negative.
>
> — Greg, 2026-10-19 (`spya-as0et6`)

## Where we are

"Elsewhere" is the Needs-a-decision thread: *Send reply* green (`--positive`), *Defer for now* red
(`--danger`), Greg 2026-10-11 (plan 261011h). Plan 261017c then made Write's *Send* green and
**deliberately kept Cancel and Close grey**; 261011h **deliberately kept the addendum box neutral**.
Greg has now overruled both: the addendum's two buttons, and Close, take the colours too.

Both colours are tokens already, measured at 4.5:1 as text on `--page`, `--panel` and
`--surface-raised` in both themes (`tests/appearance-palette.test.ts`). The existing green/red is
written as four feedback-only selectors in `feedback.css`, specificity-bumped to beat `.fb-copy`'s
hover. Nothing outside Feedback can reuse them.

## What we'll do

1. **One shared piece: `.tone-positive` and `.tone-negative`**, in a new
   `src/web/styles/button-tone.css`, imported **last** in `styles.css`. Each sets `color`
   (`--positive` / `--danger`) and `border-color: currentColor`, and no background — a wash of the
   same hue takes light theme under 4.5:1 (261011h, GPT Sol). **Order alone is not enough** (Sol,
   plan review): its selectors are written to match or beat every paint rule that can reach a toned
   button — rest, `:hover`, and `[aria-disabled="true"]:hover` — and the feedback-only colour rules
   that would compete (`.fb-send`'s green, the four `.fb-reply-thread …` rules) are deleted rather
   than left to lose. **A toned button that cannot be pressed dims** (`:disabled`, opacity 0.45), as
   `.fb-send` does today, unless it is `data-working` — so a red Cancel goes faint while its addendum
   sends, and Defer stays strong while it is deferring (it gains `data-working` then). Shape and size
   stay the family's own. **What the colour means, narrowly:** the pair that ends a form — the
   button that sends what you wrote, and the one that leaves without sending. It is not "red means
   destructive": Cancel and Close keep the Write draft. `--destructive` stays the fill for an act
   that loses something. The words carry the meaning; colour is the shortcut (colour-scales.md).
2. **The Feedback dialog uses it everywhere a send sits beside a back-out:**

   | where | positive (green) | negative (red) | neutral, and why |
   |---|---|---|---|
   | Write's footer | Send | Cancel | |
   | Earlier's footer | | Close | ‹ Previous · Next › — they move, not commit |
   | an addendum box | Send addendum | Cancel | |
   | a thread's reply box | Send reply | Defer for now | Bring back — it undoes a deferral |

   The send box (`FeedbackSendBox`) puts `tone-positive` on its send button itself, so both its
   callers are green by construction. The four `.fb-reply-thread …` rules go. Left neutral: the
   header's close cross — the one `.close-x` every dialog shares, and colouring it here alone would
   break "controls that do the same job look the same"; the footer's Close beneath it is the red
   one, and Greg is asked whether he wants the cross red too — *Add to this report*
   (opens a box, commits nothing), *Remove* on a screenshot, Copy / Try again in a failure.
3. **`/design` § Controls across modes gets a Family** showing the pair live, with the rule.
4. **Tests**: `feedback-dialog-styles.test.ts` keeps its shape — an inventory of every paint
   rule naming a feedback button hook or a tone class, and a specificity check that each tone
   selector matches-and-follows or outweighs each competing state — rewritten around the shared
   classes, plus the disabled/working opacity rules; and `feedback-dialog.test.tsx` checks each
   button in the table carries its class, Bring back and the pager none.
5. **The rule in docs**: `controls.md` is a rule doc, so its new row and sentence are **proposed to
   Greg in a question**, not committed (the brief: *"propose that wording in a question rather than
   commit it"*). The CSS file's header and `/design` carry the rule meanwhile. Sol (plan review 4)
   would rather it landed now; the house rule on rule docs wins.

## Passed over

- **Editing only `feedback.css`** (four more feedback-only selectors) — smaller, but Greg asked for a
  design-system rule, and a rule with no shared piece behind it gets redrawn by hand each time.
- **shadcn `Button` variants** (`variant="positive"`) — most of Feedback's buttons are not shadcn's,
  and the variant would only reach the minority that are.
- **Red for every back-out across the app, now.** "Perhaps elsewhere as well": deferred to its own
  queue entry with the survey of the other pairs, because it touches many modes' tests and the
  question of whether a red Cancel beside a red *Delete* still reads right is Greg's.

## Deferred

- The rest of the app's send/back-out pairs → a queue entry (the survey is in the feedback note).
- `controls.md` wording → `docs/user-feedback/questions/`.
