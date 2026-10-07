# Fix check: the three findings your code review left (F10, F11, F12)

Repo: this worktree. Read-only: report, change nothing.

Your review is `docs/plans/261005l-permalink-and-share-code-review-sol.md`. Since then one commit,
`2ebec5a62` (`git show 2ebec5a62 -- src tests`), kept your F13 and F14 fixes and closed F10 to F12
by removing parts rather than by giving each compensating write an owner:

1. **No automatic take-back.** `ShareAtAdd` sends `private` only from `untick()`.
2. **One controller per slug per tab** (`shareAtAddFor`, a module-level map in
   `src/web/add-share.ts`); `AddPage` looks it up by slug alone.
3. **A reload shows unknown, not off.** A `sessionStorage` mark is written when a publish answers
   on, unreadably or not at all, and removed when the server confirms private. A fresh controller
   whose probe says *none* and whose slug is marked starts `unknown` (`because: "reload"`), sends
   nothing, and offers the untick. A second tab has no mark: accepted, documented in
   `docs/project/public-readable-sharing.md` § While the article is still importing, and put to
   Greg as a question (a pre-publication visibility read on the server).

The plan's § What landed and the postmortem's § What was done about it say the same.

## What I want from you

- Are F11 and F12 actually closed? Try to construct any path that sends a request the reader did
  not ask for, or two writers for one slug, or a page that says Public over a private article.
- F10: is the same-tab reload handled truthfully? Is the second-tab residual stated accurately in
  the docs, and is accepting it for a v1 defensible given that the owner did confirm, nothing is
  readable before publication, and Metadata shows the truth once the article opens? If you think it
  must not ship, say what minimal thing would change your mind.
- The implementer's own doubts: a registry controller is never re-probed (share on the add page,
  unshare on Metadata, revisit `/add/…` in the same tab: the box briefly reads Public from
  memory); a paused controller for an old slug can stay `waiting` and resume if that slug is shown
  again; `shareAtAddFor` writes to the module map during render.
- Anything the simplification broke in your F13 / F14 fixes.

Severity, file and line for each finding. End with a verdict line.
