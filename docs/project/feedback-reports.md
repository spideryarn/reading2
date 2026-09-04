# Working through the feedback reports

The reader presses **Feedback**, and a row lands in Postgres and a copy lands in Sentry
([feedback.md](feedback.md) is the machinery). This doc is the other half: **what an agent does with
those reports afterwards**, so that a loop can run it unattended every few hours and each report
ends up either shipped or written down.

Greg, 2026-09-04:

> When you finish one, mark it as resolved in Sentry if you can, and write a brief .md for each
> report in `docs/user-feedback/` of the user input, and what we did (maybe just a signpost to the
> plan doc is sufficient) … As always, if a product request is going to add significant complexity,
> consider a simpler version for now, deferring the really complex bits for later.

## Where the queue lives

Sentry, not Postgres — the mirror is the queue because it has a status field and the table does not.

```
mcp__sentry__search_issues(
  organizationSlug: "greg-detre",
  projectSlugOrId:  "spideryarn-reading2",
  query:            "issue.category:feedback is:unresolved",
  period:           "30d")
```

Then `get_sentry_resource` per issue for the full text. The reader's own words are in
`### Additional Context → feedback → message`; the `url`, `slug`, `kind` and `build_commit` tags say
where they were standing when they wrote it, and `at=spya-…` in the URL is the block they were
looking at.

**`is:unresolved` is the whole of the bookkeeping.** An issue still open is a report nobody has
finished. That is why the last step of finishing one is `update_issue(status: "resolved")` — skip it
and the next run of the loop does the work again.

## The run

It is [engineering-manager.md](../reusable/engineering-manager.md), with the reports as the input:

1. **Read the queue**, in full. Reports arrive in batches and several usually touch one area — the
   staging falls out of that, not out of the order Sentry lists them in.
2. **Group into stages** by area and by size, cheapest first. A stage ends green and committed.
3. **Ask Fable for the product calls** before building: what the reader actually wants underneath
   what they asked for, and which half of it is worth doing now. Feedback is a request for an
   outcome, not a spec for a mechanism.
4. **Build it**, delegated, and **review each stage with GPT Sol**.
5. **Resolve the Sentry issue and write the note** — both, for every report, including the ones
   deferred.

**A deferred report is a finished report.** If the answer is "not now", say so in the note with the
reason and resolve it anyway; leaving it unresolved means the loop rediscovers it every three hours
and re-derives the same "not now".

## The note, in `docs/user-feedback/`

One file per report, named `yyMMdd_HHmm-kebab-description.md` — the timestamp is when the reader
sent it, from `First Seen`, so the directory sorts by when things were reported.

It holds the reader's words verbatim in a blockquote, the Sentry short id, and what we did — which
is usually one line and a link to the plan doc, because the plan doc is where reasoning belongs.
These files are a **record that a report was dealt with**, not a second place to design.

## What a report is not

It is not a ticket, and the reader is not a product manager. The judgment stays with us: a report
that would cost a week gets the version that costs an afternoon, with the rest named and deferred —
[vision.md § Simpler first](vision.md#simpler-first). And a report that describes a symptom
("couldn't upload PDF") is a lead, not a diagnosis: reproduce it before you fix it.

Questions, decisions and assumptions from an unattended run go in the plan doc, not in chat, because
there is nobody in the chat to read them.
