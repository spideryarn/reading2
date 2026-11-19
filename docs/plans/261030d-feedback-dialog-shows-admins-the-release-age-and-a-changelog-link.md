# The Feedback dialog shows an admin the release's age and a link to the changelog

Report `spya-hgpctx` (Sentry SPIDERYARN-READING2-QC), a suggestion from Greg (admin), 2026-10-30:

> In the feedback dialogue, for admins: at the top, can we include a link to the changelog and some
> kind of indication of when the most recent release came out? You know, three hours ago, six hours
> ago, whatever.

## What we build

*As built, after the plan review below* (first drafted inside the head, dating only this tab's
build). For an admin only, one small faint line directly under the dialog's head:

```
Feedback                                   ×
Released 3 hours ago · Changelog
```

- **"Released 3 hours ago"** is the age of the most recent release this tab knows of: the newer
  build the deploy watcher has seen live, if any, else this tab's own `build-stamp.ts § buildTime`,
  through the shared `relative-time.ts § timeAgo`, with `useNow` ticking it. Hover (`data-tip`)
  gives the exact time and the commit, and a screen reader reads the same.
- **"Changelog"** links to `/changelog`, in a new tab, so following it does not navigate away from
  the article the report is about and the half-written draft.
- Off a build (dev, vitest) there is no stamp, so only the link shows.
- Not drawn for a reader who is not an admin; `admin` is the prop the dialog already has.

## Why the build time, and why "Released"

No new source, as the brief asked. The build time is already what `/changelog` dates the release
this bundle carries by (`ChangelogPage.tsx § withPending`), and what `/admin`'s `BuildStampLine`
shows. So the dialog and the page its link opens agree about the top release's time, by
construction.

`/admin` says "Built" rather than "Deployed" because a compile time overclaims in three cases (a tab
open across a deploy, Vercel's promote lag of a minute or two, a rollback). Here Greg asked for the
*release*, and `/changelog` already calls this same instant the release's; the tooltip says it is
the build this tab is running, which covers the stale-tab case for anyone who wonders. "Released"
for the words he used; the caveat in the tooltip.

## Simpler and other options passed over

- **Fetch the newest release from `/build.json` or `/api/health`** — would say "the latest release"
  even in a stale tab, but adds a request that can fail, a loading state, and a second opinion to
  reconcile. The brief asked for the running build; the changelog page already self-reloads to a new
  build.
- **Reuse `BuildStampLine` from AdminPage** — it is Tailwind, page-sized, and says "Built"; a ten-line
  component in the dialog's own CSS is simpler than parameterising it.

## What GPT Sol's plan review changed

Five findings (`gpt-5.6-sol`, high effort, read-only), all taken in some form:

- **P1, "Released" is the running build, not the most recent release.** Partly disagreed: a
  release's time *is* its build time (`changelog.ts promote` writes it as `version`), and the
  promote lag is noise at hours. But a tab open across a deploy really is running an older release.
  Taken the cheap way it pointed at: the page's one deploy watcher (`stale-shell.ts`) already polls
  `/build.json`, and the build it reports carries its own build time, so when it has seen a newer
  one the line dates that one and says *"(this tab is older — reload for it)"*. No new request.
- **P2, the link before Close would take the dialog's first focus.** The line goes *under* the
  head, after Close in the DOM, not between the title and Close as first drafted.
- **P2, the test must exercise the age.** `buildTime` and the watcher are mocked in the dialog test,
  which checks the age, the stale-tab wording, the bare link off a build, and that a reader sees none
  of it. Seen red with the line removed.
- **P3, narrow phones.** Moot once the line is its own row.
- **P3, a clock behind a closed dialog.** The line mounts only while `admin && open`.

## Tests

`tests/` — a render test of the dialog: admin sees the link to `/changelog`; a non-admin does not.
The relative wording is `relativeAgo`'s, already tested. Typecheck, the feedback suites, doc-links.
A browser check (Sonnet subagent) that the head still fits at phone width.

## Docs

A short section in `docs/project/feedback.md`.
