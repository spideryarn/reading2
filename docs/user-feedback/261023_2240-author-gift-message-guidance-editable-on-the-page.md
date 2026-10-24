---
reports: spya-n8ruxv
ending: shipped
---
# How the lookup writes an author gift's message is editable on the page

An admin report from Greg (`feedback-reporter.ts` exit 0), filed from `/admin/vouchers?tab=drafts`
on build `db758ed8`. No addenda.

> And I don't know, I can't be sure, but I assume there's some kind of template that you're using or
> a prompt at least for how you're generating these author gift emails. Probably I could edit it in
> the code, but what I'd like to be able to do is edit it in the web interface, you know, have some
> kind of prompt or template that I can easily screw with, you know, in the web that would improve
> these author gift emails going forwards.
>
> — Greg, 2026-10-23 22:40 UTC (`spya-n8ruxv`, #688)

**Ending: Shipped**, to `dev`, not deployed. Plan:
[261024f](../plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md)
§ D4 and Revision 1.

You guessed right: it is a prompt, the author lookup's (`src/author-lookup.ts`), and the message
was one line of it. At the top of the Drafts tab, *Show how the lookup writes the message* opens a
box with that guidance: the voice, what to offer, how to sign off. It has *Save* and *Back to the
built-in text*, and the rest of the prompt is shown read-only beneath it, so you can see everything
the model is told. Each save is kept as a new version, and each lookup records which version it
used. A save applies to lookups that run afterwards; *Look up again* on a draft gets a fresh
suggestion.

What stays in code, whatever the guidance says: what to search for, where an address may come from,
that the article is data and not instructions, and that the message claims nothing you were not
told and stays under 450 characters (the email's message box holds 500).
