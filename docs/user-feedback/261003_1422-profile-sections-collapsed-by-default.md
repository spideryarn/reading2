---
reports: spya-ka3cau
ending: shipped
---
# Profile's sections, collapsed by default like Metadata's

A suggestion from Greg, relayed by the Overseer as an admin's report (Sentry confirmed, event
`81a0c0342f3540b38a02d68ae30f3200`).

> In the meta data page, we have a nice table of contents on the left-hand side, I think with a
> search bar as well. And most of the sections are default collapsed, except for the important
> ones. Let's consider doing the same thing for the profile page. So the important ones that we
> should keep open are probably account, plan, and about you. And then I think the others could
> perhaps be default collapsed.
>
> — Greg, 2026-10-03 (`spya-ka3cau`)

## What we did

Plan, reviews and the browser check:
[261003k](../plans/261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md).
What is built is in [reader-profile.md](../project/reader-profile.md).

- **Account, Plan and About you stay open** and cannot be shut.
- **Settings, Recently read and What's running start shut.** Each heading is a button with a
  chevron, as on Metadata.
- **One section component, not two.** Metadata's moved to `src/web/PageSection.tsx` and Profile uses
  it.
- **A bug found on the way and fixed**: every row of What's running read
  *"OpenRouter (undefined)"*.

## What Greg should know

- **The contents list and search box are not on Profile.** That half is a question, not a decline:
  `[Q-profile-contents-list]` in the session's debrief. With six headings on about one screen the
  recommendation is to leave it off. The sections already carry what the list reads, so adding it
  later is small.
- **Open or shut is not remembered.** The three start shut on every visit, as Metadata's do.
- The shut headings are 14 pixels tall, which is small under a thumb. It is Metadata's heading
  exactly, so changing it changes both pages.
