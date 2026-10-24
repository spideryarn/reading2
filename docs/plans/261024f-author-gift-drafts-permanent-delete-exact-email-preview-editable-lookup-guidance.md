# Author gift drafts: delete for good, the exact email on the card, and the lookup's guidance editable on the page

Three admin reports filed together on `/admin/vouchers?tab=drafts`, 2026-10-23 22:36–22:40 UTC.
All three are Greg's (`feedback-reporter.ts` exit 0), so they are built; what is decided here is
how. Up: [admin.md § Author gifts](../project/admin.md#author-gifts-a-draft-voucher-for-an-articles-author),
[marketing-author-gifts.md](../project/marketing-author-gifts.md).

> There's a discarded draft. I want an option not just to show and restore, but to actually delete
> permanently the discarded draft.
>
> — Greg, 2026-10-23 (#685, `spya-h2r5ap`)

> Okay, so it's made a draft for Alex Worth about the effective expressiveness article, but I'm
> confused about what is notes and what's an actual email that it would send. And basically, I want
> to be able to edit the email that's going to get sent and for it to be crystal clear what the
> subject line, what the text is going to be, so that, you know, if I was to click send, I want to
> be really sure I know what's about to go out and where from.
>
> — Greg, 2026-10-23 (#687, `spya-nt6hee`)

> And I don't know, I can't be sure, but I assume there's some kind of template that you're using or
> a prompt at least for how you're generating these author gift emails. Probably I could edit it in
> the code, but what I'd like to be able to do is edit it in the web interface, you know, have some
> kind of prompt or template that I can easily screw with, you know, in the web that would improve
> these author gift emails going forwards.
>
> — Greg, 2026-10-23 (#688, `spya-n8ruxv`)

## What is wrong today, in one paragraph

The email an author gift sends is the ordinary gift-voucher email: a fixed subject (*A gift of 20
free articles on Spideryarn*), a fixed heading, *Dear <name>,*, then **the note to them** (the one
part Greg writes), the starter article's line and link, then our fixed paragraphs, from
`Spideryarn <hello@spideryarn.com>`. The lookup's model writes a **suggested message** — but it puts
it in the **notes**, the private comments field, and leaves the note to them empty. So the card
shows a long notes block that reads like an email, a *Note to them: none*, and nowhere the email
itself. That is #687 exactly. And the suggested message's wording is a line in
`AUTHOR_LOOKUP_SYSTEM` (`src/author-lookup.ts`), so #688 is right: it is a prompt, editable only in
code.

## Decisions

### D1. Delete for good — discarded gifts only, confirmed (#685)

`DELETE /api/admin/author-gifts/:id`. Allowed only when the gift is **discarded** (`discarded_at`
set, `send_started_at` null) **and no voucher with its `voucher_id` exists** — checked in one
transaction under the gift's row lock. A draft, a half-sent or a sent gift → `409`, unknown → `404`.
Its lookups go with it (`author_lookups.author_gift_id` is `on delete cascade` already); the cost
ledger rows (`ai_calls`, keyed by `run_id`) stay, as spend always does. The article, its private
link and its modes are untouched.

On the page: a *Delete* button beside *Restore* on a discarded gift's line, which opens an inline
confirmation — *Delete this draft for good? Its notes and lookups go with it. This cannot be
undone.* — with *Delete for good* and *Cancel*. No browser `confirm()`, matching the card's Send
confirmation.

Consequences, accepted: the article can have a new gift drafted afterwards (the one-per-article
index is satisfied again), and a late replay of an old `POST /api/admin/author-gifts` would now make
a fresh draft rather than answer the old one. Both are what "delete" means. A lookup still running
when its gift is deleted finishes into `not-found` and writes nothing (`finishLookup` already
handles a missing gift).

This reverses the line in admin.md, *"Deleting a finished gift was weighed and not built"*: Greg has
now asked for it. Sent gifts stay undeletable — their voucher is a billing record.

### D2. The email, exactly, on every draft card (#687)

`GET /api/admin/author-gifts/:id/email` renders the email **with the same function that will send
it** — `giftMessage` in `src/store/pg-voucher-emails.ts`, with the audience from `giftAudienceFor`
(an invitation for a stranger, the reader's numbers for an existing account) and the starter's own
title — and answers `{ from, to, subject, text, audience }`. `from` is `FROM` from `src/email.ts`.
**The one thing not shown verbatim is the private link**: the text carries
`[private link to this article]` in its place, because the page never holds the key (261007j); the
real link is added at Send. With no address yet, `to` is null and the body is the invitation's.

The card gets a block titled **The email that will be sent**, drawn as an email: *From*, *To*,
*Subject*, then the plain-text body exactly as the server rendered it (pre-wrapped). An
*Edit the email* button sits on it and opens the existing draft editor, relabelled so each box says
where it lands: *To*, *Their name* (*the email opens "Dear <name>,"*), *Your message to them* (*the
part of the email you write; everything else is fixed*), *Free articles*. After a save the preview
is fetched again. The Send confirmation shows the same block, so the last thing Greg reads before
the email goes is the email.

The notes are retitled **Private notes — never sent**, and drawn below the email, so the two can no
longer be mistaken for each other.

The plain-text part is what is shown, not the HTML: it is the same words in the same order (the
HTML is built from the same `Said` parts), and it is what can be shown without an iframe. The page
says *As it would go now*: whether the address is already a reader's is read at Send, so the body's
middle paragraph can change if they sign up in between.

**What is not built:** editing the fixed paragraphs, subject or heading of the email. They are
shared with every gift voucher and with readers who are not authors, and making them per-gift text
is a much bigger change (the email is frozen at queue time from those parts). The editable part is
the message, which is where all of the personal text goes. Named here as the deferred half; if
Greg wants the fixed text editable too, that is a follow-up he can ask for.

### D3. The lookup writes the suggested message into the note to them, not the notes (#687)

`finishLookup` already fills the draft's **empty** address and name. It now fills an **empty** note
to them with the model's suggested message too, the same rule: only when empty, only while a draft,
never overwriting what Greg or an agent wrote. When the note was already written, the suggestion
stays in the notes block as now, marked *not applied: the message was already written*. The notes
block otherwise keeps the address source, who the author is, why this piece and what was searched.

The security reading, for the review: D7 of 261010c accepted that a stranger's article in the prompt
can steer the model's answer, because "the only thing its answer can change is the empty fields and
the notes of a draft that nothing sends until Greg presses *Send* after reading them". The note to
them is one of those empty fields; and D2 puts the exact email in front of him at the moment of
Send. So this stays inside D7's acceptance rather than widening it. The note is cleaned with
`noteText` and capped at the voucher's 500-character note limit (the model is held to 120 words
already); a longer answer is cut at a word boundary with nothing appended.

### D4. The note's guidance, editable on the page (#688)

What Greg can edit is **the part of the prompt that says how to write the message** — tone, length,
what to offer, how to sign off. The rest of the prompt stays in code, shown read-only beside it:
what to find, the JSON shape, the URL and address rules, and the untrusted-text fence. Those are the
defences D4 and D7 of 261010c rest on, and the page does not offer them for editing.

- **Storage**: a new table `author_gift_guidance (id uuid, guidance text not null, created_at,
  created_by uuid)`, **insert-only**; the newest row is the guidance in force. A save inserts a row,
  so every past version is kept with when and who (*store when it happened*). *Back to the built-in
  text* inserts a row holding the built-in text. No row at all means the built-in text. `guidance`
  between 1 and 4,000 characters.
- **Routes**: `GET /api/admin/author-gift-guidance` → `{ guidance, builtIn, fixedPrompt, updatedAt }`;
  `PUT /api/admin/author-gift-guidance` `{ guidance }` → the same. Under `/api/admin/`, so behind the
  namespace gate.
- **The prompt**: `AUTHOR_LOOKUP_SYSTEM` becomes a function of the guidance. The fixed line about the
  message says what it is for — *it becomes the message in the email Greg sends, under a "Dear
  <name>," line the email adds and above the email's own paragraphs about the gift and how to sign
  in, so do not open with a greeting or explain how to collect the gift* — and then *Greg's
  guidance for the message:* followed by his text. Greg's text is trusted (an admin's), so it sits in
  the system prompt, outside the article's fence.
- **The built-in text** is today's rule, unchanged in substance: at most 120 words, plain and
  friendly, in Greg's voice, offer the private link and some free articles, claim nothing he was not
  told, no praise beyond what the article plainly is, no numbers; plus *end with "Greg" on its own
  line*, since the note is what he signs.
- **The page**: on the Drafts tab, above the cards, a folded section *How the lookup writes the
  message*: the textarea, *Save*, *Back to the built-in text*, *last changed <when>*, and a
  *Show the rest of the prompt* fold with the fixed part. It applies to lookups started after the
  save; a draft already made is changed by *Look up again* only if its message is empty (D3's rule),
  which the section says.
- **Where it is read**: `startAuthorLookup` reads the newest guidance when it runs and passes it to
  `runAuthorLookup`. Only the lookup; MCP's drafts carry Greg's own text.

Simpler options passed over: **a template with placeholders** (*Dear {name}, I made a version of
{title}…*) would be predictable, but Greg asked for "a prompt or template" to improve the emails, and
a fixed template cannot say why this piece suits its author; the model already writes per piece.
**Editing the whole system prompt** would let a save remove the address rules and the fence, so
the page offers the part that is about voice and keeps the part that is about safety. **A single
mutable row** instead of insert-only loses the history for no saving worth having.

## Stages

1. **Delete** (D1): store function, route, page button and confirmation, tests.
2. **Email preview and relabelling** (D2) and **the note filled by the lookup** (D3): route, hook,
   card block, confirmation, editor labels, notes title, `finishLookup` change, tests.
3. **Editable guidance** (D4): migration, store, routes, prompt function, page section, tests.
4. Docs (admin.md, marketing-author-gifts.md), a browser check by a Sonnet subagent, the Sol code
   review, the feedback notes.

## Tests

- Delete: a discarded gift goes, with its lookups; a draft, a sending and a sent gift are `409` and
  untouched; a missing id `404`; the admin gate sweep gets the route.
- Preview: `to`, `subject` and `from` are the send's; the body is `giftMessage`'s text for the same
  fields with the link replaced; no address → `to: null`; the page draws it and redraws after a save.
- `finishLookup`: an empty note takes the suggestion; a written one is untouched and the notes say
  so; a non-draft takes nothing.
- Guidance: no row → built-in; a save is newest and used by the next lookup's request (read off the
  request body the injected call receives); over 4,000 → `400`; the fixed rules are in the prompt
  whatever the guidance says.

## Revision 1, after GPT Sol's plan review — wins where it disagrees with the above

The review is [261024f-plan-review-sol.md](261024f-plan-review-sol.md). D1 stands as written. All six
findings are taken:

- **R1 (Sol 1): D3 is replaced.** The lookup no longer fills the note to them. Its suggested message
  is stored on its own (`author_lookups.suggested_message`), shown on the card under the email as
  *Suggested message — not in the email unless you use it*, with **Use as your message**, which
  opens the email editor with the suggestion in the message box for Greg to edit and save. Model
  prose reaches the email only through a press of his and an editor he saves, so 261010c's D6/D7
  boundary is unchanged. The notes block keeps a copy of the suggestion, as now, for older gifts
  and for MCP readers.
- **R2 (Sol 2): the preview is called what it is.** The block is titled *The email, if you sent it
  now*, and its small print names what can still change by Send: whether the address already has
  an account (and so which middle paragraph, and its numbers), and the article's title if the
  author's revision changes. Subject, sender, recipient and the message are fixed by the draft and
  checked by Send's `expected`. Freezing a preview snapshot for Send to consume is passed over: it
  would make Send's email differ from every other voucher's for a corner case the small print
  covers.
- **R3 (Sol 3): the preview never reads the key.** A preview resolver in pg-author-gifts.ts reads
  only the revision's title (`loadArticleIdentity`) and passes `[private link to this article]` as
  the starter's URL into `giftMessage`; it does not import `pgShareLinkStore`, so
  `tests/share-link-token-stays-home.test.ts`'s list of callers is unchanged, and a test plants a
  sentinel key and checks the serialised preview does not hold it. Only the text part is
  returned, never HTML.
- **R4 (Sol 4): the safeguards stay fixed.** The fixed part of the prompt keeps: claim nothing
  Greg was not told (not that he has read it, no numbers, no praise beyond what the article plainly
  is), no greeting and no sign-in instructions (the email adds those), and the length bound. The
  fixed part also says the guidance cannot override those rules. The editable part is voice, what
  to offer and say, and the sign-off.
- **R5 (Sol 5): built-in is null, and each lookup records its guidance.** A guidance row with
  `guidance` null means *use the built-in text*, so a later change to the built-in text is not
  shadowed by a copy. The guidance is read when the lookup runs (the page says *applies to lookups
  that run after you save*), and the lookup row records which row it used (`guidance_id`, null for
  no row) when it is claimed.
- **R6 (Sol 6): one length.** The note's real limit is the voucher's 500 characters, so the fixed
  rule asks for at most 450 characters (about 80 words) and the suggestion is stored whole (up to
  the lookup's 1,200-character cap); *Use as your message* puts it in the editor, where an
  over-long one is shown with its count and refused by the server's own rule on Save rather than
  cut silently.

## Code review (GPT Sol), and what was kept

[261024f-code-review-sol.md](261024f-code-review-sol.md). Sol fixed what it found in place; each
fix was read and the gates re-run.

- **Kept: a stale or failed preview could be sent.** The preview is keyed on the gift's content
  (`id`, `updatedAt`, the starter's title) and a refresh counter, so an edit hides the old email at
  once; opening Send's confirmation fetches it again, and the final Send waits for it. Changed
  after review: Sol also keyed on the gift *object*, which the list's poll replaces every few
  seconds while a lookup runs, so every card's email would have reloaded and flashed on each poll.
  Keyed on content only, with a test that a no-change reload keeps the email (red against the
  object key).
- **Kept: the preview could name a different article** once the frozen slug named another one.
  The preview now confirms the gift's `article_id`, slug and owner name the same article and
  refuses an absent or unpublished one as Send does (409). Changed after review: Sol computed the
  title in its own SQL, a second copy of `loadArticleIdentity`'s rule; the title is read through
  `loadArticleIdentity` again, as Send reads it.
- **Kept: a guidance Save could lose a race with a lookup's claim.** The guidance is now chosen in
  the claim's own `UPDATE`. Changed after review: one `claimLookup` returning
  `claimed | not-claimed` with its guidance, rather than two claim functions.
- **Kept:** the docs no longer say "word for word" or "one per article, for good", and the delete
  test proves the lookup's spend survives in `ai_calls`.
