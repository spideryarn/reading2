# A live Remember conversation vanished after leaving Remember mode

SPIDERYARN-READING2-70, from Greg (admin, verified by account id), in production, on
`/read/pmc13013618-spya-uekgh6?mode=remember…`. The time in the file name is when this session
received the report; it runs on a pool account and could not read Sentry.

> I just had a live conversation in remember mode about what I took from it, and it was good. But
> then I went back to remember mode and it seemed to have gone. That's a problem. We would like to
> be storing that - unless it's really complex, in which case I guess just investigate and let me
> know, and we can have a discussion about it via the Overseer agent.

**Ending: Shipped** — on `dev`, not deployed. Resolve 70 (the next feedback sweep does the Sentry
status write).

What we found: it was stored, almost certainly, but as a **Chat**. Remember opens straight into an
empty conversation that exists only in the tab. Pressing Live there made the first spoken exchange
the write that created it, and that write always created a Chat. Coming back, Remember saw no
Remember conversations and opened a fresh empty one. The old conversation was in the shared list,
without the `remember` tag, and in Chat mode. This is what the code does; Greg's own row was not
read, because this box cannot reach the production database.

What we did: the spoken write now carries the kind the tab began the conversation as, and the server
uses it when that write creates the thread. So a live conversation started in Remember is saved as
Remember. Not complex; no new data about the reader, and `/privacy` already says a live
conversation's text is stored as part of the conversation.

For Greg:

- **Your conversation from this report is probably still there, as a Chat** — in Chat mode's list
  for this article. Turning it into a Remember one is a one-line production update. It has not been
  run; say if you want it.
- **Deferred:** the spoken companion in a Remember conversation still uses Chat's live prompt, with
  no Remember stances. That is a separate piece of design.

Plan: [260930d](../plans/260930d-a-live-conversation-started-in-remember-is-saved-as-a-remember-conversation.md).
Postmortem: [260930b](../postmortems/260930b-live-conversation-in-remember-saved-as-chat.md).
