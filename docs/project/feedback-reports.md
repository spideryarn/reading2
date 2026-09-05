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
finished. That is why the last step of finishing one is always a status write — skip it and the next
run of the loop does the work again. There are three of them: § Three ways a report ends.

## Who sent it

The reader's address is on the Sentry issue (`contexts.feedback.contact_email`), and whether it is an
administrator's is [`src/admin.ts`](../../src/admin.ts).

**From Greg or another admin: build it.** No debate about whether it is worth doing — the person who
decides that is the person who filed it. What survives is *how*:
[simplest version first](vision.md#simpler-first), so if the full request is a week's work the agent
builds the afternoon-sized version and names the deferred rest in the plan doc. It does not stop to
ask permission it already has.

**From a reader, and it's a problem: investigate all of them.** Reproduce it first — a symptom is a
lead, not a diagnosis. Then fix it, if three things hold: you are confident it is genuinely a bug,
the fix sits with [what this product is for](vision.md), and it doesn't drag much complexity in
behind it. If it fails one of those, it is a suggestion, so treat it as one.

**From a reader, and it's a suggestion: this is where the judgment is.** Ask **Fable** — the product
call is what Fable is for — and **GPT Sol**
([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)) where the question is whether the
effort buys the benefit. Between them: does this make it better for readers who never asked for it,
and is it what we are trying to build? Four ways it can go, and all four are legitimate:

- build what they asked for;
- build a **tweaked** version — simpler, more general, or narrower — which is often the right answer;
- **decline** it, with the reason written down;
- **write it up and wait.** If it is in doubt, this is the answer. Do the research and the plan doc
  properly, and stop before implementing.

## The run

It is [engineering-manager.md](../reusable/engineering-manager.md), with the reports as the input:

1. **Read the queue, in full, before starting anything.** Two reports that turn out to be one bug
   become one agent's brief; the rest are independent and the fan-out below assumes it.
2. **One `gjd-remote` session per report**, not a background subagent — so that each report is a
   real Claude session on the box, which Greg can open a tab on with `gjd-remote resume-all` or
   steer through Claude Code remote control while it runs
   ([hetzner-remote-server-box.md](hetzner-remote-server-box.md)):

   ```
   gjd-remote new-claude --no-attach -p - <<'EOF'
   User feedback: <the reader's words, verbatim> — <Sentry short id and link, and the url, slug
   and kind tags>. Proceed autonomously, following docs/reusable/engineering-manager.md and
   docs/project/feedback-reports.md: your own worktree, land it on dev, and finish with the
   bookkeeping in the three-ways-a-report-ends section.
   EOF
   ```

   `-p -` takes the prompt from stdin, so the reader's own words need no escaping; `--no-attach` so
   the launcher can start the next one instead of being handed the terminal. Each session runs
   [engineering-manager.md](../reusable/engineering-manager.md) in **its own worktree**
   (`EnterWorktree`, then `npm run worktree:setup` — [worktrees.md](worktrees.md)), with its own
   subagents beneath it. **Three at a time at most**: they share one local Supabase, one dev server
   and one box, and past three the tests start going red for reasons that are nobody's bug.

   **The loop can run this from the box itself** — it has a keypair that reaches only itself, so it
   ssh's to `127.0.0.1` and the sessions it starts are the same tmux sessions the laptop's
   `resume-all` opens
   ([hetzner-remote-server-box.md § Running `gjd-remote` from the box](hetzner-remote-server-box.md#running-gjd-remote-from-the-box)).
   Two things a box-side launcher must do that a laptop one does not: run it as
   `npx tsx scripts/gjd-remote.ts`, which is the only name it has there, and **set
   `GJD_REMOTE_HOST=127.0.0.1` on the command itself** — provisioning exports it from
   `/etc/profile.d/`, which only a *login* shell reads, and an agent's tool shell is not one. Without
   it the command goes looking for `tofu` and dies. So, on the box:

   ```
   GJD_REMOTE_HOST=127.0.0.1 npx tsx scripts/gjd-remote.ts new-claude --no-attach -p - <<'EOF'
   …
   EOF
   ```

   Verified end to end from the box on 2026-09-05: session created, Claude started, prompt answered.
3. **Each agent decides for itself** what to build, using § Who sent it above — Fable and GPT Sol are
   its calls to make, not this loop's.
4. **It lands on `dev` and stops there**: green tests, a GPT Sol review of the code,
   `git push origin HEAD:dev`. **The loop never deploys.** Production is `npm run deploy`, and it
   stays Greg's.
5. **Then the bookkeeping** — § Three ways a report ends.

## Three ways a report ends

Every report ends in exactly one of these, and **none of them is "still unresolved"** — an issue left
open is one the loop rediscovers in three hours and re-derives the same answer for.

- **Shipped** — on `dev`. `update_issue(status: "resolved")`.
- **Declined** — the reason in the note. `resolved` too: a decision is a finish.
- **Awaiting Greg** — the plan doc written, nothing built.
  `update_issue(status: "ignored", ignoreMode: "forever", reason: <one line>)`, which takes it out of
  the queue without claiming it is done, **and** a line in
  [`awaiting-approval.md`](../user-feedback/awaiting-approval.md): the date, the Sentry short id, one
  sentence, and a link to the plan doc.

**Read `awaiting-approval.md` first, every run, and report what is on it.** `ignored` is invisible;
that file is the only thing standing between a written-up proposal and it quietly ageing out. When
Greg answers, the line moves to shipped or declined and comes off.

## The note, in `docs/user-feedback/`

One file per report, named `yyMMdd_HHmm-kebab-description.md` — the timestamp is when the reader
sent it, from `First Seen`, so the directory sorts by when things were reported.

It holds the reader's words verbatim in a blockquote, the Sentry short id, **which of the three
endings it got**, and what we did — usually one line and a link to the plan doc, because the plan
doc is where reasoning belongs.
These files are a **record that a report was dealt with**, not a second place to design.

## What a report is not

It is not a ticket, and the reader is not a product manager. The judgment stays with us: a report
that would cost a week gets the version that costs an afternoon, with the rest named and deferred —
[vision.md § Simpler first](vision.md#simpler-first). And a report that describes a symptom
("couldn't upload PDF") is a lead, not a diagnosis: reproduce it before you fix it.

Questions, decisions and assumptions from an unattended run go in the plan doc, not in chat, because
there is nobody in the chat to read them.
