# The Add page, and its Sharing section above all, made clearer

Report `spya-nsrkju` (#498, SPIDERYARN-READING2-F9), Greg's, filed 2026-10-09 from `/changelog`,
kind suggestion. Queue item `qi-xxdgyn9c`. Also folds in `qi-9x3akt5n` (the past-tense "has been
sent" over a refused paste), which is a bug on the same page.

> I think the Add page is going to be a little bit confusing to users, especially the sharing bit.
> Can we do a better job? I think this is partly about the graphic design and partly about the
> text. We could also include more tooltips, links to help pages. I don't know. Try kicking off
> different agents, each with a different persona to critique it.
>
> — Greg, 2026-10-09

Up: [ingest-queue.md § The add page](../project/ingest-queue.md#the-add-page) ·
[public-readable-sharing.md § While the article is still importing](../project/public-readable-sharing.md#while-the-article-is-still-importing)

## What was done first: five critiques, in character

Screenshots of the page in seven states, desktop and phone (a Sonnet browser agent, against the
worktree's dev server), went to five critics, each told to quote what confused them and rank five
concrete changes, marking each "keeps meaning" or "changes meaning":

| Persona | Model |
|---|---|
| Margaret, 64, retired teacher, first week, only wants to read | Opus |
| Priya, postdoc, wants three lab colleagues to read a preprint by Friday | Opus |
| A senior interaction / graphic designer | Opus |
| Tom, journalist with sensitive material, privacy-anxious | Opus |
| A GOV.UK-trained content designer | GPT Sol |

**Where they agreed, nearly word for word (four or five of five):**

1. **The shut *Sharing* row says nothing, and looks like a footnote.** `text-xs`, grey, a chevron:
   the quietest thing on the page, quieter than the uppercase purpose label. Nobody learns from it
   that the article is private by default. (Tom: *"A bare 'Sharing' with a chevron reads like the
   next step in the flow, not like 'this is off'."*)
2. **Two controls doing parallel jobs have different shapes.** *Make it public* is a tick box that
   opens a confirmation; *Private link* is a heading and a button that opens a confirmation. The
   Metadata card does both with buttons (*Create a link*, *Share with anyone…*). Worse, **the tick
   stays ticked while the confirmation is still asking**, so the page looks shared when nothing is
   (designer, Tom, Margaret). This is the one finding that is a correctness problem, not taste.
3. **The descriptions narrate the UI.** *"Ticking this shows what would be shared and asks you to
   confirm."* / *"The button shows what would be shared and asks you to confirm."* Everybody skipped
   them; the tooltip already says it.
4. **"Private link" reads as "keeps it to myself"** (Margaret would have pressed it to keep the
   essay private). The confirmation says *"can pass it on"*; the line under the heading does not.
5. **No link to Help**, though `/help/sharing` exists and answers every question they asked.
   *"Listed publicly: listed where? Google?"* (Priya, designer).
6. **Nothing says it can be done later.** Only the purpose box mentions the Metadata page.
7. **Private link second, public first** — the reverse of the Metadata card, and the reverse of
   exposure. The common case (Priya's) is the link.

**One that only one persona found, and it is the mistake most likely to happen**: the import card's
copy-the-address button wears the same chain icon (`Link2`) as *Private link*. Priya: *"I'd have
clicked it, pasted the result into Slack for my three labmates, and moved on … My colleagues would
have hit a wall."* Its tooltip is right; the icon invites the wrong reading before anybody hovers.

**GPT Sol, the one cross-family critic, found two sentences that are not quite true**, which none of
the four Claude critics did:

- `IMPORT_LINK_COPY_TIP` says the copied address opens *"for anyone else only if you share it"*. A
  private link is a **different address** (`?key=`); sharing by link does not make this one open
  for anybody. As a necessary condition the sentence is not false, but it is read as a sufficient
  one, and Priya's mistake is exactly that reading.
- `/help/sharing` says the add page's section is *"closed until you open it"*. It also opens by
  itself whenever a control has something to say (`AddSharing.tsx` § What shut may hide).

It also noticed that the auto-modes box is a saved setting that follows the account, which its label
does not say; that is outside the sharing part and is queued below.

The critiques are kept in the scratchpad of the session; their substance is above.

## What this builds (v1)

All in the browser, on the add page only. **No server change, no schema, no prompt.**

1. **The row.** `text-sm`, foreground colour, an icon when something is on (globe when public,
   link when only a link is), and the summary when nothing is on becomes **"Sharing options"** (was
   *"Sharing"*). The other three summaries are unchanged. Unsettled still forces it open and makes
   it a heading, as now. *(The first draft said "Sharing: off" with a padlock; the plan review's P1
   showed this tab cannot always know that — § Review, below.)*
2. **One line at the top of the open section**, new:
   *"Every article starts private. Nothing is shared until you confirm, and you can also share it
   later from the article's Metadata page."* followed by a **How sharing works** link to
   `/help/sharing` (`helpHref("sharing")`). Each clause is already a published fact: *Every article
   starts private* is `/help/sharing`'s first sentence; the confirmation gate; Access & sharing on
   Metadata.
3. **Private link first, then public**, matching the Metadata card.
4. **Make it public becomes a button**, the same shape as *Create a private link*: an outline `sm`
   `Button` with the globe, **"Make it public…"**, and the tooltip the Metadata card's button
   carries (`SHARING_OPEN_TIP`). The link's button becomes **"Create a private link…"** — the
   ellipsis is the usual mark of a button that opens a question. Each control is a heading (*Private
   link*, *Public*), one line of what it means, and its button. After that, by state:

   | `ShareAtAddState` | was | now |
   |---|---|---|
   | `off`, `refused` with `on: false` | unticked box | *Make it public…* |
   | `confirming` | **ticked box** + panel | the panel only (its own *Cancel* calls `share.cancel()`) |
   | `waiting`, `gave-up` | ticked box + line | line + **Cancel** (ghost), which calls `share.untick()` |
   | `saving` | disabled box + line | line, no button |
   | `on`, `unknown`, `refused` with `on: true` | ticked box + line | line + **Stop sharing** (outline, `Link2Off`, `SHARING_STOP_TIP`) — the Metadata card's own label |
   | `probing`, `adopted`, `unavailable` | no box | no control (unchanged) |

   `SHARE_AT_ADD_RECALLED`, the reload warning, said *"Untick this to make it private"*; it now
   says *"Press Stop sharing to make it private"*.

   Every outer press calls what the box called (`share.open()` / `share.untick()`); the
   confirmation's own *Cancel* still calls `share.cancel()`. **The controller and what it sends do
   not change.** `untick` from `on`, `unknown` and `refused` sends `private` as before.
5. **The two descriptions**, with the UI narration removed:
   - Private link (`LINK_AT_ADD_WHAT`): *"Anyone who has the link can read it without signing in,
     and can pass it on, once the import has finished. The private link is not listed anywhere."* — adds *can
     pass it on*, which is `PRIVATE_LINK_WHAT`'s and the confirmation's; drops the narration.
     Naming the link in the last sentence keeps it true while the article is also public.
   - Public (`SHARE_AT_ADD_WHAT_LEAD`): *"Anyone can read it without signing in once the import has
     finished, and it is listed publicly, under Shared articles."* with *Shared articles* linking
     to `/read/public` (`PUBLIC_SHELF_LABEL`, so a rename follows). It adds the true fact of where
     the public listing appears.
6. **The import card's copy button** shows the `Copy` icon instead of `Link2`, and its tooltip
   (`IMPORT_LINK_COPY_TIP`) is made exact: *"Copy the address this import's article will have. It
   opens for you once the import has finished, and for anyone else only if you make the article
   public: a private link is a different address. If the import fails, the address leads
   nowhere."* **This narrows a sentence to what was always true**, and is flagged for the review.
   Accessible name unchanged. (The card is also on the shelf; both changes are right there too.)
7. **`qi-9x3akt5n`.** For a pasted address the page says *"has been sent"* from the first paint,
   including over a refused POST (402, a `/read/` link) where nothing was sent. The past tense
   now needs the POST to have answered with a job, as an upload's already does; before that and on a
   refusal it says the present-tense `ADDING_SENDS_TEXT_AWAY`, the shelf's own sentence. Failing test
   first.
8. **Help** (`src/web/help/pages/sharing.md`, *While it is still being added*): the new order and
   button labels, and *"closed until you open it"* becomes *"closed until you open it, and open
   whenever something in it needs your attention"*.
9. **Docs**: public-readable-sharing.md § While the article is still importing, ingest-queue.md §
   The add page, the comments in `AddSharing.tsx`, `AddShare.tsx`, `AddShareLink.tsx`.

### Which published sentences change meaning

Said plainly, because Greg asked for exactly this (rewritten after the plan review's P2):

- **The card's tooltip narrows and consistently calls what it copies an address.** It said the link
  opens for others *"only if you share it"*; it now says the address opens *only if you make the
  article public*, because a private link is another address. What was always true, said so it
  cannot be misread.
- **Two sentences add a true fact each.** The private link's line adds *and can pass it on*
  (already in `PRIVATE_LINK_WHAT` and the confirmation); the public line adds *where* it is listed,
  *under Shared articles*, linked (already on `/help/sharing`).
- **The private-link description disambiguates its last “it”.** *The private link is not listed
  anywhere* remains true when the article is public too; *It is not listed anywhere* did not.
- **One sentence is new**: the section's first line, three facts each already published elsewhere.
- **Two sentences are dropped**: both descriptions lose their sentence about the button, which the
  tooltip and the new line say.
- **The row claims less than before, not more**: *Sharing options* says nothing about state, where
  the rejected *Sharing: off* would have. The old row said only *Sharing*.
- The reload warning names the new press; its meaning is the same.
- The new *Public* heading, the ellipses on the two opening buttons, and the row's icons change
  navigation and emphasis, not what sharing promises.
- **The Help paragraph changes too.** It names the new order and labels, says the section opens
  itself when something needs attention, and distinguishes the ordinary address copied by the card
  from a private link.
- **The direct-add disclosure is shown in fewer states, without changing its words.** While a URL's
  POST is out, and after a refusal, the page now uses the present-tense sentence; only a job answer
  selects *has been sent*. The older problem that a queued job may not yet have reached a provider
  remains explicitly deferred below.
- The confirmation panels' words are untouched; their heading levels follow the new section
  hierarchy (`h2` row, `h3` controls, `h4` confirmations).

## What it does not do, and why

- **A private link in `unknown` cannot be turned off from the add page** (plan review P2) —
  queued; it predates this plan.
- **The confirmation panel** (calmer heading, a link icon for the private link's *gets these*,
  folding the *stays with you* chips, *Your comments and notes* first, the disabled button's look)
  — every critic had something here, but the panel is the Metadata card's own pieces
  (`Inventory`, `Personalisation`), so any change is a change to both cards and to the sentences an
  owner agrees to. Its own small piece of work, with its own review. Queued.
- **Naming the model provider** in *"sent to a third-party model provider"* (Tom), and **when the
  past tense is true** (plan review P1: a queued job has not necessarily reached a provider) — two
  privacy sentences whose meaning would change; Greg's call, and `privacy.md`'s. Queued with the
  panel item.
- **The rest of the page** (the auto-modes box being an account setting its label does not
  mention; the slug shown as the card's title until the real one arrives; the
  purpose box's five sentences and the repeated *Saves as you type*; the auto-modes line) — real,
  but not the sharing part Greg named, and each is a sentence with its own history. Queued.
- **Removing the card's copy button** (Tom) — Greg asked for it (`spya-h7skj5`). The icon change
  removes the confusion instead.
- **Renaming "Private link"** (Margaret, Priya, Sol) — Greg chose the name on 2026-10-07
  (public-readable-sharing.md § A private link). The description now says it can be passed on.
- **The simpler option passed over**: change only the words and leave the tick box. Rejected
  because the ticked box over an unanswered confirmation is a state that looks wrong, and the
  controls rule (controls.md § Controls that do the same job look the same) asks for the button the
  Metadata card already uses.

## Tests

- `tests/add-page-share.test.tsx` and `tests/add-page-sharing-section.test.tsx` drive the button,
  with the same assertions about what is sent. A press helper returns only a live public-control
  press; it never falls back to a container whose click does nothing.
- New: every state-to-press mapping; no *Stop sharing*/ticked look while `confirming`; the row says
  *Sharing options* and links to Help; private link drawn before public.
- New, red first: a refused POST for a pasted address does not say *"has been sent"*.

## Review

GPT Sol on this plan (read-only) before building
([plan review](261009i-add-page-sharing-clearer-plan-review-sol.md)), and on the code
(workspace-write) before pushing.

**The plan review, and what was done with each finding:**

- **P1, "Sharing: off" is a promise this tab cannot keep.** Accepted. Another tab can share the
  article and nothing can be read back before publication; a control that is `unknown` or `saving`
  is not `on` either, so the row would have said *off* with a padlock over a share that may be
  live. The row says *Sharing options* and names a state only when one is on; the private default
  is said inside as a general fact. A test holds that the summary never says off, private or only
  you.
- **P1, a job receipt does not mean the text has reached a provider.** True, and **older than this
  plan**: the page has said *"has been sent"* from the first paint for every pasted address since
  2026-09-01, by a deliberate choice recorded on `DIRECT_ADD_SENT_TEXT_AWAY`, and an upload's arm
  has said it from *queued* since 2026-09-03. Item 7 only narrows when it is said, so it is a
  strict improvement and ships. The wider question (step evidence, or a sentence that says
  *queued*) changes a privacy sentence's meaning and is Greg's: it goes into the deferred queue
  entry, named.
- **P2, a private link whose create reply was lost cannot be turned off from this page** (`unknown`
  offers only *Check again*; `turnOff` refuses it). True, and also older than this plan: nothing
  here changes the link control's states. Narrowed in this plan to the public control and queued.
- **P2, the reload warning says "Untick this".** Fixed.
- **P2, the meaning audit was too kind.** Rewritten above.
- **P3, Help and tests.** Help now says the card copies the ordinary address, which opens for
  others only once public; `tests/job-card-copy-link.test.tsx` holds the new tooltip;
  `add-share.ts` and `tests/add-share.test.ts` say once, at the top, how the box's words map to
  the buttons rather than rewriting every comment.
