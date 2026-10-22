---
reports: spya-yyc7te, spya-u3yw2a
ending: shipped
comment: Every typed Chat, Learn, Explore and guide turn starts from shared principles and, when the totals can be read, is told roughly how much of the article you have read.
---
# The principles every chat shares

Two admin reports from Greg (`feedback-reporter.ts` exit 0 on both, no addenda), batched as
Overseer queue item `qi-3tk6d9ga`:

> Make sure the chat responses are easy to understand, and don't assume that the user has read the
> paper at all (or maybe take a little bit into account the data about broadly which sections
> have/not been read).
>
> — Greg, 2026-10-19 20:15 UTC (`spya-yyc7te`, #634, SPIDERYARN-READING2-KZ)

> Do we have a system prompt (for Chats) (or something equivalent that all Chats share)? If so, it
> should avoid sycophancy, be clear about where its conclusions are coming from (within the article,
> from outside links, or from memory - and provide links/citations where available), explain
> simply/plainly (but not over-simplify), try to help the reader to be smarter (understand more,
> remember more, have better ideas, get there quicker, etc) rather than dumber (as a result of
> cognitive surrender), assist the reader in how to use Spideryarn effectively, take into account the
> reader's background/needs, etc...
>
> We want it to be concise. And probably framed in terms of broad principles, rather than a detailed
> list of rules.
>
> Any other principles we should add? If they're already listed/implict in vision/knowledgebase,
> consider them approved to add.
>
> — Greg, 2026-10-19 20:48 UTC (`spya-u3yw2a`, #646)

**Ending: Shipped**, to `dev`, not deployed, for the five written conversation kinds. Reading
progress and Live conversation remain separate decisions below. The
[plan](../plans/261020d-principles-every-chat-shares.md), its
[plan review](../plans/261020d-plan-review-sol.md), the
[code review](../plans/261020d-code-review-sol.md), and the eval:
[261020a](../investigations/261020a-chat-principles-measured.md).

- **Shipped.** The answer to "do we have one?" was no: each chat had its own prompt, and they had
  drifted (Chat even said *"They are reading it."*). Now `CHAT_PRINCIPLES`
  ([src/chat-principles.ts](../../src/chat-principles.ts)), 195 words, sits near the top of Chat,
  Learn, Tutorial, Explore and the guide: leave the reader sharper, not more dependent, and sooner; candid, not
  agreeable (recheck under push-back, then hold or revise, saying why); make it clear how you know
  each thing; do not assume they have read it; plain, pitched to them, and point at the part of
  Spideryarn that would serve them better. Added as already in the vision: say when you do not know
  or the piece does not say, and give the author's strongest reading before a criticism. Each line
  leaves the detail to the section that already owns it. Blind, overall preference was even (12–11
  for the shipped wording, 12–12 for a first one, against a 13–10 control); pushed back on with no
  reason, the old prompts opened by giving way 8 of 8 times, the new ones by rechecking and saying
  what still held 8 of 8.
- **Shipped, after Greg's answer: chat told how much of the article you have read.** Asked as
  question `q-rwkq2e` (queue item `qi-bkdxh4kb`), because it is a new disclosure:

  > I'm leaning towards A. But also perhaps a minimal prompt to tell the chats not too assume too
  > much knowledge, unless the user exhibits it in the chat/profile/why-i'm-reading (to be on the
  > safe side)?
  >
  > — Greg, 2026-10-20 (`spya-p9bhxh`)

  `/privacy` changed first; then one rough phrase per turn (`READING SO FAR`,
  [src/reading-so-far.ts](../../src/reading-so-far.ts)) and one clause in the principles. Plan
  [261020ac](../plans/261020ac-chat-told-how-much-of-the-article-you-have-read.md), investigation
  [261020g](../investigations/261020g-chat-reading-so-far-measured.md).
- **Not yet: Live conversation.** Its prompts were tuned for terseness and can be measured only
  with the realtime harness, so it is its own queue item, `qi-mawppdbe`, not part of this ending.
