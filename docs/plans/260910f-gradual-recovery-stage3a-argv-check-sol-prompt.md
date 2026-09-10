# Narrow check: `claude-argv.ts`'s new `--resume <uuid>` arm (read-only, findings only, 20 minutes)

You are reviewing **one narrow change to a security matcher**. Read-only: do not change any file.
The sandbox cannot write to the tree, so put everything in your closing answer.

## Why this matters

`tools/fleet/claude-argv.ts` reads a `claude` process's command line. Its reading feeds
`tools/fleet/steer.ts`'s `isClaudeForSession`: **the guard that stops a dashboard Send from landing
in the wrong conversation.** It also feeds `tools/fleet/execution-identity.ts`, which decides
whether a pane holds a *verified* conversation. A reading that names the wrong conversation, or
names one where it should refuse, is the failure this file exists to prevent.

The module's own header states its rule. It recognises only shapes this repo produces, and anything
it cannot decide is `unreadable`, on purpose.

## The candidate

- **Commit `325a9acc` on `dev`.** It also carries unrelated fixes. Review only these paths:
  - `git show 325a9acc -- tools/fleet/claude-argv.ts tools/fleet/execution-identity.ts`;
  - the tests: `git show 325a9acc -- tests/fleet-claude-argv.test.ts tests/fleet-steer.test.ts tests/fleet-execution-identity.test.ts`;
  - the capture: `tests/fixtures/claude-argv/resumed-claude.json`.
- **The rule it adds:**
  - On **faithful** argv, a token immediately after `--resume` that matches a strict lowercase uuid
    regex is a conversation id. It joins `sessionIds` beside any `--session-id`.
  - **Still unreadable:** a bare `--resume` (the interactive picker), a non-uuid or uppercase value,
    `--resume=<uuid>`, `-r`, and `--fork-session`.
  - **On a ps-flattened line** the uuid counts only when nothing, or a dash-led token, follows it.
    The reason: a bad `--resume` value opens a live picker, unlike a bad `--session-id`, so
    `--resume "<uuid> words"` could otherwise print like a resume plus a prompt. Steer's guard reads
    faithful argv only.
- **Why:** `claude --resume <uuid>` keeps the same conversation id, but its argv carries no
  `--session-id`. Measured on the box, `claude` 2.1.267: `claude -p --resume <uuid> "…"` took the
  token after `--resume` as the value, and the next word as the prompt. Details are in the plan's
  "Spike" section:
  `docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md`.

## Evidence already gathered

- **A real capture.** One paid Haiku call on a private tmux socket, from `/proc/<pid>/cmdline`
  split on NUL:
  `["claude","--resume","723dd2cd-a055-48c2-8d9b-aec6743802bc","--permission-mode","auto","--model","haiku","--","Reply with exactly: OK4"]`.
- **The Overseer's required refusal tests**, in `tests/fleet-steer.test.ts`:
  1. `claude --resume <OTHER uuid>` is still refused as a competing Claude, for a session whose
     conversation is a different uuid;
  2. a bare `claude --resume` stays unreadable;
  3. a uuid-shaped positional after any other flag, such as `--permission-mode auto <uuid>` or after
     `--`, is not read as the conversation.
- **Four mutations, each reverted:**

  | Mutation | Tests turned red |
  |---|---|
  | accept any token after `--resume` | 3 |
  | read a uuid positional after `--permission-mode` | 2 |
  | drop the capability check | 4 (the daemon side, out of scope here) |
  | a malformed capability read as present | 3 (out of scope here) |

- **Gates** on the merged tree: typecheck exit 0, and 22 files / 794 tests passing. That covers
  `fleet-claude-argv`, `fleet-steer` and `fleet-execution-identity`.

You may run those three test files yourself.

## What to attack

Find any argv this repo could plausibly produce, or that a person or another tool could start on
this box, for which the new arm:

- **(a)** names a conversation the process is not actually in;
- **(b)** makes `isClaudeForSession` say "yes" for the wrong session, or stop refusing a competing
  Claude it refused before;
- **(c)** reads a prompt, or part of one, as the conversation id;
- **(d)** treats an optional-value ambiguity as decidable when the CLI would not.

Attack these specifically:

- the ps-flattened branch;
- `--resume` combined with `--session-id`, `--fork-session`, `--continue` or `-p`;
- repeated `--resume`;
- a uuid after `--`;
- `--resume` as the last token;
- whitespace or case variants.

Also check that nothing that was unreadable before, other than the single intended shape, became
readable.

## Form

For each finding, give:

- an ID, **G21, G22, …**;
- a severity: P0 is an exploitable wrong-conversation Send; P1 is a wrong reading or refusal that
  a user can reach, or a contract violation; P2; P3;
- **established** or **reasoned**, with evidence at `file:line`, or a concrete argv and what the
  code returns for it;
- the fix.

End with one line: *nothing found*, or the IDs to fix.
