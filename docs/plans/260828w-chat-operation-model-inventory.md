# Inventory: writes, refs, and tests in `src/web/useChat.ts`

Reference for [260828v-chat-operation-model.md](260828v-chat-operation-model.md). All line numbers are against
`src/web/useChat.ts` as of 2026-08-28 (1735 lines).

## Table 1 — every place `threads` is written

`put` (line 822) is itself one `setThreads` call, listed once below as the wrapper. Each of its
call sites is listed separately as a row, since the classification depends on what that caller is
doing.

| Line(s) | Enclosing function | What it changes | Kind |
|---|---|---|---|
| 727–733 | `refreshThread` | Replace one conversation with the server's copy, or drop it if the server no longer has it (the 409 repair) | authoritative |
| 765 | arrival effect (top-level `useEffect`, keyed on `slug`) | Clear the list to empty when the article changes | structural |
| 806 | `settle` (nested in the arrival effect) | Merge the server's freshly loaded list into what's already on screen (`mergedArrival`) | authoritative |
| 823 | `put` (the wrapper) | Rewrite one thread in place by id, or leave the list untouched if it is tombstoned or missing | *wrapper — see call sites* |
| 842 | `begin` | Append a new, empty local thread | structural |
| 872 | `discard` | Remove an empty thread the reader abandoned (`withoutEmpty`) | structural |
| 1011 | `askToCancel` (catch block) | Put the cancelled conversation back after the server 409s the cancel | authoritative |
| 1024 | `cancelAndDiscard` | Remove the thread from the list before the cancel request is sent | optimistic |
| 1146 (via `put`) | `watch` | Patch the settled answer's fields onto its row once the poll finds it | authoritative |
| 1163 (via `put`) | `watch` | Mark the row as failed once the recovery window has passed with no answer found | structural — a local give-up, not a server response; does not fit the plan's three named examples cleanly (see note below) |
| 1265 (via `put`, as `patchReply`) | `run` (called from `drainTurn`'s frame loop, and from the outer `catch`) | Rewrite the assistant row's text/tools/status as stream frames arrive; or, from the outer `catch`, record a transport failure | mixed — authoritative for delta/tool/done/error frames from `drainTurn`; structural for the transport-failure patch at line 1441, which is a local classification of a fetch failure, not something the server said |
| 1312 | `nameRow` (inside `run`) | Swap the optimistic thread/message/question ids for the server's real ones (`withServerIds`) | authoritative |
| 1493 | `send` | Insert the optimistic question row and the empty pending reply row | optimistic |
| 1573 (via `put`) | `retry` | Reset the target row to pending, blanking every field but the carried-over stance | optimistic |
| 1616 (via `put`) | `edit` | Rewrite the question in place and replace everything after it with one fresh pending reply | optimistic |
| 1688 (via `put`) | `rename` | Set the new title on screen before the PATCH resolves | structural, per the categories given for this table — but see note |
| 1705 | `remove` | Drop the thread from the list before the DELETE resolves | structural, per the categories given for this table — but see note |

**Note on `rename`/`remove` as "structural."** The categories given for this table define
structural as "local only: begin/discard/rename/delete." `begin` and `discard` are local only —
nothing leaves the tab. `rename` and `remove` are not: both call the server (`write`, a PATCH or a
DELETE) and both leave the optimistic change on screen if that call fails — the comment on `write`
(line 1659) says so explicitly, and `remove`'s DELETE is not reverted on failure either. That makes
them read more like "optimistic, and deliberately never reconciled" than "local only." The plan
document itself ([260828v-chat-operation-model.md](260828v-chat-operation-model.md), the "Why `base` is..."
paragraph) lists only `begin`, `discard`, and `rename` as the three local/structural edits — it does
not mention `remove` there. This inventory follows the categories as given in the task, but the
mismatch is worth resolving before stage 1: is `remove` structural (like `begin`/`discard`) or is it
its own thing (a write that never rolls back)?

## Table 2 — every ref/state cell, and every site that reads or writes it

"After await" marks a site that runs once an `await` in the same async flow has already resumed —
the staleness checks the plan is about. "Partial" means the site is a loop-top check that is before
the first `await` on the loop's first pass, and after the tail `await` on every pass after that.

| Name | Declared | Site | R/W | Enclosing function | After await? |
|---|---|---|---|---|---|
| `onScreen` | 617 | 619 | W | `useEffect([threads])` — mirrors `threads` onto the ref | No |
| `onScreen` | 617 | 1613 | R | `edit` | No — `edit` has no `await` |
| `gone` | 634 | 649 | W (clear) | `useEffect([slug])` cleanup | No |
| `gone` | 634 | 805 | R | `settle` (runs via `.then(settle)` once `askForThreads` resolves) | Yes |
| `gone` | 634 | 824 | R | `put`'s `setThreads` updater | Depends on caller — `put` itself has no `await`; it is after-await whenever the caller is `watch` (post-`settledAnswer`) or `nameRow` (post-fetch), and not when the caller is `retry`/`edit`/`rename` |
| `gone` | 634 | 1009 | W (delete) | `askToCancel` catch block | Yes — after `await apiFetch` threw |
| `gone` | 634 | 1022 | W (add) | `cancelAndDiscard` | No — set before `askToCancel` is called |
| `gone` | 634 | 1136 | R | `watch` loop, top of iteration | Partial |
| `gone` | 634 | 1139 | R | `watch` loop | Yes — immediately after `await settledAnswer` |
| `gone` | 634 | 1704 | W (add) | `remove` | No |
| `latest` | 645 | 1023 | R | `cancelAndDiscard` | No — read before `askToCancel` is called |
| `latest` | 645 | 1714 | W | top of hook body, every render | No — not inside an async flow at all |
| `showing` | 678 | 718 | R | `refreshThread` | Yes — immediately after `await askForThreads(mine)` |
| `showing` | 678 | 764 | W | arrival effect | No — set before the fetch starts |
| `showing` | 678 | 1137 | R | `watch` loop, top of iteration | Partial |
| `showing` | 678 | 1140 | R | `watch` loop | Yes — immediately after `await settledAnswer` |
| `running` | 687 | 725 | R | `refreshThread` | Yes — after `await askForThreads`, right after the `showing` check |
| `running` | 687 | 1261 | W (increment) | `run` | No — synchronous setup, before the async IIFE starts |
| `running` | 687 | 1445–1447 | R+W (decrement) | `run`'s `finally`, inside the async IIFE | Yes — `finally` runs after the awaited fetch/`drainTurn` work, success or throw |
| `stopWanted` | 886 | 957 | W (add) | `stop` | No |
| `stopWanted` | 886 | 1232 | W (delete) | `run` | No — synchronous setup, before the async IIFE |
| `stopWanted` | 886 | 1314 | R+W (delete) | `nameRow` (invoked from `drainTurn`'s `begin` frame, inside `await drainTurn(...)`) | Yes |
| `stopWanted` | 886 | 1337 | W (delete) | `nameRow` | Yes |
| `stopWanted` | 886 | 1449–1450 | W (delete) | `run`'s `finally` | Yes |
| `cancelWanted` | 896 | 1021 | W (add) | `cancelAndDiscard` | No |
| `cancelWanted` | 896 | 1334–1335 | R+W (delete) | `nameRow` | Yes |
| `attempts` | 907 | 915 | W (clear) | `useEffect([slug])` cleanup | No |
| `attempts` | 907 | 935 | R | `askToStop` | No — read while building the request body, before `await apiFetch` resolves |
| `attempts` | 907 | 993 | R | `askToCancel` | No — same, before `await apiFetch` resolves |
| `attempts` | 907 | 1316 | W (set) | `nameRow` | Yes |
| `owned` | 1049 | 1200 | R | watcher-scan `useEffect` | No — plain effect, not async |
| `owned` | 1049 | 1256 | W (claim) | `run` | No — synchronous setup, before the async IIFE |
| `owned` | 1049 | 1293 | W (claim) | `nameRow` | Yes |
| `owned` | 1049 | 1455–1456 | W (release) | `run`'s `finally` | Yes |
| `watched` | 1087 | 1090 | W (clear) | `useEffect([slug])` cleanup | No |
| `watched` | 1087 | 1113 | R | `watch`, entry guard | No — before any `await` in `watch` |
| `watched` | 1087 | 1115 | W (set) | `watch`, entry | No — before any `await` in `watch` |
| `watched` | 1087 | 1136 / 1139 | R (via `stillOurs()`) | `watch` loop | Partial / Yes — same split as `gone` above |
| `watched` | 1087 | 1172 | W (delete) | `watch`'s `finally` | Yes |
| `watched` | 1087 | 1174 | R | `watch`'s `finally` (inside the `setRecovering` updater) | Yes |
| `released` (state) | 1063 | 1458 | W (`setReleased`) | `run`'s `finally` | Yes |
| `released` (state) | 1063 | 1204 | R | watcher-scan effect's dependency array | No — a dependency comparison, not a value read in application logic; its only job is to make the effect re-run |
| `recovering` (state) | 1074 | 1116 | W (`setRecovering`, add) | `watch`, entry | No — before any `await` in `watch` |
| `recovering` (state) | 1074 | 1173–1178 | W (`setRecovering`, delete) | `watch`'s `finally` | Yes |
| `recovering` (state) | 1074 | 1722 | R | hook return value | No — read every render, not inside an async flow |

## Table 3 — what each chat test pins

Test files under `tests/` whose name contains `chat` and that import `useChat` or `ChatPanel`,
found by grepping the whole file body (not just import lines — several imports span multiple
lines) for `\buseChat\b` or `\bChatPanel\b`.

| File | Tests | Mounts React? | What a failure would mean |
|---|---|---|---|
| `tests/chat-arrival-race.test.ts` | 7 | Yes (`createRoot`/`act`) | The arrival load (`mergedArrival`) stopped protecting a send, a delete, or an answer that finished while the initial fetch was still out — one of those would be silently overwritten or lost the moment the list loads. |
| `tests/chat-client.test.ts` | 7 | No — pure unit test | `withServerIds` stopped renaming the right question/answer pair when the server overrules a thread id, or `withoutEmpty` stopped dropping (or started wrongly dropping) an empty conversation. |
| `tests/chat-edit-guard.test.ts` | 3 | Yes (`createRoot`/`act`) | An edit stopped sending the tail id the reader was actually looking at (`expectedTailId`), so the server could no longer tell a stale edit from a fresh one — a stale tab could silently discard turns it never saw. |
| `tests/chat-error-scope.test.ts` | 3 | Yes (`createRoot`/`act`) | A failure message from one article's hook leaked into another article after a slug change, or a repair left running by the old article overwrote the new article's conversation. |
| `tests/chat-list-composer.test.tsx` | 11 | Yes (`createRoot`/`act`) | The composer under the conversation list stopped appearing, clearing, or keeping a half-typed question at the right moments — the reader could lose typed text or be shown a composer over a list that isn't really there yet. |
| `tests/chat-list-loading.test.tsx` | 6 | Yes (`createRoot`/`act`) | The list stopped telling "still loading" apart from "loaded and empty" apart from "failed to load" — a reader on a slow or failing connection would be told they have no conversations when the truth is the fetch never finished. |
| `tests/chat.test.ts` | 79 | No — pure unit test | These tests exercise `titleFrom`, `recentHistory`, `unknownCitedIds`, and `fitView` — none of which are in `useChat.ts`. The file only matches the grep because it imports the `SUGGESTIONS` constant from `ChatPanel.js`; it does not mount `ChatPanel` and does not touch any of the write sites in Table 1. A failure here says nothing about the operation model. |
| `tests/use-chat-recovery.test.ts` | 11 | Yes (`createRoot`/`act`) | Recovery from a lost stream stopped working — a `pending` row with nobody writing to it would spin forever instead of being adopted once settled, retried on a fresh mount, or turned into a failure after the server's deadline passes. |

## What surprised me while building this

- `chat.test.ts` matches "imports `useChat` or `ChatPanel`" only through one import line pulling
  `SUGGESTIONS` out of `ChatPanel.js` for an unrelated pure-function suite (`titleFrom`,
  `recentHistory`, `unknownCitedIds`, `fitView`). None of its 79 tests touch a write site in Table 1.
- `remove` and `rename` are classified "structural" per the categories given for Table 1, but they
  are not local-only the way `begin`/`discard` are: both call the server and both leave the
  optimistic change on screen, un-reverted, if that call fails. The plan document's own list of
  local/structural edits names only `begin`, `discard`, and `rename` — not `remove`. Worth deciding
  before stage 1 whether `remove` belongs with `begin`/`discard`/`rename` or is its own category (an
  optimistic write that is deliberately never reconciled).
- The give-up write at line 1163 in `watch` (marking a row `error` after the recovery window
  passes) doesn't fit optimistic/authoritative/structural cleanly — it's neither a guess ahead of
  the server nor something the server said; it's a local timeout declaring failure.
