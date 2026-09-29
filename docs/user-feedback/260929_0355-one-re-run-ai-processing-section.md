# One "Re-run AI processing" section on Metadata

SPIDERYARN-READING2-4Z, from Greg (admin), in production, build `43f99ecb`, on
`/read/<slug>/metadata`, 2026-09-29 01:40:54Z. The time in the file name is when this session
received the report from the Overseer; it could not read Sentry.

> In Metadata:
> - We have both a "Generate it again" and "Start this article again". Let's somehow amalgamate them.
>   Think about how to make this a clean, understandable UI. Perhaps this section should be
>   default-collapsed. Maybe name it something clearer like "Re-run AI processing" or "Reset this
>   article" as you see fit. And maybe position it above "Archive this article".

**Ending: Shipped** — on `dev`, not deployed. Resolve 4Z (this session has no Sentry sign-in, so the
next feedback sweep does the status write).

What we did: the two sections are now one, **Re-run AI processing**, shut by default and directly
above Archive. Open it and there is a row per mode, as before, and underneath, for readers with
experimental features on, *Start the whole article again* (the reset, unchanged). Browser-checked at
desktop and phone width.

**Choices Greg can overturn in one line each:**
- The name. *Re-run AI processing* covers both halves; *Reset this article* sounded destructive
  for the per-mode rows.
- Shut means hidden rather than removed: the rows stay live while shut, so a run you started still
  refreshes the page when it finishes (found by the GPT Sol plan review).

Plan: [260929b](../plans/260929b-one-place-to-re-run-ai-processing.md). The companion report is
[the modes' redo buttons](260929_0355-modes-lose-their-redo-buttons.md).
