---
reports: spya-wa7wms
ending: shipped
---
# A feedback screenshot refused as too big

A problem from Greg, relayed by the Overseer as an admin's report (Sentry confirmed, event
`597e73e6fd6141c3a12df2726b92a632`).

> I tried to upload a screenshot to a Feedback report. It wasn't actually very big. I think it was
> like 400KB, but I got an error saying something like the screenshot's too big. This feels like
> something we should be able to address, and I think we should really find a way to allow (if
> necessary auto-resizing) screenshots of at least 5MB?
>
> — Greg, 2026-10-03 (`spya-wa7wms`)

## What we did

Plan, reviews and measurements:
[261003k](../plans/261003k-feedback-screenshot-shrinks-to-fit-and-profile-sections-collapse.md).
What is built is in [feedback.md § The screenshot](../project/feedback.md#the-screenshot).

- **The cause.** The dialog drew the picture at 1600 pixels once, wrote it as a PNG, and refused
  anything over 400 KB. The size of the file picked never mattered. A screenshot with a photograph
  in it is one to three megabytes as a PNG, so it was refused.
- **It now shrinks until it fits**: 1600, then 1280, 1024, 800 and 640 pixels on the long edge. The
  first that fits is sent.
- **The stored limit went from 400 KB to 2 MB**, so most screenshots still go at full size.

## What Greg should know

- **Any size of file can be picked**, 5 MB or more; it is shrunk in the browser. The 2 MB is what we
  store. It is not 5 MB because the picture travels inside the request as text, 5 MB becomes 6.7 MB
  that way, and Vercel refuses a request over 4.5 MB before our code runs.
- **There is a migration**: it relaxes the size check on the `feedback` table. Additive; every
  existing row passes it.
- The original picture was not available, so the cause is read from the code and reproduced with a
  picture built to behave the same way, not with Greg's own.
