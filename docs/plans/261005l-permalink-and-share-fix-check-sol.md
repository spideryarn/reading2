**F11 is closed. F12’s original controller-replacement race is closed, but the registry introduces two further visibility defects. F10 is only partially closed.**

1. **F10 — P1: reload during an unanswered publish still shows off.**  
   [add-share.ts:312](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/add-share.ts:312). The mark is written when the promise settles, not before dispatch. If the server commits and the reader reloads before the reply, the fresh probe gets 404, finds no mark, and shows an unchecked box without an unshare action. My component probe failed: **unchecked over independently tracked public state**. Mark the uncertainty before sending, then clear it when the outcome authoritatively rules out publication.

2. **F16 — P1: the retained controller says Public after Metadata confirms private.**  
   [add-share.ts:173](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/add-share.ts:173), [AddPage.tsx:805](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/AddPage.tsx:805). Share, leave, unshare on Metadata, and revisit Add: `start()` skips its probe and restores cached `on`. This need not be a brief flash: focusing the purpose box before completion arrives holds Ready indefinitely. My probe reached Ready with **Public over private**. Revalidate on attachment; an already published article should use Metadata’s control.

3. **F17 — P1: an old waiting intent can undo a newer explicit unshare.**  
   [add-share.ts:188](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/add-share.ts:188), [AddPage.tsx:806](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/web/AddPage.tsx:806). Confirm sharing before the row exists, receive 404, and leave. Let the import publish; share and then unshare through Metadata. Revisiting Add resumes the retained `waiting` controller and sends public before any fresh probe. My probe observed **private becoming public without another confirmation**. Ordinary resumption of unchanged consent is defensible; resumption after a newer private choice is not. The registry coordinates Add controllers, not Metadata’s writer.

4. **F18 — P3: the reload warning overstates what is known.**  
   [messages.ts:4537](/var/tmp/spideryarn-worktrees/import-permalink-and-share/src/messages.ts:4537). Transport failure and unreadable success also create the mark, so “You made this public” is not established. “You asked to make this public” would be truthful.

The documented second-tab residual is defensible for v1: the owner confirmed publication, unpublished content remains unreadable, and Metadata reads the truth once available. I would not require a new server endpoint solely for that accepted limitation. However, [public-readable-sharing.md:216](/var/tmp/spideryarn-worktrees/import-permalink-and-share/docs/project/public-readable-sharing.md:216) and the postmortem inaccurately say the mark is written when sharing “goes out”; the implementation writes it afterward. Storage failure also leaves a same-tab reload without a mark.

The module-map write during render is not an established blocker: construction is inert, the production IO object is stable, and requests start in committed effects.

**F13 and F14 remain fixed:** inactive controllers stop unsent retries, late 404s schedule none, and completed-import rereads remain guarded. F17 concerns their newly extended reuse across later visits.

Validation: **94 existing tests passed; three additional component/transport probes failed as described.** No repository files changed; scratch probes were confined to `/tmp`. No live database or browser result is claimed.

**Verdict: REQUEST CHANGES — fix F10’s dispatch gap and F16/F17’s stale controller reuse before shipping.**