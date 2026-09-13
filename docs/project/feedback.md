# Feedback

The **Feedback** button, the dialog behind it, and the two places a bug report ends up. Part of
[dev-and-deployment-overview.md](dev-and-deployment-overview.md).

**One dialog, three shapes of button, since 2026-09-08.** The dialog is mounted once, at the
signed-in `App` level, and hands `open()` down through a context — otherwise a bar that unmounts
takes a half-written report with it. The button is at the right-hand end of the bottom bar on the
three pages that mount a `Dock` — the article, its metadata page and its tweets page, each in an
owner's and a visitor's shape
([260905g](../plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md)); in the shelf's
own masthead row on the homepage (§ below); and fixed in the window's top-right corner everywhere
else. On a phone the bar's copy costs it being always-visible: that row already scrolls, and this
button is at the end you have to drag to. Taken deliberately — if reports from phones fall off, that
is the first place to look.

**The rule behind those three is "the page's own chrome cluster, and the corner only if there
isn't one."** The corner is the fallback, not the convention: it was every page's until the reading
view grew a bar, and it stopped being the shelf's when the shelf's masthead turned out to be where
readers actually look. `FEEDBACK_SHAPE` in [`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx)
is the whole table, and `App.tsx` carries the two exclusions in one expression.

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

**The kind rides on the `sent` stage**, not on the live `kind` state, so the sentence is a fact about
the report that was filed rather than about a form `discard()` is about to clear.

### The delay was something extra being drawn

Nothing was slow. The Close button called `discard()` and `onClose()` together; both land in one
commit, so React rendered the **emptied form** back into a dialog that was still open — and that is
the frame the browser painted, because the shutting was a passive effect and those run after the
paint. The reader saw a blank feedback form flash up in place of the thank-you they were dismissing.

So the button only closes, an effect empties the report once `open` has gone false, and the
show/close sync is a `useLayoutEffect` rather than a `useEffect` so the shutting lands in the same
commit as the press. **It fixed a second thing nobody had reported**: Escape, the ✕ and the backdrop
left the stage at `sent`, so the next press of Feedback opened on a stale thank-you with the old
draft behind it.

**jsdom cannot see a paint**, so the obvious test — wait a microtask, read `dialog.open` — was green
against the bug as well as after the fix; it was written, watched pass, and thrown away
([silent-success.md](../reusable/silent-success.md)). What `tests/feedback-dialog.test.tsx` pins
instead is the **order the DOM changes in**: at the moment `close()` is called, the thank-you must
still be on screen. [260905c](../plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md).

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
                                                        └──▶  Sentry               (best effort)
```

**The row is written first and it is the report.** The reader is told the report landed because the
row landed; the Sentry item is a mirror for the sake of the tools that already watch Sentry, and it
cannot fail the request. Only a *newly created* row is mirrored — Sentry does not dedupe feedback
events, so a retry would otherwise file the same bug twice there while filing it once here.

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
| the dialog's host, the three shapes of trigger, their hover card, and who sees them | [`src/web/FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) |
| the dialog | [`src/web/FeedbackDialog.tsx`](../../src/web/FeedbackDialog.tsx) |
| the microphone on its box | [dictation.md](dictation.md), and two guards this dialog needs that the others do not — see its header |
| the diagnostics allowlist, shared by both halves | [`src/feedback-payload.ts`](../../src/feedback-payload.ts) |
| the client ring buffer the diagnostics read | [`src/web/log-buffer.ts`](../../src/web/log-buffer.ts) |
| the route | [`src/routes.ts`](../../src/routes.ts), § feedback |
| the store, the idempotency and the rate cap | [`src/store/pg-feedback.ts`](../../src/store/pg-feedback.ts) |
| the Sentry mirror | [`src/feedback.ts`](../../src/feedback.ts) |
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
the mirror state written as words. `psql` against the `feedback` table
([database.md](database.md)) still works, and Sentry
([sentry-error-monitoring.md](sentry-error-monitoring.md)) still has its copy.

**The page exists because Sentry was the only reader, and Sentry is the *second* destination.**
Greg filed a report on production on 2026-09-02 and asked where it had gone; it was answered out
of Sentry, because no agent holds a production `DATABASE_URL` and Vercel's runtime logs never
return in time. That works only for reports Sentry received — which is exactly the set that
`mirror_attempted_at is not null and mirrored_at is null` excludes, and that query is advertised
two paragraphs down as the way to find a stranded report. A mirror being the only way to read the
original is backwards. [260902l-admin-feedback-page.md](../plans/260902l-admin-feedback-page.md).

Two columns worth knowing when you do:

- **`mirror_attempted_at` and `mirrored_at` are different questions.** The first is set when we hand
  the report to the SDK; the second only when a transport acknowledgement comes back. They were one
  column until GPT Sol pointed out that the SDK sends asynchronously and swallows transport
  failures, so the single column said "delivered" about reports that never arrived. A row with an
  attempt and no delivery is the interesting one.
- **`request_vercel_id`** is the feedback POST's own id, read from the request headers on the
  server — the browser cannot put its own response header into its own request.
