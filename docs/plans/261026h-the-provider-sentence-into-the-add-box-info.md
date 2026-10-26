# The provider sentence goes into the add box's (i)

Up: [plans.md](../project/plans.md) · Report: `spya-kx8z6d` · Question:
[q-p6fvep](../user-feedback/questions/q-p6fvep.md) · Before it:
[261026b](261026b-upload-limits-behind-an-info-button.md)

> B I think it's pretty obvious that we're sending stuff to AI. I mean, the whole thing is AI
> powered, and it's all in the privacy policy.
>
> — Greg, 2026-10-26 (reply `spya-dqhrvy` to q-p6fvep)

Option B was: move *"The article's text is sent to a third-party model provider for processing."*
(`ADDING_SENDS_TEXT_AWAY`) from its visible line under the shelf's add box into the (i) beside File,
with the upload limits. The add box then has no small print left.

## What changes

1. **`LimitsInfo` (src/web/UploadPicker.tsx) holds both notes**: the limits, then the provider
   sentence, as two `TipNote`s in one card. It is in the `pdfButton` slot, so *Upload a file
   instead* gets the sentence too, which is true there as well. Its `aria-label` moves from
   "What you can add" to one that covers both (settled below). A screen reader hears the card when the (i) has focus, as
   `Tooltip` already describes its trigger by the card.
2. **The `<p>` under the add box goes** (src/web/AddArticle.tsx), and with it the comment that
   says it must stay visible "or the promise is not made". It is replaced by a short comment saying
   where the sentence is now, and why (Greg's words).
3. **The comments that leaned on it are made true**: `ADDING_SENDS_TEXT_AWAY` and
   `DIRECT_ADD_SENT_TEXT_AWAY` in src/messages.ts, RefereeMode.tsx § What the notice still is,
   AddPage.tsx's disclosure comment, FeaturesPage.tsx's pointer, and the header of
   tests/direct-add-says-the-text-has-gone.test.tsx.
4. **Docs**: referee-mode.md § Confidentiality (the "shown under both the URL box and the upload
   picker" bullet), and 260831an gets a dated line saying the point-of-adding sentence moved into
   an (i) by Greg's decision. Any line in library.md / ingest-queue.md / privacy.md / the help page
   that says the box shows it.
5. **The test**: tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx gains the provider
   sentence in the pressed card, and asserts the add box at rest no longer spends a visible line on
   it (red against today's code first).

## Referee's past-tense notice

`REFEREE_TEXT_ALREADY_SENT` says *"This article's text has already been sent to a third-party model
provider — that happened when it was added to your library."* That is still **true**; what changes
is that a reader may now meet it as news rather than as a reminder. The 260831an argument was that
the past tense is honest *because* the present tense came first. With B the present tense is still
made before adding — in the (i), the privacy policy and Help — but not where everyone sees it.

Proposal: **leave the notice's wording as it is.** It does not claim the reader was told; it states
what happened and when, which is the useful fact for a referee, and the notice is already about
what to do now (which manuscripts belong here). Changing it to "as the add box says" would point at
something most readers never opened. Only the comments that say "this is what makes it honest"
change, to say it is honest because it is true and plain, and that the before-adding notice is now
in the (i). The chat line in src/mode-catalog.ts (*"already sent to an AI provider when it was
added"*) is the same fact and stays. Asked of GPT Sol in the plan review.

## Not changed

- **The direct-add page's sentence** (src/web/AddPage.tsx, both tenses). It is a progress page with
  room to spare and no small print problem; Greg's question was about the add box. Its comments are
  corrected to stop saying the shelf shows the sentence beside Add.
- **The privacy policy**, which already says it (PrivacyPage.tsx) — Greg's own reason.

## Plan review (GPT Sol, 2026-10-26) and what changed from it

- **Referee's wording stays**, as proposed: it *"stands alone: it states what happened and when,
  without claiming the reader was warned"*. Only the comments that called it a reminder change
  (src/messages.ts § referee, RefereeMode.tsx).
- **No sr-only copy.** Focus opens the card and the open card describes the (i); an always-present
  copy could be read twice. The keyboard test now asserts the provider sentence too.
- **Label:** "What you can add and where its text goes".
- **Missed by the plan:** the Help screenshot `adding-articles.png` still showed both lines of small
  print (already stale after 261026b). Retaken, registry updated, alt text names the (i).
- **Decision records**: q-p6fvep answered, the kx8z6d note shipped, a dated pointer in 261026b.
- library.md, ingest-queue.md, privacy.md and FeaturesPage.tsx say nothing about the line being
  visible, so they are left alone.

## Simpler option passed over

Deleting the sentence outright rather than moving it. Greg chose B, which is "into the (i)", and
the (i) costs no space, so the sentence stays available before adding at zero visual cost.
