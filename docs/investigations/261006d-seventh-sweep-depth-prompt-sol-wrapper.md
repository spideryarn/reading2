Read these two files in this repo and follow them exactly; together they are your whole brief:

- `docs/investigations/261006d-seventh-sweep-depth-prompt-common.md`
- `docs/investigations/261006d-seventh-sweep-depth-prompt-ZONE.md`

You are GPT Sol, the second model family on this sweep (the first is Claude). Your sandbox is
read-only, with no network and no database. You may run `git`, `grep`,
`node --import tsx <script>` and `npx vitest run tests/<one>.test.ts` for a test that needs nothing
outside the tree; a red test inside the sandbox may be the sandbox's doing, so say so when you
report one. For anything that needs Postgres, give the exact SQL or command for the orchestrator to
run.

Take your time: this is a real file-by-file read, and you have about 80 minutes. Your final reply is
the investigation document itself, complete, in markdown.
