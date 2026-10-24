---
reports: spya-wembb7
ending: shipped
comment: On dev. Feedback did not remember anything: you dictated there 10 seconds after a chat dictation. Every press now asks inside your tap, so an iPad should ask once per sitting, until 10 minutes idle or an app restart.
---
# The iPad asks for the microphone on every chat dictation

Report `spya-wembb7` (#695, SPIDERYARN-READING2-NT), a suggestion from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before this note), filed 2026-10-24 16:40 UTC from the iPad
home-screen app, in chat on `arxiv-2308-08708-spya-xax6v4`. Session
`fbwembb7-dictation-permission`.

> Every time I click on the dictate button in a chat, it asks me for permission to use the
> microphone, whereas somehow the feedback dialog seems to remember permission. Is there anything
> we can do about that? And in general, is there anything we can do for it to ask permission to use
> the microphone for dictate less often? I'm on an iPad. I've shared it to my host screen, so I
> guess maybe that means it's in Safari.

**Ending: shipped.** On `dev`, not deployed. Plan, the WebKit source reading, both GPT Sol reviews
and the measurement:
[261024z](../plans/261024z-dictation-asks-for-the-microphone-inside-the-press.md).

## Why the two boxes differed

They don't: chat and Feedback run the same dictation code, line for line. The production logs from
that sitting show the difference was timing. Your chat dictations were about 3 minutes apart, and
each one asked. The Feedback dictation started about 10 seconds after a chat dictation, and did
not. On an iPad or iPhone, WebKit reuses the permission for **10 minutes** after the microphone was
last in use if the request came from your tap, but for only **1 minute** if it did not. What you
saw is the 1-minute rule, so our request was not being counted as your tap. It was made a moment
later, after two other steps (checking no other box had the microphone, and listing the
microphones).

## What we did

Each press now asks for the microphone straight away, inside your tap, whenever no other box is
using it, on every browser except Chrome and Edge (which remember the permission for the site
anyway). A microphone you picked is still used, and you are still told if it has gone.

So on the iPad you should now see a prompt on the first dictation after opening the app, and
again after 10 minutes without dictating, but not in between. Those two are Apple's, and covered in
[261008_0716](261008_0716-iphone-asks-for-the-microphone-again.md), along with the one setting
worth trying (Settings → Apps → Safari → Settings for Websites → Microphone → Allow).

**Not yet tried on an iPad**; the box has none. The test is two chat dictations a minute or two
apart: the second should not ask. If it still does, the cause is something else, and the iPadOS
version would help.

**Still exposed:** pressing dictate in chat while Live conversation is running or connecting
(dictation waits for Live to stop, so it is no longer inside your tap), and Live's own microphone
request, which has the same shape. Both are queued:
`qi-s8w9nshv`, a proposal in the Overseer queue.

For the sweep: resolve SPIDERYARN-READING2-NT.
