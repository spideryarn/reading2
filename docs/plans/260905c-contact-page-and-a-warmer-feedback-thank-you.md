# A /contact page, and a thank-you that sounds like a person wrote it

Two unrelated feedback reports, both Greg's, both small. They share a plan because they share a
worktree and a commit, not because they share a mechanism.

## The two reports

**SPIDERYARN-READING2-1H**, Greg, 2026-09-05:

> Add a /contact page and link to it appropriately. For now it can be really brief. Mostly just
> saying Spideryarn is in beta, but we'd really love your feedback or suggestions. The best way to
> do it is with the Feedback button in the top right. You can also contact us at
> hello@spideryarn.com.

**SPIDERYARN-READING2-1N** (kind: suggestion), Greg, 2026-09-05:

> After submitting a bit of feedback in the feedback dialogue, it says something like thank you that
> is filed. Can we make that slightly more appreciative? If they marked it as a problem, maybe
> something say something like okay, sorry to hear you've been having a problem, we'll look into it.
> If it's a suggestion, something like thank you for the suggestion. We really appreciate it, or
> yeah thanks for the feedback, and when I click close on the thank you that is filed, there
> shouldn't be a delay, it should happen instantly.

Both are from an administrator, so
[feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it) says build them.

## Stage 1 — `/contact`

A fifth signed-out page, in the shape of `/privacy`: `PrivacyPage.tsx` is the model, not the three
marketing pages, because those carry `SiteNav`, a hero and the `--site-*` token scope, and this page
is three short paragraphs.

**What it says** is Greg's own three sentences, near enough verbatim: Spideryarn is in beta, we would
love your feedback or suggestions, the best way is the Feedback button in the top right, and the
address is `hello@spideryarn.com` — imported from `CONTACT_EMAIL` in `src/site-text.ts`, never
retyped ([website-text.md § The contact address](../project/website-text.md#the-contact-address)).
The address in the report matches what that doc already records, so nothing in the doc changes on
that point.

**Where it is linked from.** One place: `LINKS` in
[`SiteFooter.tsx`](../../src/web/SiteFooter.tsx), which is the whole point of that array's existing —
*"a Terms page is one entry in `LINKS`, not an edit to every page"*. That puts Contact on all seven
pages that carry the row, signed in and signed out, and nowhere under `/read/`.

Three decisions inside that:

- **The footer's `mailto:` stays.** The row will read `Home · Features · Pricing · Privacy · Contact
  · hello@spideryarn.com`, which is mildly redundant, and the redundancy is the cheaper mistake: the
  address is the one thing in the row a stuck reader can act on in one press, it is pinned by
  `tests/site-footer.test.tsx`, and its comment says why it is there. Replacing it with the page
  would be a product change nobody asked for. Named here so Greg can overrule it in one line.
- **Not added to `SiteNav`.** The top bar on `/`, `/features` and `/pricing` already carries four
  links and was measured tight at the 320px reflow width (`SiteBits.tsx`, cross-family review,
  finding 4). Contact is a footer link, like Privacy is in the footer of the app's own pages.
- **`here="contact"` is not needed**, because nothing draws this page at another page's address —
  the `FooterPage` type gains a fifth member and the page itself passes nothing, like all the callers
  bar the two `App.tsx` uses as fallbacks.

Done looks like: `/contact` parses, renders signed in and signed out, has a title, drops its own
footer link, and `npm test` is green.

## Stage 2 — the thank-you, and the Close that is not instant

Two things, and only one of them is copy.

### The message follows the kind

`FEEDBACK_KINDS` is `["problem", "suggestion"]` and the toggle may also be left alone, so there are
**three** endings, not two. The kind rides on the `sent` stage — `{ kind: "sent"; said: FeedbackKind
| null }` — rather than being read out of the live `kind` state, so the sentence is a function of
what was actually filed and cannot drift from it.

The sentences stay in `FeedbackDialog.tsx` rather than moving to `src/messages.ts`. That file is
*"about failures a model call can return"* ([copy.md](../project/copy.md)), a thank-you is not a
failure, and it carries no bracketed code for the same reason the import-state sentences carry none:
nothing here is a problem to quote four characters about.

### The Close delay is a paint-ordering bug, not a network one

Nothing in the Close handler awaits anything: it is `discard(); onClose();`. There is no CSS
transition on `.fb-dialog` or its backdrop either. The cause is the order React does two things in:

1. The click sets `open=false` in `FeedbackButton` and, via `discard()`, `stage={kind:"editing"}`
   here. Both land in one commit.
2. That commit renders the **editing form** back into a `<dialog>` whose `open` attribute nothing
   has touched yet — the show/close sync is a `useEffect`, and passive effects run *after* the
   browser paints.
3. So the reader gets a painted frame of the empty feedback form where the thank-you was, and only
   then does the dialog close.

The fix is `useLayoutEffect` for that one sync, which is what the rest of this codebase already
reaches for when a DOM correction must not be seen (`follow.ts`: *"the first placement is a
correction"*). The dialog then closes in the same commit that emptied the form, before any of it is
painted.

**Reproduced before fixing** by dispatching the click *outside* `act()`, which is what separates the
commit from the passive effects: today the dialog is still `open` at that point, and the editing
textarea is back in the document. After the fix it is shut.

**Not in scope:** `Lightbox.tsx` has the same `useEffect` sync and the same one-frame lag. It is
invisible there because its content does not change on the way out, so it is left alone rather than
changed on a hunch.

Done looks like: three sentences, one per kind, pinned by tests; a red-then-green test for the
close; `npm test`, `npm run typecheck` and `npm run check` green.

## Assumptions and questions for Greg

- The footer carrying both a Contact link and the raw address is a judgment call — see above.
- *"We will look into it"* on a problem is a promise, and it is Greg's own sentence, so it is kept.
- No `/contact` entry was added to `SiteNav`; if Greg wants contact one click from the marketing
  pages, that is one more `<Link>` in `SiteBits.tsx`.

## What the review changed

GPT Sol, 2026-09-05
([the review](260905c-contact-page-and-a-warmer-feedback-thank-you-review-sol.md)) **refused**, on
F1 as an established P0. Every finding was checked here, and three of the four were right about
something the candidate did.

| ID | Severity | Disposition |
|----|----------|-------------|
| F1 | P0 | **fixed, narrowly** — the demonstrated loss is closed; the redesign it also asks for is deferred, below |
| F2 | P1 | **fixed** — one line, and it was already broken before this change |
| F3 | P1 | **fixed** — the page and the doc both said things that were not true |
| F4 | P3 | **fixed** — and the counts are gone rather than corrected |

**F1 — a successful send could erase words that were never in it.** The box stays editable while the
request is in the air, so a reader can add a sentence between pressing Send and the answer arriving.
`discard()` then deleted it. Sol reproduced it in a harness of its own. **It predates this change** —
the old Close button called the same `discard()` — but this change would have widened it from the
button to every dismissal, which is why it is closed here rather than inherited.

The fix is two guards on the reset effect rather than Sol's redesign:

- **`sentBody`**, carried on the `sent` stage: the draft is cleared only if it still matches what was
  posted. Changed, it survives, and the freshly minted `reportId` makes pressing Send again file it
  as the second report it is.
- **`thanksSeen`**: a report that landed while the dialog was shut is not silently dismissed, so the
  reader reopens onto the thank-you instead of an empty box. That case was found here rather than by
  the review, before it ran.

**What is deferred, and it is Sol's other half.** After a *failed* send, an edit and a retry carry
the same `reportId`, and [`pg-feedback.ts`](../../src/store/pg-feedback.ts) answers `duplicate` with
the row it already holds — so the edit is dropped server-side while the reader is shown success.
Same lost-update class, also older than this change, and closing it wants what Sol asked for: the
payload snapshotted at the first Send, a form that stops being editable for that report's lifetime,
and an explicit *Start a new report* action. That is a redesign of the dialog, not a guard, and it is
not what either report asked for. Named here so it is a decision rather than an oversight.

**F3 is the one worth remembering**, because it is the failure this repo keeps having: the page said
*"the Feedback button in the top right, which comes with the page you were on so we can see what you
saw"*, and signed out there is no such button, pressing it here sends `/contact` rather than wherever
they were, and no screenshot goes unless they attach one. Three overclaims in one sentence, on the
page that tells people how to reach us. The doc had the same trouble — it put article and passage ids
in the always-on set when they are behind the tick-box.

**F4** was four stale counts, three of them mine. They are not corrected but **deleted**: two of
those sentences had already been wrong once each for the same reason, and a count beside the list it
counts is a fact with two homes. `tests/site-footer.test.tsx` holds the inventory.

Sol's two remaining opinions were accepted as written: the `useLayoutEffect` is sound and there is no
browser-free test that distinguishes it, and keeping both a Contact link and the raw `mailto:` in the
footer is defensible.

### Round two

A narrowly scoped second pass over the four fixes
([the review](260905c-contact-page-and-a-warmer-feedback-thank-you-review2-sol.md)) **passed**: no
P0 or P1 in the fixes, and Sol confirmed each one against the code rather than against the summary —
that `sentBody` closes the sequence it had reproduced, that `thanksSeen` cannot loop or strand a
report, that no other caller of `takeFile` is broken by the generation bump, and that the two new
sentences are now true of `App.tsx`, `FeedbackButton.tsx` and `feedback-payload.ts`.

It found **one more stale count** — F4 again, the `SPACING` comment claiming four pages take the
default measure. Fixed the same way as the others: the sentence now names the three pages that pass
`variant="marketing"`, which was checked by grep and is exactly `LandingPage`, `FeaturesPage` and
`PricingPage`, and says nothing about how many take the default.

## Log

- 2026-09-05 — written; both stages implemented; browser pass (a `MutationObserver` on the
  `<dialog>` showed the `open` attribute going before the panel content swaps, which is the
  reader-visible claim); GPT Sol review taken and four findings applied.
