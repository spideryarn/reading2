---
reports: spya-qem46c
ending: shipped
---

# On an iPhone the command bar says "press Enter", and there is no Enter

Report `spya-qem46c`, from Greg (an admin; `feedback-reporter.ts` exited 0 on the production row),
filed 2026-10-05 07:32 UTC from Summary on
`entropy-26-00481-with-cover-from-taylor-beck-spya-naz564`; Sentry SPIDERYARN-READING2-DC; Overseer
queue qi-5ehfmgf5, session `fbqem46c-iphone-command-bar-no-enter`. Filed as a suggestion, treated as
a bug: the action could not be reached at all.

> I'm on an iPhone. I tried the voice input to the command bar to ask a question, and it said,
> Nothing matches. Press enter to something something. But there was no way to kick off that action
> on an iPhone because I don't have an enter key.

**Ending: Shipped**, on `dev`. Plan
[261005f](../plans/261005f-command-bar-ask-button-a-finger-can-press.md); postmortem
[261005f](../postmortems/261005f-an-action-offered-in-words-that-only-a-key-can-take.md).

- **Built**: the empty line's offer is a button, **Ask what you meant**, that does what Enter did.
  *or press Enter* stays beside it at a desk and is hidden on a phone. After *Couldn't tell what you
  meant* the same button says **Try again**; Enter was the only retry there too.
- **Also**: a test that lists product-control strings outside Help saying *press Enter*, so the next
  one is looked at.
- **Not tried on a real iPhone.** jsdom tests, and a look in a touch-emulated browser on the box.
- Nothing deferred, so no further queue entry.
