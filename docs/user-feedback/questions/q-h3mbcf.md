---
id: q-h3mbcf
report: spya-nt6hee
status: open
asked: 2026-10-24
title: Should the fixed parts of an author-gift email be editable too, or only your message?
refs: docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md · docs/user-feedback/261023_2240-author-gift-draft-shows-the-exact-email.md · #687
---
Each author-gift draft now shows the exact email, and you can edit your message in it. The rest of the email is fixed wording. Should that be editable too?

A. Leave it fixed (recommended). Your message is where all the personal text goes. The fixed parts are the subject ("A gift of 20 free articles on Spideryarn"), the heading, and our paragraphs about the gift and how to sign in. They are the same for every gift voucher. Costs nothing more.

B. Make the whole email editable for each author gift. You could rewrite the subject and every paragraph per gift. About a day's work: the email would have to be stored as your text rather than built at Send, and the sign-in instructions could then be edited out by mistake.

C. One editable wording for all author-gift emails, on the Drafts tab beside the message guidance. You could change the subject and our paragraphs once, for every author gift. About half a day.

Recommendation: A for now. Send a few and see whether the fixed paragraphs actually get in the way, then pick C if they do.

Details

What you asked (2026-10-23, #687, about the draft for Alex Warth): you were confused about which text was notes and which was the email, and wanted to edit the email and be sure what would go out, from where, with what subject.

What was done (on dev, not yet deployed): each draft card now shows "The email, if you sent it now", with From (Spideryarn, hello@spideryarn.com, which is also where replies go), To, Subject and the body word for word, rendered by the same code that sends it. "Edit the email" opens boxes for the address, their name ("Dear <name>,"), your message, and the number of free articles. The private notes are labelled "never sent". The lookup's suggested message is now offered in a separate box with "Use as your message" instead of sitting in the notes.

What is still fixed: everything in the email except the greeting name and your message. That wording is shared with every gift voucher you send from the Give form, not just author gifts, which is why it was not made editable in the same change.

What would decide it: whether the fixed paragraphs read wrongly for an author, who is not really "being given articles" so much as being shown their own work. If they do, C fixes it for every author gift at once.
