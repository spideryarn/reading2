# Green to send, red to back out, across the app

Question [`q-yvmweg`](../user-feedback/questions/q-yvmweg.md) (report `spya-as0et6`, queue item
`qi-ysxdv97b`). The follow-on to plan
[261020f](261020f-feedback-buttons-coloured-positive-and-negative.md), which coloured the Feedback
dialog's pairs and built the shared piece, `.tone-positive` / `.tone-negative` in
[`button-tone.css`](../../src/web/button-tone.css).

> 1 yes, but use your judgment, don't over-use it, update design rules minimally
>
> 2 A yes these all sound like they should change
>
> — Greg, 2026-10-20 (reply `spya-xbrvb9`)

## What we'll do

1. **The rule, in [controls.md](../project/controls.md)**: the row and the sentences Greg saw in the
   question, trimmed (the "puts off" clause and the examples go; his "don't over-use it" goes in).
   His reply is the approval of that rule-doc edit.
2. **Make the shared piece reach every button.** Today it cannot: `styles.css` is imported into
   `@layer app`, which sits *below* `utilities`, so on a shadcn `Button` (`tw:text-foreground`,
   `tw:hover:…`) or an admin `BUTTON` string (`tw:text-muted-foreground tw:hover:text-foreground`)
   a utility wins and `.tone-*` paints nothing — a class that matches and does nothing
   ([silent-success.md](../reusable/silent-success.md)). Feedback got away with it because its
   buttons are hand-rolled `fb-*` rules in the same layer.

   **Fix: `button-tone.css` moves into a layer of its own, `tone`, declared after `utilities`**
   (`@layer theme, base, app, utilities, tone;` in `tailwind.css`, imported there with
   `layer(tone)`, and no longer from `styles.css`). Layer order then beats every family's paint and
   every utility, whatever the selectors weigh, so one class works on all three kinds of button.
   **The file moves to `src/web/button-tone.css`**, beside `tailwind.css`, because every sheet
   under `styles/` is by rule imported from `styles.css` into `app` (Sol, plan review 1).
   `tests/helpers/stylesheets.ts` § `readerSheets` appends it after the `styles.css` graph, and
   `styles-entry-is-imports-only` holds `tailwind.css` to exactly its two layered local imports
   and the layer statement's order.

   A later layer wins in every state with one plain tone selector. **The families that add a hover
   wash keep no wash**: shadcn's outline and ghost hover to `bg-highlight/10`, and Chat's icons to
   `--surface-raised`; red over either on a dark raised surface falls under 4.5:1 (Sol, plan review
   2), so toned instances of those families set `background-color: transparent` on hover. The rule
   is deliberately scoped: Annotate's Save rests on `--page`, and a generic transparent hover made
   that face disappear only while the pointer was over it (code review).
3. **A send button that is a solid orange fill becomes `variant="outline"`** before it takes
   `tone-positive`: green text on an orange fill is unreadable, and the tone deliberately sets no
   background (261011h: a wash takes light theme under 4.5:1). The question said so: *"The send
   button turns from our orange to green."*
4. **The pairs that change** (send green, back-out red):

   | where | green | red | the send was |
   |---|---|---|---|
   | `AddShare` (Add page) | Share it | Cancel | default fill → outline |
   | `AddShareLink` (Add page) | Create the link | Cancel | default fill → outline |
   | `AccessSharing` (Metadata) | Share it | Cancel | default fill → outline |
   | `PrivateLink` (Metadata) | Create the link | Cancel | default fill → outline |
   | `AddAuthorGift` (Add page) | the confirm | Cancel | default fill → outline |
   | `AdminAuthorGifts` | Save notes; Save; Send to … | Cancel ×3 | `BUTTON` ×2; default fill → outline |
   | `AdminVouchersPage` | Save | Cancel | `BUTTON` |
   | `ResetArticle` (Metadata) | Yes, start again / Yes, try again | Cancel | outline |
   | `ProfilePanel` | Done | Close without saving | default fill → outline |
   | `AnnotateDialog` | Save | Discard | `.annotate-save` |
   | `ChatPanel` rename row | ✓ Save | ✕ Cancel | `.chat-icon` |
   | `ChatPanel` edit-a-question row | ✓ Ask again | ✕ Cancel | `.chat-icon` |

   `ResetArticle`'s Yes is a confirm, not a delete: a reset keeps every comment, highlight, note and
   chat (plan 260928a § What it keeps), and Greg named this pair in the question. `ChatPanel`'s
   Ask again drops the turns below the question, and says so in a warning line; its job is to send
   the rewritten question, so it is green like any send.

5. **Left alone, and why** — see below.
6. **Tests**: each changed caller's test asserts its two classes (and the outline variant where it
   changed). `feedback-dialog-styles.test.ts` swaps "the last sheet styles.css imports" for "in its
   own layer, declared after utilities, and imported only from tailwind.css". `/design`'s family
   names the new callers.

## Left alone

Greg: *"use your judgment, don't over-use it"*. The rule is for **the pair that ends a form**, so:

- **Metadata's Delete for ever / Keep it.** The confirm's job is to delete: it is the solid
  destructive fill, and a red Keep it beside a red Delete would say both are dangerous.
- **`ChatDialog`'s Cancel** — it stops the answer *and throws the conversation away*
  (`cancelAndDiscard`). A destroy, not a back-out.
- **The lone Cancels** in `AddShare` and `AddShareLink` (calling off a share or link still waiting
  for the article): no send beside them, so there is no pair to tell apart.
- **Ask AI** in `AnnotateDialog` and **Regenerate** in `ProfilePanel`: each starts a model call, a
  family of its own (controls.md, "starts a model call"); the pair's send is Save / Done beside them.
- **Undo, Restore, Bring back** (`AddAuthorGift`, `AdminAuthorGifts`, Feedback) — undoing.
- **`AdminAuthorGifts`' Discard, and the row's Send** — row actions beside Edit and Look up again.
  The row's Send only opens the confirmation, whose *Send to …* is the green one.
- **`DictationStrip`'s Save / Discard** — salvage of a recording that failed to send, not a form.
- **Every job's stop cross** (`JobProgress`, `LiveButton`'s Cancel while connecting), every dismiss
  cross on a hint or toast, and every dialog's header `.close-x` — stopping, dismissing, closing.
- **Lone submits** with no back-out (sign-in, Help's Ask, Create voucher, …): nothing to pair.

Three more, moved here by Sol's plan review (3), which I agree with:

- **`SkimPurpose`'s Plan the route for this / Cancel** — the send starts a paid model call, the
  same reason Ask AI and Regenerate stay neutral.
- **`PurposePrompt`'s Done / Not now** — Not now does not leave without sending: the box has
  autosaved whatever was typed (its header says so). Both buttons just close.
- **`AdminArticlesPage`'s Transfer / Cancel** — Transfer deletes the old owner's personal state on
  the article and unshares it. Closer to a destructive confirm than a send.

Not done, also from that review (4): the `tone` layer beats shadcn's
`aria-invalid:border-destructive`. No toned button is ever `aria-invalid` (they are buttons, not
fields), so there is nothing to preserve today.

## Passed over

- **shadcn `Button` variants (`variant="positive"`)**, plus `tw:` classes on the admin strings. It
  works without touching the cascade, but it is a second and third way to draw the same pair, and
  the next form would pick whichever it found first. One class in one layer is fewer parts.
- **`!important` in `button-tone.css`.** Same effect as a layer for colour, but it also beats a
  `:disabled` dim we want, and every `!important` invites the next one.
- **Leaving the shadcn sends orange and colouring only Cancel.** Half the rule; Greg chose the whole.
