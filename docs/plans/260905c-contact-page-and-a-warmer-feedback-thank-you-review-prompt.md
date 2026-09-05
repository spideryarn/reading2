# Review: a new `/contact` page, and a per-kind feedback thank-you whose Close draws nothing on the way out

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page` (a git worktree of the
Spideryarn repo), branch `worktree-feedback-contact-page`. TypeScript + ESM, React 19 SPA built with
Vite, no framework router — `src/web/router.ts` is fifty lines of `parseRoute`. Tests are vitest;
client tests run under jsdom.

Two unrelated user-feedback reports from the product owner, done in one commit because they share a
worktree.

## The candidate

Live pre-commit; base `15f2cb39963b735c6243cee0b5da69976bbeab41`.

Modified:

```
docs/project/feedback.md
docs/project/website-text.md
src/web/App.tsx
src/web/FeedbackDialog.tsx
src/web/SiteFooter.tsx
src/web/page-title.ts
src/web/router.ts
tests/feedback-dialog.test.tsx
tests/page-title.test.ts
tests/router.test.ts
tests/site-footer.test.tsx
```

Untracked (new files — a pathspec will not name these, so read them directly):

```
docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md
src/web/ContactPage.tsx
```

`git diff 15f2cb39 -- <the modified paths>` gives the change for the tracked half.

Start with `src/web/FeedbackDialog.tsx` and `src/web/ContactPage.tsx`. That is where to begin, not
the limit of scope — the manifest above is.

(Not durable: this is an uncommitted tree. The resulting commit SHA will be written into
`docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md` once it lands.)

## What it is meant to do

**Report 1H — a `/contact` page.** The owner asked for a brief page saying Spideryarn is in beta,
that we would love feedback or suggestions, that the best way is the Feedback button in the top
right, and that the address is `hello@spideryarn.com`. It is a new route (`/contact`), a new page
component shaped like the existing `PrivacyPage.tsx`, a new `pageTitle` variant, an entry in
`SiteFooter.tsx`'s `LINKS`, and two branches in `App.tsx` (signed out and signed in).

Contracts it must not break:

- The contact address is spelled **once**, at `CONTACT_EMAIL` in `src/site-text.ts`
  (`docs/project/website-text.md § The contact address`). A second literal anywhere is a defect.
- `src/web/` may not import server modules; `tests/client-imports.test.ts` asserts the client import
  graph is closed.
- The footer row drops the link for the page it is on, and `here` may be passed **only** by the two
  pages `App.tsx` uses as fallbacks (`LandingPage`, `Library`) — see the header of
  `src/web/SiteFooter.tsx`.
- Nothing under `/read/` may mount the footer.

**Report 1N — the thank-you, and the Close.** Two halves:

1. The panel shown after a report is filed said *"Thank you — that is filed."* to everyone. It must
   now differ by what the reader called it: sympathetic for a problem, appreciative for a suggestion,
   and a third sentence for a reader who picked neither (the toggle deliberately defaults to null).
   The kind is carried on the `sent` stage variant rather than read from the live `kind` form state,
   because `discard()` clears that.
2. The owner said pressing Close on the thank-you "shouldn't be a delay, it should happen
   instantly". Diagnosis: nothing was slow. The button called `discard()` and `onClose()` together,
   which land in one React commit — so the emptied editing form was rendered back into a `<dialog>`
   whose `open` attribute nothing had touched yet, the browser painted that, and only then did the
   passive effect run `dialog.close()`. The reader saw a blank feedback form flash up in place of the
   thank-you.

   The change: the Close button only calls `onClose()`; a new `useEffect` runs `discard()` once
   `open` has gone false **and** the stage is `sent`; and the show/close sync effect became a
   `useLayoutEffect`. A side effect of this, deliberate and documented: Escape / ✕ / backdrop now
   also start the next report, where before they left the stage at `sent` so the next open showed a
   stale thank-you.

Invariants in that file that must survive, all of them written after previous review findings, and
each has a comment saying so:

- **A draft survives being dismissed.** Only a *filed* report may clear the boxes. A mid-edit close,
  or a close after a **failed** send, must keep the reader's words.
- **`reportId` changes in exactly one place** — inside `discard()`, i.e. only after a report is
  successfully filed. A retry after a failed send must carry the same id, because the server's
  idempotency is what stops a double file.
- `sending` (a ref latch) must not let two clicks in one frame file two reports, and closing
  mid-flight must release it.
- `attempts` (a counter) must mean only the newest attempt may write to the screen.

Deliberately out of scope: `src/web/Lightbox.tsx` has the same `useEffect` show/close sync and has
been left alone; its panel does not change on the way out.

## What you can and cannot run

The tree is read-only for you; `/tmp` and the node_modules caches are writable. You can run one test
file — `npx vitest run tests/feedback-dialog.test.tsx` or `npx vitest run tests/site-footer.test.tsx`
— and build a throwaway harness under `/tmp`. You have no network, not even loopback, so anything
needing Postgres or a local service will skip. Those I have run: `npm run typecheck` is green, and
the full `npm test` result is quoted in my summary below.

Red-then-green evidence I ran myself, for the two new ordering tests: with the Close button restored
to `discard(); onClose();` and the new effect deleted, `tests/feedback-dialog.test.tsx` reports
`2 failed | 27 passed`; with the change in place, `29 passed`.

## Attack it

Independently, before you read my questions below.

The invariants worth trying to break, in rough order of what would hurt most:

- Find a sequence of opens, closes, sends, failures and retries in `FeedbackDialog.tsx` where the
  reader **loses words they typed**, or where **two reports are filed for one bug**, or where a
  **retry stops carrying the same `reportId`**. The new effect is a fourth writer of the component's
  state and it fires on a prop transition rather than on a click.
- Find a state in which the new effect either does not fire when it should (leaving a stale
  thank-you) or fires when it should not (clearing a draft).
- Break the `/contact` route: an address that should not parse as `contact` but does, or a page that
  renders for the wrong reader, or a footer that links to the page it is on.
- Anything in the new prose (`ContactPage.tsx`, `THANKS`, the two docs) that is **false about the
  code**. That is a house rule with its own history: the landing page claimed "six diagrams" for a
  day when there were four.

For each finding give:

- an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
- (a) what shows it fails its own claim — the input, sequence or mutation I can run
- (b) the smallest change that closes it — a code block, or exact replacement wording

Severity is by consequence: **P0** data loss, exploitable security, incorrect charging, or the
service broadly unusable; **P1** user-visible wrong behaviour, or an authoritative contract violated;
**P2** design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose or
comment defect. A defect in a doc that will cause a P1 to ship is not a P3 because it is made of
prose.

A finding with no (a) goes last. Refuse only on an **established** P0 or P1 — direct evidence with no
unresolved material inference — and name what established it.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself. Spend
most of the run elsewhere.

1. The new reset effect depends on `discard`, which is a `useCallback` with `[]` deps, and on
   `stage.kind`. I believe it cannot loop (it sets the stage to `editing`, which fails its own
   guard), but I have not proved it against every path that can set `stage` to `sent`.
2. `useLayoutEffect` for the dialog show/close: I could not write a jsdom test that distinguishes it
   from `useEffect`, because jsdom has no paint and React flushes both within one microtask there. So
   it is an argued change, not a tested one. Is it right, and is there a browser-free way to pin it
   that I have missed?
3. Closing the thank-you with Escape now discards. That is new behaviour nobody asked for, and I
   claim it is strictly better. Is there a reader for whom it is worse?
4. The footer row now carries both a `Contact` link and the raw `mailto:` address. I kept both. Is
   that defensible, or is one of them now wrong?

Do not change any file.
