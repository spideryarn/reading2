---
reports: spya-nt6hee
ending: shipped
comment: Each draft now shows the email itself (from, to, subject, body) and an Edit the email button; the notes say they are never sent. Whether the fixed wording around your message should be editable too is my question to you.
---
# An author-gift draft shows the email it would send, and you edit it there

An admin report from Greg (`feedback-reporter.ts` exit 0), filed from `/admin/vouchers?tab=drafts`
on build `db758ed8`. No addenda.

> Okay, so it's made a draft for Alex Worth about the effective expressiveness article, but I'm
> confused about what is notes and what's an actual email that it would send. And basically, I want
> to be able to edit the email that's going to get sent and for it to be crystal clear what the
> subject line, what the text is going to be, so that, you know, if I was to click send, I want to
> be really sure I know what's about to go out and where from.
>
> — Greg, 2026-10-23 22:40 UTC (`spya-nt6hee`, #687)

**Ending: Shipped**, to `dev`, not deployed. Plan, with GPT Sol's plan and code reviews:
[261024f](../plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md)
§ D2 and Revision 1.

**Why it was confusing:** the lookup wrote its suggested message into the private notes and left
the message that goes in the email empty. So the card showed a long notes block that read like an
email, *Note to them: none*, and nowhere the email itself.

- **The email, on the card.** Each draft has *The email, if you sent it now*: From (`Spideryarn
  <hello@spideryarn.com>`, which is also where replies go), To, Subject, and the body word for word.
  The server renders it with the same function Send uses. The one thing shown differently is the
  article's private link, which reads *[the private link to this article]* because the page never
  holds the key. The small print says what can still change at Send: whether the address already
  has an account (which changes the paragraph after your message), and the article's title if it is
  re-imported.
- **Edit the email.** The button opens the editor, and each box says where it lands: *To*, *Their
  name* (the email opens "Dear <name>,"), *Your message to them* (the one part of the email you
  write, with a 500-character count), and *Free articles*. The Send confirmation now asks to send
  *the email above*.
- **The notes say what they are:** *Private notes — never sent*.
- **The lookup's suggested message is offered, not applied.** It sits under the email in a dashed
  box marked *not in the email unless you use it*, with *Use as your message*, which puts it in the
  editor for you to change and save. Model-written text never goes into an email without your
  Save.
- **Not done:** editing the fixed parts of the email (subject, heading, and our paragraphs about
  the gift and signing in). They are shared with every gift voucher, so changing them per gift is a
  larger change. Your message is where all the personal text goes. Whether to make the rest
  editable is asked in question `q-h3mbcf`.
