# A security-risks register, its first accepted risk, and a review to fill it

Up: [security-map.md](../project/security-map.md) · question `q-rstqvz`, Greg's reply
`spya-qnak8d` · queue item `qi-32rmtndv` · the build this risk is about:
[261009f](261009f-agent-questions-and-replies-in-the-database.md) (`qi-mmqzr385`, held for Greg)

Status as of 2026-10-09: **built** — [security-risks.md](../project/security-risks.md), 25 entries
(5 accepted, 12 proposed, 1 reviewer finding merged into existing entries, 7 levelled from
security.md's known gaps). Eleven proposals came from this review; R14 was an existing proposal
brought into the register. No defence was changed.

## What Greg asked for

> A although I accept it's a bit of a security risk, so if you haven't already, can you create a
> doc for security risks and add this as a medium risk or whatever level you think it is? I don't
> have access to my computer network right now, I don't want to deal with it, but I also don't want
> to block the work from happening. And so at some point in the future we might switch it over to a
> separate database login. And then maybe can you kick off, and then maybe can you kick off another
> agent whose job it is just to do a security review and update that security risks doc with
> anything else, and then we can work through their proposals in it.
>
> — Greg, 2026-10-09 (`spya-qnak8d`, replying to `q-rstqvz`)

Three things: a register doc; option A of `q-rstqvz` written into it as an accepted risk, with a
level and the later fix; and a security review whose findings go into the same doc, as proposals
Greg works through.

## What exists already

No register. [security-map.md](../project/security-map.md) is the map of defences,
[security.md](../project/security.md) the deep dive, and its § Known gaps is an honest, unlevelled
list of seven open items written as prose. Nothing records *accepted* risks in one place: the one
named as accepted (no sign-in allowlist) is a sentence in security-map.md, and others are inside
plans (the MCP OAuth token at Supabase, the private link in Vercel's access log).

## Decisions

1. **One new doc, `docs/project/security-risks.md`, owned by security-map.md**, with a line under
   § The docs and one under the entry point in AGENTS.md (signposting, no approval needed). Its job
   is the register: one entry per risk, each with a level, a status, the proposed fix and who
   decided. A reviewer finding that is already owned by another entry stays traceable but is marked
   merged, not presented as another decision. It **cites** the deep dive rather than restating it
   (one home per fact): an entry for a gap security.md already describes is two lines and a link.
   *Passed over:* adding levels to security.md § Known gaps. That list is prose inside a 1,300-line
   deep dive about the content pipeline; an accepted operational risk (a database login on the box)
   does not belong there, and Greg asked for a doc he can work through.
2. **Levels: High, Medium, Low**, each defined in one line by what it would take and what it would
   cost here (real readers' data, money, the box), so a level is a claim someone can argue with.
   Decision and fix state are separate: decisions are *accepted* (Greg has said so, quoted and
   dated), *proposed* (waiting for Greg), *known* (an inherited gap not yet put to him), or
   *declined*; fixes are *none*, *planned*, or *done and checked where they run*.
3. **The first entry is A, at Medium**, as Greg suggested, with the reasoning: the capability is
   not new (every session on the box can already read `.env.prod`'s all-tables login), but A turns
   "agents never write" into routine writes by a command, so a slip has a door it did not have; the
   blast radius is the one production database. Later fix: B (a login that may only call three
   functions), then B+ (the all-tables login out of files and accounts ordinary agents can read on
   the box and the Mac). The underlying exposure, that every agent session holds a login that can
   write every table, gets its own entry, because it exists with or without A and only B+ closes it.
4. **The review is two independent reviewers, read-only, split by ground** so they overlap less:
   GPT Sol (high effort, `--sandbox review`) on the app and server: routes, the gate, the public
   namespace, fetching, billing, MCP, storage, model output. An Opus subagent on the operational
   side: credentials on the box and the Mac, the fleet dashboard and Overseer, agents reading
   hostile input, scripts that reach production, the deploy path, logs and Sentry. Each may report
   outside its ground. Neither edits anything, sends anything to production, or prints a secret's
   value. I check every finding against the code before it goes in; an unverified one goes in
   marked so, or not at all.
   *Passed over:* one reviewer. Cheaper, but Greg asked for a review to work through, and a second
   family catches what the first shares assumptions about.
5. **No defence is changed.** Every finding is a proposal. The register is the deliverable.

## Bookkeeping

`q-rstqvz.md`: Greg's reply quoted under the body, `acted: spya-qnak8d`, status stays `open` until A
is built. A note in `docs/user-feedback/` (`reports: none`). `scripts/feedback-endings.ts`.

## What the plan review changed

GPT Sol, read-only ([review](261009o-security-risks-register-plan-review-sol.md), REVISE, five
findings, all taken):

1. Levels are likelihood times cost, and R1 is levelled as the *added* risk: A gives a misled agent
   nothing it lacks today. Kept at Medium on that basis, and said so in the entry.
2. The ambient credential exposure is its own entry, R2, at High, linked to A7, whose written
   trigger has happened.
3. One status could not say "accepted now, fix planned". Decision and fix state are now separate
   fields, each entry carries its cost, and *done* means checked where it runs.
4. The split left the seam between app and agent unowned. The Opus reviewer was sent an extra
   brief: trace hostile bytes (a report, an article, a fetched page) to a privileged action and say
   which step stops it. Live consoles stay unreviewed and are listed as such.
5. Two corrections: security.md has seven open gaps, not six; `spideryarn_app` is DML on the
   `spideryarn` schema, not "every table".

## The review, and how its findings were checked

- GPT Sol on the app and server: [prompt](261009o-security-review-app-prompt.md),
  [answer](261009o-security-review-app-sol.md). Three findings (R10, R13, R15), each read back in
  the code: no limiter before `createGptLiveSession`; `sweepable()` has no caller; no framing header
  in `vercel.json` or `src/`.
- Opus on the box and the agents: nine findings and three attack paths, [its report](261009o-security-review-ops-opus.md). Checked on the box by variable name and key prefix only: `.env.prod`'s
  variable names, the `sk_live` prefix, `migratorUrlFrom`'s `postgres.<ref>` and its two callers,
  `tmux-job.ts`'s usage, the listener on 8791. Its findings became R6–R9, R11, R12, R16–R18.
- Found while checking, by this session: the Vercel MCP deny list's stale names (R12, which Opus
  found too). The Supabase MCP points at the local stack, and the Supabase CLI holds no login file
  on the box.
- R17's observation was true but not a separate risk: R2 already owns the ambient credential
  exposure, and R8 owns same-user isolation, so it is retained as merged rather than presented to
  Greg as a third decision.
- Brought in from the earlier MCP plan: R14. The seven live items already under security.md's
  *Known gaps* became R19–R25; R25 preserves the difference between SSRF being stopped and a direct
  `/add/<url>` visit still starting paid work without a confirming click.

## Reviews

GPT Sol on this plan (above), and GPT Sol on the finished register before pushing
([prompt](261009o-security-risks-register-code-review-prompt.md),
[answer](261009o-security-risks-register-code-review-sol.md)).
