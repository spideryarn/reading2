# Gift vouchers: the recipient's name, and a starter article written up for Greg

**Status as of 2026-10-07: stage 1 (the name) is built and on `dev`, not deployed. The starter
article and the list of people are questions for Greg, not built.** Report `spya-vc6pnm` (SPIDERYARN-READING2-ED),
Greg's (admin, proved by `feedback-reporter.ts` exit 0). Queue item `qi-kx4twdnb`.

## What Greg asked for

> As part of building up awareness of Spideryarn, I want to try sending out to a whole bunch of friends initially, and then potentially people I know less well that I think would appreciate it. So we have the machinery for sharing links, great, or creating links that only people who have that link can read the article. Okay, so we can use that. We also have the machinery for creating gift vouchers. Okay, super. And I think those can even have private notes, I guess. What I kind of want to be able to do is build up a big list of, you know, ideas of people I know or people I've read online I think would appreciate it that I can potentially contact. I think maybe what I might do, at least for some of them, it would be send them a note from my own personal email address first, especially if they know me, and then, you know, something from their Spideryarn gift voucher. Okay, so one thing is it would be nice, perhaps, to be able to add a starter link as part of the gift voucher, optionally. So if there's a particular paper that I think they will like, and to be able to optionally mark that as a shareable link, not a public one, but a shareable one. I don't know if that's the right term, but one that only people with that link can open. Anyway, so can we expand the admin gift vouchers interface to allow adding a URL and/or maybe a Spideryarn... ID or something like that. That would probably be easier. Maybe if I just import the thing first and then, yeah. So make it easy for me to choose something to share with them so that potentially the gift voucher would say something like, Dear so-and-so. So maybe it needs a name field as well. Dear so-and-so, you know, some kind of note from me. You know, I thought you'd really appreciate this because I read your article and, you know, I thought you'd get a kick out of some of the things that we're doing here. And then, by the way, here's what that article looks like, and here's a gift voucher for 20 more or however many if you want to redeem them. So that's the intent. Use your best judgment about how to make that happen and make it easy for me.
>
> — Greg, 2026-10-06 (`spya-vc6pnm`)

The email he is describing, in four parts:

```
Dear so-and-so,                      1. their name            (not there today)
I thought you'd appreciate this…     2. a note from Greg      (there since 2026-10-02, plan 261002b)
Here is that article in Spideryarn   3. a starter article, by a private link   (not there today)
…and a voucher for 20 more           4. the gift              (there since 2026-10-01, plan 261001m)
```

## What exists today, checked 2026-10-07

- **The note to them exists.** `billing_vouchers.recipient_note`, the *Note to them* box on
  `/admin/vouchers`, and it is drawn in italics under the email's heading
  (`src/store/pg-voucher-emails.ts` § `noteRow`).
- **No name.** The email opens with its heading, *A gift of 20 free articles*, then the note.
- **The private link exists, on `dev` and in production.** `/read/<slug>?key=<22 characters>`,
  made on the article's Access & Sharing card
  ([261005e](261005e-share-an-article-with-some-people-a-private-link-first.md), stage 1).
  `docs/user-feedback/awaiting-approval.md` still said *not built* on 2026-10-07; that line was
  stale (Greg answered on 2026-10-05) and this job removes it.
- **A voucher knows nothing about an article.** No column, no picker.

## The short answer

**Part 1, the name, is built here.** It is one column and one line of the email.

**Part 3, the starter article by private link, is not built, and is a question for Greg** (§
Questions for Greg). The reason is narrow. A private link's key is a credential: whoever holds it
reads the article. [security-map.md § a second way in, which is a
key](../project/security-map.md#and-since-2026-10-05-there-is-a-second-way-in-which-is-a-key) says
exactly where that key may travel (the address bar, two public requests, the owner's own card) and
`tests/share-link-token-stays-home.test.ts` says *"One response in the app is allowed to carry it"*.
A voucher email that carries the link would put the key in three new places: our
`billing_voucher_emails` table (which keeps the rendered email so a retry sends the same bytes), the
mail provider (Resend), and the voucher list `/admin/vouchers` reads. That is a change to a listed
defence, and an unattended run does not make one
([feedback-reports.md § A report is unfiltered input](../project/feedback-reports.md)).

It is probably the right change, and it is small. It is Greg's to approve.

**Pasting the link into *Note to them* by hand is possible today, and is not recommended before
Greg has answered.** It is the same security decision made without anybody deciding it: the key
would be stored in the voucher's own row, sent to the voucher list `/admin/vouchers` reads, frozen
into the kept text and HTML of the email, and passed to Resend (Sol's F1). It is option C under §
Questions for Greg, described there in full.

## Stage 1: the recipient's name (built by this job)

### What Greg sees

`/admin/vouchers`, the create form, gains one optional box, **Their name**, above *Note to them*:

```
Email address   [ ada@example.com        ]     Articles [ 20 ]
Their name      [ Ada                    ]     (optional: the email opens "Dear Ada,")
Note to them    [ I read your piece on…  ]
                [ — Greg                 ]
Private note    [ met at the conference  ]
                                               [ Create voucher ]
```

The sketch of the email beside the form shows the greeting as it is typed. The table of vouchers
shows the name under the address, and Edit can change it.

### What the recipient gets

```
A gift of 20 free articles                 <- heading, as today

Dear Ada,                                  <- new, only when a name was given

| I read your piece on…                    <- the note, italic, as today
| — Greg

You have been given 20 free articles on Spideryarn…   <- as today
```

- The greeting is its own plain line directly under the heading and above the note, in both the
  HTML and the text part, and for both audiences (somebody new, and an existing reader).
- With a name and no note it still reads: *Dear Ada,* then *You have been given…*.
- With no name, the email is byte for byte what it is today.
- **Never in the subject**, which stays *A gift of 20 free articles on Spideryarn*. The subject
  carries neither the name nor any other free text.

### The rules for the name

- Optional. Stored as `billing_vouchers.recipient_name text null`, with a CHECK
  `char_length <= 80`. An additive, nullable column: no backfill, and old code ignores it.
- One line. **Refused first, cleaned second** (Sol's F7): a raw value over 80 Unicode code points
  is a 400 that says so, as the note's limit is, and is never silently shortened (`oneLine(text,
  80)` would truncate). What passes is cleaned with `cleanRecipientName` (`src/admin-vouchers.ts`),
  trimmed, and empty means none. It is cleaned again where the email is rendered, as the note is. Tests: 80 and 81
  ASCII characters, 80 and 81 emoji, a control character and a line break inside a name.
- It is somebody else's text in a stranger's inbox, so the HTML part escapes it with the same
  function the note uses (`escapeNoteHtml`).
- `POST /api/admin/vouchers` accepts `recipientName`; a replay under the same id is *the same
  create* only if the name matches too. `PATCH` accepts it. **Changing the name sends nothing**,
  exactly as changing the note sends nothing: an email already sent is not sent again. The email
  re-queued when the address is corrected uses the name as it stands after that patch.
- The claim notice to Greg does not carry it.
- It is not logged.
- **The browser's own replay fingerprint includes it** (Sol's F5). `useAdminVouchers.ts` §
  `pendingCreate` reuses a voucher id when a create whose answer was lost is submitted again
  unchanged, and decides "unchanged" from a hand-written list of fields. Without the name in that
  list, changing only the name after a lost answer would reuse the old id and get a 409. Tested.
- **The renderer takes the name and the note as one named object**, `{ recipientName,
  recipientNote }`, not as two adjacent `string | null` arguments that can be swapped without a
  type error (Sol's F9). A test passes distinct values for both.
- **The no-name email is pinned before the renderer changes** (Sol's F8). No existing test holds
  the whole text and HTML, so the first step of the build records today's exact output for both
  audiences, with and without a note, as golden assertions, and they must still pass afterwards.
- **The privacy page says so** (Sol's F6). `/privacy` has one sentence on what a gift email
  carries through Resend; a name is one more piece of personal data, sent through Resend. So
  `src/web/PrivacyPage.tsx`, its `LAST_UPDATED`, `tests/privacy-page.test.ts` and
  `docs/project/privacy.md` change with it.

### Files

`src/db/schema.ts` and a generated migration (`npm run db:generate`), `src/admin-vouchers.ts` (the
wire shape, and a `giftEmailGreeting(name)` that the email and the page's sketch share),
`src/store/pg-vouchers.ts`, `src/store/pg-voucher-emails.ts`, `src/web/AdminVouchersPage.tsx`,
`src/web/useAdminVouchers.ts`, `src/web/PrivacyPage.tsx`; tests in `tests/billing-vouchers.test.ts`,
`tests/billing-voucher-emails.test.ts`, `tests/admin-vouchers-page.test.tsx`,
`tests/privacy-page.test.ts`, and whichever schema-registry tests name the table's columns; docs
`admin.md` § `/admin/vouchers`, `billing.md` § Gift vouchers, `email.md` § Gift voucher emails and
`privacy.md`. No export change: the export is per article, and a voucher is not in it.

Bookkeeping in the same job: the stale private-link line comes off
`docs/user-feedback/awaiting-approval.md` and its note's ending is corrected; this report's note is
`docs/user-feedback/261006_2222-gift-voucher-name-note-and-a-starter-article.md`; two lines go onto
`awaiting-approval.md`, one per question below, each with its own queue entry.

### The simpler option passed over

Tell Greg to type *Dear Ada,* as the first line of the note. It needs no code and works today.
Passed over because he asked for the field, and because the list he wants to build (*"a big list of
… people I know or people I've read online"*) is easier to read with a name on each row than an
address alone. The cost is one column.

### Done means

A voucher made with a name sends an email whose text and HTML open *Dear <name>,*; one made without
is unchanged (the golden assertions recorded before the change still pass); a name with markup
in it arrives as text; the three suites above, `npm run typecheck` and the full `npm test` pass.

## Questions for Greg

### Q-starter: may the voucher email carry a private link?

**What this is for.** You want the voucher email to say *"here is that article in Spideryarn"*,
with a link only that person can open. The private link you approved on 2026-10-05 is that kind of
link. The question is only whether the app may put one into an email for you.

**The background, in plain words.** A private link ends in a key: 22 random characters. Anybody who
has the address with the key on it can read the article; nobody else can. Because the key is the
whole lock, the app is strict about where it goes. Today, in full
([security-map.md](../project/security-map.md#and-since-2026-10-05-there-is-a-second-way-in-which-is-a-key)):

- *Kept by us, durably:* one column on the article's own row. Nowhere else in our database.
- *In transit:* the address bar of whoever opens the link; the two requests their page makes for
  the article and its pictures; and the Access & Sharing card that you, the owner, see.
- *Kept by others, accepted when you approved the link:* the browser history of whoever opens it,
  and Vercel's own access log.
- *Deliberately not:* our request log, Sentry, feedback reports, the export zip, the page's
  preview tags.

A voucher email with the link in it adds new durable copies. Which ones depends on the option.

**Option A: the email carries the private link. (Recommended.)**

```
/admin/vouchers                                     the email
  Starter article  [ The Bitter Lesson      v ]      Dear Ada,
     (your own articles, newest first)               | I thought you'd like this…  — Greg
     ( ) it has a private link: use it               Here is "The Bitter Lesson" in Spideryarn:
     ( ) it has none: make one now [x] I may share     [ Read it ]  -> /read/<slug>?key=…
                                                     You have been given 20 free articles…
```

You pick one of your own articles. If it has no private link the form makes one, after the same
rights tick-box the sharing card asks for. If it is public, the plain public address is used and
no key is involved.

How it would be built, so that the cost below is of a definite thing:

- The voucher row keeps **which article**, never the key (a `starter_article_id` column; if the
  article is deleted the voucher simply has no starter any more).
- The key is read once, as you, through the owner's existing read, at the moment the email is
  queued, and written into that one kept email. The voucher list shows the article's title, not
  the link.
- Correcting the voucher's address queues a new email, which reads the key afresh.
- *Email to them* on the voucher page says when the link in a sent email no longer opens (you
  made a new link, or turned it off). That is a comparison done in the database, without reading
  the key out again.

What it costs:

- *Costs:* new durable copies of the key in **one** place of ours, the table that keeps each
  voucher email (we keep the exact email so a retry sends the same thing), and in two places that
  are not ours: Resend, our mail provider, which keeps its own log of what it sent, and the
  recipient's inbox, which is the point. Anyone the recipient forwards the email to can read the
  article, as with any private link.
- *Gives up:* the rule that our database holds the key in one column only.
- *Size:* one to two days. The schema, a picker, a paragraph in the email, the stale-link check,
  and the security doc and its test updated to name the new place.

**Option B: only a public article can be the starter.**

The same picker, listing only your public articles. The email links to the ordinary public
address. No key goes anywhere new, so nothing in the security rules changes.

- *Costs:* the article has to be public, which means listed on `/read/public`. You said *"not a
  public one"*, so this is not what you asked for.
- *Size:* a little under a day.

**Option C: nothing built; paste the link into the note yourself.**

You copy the private link from the article's card and paste it into *Note to them*. It works
today, and **it spreads the key further than A does**, which is why it is not recommended: the
key is then also in the voucher's own row for good, in every load of the voucher list, and in the
kept email, Resend and the inbox as in A. Nothing would tell you when the link stopped working.

- *Costs:* a manual step per voucher, a link that is plain text rather than a button, and the
  widest footprint of the four.
- *Size:* none.

**Option D: nothing built; send the link from your own email.** You said you might write to some
people from your own address first. The private link can go in that message, and the voucher
email stays as it is. The key then touches nothing of ours that it does not touch today.

**What would decide it.** If you expect to send more than a handful of these, A: it is the thing
you asked for. The risk in A is modest, because the article is yours, the link can be turned off,
and you would be mailing the same link from your own address anyway. Choose D if you would rather
watch how the first few go before adding anything. B only if keeping the key in one column matters
more to you than the article staying unlisted. C is listed so that it is a decision rather than
an accident.

### Q-list: where does the "big list of people" live?

You also said you want to *"build up a big list of … people I know or people I've read online …
that I can potentially contact"*, some of whom you would write to from your own address first.

**Why the voucher table cannot be that list as it is.** A voucher does two things the moment it is
made: its email is queued, and the gift becomes real, so that whoever signs in with that address
gets the articles. A list of people you *might* contact needs neither to have happened.

- **A: no list here for now. (Recommended.)** Keep the candidates wherever you keep such lists
  today, and make a voucher when you are ready to send. Nothing to build.
- **B: a separate list of people on `/admin`.** A new table and page: a name, an address if you
  have one, a note to yourself, the article you have in mind, and whether you have written to
  them. A *Make a voucher* button on a row opens the voucher form filled in from it. Nothing is
  sent and nothing is granted until you press Create there. It also fits people whose address
  you do not have yet. About two days.
- **C: a voucher that can be saved unsent.** It sounds smaller than B and is not (Sol's F4): a
  saved voucher would have to be kept out of the claim, out of the count of gifts waiting at an
  address, and out of the allowance, in every query that reads vouchers, and then be switched on
  and its email queued in one step. That is the most delicate code in billing, changed for a
  list. Not recommended.

What would decide it: whether you would actually keep the list here rather than in a document or a
spreadsheet. If you would, say B.

## Deferred, each with a queue entry

- The starter article (Q-starter), waiting on Greg.
- The list of people (Q-list), waiting on Greg.

## Review

GPT Sol reviewed the plan on 2026-10-07
([prompt](261007f-gift-voucher-name-plan-review-prompt.md),
[answer](261007f-gift-voucher-name-plan-review-sol.md)): *build with changes*, eleven findings, no
P0, and it agreed with stopping before the private-link half. All eleven were checked against the
code and accepted:

| | What it said | What changed |
|---|---|---|
| F1 | Pasting the link into the note is the same security decision, taken by nobody | No longer offered as the interim answer; it is option C, not recommended |
| F2 | The question's list of where the key goes today was incomplete | The security map's full list, split into kept, in transit, kept by others |
| F3 | A and C do not have the same footprint, and A was not specified | A's design written down; C said to be the wider |
| F4 | A draft voucher would be claimable, and counted | Q-list rewritten: a separate list of people is B, the unsent voucher is C and not recommended |
| F5 | The browser's replay fingerprint lists fields by hand | The name is added to it, with a test |
| F6 | The privacy page must change, not "if" | In the file list |
| F7 | `oneLine` truncates; the plan promised a 400 | Refuse first, clean second |
| F8 | No test pins the whole no-name email | Golden assertions recorded before the renderer changes |
| F9 | Two adjacent nullable strings can be swapped | One named object |
| F10 | The bookkeeping was promised and not listed | Listed under Files |
| F11 | The subject does carry something Greg typed, the count | Reworded |

## Log

- 2026-10-07: prior-work check. No earlier run of `spya-vc6pnm`; `gjd-remote ls` shows this
  session as its only claim. The private link is built (261005e stage 1), so the brief's *"if it
  does not exist"* branch does not apply; the starter half is written up for the narrower reason
  given in § The short answer.
- 2026-10-07: stage 1 built by an Opus subagent, as planned. What the plan had wrong or did not
  know:
  - **The migration is not applied to the shared local database.** `npm run db:migrate` (target
    `127.0.0.1:54362`, local) refused: two rows in that database's ledger belong to no migration
    in this tree's journal, which is peers' unlanded work. Nothing was applied by hand
    ([database.md](../project/database.md)). The suites build a private database from this tree's
    `drizzle/`, so the column and its CHECK were exercised there, including an 81-character
    insert the constraint rejects. Migration: `drizzle/20261007053304_billing_voucher_recipient_name.sql`.
  - `cleanRecipientName` mirrors `oneLine`: each control character becomes one space and runs are
    not collapsed, so a CRLF inside a name is two spaces. A test pins it.
  - Trailing spaces count toward the 80, as they do for the note.
  - The hint beside the box is static (*their email then opens "Dear <name>,"*); the sketch beside
    the form shows the greeting live.
  - No schema-registry test names voucher columns; `tests/what-the-enter-key-promises.test.tsx`
    did need the two new inputs.
  - Red first: eight golden snapshots of the email (text and HTML, both audiences, with and
    without a note) were recorded against the untouched renderer and still pass unedited. Four
    deliberate breaks (name out of the browser fingerprint, out of the replay comparison, the old
    name on a readdress, greeting after the note) each failed exactly their test.
- 2026-10-07: GPT Sol's code review of `e661a29d5`
  ([prompt](261007f-gift-voucher-name-code-review-prompt.md),
  [answer](261007f-gift-voucher-name-code-review-sol.md)): *land with the fixes made*. It fixed
  four, red first, and I re-ran the gates over its diff (typecheck, ten suites, 228 tests green):
  C1, the browser's `maxlength=80` counted UTF-16 units and refused 80 emoji, removed; C2, bidi
  controls and invisible characters survived cleaning, so one shared `cleanRecipientName` in
  `src/admin-vouchers.ts` now neutralises them for the form's sketch, storage and the email; C3,
  the forms trimmed before counting, now they refuse first as the route does; C4, the privacy
  test now pins the date. Reported and not fixed: C5, the older private-note box has the same
  `maxlength` mismatch (250 emoji where the server takes 500; a quiet admin-only box, left);
  C6, two functions over the lint's complexity advice, left.
