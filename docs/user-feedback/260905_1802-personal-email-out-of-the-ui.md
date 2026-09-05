# The personal address comes out of the UI

**[SPIDERYARN-READING2-22](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-22)** · reported
2026-09-05 18:02 UTC · *shipped*

## What Greg said

> In the feedback box, it has the following: "It is sent as greg@gregdetre.com, so we can reply.".
> Remove that sentence, and remove any other mentions in the UI of my personal email address,
> greg@gregdetre.com. The only email address we should include on the site is hello@spideryarn.com.

## The sentence he quoted was not the leak

It interpolated `readerEmail` — **whoever is signed in**. It said his address because he was the one
reading it; it would have said any other reader's back to them. Removed, along with the whole
`readerEmail` prop chain, which existed only to print it: the browser never sends the address, the
server takes it from the auth gate ([`src/feedback.ts`](../../src/feedback.ts)).

**The real one was the occurrence he did not mention.** On a failed send the dialog offers a
`mailto:` fallback so the reader does not lose their words, and it was built from `ADMIN_EMAIL` — a
literal `greg@gregdetre.com`, on a reader's screen, at the moment something had already gone wrong.
It is `CONTACT_EMAIL` now.

That is the shape worth remembering: **the reported instance was a template, and the unreported one
was the constant.**

## Nothing new was written to replace it

A reader is still told the address is attached, in two places that name nobody — the Feedback
button's hover card (*"It carries this page's address and your email address, so we can write
back"*) and `/privacy` § What a bug report carries. So the removal costs the reader nothing except
that the statement is no longer *inside* the dialog. If it should be back there, the honest sentence
is *"It is sent with your email address, so we can reply."* — one word changed, no interpolation.

## The sweep, and what was deliberately left

Everything else that renders an address already used `CONTACT_EMAIL` — footer, privacy, features,
contact. Nothing in `public/`, `index.html` or the Supabase templates carries it.

Left alone, each for a stated reason: `ADMIN_EMAIL` in [`src/admin.ts`](../../src/admin.ts) (a
human-readable label; the gate compares uuids and `describeAdminMiss` interpolates nothing into a
server log), test fixtures that assert no reader-visible copy, `infra/` provisioning, and the docs.

**Two flagged rather than changed:**

1. `authConfirmationSent(email)` in [`src/messages.ts`](../../src/messages.ts) prints *"Check
   `<address>` for a confirmation link"* — the reader's own address, typed seconds earlier, and
   load-bearing because it says which inbox to open. It would render Greg's if he signed up with it.
2. `/privacy` says Spideryarn is *"run by one person in London"* with no name, and
   [privacy.md](../project/privacy.md) already flags the controller's identity as the policy's soft
   spot under UK GDPR Art. 13. Not this report's business, but it is the other end of the same
   question.

## The guard is for the class, not the two instances

*"Any other mentions in the UI"* is a rule, so it is held by a rule:
[`tests/site-footer.test.tsx`](../../tests/site-footer.test.tsx) sweeps `src/web/` and fails if any
file **imports `ADMIN_EMAIL`** — an import check rather than a text match, so a comment quoting the
original request is not a false positive. It has a companion assertion that the sweep found files at
all, because a collector matching nothing passes every assertion about its contents.

Both fixes watched red first: *"expected '…' not to contain 'so we can reply'"* and *"expected
'mailto:greg@gregdetre.com?subject=…' to contain 'mailto:hello@spideryarn.com'"*.
