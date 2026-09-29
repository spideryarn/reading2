# The modes lose their redo buttons

SPIDERYARN-READING2-53, from Greg (admin), in production, build `43f99ecb`, 2026-09-29 01:50:32Z.
The time in the file name is when this session received the report from the Overseer; it could not
read Sentry.

> In Trajectory mode, remove the "Plan it again" button. The user can do that from Metadata if they
> really want. Same goes for any other modes that still have a "redo this processing" button - let's
> just rely on the Metadata mode for that.

**Ending: Shipped** — on `dev`, not deployed. Resolve 53 (the next feedback sweep does the Sentry
status write).

What we did: the always-there redo button is gone from six places — Trajectory (*Plan it again*),
Ideas (*Find them again*), Timeline (*Read it again*), Debate (*Search again*), Quiz (*Write them
again*) and the Thread (*Write it again*). Each has a row in Metadata's *Re-run AI processing*;
Trajectory's row is new, so nothing became impossible to redo.

**One question for Greg, because it is our reading, not your words:** the button **inside a yellow
"this is out of date" banner** stayed in every mode. That banner only appears when we know the result
was made from an older version of the article or the prompt, and it is the only place a reader
learns that — removing its button would leave a warning that says "go somewhere else to fix this".
If you want those gone too, it's a small change, and FAQ and Citations would first need Metadata
rows (today the banner is their only redo).

**Answered by report 55** (SPIDERYARN-READING2-55, the same day): the *out-of-date because of an
older prompt* banners went too, buttons and all; the stale ones (the article changed) and the
profile-changed ones stayed —
[260929c](../plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md).

Also left alone: first-run buttons in empty modes, Glossary's and Quotes' *Find more* (they add
rather than redo), Claims' *Pull them again* (no Metadata equivalent — removing it would make it
impossible), and the Criteria and Mirror reruns, which run over what the reader wrote.

Plan: [260929b](../plans/260929b-one-place-to-re-run-ai-processing.md). The companion report is
[the Metadata section](260929_0355-one-re-run-ai-processing-section.md).
