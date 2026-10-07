# Feedback

The **Feedback** button, the dialog behind it, and the two places a bug report ends up. Part of
[dev-and-deployment-overview.md](dev-and-deployment-overview.md).

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)

## In this doc

- [§ One box](#one-box-since-2026-09-02) — why the dialog is one box, not three (history)
- [§ Your earlier reports](#your-earlier-reports-since-2026-09-16) — the Earlier tab, [§ Shipped or not](#shipped-or-not-since-2026-09-30) (how a note's header becomes a "shipped" mark), [§ What became of each report](#what-became-of-each-report-for-an-admin-since-2026-10-07) (an admin's four statuses, the `#number`, and the note's comment), and [§ Questions for an admin](#questions-for-an-admin-and-replies-to-them-since-2026-10-07) (an agent's questions at the top of *Needs a decision*, the reply box and its microphone, where a reply is stored)
- [§ The thank-you](#the-thank-you-and-getting-out-of-it) — the message after sending, and the toast
- [§ The keyboard](#the-keyboard-and-the-button-under-it) — the phone keyboard's Done/Send, and shortcuts
- [§ Where it came from](#where-it-came-from) — Greg's original request, verbatim
- [§ The shape of it](#the-shape-of-it) — the row, the Sentry copy, the email: what is authoritative
- [§ The rate cap](#the-rate-cap-and-who-has-none) — thirty an hour per owner: why a send is refused, and who is exempt
- [§ Where the code is](#where-the-code-is) — the file for each piece
- [§ The one rule](#the-one-rule) — why this is the one place reader prose may leave, and the allowlist
- [§ The tick-box](#the-tick-box-and-what-is-behind-it) — what extra diagnostics and the reader's own article add
- [§ The screenshot](#the-screenshot) — capture, shrinking, re-encoding
- [§ Trying it locally](#trying-it-locally) — running it on your laptop
- [§ Reading the reports](#reading-the-reports) — `/admin/feedback`, the mirror columns, and [Ignoring a report](#ignoring-a-report-since-2026-10-03); what to do with them afterwards is [feedback-reports.md](feedback-reports.md)

**One dialog, four shapes of button.** The dialog is mounted once, at the
signed-in `App` level, and hands `open()` down through a context — otherwise a bar that unmounts
takes a half-written report with it. The button is at the right-hand end of the bottom bar on the
two pages that mount a `Dock` — the article and its metadata page (the tweets page was a third until 2026-09-29, when it became a mode), each in an
owner's and a visitor's shape
([260905g](../plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md)); in the shelf's
own masthead row on the homepage (§ below); in `SiteNav` on its four signed-in pages since
2026-10-01; and fixed in the window's top-right corner everywhere else. On a phone the bar's copy
costs it being always-visible: that row already scrolls, and this
button is at the end you have to drag to. Taken deliberately — if reports from phones fall off, that
is the first place to look.

**The rule behind those four is "the page's own chrome cluster, and the corner only if there
isn't one."** The corner is the fallback, not the convention: it was every page's until the reading
view grew a bar, and it stopped being the shelf's when the shelf's masthead turned out to be where
readers actually look. The same rule moved it into `SiteNav` where a corner trigger overlapped the
nav's last link. `FEEDBACK_SHAPE` in [`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx)
is the whole table, and `App.tsx` carries the three exclusions in one predicate.

### The shelf's button is in its masthead, since 2026-09-08

> Show the Feedback button in the top right of the logged in Homepage
>
> — Greg, 2026-09-07 (SPIDERYARN-READING2-2C)

**It was in the top right of the logged-in homepage when he wrote that**, at every width, with
nothing painted over it — and a test had asserted so since 2026-08-31. What it was not was
*findable*: a bare `--ink-faint` speech-bubble glyph fixed to the **window**, its label given up
entirely below the 731px query, while the shelf's own `Profile` and `Admin` links sat in a cluster
of identically-coloured icon-and-label controls about 130px to its left. Two top-rights, and the one
a reader looks at is the page's.

So the trigger takes a third shape, wearing its neighbours' classes verbatim rather than getting a
`fb-` rule of its own — the point of that row is that this control should not be distinguishable
from `Profile` beside it, and a stylesheet rule would be a second place for the two to drift apart.
It is last in the row and so right-most, nearest the corner it came from. **Nothing about a report
changed**: `FeedbackHost` has always sent `slug: null` from every page that is not an article, and
the `url` tag is what makes such a report actionable.

**A report is what made the shelf's `<main>` honour `--safe-top`, too**, and that is a precondition
rather than a tidy-up. Every other signed-in page adds the inset; the shelf's bare `pt-10` did not,
so on an installed iPhone its own `<h1>` sat at y=40 inside a 59px notch. `.fb-button` was
`top: var(--safe-top)` and cleared the notch under its own power — a control in the masthead row
inherits whatever `<main>` says, so the move without that line would have put the button under the
status bar on the very device the report came from.
[260908e](../plans/260908e-feedback-button-in-the-shelf-masthead.md).

**How the "never two buttons" rule survives a new shape.** It is counted, in
`tests/dock-corner-controls.test.tsx`, and it used to be counted with a hand-written list of the
classes that existed when it was written — so a third shape would not have *broken* that test, it
would have made it cover one page fewer, silently. Each shape now carries a `hook` class,
`FEEDBACK_TRIGGER_SELECTOR` is derived from that column, and a second test renders every variant to
check its hook is genuinely on the element — the half a type cannot state, since `hook` and `button`
are two independent strings. [silent-success.md](../reusable/silent-success.md).

## One box, since 2026-09-02

It asked three questions in three boxes for two days. Greg:

> It has three input boxes. I worry that will be intimidating/off-putting to users, so let's combine
> them into one, with combined instructions (and perhaps a tooltip with extra guidance/reassurance).
> And add some kind of indication of our appreciation for them making the effort to provide feedback
> at the top of the dialog box.
>
> Maybe also add toggle for "Bug/problem" vs "Suggestion".
>
> — Greg, 2026-09-02

Three boxes is a form, and a form is what you fill in once you have *decided* to file a bug. The
reader this whole feature exists for is the one who was merely annoyed. So: one `body`, a `kind`
that is **a problem, a suggestion, or nothing at all** (Greg: *"don't default to Problem. Default to
null/unknown"*), a line of thanks above it, guidance under the label, and a microphone —
[dictation.md](dictation.md), the same three lines as every other box.

The three questions themselves survived the boxes and sit above the one box, always visible:

> The Feedback / Problem dialog box wording should explicitly ask users for: Steps to reproduce;
> What you expected to see; and What you saw instead.
>
> — Greg, 2026-09-03

They had spent a day inside a "Not sure what to write?" disclosure, and a hint nobody opens is a
hint nobody reads.

**Since 2026-09-04 that guidance follows the toggle, and the disclosure is gone.** Greg, having
filed the report from inside the dialog:

> I think if the user clicks on a problem, then we want to show that guidance for bug tracking about
> steps to reproduce and what happened and what do they expect to happen — we want to show that text
> explicitly and quite prominently … And then we can get rid of not sure what to write because no
> one will click that.
>
> — Greg, 2026-09-04

So: **Problem** breaks the three asks out as three lines with the disclosure's old look; **Suggestion**
asks what you'd like and what it would let you do; **nothing picked** keeps the 2026-09-03 sentence
unchanged, which is what makes the instruction above still true for a reader who never touches the
toggle. One reassurance was folded out of the disclosure and rides under the three asks; the rest of
it went. `KindHint` in [`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) is the whole of it,
pinned by `tests/feedback-dialog.test.tsx`.

The three old columns were backfilled into `body` under their old headings and **dropped**, so there
is one shape in the table rather than two. The route still accepts the old three from a tab loaded
before the deploy and folds them into `body` the same way; sending both shapes at once is refused.
[260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md](../plans/260902m-one-feedback-box-with-a-kind-toggle-and-dictation.md)
has the reasoning, the GPT Sol review that changed five things about it, and the deploy window Greg
accepted knowingly.

### The dialog names no address, since 2026-09-05

It named two, and both were the same person. The intro said *"It is sent as `<whoever is signed
in>`, so we can reply"*, and the failed-send fallback offered a `mailto:` to `ADMIN_EMAIL`. Greg,
filing it from inside the dialog:

> In the feedback box, it has the following: "It is sent as greg@gregdetre.com, so we can reply.".
> Remove that sentence, and remove any other mentions in the UI of my personal email address,
> greg@gregdetre.com. The only email address we should include on the site is hello@spideryarn.com.
>
> — Greg, 2026-09-05

So the sentence went, the fallback is `CONTACT_EMAIL` ([website-text.md](website-text.md#the-contact-address)),
and the `readerEmail` prop went with the sentence — `App.tsx` → `FeedbackButton` → `FeedbackDialog`
existed only to print it. **Nothing about the report changed**: the address still travels with it and
still comes from the auth gate rather than from the browser's body.

**A reader is still told**, and it is worth knowing where, because the removed sentence was the only
place that said it *in the dialog*: the hover card on the button
([tooltips.md](tooltips.md)) — *"It carries this page's address and your email address, so we can
write back"* — and [privacy.md § What a bug report carries](privacy.md). Neither names anybody, which
is the difference.

**`ADMIN_EMAIL` is untouched and stays.** It is the label on an identity, for logs and for the seed,
and the gate compares ids ([admin.md](admin.md)). What is now pinned is that no browser file imports
it: *the one address a reader is shown* in `tests/site-footer.test.tsx`.

### Send spins, and it already did

> When I click the send button in the feedback dialog, show a loading spinner while it's sending.
>
> — Greg, 2026-09-05

It has done since 2026-09-01: the button's label is a four-way switch, and three of the four are
`.cmt-spinner` plus a word — *Sending*, *Adding the picture*, *Writing that down*
([icons.md](icons.md#the-loading-spinner)). It is `disabled` throughout, and a `sending` ref latch
behind that is what stops two clicks inside one frame filing two reports.

**Nothing was pinning the spinner**, though, so a refactor of that switch could have dropped it with
every test in the file still green. *Spins on Send while the report is in flight* in
`tests/feedback-dialog.test.tsx` now holds it, driven by a `Promise` deliberately left unsettled so
the test can stand inside the `sending` stage and look. If the report says otherwise on a real
screen, the thing to suspect is not the markup: the POST body is built **synchronously** before the
first `await`, so a large pasted screenshot is stringified before React gets to paint the spinner.

## Your earlier reports, since 2026-09-16

> In the feedback dialog box, it would be nice to have a tab showing previous feedback that this
> user has provided, just as a kind of list. I mean, it would be amazing if we could indicate which
> ones have been acted on, but I suspect that will involve access to the database that you
> currently don't have. So do the simplest thing first.
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-3R)

The dialog has two tabs, **Write** and **Earlier**. Earlier is the signed-in reader's own reports,
newest first — the date, problem or suggestion, the page it was filed from (and the paragraph, for
its link), and what they wrote —
read by `GET /api/feedback`, which is owner-scoped in the store like every other read and sends
**seven fields a report and nothing else**: the report's id, those five (the date, the kind, the
page, the paragraph, the words), and whether it shipped. Not the email, the address, the
diagnostics or the screenshot (`EarlierFeedback` in [`src/types.ts`](../../src/types.ts) says why).
Fifty at most, and the list says so when there were more. **Fewer, when they are long**: a report
may be 20,000 characters, so fifty can pass the 4.5 MB a response may be, and the list stops at the
last whole report that fits 3 MiB (`FEEDBACK_LIST_BYTES`; `/admin/feedback` and the admin's own
Earlier view use the same budget). No report is shortened, and the line then counts what it shows —
[261007j](../plans/261007j-feedback-takes-twenty-thousand-characters-and-admin-feedback-pages-by-size.md).

**The page is a label, not the address**, since 2026-10-03. Greg asked that a report carry the page
he was on (`spya-y4upzw`); it had since 2026-09-02, to the row, Sentry, `/admin/feedback` and the
admin's mail, and the dialog was the one place that never showed it. So each row now says
*on /admin/vouchers*. The label is the path alone, with no origin, query string or fragment, and
anything under `/add/` is just `/add`, because that is where a search term or somebody else's
credentialled URL would be. The store makes it, so the address never leaves `listMine`:
[`src/feedback-page.ts`](../../src/feedback-page.ts), and
[the plan](../plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md) has the
surface-by-surface check.

**And the label is a link to that page**, since 2026-10-05 (Greg, `spya-tqk7au`: *"Make it a
link."*). The browser refuses any label that is not a plain path on this site, so
a wrong value cannot become a link elsewhere.

**The link opens the article at the paragraph the report was filed at**, since 2026-10-06 (Greg,
asked whether it should: *"B whatever's simplest"*). The server picks the `at` block id out of the
stored address and sends it beside the label, only for an article's reading page and only when it
has a block id's fixed shape, which is what makes it safe: a value that passes cannot be search
terms. Nothing else from the query is sent, so the link does not restore the mode. The browser
checks the shape again. A reader already on that page at that paragraph stays where they are, and
the dialog just closes:
[261006b](../plans/261006b-earlier-link-carries-the-paragraph.md). Following it in this tab closes the dialog and
uses the app's router so an unsent Write draft survives on ordinary app pages; opening it in
another tab leaves the dialog open:
[261005m](../plans/261005m-earlier-tab-links-the-page-and-marginalia-tips-say-what-to-press.md),
which also records the check that one reader cannot see another's reports here.

### Shipped or not, since 2026-09-30

> It would be nice if we could provide a way to filter to things that have or have not been achieved
> and deployed.
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-63)

Each report also carries **`shipped`**, shown as a word in its meta line, and the tab
filters **All · Shipped · Not shipped** — on the server (`?show=shipped|unshipped`), so the fifty
are the newest *matching* ones, not a filter over the newest fifty.

**Nothing marks it; it is derived from the notes.** A note in `docs/user-feedback/` may start with a
header naming its report row id and its ending (`reports: spya-…` / `ending: shipped`);
[`scripts/feedback-endings.ts`](../../scripts/feedback-endings.ts) compiles the headers into
`src/feedback-endings.generated.ts`, which the server imports. So on production a report reads as
shipped **only once the commit carrying its note has been deployed** — that is the "deployed" half,
for free — and nobody writes to the production database. A report with no note, or a note with no
header, reads as not shipped: the label is never claimed without a note saying so. What this cannot
say is "on `dev`, not yet live"; declined and awaiting both read as *not shipped* (to every reader
but an admin: [§ What became of each report](#what-became-of-each-report-for-an-admin-since-2026-10-07)). The header format,
split reports (`parts:`), the accepted limits, and why this beat a status column are in
[260930e](../plans/260930e-earlier-tab-filters-by-done-from-the-notes.md).

**Each pill says how many, since 2026-10-03**: every answer carries `counts` for all three
filters, uncapped, counted over the same ids the filter uses and in the same snapshot as the list,
and the cap line reads "Showing the 50 most recent of your N not-shipped reports" (fewer than 50 when
the size budget cut the list) —
[261003b](../plans/261003b-earlier-tab-counts-on-the-pills.md).
`tests/feedback-endings.test.ts` goes red when a header does not parse or the committed map is stale.
**The same flip emails the reader**, since 2026-10-02, if they are not an admin: the deploy that
carries the note sends it once that deploy is live —
[email.md § Feedback that shipped](email.md#feedback-that-shipped).

**The Write panel is hidden, not unmounted, and hiding is not switching off.** Its microphone, the
paste and drop handlers on the whole `<dialog>`, and the form's submit all still reach a draft the
reader cannot see; each has a guard and a test. And `.fb-scroll[hidden]` needs its own
`display: none`, because the panel's `display: flex` outranks the UA's `[hidden]` — jsdom cannot see
that one. A send already in flight is allowed to finish: success shuts the dialog and shows the
ordinary thank-you toast, and failure returns to Write so its recovery panel cannot land hidden.
[260916c](../plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md).

### What became of each report, for an admin, since 2026-10-07

> When I look in feedback earlier, not shipped, there's still quite a few listed. […] let's give
> you another category for deferred or ignored, or maybe even both. […] write some kind of comment
> that would indicate why you deferred them, or what the question was […] And maybe you could give
> every single feedback report its own ID somehow, so that it would be easy for us to refer to them
> in conversation.
>
> — Greg, 2026-10-06 (`spya-cnbv8f`)

**For an admin only.** Every other reader's tab, and `GET /api/feedback`, are exactly as above. An
admin's tab reads `GET /api/admin/feedback/earlier` instead: still their **own** reports,
owner-scoped in the store as `listMine` is, but behind the `/api/admin/` gate
([admin.md](admin.md)) because it says three things no other reader is told. Whether to tell
everyone is a question for Greg, in the plan.

- **One of four statuses**, with five pills, **All · Open · Needs a decision · Set aside ·
  Shipped**, each with its count of reports. *Shipped*: the notes combine to shipped. Otherwise
  *Set aside*: an admin pressed Ignore, or the notes say declined. Otherwise *Needs a decision*:
  the notes say awaiting. Otherwise *Open*: no note yet. The order is the rule, so an ignored
  report never asks for a decision. It is one SQL expression (`statusOf` in
  [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts)), used for the row, the filter and
  the counts. No new ending was added to the notes.
- **A number, `#212`**, at the start of the row; say "feedback 212". It is `feedback.number`: one
  sequence across all owners, stored, so it names one report and keeps naming it. Reports from
  before the column were numbered in the order they were filed.
- **One line from the note**, under the reader's words, in the model's face
  ([fonts.md](fonts.md)): the note header's `comment:`
  ([feedback-reports.md § The note](feedback-reports.md#the-note-in-docsuser-feedback)). An ignored
  report with no comment says *Set aside on /admin/feedback* and the date.

**The browser's `isAdmin` only picks which route to ask**; the server decides who is answered. If
the admin route answers 404 (a server from before it, during a deploy or after a rollback) the tab
falls back to the plain list and three pills for that opening. Any other failure, or an answer
that fails the browser's check of it, is the ordinary "would not load" sentence with Try again.

Nothing in this subsection writes to production: a status or a comment changes when a note
changes and the commit carrying it is deployed.
[261007d](../plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md).

### Questions for an admin, and replies to them, since 2026-10-07

> Perhaps you could even find some way of signalling when you need input from me. […] you'd show
> my report and then their question from you, and then some kind of input box with a voice
> dictation button […] And in fact, it should be possible for you to ask my input on things that
> aren't tied specifically to a feedback report.
>
> — Greg, 2026-10-06 (`spya-sshjd2`)

**An agent asks by committing a file; the admin answers in the dialog; an agent reads the answer
with a script.** Nothing an agent runs writes to production, and no route was added outside the
sign-in gate. The price is that a question appears only after a deploy. How an agent writes one and
acts on the reply is
[feedback-reports.md § Asking Greg a question](feedback-reports.md#asking-greg-a-question-and-acting-on-his-answer);
this is what the app does with it.

```
 docs/user-feedback/questions/q-….md ──▶ scripts/feedback-endings.ts ──▶ src/feedback-questions.generated.ts
                                                                          (server only)
 GET  /api/admin/feedback/earlier  ──▶ questions: every open one, with the admin's newest reply
 POST /api/admin/feedback/answers  ──▶ a row in feedback_question_answers
 scripts/feedback-questions.ts --answers  ◀── reads those rows from production, read-only
```

- **Where they show.** `GET /api/admin/feedback/earlier` carries `questions` on every answer:
  every open question, oldest first, whatever the filter. The tab draws them **at the top of
  *Needs a decision***, above the reports, and says *"3 open questions"* beside that pill in every
  view. The pill's number is still its count of reports, and the pills still sum to All: a question
  is not a report, and its report may be shipped, set aside, or nothing at all.
- **What one shows.** When it was asked; the report it is about, as `#number` and that report's
  first line, **only when the report is the admin's own** (the lookup is owner-scoped, so a
  question about another reader's report shows none of it); its title and its text, which an agent
  wrote, in the model's face and as plain text with its line breaks ([fonts.md](fonts.md)); and the
  admin's newest reply, *Answered · when*, in the reader's face. The file's `refs:` and `acted:`
  lines are for agents: they are never compiled into the server, and the browser refuses a question
  carrying any field but the six.
- **Replying.** *Reply* opens a box under the question, one box at a time; a box that is shut keeps
  its words. It has its own microphone ([dictation.md](dictation.md)): a second
  `useDictationField`, with its own keeper name (`feedback-reply`) so a recording left by the Write
  box is never offered here. The microphone stops when the box goes out of sight (another filter,
  the Write tab, the dialog shut), as the Write box's does, and *Send reply* is off while it is
  listening or transcribing. A half-written reply holds the page against an automatic reload, as a
  half-written report does.
- **Where a reply goes.** `POST /api/admin/feedback/answers` with `{ id, question, body }` and
  nothing else: any other key is refused. The `id` is minted by the browser, so a retry is safe:
  **201** for a new reply, **200** with the stored row for the same reply again, **409** when that
  id is already a different reply, which changes nothing. The browser keeps one id for one question
  and one set of words, and mints a new one when the words change, so it does not meet the 409. A
  question id this build has no file for is a 400. **A reply to a question already marked answered
  is accepted**: it may have been typed in a tab opened before that deploy, and the words are kept.
- **The row.** `feedback_question_answers`, keyed `(owner_id, id)`: the question's id, the words
  (at most 12,000 characters, `MAX_FEEDBACK_ANSWER_CHARS`), when, and the `environment` the server
  itself was running in, which is what lets the script tell a production row from a local one. **A
  reply is not a report**: it is never in the Earlier list, on `/admin/feedback`, in Sentry, in the
  endings map or in a shipped email, and it is not rate-limited (the route is admin-only, and an
  admin has no cap).
- **When it fails.** The words stay in the box. A 404 means the page is newer than the server that
  answered (a rollback, or the minutes of a deploy) and says to copy the words, reload and reply
  again; anything else says to try again. If the `questions` part of the list's answer is not what
  the browser expects, the whole list shows the ordinary "would not load" sentence, never some of
  the questions. If a later list no longer contains a question while its box has words or a
  transcription in flight, that question remains beside the local draft until it is sent or
  cancelled; it is not counted as an open question on the pill.

After a reply the card says *Answered* and offers *Reply again*; the question itself leaves the
dialog when an agent marks its file `status: answered` and that commit is deployed, unless the
browser is still holding an unsent reply to it as above.

## The thank-you, and getting out of it

> After submitting a bit of feedback in the feedback dialogue, it says something like thank you that
> is filed. Can we make that slightly more appreciative? If they marked it as a problem, maybe
> something say something like okay, sorry to hear you've been having a problem, we'll look into it.
> If it's a suggestion, something like thank you for the suggestion. We really appreciate it … and
> when I click close on the thank you that is filed, there shouldn't be a delay, it should happen
> instantly.
>
> — Greg, 2026-09-05

**Three sentences, not two.** The toggle may be left alone and *"don't default to Problem"* makes
that the common case, so `THANKS` in [`FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) is
keyed by problem, suggestion and neither. They carry **no bracketed code** and are not in
`src/messages.ts`, for the two halves of the same reason: that file is about failures a model call
can return, and a thank-you is not a failure
([copy.md § The bracketed code](copy.md#the-bracketed-code)).

**The kind is the one that was sent**, read from the send's own closure rather than from the live
`kind` state, so the sentence is a fact about the report that was filed rather than about a form
`discard()` is clearing in the same moment.

### A toast, not a panel

> Remove "It is filed" from the post-Feedback message. And in fact, that post-Feedback message
> should be a toast in the corner that disappears after a few seconds, rather than a blocking modal.
>
> — Greg, 2026-09-29

So the three sentences lost *"It is filed"* and nothing else, and a successful send now **shuts its
dialog opening at once** and shows the sentence in a small toast
([`Toast.tsx`](../../src/web/Toast.tsx)): bottom-right on a wide window, along the bottom less a
16px gutter on a phone, following the Dock when it slides away while staying above the home
indicator. It goes after about five seconds, **not while the pointer is over it or focus is inside
it**, and has a close button.
`role="status"` with `aria-live="polite"` announces it without taking focus; focus goes back
wherever the `<dialog>` returns it on `close()`, to whatever opened it. No animation under
`prefers-reduced-motion`. A library (`sonner`) was passed over: one message from one caller does
not earn a dependency.

**It ordinarily renders outside the `<dialog>`**, as a sibling in `FeedbackDialog`'s own return,
because the send that shows it is the send that shut the dialog, and nothing inside a shut
`<dialog>` is painted. A request can instead land after the reader has closed and reopened the
dialog: that success does not shut the later opening, and its toast renders inside the native
dialog's top layer rather than underneath it. **On failure nothing changes**: the dialog stays up
with the recovery panel.

**The form is emptied under the same rule as before**, only earlier — at the moment the send
succeeds rather than when the reader closed the thank-you panel: `discard(body !== sentBody)`,
which keeps any words typed after Send, since they were never in the POST (GPT Sol's P0, 2026-09-05).
A send that lands after the reader shut the dialog mid-flight now thanks them in the corner, which
is how they learn it went. If they have already reopened it, the completion leaves that opening and
any newer words alone, advances the report id, and shows the toast in that opening. Until 2026-09-29
a `thanksSeen` guard held the thank-you panel for the next opening instead.
[260929f](../plans/260929f-feedback-thank-you-as-a-toast-and-dictation-that-never-runs-out-of-tape.md).

### The delay was something extra being drawn

The 2026-09-05 half of Greg's report, *"there shouldn't be a delay"*, was about the old panel's
Close button, and the lesson outlives the panel. Nothing was slow: the button called `discard()`
and `onClose()` together, both landed in one commit, and React rendered the **emptied form** back
into a dialog that was still open — the frame the browser painted, because the shutting was a
passive effect and those run after the paint.

The show/close sync has been a `useLayoutEffect` since, so the shutting lands in the same commit,
before paint. **A successful send from the current opening depends on that directly**: it calls
`onClose()` and `discard()` together, exactly the shape that flashed. **jsdom cannot see a paint**,
so no test in `tests/feedback-dialog.test.tsx` can tell the layout effect from a passive one
([silent-success.md](../reusable/silent-success.md)); it is a browser check.
[260905c](../plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md).

## The keyboard, and the button under it

> The keyboard on mobile devices should have a Done/Send button where
> appropriate, including this Feedback dialog box.
>
> — Greg, 2026-09-04

Filed from an installed iOS app, and the cause is more specific than the words:
`public/site.webmanifest` is `display: standalone`, so there is **no keyboard
accessory bar** — the strip that would otherwise carry *Done* — and the dialog's
only send chord is ⌘/Ctrl+Enter, which a phone has no way to type. So the reader
was in a box with Send below the keys and no way to reach it.

The fix is three changes and **none of them is the Enter key**, which would
insert a newline whatever it was labelled
([touch.md § What the Enter key promises](touch.md#what-the-enter-key-promises)):

- **`.fb-panel` stopped scrolling as a whole.** The header and the buttons are
  pinned and only `.fb-scroll` between them moves — `.cmt-dialog`'s shape, for
  `.cmt-dialog`'s reason: when the whole box scrolls, the things a reader aims at
  are content, and content scrolls away. `tests/feedback-dialog.test.tsx` holds
  the DOM shape. This is the part that makes a short panel usable at all, and it
  is engine-independent.
- **`interactive-widget=resizes-content`** on the viewport meta in
  [`index.html`](../../index.html), which *asks* for the keyboard to shrink the
  *layout* viewport so that `dvh` sees the room that is actually left. It is
  app-wide, and it had been deferred once as a change not worth making blind
  (the note on `.cmt-dialog`); a reader hitting the consequence is what settled
  it. **This is a Chromium fix.** WebKit's implementation bug is open
  ([259770](https://bugs.webkit.org/show_bug.cgi?id=259770)) and iOS pans the
  visual viewport instead, leaving `dvh` at full height.
- **The dialogs measure `window.visualViewport` themselves** —
  [`useVisualViewport.ts`](../../src/web/useVisualViewport.ts), which is the half
  that does not depend on the browser honouring anything. The Feedback dialog
  takes its `top` and `height` from the visible strip and `.fb-panel` is `90%` of
  *that*; the three bottom-anchored panels (`.cmt-dialog`, `.chat-dialog`,
  `.annotate-dialog`) get a `--kb-inset` that lifts them and shortens them by
  however much is hidden. `tests/visual-viewport-dialogs.test.tsx` drives it with
  a fake viewport.

**Nobody has yet watched any of this on a phone.** What *has* been measured, in
Chrome on 2026-09-04, is the sizing the third change rests on: `.fb-panel` came
out at 900px in a 1000px window and at 306px once the dialog was given the
340px-tall strip a keyboard leaves — 90% of each, with the buttons inside the
strip both times. That proves the box model, not the phone: a desktop window is
not iOS, where the layout viewport does not shrink at all. Until somebody opens
the installed app and reports back, this is a fixed Chromium case and a reasoned
iOS one.

## Where it came from

Greg asked for it on 2026-08-31:

> I want to add a `Feedback` button somewhere, perhaps top-right. It should pop up a dialog box,
> with a request from the user to describe "Steps to reproduce", "What you expected to see", and
> "What you saw instead". It should always send the user-email. It should give them the option
> (default-false) to send extra diagnostics (screenshot, relevant article contents, warning/error
> messages, contents of web browser errors/logs/console, etc). And anything else that will help us
> correlate it with our Vercel logs.

The design work, the options weighed and the two reviews that changed it are in
[the plan](../plans/260831aj-feedback-button-and-bug-reports-to-sentry.md). This doc is the map.

## The shape of it

```
FeedbackDialog.tsx  ──POST /api/feedback──▶  routes.ts  ──▶  Postgres `feedback`   (authoritative)
                                                        ├──▶  Sentry               (best effort)
                                                        └──▶  an email to us       (best effort, readers only)
```

**The row is written first and it is the report.** The reader is told the report landed because the
row landed; the Sentry item is a mirror for the sake of the tools that already watch Sentry, and it
cannot fail the request. Only a *newly created* row is mirrored — Sentry does not dedupe feedback
events, so a retry would otherwise file the same bug twice there while filing it once here.

**Sentry's copy of a long report may be cut short; the row never is.** Upstream Relay gives the
feedback context an 8,192-byte budget and trims strings against it
([contexts/mod.rs](https://github.com/getsentry/relay/blob/master/relay-event-schema/src/protocol/contexts/mod.rs),
[trimming.rs](https://github.com/getsentry/relay/blob/master/relay-event-normalization/src/trimming.rs)),
so a report much past 8,000 characters (the box takes 20,000) probably arrives in Sentry
shortened. Not yet observed on our hosted ingestion — GPT Sol's reading of the source, 2026-10-07.
For the whole of a long report, read `/admin/feedback` or the row.

**A reader's report is also mailed to us, since 2026-10-02**, at Greg's request (report
`spya-wwx6ks`): *"Anytime someone submits feedback that isn't from me, the admin, please send me an
email with their feedback."* Same rules as the mirror — a newly created row only, after the reader
has been answered, unable to fail the request — plus two of its own: never an admin's report
(`isAdmin`), and at most 20 a day across every reader and 5 from any one, because Resend's free
quota is shared with auth mail. The mail carries the words, kind, page address, slug and the reader's email address
(`/admin/feedback` already shows that address), as plain text with the words quoted and their links
defanged. [`src/feedback-notice.ts`](../../src/feedback-notice.ts); the mail side is
[email.md § Mail the server sends itself](email.md#mail-the-server-sends-itself); the plan is
[261002j](../plans/261002j-email-the-admin-each-reader-s-feedback.md).

**The browser posts to us rather than to Sentry directly**, which is the load-bearing architectural
choice and the plan argues it at length. In one line: it is the only arrangement where the
authentication, the validation, the consent and the durable copy all happen somewhere we control.

Its cost is real and named — **when our API is down, the way to report that our API is down is also
down** — and the answer is not a browser-direct backdoor but the Copy button the dialog shows on a
failed send, so the reader still has their words and somewhere to put them.

## The rate cap, and who has none

**Thirty reports an hour, per owner**, counted in the same transaction that is about to insert —
`FEEDBACK_HOURLY_CAP` in [`src/store/contracts.ts`](../../src/store/contracts.ts). Past it the
reader gets a 429, a `Retry-After`, and a sentence saying when. It stops a loop and one account
hammering; it is not a defence against account farming and does not pretend to be.

It was ten until 2026-09-04, when Greg hit it in an afternoon's testing — ten was low enough to stop
the person the button is *for*, somebody who has just found four things wrong on one page.

**The administrator has no cap at all.** `feedbackHourlyCap` returns `null` for an account
[`isAdmin`](../../src/admin.ts) recognises, and the store skips the counting query entirely — the
account that files reports on purpose all afternoon is the one we do not need protecting from. It is
the same id check that guards `/api/admin` ([admin.md](admin.md)), asked of the request's owner,
which *is* the verified account id.

## Where the code is

| what | file |
|---|---|
| the dialog's host, the four shapes of trigger, their hover card, and who sees them | [`src/web/FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) |
| the dialog | [`src/web/FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) |
| its Earlier tab: the reader's own reports | [`src/web/FeedbackEarlier.tsx`](../../src/web/FeedbackEarlier.tsx), and `GET /api/feedback` in [`src/routes.ts`](../../src/routes.ts) |
| whether each earlier report shipped | the notes' headers in [`docs/user-feedback/`](../user-feedback/), compiled by [`scripts/feedback-endings.ts`](../../scripts/feedback-endings.ts); read in [`src/feedback-ending.ts`](../../src/feedback-ending.ts) |
| an admin's Earlier tab: status, number, comment | `GET /api/admin/feedback/earlier` in [`src/routes.ts`](../../src/routes.ts); `listMineByStatus` in [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts); the same `FeedbackEarlier.tsx` |
| questions for an admin: the files, the compile, what the server reads | [`docs/user-feedback/questions/`](../user-feedback/questions/), [`scripts/feedback-endings.ts`](../../scripts/feedback-endings.ts) § `parseQuestionFile`, [`src/feedback-question.ts`](../../src/feedback-question.ts), the rules in [`src/feedback-question-values.ts`](../../src/feedback-question-values.ts) |
| replies to them: the route, the store, the table, the box | `POST /api/admin/feedback/answers` in [`src/routes.ts`](../../src/routes.ts); `submitAnswer` and `newestAnswers` in [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts); `feedbackQuestionAnswers` in [`src/db/schema.ts`](../../src/db/schema.ts); `EarlierQuestions` in `FeedbackEarlier.tsx` |
| listing questions and reading replies, for agents | [`scripts/feedback-questions.ts`](../../scripts/feedback-questions.ts) |
| the microphone on its box | [dictation.md](dictation.md), and two guards this dialog needs that the others do not — see its header |
| the diagnostics allowlist, shared by both halves | [`src/feedback-payload.ts`](../../src/feedback-payload.ts) |
| the client ring buffer the diagnostics read | [`src/web/log-buffer.ts`](../../src/web/log-buffer.ts) |
| the route | [`src/routes.ts`](../../src/routes.ts), § feedback |
| the store, the idempotency and the rate cap | [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts) |
| the Sentry mirror | [`src/feedback.ts`](../../src/feedback.ts) |
| the email to us about a reader's report | [`src/feedback-notice.ts`](../../src/feedback-notice.ts) |
| the guard on the final Sentry envelope | [`src/feedback-envelope.ts`](../../src/feedback-envelope.ts) |
| the reader's own article — source file and `article.json` — gathered for a consented report | [`src/feedback-article.ts`](../../src/feedback-article.ts) |
| the screenshot, taken apart and written again | [`src/feedback-image.ts`](../../src/feedback-image.ts) |
| the table | [`src/db/schema.ts`](../../src/db/schema.ts), § feedback |
| the reader-facing sentences | [`src/messages.ts`](../../src/messages.ts), § feedback |

## The one rule

**A feedback report is the one place in this app where a reader's own prose is deliberately allowed
to leave.** Everywhere else, [`safeEvent`](../../src/monitoring-scrub.ts) exists to stop exactly
that: [security-map.md](security-map.md) and [logging.md](logging.md) are built on the idea that
article text and reader text do not go to third parties.

So this is an **exception, and it is stated out loud rather than smuggled in**. What makes it
legitimate is consent: the reader typed what they typed into a box labelled with what happens to
it. Nothing else gets the same permission, and the exception does not widen `safeEvent` by one
byte — the feedback path builds its own payload rather than relaxing the scrubber.

That gives the rule for anyone adding a field:

> Everything in a report is either **something the reader typed into this dialog**, **a value from
> a closed vocabulary we wrote**, or **a fact the reader is told, on the page, that we take**.
> "It is probably fine" is not a fourth.

**The third clause is new and it was bought, not assumed.** The rule had two clauses until
2026-09-02, when Greg's call to store the whole address introduced a value that is neither — the
URL is an open string, validated but not enumerable. Rather than pretend it fits the second clause,
the rule widened and the price is written into it: the reader has to be *told*, which is why the
address appears in [privacy.md § What a bug report carries](privacy.md) and in the hover card on
the button ([tooltips.md](tooltips.md)). A field that nobody is told about does not qualify, and
that is the whole of the difference between this clause and "it is probably fine".

**The reader's own article is something a report can carry, since 2026-09-13**, and it gets in
under the third clause and no other. The reader ticked a box whose sentence says it *"may also send
the file the article was made from and our copy of its text"*, and `/privacy` says it again. Two
limits keep it inside the clause: it is only ever **the reporter's own** article, read through the
owner-filtered store, because nobody can consent for somebody else's piece; and its metadata is
**picked field by field, not copied**, because the reader's profile and purpose are text the
sentence promises stays behind. The build and its reasons are in
[plan 260913a](../plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md).

`kind` is the second sort: two values and a null, `FEEDBACK_KINDS` in
[`src/types.ts`](../../src/types.ts). It rides to Sentry as a tag, and **as no tag at all when the
reader did not say** — a tag whose value is `""` is one Sentry will group by, while "the ones nobody
classified" is a filter on the tag being missing.

Three things follow, and each of them was got wrong once before it was got right — the first of
them twice, in opposite directions:

- **The raw URL, since 2026-09-02, and knowingly.** It was a route *kind* from a closed list until
  Greg reversed it — *"I think it's fine (and even advantageous) to store the url with the Feedback
  - if that means we can get rid of the route_kind and simplify things"* — because the vocabulary
  cost a migration per page and a 500 whenever its four hand-mirrored copies drifted. The reason it
  was closed still stands and is now a decision rather than a defence: this app's address bar
  carries `?q=` and `?find=`, which are the reader's own typing, and `/add/<a whole third-party
  URL>`, which may carry a credential ([url-state.md](url-state.md) is what makes the address that
  rich). So the reader is *told* — [privacy.md § What a bug report carries](privacy.md), and the
  hover card on the button itself ([tooltips.md](tooltips.md)). `isWebUrl` and a 2048-character cap
  at the route are what remain of the guard. **This bullet said "Never the raw URL" for a day after
  the code stopped meaning it**, and so did two comments in the code; a cross-family review found
  all three on 2026-09-03.
- **Never an `Error.message` or a stack.** Error messages in this codebase have four separate times
  turned out to contain the article. Reports carry an error's *name*, and only a name **on a closed
  list** — `safeDiagnosticName` in [`src/feedback-payload.ts`](../../src/feedback-payload.ts), the
  built-in and `DOMException` names plus the three error classes `src/web/` authors. `Error.name` is
  writable, so a shape check was not one: `PROVIDER_BODY_MARKER` is a perfectly good identifier.
  Anything off the list is recorded as `Error` — reduced, not dropped, because the row's timestamp is
  half of what the buffer is for. Held at both ends, so neither trusts the other.
- **Never the `console`.** Greg's request said "contents of web browser errors/logs/console", and
  taken literally that is a leak — see below.
- **A failed import's *Report this* pre-fills ids and times, and never the address, the file name
  or the error.** The words are `importProblemReport` in
  [`src/web/import-report.ts`](../../src/web/import-report.ts): the job id, the slug, the status,
  the failed step's name, the failure kind and the timestamps. A pasted URL can carry an access
  token, a file name is the reader's own words, and an error sentence is open-ended, so none of them
  fits a clause above just because it sits in the box. Greg kept it that way on 2026-10-02
  (Q-import-report-details, *"yes"*), with the job id as the way back: **Dismiss no longer deletes
  the job record** — it stamps `jobs.dismissed_at` and the reader stops seeing it
  ([ingest-queue.md § The routes](ingest-queue.md#the-routes)) — so the id in a report still names a
  row we can read in the database, until the usual fifty-finished-jobs trim retires it. Nothing
  serves the uploaded file back by that id.

## The tick-box, and what is behind it

Default false, as Greg asked. Ticked, it adds:

- **The last few requests this page made** — method, route template, status, duration, and
  `x-vercel-id`. That last one is the answer to Greg's *"anything else that will help us correlate
  it with our Vercel logs"*: it is the id Vercel logs the request under, it is readable because
  these are same-origin, and **nothing else in this repo ties a browser to a line in a server log**.
  [vercel-hosting-deployment.md](vercel-hosting-deployment.md) is how you then find it.
- **The names of recent client errors.**
- **Which article and which passages** — ids, never prose. [block-ids.md](block-ids.md) is why an id
  is enough: every feature already addresses text that way, and we have the text in our own Postgres.
  The dialog's sentence stopped naming these on 2026-09-13, because the article below subsumes them;
  the blob still carries them.
- **Facts about the browser and the screen.** These are behind the tick-box rather than always-on
  because they are facts about *the reader* rather than about the application, and together they
  fingerprint.
- **On one of the reader's own articles, the article itself** — below.

Untick it and the collector is never called at all. Three separate things enforce that — the client,
the route (`[fb-consent]`), and a CHECK on the table — and the client's is the only one that stops
the collection happening rather than merely refusing the result.

### The reader's own article, since 2026-09-13

> Send up more diagnostic information including attaching source file when the user chooses Send
> extra diagnostics to help with debugging. Change the Feedback dialog message re extra diagnostics
> accordingly.
>
> — Greg, 2026-09-12 (SPIDERYARN-READING2-32)

Agents working reports have no production database or bucket access, so until then a report named
the piece and nothing in it. Now, when the box is ticked, the report names a slug, **and the
reporter owns that article**, the Sentry copy may get up to two attachments — each independently,
so either can be missing while the other arrives — read server-side from what we already hold.
Nothing new leaves the browser and the Postgres row is unchanged:

- **`source.pdf` or `source.html`** — the original document, up to **10 MiB**, which keeps the
  whole event under Sentry's 20 MB envelope limit so a big file cannot cost the reader's words.
- **`article.json`** — the payload the reading page loaded plus a field-by-field pick of its
  metadata, up to **5 MiB of UTF-8**. Never the reader's profile or purpose.

Two tags, each a closed vocabulary, say what happened — `source_file` and `article_json`, each
`attached`, `too_large`, `none` or `failed`. `none` deliberately cannot tell "not yours" from "no
such slug", or the tag would say whether somebody else's article exists. Unticked, the gatherer is
not called at all. It is the *"relevant article contents"* of Greg's first request, above, twelve
days on. The numbers, the envelope nonce, and the options passed over are in
[plan 260913a](../plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md).

### The console is not scraped, and that is a correction to the request

Patching `console.error`/`console.warn` and shipping what they say would collect what *other* code
chose to print. The survey found the specific reason it is unsafe here: `logFailure` in
[`src/web/lib/api.ts`](../../src/web/lib/api.ts) prints 300 characters of a response body, and
`upload.ts` prints 400 — both of which can be article text.

Greg's own replacement is better and is what shipped:

> perhaps we could add some logging library that stores local state ephemerally that normally just
> gets thrown away (or has a fixed FIFO length), but could be included in the error message as a
> rich log of what happened in the runup to the problem?
>
> — Greg, 2026-08-31

That is [`src/web/log-buffer.ts`](../../src/web/log-buffer.ts): a fixed-capacity ring, written
through one narrow function, holding flat already-truncated values. **The property that makes it
safe is that we write the log calls**, so it is an allowlist by construction — the exact opposite of
a console interceptor. Its four rules, and the evidence behind each, are in the plan.

## The screenshot

The reader takes their own (⌘⇧4, PrtScn) and **pastes, drops, or picks** it. There is no one-click
capture: `html2canvas` cannot parse `oklch()`, which is what Tailwind v4 emits throughout our CSS,
so the most obvious library is the one that would visibly misrender every shot it took. The full
spike — including the candidate that *would* work and why it is still deferred — is in the plan.

**PNG only, and the server rebuilds it.** The bytes are taken apart and a new file is written from
the raster, so everything that leaves us is a constant, a validated number, or pixel data. A JPEG
cannot be given that treatment without a baseline decoder, so one is refused — in practice this is
nearly invisible, because the client's own canvas round-trip turns whatever was pasted into a PNG
before it is sent. The reasoning, and the 34 MB of Vercel bundle that the obvious alternative would
have cost, are in [`src/feedback-image.ts`](../../src/feedback-image.ts).

### Shrunk until it fits, since 2026-10-03

> I tried to upload a screenshot to a Feedback report. It wasn't actually very big. I think it was
> like 400KB, but I got an error saying something like the screenshot's too big. This feels like
> something we should be able to address, and I think we should really find a way to allow (if
> necessary auto-resizing) screenshots of at least 5MB?
>
> — Greg, 2026-10-03 (`spya-wa7wms`)

**The file the reader picks has no size limit.** Any image the browser can decode is drawn onto a
canvas and written out as a PNG, so what matters is how big a PNG of those pixels is, and PNG is
poor at photographs: a page with a cover image on it is one to three megabytes at 1600 pixels. So
[`src/web/feedback-screenshot.ts`](../../src/web/feedback-screenshot.ts) tries long edges of 1600,
1280, 1024, 800 and 640 in turn, never larger than the picture arrived, and sends the first whose
PNG is under 90% of the stored limit. Only if 640 does not fit is the reader told it is too big,
and with these numbers no real picture gets there: 640 × 640 of uncompressed noise is 1.64 MB.
The 10% is headroom, because the server writes the file again and its copy can be a little bigger.

**What we store is at most 2,000,000 bytes** — `MAX_FEEDBACK_SCREENSHOT_BYTES` in
[`src/types.ts`](../../src/types.ts), and the `feedback_screenshot_size` CHECK on the table, which
have to move together. It was 400,000, which sent a photographic page at about 640 pixels or not at
all. **It is not Greg's 5 MB because of how the picture travels**: as base64 inside a JSON request,
and Vercel refuses a request over 4.5 MB before our code runs. Two megabytes is 2.67 MB on the wire;
five would be 6.7 MB. The plan is
[261003k](../plans/261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md).

## Trying it locally

**`npm run dev`, and a database.** There is one store, so nothing has to be selected —
[supabase-local.md](supabase-local.md) is how to get Postgres running at all.

**There was a filesystem *refusal* until 2026-09-05**, and it is worth knowing what it was: `POST
/api/feedback` answered 501 with a sentence saying this copy of the app could not file reports,
because there is no feedback table on a filesystem and a button that accepts a report and drops it is
worse than no button. It went with the store it was refusing for
([260903f](../plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md) § F), along
with the same asymmetry in `AdminStore` and `VisibilityStore`.

## Reading the reports

**[`/admin/feedback`](admin.md)**, since 2026-09-02 — every reader's reports, newest first, with
the mirror state written as words. **Readers only** (since 2026-10-01) leaves out the
administrators' own, by `src/admin.ts`'s list, on the server (`?from=readers`). `psql` against the `feedback` table
([database.md](database.md)) still works, and Sentry
([sentry-error-monitoring.md](sentry-error-monitoring.md)) still has its copy.

**The page exists because Sentry was the only reader, and Sentry is the *second* destination.**
Greg filed a report on production on 2026-09-02 and asked where it had gone; it was answered out
of Sentry, because no agent holds a production `DATABASE_URL` and Vercel's runtime logs never
return in time. That works only for reports Sentry received. An unconfirmed row may or may not be
among them: `mirror_attempted_at is not null and mirrored_at is null` cannot tell which. A mirror
being the only way to read the original is backwards.
[260902l-admin-feedback-page.md](../plans/260902l-admin-feedback-page.md).

### Ignoring a report, since 2026-10-03

> I just saw feedback that I wished I could delete, and there wasn't a way to do it, or at least
> mark it as to be ignored.
>
> — Greg, 2026-10-03 (`spya-g95x4j`)

Each card on `/admin/feedback` has an **Ignore** button. It is a mark, not a delete: it stamps
`feedback.ignored_at`, the card stays in the list, dimmed, with its words, and **Undo** clears the
stamp. The report itself is never edited. It is the only write on the page
(`PATCH /api/admin/feedback/:ownerId/:id`, body `{ ignored: true | false }`, behind the same admin
gate as the reads).

**What it does is take the report out of the agents' queue**: `scripts/feedback-unswept.ts` drops a
marked row and says how many it dropped ([feedback-reports.md § Where the queue lives](feedback-reports.md#where-the-queue-lives)).
Nothing a reader sees changes. The Earlier tab's shipped status comes from the notes, as before,
and Sentry's copy is untouched. An admin's own Earlier tab is the one exception, since 2026-10-07:
it shows their ignored report as *Set aside*
([§ What became of each report](#what-became-of-each-report-for-an-admin-since-2026-10-07)).

The list and the write take turns in the browser. A Refresh that read the old row and landed after
the write would draw *Ignore* again on a report already ignored, so neither starts while the other
is in flight (`setIgnored` in [`useAdminFeedback.ts`](../../src/web/useAdminFeedback.ts)).

Not built: a way to add a note to a report (Greg called it lower priority; it is in the Overseer's
queue), a delete, and a separate "invalid" state.
[261003j](../plans/261003j-mark-a-feedback-report-as-ignored-from-the-admin-page.md).

Two columns worth knowing when you do:

- **`mirror_attempted_at` and `mirrored_at` are different questions.** The first is set when we hand
  the report to the SDK; the second only when a transport acknowledgement comes back. They were one
  column until GPT Sol pointed out that the SDK sends asynchronously and swallows transport
  failures, so the single column said "delivered" about reports that never arrived. A row with an
  attempt and no confirmed delivery is the interesting one; it does not prove Sentry lacks the
  report.
  **Before the 2026-10-02 fix it was most rows, and it meant little.** Vercel froze the instance
  once the response had gone, and the mirror runs after it. So 86% of rows never recorded an
  acknowledgement, including many Sentry had received, and some were never sent at all.
  `handler` now registers its work with the platform's `waitUntil` (src/wait-until.ts). The rows
  from before that are left as they are, and they under-report delivery —
  [261002b](../postmortems/261002b-a-pipeline-whose-only-consumer-reads-the-lossy-copy.md).
  **Anything that must not miss a report reads this table, not Sentry:**
  `scripts/feedback-unswept.ts`, [feedback-reports.md § Where the queue lives](feedback-reports.md).
- **`request_vercel_id`** is the feedback POST's own id, read from the request headers on the
  server — the browser cannot put its own response header into its own request.
