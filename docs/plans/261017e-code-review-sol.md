No P0s. I found and fixed:

- **P1 — duplicate charge risk** — [BringIntoChat.tsx:47](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/BringIntoChat.tsx:47). Two buttons for the same normalized URL could POST before either redrew. Buttons now share notifications and recheck module state before POSTing.
- **P1 — import started despite a full/waiting mention row** — [BringIntoChat.tsx:159](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/BringIntoChat.tsx:159), [ChatPanel.tsx:3612](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/ChatPanel.tsx:3612). Capacity and `mentionWaiting` are checked before spending an allowance slot.
- **P1 — stale mention row during batched updates** — [MentionPicker.tsx:109](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/MentionPicker.tsx:109). Pick, add, remove, edit, and send now share a synchronously updated row ref; remove-then-import no longer resurrects a chip or falsely hits the cap.
- **P1 — unread shelf repeats produced doomed chips** — [BringIntoChat.tsx:63](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/BringIntoChat.tsx:63). Minimal/unreadable articles are refused immediately with guidance to choose *Read this*, instead of failing when the question is sent.
- **P2 — terminal jobs could regress to “Adding…”** — [BringIntoChat.tsx:127](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/BringIntoChat.tsx:127). Done, error, and cancellation outcomes are persisted before their queue snapshot can disappear.
- **P2 — stale composer registration** — [ChatPanel.tsx:3629](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/ChatPanel.tsx:3629). Registration now has ownership-checked layout cleanup and clears when a mounted composer ceases to be typed Chat. ChatDialog owns a separate `Conversation` ref; the list composer has no transcript ref, so those do not contend.
- **P2 — stale success UI, narrow-width overflow, and indistinguishable button names** — [BringIntoChat.tsx:208](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/BringIntoChat.tsx:208), [mode-band.css:1230](/var/tmp/spideryarn-worktrees/fbeqtvhz-chat-bring-in-web-page/src/web/styles/mode-band.css:1230). Success is now a past-tense status while the ready button remains usable; long links/buttons wrap at 390px; source buttons include the page in their accessible name; dynamic refusals are live statuses.

Verification:

- Requested Vitest suites: **51/51 passed**.
- `npm run typecheck` could not start because the sandbox blocks tsx’s IPC socket (`listen EPERM`).
- The identical typecheck script run without that launcher, `node --import tsx scripts/typecheck.ts`, passed all four projects and coverage checks.
- No commit made; unrelated concurrent worktree changes were untouched.

**Verdict: No P0; the stage is ready after the fixes above.**