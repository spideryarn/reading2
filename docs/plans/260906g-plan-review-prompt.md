# Review: a plan to give the reading view a "back to where you jumped from" control

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from` (a git worktree
of the main repo), branch `worktree-back-to-where-you-jumped-from`. TypeScript + ESM throughout, run
with `tsx`, tested with vitest. It is a React reading app: an article is a list of **blocks**, each
with a stable id like `spya-k3m9qt`, and everything about how you are looking at an article lives in
the URL query string.

**You are reviewing a plan, not code. Nothing has been built.**

## The candidate

Committed: `224d8977` — a single new file.

```
git show 224d8977 --stat
git show 224d8977
```

Changed paths: `docs/plans/260906g-back-to-where-you-jumped-from.md` (new, 197 lines).

Start with that file. This is where to begin, not the limit of what is in scope — the code and docs
it cites are all in the tree and are the real subject.

## What it is meant to do

A reader taps a glossary term and is thrown three thousand words across the article. In a desktop
browser they press Back and land where they were. Added to an iOS home screen the app runs in a
`"display": "standalone"` shell (`public/site.webmanifest`) with **no browser chrome at all**, so
there is no Back to press and no edge-swipe. The owner asked for a "back to previous location"
button, possibly with a dropdown of previous locations, and possibly marks in the spine rail fading
over time.

The plan's central claim, and the thing most worth attacking:

> The mechanism already exists; only the affordance is missing. Every deliberate jump already pushes
> a browser history entry and no scroll ever does, so the fix is to expose the browser's own stack
> rather than build a second one.

The proposed mechanism, in one paragraph: `watchHistoryWrites` in `src/web/router.ts` (~line 1174)
already monkey-patches `history.pushState` and `history.replaceState` and is the single choke point
through which **both** the nuqs query-state library's writes and the app's own `pushAddress` pass.
The plan has it stamp `history.state` on each same-pathname push with the `?at=` block id the reader
is leaving. A chip is then drawn only when `history.state` names a block the current article has;
pressing it calls `history.back()` and nothing else.

The contract it must not break:

- `docs/project/url-state.md` — the URL is the only source of truth for how you are looking at an
  article; scrolling *replaces* history, deliberate jumps *push*. Read § "Position replaces history;
  deliberate acts push" and § "Reopening an article where you left it".
- `docs/project/block-ids.md` — content is addressed by stable block id, never by offset or
  selector. Ids survive re-extraction; a *positional* id does not.
- A link a reader shares must open the same view for the recipient. Nothing about this feature may
  ride along in a shared URL.

Deliberately out of scope, and argued for in the plan: a dropdown of previous locations, the fading
multi-mark spine trail, and cross-device resume (a schema change, so the owner's call).

## Key code to orient yourself

- `src/web/router.ts` — `watchHistoryWrites` (~1174), `pushAddress` (~1094–1105), `carriedSearch`
  (~552), `parseRoute` (~492), `settleAddress`/`liftStrandedText` (~807+).
- `src/web/App.tsx` — `useReadingPosition` (~1569) and `jumpTo` (~1666), which is the one function
  every "go there" in the app funnels through as `onJump`.
- `src/web/last-view.ts` — the already-shipped "reopen where you left it", and its `REMEMBERED` /
  `NEVER_REMEMBERED` / `NEEDS_AN_EXPLICIT_PRESS` lists.
- `src/web/keynav.ts` (~399) and `src/web/swipe.ts` (~296) — the movements that must *not* push.
- `src/web/Spine.tsx` and `src/web/spine-marks.ts` — the rail, for the plan's Stage C.
- `src/web/scroll.ts` — `scrollToBlock`, `arrivalTarget`.
- `tests/url-state.test.ts`, `tests/last-view.test.ts`, `tests/router.test.ts` — the existing pins.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run **one test
file** (`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`), and you
can build a throwaway harness under `/tmp`. You have **no network, not even loopback**, so anything
needing Postgres or a local service will fail — do not treat a skip there as a finding.

`tests/url-state.test.ts` and `tests/router.test.ts` are pure and should run.

## Attack it

Independently, before you read my questions below.

The invariant to break: **after this lands, is there any sequence of ordinary reader actions where
the chip is drawn and pressing it does something other than "put me back exactly where I jumped
from"?** Leaving the article, undoing a setting, landing at the top, landing somewhere the reader
has never been, or doing nothing at all all count.

Second invariant: **does the stamp survive contact with nuqs?** The plan assumes `history.state` is
free real estate. Check `node_modules/nuqs` and the app for anyone else reading or writing it.

Third: **is the plan's factual account of the current code true?** It makes several load-bearing
claims about what pushes and what replaces. If any is wrong the plan's shape is wrong.

For each finding give:

- an **ID** (`F1`, `F2`, …), a **severity** (P0/P1/P2/P3), and whether it is **established** or
  **reasoned**
- (a) the concrete scenario the plan does not handle, or the authoritative contract in this repo it
  contradicts — with the file and line
- (b) the smallest change that closes it: exact replacement wording for the plan, or the code shape
  it should specify instead

A finding with no (a) goes last.

Severity, graded by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1**, and name what established it. Established means direct
evidence with no unresolved material inference — an exact reachable source path, or an authoritative
contract the plan directly contradicts. If a load-bearing premise is still inferred, it is
*reasoned*: it ranks and informs but does not block.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

1. `replaceState` preserving the stamp is the piece I trust least. `?at=` is written with a
   *debounced* replace 300ms after the reader settles, and `jumpTo` uses `throttle(0)` to write
   immediately — so around a jump there may be two or three writes in quick succession, and I am not
   certain which of them lands on which history entry.
2. The chip's hide rule is "you are back in the origin's section". Sections are coarse
   (`src/web/position.ts`), so a jump *within* one section would draw a chip that is instantly
   hidden, or never drawn. Is the gate wrong, or is the coarseness actually correct here?
3. `history.back()` on the *first* entry of a standalone PWA session does nothing at all, silently.
   The plan's gate is "the stamp names a block this article has" — is there a state where the stamp
   is present but there is genuinely nothing behind us?
4. Does `settleAddress`/`liftStrandedText` rewriting the address on arrival (`replaceState`)
   interact badly with a stamp restored from a reloaded entry?
5. Stage D (Tweets/Metadata remembering their own position) is the vaguest stage. If it is too
   underspecified to review, say so and say what it needs to decide.

Do not change any file.
