---
reports: spya-jejbpz
ending: shipped
---
# Metadata's *Run it* runs on one press

SPIDERYARN-READING2-64, from Greg (admin — `scripts/feedback-reporter.ts` exits 0 for the
issue's user id), in production, on `/read/dongetal25-spya-vfmvmm/metadata`. The time in the file
name is when this session received the report from the Overseer; it could not read Sentry.

> In Metadata when I click "Run it" or "Run it again" for a mode, don't include the confirmation
> step. Just do it.

**Ending: Shipped** — on `dev`, not deployed. Resolve 64 (this session has no Sentry sign-in, so
the next feedback sweep does the status write).

What we did: every mode row in *Re-run AI processing* now starts its run on the first press, and so
does *Retry* after a failure. Batched with its companion report,
[Start again folded into the run-again section](260930_0745-start-again-is-the-rerun-sections-first-row.md).

**What the confirm guarded, checked before it went** (the brief asked): no reader's slot (a re-run is
a bare-slug `POST /api/jobs`, which reserves nothing — billing.md), nothing of the reader's (a run
publishes only on success — bar one edge: a glossary rewrite stops saved look-ups showing beside
entries whose ids change, which the old confirm did not mention either), and not on security-map.md. It guarded one of our model calls against a
slip of the finger, and nothing more — a script calls the route directly. So it went for every
reader, not only admins.

**Choices Greg can overturn in one line each:**
- What the confirm used to say is now a faint note under the **Sketch** (*about $0.20,
  about two minutes*), **Debate** (*up to two calls, $0.20–0.40 on a short article*) and
  **Trajectory** (*needs Quotes first*) rows — visible before pressing, no extra click.
- The glossary's button is now the plain *Run it again*, with a note: *Adds more terms to an
  up-to-date list; otherwise writes a new one*. It used to say *Find more
  terms* every time, but a run over a stale glossary rewrites it (found by GPT Sol; the old confirm
  made the same wrong promise).
- *Retry* now shows *Starting…* straight away, so a double click sends one retry — on every mode
  panel, not only here.

Plan: [260930e](../plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md).

**Follow-ups, 2026-10-01**
([261001i](../plans/261001i-glossary-undo-find-more-and-say-append-or-rewrite-in-metadata.md)):
the glossary row now says which of the two will happen. It shows *Find more terms* when the run will
add to the list, and *Run it again* with *writes a new list* when the article,
the glossary's instructions or the reader's profile has changed. *Start again*'s Retry got the same
one-press latch. An Undo for an accidental *Find more* was designed and deliberately not built: the
pass only adds terms, Stop is on screen while it runs, and nobody has asked for it. On `dev` in
`d4c29a3f` and `e32935e7`, not deployed. Ending unchanged: shipped.
